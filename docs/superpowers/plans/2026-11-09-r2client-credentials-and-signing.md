# R2Client 本地凭据与固定签名实施计划

1. 在 `apps/desktop/src/local-credentials.ts` 和 `files.ts` 接入 macOS 文件存储。按账户独立原子写入，目录与文件仅当前用户可访问。保留旧版密文和连接资料，连接失败不能覆盖本地凭据。调整 `packages/ui/src/setup.tsx` 和 `panels.tsx` 的记住凭据文案。用临时目录测试重启读取、删除和文件权限。
2. 在 `apps/desktop/scripts/` 加入按指纹签名的本机及 CI 入口，在 `apps/desktop/package.json` 注册入口，并在 `.github/workflows/verify.yml` 连接 macOS 版本标签构建。用两次不同内容的本机包核对签名身份、签名条件和启动。为 GitHub 配置加密 Secrets 并仅回读名称。仓库只记录公开指纹。
3. 运行 `pnpm check`、`pnpm test`、`pnpm build`、`pnpm test:renderer`，检查正式签名脚本缺少凭据时会失败。使用隔离数据运行安装包 smoke。Cloudflare 重新签发仅限已有存储桶，使用已有重新连接入口验证，保留旧 Token。

本机信任只授予专用证书的代码签名策略。回滚可恢复旧签名入口和凭据存储实现，继续读取旧加密记录。签名身份及 Secrets 的轮换应单独处理，避免现有发布包识别失败。
