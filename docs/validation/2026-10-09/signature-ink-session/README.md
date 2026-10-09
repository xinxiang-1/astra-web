# 调色会话验证

[实施、边界与接续](../../../plans/signature-ink-session-2026-10-09.md)。本机Windows、Node24.12，生产preview4210；真实项目为此前提交的320×256、21枚签名的工程样本，不作为商业照片画质证据。

## 证据

- [基线复现](./baseline.json)：旧实现8倍视图与67%对比条被重置，未应用墨量0.7→8.5；实际生产页面，非静态代码推测。
- [Edge](./edge/report.json)、[Chrome](./chrome/report.json)、[390px触控模拟](./mobile/report.json)：各9项；调色保留缩放/平移/对比、普通调色页面滚动、草稿、RGB、连续浓度、原图色与明确生成。
- 中途手势/取消使用真实布局Worker，只受控延迟发出真实请求。结束后的相机和已导出placements核对；取消不发布部分候选。
- [跨工具回归](./creative-regression.json)：原7项生产合同验证自动颜色、项目恢复、连续浓度、区域色、签名→本地项目→新标签→配方，以及默认还原/重置。
- logs含基线、第一轮手机硬编码320px断言失败（真实适应尺寸304px）、实际页面通知清除造成滚动位移的失败，以及最终通过的原输出。未弱化普通调色的页面滚动断言；渲染中手势另记录相机与预览屏幕位置。
- [源码/证据SHA256](./source-index.json)绑定当前工作树与两个父提交。日志按原字节保存；Git文本归一化单独记录。

类型/相关lint/build exit0，构建警告原样保留。检测器在此阶段中间的逻辑/控件状态改动上返回空数组；随后新增的局部反馈位置按真实浏览器检查，不将其冒充检测器对最终所有样式的认证。

## 重复运行

先 `npm.cmd run build`，再 `npm.cmd run preview -- --host 127.0.0.1 --port 4210 --strictPort`。运行 `npm.cmd run test:signature-ink-session`；可用 `ASTRA_BROWSER_CHANNEL=chrome`、`ASTRA_INK_MOBILE=1`、`ASTRA_PREVIEW_URL`。测试使用已提交工程文件，无需重生成fixture。`ASTRA_INK_BASELINE=1`仅用于仍在基线build时验证旧缺陷，不应对修复后的build执行。

触控模拟不代表实体手机性能；当前只验证此会话与原跨工具流程，尚无全量真实手写/4K/跨设备包/云同步/会员/资金或生产部署验收。
