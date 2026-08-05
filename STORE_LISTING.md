# Chrome Web Store Listing Copy

## Basic Information

- Extension name: `VidPocket-网页视频下载`
- Chinese name: `视频口袋`
- Category: `Tools`
- Homepage: https://github.com/BryceYuuu/vidpocket-page-video-downloader
- Support: https://github.com/BryceYuuu/vidpocket-page-video-downloader/issues
- Privacy policy: https://github.com/BryceYuuu/vidpocket-page-video-downloader/blob/main/PRIVACY.md

## English Short Description

Detect, preview, and download accessible webpage videos, direct MP4/WebM files, and unencrypted HLS streams.

## English Detailed Description

VidPocket-网页视频下载 is a local-first webpage video downloader and Chrome video downloader. Open the toolbar popup on the current page to detect accessible media, compare matching previews and quality details, and save the version you need.

Key features:

- Detect accessible webpage video and media resources from the active tab.
- Show matching preview thumbnails, duration, format, resolution, source, and useful titles when available.
- Detect public X video renditions on supported posts, including direct MP4 quality options.
- Download direct MP4, WebM, and other accessible media through Chrome's native download system.
- Process supported unencrypted HLS/m3u8 streams locally into MP4 with packaged browser components.
- Keep user-initiated download progress available after the short-lived toolbar popup closes.
- Run without a local helper, native application, account, analytics, or hosted VidPocket backend.

How to use:

1. Open a webpage containing a video you are allowed to save.
2. Play the video first if the website loads media only after playback begins.
3. Click the VidPocket icon in Chrome's toolbar. If it is hidden, open it from Chrome's Extensions menu.
4. Review the preview, duration, format, resolution, and source.
5. Click Download on the desired version.

Privacy and limitations:

- Media detection and supported HLS processing are performed locally in the browser.
- Public X post metadata may be requested directly from X when the page exposes only a temporary `blob:` player URL.
- VidPocket does not bypass DRM, encryption, paywalls, login restrictions, access controls, or platform protections.
- YouTube protected downloads are not supported.
- Availability depends on what the webpage and media host make directly accessible.

Use VidPocket only for media you own or have permission to save.

## English Feature Bullets

- Webpage video detector and downloader
- Real preview thumbnails and duration
- Direct MP4/WebM downloads
- Public X video quality detection
- Local unencrypted HLS-to-MP4 processing
- Local-first, no analytics or hosted backend

## 中文简短描述

网页视频下载工具：识别并预览当前页面视频，保存可访问的 MP4/WebM 和未加密 HLS 媒体。

## 中文详细描述

VidPocket-网页视频下载（视频口袋）是一款本地优先的 Chrome 网页视频下载插件。点击浏览器右上角图标，即可在当前页面检测可访问媒体，通过真实预览图、时长和清晰度区分视频，并保存需要的版本。

主要功能：

- 识别当前标签页中可访问的网页视频和媒体资源。
- 在可获取时显示匹配的预览图、时长、格式、分辨率、来源和易读标题。
- 在支持的 X 公开帖子中识别视频，并提供多个直接 MP4 清晰度选项。
- 通过 Chrome 原生下载系统保存可直接访问的 MP4、WebM 和其他媒体文件。
- 使用安装包内的浏览器组件，在本地把受支持的未加密 HLS/m3u8 处理为 MP4。
- 用户发起下载后，即使短暂的工具栏弹窗关闭，也能保留任务状态和进度。
- 不需要本地助手、原生应用或账户，不包含分析统计，也没有 VidPocket 托管后端。

使用方法：

1. 打开包含你有权保存视频的网页。
2. 如果网站需要播放后才加载媒体，请先播放视频。
3. 点击 Chrome 右上角的 VidPocket 图标；如果图标被隐藏，可从“扩展程序”菜单打开。
4. 查看预览图、时长、格式、清晰度和来源。
5. 对需要的版本点击“下载”。

隐私与限制：

- 媒体识别和受支持的 HLS 处理在浏览器本地完成。
- 当 X 页面只暴露临时 `blob:` 播放地址时，扩展可能直接向 X 请求公开帖子媒体元数据。
- VidPocket 不绕过 DRM、加密、付费墙、登录限制、访问控制或平台保护。
- 不支持下载 YouTube 受保护视频。
- 能否下载取决于网页和媒体来源是否提供可直接访问的资源。

请只下载你拥有或获准保存的媒体。

## 中文功能要点

- 网页视频识别和下载
- 真实预览图与视频时长
- 直接 MP4/WebM 下载
- X 公开视频多清晰度识别
- 未加密 HLS 本地转 MP4
- 本地优先，无统计分析和托管后端

## Permission Justifications

### Single purpose

VidPocket detects media resources exposed by the active webpage and lets the user preview and save directly accessible video files or supported unencrypted HLS streams.

### `downloads`

Used only after the user clicks Download to save the selected media through Chrome and monitor that download's progress. VidPocket does not start downloads automatically.

### `tabs`

Used to identify the active tab, request a scan of that page, and associate detected media and download jobs with the correct tab.

### `scripting`

Used after the user opens VidPocket to inject or wake the packaged media scanner on the active webpage, including pages already open before installation. On X pages it can also start the packaged X response hook. VidPocket does not inject third-party or remotely hosted code.

### `webRequest`

Used to detect media resources exposed in webpage network responses, including direct video files and HLS playlists that may not appear as normal page links.

### `offscreen`

Used to run packaged, user-initiated unencrypted HLS downloading, MP4 generation, and thumbnail extraction outside the short-lived toolbar popup. It does not display ads or run unrelated background activity.

### `storage`

Used to keep local download job state, progress, filenames, and byte counts so a user-initiated task can continue after the toolbar popup closes. This data is not uploaded to VidPocket.

### Host permissions `http://*/*` and `https://*/*`

Used to scan webpages the user visits and retrieve media the user selects. On public X posts, VidPocket may request public media metadata directly from X. Browsing data and media are not uploaded to a VidPocket server.

### Remote code declaration

No. VidPocket does not execute remote code. All JavaScript, WebAssembly, mux.js, and FFmpeg components are included in the submitted package. Remote JSON, playlists, images, and media are processed only as data.

## 中文权限说明

### 单一用途

VidPocket 用于识别当前网页中暴露的媒体资源，让用户预览并保存可直接访问的视频文件或受支持的未加密 HLS 流。

### `downloads`

仅在用户点击“下载”后，通过 Chrome 保存所选媒体并跟踪对应下载进度。VidPocket 不会自动开始下载。

### `tabs`

用于识别当前标签页、请求扫描，并把检测到的媒体和下载任务关联到正确标签页。

### `scripting`

用户打开 VidPocket 后，用于在当前网页注入或唤醒安装包内的媒体检测脚本，包括安装前已经打开的网页。在 X 页面中也可启动安装包内的 X 响应检测脚本。VidPocket 不注入第三方或远程托管代码。

### `webRequest`

用于识别网页网络响应中暴露的媒体资源，包括没有作为普通链接出现的直接视频文件和 HLS 播放列表。

### `offscreen`

用于在短暂的工具栏弹窗之外执行安装包内、由用户主动发起的未加密 HLS 下载、MP4 生成和预览图提取，不显示广告，也不执行无关后台活动。

### `storage`

用于在本地保存下载任务状态、进度、文件名和字节数，使用户发起的任务在工具栏弹窗关闭后仍可继续。这些数据不会上传给 VidPocket。

### 主机权限 `http://*/*` 和 `https://*/*`

用于扫描用户访问的网页，并获取用户选择的媒体。在 X 公开帖子中，VidPocket 可能直接向 X 请求公开媒体元数据。浏览数据和媒体不会上传到 VidPocket 服务器。

### 远程代码声明

否。VidPocket 不执行远程代码。所有 JavaScript、WebAssembly、mux.js 和 FFmpeg 组件都包含在提交包中。远程 JSON、播放列表、图片和媒体只作为数据处理。

## Search Phrases

Use these naturally in descriptions and support content rather than as a repeated keyword block:

- webpage video downloader
- Chrome video downloader
- download webpage video
- MP4 downloader
- m3u8 downloader
- HLS downloader
- X video downloader
- 网页视频下载
- 页面视频下载
- 视频下载插件
- Chrome 视频下载
- m3u8 下载
