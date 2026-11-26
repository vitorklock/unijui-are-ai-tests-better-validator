// tests/expression-parser.test.ts
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
    it('parses numeric literals (integers, decimals, leading-dot decimals)', () => {
      expect(parse('42')).toEqual(new ValueExpression(42));
      expect(parse('3.14')).toEqual(new ValueExpression(3.14));
      expect(parse('.5')).toEqual(new ValueExpression(0.5));
    });

    it('parses single- and double-quoted string literals', () => {
      expect(parse("'hello'")).toEqual(new ValueExpression('hello'));
      expect(parse('"world"')).toEqual(new ValueExpression('world'));
      expect(parse("''")).toEqual(new ValueExpression(''));
    });

    it('parses boolean literals case-insensitively', () => {
      expect(parse('true')).toEqual(new ValueExpression(true));
      expect(parse('FALSE')).toEqual(new ValueExpression(false));
      expect(parse('True')).toEqual(new ValueExpression(true));
    });

    it('parses identifiers including underscores and mixed case', () => {
      expect(parse('age')).toEqual(new IdentifierExpression('age'));
      expect(parse('first_name')).toEqual(new IdentifierExpression('first_name'));
      expect(parse('userName')).toEqual(new IdentifierExpression('userName'));
    });

    it('ignores surrounding and internal whitespace', () => {
      expect(parse('  \n\t 1   +  2 \r\n ')).toEqual(
        new BinaryExpression(TokenType.Plus, new ValueExpression(1), new ValueExpression(2)),
      );
    });
  });

  describe('operators and precedence', () => {
    it('gives multiplication and division higher precedence than addition and subtraction', () => {
      expect(parse('1 + 2 * 3')).toEqual(
        new BinaryExpression(
          TokenType.Plus,
          new ValueExpression(1),
          new BinaryExpression(TokenType.Mul, new ValueExpression(2), new ValueExpression(3)),
        ),
      );
    });

    it('is left-associative for operators of equal precedence', () => {
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

    it('binds relational operators tighter than equality and logical operators', () => {
      expect(parse('a > 1 = true')).toEqual(
        new BinaryExpression(
          TokenType.Eq,
          new BinaryExpression(TokenType.Gt, new IdentifierExpression('a'), new ValueExpression(1)),
          new ValueExpression(true),
        ),
      );
    });

    it('gives OR higher precedence than AND per the parser precedence table', () => {
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
    it('desugars IS NULL and IS NOT NULL into equality/inequality with null', () => {
      expect(parse('x is null')).toEqual(
        new BinaryExpression(TokenType.Eq, new IdentifierExpression('x'), new ValueExpression(null)),
      );
      expect(parse('x IS NOT NULL')).toEqual(
        new BinaryExpression(TokenType.Neq, new IdentifierExpression('x'), new ValueExpression(null)),
      );
    });

    it('desugars BETWEEN into a compound >= AND <= expression', () => {
      expect(parse('age between 18 and 65')).toEqual(
        new BinaryExpression(
          TokenType.And,
          new BinaryExpression(TokenType.Gte, new IdentifierExpression('age'), new ValueExpression(18)),
          new BinaryExpression(TokenType.Lte, new IdentifierExpression('age'), new ValueExpression(65)),
        ),
      );
    });

    it('parses function calls with zero or one argument', () => {
      expect(parse('now()')).toEqual(new FunctionCallExpression('now', []));
      expect(parse('length(name)')).toEqual(
        new FunctionCallExpression('length', [new IdentifierExpression('name')]),
      );
    });

    it('parses CASE expressions with multiple WHEN clauses and optional ELSE', () => {
      expect(parse("case when x > 0 then 'pos' when x < 0 then 'neg' else 'zero' end")).toEqual(
        new CaseExpression(
          [
            {
              when: new BinaryExpression(TokenType.Gt, new IdentifierExpression('x'), new ValueExpression(0)),
              then: new ValueExpression('pos'),
            },
            {
              when: new BinaryExpression(TokenType.Lt, new IdentifierExpression('x'), new ValueExpression(0)),
              then: new ValueExpression('neg'),
            },
          ],
          new ValueExpression('zero'),
        ),
      );

      expect(parse('CASE WHEN active THEN 1 END')).toEqual(
        new CaseExpression(
          [{ when: new IdentifierExpression('active'), then: new ValueExpression(1) }],
          undefined,
        ),
      );
    });
  });

  describe('syntax errors', () => {
    it('throws on empty input or unexpected starting token', () => {
      expect(() => parse('')).toThrow(/Unexpected start of expression/);
      expect(() => parse('+ 1')).toThrow(/Unexpected start of expression/);
      expect(() => parse('-5')).toThrow(/Unexpected start of expression/);
    });

    it('throws on illegal characters', () => {
      expect(() => parse('@')).toThrow(/Unexpected start of expression/);
      expect(() => parse('1 + @')).toThrow(/Invalid input/);
    });

    it('throws on unclosed parentheses', () => {
      expect(() => parse('(1 + 2')).toThrow(/Expected \)/);
    });

    it('throws on malformed IS expressions', () => {
      expect(() => parse('x is 5')).toThrow(/Expected null/);
      expect(() => parse('x is not 5')).toThrow(/Expected null/);
    });

    it('throws on malformed BETWEEN expressions', () => {
      expect(() => parse("x between 'a' and 'z'")).toThrow(/Expected NUM/);
      expect(() => parse('x between 1 or 10')).toThrow(/Expected and/);
      expect(() => parse('x between 1 and')).toThrow(/Expected NUM/);
    });

    it('throws on malformed CASE expressions', () => {
      expect(() => parse('case else 1 end')).toThrow(/Expected when/);
      expect(() => parse('case when true 1 end')).toThrow(/Expected then/);
      expect(() => parse('case when true then 1')).toThrow(/Expected end/);
    });

    it('throws on malformed function call arguments', () => {
      expect(() => parse('length(a b)')).toThrow(/Expected , or \)/);
    });
  });
});

describe('evaluate', () => {
  describe('literals and arithmetic', () => {
    it('evaluates literal values without a context', () => {
      expect(evaluate('42')).toBe(42);
      expect(evaluate('3.5')).toBe(3.5);
      expect(evaluate("'abc'")).toBe('abc');
      expect(evaluate('true')).toBe(true);
      expect(evaluate('false')).toBe(false);
    });

    it('evaluates arithmetic operations with correct precedence and associativity', () => {
      expect(evaluate('2 + 3 * 4')).toBe(14);
      expect(evaluate('(2 + 3) * 4')).toBe(20);
      expect(evaluate('10 - 3 - 2')).toBe(5);
      expect(evaluate('20 / 4 / 2')).toBe(2.5);
      expect(evaluate('((1 + 2) * (6 - 2)) / 3')).toBe(4);
    });

    it('concatenates strings with +', () => {
      expect(evaluate("'foo' + 'bar'")).toBe('foobar');
    });
  });

  describe('comparisons', () => {
    it('evaluates equality and inequality strictly', () => {
      expect(evaluate('5 = 5')).toBe(true);
      expect(evaluate("5 = '5'")).toBe(false);
      expect(evaluate('5 <> 6')).toBe(true);
      expect(evaluate("'a' <> 'a'")).toBe(false);
    });

    it('evaluates relational operators', () => {
      expect(evaluate('10 > 5')).toBe(true);
      expect(evaluate('5 > 5')).toBe(false);
      expect(evaluate('5 >= 5')).toBe(true);
      expect(evaluate('3 < 5')).toBe(true);
      expect(evaluate('5 < 5')).toBe(false);
      expect(evaluate('5 <= 5')).toBe(true);
    });
  });

  describe('logical operators', () => {
    it('evaluates AND and OR', () => {
      expect(evaluate('true and true')).toBe(true);
      expect(evaluate('true and false')).toBe(false);
      expect(evaluate('false or true')).toBe(true);
      expect(evaluate('false or false')).toBe(false);
    });

    it('respects OR binding tighter than AND unless grouped', () => {
      expect(evaluate('true or false and false')).toBe(false);
      expect(evaluate('true or (false and false)')).toBe(true);
    });

    it('short-circuits AND and OR evaluation', () => {
      expect(evaluate('false and unknown()')).toBe(false);
      expect(evaluate('true or unknown()')).toBe(true);
    });
  });

  describe('IS NULL / IS NOT NULL and BETWEEN', () => {
    it('checks null strictly with IS NULL and IS NOT NULL', () => {
      const ctx = (name: string) => (name === 'empty' ? null : name === 'undef' ? undefined : 1);
      expect(evaluate('empty is null', ctx)).toBe(true);
      expect(evaluate('empty is not null', ctx)).toBe(false);
      expect(evaluate('val is null', ctx)).toBe(false);
      expect(evaluate('val is not null', ctx)).toBe(true);
      expect(evaluate('undef is null', ctx)).toBe(false);
    });

    it('evaluates BETWEEN inclusively for integers and decimals', () => {
      expect(evaluate('5 between 1 and 10')).toBe(true);
      expect(evaluate('1 between 1 and 10')).toBe(true);
      expect(evaluate('10 between 1 and 10')).toBe(true);
      expect(evaluate('0 between 1 and 10')).toBe(false);
      expect(evaluate('11 between 1 and 10')).toBe(false);
      expect(evaluate('2.5 between 1.5 and 3.5')).toBe(true);
    });
  });

  describe('CASE expressions', () => {
    it('returns the THEN value of the first matching WHEN clause', () => {
      const expr = "case when score >= 90 then 'A' when score >= 80 then 'B' else 'C' end";
      expect(evaluate(expr, () => 95)).toBe('A');
      expect(evaluate(expr, () => 85)).toBe('B');
      expect(evaluate(expr, () => 70)).toBe('C');
    });

    it('returns false when no WHEN clause matches and no ELSE is provided', () => {
      expect(evaluate("case when x > 10 then 'big' end", () => 5)).toBe(false);
    });

    it('supports CASE expressions inside larger expressions', () => {
      expect(evaluate('(case when x > 0 then 10 else 0 end) + 5', () => 3)).toBe(15);
    });
  });

  describe('functions', () => {
    it('evaluates length() on strings and arrays', () => {
      expect(evaluate("length('hello')")).toBe(5);
      expect(evaluate("length('')")).toBe(0);
      expect(evaluate('length(items)', () => [1, 2, 3])).toBe(3);
      expect(evaluate("length('ab' + 'cde')")).toBe(5);
    });

    it('throws when length() receives zero arguments', () => {
      expect(() => evaluate('length()')).toThrow('Length function takes exactly one argument.');
    });

    it('throws on unimplemented functions', () => {
      expect(() => evaluate("upper('abc')")).toThrow('Function upper not implemented');
    });
  });

  describe('context callback', () => {
    it('resolves identifiers through the provided context function', () => {
      const lookup = (name: string) => ({ price: 25, qty: 4 }[name]);
      expect(evaluate('price * qty = 100', lookup)).toBe(true);
    });

    it('throws when an identifier is evaluated without a context', () => {
      expect(() => evaluate('x = 1')).toThrow(TypeError);
    });
  });
});

describe('evaluateObject', () => {
  it('evaluates SQL-like WHERE clauses against an object', () => {
    const user = {
      name: 'Alice',
      age: 30,
      role: 'admin',
      deleted_at: null,
      tags: ['core', 'ops'],
    };

    expect(evaluateObject("role = 'admin' and age between 18 and 65", user)).toBe(true);
    expect(evaluateObject('deleted_at is null and length(name) = 5', user)).toBe(true);
    expect(evaluateObject('length(tags) >= 2 and deleted_at is not null', user)).toBe(false);
  });

  it('evaluates CASE expressions using object properties', () => {
    const expr = "case when total >= 100 then 'free' else 'standard' end";
    expect(evaluateObject(expr, { total: 150 })).toBe('free');
    expect(evaluateObject(expr, { total: 40 })).toBe('standard');
  });

  it('treats missing object properties as undefined', () => {
    expect(evaluateObject('missing is null', {})).toBe(false);
    expect(evaluateObject('missing is not null', {})).toBe(true);
    expect(evaluateObject("missing = 'x'", {})).toBe(false);
  });
});

