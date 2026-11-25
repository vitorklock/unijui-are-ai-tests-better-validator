import { describe, expect, it, vi } from 'vitest';
import { evaluate, evaluateObject } from '../src/evaluator';
import { parse } from '../src/parser';
import {
  BinaryExpression,
  CaseExpression,
  FunctionCallExpression,
  IdentifierExpression,
  ValueExpression,
} from '../src/ast';
import { TokenType } from '../src/token';

const V = (value: unknown) => new ValueExpression(value);
const I = (name: string) => new IdentifierExpression(name);

/** A context that fails loudly if any identifier is looked up. */
const throwingContext = (name: string): never => {
  throw new Error(`identifier "${name}" should not have been evaluated`);
};

describe('parse()', () => {
  describe('literals and identifiers', () => {
    it.each([
      ['42', 42],
      ['3.14', 3.14],
      ['.5', 0.5],
      ['0', 0],
    ])('parses the number %s', (source, expected) => {
      expect(parse(source)).toEqual(V(expected));
    });

    it('parses single-quoted strings', () => {
      expect(parse("'hello world'")).toEqual(V('hello world'));
    });

    it('parses double-quoted strings', () => {
      expect(parse('"hello"')).toEqual(V('hello'));
    });

    it('parses boolean literals', () => {
      expect(parse('true')).toEqual(V(true));
      expect(parse('false')).toEqual(V(false));
    });

    it('parses identifiers', () => {
      expect(parse('foo')).toEqual(I('foo'));
      expect(parse('first_name')).toEqual(I('first_name'));
    });

    it('tags nodes with their type', () => {
      expect(parse('1').type).toBe('ValueExpression');
      expect(parse('x').type).toBe('IdentifierExpression');
      expect(parse('1 + 2').type).toBe('BinaryExpression');
      expect(parse('f(1)').type).toBe('FunctionCallExpression');
      expect(parse('case when true then 1 end').type).toBe('CaseExpression');
    });
  });

  describe('binary expressions', () => {
    it('builds a binary node for an infix operator', () => {
      expect(parse('1 + 2')).toEqual(new BinaryExpression(TokenType.Plus, V(1), V(2)));
    });

    it.each([
      ['-', TokenType.Minus],
      ['*', TokenType.Mul],
      ['/', TokenType.Div],
      ['=', TokenType.Eq],
      ['<>', TokenType.Neq],
      ['>', TokenType.Gt],
      ['>=', TokenType.Gte],
      ['<', TokenType.Lt],
      ['<=', TokenType.Lte],
      ['and', TokenType.And],
      ['or', TokenType.Or],
    ])('maps the operator %s to its token type', (op, tokenType) => {
      expect(parse(`a ${op} b`)).toEqual(new BinaryExpression(tokenType, I('a'), I('b')));
    });

    it('gives multiplication higher precedence than addition', () => {
      expect(parse('1 + 2 * 3')).toEqual(
        new BinaryExpression(TokenType.Plus, V(1), new BinaryExpression(TokenType.Mul, V(2), V(3))),
      );
    });

    it('lets parentheses override precedence', () => {
      expect(parse('(1 + 2) * 3')).toEqual(
        new BinaryExpression(TokenType.Mul, new BinaryExpression(TokenType.Plus, V(1), V(2)), V(3)),
      );
    });

    it('is left-associative for operators of equal precedence', () => {
      expect(parse('10 - 2 - 3')).toEqual(
        new BinaryExpression(TokenType.Minus, new BinaryExpression(TokenType.Minus, V(10), V(2)), V(3)),
      );
    });

    it('gives arithmetic higher precedence than comparison', () => {
      expect(parse('1 + 2 = 3')).toEqual(
        new BinaryExpression(TokenType.Eq, new BinaryExpression(TokenType.Plus, V(1), V(2)), V(3)),
      );
    });

    it('gives comparison higher precedence than logical operators', () => {
      expect(parse('a > 1 and b < 2')).toEqual(
        new BinaryExpression(
          TokenType.And,
          new BinaryExpression(TokenType.Gt, I('a'), V(1)),
          new BinaryExpression(TokenType.Lt, I('b'), V(2)),
        ),
      );
    });
  });

  describe('SQL-style operators', () => {
    it('desugars BETWEEN into a conjunction of two inclusive comparisons', () => {
      expect(parse('a between 1 and 5')).toEqual(
        new BinaryExpression(
          TokenType.And,
          new BinaryExpression(TokenType.Gte, I('a'), V(1)),
          new BinaryExpression(TokenType.Lte, I('a'), V(5)),
        ),
      );
    });

    it('desugars IS NULL into an equality against null', () => {
      expect(parse('a is null')).toEqual(new BinaryExpression(TokenType.Eq, I('a'), V(null)));
    });

    it('desugars IS NOT NULL into an inequality against null', () => {
      expect(parse('a is not null')).toEqual(new BinaryExpression(TokenType.Neq, I('a'), V(null)));
    });
  });

  describe('function calls', () => {
    it('parses a call with one argument', () => {
      expect(parse('length(a)')).toEqual(new FunctionCallExpression('length', [I('a')]));
    });

    it('parses a call with no arguments', () => {
      expect(parse('now()')).toEqual(new FunctionCallExpression('now', []));
    });

    it('parses a full expression as an argument', () => {
      expect(parse('length(a + b)')).toEqual(
        new FunctionCallExpression('length', [new BinaryExpression(TokenType.Plus, I('a'), I('b'))]),
      );
    });
  });

  describe('case expressions', () => {
    it('parses WHEN/THEN branches and an ELSE branch', () => {
      expect(parse("case when a then 'x' when b then 'y' else 'z' end")).toEqual(
        new CaseExpression(
          [
            { when: I('a'), then: V('x') },
            { when: I('b'), then: V('y') },
          ],
          V('z'),
        ),
      );
    });

    it('leaves the ELSE branch undefined when absent', () => {
      expect(parse('case when a then 1 end')).toEqual(new CaseExpression([{ when: I('a'), then: V(1) }]));
    });
  });
});

describe('evaluate()', () => {
  describe('literals', () => {
    it.each([
      ['42', 42],
      ['3.14', 3.14],
      ['.5', 0.5],
      ['1000000', 1000000],
    ])('evaluates the number %s', (source, expected) => {
      expect(evaluate(source)).toBe(expected);
    });

    it('evaluates string literals with either quote style', () => {
      expect(evaluate("'hello'")).toBe('hello');
      expect(evaluate('"hello"')).toBe('hello');
    });

    it('allows the other quote character inside a string', () => {
      expect(evaluate('"it\'s"')).toBe("it's");
      expect(evaluate("'say \"hi\"'")).toBe('say "hi"');
    });

    it('evaluates the empty string', () => {
      expect(evaluate("''")).toBe('');
    });

    it('evaluates boolean literals', () => {
      expect(evaluate('true')).toBe(true);
      expect(evaluate('false')).toBe(false);
    });
  });

  describe('arithmetic', () => {
    it.each([
      ['1 + 2', 3],
      ['10 - 4', 6],
      ['3 * 4', 12],
      ['10 / 4', 2.5],
      ['0 - 5', -5],
      ['1 / 0', Infinity],
    ])('%s = %s', (source, expected) => {
      expect(evaluate(source)).toBe(expected);
    });

    it.each([
      ['1 + 2 * 3', 7],
      ['(1 + 2) * 3', 9],
      ['2 * 3 + 4', 10],
      ['2 * (3 + 4)', 14],
      ['10 - 2 - 3', 5],
      ['1 - 2 + 3', 2],
      ['100 / 10 / 2', 5],
      ['2 + 3 * 4 - 6 / 2', 11],
      ['((1 + 2) * (3 + 4))', 21],
    ])('respects precedence and associativity: %s = %s', (source, expected) => {
      expect(evaluate(source)).toBe(expected);
    });

    it('handles decimal arithmetic', () => {
      expect(evaluate('0.1 + 0.2')).toBeCloseTo(0.3);
      expect(evaluate('.5 + .5')).toBe(1);
      expect(evaluate('3.14 * 2')).toBeCloseTo(6.28);
    });

    it('concatenates strings with +', () => {
      expect(evaluate("'foo' + 'bar'")).toBe('foobar');
    });
  });

  describe('comparison', () => {
    it.each([
      ['1 = 1', true],
      ['1 = 2', false],
      ['1 <> 2', true],
      ['1 <> 1', false],
      ['2 > 1', true],
      ['1 > 2', false],
      ['1 < 2', true],
      ['2 < 1', false],
      ['2 >= 2', true],
      ['3 >= 2', true],
      ['1 >= 2', false],
      ['2 <= 2', true],
      ['1 <= 2', true],
      ['3 <= 2', false],
    ])('%s is %s', (source, expected) => {
      expect(evaluate(source)).toBe(expected);
    });

    it('compares strings', () => {
      expect(evaluate("'a' = 'a'")).toBe(true);
      expect(evaluate("'a' = 'b'")).toBe(false);
      expect(evaluate("'a' <> 'b'")).toBe(true);
      expect(evaluate("'apple' < 'banana'")).toBe(true);
    });

    it('compares booleans', () => {
      expect(evaluate('true = true')).toBe(true);
      expect(evaluate('true = false')).toBe(false);
      expect(evaluate('true <> false')).toBe(true);
    });

    it('uses strict equality and does not coerce types', () => {
      expect(evaluate("1 = '1'")).toBe(false);
      expect(evaluate("1 <> '1'")).toBe(true);
    });

    it('evaluates arithmetic before comparing', () => {
      expect(evaluate('1 + 1 = 2')).toBe(true);
      expect(evaluate('2 * 3 > 5')).toBe(true);
      expect(evaluate('10 - 5 <= 4')).toBe(false);
    });

    it('evaluates relational operators before equality', () => {
      expect(evaluate('10 > 5 = true')).toBe(true);
      expect(evaluate('1 < 2 = false')).toBe(false);
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
    ])('%s is %s', (source, expected) => {
      expect(evaluate(source)).toBe(expected);
    });

    it('combines comparisons', () => {
      expect(evaluate('1 = 1 and 2 = 2')).toBe(true);
      expect(evaluate('1 = 1 and 2 = 3')).toBe(false);
      expect(evaluate('1 = 2 or 2 = 2')).toBe(true);
      expect(evaluate('1 = 2 or 2 = 3')).toBe(false);
    });

    it('chains several operands', () => {
      expect(evaluate('1 < 2 and 2 < 3 and 3 < 4')).toBe(true);
      expect(evaluate('1 < 2 and 2 < 3 and 3 > 4')).toBe(false);
      expect(evaluate('1 = 2 or 2 = 3 or 3 = 3')).toBe(true);
    });

    it('respects parentheses', () => {
      expect(evaluate('(1 = 2 or 2 = 2) and 3 = 3')).toBe(true);
      expect(evaluate('(1 = 2 or 2 = 2) and 3 = 4')).toBe(false);
      expect(evaluate('1 = 2 or (2 = 2 and 3 = 3)')).toBe(true);
    });

    it('short-circuits AND when the left side is false', () => {
      expect(evaluate('false and boom', throwingContext)).toBe(false);
      expect(evaluate('1 = 2 and boom > 1', throwingContext)).toBe(false);
    });

    it('short-circuits OR when the left side is true', () => {
      expect(evaluate('true or boom', throwingContext)).toBe(true);
      expect(evaluate('1 = 1 or boom > 1', throwingContext)).toBe(true);
    });

    it('does evaluate the right side when needed', () => {
      expect(() => evaluate('true and boom', throwingContext)).toThrow(/boom/);
      expect(() => evaluate('false or boom', throwingContext)).toThrow(/boom/);
    });

    it('follows JavaScript truthiness for non-boolean operands', () => {
      expect(evaluate('1 and 2')).toBe(2);
      expect(evaluate('0 and 2')).toBe(0);
      expect(evaluate('0 or 5')).toBe(5);
      expect(evaluate("'' or 'fallback'")).toBe('fallback');
    });
  });

  describe('BETWEEN', () => {
    it.each([
      ['5 between 1 and 10', true],
      ['1 between 1 and 10', true],
      ['10 between 1 and 10', true],
      ['0 between 1 and 10', false],
      ['11 between 1 and 10', false],
      ['2.5 between 2 and 3', true],
      ['2.5 between 2.6 and 3', false],
    ])('%s is %s', (source, expected) => {
      expect(evaluate(source)).toBe(expected);
    });

    it('works with an identifier on the left', () => {
      expect(evaluateObject('age between 18 and 65', { age: 30 })).toBe(true);
      expect(evaluateObject('age between 18 and 65', { age: 17 })).toBe(false);
      expect(evaluateObject('age between 18 and 65', { age: 65 })).toBe(true);
    });

    it('can be combined with other conditions', () => {
      expect(evaluateObject('age between 18 and 65 and active = true', { age: 30, active: true })).toBe(true);
      expect(evaluateObject('age between 18 and 65 and active = true', { age: 30, active: false })).toBe(false);
      expect(evaluateObject('age between 18 and 65 or vip = true', { age: 90, vip: true })).toBe(true);
    });
  });

  describe('IS NULL / IS NOT NULL', () => {
    it('detects null values', () => {
      expect(evaluateObject('x is null', { x: null })).toBe(true);
      expect(evaluateObject('x is null', { x: 0 })).toBe(false);
      expect(evaluateObject('x is null', { x: '' })).toBe(false);
    });

    it('detects non-null values', () => {
      expect(evaluateObject('x is not null', { x: 0 })).toBe(true);
      expect(evaluateObject('x is not null', { x: 'a' })).toBe(true);
      expect(evaluateObject('x is not null', { x: null })).toBe(false);
    });

    it('can be combined with other conditions', () => {
      expect(evaluateObject('x is null or x = 0', { x: null })).toBe(true);
      expect(evaluateObject('x is null or x = 0', { x: 0 })).toBe(true);
      expect(evaluateObject('x is null or x = 0', { x: 1 })).toBe(false);
      expect(evaluateObject('x is not null and y is not null', { x: 1, y: null })).toBe(false);
    });
  });

  describe('CASE expressions', () => {
    const grade = "case when score >= 90 then 'A' when score >= 80 then 'B' else 'C' end";

    it('returns the THEN value of the first matching branch', () => {
      expect(evaluateObject(grade, { score: 95 })).toBe('A');
      expect(evaluateObject(grade, { score: 90 })).toBe('A');
      expect(evaluateObject(grade, { score: 85 })).toBe('B');
    });

    it('returns the ELSE value when no branch matches', () => {
      expect(evaluateObject(grade, { score: 50 })).toBe('C');
    });

    it('returns false when no branch matches and there is no ELSE', () => {
      expect(evaluate('case when false then 1 end')).toBe(false);
      expect(evaluateObject('case when score > 10 then 1 end', { score: 5 })).toBe(false);
    });

    it('works with a single branch and ELSE', () => {
      expect(evaluate("case when true then 'yes' else 'no' end")).toBe('yes');
      expect(evaluate("case when false then 'yes' else 'no' end")).toBe('no');
    });

    it('only evaluates the branch that is taken', () => {
      expect(evaluate('case when true then 1 else boom end', throwingContext)).toBe(1);
      expect(evaluate('case when false then boom else 2 end', throwingContext)).toBe(2);
      expect(evaluate('case when true then 1 when boom then 2 end', throwingContext)).toBe(1);
    });

    it('supports nested CASE expressions', () => {
      const nested = 'case when x then case when y then 1 else 2 end else 3 end';
      expect(evaluateObject(nested, { x: true, y: true })).toBe(1);
      expect(evaluateObject(nested, { x: true, y: false })).toBe(2);
      expect(evaluateObject(nested, { x: false, y: true })).toBe(3);
    });

    it('can be used as an operand in a larger expression', () => {
      expect(evaluate('case when true then 1 else 2 end + 10')).toBe(11);
      expect(evaluate('case when false then 1 else 2 end * 10')).toBe(20);
      expect(evaluate('case when true then 5 else 0 end > 3')).toBe(true);
    });

    it('allows full expressions in WHEN and THEN', () => {
      expect(evaluateObject('case when a + b > 10 then a * b else a - b end', { a: 6, b: 5 })).toBe(30);
      expect(evaluateObject('case when a + b > 10 then a * b else a - b end', { a: 2, b: 5 })).toBe(-3);
    });
  });

  describe('functions', () => {
    it('length() returns the length of a string', () => {
      expect(evaluate("length('abc')")).toBe(3);
      expect(evaluate("length('')")).toBe(0);
    });

    it('length() returns the length of an array', () => {
      expect(evaluateObject('length(items)', { items: ['a', 'b', 'c'] })).toBe(3);
      expect(evaluateObject('length(items)', { items: [] })).toBe(0);
    });

    it('evaluates the argument expression before calling', () => {
      expect(evaluate("length('ab' + 'cd')")).toBe(4);
    });

    it('resolves identifiers in arguments through the context', () => {
      const ctx = vi.fn((_name: string) => 'Alice');
      expect(evaluate('length(name)', ctx)).toBe(5);
      expect(ctx).toHaveBeenCalledWith('name');
    });

    it('can be used inside a larger expression', () => {
      expect(evaluate("length('abc') = 3")).toBe(true);
      expect(evaluateObject('length(name) > 3', { name: 'Alice' })).toBe(true);
      expect(evaluateObject('length(name) > 3', { name: 'Al' })).toBe(false);
      expect(evaluate("length('ab') + length('cde')")).toBe(5);
    });

    it('throws when length() receives no argument', () => {
      expect(() => evaluate('length()')).toThrow(/exactly one argument/);
    });

    it('throws for an unknown function', () => {
      expect(() => evaluateObject('upper(x)', { x: 'a' })).toThrow(/Function upper not implemented/);
    });
  });

  describe('identifiers and context', () => {
    it('resolves identifiers via the context function', () => {
      expect(evaluate('x', () => 7)).toBe(7);
      expect(evaluate('x * 2', () => 21)).toBe(42);
    });

    it('passes the exact identifier name to the context', () => {
      const values: Record<string, unknown> = { a: 1, b: 2, Name: 'n', first_name: 'f' };
      const ctx = vi.fn((name: string) => values[name]);

      expect(evaluate('a + b', ctx)).toBe(3);
      expect(ctx).toHaveBeenCalledWith('a');
      expect(ctx).toHaveBeenCalledWith('b');

      ctx.mockClear();
      expect(evaluate('Name', ctx)).toBe('n');
      expect(ctx).toHaveBeenCalledWith('Name');

      ctx.mockClear();
      expect(evaluate('first_name', ctx)).toBe('f');
      expect(ctx).toHaveBeenCalledWith('first_name');
    });

    it('treats identifiers that merely start with a keyword as identifiers', () => {
      expect(evaluateObject('android', { android: 'yes' })).toBe('yes');
      expect(evaluateObject('is_active = true', { is_active: true })).toBe(true);
      expect(evaluateObject('ending', { ending: 1 })).toBe(1);
    });

    it('throws when an identifier is used without a context', () => {
      expect(() => evaluate('x')).toThrow();
    });
  });

  describe('lexical details', () => {
    it('ignores surrounding and interior whitespace', () => {
      expect(evaluate('  1 + 2  ')).toBe(3);
      expect(evaluate('\n\t1 +\n\t2\r\n')).toBe(3);
      expect(evaluate('1+2*3')).toBe(7);
    });

    it('treats keywords case-insensitively', () => {
      expect(evaluate('TRUE AND FALSE')).toBe(false);
      expect(evaluate('True Or False')).toBe(true);
      expect(evaluate('CASE WHEN true THEN 1 ELSE 2 END')).toBe(1);
      expect(evaluate('5 BETWEEN 1 AND 10')).toBe(true);
      expect(evaluateObject('x IS NULL', { x: null })).toBe(true);
      expect(evaluateObject('x IS NOT NULL', { x: null })).toBe(false);
    });

    it('preserves identifier case while keywords are case-insensitive', () => {
      expect(evaluateObject('CASE WHEN Flag THEN 1 ELSE 0 END', { Flag: true })).toBe(1);
    });
  });

  describe('syntax errors', () => {
    it('rejects an empty expression', () => {
      expect(() => evaluate('')).toThrow(/Unexpected start of expression/);
      expect(() => evaluate('   ')).toThrow(/Unexpected start of expression/);
    });

    it('rejects an expression that starts with an operator', () => {
      expect(() => evaluate('* 2')).toThrow(/Unexpected start of expression/);
    });

    it('rejects a dangling operator', () => {
      expect(() => evaluate('1 +')).toThrow(/Unexpected start of expression/);
      expect(() => evaluate('1 = ')).toThrow(/Unexpected start of expression/);
    });

    it('rejects an unclosed parenthesis', () => {
      expect(() => evaluate('(1 + 2')).toThrow(/Expected \)/);
    });

    it('rejects illegal characters', () => {
      expect(() => evaluate('@')).toThrow(/Unexpected start of expression/);
      expect(() => evaluate('1 + @')).toThrow(/Invalid input/);
      expect(() => evaluate('1 + #2')).toThrow(/Invalid input/);
    });

    it('rejects CASE without WHEN', () => {
      expect(() => evaluate('case 1 end')).toThrow(/Expected when/);
    });

    it('rejects CASE without END', () => {
      expect(() => evaluate('case when true then 1')).toThrow();
      expect(() => evaluate('case when true then 1 else 2')).toThrow(/Expected end/);
    });

    it('rejects CASE missing THEN', () => {
      expect(() => evaluate('case when true 1 end')).toThrow(/Expected then/);
    });

    it('rejects BETWEEN with non-numeric bounds', () => {
      expect(() => evaluateObject('x between a and b', { x: 1, a: 0, b: 2 })).toThrow(/Expected NUM/);
      expect(() => evaluate("5 between 'a' and 'z'")).toThrow(/Expected NUM/);
    });

    it('rejects BETWEEN without AND', () => {
      expect(() => evaluate('5 between 1 10')).toThrow(/Expected and/);
    });

    it('rejects IS followed by something other than NULL', () => {
      expect(() => evaluateObject('x is 5', { x: 5 })).toThrow(/Expected null/);
      expect(() => evaluateObject('x is not 5', { x: 5 })).toThrow(/Expected null/);
    });

    it('rejects a malformed argument list', () => {
      expect(() => evaluate("length('a' 'b')")).toThrow(/Expected , or \)/);
    });
  });
});

describe('evaluateObject()', () => {
  it('resolves identifiers as properties of the given object', () => {
    expect(evaluateObject('a + b', { a: 1, b: 2 })).toBe(3);
    expect(evaluateObject('name', { name: 'Bob' })).toBe('Bob');
  });

  it('yields undefined for a missing property', () => {
    expect(evaluateObject('missing', {})).toBeUndefined();
  });

  it('evaluates SQL-like filter clauses against a record', () => {
    const user = { age: 25, country: 'BR', status: 'active', role: 'user', verified: false, tags: ['a', 'b'] };

    expect(evaluateObject("age >= 18 and country = 'BR'", user)).toBe(true);
    expect(evaluateObject("age >= 18 and country = 'US'", user)).toBe(false);
    expect(evaluateObject("status = 'active' or (role = 'admin' and verified = true)", user)).toBe(true);
    expect(evaluateObject("status = 'inactive' or (role = 'admin' and verified = true)", user)).toBe(false);
    expect(evaluateObject('length(tags) > 0', user)).toBe(true);
    expect(evaluateObject('age between 18 and 30 and length(tags) = 2', user)).toBe(true);
  });

  it('evaluates computed values against a record', () => {
    const line = { price: 12.5, quantity: 4, discount: 10 };

    expect(evaluateObject('price * quantity', line)).toBe(50);
    expect(evaluateObject('price * quantity - discount', line)).toBe(40);
    expect(evaluateObject('price * quantity > 100', line)).toBe(false);
    expect(evaluateObject("case when price * quantity >= 50 then 'bulk' else 'single' end", line)).toBe('bulk');
  });

  it('works with records that contain null values', () => {
    const record = { deleted_at: null, email: 'a@b.c' };

    expect(evaluateObject('deleted_at is null and email is not null', record)).toBe(true);
    expect(evaluateObject("case when deleted_at is null then 'live' else 'gone' end", record)).toBe('live');
  });
});
