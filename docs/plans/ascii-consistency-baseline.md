# 字符画动静态一致性基准

用于验证算法迭代步骤 1–4。运行：

```bash
npm run dev
npm run test:ascii-consistency
```

基准素材固定为：人像、风景、宠物、低对比参考人像、雕像 WebP。每张素材依次检查低清 80、标清 120、高清 180、超清 240、极清 360 列。

## 验收规则

- 开关动效后 `.ascii-host` 宽高误差均不超过 1 CSS px。
- Studio Canvas 的物理宽度严格为 `列数 × 6`，五档不能坍缩为相同网格。
- 字符模式的静态预览与动效预览始终使用同一个 Studio 渲染器；开关只增加或移除效果。
- 清晰度列数是 Studio 栅格唯一的密度来源；超清和极清通过更大的内部栅格实现，不改变舞台比例。
- Studio 的 `monospace` 在 Vite 构建时替换为 Consolas 字体栈；文本/PNG 导出仍使用字符转换结果。
- “适应画布”允许整图缩略；“清晰看字”按每格 6 CSS px 原生显示并通过容器滚动查看。

截图输出到 `test-results/ascii-consistency/`，不提交生成图片。
