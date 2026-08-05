# VidPocket Installation

## Chrome Web Store

1. Open the [VidPocket Chrome Web Store page](https://chromewebstore.google.com/detail/vidpocket/jpafnjdkpppdlnhhfnhaafabgkpfoaii).
2. Click **Add to Chrome**.
3. Open Chrome's Extensions menu and pin VidPocket if the icon is hidden.
4. Open a webpage with media, then click the VidPocket toolbar icon.

No native application, local helper, system FFmpeg, account, or extra configuration is required. Direct files use Chrome downloads. Supported unencrypted HLS work runs with components packaged inside the extension.

## Load Unpacked For Development

```sh
npm ci
npm test
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the repository root containing `manifest.json`.

After changing extension files, click Reload on the VidPocket card in `chrome://extensions` and refresh the webpage being tested.

## Create The Store ZIP

```sh
npm run package:store
unzip -t dist/vidpocket-0.5.1.zip
```

Upload `dist/vidpocket-0.5.1.zip`. Do not zip its containing folder again; `manifest.json` must be at the archive root.

## Troubleshooting

### Toolbar icon is hidden

Open Chrome's Extensions menu and pin VidPocket.

### No media is found

- Confirm the active tab is a normal `http://` or `https://` webpage. Chrome internal pages cannot be scanned.
- Play the page video first if it loads lazily, then click Refresh in VidPocket.
- Refresh pages that were open while the extension was being installed or updated.
- Protected, encrypted, DRM, login-restricted, or inaccessible media is intentionally unsupported.

### X public post is not detected

- Open the individual public `/status/...` page and click Refresh.
- Confirm the post is public and still available.
- Private or protected posts are not accessed by the public metadata fallback.

### An HLS job fails

Only unencrypted HLS is supported. Some playlists use unsupported encryption, codecs, authentication, discontinuities, or platform-specific playback logic.
