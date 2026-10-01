# 自然照片画质研究与渲染缓存修复 — 2026-10-01

## 结果与范围

本轮画质候选没有通过冻结的最终验收，不晋升采样实现、笔重、gamma 或原色还原参数，也不改变现有作品和旧项目的默认效果。独立完成保持原像素的 Canvas 渲染缓存修复；首页首屏仍使用原 Studio 拖尾 .65/.38、慢流 .45。

目标仍未完成：商业画质、真实设备性能、完整授权商品、付费后端与正式部署不能由此次实验或构建通过替代。

## 数据和许可

实验目录：`sandbox/ascii-optimizer/experiments/2026-10-01-quality-v3/`。候选仅在 `sandbox/ascii-optimizer/quality-v3/engine/`，基线代码、数据 hash、许可原文及下载失败日志分别保留。

45 个来源分为 31 train、11 dev、3 holdout，来源不跨集合。实际筛选使用 6 train + 4 dev；不能将其称为完整 45 图验证。此前 holdout 未用于本轮拟合或验收。

新来源来自 scikit-image 固定 tag v0.25.2；下载字节与 upstream registry 核对。Chelsea、coffee、camera、brick 的许可原文明确 CC0；Hubble 为 NASA public domain，未误称 CC0。最初将 Hubble 当作 CC0 的检查失败与 metadata ECONNRESET 均保留，随后使用缓存及有限重试修复。旧开发照片的内部许可记录不等同于公开商品授权。

本轮不调用付费或外部视觉裁判，API 成本为零。人工检查是开发检查，没有伪装成盲评审美认证。

## 声明的实验与评测修复

六个候选预先声明：baseline、700 笔重、600 + gamma .8、原色还原、600 + 原色还原、700 + 原色还原 + gamma .88。最多两轮，不再扩大参数搜索。

原色候选将色相与强度分开：RGB 以峰值归一，强度通过字形覆盖率/alpha 表达一次。笔重进入字体 atlas 缓存键和 HTML primeAtlas；未传参数必须保持原输出。gamma 候选用于检验提亮是否损伤还原，未因“更亮”直接选择。

第一轮 180 组完成，但低通指标使用默认 bilinear 缩小，产生严重字行混叠。合成灰阶 audit 发现某行几乎全为背景 17，而面积平均由约 18 平滑升到 80。第一轮评分不能用于排名，完整图片与 `development/report.json` 保留；不能将第一轮 9,230.6 ms 的最大值直接与另一种计时协议比较为加速倍数。

第二轮版本 `actual-raster-area-average-physical-cell-color-v2` 对真实 Canvas 像素做含边界权重的面积平均。结构相关常量反例返回 0，不再将无方差误判为满分。色调目标按真实字形最大覆盖率、纸底与源 RGB 定义，并保留覆盖率归一的误差，避免单纯减少墨量得到高分。

第二轮声明结构相关 >= .82、foreground .015–.9、字形裁切 0、原文顺序、无照片 underlay、旧默认兼容；静态冷绘制 <= 1,000 ms、缓存像素 <= 16 MiB。动态另要求完整绘制 P95 <= 33.33 ms。计时为 3 warm + 7 wave，包含同步读回；浏览器、DPR、viewport、字体、源和代码 hash 在报告中。headless Chrome 使用 SwiftShader，不能外推真机帧率。

## 保留的失败与冻结决策

第二轮先尝试有透明间隔的共享图集，默认 PNG 不一致，立即停止；实现快照及未完成报告在 `rejected-packed/`、`development-r2-rejected-packed/`。未放宽像素门槛。随后在同一轮修复为独立位图、单一 OffscreenCanvas 绘图上下文；没有增加参数搜索。61 组开发合同（六模式、三图、wave/breathe/ripple、无 OffscreenCanvas 回退、独立工厂/atlas）像素完全相同。

修复后 180 组第二轮完成，所有旧默认、无 underlay、句序、裁切合同通过。开发集所有模式平均归一误差：baseline .101434、600 + 原色还原 .034421；这是按各字形覆盖率合成目标的误差，不能当作原照片逐像素误差。额外 gamma .88 的 .041869 更差，没有选择提亮。

静态 quality-first 冻结为 600 + 原色还原；较轻笔重候选只用于 density/color，中文在训练集不合格。performance-first 没有合格候选：120 列全模式 P95 未全部通过 33.33 ms。完整选择原因与代码/evaluator hash 存于 `frozen.json`。

冻结后唯一一次 holdout：camera、brick、Hubble，3 来源 × 3 模式 × 3 profiles = 27 组。attempt 文件和 report 阻止重跑。600 + 原色还原在 brick 的结构相关分别为 .728729、.729046、.739370，未达到 .82；归一误差较低也不能补偿结构硬门槛。结论在 `decision.json`：画质候选未通过，生产画质修改为空。没有看到 holdout 后调参或用旧签名 holdout 认证新代码。

## 独立渲染缺陷修复

画质实验失败后，将旧基线存在的缓存反复淘汰问题单独作为修复任务验证，未将失败的画质证据转为认证。生产只更新 `src/lib/art-engine/canvas.ts`；core、types、采样默认、编辑器设置与模式保持原实现。

旧缓存固定 4,096 个彩色 canvas，超过容量的作品在连续绘制中重建字形和上下文。现在复用一个原生尺寸 OffscreenCanvas，保存独立 ImageBitmap；最多 12,000 项且缓存像素字节最多 16 MiB。饱和后复用一个临时字形，不反复淘汰已缓存的前段。没有色彩量化、重采样或改变字形边界。

不支持 OffscreenCanvas 时保留 Canvas 回退，最多 4,096 项且同受字节上限约束。新帧清缓存并关闭 ImageBitmap；destroy 关闭位图并释放临时表面。16 MiB 是已缓存像素的计算上限，另有一个字形临时表面；不代表浏览器、GPU driver、源图、字库、输出画布的总内存。

可重跑的工程检查：`npm run test:art-render-cache`。同一输入、同一真实基线、同一浏览器与同步完成计时的成对结果：

- 120 列：旧 P50 517.8 / P95 2,348.7 ms；修复 P50 26.1 / P95 27.4 ms；缓存 6,469,568 bytes。
- 180 列：旧 P50 759.1 / P95 1,560.4 ms；修复 P50 49.8 / P95 64.1 ms；缓存 11,515,392 bytes。
- 动态帧 PNG 完全相同。16,384 独立色字格强制饱和：缓存 10,699 项 / 16,776,032 bytes，余项使用临时表面；连续帧、透明、hover 保持相同像素。帧更换清除旧数据，destroy 后缓存和临时像素字节均为零。

这证明此测试样例的缓存缺陷修复，不证明 180 列达到 30 fps。真实项目、媒体与最终构建检查记录在下一节。

## 最终工程验证

严格 `npm run type-check`、renderer 与新合同脚本 ESLint、`npm run build-only` 均退出 0。构建仍记录既有 stream 外置、重复动态 import、大包和 Office 附属资源警告，没有掩盖。

`production-default-contract.json`：三开发图 × 六模式共 18 组 PNG/text/alpha/几何全部相同；自定义字体/字格和独立序列化工厂/primeAtlas 通过。生产 core 的 hash 仍为 `e4fadb8345a1829461f545588ee7b20ee8f48e8737b649fa992e971ad6af8348`，editor 仍为 `2c3e590ffd059eeaadd3df1e933a81d9a3847e93a7f26a6992b9aed43c66fe0a`。唯一生产引擎修改为 Canvas renderer，hash `47ef110bc8b7eb745a23caaf19dda30aec613fa51a8439ead6786e339d9dd7ab`。

完整 `test:art-editor` 开发与生产预览均通过，分别保存于 `test-results/editor-contract/quality-cache-development/` 和 `quality-cache-production/`，passed=true、errors=[]。六模式实际下载 PNG、全屏和断网离线 HTML 的像素 MAE 均为 0；TXT、恶意标题、六项目源文件 hash/恢复/刷新、旧项目兼容/显式升级、冻结暂停、390px 无溢出、真实透明 3072×3840 PNG、视频直播/预渲染/字体与模式失效/取消后时间恢复通过。JPEG thumbnail 最大 MAE .016195，保持有损门槛。

实际开发/生产 MP4 均为 H.264、1280×960、.533333 秒；第一帧 ffmpeg 解码 MAE .002350986。选段 .2–.7 秒的边界采样仍有一帧误差；编码文件 hash 不相同，未承诺字节级视频确定性。断网视频 HTML 播放/暂停/重启/循环与字形工厂通过。

最新生产首页 `test:home-hover` 13 个链接、Logo 星芒作用域、hover 选择、减少动效和手机宽度全部通过，无运行异常；证据 `test-results/home-interaction/quality-cache/`。人工查看最新手机首页与中文编辑器截图，首页文字与「浏览作品」方向正常；缓存修复不改变画面观感。

源码与脚本快照保存于 `production-cache/manifest.json`，与实际媒体报告中的 hash 核对。`git diff --check` 唯一现存错误是此前 `docs/plans/ascii-art.md:27` Markdown 行末空格，未修改无关历史文本；新文件与本轮修改未引入该错误。

没有 commit、push、正式发布；用户既有授权覆盖自主实现，未新增审批流程。

## 后续顺序

本次质量研究达到两轮预算并停止。下一画质研究需要新的冻结验收集合与明确预算；当前 holdout 只用于记录失败，不反复认证。优先解决低对比细纹理、中文不同笔画覆盖率的亮部截断，并在 train/dev 验证后才决定新默认。

渲染侧独立继续默认 180 列的完整帧成本、真机/跨浏览器、缓存饱和与手机档位；不借助调小验收分辨率宣称当前高列数达标。随后按照总计划处理签名商业画质、可移植项目包、首批可授权模板、创作/交易 PRD、后端与公测部署。
