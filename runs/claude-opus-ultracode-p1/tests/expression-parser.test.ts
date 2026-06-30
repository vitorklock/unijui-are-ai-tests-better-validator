import { describe, it, expect } from 'vitest';
import { evaluate, evaluateObject } from '../src/evaluator';
import { parse } from '../src/parser';
import { TokenType } from '../src/token';

/**
 * Tests for the expression parser / evaluator.
 *
 * Public API under test:
 *   - parse(expression)              -> AST                       (src/parser.ts)
 *   - evaluate(expression, context?) -> value                     (src/evaluator.ts)
 *   - evaluateObject(expression, value) -> value                  (src/evaluator.ts)
 *
 * These tests pin down the *actual* observed behaviour of the implementation.
 * Several blocks document behaviours that are surprising for a tool whose stated
 * goal is "SQL-like WHERE clauses"; those are called out with `QUIRK:` comments.
 */

// --- tiny builders so expected ASTs stay readable -------------------------

const value = (v: unknown) => ({ value: v, type: 'ValueExpression' });
const ident = (name: string) => ({ name, type: 'IdentifierExpression' });
const bin = (operator: TokenType, left: unknown, right: unknown) => ({
  operator,
  left,
  right,
  type: 'BinaryExpression',
});
const call = (name: string, args: unknown[]) => ({ name, args, type: 'FunctionCallExpression' });
const caseExpr = (conditions: unknown[], last?: unknown) => ({
  conditions,
  last,
  type: 'CaseExpression',
});

// A context that throws if it is ever consulted — used to prove that an
// identifier was NOT evaluated (short-circuit / lazy evaluation).
const throwingContext = (name: string): never => {
  throw new Error(`evaluated-identifier:${name}`);
};

// =========================================================================
// parse() — AST shape
// =========================================================================

describe('parse() — literals', () => {
  it('parses an identifier', () => {
    expect(parse('x')).toEqual(ident('x'));
  });

  it('parses an identifier with underscores', () => {
    expect(parse('my_var')).toEqual(ident('my_var'));
  });

  it('parses an integer literal', () => {
    expect(parse('42')).toEqual(value(42));
  });

  it('parses a decimal literal', () => {
    expect(parse('1.5')).toEqual(value(1.5));
  });

  it('parses a leading-dot decimal literal', () => {
    expect(parse('.5')).toEqual(value(0.5));
  });

  it('parses a single-quoted string literal', () => {
    expect(parse("'hi'")).toEqual(value('hi'));
  });

  it('parses a double-quoted string literal', () => {
    expect(parse('"hi"')).toEqual(value('hi'));
  });

  it('parses boolean literals', () => {
    expect(parse('true')).toEqual(value(true));
    expect(parse('false')).toEqual(value(false));
  });
});

describe('parse() — arithmetic precedence and associativity', () => {
  it('binds * tighter than + on the right', () => {
    expect(parse('1 + 2 * 3')).toEqual(bin(TokenType.Plus, value(1), bin(TokenType.Mul, value(2), value(3))));
  });

  it('binds * tighter than + on the left', () => {
    expect(parse('1 * 2 + 3')).toEqual(bin(TokenType.Plus, bin(TokenType.Mul, value(1), value(2)), value(3)));
  });

  it('is left-associative for subtraction', () => {
    expect(parse('10 - 3 - 2')).toEqual(bin(TokenType.Minus, bin(TokenType.Minus, value(10), value(3)), value(2)));
  });

  it('is left-associative for division', () => {
    expect(parse('8 / 4 / 2')).toEqual(bin(TokenType.Div, bin(TokenType.Div, value(8), value(4)), value(2)));
  });

  it('lets parentheses override precedence', () => {
    expect(parse('(1 + 2) * 3')).toEqual(bin(TokenType.Mul, bin(TokenType.Plus, value(1), value(2)), value(3)));
  });
});

describe('parse() — comparison operators', () => {
  it('parses a greater-than comparison', () => {
    expect(parse('5 > 3')).toEqual(bin(TokenType.Gt, value(5), value(3)));
  });

  it('parses every comparison operator to its token type', () => {
    const op = (expr: string) => (parse(expr) as { operator: TokenType }).operator;
    expect(op('a = b')).toBe(TokenType.Eq);
    expect(op('a <> b')).toBe(TokenType.Neq);
    expect(op('a > b')).toBe(TokenType.Gt);
    expect(op('a >= b')).toBe(TokenType.Gte);
    expect(op('a < b')).toBe(TokenType.Lt);
    expect(op('a <= b')).toBe(TokenType.Lte);
  });

  it('puts AND looser than comparison (a = 1 and b = 2)', () => {
    expect(parse('a = 1 and b = 2')).toEqual(
      bin(TokenType.And, bin(TokenType.Eq, ident('a'), value(1)), bin(TokenType.Eq, ident('b'), value(2))),
    );
  });
});

describe('parse() — logical precedence', () => {
  // QUIRK: in this parser OR binds *tighter* than AND (precedence and=1, or=2),
  // which is the opposite of standard SQL. `a and b or c` therefore groups as
  // `a AND (b OR c)`, not `(a AND b) OR c`.
  it('groups "a and b or c" as a AND (b OR c)', () => {
    expect(parse('a and b or c')).toEqual(
      bin(TokenType.And, ident('a'), bin(TokenType.Or, ident('b'), ident('c'))),
    );
  });

  it('groups "a or b and c" as (a OR b) AND c', () => {
    expect(parse('a or b and c')).toEqual(
      bin(TokenType.And, bin(TokenType.Or, ident('a'), ident('b')), ident('c')),
    );
  });
});

describe('parse() — "is null" desugaring', () => {
  it('rewrites "x is null" to (x = null)', () => {
    expect(parse('x is null')).toEqual(bin(TokenType.Eq, ident('x'), value(null)));
  });

  it('rewrites "x is not null" to (x <> null)', () => {
    expect(parse('x is not null')).toEqual(bin(TokenType.Neq, ident('x'), value(null)));
  });
});

describe('parse() — "between" desugaring', () => {
  it('rewrites "x between 1 and 5" to (x >= 1) and (x <= 5)', () => {
    expect(parse('x between 1 and 5')).toEqual(
      bin(
        TokenType.And,
        bin(TokenType.Gte, ident('x'), value(1)),
        bin(TokenType.Lte, ident('x'), value(5)),
      ),
    );
  });

  // QUIRK: BETWEEN bounds must be numeric literals — identifiers/expressions throw.
  it('throws when the bounds are not numeric literals', () => {
    expect(() => parse('x between a and b')).toThrow(/Expected NUM/);
    expect(() => parse('x between 1 and y')).toThrow(/Expected NUM/);
  });
});

describe('parse() — function calls', () => {
  it('parses a single-argument call', () => {
    expect(parse('length(name)')).toEqual(call('length', [ident('name')]));
  });

  it('parses a zero-argument call', () => {
    expect(parse('length()')).toEqual(call('length', []));
  });

  it('parses a call whose argument is an expression', () => {
    expect(parse('length(a + b)')).toEqual(
      call('length', [bin(TokenType.Plus, ident('a'), ident('b'))]),
    );
  });

  // QUIRK: multi-argument calls are not supported — the comma is never consumed,
  // so parsing fails as soon as a second argument is reached.
  it('throws on multiple arguments', () => {
    expect(() => parse('foo(1, 2)')).toThrow(/Unexpected start of expression/);
  });
});

describe('parse() — case expressions', () => {
  it('parses a single when/then with no else', () => {
    expect(parse('case when x then y end')).toEqual(
      caseExpr([{ when: ident('x'), then: ident('y') }], undefined),
    );
  });

  it('parses a when/then with an else branch', () => {
    expect(parse('case when x then y else z end')).toEqual(
      caseExpr([{ when: ident('x'), then: ident('y') }], ident('z')),
    );
  });

  it('parses multiple when/then branches', () => {
    expect(parse('case when a then b when c then d end')).toEqual(
      caseExpr(
        [
          { when: ident('a'), then: ident('b') },
          { when: ident('c'), then: ident('d') },
        ],
        undefined,
      ),
    );
  });

  it('requires at least one "when"', () => {
    expect(() => parse('case else 1 end')).toThrow(/Expected when/);
  });
});

describe('parse() — error handling', () => {
  it('throws on empty input', () => {
    expect(() => parse('')).toThrow(/Unexpected start of expression/);
  });

  it('throws when an operator has no left operand', () => {
    expect(() => parse('+')).toThrow(/Unexpected start of expression/);
  });

  it('throws when an operator has no right operand', () => {
    expect(() => parse('1 +')).toThrow(/Unexpected start of expression/);
  });

  it('throws on an unclosed parenthesis', () => {
    expect(() => parse('(1 + 2')).toThrow(/Expected \)/);
  });

  it('throws "Invalid input" on an illegal character within an expression', () => {
    expect(() => parse('1 + @')).toThrow(/Invalid input/);
  });

  it('throws when an expression starts with an illegal character', () => {
    expect(() => parse('@')).toThrow(/Unexpected start of expression/);
  });

  // QUIRK: an illegal token that appears *after* an otherwise complete expression
  // is silently ignored (it has no infix parser, so parsing just stops).
  it('silently ignores a trailing illegal token', () => {
    expect(parse('1 @ 2')).toEqual(value(1));
  });

  // QUIRK: there is no prefix parser for NOT, so it cannot be used.
  it('throws because prefix NOT is unsupported', () => {
    expect(() => parse('not true')).toThrow(/Unexpected start of expression/);
  });

  // QUIRK: there is no prefix parser for unary minus.
  it('throws on a unary minus', () => {
    expect(() => parse('-5')).toThrow(/Unexpected start of expression/);
  });
});

// =========================================================================
// evaluate() — evaluation of self-contained expressions
// =========================================================================

describe('evaluate() — arithmetic', () => {
  it('adds', () => expect(evaluate('1 + 2')).toBe(3));
  it('respects precedence', () => expect(evaluate('2 + 3 * 4')).toBe(14));
  it('respects parentheses', () => expect(evaluate('(2 + 3) * 4')).toBe(20));
  it('subtracts and divides left-to-right', () => expect(evaluate('10 / 2 - 3')).toBe(2));
  it('produces fractional results', () => expect(evaluate('7 / 2')).toBe(3.5));
  it('is left-associative for subtraction', () => expect(evaluate('10 - 3 - 2')).toBe(5));
  it('handles leading-dot decimals', () => expect(evaluate('.5')).toBe(0.5));
  it('adds decimals', () => expect(evaluate('1.5 + 2.5')).toBe(4));
});

describe('evaluate() — strings', () => {
  it('concatenates with +', () => expect(evaluate("'a' + 'b'")).toBe('ab'));
  it('evaluates a double-quoted literal', () => expect(evaluate('"hello"')).toBe('hello'));
  it('evaluates a single-quoted literal', () => expect(evaluate("'world'")).toBe('world'));
  it('compares strings lexicographically', () => expect(evaluate("'a' < 'b'")).toBe(true));

  // QUIRK: an unterminated string is accepted and read to end-of-input.
  it('accepts an unterminated string literal', () => {
    expect(evaluate("'abc")).toBe('abc');
  });
});

describe('evaluate() — booleans and keyword casing', () => {
  it('evaluates literal booleans', () => {
    expect(evaluate('true')).toBe(true);
    expect(evaluate('false')).toBe(false);
  });

  it('treats boolean keywords case-insensitively', () => {
    expect(evaluate('TRUE')).toBe(true);
    expect(evaluate('False')).toBe(false);
  });
});

describe('evaluate() — comparison operators', () => {
  it('evaluates >, <, =, <>, >=, <=', () => {
    expect(evaluate('5 > 3')).toBe(true);
    expect(evaluate('3 > 5')).toBe(false);
    expect(evaluate('5 = 5')).toBe(true);
    expect(evaluate('5 <> 3')).toBe(true);
    expect(evaluate('5 >= 5')).toBe(true);
    expect(evaluate('5 <= 4')).toBe(false);
    expect(evaluate('5 < 10')).toBe(true);
  });

  it('uses strict equality (= is ===)', () => {
    // (1 = 1) = 1  ->  true = 1  ->  true === 1  ->  false
    expect(evaluate('1 = 1 = 1')).toBe(false);
  });
});

describe('evaluate() — logical operators', () => {
  it('evaluates and / or as booleans', () => {
    expect(evaluate('true and false')).toBe(false);
    expect(evaluate('true or false')).toBe(true);
    expect(evaluate('1 = 1 and 2 = 2')).toBe(true);
  });

  // QUIRK: and/or use JS && / || and return the *operand value*, not a boolean.
  it('returns operand values from and / or (JS truthiness)', () => {
    expect(evaluate('1 and 2')).toBe(2);
    expect(evaluate('0 or 5')).toBe(5);
  });

  // QUIRK: OR binds tighter than AND, so this groups as (true or false) and false.
  it('groups logical operators with OR tighter than AND', () => {
    expect(evaluate('true or false and false')).toBe(false);
  });
});

describe('evaluate() — is null / between / case (no context)', () => {
  it('evaluates "is null" against a literal', () => {
    expect(evaluate('5 is null')).toBe(false);
  });

  it('evaluates "between" against literals', () => {
    expect(evaluate('1 between 1 and 5')).toBe(true);
    expect(evaluate('3 between 1 and 5')).toBe(true);
    expect(evaluate('6 between 1 and 5')).toBe(false);
  });

  it('returns the first matching "then"', () => {
    expect(evaluate('case when 1 > 2 then 10 when 3 > 2 then 20 else 30 end')).toBe(20);
  });

  it('returns the "else" branch when no condition matches', () => {
    expect(evaluate('case when false then 1 else 2 end')).toBe(2);
  });

  // QUIRK: a CASE with no matching branch and no ELSE evaluates to `false`.
  it('returns false when nothing matches and there is no else', () => {
    expect(evaluate('case when false then 1 end')).toBe(false);
  });
});

describe('evaluate() — built-in length function', () => {
  it('returns the length of a string', () => {
    expect(evaluate('length("hello")')).toBe(5);
    expect(evaluate("length('')")).toBe(0);
  });

  it('throws for an unknown function', () => {
    expect(() => evaluate('foo(1)')).toThrow(/Function foo not implemented/);
  });

  it('throws when length gets the wrong number of arguments', () => {
    expect(() => evaluate('length()')).toThrow(/Length function takes exactly one argument/);
  });
});

describe('evaluate() — runtime errors', () => {
  it('throws when an identifier is used without a context', () => {
    expect(() => evaluate('x')).toThrow(TypeError);
  });

  it('propagates parse errors', () => {
    expect(() => evaluate('(1 + 2')).toThrow(/Expected \)/);
  });
});

// =========================================================================
// evaluateObject() — context resolved from an object's properties
// =========================================================================

describe('evaluateObject() — property lookup', () => {
  it('resolves an identifier from the object', () => {
    expect(evaluateObject('x', { x: 42 })).toBe(42);
  });

  it('resolves multiple identifiers in arithmetic', () => {
    expect(evaluateObject('x + y', { x: 1, y: 2 })).toBe(3);
  });

  it('resolves a string property', () => {
    expect(evaluateObject('name', { name: 'Bob' })).toBe('Bob');
  });

  it('returns undefined for a missing property', () => {
    expect(evaluateObject('missing', {})).toBeUndefined();
  });

  it('passes object properties to length()', () => {
    expect(evaluateObject('length(name)', { name: 'Bob' })).toBe(3);
    expect(evaluateObject('length(items)', { items: [1, 2, 3] })).toBe(3);
  });
});

describe('evaluateObject() — is null with object values', () => {
  it('is true only for an exactly-null property', () => {
    expect(evaluateObject('x is null', { x: null })).toBe(true);
    expect(evaluateObject('x is null', { x: 5 })).toBe(false);
  });

  it('is the negation for "is not null"', () => {
    expect(evaluateObject('x is not null', { x: null })).toBe(false);
    expect(evaluateObject('x is not null', { x: 5 })).toBe(true);
  });

  // QUIRK: "is null" uses ===, so a *missing* (undefined) property is NOT null.
  it('treats a missing property as not null', () => {
    expect(evaluateObject('x is null', {})).toBe(false);
  });
});

describe('evaluateObject() — between with object values', () => {
  it('is inclusive on both bounds', () => {
    expect(evaluateObject('x between 1 and 10', { x: 1 })).toBe(true);
    expect(evaluateObject('x between 1 and 10', { x: 10 })).toBe(true);
    expect(evaluateObject('x between 1 and 10', { x: 5 })).toBe(true);
  });

  it('is false outside the bounds', () => {
    expect(evaluateObject('x between 1 and 10', { x: 0 })).toBe(false);
    expect(evaluateObject('x between 1 and 10', { x: 11 })).toBe(false);
  });
});

describe('evaluateObject() — logical operators return operand values', () => {
  it('returns the truthy operand from or', () => {
    expect(evaluateObject('a or b', { a: 0, b: 'hi' })).toBe('hi');
  });

  it('returns the last operand from and when both are truthy', () => {
    expect(evaluateObject('a and b', { a: 'x', b: 'y' })).toBe('y');
  });
});

describe('evaluateObject() — SQL-like WHERE clauses', () => {
  it('combines a comparison with a boolean flag', () => {
    expect(evaluateObject('active and age >= 18', { active: true, age: 21 })).toBe(true);
    expect(evaluateObject('active and age >= 18', { active: true, age: 10 })).toBe(false);
  });

  it('matches on an equality and a comparison', () => {
    expect(evaluateObject("name = 'Bob' and age > 18", { name: 'Bob', age: 25 })).toBe(true);
    expect(evaluateObject("name = 'Bob' and age > 18", { name: 'Alice', age: 25 })).toBe(false);
  });

  it('evaluates inequality with strings', () => {
    expect(evaluateObject("name <> 'Bob'", { name: 'Alice' })).toBe(true);
    expect(evaluateObject("name <> 'Bob'", { name: 'Bob' })).toBe(false);
  });

  // QUIRK: because OR binds tighter than AND, this groups as
  // (name = 'Bob' OR name = 'Al') AND age > 99 — which is false for Bob,
  // whereas standard SQL (AND tighter than OR) would return true.
  it('groups OR tighter than AND in a WHERE-style clause', () => {
    expect(
      evaluateObject("name = 'Bob' or name = 'Al' and age > 99", { name: 'Bob', age: 1 }),
    ).toBe(false);
  });

  it('evaluates a multi-branch CASE expression', () => {
    const grade = "case when score >= 90 then 'A' when score >= 80 then 'B' else 'C' end";
    expect(evaluateObject(grade, { score: 95 })).toBe('A');
    expect(evaluateObject(grade, { score: 85 })).toBe('B');
    expect(evaluateObject(grade, { score: 50 })).toBe('C');
  });
});

// =========================================================================
// evaluate() — custom context function (the `context?` parameter)
// =========================================================================

describe('evaluate() — context as a resolver function', () => {
  it('resolves identifiers through the supplied function', () => {
    const env: Record<string, unknown> = { x: 5, y: 3 };
    expect(evaluate('x + y', (name) => env[name])).toBe(8);
  });

  it('passes the identifier name to the resolver', () => {
    expect(evaluate('foo', (name) => name.toUpperCase())).toBe('FOO');
  });
});

// =========================================================================
// evaluate() — JavaScript value semantics (operators use raw JS operators)
// =========================================================================

describe('evaluate() — arithmetic type coercion', () => {
  // The evaluator applies raw JS operators, so operand types are coerced.
  it('coerces numeric strings for -, *, /', () => {
    expect(evaluate("'10' - 3")).toBe(7);
    expect(evaluate("'3' * 2")).toBe(6);
    expect(evaluate("'10' / '2'")).toBe(5);
  });

  it('overloads + as string concatenation when an operand is a string', () => {
    expect(evaluate("'hello' + 5")).toBe('hello5');
  });

  it('yields NaN for non-numeric string arithmetic', () => {
    expect(evaluate("'abc' - 1")).toBeNaN();
  });
});

describe('evaluate() — comparison type coercion', () => {
  it('coerces a numeric string to a number for comparison', () => {
    expect(evaluate("'10' > 5")).toBe(true);
  });

  it('is false when a non-numeric string coerces to NaN', () => {
    expect(evaluate("'abc' > 5")).toBe(false);
  });
});

describe('evaluate() — division by zero and NaN (raw IEEE results leak through)', () => {
  it('returns Infinity for division by zero', () => {
    expect(evaluate('5 / 0')).toBe(Infinity);
  });

  it('returns NaN for 0 / 0', () => {
    expect(evaluate('0 / 0')).toBeNaN();
  });

  it('reflects that NaN is never equal to itself', () => {
    expect(evaluate('0 / 0 = 0 / 0')).toBe(false);
    expect(evaluate('0 / 0 <> 0 / 0')).toBe(true);
  });
});

// =========================================================================
// evaluate() — short-circuit and lazy evaluation
// =========================================================================

describe('evaluate() — short-circuit logical operators', () => {
  it('does not evaluate the right operand of AND when the left is falsy', () => {
    expect(evaluate('false and x', throwingContext)).toBe(false);
  });

  it('does not evaluate the right operand of OR when the left is truthy', () => {
    expect(evaluate('true or x', throwingContext)).toBe(true);
  });

  it('does evaluate the right operand of AND when the left is truthy', () => {
    expect(() => evaluate('true and x', throwingContext)).toThrow(/evaluated-identifier:x/);
  });
});

describe('evaluate() — CASE evaluates branches lazily', () => {
  it('does not evaluate a "then" whose "when" did not match', () => {
    expect(evaluate('case when false then x else 2 end', throwingContext)).toBe(2);
  });

  it('does evaluate the "then" of the matching branch', () => {
    expect(() => evaluate('case when true then x else 2 end', throwingContext)).toThrow(
      /evaluated-identifier:x/,
    );
  });

  it('skips a branch whose "when" is falsy and takes a later truthy one', () => {
    expect(evaluate("case when 0 then 'a' when true then 'b' end")).toBe('b');
  });

  it('returns a falsy "then" value verbatim', () => {
    // Distinguishes a matched falsy result (0) from the no-match default (false).
    expect(evaluate('case when true then 0 else 1 end')).toBe(0);
  });

  it('evaluates nested CASE expressions', () => {
    const expr = 'case when x then case when y then 1 else 2 end else 3 end';
    expect(evaluateObject(expr, { x: true, y: false })).toBe(2);
    expect(evaluateObject(expr, { x: true, y: true })).toBe(1);
    expect(evaluateObject(expr, { x: false, y: true })).toBe(3);
  });
});

// =========================================================================
// length() — no type validation around args[0].length
// =========================================================================

describe('evaluate() — length() type handling', () => {
  it('counts array elements', () => {
    expect(evaluateObject('length(items)', { items: [1, 2, 3] })).toBe(3);
  });

  it('evaluates its argument before calling the function', () => {
    expect(evaluate("length('a' + 'b')")).toBe(2);
  });

  // QUIRK: there is no type guard — a number has no `.length`, so this returns
  // undefined rather than raising a meaningful error.
  it('returns undefined for a value with no .length (e.g. a number)', () => {
    expect(evaluate('length(5)')).toBeUndefined();
  });

  // QUIRK: null / undefined arguments produce a raw JS TypeError.
  it('throws a TypeError for a null argument', () => {
    expect(() => evaluateObject('length(x)', { x: null })).toThrow(/Cannot read properties of null/);
  });
});

// =========================================================================
// evaluateObject() — falsy property values pass through unchanged
// =========================================================================

describe('evaluateObject() — falsy values are returned, not defaulted', () => {
  it('returns 0, false and "" as-is', () => {
    expect(evaluateObject('x', { x: 0 })).toBe(0);
    expect(evaluateObject('x', { x: false })).toBe(false);
    expect(evaluateObject('x', { x: '' })).toBe('');
  });
});

// =========================================================================
// parse() — precedence interactions for IS / BETWEEN / OR-AND
// =========================================================================

describe('parse() — precedence interactions', () => {
  // QUIRK: IS (precedence 7) binds tighter than + (8) and = (4). The IS only
  // captures the literal `null` to its right, leaving surrounding operators
  // to wrap the resulting comparison.
  it('groups "x is null + 1" as (x is null) + 1', () => {
    expect(parse('x is null + 1')).toEqual(
      bin(TokenType.Plus, bin(TokenType.Eq, ident('x'), value(null)), value(1)),
    );
  });

  it('groups "a = 1 is null" as a = (1 is null)', () => {
    expect(parse('a = 1 is null')).toEqual(
      bin(TokenType.Eq, ident('a'), bin(TokenType.Eq, value(1), value(null))),
    );
  });

  // QUIRK: OR binds tighter than AND across a whole chain.
  it('groups "a or b and c or d" as (a or b) and (c or d)', () => {
    expect(parse('a or b and c or d')).toEqual(
      bin(
        TokenType.And,
        bin(TokenType.Or, ident('a'), ident('b')),
        bin(TokenType.Or, ident('c'), ident('d')),
      ),
    );
  });

  it('evaluates BETWEEN combined with AND in a larger predicate', () => {
    expect(evaluateObject('x between 1 and 5 and y = 3', { x: 3, y: 3 })).toBe(true);
    expect(evaluateObject('x between 1 and 5 and y = 3', { x: 9, y: 3 })).toBe(false);
  });

  it('accepts floating-point BETWEEN bounds', () => {
    expect(evaluateObject('x between 1.5 and 3.7', { x: 2 })).toBe(true);
    expect(evaluateObject('x between 1.5 and 3.7', { x: 4 })).toBe(false);
  });
});

// =========================================================================
// parse() — `null` is not a standalone literal
// =========================================================================

describe('parse() — null literal asymmetry', () => {
  // QUIRK: unlike true/false, there is no prefix parser for `null`; it is only
  // valid as the right-hand side of IS / IS NOT (see the "is null" tests).
  it('cannot parse a bare null', () => {
    expect(() => parse('null')).toThrow(/Unexpected start of expression/);
  });

  it('cannot evaluate a bare null even when upper-cased', () => {
    expect(() => evaluate('NULL')).toThrow(/Unexpected start of expression/);
  });

  it('cannot use null as a CASE result value', () => {
    expect(() => evaluate('case when true then null else 1 end')).toThrow(
      /Unexpected start of expression/,
    );
  });

  it('still resolves "is null" with mixed keyword casing', () => {
    expect(evaluateObject('x IS NULL', { x: null })).toBe(true);
  });
});

// =========================================================================
// parse() — silent truncation of trailing/unknown input
// =========================================================================

describe('parse() — trailing input is silently dropped', () => {
  // QUIRK: there is no end-of-input check. An unsupported operator lexes to an
  // illegal token with no infix parser, so parsing stops at the first complete
  // expression and the rest of the input is discarded WITHOUT error.
  it('drops an unsupported operator and everything after it', () => {
    expect(parse('x % 2')).toEqual(ident('x'));
    expect(parse('1 & 2')).toEqual(value(1));
    expect(evaluateObject('x % 2', { x: 5 })).toBe(5);
  });
});

// =========================================================================
// parse() — function-call edge cases
// =========================================================================

describe('parse() — function-call edge cases', () => {
  it('throws on a trailing comma in the argument list', () => {
    expect(() => parse('foo(1,)')).toThrow(/Unexpected start of expression/);
  });

  it('throws on empty parentheses used as a grouping', () => {
    expect(() => parse('()')).toThrow(/Unexpected start of expression/);
  });

  // QUIRK: `(...)( )` is parsed as a call whose callee is the grouped expression;
  // parseCallExpression reads `.name` off a non-identifier node, yielding
  // `name: undefined`, and evaluation then fails as an unknown function.
  it('builds a nameless call node for a non-identifier callee', () => {
    const ast = parse('(a + b)(c)') as { type: string; name?: string };
    expect(ast.type).toBe('FunctionCallExpression');
    expect(ast.name).toBeUndefined();
    expect(() => evaluateObject('(a + b)(c)', { a: 1, b: 2, c: 3 })).toThrow(
      /Function undefined not implemented/,
    );
  });
});

// =========================================================================
// parse() — incomplete CASE / IS / BETWEEN error messages
// =========================================================================

describe('parse() — incomplete constructs', () => {
  it('reports a missing branch/end when a CASE is cut off after "then"', () => {
    expect(() => parse('case when x then y')).toThrow(/Expected when/);
  });

  it('reports a missing END after an ELSE branch', () => {
    expect(() => parse('case when x then y else z')).toThrow(/Expected end/);
  });

  it('rejects IS with a non-null right-hand side', () => {
    expect(() => parse('x is false')).toThrow(/Expected null/);
    expect(() => parse('x is not false')).toThrow(/Expected null/);
  });

  it('rejects a negative BETWEEN bound (no unary minus before the literal)', () => {
    expect(() => parse('x between -1 and 5')).toThrow(/Expected NUM/);
  });
});

// =========================================================================
// Lexer-level behaviours observed through the public API
// =========================================================================

describe('lexer behaviour (via parse/evaluate)', () => {
  it('skips tabs and newlines as whitespace', () => {
    expect(evaluate('1\t+\n2')).toBe(3);
  });

  it('reads multi-character operators without surrounding spaces', () => {
    expect(parse('a<=b')).toEqual(bin(TokenType.Lte, ident('a'), ident('b')));
  });

  it('parses an empty string literal', () => {
    expect(parse("''")).toEqual(value(''));
  });

  it('treats the other quote character as a literal inside a string', () => {
    expect(parse('"it\'s"')).toEqual(value("it's"));
  });

  // QUIRK: a second dot ends the number; the leftover ".3" has no infix parser
  // and is silently dropped, so "1.2.3" evaluates to 1.2.
  it('stops a number literal at the second dot', () => {
    expect(evaluate('1.2.3')).toBe(1.2);
  });

  // QUIRK: a lone "." is lexed as a number whose value is Number('.') === NaN.
  it('produces NaN for a lone dot', () => {
    expect(evaluate('.')).toBeNaN();
  });
});
