(() => {
  const root = window;
  const RESPONSE_SOURCE = "vidpocket-threads-media-hook";
  const REQUEST_SOURCE = "vidpocket-content";
  const INSTALL_MARKER = "__vidPocketThreadsMediaHookInstalled";
  const TEST_MODE = "__vidPocketThreadsMediaHookTestMode";
  const TEST_API = "__vidPocketThreadsMediaHookTestApi";
  const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
  const MAX_CANDIDATES = 120;
  const MEDIA_KEYWORD_RE = /video_versions|playable_url|video_url/i;
  const candidateCache = new Map();
  let existingScanTimer = 0;

  function extractThreadsMediaCandidates(payload, options = {}) {
    const maxNodes = Number(options.maxNodes) || 50000;
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
        if (value.length < 2_000_000 && /^[\s]*[\[{]/.test(value) && MEDIA_KEYWORD_RE.test(value)) {
          try {
            visit(JSON.parse(value), inheritedContext, depth + 1);
          } catch {
            // Ignore text values that merely resemble JSON.
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
      collectVideoVersions(value, context, results);

      if (Array.isArray(value)) {
        for (let index = 0; index < value.length && visitedNodes < maxNodes; index += 1) {
          visit(value[index], context, depth + 1);
        }
        return;
      }

      for (const child of Object.values(value)) {
        if (visitedNodes >= maxNodes) break;
        visit(child, context, depth + 1);
      }
    }
  }

  function emptyContext() {
    return { label: "", author: "", thumbnail: "", duration: 0, width: 0, height: 0, mediaId: "", postCode: "" };
  }

  function contextFromObject(value, inherited) {
    const imageVersions = objectValue(value.image_versions2) || objectValue(value.imageVersions2) || {};
    const caption = objectValue(value.caption) || {};
    const user = objectValue(value.user) || objectValue(value.owner) || {};
    const isMedia = hasVideoVariants(value);
    const duration = firstDuration([
      [value.video_duration, "seconds"],
      [value.videoDuration, "seconds"],
      [isMedia ? value.duration : 0, "seconds"],
      [value.duration_ms, "milliseconds"],
      [value.durationMillis, "milliseconds"],
      [isMedia ? dashManifestDuration(value.video_dash_manifest) : 0, "seconds"]
    ]);

    // Only captions and titles become labels; generic "text" fields belong to UI strings.
    return {
      label: firstText([caption.text, value.title, inherited.label]),
      author: firstText([user.username, inherited.author], 60),
      // Shortcode of the post (or carousel parent) that owns this video, as in /post/<code>.
      postCode: firstText([value.code, inherited.postCode], 40),
      thumbnail: firstThreadsImageUrl([
        value.thumbnail_url,
        value.thumbnailUrl,
        value.display_url,
        value.displayUrl,
        firstImageCandidate(imageVersions.candidates),
        inherited.thumbnail
      ]),
      duration: duration || inherited.duration || 0,
      width: positiveDimension(value.original_width || value.width || value.video_width || value.videoWidth) || inherited.width || 0,
      height: positiveDimension(value.original_height || value.height || value.video_height || value.videoHeight) || inherited.height || 0,
      mediaId: isMedia
        ? firstText([value.pk, value.id, value.code, value.media_id, value.mediaId], 100)
        : inherited.mediaId
    };
  }

  function hasVideoVariants(value) {
    return [value.video_versions, value.videoVersions, value.video_versions_v2, value.videoVersionsV2]
      .some((variants) => Array.isArray(variants) && variants.length > 0) ||
      Boolean(value.playable_url || value.playableUrl || value.video_url || value.videoUrl);
  }

  function dashManifestDuration(manifest) {
    if (typeof manifest !== "string") return 0;
    const match = /mediaPresentationDuration="PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?"/.exec(manifest);
    if (!match) return 0;
    return (Number(match[1]) || 0) * 3600 + (Number(match[2]) || 0) * 60 + (Number(match[3]) || 0);
  }

  function durationFromEfg(url) {
    // Meta CDN URLs carry base64 JSON in "efg", which includes the clip length as duration_s.
    try {
      const efg = new URL(url).searchParams.get("efg");
      if (!efg) return 0;
      const json = JSON.parse(atob(efg.replace(/-/g, "+").replace(/_/g, "/")));
      const seconds = Number(json && json.duration_s) || 0;
      return seconds > 0 && seconds <= 24 * 60 * 60 ? seconds : 0;
    } catch {
      return 0;
    }
  }

  function collectVideoVersions(value, context, results) {
    const variantArrays = [
      value.video_versions,
      value.videoVersions,
      value.video_versions_v2,
      value.videoVersionsV2
    ].filter(Array.isArray);

    variantArrays.forEach((variants) => {
      variants.slice(0, 20).forEach((variant) => {
        if (!variant || typeof variant !== "object") return;
        addThreadsMediaUrl(results, variant.url || variant.src || "", {
          ...context,
          contentType: String(variant.mime_type || variant.mimeType || variant.content_type || variant.contentType || ""),
          width: positiveDimension(variant.width || variant.original_width) || context.width,
          height: positiveDimension(variant.height || variant.original_height) || context.height,
          bitrate: firstNumber([variant.bitrate, variant.bit_rate, variant.bitRate])
        });
      });
    });

    [value.playable_url, value.playableUrl, value.video_url, value.videoUrl].forEach((url) => {
      addThreadsMediaUrl(results, url, context);
    });
  }

  function addThreadsMediaUrl(results, rawUrl, context) {
    const url = sanitizeThreadsMediaUrl(rawUrl);
    if (!url) return;

    const contentType = String(context.contentType || "").toLowerCase();
    const isHls = /\.m3u8(?:[?#]|$)/i.test(url) || contentType.includes("mpegurl");
    const text = context.label || "";
    const label = context.author ? `@${context.author}${text ? ` · ${text}` : ""}` : text;
    const candidate = {
      url,
      kind: isHls ? "hls" : "video",
      source: "page-api",
      label: label.slice(0, 180),
      contentType: isHls ? "application/x-mpegURL" : (contentType || "video/mp4"),
      duration: Number(context.duration) || durationFromEfg(url),
      width: Number(context.width) || 0,
      height: Number(context.height) || 0,
      quality: qualityFromDimensions(context.width, context.height),
      format: isHls ? "HLS" : "MP4",
      thumbnail: sanitizeThreadsImageUrl(context.thumbnail),
      mediaId: String(context.mediaId || ""),
      postCode: String(context.postCode || ""),
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
      postCode: next.postCode || existing.postCode || "",
      bitrate: next.bitrate || existing.bitrate || 0
    };
  }

  function sanitizeThreadsMediaUrl(value) {
    if (!value || typeof value !== "string") return "";
    try {
      const url = new URL(value.replace(/&amp;/g, "&").replace(/\\u0026/g, "&"));
      return url.protocol === "https:" && isThreadsCdnHost(url.hostname) && !isByteRangeSegment(url) ? url.href : "";
    } catch {
      return "";
    }
  }

  // DASH playback requests a slice of a track via bytestart/byteend; saving one yields a broken fragment.
  function isByteRangeSegment(url) {
    return url.searchParams.has("bytestart") || url.searchParams.has("byteend");
  }

  function sanitizeThreadsImageUrl(value) {
    return sanitizeThreadsMediaUrl(value);
  }

  function firstThreadsImageUrl(values) {
    for (const value of values) {
      const url = sanitizeThreadsImageUrl(value);
      if (url) return url;
    }
    return "";
  }

  function isThreadsCdnHost(hostname) {
    const host = String(hostname || "").toLowerCase();
    return host === "cdninstagram.com" || host.endsWith(".cdninstagram.com") || host === "fbcdn.net" || host.endsWith(".fbcdn.net");
  }

  // The popup thumbnail is 140px wide; the smallest cover at least 320px wide stays sharp on
  // 2x screens and is often 10x lighter than the full-size first candidate.
  const MIN_COVER_WIDTH = 320;

  function firstImageCandidate(candidates) {
    if (!Array.isArray(candidates)) return "";
    const usable = candidates.filter((candidate) => candidate && typeof candidate.url === "string");
    if (!usable.length) return "";
    const sized = usable.filter((candidate) => Number(candidate.width) > 0);
    if (!sized.length) return usable[0].url;
    const bigEnough = sized.filter((candidate) => Number(candidate.width) >= MIN_COVER_WIDTH);
    const pick = bigEnough.length
      ? bigEnough.reduce((best, candidate) => (Number(candidate.width) < Number(best.width) ? candidate : best))
      : sized.reduce((best, candidate) => (Number(candidate.width) > Number(best.width) ? candidate : best));
    return pick.url;
  }

  function firstDuration(values) {
    for (const [value, unit] of values) {
      const number = Number(value) || 0;
      if (!Number.isFinite(number) || number <= 0) continue;
      const seconds = unit === "milliseconds" ? number / 1000 : number;
      if (seconds <= 24 * 60 * 60) return seconds;
    }
    return 0;
  }

  function positiveDimension(value) {
    const number = Number(value) || 0;
    return number > 0 && number <= 16384 ? number : 0;
  }

  function qualityFromDimensions(width, height) {
    const safeWidth = positiveDimension(width);
    const safeHeight = positiveDimension(height);
    // Use the short side so portrait clips read as 720p rather than 1280p.
    return safeWidth && safeHeight ? `${Math.min(safeWidth, safeHeight)}p` : "";
  }

  function firstNumber(values) {
    for (const value of values) {
      const number = Number(value);
      if (Number.isFinite(number) && number > 0) return number;
    }
    return 0;
  }

  function firstText(values, maxLength = 180) {
    for (const value of values) {
      if (typeof value !== "string" && typeof value !== "number") continue;
      const text = String(value).replace(/\s+/g, " ").trim();
      if (text) return text.slice(0, maxLength);
    }
    return "";
  }

  function objectValue(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  }

  function ingestPayload(payload, options) {
    const extracted = extractThreadsMediaCandidates(payload, options);
    const changed = [];
    extracted.forEach((candidate) => {
      const previous = candidateCache.get(candidate.url);
      const merged = previous ? mergeCandidate(previous, candidate) : candidate;
      candidateCache.set(candidate.url, merged);
      if (!previous || JSON.stringify(previous) !== JSON.stringify(merged)) changed.push(merged);
    });
    if (changed.length) emitCandidates(changed);
    return extracted;
  }

  function emitCandidates(candidates) {
    root.postMessage({
      source: RESPONSE_SOURCE,
      type: "candidates",
      candidates: candidates.slice(0, MAX_CANDIDATES)
    }, "*");
  }

  // Meta endpoints may prefix "for (;;);" and stream several JSON documents separated by newlines.
  function parsePayloadText(text) {
    const body = String(text || "").replace(/^\s*for\s*\(;;\);\s*/, "");
    if (!body) return [];
    try {
      return [JSON.parse(body)];
    } catch {}
    const payloads = [];
    body.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!/^[\[{]/.test(trimmed) || !MEDIA_KEYWORD_RE.test(trimmed)) return;
      try {
        payloads.push(JSON.parse(trimmed));
      } catch {}
    });
    return payloads;
  }

  function ingestText(text) {
    if (!text || text.length > MAX_RESPONSE_BYTES || !MEDIA_KEYWORD_RE.test(text)) return;
    parsePayloadText(text).forEach((payload) => ingestPayload(payload));
  }

  function inspectFetchResponse(response) {
    if (!response || typeof response.clone !== "function" || !shouldInspectResponse(response.url, response.headers)) return;
    const length = Number(response.headers && response.headers.get && response.headers.get("content-length")) || 0;
    if (length > MAX_RESPONSE_BYTES) return;
    response.clone().text().then(ingestText).catch(() => {});
  }

  function shouldInspectResponse(url, headers) {
    const contentType = String(headers && headers.get && headers.get("content-type") || "").toLowerCase();
    return contentType.includes("json") || contentType.includes("javascript") || /(?:graphql|\/api\/|ajax)/i.test(String(url || ""));
  }

  function installFetchHook() {
    if (typeof root.fetch !== "function") return;
    const nativeFetch = root.fetch;
    const wrappedFetch = function (...args) {
      const request = nativeFetch.apply(this, args);
      Promise.resolve(request).then(inspectFetchResponse).catch(() => {});
      return request;
    };
    try {
      Object.defineProperty(wrappedFetch, "name", { value: nativeFetch.name, configurable: true });
    } catch {}
    root.fetch = wrappedFetch;
  }

  function installXhrHook() {
    const Xhr = root.XMLHttpRequest;
    if (!Xhr || !Xhr.prototype) return;
    const nativeOpen = Xhr.prototype.open;
    const nativeSend = Xhr.prototype.send;
    if (typeof nativeOpen !== "function" || typeof nativeSend !== "function") return;
    const requestUrl = Symbol("vidpocket-threads-xhr-url");
    Xhr.prototype.open = function (method, url, ...rest) {
      this[requestUrl] = String(url || "");
      return nativeOpen.call(this, method, url, ...rest);
    };
    Xhr.prototype.send = function (...args) {
      this.addEventListener("load", () => {
        try {
          if (!shouldInspectResponse(this.responseURL || this[requestUrl], { get: (name) => this.getResponseHeader(name) })) return;
          if (this.responseType === "json") {
            if (this.response) ingestPayload(this.response);
          } else if (!this.responseType || this.responseType === "text") {
            ingestText(this.responseText || "");
          }
        } catch {}
      }, { once: true });
      return nativeSend.apply(this, args);
    };
  }

  function scheduleExistingPageScan() {
    clearTimeout(existingScanTimer);
    existingScanTimer = setTimeout(scanExistingPage, 250);
  }

  function scanExistingPage() {
    if (!root.document || typeof root.document.querySelectorAll !== "function") return;
    // Post pages embed dozens of JSON script tags; the media payload is often near the end.
    root.document.querySelectorAll("script[type='application/json'], script#__NEXT_DATA__").forEach((script) => {
      ingestText(String(script.textContent || ""));
    });

    if (candidateCache.size) emitCandidates(Array.from(candidateCache.values()));
  }

  if (root[TEST_MODE]) {
    root[TEST_API] = { extractThreadsMediaCandidates, sanitizeThreadsMediaUrl, isThreadsCdnHost, parsePayloadText, durationFromEfg, dashManifestDuration };
  }

  if (root[INSTALL_MARKER]) return;
  try {
    Object.defineProperty(root, INSTALL_MARKER, { value: true, configurable: false });
  } catch {
    root[INSTALL_MARKER] = true;
  }

  installFetchHook();
  installXhrHook();
  root.addEventListener("message", (event) => {
    if (event.source === root && event.data && event.data.source === REQUEST_SOURCE && event.data.type === "scan-threads-media") {
      scheduleExistingPageScan();
    }
  });

  if (root.document && root.document.readyState === "loading") {
    root.document.addEventListener("DOMContentLoaded", scheduleExistingPageScan, { once: true });
  } else {
    scheduleExistingPageScan();
  }
})();
