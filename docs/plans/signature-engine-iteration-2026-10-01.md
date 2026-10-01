# 签名引擎迭代记录 · 2026-10-01

本轮交付：可选「镂空排印」、多写法 SVG 修复、生成结果与下载参数快照。默认仍为 woven + 笔迹织排 + Canvas；首页原拖尾、慢流和 hover 保留。商业画质、GPU、收费后端与部署目标仍未完成。

## 协议修复与冻结

沿用项目 ascii-engine-optimizer 技能的 source-grouped split、硬约束、Pareto 和源码冻结方法。候选在 `sandbox/signature-optimizer/contrast/engine/`，打印合同修复另放 `print-contract/engine/`。生产可选接入依据用户已有自主优化授权，未改变默认风格。

原 train/dev 声明误将鲁迅放入 train，并漏掉 pet。`prepare-evidence.mjs` 修正为 `signature-source-grouped-v3-protocol-repair`：train 为 portrait-reference、Franklin、生成写法库；dev 为 portrait.jpg、pet.jpg、鲁迅；holdout 为爱因斯坦照片及真实签名。8 fixtures / 8 source IDs，train 3、dev 3、holdout 2。validator 实际通过。

原数值与 `protocol/original-experiment.json` 保留，`protocol/correction.json` 明确是事后元数据修复，不伪称事先注册。Commons 许可与文件 SHA 核验；现有项目照片完整商业出处待核实，仅作内部基准。

`writing-bank-evidence.json` 补录 100 枚 raster RGBA hash、字体栈 raster hash、Chromium 153.0.8010.12、Windows/i5-14500 和 28 个注册字体文件 hash。FontFaceSet.check 不证明具体字体存在，不分发字体。冻结生产重渲染写法库纸白 PNG 与旧文件字节级一致：`733af78237cec47995d7fc8153d4b7dfcecceed39b8da8638e0172038b6fec7d`。

冻结候选 engineHash：`0efd7a90e4deebe699e2756015e8693a6c5290651d57e6a019b597c903e41cbb`；baselineHash：`90cdd296e325bfd654e4c126e3e0880c278379e7b47915d9c25dbc6f48d23fd2`。holdout harness 校验候选/基线/harness/参数/manifest/素材/浏览器，拒绝覆盖已有结果；不得重新选择参数后重复使用同一 holdout。

## 候选与唯一一次 holdout

6 profiles × 4 素材组合 × 纸白/夜光 = 48 train/dev records。seed 42、1024 长边、DPR 1，冷启动后 3 次重复。聚合 Pareto 为 cutout-quality / cutout-performance。quality 的 dev 收益不稳定，P10 约 3.10px 贴近门槛，未推荐；balanced 被粗指标支配，但保留作细面部结构的视觉取舍，不伪称 Pareto 最优。

最终冻结 baseline 对照、balanced、performance 三档，仅执行一次爱因斯坦 holdout，保存在 `2026-09-30-contrast-v1/holdout/results.json`：

- baseline 纸白/夜光 MAE 0.580 / 0.359，rangeRatio 0.069 / 0.066，P10 3.64px，对比门槛失败。
- balanced MAE 0.437 / 0.275，rangeRatio 0.330 / 0.310，P10 3.64px，通过该狭窄实验门槛。
- performance MAE 0.466 / 0.291，rangeRatio 0.294 / 0.267，P10 4.42px，约 91 / 89ms，通过门槛，细节更粗。

footprint 碰撞为零。三重复最大值不是可靠设备 P95。人工概览/crop 检查发现真实签名可辨、没有照片垫底，但墨版砖块纹理明显，整体仍偏浅；不称自然手写或商业完成。没有模型盲审或付费 API 调用。

**这些 holdout 数值属于冻结的 raster cutout 候选，不能认证后续生产路径渲染器。** 后续只用 dev 素材修输出合同，没有重跑或拟合旧 holdout。

## 打印合同失败与修复

预设 Canvas/分块/区域 MAE <0.004、SVG 全局 MAE <0.01、空模板拒绝、零照片嵌入。首个测试漏传 tiled 的 outW/outH，出现 0 尺寸 canvas，是测试 API 错误；修正后获得真实失败。

v1：原笔迹纸白/夜光 SVG MAE 0.01646 / 0.01214；raster cutout 0.04902 / 0.03600。没有放宽门槛。v2 改 trace 阈值/精度未解决；未采用。v3 共享路径绘制仍失败。v4 进一步修复 mask 边界后，镂空 SVG MAE 降至约 0.0005–0.0007；恢复原 trace 阈值/精度仍通过。

根因：位图缩小与直接矢量的小尺寸采样不同；SVG 墨版与同边界白 mask 的抗锯齿相乘，重复削弱边缘 alpha。镂空 Canvas 使用同一真实 Path2D 模板，先在单枚透明层扣除笔迹，再合成，避免擦掉其他签名。SVG 白 mask 扩到墨版之外，只让实际墨版抗锯齿一次。

失败目录 `2026-10-01-print-contract/` 与 v2–v4 均保留。原笔迹继续使用原栅格绘制，严格 SVG 0.01 门槛仍未通过；既有 pipeline 的 0.04 门槛与新镂空 0.01 门槛分别报告，不能把可选风格成功算成旧引擎通过。

## 100 写法的实际 SVG 失败

真实 UI 导出报「签名没有可导出的笔迹」，不是单纯超时。Imagetracer 空间调色板采样在细笔迹模板上可能只采到白底。改为固定墨色/白色二值调色板，colorsampling=0、colorquantcycles=1、mincolorratio=0，保留原 threshold/trace 精度。

100 枚全部生成路径，两次 trace 完全一致；真正空模板仍拒绝。没有静默丢弃写法或用矩形替代签名。

## 生产接入与生成快照

- `ink-style.ts` 提供 ink/cutout；模板 alpha 逐像素互补、空模板拒绝。最终路径抗锯齿不是原 raster 的逐像素复制，二者不能混为同一证明。
- `vector-ink.ts`、`layout.ts`、`trace.ts` 使单次/分块/缩放/区域/PNG/SVG 都传递镂空风格；SVG 为真实 path + luminance mask，无照片嵌入。
- UI 加入「笔迹织排 / 镂空排印」，默认 ink；cutout 始终使用 Canvas。未复制实验 inkStrength/directOpacity 或性能档参数，未改默认密度。
- 每次生成固定照片对象、模板列表、参数、placements 和尺寸。局部放大、PNG、SVG、JSON 使用这份结果；JSON 增加 renderOptions/stampIds，但仍不含完整模板与源图，不能独立重开项目。
- 未应用控件变化时显示重新生成提示。修 density、最小字号、4K 控件后，旧作品 JSON、PNG、SVG、原大画布保持一致；重新生成才应用新参数。

## 最终证据与检查

`test:signature-cutout`：dev 人像 + 100 字体辅助写法，纸白/夜光 × 局部染色 × 填色网点共 8 组合，每组合 4,796 枚。分块 MAE 0.00124–0.00164、区域 0、SVG 0.000395–0.000534；100 masks、零 image，可选 ellipse 一致。默认 ink、实际 UI cutout、JSON 风格、Canvas、390px 手机无横向溢出通过。这不是自然手写审美或性能认证。

生产历史鲁迅签名 + dev 人像打印：SVG 纸白/夜光 MAE 0.000684 / 0.000525，分块 0.001754 / 0.001760、区域 0。真实 PNG 写入并 decode：4K 为 3277×4096、16,110 枚、19,657,771 字节；8K 为 6554×8192、42,486 枚、67,671,353 字节。单次布局/绘制/编码约 2.13 / 6.51 秒，仅代表该桌面；8K 基础 RGBA 约 205 MiB，手机内存未验收。

`test:signature-result`：100 写法真实 UI 下载，改参数前后 PNG/SVG hash、JSON 与原大画布 hash 相等；重生成正确应用 4096px、density 12、minSizeRatio 0.021。快照接入时检查并修正了一处 PNG 多传尺寸参数，最终真实回归通过。

原 `test:signature-pipeline` 通过：原样 4K/8K、四底色网点、自定义轮廓、非空 UI、确定性、取消约 58.5ms、手机。GPU 纸白 MAE 0.02160、纸白网点 0.02288 仍超过 0.02，gate=false，生产关闭。

严格 type-check、相关 ESLint、`test:home-hover` 13 组实际 hover/七档宽度、`test:ascii-artwork` 原 Studio/拖尾/暂停/减少动效/离屏/手机通过。build 通过；保留既有 Office 资源、大包、stream 外置、无效 dynamic import 警告。

最新 build 的本地生产预览 5181 也通过：13 组 hover；`signature-cutout-contract.mjs --ui-only` 实际生成 2K 镂空、确认默认 ink、JSON 风格、Canvas 后端、390px 手机和零页面异常。证据 `test-results/signature-cutout/production/`；这是本地构建检查，不是正式部署。

生产快照 `2026-10-01-production-cutout/`，engineHash `4199222140f2527cc30eb81155cac330c78f9c53c9b28b2202fcd68347528d3b`。evidence.json 和 `test-results/signature-cutout/results.json` 保存逐文件 hash、真实环境。未覆盖冻结候选或旧 holdout。

复现：开发服务 5180；`npm run test:signature-result`、`npm run test:signature-cutout`、`npm run test:signature-pipeline`。4K/8K 检查设置 ASTRA_SIGNATURE_ENGINE=/src/lib/signature-portrait/index.ts、ASTRA_PRINT_OUTPUT 为新目录，再运行 `node sandbox/signature-optimizer/contrast/verify-print.mjs --cutout-only`。可选风格检查不替代完整失败记录或商业验收。

## 下一轮

补低内存真机、100 模板首次 trace/局部重画、浅细真实笔迹与长签名；给最终路径渲染器准备新的独立自然照片/真实签名 holdout。改善墨版纹理与背景灰雾需新的 dev 协议，不能反复调已看过的 holdout。旧笔迹 SVG 与 GPU 小尺寸采样继续待解决。

随后推进主编辑器六模式/视频/HTML/项目合同与旧数据兼容，再按总计划完成付费模板/创作权益、定制服务、账户/订单/支付及部署。本轮无 commit、push 或正式发布。
