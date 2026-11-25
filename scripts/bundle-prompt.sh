#!/usr/bin/env bash
# Monta a mensagem única enviada a modelos sem acesso ao sistema de arquivos
# (apps de chat e APIs): o prompt da condição seguido dos arquivos do bench,
# exatamente o que um modelo com acesso ao diretório veria.
# Uso: scripts/bundle-prompt.sh P1|P2 [caminho-do-bench] > mensagem.md
set -euo pipefail
cond="${1:?informe P1 ou P2}"
here="$(cd "$(dirname "$0")/.." && pwd)"
bench="${2:-$here/../bench}"
cat "$here/prompts/PROMPT_${cond}.md"
printf '\n\n## Files\n'
for f in package.json vitest.config.ts src/token.ts src/ast.ts src/lexer.ts src/parser.ts src/evaluator.ts; do
  case "$f" in *.json) lang=json ;; *) lang=ts ;; esac
  printf '\n### %s\n\n```%s\n' "$f" "$lang"
  cat "$bench/$f"
  printf '\n```\n'
done
