# Executando o experimento

Este documento descreve o procedimento de ponta a ponta para gerar suítes de
teste com LLMs e pontuá-las contra o teto de qualidade.

## Modelo mental

Três papéis se mapeiam nos dois repositórios:

- **`bench/`** — a oficina. Um modelo escreve um único arquivo de teste aqui, de
  forma isolada, e a pasta é limpa entre as execuções.
- **`validator/runs/<nome>/tests/`** — o arquivo histórico. Cada suíte gerada é
  copiada para cá em sua própria pasta, uma por *(modelo × condição)*, ao lado
  do `ceiling` construído manualmente.
- **`pnpm score`** — o avaliador. Ele lê cada pasta sob `runs/`, a pontua e
  imprime a Tabela II junto com os gaps por métrica.

Os dois repositórios git independentes impõem a regra central: um modelo só vê
`bench/`, nunca `validator/`, os prompts ou os critérios de pontuação.

## Pré-requisitos (configuração única)

Instale as dependências em ambos os projetos e confirme que o código-alvo está
sincronizado:

```
cd validator && pnpm install
cd ../bench  && pnpm install
cd ../validator && pnpm verify-target
```

O `verify-target` compara `bench/src` com `validator/target/src` por SHA-256.
Ele precisa passar antes de qualquer pontuação, pois garante que o código que um
modelo testou é idêntico byte a byte ao código que o Stryker muta. Se falhar,
sincronize os dois (`cp bench/src/* validator/target/src/...`) e execute-o
novamente.

## Passo 1 — Construir o teto de qualidade (uma vez)

O teto é a melhor suíte alcançável para o alvo — a referência contra a qual cada
execução de LLM é medida. Ele é construído sem restrição de meios (IA,
ferramentas, edição manual), iterando até que o escore de mutação sature e
nenhum smell permaneça.

1. Escreva uma suíte em `runs/ceiling/tests/number-validator.test.ts`,
   importando o alvo como `../src/number-validator`.
2. Execute `pnpm score` e leia a linha `ceiling`; execute
   `pnpm smells runs/ceiling/tests/` para o detalhamento de smells.
3. Adicione testes que matem os mutantes sobreviventes, remova quaisquer smells
   sinalizados e repita até que o recall (`R`) estabilize e a densidade de smells
   seja `0`.

A pasta precisa ter exatamente o nome `ceiling` — o `score.ts` a usa como
referência de gap. Documente cada decisão de refinamento para fins de
replicabilidade.

## Passo 2 — Gerar uma suíte por (modelo × condição)

Repita este laço para cada célula do desenho experimental — por exemplo,
`claude-opus × P1`, `claude-opus × P2`, `gpt-5 × P1`, e assim por diante.

### (a) Isolar o ambiente de trabalho

Copie o bench para um diretório de trabalho neutro, de modo que o modelo não
consiga inferir o experimento a partir de `pwd`, `ls ..` ou `git log`:

```
cp -r bench /tmp/work/number-validator
cd /tmp/work/number-validator && rm -rf .git && pnpm install
```

### (b) Gerar os testes

Garanta que `tests/` esteja vazio, então inicie o modelo apontado para aquele
diretório, fornecendo o conteúdo literal do prompt da condição:

- Condição P1 (básico): [`prompts/PROMPT_P1.md`](../prompts/PROMPT_P1.md)
- Condição P2 (ciente das métricas): [`prompts/PROMPT_P2.md`](../prompts/PROMPT_P2.md)

O modelo escreve `tests/number-validator.test.ts` e pode iterar executando
`pnpm test`. Esse é o único comando que o bench expõe.

### (c) Arquivar o resultado

Copie o arquivo gerado para uma pasta de execução chamada `<modelo>-<condição>`:

```
mkdir -p validator/runs/gpt-5-p1/tests
cp /tmp/work/number-validator/tests/number-validator.test.ts \
   validator/runs/gpt-5-p1/tests/
```

O `score.ts` descobre automaticamente qualquer `runs/<nome>/tests/*.test.ts`, de
modo que uma nova pasta vira uma nova linha sem nenhuma mudança de configuração.

### (d) Reiniciar

Remova o ambiente de trabalho temporário (`rm -rf /tmp/work/number-validator`) e
repita para a próxima célula.

Uma verificação ao copiar uma suíte: o caminho de importação é
`../src/number-validator` (o mesmo caminho que resolve tanto no bench quanto no
sandbox de pontuação).

**Não** corrija nem reduza a suíte gerada. Ela é pontuada exatamente como
produzida — não há portão de passar 100%. Testes que falham contra o código
correto contam como **falsos positivos** e reduzem a precisão (P); eles são
ignorados apenas na execução de mutação, para o Stryker manter um baseline
verde.

## Passo 3 — Pontuar todas as suítes

```
cd validator
pnpm verify-target
pnpm score              # todas as execuções (pontuadas em paralelo)
pnpm score <nome>       # apenas aquela execução (ex.: `pnpm score ceiling`)
pnpm score --jobs 4     # limita quantas execuções em paralelo (padrão ~ núcleos-1)
```

As execuções são pontuadas concorrentemente — cada uma em seu próprio sandbox
isolado — então o tempo total é próximo ao da suíte mais lenta, e não da soma.
O Stryker também paraleliza internamente, então `--jobs` é limitado por padrão
para não sobrecarregar a CPU; reduza-o se a máquina ficar saturada.

Passar um nome de execução pontua só aquela suíte — útil ao iterar no teto ou
em uma única condição. O resultado é mesclado ao `results/results.json` anterior (as
demais linhas são mantidas e a linha `ceiling` é reutilizada para recalcular o
gap), então você ainda obtém a tabela completa sem reexecutar o Stryker em
todas as suítes.

Duas tabelas são impressas e gravadas em `results/results.json`:

```
=== CONSOLIDATED (paper Table II) ===
Run              Tests  FP  Cov.L%  Cov.B%  R%    P%     F1%   Smells/test
ceiling          7      0   77.8    92.8    35.2  100.0  52.0  0.00
claude-opus-p1   5      1   57.4    28.6     2.2   80.0   4.3  0.00
...

=== GAP vs ceiling (ceiling - run) ===
Run              dCov.L  dCov.B  dR     dP     dF1    dSmells/test
claude-opus-p1   +20.4   +64.3   +33.0  +20.0  +47.7  +0.0
```

Definições das métricas:

- **FP** — falsos positivos: testes que falham sobre o código correto.
- **R** — escore de mutação (recall): mutantes não equivalentes que foram mortos.
- **P** — precisão: `aprovados / total` de casos de teste sobre o código correto
  (`1 − taxa de falsos positivos`). Suíte limpa → 100%; suíte com testes que
  falham → <100%.
- **F1** — `2PR/(P+R)`, agora variando com P e R.
- **Smells/test** — ocorrências de test smells por caso de teste, via detectores
  do SNUTS.js vendorizados (`libs/snuts/`, crédito: Jhonatan Mizu).
- **Gap** — `ceiling − run`. Um `dR`/`dF1`/`dCov` positivo maior significa que a
  execução está mais abaixo do teto naquela dimensão. Para a densidade de smells,
  um valor negativo significa que a execução tem mais smells do que o teto.

Execute `pnpm smells <nome>` para um detalhamento de smells por tipo de uma suíte.

## Passo 4 — Interpretando os resultados

A tabela de gaps responde às questões de pesquisa diretamente:

- **QP1** (quão abaixo do teto) — a magnitude dos gaps de cada execução de LLM.
- **QP2** (o prompt ciente das métricas estreita o gap) — compare a linha `-p1`
  de cada modelo com a sua linha `-p2`.
- **QP3** (qual dimensão é a mais larga) — a coluna de maior gap, esperada em
  `dR` e `dSmells`, com a cobertura mais próxima do teto.

## Notas práticas

- **Determinismo.** Fixe a versão do modelo e os parâmetros de geração e repita
  as execuções. Para repetições, use pastas como `gpt-5-p1-r1`, `gpt-5-p1-r2`;
  cada uma é uma linha independente para ser feita a média depois.
- **Ferramental de geração.** Misturar ferramentas de orquestração (por exemplo,
  um harness de agente para um modelo e outro para um segundo) é uma ameaça à
  validade interna — mantenha-o constante por modelo ou reporte-o.
- **Não edite o alvo.** `bench/src` e `validator/target/src` precisam permanecer
  idênticos byte a byte; o `verify-target` recusa-se a pontuar se eles
  divergirem.
