import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const tweet = (id, mediaId, text, extra = {}) => ({
  __typename: "Tweet",
  rest_id: id,
  legacy: {
    id_str: id,
    full_text: text,
    conversation_id_str: id,
    extended_entities: {
      media: [{
        id_str: mediaId,
        media_key: `13_${mediaId}`,
        media_url_https: `https://pbs.twimg.com/amplify_video_thumb/${mediaId}/img/x.jpg`,
        original_info: { width: 1080, height: 1920 },
        video_info: {
          duration_millis: 13000,
          variants: [
            { content_type: "application/x-mpegURL", url: `https://video.twimg.com/amplify_video/${mediaId}/pl/master.m3u8` },
            { content_type: "video/mp4", bitrate: 2176000, url: `https://video.twimg.com/amplify_video/${mediaId}/vid/avc1/1080x1920/a.mp4` }
          ]
        }
      }]
    }
  },
  ...extra
});

// ---- X page hook: post ids and path-scoped rescans ----
let nextPayload = {};
const fakeFetchResponse = (payload) => ({
  url: "https://x.com/i/api/graphql/x/HomeTimeline",
  headers: { get: (name) => (String(name).toLowerCase() === "content-type" ? "application/json" : "") },
  clone: () => ({ text: async () => JSON.stringify(payload) })
});
const hookMessages = [];
const hookListeners = new Map();
const hookLocation = { pathname: "/home", href: "https://x.com/home" };
const hookWindow = {
  __vidPocketXMediaHookTestMode: true,
  location: hookLocation,
  fetch: async () => fakeFetchResponse(nextPayload),
  XMLHttpRequest: function FakeXhr() {},
  addEventListener(type, listener) { hookListeners.set(type, listener); },
  postMessage(message) { hookMessages.push(message); },
  document: { readyState: "complete", querySelectorAll: () => [] },
  performance: { getEntriesByType: () => [] }
};
hookWindow.XMLHttpRequest.prototype.open = function () {};
hookWindow.XMLHttpRequest.prototype.send = function () {};
const hookContext = { window: hookWindow, URL, JSON, Map, Set, WeakSet, Array, Object, Number, String, Math, RegExp, Promise, Symbol, setTimeout, clearTimeout };
vm.createContext(hookContext);
vm.runInContext(readFileSync("src/x-media-hook.js", "utf8"), hookContext, { filename: "src/x-media-hook.js" });
const hookApi = hookWindow.__vidPocketXMediaHookTestApi;

const quoted = tweet("3000000000000000002", "3000000000000000102", "the quoted post");
const timeline = {
  data: {
    entries: [
      tweet("3000000000000000001", "3000000000000000101", "robot dog on the stairs"),
      tweet("3000000000000000003", "3000000000000000103", "a post quoting another", { quoted_status_result: { result: quoted } })
    ]
  }
};
const extracted = hookApi.extractXMediaCandidates(timeline);
const postOf = (mediaId) => extracted.find((item) => item.url.includes(`/${mediaId}/`) && item.kind === "video").postId;
assert.equal(postOf("3000000000000000101"), "3000000000000000001", "media carries the id of the tweet that owns it");
assert.equal(postOf("3000000000000000102"), "3000000000000000002", "media in a quoted tweet carries the quoted tweet id");
assert.equal(postOf("3000000000000000103"), "3000000000000000003");

// Timeline data arrives while on /home, through the hook's fetch wrapper (as a GraphQL response would).
nextPayload = timeline;
await hookWindow.fetch("https://x.com/i/api/graphql/x/HomeTimeline");
await new Promise((resolve) => setTimeout(resolve, 20));

// The user opens one post without a reload; X may not refetch its data.
hookLocation.pathname = "/someone/status/3000000000000000001";
hookMessages.length = 0;
hookListeners.get("message")({ source: hookWindow, data: { source: "vidpocket-content", type: "scan-x-media" } });
// The hook throttles rescans to one per 600ms.
await new Promise((resolve) => setTimeout(resolve, 900));
const rescanUrls = hookMessages.flatMap((message) => message.candidates.map((item) => item.url));
assert.ok(rescanUrls.length > 0, "the rescan reports the opened post's video from the session cache");
assert.ok(rescanUrls.every((url) => url.includes("/3000000000000000101/")), `the rescan reports only the opened post's video, got ${rescanUrls.length} urls`);

// ---- content script: path change resets its own list and tells the background ----
const windowListeners = new Map();
const runtimeMessages = [];
const pageWindow = { innerWidth: 1280, innerHeight: 900, addEventListener(type, listener) { windowListeners.set(type, listener); }, postMessage() {} };
pageWindow.window = pageWindow;
pageWindow.top = pageWindow;
const location = { href: "https://x.com/home", hostname: "x.com", pathname: "/home" };
const contentContext = {
  console, window: pageWindow, location, URL, JSON, Object, Array, Map, Set, WeakMap, Promise, Number, String, Boolean, RegExp, Date, Math,
  MutationObserver: class { observe() {} },
  performance: { getEntriesByType: () => [] },
  setTimeout, clearTimeout,
  document: { baseURI: location.href, title: "X", documentElement: {}, addEventListener() {}, querySelectorAll: () => [], querySelector: () => null },
  chrome: { runtime: { lastError: null, onMessage: { addListener(listener) { contentContext.onMessage = listener; } }, sendMessage(message, callback) { runtimeMessages.push(message); callback({ ok: true }); } } }
};
vm.createContext(contentContext);
vm.runInContext(readFileSync("src/content.js", "utf8"), contentContext, { filename: "src/content.js" });
const bridge = windowListeners.get("message");
bridge({ source: pageWindow, data: { source: "vidpocket-x-media-hook", type: "candidates", candidates: [
  { url: "https://video.twimg.com/amplify_video/3000000000000000103/vid/avc1/1080x1920/a.mp4", width: 1080, height: 1920, postId: "3000000000000000003" }
] } });
const beforeChange = runtimeMessages.findLast((message) => message.type === "contentCandidates");
assert.equal(beforeChange.candidates.length, 1);
assert.equal(beforeChange.candidates[0].postId, "3000000000000000003", "X post ids reach the background");
assert.notEqual(beforeChange.pageChanged, true);

location.pathname = "/someone/status/3000000000000000001";
location.href = "https://x.com/someone/status/3000000000000000001";
bridge({ source: pageWindow, data: { source: "vidpocket-x-media-hook", type: "candidates", candidates: [
  { url: "https://video.twimg.com/amplify_video/3000000000000000101/vid/avc1/1080x1920/a.mp4", width: 1080, height: 1920, postId: "3000000000000000001" }
] } });
const afterChange = runtimeMessages.findLast((message) => message.type === "contentCandidates");
assert.equal(afterChange.pageChanged, true, "the first report after a path change tells the background to start over");
assert.deepEqual(afterChange.candidates.map((item) => item.postId), ["3000000000000000001"], "media gathered on the previous path is dropped");

// ---- background: pageChanged resets the tab list ----
const listeners = {};
const backgroundContext = {
  console, URL, Map, Set, Number, String, Boolean, Date, RegExp, Promise, Object, Array, JSON, Math, setTimeout, clearTimeout,
  fetch: async () => ({ ok: true, status: 200, headers: { get: () => "" }, text: async () => "" }),
  chrome: {
    action: { setBadgeBackgroundColor() {}, setBadgeText() {} },
    tabs: { onRemoved: { addListener() {} }, onUpdated: { addListener() {} } },
    webRequest: { onHeadersReceived: { addListener() {} } },
    runtime: { onMessage: { addListener(listener) { listeners.onMessage = listener; } }, getURL: (path) => `chrome-extension://test/${path}`, lastError: null },
    downloads: { download(_options, callback) { callback(1); } }
  }
};
vm.createContext(backgroundContext);
vm.runInContext(readFileSync("src/background.js", "utf8"), backgroundContext, { filename: "src/background.js" });
const send = (message, frameId = 0) => new Promise((resolve) => {
  listeners.onMessage(message, { tab: { id: 7, url: "https://x.com/" }, frameId, url: "https://x.com/" }, resolve);
});
const xCandidate = (mediaId, postId) => ({ url: `https://video.twimg.com/amplify_video/${mediaId}/vid/avc1/1080x1920/a.mp4`, kind: "video", source: "page-api", width: 1080, height: 1920, duration: 13, postId });
await send({ type: "contentCandidates", pageUrl: "https://x.com/home", candidates: [xCandidate("3000000000000000103", "3000000000000000003"), xCandidate("3000000000000000104", "3000000000000000004")] });
assert.equal(backgroundContext.getCandidates(7).length, 2);
await send({ type: "contentCandidates", pageUrl: "https://x.com/home", pageChanged: true, candidates: [] }, 3);
assert.equal(backgroundContext.getCandidates(7).length, 2, "a page change reported by an iframe does not reset the tab");
await send({ type: "contentCandidates", pageUrl: "https://x.com/someone/status/3000000000000000001", pageChanged: true, candidates: [xCandidate("3000000000000000101", "3000000000000000001")] });
const remaining = backgroundContext.getCandidates(7);
assert.deepEqual(remaining.map((item) => item.postId), ["3000000000000000001"], "the top frame's page change starts the tab list over");

console.log(JSON.stringify({
  ok: true,
  assertions: [
    "X media carries its owning tweet id, including quoted tweets",
    "after opening a post from the timeline, the hook rescan reports only that post's video",
    "the content script drops previous-path media and flags the page change",
    "the background resets the tab list on a top-frame page change only"
  ]
}, null, 2));
