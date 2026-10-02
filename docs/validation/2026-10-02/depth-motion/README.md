# 空间深度动效验证

阶段记录：[实施、失败、修复与范围](../../../plans/depth-motion-iteration-2026-10-02.md)。[三列可操作对比](../../../prototypes/v3-depth-motion/index.html)使用 Studio、`685ffc3` 独立工厂与当前产品；首页主图保持。

本目录为精简工程证据。`source-manifest.json` 使用 Git LF 源码 hash；`evidence-manifest.json` 校验归档文件，原始报告的 hash 保留实际运行字节。大像素指纹仅归档长度和原值 JSON/UTF-8 SHA256，原始报告完整保留在独占 sandbox；测试断言未按结果放宽。

- `motion-contract.json`：720 原生核、120 场景及旧 Studio 对照、40 精确归位、时间/强度/确定性和有界内存。
- `depth-contract.json`：9504 正尺寸、12 周期接缝、96 冷热遮罩和 8 项独立四倍面积重建。
- `development-ui.json` / `production-ui.json`：六模式、品质、暂停、全屏、减少动效、项目/作品包、旧字段和触控。
- `production-exports.json` / `production-media.json`：六 PNG、六断网 HTML 与实际 H.264 参数对照。
- `hover.json` / `home.json` / `frame-cache.json`：14 真实轨迹与复原、首页回归、冻结时间换图。
- `prototype.json` / `walkthrough.json` / `comparison.png`：可操作原型与实际编辑器；最终演示 1440×960、H.264、40.960 秒。
- `compatibility.json` / `release-checks.json`：三个保护文件、交互核及基线 fixture、类型/lint/build。
- `failures.json` / `visual-review.json`：固定边框、空等开场、HMR 中的 UI 超时及截短录像；开发视觉观感与实际审查范围。

最终完整演示保存在工作区 `sandbox/depth-motion/2026-10-02-v1/walkthrough-production-r2/studio_six_motions_depth.mp4`。长视频、原始报告和第一/第二候选快照留在该独占 sandbox，不加入 Git。逐一报告的 `originalPath` 指向本地原件；复跑须选择新输出目录，避免覆盖证据。

本次检查为 Chromium 桌面/触控模拟，不证明真机、跨浏览器或 4K 实时。抽帧是开发审查，用户尚未认可审美；解构高峰主动拆开主体，完整展示段再归位。整体商业验收及部署未完成。
