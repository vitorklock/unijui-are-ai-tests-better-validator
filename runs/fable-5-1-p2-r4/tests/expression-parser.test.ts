import { describe, expect, it, vi } from 'vitest';
import type { Expression } from '../src/ast';
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

// Small AST builders keep the expected trees in the parser tests readable.
const value = (v: unknown): ValueExpression => new ValueExpression(v);
const ident = (name: string): IdentifierExpression => new IdentifierExpression(name);
const binary = (operator: TokenType, left: Expression, right: Expression): BinaryExpression =>
  new BinaryExpression(operator, left, right);

// Builds a context that resolves every identifier to the same value.
const constantContext = (resolved: unknown) => (): unknown => resolved;

describe('parse', () => {
  describe('literals', () => {
    it('parses an integer literal as a numeric value', () => {
      expect(parse('42')).toStrictEqual(value(42));
    });

    it('parses a decimal literal', () => {
      expect(parse('3.25')).toStrictEqual(value(3.25));
    });

    it('parses a number with a leading decimal point', () => {
      expect(parse('.5')).toStrictEqual(value(0.5));
    });

    it('parses a number with a trailing decimal point', () => {
      expect(parse('2.')).toStrictEqual(value(2));
    });

    it('ends a number at a second decimal point', () => {
      expect(parse('1.2.3')).toStrictEqual(value(1.2));
    });

    it('parses a single-quoted string', () => {
      expect(parse("'hi'")).toStrictEqual(value('hi'));
    });

    it('parses a double-quoted string', () => {
      expect(parse('"hi"')).toStrictEqual(value('hi'));
    });

    it('parses an empty string', () => {
      expect(parse("''")).toStrictEqual(value(''));
    });

    it('keeps spaces inside a string', () => {
      expect(parse("'hello world'")).toStrictEqual(value('hello world'));
    });

    it('keeps the other quote character inside a string', () => {
      expect(parse('"it\'s"')).toStrictEqual(value("it's"));
    });

    it('reads an unterminated string up to the end of the input', () => {
      expect(parse("'abc")).toStrictEqual(value('abc'));
    });

    it('parses true as a boolean value', () => {
      expect(parse('true')).toStrictEqual(value(true));
    });

    it('parses false as a boolean value', () => {
      expect(parse('false')).toStrictEqual(value(false));
    });

    it('parses an identifier containing underscores', () => {
      expect(parse('first_name')).toStrictEqual(ident('first_name'));
    });

    it('ends an identifier at the first digit', () => {
      expect(parse('a1')).toStrictEqual(ident('a'));
    });
  });

  describe('binary operators', () => {
    it.each([
      ['1 + 2', TokenType.Plus],
      ['1 - 2', TokenType.Minus],
      ['1 * 2', TokenType.Mul],
      ['1 / 2', TokenType.Div],
      ['1 = 2', TokenType.Eq],
      ['1 <> 2', TokenType.Neq],
      ['1 > 2', TokenType.Gt],
      ['1 >= 2', TokenType.Gte],
      ['1 < 2', TokenType.Lt],
      ['1 <= 2', TokenType.Lte],
      ['1 and 2', TokenType.And],
      ['1 or 2', TokenType.Or],
    ])('parses %s as a binary expression with operator %s', (expression, operator) => {
      expect(parse(expression)).toStrictEqual(binary(operator, value(1), value(2)));
    });
  });

  describe('precedence and associativity', () => {
    it('binds * tighter than + on the right', () => {
      expect(parse('1 + 2 * 3')).toStrictEqual(
        binary(TokenType.Plus, value(1), binary(TokenType.Mul, value(2), value(3))),
      );
    });

    it('binds * tighter than + on the left', () => {
      expect(parse('1 * 2 + 3')).toStrictEqual(
        binary(TokenType.Plus, binary(TokenType.Mul, value(1), value(2)), value(3)),
      );
    });

    it('groups operators of equal precedence left to right', () => {
      expect(parse('1 - 2 - 3')).toStrictEqual(
        binary(TokenType.Minus, binary(TokenType.Minus, value(1), value(2)), value(3)),
      );
    });

    it('lets parentheses override precedence', () => {
      expect(parse('(1 + 2) * 3')).toStrictEqual(
        binary(TokenType.Mul, binary(TokenType.Plus, value(1), value(2)), value(3)),
      );
    });

    it('unwraps nested parentheses', () => {
      expect(parse('((7))')).toStrictEqual(value(7));
    });

    it('binds arithmetic tighter than comparison', () => {
      expect(parse('a + 1 > 2')).toStrictEqual(
        binary(TokenType.Gt, binary(TokenType.Plus, ident('a'), value(1)), value(2)),
      );
    });

    it('binds comparison tighter than logical operators', () => {
      expect(parse('a = 1 and b = 2')).toStrictEqual(
        binary(
          TokenType.And,
          binary(TokenType.Eq, ident('a'), value(1)),
          binary(TokenType.Eq, ident('b'), value(2)),
        ),
      );
    });

    it('binds or tighter than and', () => {
      expect(parse('a or b and c')).toStrictEqual(
        binary(TokenType.And, binary(TokenType.Or, ident('a'), ident('b')), ident('c')),
      );
    });

    it('binds is null tighter than comparison', () => {
      expect(parse('a is null = false')).toStrictEqual(
        binary(TokenType.Eq, binary(TokenType.Eq, ident('a'), value(null)), value(false)),
      );
    });

    it('binds arithmetic tighter than between', () => {
      const operand = binary(TokenType.Plus, ident('a'), value(1));
      expect(parse('a + 1 between 1 and 2')).toStrictEqual(
        binary(
          TokenType.And,
          binary(TokenType.Gte, operand, value(1)),
          binary(TokenType.Lte, operand, value(2)),
        ),
      );
    });

    it('stops at a token that has no infix parser', () => {
      expect(parse('1 not 2')).toStrictEqual(value(1));
    });

    it('ignores tokens after a complete expression', () => {
      expect(parse('1 2')).toStrictEqual(value(1));
    });
  });

  describe('is null', () => {
    it('parses is null as an equality with null', () => {
      expect(parse('x is null')).toStrictEqual(binary(TokenType.Eq, ident('x'), value(null)));
    });

    it('parses is not null as an inequality with null', () => {
      expect(parse('x is not null')).toStrictEqual(binary(TokenType.Neq, ident('x'), value(null)));
    });
  });

  describe('between', () => {
    it('parses between as an inclusive range check', () => {
      expect(parse('x between 1 and 10')).toStrictEqual(
        binary(
          TokenType.And,
          binary(TokenType.Gte, ident('x'), value(1)),
          binary(TokenType.Lte, ident('x'), value(10)),
        ),
      );
    });

    it('parses decimal bounds in between', () => {
      expect(parse('x between 0.5 and 1.5')).toStrictEqual(
        binary(
          TokenType.And,
          binary(TokenType.Gte, ident('x'), value(0.5)),
          binary(TokenType.Lte, ident('x'), value(1.5)),
        ),
      );
    });
  });

  describe('function calls', () => {
    it('parses a call with a single identifier argument', () => {
      expect(parse('length(x)')).toStrictEqual(new FunctionCallExpression('length', [ident('x')]));
    });

    it('parses a call with no arguments', () => {
      expect(parse('length()')).toStrictEqual(new FunctionCallExpression('length', []));
    });

    it('parses an expression as a call argument', () => {
      expect(parse('length(a + 1)')).toStrictEqual(
        new FunctionCallExpression('length', [binary(TokenType.Plus, ident('a'), value(1))]),
      );
    });

    it('lets a call take part in an enclosing expression', () => {
      expect(parse('length(x) = 3')).toStrictEqual(
        binary(TokenType.Eq, new FunctionCallExpression('length', [ident('x')]), value(3)),
      );
    });
  });

  describe('case', () => {
    it('parses a single when branch with an else', () => {
      expect(parse("case when a then 'yes' else 'no' end")).toStrictEqual(
        new CaseExpression([{ when: ident('a'), then: value('yes') }], value('no')),
      );
    });

    it('parses a case without an else branch', () => {
      expect(parse('case when a then 1 end')).toStrictEqual(
        new CaseExpression([{ when: ident('a'), then: value(1) }], undefined),
      );
    });

    it('parses multiple when branches in order', () => {
      expect(parse('case when a then 1 when b then 2 else 3 end')).toStrictEqual(
        new CaseExpression(
          [
            { when: ident('a'), then: value(1) },
            { when: ident('b'), then: value(2) },
          ],
          value(3),
        ),
      );
    });

    it('parses compound expressions inside when and then', () => {
      expect(parse('case when a > 1 then a * 2 end')).toStrictEqual(
        new CaseExpression(
          [{ when: binary(TokenType.Gt, ident('a'), value(1)), then: binary(TokenType.Mul, ident('a'), value(2)) }],
          undefined,
        ),
      );
    });
  });

  describe('keywords', () => {
    it.each([
      ['TRUE', value(true)],
      ['False', value(false)],
      ['a AND b', binary(TokenType.And, ident('a'), ident('b'))],
      ['a Or b', binary(TokenType.Or, ident('a'), ident('b'))],
      ['a IS NOT NULL', binary(TokenType.Neq, ident('a'), value(null))],
    ])('recognises %s regardless of letter case', (expression, expected) => {
      expect(parse(expression)).toStrictEqual(expected);
    });
  });

  describe('syntax errors', () => {
    it('rejects an empty expression', () => {
      expect(() => parse('')).toThrow(/^Unexpected start of expression: \{ type: EOF/);
    });

    it('rejects a bare null literal', () => {
      expect(() => parse('null')).toThrow(
        'Unexpected start of expression: { type: null, literal: null } as position: 0.',
      );
    });

    it('rejects a prefix not operator', () => {
      expect(() => parse('not true')).toThrow(
        'Unexpected start of expression: { type: not, literal: not } as position: 0.',
      );
    });

    it('rejects a unary minus', () => {
      expect(() => parse('-1')).toThrow(
        'Unexpected start of expression: { type: -, literal: - } as position: 0.',
      );
    });

    it('rejects an illegal character at the start', () => {
      expect(() => parse('@')).toThrow(
        'Unexpected start of expression: { type: ILLEGAL, literal: @ } as position: 0.',
      );
    });

    it('rejects an illegal character after an operator', () => {
      expect(() => parse('1 + !')).toThrow('Invalid input: { type: ILLEGAL, literal: ! } as position: 4.');
    });

    it.each(['1 +', '1 <', '1 >'])('rejects a missing right operand in %s', (expression) => {
      expect(() => parse(expression)).toThrow(/^Unexpected start of expression: \{ type: EOF/);
    });

    it('rejects an unclosed parenthesis', () => {
      expect(() => parse('(1 + 2')).toThrow(/^Expected \) but got \{ type: EOF/);
    });

    it('rejects empty parentheses', () => {
      expect(() => parse('()')).toThrow(
        'Unexpected start of expression: { type: ), literal: ) } as position: 1.',
      );
    });

    it('rejects is followed by something other than null', () => {
      expect(() => parse('x is 5')).toThrow('Expected null but got { type: NUM, literal: 5 } as position: 5.');
    });

    it('rejects is not followed by something other than null', () => {
      expect(() => parse('x is not 5')).toThrow(
        'Expected null but got { type: NUM, literal: 5 } as position: 9.',
      );
    });

    it('rejects a non-numeric lower bound in between', () => {
      expect(() => parse('x between a and 10')).toThrow(
        'Expected NUM but got { type: IDENT, literal: a } as position: 10.',
      );
    });

    it('rejects between bounds not joined by and', () => {
      expect(() => parse('x between 1 or 10')).toThrow(
        'Expected and but got { type: or, literal: or } as position: 12.',
      );
    });

    it('rejects a non-numeric upper bound in between', () => {
      expect(() => parse('x between 1 and y')).toThrow(
        'Expected NUM but got { type: IDENT, literal: y } as position: 16.',
      );
    });

    it('rejects call arguments not separated by a comma', () => {
      expect(() => parse('length(1 2)')).toThrow('Expected , or ) got { type: NUM, literal: 2 } as position: 9.');
    });

    it('rejects a second call argument after a comma', () => {
      expect(() => parse('length(1, 2)')).toThrow(
        'Unexpected start of expression: { type: ,, literal: , } as position: 8.',
      );
    });

    it('rejects an unclosed call', () => {
      expect(() => parse('length(1')).toThrow(/^Expected , or \) got \{ type: EOF/);
    });

    it('rejects a case that does not start with when', () => {
      expect(() => parse('case else 1 end')).toThrow(
        'Expected when got { type: case, literal: case } as position: 0.',
      );
    });

    it('rejects a when branch without then', () => {
      expect(() => parse('case when true 1 end')).toThrow(
        'Expected then but got { type: NUM, literal: 1 } as position: 15.',
      );
    });

    it('rejects a case without end after a when branch', () => {
      expect(() => parse('case when true then 1')).toThrow(/^Expected when but got \{ type: EOF/);
    });

    it('rejects a case without end after an else branch', () => {
      expect(() => parse('case when true then 1 else 2')).toThrow(/^Expected end but got \{ type: EOF/);
    });
  });
});

describe('evaluate', () => {
  describe('literals', () => {
    it('evaluates a number literal', () => {
      expect(evaluate('42')).toBe(42);
    });

    it('evaluates a string literal', () => {
      expect(evaluate("'hi'")).toBe('hi');
    });

    it('evaluates true', () => {
      expect(evaluate('true')).toBe(true);
    });

    it('evaluates false', () => {
      expect(evaluate('false')).toBe(false);
    });
  });

  describe('arithmetic', () => {
    it.each([
      ['2 + 3', 5],
      ['7 - 10', -3],
      ['4 * 2.5', 10],
      ['7 / 2', 3.5],
      ['1 + 2 * 3 - 4 / 2', 5],
      ['2 * (3 + 4)', 14],
      ['10 - 4 - 3', 3],
      ['8 / 4 / 2', 1],
    ])('evaluates %s to %s', (expression, expected) => {
      expect(evaluate(expression)).toBe(expected);
    });

    it('concatenates strings with +', () => {
      expect(evaluate("'ab' + 'cd'")).toBe('abcd');
    });

    it('returns Infinity when dividing by zero', () => {
      expect(evaluate('1 / 0')).toBe(Infinity);
    });

    it('returns NaN for zero divided by zero', () => {
      expect(evaluate('0 / 0')).toBeNaN();
    });
  });

  describe('comparison', () => {
    it.each([
      ['x > 5', 5, false],
      ['x > 5', 6, true],
      ['x >= 5', 4, false],
      ['x >= 5', 5, true],
      ['x < 5', 5, false],
      ['x < 5', 4, true],
      ['x <= 5', 6, false],
      ['x <= 5', 5, true],
      ['x = 5', 5, true],
      ['x = 5', 6, false],
      ['x <> 5', 6, true],
      ['x <> 5', 5, false],
    ])('evaluates %s to %s when x is %s', (expression, x, expected) => {
      expect(evaluate(expression, constantContext(x))).toBe(expected);
    });

    it('treats a string and a number with the same digits as unequal', () => {
      expect(evaluate("'1' = 1")).toBe(false);
    });

    it('treats a string and a number with the same digits as different', () => {
      expect(evaluate("'1' <> 1")).toBe(true);
    });

    it('compares equal strings as equal', () => {
      expect(evaluate("'abc' = 'abc'")).toBe(true);
    });

    it('compares strings lexicographically', () => {
      expect(evaluate("'apple' < 'banana'")).toBe(true);
    });

    it('chains equality from left to right', () => {
      expect(evaluate('1 = 1 = true')).toBe(true);
    });
  });

  describe('logical operators', () => {
    it.each([
      ['true and true', true],
      ['true and false', false],
      ['false and true', false],
      ['false and false', false],
      ['true or true', true],
      ['true or false', true],
      ['false or true', true],
      ['false or false', false],
    ])('evaluates %s to %s', (expression, expected) => {
      expect(evaluate(expression)).toBe(expected);
    });

    it('returns the right operand of and when the left is truthy', () => {
      expect(evaluate('1 and 2')).toBe(2);
    });

    it('returns the left operand of and when the left is falsy', () => {
      expect(evaluate('0 and 2')).toBe(0);
    });

    it('returns the left operand of or when the left is truthy', () => {
      expect(evaluate('1 or 2')).toBe(1);
    });

    it('returns the right operand of or when the left is falsy', () => {
      expect(evaluate('0 or 2')).toBe(2);
    });

    it('does not evaluate the right side of and when the left is false', () => {
      const context = vi.fn(() => true);
      evaluate('false and flag', context);
      expect(context).not.toHaveBeenCalled();
    });

    it('does not evaluate the right side of or when the left is true', () => {
      const context = vi.fn(() => false);
      evaluate('true or flag', context);
      expect(context).not.toHaveBeenCalled();
    });

    it('evaluates or before and when or comes first', () => {
      expect(evaluate('true or false and false')).toBe(false);
    });

    it('evaluates or before and when and comes first', () => {
      expect(evaluate('false and false or true')).toBe(false);
    });
  });

  describe('is null', () => {
    it.each([
      [null, true],
      [undefined, false],
      [0, false],
      ['', false],
    ])('evaluates x is null to %s when x is %s', (x, expected) => {
      expect(evaluate('x is null', constantContext(x))).toBe(expected);
    });

    it.each([
      [null, false],
      [undefined, true],
      [0, true],
    ])('evaluates x is not null to %s when x is %s', (x, expected) => {
      expect(evaluate('x is not null', constantContext(x))).toBe(expected);
    });
  });

  describe('between', () => {
    it.each([
      [0, false],
      [0.999, false],
      [1, true],
      [5, true],
      [10, true],
      [10.001, false],
      [11, false],
    ])('evaluates x between 1 and 10 to %s when x is %s', (x, expected) => {
      expect(evaluate('x between 1 and 10', constantContext(x))).toBe(expected);
    });

    it('applies between to the result of the preceding arithmetic', () => {
      expect(evaluate('x + 1 between 1 and 10', constantContext(10))).toBe(false);
    });

    it('combines between with a following condition', () => {
      expect(evaluateObject('x between 1 and 10 and y = 2', { x: 5, y: 3 })).toBe(false);
    });
  });

  describe('function calls', () => {
    it('returns the length of a string', () => {
      expect(evaluate("length('abc')")).toBe(3);
    });

    it('returns zero for the length of an empty string', () => {
      expect(evaluate("length('')")).toBe(0);
    });

    it('returns the length of an array identifier', () => {
      expect(evaluateObject('length(items)', { items: ['a', 'b', 'c', 'd'] })).toBe(4);
    });

    it('evaluates the argument expression before applying the function', () => {
      expect(evaluate("length('ab' + 'c')")).toBe(3);
    });

    it('uses the call result inside an enclosing expression', () => {
      expect(evaluateObject('a + length(b)', { a: 1, b: 'xy' })).toBe(3);
    });

    it('rejects length with no arguments', () => {
      expect(() => evaluate('length()')).toThrow('Length function takes exactly one argument.');
    });

    it('rejects an unknown function', () => {
      expect(() => evaluate('foo(1)')).toThrow('Function foo not implemented');
    });
  });

  describe('case', () => {
    const TIERED_CASE = "case when x > 10 then 'high' when x > 5 then 'mid' else 'low' end";

    it.each([
      [11, 'high'],
      [10, 'mid'],
      [6, 'mid'],
      [5, 'low'],
      [0, 'low'],
    ])('picks branch %s when x is %s', (x, expected) => {
      expect(evaluate(TIERED_CASE, constantContext(x))).toBe(expected);
    });

    it('returns false when no branch matches and there is no else', () => {
      expect(evaluate('case when false then 1 end')).toBe(false);
    });

    it('treats a falsy non-boolean condition as not matching', () => {
      expect(evaluate("case when 0 then 'a' else 'b' end")).toBe('b');
    });

    it('treats a truthy non-boolean condition as matching', () => {
      expect(evaluate("case when 1 then 'a' else 'b' end")).toBe('a');
    });

    it('does not evaluate conditions after the first match', () => {
      const context = vi.fn((name: string) => name === 'first');
      evaluate('case when first then 1 when second then 2 end', context);
      expect(context).not.toHaveBeenCalledWith('second');
    });

    it('uses the case result in a following operation', () => {
      expect(evaluate('case when true then 2 end + 1')).toBe(3);
    });

    it('uses a parenthesised case as an operand', () => {
      expect(evaluate('(case when false then 2 else 3 end) * 5')).toBe(15);
    });
  });

  describe('identifiers and context', () => {
    it('resolves an identifier through the context function', () => {
      expect(evaluate('price', constantContext(9.99))).toBe(9.99);
    });

    it('passes the identifier name to the context function', () => {
      const context = vi.fn(() => 0);
      evaluate('price', context);
      expect(context).toHaveBeenCalledWith('price');
    });

    it('throws a TypeError when an identifier is used without a context', () => {
      expect(() => evaluate('price')).toThrow(TypeError);
    });
  });

  describe('lexical details', () => {
    it('treats spaces, tabs, newlines and carriage returns as whitespace', () => {
      expect(evaluate(' 1\t+\n2\r')).toBe(3);
    });

    it.each([
      ['TRUE', true],
      ['True AND False', false],
      ['1 Between 0 And 2', true],
      ['1 IS NOT NULL', true],
      ["CASE WHEN TRUE THEN 'y' ELSE 'n' END", 'y'],
    ])('evaluates %s with keywords in any letter case', (expression, expected) => {
      expect(evaluate(expression)).toBe(expected);
    });

    it('evaluates a double-quoted string the same as a single-quoted one', () => {
      expect(evaluate('"hi" = \'hi\'')).toBe(true);
    });
  });
});

describe('evaluateObject', () => {
  it('reads an identifier from the object property of the same name', () => {
    expect(evaluateObject('name', { name: 'Ann' })).toBe('Ann');
  });

  it('resolves a missing property to undefined', () => {
    expect(evaluateObject('missing', { name: 'Ann' })).toBeUndefined();
  });

  it('resolves identifiers that differ only by letter case separately', () => {
    expect(evaluateObject('Name', { name: 'lower', Name: 'upper' })).toBe('upper');
  });

  describe('where clause', () => {
    const WHERE = "age between 18 and 65 and status = 'active'";

    it('returns true when every condition holds', () => {
      expect(evaluateObject(WHERE, { age: 30, status: 'active' })).toBe(true);
    });

    it('returns false when the equality condition fails', () => {
      expect(evaluateObject(WHERE, { age: 30, status: 'inactive' })).toBe(false);
    });

    it('returns false when the range condition fails', () => {
      expect(evaluateObject(WHERE, { age: 17, status: 'active' })).toBe(false);
    });
  });

  describe('where clause with a function call', () => {
    const WHERE = 'length(tags) > 2 or vip = true';

    it('returns true when the function condition holds', () => {
      expect(evaluateObject(WHERE, { tags: ['a', 'b', 'c'], vip: false })).toBe(true);
    });

    it('returns true when only the second condition holds', () => {
      expect(evaluateObject(WHERE, { tags: [], vip: true })).toBe(true);
    });

    it('returns false when neither condition holds', () => {
      expect(evaluateObject(WHERE, { tags: ['a', 'b'], vip: false })).toBe(false);
    });
  });
});
