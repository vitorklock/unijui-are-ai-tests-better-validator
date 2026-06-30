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

### 4.1. Limite teórico medido para o alvo atual (teto: R = 95,6%, não 100%)

O teto foi construído e seu limite **provado**. Para o `number-validator.ts`, o
StrykerJS gera **91 mutantes**; a suíte de referência mata **87** e atinge:

| Métrica | Teto |
| --- | --- |
| Cobertura (linhas / ramos) | 100% / 100% |
| Escore de mutação (R) | **95,6%** (87/91) |
| Falsos positivos (FP) | 0 |
| Precisão (P) / F1 | 100% / 97,8% |
| Densidade de smells | 0,00 |

O R **não chega a 100%** porque exatamente **4 mutantes são equivalentes** — não
podem ser mortos por nenhum teste. Os 4 estão nas guardas `typeof min/max !==
"undefined"` (linhas 71 e 79): a guarda é **redundante** com a comparação
seguinte, pois quando `min`/`max` é `undefined` o termo `value < undefined`
(resp. `value > undefined`) é sempre `false` (comparação relacional com `NaN`).
Enfraquecer a guarda, portanto, não altera o comportamento observável.

- **Prova:** analítica (semântica IEEE-754 / ECMAScript) **e** empírica — um
  painel adversarial de 12 agentes (cada um dos 4 sobreviventes atacado por 3
  ângulos independentes) retornou **0 mortes em 12 veredictos**. Todas as
  *outras* mutações nas linhas 71/79 são mortas, então a suíte é máxima ali.
- **Registro completo:** `validator/runs/ceiling/EQUIVALENT_MUTANTS.md`.

**Consequência para a Tabela II.** A linha "Teto" terá **R = 95,6%**, e não
100% — o que *confirma* a afirmação do artigo de que o teto é o "máximo empírico
efetivamente alcançável, e não necessariamente um ideal teórico de 100%". Pela
Eq. 2 literal (subtraindo `M_equiv = 4`), o R do teto seria `87/(91−4) = 100%`;
como a ferramenta não subtrai equivalentes (ver §4), o aparato reporta **95,6%**
para o teto **e** para as condições da LLM, mantendo a mesma base de R na
comparação de gaps.

- **Ação no artigo:** ao preencher a Tabela II, reportar R do teto = 95,6% (base
  Stryker) e acrescentar nota de rodapé citando os 4 mutantes equivalentes como
  a razão de não ser 100% (remetendo ao registro acima). Não reportar 100% no
  teto e 95,6% nas LLMs — misturaria duas definições de R.

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
- `README.md`, `docs/running-the-experiment.md` e `.pt-br.md`: seções de
  pré-condição e de métricas atualizadas para refletir o acima.


---

Modelos utilizados

Claude Opus 3.8 em Ultracode com Subagentes

Nvidia Nemotron 3 Nano 30B A3B (free)

