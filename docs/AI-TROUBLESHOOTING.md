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
