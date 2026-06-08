# 安装和使用说明

这份文档说明如何从源码安装和使用 VidPocket（视频口袋），一个面向可直接访问媒体和未加密 HLS 流的 Chrome 网页视频下载工具。

## 1. 环境要求

- Google Chrome 或 Chromium 系浏览器
- macOS
- Node.js 18 或更新版本
- FFmpeg 和 FFprobe

使用 Homebrew 安装 FFmpeg：

```sh
brew install ffmpeg
```

确认 Node.js 和 FFmpeg 可用：

```sh
node --version
ffmpeg -version
ffprobe -version
```

## 2. 安装 Chrome 扩展

1. 下载或 clone 本仓库。
2. 打开 Chrome，进入：

```text
chrome://extensions
```

3. 打开右上角 `Developer mode`。
4. 点击 `Load unpacked`。
5. 选择 VidPocket 项目文件夹。

完成后，Chrome 扩展列表里应该能看到 VidPocket。

## 3. 安装本地 Helper

本地 helper 用于处理未加密 HLS `.m3u8` 下载和封面抽帧。

在项目文件夹中运行：

```sh
./helper/install-helper.command
```

helper 会在本机运行：

```text
http://127.0.0.1:17384
```

检查 helper 是否正常：

```sh
curl http://127.0.0.1:17384/health
```

正常情况下会返回：

```json
{"ok":true}
```

实际返回内容还会包含 FFmpeg、FFprobe 和工作目录路径。

## 4. 使用 VidPocket

1. 打开包含可直接访问媒体资源的网页。
2. 如果页面需要播放后才加载真实视频流，先点击播放。
3. 点击 Chrome 工具栏里的 VidPocket 图标。
4. 查看识别出的媒体列表。
5. 点击 `Download`。

如果是 MP4、WebM 等直链文件，Chrome 会直接开始下载。

如果是 HLS `.m3u8`，VidPocket 会先让本地 helper 生成 MP4。弹窗会显示进度和速度。MP4 准备好后，Chrome 会收到一个正常下载任务。

## 5. 修改后如何更新

修改扩展文件后：

1. 打开 `chrome://extensions`。
2. 找到 VidPocket。
3. 点击扩展卡片上的刷新按钮。

修改 helper 文件后：

```sh
./helper/install-helper.command
```

## 6. 常见问题

### Chrome 提示无法访问扩展文件

通常是因为你加载扩展后移动了项目文件夹，Chrome 还记着旧路径。

解决方法：

1. 打开 `chrome://extensions`。
2. 删除坏掉的 VidPocket 扩展项。
3. 点击 `Load unpacked`。
4. 重新选择当前项目文件夹。

### HLS 下载没有开始

先检查 helper：

```sh
curl http://127.0.0.1:17384/health
```

如果失败，重新安装 helper：

```sh
./helper/install-helper.command
```

### 没有识别到视频

可以尝试：

1. 刷新网页。
2. 先播放视频。
3. 再打开 VidPocket 弹窗。

有些网页只有在开始播放后才会暴露真实媒体地址。

### 下载出来的视频没有声音

有些网站会把 HLS 视频轨和音频轨分开暴露。VidPocket 会尽量查找并合并对应的音频流。如果找不到音频轨，可能会先生成无声 MP4，并在弹窗中显示提示。

### 受保护或加密视频无法下载

这是预期行为。VidPocket 不绕过 DRM、加密、登录限制、平台保护，也不处理 YouTube 这类受保护媒体流。

## 7. 运行测试

```sh
npm test
```
