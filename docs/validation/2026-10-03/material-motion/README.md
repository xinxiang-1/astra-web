# 六动效材质与编舞验证 · 2026-10-03

六项电影感重构已经接入同一作品工厂/编辑器/HTML/视频，Studio原生与首页保护保持。步骤见[阶段记录](../../../plans/material-motion-iteration-2026-10-03.md)，可操作对照见[v5原型](../../../prototypes/v5-material-motion/index.html)。用户审美与商业交付仍待验收。

- [六模式/品质/透明合同](./motion-contract.json)：720原生采样、120场景/旧Studio及40精确归位。
- [面积与正尺寸](./raster-contract.json)、[局部方向](./surface-orientation.json)、[冻结换图](./frame-cache.json)：9504/12接缝/96遮罩/8重建及46208局部方向检查。
- [正式UI](./ui-production.json) 与 [首页](./home-hover.json)：10实际编辑器场景、13首页回归、全屏、触控、暂停/减少动效、恢复。
- [PNG/离线HTML](./exports-production.json) 与 [实际视频](./video-export.json)：六项输出及H.264参数对照，免费导出保持。
- [原型](./prototype.json)、[正式演示](./walkthrough.json)、[新旧并排](./comparison.png)、[完整归位](./reform-hold.png)：最终51.16秒对照和39.96秒正式影片。视频原文件留独占sandbox，未将早期失败录像交付为成功演示。
- [工程检查](./engineering-checks.json)、[保留失败](./preserved-failures.json) 与 [证据清单](./evidence-manifest.json)：命令exit、源码/实际Git blob、原始来源hash和PNG原始字节。

原始目录 `sandbox/material-motion/2026-10-03-v1/`。正式影片为 `editor-final-r2/studio_six_motions_material_final_r2.mp4`，原型影片为 `prototype-final/six_motion_comparison.mp4`。查看了三秒抽帧与完整归位原PNG，未作逐帧独立盲评或用户偏好打分。

新流域是解析编舞，聚散快门来自过去75ms的同一字形位置；没有宣称新的真实流体求解器或指针粒子创新。片层解构中段辨识度下降；并发热样本19.3–98.5ms不是手机/4K/持续60fps认证。商业画质/签名、私有交付/退款/前端交易和部署继续。
