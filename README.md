# 栖台 · 个人工作台

本次更新将市场入口替换为「需求与咨询」：有权处理的文本样本分析、原文证据、人工审核与自愿咨询记录。使用现有 AI 配置和 Cloudflare 数据库，不重新迁移账号或密钥。小黑盒读取仍待授权评估。

首版步骤见 [需求与咨询使用指南](docs/DEMAND-MVP.md)，最新验证状态见 [验证记录](docs/DEMAND-MVP-VERIFICATION.md)。以下保留原功能和部署背景。

一个可自行部署、持续修改的个人工作台。React + TypeScript + Vite 前端，Node.js + Fastify + SQLite 后端，另有运行在已登录 Codex 电脑上的同步助手。电脑和手机通过同一服务器访问，业务记录保存在服务器数据库。

现已提供 **Cloudflare Pages + Functions + D1** 部署方式：保留原登录、加密设置、记录、行情、学习 AI 和同步接口，云端运行不依赖本机 Node 服务。完整步骤见 [Cloudflare 部署与迁移指南](docs/CLOUDFLARE.md)。上传源码使用 `npm run cloudflare:package`，私密数据库迁移使用 `npm run cloudflare:export`；私人导出和密钥不能上传 GitHub。原 Windows/Node 部署仍可使用。

## 本地启动

安装 Node.js 24 LTS（项目使用内置 `node:sqlite`）。在项目目录运行：

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

打开 [工作台](http://127.0.0.1:5173/) 并设置至少 12 个字符的个人密码；[演示模式](http://127.0.0.1:5173/#demo) 使用明确标注的示例，不保存、不调用付费 API。首次账号由你设置，源码没有预置密码。`.env` 默认适合本机开发；端口 5173 是前端、4318 是后端。

也可直接运行正式构建：

```powershell
npm run build
npm start
```

此时在 `.env` 中设置 `APP_ORIGIN=http://127.0.0.1:4318`，打开 [本机正式版](http://127.0.0.1:4318/)。初次启动创建 `data/`。停止再启动仍保留数据。API 密钥在设置页面输入并加密保存，浏览器不回显，不存入 localStorage。

## 已实现功能与接入条件

| 模块 | 已有功能 | 真实数据条件 |
| --- | --- | --- |
| Codex | 短窗口 / 周窗口、多额度桶、剩余百分比、逐秒刷新倒计时、成功采样历史、每日 token 原始统计日期、离线与失败状态 | 在设置生成令牌，并在已登录 Codex 的电脑运行助手；账号或版本不返回日统计时显示缺失 |
| 其他 AI | 自定义订阅额度、API 余额、币种分类、刷新时间、低余额提醒 | 任意平台手动记录；DeepSeek 官方余额需密钥；OpenAI Costs 仅查询当月费用，需组织管理员权限 |
| 美股 / A 股 | 自选增删改、阈值提醒、采样历史、源时间与接收时间、实时 / 分钟 / 延迟标签 | Alpaca 美股 IEX/SIP 权限；Tushare `rt_min` 实时分钟权限；服务器按最少 30 秒间隔采样，不是逐笔推送 |
| 学习 | 考研 / 四级 / 六级目标、日期倒计时、计划、专注计时、学习记录、错题与复习、流式 AI 辅导 / 作文 / 阅读 / 翻译 / 计划 | AI 功能配置兼容 Chat Completions 的公网 HTTPS API；文字功能不含听力与语音 |
| 学习通 | 手动任务、完成状态、截止提醒、原平台链接、JSON 文件导入、相同平台 ID 合并 | 自动读取平台任务尚未在真实会话验证；不自动登录、答题或提交 |
| 数据与设置 | 单用户登录、修改密码、密钥加密、同步令牌轮换、记录备份合并、深浅主题、响应式导航 | 通过服务器统一持久化；演示不写入 |

日统计缺失时，“今日监测期间额度变化”按北京时间当天成功采样计算已用量增长的百分点，仅比较同桶、同刷新周期、最多 5 分钟的相邻采样；重置、回落、缺失和长间隔跳过。界面显示监测区间和跳过数量，取整与漏采样使它不能代表完整日消耗。

“今日用量”只使用接口返回的原始日期与 token 数。五小时 / 周额度不能换算为 token 数、每日百分比或费用。缺失、过期和失败时都不会展示为 0；刷新时间到达后等待下一份真实快照。日统计可能独立于额度过期，会显示它自身的采样时间。

AI 费用根据你填写的每百万 token 单价估算。每日请求次数上限限制本工作台的请求；估算费用阈值达到后阻止下一次请求，不能当作服务商账单的硬上限。一次生成可能超过阈值，上游不返回 usage 时无法估算。

## Codex 同步助手

详细步骤见 [docs/SYNC.md](docs/SYNC.md)。助手仅调用 Codex App Server 的额度 / 日统计读取，不发起模型推理，不上传聊天、账号认证或原始日志。新生成令牌会使旧令牌失效。

```powershell
# 令牌在网页设置生成，不要把它发到聊天里
$env:WORKBENCH_URL = 'http://127.0.0.1:4318'
$env:WORKBENCH_AGENT_TOKEN = '<你刚生成的令牌>'
npm run agent -- --dry-run
npm run agent:once
npm run agent
```

默认每 60 秒同步。远程部署时 WORKBENCH_URL 改成 HTTPS 域名；助手继续运行在你的电脑，通过主动上传连接服务器。手机不需要运行 Codex。电脑休眠、退出 Codex 登录或助手停止后，页面显示上次数据与过期状态。

学习通任务导入示例：

```json
{"tasks":[{"platformId":"work-42","title":"高等数学第三章作业","course":"高等数学","type":"assignment","dueAt":"2026-10-10T20:00:00+08:00","status":"pending","url":""}]}
```

在“学习通任务 → 导入 JSON”选择文件或粘贴。缺席的任务保留，不推断完成。列表中相同平台 ID 只保留合并后的最新项；已有完成状态在新项未指定时保留。截止时间从 ISO 时间转为北京时间显示。

## 以后接入服务器与域名

项目附带 `Dockerfile`、`compose.yaml` 与 `docs/Caddyfile.example`。在服务器安装 Docker 后，创建 `.env`：

```dotenv
APP_ORIGIN=https://desk.example.com
SETUP_TOKEN=替换为长随机的一次性初始化口令
```

运行 `docker compose up -d --build`。应用仅绑定服务器环回端口 4318，由 Caddy / Nginx 提供 HTTPS，域名 DNS 指向服务器。Caddy 示例中的域名替换为你的域名。容器首次设置密码时必须填写 SETUP_TOKEN；请自行生成真实随机口令。首次设置后不能再次覆盖账号。反向代理需转发原始 Host，流式学习接口禁用缓冲，客户端超时至少 75 秒。仅放行 HTTPS 服务；当前版本无需额外公网同步端口。

`compose.yaml` 挂载 data 卷，升级镜像不清空记录。Node 方式部署也可由 systemd / PM2 管理 `node server/index.mjs`，设置 `NODE_ENV=production`、`HOST=127.0.0.1`、`PORT=4318`、正确 APP_ORIGIN 后使用反向代理。

**备份迁移：** 网页 JSON 备份仅含业务记录和额度快照，不含密码 / API 密钥 / 令牌 / 配置。网页支持最大 64 MB 的 JSON 备份；超过时请使用完整 data 目录备份。导入校验整份备份，再原子合并较新记录，保留原时间戳；导入额度快照不替代实时采样。完整服务器迁移先停止服务，再复制整个 data 目录（含 SQLite、加密 key 文件），放在受限权限目录；丢失 key 文件将无法解密旧密钥。源码归档不包含你的 data。

本轮未发布公网网站；Docker 与实际域名部署需要在目标服务器执行并验收。

## 后续修改

- `src/pages/`：各功能页面，可分别修改；`src/styles.css`：主题与响应式样式。
- `src/lib/`：额度 / 日期 / 导入逻辑、类型、服务端 API 与全站状态。
- `server/`：认证、数据库、API、密钥、行情与学习服务。
- `agent/`：本机同步助手；`docs/SYNC.md`：助手使用说明。
- `tests/` 与 `src/lib/*.test.ts`：实际行为测试。

```powershell
npm test
npm run build
```

后续可以直接继续修改这个项目。新增服务商使用独立适配器；调整 UI 不影响数据库。更新前备份 data；新的字段与数据库迁移需要在测试中验证旧数据兼容。

## UI 来源与许可

复用了 GitHub 项目 [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin) 的 Button / Card / Badge 组件（MIT），并保留许可与具体版本，详见 `THIRD_PARTY_NOTICES.md` 与 `LICENSE.shadcn-admin`。栖台的中文信息结构、页面与样式单独实现，没有复制上游演示数据为你的真实数据。

测试范围与实际验收记录见 [docs/VERIFICATION.md](docs/VERIFICATION.md)。
