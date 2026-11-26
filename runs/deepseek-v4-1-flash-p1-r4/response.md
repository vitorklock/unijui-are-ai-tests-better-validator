```ts
import { describe, expect, it } from 'vitest';
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

describe('evaluate', () => {
  it('evaluates literal values', () => {
    expect(evaluate('42')).toBe(42);
    expect(evaluate('3.14')).toBe(3.14);
    expect(evaluate('.5')).toBe(0.5);
    expect(evaluate('"hello"')).toBe('hello');
    expect(evaluate("'world'")).toBe('world');
    expect(evaluate('true')).toBe(true);
    expect(evaluate('false')).toBe(false);
  });

  it('evaluates arithmetic expressions with precedence and grouping', () => {
    expect(evaluate('1 + 2')).toBe(3);
    expect(evaluate('5 - 2')).toBe(3);
    expect(evaluate('3 * 4')).toBe(12);
    expect(evaluate('8 / 2')).toBe(4);
    expect(evaluate('1 + 2 * 3')).toBe(7);
    expect(evaluate('(1 + 2) * 3')).toBe(9);
    expect(evaluate('10 - 4 - 3')).toBe(3);
    expect(evaluate('2 * (3 + 4)')).toBe(14);
  });

  it('evaluates comparison operators', () => {
    expect(evaluate('2 = 2')).toBe(true);
    expect(evaluate('2 <> 3')).toBe(true);
    expect(evaluate('3 > 2')).toBe(true);
    expect(evaluate('3 >= 3')).toBe(true);
    expect(evaluate('3 < 2')).toBe(false);
    expect(evaluate('3 <= 3')).toBe(true);
    expect(evaluate('"a" = "a"')).toBe(true);
  });

  it('evaluates boolean operators', () => {
    expect(evaluate('true and true')).toBe(true);
    expect(evaluate('true and false')).toBe(false);
    expect(evaluate('false or true')).toBe(true);
    expect(evaluate('false or false')).toBe(false);
    expect(evaluate('1 < 2 and 3 > 2')).toBe(true);
    expect(evaluate('1 > 2 or 3 > 2')).toBe(true);
  });

  it('resolves identifiers using the context function', () => {
    const values: Record<string, any> = { age: 30, name: 'Ada' };
    const context = (identifier: string) => values[identifier];

    expect(evaluate('age >= 18', context)).toBe(true);
    expect(evaluate('name = "Ada"', context)).toBe(true);
    expect(evaluate('age + 5', context)).toBe(35);
  });

  it('evaluates function calls', () => {
    const values: Record<string, any> = { name: 'Ada' };
    const context = (identifier: string) => values[identifier];

    expect(evaluate('length("hello")')).toBe(5);
    expect(evaluate('length(name)', context)).toBe(3);
    expect(() => evaluate('length()')).toThrow('Length function takes exactly one argument.');
  });

  it('evaluates between expressions with inclusive bounds', () => {
    expect(evaluateObject('age between 18 and 30', { age: 18 })).toBe(true);
    expect(evaluateObject('age between 18 and 30', { age: 30 })).toBe(true);
    expect(evaluateObject('age between 18 and 30', { age: 17 })).toBe(false);
    expect(evaluateObject('age between 18 and 30', { age: 31 })).toBe(false);
  });

  it('evaluates is null and is not null expressions', () => {
    expect(evaluateObject('nickname is null', { nickname: null })).toBe(true);
    expect(evaluateObject('nickname is null', { nickname: 'Ada' })).toBe(false);
    expect(evaluateObject('nickname is not null', { nickname: 'Ada' })).toBe(true);
    expect(evaluateObject('nickname is not null', { nickname: null })).toBe(false);
  });

  it('evaluates case expressions', () => {
    expect(evaluate('case when 1 = 1 then "yes" else "no" end')).toBe('yes');
    expect(evaluate('case when 1 = 2 then "yes" else "no" end')).toBe('no');
    expect(evaluate('case when false then 1 when true then 2 else 3 end')).toBe(2);
    expect(evaluate('case when false then 1 end')).toBe(false);

    const values: Record<string, any> = { score: 80 };
    const context = (identifier: string) => values[identifier];

    expect(
      evaluate('case when score >= 90 then "A" when score >= 80 then "B" else "C" end', context),
    ).toBe('B');
  });
});

describe('evaluateObject', () => {
  it('evaluates expressions against object properties', () => {
    const record = { age: 42, name: 'Ada', active: true, score: 10 };

    expect(evaluateObject('age >= 18', record)).toBe(true);
    expect(evaluateObject('name = "Ada"', record)).toBe(true);
    expect(evaluateObject('active and score > 5', record)).toBe(true);
    expect(evaluateObject('missing', record)).toBeUndefined();
  });
});

describe('parse', () => {
  it('parses literals and identifiers into AST nodes', () => {
    expect(parse('42')).toBeInstanceOf(ValueExpression);
    expect((parse('42') as ValueExpression).value).toBe(42);

    expect(parse('"hello"')).toBeInstanceOf(ValueExpression);
    expect((parse('"hello"') as ValueExpression).value).toBe('hello');

    expect(parse('true')).toBeInstanceOf(ValueExpression);
    expect((parse('true') as ValueExpression).value).toBe(true);

    const identifier = parse('active') as IdentifierExpression;
    expect(identifier).toBeInstanceOf(IdentifierExpression);
    expect(identifier.name).toBe('active');
  });

  it('parses arithmetic expressions with the expected precedence tree', () => {
    const ast = parse('1 + 2 * 3') as BinaryExpression;

    expect(ast).toBeInstanceOf(BinaryExpression);
    expect(ast.operator).toBe(TokenType.Plus);
    expect(ast.left).toEqual(new ValueExpression(1));

    const right = ast.right as BinaryExpression;
    expect(right).toBeInstanceOf(BinaryExpression);
    expect(right.operator).toBe(TokenType.Mul);
    expect(right.left).toEqual(new ValueExpression(2));
    expect(right.right).toEqual(new ValueExpression(3));
  });

  it('parses grouped expressions', () => {
    const ast = parse('(1 + 2) * 3') as BinaryExpression;

    expect(ast.operator).toBe(TokenType.Mul);

    const left = ast.left as BinaryExpression;
    expect(left.operator).toBe(TokenType.Plus);
    expect(left.left).toEqual(new ValueExpression(1));
    expect(left.right).toEqual(new ValueExpression(2));

    expect(ast.right).toEqual(new ValueExpression(3));
  });

  it('parses function calls', () => {
    const ast = parse('length("hello")') as FunctionCallExpression;

    expect(ast).toBeInstanceOf(FunctionCallExpression);
    expect(ast.name).toBe('length');
    expect(ast.args).toHaveLength(1);
    expect(ast.args[0]).toEqual(new ValueExpression('hello'));
  });

  it('parses between expressions into inclusive range checks', () => {
    const ast = parse('age between 18 and 30') as BinaryExpression;

    expect(ast.operator).toBe(TokenType.And);

    const lower = ast.left as BinaryExpression;
    expect(lower.operator).toBe(TokenType.Gte);
    expect(lower.left).toEqual(new IdentifierExpression('age'));
    expect(lower.right).toEqual(new ValueExpression(18));

    const upper = ast.right as BinaryExpression;
    expect(upper.operator).toBe(TokenType.Lte);
    expect(upper.left).toEqual(new IdentifierExpression('age'));
    expect(upper.right).toEqual(new ValueExpression(30));
  });

  it('parses is null expressions', () => {
    const ast = parse('nickname is not null') as BinaryExpression;

    expect(ast.operator).toBe(TokenType.Neq);
    expect(ast.left).toEqual(new IdentifierExpression('nickname'));
    expect(ast.right).toEqual(new ValueExpression(null));
  });

  it('parses case expressions', () => {
    const ast = parse('case when score >= 90 then "A" else "B" end') as CaseExpression;

    expect(ast).toBeInstanceOf(CaseExpression);
    expect(ast.conditions).toHaveLength(1);

    const condition = ast.conditions[0];
    const when = condition.when as BinaryExpression;

    expect(when.operator).toBe(TokenType.Gte);
    expect(when.left).toEqual(new IdentifierExpression('score'));
    expect(when.right).toEqual(new ValueExpression(90));
    expect(condition.then).toEqual(new ValueExpression('A'));
    expect(ast.last).toEqual(new ValueExpression('B'));
  });
});

describe('error handling', () => {
  it('throws for invalid expression starts', () => {
    expect(() => parse('+')).toThrow(/Unexpected start of expression/);
    expect(() => evaluate('')).toThrow(/Unexpected start of expression/);
  });

  it('throws for unterminated grouped expressions', () => {
    expect(() => parse('(1 + 2')).toThrow(/Expected \)/);
  });

  it('throws for malformed case expressions', () => {
    expect(() => parse('case else 1 end')).toThrow(/Expected when/);
  });

  it('throws for unknown functions', () => {
    expect(() => evaluate('unknown(1)')).toThrow('Function unknown not implemented');
  });
});
```