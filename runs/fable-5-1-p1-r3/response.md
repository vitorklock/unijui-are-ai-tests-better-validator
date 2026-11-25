The suite is written at `tests/expression-parser.test.ts`, but I could not run it. This session has no shell tool, and `node_modules` is not installed, so `pnpm test` was never executed. Every assertion was checked by hand against the lexer, parser, and evaluator source. Please run the following and send me any failures:

```
pnpm install && pnpm test
```

**What the tests cover**

- **parse** returns the expected AST for literals, identifiers, each comparison operator, precedence and left-associativity, parentheses, `is null` and `is not null` rewrites, `between` rewrite to an inclusive range, function calls, and `case` expressions.
- **parse errors** for empty input, dangling or doubled operators, unclosed parentheses, illegal characters, bad `between` bounds, `is` without `null`, and malformed `case` blocks.
- **evaluate** covers arithmetic, string concatenation, strict equality across types, ordering, `and` and `or` including short-circuiting, `is null`, `between` bounds, the `length` function, `case` branching and nesting, case-insensitive keywords, and context resolution using mocked context functions.
- **evaluateObject** runs SQL-like where clauses against a sample object, including null properties, arrays with `length`, missing properties, and a no-mutation check.

**Behaviors I found while tracing but deliberately did not assert**, because they look like bugs rather than intent:

- `and` has lower precedence than `or`, the reverse of SQL. The expression `true or false and false` evaluates to false here but to true in SQL. The suite only tests mixed `and`/`or` with explicit parentheses.
- Unary minus and the `not` keyword have no prefix parser, so `-1` and `not true` throw. Only `is not null` works.
- Multi-argument calls such as `f(1, 2)` throw after the comma, because the comma token is never consumed. Only single-argument calls are tested.
- Trailing tokens are silently ignored. `evaluate('1 2')` returns 1 instead of throwing.
- `x is null` uses strict equality against `null`, so a missing property via `evaluateObject` gives false rather than true.
- Identifiers cannot contain digits. `field1` lexes as the identifier `field` followed by the number `1`.

If you want any of those locked in as regression tests, or turned into failing tests that document the bugs, say which and I'll add them.
