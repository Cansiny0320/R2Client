# R2Client 桌面专用构建实施计划

1. 将 `apps/web/src/style.css` 和图标迁入 `apps/desktop/renderer`，保留界面改动。用 Vite 从 Electron preload 初始化 React，资源直接进入 `apps/desktop/dist/ui`。检查 `apps/desktop/src/main.ts` 中本地协议的资源路径、CSP、IPC 和预览。保持既有配置目录和应用 ID。
2. 调整 `packages/core/src/engine.ts` 和 `packages/ui/src/{index,panels}.tsx`：不再加载示例桶，零个真实配置时显示可填写的首次引导；有真实配置时恢复已有工作区。检查遗留示例桶不会盖住真实桶、表单提交失败可重试、重新打开可复用加密凭据。
3. 删除 `apps/web`、旧 CORS 示例和部署指引的 Web 部分。更新根脚本、workspace 锁文件、README 和 `.github/workflows/verify.yml`；保留可选分享 Worker 和三平台打包。将无头界面测试改为使用桌面界面及模拟 preload，验证首次连接和默认下载路径；S3 签名和分享仍由原有测试覆盖。
4. 执行 `pnpm install --frozen-lockfile`、`pnpm check`、`pnpm test`、`pnpm build`、`pnpm test:renderer` 和 Windows NSIS 打包。确认已安装 Windows 包能显示全新引导、以正式用户数据加载现有桶并执行只读请求。原有快捷方式与安装目录区分；不碰原版进程和远程配置。

风险：本地协议的资源和 CSP 会影响预览；通过安装版启动测试覆盖。密钥加密格式和文件布局不变，验证前保留上一版安装包，必要时可覆盖回装。回滚源码时按任务 diff 逆转，保留已有并行修改；已经下线的 Web 入口不会因本地回滚而重新部署。
