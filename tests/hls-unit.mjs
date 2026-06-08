import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { listen } from "../helper/vidpocket-helper.mjs";

const workDir = mkdtempSync(join(tmpdir(), "vidpocket-hls-"));
const hlsDir = join(workDir, "hls");
const downloadDir = join(workDir, "downloads");
mkdirSync(hlsDir, { recursive: true });
mkdirSync(downloadDir, { recursive: true });

try {
  run("ffmpeg", [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-f", "lavfi",
    "-i", "testsrc=size=320x180:rate=24",
    "-f", "lavfi",
    "-i", "sine=frequency=880:sample_rate=44100",
    "-t", "2",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-hls_time", "1",
    "-hls_playlist_type", "vod",
    "-hls_segment_filename", join(hlsDir, "seg%03d.ts"),
    join(hlsDir, "stream.m3u8")
  ]);
  run("ffmpeg", [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-f", "lavfi",
    "-i", "testsrc=size=320x180:rate=24",
    "-t", "2",
    "-an",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-hls_time", "1",
    "-hls_playlist_type", "vod",
    "-hls_segment_filename", join(hlsDir, "video%03d.ts"),
    join(hlsDir, "video.m3u8")
  ]);
  run("ffmpeg", [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-f", "lavfi",
    "-i", "sine=frequency=660:sample_rate=44100",
    "-t", "2",
    "-vn",
    "-c:a", "aac",
    "-hls_time", "1",
    "-hls_playlist_type", "vod",
    "-hls_segment_filename", join(hlsDir, "audio%03d.ts"),
    join(hlsDir, "audio.m3u8")
  ]);
  writeFileSync(join(hlsDir, "master.m3u8"), [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio\",NAME=\"main\",DEFAULT=YES,AUTOSELECT=YES,URI=\"audio.m3u8\"",
    "#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=320x180,CODECS=\"avc1.42e01e,mp4a.40.2\",AUDIO=\"audio\"",
    "video.m3u8",
    ""
  ].join("\n"));

  const staticServer = await serveDirectory(hlsDir);
  const helper = await listen({ port: 0, downloadDir });
  const mediaUrl = `http://127.0.0.1:${staticServer.port}/stream.m3u8`;

  try {
    const thumb = await postJson(`http://127.0.0.1:${helper.port}/thumbnail`, {
      url: mediaUrl,
      pageUrl: "http://example.test/article",
      second: 0.5
    });
    assert(thumb.ok === true, "helper thumbnail endpoint should succeed");
    assert(/^data:image\/jpeg;base64,/.test(thumb.thumbnail), "thumbnail should be a JPEG data URL");
    assert(Number(thumb.width) === 320, "thumbnail metadata width should come from ffprobe");
    assert(Number(thumb.height) === 180, "thumbnail metadata height should come from ffprobe");

    const started = await postJson(`http://127.0.0.1:${helper.port}/download`, {
      url: mediaUrl,
      filename: "fixture-video.mp4",
      pageUrl: "http://example.test/article"
    });
    assert(started.ok === true && started.jobId, "helper download endpoint should start a job");

    const jobResult = await waitForJob(helper.port, started.jobId);
    const job = jobResult.job;
    assert(job.status === "done", `download job should finish: ${job.error || ""}`);
    assert(existsSync(job.outputPath), "downloaded MP4 should exist");
    assert(statSync(job.outputPath).size > 10000, "downloaded MP4 should contain media bytes");
    assert(extname(job.outputPath).toLowerCase() === ".mp4", "downloaded file should be MP4");
    assert(jobResult.progressValues.some((value) => value >= 0 && value <= 1), "job endpoint should expose progress values");

    const fileResponse = await fetch(`http://127.0.0.1:${helper.port}/files/${encodeURIComponent(started.jobId)}`);
    const fileBytes = Buffer.from(await fileResponse.arrayBuffer());
    assert(fileResponse.ok, "helper file endpoint should be downloadable by Chrome");
    assert(fileBytes.length === statSync(job.outputPath).size, "helper file endpoint should stream the generated MP4");

    const duration = ffprobeDuration(job.outputPath);
    assert(duration >= 1.5 && duration <= 3.5, "downloaded MP4 should be playable");
    const streams = ffprobeStreams(job.outputPath);
    assert(streams.hasVideo, "downloaded MP4 should contain a video stream");
    assert(streams.hasAudio, "downloaded MP4 should contain an audio stream");

    const videoOnlyUrl = `http://127.0.0.1:${staticServer.port}/video.m3u8`;
    const splitStarted = await postJson(`http://127.0.0.1:${helper.port}/download`, {
      url: videoOnlyUrl,
      filename: "split-fixture.mp4",
      pageUrl: "http://example.test/article",
      height: 180,
      relatedHlsUrls: [
        videoOnlyUrl,
        `http://127.0.0.1:${staticServer.port}/master.m3u8`,
        `http://127.0.0.1:${staticServer.port}/audio.m3u8`
      ]
    });
    assert(splitStarted.ok === true && splitStarted.jobId, "split HLS job should start");
    const splitJobResult = await waitForJob(helper.port, splitStarted.jobId);
    const splitJob = splitJobResult.job;
    assert(splitJob.status === "done", `split HLS job should finish: ${splitJob.error || ""}`);
    const splitStreams = ffprobeStreams(splitJob.outputPath);
    assert(splitStreams.hasVideo, "split HLS output should contain a video stream");
    assert(splitStreams.hasAudio, "split HLS output should contain an audio stream");
    assert(splitStreams.frameRate > 0 && splitStreams.frameRate <= 60, "split HLS output should have a sane frame rate");

    console.log(JSON.stringify({
      ok: true,
      thumbnailBytes: Math.round((thumb.thumbnail.length * 3) / 4),
      outputPath: job.outputPath,
      outputBytes: statSync(job.outputPath).size,
      splitOutputBytes: statSync(splitJob.outputPath).size,
      streamedBytes: fileBytes.length,
      duration,
      assertions: [
        "helper extracts a real HLS thumbnail",
        "helper saves HLS as a playable MP4",
        "helper merges split HLS video and audio into one MP4",
        "download output is not an empty shell",
        "helper file endpoint streams the MP4 for Chrome downloads"
      ]
    }, null, 2));
  } finally {
    await helper.close();
    await staticServer.close();
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

function serveDirectory(root) {
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const name = decodeURIComponent(url.pathname.replace(/^\/+/, "")) || "stream.m3u8";
    if (!readdirSync(root).includes(name)) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    const path = join(root, name);
    response.writeHead(200, {
      "Content-Type": name.endsWith(".m3u8") ? "application/x-mpegURL" : "video/mp2t"
    });
    createReadStream(path).pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve({
        port: server.address().port,
        close: () => new Promise((closeResolve) => server.close(closeResolve))
      });
    });
  });
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return response.json();
}

async function getJson(url) {
  const response = await fetch(url);
  return response.json();
}

async function waitForJob(port, jobId) {
  const progressValues = [];
  for (let index = 0; index < 60; index += 1) {
    await delay(500);
    const job = await getJson(`http://127.0.0.1:${port}/jobs/${encodeURIComponent(jobId)}`);
    progressValues.push(Number(job.progress) || 0);
    if (job.status === "done" || job.status === "error") {
      return { job, progressValues };
    }
  }
  throw new Error("job timed out");
}

function ffprobeDuration(path) {
  const result = run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    path
  ]);
  return Number(result.stdout.trim());
}

function ffprobeStreams(path) {
  const result = run("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=codec_type,avg_frame_rate",
    "-of", "json",
    path
  ]);
  const parsed = JSON.parse(result.stdout || "{}");
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  return {
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    frameRate: video ? parseRate(video.avg_frame_rate) : 0
  };
}

function parseRate(value) {
  const [num, den] = String(value || "0/1").split("/").map(Number);
  return den ? num / den : 0;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `${command} failed`);
  }
  return result;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
