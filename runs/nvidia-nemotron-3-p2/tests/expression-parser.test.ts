import { describe, it, expect } from 'vitest';
import { evaluate, evaluateObject } from '../src/evaluator';

describe('evaluate function', () => {
    it('parses and evaluates numeric literals', () => {
        expect(evaluate('42')).toBe(42);
    });

    it('parses and evaluates string literals', () => {
        expect(evaluate('"hello"')).toBe('hello');
    });

    it('parses and evaluates boolean literals', () => {
        expect(evaluate('true')).toBe(true);
        expect(evaluate('false')).toBe(false);
    });

    it('resolves identifiers via context', () => {
        const context = { x: 10 };
        expect(evaluate('x', context)).toBe(10);
    });

    it('evaluates binary arithmetic operations', () => {
        expect(evaluate('2 + 3')).toBe(5);
        expect(evaluate('10 - 4')).toBe(6);
        expect(evaluate('5 * 3')).toBe(15);
        expect(evaluate('20 / 4')).toBe(5);
    });

    it('evaluates comparison operators', () => {
        expect(evaluate('5 = 5')).toBe(true);
        expect(evaluate('5 <> 6')).toBe(true);
        expect(evaluate('5 > 3')).toBe(true);
        expect(evaluate('5 >= 5')).toBe(true);
        expect(evaluate('5 < 10')).toBe(true);
        expect(evaluate('5 <= 5')).toBe(true);
    });

    it('evaluates logical operators', () => {
        expect(evaluate('true and false')).toBe(false);
        expect(evaluate('true or false')).toBe(true);
        expect(evaluate('false and false')).toBe(false);
        expect(evaluate('true or true')).toBe(true);
    });

    it('evaluates case expressions', () => {
        // case when 1 = 1 then "one" when 2 = 2 then "two" else "other" end
        const expr = 'case when 1 = 1 then "one" when 2 = 2 then "two" else "other" end';
        expect(evaluate(expr)).toBe('one');

        // case when 2 = 3 then "three" else false end
        const expr2 = 'case when 2 = 3 then "three" else false end';
        expect(evaluate(expr2)).toBe(false);
    });

    it('evaluates nested expressions', () => {
        expect(evaluate('(2 + 3) * 4')).toBe(20);
        expect(evaluate('2 + 3 * 4')).toBe(14);
    });

    it('throws on unknown operator', () => {
        expect(() => evaluate('5 % 3')).toThrow('Operator % not implemented');
    });

    it('throws on unsupported function', () => {
        expect(() => evaluate('len("abc")')).toThrow('Function len not implemented');
    });
});

describe('evaluateObject', () => {
    it('evaluates expression against an object', () => {
        const obj = { a: 10, b: 20 };
        expect(evaluateObject('a + b', obj)).toBe(30);
        expect(evaluateObject('a = b', obj)).toBe(false);
    });
});