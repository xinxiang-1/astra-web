# 中文排印与字体匹配补充研究

`search.json` 保存了2026-10-01对公开GitHub的三组关键词搜索；这不是全网穷举。中文ASCII搜索中的zhoulianxiang、lautumn1990、hanzi-ascii等没有返回明确许可；RenJDC为GPL-3.0。typographic portrait里多数目标无许可，亦有明确以旋转180°形成另一幅肖像的项目，与本站保持文字方向的要求不符。本轮均未复制代码或安装它们。

可明确参考的资料：

- [p5.asciify accurate renderer](https://github.com/humanbydefinition/p5.asciify-accurate-renderer-plugin/tree/1d8c9b1948c522d82a7231ef20b00ec884507a1c)，固定commit的LICENSE为MIT。README强调根据可用字形选择拟合输入的字符，并允许固定/采样前景背景。本站的句子顺序约束意味着不能任意交换汉字来提高匹配，也不能把采样背景当作照片还原。本轮采用自己的几何/面积采样实现，保持固定字形与无底图，没有复制此插件代码。
- [textmode.js](https://github.com/humanbydefinition/textmode.js/tree/2361bb33bbdaddbbe029d267a36e6dc3d3226a32)，公开发行物LICENSE为MIT；README明确TypeScript开发源码和构建工具位于私有仓库，不能声称本轮审查或复用了其TS源码。可参考独立字格/字体/图层与可重用atlas；其默认UrsaFont明确CC0，Typr.js为MIT。没有下载或打包其默认字体。

固定源文件URL、commit和SHA256在 `sources.json`。本轮结论是用实际字形边界控制横纵留白，以确定性错行降低周期纹理；字体alpha、色彩和图层保持独立。不存在把MIT库许可扩展到所有搜索结果或用户素材的推断。
