# 视频分段证据

对应[阶段记录](../../../plans/video-render-slices-2026-10-05.md)。`source-hashes.json`记录最终源码；较早实验在阶段文档中标明范围，不冒充所有报告都来自同一最终版本。

| 文件 | 结论与范围 |
| --- | --- |
| color-draw-profile | 180列彩色中文的同步逐字绘制成本；没有实际聚散也很慢 |
| color-target-gpu / cpu / expanded-cache | 独立三帧；CPU与扩大缓存均RGBA零差但不满足速度要求，拒绝接入 |
| worker-large-chrome | 180×191字格两帧超过12秒仍完成，最终RGBA零差，真实页面timer/rAF；严格进度校验前版本 |
| watchdog-chrome / watchdog-edge | 各九项明确虚拟时钟故障合同，不表示真实渲染性能 |
| video-r1-chrome | 画质与播放已过，暂停Worker空闲超时，完整失败保留 |
| pause-layout-diagnosis | 独立真实视频复现暂停仍忙、预览尺寸在844×475/356×200变化 |
| video-chrome | 修复浮层后的完整R2，18组冻结绘制、六模式实播、暂停/预解析/全屏/手机/回退 |
| feedback-chrome | 四个主题/尺寸组合，真实本地H.264，buffering事件替身，浮层不改布局 |
| feedback-native-chrome | 最终合同自生成真实VP8 WebM，四个主题/尺寸组合通过，SHA可追溯；无需预存fixture |
| native-fixture-failure | QA自动捕获曾生成110字节空WebM，产品正确拒绝；手动帧捕获修复并验证编码内容 |

`feedback-mobile-dark.png`与`feedback-desktop-light.png`为实际页面截图，已人工查看。输出帧率、网络stall、真机和商业审美不在这些报告的已通过范围内。当前同步图片的中文聚散仍有[生产失败](../glyph-particles-integration/editor-production-r2-chrome.json)。
