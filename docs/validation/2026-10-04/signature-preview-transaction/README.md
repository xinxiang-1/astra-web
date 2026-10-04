# 预览替换与最终恢复证据

实现、失败和边界见[阶段记录](../../../plans/signature-preview-transaction-2026-10-04.md)。原始调试在test-results，此处仅收相关精简证据。

| 文件 | 含义 |
| --- | --- |
| [blank-before.png](./blank-before.png) | 97ea3a6误收的最终重试空白截图，保留失败 |
| [fit-failure.json](./fit-failure.json) | 新增全概览断言后复现；602×551全零RGBA与首次作品不同 |
| [native-recovery-failure.json](./native-recovery-failure.json) | 新增空表面注入首轮，旧作品保留但原大裁片超时；同源码重跑通过，原因继续检查 |
| [delivery.json](./delivery.json) | 最终无诊断包装的真实2K Edge→Chrome合同；异常候选保留旧作品，最终适应/原大/再次适应一致 |
| [desktop-viewport.json](./desktop-viewport.json) | Edge桌面8K几何、锚点、四边、移动/对比/异常恢复/卸载 |
| [mobile-viewport.json](./mobile-viewport.json) | Chrome390×844/DPR3镂空裁片4533360通道零差异，分配/取消/恢复/卸载 |
| [restored-preview.png](./restored-preview.png) | 最后成功重试的实际适应画面；仍偏淡/规则，商业审美未通过 |

运行：`npm run type-check`、相关ESLint、`npm run build`、`npm run test:signature-project`、Edge的`test:signature-viewport`和Chrome的`test:signature-viewport -- --mobile --cutout`。回归冻结产品代码，未放宽像素/输出标准；没有性能、总内存、真实手写或Safari认证。
