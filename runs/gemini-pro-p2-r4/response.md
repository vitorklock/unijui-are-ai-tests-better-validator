Create `tests/expression-parser.test.ts` with the following Vitest suite covering `parse`, `evaluate`, and `evaluateObject`:

```ts
import { describe, expect, it, vi } from 'vitest';
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

const RANGE_MIN = 10;
const RANGE_MAX = 20;
const DECIMAL_MIN = 1.5;
const DECIMAL_MAX = 3.5;

describe('parse', () => {
  describe('literals and identifiers', () => {
    it.each([
      { label: 'zero boundary digit', input: '0', expected: 0 },
      { label: 'nine boundary digit', input: '9', expected: 9 },
      { label: 'multi-digit integer', input: '42', expected: 42 },
      { label: 'decimal number', input: '3.14', expected: 3.14 },
      { label: 'leading-dot decimal', input: '.5', expected: 0.5 },
      { label: 'trailing-dot decimal', input: '5.', expected: 5 },
      { label: 'stops before a second decimal point', input: '1.2.3', expected: 1.2 },
    ])('parses $label ($input)', ({ input, expected }) => {
      expect(parse(input)).toEqual(new ValueExpression(expected));
    });

    it.each([
      { label: 'double-quoted string', input: '"hello"', expected: 'hello' },
      { label: 'single-quoted string', input: "'world'", expected: 'world' },
      { label: 'empty double-quoted string', input: '""', expected: '' },
      { label: 'empty single-quoted string', input: "''", expected: '' },
      { label: 'single quote inside double quotes', input: '"it\'s"', expected: "it's" },
      { label: 'double quote inside single quotes', input: '\'say "hi"\'', expected: 'say "hi"' },
      { label: 'unterminated string up to EOF', input: '"unterminated', expected: 'unterminated' },
    ])('parses $label', ({ input, expected }) => {
      expect(parse(input)).toEqual(new ValueExpression(expected));
    });

    it.each([
      { input: 'true', expected: true },
      { input: 'false', expected: false },
      { input: 'TRUE', expected: true },
      { input: 'False', expected: false },
    ])('parses boolean keyword $input', ({ input, expected }) => {
      expect(parse(input)).toEqual(new ValueExpression(expected));
    });

    it.each([
      { label: 'lowercase start boundary', input: 'a', expected: 'a' },
      { label: 'lowercase end boundary', input: 'z', expected: 'z' },
      { label: 'uppercase start boundary', input: 'A', expected: 'A' },
      { label: 'uppercase end boundary', input: 'Z', expected: 'Z' },
      { label: 'leading underscore', input: '_hidden', expected: '_hidden' },
      { label: 'mixed case with underscore', input: 'user_Name', expected: 'user_Name' },
      { label: 'stops before trailing digits', input: 'col1', expected: 'col' },
    ])('parses identifier with $label ($input)', ({ input, expected }) => {
      expect(parse(input)).toEqual(new IdentifierExpression(expected));
    });

    it('skips spaces, tabs, newlines, and carriage returns', () => {
      expect(parse(' \t\n\r 7 \t\n\r ')).toEqual(new ValueExpression(7));
    });

    it('parses adjacent tokens without separating whitespace', () => {
      expect(parse('1+2')).toEqual(
        new BinaryExpression(
          TokenType.Plus,
          new ValueExpression(1),
          new ValueExpression(2),
        ),
      );
    });
  });

  describe('operator precedence, associativity, and grouping', () => {
    it('unwraps parenthesized expressions', () => {
      expect(parse('(42)')).toEqual(new ValueExpression(42));
    });

    it('lets parentheses override operator precedence', () => {
      expect(parse('(2 + 3) * 4')).toEqual(
        new BinaryExpression(
          TokenType.Mul,
          new BinaryExpression(
            TokenType.Plus,
            new ValueExpression(2),
            new ValueExpression(3),
          ),
          new ValueExpression(4),
        ),
      );
    });

    it('gives multiplication higher precedence than addition', () => {
      expect(parse('1 + 2 * 3')).toEqual(
        new BinaryExpression(
          TokenType.Plus,
          new ValueExpression(1),
          new BinaryExpression(
            TokenType.Mul,
            new ValueExpression(2),
            new ValueExpression(3),
          ),
        ),
      );
    });

    it('gives division higher precedence than subtraction', () => {
      expect(parse('10 - 6 / 2')).toEqual(
        new BinaryExpression(
          TokenType.Minus,
          new ValueExpression(10),
          new BinaryExpression(
            TokenType.Div,
            new ValueExpression(6),
            new ValueExpression(2),
          ),
        ),
      );
    });

    it('gives function calls higher precedence than multiplication', () => {
      expect(parse("2 * length('ab')")).toEqual(
        new BinaryExpression(
          TokenType.Mul,
          new ValueExpression(2),
          new FunctionCallExpression('length', [new ValueExpression('ab')]),
        ),
      );
    });

    it('gives addition higher precedence than IS NULL', () => {
      expect(parse('x + 1 is null')).toEqual(
        new BinaryExpression(
          TokenType.Eq,
          new BinaryExpression(
            TokenType.Plus,
            new IdentifierExpression('x'),
            new ValueExpression(1),
          ),
          new ValueExpression(null),
        ),
      );
    });

    it('gives addition higher precedence than BETWEEN', () => {
      const leftExpr = new BinaryExpression(
        TokenType.Plus,
        new IdentifierExpression('x'),
        new ValueExpression(1),
      );

      expect(parse('x + 1 between 2 and 5')).toEqual(
        new BinaryExpression(
          TokenType.And,
          new BinaryExpression(TokenType.Gte, leftExpr, new ValueExpression(2)),
          new BinaryExpression(TokenType.Lte, leftExpr, new ValueExpression(5)),
        ),
      );
    });

    it('gives IS NULL higher precedence than equality', () => {
      expect(parse('false = x is null')).toEqual(
        new BinaryExpression(
          TokenType.Eq,
          new ValueExpression(false),
          new BinaryExpression(
            TokenType.Eq,
            new IdentifierExpression('x'),
            new ValueExpression(null),
          ),
        ),
      );
    });

    it('gives BETWEEN higher precedence than equality', () => {
      expect(parse('true = x between 1 and 5')).toEqual(
        new BinaryExpression(
          TokenType.Eq,
          new ValueExpression(true),
          new BinaryExpression(
            TokenType.And,
            new BinaryExpression(
              TokenType.Gte,
              new IdentifierExpression('x'),
              new ValueExpression(1),
            ),
            new BinaryExpression(
              TokenType.Lte,
              new IdentifierExpression('x'),
              new ValueExpression(5),
            ),
          ),
        ),
      );
    });

    it('gives relational comparisons higher precedence than equality', () => {
      expect(parse('true = 1 < 2')).toEqual(
        new BinaryExpression(
          TokenType.Eq,
          new ValueExpression(true),
          new BinaryExpression(
            TokenType.Lt,
            new ValueExpression(1),
            new ValueExpression(2),
          ),
        ),
      );
    });

    it('gives equality higher precedence than OR', () => {
      expect(parse('a = 1 or b = 2')).toEqual(
        new BinaryExpression(
          TokenType.Or,
          new BinaryExpression(
            TokenType.Eq,
            new IdentifierExpression('a'),
            new ValueExpression(1),
          ),
          new BinaryExpression(
            TokenType.Eq,
            new IdentifierExpression('b'),
            new ValueExpression(2),
          ),
        ),
      );
    });

    it('gives OR higher precedence than AND when AND appears first', () => {
      expect(parse('a and b or c')).toEqual(
        new BinaryExpression(
          TokenType.And,
          new IdentifierExpression('a'),
          new BinaryExpression(
            TokenType.Or,
            new IdentifierExpression('b'),
            new IdentifierExpression('c'),
          ),
        ),
      );
    });

    it('gives OR higher precedence than AND when OR appears first', () => {
      expect(parse('a or b and c')).toEqual(
        new BinaryExpression(
          TokenType.And,
          new BinaryExpression(
            TokenType.Or,
            new IdentifierExpression('a'),
            new IdentifierExpression('b'),
          ),
          new IdentifierExpression('c'),
        ),
      );
    });

    it('associates subtraction left-to-right', () => {
      expect(parse('10 - 3 - 2')).toEqual(
        new BinaryExpression(
          TokenType.Minus,
          new BinaryExpression(
            TokenType.Minus,
            new ValueExpression(10),
            new ValueExpression(3),
          ),
          new ValueExpression(2),
        ),
      );
    });

    it('associates division left-to-right', () => {
      expect(parse('24 / 6 / 2')).toEqual(
        new BinaryExpression(
          TokenType.Div,
          new BinaryExpression(
            TokenType.Div,
            new ValueExpression(24),
            new ValueExpression(6),
          ),
          new ValueExpression(2),
        ),
      );
    });

    it('associates equality and inequality left-to-right', () => {
      expect(parse('1 = 2 <> false')).toEqual(
        new BinaryExpression(
          TokenType.Neq,
          new BinaryExpression(
            TokenType.Eq,
            new ValueExpression(1),
            new ValueExpression(2),
          ),
          new ValueExpression(false),
        ),
      );
    });

    it('returns the left expression when encountering a token with precedence but no infix parser', () => {
      expect(parse('1 not 2')).toEqual(new ValueExpression(1));
    });
  });

  describe('special constructs', () => {
    it('desugars IS NULL into an equality check against null', () => {
      expect(parse('x is null')).toEqual(
        new BinaryExpression(
          TokenType.Eq,
          new IdentifierExpression('x'),
          new ValueExpression(null),
        ),
      );
    });

    it('desugars IS NOT NULL into an inequality check against null', () => {
      expect(parse('x IS NOT NULL')).toEqual(
        new BinaryExpression(
          TokenType.Neq,
          new IdentifierExpression('x'),
          new ValueExpression(null),
        ),
      );
    });

    it('desugars BETWEEN into an inclusive Gte AND Lte expression', () => {
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

    it('parses a zero-argument function call', () => {
      expect(parse('length()')).toEqual(new FunctionCallExpression('length', []));
    });

    it('parses a single-argument function call', () => {
      expect(parse("length('abc')")).toEqual(
        new FunctionCallExpression('length', [new ValueExpression('abc')]),
      );
    });

    it('parses a CASE expression without an ELSE branch', () => {
      expect(parse('case when a then 1 end')).toEqual(
        new CaseExpression(
          [{ when: new IdentifierExpression('a'), then: new ValueExpression(1) }],
          undefined,
        ),
      );
    });

    it('parses a CASE expression with multiple WHEN branches and an ELSE branch', () => {
      expect(parse('CASE WHEN a THEN 1 WHEN b THEN 2 ELSE 3 END')).toEqual(
        new CaseExpression(
          [
            { when: new IdentifierExpression('a'), then: new ValueExpression(1) },
            { when: new IdentifierExpression('b'), then: new ValueExpression(2) },
          ],
          new ValueExpression(3),
        ),
      );
    });
  });

  describe('syntax and lexer errors', () => {
    it.each([
      {
        label: 'empty input',
        input: '',
        expectedError: 'Unexpected start of expression: { type: EOF, literal: \0 } as position: 0.',
      },
      {
        label: 'whitespace-only input',
        input: '   ',
        expectedError: 'Unexpected start of expression: { type: EOF, literal: \0 } as position: 3.',
      },
      {
        label: 'unary plus',
        input: '+ 1',
        expectedError: 'Unexpected start of expression: { type: +, literal: + } as position: 0.',
      },
      {
        label: 'unary minus',
        input: '-5',
        expectedError: 'Unexpected start of expression: { type: -, literal: - } as position: 0.',
      },
      {
        label: 'prefix NOT keyword',
        input: 'not true',
        expectedError: 'Unexpected start of expression: { type: not, literal: not } as position: 0.',
      },
      {
        label: 'standalone NULL keyword',
        input: 'null',
        expectedError: 'Unexpected start of expression: { type: null, literal: null } as position: 0.',
      },
      {
        label: 'leading closing parenthesis',
        input: ')',
        expectedError: 'Unexpected start of expression: { type: ), literal: ) } as position: 0.',
      },
      {
        label: 'illegal character below uppercase A (@)',
        input: '@',
        expectedError: 'Unexpected start of expression: { type: ILLEGAL, literal: @ } as position: 0.',
      },
      {
        label: 'illegal character above uppercase Z ([)',
        input: '[',
        expectedError: 'Unexpected start of expression: { type: ILLEGAL, literal: [ } as position: 0.',
      },
      {
        label: 'illegal character below lowercase a (`)',
        input: '`',
        expectedError: 'Unexpected start of expression: { type: ILLEGAL, literal: ` } as position: 0.',
      },
      {
        label: 'illegal character above lowercase z ({)',
        input: '{',
        expectedError: 'Unexpected start of expression: { type: ILLEGAL, literal: { } as position: 0.',
      },
      {
        label: 'illegal character above digit 9 (:)',
        input: ':',
        expectedError: 'Unexpected start of expression: { type: ILLEGAL, literal: : } as position: 0.',
      },
      {
        label: 'illegal character as right operand',
        input: '1 + @',
        expectedError: 'Invalid input: { type: ILLEGAL, literal: @ } as position: 4.',
      },
      {
        label: 'illegal character inside parentheses',
        input: '(@)',
        expectedError: 'Invalid input: { type: ILLEGAL, literal: @ } as position: 1.',
      },
      {
        label: 'missing right operand',
        input: '1 +',
        expectedError: 'Unexpected start of expression: { type: EOF, literal: \0 } as position: 3.',
      },
      {
        label: 'unclosed parenthesized expression',
        input: '(1 + 2',
        expectedError: 'Expected ) but got { type: EOF, literal: \0 } as position: 6.',
      },
      {
        label: 'non-null operand after IS',
        input: 'x is 5',
        expectedError: 'Expected null but got { type: NUM, literal: 5 } as position: 5.',
      },
      {
        label: 'non-null operand after IS NOT',
        input: 'x is not 5',
        expectedError: 'Expected null but got { type: NUM, literal: 5 } as position: 9.',
      },
      {
        label: 'non-numeric lower bound in BETWEEN',
        input: 'x between "a" and 5',
        expectedError: 'Expected NUM but got { type: STR, literal: a } as position: 11.',
      },
      {
        label: 'missing AND in BETWEEN',
        input: 'x between 1 or 5',
        expectedError: 'Expected and but got { type: or, literal: or } as position: 12.',
      },
      {
        label: 'non-numeric upper bound in BETWEEN',
        input: 'x between 1 and "b"',
        expectedError: 'Expected NUM but got { type: STR, literal: b } as position: 17.',
      },
      {
        label: 'comma-separated second argument in function call',
        input: "foo('a', 'b')",
        expectedError: 'Unexpected start of expression: { type: ,, literal: , } as position: 7.',
      },
      {
        label: 'missing separator between function arguments',
        input: "foo('a' 'b')",
        expectedError: 'Expected , or ) got { type: STR, literal: b } as position: 9.',
      },
      {
        label: 'unclosed function call',
        input: "foo('a'",
        expectedError: 'Expected , or ) got { type: EOF, literal: \0 } as position: 7.',
      },
      {
        label: 'CASE immediately followed by ELSE',
        input: 'case else 1 end',
        expectedError: 'Expected when got { type: case, literal: case } as position: 0.',
      },
      {
        label: 'CASE immediately followed by END',
        input: 'case end',
        expectedError: 'Expected when got { type: case, literal: case } as position: 0.',
      },
      {
        label: 'missing THEN in CASE expression',
        input: 'case when true 1 end',
        expectedError: 'Expected then but got { type: NUM, literal: 1 } as position: 15.',
      },
      {
        label: 'unexpected token instead of subsequent WHEN in CASE expression',
        input: 'case when true then 1 2 end',
        expectedError: 'Expected when but got { type: NUM, literal: 2 } as position: 22.',
      },
      {
        label: 'missing END after ELSE in CASE expression',
        input: 'case when true then 1 else 2',
        expectedError: 'Expected end but got { type: EOF, literal: \0 } as position: 28.',
      },
    ])('throws on $label', ({ input, expectedError }) => {
      expect(() => parse(input)).toThrowError(expectedError);
    });
  });
});

describe('evaluate', () => {
  describe('arithmetic operations', () => {
    it.each([
      { label: 'adds integers', expr: '2 + 3', expected: 5 },
      { label: 'adds decimals', expr: '1.5 + 2.25', expected: 3.75 },
      { label: 'concatenates strings with +', expr: "'foo' + 'bar'", expected: 'foobar' },
      { label: 'subtracts to a positive result', expr: '10 - 4', expected: 6 },
      { label: 'subtracts to a negative result', expr: '3 - 8', expected: -5 },
      { label: 'multiplies integers', expr: '6 * 7', expected: 42 },
      { label: 'multiplies by zero', expr: '9 * 0', expected: 0 },
      { label: 'divides evenly', expr: '15 / 3', expected: 5 },
      { label: 'divides to a fractional value', expr: '5 / 2', expected: 2.5 },
      { label: 'divides by zero to Infinity', expr: '5 / 0', expected: Infinity },
      { label: 'applies multiplication before addition', expr: '2 + 3 * 4', expected: 14 },
      { label: 'applies grouping before multiplication', expr: '(2 + 3) * 4', expected: 20 },
      { label: 'applies division before subtraction', expr: '10 - 6 / 2', expected: 7 },
      { label: 'evaluates chained subtraction left-to-right', expr: '10 - 3 - 2', expected: 5 },
      { label: 'evaluates chained division left-to-right', expr: '24 / 6 / 2', expected: 2 },
      { label: 'evaluates nested parenthesized arithmetic', expr: '((1 + 2) * (3 + 4))', expected: 21 },
    ])('$label ($expr)', ({ expr, expected }) => {
      expect(evaluate(expr)).toBe(expected);
    });
  });

  describe('comparison operators', () => {
    it.each([
      { expr: '5 = 5', expected: true },
      { expr: '5 = 6', expected: false },
      { expr: "'abc' = 'abc'", expected: true },
      { expr: "'abc' = 'ABC'", expected: false },
      { expr: "'5' = 5", expected: false },
      { expr: 'true = true', expected: true },
      { expr: 'true = false', expected: false },
      { expr: '5 <> 6', expected: true },
      { expr: '5 <> 5', expected: false },
      { expr: "'5' <> 5", expected: true },
      { expr: '6 > 5', expected: true },
      { expr: '5 > 5', expected: false },
      { expr: '4 > 5', expected: false },
      { expr: '6 >= 5', expected: true },
      { expr: '5 >= 5', expected: true },
      { expr: '4 >= 5', expected: false },
      { expr: '4 < 5', expected: true },
      { expr: '5 < 5', expected: false },
      { expr: '6 < 5', expected: false },
      { expr: '4 <= 5', expected: true },
      { expr: '5 <= 5', expected: true },
      { expr: '6 <= 5', expected: false },
    ])('evaluates $expr to $expected', ({ expr, expected }) => {
      expect(evaluate(expr)).toBe(expected);
    });
  });

  describe('logical operators', () => {
    it.each([
      { expr: 'true and true', expected: true },
      { expr: 'true and false', expected: false },
      { expr: 'false and true', expected: false },
      { expr: 'false and false', expected: false },
      { expr: 'true or true', expected: true },
      { expr: 'true or false', expected: true },
      { expr: 'false or true', expected: true },
      { expr: 'false or false', expected: false },
      { expr: 'true AND false', expected: false },
      { expr: 'false OR true', expected: true },
      { expr: 'false and true or true', expected: false },
      { expr: 'true or false and false', expected: false },
      { expr: '(false and true) or true', expected: true },
    ])('evaluates $expr to $expected', ({ expr, expected }) => {
      expect(evaluate(expr)).toBe(expected);
    });

    it('short-circuits AND when the left operand is false', () => {
      const context = vi.fn(() => true);

      const result = evaluate('false and rhs', context);

      expect(result, 'AND with false LHS should return false').toBe(false);
      expect(context, 'RHS identifier should not be evaluated').not.toHaveBeenCalled();
    });

    it('short-circuits OR when the left operand is true', () => {
      const context = vi.fn(() => false);

      const result = evaluate('true or rhs', context);

      expect(result, 'OR with true LHS should return true').toBe(true);
      expect(context, 'RHS identifier should not be evaluated').not.toHaveBeenCalled();
    });
  });

  describe('BETWEEN operator', () => {
    const integerRangeExpr = `x between ${RANGE_MIN} and ${RANGE_MAX}`;
    const decimalRangeExpr = `x between ${DECIMAL_MIN} and ${DECIMAL_MAX}`;

    it.each([
      { label: 'just below lower bound', value: RANGE_MIN - 1, expected: false },
      { label: 'at lower bound', value: RANGE_MIN, expected: true },
      { label: 'inside range', value: (RANGE_MIN + RANGE_MAX) / 2, expected: true },
      { label: 'at upper bound', value: RANGE_MAX, expected: true },
      { label: 'just above upper bound', value: RANGE_MAX + 1, expected: false },
    ])('evaluates integer BETWEEN $label ($value)', ({ value, expected }) => {
      expect(evaluate(integerRangeExpr, () => value)).toBe(expected);
    });

    it.each([
      { label: 'just below decimal lower bound', value: 1.49, expected: false },
      { label: 'at decimal lower bound', value: DECIMAL_MIN, expected: true },
      { label: 'at decimal upper bound', value: DECIMAL_MAX, expected: true },
      { label: 'just above decimal upper bound', value: 3.51, expected: false },
    ])('evaluates decimal BETWEEN $label ($value)', ({ value, expected }) => {
      expect(evaluate(decimalRangeExpr, () => value)).toBe(expected);
    });

    it('evaluates an arithmetic expression as the left operand of BETWEEN', () => {
      const offset = 2;
      const expr = `x + ${offset} between ${RANGE_MIN} and ${RANGE_MAX}`;

      expect(evaluate(expr, () => RANGE_MIN - offset)).toBe(true);
    });

    it('returns false when the arithmetic left operand falls just below the BETWEEN lower bound', () => {
      const offset = 2;
      const expr = `x + ${offset} between ${RANGE_MIN} and ${RANGE_MAX}`;

      expect(evaluate(expr, () => RANGE_MIN - offset - 1)).toBe(false);
    });
  });

  describe('IS NULL and IS NOT NULL', () => {
    it.each([
      { label: 'null', value: null, expected: true },
      { label: 'undefined', value: undefined, expected: false },
      { label: 'zero', value: 0, expected: false },
      { label: 'empty string', value: '', expected: false },
      { label: 'false', value: false, expected: false },
    ])('evaluates IS NULL for $label to $expected', ({ value, expected }) => {
      expect(evaluate('x is null', () => value)).toBe(expected);
    });

    it.each([
      { label: 'null', value: null, expected: false },
      { label: 'undefined', value: undefined, expected: true },
      { label: 'zero', value: 0, expected: true },
      { label: 'empty string', value: '', expected: true },
      { label: 'non-empty string', value: 'text', expected: true },
    ])('evaluates IS NOT NULL for $label to $expected', ({ value, expected }) => {
      expect(evaluate('x is not null', () => value)).toBe(expected);
    });
  });

  describe('function calls', () => {
    it('returns the length of a non-empty string literal', () => {
      expect(evaluate("length('hello')")).toBe(5);
    });

    it('returns zero for an empty string literal', () => {
      expect(evaluate("length('')")).toBe(0);
    });

    it('evaluates an expression passed as the length argument', () => {
      expect(evaluate("length('ab' + 'cde')")).toBe(5);
    });

    it('returns the length of an array provided by context', () => {
      const items = [1, 2, 3];
      expect(evaluate('length(items)', () => items)).toBe(items.length);
    });

    it('throws when length is called with zero arguments', () => {
      expect(() => evaluate('length()')).toThrowError(
        'Length function takes exactly one argument.',
      );
    });

    it('throws for an unimplemented function name', () => {
      expect(() => evaluate("unknown('abc')")).toThrowError(
        'Function unknown not implemented',
      );
    });

    it('treats function names as case-sensitive', () => {
      expect(() => evaluate("LENGTH('abc')")).toThrowError(
        'Function LENGTH not implemented',
      );
    });
  });

  describe('CASE expressions', () => {
    const gradeExpr =
      "case when score >= 90 then 'A' when score >= 80 then 'B' else 'C' end";

    it('returns the first matching THEN branch', () => {
      expect(evaluate(gradeExpr, () => 90)).toBe('A');
    });

    it('returns a subsequent matching THEN branch when earlier conditions are false', () => {
      expect(evaluate(gradeExpr, () => 80)).toBe('B');
    });

    it('returns the ELSE branch when no WHEN condition matches', () => {
      expect(evaluate(gradeExpr, () => 79)).toBe('C');
    });

    it('returns false when no WHEN condition matches and no ELSE branch is present', () => {
      expect(evaluate("case when x > 0 then 'positive' end", () => 0)).toBe(false);
    });

    it('preserves falsy values returned by an ELSE branch instead of returning false', () => {
      expect(evaluate('case when false then 1 else 0 end')).toBe(0);
    });

    it('does not evaluate later WHEN or ELSE branches after a match', () => {
      const context = vi.fn((name: string) => name === 'first');

      const result = evaluate(
        "case when first then 'matched' when second then 'skipped' else fallback end",
        context,
      );

      expect(result, 'CASE should return the first matching branch').toBe('matched');
      expect(context, 'only the matched condition identifier should be resolved').toHaveBeenCalledTimes(1);
    });

    it('supports nested CASE expressions inside ELSE', () => {
      const nestedExpr =
        "case when score >= 90 then 'A' else case when score >= 80 then 'B' else 'C' end end";

      expect(evaluate(nestedExpr, () => 85)).toBe('B');
    });

    it('allows a CASE expression to participate in a surrounding binary expression', () => {
      const expr = 'case when active then 10 else 5 end + 2';

      expect(evaluate(expr, () => true)).toBe(12);
    });
  });

  describe('context callback', () => {
    it('resolves multiple identifiers through the context function', () => {
      const values: Record<string, number> = { left: 3, right: 4 };
      expect(evaluate('left + right', (name) => values[name])).toBe(7);
    });

    it('throws a TypeError when an identifier is evaluated without a context callback', () => {
      expect(() => evaluate('missing')).toThrowError(TypeError);
    });
  });
});

describe('evaluateObject', () => {
  const MIN_ADULT_AGE = 18;

  it('evaluates to true when an object satisfies a compound condition at its boundary', () => {
    expect(
      evaluateObject(`age >= ${MIN_ADULT_AGE} and active`, {
        age: MIN_ADULT_AGE,
        active: true,
      }),
    ).toBe(true);
  });

  it('evaluates to false when an object falls just below a numeric boundary', () => {
    expect(
      evaluateObject(`age >= ${MIN_ADULT_AGE} and active`, {
        age: MIN_ADULT_AGE - 1,
        active: true,
      }),
    ).toBe(false);
  });

  it('resolves object properties case-sensitively', () => {
    expect(evaluateObject('Name', { Name: 'Alice', name: 'Bob' })).toBe('Alice');
  });

  it('resolves missing object properties to undefined', () => {
    expect(evaluateObject('missing', {})).toBeUndefined();
  });

  it('evaluates a multi-clause SQL-like WHERE expression against an object', () => {
    const user = {
      role: 'member',
      status: 'active',
      score: 50,
      deletedAt: null,
    };

    const whereClause =
      "length(role) > 0 and status <> 'banned' and score between 50 and 100 and deletedAt is null";

    expect(evaluateObject(whereClause, user)).toBe(true);
  });
});

```

### Coverage & Edge-Case Notes

* **Lexer & Parser edge cases exercised:** all four whitespace characters (` `, `\t`, `\n`, `\r`), leading/trailing/multiple decimal points, single/double/nested/unterminated strings, ASCII boundaries around digits (`0`, `9`, `:`) and letters (`@`, `A`, `Z`, `[`, ```, `a`, `z`, `{`, `_`), case-insensitive keywords vs. case-sensitive identifiers/functions, and every reachable error branch with exact token-position verification.
* **Notable parser behaviors locked in by tests:**
* `OR` (precedence `2`) binds tighter than `AND` (precedence `1`) per `precedences` in `src/parser.ts`.
* `NOT` has precedence `3` without an infix parser, so `1 not 2` terminates infix parsing and returns `ValueExpression(1)`.
* `parseCallExpression` currently rejects comma-separated arguments (e.g., `foo('a', 'b')` throws `Unexpected start of expression` on `,`), while zero-argument `length()` reaches `evaluateFunctionCall` and throws the arity error.


* **Unreachable code in `src/`:** `UnaryExpression` in `src/ast.ts`, the post-`expectPeekToken` throw in `Parser.parseGroupedExpression`, and the `default` branches in `evaluateBinaryExpression` and `evaluateExpression` cannot be reached through `parse`, `evaluate`, or `evaluateObject`.