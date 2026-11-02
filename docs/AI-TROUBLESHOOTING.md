# 学习助手 502 定位

Functions 日志中的 outcome=ok 表示调用执行完成，不能替代 event.response.status。捕获的异常不会自动出现在 exceptions 数组中。

本版对学习助手失败记录一条 study_chat_failure 事件。仅包含固定 stage、reason 与可选数字 upstreamStatus；不记录原始异常、请求头、密钥、接口 URL、聊天内容或供应商响应正文。

- configuration_or_reservation / configuration_prepare：配置加载或数据库事务阶段。
- secret_decrypt：加密密钥初始化或保存的 API 凭据解密失败。先核对现有 VAULT_KEY 与保存凭据的来源，不随机重置 VAULT_KEY。
- upstream_connect + upstream_http：模型服务返回非成功状态，参考 upstreamStatus 核对供应商的认证、模型、参数、余额或限流。
- upstream_connect + network_or_endpoint：网络连接或接口地址校验失败。
- save_user_message：已取得上游响应，但用户消息保存失败。
- stream_read / save_assistant_message：开始流后读取或最终保存失败。
- aborted：请求取消或达到已有 60 秒超时。

查阅：Workers 和 Pages → moya → 当前生产部署 Details → Functions，开启实时日志后再发一次问题。只分享 study_chat_failure 事件；不要复制整个 event.request。

这些日志用于缩小错误范围，不代表已经修复 502。运行日志不保留历史，因此代码发布成功后需重新开启该部署的日志流，再重现问题。

## 设置无法保存

PUT /api/settings 的服务端内部错误记录 settings_save_failure，只含阶段、固定分类错误名称和允许的系统错误码，不含原始错误文本或提交的密钥。页面返回 SETTINGS_SAVE_FAILED 和可读的阶段提示。

- vault_init：服务端加密配置初始化。
- settings_encrypt：新增或替换 API 密钥的加密操作。
- settings_prepare_response：准备返回的设置快照。
- settings_commit：提交数据库事务。
- settings_load_or_commit_retry：并发冲突后的重新读取或提交。
- database_load / request_body / environment：在设置处理之前的读取或环境阶段。

验证范围：在正常加密环境中，替换无法解密的单个凭据可恢复；这一结论不覆盖线上加密写入或数据库本身失败。出现无法保存时，应查看该事件再决定修复，不反复更换 API Key，也不随机生成或轮换全局 VAULT_KEY。

## 2026-11-02 加密兼容修复

使用固定虚拟数据的生产自检 /health?check=crypto 确认：旧版 Vault 加密返回 not_implemented，解密跳过；原生 Web Crypto 返回 ok。本地当前版本的 workerd 能运行 Node cipher，不等同于生产构建提供的兼容实现。

Cloudflare Vault 已改用原生 crypto.subtle AES-GCM，读写方法现在为异步。使用原 VAULT_KEY、96 位随机 IV、128 位认证标签；保留 Base64 的 iv、tag、data 三字段，不迁移或覆盖旧凭据。原 Node/SQLite Vault 不变。余额和行情适配器兼容同步与异步密钥读取，学习与需求分析已等待解密完成。

回归测试覆盖：在 Node cipher 导出全部为未实现占位函数的 Worker 中仍完成加解密；本地旧密文读取；新密文由本地 Node Vault 读取；不同 IV；错误密钥和认证标签篡改拒绝。没有明文回退。

/health 默认响应不变；check=crypto 的自检只使用公共固定测试向量和临时内存，不接触环境密钥或数据库。加密修复发布后应看到 encrypt、decrypt、webCrypto 均为 ok。真实用户凭据仍需通过设置保存或学习请求验证。
