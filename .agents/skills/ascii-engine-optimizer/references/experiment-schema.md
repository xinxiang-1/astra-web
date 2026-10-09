# Experiment protocol

Use JSON for manifests and result bundles. Use JSONL only for append-only event logs.

## Dataset manifest

```json
{
  "dataset_version": "ascii-benchmark-v1",
  "created_at": "ISO-8601",
  "fixtures": [
    {
      "id": "portrait-001",
      "source_id": "portrait-original-001",
      "path": "public/benchmarks/portrait-001.jpg",
      "sha256": "64 lowercase hex characters",
      "split": "train",
      "tags": ["portrait", "low-contrast"],
      "license": "project-owned"
    }
  ]
}
```

Required rules:

- `dataset_version` is immutable. Create a new version when membership or labeling changes.
- `id` is unique per fixture. `source_id` groups crops, frames, and variants from the same original.
- One `source_id` can belong to only one split.
- Each fixture has a content hash and explicit usage/license note.
- `holdout` remains hidden from parameter fitting and weight tuning.

## Experiment record

```json
{
  "experiment_id": "exp-...",
  "parent_id": null,
  "mode": "static",
  "engine": { "commit": "...", "version": "..." },
  "environment": {
    "browser": "...",
    "viewport": [1440, 960],
    "dpr": 1,
    "font": "Consolas",
    "device_tier": "desktop-mid"
  },
  "dataset_version": "ascii-benchmark-v1",
  "seed": 42,
  "budgets": { "candidates": 128, "judge_calls": 16, "wall_minutes": 30 },
  "stopping": { "max_rounds_without_holdout_gain": 3 },
  "parameter_space": {},
  "evaluator_versions": {}
}
```

## Candidate record

Store raw parameters and never infer them later from filenames.

```json
{
  "id": "candidate-...",
  "experiment_id": "exp-...",
  "fixture_id": "portrait-001",
  "parameters": {},
  "artifact_hashes": { "overview": "...", "native_crop": "...", "motion": null },
  "measurements": {},
  "constraints": { "readable": true, "frame_budget": true, "memory_budget": true },
  "eligible": true,
  "scores": { "structure": 0.81, "readability": 0.76, "frame_p95_ms": 18.2 }
}
```

## Versioning

Changing a metric formula, judge rubric, normalization range, font, renderer, or browser major version creates a new evaluator/environment version. Do not compare aggregate ranks across incompatible versions without re-running the baseline.
