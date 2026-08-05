import { FFmpeg } from "../vendor/ffmpeg/ffmpeg/index.js";

const MAX_PLAYLIST_BYTES = 5 * 1024 * 1024;
const SEGMENT_CONCURRENCY = 6;
const activeJobs = new Map();
const objectUrls = new Map();
const thumbnailTasks = new Map();

let ffmpeg = null;
let ffmpegLoadPromise = null;
let ffmpegQueue = Promise.resolve();
let ffmpegActiveJobId = "";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target !== "offscreen") {
    return false;
  }

  (async () => {
    if (message.type === "ping") {
      return { ok: true };
    }
    if (message.type === "startHlsDownload") {
      return startHlsDownload(message.job || {});
    }
    if (message.type === "cancelHlsDownload") {
      return cancelHlsDownload(String(message.jobId || ""));
    }
    if (message.type === "generateHlsThumbnail") {
      return generateHlsThumbnail(message.item || {});
    }
    if (message.type === "releaseBlob") {
      releaseBlob(String(message.jobId || ""));
      return { ok: true };
    }
    return { ok: false, error: "Unsupported offscreen message" };
  })()
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));

  return true;
});

function startHlsDownload(job) {
  const jobId = String(job.id || "");
  if (!jobId || !/^https?:\/\//i.test(job.url || "")) {
    return { ok: false, error: "HLS 任务参数不完整。" };
  }
  if (activeJobs.has(jobId)) {
    return { ok: true, jobId };
  }

  const controller = new AbortController();
  activeJobs.set(jobId, { controller, job });
  runHlsDownload(job, controller.signal)
    .catch((error) => {
      reportJob(jobId, {
        status: error && error.name === "AbortError" ? "canceled" : "error",
        error: error && error.name === "AbortError" ? "已停止" : friendlyError(error),
        speed: 0
      });
    })
    .finally(() => activeJobs.delete(jobId));

  return { ok: true, jobId };
}

function cancelHlsDownload(jobId) {
  const task = activeJobs.get(jobId);
  if (task) {
    task.controller.abort();
  }
  if (ffmpegActiveJobId === jobId && ffmpeg) {
    ffmpeg.terminate();
    ffmpeg = null;
    ffmpegLoadPromise = null;
    ffmpegActiveJobId = "";
  }
  return { ok: true };
}

async function runHlsDownload(job, signal) {
  const jobId = String(job.id);
  reportJob(jobId, { status: "preparing", progress: 0.01, message: "解析 HLS" });

  const plan = await resolveHlsPlan(job.url, job.relatedHlsUrls, job.height, signal);
  assertNotEncrypted(plan.video);
  if (plan.audio) {
    assertNotEncrypted(plan.audio);
  }

  const totalUnits = plan.video.segments.length + (plan.audio ? plan.audio.segments.length : 0) +
    Number(Boolean(plan.video.map)) + Number(Boolean(plan.audio && plan.audio.map));
  if (!totalUnits) {
    throw new Error("HLS 清单中没有可下载的分片。");
  }

  const meter = createTransferMeter(jobId, totalUnits);
  reportJob(jobId, { status: "downloading", progress: 0.03, message: "下载分片" });
  const video = await downloadMediaPlaylist(plan.video, signal, meter);
  const audio = plan.audio ? await downloadMediaPlaylist(plan.audio, signal, meter) : null;
  throwIfAborted(signal);

  reportJob(jobId, {
    status: "processing",
    progress: 0.86,
    bytesReceived: meter.bytes,
    totalBytes: meter.bytes,
    speed: 0,
    message: "合并为 MP4"
  });

  let output;
  if (!audio && video.container === "ts") {
    try {
      output = transmuxTransportStream(video.parts);
    } catch {
      output = await remuxWithFfmpeg(jobId, video, null, signal);
    }
  } else if (!audio && video.container === "mp4") {
    output = concatenateParts(video.parts);
  } else {
    output = await remuxWithFfmpeg(jobId, video, audio, signal);
  }

  throwIfAborted(signal);
  if (!(output instanceof Uint8Array) || output.byteLength < 1024) {
    throw new Error("合并后的 MP4 无有效媒体数据。");
  }

  const blobUrl = URL.createObjectURL(new Blob([output], { type: "video/mp4" }));
  objectUrls.set(jobId, blobUrl);
  reportJob(jobId, {
    status: "saving",
    progress: 0.98,
    bytesReceived: output.byteLength,
    totalBytes: output.byteLength,
    speed: 0,
    message: "交给 Chrome 保存"
  });

  const saved = await sendBackgroundMessage({
    type: "hlsFileReady",
    jobId,
    blobUrl,
    filename: ensureMp4Filename(job.filename),
    size: output.byteLength
  });
  if (!saved || !saved.ok) {
    releaseBlob(jobId);
    throw new Error((saved && saved.error) || "Chrome 未能启动保存任务。");
  }
}

async function generateHlsThumbnail(item) {
  const url = String(item.url || "");
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: "无效的 HLS 地址" };
  }
  if (thumbnailTasks.has(url)) {
    return thumbnailTasks.get(url);
  }

  const task = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const plan = await resolveHlsPlan(url, item.relatedHlsUrls, item.height, controller.signal);
      assertNotEncrypted(plan.video);
      const previewPlaylist = {
        ...plan.video,
        segments: plan.video.segments.slice(0, 3)
      };
      const preview = await downloadMediaPlaylist(previewPlaylist, controller.signal, createSilentMeter());
      const bytes = preview.container === "ts"
        ? transmuxTransportStream(preview.parts)
        : concatenateParts(preview.parts);
      const frame = await captureVideoFrame(bytes, item.duration || plan.video.duration || 0);
      return {
        ok: true,
        thumbnail: frame.thumbnail,
        duration: frame.duration || plan.video.duration || 0,
        width: frame.width || plan.width || 0,
        height: frame.height || plan.height || 0
      };
    } finally {
      clearTimeout(timeout);
    }
  })()
    .catch((error) => ({ ok: false, error: friendlyError(error) }))
    .finally(() => thumbnailTasks.delete(url));

  thumbnailTasks.set(url, task);
  return task;
}

async function resolveHlsPlan(startUrl, relatedUrls = [], desiredHeight = 0, signal) {
  const cache = new Map();
  const load = async (url) => {
    const normalized = normalizeUrl(url);
    if (!cache.has(normalized)) {
      cache.set(normalized, fetchPlaylist(normalized, signal));
    }
    return cache.get(normalized);
  };

  const startText = await load(startUrl);
  if (isMasterPlaylist(startText)) {
    return planFromMaster(startText, startUrl, desiredHeight, load);
  }

  let audio = null;
  let width = 0;
  let height = Number(desiredHeight) || 0;
  const related = Array.from(new Set((Array.isArray(relatedUrls) ? relatedUrls : [])
    .filter((url) => /^https?:\/\//i.test(url || ""))
    .map(normalizeUrl)))
    .filter((url) => url !== normalizeUrl(startUrl))
    .slice(0, 16);

  for (const relatedUrl of related) {
    throwIfAborted(signal);
    let text;
    try {
      text = await load(relatedUrl);
    } catch {
      continue;
    }
    if (!isMasterPlaylist(text)) {
      continue;
    }
    const master = parseMasterPlaylist(text, relatedUrl);
    const matchingVariant = master.variants.find((variant) => normalizeUrl(variant.url) === normalizeUrl(startUrl));
    if (!matchingVariant) {
      continue;
    }
    width = matchingVariant.width;
    height = matchingVariant.height || height;
    const audioUrl = audioUrlForVariant(master, matchingVariant);
    if (audioUrl && normalizeUrl(audioUrl) !== normalizeUrl(startUrl)) {
      audio = parseMediaPlaylist(await load(audioUrl), audioUrl);
    }
    break;
  }

  return {
    video: parseMediaPlaylist(startText, startUrl),
    audio,
    width,
    height
  };
}

async function planFromMaster(text, masterUrl, desiredHeight, load) {
  const master = parseMasterPlaylist(text, masterUrl);
  const variant = chooseVariant(master.variants, desiredHeight);
  if (!variant) {
    throw new Error("HLS 主清单中没有视频清晰度。");
  }
  const videoText = await load(variant.url);
  if (isMasterPlaylist(videoText)) {
    return planFromMaster(videoText, variant.url, desiredHeight, load);
  }
  const audioUrl = audioUrlForVariant(master, variant);
  const audio = audioUrl ? parseMediaPlaylist(await load(audioUrl), audioUrl) : null;
  return {
    video: parseMediaPlaylist(videoText, variant.url),
    audio,
    width: variant.width,
    height: variant.height
  };
}

function parseMasterPlaylist(text, playlistUrl) {
  const lines = text.split(/\r?\n/);
  const audioGroups = new Map();
  const variants = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.startsWith("#EXT-X-MEDIA:")) {
      const attributes = parseAttributes(line.slice(line.indexOf(":") + 1));
      if (String(attributes.TYPE || "").toUpperCase() === "AUDIO" && attributes["GROUP-ID"] && attributes.URI) {
        const group = String(attributes["GROUP-ID"]);
        const entries = audioGroups.get(group) || [];
        entries.push({
          url: resolveUrl(attributes.URI, playlistUrl),
          isDefault: String(attributes.DEFAULT || "").toUpperCase() === "YES"
        });
        audioGroups.set(group, entries);
      }
      continue;
    }
    if (!line.startsWith("#EXT-X-STREAM-INF:")) {
      continue;
    }
    const attributes = parseAttributes(line.slice(line.indexOf(":") + 1));
    const uri = nextUri(lines, index + 1);
    if (!uri) {
      continue;
    }
    const resolution = /^(\d+)x(\d+)$/i.exec(attributes.RESOLUTION || "");
    variants.push({
      url: resolveUrl(uri, playlistUrl),
      width: Number(resolution && resolution[1]) || 0,
      height: Number(resolution && resolution[2]) || 0,
      bandwidth: Number(attributes["AVERAGE-BANDWIDTH"] || attributes.BANDWIDTH) || 0,
      audioGroup: String(attributes.AUDIO || "")
    });
  }
  return { variants, audioGroups };
}

function parseMediaPlaylist(text, playlistUrl) {
  if (!/^#EXTM3U/m.test(text) || isMasterPlaylist(text)) {
    throw new Error("该地址不是可下载的 HLS 媒体清单。");
  }
  const lines = text.split(/\r?\n/);
  const segments = [];
  const keys = [];
  let map = null;
  let pendingDuration = 0;
  let pendingRange = null;
  let previousRangeEnd = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (line.startsWith("#EXTINF:")) {
      pendingDuration = Number((/^#EXTINF:([\d.]+)/i.exec(line) || [])[1]) || 0;
      continue;
    }
    if (line.startsWith("#EXT-X-BYTERANGE:")) {
      pendingRange = parseByteRange(line.slice(line.indexOf(":") + 1), previousRangeEnd);
      if (pendingRange) {
        previousRangeEnd = pendingRange.end + 1;
      }
      continue;
    }
    if (line.startsWith("#EXT-X-MAP:")) {
      const attributes = parseAttributes(line.slice(line.indexOf(":") + 1));
      if (attributes.URI) {
        map = {
          url: resolveUrl(attributes.URI, playlistUrl),
          range: parseByteRange(attributes.BYTERANGE || "", 0)
        };
      }
      continue;
    }
    if (line.startsWith("#EXT-X-KEY:")) {
      keys.push(parseAttributes(line.slice(line.indexOf(":") + 1)));
      continue;
    }
    if (line.startsWith("#")) {
      continue;
    }
    segments.push({
      url: resolveUrl(line, playlistUrl),
      duration: pendingDuration,
      range: pendingRange
    });
    pendingDuration = 0;
    pendingRange = null;
  }

  return {
    url: playlistUrl,
    map,
    segments,
    keys,
    duration: segments.reduce((sum, segment) => sum + segment.duration, 0)
  };
}

async function downloadMediaPlaylist(playlist, signal, meter) {
  const segmentParts = await mapConcurrent(playlist.segments, SEGMENT_CONCURRENCY, async (segment) => {
    const bytes = await fetchBytes(segment.url, segment.range, signal, meter);
    meter.completeUnit();
    return bytes;
  });
  let init = null;
  if (playlist.map) {
    init = await fetchBytes(playlist.map.url, playlist.map.range, signal, meter);
    meter.completeUnit();
  }
  const container = detectContainer(init || segmentParts[0]);
  return {
    container,
    parts: init ? [init, ...segmentParts] : segmentParts
  };
}

async function fetchPlaylist(url, signal) {
  const response = await fetch(url, {
    credentials: "include",
    redirect: "follow",
    cache: "no-store",
    signal
  });
  if (!response.ok) {
    throw new Error(`HLS 清单请求失败（${response.status}）`);
  }
  const length = Number(response.headers.get("content-length")) || 0;
  if (length > MAX_PLAYLIST_BYTES) {
    throw new Error("HLS 清单异常过大。");
  }
  const text = await response.text();
  if (text.length > MAX_PLAYLIST_BYTES || !/^#EXTM3U/m.test(text)) {
    throw new Error("服务器未返回有效的 HLS 清单。");
  }
  return text;
}

async function fetchBytes(url, range, signal, meter) {
  const headers = {};
  if (range) {
    headers.Range = `bytes=${range.start}-${range.end}`;
  }
  const response = await fetch(url, {
    headers,
    credentials: "include",
    redirect: "follow",
    cache: "no-store",
    signal
  });
  if (!response.ok && response.status !== 206) {
    throw new Error(`视频分片请求失败（${response.status}）`);
  }

  const chunks = [];
  let total = 0;
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
      total += value.byteLength;
      meter.addBytes(value.byteLength);
    }
  } else {
    const bytes = new Uint8Array(await response.arrayBuffer());
    chunks.push(bytes);
    total = bytes.byteLength;
    meter.addBytes(total);
  }
  let bytes = concatenateParts(chunks, total);
  if (range && response.status === 200 && bytes.byteLength > range.end) {
    bytes = bytes.slice(range.start, range.end + 1);
  }
  return bytes;
}

function transmuxTransportStream(parts) {
  if (!globalThis.muxjs || !globalThis.muxjs.mp4 || !globalThis.muxjs.mp4.Transmuxer) {
    throw new Error("MP4 合并组件未加载。");
  }
  const transmuxer = new globalThis.muxjs.mp4.Transmuxer({ remux: true });
  const output = [];
  let wroteInit = false;
  transmuxer.on("data", (segment) => {
    if (!wroteInit && segment.initSegment && segment.initSegment.byteLength) {
      output.push(segment.initSegment);
      wroteInit = true;
    }
    if (segment.data && segment.data.byteLength) {
      output.push(segment.data);
    }
  });
  parts.forEach((part) => transmuxer.push(part));
  transmuxer.flush();
  if (!output.length) {
    throw new Error("该 HLS 编码无法在浏览器内合并。");
  }
  return concatenateParts(output);
}

async function remuxWithFfmpeg(jobId, video, audio, signal) {
  return queueFfmpeg(async () => {
    throwIfAborted(signal);
    ffmpegActiveJobId = jobId;
    const engine = await ensureFfmpeg();
    const token = jobId.replace(/[^a-z0-9]/gi, "").slice(-20) || Date.now().toString(36);
    const videoName = `video-${token}.${video.container === "ts" ? "ts" : "mp4"}`;
    const audioName = audio ? `audio-${token}.${audio.container === "ts" ? "ts" : "mp4"}` : "";
    const outputName = `output-${token}.mp4`;
    const cleanup = [videoName, audioName, outputName].filter(Boolean);
    const onProgress = ({ progress }) => {
      if (ffmpegActiveJobId !== jobId) {
        return;
      }
      const value = Number(progress);
      reportJob(jobId, {
        status: "processing",
        progress: Number.isFinite(value) ? 0.86 + Math.max(0, Math.min(1, value)) * 0.1 : 0.9,
        speed: 0,
        message: "封装音视频"
      });
    };
    engine.on("progress", onProgress);
    try {
      await engine.writeFile(videoName, concatenateParts(video.parts), { signal });
      if (audio) {
        await engine.writeFile(audioName, concatenateParts(audio.parts), { signal });
      }
      const args = audio
        ? ["-i", videoName, "-i", audioName, "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-shortest", "-movflags", "+faststart", outputName]
        : ["-i", videoName, "-c", "copy", "-movflags", "+faststart", outputName];
      const exitCode = await engine.exec(args, -1, { signal });
      if (exitCode !== 0) {
        throw new Error(`MP4 封装失败（${exitCode}）`);
      }
      return await engine.readFile(outputName, undefined, { signal });
    } finally {
      engine.off("progress", onProgress);
      for (const path of cleanup) {
        await engine.deleteFile(path).catch(() => {});
      }
      ffmpegActiveJobId = "";
    }
  });
}

function queueFfmpeg(task) {
  const result = ffmpegQueue.then(task, task);
  ffmpegQueue = result.catch(() => {});
  return result;
}

async function ensureFfmpeg() {
  if (ffmpeg && ffmpeg.loaded) {
    return ffmpeg;
  }
  if (!ffmpegLoadPromise) {
    ffmpeg = new FFmpeg();
    ffmpegLoadPromise = ffmpeg.load({
      coreURL: chrome.runtime.getURL("vendor/ffmpeg/core/ffmpeg-core.js"),
      wasmURL: chrome.runtime.getURL("vendor/ffmpeg/core/ffmpeg-core.wasm")
    }).then(() => ffmpeg).catch((error) => {
      ffmpeg = null;
      ffmpegLoadPromise = null;
      throw error;
    });
  }
  return ffmpegLoadPromise;
}

async function captureVideoFrame(bytes, knownDuration) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    await waitForMediaEvent(video, ["loadeddata", "canplay"], 12000);
    const duration = Number.isFinite(video.duration) ? video.duration : Number(knownDuration) || 0;
    if (duration > 0.2) {
      video.currentTime = Math.min(1, Math.max(0.1, duration / 4));
      await waitForMediaEvent(video, ["seeked", "loadeddata"], 8000);
    }
    const width = Number(video.videoWidth) || 320;
    const height = Number(video.videoHeight) || 180;
    const targetWidth = Math.min(320, width);
    const targetHeight = Math.max(90, Math.round(targetWidth * height / width));
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d", { alpha: false });
    context.drawImage(video, 0, 0, targetWidth, targetHeight);
    return {
      thumbnail: canvas.toDataURL("image/jpeg", 0.78),
      duration,
      width,
      height
    };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

function waitForMediaEvent(media, names, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      names.forEach((name) => media.removeEventListener(name, onReady));
      media.removeEventListener("error", onError);
      clearTimeout(timer);
    };
    const onReady = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("无法从该视频抽取预览帧。"));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("预览帧生成超时。"));
    }, timeoutMs);
    names.forEach((name) => media.addEventListener(name, onReady, { once: true }));
    media.addEventListener("error", onError, { once: true });
  });
}

function createTransferMeter(jobId, totalUnits) {
  const startedAt = performance.now();
  let lastReport = 0;
  return {
    bytes: 0,
    completed: 0,
    addBytes(count) {
      this.bytes += Number(count) || 0;
      const now = performance.now();
      if (now - lastReport < 180) {
        return;
      }
      lastReport = now;
      const seconds = Math.max(0.05, (now - startedAt) / 1000);
      reportJob(jobId, {
        status: "downloading",
        progress: 0.03 + (this.completed / Math.max(1, totalUnits)) * 0.8,
        bytesReceived: this.bytes,
        speed: this.bytes / seconds,
        message: "下载分片"
      });
    },
    completeUnit() {
      this.completed += 1;
      const seconds = Math.max(0.05, (performance.now() - startedAt) / 1000);
      reportJob(jobId, {
        status: "downloading",
        progress: 0.03 + (this.completed / Math.max(1, totalUnits)) * 0.8,
        bytesReceived: this.bytes,
        speed: this.bytes / seconds,
        message: `下载分片 ${this.completed}/${totalUnits}`
      });
    }
  };
}

function createSilentMeter() {
  return { bytes: 0, addBytes() {}, completeUnit() {} };
}

function reportJob(jobId, patch) {
  sendBackgroundMessage({ type: "hlsJobProgress", jobId, patch }).catch(() => {});
}

function sendBackgroundMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ ...message, target: "background" }, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

function releaseBlob(jobId) {
  const url = objectUrls.get(jobId);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrls.delete(jobId);
  }
}

function isMasterPlaylist(text) {
  return /#EXT-X-STREAM-INF:/i.test(text);
}

function chooseVariant(variants, desiredHeight) {
  const target = Number(desiredHeight) || 0;
  return [...variants].sort((a, b) => {
    if (target) {
      const aDistance = Math.abs((a.height || target) - target);
      const bDistance = Math.abs((b.height || target) - target);
      if (aDistance !== bDistance) {
        return aDistance - bDistance;
      }
    }
    return (b.height - a.height) || (b.bandwidth - a.bandwidth);
  })[0] || null;
}

function audioUrlForVariant(master, variant) {
  if (!variant.audioGroup) {
    return "";
  }
  const entries = master.audioGroups.get(variant.audioGroup) || [];
  return (entries.find((entry) => entry.isDefault) || entries[0] || {}).url || "";
}

function nextUri(lines, start) {
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line && !line.startsWith("#")) {
      return line;
    }
  }
  return "";
}

function parseAttributes(value) {
  const result = {};
  const pattern = /([A-Z0-9-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/gi;
  let match;
  while ((match = pattern.exec(value))) {
    let attribute = match[2].trim();
    if (attribute.startsWith('"') && attribute.endsWith('"')) {
      attribute = attribute.slice(1, -1).replace(/\\"/g, '"');
    }
    result[match[1].toUpperCase()] = attribute;
  }
  return result;
}

function parseByteRange(value, implicitStart) {
  const match = /^(\d+)(?:@(\d+))?$/.exec(String(value || "").replace(/^"|"$/g, "").trim());
  if (!match) {
    return null;
  }
  const length = Number(match[1]);
  const start = match[2] === undefined ? Number(implicitStart) || 0 : Number(match[2]);
  return { start, end: start + length - 1 };
}

function assertNotEncrypted(playlist) {
  const protectedKey = playlist.keys.find((key) => String(key.METHOD || "NONE").toUpperCase() !== "NONE");
  if (protectedKey) {
    throw new Error("该 HLS 使用了加密或 DRM，VidPocket 不会解密受保护视频。");
  }
}

function detectContainer(bytes) {
  if (!bytes || !bytes.byteLength) {
    throw new Error("视频分片为空。");
  }
  if (bytes[0] === 0x47 || (bytes.byteLength > 188 && bytes[188] === 0x47)) {
    return "ts";
  }
  const signature = String.fromCharCode(...bytes.slice(4, 8));
  if (["ftyp", "styp", "moof", "sidx"].includes(signature)) {
    return "mp4";
  }
  throw new Error("该 HLS 分片容器暂不支持。");
}

function concatenateParts(parts, knownLength = 0) {
  const total = knownLength || parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.byteLength;
  });
  return output;
}

async function mapConcurrent(items, limit, worker) {
  const output = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      output[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return output;
}

function resolveUrl(value, base) {
  return new URL(String(value || ""), base).href;
}

function normalizeUrl(value) {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

function ensureMp4Filename(value) {
  const clean = String(value || "video.mp4").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 160);
  return /\.mp4$/i.test(clean) ? clean : `${clean}.mp4`;
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    throw new DOMException("已停止", "AbortError");
  }
}

function friendlyError(error) {
  if (!error) {
    return "未知错误";
  }
  if (error.name === "AbortError") {
    return "已停止";
  }
  return String(error.message || error).replace(/^Error:\s*/i, "").slice(0, 240);
}

if (globalThis.__VIDPOCKET_TEST_MODE__) {
  globalThis.__VIDPOCKET_OFFSCREEN_TEST_API__ = {
    parseAttributes,
    parseMasterPlaylist,
    parseMediaPlaylist,
    chooseVariant,
    detectContainer,
    concatenateParts,
    transmuxTransportStream
  };
}
