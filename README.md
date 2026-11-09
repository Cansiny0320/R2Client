# R2Client

[English](#english) · [简体中文](#简体中文)

## 简体中文

R2Client 是面向 Windows、macOS 和 Linux 的开源 Cloudflare R2 客户端。首次打开时，按引导填写 Account ID、桶名及 R2 S3 凭据。可以记住凭据，应用会使用系统加密存储。桌面端直接连接 R2，无需为客户端配置 CORS。

- 浏览多个账号和桶，搜索、预览文件，批量复制、移动、删除、重命名和编辑元数据。
- 上传文件、目录、剪贴板内容或 URL；支持分片、暂停、重试和断点续传。
- 批量下载到本机、按时同步目录，查看统计，按 SHA-256 去重。
- 分享公开链接、临时签名链接，或使用[独立密码分享服务](docs/hosting.md)。
- 本地 FFmpeg 转码和压缩需单独[安装 FFmpeg](https://ffmpeg.org/download.html)。

### 开发与安装

需要 Node.js 24 和 pnpm。

```sh
pnpm install --frozen-lockfile
pnpm desktop:dev
pnpm desktop:package
pnpm check
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:renderer
```

[GitHub Actions](https://github.com/Cansiny0320/R2Client/actions/workflows/verify.yml) 为 Windows x64（NSIS）、macOS arm64/x64（DMG/ZIP）和 Linux x64（AppImage/DEB）打包。安装包未配置发行者签名和 macOS notarization。

R2 目录是对象前缀，移动是复制后删除。目录同步不会删除本地文件，续传会检查对象 ETag。只读凭据可用于浏览、预览和下载；上传需要该桶的写入权限。

## English

R2Client is an independent, open-source Cloudflare R2 desktop client for Windows, macOS and Linux. On first launch, connect a bucket using R2 S3 credentials. The app supports browsing, previewing, batch editing, resumable transfers, scheduled folder sync and local FFmpeg processing.

Use Node.js 24 and pnpm. Run `pnpm install --frozen-lockfile` and `pnpm desktop:dev`. Run `pnpm desktop:package` for a local installer or see [CI artifacts](https://github.com/Cansiny0320/R2Client/actions/workflows/verify.yml). [Password sharing](docs/hosting.md) uses a separate optional service. Code is under [MIT](LICENSE); the project is not affiliated with Cloudflare or the commercial R2Client product.
