# `src/lib/ascii`

浏览器端图片 / 视频 → ASCII（无网络请求）。

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

字符画页的动效嵌入页在 `src/lib/ascii-art-embed-page.ts`（下载 HTML，CDN 上的 Studio）。引擎默认 `monospace`，本地预览由 `vite.config.ts` 改写成 Consolas；导出页在浏览器里做同样的字体替换，并带上当前悬停 / 微动（都关时默认拖尾 + 慢流）。

方案与产品方向见 [`docs/plans/ascii-art-roadmap.md`](../../../docs/plans/ascii-art-roadmap.md)。

## 兼容入口

`src/utils/ascii-art.ts` 仍从本目录再导出，旧 import 路径可继续使用。视图层优先从 `@/lib/ascii` 引入。

## 仍留在视图的部分

`AsciiArtView.vue` 保留 Vue refs / UI 编排：播放状态、选段、预渲染进度条、应用某一帧到预览、取消与缓存失效、缩放与绘制调度等。
