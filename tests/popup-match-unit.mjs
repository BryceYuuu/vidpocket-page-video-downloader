import { readFileSync } from "node:fs";
import vm from "node:vm";

const stubs = new Map();
const runtimeMessages = [];
function element() {
  return {
    textContent: "",
    hidden: false,
    addEventListener() {},
    querySelector() { return element(); },
    appendChild() {},
    classList: { add() {} },
    removeAttribute() {},
    set title(_value) {},
    set src(_value) {}
  };
}

const context = {
  console,
  URL,
  Number,
  String,
  Boolean,
  RegExp,
  Promise,
  Map,
  Set,
  setTimeout,
  clearTimeout,
  document: {
    getElementById(id) {
      if (!stubs.has(id)) {
        stubs.set(id, element());
      }
      return stubs.get(id);
    },
    addEventListener() {}
  },
  window: {
    addEventListener() {}
  },
  chrome: {
    tabs: { query() {}, sendMessage() {} },
    runtime: {
      sendMessage(message, callback) {
        runtimeMessages.push(message);
        callback({ ok: true, requested: 1, found: 6 });
      },
      lastError: null
    },
    downloads: { download(_options, callback) { callback(1); } }
  },
  navigator: {
    clipboard: { writeText() {} }
  },
  fetch: async () => ({ ok: false, json: async () => ({ ok: false }) })
};

vm.createContext(context);
vm.runInContext(readFileSync("src/popup.js", "utf8"), context, {
  filename: "src/popup.js"
});

const api = context.__VIDPOCKET_POPUP_TEST_API__;
assert(
  api.xTweetIdFromUrl("https://x.com/MiniMax_AI/status/2084106804032872591") === "2084106804032872591",
  "the popup should extract the exact X status id"
);
assert(
  api.xTweetIdFromUrl("https://example.com/status/2084106804032872591") === "",
  "non-X status URLs must not trigger the X fallback"
);
await api.requestActiveXStatusScan({
  id: 17,
  url: "https://x.com/MiniMax_AI/status/2084106804032872591",
  title: "MiniMax (official) on X"
});
const directScan = runtimeMessages.find((message) => message && message.type === "scanXTweets");
assert(Array.from(directScan.tweetIds).join(",") === "2084106804032872591", "the direct scan should send the exact tweet id");
assert(directScan.tabId === 17, "the direct scan should stay associated with the active tab");
api.thumbnailCache.set("https://video.twimg.com/one.m3u8", "data:image/jpeg;base64,REALHLS");

const displayItems = api.prepareDisplayItems([
  {
    id: "mp4-1",
    url: "https://cdn.example.com/course/video.mp4",
    kind: "video",
    quality: "1080p",
    duration: 42,
    width: 1920,
    height: 1080,
    thumbnail: "data:image/jpeg;base64,MP4FRAME",
    label: "course video.mp4",
    downloadable: true,
    probeStatus: "done"
  },
  {
    id: "blob-1",
    url: "blob:https://x.com/1",
    kind: "blob",
    quality: "720p",
    duration: 15,
    width: 1280,
    height: 720,
    thumbnail: "data:image/jpeg;base64,PAGEFRAME",
    label: "Embedded video",
    mediaId: "media-1"
  },
  {
    id: "hls-1",
    url: "https://video.twimg.com/one.m3u8",
    kind: "hls",
    quality: "",
    duration: 0,
    width: 0,
    height: 0,
    thumbnail: "",
    label: "one.m3u8"
  },
  {
    id: "hls-2",
    url: "https://video.twimg.com/two.m3u8",
    kind: "hls",
    quality: "1440p",
    duration: 15,
    width: 2560,
    height: 1440,
    thumbnail: "",
    label: "two.m3u8"
  },
  {
    id: "hls-3",
    url: "https://video.twimg.com/failed.m3u8",
    kind: "hls",
    quality: "720p",
    duration: 15,
    width: 1280,
    height: 720,
    thumbnail: "",
    label: "failed.m3u8"
  },
  {
    id: "dash-1",
    url: "https://media.test/video.mpd",
    kind: "dash",
    label: "video.mpd"
  },
  {
    id: "x-duplicate-a",
    url: "https://video.twimg.com/amplify_video/123456/vid/avc1/1280x720/random-a.mp4?tag=12",
    kind: "video",
    quality: "720p",
    duration: 18,
    width: 1280,
    height: 720,
    thumbnail: "https://pbs.twimg.com/amplify_video_thumb/123456/img/preview.jpg",
    label: "random-a.mp4",
    downloadable: true,
    probeStatus: "done"
  },
  {
    id: "x-duplicate-b",
    url: "https://video.twimg.com/amplify_video/123456/vid/avc1/1280x720/random-b.mp4",
    kind: "video",
    quality: "720p",
    duration: 18,
    width: 1280,
    height: 720,
    thumbnail: "https://pbs.twimg.com/amplify_video_thumb/123456/img/preview.jpg",
    label: "Product launch demo",
    downloadable: true,
    probeStatus: "done"
  }
]);

const firstHls = displayItems.find((item) => item.id === "hls-1");
const secondHls = displayItems.find((item) => item.id === "hls-2");
const failedHls = displayItems.find((item) => item.id === "hls-3");
const directMp4 = displayItems.find((item) => item.id === "mp4-1");

assert(directMp4, "Direct MP4 rows should be shown");
assert(directMp4.downloadable === true, "Direct MP4 rows should remain downloadable");
assert(!displayItems.some((item) => item.kind === "blob"), "BLOB rows should not be shown as download rows");
assert(!displayItems.some((item) => item.kind === "dash"), "DASH rows should stay hidden because this build does not download DASH");
assert(firstHls && secondHls && failedHls, "HLS rows should be shown as extension-local download rows");
assert(firstHls.thumbnail.includes("REALHLS"), "A generated HLS thumbnail should stay attached to its own URL");
assert(displayItems.filter((item) => item.url.includes("/amplify_video/123456/")).length === 1, "matching X renditions should not be displayed twice");

console.log(JSON.stringify({
  ok: true,
  assertions: [
    "Direct MP4 is shown and remains downloadable",
    "BLOB is hidden instead of exposed as a fake download",
    "DASH is hidden because it is not supported",
    "HLS is shown without requiring a local helper",
    "Generated HLS thumbnails remain URL-specific",
    "opening an exact X status triggers a background media scan independent of page DOM",
    "the same X asset and resolution is deduplicated across page and background discovery"
  ]
}, null, 2));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
