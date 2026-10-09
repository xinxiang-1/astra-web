# 公共字体同源托管证据

[阶段范围与复现](../../../plans/site-local-fonts-2026-10-09.md)、[字体来源及原CSS](../../../research/2026-10-09-site-fonts/README.md)。最终字体合同EdgeR2/ChromeR1、全站EdgeR2/ChromeR1、启动两浏览器R2与子目录R1各计一次，不累计历史轮次。

- [摘要](./summary.json)：四份原字体137,824 bytes；各64字形/16字体页面/88全站页面及延迟/404与子目录字体资源，完整商业目标仍active。
- [Edge字体报告](./font-edge/report.json)、[Chrome字体报告](./font-chrome/report.json)、[Edge全站](./shell-edge/report.json)、[Chrome全站](./shell-chrome/report.json)：原报告字节直存，页面异常0。
- [Edge延迟启动](./startup-edge.json)、[Chrome延迟启动](./startup-chrome.json)、[Edge子目录字体](./base-edge.json)、[Chrome子目录字体](./base-chrome.json)：编译CSS/字体资源范围，不能替代整站子目录部署验收。
- [手机首页滚动解码](./home-scroll-probe.json)：整页截图中屏外懒加载预览不能算已加载，两浏览器滚动后各三卡实际解码。
- [失败历史](./failure-history.json)：旧全站深色页头假设和Windows换行比较错误保留。`checks/`记录实际类型、最终lint、根/子目录build原日志；后台仅文档，无后台测试。
- [来源/保护源/构建hash](./source-index.json)、[人工截图审查](./visual-review.json)、[文档链接](./document-links.json)、[证据清单](./artifact-manifest.json)。14图为开发审查，不代表真实手机/商业审美通过；清单不包含自己。

原报告/日志及来源字节保持，完整许可证随分发。没有个人画像、签名上传、账号凭据或密钥。没有弱网/CLS/FPS/峰值内存或完整画像/视频性能测量，不用这些启动耗时制造性能承诺。
