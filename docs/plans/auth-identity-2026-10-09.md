# 登录身份隔离与迟到响应防护

2026-10-09。此阶段保护账户切换、退出和页面切换时的身份一致性。业务权限仍由后台核验，不新增浏览器会员或购买标记。

## 问题与实施

在 ec5ff9964a7798e009fd8de55a03cb2261304530 的真实浏览器 Pinia 中复现：A 的恢复请求迟到后会将新 B 的用户展示改为 A；旧 401 或退出请求迟到会清掉 B，且退出未立即清理本地身份。原报告保留在[证据目录](../validation/2026-10-09/auth-identity/README.md)。

Store 为身份请求记录代次、令牌快照和独立取消控制器；迟到结果、错误提示及旧 pending 收尾均不能改变新请求。五种取得令牌的入口共用保护。后台恢复不覆盖正在进行的显式登录；跨标签令牌发生变化时，读当前 localStorage 值并重新恢复，旧用户立即清空。

退出同步清理本地身份，再通过显式 Authorization 撤销捕获的原令牌。HTTP 保留显式头，避免此请求撤销另一身份。当前令牌的 401 仍清理；503、网关故障、网络和超时保留恢复能力。请求使用 no-store。

App 在子页面挂载前启动恢复，监听令牌写入和 localStorage.clear()，卸载时解除监听。AuthView 切换表单、标签或离开时取消请求；微信 mock 创建、轮询和确认核对控制器与身份代次，迟到确认不接管身份或导航。微信流程依旧为 mock，不能称作真实微信 OAuth。

## 验证与失败记录

- Edge 与 Chrome 各 18 个真实浏览器 Store/API/HTTP 延迟响应合同：旧恢复成功/HTTP 401/业务 401、旧退出成功/失败、五入口最新登录与取消、pending 所有权、并发恢复、背景恢复与跨标签令牌变化。
- 两浏览器各 3 个生产 App/AuthView 合同：切换标签取消登录与导航、离开微信取消轮询/拒绝迟到确认、真实 storage 事件跨标签写入及 clear 后退出。
- HTTP 合同 8 请求、既有恢复合同 7 场景通过。产品 type-check、相关 ESLint、生产 build 通过，保留已有大 chunk 和无效动态导入警告。
- 基线 R1 使用 SSR，Element Plus 消息依赖 document，未取得有效退出报告；R2 硬编码 Pinia 优化 URL，缺少 Vite 查询版本；R3 改为读取实际转换后的模块 URL，才有效复现。新合同 R1 使用已停止的 5210 服务而失败；恢复服务后 R2 通过。保留失败日志，不把脚本启动失败写成产品缺陷。

本阶段 UI 接口为受控响应，未实际发短信、邮箱或 OAuth，也没有实付、主库迁移或会员验收。后台 CommerceTokenFilter 已校验账户可用状态，EntitlementService 校验订单/原支付/退款来源；本阶段后台只补文档。下阶段继续真实认证、付费内容与产品流程品质。

运行：开发服务设置 ASTRA_PREVIEW_URL 后执行 `node scripts/auth-identity-contract.mjs`；生产预览执行 `node scripts/auth-identity-ui.mjs`。ASTRA_BROWSER_CHANNEL 可指定 msedge/chrome，原结果与源码绑定见证据。
