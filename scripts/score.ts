// Scores each suite in runs/<name>/tests/ against the target: coverage + per-test
// pass/fail (Vitest), mutation score (Stryker), test smells (ESLint), then the
// paper's Table II metrics and the per-run gap vs the ceiling.
//
// No precondition gate: tests that fail on the correct code count as false
// positives (lowering P) and are skipped only for the mutation run, so Stryker
// keeps a green baseline.
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir, cpus } from "node:os";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const runsDir = resolve(root, "runs");
const targetSrc = resolve(root, "target", "src");
const smellsConfig = resolve(root, "eslint-smells.config.cjs");
const resultsDir = resolve(root, "results");
const resultsFile = resolve(resultsDir, "results.json");
const CEILING = "ceiling";

const execAsync = promisify(exec);

// Async shell command; never throws (vitest/stryker/eslint exit non-zero in
// normal cases). Returns ok=false with whatever output was captured.
async function sh(cmd: string, cwd: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    try {
        const { stdout, stderr } = await execAsync(cmd, { cwd, maxBuffer: 64 * 1024 * 1024 });
        return { ok: true, stdout: stdout.toString(), stderr: stderr.toString() };
    } catch (e) {
        const err = e as { stdout?: string | Buffer; stderr?: string | Buffer };
        return { ok: false, stdout: (err.stdout ?? "").toString(), stderr: (err.stderr ?? "").toString() };
    }
}

// Bounded-concurrency map: runs `fn` over items with at most `limit` in flight.
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const out = new Array<R>(items.length);
    let next = 0;
    const worker = async (): Promise<void> => {
        for (let i = next++; i < items.length; i = next++) {
            out[i] = await fn(items[i], i);
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
    return out;
}

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
    cpSync(targetSrc, join(dir, "src"), { recursive: true });
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
  // Sandbox-local cache so parallel runs don't race on the shared node_modules/.vite.
  cacheDir: "vite-cache",
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

    // Symlink the validator's node_modules to avoid reinstalling per sandbox.
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

// Runs the suite against the correct code: coverage + per-test pass/fail.
// Failures here are false positives. Does not gate; a failing suite is scored.
async function runTests(sandbox: string): Promise<TestRun> {
    const outFile = join(sandbox, "test-results.json");
    const r = await sh(
        `npx --no-install vitest run --coverage --reporter=json --outputFile="${outFile}"`,
        sandbox
    );
    const output = r.ok ? "" : `${r.stdout}\n${r.stderr}`.trim();
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
            }
        }
        return { ran: true, total, failed, failingByFile, output };
    } catch {
        return { ran: false, total: 0, failed: 0, failingByFile: {}, output };
    }
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Rewrites `it("<title>"`/`test("<title>"` to `.skip` for tests that fail on the
// correct code, so Stryker gets a green baseline and recall counts only valid
// detectors. Returns skipped vs unmatched (dynamic titles may not match).
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

// Stryker's JSON reporter writes reports/mutation/mutation.json; search robustly.
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

async function runMutation(sandbox: string): Promise<Mutation | null> {
    // Stryker exits non-zero below threshold (report still written) or aborts on
    // a red baseline (no report); we just try to read a report afterwards.
    await sh("npx --no-install stryker run stryker.conf.mjs", sandbox);
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
    // Score = detected / valid (Timeout counts as detected; invalid mutants
    // excluded). Stryker can't flag EQUIVALENT mutants, so they stay in `survived`
    // and the score is a lower bound on the paper's R (Eq. 2 subtracts M_equiv).
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

// Structural test-smell count via eslint-plugin-vitest (semantic smells like
// Mystery Guest are out of scope). Lints the original run folder, not the
// skip-rewritten sandbox copy.
async function countSmells(runName: string): Promise<number> {
    const testsDir = join(runsDir, runName, "tests");
    const r = await sh(
        `npx --no-install eslint --no-eslintrc -c "${smellsConfig}" --ext .ts --format json "${testsDir}"`,
        root
    );
    const out = r.stdout; // ESLint prints JSON to stdout even when it exits non-zero
    if (!out) return 0;
    try {
        const report = JSON.parse(out) as Array<{ messages?: unknown[] }>;
        return report.reduce((acc, f) => acc + (f.messages?.length ?? 0), 0);
    } catch {
        return 0;
    }
}

// F1 from recall R and precision P (fractions), returned as a percent.
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

// Fixed-width table: columns padded to their widest cell, dashed rule under the
// header. `rightAlign[i]` right-justifies a column.
function renderTable(headers: string[], rows: string[][], rightAlign: boolean[]): string {
    const widths = headers.map((h, i) =>
        Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length))
    );
    const line = (cells: string[]): string =>
        cells
            .map((c, i) => (rightAlign[i] ? (c ?? "").padStart(widths[i]) : (c ?? "").padEnd(widths[i])))
            .join("  ")
            .replace(/\s+$/, "");
    const rule = widths.map((w) => "-".repeat(w)).join("  ");
    return [line(headers), rule, ...rows.map(line)].join("\n");
}

// Scores one run end to end and returns its result plus a one-line status.
// Never throws; cleans up its sandbox. Self-contained so runs can run concurrently.
async function scoreRun(runName: string): Promise<{ result: RunResult; line: string }> {
    let sandbox: string;
    try {
        sandbox = buildSandbox(runName);
    } catch {
        return { result: { runName, scored: false }, line: "FAILED to build sandbox" };
    }
    try {
        const testRun = await runTests(sandbox);
        if (!testRun.ran) {
            const tail = testRun.output.split("\n").filter(Boolean).slice(-4).join(" | ");
            return { result: { runName, scored: false }, line: `CANNOT RUN${tail ? " - " + tail : ""}` };
        }
        const coverage = readCoverage(sandbox);
        const numTests = testRun.total;
        const falsePositives = testRun.failed;
        // A "positive" is a test case; a false positive fails on correct code.
        const precisionFrac = numTests > 0 ? (numTests - falsePositives) / numTests : undefined;
        const skip = falsePositives > 0 ? skipFailingTests(sandbox, testRun.failingByFile) : { skipped: 0, unmatched: 0 };
        const mutation = await runMutation(sandbox);
        const recall = mutation ? mutation.mutationScore / 100 : undefined;
        const f1 =
            precisionFrac !== undefined && recall !== undefined ? f1Percent(recall, precisionFrac) : undefined;
        const smellTotal = await countSmells(runName);
        const smells: Smells = { total: smellTotal, density: numTests > 0 ? smellTotal / numTests : 0 };
        let line = "ok";
        if (falsePositives > 0) {
            const note = skip.unmatched > 0 ? `, ${skip.unmatched} unmatched -> mutation may be blocked` : "";
            line = `ok (${falsePositives} false positive(s), ${skip.skipped} skipped for mutation${note})`;
        }
        return {
            result: {
                runName,
                scored: true,
                numTests,
                falsePositives,
                coverage,
                mutation,
                precision: precisionFrac === undefined ? undefined : precisionFrac * 100,
                f1,
                smells,
            },
            line,
        };
    } catch (e) {
        return { result: { runName, scored: false }, line: `error: ${(e as Error).message}` };
    } finally {
        rmSync(sandbox, { recursive: true, force: true });
    }
}

// CLI: <run-name> | --only <run-name> scores one run; --jobs N | -j N caps
// how many runs are scored in parallel (default ~cores-1).
let onlyRun: string | undefined;
let jobsArg: string | undefined;
let badUsage = false;
const cliArgs = process.argv.slice(2);
for (let i = 0; i < cliArgs.length; i++) {
    const a = cliArgs[i];
    if (a === "--only" || a === "-o") {
        onlyRun = cliArgs[++i];
        if (!onlyRun) badUsage = true;
    } else if (a.startsWith("--only=")) {
        onlyRun = a.slice("--only=".length);
        if (!onlyRun) badUsage = true;
    } else if (a === "--jobs" || a === "-j") {
        jobsArg = cliArgs[++i];
        if (!jobsArg) badUsage = true;
    } else if (a.startsWith("--jobs=")) {
        jobsArg = a.slice("--jobs=".length);
        if (!jobsArg) badUsage = true;
    } else if (!a.startsWith("-")) {
        onlyRun = a;
    }
}
if (badUsage) {
    console.error("Usage: score [<run-name>] [--only <run-name>] [--jobs <N>]");
    process.exit(1);
}

const allRuns = listRuns().filter(hasTests);
if (allRuns.length === 0) {
    console.log("No runs with tests found in runs/. Add suites to runs/<name>/tests/.");
    process.exit(0);
}

if (onlyRun && !allRuns.includes(onlyRun)) {
    console.error(`Run "${onlyRun}" has no tests at runs/${onlyRun}/tests/*.test.ts.`);
    console.error(`Available runs: ${allRuns.join(", ")}`);
    process.exit(1);
}

const runs = onlyRun ? [onlyRun] : allRuns;

// Default ~one run per core, capped (Stryker spawns its own workers too).
const cpuCount = Math.max(1, cpus().length);
const parsedJobs = jobsArg ? parseInt(jobsArg, 10) : NaN;
const jobs = Number.isFinite(parsedJobs) && parsedJobs > 0
    ? Math.min(parsedJobs, runs.length)
    : Math.min(runs.length, Math.max(1, cpuCount - 1), 8);

console.log(`Scoring ${runs.length} run(s)${runs.length > 1 ? `, up to ${jobs} in parallel` : ""}...\n`);

let done = 0;
const results = await mapPool(runs, jobs, async (runName) => {
    const { result, line } = await scoreRun(runName);
    done += 1;
    console.log(`  [${done}/${runs.length}] ${runName}: ${line}`);
    return result;
});

// In --only mode, merge into the previous results.json so the table and gaps
// stay complete (other rows from the last run; ceiling reused for the gap).
function loadPreviousRuns(): RunResult[] {
    if (!existsSync(resultsFile)) return [];
    try {
        const data = JSON.parse(readFileSync(resultsFile, "utf8")) as { runs?: RunResult[] };
        return Array.isArray(data.runs) ? data.runs : [];
    } catch {
        return [];
    }
}

const scoredNames = new Set(results.map((r) => r.runName));
const final: RunResult[] = onlyRun
    ? [...loadPreviousRuns().filter((r) => !scoredNames.has(r.runName)), ...results]
    : results;

// Ceiling first, then alphabetical.
final.sort((a, b) =>
    a.runName === CEILING ? -1 : b.runName === CEILING ? 1 : a.runName.localeCompare(b.runName)
);

const ceiling = final.find((r) => r.runName === CEILING && r.scored);
for (const r of final) {
    if (r.runName !== CEILING && r.scored && ceiling) r.gaps = computeGaps(ceiling, r);
    else delete r.gaps;
}

// Flat, table-shaped views mirroring the printed tables, plus the raw detail.
const consolidated = final.map((r) =>
    r.scored
        ? {
            run: r.runName,
            scored: true,
            tests: r.numTests ?? null,
            falsePositives: r.falsePositives ?? null,
            coverageLines: r.coverage?.lines ?? null,
            coverageBranches: r.coverage?.branches ?? null,
            coverageStatements: r.coverage?.statements ?? null,
            coverageFunctions: r.coverage?.functions ?? null,
            mutationScore: r.mutation?.mutationScore ?? null,
            precision: r.precision ?? null,
            f1: r.f1 ?? null,
            smellDensity: r.smells?.density ?? null,
            smellTotal: r.smells?.total ?? null,
        }
        : { run: r.runName, scored: false }
);

const gapsOut = final
    .filter((r) => r.runName !== CEILING && r.gaps)
    .map((r) => ({
        run: r.runName,
        dCoverageLines: r.gaps?.coverageLines ?? null,
        dCoverageBranches: r.gaps?.coverageBranches ?? null,
        dMutationScore: r.gaps?.mutationScore ?? null,
        dPrecision: r.gaps?.precision ?? null,
        dF1: r.gaps?.f1 ?? null,
        dSmellDensity: r.gaps?.smellDensity ?? null,
    }));

mkdirSync(resultsDir, { recursive: true });
writeFileSync(
    resultsFile,
    JSON.stringify({ ceiling: ceiling?.runName ?? null, consolidated, gaps: gapsOut, runs: final }, null, 2)
);

const NA = "-";

// With --only, show just the scored run; results.json still keeps every run.
const displayed = onlyRun ? final.filter((r) => r.runName === onlyRun) : final;

if (onlyRun) {
    console.log(`\n(showing only "${onlyRun}")`);
}

console.log("\n=== CONSOLIDATED (paper Table II) ===\n");
console.log(
    renderTable(
        ["Run", "Tests", "FP", "Cov.L%", "Cov.B%", "R%", "P%", "F1%", "Smells/test"],
        displayed.map((r) =>
            r.scored
                ? [
                    r.runName,
                    String(r.numTests ?? NA),
                    String(r.falsePositives ?? NA),
                    pct(r.coverage?.lines),
                    pct(r.coverage?.branches),
                    pct(r.mutation?.mutationScore),
                    pct(r.precision),
                    pct(r.f1),
                    r.smells ? r.smells.density.toFixed(2) : NA,
                ]
                : [r.runName, NA, NA, NA, NA, NA, NA, NA, NA]
        ),
        [false, true, true, true, true, true, true, true, true]
    )
);

const gapRows = displayed.filter((r) => r.runName !== CEILING && r.gaps);
if (gapRows.length > 0) {
    console.log("\n=== GAP vs ceiling (ceiling - run; paper Eq. 4) ===\n");
    console.log(
        renderTable(
            ["Run", "dCov.L", "dCov.B", "dR", "dP", "dF1", "dSmells/test"],
            gapRows.map((r) => {
                const g = r.gaps as Gaps;
                return [
                    r.runName,
                    signed(g.coverageLines),
                    signed(g.coverageBranches),
                    signed(g.mutationScore),
                    signed(g.precision),
                    signed(g.f1),
                    g.smellDensity === undefined ? NA : signed(g.smellDensity),
                ];
            }),
            [false, true, true, true, true, true, true]
        )
    );
} else if (onlyRun === CEILING) {
    console.log("\n(scored the ceiling: it is the gap reference, so it has no gap row)");
} else if (!ceiling) {
    console.log(`\n(no '${CEILING}' run scored - add runs/${CEILING}/tests/ to get gaps)`);
}

console.log("\nFull results (consolidated + gaps + raw) in results/results.json");
console.log("Smell detail: run `pnpm smells runs/<name>/tests/` for per-rule output.");
