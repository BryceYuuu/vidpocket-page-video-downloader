const DIRECT_MEDIA_EXT_RE = /\.(mp4|m4v|mov|webm|mkv|avi|mp3|m4a|aac|ogg|oga|opus|wav|flac)(?:[?#]|$)/i;
const PLAYLIST_EXT_RE = /\.(m3u8|mpd)(?:[?#]|$)/i;
const X_HOOK_RESPONSE_SOURCE = "vidpocket-x-media-hook";
const X_HOOK_REQUEST_SOURCE = "vidpocket-content";
const URL_ATTRIBUTES = [
  "src",
  "href",
  "poster",
  "data-src",
  "data-url",
  "data-href",
  "data-file",
  "data-video",
  "data-video-src",
  "data-video-url",
  "data-mp4",
  "data-webm",
  "data-hls"
];
const MEDIA_SELECTOR = [
  "video",
  "audio",
  "source",
  "a[href]",
  "[data-src]",
  "[data-url]",
  "[data-href]",
  "[data-file]",
  "[data-video]",
  "[data-video-src]",
  "[data-video-url]",
  "[data-mp4]",
  "[data-webm]",
  "[data-hls]"
].join(",");
let scanTimer = 0;
let lastPayload = "";
let lastXTweetIdPayload = "";
let nextMediaId = 1;
const mediaIds = new WeakMap();
const pageApiCandidates = new Map();

window.addEventListener("message", handleXMediaMessage);

scanSoon();
requestXMediaScan();
requestXSyndicationScan(true).catch(() => {});

document.addEventListener("loadedmetadata", scanSoon, true);
document.addEventListener("loadeddata", scanSoon, true);
document.addEventListener("play", scanSoon, true);

const observer = new MutationObserver(scanSoon);
observeDocument();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "scanNow") {
    requestXMediaScan();
    const candidates = scan();
    sendCandidates(candidates, true);
    requestXSyndicationScan(true)
      .then((xScan) => sendResponse({ ok: true, count: candidates.length, xScan }))
      .catch((error) => sendResponse({
        ok: true,
        count: candidates.length,
        xScan: { ok: false, error: error.message || String(error) }
      }));
    return true;
  }
  return false;
});

function scanSoon() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(() => {
    sendCandidates(scan(), false);
    requestXSyndicationScan(false).catch(() => {});
  }, 250);
}

function scan() {
  const candidates = new Map();

  pageApiCandidates.forEach((candidate) => {
    addCandidate(candidates, candidate.url, candidate);
  });

  document.querySelectorAll("video, audio").forEach((element) => {
    collectMediaElement(candidates, element);
  });

  document.querySelectorAll(MEDIA_SELECTOR).forEach((element) => {
    collectLinkedElement(candidates, element);
  });

  performance.getEntriesByType("resource").forEach((entry) => {
    if (!entry || typeof entry.name !== "string") {
      return;
    }
    if (isLikelyMediaUrl(entry.name)) {
      addCandidate(candidates, entry.name, {
        source: "performance",
        kind: inferKind(entry.name),
        label: labelFromUrl(entry.name),
        format: formatFor(entry.name),
        quality: inferQuality(entry.name, 0, 0)
      });
    }
  });

  return Array.from(candidates.values());
}

function collectMediaElement(candidates, element) {
  const mediaId = getMediaId(element);
  const urls = new Set();
  if (element.currentSrc) {
    urls.add(element.currentSrc);
  }
  if (element.src) {
    urls.add(element.src);
  }
  element.querySelectorAll("source[src]").forEach((source) => {
    urls.add(source.src || source.getAttribute("src"));
  });

  const width = Number(element.videoWidth || element.naturalWidth || 0);
  const height = Number(element.videoHeight || element.naturalHeight || 0);
  const duration = Number.isFinite(element.duration) ? element.duration : 0;
  const thumbnail = thumbnailForMedia(element);
  urls.forEach((url) => {
    const absoluteUrl = toAbsoluteUrl(url);
    addCandidate(candidates, absoluteUrl, {
      source: "dom",
      kind: inferKind(absoluteUrl, element),
      label: labelForElement(element, absoluteUrl),
      duration,
      width,
      height,
      quality: inferQuality(absoluteUrl, width, height),
      format: formatFor(absoluteUrl),
      thumbnail,
      mediaId,
      force: true
    });
  });
}

function collectLinkedElement(candidates, element) {
  URL_ATTRIBUTES.forEach((attribute) => {
    const value = element.getAttribute(attribute);
    if (!value) {
      return;
    }
    const absoluteUrl = toAbsoluteUrl(value);
    if (!absoluteUrl || !isLikelyMediaUrl(absoluteUrl)) {
      return;
    }
    addCandidate(candidates, absoluteUrl, {
      source: "dom",
      kind: inferKind(absoluteUrl, element),
      label: labelForElement(element, absoluteUrl),
      format: formatFor(absoluteUrl),
      quality: inferQuality(absoluteUrl, 0, 0),
      thumbnail: posterFromElement(element)
    });
  });
}

function addCandidate(map, url, details) {
  const cleanUrl = sanitizeUrl(url);
  if (!cleanUrl) {
    return;
  }
  if (!details.force && !cleanUrl.startsWith("blob:") && !cleanUrl.startsWith("data:") && !isLikelyMediaUrl(cleanUrl)) {
    return;
  }

  const key = normalizeUrl(cleanUrl);
  const existing = map.get(key) || {};
  map.set(key, {
    url: cleanUrl,
    kind: details.kind || existing.kind || inferKind(cleanUrl),
    source: mergeSource(existing.source, details.source || "dom"),
    label: firstUsefulLabel([details.label, existing.label, labelFromUrl(cleanUrl)]),
    pageUrl: location.href,
    frameUrl: location.href,
    duration: details.duration || existing.duration || 0,
    width: details.width || existing.width || 0,
    height: details.height || existing.height || 0,
    quality: details.quality || existing.quality || "",
    format: details.format || existing.format || formatFor(cleanUrl),
    thumbnail: details.thumbnail || existing.thumbnail || "",
    mediaId: details.mediaId || existing.mediaId || "",
    contentType: details.contentType || existing.contentType || "",
    bitrate: details.bitrate || existing.bitrate || 0
  });
}

function observeDocument() {
  const target = document.documentElement;
  if (!target) {
    document.addEventListener("readystatechange", observeDocument, { once: true });
    return;
  }
  observer.observe(target, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: URL_ATTRIBUTES
  });
}

function requestXMediaScan() {
  if (!isXPage()) {
    return;
  }
  window.postMessage({
    source: X_HOOK_REQUEST_SOURCE,
    type: "scan-x-media"
  }, "*");
}

async function requestXSyndicationScan(force) {
  if (!isXPage() || (window.top && window.top !== window)) {
    return { ok: true, skipped: true };
  }
  const tweetIds = collectVisibleXTweetIds();
  if (!tweetIds.length) {
    return { ok: true, skipped: true, requested: 0 };
  }
  const payload = tweetIds.join(",");
  if (!force && payload === lastXTweetIdPayload) {
    return { ok: true, skipped: true, requested: tweetIds.length };
  }
  lastXTweetIdPayload = payload;
  return sendRuntimeMessage({
    type: "scanXTweets",
    tweetIds,
    pageUrl: location.href,
    pageTitle: document.title || ""
  });
}

function collectVisibleXTweetIds() {
  const ids = new Set();
  addXTweetId(ids, location.href);

  const mediaRoots = new Set();
  document.querySelectorAll("video, [data-testid='videoPlayer'], [data-testid='videoComponent']").forEach((element) => {
    const root = element.closest && (element.closest("article") || element.closest("[data-testid='tweet']"));
    if (root) {
      mediaRoots.add(root);
    }
  });

  mediaRoots.forEach((root) => {
    root.querySelectorAll("a[href*='/status/']").forEach((link) => {
      addXTweetId(ids, link.href || link.getAttribute("href") || "");
    });
  });

  return Array.from(ids).slice(0, 12);
}

function addXTweetId(ids, value) {
  const id = xTweetIdFromUrl(value);
  if (id) {
    ids.add(id);
  }
}

function xTweetIdFromUrl(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  try {
    const url = new URL(value, location.href);
    if (!/(^|\.)(?:x\.com|twitter\.com)$/i.test(url.hostname)) {
      return "";
    }
    const match = /\/status\/(\d{6,40})(?:\/|$)/.exec(url.pathname);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

function handleXMediaMessage(event) {
  if (event.source !== window || !isXPage() || !event.data || event.data.source !== X_HOOK_RESPONSE_SOURCE || event.data.type !== "candidates") {
    return;
  }
  const candidates = Array.isArray(event.data.candidates) ? event.data.candidates.slice(0, 200) : [];
  let changed = false;
  candidates.forEach((rawCandidate) => {
    const candidate = normalizeXBridgeCandidate(rawCandidate);
    if (!candidate) {
      return;
    }
    const key = normalizeUrl(candidate.url);
    const previous = pageApiCandidates.get(key);
    const merged = previous ? {
      ...previous,
      ...candidate,
      label: candidate.label || previous.label || "",
      thumbnail: candidate.thumbnail || previous.thumbnail || "",
      duration: candidate.duration || previous.duration || 0,
      width: candidate.width || previous.width || 0,
      height: candidate.height || previous.height || 0,
      quality: candidate.quality || previous.quality || ""
    } : candidate;
    if (!previous || JSON.stringify(previous) !== JSON.stringify(merged)) {
      pageApiCandidates.set(key, merged);
      changed = true;
    }
  });
  if (changed) {
    sendCandidates(scan(), true);
  }
}

function normalizeXBridgeCandidate(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const url = sanitizeUrl(String(value.url || ""));
  if (!url || !isAllowedXMediaUrl(url)) {
    return null;
  }
  const thumbnail = sanitizeUrl(String(value.thumbnail || ""));
  const duration = Math.max(0, Math.min(24 * 60 * 60, Number(value.duration) || 0));
  const width = safeDimension(value.width);
  const height = safeDimension(value.height);
  const kind = /\.m3u8(?:[?#]|$)/i.test(url) ? "hls" : "video";
  return {
    url,
    kind,
    source: "page-api",
    label: String(value.label || "").replace(/\s+/g, " ").trim().slice(0, 140),
    pageUrl: location.href,
    frameUrl: location.href,
    duration,
    width,
    height,
    quality: String(value.quality || (height ? `${height}p` : "")).slice(0, 20),
    format: kind === "hls" ? "HLS" : "MP4",
    thumbnail: thumbnail && isAllowedXThumbnailUrl(thumbnail) ? thumbnail : "",
    mediaId: String(value.mediaId || "").slice(0, 100),
    contentType: kind === "hls" ? "application/x-mpegURL" : "video/mp4",
    bitrate: Math.max(0, Number(value.bitrate) || 0)
  };
}

function isXPage() {
  return /(^|\.)(?:x\.com|twitter\.com)$/i.test(location.hostname);
}

function isAllowedXMediaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.toLowerCase() === "video.twimg.com" && /\.(?:mp4|m3u8)(?:[?#]|$)/i.test(url.href);
  } catch {
    return false;
  }
}

function isAllowedXThumbnailUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.toLowerCase() === "pbs.twimg.com";
  } catch {
    return false;
  }
}

function safeDimension(value) {
  const number = Number(value) || 0;
  return number > 0 && number <= 16384 ? number : 0;
}

function sendCandidates(candidates, force) {
  const pagePreview = findPagePreview();
  const payload = JSON.stringify(candidates
    .map((candidate) => [
      candidate.url,
      candidate.duration,
      candidate.width,
      candidate.height,
      candidate.quality,
      candidate.thumbnail ? candidate.thumbnail.slice(0, 64) : ""
    ])
    .concat([[
      "page-preview",
      pagePreview.duration,
      pagePreview.width,
      pagePreview.height,
      "",
      pagePreview.thumbnail ? pagePreview.thumbnail.slice(0, 64) : ""
    ]])
    .sort((a, b) => a[0].localeCompare(b[0])));
  if (!force && payload === lastPayload) {
    return;
  }
  lastPayload = payload;

  try {
    const result = sendRuntimeMessage({
      type: "contentCandidates",
      pageUrl: location.href,
      pageTitle: document.title || "",
      pageThumbnail: pagePreview.thumbnail,
      pageDuration: pagePreview.duration,
      pageVideoWidth: pagePreview.width,
      pageVideoHeight: pagePreview.height,
      candidates
    });
    result.catch(() => {});
  } catch {
    // The extension context can disappear during reloads or extension updates.
  }
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function toAbsoluteUrl(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return "";
  }
  if (trimmed.startsWith("blob:") || trimmed.startsWith("data:")) {
    return trimmed;
  }
  try {
    return new URL(trimmed, document.baseURI).href;
  } catch {
    return "";
  }
}

function sanitizeUrl(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  try {
    const url = new URL(value);
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

function isLikelyMediaUrl(url) {
  return DIRECT_MEDIA_EXT_RE.test(url) || PLAYLIST_EXT_RE.test(url);
}

function inferKind(url, element) {
  if (url.startsWith("blob:")) {
    return "blob";
  }
  if (url.startsWith("data:")) {
    return "inline";
  }
  if (/\.m3u8(?:[?#]|$)/i.test(url)) {
    return "hls";
  }
  if (/\.mpd(?:[?#]|$)/i.test(url)) {
    return "dash";
  }
  if (element && element.tagName && element.tagName.toLowerCase() === "audio") {
    return "audio";
  }
  if (/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(?:[?#]|$)/i.test(url)) {
    return "audio";
  }
  return "video";
}

function formatFor(url) {
  if (/\.m3u8(?:[?#]|$)/i.test(url)) {
    return "HLS";
  }
  if (/\.mpd(?:[?#]|$)/i.test(url)) {
    return "DASH";
  }
  const ext = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(url);
  return ext && ext[1] ? ext[1].toUpperCase() : "MEDIA";
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

function thumbnailForMedia(element) {
  const poster = posterFromElement(element);
  if (poster) {
    return poster;
  }
  if (!element.videoWidth || !element.videoHeight || element.readyState < 2) {
    return "";
  }
  try {
    const canvas = document.createElement("canvas");
    const ratio = element.videoWidth / element.videoHeight;
    canvas.width = 160;
    canvas.height = Math.max(90, Math.round(160 / ratio));
    const context = canvas.getContext("2d");
    context.drawImage(element, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return "";
  }
}

function posterFromElement(element) {
  const poster = element.getAttribute("poster") || element.poster || "";
  const absolutePoster = toAbsoluteUrl(poster);
  return absolutePoster && !absolutePoster.startsWith("blob:") ? absolutePoster : "";
}

function findPagePreview() {
  const videoPreview = findBestVideoPreview();
  return {
    thumbnail: videoPreview.thumbnail || findMetadataThumbnail(),
    duration: videoPreview.duration || 0,
    width: videoPreview.width || 0,
    height: videoPreview.height || 0
  };
}

function findBestVideoPreview() {
  const videos = Array.from(document.querySelectorAll("video"))
    .map((element) => ({
      element,
      area: visibleArea(element)
    }))
    .filter((item) => item.area > 1200)
    .sort((a, b) => b.area - a.area);

  for (const { element } of videos) {
    const thumbnail = thumbnailForMedia(element);
    const duration = Number.isFinite(element.duration) ? element.duration : 0;
    const width = Number(element.videoWidth || 0);
    const height = Number(element.videoHeight || 0);
    if (thumbnail || duration || width || height) {
      return { thumbnail, duration, width, height };
    }
  }

  return { thumbnail: "", duration: 0, width: 0, height: 0 };
}

function findMetadataThumbnail() {
  const selectors = [
    "meta[property='og:image']",
    "meta[name='og:image']",
    "meta[name='twitter:image']",
    "meta[property='twitter:image']",
    "link[rel='image_src']"
  ];
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    const value = element && (element.getAttribute("content") || element.getAttribute("href"));
    const url = toAbsoluteUrl(value || "");
    if (url && !url.startsWith("blob:") && !url.startsWith("data:")) {
      return url;
    }
  }
  const poster = document.querySelector("video[poster]");
  if (poster) {
    return posterFromElement(poster);
  }
  return "";
}

function labelForElement(element, url) {
  const aria = element.getAttribute("aria-label");
  const title = element.getAttribute("title");
  const download = element.getAttribute("download");
  const text = textLabel(element);
  return firstUsefulLabel([download, aria, title, text, labelFromUrl(url), document.title]);
}

function textLabel(element) {
  if (!element.textContent) {
    return "";
  }
  const text = element.textContent.replace(/\s+/g, " ").trim();
  return text.length <= 80 ? text : "";
}

function firstUsefulLabel(values) {
  const label = values.find((value) => value && String(value).trim());
  return label ? String(label).trim().slice(0, 140) : "media";
}

function labelFromUrl(url) {
  try {
    const parsed = new URL(url);
    const lastPart = parsed.pathname.split("/").filter(Boolean).pop();
    if (lastPart) {
      return decodeURIComponentSafe(lastPart).slice(0, 140);
    }
    return parsed.hostname || "media";
  } catch {
    return "media";
  }
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

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getMediaId(element) {
  if (!mediaIds.has(element)) {
    mediaIds.set(element, `media-${nextMediaId}`);
    nextMediaId += 1;
  }
  return mediaIds.get(element);
}
