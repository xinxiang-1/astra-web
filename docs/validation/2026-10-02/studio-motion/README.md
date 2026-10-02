# 六模式环境动效验证归档

完整实施、失败、恢复与限制见[工程记录](../../../plans/studio-motion-iteration-2026-10-02.md)。本目录仅保存成功精简证据；原始输出/失败在仓库`sandbox/studio-motion/2026-10-02-v1/`，不覆盖原失败。

- [原生环境核与120模式/品质/透明合同](./native-motion.json)：720独立原生采样误差0，40完整静态恢复、确定时间和内存边界。
- [开发完整效果合同](./effects-development.json)：独立旧Canvas10静态/品质、九hover、六motion及10UI。
- [生产UI合同](./effects-production.json)：10UI、保存/作品包、离线、触控、暂停/全屏和减少动效。
- [六PNG及离线HTML实际下载](./exports-production.json)：PNG字节一致、HTML真实断网播放/暂停/参数/MIT许可。
- [真实H.264参数](./media-production.json)：选段、速度/强度、正确和错误参考以及暂停/越界。
- [生产hover轨迹](./hover-production.json)：首页及13编辑器轨迹，离开后精确恢复。
- [首页回归](./home-production.json)：13检查、Logo作用域、文字方向和手机布局。
- [实际六动效演示记录](./walkthrough-production.json)：49.680秒H.264，1440×960，六选项真实运行，页面异常0。
- [源码及归档hash](./manifest.json)与[检查回执](./checks.json)。原生合同报告保存当时录制脚本hash；最终录制脚本仅修改截图方式，产品源码与其被测版本一致。

开发效果报告的九个大像素指纹归档为原JSON的SHA256与长度，其余数值保持；原始1664数值/效果的完整报告仍在sandbox，不改原始结果。

最终实际演示文件在本机`E:/project/astra/astra-web/sandbox/studio-motion/2026-10-02-v1/walkthrough-release-r2/studio_six_motions_release.mp4`；影片没有加速或修饰产品画面。归档[慢流中间帧](./current.png)、[重组中间帧](./reform.png)及[聚合完成帧](./assembled.png)来自真实画布。

核对生产影片全时段抽帧及关键状态；不据此声称用户审美认可、真机/跨浏览器或4K实时性能。普通和软件档的计时范围及后续创新见工程记录。产品静态引擎仍2.2.0，首页三个保护源文件保持。
