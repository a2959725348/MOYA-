# MOYA 主页与工作台双入口

根路径 `/` 使用已确认的三段视频主页。原 React 工作台位于 `/workbench/`，继续使用相同的 `/api/*`、登录 Cookie、数据库和加密设置。无数据迁移，也不删除账户。登录页和侧边栏品牌可点击返回主页。

执行 `npm run build` 后，Vite 先构建原工作台，`scripts/prepare-homepage.mjs` 保留其完整入口于 `dist/workbench/index.html`，再将批准的海洋主页写入 `dist/index.html`。该步骤重复执行不会让工作台被主页覆盖。Cloudflare `_redirects` 和 Node 静态回退均支持工作台子路径。

`public/home/` 的视频、封面、样式和脚本作为单独静态文件发布。海面初始播放，浅海和深海临近对应区段才加载，未显示和页面隐藏时暂停。生产主页没有内嵌约 10 MB 的独立预览 HTML。

视频素材与许可：

- [Mixkit 4119 — Stunning sunset seen from the sea](https://mixkit.co/free-stock-video/stunning-sunset-seen-from-the-sea-4119/)
- [Mixkit 1273 — Air bubbles underwater, upside video](https://mixkit.co/free-stock-video/air-bubbles-underwater-upside-video-1273/)
- [Mixkit 178 — Bubbles rising in water](https://mixkit.co/free-stock-video/bubbles-rising-in-water-178/)

上述项目使用 [Mixkit Stock Video Free License](https://mixkit.co/license/#videoFree)。本项目对其裁切、调色、首尾交叠，并离线合成原创光束底片；在主页设计中作为背景使用。没有运行 Canvas/WebGL 海浪渲染。

发布时继续使用已有 Cloudflare Pages 项目 `moya`，构建命令仍为 `npm run build`，输出目录仍为 `dist`。保留原 DB、VAULT_KEY、SETUP_TOKEN、APP_ORIGIN，不建立新数据库。此次仅发布 Cloudflare，不更新阿里云服务器。
