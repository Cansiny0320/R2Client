# R2Client

[English](#english) · [简体中文](#简体中文)

## 简体中文

R2Client 是面向 Cloudflare R2 的独立开源文件管理器。macOS、Linux 和 Windows 使用 Electron，Web 直接连接 R2。两端采用相同的存储桶侧栏、文件视图、上传和传输工作区。

| 能力                                         | 桌面 | Web                                          |
| -------------------------------------------- | ---- | -------------------------------------------- |
| 多账号和多桶、分页/全桶搜索、缩略图及预览    | ✓    | ✓，使用桶 CORS                               |
| 批量复制、移动、删除、重命名和元数据编辑     | ✓    | ✓                                            |
| 文件、目录、拖放、剪贴板、URL 导入和上传暂存 | ✓    | ✓，URL 来源须允许跨域读取                    |
| 并发分片上传、暂停、失败重试、重启后续传     | ✓    | ✓，刷新后重连并重新选择原文件                |
| 批量下载、整桶/目录增量同步                  | ✓    | 支持目录权限的浏览器；其他浏览器提供下载链接 |
| 存储统计、按需 SHA-256 内容去重              | ✓    | ✓                                            |
| 公开、私有、可选密码链接、二维码             | ✓    | ✓                                            |
| FFmpeg 压缩/转码、关窗后定时同步             | ✓    | —                                            |

### 开发与安装

需要 Node.js 24 和 pnpm。开始时可以用内置演示桶，数据仅在当前进程内存在。

```sh
pnpm install --frozen-lockfile
pnpm dev                 # 本地 Web
pnpm desktop:dev         # 构建并启动 Electron
pnpm desktop:package     # 为当前系统生成安装包
pnpm check
pnpm test
pnpm exec playwright install chromium
pnpm test:browser        # 先 pnpm build；只操作无头浏览器
```

[Actions](https://github.com/Cansiny0320/R2Client/actions/workflows/verify.yml) 为 Windows x64（NSIS）、macOS arm64/x64（DMG/ZIP）和 Linux x64（AppImage/DEB）构建安装包。CI 产物用于试用和验证；未配置发布者签名或 macOS notarization。FFmpeg 在桌面本地运行，可使用 [FFmpeg 官网列出的下载](https://ffmpeg.org/download.html)安装，在设置中选择程序，或让 R2Client 自动检测 PATH；项目不分发 FFmpeg 二进制。可用编码器取决于所选 FFmpeg 构建。

### 连接存储桶

在 Cloudflare 为目标桶创建最小权限的 R2 S3 凭据。在 R2Client 填写 Account ID、Bucket Name、Access Key ID 和 Secret Access Key。浏览器版先按 [R2 CORS 示例](docs/r2-cors.example.json) 添加 Web 站点的准确 Origin，并参考 [Cloudflare R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/)；桌面不需要 CORS。只读凭据可用于浏览、预览和下载。桌面记住凭据使用系统加密能力；Web 密钥只在当前标签页内存中。

[静态 Web 和密码分享自托管说明](docs/hosting.md)。普通文件管理不需要服务端、VPS 或额外的 R2 桶。

### 对象与本地文件

R2 的目录是对象键前缀；移动是先复制、后删除，不是原子操作。批量结果会逐项标出失败。整桶和目录下载会跳过不能安全映射为本地路径的名称；恢复下载时对照 ETag。Web 目录下载使用浏览器私有文件区保存未完成数据，完成后写入所选目录，需预留两份文件的磁盘空间。定时同步不会删除目标目录的本地文件。目录同步只比较已成功下载并记录的对象，单独设置的本地目录可以避免与其他文件冲突。

## English

R2Client is an independent, open-source Cloudflare R2 file manager for Windows, macOS, Linux and the Web. Browse buckets and object prefixes, upload with multipart resume, preview and share objects, and apply batch changes. Use the desktop app for local FFmpeg processing and scheduled folder sync. The web build is static; it connects directly to R2 with bucket CORS and keeps access keys in tab memory.

Use Node.js 24 and pnpm. Run `pnpm install --frozen-lockfile`, then `pnpm dev` for Web or `pnpm desktop:dev` for Electron. `pnpm desktop:package` packages the local platform. See [CI artifacts](https://github.com/Cansiny0320/R2Client/actions/workflows/verify.yml), [deployment](docs/hosting.md), and the [R2 CORS example](docs/r2-cors.example.json). Install FFmpeg separately to use desktop media conversion. Project code is under [MIT](LICENSE). This project is not affiliated with Cloudflare or the commercial R2Client product.
