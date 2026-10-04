# 签名容量 R1 冻结证据

- [development.json](./development.json)：36 组、逐图尺寸/模板数/指标/几何/hash、模板墨量、12 组完整管线计时。实际原始目录 `test-results/signature-capacity-partition-r1-20261004`；候选 12/12 数值通过，商业视觉 false、promotion false。
- [ui-edge.json](./ui-edge.json)、[ui-chrome.json](./ui-chrome.json)：分别 8 组真实 UI，浏览器 154.0.4258.53 / 154.0.8037.57；原始目录 `test-results/signature-capacity-ui-edge-r1-20261004`、`test-results/signature-capacity-ui-chrome-r1-20261004`。整幅 RGBA、201600 通道原生裁片、下载 PNG hash、键盘/手机/减少动效检查通过，浏览器均已关闭。
- [贝多芬候选](./beethoven-candidate.png) / [旧纯笔迹](./beethoven-baseline.png)、[中文夜光](./chinese-candidate.png)、[长英文](./long-name-candidate.png)、[手机](./mobile-long-name.png)：实际开发视觉审查，非用户偏好认证。手机截图中 Vite 工具浮标不是输出作品的一部分。

源码与素材 SHA256 存于 development.json，本轮全部复核相符。严格候选 tsc、相关 ESLint、产品 type-check / build 已运行通过。原型/脚本/字体与素材范围、失败和限制见 [阶段记录](../../../plans/signature-capacity-iteration-2026-10-04.md)；自然商业画质、真实私人手写、4K/8K、Safari/真手机和全浏览器内存仍未认证。
