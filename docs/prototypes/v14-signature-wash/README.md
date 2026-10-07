# 完整签名＋彩绘底色对照

接续[v13字符印刷候选](../v13-portrait-styles/README.md)。用一份完整Placement分别绘制原色融合、双色绘影和波普彩绘，完整名字、位置、方向、大小、alpha及墨色相同；只处理明确标注的照片底色。字体辅助由现有OFL字体产生，不冒充真人手写。

`npm run demo:signature-wash`构建独立生产页面并在5187运行，打开 `/docs/prototypes/v14-signature-wash/index.html`。也可以通过开发服务器的同一路径打开。提供公开人像/瓷像、私人本地上传、三种色板、纸/夜、1K/2K、进度、取消、原大缩放及免费PNG。三幅全部完成才替换，参数待应用和失败保留旧组；原大缩放不重新布局。

`npm run check:signature-wash`检查独立页面类型。`ASTRA_PREVIEW_URL=http://127.0.0.1:5187 npm run test:signature-wash-prototype`测试打包页面；Windows使用PowerShell的 `$env:ASTRA_PREVIEW_URL='http://127.0.0.1:5187'`。`ASTRA_WASH_SOURCE`可指定本地照片，输出必须放ignored `test-results/`，不能公开私人源图/衍生图。

两个新底色配方已以“试用”接入正式签名编辑器的浓彩融合；正式页面保存、重开、PNG/SVG及局部高清使用生成快照。这个对照页只导出PNG，不保存作品项目。实现、失败、验证与限制见[阶段记录](../../plans/signature-wash-styles-2026-10-07.md)。不将彩绘底色称为纯签名，也不将sRGB近似称实体双墨印刷或Riso。
