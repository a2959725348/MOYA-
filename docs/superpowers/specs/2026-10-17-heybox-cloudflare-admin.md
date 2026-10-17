# 小黑盒后台 Cloudflare 迁移设计

用户在本会话明确批准：先迁移后台界面、配置、人工需求分析、草稿审核和日志，自动部署到现有工作台；仅在授权凭据不可用时告知手动步骤。之前关于前端融入与 Workers/D1 的设计已经在聊天中说明，本文件记录该批准范围，不再请求重复确认。

## 架构与范围

复用现有 React/Vite、Cloudflare Pages Functions、D1、工作台会话和 AI 密钥/预算。无需 Python、容器、云服务器、新域名、新 D1 表或 VAULT_KEY 变更。新后台替换默认的模拟控制台；旧需求与自愿咨询记录和分析入口保留。保留本地模拟源码供回滚，不提交运行数据或凭据。

后台以人工处理为唯一工作模式。不得添加小黑盒登录、自动读取、真实评论、关注、私信、营销发送或相关平台请求；任何界面审核通过均只写数据库。AI 分析只在明确点击时调用现有接口，沿用现有权限、去标识化校验、计费与请求上限。部署验证不调用付费真实模型，不在生产插入测试记录。

## 接口契约

所有新接口受已有工作台会话和同源写入检查保护。服务端共享实现放在 server/heybox-admin.mjs，Node 与 Cloudflare 路由均接入，方便本地真实验证。

GET /api/heybox/admin 返回：

```ts
type Config={revision:number;topicKeywords:string[];demandKeywords:string[];excludeKeywords:string[];replyTemplate:string}
type Review={id:string;demandId:string;sourceUpdatedAt:string;draft:string;status:'pending'|'approved'|'rejected';note:string;createdAt:string;updatedAt:string;stale:boolean}
type Log={id:string;at:string;action:string;label:string;targetId?:string}
type Admin={version:1;mode:'manual';config:Config;reviews:Review[];logs:Log[];capabilities:{platformConnected:false;autoRead:false;autoReply:false;follow:false;directMessage:false}}
```

PUT /api/heybox/config 请求 `{expectedRevision:number,config:{topicKeywords:string[],demandKeywords:string[],excludeKeywords:string[],replyTemplate:string}}`，返回 `{config:Config}`。revision 是乐观锁，陈旧写入 409。每组 1–40 项，每项 1–80 字（排除组可空），去除重复和首尾空白；模板 1–2000 字，仅允许 `{{问题}}`、`{{摘要}}`、`{{关键词}}`，禁止未知变量和明显邮箱/手机号/卡号。默认主题 ChatGPT/GPT/Plus；需求 如何订阅/支付失败/求教程/订阅；排除 已经解决/不需要/广告；默认模板为 `关于“{{关键词}}”，建议先核对官方订阅说明和具体错误信息。{{摘要}}`。

POST /api/heybox/reviews 请求 `{demandId,sourceUpdatedAt,draft,expectedUpdatedAt:string|null}`，返回 `{review:Review}`。使用 demandId 作为记录 ID，每个需求仅一份当前草稿。新建 expectedUpdatedAt=null；覆盖已有草稿必须匹配其 updatedAt。草稿 1–2000 字，去标识化校验，保存即 pending。来源必须存在、sourceUpdatedAt 必须与需求 updatedAt 相同。最多 200 份草稿，达到上限明确 413，不静默删除历史。

PATCH /api/heybox/reviews/:id 请求 `{expectedUpdatedAt,status:'pending'|'approved'|'rejected',draft?:string,note?:string}`，返回 `{review:Review}`。note <=1000 字且无明显个人信息；修改草稿只能以 pending 保存，不能同时修改并批准。批准时来源必须仍存在且版本一致；陈旧、删除或重新分析后旧草稿不能批准。其他编辑均检查审核记录乐观锁。updatedAt 单调递增，避免同毫秒版本相等。

配置存于现有 kv，审核存于 records 的独立 heyboxReviews 集合（不加入通用 CRUD 白名单），日志存于 kv，仅保留最近 300 条。日志由服务端生成，允许类型 config_saved、demand_saved、demands_imported、demand_deleted、analysis_completed、draft_saved、review_approved、review_rejected、review_reset；记录固定中文标签、时间与目标 ID，不保存原文、草稿、密钥或模型原始响应。不开放任意日志写入接口。

现有需求录入、导入、修改、删除及分析成功时一并追加日志；维持原有接口行为与并发保护。审核数据不并入旧需求 schema，避免旧备份与原文更新被破坏。新模块 GET 返回的 stale 由当前来源版本计算，不信任客户端。

## 页面

新组件 HeyboxAdmin 保持工作台侧栏和登录，局部深色橙色强调，借鉴 heybox-bot-web 的任务、统计、日志布局。标签：总览、任务配置、人工需求、草稿审核、操作日志。总览统计只来自真实保存数据，平台状态明确“未接入”；无模拟 A-D 用户或虚假发送数。

人工需求复用原 DemandRecords（包含自愿咨询），明确 AI 按钮会调用当前模型。配置写入云端并能刷新/换设备读取，冲突提示重新读取，未保存草稿不被后台刷新覆盖。关键词仅对人工导入原文进行字面预筛选：主题与需求两组 AND，组内 OR，排除优先，命中不代表真实意愿。

审核页从现有需求选择来源，显示原文、AI 判断依据（有则显示）、可编辑草稿、来源版本；支持采用 AI 草稿、按已保存模板填入、保存待审核、批准、退回。模板本地渲染后仍由服务端校验；页面明确“批准不发送”。原文变化使已保存审核显示过期并阻止批准。

日志可筛选类型与搜索标签/目标 ID，显示加载失败与空状态，不轮询刷写数据库。演示模式可浏览静态空态，不自动写入或调用 AI。320/390/768/1440 宽无页面横向溢出，按钮易于触摸，错误提示可见。

## 发布与验证

使用现有 GitHub a2959725348/MOYA- main 与 Cloudflare Pages moya，保持生产 DB 和所有 secrets。用户已批准这次 push/发布，不再要求最终发布确认。先完成本地 Node/Miniflare 的鉴权、持久化、冲突、审核失效测试和浏览器 UI 检查，再 build 与函数打包。优先既有可用部署凭据，避免要求用户重复登录；若不可用保留已测试提交和无敏感文件的源码 ZIP，明确给出唯一必要的推送/授权步骤，继续验证可访问的线上资源。
