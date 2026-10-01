# 官网交互研究与 hover 修正

研究于 2026-09-30 开始，2026-10-01 完成此次实现和核验。范围为定向网页检索、公开案例目录、官网和官方技术文档；不是穷尽互联网。用户要求搜索页面交互、特别是 hover，并提供「浏览作品」文字与箭头旋转的实际截图。

## 已获取的参考与取舍

- [Awwwards 动画网站目录](https://www.awwwards.com/websites/animation/)：搜索和浏览器均实际访问；用于发现动画、滚动、交互的案例分类。目录展示不能代替逐一验证获奖站点。
- [Codrops HoverEffectIdeas](https://github.com/codrops/HoverEffectIdeas)：GitHub 搜索与 README 已获取。参考轻微的边框、图像和箭头反馈；不复制第三方代码或图片。该旧项目 README 为 Codrops 自有许可说明，LICENSE 请求为 404，不能把它标注为已核验 MIT。
- [Codrops MagneticButtons](https://github.com/codrops/MagneticButtons)：README 与 MIT LICENSE 已获取并保存 Git blob / SHA256。案例提到 [Cuberto](https://cuberto.com/services/) 的灵感来源；本轮未实际浏览 Cuberto，也未引入该项目依赖。磁吸没有用于用户要求保留的首屏按钮。
- [Linear](https://linear.app/)：官方 HTML、浏览器首屏与滚动截图已获取。实际观察到克制的边框、渐变与内容层次；应用于展示画板的结构与明确信息，不复制品牌素材。
- [Lusion](https://lusion.co/)：官方页面曾成功获取，后续请求失败；浏览器截图停在加载进度。只能证明访问与加载，不能宣称完成其交互实景评价。[Active Theory](https://activetheory.net/) 仅获取官方 HTML，未完成浏览器交互验证。
- [GSAP ScrollTrigger 文档](https://gsap.com/docs/v3/Plugins/ScrollTrigger/)与 [Motion scroll 文档](https://motion.dev/docs/scroll)：已获取官方页面。参考滚动进度与入场分层思路，本轮沿用原生 IntersectionObserver 和 rAF，没有安装动画库。
- Codrops 官方博客和具体文章请求返回 403，保留失败结果。GitHub 搜索还返回滚动文字、弹性网格和 3D 图像案例；涉及文字旋转的方向未采用。

`sources.json` 保存地址、状态、时间、页面 hash 和检索结果，`hover-sources.json` 保存 hover 项目来源。官网 HTML 为研究留档，不是可以直接用于本产品的资产。`browser-observations.json` 与 PNG 是浏览器访问证据；Lusion 加载未完成的限制以本文为准。

最初长英文搜索返回大量词典结果，相关性不足；随后以 Awwwards、Lusion、GSAP ScrollTrigger、Codrops hover 和 GitHub 组织搜索收窄。不能把初始无关结果作为设计依据。

## 实际问题：Logo 样式污染所有链接

用户截图的「浏览作品」旋转不是字体栅格化问题。实际在 1100px 宽度、5180 与 localhost:5174 两个预览上重现：链接 hover 的 transform 为 `matrix(0, 1, -1, 0, 0, 0)`，尺寸从横向变成约 17 × 82px。

原因位于 `src/components/ui/AstraMark.vue`：`:global(a:hover) .mark-star` 在 Vue scoped CSS 编译时丢失了后面的目标，生成 `a:hover { transform: rotate(90deg) }`。横梁 opacity 规则同样污染链接。原有减少动效规则使此前以 reducedMotion 运行的页面检查未发现这次错误。

修复为 `:global(a:hover .astra-mark .mark-star)`，横梁与减少动效规则也将完整目标放进 `:global()`。普通链接不再被 Logo 的旋转和透明度影响；首屏 Studio 的 trail .65/.38、current .45 及原按钮/作品卡片 hover 保留。

这也是后续规则：全局选择器必须包含完整的、限定组件的目标。测试普通动效和系统减少动效两种状态，不能只检查静态页面或点击而不实际 hover。

## 本轮实现

六模式展示画板增加明确的标题、状态、模式解释和 hover 选择。光晕只提升现有字形的 alpha，保持位置、颜色方向、文字顺序；涟漪位移最多 0.14 个字格，不旋转字形。两者 GPU 与 Canvas 使用同一公式。鼠标有平滑跟随和离开衰减；原首屏 Studio 不走新 hover 算法。实验室采用稳定光晕，展示区增加限定画板范围的青色光边与箭头反馈。

所有新效果均支持系统减少动效，触屏不显示鼠标提示。作品仍使用真实字符渲染，没有将照片叠加为字符作品。未新增依赖、支付能力或正式部署。

## 核验

- `scripts/home-hover-smoke.mjs`：真实鼠标 hover、链接方向、尺寸、透明度、Logo 星芒/横梁隔离；1440、1100、820、620、600、550、390px 与减少动效。开发预览 13 组链接检查通过；生产核验结果见下方追加记录。
- `scripts/art-glyph-orientation.mjs`：不对称字母/中文，GPU 对照 Canvas；静态 upright alpha MAE 为 0，光晕约 0.000206，涟漪约 0.000955。光晕没有新增或移动字形 mask，也没有减少笔迹。此项验证引擎字形方向，不是此次链接旋转问题的根因证据。
- 已有首屏 Studio、拖尾事件、暂停、对比、离屏、减少动效和手机回归通过；五素材 × 六模式、真实透明 4K PNG 回归通过。软件 GPU 最慢组合 p95 约 173.5ms，仍不代表商业性能验收。
- 严格 type-check、变更源码/脚本 ESLint 与生产构建通过。保留已有大包、Office 资源、stream 浏览器外置及无效动态 import 警告。

证据目录：`test-results/home-interaction/`。`hover-link-current.png` / `hover-link-other.png` 为修复前实景；`after-hero-hover.png` / `fixed-browse-works-hover.png` 为修复后实景；`after-story-hover.png` 为新展示区；`hover-regression.json` / `glyph-orientation.json` 为检查数据。

签名对比度候选仍在 sandbox，本轮因为用户纠正官网 hover 而转移优先级，没有晋升签名候选，也没有使用爱因斯坦 holdout 调参。

## 最终核验结果

2026-10-01：构建输出通过 Vite preview 在 5181 实际运行。`ASTRA_PREVIEW_URL=http://127.0.0.1:5181 ASTRA_HOVER_OUTPUT=test-results/home-interaction/production node scripts/home-hover-smoke.mjs` 再次通过 13 组链接检查、Logo 子元素隔离、新 hover 选项、七种屏宽和减少动效，运行异常为零。生产证据保存独立子目录，没有覆盖开发预览的检查数据。

另在用户可能使用的 `http://localhost:5174` 实际 hover「浏览作品」，确认 transform 为 `none`、opacity 为 `1`、writing-mode 为 `horizontal-tb`。已人工查看该修复后截图和新展示区截图。生成的生产 CSS 核对为 `a:hover .astra-mark .mark-star` / `.mark-beam`，没有 Logo 引起的普通链接旋转。

最终完整 UI 回归通过：官网/画廊、筛选/搜索、预设、上传、浏览器保存/恢复、PNG 下载尺寸、手机导航/编辑器/导出，没有页面运行异常。最新严格 type-check 和变更文件 ESLint 均退出 0。仓库整体 `git diff --check` 发现已有 `docs/plans/ascii-art.md:27` Markdown 行末空白；此文件本轮未修改，不作为本轮代码检查通过的依据。
