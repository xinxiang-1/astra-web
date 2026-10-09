# 本地作品索引验证

2026-10-09。前端父提交 cb7a0d776bdcfa9629ede78732b33e26b8e47d92；后台父提交 aec8dc53561a280d91bcd25283b0e86efab2d142。实现和范围见[阶段记录](../../../plans/creative-index-2026-10-09.md)，源码、证据及暂存区字节hash见[source-index.json](./source-index.json)。

- Edge154.0.4258.62、Chrome157.0.8081.0：各12项实际模块/IndexedDB合同，见[Edge](./core-edge.json)、[Chrome](./core-chrome.json)。覆盖version1数据/源文件迁移、并发去重、旧版本保留、轻量索引读取、原子派生与来源包往返、受控quota异常回滚、原生AbortSignal取消、坏原文件hash拒绝、删除保留派生、future version保留数据、阻塞后迟到升级终止/重试、live versionchange关闭连接。
- 打包页面桌面1440×960，两浏览器各12项生产UI；Edge390×844手机/触控模拟12项，见[Edge](./edge/report.json)、[Chrome](./chrome/report.json)、[手机模拟](./mobile/report.json)。实际导入/下载、改色另存、旧版本重新打开、来源精确匹配、调参保存、缺失原作说明、取消/坏文件/离页迟到防护、删除后派生编辑导出、新素材清来源及双主题控件边界。
- 原调色会话9项、跨工具创作7项生产回归通过，见[调色](./ink-regression.json)、[跨工具](./workflow-regression.json)。本阶段没有重跑其它收费HTTP、全站视觉或全套PNG合同。
- `npm.cmd run type-check`、本阶段7个产品文件的ESLint及 `npm.cmd run build` exit0。原始日志在[logs](./logs/)。构建保留已有大chunk、静态/动态导入及插件耗时提示。
- Impeccable对3个改动页面静态检查结果为 `[]`，见[检测](./design-detector.json)。查看了桌面及手机双主题截图；无新增控件横向溢出。检测不能替代全面可访问性或视觉验收。

复跑：dev5173运行 `npm.cmd run test:creative-index`；先生产build、preview4210，再运行 `npm.cmd run test:creative-index-ui`。设置 `ASTRA_BROWSER_CHANNEL=chrome` 切换浏览器，`ASTRA_CREATIVE_MOBILE=1` 启用手机模拟。dev/preview地址分别可用 `ASTRA_DEV_URL`、`ASTRA_PREVIEW_URL` 指定。fixture复用[已提交工程原作](../creative-workflow/source.astra-signature)，测试用全新浏览器上下文，不操作用户的作品库。

实际产品失败记录是[初始核心日志](./logs/core-initial-failure.log)：取消后重复abort导致未捕获InvalidStateError，事务仍回滚；修复后两浏览器无页面异常。另保留脚本误判：[不存在的标题](./logs/desktop-title-harness-failure.log)、[无作品取消后等待生成](./desktop-harness-failure.json)、[手机隐藏保存状态](./mobile-status-harness-failure.json)、[未切素材面板就下载](./mobile-panel-harness-failure.json)。这些是测试定位/前置条件修正，没有为通过脚本改变产品流程。测试另核对实际保存的来源、全息配方参数及库记录。

源码合同在dev加载实际模块，生产UI在preview加载实际build。quota为受控异常，Blob读取为受控暂停，正常渲染、文件校验和数据库操作为实际实现；不是实际耗尽磁盘的测试。截图中的稀疏、低浓度fixture是工程验证样本，不能当作商业人像品质证据。手机包含触控模拟和面板tap，不能代表实体设备或Safari。

本阶段构建来自共享工作区，保留既存棱镜/彩烟/黑洞及研究dirty；这些未纳入本次提交，合同仅覆盖所述创作路由。未测试云同步、双工具统一包、会员/真实资金或生产部署。来源包仅保存关系描述，另一浏览器仍需另行导入签名原作；本地版本不会跨不同封装做语义去重。源码/证据索引不包含自己，避免自引用hash。
