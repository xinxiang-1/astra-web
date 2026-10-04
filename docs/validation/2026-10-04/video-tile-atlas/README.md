# 彩色图集研究证据

[阶段记录与范围](../../../plans/video-tile-atlas-research-2026-10-04.md)。三轮均未通过画质，未接入生产。

| 轮次 | 原始报告 | 精简源码差异 | RGBA 零差 |
| --- | --- | --- | --- |
| R1 | [report](./r1-report.json) | [patch](./r1-candidate.patch.json) | 36 / 72 |
| R2 | [report](./r2-report.json) | [patch](./r2-candidate.patch.json) | 60 / 72 |
| R3 | [report](./r3-report.json) | [patch](./r3-candidate.patch.json) | 68 / 72 |

[来源与 SHA-256](./source-hashes.json)记录冻结基线、候选、报告、patch 与最终研究脚本。各 patch 对应冻结 `c795d97:src/lib/art-engine/canvas.ts`，归档时已在内存中逐行应用并重建相同候选 hash；不在生产工作树运行这些 patch。JSON 的 `patch` 字段保存完整 unified diff，保留空白上下文行且不触发仓库源码空白检查；payload 与容器分别有 hash。

原始源码位于 ignored `test-results/video-atlas-r{1,2,3}-edge-20261004/`。R1 另有 180 / 360 列的六组性能测量，R2 / R3 没有性能通过声明。透明 RGBA 与不透明值一样严格检查；R3 最后四组差异不能忽略。没有 Chrome、实播或设备认证。
