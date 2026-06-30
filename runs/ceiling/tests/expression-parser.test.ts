import { describe, it, expect } from 'vitest';

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

/**
 * Tests for the SQL-like expression parser/evaluator.
 *
 * Expected values were captured from the reference implementation, so the suite
 * pins the *current* behavior — including a few intentional quirks that are
 * called out in comments (non-standard `and`/`or` precedence, operand-returning
 * logical operators, the multi-argument function-call limitation, and the
 * lexer's handling of malformed numbers/strings). Each test exercises a single
 * behavior and asserts an exact value so that small logic changes are detected.
 */

describe('parse() — AST structure', () => {
  it('parses an integer literal into a ValueExpression', () => {
    expect(parse('100')).toEqual(new ValueExpression(100));
  });

  it('parses a bare identifier into an IdentifierExpression', () => {
    expect(parse('foo')).toEqual(new IdentifierExpression('foo'));
  });

  it('parses a binary "+" into a BinaryExpression with both operands', () => {
    expect(parse('1 + 2')).toEqual(
      new BinaryExpression(TokenType.Plus, new ValueExpression(1), new ValueExpression(2)),
    );
  });

  it('binds "*" tighter than "+" (multiplication nested under the right operand)', () => {
    expect(parse('1 + 2 * 3')).toEqual(
      new BinaryExpression(
        TokenType.Plus,
        new ValueExpression(1),
        new BinaryExpression(TokenType.Mul, new ValueExpression(2), new ValueExpression(3)),
      ),
    );
  });

  it('binds "or" tighter than "and" — a deliberate non-standard precedence', () => {
    // `true or false and false` groups as `(true or false) and false`,
    // because Or has a higher precedence number than And in the parser.
    expect(parse('true or false and false')).toEqual(
      new BinaryExpression(
        TokenType.And,
        new BinaryExpression(TokenType.Or, new ValueExpression(true), new ValueExpression(false)),
        new ValueExpression(false),
      ),
    );
  });

  it('desugars "between" into (left >= min) and (left <= max)', () => {
    expect(parse('x between 1 and 10')).toEqual(
      new BinaryExpression(
        TokenType.And,
        new BinaryExpression(TokenType.Gte, new IdentifierExpression('x'), new ValueExpression(1)),
        new BinaryExpression(TokenType.Lte, new IdentifierExpression('x'), new ValueExpression(10)),
      ),
    );
  });

  it('desugars "is null" into an equality against the null value', () => {
    expect(parse('x is null')).toEqual(
      new BinaryExpression(TokenType.Eq, new IdentifierExpression('x'), new ValueExpression(null)),
    );
  });

  it('desugars "is not null" into an inequality against the null value', () => {
    expect(parse('x is not null')).toEqual(
      new BinaryExpression(TokenType.Neq, new IdentifierExpression('x'), new ValueExpression(null)),
    );
  });

  it('parses a function call into a FunctionCallExpression with its arguments', () => {
    expect(parse("length('hello')")).toEqual(
      new FunctionCallExpression('length', [new ValueExpression('hello')]),
    );
  });

  it('parses a case expression into conditions plus an else branch', () => {
    expect(parse('case when true then 1 else 2 end')).toEqual(
      new CaseExpression(
        [{ when: new ValueExpression(true), then: new ValueExpression(1) }],
        new ValueExpression(2),
      ),
    );
  });

  it('leaves the else branch undefined when a case has no else', () => {
    expect(parse('case when false then 1 end')).toEqual(
      new CaseExpression([{ when: new ValueExpression(false), then: new ValueExpression(1) }]),
    );
  });

  it('stops at an operator that has a precedence but no infix parser', () => {
    // `not` carries an infix precedence yet has no infix parser, so the parse
    // loop returns the left expression and leaves `not` as a trailing token.
    expect(parse('5 not')).toEqual(new ValueExpression(5));
  });
});

describe('evaluate() — arithmetic operators', () => {
  it('adds two numbers', () => {
    expect(evaluate('1 + 2')).toBe(3);
  });

  it('subtracts two numbers', () => {
    expect(evaluate('5 - 3')).toBe(2);
  });

  it('multiplies two numbers', () => {
    expect(evaluate('4 * 2')).toBe(8);
  });

  it('divides two numbers', () => {
    expect(evaluate('8 / 2')).toBe(4);
  });

  it('returns Infinity when dividing a positive number by zero', () => {
    expect(evaluate('1 / 0')).toBe(Infinity);
  });

  it('returns NaN when dividing zero by zero', () => {
    expect(evaluate('0 / 0')).toBeNaN();
  });
});

describe('evaluate() — comparison operators', () => {
  it('"=" is true when both sides are equal', () => {
    expect(evaluate('1 = 1')).toBe(true);
  });

  it('"=" is false when the sides differ', () => {
    expect(evaluate('1 = 2')).toBe(false);
  });

  it('"<>" is true when the sides differ', () => {
    expect(evaluate('1 <> 2')).toBe(true);
  });

  it('"<>" is false when both sides are equal', () => {
    expect(evaluate('1 <> 1')).toBe(false);
  });

  it('">" is true when the left side is greater', () => {
    expect(evaluate('3 > 2')).toBe(true);
  });

  it('">" is false when the sides are equal (boundary)', () => {
    expect(evaluate('2 > 2')).toBe(false);
  });

  it('">=" is true when the sides are equal (boundary)', () => {
    expect(evaluate('2 >= 2')).toBe(true);
  });

  it('">=" is false just below the boundary', () => {
    expect(evaluate('1 >= 2')).toBe(false);
  });

  it('"<" is true when the left side is smaller', () => {
    expect(evaluate('1 < 2')).toBe(true);
  });

  it('"<" is false when the sides are equal (boundary)', () => {
    expect(evaluate('2 < 2')).toBe(false);
  });

  it('"<=" is true when the sides are equal (boundary)', () => {
    expect(evaluate('2 <= 2')).toBe(true);
  });

  it('"<=" is false just above the boundary', () => {
    expect(evaluate('3 <= 2')).toBe(false);
  });
});

describe('evaluate() — logical operators', () => {
  it('"and" is false when one operand is false', () => {
    expect(evaluate('true and false')).toBe(false);
  });

  it('"and" is true when both operands are true', () => {
    expect(evaluate('true and true')).toBe(true);
  });

  it('"or" is true when one operand is true', () => {
    expect(evaluate('false or true')).toBe(true);
  });

  it('"or" is false when both operands are false', () => {
    expect(evaluate('false or false')).toBe(false);
  });

  // `and`/`or` use JavaScript &&/|| and therefore return the operand value
  // itself, not a coerced boolean.
  it('"and" returns the right operand when the left is truthy', () => {
    expect(evaluate('5 and 3')).toBe(3);
  });

  it('"and" returns the left operand when the left is falsy', () => {
    expect(evaluate('0 and 3')).toBe(0);
  });

  it('"or" returns the left operand when it is truthy', () => {
    expect(evaluate('7 or 0')).toBe(7);
  });

  it('"or" returns the right operand when the left is falsy', () => {
    expect(evaluate('0 or 5')).toBe(5);
  });
});

describe('evaluate() — precedence & associativity', () => {
  it('evaluates multiplication before addition', () => {
    expect(evaluate('1 + 2 * 3')).toBe(7);
  });

  it('evaluates arithmetic before equality', () => {
    expect(evaluate('1 + 1 = 2')).toBe(true);
  });

  it('subtraction is left-associative', () => {
    // Left-associative: (10 - 3) - 2 = 5, not 10 - (3 - 2) = 9.
    expect(evaluate('10 - 3 - 2')).toBe(5);
  });

  it('division is left-associative', () => {
    // Left-associative: (8 / 2) / 2 = 2, not 8 / (2 / 2) = 8.
    expect(evaluate('8 / 2 / 2')).toBe(2);
  });

  it('"or" binds tighter than "and" (non-standard precedence)', () => {
    // Groups as `(true or false) and false` = `true and false` = false.
    expect(evaluate('true or false and false')).toBe(false);
  });
});

describe('evaluate() — grouped expressions', () => {
  it('parentheses raise the precedence of an inner addition', () => {
    expect(evaluate('(1 + 2) * 3')).toBe(9);
  });

  it('parentheses group a right-hand addition', () => {
    expect(evaluate('2 * (3 + 4)')).toBe(14);
  });

  it('handles redundant nested parentheses', () => {
    expect(evaluate('((5))')).toBe(5);
  });

  it('throws when a closing parenthesis is missing', () => {
    expect(() => parse('(1 + 2')).toThrow(/Expected \) but got/);
  });
});

describe('evaluate() — IS NULL / IS NOT NULL', () => {
  it('"is null" is true when the value is null', () => {
    expect(evaluateObject('x is null', { x: null })).toBe(true);
  });

  it('"is null" is false when the value is present', () => {
    expect(evaluateObject('x is null', { x: 5 })).toBe(false);
  });

  it('"is null" is false for a missing property (undefined is not strictly null)', () => {
    expect(evaluateObject('x is null', {})).toBe(false);
  });

  it('"is not null" is true when the value is present', () => {
    expect(evaluateObject('x is not null', { x: 5 })).toBe(true);
  });

  it('"is not null" is false when the value is null', () => {
    expect(evaluateObject('x is not null', { x: null })).toBe(false);
  });

  it('throws when "is" is not followed by null', () => {
    expect(() => parse('x is 5')).toThrow(/Expected null but got/);
  });

  it('throws when "is not" is not followed by null', () => {
    expect(() => parse('x is not 5')).toThrow(/Expected null but got/);
  });
});

describe('evaluate() — BETWEEN', () => {
  it('is true for a value strictly inside the range', () => {
    expect(evaluateObject('x between 1 and 10', { x: 5 })).toBe(true);
  });

  it('is true at the lower bound (inclusive)', () => {
    expect(evaluateObject('x between 1 and 10', { x: 1 })).toBe(true);
  });

  it('is true at the upper bound (inclusive)', () => {
    expect(evaluateObject('x between 1 and 10', { x: 10 })).toBe(true);
  });

  it('is false just below the lower bound', () => {
    expect(evaluateObject('x between 1 and 10', { x: 0 })).toBe(false);
  });

  it('is false just above the upper bound', () => {
    expect(evaluateObject('x between 1 and 10', { x: 11 })).toBe(false);
  });

  it('throws when the lower bound is not numeric', () => {
    expect(() => parse('x between a and 10')).toThrow(/Expected NUM but got/);
  });

  it('throws when the "and" separator is missing', () => {
    expect(() => parse('x between 1 10')).toThrow(/Expected and but got/);
  });

  it('throws when the upper bound is not numeric', () => {
    expect(() => parse('x between 1 and b')).toThrow(/Expected NUM but got/);
  });
});

describe('evaluate() — CASE expressions', () => {
  it('returns the "then" of the matching "when"', () => {
    expect(evaluate('case when true then 1 else 2 end')).toBe(1);
  });

  it('returns the "else" branch when no "when" matches', () => {
    expect(evaluate('case when false then 1 else 2 end')).toBe(2);
  });

  it('returns false when nothing matches and there is no "else"', () => {
    expect(evaluate('case when false then 1 end')).toBe(false);
  });

  it('evaluates conditions in order and returns the first match', () => {
    expect(evaluate('case when false then 1 when true then 2 end')).toBe(2);
  });

  it('selects a branch from context and falls through to "else" at the boundary', () => {
    // x = 0: `x > 5` false and `x > 0` false (boundary) → falls to else 'neg'.
    const expr = "case when x > 5 then 'big' when x > 0 then 'small' else 'neg' end";
    expect(evaluateObject(expr, { x: 0 })).toBe('neg');
  });

  it('selects the first context-driven branch that matches', () => {
    const expr = "case when x > 5 then 'big' when x > 0 then 'small' else 'neg' end";
    expect(evaluateObject(expr, { x: 10 })).toBe('big');
  });

  it('throws when "case" is not followed by "when"', () => {
    expect(() => parse('case 1 then 2 end')).toThrow(/Expected when/);
  });

  it('throws when a "when" clause has no "then"', () => {
    expect(() => parse('case when true 1 end')).toThrow(/Expected then but got/);
  });

  it('throws when "end" is missing', () => {
    expect(() => parse('case when true then 1')).toThrow(/Expected when/);
  });

  it('throws when "end" is missing after an "else"', () => {
    expect(() => parse('case when true then 1 else 2')).toThrow(/Expected end but got/);
  });
});

describe('evaluate() — function calls', () => {
  it('evaluates length() of a string literal', () => {
    expect(evaluate("length('hello')")).toBe(5);
  });

  it('evaluates length() of an array taken from context', () => {
    expect(evaluateObject('length(items)', { items: [1, 2, 3] })).toBe(3);
  });

  it('throws when length() is given no arguments', () => {
    expect(() => evaluate('length()')).toThrow(/Length function takes exactly one argument/);
  });

  it('throws for an unimplemented function', () => {
    expect(() => evaluate("foo('x')")).toThrow(/Function foo not implemented/);
  });

  // Known limitation: the comma after an argument is not consumed, so any call
  // with two or more arguments fails to parse.
  it('throws on a call with multiple comma-separated arguments', () => {
    expect(() => parse("length('a','b')")).toThrow(/Unexpected start of expression/);
  });

  it('throws when arguments are not separated by a comma', () => {
    expect(() => parse("length('a' 'b')")).toThrow(/Expected , or \)/);
  });
});

describe('evaluate() — literals & coercion', () => {
  it('evaluates the boolean literal true', () => {
    expect(evaluate('true')).toBe(true);
  });

  it('evaluates the boolean literal false', () => {
    expect(evaluate('false')).toBe(false);
  });

  it('evaluates a single-quoted string literal', () => {
    expect(evaluate("'hello'")).toBe('hello');
  });

  it('evaluates a double-quoted string literal', () => {
    expect(evaluate('"hello"')).toBe('hello');
  });

  it('concatenates two strings with "+"', () => {
    expect(evaluate("'a' + 'b'")).toBe('ab');
  });

  it('compares strings lexicographically', () => {
    expect(evaluate("'b' > 'a'")).toBe(true);
  });

  it('uses strict equality so a string never equals a number', () => {
    expect(evaluate("'5' = 5")).toBe(false);
  });
});

describe('evaluate() — context resolution', () => {
  it('resolves identifiers through a context function', () => {
    expect(evaluate('x + y', (name) => ({ x: 10, y: 5 } as Record<string, number>)[name])).toBe(15);
  });

  it('throws a TypeError when an identifier is used without a context', () => {
    expect(() => evaluate('x')).toThrow(TypeError);
  });
});

describe('evaluateObject()', () => {
  it('resolves identifiers from object properties', () => {
    expect(evaluateObject('a + b', { a: 1, b: 2 })).toBe(3);
  });

  it('returns a string property by name', () => {
    expect(evaluateObject('name', { name: 'Bob' })).toBe('Bob');
  });

  it('returns undefined for a missing property', () => {
    expect(evaluateObject('missing', {})).toBeUndefined();
  });
});

describe('lexer behavior (via parse/evaluate)', () => {
  it('reads a decimal number', () => {
    expect(parse('1.5')).toEqual(new ValueExpression(1.5));
  });

  it('reads a number that starts with a dot', () => {
    expect(parse('.5')).toEqual(new ValueExpression(0.5));
  });

  it('reads a number that ends with a dot', () => {
    expect(parse('5.')).toEqual(new ValueExpression(5));
  });

  it('stops the first number at a second dot, leaving the rest as a trailing token', () => {
    // `1.2.3` lexes as NUM(1.2) NUM(.3); the parser keeps only the first number.
    expect(evaluate('1.2.3')).toBe(1.2);
  });

  it('reads an unterminated string up to the end of input', () => {
    expect(evaluate("'abc")).toBe('abc');
  });

  it('treats underscores as identifier characters', () => {
    expect(parse('foo_bar')).toEqual(new IdentifierExpression('foo_bar'));
  });

  it('allows an identifier to start with an underscore', () => {
    expect(parse('_foo')).toEqual(new IdentifierExpression('_foo'));
  });

  it('ends an identifier at the first digit', () => {
    // `foo123` lexes as IDENT(foo) NUM(123); the parser keeps only the identifier.
    expect(parse('foo123')).toEqual(new IdentifierExpression('foo'));
  });

  it('skips tabs, carriage returns and newlines between tokens', () => {
    expect(evaluate('1\t+\r\n2')).toBe(3);
  });
});

describe('parse() — invalid input', () => {
  it('throws on empty input', () => {
    expect(() => parse('')).toThrow(/Unexpected start of expression/);
  });

  it('throws on a leading minus (no unary operator support)', () => {
    expect(() => parse('-1')).toThrow(/Unexpected start of expression/);
  });

  it('throws when an expression starts with "not"', () => {
    expect(() => parse('not x')).toThrow(/Unexpected start of expression/);
  });

  it('throws on an illegal character at the start of input', () => {
    expect(() => parse('@')).toThrow(/Unexpected start of expression/);
  });

  it('throws on an illegal character encountered mid-stream', () => {
    expect(() => parse('1 + @')).toThrow(/Invalid input/);
  });
});
