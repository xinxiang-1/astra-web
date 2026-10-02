# Studio hover 对齐证据

本目录仅保留成功精简报告、源码/报告hash、三张实际截图和检查回执；失败与完整媒体在工程记录指定的本机sandbox中，未复制大型输出进仓库。

- `native-field.json`：27独立原生场，7合并输入（每组80事件/20绘制帧），十模式/品质×九hover=90实际像素检查。
- `effects-development.json`：最终独立旧Canvas静态兼容、九hover/六motion/参数及实际UI/恢复/离线/触控。
- `effects-production.json`：minify生产的实际UI/品质/全屏/暂停/设置/作品包/旧classic/断网HTML/触控。
- `trajectories-production.json`：首页原生与九编辑器hover、四品质拖尾同素材S曲线路径，13编辑器最终原像素恢复。
- `home-hover.json`：最终生产13首页检查与响应式/正向文字/减少动效。
- `media.json`：暂停/越界恢复及实际H.264选段、速度/强度快照。
- `walkthrough.json`：实际九效果演示录制范围；视频保留本机，不当作已公开发布。
- `source-hashes.json`：工作区与Git LF规范源码hash；首页三个保护源文件与阶段前逐字节一致。
- `checks.json`：类型/lint/构建、独立/生产统计及离线HTML完整MIT许可检查。

复跑需Node24.12+、Playwright Chromium；视频需ffmpeg/ffprobe。`npm run dev`启动后，用`ASTRA_PREVIEW_URL`指定地址，运行`npm run test:studio-field-parity`（需要开发服务器）、`npm run test:hover-parity`、`npm run test:art-effects`。生产先`npm run build`与`npm run preview`，跳过源码API使用`ASTRA_EFFECTS_SKIP_API=1`后重复真实UI检查。三个新脚本默认独占test-results目录，或分别指定`ASTRA_FIELD_OUTPUT`/`ASTRA_PARITY_OUTPUT`/`ASTRA_WALKTHROUGH_OUTPUT`，不覆盖旧证据。

步骤、失败、实现选择与范围见[工程记录](../../../plans/hover-parity-iteration-2026-10-02.md)，长期约定见[Studio标准](../../../plans/studio-effects-standard.md)。这是Windows/Chromium开发及技术验收，没有替代用户审美、真机、4K实时或整体商业验收。
