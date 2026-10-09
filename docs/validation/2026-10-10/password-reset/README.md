# 邮箱找回与会话撤销前端证据

2026-10-10，见[阶段记录](../../../plans/password-reset-2026-10-10.md)与[运行合同](../../../../../astra-cloud/docs/auth/password-reset-runtime.md)。

- [汇总](./summary.json)、[JUnit摘要](./junit-summary.json)、[受控Store身份23项](./identity-report.json)。
- [Edge重置](./reset-msedge/report.json)、[Chrome重置](./reset-chrome/report.json)、[触控模拟重置](./reset-mobile/report.json)各6项，六张明暗reset截图与报告同目录；截图时验证码/密码为空。
- [Edge注册回归](./msedge/report.json)、[Chrome注册回归](./chrome/report.json)、[触控注册回归](./mobile/report.json)各7项。通过route.fetch运输到真实服务，无成功API替换。
- [首次页面失败](./failures/reset-edge-r2.json)、[失败历史](./failure-history.json)保留；该轮后台12项通过且自有资源清理完成。
- [后台实际HTTP与清理](../../../../../astra-cloud/docs/validation/2026-10-10/password-reset/integration-report.json)。
- [源码hash](./source-manifest.json)、[产物hash](./build-artifacts.json)、[来源索引](./source-index.json)、[本地文档链接](./document-links.json)、[OpenAPI结构](./openapi-check.json)。

OTP、Token、密码、证书与SMTP原文不归档。外部邮件、真实手机/资金、完整购买与部署尚未验证。
