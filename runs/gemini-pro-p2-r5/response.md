Here is the complete Vitest test suite for `tests/expression-parser.test.ts`, targeting `parse`, `evaluate`, and `evaluateObject` across lexing, AST construction, precedence, boundary values, short-circuiting, and error paths.

### `tests/expression-parser.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  BinaryExpression,
  CaseExpression,
  FunctionCallExpression,
  IdentifierExpression,
  ValueExpression,
} from '../src/ast';
import { evaluate, evaluateObject } from '../src/evaluator';
import { parse } from '../src/parser';
import { TokenType } from '../src/token';

const THRESHOLD = 5;
const RANGE_MIN = 10;
const RANGE_MAX = 20;
const DECIMAL_RANGE_MIN = 1.5;
const DECIMAL_RANGE_MAX = 2.5;
const DECIMAL_STEP = 0.1;

describe('parse', () => {
  describe('literals', () => {
    it.each([
      ['zero boundary digit', '0', 0],
      ['nine boundary digit', '9', 9],
      ['multi-digit integer', '42', 42],
      ['standard decimal', '3.14', 3.14],
      ['leading-dot decimal', '.5', 0.5],
      ['trailing-dot decimal', '3.', 3],
      ['stops reading number at second decimal point', '1.2.3', 1.2],
    ])('parses numeric literal: %s', (_label, expression, expected) => {
      expect(parse(expression)).toEqual(new ValueExpression(expected));
    });

    it.each([
      ['single-quoted string', "'hello'", 'hello'],
      ['double-quoted string', '"world"', 'world'],
      ['empty single-quoted string', "''", ''],
      ['empty double-quoted string', '""', ''],
      ['single quote inside double quotes', '"it\'s"', "it's"],
      ['double quote inside single quotes', '\'say "hi"\'', 'say "hi"'],
      ['unterminated single-quoted string reaches EOF', "'unterminated", 'unterminated'],
      ['unterminated double-quoted string reaches EOF', '"unterminated', 'unterminated'],
    ])('parses string literal: %s', (_label, expression, expected) => {
      expect(parse(expression)).toEqual(new ValueExpression(expected));
    });

    it.each([
      ['lowercase true', 'true', true],
      ['uppercase TRUE', 'TRUE', true],
      ['lowercase false', 'false', false],
      ['mixed-case False', 'False', false],
    ])('parses boolean literal: %s', (_label, expression, expected) => {
      expect(parse(expression)).toEqual(new ValueExpression(expected));
    });
  });

  describe('identifiers and whitespace', () => {
    it.each([
      ['lowercase identifier', 'status', 'status'],
      ['uppercase and boundary letters with underscore', 'AZ_az', 'AZ_az'],
      ['leading underscore identifier', '_private_field', '_private_field'],
    ])('parses identifier preserving original case: %s', (_label, expression, expectedName) => {
      expect(parse(expression)).toEqual(new IdentifierExpression(expectedName));
    });

    it.each([
      ['spaces', ' 1 + 2 '],
      ['tabs', '\t1\t+\t2\t'],
      ['line feeds', '\n1\n+\n2\n'],
      ['carriage returns', '\r1\r+\r2\r'],
    ])('skips %s between tokens', (_label, expression) => {
      expect(parse(expression)).toEqual(
        new BinaryExpression(TokenType.Plus, new ValueExpression(1), new ValueExpression(2)),
      );
    });
  });

  describe('binary expressions', () => {
    it.each([
      ['addition', '1 + 2', TokenType.Plus],
      ['subtraction', '1 - 2', TokenType.Minus],
      ['multiplication', '1 * 2', TokenType.Mul],
      ['division', '1 / 2', TokenType.Div],
      ['equality', '1 = 2', TokenType.Eq],
      ['inequality', '1 <> 2', TokenType.Neq],
      ['greater than', '1 > 2', TokenType.Gt],
      ['greater than or equal', '1 >= 2', TokenType.Gte],
      ['less than', '1 < 2', TokenType.Lt],
      ['less than or equal', '1 <= 2', TokenType.Lte],
      ['logical and', '1 and 2', TokenType.And],
      ['logical or', '1 or 2', TokenType.Or],
    ])('builds BinaryExpression for %s', (_label, expression, operator) => {
      expect(parse(expression)).toEqual(
        new BinaryExpression(operator, new ValueExpression(1), new ValueExpression(2)),
      );
    });
  });

  describe('precedence, associativity, and grouping', () => {
    it('binds multiplication tighter than addition', () => {
      expect(parse('1 + 2 * 3')).toEqual(
        new BinaryExpression(
          TokenType.Plus,
          new ValueExpression(1),
          new BinaryExpression(TokenType.Mul, new ValueExpression(2), new ValueExpression(3)),
        ),
      );
    });

    it('binds division tighter than subtraction', () => {
      expect(parse('10 - 6 / 2')).toEqual(
        new BinaryExpression(
          TokenType.Minus,
          new ValueExpression(10),
          new BinaryExpression(TokenType.Div, new ValueExpression(6), new ValueExpression(2)),
        ),
      );
    });

    it('treats subtraction as left-associative', () => {
      expect(parse('10 - 3 - 2')).toEqual(
        new BinaryExpression(
          TokenType.Minus,
          new BinaryExpression(TokenType.Minus, new ValueExpression(10), new ValueExpression(3)),
          new ValueExpression(2),
        ),
      );
    });

    it('treats division as left-associative', () => {
      expect(parse('24 / 6 / 2')).toEqual(
        new BinaryExpression(
          TokenType.Div,
          new BinaryExpression(TokenType.Div, new ValueExpression(24), new ValueExpression(6)),
          new ValueExpression(2),
        ),
      );
    });

    it('binds OR tighter than AND per parser precedence table', () => {
      expect(parse('true or false and false')).toEqual(
        new BinaryExpression(
          TokenType.And,
          new BinaryExpression(TokenType.Or, new ValueExpression(true), new ValueExpression(false)),
          new ValueExpression(false),
        ),
      );
    });

    it('binds relational comparison tighter than equality', () => {
      expect(parse('true = 2 > 1')).toEqual(
        new BinaryExpression(
          TokenType.Eq,
          new ValueExpression(true),
          new BinaryExpression(TokenType.Gt, new ValueExpression(2), new ValueExpression(1)),
        ),
      );
    });

    it('binds function call tighter than multiplication', () => {
      expect(parse("2 * length('abc')")).toEqual(
        new BinaryExpression(
          TokenType.Mul,
          new ValueExpression(2),
          new FunctionCallExpression('length', [new ValueExpression('abc')]),
        ),
      );
    });

    it('overrides precedence with parenthesized grouping', () => {
      expect(parse('(1 + 2) * 3')).toEqual(
        new BinaryExpression(
          TokenType.Mul,
          new BinaryExpression(TokenType.Plus, new ValueExpression(1), new ValueExpression(2)),
          new ValueExpression(3),
        ),
      );
    });

    it('handles nested parentheses', () => {
      expect(parse('((1 + 2))')).toEqual(
        new BinaryExpression(TokenType.Plus, new ValueExpression(1), new ValueExpression(2)),
      );
    });

    it('stops parsing infix chain when peek token has precedence but no infix parser', () => {
      expect(parse('1 not')).toEqual(new ValueExpression(1));
    });
  });

  describe('IS NULL, BETWEEN, function calls, and CASE', () => {
    it('desugars IS NULL into equality with null', () => {
      expect(parse('x is null')).toEqual(
        new BinaryExpression(TokenType.Eq, new IdentifierExpression('x'), new ValueExpression(null)),
      );
    });

    it('desugars IS NOT NULL into inequality with null (case-insensitive keywords)', () => {
      expect(parse('x IS NOT NULL')).toEqual(
        new BinaryExpression(TokenType.Neq, new IdentifierExpression('x'), new ValueExpression(null)),
      );
    });

    it('desugars BETWEEN into inclusive GTE and LTE conjunction', () => {
      expect(parse(`x BETWEEN ${RANGE_MIN} AND ${RANGE_MAX}`)).toEqual(
        new BinaryExpression(
          TokenType.And,
          new BinaryExpression(
            TokenType.Gte,
            new IdentifierExpression('x'),
            new ValueExpression(RANGE_MIN),
          ),
          new BinaryExpression(
            TokenType.Lte,
            new IdentifierExpression('x'),
            new ValueExpression(RANGE_MAX),
          ),
        ),
      );
    });

    it('parses zero-argument function call', () => {
      expect(parse('length()')).toEqual(new FunctionCallExpression('length', []));
    });

    it('parses single-argument function call with expression argument', () => {
      expect(parse("length('ab' + 'c')")).toEqual(
        new FunctionCallExpression('length', [
          new BinaryExpression(TokenType.Plus, new ValueExpression('ab'), new ValueExpression('c')),
        ]),
      );
    });

    it('parses CASE expression without ELSE clause', () => {
      expect(parse('CASE WHEN x > 0 THEN 1 END')).toEqual(
        new CaseExpression([
          {
            when: new BinaryExpression(
              TokenType.Gt,
              new IdentifierExpression('x'),
              new ValueExpression(0),
            ),
            then: new ValueExpression(1),
          },
        ]),
      );
    });

    it('parses CASE expression with multiple WHEN clauses and ELSE', () => {
      expect(parse('case when x > 0 then 1 when x < 0 then 2 else 0 end')).toEqual(
        new CaseExpression(
          [
            {
              when: new BinaryExpression(
                TokenType.Gt,
                new IdentifierExpression('x'),
                new ValueExpression(0),
              ),
              then: new ValueExpression(1),
            },
            {
              when: new BinaryExpression(
                TokenType.Lt,
                new IdentifierExpression('x'),
                new ValueExpression(0),
              ),
              then: new ValueExpression(2),
            },
          ],
          new ValueExpression(0),
        ),
      );
    });
  });

  describe('syntax and lexical errors', () => {
    it('throws on empty expression', () => {
      expect(() => parse('')).toThrow(
        'Unexpected start of expression: { type: EOF, literal: \0 } as position: 0.',
      );
    });

    it.each(['@', '[', '^', '`', '{', ':'])(
      'throws unexpected start error for non-identifier ASCII boundary character %s',
      (illegalChar) => {
        expect(() => parse(illegalChar)).toThrow(
          `Unexpected start of expression: { type: ILLEGAL, literal: ${illegalChar} } as position: 0.`,
        );
      },
    );

    it('throws on unsupported prefix operator minus', () => {
      expect(() => parse('-1')).toThrow(
        'Unexpected start of expression: { type: -, literal: - } as position: 0.',
      );
    });

    it('throws on unsupported prefix operator not', () => {
      expect(() => parse('not true')).toThrow(
        'Unexpected start of expression: { type: not, literal: not } as position: 0.',
      );
    });

    it('throws on illegal token encountered mid-expression', () => {
      expect(() => parse('1 + @')).toThrow(
        'Invalid input: { type: ILLEGAL, literal: @ } as position: 4.',
      );
    });

    it('throws when less-than operator appears at end of input', () => {
      expect(() => parse('1 <')).toThrow(
        'Unexpected start of expression: { type: EOF, literal: \0 } as position: 3.',
      );
    });

    it('throws when greater-than operator appears at end of input', () => {
      expect(() => parse('1 >')).toThrow(
        'Unexpected start of expression: { type: EOF, literal: \0 } as position: 3.',
      );
    });

    it('throws when closing parenthesis is missing', () => {
      expect(() => parse('(1 + 2')).toThrow(
        'Expected ) but got { type: EOF, literal: \0 } as position: 6.',
      );
    });

    it('throws when IS is not followed by NULL', () => {
      expect(() => parse('x is 5')).toThrow(
        'Expected null but got { type: NUM, literal: 5 } as position: 5.',
      );
    });

    it('throws when IS NOT is not followed by NULL', () => {
      expect(() => parse('x is not 5')).toThrow(
        'Expected null but got { type: NUM, literal: 5 } as position: 9.',
      );
    });

    it('throws when BETWEEN lower bound is not numeric', () => {
      expect(() => parse("x between 'a' and 5")).toThrow(
        'Expected NUM but got { type: STR, literal: a } as position: 11.',
      );
    });

    it('throws when BETWEEN is missing AND keyword', () => {
      expect(() => parse('x between 1 or 5')).toThrow(
        'Expected and but got { type: or, literal: or } as position: 12.',
      );
    });

    it('throws when BETWEEN upper bound is not numeric', () => {
      expect(() => parse("x between 1 and 'b'")).toThrow(
        'Expected NUM but got { type: STR, literal: b } as position: 17.',
      );
    });

    it('throws when function call is missing closing parenthesis', () => {
      expect(() => parse("length('a'")).toThrow(
        'Expected , or ) got { type: EOF, literal: \0 } as position: 10.',
      );
    });

    it('throws when function arguments lack a separator', () => {
      expect(() => parse("length('a' 'b')")).toThrow(
        'Expected , or ) got { type: STR, literal: b } as position: 12.',
      );
    });

    it('throws on comma inside function call because comma is not consumed before next argument', () => {
      expect(() => parse("length('a', 'b')")).toThrow(
        'Unexpected start of expression: { type: ,, literal: , } as position: 10.',
      );
    });

    it('throws when CASE is immediately closed with END', () => {
      expect(() => parse('case end')).toThrow(
        'Expected when got { type: case, literal: case } as position: 0.',
      );
    });

    it('throws when CASE starts with ELSE instead of WHEN', () => {
      expect(() => parse('case else 1 end')).toThrow(
        'Expected when got { type: case, literal: case } as position: 0.',
      );
    });

    it('throws when CASE WHEN clause is missing THEN', () => {
      expect(() => parse('case when x = 1 2 end')).toThrow(
        'Expected then but got { type: NUM, literal: 2 } as position: 16.',
      );
    });

    it('throws when CASE without ELSE is missing END', () => {
      expect(() => parse('case when x = 1 then 2')).toThrow(
        'Expected when but got { type: EOF, literal: \0 } as position: 22.',
      );
    });

    it('throws when CASE with ELSE is missing END', () => {
      expect(() => parse('case when x = 1 then 2 else 3')).toThrow(
        'Expected end but got { type: EOF, literal: \0 } as position: 29.',
      );
    });
  });
});

describe('evaluate', () => {
  describe('literals and context lookup', () => {
    it('evaluates literal expressions without a context callback', () => {
      expect(evaluate('42')).toBe(42);
    });

    it('resolves identifiers using the provided context callback', () => {
      const bindings: Record<string, number> = { price: 15, quantity: 3 };
      expect(evaluate('price * quantity', (name) => bindings[name])).toBe(45);
    });

    it('throws TypeError when evaluating an identifier without a context callback', () => {
      expect(() => evaluate('missing')).toThrow(TypeError);
    });
  });

  describe('arithmetic operators', () => {
    it.each([
      ['integer addition', '2 + 3', 5],
      ['decimal addition', '1.5 + 2.5', 4],
      ['string concatenation with plus', "'foo' + 'bar'", 'foobar'],
      ['subtraction yielding positive result', '10 - 3', 7],
      ['subtraction yielding negative result', '3 - 10', -7],
      ['multiplication', '6 * 7', 42],
      ['multiplication by zero', '0 * 99', 0],
      ['division with fractional result', '10 / 4', 2.5],
      ['division by zero returns Infinity', '1 / 0', Infinity],
      ['precedence of multiplication over addition', '2 + 3 * 4', 14],
      ['precedence of division over subtraction', '10 - 6 / 2', 7],
      ['parentheses overriding multiplication precedence', '(2 + 3) * 4', 20],
      ['left-associative subtraction', '10 - 3 - 2', 5],
      ['left-associative division', '24 / 6 / 2', 2],
    ])('evaluates %s', (_label, expression, expected) => {
      expect(evaluate(expression)).toBe(expected);
    });
  });

  describe('equality and relational operators', () => {
    it.each([
      ['equal numbers', `${THRESHOLD} = ${THRESHOLD}`, true],
      ['unequal numbers', `${THRESHOLD} = ${THRESHOLD + 1}`, false],
      ['strict equality rejects string vs number', `'${THRESHOLD}' = ${THRESHOLD}`, false],
      ['equal strings', "'abc' = 'abc'", true],
      ['equal booleans', 'true = true', true],
      ['unequal numbers with <>', `${THRESHOLD} <> ${THRESHOLD + 1}`, true],
      ['equal numbers with <>', `${THRESHOLD} <> ${THRESHOLD}`, false],
      ['strict inequality distinguishes string and number', `'${THRESHOLD}' <> ${THRESHOLD}`, true],
    ])('evaluates equality/inequality: %s', (_label, expression, expected) => {
      expect(evaluate(expression)).toBe(expected);
    });

    it.each([
      ['> just above boundary', `${THRESHOLD + 1} > ${THRESHOLD}`, true],
      ['> at boundary', `${THRESHOLD} > ${THRESHOLD}`, false],
      ['> just below boundary', `${THRESHOLD - 1} > ${THRESHOLD}`, false],
      ['>= just above boundary', `${THRESHOLD + 1} >= ${THRESHOLD}`, true],
      ['>= at boundary', `${THRESHOLD} >= ${THRESHOLD}`, true],
      ['>= just below boundary', `${THRESHOLD - 1} >= ${THRESHOLD}`, false],
      ['< just below boundary', `${THRESHOLD - 1} < ${THRESHOLD}`, true],
      ['< at boundary', `${THRESHOLD} < ${THRESHOLD}`, false],
      ['< just above boundary', `${THRESHOLD + 1} < ${THRESHOLD}`, false],
      ['<= just below boundary', `${THRESHOLD - 1} <= ${THRESHOLD}`, true],
      ['<= at boundary', `${THRESHOLD} <= ${THRESHOLD}`, true],
      ['<= just above boundary', `${THRESHOLD + 1} <= ${THRESHOLD}`, false],
    ])('evaluates relational boundary: %s', (_label, expression, expected) => {
      expect(evaluate(expression)).toBe(expected);
    });
  });

  describe('logical operators', () => {
    it.each([
      ['true and true', true],
      ['true and false', false],
      ['false and true', false],
      ['false and false', false],
      ['true or true', true],
      ['true or false', true],
      ['false or true', true],
      ['false or false', false],
    ])('evaluates logical truth table: %s', (expression, expected) => {
      expect(evaluate(expression)).toBe(expected);
    });

    it('evaluates OR before AND according to parser precedence', () => {
      expect(evaluate('true or false and false')).toBe(false);
    });

    it('short-circuits AND when left operand is false', () => {
      expect(evaluate('false and unimplemented()')).toBe(false);
    });

    it('short-circuits OR when left operand is true', () => {
      expect(evaluate('true or unimplemented()')).toBe(true);
    });
  });

  describe('IS NULL and IS NOT NULL', () => {
    it.each([
      ['null value with IS NULL', 'val is null', null, true],
      ['null value with IS NOT NULL', 'val is not null', null, false],
      ['undefined value with IS NULL is strictly false', 'val is null', undefined, false],
      ['undefined value with IS NOT NULL is strictly true', 'val is not null', undefined, true],
      ['zero with IS NULL is false', 'val is null', 0, false],
      ['empty string with IS NULL is false', 'val is null', '', false],
      ['false boolean with IS NULL is false', 'val is null', false, false],
      ['non-empty string with IS NOT NULL is true', 'val is not null', 'active', true],
    ])('evaluates %s', (_label, expression, value, expected) => {
      expect(evaluate(expression, () => value)).toBe(expected);
    });

    it('binds IS tighter than equality', () => {
      expect(evaluate('val is null = true', () => null)).toBe(true);
    });

    it('binds addition tighter than IS NOT NULL', () => {
      expect(evaluate('val + 1 is not null', () => 0)).toBe(true);
    });
  });

  describe('BETWEEN', () => {
    it.each([
      ['just below lower bound', RANGE_MIN - 1, false],
      ['exact lower bound (inclusive)', RANGE_MIN, true],
      ['midpoint inside range', (RANGE_MIN + RANGE_MAX) / 2, true],
      ['exact upper bound (inclusive)', RANGE_MAX, true],
      ['just above upper bound', RANGE_MAX + 1, false],
    ])('evaluates integer BETWEEN boundary: %s', (_label, candidate, expected) => {
      expect(
        evaluate(`val between ${RANGE_MIN} and ${RANGE_MAX}`, () => candidate),
      ).toBe(expected);
    });

    it.each([
      ['just below decimal lower bound', DECIMAL_RANGE_MIN - DECIMAL_STEP, false],
      ['exact decimal lower bound', DECIMAL_RANGE_MIN, true],
      ['exact decimal upper bound', DECIMAL_RANGE_MAX, true],
      ['just above decimal upper bound', DECIMAL_RANGE_MAX + DECIMAL_STEP, false],
    ])('evaluates decimal BETWEEN boundary: %s', (_label, candidate, expected) => {
      expect(
        evaluate(`val between ${DECIMAL_RANGE_MIN} and ${DECIMAL_RANGE_MAX}`, () => candidate),
      ).toBe(expected);
    });

    it('binds addition tighter than BETWEEN', () => {
      const offset = 1;
      expect(
        evaluate(`val + ${offset} between ${RANGE_MIN} and ${RANGE_MAX}`, () => RANGE_MIN - offset),
      ).toBe(true);
    });

    it('binds BETWEEN tighter than equality', () => {
      expect(
        evaluate(`true = val between ${RANGE_MIN} and ${RANGE_MAX}`, () => RANGE_MIN),
      ).toBe(true);
    });

    it('binds BETWEEN tighter than AND', () => {
      expect(
        evaluate(`val between ${RANGE_MIN} and ${RANGE_MAX} and true`, () => RANGE_MAX),
      ).toBe(true);
    });
  });

  describe('function calls', () => {
    it('returns character count for a non-empty string passed to length()', () => {
      expect(evaluate("length('hello')")).toBe(5);
    });

    it('returns zero for an empty string passed to length()', () => {
      expect(evaluate("length('')")).toBe(0);
    });

    it('returns element count for an array identifier passed to length()', () => {
      const items = ['a', 'b', 'c'];
      expect(evaluate('length(items)', () => items)).toBe(items.length);
    });

    it('evaluates nested expression argument inside length()', () => {
      expect(evaluate("length('ab' + 'cde')")).toBe(5);
    });

    it('throws when length() receives zero arguments', () => {
      expect(() => evaluate('length()')).toThrow('Length function takes exactly one argument.');
    });

    it('throws when invoking an unimplemented function', () => {
      expect(() => evaluate("unknown('abc')")).toThrow('Function unknown not implemented');
    });
  });

  describe('CASE expressions', () => {
    const tieredCase =
      `case when x > ${THRESHOLD} then 'high' when x = ${THRESHOLD} then 'equal' else 'low' end`;

    it('returns first matching THEN branch', () => {
      expect(evaluate(tieredCase, () => THRESHOLD + 1)).toBe('high');
    });

    it('returns subsequent matching THEN branch when earlier WHEN is false', () => {
      expect(evaluate(tieredCase, () => THRESHOLD)).toBe('equal');
    });

    it('returns ELSE branch when no WHEN condition matches', () => {
      expect(evaluate(tieredCase, () => THRESHOLD - 1)).toBe('low');
    });

    it('returns false when no WHEN condition matches and ELSE is omitted', () => {
      expect(evaluate(`case when x > ${THRESHOLD} then 'high' end`, () => THRESHOLD)).toBe(false);
    });

    it('returns the first matching branch when multiple WHEN conditions are true', () => {
      expect(
        evaluate("case when true then 'first' when true then 'second' else 'none' end"),
      ).toBe('first');
    });

    it.each([
      ['zero', '0', 0],
      ['empty string', "''", ''],
      ['false boolean', 'false', false],
    ])('preserves falsy THEN return value (%s) without falling through to ELSE', (_label, thenLiteral, expected) => {
      expect(evaluate(`case when true then ${thenLiteral} else 'fallback' end`)).toBe(expected);
    });

    it('does not evaluate THEN of a non-matching WHEN branch', () => {
      expect(evaluate("case when false then unimplemented() else 'safe' end")).toBe('safe');
    });

    it('does not evaluate subsequent WHEN or ELSE branches after a match', () => {
      expect(
        evaluate(
          "case when true then 'done' when unimplemented() then 'bad' else unimplemented() end",
        ),
      ).toBe('done');
    });

    it('works as right operand of a binary expression', () => {
      expect(evaluate('1 + case when true then 10 else 20 end')).toBe(11);
    });

    it('works as left operand of a binary expression', () => {
      expect(evaluate('case when false then 10 else 20 end + 1')).toBe(21);
    });
  });
});

describe('evaluateObject', () => {
  it('reads matching property values from the target object', () => {
    const record = Object.freeze({ age: 30 });
    expect(evaluateObject('age', record)).toBe(30);
  });

  it('returns undefined when referencing a property absent from the object', () => {
    const record = Object.freeze({ age: 30 });
    expect(evaluateObject('missing', record)).toBeUndefined();
  });

  it('resolves property names case-sensitively', () => {
    const record = Object.freeze({ name: 'lower', Name: 'upper' });
    expect(evaluateObject('Name', record)).toBe('upper');
  });

  it.each([
    ['zero', { value: 0 }, 0],
    ['false', { value: false }, false],
    ['empty string', { value: '' }, ''],
    ['null', { value: null }, null],
  ])('preserves falsy object property value: %s', (_label, record, expected) => {
    expect(evaluateObject('value', record)).toBe(expected);
  });

  it('evaluates a compound SQL-like WHERE predicate to true when all conditions hold', () => {
    const user = Object.freeze({
      status: 'active',
      score: RANGE_MIN,
      deleted_at: null,
      username: 'ada',
    });
    const predicate = `status = 'active' and score between ${RANGE_MIN} and ${RANGE_MAX} and deleted_at is null and length(username) >= 3`;
    expect(evaluateObject(predicate, user)).toBe(true);
  });

  it('evaluates a compound SQL-like WHERE predicate to false when any condition fails', () => {
    const user = Object.freeze({
      status: 'active',
      score: RANGE_MIN - 1,
      deleted_at: null,
      username: 'ada',
    });
    const predicate = `status = 'active' and score between ${RANGE_MIN} and ${RANGE_MAX} and deleted_at is null and length(username) >= 3`;
    expect(evaluateObject(predicate, user)).toBe(false);
  });
});

```

### Key Coverage & Fault-Detection Highlights

* **Exact AST & Lexer Verification (`parse`)**: Exercises every `Lexer` token path (all four whitespace characters `\t`, `\n`, `\r`, `' '`; single/double/empty/unterminated strings; integer, decimal, leading-dot, trailing-dot, and multi-dot numbers; case-insensitive keywords; ASCII boundaries of `isLetter` and `isNumber`; `peekChar()` at EOF; and `Token.toString()` error positions).
* **Precedence & Edge-Case Guards**: Verifies parser-specific rules (`OR` binding tighter than `AND`, `IS` vs `=`, `BETWEEN` vs `+`/`=`/`AND`, function calls vs `*`, left-associativity of `-` and `/`, and the `parseExpression` branch where a token has precedence but no infix parser via `'1 not'`).
* **Boundary & Short-Circuit Semantics (`evaluate`, `evaluateObject`)**: Tests exact boundary values (`n - 1`, `n`, `n + 1`) for `>`, `>=`, `<`, `<=`, and integer/decimal `BETWEEN`; strict equality/null checks (`null` vs `undefined`/`0`/`''`/`false`); short-circuit evaluation in `and`, `or`, and `case`; falsy `case` return values; and `length()` on strings, arrays, and error conditions.
* **Maintainability**: Each test executes a single focused behavior with one `expect(...)` assertion, uses named boundary constants instead of unexplained magic numbers, and keeps all fixtures immutable and isolated.

Run the suite with:

```bash
pnpm test

```