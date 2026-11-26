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

describe('parse()', () => {
  describe('literals and identifiers', () => {
    it('parses integer and decimal numbers', () => {
      expect(parse('42')).toEqual(new ValueExpression(42));
      expect(parse('3.14')).toEqual(new ValueExpression(3.14));
      expect(parse('.5')).toEqual(new ValueExpression(0.5));
    });

    it('parses single- and double-quoted strings, including empty strings', () => {
      expect(parse("'hello'")).toEqual(new ValueExpression('hello'));
      expect(parse('"world"')).toEqual(new ValueExpression('world'));
      expect(parse("''")).toEqual(new ValueExpression(''));
      expect(parse('""')).toEqual(new ValueExpression(''));
    });

    it('parses boolean literals case-insensitively', () => {
      expect(parse('true')).toEqual(new ValueExpression(true));
      expect(parse('false')).toEqual(new ValueExpression(false));
      expect(parse('TRUE')).toEqual(new ValueExpression(true));
      expect(parse('False')).toEqual(new ValueExpression(false));
    });

    it('parses identifiers with letters and underscores', () => {
      expect(parse('age')).toEqual(new IdentifierExpression('age'));
      expect(parse('first_name')).toEqual(new IdentifierExpression('first_name'));
      expect(parse('_internal')).toEqual(new IdentifierExpression('_internal'));
    });
  });

  describe('operator precedence and grouping', () => {
    it('gives multiplication and division higher precedence than addition and subtraction', () => {
      expect(parse('1 + 2 * 3')).toEqual(
        new BinaryExpression(
          TokenType.Plus,
          new ValueExpression(1),
          new BinaryExpression(TokenType.Mul, new ValueExpression(2), new ValueExpression(3)),
        ),
      );

      expect(parse('10 - 6 / 2')).toEqual(
        new BinaryExpression(
          TokenType.Minus,
          new ValueExpression(10),
          new BinaryExpression(TokenType.Div, new ValueExpression(6), new ValueExpression(2)),
        ),
      );
    });

    it('treats same-precedence binary operators as left-associative', () => {
      expect(parse('10 - 3 - 2')).toEqual(
        new BinaryExpression(
          TokenType.Minus,
          new BinaryExpression(TokenType.Minus, new ValueExpression(10), new ValueExpression(3)),
          new ValueExpression(2),
        ),
      );
    });

    it('overrides precedence with parentheses', () => {
      expect(parse('(1 + 2) * 3')).toEqual(
        new BinaryExpression(
          TokenType.Mul,
          new BinaryExpression(TokenType.Plus, new ValueExpression(1), new ValueExpression(2)),
          new ValueExpression(3),
        ),
      );
    });

    it('follows the parser precedence map for logical operators (or > and)', () => {
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
  });

  describe('SQL-like constructs', () => {
    it('desugars "is null" and "is not null" into equality/inequality with null', () => {
      expect(parse('status is null')).toEqual(
        new BinaryExpression(
          TokenType.Eq,
          new IdentifierExpression('status'),
          new ValueExpression(null),
        ),
      );

      expect(parse('status IS NOT NULL')).toEqual(
        new BinaryExpression(
          TokenType.Neq,
          new IdentifierExpression('status'),
          new ValueExpression(null),
        ),
      );
    });

    it('desugars "between" into an inclusive range check', () => {
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

    it('parses function calls with zero or one argument', () => {
      expect(parse('length()')).toEqual(new FunctionCallExpression('length', []));
      expect(parse('length(name)')).toEqual(
        new FunctionCallExpression('length', [new IdentifierExpression('name')]),
      );
      expect(parse("length('abc' + 'def')")).toEqual(
        new FunctionCallExpression('length', [
          new BinaryExpression(
            TokenType.Plus,
            new ValueExpression('abc'),
            new ValueExpression('def'),
          ),
        ]),
      );
    });

    it('parses case expressions with and without an else branch', () => {
      expect(parse('case when x = 1 then 10 else 20 end')).toEqual(
        new CaseExpression(
          [
            {
              when: new BinaryExpression(
                TokenType.Eq,
                new IdentifierExpression('x'),
                new ValueExpression(1),
              ),
              then: new ValueExpression(10),
            },
          ],
          new ValueExpression(20),
        ),
      );

      expect(parse('case when x = 1 then 10 when x = 2 then 20 end')).toEqual(
        new CaseExpression(
          [
            {
              when: new BinaryExpression(
                TokenType.Eq,
                new IdentifierExpression('x'),
                new ValueExpression(1),
              ),
              then: new ValueExpression(10),
            },
            {
              when: new BinaryExpression(
                TokenType.Eq,
                new IdentifierExpression('x'),
                new ValueExpression(2),
              ),
              then: new ValueExpression(20),
            },
          ],
          undefined,
        ),
      );
    });
  });

  describe('syntax errors', () => {
    it('throws on empty input or unexpected starting tokens', () => {
      expect(() => parse('')).toThrow(/Unexpected start of expression/);
      expect(() => parse('-5')).toThrow(/Unexpected start of expression/);
      expect(() => parse('not true')).toThrow(/Unexpected start of expression/);
      expect(() => parse('null')).toThrow(/Unexpected start of expression/);
      expect(() => parse('@invalid')).toThrow(/Unexpected start of expression/);
    });

    it('throws on illegal characters inside an expression', () => {
      expect(() => parse('1 + @')).toThrow(/Invalid input/);
      expect(() => parse('a & b')).toThrow(/Invalid input/);
    });

    it('throws on unclosed parentheses', () => {
      expect(() => parse('(1 + 2')).toThrow(/Expected \)/);
    });

    it('throws on malformed "is" expressions', () => {
      expect(() => parse('x is 5')).toThrow(/Expected null/);
      expect(() => parse('x is not 5')).toThrow(/Expected null/);
    });

    it('throws on malformed "between" expressions', () => {
      expect(() => parse('x between a and 10')).toThrow(/Expected NUM/);
      expect(() => parse('x between 1 or 10')).toThrow(/Expected and/);
      expect(() => parse('x between 1 and b')).toThrow(/Expected NUM/);
    });

    it('throws on malformed "case" expressions', () => {
      expect(() => parse('case else 1 end')).toThrow(/Expected when/);
      expect(() => parse('case when true 1 end')).toThrow(/Expected then/);
      expect(() => parse('case when true then 1')).toThrow(/Expected end/);
    });
  });
});

describe('evaluate()', () => {
  describe('arithmetic and whitespace', () => {
    it('evaluates basic arithmetic operators and precedence', () => {
      expect(evaluate('1 + 2')).toBe(3);
      expect(evaluate('10 - 4')).toBe(6);
      expect(evaluate('3 * 7')).toBe(21);
      expect(evaluate('15 / 3')).toBe(5);
      expect(evaluate('2 + 3 * 4')).toBe(14);
      expect(evaluate('(2 + 3) * 4')).toBe(20);
      expect(evaluate('10 - 3 - 2')).toBe(5);
      expect(evaluate('20 / 4 / 2')).toBe(2.5);
      expect(evaluate('1.5 + .5')).toBe(2);
    });

    it('ignores tabs, newlines, and extra spaces', () => {
      expect(evaluate('  \t 2 \n + \r\n 3 * 4  ')).toBe(14);
    });

    it('concatenates strings with +', () => {
      expect(evaluate("'hello' + ' ' + \"world\"")).toBe('hello world');
    });
  });

  describe('comparisons', () => {
    it('evaluates numeric and string equality/inequality', () => {
      expect(evaluate('5 = 5')).toBe(true);
      expect(evaluate('5 = 6')).toBe(false);
      expect(evaluate('5 <> 6')).toBe(true);
      expect(evaluate('5 <> 5')).toBe(false);
      expect(evaluate("'abc' = 'abc'")).toBe(true);
      expect(evaluate("'abc' <> 'def'")).toBe(true);
    });

    it('evaluates relational operators', () => {
      expect(evaluate('5 > 3')).toBe(true);
      expect(evaluate('5 > 5')).toBe(false);
      expect(evaluate('5 >= 5')).toBe(true);
      expect(evaluate('4 >= 5')).toBe(false);
      expect(evaluate('3 < 5')).toBe(true);
      expect(evaluate('5 < 5')).toBe(false);
      expect(evaluate('5 <= 5')).toBe(true);
      expect(evaluate('6 <= 5')).toBe(false);
    });
  });

  describe('logical operators', () => {
    it('evaluates and / or case-insensitively', () => {
      expect(evaluate('true and true')).toBe(true);
      expect(evaluate('true and false')).toBe(false);
      expect(evaluate('false or true')).toBe(true);
      expect(evaluate('false OR false')).toBe(false);
      expect(evaluate('1 = 1 AND 2 = 2')).toBe(true);
    });

    it('respects precedence and parentheses for combined logical expressions', () => {
      expect(evaluate('false and true or true')).toBe(false);
      expect(evaluate('(false and true) or true')).toBe(true);
      expect(evaluate('true or false and false')).toBe(false);
      expect(evaluate('true or (false and false)')).toBe(true);
    });
  });

  describe('between', () => {
    it('checks inclusive numeric bounds', () => {
      expect(evaluate('5 between 1 and 10')).toBe(true);
      expect(evaluate('1 between 1 and 10')).toBe(true);
      expect(evaluate('10 between 1 and 10')).toBe(true);
      expect(evaluate('0 between 1 and 10')).toBe(false);
      expect(evaluate('11 between 1 and 10')).toBe(false);
      expect(evaluate('2.5 BETWEEN 2.0 AND 3.0')).toBe(true);
    });
  });

  describe('is null / is not null', () => {
    it('evaluates strict null checks via context', () => {
      const ctx = (name: string) =>
        ({ a: null, b: undefined, c: 0, d: '', e: false, f: 'ok' }[name]);

      expect(evaluate('a is null', ctx)).toBe(true);
      expect(evaluate('a is not null', ctx)).toBe(false);
      expect(evaluate('b is null', ctx)).toBe(false);
      expect(evaluate('b is not null', ctx)).toBe(true);
      expect(evaluate('c is null', ctx)).toBe(false);
      expect(evaluate('d is null', ctx)).toBe(false);
      expect(evaluate('e is null', ctx)).toBe(false);
      expect(evaluate('f is not null', ctx)).toBe(true);
    });
  });

  describe('case expressions', () => {
    it('returns the first matching when branch', () => {
      const expr =
        "case when score >= 90 then 'A' when score >= 80 then 'B' when score >= 70 then 'C' else 'F' end";

      expect(evaluate(expr, () => 95)).toBe('A');
      expect(evaluate(expr, () => 85)).toBe('B');
      expect(evaluate(expr, () => 70)).toBe('C');
      expect(evaluate(expr, () => 50)).toBe('F');
    });

    it('returns false when no branch matches and there is no else clause', () => {
      expect(evaluate("case when x > 10 then 'big' end", () => 5)).toBe(false);
    });

    it('preserves falsy else values (0, empty string, false)', () => {
      expect(evaluate('case when false then 1 else 0 end')).toBe(0);
      expect(evaluate("case when false then 'yes' else '' end")).toBe('');
      expect(evaluate('case when false then true else false end')).toBe(false);
    });

    it('supports nested case expressions and case inside arithmetic expressions', () => {
      const nested =
        "case when a = 1 then case when b = 2 then 'both' else 'only a' end else 'neither' end";
      expect(evaluate(nested, (k) => (k === 'a' ? 1 : 2))).toBe('both');
      expect(evaluate(nested, (k) => (k === 'a' ? 1 : 0))).toBe('only a');
      expect(evaluate(nested, () => 0)).toBe('neither');

      expect(evaluate('10 + case when bonus then 5 else 0 end', () => true)).toBe(15);
      expect(evaluate('10 + case when bonus then 5 else 0 end', () => false)).toBe(10);
    });
  });

  describe('function calls', () => {
    it('evaluates length() on strings and arrays', () => {
      expect(evaluate("length('hello')")).toBe(5);
      expect(evaluate("length('')")).toBe(0);
      expect(evaluate("length('ab' + 'cde')")).toBe(5);
      expect(evaluate('length(items)', () => [1, 2, 3, 4])).toBe(4);
    });

    it('throws when length() is called without an argument', () => {
      expect(() => evaluate('length()')).toThrow('Length function takes exactly one argument.');
    });

    it('throws for unimplemented functions', () => {
      expect(() => evaluate("upper('abc')")).toThrow('Function upper not implemented');
    });
  });

  describe('context handling', () => {
    it('resolves identifiers through the provided context callback', () => {
      const values: Record<string, any> = { price: 25, qty: 4 };
      expect(evaluate('price * qty', (id) => values[id])).toBe(100);
    });

    it('throws when an identifier is evaluated without a context function', () => {
      expect(() => evaluate('x + 1')).toThrow(TypeError);
    });
  });
});

describe('evaluateObject()', () => {
  it('evaluates SQL-like WHERE clauses against an object', () => {
    const user = {
      name: 'Alice',
      age: 30,
      role: 'admin',
      deleted_at: null,
      score: 85,
      active: true,
    };

    expect(evaluateObject("role = 'admin' and age between 18 and 65", user)).toBe(true);
    expect(evaluateObject('deleted_at is null and active = true', user)).toBe(true);
    expect(evaluateObject('length(name) = 5 and score >= 80', user)).toBe(true);
    expect(
      evaluateObject(
        "case when score >= 90 then 'gold' when score >= 80 then 'silver' else 'bronze' end",
        user,
      ),
    ).toBe('silver');
  });

  it('handles missing properties and falsy values accurately', () => {
    const record = { count: 0, label: '', enabled: false, empty: null };

    expect(evaluateObject('count = 0', record)).toBe(true);
    expect(evaluateObject("label = ''", record)).toBe(true);
    expect(evaluateObject('enabled = false', record)).toBe(true);
    expect(evaluateObject('empty is null', record)).toBe(true);
    expect(evaluateObject('missing is null', record)).toBe(false);
    expect(evaluateObject('missing is not null', record)).toBe(true);
  });
});

