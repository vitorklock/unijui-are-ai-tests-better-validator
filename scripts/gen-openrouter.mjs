// Gera k suítes via API da OpenRouter (modelos sem acesso ao sistema de arquivos):
// uma mensagem por geração (prompt + arquivos do bench), parâmetros padrão da API.
// Uso: OPENROUTER_API_KEY=... node scripts/gen-openrouter.mjs <model-id> P1|P2 [k=5] [slug]
//   ex.: node scripts/gen-openrouter.mjs deepseek/deepseek-v4.1-flash-1017 P1 5 deepseek-v4-1-flash
import { writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [model, cond, kArg, slugArg] = process.argv.slice(2);
if (!model || !cond) { console.error("Uso: node scripts/gen-openrouter.mjs <model-id> P1|P2 [k] [slug]"); process.exit(1); }
const k = Number(kArg ?? 5);
const slug = slugArg ?? model.split("/").pop().replace(/[^a-z0-9]+/gi, "-").toLowerCase();
const key = process.env.OPENROUTER_API_KEY;
if (!key) { console.error("Defina OPENROUTER_API_KEY"); process.exit(1); }
const candidates = [process.env.BENCH, resolve(here, "..", "bench"), resolve(here, "..", "unijui-are-ai-tests-better-bench")].filter(Boolean);
const bench = candidates.find((c) => existsSync(resolve(c, "src")));
if (!bench) { console.error("Bench não encontrado. Defina BENCH=/caminho/do/bench."); process.exit(1); }
const message = execSync(`bash "${resolve(here, "scripts/bundle-prompt.sh")}" ${cond} "${bench}"`, { encoding: "utf8" });
const manifest = resolve(here, "runs", "MANIFEST.csv");

// Salva o teste exatamente como veio: o maior bloco de código que importe vitest
// (ou o maior bloco, ou a resposta inteira se não houver cerca de código).
function extractTest(text) {
  const blocks = [...text.matchAll(/```(?:ts|typescript|tsx|javascript|js)?[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  if (blocks.length === 0) return text;
  const withVitest = blocks.filter((b) => /from\s+['"]vitest['"]/.test(b));
  const pool = withVitest.length ? withVitest : blocks;
  return pool.sort((a, b) => b.length - a.length)[0];
}

for (let i = 1; i <= k; i++) {
  const run = `${slug}-${cond.toLowerCase()}-r${i}`;
  const testFile = resolve(here, "runs", run, "tests", "expression-parser.test.ts");
  if (existsSync(testFile)) { console.log(`[${run}] já existe, pulando`); continue; }
  const t0 = Date.now();
  let data = {};
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: message }] }),
    });
    data = await res.json();
  } catch (e) { data = { error: String(e) }; }
  const secs = Math.round((Date.now() - t0) / 1000);
  const text = data.choices?.[0]?.message?.content ?? "";
  mkdirSync(dirname(testFile), { recursive: true });
  writeFileSync(resolve(here, "runs", run, "response.md"), text || JSON.stringify(data, null, 2));
  if (text) writeFileSync(testFile, extractTest(text));
  const usage = data.usage ?? {};
  const note = text ? "" : "resposta vazia ou erro";
  appendFileSync(manifest, `${run},${model},${data.model ?? ""},openrouter-api,${cond},${i},${new Date().toISOString()},${secs},${usage.completion_tokens ?? ""},${note}\n`);
  console.log(`[${run}] ${secs}s, ${usage.completion_tokens ?? "?"} tokens de saída${note ? " (" + note + ")" : ""}`);
}
