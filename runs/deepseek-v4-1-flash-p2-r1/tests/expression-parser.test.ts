import { describe, expect, it } from 'vitest';
import {
  BinaryExpression,
  CaseExpression,
  FunctionCallExpression,
  IdentifierExpression,
  ValueExpression,
} from '../src/ast';
import type { Expression } from '../src/ast';
import { evaluate, evaluateObject } from '../src/evaluator';
import { parse } from '../src/parser';
import { TokenType } from '../src/token';

function id(name: string): Expression {
  return new IdentifierExpression(name);
}

function num(value: number): Expression {
  return new ValueExpression(value);
}

function str(value: string): Expression {
  return new ValueExpression(value);
}

function bin(operator: TokenType, left: Expression, right: Expression): Expression {
  return new BinaryExpression(operator, left, right);
}

describe('parse', () => {
  it('parses an identifier with uppercase, lowercase, and underscore characters', () => {
    expect(parse('ABC_def')).toStrictEqual(new IdentifierExpression('ABC_def'));
  });

  const numericCases: Array<[string, number]> = [
    ['42', 42],
    ['3.14', 3.14],
    ['.5', 0.5],
  ];

  it.each(numericCases)('parses numeric literal %s as %s', (source, expected) => {
    expect(parse(source)).toStrictEqual(new ValueExpression(expected));
  });

  it('stops a numeric literal after the first decimal point', () => {
    expect(parse('1.2.3')).toStrictEqual(new ValueExpression(1.2));
  });

  const stringCases: Array<[string, string]> = [
    ["'hello'", 'hello'],
    ['"world"', 'world'],
  ];

  it.each(stringCases)('parses string literal %s as %s', (source, expected) => {
    expect(parse(source)).toStrictEqual(new ValueExpression(expected));
  });

  it('reads an unterminated string to the end of input', () => {
    expect(parse("'abc")).toStrictEqual(new ValueExpression('abc'));
  });

  const booleanCases: Array<[string, boolean]> = [
    ['true', true],
    ['FALSE', false],
    ['TRUE', true],
  ];

  it.each(booleanCases)('parses boolean literal %s as %s', (source, expected) => {
    expect(parse(source)).toStrictEqual(new ValueExpression(expected));
  });

  it('skips supported whitespace characters', () => {
    expect(parse('\t\n\r 7')).toStrictEqual(new ValueExpression(7));
  });

  it('parses a grouped expression', () => {
    expect(parse('(1 + 2)')).toStrictEqual(
      bin(TokenType.Plus, num(1), num(2)),
    );
  });

  it('applies multiplication precedence over addition', () => {
    expect(parse('1 + 2 * 3')).toStrictEqual(
      bin(TokenType.Plus, num(1), bin(TokenType.Mul, num(2), num(3))),
    );
  });

  it('parses is null', () => {
    expect(parse('x is null')).toStrictEqual(
      bin(TokenType.Eq, id('x'), new ValueExpression(null)),
    );
  });

  it('parses is not null', () => {
    expect(parse('x is not null')).toStrictEqual(
      bin(TokenType.Neq, id('x'), new ValueExpression(null)),
    );
  });

  it('parses between as inclusive lower and upper bounds', () => {
    expect(parse('x between 1 and 10')).toStrictEqual(
      bin(
        TokenType.And,
        bin(TokenType.Gte, id('x'), num(1)),
        bin(TokenType.Lte, id('x'), num(10)),
      ),
    );
  });

  it('parses a function call with no arguments', () => {
    expect(parse('fn()')).toStrictEqual(
      new FunctionCallExpression('fn', []),
    );
  });

  it('parses a function call with one argument', () => {
    expect(parse("length('abc')")).toStrictEqual(
      new FunctionCallExpression('length', [str('abc')]),
    );
  });

  it('parses a case expression with an else branch', () => {
    expect(parse("case when score > 90 then 'A' else 'B' end")).toStrictEqual(
      new CaseExpression(
        [
          {
            when: bin(TokenType.Gt, id('score'), num(90)),
            then: str('A'),
          },
        ],
        str('B'),
      ),
    );
  });

  it('stops parsing when the next token has no infix parser', () => {
    expect(parse('1 not')).toStrictEqual(new ValueExpression(1));
  });
});

describe('parse errors', () => {
  it('throws for an expression that starts with an illegal token', () => {
    expect(() => parse('@')).toThrow(/Unexpected start of expression/);
  });

  it('throws when an illegal token is consumed during parsing', () => {
    expect(() => parse('1 + @')).toThrow(/Invalid input/);
  });

  it('throws when a grouped expression is missing its closing parenthesis', () => {
    expect(() => parse('(1')).toThrow(/Expected \)/);
  });

  it('throws when is is not followed by null', () => {
    expect(() => parse('1 is 2')).toThrow(/Expected null/);
  });

  it('throws when between is missing its and separator', () => {
    expect(() => parse('1 between 1 2')).toThrow(/Expected and/);
  });

  it('throws when a function argument is not comma-separated', () => {
    expect(() => parse('fn(1 2)')).toThrow(/Expected , or \)/);
  });

  it('throws when a comma-separated function call reaches the comma as an expression', () => {
    expect(() => parse('fn(1, 2)')).toThrow(/Unexpected start of expression/);
  });

  it('throws when case is not followed by when', () => {
    expect(() => parse('case 1 end')).toThrow(/Expected when/);
  });

  it('throws when a case expression has no end', () => {
    expect(() => parse('case when true then 1 else 2')).toThrow(/Expected end/);
  });
});

describe('evaluate arithmetic operators', () => {
  const arithmeticCases: Array<[string, number]> = [
    ['1 + 2', 3],
    ['5 - 2', 3],
    ['3 * 4', 12],
    ['8 / 2', 4],
  ];

  it.each(arithmeticCases)('evaluates %s as %s', (expression, expected) => {
    expect(evaluate(expression)).toBe(expected);
  });
});

describe('evaluate comparison operators', () => {
  const comparisonCases: Array<[string, boolean]> = [
    ['1 = 1', true],
    ['1 = 2', false],
    ['1 <> 2', true],
    ['1 <> 1', false],
    ['5 > 4', true],
    ['5 > 5', false],
    ['5 >= 5', true],
    ['5 >= 6', false],
    ['4 < 5', true],
    ['5 < 5', false],
    ['5 <= 5', true],
    ['6 <= 5', false],
  ];

  it.each(comparisonCases)('evaluates %s as %s', (expression, expected) => {
    expect(evaluate(expression)).toBe(expected);
  });
});

describe('evaluate logical operators', () => {
  const logicalCases: Array<[string, boolean]> = [
    ['true and true', true],
    ['true and false', false],
    ['false or true', true],
    ['false or false', false],
  ];

  it.each(logicalCases)('evaluates %s as %s', (expression, expected) => {
    expect(evaluate(expression)).toBe(expected);
  });

  it('short-circuits a false and expression', () => {
    expect(evaluate('false and missing()')).toBe(false);
  });

  it('short-circuits a true or expression', () => {
    expect(evaluate('true or missing()')).toBe(true);
  });
});

describe('evaluate between expressions', () => {
  const betweenCases: Array<[string, boolean]> = [
    ['5 between 1 and 10', true],
    ['0 between 1 and 10', false],
    ['1 between 1 and 10', true],
    ['10 between 1 and 10', true],
    ['11 between 1 and 10', false],
  ];

  it.each(betweenCases)('evaluates %s as %s', (expression, expected) => {
    expect(evaluate(expression)).toBe(expected);
  });
});

describe('evaluate function calls', () => {
  it('evaluates length for one string argument', () => {
    expect(evaluate("length('hello')")).toBe(5);
  });

  it('evaluates length for an argument resolved from context', () => {
    const values: Record<string, unknown> = { items: [1, 2, 3] };

    expect(evaluate('length(items)', (name) => values[name])).toBe(3);
  });

  it('throws when length receives no arguments', () => {
    expect(() => evaluate('length()')).toThrow(
      'Length function takes exactly one argument.',
    );
  });

  it('throws for an unknown function', () => {
    expect(() => evaluate('unknown(1)')).toThrow(
      'Function unknown not implemented',
    );
  });
});

describe('evaluate case expressions', () => {
  it('returns the first matching branch', () => {
    expect(
      evaluate(
        "case when 1 = 1 then 'first' when 1 = 1 then 'second' else 'fallback' end",
      ),
    ).toBe('first');
  });

  it('continues to later branches when earlier conditions are false', () => {
    expect(
      evaluate(
        "case when 1 = 2 then 'first' when 2 = 2 then 'second' else 'fallback' end",
      ),
    ).toBe('second');
  });

  it('returns else when no condition matches', () => {
    expect(
      evaluate("case when 1 = 2 then 'yes' else 'fallback' end"),
    ).toBe('fallback');
  });

  it('returns false when no condition matches and there is no else', () => {
    expect(evaluate("case when 1 = 2 then 'yes' end")).toBe(false);
  });
});

describe('context lookup', () => {
  it('evaluates identifiers through the context callback', () => {
    const values: Record<string, number> = { price: 3, quantity: 4 };

    expect(evaluate('price * quantity', (name) => values[name])).toBe(12);
  });

  it('evaluates object properties with evaluateObject', () => {
    expect(evaluateObject('age >= minimum', { age: 21, minimum: 18 })).toBe(true);
  });

  it('returns undefined for a missing object property', () => {
    expect(evaluateObject('missing', {})).toBeUndefined();
  });
});
