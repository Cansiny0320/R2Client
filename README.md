<h1 align="center">R2Client</h1>
<p align="center">开源 Cloudflare R2 桌面客户端，支持 macOS、Windows 和 Linux。</p>
<p align="center">简体中文 · <a href="README.en.md">English</a></p>
<p align="center">
  <a href="https://github.com/Cansiny0320/R2Client/actions/workflows/verify.yml?query=branch%3Amain+is%3Asuccess">下载安装</a> ·
  <a href="docs/hosting.md">密码分享部署</a> ·
  <a href="https://github.com/Cansiny0320/R2Client/issues">问题反馈</a> ·
  <a href="#赞赏">赞赏</a>
</p>

## 使用

打开上方的 GitHub Actions 链接，选择一次成功的构建，在 **Artifacts** 下载对应平台的安装包。安装包未签名，macOS 版也未公证。

首次打开时填写 Cloudflare Account ID、桶名和 R2 S3 凭据。应用直接连接 R2，无需配置 CORS；可在系统支持加密存储时保存凭据。

- 管理多个账号和桶，搜索、预览文件，批量移动、复制或删除对象。
- 上传文件、目录、剪贴板内容或 URL，支持分片、续传和上传去重；也可定时同步目录到本机。
- 分享公开链接或临时签名链接；[密码分享](docs/hosting.md)需单独部署。转码和压缩需安装 [FFmpeg](https://ffmpeg.org/download.html)。

## 开发

使用 Node.js 24 和 pnpm。

```sh
pnpm install --frozen-lockfile
pnpm desktop:dev
```

本地打包运行 `pnpm desktop:package`。提交问题时，请附上系统版本、复现步骤和报错信息，勿附凭据。

## 赞赏

觉得好用的话，欢迎通过[赞赏页面](https://image.cansiny.top/sponsor)用微信或支付宝支持。

![微信与支付宝赞赏二维码](.github/sponsorship.webp)

[MIT](LICENSE)
