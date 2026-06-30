# Running the experiment

This document describes the end-to-end procedure for generating LLM test suites
and scoring them against the quality ceiling.

## Mental model

Three roles map onto the two repositories:

- **`bench/`** — the workshop. A model writes one test file here, in isolation,
  and the folder is cleared between runs.
- **`validator/runs/<name>/tests/`** — the archive. Each generated suite is
  copied here under its own folder, one per *(model × condition)*, alongside the
  hand-built `ceiling`.
- **`pnpm score`** — the grader. It reads every folder under `runs/`, scores it,
  and prints Table II plus the per-metric gaps.

The two independent git repositories enforce the core rule: a model only ever
sees `bench/`, never `validator/`, the prompts, or the scoring criteria.

## Prerequisites (one-time setup)

Install dependencies in both projects and confirm the target code is in sync:

```
cd validator && pnpm install
cd ../bench  && pnpm install
cd ../validator && pnpm verify-target
```

`verify-target` compares `bench/src` to `validator/target/src` by SHA-256. It
must pass before any scoring, since it guarantees the code a model tested is
byte-identical to the code Stryker mutates. If it fails, sync the two
(`cp bench/src/* validator/target/src/...`) and rerun it.

## Step 1 — Build the quality ceiling (once)

The ceiling is the best achievable suite for the target — the reference every
LLM run is measured against. It is built with no restriction of means (AI,
tools, manual editing), iterating until the mutation score saturates and no
smells remain.

1. Write a suite into `runs/ceiling/tests/number-validator.test.ts`, importing
   the target as `../src/number-validator`.
2. Run `pnpm score` and read the `ceiling` row; run
   `pnpm smells runs/ceiling/tests/` for the smell breakdown.
3. Add tests that kill surviving mutants, remove any flagged smells, and repeat
   until the recall (`R`) plateaus and smell density is `0`.

The folder must be named exactly `ceiling` — `score.ts` uses it as the gap
reference. Document each refinement decision for replicability.

## Step 2 — Generate a suite per (model × condition)

Repeat this loop for every cell of the design — e.g. `claude-opus × P1`,
`claude-opus × P2`, `gpt-5 × P1`, and so on.

### (a) Isolate the workspace

Copy the bench to a neutral working directory so the model cannot infer the
experiment from `pwd`, `ls ..`, or `git log`:

```
cp -r bench /tmp/work/number-validator
cd /tmp/work/number-validator && rm -rf .git && pnpm install
```

### (b) Generate the tests

Ensure `tests/` is empty, then launch the model pointed at that directory,
providing the verbatim contents of the condition's prompt:

- Condition P1 (basic): [`prompts/PROMPT_P1.md`](../prompts/PROMPT_P1.md)
- Condition P2 (metrics-aware): [`prompts/PROMPT_P2.md`](../prompts/PROMPT_P2.md)

The model writes `tests/number-validator.test.ts` and may iterate by running
`pnpm test`. That is the only command the bench exposes.

### (c) Archive the result

Copy the generated file into a run folder named `<model>-<condition>`:

```
mkdir -p validator/runs/gpt-5-p1/tests
cp /tmp/work/number-validator/tests/number-validator.test.ts \
   validator/runs/gpt-5-p1/tests/
```

`score.ts` auto-discovers any `runs/<name>/tests/*.test.ts`, so a new folder
becomes a new row with no configuration change.

### (d) Reset

Remove the temporary workspace (`rm -rf /tmp/work/number-validator`) and repeat
for the next cell.

One check when copying a suite over: the import path is `../src/number-validator`
(the same path that resolves in both the bench and the scoring sandbox).

Do **not** fix or trim the generated suite. It is scored exactly as produced —
there is no pass-100% gate. Tests that fail against the correct code are counted
as **false positives** and lower precision (P); they are skipped only for the
mutation run so Stryker keeps a green baseline.

## Step 3 — Score all suites

```
cd validator
pnpm verify-target
pnpm score              # all runs
pnpm score <run-name>   # only that run (e.g. `pnpm score ceiling`)
```

Passing a run name scores just that one suite — handy while iterating on the
ceiling or a single condition. It merges the result into the previous
`results.json` (the other rows are kept and the `ceiling` row is reused to
recompute the gap), so you still get the full table without re-running Stryker
on every suite.

Two tables are printed and written to `results.json`:

```
=== CONSOLIDATED (paper Table II) ===
Run              Tests  FP  Cov.L%  Cov.B%  R%    P%     F1%   Smells/test
ceiling          7      0   77.8    92.8    35.2  100.0  52.0  0.00
claude-opus-p1   5      1   57.4    28.6     2.2   80.0   4.3  0.00
...

=== GAP vs ceiling (ceiling - run) ===
Run              dCov.L  dCov.B  dR     dP     dF1    dSmells/test
claude-opus-p1   +20.4   +64.3   +33.0  +20.0  +47.7  +0.0
```

Metric definitions:

- **FP** — false positives: tests that fail on the correct code.
- **R** — mutation score (recall): non-equivalent mutants killed.
- **P** — precision: `passing / total` test cases on the correct code
  (`1 − false-positive rate`). Clean suite → 100%; suite with failing tests → <100%.
- **F1** — `2PR/(P+R)`, now varying with both P and R.
- **Smells/test** — structural test-smell occurrences per test case.
- **Gap** — `ceiling − run`. A larger positive `dR`/`dF1`/`dCov` means the run
  is further below the ceiling on that dimension. For smell density, a negative
  value means the run has more smells than the ceiling.

Run `pnpm smells runs/<name>/tests/` for a per-rule smell breakdown of one suite.

## Step 4 — Interpreting the results

The gap table answers the research questions directly:

- **QP1** (how far below the ceiling) — the magnitude of the gaps for each LLM
  run.
- **QP2** (does the metrics-aware prompt narrow the gap) — compare each model's
  `-p1` row against its `-p2` row.
- **QP3** (which dimension is widest) — the largest gap column, expected to be
  `dR` and `dSmells`, with coverage closest to the ceiling.

## Practical notes

- **Determinism.** Fix the model version and generation parameters and repeat
  runs. For repeats, use folders such as `gpt-5-p1-r1`, `gpt-5-p1-r2`; each is
  an independent row to average afterward.
- **Generation tooling.** Mixing orchestration tools (e.g. one agent harness for
  one model, another for a second) is a threat to internal validity — keep it
  constant per model or report it.
- **Do not edit the target.** `bench/src` and `validator/target/src` must stay
  byte-identical; `verify-target` refuses to score if they drift.
