const MAX_ITEMS_PER_TAB = 250;
const MIN_STANDALONE_MEDIA_BYTES = 64 * 1024;
const DIRECT_MEDIA_EXT_RE = /\.(mp4|m4v|mov|webm|mkv|avi|mp3|m4a|aac|ogg|oga|opus|wav|flac)(?:[?#]|$)/i;
const PLAYLIST_EXT_RE = /\.(m3u8|mpd)(?:[?#]|$)/i;
const STREAM_SEGMENT_EXT_RE = /\.(m4s|cmf[av]|ts)(?:[?#]|$)/i;
const DIRECT_DOWNLOAD_KINDS = new Set(["video", "audio", "media"]);
const JOB_STORAGE_KEY = "vidpocketDownloadJobs";
const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
const ACTIVE_JOB_STATES = new Set(["queued", "preparing", "downloading", "processing", "saving"]);
const MAX_X_TWEETS_PER_SCAN = 12;
const MAX_X_SYNDICATION_BYTES = 2 * 1024 * 1024;
const X_SYNDICATION_CACHE_MS = 2 * 60 * 1000;

const mediaByTab = new Map();
const probesInFlight = new Set();
const hlsProbesInFlight = new Set();
const thumbnailProbesInFlight = new Set();
const downloadJobs = new Map();
const xSyndicationCache = new Map();
const xSyndicationInFlight = new Map();
let jobsLoadPromise = loadStoredJobs();
let persistJobsTimer = 0;
let creatingOffscreenDocument = null;

chrome.action.setBadgeBackgroundColor({ color: "#0f766e" });

chrome.tabs.onRemoved.addListener((tabId) => {
  mediaByTab.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    mediaByTab.delete(tabId);
    updateBadge(tabId);
  }
});

if (chrome.downloads && chrome.downloads.onChanged) {
  chrome.downloads.onChanged.addListener((delta) => {
    handleChromeDownloadChanged(delta).catch(() => {});
  });
}

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0 || !details.url) {
      return;
    }

    const contentType = getHeader(details.responseHeaders, "content-type");
    const contentLength = Number(getHeader(details.responseHeaders, "content-length")) || 0;
    const contentDisposition = getHeader(details.responseHeaders, "content-disposition");

    if (!isCandidateMedia(details.url, contentType)) {
      return;
    }

    if (isLikelyMediaFragment(details.url, contentType, contentLength)) {
      return;
    }

    addCandidate(details.tabId, {
      url: details.url,
      kind: classifyMedia(details.url, contentType),
      source: "network",
      contentType,
      contentLength,
      contentDisposition,
      pageUrl: details.initiator || "",
      frameUrl: details.documentUrl || ""
    });
  },
  {
    urls: ["http://*/*", "https://*/*"],
    types: ["media", "xmlhttprequest", "other"]
  },
  ["responseHeaders"]
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.target && message.target !== "background") {
    return false;
  }
  (async () => {
    if (!message || typeof message.type !== "string") {
      return { ok: false, error: "Unknown message" };
    }

    if (message.type === "contentCandidates") {
      const tabId = sender.tab && sender.tab.id;
      if (typeof tabId !== "number") {
        return { ok: false, error: "Missing tab" };
      }
      const state = getTabState(tabId);
      state.context = {
        pageUrl: message.pageUrl || sender.tab.url || "",
        pageTitle: message.pageTitle || sender.tab.title || "",
        thumbnail: sanitizeThumbnail(message.pageThumbnail) || (state.context && state.context.thumbnail) || "",
        duration: Number(message.pageDuration || (state.context && state.context.duration)) || 0,
        width: Number(message.pageVideoWidth || (state.context && state.context.width)) || 0,
        height: Number(message.pageVideoHeight || (state.context && state.context.height)) || 0
      };
      backfillContext(tabId);
      const candidates = Array.isArray(message.candidates) ? message.candidates : [];
      candidates.forEach((candidate) => {
        addCandidate(tabId, {
          ...candidate,
          pageUrl: candidate.pageUrl || sender.tab.url || "",
          frameUrl: candidate.frameUrl || sender.url || ""
        });
      });
      return { ok: true, count: getCandidates(tabId).length };
    }

    if (message.type === "getCandidates") {
      const tabId = resolveTabId(message, sender);
      const state = mediaByTab.get(tabId);
      return { ok: true, items: getCandidates(tabId), xScan: state && state.xScan ? state.xScan : null };
    }

    if (message.type === "scanXTweets") {
      const tabId = resolveTabId(message, sender);
      return scanXTweetIds(tabId, message.tweetIds, {
        pageUrl: message.pageUrl || (sender.tab && sender.tab.url) || "",
        pageTitle: message.pageTitle || (sender.tab && sender.tab.title) || ""
      });
    }

    if (message.type === "clearTab") {
      const tabId = resolveTabId(message, sender);
      mediaByTab.delete(tabId);
      updateBadge(tabId);
      return { ok: true };
    }

    if (message.type === "removeCandidate") {
      const tabId = Number(message.tabId);
      const id = String(message.id || "");
      const state = mediaByTab.get(tabId);
      if (state && id) {
        state.items.delete(id);
        updateBadge(tabId);
      }
      return { ok: true };
    }

    if (message.type === "download") {
      const url = String(message.url || "");
      const tabId = resolveTabId(message, sender);
      const id = String(message.id || normalizeUrl(url));
      const candidate = getCandidate(tabId, id);
      const kind = candidate ? candidate.kind : String(message.kind || classifyMedia(url, ""));
      if (!candidate || !candidate.downloadable || !isDirectDownloadableUrl(url, kind, candidate.contentLength, candidate.hasPlaybackMetadata)) {
        return { ok: false, error: "这个资源不是可直接下载的文件地址。" };
      }
      const filename = cleanFilename(message.filename || message.label || guessLabel(url, ""));
      const job = await startDirectDownloadJob({ tabId, candidate, url, filename });
      return { ok: true, downloadId: job.downloadId, job };
    }

    if (message.type === "startHlsDownload") {
      const tabId = resolveTabId(message, sender);
      const id = String(message.id || normalizeUrl(message.url || ""));
      const candidate = getCandidate(tabId, id);
      if (!candidate || candidate.kind !== "hls" || !/^https?:\/\//i.test(candidate.url)) {
        return { ok: false, error: "该条目不是可处理的 HLS 资源。" };
      }
      const job = await startHlsDownloadJob(tabId, candidate, message.filename || "");
      return { ok: true, job };
    }

    if (message.type === "getDownloadJobs") {
      await jobsLoadPromise;
      await refreshChromeDownloadJobs();
      const tabId = resolveTabId(message, sender);
      return { ok: true, jobs: getDownloadJobs(tabId) };
    }

    if (message.type === "cancelDownloadJob") {
      await jobsLoadPromise;
      const job = downloadJobs.get(String(message.jobId || ""));
      if (!job) {
        return { ok: false, error: "下载任务不存在。" };
      }
      await cancelDownloadJob(job);
      return { ok: true };
    }

    if (message.type === "requestHlsThumbnail") {
      const tabId = resolveTabId(message, sender);
      const id = String(message.id || "");
      return requestHlsThumbnail(tabId, id);
    }

    if (message.type === "hlsJobProgress") {
      assertOffscreenSender(sender);
      await jobsLoadPromise;
      updateDownloadJob(String(message.jobId || ""), message.patch || {});
      return { ok: true };
    }

    if (message.type === "hlsFileReady") {
      assertOffscreenSender(sender);
      await jobsLoadPromise;
      const jobId = String(message.jobId || "");
      const job = downloadJobs.get(jobId);
      if (!job || job.kind !== "hls") {
        return { ok: false, error: "HLS 任务不存在。" };
      }
      const downloadId = await downloadUrl(String(message.blobUrl || ""), cleanFilename(message.filename || job.filename));
      updateDownloadJob(jobId, {
        status: "saving",
        progress: 0.99,
        downloadId,
        bytesReceived: Number(message.size) || job.bytesReceived || 0,
        totalBytes: Number(message.size) || job.totalBytes || 0,
        message: "Chrome 正在保存"
      });
      return { ok: true, downloadId };
    }

    return { ok: false, error: "Unsupported message" };
  })()
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

  return true;
});

function resolveTabId(message, sender) {
  const explicit = Number(message && message.tabId);
  if (Number.isInteger(explicit) && explicit >= 0) {
    return explicit;
  }
  const senderId = sender && sender.tab && sender.tab.id;
  return typeof senderId === "number" ? senderId : NaN;
}

async function scanXTweetIds(tabId, rawTweetIds, pageContext = {}) {
  if (!Number.isInteger(Number(tabId)) || Number(tabId) < 0) {
    return { ok: false, error: "无法确定当前 X 标签页。" };
  }
  const tweetIds = Array.from(new Set((Array.isArray(rawTweetIds) ? rawTweetIds : [])
    .map((value) => String(value || "").trim())
    .filter((value) => /^\d{6,40}$/.test(value))))
    .slice(0, MAX_X_TWEETS_PER_SCAN);
  if (!tweetIds.length) {
    return { ok: true, requested: 0, found: 0 };
  }

  const state = getTabState(Number(tabId));
  state.context = {
    ...(state.context || {}),
    pageUrl: pageContext.pageUrl || (state.context && state.context.pageUrl) || "",
    pageTitle: pageContext.pageTitle || (state.context && state.context.pageTitle) || ""
  };
  state.xScan = {
    status: "loading",
    requested: tweetIds.length,
    found: 0,
    error: "",
    updatedAt: Date.now()
  };

  const settled = await Promise.allSettled(tweetIds.map((tweetId) => fetchXSyndicationCandidates(tweetId)));
  const mediaUrls = new Set();
  const errors = [];
  settled.forEach((result) => {
    if (result.status === "rejected") {
      errors.push(result.reason && result.reason.message ? result.reason.message : String(result.reason || "X 媒体查询失败"));
      return;
    }
    result.value.forEach((candidate) => {
      mediaUrls.add(candidate.url);
      addCandidate(Number(tabId), {
        ...candidate,
        pageUrl: pageContext.pageUrl || "",
        frameUrl: pageContext.pageUrl || ""
      });
    });
  });

  const found = mediaUrls.size;
  const allFailed = errors.length === tweetIds.length;
  state.xScan = {
    status: allFailed ? "error" : "done",
    requested: tweetIds.length,
    found,
    error: allFailed ? cleanXScanError(errors[0]) : "",
    updatedAt: Date.now()
  };
  updateBadge(Number(tabId));
  return {
    ok: !allFailed,
    requested: tweetIds.length,
    found,
    error: state.xScan.error
  };
}

async function fetchXSyndicationCandidates(tweetId) {
  const cached = xSyndicationCache.get(tweetId);
  if (cached && Date.now() - cached.savedAt < X_SYNDICATION_CACHE_MS) {
    return cached.candidates;
  }
  if (xSyndicationInFlight.has(tweetId)) {
    return xSyndicationInFlight.get(tweetId);
  }

  const task = (async () => {
    const token = xSyndicationToken(tweetId);
    const endpoint = new URL("https://cdn.syndication.twimg.com/tweet-result");
    endpoint.searchParams.set("id", tweetId);
    endpoint.searchParams.set("lang", "en");
    endpoint.searchParams.set("token", token);
    const response = await fetch(endpoint.href, {
      credentials: "omit",
      redirect: "follow",
      cache: "no-store"
    });
    if (response.status === 404) {
      xSyndicationCache.set(tweetId, { candidates: [], savedAt: Date.now() });
      return [];
    }
    if (!response.ok) {
      throw new Error(`X 公开媒体接口返回 ${response.status}`);
    }
    const declaredLength = Number(response.headers && response.headers.get && response.headers.get("content-length")) || 0;
    if (declaredLength > MAX_X_SYNDICATION_BYTES) {
      throw new Error("X 公开媒体结果过大");
    }
    const text = await response.text();
    if (!text || text.length > MAX_X_SYNDICATION_BYTES) {
      throw new Error("X 公开媒体结果无效");
    }
    const candidates = extractXSyndicationCandidates(JSON.parse(text), tweetId);
    xSyndicationCache.set(tweetId, { candidates, savedAt: Date.now() });
    return candidates;
  })().finally(() => {
    xSyndicationInFlight.delete(tweetId);
  });

  xSyndicationInFlight.set(tweetId, task);
  return task;
}

function xSyndicationToken(tweetId) {
  const numericId = BigInt(tweetId);
  const divisor = 1000000000000000n;
  const integerPart = Number(numericId / divisor);
  const fractionalPart = Number(numericId % divisor) / Number(divisor);
  return ((integerPart + fractionalPart) * Math.PI).toString(36).replace(/(0+|\.)/g, "") || "0";
}

function extractXSyndicationCandidates(payload, tweetId) {
  const results = new Map();
  const visited = new WeakSet();
  let visitedNodes = 0;

  visit(payload, {
    label: cleanXTweetLabel(payload && payload.text),
    thumbnail: "",
    duration: 0,
    width: 0,
    height: 0,
    mediaId: tweetId
  }, 0);
  return Array.from(results.values());

  function visit(value, inherited, depth) {
    if (value === null || value === undefined || depth > 32 || visitedNodes >= 12000) {
      return;
    }
    if (typeof value !== "object") {
      return;
    }
    if (visited.has(value)) {
      return;
    }
    visited.add(value);
    visitedNodes += 1;

    const videoInfo = objectOrEmpty(value.video_info || value.videoInfo);
    const additionalInfo = objectOrEmpty(value.additional_media_info || value.additionalMediaInfo);
    const originalInfo = objectOrEmpty(value.original_info || value.originalInfo);
    const duration = xDurationSeconds(firstPositiveNumber([
      value.duration_ms,
      value.duration_millis,
      value.durationMillis,
      value.durationMs,
      videoInfo.duration_ms,
      videoInfo.duration_millis,
      videoInfo.durationMillis,
      videoInfo.durationMs
    ]));
    const context = {
      label: cleanXTweetLabel(firstNonEmptyText([
        additionalInfo.title,
        value.full_text,
        value.fullText,
        value.text,
        inherited.label
      ])),
      thumbnail: firstXSyndicationImage([
        value.preview_image_url,
        value.previewImageUrl,
        value.media_url_https,
        value.media_url,
        value.poster,
        inherited.thumbnail
      ]),
      duration: duration || inherited.duration || 0,
      width: xSafeDimension(value.width || value.w || originalInfo.width || originalInfo.w) || inherited.width || 0,
      height: xSafeDimension(value.height || value.h || originalInfo.height || originalInfo.h) || inherited.height || 0,
      mediaId: firstNonEmptyText([value.media_key, value.mediaKey, value.id_str, value.id, inherited.mediaId], 100)
    };

    const variantArrays = [];
    if (Array.isArray(value.variants)) variantArrays.push(value.variants);
    if (Array.isArray(videoInfo.variants)) variantArrays.push(videoInfo.variants);
    const seenArrays = new Set();
    variantArrays.forEach((variants) => {
      if (seenArrays.has(variants)) return;
      seenArrays.add(variants);
      variants.forEach((variant) => {
        if (!variant || typeof variant !== "object") return;
        addXSyndicationVariant(results, variant.url || variant.src || "", {
          ...context,
          contentType: String(variant.content_type || variant.contentType || variant.type || ""),
          bitrate: firstPositiveNumber([variant.bitrate, variant.bit_rate, variant.bitRate])
        });
      });
    });

    if (Array.isArray(value)) {
      value.forEach((child) => visit(child, context, depth + 1));
      return;
    }
    Object.values(value).forEach((child) => visit(child, context, depth + 1));
  }
}

function addXSyndicationVariant(results, rawUrl, context) {
  const url = sanitizeXSyndicationMediaUrl(rawUrl);
  if (!url) {
    return;
  }
  const dimensions = xDimensionsFromMediaUrl(url);
  const isHls = /\.m3u8(?:[?#]|$)/i.test(url);
  const width = dimensions.width || Number(context.width) || 0;
  const height = dimensions.height || Number(context.height) || 0;
  const candidate = {
    url,
    kind: isHls ? "hls" : "video",
    source: "page-api",
    label: context.label || "X 视频",
    contentType: context.contentType || (isHls ? "application/x-mpegURL" : "video/mp4"),
    duration: Number(context.duration) || 0,
    width,
    height,
    quality: inferQuality(url, width, height),
    format: isHls ? "HLS" : "MP4",
    thumbnail: sanitizeXSyndicationImageUrl(context.thumbnail),
    mediaId: String(context.mediaId || ""),
    bitrate: Number(context.bitrate) || 0
  };
  const existing = results.get(url);
  results.set(url, existing ? {
    ...existing,
    ...candidate,
    label: candidate.label || existing.label,
    thumbnail: candidate.thumbnail || existing.thumbnail,
    duration: candidate.duration || existing.duration,
    width: candidate.width || existing.width,
    height: candidate.height || existing.height,
    quality: candidate.quality || existing.quality,
    bitrate: candidate.bitrate || existing.bitrate
  } : candidate);
}

function sanitizeXSyndicationMediaUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "video.twimg.com") {
      return "";
    }
    return /\.(?:mp4|m3u8)(?:[?#]|$)/i.test(url.href) ? url.href : "";
  } catch {
    return "";
  }
}

function sanitizeXSyndicationImageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname.toLowerCase() === "pbs.twimg.com" ? url.href : "";
  } catch {
    return "";
  }
}

function firstXSyndicationImage(values) {
  for (const value of values) {
    const url = sanitizeXSyndicationImageUrl(value);
    if (url) return url;
  }
  return "";
}

function xDimensionsFromMediaUrl(value) {
  const match = /(?:^|\/)(\d{2,4})x(\d{2,4})(?:\/|$)/.exec(String(value || ""));
  return match ? { width: Number(match[1]) || 0, height: Number(match[2]) || 0 } : { width: 0, height: 0 };
}

function xDurationSeconds(milliseconds) {
  const seconds = Number(milliseconds) / 1000;
  return seconds > 0 && seconds <= 24 * 60 * 60 ? seconds : 0;
}

function xSafeDimension(value) {
  const number = Number(value) || 0;
  return number > 0 && number <= 16384 ? number : 0;
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstPositiveNumber(values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

function firstNonEmptyText(values, maxLength = 180) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.replace(/\s+/g, " ").trim();
    if (text) return text.slice(0, maxLength);
  }
  return "";
}

function cleanXTweetLabel(value) {
  return String(value || "")
    .replace(/https:\/\/t\.co\/[A-Za-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function cleanXScanError(value) {
  const text = String(value || "X 视频解析失败").replace(/\s+/g, " ").trim();
  return text.slice(0, 160);
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

async function startDirectDownloadJob({ tabId, candidate, url, filename }) {
  await jobsLoadPromise;
  const existing = findActiveJob(tabId, candidate.id);
  if (existing) {
    return existing;
  }
  const job = createDownloadJob({
    tabId,
    sourceId: candidate.id,
    kind: "direct",
    url,
    filename,
    totalBytes: Number(candidate.contentLength) || 0
  });
  downloadJobs.set(job.id, job);
  persistJobsSoon();
  try {
    const downloadId = await downloadUrl(url, filename);
    return updateDownloadJob(job.id, {
      status: "downloading",
      progress: 0,
      downloadId,
      message: "Chrome 正在下载"
    });
  } catch (error) {
    updateDownloadJob(job.id, { status: "error", error: error.message || String(error) });
    throw error;
  }
}

async function startHlsDownloadJob(tabId, candidate, requestedFilename) {
  await jobsLoadPromise;
  const existing = findActiveJob(tabId, candidate.id);
  if (existing) {
    return existing;
  }
  const filename = ensureMp4Filename(cleanFilename(requestedFilename || candidate.label || "video"));
  const job = createDownloadJob({
    tabId,
    sourceId: candidate.id,
    kind: "hls",
    url: candidate.url,
    filename,
    totalBytes: 0
  });
  downloadJobs.set(job.id, job);
  persistJobsSoon();

  const response = await sendOffscreenMessage({
    type: "startHlsDownload",
    job: {
      ...job,
      pageUrl: candidate.pageUrl || "",
      height: candidate.height || qualityNumber(candidate.quality),
      relatedHlsUrls: getRelatedHlsUrls(tabId, candidate)
    }
  });
  if (!response || !response.ok) {
    const error = new Error((response && response.error) || "无法启动 HLS 处理任务。");
    updateDownloadJob(job.id, { status: "error", error: error.message });
    throw error;
  }
  return job;
}

function createDownloadJob({ tabId, sourceId, kind, url, filename, totalBytes }) {
  const now = Date.now();
  return {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    tabId: Number(tabId),
    sourceId: String(sourceId || ""),
    kind,
    url,
    filename,
    status: "queued",
    progress: 0,
    bytesReceived: 0,
    totalBytes: Number(totalBytes) || 0,
    speed: 0,
    message: "准备中",
    error: "",
    downloadId: null,
    createdAt: now,
    updatedAt: now,
    sampleBytes: 0,
    sampleAt: now
  };
}

function updateDownloadJob(jobId, patch) {
  const existing = downloadJobs.get(jobId);
  if (!existing) {
    return null;
  }
  const updated = {
    ...existing,
    ...patch,
    id: existing.id,
    tabId: existing.tabId,
    sourceId: existing.sourceId,
    kind: existing.kind,
    updatedAt: Date.now()
  };
  if (Number.isFinite(Number(updated.progress))) {
    updated.progress = Math.max(0, Math.min(1, Number(updated.progress)));
  } else {
    updated.progress = 0;
  }
  updated.bytesReceived = Math.max(0, Number(updated.bytesReceived) || 0);
  updated.totalBytes = Math.max(0, Number(updated.totalBytes) || 0);
  updated.speed = Math.max(0, Number(updated.speed) || 0);
  updated.error = String(updated.error || "").slice(0, 240);
  updated.message = String(updated.message || "").slice(0, 100);
  downloadJobs.set(jobId, updated);
  persistJobsSoon();
  return updated;
}

function findActiveJob(tabId, sourceId) {
  return Array.from(downloadJobs.values()).find((job) =>
    job.tabId === Number(tabId) && job.sourceId === String(sourceId) && ACTIVE_JOB_STATES.has(job.status)
  ) || null;
}

function getDownloadJobs(tabId) {
  cleanupDownloadJobs();
  return Array.from(downloadJobs.values())
    .filter((job) => !Number.isFinite(Number(tabId)) || job.tabId === Number(tabId))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(({ sampleBytes: _sampleBytes, sampleAt: _sampleAt, ...job }) => job);
}

async function cancelDownloadJob(job) {
  if (typeof job.downloadId === "number") {
    await cancelChromeDownload(job.downloadId).catch(() => {});
  }
  if (job.kind === "hls") {
    await sendOffscreenMessage({ type: "cancelHlsDownload", jobId: job.id }).catch(() => {});
  }
  updateDownloadJob(job.id, {
    status: "canceled",
    speed: 0,
    message: "已停止",
    error: ""
  });
}

async function requestHlsThumbnail(tabId, id) {
  const candidate = getCandidate(tabId, id);
  if (!candidate || candidate.kind !== "hls") {
    return { ok: false, error: "HLS 条目不存在。" };
  }
  if (candidate.thumbnail) {
    return { ok: true, thumbnail: candidate.thumbnail };
  }
  const key = `${tabId}:${id}`;
  if (thumbnailProbesInFlight.has(key)) {
    return { ok: true, pending: true };
  }
  thumbnailProbesInFlight.add(key);
  candidate.previewStatus = "pending";
  try {
    const result = await sendOffscreenMessage({
      type: "generateHlsThumbnail",
      item: {
        id,
        url: candidate.url,
        duration: candidate.duration || 0,
        height: candidate.height || qualityNumber(candidate.quality),
        relatedHlsUrls: getRelatedHlsUrls(tabId, candidate)
      }
    });
    const state = mediaByTab.get(tabId);
    const current = state && state.items.get(id);
    if (!current) {
      return result;
    }
    if (!result || !result.ok || !sanitizeThumbnail(result.thumbnail)) {
      state.items.set(id, {
        ...current,
        previewStatus: "failed",
        previewError: String((result && result.error) || "无法从该流抽取画面。").slice(0, 160)
      });
      return result || { ok: false, error: "预览生成失败。" };
    }
    state.items.set(id, {
      ...current,
      thumbnail: sanitizeThumbnail(result.thumbnail),
      previewStatus: "done",
      previewError: "",
      duration: current.duration || Number(result.duration) || 0,
      width: current.width || Number(result.width) || 0,
      height: current.height || Number(result.height) || 0,
      quality: current.quality || inferQuality(current.url, Number(result.width) || 0, Number(result.height) || 0),
      lastSeen: Date.now()
    });
    return result;
  } finally {
    thumbnailProbesInFlight.delete(key);
  }
}

function getRelatedHlsUrls(tabId, candidate) {
  const state = mediaByTab.get(tabId);
  if (!state) {
    return [candidate.url];
  }
  return Array.from(state.items.values())
    .filter((item) => item.kind === "hls")
    .filter((item) => {
      if (candidate.mediaId && item.mediaId) {
        return candidate.mediaId === item.mediaId;
      }
      return !candidate.pageUrl || !item.pageUrl || candidate.pageUrl === item.pageUrl;
    })
    .map((item) => item.url)
    .slice(0, 24);
}

async function handleChromeDownloadChanged(delta) {
  await jobsLoadPromise;
  const job = Array.from(downloadJobs.values()).find((item) => item.downloadId === delta.id);
  if (!job) {
    return;
  }
  if (delta.state && delta.state.current === "complete") {
    updateDownloadJob(job.id, {
      status: "complete",
      progress: 1,
      speed: 0,
      message: "已保存",
      error: ""
    });
    releaseOffscreenBlob(job);
    return;
  }
  if (delta.state && delta.state.current === "interrupted") {
    updateDownloadJob(job.id, {
      status: delta.error && delta.error.current === "USER_CANCELED" ? "canceled" : "error",
      speed: 0,
      message: "下载中断",
      error: delta.error && delta.error.current ? delta.error.current : "下载中断"
    });
    releaseOffscreenBlob(job);
  }
}

async function refreshChromeDownloadJobs() {
  const jobs = Array.from(downloadJobs.values()).filter((job) => typeof job.downloadId === "number" && ACTIVE_JOB_STATES.has(job.status));
  await Promise.all(jobs.map(async (job) => {
    const item = await searchChromeDownload(job.downloadId).catch(() => null);
    if (!item) {
      return;
    }
    const now = Date.now();
    const bytesReceived = Number(item.bytesReceived) || 0;
    const elapsed = Math.max(0.1, (now - (job.sampleAt || now)) / 1000);
    const speed = Math.max(0, bytesReceived - (job.sampleBytes || 0)) / elapsed;
    const totalBytes = Number(item.totalBytes) || job.totalBytes || 0;
    if (item.state === "complete") {
      updateDownloadJob(job.id, { status: "complete", progress: 1, bytesReceived, totalBytes, speed: 0, message: "已保存" });
      releaseOffscreenBlob(job);
      return;
    }
    if (item.state === "interrupted") {
      updateDownloadJob(job.id, { status: "error", bytesReceived, totalBytes, speed: 0, message: "下载中断", error: item.error || "下载中断" });
      releaseOffscreenBlob(job);
      return;
    }
    updateDownloadJob(job.id, {
      status: job.status === "saving" ? "saving" : "downloading",
      progress: totalBytes ? Math.min(0.99, bytesReceived / totalBytes) : job.progress,
      bytesReceived,
      totalBytes,
      speed,
      sampleBytes: bytesReceived,
      sampleAt: now,
      message: item.paused ? "已暂停" : (job.kind === "hls" ? "Chrome 正在保存" : "Chrome 正在下载")
    });
  }));
}

function releaseOffscreenBlob(job) {
  if (job.kind !== "hls") {
    return;
  }
  sendOffscreenMessage({ type: "releaseBlob", jobId: job.id }).catch(() => {});
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen || typeof chrome.offscreen.createDocument !== "function") {
    throw new Error("当前 Chrome 版本不支持扩展内 HLS 处理。");
  }
  const documentUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  let exists = false;
  if (typeof chrome.runtime.getContexts === "function") {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [documentUrl]
    });
    exists = contexts.length > 0;
  } else if (typeof clients !== "undefined" && clients.matchAll) {
    const matched = await clients.matchAll();
    exists = matched.some((client) => client.url === documentUrl);
  }
  if (exists) {
    return;
  }
  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ["BLOBS", "WORKERS"],
      justification: "Download and locally merge user-selected unencrypted HLS segments into an MP4 file."
    }).finally(() => {
      creatingOffscreenDocument = null;
    });
  }
  await creatingOffscreenDocument;
}

async function sendOffscreenMessage(message) {
  await ensureOffscreenDocument();
  return sendRuntimeMessage({ ...message, target: "offscreen" });
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

function assertOffscreenSender(sender) {
  const expected = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  if (!sender || sender.url !== expected) {
    throw new Error("拒绝未验证的媒体处理消息。");
  }
}

async function loadStoredJobs() {
  if (!chrome.storage || !chrome.storage.local) {
    return;
  }
  try {
    const result = await storageGet(JOB_STORAGE_KEY);
    const stored = Array.isArray(result && result[JOB_STORAGE_KEY]) ? result[JOB_STORAGE_KEY] : [];
    stored.slice(-100).forEach((raw) => {
      if (!raw || !raw.id) {
        return;
      }
      const job = { ...raw };
      if (job.kind === "hls" && ACTIVE_JOB_STATES.has(job.status) && typeof job.downloadId !== "number") {
        job.status = "error";
        job.error = "浏览器重启后 HLS 处理任务已中断，请重新下载。";
        job.speed = 0;
      }
      downloadJobs.set(job.id, job);
    });
  } catch {
    // Download history is optional; current-session downloads still work.
  }
}

function persistJobsSoon() {
  if (!chrome.storage || !chrome.storage.local) {
    return;
  }
  clearTimeout(persistJobsTimer);
  persistJobsTimer = setTimeout(() => {
    cleanupDownloadJobs();
    const stored = Array.from(downloadJobs.values()).slice(-100);
    storageSet({ [JOB_STORAGE_KEY]: stored }).catch(() => {});
  }, 300);
}

function cleanupDownloadJobs() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  Array.from(downloadJobs.entries()).forEach(([id, job]) => {
    if (job.updatedAt < cutoff && !ACTIVE_JOB_STATES.has(job.status)) {
      downloadJobs.delete(id);
    }
  });
}

function storageGet(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result || {});
    });
  });
}

function storageSet(value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(value, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function searchChromeDownload(downloadId) {
  return new Promise((resolve, reject) => {
    chrome.downloads.search({ id: downloadId }, (items) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(items && items[0] ? items[0] : null);
    });
  });
}

function cancelChromeDownload(downloadId) {
  return new Promise((resolve, reject) => {
    chrome.downloads.cancel(downloadId, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function ensureMp4Filename(value) {
  return /\.mp4$/i.test(value) ? value : `${value}.mp4`;
}

function qualityNumber(value) {
  return Number((/(\d{3,4})p/i.exec(String(value || "")) || [])[1]) || 0;
}

function addCandidate(tabId, rawCandidate) {
  const url = sanitizeUrl(rawCandidate.url);
  const forcedMediaElementHit = rawCandidate.force === true;
  if (!url || (!forcedMediaElementHit && !isCandidateMedia(url, rawCandidate.contentType || ""))) {
    return false;
  }

  const state = getTabState(tabId);
  const tabContext = state.context || {};
  const id = normalizeUrl(url);
  const existing = state.items.get(id);
  const now = Date.now();
  const width = Number(rawCandidate.width || (existing && existing.width)) || 0;
  const height = Number(rawCandidate.height || (existing && existing.height)) || 0;
  const contentType = rawCandidate.contentType || (existing && existing.contentType) || "";
  const contentLength = rawCandidate.contentLength || (existing && existing.contentLength) || 0;
  const hasPlaybackMetadata = Boolean(width || height || rawCandidate.duration || (existing && existing.duration));
  if (isLikelyMediaFragment(url, contentType, contentLength) && !hasPlaybackMetadata) {
    if (existing) {
      state.items.delete(id);
      updateBadge(tabId);
    }
    return false;
  }

  const kind = rawCandidate.kind || (existing && existing.kind) || classifyMedia(url, contentType);
  const needsProbe = needsDirectMediaProbe(url, kind, contentLength, hasPlaybackMetadata);
  const downloadable = isDirectDownloadableUrl(url, kind, contentLength, hasPlaybackMetadata) && !needsProbe;

  const candidate = {
    id,
    url,
    kind,
    source: mergeSource(existing && existing.source, rawCandidate.source || "dom"),
    label: rawCandidate.label || (existing && existing.label) || guessLabel(url, rawCandidate.contentDisposition || "") || tabContext.pageTitle || "media",
    pageUrl: rawCandidate.pageUrl || (existing && existing.pageUrl) || "",
    frameUrl: rawCandidate.frameUrl || (existing && existing.frameUrl) || "",
    contentType,
    contentLength,
    hasPlaybackMetadata,
    duration: Number(rawCandidate.duration || (existing && existing.duration) || tabContext.duration) || 0,
    width: width || tabContext.width || 0,
    height: height || tabContext.height || 0,
    quality: rawCandidate.quality || (existing && existing.quality) || inferQuality(url, width, height),
    format: bestFormat(rawCandidate.format, existing && existing.format, formatFor(url, kind, contentType)),
    thumbnail: sanitizeThumbnail(rawCandidate.thumbnail) || (existing && existing.thumbnail) || thumbnailFromContext(kind, tabContext),
    previewStatus: rawCandidate.previewStatus || (existing && existing.previewStatus) || "",
    previewError: rawCandidate.previewError || (existing && existing.previewError) || "",
    mediaId: rawCandidate.mediaId || (existing && existing.mediaId) || "",
    downloadable,
    probeStatus: needsProbe ? "checking" : ((downloadable || !DIRECT_DOWNLOAD_KINDS.has(kind)) ? "done" : "blocked"),
    firstSeen: (existing && existing.firstSeen) || now,
    lastSeen: now
  };

  state.items.delete(id);
  state.items.set(id, candidate);

  while (state.items.size > MAX_ITEMS_PER_TAB) {
    const oldestKey = state.items.keys().next().value;
    state.items.delete(oldestKey);
  }

  updateBadge(tabId);
  if (needsProbe) {
    scheduleProbe(tabId, id, url);
  }
  if (kind === "hls") {
    scheduleHlsProbe(tabId, id, url);
  }
  return true;
}

function backfillContext(tabId) {
  const state = mediaByTab.get(tabId);
  if (!state || !state.context) {
    return;
  }
  const context = state.context;
  const now = Date.now();
  for (const [id, item] of state.items.entries()) {
    const updated = {
      ...item,
      label: item.label || context.pageTitle || item.label,
      thumbnail: item.thumbnail || thumbnailFromContext(item.kind, context),
      duration: item.duration || context.duration || 0,
      width: item.width || context.width || 0,
      height: item.height || context.height || 0,
      quality: item.quality || inferQuality(item.url, context.width || 0, context.height || 0),
      lastSeen: now
    };
    state.items.set(id, updated);
  }
  updateBadge(tabId);
}

function getTabState(tabId) {
  if (!mediaByTab.has(tabId)) {
    mediaByTab.set(tabId, { items: new Map(), context: {} });
  }
  return mediaByTab.get(tabId);
}

function thumbnailFromContext(kind, context) {
  // A page-level image cannot be safely associated with one item on multi-video pages.
  return "";
}

function getCandidates(tabId) {
  const state = mediaByTab.get(tabId);
  if (!state) {
    return [];
  }
  return Array.from(state.items.values()).sort((a, b) => b.lastSeen - a.lastSeen);
}

function getCandidate(tabId, id) {
  const state = mediaByTab.get(tabId);
  return state ? state.items.get(id) : null;
}

function updateBadge(tabId) {
  const count = getCandidates(tabId).filter(isBadgeCandidate).length;
  chrome.action.setBadgeText({
    tabId,
    text: count ? String(Math.min(count, 99)) : ""
  });
}

function isBadgeCandidate(item) {
  return item && (
    item.kind === "hls" ||
    (DIRECT_DOWNLOAD_KINDS.has(item.kind) && (item.downloadable || item.probeStatus === "checking"))
  );
}

function getHeader(headers, name) {
  if (!Array.isArray(headers)) {
    return "";
  }
  const match = headers.find((header) => header.name && header.name.toLowerCase() === name);
  return match && typeof match.value === "string" ? match.value : "";
}

function sanitizeUrl(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const url = new URL(trimmed);
    if (["http:", "https:", "blob:", "data:"].includes(url.protocol)) {
      return url.href;
    }
  } catch {
    return "";
  }
  return "";
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") {
      url.hash = "";
    }
    return url.href;
  } catch {
    return value;
  }
}

function isCandidateMedia(url, contentType = "") {
  if (!url) {
    return false;
  }
  if (url.startsWith("blob:") || url.startsWith("data:")) {
    return true;
  }

  const lowerType = contentType.toLowerCase();
  if (STREAM_SEGMENT_EXT_RE.test(url) && !isPlaylistType(lowerType)) {
    return false;
  }
  return DIRECT_MEDIA_EXT_RE.test(url) ||
    PLAYLIST_EXT_RE.test(url) ||
    lowerType.startsWith("video/") ||
    lowerType.startsWith("audio/") ||
    isPlaylistType(lowerType);
}

function classifyMedia(url, contentType = "") {
  const lowerType = contentType.toLowerCase();
  if (url.startsWith("blob:")) {
    return "blob";
  }
  if (url.startsWith("data:")) {
    return "inline";
  }
  if (/\.m3u8(?:[?#]|$)/i.test(url) || isHlsType(lowerType)) {
    return "hls";
  }
  if (/\.mpd(?:[?#]|$)/i.test(url) || isDashType(lowerType)) {
    return "dash";
  }
  if (lowerType.startsWith("audio/") || /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(?:[?#]|$)/i.test(url)) {
    return "audio";
  }
  if (lowerType.startsWith("video/") || DIRECT_MEDIA_EXT_RE.test(url)) {
    return "video";
  }
  return "media";
}

function isLikelyMediaFragment(url, contentType = "", contentLength = 0) {
  if (!url || isPlaylistType(contentType.toLowerCase()) || PLAYLIST_EXT_RE.test(url)) {
    return false;
  }
  const lowerType = contentType.toLowerCase();
  const looksLikeMedia = lowerType.startsWith("video/") ||
    lowerType.startsWith("audio/") ||
    DIRECT_MEDIA_EXT_RE.test(url);
  if (!looksLikeMedia) {
    return false;
  }
  if (STREAM_SEGMENT_EXT_RE.test(url)) {
    return true;
  }
  const lowerUrl = url.toLowerCase();
  if (/(?:^|\/)(?:init|chunk|segment|fragment|frag|part)(?:[-_.]?\d*)?\.(?:mp4|m4s|ts)(?:[?#]|$)/.test(lowerUrl)) {
    return true;
  }
  return contentLength > 0 && contentLength < MIN_STANDALONE_MEDIA_BYTES;
}

function isPlaylistType(contentType) {
  return isHlsType(contentType) || isDashType(contentType);
}

function isHlsType(contentType) {
  return contentType.includes("mpegurl") ||
    contentType.includes("x-mpegurl");
}

function isDashType(contentType) {
  return contentType.includes("dash+xml") ||
    contentType.includes("mpd");
}

function isDirectDownloadableUrl(url, kind, contentLength = 0, hasPlaybackMetadata = false) {
  return /^https?:\/\//i.test(url) &&
    DIRECT_DOWNLOAD_KINDS.has(kind) &&
    (!contentLength || contentLength >= MIN_STANDALONE_MEDIA_BYTES || hasPlaybackMetadata);
}

function needsDirectMediaProbe(url, kind, contentLength, hasPlaybackMetadata) {
  return /^https?:\/\//i.test(url) &&
    DIRECT_DOWNLOAD_KINDS.has(kind) &&
    !contentLength &&
    !hasPlaybackMetadata;
}

function scheduleProbe(tabId, id, url) {
  const probeKey = `${tabId}:${id}`;
  if (probesInFlight.has(probeKey)) {
    return;
  }
  probesInFlight.add(probeKey);

  probeMediaUrl(url)
    .then((result) => applyProbeResult(tabId, id, result))
    .catch(() => applyProbeResult(tabId, id, { ok: false }))
    .finally(() => probesInFlight.delete(probeKey));
}

async function probeMediaUrl(url) {
  const head = await fetchProbe(url, "HEAD");
  if (head.ok && (head.contentLength || head.contentType)) {
    return head;
  }
  return fetchProbe(url, "GET");
}

async function fetchProbe(url, method) {
  const headers = method === "GET" ? { Range: "bytes=0-0" } : {};
  const response = await fetch(url, {
    method,
    headers,
    credentials: "include",
    redirect: "follow",
    cache: "no-store"
  });
  const contentType = response.headers.get("content-type") || "";
  const contentLength = Number(response.headers.get("content-length")) || contentLengthFromRange(response.headers.get("content-range")) || 0;
  return {
    ok: response.ok || response.status === 206,
    contentType,
    contentLength
  };
}

function contentLengthFromRange(value) {
  if (!value) {
    return 0;
  }
  const match = /\/(\d+)\s*$/.exec(value);
  return match ? Number(match[1]) || 0 : 0;
}

function applyProbeResult(tabId, id, result) {
  const state = mediaByTab.get(tabId);
  const existing = state && state.items.get(id);
  if (!state || !existing) {
    return;
  }

  const contentType = result.contentType || existing.contentType || "";
  const contentLength = result.contentLength || existing.contentLength || 0;
  if (!result.ok || isLikelyMediaFragment(existing.url, contentType, contentLength)) {
    state.items.delete(id);
    updateBadge(tabId);
    return;
  }

  const kind = classifyMedia(existing.url, contentType || existing.contentType);
  const updated = {
    ...existing,
    kind,
    contentType,
    contentLength,
    format: bestFormat(existing.format, formatFor(existing.url, kind, contentType)),
    downloadable: isDirectDownloadableUrl(existing.url, kind, contentLength, existing.hasPlaybackMetadata),
    probeStatus: "done",
    lastSeen: Date.now()
  };

  state.items.set(id, updated);
  updateBadge(tabId);
}

function scheduleHlsProbe(tabId, id, url) {
  const probeKey = `${tabId}:${id}:hls`;
  if (hlsProbesInFlight.has(probeKey)) {
    return;
  }
  hlsProbesInFlight.add(probeKey);

  probeHlsMetadata(url)
    .then((metadata) => applyHlsMetadata(tabId, id, metadata))
    .catch(() => applyHlsMetadata(tabId, id, { ok: false }))
    .finally(() => hlsProbesInFlight.delete(probeKey));
}

async function probeHlsMetadata(url) {
  let playlistUrl = url;
  let playlist = await fetchText(playlistUrl);
  if (!playlist || !/^#EXTM3U/m.test(playlist)) {
    return { ok: false };
  }

  const variant = chooseHlsVariant(playlist, playlistUrl);
  if (variant) {
    playlistUrl = variant.url;
    playlist = await fetchText(playlistUrl);
  }

  return {
    ok: true,
    duration: sumHlsDuration(playlist),
    width: variant && variant.width ? variant.width : 0,
    height: variant && variant.height ? variant.height : 0,
    quality: variant && variant.height ? `${variant.height}p` : "",
    contentType: "application/x-mpegURL"
  };
}

async function fetchText(url) {
  const response = await fetch(url, {
    credentials: "include",
    redirect: "follow",
    cache: "no-store"
  });
  if (!response.ok) {
    return "";
  }
  return response.text();
}

function applyHlsMetadata(tabId, id, metadata) {
  const state = mediaByTab.get(tabId);
  const existing = state && state.items.get(id);
  if (!state || !existing || existing.kind !== "hls") {
    return;
  }

  const updated = {
    ...existing,
    contentType: existing.contentType || metadata.contentType || "",
    duration: Number(metadata.duration || existing.duration) || 0,
    width: existing.width || metadata.width || 0,
    height: existing.height || metadata.height || 0,
    quality: existing.quality || metadata.quality || inferQuality(existing.url, metadata.width || 0, metadata.height || 0),
    probeStatus: "done",
    lastSeen: Date.now()
  };

  state.items.set(id, updated);
  updateBadge(tabId);
}

function chooseHlsVariant(playlist, playlistUrl) {
  const lines = playlist.split(/\r?\n/);
  const variants = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line.startsWith("#EXT-X-STREAM-INF:")) {
      continue;
    }
    const next = nextHlsUri(lines, index + 1);
    if (!next) {
      continue;
    }
    const bandwidth = Number((/BANDWIDTH=(\d+)/i.exec(line) || [])[1]) || 0;
    const resolution = (/RESOLUTION=(\d+)x(\d+)/i.exec(line) || []);
    const width = Number(resolution[1]) || 0;
    const height = Number(resolution[2]) || 0;
    variants.push({
      url: new URL(next, playlistUrl).href,
      width,
      height,
      score: height * 100000000 + bandwidth
    });
  }
  variants.sort((a, b) => b.score - a.score);
  return variants[0] || null;
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

function sumHlsDuration(playlist) {
  return playlist.split(/\r?\n/).reduce((total, line) => {
    const match = /^#EXTINF:([\d.]+)/i.exec(line.trim());
    return total + (match ? Number(match[1]) || 0 : 0);
  }, 0);
}

function mergeSource(existing, next) {
  if (!existing) {
    return next;
  }
  if (!next || existing.split(", ").includes(next)) {
    return existing;
  }
  return `${existing}, ${next}`;
}

function guessLabel(url, contentDisposition = "") {
  const dispositionName = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(contentDisposition);
  if (dispositionName && dispositionName[1]) {
    return cleanFilename(decodeURIComponentSafe(dispositionName[1]));
  }

  try {
    const parsed = new URL(url);
    const lastPart = parsed.pathname.split("/").filter(Boolean).pop();
    if (lastPart) {
      return cleanFilename(decodeURIComponentSafe(lastPart));
    }
    return parsed.hostname || "media";
  } catch {
    return "media";
  }
}

function cleanFilename(value) {
  return String(value || "media")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .slice(0, 140) || "media";
}

function formatFor(url, kind, contentType = "") {
  if (kind === "fragment") {
    return "FRAG";
  }
  if (kind === "hls") {
    return "HLS";
  }
  if (kind === "dash") {
    return "DASH";
  }
  const lowerType = contentType.toLowerCase();
  const subtype = /^(?:video|audio)\/([^;]+)/i.exec(lowerType);
  if (subtype && subtype[1]) {
    return subtype[1].replace(/^x-/, "").toUpperCase();
  }
  const ext = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(url);
  return ext && ext[1] ? ext[1].toUpperCase() : kind.toUpperCase();
}

function bestFormat(...values) {
  const formats = values
    .filter(Boolean)
    .map((value) => String(value).trim().toUpperCase())
    .filter(Boolean);
  return formats.find((value) => value !== "MEDIA") || formats[0] || "MEDIA";
}

function inferQuality(url, width, height) {
  if (height >= 2160 || width >= 3840) {
    return "2160p";
  }
  if (height >= 1440 || width >= 2560) {
    return "1440p";
  }
  if (height >= 1080 || width >= 1920) {
    return "1080p";
  }
  if (height >= 720 || width >= 1280) {
    return "720p";
  }
  if (height >= 480 || width >= 854) {
    return "480p";
  }
  const pMatch = /(?:^|[\/._-])([1-9]\d{2,3})p(?:[\/._-]|$)/i.exec(url);
  if (pMatch) {
    return `${pMatch[1]}p`;
  }
  const sizeMatch = /(?:^|[^\d])(\d{3,4})x(\d{3,4})(?:[^\d]|$)/i.exec(url);
  if (sizeMatch) {
    return `${sizeMatch[2]}p`;
  }
  return "";
}

function sanitizeThumbnail(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (trimmed.startsWith("data:image/")) {
    return trimmed.slice(0, 180000);
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.href;
    }
  } catch {
    return "";
  }
  return "";
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function downloadUrl(url, filename = "") {
  return new Promise((resolve, reject) => {
    const options = { url, saveAs: false };
    if (filename) {
      options.filename = filename;
    }
    chrome.downloads.download(options, (downloadId) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(downloadId);
    });
  });
}
