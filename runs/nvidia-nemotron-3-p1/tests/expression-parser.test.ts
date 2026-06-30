import { describe, expect, test } from 'vitest'
import { evaluate, evaluateObject } from '../src/evaluator'
import { parse } from '../src/parser'
import type { Expression } from '../src/ast'

describe('Parser', () => {
  test('parses simple literals', () => {
    const ast: Expression = parse('42')
    expect(ast.type).toBe('ValueExpression')
    expect((ast as any).value).toBe(42)
  })

  test('parses strings', () => {
    const ast = parse('"hello"')
    expect(ast.type).toBe('ValueExpression')
    expect((ast as any).value).toBe('hello')
  })

  test('parses identifiers', () => {
    const ast = parse('x')
    expect(ast.type).toBe('IdentifierExpression')
    expect((ast as any).name).toBe('x')
  })

  test('parses binary addition', () => {
    const ast = parse('2 + 3')
    expect(ast.type).toBe('BinaryExpression')
    expect((ast as any).operator).toBe('+')
    expect((ast as any).left).toBeInstanceOf(Object) // ValueExpression
    expect((ast as any).right).toBeInstanceOf(Object) // ValueExpression
  })

  test('parses binary comparison', () => {
    const ast = parse('x > 10')
    expect(ast.type).toBe('BinaryExpression')
    expect((ast as any).operator).toBe('>')
  })

  test('parses logical and/or', () => {
    const ast = parse('a and b or c')
    // The parser should handle left-associativity; we just check that it parses without error
    expect(ast.type).toBe('BinaryExpression')
  })

  test('parses function calls', () => {
    const ast = parse('length("abc")')
    expect(ast.type).toBe('FunctionCallExpression')
    expect((ast as any).name).toBe('length')
    expect((ast as any).args).toHaveLength(1)
  })

  test('parses case expressions', () => {
    const ast = parse('case when 1 then "one" else "other" end')
    expect(ast.type).toBe('CaseExpression')
    // Further structure checks can be added if needed
  })
})

describe('Evaluator', () => {
  test('evaluates arithmetic with context', () => {
    const result = evaluate('x + y * 2', (id) => ({ x: 5, y: 3 })[id])
    expect(result).toBe(11)
  })

  test('evaluates boolean expressions', () => {
    const result = evaluate('age >= 18 and age < 65', (id) => ({ age: 30 })[id])
    expect(result).toBe(true)
  })

  test('evaluates equality and inequality', () => {
    const result = evaluate('name = "John"', (id) => ({ name: 'John' })[id])
    expect(result).toBe(true)
    const result2 = evaluate('name <> "John"', (id) => ({ name: 'Jane' })[id])
    expect(result2).toBe(true)
  })

  test('evaluates length function', () => {
    const result = evaluate('length("hello")')
    expect(result).toBe(5)
  })

  test('evaluates case expression', () => {
    const result = evaluate('case when x = 1 then "one" else "other" end', (id) => ({ x: 1 })[id])
    expect(result).toBe('one')
  })

  test('evaluateObject resolves values from context object', () => {
    const obj = { a: 10, b: 20 }
    const result = evaluateObject('a + b', obj)
    expect(result).toBe(30)
  })
})