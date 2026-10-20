import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const efg = (value) => Buffer.from(JSON.stringify(value)).toString("base64");
const cdn = (name, extra = "") => `https://scontent-lax3-2.cdninstagram.com/o1/v/t16/f2/m84/${name}.mp4?_nc_cat=1&efg=${encodeURIComponent(efg({ vencode_tag: "xpv_progressive.INSTAGRAM.FEED.C3.1280.dash_baseline_1_v1", duration_s: 15 }))}&oh=sig&oe=6AD92B6A${extra}`;
const cover = (name) => `https://scontent-lax3-1.cdninstagram.com/v/t51.71878-15/${name}.jpg?stp=dst-jpg_e15`;

// Shape mirrors the embedded Threads relay payload: require -> __bbox -> result -> thread_items -> post.
function relayPayload(posts) {
  return {
    require: [["ScheduledServerJS", "handle", null, [{
      __bbox: {
        require: [["RelayPrefetchedStreamCache", "next", [], ["adp_key", {
          __bbox: { result: { data: { mediaData: { edges: posts.map((post) => ({ node: { thread_items: [{ post }] } })) } } } }
        }]]]
      }
    }]]]
  };
}

const singlePost = {
  pk: "4007130374095024395",
  id: "4007130374095024395_63098420488",
  code: "DecL9g0nLEL",
  media_type: 2,
  original_width: 1280,
  original_height: 720,
  caption: { text: "Every court for the new season" },
  user: { username: "courtside" },
  // Real payloads list the full-size cover first; the popup only needs a ~320px one.
  image_versions2: { candidates: [
    { width: 1080, height: 608, url: cover("single-1080") },
    { width: 640, height: 360, url: cover("single-640") },
    { width: 320, height: 180, url: cover("single") },
    { width: 150, height: 150, url: cover("single-150") }
  ] },
  video_versions: [
    { type: 101, url: cdn("single") },
    { type: 102, url: cdn("single") },
    { type: 103, url: "https://evil.example/fake.mp4" }
  ],
  // Some UI nodes carry a plain "text" field; it must not become the clip title.
  text_post_app_info: { reply_control: { text: "Reply" } }
};

const carouselPost = {
  pk: "4011821957594897000",
  code: "CarouselCode",
  media_type: 8,
  caption: { text: "Highlights from game two" },
  user: { username: "leaguehoops" },
  video_versions: null,
  carousel_media: [{
    pk: "4011821957594897094",
    id: "4011821957594897094_63305274175",
    media_type: 2,
    original_width: 776,
    original_height: 962,
    image_versions2: { candidates: [{ width: 776, height: 962, url: cover("carousel") }] },
    video_dash_manifest: '<?xml version="1.0"?><MPD mediaPresentationDuration="PT1M0.5S"></MPD>',
    video_versions: [{ type: 101, url: cdn("carousel").replace(/efg=[^&]+/, "efg=") }]
  }]
};

const byteRangePost = {
  pk: "999",
  media_type: 2,
  original_width: 640,
  original_height: 360,
  video_versions: [{ type: 101, url: cdn("segment", "&bytestart=0&byteend=1023") }]
};

function FakeXhr() {
  this.listeners = {};
}
FakeXhr.prototype.open = function () {};
FakeXhr.prototype.send = function () {};
FakeXhr.prototype.addEventListener = function (type, listener) {
  this.listeners[type] = listener;
};
FakeXhr.prototype.getResponseHeader = function (name) {
  return String(name).toLowerCase() === "content-type" ? "text/javascript; charset=utf-8" : "";
};

const bridgeMessages = [];
const scripts = Array.from({ length: 50 }, (_, index) => ({
  textContent: index === 45 ? JSON.stringify(relayPayload([singlePost])) : JSON.stringify({ filler: index })
}));
const streamedBody = `for (;;);${JSON.stringify({ data: { experiments: [] } })}\n${JSON.stringify(relayPayload([carouselPost]))}`;

const pageWindow = {
  __vidPocketThreadsMediaHookTestMode: true,
  fetch() {
    return Promise.resolve({
      url: "https://www.threads.com/graphql/query",
      headers: { get: (name) => (String(name).toLowerCase() === "content-type" ? "text/javascript; charset=utf-8" : "") },
      clone() {
        return { text: async () => streamedBody };
      }
    });
  },
  XMLHttpRequest: FakeXhr,
  addEventListener() {},
  postMessage(message) {
    bridgeMessages.push(message);
  },
  document: {
    readyState: "complete",
    querySelectorAll: () => scripts
  }
};

const context = {
  window: pageWindow,
  URL,
  JSON,
  Map,
  Set,
  WeakSet,
  Array,
  Object,
  Number,
  String,
  Math,
  RegExp,
  Promise,
  Symbol,
  atob,
  setTimeout,
  clearTimeout
};
vm.createContext(context);
vm.runInContext(readFileSync("src/threads-media-hook.js", "utf8"), context, { filename: "src/threads-media-hook.js" });
const api = pageWindow.__vidPocketThreadsMediaHookTestApi;
assert.ok(api, "test API should be exposed in test mode");

const singles = api.extractThreadsMediaCandidates(relayPayload([singlePost]));
assert.equal(singles.length, 1, "duplicate renditions collapse by URL and non-Meta URLs are dropped");
const single = singles[0];
assert.equal(single.label, "@courtside · Every court for the new season");
assert.equal(single.mediaId, "4007130374095024395");
assert.equal(single.postCode, "DecL9g0nLEL", "the owning post shortcode travels with the video");
assert.equal(single.width, 1280);
assert.equal(single.height, 720);
assert.equal(single.quality, "720p");
assert.equal(single.duration, 15, "duration falls back to the efg duration_s value");
assert.equal(single.thumbnail, cover("single"), "the smallest cover at least 320px wide is used");
assert.equal(single.contentType, "video/mp4");

const carousel = api.extractThreadsMediaCandidates(relayPayload([carouselPost]));
assert.equal(carousel.length, 1);
assert.equal(carousel[0].label, "@leaguehoops · Highlights from game two", "carousel items inherit the parent caption and author");
assert.equal(carousel[0].mediaId, "4011821957594897094");
assert.equal(carousel[0].postCode, "CarouselCode", "carousel videos carry the parent post shortcode");
assert.equal(carousel[0].quality, "776p", "portrait clips use the short side for quality");
assert.equal(carousel[0].duration, 60.5, "DASH manifest duration is used when present");
assert.equal(carousel[0].thumbnail, cover("carousel"));

assert.equal(api.extractThreadsMediaCandidates(relayPayload([byteRangePost])).length, 0, "DASH byte-range slices are not offered as downloads");
assert.equal(api.sanitizeThreadsMediaUrl("http://scontent.cdninstagram.com/insecure.mp4"), "");
assert.equal(api.sanitizeThreadsMediaUrl("https://cdninstagram.com.evil.example/x.mp4"), "");

const streamedPayloads = api.parsePayloadText(streamedBody);
assert.equal(streamedPayloads.length, 1, "for(;;) prefix is stripped and only media-bearing JSON lines are parsed");
assert.ok(streamedPayloads[0].require, "the media line of a newline-delimited response is recovered");

await new Promise((resolve) => setTimeout(resolve, 300));
const scanMessage = bridgeMessages.find((message) => message.candidates.some((item) => item.mediaId === singlePost.pk));
assert.ok(scanMessage, "existing-page scan reads JSON script tags beyond the first 40");

await pageWindow.fetch("https://www.threads.com/graphql/query");
await new Promise((resolve) => setTimeout(resolve, 10));
assert.ok(
  bridgeMessages.some((message) => message.candidates.some((item) => item.mediaId === "4011821957594897094")),
  "fetch hook relays videos from streamed GraphQL responses"
);

const xhr = new pageWindow.XMLHttpRequest();
xhr.open("POST", "https://www.threads.com/api/graphql");
xhr.send();
xhr.responseType = "";
xhr.responseText = `for (;;);${JSON.stringify(relayPayload([{ ...singlePost, pk: "555", video_versions: [{ url: cdn("xhr") }] }]))}`;
xhr.listeners.load();
assert.ok(
  bridgeMessages.some((message) => message.candidates.some((item) => item.mediaId === "555")),
  "XHR hook relays videos from text responses"
);

console.log(JSON.stringify({
  ok: true,
  assertions: [
    "Threads relay payload videos are extracted with caption, author, cover, size, and duration",
    "carousel videos inherit caption and author and keep their own media id",
    "DASH byte-range slices, insecure URLs, and non-Meta hosts are rejected",
    "for(;;) prefixed and newline-delimited responses are parsed",
    "existing-page scan covers JSON script tags past the first 40",
    "fetch and XHR hooks relay Threads videos to the content script"
  ]
}, null, 2));
