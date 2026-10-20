# Chrome Web Store Submission Checklist

## Version 0.5.2

- Upload package: `dist/vidpocket-0.5.2.zip`
- Desktop copy: `VidPocket-0.5.2-Chrome商店上传.zip`
- Name: `VidPocket-网页视频下载`
- Category: `Tools`
- Homepage: `https://github.com/BryceYuuu/vidpocket-page-video-downloader`
- Support: `https://github.com/BryceYuuu/vidpocket-page-video-downloader/issues`
- Privacy policy: `https://github.com/BryceYuuu/vidpocket-page-video-downloader/blob/main/PRIVACY.md`

## Before Upload

1. Run `npm test`.
2. Run `npm run test:slow` (packaged FFmpeg WebAssembly check).
3. Run `npm run test:x-live` while the X test post is public.
4. Run `npm run test:threads-live` while the Threads test post is public (needs Chrome for Testing and `ffprobe`).
5. Run `npm run test:chrome-live` with Chrome for Testing when performing a release QA pass.
6. Run `npm run package:store`.
7. Verify the archive with `unzip -t dist/vidpocket-0.5.2.zip`.
8. Confirm `manifest.json` is at the ZIP root.

## Dashboard

1. Upload `dist/vidpocket-0.5.2.zip` or the identical desktop copy.
2. Use `STORE_LISTING.md` for English and Simplified Chinese descriptions.
3. Use `PRIVACY.md` as the public privacy policy.
4. Paste the matching permission justifications from `STORE_LISTING.md`, including `scripting`, `offscreen`, and `storage`.
5. Select **No, I am not using remote code** and use the remote-code explanation from `STORE_LISTING.md`.
6. Paste `REVIEW_NOTES.md` into the reviewer instructions field.
7. Upload the existing store icon, screenshots, and promotional tiles from `store-assets/`.
8. Save the draft, resolve every dashboard warning, and submit for review.

## Policy Wording

Use accurate phrases such as “directly accessible webpage media,” “public X post media,” “Threads post video,” “unencrypted HLS,” and “does not bypass DRM.” Do not claim that VidPocket downloads every video or bypasses protected platforms.
