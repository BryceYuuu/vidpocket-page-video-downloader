#!/usr/bin/env node
import { createServer as createHttpServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 17384;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_WORK_DIR = join(homedir(), "Library", "Application Support", "VidPocket");
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137 Safari/537.36";
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_HLS_CANDIDATES = 40;
const jobs = new Map();

export function createHelperServer(options = {}) {
  const config = {
    host: options.host || DEFAULT_HOST,
    port: Number(options.port === undefined ? (process.env.VIDPOCKET_HELPER_PORT || DEFAULT_PORT) : options.port),
    workDir: options.downloadDir || options.workDir || process.env.VIDPOCKET_WORK_DIR || DEFAULT_WORK_DIR,
    ffmpegPath: options.ffmpegPath || process.env.FFMPEG_PATH || resolveBinary("ffmpeg", ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"]),
    ffprobePath: options.ffprobePath || process.env.FFPROBE_PATH || resolveBinary("ffprobe", ["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe"])
  };

  mkdirSync(config.workDir, { recursive: true });

  return createHttpServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      sendNoContent(response);
      return;
    }

    try {
      const url = new URL(request.url || "/", `http://${config.host}:${config.port}`);
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, {
          ok: true,
          ffmpeg: config.ffmpegPath,
          ffprobe: config.ffprobePath,
          workDir: config.workDir
        });
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/jobs/")) {
        const id = decodeURIComponent(url.pathname.slice("/jobs/".length));
        const job = jobs.get(id);
        if (!job) {
          sendJson(response, 404, { ok: false, error: "任务不存在" });
          return;
        }
        sendJson(response, 200, { ok: true, ...publicJob(job) });
        return;
      }

      if (request.method === "POST" && url.pathname.startsWith("/jobs/") && url.pathname.endsWith("/cancel")) {
        const id = decodeURIComponent(url.pathname.slice("/jobs/".length, -"/cancel".length));
        const job = jobs.get(id);
        if (!job) {
          sendJson(response, 404, { ok: false, error: "任务不存在" });
          return;
        }
        cancelJob(job);
        sendJson(response, 200, { ok: true, ...publicJob(job) });
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/files/")) {
        const id = decodeURIComponent(url.pathname.slice("/files/".length));
        sendJobFile(response, id);
        return;
      }

      if (request.method === "POST" && url.pathname === "/thumbnail") {
        const body = await readJsonBody(request);
        const result = await createThumbnail(body, config);
        sendJson(response, 200, { ok: true, ...result });
        return;
      }

      if (request.method === "POST" && url.pathname === "/download") {
        const body = await readJsonBody(request);
        const job = startDownloadJob(body, config);
        sendJson(response, 200, { ok: true, jobId: job.id, ...publicJob(job) });
        return;
      }

      sendJson(response, 404, { ok: false, error: "Not found" });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message || String(error) });
    }
  });
}

export function listen(options = {}) {
  const server = createHelperServer(options);
  const host = options.host || DEFAULT_HOST;
  const port = Number(options.port === undefined ? (process.env.VIDPOCKET_HELPER_PORT || DEFAULT_PORT) : options.port);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve({
        server,
        host,
        port: server.address().port,
        close: () => new Promise((closeResolve) => server.close(closeResolve))
      });
    });
  });
}

function startDownloadJob(body, config) {
  const mediaUrl = parseMediaUrl(body && body.url);
  rejectBlockedHosts(mediaUrl);

  const filename = ensureMp4Extension(safeFilename((body && body.filename) || basename(mediaUrl.pathname) || "video.mp4"));
  const outputPath = uniqueOutputPath(config.workDir, filename);
  const tempPath = outputPath.replace(/\.mp4$/i, ".part.mp4");
  const job = {
    id: randomUUID(),
    status: "queued",
    url: mediaUrl.href,
    filename: basename(outputPath),
    outputPath,
    error: "",
    phase: "queued",
    progress: 0,
    duration: Number(body && body.duration) || 0,
    size: 0,
    bytes: 0,
    speed: 0,
    tempPath,
    child: null,
    lastSampleAt: 0,
    lastSampleBytes: 0,
    startedAt: Date.now(),
    finishedAt: 0
  };
  jobs.set(job.id, job);

  runDownloadJob(job, tempPath, body || {}, config).catch((error) => {
    if (job.status === "canceled") {
      removeQuietly(tempPath);
      job.finishedAt = Date.now();
      return;
    }
    job.status = "error";
    job.error = error.message || String(error);
    job.finishedAt = Date.now();
    console.error(`[${job.id}] ${job.filename}: ${job.error}`);
    removeQuietly(tempPath);
  });
  return job;
}

async function runDownloadJob(job, tempPath, body, config) {
  job.status = "running";
  job.phase = "checking";
  const source = await resolveDownloadSource(job.url, body, config);
  job.url = source.url || source.videoUrl || job.url;
  if (!job.duration) {
    const metadata = await probeMetadata(job.url, body, config).catch(() => ({}));
    job.duration = Number(metadata.duration) || 0;
  }
  removeQuietly(tempPath);
  job.phase = "downloading";
  job.progress = 0.01;

  if (source.isHls) {
    const transcodeArgs = buildHlsTranscodeArgs(source, body, tempPath);
    await runFfmpeg(config.ffmpegPath, withProgressArgs(transcodeArgs), {
      timeoutMs: 6 * 60 * 60 * 1000,
      onSpawn: (child) => {
        job.child = child;
      },
      onStderrData: (chunk) => updateJobProgress(job, chunk)
    }).catch((error) => {
      throw new Error(`ffmpeg 下载失败：${lastLine(error.message)}`);
    });
  } else {
    const copyArgs = [
      ...ffmpegHttpArgs(body),
      "-i", job.url,
      "-map", "0:v:0?",
      "-map", "0:a:0?",
      "-c", "copy",
      "-movflags", "+faststart",
      "-y",
      tempPath
    ];

    try {
      await runFfmpeg(config.ffmpegPath, withProgressArgs(copyArgs), {
        timeoutMs: 6 * 60 * 60 * 1000,
        onSpawn: (child) => {
          job.child = child;
        },
        onStderrData: (chunk) => updateJobProgress(job, chunk)
      });
    } catch (copyError) {
      removeQuietly(tempPath);
      job.phase = "transcoding";
      job.progress = Math.max(job.progress || 0, 0.03);
      const transcodeArgs = buildSingleInputTranscodeArgs(job.url, body, tempPath, false);
      await runFfmpeg(config.ffmpegPath, withProgressArgs(transcodeArgs), {
        timeoutMs: 6 * 60 * 60 * 1000,
        onSpawn: (child) => {
          job.child = child;
        },
        onStderrData: (chunk) => updateJobProgress(job, chunk)
      })
        .catch((transcodeError) => {
          throw new Error(`ffmpeg 下载失败：${lastLine(transcodeError.message || copyError.message)}`);
        });
    }
  }

  const size = fileSize(tempPath);
  if (size < 1024) {
    throw new Error("下载结果为空。");
  }
  const streams = await probeFileStreams(tempPath, config);
  if (!streams.hasVideo) {
    throw new Error("下载结果没有视频画面。");
  }
  if (source.requireAudio && !streams.hasAudio) {
    throw new Error("没有找到可合并的音频轨，已停止生成无声文件。");
  }
  if (!streams.hasAudio) {
    job.warning = source.warning || "已生成 MP4，但没有找到音频轨。";
  }
  renameSync(tempPath, job.outputPath);
  job.status = "done";
  job.phase = "ready";
  job.size = size;
  job.bytes = size;
  job.speed = 0;
  job.child = null;
  job.progress = 1;
  job.finishedAt = Date.now();
}

async function createThumbnail(body, config) {
  const mediaUrl = parseMediaUrl(body && body.url);
  rejectBlockedHosts(mediaUrl);
  await assertAllowedPlaylist(mediaUrl.href, body || {}, config);

  const result = await extractThumbnail(mediaUrl.href, body || {}, config);
  if (!result.stdout || result.stdout.length < 1024) {
    throw new Error("没有抽到可用封面。");
  }

  const metadata = await probeMetadata(mediaUrl.href, body || {}, config).catch(() => ({}));
  return {
    thumbnail: `data:image/jpeg;base64,${result.stdout.toString("base64")}`,
    duration: Number(metadata.duration) || 0,
    width: Number(metadata.width) || 0,
    height: Number(metadata.height) || 0
  };
}

async function extractThumbnail(url, body, config) {
  const seconds = [Number(body && body.second) || 1, 0.1, 2.5, 5];
  let lastError = null;
  for (const second of seconds) {
    const args = [
      ...ffmpegHttpArgs(body || {}),
      "-ss", String(second),
      "-i", url,
      "-an",
      "-frames:v", "1",
      "-vf", "scale=280:-2",
      "-f", "image2pipe",
      "-vcodec", "mjpeg",
      "pipe:1"
    ];
    try {
      const result = await runFfmpeg(config.ffmpegPath, args, {
        timeoutMs: 45000,
        captureStdout: true,
        maxStdoutBytes: 2 * 1024 * 1024
      });
      if (result.stdout && result.stdout.length >= 1024) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("没有抽到可用封面。");
}

async function resolveDownloadSource(url, body, config) {
  if (!isHlsUrl(url)) {
    return {
      isHls: false,
      mode: "single",
      url,
      hasAudio: false,
      requireAudio: false
    };
  }

  const candidates = collectHlsCandidateUrls(url, body);
  const infos = [];
  for (const candidateUrl of candidates) {
    try {
      const playlist = await fetchText(candidateUrl, body);
      if (!playlist || !/^#EXTM3U/m.test(playlist)) {
        continue;
      }
      assertPlaylistAllowed(playlist);
      infos.push(parsePlaylistInfo(candidateUrl, playlist));
    } catch {
      // Candidate URLs are best effort; the clicked URL still decides the failure below.
    }
  }

  const clickedInfo = infos.find((info) => info.url === url);
  if (!clickedInfo) {
    await assertAllowedPlaylist(url, body, config);
  }

  const targetHeight = targetHeightFromBody(body);
  const masterWithAudio = infos
    .filter((info) => info.isMaster && info.audioUrls.length && info.streams.length)
    .sort((a, b) => b.maxHeight - a.maxHeight)[0];
  if (masterWithAudio) {
    const stream = chooseMasterStream(masterWithAudio.streams, targetHeight);
    const audio = chooseAudioRendition(masterWithAudio.audioUrls);
    if (stream && audio) {
      return {
        isHls: true,
        mode: "split",
        videoUrl: stream.url,
        audioUrl: audio.url,
        hasAudio: true,
        requireAudio: true
      };
    }
  }

  const probeInfos = await probeHlsCandidates(infos, url, body, config);
  const clickedProbe = probeInfos.find((probe) => probe.url === url);
  if (clickedProbe && clickedProbe.hasVideo && clickedProbe.hasAudio) {
    return {
      isHls: true,
      mode: "single",
      url,
      hasAudio: true,
      requireAudio: true
    };
  }

  const videoProbe = clickedProbe && clickedProbe.hasVideo
    ? clickedProbe
    : chooseVideoProbe(probeInfos, targetHeight);
  const audioProbe = clickedProbe && clickedProbe.hasAudio && !clickedProbe.hasVideo
    ? clickedProbe
    : chooseAudioProbe(probeInfos, videoProbe);

  if (videoProbe && audioProbe && videoProbe.url !== audioProbe.url) {
    return {
      isHls: true,
      mode: "split",
      videoUrl: videoProbe.url,
      audioUrl: audioProbe.url,
      hasAudio: true,
      requireAudio: true
    };
  }

  const combinedProbe = probeInfos.find((probe) => probe.hasVideo && probe.hasAudio);
  if (combinedProbe) {
    return {
      isHls: true,
      mode: "single",
      url: combinedProbe.url,
      hasAudio: true,
      requireAudio: true
    };
  }

  if (videoProbe) {
    return {
      isHls: true,
      mode: "single",
      url: videoProbe.url,
      hasAudio: false,
      requireAudio: false,
      warning: shouldRequireAudio(url, body)
        ? "这个 HLS 只找到了视频轨，没有找到可合并的音频轨。已先生成无声 MP4。"
        : "已生成 MP4，但没有找到音频轨。"
    };
  }

  throw new Error("没有找到可用的视频轨。");
}

function collectHlsCandidateUrls(url, body) {
  const urls = [url, ...inferMasterPlaylistUrls(url)];
  const groupKey = hlsGroupKey(url);
  const related = Array.isArray(body && body.relatedHlsUrls) ? body.relatedHlsUrls : [];
  related.forEach((candidate) => {
    if (typeof candidate !== "string" || !isHlsUrl(candidate)) {
      return;
    }
    if (groupKey && hlsGroupKey(candidate) !== groupKey) {
      return;
    }
    urls.push(candidate, ...inferMasterPlaylistUrls(candidate));
  });
  return [...new Set(urls)].slice(0, MAX_HLS_CANDIDATES);
}

function hlsGroupKey(value) {
  try {
    const url = new URL(value);
    const path = url.pathname;
    const puIndex = path.indexOf("/pu/");
    if (puIndex >= 0) {
      return `${url.origin}${path.slice(0, puIndex + "/pu/".length)}`;
    }
    for (const marker of ["/vid/", "/aud/", "/pl/"]) {
      const index = path.indexOf(marker);
      if (index >= 0) {
        return `${url.origin}${path.slice(0, index + 1)}`;
      }
    }
    const slash = path.lastIndexOf("/");
    return `${url.origin}${slash >= 0 ? path.slice(0, slash + 1) : "/"}`;
  } catch {
    return "";
  }
}

function shouldRequireAudio(url, body) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "video.twimg.com" || host.endsWith(".video.twimg.com")) {
      return true;
    }
  } catch {
    // Fall through to the related-list heuristic.
  }
  const related = Array.isArray(body && body.relatedHlsUrls) ? body.relatedHlsUrls : [];
  return related.filter((candidate) => typeof candidate === "string" && isHlsUrl(candidate)).length > 1;
}

function inferMasterPlaylistUrls(value) {
  const results = [];
  try {
    const url = new URL(value);
    const path = url.pathname;
    const match = /^(.*\/)(vid|aud)\/.*\/([^/]+\.m3u8)$/i.exec(path);
    if (match) {
      const candidate = new URL(url.href);
      candidate.pathname = `${match[1]}pl/${match[3]}`;
      results.push(candidate.href);
    }
  } catch {
    // Ignore malformed related URLs.
  }
  return results;
}

function parsePlaylistInfo(url, playlist) {
  const lines = playlist.split(/\r?\n/);
  const streams = [];
  const audioUrls = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const attrs = parseAttributeList(line.slice("#EXT-X-STREAM-INF:".length));
      const uri = nextHlsUri(lines, index + 1);
      if (uri) {
        const resolution = String(attrs.RESOLUTION || "").match(/^(\d+)x(\d+)$/);
        streams.push({
          url: new URL(uri, url).href,
          bandwidth: Number(attrs.BANDWIDTH) || 0,
          width: resolution ? Number(resolution[1]) : 0,
          height: resolution ? Number(resolution[2]) : 0,
          audioGroup: attrs.AUDIO || ""
        });
      }
      continue;
    }
    if (line.startsWith("#EXT-X-MEDIA:")) {
      const attrs = parseAttributeList(line.slice("#EXT-X-MEDIA:".length));
      if (String(attrs.TYPE || "").toUpperCase() === "AUDIO" && attrs.URI) {
        audioUrls.push({
          url: new URL(attrs.URI, url).href,
          groupId: attrs["GROUP-ID"] || "",
          name: attrs.NAME || "",
          isDefault: /^YES$/i.test(String(attrs.DEFAULT || ""))
        });
      }
    }
  }
  return {
    url,
    isMaster: streams.length > 0,
    streams,
    audioUrls,
    maxHeight: streams.reduce((max, stream) => Math.max(max, stream.height || 0), 0)
  };
}

function parseAttributeList(value) {
  const attrs = {};
  const pattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let match = pattern.exec(value);
  while (match) {
    const raw = match[2] || "";
    attrs[match[1].toUpperCase()] = raw.startsWith("\"") && raw.endsWith("\"") ? raw.slice(1, -1) : raw;
    match = pattern.exec(value);
  }
  return attrs;
}

function chooseMasterStream(streams, targetHeight) {
  const sorted = [...streams].sort((a, b) => {
    if (targetHeight) {
      const delta = Math.abs((a.height || 0) - targetHeight) - Math.abs((b.height || 0) - targetHeight);
      if (delta !== 0) {
        return delta;
      }
    }
    return (b.height || 0) - (a.height || 0) || (b.bandwidth || 0) - (a.bandwidth || 0);
  });
  return sorted[0] || null;
}

function chooseAudioRendition(audioUrls) {
  return [...audioUrls].sort((a, b) => Number(b.isDefault) - Number(a.isDefault))[0] || null;
}

async function probeHlsCandidates(infos, clickedUrl, body, config) {
  const urls = [];
  const clickedInfo = infos.find((info) => info.url === clickedUrl);
  if (clickedInfo) {
    urls.push(clickedInfo.url);
  }
  infos.forEach((info) => {
    if (info.isMaster) {
      info.streams.forEach((stream) => urls.push(stream.url));
      info.audioUrls.forEach((audio) => urls.push(audio.url));
      return;
    }
    urls.push(info.url);
  });

  const probes = [];
  for (const candidateUrl of [...new Set(urls)].slice(0, MAX_HLS_CANDIDATES)) {
    try {
      const probe = await probeUrlStreams(candidateUrl, body, config);
      probes.push({ url: candidateUrl, ...probe });
    } catch {
      // Some related playlists can expire or need cookies; keep probing the rest.
    }
  }
  return probes;
}

function chooseVideoProbe(probes, targetHeight) {
  return probes
    .filter((probe) => probe.hasVideo)
    .sort((a, b) => {
      if (targetHeight) {
        const delta = Math.abs((a.height || 0) - targetHeight) - Math.abs((b.height || 0) - targetHeight);
        if (delta !== 0) {
          return delta;
        }
      }
      return (b.height || 0) - (a.height || 0) || (b.width || 0) - (a.width || 0);
    })[0] || null;
}

function chooseAudioProbe(probes, videoProbe) {
  const targetDuration = videoProbe && videoProbe.duration ? Number(videoProbe.duration) : 0;
  return probes
    .filter((probe) => probe.hasAudio && !probe.hasVideo)
    .sort((a, b) => {
      if (targetDuration) {
        const delta = Math.abs((a.duration || 0) - targetDuration) - Math.abs((b.duration || 0) - targetDuration);
        if (delta !== 0) {
          return delta;
        }
      }
      return (b.duration || 0) - (a.duration || 0);
    })[0] || null;
}

async function probeUrlStreams(url, body, config) {
  if (!config.ffprobePath) {
    return {};
  }
  const args = [
    "-v", "error",
    ...ffprobeHttpArgs(body),
    "-show_entries", "format=duration:stream=index,codec_type,codec_name,width,height,duration",
    "-of", "json",
    url
  ];
  const result = await runProcess(config.ffprobePath, args, {
    timeoutMs: 45000,
    captureStdout: true,
    maxStdoutBytes: 1024 * 1024
  });
  return streamSummary(JSON.parse(result.stdout.toString("utf8") || "{}"));
}

async function probeFileStreams(path, config) {
  if (!config.ffprobePath) {
    return {};
  }
  const args = [
    "-v", "error",
    "-show_entries", "format=duration:stream=index,codec_type,codec_name,width,height,duration",
    "-of", "json",
    path
  ];
  const result = await runProcess(config.ffprobePath, args, {
    timeoutMs: 45000,
    captureStdout: true,
    maxStdoutBytes: 1024 * 1024
  });
  return streamSummary(JSON.parse(result.stdout.toString("utf8") || "{}"));
}

function streamSummary(parsed) {
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  return {
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    width: video && video.width ? Number(video.width) : 0,
    height: video && video.height ? Number(video.height) : 0,
    duration: parsed.format && parsed.format.duration ? Number(parsed.format.duration) : Number((video && video.duration) || (audio && audio.duration) || 0)
  };
}

function buildHlsTranscodeArgs(source, body, tempPath) {
  if (source.mode === "split") {
    return [
      ...ffmpegGlobalArgs(),
      ...ffmpegInputArgs(body),
      "-fflags", "+genpts+discardcorrupt",
      "-i", source.videoUrl,
      ...ffmpegInputArgs(body),
      "-fflags", "+genpts+discardcorrupt",
      "-i", source.audioUrl,
      "-map", "0:v:0",
      "-map", "1:a:0",
      ...hlsOutputArgs(true),
      tempPath
    ];
  }
  return buildSingleInputTranscodeArgs(source.url, body, tempPath, source.requireAudio || source.hasAudio);
}

function buildSingleInputTranscodeArgs(url, body, tempPath, requireAudio) {
  return [
    ...ffmpegGlobalArgs(),
    ...ffmpegInputArgs(body),
    "-fflags", "+genpts+discardcorrupt",
    "-i", url,
    "-map", "0:v:0",
    "-map", requireAudio ? "0:a:0" : "0:a:0?",
    ...hlsOutputArgs(requireAudio),
    tempPath
  ];
}

function hlsOutputArgs(includeAudio) {
  const args = [
    "-vf", "setpts=PTS-STARTPTS,format=yuv420p",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-max_muxing_queue_size", "4096",
    "-movflags", "+faststart",
    "-avoid_negative_ts", "make_zero",
    "-y"
  ];
  if (includeAudio) {
    args.splice(8, 0, "-c:a", "aac", "-b:a", "160k", "-af", "aresample=async=1:first_pts=0", "-shortest");
  }
  return args;
}

function targetHeightFromBody(body) {
  const fromHeight = Number(body && body.height) || 0;
  if (fromHeight) {
    return fromHeight;
  }
  const quality = /(\d{3,4})p/i.exec(String((body && body.quality) || ""));
  return quality ? Number(quality[1]) : 0;
}

async function probeMetadata(url, body, config) {
  if (!config.ffprobePath) {
    return {};
  }
  const args = [
    "-v", "error",
    ...ffprobeHttpArgs(body),
    "-show_entries", "format=duration:stream=width,height",
    "-of", "json",
    url
  ];
  const result = await runProcess(config.ffprobePath, args, {
    timeoutMs: 45000,
    captureStdout: true,
    maxStdoutBytes: 1024 * 1024
  });
  const parsed = JSON.parse(result.stdout.toString("utf8") || "{}");
  const videoStream = Array.isArray(parsed.streams)
    ? parsed.streams.find((stream) => stream.width || stream.height)
    : null;
  return {
    duration: parsed.format && parsed.format.duration ? Number(parsed.format.duration) : 0,
    width: videoStream && videoStream.width ? Number(videoStream.width) : 0,
    height: videoStream && videoStream.height ? Number(videoStream.height) : 0
  };
}

async function assertAllowedPlaylist(url, body, config) {
  if (!/\.m3u8(?:[?#]|$)/i.test(url)) {
    return;
  }
  const playlist = await fetchText(url, body);
  if (!playlist || !/^#EXTM3U/m.test(playlist)) {
    return;
  }
  assertPlaylistAllowed(playlist);
  const variantUrl = chooseVariantUrl(playlist, url);
  if (variantUrl) {
    const variant = await fetchText(variantUrl, body);
    assertPlaylistAllowed(variant);
  }
}

async function fetchText(url, body) {
  const response = await fetch(url, {
    headers: httpHeaders(body),
    redirect: "follow"
  });
  if (!response.ok) {
    throw new Error(`播放列表读取失败：${response.status}`);
  }
  return response.text();
}

function chooseVariantUrl(playlist, playlistUrl) {
  const lines = playlist.split(/\r?\n/);
  const variants = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line.startsWith("#EXT-X-STREAM-INF:")) {
      continue;
    }
    const uri = nextHlsUri(lines, index + 1);
    if (!uri) {
      continue;
    }
    const bandwidth = Number((/BANDWIDTH=(\d+)/i.exec(line) || [])[1]) || 0;
    const resolution = /RESOLUTION=(\d+)x(\d+)/i.exec(line) || [];
    const height = Number(resolution[2]) || 0;
    variants.push({
      url: new URL(uri, playlistUrl).href,
      score: height * 100000000 + bandwidth
    });
  }
  variants.sort((a, b) => b.score - a.score);
  return variants[0] ? variants[0].url : "";
}

function nextHlsUri(lines, startIndex) {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line && !line.startsWith("#")) {
      return line;
    }
  }
  return "";
}

function hasEncryptedKey(playlist) {
  return playlist.split(/\r?\n/).some((line) =>
    /^#EXT-X-KEY:/i.test(line.trim()) && !/METHOD=NONE/i.test(line)
  );
}

function assertPlaylistAllowed(playlist) {
  if (hasEncryptedKey(playlist)) {
    throw new Error("这是加密 HLS，本地助手不会处理受保护视频。");
  }
}

function isHlsUrl(value) {
  return /\.m3u8(?:[?#]|$)/i.test(String(value || ""));
}

function ffmpegHttpArgs(body) {
  return [
    ...ffmpegGlobalArgs(),
    ...ffmpegInputArgs(body)
  ];
}

function ffmpegGlobalArgs() {
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-nostats"
  ];
}

function ffmpegInputArgs(body) {
  return [
    "-reconnect", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "5",
    "-protocol_whitelist", "file,http,https,tcp,tls,crypto",
    "-user_agent", USER_AGENT,
    "-headers", ffmpegHeaderString(body)
  ];
}

function ffprobeHttpArgs(body) {
  return [
    "-user_agent", USER_AGENT,
    "-headers", ffmpegHeaderString(body)
  ];
}

function ffmpegHeaderString(body) {
  const headers = httpHeaders(body);
  return Object.entries(headers)
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}: ${value}`)
    .join("\r\n");
}

function httpHeaders(body) {
  const pageUrl = body && body.pageUrl ? String(body.pageUrl) : "";
  const headers = { "User-Agent": USER_AGENT };
  if (pageUrl) {
    headers.Referer = pageUrl;
    try {
      headers.Origin = new URL(pageUrl).origin;
    } catch {
      // No origin header for malformed page URLs.
    }
  }
  return headers;
}

function runFfmpeg(binary, args, options = {}) {
  if (!binary) {
    throw new Error("没有找到 ffmpeg。");
  }
  return runProcess(binary, args, options);
}

function runProcess(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    if (typeof options.onSpawn === "function") {
      options.onSpawn(child);
    }
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    const maxStdoutBytes = options.maxStdoutBytes || 0;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("命令超时。"));
    }, options.timeoutMs || 60000);

    child.stdout.on("data", (chunk) => {
      if (!options.captureStdout) {
        return;
      }
      stdoutBytes += chunk.length;
      if (maxStdoutBytes && stdoutBytes > maxStdoutBytes) {
        child.kill("SIGKILL");
        reject(new Error("输出过大。"));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (typeof options.onStderrData === "function") {
        options.onStderrData(chunk);
      }
      stderr.push(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const stderrText = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        reject(new Error(stderrText || `命令退出：${code}`));
        return;
      }
      resolve({
        stdout: Buffer.concat(stdout),
        stderr: stderrText
      });
    });
  });
}

function withProgressArgs(args) {
  const output = args[args.length - 1];
  return [
    ...args.slice(0, -1),
    "-progress", "pipe:2",
    output
  ];
}

function updateJobProgress(job, chunk) {
  const text = chunk.toString("utf8");
  if (!job.duration) {
    return;
  }
  const microsMatch = /out_time_(?:ms|us)=(\d+)/.exec(text);
  if (microsMatch) {
    const seconds = Number(microsMatch[1]) / 1000000;
    job.progress = Math.min(0.98, Math.max(job.progress || 0, seconds / job.duration));
    return;
  }
  const timeMatch = /out_time=(\d+):(\d+):([\d.]+)/.exec(text);
  if (timeMatch) {
    const seconds = Number(timeMatch[1]) * 3600 + Number(timeMatch[2]) * 60 + Number(timeMatch[3]);
    job.progress = Math.min(0.98, Math.max(job.progress || 0, seconds / job.duration));
  }
}

function publicJob(job) {
  sampleJobBytes(job);
  return {
    id: job.id,
    status: job.status,
    filename: job.filename,
    outputPath: job.outputPath,
    size: job.size || 0,
    error: job.error || "",
    phase: job.phase || "",
    progress: Number(job.progress || 0),
    duration: Number(job.duration || 0),
    bytes: Number(job.bytes || 0),
    speed: Number(job.speed || 0),
    warning: job.warning || "",
    startedAt: job.startedAt,
    finishedAt: job.finishedAt || 0
  };
}

function cancelJob(job) {
  if (job.status === "done" || job.status === "error" || job.status === "canceled") {
    return;
  }
  job.status = "canceled";
  job.phase = "canceled";
  job.error = "已停止";
  job.finishedAt = Date.now();
  if (job.child && !job.child.killed) {
    job.child.kill("SIGTERM");
  }
  removeQuietly(job.tempPath);
}

function sampleJobBytes(job) {
  const path = job.status === "done" ? job.outputPath : job.tempPath;
  const bytes = fileSize(path);
  if (bytes) {
    job.bytes = bytes;
  }
  const now = Date.now();
  if (!job.lastSampleAt) {
    job.lastSampleAt = now;
    job.lastSampleBytes = job.bytes || 0;
    return;
  }
  const elapsed = (now - job.lastSampleAt) / 1000;
  if (elapsed < 0.35) {
    return;
  }
  const delta = Math.max(0, (job.bytes || 0) - (job.lastSampleBytes || 0));
  job.speed = delta / elapsed;
  job.lastSampleAt = now;
  job.lastSampleBytes = job.bytes || 0;
}

function sendJobFile(response, id) {
  const job = jobs.get(id);
  if (!job || job.status !== "done" || !job.outputPath || !existsSync(job.outputPath)) {
    sendJson(response, 404, { ok: false, error: "文件还没有准备好。" });
    return;
  }
  const size = fileSize(job.outputPath);
  response.writeHead(200, corsHeaders({
    "Content-Type": "video/mp4",
    "Content-Length": String(size),
    "Content-Disposition": `attachment; filename="${encodeURIComponent(job.filename)}"`
  }));
  createReadStream(job.outputPath).pipe(response);
}

function parseMediaUrl(value) {
  if (!value || typeof value !== "string") {
    throw new Error("缺少视频地址。");
  }
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("只处理 HTTP/HTTPS 视频地址。");
  }
  return url;
}

function rejectBlockedHosts(url) {
  const host = url.hostname.toLowerCase();
  if (host.includes("youtube.com") || host.includes("youtu.be") || host.includes("googlevideo.com")) {
    throw new Error("不处理 YouTube 或受保护站点。");
  }
}

function safeFilename(value) {
  return String(value || "video")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "video";
}

function ensureMp4Extension(value) {
  return extname(value).toLowerCase() === ".mp4" ? value : `${value.replace(/\.[a-z0-9]{1,5}$/i, "")}.mp4`;
}

function uniqueOutputPath(downloadDir, filename) {
  const clean = safeFilename(filename);
  const ext = extname(clean) || ".mp4";
  const stem = basename(clean, ext);
  let candidate = join(downloadDir, `${stem}${ext}`);
  let index = 2;
  while (existsSync(candidate) || existsSync(candidate.replace(/\.mp4$/i, ".part.mp4"))) {
    candidate = join(downloadDir, `${stem}-${index}${ext}`);
    index += 1;
  }
  mkdirSync(dirname(candidate), { recursive: true });
  return candidate;
}

function fileSize(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function removeQuietly(path) {
  try {
    unlinkSync(path);
  } catch {
    // Best effort cleanup.
  }
}

function resolveBinary(name, candidates) {
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  const result = spawnSync("which", [name], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function lastLine(text) {
  return String(text || "").trim().split(/\r?\n/).filter(Boolean).pop() || "未知错误";
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("请求过大。"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error("JSON 请求无效。"));
      }
    });
    request.on("error", reject);
  });
}

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    ...extra
  };
}

function sendJson(response, status, value) {
  response.writeHead(status, corsHeaders({ "Content-Type": "application/json; charset=utf-8" }));
  response.end(JSON.stringify(value));
}

function sendNoContent(response) {
  response.writeHead(204, corsHeaders());
  response.end();
}

let mainServerHandle = null;
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  listen()
    .then((handle) => {
      mainServerHandle = handle;
      const { host, port } = handle;
      console.log(`VidPocket helper listening at http://${host}:${port}`);
      console.log(`工作目录：${DEFAULT_WORK_DIR}`);
    })
    .catch((error) => {
      console.error(error.message || String(error));
      process.exit(1);
    });
}
