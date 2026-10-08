# 首付款请求与后台到账证据

[实施、失败修复与限制](../../../plans/payment-initiation-2026-10-08.md)。最终新阶段R3全七模块verify成功，5真实JUnit（0失败/错误/跳过）、12Edge检查/65HTTP；另行原付款恢复回归6JUnit/10Edge/77HTTP通过。9项首付款合同及前序10恢复合同通过，type-check/相关ESLint/最终R2production build通过。

- [summary.json](./summary.json)：14相关源SHA256、两阶段状态和SQL数量、owned清理及限制。
- [browser-initiation.json](./browser-initiation.json)：25真实gateway响应/10检查；首次双击仅1POST、真实已受理INIT响应丢失、刷新后同键恢复、能力503、账户/关闭隔离。
- [browser-settled.json](./browser-settled.json)：4只读gateway响应/2检查；可信mock worker后后台PAID/GRANTED/SUCCEEDED及来源权益列表。
- [schema-report.json](./schema-report.json)：36后台+25首付款浏览器+4到账浏览器=65HTTP全部现有OpenAPI/no-store/requestId复核，0 checkout URL。
- [恢复回归浏览器](./recovery-regression-browser.json)、[恢复回归schema](./recovery-regression-schema.json)：10检查/77HTTP；11模拟checkout URL活响应验证后省略，不覆盖前序历史证据。
- [failure-history.json](./failure-history.json)：R1夹具环境enum错误及后续通过范围；原始失败证据留tmp。
- [桌面原金额/完整条款/未同意](./first-payment-confirmation-desktop.png)、[390px首付款INIT](./first-payment-init-mobile.png)、[后台授予后已购列表](./server-granted-library.png)：真实区域截图已查看。

浏览器阶段仍3订单/2支付/1权益/2CREATE_PAYMENT任务，预先到账的第二订单占1份权益；首payment保持INIT、原订单PENDING_PAYMENT/NONE，没有提前发放。仅测试内部可信provider事实+真实worker使首订单PAID/GRANTED、总权益2份，再由新浏览器只读确认。无付款码、UUID命令原文、令牌、基础设施凭据归档；保留服务端requestId。

auth/me模拟503，资金是mock；不是完整真实登录/扫码/资金、退款/对账、会员、真实手机/Safari或生产部署验收。资产是1字节隔离测试清单，未进行下载/内容商业品质验收。sessionStorage不是授权；现有无关特效草稿保留，正式发布仍需干净版本构建。
