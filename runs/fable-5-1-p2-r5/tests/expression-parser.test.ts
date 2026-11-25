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

/** Mirrors `Token.toString()` so error-message expectations stay readable. */
function tokenText(type: string, literal: string, position: number): string {
  return `{ type: ${type}, literal: ${literal} } as position: ${position}.`;
}

function unexpectedStart(type: string, literal: string, position: number): Error {
  return new Error(`Unexpected start of expression: ${tokenText(type, literal, position)}`);
}

/** A context that must never be consulted; used to prove short-circuiting. */
function forbiddenContext(): never {
  throw new Error('context must not be consulted');
}

describe('parse: literals and identifiers', () => {
  it('parses an integer literal into a numeric ValueExpression', () => {
    expect(parse('42')).toStrictEqual(new ValueExpression(42));
  });

  it('parses a decimal literal into a numeric ValueExpression', () => {
    expect(parse('3.25')).toStrictEqual(new ValueExpression(3.25));
  });

  it('parses a leading-dot decimal literal', () => {
    expect(parse('.5')).toStrictEqual(new ValueExpression(0.5));
  });

  it('parses a single-quoted string literal without its quotes', () => {
    expect(parse("'hello'")).toStrictEqual(new ValueExpression('hello'));
  });

  it('parses a double-quoted string literal without its quotes', () => {
    expect(parse('"hello"')).toStrictEqual(new ValueExpression('hello'));
  });

  it('parses true into a boolean ValueExpression', () => {
    expect(parse('true')).toStrictEqual(new ValueExpression(true));
  });

  it('parses false into a boolean ValueExpression', () => {
    expect(parse('false')).toStrictEqual(new ValueExpression(false));
  });

  it('parses a bare name into an IdentifierExpression', () => {
    expect(parse('price')).toStrictEqual(new IdentifierExpression('price'));
  });

  it('keeps the original casing of identifiers', () => {
    expect(parse('TotalPrice')).toStrictEqual(new IdentifierExpression('TotalPrice'));
  });

  it('allows underscores inside identifiers', () => {
    expect(parse('_unit_price')).toStrictEqual(new IdentifierExpression('_unit_price'));
  });

  it('treats a name that merely starts with a keyword as an identifier', () => {
    expect(parse('android')).toStrictEqual(new IdentifierExpression('android'));
  });
});

describe('parse: operator precedence and associativity', () => {
  it('binds * tighter than +', () => {
    expect(parse('1 + 2 * 3')).toStrictEqual(
      new BinaryExpression(
        TokenType.Plus,
        new ValueExpression(1),
        new BinaryExpression(TokenType.Mul, new ValueExpression(2), new ValueExpression(3)),
      ),
    );
  });

  it('lets parentheses override precedence', () => {
    expect(parse('(1 + 2) * 3')).toStrictEqual(
      new BinaryExpression(
        TokenType.Mul,
        new BinaryExpression(TokenType.Plus, new ValueExpression(1), new ValueExpression(2)),
        new ValueExpression(3),
      ),
    );
  });

  it('is left-associative for operators of equal precedence', () => {
    expect(parse('1 - 2 - 3')).toStrictEqual(
      new BinaryExpression(
        TokenType.Minus,
        new BinaryExpression(TokenType.Minus, new ValueExpression(1), new ValueExpression(2)),
        new ValueExpression(3),
      ),
    );
  });

  it('binds ordering comparisons tighter than equality', () => {
    expect(parse('1 < 2 = true')).toStrictEqual(
      new BinaryExpression(
        TokenType.Eq,
        new BinaryExpression(TokenType.Lt, new ValueExpression(1), new ValueExpression(2)),
        new ValueExpression(true),
      ),
    );
  });

  it('binds or tighter than and', () => {
    expect(parse('a or b and c')).toStrictEqual(
      new BinaryExpression(
        TokenType.And,
        new BinaryExpression(TokenType.Or, new IdentifierExpression('a'), new IdentifierExpression('b')),
        new IdentifierExpression('c'),
      ),
    );
  });

  it('binds a function call tighter than arithmetic', () => {
    expect(parse('1 + length(x)')).toStrictEqual(
      new BinaryExpression(
        TokenType.Plus,
        new ValueExpression(1),
        new FunctionCallExpression('length', [new IdentifierExpression('x')]),
      ),
    );
  });
});

describe('parse: sugar constructs', () => {
  it('desugars "between" into an inclusive range check', () => {
    expect(parse('x between 1 and 5')).toStrictEqual(
      new BinaryExpression(
        TokenType.And,
        new BinaryExpression(TokenType.Gte, new IdentifierExpression('x'), new ValueExpression(1)),
        new BinaryExpression(TokenType.Lte, new IdentifierExpression('x'), new ValueExpression(5)),
      ),
    );
  });

  it('desugars "is null" into an equality against null', () => {
    expect(parse('x is null')).toStrictEqual(
      new BinaryExpression(TokenType.Eq, new IdentifierExpression('x'), new ValueExpression(null)),
    );
  });

  it('desugars "is not null" into an inequality against null', () => {
    expect(parse('x is not null')).toStrictEqual(
      new BinaryExpression(TokenType.Neq, new IdentifierExpression('x'), new ValueExpression(null)),
    );
  });

  it('parses a function call with a single argument', () => {
    expect(parse('f(x)')).toStrictEqual(new FunctionCallExpression('f', [new IdentifierExpression('x')]));
  });

  it('parses a function call with no arguments', () => {
    expect(parse('f()')).toStrictEqual(new FunctionCallExpression('f', []));
  });

  it('parses a case expression with an else branch', () => {
    expect(parse('case when a then 1 when b then 2 else 3 end')).toStrictEqual(
      new CaseExpression(
        [
          { when: new IdentifierExpression('a'), then: new ValueExpression(1) },
          { when: new IdentifierExpression('b'), then: new ValueExpression(2) },
        ],
        new ValueExpression(3),
      ),
    );
  });

  it('parses a case expression without an else branch', () => {
    expect(parse('case when a then 1 end')).toStrictEqual(
      new CaseExpression([{ when: new IdentifierExpression('a'), then: new ValueExpression(1) }], undefined),
    );
  });
});

describe('lexing details observable through evaluate', () => {
  it('skips tabs, newlines and carriage returns between tokens', () => {
    expect(evaluate('1\t+\n2\r')).toBe(3);
  });

  it('skips leading and trailing spaces', () => {
    expect(evaluate('  7  ')).toBe(7);
  });

  it('recognises keywords regardless of letter case', () => {
    expect(evaluate('TRUE And False')).toBe(false);
  });

  it('allows the other quote character inside a string', () => {
    expect(evaluate('"it\'s"')).toBe("it's");
  });

  it('produces an empty string for two adjacent quotes', () => {
    expect(evaluate("''")).toBe('');
  });

  it('reads an unterminated string up to the end of input', () => {
    expect(evaluate("'abc")).toBe('abc');
  });

  it('stops a number literal at a second decimal point', () => {
    expect(evaluate('1.2.3')).toBe(1.2);
  });

  it('turns a lone dot into NaN', () => {
    expect(evaluate('.')).toBeNaN();
  });

  it('ignores tokens that cannot continue a finished expression', () => {
    expect(evaluate('1 2')).toBe(1);
  });
});

describe('evaluate: arithmetic', () => {
  it('adds numbers', () => {
    expect(evaluate('1 + 2')).toBe(3);
  });

  it('subtracts numbers', () => {
    expect(evaluate('1 - 2')).toBe(-1);
  });

  it('multiplies numbers', () => {
    expect(evaluate('4 * 2.5')).toBe(10);
  });

  it('divides numbers', () => {
    expect(evaluate('9 / 4')).toBe(2.25);
  });

  it('follows precedence when combining + and *', () => {
    expect(evaluate('1 + 2 * 3')).toBe(7);
  });

  it('honours parentheses', () => {
    expect(evaluate('(1 + 2) * (3 - 1)')).toBe(6);
  });

  it('unwraps nested parentheses', () => {
    expect(evaluate('((5))')).toBe(5);
  });

  it('evaluates equal-precedence operators left to right', () => {
    expect(evaluate('8 / 2 / 2')).toBe(2);
  });

  it('returns Infinity when dividing by zero', () => {
    expect(evaluate('1 / 0')).toBe(Infinity);
  });

  it('concatenates strings with +', () => {
    expect(evaluate("'foo' + 'bar'")).toBe('foobar');
  });
});

describe('evaluate: comparison operators', () => {
  describe('> is strict', () => {
    it.each([
      { expression: '2 > 1', expected: true },
      { expression: '1 > 1', expected: false },
      { expression: '0 > 1', expected: false },
    ])('$expression is $expected', ({ expression, expected }) => {
      expect(evaluate(expression)).toBe(expected);
    });
  });

  describe('>= is inclusive', () => {
    it.each([
      { expression: '2 >= 1', expected: true },
      { expression: '1 >= 1', expected: true },
      { expression: '0 >= 1', expected: false },
    ])('$expression is $expected', ({ expression, expected }) => {
      expect(evaluate(expression)).toBe(expected);
    });
  });

  describe('< is strict', () => {
    it.each([
      { expression: '0 < 1', expected: true },
      { expression: '1 < 1', expected: false },
      { expression: '2 < 1', expected: false },
    ])('$expression is $expected', ({ expression, expected }) => {
      expect(evaluate(expression)).toBe(expected);
    });
  });

  describe('<= is inclusive', () => {
    it.each([
      { expression: '0 <= 1', expected: true },
      { expression: '1 <= 1', expected: true },
      { expression: '2 <= 1', expected: false },
    ])('$expression is $expected', ({ expression, expected }) => {
      expect(evaluate(expression)).toBe(expected);
    });
  });

  it('= is true for equal numbers', () => {
    expect(evaluate('1 = 1')).toBe(true);
  });

  it('= is false for different numbers', () => {
    expect(evaluate('1 = 2')).toBe(false);
  });

  it('= does not coerce between number and string', () => {
    expect(evaluate("1 = '1'")).toBe(false);
  });

  it('<> is true for different values', () => {
    expect(evaluate('1 <> 2')).toBe(true);
  });

  it('<> is false for equal values', () => {
    expect(evaluate("'a' <> 'a'")).toBe(false);
  });

  it('<> does not coerce between number and string', () => {
    expect(evaluate("1 <> '1'")).toBe(true);
  });

  it('compares strings lexicographically', () => {
    expect(evaluate("'apple' < 'banana'")).toBe(true);
  });

  it('compares the result of arithmetic', () => {
    expect(evaluate('1 + 1 = 2')).toBe(true);
  });
});

describe('evaluate: logical operators', () => {
  it('and is true only when both sides are true', () => {
    expect(evaluate('true and true')).toBe(true);
  });

  it('and is false when the right side is false', () => {
    expect(evaluate('true and false')).toBe(false);
  });

  it('or is true when only the right side is true', () => {
    expect(evaluate('false or true')).toBe(true);
  });

  it('or is false when both sides are false', () => {
    expect(evaluate('false or false')).toBe(false);
  });

  it('and yields its right operand when the left is truthy', () => {
    expect(evaluate('1 and 2')).toBe(2);
  });

  it('and yields its left operand when the left is falsy', () => {
    expect(evaluate('0 and 2')).toBe(0);
  });

  it('or yields its left operand when the left is truthy', () => {
    expect(evaluate('1 or 2')).toBe(1);
  });

  it('or yields its right operand when the left is falsy', () => {
    expect(evaluate('0 or 2')).toBe(2);
  });

  it('and does not evaluate the right side when the left is false', () => {
    expect(evaluate('false and missing', forbiddenContext)).toBe(false);
  });

  it('or does not evaluate the right side when the left is true', () => {
    expect(evaluate('true or missing', forbiddenContext)).toBe(true);
  });

  it('groups "a or b and c" as "(a or b) and c"', () => {
    expect(evaluate('true or false and false')).toBe(false);
  });

  it('groups "a and b or c" as "a and (b or c)"', () => {
    expect(evaluate('false and false or true')).toBe(false);
  });
});

describe('evaluate: between', () => {
  const RANGE = 'x between 1 and 5';

  it.each([
    { x: 0, expected: false, note: 'just below the lower bound' },
    { x: 1, expected: true, note: 'on the lower bound' },
    { x: 3, expected: true, note: 'inside the range' },
    { x: 5, expected: true, note: 'on the upper bound' },
    { x: 6, expected: false, note: 'just above the upper bound' },
  ])(`${RANGE} with x = $x is $expected ($note)`, ({ x, expected }) => {
    expect(evaluateObject(RANGE, { x })).toBe(expected);
  });

  it('accepts decimal bounds', () => {
    expect(evaluate('1.6 between 1.5 and 1.7')).toBe(true);
  });

  it('is false for an inverted range', () => {
    expect(evaluate('3 between 5 and 1')).toBe(false);
  });

  it('can be combined with a following and', () => {
    expect(evaluateObject('x between 1 and 5 and y = 2', { x: 3, y: 2 })).toBe(true);
  });
});

describe('evaluate: is null / is not null', () => {
  it('is null is true for a null value', () => {
    expect(evaluateObject('x is null', { x: null })).toBe(true);
  });

  it('is null is false for an undefined value', () => {
    expect(evaluateObject('x is null', {})).toBe(false);
  });

  it('is null is false for a falsy non-null value', () => {
    expect(evaluateObject('x is null', { x: 0 })).toBe(false);
  });

  it('is not null is false for a null value', () => {
    expect(evaluateObject('x is not null', { x: null })).toBe(false);
  });

  it('is not null is true for a falsy non-null value', () => {
    expect(evaluateObject('x is not null', { x: '' })).toBe(true);
  });

  it('applies is null to the whole arithmetic expression on its left', () => {
    expect(evaluateObject('x + 1 is null', { x: 1 })).toBe(false);
  });
});

describe('evaluate: case expressions', () => {
  const TIERS = "case when x > 10 then 'high' when x > 5 then 'mid' else 'low' end";

  it.each([
    { x: 11, expected: 'high', note: 'just above the first threshold' },
    { x: 10, expected: 'mid', note: 'on the first threshold falls through' },
    { x: 6, expected: 'mid', note: 'just above the second threshold' },
    { x: 5, expected: 'low', note: 'on the second threshold falls to else' },
  ])('x = $x yields $expected ($note)', ({ x, expected }) => {
    expect(evaluateObject(TIERS, { x })).toBe(expected);
  });

  it('returns false when no branch matches and there is no else', () => {
    expect(evaluate("case when false then 'a' end")).toBe(false);
  });

  it('treats a falsy non-boolean condition as not matching', () => {
    expect(evaluate("case when 0 then 'a' else 'b' end")).toBe('b');
  });

  it('treats a truthy non-boolean condition as matching', () => {
    expect(evaluate("case when 'x' then 'a' else 'b' end")).toBe('a');
  });

  it('does not evaluate branches after the first match', () => {
    expect(evaluate('case when true then 1 when missing then 2 end', forbiddenContext)).toBe(1);
  });

  it('can be used as an operand', () => {
    expect(evaluate('case when true then 1 end + 1')).toBe(2);
  });

  it('accepts upper-case keywords', () => {
    expect(evaluate('CASE WHEN FALSE THEN 1 ELSE 2 END')).toBe(2);
  });
});

describe('evaluate: functions', () => {
  it('length returns the length of a string literal', () => {
    expect(evaluate("length('abc')")).toBe(3);
  });

  it('length returns the length of an array from the context', () => {
    expect(evaluateObject('length(items)', { items: ['a', 'b'] })).toBe(2);
  });

  it('length evaluates its argument expression first', () => {
    expect(evaluate("length('a' + 'bc')")).toBe(3);
  });

  it('a call result can take part in arithmetic', () => {
    expect(evaluate("length('ab') + 1")).toBe(3);
  });

  it('rejects length with no arguments', () => {
    expect(() => evaluate('length()')).toThrow(new Error('Length function takes exactly one argument.'));
  });

  it('rejects an unknown function by name', () => {
    expect(() => evaluate('upper(1)')).toThrow(new Error('Function upper not implemented'));
  });
});

describe('evaluate: identifiers and context', () => {
  it('passes the identifier name to the context function', () => {
    const context = vi.fn().mockReturnValue(0);
    evaluate('price', context);
    expect(context).toHaveBeenCalledWith('price');
  });

  it('returns the value provided by the context function', () => {
    expect(evaluate('price', () => 9.5)).toBe(9.5);
  });

  it('resolves each identifier independently', () => {
    const values: Record<string, number> = { a: 2, b: 3 };
    expect(evaluate('a * b', (name) => values[name])).toBe(6);
  });

  it('throws a TypeError when an identifier is used without a context', () => {
    expect(() => evaluate('price')).toThrow(TypeError);
  });

  it('does not need a context for constant expressions', () => {
    expect(evaluate('2 * 3')).toBe(6);
  });
});

describe('evaluateObject', () => {
  it('reads identifiers as properties of the value', () => {
    expect(evaluateObject("name = 'bob'", { name: 'bob' })).toBe(true);
  });

  it('yields undefined for a missing property', () => {
    expect(evaluateObject('missing', {})).toBeUndefined();
  });

  it('compares two properties of the same object', () => {
    expect(evaluateObject('a = b', { a: 1, b: 1 })).toBe(true);
  });
});

describe('parse errors', () => {
  it('rejects empty input', () => {
    expect(() => parse('')).toThrow(unexpectedStart(TokenType.EOF, EOF_LITERAL, 0));
  });

  it('rejects an expression that starts with an illegal character', () => {
    expect(() => parse('@')).toThrow(unexpectedStart(TokenType.Illegal, '@', 0));
  });

  it('rejects an illegal character after an operator', () => {
    expect(() => parse('1 + @')).toThrow(new Error(`Invalid input: ${tokenText(TokenType.Illegal, '@', 4)}`));
  });

  it('rejects a unary minus', () => {
    expect(() => parse('-1')).toThrow(unexpectedStart(TokenType.Minus, '-', 0));
  });

  it('rejects a prefix not', () => {
    expect(() => parse('not true')).toThrow(unexpectedStart(TokenType.Not, 'not', 0));
  });

  it('rejects a bare null literal', () => {
    expect(() => parse('null')).toThrow(unexpectedStart(TokenType.Null, 'null', 0));
  });

  it('rejects a dangling binary operator', () => {
    expect(() => parse('1 <')).toThrow(unexpectedStart(TokenType.EOF, EOF_LITERAL, 3));
  });

  it('rejects an unclosed parenthesis', () => {
    expect(() => parse('(1')).toThrow(new Error(`Expected ) but got ${tokenText(TokenType.EOF, EOF_LITERAL, 2)}`));
  });

  it('rejects empty parentheses', () => {
    expect(() => parse('()')).toThrow(unexpectedStart(TokenType.Rparn, ')', 1));
  });

  it('rejects "is" followed by something other than null', () => {
    expect(() => parse('x is 5')).toThrow(new Error(`Expected null but got ${tokenText(TokenType.Numeric, '5', 5)}`));
  });

  it('rejects a non-numeric lower bound in between', () => {
    expect(() => parse('x between a and 5')).toThrow(
      new Error(`Expected NUM but got ${tokenText(TokenType.Identifier, 'a', 10)}`),
    );
  });

  it('rejects between without "and"', () => {
    expect(() => parse('x between 1 or 5')).toThrow(
      new Error(`Expected and but got ${tokenText(TokenType.Or, 'or', 12)}`),
    );
  });

  it('rejects a non-numeric upper bound in between', () => {
    expect(() => parse('x between 1 and y')).toThrow(
      new Error(`Expected NUM but got ${tokenText(TokenType.Identifier, 'y', 16)}`),
    );
  });

  it('rejects call arguments that are not separated by commas', () => {
    expect(() => parse("length('a' 'b')")).toThrow(
      new Error(`Expected , or ) got ${tokenText(TokenType.String, 'b', 12)}`),
    );
  });

  it('rejects comma-separated call arguments (the comma is not a valid expression start)', () => {
    expect(() => parse('f(1, x)')).toThrow(unexpectedStart(TokenType.Comma, ',', 3));
  });

  it('rejects an unclosed call', () => {
    expect(() => parse('length(')).toThrow(unexpectedStart(TokenType.EOF, EOF_LITERAL, 7));
  });

  it('rejects case that is not followed by when', () => {
    expect(() => parse('case 1 end')).toThrow(new Error(`Expected when got ${tokenText(TokenType.Case, 'case', 0)}`));
  });

  it('rejects a when branch without then', () => {
    expect(() => parse('case when true 1 end')).toThrow(
      new Error(`Expected then but got ${tokenText(TokenType.Numeric, '1', 15)}`),
    );
  });

  it('rejects stray tokens between case branches', () => {
    expect(() => parse('case when true then 1 foo end')).toThrow(
      new Error(`Expected when but got ${tokenText(TokenType.Identifier, 'foo', 22)}`),
    );
  });

  it('rejects a case without end', () => {
    expect(() => parse('case when true then 1 else 2')).toThrow(
      new Error(`Expected end but got ${tokenText(TokenType.EOF, EOF_LITERAL, 28)}`),
    );
  });
});
