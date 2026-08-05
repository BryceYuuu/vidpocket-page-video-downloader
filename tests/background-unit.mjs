import { readFileSync } from "node:fs";
import vm from "node:vm";

const listeners = {
  onHeadersReceived: null,
  onMessage: null
};

const context = {
  console,
  URL,
  Map,
  Set,
  Number,
  String,
  Boolean,
  Date,
  RegExp,
  Promise,
  setTimeout,
  clearTimeout,
  fetch: async (url) => {
    const headers = new Map();
    let body = "";
    if (String(url).endsWith("/full.mp4")) {
      headers.set("content-type", "video/mp4");
      headers.set("content-length", "1128375");
    } else if (String(url).endsWith("/tiny.mp4")) {
      headers.set("content-type", "video/mp4");
      headers.set("content-length", "786");
    } else if (String(url).endsWith("/stream.m3u8")) {
      headers.set("content-type", "application/x-mpegURL");
      body = "#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXTINF:5,\nseg0.ts\n#EXTINF:4.5,\nseg1.ts\n#EXT-X-ENDLIST\n";
      headers.set("content-length", String(body.length));
    }
    return {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          return headers.get(String(name).toLowerCase()) || "";
        }
      },
      text: async () => body
    };
  },
  chrome: {
    action: {
      setBadgeBackgroundColor() {},
      setBadgeText() {}
    },
    tabs: {
      onRemoved: { addListener() {} },
      onUpdated: { addListener() {} },
      create() {}
    },
    webRequest: {
      onHeadersReceived: {
        addListener(listener) {
          listeners.onHeadersReceived = listener;
        }
      }
    },
    runtime: {
      onInstalled: { addListener() {} },
      onMessage: {
        addListener(listener) {
          listeners.onMessage = listener;
        }
      },
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      lastError: null
    },
    downloads: {
      download(_options, callback) {
        callback(1);
      }
    }
  }
};

vm.createContext(context);
vm.runInContext(readFileSync("src/background.js", "utf8"), context, {
  filename: "src/background.js"
});

context.addCandidate(1, {
  url: "http://media.test/full.mp4",
  kind: "video",
  source: "dom",
  format: "MP4"
});
context.addCandidate(1, {
  url: "http://media.test/tiny.mp4",
  kind: "video",
  source: "dom",
  format: "MP4"
});
context.addCandidate(1, {
  url: "http://media.test/stream.m3u8",
  kind: "hls",
  source: "dom",
  format: "HLS"
});
context.addCandidate(1, {
  url: "https://video.twimg.com/ext_tw_video/1527322141724532740/pu/vid/720x1280/high.mp4?tag=12",
  kind: "video",
  source: "page-api",
  format: "MP4",
  contentType: "video/mp4",
  duration: 136.5,
  width: 720,
  height: 1280,
  quality: "1280p",
  thumbnail: "https://pbs.twimg.com/ext_tw_video_thumb/1527322141724532740/pu/img/example.jpg"
});

await delay(50);

const items = context.getCandidates(1);
const full = items.find((item) => item.url.endsWith("/full.mp4"));
const tiny = items.find((item) => item.url.endsWith("/tiny.mp4"));
const hls = items.find((item) => item.url.endsWith("/stream.m3u8"));
const xMp4 = items.find((item) => item.url.includes("video.twimg.com") && item.url.includes("high.mp4"));

assert(full, "full.mp4 should be detected");
assert(full.downloadable === true, "full.mp4 should be downloadable after probe");
assert(full.contentLength === 1128375, "full.mp4 content length should be probed");
assert(!tiny, "tiny 786-byte mp4 should be filtered out");
assert(hls, "HLS playlist should be detected");
assert(hls.downloadable === false, "HLS playlist should not be direct-downloadable");
assert(hls.duration === 9.5, "HLS duration should be read from EXTINF lines");
assert(xMp4, "X direct MP4 variant should be detected");
assert(xMp4.downloadable === true, "X direct MP4 variant should be immediately downloadable");
assert(xMp4.thumbnail.includes("pbs.twimg.com"), "X direct MP4 should retain its matching thumbnail");
assert(xMp4.duration === 136.5, "X direct MP4 should retain its duration");

console.log(JSON.stringify({
  ok: true,
  items,
  assertions: [
    "full MP4 is downloadable after HEAD probe",
    "786-byte pseudo MP4 is filtered out",
    "HLS is detected but not treated as direct MP4",
    "HLS duration is computed from playlist",
    "X API MP4 variants remain downloadable with matching metadata"
  ]
}, null, 2));

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
