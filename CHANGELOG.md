# Changelog

## 0.5.1

- Added a bounded background fallback for public X posts whose player exposes only a `blob:` URL. The fallback queries X's public syndication response and accepts media only from `video.twimg.com` with previews from `pbs.twimg.com`.
- Made exact X status pages scan directly from the toolbar popup, independent of page playback, React internals, or prior network interception.
- Restored real matching thumbnails, post-derived titles, duration, and resolution metadata for recovered X MP4/HLS variants.
- Deduplicated matching X renditions discovered through both page interception and the public metadata fallback.
- Kept direct MP4 downloads on Chrome's native download path; unencrypted HLS processing remains inside the packaged extension with no local helper requirement.
- Added live clean-profile Chrome coverage that verifies detection, thumbnail rendering, direct download completion, MP4 container validity, and audio/video streams.

## 0.5.0

- Moved unencrypted HLS download and MP4 generation into the packaged extension using an offscreen document, mux.js, and FFmpeg WebAssembly.
- Persisted download jobs in extension storage so work continues after the toolbar popup closes.
- Added background-owned progress and speed reporting for direct and HLS downloads.
- Removed the local helper requirement from the Chrome Web Store package.

## 0.4.8

- Restored the Chrome toolbar popup as the primary VidPocket UI.
- Removed the separate manager window and first-install welcome page from the store package.
- Kept on-demand content-script injection inside the popup so already-open pages can still be scanned.
- Kept Chrome native downloads and in-popup progress display for direct MP4/WebM files.
- Added an early, packaged X media hook that extracts public direct MP4 variants from page responses while preserving matching thumbnails, duration, resolution, and bitrate.
- Added bridge and end-to-end candidate tests for X media payloads and kept all processing local.

## 0.4.7

- Changed the toolbar icon click to open a persistent VidPocket download panel for the current webpage.
- Added on-demand content-script injection so the toolbar action can scan already-open pages when possible.
- Added a first-install welcome page explaining where to open VidPocket and what the store build supports.
- Kept downloads on Chrome's native downloads API for direct-file speed.

## 0.4.6

- Changed the Chrome Web Store build to a no-helper direct-download experience.
- The popup now shows only media files the extension can save directly, such as accessible MP4/WebM videos.
- HLS/m3u8 entries are hidden from the store popup so users are not shown items that need a separate local helper.
- Updated package and store wording to avoid promising HLS conversion in the one-click store install.

## 0.4.5

- Added clearer in-popup guidance for Chrome Web Store users when HLS requires the optional local helper.
- HLS rows now show a helper setup action instead of a misleading download action when the helper is not running.
- Direct MP4/WebM download behavior is unchanged.

## 0.4.4

- Updated the store-facing name to `VidPocket-网页视频下载`.
- Added clearer English and Chinese search terms to the package summary and store overview.
- No download behavior or permissions changed.

## 0.4.3

- Added a public project name: VidPocket.
- Improved HLS job stability and warning behavior when audio is unavailable.
- Added tests for split HLS audio/video handling.
- Added open-source documentation and repository metadata.

## 0.4.2

- Added HLS audio/video source selection and MP4 output validation.
- Added helper-side FFprobe checks for generated files.

## 0.4.1

- Fixed popup progress speed handling.

## 0.4.0

- Added local helper based HLS-to-MP4 workflow.
