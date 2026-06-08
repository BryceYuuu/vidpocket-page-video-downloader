const MAX_ITEMS_PER_TAB = 250;
const MIN_STANDALONE_MEDIA_BYTES = 64 * 1024;
const DIRECT_MEDIA_EXT_RE = /\.(mp4|m4v|mov|webm|mkv|avi|mp3|m4a|aac|ogg|oga|opus|wav|flac)(?:[?#]|$)/i;
const PLAYLIST_EXT_RE = /\.(m3u8|mpd)(?:[?#]|$)/i;
const STREAM_SEGMENT_EXT_RE = /\.(m4s|cmf[av]|ts)(?:[?#]|$)/i;
const DIRECT_DOWNLOAD_KINDS = new Set(["video", "audio", "media"]);

const mediaByTab = new Map();
const probesInFlight = new Set();
const hlsProbesInFlight = new Set();

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
      const tabId = Number(message.tabId);
      return { ok: true, items: getCandidates(tabId) };
    }

    if (message.type === "clearTab") {
      const tabId = Number(message.tabId);
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
      const tabId = Number(message.tabId);
      const id = String(message.id || normalizeUrl(url));
      const candidate = getCandidate(tabId, id);
      const kind = candidate ? candidate.kind : String(message.kind || classifyMedia(url, ""));
      if (!candidate || !candidate.downloadable || !isDirectDownloadableUrl(url, kind, candidate.contentLength, candidate.hasPlaybackMetadata)) {
        return { ok: false, error: "这个资源不是可直接下载的文件地址。" };
      }
      const filename = cleanFilename(message.filename || message.label || guessLabel(url, ""));
      const downloadId = await downloadUrl(url, filename);
      return { ok: true, downloadId };
    }

    return { ok: false, error: "Unsupported message" };
  })()
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

  return true;
});

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
  if (kind === "hls" || kind === "dash") {
    return "";
  }
  return (context && context.thumbnail) || "";
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
  const count = getCandidates(tabId).length;
  chrome.action.setBadgeText({
    tabId,
    text: count ? String(Math.min(count, 99)) : ""
  });
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
