# VidPocket

![VidPocket logo](assets/logo.png)

**Chrome webpage video downloader for directly accessible media and unencrypted HLS streams.**

VidPocket is a local-first Chrome extension for detecting and saving media resources that are directly accessible from a webpage. It can identify common direct media files and can use a local helper to convert unencrypted HLS playlists into MP4 files.

The project is designed for legitimate archival, debugging, research, and personal media management workflows. It does not bypass DRM, login walls, encryption, platform restrictions, or protected streaming systems.

## Features

- Detects directly accessible media URLs from page markup and network responses.
- Supports common direct media files such as MP4, WebM, MOV, M4V, MP3, M4A, AAC, OGG, WAV, and FLAC.
- Supports unencrypted HLS `.m3u8` playlists through a local FFmpeg helper.
- Converts HLS streams into MP4 files and hands the final file to Chrome's downloads API.
- Shows source, format, resolution, duration, thumbnail state, progress, speed, and stop controls.
- Filters obvious media fragments and tiny placeholder files to avoid broken downloads.
- Hides unsupported `blob:`, `data:`, encrypted HLS, DASH manifests, and internal player fragments instead of presenting them as valid downloads.

## Search Terms

VidPocket may also be described as a Chrome video downloader, webpage video downloader, page video saver, web media detector, HLS downloader, m3u8 downloader, and FFmpeg-based browser media helper.

Chinese search terms: 网页视频下载、页面视频下载、网页视频保存、Chrome 视频下载、m3u8 下载、HLS 下载、浏览器视频下载。

## Boundaries

VidPocket only works with media resources that the browser can directly access. It is not a DRM circumvention tool and does not attempt to extract protected media.

Unsupported by design:

- DRM-protected streams
- encrypted HLS playlists
- YouTube and protected platform media
- login-restricted or paywalled media without proper authorization
- browser-only `blob:` URLs that do not expose a downloadable media source
- DASH `.mpd` workflows

Use this project only where you have the right to access and save the media.

## Requirements

- Google Chrome or another Chromium-based browser with Manifest V3 support
- macOS for the included LaunchAgent helper script
- Node.js 18 or newer
- FFmpeg and FFprobe available in `PATH`

Install FFmpeg with Homebrew:

```sh
brew install ffmpeg
```

## Installation

For a detailed setup guide, see [INSTALL.md](INSTALL.md). A Chinese version is available at [INSTALL.zh-CN.md](INSTALL.zh-CN.md).

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the project folder.
5. Run the helper installer:

```sh
./helper/install-helper.command
```

The helper listens on:

```text
http://127.0.0.1:17384
```

Health check:

```sh
curl http://127.0.0.1:17384/health
```

## Usage

1. Open a webpage that contains directly accessible media.
2. Play the media if the page only loads streams after playback starts.
3. Click the VidPocket extension icon.
4. Review the detected media entries.
5. Click `Download`.

For HLS sources, VidPocket asks the local helper to generate an MP4 file first. After the MP4 is ready, Chrome receives a normal download task.

## Local Helper

The helper is a small local HTTP service used for tasks Chrome extensions cannot reliably perform alone:

- reading unencrypted HLS playlists
- extracting thumbnails from HLS streams
- merging audio/video HLS renditions when possible
- converting HLS to MP4 through FFmpeg
- reporting progress and speed to the popup UI

On macOS, the installer registers it as:

```text
~/Library/LaunchAgents/com.vidpocket.helper.plist
```

The helper stores temporary/generated files under:

```text
~/Library/Application Support/VidPocket
```

## Development

Run syntax checks and tests:

```sh
npm test
```

Or run them individually:

```sh
node --check src/background.js
node --check src/content.js
node --check src/popup.js
node --check helper/vidpocket-helper.mjs
node tests/background-unit.mjs
node tests/popup-match-unit.mjs
node tests/hls-unit.mjs
```

## Project Structure

```text
.
├── helper/                 # Local FFmpeg helper
├── src/                    # Extension scripts and popup styles
├── tests/                  # Node-based regression tests
├── test-assets/            # Small media fixtures
├── manifest.json           # Chrome extension manifest
└── popup.html              # Extension popup
```

## GitHub Repository Setup

Recommended repository metadata:

- Repository name: `vidpocket-page-video-downloader`
- Description: `Chrome webpage video downloader for directly accessible media and unencrypted HLS streams.`
- Topics: `chrome-extension`, `chrome-video-downloader`, `web-video-downloader`, `webpage-video-downloader`, `page-video-downloader`, `video-downloader`, `hls-downloader`, `m3u8-downloader`, `ffmpeg`, `manifest-v3`

Brand name:

- English: `VidPocket`
- Chinese: `视频口袋`
- Tagline: `Pocket directly accessible web videos as local MP4 files.`

## Privacy

VidPocket runs locally. The extension inspects media URLs exposed to the active browser tab and sends HLS work to the local helper on `127.0.0.1`. It does not ship analytics, remote telemetry, or a hosted backend.

## License

MIT License. See [LICENSE](LICENSE).
