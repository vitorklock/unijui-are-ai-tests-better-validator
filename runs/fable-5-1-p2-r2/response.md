I wrote the suite to `tests/expression-parser.test.ts`. I could not execute it: this session exposes no shell tool, so `pnpm test` has not been run. Every expected value and error message was derived by tracing the lexer and parser by hand, including token positions embedded in error text. Please run `pnpm test` to confirm.

**What the suite covers**

- **parse()** builds exact ASTs with `toStrictEqual` for literals, every precedence relationship in the table, associativity, `is [not] null` and `between` desugaring, call parsing, and `case` with and without `else`.
- **Syntax errors** are asserted with exact messages, including the token type, literal, and position the parser embeds.
- **evaluate()** covers numbers, strings (both quote styles, empty, unterminated), arithmetic, boundary triplets for every comparison operator, strict equality, logical operators returning the deciding operand, short-circuiting, inclusive `between` bounds just inside and outside the range, `length()`, and `case` branch selection, truthiness, and laziness.
- **Lexer details** include whitespace kinds, case-insensitive keywords, case-sensitive identifiers, identifiers stopping at digits, and lenient handling of trailing tokens.
- **evaluateObject()** is tested with property lookup, missing properties, and a full SQL-like filter clause.

Tables use `it.each` so each row is a single-assertion test, and spy-based tests use a context that throws if consulted.

**Behaviours the tests pin down that look like bugs in the source**

- `and` binds looser than `or`, so `true or false and false` evaluates to false. SQL would give true.
- Multi-argument calls are unparseable. After a comma the parser does not advance, so `length("a", "b")` fails with "Unexpected start of expression" rather than the arity error.
- Trailing input is silently ignored, so `1 2`, `1 )`, and `1 @` all evaluate to 1.
- `(1)(2)` is treated as a call with an undefined name.

**Unreachable code not covered**

- The `default` branches in the evaluator for unknown operators and unknown AST node types, and the dead `if` after `expectPeekToken` in grouped-expression parsing. None can be reached through `parse`, `evaluate`, or `evaluateObject`.
