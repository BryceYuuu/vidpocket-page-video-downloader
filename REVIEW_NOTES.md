# Chrome Web Store Review Notes

These notes can be pasted into the Chrome Web Store review instructions field.

## English

VidPocket has one purpose: detect media resources exposed by the active webpage and let the user download directly accessible videos or unencrypted HLS streams.

Testing steps:

1. Install the submitted extension package.
2. Open a webpage containing a directly accessible video file, or use the repository fixture `test-fixture.html` when testing from source.
3. Click the VidPocket toolbar icon.
4. Confirm that detected media items appear with format, resolution, source, and preview information when available.
5. Click Download on a direct MP4/WebM media item. Chrome should start a normal browser download.
6. For HLS `.m3u8` testing, install and start the optional local helper from the GitHub repository:

```sh
./helper/install-helper.command
```

The helper listens on:

```text
http://127.0.0.1:17384
```

Then open a page containing an unencrypted HLS stream and click Download. The helper converts the stream locally with FFmpeg and returns an MP4 for Chrome to download.

Important behavior:

- The extension does not bypass DRM.
- The extension does not bypass paywalls, login restrictions, access controls, or platform protections.
- The extension does not execute remote hosted code.
- The extension has no analytics, telemetry, advertising SDK, or hosted backend.
- HLS conversion requires the optional local helper and FFmpeg.

## 中文

VidPocket 的单一用途是：识别当前网页中暴露的媒体资源，并让用户下载可直接访问的视频或未加密 HLS 流。

测试步骤：

1. 安装提交的扩展包。
2. 打开包含可直接访问视频文件的网页；如果从源码测试，也可以使用仓库中的 `test-fixture.html`。
3. 点击 Chrome 工具栏中的 VidPocket 图标。
4. 确认弹窗中显示检测到的媒体资源，并在可获取时显示格式、分辨率、来源和预览信息。
5. 对直接 MP4/WebM 媒体点击下载，Chrome 应启动正常浏览器下载。
6. 测试 HLS `.m3u8` 时，需要从 GitHub 仓库安装并启动可选本地助手：

```sh
./helper/install-helper.command
```

本地助手监听：

```text
http://127.0.0.1:17384
```

然后打开包含未加密 HLS 流的页面并点击下载。本地助手会使用 FFmpeg 在本机转换为 MP4，再交给 Chrome 下载。

重要行为说明：

- 扩展不绕过 DRM。
- 扩展不绕过付费墙、登录限制、访问控制或平台保护。
- 扩展不执行远程托管代码。
- 扩展没有统计分析、遥测、广告 SDK 或托管后端。
- HLS 转换需要可选本地助手和 FFmpeg。
