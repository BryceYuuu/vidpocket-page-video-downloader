import { readFileSync } from "node:fs";
import vm from "node:vm";

const stubs = new Map();
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
  chrome: {
    tabs: { query() {}, sendMessage() {} },
    runtime: { sendMessage() {}, lastError: null },
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

context.__vidPocketPopupTest.thumbnailCache.set("https://video.twimg.com/one.m3u8", {
  status: "done",
  thumbnail: "data:image/jpeg;base64,REALHLS",
  duration: 15,
  width: 1280,
  height: 720
});
context.__vidPocketPopupTest.thumbnailCache.set("https://video.twimg.com/failed.m3u8", {
  status: "failed",
  error: "403 Forbidden"
});

const displayItems = context.__vidPocketPopupTest.prepareDisplayItems([
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
  }
]);

const firstHls = displayItems.find((item) => item.id === "hls-1");
const secondHls = displayItems.find((item) => item.id === "hls-2");
const failedHls = displayItems.find((item) => item.id === "hls-3");

assert(!displayItems.some((item) => item.kind === "blob"), "BLOB rows should not be shown as download rows");
assert(!displayItems.some((item) => item.kind === "dash"), "DASH rows should stay hidden because this build does not download DASH");
assert(firstHls.thumbnail === "data:image/jpeg;base64,REALHLS", "HLS row should use only its helper-generated thumbnail");
assert(firstHls.duration === 15, "HLS row should absorb helper duration");
assert(firstHls.quality === "720p", "HLS row should infer quality from helper metadata");
assert(!secondHls.thumbnail, "Uncached HLS should not borrow unrelated page thumbnails");
assert(failedHls.previewStatus === "failed", "Failed HLS preview should be explicit");
assert(failedHls.previewError === "403 Forbidden", "Failed HLS preview should keep the helper error");
assert(context.__vidPocketPopupTest.displayName(secondHls).startsWith("X视频"), "Random HLS names should become readable source titles");
assert(!/two/i.test(context.__vidPocketPopupTest.downloadBaseName(secondHls)), "Download filename should not use random m3u8 token");
assert(/^data:image\/svg\+xml/.test(context.__vidPocketPopupTest.infoPlaceholder(secondHls)), "Missing previews should use an information placeholder image");

console.log(JSON.stringify({
  ok: true,
  assertions: [
    "BLOB is hidden instead of exposed as a fake download",
    "DASH is hidden because it is not supported",
    "HLS uses helper-generated preview only",
    "Uncached HLS does not borrow unrelated thumbnails",
    "Preview failure is explicit",
    "Random HLS names are replaced with readable titles",
    "Missing preview uses an information placeholder"
  ]
}, null, 2));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
