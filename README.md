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

## What is here

- `target/src/` - copy of the code under test, mutated by Stryker. Must be
  identical to `bench/src/` (checked by `verify-target`).
- `prompts/` - the experimental stimuli:
  - `PROMPT_P1.md` - condition 1 (basic prompt)
  - `PROMPT_P2.md` - condition 2 (metrics-aware prompt)
- `runs/` - one subfolder per evaluated suite:
  - `ceiling/` - the quality ceiling (built manually)
  - `<model>-p1/`, `<model>-p2/` - generated suites, copied from the bench
- `scripts/score.mjs` - scores all suites and consolidates (paper Table II).
- `scripts/verify-target.mjs` - checks the target is in sync with the bench.
- `stryker.conf.template.mjs` - mutation config (copied into each sandbox).
- `eslint-smells.config.cjs` - test-smell detection rules.

## Experimental flow

```
# 0. Install (once)
npm install

# 1. Make sure the target here is identical to the bench's
npm run verify-target

# 2. Run a model against the bench (NOT this folder):
#    - clear bench/tests/ (must be empty before each run)
#    - give the model the contents of prompts/PROMPT_P1.md or PROMPT_P2.md
#    - the model writes bench/tests/number-validator.test.ts
#    - copy that file into runs/<model>-<condition>/tests/
#    - clear bench/tests/ before the next run

# 3. Score everything (coverage + mutation + test count)
npm run score

# 4. Test smells per suite (separate; some need manual reading)
npm run smells -- runs/claude-opus-p1/tests/
```

`npm run score` writes `results.json` and prints the consolidated table with
coverage, mutation score and # tests per run. The `ceiling` row is the ceiling;
the others are the LLM conditions. The per-metric gap (paper Eq. 4) is
`ceiling - run`.

## Import path in the suites

`score.mjs` builds a sandbox where the target is at `src/` and the suite at
`tests/`. So the suites in `runs/<name>/tests/` must import the target as
`../src/number-validator` - the same path that works inside `bench/tests/`.
Confirm this when copying a suite over.

## Precondition

Every suite must pass against the correct code before being scored. `score.mjs`
checks this and flags failing suites without giving them a mutation score (a
suite that fails on correct code would have compromised precision).

## On precision / recall / F1

The mutation score acts as **recall** (fraction of faults detected).
**Precision** depends on measuring false positives - tests that fail on correct
code. Since the precondition requires every suite to pass on correct code, in
the current design P=1 by construction (no false positives accepted). To measure
precision non-trivially, introduce a suite of mutants/versions with known faults
and count how many reported failures correspond to real faults - see the
methodology discussion.
