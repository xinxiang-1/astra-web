# 原支付可信核查后台阶段证据

最终R4真实system/gateway/MySQL8.0.39随机库、自有Redis与持久化mock渠道；后端API阶段，没有新UI或浏览器证据。实施、失败与范围见[阶段记录](../../../plans/payment-verification-2026-10-09.md)。主库未迁移，真实商户/资金/正式认证与部署未验收。

- [summary.json](./summary.json)、[junit.json](./junit.json)：15核查集成＋4新配置＋6原配置＋11原支付实际回归＝36项，无失败/错误/跳过；构建与测试分别记录，不累计早期跑次。
- [http-evidence.json](./http-evidence.json)、[http-schema.json](./http-schema.json)：153份实际响应，59直连/94网关，四新操作和200/400/401/403/404/409/429/503；含建立原订单/支付的既有操作，各按其本身schema验证。结账链接在实际断言后脱敏，响应正文hash保留；请求凭证不入归档。
- [flow-http-evidence.json](./flow-http-evidence.json)、[flow-schema.json](./flow-schema.json)、[flow-evidence.json](./flow-evidence.json)：11项原支付回归、75份实际响应，含2份故意探测未发布模拟回调路径的401/404，按原操作或通用Error schema复核；3次自有JVM重启，真实并发/资金回滚/租约接管/调度器。原捕获的4个结账链接字段保持脱敏并排除URL校验，不把占位值当渠道地址验证；捕获没有完整响应头，不据此声称其头字段全部schema验证。
- [failure-history.json](./failure-history.json)：R1计数/spy错误、R2 HTTP409预期修正、R3后绑定损坏重试修复、第15项最终测试、证据脚本导入修复与回归捕获的拒绝路径/schema归类修复。早期XML/日志保留ignored tmp，归档仅安全摘要与原文件hash。
- [sql-analysis.json](./sql-analysis.json)：完整迁移集合22表；最终新核查实际执行的是基础17＋新核查18表组合。sqlglot对新DROP CHECK子句存在解析回退，不作为该子句完整静态校验；MySQL实际执行由新集成证明。
- [static-contract.json](./static-contract.json)、[document-links.json](./document-links.json)：OpenAPI/schema夹具、基础17表结构和本阶段链接，仅离线检查。
- [source-index.json](./source-index.json)、[artifact-manifest.json](./artifact-manifest.json)：实际验证后的源文件与Git规范化内容对应、原HTTP/报告字节摘要。JSON保留原字节，不把CRLF规范化误判为代码变化。

新核查调度器仅无操作mock，实际worker/SQL/权限/网关运行；超时/畸形金额/慢查询注入单列。Redis实际停止/重启，并有界轮询实际GET恢复；原支付使用自有库与命名空间，系统常驻Redis未停止。随机库与自有进程清理完成。用户package研究脚本、sandbox和Nacos配置保留，不入此提交。前端本阶段仅文档，没有声称重跑前端构建。

下一步双主题核查入口、退款异常查询。真实认证/支付SDK、会员、可复现部署/备份恢复及原六方向商业品质继续。
