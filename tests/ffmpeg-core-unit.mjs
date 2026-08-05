import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workDir = mkdtempSync(join(tmpdir(), "vidpocket-wasm-core-"));
const videoPath = join(workDir, "video.ts");
const audioPath = join(workDir, "audio.ts");
const outputPath = join(workDir, "output.mp4");

try {
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24",
    "-t", "2", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-f", "mpegts", videoPath
  ]);
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=44100",
    "-t", "2", "-vn", "-c:a", "aac",
    "-f", "mpegts", audioPath
  ]);

  globalThis.self = globalThis;
  globalThis.location = { href: new URL("../vendor/ffmpeg/core/ffmpeg-core.js", import.meta.url).href };
  const createFFmpegCore = (await import(`../vendor/ffmpeg/core/ffmpeg-core.js?test=${Date.now()}`)).default;
  const wasmBinary = new Uint8Array(readFileSync(new URL("../vendor/ffmpeg/core/ffmpeg-core.wasm", import.meta.url)));
  const core = await createFFmpegCore({ wasmBinary });
  core.FS.writeFile("video.ts", new Uint8Array(readFileSync(videoPath)));
  core.FS.writeFile("audio.ts", new Uint8Array(readFileSync(audioPath)));
  const exitCode = core.exec(
    "-i", "video.ts",
    "-i", "audio.ts",
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c", "copy",
    "-shortest",
    "output.mp4"
  );
  assert(exitCode === 0, `packaged FFmpeg WASM should remux split media, got ${exitCode}`);
  const output = core.FS.readFile("output.mp4");
  writeFileSync(outputPath, output);

  const probe = JSON.parse(run("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=codec_type,codec_name",
    "-show_entries", "format=duration,size",
    "-of", "json",
    outputPath
  ]).stdout || "{}");
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  assert(streams.some((stream) => stream.codec_type === "video"), "WASM output should contain video");
  assert(streams.some((stream) => stream.codec_type === "audio"), "WASM output should contain audio");
  assert(Number(probe.format && probe.format.duration) > 1.5, "WASM output should be playable");
  assert(Number(probe.format && probe.format.size) > 10000, "WASM output should not be an empty shell");

  console.log(JSON.stringify({
    ok: true,
    outputBytes: output.byteLength,
    assertions: [
      "packaged FFmpeg WASM loads without a system FFmpeg runtime",
      "packaged core merges split HLS-style video and audio",
      "result contains both video and audio streams",
      "result is a non-empty playable MP4"
    ]
  }, null, 2));
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `${command} failed`);
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
