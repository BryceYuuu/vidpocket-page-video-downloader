(() => {
  const root = window;
  const RESPONSE_SOURCE = "vidpocket-x-media-hook";
  const REQUEST_SOURCE = "vidpocket-content";
  const INSTALL_MARKER = "__vidPocketXMediaHookInstalled";
  const TEST_MODE = "__vidPocketXMediaHookTestMode";
  const TEST_API = "__vidPocketXMediaHookTestApi";
  const MAX_RESPONSE_BYTES = 24 * 1024 * 1024;
  const candidateCache = new Map();
  let existingScanTimer = 0;
  let lastExistingScan = 0;

  function extractXMediaCandidates(payload, options = {}) {
    const maxNodes = Number(options.maxNodes) || 60000;
    const maxDepth = Number(options.maxDepth) || 36;
    const results = new Map();
    const visited = new WeakSet();
    let visitedNodes = 0;

    visit(payload, emptyContext(), 0);
    return Array.from(results.values());

    function visit(value, inheritedContext, depth) {
      if (visitedNodes >= maxNodes || depth > maxDepth || value === null || value === undefined) {
        return;
      }

      if (typeof value === "string") {
        collectUrlsFromString(value, inheritedContext, results);
        if (value.length < 2_000_000 && value.includes("video.twimg.com") && /^[\s]*[\[{]/.test(value)) {
          try {
            visit(JSON.parse(value), inheritedContext, depth + 1);
          } catch {
            // Some X response fields contain text that only resembles JSON.
          }
        }
        return;
      }

      if (typeof value !== "object" || visited.has(value)) {
        return;
      }
      visited.add(value);
      visitedNodes += 1;

      const context = contextFromObject(value, inheritedContext);
      collectVariants(value, context, results);

      if (Array.isArray(value)) {
        for (let index = 0; index < value.length && visitedNodes < maxNodes; index += 1) {
          visit(value[index], context, depth + 1);
        }
        return;
      }

      for (const child of Object.values(value)) {
        if (visitedNodes >= maxNodes) {
          break;
        }
        visit(child, context, depth + 1);
      }
    }
  }

  function emptyContext() {
    return {
      label: "",
      thumbnail: "",
      duration: 0,
      width: 0,
      height: 0,
      mediaId: ""
    };
  }

  function contextFromObject(value, inherited) {
    const videoInfo = objectValue(value.video_info) || objectValue(value.videoInfo) || {};
    const additionalInfo = objectValue(value.additional_media_info) || objectValue(value.additionalMediaInfo) || {};
    const originalInfo = objectValue(value.original_info) || objectValue(value.originalInfo) || {};
    const duration = durationFromMilliseconds(firstNumber([
      value.duration_ms,
      value.duration_millis,
      value.durationMillis,
      videoInfo.duration_ms,
      videoInfo.duration_millis,
      videoInfo.durationMillis
    ]));
    const thumbnail = firstXImageUrl([
      value.preview_image_url,
      value.previewImageUrl,
      value.media_url_https,
      value.media_url,
      inherited.thumbnail
    ]);
    const label = firstText([
      additionalInfo.title,
      value.full_text,
      value.fullText,
      inherited.label
    ]);

    return {
      label,
      thumbnail,
      duration: duration || inherited.duration || 0,
      width: positiveDimension(value.width || value.w || originalInfo.width || originalInfo.w) || inherited.width || 0,
      height: positiveDimension(value.height || value.h || originalInfo.height || originalInfo.h) || inherited.height || 0,
      mediaId: firstText([value.media_key, value.mediaKey, value.id_str, value.id, inherited.mediaId], 100)
    };
  }

  function collectVariants(value, context, results) {
    const arrays = [];
    if (Array.isArray(value.variants)) {
      arrays.push(value.variants);
    }
    if (value.video_info && Array.isArray(value.video_info.variants)) {
      arrays.push(value.video_info.variants);
    }
    if (value.videoInfo && Array.isArray(value.videoInfo.variants)) {
      arrays.push(value.videoInfo.variants);
    }

    const seenArrays = new Set();
    arrays.forEach((variants) => {
      if (seenArrays.has(variants)) {
        return;
      }
      seenArrays.add(variants);
      variants.forEach((variant) => {
        if (!variant || typeof variant !== "object") {
          return;
        }
        addXMediaUrl(results, variant.url || variant.src || "", {
          ...context,
          contentType: String(variant.content_type || variant.contentType || ""),
          bitrate: firstNumber([variant.bitrate, variant.bit_rate, variant.bitRate])
        });
      });
    });
  }

  function collectUrlsFromString(value, context, results) {
    if (!value.includes("video.twimg.com")) {
      return;
    }
    const normalized = value.replace(/\\u002[fF]/g, "/").replace(/\\\//g, "/").replace(/&amp;/g, "&");
    const matches = normalized.match(/https:\/\/video\.twimg\.com\/[^\s"'<>\\]+/gi) || [];
    matches.slice(0, 80).forEach((url) => addXMediaUrl(results, url, context));
  }

  function addXMediaUrl(results, rawUrl, context) {
    const url = sanitizeXMediaUrl(rawUrl);
    if (!url) {
      return;
    }
    const dimensions = dimensionsFromUrl(url);
    const isHls = /\.m3u8(?:[?#]|$)/i.test(url);
    const contentType = String(context.contentType || (isHls ? "application/x-mpegURL" : "video/mp4"));
    const candidate = {
      url,
      kind: isHls ? "hls" : "video",
      source: "page-api",
      label: context.label || "",
      contentType,
      duration: Number(context.duration) || 0,
      width: dimensions.width || Number(context.width) || 0,
      height: dimensions.height || Number(context.height) || 0,
      quality: dimensions.height ? `${dimensions.height}p` : qualityFromDimensions(context.width, context.height),
      format: isHls ? "HLS" : "MP4",
      thumbnail: sanitizeXImageUrl(context.thumbnail),
      mediaId: String(context.mediaId || ""),
      bitrate: Number(context.bitrate) || 0
    };
    const existing = results.get(url);
    results.set(url, existing ? mergeCandidate(existing, candidate) : candidate);
  }

  function mergeCandidate(existing, next) {
    return {
      ...existing,
      ...next,
      label: next.label || existing.label || "",
      thumbnail: next.thumbnail || existing.thumbnail || "",
      duration: next.duration || existing.duration || 0,
      width: next.width || existing.width || 0,
      height: next.height || existing.height || 0,
      quality: next.quality || existing.quality || "",
      mediaId: next.mediaId || existing.mediaId || "",
      bitrate: next.bitrate || existing.bitrate || 0
    };
  }

  function sanitizeXMediaUrl(value) {
    if (!value || typeof value !== "string") {
      return "";
    }
    try {
      const url = new URL(value.replace(/[),.;]+$/, ""));
      if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "video.twimg.com") {
        return "";
      }
      if (!/\.(?:mp4|m3u8)(?:[?#]|$)/i.test(url.href)) {
        return "";
      }
      return url.href;
    } catch {
      return "";
    }
  }

  function sanitizeXImageUrl(value) {
    if (!value || typeof value !== "string") {
      return "";
    }
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname.toLowerCase() === "pbs.twimg.com" ? url.href : "";
    } catch {
      return "";
    }
  }

  function firstXImageUrl(values) {
    for (const value of values) {
      const url = sanitizeXImageUrl(value);
      if (url) {
        return url;
      }
    }
    return "";
  }

  function dimensionsFromUrl(value) {
    const match = /(?:^|\/)(\d{2,4})x(\d{2,4})(?:\/|$)/.exec(value);
    return match ? { width: Number(match[1]) || 0, height: Number(match[2]) || 0 } : { width: 0, height: 0 };
  }

  function qualityFromDimensions(width, height) {
    const safeWidth = positiveDimension(width);
    const safeHeight = positiveDimension(height);
    if (!safeWidth || !safeHeight) {
      return "";
    }
    return `${safeHeight}p`;
  }

  function positiveDimension(value) {
    const number = Number(value) || 0;
    return number > 0 && number <= 16384 ? number : 0;
  }

  function durationFromMilliseconds(value) {
    const number = Number(value) || 0;
    if (number <= 0) {
      return 0;
    }
    const seconds = number / 1000;
    return seconds <= 24 * 60 * 60 ? seconds : 0;
  }

  function firstNumber(values) {
    for (const value of values) {
      const number = Number(value);
      if (Number.isFinite(number) && number > 0) {
        return number;
      }
    }
    return 0;
  }

  function firstText(values, maxLength = 180) {
    for (const value of values) {
      if (typeof value !== "string") {
        continue;
      }
      const text = value.replace(/\s+/g, " ").trim();
      if (text) {
        return text.slice(0, maxLength);
      }
    }
    return "";
  }

  function objectValue(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  }

  function ingestPayload(payload, options) {
    const extracted = extractXMediaCandidates(payload, options);
    const changed = [];
    extracted.forEach((candidate) => {
      const previous = candidateCache.get(candidate.url);
      const merged = previous ? mergeCandidate(previous, candidate) : candidate;
      candidateCache.set(candidate.url, merged);
      if (!previous || JSON.stringify(previous) !== JSON.stringify(merged)) {
        changed.push(merged);
      }
    });
    if (changed.length) {
      emitCandidates(changed);
    }
    return extracted;
  }

  function emitCandidates(candidates) {
    root.postMessage({
      source: RESPONSE_SOURCE,
      type: "candidates",
      candidates: candidates.slice(0, 200)
    }, "*");
  }

  function inspectFetchResponse(response) {
    if (!response || typeof response.clone !== "function" || !shouldInspectResponse(response.url, response.headers)) {
      return;
    }
    const length = Number(response.headers && response.headers.get && response.headers.get("content-length")) || 0;
    if (length > MAX_RESPONSE_BYTES) {
      return;
    }
    response.clone().text().then((text) => {
      if (!text || text.length > MAX_RESPONSE_BYTES || !text.includes("video.twimg.com")) {
        return;
      }
      ingestPayload(JSON.parse(text));
    }).catch(() => {});
  }

  function shouldInspectResponse(url, headers) {
    const contentType = String(headers && headers.get && headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("json")) {
      return true;
    }
    return /(?:\/i\/api\/|\/graphql\/|\/timeline\/)/i.test(String(url || ""));
  }

  function installFetchHook() {
    if (typeof root.fetch !== "function") {
      return;
    }
    const nativeFetch = root.fetch;
    const wrappedFetch = function (...args) {
      const request = nativeFetch.apply(this, args);
      Promise.resolve(request).then(inspectFetchResponse).catch(() => {});
      return request;
    };
    try {
      Object.defineProperty(wrappedFetch, "name", { value: nativeFetch.name, configurable: true });
    } catch {
      // Function metadata is cosmetic and may be non-configurable.
    }
    root.fetch = wrappedFetch;
  }

  function installXhrHook() {
    const Xhr = root.XMLHttpRequest;
    if (!Xhr || !Xhr.prototype) {
      return;
    }
    const nativeOpen = Xhr.prototype.open;
    const nativeSend = Xhr.prototype.send;
    if (typeof nativeOpen !== "function" || typeof nativeSend !== "function") {
      return;
    }
    const requestUrl = Symbol("vidpocket-xhr-url");
    Xhr.prototype.open = function (method, url, ...rest) {
      this[requestUrl] = String(url || "");
      return nativeOpen.call(this, method, url, ...rest);
    };
    Xhr.prototype.send = function (...args) {
      this.addEventListener("load", () => {
        try {
          if (!shouldInspectResponse(this.responseURL || this[requestUrl], { get: (name) => this.getResponseHeader(name) })) {
            return;
          }
          const payload = this.responseType === "json" ? this.response : JSON.parse(this.responseText || "");
          ingestPayload(payload);
        } catch {
          // Binary and non-JSON responses are intentionally ignored.
        }
      }, { once: true });
      return nativeSend.apply(this, args);
    };
  }

  function scheduleExistingPageScan() {
    clearTimeout(existingScanTimer);
    const delay = Math.max(0, 600 - (Date.now() - lastExistingScan));
    existingScanTimer = setTimeout(scanExistingPage, delay);
  }

  function scanExistingPage() {
    lastExistingScan = Date.now();
    if (!root.document || typeof root.document.querySelectorAll !== "function") {
      return;
    }

    const scripts = Array.from(root.document.querySelectorAll("script[type='application/json'], script#__NEXT_DATA__")).slice(0, 40);
    scripts.forEach((script) => {
      const text = String(script.textContent || "");
      if (!text.includes("video.twimg.com") || text.length > MAX_RESPONSE_BYTES) {
        return;
      }
      try {
        ingestPayload(JSON.parse(text));
      } catch {
        // Ignore unrelated inline JSON.
      }
    });

    if (root.performance && typeof root.performance.getEntriesByType === "function") {
      root.performance.getEntriesByType("resource").forEach((entry) => {
        const url = String(entry && entry.name || "");
        if (url.includes("video.twimg.com") && /\.(?:mp4|m3u8)(?:[?#]|$)/i.test(url)) {
          ingestPayload(url, { maxNodes: 1000, maxDepth: 4 });
        }
      });
    }

    const reactRoots = Array.from(root.document.querySelectorAll("article, [data-testid='tweet']")).slice(0, 50);
    reactRoots.forEach((element) => {
      let keys = [];
      try {
        keys = Object.getOwnPropertyNames(element).filter((key) => /^__react(?:Props|Fiber)\$/.test(key));
      } catch {
        return;
      }
      keys.slice(0, 4).forEach((key) => {
        try {
          ingestPayload(element[key], { maxNodes: 20000, maxDepth: 48 });
        } catch {
          // React internals are optional and may change at any time.
        }
      });
    });

    const mediaNodes = Array.from(root.document.querySelectorAll("video, [data-testid='videoPlayer'], article [data-testid]")).slice(0, 240);
    mediaNodes.forEach((element) => {
      let keys = [];
      try {
        keys = Object.getOwnPropertyNames(element).filter((key) => /^__react(?:Props|Fiber)\$/.test(key));
      } catch {
        return;
      }
      keys.slice(0, 2).forEach((key) => {
        try {
          ingestPayload(element[key], { maxNodes: 8000, maxDepth: 40 });
        } catch {
          // X changes React internals regularly; the network hooks remain the primary source.
        }
      });
    });

    if (candidateCache.size) {
      emitCandidates(Array.from(candidateCache.values()));
    }
  }

  if (root[TEST_MODE]) {
    root[TEST_API] = {
      extractXMediaCandidates,
      sanitizeXMediaUrl,
      dimensionsFromUrl
    };
  }

  if (root[INSTALL_MARKER]) {
    return;
  }
  try {
    Object.defineProperty(root, INSTALL_MARKER, { value: true, configurable: false });
  } catch {
    root[INSTALL_MARKER] = true;
  }

  installFetchHook();
  installXhrHook();
  root.addEventListener("message", (event) => {
    if (event.source !== root || !event.data || event.data.source !== REQUEST_SOURCE || event.data.type !== "scan-x-media") {
      return;
    }
    scheduleExistingPageScan();
  });

  if (root.document && root.document.readyState === "loading") {
    root.document.addEventListener("DOMContentLoaded", scheduleExistingPageScan, { once: true });
  } else {
    scheduleExistingPageScan();
  }
})();
