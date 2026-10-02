# 六动效流体重做验证

工程步骤、视觉问题与修复见[阶段记录](../../../plans/fluid-motion-iteration-2026-10-02.md)，可操作对照见[v4 原型](../../../prototypes/v4-fluid-motion/index.html)。开始于 2026-10-02，收尾于 2026-10-03。

本阶段重做电影感六种环境编舞，复用原作字形、原生环境采样和同一绘制工厂。原 Studio 与首页主图受保护。不是新 Navier–Stokes 求解器、指针粒子创新或用户审美认可。

精简报告归档到本目录，原始实验保留在 `sandbox/fluid-motion/2026-10-02-v1/`。首次流光碎块、短视频速度无区分的失败和修复前视频均保留在原始目录；最终证据使用修复后源码，不能用早期绿灯替代。

- [六模式合同](./motion-contract.json)：原生采样、品质/透明场景、旧 Studio 对照、完整归位、确定性和有界预算。
- [面积栅格](./raster-contract.json)：正尺寸、周期接缝、遮罩缓存与独立重建。
- [正式页面](./ui-production.json)、[首页](./home-hover.json)：实际交互、恢复与保护项回归。
- [PNG/离线 HTML](./exports-production.json)、[真实视频](./video-export.json)：实际输出与参数；[首次视频失败](./video-first-failure.json)保留速度无区分证据。
- [最终原型](./prototype.json)、[实际编辑器演示记录](./walkthrough.json)：完整视频尺寸/时长和实际画布时钟。
- [证据清单](./evidence-manifest.json)：文本/二进制分别核验来源。

最终实际编辑器视频保留于 `sandbox/fluid-motion/2026-10-02-v1/walkthrough-final/studio_six_motions_fluid_final.mp4`，H.264、1440×960、38.60 秒；未把大体积视频加入 Git。爆散中段主体辨识度下降及聚合入场裁切属于已记录的视觉取舍。

源码清单按 Git LF 计算；PNG/视频等二进制按原始字节计算。证据清单列明每份报告的来源、范围与 hash。实际浏览器、画布、列数和样本耗时见报告；并发本机样本不是跨设备帧率认证。商业中文、签名、真实设备、私有交付/退款、前端交易与部署继续。
