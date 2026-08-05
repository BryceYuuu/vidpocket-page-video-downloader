const DIRECT_KINDS = new Set(["video", "audio", "media"]);
const ACTIVE_JOB_STATES = new Set(["queued", "preparing", "downloading", "processing", "saving"]);
const statusEl = document.getElementById("status");
const itemsEl = document.getElementById("items");
const emptyEl = document.getElementById("empty");
const refreshButton = document.getElementById("refresh");
const clearButton = document.getElementById("clear");
const template = document.getElementById("item-template");

let activeTab = null;
let currentItems = [];
let currentJobs = [];
let currentXScan = null;
let jobPollTimer = 0;
let thumbnailInFlight = 0;
const thumbnailQueue = [];
const requestedThumbnails = new Set();
const thumbnailCache = new Map();

document.addEventListener("DOMContentLoaded", init);
refreshButton.addEventListener("click", refresh);
clearButton.addEventListener("click", clearCurrentTab);
window.addEventListener("unload", () => clearTimeout(jobPollTimer));

async function init() {
  activeTab = await resolveTargetTab();
  if (!activeTab || typeof activeTab.id !== "number") {
    setStatus("没有可检测的网页标签页");
    render([]);
    return;
  }
  await refresh();
  scheduleJobPoll(200);
}

async function resolveTargetTab() {
  const targetTabId = targetTabIdFromUrl();
  if (Number.isInteger(targetTabId) && targetTabId >= 0) {
    const tab = await getTab(targetTabId).catch(() => null);
    if (tab) return tab;
  }
  const tabs = await queryTabs({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function targetTabIdFromUrl() {
  try {
    const value = new URL(location.href).searchParams.get("tabId");
    return value === null ? NaN : Number(value);
  } catch {
    return NaN;
  }
}

async function refresh() {
  if (!activeTab) return;
  setStatus("正在扫描当前页面");
  const directXScan = requestActiveXStatusScan(activeTab).catch(() => null);
  await ensureContentScanner(activeTab);
  await directXScan;
  await delay(350);
  await loadState(0);
}

async function requestActiveXStatusScan(tab) {
  if (!isXTab(tab) || typeof tab.id !== "number") {
    return null;
  }
  const tweetId = xTweetIdFromUrl(tab.url || "");
  if (!tweetId) {
    return null;
  }
  return sendRuntimeMessage({
    type: "scanXTweets",
    tabId: tab.id,
    tweetIds: [tweetId],
    pageUrl: tab.url || "",
    pageTitle: tab.title || ""
  });
}

async function ensureContentScanner(tab) {
  if (!tab || typeof tab.id !== "number" || !/^https?:\/\//i.test(tab.url || "")) return;
  if (isXTab(tab)) {
    await executeXPageHook(tab.id).catch(() => null);
  }
  const ping = await sendTabMessage(tab.id, { type: "scanNow" }).catch(() => null);
  if (ping && ping.ok) return;
  await executeContentScript(tab.id).catch(() => null);
  if (isXTab(tab)) {
    await executeXPageHook(tab.id).catch(() => null);
  }
  await sendTabMessage(tab.id, { type: "scanNow" }).catch(() => null);
}

async function loadState(pollCount = 0) {
  if (!activeTab) return;
  const [candidateResponse, jobResponse] = await Promise.all([
    sendRuntimeMessage({ type: "getCandidates", tabId: activeTab.id }).catch(() => ({ ok: false })),
    sendRuntimeMessage({ type: "getDownloadJobs", tabId: activeTab.id }).catch(() => ({ ok: false }))
  ]);
  const rawItems = candidateResponse && candidateResponse.ok && Array.isArray(candidateResponse.items)
    ? candidateResponse.items
    : [];
  currentXScan = candidateResponse && candidateResponse.ok ? candidateResponse.xScan || null : currentXScan;
  currentJobs = jobResponse && jobResponse.ok && Array.isArray(jobResponse.jobs) ? jobResponse.jobs : currentJobs;
  currentItems = prepareDisplayItems(rawItems);
  render(currentItems);
  updateHeaderStatus(rawItems);

  if (!currentItems.length && pollCount < 12 && (!currentXScan || currentXScan.status === "loading")) {
    setStatus(isXTab(activeTab) ? "正在解析 X 页面视频" : "正在等待页面媒体资源");
    setTimeout(() => loadState(pollCount + 1).catch(() => {}), 450);
    return;
  }
  const checking = currentItems.filter((item) => item.probeStatus === "checking").length;
  if (checking && pollCount < 8) {
    setTimeout(() => loadState(pollCount + 1).catch(() => {}), 500);
  }
}

function updateHeaderStatus(rawItems) {
  const activeJobs = currentJobs.filter((job) => ACTIVE_JOB_STATES.has(job.status));
  if (activeJobs.length) {
    setStatus(`${activeJobs.length} 个下载任务正在进行`);
    return;
  }
  if (currentItems.length) {
    const previewCount = currentItems.filter((item) => item.thumbnail || canPreviewVideo(item)).length;
    setStatus(`发现 ${currentItems.length} 个媒体资源；${previewCount} 个有预览`);
    return;
  }
  if (isXTab(activeTab) && currentXScan && currentXScan.status === "error") {
    setStatus(`X 视频解析失败：${currentXScan.error || "无法读取公开媒体信息"}`);
    return;
  }
  if (isXTab(activeTab) && currentXScan && currentXScan.status === "done" && currentXScan.requested > 0) {
    setStatus(`已检查 ${currentXScan.requested} 个 X 帖子，未返回公开可下载视频`);
    return;
  }
  const unsupported = rawItems.some((item) => item && ["dash", "blob"].includes(item.kind));
  setStatus(unsupported ? "页面只暴露了暂不可保存的媒体流" : "未发现可下载的视频");
}

async function clearCurrentTab() {
  if (!activeTab) return;
  await sendRuntimeMessage({ type: "clearTab", tabId: activeTab.id });
  currentItems = [];
  render([]);
  setStatus("已清空识别记录");
}

function render(items) {
  itemsEl.textContent = "";
  emptyEl.hidden = items.length > 0;

  items.forEach((item, index) => {
    const node = template.content.firstElementChild.cloneNode(true);
    const removeButton = node.querySelector(".remove");
    const thumbEl = node.querySelector(".thumb");
    const thumbVideo = node.querySelector(".thumb-video");
    const thumbImg = node.querySelector(".thumb-img");
    const durationEl = node.querySelector(".duration");
    const kindEl = node.querySelector(".kind");
    const sourceEl = node.querySelector(".source");
    const formatEl = node.querySelector(".format");
    const qualityEl = node.querySelector(".quality");
    const nameEl = node.querySelector(".name");
    const detailsEl = node.querySelector(".details");
    const fallbackEl = node.querySelector(".thumb-fallback");
    const progressEl = node.querySelector(".progress");
    const progressFillEl = node.querySelector(".progress-fill");
    const progressTextEl = node.querySelector(".progress-text");
    const progressSpeedEl = node.querySelector(".progress-speed");
    const stopButton = node.querySelector(".stop");
    const copyButton = node.querySelector(".copy");
    const downloadButton = node.querySelector(".download");
    const job = jobForItem(item);

    renderPreview(item, {
      thumbEl,
      thumbVideo,
      thumbImg,
      fallbackEl,
      durationEl
    });
    durationEl.textContent = formatDuration(item.duration);
    kindEl.textContent = badgeLabel(item);
    kindEl.classList.add(item.kind || "media");
    nameEl.textContent = displayName(item);
    nameEl.title = item.url;
    formatEl.textContent = item.kind === "hls" ? "MP4" : (item.format || formatFromUrl(item.url));
    qualityEl.textContent = item.quality || "";
    qualityEl.hidden = !item.quality;
    qualityEl.classList.toggle("high", isHighQuality(item.quality));
    sourceEl.textContent = sourceLabel(item.source);
    detailsEl.textContent = detailLine(item, job);
    detailsEl.title = item.url;

    removeButton.addEventListener("click", async () => {
      await sendRuntimeMessage({ type: "removeCandidate", tabId: activeTab.id, id: item.id });
      currentItems = currentItems.filter((candidate) => candidate.id !== item.id);
      render(currentItems);
      updateHeaderStatus(currentItems);
    });
    copyButton.addEventListener("click", async () => {
      await navigator.clipboard.writeText(item.url);
      setStatus("已复制媒体链接");
    });

    configureDownloadControls(item, job, {
      downloadButton,
      stopButton,
      progressEl,
      progressFillEl,
      progressTextEl,
      progressSpeedEl
    });

    itemsEl.appendChild(node);
    if (item.kind === "hls" && !item.thumbnail && item.previewStatus !== "failed" && index < 12) {
      queueThumbnail(item);
    }
  });
}

function renderPreview(item, controls) {
  const { thumbEl, thumbVideo, thumbImg, fallbackEl, durationEl } = controls;
  const staticThumbnail = item.thumbnail || (!canPreviewVideo(item) ? infoPlaceholder(item) : "");
  if (staticThumbnail) {
    thumbImg.src = staticThumbnail;
    thumbEl.classList.add("has-preview");
  } else {
    thumbImg.removeAttribute("src");
  }

  if (canPreviewVideo(item) && !item.thumbnail) {
    thumbVideo.src = item.url;
    thumbVideo.title = item.url;
    thumbEl.classList.add("has-preview");
    thumbVideo.addEventListener("loadedmetadata", () => {
      if (!durationEl.textContent) durationEl.textContent = formatDuration(thumbVideo.duration);
    });
    thumbEl.addEventListener("mouseenter", () => thumbVideo.play().catch(() => {}));
    thumbEl.addEventListener("mouseleave", () => {
      thumbVideo.pause();
      try { thumbVideo.currentTime = 0; } catch {}
    });
  } else {
    thumbVideo.removeAttribute("src");
  }
  fallbackEl.textContent = item.previewStatus === "pending" ? "预览中" : "VIDEO";
  thumbImg.addEventListener("error", () => thumbImg.removeAttribute("src"));
}

function configureDownloadControls(item, job, controls) {
  const { downloadButton, stopButton, progressEl, progressFillEl, progressTextEl, progressSpeedEl } = controls;
  downloadButton.textContent = "下载";

  if (job && ACTIVE_JOB_STATES.has(job.status)) {
    downloadButton.disabled = true;
    downloadButton.textContent = jobButtonLabel(job);
    showProgress(
      progressEl,
      progressFillEl,
      progressTextEl,
      progressSpeedEl,
      stopButton,
      job.progress,
      jobProgressLabel(job),
      formatSpeed(job.speed)
    );
    stopButton.hidden = false;
    stopButton.addEventListener("click", async () => {
      stopButton.disabled = true;
      await sendRuntimeMessage({ type: "cancelDownloadJob", jobId: job.id });
      await loadJobsAndRender();
    });
    return;
  }

  if (item.probeStatus === "checking") {
    downloadButton.disabled = true;
    downloadButton.textContent = "检测中";
    downloadButton.title = "正在验证完整视频文件。";
    return;
  }
  if (item.kind !== "hls" && !item.downloadable) {
    downloadButton.disabled = true;
    downloadButton.title = "这个资源无法直接下载。";
    return;
  }
  if (job && job.status === "complete") {
    downloadButton.title = "已保存，点击可再次下载。";
  } else if (job && job.status === "error") {
    downloadButton.title = job.error || "上次下载失败，点击重试。";
  }
  downloadButton.addEventListener("click", () => startItemDownload(item, downloadButton));
}

async function startItemDownload(item, button) {
  button.disabled = true;
  button.textContent = "准备中";
  setStatus(`正在启动：${displayName(item)}`);
  const response = item.kind === "hls"
    ? await sendRuntimeMessage({
      type: "startHlsDownload",
      tabId: activeTab.id,
      id: item.id,
      url: item.url,
      filename: `${safeFilename(downloadBaseName(item))}.mp4`
    })
    : await sendRuntimeMessage({
      type: "download",
      tabId: activeTab.id,
      id: item.id,
      url: item.url,
      kind: item.kind,
      filename: directDownloadFilename(item)
    });
  if (!response || !response.ok) {
    button.disabled = false;
    button.textContent = "下载";
    setStatus((response && response.error) || "无法启动下载");
    return;
  }
  if (response.job) {
    currentJobs = [response.job, ...currentJobs.filter((job) => job.id !== response.job.id)];
  }
  render(currentItems);
  scheduleJobPoll(150);
}

function jobForItem(item) {
  return currentJobs
    .filter((job) => job.sourceId === item.id)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
}

function jobButtonLabel(job) {
  if (job.status === "processing") return "合并中";
  if (job.status === "saving") return "保存中";
  if (job.status === "preparing" || job.status === "queued") return "准备中";
  return "下载中";
}

function jobProgressLabel(job) {
  if (Number(job.progress) > 0) return `${Math.max(1, Math.min(99, Math.round(job.progress * 100)))}%`;
  if (job.bytesReceived) return formatBytes(job.bytesReceived);
  return job.message || "准备";
}

function scheduleJobPoll(delayMs) {
  clearTimeout(jobPollTimer);
  jobPollTimer = setTimeout(async () => {
    await loadJobsAndRender().catch(() => {});
    const hasActive = currentJobs.some((job) => ACTIVE_JOB_STATES.has(job.status));
    scheduleJobPoll(hasActive ? 600 : 1800);
  }, delayMs);
}

async function loadJobsAndRender() {
  if (!activeTab) return;
  const response = await sendRuntimeMessage({ type: "getDownloadJobs", tabId: activeTab.id });
  if (response && response.ok && Array.isArray(response.jobs)) {
    currentJobs = response.jobs;
    render(currentItems);
    updateHeaderStatus(currentItems);
  }
}

function queueThumbnail(item) {
  if (requestedThumbnails.has(item.id)) return;
  requestedThumbnails.add(item.id);
  thumbnailQueue.push(item);
  pumpThumbnailQueue();
}

function pumpThumbnailQueue() {
  while (thumbnailInFlight < 2 && thumbnailQueue.length) {
    const item = thumbnailQueue.shift();
    thumbnailInFlight += 1;
    sendRuntimeMessage({ type: "requestHlsThumbnail", tabId: activeTab.id, id: item.id })
      .then((result) => {
        if (result && result.pending) requestedThumbnails.delete(item.id);
      })
      .catch(() => {})
      .finally(async () => {
        thumbnailInFlight -= 1;
        await reloadCandidatesOnly().catch(() => {});
        pumpThumbnailQueue();
      });
  }
}

async function reloadCandidatesOnly() {
  const response = await sendRuntimeMessage({ type: "getCandidates", tabId: activeTab.id });
  if (response && response.ok && Array.isArray(response.items)) {
    currentItems = prepareDisplayItems(response.items);
    render(currentItems);
    updateHeaderStatus(response.items);
  }
}

function prepareDisplayItems(items) {
  return annotateDisplayItems(sortItems(dedupeItems(items).map(applyCachedThumbnail).filter(isDisplayableDownload)));
}

function dedupeItems(items) {
  const byUrl = new Map();
  items.forEach((item) => {
    if (!item || !item.url) return;
    const key = canonicalDisplayKey(item);
    const existing = byUrl.get(key);
    if (!existing) {
      byUrl.set(key, item);
      return;
    }
    const preferred = itemScore(item) > itemScore(existing) ? item : existing;
    const fallback = preferred === item ? existing : item;
    byUrl.set(key, {
      ...fallback,
      ...preferred,
      label: usefulDisplayLabel(preferred.label, fallback.label),
      thumbnail: preferred.thumbnail || fallback.thumbnail || "",
      duration: preferred.duration || fallback.duration || 0,
      width: preferred.width || fallback.width || 0,
      height: preferred.height || fallback.height || 0,
      quality: preferred.quality || fallback.quality || ""
    });
  });
  return Array.from(byUrl.values());
}

function itemScore(item) {
  return Number(Boolean(item.thumbnail)) * 20 +
    Number(Boolean(usefulDisplayLabel(item.label))) * 12 +
    Number(Boolean(item.downloadable || item.kind === "hls")) * 10 +
    qualityHeight(item.quality) / 1000 +
    Number(item.contentLength || 0) / 1000000 +
    Number(item.lastSeen || 0) / 10000000000000;
}

function usefulDisplayLabel(...values) {
  for (const value of values) {
    const label = String(value || "").replace(/\s+/g, " ").trim();
    if (label && !isNoisyLabel(label)) return label;
  }
  return String(values.find(Boolean) || "").trim();
}

function canonicalDisplayKey(item) {
  try {
    const url = new URL(item.url);
    if (url.hostname.toLowerCase() === "video.twimg.com") {
      const path = decodeURIComponentSafe(url.pathname);
      const numberedAsset = /\/(amplify_video|ext_tw_video)\/(\d+)/i.exec(path);
      const tweetAsset = /\/tweet_video\/([^/.]+)/i.exec(path);
      const asset = numberedAsset
        ? `${numberedAsset[1].toLowerCase()}:${numberedAsset[2]}`
        : (tweetAsset ? `tweet_video:${tweetAsset[1]}` : "");
      if (asset) {
        if (item.kind === "hls" || /\.m3u8$/i.test(path)) return `x:${asset}:hls`;
        const dimensions = /(\d{2,4})x(\d{2,4})/i.exec(path);
        const rendition = dimensions
          ? `${dimensions[1]}x${dimensions[2]}`
          : (item.quality || ((item.width || item.height) ? `${item.width || 0}x${item.height || 0}` : normalizeDisplayUrl(item.url)));
        return `x:${asset}:video:${rendition}`;
      }
    }
  } catch {}
  return normalizeDisplayUrl(item.url);
}

function isDisplayableDownload(item) {
  return Boolean(item) && (
    item.kind === "hls" ||
    (DIRECT_KINDS.has(item.kind) && (item.downloadable || item.probeStatus === "checking"))
  );
}

function applyCachedThumbnail(item) {
  const cached = thumbnailCache.get(item.url);
  return cached && !item.thumbnail ? { ...item, thumbnail: cached } : item;
}

function sortItems(items) {
  const priority = { video: 0, hls: 1, audio: 2, media: 3 };
  return [...items].sort((a, b) => {
    const previewDelta = Number(Boolean(b.thumbnail)) - Number(Boolean(a.thumbnail));
    if (previewDelta) return previewDelta;
    const qualityDelta = qualityHeight(b.quality) - qualityHeight(a.quality);
    if (qualityDelta) return qualityDelta;
    const kindDelta = (priority[a.kind] ?? 9) - (priority[b.kind] ?? 9);
    return kindDelta || (b.lastSeen || 0) - (a.lastSeen || 0);
  });
}

function annotateDisplayItems(items) {
  const counters = new Map();
  return items.map((item) => {
    const sourceName = sourceNameForItem(item);
    const count = (counters.get(sourceName) || 0) + 1;
    counters.set(sourceName, count);
    return {
      ...item,
      displayTitle: buildDisplayTitle(item, sourceName, count),
      downloadTitle: buildDownloadTitle(item, sourceName, count),
      sourceName
    };
  });
}

function badgeLabel(item) {
  if (item.kind === "hls") return "HLS";
  if (item.kind === "audio") return "AUDIO";
  return item.format || "VIDEO";
}

function sourceLabel(source) {
  if (!source) return "页面";
  if (source.includes("network")) return "网络";
  if (source.includes("performance")) return "加载记录";
  if (source.includes("page-api")) return "页面接口";
  return "页面";
}

function detailLine(item, job) {
  const parts = [];
  if (item.sourceName) parts.push(item.sourceName);
  const host = hostFromUrl(item.url);
  if (host && host !== item.sourceName) parts.push(host);
  if (item.width && item.height) parts.push(`${item.width}x${item.height}`);
  if (item.contentLength) parts.push(formatBytes(item.contentLength));
  if (item.kind === "hls") parts.push("扩展内合并 MP4");
  if (item.previewStatus === "pending") parts.push("正在抽取预览帧");
  if (item.previewStatus === "failed") parts.push("未能抽取真实预览帧");
  if (job && job.status === "complete") parts.push("已保存");
  if (job && job.status === "error") parts.push(`失败：${job.error || "未知错误"}`);
  return parts.join(" | ");
}

function displayName(item) {
  if (item.displayTitle) return item.displayTitle;
  const label = item.label || labelFromUrl(item.url);
  return !label || label === "media" ? labelFromUrl(item.url) : label;
}

function downloadBaseName(item) {
  if (item.downloadTitle) return item.downloadTitle;
  const parts = [displayName(item)];
  if (item.quality) parts.push(item.quality);
  const duration = compactDuration(item.duration);
  if (duration) parts.push(duration);
  return parts.join("_");
}

function directDownloadFilename(item) {
  return `${safeFilename(downloadBaseName(item))}.${extensionForItem(item)}`;
}

function extensionForItem(item) {
  const format = String(item.format || formatFromUrl(item.url) || "mp4").toLowerCase();
  if (/^[a-z0-9]{2,5}$/.test(format) && format !== "media") return format;
  return item.kind === "audio" ? "mp3" : "mp4";
}

function buildDisplayTitle(item, sourceName, index) {
  const rawLabel = item.label || labelFromUrl(item.url);
  const label = cleanLabel(rawLabel);
  if (label && !isNoisyLabel(rawLabel) && !isNoisyLabel(label)) return label;
  const topic = pageTopic();
  return `${topic ? `${topic} · ` : ""}${sourceName} ${String(index).padStart(2, "0")}`;
}

function buildDownloadTitle(item, sourceName, index) {
  const parts = [buildDisplayTitle(item, sourceName, index)];
  if (item.quality) parts.push(item.quality);
  const duration = compactDuration(item.duration);
  if (duration) parts.push(duration);
  return parts.join("_");
}

function sourceNameForItem(item) {
  const host = hostFromUrl(item.url);
  if (/twimg\.com$/i.test(host) || /(?:^|\.)x\.com$/i.test(hostFromUrl(item.pageUrl || ""))) return "X视频";
  if (!host) return "网页视频";
  return host.replace(/^www\./, "").split(".")[0] || "网页视频";
}

function pageTopic() {
  const title = cleanLabel(activeTab && activeTab.title);
  if (!title) return "";
  const cleaned = title
    .replace(/\s*[\/|-]\s*X\s*$/i, "")
    .replace(/\s*[\/|-]\s*Twitter\s*$/i, "")
    .replace(/\s*-\s*搜索\s*$/i, "")
    .trim();
  return cleaned && cleaned.toLowerCase() !== "x" ? cleaned.slice(0, 28) : "";
}

function cleanLabel(value) {
  return String(value || "")
    .replace(/\.[a-z0-9]{2,5}(?:\?.*)?$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function isNoisyLabel(label) {
  const value = String(label || "").trim();
  if (!value || /\.m3u8/i.test(value)) return true;
  return value.length >= 12 && !/[\s\u4e00-\u9fff]/.test(value) && /^[a-z0-9_-]+$/i.test(value);
}

function hostFromUrl(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

function labelFromUrl(url) {
  try {
    const parsed = new URL(url);
    return decodeURIComponentSafe(parsed.pathname.split("/").filter(Boolean).pop() || parsed.hostname || "media");
  } catch {
    return "media";
  }
}

function formatFromUrl(url) {
  const match = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(url);
  return match && match[1] ? match[1].toUpperCase() : "MEDIA";
}

function canPreviewVideo(item) {
  return item.downloadable && item.kind === "video" && /^https?:\/\//i.test(item.url);
}

function normalizeDisplayUrl(value) {
  try {
    const url = new URL(value);
    if (["http:", "https:"].includes(url.protocol)) url.hash = "";
    return url.href;
  } catch {
    return value;
  }
}

function safeFilename(value) {
  return String(value || "video")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "video";
}

function formatDuration(value) {
  const seconds = Math.floor(Number(value) || 0);
  if (!seconds) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours ? `${hours}:${pad2(minutes)}:${pad2(remainder)}` : `${minutes}:${pad2(remainder)}`;
}

function compactDuration(value) {
  const seconds = Math.floor(Number(value) || 0);
  if (!seconds) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours ? `${hours}h${pad2(minutes)}m${pad2(remainder)}s` : `${minutes}m${pad2(remainder)}s`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function isHighQuality(value) {
  return qualityHeight(value) >= 720;
}

function qualityHeight(value) {
  const match = /^(\d+)p$/i.exec(value || "");
  return match ? Number(match[1]) : 0;
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatSpeed(value) {
  const bytesPerSecond = Number(value) || 0;
  return bytesPerSecond > 0 ? `${formatBytes(bytesPerSecond)}/s` : "";
}

function showProgress(progressEl, fillEl, textEl, speedEl, stopButton, value, text, speedText) {
  progressEl.hidden = false;
  stopButton.hidden = false;
  updateProgress(progressEl, fillEl, textEl, speedEl, value, text, speedText);
}

function updateProgress(progressEl, fillEl, textEl, speedEl, value, text, speedText) {
  const progress = Number(value);
  if (!Number.isFinite(progress) || progress <= 0) {
    progressEl.classList.add("indeterminate");
    fillEl.style.width = "28%";
  } else {
    progressEl.classList.remove("indeterminate");
    fillEl.style.width = `${Math.max(1, Math.min(100, Math.round(progress * 100)))}%`;
  }
  textEl.textContent = text || "";
  speedEl.textContent = speedText || "";
}

function infoPlaceholder(item) {
  const title = escapeXml(displayName(item));
  const subtitle = escapeXml([item.quality || "", formatDuration(item.duration), sourceNameForItem(item)].filter(Boolean).join(" · "));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="#101827"/><rect x="0" y="0" width="8" height="180" fill="#0a9ee8"/><text x="24" y="72" fill="#f4f7fb" font-family="Arial,sans-serif" font-size="22" font-weight="700">${truncateSvg(title, 19)}</text><text x="24" y="108" fill="#9aa8bb" font-family="Arial,sans-serif" font-size="15">${truncateSvg(subtitle, 30)}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeXml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]));
}

function truncateSvg(value, max) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function isXTab(tab) {
  try { return /(^|\.)(?:x\.com|twitter\.com)$/i.test(new URL(tab.url || "").hostname); } catch { return false; }
}

function xTweetIdFromUrl(value) {
  try {
    const url = new URL(value || "");
    if (!/(^|\.)(?:x\.com|twitter\.com)$/i.test(url.hostname)) return "";
    const match = /\/status\/(\d{6,40})(?:\/|$)/.exec(url.pathname);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

function decodeURIComponentSafe(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function setStatus(text) {
  statusEl.textContent = text;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function queryTabs(query) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(query, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tabs || []);
    });
  });
}

function getTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tab);
    });
  });
}

function executeContentScript(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["src/content.js"] }, (results) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(results || []);
    });
  });
}

function executeXPageHook(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["src/x-media-hook.js"] }, (results) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(results || []);
    });
  });
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}

if (typeof globalThis !== "undefined") {
  globalThis.__VIDPOCKET_POPUP_TEST_API__ = {
    prepareDisplayItems,
    displayName,
    downloadBaseName,
    isDisplayableDownload,
    applyCachedThumbnail,
    thumbnailCache,
    directDownloadFilename,
    infoPlaceholder,
    xTweetIdFromUrl,
    requestActiveXStatusScan
  };
}
