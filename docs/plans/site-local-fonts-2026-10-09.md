# 公共正文同源字体与启动回归 · 2026-10-09

接续[签名字体首载](./signature-font-web-2026-10-09.md)，本阶段处理公共界面。前阶段Chrome开发页面load超时的原因没有被证明，但诊断实际记录Google Fonts请求3.448秒；当前`main.ts`仍在挂载后插入外部样式表，`index.html`保留两处外部preconnect。界面字体可以同源托管，减少运行时外部依赖。

## 实施与来源

从原DM Sans请求取得官方Chrome154 Windows样式表及四份gstatic v17 WOFF2，原字节、字体版本4.004、版权和SHA256核对。完整OFL来自固定Google Fonts提交`5e8a3ba899557829a76cfdac30fa512bda91d7ca`，校验上游Git blob与SHA256，版权与字体内部记录一致。[来源与原CSS](../research/2026-10-09-site-fonts/README.md)、[本地分发及OFL](../../public/fonts/brand/SOURCES.md)可追溯。

- 本地托管四个未改字体文件，总137,824 bytes；文件名含版本与hash前缀。保留原8条normal400/500/600、italic400、latin/latin-ext及`font-display: swap`声明，只替换URL；字体内部opsz9…40轴原字节保持，不换字体、不改字重或扩大字体覆盖承诺。
- `src/styles/brand-fonts.css`随公共样式载入，去掉挂载后的外部CSS与preconnect。中文无衬线/标题衬线继续采用现有系统回退；签名画像六款字体、绘制算法与作品包身份独立保持。
- 字体延迟时编辑器正常挂载、页头可见，释放下载后实际FontFace加载；字体404时名字输入及独立签名字体仍可使用。失败时正文采用原系统回退，没有新增字体成功假提示。
- 构建后的CSS在根路径及`/font-proof/`子目录正确请求同源四份字体。子目录检查仅证明CSS/字体资源，不能称整站所有图片/API/路由已支持子目录部署。

## 失败与验证

旧全站合同R1要求所有普通页头深色，实际首页亮色页头已在此前主题阶段实现；测试未更新。修正为当前既有亮暗固定色及沉浸页92%底色，保持溢出、焦点、键盘、主题持久化和保护源断言。保护源参考改为上一已验收提交`62c09d0`，覆盖用户授权的早前主站更新，本阶段不改其代码。字体合同R1在浏览器前失败于Windows CRLF与原CSS LF比较；只统一换行后仍逐条严格比较声明，像素断言不放宽。两次失败均保留，不累计为通过。

最终Edge154.0.4258.62 / Chrome154.0.8037.98：

- 每浏览器64组字体RGBA/字宽与原官方CSS字体零差：4样本（英文、扩展拉丁、符号、中英混排）×12/16/32/72px×normal400/500/600及italic400。四份实际HTTP200、`font/woff2`和SHA验证通过。
- 每浏览器16组生产工具/签名/登录/编辑器×两主题×1440/390px：实际FontFace加载、DM Sans正文、无横向溢出，Google字体请求0；另验正文字体404后输入可操作和签名字体实际载入。
- 既有全站合同每浏览器22路由×两主题×两宽度＝88组，键盘菜单、Escape焦点、路由/历史/跳过导航、主题持久化、6个宽度阈值和减少动效合同通过，页面异常0。
- 最终启动合同两浏览器均在字体请求被挂起时打开真实编辑器，页头可见，释放后本地FontFace完成、load完成、外部请求0。此前开发/生产首轮通过仅为历史，不累计。
- 子目录编译CSS两浏览器各4种字重/样式，两个Unicode分片加载完成、四文件均走正确前缀。实际查看14张工具/首页/登录/签名截图；手机整页截图中的屏外懒加载图不是加载完成证据，补查两浏览器滚动后首页三卡共6图均完整解码。

类型检查、最终相关ESLint、根路径生产build与子目录build通过；大chunk和layout-compute静态/动态导入警告保留。本阶段后台只有文档，没有后台代码/数据库/交易权限变更，不声称重跑后台测试。[精简证据](../validation/2026-10-09/site-local-fonts/README.md)收最终原报告、失败历史、许可/资产/构建hash及有限截图。

## 边界与接续

这是外部字体依赖消除与现有风格保真，不是完整画像/视频帧率、跨系统字形、Safari、真实手机或印刷验收。字体文件同源也需要网络，`swap`可能出现短暂回退及布局变化，本阶段未测CLS/弱网整体速度；不能引用启动测试耗时作性能承诺。没有服务工作线程或整站离线能力新增。

完整六方向、真实手写/复杂背景/印刷、素材视频、全站交互、前后端商业联调、后台会员/真实渠道及部署推广仍继续。下一步优先按实际名字所需字符分片研究，须保持原字形、完整缺字检查、原TTF身份及项目恢复；不恢复已停止的墨量实验。本人办理与推广按现有上线方案推进，本阶段无需本人提供新密钥。

复现：`scripts/acquire-site-fonts.py --output test-results/新的唯一报告.json --write-assets`（标准Python，可选`--proxy`），严格固定官方文件hash，不覆盖不同已有素材。根路径build/preview后运行`scripts/site-local-font-contract.mjs`与`scripts/brand-font-startup-contract.mjs`、`scripts/site-shell-contract.mjs`；变量分别`ASTRA_SITE_FONT_OUTPUT`、`ASTRA_FONT_OUTPUT`、`ASTRA_SHELL_OUTPUT`及`ASTRA_PREVIEW_URL`/`ASTRA_BROWSER_CHANNEL`。子目录构建`npx vite build --base /font-proof/ --outDir test-results/site-local-font-base-dist`，以4199预览同目录/前缀，再运行`scripts/site-font-base-contract.mjs`。最终源码/报告和根路径构建绑定本阶段记录，不把历史通过轮次累计。
