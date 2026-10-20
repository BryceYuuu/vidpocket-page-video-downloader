# VidPocket 视频口袋

**VidPocket-网页视频下载** 是一款本地优先的 Chrome 扩展，用于识别、预览和保存网页中可直接访问的媒体。

[English](README.md) | [Chrome 应用商店](https://chromewebstore.google.com/detail/vidpocket/jpafnjdkpppdlnhhfnhaafabgkpfoaii) | [隐私政策](PRIVACY.md)

## 最新版本

**当前稳定版本：[v0.5.2](https://github.com/BryceYuuu/vidpocket-page-video-downloader/releases/tag/v0.5.2)**

- **推荐安装位置：** [Chrome 应用商店](https://chromewebstore.google.com/detail/vidpocket/jpafnjdkpppdlnhhfnhaafabgkpfoaii)
- **最新安装包与源码：** [GitHub Releases](https://github.com/BryceYuuu/vidpocket-page-video-downloader/releases/latest)
- **完整版本更新记录：** [CHANGELOG.md](CHANGELOG.md)

### v0.5.2 更新内容

- 新增 Threads 视频支持（`threads.com` 和 `threads.net`）：以「作者 · 帖子文字」作为标题，显示真实封面、时长和清晰度，当前帖子的视频排在最前；保存的是带音频的完整 MP4。
- 修复自 0.5.0 起存在的识别问题：网页中只要有 `<video>` 元素，页面视频就可能无法显示在弹窗中。
- 不再把 DASH 分段当作完整视频提供下载，避免保存到无声或不完整的文件。
- 弹窗更快：列表几乎立即出现，封面图约小 8 倍，下载进度刷新时不再重复加载封面，未滚动到的预览延后加载。
- 带独立音轨的 HLS 视频，画面和声音同时下载。
- Chrome 挂起扩展后台进程后，已识别的列表不会丢失。

## 功能

- 点击 Chrome 右上角图标，打开当前网页对应的标准插件弹窗。
- 识别可访问的直接 MP4、WebM、音频和其他媒体地址。
- 在可获取时显示匹配的预览图、时长、格式、分辨率、来源和易读标题。
- 当 X 播放器只暴露临时 `blob:` 地址时，恢复公开帖子的多个视频清晰度。
- 识别 Threads 视频，显示作者、帖子文字、封面和时长，并保存带音频的完整 MP4。
- 直接文件通过 Chrome 原生下载 API 保存。
- 受支持的未加密 HLS/m3u8 在扩展安装包内处理，并生成 MP4。
- 插件弹窗关闭后，用户主动发起的任务仍可在扩展本地存储中保留进度。
- 不需要本地助手、原生应用或账户，不包含分析服务，也没有 VidPocket 托管后端。

## 安装

### Chrome 应用商店

从 [Chrome 应用商店安装 VidPocket](https://chromewebstore.google.com/detail/vidpocket/jpafnjdkpppdlnhhfnhaafabgkpfoaii)。如果工具栏没有显示图标，请从 Chrome 的“扩展程序”菜单中固定 VidPocket。

### 从源码加载

1. 从 [GitHub Releases](https://github.com/BryceYuuu/vidpocket-page-video-downloader/releases/latest) 下载当前安装包并解压，或者克隆本仓库。
2. 打开 `chrome://extensions`。
3. 启用“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择包含 `manifest.json` 的解压目录，或者选择仓库根目录。

只有开发、测试或重新构建商店安装包时才需要运行 `npm ci`；使用已经打包的扩展不需要安装 Node.js。

## 使用方法

1. 打开包含你有权保存媒体的网页。
2. 如果网站需要播放后才加载真实媒体，请先播放视频。
3. 点击 Chrome 工具栏中的 VidPocket 图标。
4. 查看匹配的预览图、时长、清晰度、格式和来源。
5. 对需要的版本点击“下载”。

直接文件使用 Chrome 正常下载系统。受支持的未加密 HLS 任务会在安装包内的 offscreen 扩展文档中运行，并在本地生成 MP4。

## X 公开视频识别

新版 X 页面经常只向 DOM 暴露 `blob:` 播放地址。VidPocket 使用安装包内的页面响应检测脚本，并为可见公开帖子 ID 提供有数量限制的公开元数据兜底。兜底请求会由浏览器直接发送到 X 的 `cdn.syndication.twimg.com`，只接受 `video.twimg.com` 媒体和 `pbs.twimg.com` 预览图。

VidPocket 不绕过私密、受保护、需要登录、加密或 DRM 保护的媒体。

## Threads 视频识别

Threads 大多通过 `blob:` 播放器播放视频，仅靠 `<video>` 元素无法拿到下载地址。在 `threads.com` 和 `threads.net` 上，VidPocket 使用安装包内的页面脚本，读取 Threads 已经发送给网页的帖子数据（内嵌 JSON 和 GraphQL 响应），为每个视频选择带音频的完整 MP4 版本。只接受 Meta CDN（`cdninstagram.com` / `fbcdn.net`）上的 HTTPS 媒体和封面图，并忽略 DASH 分段请求。不会额外向 Threads 或其他服务器发送请求。

## 限制

VidPocket 不保证支持所有网站，也不绕过 DRM、加密、付费墙、登录限制、访问控制或平台保护。不支持下载 YouTube 受保护视频。是否可用取决于网页和媒体来源是否提供可直接访问的资源。

请只下载你拥有或获准保存的媒体。

## 隐私

VidPocket 不包含分析统计、广告 SDK、账户系统、遥测服务或托管后端。识别、预览、任务状态和受支持的 HLS 处理都保留在浏览器本地；唯一例外是向原始媒体来源或 X 发出的正常资源请求，详见 [隐私政策](PRIVACY.md)。

## 开发与测试

需要 Node.js 18 或更高版本。

```sh
npm ci
npm test
npm run package:store
```

可选发布验证：

```sh
npm run test:slow
npm run test:x-live
VIDPOCKET_CHROME_BINARY="/path/to/Chrome for Testing" npm run test:chrome-live
VIDPOCKET_CHROME_BINARY="/path/to/Chrome for Testing" npm run test:threads-live
```

Chrome 商店 ZIP 会生成在 `dist/`，且 `manifest.json` 位于压缩包根目录。

## 许可证

项目使用 [MIT](LICENSE) 许可证。第三方组件保留各自许可证，详见 `vendor/THIRD_PARTY_NOTICES.txt`。
