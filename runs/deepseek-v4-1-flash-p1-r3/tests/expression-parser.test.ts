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

describe('parse', () => {
  it('parses literal expressions', () => {
    expect(parse('42')).toEqual(new ValueExpression(42));
    expect(parse('3.14')).toEqual(new ValueExpression(3.14));
    expect(parse('"hello"')).toEqual(new ValueExpression('hello'));
    expect(parse("'world'")).toEqual(new ValueExpression('world'));
    expect(parse('true')).toEqual(new ValueExpression(true));
    expect(parse('false')).toEqual(new ValueExpression(false));
  });

  it('parses arithmetic expressions with precedence', () => {
    expect(parse('1 + 2 * 3')).toEqual(
      new BinaryExpression(
        TokenType.Plus,
        new ValueExpression(1),
        new BinaryExpression(
          TokenType.Mul,
          new ValueExpression(2),
          new ValueExpression(3),
        ),
      ),
    );
  });

  it('parses grouped expressions', () => {
    expect(parse('(1 + 2) * 3')).toEqual(
      new BinaryExpression(
        TokenType.Mul,
        new BinaryExpression(
          TokenType.Plus,
          new ValueExpression(1),
          new ValueExpression(2),
        ),
        new ValueExpression(3),
      ),
    );
  });

  it('parses comparisons and logical operators', () => {
    expect(parse('age >= 18 and active = true')).toEqual(
      new BinaryExpression(
        TokenType.And,
        new BinaryExpression(
          TokenType.Gte,
          new IdentifierExpression('age'),
          new ValueExpression(18),
        ),
        new BinaryExpression(
          TokenType.Eq,
          new IdentifierExpression('active'),
          new ValueExpression(true),
        ),
      ),
    );
  });

  it('parses function calls', () => {
    expect(parse('length(name)')).toEqual(
      new FunctionCallExpression('length', [
        new IdentifierExpression('name'),
      ]),
    );

    expect(parse('noop()')).toEqual(new FunctionCallExpression('noop', []));
  });

  it('parses null checks', () => {
    expect(parse('value is null')).toEqual(
      new BinaryExpression(
        TokenType.Eq,
        new IdentifierExpression('value'),
        new ValueExpression(null),
      ),
    );

    expect(parse('value is not null')).toEqual(
      new BinaryExpression(
        TokenType.Neq,
        new IdentifierExpression('value'),
        new ValueExpression(null),
      ),
    );
  });

  it('parses between expressions', () => {
    expect(parse('age between 18 and 30')).toEqual(
      new BinaryExpression(
        TokenType.And,
        new BinaryExpression(
          TokenType.Gte,
          new IdentifierExpression('age'),
          new ValueExpression(18),
        ),
        new BinaryExpression(
          TokenType.Lte,
          new IdentifierExpression('age'),
          new ValueExpression(30),
        ),
      ),
    );
  });

  it('parses case expressions', () => {
    expect(
      parse(
        'case when score >= 90 then "A" when score >= 80 then "B" else "C" end',
      ),
    ).toEqual(
      new CaseExpression(
        [
          {
            when: new BinaryExpression(
              TokenType.Gte,
              new IdentifierExpression('score'),
              new ValueExpression(90),
            ),
            then: new ValueExpression('A'),
          },
          {
            when: new BinaryExpression(
              TokenType.Gte,
              new IdentifierExpression('score'),
              new ValueExpression(80),
            ),
            then: new ValueExpression('B'),
          },
        ],
        new ValueExpression('C'),
      ),
    );
  });

  it('throws on invalid syntax', () => {
    expect(() => parse('')).toThrow('Unexpected start of expression');
    expect(() => parse('1 +')).toThrow('Unexpected start of expression');
    expect(() => parse('(1 + 2')).toThrow('Expected )');
  });
});

describe('evaluate', () => {
  it('evaluates arithmetic expressions', () => {
    expect(evaluate('1 + 2 * 3')).toBe(7);
    expect(evaluate('(1 + 2) * 3')).toBe(9);
    expect(evaluate('10 / 2 - 3')).toBe(2);
  });

  it('evaluates comparison operators', () => {
    expect(evaluate('2 = 2')).toBe(true);
    expect(evaluate('2 <> 3')).toBe(true);
    expect(evaluate('3 > 2')).toBe(true);
    expect(evaluate('3 >= 3')).toBe(true);
    expect(evaluate('2 < 3')).toBe(true);
    expect(evaluate('2 <= 2')).toBe(true);
    expect(evaluate('"a" = "b"')).toBe(false);
  });

  it('evaluates identifiers with context and boolean logic', () => {
    const values: Record<string, any> = {
      age: 20,
      active: true,
      name: 'Ada',
      score: 85,
    };
    const context = (name: string) => values[name];

    expect(evaluate('age >= 18 and active = true', context)).toBe(true);
    expect(evaluate('age < 18 or active = false', context)).toBe(false);
    expect(evaluate('name = "Ada" and age = 20', context)).toBe(true);
    expect(evaluate('true and false')).toBe(false);
    expect(evaluate('true or false')).toBe(true);
  });

  it('evaluates null checks', () => {
    expect(evaluateObject('value is null', { value: null })).toBe(true);
    expect(evaluateObject('value is not null', { value: null })).toBe(false);
    expect(evaluateObject('value is not null', { value: 0 })).toBe(true);
  });

  it('evaluates between expressions', () => {
    expect(evaluate('5 between 1 and 10')).toBe(true);
    expect(evaluate('0 between 1 and 10')).toBe(false);
    expect(evaluateObject('age between 18 and 30', { age: 25 })).toBe(true);
    expect(evaluateObject('age between 18 and 30', { age: 35 })).toBe(false);
  });

  it('evaluates function calls', () => {
    expect(evaluate('length("hello")')).toBe(5);
    expect(evaluateObject('length(name)', { name: 'Ada' })).toBe(3);
  });

  it('evaluates case expressions', () => {
    expect(
      evaluateObject(
        'case when score >= 90 then "A" when score >= 80 then "B" else "C" end',
        { score: 85 },
      ),
    ).toBe('B');

    expect(
      evaluateObject(
        'case when score >= 95 then "A" else "C" end',
        { score: 85 },
      ),
    ).toBe('C');

    expect(evaluate('case when false then "A" end')).toBe(false);
  });

  it('evaluates object properties with evaluateObject', () => {
    const value = {
      price: 3,
      quantity: 4,
      active: true,
      age: 20,
    };

    expect(evaluateObject('price * quantity', value)).toBe(12);
    expect(evaluateObject('active and age >= 18', value)).toBe(true);
    expect(evaluateObject('isActive = true', { isActive: true })).toBe(true);
    expect(evaluateObject('name', { name: 'Ada' })).toBe('Ada');
  });

  it('throws for unknown functions and invalid length calls', () => {
    expect(() => evaluate('unknownFunction(1)')).toThrow(
      'Function unknownFunction not implemented',
    );

    expect(() => evaluate('length()')).toThrow(
      'Length function takes exactly one argument.',
    );
  });

  it('throws when an identifier is evaluated without a context', () => {
    expect(() => evaluate('missing')).toThrow();
  });
});
