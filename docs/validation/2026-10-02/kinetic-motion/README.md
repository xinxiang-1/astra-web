# 六动效空间编舞验收

[实施、失败与修复](../../../plans/kinetic-motion-iteration-2026-10-02.md) · [可操作三列原型](../../../prototypes/v2-kinetic-motion/index.html)。本轮升级当前电影感六动效；首页与原生hover保持，用户审美、真机与商业验收继续待确认。

- [动效合同](./motion-contract.json)：720原生采样、120模式/品质/透明场景、旧Studio逐像素及40精确归位、时间/强度/速度、有界网格与实际4096画布。
- [缓存合同](./cache-contract.json)：冻结时间切换不同比例、同网格的作品，透明/非透明与独立新renderer完全一致。
- [生产UI](./production-ui.json)：10操作场景、风格/旧项目/作品包恢复、暂停与hover、全屏、触控与减少动效。
- [实际PNG/HTML](./production-exports.json)：六PNG同hash，六断网HTML风格/速度/强度、播放暂停及MIT保持，零网络请求。
- [实际MP4](./production-media.json)：H.264选段与正确参数匹配，忽略参数/错误速度/强度/风格均显著偏离，原全部断言保留。
- [原型](./prototype.json)、[对比图](./comparison.png)与[生产演示](./walkthrough.json)：18场景和六段实际操作；视频原件在sandbox/kinetic-motion/2026-10-02-v1/walkthrough-production-final/studio_six_motions_kinetic.mp4。
- [视觉审查](./visual-review.json)：全过程抽帧与关键原画布，明确记录解构峰值辨识度取舍；不称用户认可或真机/4K实时认证。
- [首页](./home.json)：13链接/文字方向/Logo作用域、7宽度及减少动效。最终三个首页源码与原生hover整段保持，见[源码hash](./source-manifest.json)。
- [失败](./failures.json)：真实缓存失效、短MP4速度不可辨、生产误用开发模块导入及工具问题；原证据不覆盖。
- [早期开发回归](./development-before-final-fixes.json)：10静态/品质、9hover、6motion、10UI，仅作为最终缓存/入场时间修复前的证据；最终范围以上述合同与实际生产结果为准。
- [证据hash](./evidence-manifest.json)：原报告与精简归档均保留hash，长指纹只压缩为长度与hash。

类型、相关ESLint、strict原型类型检查及生产build退出0。原始日志、第一/第二候选及未晋升表现留独占sandbox；没有新增依赖、收费或部署。网关af6f936阶段已独立推送；私有交易交付、退款对账、真实商户与前端购买仍需完成。
