// Per-type test-smell breakdown for one suite, via the vendored SNUTS detectors.
// Accepts a run name (runs/<name>/tests), a run folder, or a tests dir.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectSmells } from "../libs/snuts/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const arg = process.argv[2];
if (!arg) {
    console.error("Usage: smells <run-name | tests-dir>");
    process.exit(1);
}

function resolveTestsDir(a: string): string | null {
    const direct = resolve(a);
    if (existsSync(direct) && statSync(direct).isDirectory()) {
        return existsSync(join(direct, "tests")) ? join(direct, "tests") : direct;
    }
    const underRuns = resolve(root, "runs", a, "tests");
    return existsSync(underRuns) ? underRuns : null;
}

const dir = resolveTestsDir(arg);
if (!dir) {
    console.error(`No tests found for "${arg}".`);
    process.exit(1);
}

const byType: Record<string, number> = {};
let total = 0, fileCount = 0;
for (const f of readdirSync(dir)) {
    if (!f.endsWith(".test.ts")) continue;
    fileCount++;
    const res = detectSmells(readFileSync(join(dir, f), "utf8"));
    total += res.total;
    for (const [k, v] of Object.entries(res.byType)) byType[k] = (byType[k] ?? 0) + v;
}

console.log(`${dir}  (${fileCount} file(s))  total smells = ${total}`);
const rows = Object.entries(byType).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
if (rows.length === 0) {
    console.log("  (no smells detected)");
} else {
    for (const [k, v] of rows) console.log(`  ${k}: ${v}`);
}
