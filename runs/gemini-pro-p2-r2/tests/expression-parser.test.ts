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

describe('parse', () => {
  describe('literals and identifiers', () => {
    it.each([
      { expr: '0', expected: 0 },
      { expr: '9', expected: 9 },
      { expr: '42', expected: 42 },
      { expr: '3.14', expected: 3.14 },
      { expr: '.5', expected: 0.5 },
      { expr: '1.2.3', expected: 1.2 },
    ])('parses numeric literal "$expr" as ValueExpression($expected)', ({ expr, expected }) => {
      expect(parse(expr)).toEqual(new ValueExpression(expected));
    });

    it.each([
      { expr: "'hello'", expected: 'hello' },
      { expr: '"world"', expected: 'world' },
      { expr: "''", expected: '' },
      { expr: '""', expected: '' },
      { expr: `"it's"`, expected: "it's" },
      { expr: `'say "hi"'`, expected: 'say "hi"' },
      { expr: '"unterminated', expected: 'unterminated' },
    ])('parses string literal $expr as ValueExpression', ({ expr, expected }) => {
      expect(parse(expr)).toEqual(new ValueExpression(expected));
    });

    it.each([
      { expr: 'true', expected: true },
      { expr: 'TRUE', expected: true },
      { expr: 'True', expected: true },
      { expr: 'false', expected: false },
      { expr: 'FALSE', expected: false },
      { expr: 'False', expected: false },
    ])('parses boolean keyword "$expr" case-insensitively', ({ expr, expected }) => {
      expect(parse(expr)).toEqual(new ValueExpression(expected));
    });

    it.each(['a', 'z', 'A', 'Z', '_', 'AZ_az', 'user_name'])(
      'parses valid identifier "%s" as IdentifierExpression',
      (name) => {
        expect(parse(name)).toEqual(new IdentifierExpression(name));
      },
    );

    it('skips spaces, tabs, carriage returns, and newlines around tokens', () => {
      const ast = parse(' \t\r\n 1 \t + \r\n 2 \t ');
      expect(ast).toEqual(
        new BinaryExpression(TokenType.Plus, new ValueExpression(1), new ValueExpression(2)),
      );
    });
  });

  describe('AST structure for compound expressions', () => {
    it('parses "is null" into an equality BinaryExpression with null', () => {
      expect(parse('field is null')).toEqual(
        new BinaryExpression(
          TokenType.Eq,
          new IdentifierExpression('field'),
          new ValueExpression(null),
        ),
      );
    });

    it('parses "is not null" into an inequality BinaryExpression with null', () => {
      expect(parse('field IS NOT NULL')).toEqual(
        new BinaryExpression(
          TokenType.Neq,
          new IdentifierExpression('field'),
          new ValueExpression(null),
        ),
      );
    });

    it('desugars "between" into an inclusive >= and <= BinaryExpression', () => {
      expect(parse('age BETWEEN 18 AND 65')).toEqual(
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
      expect(parse('length(name)')).toEqual(
        new FunctionCallExpression('length', [new IdentifierExpression('name')]),
      );
    });

    it('parses a CASE expression with multiple WHEN branches and an ELSE branch', () => {
      const ast = parse('CASE WHEN x = 1 THEN "one" WHEN x = 2 THEN "two" ELSE "other" END');
      expect(ast).toEqual(
        new CaseExpression(
          [
            {
              when: new BinaryExpression(
                TokenType.Eq,
                new IdentifierExpression('x'),
                new ValueExpression(1),
              ),
              then: new ValueExpression('one'),
            },
            {
              when: new BinaryExpression(
                TokenType.Eq,
                new IdentifierExpression('x'),
                new ValueExpression(2),
              ),
              then: new ValueExpression('two'),
            },
          ],
          new ValueExpression('other'),
        ),
      );
    });

    it('parses a CASE expression without an ELSE branch with undefined last', () => {
      const ast = parse('case when true then 1 end');
      expect(ast).toEqual(
        new CaseExpression(
          [{ when: new ValueExpression(true), then: new ValueExpression(1) }],
          undefined,
        ),
      );
    });

    it('stops parsing infix chain when peek token has precedence but no infix parser', () => {
      expect(parse('1 not')).toEqual(new ValueExpression(1));
    });
  });

  describe('operator precedence and associativity', () => {
    it('gives multiplication higher precedence than addition', () => {
      expect(parse('1 + 2 * 3')).toEqual(
        new BinaryExpression(
          TokenType.Plus,
          new ValueExpression(1),
          new BinaryExpression(TokenType.Mul, new ValueExpression(2), new ValueExpression(3)),
        ),
      );
    });

    it('allows parentheses to override operator precedence', () => {
      expect(parse('(1 + 2) * 3')).toEqual(
        new BinaryExpression(
          TokenType.Mul,
          new BinaryExpression(TokenType.Plus, new ValueExpression(1), new ValueExpression(2)),
          new ValueExpression(3),
        ),
      );
    });

    it('parses subtraction left-associatively', () => {
      expect(parse('10 - 3 - 2')).toEqual(
        new BinaryExpression(
          TokenType.Minus,
          new BinaryExpression(TokenType.Minus, new ValueExpression(10), new ValueExpression(3)),
          new ValueExpression(2),
        ),
      );
    });

    it('parses division left-associatively', () => {
      expect(parse('24 / 6 / 2')).toEqual(
        new BinaryExpression(
          TokenType.Div,
          new BinaryExpression(TokenType.Div, new ValueExpression(24), new ValueExpression(6)),
          new ValueExpression(2),
        ),
      );
    });

    it('gives OR higher precedence than AND', () => {
      expect(parse('false and false or true')).toEqual(
        new BinaryExpression(
          TokenType.And,
          new ValueExpression(false),
          new BinaryExpression(TokenType.Or, new ValueExpression(false), new ValueExpression(true)),
        ),
      );
    });

    it('gives relational operators higher precedence than equality', () => {
      expect(parse('true = 1 < 2')).toEqual(
        new BinaryExpression(
          TokenType.Eq,
          new ValueExpression(true),
          new BinaryExpression(TokenType.Lt, new ValueExpression(1), new ValueExpression(2)),
        ),
      );
    });

    it('gives addition higher precedence than IS NULL', () => {
      expect(parse('1 + 2 is null')).toEqual(
        new BinaryExpression(
          TokenType.Eq,
          new BinaryExpression(TokenType.Plus, new ValueExpression(1), new ValueExpression(2)),
          new ValueExpression(null),
        ),
      );
    });
  });

  describe('syntax and lexing errors', () => {
    it('throws on empty input with EOF token details', () => {
      expect(() => parse('')).toThrow(
        'Unexpected start of expression: { type: EOF, literal: \0 } as position: 0.',
      );
    });

    it('throws on unexpected prefix operator', () => {
      expect(() => parse('+ 1')).toThrow(
        'Unexpected start of expression: { type: +, literal: + } as position: 0.',
      );
    });

    it('throws on illegal character at start of expression', () => {
      expect(() => parse('@')).toThrow(
        'Unexpected start of expression: { type: ILLEGAL, literal: @ } as position: 0.',
      );
    });

    it.each(['@', '[', '`', '{', ':'])(
      'throws Invalid input for illegal character "%s" mid-expression',
      (illegalChar) => {
        expect(() => parse(`1 + ${illegalChar}`)).toThrow(
          `Invalid input: { type: ILLEGAL, literal: ${illegalChar} } as position: 4.`,
        );
      },
    );

    it('throws when closing parenthesis is missing', () => {
      expect(() => parse('(1 + 2')).toThrow(
        'Expected ) but got { type: EOF, literal: \0 } as position: 6.',
      );
    });

    it('throws when IS is not followed by NULL', () => {
      expect(() => parse('x is 1')).toThrow('Expected null but got');
    });

    it('throws when IS NOT is not followed by NULL', () => {
      expect(() => parse('x is not 1')).toThrow('Expected null but got');
    });

    it('throws when BETWEEN lower bound is not numeric', () => {
      expect(() => parse("x between 'a' and 10")).toThrow('Expected NUM but got');
    });

    it('throws when BETWEEN is missing AND', () => {
      expect(() => parse('x between 1 or 10')).toThrow('Expected and but got');
    });

    it('throws when BETWEEN upper bound is not numeric', () => {
      expect(() => parse("x between 1 and 'b'")).toThrow('Expected NUM but got');
    });

    it('throws when function arguments are not separated by comma or closing paren', () => {
      expect(() => parse('length("a" "b")')).toThrow(
        'Expected , or ) got { type: STR, literal: b }',
      );
    });

    it('throws when function call contains a comma', () => {
      expect(() => parse('length("a", "b")')).toThrow(
        'Unexpected start of expression: { type: ,, literal: , }',
      );
    });

    it('throws when CASE is not followed by WHEN', () => {
      expect(() => parse('case end')).toThrow(
        'Expected when got { type: case, literal: case } as position: 0.',
      );
    });

    it('throws when CASE WHEN is missing THEN', () => {
      expect(() => parse('case when true 1 end')).toThrow('Expected then but got');
    });

    it('throws when CASE is missing END', () => {
      expect(() => parse('case when true then 1 else 2')).toThrow('Expected end but got');
    });

    it('throws when subsequent CASE branch is missing WHEN', () => {
      expect(() => parse('case when true then 1 2 end')).toThrow('Expected when but got');
    });
  });
});

describe('evaluate', () => {
  describe('arithmetic operations', () => {
    it.each([
      { expr: '2 + 3', expected: 5 },
      { expr: '10 - 4', expected: 6 },
      { expr: '3 - 5', expected: -2 },
      { expr: '6 * 7', expected: 42 },
      { expr: '5 / 2', expected: 2.5 },
      { expr: '1 + 2 * 3', expected: 7 },
      { expr: '(1 + 2) * 3', expected: 9 },
      { expr: '10 - 3 - 2', expected: 5 },
      { expr: '24 / 6 / 2', expected: 2 },
      { expr: '"foo" + "bar"', expected: 'foobar' },
    ])('evaluates "$expr" to $expected', ({ expr, expected }) => {
      expect(evaluate(expr)).toBe(expected);
    });
  });

  describe('comparison operations and boundaries', () => {
    it.each([
      { expr: '5 = 5', expected: true },
      { expr: '5 = 6', expected: false },
      { expr: '5 = "5"', expected: false },
      { expr: '5 <> 6', expected: true },
      { expr: '5 <> 5', expected: false },
      { expr: '5 <> "5"', expected: true },
      { expr: '5 > 4', expected: true },
      { expr: '5 > 5', expected: false },
      { expr: '4 > 5', expected: false },
      { expr: '5 >= 4', expected: true },
      { expr: '5 >= 5', expected: true },
      { expr: '4 >= 5', expected: false },
      { expr: '4 < 5', expected: true },
      { expr: '5 < 5', expected: false },
      { expr: '5 < 4', expected: false },
      { expr: '4 <= 5', expected: true },
      { expr: '5 <= 5', expected: true },
      { expr: '5 <= 4', expected: false },
    ])('evaluates "$expr" to $expected', ({ expr, expected }) => {
      expect(evaluate(expr)).toBe(expected);
    });
  });

  describe('logical operations and short-circuiting', () => {
    it.each([
      { expr: 'true and true', expected: true },
      { expr: 'true and false', expected: false },
      { expr: 'false and true', expected: false },
      { expr: 'false and false', expected: false },
      { expr: 'true or true', expected: true },
      { expr: 'true or false', expected: true },
      { expr: 'false or true', expected: true },
      { expr: 'false or false', expected: false },
      { expr: 'false and false or true', expected: false },
      { expr: 'true or false and false', expected: false },
    ])('evaluates "$expr" to $expected', ({ expr, expected }) => {
      expect(evaluate(expr)).toBe(expected);
    });

    it('short-circuits AND without evaluating the right operand when left is false', () => {
      expect(evaluate('false and unknown()')).toBe(false);
    });

    it('short-circuits OR without evaluating the right operand when left is true', () => {
      expect(evaluate('true or unknown()')).toBe(true);
    });
  });

  describe('BETWEEN boundaries', () => {
    const min = 10;
    const max = 20;

    it.each([
      { value: min - 1, expected: false, label: 'below lower bound' },
      { value: min, expected: true, label: 'at lower bound' },
      { value: 15, expected: true, label: 'inside range' },
      { value: max, expected: true, label: 'at upper bound' },
      { value: max + 1, expected: false, label: 'above upper bound' },
    ])('returns $expected when value is $label ($value)', ({ value, expected }) => {
      expect(evaluate(`x between ${min} and ${max}`, () => value)).toBe(expected);
    });
  });

  describe('IS NULL and IS NOT NULL', () => {
    it.each([
      { expr: 'x is null', value: null, expected: true },
      { expr: 'x is null', value: undefined, expected: false },
      { expr: 'x is null', value: 0, expected: false },
      { expr: 'x is null', value: '', expected: false },
      { expr: 'x is not null', value: null, expected: false },
      { expr: 'x is not null', value: undefined, expected: true },
      { expr: 'x is not null', value: 'text', expected: true },
    ])('evaluates "$expr" with value $value as $expected', ({ expr, value, expected }) => {
      expect(evaluate(expr, () => value)).toBe(expected);
    });
  });

  describe('CASE expressions', () => {
    it('returns the THEN value of the first matching WHEN branch', () => {
      const result = evaluate(
        'case when score >= 90 then "A" when score >= 80 then "B" else "C" end',
        () => 95,
      );
      expect(result).toBe('A');
    });

    it('returns the THEN value of a subsequent matching WHEN branch', () => {
      const result = evaluate(
        'case when score >= 90 then "A" when score >= 80 then "B" else "C" end',
        () => 85,
      );
      expect(result).toBe('B');
    });

    it('returns the ELSE value when no WHEN condition matches', () => {
      const result = evaluate(
        'case when score >= 90 then "A" when score >= 80 then "B" else "C" end',
        () => 70,
      );
      expect(result).toBe('C');
    });

    it('returns falsy ELSE values like 0 without falling through to false', () => {
      const result = evaluate('case when false then 1 else 0 end');
      expect(result).toBe(0);
    });

    it('returns false when no WHEN condition matches and no ELSE branch is provided', () => {
      const result = evaluate('case when false then 1 end');
      expect(result).toBe(false);
    });

    it('does not evaluate later WHEN branches after a match is found', () => {
      expect(evaluate('case when true then 1 when unknown() then 2 else 3 end')).toBe(1);
    });
  });

  describe('function calls', () => {
    it('computes length of a non-empty string', () => {
      expect(evaluate('length("hello")')).toBe(5);
    });

    it('computes length of an empty string', () => {
      expect(evaluate('length("")')).toBe(0);
    });

    it('computes length of an array resolved from context', () => {
      expect(evaluate('length(items)', () => [10, 20, 30])).toBe(3);
    });

    it('throws when length is called with zero arguments', () => {
      expect(() => evaluate('length()')).toThrow('Length function takes exactly one argument.');
    });

    it('throws when calling an unimplemented function', () => {
      expect(() => evaluate('upper("abc")')).toThrow('Function upper not implemented');
    });
  });

  describe('context resolver', () => {
    it('passes the exact identifier name to the context callback', () => {
      const resolver = vi.fn((name: string) => (name === 'price' ? 25 : 0));
      const result = evaluate('price * 2', resolver);
      expect(resolver).toHaveBeenCalledExactlyOnceWith('price');
      expect(result).toBe(50);
    });
  });
});

describe('evaluateObject', () => {
  it('evaluates compound expressions against object properties', () => {
    const record = { age: 30, country: 'BR', deleted_at: null, name: 'Ana' };
    const result = evaluateObject(
      'age between 18 and 65 and country = "BR" and deleted_at is null and length(name) = 3',
      record,
    );
    expect(result).toBe(true);
  });

  it('resolves missing properties to undefined', () => {
    expect(evaluateObject('missing is null', {})).toBe(false);
  });

  it('returns the raw property value for a bare identifier', () => {
    expect(evaluateObject('status', { status: 'active' })).toBe('active');
  });
});

