# `src/lib/ascii`

浏览器端图片 / 视频 → ASCII。源素材在浏览器本地处理；示例素材和旧 Studio 嵌入页的网络依赖单独说明。

2026-10-01：主编辑器新作品默认 `src/lib/art-engine` 的六模式采样 + Canvas 工厂，
预览/全屏、PNG/TXT、缩略图、视频采样与离线 HTML 复用 ArtFrame；支持字体、字格和抖动。
原 `convert.ts` / `paint.ts` / Studio 继续服务 legacy 和其他已有入口。
未含 engine 字段的旧项目保留 legacy；选择新模式才升级，`?engine=legacy` 可显式进入旧入口。
首页其他区块、画廊和 `/art-lab` 已使用 calibrated；这些入口仍可能使用 GPU 包装，
本轮主编辑器合同不等同于全站跨 GPU/Canvas 逐像素一致。

按照用户明确要求，主页首屏保留 Studio 拖尾（trail）与慢流（current），不改为候选引擎。
`CharacterArtwork engine="studio"` 提供该独立入口；默认 calibrated 用于其他展示区和画廊。
对比滑块上方的鼠标事件转发，
并校正 `object-fit: cover` 裁剪坐标；离屏、隐藏标签页、手动暂停或系统减少动态效果时
暂停同一画布。`CharacterArtwork` 通过 `animated` / `interactive` 启用动效。

legacy 的 `paintStudioFrame` 为缩略图 / PNG / 视频导出复用原生渲染器；导出用 pixelRatio 放大输出，
保持列数而不是增加字符。视频导出流式编码原生画布，避免缓存整段高分辨率像素。
中文铺字使用 Studio 的自定义字符库按光影选字；TXT 保留按句子循环的文本采样。

本地开发服务启动后，可运行 `npm run test:ascii-artwork` 检查算法边界、主页交互与手机布局，
运行 `npm run test:ascii-consistency` 检查 legacy 编辑器五档清晰度及静态 / 动态切换。
`npm run test:ascii-studio-render` 检查挂载预览与静态导出的像素一致、PNG 尺寸 / 透明度、
流式视频编码和原生 PNG 帧缓存。

`npm run test:art-editor` 检查新主编辑器六模式、PNG/透明 4K/TXT、实际离线 HTML、全屏、
项目恢复、390px 与真实选段 MP4；可设置 `ASTRA_PREVIEW_URL` 验证 minify 后的生产页。
`npm run test:art-cache` 检查六模式 typed-frame 缓存、取消/内存拒绝及源视频时间恢复。
新缓存默认上限 96 MiB；视频流式编码复用 Canvas，不能把同一可变 raster 缓存在多帧队列。
JPEG 缩略图和视频有压缩损失，不宣称逐像素相等；静态 PNG/HTML 合同要求相同 Canvas 输出。

## 模块地图

| 文件 | 职责 |
|------|------|
| `index.ts` | 对外 API 再导出 |
| `types.ts` | 公共类型（转换结果、绘制选项、`PrerenderFrame` 等） |
| `constants.ts` | 字符集、分辨率、字体、纵横比、视频上限常量 |
| `convert.ts` | 采样 + charset / phrase 转换 |
| `paint.ts` | 字格度量、`paintAsciiToCanvas`、PNG / 下载、自适应缩放 |
| `media.ts` | 图片/视频判定、加载、`seekVideoTo`、列数解析与实时上限 |
| `prerender.ts` | 预渲染缓存键、最近帧索引、`prerenderVideoFrames`（只处理选段） |
| `playback.ts` | 无 Vue 的 rAF 循环；实时播放可在选段内回绕 |
| `export-video.ts` | 选段导出 MP4。短于内存上限先缓冲；更长则编一帧丢一帧 |
| `loop/` | **解耦**循环字符画：抠背景格 + 跨帧流动字符 + HTML 导出 |
| `studio-preview.ts` | 字符画页 ↔ asciify Studio：悬停 / 微动、极性、列数→`cellSize` |

独立页面：`/ascii-loop`（`AsciiLoopView.vue`），不改动主字符画流程。

legacy 动效嵌入页在 `src/lib/ascii-art-embed-page.ts`（CDN 上的 Studio）。引擎默认 `monospace`，本地预览由 `vite.config.ts` 改写成 Consolas；导出页做同样字体替换，并带上悬停 / 微动（都关时默认拖尾 + 慢流）。

新 calibrated 嵌入页在 `src/lib/art-engine/embed.ts`：单文件内嵌实际帧、字形 PNG atlas、采样/Canvas 工厂和视频 File，可离线播放、暂停、重启、hover 与下载文本。视频源上限 64 MiB；选段会保存，但当前内嵌的是整个源文件，没有额外压缩/裁剪。减少动效禁用装饰动画，用户主动播放的视频继续工作。

本轮实现、失败与验收记录见 [编辑器迭代记录](../../../docs/plans/art-editor-iteration-2026-10-01.md)。

Canvas 字形渲染缓存使用复用 OffscreenCanvas 上下文与独立 ImageBitmap，缓存像素最多 16 MiB，另有一个字形临时表面；不支持时回退 Canvas。饱和不循环逐出，新帧/destroy 释放位图。`npm run test:art-render-cache` 验证相同动态像素、成对耗时、饱和/透明/hover 与释放。采样和画质默认没有变化；自然图候选 holdout 失败与本轮工程证据见 [画质及缓存执行记录](../../../docs/plans/art-quality-iteration-2026-10-01.md)。

方案与产品方向见 [`docs/plans/ascii-art-roadmap.md`](../../../docs/plans/ascii-art-roadmap.md)。

calibrated `2.1.0` 的单色图片光影字符可选「精细 / 柔和」：600 笔重 + high 过滤，或在 32 MiB/2,048px 限制内两倍采样后缩小。经典默认保持；其他模式、彩色与视频回到经典。品质字段参与重绘、缓存和项目恢复，离线 HTML 带相同笔重 atlas/Canvas 工厂。`npm run test:art-quality` 在开发预览上验证生产与冻结候选的 train/dev 迁移及默认兼容；`test:art-editor` 同时检查开发/生产的两档真实导出与恢复。静态限定范围的新 holdout 通过，中文、彩色与动态 30 fps 未通过，完整证据见 [quality-v4 记录](../../../docs/plans/art-quality-v4-iteration-2026-10-01.md)。

## 兼容入口

calibrated `2.2.0` 在图片单色光影和原色字符增加可选「还原」档：字体alpha的面积采样与受预算的软件合成，原色强度只应用一次。经典、旧项目和首页Studio保持；中文与视频继续经典。`npm run test:art-software` 核对选择性迁移及缺省/排除合同，`test:art-editor` 覆盖新档实际媒体与恢复；设备范围和未通过中文见 [quality-v5 记录](../../../docs/plans/art-quality-v5-iteration-2026-10-01.md)，API与缓存边界见 [统一引擎 README](../art-engine/README.md)。

`src/utils/ascii-art.ts` 仍从本目录再导出，旧 import 路径可继续使用。视图层优先从 `@/lib/ascii` 引入。

## 仍留在视图的部分

`AsciiArtView.vue` 保留 Vue refs / UI 编排：播放状态、选段、预渲染进度条、应用某一帧到预览、取消与缓存失效、缩放与绘制调度等。
