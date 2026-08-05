import { readFileSync } from "node:fs";
import vm from "node:vm";

let nextDownloadId = 40;
const browserDownloads = new Map();
let storedJobs = [];
let offscreenCreated = false;

const context = {
  console,
  URL,
  Map,
  Set,
  Number,
  String,
  Boolean,
  Date,
  Math,
  RegExp,
  Promise,
  setTimeout,
  clearTimeout,
  fetch: async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "" },
    text: async () => "#EXTM3U\n#EXTINF:2,\nseg.ts\n#EXT-X-ENDLIST\n"
  }),
  chrome: {
    action: {
      setBadgeBackgroundColor() {},
      setBadgeText() {}
    },
    tabs: {
      onRemoved: { addListener() {} },
      onUpdated: { addListener() {} },
      sendMessage(_tabId, _message, callback) { callback({ ok: true }); }
    },
    webRequest: {
      onHeadersReceived: { addListener() {} }
    },
    runtime: {
      lastError: null,
      onMessage: { addListener() {} },
      getURL(path) { return `chrome-extension://test/${path}`; },
      async getContexts() { return offscreenCreated ? [{ contextType: "OFFSCREEN_DOCUMENT" }] : []; },
      sendMessage(message, callback) {
        if (message.target === "offscreen") callback({ ok: true, jobId: message.job && message.job.id });
        else callback({ ok: true });
      }
    },
    offscreen: {
      async createDocument() { offscreenCreated = true; }
    },
    storage: {
      local: {
        get(_key, callback) { callback({ vidpocketDownloadJobs: storedJobs }); },
        set(value, callback) {
          storedJobs = value.vidpocketDownloadJobs || [];
          callback();
        }
      }
    },
    downloads: {
      onChanged: { addListener() {} },
      download(options, callback) {
        const id = nextDownloadId++;
        browserDownloads.set(id, {
          id,
          url: options.url,
          state: "in_progress",
          bytesReceived: 0,
          totalBytes: 100000,
          paused: false
        });
        callback(id);
      },
      search({ id }, callback) { callback(browserDownloads.has(id) ? [browserDownloads.get(id)] : []); },
      cancel(id, callback) {
        if (browserDownloads.has(id)) browserDownloads.get(id).state = "interrupted";
        callback();
      }
    }
  }
};

vm.createContext(context);
vm.runInContext(readFileSync("src/background.js", "utf8"), context, { filename: "src/background.js" });

context.addCandidate(7, {
  url: "https://media.test/video.mp4",
  kind: "video",
  source: "dom",
  contentType: "video/mp4",
  contentLength: 100000,
  label: "Article video"
});
context.addCandidate(7, {
  url: "https://media.test/master.m3u8",
  kind: "hls",
  source: "network",
  contentType: "application/x-mpegURL",
  label: "Article stream"
});

const directCandidate = context.getCandidate(7, "https://media.test/video.mp4");
const hlsCandidate = context.getCandidate(7, "https://media.test/master.m3u8");
const directJob = await context.startDirectDownloadJob({
  tabId: 7,
  candidate: directCandidate,
  url: directCandidate.url,
  filename: "Article video.mp4"
});
const hlsJob = await context.startHlsDownloadJob(7, hlsCandidate, "Article stream.mp4");

assert(typeof directJob.downloadId === "number", "direct job should use the Chrome downloads API");
assert(hlsJob.status === "queued", "HLS job should be delegated to the offscreen processor");
assert(offscreenCreated, "HLS should create a packaged offscreen processor");
assert(context.getDownloadJobs(7).length === 2, "download jobs should live in the background instead of the popup");

context.updateDownloadJob(hlsJob.id, {
  status: "downloading",
  progress: 0.42,
  bytesReceived: 42000,
  speed: 21000
});
const persistedHls = context.getDownloadJobs(7).find((job) => job.id === hlsJob.id);
assert(persistedHls.progress === 0.42, "HLS progress should survive popup rerenders");
assert(persistedHls.speed === 21000, "HLS transfer speed should be reported by the background job");

browserDownloads.get(directJob.downloadId).state = "complete";
browserDownloads.get(directJob.downloadId).bytesReceived = 100000;
await context.handleChromeDownloadChanged({ id: directJob.downloadId, state: { current: "complete" } });
const completedDirect = context.getDownloadJobs(7).find((job) => job.id === directJob.id);
assert(completedDirect.status === "complete", "completed Chrome download should remain visible as saved");

await delay(400);
assert(storedJobs.length >= 2, "job history should persist in chrome.storage.local");

console.log(JSON.stringify({
  ok: true,
  assertions: [
    "direct downloads stay on Chrome's native download path",
    "HLS processing runs in a packaged offscreen document",
    "closing the popup does not own or cancel jobs",
    "progress and speed are background state",
    "job status persists in extension storage"
  ]
}, null, 2));

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
