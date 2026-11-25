The test suite is written at `tests/expression-parser.test.ts`. I could not execute it: this session has no shell tool, so `pnpm test` was not run. Every expected value and error message was traced by hand through the lexer, parser and evaluator, including the exact token positions in error strings. Please run `pnpm test` to confirm.

**What the suite covers**

- **Parser AST shape** via `toStrictEqual` against constructed AST nodes: all literal forms, every binary operator, precedence between each operator tier, left associativity, parentheses, `is [not] null`, `between` desugaring, function calls, and `case` with one, several, or no `else` branches.
- **Syntax errors** with exact messages for every throw site reachable through the public API, plus regex matches where the offending token is EOF.
- **Evaluator semantics** with boundary tables: each comparison at, just above, and just below the threshold, `between` at both inclusive bounds and just outside them, tiered `case` branches at each cutoff, `is null` against null, undefined, zero and empty string.
- **Short-circuiting** of `and`, `or`, and `case` conditions, verified with `vi.fn` contexts that must not be called.
- **Lexer details**: tabs, newlines and carriage returns, both quote styles, unterminated strings, numbers with leading or trailing dots, case-insensitive keywords, identifiers stopping at digits.
- **evaluateObject** with realistic WHERE-style clauses in true and false configurations.

**Behaviors the tests pin down that you may want to know about**

- `or` binds tighter than `and`, the reverse of SQL. So `true or false and false` evaluates to false.
- A function call with two or more arguments fails to parse with an "Unexpected start of expression" error on the comma. The "exactly one argument" error is therefore only reachable through `length()`.
- Trailing tokens after a complete expression are silently ignored, so `1 2` evaluates to 1.
- `null`, `not`, and unary minus have no prefix parser and are rejected at the start of an expression.

If any of those are bugs rather than intended behavior, the corresponding tests will fail once fixed and should be updated. Two code paths cannot be reached from the public API and are not covered: the default branches in the evaluator for unknown operators and unknown AST node types, and the unreachable throw after `expectPeekToken` in grouped expressions.
