# 创作数据保留与离开保护 — 2026-10-02

## 本轮依据与边界

上一轮实质进展：六模式效果/作品包和认证边界验证完成，前端46f64fd、后端0807918本地提交完成；现有MCP前端写入403、后端读取404，官方GitHub MCP已配置但用户PAT尚未设置。推送等待不会阻断本地产品完善。

读当前主编辑器确认：图片在解码前释放视频，视频在解码前释放图片，loadFile catch resetAll；snapshot不含源素材，无站内路由guard/beforeunload。按创作PRD CR-001/003/009先修复，不改变首页原Studio/hover、字形方向、引擎2.2.0或免费导出，不使用自然照片实验的最终来源。

证据独占目录 `sandbox/editor-state/2026-10-02-v1/`。原始源码、保护hash、失败与成功报告分别保存，不覆盖失败。不会将本轮可靠性检查作为中文/签名/商业审美验收。

## 预先声明的小步

1. 已完成：核验工作区与前一提交，读上传/转换/保存/路由/媒体生命周期，记录上述丢数据与脏状态缺口。
2. 已完成当前限定验收：准备素材与首帧结果后再提交替换；坏图/坏视频/不支持/超限/取消保持旧作品，最新请求生效，失效候选关闭解码资源。视频使用活动/备用两个元素，成功后切换，失败不修改活动元素。
3. 已完成当前限定验收：源素材纳入保存快照；站内离开/同路由换项目/清空的继续、放弃、保存；保存失败/保存期间有新更改保持原目标；刷新使用原生beforeunload。
4. 已完成当前限定验收：真实浏览器验证坏文件、图片/视频互换、迟到解码、清空/路由/历史返回、保存异常、键盘/390px和资源释放，严格类型/lint/生产构建与生产关键合同。
5. 已完成：更新PRD/总计划与执行记录，整理可提交证据。后续继续授权原创模板样品、商业质量和前后端交易/部署。当前阶段不声称S1/S2或商业目标完成。

## 实施小步与保留的失败

1. 保存28项基线源码与SHA256。首次mkdir缺父目录失败后创建父目录成功；一次大patch匹配失败未修改文件，拆分后成功。基线在baseline/，首页/主引擎/签名为保护项，主编辑器为本轮计划改动。
2. 新增art-media-source.ts：先校验非空/64MiB，再在备用资源中解码，验证首帧/尺寸/视频有限正时长，最后交给主view提交。图片取消/失败关闭ImageBitmap，视频候选失败释放URL与备用DOM资源。尺寸最小2px、最大3200万像素/16384px；图片尺寸检查在解码后，不能称预解码内存保障。视频候选20秒超时。
3. 主view分开loadingSource/converting与sourceError，源revision进入保存快照；失效转换/卸载/迟到preset和项目查询加generation保护，file input清空支持同文件重试；换图第一帧成功后才释放旧素材。没有新增引擎档、付费能力或第三方依赖。
4. 新增原生dialog与路由leave/update、beforeunload；清空经确认后解除原projectId。保存只标记捕获快照，保存失败不离开；保存期间源替换不把新源标成已保存。
5. 首次development/report.json严格Canvas比较失败：加载状态和meta同时显示两行，Canvas由580×725变564×705，页面异常为空。修正条件链为单一状态，保持严格相等；测试仅将dataURL断言改为SHA256，避免把整幅base64写入失败日志。
6. development-r2连接拒绝，开发服务尚未就绪。中断后确认原句柄丢失且5180无监听，再启动新服务；实际冷启动52178ms，确认ready后复测。未覆盖失败目录。
7. development-r3通过坏文件/64MiB/取消/迟到/源脏状态/视频保护等10项，连续3次Tab后的activeElement为body，焦点循环失败。dialog加入首末可用按钮的Tab/Shift+Tab循环，原生modal仍负责背景不可交互与Esc。
8. 增加实际1×2、16385×2、5700×5700图片尺寸分支，以及延迟真实IndexedDB提交完成回调的保存竞态检查。development-r4在最长边错误失败：长错误提示折行触发ResizeObserver和缩放。status统一预留两行高度，保持完整错误可滚动阅读，未放宽像素断言。
9. development-r5通过尺寸、两类保存竞态、弹窗焦点/Esc、存储不足后重试、同路由/历史取消。390px测试尝试点击被既有布局隐藏的editor-back而超时，属于测试入口错误；改用实际可见的“Astra首页”链接触发相同route guard。保留report/failure与七文件源码快照。
10. development-r6与production通过；脚本新增每轮自动保存七文件原始源码/SHA256。现有编辑器/媒体/作品包脚本改为选择活动.video-thumb.show，有意整页重置明确接受原生beforeunload；保护弹窗的继续/保存/放弃仍在本专项真实操作，不绕过guard。
11. 焦点/状态布局修复后相关ESLint、严格vue-tsc与Vite生产构建exit0。stream外置、大包、签名static/dynamic import重叠和插件耗时告警保留。只读排查三次Select-Object参数误写文字、一次查询旧文件名失败，已改为数字及实际art-projects.ts，没有写入影响。
12. GitHub授权已生效：新MCP账户xinxiang-1，原前端46f64fd和后端0807918已非强制推送，MCP核验一致；后端纯文档回执c6b9ac1已推送核验。用户新增“每完成一个小阶段即提交推送”已写入两仓库记录。本轮编辑器阶段将在验收通过后独立提交推送。
13. 生产作品包回归通过10图像（六模式＋四品质场景）真实PNG/源hash/全部设置恢复一致、17类坏包与存储不足无写入、旧legacy/真实视频0.2–0.7秒/390px下载。视频效果回归通过暂停独立hover与越界渐隐，实际H.2641280×960时长0.533333秒；正确参数参考误差0.009446，对照忽略参数0.097417。没有将编码误差称逐像素一致。
14. 生产首页13项链接/Logo隔离/hover/减少动效/七宽布局通过，无页面异常。保护基线中除计划变更主view外的27文件SHA256一致，覆盖首页原Studio、主字符与签名引擎。素材guard不改变引擎版本2.2.0，不翻转字形或收费已有导出。
15. 审查测试覆盖发现保存竞态最初只改名称，不能作为全部设置变化的直接证据。只扩展测试，新增保存期间对比度0.2→0.35与实际库旧值/新值断言，并补Shift+Tab反向循环；development-r7与production-r2再次各通过21行为场景＋1原生关闭事件，无产品源码变更，不重复已通过作品包/媒体/构建。两组最终七文件hash与当前源码一致。
16. 检查生产桌面/390px截图，提示正文/三个操作完整可见，没有横向溢出。收集5份通过报告、2张真实截图、27保护hash、源码manifest、5次失败摘要到docs/validation/2026-10-02；原失败/源照片/视频与大图留在独占本机目录，没有混入发布素材。

## 本小阶段验收与下一步

当前Chromium153.0.8010.12限定场景通过，父提交46f64fd。本轮提交范围为上传候选与生命周期、离开提示、脏状态和保存竞态、测试入口适配、PRD/总计划及本阶段证据；后端代码未在本轮再次修改。原完整16JUnit/7模块verify成果已推送，纯文档回执c6b9ac1可回溯。

精简证据：[开发](../validation/2026-10-02/editor-state-development.json)、[生产](../validation/2026-10-02/editor-state-production.json)、[作品包](../validation/2026-10-02/project-package-production.json)、[视频效果](../validation/2026-10-02/effects-media-production.json)、[首页](../validation/2026-10-02/home-hover-production.json)、[保护hash](../validation/2026-10-02/protected-files.json)、[源码manifest](../validation/2026-10-02/editor-state-source-manifest.json)、[失败摘要](../validation/2026-10-02/editor-state-failure-history.json)、[验证摘要](../validation/2026-10-02/editor-state-verification.json)。正式阶段commit精确SHA以Git历史和推送回执为准。

本轮不认证任意素材/真机内存/跨浏览器/自然照片、中文或真实手写商业审美。下一小阶段继续模板合同第4项的真实交付验收：三原创模板包、成品/离线HTML、manifest/许可来源、新浏览器/手机编辑导出；再推进商品/交易文档、后端权益与部署。整体目标继续执行。

## 复跑

启动实际开发/生产服务后，使用新的独占输出目录，运行npm run test:art-editor-state；ASTRA_PREVIEW_URL指定服务，ASTRA_STATE_OUTPUT指定目录。需要Playwright Chromium与ffmpeg。输出包含真实截图、H.264素材、report.json和该轮源码快照；旧失败不覆盖。

此测试含受控慢解码、真实IndexedDB完成回调延迟与QuotaExceeded注入，不将其宣称为真实磁盘故障、真机、Safari/Firefox或审美验收。
