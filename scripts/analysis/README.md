# analysis

Python toolkit that turns `validator/results/results.json` into paper-ready assets.

```
pnpm analyze:install   # one-time: pip install matplotlib + numpy
pnpm score             # (re)generate results.json
pnpm analyze           # build tables + figures
```

Outputs land in `validator/results/analysis/`:

- `tables/` — each table as `.tex` (booktabs, drop-in via `\input{}`) **and** `.csv`
  - `consolidated` — every run × metrics
  - `metrics_by_run` — metrics as rows, runs as columns (paper Table II layout)
  - `gaps` — per-LLM gap to the ceiling, per dimension
  - `summary_gaps` — mean gap per dimension, overall and by prompt condition
- `figures/` — each chart as `.pdf` (for LaTeX) **and** `.png` (preview)
  - `metrics_grouped` — all metrics per run
  - `gap_heatmap` / `gap_by_dimension` — distance to ceiling (QP1/QP3)
  - `coverage_vs_effectiveness` — coverage vs mutation score (the core thesis)
  - `p1_vs_p2` — basic vs metrics-aware prompt per model (QP2)
  - `radar` — quality profile per run vs the ceiling
  - `smell_density` — maintainability dimension

The script re-reads `results.json` on every run and tolerates a partial file
(missing ceiling, unscored runs, null metrics), so it is safe to run while the
suites are still being scored. A failing view is skipped with a warning instead
of aborting the rest.
