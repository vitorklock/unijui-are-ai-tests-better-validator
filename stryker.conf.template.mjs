// Stryker config template. score.mjs copies this into each temp run sandbox.
// Not meant to be run from the validator root.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: "npm",
  reporters: ["json", "clear-text"],
  testRunner: "vitest",
  coverageAnalysis: "perTest",
  // Only mutate the target; keep interfaces/utils out of the noise.
  mutate: ["src/number-validator.ts"],
  tsconfigFile: "tsconfig.json",
  vitest: {
    configFile: "vitest.config.ts",
  },
};
