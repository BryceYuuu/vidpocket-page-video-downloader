import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const chromeBinary = process.env.VIDPOCKET_CHROME_BINARY ||
  "/tmp/vidpocket-browser/chrome/mac_arm-151.0.7922.76/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const extensionDir = path.resolve(process.env.VIDPOCKET_EXTENSION_DIR || ".");
const tweetId = "2084106804032872591";
const xUrl = `https://x.com/MiniMax_AI/status/${tweetId}`;
const runDir = await makeRunDirectory();
const profileDir = path.join(runDir, "profile");
const downloadDir = path.join(runDir, "downloads");
await mkdir(profileDir, { recursive: true });
await mkdir(downloadDir, { recursive: true });

const stderr = [];
const chrome = spawn(chromeBinary, [
  "--headless=new",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  `--disable-extensions-except=${extensionDir}`,
  `--load-extension=${extensionDir}`,
  `--user-data-dir=${profileDir}`,
  "--remote-debugging-port=0",
  "--window-size=1440,1000",
  xUrl
], {
  stdio: ["ignore", "ignore", "pipe"]
});
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
  await browserClient.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadDir,
    eventsEnabled: true
  });

  const workerTarget = await waitForTarget(baseUrl, (target) =>
    target.type === "service_worker" && /^chrome-extension:\/\/[^/]+\/src\/background\.js$/.test(target.url)
  );
  const extensionId = new URL(workerTarget.url).hostname;
  const xTarget = await waitForTarget(baseUrl, (target) =>
    target.type === "page" && String(target.url || "").includes(`/status/${tweetId}`)
  );
  await browserClient.send("Target.activateTarget", { targetId: xTarget.id });

  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  const createdPopup = await browserClient.send("Target.createTarget", { url: popupUrl, background: true });
  const popupTarget = await waitForTarget(baseUrl, (target) => target.id === createdPopup.targetId);
  popupClient = await connectCdp(popupTarget.webSocketDebuggerUrl);
  await popupClient.send("Runtime.enable");

  const popupState = await waitForPopupItems(popupClient, 5);
  assert.ok(popupState.items.length >= 5, "popup should render the live X MP4 variants");
  assert.ok(popupState.items.some((item) => item.kind === "MP4" && item.quality === "2160p"));
  assert.ok(popupState.items.filter((item) => item.kind === "MP4").every((item) => item.imageLoaded), "all recovered MP4 rows should render their real X thumbnail");
  const screenshot = await popupClient.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    clip: { x: 0, y: 0, width: 486, height: 600, scale: 1 }
  });
  const screenshotPath = path.join(runDir, "popup.png");
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));

  const clicked = await evaluate(popupClient, `(() => {
    const rows = Array.from(document.querySelectorAll(".item"));
    const row = rows.find((item) => item.querySelector(".kind")?.textContent.trim() === "MP4" && item.querySelector(".quality")?.textContent.trim() === "270p") ||
      rows.find((item) => item.querySelector(".kind")?.textContent.trim() === "MP4");
    const button = row?.querySelector(".download");
    const result = {
      found: Boolean(row && button),
      disabled: Boolean(button?.disabled),
      quality: row?.querySelector(".quality")?.textContent.trim() || "",
      name: row?.querySelector(".name")?.textContent.trim() || "",
      buttonText: button?.textContent.trim() || ""
    };
    if (button && !button.disabled) button.click();
    return result;
  })()`);
  assert.equal(clicked.found, true, "a direct MP4 download button should exist");
  assert.equal(clicked.disabled, false, "the selected direct MP4 download button should be enabled");
  await delay(1200);
  const afterClick = await evaluate(popupClient, `(() => ({
    status: document.getElementById("status")?.textContent.trim() || "",
    buttons: Array.from(document.querySelectorAll(".item")).map((item) => ({
      quality: item.querySelector(".quality")?.textContent.trim() || "",
      kind: item.querySelector(".kind")?.textContent.trim() || "",
      text: item.querySelector(".download")?.textContent.trim() || "",
      disabled: Boolean(item.querySelector(".download")?.disabled),
      details: item.querySelector(".details")?.textContent.trim() || ""
    }))
  }))()`);
  console.log(`Download click state: ${JSON.stringify({ clicked, afterClick })}`);

  const savedFile = await waitForDownload(downloadDir, popupClient);
  const savedStat = await stat(savedFile);
  const prefix = await readFile(savedFile);
  assert.ok(savedStat.size >= 64 * 1024, "downloaded MP4 should not be an empty shell");
  assert.equal(prefix.subarray(4, 8).toString("ascii"), "ftyp", "downloaded file should be an ISO MP4 container");

  console.log(JSON.stringify({
    ok: true,
    chrome: chromeBinary,
    cleanProfile: true,
    extensionId,
    page: xUrl,
    screenshot: screenshotPath,
    popupStatus: popupState.status,
    detectedItems: popupState.items,
    downloaded: {
      filename: path.basename(savedFile),
      bytes: savedStat.size,
      container: "MP4",
      selected: clicked
    }
  }, null, 2));
} catch (error) {
  const chromeErrors = stderr.join("").trim();
  if (chromeErrors) console.error(chromeErrors.slice(-6000));
  throw error;
} finally {
  await popupClient?.close().catch(() => {});
  await browserClient?.close().catch(() => {});
  chrome.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => chrome.once("exit", resolve)),
    delay(3000)
  ]);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
}

async function makeRunDirectory() {
  const directory = path.join(os.tmpdir(), `vidpocket-e2e-${process.pid}`);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  return directory;
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

async function waitForPopupItems(client, minimum) {
  const deadline = Date.now() + 25000;
  let state = { status: "", items: [] };
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      state = await evaluate(client, `(() => ({
        href: location.href,
        readyState: document.readyState,
        status: document.getElementById("status")?.textContent.trim() || "",
        items: Array.from(document.querySelectorAll(".item")).map((item) => {
          const image = item.querySelector(".thumb-img");
          return {
            kind: item.querySelector(".kind")?.textContent.trim() || "",
            quality: item.querySelector(".quality")?.textContent.trim() || "",
            name: item.querySelector(".name")?.textContent.trim() || "",
            duration: item.querySelector(".duration")?.textContent.trim() || "",
            imageUrl: image?.src || "",
            imageLoaded: Boolean(image?.complete && image?.naturalWidth > 0)
          };
        })
      }))()`);
      lastError = null;
    } catch (error) {
      lastError = error;
    }
    if (state.items.length >= minimum && state.items.filter((item) => item.kind === "MP4").every((item) => item.imageLoaded)) return state;
    await delay(350);
  }
  throw new Error(`Popup did not render ${minimum} live items: ${JSON.stringify(state)}${lastError ? `; ${lastError.message}` : ""}`);
}

async function waitForDownload(directory, client) {
  const deadline = Date.now() + 45000;
  let debug = null;
  while (Date.now() < deadline) {
    const names = await readdir(directory);
    const complete = names.find((name) => !name.endsWith(".crdownload") && !name.startsWith("."));
    if (complete) return path.join(directory, complete);
    try {
      debug = await evaluate(client, `(async () => ({
        status: document.getElementById("status")?.textContent.trim() || "",
        jobs: activeTab ? await sendRuntimeMessage({ type: "getDownloadJobs", tabId: activeTab.id }) : null,
        chromeDownloads: await new Promise((resolve) => chrome.downloads.search({}, (items) => resolve(items.map((item) => ({
          id: item.id,
          filename: item.filename,
          state: item.state,
          error: item.error,
          bytesReceived: item.bytesReceived,
          totalBytes: item.totalBytes,
          url: item.url
        }))))
      }))()`);
      const failedJob = debug?.jobs?.jobs?.find((job) => job.status === "error");
      if (failedJob) throw new Error(`VidPocket download job failed: ${failedJob.error || JSON.stringify(failedJob)}`);
    } catch (error) {
      if (/VidPocket download job failed/.test(error.message)) throw error;
      debug = { evaluationError: error.message };
    }
    await delay(250);
  }
  throw new Error(`Chrome did not finish the direct MP4 download: ${JSON.stringify(debug)}`);
}

async function evaluate(client, expression) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || "Runtime evaluation failed");
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
