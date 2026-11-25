import { describe, expect, it, vi } from 'vitest';
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

// `parse` is wrapped (not replaced) so that a single describe block below can feed
// the evaluator AST nodes the parser never produces. Every other test still runs
// the real parser through this wrapper.
vi.mock('../src/parser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/parser')>();
  return { ...actual, parse: vi.fn(actual.parse) };
});

describe('literals', () => {
  it('evaluates an integer literal', () => {
    expect(evaluate('42')).toBe(42);
  });

  it('evaluates a multi-digit decimal literal', () => {
    expect(evaluate('123.75')).toBe(123.75);
  });

  it('accepts a number with a leading decimal point', () => {
    expect(evaluate('.5')).toBe(0.5);
  });

  it('ends a number at its second decimal point', () => {
    // "1.2.3" lexes as the number 1.2 followed by the number .3, and parsing stops after 1.2
    expect(evaluate('1.2.3')).toBe(1.2);
  });

  it('evaluates a single-quoted string', () => {
    expect(evaluate("'hello'")).toBe('hello');
  });

  it('evaluates a double-quoted string', () => {
    expect(evaluate('"hello"')).toBe('hello');
  });

  it('keeps the other quote character inside a string', () => {
    expect(evaluate('"it\'s"')).toBe("it's");
  });

  it('evaluates an empty string', () => {
    expect(evaluate("''")).toBe('');
  });

  it('extends an unterminated string to the end of the input', () => {
    expect(evaluate("'abc")).toBe('abc');
  });

  it('evaluates true', () => {
    expect(evaluate('true')).toBe(true);
  });

  it('evaluates false', () => {
    expect(evaluate('false')).toBe(false);
  });
});

describe('identifiers and context', () => {
  it('returns the value supplied by the context function', () => {
    const context = vi.fn().mockReturnValue(42);

    expect(evaluate('answer', context)).toBe(42);
  });

  it('passes the identifier name to the context function', () => {
    const context = vi.fn();

    evaluate('total_amount', context);

    expect(context).toHaveBeenCalledWith('total_amount');
  });

  it('preserves the case of identifier names', () => {
    const context = vi.fn();

    evaluate('Price', context);

    expect(context).toHaveBeenCalledWith('Price');
  });

  it('treats a word that merely starts with a keyword as an identifier', () => {
    expect(evaluateObject('ending', { ending: 7 })).toBe(7);
  });

  it('ends an identifier at the first digit', () => {
    // "x1" lexes as identifier "x" followed by number 1; parsing stops after "x"
    const context = vi.fn().mockReturnValue('x-value');

    expect(evaluate('x1', context)).toBe('x-value');
  });

  it('throws a TypeError when an identifier is used without a context', () => {
    expect(() => evaluate('x')).toThrow(TypeError);
  });

  it('evaluateObject reads identifiers as properties of the value', () => {
    expect(evaluateObject('price * qty', { price: 2.5, qty: 4 })).toBe(10);
  });

  it('evaluateObject yields undefined for a missing property', () => {
    expect(evaluateObject('missing', {})).toBeUndefined();
  });
});

describe('arithmetic operators', () => {
  it('adds numbers', () => {
    expect(evaluate('120 + 345')).toBe(465);
  });

  it('adds decimals exactly', () => {
    expect(evaluate('1.5 + 2.25')).toBe(3.75);
  });

  it('concatenates strings with +', () => {
    expect(evaluate("'foo' + 'bar'")).toBe('foobar');
  });

  it('subtracts into a negative result', () => {
    expect(evaluate('1 - 2')).toBe(-1);
  });

  it('multiplies', () => {
    expect(evaluate('6 * 7')).toBe(42);
  });

  it('divides into a fractional result', () => {
    expect(evaluate('7 / 2')).toBe(3.5);
  });

  it('divides by zero into Infinity', () => {
    expect(evaluate('1 / 0')).toBe(Infinity);
  });

  it('gives * precedence over +', () => {
    expect(evaluate('1 + 2 * 3')).toBe(7);
  });

  it('gives / precedence over -', () => {
    expect(evaluate('10 - 8 / 2')).toBe(6);
  });

  it('applies subtraction left to right', () => {
    expect(evaluate('10 - 4 - 3')).toBe(3);
  });

  it('applies division left to right', () => {
    expect(evaluate('100 / 10 / 2')).toBe(5);
  });

  it('lets parentheses override precedence', () => {
    expect(evaluate('(1 + 2) * 3')).toBe(9);
  });

  it('evaluates nested parentheses', () => {
    expect(evaluate('((1 + 2) * (3 + 4))')).toBe(21);
  });
});

describe('comparison operators', () => {
  const THRESHOLD = 5;

  describe.each([
    { operator: '>', atThreshold: false, above: true, below: false },
    { operator: '>=', atThreshold: true, above: true, below: false },
    { operator: '<', atThreshold: false, above: false, below: true },
    { operator: '<=', atThreshold: true, above: false, below: true },
  ])('operator $operator', ({ operator, atThreshold, above, below }) => {
    const expression = `x ${operator} ${THRESHOLD}`;

    it(`is ${atThreshold} exactly at the threshold`, () => {
      expect(evaluateObject(expression, { x: THRESHOLD })).toBe(atThreshold);
    });

    it(`is ${above} just above the threshold`, () => {
      expect(evaluateObject(expression, { x: THRESHOLD + 1 })).toBe(above);
    });

    it(`is ${below} just below the threshold`, () => {
      expect(evaluateObject(expression, { x: THRESHOLD - 1 })).toBe(below);
    });
  });

  it('compares strings lexicographically', () => {
    expect(evaluate("'apple' < 'banana'")).toBe(true);
  });

  it('= is true for equal values', () => {
    expect(evaluate("'a' = 'a'")).toBe(true);
  });

  it('= is false for different values', () => {
    expect(evaluate('1 = 2')).toBe(false);
  });

  it('= does not coerce types', () => {
    expect(evaluate("1 = '1'")).toBe(false);
  });

  it('<> is true for different values', () => {
    expect(evaluate('1 <> 2')).toBe(true);
  });

  it('<> is false for equal values', () => {
    expect(evaluate('1 <> 1')).toBe(false);
  });

  it('<> does not coerce types', () => {
    expect(evaluate("'1' <> 1")).toBe(true);
  });

  it('gives arithmetic precedence over comparison', () => {
    expect(evaluate('1 + 2 = 3')).toBe(true);
  });

  it('gives ordering comparisons precedence over equality', () => {
    // parsed as false = (1 > 2); the other grouping (false = 1) > 2 would be false
    expect(evaluate('false = 1 > 2')).toBe(true);
  });

  it('applies equality left to right', () => {
    expect(evaluate('1 <> 2 = true')).toBe(true);
  });
});

describe('logical operators', () => {
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

  it('and returns the right operand when the left is truthy', () => {
    expect(evaluateObject('a and b', { a: 1, b: 2 })).toBe(2);
  });

  it('and returns the left operand when it is falsy', () => {
    expect(evaluateObject('a and b', { a: 0, b: 2 })).toBe(0);
  });

  it('or returns the left operand when it is truthy', () => {
    expect(evaluateObject('a or b', { a: 'first', b: 'second' })).toBe('first');
  });

  it('or returns the right operand when the left is falsy', () => {
    expect(evaluateObject('a or b', { a: 0, b: 'fallback' })).toBe('fallback');
  });

  it('and short-circuits without evaluating the right side', () => {
    const context = vi.fn();

    evaluate('false and x', context);

    expect(context).not.toHaveBeenCalled();
  });

  it('or short-circuits without evaluating the right side', () => {
    const context = vi.fn();

    evaluate('true or x', context);

    expect(context).not.toHaveBeenCalled();
  });

  it('gives comparisons precedence over and', () => {
    expect(evaluate('1 < 2 and 2 < 3')).toBe(true);
  });

  it("applies 'or' before 'and' (or has the higher precedence)", () => {
    // parsed as (true or false) and false; with standard SQL precedence this would be true
    expect(evaluate('true or false and false')).toBe(false);
  });

  it('reads keywords case-insensitively', () => {
    expect(evaluate('TRUE Or False')).toBe(true);
  });
});

describe('is null', () => {
  it('is null is true for null', () => {
    expect(evaluateObject('x is null', { x: null })).toBe(true);
  });

  it('is null is false for a falsy non-null value', () => {
    expect(evaluateObject('x is null', { x: 0 })).toBe(false);
  });

  it('is null is false for undefined', () => {
    expect(evaluateObject('x is null', {})).toBe(false);
  });

  it('is not null is false for null', () => {
    expect(evaluateObject('x is not null', { x: null })).toBe(false);
  });

  it('is not null is true for a falsy non-null value', () => {
    expect(evaluateObject('x is not null', { x: 0 })).toBe(true);
  });

  it('gives arithmetic precedence over is null', () => {
    expect(evaluateObject('x + 1 is null', { x: 1 })).toBe(false);
  });

  it('reports the offending token when is is not followed by null', () => {
    expect(() => evaluate("x is 'null'")).toThrow(
      'Expected null but got { type: STR, literal: null } as position: 6.',
    );
  });
});

describe('between', () => {
  const LOWER = 10;
  const UPPER = 20;
  const expression = `x between ${LOWER} and ${UPPER}`;

  it.each([
    { x: LOWER - 1, expected: false },
    { x: LOWER, expected: true },
    { x: UPPER, expected: true },
    { x: UPPER + 1, expected: false },
  ])('is $expected when x is $x', ({ x, expected }) => {
    expect(evaluateObject(expression, { x })).toBe(expected);
  });

  it('accepts decimal bounds', () => {
    expect(evaluateObject('x between 1.5 and 2.5', { x: 2 })).toBe(true);
  });

  it('applies arithmetic in the subject before between', () => {
    // (x + 1) between 1 and 10, with x + 1 = 11 falling just outside
    expect(evaluateObject('x + 1 between 1 and 10', { x: 10 })).toBe(false);
  });

  it('combines with a following and', () => {
    expect(evaluateObject('x between 1 and 10 and y = 1', { x: 5, y: 2 })).toBe(false);
  });

  it('rejects a non-numeric lower bound', () => {
    expect(() => evaluate("x between 'a' and 'z'")).toThrow(
      'Expected NUM but got { type: STR, literal: a } as position: 11.',
    );
  });

  it('rejects a non-numeric upper bound', () => {
    expect(() => evaluate('x between 1 and y')).toThrow(
      'Expected NUM but got { type: IDENT, literal: y } as position: 16.',
    );
  });

  it('requires and between the bounds', () => {
    expect(() => evaluate('x between 1 10')).toThrow(
      'Expected and but got { type: NUM, literal: 10 } as position: 12.',
    );
  });
});

describe('function calls', () => {
  it('length returns the length of a string', () => {
    expect(evaluate("length('abc')")).toBe(3);
  });

  it('length returns zero for an empty string', () => {
    expect(evaluate("length('')")).toBe(0);
  });

  it('length returns the length of an array from the context', () => {
    expect(evaluateObject('length(items)', { items: ['a', 'b'] })).toBe(2);
  });

  it('evaluates a full expression as the argument', () => {
    expect(evaluate("length('a' + 'bc')")).toBe(3);
  });

  it('binds the call tighter than arithmetic', () => {
    expect(evaluate("length('ab') * 2")).toBe(4);
  });

  it('can be used inside a comparison', () => {
    expect(evaluate("length('ab') > 2")).toBe(false);
  });

  it('rejects length with no arguments', () => {
    expect(() => evaluate('length()')).toThrow('Length function takes exactly one argument.');
  });

  it('rejects length with two arguments', () => {
    expect(() => evaluate("length('a', 'b')")).toThrow('Length function takes exactly one argument.');
  });

  it('rejects an unknown function', () => {
    expect(() => evaluate('foo(1)')).toThrow('Function foo not implemented');
  });

  it('rejects arguments that are not separated by a comma', () => {
    expect(() => evaluate('length(a b)')).toThrow(
      'Expected , or ) got { type: IDENT, literal: b } as position: 9.',
    );
  });

  it('rejects an unclosed argument list', () => {
    expect(() => evaluate('length(a')).toThrow(/^Expected , or \) got \{ type: EOF/);
  });
});

describe('case expressions', () => {
  it('returns the then-value of a true condition', () => {
    expect(evaluate('case when true then 1 end')).toBe(1);
  });

  it('returns false when no condition matches and there is no else', () => {
    expect(evaluate('case when false then 1 end')).toBe(false);
  });

  it('returns the else-value when no condition matches', () => {
    expect(evaluate('case when false then 1 else 2 end')).toBe(2);
  });

  it('treats a truthy non-boolean condition as a match', () => {
    expect(evaluate("case when 1 then 'yes' end")).toBe('yes');
  });

  it('treats a falsy non-boolean condition as a non-match', () => {
    expect(evaluate("case when 0 then 'yes' end")).toBe(false);
  });

  describe('with several conditions', () => {
    const BIG = 10;
    const MEDIUM = 5;
    const expression = `case when x > ${BIG} then 'big' when x > ${MEDIUM} then 'medium' else 'small' end`;

    it.each([
      { x: BIG + 1, expected: 'big' },
      { x: BIG, expected: 'medium' },
      { x: MEDIUM + 1, expected: 'medium' },
      { x: MEDIUM, expected: 'small' },
    ])('returns $expected when x is $x', ({ x, expected }) => {
      expect(evaluateObject(expression, { x })).toBe(expected);
    });
  });

  it('does not evaluate the then-branch of a non-matching condition', () => {
    const context = vi.fn();

    evaluate('case when false then x else 2 end', context);

    expect(context).not.toHaveBeenCalled();
  });

  it('does not evaluate the else-branch when a condition matched', () => {
    const context = vi.fn();

    evaluate('case when true then 1 else x end', context);

    expect(context).not.toHaveBeenCalled();
  });

  it('nests inside another case', () => {
    expect(evaluate('case when true then case when false then 1 else 2 end end')).toBe(2);
  });

  it('can be an operand of a binary operator', () => {
    expect(evaluate('case when true then 2 end * 3')).toBe(6);
  });

  it('reads the case keywords case-insensitively', () => {
    expect(evaluate('CASE WHEN TRUE THEN 1 ELSE 2 END')).toBe(1);
  });

  it('requires when right after case', () => {
    expect(() => evaluate('case end')).toThrow(
      'Expected when got { type: case, literal: case } as position: 0.',
    );
  });

  it('requires a condition after when', () => {
    expect(() => evaluate('case when then 1 end')).toThrow(
      'Unexpected start of expression: { type: then, literal: then } as position: 10.',
    );
  });

  it('requires then after the condition', () => {
    expect(() => evaluate('case when true 1 end')).toThrow(
      'Expected then but got { type: NUM, literal: 1 } as position: 15.',
    );
  });

  it('requires end or else after a then-value', () => {
    expect(() => evaluate('case when true then 1')).toThrow(/^Expected when but got \{ type: EOF/);
  });

  it('requires end after the else-value', () => {
    expect(() => evaluate('case when true then 1 else 2')).toThrow(/^Expected end but got \{ type: EOF/);
  });
});

describe('lexing', () => {
  it('skips tabs, newlines, carriage returns and spaces', () => {
    expect(evaluate(' 1\t+\n2\r+ 3 ')).toBe(6);
  });

  it('ignores tokens after a complete expression', () => {
    expect(evaluate('1 2')).toBe(1);
  });

  it("stops at a stray 'not' that cannot continue the expression", () => {
    expect(evaluate('5 not 3')).toBe(5);
  });

  it('rejects an illegal character after an operator, reporting its position', () => {
    expect(() => evaluate('1 + @')).toThrow(
      'Invalid input: { type: ILLEGAL, literal: @ } as position: 4.',
    );
  });

  it('rejects an illegal character at the start of the input', () => {
    expect(() => evaluate('@')).toThrow(
      'Unexpected start of expression: { type: ILLEGAL, literal: @ } as position: 0.',
    );
  });

  it('does not recognise != and stops at the illegal character', () => {
    // "!" is only ever seen as the lookahead token here, so it ends the expression instead of failing
    expect(evaluate('1 != 2')).toBe(1);
  });
});

describe('syntax errors', () => {
  it('rejects an empty expression', () => {
    expect(() => evaluate('')).toThrow(/^Unexpected start of expression: \{ type: EOF/);
  });

  it('has no unary minus', () => {
    expect(() => evaluate('-1')).toThrow(
      'Unexpected start of expression: { type: -, literal: - } as position: 0.',
    );
  });

  it('has no unary not', () => {
    expect(() => evaluate('not true')).toThrow(
      'Unexpected start of expression: { type: not, literal: not } as position: 0.',
    );
  });

  it('has no null literal outside of is null', () => {
    expect(() => evaluate('x = null')).toThrow(
      'Unexpected start of expression: { type: null, literal: null } as position: 4.',
    );
  });

  it('rejects a missing right operand', () => {
    expect(() => evaluate('1 +')).toThrow(/^Unexpected start of expression: \{ type: EOF/);
  });

  it('rejects empty parentheses', () => {
    expect(() => evaluate('()')).toThrow(
      'Unexpected start of expression: { type: ), literal: ) } as position: 1.',
    );
  });

  it('rejects an unclosed parenthesis', () => {
    expect(() => evaluate('(1 + 2')).toThrow(/^Expected \) but got \{ type: EOF/);
  });

  it('rejects a parenthesis closed by the wrong token', () => {
    expect(() => evaluate('(1 2)')).toThrow(
      'Expected ) but got { type: NUM, literal: 2 } as position: 3.',
    );
  });
});

describe('combined where-clause style expressions', () => {
  const expression = "status = 'active' and age between 18 and 65 and length(tags) > 0";

  it('is true when every clause holds', () => {
    expect(evaluateObject(expression, { status: 'active', age: 30, tags: ['x'] })).toBe(true);
  });

  it('is false when the last clause fails', () => {
    expect(evaluateObject(expression, { status: 'active', age: 30, tags: [] })).toBe(false);
  });
});

describe('parse', () => {
  it('parses an identifier', () => {
    expect(parse('x')).toStrictEqual(new IdentifierExpression('x'));
  });

  it('parses a number literal', () => {
    expect(parse('1.5')).toStrictEqual(new ValueExpression(1.5));
  });

  it('parses a string literal', () => {
    expect(parse("'hi'")).toStrictEqual(new ValueExpression('hi'));
  });

  it('parses true', () => {
    expect(parse('true')).toStrictEqual(new ValueExpression(true));
  });

  it('parses false', () => {
    expect(parse('false')).toStrictEqual(new ValueExpression(false));
  });

  it('does not add a node for parentheses', () => {
    expect(parse('(x)')).toStrictEqual(new IdentifierExpression('x'));
  });

  it('parses a binary expression respecting precedence', () => {
    expect(parse('1 + 2 * 3')).toStrictEqual(
      new BinaryExpression(
        TokenType.Plus,
        new ValueExpression(1),
        new BinaryExpression(TokenType.Mul, new ValueExpression(2), new ValueExpression(3)),
      ),
    );
  });

  it('parses is null as an equality with a null value', () => {
    expect(parse('x is null')).toStrictEqual(
      new BinaryExpression(TokenType.Eq, new IdentifierExpression('x'), new ValueExpression(null)),
    );
  });

  it('parses is not null as an inequality with a null value', () => {
    expect(parse('x is not null')).toStrictEqual(
      new BinaryExpression(TokenType.Neq, new IdentifierExpression('x'), new ValueExpression(null)),
    );
  });

  it('desugars between into two comparisons joined by and', () => {
    expect(parse('x between 1 and 10')).toStrictEqual(
      new BinaryExpression(
        TokenType.And,
        new BinaryExpression(TokenType.Gte, new IdentifierExpression('x'), new ValueExpression(1)),
        new BinaryExpression(TokenType.Lte, new IdentifierExpression('x'), new ValueExpression(10)),
      ),
    );
  });

  it('parses a function call with several arguments', () => {
    expect(parse('foo(1, y)')).toStrictEqual(
      new FunctionCallExpression('foo', [new ValueExpression(1), new IdentifierExpression('y')]),
    );
  });

  it('parses a function call with no arguments', () => {
    expect(parse('foo()')).toStrictEqual(new FunctionCallExpression('foo', []));
  });

  it('parses a case expression with an else branch', () => {
    expect(parse("case when x then 'a' else 'b' end")).toStrictEqual(
      new CaseExpression(
        [{ when: new IdentifierExpression('x'), then: new ValueExpression('a') }],
        new ValueExpression('b'),
      ),
    );
  });

  it('parses a case expression without an else branch', () => {
    expect(parse('case when x then 1 when y then 2 end')).toStrictEqual(
      new CaseExpression([
        { when: new IdentifierExpression('x'), then: new ValueExpression(1) },
        { when: new IdentifierExpression('y'), then: new ValueExpression(2) },
      ]),
    );
  });
});

describe('evaluate with AST nodes the parser never produces', () => {
  it('rejects a binary operator it does not implement', () => {
    vi.mocked(parse).mockReturnValueOnce(
      new BinaryExpression(TokenType.Not, new ValueExpression(1), new ValueExpression(2)),
    );

    expect(() => evaluate('ignored')).toThrow('Operator not not implemented');
  });

  it('rejects an AST node type it does not know', () => {
    vi.mocked(parse).mockReturnValueOnce(new UnaryExpression(TokenType.Minus, new ValueExpression(1)));

    expect(() => evaluate('ignored')).toThrow('Invalid AST node');
  });
});
