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

describe('parse', () => {
  describe('literals', () => {
    it('parses an integer literal', () => {
      expect(parse('42')).toEqual(new ValueExpression(42));
    });

    it('parses a decimal literal', () => {
      expect(parse('3.14')).toEqual(new ValueExpression(3.14));
    });

    it('parses a decimal literal with a leading dot', () => {
      expect(parse('.5')).toEqual(new ValueExpression(0.5));
    });

    it('parses single-quoted strings', () => {
      expect(parse("'hello'")).toEqual(new ValueExpression('hello'));
    });

    it('parses double-quoted strings', () => {
      expect(parse('"hello"')).toEqual(new ValueExpression('hello'));
    });

    it('parses an empty string', () => {
      expect(parse("''")).toEqual(new ValueExpression(''));
    });

    it('does not treat keywords inside strings as keywords', () => {
      expect(parse("'and'")).toEqual(new ValueExpression('and'));
    });

    it('parses boolean literals', () => {
      expect(parse('true')).toEqual(new ValueExpression(true));
      expect(parse('false')).toEqual(new ValueExpression(false));
    });

    it('parses keywords case-insensitively', () => {
      expect(parse('TRUE')).toEqual(new ValueExpression(true));
      expect(parse('False')).toEqual(new ValueExpression(false));
    });
  });

  describe('identifiers', () => {
    it('parses a bare identifier', () => {
      expect(parse('foo')).toEqual(new IdentifierExpression('foo'));
    });

    it('allows underscores in identifiers', () => {
      expect(parse('first_name')).toEqual(new IdentifierExpression('first_name'));
    });

    it('preserves identifier case', () => {
      expect(parse('FirstName')).toEqual(new IdentifierExpression('FirstName'));
    });
  });

  describe('binary expressions', () => {
    it('parses arithmetic operators', () => {
      expect(parse('1 + 2')).toEqual(
        new BinaryExpression(TokenType.Plus, new ValueExpression(1), new ValueExpression(2)),
      );
      expect(parse('1 - 2')).toEqual(
        new BinaryExpression(TokenType.Minus, new ValueExpression(1), new ValueExpression(2)),
      );
      expect(parse('1 * 2')).toEqual(
        new BinaryExpression(TokenType.Mul, new ValueExpression(1), new ValueExpression(2)),
      );
      expect(parse('1 / 2')).toEqual(
        new BinaryExpression(TokenType.Div, new ValueExpression(1), new ValueExpression(2)),
      );
    });

    it('parses comparison operators', () => {
      const a = new IdentifierExpression('a');
      const b = new IdentifierExpression('b');
      expect(parse('a = b')).toEqual(new BinaryExpression(TokenType.Eq, a, b));
      expect(parse('a <> b')).toEqual(new BinaryExpression(TokenType.Neq, a, b));
      expect(parse('a < b')).toEqual(new BinaryExpression(TokenType.Lt, a, b));
      expect(parse('a <= b')).toEqual(new BinaryExpression(TokenType.Lte, a, b));
      expect(parse('a > b')).toEqual(new BinaryExpression(TokenType.Gt, a, b));
      expect(parse('a >= b')).toEqual(new BinaryExpression(TokenType.Gte, a, b));
    });

    it('parses logical operators', () => {
      const a = new IdentifierExpression('a');
      const b = new IdentifierExpression('b');
      expect(parse('a and b')).toEqual(new BinaryExpression(TokenType.And, a, b));
      expect(parse('a or b')).toEqual(new BinaryExpression(TokenType.Or, a, b));
      expect(parse('a AND b')).toEqual(new BinaryExpression(TokenType.And, a, b));
    });

    it('gives multiplication higher precedence than addition', () => {
      expect(parse('a + b * c')).toEqual(
        new BinaryExpression(
          TokenType.Plus,
          new IdentifierExpression('a'),
          new BinaryExpression(TokenType.Mul, new IdentifierExpression('b'), new IdentifierExpression('c')),
        ),
      );
    });

    it('is left-associative for operators of equal precedence', () => {
      expect(parse('a - b - c')).toEqual(
        new BinaryExpression(
          TokenType.Minus,
          new BinaryExpression(TokenType.Minus, new IdentifierExpression('a'), new IdentifierExpression('b')),
          new IdentifierExpression('c'),
        ),
      );
    });

    it('gives arithmetic higher precedence than comparison', () => {
      expect(parse('a + 1 = b')).toEqual(
        new BinaryExpression(
          TokenType.Eq,
          new BinaryExpression(TokenType.Plus, new IdentifierExpression('a'), new ValueExpression(1)),
          new IdentifierExpression('b'),
        ),
      );
    });

    it('gives comparison higher precedence than logical operators', () => {
      expect(parse('a = 1 and b = 2')).toEqual(
        new BinaryExpression(
          TokenType.And,
          new BinaryExpression(TokenType.Eq, new IdentifierExpression('a'), new ValueExpression(1)),
          new BinaryExpression(TokenType.Eq, new IdentifierExpression('b'), new ValueExpression(2)),
        ),
      );
    });

    it('lets parentheses override precedence', () => {
      expect(parse('(a + b) * c')).toEqual(
        new BinaryExpression(
          TokenType.Mul,
          new BinaryExpression(TokenType.Plus, new IdentifierExpression('a'), new IdentifierExpression('b')),
          new IdentifierExpression('c'),
        ),
      );
    });

    it('does not produce a node for a grouping on its own', () => {
      expect(parse('(a)')).toEqual(new IdentifierExpression('a'));
      expect(parse('((a))')).toEqual(new IdentifierExpression('a'));
    });
  });

  describe('is null / is not null', () => {
    it('desugars "is null" into an equality with null', () => {
      expect(parse('a is null')).toEqual(
        new BinaryExpression(TokenType.Eq, new IdentifierExpression('a'), new ValueExpression(null)),
      );
    });

    it('desugars "is not null" into an inequality with null', () => {
      expect(parse('a is not null')).toEqual(
        new BinaryExpression(TokenType.Neq, new IdentifierExpression('a'), new ValueExpression(null)),
      );
    });

    it('rejects "is" followed by anything other than null', () => {
      expect(() => parse('a is 1')).toThrow(/Expected null/);
      expect(() => parse('a is not 1')).toThrow(/Expected null/);
    });
  });

  describe('between', () => {
    it('desugars "between" into an inclusive range check', () => {
      expect(parse('a between 1 and 10')).toEqual(
        new BinaryExpression(
          TokenType.And,
          new BinaryExpression(TokenType.Gte, new IdentifierExpression('a'), new ValueExpression(1)),
          new BinaryExpression(TokenType.Lte, new IdentifierExpression('a'), new ValueExpression(10)),
        ),
      );
    });

    it('only accepts numeric literals as bounds', () => {
      expect(() => parse('a between b and c')).toThrow(/Expected NUM/);
      expect(() => parse("a between 'x' and 'y'")).toThrow(/Expected NUM/);
    });

    it('requires "and" between the bounds', () => {
      expect(() => parse('a between 1 or 10')).toThrow(/Expected and/);
      expect(() => parse('a between 1 10')).toThrow(/Expected and/);
    });
  });

  describe('function calls', () => {
    it('parses a call with a single argument', () => {
      expect(parse("length('abc')")).toEqual(
        new FunctionCallExpression('length', [new ValueExpression('abc')]),
      );
    });

    it('parses a call with no arguments', () => {
      expect(parse('now()')).toEqual(new FunctionCallExpression('now', []));
    });

    it('parses a full expression as an argument', () => {
      expect(parse('length(a + b)')).toEqual(
        new FunctionCallExpression('length', [
          new BinaryExpression(TokenType.Plus, new IdentifierExpression('a'), new IdentifierExpression('b')),
        ]),
      );
    });

    it('lets a call participate in a larger expression', () => {
      expect(parse('length(a) > 2')).toEqual(
        new BinaryExpression(
          TokenType.Gt,
          new FunctionCallExpression('length', [new IdentifierExpression('a')]),
          new ValueExpression(2),
        ),
      );
    });

    it('rejects an unterminated argument list', () => {
      expect(() => parse('length(a')).toThrow();
    });
  });

  describe('case expressions', () => {
    it('parses a single when/then with an else', () => {
      expect(parse("case when a > 1 then 'big' else 'small' end")).toEqual(
        new CaseExpression(
          [
            {
              when: new BinaryExpression(TokenType.Gt, new IdentifierExpression('a'), new ValueExpression(1)),
              then: new ValueExpression('big'),
            },
          ],
          new ValueExpression('small'),
        ),
      );
    });

    it('parses multiple when/then branches', () => {
      const ast = parse('case when a = 1 then 1 when a = 2 then 2 else 3 end') as CaseExpression;
      expect(ast.type).toBe('CaseExpression');
      expect(ast.conditions).toHaveLength(2);
      expect(ast.conditions[0].then).toEqual(new ValueExpression(1));
      expect(ast.conditions[1].then).toEqual(new ValueExpression(2));
      expect(ast.last).toEqual(new ValueExpression(3));
    });

    it('leaves the else branch undefined when omitted', () => {
      const ast = parse('case when a then 1 end') as CaseExpression;
      expect(ast.conditions).toHaveLength(1);
      expect(ast.last).toBeUndefined();
    });

    it('accepts uppercase keywords', () => {
      expect(parse('CASE WHEN a THEN 1 ELSE 2 END')).toEqual(
        new CaseExpression(
          [{ when: new IdentifierExpression('a'), then: new ValueExpression(1) }],
          new ValueExpression(2),
        ),
      );
    });

    it('parses nested case expressions', () => {
      expect(parse('case when a then case when b then 1 else 2 end else 3 end')).toEqual(
        new CaseExpression(
          [
            {
              when: new IdentifierExpression('a'),
              then: new CaseExpression(
                [{ when: new IdentifierExpression('b'), then: new ValueExpression(1) }],
                new ValueExpression(2),
              ),
            },
          ],
          new ValueExpression(3),
        ),
      );
    });

    it('requires "when" immediately after "case"', () => {
      expect(() => parse('case end')).toThrow(/Expected when/);
      expect(() => parse('case a when a then 1 end')).toThrow(/Expected when/);
    });

    it('requires "then" after the condition', () => {
      expect(() => parse('case when a 1 end')).toThrow(/Expected then/);
    });

    it('requires a closing "end"', () => {
      expect(() => parse('case when a then 1')).toThrow();
      expect(() => parse('case when a then 1 else 2')).toThrow(/Expected end/);
    });
  });

  describe('whitespace', () => {
    it('ignores leading, trailing, and internal whitespace', () => {
      expect(parse('   1   +   2   ')).toEqual(parse('1+2'));
    });

    it('treats tabs and newlines as whitespace', () => {
      expect(parse('1\n+\t2\r\n')).toEqual(parse('1 + 2'));
    });
  });

  describe('errors', () => {
    it('rejects an empty expression', () => {
      expect(() => parse('')).toThrow(/Unexpected start of expression/);
      expect(() => parse('   ')).toThrow(/Unexpected start of expression/);
    });

    it('rejects an expression starting with an operator', () => {
      expect(() => parse('+ 1')).toThrow(/Unexpected start of expression/);
      expect(() => parse('= 1')).toThrow(/Unexpected start of expression/);
    });

    it('rejects a missing right operand', () => {
      expect(() => parse('1 +')).toThrow(/Unexpected start of expression/);
      expect(() => parse('a and')).toThrow(/Unexpected start of expression/);
    });

    it('rejects unbalanced parentheses', () => {
      expect(() => parse('(1 + 2')).toThrow(/Expected \)/);
      expect(() => parse('()')).toThrow(/Unexpected start of expression/);
    });

    it('rejects illegal characters', () => {
      expect(() => parse('1 + # 2')).toThrow(/Invalid input/);
      expect(() => parse('@')).toThrow(/Unexpected start of expression/);
    });

    it('rejects a bare null literal', () => {
      expect(() => parse('null')).toThrow(/Unexpected start of expression/);
    });
  });
});

describe('evaluate', () => {
  describe('literals', () => {
    it('evaluates numbers', () => {
      expect(evaluate('42')).toBe(42);
      expect(evaluate('3.5')).toBe(3.5);
      expect(evaluate('.25')).toBe(0.25);
    });

    it('evaluates strings', () => {
      expect(evaluate("'hello world'")).toBe('hello world');
      expect(evaluate('"hello"')).toBe('hello');
      expect(evaluate("''")).toBe('');
    });

    it('allows the other quote style inside a string', () => {
      expect(evaluate('"it\'s"')).toBe("it's");
      expect(evaluate("'say \"hi\"'")).toBe('say "hi"');
    });

    it('evaluates booleans', () => {
      expect(evaluate('true')).toBe(true);
      expect(evaluate('false')).toBe(false);
      expect(evaluate('TRUE')).toBe(true);
    });
  });

  describe('arithmetic', () => {
    it('adds, subtracts, multiplies and divides', () => {
      expect(evaluate('1 + 2')).toBe(3);
      expect(evaluate('7 - 10')).toBe(-3);
      expect(evaluate('6 * 7')).toBe(42);
      expect(evaluate('10 / 4')).toBe(2.5);
    });

    it('respects operator precedence', () => {
      expect(evaluate('2 + 3 * 4')).toBe(14);
      expect(evaluate('2 * 3 + 4')).toBe(10);
      expect(evaluate('10 - 2 * 3')).toBe(4);
    });

    it('is left-associative', () => {
      expect(evaluate('10 - 2 - 3')).toBe(5);
      expect(evaluate('100 / 10 / 2')).toBe(5);
      expect(evaluate('2 - 3 + 4')).toBe(3);
    });

    it('respects parentheses', () => {
      expect(evaluate('(2 + 3) * 4')).toBe(20);
      expect(evaluate('((1 + 2) * (3 + 4))')).toBe(21);
    });

    it('handles decimals', () => {
      expect(evaluate('1.5 + 1.5')).toBe(3);
      expect(evaluate('0.1 * 10')).toBeCloseTo(1);
    });

    it('follows JavaScript semantics for division by zero', () => {
      expect(evaluate('1 / 0')).toBe(Infinity);
    });

    it('concatenates strings with +', () => {
      expect(evaluate("'foo' + 'bar'")).toBe('foobar');
    });
  });

  describe('comparison', () => {
    it('compares numbers', () => {
      expect(evaluate('1 = 1')).toBe(true);
      expect(evaluate('1 = 2')).toBe(false);
      expect(evaluate('1 <> 2')).toBe(true);
      expect(evaluate('1 <> 1')).toBe(false);
      expect(evaluate('2 > 1')).toBe(true);
      expect(evaluate('1 > 2')).toBe(false);
      expect(evaluate('1 >= 1')).toBe(true);
      expect(evaluate('0 >= 1')).toBe(false);
      expect(evaluate('1 < 2')).toBe(true);
      expect(evaluate('2 < 1')).toBe(false);
      expect(evaluate('2 <= 2')).toBe(true);
      expect(evaluate('3 <= 2')).toBe(false);
    });

    it('compares strings', () => {
      expect(evaluate("'a' = 'a'")).toBe(true);
      expect(evaluate("'a' = 'b'")).toBe(false);
      expect(evaluate("'a' <> 'b'")).toBe(true);
      expect(evaluate("'a' < 'b'")).toBe(true);
    });

    it('uses strict equality across types', () => {
      expect(evaluate("1 = '1'")).toBe(false);
      expect(evaluate("1 <> '1'")).toBe(true);
      expect(evaluate('true = 1')).toBe(false);
    });

    it('evaluates arithmetic before comparing', () => {
      expect(evaluate('1 + 1 = 2')).toBe(true);
      expect(evaluate('2 * 3 > 5')).toBe(true);
      expect(evaluate('10 / 2 <= 4')).toBe(false);
    });

    it('evaluates ordering comparisons before equality', () => {
      expect(evaluate('1 < 2 = true')).toBe(true);
      expect(evaluate('2 < 1 = false')).toBe(true);
    });
  });

  describe('logical operators', () => {
    it('evaluates and', () => {
      expect(evaluate('true and true')).toBe(true);
      expect(evaluate('true and false')).toBe(false);
      expect(evaluate('false and true')).toBe(false);
      expect(evaluate('false and false')).toBe(false);
    });

    it('evaluates or', () => {
      expect(evaluate('true or true')).toBe(true);
      expect(evaluate('true or false')).toBe(true);
      expect(evaluate('false or true')).toBe(true);
      expect(evaluate('false or false')).toBe(false);
    });

    it('binds comparisons tighter than logical operators', () => {
      expect(evaluate('1 = 1 and 2 = 2')).toBe(true);
      expect(evaluate('1 = 1 and 2 = 3')).toBe(false);
      expect(evaluate('1 = 2 or 2 = 2')).toBe(true);
    });

    it('allows parentheses around logical sub-expressions', () => {
      expect(evaluate('(true or false) and false')).toBe(false);
      expect(evaluate('true or (false and false)')).toBe(true);
    });

    it('short-circuits and', () => {
      const context = vi.fn();
      evaluate('false and x', context);
      expect(context).not.toHaveBeenCalled();
    });

    it('short-circuits or', () => {
      const context = vi.fn();
      evaluate('true or x', context);
      expect(context).not.toHaveBeenCalled();
    });

    it('returns the operand value rather than coercing to boolean', () => {
      expect(evaluate('0 or 5')).toBe(5);
      expect(evaluate("'' or 'fallback'")).toBe('fallback');
      expect(evaluate('1 and 2')).toBe(2);
    });
  });

  describe('identifiers and context', () => {
    it('resolves identifiers through the context function', () => {
      const context = (name: string) => ({ a: 1, b: 2 } as Record<string, any>)[name];
      expect(evaluate('a + b', context)).toBe(3);
    });

    it('passes the identifier name to the context function', () => {
      const context = vi.fn().mockReturnValue(10);
      expect(evaluate('first_name', context)).toBe(10);
      expect(context).toHaveBeenCalledTimes(1);
      expect(context).toHaveBeenCalledWith('first_name');
    });

    it('preserves identifier case when calling the context', () => {
      const context = vi.fn().mockReturnValue(1);
      evaluate('FirstName', context);
      expect(context).toHaveBeenCalledWith('FirstName');
    });

    it('calls the context once per identifier occurrence', () => {
      const context = vi.fn().mockReturnValue(2);
      expect(evaluate('x * x + x', context)).toBe(6);
      expect(context).toHaveBeenCalledTimes(3);
    });

    it('throws when an identifier is used without a context', () => {
      expect(() => evaluate('foo')).toThrow();
    });

    it('does not need a context for constant expressions', () => {
      expect(evaluate('1 + 1')).toBe(2);
    });
  });

  describe('is null / is not null', () => {
    it('matches null values', () => {
      expect(evaluate('x is null', () => null)).toBe(true);
      expect(evaluate('x is not null', () => null)).toBe(false);
    });

    it('does not match non-null values', () => {
      expect(evaluate('x is null', () => 0)).toBe(false);
      expect(evaluate('x is null', () => '')).toBe(false);
      expect(evaluate('x is not null', () => 'value')).toBe(true);
    });

    it('treats undefined as distinct from null', () => {
      expect(evaluate('x is null', () => undefined)).toBe(false);
      expect(evaluate('x is not null', () => undefined)).toBe(true);
    });

    it('combines with other conditions', () => {
      const context = (name: string) => ({ a: null, b: 5 } as Record<string, any>)[name];
      expect(evaluate('a is null and b > 1', context)).toBe(true);
      expect(evaluate('a is not null or b > 1', context)).toBe(true);
    });
  });

  describe('between', () => {
    it('is inclusive on both ends', () => {
      expect(evaluate('x between 1 and 10', () => 1)).toBe(true);
      expect(evaluate('x between 1 and 10', () => 10)).toBe(true);
      expect(evaluate('x between 1 and 10', () => 5)).toBe(true);
    });

    it('rejects values outside the range', () => {
      expect(evaluate('x between 1 and 10', () => 0)).toBe(false);
      expect(evaluate('x between 1 and 10', () => 11)).toBe(false);
    });

    it('works with decimal bounds', () => {
      expect(evaluate('x between 0.5 and 1.5', () => 1)).toBe(true);
      expect(evaluate('x between 0.5 and 1.5', () => 2)).toBe(false);
    });

    it('combines with other conditions', () => {
      const context = (name: string) => ({ age: 30, active: true } as Record<string, any>)[name];
      expect(evaluate('age between 18 and 65 and active', context)).toBe(true);
      expect(evaluate('age between 40 and 65 or active', context)).toBe(true);
    });
  });

  describe('function calls', () => {
    it('returns the length of a string', () => {
      expect(evaluate("length('abc')")).toBe(3);
      expect(evaluate("length('')")).toBe(0);
    });

    it('returns the length of an array from context', () => {
      expect(evaluate('length(items)', () => [1, 2, 3, 4])).toBe(4);
    });

    it('evaluates the argument expression before calling', () => {
      expect(evaluate("length('ab' + 'cd')")).toBe(4);
    });

    it('can be used inside larger expressions', () => {
      expect(evaluate("length('abcd') / 2")).toBe(2);
      expect(evaluate("length('abc') = 3")).toBe(true);
      expect(evaluate("length('abc') > 5 or true")).toBe(true);
    });

    it('throws when length is called with no arguments', () => {
      expect(() => evaluate('length()')).toThrow(/exactly one argument/);
    });

    it('throws for unknown functions', () => {
      expect(() => evaluate("upper('abc')")).toThrow(/Function upper not implemented/);
    });
  });

  describe('case expressions', () => {
    it('returns the first matching branch', () => {
      const expression = "case when x = 1 then 'one' when x = 2 then 'two' else 'other' end";
      expect(evaluate(expression, () => 1)).toBe('one');
      expect(evaluate(expression, () => 2)).toBe('two');
      expect(evaluate(expression, () => 3)).toBe('other');
    });

    it('returns false when nothing matches and there is no else', () => {
      expect(evaluate("case when x = 1 then 'one' end", () => 2)).toBe(false);
    });

    it('stops at the first matching branch', () => {
      expect(evaluate("case when true then 'first' when true then 'second' end")).toBe('first');
    });

    it('treats truthy non-boolean conditions as matches', () => {
      expect(evaluate("case when 1 then 'yes' else 'no' end")).toBe('yes');
      expect(evaluate("case when 0 then 'yes' else 'no' end")).toBe('no');
      expect(evaluate("case when '' then 'yes' else 'no' end")).toBe('no');
    });

    it('only evaluates the branch that is taken', () => {
      const context = vi.fn();
      expect(evaluate('case when true then 1 else x end', context)).toBe(1);
      expect(context).not.toHaveBeenCalled();
    });

    it('does not evaluate conditions after a match', () => {
      const context = vi.fn();
      expect(evaluate('case when true then 1 when x then 2 end', context)).toBe(1);
      expect(context).not.toHaveBeenCalled();
    });

    it('can be used as an operand', () => {
      expect(evaluate('case when true then 1 else 2 end + 10')).toBe(11);
      expect(evaluate('(case when false then 1 else 2 end) * 5')).toBe(10);
      expect(evaluate("case when true then 'a' else 'b' end = 'a'")).toBe(true);
    });

    it('supports complex conditions', () => {
      const expression = "case when age < 18 then 'child' when age >= 65 and member = false then 'senior' else 'adult' end";
      const ctx = (values: Record<string, any>) => (name: string) => values[name];
      expect(evaluate(expression, ctx({ age: 70, member: false }))).toBe('senior');
      expect(evaluate(expression, ctx({ age: 70, member: true }))).toBe('adult');
      expect(evaluate(expression, ctx({ age: 10, member: true }))).toBe('child');
    });

    it('evaluates nested case expressions', () => {
      const expression = 'case when a then case when b then 1 else 2 end else 3 end';
      const ctx = (values: Record<string, any>) => (name: string) => values[name];
      expect(evaluate(expression, ctx({ a: true, b: true }))).toBe(1);
      expect(evaluate(expression, ctx({ a: true, b: false }))).toBe(2);
      expect(evaluate(expression, ctx({ a: false, b: true }))).toBe(3);
    });
  });

  describe('whitespace', () => {
    it('ignores surrounding and internal whitespace', () => {
      expect(evaluate('  1 +   2  ')).toBe(3);
      expect(evaluate('1\n+\t2\r\n')).toBe(3);
    });
  });

  describe('errors', () => {
    it('propagates parse errors', () => {
      expect(() => evaluate('')).toThrow();
      expect(() => evaluate('1 +')).toThrow();
      expect(() => evaluate('(1')).toThrow();
      expect(() => evaluate('1 + # 2')).toThrow(/Invalid input/);
    });
  });
});

describe('evaluateObject', () => {
  it('resolves identifiers as properties of the object', () => {
    expect(evaluateObject('a + b', { a: 1, b: 2 })).toBe(3);
    expect(evaluateObject('name', { name: 'Ada' })).toBe('Ada');
  });

  it('evaluates SQL-like filter clauses', () => {
    const row = { status: 'active', amount: 150, tags: ['x', 'y'] };
    expect(evaluateObject("status = 'active' and amount > 100", row)).toBe(true);
    expect(evaluateObject("status = 'inactive' or amount > 100", row)).toBe(true);
    expect(evaluateObject("status = 'inactive' and amount > 100", row)).toBe(false);
    expect(evaluateObject('amount between 100 and 200', row)).toBe(true);
    expect(evaluateObject('length(tags) = 2', row)).toBe(true);
  });

  it('handles null properties with is null', () => {
    expect(evaluateObject('deleted_at is null', { deleted_at: null })).toBe(true);
    expect(evaluateObject('deleted_at is not null', { deleted_at: '2024-01-01' })).toBe(true);
  });

  it('yields undefined for missing properties', () => {
    expect(evaluateObject('missing', { a: 1 })).toBeUndefined();
    expect(evaluateObject('missing >= 18', { a: 1 })).toBe(false);
    expect(evaluateObject('missing is null', { a: 1 })).toBe(false);
  });

  it('works with case expressions over object fields', () => {
    const expression = "case when score >= 90 then 'A' when score >= 80 then 'B' else 'C' end";
    expect(evaluateObject(expression, { score: 95 })).toBe('A');
    expect(evaluateObject(expression, { score: 85 })).toBe('B');
    expect(evaluateObject(expression, { score: 10 })).toBe('C');
  });

  it('does not require the object for constant expressions', () => {
    expect(evaluateObject('1 + 1', {})).toBe(2);
  });

  it('works with arrays as the object', () => {
    expect(evaluateObject('length', [1, 2, 3])).toBe(3);
  });
});

// These tests pin down behaviour that is surprising or likely unintended.
// They exist so that a change in behaviour is noticed, not to endorse it.
describe('current behaviour worth knowing about', () => {
  it('binds "or" tighter than "and" (opposite of SQL)', () => {
    // SQL would read this as (false and true) or true = true.
    expect(parse('a and b or c')).toEqual(
      new BinaryExpression(
        TokenType.And,
        new IdentifierExpression('a'),
        new BinaryExpression(TokenType.Or, new IdentifierExpression('b'), new IdentifierExpression('c')),
      ),
    );
    expect(evaluate('false and true or true')).toBe(false);
  });

  it('fails to parse function calls with more than one argument', () => {
    expect(() => parse('f(1, 2)')).toThrow(/Unexpected start of expression/);
  });

  it('silently ignores trailing tokens after a complete expression', () => {
    expect(evaluate('1 2')).toBe(1);
    expect(evaluate('1 + 2)')).toBe(3);
  });

  it('does not allow digits in identifiers', () => {
    // "foo1" lexes as the identifier "foo" followed by the number 1, which is then ignored.
    expect(parse('foo1')).toEqual(new IdentifierExpression('foo'));
  });

  it('does not support unary minus or unary not', () => {
    expect(() => evaluate('-1')).toThrow(/Unexpected start of expression/);
    expect(() => evaluate('1 - -1')).toThrow(/Unexpected start of expression/);
    expect(() => evaluate('not true')).toThrow(/Unexpected start of expression/);
  });

  it('accepts an unterminated string literal', () => {
    expect(evaluate("'abc")).toBe('abc');
  });
});
