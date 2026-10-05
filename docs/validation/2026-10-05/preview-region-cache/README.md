# 高密度绘制与缓存候选证据

对应[阶段记录](../../../plans/preview-region-cache-research-2026-10-05.md)。生产工厂保持冻结 `92bc304`；原始生成模块保存在忽略的 `test-results/`，可由两个 research 入口重建。

| 报告 | 实际范围 |
| --- | --- |
| [Chrome 拆解](./profile-chrome.json)、[Edge 拆解](./profile-edge.json) | 六模式、180 列、713px、light/particles 三帧，额外分阶段 GPU 排空影响批处理，不能作 FPS 或通用加速比 |
| [R1 失败](./region-r1-failure.json)、[diff](./region-r1.patch) | 原生字形 clip 后中文有通道差异，未接入 |
| [R2 copy 失败](./region-r2-copy-failure.json)、[diff](./region-r2-copy-failure.patch) | 子矩形 copy 清空其它像素的实现错误，原失败保留 |
| [R2 几何 Chrome](./region-r2-geometry-chrome.json) | 六模式 144 帧、同 frame 对象，区域外整数缓存复制后零差 |
| [R2 内容 Chrome](./region-r2-content-chrome.json) | 六模式 144 帧、每帧新数组及内容快照复用；另有四组 180 列配对 36 帧，像素零差与实际成本 |
| [R2 Worker Edge](./region-r2-worker-edge.json)、[最终 diff](./region-r2-content.patch) | 六模式 144 帧、实际 Worker 五帧中文及真实 hit/patch，另有四组高密度配对；全程像素零差 |
| [最终 Worker Chrome](./region-r2-worker-chrome.json) | 最新生成器的六模式 144 帧、实际 Worker 五帧中文，未重复性能组 |
| [重算配对摘要](./paired-summary.json) | 原始 inputFrames 2–7 的线性插值 P50/P95，每组六个样本；不修改原始报告，不把通过测量当作商业性能通过 |

所有像素门槛为完全相同，透明 RGB 也计入。profile 中的 alpha 统计和 renderer 成本，不代表 DOM 页面、真实用户编码、触控、全品质或 4K 已验证；本阶段未接入生产缓存。
