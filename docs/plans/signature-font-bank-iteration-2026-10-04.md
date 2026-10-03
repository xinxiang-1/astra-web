# 名字画字体与安全保存 · 2026-10-04

接续[六方向计划](./commercial-quality-execution-2026-10-04.md)。本阶段完成来源/保存/输出修复，名字画与整体商业画质仍未完成。

## 实施

1. 核验、本地托管两款OFL字体，界面提供行楷/草书；按需加载、SHA/cmap检查、确定种子、完整变换边界，明确区分字体与真人手写。公式/来源/墨量见[研究](../research/2026-10-04-signature-fonts/README.md)。
2. 按输入的目标名字保存，全部生成/PNG编码成功后一次IndexedDB事务替换。保留库ID/创建时间、拒绝并发覆盖；批量追加原子，创建同事务查重，删除后的编号空洞不制造重复编号。配方随条目恢复，旧PNG无迁移。
3. 生成中锁定相关库/名字/字体操作，离开路由取消生成，提供字体/存储错误。保留手写、上传、原库及免费输出。
4. 新字体暴露镂空小尺寸Canvas/SVG差异；双方改为真实模板的even-odd复合路径，一次绘制负笔迹，保留内部孔洞；去掉不使用的栅格染色和SVG遮罩。默认正笔迹、woven布局、首页保护源保持原实现。

## 实际失败与修复

- 同文件Delete/Add补丁被拒绝、测试括号错误、取消后撤销仍运行的路由拦截：已修复。缺中点/罕见字明确拒绝，未降覆盖要求。
- 旧镂空链路8组合SVG MAE 0.01524–0.02104，超过原0.01门槛；分块仍通过。首次无进度运行约4分钟后停止，增加进度记录，第二次完整保留失败数据。
- 修复后8组合SVG MAE最大0.002217、分块最大0.001415（原门槛0.004）、区域重画0，未放宽品质门槛。100枚字体写法路径非空、重复trace确定，无照片`<image>`；结构断言由100遮罩改为100复合路径。

## 验证

- `signature-font-bank-contract.mjs`：Edge154.0.4258.53/Chrome154.0.8037.57；冷/延迟单飞、SHA/HTTP失败与重试、加载/生成取消、缺字/非法输入、6名字×2字体×40写法、4超大参考对照；PNG失败、首条写入后事务回滚、取消/并发追加/查重/过期拒绝、旧PNG/另一库保留、配方恢复、实际UI生成/失败/改名/刷新、390px无溢出。
- `test:signature-cutout`：100写法、8底色/色彩/填色组合、桌面/手机；`signature-cutout-font-diagnostic.mjs`：12局部尺寸/角度/强度与内部孔洞。
- `test:signature-result`：未应用控件不改变JSON/PNG/SVG/原大，重新生成才应用；真实2K输出与4K重排通过。
- `test:signature-quality`：默认成图等于无照片纯印章重画、空透明图零布局、真实SVG路径。
- type-check、相关ESLint、build通过；原stream外部化、大chunk、签名动态import警告保留。

复现设置 `ASTRA_PREVIEW_URL`（当前5180）和 `ASTRA_BROWSER_CHANNEL=msedge`；旧脚本新增可选channel/独立输出路径，品质阈值保持。[精简证据](../validation/2026-10-04/signature-fonts/)；原始PNG/SVG/JSON与裁片留在独立`test-results/`。当前工作区缺历史fixture的`signature-pipeline-smoke.mjs`本阶段未复跑，也未用旧4K/8K镂空文件为新版本证明。

## 限制与接续

12组开发视觉检查确认墨量改善，夜色仍暗、网格/长英文留白明显，不宣布商业审美通过。TTF首载较大；字库覆盖/压缩、弱网/真机、自然布局、真实手写、完整项目包、本轮8K印刷继续待验收。JSON仍无完整源图/模板，名字库有配方不等于作品包可恢复。

GitHub MCP再次核验`xinxiang-1`与push=true；实际create_blob仍403 `Resource not accessible by integration`。官方MCP远端main仍`10fab501c0c90a4bd7954410aaab51fc74a252e2`。本阶段本地提交，未推送、未换账号/借本地凭据；需重新授予现有连接的仓库Contents写权限，本地研发继续。
