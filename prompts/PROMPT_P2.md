# Task

Write unit tests for the expression parser in `src/`.

Its public API is `evaluate(expression, context?)` and `evaluateObject(expression, value)` in `src/evaluator.ts`, plus `parse(expression)` in `src/parser.ts`.

Use Vitest. Put the tests in `tests/expression-parser.test.ts`.

You can run `pnpm test` to execute the tests.

## Quality criteria

The tests will be evaluated along three dimensions. Aim to maximize them:

1. **Code coverage** - exercise every line, branch, and condition of the code
   under test.
2. **Fault-detection power** - the tests must fail if the code's behavior
   changes. Assert exact return values and test boundary cases (values at the
   edge of the conditions, and just above/below the edge), so that small
   changes in the logic are detected.
3. **Maintainability** - avoid test smells. In particular: do not pile up many
   assertions without messages in a single test (Assertion Roulette); do not
   duplicate the same assertion; each test should cover a single behavior
   (avoid Eager Test); avoid unexplained magic numbers; and do not depend on
   external resources or shared state between tests.
