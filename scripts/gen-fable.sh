#!/usr/bin/env bash
# Gera k suítes com o Claude Code em modo headless e SEM execução de comandos
# (Bash desabilitado): o modelo lê o alvo e escreve o arquivo de teste, nas mesmas
# condições dos modelos de chat/API (uma mensagem, sem feedback de execução).
# Uso: scripts/gen-fable.sh P1|P2 [k=5] [model-id]
#   BENCH=/caminho/do/bench  WORK=/tmp/work  (opcionais)
#   EXEC=1  -> condição COM execução: Bash liberado só para `pnpm test`/`vitest`;
#              as suítes vão para runs/fable-5-1-exec-<p>-r<k>/ e o diretório de
#              trabalho recebe node_modules (link do bench ou `pnpm install`).
set -euo pipefail
cond="${1:?informe P1 ou P2}"; k="${2:-5}"; model="${3:-}"
here="$(cd "$(dirname "$0")/.." && pwd)"
bench="${BENCH:-}"
if [ -z "$bench" ]; then
  for cand in "$here/../bench" "$here/../unijui-are-ai-tests-better-bench"; do
    if [ -d "$cand/src" ]; then bench="$cand"; break; fi
  done
fi
# Sem bench clonado: usa target/src (idêntico ao bench, verificado por verify-target) + bench-skeleton/
if [ -z "$bench" ] || [ ! -d "$bench/src" ]; then
  srcdir="$here/target/src"; skel="$here/bench-skeleton"
else
  srcdir="$bench/src"; skel="$bench"
fi
work="${WORK:-/tmp/work}"
lc="$(printf '%s' "$cond" | tr '[:upper:]' '[:lower:]')"
if [ "${EXEC:-0}" = "1" ]; then
  slug="fable-5-1-exec"; iface="claude-code-headless-com-exec"
  allowed="Read,Write,Edit,MultiEdit,Glob,Grep,LS,Bash(pnpm test*),Bash(pnpm vitest*),Bash(npx vitest*),Bash(pnpm install*),Bash(pnpm exec vitest*)"
  disallowed="WebSearch,WebFetch,Task,Agent,NotebookEdit"
else
  slug="fable-5-1"; iface="claude-code-headless-sem-bash"
  allowed="Read,Write,Edit,MultiEdit,Glob,Grep,LS"
  disallowed="Bash,WebSearch,WebFetch,Task,Agent,NotebookEdit"
fi
manifest="$here/runs/MANIFEST.csv"
for i in $(seq 1 "$k"); do
  run="$slug-$lc-r$i"
  if [ -s "$here/runs/$run/tests/expression-parser.test.ts" ]; then echo "[$run] já existe, pulando"; continue; fi
  dir="$work/expression-parser-$(date +%s)-$RANDOM"      # caminho neutro, novo a cada execução
  mkdir -p "$dir/tests" "$dir/src"
  cp "$srcdir"/*.ts "$dir/src/"
  cp "$skel"/package.json "$skel"/vitest.config.ts "$skel"/tsconfig.json "$dir/"
  if [ "${EXEC:-0}" = "1" ]; then
    if [ -d "$skel/node_modules" ]; then ln -s "$skel/node_modules" "$dir/node_modules"
    else ( cd "$dir" && pnpm install --silent >/dev/null 2>&1 ) || echo "AVISO: pnpm install falhou em $dir"; fi
  fi
  echo "[$run] gerando em $dir (sem saída até terminar; ~1-5 min)..."
  start=$(date +%s)
  ( cd "$dir" && claude -p "$(cat "$here/prompts/PROMPT_${cond}.md")" \
      ${model:+--model "$model"} \
      --permission-mode acceptEdits \
      --allowedTools "$allowed" \
      --disallowedTools "$disallowed" \
      > "$dir/transcript.txt" 2>&1 ) || true
  secs=$(( $(date +%s) - start ))
  mkdir -p "$here/runs/$run/tests"
  cp "$dir/transcript.txt" "$here/runs/$run/response.md" 2>/dev/null || true
  if ls "$dir"/tests/*.test.ts >/dev/null 2>&1; then
    cp "$dir"/tests/*.test.ts "$here/runs/$run/tests/"; note=""
  else
    note="nao produziu arquivo de teste"; echo "AVISO: $run $note"
  fi
  printf '%s,claude-fable-5-1,%s,%s,%s,%s,%s,%s,,%s\n' \
    "$run" "${model:-default}" "$iface" "$cond" "$i" "$(date -Iseconds)" "$secs" "$note" >> "$manifest"
  ntests=$(grep -cE '^\s*(it|test)\(' "$here/runs/$run/tests/"*.test.ts 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')
  echo "[$run] concluída em ${secs}s, ~${ntests} testes ${note:+($note)}"
done
echo "Pronto: $(ls -d "$here"/runs/$slug-$lc-r* 2>/dev/null | wc -l) suítes em runs/$slug-$lc-r*/"
