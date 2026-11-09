# 可选密码分享服务

桌面客户端直接连接 R2。只有创建密码分享时才需要单独部署下面的服务。

普通公开或预签名链接不使用 Worker。启用密码链接时：

1. 新建一个独立的 D1 数据库，替换 `apps/share/wrangler.jsonc` 中的示例 database ID。应用 `apps/share/migrations`。开发环境可以使用本地模拟 D1。
2. 为 Worker 配置 `SHARE_ADMIN_TOKEN`（至少 32 个随机字符）及 `SHARE_ENCRYPTION_KEY`（32 个随机字节，base64url）。通过 Cloudflare Worker secrets 写入；不要将实际值放入 Git 或浏览器持久存储。`ALLOWED_ORIGINS` 使用桌面协议 `r2app://local`。
3. 将该 Worker 部署到独立 HTTPS 域名。在 R2Client 的分享设置填入服务 URL。创建和撤销时输入管理令牌；令牌只授予信任的管理人员。
4. 需要测试时使用示例桶和短时授权。分享凭据是一个对象的预签名 GET，有效期最长 7 天。D1 存加密后的授权和密码校验信息；撤销会使现存会话失效。已经完成的下载无法撤回。密码链接不会改变桶的公开访问设置。

CLI 使用项目内 Wrangler。仅本地测试可执行 `pnpm --filter @r2client/share types`，或复制 `.dev.vars.example` 至未纳入 Git 的 `.dev.vars`，运行 `pnpm --filter @r2client/share exec wrangler d1 migrations apply r2client-share --local`，再运行 `pnpm --filter @r2client/share dev`。浏览器端会要求 HTTPS 分享服务；在 loopback 开发例外可用 HTTP，跨平台测试请用 HTTPS 或使用 Miniflare 的隔离测试。
