# 中文字体分片阶段证据

[实施、验证、复现和性能边界](../../../plans/signature-font-subsets-2026-10-09.md)。每项每浏览器最终R1只计一次；Edge core预检不是第二组最终数据，两个build不是两次产品验收。

- [摘要](./summary.json)：实际计数、单次弱网比较和范围。
- [分片生成](./generation/report.json)：固定依赖、逐字符轮廓/字宽/hint/全局指标及布局审计，原报告明确生成时浏览器验证尚未执行；浏览器证明由独立报告提供。
- [Edge分片合同](./subsets-edge/report.json)、[Chrome分片合同](./subsets-chrome/report.json)：各300组尺寸/完整RGBA零差，其中180组纯中文分片；目录/故障/共享取消、串行禁缓存测量、生产重试/换名字/六family和双主题390px。
- [Edge完整字体回归](./full-edge/report.json)、[Chrome完整字体回归](./full-chrome/report.json)：各180组、全Unicode覆盖及完整通道故障/取消；这些报告的额外TTF/WOFF2性能样本不用于本阶段分片结论。
- [Edge名字库](./bank-edge/report.json)、[Chrome名字库](./bank-chrome/report.json)：确定性/完整几何、事务/取消/冲突保留旧库、并发追加及真实UI恢复。
- [Edge作品/抠图](./cutout-edge/report.json)、[Chrome作品/抠图](./cutout-chrome/report.json)：各5组，实际六字体写法、作品RGBA/配方恢复、控制背景、确认和整批取消。
- [轮次记录](./run-history.json)、[源/资产/构建身份](./source-index.json)、[截图审查](./visual-review.json)，文档链接检查见`document-links.json`，归档清单见`artifact-manifest.json`。清单不包含自身；原报告/日志按`.gitattributes -text`保留字节。

`checks/`保留类型、ESLint和最终build日志；索引首轮发现四份日志受`*.log`规则忽略，显式暂存修复见[记录](./checks/staging-repair.json)。本阶段后台只文档，没有跑无关后台测试、主库迁移或启用真实收款。构建在含既有特效/研究改动的共享工作区完成，这些无关改动未加入本次提交；部署需要另外从提交SHA隔离构建。所有用例是公开工程名字和历史公开签名，不含用户私有素材、凭据或环境变量。截图是桌面开发审查，不是真机/印刷或用户商业审美认可。
