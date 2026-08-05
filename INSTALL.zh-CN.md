# VidPocket 安装说明

## Chrome 应用商店安装

1. 打开 [VidPocket Chrome 应用商店页面](https://chromewebstore.google.com/detail/vidpocket/jpafnjdkpppdlnhhfnhaafabgkpfoaii)。
2. 点击“添加至 Chrome”。
3. 如果图标被隐藏，请打开 Chrome 的“扩展程序”菜单并固定 VidPocket。
4. 打开包含媒体的网页，然后点击工具栏中的 VidPocket 图标。

不需要原生应用、本地助手、系统 FFmpeg、账户或额外配置。直接文件通过 Chrome 下载；受支持的未加密 HLS 使用扩展安装包内的组件处理。

## 开发者模式加载

```sh
npm ci
npm test
```

然后：

1. 打开 `chrome://extensions`。
2. 启用“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择包含 `manifest.json` 的仓库根目录。

修改扩展文件后，请在 `chrome://extensions` 的 VidPocket 卡片上点击“重新加载”，并刷新测试网页。

## 生成商店 ZIP

```sh
npm run package:store
unzip -t dist/vidpocket-0.5.1.zip
```

上传 `dist/vidpocket-0.5.1.zip`。不要再次压缩外层目录，`manifest.json` 必须位于 ZIP 根目录。

## 常见问题

### 看不到工具栏图标

打开 Chrome 的“扩展程序”菜单，并固定 VidPocket。

### 没有识别到媒体

- 确认当前标签页是普通 `http://` 或 `https://` 网页；Chrome 内部页面不能扫描。
- 如果网站延迟加载媒体，请先播放视频，再在 VidPocket 中点击“刷新”。
- 如果网页在安装或更新扩展之前已经打开，请刷新网页。
- 受保护、加密、DRM、需要登录或无法直接访问的媒体不受支持。

### X 公开帖子没有识别

- 打开单独的公开 `/status/...` 页面，并点击“刷新”。
- 确认帖子仍然公开且可访问。
- 公开元数据兜底不会访问私密或受保护帖子。

### HLS 任务失败

只支持未加密 HLS。部分播放列表使用不受支持的加密、编码、认证、时间轴切换或平台专用播放逻辑。
