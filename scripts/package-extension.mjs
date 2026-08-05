import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const manifest = JSON.parse(await readFile(path.join(rootDir, "manifest.json"), "utf8"));
const packageName = `vidpocket-${manifest.version}`;
const stageDir = path.join(distDir, packageName);
const zipPath = path.join(distDir, `${packageName}.zip`);

const packageFiles = [
  "manifest.json",
  "popup.html",
  "offscreen.html",
  "src/background.js",
  "src/content.js",
  "src/x-media-hook.js",
  "src/popup.css",
  "src/popup.js",
  "src/offscreen.js",
  "vendor/mux.min.js",
  "vendor/mux.LICENSE",
  "vendor/THIRD_PARTY_NOTICES.txt",
  "vendor/ffmpeg/ffmpeg/index.js",
  "vendor/ffmpeg/ffmpeg/classes.js",
  "vendor/ffmpeg/ffmpeg/types.js",
  "vendor/ffmpeg/ffmpeg/const.js",
  "vendor/ffmpeg/ffmpeg/errors.js",
  "vendor/ffmpeg/ffmpeg/utils.js",
  "vendor/ffmpeg/ffmpeg/worker.js",
  "vendor/ffmpeg/core/ffmpeg-core.js",
  "vendor/ffmpeg/core/ffmpeg-core.wasm",
  "assets/icons/icon16.png",
  "assets/icons/icon32.png",
  "assets/icons/icon48.png",
  "assets/icons/icon128.png"
];

await rm(stageDir, { recursive: true, force: true });
await rm(zipPath, { force: true });
await mkdir(stageDir, { recursive: true });

for (const relativePath of packageFiles) {
  const from = path.join(rootDir, relativePath);
  const to = path.join(stageDir, relativePath);
  if (!existsSync(from)) {
    throw new Error(`Missing package file: ${relativePath}`);
  }
  await mkdir(path.dirname(to), { recursive: true });
  await cp(from, to);
}

execFileSync("zip", ["-r", "-X", zipPath, "."], {
  cwd: stageDir,
  stdio: "inherit"
});

console.log(`Created ${zipPath}`);
