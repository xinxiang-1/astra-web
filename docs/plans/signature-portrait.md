# 签名画像

2026-10-04 更新。路由 `/signature-portrait`，实验功能，尚未通过商业画质验收。完整手写/上传签名参与排版；字体生成的写法是创作辅助，不代表真实手写。

最新[字体与安全保存阶段](./signature-font-bank-iteration-2026-10-04.md)：核验OFL行楷/草书、按需加载、完整长名字边界和可复现配方；生成成功后原子替换，失败保留旧笔迹。镂空Canvas/SVG共用一次复合路径，8组合原品质门槛通过；视觉对比仍未商业通过，详见[来源/墨量研究](../research/2026-10-04-signature-fonts/README.md)。

接续[精确绘制优化](./signature-raster-iteration-2026-10-04.md)：精确RGB缓存、保留16MiB/64项预算、完整模板复用和保守分块范围。真实100写法/16074坐标概览与旧版整个RGBA缓冲区相等；固定对照完整栅格52.587秒降至30.316秒。真实页面最终31.773秒仍偏慢，字体/布局和偏淡网格观感保持；此性能阶段不代表商业视觉通过。

## 当前行为

- IndexedDB 名字库支持多遍手写、上传签名、字体变体和本地调用。
- 默认 `woven`：根据签名长宽和墨迹覆盖率错行排列，整个旋转签名约束在自己的矩形区域内，透明度表达明暗。旧 WVS/Lloyd 通过 `layoutMethod: 'stipple'` 保留作对照。
- 风格默认「笔迹织排」；可选「镂空排印」用同一真实模板路径在墨版中镂空，增强块面表达。Canvas/SVG 的镂空合同通过，审美与真机性能仍需验收；不会替换默认笔迹。
- 纸上书写默认暗处密；夜光采用深底、亮处密和准确浅墨。自定义轮廓色优先于主题墨色。
- 默认无照片 underlay、无填色椭圆。用户选择填色时，Canvas 和 Path SVG 都绘制局部椭圆，不叠加照片冒充签名细节。
- 生产预览为 Canvas 分块概览与局部重画。GPU 小笔迹一致性仍失败，`SIGNATURE_GPU_PREVIEW_VERIFIED=false`；实验必须传入 `allowUnverified: true`，正常创建返回 null。
- 对比条、缩放、重新排版和底色切换可用。已修复动态挂载 canvas 与 Vue 模板 ref 冲突造成的空白。
- 输出真实 2K～8K 坐标，包括放大小源图；放大不会创造源图缺失的细节。8K 采用更细布局，不是相同字数的 2K 作品拉伸。
- PNG 分块栅格化；Path SVG 使用固定二值调色板 trace 模板后引用路径，默认不含照片 `<image>`。每次生成固定模板、参数、布局与尺寸，局部放大/PNG/SVG/JSON 均读取生成快照；未应用调参提示重新生成。
- JSON 包含布局、renderOptions、stampIds 与元数据，仍无源图/完整模板，不是完整可恢复项目包。

## 实现

`Placement[]` 是布局源，包括坐标、角度、尺寸、模板编号、透明度、墨色、深度和轮廓/直接墨色标记。

`layout.ts` 调度采样、Worker、Canvas。woven 采样最长边不超过 1024，`skipPaint` 返回 8×8 占位画布并保留真实 4K/8K 坐标。最大输出边 8192；最终 PNG 仍分配完整输出画布，不能称为零内存导出。

`woven.ts` 用像素区域积分平均计算明暗和颜色；多写法的墨量基准取覆盖率下四分位，避免一个极淡写法压低全图。稀疏写法受透明度上限约束，尚未在用户手写 holdout 验证。

`render-style.ts` 统一 Canvas、SVG、GPU 候选的 RGB 字节，栅格缓存按实际墨色键最多保留 64 项。`trace.ts` 路径继承外层颜色，空模板报错，不用矩形替代笔迹。

Worker 每请求独立；取消时直接 terminate 并 reject，不依赖同步计算中无法处理的消息。Worker 不可用仍回退主线程，主线程长计算不能保证及时取消。

GPU 分层 mipmap、填色和实例化保留为候选。小尺寸笔迹未通过晋升，默认不参与官网输出；multiply、填色边界、内存和真机性能仍需核验。

## 检查

先启动开发服务并设置 `ASTRA_PREVIEW_URL`；本轮实际端口 5180。

- `npm run test:signature-pipeline`：生产 Canvas/分块、四底色填色组合、Path SVG、真实 4K/8K PNG 编解码、确定性、空 trace、取消、自定义边缘墨、实际 UI 绘制像素和手机无横向溢出。本轮通过。
- `npm run test:signature-cutout`：100 写法、8 镂空组合、SVG MAE <0.01、分块/区域 MAE <0.004、实际 UI/手机；通过。原笔迹严格 SVG 0.01 门槛仍失败，不能被此检查覆盖。
- `npm run test:signature-result`：改控件后 JSON/PNG/SVG/原大重画保持当前作品，重新生成才应用新参数；通过。
- `npm run test:signature-gpu`：额外要求 GPU MAE <0.02。本轮明确失败，阈值未放宽，生产 GPU 关闭。
- `npm run test:signature-strokes`：五种尺寸、两个角度的局部图片/墨量诊断；诊断输出不等于验收通过。
- `npm run test:signature-quality`：纯签名、空透明图、Path SVG 等基础回归；工程打字样本不证明手写审美。
- `node scripts/signature-layout-benchmark.mjs`：隔离布局对比，基线缓存和冻结源码说明见执行记录。

证据在 `test-results/signature-pipeline/metrics.json`、真实 PNG、桌面/手机截图，以及 `sandbox/signature-optimizer/experiments/`。历史签名源文件 hash、官方网页与 Public domain 说明在 fixtures 目录。

## 限制与下一步

高分辨率 [容量研究R2](./signature-print-iteration-2026-10-04.md)：72组输出、双浏览器16场UI与72幅PNG编码解码通过；4K结构改善但块面/横条仍存在，按两轮上限停止、不晋升。用户已认可当前生产签名画效果与按钮hover，最新优先项为不卡顿的精绘、缩放、加载反馈和清晰度，随后统一官网配色与交互。

最新 [容量与正负拼贴 R1](./signature-capacity-iteration-2026-10-04.md)：独立原型 36 组比较，候选 12/12 数值通过、双浏览器 16 组 UI 通过；完整历史签名重绘和字体辅助分别标明来源。负笔迹块面和长名字细节仍粗糙，商业审美未通过，不晋升生产；原图仅计算、无源图重放一致。最多两轮，继续声明后验证高分辨率细节。

最新隔离研究见 [ink-pack-v1记录](./signature-ink-pack-v1-iteration-2026-10-01.md)：新正笔迹按实际墨量不规则散布，允许透明空白嵌入；两轮各40开发、24原生审计，R2双向真实笔迹相交合同通过，24场景对比/局部/免费PNG及手机原型完成。薄签名与暗部仍未达到通用商业层次，按两轮上限停止、不晋升，最终来源未消费。当前生产默认不变。

前一 [native-v2记录](./signature-native-v2-iteration-2026-10-01.md) 已完成16组预览/输出、8组真实4K/8K和39项API合同，仅在沙箱修复柔边SVG静默风格变化：柔边明确使用PNG，鲜明墨版保留路径SVG。透明度/面积提取与墨量映射仍未接入生产，重复墨版网格不合格。

完整签名的留白限制对比度，夜光多写法示例仍偏淡。轮廓相关性高、文件尺寸正确不代表达到收费画质。下一轮补更多真实手写和自然照片 holdout，改善对比度、笔迹和手机体验，再晋升 GPU。当前真实 4K/8K PNG 约 17/64 MB，需评估下载和内存成本。

后续补完整项目包、数据迁移、直接矢量手写和分享规格；PDF、后端排版与云同步按总计划后置。

[本轮镂空与快照记录](./signature-engine-iteration-2026-10-01.md) · [前轮布局记录](./signature-engine-iteration-2026-09-30.md) · [旧 WVS 历史规划](./signature-portrait-wvs-history.md)。历史 underlay 和默认值不能作为现状说明。
