# VidPocket · 视频口袋

![VidPocket logo](assets/logo.png)

> **Pocket directly accessible web videos as local MP4 files.**
> 把网页上能直接访问的视频，一键存到本地。

A local-first Chrome extension that detects and downloads directly accessible media from any webpage — including unencrypted HLS streams via a local FFmpeg helper.

专为**合法存档、调试、研究和个人媒体管理**设计的 Chrome 扩展。在本地运行，无后端，无遥测。

---

## Features · 功能

| | English | 中文 |
|---|---|---|
| 🔍 | Detects media URLs from page markup and network responses | 从页面结构和网络请求中自动检测媒体链接 |
| 📦 | Supports MP4, WebM, MOV, M4V, MP3, M4A, AAC, OGG, WAV, FLAC | 支持主流视频和音频格式直链下载 |
| 📡 | Downloads unencrypted HLS `.m3u8` streams via local FFmpeg | 通过本地 FFmpeg 下载未加密的 HLS 流并转为 MP4 |
| 🔀 | Merges separate audio/video HLS renditions when available | 自动合并音视频分离的 HLS 流 |
| 🖼️ | Extracts thumbnails from HLS streams | 提取 HLS 流的视频缩略图 |
| 📊 | Shows format, resolution, duration, progress, and speed | 显示格式、分辨率、时长、下载进度和速度 |
| 🚫 | Filters out fragments, placeholders, and unsupported sources | 自动过滤媒体碎片、占位文件和不支持的来源 |
| 🔒 | Hides blob:, encrypted HLS, DASH, and DRM-protected URLs | 隐藏 blob 链接、加密 HLS、DASH 及 DRM 保护内容 |

---

## What It Can't Do · 不支持的内容

VidPocket only works with media your browser can already access directly.
VidPocket 只能下载浏览器本身就能直接访问的媒体资源。

**Not supported by design · 以下场景不在支持范围内：**

- DRM-protected streams（DRM 保护流）
- Encrypted HLS playlists（加密 HLS）
- YouTube and major protected platforms（YouTube 等平台保护内容）
- Login-walled or paywalled media（需登录或付费的内容）
- `blob:` URLs without an exposed media source（无实际来源的 blob 链接）
- DASH `.mpd` workflows（DASH 协议）

> Only use VidPocket where you have the right to save the media.
> 请仅在您有权限保存的内容上使用本工具。

---

## Requirements · 环境要求

- Google Chrome or any Chromium-based browser（支持 Manifest V3）
- macOS（helper 脚本目前仅支持 macOS）
- Node.js 18+
- FFmpeg & FFprobe（需在 PATH 中）

```bash
# Install FFmpeg via Homebrew
brew install ffmpeg
```

---

## Installation · 安装

For a detailed setup guide, see [INSTALL.md](./INSTALL.md)（[中文安装说明](./INSTALL.zh-CN.md)）。

```text
1. Open chrome://extensions
2. Enable Developer mode（开启开发者模式）
3. Click "Load unpacked"（加载已解压的扩展程序）
4. Select the project folder（选择本项目文件夹）
5. Run the helper installer（运行本地助手安装脚本）
```

```bash
./helper/install-helper.command
```

The local helper listens on `http://127.0.0.1:17384`.
本地助手运行在 `http://127.0.0.1:17384`。

```bash
# Health check · 检查助手是否正常运行
curl http://127.0.0.1:17384/health
```

---

## Usage · 使用方法

1. Open a webpage containing video（打开包含视频的网页）
2. Play the video if it hasn't started loading（先播放一下，让页面加载媒体资源）
3. Click the VidPocket extension icon（点击扩展图标）
4. Review detected media entries（查看检测到的媒体列表）
5. Click **Download**（点击下载）

For HLS sources, VidPocket sends the stream to the local helper, which converts it to MP4 via FFmpeg and hands the file to Chrome's downloads API.
HLS 流会先由本地助手通过 FFmpeg 转换为 MP4，再交由 Chrome 完成下载。

---

## Local Helper · 本地助手

The helper is a lightweight local HTTP service that handles tasks Chrome extensions can't do alone.
本地助手是一个轻量级 HTTP 服务，专门处理 Chrome 扩展无法独立完成的任务。

**Responsibilities · 负责内容：**

- Reading and parsing unencrypted HLS playlists（解析未加密 HLS 播放列表）
- Extracting thumbnails（提取缩略图）
- Merging audio/video renditions（合并音视频）
- Converting HLS to MP4 via FFmpeg（转码为 MP4）
- Reporting progress and speed to the popup UI（向弹窗实时上报进度和速度）

On macOS, registered as a LaunchAgent:

```text
~/Library/LaunchAgents/com.vidpocket.helper.plist
```

Temporary files stored at:

```text
~/Library/Application Support/VidPocket
```

---

## Project Structure · 项目结构

```text
.
├── helper/          # Local FFmpeg helper · 本地助手服务
├── src/             # Extension scripts and popup · 扩展脚本和弹窗
├── tests/           # Node-based regression tests · 回归测试
├── test-assets/     # Small media fixtures · 测试媒体文件
├── manifest.json    # Chrome extension manifest
└── popup.html       # Extension popup
```

---

## Development · 开发

```bash
# Run all checks and tests · 运行语法检查和测试
npm test

# Or run individually · 单独运行
node --check src/background.js
node --check src/content.js
node --check src/popup.js
node --check helper/vidpocket-helper.mjs

node tests/background-unit.mjs
node tests/popup-match-unit.mjs
node tests/hls-unit.mjs
```

---

## Privacy · 隐私

VidPocket runs entirely on your machine. It inspects media URLs visible to the active browser tab and sends HLS work to the local helper on `127.0.0.1`. No analytics, no remote telemetry, no hosted backend.

完全本地运行。检测范围仅限当前标签页可见的媒体链接，HLS 转码通过本地 `127.0.0.1` 完成。无数据上报，无远程服务。

---

## License · 许可证

MIT License. See [LICENSE](./LICENSE).

---

## Search Terms · 搜索关键词

**English:** Chrome video downloader, webpage video downloader, web media detector, HLS downloader, m3u8 downloader, FFmpeg browser media helper

**中文：** 网页视频下载、Chrome 视频下载插件、页面视频保存、m3u8 下载、HLS 下载、浏览器视频下载工具
