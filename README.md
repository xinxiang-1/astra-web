# Astra

本地优先的创意工具站，外加可嵌入网页的实时视觉。当前统一编辑器提供六模式、可选图片品质、六种微动与九种悬停、全屏预览和免费PNG/TXT/视频/离线HTML；完整 `.astra` 作品包可携带源素材和设置，在新浏览器导入恢复。

本轮前后端交付范围、验证证据和后续任务见 [阶段交付记录](./docs/plans/stage-delivery-2026-10-01.md)。[产品总计划](./docs/plans/product-master-plan.md)持续跟踪模板包、新增付费创作和定制服务；订单、支付、公测和正式部署仍待实现。首页原Studio参数保留，原创Logo位于 `public/brand/`。

提交推送使用用户指定的GitHub MCP连接账户 `xinxiang-1`。先核验账户与目标仓库权限；浏览器登录和本地Git凭证不替代MCP授权。

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
