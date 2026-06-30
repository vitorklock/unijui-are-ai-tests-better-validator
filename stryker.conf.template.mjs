// Stryker config template. score.ts copies this into each temp run sandbox.
// Not meant to be run from the validator root.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: "pnpm",
  reporters: ["json", "clear-text"],
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  coverageAnalysis: "perTest",
  mutate: ["src/number-validator.ts"],
  tsconfigFile: "tsconfig.json",
  vitest: {
    configFile: "vitest.config.ts",
  },
};
