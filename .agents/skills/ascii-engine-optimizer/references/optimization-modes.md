# Optimizer selection

Choose the least complex method that can answer the experiment question.

## Ordered options

1. **Grid or hand-designed ablation**: use for one to three parameters and validating causal assumptions.
2. **Random or Latin hypercube sampling**: default first exploration for mixed spaces and sensitivity analysis.
3. **TPE/Bayesian optimization**: use when renders are expensive, parameters are mixed continuous/categorical, and the evaluator is reasonably stable.
4. **CMA-ES**: use for mostly continuous parameters with smooth-enough objectives and no large conditional tree.
5. **Surrogate recommender**: use after enough diverse, version-compatible experiment history exists.
6. **Contextual bandit**: consider only after offline validation and when safe online preference feedback is available.

Full reinforcement learning is not the default. Require a defensible sequential environment, reward, exploration safety policy, and evidence that contextual optimization is insufficient.

## Conditional space

Avoid meaningless combinations:

- color parameters exist only when colored mode is enabled;
- motion parameters exist only in motion mode;
- phrase and charset modes use separate spaces;
- dynamic-resolution parameters activate only above the relevant density/device threshold.

## Batch proposal rules

- Include the current baseline in every batch.
- Reserve part of the batch for exploration and part for exploitation.
- Deduplicate by canonical parameter hash.
- Preserve diversity among Top-K; near-identical candidates waste judge calls.
- Do not use holdout results to generate the next batch.

## Promotion

A candidate can become a recommended preset only if it beats or ties the baseline on holdout, satisfies every hard constraint for its target device tier, and shows no severe subgroup regression. Production adoption still requires explicit approval.
