# 中文光学排版与颜色合成 — quality-v5，2026-10-01

上一目标轮属于 progress：可选灰阶品质档通过冻结验收并接入，当前工作树及开发/生产真实媒体报告仍证明该进展。完整目标仍包括多模式商业画质、签名、丰富动效、官网、视频和工程记录；没有将静态灰阶子项当成整体完成。当前 goal 保持 active。

本轮继续项目 ascii-engine-optimizer 隔离流程。生产 baseline 为已接入的 2.1.0，候选位于 `sandbox/ascii-optimizer/quality-v5/engine/`，声明/数据/报告位于 `experiments/2026-10-01-quality-v5/`。不修改 quality-v4 冻结实现，不再次运行其或更早的 holdout，不增加付费裁判、发布或提交。

## 声明与假设

v4 来源类型修复后，中文 pd-text 仍低于结构 .82，证明不能只修颜色/笔重。新假设是字体上下留白造成重复横向纹理，在低对比素材里超过真实图像信号；将按字形实际 alpha 的并集边界做光学紧凑字格，保留安全边缘和文字顺序。裁切审计必须使用实际绘制原点，不以重标注掩盖裁切。

彩色在 D3D11 的逐色 ImageBitmap 路径冷绘制可达数秒；尝试缓存字形 alpha、在有限工作表面上合成 RGB，而不按每种颜色创建位图。仅字形内可见颜色，alpha=0 必须没有照片/颜色底图。动效/hover 不改文字顺序与方向。目标是推动中文与原色商业画质和绘制成本，不能再次只交付容易合格的灰阶子集来替代完整范围。

最多八档、两轮：baseline；v4 full 参考；紧凑字格；紧凑 + 600；紧凑 + 600 + 两倍采样；软件颜色合成；紧凑 + 软件；紧凑 + 有限墨量平衡 + 软件。gamma 固定 1，无新随机搜索。冻结门槛继续沿用 .82、foreground .015–.9、native clipping=0、顺序/无底图/缺省兼容、cold <= 1,000 ms、缓存 <=16 MiB、两倍表面 <=32 MiB；软件 alpha 缓存 <=4 MiB、工作 buffer <=16 MiB，动态另要求完整读取 P95 <=33.33ms。原评价公式不改，重新运行成对当前基线。

声明先于实现和参数筛选保存。性能协议为三次 warmup、七次完整读取；冷绘制已超过静态门槛时可以直接淘汰，后续 timing 明确标为未测而非 0，不认证动态。该减少失败档重复计时的规则在新声明中明确，不追溯修改 v4 原始报告。

## 数据与许可

保持 v4 的 train/dev 分组，排除已消费的全部 holdout 来源。新最终来源选 eagle（摄影师 CC0）、clock（摄影师 public domain）与 skin（作者 public domain），从固定 upstream registry SHA256 与明确的许可说明取得；冻结前不查看/渲染。不同资料的许可不统称 CC0，也不将代码库许可代替图片许可。下载的真实失败保留，网络异常不单独作为整个目标 blocked。

当前生产首屏 Studio 与原 hover 保留，免费导出继续免费。本轮的诊断、失败、选择、工程合同和最终晋升必须逐项补录；此启动记录不代表已经实现或通过。

## 来源下载与定位证据

47 来源 setup 和 source-grouped validator 通过，分组 32 train / 12 dev / 3 holdout。GitLab raw 的 eagle/skin 返回 403，保留日志 `experiments/quality-v5-setup.log`；从同仓库、同不可变 commit 的 GitLab API raw 成功下载，字节仍严格匹配 upstream registry SHA256。没有换成未知镜像，也未查看三个最终来源。

`quality-v5/audit-optical.mjs` 只对 train gravel、dev pd-text 诊断原 v4 full。原中文 tile 为 26×32，非空笔画 bbox 基本落在 y=3…25；额外留白形成周期纹理。按原面积平均尺度测量，pd-text 源目标灰阶标准差 .0241711，均匀灰色经过字形后产生 .0221290 的标准差，即真实信号的 91.55%；gravel 对应 60.03%。原文顺序不乱仍可能被字格自身条纹淹没。该诊断指标用于解释失败，不替换 .82 evaluator 或调整最终权重。原始字形逐行覆盖率与数据保存在 `optical-audit.json`。

## 第一轮实现和先测失败集

候选 core 从真实字形 alpha 并集取得边界，保留 1px 安全边缘，并记录新的 paintX/paintY；native clipping 用此真实原点重新绘制审计。改动只对 opt-in phrase 生效，默认 atlas/key 保持。字形覆盖率按新 tile 重新计算，仍按输入句子循环排字，不叠照片底图。

候选 softwareRaster 使用字形 alpha 积分表做实际像素面积采样，有限 mask memo 和按行条带的 premultiplied RGB source-over 合成；每条带仅一次 putImageData，不创建逐色位图。alpha/积分表总量 <=4 MiB、RGBA 工作缓冲 <=16 MiB；颜色不量化，分数位置初版以 1/4096px 量化，mask 最多 4,096 项。默认仍使用原 Canvas tiles。

首先测 gravel/pd-text 两失败源的 48 组同第一轮子集，结果 `development-r1-probe/report.json`。紧凑排版真实改善中文：pd-text optical-bold .9118、optical-software .9033（v4 full .6939）；gravel 分别 .9424/.9417。原位字符、无底图和基于实际原点的裁切合同通过。但紧凑档 foreground .925–.961 超过 .9，当前**仍不合格**，不会只展示结构提升掩盖此失败。

软件不紧凑的 pd-text 中文为 .7818，仍不合格；其像素面积采样已提高自然纹理与色彩 fidelity，但不能据此声称中文完成。软件暖绘制在 gravel P50 约 49–62ms，未达到 30 fps。mask memo 达到 4,096 项时实际只占约 0.9–1.4 MiB，存在容量/分数位置成本问题，后续需在声明预算内校正，而非放宽动态门槛。

保持相同源码和八档参数继续第一轮完整 12 源筛选，复用已完成的两源而不重复渲染；脚本校验 engine hash、字体、浏览器/renderer/viewport/DPR、候选参数及环境相同，记录复用报告 hash。完整第一轮目标 288 组，尚未冻结或渲染新 holdout。源码不在运行期间修改。

## 第一轮终态与第二轮声明

完整第一轮 288 组已完成，报告 `development-r1/report.json`；汇总保存在相邻 `summary.json`。R1 engine、benchmark、声明与 hash 已在 `round1-source/` 独立快照保存，第二轮不会覆盖其结果。所有组原位裁切=0、默认兼容、顺序、无底图检查通过，但不能等同所有画质/性能门槛通过。

中文 baseline 仅 6/12 静态合格，最小结构 .3901；v4 full 为 11/12，仍在 pd-text 失败。光学 bold 的最小结构 .9118，但 12/12 因 foreground 超 .9 淘汰，最高 .9897；光学 software 同样仅 1/12 静态合格。原字格 software 为 11/12，pd-text .7818 未过。彩色旧位图方案各档仅 2/12 静态合格，其余 cold 最大约 2.4–3.3 秒；software 彩色 12/12 静态合格，最小结构 .8684、最高 cold 333.8ms，但最大完整 P95 63.9ms，仍不能认证 30fps。未测 timing 的 null 没有当作 0 或动态合格。

第二轮为最后实现轮，保持八档、来源、公式、.82/.9 和全部预算：

- 光学字格安全留白从每侧 1px 改为每侧 3px，保留真实 bbox 与 paintX/paintY，预期降低挤满字格的前景比例；不改变字体大小、文字顺序或指标。
- 软件分数位置缓存从 1/4096px 改为 1/32px，最大位置舍入误差为 1/64px。允许最多 16,384 项，积分表+mask 总内存仍最多 4MiB。RGB/alpha 强度不量化；需实测画质和时间，不能由缓存设计推断合格。
- 工厂包装对 optical/software 请求和已验证的单色 density quality 请求使用 Canvas；backend 必须报告实际路径，避免调用方误走未验证 GPU。

本声明保存后才修改 R2。R2 继续 288 组成对筛选；不开放第三轮，不提前查看新 holdout。动态若仍不合格，应仅考虑有证据的静态功能，记录明确适用范围。

## 第二轮结果、工程合同与冻结选择

R2 完成 288 组，原始结果 `development-r2/report.json`，所有八档失败仍保留。software 的 density/color 各 12/12 静态和动态门槛通过，最小结构 .86844/.86844，完整帧 P95 上限 18.9/18.6ms；彩色平均归一化物理颜色误差从 baseline .19511 降至 .02186，首次绘制最高 316ms。该结果限定当前 Chromium 153、Intel UHD 770 / D3D11、120 列、720px，不能外推 4K、全部设备或真实视频 30fps。

中文没有合格档：3px 留白 software 前景比例恢复预算，但 pd-text 结构 .77382；原字格 software .78177，均低于 .82。光学 smooth 同样 .78098。不能利用平均 .94 掩盖低对比来源失败。R2 达到两轮实现上限，光学/中文墨量/gamma 均保持隔离；下一研究必须重新声明，不能再改本轮参数或用最终来源拟合。

工程合同保留了两个失败 harness：第一次把透明素材上的空白位置误当作乱序；修复为按非空字格验证原句的绝对位置。第二次对透明低 alpha 的直通 RGB 用字节误差断言，受到 Canvas 8-bit 预乘存储再反预乘的舍入放大（直通差可为35）；独立 source-over oracle 改为验证物理预乘颜色与 alpha，alpha 字节误差=0、预乘最大1.364字节。它不改变图像质量 evaluator 或任何开发门槛；两个失败日志/报告均保留。

修复后的 `engineering-contract-repaired-v2/report.json` 共80合同通过：六模式默认像素；各档独立 factory/primeAtlas 的真实嵌入 atlas；字体缺失回退与实际 paint origin；透明/彩色/RGBA 的独立合成公式；三动效×三 hover 的变化和确定性；零 alpha 无底图；4K/8K 条带与切回；cache 饱和/释放。1/32px 相位相对 R1 高精度路径在独立合成图的平均字节差约 .146/.145、最大5/4，最大位置误差1/64px。mask 饱和4,194,296字节，8K working16,711,680字节，均在原预算内。

选择冻结：quality-first 保留已接入精细过滤的 density 对照（optical-bold 在此模式 optical 不生效）；balanced 和 performance-first 选 canonical software 的 density/color。三个 software 命名在 density/color 的实际 PNG 完全相同，不能把后运行的更快计时噪声当成三个不同性能方案。最终只评 baseline 两模式、quality-first density、software 两模式，三个全新 holdout 共15组，仅一次。中文排除的原因一并冻结。

## 唯一最终验收与生产接入

冻结后仅一次 eagle/clock/skin 共15组，新 software 两模式共6组全部静态/动态合格。density 最小结构 .92616、完整帧P95最大14.2ms、cold56.9ms；color 最小结构 .94562、P95最大13.4ms、cold298.9ms。quality-first density静态通过，P95最大89.6ms未通过动态门槛；baseline color 在skin cold1810.5ms失败，其 timing明示未测。有限来源/主机结果不替代商业画质、真机、任意列数、视频和4K实时验收，API成本0。最终报告/PNG/crop及hash均保留，没有重跑或依据结果调参。

按用户既有持续优化/合格方案接入授权，选择性晋升版本2.2.0：仅softwareRaster和software colorFidelity及所需600笔重，不复制候选中的optical、glyphInkBalance、gamma、700笔重或额外coverage校正。core/renderer将新分支限制为单色density与color，包装工厂同样选择实际Canvas路径。生产旧源码快照位于 `production-promotion/before/`，选择/hash位于 `selection.json`。

编辑器图片原色为「经典/还原」，单色光影保留「精细/柔和」并增加「还原」；默认经典。品质加入重绘、缓存、本地保存/恢复、脏状态与导出帧，缺字段/无效值/不支持场景回经典。中文、彩色density与视频不启用新档，首屏Studio和hover没有改动。PNG/全屏/离线HTML继续同一工厂与atlas，免费导出保持。

`test-results/art-software-contract/report.json`：12个train/dev×两模式×720/1080/3840×透明/不透明，加包装工厂和释放，共192项迁移通过；三来源×六模式缺省与12个不支持请求，共30组通过。生产与冻结候选的text/indices/alpha/colors/真实glyph及PNG相同，没有重用holdout。

## 最终工程与真实媒体验证

- `test-results/art-quality-v5-retained/report.json`：旧精细/柔和96项迁移、18组原六模式默认和品质包装后端通过。原v4报告保留，没有重跑其holdout。
- 开发 `test-results/editor-contract/quality-v5-development/report.json` 和minify生产 `quality-v5-production/report.json` 通过：原六模式实际PNG/TXT/全屏/断网HTML、六项目/刷新、透明4K、真实0.53秒H.264选段MP4；四个品质场景（density精细/柔和/还原、color还原）的4K、全屏、断网HTML、保存重开/刷新和390px。两个还原场景PNG/全屏/HTML相对独立编译参考Canvas的变化像素均0；视频/JPEG有编码损失，不声称像素相同。视频品质增强保持禁用。
- 生产合同补充保存桌面还原截图及真实color还原的手机截图，离线文件后缀纳入software品质，避免覆盖经典证据。开发首次成功报告仍保留；两处harness修复不改生产代码或评价门槛。
- 开发/生产 `test-results/home-interaction/quality-v5-{development,production}/hover-regression.json` 各13项通过，Logo局部效果、普通链接方向、减少动效、7屏宽和首屏原Studio/hover保持，无运行异常。
- 严格vue-tsc、相关ESLint、生产build通过；build日志 `test-results/quality-v5-build.log` 保留已有stream外置、大包和插件耗时告警。5181实际服务的index与新dist一致，运行真实生产合同而非开发替代。`git diff --check` 仍只有既有 `ascii-art.md:27` 尾空白与既有换行提示，未顺手改动。
- 生产选择性before/after源码、主编辑器快照、报告/冻结/最终源hash和minify资产hash在 `production-promotion/manifest.json`。生产core `ce091baf6d11340ccdda8c21fabe8a7935134964aaf7d4c094fe4432fce414e4`，Canvas `faa2eb52f2db7717a99ad2c558dfe885e1744939ca9e7df2c3fe39914f754784`。

本轮进展是新可选图片还原档、原色的单次强度映射和软件渲染，以及本机限定的完整帧成本改善。中文低对比、真实手写商业质量、所有字体/真机/浏览器、精确剪辑/音轨、完整项目包、素材全面许可、模板商品/后端交易和正式部署继续未完成。没有commit、push或发布。下一中文研究从已公开train/dev的字格周期纹理开始重新声明与分配未消费最终来源；不能重用本轮或以前holdout拟合、放宽门槛或掩盖失败。
