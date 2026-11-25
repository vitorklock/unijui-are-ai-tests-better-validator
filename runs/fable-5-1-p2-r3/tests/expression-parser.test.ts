import { describe, expect, it, vi } from 'vitest';
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

/** The literal the lexer assigns to the end-of-input token. */
const EOF_LITERAL = '\0';

/** Reproduces how the parser prints a token inside its error messages. */
function tokenAt(type: TokenType, literal: string, position: number): string {
  return `{ type: ${type}, literal: ${literal} } as position: ${position}.`;
}

function unexpectedStart(type: TokenType, literal: string, position: number): Error {
  return new Error(`Unexpected start of expression: ${tokenAt(type, literal, position)}`);
}

function expectedToken(expected: TokenType, type: TokenType, literal: string, position: number): Error {
  return new Error(`Expected ${expected} but got ${tokenAt(type, literal, position)}`);
}

const num = (value: number) => new ValueExpression(value);
const str = (value: string) => new ValueExpression(value);
const ident = (name: string) => new IdentifierExpression(name);

describe('parse', () => {
  describe('literals', () => {
    it('parses an integer literal into a numeric value', () => {
      expect(parse('42')).toStrictEqual(num(42));
    });

    it('parses a decimal literal into a numeric value', () => {
      expect(parse('3.25')).toStrictEqual(num(3.25));
    });

    it('parses a literal starting with a dot as a fraction', () => {
      expect(parse('.5')).toStrictEqual(num(0.5));
    });

    it('parses a literal ending with a dot as an integer', () => {
      expect(parse('7.')).toStrictEqual(num(7));
    });

    it('stops the number at the second dot', () => {
      expect(parse('1.2.3')).toStrictEqual(num(1.2));
    });

    it('parses a single-quoted string', () => {
      expect(parse("'hello world'")).toStrictEqual(str('hello world'));
    });

    it('parses a double-quoted string', () => {
      expect(parse('"hello"')).toStrictEqual(str('hello'));
    });

    it('parses an empty string', () => {
      expect(parse("''")).toStrictEqual(str(''));
    });

    it('keeps the other quote character inside a string', () => {
      expect(parse('"it\'s"')).toStrictEqual(str("it's"));
    });

    it('reads an unterminated string up to the end of input', () => {
      expect(parse("'abc")).toStrictEqual(str('abc'));
    });

    it('does not treat keywords inside a string as keywords', () => {
      expect(parse("'and'")).toStrictEqual(str('and'));
    });

    it('parses true into a boolean value', () => {
      expect(parse('true')).toStrictEqual(new ValueExpression(true));
    });

    it('parses false into a boolean value', () => {
      expect(parse('false')).toStrictEqual(new ValueExpression(false));
    });

    it('matches keywords case-insensitively', () => {
      expect(parse('TRUE')).toStrictEqual(new ValueExpression(true));
    });
  });

  describe('identifiers', () => {
    it('parses an identifier with underscores', () => {
      expect(parse('first_name')).toStrictEqual(ident('first_name'));
    });

    it('preserves identifier case', () => {
      expect(parse('FirstName')).toStrictEqual(ident('FirstName'));
    });

    it('ends an identifier at the first digit', () => {
      expect(parse('x1')).toStrictEqual(ident('x'));
    });
  });

  describe('binary expressions', () => {
    it('builds a binary node for an infix operator', () => {
      expect(parse('a + b')).toStrictEqual(new BinaryExpression(TokenType.Plus, ident('a'), ident('b')));
    });

    it('binds multiplication tighter than addition', () => {
      expect(parse('1 + 2 * 3')).toStrictEqual(
        new BinaryExpression(TokenType.Plus, num(1), new BinaryExpression(TokenType.Mul, num(2), num(3))),
      );
    });

    it('lets parentheses override precedence', () => {
      expect(parse('(1 + 2) * 3')).toStrictEqual(
        new BinaryExpression(TokenType.Mul, new BinaryExpression(TokenType.Plus, num(1), num(2)), num(3)),
      );
    });

    it('associates operators of equal precedence to the left', () => {
      expect(parse('10 - 4 - 3')).toStrictEqual(
        new BinaryExpression(TokenType.Minus, new BinaryExpression(TokenType.Minus, num(10), num(4)), num(3)),
      );
    });

    it('binds arithmetic tighter than comparison', () => {
      expect(parse('1 + 2 = 3')).toStrictEqual(
        new BinaryExpression(TokenType.Eq, new BinaryExpression(TokenType.Plus, num(1), num(2)), num(3)),
      );
    });

    it('binds "or" tighter than "and"', () => {
      expect(parse('a or b and c')).toStrictEqual(
        new BinaryExpression(TokenType.And, new BinaryExpression(TokenType.Or, ident('a'), ident('b')), ident('c')),
      );
    });

    it('parses the <> operator as not-equal', () => {
      expect(parse('a <> b')).toStrictEqual(new BinaryExpression(TokenType.Neq, ident('a'), ident('b')));
    });

    it('parses the <= operator as less-or-equal', () => {
      expect(parse('a <= b')).toStrictEqual(new BinaryExpression(TokenType.Lte, ident('a'), ident('b')));
    });

    it('parses the >= operator as greater-or-equal', () => {
      expect(parse('a >= b')).toStrictEqual(new BinaryExpression(TokenType.Gte, ident('a'), ident('b')));
    });
  });

  describe('is null', () => {
    it('desugars "is null" into an equality against null', () => {
      expect(parse('x is null')).toStrictEqual(
        new BinaryExpression(TokenType.Eq, ident('x'), new ValueExpression(null)),
      );
    });

    it('desugars "is not null" into an inequality against null', () => {
      expect(parse('x is not null')).toStrictEqual(
        new BinaryExpression(TokenType.Neq, ident('x'), new ValueExpression(null)),
      );
    });

    it('accepts upper-case "IS NOT NULL"', () => {
      expect(parse('x IS NOT NULL')).toStrictEqual(
        new BinaryExpression(TokenType.Neq, ident('x'), new ValueExpression(null)),
      );
    });
  });

  describe('between', () => {
    it('desugars "between" into a conjunction of two bound checks', () => {
      expect(parse('x between 1 and 10')).toStrictEqual(
        new BinaryExpression(
          TokenType.And,
          new BinaryExpression(TokenType.Gte, ident('x'), num(1)),
          new BinaryExpression(TokenType.Lte, ident('x'), num(10)),
        ),
      );
    });

    it('accepts decimal bounds', () => {
      expect(parse('x between 1.5 and 2.5')).toStrictEqual(
        new BinaryExpression(
          TokenType.And,
          new BinaryExpression(TokenType.Gte, ident('x'), num(1.5)),
          new BinaryExpression(TokenType.Lte, ident('x'), num(2.5)),
        ),
      );
    });
  });

  describe('function calls', () => {
    it('parses a call with a single argument', () => {
      expect(parse("length('abc')")).toStrictEqual(new FunctionCallExpression('length', [str('abc')]));
    });

    it('parses a call without arguments', () => {
      expect(parse('fn()')).toStrictEqual(new FunctionCallExpression('fn', []));
    });

    it('parses a nested expression as an argument', () => {
      expect(parse('fn(1 + 2)')).toStrictEqual(
        new FunctionCallExpression('fn', [new BinaryExpression(TokenType.Plus, num(1), num(2))]),
      );
    });
  });

  describe('case expressions', () => {
    it('collects every when/then pair and the else branch', () => {
      expect(parse('case when a then 1 when b then 2 else 3 end')).toStrictEqual(
        new CaseExpression(
          [
            { when: ident('a'), then: num(1) },
            { when: ident('b'), then: num(2) },
          ],
          num(3),
        ),
      );
    });

    it('leaves the else branch undefined when omitted', () => {
      expect(parse('case when a then 1 end')).toStrictEqual(
        new CaseExpression([{ when: ident('a'), then: num(1) }]),
      );
    });

    it('parses compound conditions inside a when clause', () => {
      expect(parse('case when a > 1 and b then 1 end')).toStrictEqual(
        new CaseExpression([
          {
            when: new BinaryExpression(
              TokenType.And,
              new BinaryExpression(TokenType.Gt, ident('a'), num(1)),
              ident('b'),
            ),
            then: num(1),
          },
        ]),
      );
    });

    it('lets a case expression be the operand of an infix operator', () => {
      expect(parse('case when a then 1 end + 1')).toStrictEqual(
        new BinaryExpression(
          TokenType.Plus,
          new CaseExpression([{ when: ident('a'), then: num(1) }]),
          num(1),
        ),
      );
    });
  });

  describe('trailing input', () => {
    it('ignores a second literal that does not continue the expression', () => {
      expect(parse('1 2')).toStrictEqual(num(1));
    });

    it('ignores a trailing "not" since it has no infix form', () => {
      expect(parse('1 not 2')).toStrictEqual(num(1));
    });

    it('ignores an illegal character that is never consumed', () => {
      expect(parse('1 #')).toStrictEqual(num(1));
    });
  });

  describe('whitespace', () => {
    it('skips tabs, newlines and carriage returns between tokens', () => {
      expect(parse('\t1\n+\r2 ')).toStrictEqual(new BinaryExpression(TokenType.Plus, num(1), num(2)));
    });
  });

  describe('errors', () => {
    it('rejects an empty expression', () => {
      expect(() => parse('')).toThrow(unexpectedStart(TokenType.EOF, EOF_LITERAL, 0));
    });

    it('rejects a leading minus since unary operators are unsupported', () => {
      expect(() => parse('-1')).toThrow(unexpectedStart(TokenType.Minus, '-', 0));
    });

    it('rejects a leading "not" since it has no prefix form', () => {
      expect(() => parse('not true')).toThrow(unexpectedStart(TokenType.Not, 'not', 0));
    });

    it('rejects a bare null literal', () => {
      expect(() => parse('null')).toThrow(unexpectedStart(TokenType.Null, 'null', 0));
    });

    it('rejects a leading illegal character', () => {
      expect(() => parse('#')).toThrow(unexpectedStart(TokenType.Illegal, '#', 0));
    });

    it('rejects an illegal character in operand position', () => {
      expect(() => parse('1 + #')).toThrow(new Error(`Invalid input: ${tokenAt(TokenType.Illegal, '#', 4)}`));
    });

    it.each(['+', '-', '*', '/', '=', '<>', '<', '<=', '>', '>=', 'and', 'or'])(
      'rejects a dangling "%s" operator at the end of input',
      (operator) => {
        const expression = `1 ${operator}`;
        expect(() => parse(expression)).toThrow(unexpectedStart(TokenType.EOF, EOF_LITERAL, expression.length));
      },
    );

    it('rejects empty parentheses', () => {
      expect(() => parse('()')).toThrow(unexpectedStart(TokenType.Rparn, ')', 1));
    });

    it('rejects a group missing its closing parenthesis', () => {
      expect(() => parse('(1 + 2')).toThrow(expectedToken(TokenType.Rparn, TokenType.EOF, EOF_LITERAL, 6));
    });

    it('rejects "is" followed by anything other than null', () => {
      expect(() => parse('x is 5')).toThrow(expectedToken(TokenType.Null, TokenType.Numeric, '5', 5));
    });

    it('rejects a non-numeric lower bound in between', () => {
      expect(() => parse('x between a and b')).toThrow(
        expectedToken(TokenType.Numeric, TokenType.Identifier, 'a', 10),
      );
    });

    it('rejects a negative lower bound in between', () => {
      expect(() => parse('x between -1 and 1')).toThrow(
        expectedToken(TokenType.Numeric, TokenType.Minus, '-', 10),
      );
    });

    it('rejects a between whose bounds are not joined by "and"', () => {
      expect(() => parse('x between 1 or 10')).toThrow(expectedToken(TokenType.And, TokenType.Or, 'or', 12));
    });

    it('rejects a non-numeric upper bound in between', () => {
      expect(() => parse('x between 1 and y')).toThrow(
        expectedToken(TokenType.Numeric, TokenType.Identifier, 'y', 16),
      );
    });

    it('rejects call arguments that are not separated by commas', () => {
      expect(() => parse('length(1 2)')).toThrow(
        new Error(`Expected , or ) got ${tokenAt(TokenType.Numeric, '2', 9)}`),
      );
    });

    it('rejects a call missing its closing parenthesis', () => {
      expect(() => parse("length('abc'")).toThrow(
        new Error(`Expected , or ) got ${tokenAt(TokenType.EOF, EOF_LITERAL, 12)}`),
      );
    });

    it('rejects a call with more than one argument since the comma is never consumed', () => {
      expect(() => parse("fn(a, 'b')")).toThrow(unexpectedStart(TokenType.Comma, ',', 4));
    });

    it('rejects a trailing comma in a call', () => {
      expect(() => parse("length('abc',)")).toThrow(unexpectedStart(TokenType.Comma, ',', 12));
    });

    it('rejects a case without a when clause', () => {
      expect(() => parse('case end')).toThrow(
        new Error(`Expected when got ${tokenAt(TokenType.Case, 'case', 0)}`),
      );
    });

    it('rejects a when clause missing "then"', () => {
      expect(() => parse('case when true 1 end')).toThrow(
        expectedToken(TokenType.Then, TokenType.Numeric, '1', 15),
      );
    });

    it('rejects a case missing "end"', () => {
      expect(() => parse('case when true then 1')).toThrow(
        expectedToken(TokenType.End, TokenType.EOF, EOF_LITERAL, 21),
      );
    });
  });
});

describe('evaluate', () => {
  describe('literals', () => {
    it('returns the numeric value of an integer literal', () => {
      expect(evaluate('42')).toBe(42);
    });

    it('drops leading zeros from an integer literal', () => {
      expect(evaluate('007')).toBe(7);
    });

    it('returns the numeric value of a decimal literal', () => {
      expect(evaluate('3.25')).toBe(3.25);
    });

    it('returns the string content without quotes', () => {
      expect(evaluate("'hello'")).toBe('hello');
    });

    it('returns false for the false keyword regardless of case', () => {
      expect(evaluate('False')).toBe(false);
    });
  });

  describe('arithmetic', () => {
    it('adds two numbers', () => {
      expect(evaluate('1 + 2')).toBe(3);
    });

    it('subtracts two numbers', () => {
      expect(evaluate('5 - 7')).toBe(-2);
    });

    it('multiplies two numbers', () => {
      expect(evaluate('6 * 7')).toBe(42);
    });

    it('divides two numbers producing a fraction', () => {
      expect(evaluate('10 / 4')).toBe(2.5);
    });

    it('divides by zero producing Infinity', () => {
      expect(evaluate('1 / 0')).toBe(Infinity);
    });

    it('divides zero by zero producing NaN', () => {
      expect(evaluate('0 / 0')).toBeNaN();
    });

    it('concatenates strings with +', () => {
      expect(evaluate("'foo' + 'bar'")).toBe('foobar');
    });

    it('applies multiplication before addition', () => {
      expect(evaluate('2 + 3 * 4')).toBe(14);
    });

    it('applies multiplication before addition when it comes first', () => {
      expect(evaluate('2 * 3 + 4')).toBe(10);
    });

    it('applies division before subtraction', () => {
      expect(evaluate('10 - 8 / 2')).toBe(6);
    });

    it('applies parentheses before multiplication', () => {
      expect(evaluate('(2 + 3) * 4')).toBe(20);
    });

    it('subtracts left to right', () => {
      expect(evaluate('10 - 4 - 3')).toBe(3);
    });

    it('divides left to right', () => {
      expect(evaluate('8 / 2 / 2')).toBe(2);
    });

    it('evaluates nested parentheses', () => {
      expect(evaluate('((1 + 2) * (3 + 4))')).toBe(21);
    });
  });

  describe('comparison', () => {
    it.each([
      { expression: '1 < 2', expected: true },
      { expression: '2 < 2', expected: false },
      { expression: '3 < 2', expected: false },
      { expression: '1 <= 2', expected: true },
      { expression: '2 <= 2', expected: true },
      { expression: '3 <= 2', expected: false },
      { expression: '2 > 1', expected: true },
      { expression: '1 > 1', expected: false },
      { expression: '0 > 1', expected: false },
      { expression: '2 >= 1', expected: true },
      { expression: '1 >= 1', expected: true },
      { expression: '0 >= 1', expected: false },
      { expression: '1 = 1', expected: true },
      { expression: '1 = 2', expected: false },
      { expression: '1 <> 2', expected: true },
      { expression: '1 <> 1', expected: false },
    ])('evaluates "$expression" to $expected', ({ expression, expected }) => {
      expect(evaluate(expression)).toBe(expected);
    });

    it('compares strings lexicographically', () => {
      expect(evaluate("'b' > 'a'")).toBe(true);
    });

    it('treats equal strings as equal', () => {
      expect(evaluate("'abc' = 'abc'")).toBe(true);
    });

    it('does not coerce a numeric string to a number for equality', () => {
      expect(evaluate("'1' = 1")).toBe(false);
    });

    it('does not coerce a numeric string to a number for inequality', () => {
      expect(evaluate("'1' <> 1")).toBe(true);
    });

    it('compares the result of arithmetic', () => {
      expect(evaluate('1 + 2 = 3')).toBe(true);
    });

    it('applies ordering before equality', () => {
      expect(evaluate('1 < 2 = true')).toBe(true);
    });
  });

  describe('logical operators', () => {
    it.each([
      { expression: 'true and true', expected: true },
      { expression: 'true and false', expected: false },
      { expression: 'false and true', expected: false },
      { expression: 'false and false', expected: false },
      { expression: 'true or true', expected: true },
      { expression: 'true or false', expected: true },
      { expression: 'false or true', expected: true },
      { expression: 'false or false', expected: false },
    ])('evaluates "$expression" to $expected', ({ expression, expected }) => {
      expect(evaluate(expression)).toBe(expected);
    });

    it('returns the right operand of "and" when the left is truthy', () => {
      expect(evaluate('1 and 2')).toBe(2);
    });

    it('returns the left operand of "and" when it is falsy', () => {
      expect(evaluate('0 and 2')).toBe(0);
    });

    it('returns the left operand of "or" when it is truthy', () => {
      expect(evaluate('3 or 5')).toBe(3);
    });

    it('returns the right operand of "or" when the left is falsy', () => {
      expect(evaluate('0 or 5')).toBe(5);
    });

    it('short-circuits "and" without evaluating the right operand', () => {
      const context = vi.fn(() => {
        throw new Error('right operand must not be evaluated');
      });
      expect(evaluate('false and x', context)).toBe(false);
    });

    it('short-circuits "or" without evaluating the right operand', () => {
      const context = vi.fn(() => {
        throw new Error('right operand must not be evaluated');
      });
      expect(evaluate('true or x', context)).toBe(true);
    });

    it('accepts upper-case logical keywords', () => {
      expect(evaluate('true AND false')).toBe(false);
    });

    it('groups "or" before "and" when "or" comes first', () => {
      expect(evaluate('true or false and false')).toBe(false);
    });

    it('groups "or" before "and" when "and" comes first', () => {
      expect(evaluate('false and true or true')).toBe(false);
    });

    it('lets parentheses force "and" before "or"', () => {
      expect(evaluate('(false and true) or true')).toBe(true);
    });

    it('applies comparison before "and"', () => {
      expect(evaluate('1 < 2 and 2 < 3')).toBe(true);
    });
  });

  describe('is null', () => {
    it('is true when the identifier resolves to null', () => {
      expect(evaluate('x is null', () => null)).toBe(true);
    });

    it('is false when the identifier resolves to undefined', () => {
      expect(evaluate('x is null', () => undefined)).toBe(false);
    });

    it('is false when the identifier resolves to zero', () => {
      expect(evaluate('x is null', () => 0)).toBe(false);
    });

    it('negates to false when the identifier resolves to null', () => {
      expect(evaluate('x is not null', () => null)).toBe(false);
    });

    it('negates to true when the identifier resolves to a value', () => {
      expect(evaluate("x is not null", () => 'value')).toBe(true);
    });

    it('negates to true when the identifier resolves to undefined', () => {
      expect(evaluate('x is not null', () => undefined)).toBe(true);
    });
  });

  describe('between', () => {
    const LOWER = 1;
    const UPPER = 10;
    const expression = `x between ${LOWER} and ${UPPER}`;

    it('is false just below the lower bound', () => {
      expect(evaluate(expression, () => LOWER - 1)).toBe(false);
    });

    it('is true at the lower bound', () => {
      expect(evaluate(expression, () => LOWER)).toBe(true);
    });

    it('is true strictly inside the bounds', () => {
      expect(evaluate(expression, () => LOWER + 1)).toBe(true);
    });

    it('is true at the upper bound', () => {
      expect(evaluate(expression, () => UPPER)).toBe(true);
    });

    it('is false just above the upper bound', () => {
      expect(evaluate(expression, () => UPPER + 1)).toBe(false);
    });

    it('accepts decimal bounds', () => {
      expect(evaluate('x between 0.5 and 1.5', () => 1)).toBe(true);
    });

    it('is false when the identifier is undefined', () => {
      expect(evaluate(expression, () => undefined)).toBe(false);
    });

    it('combines with a following "and" clause', () => {
      expect(evaluate(`x between ${LOWER} and ${UPPER} and false`, () => LOWER)).toBe(false);
    });

    it('combines with a preceding "and" clause', () => {
      expect(evaluate(`true and x between ${LOWER} and ${UPPER}`, () => UPPER)).toBe(true);
    });
  });

  describe('functions', () => {
    it('returns the length of a string literal', () => {
      expect(evaluate("length('abc')")).toBe(3);
    });

    it('returns zero for an empty string', () => {
      expect(evaluate("length('')")).toBe(0);
    });

    it('returns the length of an array supplied by the context', () => {
      expect(evaluate('length(items)', () => ['a', 'b'])).toBe(2);
    });

    it('evaluates the argument expression before measuring it', () => {
      expect(evaluate("length('ab' + 'cd')")).toBe(4);
    });

    it('returns undefined for a value without a length', () => {
      expect(evaluate('length(5)')).toBeUndefined();
    });

    it('uses the call result inside a larger expression', () => {
      expect(evaluate("length('abc') > 2")).toBe(true);
    });

    it('rejects length with no arguments', () => {
      expect(() => evaluate('length()')).toThrow(new Error('Length function takes exactly one argument.'));
    });

    it('rejects an unknown function', () => {
      expect(() => evaluate("upper('a')")).toThrow(new Error('Function upper not implemented'));
    });
  });

  describe('case expressions', () => {
    it('returns the then-branch of the first matching condition', () => {
      expect(evaluate("case when true then 'first' when true then 'second' end")).toBe('first');
    });

    it('skips non-matching conditions', () => {
      expect(evaluate("case when false then 'first' when true then 'second' end")).toBe('second');
    });

    it('returns the else-branch when nothing matches', () => {
      expect(evaluate("case when false then 'first' else 'fallback' end")).toBe('fallback');
    });

    it('returns false when nothing matches and there is no else', () => {
      expect(evaluate("case when false then 'first' end")).toBe(false);
    });

    it('treats a falsy non-boolean condition as not matching', () => {
      expect(evaluate("case when 0 then 'zero' when 'x' then 'text' end")).toBe('text');
    });

    it('evaluates comparisons in the condition against the context', () => {
      expect(evaluate("case when x > 10 then 'big' else 'small' end", () => 11)).toBe('big');
    });

    it('evaluates the then-branch as an expression', () => {
      expect(evaluate('case when true then 1 + 1 end')).toBe(2);
    });

    it('evaluates the else-branch as an expression', () => {
      expect(evaluate('case when false then 1 else 2 * 3 end')).toBe(6);
    });

    it('accepts upper-case keywords', () => {
      expect(evaluate("CASE WHEN TRUE THEN 'yes' ELSE 'no' END")).toBe('yes');
    });

    it('can be used as an operand', () => {
      expect(evaluate('case when true then 1 end + 1')).toBe(2);
    });

    it('can be nested in a then-branch', () => {
      expect(evaluate("case when true then case when false then 'a' else 'b' end end")).toBe('b');
    });
  });

  describe('identifiers and context', () => {
    it('resolves an identifier through the context function', () => {
      expect(evaluate('price', () => 9.99)).toBe(9.99);
    });

    it('passes the identifier name to the context', () => {
      const context = vi.fn(() => 1);
      evaluate('first_name', context);
      expect(context).toHaveBeenCalledWith('first_name');
    });

    it('preserves identifier case when calling the context', () => {
      const context = vi.fn(() => 1);
      evaluate('TotalAmount', context);
      expect(context).toHaveBeenCalledWith('TotalAmount');
    });

    it('calls the context once per identifier occurrence', () => {
      const context = vi.fn(() => 1);
      evaluate('x + x', context);
      expect(context.mock.calls).toStrictEqual([['x'], ['x']]);
    });

    it('throws when an identifier is used without a context', () => {
      expect(() => evaluate('x')).toThrow(TypeError);
    });

    it('does not need a context when the expression has no identifiers', () => {
      expect(evaluate('1 + 1')).toBe(2);
    });
  });
});

describe('evaluateObject', () => {
  it('resolves identifiers as properties of the value', () => {
    expect(evaluateObject('a + b', { a: 1, b: 2 })).toBe(3);
  });

  it('returns undefined for a missing property', () => {
    expect(evaluateObject('missing', {})).toBeUndefined();
  });

  it('treats a missing property as not null', () => {
    expect(evaluateObject('missing is null', {})).toBe(false);
  });

  it('treats a null property as null', () => {
    expect(evaluateObject('value is null', { value: null })).toBe(true);
  });

  it('evaluates a SQL-like filter against a record', () => {
    const record = { status: 'active', age: 30, tags: ['a', 'b', 'c'] };
    expect(evaluateObject("status = 'active' and age between 18 and 65 and length(tags) >= 3", record)).toBe(true);
  });

  it('evaluates a case expression against a record', () => {
    expect(evaluateObject("case when age >= 18 then 'adult' else 'minor' end", { age: 17 })).toBe('minor');
  });

  it('looks up properties case-sensitively', () => {
    expect(evaluateObject('Name', { Name: 'upper', name: 'lower' })).toBe('upper');
  });
});
