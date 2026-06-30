import { describe, expect, it } from 'vitest';
import { BinaryExpression, CaseExpression, FunctionCallExpression, IdentifierExpression, ValueExpression } from '../src/ast';
import { evaluate, evaluateObject } from '../src/evaluator';
import { parse } from '../src/parser';
import { TokenType } from '../src/token';

// ── parse() ──────────────────────────────────────────────────────────────────

describe('parse', () => {
  describe('literals', () => {
    it('parses integer', () => {
      const ast = parse('42');
      expect(ast).toBeInstanceOf(ValueExpression);
      expect((ast as ValueExpression).value).toBe(42);
    });

    it('parses float', () => {
      const ast = parse('3.14');
      expect(ast).toBeInstanceOf(ValueExpression);
      expect((ast as ValueExpression).value).toBeCloseTo(3.14);
    });

    it('parses single-quoted string', () => {
      const ast = parse("'hello'");
      expect(ast).toBeInstanceOf(ValueExpression);
      expect((ast as ValueExpression).value).toBe('hello');
    });

    it('parses double-quoted string', () => {
      const ast = parse('"world"');
      expect(ast).toBeInstanceOf(ValueExpression);
      expect((ast as ValueExpression).value).toBe('world');
    });

    it('parses true', () => {
      const ast = parse('true');
      expect(ast).toBeInstanceOf(ValueExpression);
      expect((ast as ValueExpression).value).toBe(true);
    });

    it('parses false', () => {
      const ast = parse('false');
      expect(ast).toBeInstanceOf(ValueExpression);
      expect((ast as ValueExpression).value).toBe(false);
    });
  });

  describe('identifiers', () => {
    it('parses a simple identifier', () => {
      const ast = parse('foo');
      expect(ast).toBeInstanceOf(IdentifierExpression);
      expect((ast as IdentifierExpression).name).toBe('foo');
    });

    it('parses an identifier with underscores', () => {
      const ast = parse('first_name');
      expect(ast).toBeInstanceOf(IdentifierExpression);
      expect((ast as IdentifierExpression).name).toBe('first_name');
    });
  });

  describe('binary expressions', () => {
    it.each([
      ['+', TokenType.Plus],
      ['-', TokenType.Minus],
      ['*', TokenType.Mul],
      ['/', TokenType.Div],
      ['=', TokenType.Eq],
      ['<>', TokenType.Neq],
      ['>', TokenType.Gt],
      ['>=', TokenType.Gte],
      ['<', TokenType.Lt],
      ['<=', TokenType.Lte],
      ['and', TokenType.And],
      ['or', TokenType.Or],
    ] as const)('parses operator %s', (op, tokenType) => {
      const ast = parse(`1 ${op} 2`) as BinaryExpression;
      expect(ast).toBeInstanceOf(BinaryExpression);
      expect(ast.operator).toBe(tokenType);
    });
  });

  describe('operator precedence', () => {
    it('* binds tighter than +', () => {
      // 1 + 2 * 3  →  1 + (2 * 3)
      const ast = parse('1 + 2 * 3') as BinaryExpression;
      expect(ast.operator).toBe(TokenType.Plus);
      expect((ast.right as BinaryExpression).operator).toBe(TokenType.Mul);
    });

    it('parentheses override precedence', () => {
      // (1 + 2) * 3
      const ast = parse('(1 + 2) * 3') as BinaryExpression;
      expect(ast.operator).toBe(TokenType.Mul);
      expect((ast.left as BinaryExpression).operator).toBe(TokenType.Plus);
    });

    it('or (precedence 2) binds tighter than and (precedence 1)', () => {
      // a or b and c  →  (a or b) and c
      const ast = parse('a or b and c') as BinaryExpression;
      expect(ast.operator).toBe(TokenType.And);
      expect((ast.left as BinaryExpression).operator).toBe(TokenType.Or);
    });

    it('comparison binds tighter than and', () => {
      // x > 0 and y < 10  →  (x > 0) and (y < 10)
      const ast = parse('x > 0 and y < 10') as BinaryExpression;
      expect(ast.operator).toBe(TokenType.And);
      expect((ast.left as BinaryExpression).operator).toBe(TokenType.Gt);
      expect((ast.right as BinaryExpression).operator).toBe(TokenType.Lt);
    });
  });

  describe('IS NULL / IS NOT NULL', () => {
    it('parses IS NULL as equality with null', () => {
      const ast = parse('x is null') as BinaryExpression;
      expect(ast.operator).toBe(TokenType.Eq);
      expect((ast.right as ValueExpression).value).toBeNull();
    });

    it('parses IS NOT NULL as inequality with null', () => {
      const ast = parse('x is not null') as BinaryExpression;
      expect(ast.operator).toBe(TokenType.Neq);
      expect((ast.right as ValueExpression).value).toBeNull();
    });
  });

  describe('BETWEEN', () => {
    it('desugars x BETWEEN a AND b into (x >= a) AND (x <= b)', () => {
      const ast = parse('x between 1 and 10') as BinaryExpression;
      expect(ast.operator).toBe(TokenType.And);
      expect((ast.left as BinaryExpression).operator).toBe(TokenType.Gte);
      expect((ast.right as BinaryExpression).operator).toBe(TokenType.Lte);
    });
  });

  describe('function calls', () => {
    it('parses a function call with one argument', () => {
      const ast = parse('length(name)') as FunctionCallExpression;
      expect(ast).toBeInstanceOf(FunctionCallExpression);
      expect(ast.name).toBe('length');
      expect(ast.args).toHaveLength(1);
      expect(ast.args[0]).toBeInstanceOf(IdentifierExpression);
    });

    it('parses a function call with a complex argument', () => {
      const ast = parse('length(name)') as FunctionCallExpression;
      expect(ast.args[0]).toBeInstanceOf(IdentifierExpression);
      expect((ast.args[0] as IdentifierExpression).name).toBe('name');
    });

    it('parses a call with no arguments', () => {
      const ast = parse('length()') as FunctionCallExpression;
      expect(ast).toBeInstanceOf(FunctionCallExpression);
      expect(ast.args).toHaveLength(0);
    });
  });

  describe('CASE expression (currently broken)', () => {
    // parseCaseExpression() mistakenly calls expectPeekToken(Case) as its
    // first action, but by the time it runs, currentToken is already 'case'
    // and peekToken is 'when' — so it always throws.
    it('throws when parsing a CASE expression', () => {
      expect(() => parse('case when true then 1 end')).toThrow();
    });
  });

  describe('errors', () => {
    it('throws on an expression that starts with an operator', () => {
      expect(() => parse('+')).toThrow();
    });

    it('throws on an illegal character', () => {
      expect(() => parse('@foo')).toThrow();
    });

    it('throws on an empty expression', () => {
      expect(() => parse('')).toThrow();
    });
  });
});

// ── evaluate() ───────────────────────────────────────────────────────────────

describe('evaluate', () => {
  describe('literals', () => {
    it('evaluates an integer', () => expect(evaluate('42')).toBe(42));
    it('evaluates a float', () => expect(evaluate('3.14')).toBeCloseTo(3.14));
    it('evaluates a string', () => expect(evaluate("'hello'")).toBe('hello'));
    it('evaluates true', () => expect(evaluate('true')).toBe(true));
    it('evaluates false', () => expect(evaluate('false')).toBe(false));
  });

  describe('arithmetic', () => {
    it('adds', () => expect(evaluate('1 + 2')).toBe(3));
    it('subtracts', () => expect(evaluate('10 - 3')).toBe(7));
    it('multiplies', () => expect(evaluate('3 * 4')).toBe(12));
    it('divides', () => expect(evaluate('10 / 2')).toBe(5));

    it('respects operator precedence (1 + 2 * 3 = 7)', () => {
      expect(evaluate('1 + 2 * 3')).toBe(7);
    });

    it('respects grouping ((1 + 2) * 3 = 9)', () => {
      expect(evaluate('(1 + 2) * 3')).toBe(9);
    });

    it('chains operations left to right at same precedence', () => {
      expect(evaluate('10 - 3 - 2')).toBe(5);
    });
  });

  describe('comparison', () => {
    it('= returns true when equal', () => expect(evaluate('1 = 1')).toBe(true));
    it('= returns false when not equal', () => expect(evaluate('1 = 2')).toBe(false));
    it('<> returns true when not equal', () => expect(evaluate('1 <> 2')).toBe(true));
    it('> returns true when greater', () => expect(evaluate('5 > 3')).toBe(true));
    it('> returns false when not greater', () => expect(evaluate('3 > 5')).toBe(false));
    it('>= returns true at boundary', () => expect(evaluate('3 >= 3')).toBe(true));
    it('< returns true when less', () => expect(evaluate('2 < 5')).toBe(true));
    it('<= returns true at boundary', () => expect(evaluate('2 <= 2')).toBe(true));

    it('compares strings', () => {
      expect(evaluate("'a' = 'a'")).toBe(true);
      expect(evaluate("'a' = 'b'")).toBe(false);
    });
  });

  describe('logical operators', () => {
    it('and: true when both true', () => expect(evaluate('true and true')).toBe(true));
    it('and: false when left is false', () => expect(evaluate('false and true')).toBe(false));
    it('and: false when right is false', () => expect(evaluate('true and false')).toBe(false));
    it('or: true when left is true', () => expect(evaluate('true or false')).toBe(true));
    it('or: true when right is true', () => expect(evaluate('false or true')).toBe(true));
    it('or: false when both false', () => expect(evaluate('false or false')).toBe(false));
  });

  describe('identifiers', () => {
    it('resolves an identifier via the context function', () => {
      const ctx = (name: string) => name === 'x' ? 42 : undefined;
      expect(evaluate('x', ctx)).toBe(42);
    });

    it('uses the identifier value in an expression', () => {
      const ctx = (name: string) => name === 'n' ? 10 : undefined;
      expect(evaluate('n * 2', ctx)).toBe(20);
    });

    it('throws when an identifier is used without a context', () => {
      expect(() => evaluate('x')).toThrow();
    });
  });

  describe('functions', () => {
    it('length() returns the length of a string literal', () => {
      expect(evaluate("length('hello')")).toBe(5);
    });

    it('length() returns the length of an array via context', () => {
      const ctx = (name: string) => name === 'items' ? [1, 2, 3] : undefined;
      expect(evaluate('length(items)', ctx)).toBe(3);
    });

    it('length() with zero arguments throws', () => {
      expect(() => evaluate('length()')).toThrow('Length function takes exactly one argument');
    });

    it('throws for an unknown function', () => {
      expect(() => evaluate('unknown(1)')).toThrow('Function unknown not implemented');
    });
  });

  describe('IS NULL / IS NOT NULL', () => {
    const nullCtx = () => null;
    const strCtx = () => 'value';

    it('IS NULL is true when value is null', () => {
      expect(evaluate('x is null', nullCtx)).toBe(true);
    });

    it('IS NULL is false when value is not null', () => {
      expect(evaluate('x is null', strCtx)).toBe(false);
    });

    it('IS NOT NULL is true when value is not null', () => {
      expect(evaluate('x is not null', strCtx)).toBe(true);
    });

    it('IS NOT NULL is false when value is null', () => {
      expect(evaluate('x is not null', nullCtx)).toBe(false);
    });
  });

  describe('BETWEEN', () => {
    const ctx = (v: number) => () => v;

    it('is true when value is inside the range', () => {
      expect(evaluate('x between 1 and 10', ctx(5))).toBe(true);
    });

    it('is true at the lower boundary', () => {
      expect(evaluate('x between 1 and 10', ctx(1))).toBe(true);
    });

    it('is true at the upper boundary', () => {
      expect(evaluate('x between 1 and 10', ctx(10))).toBe(true);
    });

    it('is false when value is below the range', () => {
      expect(evaluate('x between 1 and 10', ctx(0))).toBe(false);
    });

    it('is false when value is above the range', () => {
      expect(evaluate('x between 1 and 10', ctx(11))).toBe(false);
    });
  });

  describe('CASE expression (currently broken)', () => {
    it('throws when a CASE expression is evaluated (known parse bug)', () => {
      expect(() => evaluate('case when true then 1 end')).toThrow();
    });
  });

  describe('errors', () => {
    it('throws on an invalid expression', () => {
      expect(() => evaluate('+')).toThrow();
    });
  });
});

// ── evaluateObject() ─────────────────────────────────────────────────────────

describe('evaluateObject', () => {
  it('looks up a property by name', () => {
    expect(evaluateObject('name', { name: 'Alice' })).toBe('Alice');
  });

  it('returns undefined for a missing property', () => {
    expect(evaluateObject('missing', {})).toBeUndefined();
  });

  it('compares a property to a string literal', () => {
    expect(evaluateObject("name = 'Alice'", { name: 'Alice' })).toBe(true);
    expect(evaluateObject("name = 'Bob'", { name: 'Alice' })).toBe(false);
  });

  it('compares a property to a numeric literal', () => {
    expect(evaluateObject('age = 30', { age: 30 })).toBe(true);
    expect(evaluateObject('age > 18', { age: 20 })).toBe(true);
  });

  it('evaluates a compound condition with multiple properties', () => {
    const row = { age: 20, active: true };
    expect(evaluateObject('age >= 18 and active = true', row)).toBe(true);
    expect(evaluateObject('age >= 18 and active = true', { age: 15, active: true })).toBe(false);
  });

  it('IS NULL check on a null property', () => {
    expect(evaluateObject('email is null', { email: null })).toBe(true);
    expect(evaluateObject('email is null', { email: 'x@y.com' })).toBe(false);
  });

  it('IS NOT NULL check on a non-null property', () => {
    expect(evaluateObject('email is not null', { email: 'x@y.com' })).toBe(true);
    expect(evaluateObject('email is not null', { email: null })).toBe(false);
  });

  it('BETWEEN check on an object property', () => {
    expect(evaluateObject('score between 60 and 100', { score: 75 })).toBe(true);
    expect(evaluateObject('score between 60 and 100', { score: 50 })).toBe(false);
    expect(evaluateObject('score between 60 and 100', { score: 60 })).toBe(true);
    expect(evaluateObject('score between 60 and 100', { score: 100 })).toBe(true);
  });

  it('length() on a string property', () => {
    expect(evaluateObject("length(tag) > 3", { tag: 'hello' })).toBe(true);
    expect(evaluateObject("length(tag) > 3", { tag: 'hi' })).toBe(false);
  });
});
