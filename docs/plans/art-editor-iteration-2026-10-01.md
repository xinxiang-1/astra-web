# 2026-10-01：主编辑器六模式与媒体合同迁移

本轮属于工程集成与回归验证。继续用户已授权的多模式引擎优化；首页首屏的 Studio 拖尾、慢流和既有 hover 不修改。长期商业化目标仍在执行，不把本轮媒体合同通过等同于画质、真机、支付或部署验收。

## 1. 输入与边界

- 原工作区存在大量未提交改动，保留已有实现；没有 commit、push 或正式发布。
- 开发验证服务 `http://127.0.0.1:5180`，生产构建本地预览 `http://127.0.0.1:5181`。5181 本轮重新构建后使用最新产物。
- 图片合同使用已有开发样例 `public/artwork/portrait.jpg`；工厂回归再使用 landscape、pet。它们是开发回归样例，不是新的审美 holdout，也不据此认证素材商用权。
- 视频使用 ffmpeg `testsrc2` 生成的 320×240、12 fps、1 秒合成片段，避免引入新的第三方视频许可。
- 浏览器为 Playwright Chromium 153.0.8010.12，桌面 1440×960、DPR 1；手机布局模拟 390×844。没有声称这是实机 Safari/Android 或商业性能验收。
- 之前签名迭代的冻结 holdout 不重跑、不选参；签名 GPU gate 保持关闭。

## 2. 自包含采样与渲染工厂

先将原候选单文件复制到隔离的 `sandbox/ascii-optimizer/editor-v2/engine/`，保留迁移前基线 `experiments/2026-10-01-editor-migration/baseline/`，再抽出 core、canvas、types。

`createArtCore(defaults, version)` 包含采样、实际字形覆盖率 atlas、灰度处理与六模式转换。`createCanvasArtRenderer(target)` 包含 Canvas 绘制；两者不依赖模块外辅助变量，可以内嵌到 HTML。`index.ts` 保留 WebGL 包装用于实验页/其他已有入口，版本为 `2.0.0-candidate.2`。

新增可选字体、字格和抖动参数；不传新参数时，默认结果保持原候选输出。Atlas 按字体和字符库缓存，字符库最多 512 个字形（含空格），最多缓存 12 组。HTML 的 `primeAtlas` 复用导出时的字形 PNG，减少另一台设备缺少字体导致的替换。

工厂合同：三幅开发图 × 六模式共 18 组，默认 PNG 字节、字符文本、alpha 与几何完全相同。字体/字格变化确实作用于输出，工厂 `.toString()` 后独立执行并预置 atlas 仍可复现。

Bayer 数组从每格分配移到格子循环之外。先修改隔离副本，并通过 18 组相同比较，再同步生产；这是不改变输出的分配优化，没有重新进行审美调参。原记录 `contract.json` 保留；另存 `contract-bayer.json` 和最终生产工厂记录。

## 3. 主编辑器接入

新建作品默认使用 calibrated；六模式为光影字符、原色字符、中文铺字、轮廓线稿、点阵细节、印刷网点。字体、字格、色板、曝光/对比度、抖动与中文阈值接入共享 `ArtSettings`。

预览、全屏、PNG、TXT、缩略图、预渲染帧和离线 HTML 使用 `ArtFrame`。主编辑器采用同一 Canvas 工厂，以保证离线网页和 PNG 的绘制合同。GPU 包装继续供已有实验/展示入口使用，不以本轮结果认证 GPU 和 Canvas 完全相等。

- 全屏按全屏容器尺寸适配，指针坐标取当前画布；退出时释放该 renderer。
- PNG 固定长边尺寸，透明背景保留实际 glyph alpha；动效和指针扰动不写入静态 PNG。
- TXT 保留当前帧的文字排列，中文与 emoji 按 grapheme 顺序，不拆分组合 emoji。
- JPEG 缩略图仍有压缩损失，不能称逐像素相等；合同设 MAE < 0.03，保留实际测量。
- 动效支持静态、光息、流动、聚合；hover 支持光晕、涟漪、轻推和关闭。
- 暂停冻结当前动效时间，不切换为静态重新排画；恢复重置计时起点。调度上限 30 fps，离屏、标签隐藏、减少动效、下载及预渲染期间暂停。不把调度上限称为实测帧率。

保存项目增加 engine、模式、动效和 hover 设置。没有 engine 字段的旧项目仍进入 legacy；用户选择新模式才切换 calibrated。新项目保存原 File，重开检查源文件 SHA256、字体、字格、色板和效果设置，刷新继续恢复。

`/ascii-art?engine=legacy` 保留旧入口。`ascii-consistency-smoke.mjs` 原本断言 Studio 的 columns×6 和 `.live`，因此显式测试 legacy；新默认页面由新合同脚本覆盖，未把新 Canvas 改成旧测试的尺寸。

## 4. 视频和离线网页

### 视频

视频导出冻结设置、动效和选段；逐帧共享采样/Canvas 渲染，将 native raster 交给原编码器，`bufferFrames: 0`，避免把同一可变 canvas 多次存入缓冲。

预渲染缓存保留完整 typed frame，默认 96 MiB 的 cell/text 缓存上限。颜色、字体、字格、模式等变化使缓存失效；解析期间设置变化或取消会停止旧结果晋升。取消按钮只请求中止，待任务真正结束再恢复可操作状态，避免两个任务共用一个取消标记。

成功、取消和内存失败都返回原视频时间。预渲染的 PNG/HTML/TXT/缩略图取正在显示的缓存帧，避免重新读取另一个源视频时间。

真实导出合成视频的选段为 0.2–0.7 秒，输出 H.264 MP4、1280×960。现有帧规划包含边界采样，文件时长约 0.533333 秒，在一帧误差内；不是精确 0.5 秒剪辑器。ffprobe 验证并用 ffmpeg 解码第一帧，与选段起点的共享 Canvas 栅格比较；有损合同 MAE < 0.035。

### 离线 HTML

新 `src/lib/art-engine/embed.ts` 将实际 indices/alpha/colors、字形 PNG atlas、设置、源尺寸和工厂函数保存在一个 HTML 中，无 CDN。标题使用 textContent，JSON 转义 `< > &`；实际用 `</script><script>window.injected=1</script>` 作品名验证不会执行。

图片使用固定帧，视频内嵌原 File dataURL 和选段；可播放/暂停、重启、下载文本并保留 hover。网页视频初始化等待 seek 完成，之后 seeked 触发重画；循环时先回到入点再采样，避免显示选段之外的帧。静止或减少动效的图片不持续空转 rAF。

实际通过 file:// 打开导出的文件，浏览器 offline=true，记录 HTTP 请求为零。开发版与生产 minify 后的网页都必须运行，而不只检查 HTML 字符串。

视频 HTML 的源文件上限为 64 MiB；当前只限制并提示，不做素材压缩或裁剪。因此选段很短也会内嵌整个源文件。系统减少动效禁用装饰动画，用户主动播放的视频仍正常播放。旧 legacy HTML 继续依赖原 Studio CDN，导出文案与新离线入口区分。

## 5. 实际发现的失败与修复

1. 接续时主编辑器模块返回 HTTP 500，页面空白。格式化将模板内两条赋值合并成 Vue 无法解析的表达式；改成 `selectArtMotion` 方法。旧摘要里的类型/UI 成功不能代替对当前最终文件的编译检查。
2. 第一轮下载的 density PNG 与离线 Canvas 不同，归一化 MAE 0.00483994、901,981 通道值不同。原因是编辑器 GPU 与离线 Canvas 使用不同栅格路径；统一主编辑器的 Canvas 工厂，保持严格的零差异要求。
3. 原字体独立 watcher 只重新转换，没有清除/暂停旧视频缓存；字体加入共同失效合同。
4. 原暂停切换 motion=none，会重画静态；改成冻结时间。全屏原来沿用普通预览尺寸且没有转发 hover，补全实际容器适配与事件坐标。
5. 解析失败和取消没有恢复源时间；恢复放入 API finally。取消过早清掉 busy 标记的问题一并修复。
6. 预渲染导出原来重新读取源视频，可能与当前缓存帧不同；静态输出改为显示中的 ArtFrame，实时播放打开导出时先暂停并生成完整帧。
7. 测试驱动也有错误，未作为产品缺陷：File 跨 Playwright evaluate 的返回不能直接读 name，改在浏览器内提取元数据和 SHA256；隐藏的高级控件需要先展开；片段起点是 range，且完整长度需先缩短才能移动入点；初始 wave 的参考渲染必须包含 wave(time=0)。失败报告保留。
8. 合成片段有重复画面，单次采样偶然相等不能认定视频冻结；改为多个固定间隔样本检查。生产媒体失败记录保留，不放宽像素误差或跳过视频检查。
9. 原 legacy UI 脚本要求静态文本和动态 Studio 都为 columns×6，实际旧入口动态按舞台/DPR 适配，静态使用原字体 painter，该假设与当前代码不符。第一次严格执行超时的日志保留。未改旧产品效果；脚本改为检查真实舞台尺寸、动态响应与关闭后原像素恢复，记录范围为 legacy 兼容，不再声称两种栅格相同。新默认编辑器仍要求六模式预览/PNG/HTML 零差异，Studio 原生栅格另由 API 合同验证。

## 6. 验证与证据

主要脚本：`npm run test:art-editor`，另有 `--media-only` 用于定位媒体问题；最终验收必须执行完整 suite。

完整合同覆盖六模式实际 UI、六模式 PNG/离线 HTML/TXT、中文与组合 emoji、恶意标题、透明 4K、六项目重开/刷新/源 File hash、旧项目兼容及显式升级、图片动效/暂停/减少动效、390px 六模式、视频低清实时/高列数预渲染、字体/模式失效、取消返回、真实 MP4 解码和网页选段循环。

已完成的开发与生产记录：`test-results/editor-contract/development/report.json`、`production/report.json`。六模式 PNG 和离线静态 MAE=0；JPEG thumbnail MAE 约 0.00474–0.01619。4K 透明 PNG 实际 3072×3840。开发 MP4 第一帧解码 MAE 0.00235099；不同运行可因有损编码产生不同文件 hash。

全屏补充后最终记录使用 `development-final/`、`production-final/`，在本文件最终验收段填写终态，避免把旧版本结果认证后续改动。

缓存 API：`npm run test:art-cache` 真实通过六种模式 × 成功/取消/内存拒绝，均检查返回原视频时间；结果 `test-results/editor-cache-contract/report.json`。上限用极小 maxCacheBytes 强制触发，未以浏览器崩溃测试内存。

首页 hover 13 组链接、星芒作用域、减少动效和手机宽度检查通过；`test-results/home-interaction/editor-migration/`。首屏 Studio 参数继续为 trail .65/.38、current .45。

严格 type-check、相关 ESLint、生产 build 已通过一次。构建保留已有 stream 浏览器外置、重复动态 import、大包和 Office 附属资源警告；日志 `test-results/editor-contract/build-final.log`。后续最终检查记录见下段。

## 7. 最终验收记录

全屏补充后最终 `development-final/report.json` 与 `production-final/report.json` 均 passed=true、errors=[]。六模式 PNG、全屏静态和离线静态的像素差为零，全屏 hover 实际生效；六项目恢复、刷新、源文件 hash 和旧无 engine 项目显式升级通过。390px 六模式没有横向溢出。

两端真实 MP4 都为 H.264、1280×960、0.533333 秒，解码第一帧 MAE 0.00235099。网页视频保存 0.2–0.7 秒选段，播放、暂停、重启及循环通过，断网打开无 HTTP 请求或运行异常。视频是有损合同，文件 hash 随编码结果保存。

最终生产工厂 `contract-production.json` 再次与原基线比较：18 组 PNG/text/alpha/几何全部相同；自定义字体、字格、独立工厂及预置 atlas 合同通过。

原 `test:art-engine` 的五素材 × 六模式 30 组、透明 4K、确定性和动效回归通过，输出在 `test-results/engine-v2/editor-migration/`。合成灰阶候选 MAE 0.001378、旧基线 0.086800 仍只是灰度指标。该 headless GPU 路径最大 P95 170.1 ms，性能不合格/未认证，不能称 30/60 fps；主编辑器 Canvas 的实机性能需单独验证。

`test:art-glyphs` 通过：字形方向 upright MAE=0，镜像/倒置明显更差；光晕没有改变字形 mask，涟漪微移不反转文字。`test:ascii-studio-render` 的挂载/静态像素、实际 PNG/透明、native 流式视频和原生帧缓存通过。legacy 五素材 × 五清晰度舞台/静态恢复共 25 组通过；原不适用的 columns×6 超时见失败段，不使用兼容检查替代新引擎合同。

最终严格 `npm run type-check`、相关 ESLint、`npm run build-only` 均退出 0。构建警告仍记录。`git diff --check` 仅报告此前 `docs/plans/ascii-art.md:27` Markdown 行末空格；未因此修改无关历史文件。

最终生产 `test:art-ui` 退出 0：首页、画廊搜索/筛选、预设、上传、本地保存/重开、PNG 尺寸及手机导航/编辑器/导出，无运行异常。开发 `test:ascii-artwork` 退出 0，保留的首页 Studio 动效、拖尾转发、暂停、对比滑块、减少动效及离屏停止通过；证据分别见 `art-ui-production.log`、`home-studio.log` 和对应 screenshots。

源码快照与 manifest：`sandbox/ascii-optimizer/experiments/2026-10-01-editor-migration/production/`。保留 Git HEAD `51868c55c0f08f2cfd2e75d38a8db2268586cea7`，但本轮源码是未提交状态，因此同时保存文件 SHA256：

- core：`e4fadb8345a1829461f545588ee7b20ee8f48e8737b649fa992e971ad6af8348`
- Canvas：`39f7da13128969b494fd6359402b235759416e02a82e69f0be5ac953d393db70`
- embed：`e640c01ec18ae89748f49cdac72ad69c496eb586649f6bb06f45cba0c42f6fcd`
- editor：`2c3e590ffd059eeaadd3df1e933a81d9a3847e93a7f26a6992b9aed43c66fe0a`
- prerender：`0f2aebcb47c3c07cdd80e509f10fd8ea45485560a2130fdb150b53bbb029f3ee`

## 8. 未完成与下一轮

- 自然照片仍偏淡，轮廓线稿只是方向字符边缘，不能当作精细矢量描摹；中文含 emoji 时字格宽度仍受最宽字形影响。下一轮在隔离区做自然图片与可读性评价，不能只用低 MAE 证明好看。
- 主编辑器 Canvas 的高列数彩色视频可能昂贵；30 fps 调度不是性能保证。需要桌面/手机实机记录冷启动、稳定 P50/P95、内存和质量档，再决定 GPU 晋升/Worker/降级。
- 视频仅本地短片段验证；大文件、长时视频、Safari 编码、真实音轨保留、可取消视频导出及精确端点仍需要专项验收。现有作品视频是字符画画面导出，未新增保留音轨能力。
- HTML 内嵌 atlas 不依赖系统字体重绘静态作品，但跨浏览器 Canvas 解码/色彩管理仍待验收；64 MiB 是输入限制，非输出大小/低端设备保障。
- 本地项目恢复经过检查，但可移植项目包、云同步、迁移版本校验及完整损坏数据恢复尚未完成。
- 签名 GPU、旧笔迹严格 SVG、真实手写商业审美保持之前的未通过/待验收状态。
- 收费仍按模板包与新增付费创作能力优先，展示特效定制服务；本轮没有开发账户订单支付，也没有把已有免费导出收费化。

下一轮：冻结一组可商用授权案例与参数 → 在沙箱提高自然照片与中文可读性 → 真机质量档/性能 → 创作 PRD 和首个模板包交付合同 → 后端交易与公测部署。
