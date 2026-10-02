# 空间深度动效原型

在仓库开发服务打开 `/docs/prototypes/v3-depth-motion/index.html`。三列分别为 Studio 底座、`685ffc3` 的独立只读工厂、当前产品电影感。使用同一 Astra 作品、时间、强度和原生拖尾。

提供六动效、六模式、人像/宠物/风景、时间定位、暂停、强度和鼠标/触控操作。聚合约五秒归位；层片解构约八秒恢复并停留。没有增加新项目参数或改变首页主图。原始素材仅作既有内部验证，不据此宣称素材具有商业授权。

运行 `npm run demo:depth-motion`，输出目录须为新的 `ASTRA_DEPTH_PROTOTYPE_OUTPUT`；以 `ASTRA_PREVIEW_URL` 指定开发地址。`npm run test:depth-motion` 使用新的 `ASTRA_DEPTH_OUTPUT` 检查透视和面积栅格；原生、六模式和输出继续用既有合同脚本。报告保存实际源码 hash，工程检查与开发视觉审查不能替代用户认可。

步骤与限制：[本轮工程记录](../../plans/depth-motion-iteration-2026-10-02.md)。
