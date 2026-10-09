# 邮箱注册前端验证证据

2026-10-10，详见[阶段记录](../../../plans/email-registration-2026-10-10.md)与[运行合同](../../../../../astra-cloud/docs/auth/email-registration-runtime.md)。

- [汇总](./summary.json)、[JUnit摘要](./junit-summary.json)、[受控Store身份合同](./identity-report.json)。
- [Edge](./msedge/report.json)、[Chrome](./chrome/report.json)、[触控模拟](./mobile/report.json)各7检查，实际API运输，无成功响应替换。
- 六张register-light/register-dark截图位于上述浏览器目录。OTP未输入，密码遮挡；桌面与390px明暗截图已查看。
- [首轮失败](./failures/first-edge-report.json)、[失败历史](./failure-history.json)保留，首轮资源清理通过。
- [后台实际HTTP与清理报告](../../../../../astra-cloud/docs/validation/2026-10-10/email-registration/integration-report.json)。
- [源码hash](./source-manifest.json)、[本地构建产物hash](./build-artifacts.json)、[来源索引](./source-index.json)、[文档链接检查](./document-links.json)。

日志/证书/SMTP原文/Token不归档。真实TLS受控收件器不代表外部邮件送达，触控模拟不代表真机，会员、真实资金及部署未验。
