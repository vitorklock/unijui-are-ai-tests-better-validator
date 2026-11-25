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

describe('parse', () => {
  describe('literals', () => {
    it('parses integer literals as numbers', () => {
      expect(parse('42')).toEqual(new ValueExpression(42));
    });

    it('parses decimal literals as numbers', () => {
      expect(parse('3.14')).toEqual(new ValueExpression(3.14));
    });

    it('parses a leading-dot decimal literal', () => {
      expect(parse('.5')).toEqual(new ValueExpression(0.5));
    });

    it('parses single-quoted strings', () => {
      expect(parse("'hello'")).toEqual(new ValueExpression('hello'));
    });

    it('parses double-quoted strings', () => {
      expect(parse('"hello"')).toEqual(new ValueExpression('hello'));
    });

    it('keeps spaces and the other quote style inside a string', () => {
      expect(parse('"it\'s a test"')).toEqual(new ValueExpression("it's a test"));
    });

    it('parses an empty string literal', () => {
      expect(parse("''")).toEqual(new ValueExpression(''));
    });

    it('parses boolean literals', () => {
      expect(parse('true')).toEqual(new ValueExpression(true));
      expect(parse('false')).toEqual(new ValueExpression(false));
    });

    it('treats keywords case-insensitively', () => {
      expect(parse('TRUE')).toEqual(new ValueExpression(true));
      expect(parse('False')).toEqual(new ValueExpression(false));
    });
  });

  describe('identifiers', () => {
    it('parses a bare identifier', () => {
      expect(parse('name')).toEqual(new IdentifierExpression('name'));
    });

    it('allows underscores in identifiers', () => {
      expect(parse('first_name')).toEqual(new IdentifierExpression('first_name'));
    });

    it('preserves identifier casing', () => {
      expect(parse('FirstName')).toEqual(new IdentifierExpression('FirstName'));
    });
  });

  describe('binary expressions', () => {
    it('parses addition into a BinaryExpression', () => {
      expect(parse('1 + 2')).toEqual(
        new BinaryExpression(TokenType.Plus, new ValueExpression(1), new ValueExpression(2)),
      );
    });

    it('parses each comparison operator', () => {
      const cases: [string, TokenType][] = [
        ['=', TokenType.Eq],
        ['<>', TokenType.Neq],
        ['<', TokenType.Lt],
        ['<=', TokenType.Lte],
        ['>', TokenType.Gt],
        ['>=', TokenType.Gte],
      ];
      for (const [symbol, type] of cases) {
        expect(parse(`a ${symbol} 1`)).toEqual(
          new BinaryExpression(type, new IdentifierExpression('a'), new ValueExpression(1)),
        );
      }
    });

    it('gives multiplication higher precedence than addition', () => {
      expect(parse('1 + 2 * 3')).toEqual(
        new BinaryExpression(
          TokenType.Plus,
          new ValueExpression(1),
          new BinaryExpression(TokenType.Mul, new ValueExpression(2), new ValueExpression(3)),
        ),
      );
    });

    it('lets parentheses override precedence', () => {
      expect(parse('(1 + 2) * 3')).toEqual(
        new BinaryExpression(
          TokenType.Mul,
          new BinaryExpression(TokenType.Plus, new ValueExpression(1), new ValueExpression(2)),
          new ValueExpression(3),
        ),
      );
    });

    it('is left-associative for same-precedence operators', () => {
      expect(parse('1 - 2 - 3')).toEqual(
        new BinaryExpression(
          TokenType.Minus,
          new BinaryExpression(TokenType.Minus, new ValueExpression(1), new ValueExpression(2)),
          new ValueExpression(3),
        ),
      );
    });

    it('binds arithmetic tighter than comparison', () => {
      expect(parse('a + 1 > 5')).toEqual(
        new BinaryExpression(
          TokenType.Gt,
          new BinaryExpression(TokenType.Plus, new IdentifierExpression('a'), new ValueExpression(1)),
          new ValueExpression(5),
        ),
      );
    });

    it('binds comparison tighter than and', () => {
      expect(parse('a > 1 and b < 2')).toEqual(
        new BinaryExpression(
          TokenType.And,
          new BinaryExpression(TokenType.Gt, new IdentifierExpression('a'), new ValueExpression(1)),
          new BinaryExpression(TokenType.Lt, new IdentifierExpression('b'), new ValueExpression(2)),
        ),
      );
    });

    it('ignores surrounding and internal whitespace', () => {
      expect(parse('  1\t+\n2  ')).toEqual(parse('1+2'));
    });
  });

  describe('is null / is not null', () => {
    it('rewrites "is null" to an equality against null', () => {
      expect(parse('a is null')).toEqual(
        new BinaryExpression(TokenType.Eq, new IdentifierExpression('a'), new ValueExpression(null)),
      );
    });

    it('rewrites "is not null" to an inequality against null', () => {
      expect(parse('a is not null')).toEqual(
        new BinaryExpression(TokenType.Neq, new IdentifierExpression('a'), new ValueExpression(null)),
      );
    });

    it('rejects "is" followed by anything other than null', () => {
      expect(() => parse('a is 5')).toThrow(/Expected null/);
    });
  });

  describe('between', () => {
    it('rewrites between to an inclusive range check', () => {
      expect(parse('a between 1 and 5')).toEqual(
        new BinaryExpression(
          TokenType.And,
          new BinaryExpression(TokenType.Gte, new IdentifierExpression('a'), new ValueExpression(1)),
          new BinaryExpression(TokenType.Lte, new IdentifierExpression('a'), new ValueExpression(5)),
        ),
      );
    });

    it('only accepts numeric bounds', () => {
      expect(() => parse("a between 'x' and 'y'")).toThrow(/Expected NUM/);
    });

    it('requires "and" between the bounds', () => {
      expect(() => parse('a between 1 or 5')).toThrow(/Expected and/);
    });
  });

  describe('function calls', () => {
    it('parses an identifier followed by parentheses as a call', () => {
      expect(parse('length(name)')).toEqual(
        new FunctionCallExpression('length', [new IdentifierExpression('name')]),
      );
    });

    it('parses a call with no arguments', () => {
      expect(parse('length()')).toEqual(new FunctionCallExpression('length', []));
    });

    it('parses a full expression as the argument', () => {
      expect(parse("length(a + 'x')")).toEqual(
        new FunctionCallExpression('length', [
          new BinaryExpression(TokenType.Plus, new IdentifierExpression('a'), new ValueExpression('x')),
        ]),
      );
    });

    it('rejects a call with junk after the argument', () => {
      expect(() => parse('length(a b)')).toThrow(/Expected , or \)/);
    });
  });

  describe('case expressions', () => {
    it('parses a single when/then with else', () => {
      expect(parse("case when a > 1 then 'big' else 'small' end")).toEqual(
        new CaseExpression(
          [
            {
              when: new BinaryExpression(TokenType.Gt, new IdentifierExpression('a'), new ValueExpression(1)),
              then: new ValueExpression('big'),
            },
          ],
          new ValueExpression('small'),
        ),
      );
    });

    it('parses multiple when/then branches without else', () => {
      const ast = parse('case when a then 1 when b then 2 end') as CaseExpression;
      expect(ast.type).toBe('CaseExpression');
      expect(ast.conditions).toHaveLength(2);
      expect(ast.conditions[0]).toEqual({ when: new IdentifierExpression('a'), then: new ValueExpression(1) });
      expect(ast.conditions[1]).toEqual({ when: new IdentifierExpression('b'), then: new ValueExpression(2) });
      expect(ast.last).toBeUndefined();
    });

    it('requires at least one when', () => {
      expect(() => parse('case end')).toThrow(/Expected when/);
    });

    it('requires a closing end', () => {
      expect(() => parse('case when a then 1 else 2')).toThrow(/Expected end/);
    });

    it('requires then after the condition', () => {
      expect(() => parse('case when a 1 end')).toThrow(/Expected then/);
    });
  });

  describe('syntax errors', () => {
    it('rejects an empty expression', () => {
      expect(() => parse('')).toThrow(/Unexpected start of expression/);
    });

    it('rejects a whitespace-only expression', () => {
      expect(() => parse('   ')).toThrow(/Unexpected start of expression/);
    });

    it('rejects a dangling binary operator', () => {
      expect(() => parse('1 +')).toThrow(/Unexpected start of expression/);
    });

    it('rejects two operators in a row', () => {
      expect(() => parse('1 + * 2')).toThrow(/Unexpected start of expression/);
    });

    it('rejects an unclosed parenthesis', () => {
      expect(() => parse('(1 + 2')).toThrow(/Expected \)/);
    });

    it('rejects an expression that starts with an operator', () => {
      expect(() => parse('* 2')).toThrow(/Unexpected start of expression/);
    });

    it('rejects an illegal character at the start', () => {
      expect(() => parse('@')).toThrow(/Unexpected start of expression/);
    });

    it('rejects an illegal character inside the expression', () => {
      expect(() => parse('1 + @')).toThrow(/Invalid input/);
    });
  });
});

describe('evaluate', () => {
  describe('literals', () => {
    it('returns numbers', () => {
      expect(evaluate('42')).toBe(42);
      expect(evaluate('2.5')).toBe(2.5);
    });

    it('returns strings', () => {
      expect(evaluate("'abc'")).toBe('abc');
      expect(evaluate('"abc"')).toBe('abc');
    });

    it('returns booleans', () => {
      expect(evaluate('true')).toBe(true);
      expect(evaluate('false')).toBe(false);
    });
  });

  describe('arithmetic', () => {
    it('adds', () => {
      expect(evaluate('1 + 2')).toBe(3);
    });

    it('subtracts', () => {
      expect(evaluate('5 - 7')).toBe(-2);
    });

    it('multiplies', () => {
      expect(evaluate('3 * 4')).toBe(12);
    });

    it('divides', () => {
      expect(evaluate('10 / 4')).toBe(2.5);
    });

    it('handles decimals', () => {
      expect(evaluate('1.5 + 2.5')).toBe(4);
    });

    it('respects operator precedence', () => {
      expect(evaluate('1 + 2 * 3')).toBe(7);
      expect(evaluate('2 * 3 + 4')).toBe(10);
      expect(evaluate('10 - 4 / 2')).toBe(8);
    });

    it('respects parentheses', () => {
      expect(evaluate('(1 + 2) * 3')).toBe(9);
      expect(evaluate('((2))')).toBe(2);
    });

    it('evaluates left to right for equal precedence', () => {
      expect(evaluate('10 - 3 - 2')).toBe(5);
      expect(evaluate('100 / 10 / 2')).toBe(5);
    });

    it('concatenates strings with +', () => {
      expect(evaluate("'foo' + 'bar'")).toBe('foobar');
    });

    it('returns Infinity when dividing by zero', () => {
      expect(evaluate('1 / 0')).toBe(Infinity);
    });
  });

  describe('comparison', () => {
    it('compares numbers for equality', () => {
      expect(evaluate('1 = 1')).toBe(true);
      expect(evaluate('1 = 2')).toBe(false);
    });

    it('compares strings for equality', () => {
      expect(evaluate("'a' = 'a'")).toBe(true);
      expect(evaluate("'a' = 'b'")).toBe(false);
    });

    it('uses strict equality across types', () => {
      expect(evaluate("1 = '1'")).toBe(false);
      expect(evaluate("1 <> '1'")).toBe(true);
    });

    it('supports inequality', () => {
      expect(evaluate('1 <> 2')).toBe(true);
      expect(evaluate('1 <> 1')).toBe(false);
    });

    it('supports ordering operators', () => {
      expect(evaluate('1 < 2')).toBe(true);
      expect(evaluate('2 < 1')).toBe(false);
      expect(evaluate('2 > 1')).toBe(true);
      expect(evaluate('1 > 2')).toBe(false);
      expect(evaluate('2 <= 2')).toBe(true);
      expect(evaluate('3 <= 2')).toBe(false);
      expect(evaluate('2 >= 2')).toBe(true);
      expect(evaluate('1 >= 2')).toBe(false);
    });

    it('compares the result of arithmetic', () => {
      expect(evaluate('1 + 1 = 2')).toBe(true);
      expect(evaluate('2 * 3 > 5')).toBe(true);
    });

    it('binds ordering tighter than equality', () => {
      expect(evaluate('1 < 2 = true')).toBe(true);
    });
  });

  describe('logical operators', () => {
    it('evaluates and', () => {
      expect(evaluate('true and true')).toBe(true);
      expect(evaluate('true and false')).toBe(false);
      expect(evaluate('false and true')).toBe(false);
    });

    it('evaluates or', () => {
      expect(evaluate('true or false')).toBe(true);
      expect(evaluate('false or true')).toBe(true);
      expect(evaluate('false or false')).toBe(false);
    });

    it('accepts uppercase keywords', () => {
      expect(evaluate('TRUE AND flag OR FALSE', () => true)).toBe(true);
      expect(evaluate('true AND false')).toBe(false);
      expect(evaluate('false Or true')).toBe(true);
    });

    it('combines comparisons', () => {
      expect(evaluate('1 < 2 and 3 > 2')).toBe(true);
      expect(evaluate('1 < 2 and 3 < 2')).toBe(false);
      expect(evaluate('1 > 2 or 3 > 2')).toBe(true);
    });

    it('honours explicit grouping of and/or', () => {
      expect(evaluate('(true or false) and false')).toBe(false);
      expect(evaluate('true or (false and false)')).toBe(true);
    });

    it('short-circuits and', () => {
      expect(evaluate('false and unknown_fn()')).toBe(false);
    });

    it('short-circuits or', () => {
      expect(evaluate('true or unknown_fn()')).toBe(true);
    });
  });

  describe('is null / is not null', () => {
    it('is null is true for null', () => {
      expect(evaluate('a is null', () => null)).toBe(true);
    });

    it('is null is false for a value', () => {
      expect(evaluate('a is null', () => 5)).toBe(false);
    });

    it('is not null is false for null', () => {
      expect(evaluate('a is not null', () => null)).toBe(false);
    });

    it('is not null is true for a value', () => {
      expect(evaluate('a is not null', () => 'x')).toBe(true);
    });

    it('applies to an arithmetic result', () => {
      expect(evaluate('a + 1 is not null', () => 1)).toBe(true);
    });

    it('composes with and', () => {
      expect(evaluate('a is not null and a > 3', () => 5)).toBe(true);
      expect(evaluate('a is not null and a > 3', () => 2)).toBe(false);
    });
  });

  describe('between', () => {
    const age = (value: number) => () => value;

    it('is true inside the range', () => {
      expect(evaluate('age between 18 and 65', age(30))).toBe(true);
    });

    it('is inclusive on both bounds', () => {
      expect(evaluate('age between 18 and 65', age(18))).toBe(true);
      expect(evaluate('age between 18 and 65', age(65))).toBe(true);
    });

    it('is false outside the range', () => {
      expect(evaluate('age between 18 and 65', age(17))).toBe(false);
      expect(evaluate('age between 18 and 65', age(66))).toBe(false);
    });

    it('accepts decimal bounds', () => {
      expect(evaluate('x between 0.5 and 1.5', () => 1)).toBe(true);
      expect(evaluate('x between 0.5 and 1.5', () => 2)).toBe(false);
    });

    it('composes with other conditions', () => {
      expect(evaluate('age between 18 and 65 and age <> 40', age(40))).toBe(false);
      expect(evaluate('age between 18 and 65 or age = 70', age(70))).toBe(true);
    });
  });

  describe('function calls', () => {
    it('length returns the length of a string', () => {
      expect(evaluate("length('hello')")).toBe(5);
      expect(evaluate("length('')")).toBe(0);
    });

    it('length returns the length of an array from context', () => {
      expect(evaluate('length(items)', () => [1, 2, 3])).toBe(3);
    });

    it('length can be used inside a larger expression', () => {
      expect(evaluate("length('abc') = 3")).toBe(true);
      expect(evaluate("1 + length('ab')")).toBe(3);
      expect(evaluate("length(name) > 3", () => 'Bob')).toBe(false);
    });

    it('length rejects zero arguments', () => {
      expect(() => evaluate('length()')).toThrow(/exactly one argument/);
    });

    it('throws for an unknown function', () => {
      expect(() => evaluate('upper(name)', () => 'x')).toThrow(/Function upper not implemented/);
    });
  });

  describe('case expressions', () => {
    const expr = "case when score >= 90 then 'A' when score >= 80 then 'B' else 'F' end";

    it('returns the first matching branch', () => {
      expect(evaluate(expr, () => 95)).toBe('A');
    });

    it('falls through to a later branch', () => {
      expect(evaluate(expr, () => 85)).toBe('B');
    });

    it('returns the else value when nothing matches', () => {
      expect(evaluate(expr, () => 10)).toBe('F');
    });

    it('returns false when nothing matches and there is no else', () => {
      expect(evaluate("case when a > 1 then 'yes' end", () => 0)).toBe(false);
    });

    it('treats the when condition by truthiness', () => {
      expect(evaluate("case when 1 then 'truthy' else 'falsy' end")).toBe('truthy');
      expect(evaluate("case when 0 then 'truthy' else 'falsy' end")).toBe('falsy');
    });

    it('evaluates expressions in then and else', () => {
      expect(evaluate('case when a > 0 then a * 2 else a - 1 end', () => 5)).toBe(10);
      expect(evaluate('case when a > 0 then a * 2 else a - 1 end', () => 0)).toBe(-1);
    });

    it('can be used as an operand', () => {
      expect(evaluate('(case when true then 1 else 2 end) + 1')).toBe(2);
      expect(evaluate('case when false then 1 else 2 end * 10')).toBe(20);
    });

    it('supports nesting', () => {
      const nested = "case when a then case when b then 'ab' else 'a' end else 'none' end";
      expect(evaluate(nested, (id) => ({ a: true, b: true } as Record<string, boolean>)[id])).toBe('ab');
      expect(evaluate(nested, (id) => ({ a: true, b: false } as Record<string, boolean>)[id])).toBe('a');
      expect(evaluate(nested, (id) => ({ a: false, b: true } as Record<string, boolean>)[id])).toBe('none');
    });

    it('accepts uppercase keywords', () => {
      expect(evaluate("CASE WHEN true THEN 'x' ELSE 'y' END")).toBe('x');
    });
  });

  describe('context', () => {
    it('resolves identifiers through the context function', () => {
      const context = vi.fn((name: string) => (name === 'a' ? 2 : 3));
      expect(evaluate('a * b', context)).toBe(6);
      expect(context).toHaveBeenCalledWith('a');
      expect(context).toHaveBeenCalledWith('b');
    });

    it('passes identifier names with their original casing', () => {
      const context = vi.fn(() => 1);
      evaluate('FirstName', context);
      expect(context).toHaveBeenCalledWith('FirstName');
    });

    it('does not call the context for literal-only expressions', () => {
      const context = vi.fn(() => 1);
      expect(evaluate('1 + 1', context)).toBe(2);
      expect(context).not.toHaveBeenCalled();
    });

    it('throws when an identifier is used without a context', () => {
      expect(() => evaluate('a + 1')).toThrow();
    });
  });

  describe('syntax errors', () => {
    it('propagates parse errors', () => {
      expect(() => evaluate('')).toThrow();
      expect(() => evaluate('1 +')).toThrow();
      expect(() => evaluate('(1')).toThrow();
      expect(() => evaluate('1 + $')).toThrow(/Invalid input/);
    });
  });
});

describe('evaluateObject', () => {
  const user = {
    name: 'Alice',
    age: 30,
    email: null,
    tags: ['admin', 'staff'],
    active: true,
  };

  it('reads properties from the object', () => {
    expect(evaluateObject('name', user)).toBe('Alice');
    expect(evaluateObject('age', user)).toBe(30);
  });

  it('evaluates a SQL-like where clause', () => {
    expect(evaluateObject("name = 'Alice' and age >= 18", user)).toBe(true);
    expect(evaluateObject("name = 'Bob' and age >= 18", user)).toBe(false);
  });

  it('supports is null on object properties', () => {
    expect(evaluateObject('email is null', user)).toBe(true);
    expect(evaluateObject('name is null', user)).toBe(false);
    expect(evaluateObject('name is not null', user)).toBe(true);
  });

  it('supports between on object properties', () => {
    expect(evaluateObject('age between 18 and 65', user)).toBe(true);
    expect(evaluateObject('age between 40 and 65', user)).toBe(false);
  });

  it('supports functions on object properties', () => {
    expect(evaluateObject('length(tags) = 2', user)).toBe(true);
    expect(evaluateObject('length(name) > 3', user)).toBe(true);
  });

  it('supports case expressions on object properties', () => {
    expect(evaluateObject("case when age < 18 then 'minor' else 'adult' end", user)).toBe('adult');
  });

  it('uses boolean properties directly', () => {
    expect(evaluateObject('active', user)).toBe(true);
    expect(evaluateObject("active and name = 'Alice'", user)).toBe(true);
  });

  it('returns undefined for a missing property', () => {
    expect(evaluateObject('missing', user)).toBeUndefined();
  });

  it('does not mutate the object', () => {
    const copy = { ...user, tags: [...user.tags] };
    evaluateObject("age + 1 > 30 and name = 'Alice'", user);
    expect(user).toEqual(copy);
  });
});
