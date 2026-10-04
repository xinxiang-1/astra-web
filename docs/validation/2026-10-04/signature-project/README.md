# 可携带名字画验证

实现/边界见[阶段记录](../../../plans/signature-project-iteration-2026-10-04.md)。原始导出和失败保留于test-results，仓库只收精简报告与实际恢复截图。

最后重试原来遗漏适应像素，审查发现截图空白。修正和失败见[预览替换证据](../signature-preview-transaction/README.md)；此目录的delivery.json与恢复图更新为追加完整重试断言后的结果。

| 证据 | 验证 |
| --- | --- |
| [delivery.json](./delivery.json) | Edge保存→空白Chrome恢复；阻止字体/源图请求，16074落点、100实际写法、2K PNG/SVG/高清裁片相同；未应用参数、坏画像/名字库读取失败、11类坏文件、原生预览失败、取消、重试及卸载 |
| [assets-edge.json](./assets-edge.json)、[assets-chrome.json](./assets-chrome.json) | 工程曲线、透明色值压力、真实Long Cang模板与已有矢量；纸/夜背景×普通/镂空各4组，307200整图通道及模板全部零差异、源字节一致、重复释放和context失败清理 |
| [outputs.json](./outputs.json) | 原有免费输出和未应用控件快照、2K实际PNG/SVG不变、真实4K重生成 |
| [mobile-viewport.json](./mobile-viewport.json) | Chrome390×844/DPR3模拟、8K几何与镂空裁片RGBA4533360通道零差异，触控/键盘/恢复/卸载；不代表默认8K吞吐/8K PNG |
| [恢复概览](./restored-preview.png) | 实际恢复结果仍偏淡、规则纹理；没有照片底图；商业审美未通过 |

运行：`npm run type-check`、相关ESLint、`npm run build`、`npm run test:signature-project`；`ASTRA_BROWSER_CHANNEL=msedge/chrome npm run test:signature-project-assets`。现有合同使用Edge的`test:signature-result`、Chrome的`test:signature-viewport -- --mobile --cutout`。PowerShell使用`$env:`设置环境变量。最终回归冻结产品代码和配置。

真实工程和格式验收没有放宽零差异要求。UI文件约8.85MiB，原始图/像素/目录采用明确上限；没有测极限文件整个浏览器内存、真机或Safari。工程曲线不是用户亲签，字体变化继续标为创作辅助；恢复不自动写入名字库，不把这次能力称商业画质通过。
