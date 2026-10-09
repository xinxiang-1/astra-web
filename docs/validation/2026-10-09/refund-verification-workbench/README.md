# 原退款核查工作台最终证据

仅最终R2：已构建前端＋实际system/gateway/MySQL8.0.39完整23商业表随机库、自有Redis和持久化mock。auth/me模拟503、JWT/角色为fixture；不是正式认证、真实资金或生产部署。[阶段记录](../../../plans/refund-verification-workbench-2026-10-09.md)说明实施/失败/边界。

- [汇总](./summary.json)、[JUnit](./junit.json)：34JUnit、20浏览器、48相关命令合同、类型/ESLint与前后端构建；不累加R1或上一阶段12原退款worker。
- [实际HTTP](./http-evidence.json)、[schema逐份校验](./http-schema.json)、[浏览器报告](./verification-ui/browser-report.json)：235后台＋37浏览器响应，共272；四操作与直连/网关、200/400/401/403/404/409/429/503覆盖。注入故障与auth模拟单列，HTTP单文件未验证UI的范围由同运行附加浏览器证据补充。
- [Edge浅色桌面](./verification-ui/refund-verification-edge-light-desktop.png)、[Edge深色桌面](./verification-ui/refund-verification-edge-dark-desktop.png)、[浅色表单](./verification-ui/refund-verification-edge-light-form.png)、[深色表单](./verification-ui/refund-verification-edge-dark-form.png)、[Edge浅色手机](./verification-ui/refund-verification-edge-light-mobile.png)、[Edge深色手机](./verification-ui/refund-verification-edge-dark-mobile.png)、[Chrome浅色手机](./verification-ui/refund-verification-chrome-light-mobile.png)、[Chrome深色手机](./verification-ui/refund-verification-chrome-dark-mobile.png)：最终8截图已人工检查，不替代真机与真实用户审美。
- [失败记录](./failure-history.json)：R1漏切列表筛选、首次对账脚本文件名错误和修复；未把失败跑次累加为通过。
- [离线合同](./static-contract.json)、[文档链接](./document-links.json)、[源码/index](./source-index.json)、[文件摘要](./artifact-manifest.json)：静态合同、实际最终源/构建/截图hash与Git规范化源核对，JSON原字节保留；原始XML的环境属性、Token和checkout不归档。

21先前＋4新查询均真实API/worker，25VERIFY_REFUND命令/审计，不代表全部商业命令。目标成功退款事件仅一条，其他来源权益未变，未批准退款无核查，矛盾结果8次停止。fixture为合资格实际账单调整原交易/mock有效时间，普通退款任务标记耗尽；真实资金/认证、会员、部署和原六方向品质继续。结束清理隔离服务/库及自有预览，主库与常驻服务不受影响。
