```ts
import { describe, expect, it } from 'vitest';
import {
  BinaryExpression,
  CaseExpression,
  FunctionCallExpression,
  IdentifierExpression,
  UnaryExpression,
  ValueExpression,
} from '../src/ast';
import { evaluate, evaluateObject } from '../src/evaluator';
import { parse } from '../src/parser';
import { TokenType } from '../src/token';

describe('parse', () => {
  it('parses numeric literals into value expressions', () => {
    expect(parse('42')).toEqual(new ValueExpression(42));
  });

  it('parses double-quoted string literals', () => {
    expect(parse('"hello"')).toEqual(new ValueExpression('hello'));
  });

  it('parses single-quoted string literals', () => {
    expect(parse("'hello'")).toEqual(new ValueExpression('hello'));
  });

  it('parses a string that reaches the end of input without a closing quote', () => {
    expect(parse('"unterminated')).toEqual(new ValueExpression('unterminated'));
  });

  it('parses true literals', () => {
    expect(parse('true')).toEqual(new ValueExpression(true));
  });

  it('parses false literals', () => {
    expect(parse('false')).toEqual(new ValueExpression(false));
  });

  it('parses identifiers containing letters and underscores', () => {
    expect(parse('A_Z_a_z')).toEqual(new IdentifierExpression('A_Z_a_z'));
  });

  it('parses grouped expressions before applying outer precedence', () => {
    expect(parse('(1 + 2) * 3')).toEqual(
      new BinaryExpression(
        TokenType.Mul,
        new BinaryExpression(TokenType.Plus, new ValueExpression(1), new ValueExpression(2)),
        new ValueExpression(3),
      ),
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

  it('parses subtraction left-associatively', () => {
    expect(parse('10 - 3 - 2')).toEqual(
      new BinaryExpression(
        TokenType.Minus,
        new BinaryExpression(TokenType.Minus, new ValueExpression(10), new ValueExpression(3)),
        new ValueExpression(2),
      ),
    );
  });

  it('parses is null expressions', () => {
    expect(parse('x is null')).toEqual(
      new BinaryExpression(TokenType.Eq, new IdentifierExpression('x'), new ValueExpression(null)),
    );
  });

  it('parses is not null expressions', () => {
    expect(parse('x is not null')).toEqual(
      new BinaryExpression(TokenType.Neq, new IdentifierExpression('x'), new ValueExpression(null)),
    );
  });

  it('parses between expressions as inclusive comparisons', () => {
    expect(parse('x between 1 and 2')).toEqual(
      new BinaryExpression(
        TokenType.And,
        new BinaryExpression(TokenType.Gte, new IdentifierExpression('x'), new ValueExpression(1)),
        new BinaryExpression(TokenType.Lte, new IdentifierExpression('x'), new ValueExpression(2)),
      ),
    );
  });

  it('parses function calls with one argument', () => {
    expect(parse('length("abc")')).toEqual(
      new FunctionCallExpression('length', [new ValueExpression('abc')]),
    );
  });

  it('parses function calls with no arguments', () => {
    expect(parse('zero()')).toEqual(new FunctionCallExpression('zero', []));
  });

  it('parses case expressions with an else branch', () => {
    expect(parse('case when true then 1 else 2 end')).toEqual(
      new CaseExpression(
        [{ when: new ValueExpression(true), then: new ValueExpression(1) }],
        new ValueExpression(2),
      ),
    );
  });

  it('stops a numeric literal at a second decimal point', () => {
    expect(parse('1.2.3')).toEqual(new ValueExpression(1.2));
  });

  it('returns the left expression when the next token has no infix parser', () => {
    expect(parse('x not null')).toEqual(new IdentifierExpression('x'));
  });
});

describe('AST nodes', () => {
  it('constructs unary expression nodes with the supplied operator and operand', () => {
    expect(new UnaryExpression(TokenType.Not, new ValueExpression(true))).toEqual({
      type: 'UnaryExpression',
      operator: TokenType.Not,
      operand: new ValueExpression(true),
    });
  });
});

describe('parse errors', () => {
  it('rejects expressions that start with an infix operator', () => {
    expect(() => parse('+ 1')).toThrow(
      'Unexpected start of expression: { type: +, literal: + } as position: 0.',
    );
  });

  it('rejects incomplete binary expressions', () => {
    expect(() => parse('1 +')).toThrow(/Unexpected start of expression/);
  });

  it('rejects illegal characters above the numeric range', () => {
    expect(() => parse('1 + @')).toThrow(
      'Invalid input: { type: ILLEGAL, literal: @ } as position: 4.',
    );
  });

  it('rejects illegal characters below the numeric range', () => {
    expect(() => parse('1 + !')).toThrow(
      'Invalid input: { type: ILLEGAL, literal: ! } as position: 4.',
    );
  });

  it('rejects unterminated grouped expressions', () => {
    expect(() => parse('(1')).toThrow(/Expected \) but got \{ type: EOF/);
  });

  it('rejects call arguments without a comma or closing parenthesis', () => {
    expect(() => parse('length("a" 1)')).toThrow(
      'Expected , or ) got { type: NUM, literal: 1 } as position: 11.',
    );
  });

  it('rejects multiple call arguments because the comma is not consumed', () => {
    expect(() => parse('length("a", "b")')).toThrow(/Unexpected start of expression/);
  });

  it('rejects case expressions without an initial when branch', () => {
    expect(() => parse('case 1 end')).toThrow(
      'Expected when got { type: case, literal: case } as position: 0.',
    );
  });
});

describe('evaluate literals and context', () => {
  it('evaluates numeric literals', () => {
    expect(evaluate('42')).toBe(42);
  });

  it('evaluates the upper numeric digit boundary', () => {
    expect(evaluate('9')).toBe(9);
  });

  it('evaluates string literals', () => {
    expect(evaluate('"hello"')).toBe('hello');
  });

  it('evaluates true literals', () => {
    expect(evaluate('true')).toBe(true);
  });

  it('evaluates false literals', () => {
    expect(evaluate('false')).toBe(false);
  });

  it('evaluates identifiers through a context function', () => {
    expect(evaluate('answer', (name) => (name === 'answer' ? 42 : undefined))).toBe(42);
  });
});

describe('evaluate arithmetic', () => {
  it('adds numbers', () => {
    expect(evaluate('2 + 3')).toBe(5);
  });

  it('concatenates strings with plus', () => {
    expect(evaluate('"a" + "b"')).toBe('ab');
  });

  it('subtracts numbers', () => {
    expect(evaluate('5 - 2')).toBe(3);
  });

  it('multiplies numbers', () => {
    expect(evaluate('4 * 3')).toBe(12);
  });

  it('divides numbers without integer truncation', () => {
    expect(evaluate('5 / 2')).toBe(2.5);
  });

  it('supports decimal and leading-dot numeric literals', () => {
    expect(evaluate('1.5 + .5')).toBe(2);
  });

  it('ignores tabs, newlines, carriage returns, and spaces', () => {
    expect(evaluate('\t1\n+\r2 ')).toBe(3);
  });

  it('evaluates multiplication before addition', () => {
    expect(evaluate('1 + 2 * 3')).toBe(7);
  });

  it('evaluates subtraction left-associatively', () => {
    expect(evaluate('10 - 3 - 2')).toBe(5);
  });
});

describe('evaluate comparisons', () => {
  it('compares equal values', () => {
    expect(evaluate('1 = 1')).toBe(true);
  });

  it('uses strict equality for =', () => {
    expect(evaluate('1 = "1"')).toBe(false);
  });

  it('compares unequal values', () => {
    expect(evaluate('1 <> 2')).toBe(true);
  });

  it('detects equal values with <>', () => {
    expect(evaluate('1 <> 1')).toBe(false);
  });

  it('evaluates greater-than above the boundary', () => {
    expect(evaluate('2 > 1')).toBe(true);
  });

  it('evaluates greater-than at the boundary', () => {
    expect(evaluate('1 > 1')).toBe(false);
  });

  it('evaluates greater-than-or-equal at the boundary', () => {
    expect(evaluate('1 >= 1')).toBe(true);
  });

  it('evaluates greater-than-or-equal below the boundary', () => {
    expect(evaluate('0 >= 1')).toBe(false);
  });

  it('evaluates less-than below the boundary', () => {
    expect(evaluate('1 < 2')).toBe(true);
  });

  it('evaluates less-than at the boundary', () => {
    expect(evaluate('2 < 2')).toBe(false);
  });

  it('evaluates less-than-or-equal at the boundary', () => {
    expect(evaluate('2 <= 2')).toBe(true);
  });

  it('evaluates less-than-or-equal above the boundary', () => {
    expect(evaluate('3 <= 2')).toBe(false);
  });
});

describe('evaluate logical operators', () => {
  it('returns the right operand for a truthy and left operand', () => {
    expect(evaluate('1 and 2')).toBe(2);
  });

  it('short-circuits and when the left operand is falsy', () => {
    expect(evaluate('0 and unknown()')).toBe(0);
  });

  it('returns the right operand for a falsy or left operand', () => {
    expect(evaluate('0 or 5')).toBe(5);
  });

  it('short-circuits or when the left operand is truthy', () => {
    expect(evaluate('1 or unknown()')).toBe(1);
  });

  it('gives or higher precedence than and', () => {
    expect(evaluate('true or false and false')).toBe(false);
  });
});

describe('evaluate between and is null', () => {
  it('includes the lower between boundary', () => {
    expect(evaluate('1 between 1 and 2')).toBe(true);
  });

  it('includes the upper between boundary', () => {
    expect(evaluate('2 between 1 and 2')).toBe(true);
  });

  it('excludes values just below the between range', () => {
    expect(evaluate('0.9 between 1 and 2')).toBe(false);
  });

  it('excludes values just above the between range', () => {
    expect(evaluate('2.1 between 1 and 2')).toBe(false);
  });

  it('evaluates is null for null values', () => {
    expect(evaluateObject('value is null', { value: null })).toBe(true);
  });

  it('evaluates is not null for null values', () => {
    expect(evaluateObject('value is not null', { value: null })).toBe(false);
  });

  it('evaluates is null strictly for non-null values', () => {
    expect(evaluateObject('value is null', { value: 0 })).toBe(false);
  });
});

describe('evaluate case expressions', () => {
  it('returns the then branch for a matching first condition', () => {
    expect(evaluate('case when 1 = 1 then "yes" else "no" end')).toBe('yes');
  });

  it('returns the then branch for a matching later condition', () => {
    expect(evaluate('case when 1 = 2 then "a" when 2 = 2 then "b" else "c" end')).toBe('b');
  });

  it('returns false when no condition matches and there is no else', () => {
    expect(evaluate('case when 1 = 2 then "yes" end')).toBe(false);
  });

  it('returns a falsy else value when no condition matches', () => {
    expect(evaluate('case when 1 = 2 then 1 else 0 end')).toBe(0);
  });
});

describe('evaluate function calls', () => {
  it('returns the length of a string argument', () => {
    expect(evaluate('length("hello")')).toBe(5);
  });

  it('returns the length of an array from the context', () => {
    expect(evaluateObject('length(items)', { items: [1, 2, 3] })).toBe(3);
  });

  it('rejects length calls without exactly one argument', () => {
    expect(() => evaluate('length()')).toThrow('Length function takes exactly one argument.');
  });

  it('rejects unimplemented functions', () => {
    expect(() => evaluate('unknown(1)')).toThrow('Function unknown not implemented');
  });
});

describe('evaluateObject', () => {
  it('reads an identifier from an object value', () => {
    expect(evaluateObject('name', { name: 'Ada' })).toBe('Ada');
  });
});
```