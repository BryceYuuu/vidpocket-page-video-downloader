# VidPocket Privacy Policy

Last updated: 2026-08-05

VidPocket is a local-first Chrome extension for detecting and downloading directly accessible webpage media. VidPocket has no analytics, advertising SDK, telemetry service, account system, or hosted backend. VidPocket does not sell user data.

## Data Processed

To provide its single purpose, VidPocket may process:

- The active tab URL and page title.
- Public media URLs exposed by the webpage or Chrome network events.
- Media metadata such as format, duration, resolution, content length, and source host.
- Preview images exposed by the page or generated from accessible media.
- User-initiated download filenames, status, progress, and speed.

This information is used only to identify media, render the toolbar popup, and complete downloads requested by the user.

## Public X Posts

On X or Twitter pages, VidPocket first reads public media information already available to the page. If a public post exposes only a temporary `blob:` player URL, VidPocket may send the numeric IDs of the current or visible public posts to X's public embed metadata endpoint at `cdn.syndication.twimg.com`. The response is filtered to HTTPS media hosted by `video.twimg.com` and preview images hosted by `pbs.twimg.com`.

This request goes directly from the browser to X. It is not sent through a VidPocket server. VidPocket does not use this fallback for private, protected, login-restricted, or DRM-protected media.

## Local Media Processing

Direct media files are saved through Chrome's downloads API. Unencrypted HLS processing and thumbnail generation run in a packaged offscreen extension document using code included with VidPocket. Media is fetched from its source host and processed locally in the browser. VidPocket does not require or contact a local helper service.

## Local Storage

VidPocket may store download job state in `chrome.storage.local` so a user-initiated task can continue when the toolbar popup closes. This can include a media URL, filename, progress, status, byte counts, and timestamps. The data remains in the extension's local browser storage and is not uploaded to VidPocket.

## Data Sharing

VidPocket does not:

- Sell user data.
- Send data to advertising or analytics services.
- Upload browsing history, media files, or download records to a VidPocket backend.
- Use processed data for creditworthiness, lending, profiling, or unrelated purposes.

Media hosts and X receive normal browser requests required to retrieve the public resources described above.

## Permissions

- `downloads`: saves media only after the user clicks Download and tracks that download's status.
- `tabs`: identifies the active tab, requests a scan, and associates results with that tab.
- `scripting`: starts or restores the packaged scanner on the active webpage after the user opens VidPocket.
- `webRequest`: observes media resources exposed by webpage network responses.
- `offscreen`: runs packaged, user-initiated unencrypted HLS processing and thumbnail work outside the short-lived popup.
- `storage`: retains local download job state and progress while the popup is closed.
- `http://*/*` and `https://*/*`: detects and retrieves accessible media from webpages the user visits.

## Remote Code

VidPocket does not execute remotely hosted code. JavaScript, WebAssembly, and media-processing libraries used by the extension are included in the submitted extension package. Remote JSON, playlists, images, and media files are treated as data, not executable code.

## User Control And Limitations

Users can remove individual results, clear a tab's detected-media list, cancel supported active jobs, or uninstall VidPocket. VidPocket does not bypass DRM, paywalls, login restrictions, access controls, encryption, or platform protections. Users are responsible for saving media only when they have the right to do so.

## Contact

Issues and privacy questions:

https://github.com/BryceYuuu/vidpocket-page-video-downloader/issues

---

# VidPocket 隐私政策

最后更新：2026-08-05

VidPocket（视频口袋）是一款本地优先的 Chrome 扩展，用于识别和下载网页中可直接访问的媒体。VidPocket 不包含统计分析、广告 SDK、遥测服务、账户系统或托管后端，也不会出售用户数据。

## 处理的数据

为了实现单一用途，VidPocket 可能处理：

- 当前标签页 URL 和页面标题。
- 网页或 Chrome 网络事件中暴露的公开媒体 URL。
- 格式、时长、分辨率、内容长度、来源域名等媒体元数据。
- 页面提供的预览图，或从可访问媒体中生成的预览图。
- 用户主动创建的下载任务文件名、状态、进度和速度。

这些信息只用于识别媒体、显示右上角插件弹窗，以及完成用户主动请求的下载。

## X 公开帖子

在 X 或 Twitter 页面中，VidPocket 会优先读取网页已经可以访问的公开媒体信息。如果公开帖子只暴露临时 `blob:` 播放地址，VidPocket 可能把当前页面或可见公开帖子的数字 ID 直接发送到 X 的公开嵌入元数据接口 `cdn.syndication.twimg.com`。返回结果只接受 `video.twimg.com` 的 HTTPS 媒体地址和 `pbs.twimg.com` 的预览图。

该请求由浏览器直接发送给 X，不经过 VidPocket 服务器。VidPocket 不会使用此方式访问私密、受保护、需要登录或受 DRM 保护的媒体。

## 本地媒体处理

直接媒体文件通过 Chrome 下载 API 保存。未加密 HLS 处理和预览图生成在扩展安装包内的 offscreen 文档中运行，使用的代码全部随 VidPocket 提交。媒体从原始来源域名获取，并在浏览器本地处理。VidPocket 不需要也不会连接本地助手服务。

## 本地存储

VidPocket 可能使用 `chrome.storage.local` 保存下载任务状态，使用户主动发起的任务在插件弹窗关闭后仍可继续。内容可能包括媒体 URL、文件名、进度、状态、字节数和时间戳。这些数据保留在扩展的浏览器本地存储中，不会上传给 VidPocket。

## 数据共享

VidPocket 不会：

- 出售用户数据。
- 把数据发送给广告或分析服务。
- 把浏览历史、媒体文件或下载记录上传到 VidPocket 后端。
- 将处理的数据用于征信、贷款、用户画像或无关用途。

为了获取上述公开资源，媒体来源网站和 X 会收到正常的浏览器网络请求。

## 权限说明

- `downloads`：仅在用户点击“下载”后保存媒体，并跟踪对应下载状态。
- `tabs`：识别当前标签页、请求扫描，并把结果与该标签页关联。
- `scripting`：用户打开 VidPocket 后，在当前网页启动或恢复安装包内的检测脚本。
- `webRequest`：观察网页网络响应中暴露的媒体资源。
- `offscreen`：在短暂的插件弹窗之外，执行安装包内、由用户发起的未加密 HLS 处理和预览图任务。
- `storage`：在弹窗关闭时保留本地下载任务状态和进度。
- `http://*/*` 和 `https://*/*`：在用户访问的网页中识别和获取可访问媒体。

## 远程代码

VidPocket 不执行远程托管代码。扩展使用的 JavaScript、WebAssembly 和媒体处理库都包含在提交的安装包中。远程 JSON、播放列表、图片和媒体文件只作为数据处理，不作为可执行代码运行。

## 用户控制与限制

用户可以移除单个结果、清空当前标签页的识别列表、取消受支持的活动任务，或卸载 VidPocket。VidPocket 不绕过 DRM、付费墙、登录限制、访问控制、加密或平台保护。用户应只保存自己有权保存的媒体。

## 联系方式

问题反馈和隐私咨询：

https://github.com/BryceYuuu/vidpocket-page-video-downloader/issues
