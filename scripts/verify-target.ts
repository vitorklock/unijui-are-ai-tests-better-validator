// Ensures the target code in the validator is byte-for-byte identical to the
// bench. Divergence here means mutating different code than the model tested,
// silently invalidating results. Run before any scoring.
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

// Adjust this path if bench is not next to validator.
const benchSrc = resolve(root, "..", "bench", "src");
const targetSrc = resolve(root, "target", "src");

// Files that must be identical between bench and validator.
const files = [
    "number-validator.ts",
    "interfaces.ts",
    "util/remove-undefined-properties.ts",
];

const hash = (path: string): string =>
    createHash("sha256").update(readFileSync(path)).digest("hex");

let ok = true;
for (const f of files) {
    const a = resolve(benchSrc, f);
    const b = resolve(targetSrc, f);
    if (!existsSync(a)) {
        console.error(`MISSING in bench:     ${f}`);
        ok = false;
    } else if (!existsSync(b)) {
        console.error(`MISSING in validator: ${f}`);
        ok = false;
    } else if (hash(a) !== hash(b)) {
        console.error(`DIVERGENT:            ${f}`);
        ok = false;
    } else {
        console.log(`ok                    ${f}`);
    }
}

if (!ok) {
    console.error(
        "\nTarget code diverges between bench and validator. " +
        "Sync before scoring (copy from bench/src to validator/target/src)."
    );
    process.exit(1);
}
console.log("\nTarget code in sync. Ready to score.");
