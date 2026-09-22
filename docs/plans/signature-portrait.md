# 签名画像（Signature Portrait）

手写名字 / 签名抠成透明印章，按画像明暗做加权 Voronoi 排版（Secord 风格 WVS），远看人像、近看名字。

- 路由：`/signature-portrait`
- 代码：`src/lib/signature-portrait/`、`src/views/SignaturePortraitView.vue`
- 目录文案：试验页（`src/content/catalog.ts`）

## 阶段目标

| 阶段 | 范围 | 状态 |
|------|------|------|
| 1 | 纯前端：名字库 / 手写 / 生成写法 → 上传画像 → 本地排版预览与导出 | **进行中** |
| 2 | 预览：矢量坐标源 + 视口 Canvas；预览与导出语义解耦（第一档） | **已落地** |
| 3 | WebGL 图集实例化（第二档） | **已落地**（失败回退 Canvas2D） |
| 4 | 章模板 trace / Path SVG 导出（第三档）；PDF 仍可选 | **trace + Path SVG 已落地** |
| 5 | Worker 布局（采样/Lloyd 离主线程）；后端重计算仍可选 | **Worker 已落地** |

## 推荐落地档（产品决策）

三条路线解决的问题不同，**不要并行开坑**：

| 档 | 做什么 | 解决什么 | 状态 |
|----|--------|----------|------|
| **第一档** | `Placement[]` + 轻量概览 Canvas + 视口重画；导出 JSON + PNG；分辨率文案解耦 | 清晰放大、避免全量 SVG | **已做** |
| **第二档（当前默认预览）** | WebGL2 图集 + `drawArraysInstanced` 一次画全量章；无 WebGL2 时回退第一档 Canvas | 十万笔滚动/缩放吞吐 | **已做** |
| **第三档** | 名字库模板 Imagetracer → path；导出 Path SVG；PDF 可选后续 | 印刷/可编辑纯路径 | **trace + Path SVG 已做** |

**为何这个顺序**

- 当前痛点是「十万笔要清楚、还不能卡」→ 第一档已对准；第二档才是吞吐升级。
- Trace/字体轮廓改善的是**文件形态与笔画是否 path**，对卡顿帮助有限，且改手感与工期。
- Trace 必须做在**章模板**（库里几十～上百遍），禁止对 12 万摆放结果逐个矢量化。

## 产品现状（已实现）

### 功能

- **名字库**（IndexedDB）：同名多遍手写、一键生成多种写法、选用库作画
- **画像**：本地上传或示例胸像；墨量、布局/导出最长边（2K～8K）、角度 / 字号等可调
- **排版算法**：密度场 → 拒绝采样 → Lloyd 松弛 → 近邻定字号 → 局部染色 placements（重计算在 **Web Worker**）
- **密度方向**：自动 / 亮处密 / 暗处密（默认亮处密，适合浅色主体；普通写真可切暗处密）
- **填色垫底**（`coverFill`，默认开）：印章下垫局部软色椭圆，补笔画空洞；WebGL 预览同步加厚原图 underlay
- **边缘勾勒**：沿轮廓加细密章；边缘色可随画像加深 / 纯墨 / 自定义
- **对比条**：效果 / 原图左右对比；滚轮缩放预览
- **预览**：优先 **WebGL 图集实例化**（`gl-preview.ts`）；不支持则回退 Canvas 概览 + 视口重画
- **导出**：矢量 JSON（placements）；**Path SVG**（模板 path + transform）；PNG（分块栅格）
- **第三档**：`trace.ts` 对写法模板做 Imagetracer（不对整幅成图）

### 技术结构

| 模块 | 作用 |
|------|------|
| `extract.ts` | 签名图 / 手写板 → 透明底印章 |
| `bank.ts` | IndexedDB 名字库 |
| `variants.ts` | 一键生成多种写法 |
| `layout.ts` | 主线程：读像素、准备章指标、调用 Worker、栅格绘制（含填色垫底） |
| `layout-compute.ts` | 纯计算：密度场 / 采样 / Lloyd / placements（Worker 可跑） |
| `layout.worker.ts` | Web Worker 入口 |
| `layout-worker-client.ts` | 主线程 postMessage + transferable 包装 |
| `layout-worker-protocol.ts` | Worker ↔ 主线程消息类型 |
| `gl-preview.ts` | WebGL2 图集 + 实例化预览（第二档） |
| `trace.ts` | 章模板 Imagetracer → path；Path SVG 拼装（第三档） |
| `svg.ts` | placements → 嵌位图 SVG（实验，非默认） |
| `SignaturePortraitView.vue` | UI：WebGL 预览 + 矢量化写法 + Path SVG / JSON / PNG |

### 当前数据模型（「矢量源」）

每个章的摆放是一条 `Placement`（不是 SVG path）：

- 坐标 `x, y`、角度 `angle`、目标尺寸 `targetSize`
- 印章下标 `stampIndex`、透明度 / 混合 `strength` / `blend`
- 局部色 `tint`、深度 `depth`
- 可选 `onEdge` / `tintLiteral`（边缘勾勒染色）

布局分辨率由「布局/导出最长边」决定；点数随面积与墨量上升，8K + 高墨量可达 **十万级**（代码上限约 22 万）。  
**屏上预览**：WebGL 用布局坐标相机看全图/视口；Canvas 回退路径仍用轻量概览长边上限。

### 已知瓶颈

1. ~~排版 CPU 堵主线程~~ → **Worker 布局**（`layout.worker.ts`）；失败时回退主线程（仍会卡）。总耗时不减，但页面应可滚动。
2. ~~全量 SVG 预览 DOM~~：已弃用为默认路径
3. ~~印章只有位图~~ → 第三档可对模板 trace 成 path，再导出 Path SVG（预览仍用位图图集）
4. ~~十万笔全屏 Canvas 逐章 `drawImage`~~ → 第二档 WebGL 实例化（无 WebGL2 时仍走 Canvas）
5. 高分辨率 + 高墨量时 Worker 仍会吃满一核 CPU 十几秒；可继续压 Lloyd 迭代 / 分析分辨率

## 清晰度 vs 性能：结论（调研摘要）

| 规模 | 常见做法 |
|------|----------|
| &lt; 约 5k | SVG 尚可 |
| 一万～几万 | Canvas 2D |
| **十万级** | WebGL 实例化（图集 + 少量 draw call） |

参考：Secord WVS；[Swingline](https://www.mattkeeter.com/projects/swingline/)（GPU Lloyd）；可视化 SVG/Canvas/WebGL 分层；word mosaic 的 work-width 思路。

## 其它矢量办法（不必用 SVG 预览）

| 办法 | 说明 |
|------|------|
| placements JSON | 自研矢量源，任意引擎重绘（第一档已导出） |
| Canvas/WebGL 视口重画 | 不存 SVG，放大仍清晰（第一/二档） |
| PDF（如 pdf-lib 贴章） | 印刷向；多为嵌入章图 |
| 章模板 Imagetracer | 真路径；模板级一次，再实例化（**第三档已做**） |
| 手写矢量输入 / 字体轮廓 | 一开始就是 path，不是贴图章（第三档） |
| DXF 等 | 偏线稿，不适合染色肖像 |

「不用 SVG 但要矢量」≠ 换后缀就不卡；本质是 **矢量存布局（及可选 path）+ 显示用栅格/GPU 按需画**。

## 非目标（当前阶段）

- 服务端存作品、账号广场
- 实时视频流签名马赛克
- 把每一笔手写都自动建成可编辑字体
- 默认全量 SVG 预览 / 指望下载 SVG 后打开就不卡

## 代码入口速查

```text
src/lib/signature-portrait/
  extract.ts                 抠章
  bank.ts                    名字库
  variants.ts                生成写法
  layout.ts                  主线程编排 + 栅格绘制（填色垫底）
  layout-compute.ts          纯 WVS 计算（Worker 共用）
  layout.worker.ts           Web Worker
  layout-worker-client.ts    主线程 Worker 客户端
  layout-worker-protocol.ts  消息协议
  gl-preview.ts              WebGL2 图集实例化预览
  trace.ts                   章模板 → path；Path SVG
  svg.ts                     placements → 嵌位图 SVG（实验）
  index.ts                   导出聚合
src/views/SignaturePortraitView.vue
```

## 下一迭代

1. ~~第一档：视口 Canvas + 导出解耦~~
2. ~~第二档：WebGL 图集实例化~~
3. ~~第三档：模板 trace + Path SVG~~（PDF / 手写直接矢量输入仍可选）
4. ~~Worker 布局（改善排版时假死）~~
5. ~~填色垫底 + 密度方向 UI~~
6. WebGL：multiply 更贴近 Canvas；填色垫底走实例化软盘（目前靠加厚 underlay）
7. 后端重计算（可选）
