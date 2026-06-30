// Scores each suite in runs/ against the target code and consolidates results.
//
// For each runs/<name>/, expects runs/<name>/tests/*.test.ts. Builds a
// self-contained temp sandbox (target code + that suite + configs), runs Vitest
// (coverage + precondition) and Stryker (mutation), lints for test smells, and
// extracts the paper's Table II metrics: coverage, mutation score (recall R),
// precision (P), F1, and smell density - plus the per-run gap vs the ceiling.
//
// PRECONDITION: every test must pass against the correct code. Failing suites
// are flagged and receive no metrics (a suite that fails on correct code would
// have false positives, i.e. precision < 1).
import { mkdtempSync, cpSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const runsDir = resolve(root, "runs");
const targetSrc = resolve(root, "target", "src");
const smellsConfig = resolve(root, "eslint-smells.config.cjs");
const CEILING = "ceiling";

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

interface Smells {
  total: number;
  density: number;
}

interface Gaps {
  coverageLines?: number;
  coverageBranches?: number;
  mutationScore?: number;
  f1?: number;
  smellDensity?: number;
}

interface RunResult {
  runName: string;
  precondition: boolean;
  numTests?: number;
  coverage?: Coverage | null;
  mutation?: Mutation | null;
  precision?: number;
  f1?: number;
  smells?: Smells;
  gaps?: Gaps;
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
          moduleResolution: "bundler",
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

function precheck(sandbox: string): { pass: boolean; output: string } {
  // Does the suite pass against the correct code?
  try {
    execSync("npx vitest run --coverage", { cwd: sandbox, stdio: "pipe" });
    return { pass: true, output: "" };
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    const out = `${err.stdout?.toString() ?? ""}\n${err.stderr?.toString() ?? ""}`.trim();
    return { pass: false, output: out || String(e) };
  }
}

function readCoverage(sandbox: string): Coverage | null {
  const p = join(sandbox, "coverage", "coverage-summary.json");
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, "utf8")) as Record<string, any>;
    const fileKey = Object.keys(data).find((k) => k.includes("number-validator.ts"));
    const entry = fileKey ? data[fileKey] : data.total;
    if (!entry) return null;
    return {
      lines: entry.lines.pct,
      branches: entry.branches.pct,
      statements: entry.statements.pct,
      functions: entry.functions.pct,
    };
  } catch {
    return null;
  }
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
  let report: { files?: Record<string, { mutants?: Array<{ status: string }> }> };
  try {
    report = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
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

// Total structural test-smell occurrences in a suite (eslint-plugin-vitest).
// Semantic smells (Mystery Guest, contextual Magic Number) are out of scope.
function countSmells(runName: string): number {
  const testsDir = join(runsDir, runName, "tests");
  let out = "";
  try {
    out = execSync(
      `npx eslint --no-eslintrc -c "${smellsConfig}" --ext .ts --format json "${testsDir}"`,
      { cwd: root, stdio: "pipe" }
    ).toString();
  } catch (e) {
    const err = e as { stdout?: Buffer };
    out = err.stdout?.toString() ?? "";
  }
  if (!out) return 0;
  try {
    const report = JSON.parse(out) as Array<{ messages?: unknown[] }>;
    return report.reduce((acc, f) => acc + (f.messages?.length ?? 0), 0);
  } catch {
    return 0;
  }
}

// Strip comments and string/template literals so commented-out or quoted
// "it("/"test(" do not inflate the count.
function stripNonCode(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, "``");
}

function countTests(runName: string): number {
  const runTests = join(runsDir, runName, "tests");
  let n = 0;
  let files: string[];
  try {
    files = readdirSync(runTests);
  } catch {
    return 0;
  }
  for (const f of files) {
    if (!f.endsWith(".test.ts")) continue;
    try {
      const src = stripNonCode(readFileSync(join(runTests, f), "utf8"));
      n += (src.match(/\b(it|test)\s*\(/g) ?? []).length;
    } catch {
      continue;
    }
  }
  return n;
}

// F1 from recall R and precision P (both as fractions), returned as a percent.
const f1Percent = (r: number, p: number): number =>
  p + r > 0 ? (2 * p * r) / (p + r) * 100 : 0;

function computeGaps(ceiling: RunResult, run: RunResult): Gaps {
  const gaps: Gaps = {};
  if (ceiling.coverage && run.coverage) {
    gaps.coverageLines = ceiling.coverage.lines - run.coverage.lines;
    gaps.coverageBranches = ceiling.coverage.branches - run.coverage.branches;
  }
  if (ceiling.mutation && run.mutation) {
    gaps.mutationScore = ceiling.mutation.mutationScore - run.mutation.mutationScore;
  }
  if (ceiling.f1 !== undefined && run.f1 !== undefined) {
    gaps.f1 = ceiling.f1 - run.f1;
  }
  if (ceiling.smells && run.smells) {
    gaps.smellDensity = ceiling.smells.density - run.smells.density;
  }
  return gaps;
}

const pct = (v: number | undefined): string => (v === undefined ? "-" : v.toFixed(1));
const signed = (v: number | undefined): string =>
  v === undefined ? "-" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;

// --- main --------------------------------------------------------------

const runs = listRuns().filter(hasTests);
if (runs.length === 0) {
  console.log("No runs with tests found in runs/. Add suites to runs/<name>/tests/.");
  process.exit(0);
}

const results: RunResult[] = [];
for (const runName of runs) {
  process.stdout.write(`\nScoring ${runName}... `);
  let sandbox: string;
  try {
    sandbox = buildSandbox(runName);
  } catch {
    console.log("FAILED to build sandbox");
    results.push({ runName, precondition: false });
    continue;
  }
  try {
    const pre = precheck(sandbox);
    if (!pre.pass) {
      console.log("PRECONDITION FAILED (tests do not pass against correct code)");
      console.log(pre.output.split("\n").slice(-12).join("\n"));
      results.push({ runName, precondition: false });
      continue;
    }
    const coverage = readCoverage(sandbox);
    const mutation = runMutation(sandbox);
    const numTests = countTests(runName);
    // Precondition holds => no false positives => precision = 1 by construction.
    const precision = 1;
    const recall = mutation ? mutation.mutationScore / 100 : undefined;
    const f1 = recall === undefined ? undefined : f1Percent(recall, precision);
    const smellTotal = countSmells(runName);
    const smells: Smells = { total: smellTotal, density: numTests > 0 ? smellTotal / numTests : 0 };
    console.log("ok");
    results.push({
      runName,
      precondition: true,
      numTests,
      coverage,
      mutation,
      precision: precision * 100,
      f1,
      smells,
    });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

// Per-metric gap vs the ceiling (paper Eq. 4: ceiling - run).
const ceiling = results.find((r) => r.runName === CEILING && r.precondition);
if (ceiling) {
  for (const r of results) {
    if (r.runName !== CEILING && r.precondition) r.gaps = computeGaps(ceiling, r);
  }
}

writeFileSync(resolve(root, "results.json"), JSON.stringify(results, null, 2));

console.log("\n\n=== CONSOLIDATED (paper Table II) ===\n");
console.log(["Run", "Tests", "Cov.L%", "Cov.B%", "R%", "P%", "F1%", "Smells/test"].join("\t"));
for (const r of results) {
  if (!r.precondition) {
    console.log(`${r.runName}\t(precondition failed)`);
    continue;
  }
  console.log(
    [
      r.runName,
      r.numTests,
      pct(r.coverage?.lines),
      pct(r.coverage?.branches),
      pct(r.mutation?.mutationScore),
      pct(r.precision),
      pct(r.f1),
      r.smells ? r.smells.density.toFixed(2) : "-",
    ].join("\t")
  );
}

if (ceiling) {
  console.log("\n=== GAP vs ceiling (ceiling - run; paper Eq. 4) ===\n");
  console.log(["Run", "dCov.L", "dCov.B", "dR", "dF1", "dSmells/test"].join("\t"));
  for (const r of results) {
    if (r.runName === CEILING || !r.gaps) continue;
    const g = r.gaps;
    console.log(
      [
        r.runName,
        signed(g.coverageLines),
        signed(g.coverageBranches),
        signed(g.mutationScore),
        signed(g.f1),
        g.smellDensity === undefined ? "-" : signed(g.smellDensity),
      ].join("\t")
    );
  }
} else {
  console.log(`\n(no '${CEILING}' run scored - add runs/${CEILING}/tests/ to get gaps)`);
}

console.log("\nRaw results in results.json");
console.log("Smell detail: run `npm run smells -- runs/<name>/tests/` for per-rule output.");
