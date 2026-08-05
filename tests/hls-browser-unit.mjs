import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

await import(`../src/offscreen.js?test=${Date.now()}`);
const api = globalThis.__VIDPOCKET_OFFSCREEN_TEST_API__;
const workDir = mkdtempSync(join(tmpdir(), "vidpocket-browser-hls-"));

try {
  const masterUrl = "https://media.test/master.m3u8";
  const master = api.parseMasterPlaylist([
    "#EXTM3U",
    "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"main\",NAME=\"English\",DEFAULT=YES,URI=\"audio.m3u8\"",
    "#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=320x180,AUDIO=\"main\"",
    "video.m3u8",
    ""
  ].join("\n"), masterUrl);
  assert(master.variants.length === 1, "master playlist should expose one video variant");
  assert(master.variants[0].url === "https://media.test/video.m3u8", "variant URL should resolve against the master URL");
  assert(master.audioGroups.get("main")[0].url === "https://media.test/audio.m3u8", "audio group URL should resolve correctly");

  const media = api.parseMediaPlaylist([
    "#EXTM3U",
    "#EXT-X-TARGETDURATION:2",
    "#EXTINF:1.25,",
    "seg0.ts",
    "#EXTINF:1.5,",
    "seg1.ts",
    "#EXT-X-ENDLIST",
    ""
  ].join("\n"), "https://media.test/video.m3u8");
  assert(media.segments.length === 2, "media playlist should expose its ordered segments");
  assert(Math.abs(media.duration - 2.75) < 0.001, "media duration should be summed from EXTINF");
  assert(media.segments[1].url === "https://media.test/seg1.ts", "segment URL should resolve correctly");

  const inputPath = join(workDir, "input.ts");
  const outputPath = join(workDir, "output.mp4");
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24",
    "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=44100",
    "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
    "-f", "mpegts", inputPath
  ]);
  const output = api.transmuxTransportStream([new Uint8Array(readFileSync(inputPath))]);
  writeFileSync(outputPath, output);
  const probe = JSON.parse(run("ffprobe", [
    "-v", "error", "-show_entries", "stream=codec_type,codec_name",
    "-show_entries", "format=duration,size", "-of", "json", outputPath
  ]).stdout || "{}");
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  assert(streams.some((stream) => stream.codec_type === "video" && stream.codec_name === "h264"), "browser MP4 output should contain H.264 video");
  assert(streams.some((stream) => stream.codec_type === "audio" && stream.codec_name === "aac"), "browser MP4 output should contain AAC audio");
  assert(Number(probe.format && probe.format.duration) > 1.5, "browser MP4 output should be playable");
  assert(Number(probe.format && probe.format.size) > 10000, "browser MP4 output should not be an empty shell");

  console.log(JSON.stringify({
    ok: true,
    outputBytes: output.byteLength,
    assertions: [
      "master and audio playlists are parsed locally",
      "relative HLS URLs are resolved correctly",
      "MPEG-TS is transmuxed into playable MP4",
      "output retains H.264 video and AAC audio"
    ]
  }, null, 2));
} finally {
  rmSync(workDir, { recursive: true, force: true });
  delete globalThis.__VIDPOCKET_TEST_MODE__;
  delete globalThis.__VIDPOCKET_OFFSCREEN_TEST_API__;
  delete globalThis.chrome;
  delete globalThis.muxjs;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `${command} failed`);
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
