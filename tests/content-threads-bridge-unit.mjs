import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const windowListeners = new Map();
const runtimeMessages = [];
const postedMessages = [];
const pageWindow = {
  innerWidth: 1280,
  innerHeight: 900,
  addEventListener(type, listener) {
    windowListeners.set(type, listener);
  },
  postMessage(message) {
    postedMessages.push(message);
  }
};
pageWindow.window = pageWindow;

class MutationObserverStub {
  observe() {}
}

const location = {
  href: "https://www.threads.com/@courtside/post/DecL9g0nLEL",
  hostname: "www.threads.com",
  pathname: "/@courtside/post/DecL9g0nLEL"
};

const videoUrl = "https://scontent-lax3-2.cdninstagram.com/o1/v/t16/f2/m84/clip.mp4?_nc_cat=1&oh=sig&oe=6AD92B6A";
const coverUrl = "https://scontent-lax3-1.cdninstagram.com/v/t51.71878-15/cover.jpg?stp=dst-jpg_e15";

// A playing <video> on the page: the DOM scan sees the same URL with a generic label.
const videoElement = {
  tagName: "VIDEO",
  currentSrc: videoUrl,
  src: videoUrl,
  poster: "",
  videoWidth: 1280,
  videoHeight: 720,
  duration: 15,
  readyState: 1,
  textContent: "",
  getAttribute(name) {
    return name === "aria-label" ? "Video player" : null;
  },
  querySelectorAll() {
    return [];
  },
  getBoundingClientRect() {
    return { left: 100, top: 100, right: 740, bottom: 460 };
  }
};

const context = {
  console,
  window: pageWindow,
  location,
  URL,
  JSON,
  Object,
  Array,
  Map,
  Set,
  WeakMap,
  Promise,
  Number,
  String,
  Boolean,
  RegExp,
  Date,
  Math,
  MutationObserver: MutationObserverStub,
  performance: {
    getEntriesByType() {
      return [{ name: `${videoUrl}&bytestart=0&byteend=4095` }];
    }
  },
  setTimeout,
  clearTimeout,
  document: {
    baseURI: location.href,
    title: "Threads",
    documentElement: { clientWidth: 1280, clientHeight: 900 },
    addEventListener() {},
    querySelectorAll(selector) {
      return /video/.test(selector) ? [videoElement] : [];
    },
    querySelector() {
      return null;
    }
  },
  chrome: {
    runtime: {
      lastError: null,
      onMessage: { addListener() {} },
      sendMessage(message, callback) {
        runtimeMessages.push(message);
        callback({ ok: true });
      }
    }
  }
};

vm.createContext(context);
vm.runInContext(readFileSync("src/content.js", "utf8"), context, { filename: "src/content.js" });

assert.ok(
  postedMessages.some((message) => message && message.type === "scan-threads-media"),
  "content script asks the Threads page hook to rescan on load"
);

const bridgeListener = windowListeners.get("message");
bridgeListener({
  source: pageWindow,
  data: {
    source: "vidpocket-threads-media-hook",
    type: "candidates",
    candidates: [
      {
        url: videoUrl,
        label: "@courtside · Every court for the new season",
        duration: 15,
        width: 1280,
        height: 720,
        quality: "720p",
        thumbnail: coverUrl,
        mediaId: "4007130374095024395",
        postCode: "DecL9g0nLEL",
        contentType: "video/mp4"
      },
      {
        url: "https://scontent-lax3-2.cdninstagram.com/o1/v/t16/f2/m84/reply.mp4?_nc_cat=1",
        label: "@someone · a reply video",
        width: 720,
        height: 1280,
        mediaId: "1",
        postCode: "ReplyCode"
      },
      { url: "https://evil.example/fake.mp4", label: "fake" },
      { url: "https://scontent.cdninstagram.com/o1/v/clip.mp4", thumbnail: "https://evil.example/cover.jpg" }
    ]
  }
});

const payload = runtimeMessages.findLast((message) => message && message.type === "contentCandidates");
assert.ok(payload, "page with a <video> element still relays candidates (visibleArea regression)");
const urls = payload.candidates.map((item) => item.url);
assert.ok(!urls.some((url) => url.includes("evil.example")), "non-Meta bridge URLs are dropped");

const candidate = payload.candidates.find((item) => item.url === videoUrl);
assert.ok(candidate, "Threads video reaches the background");
assert.equal(candidate.label, "@courtside · Every court for the new season", "post caption beats the generic DOM label");
assert.equal(candidate.mediaId, "4007130374095024395", "post media id beats the DOM element id");
assert.equal(candidate.thumbnail, coverUrl);
assert.equal(candidate.contentType, "video/mp4");
assert.ok(candidate.source.includes("page-api") && candidate.source.includes("dom"));
assert.equal(candidate.primary, true, "the video of the post in the URL is marked primary");
const reply = payload.candidates.find((item) => item.url.includes("reply.mp4"));
assert.equal(reply.primary, false, "videos from other posts on the page are not primary");

const untrustedCover = payload.candidates.find((item) => item.url === "https://scontent.cdninstagram.com/o1/v/clip.mp4");
assert.ok(untrustedCover, "Meta CDN video without metadata is still relayed");
assert.equal(untrustedCover.thumbnail, "", "non-Meta thumbnails are stripped");

console.log(JSON.stringify({
  ok: true,
  assertions: [
    "content script requests a Threads hook scan",
    "pages with <video> elements relay candidates without throwing",
    "only Meta CDN URLs and thumbnails are accepted from the Threads bridge",
    "Threads caption, media id, and cover win over generic DOM values"
  ]
}, null, 2));
