The test file is written at `tests/expression-parser.test.ts`. I could not execute it: this session has no shell tool, so `pnpm test` was never run. Every expected value was hand-traced through the lexer, parser, and evaluator, but please run the suite once to confirm.

**What the suite covers** (roughly 150 assertions across 3 top-level `describe` blocks):

- **parse()**: AST shape for literals, identifiers, every binary operator's token type, precedence (`*` over `+`, arithmetic over comparison, comparison over `and`/`or`), left associativity, grouping, `between` desugaring to `>=`/`<=`, `is [not] null` desugaring, function calls with zero, one, or compound arguments, and `case` with and without `else`.
- **evaluate()**: numbers including leading-dot decimals, both quote styles, arithmetic and precedence tables, strict equality without coercion, string comparison, logical operators including short-circuiting (verified with a context that throws if consulted), JS truthiness passthrough, inclusive `between` bounds, `is null`, `case` branching including nested and lazy evaluation, `length()` on strings and arrays, context callback receiving exact identifier names, whitespace and keyword case-insensitivity, and a block of syntax-error cases matched against the parser's messages.
- **evaluateObject()**: property lookup, missing properties yielding undefined, and realistic WHERE-clause style filters against record objects.

**Quirks I found while tracing, left out of the tests so they don't get cemented:**

- `and` has lower precedence than `or`, the reverse of SQL. So `a or b and c` parses as `(a or b) and c`.
- Unary minus, a `not` prefix, and a bare `null` literal are not parseable. `-5` throws, while `0 - 5` works.
- Trailing tokens are silently dropped: `1 + 2)` and `1 ! 2` both evaluate to a result instead of throwing.
- Multi-argument calls fail to parse. After a comma the parser tries to parse the comma itself as an expression, so `f(a, b)` throws before the arity check in `length` is ever reached.
- Identifiers cannot contain digits. `a1` lexes as identifier `a` followed by a stray number that is then ignored.
- `is null` uses strict equality, so a missing property (undefined) is reported as not null.

Next step is to run `pnpm test`. If anything fails, the failure will almost certainly be one of my traced expectations rather than a flaky test, and the message will point straight at the line.
