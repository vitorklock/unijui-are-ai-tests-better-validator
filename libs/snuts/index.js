// Thin wrapper (ours) over the vendored SNUTS detectors. Parses a TypeScript
// test suite and runs each named detector, returning smell occurrence counts.
import parser from "@babel/parser";
import { detectors } from "./src/common/detectors/index.js";

// Enough to parse our TS/TSX suites; errorRecovery keeps a partial AST instead
// of throwing on odd syntax so a single bad file never zeroes the whole run.
const PLUGINS = ["typescript", "jsx", "classProperties", "decorators-legacy", "importAttributes"];

function parseToAst(code) {
  return parser.parse(code, { sourceType: "module", plugins: PLUGINS, errorRecovery: true });
}

// Returns { total, byType } where byType maps each smell to its occurrence count
// (the detector's name minus the "detect" prefix). total is the sum across all
// detectors (one "occurrence" per detection).
export function detectSmells(code) {
  let ast;
  try {
    ast = parseToAst(code);
  } catch {
    return { total: 0, byType: {} };
  }
  const byType = {};
  let total = 0;
  for (const detector of detectors) {
    let count = 0;
    try {
      const found = detector(ast) || [];
      count = Array.isArray(found) ? found.length : 0;
    } catch {
      // A detector that chokes on this AST contributes nothing rather than
      // taking down the whole suite's smell measurement.
      count = 0;
    }
    byType[detector.name.replace(/^detect/, "")] = count;
    total += count;
  }
  return { total, byType };
}
