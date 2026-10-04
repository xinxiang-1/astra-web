# 名字画精确绘制验证 · 2026-10-04

[实施与限制](../../../plans/signature-raster-iteration-2026-10-04.md)。固定旧版commit与当前版本整图RGBA对照；未做商业审美、真机或P95认证。

| 检查 | 实际结果 | 精简文件 |
| --- | --- | --- |
| Edge 154.0.4258.53 | 16组合×直接/分块，全部零通道差异；缓存命中/复用/预算/释放通过 | [edge-pixel-contract.json](./edge-pixel-contract.json) |
| Chrome 154.0.8037.57 | 同合同全部通过 | [chrome-pixel-contract.json](./chrome-pixel-contract.json) |
| 真实100中文写法/16074坐标 | 1280×1173，6005760通道相等；完整栅格/读取旧52.587秒、新30.316秒 | [real-raster-contract.json](./real-raster-contract.json) |
| 真实冷上下文页面 | 原等待58.482秒，最终31.773秒；2ms主线程CPU采样，Worker不计入 | [startup-profiles.json](./startup-profiles.json) |
| 免费输出及视口快照 | 未应用调参的JSON/PNG/SVG及同一原大视口保持；重新生成4096×3751、density12通过 | [result-snapshot.json](./result-snapshot.json) |
| 纯签名基础合同 | 默认画布与无照片画布hash相等，透明空图0位置，Path SVG无image | [pure-ink.json](./pure-ink.json) |
| 类型、相关ESLint、build、diff检查 | 通过；既有大chunk、JSZip externalization、无效动态import提示保留 | [manifest.json](./manifest.json) |

复现前启动Vite并设置 `ASTRA_PREVIEW_URL`，Windows机器设置 `ASTRA_BROWSER_CHANNEL=msedge` 或 `chrome`。命令：`npm run type-check`、相关ESLint、`npm run build`、`npm run test:signature-raster`、`npm run test:signature-raster -- --real-only`、`npm run test:signature-quality`、`npm run test:signature-result`。结果合同显式 `ASTRA_SIGNATURE_WAIT_TIMEOUT=90000`，实际等待单独记录；不是90秒性能验收门槛。

缓存合同覆盖旋转、边缘、块边界、大小悬殊模板、实际中文字体、精确色/字面墨色/单色、笔迹/镂空与可选填色。连续重着色用“绘到新结果画布再读取”的生产路径，避免反复读取复用的缓存源导致浏览器切换读取实现。成功、进度回调异常、块后取消、错误模板编号均检查缓存表面释放。保留预算16MiB/64项不包括源模板、主输出、GPU、临时超大模板或整个浏览器内存。

首次UI回归被热更新重置，见[result-invalidated.json](./result-invalidated.json)；随后隔离运行原大比对因未复位滚动锚点失败，下载文件已相等。明确复位同一stage位置后仍要求原大hash严格相等，保存[viewport-geometry.json](./viewport-geometry.json)及原始PNG。原始失败目录和CPU全量文件保留在test-results，未批量提交。

原生[实际输出](./real-portrait.png)已查看：画面仍偏淡、网格明显。本文的零差异证明其内容保持，不证明视觉已经达到收费质量。最大放大尚有边缘可达及整幅显示画布分配问题，见实施记录；本轮没有运行危险尺寸，也未声称已解决。
