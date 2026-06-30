export const meta = {
  name: 'build-quality-ceiling',
  description: 'Adversarially prove the mutation ceiling and build the best Vitest suite for NumberValidator',
  phases: [
    { title: 'Equivalence', detail: 'try to kill each of the 4 surviving mutants from diverse angles' },
    { title: 'Generate', detail: 'independent optimal-suite candidates, 3 strategies' },
  ],
}

const TARGET = `// ==== src/number-validator.ts (the code under test; mutated by Stryker) ====
export default class NumberValidator extends Validator<number> {
  private readonly options: NumberValidatorOptions; // { multipleOf?, min?, max? } all readonly number
  constructor(options) { super(); this.options = options; }
  min(min)        { return new NumberValidator({ ...this.options, min }); }
  max(max)        { return new NumberValidator({ ...this.options, max }); }
  multipleOf(mo)  { return new NumberValidator({ ...this.options, multipleOf: mo }); }
  integer()       { return this.multipleOf(1); }

  validate(value, path = []) {
    const { multipleOf, min, max } = this.options;
    if (typeof value !== "number") {
      return [{ message: \`must be a number\`, path, value }];
    }
    const errors = [];
    if (multipleOf && value % multipleOf !== 0) {
      errors.push({ message: multipleOf === 1 ? "number was not an integer"
                                              : \`number was not a multiple of \${multipleOf}\`, path, value });
    }
    if (typeof min !== "undefined" && value < min) {
      errors.push({ message: \`\${value} must be greater than or equal to \${min}\`, path, value });
    }
    if (typeof max !== "undefined" && value > max) {
      errors.push({ message: \`\${value} must be less than or equal to \${max}\`, path, value });
    }
    return errors;
  }

  isValid(value) {
    const { max, min, multipleOf } = this.options;
    return typeof value === "number"
      && (max === undefined || value <= max)
      && (min === undefined || value >= min)
      && (multipleOf === undefined || value % multipleOf === 0);
  }

  _toJsonSchema() { return { type: "number", multipleOf: this.options.multipleOf,
                             minimum: this.options.min, maximum: this.options.max }; }
}

// ==== inherited from Validator (src/interfaces.ts) ====
// toJsonSchema(): caches; returns removeUndefinedProperties(_toJsonSchema()). Same ref on repeat calls.
//                 _toJsonSchema() is raw: KEEPS undefined-valued keys, NOT cached, fresh object each call.
// checkValid(value, path?): returns value if validate() is empty; else throws FailedValidationError.
// FailedValidationError: .isFailedValidationError === true; .errors === ValidationError[];
//   .message = errors.map(e => [e.path.join("."), e.message].filter(s => s.length>0).join(": ")).join("; ")
//   => empty path is dropped (message only); non-empty path renders "a.0: <message>".
// import default NumberValidator from "../src/number-validator";
// import { FailedValidationError } from "../src/interfaces";`

const QUIRKS = `BEHAVIOR MAP (exact, observed) — every bullet is a distinct behavior to assert with EXACT values:
1. validate(non-number) -> [{message:"must be a number", path, value}] and RETURNS EARLY (min/max/multipleOf ignored even if all set). Path defaults to [] and is passed through (by reference).
2. multipleOf: multiple -> no error; non-multiple -> "number was not a multiple of N"; multipleOf===1 -> "number was not an integer"; 0 is a multiple of any divisor; negative & fractional multipleOf interpolate into the message ("-2", "0.5").
3. multipleOf:0 is FALSY -> validate() SKIPS the check (no error for any value); BUT isValid() uses (multipleOf===undefined||...) so 0 is an active divisor and n%0===NaN -> isValid ALWAYS false. (validate vs isValid INCONSISTENCY — assert both sides.)
4. min: inclusive (value<min rejects; value===min ok; value>min ok). min:0 is enforced (guard is typeof, not truthiness): validate(-1) errors, validate(0) ok. Message "\${value} must be greater than or equal to \${min}".
5. max: inclusive (value>max rejects; value===max ok). max:0 enforced. Message "\${value} must be less than or equal to \${max}".
6. Error accumulation ORDER is [multipleOf, min, max]. e.g. {min:10,multipleOf:2}.validate(5) -> [multipleOf err, min err] in that order. Two/three errors when several violated.
7. Builders: return a NEW instance (immutability — original unchanged after min()/max()/etc.); spread carries previously-set options forward; calling the same builder twice keeps the LAST value (override); integer() === multipleOf(1).
8. isValid(value): boolean. typeof guard; all three clauses; NaN -> false once any bound/divisor set, true when unconstrained.
9. checkValid: returns the value unchanged when valid; throws FailedValidationError when invalid; .message joins errors with "; "; empty path -> message only; non-empty path -> "a.0: <message>"; .isFailedValidationError true; .errors array.
10. toJsonSchema(): {type:"number"} plus minimum/maximum/multipleOf for set options; strips undefined; CACHED (===same ref on repeat). _toJsonSchema(): raw, RETAINS undefined keys, fresh object each call (not cached, !==).
11. Special numerics: NaN passes typeof "number" (validate(NaN) with no constraint -> []; with multipleOf -> not-a-multiple error; with min/max -> NO error because NaN<min and NaN>max are both false). Infinity violates max & multipleOf but satisfies min; -Infinity the mirror. -0 behaves like 0 and interpolates as "0". Number.MAX_VALUE is an even multiple; Number.MIN_VALUE is not.`

const SURVIVORS = [
  { id: 'L71-cond-true', loc: 'line 71', code: 'if (typeof min !== "undefined" && value < min)', mutation: 'the sub-expression `typeof min !== "undefined"` is replaced by `true`, giving `if (true && value < min)` === `if (value < min)`' },
  { id: 'L71-str-empty', loc: 'line 71', code: 'if (typeof min !== "undefined" && value < min)', mutation: 'the string literal "undefined" is replaced by "" , giving `if (typeof min !== "" && value < min)`' },
  { id: 'L79-cond-true', loc: 'line 79', code: 'if (typeof max !== "undefined" && value > max)', mutation: 'the sub-expression `typeof max !== "undefined"` is replaced by `true`, giving `if (true && value > max)` === `if (value > max)`' },
  { id: 'L79-str-empty', loc: 'line 79', code: 'if (typeof max !== "undefined" && value > max)', mutation: 'the string literal "undefined" is replaced by "" , giving `if (typeof max !== "" && value > max)`' },
]

const LENSES = [
  { key: 'exotic-values', angle: 'Attack with exotic NUMERIC values and option values: NaN, +Infinity, -Infinity, -0, Number.MAX_VALUE, Number.MIN_VALUE, very large/tiny numbers. Find an (options, value) pair where the original and mutated guard produce DIFFERENT validate() output.' },
  { key: 'runtime-type-abuse', angle: 'Attack at runtime by passing options whose typeof is NOT "number": e.g. new NumberValidator({min: undefined as any}), {min: null as any}, {min: "5" as any}, omitted keys, prototype tricks. Reason about what `typeof min` returns and whether the guard mutation changes the branch taken.' },
  { key: 'formal-proof', angle: 'Reason formally. The guard `typeof X !== "undefined"` short-circuits a `&&` whose right side is `value < X` (or `value > X`). Determine whether the mutation can EVER change the boolean result of the whole condition, for ANY value and ANY X. Consider that value already passed `typeof value === "number"`. Either give a concrete counterexample test or prove no input distinguishes them.' },
]

const EQUIV_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mutantId: { type: 'string' },
    killable: { type: 'boolean', description: 'true ONLY if you found a concrete (options,value) that makes the original and mutant return different validate()/isValid() output' },
    killingTest: { type: 'string', description: 'If killable: a complete Vitest it(...) block that FAILS on the mutant and PASSES on the original. Else "".' },
    distinguishingInput: { type: 'string', description: 'If killable: the exact options + value. Else "".' },
    reasoning: { type: 'string', description: 'Concise proof of equivalence, or explanation of the kill.' },
  },
  required: ['mutantId', 'killable', 'killingTest', 'reasoning'],
}

const SUITE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    strategy: { type: 'string' },
    testFile: { type: 'string', description: 'The COMPLETE Vitest test file content, ready to write to disk.' },
    coverageNotes: { type: 'string', description: 'Which behaviors/mutants each block targets; any gaps.' },
  },
  required: ['strategy', 'testFile'],
}

const SMELL_RULES = `SMELL CONSTRAINTS (eslint-plugin-vitest; suite MUST produce ZERO warnings):
- At most 5 expect() calls per test (max-expects). Split bigger tests or use it.each.
- Every test has at least one assertion (expect-expect). No standalone expect outside it(). No expect inside if/try (no-conditional-expect). No malformed expects (valid-expect).
- Unique test titles (no-identical-title). No it.skip/it.todo/disabled tests (no-disabled-tests).
Prefer many small single-behavior tests, or it.each for parametrized cases. Avoid shared mutable validator state across tests (construct per test or use clearly-immutable instances).`

const GENERATORS = [
  { strategy: 'mutant-exhaustive',
    brief: `Build the suite MUTANT-FIRST. For EACH killable mutation Stryker generates on number-validator.ts (block-removal, conditional true/false, equality flips like < to <= and to >=, logical && to ||, string literals to "", arithmetic % to *, array/object literal emptying), write at least one test whose EXACT-VALUE assertion fails when that mutation is applied. Especially nail: boundary equality (value===min, value===max) to kill <=/>= and </>swaps; the [multipleOf,min,max] error ORDER to kill array/ordering mutants; exact messages to kill string-literal mutants; multipleOf % vs * (value=4,multipleOf=2 cannot distinguish %from* since 4%2===0 and ... pick values where a%b !== a*b mod detection, e.g. multipleOf 3 value 9: 9%3===0 but 9*3===27!==0 -> error, distinguishes).` },
  { strategy: 'behavior-spec',
    brief: `Build the suite as a thorough BEHAVIORAL SPECIFICATION from the behavior map. One test per behavior, exact deep-equal on the full ValidationError[] (message+path+value). Cover validate, isValid, builders/immutability, checkValid (inherited, incl. FailedValidationError.message formatting and path prefixing), toJsonSchema caching + undefined stripping vs _toJsonSchema raw, and all special numerics. Make assertions exact so any logic change is caught.` },
  { strategy: 'adversarial-edge',
    brief: `Build the suite to MAXIMIZE fault detection via edge cases: inclusive boundaries and just-inside/just-outside values, multipleOf:0 validate-vs-isValid inconsistency, NaN/±Infinity/-0/MAX_VALUE/MIN_VALUE, negative & fractional multipleOf, error accumulation order & multiplicity, builder override and option carry-forward, path by-reference and default-[]. Exact-value assertions throughout.` },
]

phase('Equivalence')
const equivThunks = []
for (const s of SURVIVORS) {
  for (const lens of LENSES) {
    equivThunks.push(() => agent(
      `You are a mutation-testing skeptic. A Stryker mutant on NumberValidator SURVIVED the ceiling suite. Decide whether it is genuinely EQUIVALENT (no test can kill it) or KILLABLE (you can construct an input that distinguishes it).

${TARGET}

SURVIVING MUTANT [${s.id}] at ${s.loc}:
  original: ${s.code}
  mutation: ${s.mutation}

YOUR ATTACK ANGLE (${lens.key}): ${lens.angle}

Try HARD to kill it. If you find any (options, value) where original and mutant differ in validate()/isValid() output, set killable=true and provide a complete Vitest it(...) block (import default NumberValidator from "../src/number-validator") that passes on the original and fails on the mutant. If after genuine effort no input can distinguish them, set killable=false and give a crisp proof. Default to killable=false ONLY if truly unable to distinguish.`,
      { label: `kill:${s.id}:${lens.key}`, phase: 'Equivalence', schema: EQUIV_SCHEMA, effort: 'high' }
    ))
  }
}

phase('Generate')
const genThunks = GENERATORS.map((g) => () => agent(
  `Write the BEST POSSIBLE Vitest test suite (the "quality ceiling") for this NumberValidator. Goal: kill every killable Stryker mutant (target mutation score 95.6% = 87/91; exactly 4 guard mutants are known-equivalent and unkillable, do NOT chase them), reach 100% line+branch coverage, and produce ZERO test smells.

${TARGET}

${QUIRKS}

${SMELL_RULES}

STRATEGY = ${g.strategy}.
${g.brief}

Output a COMPLETE, self-contained file. First two lines must be:
  import { describe, it, expect } from "vitest";
  import NumberValidator from "../src/number-validator";
and add: import { FailedValidationError } from "../src/interfaces"; if you test checkValid. Every test must PASS against the correct code shown above (this is a hard precondition — wrong expected values disqualify the suite). Use exact deep-equal assertions. Keep <=5 expects per test.`,
  { label: `gen:${g.strategy}`, phase: 'Generate', schema: SUITE_SCHEMA, effort: 'high' }
))

const all = await parallel([...equivThunks, ...genThunks])
const equivalence = all.slice(0, equivThunks.length).filter(Boolean)
const candidates = all.slice(equivThunks.length).filter(Boolean)

const claimedKills = equivalence.filter((e) => e.killable)
log(`Equivalence panel: ${equivalence.length} verdicts, ${claimedKills.length} claimed kills`)
log(`Generated ${candidates.length} candidate suites`)

return { equivalence, claimedKills, candidates }
