# signature-portrait

完整签名画像。默认 `woven` 错行排列，旧 WVS 通过 `layoutMethod: 'stipple'` 保留作对照。

`Placement[]` 为布局源；生产预览是 Canvas 概览/局部重画，PNG 分块输出，Path SVG 引用模板路径。默认无照片 underlay、无填色椭圆。纸白/夜光的墨色和可选填色在栅格/路径中使用同样语义。

GPU 尚未通过小笔迹一致性，`SIGNATURE_GPU_PREVIEW_VERIFIED=false`。`createGlStampPreview()` 默认返回 null；实验通过第二参数 `{ allowUnverified: true }` 调用。暗背景平均误差小不代表局部笔迹通过。

## 模块

- `extract.ts`：图片/手写抠透明模板，测墨量和形状。
- `bank.ts`：本地 IndexedDB 名字库。
- `variants.ts` / `fonts.ts`：固定OFL书写字体按需加载、覆盖核验与可复现字体变体；属于创作辅助。
- `layout.ts`：采样、Worker、Canvas 分块输出；真实 2K～8K 坐标。
- `woven.ts`：完整区域、错行、旋转拟合和墨量补偿。
- `layout-compute.ts`：woven 分发及旧 WVS/Lloyd 显式入口。
- `layout-worker-client.ts` / `layout.worker.ts`：请求生命周期和终止计算。
- `render-style.ts`：共享颜色与有界缓存键。
- `raster-cache.ts`：每次绘制使用精确RGB的LRU缓存，保留像素预算16MiB/64项，复用及结束释放。
- `ink-style.ts` / `vector-ink.ts`：默认 ink，cutout 可选；镂空 Canvas 与 SVG 共用真实路径，不擦除其他签名。
- `gl-preview.ts`：未晋升的分层 mipmap GPU 候选。
- `trace.ts`：模板级 Imagetracer 与 Path SVG，空模板报错。
- `svg.ts`：嵌位图 SVG 实验入口。

`skipPaint` 用最多 1024px 图片采样产生真实输出坐标，返回 8×8 占位。最终 PNG 仍分配完整画布；8K 下载和内存成本未在真机验收。当前 JSON 元数据不能独立完整恢复作品。

生成后模板、参数、坐标和尺寸固定；放大与导出使用同一份快照。`test:signature-result` 检查未应用调参不改变下载。`test:signature-cutout` 检查 100 写法/八种组合的分块、区域、路径 SVG 与实际 UI；镂空 SVG MAE 门槛 0.01，旧笔迹仍只通过既有 0.04 合同。

Trace 二值调色板固定，避免细笔迹采样只选白底导致合法模板导出失败；空模板仍拒绝。镂空Canvas和SVG现共用墨版与负笔迹的单次even-odd复合路径；旧mask抗锯齿相乘方案已替换。历史实际4K/8K文件见 `test-results/signature-cutout-print/`，不能自动视为本轮新验证。

启动开发服务，设置 `ASTRA_PREVIEW_URL` 后运行相关合同。`test:signature-pipeline`读取历史 `sandbox/signature-optimizer/fixtures/luxun-signature.svg`，当前该文件缺失；本轮没有重跑其4K/8K证明。`test:signature-raster`比较固定commit的旧渲染器与当前整图RGBA，含Edge/Chrome、边缘/旋转、缓存及取消异常释放。`test:signature-gpu`历史小笔迹门槛失败，生产关闭。

[产品与限制](../../../docs/plans/signature-portrait.md) · [精确绘制阶段](../../../docs/plans/signature-raster-iteration-2026-10-04.md) · [字体与安全保存](../../../docs/plans/signature-font-bank-iteration-2026-10-04.md)。100写法的真实首次页面等待仍约30秒，画面偏淡与网格感尚未达到商业签名画验收标准。

隔离研究见 [native-v2记录](../../../docs/plans/signature-native-v2-iteration-2026-10-01.md)：真实alpha/面积提取与墨量映射仍仅在沙箱。其16组预览输出、8组实际4K/8K与39项API合同完成，柔边路径SVG明确拒绝并使用PNG；鲜明墨版保留路径SVG，既有输出hash保持。重复网格与局部采样仍未满足自然笔迹观感，新最终集未消费，生产代码没有接入此候选。该研究不认证旧原笔迹严格SVG、GPU或商用品质。

后续 [ink-pack-v1](../../../docs/plans/signature-ink-pack-v1-iteration-2026-10-01.md) 在独立模块按真实笔画残差不规则排布完整正签名，用最终像素的双向碰撞账本保护已有笔迹。两轮各40开发和24原生审计、24场景对比原型/实际PNG通过；通用画质未通过，薄签名/暗部仍不足，不晋升。1024px研究范围不替代生产4K/8K、SVG或真机认证，父候选与生产均保持。
