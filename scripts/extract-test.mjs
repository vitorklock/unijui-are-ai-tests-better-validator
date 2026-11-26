// Para gerações manuais (app de chat): lê runs/<run>/response.md, extrai o bloco de
// código do teste para runs/<run>/tests/expression-parser.test.ts e registra no manifesto.
// Uso: node scripts/extract-test.mjs <run> "<nome exato do modelo no app>" [segundos]
//   ex.: node scripts/extract-test.mjs gemini-pro-p1-r1 "Gemini 3 Pro" 95
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [run, modelName, secs] = process.argv.slice(2);
if (!run) { console.error('Uso: node scripts/extract-test.mjs <run> "<modelo no app>" [segundos]'); process.exit(1); }
const m = run.match(/^(?<slug>.+)-(?<prompt>p[12])-r(?<rep>\d+)$/);
if (!m) { console.error("Nome fora do padrão <slug>-<p1|p2>-r<k>:", run); process.exit(1); }
const dir = resolve(here, "runs", run);
const resp = resolve(dir, "response.md");
if (!existsSync(resp)) { console.error("Não achei", resp, "- salve a resposta completa do app nesse arquivo primeiro."); process.exit(1); }
const text = readFileSync(resp, "utf8");

const blocks = [...text.matchAll(/```(?:ts|typescript|tsx|javascript|js)?[^\n]*\n([\s\S]*?)```/g)].map((x) => x[1]);
let body;
if (blocks.length === 0) { body = text; console.warn("AVISO: nenhum bloco de código; salvando a resposta inteira como teste."); }
else {
  const withVitest = blocks.filter((b) => /from\s+['"]vitest['"]/.test(b));
  const pool = withVitest.length ? withVitest : blocks;
  body = pool.sort((a, b) => b.length - a.length)[0];
  if (blocks.length > 1) console.warn(`Aviso: ${blocks.length} blocos de código na resposta; usei o maior que importa vitest (${body.split("\n").length} linhas). Confira se é o arquivo de teste.`);
}
mkdirSync(resolve(dir, "tests"), { recursive: true });
writeFileSync(resolve(dir, "tests", "expression-parser.test.ts"), body);
const manifest = resolve(here, "runs", "MANIFEST.csv");
appendFileSync(manifest, `${run},${m.groups.slug},${modelName ?? ""},chat-app,${m.groups.prompt.toUpperCase()},${m.groups.rep},${new Date().toISOString()},${secs ?? ""},,\n`);
const n = (body.match(/^\s*(it|test)\(/gm) || []).length;
console.log(`[${run}] teste salvo (${body.split("\n").length} linhas, ~${n} testes); manifesto atualizado.`);
