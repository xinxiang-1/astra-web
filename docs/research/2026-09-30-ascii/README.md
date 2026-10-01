# 字符艺术项目研究与复用决策

检查日期：2026-09-30。可重跑脚本：`scripts/research-ascii-projects.mjs`。

`search-results.json` 保存公开检索；`sources.json` 保存固定 commit、来源 URL 和文件 SHA-256；各子目录保存原始说明及许可正文。覆盖浏览器转换、动态 Canvas、p5/GPU、多层字符绘制、精确匹配、CLI/Braille 和字符编辑等方向。检索不是穷尽全网，元数据不替代许可正文。

## 已核实的参考项目

### asciify-engine

[项目](https://github.com/ayangabryl/asciify-engine) · MIT · Astra 已安装 4.1.0。

参考：可序列化样式、同一 renderer 预览和导出、指针扰动、环境动效、流式视频。局限：当前固定字格、中文按亮度选择字、Astra 接入静/动态分裂。沿用已有功能时保留 MIT 声明；依赖 Mediabunny 是 MPL-2.0，不能将整个依赖链简单标为 MIT；字体数据亦有各自作者声明。证据见其 `THIRD_PARTY.md` 与本机安装包。

### p5.asciify 与 accurate renderer plugin

[主项目](https://github.com/humanbydefinition/p5.asciify) · [精确匹配插件](https://github.com/humanbydefinition/p5.asciify-accurate-renderer-plugin) · 两者 MIT。

参考：独立转换层、多层字符/背景、字形匹配而非仅按字符顺序映射、按原像素取色。主项目当前 README 明确已归档，后继为 textmode.js；不把归档 p5 依赖链引入当前 Vue 工程。主项目 MIT 不自动覆盖 p5.js、字体、示例素材与插件依赖。

### textmode.js

[项目](https://github.com/humanbydefinition/textmode.js) · MIT。

参考：与框架无关的实时文字视觉、GPU 绘制、创意编码结构；适合后续动态图形层。已核实其自身许可证，尚未完成依赖、插件与字体链审计，本轮不整包替换现有生产引擎。

### collidingScopes/ascii

[项目](https://github.com/collidingScopes/ascii) · MIT。

参考：上传视频、即时效果、参数、视频输出的直接体验。仓库实际文件名为 `LICENSE.txt`、`README.MD`；初次按通用文件名取回失败，随后目录查询与固定 commit contents API 修复。不要把 README 视频或演示媒体直接作为 Astra 宣传素材。没有复制其代码。

### ascii-image-converter

[项目](https://github.com/TheZoraiz/ascii-image-converter) · Apache-2.0。

参考：Braille 每字格 2×4 采样、字符密度、彩色与终端输出。实现是 Go，不作为浏览器运行依赖。本轮独立实现 Braille 编码；若以后复制源码，保留 Apache 许可和相关 NOTICE、标注修改，核对依赖与字体。实际许可文件为 `LICENSE.txt`。

### ASCII_Art_Paint

[项目](https://github.com/Kirilllive/ASCII_Art_Paint) · MIT。

参考：自定义字符/字体、离线编辑、导入导出、明暗主题和图形编辑器思路。沿用交互原则，不整站复制 UI、品牌或示例资产。

## 本轮技术决定

- 新建独立实现的 `src/lib/art-engine` 候选层，实测字形 alpha 覆盖率排序，按字形面积补偿明暗。
- 中文铺字按空间顺序循环原文，亮度控制笔画显现，不按亮度打乱“我爱你”等句子。
- 统一采样、网格、帧描述，支持光影、原色、铺字、轮廓、Braille、网点六种模式。
- 同一候选帧用于静态、环境动效、PNG/TXT 和宣传片；WebGL2 图集实例化批量绘制，Canvas 回退。
- 不叠加照片底图来冒充字符细节；签名页默认 underlay 已改为零，纯签名 PNG/SVG 检查通过，布局画质仍待改进。
- 完整旧编辑器、视频、HTML、本地项目尚未迁移候选层；完成这一步前不宣布全站引擎已统一。

## 许可边界

MIT 代码允许商用、修改和分发，要求保留相应版权与许可文本；Apache-2.0 另有通知与修改标记等要求。上述许可只针对已取得正文的相应代码，不自动授予网站截图、人物照片、字体、音乐、商标或展示视频的权利。

本轮宣传视频使用项目内现有示例与自己实现的渲染结果，音乐由脚本合成；不下载第三方宣传视频。示例照片的发布范围仍需纳入正式部署前资产清单。
