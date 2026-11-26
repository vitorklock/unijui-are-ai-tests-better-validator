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

describe('parse', () => {
  describe('literals and identifiers', () => {
    it('parses an integer literal into a ValueExpression', () => {
      expect(parse('42')).toEqual(new ValueExpression(42));
    });

    it('parses boundary digit characters 0 and 9', () => {
      expect(parse('09')).toEqual(new ValueExpression(9));
    });

    it('parses a decimal literal', () => {
      expect(parse('3.14')).toEqual(new ValueExpression(3.14));
    });

    it('parses a decimal literal with a leading dot', () => {
      expect(parse('.5')).toEqual(new ValueExpression(0.5));
    });

    it('stops reading a number at a second decimal point', () => {
      expect(parse('1.2.3')).toEqual(new ValueExpression(1.2));
    });

    it('parses a single-quoted string literal', () => {
      expect(parse("'hello'")).toEqual(new ValueExpression('hello'));
    });

    it('parses a double-quoted string literal', () => {
      expect(parse('"world"')).toEqual(new ValueExpression('world'));
    });

    it('parses an empty string literal', () => {
      expect(parse("''")).toEqual(new ValueExpression(''));
    });

    it('preserves opposite quotes inside a string literal', () => {
      expect(parse('"it\'s"')).toEqual(new ValueExpression("it's"));
    });

    it('reads an unterminated string literal until EOF', () => {
      expect(parse("'unterminated")).toEqual(new ValueExpression('unterminated'));
    });

    it('parses boolean true literal', () => {
      expect(parse('true')).toEqual(new ValueExpression(true));
    });

    it('parses boolean false literal', () => {
      expect(parse('false')).toEqual(new ValueExpression(false));
    });

    it('parses an identifier with uppercase, lowercase, and underscore boundary characters', () => {
      expect(parse('_AZ_az')).toEqual(new IdentifierExpression('_AZ_az'));
    });

    it('skips spaces, tabs, newlines, and carriage returns', () => {
      expect(parse(' \t\r\n 1 \t+\n 2 \r ')).toEqual(
        new BinaryExpression(
          TokenType.Plus,
          new ValueExpression(1),
          new ValueExpression(2),
        ),
      );
    });

    it('recognizes keywords case-insensitively', () => {
      expect(parse('TRUE AnD FaLsE')).toEqual(
        new BinaryExpression(
          TokenType.And,
          new ValueExpression(true),
          new ValueExpression(false),
        ),
      );
    });
  });

  describe('structured AST nodes', () => {
    it('desugars IS NULL into an equality comparison with null', () => {
      expect(parse('status IS NULL')).toEqual(
        new BinaryExpression(
          TokenType.Eq,
          new IdentifierExpression('status'),
          new ValueExpression(null),
        ),
      );
    });

    it('desugars IS NOT NULL into an inequality comparison with null', () => {
      expect(parse('status is not null')).toEqual(
        new BinaryExpression(
          TokenType.Neq,
          new IdentifierExpression('status'),
          new ValueExpression(null),
        ),
      );
    });

    it('desugars BETWEEN into inclusive GTE and LTE bounds joined by AND', () => {
      expect(parse('age between 18 and 65')).toEqual(
        new BinaryExpression(
          TokenType.And,
          new BinaryExpression(
            TokenType.Gte,
            new IdentifierExpression('age'),
            new ValueExpression(18),
          ),
          new BinaryExpression(
            TokenType.Lte,
            new IdentifierExpression('age'),
            new ValueExpression(65),
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

    it('parses a CASE expression with multiple WHEN branches and an ELSE branch', () => {
      expect(parse('case when a = 1 then 10 when a = 2 then 20 else 30 end')).toEqual(
        new CaseExpression(
          [
            {
              when: new BinaryExpression(
                TokenType.Eq,
                new IdentifierExpression('a'),
                new ValueExpression(1),
              ),
              then: new ValueExpression(10),
            },
            {
              when: new BinaryExpression(
                TokenType.Eq,
                new IdentifierExpression('a'),
                new ValueExpression(2),
              ),
              then: new ValueExpression(20),
            },
          ],
          new ValueExpression(30),
        ),
      );
    });

    it('parses a CASE expression without an ELSE branch', () => {
      expect(parse('CASE WHEN true THEN 1 END')).toEqual(
        new CaseExpression(
          [{ when: new ValueExpression(true), then: new ValueExpression(1) }],
          undefined,
        ),
      );
    });
  });

  describe('operator precedence and associativity', () => {
    it('binds multiplication tighter than addition', () => {
      expect(parse('2 + 3 * 4')).toEqual(
        new BinaryExpression(
          TokenType.Plus,
          new ValueExpression(2),
          new BinaryExpression(
            TokenType.Mul,
            new ValueExpression(3),
            new ValueExpression(4),
          ),
        ),
      );
    });

    it('overrides default precedence with parentheses', () => {
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
      expect(parse('12 / 4 / 3')).toEqual(
        new BinaryExpression(
          TokenType.Div,
          new BinaryExpression(
            TokenType.Div,
            new ValueExpression(12),
            new ValueExpression(4),
          ),
          new ValueExpression(3),
        ),
      );
    });

    it('binds relational comparison tighter than equality', () => {
      expect(parse('1 < 2 = true')).toEqual(
        new BinaryExpression(
          TokenType.Eq,
          new BinaryExpression(
            TokenType.Lt,
            new ValueExpression(1),
            new ValueExpression(2),
          ),
          new ValueExpression(true),
        ),
      );
    });

    it('binds OR tighter than AND according to the parser precedence table', () => {
      expect(parse('true or false and false')).toEqual(
        new BinaryExpression(
          TokenType.And,
          new BinaryExpression(
            TokenType.Or,
            new ValueExpression(true),
            new ValueExpression(false),
          ),
          new ValueExpression(false),
        ),
      );
    });

    it('binds IS NULL tighter than equality', () => {
      expect(parse('x is null = true')).toEqual(
        new BinaryExpression(
          TokenType.Eq,
          new BinaryExpression(
            TokenType.Eq,
            new IdentifierExpression('x'),
            new ValueExpression(null),
          ),
          new ValueExpression(true),
        ),
      );
    });

    it('binds BETWEEN tighter than equality', () => {
      expect(parse('x between 1 and 5 = true')).toEqual(
        new BinaryExpression(
          TokenType.Eq,
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
          new ValueExpression(true),
        ),
      );
    });

    it('stops parsing when a peek token has precedence but no infix parser', () => {
      expect(parse('1 not 2')).toEqual(new ValueExpression(1));
    });
  });

  describe('syntax and lexer errors', () => {
    it('throws on an empty expression', () => {
      expect(() => parse('')).toThrow(
        'Unexpected start of expression: { type: EOF, literal: \0 } as position: 0.',
      );
    });

    it('throws when an illegal character starts an expression', () => {
      expect(() => parse('@')).toThrow(
        'Unexpected start of expression: { type: ILLEGAL, literal: @ } as position: 0.',
      );
    });

    it('throws with exact token position when an illegal character appears mid-expression', () => {
      expect(() => parse('1 + @')).toThrow(
        'Invalid input: { type: ILLEGAL, literal: @ } as position: 4.',
      );
    });

    it('throws when a grouped expression is missing its closing parenthesis', () => {
      expect(() => parse('(1 + 2')).toThrow(
        'Expected ) but got { type: EOF, literal: \0 } as position: 6.',
      );
    });

    it('throws when IS is not followed by NULL', () => {
      expect(() => parse('x is 1')).toThrow(
        'Expected null but got { type: NUM, literal: 1 } as position: 5.',
      );
    });

    it('throws when IS NOT is not followed by NULL', () => {
      expect(() => parse('x is not 1')).toThrow(
        'Expected null but got { type: NUM, literal: 1 } as position: 9.',
      );
    });

    it('throws when BETWEEN lower bound is not numeric', () => {
      expect(() => parse("x between 'a' and 5")).toThrow(
        'Expected NUM but got { type: STR, literal: a } as position: 11.',
      );
    });

    it('throws when BETWEEN is missing AND between bounds', () => {
      expect(() => parse('x between 1 or 5')).toThrow(
        'Expected and but got { type: or, literal: or } as position: 12.',
      );
    });

    it('throws when BETWEEN upper bound is not numeric', () => {
      expect(() => parse('x between 1 and y')).toThrow(
        'Expected NUM but got { type: IDENT, literal: y } as position: 16.',
      );
    });

    it('throws when a function call argument is not followed by comma or closing parenthesis', () => {
      expect(() => parse('length(1 2)')).toThrow(
        'Expected , or ) got { type: NUM, literal: 2 } as position: 9.',
      );
    });

    it('throws when CASE is not immediately followed by WHEN', () => {
      expect(() => parse('case end')).toThrow(
        'Expected when got { type: case, literal: case } as position: 0.',
      );
    });

    it('throws when CASE WHEN is missing THEN', () => {
      expect(() => parse('case when true 1 end')).toThrow(
        'Expected then but got { type: NUM, literal: 1 } as position: 15.',
      );
    });

    it('throws when CASE is missing END', () => {
      expect(() => parse('case when true then 1')).toThrow(
        'Expected end but got { type: EOF, literal: \0 } as position: 21.',
      );
    });
  });
});

describe('evaluate', () => {
  describe('arithmetic operations', () => {
    it('adds two numbers', () => {
      expect(evaluate('7 + 5')).toBe(12);
    });

    it('concatenates two strings with +', () => {
      expect(evaluate("'foo' + 'bar'")).toBe('foobar');
    });

    it('subtracts two numbers producing a negative result', () => {
      expect(evaluate('3 - 5')).toBe(-2);
    });

    it('multiplies two numbers', () => {
      expect(evaluate('6 * 7')).toBe(42);
    });

    it('divides two numbers preserving fractional precision', () => {
      expect(evaluate('5 / 2')).toBe(2.5);
    });

    it('evaluates arithmetic precedence and left-associativity accurately', () => {
      expect(evaluate('20 - 12 / 3 - 2 * 3')).toBe(10);
    });

    it('evaluates nested parenthesized expressions', () => {
      expect(evaluate('((2 + 3) * (10 - 6)) / 4')).toBe(5);
    });
  });

  describe('equality and inequality', () => {
    it.each([
      { expr: '5 = 5', expected: true },
      { expr: '5 = 6', expected: false },
      { expr: "'5' = 5", expected: false },
      { expr: '5 <> 6', expected: true },
      { expr: '5 <> 5', expected: false },
      { expr: "'5' <> 5", expected: true },
    ])('evaluates $expr to $expected', ({ expr, expected }) => {
      expect(evaluate(expr)).toBe(expected);
    });
  });

  describe('relational boundary comparisons', () => {
    it.each([
      { expr: '4 > 5', expected: false },
      { expr: '5 > 5', expected: false },
      { expr: '6 > 5', expected: true },
      { expr: '4 >= 5', expected: false },
      { expr: '5 >= 5', expected: true },
      { expr: '6 >= 5', expected: true },
      { expr: '4 < 5', expected: true },
      { expr: '5 < 5', expected: false },
      { expr: '6 < 5', expected: false },
      { expr: '4 <= 5', expected: true },
      { expr: '5 <= 5', expected: true },
      { expr: '6 <= 5', expected: false },
    ])('evaluates boundary comparison $expr to $expected', ({ expr, expected }) => {
      expect(evaluate(expr)).toBe(expected);
    });
  });

  describe('BETWEEN boundary checks', () => {
    const min = 10;
    const max = 20;

    it.each([
      { label: 'just below lower bound', value: min - 1, expected: false },
      { label: 'equal to lower bound', value: min, expected: true },
      { label: 'inside range', value: 15, expected: true },
      { label: 'equal to upper bound', value: max, expected: true },
      { label: 'just above upper bound', value: max + 1, expected: false },
    ])('returns $expected when value is $label', ({ value, expected }) => {
      expect(evaluate(`x between ${min} and ${max}`, () => value)).toBe(expected);
    });
  });

  describe('IS NULL and IS NOT NULL', () => {
    it.each([
      { expr: 'x is null', value: null, expected: true },
      { expr: 'x is null', value: undefined, expected: false },
      { expr: 'x is null', value: 0, expected: false },
      { expr: 'x is not null', value: null, expected: false },
      { expr: 'x is not null', value: 0, expected: true },
      { expr: 'x is not null', value: '', expected: true },
    ])('evaluates $expr for $value to $expected', ({ expr, value, expected }) => {
      expect(evaluate(expr, () => value)).toBe(expected);
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
    ])('evaluates $expr to $expected', ({ expr, expected }) => {
      expect(evaluate(expr)).toBe(expected);
    });

    it('short-circuits AND when the left operand is false', () => {
      expect(evaluate('false and unimplemented()')).toBe(false);
    });

    it('short-circuits OR when the left operand is true', () => {
      expect(evaluate('true or unimplemented()')).toBe(true);
    });

    it('evaluates OR before AND when unparenthesized', () => {
      expect(evaluate('true or false and false')).toBe(false);
    });
  });

  describe('CASE expressions', () => {
    it('returns the THEN value of the first matching WHEN branch', () => {
      expect(evaluate('case when true then 1 when true then 2 else 3 end')).toBe(1);
    });

    it('evaluates subsequent WHEN branches when earlier ones are false', () => {
      expect(evaluate('case when false then 1 when true then 2 else 3 end')).toBe(2);
    });

    it('returns the ELSE value when no WHEN branch matches', () => {
      expect(evaluate('case when false then 1 else 0 end')).toBe(0);
    });

    it('returns false when no WHEN branch matches and no ELSE branch exists', () => {
      expect(evaluate('case when false then 1 end')).toBe(false);
    });

    it('does not evaluate unreached THEN or ELSE branches', () => {
      expect(
        evaluate('case when true then 42 when unimplemented() then 1 else unimplemented() end'),
      ).toBe(42);
    });
  });

  describe('function calls', () => {
    it('computes the length of a non-empty string', () => {
      expect(evaluate("length('vitest')")).toBe(6);
    });

    it('computes the length of an empty string as 0', () => {
      expect(evaluate("length('')")).toBe(0);
    });

    it('computes the length of an array resolved from context', () => {
      expect(evaluate('length(items)', () => ['a', 'b', 'c'])).toBe(3);
    });

    it('throws when length is called with zero arguments', () => {
      expect(() => evaluate('length()')).toThrow(
        'Length function takes exactly one argument.',
      );
    });

    it('throws when calling an unimplemented function', () => {
      expect(() => evaluate('unknown(1)')).toThrow('Function unknown not implemented');
    });
  });

  describe('custom context callback', () => {
    it('passes exact identifier names to the context resolver', () => {
      const lookup: Record<string, number> = { basePrice: 100, discount: 15 };
      expect(evaluate('basePrice - discount', (name) => lookup[name])).toBe(85);
    });
  });
});

describe('evaluateObject', () => {
  it('resolves identifiers as properties on the provided object', () => {
    const user = { age: 25, role: 'admin', active: true };
    expect(evaluateObject("age >= 21 and role = 'admin' and active = true", user)).toBe(true);
  });

  it('evaluates function calls against object properties', () => {
    const record = { username: 'alice' };
    expect(evaluateObject('length(username) = 5', record)).toBe(true);
  });

  it('evaluates IS NULL against an explicit null property', () => {
    const record = { deletedAt: null };
    expect(evaluateObject('deletedAt is null', record)).toBe(true);
  });

  it('evaluates a CASE expression over object fields', () => {
    const order = { total: 150 };
    const expr = "case when total >= 200 then 'gold' when total >= 100 then 'silver' else 'standard' end";
    expect(evaluateObject(expr, order)).toBe('silver');
  });
});

