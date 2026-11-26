Below is a Vitest test suite for `tests/expression-parser.test.ts` covering `parse`, `evaluate`, and `evaluateObject`, including AST structure, operator precedence, SQL-like constructs (`between`, `is [not] null`, `case`), function calls, context resolution, and error handling.

### `tests/expression-parser.test.ts`

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

describe('parse', () => {
  describe('literals and identifiers', () => {
    it('parses integer, decimal, and leading-dot numeric literals', () => {
      expect(parse('42')).toEqual(new ValueExpression(42));
      expect(parse('3.14')).toEqual(new ValueExpression(3.14));
      expect(parse('.5')).toEqual(new ValueExpression(0.5));
    });

    it('parses single-quoted and double-quoted strings', () => {
      expect(parse("'hello'")).toEqual(new ValueExpression('hello'));
      expect(parse('"world"')).toEqual(new ValueExpression('world'));
      expect(parse("''")).toEqual(new ValueExpression(''));
    });

    it('parses boolean keywords case-insensitively', () => {
      expect(parse('true')).toEqual(new ValueExpression(true));
      expect(parse('TRUE')).toEqual(new ValueExpression(true));
      expect(parse('false')).toEqual(new ValueExpression(false));
      expect(parse('False')).toEqual(new ValueExpression(false));
    });

    it('parses identifiers with letters and underscores', () => {
      expect(parse('age')).toEqual(new IdentifierExpression('age'));
      expect(parse('first_name')).toEqual(new IdentifierExpression('first_name'));
      expect(parse('_internal')).toEqual(new IdentifierExpression('_internal'));
    });

    it('ignores leading, trailing, and multiline whitespace', () => {
      expect(parse('  \t\n  42 \r\n ')).toEqual(new ValueExpression(42));
    });
  });

  describe('binary expressions and precedence', () => {
    it('gives multiplication and division higher precedence than addition and subtraction', () => {
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

    it('respects parentheses to override precedence', () => {
      expect(parse('(1 + 2) * 3')).toEqual(
        new BinaryExpression(
          TokenType.Mul,
          new BinaryExpression(
            TokenType.Plus,
            new ValueExpression(1),
            new ValueExpression(2),
          ),
          new ValueExpression(3),
        ),
      );
    });

    it('gives relational operators higher precedence than equality operators', () => {
      expect(parse('a > 1 = true')).toEqual(
        new BinaryExpression(
          TokenType.Eq,
          new BinaryExpression(
            TokenType.Gt,
            new IdentifierExpression('a'),
            new ValueExpression(1),
          ),
          new ValueExpression(true),
        ),
      );
    });

    it('follows the parser precedence table where or binds tighter than and', () => {
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
      expect(parse('x is null')).toEqual(
        new BinaryExpression(
          TokenType.Eq,
          new IdentifierExpression('x'),
          new ValueExpression(null),
        ),
      );

      expect(parse('x IS NOT NULL')).toEqual(
        new BinaryExpression(
          TokenType.Neq,
          new IdentifierExpression('x'),
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
      expect(parse('foo()')).toEqual(new FunctionCallExpression('foo', []));
      expect(parse("length('abc')")).toEqual(
        new FunctionCallExpression('length', [new ValueExpression('abc')]),
      );
    });

    it('parses case expressions with and without else', () => {
      expect(parse('case when x > 0 then 1 else 0 end')).toEqual(
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
          ],
          new ValueExpression(0),
        ),
      );

      expect(
        parse("CASE WHEN x = 1 THEN 'a' WHEN x = 2 THEN 'b' END"),
      ).toEqual(
        new CaseExpression(
          [
            {
              when: new BinaryExpression(
                TokenType.Eq,
                new IdentifierExpression('x'),
                new ValueExpression(1),
              ),
              then: new ValueExpression('a'),
            },
            {
              when: new BinaryExpression(
                TokenType.Eq,
                new IdentifierExpression('x'),
                new ValueExpression(2),
              ),
              then: new ValueExpression('b'),
            },
          ],
          undefined,
        ),
      );
    });
  });

  describe('syntax errors', () => {
    it('throws on empty input', () => {
      expect(() => parse('')).toThrow(/Unexpected start of expression/);
    });

    it('throws on unsupported prefix tokens', () => {
      expect(() => parse('-5')).toThrow(/Unexpected start of expression/);
      expect(() => parse('not true')).toThrow(/Unexpected start of expression/);
      expect(() => parse('null')).toThrow(/Unexpected start of expression/);
    });

    it('throws on illegal characters', () => {
      expect(() => parse('@')).toThrow(/Unexpected start of expression/);
      expect(() => parse('1 + @')).toThrow(/Invalid input/);
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
      expect(() => parse('x between 1 10')).toThrow(/Expected and/);
      expect(() => parse('x between 1 and b')).toThrow(/Expected NUM/);
    });

    it('throws on malformed "case" expressions', () => {
      expect(() => parse('case end')).toThrow(/Expected when/);
      expect(() => parse('case when true 1 end')).toThrow(/Expected then/);
      expect(() => parse('case when true then 1')).toThrow(/Expected end/);
    });

    it('throws on malformed function call syntax', () => {
      expect(() => parse('length(1 2)')).toThrow(/Expected , or \)/);
    });
  });
});

describe('evaluate', () => {
  describe('literals and arithmetic', () => {
    it('evaluates numeric, string, and boolean literals', () => {
      expect(evaluate('123')).toBe(123);
      expect(evaluate('0.25')).toBe(0.25);
      expect(evaluate("'hello'")).toBe('hello');
      expect(evaluate('"hello"')).toBe('hello');
      expect(evaluate('true')).toBe(true);
      expect(evaluate('false')).toBe(false);
    });

    it('evaluates arithmetic operators with standard precedence', () => {
      expect(evaluate('2 + 3')).toBe(5);
      expect(evaluate('10 - 4')).toBe(6);
      expect(evaluate('3 * 7')).toBe(21);
      expect(evaluate('15 / 3')).toBe(5);
      expect(evaluate('2 + 3 * 4')).toBe(14);
      expect(evaluate('(2 + 3) * 4')).toBe(20);
      expect(evaluate('20 - 12 / 4 + 2')).toBe(19);
      expect(evaluate('((2 + 3) * (4 - 1)) / 3')).toBe(5);
    });

    it('concatenates strings with +', () => {
      expect(evaluate("'foo' + ' ' + 'bar'")).toBe('foo bar');
    });
  });

  describe('comparisons', () => {
    it('evaluates = and <>', () => {
      expect(evaluate('5 = 5')).toBe(true);
      expect(evaluate('5 = 6')).toBe(false);
      expect(evaluate('5 <> 6')).toBe(true);
      expect(evaluate('5 <> 5')).toBe(false);
      expect(evaluate("'abc' = 'abc'")).toBe(true);
      expect(evaluate("'abc' <> 'def'")).toBe(true);
    });

    it('evaluates >, >=, <, <=', () => {
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
    it('evaluates and / or with case-insensitive keywords', () => {
      expect(evaluate('true and true')).toBe(true);
      expect(evaluate('true AND false')).toBe(false);
      expect(evaluate('false or true')).toBe(true);
      expect(evaluate('false OR false')).toBe(false);
    });

    it('evaluates according to parser precedence and parentheses', () => {
      // Parser gives `or` higher precedence than `and`
      expect(evaluate('false and true or true')).toBe(false);
      expect(evaluate('(false and true) or true')).toBe(true);
      expect(evaluate('true or false and false')).toBe(false);
      expect(evaluate('true or (false and false)')).toBe(true);
    });

    it('short-circuits logical operators', () => {
      expect(evaluate('false and unknown(1)')).toBe(false);
      expect(evaluate('true or unknown(1)')).toBe(true);
    });
  });

  describe('between', () => {
    it('checks inclusive numeric ranges', () => {
      expect(evaluate('5 between 1 and 10')).toBe(true);
      expect(evaluate('1 between 1 and 10')).toBe(true);
      expect(evaluate('10 between 1 and 10')).toBe(true);
      expect(evaluate('0 between 1 and 10')).toBe(false);
      expect(evaluate('11 between 1 and 10')).toBe(false);
      expect(evaluate('2.5 between 1.5 and 3.5')).toBe(true);
    });
  });

  describe('case expressions', () => {
    it('returns the first matching when/then branch', () => {
      const expr = `
        case
          when x > 10 then 'high'
          when x > 5 then 'medium'
          else 'low'
        end
      `;
      expect(evaluate(expr, () => 20)).toBe('high');
      expect(evaluate(expr, () => 7)).toBe('medium');
      expect(evaluate(expr, () => 2)).toBe('low');
    });

    it('returns false when no branch matches and there is no else', () => {
      expect(evaluate('case when 1 = 2 then 100 end')).toBe(false);
    });

    it('does not evaluate subsequent branches after a match', () => {
      expect(
        evaluate('case when true then 42 when unknown(1) then 0 end'),
      ).toBe(42);
    });
  });

  describe('functions', () => {
    it('evaluates length() on strings and arrays', () => {
      expect(evaluate("length('hello')")).toBe(5);
      expect(evaluate("length('')")).toBe(0);
      expect(evaluate('length(items)', () => [1, 2, 3])).toBe(3);
    });

    it('throws when length() is called with wrong argument count', () => {
      expect(() => evaluate('length()')).toThrow(
        'Length function takes exactly one argument.',
      );
    });

    it('throws on unimplemented functions', () => {
      expect(() => evaluate("upper('abc')")).toThrow(
        'Function upper not implemented',
      );
    });
  });

  describe('context resolution', () => {
    it('resolves identifiers using the provided context function', () => {
      const lookup = vi.fn((name: string) => ({ x: 10, y: 20 }[name]));
      expect(evaluate('x + y', lookup)).toBe(30);
      expect(lookup).toHaveBeenCalledWith('x');
      expect(lookup).toHaveBeenCalledWith('y');
    });

    it('throws if an identifier is evaluated without a context', () => {
      expect(() => evaluate('x')).toThrow(TypeError);
    });
  });
});

describe('evaluateObject', () => {
  it('evaluates expressions against object properties', () => {
    const user = {
      name: 'Alice',
      age: 30,
      role: 'admin',
      active: true,
      deleted_at: null,
      tags: ['staff', 'ops'],
    };

    expect(evaluateObject("name = 'Alice' and age >= 18", user)).toBe(true);
    expect(evaluateObject('age between 20 and 40', user)).toBe(true);
    expect(evaluateObject('deleted_at is null', user)).toBe(true);
    expect(evaluateObject('deleted_at is not null', user)).toBe(false);
    expect(evaluateObject('name is not null', user)).toBe(true);
    expect(evaluateObject('length(name) = 5 and length(tags) = 2', user)).toBe(
      true,
    );
  });

  it('handles missing properties as undefined', () => {
    const obj = { a: 1 };
    expect(evaluateObject('missing is null', obj)).toBe(false);
    expect(evaluateObject('missing is not null', obj)).toBe(true);
    expect(evaluateObject('a = 1', obj)).toBe(true);
  });

  it('evaluates complex SQL-like WHERE clauses', () => {
    const expr = `
      (status = 'paid' or status = 'shipped')
      and total between 50 and 500
      and cancelled_at is null
      and (case when vip = true then total >= 50 else total >= 100 end)
    `;

    expect(
      evaluateObject(expr, {
        status: 'paid',
        total: 75,
        cancelled_at: null,
        vip: true,
      }),
    ).toBe(true);

    expect(
      evaluateObject(expr, {
        status: 'paid',
        total: 75,
        cancelled_at: null,
        vip: false,
      }),
    ).toBe(false);

    expect(
      evaluateObject(expr, {
        status: 'shipped',
        total: 150,
        cancelled_at: '2026-01-01',
        vip: false,
      }),
    ).toBe(false);
  });
});

```

### Notable implementation behaviors covered

* **`or` vs `and` precedence:** `src/parser.ts` assigns `TokenType.Or` precedence `2` and `TokenType.And` precedence `1`, so `or` binds tighter than `and` unless grouped with parentheses.
* **Null handling:** `null` is only valid as the right-hand side of `is null` / `is not null` (which evaluate with strict `===` / `!==`, so `undefined` is not equal to `null`).
* **Unary operators:** Unary `-` and `not` are not registered in `prefixParsers` and throw a parse error.