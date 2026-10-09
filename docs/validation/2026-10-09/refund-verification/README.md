# 原退款可信核查后台证据

来自最终隔离真实system/gateway/MySQL/自有Redis＋持久化mock。新调度器仅无操作mock，worker/SQL/权限/事务真实；JWT/账户为fixture，不是正式认证或真实资金/部署。实施与失败/边界见[阶段记录](../../../plans/refund-verification-2026-10-09.md)。

- [summary.json](./summary.json)、[junit.json](./junit.json)：最终原退款核查、实际配置及普通退款消费者回归，各跑次分开，不累计旧R2或其他阶段。
- [http-evidence.json](./http-evidence.json)、[http-schema.json](./http-schema.json)：原始HTTP字节，直连/网关与四新操作、200/400/401/403/404/409/429/503，逐份按各自API schema校验；付款fixture的checkout URL经现场校验后省略，完整原body hash仍保留。
- [失败和迭代](./failure-history.json)：R1默认Redis路径失效；R2通过后的不可变绑定与实际开关补充，未冒充修复前通过。
- [SQL和合同差异](./sql-analysis.json)、[离线合同](./static-contract.json)：新CREATE TABLE AST、23表集合及实际隔离执行；旧定义保持。离线基础SQL合同仍仅17表AST，ALTER CHECK解析回退和生产迁移不作已验收。
- [源码/index](./source-index.json)、[文档链接](./document-links.json)、[归档摘要](./artifact-manifest.json)：验证后的源/Git规范化内容、本地链接、两仓库证据原字节；不归档XML环境属性或私有渠道信息。

畸形金额/父支付/时间、超时/慢响应及绑定变化明确注入；Redis故障/恢复、角色表不可用、审计/命令/资金事件事务故障为真实隔离操作。普通执行任务在fixture中标记耗尽，核查只query原号，可信事实只写一次资金与原来源撤权。主库/常驻Redis未变更，本阶段前端只文档，无新退款核查页面/浏览器证据。用户研究/配置及免费导出、受保护首页/hover保持。
