# 官网主题、下拉与六幅作品

用户要求展开的下拉也有样式，官网切换亮暗，替换六幅作品。导航、正文区和页脚改用共享主题变量；原生 select 的 slot option 改为 deep 样式，支持浏览器使用 base-select，旧浏览器与高对比模式保留原生回退。保留已认可按钮及首页主图的交互、字形、参数和墨色。

六作品改为山岳、建筑、星环、沙丘、鹰和帆船。用真实引擎预生成字符预览，卡片lazy加载；无需在浏览作品时计算六张大画布。4:5保持完整主体，老链接通过alias进入对应新作品。原始素材保留，来源见[资产记录](../../design/artwork-collection-20261005/README.md)。

Edge / Chrome生产构建各15场通过：两宽度两主题、真实展开/选择/键盘、首页画布主题前后hash相同、六卡加载且零canvas、分类/搜索/空结果恢复、四个实际编辑器入口及asset hash。[精简证据](../validation/2026-10-06/site-theme-collection/results.json)。type-check、相关ESLint、build通过；保留既有chunk、JSZip/stream和动态import提示。

接续回归：旧首页hover脚本硬编码缺失的Playwright Chromium，修为可选已安装browser channel；这是测试启动问题。Edge首页13项hover/手机宽度及签名主题工作台13场随后通过。原始证据保存在本地test-results。本机浏览器验收不等于Safari、真手机或线上部署。完整逐字图像提示词未在接续上下文取得，记录实际原件和场景摘要，不虚构。
