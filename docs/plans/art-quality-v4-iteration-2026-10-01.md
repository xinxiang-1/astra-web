# 自然纹理与中文笔画 — quality-v4，2026-10-01

## 启动与边界

上一轮属于实质 progress：缓存缺陷修复、默认与真实媒体合同均有当前源码和产物证据；画质候选最终失败，完整目标仍未完成。本轮继续推进自然图像和中文铺字质量，不将兼容性回归当成商业画质。

采用项目 `ascii-engine-optimizer` 隔离流程。原 quality-v3 及签名 holdout 不重新渲染、不用于本轮选参。生产首屏 Studio 拖尾 .65/.38、慢流 .45 与原 hover 保持。

用户已授权自主研究、优化/替换引擎与具体实现；本轮不调用付费视觉模型，不发布、提交或推送。晋升只在冻结评测和工程合同通过后进行。

## 新研究声明

实验目录 `sandbox/ascii-optimizer/experiments/2026-10-01-quality-v4/`；候选 `sandbox/ascii-optimizer/quality-v4/engine/`。基线复制当前生产，包含已验证的 16 MiB 字形缓存修复。所有画质实现先留在候选目录。

假设：原字形在小字格直接缩放时会丢失墨量；不同汉字覆盖率差异又造成高亮区域的 alpha 截断。尝试高质量字形过滤、有预算的两倍栅格后缩小，以及有边界 padding 的轻描边补偿。只能绘制字形，不能放照片底图；文字顺序和正向字形不变。

六候选：baseline；600 笔重 + 原色还原；在其基础上高质量过滤；两倍采样；高质量过滤 + 中文墨量平衡；两倍采样 + 中文墨量平衡。gamma 固定 1。最多两轮，不继续无界试参。

复用 quality-v3 的真实像素面积平均 evaluator 公式，新数据与新实现重新运行基线。冻结门槛为结构相关 >= .82、foreground .015–.9、native clipping=0、无底图、原文顺序、默认兼容、静态冷绘制 <= 1,000 ms、字形缓存像素 <= 16 MiB、额外两倍采样表面 <= 32 MiB；动态另要求完整绘制 P95 <= 33.33 ms。若没有动态候选达标，如实记录，不用低分辨率结果认证高列数。

47 来源：32 train、12 dev、3 holdout。实际首轮使用 7 train + 5 dev 的 216 组；未测的来源不计为验证。前轮 train/dev 保持分组，旧 holdout 完全排除。新 gravel 为训练细纹理，Wikipedia text 为开发文本/宽比例；新草地、NASA 宇航员、SpaceX 发射为冻结验收，冻结前不看图/不渲染。

使用 scikit-image 固定 v0.25.2 原始资料和 registry 图片 hash。grass/gravel 明确 CC0；NASA/SpaceX/Wikipedia 图像按 upstream 记录的 public domain，未统称 CC0。首次 raw GitHub 超时失败保留；后续 raw 失败时从同一 tag 的 GitHub contents API 取得 base64 字节，再核对 registry hash，不换成未知镜像。旧示例的公开发布许可仍需另验。

Consolas 和 Microsoft YaHei 系统字体文件 SHA256 已锁定；不复制或分发字体二进制。浏览器、GPU、viewport、DPR、代码/图片 hash、warmup 与采样数在报告中保存。当前字体/host 测试不外推其他设备。

## 当前实现与检查

候选代码包含：可选过滤档位；两倍采样仅在最长边 <= 2,048 且额外表面 <= 32 MiB 时启用，超过预算改为高质量过滤；中文 atlas padding 与最大 1.25px 描边、七次有限二分拟合实际覆盖率。默认无新参数时仍走原字形、采样和渲染分支。

第二次 setup 成功，47 来源来源分组 validator 通过。首轮评测将保存 overview、原生 crop、字形覆盖率差异、实际色调/结构误差、冷/热 P50/P95、裁切与缓存占用。真实失败保留，完成后补录选择和最终验收；本文件不会提前称商业画质完成。

## 首轮与第二轮协议修复

首轮完整 216 组记录在 `development-r1/report.json`，对应源码保存在 `round1-engine/`。六档均至少有一项静态门槛失败。两倍采样与墨量平衡在 gravel 中文铺字的结构相关为 .8218，但开发集 pd-text 同模式只有 .69346；不能据单个改善案例晋升。缺省兼容、原文顺序、无底图及 native clipping 合同通过。首轮 WebGL renderer 显示 SwiftShader，不能作为本机 GPU 或跨设备性能认证。

诊断脚本 `quality-v4/check-host-gpu.mjs` 表明本机 Intel UHD Graphics 770 可通过 `--enable-gpu --use-angle=d3d11` 使用；第二轮声明并采用此环境，重新运行相同六档基线。WebGL 的 renderer 信息不能证明全部 Canvas 绘制始终在 GPU 上。评测脚本补充释放大尺寸 native crop 画布与基线 renderer；不同环境/表面生命周期的性能不能直接混作一次普适对比。

第二轮针对中文低对比图加入固定字格几何的墨量校正：批量绘制字形 stamp，读取实际 alpha，有限 4 MiB 临时表面和 4,096 项 gain memo；不读取照片作为底图，不随动画调换文字。最初实现用原始 Canvas tile 估算，却用 tinted ImageBitmap 进行实际绘制。合成字形审计证实来源类型造成误差，主动中断不完整评测；失败记录及源码分别保存在 `development-r2-rejected-backend/`、`rejected-backend/`，没有作为合格结论。

`backend-audit.json` 中的「山」字在同一 fractional 位置与高质量缩小条件下：GPU target + Canvas source 覆盖率 .2855482934；CPU readback target + Canvas source 为 .3222948439；CPU 或 GPU target + ImageBitmap source 都为 .2855482934。原估算因此高出约 12.87%。修复仅将估算来源改为实际 renderer 使用的白色 tinted tile，保留 evaluator 和 .82 门槛，六参数档位不变。修复后的第二轮输出 `development-r2/`，日志 `development-r2-repaired.log`；属于同一第二轮实现缺陷修复，不扩展第三轮参数搜索。

来源类型修复阶段尚未冻结候选，也未查看/渲染本轮 holdout。后续规则：若完整开发评测没有满足声明范围的静态候选，则在两轮预算结束研究，保留失败与下一轮研究问题，不进行默认晋升。若有合格候选，先补独立工厂/atlas、回退、透明与内存合同，再冻结源代码、评测脚本、档位/模式范围及浏览器环境，最后只运行一次 holdout。

## 第二轮完整结果与冻结范围

修复后 216 组全部完成，缺省兼容、无底图、中文顺序及 native clipping 合同通过。中文低对比 pd-text 仍失败：baseline .39008、faithful .63641、filtered .77898、supersampled .77941、balanced .69597、full .69386。修复来源类型是真实缺陷修复，但未解决中文低方差图的结构损失；不能把人像通过代替此失败，也不扩展第三轮继续试参。部分中文高过滤案例 foreground > .9。第二轮所有彩色参数档在多个自然照片上冷绘制 > 1,000 ms，完整读取的最大 P95 为 11,829.1 ms；D3D11 环境本身不等于更快，原始数据保留，后续须分离 Canvas readback/后端切换成本。

仅未着色 `density` 模式获得静态合格候选。质量优先 filtered 的最小结构 .86954、平均 .96853、平均 normalized MAE .02407；平衡候选 supersampled 的最小结构 .86121、平均 .96641、normalized MAE .02357。基线的 gravel 结构 .78905 失败，对应 filtered .86954、supersampled .86121。balanced/full 在 density 的墨量平衡参数没有作用，像素分别等价 filtered/supersampled；不会把重复档位的性能波动当作新的画质收益。faithful density 也达静态最低线 .83313，未作为最终质量候选。没有全开发集动态 30 fps 合格档，performance-first 留空并写明原因。

`quality-v4/contracts.mjs` 的 26 项原创合成工程合同通过：六模式默认 PNG/TXT 兼容、独立序列化采样/渲染工厂、冻结 atlas 与字体绘制禁用后的重采样、无 OffscreenCanvas 回退、alpha=0 无底图、透明/hover、1K/2K/4K/8K 表面预算和 destroy 释放。结果及实际源码 hash 在 `engineering-contract/report.json`，未使用 holdout，也不代表商业审美验收。

最终冻结只包含 baseline、filtered、supersampled 三档的**静态、未着色 density**，120 列/720px 测量范围，不包括中文、彩色或实时档认证。冻结脚本验证完整开发与工程报告、候选资格及相同源码，以独占写入保存 `frozen.json`。最终脚本只按已冻结模式执行；增加源图/基线/声明 hash 验证及 PNG/crop hash 元数据，不更改指标公式、参数或门槛。新 grass/astronaut/rocket 在此决定前没有查看或渲染。最终不合格则停止晋升，不依据 holdout 改参数。

## 唯一一次最终验收

冻结后仅运行一次新 grass/astronaut/rocket holdout，共 9 组。filtered、supersampled 的 6 组合均达到静态门槛；基线在 grass 结构失败。grass 结构：baseline .73777 → filtered .84527 / supersampled .83143；astronaut .98236 → .98973 / .98976；rocket .96213 → .98131 / .97973。三个来源的平均 normalized MAE 为 .029915 → .022063 / .021918。完整报告、PNG/native crop hash、字体/浏览器/原图 hash 在 `holdout/report.json`；合格静态 Pareto 两档在 `holdout/summary.json`。

holdout 冷绘制最大 59.8 ms，但两档完整读取 P95 最大 131.3 / 138.8 ms，未达到 30 fps。所有测量只针对本机 Chrome 153、DPR 1、120 列/720px、锁定字体和原始三来源，不是跨浏览器、手机、全部列数或商业审美认证。只有 12 个开发来源及 3 个新最终来源实际测量，不能把 manifest 的 47 来源称作全部通过。人工抽查了中文原生 crop、人像、最终 grass crop 和离线成品，未进行付费或盲序视觉裁判；API 成本为 0。

## 正式编辑器接入

按用户已授权的持续引擎优化，生产晋升**仅 600 笔重 + high / 有预算的 supersampled 两条 density 分支**，版本 `2.1.0`。没有复制未通过的 gamma、原色校正、中文 padding/描边或 fitted coverage 校正代码。生产 core 和 renderer 都将品质分支限制为未着色 density；包装 renderer 在品质请求时使用已验证的 Canvas 路径。

主编辑器在「光影字符」的单色图片下提供「经典 / 精细 / 柔和」三档；默认经典保留原参数，精细采用 high，柔和采用两倍采样并 high 缩小。新档更适合静态图片，UI 提醒动效可能变慢；视频、彩色及其他模式保留经典，切换到不支持的场景会重置品质。没有增加下载收费或改变首页首屏 Studio 与 hover。

`artQuality` 纳入重绘 watch、视频缓存键、本地项目设置/脏状态与恢复；缺字段旧项目和无效值恢复经典。保存重开/刷新后保持相同档位。PNG、全屏、缩略图和离线 HTML 复用同一帧/Canvas 工厂，冻结 atlas 的 key 纳入笔重，离线重采样不要求安装字体。两倍采样只在最长边 <= 2,048、额外表面 <= 32 MiB 时启用；超限使用 high，缓存仍 <= 16 MiB，destroy 释放临时表面。

## 接入验证与保留的失败

- `test-results/art-quality-contract/report.json`：12 train/dev × 两档 × 720/1080/3840px 加释放检查，共 96 项；生产与冻结候选的 text/indices/alpha/colors/字形及实际 PNG 相同，品质请求包装 renderer 为 Canvas。没有再次使用 holdout。
- `test-results/art-quality-default-contract/report.json`：三开发图 × 六模式 18 组，生产与晋升前基线的文字、alpha 和透明动态/hover PNG 相同。
- 开发 `test-results/editor-contract/quality-v4-development-repaired/report.json` 与生产 `quality-v4-production/report.json` 均通过：原六模式 PNG/TXT/全屏/离线 HTML、六项目与刷新、透明 4K、真实选段 H.264 MP4，以及两品质档的透明 4K/全屏/断网 HTML/保存/重开/刷新/彩色退回/390px。两新档的静态 PNG、全屏和 HTML 与参考 Canvas 的变化像素均为 0；JPEG/视频仍有编码损失，不称字节或像素相等。
- 首次开发 UI 检查因 `[data-quality]` 同时匹配按钮与画布而在手机断言失败，保留 `quality-v4-development/` 和原日志。只将测试按钮选择器收窄为 `button[data-quality]`，未修改产品以迎合测试；修复后开发/生产均完成。
- 严格 `npm run type-check`、相关 ESLint、`npm run build` 通过。构建仍有既有大包、依赖声明与插件耗时提示；没有改变依赖或构建配置。
- 开发与生产各 13 项真实首页 hover、Logo 选择器隔离、减少动效及手机屏宽检查通过，无运行时异常；独立目录 `test-results/home-interaction/quality-v4-development/`、`quality-v4-production/`。首页首屏继续 `engine="studio"`，没有替换原交互。
- 晋升源码快照、冻结/最终报告 hash 和验证路径保存在 `production-promotion/manifest.json`。生产 core `2a4739243842b8a84641e2af6be10b6751940c5c280319ec3b5cbbea1ac6b54d`、Canvas `f17e38e33286e7505834b66e3e2a8c023059a04cdd96367a8672fda8b67b0ba6`；不是将未通过的完整实验引擎原样复制到生产。`git diff --check` 仅报告此前 `docs/plans/ascii-art.md:27` 的尾部空白，未顺手更改。

本轮达成的是可选静态灰阶品质档及其真实媒体/恢复合同。中文低方差图、彩色后端/readback 成本、真机 30 fps、签名商业质量、完整素材许可、项目包、模板商品/后端交易和部署仍未完成；没有提交、push 或发布。下一轮使用新的研究声明/最终来源继续定位中文墨量与彩色成本，不复用本轮或以前已消费的 holdout 拟合。
