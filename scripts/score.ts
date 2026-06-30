// Scores each suite in runs/ against the target code and consolidates results.
//
// For each runs/<name>/, expects runs/<name>/tests/*.test.ts. Builds a
// self-contained temp sandbox (target code + that suite + configs), runs Vitest
// (coverage + precondition) and Stryker (mutation), reads the JSON reports and
// extracts the metrics.
//
// Output: consolidated table (coverage, mutation score, # tests) + raw JSON.
//
// PRECONDITION: every test must pass against the correct code. Failing suites
// are flagged and receive no mutation score.
import { mkdtempSync, cpSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const runsDir = resolve(root, "runs");
const targetSrc = resolve(root, "target", "src");

interface Coverage {
  lines: number;
  branches: number;
  statements: number;
  functions: number;
}

interface Mutation {
  killed: number;
  survived: number;
  timeout: number;
  noCoverage: number;
  excluded: number;
  total: number;
  mutationScore: number;
}

interface RunResult {
  runName: string;
  precondition: boolean;
  numTests?: number;
  coverage?: Coverage | null;
  mutation?: Mutation | null;
}

// --- temp sandbox helpers ----------------------------------------------

const listRuns = (): string[] =>
  existsSync(runsDir)
    ? readdirSync(runsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    : [];

function hasTests(runName: string): boolean {
  const dir = join(runsDir, runName, "tests");
  return existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(".test.ts"));
}

function buildSandbox(runName: string): string {
  const dir = mkdtempSync(join(tmpdir(), `score-${runName}-`));
  // target code -> src/
  cpSync(targetSrc, join(dir, "src"), { recursive: true });
  // suite -> tests/
  cpSync(join(runsDir, runName, "tests"), join(dir, "tests"), { recursive: true });

  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      { name: `sandbox-${runName}`, private: true, type: "module", devDependencies: {} },
      null,
      2
    )
  );

  writeFileSync(
    join(dir, "vitest.config.ts"),
    `import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/number-validator.ts"],
      reporter: ["json-summary", "text"],
      reportsDirectory: "coverage",
    },
  },
});
`
  );

  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2020",
          module: "ESNext",
          moduleResolution: "node",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
        },
        include: ["src", "tests"],
      },
      null,
      2
    )
  );

  cpSync(resolve(root, "stryker.conf.template.mjs"), join(dir, "stryker.conf.mjs"));

  // Reuse the validator's node_modules via symlink to avoid reinstalling.
  const validatorModules = resolve(root, "node_modules");
  if (existsSync(validatorModules)) {
    try {
      symlinkSync(validatorModules, join(dir, "node_modules"), "dir");
    } catch {
      cpSync(validatorModules, join(dir, "node_modules"), { recursive: true });
    }
  }

  return dir;
}

// --- measurements ------------------------------------------------------

function precheck(sandbox: string): { pass: boolean; output?: string } {
  // Does the suite pass against the correct code?
  try {
    execSync("npx vitest run --coverage", { cwd: sandbox, stdio: "pipe" });
    return { pass: true };
  } catch (e) {
    const err = e as { stdout?: Buffer };
    return { pass: false, output: err.stdout?.toString() ?? String(e) };
  }
}

function readCoverage(sandbox: string): Coverage | null {
  const p = join(sandbox, "coverage", "coverage-summary.json");
  if (!existsSync(p)) return null;
  const data = JSON.parse(readFileSync(p, "utf8")) as Record<string, any>;
  const fileKey = Object.keys(data).find((k) => k.includes("number-validator.ts"));
  const entry = fileKey ? data[fileKey] : data.total;
  return {
    lines: entry.lines.pct,
    branches: entry.branches.pct,
    statements: entry.statements.pct,
    functions: entry.functions.pct,
  };
}

// Stryker's JSON reporter writes to reports/mutation/mutation.json. Search for
// it robustly in case the path changes between versions.
function findMutationReport(sandbox: string): string | null {
  const candidates = [
    join(sandbox, "reports", "mutation", "mutation.json"),
    join(sandbox, "stryker-report.json"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  const stack = [sandbox];
  while (stack.length) {
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === ".stryker-tmp") continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.name === "mutation.json") return full;
    }
  }
  return null;
}

function runMutation(sandbox: string): Mutation | null {
  try {
    execSync("npx stryker run stryker.conf.mjs", { cwd: sandbox, stdio: "pipe" });
  } catch {
    // Stryker may exit non-zero when below the score threshold; the report is
    // still written, so we keep going.
  }
  const p = findMutationReport(sandbox);
  if (!p) return null;
  const report = JSON.parse(readFileSync(p, "utf8")) as {
    files?: Record<string, { mutants?: Array<{ status: string }> }>;
  };
  let killed = 0, survived = 0, timeout = 0, noCov = 0, other = 0, total = 0;
  for (const file of Object.values(report.files ?? {})) {
    for (const m of file.mutants ?? []) {
      total++;
      if (m.status === "Killed") killed++;
      else if (m.status === "Survived") survived++;
      else if (m.status === "Timeout") timeout++;
      else if (m.status === "NoCoverage") noCov++;
      else other++; // CompileError, RuntimeError, Ignored, Pending
    }
  }
  // Stryker mutation score = detected / valid, where Timeout counts as detected
  // and invalid mutants (compile/runtime errors, ignored) are excluded.
  const detected = killed + timeout;
  const valid = killed + timeout + survived + noCov;
  return {
    killed,
    survived,
    timeout,
    noCoverage: noCov,
    excluded: other,
    total,
    mutationScore: valid > 0 ? (detected / valid) * 100 : 0,
  };
}

function countTests(runName: string): number {
  const runTests = join(runsDir, runName, "tests");
  let n = 0;
  for (const f of readdirSync(runTests)) {
    if (!f.endsWith(".test.ts")) continue;
    const src = readFileSync(join(runTests, f), "utf8");
    n += (src.match(/\b(it|test)\s*\(/g) ?? []).length;
  }
  return n;
}

// --- main --------------------------------------------------------------

const runs = listRuns().filter(hasTests);
if (runs.length === 0) {
  console.log("No runs with tests found in runs/. Add suites to runs/<name>/tests/.");
  process.exit(0);
}

const results: RunResult[] = [];
for (const runName of runs) {
  process.stdout.write(`\nScoring ${runName}... `);
  const sandbox = buildSandbox(runName);
  try {
    const pre = precheck(sandbox);
    if (!pre.pass) {
      console.log("PRECONDITION FAILED (tests do not pass against correct code)");
      results.push({ runName, precondition: false });
      continue;
    }
    const coverage = readCoverage(sandbox);
    const mutation = runMutation(sandbox);
    const numTests = countTests(runName);
    console.log("ok");
    results.push({ runName, precondition: true, numTests, coverage, mutation });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

writeFileSync(resolve(root, "results.json"), JSON.stringify(results, null, 2));

console.log("\n\n=== CONSOLIDATED ===\n");
console.log(["Run", "Tests", "Cov.Lines%", "Cov.Branch%", "Mut.Score%", "Killed/Valid"].join("\t"));
for (const r of results) {
  if (!r.precondition) {
    console.log(`${r.runName}\t(precondition failed)`);
    continue;
  }
  const cov = r.coverage;
  const mut = r.mutation;
  const valid = mut ? mut.killed + mut.timeout + mut.survived + mut.noCoverage : 0;
  console.log(
    [
      r.runName,
      r.numTests,
      cov ? cov.lines.toFixed(1) : "-",
      cov ? cov.branches.toFixed(1) : "-",
      mut ? mut.mutationScore.toFixed(1) : "-",
      mut ? `${mut.killed + mut.timeout}/${valid}` : "-",
    ].join("\t")
  );
}
console.log("\nRaw results in results.json");
console.log("Test smells: run `npm run smells -- runs/<name>/tests/` separately.");
