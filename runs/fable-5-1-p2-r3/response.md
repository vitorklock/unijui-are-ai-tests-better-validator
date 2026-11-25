No shell tool is available in this session, so I finished by hand-tracing every assertion against the lexer and parser instead of running Vitest. The file is complete.

**Summary**

I wrote `tests/expression-parser.test.ts` with roughly 190 Vitest cases covering `parse`, `evaluate`, and `evaluateObject`. I could not run `pnpm test` because this session has no Bash tool. Please run it once to confirm. Every expected value, including the token positions in error messages, was traced manually through the lexer and parser source.

**What the suite covers**

- Parse: exact AST shapes via `toStrictEqual` against constructed node classes for literals, identifiers, every infix operator, precedence and left associativity, `is null` and `between` desugaring, function calls, and case expressions with and without `else`.
- Parse errors: exact messages including token type, literal, and position for empty input, unary minus, bare `not` and `null`, illegal characters in both first and operand position, every dangling binary operator via `it.each`, unbalanced parentheses, malformed `is`, `between`, call, and `case` syntax.
- Evaluate: arithmetic including division edge cases, a comparison table with values at, just above, and just below each boundary, logical operators returning operand values plus short-circuit checks with a throwing context, `between` at all four boundary points, `length` function behavior and errors, case expression branch selection and nesting, and context invocation using mocked functions.
- evaluateObject: property lookup, missing properties, null handling, case sensitivity, and a realistic SQL-like filter.

**Behaviors the tests pin down that you may not expect**

- `and` has lower precedence than `or`, so `true or false and false` evaluates to false.
- Calls with two or more arguments always throw, because the parser never consumes the comma. The `length` arity error is therefore only reachable with zero arguments.
- The parser silently ignores trailing tokens it cannot continue with, so `parse('1 2')` returns the literal 1 and `x1` parses as identifier `x`.
- `is null` uses strict equality, so an undefined property is reported as not null.
- `between` accepts only positive numeric literals as bounds.

**Not covered**

Two evaluator branches are unreachable through the public API: the unknown-operator default and the invalid-AST-node default. Line 144 in the parser is dead code since `expectPeekToken` either returns a token or throws.
