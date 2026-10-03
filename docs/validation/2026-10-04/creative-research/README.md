# 研究候选与基线证据

- `particles-contract.json`：20模式/品质/透明合同、30/60Hz恒定力、实际鼠标/空闲/减少动效/390px/触控模拟，通过。矩阵360px/64列，实际页面720px/112列，Edge154；不外推到真机或4K实时。
- `particles-hover.png` / `particles-mobile.png`：已实际查看的单幅候选鼠标与减少动效手机截图。截图内P95为有限活动窗口，不是正式性能认证。
- `baseline-audit.json`：五名字共200字体变体的真实alpha/织排容量，12路由×桌面/390px样式与溢出检查。真实页面PNG留原`test-results/creative-audit-1791056635684/`。
- `video.json`：Native VP9 WebM真实编码尺寸、时间轴、byte/hash；原文件在`test-results/glyph-particles-video-1791057429153/`。5秒模拟不等于5秒实际影片，请求30fps未核对每个编码帧。
- `failure-history.json`：初始事件harness错误、读回、透明归位、双幅鼠标响应失败和最终20组成功记录；完整报告本地保留，没有覆盖旧失败。

最后严格tsc、相关ESLint、产品type-check/build退出0；产品源码与首页保护源未修改。阶段说明、取舍与剩余范围见[实施记录](../../../plans/creative-research-iteration-2026-10-04.md)。
