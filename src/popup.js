const HELPER_ORIGIN = "http://127.0.0.1:17384";
const DIRECT_KINDS = new Set(["video", "audio", "media"]);
const statusEl = document.getElementById("status");
const itemsEl = document.getElementById("items");
const emptyEl = document.getElementById("empty");
const refreshButton = document.getElementById("refresh");
const clearButton = document.getElementById("clear");
const template = document.getElementById("item-template");

let activeTab = null;
let currentItems = [];
const thumbnailCache = new Map();
const activeDownloadIds = new Set();
let helperHealthPromise = null;
let helperHealthOk = false;

document.addEventListener("DOMContentLoaded", init);
refreshButton.addEventListener("click", refresh);
clearButton.addEventListener("click", clearCurrentTab);

async function init() {
  const tabs = await queryTabs({ active: true, currentWindow: true });
  activeTab = tabs[0] || null;

  if (!activeTab || typeof activeTab.id !== "number") {
    setStatus("没有当前标签页");
    render([]);
    return;
  }

  await refresh();
}

async function refresh() {
  if (!activeTab) {
    return;
  }

  setStatus("正在扫描当前页面");
  await sendTabMessage(activeTab.id, { type: "scanNow" }).catch(() => null);
  await delay(300);
  await loadAndRenderItems(0);
}

async function loadAndRenderItems(pollCount) {
  if (activeDownloadIds.size) {
    return;
  }
  const response = await sendRuntimeMessage({ type: "getCandidates", tabId: activeTab.id });
  const rawItems = response && response.ok && Array.isArray(response.items) ? response.items : [];
  const items = prepareDisplayItems(rawItems);
  currentItems = items;
  render(items);
  hydrateHlsThumbnails(items).catch(() => {});

  const checkingCount = items.filter((item) => item.probeStatus === "checking").length;
  const hlsWithoutDurationCount = items.filter((item) => item.kind === "hls" && !item.duration).length;
  if (checkingCount || hlsWithoutDurationCount) {
    setStatus(checkingCount ? `发现 ${items.length} 个媒体资源，正在验证 ${checkingCount} 个` : `发现 ${items.length} 个媒体资源，正在读取时长`);
    if (pollCount < 8) {
      setTimeout(() => {
        loadAndRenderItems(pollCount + 1).catch(() => {});
      }, 500);
    }
    return;
  }

  const hlsCount = items.filter((item) => item.kind === "hls").length;
  if (items.length && hlsCount && !helperHealthOk) {
    setStatus(`发现 ${items.length} 个媒体资源；HLS 下载需要先启动本地助手`);
    return;
  }
  setStatus(items.length ? `发现 ${items.length} 个媒体资源` : "未发现可下载的视频");
}

async function clearCurrentTab() {
  if (!activeTab) {
    return;
  }
  await sendRuntimeMessage({ type: "clearTab", tabId: activeTab.id });
  currentItems = [];
  render([]);
  setStatus("已清空");
}

function render(items) {
  itemsEl.textContent = "";
  emptyEl.hidden = items.length > 0;

  items.forEach((item) => {
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

    const previewable = canPreviewVideo(item);
    if (previewable) {
      thumbVideo.src = item.url;
      thumbVideo.title = item.url;
      if (item.thumbnail) {
        thumbVideo.poster = item.thumbnail;
      }
      thumbEl.classList.add("has-preview");
      thumbVideo.addEventListener("loadedmetadata", () => {
        if (!durationEl.textContent) {
          durationEl.textContent = formatDuration(thumbVideo.duration);
        }
      });
      thumbEl.addEventListener("mouseenter", () => {
        thumbVideo.play().catch(() => {});
      });
      thumbEl.addEventListener("mouseleave", () => {
        thumbVideo.pause();
        thumbVideo.currentTime = 0;
      });
    } else {
      thumbVideo.removeAttribute("src");
    }

    const staticThumbnail = !previewable ? (item.thumbnail || infoPlaceholder(item)) : "";
    if (staticThumbnail) {
      thumbImg.src = staticThumbnail;
      thumbEl.classList.add("has-preview");
    } else {
      thumbImg.removeAttribute("src");
    }
    if (item.previewStatus === "pending") {
      fallbackEl.textContent = "预览中";
    } else if (item.previewStatus === "failed") {
      fallbackEl.textContent = "无预览";
    } else {
      fallbackEl.textContent = "VIDEO";
    }
    thumbImg.addEventListener("error", () => {
      thumbImg.removeAttribute("src");
    });

    durationEl.textContent = formatDuration(item.duration);
    kindEl.textContent = badgeLabel(item);
    kindEl.classList.add(item.kind || "media");

    nameEl.textContent = displayName(item);
    nameEl.title = item.url;

    formatEl.textContent = item.kind === "hls" ? "MP4" : (item.format || formatFromUrl(item.url));
    qualityEl.textContent = item.quality || "";
    qualityEl.hidden = !item.quality;
    if (isHighQuality(item.quality)) {
      qualityEl.classList.add("high");
    }

    sourceEl.textContent = sourceLabel(item.source);
    detailsEl.textContent = detailLine(item);
    detailsEl.title = item.url;

    removeButton.addEventListener("click", async () => {
      await sendRuntimeMessage({ type: "removeCandidate", tabId: activeTab.id, id: item.id });
      currentItems = currentItems.filter((candidate) => candidate.id !== item.id);
      render(currentItems);
      setStatus(currentItems.length ? `发现 ${currentItems.length} 个媒体资源` : "列表为空");
    });

    copyButton.addEventListener("click", async () => {
      await navigator.clipboard.writeText(item.url);
      setStatus("已复制链接");
    });

    downloadButton.textContent = "下载";
    if (item.kind === "hls") {
      downloadButton.title = "使用本地助手把 HLS 保存为 MP4。";
      downloadButton.addEventListener("click", () => {
        downloadHlsWithHelper(item, {
          button: downloadButton,
          progressEl,
          progressFillEl,
          progressTextEl
          ,
          progressSpeedEl,
          stopButton
        }).catch((error) => {
          setStatus(error.message || "下载失败");
          downloadButton.disabled = false;
          downloadButton.textContent = "下载";
          hideProgress(progressEl);
        });
      });
    } else if (item.probeStatus === "checking") {
      downloadButton.disabled = true;
      downloadButton.textContent = "检测中";
      downloadButton.title = "正在验证这是不是完整视频文件。";
    } else if (!item.downloadable) {
      downloadButton.disabled = true;
      downloadButton.title = blockedReason(item);
    } else {
      downloadButton.addEventListener("click", async () => {
        downloadButton.disabled = true;
        downloadButton.textContent = "开始中";
        const result = await sendRuntimeMessage({
          type: "download",
          tabId: activeTab.id,
          id: item.id,
          url: item.url,
          kind: item.kind,
          label: item.label,
          filename: directDownloadFilename(item)
        });
        if (!result || !result.ok) {
          setStatus((result && result.error) || "下载失败");
          downloadButton.disabled = false;
          downloadButton.textContent = "下载";
          return;
        }
        downloadButton.textContent = "已开始";
        setStatus("下载已开始");
      });
    }

    itemsEl.appendChild(node);
  });
}

function prepareDisplayItems(items) {
  return annotateDisplayItems(sortItems(dedupeItems(items)
    .map(applyCachedThumbnail)
    .filter(isDisplayableDownload)));
}

function dedupeItems(items) {
  const byUrl = new Map();
  items.forEach((item) => {
    if (!item || !item.url) {
      return;
    }
    const key = normalizeDisplayUrl(item.url);
    const existing = byUrl.get(key);
    if (!existing || itemScore(item) > itemScore(existing)) {
      byUrl.set(key, item);
    }
  });
  return Array.from(byUrl.values());
}

function itemScore(item) {
  return Number(Boolean(item.thumbnail)) * 20 +
    Number(Boolean(item.downloadable)) * 10 +
    Number(item.contentLength || 0) / 1000000 +
    Number(item.lastSeen || 0) / 10000000000000;
}

function isDisplayableDownload(item) {
  if (item.kind === "hls") {
    return true;
  }
  return DIRECT_KINDS.has(item.kind) && (item.downloadable || item.probeStatus === "checking");
}

function applyCachedThumbnail(item) {
  if (item.kind !== "hls" || item.thumbnail) {
    return item;
  }
  const cached = thumbnailCache.get(item.url);
  if (!cached) {
    return item;
  }
  if (cached.status === "pending") {
    return { ...item, previewStatus: "pending" };
  }
  if (cached.status === "failed") {
    return {
      ...item,
      previewStatus: "failed",
      previewError: cached.error || "预览生成失败"
    };
  }
  if (cached.status !== "done") {
    return item;
  }
  return {
    ...item,
    thumbnail: cached.thumbnail || "",
    previewStatus: "done",
    duration: item.duration || cached.duration || 0,
    width: item.width || cached.width || 0,
    height: item.height || cached.height || 0,
    quality: item.quality || qualityFromSize(cached.width || 0, cached.height || 0)
  };
}

async function hydrateHlsThumbnails(items) {
  const targets = items
    .filter((item) => item.kind === "hls" && !item.thumbnail && !thumbnailCache.has(item.url))
    .slice(0, 24);
  if (!targets.length) {
    return;
  }
  const helperOk = await checkHelper(false);
  if (!helperOk) {
    return;
  }

  await mapLimit(targets, 3, async (item) => {
    if (thumbnailCache.has(item.url)) {
      return;
    }
    thumbnailCache.set(item.url, { status: "pending" });
    currentItems = prepareDisplayItems(currentItems);
    renderIfIdle(currentItems);
    try {
      const result = await helperPost("/thumbnail", {
        url: item.url,
        pageUrl: item.pageUrl || (activeTab && activeTab.url) || "",
        second: 1
      });
      if (!result || !result.ok || !result.thumbnail) {
        throw new Error((result && result.error) || "缩略图生成失败");
      }
      thumbnailCache.set(item.url, {
        status: "done",
        thumbnail: result.thumbnail,
        duration: Number(result.duration) || 0,
        width: Number(result.width) || 0,
        height: Number(result.height) || 0
      });
      currentItems = prepareDisplayItems(currentItems);
      renderIfIdle(currentItems);
    } catch (error) {
      thumbnailCache.set(item.url, {
        status: "failed",
        error: shortError(error)
      });
      currentItems = prepareDisplayItems(currentItems);
      renderIfIdle(currentItems);
      setStatus("部分视频无法生成预览，原因已显示在条目里");
    }
  });
}

async function downloadHlsWithHelper(item, controls) {
  const activeKey = item.id || item.url;
  activeDownloadIds.add(activeKey);
  try {
    return await downloadHlsWithHelperInner(item, controls);
  } finally {
    activeDownloadIds.delete(activeKey);
  }
}

async function downloadHlsWithHelperInner(item, controls) {
  const { button, progressEl, progressFillEl, progressTextEl, progressSpeedEl, stopButton } = controls;
  let jobId = "";
  let stopped = false;
  button.disabled = true;
  button.textContent = "准备中";
  showProgress(progressEl, progressFillEl, progressTextEl, progressSpeedEl, stopButton, 0, "准备", "");
  if (stopButton) {
    stopButton.hidden = false;
    stopButton.disabled = false;
    stopButton.onclick = async () => {
      stopped = true;
      stopButton.disabled = true;
      button.textContent = "停止中";
      if (jobId) {
        await helperPost(`/jobs/${encodeURIComponent(jobId)}/cancel`, {}).catch(() => null);
      }
    };
  }
  const helperOk = await checkHelper(true);
  if (!helperOk) {
    throw new Error("本地助手没有启动：双击 helper/start-helper.command 后再点下载。");
  }

  button.textContent = "下载中";
  showProgress(progressEl, progressFillEl, progressTextEl, progressSpeedEl, stopButton, 0.01, "1%", "");
  const result = await helperPost("/download", {
    url: item.url,
    filename: `${safeFilename(downloadBaseName(item))}.mp4`,
    pageUrl: item.pageUrl || (activeTab && activeTab.url) || "",
    duration: Number(item.duration) || 0,
    width: Number(item.width) || 0,
    height: Number(item.height) || 0,
    quality: item.quality || "",
    relatedHlsUrls: relatedHlsUrls(item)
  });
  if (!result || !result.ok || !result.jobId) {
    throw new Error((result && result.error) || "本地助手没有开始下载。");
  }
  jobId = result.jobId;

  setStatus("本地助手正在生成 MP4");
  const finalJob = await pollHelperJob(result.jobId, controls);
  if (stopped || finalJob.status === "canceled") {
    button.textContent = "下载";
    throw new Error("已停止下载");
  }
  if (finalJob.status !== "done") {
    throw new Error(finalJob.error || "下载失败");
  }
  showProgress(progressEl, progressFillEl, progressTextEl, progressSpeedEl, stopButton, 1, "100%", "");
  button.textContent = "加入下载";
  const filename = finalJob.filename || `${safeFilename(downloadBaseName(item))}.mp4`;
  await chromeDownload(`${HELPER_ORIGIN}/files/${encodeURIComponent(result.jobId)}`, filename);
  button.textContent = "已开始";
  if (stopButton) {
    stopButton.hidden = true;
  }
  setStatus(finalJob.warning ? `已加入 Chrome 下载：${filename}；${finalJob.warning}` : `已加入 Chrome 下载：${filename}`);
}

function renderIfIdle(items) {
  if (activeDownloadIds.size) {
    return;
  }
  render(items);
}

function relatedHlsUrls(item) {
  const urls = [item && item.url];
  currentItems.forEach((candidate) => {
    if (candidate && candidate.kind === "hls" && candidate.url) {
      urls.push(candidate.url);
    }
  });
  return [...new Set(urls.filter(Boolean))].slice(0, 40);
}

async function pollHelperJob(jobId, controls) {
  const { button, progressEl, progressFillEl, progressTextEl, progressSpeedEl } = controls;
  for (let index = 0; index < 7200; index += 1) {
    await delay(500);
    const job = await helperGet(`/jobs/${encodeURIComponent(jobId)}`);
    if (!job || !job.ok) {
      throw new Error((job && job.error) || "无法读取下载状态");
    }
    if (job.status === "done" || job.status === "error") {
      updateProgress(progressEl, progressFillEl, progressTextEl, progressSpeedEl, job.progress, job.status === "done" ? "100%" : (job.status === "canceled" ? "停止" : "失败"), formatSpeed(job.speed));
      return job;
    }
    if (job.status === "running") {
      button.textContent = "下载中";
      updateProgress(progressEl, progressFillEl, progressTextEl, progressSpeedEl, job.progress, progressLabel(job), formatSpeed(job.speed));
    }
  }
  throw new Error("下载超时");
}

async function checkHelper(showError) {
  if (helperHealthPromise) {
    return helperHealthPromise;
  }
  helperHealthPromise = helperGet("/health")
    .then((result) => {
      helperHealthOk = Boolean(result && result.ok);
      return helperHealthOk;
    })
    .catch(() => {
      helperHealthOk = false;
      if (showError) {
        setStatus("本地助手没有启动");
      }
      return false;
    })
    .finally(() => {
      setTimeout(() => {
        helperHealthPromise = null;
      }, 5000);
    });
  return helperHealthPromise;
}

async function helperGet(path) {
  const response = await fetch(`${HELPER_ORIGIN}${path}`, {
    method: "GET",
    cache: "no-store"
  });
  return response.json();
}

async function helperPost(path, body) {
  const response = await fetch(`${HELPER_ORIGIN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store"
  });
  return response.json();
}

function sortItems(items) {
  const priority = { video: 0, hls: 1, audio: 2, media: 3 };
  return [...items].sort((a, b) => {
    const previewDelta = Number(Boolean(b.thumbnail)) - Number(Boolean(a.thumbnail));
    if (previewDelta) {
      return previewDelta;
    }
    const qualityDelta = (qualityHeight(b.quality) || 0) - (qualityHeight(a.quality) || 0);
    if (qualityDelta) {
      return qualityDelta;
    }
    const kindDelta = (priority[a.kind] ?? 9) - (priority[b.kind] ?? 9);
    if (kindDelta) {
      return kindDelta;
    }
    return (b.lastSeen || 0) - (a.lastSeen || 0);
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
  if (item.kind === "hls") {
    return "HLS";
  }
  if (item.kind === "audio") {
    return "AUDIO";
  }
  return item.format || "VIDEO";
}

function sourceLabel(source) {
  if (!source) {
    return "页面";
  }
  if (source.includes("network")) {
    return "网络";
  }
  if (source.includes("performance")) {
    return "加载记录";
  }
  return "页面";
}

function detailLine(item) {
  const parts = [];
  if (item.sourceName) {
    parts.push(item.sourceName);
  }
  const host = hostFromUrl(item.url);
  if (host && host !== item.sourceName) {
    parts.push(host);
  }
  if (item.width && item.height) {
    parts.push(`${item.width}x${item.height}`);
  }
  if (item.contentType) {
    parts.push(item.contentType.split(";")[0]);
  }
  if (item.contentLength) {
    parts.push(formatBytes(item.contentLength));
  }
  if (item.kind === "hls") {
    parts.push("本地助手生成 MP4");
  }
  if (item.previewStatus === "pending") {
    parts.push("正在生成预览");
  }
  if (item.previewStatus === "failed") {
    parts.push(`预览失败：${item.previewError || "无法从该源抽帧"}`);
  }
  if (item.probeStatus === "checking") {
    parts.push("正在验证完整文件");
  }
  return parts.join(" | ");
}

function blockedReason(item) {
  if (item.kind === "hls") {
    return "需要启动本地助手后才能保存 HLS。";
  }
  return "这个资源无法直接下载。";
}

function displayName(item) {
  if (item.displayTitle) {
    return item.displayTitle;
  }
  const label = item.label || labelFromUrl(item.url);
  if (!label || label === "media") {
    return labelFromUrl(item.url);
  }
  return label;
}

function downloadBaseName(item) {
  if (item.downloadTitle) {
    return item.downloadTitle;
  }
  const parts = [displayName(item)];
  if (item.quality) {
    parts.push(item.quality);
  }
  const duration = compactDuration(item.duration);
  if (duration) {
    parts.push(duration);
  }
  return parts.join("_");
}

function directDownloadFilename(item) {
  const ext = extensionForItem(item);
  return `${safeFilename(downloadBaseName(item))}.${ext}`;
}

function extensionForItem(item) {
  const format = String(item.format || formatFromUrl(item.url) || "mp4").toLowerCase();
  if (/^[a-z0-9]{2,5}$/.test(format) && format !== "media") {
    return format;
  }
  if (item.kind === "audio") {
    return "mp3";
  }
  return "mp4";
}

function buildDisplayTitle(item, sourceName, index) {
  const rawLabel = item.label || labelFromUrl(item.url);
  const label = cleanLabel(rawLabel);
  if (label && !isNoisyLabel(rawLabel) && !isNoisyLabel(label)) {
    return label;
  }
  const topic = pageTopic();
  return `${topic ? `${topic} · ` : ""}${sourceName} ${String(index).padStart(2, "0")}`;
}

function buildDownloadTitle(item, sourceName, index) {
  const title = buildDisplayTitle(item, sourceName, index);
  const parts = [title];
  if (item.quality) {
    parts.push(item.quality);
  }
  const duration = compactDuration(item.duration);
  if (duration) {
    parts.push(duration);
  }
  return parts.join("_");
}

function sourceNameForItem(item) {
  const host = hostFromUrl(item.url);
  if (/twimg\.com$/i.test(host) || /x\.com$/i.test(item.pageUrl || "")) {
    return "X视频";
  }
  if (!host) {
    return "网页视频";
  }
  return host.replace(/^www\./, "").split(".")[0] || "网页视频";
}

function pageTopic() {
  const title = cleanLabel(activeTab && activeTab.title);
  if (!title) {
    return "";
  }
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
  if (!value) {
    return true;
  }
  if (/\.m3u8/i.test(value)) {
    return true;
  }
  if (value.length >= 12 && !/[\s\u4e00-\u9fff]/.test(value) && /^[a-z0-9_-]+$/i.test(value)) {
    return true;
  }
  return false;
}

function hostFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return "";
  }
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
    if (url.protocol === "http:" || url.protocol === "https:") {
      url.hash = "";
    }
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
  if (!Number.isFinite(Number(value))) {
    return "";
  }
  const seconds = Math.floor(Number(value) || 0);
  if (!seconds) {
    return "";
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h) {
    return `${h}:${pad2(m)}:${pad2(s)}`;
  }
  return `${m}:${pad2(s)}`;
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

function qualityFromSize(width, height) {
  const h = Number(height) || 0;
  const w = Number(width) || 0;
  if (h >= 2160 || w >= 3840) {
    return "2160p";
  }
  if (h >= 1440 || w >= 2560) {
    return "1440p";
  }
  if (h >= 1080 || w >= 1920) {
    return "1080p";
  }
  if (h >= 720 || w >= 1280) {
    return "720p";
  }
  if (h >= 480 || w >= 854) {
    return "480p";
  }
  return "";
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function showProgress(progressEl, fillEl, textEl, speedEl, stopButton, value, text, speedText) {
  if (!progressEl) {
    return;
  }
  progressEl.hidden = false;
  if (stopButton) {
    stopButton.hidden = false;
  }
  updateProgress(progressEl, fillEl, textEl, speedEl, value, text, speedText);
}

function hideProgress(progressEl) {
  if (progressEl) {
    progressEl.hidden = true;
  }
}

function updateProgress(progressEl, fillEl, textEl, speedEl, value, text, speedText) {
  if (!progressEl || !fillEl || !textEl) {
    return;
  }
  const progress = Number(value);
  if (!Number.isFinite(progress) || progress <= 0) {
    progressEl.classList.add("indeterminate");
    fillEl.style.width = "";
    textEl.textContent = text || "处理中";
    if (speedEl) {
      speedEl.textContent = speedText || "";
    }
    return;
  }
  progressEl.classList.remove("indeterminate");
  const percent = Math.max(1, Math.min(100, Math.round(progress * 100)));
  fillEl.style.width = `${percent}%`;
  textEl.textContent = text || `${percent}%`;
  if (speedEl) {
    speedEl.textContent = speedText || "";
  }
}

function progressLabel(job) {
  const phase = job.phase === "transcoding" ? "转码" : "下载";
  const progress = Number(job.progress);
  if (!Number.isFinite(progress) || progress <= 0) {
    return phase;
  }
  return `${Math.max(1, Math.min(99, Math.round(progress * 100)))}%`;
}

function formatSpeed(value) {
  const bytes = Number(value) || 0;
  if (bytes <= 0) {
    return "";
  }
  return `${formatBytes(bytes)}/s`;
}

function compactDuration(value) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) {
    return "";
  }
  const seconds = Math.floor(Number(value));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}m${String(s).padStart(2, "0")}s`;
}

function infoPlaceholder(item) {
  const title = escapeXml(displayName(item));
  const source = escapeXml(item.sourceName || sourceNameForItem(item));
  const quality = escapeXml(item.quality || "MP4");
  const duration = escapeXml(formatDuration(item.duration) || "--:--");
  const note = item.previewStatus === "failed" ? "预览失败" : (item.previewStatus === "pending" ? "生成预览" : "视频资源");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="156" viewBox="0 0 280 156">
    <defs>
      <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="#101827"/>
        <stop offset="0.58" stop-color="#14263d"/>
        <stop offset="1" stop-color="#08111f"/>
      </linearGradient>
    </defs>
    <rect width="280" height="156" rx="10" fill="url(#g)"/>
    <rect x="12" y="12" width="68" height="22" rx="5" fill="#083350" stroke="#126493"/>
    <text x="46" y="27" text-anchor="middle" font-family="system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="12" font-weight="700" fill="#6dd3ff">${quality}</text>
    <text x="18" y="72" font-family="system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="18" font-weight="800" fill="#e7e9ee">${source}</text>
    <text x="18" y="96" font-family="system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="12" fill="#aeb7c6">${truncateSvg(title, 20)}</text>
    <text x="18" y="122" font-family="system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="12" fill="#7f8da1">${escapeXml(note)}</text>
    <rect x="208" y="116" width="56" height="24" rx="5" fill="rgba(0,0,0,0.58)"/>
    <text x="236" y="132" text-anchor="middle" font-family="system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="12" fill="#fff">${duration}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncateSvg(value, max) {
  const text = String(value || "");
  return escapeXml(text.length > max ? `${text.slice(0, max - 1)}...` : text);
}

async function mapLimit(items, limit, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  });
  await Promise.all(runners);
}

function chromeDownload(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(downloadId);
    });
  });
}

function shortError(error) {
  const text = error && error.message ? error.message : String(error || "预览生成失败");
  return text.replace(/\s+/g, " ").trim().slice(0, 90);
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(tabs);
    });
  });
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

globalThis.__vidPocketPopupTest = {
  prepareDisplayItems,
  displayName,
  downloadBaseName,
  infoPlaceholder,
  thumbnailCache
};
