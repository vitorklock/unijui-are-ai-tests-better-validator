The test suite is written at `tests/expression-parser.test.ts`. I could not execute it: this session has no shell tool, and the project has no `node_modules` installed, so `pnpm test` was not run. Every assertion was verified by tracing the lexer, parser, and evaluator by hand. Please run `pnpm install && pnpm test` to confirm.

**What the tests cover** (about 95 assertions across 80 cases):

- **Literals**: integers, decimals including `.5`, single and double quoted strings, empty strings, booleans, case-insensitive keywords, whitespace handling.
- **Arithmetic**: all four operators, precedence of `*` and `/` over `+` and `-`, left associativity, parentheses, string concatenation, division by zero.
- **Comparison**: all six operators, strict equality without coercion, arithmetic binding tighter than comparison, ordering binding tighter than equality.
- **Logical**: `and` and `or`, parenthesised mixing, and short-circuit behaviour verified with a `vi.fn()` context that must not be called.
- **Context**: identifier lookup, identifier name passed to the context function, call counts, underscore names, throwing when no context is given.
- **`between`**: inclusive bounds, decimals, combination with other conditions, parse errors for non-numeric bounds or missing `and`.
- **`is null` / `is not null`**: null versus falsy values, combination with other clauses, error when `null` is missing.
- **`case`**: first match wins, `else`, no match without `else` returns false, nesting, use as an operand, upper-case keywords, and parse errors for missing `when`, `then`, or `end`.
- **Functions**: `length` on literals, strings and arrays from context, nested argument expressions, arity errors, unknown function error.
- **`evaluateObject`**: property lookup, missing property, and a realistic SQL-style WHERE predicate.
- **`parse`**: AST shape for every node type, precedence and grouping trees, and the desugaring of `between` and `is [not] null`.

**Behaviours I noticed while tracing that look like bugs.** I did not write tests that lock these in, so you can decide whether to fix them:

- **`or` binds tighter than `and`**, the reverse of SQL. `true or false and false` evaluates to false where SQL gives true. The precedence table in `src/parser.ts:8` assigns `and` 1 and `or` 2.
- **Multi-argument function calls cannot parse.** After a comma the parser does not advance, so `f(1, 2)` throws "Unexpected start of expression". See `src/parser.ts:182`.
- **Trailing tokens are silently ignored.** `1 2` and `1 $ 2` both evaluate to 1 because the parser never checks for EOF after the top-level expression.
- **`is null` is false for undefined.** It compares with `===` against null, so a missing property on the object passed to `evaluateObject` is not considered null.
- **Unary minus and prefix `not` are unsupported.** `-1` and `not true` both throw, even though `not` has a precedence entry.
