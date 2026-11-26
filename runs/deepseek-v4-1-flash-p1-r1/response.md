```ts
import { describe, it, expect } from 'vitest';
import { evaluate, evaluateObject } from '../src/evaluator';
import { parse } from '../src/parser';
import {
  BinaryExpression,
  ValueExpression,
  IdentifierExpression,
  FunctionCallExpression,
  CaseExpression,
} from '../src/ast';
import { TokenType } from '../src/token';

describe('Expression parser', () => {
  describe('Literals', () => {
    it('should evaluate numeric literals', () => {
      expect(evaluate('1')).toBe(1);
      expect(evaluate('1.5')).toBe(1.5);
      expect(evaluate('.5')).toBe(0.5);
      expect(evaluate('0')).toBe(0);
    });

    it('should evaluate string literals with double quotes', () => {
      expect(evaluate('"hello"')).toBe('hello');
      expect(evaluate('""')).toBe('');
    });

    it('should evaluate string literals with single quotes', () => {
      expect(evaluate("'world'")).toBe('world');
      expect(evaluate("''")).toBe('');
    });

    it('should evaluate boolean literals', () => {
      expect(evaluate('true')).toBe(true);
      expect(evaluate('false')).toBe(false);
    });

    it('should throw when evaluating null literal alone', () => {
      expect(() => evaluate('null')).toThrow();
    });
  });

  describe('Arithmetic operations', () => {
    it('should evaluate addition', () => {
      expect(evaluate('1 + 2')).toBe(3);
    });
    it('should evaluate subtraction', () => {
      expect(evaluate('5 - 2')).toBe(3);
    });
    it('should evaluate multiplication', () => {
      expect(evaluate('3 * 4')).toBe(12);
    });
    it('should evaluate division', () => {
      expect(evaluate('10 / 2')).toBe(5);
    });
    it('should respect precedence of multiplication over addition', () => {
      expect(evaluate('1 + 2 * 3')).toBe(7);
      expect(evaluate('2 * 3 + 1')).toBe(7);
    });
    it('should support parentheses', () => {
      expect(evaluate('(1 + 2) * 3')).toBe(9);
      expect(evaluate('((1))')).toBe(1);
    });
    it('should be left associative for subtraction and division', () => {
      expect(evaluate('10 - 2 - 3')).toBe(5);
      expect(evaluate('8 / 4 / 2')).toBe(1);
    });
  });

  describe('Comparison operations', () => {
    it('should evaluate equality', () => {
      expect(evaluate('1 = 1')).toBe(true);
      expect(evaluate('1 = 2')).toBe(false);
      expect(evaluate('"a" = "a"')).toBe(true);
      expect(evaluate('1 = "1"')).toBe(false); // strict equality
    });
    it('should evaluate inequality', () => {
      expect(evaluate('1 <> 2')).toBe(true);
      expect(evaluate('1 <> 1')).toBe(false);
    });
    it('should evaluate greater than', () => {
      expect(evaluate('2 > 1')).toBe(true);
      expect(evaluate('1 > 2')).toBe(false);
    });
    it('should evaluate less than', () => {
      expect(evaluate('1 < 2')).toBe(true);
      expect(evaluate('2 < 1')).toBe(false);
    });
    it('should evaluate greater than or equal', () => {
      expect(evaluate('1 >= 1')).toBe(true);
      expect(evaluate('1 >= 2')).toBe(false);
    });
    it('should evaluate less than or equal', () => {
      expect(evaluate('1 <= 1')).toBe(true);
      expect(evaluate('2 <= 1')).toBe(false);
    });
  });

  describe('Logical operations', () => {
    it('should evaluate and', () => {
      expect(evaluate('true and true')).toBe(true);
      expect(evaluate('true and false')).toBe(false);
      expect(evaluate('false and true')).toBe(false);
      expect(evaluate('false and false')).toBe(false);
    });
    it('should evaluate or', () => {
      expect(evaluate('true or true')).toBe(true);
      expect(evaluate('true or false')).toBe(true);
      expect(evaluate('false or true')).toBe(true);
      expect(evaluate('false or false')).toBe(false);
    });
    it('should return the actual value with && and ||', () => {
      expect(evaluate('true and 5')).toBe(5);
      expect(evaluate('false or 5')).toBe(5);
      expect(evaluate('false and 5')).toBe(false);
      expect(evaluate('true or 5')).toBe(true);
    });
    it('should respect precedence: or binds tighter than and in this implementation', () => {
      // According to precedences: Or=2, And=1. So "true or false and false" is parsed as (true or false) and false -> false
      expect(evaluate('true or false and false')).toBe(false);
      // With parentheses we can force different result
      expect(evaluate('true or (false and false)')).toBe(true);
    });
  });

  describe('Between', () => {
    it('should evaluate between with numeric literals', () => {
      expect(evaluate('5 between 1 and 10')).toBe(true);
      expect(evaluate('0 between 1 and 10')).toBe(false);
      expect(evaluate('11 between 1 and 10')).toBe(false);
      expect(evaluate('5 between 5 and 5')).toBe(true);
    });
    it('should work with identifiers', () => {
      expect(evaluate('x between 1 and 10', (name) => ({ x: 5 }[name]))).toBe(true);
      expect(evaluate('x between 1 and 10', (name) => ({ x: 0 }[name]))).toBe(false);
    });
    it('should throw if min or max are not numeric literals', () => {
      expect(() => evaluate("5 between 'a' and 'b'")).toThrow();
    });
  });

  describe('Is null', () => {
    it('should evaluate is null', () => {
      expect(evaluate('x is null', (name) => ({ x: null }[name]))).toBe(true);
      expect(evaluate('x is null', (name) => ({ x: 1 }[name]))).toBe(false);
    });
    it('should evaluate is not null', () => {
      expect(evaluate('x is not null', (name) => ({ x: null }[name]))).toBe(false);
      expect(evaluate('x is not null', (name) => ({ x: 1 }[name]))).toBe(true);
    });
  });

  describe('Identifiers and context', () => {
    it('should evaluate identifiers using context', () => {
      expect(evaluate('x', (name) => ({ x: 10 }[name]))).toBe(10);
      expect(evaluate('x + y', (name) => ({ x: 1, y: 2 }[name]))).toBe(3);
    });
    it('should throw when identifier is used without context', () => {
      expect(() => evaluate('x')).toThrow();
    });
    it('should evaluate using evaluateObject', () => {
      expect(evaluateObject('x', { x: 10 })).toBe(10);
      expect(evaluateObject('x + y', { x: 1, y: 2 })).toBe(3);
      expect(evaluateObject('x is null', { x: null })).toBe(true);
    });
  });

  describe('Functions', () => {
    it('should evaluate length function', () => {
      expect(evaluate('length("hello")')).toBe(5);
      expect(evaluate("length('')")).toBe(0);
      expect(evaluate('length(x)', (name) => ({ x: 'abcd' }[name]))).toBe(4);
    });
    it('should throw for wrong number of arguments', () => {
      expect(() => evaluate('length()')).toThrow('Length function takes exactly one argument.');
      expect(() => evaluate('length("a", "b")')).toThrow('Length function takes exactly one argument.');
    });
    it('should throw for unknown function', () => {
      expect(() => evaluate('unknown("a")')).toThrow('Function unknown not implemented');
    });
    it('should support nested function calls and expressions', () => {
      expect(evaluate('length("hello") + 1')).toBe(6);
    });
  });

  describe('Case expressions', () => {
    it('should evaluate case with else', () => {
      expect(evaluate("case when 1 = 1 then 'a' else 'b' end")).toBe('a');
      expect(evaluate("case when 1 = 2 then 'a' else 'b' end")).toBe('b');
    });
    it('should evaluate case with multiple whens', () => {
      expect(evaluate("case when 1 = 2 then 'a' when 1 = 1 then 'b' else 'c' end")).toBe('b');
      expect(evaluate("case when 1 = 2 then 'a' when 2 = 2 then 'b' else 'c' end")).toBe('b');
    });
    it('should return false if no condition matches and no else', () => {
      expect(evaluate("case when 1 = 2 then 'a' end")).toBe(false);
    });
    it('should work with identifiers', () => {
      expect(evaluate("case when x > 5 then 'big' else 'small' end", (name) => ({ x: 10 }[name]))).toBe('big');
      expect(evaluate("case when x > 5 then 'big' else 'small' end", (name) => ({ x: 2 }[name]))).toBe('small');
    });
  });

  describe('parse function', () => {
    it('should parse numeric literal', () => {
      const ast = parse('1');
      expect(ast).toBeInstanceOf(ValueExpression);
      expect((ast as ValueExpression).value).toBe(1);
    });
    it('should parse identifier', () => {
      const ast = parse('x');
      expect(ast).toBeInstanceOf(IdentifierExpression);
      expect((ast as IdentifierExpression).name).toBe('x');
    });
    it('should parse binary expression with correct precedence', () => {
      const ast = parse('1 + 2 * 3');
      expect(ast).toBeInstanceOf(BinaryExpression);
      const bin = ast as BinaryExpression;
      expect(bin.operator).toBe(TokenType.Plus);
      expect(bin.left).toBeInstanceOf(ValueExpression);
      expect((bin.left as ValueExpression).value).toBe(1);
      expect(bin.right).toBeInstanceOf(BinaryExpression);
      const rightBin = bin.right as BinaryExpression;
      expect(rightBin.operator).toBe(TokenType.Mul);
      expect((rightBin.left as ValueExpression).value).toBe(2);
      expect((rightBin.right as ValueExpression).value).toBe(3);
    });
    it('should parse function call', () => {
      const ast = parse('length(x)');
      expect(ast).toBeInstanceOf(FunctionCallExpression);
      const fn = ast as FunctionCallExpression;
      expect(fn.name).toBe('length');
      expect(fn.args).toHaveLength(1);
      expect(fn.args[0]).toBeInstanceOf(IdentifierExpression);
      expect((fn.args[0] as IdentifierExpression).name).toBe('x');
    });
    it('should parse case expression', () => {
      const ast = parse("case when 1 = 1 then 'a' else 'b' end");
      expect(ast).toBeInstanceOf(CaseExpression);
      const caseExpr = ast as CaseExpression;
      expect(caseExpr.conditions).toHaveLength(1);
      expect(caseExpr.conditions[0].when).toBeInstanceOf(BinaryExpression);
      expect(caseExpr.conditions[0].then).toBeInstanceOf(ValueExpression);
      expect((caseExpr.conditions[0].then as ValueExpression).value).toBe('a');
      expect(caseExpr.last).toBeInstanceOf(ValueExpression);
      expect((caseExpr.last as ValueExpression).value).toBe('b');
    });
    it('should parse between as AND of >= and <=', () => {
      const ast = parse('x between 1 and 5');
      expect(ast).toBeInstanceOf(BinaryExpression);
      const andExpr = ast as BinaryExpression;
      expect(andExpr.operator).toBe(TokenType.And);
      expect(andExpr.left).toBeInstanceOf(BinaryExpression);
      const left = andExpr.left as BinaryExpression;
      expect(left.operator).toBe(TokenType.Gte);
      expect(left.left).toBeInstanceOf(IdentifierExpression);
      expect((left.left as IdentifierExpression).name).toBe('x');
      expect((left.right as ValueExpression).value).toBe(1);
      expect(andExpr.right).toBeInstanceOf(BinaryExpression);
      const right = andExpr.right as BinaryExpression;
      expect(right.operator).toBe(TokenType.Lte);
      expect(right.left).toBeInstanceOf(IdentifierExpression);
      expect((right.left as IdentifierExpression).name).toBe('x');
      expect((right.right as ValueExpression).value).toBe(5);
    });
    it('should parse is null', () => {
      const ast = parse('x is null');
      expect(ast).toBeInstanceOf(BinaryExpression);
      const bin = ast as BinaryExpression;
      expect(bin.operator).toBe(TokenType.Eq);
      expect(bin.left).toBeInstanceOf(IdentifierExpression);
      expect(bin.right).toBeInstanceOf(ValueExpression);
      expect((bin.right as ValueExpression).value).toBeNull();
    });
    it('should parse is not null', () => {
      const ast = parse('x is not null');
      expect(ast).toBeInstanceOf(BinaryExpression);
      const bin = ast as BinaryExpression;
      expect(bin.operator).toBe(TokenType.Neq);
      expect(bin.left).toBeInstanceOf(IdentifierExpression);
      expect(bin.right).toBeInstanceOf(ValueExpression);
      expect((bin.right as ValueExpression).value).toBeNull();
    });
  });

  describe('Error handling', () => {
    it('should throw on empty expression', () => {
      expect(() => evaluate('')).toThrow();
    });
    it('should throw on invalid syntax', () => {
      expect(() => evaluate('1 +')).toThrow();
      expect(() => evaluate('(1 + 2')).toThrow();
      expect(() => evaluate('1 + &')).toThrow();
    });
    it('should throw on unknown function', () => {
      expect(() => evaluate('unknown()')).toThrow();
    });
    it('should throw on invalid case expression', () => {
      expect(() => evaluate("case else 'a' end")).toThrow();
    });
  });
});
```