import { describe, expect, it, vi } from "vitest";
import {
  BinaryExpression,
  CaseExpression,
  FunctionCallExpression,
  IdentifierExpression,
  ValueExpression,
} from "../src/ast";
import { evaluate, evaluateObject } from "../src/evaluator";
import { parse } from "../src/parser";
import { TokenType } from "../src/token";

vi.mock("../src/parser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/parser")>();

  return {
    ...actual,
    parse: vi.fn((expression: string) => {
      if (expression === "__invalid_ast__") {
        return { type: "UnaryExpression" } as any;
      }

      if (expression === "__invalid_operator__") {
        return {
          type: "BinaryExpression",
          operator: "not",
          left: { type: "ValueExpression", value: 1 },
          right: { type: "ValueExpression", value: 2 },
        } as any;
      }

      return actual.parse(expression);
    }),
  };
});

describe("lexing behavior", () => {
  it.each([
    ["space", " "],
    ["tab", "\t"],
    ["newline", "\n"],
    ["carriage return", "\r"],
  ])("skips %s whitespace", (_label, whitespace) => {
    expect(evaluate(`${whitespace}42`), "whitespace should not affect the value").toBe(42);
  });

  it.each([
    ["uppercase letters", "ABC"],
    ["lowercase letters", "abc"],
    ["underscore", "a_b"],
  ])("parses %s in an identifier", (_label, text) => {
    expect(parse(text), "identifier literal should be preserved").toEqual(new IdentifierExpression(text));
  });

  it.each([
    ["zero", "0", 0],
    ["nine", "9", 9],
    ["integer", "42", 42],
    ["decimal", "3.14", 3.14],
    ["leading decimal point", ".5", 0.5],
  ])("parses %s numeric literal", (_label, expression, expected) => {
    expect(parse(expression), "numeric literal should become a ValueExpression").toEqual(new ValueExpression(expected));
  });

  it("stops a numeric literal at a second decimal point", () => {
    expect(parse("1.2.3"), "the parser should only consume the first decimal number").toEqual(new ValueExpression(1.2));
  });

  it.each([
    ["single quotes", "'hello'", "hello"],
    ["double quotes", '"hello"', "hello"],
    ["empty single quotes", "''", ""],
    ["unterminated single quote", "'hello", "hello"],
  ])("parses %s string literal", (_label, expression, expected) => {
    expect(parse(expression), "string literal should be unquoted").toEqual(new ValueExpression(expected));
  });

  it("treats keywords case-insensitively", () => {
    expect(evaluate("TRUE"), "TRUE should be lexed as the true keyword").toBe(true);
  });

  it.each([
    ["below the digit range", "!"],
    ["above the digit range", "@"],
  ])("rejects an illegal character %s", (_label, char) => {
    expect(() => parse(`foo(1 ${char})`), "illegal characters should be rejected when advanced over").toThrow(
      "Invalid input",
    );
  });

  it("rejects an unsupported prefix token", () => {
    expect(() => parse("not true"), "not has no prefix parser").toThrow("Unexpected start of expression");
  });
});

describe("parse API", () => {
  it("parses true as a boolean value", () => {
    expect(parse("true"), "true should be a ValueExpression").toEqual(new ValueExpression(true));
  });

  it("parses false as a boolean value", () => {
    expect(parse("false"), "false should be a ValueExpression").toEqual(new ValueExpression(false));
  });

  it("parses multiplication before addition", () => {
    expect(parse("1 + 2 * 3"), "multiplication has higher precedence than addition").toEqual(
      new BinaryExpression(
        TokenType.Plus,
        new ValueExpression(1),
        new BinaryExpression(TokenType.Mul, new ValueExpression(2), new ValueExpression(3)),
      ),
    );
  });

  it("parses grouped expressions before multiplication", () => {
    expect(parse("(1 + 2) * 3"), "parentheses should override precedence").toEqual(
      new BinaryExpression(
        TokenType.Mul,
        new BinaryExpression(TokenType.Plus, new ValueExpression(1), new ValueExpression(2)),
        new ValueExpression(3),
      ),
    );
  });

  it("parses logical or with higher precedence than and", () => {
    expect(parse("true or false and true"), "the precedence map gives or a higher value than and").toEqual(
      new BinaryExpression(
        TokenType.And,
        new BinaryExpression(TokenType.Or, new ValueExpression(true), new ValueExpression(false)),
        new ValueExpression(true),
      ),
    );
  });

  it("parses is null as equality with null", () => {
    expect(parse("a is null"), "is null should become an Eq comparison").toEqual(
      new BinaryExpression(TokenType.Eq, new IdentifierExpression("a"), new ValueExpression(null)),
    );
  });

  it("parses is not null as inequality with null", () => {
    expect(parse("a is not null"), "is not null should become a Neq comparison").toEqual(
      new BinaryExpression(TokenType.Neq, new IdentifierExpression("a"), new ValueExpression(null)),
    );
  });

  it("parses between as joined >= and <= comparisons", () => {
    expect(parse("5 between 1 and 10"), "between should expand to two comparisons joined by and").toEqual(
      new BinaryExpression(
        TokenType.And,
        new BinaryExpression(TokenType.Gte, new ValueExpression(5), new ValueExpression(1)),
        new BinaryExpression(TokenType.Lte, new ValueExpression(5), new ValueExpression(10)),
      ),
    );
  });

  it("parses a function call with one argument", () => {
    expect(parse("length('abc')"), "function calls should capture name and arguments").toEqual(
      new FunctionCallExpression("length", [new ValueExpression("abc")]),
    );
  });

  it("parses a function call with no arguments", () => {
    expect(parse("length()"), "empty argument lists should be captured").toEqual(
      new FunctionCallExpression("length", []),
    );
  });

  it("stops when a peek token has precedence but no infix parser", () => {
    expect(parse("a not true"), "not has precedence but no infix parser, so parsing stops at a").toEqual(
      new IdentifierExpression("a"),
    );
  });

  it("throws when a grouped expression is missing its closing parenthesis", () => {
    expect(() => parse("(1 + 2"), "missing ) should be reported").toThrow("Expected )");
  });

  it("throws when between is missing a numeric lower bound", () => {
    expect(() => parse("5 between a and 10"), "between requires numeric bounds").toThrow("Expected NUM");
  });

  it("throws when is null is malformed", () => {
    expect(() => parse("a is 1"), "is must be followed by null").toThrow("Expected null");
  });

  it("throws when function arguments are missing a comma", () => {
    expect(() => parse("fn(1 2)"), "adjacent arguments should be rejected").toThrow("Expected , or )");
  });

  it("throws on a second function argument", () => {
    expect(() => parse("fn(1, 2)"), "the parser does not advance past commas").toThrow(
      "Unexpected start of expression",
    );
  });
});

describe("evaluate arithmetic and comparison operators", () => {
  it.each([
    ["addition", "7 + 5", 12],
    ["subtraction", "7 - 5", 2],
    ["multiplication", "7 * 5", 35],
    ["division", "7 / 5", 1.4],
    ["operator precedence", "2 + 3 * 4", 14],
    ["parenthesized precedence", "(2 + 3) * 4", 20],
  ])("evaluates %s", (_label, expression, expected) => {
    expect(evaluate(expression), "arithmetic should return the computed number").toBe(expected);
  });

  it.each([
    ["equal when values match", "7 = 7", true],
    ["equal when values differ", "7 = 8", false],
    ["not equal when values match", "7 <> 7", false],
    ["not equal when values differ", "7 <> 8", true],
    ["greater than when above", "7 > 6", true],
    ["greater than at boundary", "7 > 7", false],
    ["greater than or equal at boundary", "7 >= 7", true],
    ["greater than or equal when below", "7 >= 8", false],
    ["less than when below", "7 < 8", true],
    ["less than at boundary", "7 < 7", false],
    ["less than or equal at boundary", "7 <= 7", true],
    ["less than or equal when above", "7 <= 6", false],
  ])("evaluates %s", (_label, expression, expected) => {
    expect(evaluate(expression), "comparison should return the expected boolean").toBe(expected);
  });
});

describe("evaluate logical operators", () => {
  it.each([
    ["and with both true", "true and true", true],
    ["and with left false", "false and true", false],
    ["and with right false", "true and false", false],
    ["or with both false", "false or false", false],
    ["or with left true", "true or false", true],
    ["or with right true", "false or true", true],
  ])("evaluates %s", (_label, expression, expected) => {
    expect(evaluate(expression), "logical expression should return the expected boolean").toBe(expected);
  });

  it("short-circuits and when the left side is false", () => {
    expect(evaluate("false and missing"), "right side should not be evaluated").toBe(false);
  });

  it("short-circuits or when the left side is true", () => {
    expect(evaluate("true or missing"), "right side should not be evaluated").toBe(true);
  });
});

describe("identifiers and context", () => {
  it("resolves identifiers through the context callback", () => {
    expect(evaluate("a + 1", (name) => (name === "a" ? 2 : 0)), "context callback should resolve a").toBe(3);
  });

  it("reads a property with evaluateObject", () => {
    expect(evaluateObject("age", { age: 42 }), "evaluateObject should look up the identifier name").toBe(42);
  });

  it("returns undefined for a missing property with evaluateObject", () => {
    expect(evaluateObject("missing", {}), "missing properties should be undefined").toBeUndefined();
  });
});

describe("function calls", () => {
  it("evaluates length with a literal argument", () => {
    expect(evaluate("length('hello')"), "length should return the string length").toBe(5);
  });

  it("evaluates length with a context argument", () => {
    expect(evaluateObject("length(name)", { name: "abc" }), "function arguments should be evaluated with context").toBe(
      3,
    );
  });

  it("throws when length has no arguments", () => {
    expect(() => evaluate("length()"), "length requires exactly one argument").toThrow(
      "Length function takes exactly one argument.",
    );
  });

  it("throws for an unimplemented function", () => {
    expect(() => evaluate("upper('a')"), "unknown functions should be rejected").toThrow(
      "Function upper not implemented",
    );
  });
});

describe("is null expressions", () => {
  it.each([
    ["null property", null, true],
    ["zero property", 0, false],
    ["undefined property", undefined, false],
  ])("evaluates is null for a %s", (_label, propertyValue, expected) => {
    expect(evaluateObject("a is null", { a: propertyValue }), "is null should compare strictly with null").toBe(
      expected,
    );
  });

  it.each([
    ["non-null property", 0, true],
    ["null property", null, false],
  ])("evaluates is not null for a %s", (_label, propertyValue, expected) => {
    expect(evaluateObject("a is not null", { a: propertyValue }), "is not null should compare strictly with null").toBe(
      expected,
    );
  });
});

describe("between expressions", () => {
  it.each([
    ["inside the range", "5 between 1 and 10", true],
    ["at the lower boundary", "1 between 1 and 10", true],
    ["at the upper boundary", "10 between 1 and 10", true],
    ["below the lower boundary", "0 between 1 and 10", false],
    ["above the upper boundary", "11 between 1 and 10", false],
  ])("evaluates %s", (_label, expression, expected) => {
    expect(evaluate(expression), "between should include its boundaries").toBe(expected);
  });
});

describe("case expressions", () => {
  it("parses a case expression with else", () => {
    expect(parse("case when 1 = 1 then 'yes' else 'no' end"), "case should capture when/then pairs and else").toEqual(
      new CaseExpression(
        [
          {
            when: new BinaryExpression(TokenType.Eq, new ValueExpression(1), new ValueExpression(1)),
            then: new ValueExpression("yes"),
          },
        ],
        new ValueExpression("no"),
      ),
    );
  });

  it("parses a case expression without else", () => {
    expect(parse("case when 1 = 2 then 'first' end"), "last should be undefined when there is no else").toEqual(
      new CaseExpression(
        [
          {
            when: new BinaryExpression(TokenType.Eq, new ValueExpression(1), new ValueExpression(2)),
            then: new ValueExpression("first"),
          },
        ],
        undefined,
      ),
    );
  });

  it("evaluates the first matching when branch", () => {
    expect(
      evaluate("case when 1 = 1 then 'first' when 1 = 2 then 'second' else 'fallback' end"),
      "the first truthy when should win",
    ).toBe("first");
  });

  it("evaluates a later matching when branch", () => {
    expect(
      evaluate("case when 1 = 2 then 'first' when 2 = 2 then 'second' else 'fallback' end"),
      "later when branches should be considered after earlier false branches",
    ).toBe("second");
  });

  it("evaluates else when no when branch matches", () => {
    expect(evaluate("case when 1 = 2 then 'first' else 'fallback' end"), "else should be used when no when matches").toBe(
      "fallback",
    );
  });

  it("returns false when no when branch matches and there is no else", () => {
    expect(evaluate("case when 1 = 2 then 'first' end"), "case without else should return false when unmatched").toBe(
      false,
    );
  });

  it("resolves identifiers in case expressions", () => {
    expect(
      evaluateObject("case when age >= 18 then 'adult' else 'minor' end", { age: 18 }),
      "case conditions should use the evaluation context",
    ).toBe("adult");
  });

  it("throws when case does not start with when", () => {
    expect(() => parse("case 1 end"), "case must start with when").toThrow("Expected when");
  });

  it("throws when then is missing", () => {
    expect(() => parse("case when 1 2 end"), "when must be followed by then").toThrow("Expected then");
  });

  it("throws when end is missing after else", () => {
    expect(() => parse("case when 1 = 1 then 'a' else 'b'"), "case must end with end").toThrow("Expected end");
  });
});

describe("evaluator defensive branches", () => {
  it("throws for an unsupported AST node type", () => {
    expect(() => evaluate("__invalid_ast__"), "unknown AST nodes should be rejected").toThrow("Invalid AST node");
  });

  it("throws for an unsupported binary operator", () => {
    expect(() => evaluate("__invalid_operator__"), "unknown binary operators should be rejected").toThrow(
      "Operator not implemented",
    );
  });
});
