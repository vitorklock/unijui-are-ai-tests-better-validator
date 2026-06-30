# Ceiling: equivalent mutants (why recall is 95.6%, not 100%)

The ceiling suite kills **every killable mutant** Stryker generates for
`number-validator.ts`. Its recall plateaus at **95.6%** because exactly **4 of
the 91 mutants are equivalent** — they cannot be killed by *any* test, so they
are the hard upper bound for this target. This file documents that bound for
replicability (per the paper's requirement that every ceiling-construction
decision be recorded).

## Census (StrykerJS, default mutators)

| Status   | Count |
| -------- | ----- |
| Killed   | 87    |
| Survived | 4     |
| Total (valid) | 91 |

Mutation score = (Killed + Timeout) / valid = 87 / 91 = **95.60%**. No
NoCoverage, Timeout, or invalid (compile/runtime-error) mutants.

## The 4 survivors — all equivalent

All four are on the `typeof … !== "undefined"` guards of the min/max branches:

```ts
if (typeof min !== "undefined" && value < min) { … }   // line 71
if (typeof max !== "undefined" && value > max) { … }   // line 79
```

| # | Line | Mutator | Mutation | Reduces guard to |
| - | ---- | ------- | -------- | ---------------- |
| 1 | 71 | ConditionalExpression | `typeof min !== "undefined"` → `true` | `if (value < min)` |
| 2 | 71 | StringLiteral | `"undefined"` → `""` | `if (typeof min !== "" && value < min)` ≡ `if (value < min)` |
| 3 | 79 | ConditionalExpression | `typeof max !== "undefined"` → `true` | `if (value > max)` |
| 4 | 79 | StringLiteral | `"undefined"` → `""` | `if (value > max)` |

## Proof of equivalence

The guard `typeof min !== "undefined"` is **redundant** with the comparison that
follows it. Each mutation only changes behavior in the single case where
`min === undefined`; in every other case the guard is already `true` and both
forms reduce to the identical `value < min`.

When `min === undefined`, the mutated branch evaluates `value < undefined`.
`value` is guaranteed to be a number (the function returns early for non-numbers
on line 54), and the `<` operator applies `ToNumber(undefined) = NaN`. Every
relational comparison against `NaN` is `false` — for **all** numeric operands,
including `NaN`, `±Infinity`, `±0`, `Number.MAX_VALUE`, `Number.MIN_VALUE`, and
arbitrary finite values. So the mutated branch never fires, exactly matching the
original (whose guard is `false` there). The same holds for `value > max`.

`isValid()` is unaffected: it uses a separate `min === undefined ||` /
`max === undefined ||` guard, untouched by these line-71/79 mutations.

Therefore **no `(options, value)` pair can distinguish the mutant from the
original** — the 4 mutants are equivalent, and 95.6% is the maximum achievable
recall.

## Verification

- **Analytical:** the argument above (IEEE-754 / ECMAScript abstract relational
  comparison).
- **Empirical:** a 12-agent adversarial panel (each of the 4 survivors attacked
  from 3 independent angles — exotic numerics, runtime type abuse, formal proof)
  returned **0 kills / 12 verdicts**.
- **Tooling:** every *other* mutation on lines 71/79 (`=== "undefined"`,
  `value <= min`, `value >= min`, `||`, `false`) **is killed**, so the suite is
  maximally discriminating there.

## Relation to the paper (Eq. 2)

Eq. 2 defines `R = M_killed / (M_total − M_equiv)`. StrykerJS does **not**
auto-detect equivalent mutants, so the reported `R = 95.6%` keeps them in the
denominator (87 / 91). Subtracting the 4 equivalents identified here gives
`87 / (91 − 4) = 100%`. The apparatus reports **95.6%** (Stryker basis) for all
suites so the ceiling and the LLM rows are comparable on one definition of `R`;
this file is the record of why the ceiling is not 100%.

## Reproduce

```
pnpm score --only ceiling     # R 95.6, cov 100/100, P 100, F1 97.8, 0 smells
```
