# Benchmark policy

## Dataset composition

Start with 30–50 project-licensed images covering portraits, landscapes, pets, high/low contrast, bright/dark subjects, busy backgrounds, multiple aspect ratios, and representative color distributions. Add motion clips only after the static protocol is stable.

Use source-grouped splits such as:

- train/exploration: 60%
- development/calibration: 20%
- holdout/final decision: 20%

The exact ratio matters less than source isolation and sufficient subgroup coverage.

## Golden baselines

For each dataset and engine version, retain:

- current production/default output;
- native-size crop and fit overview;
- fixed performance trace;
- known good and known bad counterexamples;
- human pairwise decisions used for evaluator calibration.

## Determinism

Lock seed, font files, browser major version, viewport, DPR, color profile when possible, animation timeline, pointer path, warm-up duration, and capture timestamps. Disable unrelated animations and ensure the tab is foregrounded for performance runs.

## Performance protocol

- Warm up before sampling.
- Measure repeated runs and report P50/P95, not a single FPS number.
- Separate cold-start, steady-state, and interaction costs.
- Test declared device tiers; do not extrapolate a high-end desktop result to low-end clients.
- Treat background-tab or throttled runs as invalid.

## Dataset maintenance

New real-world failures should enter a development failure set first. Promote them into the next versioned benchmark deliberately. Never alter the current holdout during an active optimization study.
