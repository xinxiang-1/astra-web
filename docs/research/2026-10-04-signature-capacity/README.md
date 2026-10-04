# 完整签名的明暗容量与正负拼贴 · R1

这是独立研究，声明见 [experiment.json](./experiment.json)。原型位于 [v10](../../prototypes/v10-signature-capacity/index.html)，开发服务路径 `/docs/prototypes/v10-signature-capacity/index.html`。最多两轮；本轮不晋升生产，也不重启已经停止的 native-v2 / ink-pack-v1。

## 来源与排除

- 贝多芬：[Commons 文件页](https://commons.wikimedia.org/wiki/File:Signature_Van_Beethoven.svg)、[原始 SVG](https://upload.wikimedia.org/wikipedia/commons/9/95/Signature_Van_Beethoven.svg)。官方 [imageinfo/extmetadata](./beethoven-metadata.json) 标为 Public domain / PD Old，矢量重绘者 Peeperman。保留署名；这属于历史签名重绘，不是新采集的真人湿墨笔迹，也不能证明私人签名授权或真实性。
- 未改动 SVG 为 5,992 字节，SHA256 `4c19519c3ea10a6a976f73430fbe42341f09faff7d63d352345b4a9c91b146f1`。独立 DOM [几何审计](./source-geometry.json)：9 个路径，边界 390×60 完整落在原始视口内；无图像、文字、脚本或外部引用。以 1560×240 栅格化，所有透明像素保留。
- 提交后核对发现仓库默认 LF 规范化将此下载文件由 5,992 字节变为 5,931 字节。随后为这一个来源添加 `-text` 属性并重新加入原始字节；源图未重绘，冻结报告 hash 不变，跨机器检出也保留下载原字节。
- **排除 Hugo 候选**：[官方返回](./hugo-metadata.json) 的描述为 “Signature of soulaim”、日期 1201、作者 “Connormah, soulaim”，与标题不一致。未作为模板使用，不以公有领域标签掩盖身份不确定性。小写标题查询无结果曾触发空数组读取错误，改为保存原始返回后人工核对。
- 李云舟 / Alexander Montgomery 使用已有 OFL MaShanZheng / LongCang，各 8 个固定种子字体辅助写法。许可与字体校验见 [字体研究](../2026-10-04-signature-fonts/README.md)。这些不是 8 次真人手写。
- 两张肖像复用本地生成素材，来源见 [SOURCES](../../../public/artwork/SOURCES.md)。瓷像实际为 1122×1402；两图均不宣称原生 4K。

## 算法与评价

1. 对完整模板测量 alpha 总量与笔迹边界。实际模板覆盖率：历史重绘约 15.20%，中文约 17.35–20.62%，长英文约 9.79–14.35%。模板覆盖率不等于其所在分区的实际容量。
2. 原图只用于积分平均与局部明暗方差。固定 seed 42，以 0.42–0.58 比例递归切分整数矩形；方向参考完整签名长宽比，细节区更密。整个字样等比正向放入其分区，零旋转、零镜像、无裁字。
3. 在最终像素尺寸栅格化完整模板，得到分区覆盖率 `c = sum(alpha) / area`。正笔迹容量为 `c`；负笔迹墨版容量为 `1-c`。由目标平均墨量 `t` 选择极性，透明度为 `min(1,t/capacity)`。超过容量的格子明确记作 clippedToneCells；本轮每幅 0–725 格，暗纸区常发生饱和。
4. 负笔迹是整块墨版中镂空完整签名，明确属于拼贴。最终 `paint(scene, templates)` 不接收照片；重复场景与无源图重放均核对整个 RGBA hash。没有照片底图、填色椭圆或逐像素照片透明度。
5. 评价采用 24×32 面积加权区域：sRGB 字节的 `.2126/.7152/.0722` 加权亮度、底色/墨色校准、结构 Pearson 相关、P95–P05 幅度比和平均绝对明暗误差。门槛分别 ≥.82、≥.30、≤.45。与历史评价器不声明逐字节等同；数值通过不能替代审美与可读性。

预算：输出和分析最长边 1024，输出最多 1,048,576 像素，实际笔迹原生短边 ≥8px，最多 16,000 格；积分数组 ≤24MiB、模板 RGBA ≤16MiB。这是数组预算，不是浏览器总内存认证。

## 结果与复现

36 组开发比较：2 图 ×3 模板集 ×2 底色 ×3 算法。纯笔迹 0/12、现有镂空 5/12、候选 12/12 通过上述数值门槛。候选相关 .870545–.992513、幅度比 .826423–1.010076、MAE .014712–.093208；269–1218 格，独立像素占用审计无相交、逃逸或缺口。

完整候选管线 P95 为 66.5–115.8ms：包含分区、模板着色、绘制、整幅同步 RGBA 读回；1 次冷启动、1 次预热、7 次重复。排除字体生成、UI、PNG 编码和审计，不能与生产 100 模板/2K 的耗时直接比较为加速收益。

`npm run research:signature-capacity` 后运行 `npm run test:signature-capacity-ui`。可用 `ASTRA_PREVIEW_URL`、`ASTRA_BROWSER_CHANNEL`、`ASTRA_CAPACITY_OUTPUT`、`ASTRA_CAPACITY_DATA`、`ASTRA_CAPACITY_UI_OUTPUT` 设置路径/浏览器；研究与 UI 默认分别写 `test-results/signature-capacity-research` 与带时间戳的 UI 目录。实际本轮输出路径见 [验证记录](../../validation/2026-10-04/signature-capacity/README.md)。

开发视觉审查：相较偏淡旧版，脸部更清晰；矩形阶梯/墨版边缘仍显著，长英文只有 269 格的场景细节粗糙。因此 **商业审美未通过，不晋升**。无真实用户偏好数据、私人手写、Safari、真手机、4K/8K或整机内存验收；Darwin / Curie 最终来源未消费。
