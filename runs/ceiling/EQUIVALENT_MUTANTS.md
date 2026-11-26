# Teto: mutantes equivalentes (por que R satura em 99,5%)

Alvo: `expression-parser` (`lexer.ts`, `parser.ts`, `evaluator.ts`). StrykerJS gera
**369 mutantes válidos** nesses três arquivos. A suíte do teto (119 testes) mata
**367**; os **2** restantes são equivalentes, e por isso 99,5% é o limite superior
na base do Stryker.

## Censo (execução sequencial, `--concurrency 1`)

| Status      | Quantidade |
| ----------- | ---------- |
| Killed      | 338        |
| Timeout     | 29         |
| Survived    | 2          |
| NoCoverage  | 0          |
| **Válidos** | **369**    |

R = (Killed + Timeout) / válidos = 367 / 369 = **99,46%**. Subtraindo os 2
equivalentes do denominador (Eq. 2 do artigo): 367 / 367 = **100%**.
Cobertura: linhas 100%, ramos 99,3% (o único ramo não coberto, `parser.ts:32`,
não deixa mutante sobrevivente). Smells (SNUTS.js): 0. Falsos positivos: 0.

## Histórico das revisões

**Versão 1 (104 testes).** Medida em 95,1% com pontuação em paralelo (6 suítes ao
mesmo tempo, cada Stryker com seus workers). Medida de novo, sozinha, no mesmo
ambiente: **92,7%** (313 mortos, 29 timeouts, 21 sobreviventes, 6 sem cobertura).
A diferença são 66 *timeouts* espúrios causados por carga da máquina, que o
Stryker conta como mortos. Lição: toda pontuação é sequencial, e `Killed` e
`Timeout` são reportados separadamente.

**Revisão 1 (116 testes, 97,8%).** Dos 21 sobreviventes reais, 19 eram matáveis.
Doze testes, um comportamento por teste, sem smells:

| Mutantes mortos | Teste adicionado |
| --- | --- |
| `lexer.ts:167` `<= 0x39` → `< 0x39` (dígito 9 deixava de ser número) | `evaluate('9')`, `evaluate('19')` |
| `lexer.ts:140` guarda do ponto decimal → `true` | `evaluate('12.5')` (com um dígito antes do ponto o mutante é indistinguível) |
| `lexer.ts:173` faixa A–Z (`false`, `true`, `> 0x41`, `< 0x5a`, `> 0x5a`) | identificadores `Age`, `Zone`; caractere `[` ilegal |
| `lexer.ts:174` faixa a–z (`true`, `< 0x7a`) | identificador `zip`; caractere `{` ilegal |
| `lexer.ts:73–74` tratamento do `'\0'` (fim de entrada) | mensagem exata com o token EOF em `parse('(1')` |
| `lexer.ts:150–151` cálculo da posição do token (5 mutantes) | mensagens exatas com posição de um token ilegal (`1 + @`) e de um token string (`length('a' 'b')`) |
| `parser.ts:195` guarda "case sem when" (`false`, bloco vazio) | `parse('case end')` |

Os 8 restantes (2 sobreviventes + 6 sem cobertura) foram então classificados: 2
equivalentes e 6 "inalcançáveis pela API pública".

**Revisão 2 (119 testes, 99,5%).** Uma suíte gerada por LLM na condição P2
(`fable-5-1-p2-r1`) cobriu mais linhas e ramos que o teto. Ela envolveu `parse`
com `vi.mock` (mantendo a implementação real) e, em dois testes, fez `parse`
devolver nós que o *parser* nunca produz, alcançando os dois ramos `default` do
avaliador. A classificação "inalcançável pela API pública" estava correta quanto
às **entradas**, mas o critério relevante para teste de mutação é se **algum teste
válido** distingue o mutante, e um teste com injeção de dependência distingue.
Pelo mesmo raciocínio, o `if` morto de `parseGroupedExpression` é alcançável com
um `vi.spyOn` em `expectPeekToken`. Três testes mataram os 6:

| Mutantes mortos | Teste adicionado |
| --- | --- |
| `evaluator.ts:47–48` `default` de operadores (bloco e mensagem) | `parse` mockado devolve `BinaryExpression(Not, 1, 2)` → `evaluate` lança `Operator not not implemented` |
| `evaluator.ts:77–78` `default` de tipos de nó (bloco e mensagem) | `parse` mockado devolve `UnaryExpression(Minus, 1)` → `evaluate` lança `Invalid AST node` |
| `parser.ts:143–144` bloco do `if (!this.expectPeekToken(Rparn))` e mensagem | `spyOn(Parser.prototype, 'expectPeekToken')` devolve `undefined` uma vez → `parse('(1)')` lança `Expected ) but got …` |

Lição: o teto é uma afirmação sobre o alvo, e qualquer suíte que o supere em
qualquer métrica é motivo de revisão. Foi o que aconteceu.

## Os 2 que restam: prova de equivalência

| # | Local | Mutação | Por que nenhum teste distingue |
| - | ----- | ------- | ------------------------------ |
| 1 | `lexer.ts:12` | `currentChar = '\0'` → `""` | Inicializador morto: o construtor chama `readChar()` imediatamente, que reatribui `currentChar` em todos os caminhos antes de qualquer leitura. O campo é privado e reatribuído antes de qualquer ponto observável, então nem injeção ajuda. |
| 2 | `lexer.ts:109` | `peekChar()` retorna `""` em vez de `'\0'` no fim da entrada | O valor de `peekChar()` só é usado em comparações com `'>'`/`'='` e nos classificadores `isLetter`/`isNumber`/`isDot`. `''.charCodeAt(0)` é `NaN` e `'\0'.charCodeAt(0)` é `0`; ambos falham em todas as comparações de faixa, e nenhum dos dois é `'.'`, `'>'` ou `'='`. O método é privado e seu retorno nunca escapa da classe. |

## Relação com a Eq. 2 do artigo

O StrykerJS não detecta mutantes equivalentes, então o R reportado para **todas**
as suítes (teto e LLMs) mantém os 2 no denominador: a comparação é feita numa
única definição de R. Este arquivo registra por que o teto não chega a 100% nessa
base e demonstra que 99,5% é o máximo alcançável para o alvo.

## Reproduzir

```
pnpm score --only ceiling --jobs 1   # R 99.5, cov 100/99.3, P 100, 0 smells
```
