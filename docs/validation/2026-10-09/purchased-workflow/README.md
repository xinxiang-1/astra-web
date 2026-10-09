# 已购签名与完整工作流验证

实施、修正、范围和后续见[阶段](../../../plans/purchased-workflow-2026-10-09.md)，后台证据见[后台目录](../../../../../astra-cloud/docs/validation/2026-10-09/purchased-workflow/README.md)。源码、暂存字节及本阶段证据hash见[索引](./source-index.json)。

- 新实际联调：[Edge](./msedge/report.json)、[Chrome](./chrome/report.json)、[390×844触控模拟](./mobile/report.json)各12项，三种环境分别保存两个实际下载包和双主题截图。工程原包来自[上阶段](../creative-workflow-package/core-edge/)，不是商业商品或用户照片。
- 原字符包实际领取：[7项页面回归](./legacy-report.json)通过；原作/新UUID/hash拒绝/取消/他人拒绝仍验证。脚本更新数据库version2，符合现有产品；不是生产迁移。
- 本地项目页：[9项生产回归](./local-ui-regression.json)通过，含加载应用后的离线恢复、未改保存去重、修改副本保留、坏包/取消及删原作恢复。没有重复声明首次离线安装/PWA。
- 17项原运输合同，前端严格类型、三个改动产品文件ESLint、生产build通过，日志在[logs](./logs/)。[静态检测](./design-detector.json)为 `[]`，已查看桌面和手机双主题4截图；这不等于全站视觉、真机或无障碍验收。

后台实际隔离MySQL/Redis/gateway/private files，可信mock支付实际发放权益，浏览器请求由本机桥转真实网关，未用固定商业JSON替代。auth/me明确模拟503。损坏运输及quota是受控注入，坏格式资产实际注册并由后台校验其完整hash；取消/换JWT暂停的是实际reader。三表事务和解析仍运行真实实现。新模式14项交付+20项网关JUnit实际通过；旧模式13项交付通过，新增工作流专用一项在旧模式条件未启用。两次verify均成功且资源已清理。

后台文件与运输仍限256MiB，本地包264MiB上限不代表服务或低内存设备支持。约140KiB工程样例不代表真实模板、六字体/照片/视频品质、真机/Safari或所有系统字符字形一致。测试身份只在子进程环境中传入，票据不归档；这不是完整真实认证/资金验收。会员/额度、正式商品发布、真实渠道及部署继续。

复跑由[后台阶段](../../../../../astra-cloud/docs/plans/purchased-workflow-2026-10-09.md)的独占夹具启动脚本；先build前端并启动preview4210。直接运行浏览器脚本需要夹具临时环境，不使用长期凭据。共享工作区中其它特效和研究输出保留，未纳入提交。
