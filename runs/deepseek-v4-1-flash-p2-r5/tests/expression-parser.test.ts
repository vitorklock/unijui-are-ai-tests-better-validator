import { describe, expect, it } from 'vitest';
import {
  BinaryExpression,
  CaseExpression,
  FunctionCallExpression,
  IdentifierExpression,
  ValueExpression,
} from '../src/ast';
import { evaluate, evaluateObject } from '../src/evaluator';
import { Lexer } from '../src/lexer';
import { parse } from '../src/parser';
import { Token, TokenType } from '../src/token';

describe('Lexer', () => {
  it.each([
    ['=', TokenType.Eq],
    ['<>', TokenType.Neq],
    ['<', TokenType.Lt],
    ['<=', TokenType.Lte],
    ['>', TokenType.Gt],
    ['>=', TokenType.Gte],
    ['+', TokenType.Plus],
    ['-', TokenType.Minus],
    ['*', TokenType.Mul],
    ['/', TokenType.Div],
    ['(', TokenType.Lparn],
    [')', TokenType.Rparn],
    [',', TokenType.Comma],
  ])('tokenizes %s as %s', (source, type) => {
    expect(new Lexer(source).next()).toEqual(new Token(type, type, 0));
  });

  it.each([
    ['name', TokenType.Identifier, 'name'],
    ['_under', TokenType.Identifier, '_under'],
    ['TRUE', TokenType.True, 'true'],
    ['false', TokenType.False, 'false'],
    ['and', TokenType.And, 'and'],
    ['or', TokenType.Or, 'or'],
    ['not', TokenType.Not, 'not'],
    ['null', TokenType.Null, 'null'],
    ['is', TokenType.Is, 'is'],
    ['between', TokenType.Between, 'between'],
    ['case', TokenType.Case, 'case'],
    ['when', TokenType.When, 'when'],
    ['then', TokenType.Then, 'then'],
    ['else', TokenType.Else, 'else'],
    ['end', TokenType.End, 'end'],
  ])('tokenizes %s as %s with literal %s', (source, type, literal) => {
    expect(new Lexer(source).next()).toEqual(new Token(type, literal, 0));
  });

  it.each([
    ['123', '123'],
    ['1.5', '1.5'],
    ['.5', '.5'],
  ])('tokenizes numeric literal %s', (source, literal) => {
    expect(new Lexer(source).next()).toEqual(new Token(TokenType.Numeric, literal, 0));
  });

  it('stops a numeric token before a second decimal point', () => {
    expect(new Lexer('1.2.3').next()).toEqual(new Token(TokenType.Numeric, '1.2', 0));
  });

  it('tokenizes a single-quoted string without the quotes', () => {
    expect(new Lexer("'abc'").next()).toEqual(new Token(TokenType.String, 'abc', 1));
  });

  it('tokenizes an unterminated string to the end of input', () => {
    expect(new Lexer("'abc").next()).toEqual(new Token(TokenType.String, 'abc', 1));
  });

  it('skips all supported whitespace before a token', () => {
    expect(new Lexer('\t\n\r 42').next()).toEqual(new Token(TokenType.Numeric, '42', 4));
  });

  it('tokenizes unsupported characters as illegal', () => {
    expect(new Lexer('@').next()).toEqual(new Token(TokenType.Illegal, '@', 0));
  });

  it('returns an EOF token for empty input', () => {
    expect(new Lexer('').next()).toEqual(new Token(TokenType.EOF, '\0', 0));
  });

  it('formats a token for parser error messages', () => {
    expect(new Token(TokenType.Identifier, 'name', 7).toString()).toBe(
      '{ type: IDENT, literal: name } as position: 7.',
    );
  });
});

describe('parse', () => {
  it('parses a numeric literal', () => {
    expect(parse('42')).toEqual(new ValueExpression(42));
  });

  it('parses a string literal', () => {
    expect(parse("'hello'")).toEqual(new ValueExpression('hello'));
  });

  it('parses true', () => {
    expect(parse('true')).toEqual(new ValueExpression(true));
  });

  it('parses false', () => {
    expect(parse('false')).toEqual(new ValueExpression(false));
  });

  it('parses an identifier with underscores and uppercase letters', () => {
    expect(parse('User_Name')).toEqual(new IdentifierExpression('User_Name'));
  });

  it('parses a binary addition expression', () => {
    expect(parse('1 + 2')).toEqual(
      new BinaryExpression(
        TokenType.Plus,
        new ValueExpression(1),
        new ValueExpression(2),
      ),
    );
  });

  it('parses a grouped expression', () => {
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

  it('parses a function call with one argument', () => {
    expect(parse("length('abc')")).toEqual(
      new FunctionCallExpression('length', [new ValueExpression('abc')]),
    );
  });

  it('parses a function call with no arguments', () => {
    expect(parse('fn()')).toEqual(new FunctionCallExpression('fn', []));
  });

  it('parses an is-null check', () => {
    expect(parse('x is null')).toEqual(
      new BinaryExpression(
        TokenType.Eq,
        new IdentifierExpression('x'),
        new ValueExpression(null),
      ),
    );
  });

  it('parses an is-not-null check', () => {
    expect(parse('x is not null')).toEqual(
      new BinaryExpression(
        TokenType.Neq,
        new IdentifierExpression('x'),
        new ValueExpression(null),
      ),
    );
  });

  it('parses a between expression', () => {
    expect(parse('x between 1 and 3')).toEqual(
      new BinaryExpression(
        TokenType.And,
        new BinaryExpression(
          TokenType.Gte,
          new IdentifierExpression('x'),
          new ValueExpression(1),
        ),
        new BinaryExpression(
          TokenType.Lte,
          new IdentifierExpression('x'),
          new ValueExpression(3),
        ),
      ),
    );
  });

  it('parses a case expression with multiple branches and an else', () => {
    expect(parse('case when a then 1 when b then 2 else 3 end')).toEqual(
      new CaseExpression(
        [
          { when: new IdentifierExpression('a'), then: new ValueExpression(1) },
          { when: new IdentifierExpression('b'), then: new ValueExpression(2) },
        ],
        new ValueExpression(3),
      ),
    );
  });

  it('parses a case expression without an else', () => {
    expect(parse('case when a then 1 end')).toEqual(
      new CaseExpression([
        { when: new IdentifierExpression('a'), then: new ValueExpression(1) },
      ]),
    );
  });

  it('returns the left expression when the next token has no infix parser', () => {
    expect(parse('1 not 2')).toEqual(new ValueExpression(1));
  });
});

describe('evaluate literals and identifiers', () => {
  it.each([
    ['42', 42],
    ["'hello'", 'hello'],
    ['"hello"', 'hello'],
    ['true', true],
    ['false', false],
    ['TRUE', true],
    ['FaLsE', false],
  ])('evaluates %s to %j', (expression, expected) => {
    expect(evaluate(expression)).toBe(expected);
  });

  it('evaluates an identifier with a context function', () => {
    expect(
      evaluate('answer', (name) => (name === 'answer' ? 42 : undefined)),
    ).toBe(42);
  });

  it('evaluates an identifier through evaluateObject', () => {
    expect(evaluateObject('answer', { answer: 42 })).toBe(42);
  });

  it('evaluates a binary expression through evaluateObject', () => {
    expect(evaluateObject('left + right', { left: 2, right: 3 })).toBe(5);
  });

  it('returns undefined for a missing evaluateObject property', () => {
    expect(evaluateObject('missing', {})).toBeUndefined();
  });

  it('throws when an identifier is evaluated without a context', () => {
    expect(() => evaluate('missing')).toThrow(TypeError);
  });
});

describe('evaluate binary operators', () => {
  it.each([
    ['1 + 2', 3],
    ['"a" + "b"', 'ab'],
    ['5 - 3', 2],
    ['4 * 3', 12],
    ['8 / 2', 4],
    ['1 = 1', true],
    ['1 = 2', false],
    ['1 = "1"', false],
    ['1 <> 2', true],
    ['1 <> 1', false],
    ['3 > 2', true],
    ['2 > 2', false],
    ['3 >= 3', true],
    ['2 >= 3', false],
    ['1 < 2', true],
    ['2 < 2', false],
    ['2 <= 2', true],
    ['3 <= 2', false],
    ['1 and 2', 2],
    ['0 and 2', 0],
    ['0 or 2', 2],
    ['1 or 2', 1],
  ])('evaluates %s to %j', (expression, expected) => {
    expect(evaluate(expression)).toBe(expected);
  });
});

describe('evaluate precedence and associativity', () => {
  it('gives multiplication higher precedence than addition', () => {
    expect(evaluate('1 + 2 * 3')).toBe(7);
  });

  it('evaluates grouped expressions before binary operators', () => {
    expect(evaluate('(1 + 2) * 3')).toBe(9);
  });

  it('evaluates subtraction from left to right', () => {
    expect(evaluate('10 - 3 - 2')).toBe(5);
  });

  it('evaluates division from left to right', () => {
    expect(evaluate('8 / 4 / 2')).toBe(1);
  });

  it('gives multiplication higher precedence than equality', () => {
    expect(evaluate('1 + 2 * 3 = 7')).toBe(true);
  });

  it('uses the configured precedence for or before and', () => {
    expect(evaluate('true or false and false')).toBe(false);
  });

  it('uses the configured precedence for and before or in nested position', () => {
    expect(evaluate('true and false or true')).toBe(true);
  });
});

describe('logical short-circuiting', () => {
  it('does not evaluate the right side of a falsy and expression', () => {
    expect(evaluate('0 and unknown()')).toBe(0);
  });

  it('does not evaluate the right side of a truthy or expression', () => {
    expect(evaluate('1 or unknown()')).toBe(1);
  });

  it('evaluates the right side of a truthy and expression', () => {
    expect(() => evaluate('1 and unknown()')).toThrow(
      'Function unknown not implemented',
    );
  });

  it('evaluates the right side of a falsy or expression', () => {
    expect(() => evaluate('0 or unknown()')).toThrow(
      'Function unknown not implemented',
    );
  });
});

describe('evaluate function calls', () => {
  it('returns the length of a string', () => {
    expect(evaluate("length('hello')")).toBe(5);
  });

  it('returns zero for an empty string', () => {
    expect(evaluate("length('')")).toBe(0);
  });

  it('evaluates a function call inside a larger expression', () => {
    expect(evaluate("length('abc') + 1")).toBe(4);
  });

  it('rejects length calls without exactly one argument', () => {
    expect(() => evaluate('length()')).toThrow(
      'Length function takes exactly one argument.',
    );
  });

  it('rejects unknown functions', () => {
    expect(() => evaluate("unknown('x')")).toThrow(
      'Function unknown not implemented',
    );
  });
});

describe('evaluate is-null and between', () => {
  it('evaluates is null as true for null', () => {
    expect(evaluateObject('value is null', { value: null })).toBe(true);
  });

  it('evaluates is null as false for non-null', () => {
    expect(evaluateObject('value is null', { value: 0 })).toBe(false);
  });

  it('evaluates is not null as false for null', () => {
    expect(evaluateObject('value is not null', { value: null })).toBe(false);
  });

  it('evaluates is not null as true for non-null', () => {
    expect(evaluateObject('value is not null', { value: 0 })).toBe(true);
  });

  it.each([
    [0, false],
    [1, true],
    [2, true],
    [3, true],
    [4, false],
  ])('evaluates value between 1 and 3 for %i', (value, expected) => {
    expect(evaluateObject('value between 1 and 3', { value })).toBe(expected);
  });
});

describe('evaluate case expressions', () => {
  it('returns the first matching branch', () => {
    expect(evaluate("case when 1 = 1 then 'first' else 'fallback' end")).toBe(
      'first',
    );
  });

  it('returns the else branch when no condition matches', () => {
    expect(evaluate("case when 1 = 2 then 'first' else 'fallback' end")).toBe(
      'fallback',
    );
  });

  it('returns a later matching branch', () => {
    expect(
      evaluate(
        "case when 1 = 2 then 'first' when 2 = 2 then 'second' else 'fallback' end",
      ),
    ).toBe('second');
  });

  it('returns the then branch when no else is present and a condition matches', () => {
    expect(evaluate("case when 1 = 1 then 'first' end")).toBe('first');
  });

  it('returns false when no else is present and no condition matches', () => {
    expect(evaluate("case when 1 = 2 then 'first' end")).toBe(false);
  });

  it('evaluates a case expression against an object context', () => {
    expect(
      evaluateObject("case when score >= 90 then 'A' else 'F' end", {
        score: 95,
      }),
    ).toBe('A');
  });
});

describe('parse errors', () => {
  it.each([
    [')', /Unexpected start of expression/],
    ['1 + @', /Invalid input/],
    ['(1 + 2', /Expected \)/],
    ['1 is 2', /Expected null/],
    ["1 between 'a' and 2", /Expected NUM/],
    ["1 between 1 'x' 2", /Expected and/],
    ["1 between 1 and 'x'", /Expected NUM/],
    ['length(1 2)', /Expected , or \)/],
    ['length(1, 2)', /Unexpected start of expression/],
    ['case 1 end', /Expected when/],
    ['case when 1 2 end', /Expected then/],
    ['case when 1 = 1 then 2 else 3', /Expected end/],
    ['case when 1 = 1 then 2', /Expected when/],
  ])('throws for malformed expression %s', (expression, pattern) => {
    expect(() => parse(expression)).toThrow(pattern);
  });
});
