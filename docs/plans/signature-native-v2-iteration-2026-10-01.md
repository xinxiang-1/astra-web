# 签名真实墨量、提取与墨版边缘 · native-v2

本轮接续前一次可选镂空的浅淡/砖纹问题。上一goal轮属于实质progress：quality-v7第二轮96主句/240扩展/557工程检查及停止结论已完成，生产未晋升；本次核对当前worktree、conclusion和签名生产源码一致，没有活跃测试任务。完整商业引擎目标仍active。

## 实现前声明

实验`2026-10-01-signature-native-v2`，候选仅放`native-v2/engine/`，复制当前生产签名模块作为独立baseline。沿用项目优化流程的隔离、来源分组、真实输出和冻结规则，已有用户自主实现授权继续适用。保留首页原Studio/hover、免费导出和旧默认。

最多6档、两实现轮、0付费裁判：生产笔迹、生产镂空、真实墨量笔迹、真实墨量镂空、墨版边缘12%/24%软化两档。软化只改变墨版外围alpha，保留完整签名孔洞，不加照片underlay、填色椭圆或删除笔迹。准备记录真实glyph alpha、输出明暗和native局部；不将修正统计字段或变亮直接视为质量胜出。

先做独立提取/墨量audit：源码中prepareStamp把真实inkRatio限制到.04–.4；extractStampFromImage未乘回原图部分透明度且采用向前像素散射。需量化其影响，并区分真实问题、同一模板比例抵消以及小笔迹缩放损失，再依据开发证据确定修复范围。

开发仍用公开的portrait-reference/Franklin与字体辅助写法库、portrait/pet与鲁迅，照片与签名来源保持train/dev分组。开发主矩阵4组合×6档×纸白/夜光=48组，1024长边、seed42、真实完整计时1冷/1warm/7重复。字体辅助写法不冒充真实手写，现有照片不默认有公开商品授权。

新版评价明确按实际纸/墨色校准：24×32真实面积平均，结构≥.82、rangeRatio≥.3、toneMAE≤.45；完整签名、零矩形footprint碰撞、native短边P10≥3px、≤220000枚，完整生成/绘制P95≤1500ms。源码/数据/浏览器/DPR/字体信息保留，同一baseline重新测量，不把新版分数直接与旧协议排名比较。

爱因斯坦和所有已消费最终来源排除。此次先完成开发与诊断；只有新独立真实签名/照片及许可验证、冻结范围、源码与工程输出合同齐备，才允许一次新的最终测试和选择性接入。缺少最终证据时不晋升，不以已消费旧holdout或字体打字样例认证商业手写质量。所有失败保留，达到两轮上限停止，不开第三轮补丁。

## 基线诊断与记录修正

合成32×32黑色签名、输入alpha32/64/128/255：原提取对前三档均输出1，分别应为.125490/.250980/.501961；证明部分透明度被丢失，不将此问题误称为照片还原优化。原墨量函数还忽略alpha≤24、将总覆盖率限制到.8，prepareStamp再限制到.04–.4；纯不透明模板真实覆盖率1而参与排版的统计为.4。

首次audit误把measureStampTraits返回值标成actualAlphaCoverage，报告与原harness保留`baseline-audit/`。补做`baseline-audit-raw/`，直接求原始alpha总和并同时记录两层截断，提取问题证据不变；没有修改旧报告、门槛或最终数据来掩盖误差。后续候选`measureStampTraits(canvas,true)`统计全部真实alpha，不截断。

## 第一轮实际结果

47项预检通过，旧笔迹/镂空缺省PNG及placements与当前生产基线完全相同，软化墨版保留完整签名孔洞、alpha边界、缩放一致和清零无底图。严格候选类型首次因隔离配置遗漏项目已有Imagetracer声明失败，补入现有`.d.ts`后通过；没有降低严格设置或安装依赖。

48组开发完成，无页面异常。每档8组通过数：原笔迹0、原镂空7、真实墨量笔迹0、真实墨量镂空7、软边12% 6、软边24% 6。单一模板的reference/coverage比例会抵消，元数据修正不能单独改善画面；鲁迅单模板输出实际相同。软化外围降低墨版面积，减轻硬边同时加剧浅淡，因此不把软边当独立推荐。

## R2声明与实现（最后实现轮）

依据真实输出和合成audit，R2仍6档、48组，不改评价：原笔迹/原镂空两个对照；新笔迹、新镂空、软边12%/24%四档。新档明确启用真实墨量与`absoluteTone`：strength=clamp(tone/实际拟合覆盖率)，不再先乘小的reference。目标仍完整源图实际明暗，输出按既定纸/墨色校准；必须检查稀疏笔迹透明度截满导致的结构损失。

真实历史签名新档采用`rasterSampling:'area',thickenRadius:0`。提取的darkness乘原图alpha，再对实际裁切内的连续像素面积积分，不采用向前散射覆盖最后一个样本；不额外膨胀原生笔迹。手写入口传递相同选项，旧未传参数继续原提取。native ink Float32Array≤64MiB，超过预算明确拒绝；这是单一数组预算，不代表包括原图、Canvas/GPU、输出的全部内存。

67项R2预检通过：四档原生透明度逐像素相符、四个非整数缩放尺寸的墨量守恒、透明padding、手写入口选项、旧提取/default兼容及此前工程检查；严格候选类型通过。默认库和生产模块没有改动。

## R2完整结果与观感

48组完成、errors=[]。每档8组通过数：原笔迹0、原镂空7、新笔迹0、新镂空8、新软边12% 8、新软边24% 5。新镂空最低结构.878070、最大toneMAE .345404；软边12%最低结构.824063、最大MAE .371770。两者只通过声明的小开发范围，不是商业验收。

自然人像/鲁迅/纸白，新镂空MAE由原.299336降至.121766、rangeRatio .536615→.641761；查看概览与局部可见画像更鲜明，完整历史笔迹仍可辨。新笔迹最低相关-.077687，透明度大量饱和后几乎只剩重复签名；绝不以更黑当成功。24%软边自然人像相关.622363、rangeRatio .238873，失败。12%软边虽通过开发门槛，阴影层次仍容易变平。

全部样例矩形footprint无碰撞、完整签名边界检查通过、无照片underlay。墨版重复网格与砖纹仍明显，多写法网格也较强；没有将“笔迹织排自然观感”偷换成“墨版数值合格”。选定R1/R2概览和局部的实际查看清单在`stage.json`，这是助手开发视觉检查，不是独立人类盲评分。

环境Chromium153.0.8010.12、DPR1、ANGLE SwiftShader，不能与quality-v7的UHD770/D3D11跨环境宣称加速。新镂空完整prepared-template生成P95最大603.1ms，软边12% 374.2ms；它包含照片采样、Worker排版、墨版准备、绘制与同步完成，**不包含上传/首次模板生成/trace端到端P95**。100写法生成323.3ms、初次trace345.8ms单独记录，R2历史模板重提取/trace也按case单独记录；没有隐藏首次费用或宣称30fps。

## 新最终来源与许可

成功取得官方Commons的Darwin seated/Curie c1920两张照片及Marie Curie真实历史签名SVG。原页面Public domain标记、URL、原始字节与页面SHA256保存；未将站点标记推广为其他素材的授权。初次采集的fullImage/fullImageLink与追踪查询参数解析失败保留；编码PowerShell下载、Node超时与直接PowerShell成功的过程保留，没有换未知镜像。

`prepare-final-manifest.mjs`排查所有此前sandbox/docs/public JSON中的新source_id与字节hash，除当前实验记录无旧匹配。9来源清单为3train/3dev/3holdout，现有schema validator实际通过；生成写法的metadata不冒充照片或用户手写。三份新最终资产仍未查看/渲染，未创建frozen/holdout-attempt/最终报告，不能使用已消费爱因斯坦认证本轮。

## 可交互原型与演示验证

独立地址：`http://127.0.0.1:5180/sandbox/signature-optimizer/native-v2/index.html`。统一深色/浅绿色视觉，提供4开发组合、纸白/夜光、鲜明墨版/柔边/原笔迹实验、对比滑块、局部笔迹和免费PNG下载。页面使用本轮真实输出，并明确实验状态；没有改主站路由、主页Studio/hover或生产控件。

`preview-smoke.mjs`的24种组合图片hash/尺寸与R2报告逐个相同，滑块、局部开关、真实下载hash、图片无CSS旋转、390px无横向溢出与零页面异常通过。下载hash`3c1c9ba34b71a0250da32b36d0e090d733975d2c7dfa69dc5ab09b36d9e7f072`。实际查看桌面和手机截图，保存`preview-evidence/signature_compare_desktop.png`及`signature_compare_mobile.png`。使用walkthrough-artifacts的真实演示原则；本机通过本地截图展示，没有云上传或公开发布。

## 当前接续状态

两实现轮已结束，不第三轮调参。R1/R2的16源码、声明、harness和报告hash独占保存；R2真实评价函数与R1逐字节相同，生产签名16个文件hash与起始基线一致。`stage.json`状态为`two-development-rounds-finished-awaiting-output-contracts-and-final-evaluation`，promotion=false、API成本0，没有新增依赖、commit、push或部署，测试会话全部已终态。

当前只是两个可继续验收的墨版候选：quality-first为native-cutout；较快soft12需要与层次损失一起评估，不能用速度认证自然手写。下一步在不改参数的范围补实际PNG/分块/局部/Path SVG、100模板与真实分辨率输出合同。soft-cutout尚无忠实SVG合同，不能静默导出另一种风格；不满足则继续隔离。完整合同和观感通过后再冻结scope/source/evaluator/environment，用新的未查看最终集一次验收，不提前接入。

原笔迹、签名商业质量、真实设备与GPU、长视频/项目包、授权模板和产品/交易文档、前后端与部署继续待完成，整体目标保持active。后续新布局研究要改变可用墨量或空间分布，不在稀疏固定布局上继续无界增加透明度。

## 输出合同接续：保留画面，修复柔边 SVG 误导出

本次继续以用户指定的六份文字记录为参考：自然照片/缓存、quality-v4/v5/v6/v7与签名生产记录。它们是工程实验和开发观感记录，不是独立人类评分或模型训练数据。原首页 Studio 拖尾 .65/.38、慢流 .45、hover与免费导出继续保留；没有改主站代码。

两轮画质实现预算保持结束。`output-contract-declaration.json`预先声明固定native-cutout/soft12参数、16个开发场景、8个真实高分辨率场景；参数搜索预算0，栅格平均误差门槛仍.004，路径SVG仍.01，PNG编解码误差必须0。没有改评分函数、布局、透明度映射、提取方式或软边比例。

原R2源码直接从`round2-source/engine/`测试。首次本地Chromium被沙箱禁止创建进程（spawn EPERM），尚未渲染；失败与harness保存在`output-contract-original/`。经本地无界面浏览器执行审批，在独占目录`output-contract-original-launch-retry/`完成相同声明的16+8场景，errors=[]。其16个原生PNG都与R2开发产物hash相等。

发现8个soft12 SVG全部悄悄走普通笔迹分支：例如Franklin/纸白相对预览的MAE .436910，原生柔边风格并未保存。鲜明墨版8个SVG及全部PNG、缩放/分块/局部平均误差合同通过。原始SVG、栅格对照与真实大图保留，没有放宽门槛或覆盖失败。

唯一候选修改为`engine/trace.ts`：导出类型接受真实的`SignatureInkStyle`，柔边模式明确报「柔边墨版暂不支持忠实的矢量 SVG，请使用 PNG 导出」，未知风格明确拒绝。原缺省/ink/cutout输出保持；这是对不支持输出的显式拒绝，**没有实现或认证柔边矢量导出**。旧`svg.ts`嵌位图实验入口、原笔迹严格SVG、GPU与其他未声明模式不在此认证范围。

修复后`output-contract-repaired/report.json`完成16个开发场景和8个真实4K/8K场景，passed=true、errors=[]；`export-api-contract/report.json`39项通过，涵盖缺省/ink/cutout的PNG、布局与SVG字节兼容、染色/网点选项、无照片底图、空模板、未知风格拒绝及trace/Worker取消。严格候选tsc和修改的trace/两个输出harness ESLint通过。

`close-output-contracts.mjs`独占保存`contract-repair-source/`的16文件、harness及报告hash。逐个验证生产签名源码仍等于起始基线；候选只有trace改变，去掉类型和运行时guard即可重建原R2文件。修复前后16个原生PNG/crop、8个cutout SVG/raster及8个大图PNG/crop的hash保持；所有原生PNG与R2开发hash一致。旧R2源码/报告没有被新hash冒名认证。

## 实际输出范围与限制

完整PNG编解码24组的RGB/alpha误差均0；原生等比例重绘和完整region也为0。分块、局部与两倍放大合同按平均误差通过，最大MAE .001996；cutout SVG最大MAE .002728、零照片image，100写法对应100个mask。每组分块渲染在第2块请求取消后正确终止。

真实高分辨率重新计算布局，不是将1024px概览放大：自然人像4K为3277×4096、16,110枚，8K为6554×8192、42,486枚；100写法参考图4K为3278×4096、32,400枚，8K为6556×8192、85,703枚，四个高分辨率bank场景全部用到100个模板。真实PNG文件已编码、写入并解码核对尺寸与像素，再对原图的256px局部与region重绘比较。

修复后的单次完整流程约2.1–11.1秒，包含布局、分块、PNG编解码与局部检查，仅代表Chromium153.0.8010.12/SwiftShader/DPR1的本机开发样例，不是P95、30fps、真实手机或生产用户延迟。8K输出RGBA自身最大214,827,008字节（约205MiB），尚有解码/模板/浏览器等内存；最大PNG约102MB，不应直接当手机档位。

**平均误差合格不代表分块或SVG逐像素相同。** soft12的分块/局部仍存在少量明显的单像素差异，最大归一差约.639；报告保留max与changedPixels。这个局部抗锯齿/采样问题和商业笔迹质量仍需处理，不能仅按小的全图MAE宣称无缝或忠实矢量。

重新查看自然人像cutout概览与soft12原生crop：画像可辨，但重复矩形、整齐格子仍压过自然笔迹。检查为助手开发视觉审查，没有独立人类偏好分数。当前自然手写画像观感不合格，**不晋升、不冻结最终验收范围、不消费Darwin/Curie三份新最终素材**。`output-decision.json`记录此决定；`stage.json`最新状态为`output-contracts-completed-visual-layout-not-eligible-for-final`，outputContractsPassed=true、commercialVisualPassed=false。

下一项应另行声明有界的自然笔迹布局假设，先诊断真实墨量容量与重复空间结构，保持完整签名、正向可读与尺寸节奏，再验证局部输出边界。不能给本轮增加第三轮透明度/软边调参，也不能仅因数值与下载通过就将墨版当作商业自然手写画。官网其他模式、授权模板交付、创作/交易PRD、前后端和部署按总计划继续；无新增依赖、API费用、commit、push或正式发布。

后续独立研究已执行：[ink-pack-v1自然正笔迹与真实碰撞记录](./signature-ink-pack-v1-iteration-2026-10-01.md)。父实验源码与声明保持；新研究两轮通过原生相交检查但尚无通用画质候选，未消费本实验的Darwin/Curie最终源。
