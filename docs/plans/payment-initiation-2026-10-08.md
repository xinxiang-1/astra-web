# 首付款请求与后台到账联调

2026-10-08，接续[购买确认/原订单恢复](./order-confirmation-2026-10-08.md)与[原付款记录恢复](./order-recovery-2026-10-08.md)。本阶段接通无付款记录订单的明确确认、首付款请求持久化与恢复，并实际验证后台可信模拟到账后的权益展示。真实资金、退款、会员及部署目标继续。

## 实施

后台capabilities新增mockPaymentInitiationEnabled，仅在development/test、commerce-mock profile、enabled=true、provider=mock同时满足时为true；production及禁用配置为false。此字段只表示能创建模拟付款账本，不代表真实收款或可用扫码会话。paymentEnabled/mockPayment/creationKitReady原有三个完整能力标志保持false，现有orderCreationEnabled门槛保持。DTO、OpenAPI及示例同步。

`/account/orders/:orderId`从后台原订单和capabilities读取信息。只有本人PENDING_PAYMENT、没有paymentId且后台允许模拟首付款时，显示“核对模拟付款请求”。再次显示原金额、订单号及三份冻结条款全文，初始同意未勾选；关闭核对、刷新、换订单/账户、离页取消均清除同意。能力读取失败只关闭首付款入口，原订单仍能查看，不清令牌。已付款、后台关闭或已存在paymentId不提供首付款确认；既有记录继续独立恢复。

第一次POST之前，将UUIDv4存入与既有付款恢复**同一**sessionStorage命名空间，按令牌SHA256和订单隔离，只保存UUID。POST只发送channel=wechat_native，不提交金额、订单状态或权益。存储失败或损坏标识阻止首付款写入，不生成替代请求。请求受理后响应丢失，用户先刷新原订单；后台若已有paymentId，再用原标识恢复原记录。无自动写入重试；重复确认沿用同键，后端固定payment/order绑定和唯一约束仍是权威，token变化后的新作用域也不能创建第二付款。

响应校验绑定原orderId、字符串BIGINT paymentId、原CNY整数分金额、渠道和mock标志，丢弃所有checkout URL。成功仅提示“已核对模拟付款记录”，重新GET后台订单/付款；INIT/PENDING/UNKNOWN不当作已付款或已授予。客户端时间不决定到期/关闭，后台43005要求刷新原单。401清私有视图并提供安全登录返回；404不泄露其他账户。跨标签页storage事件、令牌前后比较和AbortSignal阻止旧身份结果显示。

## 验证与失败记录

最终R3全七模块verify成功，5项真实JUnit（0失败/错误/跳过）、12项Edge检查和65条实际HTTP全部OpenAPI/no-store/requestId复核通过；9项首付款边界合同及前序10付款恢复合同通过。type-check、相关ESLint、最终R2production build通过；首页三保护源无差异。

隔离MySQL/Redis/system/gateway中，浏览器阶段始终3订单/2payment/1entitlement/2CREATE_PAYMENT任务：已有第二订单被可信模拟到账，其1份权益是预先建立；首付款双击只一个实际POST，真实已受理INIT响应被丢弃，刷新不自动写入，再双击恢复只有一个同键POST。原订单保持PENDING_PAYMENT/NONE、首payment保持INIT，绝不增加第二订单/支付/提前权益。4个并发首付款请求同键只1payment/1任务；禁用后新付款503但原键恢复保留；关闭订单409、身份隔离及篡改金额拒绝均覆盖直连和gateway。

随后仅由测试内部可信provider事实及真实worker执行创建/查询、后台原子入账，首订单才变PAID/GRANTED、payment=SUCCEEDED，总权益2份。第二个新浏览器上下文只读真实订单及权益列表，确认首付款来源订单已在后台已购列表中，成功后没有首付款/恢复按钮；没有运行下载或导入。这是可信mock技术链路，不是真实商户资金验收。

原付款恢复流程在当前产品代码上独立回归：6JUnit、10浏览器、77HTTP全部复核，通过真实Redis断开503与恢复、已有记录关收款/过期恢复、目录改名/下架快照、账户跨标签页切换。因订单页新增capabilities GET，同步既有证据验证器识别此公开路由；未修改历史归档。回归11个模拟checkout URL在活响应校验后省略，首付款阶段0 URL；命令UUID/令牌不归档。

新联调R1的5JUnit/12浏览器运行通过，但外部schema失败：测试手动把环境设为合同未支持的staging并捕获。修复夹具只验证合同支持的production，没有放宽schema；R2全部通过，R3再增加首付款双击检查保持通过。原始失败证据留tmp，不用R1宣称合同通过。先前预览进程/旧工具句柄已不存在，核对构建成功和端口空闲后重启本次preview；最终构建终态exit0已观察。三份[成功截图与证据](../validation/2026-10-08/payment-initiation/README.md)已查看，独占schema/Redis/gateway均清理。

## 限制与下一步

auth/me明确模拟503，JWT来自隔离夹具，不是完整登录验收。没有真实微信/支付宝SDK、Native QR/H5会话、商户资金、退款消费者/对账、会员、真机/Safari或正式部署验收。资产是专用1字节影子测试内容，未下载、不当可销售素材。当前工作区保留其他未提交特效，正式发布仍需明确Git提交干净构建。

sessionStorage只在当前标签页会话有效，关闭后从我的订单恢复固定付款；令牌刷新换作用域仍以后端原固定支付为准。GET只查后台账本，不主动查询外部渠道；后续渠道刷新/退款与对账仍需独立实现和真实验收，不把页面刷新称渠道查单。

下一步后端退款消费者/对账及用户退款处理流程、真实支付/登录适配、会员/额度账本，继续产品样例与设备品质，按[从零上线办理清单](../../../astra-cloud/docs/plans/launch-readiness-2026-10-08.md)与[90天推广方案](./growth-playbook-2026-10-08.md)推进。现在不要求先买服务器或办理全套商户。

复跑`node scripts/payment-initiation-contract.mjs`与`node scripts/payment-recovery-contract.mjs`；真实运行见[后端阶段](../../../astra-cloud/docs/plans/payment-initiation-2026-10-08.md)。
