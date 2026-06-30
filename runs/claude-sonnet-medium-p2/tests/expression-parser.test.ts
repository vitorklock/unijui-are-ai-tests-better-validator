import { describe, expect, it } from 'vitest';
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

// ---------------------------------------------------------------------------
// parse()
// ---------------------------------------------------------------------------

describe('parse()', () => {
  describe('integer literal', () => {
    it('returns a ValueExpression with a numeric value', () => {
      const ast = parse('42');
      expect(ast).toBeInstanceOf(ValueExpression);
      expect((ast as ValueExpression).value).toBe(42);
    });
  });

  describe('floating-point literal', () => {
    it('parses a decimal number', () => {
      const ast = parse('3.14') as ValueExpression;
      expect(ast).toBeInstanceOf(ValueExpression);
      expect(ast.value).toBeCloseTo(3.14);
    });

    it('parses a decimal starting with a dot', () => {
      const ast = parse('.5') as ValueExpression;
      expect(ast.value).toBeCloseTo(0.5);
    });
  });

  describe('string literals', () => {
    it('parses a single-quoted string and strips the quotes', () => {
      const ast = parse("'hello'") as ValueExpression;
      expect(ast).toBeInstanceOf(ValueExpression);
      expect(ast.value).toBe('hello');
    });

    it('parses a double-quoted string and strips the quotes', () => {
      const ast = parse('"world"') as ValueExpression;
      expect(ast.value).toBe('world');
    });

    it('parses an empty single-quoted string', () => {
      const ast = parse("''") as ValueExpression;
      expect(ast.value).toBe('');
    });
  });

  describe('boolean literals', () => {
    it('parses true as a ValueExpression holding boolean true', () => {
      const ast = parse('true') as ValueExpression;
      expect(ast).toBeInstanceOf(ValueExpression);
      expect(ast.value).toBe(true);
    });

    it('parses false as a ValueExpression holding boolean false', () => {
      const ast = parse('false') as ValueExpression;
      expect(ast.value).toBe(false);
    });

    it('resolves boolean keywords case-insensitively', () => {
      // The lexer lowercases before keyword lookup
      expect((parse('TRUE') as ValueExpression).value).toBe(true);
      expect((parse('FALSE') as ValueExpression).value).toBe(false);
    });
  });

  describe('identifier', () => {
    it('parses a plain identifier', () => {
      const ast = parse('myField') as IdentifierExpression;
      expect(ast).toBeInstanceOf(IdentifierExpression);
      expect(ast.name).toBe('myField');
    });

    it('parses an identifier containing underscores', () => {
      const ast = parse('my_field') as IdentifierExpression;
      expect(ast.name).toBe('my_field');
    });
  });

  describe('arithmetic infix operators', () => {
    it('parses addition with correct operator and operands', () => {
      const ast = parse('1 + 2') as BinaryExpression;
      expect(ast).toBeInstanceOf(BinaryExpression);
      expect(ast.operator).toBe(TokenType.Plus);
      expect((ast.left as ValueExpression).value).toBe(1);
      expect((ast.right as ValueExpression).value).toBe(2);
    });

    it('parses subtraction', () => {
      const ast = parse('5 - 3') as BinaryExpression;
      expect(ast.operator).toBe(TokenType.Minus);
    });

    it('parses multiplication', () => {
      const ast = parse('2 * 3') as BinaryExpression;
      expect(ast.operator).toBe(TokenType.Mul);
    });

    it('parses division', () => {
      const ast = parse('10 / 4') as BinaryExpression;
      expect(ast.operator).toBe(TokenType.Div);
    });

    it('gives * higher precedence than +, nesting * as the right child of +', () => {
      // 2 + 3 * 4  →  BinExpr(+, 2, BinExpr(*, 3, 4))
      const ast = parse('2 + 3 * 4') as BinaryExpression;
      expect(ast.operator).toBe(TokenType.Plus);
      expect((ast.right as BinaryExpression).operator).toBe(TokenType.Mul);
    });
  });

  describe('comparison infix operators', () => {
    it.each([
      ['=', TokenType.Eq, '1 = 2'],
      ['<>', TokenType.Neq, '1 <> 2'],
      ['>', TokenType.Gt, '3 > 2'],
      ['>=', TokenType.Gte, '3 >= 3'],
      ['<', TokenType.Lt, '2 < 3'],
      ['<=', TokenType.Lte, '2 <= 2'],
    ])('parses the %s operator', (_sym, expectedType, source) => {
      const ast = parse(source) as BinaryExpression;
      expect(ast).toBeInstanceOf(BinaryExpression);
      expect(ast.operator).toBe(expectedType);
    });
  });

  describe('logical infix operators', () => {
    it('parses AND', () => {
      const ast = parse('true and false') as BinaryExpression;
      expect(ast).toBeInstanceOf(BinaryExpression);
      expect(ast.operator).toBe(TokenType.And);
    });

    it('parses OR', () => {
      const ast = parse('true or false') as BinaryExpression;
      expect(ast.operator).toBe(TokenType.Or);
    });
  });

  describe('IS NULL / IS NOT NULL', () => {
    it('parses IS NULL as equality comparison against null', () => {
      const ast = parse('x is null') as BinaryExpression;
      expect(ast).toBeInstanceOf(BinaryExpression);
      expect(ast.operator).toBe(TokenType.Eq);
      expect((ast.right as ValueExpression).value).toBeNull();
    });

    it('parses IS NOT NULL as inequality comparison against null', () => {
      const ast = parse('x is not null') as BinaryExpression;
      expect(ast).toBeInstanceOf(BinaryExpression);
      expect(ast.operator).toBe(TokenType.Neq);
      expect((ast.right as ValueExpression).value).toBeNull();
    });
  });

  describe('BETWEEN expression', () => {
    it('expands to (left >= min) AND (left <= max)', () => {
      const ast = parse('x between 1 and 10') as BinaryExpression;
      expect(ast).toBeInstanceOf(BinaryExpression);
      expect(ast.operator).toBe(TokenType.And);

      const lower = ast.left as BinaryExpression;
      expect(lower.operator).toBe(TokenType.Gte);
      expect((lower.right as ValueExpression).value).toBe(1);

      const upper = ast.right as BinaryExpression;
      expect(upper.operator).toBe(TokenType.Lte);
      expect((upper.right as ValueExpression).value).toBe(10);
    });
  });

  describe('CASE expression', () => {
    it('parses a single WHEN/THEN branch with no ELSE', () => {
      const ast = parse('case when true then 1 end') as CaseExpression;
      expect(ast).toBeInstanceOf(CaseExpression);
      expect(ast.conditions).toHaveLength(1);
      expect((ast.conditions[0].when as ValueExpression).value).toBe(true);
      expect((ast.conditions[0].then as ValueExpression).value).toBe(1);
      expect(ast.last).toBeUndefined();
    });

    it('parses multiple WHEN/THEN branches', () => {
      const ast = parse('case when true then 1 when false then 2 end') as CaseExpression;
      expect(ast.conditions).toHaveLength(2);
    });

    it('parses the ELSE branch into the last field', () => {
      const ast = parse('case when false then 1 else 2 end') as CaseExpression;
      expect(ast).toBeInstanceOf(CaseExpression);
      expect(ast.last).toBeDefined();
      expect((ast.last as ValueExpression).value).toBe(2);
    });
  });

  describe('function call expression', () => {
    it('parses a zero-argument call', () => {
      const ast = parse('length()') as FunctionCallExpression;
      expect(ast).toBeInstanceOf(FunctionCallExpression);
      expect(ast.name).toBe('length');
      expect(ast.args).toHaveLength(0);
    });

    it('parses a single-argument call with the argument captured', () => {
      const ast = parse("length('hello')") as FunctionCallExpression;
      expect(ast).toBeInstanceOf(FunctionCallExpression);
      expect(ast.name).toBe('length');
      expect(ast.args).toHaveLength(1);
      expect((ast.args[0] as ValueExpression).value).toBe('hello');
    });
  });

  describe('grouped expressions (parentheses)', () => {
    it('unwraps a parenthesised literal', () => {
      const ast = parse('(42)') as ValueExpression;
      expect(ast).toBeInstanceOf(ValueExpression);
      expect(ast.value).toBe(42);
    });

    it('parentheses override default precedence, nesting + as the left child of *', () => {
      // (2 + 3) * 4  →  BinExpr(*, BinExpr(+, 2, 3), 4)
      const ast = parse('(2 + 3) * 4') as BinaryExpression;
      expect(ast.operator).toBe(TokenType.Mul);
      expect((ast.left as BinaryExpression).operator).toBe(TokenType.Plus);
    });
  });

  describe('error cases', () => {
    it('throws when the expression starts with an operator', () => {
      expect(() => parse('= 1')).toThrow();
    });

    it('throws on an illegal character', () => {
      expect(() => parse('@id')).toThrow();
    });

    it('throws when null appears as a standalone expression (no prefix parser)', () => {
      expect(() => parse('null')).toThrow();
    });

    it('throws when NOT is used as a prefix (no prefix parser for not)', () => {
      expect(() => parse('not true')).toThrow();
    });

    it('throws when CASE has no WHEN clause', () => {
      expect(() => parse('case end')).toThrow();
    });

    it('throws when BETWEEN lower bound is not a numeric literal', () => {
      expect(() => parse("x between 'a' and 10")).toThrow();
    });

    it('throws when IS is not followed by NULL or NOT NULL', () => {
      expect(() => parse('x is true')).toThrow();
    });

    it('throws when a function call has multiple arguments (parse limitation)', () => {
      expect(() => parse("length('a', 'b')")).toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// evaluate()
// ---------------------------------------------------------------------------

describe('evaluate()', () => {
  describe('literal values', () => {
    it('evaluates an integer literal', () => {
      expect(evaluate('42')).toBe(42);
    });

    it('evaluates a floating-point literal', () => {
      expect(evaluate('3.14')).toBeCloseTo(3.14);
    });

    it('evaluates a single-quoted string', () => {
      expect(evaluate("'hello'")).toBe('hello');
    });

    it('evaluates a double-quoted string', () => {
      expect(evaluate('"world"')).toBe('world');
    });

    it('evaluates true', () => {
      expect(evaluate('true')).toBe(true);
    });

    it('evaluates false', () => {
      expect(evaluate('false')).toBe(false);
    });
  });

  describe('arithmetic', () => {
    it('adds two numbers', () => {
      expect(evaluate('1 + 2')).toBe(3);
    });

    it('subtracts two numbers', () => {
      expect(evaluate('5 - 3')).toBe(2);
    });

    it('multiplies two numbers', () => {
      expect(evaluate('2 * 3')).toBe(6);
    });

    it('divides two numbers, yielding a fraction', () => {
      expect(evaluate('10 / 4')).toBe(2.5);
    });

    it('concatenates strings with +', () => {
      expect(evaluate("'hello' + ' world'")).toBe('hello world');
    });

    it('evaluates 2 + 3 * 4 as 14 (not 20) due to operator precedence', () => {
      expect(evaluate('2 + 3 * 4')).toBe(14);
    });

    it('evaluates (2 + 3) * 4 as 20 when parentheses override precedence', () => {
      expect(evaluate('(2 + 3) * 4')).toBe(20);
    });
  });

  describe('comparison operators', () => {
    it('= is true when operands are equal', () => {
      expect(evaluate('1 = 1')).toBe(true);
    });

    it('= is false when operands differ', () => {
      expect(evaluate('1 = 2')).toBe(false);
    });

    it('<> is true when operands differ', () => {
      expect(evaluate('1 <> 2')).toBe(true);
    });

    it('<> is false when operands are equal', () => {
      expect(evaluate('1 <> 1')).toBe(false);
    });

    it('> is true when left is greater', () => {
      expect(evaluate('3 > 2')).toBe(true);
    });

    it('> is false when left equals right (boundary: not strictly greater)', () => {
      expect(evaluate('2 > 2')).toBe(false);
    });

    it('>= is true at the exact boundary', () => {
      expect(evaluate('2 >= 2')).toBe(true);
    });

    it('>= is false one below the boundary', () => {
      expect(evaluate('1 >= 2')).toBe(false);
    });

    it('< is true when left is less', () => {
      expect(evaluate('2 < 3')).toBe(true);
    });

    it('< is false when left equals right (boundary: not strictly less)', () => {
      expect(evaluate('2 < 2')).toBe(false);
    });

    it('<= is true at the exact boundary', () => {
      expect(evaluate('2 <= 2')).toBe(true);
    });

    it('<= is false one above the boundary', () => {
      expect(evaluate('3 <= 2')).toBe(false);
    });
  });

  describe('logical operators', () => {
    it('true and true is true', () => {
      expect(evaluate('true and true')).toBe(true);
    });

    it('true and false is false', () => {
      expect(evaluate('true and false')).toBe(false);
    });

    it('false and true is false', () => {
      expect(evaluate('false and true')).toBe(false);
    });

    it('false and false is false', () => {
      expect(evaluate('false and false')).toBe(false);
    });

    it('true or false is true', () => {
      expect(evaluate('true or false')).toBe(true);
    });

    it('false or true is true', () => {
      expect(evaluate('false or true')).toBe(true);
    });

    it('false or false is false', () => {
      expect(evaluate('false or false')).toBe(false);
    });
  });

  describe('IS NULL / IS NOT NULL', () => {
    it('IS NULL is true when the identifier is null', () => {
      expect(evaluate('x is null', () => null)).toBe(true);
    });

    it('IS NULL is false when the identifier is a non-null value', () => {
      expect(evaluate('x is null', () => 'value')).toBe(false);
    });

    it('IS NULL is false when the identifier is undefined (strict equality)', () => {
      expect(evaluate('x is null', () => undefined)).toBe(false);
    });

    it('IS NOT NULL is true when the identifier is a non-null value', () => {
      expect(evaluate('x is not null', () => 'value')).toBe(true);
    });

    it('IS NOT NULL is false when the identifier is null', () => {
      expect(evaluate('x is not null', () => null)).toBe(false);
    });
  });

  describe('BETWEEN', () => {
    const ctx = (value: number) => () => value;

    it('is true when the value lies strictly within bounds', () => {
      expect(evaluate('x between 1 and 10', ctx(5))).toBe(true);
    });

    it('is true at the lower boundary (inclusive)', () => {
      expect(evaluate('x between 1 and 10', ctx(1))).toBe(true);
    });

    it('is true at the upper boundary (inclusive)', () => {
      expect(evaluate('x between 1 and 10', ctx(10))).toBe(true);
    });

    it('is false one below the lower boundary', () => {
      expect(evaluate('x between 1 and 10', ctx(0))).toBe(false);
    });

    it('is false one above the upper boundary', () => {
      expect(evaluate('x between 1 and 10', ctx(11))).toBe(false);
    });
  });

  describe('CASE expression', () => {
    it('returns the then-value of the first matching condition', () => {
      expect(evaluate('case when true then 42 end')).toBe(42);
    });

    it('returns the else-value when no condition matches', () => {
      expect(evaluate('case when false then 1 else 99 end')).toBe(99);
    });

    it('returns false when no condition matches and there is no else branch', () => {
      expect(evaluate('case when false then 1 end')).toBe(false);
    });

    it('returns the first matching branch and ignores subsequent ones', () => {
      expect(evaluate('case when true then 1 when true then 2 end')).toBe(1);
    });

    it('skips non-matching conditions before finding a match', () => {
      const ctx = (name: string) => name === 'v' ? 6 : undefined;
      const result = evaluate('case when v = 5 then "five" when v = 6 then "six" else "other" end', ctx);
      expect(result).toBe('six');
    });
  });

  describe('length() function', () => {
    it('returns the length of a string literal', () => {
      expect(evaluate("length('hello')")).toBe(5);
    });

    it('returns 0 for an empty string', () => {
      expect(evaluate("length('')")).toBe(0);
    });

    it('returns the length of an array from context', () => {
      const ctx = (name: string) => name === 'items' ? [1, 2, 3] : undefined;
      expect(evaluate('length(items)', ctx)).toBe(3);
    });

    it('throws when called with no arguments', () => {
      expect(() => evaluate('length()')).toThrow('Length function takes exactly one argument');
    });
  });

  describe('unknown function', () => {
    it('throws with the function name in the error message', () => {
      expect(() => evaluate("unknown('x')")).toThrow('Function unknown not implemented');
    });
  });

  describe('identifier resolution via context', () => {
    it('passes the identifier name to the context function and returns its value', () => {
      const ctx = (name: string) => name === 'age' ? 30 : undefined;
      expect(evaluate('age', ctx)).toBe(30);
    });

    it('uses context values in a comparison', () => {
      const ctx = (name: string) => name === 'score' ? 85 : undefined;
      expect(evaluate('score > 80', ctx)).toBe(true);
    });

    it('uses context values in arithmetic', () => {
      const ctx = (name: string) => ({ a: 4, b: 6 }[name]);
      expect(evaluate('a + b', ctx)).toBe(10);
    });
  });
});

// ---------------------------------------------------------------------------
// evaluateObject()
// ---------------------------------------------------------------------------

describe('evaluateObject()', () => {
  it('resolves an identifier to the matching object property', () => {
    expect(evaluateObject('age', { age: 30 })).toBe(30);
  });

  it('returns undefined for a property that does not exist on the object', () => {
    expect(evaluateObject('missing', {})).toBeUndefined();
  });

  it('uses object properties in a numeric comparison', () => {
    expect(evaluateObject('age >= 18', { age: 18 })).toBe(true);
  });

  it('uses object properties in arithmetic', () => {
    expect(evaluateObject('a + b', { a: 5, b: 3 })).toBe(8);
  });

  it('evaluates IS NULL against a null property', () => {
    expect(evaluateObject('x is null', { x: null })).toBe(true);
  });

  it('evaluates IS NULL as false when the property is defined', () => {
    expect(evaluateObject('x is null', { x: 'present' })).toBe(false);
  });

  it('evaluates a BETWEEN expression using an object property', () => {
    expect(evaluateObject('score between 60 and 100', { score: 75 })).toBe(true);
  });
});
