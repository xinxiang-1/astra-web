# 字符画引擎 · 参数 / 算法迭代流程（重整版）

> 一句话：**机器先大量试参数并筛候选 → 人只打分 → 留下更好的 → 再开下一轮。**
> 只在 `sandbox/ascii-optimizer/` 里做；**不自动改**正式站 `src/`。

实现目录：[sandbox/ascii-optimizer/](../../sandbox/ascii-optimizer/)
Skill：`$ascii-engine-optimizer`

---

## 0. 先澄清：这不是「训一个大模型」

| 你可能以为的 | 我们实际在做的 |
|--------------|----------------|
| 端到端神经网络自己进化 | ❌ 还没做 |
| 强化学习不停试错改权重 | ❌ 还没做 |
| **在参数空间里搜索更好配置** | ✅ 现在做的 |
| **用分数（机器+人）当奖励信号** | ✅ 现在做的 |
| 以后再接自动搜参 / RL | 🔜 可选升级 |

所以叫「机器学习式迭代」可以，但现阶段算法是：

**黑盒搜索（网格） + 多目标筛选（Pareto） + 人工偏好打分**

不是 PyTorch 训练循环。

---

## 1. 优化对象分两层

### A. 参数（Parameter）——优先、便宜、现在就做

引擎旋钮，例如：

- `columns` 清晰度列数
- `charset` 字符集
- `contrast` / `exposure` / `ditherStrength`
- `normalize` / `invert`

改的是 **同一套算法的输入**，不改代码逻辑。

### B. 算法（Algorithm）——更贵、后做

例如：采样方式、抖动实现、色调映射公式、字符集构造、渲染/字格几何。

改的是 `sandbox/ascii-optimizer/engine/` 里的代码副本。
**必须先有稳定的参数实验协议**，否则算法改了分不出是算法好还是参数碰巧好。

---

## 2. 标准一轮长什么样（闭环）

```text
┌─────────────────────────────────────────────────────────┐
│  第 N 轮实验（例：exp-static-r3）                          │
│                                                         │
│  ① 定目标 + 参数空间（experiment.json）                    │
│           ↓                                             │
│  ② 机器批量渲染（train 探索）                              │
│           ↓                                             │
│  ③ 机器客观打分（structure / tone / 耗时）                 │
│           ↓                                             │
│  ④ Pareto 筛掉明显差的 → 留下 Top-K                       │
│           ↓                                             │
│  ⑤ holdout 验证（这批图禁止用来「调参」）                   │
│           ↓                                             │
│  ⑥ 人打分（1–5 或 A/B）← 你只做这一步                      │
│           ↓                                             │
│  ⑦ 汇总：哪些参数赢 → 写入下一轮先验 / 预设                 │
│           ↓                                             │
│  ⑧（可选）改 engine 算法 → 开第 N+1 轮重新测               │
│                                                         │
│  未经你同意 → 不合回 src/                                  │
└─────────────────────────────────────────────────────────┘
```

**角色分工**

| 谁 | 做什么 |
|----|--------|
| 机器 / Agent | ②③④⑤ 大批量试、算分、出打分卡 |
| 你 | ⑥ 只看图打分（或说「和 Agent 分哪里不一样」） |
| 一起定 | ⑦ 留下哪组；要不要动算法开下一轮 |

---

## 3. 「奖励」现在怎么算

### 机器客观分（先筛）

| 分数 | 含义 | 方向 |
|------|------|------|
| `structure` | 边缘轮廓像不像原图 | 越高越好 |
| `tone` | 明暗分布是否贴原图 | 越高越好 |
| `convert_paint_ms` | 渲染耗时 | 越低越好 |

硬约束不过关的直接淘汰（太慢、几乎没结构等），**不给人看**。

### 人分（后裁决）——必须多素材、多轮

对 Top-K 打 **1–5**：愿不愿意发出去。
人分和机器分可以不一致——**以人的观感做最终产品决策**，机器分负责缩小候选。

**准度规则（硬）：**

1. **按题材分开记分**，禁止用单图分数概括「整体好不好」。
2. **同一轮**：scorecard 里每个题材都打完，才算本轮人分有效。
3. **多轮**：不同参数网格交叉验证；未齐数据不做参数规律结论。
4. 样本不足时只归档分数，**不收缩搜索空间、不晋升** `src/`。

以后若要接「真·RL」，按题材的人分 / pairwise 才是奖励；现在先把覆盖记清楚。

---

## 4. 你怎么参与（最少步骤）

### 场景：开服务网页打分（推荐）

```bash
npm run sandbox:ascii:dev
```

浏览器打开：**http://localhost:5199/score/**

- 选实验
- 看顶部 **素材覆盖**：每个题材点进去打完 1–5
- 导出 JSON（未齐也会导出，但会标 `all_subjects_complete: false`）
- 多轮都打完再一起定参数

（分数按「候选 × 题材」存在 localStorage。）

### 场景：Agent 从零跑新一轮

```bash
# 终端 A
npm run sandbox:ascii:dev

# 终端 B
npm run sandbox:ascii:opt -- --experiment experiments/exp-static-rN/experiment.json --split train
npm run sandbox:ascii:opt -- --experiment experiments/exp-static-rN/experiment.json --split holdout
node sandbox/ascii-optimizer/scripts/build-scorecard.mjs --experiment experiments/exp-static-rN --topk 8
node sandbox/ascii-optimizer/scripts/rerender-scorecard.mjs --experiment experiments/exp-static-rN
```

然后打开 `/score/` 打分。

### 场景：手搓调参（辅助，不是主打分）

http://localhost:5199/harness/

---

## 5. 目录心智模型

```text
sandbox/ascii-optimizer/
  engine/          ← 算法副本（改算法动这里）
  experiments/
    ascii-benchmark-v1/   ← 数据集清单
    exp-static-rN/        ← 第 N 轮
      experiment.json     ← 本轮搜什么参数
      results-*.json      ← 机器分
      pareto-*.json       ← 非劣前沿
      artifacts/          ← 全部渲染
      scorecard/          ← 给你打分的 Top-K（看这里）
  harness/         ← 手工 A/B（辅助）
  scripts/         ← 跑批 / 打分卡 / 重绘可见图
```

---

## 6. 和「进化」的对应关系

| 进化概念 | 我们对应的东西 |
|----------|----------------|
| 个体 | 一组参数（一个 candidate） |
| 种群 | 本轮网格 / 采样出的全部 candidate |
| 适应度 | 机器分 + 你的人分 |
| 选择 | Pareto + Top-K + 你的高分 |
| 繁殖/变异 | 下一轮缩小参数空间再搜；或改 engine 算法 |
| 环境 | 基准图 manifest（train/dev/holdout） |

**一代 = 一个 `exp-static-rN`。**
不是每个滑杆拖一下叫一代。

---

## 7. 建议的迭代节奏

1. **rN**：搜参数 → 多题材 scorecard
2. 各题材打完 → 只归档，不外推
3. **rN+1**：另开网格 / 加密；继续多题材打分
4. 多轮、多题材对齐后，再谈候选默认
5. 再考虑改算法 / 合回 `src/`

---

## 8. 当前状态

| 项 | 状态 |
|----|------|
| 参数阶段 | ✅ 已关闭并归档 `PHASE-PARAM-CLOSED.md` + `frozen-presets-v2.json` |
| 数据集 v2 | ✅ 51 fixtures |
| r6–r8 + playoff 人分 | ✅ |
| 内核 A/B（抖动 Bayer4 vs FS） | ⏳ `exp-static-algo-dither-r1` 待人分 |
| 合回 src | ❌ 未做 |

---

## 9. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-09-29 | 初稿 |
| 2026-09-29 | **重整**：区分参数/算法、机器/人职责、一代=一轮实验；去掉易混表述 |
