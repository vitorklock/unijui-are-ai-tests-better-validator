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
  describe('literals and identifiers', () => {
    it('parses an integer literal', () => {
      expect(parse('42')).toEqual(new ValueExpression(42));
    });

    it('parses a decimal literal', () => {
      expect(parse('3.25')).toEqual(new ValueExpression(3.25));
    });

    it('parses a decimal literal with a leading dot', () => {
      expect(parse('.5')).toEqual(new ValueExpression(0.5));
    });

    it('parses a single-quoted string literal', () => {
      expect(parse("'hello'")).toEqual(new ValueExpression('hello'));
    });

    it('parses a double-quoted string literal', () => {
      expect(parse('"hello world"')).toEqual(new ValueExpression('hello world'));
    });

    it('keeps the other quote style inside a string', () => {
      expect(parse(`"it's"`)).toEqual(new ValueExpression("it's"));
    });

    it('parses boolean literals case-insensitively', () => {
      expect(parse('true')).toEqual(new ValueExpression(true));
      expect(parse('FALSE')).toEqual(new ValueExpression(false));
    });

    it('parses an identifier', () => {
      expect(parse('price')).toEqual(new IdentifierExpression('price'));
    });

    it('parses an identifier containing underscores', () => {
      expect(parse('first_name')).toEqual(new IdentifierExpression('first_name'));
    });

    it('preserves identifier case', () => {
      expect(parse('FirstName')).toEqual(new IdentifierExpression('FirstName'));
    });
  });

  describe('binary expressions', () => {
    it('parses an addition into a BinaryExpression', () => {
      const ast = parse('1 + 2');
      expect(ast).toBeInstanceOf(BinaryExpression);
      expect(ast).toEqual(
        new BinaryExpression(TokenType.Plus, new ValueExpression(1), new ValueExpression(2)),
      );
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

    it('is left-associative for operators of equal precedence', () => {
      expect(parse('10 - 2 - 3')).toEqual(
        new BinaryExpression(
          TokenType.Minus,
          new BinaryExpression(TokenType.Minus, new ValueExpression(10), new ValueExpression(2)),
          new ValueExpression(3),
        ),
      );
    });

    it('gives comparison lower precedence than arithmetic', () => {
      expect(parse('a + 1 > b * 2')).toEqual(
        new BinaryExpression(
          TokenType.Gt,
          new BinaryExpression(TokenType.Plus, new IdentifierExpression('a'), new ValueExpression(1)),
          new BinaryExpression(TokenType.Mul, new IdentifierExpression('b'), new ValueExpression(2)),
        ),
      );
    });

    it('gives logical operators lower precedence than comparison', () => {
      expect(parse('a > 1 and b < 2')).toEqual(
        new BinaryExpression(
          TokenType.And,
          new BinaryExpression(TokenType.Gt, new IdentifierExpression('a'), new ValueExpression(1)),
          new BinaryExpression(TokenType.Lt, new IdentifierExpression('b'), new ValueExpression(2)),
        ),
      );
    });

    it.each([
      ['=', TokenType.Eq],
      ['<>', TokenType.Neq],
      ['<', TokenType.Lt],
      ['<=', TokenType.Lte],
      ['>', TokenType.Gt],
      ['>=', TokenType.Gte],
    ])('parses the %s comparison operator', (symbol, type) => {
      expect(parse(`a ${symbol} 1`)).toEqual(
        new BinaryExpression(type, new IdentifierExpression('a'), new ValueExpression(1)),
      );
    });

    it('treats keywords case-insensitively', () => {
      expect(parse('a AND b')).toEqual(
        new BinaryExpression(TokenType.And, new IdentifierExpression('a'), new IdentifierExpression('b')),
      );
      expect(parse('a Or b')).toEqual(
        new BinaryExpression(TokenType.Or, new IdentifierExpression('a'), new IdentifierExpression('b')),
      );
    });
  });

  describe('between', () => {
    it('desugars into an inclusive range check', () => {
      expect(parse('x between 1 and 10')).toEqual(
        new BinaryExpression(
          TokenType.And,
          new BinaryExpression(TokenType.Gte, new IdentifierExpression('x'), new ValueExpression(1)),
          new BinaryExpression(TokenType.Lte, new IdentifierExpression('x'), new ValueExpression(10)),
        ),
      );
    });

    it('accepts decimal bounds', () => {
      expect(parse('x between 0.5 and 1.5')).toEqual(
        new BinaryExpression(
          TokenType.And,
          new BinaryExpression(TokenType.Gte, new IdentifierExpression('x'), new ValueExpression(0.5)),
          new BinaryExpression(TokenType.Lte, new IdentifierExpression('x'), new ValueExpression(1.5)),
        ),
      );
    });

    it('can be combined with further conditions', () => {
      const ast = parse('x between 1 and 10 and y = 2');
      expect(ast).toBeInstanceOf(BinaryExpression);
      expect((ast as BinaryExpression).operator).toBe(TokenType.And);
      expect((ast as BinaryExpression).right).toEqual(
        new BinaryExpression(TokenType.Eq, new IdentifierExpression('y'), new ValueExpression(2)),
      );
    });

    it('rejects non-numeric bounds', () => {
      expect(() => parse('x between a and b')).toThrow(/Expected NUM/);
    });

    it('rejects a missing upper bound', () => {
      expect(() => parse('x between 1')).toThrow(/Expected and/);
    });
  });

  describe('is null / is not null', () => {
    it('desugars `is null` into an equality with null', () => {
      expect(parse('x is null')).toEqual(
        new BinaryExpression(TokenType.Eq, new IdentifierExpression('x'), new ValueExpression(null)),
      );
    });

    it('desugars `is not null` into an inequality with null', () => {
      expect(parse('x IS NOT NULL')).toEqual(
        new BinaryExpression(TokenType.Neq, new IdentifierExpression('x'), new ValueExpression(null)),
      );
    });

    it('rejects `is` without null', () => {
      expect(() => parse('x is 1')).toThrow(/Expected null/);
    });
  });

  describe('function calls', () => {
    it('parses a call with one argument', () => {
      expect(parse('length(name)')).toEqual(
        new FunctionCallExpression('length', [new IdentifierExpression('name')]),
      );
    });

    it('parses a call with no arguments', () => {
      expect(parse('now()')).toEqual(new FunctionCallExpression('now', []));
    });

    it('parses an expression as the argument', () => {
      expect(parse('length(a + b)')).toEqual(
        new FunctionCallExpression('length', [
          new BinaryExpression(TokenType.Plus, new IdentifierExpression('a'), new IdentifierExpression('b')),
        ]),
      );
    });

    it('binds a call tighter than surrounding operators', () => {
      expect(parse('length(name) > 3')).toEqual(
        new BinaryExpression(
          TokenType.Gt,
          new FunctionCallExpression('length', [new IdentifierExpression('name')]),
          new ValueExpression(3),
        ),
      );
    });
  });

  describe('case expressions', () => {
    it('parses when/then branches and an else branch', () => {
      expect(parse("case when a > 1 then 'big' when a > 0 then 'small' else 'none' end")).toEqual(
        new CaseExpression(
          [
            {
              when: new BinaryExpression(TokenType.Gt, new IdentifierExpression('a'), new ValueExpression(1)),
              then: new ValueExpression('big'),
            },
            {
              when: new BinaryExpression(TokenType.Gt, new IdentifierExpression('a'), new ValueExpression(0)),
              then: new ValueExpression('small'),
            },
          ],
          new ValueExpression('none'),
        ),
      );
    });

    it('parses a case without an else branch', () => {
      const ast = parse('case when a then 1 end') as CaseExpression;
      expect(ast).toBeInstanceOf(CaseExpression);
      expect(ast.conditions).toHaveLength(1);
      expect(ast.last).toBeUndefined();
    });

    it('accepts upper-case keywords', () => {
      expect(parse('CASE WHEN a THEN 1 ELSE 2 END')).toBeInstanceOf(CaseExpression);
    });

    it('rejects a case without any when branch', () => {
      expect(() => parse('case else 1 end')).toThrow(/Expected when/);
    });

    it('rejects a case without end', () => {
      expect(() => parse('case when a then 1')).toThrow(/Expected/);
    });

    it('rejects a when branch without then', () => {
      expect(() => parse('case when a 1 end')).toThrow(/Expected then/);
    });
  });

  describe('errors', () => {
    it('rejects an empty expression', () => {
      expect(() => parse('')).toThrow(/Unexpected start of expression/);
    });

    it('rejects whitespace-only input', () => {
      expect(() => parse('   ')).toThrow(/Unexpected start of expression/);
    });

    it('rejects an expression starting with an operator', () => {
      expect(() => parse('* 2')).toThrow(/Unexpected start of expression/);
    });

    it('rejects a dangling operator', () => {
      expect(() => parse('1 +')).toThrow(/Unexpected start of expression/);
    });

    it('rejects an unclosed parenthesis', () => {
      expect(() => parse('(1 + 2')).toThrow(/Expected \)/);
    });

    it('rejects illegal characters', () => {
      expect(() => parse('1 + $')).toThrow(/Invalid input/);
    });
  });
});

describe('evaluate', () => {
  describe('arithmetic', () => {
    it.each([
      ['1 + 2', 3],
      ['5 - 7', -2],
      ['4 * 2.5', 10],
      ['10 / 4', 2.5],
      ['1 + 2 * 3', 7],
      ['2 * 3 + 1', 7],
      ['(1 + 2) * 3', 9],
      ['10 - 2 - 3', 5],
      ['100 / 10 / 2', 5],
      ['.5 + .5', 1],
    ])('evaluates %s to %s', (expression, expected) => {
      expect(evaluate(expression)).toBe(expected);
    });

    it('ignores surrounding and internal whitespace', () => {
      expect(evaluate('  1\t+\n 2  ')).toBe(3);
    });

    it('concatenates strings with +', () => {
      expect(evaluate("'foo' + 'bar'")).toBe('foobar');
    });
  });

  describe('comparison', () => {
    it.each([
      ['1 = 1', true],
      ['1 = 2', false],
      ['1 <> 2', true],
      ['1 <> 1', false],
      ['1 < 2', true],
      ['2 < 2', false],
      ['2 <= 2', true],
      ['3 <= 2', false],
      ['2 > 1', true],
      ['1 > 1', false],
      ['1 >= 1', true],
      ['0 >= 1', false],
    ])('evaluates %s to %s', (expression, expected) => {
      expect(evaluate(expression)).toBe(expected);
    })

    it('compares strings', () => {
      expect(evaluate("'abc' = 'abc'")).toBe(true);
      expect(evaluate("'abc' = 'abd'")).toBe(false);
      expect(evaluate("'abc' <> 'abd'")).toBe(true);
    });

    it('compares the results of arithmetic', () => {
      expect(evaluate('1 + 2 = 3')).toBe(true);
      expect(evaluate('2 * 3 > 5')).toBe(true);
    });

    it('uses strict equality and does not coerce types', () => {
      expect(evaluate("1 = '1'")).toBe(false);
      expect(evaluate("1 <> '1'")).toBe(true);
    });
  });

  describe('logical operators', () => {
    it.each([
      ['true and true', true],
      ['true and false', false],
      ['false and false', false],
      ['true or false', true],
      ['false or false', false],
      ['TRUE AND FALSE', false],
      ['(true or false) and false', false],
      ['true or (false and false)', true],
    ])('evaluates %s to %s', (expression, expected) => {
      expect(evaluate(expression)).toBe(expected);
    });

    it('currently binds `or` tighter than `and` (opposite of SQL precedence)', () => {
      // The precedence table ranks `or` above `and`, so this parses as
      // `(true or false) and false`. In SQL it would be `true or (false and false)`.
      expect(evaluate('true or false and false')).toBe(false);
    });

    it('short-circuits `and` when the left side is false', () => {
      const context = vi.fn();
      expect(evaluate('false and x', context)).toBe(false);
      expect(context).not.toHaveBeenCalled();
    });

    it('short-circuits `or` when the left side is true', () => {
      const context = vi.fn();
      expect(evaluate('true or x', context)).toBe(true);
      expect(context).not.toHaveBeenCalled();
    });
  });

  describe('between', () => {
    it.each([
      [1, true],
      [5, true],
      [10, true],
      [0, false],
      [11, false],
    ])('x between 1 and 10 with x = %s is %s', (x, expected) => {
      expect(evaluate('x between 1 and 10', () => x)).toBe(expected);
    });

    it('combines with other conditions', () => {
      expect(evaluateObject('age between 18 and 65 and active = true', { age: 30, active: true })).toBe(true);
      expect(evaluateObject('age between 18 and 65 and active = true', { age: 30, active: false })).toBe(false);
    });
  });

  describe('is null / is not null', () => {
    it('is null matches a null value', () => {
      expect(evaluateObject('x is null', { x: null })).toBe(true);
    });

    it('is null does not match a defined value', () => {
      expect(evaluateObject('x is null', { x: 0 })).toBe(false);
      expect(evaluateObject('x is null', { x: '' })).toBe(false);
    });

    it('is not null matches a defined value', () => {
      expect(evaluateObject('x is not null', { x: 1 })).toBe(true);
    });

    it('is not null does not match a null value', () => {
      expect(evaluateObject('x is not null', { x: null })).toBe(false);
    });
  });

  describe('functions', () => {
    it('length returns the length of a string', () => {
      expect(evaluate("length('hello')")).toBe(5);
    });

    it('length returns the length of an array', () => {
      expect(evaluateObject('length(items)', { items: [1, 2, 3] })).toBe(3);
    });

    it('length can be used inside a larger expression', () => {
      expect(evaluateObject('length(name) > 3', { name: 'Alice' })).toBe(true);
      expect(evaluateObject('length(name) > 3', { name: 'Al' })).toBe(false);
      expect(evaluateObject('length(items) = 0', { items: [] })).toBe(true);
    });

    it('length rejects a call without arguments', () => {
      expect(() => evaluate('length()')).toThrow(/exactly one argument/);
    });

    it('throws for an unknown function', () => {
      expect(() => evaluate('upper(x)', () => 'a')).toThrow(/Function upper not implemented/);
    });
  });

  describe('case expressions', () => {
    const grade = "case when score >= 90 then 'A' when score >= 80 then 'B' else 'C' end";

    it.each([
      [95, 'A'],
      [90, 'A'],
      [85, 'B'],
      [10, 'C'],
    ])('returns the first matching branch for score = %s', (score, expected) => {
      expect(evaluateObject(grade, { score })).toBe(expected);
    });

    it('returns false when nothing matches and there is no else', () => {
      expect(evaluateObject("case when x = 1 then 'one' end", { x: 2 })).toBe(false);
    });

    it('evaluates expressions in the then branch', () => {
      expect(evaluateObject('case when x > 0 then x * 2 else 0 - x end', { x: 3 })).toBe(6);
      expect(evaluateObject('case when x > 0 then x * 2 else 0 - x end', { x: -3 })).toBe(3);
    });

    it('can be used as an operand', () => {
      expect(evaluateObject("(case when x then 'yes' else 'no' end) = 'yes'", { x: true })).toBe(true);
    });

    it('does not evaluate branches after the first match', () => {
      const context = vi.fn((name: string) => (name === 'a' ? true : 1));
      evaluate('case when a then 1 when b then 2 end', context);
      expect(context).toHaveBeenCalledWith('a');
      expect(context).not.toHaveBeenCalledWith('b');
    });
  });

  describe('context resolution', () => {
    it('resolves identifiers through the context function', () => {
      const values: Record<string, number> = { a: 2, b: 3 };
      expect(evaluate('a * b', (name) => values[name])).toBe(6);
    });

    it('passes the identifier name to the context function', () => {
      const context = vi.fn(() => 1);
      evaluate('first_name = 1', context);
      expect(context).toHaveBeenCalledWith('first_name');
    });

    it('throws when an identifier is used without a context', () => {
      expect(() => evaluate('x + 1')).toThrow();
    });

    it('does not need a context for constant expressions', () => {
      expect(evaluate('1 + 1')).toBe(2);
    });
  });

  describe('SQL-like WHERE clauses', () => {
    const row = {
      name: 'Alice',
      age: 30,
      country: 'BR',
      email: null,
      tags: ['admin', 'staff'],
    };

    it.each([
      ["name = 'Alice'", true],
      ["name = 'Bob'", false],
      ["age >= 18 and country = 'BR'", true],
      ["age >= 18 and country = 'US'", false],
      ["(country = 'US' or country = 'BR') and age < 65", true],
      ['email is null', true],
      ['name is not null', true],
      ['length(tags) = 2', true],
      ['age between 20 and 40', true],
      ["age between 20 and 40 and name <> 'Alice'", false],
    ])('evaluates %s to %s', (expression, expected) => {
      expect(evaluateObject(expression, row)).toBe(expected);
    });
  });
});

describe('evaluateObject', () => {
  it('looks identifiers up as properties of the value', () => {
    expect(evaluateObject('a + b', { a: 1, b: 2 })).toBe(3);
  });

  it('returns the raw property value for a bare identifier', () => {
    expect(evaluateObject('name', { name: 'Alice' })).toBe('Alice');
  });

  it('yields undefined for a missing property', () => {
    expect(evaluateObject('missing', {})).toBeUndefined();
  });
});
