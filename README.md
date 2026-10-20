# VidPocket

**VidPocket-网页视频下载** is a local-first Chrome extension for detecting, previewing, and saving directly accessible webpage media.

[简体中文](README.zh-CN.md) | [Chrome Web Store](https://chromewebstore.google.com/detail/vidpocket/jpafnjdkpppdlnhhfnhaafabgkpfoaii) | [Privacy Policy](PRIVACY.md)

## Latest Release

**Current stable version: [v0.5.2](https://github.com/BryceYuuu/vidpocket-page-video-downloader/releases/tag/v0.5.2)**

- **Recommended installation:** [Chrome Web Store](https://chromewebstore.google.com/detail/vidpocket/jpafnjdkpppdlnhhfnhaafabgkpfoaii)
- **Latest package and source:** [GitHub Releases](https://github.com/BryceYuuu/vidpocket-page-video-downloader/releases/latest)
- **Complete version history:** [CHANGELOG.md](CHANGELOG.md)

### What's New in v0.5.2

- Adds Threads video support on `threads.com` and `threads.net`: the post author and caption as the title, the real cover, duration, and resolution, with the viewed post's own video listed first. Saved files are complete MP4s with audio.
- Fixes a detection bug (since 0.5.0) that stopped page videos from reaching the popup on any page with a `<video>` element.
- Never offers partial DASH segments as downloads, so saved files are not silent or truncated.
- Faster popup: the list appears almost immediately, covers are about 8x smaller and are no longer reloaded while downloads update, and off-screen previews load only when scrolled into view.
- HLS streams with a separate audio track download video and audio at the same time.
- Keeps the detected list when Chrome suspends the extension's background worker.

## Features

- Opens as a normal Chrome toolbar popup for the active webpage.
- Detects accessible direct MP4, WebM, audio, and media URLs.
- Shows matching thumbnails, duration, format, resolution, source, and readable titles when available.
- Recovers public X video quality variants when the page player exposes only a temporary `blob:` URL.
- Detects Threads videos with the post author, caption, cover, and duration, and saves the complete MP4 with audio.
- Downloads direct files through Chrome's native downloads API.
- Processes supported unencrypted HLS/m3u8 streams into MP4 inside the packaged extension.
- Keeps user-initiated job progress in local extension storage when the popup closes.
- Requires no local helper, native application, account, analytics service, or VidPocket backend.

## Install

### Chrome Web Store

Install [VidPocket from the Chrome Web Store](https://chromewebstore.google.com/detail/vidpocket/jpafnjdkpppdlnhhfnhaafabgkpfoaii). Pin it from Chrome's Extensions menu if the toolbar icon is hidden.

### Load From Source

1. Download the current package from [GitHub Releases](https://github.com/BryceYuuu/vidpocket-page-video-downloader/releases/latest) and extract it, or clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the extracted folder containing `manifest.json`, or select the repository root.

`npm ci` is required only for development, tests, and rebuilding the store package. It is not required to run the packaged extension.

## Use

1. Open a webpage containing media you are allowed to save.
2. Play the video first if the website loads it lazily.
3. Click the VidPocket toolbar icon.
4. Review the matching preview, duration, quality, format, and source.
5. Click **Download** on the desired version.

Direct files use Chrome's normal download system. Supported unencrypted HLS jobs run in the packaged offscreen extension document and produce MP4 output locally.

## X Public Video Detection

Modern X pages often expose only a `blob:` player URL. VidPocket uses a packaged early-response hook and a bounded public-metadata fallback for visible public post IDs. The fallback requests X's public embed metadata directly from `cdn.syndication.twimg.com`, accepts media only from `video.twimg.com`, and accepts previews only from `pbs.twimg.com`.

Private, protected, login-restricted, encrypted, and DRM-protected media are not bypassed.

## Threads Video Detection

Threads plays most videos through a `blob:` player, so the `<video>` element alone is not enough. On `threads.com` and `threads.net`, a packaged page hook reads the post data Threads already delivers to the page (embedded JSON and GraphQL responses) and picks the complete MP4 version of each video, which includes audio. Only HTTPS media and covers on Meta's `cdninstagram.com` / `fbcdn.net` CDNs are accepted. Partial DASH byte-range requests are ignored. No extra request is sent to Threads or any other server.

## Limitations

VidPocket does not promise support for every website. It does not bypass DRM, encryption, paywalls, login restrictions, access controls, or platform protections. YouTube protected downloads are not supported. Availability depends on what the webpage and media host make directly accessible.

Use VidPocket only for media you own or have permission to save.

## Privacy

VidPocket has no analytics, advertising SDK, account system, telemetry service, or hosted backend. Detection, previews, job state, and supported HLS processing remain local to the browser, except for normal requests sent directly to the source media host or X as described in [PRIVACY.md](PRIVACY.md).

## Development

Requirements: Node.js 18 or newer.

```sh
npm ci
npm test
npm run package:store
```

Optional release QA:

```sh
npm run test:slow
npm run test:x-live
VIDPOCKET_CHROME_BINARY="/path/to/Chrome for Testing" npm run test:chrome-live
VIDPOCKET_CHROME_BINARY="/path/to/Chrome for Testing" npm run test:threads-live
```

The Chrome Web Store archive is generated under `dist/` with `manifest.json` at the ZIP root.

## Project Layout

```text
manifest.json          Chrome Manifest V3 configuration
popup.html             Toolbar popup
offscreen.html         Packaged HLS processing document
src/background.js      Detection, X fallback, downloads, and job state
src/content.js         Isolated webpage scanner
src/x-media-hook.js    Packaged X page-response parser
src/offscreen.js       HLS download, muxing, and thumbnail work
src/popup.js           Popup rendering and controls
vendor/                Packaged mux.js and FFmpeg WebAssembly files
tests/                 Unit, media, live API, and clean-Chrome tests
```

## License

[MIT](LICENSE). Third-party components retain their respective licenses; see `vendor/THIRD_PARTY_NOTICES.txt`.
