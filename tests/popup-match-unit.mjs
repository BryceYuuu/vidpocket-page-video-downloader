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
  },
  {
    id: "threads-720",
    url: "https://scontent-lax3-2.cdninstagram.com/o1/v/t16/f2/m84/clip-a.mp4?_nc_cat=1",
    kind: "video",
    quality: "720p",
    duration: 15,
    width: 1280,
    height: 720,
    thumbnail: "https://scontent-lax3-1.cdninstagram.com/v/t51/cover.jpg",
    label: "@courtside · Every court for the new season",
    mediaId: "4007130374095024395",
    pageUrl: "https://www.threads.com/@courtside/post/DecL9g0nLEL",
    downloadable: true,
    probeStatus: "done"
  },
  {
    id: "threads-1080",
    url: "https://scontent-lax3-2.cdninstagram.com/o1/v/t16/f2/m84/clip-b.mp4?_nc_cat=1",
    kind: "video",
    quality: "1080p",
    duration: 15,
    width: 1920,
    height: 1080,
    thumbnail: "https://scontent-lax3-1.cdninstagram.com/v/t51/cover.jpg",
    label: "@courtside · Every court for the new season",
    mediaId: "4007130374095024395",
    pageUrl: "https://www.threads.com/@courtside/post/DecL9g0nLEL",
    primary: true,
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
assert(
  api.previewImageUrl("https://pbs.twimg.com/amplify_video_thumb/1/img/AbC.jpg") === "https://pbs.twimg.com/amplify_video_thumb/1/img/AbC?format=jpg&name=360x360",
  "X covers should request the small 360x360 rendition"
);
assert(
  api.previewImageUrl("https://pbs.twimg.com/media/AbC?format=jpg&name=small") === "https://pbs.twimg.com/media/AbC?format=jpg&name=small",
  "X covers that already name a size are left alone"
);
assert(
  api.previewImageUrl("https://scontent.cdninstagram.com/v/t51/cover.jpg?stp=x&oh=sig") === "https://scontent.cdninstagram.com/v/t51/cover.jpg?stp=x&oh=sig",
  "signed Meta CDN covers must not be rewritten"
);
const threadsRows = displayItems.filter((item) => item.url.includes("cdninstagram.com"));
assert(threadsRows.length === 1, "Threads renditions of one post video should be displayed once");
assert(threadsRows[0].quality === "1080p", "the highest Threads rendition should be kept");
assert(displayItems[0].url.includes("cdninstagram.com"), "the primary post video should be listed first");
assert(/^@courtside · Every court/.test(threadsRows[0].displayTitle), "Threads rows should use the post author and caption as title");

console.log(JSON.stringify({
  ok: true,
  assertions: [
    "Direct MP4 is shown and remains downloadable",
    "BLOB is hidden instead of exposed as a fake download",
    "DASH is hidden because it is not supported",
    "HLS is shown without requiring a local helper",
    "Generated HLS thumbnails remain URL-specific",
    "opening an exact X status triggers a background media scan independent of page DOM",
    "the same X asset and resolution is deduplicated across page and background discovery",
    "Threads renditions collapse to the best one per media id with the post caption as title"
  ]
}, null, 2));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
