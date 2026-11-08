# 自托管 Web 和密码分享

R2Client Web 是静态应用。文件列表、预览、上传、下载、索引和内容去重由客户端直接访问 R2。只有密码分享需要动态服务。部署不需要 VPS。

## Web

1. `pnpm --filter @r2client/web build` 生成 `apps/web/dist/client`。
2. 使用静态托管服务，入口为 `index.html`。Cloudflare 可使用 `apps/web/wrangler.jsonc` 的静态资源配置；该目录内的 `_headers` 对 Cloudflare 生效。若用其他静态服务，按该文件设置 CSP、Referrer-Policy 和响应头。
3. 在目标 R2 桶添加实际 Web Origin。示例可用于 R2 Dashboard 的 CORS JSON 编辑器，具体操作见 [Cloudflare R2 CORS 文档](https://developers.cloudflare.com/r2/buckets/cors/)。合并已有规则。开发时按需要加入 `http://localhost:5173` 或 `http://127.0.0.1:5173`，不要将示例站点作为生产配置。
4. 确认浏览器能列桶、读取对象并读取 ETag。文件名、账户信息、任务清单和已索引的对象元数据保存在当前浏览器的本地存储内；可在浏览器中清理此站点数据。不会写入长期 R2 密钥。

## 可选的密码分享

普通公开或预签名链接不使用 Worker。启用密码链接时：

1. 新建一个独立的 D1 数据库，替换 `apps/share/wrangler.jsonc` 中的示例 database ID。应用 `apps/share/migrations`。开发环境可以使用本地模拟 D1。
2. 为 Worker 配置 `SHARE_ADMIN_TOKEN`（至少 32 个随机字符）及 `SHARE_ENCRYPTION_KEY`（32 个随机字节，base64url）。通过 Cloudflare Worker secrets 写入；不要将实际值放入 Git 或浏览器持久存储。`ALLOWED_ORIGINS` 写入实际 Web Origin，桌面协议为 `r2app://local`。
3. 将该 Worker 部署到独立 HTTPS 域名。在 R2Client 的分享设置填入服务 URL。创建和撤销时输入管理令牌；令牌只授予信任的管理人员。
4. 需要测试时使用示例桶和短时授权。分享凭据是一个对象的预签名 GET，有效期最长 7 天。D1 存加密后的授权和密码校验信息；撤销会使现存会话失效。已经完成的下载无法撤回。密码链接不会改变桶的公开访问设置。

CLI 使用项目内 Wrangler。仅本地测试可执行 `pnpm --filter @r2client/share types`，或复制 `.dev.vars.example` 至未纳入 Git 的 `.dev.vars`，运行 `pnpm --filter @r2client/share exec wrangler d1 migrations apply r2client-share --local`，再运行 `pnpm --filter @r2client/share dev`。浏览器端会要求 HTTPS 分享服务；在 loopback 开发例外可用 HTTP，跨平台测试请用 HTTPS 或使用 Miniflare 的隔离测试。
