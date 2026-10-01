# Astra 品牌标志 v1

2026-09-30。状态：原创矢量初版，已接入官网并通过本轮浏览器验证。后续调整沿用本文件记录。

## 设计

字母 A 的两侧作为光束，青色横梁表达光与字符的连接，右上星芒呼应 Astra 名称与创作的灵感。几何轮廓适配字符艺术的网格；横向 ASTRA 字标为手写路径，与符号同用简洁笔画。SVG 不依赖字体、图片、图标库或外部网络。

网站继续沿用深墨色 `#111615`、纸白 `#f5f3ef` 和青色 `#58e8ed`。浅色资产使用墨色符号与深青色 `#078c91`，保证细节可见。Logo 与页面标题承担不同层次：标志使用几何字标，内容保留现有中文衬线标题。

## 文件与应用

- `public/brand/astra-symbol.svg` / `astra-symbol-light.svg`：独立标志，透明背景。
- `public/brand/astra-lockup-dark.svg` / `astra-lockup-light.svg`：横向组合，透明背景。
- `public/brand/astra-monochrome.svg`：单色印刷，可整体替换填色。
- `public/brand/favicon.svg`：深色圆角底。另提供 16/32 PNG、180 Apple touch、192/512 收藏图标。
- `src/components/ui/AstraMark.vue` / `AstraLogo.vue`：网站组件，主体颜色跟随 `currentColor`，浅底可指定 `--logo-accent: #078c91`。
- 已接入官网导航、页脚、字符画编辑器、实验室/工具顶栏和浏览器图标。
- `output/astra-brand-v1/`：SVG、透明 PNG、品牌展示板、真实官网桌面与手机截图。

横向标志保留宽高比 280:64，独立标志 56:56。组合最小建议高度 28px；16px 的浏览器图标使用带底版本。安全留白至少为标志宽度的 1/8。不能拉伸、添加厚描边、改动星芒位置或在杂乱照片上直接使用浅色标志；需要时加深色底。

## 交互边界

品牌链接 hover 时，仅星芒轻转与横梁亮度变化；系统减少动效时静止。用户明确要求保留首页已有动效与 hover：首屏继续 Studio 拖尾 + 慢流，现有按钮和作品卡片 hover 不变，移除后来加入的首屏滚动位移/缩放。滚动入场、科技圆轨和模式选择交互仅放在其他区块。

## 复现与检查

`node scripts/render-astra-brand.mjs` 从真实 SVG 生成 PNG 和展示板，并在 5180 预览服务拍摄网站截图。运行严格类型检查、变更文件 ESLint、首页交互回归与现有 UI 回归。浏览器截图人工检查标志、字标间距、手机导航和浅色细节。后续验收结果记录于商业引擎执行文档。

本轮实际通过：严格 type-check、相关 ESLint、首页 Studio 拖尾/慢流/暂停/滑块/减少动效/离屏回归、UI 上传/保存恢复/导出/移动导航回归及生产构建。构建保留已有大包等警告。新版 Logo 亦已加入 `output/astra-promo-v2/` 的 24 秒 1080p 宣传片，ffprobe 与关键帧检查通过。

## 2026-10-01：hover 选择器修正

用户提供截图后，在 5180 与 localhost:5174 实际重现「浏览作品」hover 旋转 90°。原因是 scoped CSS 中 `:global(a:hover) .mark-star` 编译成所有链接的 `a:hover`，丢失后续目标；横梁 opacity 也污染链接。已改成 `:global(a:hover .astra-mark .mark-star)` / 完整横梁目标，减少动效规则同样修正。

普通动效的 Logo 只旋转星芒；导航、普通链接、主按钮、作品卡片保持原方向与透明度。新增 13 组实际鼠标 hover 回归，覆盖七种屏宽与减少动效。早期 reducedMotion 页面测试没有捕获此错误，后续不可只依靠静态或减少动效截图验收。详细来源、复现和证据见 [交互研究与修正记录](../research/2026-09-30-interactions/README.md)。
