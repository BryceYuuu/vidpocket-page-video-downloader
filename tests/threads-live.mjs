// Live check against a public Threads video post in a clean Chrome for Testing profile:
// detection in the popup, real post title and cover, direct download, and audio+video streams.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const chromeBinary = process.env.VIDPOCKET_CHROME_BINARY ||
  "/tmp/vidpocket-browser/chrome/mac_arm-155.0.8059.84/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const threadsUrl = process.env.VIDPOCKET_THREADS_URL || "https://www.threads.com/@wnba/post/Des5YAOjj2d";
const expectAudio = process.env.VIDPOCKET_THREADS_EXPECT_AUDIO !== "0";
const runDir = path.join(os.tmpdir(), `vidpocket-threads-live-${process.pid}`);
const profileDir = path.join(runDir, "profile");
const downloadDir = path.join(runDir, "downloads");
await rm(runDir, { recursive: true, force: true });
await mkdir(profileDir, { recursive: true });
await mkdir(downloadDir, { recursive: true });
// Use profile prefs instead of Browser.setDownloadBehavior, which overrides extension-chosen filenames.
await mkdir(path.join(profileDir, "Default"), { recursive: true });
await writeFile(path.join(profileDir, "Default", "Preferences"), JSON.stringify({
  download: { default_directory: downloadDir, prompt_for_download: false, directory_upgrade: true }
}));
const extensionDir = await stageExtension(path.resolve(process.env.VIDPOCKET_EXTENSION_DIR || "."));

const stderr = [];
const chrome = spawn(chromeBinary, [
  "--headless=new",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--mute-audio",
  `--disable-extensions-except=${extensionDir}`,
  `--load-extension=${extensionDir}`,
  `--user-data-dir=${profileDir}`,
  "--remote-debugging-port=0",
  "--window-size=1440,1000",
  threadsUrl
], { stdio: ["ignore", "ignore", "pipe"] });
chrome.stderr.setEncoding("utf8");
chrome.stderr.on("data", (chunk) => {
  stderr.push(chunk);
  if (stderr.join("").length > 12000) stderr.shift();
});

let browserClient;
let popupClient;
try {
  const { port, browserPath } = await waitForDevTools(profileDir);
  const baseUrl = `http://127.0.0.1:${port}`;
  const version = await fetchJson(`${baseUrl}/json/version`);
  browserClient = await connectCdp(version.webSocketDebuggerUrl || `ws://127.0.0.1:${port}${browserPath}`);

  const workerTarget = await waitForTarget(baseUrl, (target) =>
    target.type === "service_worker" && /^chrome-extension:\/\/[^/]+\/src\/background\.js$/.test(target.url)
  );
  const extensionId = new URL(workerTarget.url).hostname;
  await waitForTarget(baseUrl, (target) => target.type === "page" && /threads\.(com|net)/.test(String(target.url || "")));
  // Let the post render and its embedded data load before opening the popup.
  await delay(6000);

  const createdPopup = await browserClient.send("Target.createTarget", { url: `chrome-extension://${extensionId}/popup.html?tabId=-1`, background: true });
  const popupTarget = await waitForTarget(baseUrl, (target) => target.id === createdPopup.targetId);
  popupClient = await connectCdp(popupTarget.webSocketDebuggerUrl);
  await popupClient.send("Runtime.enable");
  await popupClient.send("Page.enable");
  const threadsTabId = await evaluate(popupClient, `new Promise((resolve) => chrome.tabs.query({}, (tabs) => {
    const tab = tabs.find((item) => /threads\\.(com|net)/.test(item.url || ""));
    resolve(tab ? tab.id : -1);
  }))`);
  assert.ok(threadsTabId >= 0, "the Threads tab should be visible to the extension");
  // Real toolbar popup size, so lazy previews below the fold can be checked.
  await popupClient.send("Emulation.setDeviceMetricsOverride", { width: 486, height: 600, deviceScaleFactor: 2, mobile: false });
  await popupClient.send("Page.navigate", { url: `chrome-extension://${extensionId}/popup.html?tabId=${threadsTabId}` });
  // A real toolbar popup is visible; background tabs skip rendering and IntersectionObserver.
  await browserClient.send("Target.activateTarget", { targetId: createdPopup.targetId });

  const popupState = await waitForPopupItems(popupClient);
  const row = popupState.items.find((item) => item.kind === "MP4");
  assert.ok(row, "popup should list the Threads video as a direct MP4");
  assert.ok(/^@/.test(row.name) && row.name === popupState.items[0].name, "the first row is the Threads MP4");
  assert.ok(row.imageLoaded, "Threads row should render the real post cover");
  assert.match(row.name, /^@\w/, "Threads row should be titled with the post author and caption");
  assert.ok(row.duration, "Threads row should show the clip duration");
  const postAuthor = (/threads\.(?:com|net)\/@([^/]+)\/post\//.exec(threadsUrl) || [])[1];
  if (postAuthor) {
    assert.ok(popupState.items[0].name.startsWith(`@${postAuthor} `), "the viewed post's own video should be listed first");
  }
  const screenshot = await popupClient.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 486, height: 600, scale: 1 } });
  const screenshotPath = path.join(runDir, "popup.png");
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));

  const lazy = await evaluate(popupClient, `(() => {
    const rows = Array.from(document.querySelectorAll(".item"));
    const below = rows.filter((row) => row.getBoundingClientRect().top > innerHeight + 260);
    return { rows: rows.length, below: below.length, belowLoaded: below.filter((row) => row.querySelector(".thumb-img").getAttribute("src")).length };
  })()`);
  if (lazy.below) {
    assert.equal(lazy.belowLoaded, 0, "covers far below the visible popup area should not load yet");
    lazy.afterScroll = await evaluate(popupClient, `(async () => {
      const rows = Array.from(document.querySelectorAll(".item"));
      rows[rows.length - 1].scrollIntoView();
      await new Promise((resolve) => setTimeout(resolve, 800));
      return rows.slice(-${lazy.below}).filter((row) => row.querySelector(".thumb-img").getAttribute("src")).length;
    })()`);
    assert.equal(lazy.afterScroll, lazy.below, "covers load once their rows are scrolled into view");
    await evaluate(popupClient, `window.scrollTo(0, 0)`);
  }
  await evaluate(popupClient, `document.querySelector(".item .thumb-img").vidpocketMark = "first-render"`);

  const clicked = await evaluate(popupClient, `(() => {
    const row = Array.from(document.querySelectorAll(".item")).find((item) => item.querySelector(".kind")?.textContent.trim() === "MP4");
    const button = row?.querySelector(".download");
    const result = { found: Boolean(button), disabled: Boolean(button?.disabled), name: row?.querySelector(".name")?.textContent.trim() || "" };
    if (button && !button.disabled) button.click();
    return result;
  })()`);
  assert.equal(clicked.found, true, "a Threads MP4 download button should exist");
  assert.equal(clicked.disabled, false, "the Threads MP4 download button should be enabled");

  // Progress polling re-renders the list; the cover element must be reused, not rebuilt and refetched.
  await delay(2500);
  const reuse = await evaluate(popupClient, `(() => {
    const img = document.querySelector(".item .thumb-img");
    const src = img.getAttribute("src") || "";
    const fetches = performance.getEntriesByType("resource").filter((entry) => entry.name === img.src).length;
    return { mark: img.vidpocketMark || "", fetches, src: src.slice(0, 80) };
  })()`);
  assert.equal(reuse.mark, "first-render", "the first row should be reused across re-renders");
  assert.ok(reuse.fetches <= 1, `the first cover should be fetched once, saw ${reuse.fetches}`);
  const savedFile = await waitForDownload(downloadDir);
  const chromeDownload = await evaluate(popupClient, `new Promise((resolve) => chrome.downloads.search({}, (items) => resolve(items.map((item) => ({
    filename: item.filename, state: item.state, error: item.error || "", byExtensionName: item.byExtensionName || ""
  })))))`);
  const savedStat = await stat(savedFile);
  assert.ok(path.basename(savedFile).startsWith("@"), "the saved file should be named after the post, not the CDN hash");
  const prefix = await readFile(savedFile);
  assert.ok(savedStat.size >= 64 * 1024, "downloaded Threads MP4 should not be a fragment");
  assert.equal(prefix.subarray(4, 8).toString("ascii"), "ftyp", "downloaded file should be an ISO MP4 container");
  const streams = probeStreams(savedFile);
  assert.ok(streams.includes("video"), "downloaded Threads MP4 should contain video");
  if (expectAudio) assert.ok(streams.includes("audio"), "downloaded Threads MP4 should contain audio");

  console.log(JSON.stringify({
    ok: true,
    page: threadsUrl,
    extensionId,
    screenshot: screenshotPath,
    popupStatus: popupState.status,
    detectedItems: popupState.items,
    lazyPreviews: lazy,
    rowReuse: reuse,
    downloaded: { filename: path.basename(savedFile), bytes: savedStat.size, streams, chromeDownload }
  }, null, 2));
} catch (error) {
  const chromeErrors = stderr.join("").trim();
  if (chromeErrors) console.error(chromeErrors.slice(-4000));
  throw error;
} finally {
  await popupClient?.close().catch(() => {});
  await browserClient?.close().catch(() => {});
  chrome.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => chrome.once("exit", resolve)), delay(3000)]);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
}

// Chrome cannot load unpacked content scripts from a non-ASCII folder (e.g. "视频下载"); stage a copy.
async function stageExtension(sourceDir) {
  if (/^[\x20-\x7e]*$/.test(sourceDir)) return sourceDir;
  const stagedDir = path.join(runDir, "extension");
  for (const entry of ["manifest.json", "popup.html", "offscreen.html", "src", "assets", "vendor"]) {
    await cp(path.join(sourceDir, entry), path.join(stagedDir, entry), { recursive: true });
  }
  return stagedDir;
}

function probeStreams(file) {
  const result = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffprobe failed: ${result.stderr}`);
  return result.stdout.split(/\s+/).filter(Boolean);
}

async function waitForDevTools(profile) {
  const file = path.join(profile, "DevToolsActivePort");
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const [port, browserPath] = (await readFile(file, "utf8")).trim().split(/\r?\n/);
      if (port && browserPath) return { port: Number(port), browserPath };
    } catch {}
    await delay(100);
  }
  throw new Error("Chrome did not expose its DevTools port");
}

async function waitForTarget(baseUrl, predicate) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const targets = await fetchJson(`${baseUrl}/json/list`);
    const target = targets.find(predicate);
    if (target && target.webSocketDebuggerUrl) return target;
    await delay(200);
  }
  throw new Error("Expected Chrome target was not created");
}

async function waitForPopupItems(client) {
  const deadline = Date.now() + 30000;
  let state = { status: "", items: [] };
  while (Date.now() < deadline) {
    try {
      state = await evaluate(client, `(() => ({
        status: document.getElementById("status")?.textContent.trim() || "",
        items: Array.from(document.querySelectorAll(".item")).map((item) => {
          const image = item.querySelector(".thumb-img");
          return {
            kind: item.querySelector(".kind")?.textContent.trim() || "",
            quality: item.querySelector(".quality")?.textContent.trim() || "",
            name: item.querySelector(".name")?.textContent.trim() || "",
            duration: item.querySelector(".duration")?.textContent.trim() || "",
            imageLoaded: Boolean(image?.complete && image?.naturalWidth > 0)
          };
        })
      }))()`);
    } catch {}
    const first = state.items[0];
    if (first && first.kind === "MP4" && first.imageLoaded && /^@/.test(first.name)) return state;
    await delay(400);
  }
  throw new Error(`Popup did not render the Threads video: ${JSON.stringify(state)}`);
}

async function waitForDownload(directory) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const names = await readdir(directory);
    const complete = names.find((name) => !name.endsWith(".crdownload") && !name.startsWith("."));
    if (complete) return path.join(directory, complete);
    await delay(250);
  }
  throw new Error("Chrome did not finish the Threads MP4 download");
}

async function evaluate(client, expression) {
  const response = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || "Runtime evaluation failed");
  }
  return response.result?.value;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject, timer } = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(timer);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result || {});
  });
  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP command timed out: ${method}`));
        }, 15000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    async close() {
      if (socket.readyState < WebSocket.CLOSING) socket.close();
    }
  };
}
