# 聚散真实时间证据

对应[阶段记录](../../../plans/glyph-particles-clock-2026-10-05.md)。失败报告保留，报告各自的源码 hash 和范围为准。

| 文件 | 范围 |
| --- | --- |
| editor-chrome / editor-edge | 生产真实上传，180 列六模式强反馈及精确归位；全屏、暂停、减少动效、三处触控、离线 HTML、短 WebM、SPA 释放 |
| editor-chrome.webm / editor-edge.webm | 实际编辑器鼠标轨迹与恢复，571×713 VP9；申请 30fps 不代表字符画 30fps |
| color-active-chrome / phrase-active-chrome | 实际六模式合同的完整活动帧，不代替动态审美验收 |
| clock-chrome / clock-edge | alpha-zero 算法 fixture、独立 .05 秒参考、真实 Worker、逐次让出执行权及取消；不能用于画质/FPS结论 |
| regular-chrome / regular-edge | 各 24 组 / 720 帧冻结 v9 RGBA、归位、旧 trail、原色/indices及容量 |
| watchdog-chrome / watchdog-edge | 各 21 项虚拟时钟故障；不作真实性能证据 |
| image-chrome | 80 项图片后台冻结像素、事务、取消、全屏、缩放、回退 |
| video-chrome / video-edge | 完整本地短视频及冻结画质、暂停、预解析/取消、全屏、兼容；buffering 仍是事件替身 |
| capacity-edge | 超容量输入零绘制及允许滚动；不是正常容量 Worker 矩阵重跑 |
| editor-dev-r1-failed / editor-dev-r2-failed | 彩色强反馈原始失败，R2 证明实际输入调度问题 |
| editor-dev-r3-partial | 六模式通过后受开发热更新影响，不称完整流程通过 |
| editor-production-r1-failed | 初帧基线未等待导致手机全屏精确归位超时 |
| clock-chrome-r1-failed | 固定 timer 次数的错误断言；状态正确、最大 timer 间隔 48.9ms |

高密度完整反馈仍以秒计。未将工程通过称为所有设备流畅、用户审美或整体商业验收。
