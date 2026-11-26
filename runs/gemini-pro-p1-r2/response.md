Here is the complete Vitest unit test suite for `tests/expression-parser.test.ts`, covering `parse`, `evaluate`, and `evaluateObject` across literals, operators, precedence, SQL-like clauses, function calls, `CASE` expressions, context resolution, and error handling.

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

describe('parse', () => {
  it('parses literals and identifiers into the expected AST nodes', () => {
    const num = parse('42');
    expect(num).toBeInstanceOf(ValueExpression);
    expect(num).toEqual(new ValueExpression(42));

    const decimal = parse('3.14');
    expect(decimal).toEqual(new ValueExpression(3.14));

    const leadingDot = parse('.5');
    expect(leadingDot).toEqual(new ValueExpression(0.5));

    const singleQuoted = parse("'hello'");
    expect(singleQuoted).toEqual(new ValueExpression('hello'));

    const doubleQuoted = parse('"world"');
    expect(doubleQuoted).toEqual(new ValueExpression('world'));

    const boolTrue = parse('true');
    expect(boolTrue).toEqual(new ValueExpression(true));

    const boolFalse = parse('FALSE');
    expect(boolFalse).toEqual(new ValueExpression(false));

    const ident = parse('user_name');
    expect(ident).toBeInstanceOf(IdentifierExpression);
    expect(ident).toEqual(new IdentifierExpression('user_name'));
  });

  it('respects operator precedence and parentheses in the AST', () => {
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

  it('parses IS NULL and IS NOT NULL as equality/inequality with null', () => {
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

  it('desugars BETWEEN into inclusive GTE and LTE comparisons', () => {
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

  it('parses function calls', () => {
    expect(parse("length('abc')")).toEqual(
      new FunctionCallExpression('length', [new ValueExpression('abc')]),
    );

    expect(parse('length()')).toEqual(new FunctionCallExpression('length', []));
  });

  it('parses CASE expressions with and without ELSE', () => {
    expect(parse("case when x = 1 then 'one' else 'other' end")).toEqual(
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
        ],
        new ValueExpression('other'),
      ),
    );

    expect(parse("case when x = 1 then 'one' end")).toEqual(
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
        ],
        undefined,
      ),
    );
  });

  it('parses OR with higher precedence than AND per the precedence table', () => {
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

describe('evaluate', () => {
  describe('literals and whitespace', () => {
    it('evaluates numbers, strings, and booleans', () => {
      expect(evaluate('0')).toBe(0);
      expect(evaluate('42')).toBe(42);
      expect(evaluate('3.14')).toBe(3.14);
      expect(evaluate('.25')).toBe(0.25);
      expect(evaluate("''")).toBe('');
      expect(evaluate('""')).toBe('');
      expect(evaluate("'hello world'")).toBe('hello world');
      expect(evaluate('"quoted text"')).toBe('quoted text');
      expect(evaluate('true')).toBe(true);
      expect(evaluate('false')).toBe(false);
      expect(evaluate('True')).toBe(true);
      expect(evaluate('FALSE')).toBe(false);
    });

    it('ignores arbitrary whitespace including tabs and newlines', () => {
      expect(evaluate('  1  +\n\t2\r\n* 3 ')).toBe(7);
    });
  });

  describe('arithmetic', () => {
    it('evaluates addition, subtraction, multiplication, and division', () => {
      expect(evaluate('2 + 3')).toBe(5);
      expect(evaluate('10 - 4')).toBe(6);
      expect(evaluate('6 * 7')).toBe(42);
      expect(evaluate('20 / 4')).toBe(5);
      expect(evaluate('7 / 2')).toBe(3.5);
    });

    it('follows arithmetic precedence, left-associativity, and grouping', () => {
      expect(evaluate('2 + 3 * 4')).toBe(14);
      expect(evaluate('(2 + 3) * 4')).toBe(20);
      expect(evaluate('10 - 3 - 2')).toBe(5);
      expect(evaluate('20 / 4 / 2')).toBe(2.5);
      expect(evaluate('((1 + 2) * (3 + 4)) - 5')).toBe(16);
    });

    it('supports string concatenation with +', () => {
      expect(evaluate("'foo' + ' ' + 'bar'")).toBe('foo bar');
    });
  });

  describe('comparisons', () => {
    it('evaluates equality and inequality strictly', () => {
      expect(evaluate('5 = 5')).toBe(true);
      expect(evaluate('5 = 6')).toBe(false);
      expect(evaluate("5 = '5'")).toBe(false);
      expect(evaluate("'abc' = 'abc'")).toBe(true);
      expect(evaluate('5 <> 6')).toBe(true);
      expect(evaluate('5 <> 5')).toBe(false);
      expect(evaluate("5 <> '5'")).toBe(true);
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

    it('evaluates arithmetic before comparisons', () => {
      expect(evaluate('2 + 3 = 5')).toBe(true);
      expect(evaluate('2 * 3 > 5')).toBe(true);
      expect(evaluate('10 - 2 <= 8')).toBe(true);
    });
  });

  describe('logical operators', () => {
    it('evaluates AND and OR case-insensitively', () => {
      expect(evaluate('true and true')).toBe(true);
      expect(evaluate('true AND false')).toBe(false);
      expect(evaluate('false or true')).toBe(true);
      expect(evaluate('false OR false')).toBe(false);
    });

    it('respects parser precedence and parentheses for AND / OR', () => {
      expect(evaluate('false and true or true')).toBe(false);
      expect(evaluate('(false and true) or true')).toBe(true);
      expect(evaluate('true or false and false')).toBe(false);
      expect(evaluate('true or (false and false)')).toBe(true);
    });

    it('short-circuits AND and OR evaluation', () => {
      expect(evaluate('false and unimplemented()')).toBe(false);
      expect(evaluate('true or unimplemented()')).toBe(true);
    });
  });

  describe('IS NULL and IS NOT NULL', () => {
    it('checks strict equality with null', () => {
      const ctx = (name: string) =>
        ({
          nil: null,
          undef: undefined,
          zero: 0,
          empty: '',
          flag: false,
          text: 'value',
        })[name];

      expect(evaluate('nil is null', ctx)).toBe(true);
      expect(evaluate('nil IS NOT NULL', ctx)).toBe(false);
      expect(evaluate('undef is null', ctx)).toBe(false);
      expect(evaluate('undef is not null', ctx)).toBe(true);
      expect(evaluate('zero is null', ctx)).toBe(false);
      expect(evaluate('empty is null', ctx)).toBe(false);
      expect(evaluate('flag is null', ctx)).toBe(false);
      expect(evaluate('text is not null', ctx)).toBe(true);
    });
  });

  describe('BETWEEN', () => {
    it('checks inclusive numeric bounds', () => {
      expect(evaluate('x between 1 and 10', () => 1)).toBe(true);
      expect(evaluate('x between 1 and 10', () => 5)).toBe(true);
      expect(evaluate('x between 1 and 10', () => 10)).toBe(true);
      expect(evaluate('x between 1 and 10', () => 0)).toBe(false);
      expect(evaluate('x between 1 and 10', () => 11)).toBe(false);
    });

    it('supports decimals, case-insensitive keywords, and expressions on the left', () => {
      expect(evaluate('x BETWEEN 1.5 AND 3.5', () => 2.5)).toBe(true);
      expect(evaluate('x + 2 between 5 and 10', () => 4)).toBe(true);
      expect(evaluate('x + 2 between 5 and 10', () => 2)).toBe(false);
    });
  });

  describe('function calls', () => {
    it('evaluates length() on strings, arrays, and computed expressions', () => {
      expect(evaluate("length('hello')")).toBe(5);
      expect(evaluate("length('')")).toBe(0);
      expect(evaluate("length('foo' + 'bar')")).toBe(6);
      expect(evaluate('length(items)', () => [1, 2, 3])).toBe(3);
    });
  });

  describe('CASE expressions', () => {
    it('returns the first matching WHEN branch', () => {
      const expr =
        "case when score >= 90 then 'A' when score >= 80 then 'B' when score >= 70 then 'C' else 'F' end";

      expect(evaluate(expr, () => 95)).toBe('A');
      expect(evaluate(expr, () => 85)).toBe('B');
      expect(evaluate(expr, () => 70)).toBe('C');
      expect(evaluate(expr, () => 50)).toBe('F');
    });

    it('returns false when no WHEN branch matches and ELSE is omitted', () => {
      const expr = "CASE WHEN x = 1 THEN 'matched' END";

      expect(evaluate(expr, () => 1)).toBe('matched');
      expect(evaluate(expr, () => 2)).toBe(false);
    });

    it('evaluates expressions inside WHEN, THEN, and ELSE', () => {
      const expr = 'case when x > 0 then x * 2 else x + 10 end';

      expect(evaluate(expr, () => 5)).toBe(10);
      expect(evaluate(expr, () => 0)).toBe(10);
    });
  });

  describe('custom context function', () => {
    it('resolves identifiers via the provided callback', () => {
      const vars = new Map<string, unknown>([
        ['price', 25],
        ['qty', 4],
        ['discount', 10],
      ]);

      expect(evaluate('price * qty - discount', (id) => vars.get(id))).toBe(90);
    });
  });

  describe('error handling', () => {
    it('throws on empty or malformed expressions', () => {
      expect(() => parse('')).toThrow(/Unexpected start of expression/);
      expect(() => parse('(1 + 2')).toThrow(/Expected \)/);
      expect(() => parse('1 +')).toThrow(/Unexpected start of expression/);
      expect(() => parse('1 + @')).toThrow(/Invalid input/);
      expect(() => parse('@')).toThrow(/Unexpected start of expression/);
    });

    it('throws on unsupported prefix operators', () => {
      expect(() => parse('-5')).toThrow(/Unexpected start of expression/);
      expect(() => parse('not true')).toThrow(/Unexpected start of expression/);
    });

    it('throws on invalid IS, BETWEEN, and CASE syntax', () => {
      expect(() => parse('x is 5')).toThrow(/Expected null/);
      expect(() => parse('x is not 5')).toThrow(/Expected null/);
      expect(() => parse("x between 'a' and 'z'")).toThrow(/Expected NUM/);
      expect(() => parse('x between 1 or 10')).toThrow(/Expected and/);
      expect(() => parse('case end')).toThrow(/Expected when/);
      expect(() => parse("case when x = 1 'a' end")).toThrow(/Expected then/);
      expect(() => parse("case when x = 1 then 'a' else 'b'")).toThrow(/Expected end/);
    });

    it('throws on unimplemented functions and invalid argument counts', () => {
      expect(() => evaluate("unknown('a')")).toThrow('Function unknown not implemented');
      expect(() => evaluate('length()')).toThrow('Length function takes exactly one argument.');
    });

    it('throws when evaluating an identifier without a context', () => {
      expect(() => evaluate('x + 1')).toThrow(TypeError);
    });
  });
});

describe('evaluateObject', () => {
  it('evaluates SQL-like WHERE clauses against plain objects', () => {
    const query =
      "status = 'active' and (age between 18 and 65) and email is not null and length(name) > 2";

    expect(
      evaluateObject(query, {
        status: 'active',
        age: 30,
        email: 'alice@example.com',
        name: 'Alice',
      }),
    ).toBe(true);

    expect(
      evaluateObject(query, {
        status: 'inactive',
        age: 30,
        email: 'alice@example.com',
        name: 'Alice',
      }),
    ).toBe(false);

    expect(
      evaluateObject(query, {
        status: 'active',
        age: 16,
        email: 'bob@example.com',
        name: 'Bob',
      }),
    ).toBe(false);

    expect(
      evaluateObject(query, {
        status: 'active',
        age: 30,
        email: null,
        name: 'Alice',
      }),
    ).toBe(false);

    expect(
      evaluateObject(query, {
        status: 'active',
        age: 30,
        email: 'al@example.com',
        name: 'Al',
      }),
    ).toBe(false);
  });

  it('handles missing properties as undefined', () => {
    expect(evaluateObject('missing is null', {})).toBe(false);
    expect(evaluateObject('missing is not null', {})).toBe(true);
    expect(evaluateObject('missing = 1', {})).toBe(false);
  });

  it('supports CASE expressions with object properties', () => {
    const tierExpr =
      "case when total >= 1000 then 'gold' when total >= 500 then 'silver' else 'bronze' end";

    expect(evaluateObject(tierExpr, { total: 1200 })).toBe('gold');
    expect(evaluateObject(tierExpr, { total: 500 })).toBe('silver');
    expect(evaluateObject(tierExpr, { total: 100 })).toBe('bronze');
  });
});

```