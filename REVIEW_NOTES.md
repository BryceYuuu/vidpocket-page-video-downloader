# Chrome Web Store Review Notes

## English

VidPocket has one purpose: detect media resources exposed by the active webpage and let the user save directly accessible media, including direct MP4/WebM files and unencrypted HLS streams.

### Primary test: public X video

1. Install the submitted package in a clean Chrome profile. No native app, local helper, FFmpeg installation, account, or configuration is required.
2. Open `https://x.com/MiniMax_AI/status/2084106804032872591`.
3. Click the VidPocket toolbar icon. The UI must open as Chrome's normal toolbar popup, not as a separate manager page.
4. The popup should show multiple public MP4 renditions and an HLS option with the matching X preview image, approximately 0:41 duration, and available resolutions.
5. Click Download on an MP4 rendition. Chrome should save a normal playable MP4 through its downloads API.

The X player currently exposes only a temporary `blob:` URL to the DOM. VidPocket therefore uses two packaged detection paths: an early page response parser and a bounded fallback that sends the visible public post ID directly to X's public `cdn.syndication.twimg.com` metadata endpoint. The fallback accepts media only from `video.twimg.com` and previews only from `pbs.twimg.com`. No request goes through a VidPocket server.

### Generic direct-media test

1. Open a webpage containing an accessible MP4 or WebM file.
2. Play the video if the page loads it lazily.
3. Open the VidPocket toolbar popup and click Refresh if needed.
4. Confirm the item shows available title, preview, duration, format, resolution, and source details.
5. Click Download and confirm Chrome starts the download.

### Important implementation notes

- The toolbar action uses `popup.html`; it does not open a standalone webpage or window.
- Direct files use Chrome's native download path for normal browser download performance.
- Unencrypted HLS jobs run in the packaged `offscreen.html` document using packaged mux.js and FFmpeg WebAssembly. No system FFmpeg or local helper is required.
- `chrome.storage.local` stores job status so user-initiated work can continue when Chrome closes the short-lived toolbar popup.
- All JavaScript and WebAssembly are packaged. VidPocket does not execute remote code.
- VidPocket has no analytics, advertising, telemetry, account service, or hosted backend.
- VidPocket does not bypass DRM, encryption, paywalls, login restrictions, access controls, or platform protections.

## 中文

VidPocket 的单一用途是：识别当前网页中暴露的媒体资源，并让用户保存可直接访问的媒体，包括直接 MP4/WebM 文件和未加密 HLS 流。

### 主要测试：X 公开视频

1. 在全新 Chrome 配置中安装提交包。不需要原生应用、本地助手、系统 FFmpeg、账户或额外配置。
2. 打开 `https://x.com/MiniMax_AI/status/2084106804032872591`。
3. 点击 Chrome 工具栏中的 VidPocket 图标。界面必须是标准插件弹窗，不是单独管理网页。
4. 弹窗应显示多个公开 MP4 清晰度和一个 HLS 选项，并包含匹配的 X 预览图、约 0:41 时长和可用分辨率。
5. 点击某个 MP4 的“下载”，Chrome 应通过下载 API 保存正常可播放的 MP4。

当前 X 播放器在 DOM 中只暴露临时 `blob:` 地址。因此 VidPocket 使用两条安装包内检测路径：页面响应早期解析，以及有数量限制的公开元数据兜底。兜底会把可见公开帖子的数字 ID 直接发送到 X 的 `cdn.syndication.twimg.com` 公开接口，只接受 `video.twimg.com` 媒体和 `pbs.twimg.com` 预览图。请求不经过 VidPocket 服务器。

### 普通直接媒体测试

1. 打开包含可访问 MP4 或 WebM 文件的网页。
2. 如果网页延迟加载媒体，请先播放视频。
3. 打开 VidPocket 工具栏弹窗，必要时点击“刷新”。
4. 确认条目显示可用的标题、预览、时长、格式、分辨率和来源。
5. 点击“下载”，确认 Chrome 启动下载。

### 重要实现说明

- 工具栏入口使用 `popup.html`，不会打开单独网页或窗口。
- 直接文件走 Chrome 原生下载路径，保持正常浏览器下载速度。
- 未加密 HLS 任务在安装包内的 `offscreen.html` 中运行，使用随包提交的 mux.js 和 FFmpeg WebAssembly，不需要系统 FFmpeg 或本地助手。
- `chrome.storage.local` 保存任务状态，使用户发起的任务在短暂弹窗关闭后仍能继续。
- 所有 JavaScript 和 WebAssembly 都随安装包提交，不执行远程代码。
- VidPocket 不包含分析、广告、遥测、账户服务或托管后端。
- VidPocket 不绕过 DRM、加密、付费墙、登录限制、访问控制或平台保护。
