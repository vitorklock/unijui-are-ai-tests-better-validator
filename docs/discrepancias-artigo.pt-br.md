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

## 5. Test smells: regras de prateleira, não "personalizadas"; 2 dos 5 não medidos

- **Artigo (Seção III.E / II.C):** "ESLint estendido com **regras
  personalizadas**"; smells de interesse: Assertion Roulette, Duplicate Assert,
  Eager Test, **Magic Number Test**, **Mystery Guest**.
- **Execução:** usa regras de prateleira do `eslint-plugin-vitest`
  (`max-expects`, `no-identical-title`, `no-standalone-expect`,
  `no-conditional-expect`, `valid-expect`, `no-disabled-tests`, `expect-expect`)
  como **proxies estruturais**. **Magic Number Test** e **Mystery Guest** (smells
  semânticos) **não são detectados** automaticamente.
- **Ação no artigo:** (a) trocar "regras personalizadas" por "regras do
  `eslint-plugin-vitest` selecionadas como proxies estruturais"; (b) listar
  apenas os smells efetivamente aferidos e declarar Magic Number/Mystery Guest
  como inspeção manual ou fora de escopo.

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
- `README.md`, `docs/running-the-experiment.md` e `.pt-br.md`: seções de
  pré-condição e de métricas atualizadas para refletir o acima.
