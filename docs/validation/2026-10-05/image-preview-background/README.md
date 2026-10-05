# 图片后台证据

对应[阶段记录](../../../plans/image-preview-background-2026-10-05.md)。源码清单记录最终版本；较早报告各自保留 hash，不伪称所有报告都在最终 CSS 修改后执行。

| 文件 | 范围 |
| --- | --- |
| image-chrome / image-edge | 各 80 项冻结画质、事务、取消、全屏、缩放、兼容恢复 |
| large-image-chrome | 实际开发页面静态中文后台绘制、主题点击、真实进度与页面计时器；不是字符帧率 |
| heavy-particles-r1-chrome | QA 的首帧能量错误断言失败，RGBA 三帧为零差；rAF 混入同步参考，不能用作后台性能 |
| heavy-particles-chrome | 修正测量后原生三帧 RGBA、peak、后台成本和页面时钟；不证明实际归位时间 |
| video-edge / video-chrome | 完整六模式短视频、冻结画质、暂停、高清预解析/取消、全屏释放、390px、分段回退 |
| capacity-edge | 编辑器与 HTML 超容量拒绝、允许滚动、输入零重绘；不冒充完整正常容量 Worker 合同重跑 |
| production-chrome | 生产构建真实上传/六模式、80 列聚散精确归位、Worker 全屏与卸载释放、缩放/主题；原 scope 误写 64，以实际 columns 为准 |
| watchdog-chrome | 九项虚拟时间故障，不用于真实性能结论 |
| rejected-experiments | 两种查找表整画失败及原生池后续变慢；原实验 exit 0 不代表通过 |

`large-image-progress.png` 为实际界面完整帧保留和进度浮层，`large-image-complete.png` 为完成画面。该负载由测试显式设置准备好的 ArtFrame，侧栏参数没有跟随注入值，不能当作完整上传流程截图。此前[生产归位失败](../glyph-particles-integration/editor-production-r2-chrome.json)继续保留。

`production-image.png` 使用实际上传和 UI 参数，无开发状态注入。生产检查不证明高密度/所有设备交互性能。
