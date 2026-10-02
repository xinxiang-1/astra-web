# 六动效空间编舞证据

起点 `024e8d8`；最终工厂 SHA256 `4562fe7122b852dfa1706cef80490e035ab81fe2a2178d62c8aec07f45a4b192`。完整步骤、真实失败/修复及限制见[工程记录](../../../plans/spatial-motion-iteration-2026-10-03.md)。本目录保留原始报告字节；PNG按原始二进制计算hash，源码/文档按Git LF文本计算，见 evidence-manifest.json。

- motion.json：720独立原生采样误差0，120六模式/适用品质/透明场景、120旧Studio精确对照、40完整归位；零强度/时间与速度/回放一致。
- depth.json / surface.json：9,504正尺寸(.5080–1.2144)、12周期接缝、96冷热遮罩、8面积重建；46,208局部正向映射采样。采样点通过不代表所有连续点的数学证明。
- cache.json：72缓存开启/关闭、同格网换投影比例对照逐像素一致，最大577,536bytes、销毁0；缓存上限4MiB，超限回退精确逐字计算。
- ui.json：最终构建10 UI、暂停独立hover、全屏、项目/作品包/缺字段Studio恢复、减少动效和390px触控释放。
- exports.json：六正式PNG一致，六HTML断网播放、参数/许可、暂停及零HTTP请求。
- media.json：实际H.2641280×960/.533333秒，正确MAE .00266522、错误速度 .02036582、错误强度 .07246292、Studio .02740236；原误差门槛保持。
- home.json / protected.json：首页同阶段13回归；最终首页三保护源、原生完整指针核与起点一致，v5冻结工厂只有类型路径差异。
- prototype.json / editor.json：原型18场景、49.640秒H.264对照；正式编辑器40.840秒H.2641440×960，逐项暂停归零，同回调捕获真实时钟/画面。
- engineering-checks.json：最终类型/相关lint/严格原型/构建退出0，原始日志在sandbox并记录hash。

## 动态演示和实际可操作页面

[可操作原型](../../../prototypes/v6-spatial-motion/index.html)可并排或只看新效果、切换作品/六模式、定位时间和划动。Vite开发服务：`http://127.0.0.1:5180/docs/prototypes/v6-spatial-motion/index.html`；正式本地预览：`http://127.0.0.1:5194/ascii-art`。

完整录像未加入Git，在工作区：

- `sandbox/spatial-motion/2026-10-03-v1/prototype-r3/six_motion_comparison.mp4`，49.640秒。
- `sandbox/spatial-motion/2026-10-03-v1/editor-r3/studio_six_motions_spatial_r3.mp4`，40.840秒。

[并排截图](./comparison.png)与[正式编辑器全过程抽帧](./editor-review.png)用于定位；已查看每三秒抽帧和重组11.849534秒归位原PNG，属于开发审查，不是逐帧盲评或用户审美认证。

120列/720px、并发验证期间八次热样本中位18.0–82.9ms；另96列缓存/未缓存九次热样本聚合29.6/32.7ms、重组13.1/14.9ms。没有隔离持续帧率、低端手机/4K/跨浏览器认证，不以有限样本承诺60fps。分层中段会切开人像特征，需实际观看判断取舍。

本阶段是六项确定性环境编舞，原生指针核保留；新增指针撕裂/粒子/光场、商业画质/签名、真实交易/交付/退款与部署继续，整体目标active。
