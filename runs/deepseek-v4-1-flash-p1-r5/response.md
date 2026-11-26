```ts
import { describe, expect, it } from 'vitest';
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

const lookup = (values: Record<string, any>) => (name: string) => values[name];

describe('parse', () => {
  it('parses literal and identifier expressions', () => {
    const number = parse('42') as ValueExpression;
    expect(number).toBeInstanceOf(ValueExpression);
    expect(number.value).toBe(42);

    const singleQuotedString = parse("'hello'") as ValueExpression;
    expect(singleQuotedString.value).toBe('hello');

    const doubleQuotedString = parse('"world"') as ValueExpression;
    expect(doubleQuotedString.value).toBe('world');

    const boolean = parse('TRUE') as ValueExpression;
    expect(boolean.value).toBe(true);

    const identifier = parse('user_name') as IdentifierExpression;
    expect(identifier).toBeInstanceOf(IdentifierExpression);
    expect(identifier.name).toBe('user_name');
  });

  it('respects arithmetic precedence', () => {
    const expression = parse('1 + 2 * 3') as BinaryExpression;

    expect(expression).toBeInstanceOf(BinaryExpression);
    expect(expression.operator).toBe(TokenType.Plus);

    expect(expression.left).toBeInstanceOf(ValueExpression);
    expect((expression.left as ValueExpression).value).toBe(1);

    expect(expression.right).toBeInstanceOf(BinaryExpression);
    const right = expression.right as BinaryExpression;
    expect(right.operator).toBe(TokenType.Mul);
    expect((right.left as ValueExpression).value).toBe(2);
    expect((right.right as ValueExpression).value).toBe(3);
  });

  it('parses grouped expressions', () => {
    const expression = parse('(1 + 2) * 3') as BinaryExpression;

    expect(expression.operator).toBe(TokenType.Mul);
    expect(expression.left).toBeInstanceOf(BinaryExpression);
    expect((expression.left as BinaryExpression).operator).toBe(TokenType.Plus);
    expect((expression.right as ValueExpression).value).toBe(3);
  });

  it('parses function calls', () => {
    const expression = parse('length(name)') as FunctionCallExpression;

    expect(expression).toBeInstanceOf(FunctionCallExpression);
    expect(expression.name).toBe('length');
    expect(expression.args).toHaveLength(1);

    expect(expression.args[0]).toBeInstanceOf(IdentifierExpression);
    expect((expression.args[0] as IdentifierExpression).name).toBe('name');
  });

  it('parses is null and is not null expressions', () => {
    const isNull = parse('value is null') as BinaryExpression;
    expect(isNull.operator).toBe(TokenType.Eq);
    expect(isNull.left).toBeInstanceOf(IdentifierExpression);
    expect((isNull.left as IdentifierExpression).name).toBe('value');
    expect(isNull.right).toBeInstanceOf(ValueExpression);
    expect((isNull.right as ValueExpression).value).toBeNull();

    const isNotNull = parse('value is not null') as BinaryExpression;
    expect(isNotNull.operator).toBe(TokenType.Neq);
    expect(isNotNull.left).toBeInstanceOf(IdentifierExpression);
    expect((isNotNull.left as IdentifierExpression).name).toBe('value');
    expect(isNotNull.right).toBeInstanceOf(ValueExpression);
    expect((isNotNull.right as ValueExpression).value).toBeNull();
  });

  it('parses between expressions', () => {
    const expression = parse('age between 18 and 30') as BinaryExpression;

    expect(expression.operator).toBe(TokenType.And);

    const lowerBound = expression.left as BinaryExpression;
    expect(lowerBound.operator).toBe(TokenType.Gte);
    expect((lowerBound.left as IdentifierExpression).name).toBe('age');
    expect((lowerBound.right as ValueExpression).value).toBe(18);

    const upperBound = expression.right as BinaryExpression;
    expect(upperBound.operator).toBe(TokenType.Lte);
    expect((upperBound.left as IdentifierExpression).name).toBe('age');
    expect((upperBound.right as ValueExpression).value).toBe(30);
  });

  it('parses case expressions with multiple when branches and else', () => {
    const expression = parse(
      "case when score >= 90 then 'A' when score >= 80 then 'B' else 'C' end",
    ) as CaseExpression;

    expect(expression).toBeInstanceOf(CaseExpression);
    expect(expression.conditions).toHaveLength(2);

    expect(expression.conditions[0].when).toBeInstanceOf(BinaryExpression);
    expect((expression.conditions[0].when as BinaryExpression).operator).toBe(TokenType.Gte);
    expect((expression.conditions[0].then as ValueExpression).value).toBe('A');

    expect(expression.conditions[1].when).toBeInstanceOf(BinaryExpression);
    expect((expression.conditions[1].when as BinaryExpression).operator).toBe(TokenType.Gte);
    expect((expression.conditions[1].then as ValueExpression).value).toBe('B');

    expect(expression.last).toBeInstanceOf(ValueExpression);
    expect((expression.last as ValueExpression).value).toBe('C');
  });

  it('throws on invalid expressions', () => {
    expect(() => parse('1 +')).toThrow(/Unexpected start of expression/);
    expect(() => parse('')).toThrow(/Unexpected start of expression/);
  });
});

describe('evaluate', () => {
  it('evaluates arithmetic expressions with precedence and parentheses', () => {
    expect(evaluate('1 + 2 * 3')).toBe(7);
    expect(evaluate('(1 + 2) * 3')).toBe(9);
    expect(evaluate('10 / 2 - 3')).toBe(2);
  });

  it('evaluates strings, booleans, and comparisons', () => {
    expect(evaluate("'hello' + ' ' + 'world'")).toBe('hello world');
    expect(evaluate('true')).toBe(true);
    expect(evaluate('false')).toBe(false);
    expect(evaluate('5 > 3')).toBe(true);
    expect(evaluate('5 <= 3')).toBe(false);
    expect(evaluate("'a' = 'a'")).toBe(true);
    expect(evaluate('1 <> 2')).toBe(true);
  });

  it('evaluates logical expressions and grouped logical expressions', () => {
    expect(evaluate('true and false')).toBe(false);
    expect(evaluate('false or true')).toBe(true);
    expect(evaluate('(true or false) and false')).toBe(false);
  });

  it('evaluates expressions against a context function', () => {
    const context = lookup({ age: 20, active: true });
    expect(evaluate('age >= 18 and active = true', context)).toBe(true);

    const tooYoung = lookup({ age: 16, active: true });
    expect(evaluate('age >= 18 and active = true', tooYoung)).toBe(false);
  });

  it('evaluates is null expressions', () => {
    expect(evaluate('value is null', lookup({ value: null }))).toBe(true);
    expect(evaluate('value is not null', lookup({ value: null }))).toBe(false);
    expect(evaluate('value is not null', lookup({ value: 0 }))).toBe(true);
  });

  it('evaluates between expressions', () => {
    expect(evaluate('age between 18 and 30', lookup({ age: 20 }))).toBe(true);
    expect(evaluate('age between 18 and 30', lookup({ age: 17 }))).toBe(false);
    expect(evaluate('age between 18 and 30', lookup({ age: 35 }))).toBe(false);
  });

  it('evaluates case expressions', () => {
    const expression =
      "case when score >= 90 then 'A' when score >= 80 then 'B' else 'C' end";

    expect(evaluate(expression, lookup({ score: 95 }))).toBe('A');
    expect(evaluate(expression, lookup({ score: 85 }))).toBe('B');
    expect(evaluate(expression, lookup({ score: 70 }))).toBe('C');
  });

  it('evaluates function calls', () => {
    expect(evaluate('length(name)', lookup({ name: 'Alice' }))).toBe(5);
    expect(evaluate('length("hello")')).toBe(5);
  });

  it('throws for invalid function calls', () => {
    expect(() => evaluate('length()')).toThrow('Length function takes exactly one argument.');
    expect(() => evaluate('lower(name)', lookup({ name: 'Alice' }))).toThrow(
      'Function lower not implemented',
    );
  });
});

describe('evaluateObject', () => {
  const value = {
    name: 'Alice',
    age: 30,
    active: true,
    score: 85,
    deletedAt: null,
  };

  it('evaluates expressions against object properties', () => {
    expect(evaluateObject('age >= 18 and active = true', value)).toBe(true);
    expect(evaluateObject('name = "Alice"', value)).toBe(true);
    expect(evaluateObject('deletedAt is null', value)).toBe(true);
    expect(evaluateObject('score between 80 and 90', value)).toBe(true);
    expect(evaluateObject('length(name)', value)).toBe(5);
  });

  it('evaluates case expressions against object properties', () => {
    expect(evaluateObject("case when score >= 90 then 'A' else 'B' end", value)).toBe('B');

    expect(
      evaluateObject("case when score >= 90 then 'A' else 'B' end", {
        ...value,
        score: 95,
      }),
    ).toBe('A');
  });
});
```