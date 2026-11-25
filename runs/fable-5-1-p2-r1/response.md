The test file is complete. I could not run `pnpm test` because this session has no shell tool, so the expected values are hand-traced through the lexer and parser rather than verified by execution. Please run `pnpm test` once to confirm.

**What I wrote** in `tests/expression-parser.test.ts` (about 130 tests, one assertion each):

- **Literals and lexing**: integers, decimals, leading-dot numbers, both quote styles, empty and unterminated strings, booleans, whitespace variants, case-insensitive keywords, identifiers that start with keywords or end at a digit, and trailing-token behavior.
- **Operators**: every arithmetic, comparison, and logical operator with exact results. Precedence and left-associativity are pinned with discriminating inputs. Comparison boundaries use a `describe.each` table at, just above, and just below a named threshold.
- **is null, between, length, case**: boundary tables for `between` and multi-branch `case`, short-circuit checks via mock contexts, nesting, and desugaring verified through `parse` AST shapes with `toStrictEqual`.
- **Error paths**: every `throw` reachable from the public API, most asserted against the full message including the token position so the lexer's position math is covered too.
- **Unreachable evaluator branches**: the two `default` throws in the evaluator cannot be hit through the parser, so `parse` is wrapped with `vi.mock` plus `importOriginal` and fed hand-built AST nodes in two isolated tests. All other tests still run the real parser.

**Behaviors the tests pin that you may want to know about**, since they look like bugs in the code under test:

- `or` binds tighter than `and`, so `true or false and false` evaluates to false.
- Tokens after a complete expression are silently ignored, so `1 2` and `1 != 2` both return 1.
- There is no unary minus, no unary `not`, and `null` is only valid after `is`.
- Dead code remains uncovered: the second `)` check in grouped expressions and the EOF guard in the parse loop can never trigger.

If you fix any of the quirks above, the corresponding test will fail by design and should be updated alongside the fix.
