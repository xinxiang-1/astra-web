# signature-portrait

签名画像：印章提取、名字库、WVS 排版。

- **矢量源**：`Placement[]`
- **预览**：WebGL2 图集实例化（回退 Canvas）
- **第三档**：写法模板 Imagetracer → `stamp.vector.paths`；导出 Path SVG
- **导出**：矢量 JSON、Path SVG、PNG

产品文档：[`docs/plans/signature-portrait.md`](../../../docs/plans/signature-portrait.md)

## 模块

| 文件 | 职责 |
|------|------|
| `extract.ts` | 签名 / 手写 → 透明印章（可选 `vector`） |
| `bank.ts` | IndexedDB 名字库 |
| `variants.ts` | 多种写法生成 |
| `layout.ts` | `Placement` 排版与 Canvas 绘制 |
| `gl-preview.ts` | WebGL2 图集实例化预览 |
| `trace.ts` | 模板 trace + Path SVG 拼装 |
| `svg.ts` | 嵌位图 SVG（实验） |
| `index.ts` | 对外导出 |
