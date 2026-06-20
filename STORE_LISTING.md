# Chrome Web Store Listing Copy

Use this file as the source text for the Chrome Web Store Developer Dashboard.

## Basic Information

- Extension name: VidPocket
- Chinese name: 视频口袋
- Suggested category: Productivity
- Primary language: English
- Localized language: Chinese (Simplified)
- Homepage URL: https://github.com/BryceYuuu/vidpocket-page-video-downloader
- Support URL: https://github.com/BryceYuuu/vidpocket-page-video-downloader/issues
- Privacy policy URL: https://github.com/BryceYuuu/vidpocket-page-video-downloader/blob/main/PRIVACY.md

## English Short Description

Detect and save directly accessible webpage videos, including unencrypted HLS streams with a local helper.

## English Detailed Description

VidPocket is a local-first webpage video downloader for Chrome. It helps you spot media resources exposed by the current page, review useful details, and save videos that your browser can already access.

What VidPocket does:

- Detects video and media resources from the active webpage.
- Shows previews, duration, resolution, format, and source information when available.
- Downloads directly accessible MP4/WebM/media files through Chrome.
- Saves unencrypted HLS `.m3u8` streams as MP4 when the optional local helper is running.
- Keeps processing local: no analytics, no hosted backend, no remote telemetry.

VidPocket is designed for normal webpage media workflows: collecting clips from pages you own, saving public media you are allowed to keep, or inspecting media resources during research and development.

Important limitations:

- VidPocket does not bypass DRM, paywalls, login restrictions, access controls, or platform protections.
- VidPocket does not claim support for YouTube protected video downloads.
- HLS-to-MP4 conversion requires the optional local helper and FFmpeg.
- Some websites intentionally hide, encrypt, split, or protect media streams; those resources may not be downloadable.

Use VidPocket only when you have the right to save the media.

## English Feature Bullets

- Webpage video detector
- Direct media downloads
- HLS `.m3u8` to MP4 with local FFmpeg helper
- Preview thumbnails and media details
- Local-first privacy model
- Open-source project

## English Permission Justifications

Single purpose:

VidPocket detects media resources exposed by the current webpage and lets the user download directly accessible videos or unencrypted HLS streams.

`downloads`:

Used to start Chrome downloads after the user clicks the Download button.

`tabs`:

Used to identify the active tab, request a page scan, and associate detected media with the current webpage.

`webRequest`:

Used to detect media resources exposed in webpage network responses, such as video files and HLS playlists.

Host permissions `http://*/*` and `https://*/*`:

Used to scan webpages the user visits for media resources. VidPocket does not upload this browsing data to a remote server.

Remote code declaration:

No. VidPocket does not execute remotely hosted code.

Data usage statement:

VidPocket processes active-page URLs, page titles, media URLs, media metadata, thumbnails, and download progress locally for the purpose of displaying and downloading media selected by the user. It does not sell, share, or transfer user data to advertising services or a hosted backend.

## 中文简短描述

识别并保存网页中可直接访问的视频；未加密 HLS 可通过本地助手转为 MP4。

## 中文详细描述

VidPocket（视频口袋）是一个本地优先的 Chrome 网页视频下载工具。它可以帮助你识别当前网页中暴露的媒体资源，查看预览、时长、清晰度、格式和来源信息，并保存浏览器本身已经可以访问的视频。

VidPocket 可以做什么：

- 识别当前网页中的视频和媒体资源。
- 在可获取时显示预览图、时长、分辨率、格式和来源。
- 通过 Chrome 下载可直接访问的 MP4、WebM 或其他媒体文件。
- 在本地助手运行时，把未加密 HLS `.m3u8` 流保存为 MP4。
- 本地优先处理：没有统计分析、没有托管后端、没有远程遥测。

VidPocket 适合普通网页媒体场景：保存你自己网页中的素材、保存你有权保存的公开视频，或在研发、调试、研究时检查页面媒体资源。

重要限制：

- VidPocket 不绕过 DRM、付费墙、登录限制、访问控制或平台保护。
- VidPocket 不宣称支持下载 YouTube 受保护视频。
- HLS 转 MP4 需要可选本地助手和 FFmpeg。
- 有些网站会隐藏、加密、拆分或保护媒体流，这些资源可能无法下载。

请只在你拥有保存权限的情况下使用 VidPocket。

## 中文功能要点

- 网页视频识别
- 直接媒体下载
- HLS `.m3u8` 本地转 MP4
- 预览图和媒体详情
- 本地优先隐私模式
- 开源项目

## 中文权限说明

单一用途：

VidPocket 用来识别当前网页中暴露的媒体资源，并让用户下载可直接访问的视频或未加密 HLS 流。

`downloads`：

用户点击“下载”后，用于启动 Chrome 下载任务。

`tabs`：

用于识别当前标签页、请求页面扫描，并把检测到的媒体资源与当前网页关联。

`webRequest`：

用于识别网页网络响应中暴露的视频文件、HLS 播放列表等媒体资源。

主机权限 `http://*/*` 和 `https://*/*`：

用于在用户访问的网页中扫描媒体资源。VidPocket 不会把浏览数据上传到远程服务器。

远程代码声明：

否。VidPocket 不执行远程托管代码。

数据使用声明：

VidPocket 会在本地处理当前页面 URL、页面标题、媒体 URL、媒体元数据、预览图和下载进度，用于展示和下载用户选择的媒体。它不会出售、共享用户数据，也不会把数据传给广告服务或托管后端。

## Search Keywords To Use Naturally

Do not paste keyword blocks into the public listing as spam. Work these phrases naturally into the description, README, GitHub topics, and support docs:

- webpage video downloader
- Chrome video downloader
- HLS downloader
- m3u8 downloader
- media detector
- save webpage video
- 网页视频下载
- 页面视频下载
- HLS 下载
- m3u8 下载
- 视频下载插件
