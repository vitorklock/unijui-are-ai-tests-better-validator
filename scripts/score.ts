// Scores each suite in runs/ against the target code and consolidates results.
//
// For each runs/<name>/, expects runs/<name>/tests/*.test.ts. Builds a
// self-contained temp sandbox (target code + that suite + configs), runs Vitest
// (coverage + per-test pass/fail on the CORRECT code) and Stryker (mutation),
// lints for test smells, and extracts the paper's Table II metrics: coverage,
// mutation score (recall R), precision (P), F1, and smell density - plus the
// per-run gap vs the ceiling.
//
// NO PRECONDITION GATE: suites are scored as generated. Tests that fail on the
// correct code count as false positives and lower precision (P = passing /
// total tests). Those failing tests are invalid detectors, so they are skipped
// ONLY for the mutation run (otherwise Stryker aborts on a red baseline and a
// mutant would be "killed" for a spurious reason, inflating recall).
import { mkdtempSync, cpSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join, basename } from "node:path";
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
  precision?: number;
  f1?: number;
  smellDensity?: number;
}

interface RunResult {
  runName: string;
  scored: boolean;
  numTests?: number;
  falsePositives?: number;
  coverage?: Coverage | null;
  mutation?: Mutation | null;
  precision?: number;
  f1?: number;
  smells?: Smells;
  gaps?: Gaps;
}

interface TestRun {
  ran: boolean;
  total: number;
  failed: number;
  failingByFile: Record<string, string[]>;
  output: string;
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

// Runs the suite against the CORRECT code and records coverage plus per-test
// pass/fail. Failures here are false positives (the suite flags a defect where
// there is none). Does NOT gate: a failing suite is still scored.
function runTests(sandbox: string): TestRun {
  const outFile = join(sandbox, "test-results.json");
  let output = "";
  try {
    execSync(
      `npx --no-install vitest run --coverage --reporter=json --outputFile="${outFile}"`,
      { cwd: sandbox, stdio: "pipe" }
    );
  } catch (e) {
    // Non-zero exit is expected when tests fail; the JSON report is still
    // written, so we read it below.
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    output = `${err.stdout?.toString() ?? ""}\n${err.stderr?.toString() ?? ""}`.trim();
  }
  if (!existsSync(outFile)) {
    return { ran: false, total: 0, failed: 0, failingByFile: {}, output };
  }
  try {
    const data = JSON.parse(readFileSync(outFile, "utf8")) as {
      testResults?: Array<{ name: string; assertionResults?: Array<{ title: string; status: string }> }>;
    };
    const failingByFile: Record<string, string[]> = {};
    let total = 0, failed = 0;
    for (const file of data.testResults ?? []) {
      for (const a of file.assertionResults ?? []) {
        if (a.status === "passed") {
          total++;
        } else if (a.status === "failed") {
          total++;
          failed++;
          (failingByFile[file.name] ??= []).push(a.title);
        }
        // skipped / todo / pending are ignored
      }
    }
    return { ran: true, total, failed, failingByFile, output };
  } catch {
    return { ran: false, total: 0, failed: 0, failingByFile: {}, output };
  }
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Converts `it("<title>"` / `test("<title>"` to `.skip` for every test that
// failed on the correct code, so Stryker gets a green baseline and recall is
// measured only over valid detectors. Returns how many were skipped vs not
// matched (dynamic/templated titles may not match).
function skipFailingTests(sandbox: string, failingByFile: Record<string, string[]>): { skipped: number; unmatched: number } {
  let skipped = 0, unmatched = 0;
  const testsDir = join(sandbox, "tests");
  const byBase: Record<string, string[]> = {};
  for (const [file, titles] of Object.entries(failingByFile)) {
    (byBase[basename(file)] ??= []).push(...titles);
  }
  for (const f of readdirSync(testsDir)) {
    if (!f.endsWith(".test.ts")) continue;
    const titles = byBase[f];
    if (!titles?.length) continue;
    const p = join(testsDir, f);
    let src = readFileSync(p, "utf8");
    for (const title of titles) {
      const re = new RegExp(`\\b(it|test)(\\s*\\(\\s*(['"\`])${escapeRegExp(title)}\\3)`, "g");
      const before = src;
      src = src.replace(re, "$1.skip$2");
      if (src === before) unmatched++;
      else skipped++;
    }
    writeFileSync(p, src);
  }
  return { skipped, unmatched };
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
    execSync("npx --no-install stryker run stryker.conf.mjs", { cwd: sandbox, stdio: "pipe" });
  } catch {
    // Stryker may exit non-zero when below the score threshold (report still
    // written) or abort entirely if the baseline is red (no report). Either way
    // we try to read a report below and return null if there is none.
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
  // and invalid mutants (compile/runtime errors, ignored) are excluded. Stryker
  // cannot identify EQUIVALENT mutants, so they remain in `survived`; the score
  // is therefore a lower bound on the paper's R (Eq. 2 subtracts M_equiv).
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
// Lints the original run folder, not the skip-rewritten sandbox copy.
function countSmells(runName: string): number {
  const testsDir = join(runsDir, runName, "tests");
  let out = "";
  try {
    out = execSync(
      `npx --no-install eslint --no-eslintrc -c "${smellsConfig}" --ext .ts --format json "${testsDir}"`,
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
  if (ceiling.precision !== undefined && run.precision !== undefined) {
    gaps.precision = ceiling.precision - run.precision;
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
    results.push({ runName, scored: false });
    continue;
  }
  try {
    const testRun = runTests(sandbox);
    if (!testRun.ran) {
      console.log("CANNOT RUN (suite errored before producing results)");
      console.log(testRun.output.split("\n").slice(-12).join("\n"));
      results.push({ runName, scored: false });
      continue;
    }
    const coverage = readCoverage(sandbox);
    const numTests = testRun.total;
    const falsePositives = testRun.failed;
    // Precision: a "positive" is a test case (a behavioral claim); a false
    // positive is a test that fails on correct code. P = passing / total.
    const precisionFrac = numTests > 0 ? (numTests - falsePositives) / numTests : undefined;
    // Skip false-positive tests so the mutation baseline is green and recall is
    // measured only over valid detectors.
    const skip = falsePositives > 0 ? skipFailingTests(sandbox, testRun.failingByFile) : { skipped: 0, unmatched: 0 };
    const mutation = runMutation(sandbox);
    const recall = mutation ? mutation.mutationScore / 100 : undefined;
    const f1 =
      precisionFrac !== undefined && recall !== undefined ? f1Percent(recall, precisionFrac) : undefined;
    const smellTotal = countSmells(runName);
    const smells: Smells = { total: smellTotal, density: numTests > 0 ? smellTotal / numTests : 0 };
    if (falsePositives > 0) {
      const note = skip.unmatched > 0 ? `, ${skip.unmatched} unmatched -> mutation may be blocked` : "";
      console.log(`ok (${falsePositives} false positive(s), ${skip.skipped} skipped for mutation${note})`);
    } else {
      console.log("ok");
    }
    results.push({
      runName,
      scored: true,
      numTests,
      falsePositives,
      coverage,
      mutation,
      precision: precisionFrac === undefined ? undefined : precisionFrac * 100,
      f1,
      smells,
    });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

// Per-metric gap vs the ceiling (paper Eq. 4: ceiling - run).
const ceiling = results.find((r) => r.runName === CEILING && r.scored);
if (ceiling) {
  for (const r of results) {
    if (r.runName !== CEILING && r.scored) r.gaps = computeGaps(ceiling, r);
  }
}

writeFileSync(resolve(root, "results.json"), JSON.stringify(results, null, 2));

console.log("\n\n=== CONSOLIDATED (paper Table II) ===\n");
console.log(["Run", "Tests", "FP", "Cov.L%", "Cov.B%", "R%", "P%", "F1%", "Smells/test"].join("\t"));
for (const r of results) {
  if (!r.scored) {
    console.log(`${r.runName}\t(could not run)`);
    continue;
  }
  console.log(
    [
      r.runName,
      r.numTests,
      r.falsePositives,
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
  console.log(["Run", "dCov.L", "dCov.B", "dR", "dP", "dF1", "dSmells/test"].join("\t"));
  for (const r of results) {
    if (r.runName === CEILING || !r.gaps) continue;
    const g = r.gaps;
    console.log(
      [
        r.runName,
        signed(g.coverageLines),
        signed(g.coverageBranches),
        signed(g.mutationScore),
        signed(g.precision),
        signed(g.f1),
        g.smellDensity === undefined ? "-" : signed(g.smellDensity),
      ].join("\t")
    );
  }
} else {
  console.log(`\n(no '${CEILING}' run scored - add runs/${CEILING}/tests/ to get gaps)`);
}

console.log("\nRaw results in results.json");
console.log("Smell detail: run `pnpm smells runs/<name>/tests/` for per-rule output.");
