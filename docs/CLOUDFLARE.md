# 将个人工作台迁移到 Cloudflare Pages + D1

这份部署使用 Pages 托管前端，用 Pages Functions 运行 `/api/*`，用 D1 保存账号、设置和记录。完成部署后，电脑关机时网站仍然能登录、编辑资料、查看已有数据，并在网页中调用已配置的 AI 和行情服务。所有上传、Cloudflare 登录、数据库导入和域名绑定步骤都由你在自己的账号中执行；本次只准备代码、迁移工具和说明。

本地 Codex 助手仍在你的 Windows 电脑上运行。电脑关机时，Codex 额度、用量和本地任务同步不会继续更新，网页显示最后一次快照与过期状态。Cloudflare 不会获得你的 Codex 登录凭据。行情刷新由网页请求触发；打开网页时的自动轮询能够请求更新，关闭网页后不会持续运行 24 小时采集任务。

## 1. 准备两个分别保管的文件包

需要 Node.js 24、GitHub 账号和 Cloudflare 账号。在原项目目录打开 PowerShell，先确认 `node --version` 为 24 或以上，再安装依赖：

```powershell
npm install
```

保留原 `data` 文件夹，里面的 `workbench.sqlite` 与 `vault.key` 必须来自同一套正在使用的工作台。不要把运行时 SQLite 单个文件随意复制出来，因为尚未写回主文件的数据可能在 WAL 中。

导出工具会只读打开 SQLite，在同一个读取事务中取得一致快照，先验证所有已保存 API 密钥能够被原加密密钥解密。它保留原密码哈希、设置、加密 API 密钥、同步令牌哈希、记录与事件，不导出登录会话。因此迁移后仍用原密码登录，需要重新登录一次。

```powershell
npm run cloudflare:export -- --source "C:\你的原工作台\data" --output "private-cloudflare-export"
```

如果原数据就在当前项目的 `data` 中，可以使用 `--source "data"`。输出目录必须不存在。项目内只允许写入已忽略的 `private-cloudflare-export`；再次导出时，可以将 `--output` 改成项目外新的私人文件夹，工具不会覆盖已有导出。

输出包含：

| 文件 | 用途 | 应放在哪里 |
| --- | --- | --- |
| `private-cloudflare-export/data.sql` | 原账号、加密配置和个人记录 | 仅用 Wrangler 导入自己的 D1 |
| `private-cloudflare-export/vault-key.txt` | 原 32 字节 `vault.key` 的 Base64 值 | Cloudflare 的加密 Secret `VAULT_KEY` |
| `private-cloudflare-export/manifest.json` | 导出时间与行数 | 私人备份 |
| `personal-workbench-cloudflare-github.zip` | 可部署的源码 | 解压后上传 GitHub 私有仓库 |

**私人导出不能上传 GitHub，不能放进 `public` 或 `dist`，也不能发给别人。** API 密钥虽然在 SQL 中加密，配套的 `vault-key.txt` 可以解密它们；两者一起相当于完整凭据。`VAULT_KEY` 必须使用这份原密钥，重新生成会让已迁移 API 配置无法解密。普通网页 JSON 备份只保存业务记录，不替代这份包含密钥的迁移备份。

## 2. 创建新 D1，并在本地填好数据库 ID

以下命令会登录你的 Cloudflare 并写入云端数据，请由你自己执行。先登录，再创建一个全新的生产数据库：

```powershell
npm run cloudflare:login
npx wrangler d1 create workbench
```

复制返回的 `database_id`，打开根目录的 `wrangler.jsonc`，将生产环境 `d1_databases` 下的占位 ID 换成真实 ID。三个字段应对应如下，`binding` 必须保留为 `DB`：

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "workbench",
    "database_id": "替换成刚创建的真实数据库 ID",
    "migrations_dir": "cloudflare/migrations"
  }
]
```

数据库 ID 属于连接配置，可以放进源码；`VAULT_KEY` 和首次设置令牌不能写进这个文件。通过 Wrangler 文件管理的配置应修改该文件并推送 GitHub，避免只修改后台后又被后续部署覆盖。参考 [Pages 的 Wrangler 配置](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)。

先创建表，再将私人 SQL 导入这个新空库：

```powershell
npx wrangler d1 execute workbench --remote --file "cloudflare/migrations/0001_initial.sql"
npx wrangler d1 execute workbench --remote --file "private-cloudflare-export/data.sql"
```

`--remote` 明确表示云端数据库。导入前再次确认命令中的数据库名是刚新建的 `workbench`，不要指向旧网站或其他正在使用的数据库。SQL 开头会检查 `kv`、`records`、`events`、`sessions` 是否为空；非空时故意报 `integer overflow` 并停止。后续只使用普通 `INSERT`，碰撞也会失败，不会覆盖原有账号。遇到此错误时请新建空数据库，不能删除检查语句后强行导入。已有正式库应先备份，再单独设计迁移。

若导入过程失败，不要让用户继续向目标库写数据；先查看错误和 D1 状态，必要时另建空库重试。大于 100 KB 的单条 SQL 会在导出时被拒绝，这是 D1 的单条语句限制。参考 [D1 导入说明](https://developers.cloudflare.com/d1/best-practices/import-export-data/) 与 [D1 限制](https://developers.cloudflare.com/d1/platform/limits/)。

## 3. 将源码上传 GitHub 私有仓库

填好生产数据库 ID 后，在项目目录运行：

```powershell
npm run cloudflare:package
```

Windows 打包脚本会在项目上一级生成 `personal-workbench-cloudflare-github.zip`。这是源码包：包含 `src`、`public`、`functions`、`cloudflare`、服务和助手源码、测试、文档、依赖清单与配置；排除 `.env`、`agent.env`、数据库、加密密钥、私人导出、备份、`node_modules`、`.git`、`.wrangler`、`dist` 和安装包。已有同名 ZIP 时工具拒绝覆盖，可以用 `--output "..\personal-workbench-cloudflare-github-v2.zip"` 生成另一个文件。

1. 在 GitHub 新建仓库，例如 `personal-workbench`，选择 **Private**。
2. 在电脑上解压源码 ZIP，进入解压后的根目录。
3. 用 GitHub 网页的 **Add file → Upload files** 上传解压目录的内容，包含以点开头的 `.gitignore`。也可以使用 Git 提交这些源码文件。
4. 仓库根目录应直接看到 `package.json`、`wrangler.jsonc`、`src`、`functions` 和 `cloudflare`。不要把 ZIP 本身上传到仓库，也不要多包一层 `personal-workbench` 目录。
5. 确认私人导出、`data`、`.env` 和 `vault-key.txt` 没有出现在待上传列表，再提交到 `main`。

GitHub 网页一次最多上传 100 个文件，完整源码可能超过这个数量，可以分批上传目录。更方便的方式是安装 GitHub Desktop，登录后克隆刚创建的空私有仓库，把解压后的源码内容复制到克隆目录，填写提交说明，点击 **Commit to main → Push origin**。后续修改也在这个克隆目录中保存，再提交和推送。参见 [GitHub 文件上传说明](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)。

## 4. 在 Cloudflare 创建 Git 集成的 Pages 项目

进入 **Workers & Pages → Create application → Pages → Connect to Git**（后台文案可能调整），连接刚才的 GitHub 私有仓库，仅授权需要的仓库。选择 `main` 为生产分支。Pages 支持私有仓库并能随 Git 推送自动部署，见 [Git 集成说明](https://developers.cloudflare.com/pages/get-started/git-integration/)。

填写构建设置：

| 设置项 | 值 |
| --- | --- |
| Framework preset | `None`（手动填写下面两项） |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | 留空，源码放在仓库根目录 |
| 构建环境变量 `NODE_VERSION` | `24` |

保存并部署。平台安装依赖、构建前端，并编译仓库根目录的 `functions/api/[[path]].js`。**不要使用 Cloudflare 后台的拖拽 Direct Upload 上传源码 ZIP 或只上传 `dist`**：后台拖拽方式不会编译 `functions` 文件夹，完整 API 需要 Git 集成或 Wrangler 部署。参考 [Direct Upload 的 Functions 限制](https://developers.cloudflare.com/pages/get-started/direct-upload/#functions)。

第一次构建后若 API 暂不可用，继续配置下面的绑定和密钥，再重新部署。

## 5. 设置 D1、密钥与访问域名

在 Pages 项目的 **Settings → Bindings** 核对生产环境 D1 绑定：变量名 **`DB`**，数据库是刚才导入的 **`workbench`**。Wrangler 已声明时应核对解析出的绑定，不要重复添加另一个相同名称。绑定修改后需要重新部署，见 [Pages D1 绑定](https://developers.cloudflare.com/pages/functions/bindings/#d1-databases)。

在 **Settings → Variables and Secrets → Add** 中选择生产环境，添加 **`VAULT_KEY`**，值从私人文件 `vault-key.txt` 复制整行，选择 **Encrypt**，然后保存。不要把该值填入普通明文变量、`VITE_*` 前端变量或 GitHub 仓库。密钥保存后部署才会使用它，见 [Pages Secrets](https://developers.cloudflare.com/pages/functions/bindings/#secrets)。

若已导入设置过密码的旧账号，直接使用旧密码，无需创建账号。若迁移的原账号本身还没设置密码，或你从全新空库开始，则还需创建独立的随机 **`SETUP_TOKEN`** Secret（同样选择 Encrypt）。可以用密码管理器生成长随机字符串。首次页面设置账号时输入这个令牌，完成后可删除这个 Secret 并重新部署。

默认允许 DeepSeek、OpenAI、Alpaca 与 Tushare 的官方 API 主机。若原账号使用其他 OpenAI 兼容服务，需要在 `wrangler.jsonc` 的 `vars.AI_ALLOWED_HOSTS` 中填入你明确批准的公共主机名，多个主机用逗号分隔，例如 `api.your-provider.com`，再部署。这里只填主机名，具体 HTTPS API 地址仍在网页设置中填写。自定义服务必须使用公共 HTTPS 443 端口；云端不能连接电脑内的 localhost 服务。

`wrangler.jsonc` 的 `vars.APP_ORIGIN` 默认是：

```jsonc
"vars": { "APP_ORIGIN": "https://moyaiwork.com" }
```

该值必须与实际访问网站的 HTTPS 来源精确匹配，不带路径或末尾 `/`，用于验证 Host 和写操作来源。域名绑定完成后请访问 `https://moyaiwork.com`。如果要先用 Cloudflare 分配的 `https://你的项目.pages.dev` 测试，先将 `APP_ORIGIN` 改成这个真实地址，推送代码触发部署；测试结束再改回 `https://moyaiwork.com` 并重新部署。不要把项目占位地址当成实际地址。来源不符时 API 会返回 403，配置缺失时可能返回 503。

### 预览环境

推荐限制非生产分支的预览部署，或者单独创建 `workbench-preview` 数据库。预览也需要绑定名 `DB`、正确的 `APP_ORIGIN` 和匹配其数据的加密 `VAULT_KEY`；不要将预览绑定到生产库。可以在 `wrangler.jsonc` 的 `env.preview` 中配置预览的 D1 和变量，并在后台为 Preview 添加相应 Secrets。预览地址可能随部署变化，测试前以实际地址更新 `APP_ORIGIN` 并重新部署；只设置生产域名时预览 API 被拒绝是预期行为。

全新预览库应用公开 schema，生成它自己的 32 字节 Base64 密钥并使用独立 `SETUP_TOKEN`，创建测试账号。如果确实需要导入旧数据测试，使用另一套新空 D1 与同一份匹配导出密钥，并把它也视为私人生产数据。预览环境中的 Vault 密钥必须匹配其数据库中的密文，不能随意和另一环境互换。

## 6. 绑定 moyaiwork.com

确认 `moyaiwork.com` 已是当前 Cloudflare 账号中处于 Active 状态的域名区域，注册商 Nameservers 指向 Cloudflare。Pages 的根域名需要这样的区域配置。

进入该 Pages 项目的 **Custom domains → Set up a domain**，输入 `moyaiwork.com`，按提示确认 DNS 记录并等待域名和 HTTPS 证书激活。由 Pages 引导创建正确 DNS 记录；只有手动添加 CNAME、没有在 Pages 关联域名，会导致访问错误。参考 [Pages 自定义域名](https://developers.cloudflare.com/pages/configuration/custom-domains/)。

如果这个域名已绑定旧 Pages 项目，先核对旧站点用途和现有 DNS，记录原配置，再解除旧 Pages 自定义域名或处理冲突的 A/AAAA/CNAME 记录。只处理确认指向旧工作台的记录，保留邮件 MX、TXT 等其他业务配置。新站可用后再结束旧服务，不要未经核对删除整个 DNS 区域。

## 7. 验证、助手与后续更新

重新部署后，从配置的实际域名验证以下操作：旧密码能登录；原账户、任务、笔记和设置可见；已配置 API 显示已设置且能刷新余额、行情或发起 AI 对话；添加并编辑一条测试记录后刷新网页仍保留；退出后受保护 API 不返回私人记录。关闭电脑，用手机浏览器再次登录和编辑一条记录，确认云端独立运行。

若要继续本地同步，在电脑上保留本地助手配置，将 `WORKBENCH_URL` 改为 `https://moyaiwork.com`。已有同步令牌哈希被迁移，所以保留原有效令牌仍可工作；也可在网页设置中生成新同步令牌并更新本地 `WORKBENCH_AGENT_TOKEN`。它只放在电脑的私人环境配置中。设置开机或用户登录时启动助手后，电脑在线且助手运行期间才会同步。不要上传原 `agent.env` 或 Codex 登录文件。

以后修改源代码后，提交并推送到 GitHub 的生产分支，Pages 会自动构建部署。更换 Secret 后重新部署。更改数据表时，先对正式 D1 备份，再手动应用相应新 migration；Git 推送不会自动把数据库迁移执行一遍。

```powershell
npx wrangler d1 export workbench --remote --output "private-cloudflare-export\cloudflare-backup-2026-10-04.sql"
```

每次备份使用新的日期/文件名，并单独保管对应的 `VAULT_KEY`。完整 D1 备份可能包含会话、令牌哈希、记录和加密凭据，都属于私人数据。网页 JSON 恢复入口限制整个请求为 2 MB，只用于较小业务记录的合并恢复；数据较多或发生并发时可能返回 409/413，请分批恢复或在新空库进行完整 D1 SQL 迁移。不要把旧备份直接导入正在使用的数据库覆盖新增记录；优先在新空库检验，再明确规划恢复。备份和时间点恢复说明见 [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)。

## 费用与限制

截至 2026-10-04，Pages Functions 按 Workers 计费。Workers Free 提供每天 100,000 次请求，每次 10 ms CPU；Workers Paid 的账号最低费用为每月 5 美元，超额用量另计。此应用保留原账号兼容的 scrypt 密码哈希，登录和改密码可能超出免费计划的 CPU 配额，因此必须实际观察部署后的 CPU 指标，可能需要 Paid，不能保证永久免费。AI 提供商和行情服务还可能各自收费。参考 [Workers 官方价格](https://developers.cloudflare.com/workers/platform/pricing/)。

D1 Free 单库最大 500 MB，账号总存储 5 GB，免费方案还有限制每日读取/写入行数；超过配额可能让请求失败。数据量、刷新频率与并发都应按实际使用监测。参考 [D1 官方限制](https://developers.cloudflare.com/d1/platform/limits/) 和 [D1 官方价格](https://developers.cloudflare.com/d1/platform/pricing/)。

当前 D1 适配按请求读取个人工作台的数据快照，并原子提交变更，适合个人使用。记录或历史数量增长后，每次页面轮询的读取行数也会增长，应监测 D1 读取额度并定期备份、归档历史。关闭网页后不会产生该页面的自动轮询。

## 在本机测试 Cloudflare 版本

`npm run dev` 仍运行原 Node/SQLite 后端。要测试 Cloudflare 后端，请先执行 `npm run build`，复制 `.dev.vars.example` 为 `.dev.vars`，填入测试用 `VAULT_KEY` 和 `SETUP_TOKEN`，执行 `npm run cloudflare:db:local` 创建本地 D1 表，再执行 `npm run cloudflare:dev`。浏览器访问 `https://127.0.0.1:8788`，接受仅用于本地开发的自签名证书；`.dev.vars` 中的 `APP_ORIGIN` 必须与此地址一致。本地 D1 与远端库独立，测试时不能照搬生产私密数据到公开目录。自动化检查使用 `npm test`；其中 Cloudflare 运行环境测试会编译 Functions 并启动本地 workerd。
