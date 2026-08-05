import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const tweetId = "2084106804032872591";
const pageUrl = `https://x.com/MiniMax_AI/status/${tweetId}`;

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
  fetch,
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
      getURL(path) { return `chrome-extension://live-test/${path}`; },
      lastError: null
    },
    downloads: {}
  }
};

vm.createContext(context);
vm.runInContext(readFileSync("src/background.js", "utf8"), context, {
  filename: "src/background.js"
});

const candidates = await context.fetchXSyndicationCandidates(tweetId);
const mp4Items = candidates
  .filter((item) => item.kind === "video" && item.url.endsWith(".mp4"))
  .sort((a, b) => (b.height || 0) - (a.height || 0));
const hlsItems = candidates.filter((item) => item.kind === "hls");

assert.ok(mp4Items.length >= 1, "the live X post should expose at least one MP4 variant");
assert.ok(hlsItems.length >= 1, "the live X post should expose an HLS playlist");
assert.ok(mp4Items.every((item) => item.thumbnail.startsWith("https://pbs.twimg.com/")));
assert.ok(mp4Items.every((item) => item.duration > 0));

const direct = mp4Items[0];
const probe = await fetch(direct.url, {
  method: "GET",
  headers: { Range: "bytes=0-1023" },
  redirect: "follow"
});
const contentType = probe.headers.get("content-type") || "";
const bytes = new Uint8Array(await probe.arrayBuffer());

assert.ok(probe.ok || probe.status === 206, `direct MP4 probe failed with HTTP ${probe.status}`);
assert.match(contentType, /^video\/mp4(?:;|$)/i);
assert.ok(bytes.byteLength > 0, "the direct MP4 URL must return media bytes");

console.log(JSON.stringify({
  ok: true,
  pageUrl,
  recovered: {
    mp4: mp4Items.length,
    hls: hlsItems.length,
    bestQuality: direct.quality,
    duration: direct.duration,
    thumbnail: direct.thumbnail
  },
  directProbe: {
    status: probe.status,
    contentType,
    receivedBytes: bytes.byteLength,
    url: direct.url
  }
}, null, 2));
