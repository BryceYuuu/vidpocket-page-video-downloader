import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const windowListeners = new Map();
const runtimeMessages = [];
const pageWindow = {
  addEventListener(type, listener) {
    windowListeners.set(type, listener);
  },
  postMessage() {}
};
pageWindow.window = pageWindow;

class MutationObserverStub {
  constructor(callback) {
    this.callback = callback;
  }
  observe() {}
}

const location = {
  href: "https://x.com/OpenAI/status/3000000000000000000",
  hostname: "x.com"
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
    getEntriesByType() { return []; }
  },
  setTimeout,
  clearTimeout,
  document: {
    baseURI: location.href,
    title: "OpenAI on X",
    documentElement: {},
    addEventListener() {},
    querySelectorAll() { return []; },
    querySelector() { return null; }
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
vm.runInContext(readFileSync("src/content.js", "utf8"), context, {
  filename: "src/content.js"
});

const syndicationRequest = runtimeMessages.find((message) => message && message.type === "scanXTweets");
assert.ok(syndicationRequest, "content script should request a background X fallback scan");
assert.deepEqual(Array.from(syndicationRequest.tweetIds), ["3000000000000000000"]);

const bridgeListener = windowListeners.get("message");
assert.equal(typeof bridgeListener, "function", "content script should listen for X media bridge messages");

bridgeListener({
  source: pageWindow,
  data: {
    source: "vidpocket-x-media-hook",
    type: "candidates",
    candidates: [
      {
        url: "https://video.twimg.com/ext_tw_video/3000000000000000000/pu/vid/1280x720/intercepted.mp4?tag=12",
        kind: "video",
        label: "OpenAI product demo",
        duration: 22,
        width: 1280,
        height: 720,
        quality: "720p",
        format: "MP4",
        thumbnail: "https://pbs.twimg.com/ext_tw_video_thumb/3000000000000000000/pu/img/intercepted.jpg",
        bitrate: 2176000
      },
      {
        url: "https://evil.example/fake.mp4",
        kind: "video",
        thumbnail: "https://evil.example/fake.jpg"
      }
    ]
  }
});

const payload = runtimeMessages.findLast((message) => message && message.type === "contentCandidates" && message.candidates.some((item) => item.url.includes("intercepted.mp4")));
assert.ok(payload, "content script should relay accepted X MP4 variants to the extension background");
assert.equal(payload.candidates.length, 1, "untrusted non-X bridge URLs should be discarded");
const candidate = payload.candidates[0];
assert.equal(candidate.contentType, "video/mp4");
assert.equal(candidate.duration, 22);
assert.equal(candidate.width, 1280);
assert.equal(candidate.height, 720);
assert.equal(candidate.quality, "720p");
assert.equal(candidate.thumbnail, "https://pbs.twimg.com/ext_tw_video_thumb/3000000000000000000/pu/img/intercepted.jpg");

console.log(JSON.stringify({
  ok: true,
  candidate,
  assertions: [
    "isolated content script receives X page-world media events",
    "current X status id is sent to the background fallback scanner",
    "only HTTPS video.twimg.com candidates are accepted",
    "matching title, thumbnail, duration, and quality reach the extension background"
  ]
}, null, 2));
