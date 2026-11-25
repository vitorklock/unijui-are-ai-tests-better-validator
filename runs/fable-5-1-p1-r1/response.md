The test file is written at `tests/expression-parser.test.ts`. I could not run `pnpm test`: this session has no shell tool available (Bash is not in the tool list and is not discoverable through ToolSearch), so the suite is unverified by execution. I traced every assertion by hand against the lexer, parser and evaluator source, and all expectations match the code as written.

**What the suite covers** (roughly 120 assertions across three top-level `describe` blocks):

- **`parse` AST shape.** Literals (integers, decimals, leading-dot decimals, single and double quoted strings, booleans), identifiers with underscores, operator precedence (`*` over `+`, arithmetic over comparison, comparison over `and`), left associativity, parentheses, all six comparison operators, case-insensitive keywords.
- **`parse` desugaring.** `between` into an inclusive `>=` and `<=` pair, `is null` and `is not null` into `=`/`<>` against `null`, function calls with zero or one argument, nested call arguments, `case ... when ... then ... else ... end` with and without `else`.
- **`parse` errors.** Empty input, operator at start, dangling operator, unclosed parenthesis, illegal characters, `between` with non-numeric bounds, `is` without `null`, malformed `case`.
- **`evaluate` semantics.** Arithmetic, string concatenation, strict equality without coercion, logical operators including short-circuiting via a mocked context, `between` boundaries, null checks, the `length()` function on strings and arrays, `case` first-match semantics, context lookup, and a set of realistic SQL-like WHERE clauses run through `evaluateObject`.

**Quirks I found while tracing the code.** The tests document the first one and avoid the others, so none of them should fail, but you may want to decide whether they are bugs:

1. **`or` binds tighter than `and`.** The precedence table in `src/parser.ts:8-9` ranks `or` above `and`, so `true or false and false` evaluates to `false`. SQL gives `and` higher precedence and would yield `true`. One test asserts the current behavior with a comment explaining it.
2. **Multi-argument function calls cannot parse.** In `parseCallExpression` at `src/parser.ts:182`, after consuming a comma the loop calls `parseExpression` with the comma as the current token and throws. Only the single-function `length` exists, so nothing hits this today. I did not add a test since it would enshrine the failure.
3. **`is null` does not match `undefined`.** The evaluator uses `===`, so a missing property on the object passed to `evaluateObject` is not "null". Tests only use explicit `null` values.
4. **Trailing garbage is silently ignored.** `evaluate('1 2')` returns `1` because the parser stops at a token with no infix handler and never checks for end of input. Not tested.

Next step is to run the suite yourself:

```
pnpm test
```

If anything fails, the most likely culprits are the error-message regexes, which depend on the exact wording in the parser's `throw` statements.
