import { describe, expect, it } from 'vitest';
import {
  BinaryExpression,
  CaseExpression,
  FunctionCallExpression,
  IdentifierExpression,
  ValueExpression,
} from '../src/ast';
import { evaluate, evaluateObject } from '../src/evaluator';
import { parse } from '../src/parser';
import { TokenType } from '../src/token';

describe('parse - literals and identifiers', () => {
  it.each([
    ['integer zero boundary', '0', 0],
    ['integer nine boundary', '9', 9],
    ['multi-digit integer', '42', 42],
    ['decimal number', '3.14', 3.14],
    ['leading-dot decimal', '.5', 0.5],
    ['stops after second decimal point', '1.2.3', 1.2],
  ])('parses numeric literal: %s', (_label, input, expected) => {
    expect(parse(input)).toEqual(new ValueExpression(expected));
  });

  it.each([
    ['single-quoted string', "'hello'", 'hello'],
    ['double-quoted string', '"world"', 'world'],
    ['empty single-quoted string', "''", ''],
    ['empty double-quoted string', '""', ''],
    ['unterminated string reads to EOF', "'unterminated", 'unterminated'],
  ])('parses string literal: %s', (_label, input, expected) => {
    expect(parse(input)).toEqual(new ValueExpression(expected));
  });

  it.each([
    ['lowercase true', 'true', true],
    ['uppercase TRUE', 'TRUE', true],
    ['lowercase false', 'false', false],
    ['mixed-case False', 'False', false],
  ])('parses boolean literal: %s', (_label, input, expected) => {
    expect(parse(input)).toEqual(new ValueExpression(expected));
  });

  it('parses identifiers with uppercase, lowercase, and underscore boundary characters', () => {
    expect(parse('AZ_az')).toEqual(new IdentifierExpression('AZ_az'));
  });
});

describe('parse - operators, precedence, and grouping', () => {
  it('gives multiplication higher precedence than addition', () => {
    expect(parse('1 + 2 * 3')).toEqual(
      new BinaryExpression(
        TokenType.Plus,
        new ValueExpression(1),
        new BinaryExpression(TokenType.Mul, new ValueExpression(2), new ValueExpression(3)),
      ),
    );
  });

  it('overrides operator precedence with parentheses', () => {
    expect(parse('(1 + 2) * 3')).toEqual(
      new BinaryExpression(
        TokenType.Mul,
        new BinaryExpression(TokenType.Plus, new ValueExpression(1), new ValueExpression(2)),
        new ValueExpression(3),
      ),
    );
  });

  it('parses same-precedence subtraction as left-associative', () => {
    expect(parse('10 - 3 - 2')).toEqual(
      new BinaryExpression(
        TokenType.Minus,
        new BinaryExpression(TokenType.Minus, new ValueExpression(10), new ValueExpression(3)),
        new ValueExpression(2),
      ),
    );
  });

  it('parses OR with higher precedence than AND when OR comes first', () => {
    expect(parse('true or false and false')).toEqual(
      new BinaryExpression(
        TokenType.And,
        new BinaryExpression(TokenType.Or, new ValueExpression(true), new ValueExpression(false)),
        new ValueExpression(false),
      ),
    );
  });

  it('parses OR with higher precedence than AND when AND comes first', () => {
    expect(parse('false and true or true')).toEqual(
      new BinaryExpression(
        TokenType.And,
        new ValueExpression(false),
        new BinaryExpression(TokenType.Or, new ValueExpression(true), new ValueExpression(true)),
      ),
    );
  });

  it('gives relational operators higher precedence than equality', () => {
    expect(parse('1 < 2 = true')).toEqual(
      new BinaryExpression(
        TokenType.Eq,
        new BinaryExpression(TokenType.Lt, new ValueExpression(1), new ValueExpression(2)),
        new ValueExpression(true),
      ),
    );
  });

  it('gives addition higher precedence than IS NULL', () => {
    expect(parse('x + 1 is null')).toEqual(
      new BinaryExpression(
        TokenType.Eq,
        new BinaryExpression(TokenType.Plus, new IdentifierExpression('x'), new ValueExpression(1)),
        new ValueExpression(null),
      ),
    );
  });

  it('gives function calls higher precedence than multiplication', () => {
    expect(parse("2 * length('ab')")).toEqual(
      new BinaryExpression(
        TokenType.Mul,
        new ValueExpression(2),
        new FunctionCallExpression('length', [new ValueExpression('ab')]),
      ),
    );
  });

  it('stops parsing infix operators when a token has precedence but no infix parser', () => {
    expect(parse('1 not')).toEqual(new ValueExpression(1));
  });
});

describe('parse - SQL keywords and function calls', () => {
  it('desugars IS NULL into an equality check with null', () => {
    expect(parse('x is null')).toEqual(
      new BinaryExpression(TokenType.Eq, new IdentifierExpression('x'), new ValueExpression(null)),
    );
  });

  it('desugars IS NOT NULL into an inequality check with null', () => {
    expect(parse('x is not null')).toEqual(
      new BinaryExpression(TokenType.Neq, new IdentifierExpression('x'), new ValueExpression(null)),
    );
  });

  it('desugars BETWEEN into inclusive lower and upper bound checks joined by AND', () => {
    expect(parse('x between 1 and 10')).toEqual(
      new BinaryExpression(
        TokenType.And,
        new BinaryExpression(TokenType.Gte, new IdentifierExpression('x'), new ValueExpression(1)),
        new BinaryExpression(TokenType.Lte, new IdentifierExpression('x'), new ValueExpression(10)),
      ),
    );
  });

  it('parses a zero-argument function call', () => {
    expect(parse('length()')).toEqual(new FunctionCallExpression('length', []));
  });

  it('parses a single-argument function call', () => {
    expect(parse("length('abc')")).toEqual(
      new FunctionCallExpression('length', [new ValueExpression('abc')]),
    );
  });

  it('parses a CASE expression without ELSE', () => {
    expect(parse('case when a = 1 then 10 end')).toEqual(
      new CaseExpression(
        [
          {
            when: new BinaryExpression(
              TokenType.Eq,
              new IdentifierExpression('a'),
              new ValueExpression(1),
            ),
            then: new ValueExpression(10),
          },
        ],
        undefined,
      ),
    );
  });

  it('parses a CASE expression with ELSE', () => {
    expect(parse('case when a = 1 then 10 else 20 end')).toEqual(
      new CaseExpression(
        [
          {
            when: new BinaryExpression(
              TokenType.Eq,
              new IdentifierExpression('a'),
              new ValueExpression(1),
            ),
            then: new ValueExpression(10),
          },
        ],
        new ValueExpression(20),
      ),
    );
  });
});

describe('parse - whitespace, case-insensitivity, and error handling', () => {
  it('skips spaces, tabs, carriage returns, and newlines', () => {
    expect(parse('\t 1 \r\n + \n 2 \t')).toEqual(
      new BinaryExpression(TokenType.Plus, new ValueExpression(1), new ValueExpression(2)),
    );
  });

  it('recognizes uppercase and mixed-case SQL keywords', () => {
    expect(parse('CASE WHEN x BETWEEN 1 AND 5 THEN TRUE ELSE FALSE END')).toEqual(
      new CaseExpression(
        [
          {
            when: new BinaryExpression(
              TokenType.And,
              new BinaryExpression(TokenType.Gte, new IdentifierExpression('x'), new ValueExpression(1)),
              new BinaryExpression(TokenType.Lte, new IdentifierExpression('x'), new ValueExpression(5)),
            ),
            then: new ValueExpression(true),
          },
        ],
        new ValueExpression(false),
      ),
    );
  });

  it('throws on empty input', () => {
    expect(() => parse('')).toThrow(
      'Unexpected start of expression: { type: EOF, literal: \0 } as position: 0.',
    );
  });

  it.each([
    ['before A (0x40)', '@'],
    ['after Z (0x5b)', '['],
    ['before a (0x60)', '`'],
    ['after z (0x7b)', '{'],
    ['after 9 (0x3a)', ':'],
  ])('throws on illegal start character %s', (_label, char) => {
    expect(() => parse(char)).toThrow(
      `Unexpected start of expression: { type: ILLEGAL, literal: ${char} } as position: 0.`,
    );
  });

  it('throws Invalid input when advancing onto an illegal token mid-expression', () => {
    expect(() => parse('1 + @')).toThrow(
      'Invalid input: { type: ILLEGAL, literal: @ } as position: 4.',
    );
  });

  it('throws when a trailing < operator has no right operand', () => {
    expect(() => parse('1 <')).toThrow(
      'Unexpected start of expression: { type: EOF, literal: \0 } as position: 3.',
    );
  });

  it('throws when a trailing > operator has no right operand', () => {
    expect(() => parse('1 >')).toThrow(
      'Unexpected start of expression: { type: EOF, literal: \0 } as position: 3.',
    );
  });

  it('throws when a grouped expression is missing a closing parenthesis', () => {
    expect(() => parse('(1 + 2')).toThrow(
      'Expected ) but got { type: EOF, literal: \0 } as position: 6.',
    );
  });

  it('throws when IS is not followed by NULL', () => {
    expect(() => parse('x is 5')).toThrow(
      'Expected null but got { type: NUM, literal: 5 } as position: 5.',
    );
  });

  it('throws when IS NOT is not followed by NULL', () => {
    expect(() => parse('x is not 5')).toThrow(
      'Expected null but got { type: NUM, literal: 5 } as position: 9.',
    );
  });

  it('throws when BETWEEN lower bound is not numeric', () => {
    expect(() => parse("x between 'a' and 5")).toThrow(
      'Expected NUM but got { type: STR, literal: a } as position: 11.',
    );
  });

  it('throws when BETWEEN is missing AND between bounds', () => {
    expect(() => parse('x between 1 or 5')).toThrow(
      'Expected and but got { type: or, literal: or } as position: 12.',
    );
  });

  it('throws when BETWEEN upper bound is not numeric', () => {
    expect(() => parse("x between 1 and 'b'")).toThrow(
      'Expected NUM but got { type: STR, literal: b } as position: 17.',
    );
  });

  it('throws when function arguments are not separated by a comma or closing parenthesis', () => {
    expect(() => parse("length('a' 'b')")).toThrow(
      'Expected , or ) got { type: STR, literal: b } as position: 12.',
    );
  });

  it('throws on comma-separated function arguments due to parser token advancement', () => {
    expect(() => parse("length('a', 'b')")).toThrow(
      'Unexpected start of expression: { type: ,, literal: , } as position: 10.',
    );
  });

  it('throws when CASE is not immediately followed by WHEN', () => {
    expect(() => parse('case end')).toThrow(
      'Expected when got { type: case, literal: case } as position: 0.',
    );
  });

  it('throws when WHEN clause is missing THEN', () => {
    expect(() => parse('case when true 1 end')).toThrow(
      'Expected then but got { type: NUM, literal: 1 } as position: 15.',
    );
  });

  it('throws when a subsequent CASE branch does not start with WHEN', () => {
    expect(() => parse('case when true then 1 false then 2 end')).toThrow(
      'Expected when but got { type: false, literal: false } as position: 22.',
    );
  });

  it('throws when CASE is missing END', () => {
    expect(() => parse('case when true then 1 else 2')).toThrow(
      'Expected end but got { type: EOF, literal: \0 } as position: 28.',
    );
  });
});

describe('evaluate - arithmetic operators', () => {
  it.each([
    ['addition', '7 + 5', 12],
    ['string concatenation with +', "'foo' + 'bar'", 'foobar'],
    ['subtraction with positive result', '10 - 3', 7],
    ['subtraction with negative result', '3 - 10', -7],
    ['left-associative subtraction', '10 - 3 - 2', 5],
    ['multiplication', '4 * 5', 20],
    ['division with decimal result', '10 / 4', 2.5],
    ['left-associative division', '20 / 4 / 2', 2.5],
    ['precedence without parentheses', '2 + 3 * 4', 14],
    ['precedence overridden with parentheses', '(2 + 3) * 4', 20],
  ])('evaluates %s: %s', (_label, expression, expected) => {
    expect(evaluate(expression)).toBe(expected);
  });
});

describe('evaluate - comparison operators and boundaries', () => {
  it.each([
    ['= when equal', '5 = 5', true],
    ['= when not equal', '5 = 6', false],
    ['= uses strict equality across types', "'5' = 5", false],
    ['<> when not equal', '5 <> 6', true],
    ['<> when equal', '5 <> 5', false],
    ['<> uses strict inequality across types', "'5' <> 5", true],
    ['> above boundary', '6 > 5', true],
    ['> at boundary', '5 > 5', false],
    ['> below boundary', '4 > 5', false],
    ['>= above boundary', '6 >= 5', true],
    ['>= at boundary', '5 >= 5', true],
    ['>= below boundary', '4 >= 5', false],
    ['< below boundary', '4 < 5', true],
    ['< at boundary', '5 < 5', false],
    ['< above boundary', '6 < 5', false],
    ['<= below boundary', '4 <= 5', true],
    ['<= at boundary', '5 <= 5', true],
    ['<= above boundary', '6 <= 5', false],
  ])('evaluates %s (%s)', (_label, expression, expected) => {
    expect(evaluate(expression)).toBe(expected);
  });
});

describe('evaluate - logical operators and short-circuiting', () => {
  it.each([
    ['true and true', true],
    ['true and false', false],
    ['false and true', false],
    ['false and false', false],
    ['true or true', true],
    ['true or false', true],
    ['false or true', true],
    ['false or false', false],
    ['true or false and false', false],
    ['true and false or true', true],
  ])('evaluates %s', (expression, expected) => {
    expect(evaluate(expression)).toBe(expected);
  });

  it('short-circuits AND when the left operand is false', () => {
    expect(evaluate('false and missingFn(1)')).toBe(false);
  });

  it('short-circuits OR when the left operand is true', () => {
    expect(evaluate('true or missingFn(1)')).toBe(true);
  });
});

describe('evaluate - IS NULL, IS NOT NULL, and BETWEEN', () => {
  const lowerBound = 10;
  const upperBound = 20;
  const betweenExpr = `value between ${lowerBound} and ${upperBound}`;

  it.each([
    ['below lower bound', lowerBound - 1, false],
    ['at lower bound', lowerBound, true],
    ['inside range', 15, true],
    ['at upper bound', upperBound, true],
    ['above upper bound', upperBound + 1, false],
  ])('evaluates BETWEEN %s', (_label, value, expected) => {
    expect(evaluateObject(betweenExpr, { value })).toBe(expected);
  });

  it.each([
    ['IS NULL for null value', 'value is null', { value: null }, true],
    ['IS NULL for non-null value', 'value is null', { value: 0 }, false],
    ['IS NULL for undefined property uses strict equality', 'value is null', {}, false],
    ['IS NOT NULL for null value', 'value is not null', { value: null }, false],
    ['IS NOT NULL for non-null value', 'value is not null', { value: '' }, true],
  ])('evaluates %s', (_label, expression, obj, expected) => {
    expect(evaluateObject(expression, obj)).toBe(expected);
  });
});

describe('evaluate - CASE expressions', () => {
  const multiBranchCase =
    "case when score >= 90 then 'A' when score >= 80 then 'B' else 'C' end";

  it('returns the THEN branch for the first matching condition', () => {
    expect(evaluateObject(multiBranchCase, { score: 95 })).toBe('A');
  });

  it('returns a later THEN branch when earlier conditions are false', () => {
    expect(evaluateObject(multiBranchCase, { score: 80 })).toBe('B');
  });

  it('returns the ELSE branch when no WHEN condition matches', () => {
    expect(evaluateObject(multiBranchCase, { score: 79 })).toBe('C');
  });

  it('returns false when no WHEN condition matches and ELSE is omitted', () => {
    expect(evaluateObject("case when score >= 90 then 'A' end", { score: 50 })).toBe(false);
  });

  it('returns falsy ELSE values instead of falling through to false', () => {
    expect(evaluate('case when false then 1 else 0 end')).toBe(0);
  });
});

describe('evaluate - function calls', () => {
  it('evaluates length() on a non-empty string', () => {
    expect(evaluate("length('hello')")).toBe(5);
  });

  it('evaluates length() on an empty string', () => {
    expect(evaluate("length('')")).toBe(0);
  });

  it('evaluates length() on an array from context', () => {
    expect(evaluateObject('length(items)', { items: [10, 20, 30] })).toBe(3);
  });

  it('throws when length() is called without an argument', () => {
    expect(() => evaluate('length()')).toThrow('Length function takes exactly one argument.');
  });

  it('throws when calling an unimplemented function', () => {
    expect(() => evaluate('unknownFn(1)')).toThrow('Function unknownFn not implemented');
  });
});

describe('evaluate - context callback and evaluateObject', () => {
  it('resolves identifiers using a custom context resolver function', () => {
    const context = (name: string) => ({ price: 25, quantity: 4 }[name]);

    expect(evaluate('price * quantity', context)).toBe(100);
  });

  it('evaluates compound SQL-like WHERE clauses with evaluateObject', () => {
    const record = { status: 'active', age: 25, deletedAt: null };
    const whereClause = "status = 'active' and age between 18 and 30 and deletedAt is null";

    expect(evaluateObject(whereClause, record)).toBe(true);
  });
});

