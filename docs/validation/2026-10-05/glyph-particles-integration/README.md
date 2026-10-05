# 字符聚散证据范围

对应[阶段记录](../../../plans/glyph-particles-integration-2026-10-05.md)。旧 numerical-edge/chrome、editor、package、media 报告来自分段改造前；numerical-sliced-edge 和 worker-sliced-edge 为改造后复验。数值报告各自记录源码hash，不能将较早报告视为后续所有代码的重新运行。

| 报告 | 实际范围 |
| --- | --- |
| numerical-edge / numerical-chrome | 各24组，六模式与适用品质，720输入帧，冻结v9逐像素、恢复、内存及保护源码 |
| numerical-sliced-edge | generator分段改造后的24组复验，720帧逐像素、自然归位、旧trail、保护源码与容量均通过 |
| editor-edge | 实际编辑器六模式、鼠标/触控、全屏、暂停、减少动效、HTML离线、真实视频 |
| worker-capacity-edge | 12组、888帧Worker/Canvas对照；容量提示初次检查 |
| worker-sliced-edge | 分段后的12组888帧RGBA与活动状态一致、自然归位；容量滚动与编辑器/HTML输入零重绘 |
| capacity-idle-edge | 最终超容量输入零绘制、释放与滚动 |
| package-edge | 真实PNG恢复、17类损坏拒绝、真实视频选段与参数重打包 |
| media-edge / video-probe | 实际H.264导出及既有误差门槛；环境快照，不录鼠标 |
| editor-production-r1 / r2-chrome | 光影/原色通过，中文铺字60秒归位超时；R2单独运行仍失败 |
| failure-history | 缺素材、测试监听失败、产品容量与性能问题分别保留 |

`interaction-chrome.webm`为真实鼠标录制，34个可解码帧、packet时间0–21.308秒，请求30fps不等于稳定30fps。开发截图和录像不是商业审美认证。新的同步generator/后台绘制及故障恢复证据见[视频分段目录](../video-render-slices/)。
