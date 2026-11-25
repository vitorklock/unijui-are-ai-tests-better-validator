# Teto: mutantes equivalentes e inalcançáveis (por que R satura em 97,8%)

Alvo: `expression-parser` (`lexer.ts`, `parser.ts`, `evaluator.ts`). StrykerJS gera
**369 mutantes válidos** nesses três arquivos. A suíte do teto (116 testes) mata
todos os que podem ser mortos pela API pública (`parse`, `evaluate`,
`evaluateObject`); os **8** restantes são equivalentes ou inalcançáveis, e por
isso 97,8% é o limite superior na base do Stryker.

## Censo (execução sequencial, `--concurrency 1`)

| Status      | Quantidade |
| ----------- | ---------- |
| Killed      | 332        |
| Timeout     | 29         |
| Survived    | 2          |
| NoCoverage  | 6          |
| **Válidos** | **369**    |

R = (Killed + Timeout) / válidos = 361 / 369 = **97,83%**. Subtraindo os 8
equivalentes do denominador (Eq. 2 do artigo): 361 / 361 = **100%**.

Cobertura: linhas 99,22%, ramos 97,33%. As linhas não cobertas (`evaluator.ts`
48 e 78; `parser.ts` 144–145) são exatamente as inalcançáveis listadas abaixo,
então essa cobertura também é a máxima possível pela API pública.

## Histórico da revisão

A versão anterior desta suíte (104 testes) havia sido medida em **95,1%** com a
pontuação em paralelo (6 suítes ao mesmo tempo, cada Stryker com seus próprios
workers). Medida de novo, sozinha, no mesmo ambiente, a mesma suíte dá
**92,7%** (313 mortos, 29 timeouts, 21 sobreviventes, 6 sem cobertura): a
diferença são 66 *timeouts* espúrios causados por carga da máquina, que o
Stryker conta como mortos. Lição metodológica registrada no artigo: **toda
pontuação é sequencial**, e `Killed` e `Timeout` são reportados separadamente.

Dos 21 sobreviventes reais, 19 eram matáveis. Foram adicionados 12 testes
(116 no total), um comportamento por teste, sem smells (SNUTS = 0):

| Mutantes mortos pela revisão | Teste adicionado |
| --- | --- |
| `lexer.ts:167` `<= 0x39` → `< 0x39` (dígito 9 deixava de ser número) | `evaluate('9')`, `evaluate('19')` |
| `lexer.ts:140` guarda do ponto decimal → `true` | `evaluate('12.5')` (a suíte anterior só tinha decimais com um dígito antes do ponto, onde o mutante é indistinguível) |
| `lexer.ts:173` faixa A–Z (`false`, `true`, `> 0x41`, `< 0x5a`, `> 0x5a`) | identificadores `Age`, `Zone`; caractere `[` ilegal |
| `lexer.ts:174` faixa a–z (`true`, `< 0x7a`) | identificador `zip`; caractere `{` ilegal |
| `lexer.ts:73–74` tratamento do `'\0'` (fim de entrada) | mensagem exata com o token EOF em `parse('(1')` |
| `lexer.ts:150–151` cálculo da posição do token (5 mutantes) | mensagens exatas com posição de um token ilegal (`1 + @`) e de um token string (`length('a' 'b')`) |
| `parser.ts:195` guarda "case sem when" (`false`, bloco vazio) | `parse('case end')` |

## Os 8 que restam: prova de equivalência / inalcançabilidade

### Equivalentes (2 `Survived`)

| # | Local | Mutação | Por que nenhum teste distingue |
| - | ----- | ------- | ------------------------------ |
| 1 | `lexer.ts:12` | `currentChar = '\0'` → `""` | Inicializador morto: o construtor chama `readChar()` imediatamente, que reatribui `currentChar` em todos os caminhos antes de qualquer leitura. |
| 2 | `lexer.ts:109` | `peekChar()` retorna `""` em vez de `'\0'` no fim da entrada | O valor de `peekChar()` só é usado em comparações com `'>'`/`'='` e nos classificadores `isLetter`/`isNumber`/`isDot`. `''.charCodeAt(0)` é `NaN` e `'\0'.charCodeAt(0)` é `0`; ambos falham em todas as comparações (`NaN` é falso em qualquer relação; `0` está fora de todas as faixas), e nenhum dos dois é `'.'`, `'>'` ou `'='`. |

### Inalcançáveis pela API pública (6 `NoCoverage`)

| # | Local | Mutação | Por que o código é inalcançável |
| - | ----- | ------- | ------------------------------- |
| 3–4 | `parser.ts:143–144` | bloco do `if (!this.expectPeekToken(Rparn))` e sua mensagem | `expectPeekToken` retorna um `Token` (objeto, sempre truthy) ou lança; o `if` nunca é verdadeiro. Código morto. |
| 5–6 | `evaluator.ts:47–48` | `default` do `switch` de operadores binários e sua mensagem | Todo `BinaryExpression` vem do parser, que só produz `+ - * / = <> > >= < <= and or` (infixos), `=`/`<>` (`is [not] null`) e `and`/`>=`/`<=` (`between`): todos tratados pelo `switch`. `evaluateExpression` não é exportada, então não há como injetar uma AST com outro operador. |
| 7–8 | `evaluator.ts:77–78` | `default` do `switch` de tipos de nó e sua mensagem | O único tipo da união `Expression` não tratado é `UnaryExpression`, que o parser nunca constrói (não há parser prefixo para `-` ou `not`). Mesmo argumento de não exportação. |

## Relação com a Eq. 2 do artigo

O StrykerJS não detecta mutantes equivalentes, então o R reportado para **todas**
as suítes (teto e LLMs) mantém os 8 no denominador: a comparação é feita numa
única definição de R. Este arquivo registra por que o teto não chega a 100%
nessa base e demonstra que 97,8% é o máximo alcançável para o alvo.

## Reproduzir

```
pnpm score --only ceiling --jobs 1   # R 97.8, cov 99.2/97.3, P 100, 0 smells
```
