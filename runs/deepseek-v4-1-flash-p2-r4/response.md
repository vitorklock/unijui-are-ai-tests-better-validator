```ts
import { describe, expect, it } from 'vitest';
import {
  BinaryExpression,
  CaseExpression,
  FunctionCallExpression,
  IdentifierExpression,
  ValueExpression,
  type Expression,
} from '../src/ast';
import { evaluate, evaluateObject } from '../src/evaluator';
import { parse } from '../src/parser';
import { Token, TokenType } from '../src/token';

const value = (input: unknown) => new ValueExpression(input);
const identifier = (name: string) => new IdentifierExpression(name);
const binary = (operator: TokenType, left: Expression, right: Expression) =>
  new BinaryExpression(operator, left, right);

describe('literal parsing', () => {
  it('parses an integer numeric literal', () => {
    expect(parse('42')).toEqual(value(42));
  });

  it('parses a decimal numeric literal', () => {
    expect(parse('3.14')).toEqual(value(3.14));
  });

  it('parses a numeric literal beginning with a decimal point', () => {
    expect(parse('.5')).toEqual(value(0.5));
  });

  it('stops a numeric literal at a second decimal point', () => {
    expect(parse('1.2.3')).toEqual(value(1.2));
  });

  it('parses a single-quoted string literal', () => {
    expect(parse("'hello'")).toEqual(value('hello'));
  });

  it('parses a double-quoted string literal', () => {
    expect(parse('"world"')).toEqual(value('world'));
  });

  it('parses an empty string literal', () => {
    expect(parse("''")).toEqual(value(''));
  });

  it('parses an unterminated string literal up to end of input', () => {
    expect(parse("'unfinished")).toEqual(value('unfinished'));
  });

  it('parses a true boolean literal', () => {
    expect(parse('true')).toEqual(value(true));
  });

  it('parses a false boolean literal', () => {
    expect(parse('false')).toEqual(value(false));
  });

  it('resolves keywords case-insensitively', () => {
    expect(parse('TRUE')).toEqual(value(true));
  });

  it('parses identifiers with uppercase, lowercase, and underscore characters', () => {
    expect(parse('A_z')).toEqual(identifier('A_z'));
  });

  it('ignores all supported whitespace characters', () => {
    expect(parse('\t\n\r 123')).toEqual(value(123));
  });
});

describe('operator parsing and precedence', () => {
  it('parses addition as a binary expression', () => {
    expect(parse('1 + 2')).toEqual(binary(TokenType.Plus, value(1), value(2)));
  });

  it('applies multiplication before addition', () => {
    expect(parse('1 + 2 * 3')).toEqual(
      binary(TokenType.Plus, value(1), binary(TokenType.Mul, value(2), value(3))),
    );
  });

  it('honors parentheses over operator precedence', () => {
    expect(parse('(1 + 2) * 3')).toEqual(
      binary(TokenType.Mul, binary(TokenType.Plus, value(1), value(2)), value(3)),
    );
  });

  it('parses subtraction as left-associative', () => {
    expect(parse('10 - 3 - 2')).toEqual(
      binary(TokenType.Minus, binary(TokenType.Minus, value(10), value(3)), value(2)),
    );
  });
});

type OperatorCase = [description: string, expression: string, expected: unknown];

const operatorCases: OperatorCase[] = [
  ['addition', '7 + 5', 12],
  ['subtraction', '7 - 5', 2],
  ['multiplication', '7 * 5', 35],
  ['division', '7 / 2', 3.5],
  ['equality for equal values', '7 = 7', true],
  ['equality for different values', '7 = 8', false],
  ['strict equality without type coercion', '1 = "1"', false],
  ['inequality for different values', '7 <> 8', true],
  ['inequality for equal values', '7 <> 7', false],
  ['strict inequality without type coercion', '1 <> "1"', true],
  ['greater than above boundary', '8 > 7', true],
  ['greater than at boundary', '7 > 7', false],
  ['greater than or equal at boundary', '7 >= 7', true],
  ['greater than or equal below boundary', '6 >= 7', false],
  ['less than below boundary', '6 < 7', true],
  ['less than at boundary', '7 < 7', false],
  ['less than or equal at boundary', '7 <= 7', true],
  ['less than or equal above boundary', '8 <= 7', false],
  ['logical and with both operands true', 'true and true', true],
  ['logical and with a false right operand', 'true and false', false],
  ['logical and short-circuiting on a false left operand', 'false and true', false],
  ['logical or with a true right operand', 'false or true', true],
  ['logical or with both operands false', 'false or false', false],
  ['logical or short-circuiting on a true left operand', 'true or false', true],
];

describe('binary operator evaluation', () => {
  it.each(operatorCases)('evaluates %s', (_description, expression, expected) => {
    expect(evaluate(expression)).toBe(expected);
  });

  it('applies the configured or-before-and precedence', () => {
    expect(evaluate('false and true or true')).toBe(false);
  });

  it('evaluates identifiers through a context callback', () => {
    expect(evaluate('price + 3', (name) => (name === 'price' ? 12 : undefined))).toBe(15);
  });
});

type BetweenCase = [description: string, expression: string, expected: boolean];

const betweenCases: BetweenCase[] = [
  ['inside the range', '5 between 1 and 10', true],
  ['at the lower boundary', '1 between 1 and 10', true],
  ['at the upper boundary', '10 between 1 and 10', true],
  ['below the range', '0 between 1 and 10', false],
  ['above the range', '11 between 1 and 10', false],
];

describe('between parsing and evaluation', () => {
  it('parses between as inclusive lower and upper comparisons', () => {
    expect(parse('5 between 1 and 10')).toEqual(
      binary(
        TokenType.And,
        binary(TokenType.Gte, value(5), value(1)),
        binary(TokenType.Lte, value(5), value(10)),
      ),
    );
  });

  it.each(betweenCases)('evaluates between when the value is %s', (_description, expression, expected) => {
    expect(evaluate(expression)).toBe(expected);
  });
});

describe('null predicates', () => {
  it('parses is null as equality with null', () => {
    expect(parse('field is null')).toEqual(binary(TokenType.Eq, identifier('field'), value(null)));
  });

  it('parses is not null as inequality with null', () => {
    expect(parse('field is not null')).toEqual(binary(TokenType.Neq, identifier('field'), value(null)));
  });

  it('evaluates is null true for a null property', () => {
    expect(evaluateObject('field is null', { field: null })).toBe(true);
  });

  it('evaluates is null false for a non-null property', () => {
    expect(evaluateObject('field is null', { field: 0 })).toBe(false);
  });

  it('evaluates is not null true for a non-null property', () => {
    expect(evaluateObject('field is not null', { field: 0 })).toBe(true);
  });

  it('evaluates is not null false for a null property', () => {
    expect(evaluateObject('field is not null', { field: null })).toBe(false);
  });
});

describe('function calls', () => {
  it('parses a function call with one argument', () => {
    expect(parse('length("hello")')).toEqual(new FunctionCallExpression('length', [value('hello')]));
  });

  it('evaluates length of a string argument', () => {
    expect(evaluate('length("hello")')).toBe(5);
  });

  it('evaluates length of an array returned by context', () => {
    expect(evaluate('length(items)', (name) => (name === 'items' ? [1, 2, 3] : undefined))).toBe(3);
  });

  it('throws when length receives zero arguments', () => {
    expect(() => evaluate('length()')).toThrow('Length function takes exactly one argument.');
  });

  it('throws for an unknown function', () => {
    expect(() => evaluate('unknown(1)')).toThrow('Function unknown not implemented');
  });

  it('throws when a call argument is not followed by a comma or closing parenthesis', () => {
    expect(() => parse('foo(1 2)')).toThrow(/Expected , or \)/);
  });

  it('rejects comma-separated call arguments at the comma', () => {
    expect(() => parse('foo(1, 2)')).toThrow(/Unexpected start of expression/);
  });
});

describe('case expressions', () => {
  it('parses a case expression with an else branch', () => {
    expect(parse('case when true then 1 else 2 end')).toEqual(
      new CaseExpression([{ when: value(true), then: value(1) }], value(2)),
    );
  });

  it('parses a case expression without an else branch', () => {
    expect(parse('case when false then 1 end')).toEqual(
      new CaseExpression([{ when: value(false), then: value(1) }]),
    );
  });

  it('evaluates the first matching case branch', () => {
    expect(evaluate('case when 1 = 1 then "first" when 2 = 2 then "second" end')).toBe('first');
  });

  it('evaluates a later matching case branch after a false condition', () => {
    expect(evaluate('case when 1 = 2 then "first" when 2 = 2 then "second" else "fallback" end')).toBe(
      'second',
    );
  });

  it('evaluates the else branch when no case condition matches', () => {
    expect(evaluate('case when 1 = 2 then "first" else "fallback" end')).toBe('fallback');
  });

  it('returns false when no case condition matches and there is no else branch', () => {
    expect(evaluate('case when 1 = 2 then "first" end')).toBe(false);
  });

  it('throws when a case expression does not start with when', () => {
    expect(() => parse('case end')).toThrow(/Expected when/);
  });

  it('throws when a case condition is missing then', () => {
    expect(() => parse('case when true 1 end')).toThrow(/Expected then/);
  });

  it('throws when a case expression with else is missing end', () => {
    expect(() => parse('case when true then 1 else 2')).toThrow(/Expected end/);
  });
});

describe('parser errors and edge cases', () => {
  it('throws when an expression starts with a token that has no prefix parser', () => {
    expect(() => parse('+ 1')).toThrow(/Unexpected start of expression/);
  });

  it('throws for an empty expression', () => {
    expect(() => parse('')).toThrow(/Unexpected start of expression/);
  });

  it('throws on illegal input encountered while advancing tokens', () => {
    expect(() => evaluate('1 + @')).toThrow(/Invalid input/);
  });

  it('throws when a grouped expression is missing its closing parenthesis', () => {
    expect(() => parse('(1 + 2')).toThrow(/Expected \)/);
  });

  it('throws when is null is missing the null token', () => {
    expect(() => parse('field is 1')).toThrow(/Expected null/);
  });

  it('throws when between is missing a numeric lower bound', () => {
    expect(() => parse('5 between low and 10')).toThrow(/Expected NUM/);
  });

  it('throws when between is missing the and token', () => {
    expect(() => parse('5 between 1 or 10')).toThrow(/Expected and/);
  });

  it('throws when between is missing a numeric upper bound', () => {
    expect(() => parse('5 between 1 and high')).toThrow(/Expected NUM/);
  });

  it('returns the parsed prefix when no infix parser exists for the next token', () => {
    expect(parse('1 not 2')).toEqual(value(1));
  });
});

describe('evaluateObject', () => {
  it('resolves identifiers from object properties', () => {
    expect(evaluateObject('price * quantity', { price: 10, quantity: 3 })).toBe(30);
  });

  it('returns undefined for a missing object property', () => {
    expect(evaluateObject('missing', {})).toBeUndefined();
  });
});

describe('Token', () => {
  it('formats its type, literal, and position', () => {
    expect(new Token(TokenType.Numeric, '42', 7).toString()).toBe(
      '{ type: NUM, literal: 42 } as position: 7.',
    );
  });
});
```