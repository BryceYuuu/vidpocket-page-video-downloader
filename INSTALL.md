# Installation and Usage

This guide explains how to install and use VidPocket, a Chrome webpage video downloader for directly accessible media and unencrypted HLS streams, from source.

## 1. Requirements

- Google Chrome or another Chromium-based browser
- macOS
- Node.js 18 or newer
- FFmpeg and FFprobe

Install FFmpeg with Homebrew:

```sh
brew install ffmpeg
```

Check that Node.js and FFmpeg are available:

```sh
node --version
ffmpeg -version
ffprobe -version
```

## 2. Install the Chrome Extension

1. Download or clone this repository.
2. Open Chrome and go to:

```text
chrome://extensions
```

3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select the VidPocket project folder.

Chrome should now show VidPocket in the extensions list.

## 3. Install the Local Helper

The local helper is required for unencrypted HLS `.m3u8` downloads and thumbnails.

From the project folder, run:

```sh
./helper/install-helper.command
```

The helper runs locally at:

```text
http://127.0.0.1:17384
```

Verify it is running:

```sh
curl http://127.0.0.1:17384/health
```

Expected result:

```json
{"ok":true}
```

The actual response also includes FFmpeg, FFprobe, and work directory paths.

## 4. Use VidPocket

1. Open a webpage with directly accessible media.
2. If the page only loads the stream after playback starts, click play first.
3. Click the VidPocket icon in the Chrome toolbar.
4. Review the detected media list.
5. Click `Download`.

For direct files such as MP4 or WebM, Chrome starts the download immediately.

For HLS `.m3u8`, VidPocket asks the local helper to generate an MP4 first. The popup shows progress and speed. When the MP4 is ready, Chrome receives a normal download task.

## 5. Update After Editing

After changing extension files:

1. Open `chrome://extensions`.
2. Find VidPocket.
3. Click the reload button on the extension card.

After changing helper files:

```sh
./helper/install-helper.command
```

## 6. Troubleshooting

### Chrome says the extension file cannot be found

This usually means the project folder was moved after loading it as an unpacked extension.

Fix:

1. Open `chrome://extensions`.
2. Remove the broken VidPocket entry.
3. Click `Load unpacked`.
4. Select the current project folder again.

### HLS download does not start

Check the helper:

```sh
curl http://127.0.0.1:17384/health
```

If it fails, reinstall the helper:

```sh
./helper/install-helper.command
```

### No media is detected

Try this:

1. Refresh the webpage.
2. Start playing the video.
3. Open the VidPocket popup again.

Some pages do not expose media URLs until playback starts.

### Downloaded video has no audio

Some websites expose video-only HLS playlists separately from audio playlists. VidPocket tries to find and merge matching audio renditions. If it cannot find one, it may still generate a silent MP4 and show a warning.

### Protected or encrypted video is not downloadable

This is expected. VidPocket does not bypass DRM, encryption, login restrictions, platform protections, or YouTube-style protected streams.

## 7. Run Tests

```sh
npm test
```
