# 独立同步助手

助手在拥有 Codex 登录状态的电脑上运行，通过本机 `codex app-server` 的标准输入输出读取额度和每日 token 统计，再主动 POST 到工作台。工作台不需要反向连接电脑。需要 Node.js 24 和已经安装、已登录的 Codex CLI。助手不会创建聊天、启动模型推理、读取浏览器配置文件或把登录凭据上传。

实现依据：[OpenAI 官方 App Server 文档](https://learn.chatgpt.com/docs/app-server)。每次子进程连接先完成 `initialize` / `initialized`，随后只调用 `account/rateLimits/read` 和 `account/usage/read`。quota 使用率、每日 token 数和费用是不同指标；本助手不推算费用。API key 登录可能无法返回订阅额度或每日统计；不支持的数据保留 `null`。

## 首次连接

1. 在工作台设置中生成“同步助手令牌”，复制这次显示的值。工作台只存哈希，轮换会立即使旧令牌失效。
2. 在拥有 Codex 登录状态的电脑上，进入本项目目录，设置 `WORKBENCH_AGENT_TOKEN`。令牌仅用于 `/api/sync/codex` 和 `/api/sync/tasks`，不能访问其他工作台数据。
3. 先执行 `node agent/index.mjs --dry-run` 检查脱敏后的实际额度，再运行 `--once` 完成单次同步。去掉选项后每 60 秒采样一次。

`--dry-run` 会启动本机 app-server 并可能由 Codex 正常刷新账号状态，但只打印白名单额度 JSON，不联系工作台，也不打印账号标识或令牌。使用 `--dry-run --snapshot-file path.json` 可以仅验证文件，无需 Codex 或登录状态。

Windows PowerShell（把示例占位符替换为设置页生成的令牌）：

```powershell
Set-Location 'C:\path\to\personal-workbench'
$env:WORKBENCH_URL = 'http://127.0.0.1:4318'
$env:WORKBENCH_AGENT_TOKEN = 'E5YvPBTE_Y4Bex4X-dXX6IXj4GfxEDt-Cdc1H3Av-eY'
# 通常不需要以下覆盖项；明确指定时才设置。
# $env:CODEX_BIN = 'C:\path\to\codex.exe'
# $env:CODEX_HOME = 'C:\path\to\your-codex-home'
node agent/index.mjs --dry-run
node agent/index.mjs --once
node agent/index.mjs
```

Linux / macOS：

```bash
cd /path/to/personal-workbench
export WORKBENCH_URL='http://127.0.0.1:4318'
read -r -s -p '同步助手令牌: ' WORKBENCH_AGENT_TOKEN; echo
export WORKBENCH_AGENT_TOKEN
# 可选：export CODEX_BIN='/absolute/path/to/codex'
# 可选：export CODEX_HOME='/absolute/path/to/your-codex-home'
node agent/index.mjs --dry-run
node agent/index.mjs --once
node agent/index.mjs
```

运行默认继承当前用户的普通环境和当前工作目录，也会从当前目录的 `.env` 加载配置（需先按项目 README 安装依赖）。已有环境变量优先，`.env` 不覆盖它们。可以在 `.env` 中设置 `WORKBENCH_URL`、`WORKBENCH_AGENT_TOKEN`，并保护该文件，避免提交到 Git 或放入导出归档。`CODEX_BIN` 是可执行文件路径，不是 shell 命令；不能包含额外参数。Windows 默认使用 `codex.exe`，其他系统使用 `codex`。`CODEX_HOME` 未显式指定或为空时沿用正常用户环境与 CLI 默认；空的 `CODEX_HOME` / `CODEX_BIN` 不传给子进程。同步令牌不会传给 Codex 子进程。不要为运行助手复制浏览器 cookie、读取 auth.json 或改动账号令牌文件。

`WORKBENCH_URL` 默认 `http://127.0.0.1:4318`。远程工作台必须使用 HTTPS；仅 localhost、127.0.0.1 和 ::1 允许 HTTP。请使用源站根地址，禁止 URL 中的用户名、密码、查询参数和 fragment。上传禁止自动重定向，因此反向代理应直接把这两个路径转发到工作台。令牌错误或轮换后，到工作台设置重新生成并更新启动环境。

## 数据与故障行为

上传 JSON 带唯一 `eventId`、ISO `observedAt`，额度只保留 `rateLimits`、`rateLimitsByLimitId` 和每日 `{startDate,tokens}`。每日数据按日期排序，只保留最近 400 天；重复日期取最后一条。窗口保留 `usedPercent`、`windowDurationMins`、`resetsAt`（Unix 秒）；缺失项仍为 `null`，超出 0–100 的使用率置为 `null`，不会冒充 0 或 100。多桶映射中的空值或无效桶会剔除。桶可带短标识/标签、`planType`、`rateLimitReachedType`、`credits` 的 `hasCredits` / `unlimited` / 数字字符串 `balance`。不上传账号信息、token 活动 summary、重置凭证或上游原始错误消息。不会因为采样失败制造新的零用量。

RPC 和 HTTP 请求各有 15 秒超时。失败后周期依次延长到 120、240、480 秒，最多 900 秒；成功恢复 60 秒。按 Ctrl+C 或 SIGTERM 会停止计时并终止当前子进程。终端只输出固定状态，例如 `CODEX_SYNCED`、`TASKS_SYNCED`、`CODEX_AUTH_REQUIRED`、`CODEX_TIMEOUT`。`--once` 或文件导入失败会返回非零退出码。每日统计不支持时，保留实际额度、将每日统计置为 `null`，并上报 `CODEX_USAGE_UNAVAILABLE`；需升级兼容的 CLI 或检查账号支持情况。

账号异常时，在用户自己的终端执行 `codex login` 完成重新连接，然后重跑 `--dry-run` / `--once`。助手不自动执行登录、登出或账号切换，也不展示来自服务端的可能包含个人信息的错误文本。

## 额度文件导入

`node agent/index.mjs --once --snapshot-file snapshot.json` 会上传脱敏结果。文件最多 1 MiB，导入自动单次退出。请提供真实采样时间；已有 `observedAt` 原样保留其时间语义，避免把旧数据伪装成新采样。相同内容和采样时间生成相同事件 ID；服务端去重并拒绝过时或未来的采样。

```json
{
  "observedAt": "2026-10-02T12:00:00.000Z",
  "rateLimits": {
    "limitId": "codex",
    "primary": {"usedPercent": 25, "windowDurationMins": 300, "resetsAt": 1790942400},
    "secondary": null
  },
  "rateLimitsByLimitId": null,
  "dailyUsageBuckets": [{"startDate": "2026-10-02", "tokens": 12345}]
}
```

示例仅展示格式，时间和数值必须替换为自己的实际数据。未提供 `observedAt` 时采用导入时刻。`eventId`、额外字段和未知错误文本不会照搬进上传内容。

## 学习平台任务导入

自动读取超星等学习平台的登录页面尚未验证，目前支持用户自行整理或导出的 JSON。助手不会登录学习平台或访问浏览器 cookie。保存下列结构后运行：

```powershell
node agent/index.mjs --tasks-file tasks.json
```

```json
{
  "tasks": [
    {
      "platformId": "course-123-assignment-456",
      "title": "英语阅读作业",
      "course": "大学英语",
      "type": "assignment",
      "dueAt": "2026-10-10T23:59:00+08:00",
      "status": "pending",
      "url": "https://example.edu/tasks/456"
    }
  ]
}
```

顶层也可直接是数组；最多 1000 条。每条必须有非空 `title`（最多 300 字符）和稳定 `platformId`（1–160 位字母、数字、冒号、下划线或连字符）。建议 ID 包含课程与任务 ID，避免跨课程冲突。`course` 可省略，`type` 为 `assignment` / `exam` / `other`，`status` 为 `pending` / `completed`，`dueAt` 为 ISO 日期时间或 `null`，`url` 为 HTTP(S) 地址或空字符串。

缺省 `type` 为 `other`、`status` 为 `pending`，不会推断完成状态。同一文件里重复 ID 取最后一条；服务端按 `platformId` 更新，未出现在文件里的任务不会删除。记录 source 由服务端设置。

链接允许这些查询参数（大小写不敏感）：`courseId`、`taskId`、`workId`、`examId`、`classId`、`clazzid`、`id`、`knowledgeId`。值只能是 1–160 位字母、数字、下划线或连字符，例如 `https://mooc1.chaoxing.com/mooc2/work/dowork?courseId=123&workId=456`。仍禁止用户名/密码、fragment 和其他参数，包括 `token`、`auth`、`password`、`enc`、签名或跳转参数；含不支持参数的链接请省略，或手动提供不含凭据且符合上述规则的页面地址。需要 `enc` 等鉴权参数的超星链接不能通过助手导入，不能把它们作为任务 ID 参数绕过限制。其他字段被剔除，标题和课程是用户提供的数据，请只放需要同步的课程内容。

## 可选开机启动

无需自动创建系统计划。Windows 可自行在任务计划程序中添加当前用户登录时运行的任务：程序选择 Node 可执行文件，参数使用本项目 `agent\index.mjs` 的绝对路径，起始目录设为本项目，并在受保护的启动环境中提供上述变量。不要把令牌放入命令行参数、任务名称或公开脚本；桌面账号依赖登录用户环境，不建议改成 SYSTEM 身份。Linux 可用当前用户的 systemd 服务并设置 `WorkingDirectory` 和私有 `EnvironmentFile`（权限 600）；停止服务时发送 SIGTERM。优先使用助手内置轮询，不要让周期任务同时启动多个常驻副本。

连接远程工作台只需把 `WORKBENCH_URL` 换为自己的 HTTPS 域名，并确保电脑能出站访问该地址。关闭电脑或暂停助手后，工作台会保留最后采样并显示过期状态。
