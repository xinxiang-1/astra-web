# 公共界面验证 · 2026-10-04

[实施/失败/限制](../../../plans/site-shell-iteration-2026-10-04.md) · [站点结构](../../../plans/site-architecture.md)

本机 Windows、Edge 154.0.4258.53、开发服务 127.0.0.1:5180。测试使用独立浏览器上下文，不写真实用户作品或生产账户。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 22 路由 × 亮/暗 × 1440/390px | 88 例无横向溢出、一个页头、正确标题/主题/主内容焦点入口 | [路由与导航](./routes-and-navigation.json) |
| 键盘导航、Escape、菜单外、路由/历史/宽度复位、创建入口、跳过链接、主题重载 | 全部通过；320/700/701/1180/1181/1280px 页头无重叠 | 同上 |
| 新控件减少动效 | 目录装饰箭头/按钮不位移 | 同上；不外推所有效果引擎 |
| 普通 hover / 禁用链接 / 触控菜单 | 点击区域稳定、光层跟随与消退、禁用不能导航、恢复能导航 | [控件与文件](./controls-and-files.json) |
| 本地文件实际流程 | UTF-8 中文 TXT → 图片替换 → 清除 → 空状态 | 同上 |
| 744×390 / 320×568 | 效果最后控件及账户提交可滚动/聚焦到达 | 同上 |
| GPU 不可用 | 三种 WebGPU 页提示位于页头下；Prism 无效配置收起，不遮挡提示 | 同上与[截图](./prism-gpu-unavailable.png) |
| 正常动态背景 | Studio Prism ready，无错误；实际画面已检查 | [状态](./gpu-and-visual.json)、[截图](./studio-normal.png) |
| 主创作流程 | 案例筛选/搜索、预设、上传、本地保存/恢复、免费 1080px PNG、手机编辑/导出通过 | 原始 test-results/art-ui-shell-20261004 |
| 签名结果快照 | 2K JSON/PNG/SVG/原大不受未应用控件影响；重新生成才应用 4K 与新参数 | [结果](./signature-result.json) |
| 首页保护 | 三文件 Git 规范化 SHA256 与 54b26ca 相同，工作树无差异 | 路由证据 protectedHashes |
| 工程 | type-check、变更 ESLint、build、git diff --check 通过 | 构建原始日志保存在 test-results/site-shell-final-20261004/build.log |

运行：`node scripts/site-shell-contract.mjs`、`node scripts/site-controls-contract.mjs`。前者支持 `ASTRA_SHELL_NAV_ONLY=1` 单独排查导航，但该结果不计作 88 路由。主创作与签名脚本使用 `ASTRA_BROWSER_CHANNEL=msedge` / `ASTRA_PREVIEW_URL=http://127.0.0.1:5180`；签名这次显式设置 `ASTRA_SIGNATURE_WAIT_TIMEOUT=90000`，首次等待 54.672 秒，不能称性能通过。

原始失败保留于 site-shell-1791062384761（颜色断言）、site-shell-1791062716383（点击位置）、site-shell-1791063367455（隐藏按钮角色定位）、site-controls-1791063184619（缺少文本渲染器）；最终完整 88 例为 site-shell-final-20261004，最终控件/文件/GPU 为 site-controls-1791064338673。GPU 正常背景与最初提示位置的记录为 site-visual-normal-20261004；最初 Prism 提示遮挡已修复，最终截图以上方链接为准。

开发视觉检查已查看桌面/手机工具、Studio、账户、文件、短屏配置与 GPU 失败画面；实体手机、其它操作系统、全站 Chrome、所有 Office/压缩包兼容性与全引擎减少动效没有由这些结果证明。页面内第三方阅读器仍有自身样式。

## 画面与依赖

- [工具页桌面](./tools-desktop.png)、[手机](./tools-mobile.png)、[账户手机](./login-mobile.png)。
- 新依赖固定 `@file-viewer/renderer-text@3.1.1`，来源 [npm](https://www.npmjs.com/package/@file-viewer/renderer-text/v/3.1.1)，许可 [Apache-2.0 正文](../../../licenses/file-viewer-renderer-text-Apache-2.0.txt)。包完整性与传递依赖见 package-lock.json；没有修改第三方源码。

这份记录证明公共界面和列出的流程，整体商业目标继续进行，未部署或完成真实收款。
