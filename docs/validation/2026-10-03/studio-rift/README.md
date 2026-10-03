# Studio流体撕裂原型证据

起点0ad0a5f，使用原生拖尾的真实速度、密度梯度与回弹位移，在同一Astra字形工厂形成撕开与有限反光。步骤、失败/修复和下一步见[工程记录](../../../plans/studio-rift-prototype-2026-10-03.md)，单位与长期要求见[Studio标准](../../../plans/studio-effects-standard.md)。

- [合同](./contract.json)：20模式/適用画质/透明场景，480默认帧与冻结旧版精确一致、480只读比较；20候选/零强度/完整复原、216独立原生速度/位移/密度样本通过，最大误差9.9732e-11。原生求解器和首页三保护源与起点一致；冻结工厂只改类型导入。
- [页面实录](./walkthrough.json)：10实际页面用例、1440×960/H.264/36.36秒；同路径两侧响应、慢/快/绕圈/停住/离开、原色/中文、暂停环境、零强度、全屏/释放、真实减少动效媒体查询、390px触控/释放/精确复原、可见区域停止/恢复以及画质选择实际适用范围。
- [原PNG](./during.png)与[归位PNG](./recovered.png)、[三秒抽帧](./review.png)：已实际查看，用于定位局部形变/颜色/方向，不冒充逐帧盲评或用户审美通过。
- [原有输出回归](./exports.json)：六正式PNG与六断网HTML、暂停/参数/许可/无HTTP请求通过。当前正式输出仍使用原有效果，此检查不代表新撕裂参数已经保存或导出。
- [首页回归](./home.json)：最终构建13组链接/标志/hover/减少动效/移动宽度，无运行异常。
- [工程记录](./engineering.json)：产品类型、严格原型类型、相关lint/build实际exit0，长日志保留sandbox。
- [来源与归档](./evidence-manifest.json)：源码/Markdown按Git LF，报告保留Node原始JSON字节，PNG按二进制；暂存与提交实际blob另验。

原型可操作页：[v7入口](../../../prototypes/v7-studio-rift/index.html)，开发服务 `http://127.0.0.1:5180/docs/prototypes/v7-studio-rift/index.html`。完整影片只留工作区 `sandbox/studio-rift/2026-10-03-v1/walkthrough-r4/studio_native_and_fluid_rift.mp4`，SHA256 `438848458726bbf939d303a50c516ff3b59ecec3d130eafdeee7faa03c93cd88`，未加Git。

R1/R2连接失败、严格类型联合错误、range值格式失败、无头全屏退场和名义/实际输入耗时偏差均保留；最终修复后通过的录像才交付。合同人像最大156800bytes，正式风景中文179200bytes；理论缓冲限制256KiB。录制双画布中位32.2–108.5ms不能外推单画布/持续60fps/真机/4K；原色交互偏弱/慢及面部强形变的细节挤压仍待改善。

本阶段仅原型，没有把新参数加入编辑器、项目/作品包/PNG/HTML/视频；原有免费输出保持。缺商用出处的现有图片仅作内部基准。候选审美、正式输出、粒子/光场、商业质量/模板与前端交易/退款/部署继续，总目标active。
