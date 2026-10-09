# 真实登录、购买与工作流前端证据

2026-10-10。见[阶段记录](../../../plans/auth-commerce-2026-10-10.md)与[运行合同](../../../../../astra-cloud/docs/commerce/auth-commerce-runtime.md)。

- [汇总](./summary.json)、[唯一JUnit摘要](./junit-summary.json)：94通过，一个目录浏览器条件跳过；不是重复运行累计。
- [Edge真实认证](./auth-msedge/report.json)、[Chrome真实认证](./auth-chrome/report.json)、[390×844触控模拟](./auth-mobile/report.json)，各12检查。各目录两张明暗作品库截图，共六张已检查。
- 原auth/me503基线交付回归：[Edge](./baseline-delivery-msedge/report.json)、[Chrome](./baseline-delivery-chrome/report.json)、[触控](./baseline-delivery-mobile/report.json)，各12；它们不作为真实身份验收。
- [索引12项](./creative-index-report.json)、[工作流核心21项](./package-core-report.json)、[生产离线导入9项](./package-ui-report.json)。重复导入保留原文件、名称、缩略图与时间，缺失原作仍可恢复。
- [后台实际响应/资源清理](../../../../../astra-cloud/docs/validation/2026-10-10/auth-commerce/README.md)、[失败历史](./failure-history.json)、[源码hash](./source-manifest.json)、[产物hash](./build-artifacts.json)、[来源索引](./source-index.json)、[文档链接](./document-links.json)。

真实auth/gateway/system响应通过route.fetch运输，只有隔离商户账本模拟。工程样例不是收费SKU；外部SMTP、真实资金、会员、设备/审美和部署继续。OTP、密码、JWT、票据查询和原始日志不归档。
