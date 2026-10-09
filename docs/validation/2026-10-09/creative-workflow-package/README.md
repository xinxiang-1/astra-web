# 完整工作流包验证

2026-10-09，前端父提交 cfd815709853cc9fe4846c023021b4efa89c7b5e，后台父提交7ca2d97fdf49bba9a503a3ccdd2a155e363fb083。实施与边界见[阶段](../../../plans/creative-workflow-package-2026-10-09.md)，代码、fixture及证据hash见[source-index](./source-index.json)。

- Edge154.0.4258.62、Chrome157.0.8081.0各21项实际模块/文件/IndexedDB核心合同，见[Edge](./core-edge/report.json)、[Chrome](./core-chrome/report.json)。真实行楷写法及区域色工程图经实际布局生成fixture，验证双方完整字节、参数/落点/字体来源；重导出时间、目录/资产坏hash、截断/附加数据、超限、未来版本、来源ID、字体许可、嵌套引擎与资源释放。新上下文断网后并发去重、三表quota/取消回滚、改后副本与备份版本、未改保存、删原作恢复、id冲突与已有同原作映射通过。
- 生产页面双浏览器桌面1440×960及Edge390×844触控模拟各9项，见[Edge](./edge/report.json)、[Chrome](./chrome/report.json)、[手机](./mobile/report.json)。实际双文件下载、预加载应用后的新浏览器离线导入/恢复、重复版本、未改保存、真实配方编辑、坏包、取消后旧响应、新读拥有状态、删除与双主题边界。Chrome消费Edge生成的原作fixture，跨浏览器恢复有实际文件证据。
- 旧作品索引Edge12核心和12生产UI回归通过，见[core回归](./index-core-regression.json)、[UI回归](./index-ui-regression.json)。此阶段没有重跑其它收费HTTP、全站视觉或全套PNG合同。
- 类型、5个改动产品文件ESLint、生产build exit0；[日志](./logs/)保留构建既有chunk、静态/动态导入及插件耗时提示。Impeccable对改动两页面静态结果 `[]`，见[检测](./design-detector.json)。查看桌面及手机双主题截图，完整工作流按钮/说明不横向溢出；这些不是完整无障碍/审美验收。

复跑需要dev5173与build后的preview4210：`npm.cmd run test:workflow-package`按顺序生成核心fixture再跑生产UI；核心/页面也可分别运行 `test:workflow-package-core` 与 `test:workflow-package-ui`。`ASTRA_BROWSER_CHANNEL=chrome`切浏览器，`ASTRA_CREATIVE_MOBILE=1`启用手机模拟，`ASTRA_WORKFLOW_FIXTURE`可指定其它核心fixture；地址由 `ASTRA_DEV_URL`、`ASTRA_PREVIEW_URL`指定。所有测试上下文全新，不操作用户作品库。

实际产品失败：[未改保存重复版本](./unchanged-save-failure.json)、[原参数诊断](./unchanged-save-before.json)。30项被补成39项，再导入项目数2→3；最终各页面报告检查修复后未改保存仍2项、调参后恢复备份另保留版本，并保存[修复后诊断](./edge/unchanged-save-diagnostic.json)。初始底层脚本字段顺序比较和预期用例计数误判的原始日志单列，不把这些写成产品缺陷。

fixture与示例包保留于core-edge/core-chrome；实际生产下载包分别于edge/chrome/mobile。包包括签名印章像素和许可；没有完整字体或网站应用。离线是在相关应用模块先通过SPA加载后断网，不能证明首次离线安装/PWA、未来新名字字体资源或不同OS的字符字体像素一致。quota为受控异常，取消读为受控暂停；真实数据库事务、文件校验、生成与恢复仍执行实际实现。

工程区域色图、单款行楷与视口模拟不能代表商业素材/复杂背景、六字体全面验收、真机/Safari或264MiB上限性能。共享工作区保留其它棱镜/彩烟/黑洞和研究dirty，未纳入本阶段；验证只支持所述创作路由。后台本阶段只文档，私有工作流交付、会员/真实渠道与部署尚待继续。索引不包含自己，避免自引用hash。
