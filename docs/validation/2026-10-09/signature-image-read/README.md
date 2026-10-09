# 照片读取取消阶段证据

[实施、失败、验证范围和复现](../../../plans/signature-image-read-2026-10-09.md)。新合同只计Edge完整R2、Chrome完整R1各一次；core预检、失败和中间build不叠加最终样本。

- [摘要](./summary.json)：浏览器、12像素/10拒绝/5取消、既有回归、预算及复现脚本/环境变量。
- [旧版基线](./baseline/report.json)及[原复现脚本](./baseline/reproduce.mjs)：基线SHA为`6b142b4c61f427fb02a96486cf2ae272ba8492ef`，450ms人为原生load回调延迟、20ms取消；脚本应在该SHA的独立工作树、前端依赖及5210服务下运行，原输出路径已存在时不覆盖。记录的是回调控制实验，不是真实手机性能。
- [Edge最终](./image-edge/report.json)、[Chrome最终](./image-chrome/report.json)：原始报告原字节，12输入完整RGBA零差、10拒绝/清理、5取消；实际生产作品包恢复、双主题1440/390px取消保留全预览/名字、最新选择、坏图保留及离页释放。两个目录各有4张读取截图和公开工程素材生成的作品包，无私有用户内容。
- [Edge名字库](./bank-edge/report.json)、[Chrome名字库](./bank-chrome/report.json)：原合同没有总`passed`字段，按终端exit0、errors为空及关键断言确认；各6加载/输入/取消、12几何和4原生参考，事务/冲突保留、并发追加和生产刷新/390px。
- [Edge框选](./region-edge/report.json)、[Chrome框选](./region-chrome/report.json)：各4组，原图框选后再处理/确认、失败和主题布局。
- [Edge作品资产](./assets-edge/report.json)、[Chrome作品资产](./assets-chrome/report.json)：各5组，源字节、向量、实际栅格和模板RGBA及部分资源失败清理。
- [失败与中间轮次](./run-history.json)：失败原报告/日志在`failures/`；core R3在`precheck/`，不累计最终计数。npm包装器失败发生在Vite前，后用`npm.cmd`；错素材路径、最少8写法和同名导航选择器均明确修复。
- [检查结果](./checks/check-results.json)：类型、相关ESLint及R3 build均exit0；日志在`checks/`，空日志表示工具未输出，退出码由运行句柄完成结果记录。
- [源码/公开输入/构建身份](./source-index.json)、[8截图人工审查](./visual-review.json)、[文档链接](./document-links.json)及[归档清单](./artifact-manifest.json)。清单不包含自身；源码Git blob经过仓库文本过滤，工作区SHA256是原始文件字节，两者用途不同。

用`ASTRA_PREVIEW_URL=http://127.0.0.1:5210`和`ASTRA_UI_URL=http://127.0.0.1:4210`分别访问开发模块与独立生产dist；`ASTRA_BROWSER_CHANNEL=msedge|chrome`、`ASTRA_IMAGE_OUTPUT`指向新目录，执行`node scripts/signature-image-read-contract.mjs`。不要以`ASTRA_IMAGE_PHASE=core`报告代替生产UI合同。回归脚本及输出变量见摘要；后续复跑应使用新路径，保留本次原报告。

`.gitattributes`对此子树使用`-text`保留字节，日志显式暂存以覆盖全局`*.log`忽略，提交前逐文件核对Git索引。build保留既有大chunk/动态静态导入/stream兼容警告，且共享工作区有既有无关特效改动：它证明本阶段生产浏览器行为，不是干净提交的可复现部署包。后端只文档，未跑无关后端测试、迁移主库或启用真实支付。

读取格式样本不是P1商业素材/视频验收；图片头提示不能防止所有未知格式先分配解码内存，移除src也不承诺所有浏览器立刻终止内部解码。真实手写、慢设备、印刷、作品审美、服务端会员/真实认证资金及隔离部署继续。
