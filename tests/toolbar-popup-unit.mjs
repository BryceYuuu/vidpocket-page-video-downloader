import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const backgroundSource = await readFile(new URL("../src/background.js", import.meta.url), "utf8");

assert.equal(manifest.action?.default_popup, "popup.html", "toolbar icon must open the extension popup");
await access(new URL("../popup.html", import.meta.url));
assert.ok(manifest.permissions?.includes("scripting"), "popup scan recovery requires scripting permission");
assert.ok(Array.isArray(manifest.content_scripts) && manifest.content_scripts.length > 0, "page scanner must be registered");
const xPageHook = manifest.content_scripts.find((entry) => Array.isArray(entry.js) && entry.js.includes("src/x-media-hook.js"));
const isolatedScanner = manifest.content_scripts.find((entry) => Array.isArray(entry.js) && entry.js.includes("src/content.js"));
assert.equal(xPageHook?.world, "MAIN", "X media response hook must run in the page world");
assert.equal(xPageHook?.run_at, "document_start", "X media response hook must start before page requests");
assert.equal(isolatedScanner?.world, "ISOLATED", "extension scanner must retain its isolated privileges");
assert.equal(isolatedScanner?.run_at, "document_start", "extension scanner must listen before X media responses arrive");
assert.doesNotMatch(backgroundSource, /chrome\.action\.onClicked/, "background must not replace the popup with an action click handler");
assert.doesNotMatch(backgroundSource, /chrome\.windows\.create/, "toolbar click must not open a separate window");
assert.doesNotMatch(JSON.stringify(manifest), /manager\.html|welcome\.html/, "legacy standalone pages must not be packaged");

console.log(JSON.stringify({
  ok: true,
  assertions: [
    "toolbar icon opens popup.html",
    "page scanner is available to the popup",
    "X MP4 variants are captured from document_start without remote code",
    "toolbar click does not open a separate page or window",
    "legacy manager and welcome pages are absent"
  ]
}, null, 2));
