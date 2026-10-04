# 可控预览验证

实现与限制见[阶段记录](../../../plans/signature-viewport-iteration-2026-10-04.md)。报告来自实际生产UI，测试布局为8192×7503、100字体模板、8601落点；此8K墨量12/签名3%–6%用例是极大尺寸与资源边界检查，不是默认8K性能或全幅PNG认证。

| 证据 | 结果 |
| --- | --- |
| [desktop-edge.json](./desktop-edge.json) | 减少动效；最大8倍、鼠标释放/方向键、轮缩误差<1px、裁片RGBA1615280通道零差异、绘制失败重试、卸载释放 |
| [desktop-chrome-motion.json](./desktop-chrome-motion.json) | 正常动效；相同严格合同通过 |
| [mobile-chrome-cutout.json](./mobile-chrome-cutout.json) | 390×844/DPR3镂空；触控取消、方向键、4533360通道零差异、恢复/卸载通过；属于桌面浏览器移动模拟 |
| [wheel-failure.json](./wheel-failure.json) | 保留修复前207px/182px漂移、已更新内联尺寸却读取旧计算尺寸的诊断 |
| [outputs.json](./outputs.json) | JSON/PNG/Path SVG/真实高清裁片快照不随未应用控件变化，2K输出hash与上阶段相同，真实4K重生成 |
| [site-shell.json](./site-shell.json) | 88路由/屏幕/主题组合、导航/焦点/历史/主题/减少动效通过，首页保护源码hash不变 |

命令：`npm run type-check`、相关ESLint、`npm run build`、`ASTRA_BROWSER_CHANNEL=msedge npm run test:signature-viewport`；Chrome再运行`--motion`与`--mobile --cutout`。输出合同使用`ASTRA_BROWSER_CHANNEL=msedge node scripts/signature-result-contract.mjs`，全站合同为`node scripts/site-shell-contract.mjs`。PowerShell使用`$env:`设环境变量；所有UI回归期间冻结源和配置。

三个预览合同都在canvas尺寸分配前拒绝超过2400px的setter；实际rejected为空，观测单表面峰值1500160像素。理论两个1280²概览/展示＋2400²裁片约34.47MiB raw RGBA，仅是这些预览缓冲；模板/缓存/照片/导出/browser/GPU另计。未采集整个浏览器内存峰值。

[桌面概览](./desktop-fit.png)和[移动镂空概览](./mobile-fit.png)保留真实画质及网格限制，[移动最大右下边缘](./mobile-right-bottom.png)展示原生镂空局部，超大放大时完整名字在视口之外是预期几何。没有照片底图混入作品。画质仍偏淡、规则纹理明显，商业审美未验收。
