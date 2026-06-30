# Discrepâncias entre a execução e o artigo

Lista resumida dos pontos em que o aparato (validator/bench) diverge do texto
atual do artigo. Serve para corrigir o artigo depois da coleta. Ordem ≈ por
impacto na leitura da Tabela II.

## 1. Pré-condição removida (mudança de método)

- **Artigo (Seção III.D):** "exige-se que todos os testes de qualquer suíte
  passem sobre o código correto. Suítes que falham sobre o código correto são
  **corrigidas** antes da pontuação."
- **Execução (agora):** não há portão de passar 100% e **nada é corrigido**. A
  suíte é pontuada como gerada; testes que falham sobre o código correto contam
  como **falsos positivos** e penalizam a precisão.
- **Ação no artigo:** reescrever a pré-condição. Trocar "corrigidas antes da
  pontuação" por "pontuadas como geradas; falhas sobre o código correto entram
  como falsos positivos (FP) que reduzem P". Justificar: corrigir a saída da LLM
  contaminaria a medida de qualidade *autônoma*.

## 2. Precisão e F1 deixam de ser degeneradas

- **Antes:** com a pré-condição, FP = 0 sempre ⇒ **P = 1 por construção** e
  F1 = 2R/(1+R) (função determinística de R). P e F1 não discriminavam nada.
- **Agora:** **P = aprovados / total** de casos de teste sobre o código correto
  (= 1 − taxa de FP). P e F1 variam de verdade entre as condições.
- **Ação no artigo:** manter Eq. 3 (`P = VP/(VP+FP)`, `F1 = 2PR/(P+R)`), mas
  **explicitar a operacionalização**: "positivo" = um caso de teste; FP = teste
  que falha sobre o código correto; VP = teste que passa sobre o código correto.
  Deixar claro que P e F1 agora são informativos (não constantes).

## 3. Recall na presença de falsos positivos (decisão não documentada no artigo)

- **Execução:** um teste que falha sobre o código correto é um detector inválido
  e abortaria o baseline do Stryker. Por isso ele é marcado como `skip`
  **apenas** na execução de mutação; cobertura e P usam a suíte completa.
- **Cobertura com FP:** o Vitest, por padrão, **não emite o relatório de
  cobertura quando algum teste falha** (`coverage.reportOnFailure = false`). O
  aparato força `reportOnFailure: true`, então a cobertura é medida sobre a suíte
  completa mesmo havendo FP — caso contrário uma única falha zeraria a cobertura
  da execução inteira.
- **Ação no artigo:** acrescentar 1 frase ao procedimento, explicando que testes
  FP são excluídos só da medição de mutação (para não inflar R espuriamente).

## 4. Mutantes equivalentes não são subtraídos (Eq. 2)

- **Artigo (Eq. 2):** `R = M_mortos / (M_total − M_equiv)`.
- **Execução:** o StrykerJS **não identifica mutantes equivalentes**; eles ficam
  como *Survived* no denominador. Logo o R medido é um **limite inferior** do R
  da Eq. 2. (Denominador real = Killed + Timeout + Survived + NoCoverage; inválidos
  — CompileError/RuntimeError/Ignored — são excluídos.)
- **Ação no artigo:** já consta como ameaça de construto; acrescentar 1 frase em
  Métricas dizendo que a ferramenta não subtrai `M_equiv`, então R reportado ≤ R
  teórico.

### 4.1. Limite teórico medido para o alvo (pendente: alvo trocado)

> ⚠️ **Desatualizado.** O teto provado anteriormente (R = 95,6%; 4 mutantes
> equivalentes nas guardas `typeof` do `number-validator.ts`) era específico
> daquele alvo. **O alvo foi trocado para o `expression-parser`** (lexer +
> parser + evaluator), então aquele teto e o registro
> `runs/ceiling/EQUIVALENT_MUTANTS.md` **não valem mais**.

Esta subseção será reescrita quando o novo teto for construído para o
`expression-parser` e seu limite medido (escore de mutação máximo, mutantes
equivalentes encontrados, prova de equivalência). Até lá vale apenas o ponto
geral da §4: a ferramenta não subtrai `M_equiv`, logo o R reportado é um limite
inferior do R da Eq. 2.

- **Ação no artigo:** preencher a Tabela II somente após medir o novo teto;
  reportar o R do teto na base Stryker e documentar os mutantes equivalentes do
  novo alvo (mesma lógica de antes, números novos).

## 5. Test smells: detectados pelo SNUTS.js (não por regras ESLint personalizadas)

- **Artigo (Seção III.E / II.C):** "ESLint estendido com **regras
  personalizadas**"; smells de interesse: Assertion Roulette, Duplicate Assert,
  Eager Test, **Magic Number Test**, **Mystery Guest**.
- **Execução (agora):** os smells são detectados pelo **SNUTS.js** (Jhonatan
  Mizu; https://github.com/Jhonatanmizu/SNUTS.js), cujos detectores foram
  vendorizados em `validator/libs/snuts/` e rodam sobre a AST (Babel) de cada
  suíte. São 15 detectores: Anonymous Test, Sensitive Equality, Comments Only
  Test, General Fixture, Test Without Description, Transcripting Test,
  Overcommented Test, Identical Test Description, Complex Snapshot, Conditional
  Test Logic, Non-Functional Statement, Only Test, Sub-Optimal Assert,
  Verbose/Eager Test e Verify In Setup. A densidade segue sendo ocorrências por
  caso de teste.
- **Cobertura do catálogo do artigo:** Eager Test ≈ *Verbose Statement*; Mystery
  Guest ≈ *General Fixture*. Assertion Roulette, Duplicate Assert e Magic Number
  Test **não têm detector direto** no SNUTS (ficam fora de escopo ou para
  inspeção manual).
- **Ação no artigo:** (a) trocar "ESLint com regras personalizadas" por "detecção
  de test smells com o **SNUTS.js** (Mizu), reutilizando seus detectores"; (b)
  substituir a lista de smells de interesse pela lista efetivamente medida pelo
  SNUTS (acima) — já acordado que podemos alterar os smells citados no artigo;
  (c) citar o SNUTS (repositório e artigo SBES) na subseção de Ferramentas.

## 6. Cobertura: "condições" não é medida separadamente

- **Artigo (Eq. 1):** cita linhas, **ramos** e **condições**.
- **Execução:** cobertura via v8 (Vitest) reporta linhas, ramos, statements e
  funções — **não** há cobertura de condições (MC/DC). Ramos é o proxy.
- **Ação no artigo:** suavizar "condições" ou registrar cobertura de ramos como
  o proxy adotado.

## 7. Constantes de geração ainda não registradas (reprodutibilidade)

- **Artigo (Tabela I / Ferramentas):** "modelo de LLM fixado"; versão e
  parâmetros de geração registrados (já há `\todo` no `.tex`).
- **Execução:** os docs pedem para fixar, mas **não registram valores concretos**
  (modelo, versão, temperatura, etc.). As pastas em `runs/` indicam o modelo, não
  os parâmetros.
- **Ação no artigo/repo:** adicionar a tabela de constantes com modelo+versão e
  parâmetros de geração de cada execução.

## 8. Alvo e escopo de medição

- **Alvo atual:** o código sob teste é o **`expression-parser`** (um avaliador de
  expressões no estilo cláusula `WHERE` do SQL), com cinco arquivos em `src/`:
  `lexer.ts`, `parser.ts`, `evaluator.ts`, `ast.ts` e `token.ts`. Substituiu o
  `number-validator` para dar mais espaço de discriminação — alvo maior e mais
  difícil de saturar (no `number-validator`, P, cobertura e smells eram quase
  constantes entre as suítes; no parser, R, smells e cobertura variam de verdade).
- **Escopo de cobertura e mutação:** ambas incidem sobre os **3 arquivos de
  lógica** — `lexer.ts`, `parser.ts`, `evaluator.ts`. `ast.ts` (nós da AST) e
  `token.ts` (enum + classe `Token`) são estruturais/tipos (análogos ao antigo
  `interfaces.ts`) e ficam **fora** do escopo de mutação/cobertura.
- **Ação no artigo:** registrar o `expression-parser` como alvo e declarar que
  cobertura e escore de mutação incidem sobre os arquivos de lógica
  (lexer/parser/evaluator).

---

### Resumo do que mudou no código

- `validator/scripts/score.ts`: removido o portão de pré-condição; toda suíte é
  pontuada. Nova coluna **FP** (falsos positivos), **P = aprovados/total**, F1
  variável, **dP** na tabela de gaps, testes FP marcados como `skip` só para a
  mutação. Suíte que nem roda → "could not run".
- **Smells:** substituído o `eslint-plugin-vitest` pelos detectores do
  **SNUTS.js**, vendorizados em `validator/libs/snuts/` (15 detectores AST). O
  `score.ts` mede smells em processo (sem subprocesso); `results.json` passa a
  trazer `smells.byType` por execução e `pnpm smells <run>` mostra o
  detalhamento. As dependências do ESLint foram removidas do `package.json`.
- **Alvo trocado:** `number-validator` → `expression-parser`. Atualizados
  `bench/src` (5 arquivos), `validator/target/src` (espelho), a lista de
  `verify-target.ts`, o `mutate` do Stryker (lexer/parser/evaluator) e o
  `include`/escopo de cobertura do `score.ts`. Removidos os antigos
  `number-validator.ts`/`interfaces.ts`/`util/` e os smoke tests do alvo.
- **Cobertura com FP:** `score.ts` passa `coverage.reportOnFailure: true` no
  sandbox, para que suítes com falsos positivos ainda reportem cobertura.
- **Robustez do SNUTS:** corrigido `transcriptingTest.js` (assumia corpo em bloco
  e quebrava em testes com corpo de arrow, `() => expect(...)`); o wrapper isola
  parse/detector com `try/catch` e o `score.ts` isola a medição de smells, para
  que uma falha de smell nunca descarte cobertura/mutação da execução.
- `README.md`, `docs/running-the-experiment.md` e `.pt-br.md`: seções de
  pré-condição e de métricas atualizadas para refletir o acima.


---

Modelos utilizados

Claude Opus 3.8 em Ultracode com Subagentes

Nvidia Nemotron 3 Nano 30B A3B (free)

Claude Sonnet 4.6 Medium
