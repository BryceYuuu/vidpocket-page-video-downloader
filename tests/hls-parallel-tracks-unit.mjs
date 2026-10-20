import assert from "node:assert/strict";
import muxjs from "mux.js";

globalThis.__VIDPOCKET_TEST_MODE__ = true;
globalThis.muxjs = muxjs;
globalThis.chrome = {
  runtime: {
    lastError: null,
    onMessage: { addListener() {} },
    sendMessage(_message, callback) { callback({ ok: true }); },
    getURL(path) { return `chrome-extension://test/${path}`; }
  }
};

// Each fake segment takes 40ms; track which requests overlap and which were aborted.
let inFlight = { video: 0, audio: 0 };
let overlapped = false;
const aborted = [];
globalThis.fetch = (url, options = {}) => new Promise((resolve, reject) => {
  const track = url.includes("/audio/") ? "audio" : "video";
  inFlight[track] += 1;
  if (inFlight.video > 0 && inFlight.audio > 0) overlapped = true;
  const timer = setTimeout(() => {
    inFlight[track] -= 1;
    if (url.includes("broken")) {
      resolve({ ok: false, status: 500, headers: new Headers(), body: null });
      return;
    }
    // One MPEG-TS packet: sync byte 0x47, then a marker byte telling the tracks apart.
    const bytes = new Uint8Array(188);
    bytes[0] = 0x47;
    bytes[1] = track === "video" ? 1 : 2;
    resolve(new Response(bytes, { status: 200, headers: { "content-length": "188" } }));
  }, 40);
  options.signal?.addEventListener("abort", () => {
    clearTimeout(timer);
    inFlight[track] -= 1;
    aborted.push(url);
    reject(new DOMException("aborted", "AbortError"));
  }, { once: true });
});

await import(`../src/offscreen.js?test=${Date.now()}`);
const api = globalThis.__VIDPOCKET_OFFSCREEN_TEST_API__;
const meter = { bytes: 0, addBytes(n) { this.bytes += n; }, completeUnit() {} };
const playlist = (track, count, broken = false) => ({
  segments: Array.from({ length: count }, (_, index) => ({ url: `https://media.test/${track}/${broken && index === 0 ? "broken" : "seg"}${index}.ts` })),
  map: null
});

const started = Date.now();
const [video, audio] = await api.downloadTracksTogether({ video: playlist("video", 12), audio: playlist("audio", 12) }, new AbortController().signal, meter);
const elapsed = Date.now() - started;
assert.equal(video.parts.length, 12);
assert.equal(audio.parts.length, 12);
assert.equal(video.container, "ts");
assert.equal(video.parts[0][1], 1, "video parts come from the video playlist");
assert.equal(audio.parts[0][1], 2, "audio parts come from the audio playlist");
assert.ok(overlapped, "audio segments should download while video segments are in flight");
// Sequential would be 2 x ceil(12/6) x 40ms = 160ms; together it is ~80ms.
assert.ok(elapsed < 150, `parallel tracks should finish in about half the sequential time, took ${elapsed}ms`);

const [videoOnly, none] = await api.downloadTracksTogether({ video: playlist("video", 3), audio: null }, new AbortController().signal, meter);
assert.equal(videoOnly.parts.length, 3);
assert.equal(none, null, "video-only plans return no audio track");

aborted.length = 0;
await assert.rejects(
  api.downloadTracksTogether({ video: playlist("video", 30), audio: playlist("audio", 2, true) }, new AbortController().signal, meter),
  /500/,
  "a failing track rejects the whole download"
);
await new Promise((resolve) => setTimeout(resolve, 10));
assert.ok(aborted.some((url) => url.includes("/video/")), "the other track is cancelled when one track fails");

const userStop = new AbortController();
const pending = api.downloadTracksTogether({ video: playlist("video", 30), audio: playlist("audio", 30) }, userStop.signal, meter);
setTimeout(() => userStop.abort(), 20);
await assert.rejects(pending, (error) => error.name === "AbortError", "stopping the job cancels both tracks");

console.log(JSON.stringify({
  ok: true,
  elapsedMs: elapsed,
  assertions: [
    "HLS video and audio segments download at the same time",
    "parallel tracks finish in about half the sequential time",
    "video-only plans still work",
    "a failing track cancels the other track",
    "stopping the job cancels both tracks"
  ]
}, null, 2));
