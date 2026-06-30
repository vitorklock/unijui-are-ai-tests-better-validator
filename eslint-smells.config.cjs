// Test-smell detection via eslint-plugin-vitest. Uses the vitest plugin (not
// jest) because the generated suites import from "vitest"; jest rules only fire
// on global or @jest/globals calls and would silently no-op here.
// Run: npx eslint --no-eslintrc -c eslint-smells.config.cjs --ext .ts <folder>
//
// Note: not every smell is statically detectable. This set covers the
// structural ones. Semantic smells (real Mystery Guest, contextual Magic
// Number) may need manual inspection - document that in the methodology.
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: 2020, sourceType: "module" },
  plugins: ["vitest"],
  env: { node: true },
  rules: {
    // Assertion Roulette / Eager Test: too many assertions per test.
    "vitest/max-expects": ["warn", { max: 5 }],
    // Assertions placed outside a test block.
    "vitest/no-standalone-expect": "warn",
    // Duplicate Assert and assertions hidden behind conditionals.
    "vitest/no-conditional-expect": "warn",
    // Malformed expectations (a weak form of Assertion Roulette).
    "vitest/valid-expect": "warn",
    // Identical title = possible Duplicate / copied test.
    "vitest/no-identical-title": "warn",
    // Empty or disabled tests.
    "vitest/no-disabled-tests": "warn",
    // A test with no assertion at all.
    "vitest/expect-expect": "warn",
  },
};
