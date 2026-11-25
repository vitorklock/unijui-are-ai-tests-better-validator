import { describe, expect, it, vi } from 'vitest';
import { evaluate, evaluateObject } from '../src/evaluator';
import { parse } from '../src/parser';
import {
  BinaryExpression,
  CaseExpression,
  FunctionCallExpression,
  IdentifierExpression,
  ValueExpression,
} from '../src/ast';
import { TokenType } from '../src/token';

describe('evaluate', () => {
  describe('literals', () => {
    it('evaluates integer literals', () => {
      expect(evaluate('42')).toBe(42);
    });

    it('evaluates decimal literals', () => {
      expect(evaluate('3.25')).toBe(3.25);
    });

    it('evaluates decimal literals without a leading digit', () => {
      expect(evaluate('.5')).toBe(0.5);
    });

    it('evaluates single-quoted strings', () => {
      expect(evaluate("'hello'")).toBe('hello');
    });

    it('evaluates double-quoted strings', () => {
      expect(evaluate('"hello"')).toBe('hello');
    });

    it('evaluates empty strings', () => {
      expect(evaluate("''")).toBe('');
    });

    it('preserves whitespace and symbols inside strings', () => {
      expect(evaluate("'a + b = c'")).toBe('a + b = c');
    });

    it('allows the other quote style inside a string', () => {
      expect(evaluate(`"it's"`)).toBe("it's");
    });

    it('evaluates boolean literals', () => {
      expect(evaluate('true')).toBe(true);
      expect(evaluate('false')).toBe(false);
    });

    it('treats keywords case-insensitively', () => {
      expect(evaluate('TRUE')).toBe(true);
      expect(evaluate('False')).toBe(false);
    });

    it('ignores surrounding and interior whitespace', () => {
      expect(evaluate('  \t1 \n+\r\n 2  ')).toBe(3);
    });
  });

  describe('arithmetic', () => {
    it('adds', () => {
      expect(evaluate('1 + 2')).toBe(3);
    });

    it('subtracts', () => {
      expect(evaluate('10 - 4')).toBe(6);
    });

    it('multiplies', () => {
      expect(evaluate('6 * 7')).toBe(42);
    });

    it('divides', () => {
      expect(evaluate('9 / 3')).toBe(3);
    });

    it('yields Infinity when dividing by zero', () => {
      expect(evaluate('1 / 0')).toBe(Infinity);
    });

    it('handles decimals', () => {
      expect(evaluate('1.5 + 0.25')).toBe(1.75);
    });

    it('concatenates strings with +', () => {
      expect(evaluate("'foo' + 'bar'")).toBe('foobar');
    });

    it('gives * and / higher precedence than + and -', () => {
      expect(evaluate('1 + 2 * 3')).toBe(7);
      expect(evaluate('2 * 3 + 1')).toBe(7);
      expect(evaluate('10 - 6 / 2')).toBe(7);
    });

    it('is left-associative for same-precedence operators', () => {
      expect(evaluate('10 - 3 - 2')).toBe(5);
      expect(evaluate('100 / 10 / 2')).toBe(5);
    });

    it('respects parentheses', () => {
      expect(evaluate('(1 + 2) * 3')).toBe(9);
      expect(evaluate('2 * (3 + 4)')).toBe(14);
    });

    it('handles nested parentheses', () => {
      expect(evaluate('((1 + 2) * (3 + 4)) - 1')).toBe(20);
    });
  });

  describe('comparison', () => {
    it('compares with =', () => {
      expect(evaluate('1 = 1')).toBe(true);
      expect(evaluate('1 = 2')).toBe(false);
      expect(evaluate("'a' = 'a'")).toBe(true);
    });

    it('uses strict equality (no type coercion)', () => {
      expect(evaluate("1 = '1'")).toBe(false);
    });

    it('compares with <>', () => {
      expect(evaluate('1 <> 2')).toBe(true);
      expect(evaluate('1 <> 1')).toBe(false);
    });

    it('compares with < and <=', () => {
      expect(evaluate('1 < 2')).toBe(true);
      expect(evaluate('2 < 2')).toBe(false);
      expect(evaluate('2 <= 2')).toBe(true);
      expect(evaluate('3 <= 2')).toBe(false);
    });

    it('compares with > and >=', () => {
      expect(evaluate('2 > 1')).toBe(true);
      expect(evaluate('2 > 2')).toBe(false);
      expect(evaluate('2 >= 2')).toBe(true);
      expect(evaluate('1 >= 2')).toBe(false);
    });

    it('compares strings lexicographically', () => {
      expect(evaluate("'apple' < 'banana'")).toBe(true);
    });

    it('gives arithmetic higher precedence than comparison', () => {
      expect(evaluate('1 + 2 = 3')).toBe(true);
      expect(evaluate('2 * 3 > 5')).toBe(true);
      expect(evaluate('10 - 1 < 2 * 4')).toBe(false);
    });

    it('gives ordering comparisons higher precedence than equality', () => {
      expect(evaluate('1 < 2 = true')).toBe(true);
    });
  });

  describe('logical operators', () => {
    it('evaluates and', () => {
      expect(evaluate('true and true')).toBe(true);
      expect(evaluate('true and false')).toBe(false);
      expect(evaluate('false and false')).toBe(false);
    });

    it('evaluates or', () => {
      expect(evaluate('true or false')).toBe(true);
      expect(evaluate('false or true')).toBe(true);
      expect(evaluate('false or false')).toBe(false);
    });

    it('accepts upper-case AND / OR', () => {
      expect(evaluate('true AND false')).toBe(false);
      expect(evaluate('true OR false')).toBe(true);
    });

    it('gives comparison higher precedence than and / or', () => {
      expect(evaluate('1 < 2 and 3 < 4')).toBe(true);
      expect(evaluate('1 > 2 or 3 < 4')).toBe(true);
      expect(evaluate('1 > 2 and 3 < 4')).toBe(false);
    });

    it('respects parentheses when mixing and / or', () => {
      expect(evaluate('true or (false and false)')).toBe(true);
      expect(evaluate('(true or false) and false')).toBe(false);
    });

    it('short-circuits and when the left side is false', () => {
      const context = vi.fn();
      expect(evaluate('false and x', context)).toBe(false);
      expect(context).not.toHaveBeenCalled();
    });

    it('short-circuits or when the left side is true', () => {
      const context = vi.fn();
      expect(evaluate('true or x', context)).toBe(true);
      expect(context).not.toHaveBeenCalled();
    });
  });

  describe('identifiers and context', () => {
    it('resolves identifiers through the context function', () => {
      const context = (name: string) => ({ price: 10 } as Record<string, any>)[name];
      expect(evaluate('price * 2', context)).toBe(20);
    });

    it('passes the identifier name to the context function', () => {
      const context = vi.fn().mockReturnValue(5);
      expect(evaluate('qty + 1', context)).toBe(6);
      expect(context).toHaveBeenCalledTimes(1);
      expect(context).toHaveBeenCalledWith('qty');
    });

    it('resolves identifiers containing underscores', () => {
      const context = (name: string) => (name === 'first_name' ? 'Ada' : undefined);
      expect(evaluate("first_name = 'Ada'", context)).toBe(true);
    });

    it('calls the context once per identifier occurrence', () => {
      const context = vi.fn((name: string) => (name === 'a' ? 1 : 2));
      expect(evaluate('a + b + a', context)).toBe(4);
      expect(context).toHaveBeenCalledTimes(3);
    });

    it('throws when an identifier is used without a context', () => {
      expect(() => evaluate('x + 1')).toThrow();
    });
  });

  describe('between', () => {
    it('is inclusive on both bounds', () => {
      expect(evaluateObject('x between 1 and 10', { x: 1 })).toBe(true);
      expect(evaluateObject('x between 1 and 10', { x: 10 })).toBe(true);
      expect(evaluateObject('x between 1 and 10', { x: 5 })).toBe(true);
    });

    it('is false outside the range', () => {
      expect(evaluateObject('x between 1 and 10', { x: 0 })).toBe(false);
      expect(evaluateObject('x between 1 and 10', { x: 11 })).toBe(false);
    });

    it('supports decimal bounds', () => {
      expect(evaluateObject('x between 0.5 and 1.5', { x: 1 })).toBe(true);
    });

    it('can be combined with other conditions', () => {
      expect(evaluateObject("x between 1 and 10 and name = 'a'", { x: 5, name: 'a' })).toBe(true);
      expect(evaluateObject("x between 1 and 10 and name = 'a'", { x: 5, name: 'b' })).toBe(false);
    });

    it('requires numeric literal bounds', () => {
      expect(() => parse('x between lo and hi')).toThrow(/Expected NUM/);
    });

    it('requires the and keyword between bounds', () => {
      expect(() => parse('x between 1 10')).toThrow(/Expected and/);
    });
  });

  describe('is null / is not null', () => {
    it('is null is true for null values', () => {
      expect(evaluateObject('x is null', { x: null })).toBe(true);
    });

    it('is null is false for non-null values', () => {
      expect(evaluateObject('x is null', { x: 0 })).toBe(false);
      expect(evaluateObject('x is null', { x: '' })).toBe(false);
      expect(evaluateObject('x is null', { x: false })).toBe(false);
    });

    it('is not null inverts is null', () => {
      expect(evaluateObject('x is not null', { x: null })).toBe(false);
      expect(evaluateObject('x is not null', { x: 1 })).toBe(true);
    });

    it('can be combined with other conditions', () => {
      expect(evaluateObject('x is null or y > 1', { x: 1, y: 2 })).toBe(true);
      expect(evaluateObject('x is not null and y > 1', { x: null, y: 2 })).toBe(false);
    });

    it('requires null after is', () => {
      expect(() => parse('x is 5')).toThrow(/Expected null/);
    });
  });

  describe('case expressions', () => {
    const grade = "case when score >= 90 then 'A' when score >= 80 then 'B' else 'F' end";

    it('returns the then branch of the first matching when', () => {
      expect(evaluateObject(grade, { score: 95 })).toBe('A');
      expect(evaluateObject(grade, { score: 85 })).toBe('B');
    });

    it('returns the else branch when nothing matches', () => {
      expect(evaluateObject(grade, { score: 10 })).toBe('F');
    });

    it('returns false when nothing matches and there is no else', () => {
      expect(evaluateObject("case when x > 1 then 'big' end", { x: 0 })).toBe(false);
    });

    it('only evaluates the first matching branch', () => {
      expect(evaluateObject("case when x > 0 then 'first' when x > 0 then 'second' end", { x: 1 })).toBe('first');
    });

    it('supports a single when with else', () => {
      expect(evaluateObject('case when flag then 1 else 2 end', { flag: true })).toBe(1);
      expect(evaluateObject('case when flag then 1 else 2 end', { flag: false })).toBe(2);
    });

    it('allows arbitrary expressions in then and else', () => {
      expect(evaluateObject('case when x > 1 then x * 10 else x + 1 end', { x: 2 })).toBe(20);
      expect(evaluateObject('case when x > 1 then x * 10 else x + 1 end', { x: 1 })).toBe(2);
    });

    it('accepts upper-case keywords', () => {
      expect(evaluateObject("CASE WHEN x > 1 THEN 'yes' ELSE 'no' END", { x: 2 })).toBe('yes');
    });

    it('can be used as an operand', () => {
      expect(evaluate('(case when true then 1 else 2 end) + 10')).toBe(11);
      expect(evaluate('case when false then 1 else 2 end + 10')).toBe(12);
    });

    it('can be nested', () => {
      const nested = "case when x > 0 then case when x > 10 then 'large' else 'small' end else 'negative' end";
      expect(evaluateObject(nested, { x: 20 })).toBe('large');
      expect(evaluateObject(nested, { x: 5 })).toBe('small');
      expect(evaluateObject(nested, { x: -1 })).toBe('negative');
    });

    it('requires at least one when clause', () => {
      expect(() => parse('case end')).toThrow(/Expected when/);
      expect(() => parse("case else 'x' end")).toThrow(/Expected when/);
    });

    it('requires then after the when condition', () => {
      expect(() => parse('case when true 1 end')).toThrow(/Expected then/);
    });

    it('requires end', () => {
      expect(() => parse('case when true then 1 else 2')).toThrow(/Expected end/);
      expect(() => parse('case when true then 1')).toThrow();
    });
  });

  describe('function calls', () => {
    it('length returns the length of a string literal', () => {
      expect(evaluate("length('hello')")).toBe(5);
    });

    it('length returns the length of a string from context', () => {
      expect(evaluateObject('length(name)', { name: 'abc' })).toBe(3);
    });

    it('length returns the length of an array from context', () => {
      expect(evaluateObject('length(items)', { items: [1, 2, 3, 4] })).toBe(4);
    });

    it('function results can be used in larger expressions', () => {
      expect(evaluateObject('length(name) > 3', { name: 'abcd' })).toBe(true);
      expect(evaluateObject('length(name) * 2', { name: 'ab' })).toBe(4);
    });

    it('evaluates expressions passed as arguments', () => {
      expect(evaluate("length('ab' + 'cd')")).toBe(4);
    });

    it('throws when length is called with no arguments', () => {
      expect(() => evaluate('length()')).toThrow(/exactly one argument/);
    });

    it('throws when length is called with more than one argument', () => {
      expect(() => evaluate("length('a', 'b')")).toThrow();
    });

    it('throws for unknown functions', () => {
      expect(() => evaluate('upper(1)')).toThrow(/Function upper not implemented/);
    });
  });

  describe('parse errors', () => {
    it('throws on an empty expression', () => {
      expect(() => evaluate('')).toThrow(/Unexpected start of expression/);
    });

    it('throws on whitespace-only input', () => {
      expect(() => evaluate('   ')).toThrow(/Unexpected start of expression/);
    });

    it('throws when an expression starts with an operator', () => {
      expect(() => evaluate('* 2')).toThrow(/Unexpected start of expression/);
      expect(() => evaluate(') 2')).toThrow(/Unexpected start of expression/);
    });

    it('throws on an unclosed parenthesis', () => {
      expect(() => evaluate('(1 + 2')).toThrow(/Expected \)/);
    });

    it('throws on a dangling binary operator', () => {
      expect(() => evaluate('1 +')).toThrow(/Unexpected start of expression/);
    });

    it('throws on illegal characters', () => {
      expect(() => evaluate('$')).toThrow();
      expect(() => evaluate('1 + $')).toThrow(/Invalid input/);
      expect(() => evaluate('1 + #2')).toThrow(/Invalid input/);
    });
  });
});

describe('evaluateObject', () => {
  it('resolves identifiers as properties of the given object', () => {
    expect(evaluateObject('a + b', { a: 1, b: 2 })).toBe(3);
  });

  it('returns undefined for missing properties', () => {
    expect(evaluateObject('missing', { a: 1 })).toBeUndefined();
  });

  it('evaluates a realistic WHERE-style predicate', () => {
    const row = { status: 'active', age: 34, country: 'BR', tags: ['a', 'b'] };
    const where = "status = 'active' and age between 18 and 65 and (country = 'BR' or country = 'AR') and length(tags) > 1";
    expect(evaluateObject(where, row)).toBe(true);
    expect(evaluateObject(where, { ...row, status: 'inactive' })).toBe(false);
    expect(evaluateObject(where, { ...row, age: 70 })).toBe(false);
    expect(evaluateObject(where, { ...row, country: 'US' })).toBe(false);
    expect(evaluateObject(where, { ...row, tags: [] })).toBe(false);
  });

  it('works with string-valued properties', () => {
    expect(evaluateObject("name = 'Ada'", { name: 'Ada' })).toBe(true);
    expect(evaluateObject("name <> 'Ada'", { name: 'Grace' })).toBe(true);
  });
});

describe('parse', () => {
  it('parses a numeric literal into a ValueExpression', () => {
    const ast = parse('42');
    expect(ast).toBeInstanceOf(ValueExpression);
    expect(ast).toStrictEqual(new ValueExpression(42));
  });

  it('parses a string literal into a ValueExpression holding a string', () => {
    expect(parse("'abc'")).toStrictEqual(new ValueExpression('abc'));
  });

  it('parses boolean literals', () => {
    expect(parse('true')).toStrictEqual(new ValueExpression(true));
    expect(parse('false')).toStrictEqual(new ValueExpression(false));
  });

  it('parses an identifier into an IdentifierExpression', () => {
    expect(parse('foo')).toStrictEqual(new IdentifierExpression('foo'));
  });

  it('parses a binary expression', () => {
    expect(parse('1 + 2')).toStrictEqual(
      new BinaryExpression(TokenType.Plus, new ValueExpression(1), new ValueExpression(2)),
    );
  });

  it('builds the tree according to precedence', () => {
    expect(parse('1 + 2 * 3')).toStrictEqual(
      new BinaryExpression(
        TokenType.Plus,
        new ValueExpression(1),
        new BinaryExpression(TokenType.Mul, new ValueExpression(2), new ValueExpression(3)),
      ),
    );
  });

  it('builds the tree according to parentheses', () => {
    expect(parse('(1 + 2) * 3')).toStrictEqual(
      new BinaryExpression(
        TokenType.Mul,
        new BinaryExpression(TokenType.Plus, new ValueExpression(1), new ValueExpression(2)),
        new ValueExpression(3),
      ),
    );
  });

  it('parses comparison operators with their token types', () => {
    expect(parse('a <> b')).toStrictEqual(
      new BinaryExpression(TokenType.Neq, new IdentifierExpression('a'), new IdentifierExpression('b')),
    );
    expect(parse('a >= b')).toStrictEqual(
      new BinaryExpression(TokenType.Gte, new IdentifierExpression('a'), new IdentifierExpression('b')),
    );
  });

  it('parses a function call with its arguments', () => {
    expect(parse("length('abc')")).toStrictEqual(
      new FunctionCallExpression('length', [new ValueExpression('abc')]),
    );
  });

  it('parses a function call with no arguments', () => {
    expect(parse('now()')).toStrictEqual(new FunctionCallExpression('now', []));
  });

  it('desugars between into a range check', () => {
    expect(parse('x between 1 and 5')).toStrictEqual(
      new BinaryExpression(
        TokenType.And,
        new BinaryExpression(TokenType.Gte, new IdentifierExpression('x'), new ValueExpression(1)),
        new BinaryExpression(TokenType.Lte, new IdentifierExpression('x'), new ValueExpression(5)),
      ),
    );
  });

  it('desugars is null into an equality check against null', () => {
    expect(parse('x is null')).toStrictEqual(
      new BinaryExpression(TokenType.Eq, new IdentifierExpression('x'), new ValueExpression(null)),
    );
  });

  it('desugars is not null into an inequality check against null', () => {
    expect(parse('x is not null')).toStrictEqual(
      new BinaryExpression(TokenType.Neq, new IdentifierExpression('x'), new ValueExpression(null)),
    );
  });

  it('parses a case expression with conditions and an else branch', () => {
    expect(parse('case when a then 1 when b then 2 else 3 end')).toStrictEqual(
      new CaseExpression(
        [
          { when: new IdentifierExpression('a'), then: new ValueExpression(1) },
          { when: new IdentifierExpression('b'), then: new ValueExpression(2) },
        ],
        new ValueExpression(3),
      ),
    );
  });

  it('parses a case expression without an else branch', () => {
    const ast = parse('case when a then 1 end');
    expect(ast).toBeInstanceOf(CaseExpression);
    expect((ast as CaseExpression).conditions).toHaveLength(1);
    expect((ast as CaseExpression).last).toBeUndefined();
  });
});
