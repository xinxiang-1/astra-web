---
name: ascii-engine-optimizer
description: Evaluates and improves the Astra character-art engine through reproducible benchmarks, objective metrics, pairwise visual judging, Pareto selection, and bounded parameter search. Use when optimizing ASCII image quality, animation quality, rendering performance, clarity presets, color/tone parameters, or image-to-parameter recommendations. Do not use for ordinary UI changes or one-off visual tweaks without an evaluation loop.
---

# ASCII Engine Optimizer

Build evidence before changing defaults. Treat optimization as a versioned experiment, not an aesthetic guess.

## Sandbox isolation (hard rule)

All optimization work lives in `sandbox/ascii-optimizer/`:

- Engine edits → `sandbox/ascii-optimizer/engine/` (a copy of `src/lib/ascii`)
- Experiments / artifacts / judges → `sandbox/ascii-optimizer/experiments/`
- Scripts / harness → `sandbox/ascii-optimizer/scripts/` and `harness/`

**Do not modify production `src/`** for optimizer loops, parameter screening, or renderer experiments. Sync a fresh copy with `npm run sandbox:ascii:sync` when needed. Promote to `src/` only after explicit user approval.

## Choose the mode

- **Static**: optimize image sampling, charset, tone, color, glyph geometry, and clarity. Start here unless the request is explicitly motion-only.
- **Motion**: optimize hover/motion parameters, temporal stability, dynamic resolution, and frame cost. Require a static baseline first.
- **Policy**: learn or fit image/device-to-parameter recommendations. Require a trustworthy experiment history first.

Read only the references needed for the selected mode:

- Always read [references/experiment-schema.md](references/experiment-schema.md) and [references/benchmark-policy.md](references/benchmark-policy.md).
- For metrics or reward changes, read [references/reward-design.md](references/reward-design.md).
- Before using a vision model as a judge, read [references/judge-protocol.md](references/judge-protocol.md).
- Before proposing search, Bayesian optimization, CMA-ES, or learning, read [references/optimization-modes.md](references/optimization-modes.md).

## Non-negotiable invariants

1. Record the engine commit, browser, viewport, DPR, font, device tier, random seed, input hash, parameter set, and evaluator versions.
2. Split datasets by original source ID. Related crops or frames must never cross train/dev/holdout boundaries.
3. Keep readability and performance as hard constraints. Aesthetic scores cannot compensate for illegible glyphs, frame-budget failure, or excessive memory.
4. Use Pareto selection. Report at least quality-first, balanced, and performance-first candidates instead of hiding tradeoffs in one score.
5. Objective metrics eliminate invalid candidates before any model judging. Send only diverse Top-K candidates to a paid or nondeterministic judge.
6. Pairwise judging must be blind, swap A/B order, allow ties, and retain confidence plus structured failure reasons.
7. Never automatically replace production defaults, commit, publish, or begin paid model evaluation. Obtain authorization for the specific mutation or external cost.
8. Stop when the declared budget is reached, three consecutive rounds fail to improve the holdout Pareto frontier, or evaluator reliability falls below its threshold.

## Workflow

1. **Audit the current engine**: locate parameters, renderer entrypoints, export paths, performance instrumentation, and existing baselines. Preserve unrelated user changes.
2. **Declare the experiment**: objective, selected mode, target device tiers, dataset version, parameter bounds, hard constraints, budgets, and stopping condition.
3. **Validate the dataset manifest** with `node scripts/validate-manifest.mjs <manifest.json>`.
4. **Render deterministically**: fixed seeds and timelines; warm up before timing; store artifacts by content hash.
5. **Score objectively**: keep raw measurements and normalized scores. Do not discard failed candidates; store the failure reason.
6. **Select diverse Top-K**: filter hard constraints, calculate the Pareto frontier, then preserve visual/parameter diversity.
7. **Judge only when useful**: follow the judge protocol and cache results by artifact hash, rubric version, and model version.
8. **Propose the next batch** using the least complex optimizer justified by the evidence.
9. **Report**: show holdout results, uncertainty, regressions, cost, device performance, and recommended candidates. Ask before changing defaults.

## Minimum report

Include:

- experiment ID, engine commit, dataset and evaluator versions;
- hypothesis and parameter bounds;
- candidate counts at generated, valid, Top-K, and judged stages;
- holdout Pareto candidates with hard-constraint status;
- wins, regressions, confidence/variance, model/API cost, and runtime cost;
- representative failures and the next decision;
- an explicit statement that production defaults were or were not changed.

## Utility scripts

- `scripts/validate-manifest.mjs`: execute to validate dataset splits, source grouping, hashes, and required metadata.
- `scripts/select-pareto.mjs`: execute on scored candidates to emit eligible non-dominated candidates.

These helpers validate protocol data only. They do not render artwork, call external models, or mutate application settings.
