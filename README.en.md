<h1 align="center">R2Client</h1>
<p align="center">An open-source Cloudflare R2 desktop client for macOS, Windows, and Linux.</p>
<p align="center"><a href="README.md">简体中文</a> · English</p>
<p align="center">
  <a href="https://github.com/Cansiny0320/R2Client/actions/workflows/verify.yml?query=branch%3Amain+is%3Asuccess">Download</a> ·
  <a href="docs/hosting.md">Password sharing setup (Chinese)</a> ·
  <a href="https://github.com/Cansiny0320/R2Client/issues">Issues</a> ·
  <a href="#support">Support</a>
</p>

## Getting started

Open the GitHub Actions link above, select a successful run, and download the installer for your platform under **Artifacts**. Installers are unsigned, and the macOS builds are not notarized.

On first launch, enter your Cloudflare Account ID, bucket name, and R2 S3 credentials. The app connects directly to R2 without CORS setup and can save credentials when your system supports encrypted storage.

- Manage multiple accounts and buckets, search and preview files, and move, copy, or delete objects in bulk.
- Upload files, folders, clipboard contents, or URLs with resumable transfers and deduplication. Sync folders to your computer on a schedule.
- Share public or presigned links. [Password-protected links](docs/hosting.md) need a separate service. Transcoding and compression require [FFmpeg](https://ffmpeg.org/download.html).

## Development

Use Node.js 24 and pnpm.

```sh
pnpm install --frozen-lockfile
pnpm desktop:dev
```

Run `pnpm desktop:package` to build an installer locally. When reporting an issue, include your OS version, steps to reproduce, and error details. Leave out any credentials.

## Support

If you find R2Client useful, you can support it via WeChat Pay or Alipay on the [support page](https://image.cansiny.top/sponsor).

![WeChat Pay and Alipay QR codes](.github/sponsorship.webp)

[MIT](LICENSE)
