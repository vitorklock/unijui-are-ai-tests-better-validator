```ts
import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser';
import { evaluate, evaluateObject } from '../src/evaluator';
import {
  BinaryExpression,
  IdentifierExpression,
  ValueExpression,
  FunctionCallExpression,
  CaseExpression,
} from '../src/ast';
import { TokenType } from '../src/token';

describe('parse', () => {
  it('parses numeric literal', () => {
    const ast = parse('42');
    expect(ast).toBeInstanceOf(ValueExpression);
    expect((ast as ValueExpression).value).toBe(42);
  });

  it('parses string literal', () => {
    const ast = parse('"hello"');
    expect(ast).toBeInstanceOf(ValueExpression);
    expect((ast as ValueExpression).value).toBe('hello');
  });

  it('parses boolean literal', () => {
    const ast = parse('true');
    expect(ast).toBeInstanceOf(ValueExpression);
    expect((ast as ValueExpression).value).toBe(true);
  });

  it('parses identifier', () => {
    const ast = parse('name');
    expect(ast).toBeInstanceOf(IdentifierExpression);
    expect((ast as IdentifierExpression).name).toBe('name');
  });

  it('parses binary arithmetic expression with precedence', () => {
    const ast = parse('1 + 2 * 3');
    expect(ast).toBeInstanceOf(BinaryExpression);
    const bin = ast as BinaryExpression;
    expect(bin.operator).toBe(TokenType.Plus);
    expect(bin.left).toBeInstanceOf(ValueExpression);
    expect((bin.left as ValueExpression).value).toBe(1);
    expect(bin.right).toBeInstanceOf(BinaryExpression);
    const right = bin.right as BinaryExpression;
    expect(right.operator).toBe(TokenType.Mul);
    expect((right.left as ValueExpression).value).toBe(2);
    expect((right.right as ValueExpression).value).toBe(3);
  });

  it('parses parenthesized expression', () => {
    const ast = parse('(1 + 2) * 3');
    expect(ast).toBeInstanceOf(BinaryExpression);
    const bin = ast as BinaryExpression;
    expect(bin.operator).toBe(TokenType.Mul);
    expect(bin.left).toBeInstanceOf(BinaryExpression);
    expect((bin.left as BinaryExpression).operator).toBe(TokenType.Plus);
  });

  it('parses comparison expression', () => {
    const ast = parse('age >= 18');
    expect(ast).toBeInstanceOf(BinaryExpression);
    const bin = ast as BinaryExpression;
    expect(bin.operator).toBe(TokenType.Gte);
    expect(bin.left).toBeInstanceOf(IdentifierExpression);
    expect((bin.left as IdentifierExpression).name).toBe('age');
    expect(bin.right).toBeInstanceOf(ValueExpression);
    expect((bin.right as ValueExpression).value).toBe(18);
  });

  it('parses between expression', () => {
    const ast = parse('x between 1 and 10');
    expect(ast).toBeInstanceOf(BinaryExpression);
    const bin = ast as BinaryExpression;
    expect(bin.operator).toBe(TokenType.And);
    expect(bin.left).toBeInstanceOf(BinaryExpression);
    expect((bin.left as BinaryExpression).operator).toBe(TokenType.Gte);
    expect(bin.right).toBeInstanceOf(BinaryExpression);
    expect((bin.right as BinaryExpression).operator).toBe(TokenType.Lte);
  });

  it('parses is null expression', () => {
    const ast = parse('x is null');
    expect(ast).toBeInstanceOf(BinaryExpression);
    const bin = ast as BinaryExpression;
    expect(bin.operator).toBe(TokenType.Eq);
    expect(bin.right).toBeInstanceOf(ValueExpression);
    expect((bin.right as ValueExpression).value).toBe(null);
  });

  it('parses is not null expression', () => {
    const ast = parse('x is not null');
    expect(ast).toBeInstanceOf(BinaryExpression);
    const bin = ast as BinaryExpression;
    expect(bin.operator).toBe(TokenType.Neq);
    expect(bin.right).toBeInstanceOf(ValueExpression);
    expect((bin.right as ValueExpression).value).toBe(null);
  });

  it('parses function call', () => {
    const ast = parse('length(name)');
    expect(ast).toBeInstanceOf(FunctionCallExpression);
    const fn = ast as FunctionCallExpression;
    expect(fn.name).toBe('length');
    expect(fn.args).toHaveLength(1);
    expect(fn.args[0]).toBeInstanceOf(IdentifierExpression);
    expect((fn.args[0] as IdentifierExpression).name).toBe('name');
  });

  it('parses case expression', () => {
    const ast = parse("case when a = 1 then 'one' else 'other' end");
    expect(ast).toBeInstanceOf(CaseExpression);
    const caseExpr = ast as CaseExpression;
    expect(caseExpr.conditions).toHaveLength(1);
    expect(caseExpr.conditions[0].when).toBeInstanceOf(BinaryExpression);
    expect(caseExpr.conditions[0].then).toBeInstanceOf(ValueExpression);
    expect((caseExpr.conditions[0].then as ValueExpression).value).toBe('one');
    expect(caseExpr.last).toBeInstanceOf(ValueExpression);
    expect((caseExpr.last as ValueExpression).value).toBe('other');
  });

  it('throws on invalid start of expression', () => {
    expect(() => parse('+ 1')).toThrow();
  });

  it('throws on illegal token', () => {
    expect(() => parse('@')).toThrow();
  });

  it('throws on function call with multiple arguments', () => {
    expect(() => parse("length('a', 'b')")).toThrow();
  });
});

describe('evaluate', () => {
  it('evaluates numeric arithmetic', () => {
    expect(evaluate('1 + 2')).toBe(3);
    expect(evaluate('5 - 3')).toBe(2);
    expect(evaluate('2 * 3')).toBe(6);
    expect(evaluate('10 / 2')).toBe(5);
    expect(evaluate('1 + 2 * 3')).toBe(7);
    expect(evaluate('(1 + 2) * 3')).toBe(9);
  });

  it('evaluates string concatenation', () => {
    expect(evaluate("'a' + 'b'")).toBe('ab');
    expect(evaluate("'a' + 1")).toBe('a1');
  });

  it('evaluates comparison operators', () => {
    expect(evaluate('1 = 1')).toBe(true);
    expect(evaluate('1 = 2')).toBe(false);
    expect(evaluate('1 <> 2')).toBe(true);
    expect(evaluate('1 <> 1')).toBe(false);
    expect(evaluate('2 > 1')).toBe(true);
    expect(evaluate('1 < 2')).toBe(true);
    expect(evaluate('2 >= 2')).toBe(true);
    expect(evaluate('2 <= 2')).toBe(true);
    expect(evaluate('2 <= 1')).toBe(false);
  });

  it('evaluates logical operators', () => {
    expect(evaluate('true and true')).toBe(true);
    expect(evaluate('true and false')).toBe(false);
    expect(evaluate('true or false')).toBe(true);
    expect(evaluate('false or false')).toBe(false);
    expect(evaluate('true and 1')).toBe(1);
    expect(evaluate('false or 1')).toBe(1);
  });

  it('evaluates between expression', () => {
    expect(evaluate('5 between 1 and 10')).toBe(true);
    expect(evaluate('5 between 6 and 10')).toBe(false);
    expect(evaluate('5 between 1 and 4')).toBe(false);
    expect(evaluate('5 between 5 and 5')).toBe(true);
    expect(evaluate('5 between 5 and 10')).toBe(true);
    expect(evaluate('5 between 1 and 5')).toBe(true);
  });

  it('evaluates is null and is not null', () => {
    expect(evaluate('1 is null')).toBe(false);
    expect(evaluate('1 is not null')).toBe(true);
    expect(evaluate('x is null', (name: string) => (name === 'x' ? null : undefined))).toBe(true);
    expect(evaluate('x is not null', (name: string) => (name === 'x' ? null : undefined))).toBe(false);
  });

  it('evaluates length function', () => {
    expect(evaluate("length('hello')")).toBe(5);
    expect(evaluate("length('')")).toBe(0);
    expect(evaluate('length(name)', (name: string) => (name === 'name' ? 'Alice' : ''))).toBe(5);
  });

  it('evaluates case expression', () => {
    expect(evaluate("case when true then 1 else 2 end")).toBe(1);
    expect(evaluate("case when false then 1 else 2 end")).toBe(2);
    expect(evaluate("case when 1 = 2 then 'a' when 2 = 2 then 'b' else 'c' end")).toBe('b');
    expect(evaluate("case when false then 1 end")).toBe(false);
  });

  it('evaluates with context function', () => {
    const context = (name: string) => {
      if (name === 'x') return 10;
      if (name === 'y') return 5;
      return undefined;
    };
    expect(evaluate('x + y', context)).toBe(15);
    expect(evaluate('x > y', context)).toBe(true);
  });

  it('throws when identifier is used without context', () => {
    expect(() => evaluate('x')).toThrow();
  });

  it('throws for unknown function', () => {
    expect(() => evaluate("unknown('x')")).toThrow('Function unknown not implemented');
  });

  it('throws for length with wrong number of arguments', () => {
    expect(() => evaluate('length()')).toThrow('Length function takes exactly one argument.');
  });
});

describe('evaluateObject', () => {
  it('evaluates simple equality against object', () => {
    const obj = { name: 'Alice', age: 30 };
    expect(evaluateObject('name = "Alice"', obj)).toBe(true);
    expect(evaluateObject('name = "Bob"', obj)).toBe(false);
  });

  it('evaluates numeric comparison against object', () => {
    const obj = { age: 20 };
    expect(evaluateObject('age > 18', obj)).toBe(true);
    expect(evaluateObject('age < 18', obj)).toBe(false);
  });

  it('evaluates between against object', () => {
    const obj = { age: 25 };
    expect(evaluateObject('age between 18 and 30', obj)).toBe(true);
    expect(evaluateObject('age between 26 and 30', obj)).toBe(false);
  });

  it('evaluates function call against object', () => {
    const obj = { name: 'Alice' };
    expect(evaluateObject('length(name) = 5', obj)).toBe(true);
    expect(evaluateObject('length(name) = 4', obj)).toBe(false);
  });

  it('handles null and undefined properties', () => {
    expect(evaluateObject('missing is null', {})).toBe(false);
    expect(evaluateObject('missing is not null', {})).toBe(true);
    expect(evaluateObject('value is null', { value: null })).toBe(true);
    expect(evaluateObject('value is not null', { value: null })).toBe(false);
  });

  it('evaluates case expression against object', () => {
    const obj = { age: 20 };
    expect(evaluateObject("case when age >= 18 then 'adult' else 'minor' end", obj)).toBe('adult');
  });
});
```