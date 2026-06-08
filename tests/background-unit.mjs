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
      onUpdated: { addListener() {} }
    },
    webRequest: {
      onHeadersReceived: {
        addListener(listener) {
          listeners.onHeadersReceived = listener;
        }
      }
    },
    runtime: {
      onMessage: {
        addListener(listener) {
          listeners.onMessage = listener;
        }
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

await delay(50);

const items = context.getCandidates(1);
const full = items.find((item) => item.url.endsWith("/full.mp4"));
const tiny = items.find((item) => item.url.endsWith("/tiny.mp4"));
const hls = items.find((item) => item.url.endsWith("/stream.m3u8"));

assert(full, "full.mp4 should be detected");
assert(full.downloadable === true, "full.mp4 should be downloadable after probe");
assert(full.contentLength === 1128375, "full.mp4 content length should be probed");
assert(!tiny, "tiny 786-byte mp4 should be filtered out");
assert(hls, "HLS playlist should be detected");
assert(hls.downloadable === false, "HLS playlist should not be direct-downloadable");
assert(hls.duration === 9.5, "HLS duration should be read from EXTINF lines");

console.log(JSON.stringify({
  ok: true,
  items,
  assertions: [
    "full MP4 is downloadable after HEAD probe",
    "786-byte pseudo MP4 is filtered out",
    "HLS is detected but not treated as direct MP4",
    "HLS duration is computed from playlist"
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
