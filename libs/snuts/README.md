# SNUTS.js (vendored detectors)

This folder vendors the test-smell **detectors** of SNUTS.js by Jhonatan Mizu,
which we use to measure the test-smell dimension of the experiment.

- Upstream: https://github.com/Jhonatanmizu/SNUTS.js

Credit for the detectors goes to the SNUTS.js author. Only the detectors and the
AST helpers they need are vendored here — none of the Fastify server, routes,
CSV export, or repo-cloning.

## Contents

- `src/common/detectors/` — SNUTS's detector files, vendored verbatim except one
  bug fix. Each file is one smell detector (`detectAnonymousTest`,
  `detectSensitiveEquality`, …), listed in `index.js` as the `detectors` array.
  (SNUTS's `singlePassRunner.js`, a one-pass re-implementation of the same
  detectors, is not included — we run the named detectors directly.)
  - **Patch:** `transcriptingTest.js` did `args[1].body.body` unconditionally,
    which throws ("body is not iterable") on a concise arrow-body test such as
    `it("x", () => expect(...))`. Added a `t.isBlockStatement(args[1].body)`
    guard — the same check `generalFixture.js` and `commentsOnlyTest.js` already
    use.
- `src/services/ast.service.js` — SNUTS's AST helpers/predicates used by the
  detectors. Vendored verbatim.
- `index.js` / `index.d.ts` — thin wrapper (ours): parses a TypeScript suite with
  `@babel/parser` and runs every detector, returning `{ total, byType }`.

## Usage

```js
import { detectSmells } from "./libs/snuts/index.js";
const { total, byType } = detectSmells(sourceCodeOfATestFile);
```
