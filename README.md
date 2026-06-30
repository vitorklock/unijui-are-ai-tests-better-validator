# validator

Evaluation harness. **Never exposed to any AI model.** This is where the
quality criteria live (mutation, coverage, test smells) - the criteria the
models must not know about. It also holds the experimental prompts and the
procedure for running the experiment.

## Isolation rule (important)

The `bench` project is what a tested model sees. It must look like an ordinary
library that happens to need tests: it contains **only** the code under test
and a Vitest setup, with no hint of how the tests will be judged.

When running a model (Claude Code, Copilot, etc.), **point the tool at `bench/`,
never at the parent folder**, so the model cannot see this `validator` project,
the prompts, or the scoring criteria.

### Operational isolation

File contents are clean, but a model with shell access can still infer the
setup from its *environment*. Before running a model, copy the bench to a
neutral working dir so `pwd`, `ls ..`, and `git log` reveal nothing:

```
cp -r bench /tmp/work/number-validator      # neutral path, no sibling validator/
cd /tmp/work/number-validator && rm -rf .git # or re-init with a neutral author
# point the model here; copy the generated tests back into runs/<name>/tests/
```

The committed bench history already uses a neutral author (`dev`), but the
parent path (`.../egs-experimental/...`) and the sibling `validator/` directory
are only hidden by working from a neutral copy.

## What is here

- `target/src/` - copy of the code under test, mutated by Stryker. Must be
  identical to `bench/src/` (checked by `verify-target`).
- `prompts/` - the experimental stimuli:
  - `PROMPT_P1.md` - condition 1 (basic prompt)
  - `PROMPT_P2.md` - condition 2 (metrics-aware prompt)
- `runs/` - one subfolder per evaluated suite:
  - `ceiling/` - the quality ceiling (built manually)
  - `<model>-p1/`, `<model>-p2/` - generated suites, copied from the bench
- `scripts/score.ts` - scores all suites and consolidates (paper Table II).
- `scripts/verify-target.ts` - checks the target is in sync with the bench.
- `stryker.conf.template.mjs` - mutation config (copied into each sandbox).
- `eslint-smells.config.cjs` - test-smell detection rules.
- `docs/running-the-experiment.md` - full step-by-step procedure
  ([versão em português](docs/running-the-experiment.pt-br.md)).

TypeScript scripts run via `tsx` (`pnpm score`, `pnpm verify-target`).

## Experimental flow

For the full step-by-step procedure (building the ceiling, generating a suite
per model/condition, scoring, and interpreting the gaps), see
[docs/running-the-experiment.md](docs/running-the-experiment.md)
([versão em português](docs/running-the-experiment.pt-br.md)). In short:

```
# 0. Install (once)
pnpm install

# 1. Make sure the target here is identical to the bench's
pnpm verify-target

# 2. Run a model against the bench (NOT this folder):
#    - clear bench/tests/ (must be empty before each run)
#    - give the model the contents of prompts/PROMPT_P1.md or PROMPT_P2.md
#    - the model writes bench/tests/number-validator.test.ts
#    - copy that file into runs/<model>-<condition>/tests/
#    - clear bench/tests/ before the next run

# 3. Score everything (full Table II + gaps)
pnpm score

# 4. Optional: per-rule smell output for one suite
pnpm smells runs/claude-opus-p1/tests/
```

`pnpm score` writes `results.json` and prints two tables: the consolidated
Table II (coverage, mutation score `R`, precision `P`, `F1`, smell density per
test) for every run, and the per-metric gap vs the `ceiling` run (paper Eq. 4,
`ceiling - run`). The `ceiling` row is the ceiling; the others are the LLM
conditions. If no `ceiling` run is scored, the gap table is skipped.

## Import path in the suites

`score.ts` builds a sandbox where the target is at `src/` and the suite at
`tests/`. So the suites in `runs/<name>/tests/` must import the target as
`../src/number-validator` - the same path that works inside `bench/tests/`.
Confirm this when copying a suite over.

## No precondition gate

Suites are scored exactly as generated — there is **no** pass-100% gate, and
failing suites are neither corrected nor discarded. Tests that fail against the
correct code are counted as **false positives** and lower precision. For the
mutation run only, those failing tests are skipped (a test that fails on correct
code is an invalid detector and would otherwise abort Stryker's green baseline
and spuriously inflate recall). `score.ts` reports the false-positive count per
run; a suite that errors before producing any results is marked "could not run".

## Metrics: precision, F1, and smell density

- **Recall (R)** = mutation score (fraction of non-equivalent mutants killed).
- **Precision (P)** = `passing / total` test cases on the correct code, i.e.
  `1 − false-positive rate`. A "positive" is a test case (a behavioral claim); a
  false positive is a test that fails on correct code. A clean suite has P=1; a
  suite with failing tests has P<1.
- **F1** = `2PR/(P+R)` — now varies with both P and R, computed and exported
  automatically.
- **Smell density** = structural test-smell occurrences per test case, from
  `eslint-plugin-vitest`. Only **structural** smells are counted (Assertion
  Roulette, Eager Test, Duplicate, etc.); **semantic** smells (real Mystery
  Guest, contextual Magic Number) need manual inspection and are out of scope.
