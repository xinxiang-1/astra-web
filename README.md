# Astra

本地优先的创意工具站，外加可嵌入网页的实时视觉。

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

- IDE：[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar)
- Node：见 `package.json` → `engines`
- 特效页建议使用较新的 Chromium（WebGPU）

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
| `/login` 等 | 账户 | 前端壳，暂不主推 |
