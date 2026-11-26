Create `tests/expression-parser.test.ts` with the following Vitest test suite covering `parse`, `evaluate`, and `evaluateObject`:

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
    it('parses integer and decimal numbers', () => {
      expect(parse('42')).toEqual(new ValueExpression(42));
      expect(parse('0')).toEqual(new ValueExpression(0));
      expect(parse('3.14')).toEqual(new ValueExpression(3.14));
      expect(parse('.5')).toEqual(new ValueExpression(0.5));
    });

    it('parses single- and double-quoted strings', () => {
      expect(parse("'hello'")).toEqual(new ValueExpression('hello'));
      expect(parse('"world"')).toEqual(new ValueExpression('world'));
      expect(parse("''")).toEqual(new ValueExpression(''));
      expect(parse('""')).toEqual(new ValueExpression(''));
      expect(parse("'a + b = c'")).toEqual(new ValueExpression('a + b = c'));
    });

    it('parses boolean literals case-insensitively', () => {
      expect(parse('true')).toEqual(new ValueExpression(true));
      expect(parse('false')).toEqual(new ValueExpression(false));
      expect(parse('TRUE')).toEqual(new ValueExpression(true));
      expect(parse('False')).toEqual(new ValueExpression(false));
    });

    it('parses identifiers with letters and underscores while preserving case', () => {
      expect(parse('foo')).toEqual(new IdentifierExpression('foo'));
      expect(parse('first_name')).toEqual(new IdentifierExpression('first_name'));
      expect(parse('_PrivateVar')).toEqual(new IdentifierExpression('_PrivateVar'));
    });

    it('ignores leading, trailing, and interior whitespace', () => {
      expect(parse('  \t\n 1 + 2 \r\n ')).toEqual(
        new BinaryExpression(TokenType.Plus, new ValueExpression(1), new ValueExpression(2)),
      );
      expect(parse('1+2*3')).toEqual(
        new BinaryExpression(
          TokenType.Plus,
          new ValueExpression(1),
          new BinaryExpression(TokenType.Mul, new ValueExpression(2), new ValueExpression(3)),
        ),
      );
    });
  });

  describe('operators, precedence, and grouping', () => {
    it('gives multiplication and division higher precedence than addition and subtraction', () => {
      expect(parse('1 + 2 * 3')).toEqual(
        new BinaryExpression(
          TokenType.Plus,
          new ValueExpression(1),
          new BinaryExpression(TokenType.Mul, new ValueExpression(2), new ValueExpression(3)),
        ),
      );

      expect(parse('8 / 2 - 1')).toEqual(
        new BinaryExpression(
          TokenType.Minus,
          new BinaryExpression(TokenType.Div, new ValueExpression(8), new ValueExpression(2)),
          new ValueExpression(1),
        ),
      );
    });

    it('parses same-precedence binary operators left-associatively', () => {
      expect(parse('10 - 4 - 2')).toEqual(
        new BinaryExpression(
          TokenType.Minus,
          new BinaryExpression(TokenType.Minus, new ValueExpression(10), new ValueExpression(4)),
          new ValueExpression(2),
        ),
      );

      expect(parse('24 / 6 / 2')).toEqual(
        new BinaryExpression(
          TokenType.Div,
          new BinaryExpression(TokenType.Div, new ValueExpression(24), new ValueExpression(6)),
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

    it('parses all comparison operators', () => {
      const cases: [string, TokenType][] = [
        ['a = 1', TokenType.Eq],
        ['a <> 1', TokenType.Neq],
        ['a < 1', TokenType.Lt],
        ['a <= 1', TokenType.Lte],
        ['a > 1', TokenType.Gt],
        ['a >= 1', TokenType.Gte],
      ];

      for (const [expr, op] of cases) {
        expect(parse(expr)).toEqual(
          new BinaryExpression(op, new IdentifierExpression('a'), new ValueExpression(1)),
        );
      }
    });

    it('gives relational comparisons higher precedence than equality', () => {
      expect(parse('1 < 2 = true')).toEqual(
        new BinaryExpression(
          TokenType.Eq,
          new BinaryExpression(TokenType.Lt, new ValueExpression(1), new ValueExpression(2)),
          new ValueExpression(true),
        ),
      );
    });

    it('follows the configured logical precedence (or binds tighter than and)', () => {
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
  });

  describe('SQL-style constructs', () => {
    it('desugars IS NULL and IS NOT NULL into equality comparisons with null', () => {
      expect(parse('a is null')).toEqual(
        new BinaryExpression(TokenType.Eq, new IdentifierExpression('a'), new ValueExpression(null)),
      );
      expect(parse('a IS NOT NULL')).toEqual(
        new BinaryExpression(TokenType.Neq, new IdentifierExpression('a'), new ValueExpression(null)),
      );
    });

    it('desugars BETWEEN into >= AND <= binary expressions', () => {
      expect(parse('x between 1 and 10')).toEqual(
        new BinaryExpression(
          TokenType.And,
          new BinaryExpression(TokenType.Gte, new IdentifierExpression('x'), new ValueExpression(1)),
          new BinaryExpression(TokenType.Lte, new IdentifierExpression('x'), new ValueExpression(10)),
        ),
      );
    });

    it('parses function calls with zero or one argument and nested calls', () => {
      expect(parse('length()')).toEqual(new FunctionCallExpression('length', []));
      expect(parse("length('abc')")).toEqual(
        new FunctionCallExpression('length', [new ValueExpression('abc')]),
      );
      expect(parse('outer(inner(x))')).toEqual(
        new FunctionCallExpression('outer', [
          new FunctionCallExpression('inner', [new IdentifierExpression('x')]),
        ]),
      );
    });

    it('parses CASE expressions with multiple WHEN clauses and optional ELSE', () => {
      expect(parse("case when x > 10 then 'high' when x > 5 then 'mid' else 'low' end")).toEqual(
        new CaseExpression(
          [
            {
              when: new BinaryExpression(
                TokenType.Gt,
                new IdentifierExpression('x'),
                new ValueExpression(10),
              ),
              then: new ValueExpression('high'),
            },
            {
              when: new BinaryExpression(
                TokenType.Gt,
                new IdentifierExpression('x'),
                new ValueExpression(5),
              ),
              then: new ValueExpression('mid'),
            },
          ],
          new ValueExpression('low'),
        ),
      );

      expect(parse('CASE WHEN a = 1 THEN true END')).toEqual(
        new CaseExpression(
          [
            {
              when: new BinaryExpression(
                TokenType.Eq,
                new IdentifierExpression('a'),
                new ValueExpression(1),
              ),
              then: new ValueExpression(true),
            },
          ],
          undefined,
        ),
      );
    });
  });

  describe('parse errors', () => {
    it('throws on empty or whitespace-only input', () => {
      expect(() => parse('')).toThrow(/Unexpected start of expression/);
      expect(() => parse('   \t\n ')).toThrow(/Unexpected start of expression/);
    });

    it('throws on unsupported prefix tokens', () => {
      expect(() => parse('+ 1')).toThrow(/Unexpected start of expression/);
      expect(() => parse('-5')).toThrow(/Unexpected start of expression/);
      expect(() => parse('not true')).toThrow(/Unexpected start of expression/);
      expect(() => parse('null')).toThrow(/Unexpected start of expression/);
      expect(() => parse(')')).toThrow(/Unexpected start of expression/);
    });

    it('throws on illegal characters', () => {
      expect(() => parse('@foo')).toThrow(/Unexpected start of expression/);
      expect(() => parse('1 + @')).toThrow(/Invalid input/);
      expect(() => parse('a = !b')).toThrow(/Invalid input/);
    });

    it('throws on malformed parentheses', () => {
      expect(() => parse('(1 + 2')).toThrow(/Expected \)/);
      expect(() => parse('()')).toThrow(/Unexpected start of expression/);
    });

    it('throws on malformed IS expressions', () => {
      expect(() => parse('a is 1')).toThrow(/Expected null/);
      expect(() => parse('a is not true')).toThrow(/Expected null/);
    });

    it('throws on malformed BETWEEN expressions', () => {
      expect(() => parse("x between 'a' and 'z'")).toThrow(/Expected NUM/);
      expect(() => parse('x between 1 or 10')).toThrow(/Expected and/);
      expect(() => parse("x between 1 and 'b'")).toThrow(/Expected NUM/);
    });

    it('throws on malformed CASE expressions', () => {
      expect(() => parse('case end')).toThrow(/Expected when/);
      expect(() => parse('case else 1 end')).toThrow(/Expected when/);
      expect(() => parse('case when true 1 end')).toThrow(/Expected then/);
      expect(() => parse('case when true then 1 else 2')).toThrow(/Expected end/);
      expect(() => parse('case when true then 1')).toThrow();
    });

    it('throws on malformed function calls', () => {
      expect(() => parse("length('a'")).toThrow(/Expected , or \)/);
      expect(() => parse("length('a' 'b')")).toThrow(/Expected , or \)/);
    });
  });
});

describe('evaluate', () => {
  describe('arithmetic and string operations', () => {
    it('evaluates basic arithmetic operators', () => {
      expect(evaluate('2 + 3')).toBe(5);
      expect(evaluate('10 - 4')).toBe(6);
      expect(evaluate('1 - 5')).toBe(-4);
      expect(evaluate('6 * 7')).toBe(42);
      expect(evaluate('15 / 4')).toBe(3.75);
      expect(evaluate('1 / 0')).toBe(Infinity);
      expect(evaluate('.5 + 1.25')).toBe(1.75);
    });

    it('respects precedence, associativity, and nested parentheses', () => {
      expect(evaluate('2 + 3 * 4')).toBe(14);
      expect(evaluate('(2 + 3) * 4')).toBe(20);
      expect(evaluate('10 - 4 - 2')).toBe(4);
      expect(evaluate('24 / 6 / 2')).toBe(2);
      expect(evaluate('((2 + 3) * (10 - 4)) / 5')).toBe(6);
    });

    it('concatenates strings with +', () => {
      expect(evaluate("'hello' + ' ' + 'world'")).toBe('hello world');
    });
  });

  describe('comparisons', () => {
    it('evaluates strict equality and inequality', () => {
      expect(evaluate('5 = 5')).toBe(true);
      expect(evaluate('5 = 6')).toBe(false);
      expect(evaluate("5 = '5'")).toBe(false);
      expect(evaluate("5 <> '5'")).toBe(true);
      expect(evaluate("'abc' = 'abc'")).toBe(true);
      expect(evaluate("'abc' <> 'def'")).toBe(true);
      expect(evaluate('true = true')).toBe(true);
      expect(evaluate('true <> false')).toBe(true);
    });

    it('evaluates relational operators for numbers and strings', () => {
      expect(evaluate('3 < 5')).toBe(true);
      expect(evaluate('5 < 5')).toBe(false);
      expect(evaluate('5 <= 5')).toBe(true);
      expect(evaluate('6 <= 5')).toBe(false);
      expect(evaluate('7 > 5')).toBe(true);
      expect(evaluate('5 > 5')).toBe(false);
      expect(evaluate('5 >= 5')).toBe(true);
      expect(evaluate('4 >= 5')).toBe(false);
      expect(evaluate("'apple' < 'banana'")).toBe(true);
    });
  });

  describe('logical operators', () => {
    it('evaluates AND and OR truth tables', () => {
      expect(evaluate('true and true')).toBe(true);
      expect(evaluate('true and false')).toBe(false);
      expect(evaluate('false and true')).toBe(false);
      expect(evaluate('false and false')).toBe(false);

      expect(evaluate('true or true')).toBe(true);
      expect(evaluate('true or false')).toBe(true);
      expect(evaluate('false or true')).toBe(true);
      expect(evaluate('false or false')).toBe(false);
    });

    it('evaluates logical precedence and parenthesized overrides', () => {
      expect(evaluate('false and true or true')).toBe(false);
      expect(evaluate('(false and true) or true')).toBe(true);
      expect(evaluate('true or false and false')).toBe(false);
      expect(evaluate('true or (false and false)')).toBe(true);
    });

    it('short-circuits AND and OR evaluation', () => {
      const ctx = vi.fn(() => true);

      expect(evaluate('false and skipped', ctx)).toBe(false);
      expect(evaluate('true or skipped', ctx)).toBe(true);
      expect(ctx).not.toHaveBeenCalled();

      expect(evaluate('true and checked', ctx)).toBe(true);
      expect(ctx).toHaveBeenCalledWith('checked');
    });
  });

  describe('IS NULL / IS NOT NULL', () => {
    it('checks strict equality against null', () => {
      const values: Record<string, unknown> = {
        nil: null,
        undef: undefined,
        zero: 0,
        empty: '',
        flag: false,
        text: 'ok',
      };
      const ctx = (name: string) => values[name];

      expect(evaluate('nil is null', ctx)).toBe(true);
      expect(evaluate('nil is not null', ctx)).toBe(false);

      expect(evaluate('undef is null', ctx)).toBe(false);
      expect(evaluate('undef is not null', ctx)).toBe(true);

      expect(evaluate('zero is null', ctx)).toBe(false);
      expect(evaluate('empty is null', ctx)).toBe(false);
      expect(evaluate('flag is null', ctx)).toBe(false);
      expect(evaluate('text is not null', ctx)).toBe(true);
    });

    it('combines with logical operators', () => {
      const ctx = (name: string) => (name === 'a' ? null : 'value');
      expect(evaluate('a is null and b is not null', ctx)).toBe(true);
      expect(evaluate('a is not null or b is not null', ctx)).toBe(true);
    });
  });

  describe('BETWEEN', () => {
    it('matches values inclusively within numeric bounds', () => {
      expect(evaluate('x between 1 and 10', () => 1)).toBe(true);
      expect(evaluate('x between 1 and 10', () => 5)).toBe(true);
      expect(evaluate('x between 1 and 10', () => 10)).toBe(true);
      expect(evaluate('x between 1 and 10', () => 0)).toBe(false);
      expect(evaluate('x between 1 and 10', () => 11)).toBe(false);
    });

    it('supports decimal bounds and computed left-hand expressions', () => {
      expect(evaluate('x between 1.5 and 3.5', () => 2.5)).toBe(true);
      expect(evaluate('x between 1.5 and 3.5', () => 1.49)).toBe(false);
      expect(evaluate('a + b between 10 and 20', (name) => (name === 'a' ? 6 : 8))).toBe(true);
      expect(evaluate('a + b between 10 and 20', (name) => (name === 'a' ? 15 : 8))).toBe(false);
    });
  });

  describe('CASE expressions', () => {
    const gradeExpr =
      "case when score >= 90 then 'A' when score >= 80 then 'B' when score >= 70 then 'C' else 'F' end";

    it('returns the THEN expression of the first matching WHEN clause', () => {
      expect(evaluate(gradeExpr, () => 95)).toBe('A');
      expect(evaluate(gradeExpr, () => 85)).toBe('B');
      expect(evaluate(gradeExpr, () => 70)).toBe('C');
      expect(evaluate(gradeExpr, () => 50)).toBe('F');
    });

    it('returns false when no WHEN matches and ELSE is omitted', () => {
      expect(evaluate("case when x > 10 then 'big' end", () => 5)).toBe(false);
      expect(evaluate("case when x > 10 then 'big' end", () => 20)).toBe('big');
    });

    it('returns falsy values from ELSE without falling back to false', () => {
      expect(evaluate('case when flag then 1 else 0 end', () => false)).toBe(0);
      expect(evaluate("case when flag then 'yes' else '' end", () => false)).toBe('');
    });

    it('short-circuits subsequent WHEN branches after a match', () => {
      const ctx = vi.fn((name: string) => {
        if (name === 'a') return true;
        if (name === 'first') return 'hit';
        return 'other';
      });

      expect(evaluate('case when a then first when b then second else third end', ctx)).toBe('hit');
      expect(ctx.mock.calls.map(([name]) => name)).toEqual(['a', 'first']);
    });

    it('supports nested CASE expressions and CASE inside larger expressions', () => {
      const nested =
        'case when a then case when b then 1 else 2 end else 3 end';
      expect(evaluate(nested, (n) => n === 'a' || n === 'b')).toBe(1);
      expect(evaluate(nested, (n) => n === 'a')).toBe(2);
      expect(evaluate(nested, () => false)).toBe(3);

      expect(evaluate('case when x > 0 then 1 else 0 end + 10', () => 5)).toBe(11);
      expect(evaluate('case when x > 0 then 1 else 0 end + 10', () => 0)).toBe(10);
    });
  });

  describe('functions', () => {
    it('evaluates length() on strings, arrays, and computed expressions', () => {
      expect(evaluate("length('hello')")).toBe(5);
      expect(evaluate("length('')")).toBe(0);
      expect(evaluate("length('ab' + 'cde')")).toBe(5);
      expect(evaluate('length(items)', () => [1, 2, 3])).toBe(3);
      expect(evaluate('length(name) >= 4', () => 'Alice')).toBe(true);
    });

    it('throws when length() is called without an argument', () => {
      expect(() => evaluate('length()')).toThrow('Length function takes exactly one argument.');
    });

    it('throws for unimplemented or wrong-case function names', () => {
      expect(() => evaluate("upper('abc')")).toThrow('Function upper not implemented');
      expect(() => evaluate("LENGTH('abc')")).toThrow('Function LENGTH not implemented');
    });
  });

  describe('context handling', () => {
    it('resolves identifiers through the provided context callback', () => {
      const ctx = vi.fn((name: string) => ({ price: 25, qty: 4 }[name]));
      expect(evaluate('price * qty', ctx)).toBe(100);
      expect(ctx).toHaveBeenCalledWith('price');
      expect(ctx).toHaveBeenCalledWith('qty');
    });

    it('throws if an identifier is evaluated without a context callback', () => {
      expect(() => evaluate('x + 1')).toThrow(TypeError);
    });
  });
});

describe('evaluateObject', () => {
  it('evaluates SQL-like WHERE clauses against an object', () => {
    const user = {
      name: 'Alice',
      age: 30,
      status: 'active',
      deleted_at: null,
      roles: ['admin', 'editor'],
    };

    expect(
      evaluateObject(
        "status = 'active' and age between 18 and 65 and length(name) > 2 and deleted_at is null",
        user,
      ),
    ).toBe(true);

    expect(evaluateObject('length(roles) = 2 and age >= 30', user)).toBe(true);
    expect(evaluateObject("status = 'inactive' or age < 18", user)).toBe(false);
  });

  it('handles missing properties as undefined', () => {
    expect(evaluateObject('missing = 1', {})).toBe(false);
    expect(evaluateObject('missing is null', {})).toBe(false);
    expect(evaluateObject('missing is not null', {})).toBe(true);
  });

  it('filters a collection of records with complex conditions', () => {
    const products = [
      { name: 'Pen', price: 2, stock: 50, discontinued_at: null },
      { name: 'Notebook', price: 12, stock: 0, discontinued_at: null },
      { name: 'Lamp', price: 45, stock: 8, discontinued_at: '2025-01-01' },
      { name: 'Backpack', price: 60, stock: 15, discontinued_at: null },
    ];

    const availableInBudget = products.filter((p) =>
      evaluateObject('price between 1 and 50 and stock > 0 and discontinued_at is null', p),
    );

    expect(availableInBudget.map((p) => p.name)).toEqual(['Pen']);
  });

  it('computes derived values from object fields using CASE', () => {
    const tierExpr =
      "case when total >= 1000 then 'gold' when total >= 500 then 'silver' else 'bronze' end";

    expect(evaluateObject(tierExpr, { total: 1200 })).toBe('gold');
    expect(evaluateObject(tierExpr, { total: 500 })).toBe('silver');
    expect(evaluateObject(tierExpr, { total: 99 })).toBe('bronze');
  });
});

```

### Notable implementation behaviors reflected in the tests

* **`or` vs. `and` precedence (`src/parser.ts`)**: `precedences` assigns `And = 1` and `Or = 2`, so `or` binds tighter than `and` unless parenthesized.
* **Function arguments (`src/parser.ts`)**: `parseCallExpression` does not advance past `,` before parsing the next argument, so only 0- and 1-argument calls parse cleanly; the 0-argument case is used to exercise the arity check in `evaluateFunctionCall`.
* **No prefix `-`, `not`, or standalone `null` (`src/parser.ts`)**: None of those tokens are registered in `prefixParsers`, so they throw `Unexpected start of expression`.
* **Identifiers (`src/lexer.ts`)**: `isLetter` matches `A-Z`, `a-z`, and `_` (no digits).