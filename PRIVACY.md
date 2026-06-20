# VidPocket Privacy Policy

Last updated: 2026-06-20

VidPocket is a local-first Chrome extension for detecting and downloading directly accessible webpage media. It does not run analytics, does not use a hosted backend, and does not sell or share user data.

## Data VidPocket Processes

VidPocket may process the following information locally in your browser or on your computer:

- The URL and title of the active webpage.
- Media URLs exposed by the webpage or by Chrome network events.
- Media metadata such as file type, duration, resolution, content length, and source host.
- Thumbnail data generated from media already visible to the page.
- Download job status and progress.

This information is used only to show downloadable media in the extension popup and to start downloads requested by the user.

## Local Helper

For unencrypted HLS streams, VidPocket can use an optional local helper running at `http://127.0.0.1:17384`. The helper uses local tooling such as FFmpeg to convert accessible HLS streams into MP4 files on the user's computer.

The helper does not send media URLs or files to a VidPocket server. Temporary output is stored locally, usually under:

```text
~/Library/Application Support/VidPocket
```

## Data Sharing

VidPocket does not:

- Sell user data.
- Transfer user data to third-party advertising services.
- Use analytics or tracking pixels.
- Upload browsing history or media files to a hosted VidPocket service.

## Remote Code

VidPocket does not execute remotely hosted code. Extension scripts are included in the extension package.

## Permissions

VidPocket requests the minimum permissions needed for its single purpose:

- `downloads`: start downloads selected by the user.
- `tabs`: identify the active tab and connect detected media to the current page.
- `webRequest`: detect media resources exposed by webpage network responses.
- `http://*/*` and `https://*/*`: inspect media resources on webpages the user visits.

## User Control

Users can remove detected items from the popup, clear the current tab's detected media list, stop using the local helper, or uninstall the extension at any time.

## Limitations

VidPocket does not bypass DRM, paywalls, login restrictions, access controls, or platform protections. Users are responsible for saving media only when they have the right to do so.

## Contact

For issues or privacy questions, use the GitHub repository:

https://github.com/BryceYuuu/vidpocket-page-video-downloader

---

# VidPocket 隐私政策

最后更新：2026-06-20

VidPocket（视频口袋）是一个本地优先的 Chrome 扩展，用来识别和下载网页中可直接访问的媒体资源。它不包含统计分析、不使用托管后端，也不会出售或共享用户数据。

## VidPocket 会处理哪些数据

VidPocket 可能会在你的浏览器或电脑本地处理以下信息：

- 当前网页的 URL 和标题。
- 网页或 Chrome 网络事件中暴露的媒体 URL。
- 媒体类型、时长、分辨率、内容长度、来源域名等元数据。
- 从页面中已可见媒体生成的预览图数据。
- 下载任务状态和进度。

这些信息只用于在扩展弹窗中展示可下载媒体，并在用户点击下载时启动下载任务。

## 本地助手

对于未加密 HLS 流，VidPocket 可以使用运行在 `http://127.0.0.1:17384` 的可选本地助手。该助手使用 FFmpeg 等本地工具，把可访问的 HLS 流转换为 MP4 文件。

本地助手不会把媒体 URL 或文件上传到 VidPocket 服务器。临时输出通常保存在：

```text
~/Library/Application Support/VidPocket
```

## 数据共享

VidPocket 不会：

- 出售用户数据。
- 将用户数据传给第三方广告服务。
- 使用分析统计或追踪像素。
- 上传浏览历史或媒体文件到 VidPocket 托管服务。

## 远程代码

VidPocket 不执行远程托管代码。扩展脚本包含在扩展安装包内。

## 权限说明

VidPocket 只请求实现单一用途所需的权限：

- `downloads`：下载用户选择保存的媒体文件。
- `tabs`：识别当前标签页，并把检测到的媒体与当前页面关联。
- `webRequest`：识别网页网络响应中暴露的媒体资源。
- `http://*/*` 和 `https://*/*`：在用户访问的网页中检测媒体资源。

## 用户控制

用户可以从弹窗中移除检测项、清空当前标签页的媒体列表、停止使用本地助手，或随时卸载扩展。

## 限制

VidPocket 不绕过 DRM、付费墙、登录限制、访问控制或平台保护。用户应只在自己有权保存媒体时使用本工具。

## 联系方式

问题反馈或隐私相关问题请使用 GitHub 仓库：

https://github.com/BryceYuuu/vidpocket-page-video-downloader
