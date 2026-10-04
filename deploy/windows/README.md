# Windows Server 2025 部署

目标服务器：杭州，120.26.193.194。域名 moyaiwork.com 尚未备案，当前只安装服务器本机服务；域名、公开端口和 HTTPS 另行接入。此文档和安装包不包含服务器登录密码、本机 `.env`、数据库或 AI 密钥。

## 上传与安装

上传 `personal-workbench-windows-offline.zip` 到服务器 `C:\Deploy`，在服务器管理员 PowerShell 中执行：

```powershell
Expand-Archive -LiteralPath 'C:\Deploy\personal-workbench-windows-offline.zip' -DestinationPath 'C:\Deploy\workbench-20261003'
& 'C:\Deploy\workbench-20261003\personal-workbench\deploy\windows\Install.ps1'
```

如果执行策略阻止脚本，用以下命令启动安装脚本，仅对这个 PowerShell 进程生效：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\Deploy\workbench-20261003\personal-workbench\deploy\windows\Install.ps1'
```

普通 `personal-workbench-windows.zip` 不带 Node 和依赖，安装时会下载官方 Node.js 24 并校验 SHA256，执行 npm ci。离线包已包含这两项，更适合服务器外网下载受限时使用。

应用安装到 `C:\Apps\PersonalWorkbench`。`PersonalWorkbench-App` 计划任务开机启动；退出后每分钟重试。Node 仅监听 `127.0.0.1:4318`，安装脚本不会放开防火墙或安全组端口，也不会改变 DNS。

## 验证与状态

```powershell
& 'C:\Apps\PersonalWorkbench\scripts\Status.ps1'
Invoke-RestMethod 'http://127.0.0.1:4318/health'
Invoke-RestMethod 'http://127.0.0.1:4318/api/auth/status'
```

`/health` 应返回 `ok: true`，`/api/auth/status` 应返回 JSON。`/api/health` 需要网站登录会话，不能用于匿名健康检查。新安装没有网站账号；迁移后应显示 `configured: true`。Windows 登录密码、阿里云账号密码和工作台密码是不同的凭据。

本机阶段只能在服务器内访问，不能在自己电脑上访问 `http://120.26.193.194:4318`。这不是安装失败。

## 数据迁移

程序更新保留安装目录的 `.env` 和 `data`。迁移现有账号、设置和密钥，需要一致性备份 `workbench.sqlite`，并成对迁移 `vault.key`。使用 SQLite backup API 制作正在运行数据库的备份，不要单独复制活动数据库而遗漏 WAL。

数据迁移包是私人文件，另行通过加密管理通道上传，不放在公开下载链接、代码仓库或程序包中。首次迁移前停止 `PersonalWorkbench-App`，备份服务器已有 data，再恢复数据库及 vault.key，然后启动任务。不要覆盖已有服务器数据库。

## 后续更新

本地项目修改并验证后，执行：

```powershell
& '.\deploy\windows\Package.ps1' -Offline
```

每次将新包解压到新的 `C:\Deploy\workbench-日期` 文件夹，在服务器重新运行新包内的 `Install.ps1`。它创建新的 releases 目录、保留账号和配置、切换活动程序并重启原任务。`deployment.json` 保存上一程序目录，旧 releases 保留用于排查和手动回退；更新前仍应备份数据。

## 备案后域名接入

备案通过后，检查安全组和服务器 80/443 端口，配置官方 Caddy Windows 版本及其后台任务。将 `.env` 的 `APP_ORIGIN` 改为 `https://moyaiwork.com`，保留 `HOST=127.0.0.1`、`PORT=4318`、现有 `SETUP_TOKEN` 和 `DATA_DIR`。Caddy 配置参考同目录的 `Caddyfile.example`，反向代理保留原始 Host。

确认服务器 HTTPS 证书和接口正常后，再调整 Cloudflare DNS/原 Pages 自定义域名绑定。服务器设置完成前不要先切 DNS。域名公开后，本机同步助手的 `WORKBENCH_URL` 改成 `https://moyaiwork.com`，助手继续在已登录 Codex 的个人电脑上运行。

当前文件准备和本地测试不等于已完成服务器安装；需以服务器上的任务状态、真实健康响应及账号验证结果为准。
