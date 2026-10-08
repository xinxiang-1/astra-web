# Astra

2026-10-08最新：[首次管理员受控部署工具](./docs/plans/admin-bootstrap-2026-10-08.md)已实现只读检查/计划、身份核对、原子角色+审计+命令及同计划恢复；8JUnit/69CLI/8实际HTTP通过，最小DB权限与事务失败回滚实测。主库/生产角色未执行；每日对账、真实渠道/登录、会员/品质与部署继续，以下此前阶段保留历史范围。

2026-10-08最新：[管理员退款工作台与原订单核对](./docs/plans/admin-refunds-2026-10-08.md)已接后台角色发现、原订单/条款/领取/审核/任务上下文、版本审批及原键恢复；批准仍等待可信渠道结果。验证与失败范围见阶段证据。首位角色部署工具、每日对账、真实渠道/登录、会员/品质与正式部署继续；以下此前阶段描述保留历史范围。

2026-10-08最新：[本人退款申请与后台审批联调](./docs/plans/refund-application-2026-10-08.md)已接原因/全额申请和后台审核说明，服务端角色、原支付、单退款号、版本/幂等及审计原子提交；真实受理后响应丢失同键恢复、批准后可信mock退款撤权已联调。11新JUnit/10浏览器/137HTTP及16相关退款回归通过。管理员工作台/原订单领取上下文、每日对账、真实资金/会员/品质与部署继续；下文此前阶段描述保留历史范围。

2026-10-08接续：[后台全额退款执行与来源撤权](./docs/plans/refund-worker-2026-10-08.md)接通现有晚付退款队列，独立默认关闭，接受后超时/完整JVM崩溃按原号查询恢复，成功资金与来源权益原子提交；旧下载票据失效。最终验证/失败/范围见阶段证据。本人申请、管理员审批审计、每日对账、真实资金/会员/部署仍继续；以下此前阶段描述保留历史范围。

2026-10-08最新接续：[首付款请求与后台到账联调](./docs/plans/payment-initiation-2026-10-08.md)新增后台显式mock首付款能力、原金额/完整冻结条款确认及持久化原键；首付款双击/受理丢响应不多支付，只有可信后台worker到账才授予。新阶段5JUnit/12浏览器/65HTTP与原恢复回归6JUnit/10浏览器/77HTTP通过。前序[购买确认](./docs/plans/order-confirmation-2026-10-08.md)、[订单详情/付款恢复](./docs/plans/order-recovery-2026-10-08.md)保留；真实资金/扫码、退款/会员/部署继续，免费创作不变。

2026-10-08最新接续：[产品打磨、前后端商业联调、服务端付费/会员边界及部署办理清单](../astra-cloud/docs/plans/launch-readiness-2026-10-08.md)、[90天推广方案](./docs/plans/growth-playbook-2026-10-08.md)。用户从零逐步推进，当前优先品质与联调，真实收款和会员尚未开放。

2026-10-04名字画接续：[字体与安全保存](./docs/plans/signature-font-bank-iteration-2026-10-04.md)已接入授权本地行楷/草书、完整长名字渲染和失败保留原库；修复镂空Canvas/SVG差异。夜光/自然布局/真实手写商业画质继续验收，整体目标保持进行。

本地优先的创意工具站，外加可嵌入网页的实时视觉。当前统一编辑器提供六模式、可选图片品质、六种微动与九种悬停、全屏预览和免费PNG/TXT/视频/离线HTML；完整 `.astra` 作品包可携带源素材和设置，在新浏览器导入恢复。

艺术交互已接入原生Studio持久场：流体拖尾/水面/丝绸/漩涡等共用六模式、品质档和离线输出；后续特效在此底座创新，遵循[Studio标准](./docs/plans/studio-effects-standard.md)，实际步骤与验证见[悬停对齐记录](./docs/plans/hover-parity-iteration-2026-10-02.md)。首页主图原Studio效果保持。

本轮前后端交付范围、验证证据和后续任务见 [阶段交付记录](./docs/plans/stage-delivery-2026-10-01.md)。[产品总计划](./docs/plans/product-master-plan.md)持续跟踪模板包、新增付费创作和定制服务；订单与模拟支付后端已有技术验收，真实交易、前端购买、公测和正式部署仍待完成。首页原Studio参数保留，原创Logo位于 `public/brand/`。

商业开发依据：[商品与付费创作PRD](./docs/plans/prd-commerce.md)、[商业合同执行记录](./docs/plans/commerce-contract-iteration-2026-10-02.md)；后端目录/鉴权及订单创建/查询、快照/幂等/安全到期已真实联调，见[订单接续阶段](./docs/plans/commerce-orders-iteration-2026-10-02.md)。真实渠道、前端购买流程及批量工作台尚未实现，production新建订单与真实收款关闭，当前免费能力保持。

后端[支付适配](./docs/plans/payment-provider-iteration-2026-10-02.md)及[支付接口/任务恢复/原子入账](./docs/plans/payment-flow-iteration-2026-10-02.md)已实现，67JUnit/25真实集成、268HTTP/260schema通过，含完整JVM重启与来源权益回滚恢复。私有交付已接账户领取；真实SDK、退款消费者及前端完整购买流程仍待完成，技术模拟不当收款，production新建和支付继续关闭。

每完成一个可验收小阶段，记录步骤/失败/检查后单独提交并立即推送，官方MCP核验远端SHA。提交推送使用用户指定的GitHub MCP连接账户 `xinxiang-1`。先核验账户与目标仓库权限；浏览器登录和本地Git凭证不替代MCP授权。

- **主产品**：字符画（图片本地转铺字 / 彩色字符画）
- **工作室**：Prism、黑洞、流体、彩烟（WebGPU / WebGL 展示与定制样板）
- **配件**：本地文件预览（Office / PDF）

站点风格与功能分类规划见 [`docs/plans/site-architecture.md`](./docs/plans/site-architecture.md)。

## 本地开发

```sh
npm install
npm run dev
```

### 构建

```sh
npm run build
```

### Lint

```sh
npm run lint
```

## 推荐环境

| 项 | 要求 |
|----|------|
| IDE | [VS Code](https://code.visualstudio.com/) / Cursor + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) |
| Node | `package.json` → `engines`（`^22.18.0 \|\| >=24.12.0`） |
| 浏览器 | 特效页建议较新的 Chromium（WebGPU） |
| 后端联调 | 同级仓库 [astra-cloud](https://github.com/xinxiang-1/astra-cloud)：**JDK 21**、**Nacos Server 3.0.3**、MySQL 8、Redis 7；详见该仓库 README「环境要求」 |

登录页（`/login`）经 Vite 代理 `/api` → 网关 `http://127.0.0.1:8080`，需先按后端文档启动 Nacos + Auth + Gateway。

## 路由一览

| 路径 | 分类 | 说明 |
|------|------|------|
| `/` | 落地 | 品牌首屏 + 工具 / 工作室入口 |
| `/tools` | 工具 | 工具目录 |
| `/ascii-art` | 工具 | 字符画 ★：灰度 / 铺字、悬停与微动预览、下载动效网页 |
| `/ascii-live` | 工具 | 大理石胸像动态字符实验（Studio 悬停） |
| `/signature-portrait` | 工具 | 签名画像（试验）：手写章按明暗拼接；规划见 `docs/plans/signature-portrait.md` |
| `/file-upload` | 工具 | 文件上传预览 |
| `/studio` | 工作室 | 特效目录 |
| `/prism` 等 | 工作室 | 各特效沉浸页 |
| `/login` 等 | 账户 | 邮箱验证码 / 密码登录（依赖 astra-cloud 网关） |

Studio指针创新原型：[流体撕裂与回弹对照](./docs/prototypes/v7-studio-rift/index.html)，开发服务下访问 `/docs/prototypes/v7-studio-rift/index.html`。原生拖尾与候选同素材/事件序列同步，支持六模式、适用品质、全屏/减少动效/触控；仅为实验候选，尚未接入正式编辑器或项目/输出。步骤与实际失败/限制见[工程记录](./docs/plans/studio-rift-prototype-2026-10-03.md)，长期要求见[Studio标准](./docs/plans/studio-effects-standard.md)。

接续原型：[v8撕裂打磨对照](./docs/prototypes/v8-studio-rift/index.html)，开发服务下访问 `/docs/prototypes/v8-studio-rift/index.html`。左侧冻结v7，右侧约束局部折叠并保留回弹；空闲停止重绘，“只看新效果”停止隐藏对照绘制。原色性能、用户审美与正式参数/输出仍待验收，步骤/真实失败见[打磨记录](./docs/plans/studio-rift-refinement-2026-10-03.md)。

最新接入：`/ascii-art`“动态效果 → 悬停 → 撕裂试用”，可随本地项目/`.astra`保存并在离线HTML中操作；旧拖尾及默认保持，PNG/TXT保留静态作品，视频继续环境动画。试用不代表审美/性能/商业验收完成，工程合同和真实失败见[接入记录](./docs/plans/studio-rift-integration-2026-10-03.md)。

2026-10-04用户已恢复工作并增加全站视觉与商业品质要求：[六方向接续计划](./docs/plans/commercial-quality-execution-2026-10-04.md)。[v9字符聚散原型](./docs/prototypes/v9-glyph-particles/index.html)接入共享原生场及新瓷像素材；开发服务下访问 `/docs/prototypes/v9-glyph-particles/index.html`，默认单幅以免对照光层拖慢响应，可切并排。当前仅为研究候选，正式参数/输出及商业验收未完成，实际失败、名字画墨量及12路由双屏审计见[本阶段记录](./docs/plans/creative-research-iteration-2026-10-04.md)。[此前暂停交接](./docs/plans/project-pause-handoff-2026-10-03.md)保留历史成果。
