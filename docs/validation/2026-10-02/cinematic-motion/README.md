# 六模式电影感动效验证

对应[工程记录](../../../plans/cinematic-motion-iteration-2026-10-02.md)。起点 `38bcb37`，Chromium 桌面及触控模拟；用户审美、真机、跨浏览器和商业整体验收继续后续阶段。

- [原生核、六模式/品质/透明、时间与归位](./native-motion.json)：720 原生采样误差0；120电影感场景、120旧 Studio 与起点源码像素对照、40完整恢复；有限网格与释放。
- [开发合同](./effects-development.json)：十静态/品质、九 hover、六 motion、十 UI。原像素指纹仅精简为 SHA256 与长度，原始报告留 sandbox。
- [生产 UI](./effects-production.json)：十 UI、风格脏状态与保存/作品包、旧 expressive/classic 兼容、全屏/暂停/触控/减少动效及断网作品。
- [六种实际 PNG/离线 HTML](./exports-production.json)：PNG 完整原作一致，HTML 保留电影感/速度/强度、暂停、断网播放及许可。
- [实际视频](./media-production.json)：H.264参数与电影感/旧风格解码对照，暂停时 hover 继续；源片段0.2–0.7秒，编码仍有既有一帧边界容差。
- [首页回归](./home-production.json)：13项、文字方向、Logo作用域、hover、390–1440px布局与减少动效。起点三保护文件hash一致。
- [演示记录](./walkthrough.json)与[全过程抽帧](./walkthrough-sequence.png)：真实生产编辑器六种效果，40.200秒、1440×960 H.264。
- [三个实际同源对照板记录](./visual.json)：人像光影/宠物原色/风景中文，18对照及三包装器一致检查。它是开发视觉证据，不是人类偏好训练认证。
- [证据及源码hash](./evidence.json)：18源码文件、12归档报告/图片、三首页保护文件和本地演示原文件的hash；类型/lint/build退出0及两次导航失败恢复记录。

关键画布：[波浪](./wave.png)、[聚合过程](./assemble.png)、[聚合完整归位](./assemble-complete.png)。原始视频在 `sandbox/cinematic-motion/2026-10-02-v1/walkthrough-production-r1/studio_six_motions_cinematic.mp4`；原始对照板在同轮 `visual-r1/`。

复现时保留完整 git 基线历史，启动开发/生产预览并为每次运行设置独占新输出目录。新风格运行 `npm run test:cinematic-motion`；UI与输出分别运行 `test:art-effects`、`test:studio-motion-exports`、`test:art-effects-media`。浏览器地址用 `ASTRA_PREVIEW_URL`，视频对照的源码参考页另用 `ASTRA_REFERENCE_URL`。生产 UI 设置 `ASTRA_EFFECTS_SKIP_API=1`，完整 API 用开发页运行。实际演示运行 `demo:studio-motion`，`ASTRA_MOTION_STYLE=cinematic`。

没有复跑已消费的画质/签名 holdout，也没有新增依赖、部署或真实收款。少量 CPU 计时不能外推手机或 4K 实时帧率；环境逐字聚散不等同于指针能量粒子已完成。
