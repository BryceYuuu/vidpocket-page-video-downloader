import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function FakeXhr() {}
FakeXhr.prototype.open = function () {};
FakeXhr.prototype.send = function () {};

const bridgeMessages = [];
const interceptedPayload = {
  includes: {
    media: [
      {
        duration_ms: 8000,
        preview_image_url: "https://pbs.twimg.com/media/intercepted.jpg",
        variants: [
          {
            bit_rate: 832000,
            content_type: "video/mp4",
            url: "https://video.twimg.com/ext_tw_video/3000000000000000000/pu/vid/1280x720/intercepted.mp4?tag=12"
          }
        ]
      }
    ]
  }
};

const pageWindow = {
  __vidPocketXMediaHookTestMode: true,
  fetch() {
    return Promise.resolve({
      url: "https://x.com/i/api/graphql/test/TweetDetail",
      headers: {
        get(name) {
          if (String(name).toLowerCase() === "content-type") {
            return "application/json";
          }
          if (String(name).toLowerCase() === "content-length") {
            return "1024";
          }
          return "";
        }
      },
      clone() {
        return { text: async () => JSON.stringify(interceptedPayload) };
      }
    });
  },
  XMLHttpRequest: FakeXhr,
  addEventListener() {},
  postMessage(message) { bridgeMessages.push(message); },
  document: {
    readyState: "loading",
    addEventListener() {},
    querySelectorAll() { return []; }
  }
};
pageWindow.window = pageWindow;

const context = {
  window: pageWindow,
  URL,
  JSON,
  Object,
  Array,
  Map,
  Set,
  WeakSet,
  Symbol,
  Promise,
  Number,
  String,
  RegExp,
  Date,
  setTimeout,
  clearTimeout
};

vm.createContext(context);
vm.runInContext(readFileSync("src/x-media-hook.js", "utf8"), context, {
  filename: "src/x-media-hook.js"
});

const api = pageWindow.__vidPocketXMediaHookTestApi;
assert.ok(api, "X media parser test API should be available");

const candidates = api.extractXMediaCandidates({
  data: {
    tweet: {
      legacy: {
        full_text: "A field report from the farm",
        extended_entities: {
          media: [
            {
              id_str: "1527322141724532740",
              media_url_https: "https://pbs.twimg.com/ext_tw_video_thumb/1527322141724532740/pu/img/example.jpg",
              video_info: {
                duration_millis: 136500,
                variants: [
                  {
                    bitrate: 256000,
                    content_type: "video/mp4",
                    url: "https://video.twimg.com/ext_tw_video/1527322141724532740/pu/vid/320x568/low.mp4?tag=12"
                  },
                  {
                    bitrate: 2176000,
                    content_type: "video/mp4",
                    url: "https://video.twimg.com/ext_tw_video/1527322141724532740/pu/vid/720x1280/high.mp4?tag=12"
                  },
                  {
                    content_type: "application/x-mpegURL",
                    url: "https://video.twimg.com/ext_tw_video/1527322141724532740/pu/pl/master.m3u8?tag=12"
                  }
                ]
              }
            }
          ]
        }
      }
    }
  },
  includes: {
    media: [
      {
        media_key: "13_2000000000000000000",
        width: 1920,
        height: 1080,
        duration_ms: 42500,
        preview_image_url: "https://pbs.twimg.com/media/preview.jpg",
        variants: [
          {
            bit_rate: 5000000,
            content_type: "video/mp4",
            url: "https://video.twimg.com/amplify_video/2000000000000000000/vid/avc1/1920x1080/report.mp4?tag=21"
          }
        ]
      }
    ]
  }
});

assert.equal(candidates.length, 4, "all unique X MP4 and HLS variants should be extracted");

const high = candidates.find((item) => item.url.includes("/720x1280/high.mp4"));
assert.ok(high, "high-quality direct MP4 should be present");
assert.equal(high.kind, "video");
assert.equal(high.format, "MP4");
assert.equal(high.width, 720);
assert.equal(high.height, 1280);
assert.equal(high.quality, "1280p");
assert.equal(high.duration, 136.5);
assert.equal(high.bitrate, 2176000);
assert.equal(high.thumbnail, "https://pbs.twimg.com/ext_tw_video_thumb/1527322141724532740/pu/img/example.jpg");

const v2 = candidates.find((item) => item.url.includes("/1920x1080/report.mp4"));
assert.ok(v2, "X API v2 media variants should be extracted");
assert.equal(v2.duration, 42.5);
assert.equal(v2.quality, "1080p");
assert.equal(v2.thumbnail, "https://pbs.twimg.com/media/preview.jpg");

assert.equal(api.sanitizeXMediaUrl("https://example.com/fake.mp4"), "", "non-X media URLs must be rejected by the page bridge");
assert.equal(api.sanitizeXMediaUrl("http://video.twimg.com/insecure.mp4"), "", "insecure media URLs must be rejected");

await pageWindow.fetch("https://x.com/i/api/graphql/test/TweetDetail");
await new Promise((resolve) => setTimeout(resolve, 10));
const interceptedMessage = bridgeMessages.find((message) => message && Array.isArray(message.candidates) && message.candidates.some((item) => item.url.includes("intercepted.mp4")));
assert.ok(interceptedMessage, "fetch hook should relay MP4 variants from an X JSON response");

console.log(JSON.stringify({
  ok: true,
  candidates,
  assertions: [
    "legacy X video_info MP4 variants are extracted",
    "X API v2 media variants are extracted",
    "duration, quality, bitrate, and matching thumbnail are preserved",
    "X fetch responses relay MP4 variants to the isolated content script",
    "the page bridge only accepts HTTPS video.twimg.com media URLs"
  ]
}, null, 2));
