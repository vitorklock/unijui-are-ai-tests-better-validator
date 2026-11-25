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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mirrors Token.toString(), which the parser embeds in its error messages. */
const tokenText = (type: string, literal: string, position: number): string =>
  `{ type: ${type}, literal: ${literal} } as position: ${position}.`;

/** The lexer emits the NUL character as the literal of the end-of-input token. */
const eofToken = (position: number): string => tokenText('EOF', '\0', position);

const num = (value: number): ValueExpression => new ValueExpression(value);
const str = (value: string): ValueExpression => new ValueExpression(value);
const ident = (name: string): IdentifierExpression => new IdentifierExpression(name);
const bin = (operator: TokenType, left: Expression, right: Expression): BinaryExpression =>
  new BinaryExpression(operator, left, right);

/** A context that fails the test if the evaluator ever consults it. */
const forbiddenContext = (name: string): never => {
  throw new Error(`identifier "${name}" must not be evaluated`);
};

// ---------------------------------------------------------------------------
// parse()
// ---------------------------------------------------------------------------

describe('parse', () => {
  describe('literals and identifiers', () => {
    it.each([
      { expression: '42', expected: num(42) },
      { expression: '3.25', expected: num(3.25) },
      { expression: '.5', expected: num(0.5) },
      { expression: '7.', expected: num(7) },
      { expression: "'single'", expected: str('single') },
      { expression: '"double"', expected: str('double') },
      { expression: 'true', expected: new ValueExpression(true) },
      { expression: 'false', expected: new ValueExpression(false) },
      { expression: 'first_name', expected: ident('first_name') },
    ])('parses $expression into a leaf node', ({ expression, expected }) => {
      expect(parse(expression)).toStrictEqual(expected);
    });
  });

  describe('operator precedence and associativity', () => {
    it.each([
      {
        rule: 'multiplication binds tighter than addition',
        expression: '1 + 2 * 3',
        expected: bin(TokenType.Plus, num(1), bin(TokenType.Mul, num(2), num(3))),
      },
      {
        rule: 'division binds tighter than subtraction',
        expression: '1 - 2 / 3',
        expected: bin(TokenType.Minus, num(1), bin(TokenType.Div, num(2), num(3))),
      },
      {
        rule: 'parentheses override precedence',
        expression: '(1 + 2) * 3',
        expected: bin(TokenType.Mul, bin(TokenType.Plus, num(1), num(2)), num(3)),
      },
      {
        rule: 'subtraction is left associative',
        expression: '1 - 2 - 3',
        expected: bin(TokenType.Minus, bin(TokenType.Minus, num(1), num(2)), num(3)),
      },
      {
        rule: 'arithmetic binds tighter than comparison',
        expression: 'a + 1 = 2',
        expected: bin(TokenType.Eq, bin(TokenType.Plus, ident('a'), num(1)), num(2)),
      },
      {
        rule: 'relational operators bind tighter than equality',
        expression: 'a < 1 = b',
        expected: bin(TokenType.Eq, bin(TokenType.Lt, ident('a'), num(1)), ident('b')),
      },
      {
        rule: 'comparison binds tighter than and',
        expression: 'a > 1 and b < 2',
        expected: bin(
          TokenType.And,
          bin(TokenType.Gt, ident('a'), num(1)),
          bin(TokenType.Lt, ident('b'), num(2)),
        ),
      },
      {
        rule: 'equality binds tighter than or',
        expression: 'a = 1 or b = 2',
        expected: bin(
          TokenType.Or,
          bin(TokenType.Eq, ident('a'), num(1)),
          bin(TokenType.Eq, ident('b'), num(2)),
        ),
      },
      {
        rule: 'or binds tighter than and (and has the lowest precedence)',
        expression: 'a or b and c',
        expected: bin(TokenType.And, bin(TokenType.Or, ident('a'), ident('b')), ident('c')),
      },
      {
        rule: 'is null binds tighter than equality',
        expression: 'a = b is null',
        expected: bin(TokenType.Eq, ident('a'), bin(TokenType.Eq, ident('b'), new ValueExpression(null))),
      },
      {
        rule: 'function call binds tighter than arithmetic',
        expression: 'length(x) + 1',
        expected: bin(TokenType.Plus, new FunctionCallExpression('length', [ident('x')]), num(1)),
      },
    ])('$rule: $expression', ({ expression, expected }) => {
      expect(parse(expression)).toStrictEqual(expected);
    });
  });

  describe('is null', () => {
    it('desugars "is null" into an equality against null', () => {
      expect(parse('x is null')).toStrictEqual(bin(TokenType.Eq, ident('x'), new ValueExpression(null)));
    });

    it('desugars "is not null" into an inequality against null', () => {
      expect(parse('x is not null')).toStrictEqual(bin(TokenType.Neq, ident('x'), new ValueExpression(null)));
    });
  });

  describe('between', () => {
    it('desugars "between" into an inclusive range check', () => {
      expect(parse('x between 1 and 10')).toStrictEqual(
        bin(
          TokenType.And,
          bin(TokenType.Gte, ident('x'), num(1)),
          bin(TokenType.Lte, ident('x'), num(10)),
        ),
      );
    });

    it('applies "between" to a preceding arithmetic expression as a whole', () => {
      const subject = bin(TokenType.Plus, ident('x'), num(1));
      expect(parse('x + 1 between 2 and 3')).toStrictEqual(
        bin(TokenType.And, bin(TokenType.Gte, subject, num(2)), bin(TokenType.Lte, subject, num(3))),
      );
    });
  });

  describe('function calls', () => {
    it('parses a call with a single argument', () => {
      expect(parse('length(x)')).toStrictEqual(new FunctionCallExpression('length', [ident('x')]));
    });

    it('parses a call with no arguments', () => {
      expect(parse('length()')).toStrictEqual(new FunctionCallExpression('length', []));
    });

    it('parses a nested expression as an argument', () => {
      expect(parse("length(a + 'b')")).toStrictEqual(
        new FunctionCallExpression('length', [bin(TokenType.Plus, ident('a'), str('b'))]),
      );
    });
  });

  describe('case expressions', () => {
    it('parses a case with an else branch', () => {
      expect(parse('case when a then 1 else 2 end')).toStrictEqual(
        new CaseExpression([{ when: ident('a'), then: num(1) }], num(2)),
      );
    });

    it('parses a case without an else branch', () => {
      expect(parse('case when a then 1 end')).toStrictEqual(
        new CaseExpression([{ when: ident('a'), then: num(1) }], undefined),
      );
    });

    it('parses multiple when branches in order', () => {
      expect(parse('case when a then 1 when b then 2 end')).toStrictEqual(
        new CaseExpression(
          [
            { when: ident('a'), then: num(1) },
            { when: ident('b'), then: num(2) },
          ],
          undefined,
        ),
      );
    });
  });

  describe('lenient handling of trailing input', () => {
    it.each([
      { expression: '1 2', reason: 'a second literal' },
      { expression: '1 )', reason: 'an unmatched closing parenthesis' },
      { expression: '1 @', reason: 'an illegal character' },
      { expression: '1 not 2', reason: 'an operator that has precedence but no infix parser' },
    ])('stops after a complete expression when followed by $reason', ({ expression }) => {
      expect(parse(expression)).toStrictEqual(num(1));
    });

    it('stops reading a number at the second decimal point', () => {
      expect(parse('1.5.5')).toStrictEqual(num(1.5));
    });
  });

  describe('syntax errors', () => {
    it.each([
      { expression: '', token: eofToken(0) },
      { expression: '-1', token: tokenText('-', '-', 0) },
      { expression: 'not true', token: tokenText('not', 'not', 0) },
      { expression: 'null', token: tokenText('null', 'null', 0) },
      { expression: '@', token: tokenText('ILLEGAL', '@', 0) },
      { expression: '1 +', token: eofToken(3) },
      { expression: '1 + )', token: tokenText(')', ')', 4) },
    ])('rejects "$expression" as an invalid start of expression', ({ expression, token }) => {
      expect(() => parse(expression)).toThrow(new Error(`Unexpected start of expression: ${token}`));
    });

    it('rejects an illegal character in operand position', () => {
      expect(() => parse('1 + @')).toThrow(new Error(`Invalid input: ${tokenText('ILLEGAL', '@', 4)}`));
    });

    it('rejects an unclosed parenthesis', () => {
      expect(() => parse('(1 + 2')).toThrow(new Error(`Expected ) but got ${eofToken(6)}`));
    });

    it('rejects "is" that is not followed by null', () => {
      expect(() => parse('x is 1')).toThrow(new Error(`Expected null but got ${tokenText('NUM', '1', 5)}`));
    });

    it('rejects "is not" that is not followed by null', () => {
      expect(() => parse('x is not 1')).toThrow(new Error(`Expected null but got ${tokenText('NUM', '1', 9)}`));
    });

    it('rejects a non-numeric lower bound in between', () => {
      expect(() => parse('x between a and 10')).toThrow(
        new Error(`Expected NUM but got ${tokenText('IDENT', 'a', 10)}`),
      );
    });

    it('rejects a negative lower bound in between', () => {
      expect(() => parse('x between -1 and 10')).toThrow(
        new Error(`Expected NUM but got ${tokenText('-', '-', 10)}`),
      );
    });

    it('rejects between bounds that are not joined by "and"', () => {
      expect(() => parse('x between 1 or 10')).toThrow(
        new Error(`Expected and but got ${tokenText('or', 'or', 12)}`),
      );
    });

    it('rejects a non-numeric upper bound in between', () => {
      expect(() => parse('x between 1 and y')).toThrow(
        new Error(`Expected NUM but got ${tokenText('IDENT', 'y', 16)}`),
      );
    });

    it('rejects call arguments that are not separated by a comma', () => {
      expect(() => parse('length("abc" 1)')).toThrow(
        new Error(`Expected , or ) got ${tokenText('NUM', '1', 13)}`),
      );
    });

    it('rejects an unclosed call', () => {
      expect(() => parse('length("abc"')).toThrow(new Error(`Expected , or ) got ${eofToken(12)}`));
    });

    it('rejects a second call argument after a comma', () => {
      expect(() => parse('length("a", "b")')).toThrow(
        new Error(`Unexpected start of expression: ${tokenText(',', ',', 10)}`),
      );
    });

    it('rejects a case that does not start with when', () => {
      expect(() => parse('case else 1 end')).toThrow(
        new Error(`Expected when got ${tokenText('case', 'case', 0)}`),
      );
    });

    it('rejects a when branch without then', () => {
      expect(() => parse('case when true 1 end')).toThrow(
        new Error(`Expected then but got ${tokenText('NUM', '1', 15)}`),
      );
    });

    it('rejects a token other than when, else or end after a then branch', () => {
      expect(() => parse('case when true then 1 foo end')).toThrow(
        new Error(`Expected when but got ${tokenText('IDENT', 'foo', 22)}`),
      );
    });

    it('rejects a case without end', () => {
      expect(() => parse('case when true then 1')).toThrow(new Error(`Expected end but got ${eofToken(21)}`));
    });
  });
});

// ---------------------------------------------------------------------------
// evaluate()
// ---------------------------------------------------------------------------

describe('evaluate', () => {
  describe('literals', () => {
    it.each([
      { expression: '42', expected: 42 },
      { expression: '007', expected: 7 },
      { expression: '3.25', expected: 3.25 },
      { expression: '.5', expected: 0.5 },
      { expression: '7.', expected: 7 },
      { expression: 'true', expected: true },
      { expression: 'false', expected: false },
    ])('evaluates $expression to $expected', ({ expression, expected }) => {
      expect(evaluate(expression)).toBe(expected);
    });

    it.each([
      { expression: "'single'", expected: 'single' },
      { expression: '"double"', expected: 'double' },
      { expression: "''", expected: '' },
      { expression: "'say \"hi\"'", expected: 'say "hi"' },
      { expression: '"it\'s"', expected: "it's" },
      { expression: "'  spaced  out  '", expected: '  spaced  out  ' },
      { expression: "'and'", expected: 'and' },
      { expression: "'unterminated", expected: 'unterminated' },
    ])('evaluates string literal $expression to $expected', ({ expression, expected }) => {
      expect(evaluate(expression)).toBe(expected);
    });
  });

  describe('arithmetic', () => {
    it.each([
      { expression: '1 + 2', expected: 3 },
      { expression: '5 - 7', expected: -2 },
      { expression: '3 * 4', expected: 12 },
      { expression: '10 / 4', expected: 2.5 },
      { expression: '7 / 0', expected: Infinity },
      { expression: '1 + 2 * 3', expected: 7 },
      { expression: '(1 + 2) * 3', expected: 9 },
      { expression: '10 - 2 - 3', expected: 5 },
      { expression: '12 / 2 / 3', expected: 2 },
      { expression: '2 * 3 + 4 * 5', expected: 26 },
    ])('evaluates $expression to $expected', ({ expression, expected }) => {
      expect(evaluate(expression)).toBe(expected);
    });

    it('evaluates 0 / 0 to NaN', () => {
      expect(evaluate('0 / 0')).toBeNaN();
    });

    it('concatenates strings with +', () => {
      expect(evaluate("'foo' + 'bar'")).toBe('foobar');
    });

    it('coerces a number to a string when added to a string', () => {
      expect(evaluate("'v' + 1")).toBe('v1');
    });
  });

  describe('comparisons', () => {
    it.each([
      { expression: '1 < 2', expected: true },
      { expression: '2 < 2', expected: false },
      { expression: '3 < 2', expected: false },
      { expression: '1 <= 2', expected: true },
      { expression: '2 <= 2', expected: true },
      { expression: '3 <= 2', expected: false },
      { expression: '3 > 2', expected: true },
      { expression: '2 > 2', expected: false },
      { expression: '1 > 2', expected: false },
      { expression: '3 >= 2', expected: true },
      { expression: '2 >= 2', expected: true },
      { expression: '1 >= 2', expected: false },
      { expression: '2 = 2', expected: true },
      { expression: '2 = 3', expected: false },
      { expression: '2 <> 3', expected: true },
      { expression: '2 <> 2', expected: false },
    ])('evaluates $expression to $expected', ({ expression, expected }) => {
      expect(evaluate(expression)).toBe(expected);
    });

    it('compares strings lexicographically', () => {
      expect(evaluate("'apple' < 'banana'")).toBe(true);
    });

    it('treats equality as strict (no type coercion)', () => {
      expect(evaluate("1 = '1'")).toBe(false);
    });

    it('treats inequality as strict (no type coercion)', () => {
      expect(evaluate("1 <> '1'")).toBe(true);
    });

    it('evaluates arithmetic before comparing', () => {
      expect(evaluate("'a' + 'b' = 'ab'")).toBe(true);
    });
  });

  describe('logical operators', () => {
    it.each([
      { expression: 'true and true', expected: true },
      { expression: 'true and false', expected: false },
      { expression: 'false and true', expected: false },
      { expression: 'false or false', expected: false },
      { expression: 'false or true', expected: true },
      { expression: 'true or false', expected: true },
    ])('evaluates $expression to $expected', ({ expression, expected }) => {
      expect(evaluate(expression)).toBe(expected);
    });

    it.each([
      { expression: '0 or 5', expected: 5 },
      { expression: "'' or 'fallback'", expected: 'fallback' },
      { expression: '1 and 0', expected: 0 },
      { expression: "2 and 'last'", expected: 'last' },
    ])('returns the deciding operand for $expression', ({ expression, expected }) => {
      expect(evaluate(expression)).toBe(expected);
    });

    it('short-circuits "and" when the left side is falsy', () => {
      expect(evaluate('false and boom', forbiddenContext)).toBe(false);
    });

    it('short-circuits "or" when the left side is truthy', () => {
      expect(evaluate('true or boom', forbiddenContext)).toBe(true);
    });

    it('evaluates "or" before "and" because "and" has the lowest precedence', () => {
      // SQL would give true here; this parser groups it as (true or false) and false.
      expect(evaluate('true or false and false')).toBe(false);
    });

    it('evaluates comparisons before combining them with "and"', () => {
      expect(evaluateObject('x > 1 and x < 10', { x: 5 })).toBe(true);
    });
  });

  describe('is null', () => {
    it('evaluates "is null" to true for a null value', () => {
      expect(evaluateObject('x is null', { x: null })).toBe(true);
    });

    it('evaluates "is null" to false for a non-null value', () => {
      expect(evaluateObject('x is null', { x: 0 })).toBe(false);
    });

    it('evaluates "is null" to false for an undefined value (strict comparison)', () => {
      expect(evaluateObject('x is null', {})).toBe(false);
    });

    it('evaluates "is not null" to false for a null value', () => {
      expect(evaluateObject('x is not null', { x: null })).toBe(false);
    });

    it('evaluates "is not null" to true for a non-null value', () => {
      expect(evaluateObject('x is not null', { x: '' })).toBe(true);
    });

    it('combines "is null" checks with "or"', () => {
      expect(evaluateObject('a is null or b is null', { a: 1, b: null })).toBe(true);
    });
  });

  describe('between', () => {
    it.each([
      { x: 0.999, expected: false, position: 'just below the lower bound' },
      { x: 1, expected: true, position: 'at the lower bound' },
      { x: 5, expected: true, position: 'inside the range' },
      { x: 10, expected: true, position: 'at the upper bound' },
      { x: 10.001, expected: false, position: 'just above the upper bound' },
    ])('evaluates "x between 1 and 10" to $expected when x is $position ($x)', ({ x, expected }) => {
      expect(evaluateObject('x between 1 and 10', { x })).toBe(expected);
    });

    it('applies between to the result of preceding arithmetic', () => {
      expect(evaluateObject('x + 1 between 2 and 3', { x: 2 })).toBe(true);
    });

    it('allows a between check to be combined with a following condition', () => {
      expect(evaluateObject('x between 1 and 10 and y = 2', { x: 5, y: 3 })).toBe(false);
    });
  });

  describe('function calls', () => {
    it('returns the length of a string argument', () => {
      expect(evaluate("length('hello')")).toBe(5);
    });

    it('returns zero for an empty string argument', () => {
      expect(evaluate("length('')")).toBe(0);
    });

    it('returns the length of an array resolved from the context', () => {
      expect(evaluateObject('length(tags)', { tags: ['a', 'b', 'c'] })).toBe(3);
    });

    it('returns undefined when the argument has no length property', () => {
      expect(evaluate('length(1)')).toBeUndefined();
    });

    it('evaluates the argument expression before calling the function', () => {
      expect(evaluate("length('ab' + 'cde')")).toBe(5);
    });

    it('uses the call result in surrounding arithmetic', () => {
      expect(evaluate("length('ab') + 1")).toBe(3);
    });

    it('tolerates whitespace around the argument and before the parenthesis', () => {
      expect(evaluate("length ( 'ab' )")).toBe(2);
    });

    it('rejects a call to length with no arguments', () => {
      expect(() => evaluate('length()')).toThrow(new Error('Length function takes exactly one argument.'));
    });

    it('rejects a call to an unknown function', () => {
      expect(() => evaluate('upper("a")')).toThrow(new Error('Function upper not implemented'));
    });

    it('treats a parenthesised value followed by parentheses as a call without a name', () => {
      expect(() => evaluate('(1)(2)')).toThrow(new Error('Function undefined not implemented'));
    });
  });

  describe('case expressions', () => {
    it('returns the then value when the first condition is true', () => {
      expect(evaluate("case when true then 'a' end")).toBe('a');
    });

    it('returns false when no condition matches and there is no else', () => {
      expect(evaluate("case when false then 'a' end")).toBe(false);
    });

    it('returns the else value when no condition matches', () => {
      expect(evaluate("case when false then 'a' else 'b' end")).toBe('b');
    });

    it('returns the first matching branch when several match', () => {
      expect(evaluate('case when true then 1 when true then 2 end')).toBe(1);
    });

    it('returns a later branch when earlier ones do not match', () => {
      expect(evaluate('case when false then 1 when true then 2 else 3 end')).toBe(2);
    });

    it('preserves a falsy then value instead of falling through', () => {
      expect(evaluate('case when true then 0 else 1 end')).toBe(0);
    });

    it.each([
      { condition: '0', expected: 'no' },
      { condition: "''", expected: 'no' },
      { condition: '1', expected: 'yes' },
      { condition: "'x'", expected: 'yes' },
    ])('uses truthiness of the condition: when $condition gives $expected', ({ condition, expected }) => {
      expect(evaluate(`case when ${condition} then 'yes' else 'no' end`)).toBe(expected);
    });

    it.each([
      { x: 11, expected: 'high' },
      { x: 10, expected: 'mid' },
      { x: 6, expected: 'mid' },
      { x: 5, expected: 'low' },
    ])('selects the branch for x = $x as $expected', ({ x, expected }) => {
      expect(evaluateObject("case when x > 10 then 'high' when x > 5 then 'mid' else 'low' end", { x })).toBe(
        expected,
      );
    });

    it('does not evaluate the else branch when a condition matched', () => {
      expect(evaluate('case when true then 1 else boom end', forbiddenContext)).toBe(1);
    });

    it('does not evaluate later conditions once one has matched', () => {
      expect(evaluate('case when true then 1 when boom then 2 end', forbiddenContext)).toBe(1);
    });

    it('evaluates a compound condition inside when', () => {
      expect(evaluate("case when 1 = 1 and 2 > 1 then 'ok' end")).toBe('ok');
    });

    it('evaluates a compound expression inside then', () => {
      expect(evaluate('case when true then 1 + 1 end')).toBe(2);
    });

    it('uses a case result as the left operand of arithmetic', () => {
      expect(evaluate('case when true then 1 end + 1')).toBe(2);
    });

    it('uses a case result as the right operand of arithmetic', () => {
      expect(evaluate('1 + case when true then 2 end')).toBe(3);
    });

    it('evaluates a nested case expression', () => {
      expect(evaluate('case when true then case when false then 1 else 2 end end')).toBe(2);
    });
  });

  describe('identifiers and context', () => {
    it('passes the identifier name to the context function', () => {
      const context = vi.fn().mockReturnValue(9.5);
      evaluate('price', context);
      expect(context.mock.calls).toEqual([['price']]);
    });

    it('returns the value supplied by the context function', () => {
      expect(evaluate('price', () => 9.5)).toBe(9.5);
    });

    it('allows underscores in identifiers', () => {
      expect(evaluateObject('first_name', { first_name: 'Ada' })).toBe('Ada');
    });

    it('treats identifiers as case-sensitive', () => {
      expect(evaluateObject('Name', { Name: 'upper', name: 'lower' })).toBe('upper');
    });

    it('stops an identifier at the first digit', () => {
      const context = vi.fn().mockReturnValue(1);
      evaluate('a1', context);
      expect(context.mock.calls).toEqual([['a']]);
    });

    it('throws a TypeError when an identifier is used without a context', () => {
      expect(() => evaluate('x')).toThrow(TypeError);
    });
  });

  describe('lexical details', () => {
    it('ignores tabs, newlines and carriage returns between tokens', () => {
      expect(evaluate('\t1\n+\r\n2 ')).toBe(3);
    });

    it.each([
      { expression: 'TRUE', expected: true },
      { expression: 'False', expected: false },
      { expression: '1 = 1 AND 2 = 2', expected: true },
      { expression: '1 = 2 Or 2 = 2', expected: true },
      { expression: "CASE WHEN true THEN 'a' ELSE 'b' END", expected: 'a' },
    ])('treats keywords case-insensitively: $expression', ({ expression, expected }) => {
      expect(evaluate(expression)).toBe(expected);
    });

    it('treats IS NOT NULL case-insensitively', () => {
      expect(evaluateObject('x IS NOT NULL', { x: 1 })).toBe(true);
    });

    it('treats BETWEEN case-insensitively', () => {
      expect(evaluateObject('x BETWEEN 1 AND 2', { x: 2 })).toBe(true);
    });

    it('ignores input after the first complete expression', () => {
      expect(evaluate('1 2')).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// evaluateObject()
// ---------------------------------------------------------------------------

describe('evaluateObject', () => {
  it('resolves identifiers from the properties of the given object', () => {
    expect(evaluateObject('price * quantity', { price: 2.5, quantity: 4 })).toBe(10);
  });

  it('resolves a missing property to undefined', () => {
    expect(evaluateObject('missing', {})).toBeUndefined();
  });

  it('evaluates a literal without consulting the object', () => {
    expect(evaluateObject('1 + 1', {})).toBe(2);
  });

  it('evaluates a SQL-like filter clause against a record', () => {
    const record = { status: 'active', age: 30, email: null };
    expect(evaluateObject("status = 'active' and age between 18 and 65 and email is null", record)).toBe(true);
  });
});
