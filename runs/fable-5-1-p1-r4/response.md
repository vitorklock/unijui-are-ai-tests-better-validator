I wrote the test suite to `tests/expression-parser.test.ts`. I could not run it: this session has no shell tool, and `node_modules` is not installed in the project. Every assertion was derived by tracing the lexer, parser, and evaluator by hand, so please run `pnpm install && pnpm test` to confirm.

**What the suite covers** (about 110 test cases across 100 or so `it` blocks):

- **`parse`**: literal shapes for numbers, strings, booleans, and identifiers. Every binary operator maps to the right AST node. Precedence and left-associativity, grouping, `is null` and `between` desugaring, function calls, and single, multi-branch, and nested `case` expressions. Error paths for empty input, missing operands, unbalanced parentheses, illegal characters, and malformed `case`, `between`, and `is` clauses.
- **`evaluate`**: arithmetic, string concatenation, strict comparison across types, logical operators with short-circuit checks using `vi.fn()`, identifier resolution through the context callback, `is null` versus undefined, inclusive `between` bounds, the `length` function and its error messages, and `case` evaluation including laziness of untaken branches.
- **`evaluateObject`**: property lookup, SQL-like filter clauses, missing properties, arrays as the object, and `case` over object fields.

**Behaviors I pinned down in a separate "current behaviour worth knowing about" block.** These look like bugs or gaps rather than design choices. The tests assert the current behavior so changes are noticed, with comments saying so:

- `or` binds tighter than `and`, the opposite of SQL. `false and true or true` evaluates to `false`.
- Function calls with more than one argument fail to parse. After a comma the parser never advances past it, so `f(1, 2)` throws "Unexpected start of expression" at `src/parser.ts:182`.
- Trailing tokens after a complete expression are silently ignored. `1 2` evaluates to 1 and `1 + 2)` evaluates to 3.
- Identifiers cannot contain digits. `foo1` lexes as `foo` followed by a discarded `1`.
- There is no unary minus or `not` prefix, so `-1` and `not true` throw.
- An unterminated string literal is accepted.

If you'd rather fix those than lock them in, delete or invert that last `describe` block once the parser changes.
