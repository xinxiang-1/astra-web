# Reward and constraints

## Separate constraints from preferences

Hard constraints reject a candidate before ranking:

- minimum native glyph/cell readability;
- maximum frame P95 and dropped-frame rate by device tier;
- maximum memory and first-frame latency;
- minimum subject/edge retention;
- maximum temporal flicker or loop seam for motion.

Preferences rank eligible candidates:

- structure and subject recognition;
- local tone and color fidelity;
- glyph clarity and intentional texture;
- composition and background cleanliness;
- temporal smoothness and aesthetic motion;
- human or calibrated model preference.

## Initial metric families

Do not implement every metric at once. Start with one reliable measure per failure class.

- Structure: edge precision/recall at multiple scales; optional perceptual similarity.
- Readability: native cell size, glyph occupancy, contrast, and a fixed 100% crop check.
- Tone/color: luminance histogram distance, local contrast, color difference when colored mode is enabled.
- Motion: frame difference outside intended moving regions, optical-flow residual, silhouette drift, loop seam.
- Performance: warm frame P50/P95, dropped frames, first-frame time, peak memory when measurable.

## Multi-objective ranking

Keep raw measurements. Normalize only within a versioned evaluator. Use a Pareto frontier rather than one universal score.

Maintain separate profiles:

- `quality-first`
- `balanced`
- `performance-first`
- optional style-specific profiles such as `portrait`, `poster`, or `retro`

Never tune metric weights on holdout. If a weight change is prompted by holdout failures, create a new dataset version or reserve a new final holdout.

## Reward-hacking checks

For every new metric, keep counterexamples that score well but look bad. Reject the metric or add a hard guard when it rewards oversharpening, contrast clipping, background noise, unreadable density, frozen motion, or excessive simplification.
