# 签名高分辨率 R2 冻结证据

[development.json](./development.json)：72组完整开发输出、指标/几何/模板/hash、24组完整管线计时；候选24/24数值通过，2组4K超2秒预算，commercialVisualPassed/promotion仍false。原始PNG留 `test-results/signature-print-r2-20261004`；72幅编码解码与原RGBA一致，不把缩小对比板当4K原件。

[ui-edge.json](./ui-edge.json)、[ui-chrome.json](./ui-chrome.json)：分别8场真实UI通过，原始目录 `test-results/signature-print-ui-edge-r2-20261004` / `test-results/signature-print-ui-chrome-r2-20261004`。[comparisons.json](./comparisons.json) 核对9幅PNG完整RGBA和9个201600通道的1:1裁片。

实际查看 [历史签名](./beethoven-porcelain-paper-comparison.png)、[中文](./chinese-portrait-night-comparison.png)、[长英文](./english-portrait-paper-comparison.png)：4K结构细节改善但墨版/横条仍明显，仅开发视觉审查。相关严格tsc、ESLint、type-check/build通过；独立计时脚本尚未执行，现有开发计时含部分后台作业重叠。

[阶段与停止决定](../../../plans/signature-print-iteration-2026-10-04.md) · [公式/来源/复现](../../../research/2026-10-04-signature-capacity/README-r2.md)。
