import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const tweetId = "2084106804032872591";
const preview = "https://pbs.twimg.com/amplify_video_thumb/2084105994301501440/img/CSEfiQF3Na0AEs9h.jpg";
const payload = {
  __typename: "Tweet",
  id_str: tweetId,
  text: "MiniMax-H3 Is Now Publicly Available\nhttps://t.co/x24nyGoKt8 https://t.co/oJXDeOTQvZ",
  mediaDetails: [{
    media_url_https: preview,
    original_info: { width: 3840, height: 2160 },
    video_info: {
      duration_millis: 41513,
      variants: [
        { content_type: "application/x-mpegURL", url: "https://video.twimg.com/amplify_video/2084105994301501440/pl/stream.m3u8" },
        { bitrate: 256000, content_type: "video/mp4", url: "https://video.twimg.com/amplify_video/2084105994301501440/vid/avc1/480x270/low.mp4" },
        { bitrate: 832000, content_type: "video/mp4", url: "https://video.twimg.com/amplify_video/2084105994301501440/vid/avc1/640x360/medium.mp4" },
        { bitrate: 2176000, content_type: "video/mp4", url: "https://video.twimg.com/amplify_video/2084105994301501440/vid/avc1/1280x720/high.mp4" },
        { bitrate: 10368000, content_type: "video/mp4", url: "https://video.twimg.com/amplify_video/2084105994301501440/vid/avc1/1920x1080/full-hd.mp4" },
        { bitrate: 25128000, content_type: "video/mp4", url: "https://video.twimg.com/amplify_video/2084105994301501440/vid/avc1/3840x2160/ultra-hd.mp4" },
        { bitrate: 99999999, content_type: "video/mp4", url: "https://evil.example/fake.mp4" }
      ]
    }
  }]
};

const requestedUrls = [];
const context = {
  console,
  URL,
  Map,
  Set,
  WeakSet,
  Number,
  String,
  Boolean,
  BigInt,
  Date,
  RegExp,
  Promise,
  Math,
  JSON,
  Object,
  Array,
  setTimeout,
  clearTimeout,
  fetch: async (url) => {
    requestedUrls.push(String(url));
    if (String(url).startsWith("https://cdn.syndication.twimg.com/tweet-result")) {
      const body = JSON.stringify(payload);
      return response(200, "application/json", body);
    }
    if (String(url).includes("stream.m3u8")) {
      return response(200, "application/x-mpegURL", "#EXTM3U\n#EXTINF:41.513,\nsegment.ts\n#EXT-X-ENDLIST\n");
    }
    return response(404, "text/plain", "");
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
      onHeadersReceived: { addListener() {} }
    },
    runtime: {
      onMessage: { addListener() {} },
      getURL(path) { return `chrome-extension://test/${path}`; },
      lastError: null
    },
    downloads: {}
  }
};

vm.createContext(context);
vm.runInContext(readFileSync("src/background.js", "utf8"), context, {
  filename: "src/background.js"
});

const scan = await context.scanXTweetIds(7, [tweetId], {
  pageUrl: `https://x.com/MiniMax_AI/status/${tweetId}`,
  pageTitle: "MiniMax (official) on X"
});
await delay(20);

assert.equal(scan.ok, true);
assert.equal(scan.requested, 1);
assert.equal(scan.found, 6, "one HLS and five MP4 variants should be recovered");

const items = context.getCandidates(7);
assert.equal(items.length, 6);
const directItems = items.filter((item) => item.kind === "video");
const hls = items.find((item) => item.kind === "hls");
const ultraHd = items.find((item) => item.url.includes("3840x2160"));

assert.equal(directItems.length, 5);
assert.ok(directItems.every((item) => item.downloadable), "all recovered MP4 variants should be directly downloadable");
assert.ok(hls, "the public HLS playlist should be preserved");
assert.ok(ultraHd, "the 2160p MP4 variant should be present");
assert.equal(ultraHd.quality, "2160p");
assert.equal(ultraHd.width, 3840);
assert.equal(ultraHd.height, 2160);
assert.equal(ultraHd.duration, 41.513);
assert.equal(ultraHd.thumbnail, preview);
assert.equal(ultraHd.label, "MiniMax-H3 Is Now Publicly Available");
assert.ok(items.every((item) => !item.url.includes("evil.example")), "non-X media hosts must be rejected");

const endpoint = requestedUrls.find((url) => url.startsWith("https://cdn.syndication.twimg.com/tweet-result"));
assert.ok(endpoint, "the background should query X's public syndication endpoint");
assert.equal(new URL(endpoint).searchParams.get("token"), "51vexcqix8");

console.log(JSON.stringify({
  ok: true,
  endpoint,
  recovered: items.map(({ url, kind, quality, duration, thumbnail, downloadable }) => ({
    url,
    kind,
    quality,
    duration,
    thumbnail,
    downloadable
  })),
  assertions: [
    "blob-only X status recovers public media through the background fallback",
    "five MP4 variants and one HLS playlist are detected",
    "matching thumbnail, 41.513-second duration, and 2160p metadata are preserved",
    "all direct MP4 variants are immediately downloadable",
    "non-video.twimg.com media URLs are rejected"
  ]
}, null, 2));

function response(status, contentType, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        if (String(name).toLowerCase() === "content-type") return contentType;
        if (String(name).toLowerCase() === "content-length") return String(body.length);
        return "";
      }
    },
    text: async () => body
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
