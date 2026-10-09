# 签名字体首载阶段证据

[实施、失败、复现与性能边界](../../../plans/signature-font-web-2026-10-09.md)。最终EdgeR2、ChromeR1只各计一次；抠图使用EdgeR1、ChromeR2，ChromeR1页面超时保留为失败。名字库使用EdgeR2。

- [摘要](./summary.json)：实际计数、弱网测量与范围，不能代表完整商业验收。
- [原字体转换报告](./transport/report.json)：全部42,143 glyphs、cmap、非变换表和尺寸/hash，原报告字节直接复制。
- [Edge完整字体合同](./web-edge/report.json)、[Chrome完整字体合同](./web-chrome/report.json)：各180组原TTF完整RGBA零差、所有Unicode覆盖、畸形文件、损坏/取消/重试及生产UI。
- [名字库回归](./bank-edge/report.json)、[Edge六字体/抠图](./cutout-edge/report.json)、[Chrome六字体/抠图](./cutout-chrome/report.json)：完整名字、原库事务保护、六字体作品恢复、控制背景提取与生产入口。
- [失败历史](./failure-history.json)及`failures/`保存转换R1/R2、名字库R1、Chrome抠图R1与导航诊断，不累计通过轮次。
- [源/构建/许可身份](./source-index.json)包含原TTF/OFL/项目相关源不变证明，传输文件SHA、生产静态资源与最终源；`checks/`保留类型、最终ESLint和build原日志。后台本阶段只文档，没有跑无关后台检查。
- [人工截图检查](./visual-review.json)记录六字体样张、两主题桌面/390px、抠图桌面/手机；只是开发审查，未宣称真机/印刷/真实用户审美通过。
- [文档链接](./document-links.json)、[归档清单](./artifact-manifest.json)用于复核本次精简证据完整性；清单不包含自己。

原报告/日志由`.gitattributes -text`保留字节。只归档公开工程测试名字和历史公开签名的有限截图，原大图/作品包、个人素材、环境与凭据不入Git。W3C网页本体留在ignored目录，摘要仅保存真实获取的hash与第7节来源。
