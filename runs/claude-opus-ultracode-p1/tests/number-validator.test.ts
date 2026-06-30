import { describe, it, expect } from "vitest";
import NumberValidator from "../src/number-validator";
import { FailedValidationError } from "../src/interfaces";

/**
 * Tests for NumberValidator.
 *
 * These tests document the validator's ACTUAL behavior, including a few quirks
 * that fall out of the implementation (e.g. NaN passing `typeof value === "number"`,
 * `multipleOf: 0` being treated as falsy in `validate` but not in `isValid`, and
 * inclusive min/max boundaries). Where behavior is intentionally surprising it is
 * called out in the test name.
 */

const empty = () => new NumberValidator({});

describe("NumberValidator - builder methods & immutability", () => {
  it.each([
    ["min", (v: NumberValidator) => v.min(5)],
    ["max", (v: NumberValidator) => v.max(10)],
    ["multipleOf", (v: NumberValidator) => v.multipleOf(3)],
    ["integer", (v: NumberValidator) => v.integer()],
  ])("%s() returns a new instance, never the original", (_name, build) => {
    const original = empty();
    const next = build(original);
    expect(next).toBeInstanceOf(NumberValidator);
    expect(next).not.toBe(original);
  });

  it("min() does not mutate the original validator", () => {
    const original = empty();
    const limited = original.min(5);
    expect(original.validate(2)).toEqual([]);
    expect(limited.validate(2)).toEqual([
      { message: "2 must be greater than or equal to 5", path: [], value: 2 },
    ]);
  });

  it("max() does not mutate the original validator", () => {
    const original = empty();
    const limited = original.max(10);
    expect(original.validate(50)).toEqual([]);
    expect(limited.validate(50)).toEqual([
      { message: "50 must be less than or equal to 10", path: [], value: 50 },
    ]);
  });

  it("multipleOf() does not mutate the original validator", () => {
    const original = empty();
    const m = original.multipleOf(2);
    expect(original.validate(3)).toEqual([]);
    expect(m.validate(3)).toEqual([
      { message: "number was not a multiple of 2", path: [], value: 3 },
    ]);
  });

  it("integer() is an alias for multipleOf(1) (integer-specific message)", () => {
    const viaInteger = empty().integer().validate(1.5);
    const viaMultipleOf = empty().multipleOf(1).validate(1.5);
    expect(viaInteger).toEqual([
      { message: "number was not an integer", path: [], value: 1.5 },
    ]);
    expect(viaInteger).toEqual(viaMultipleOf);
  });

  it("integer() does not mutate the original validator", () => {
    const original = empty();
    original.integer();
    expect(original.validate(1.5)).toEqual([]);
  });

  it("chaining carries every constraint into one instance", () => {
    const v = empty().min(0).max(100).multipleOf(5);
    expect(v.validate(7)).toEqual([
      { message: "number was not a multiple of 5", path: [], value: 7 },
    ]);
    expect(v.validate(10)).toEqual([]);
  });

  it("an intermediate instance in a chain is unaffected by later builders", () => {
    const base = empty();
    const a = base.min(0);
    const b = a.max(10);
    // `a` only ever received min(0); the max came from a derived instance.
    expect(a.validate(50)).toEqual([]);
    expect(b.validate(50)).toEqual([
      { message: "50 must be less than or equal to 10", path: [], value: 50 },
    ]);
  });

  it.each([
    ["min", (v: NumberValidator) => v.min(0).min(10), 5, "5 must be greater than or equal to 10"],
    ["max", (v: NumberValidator) => v.max(100).max(3), 5, "5 must be less than or equal to 3"],
  ] as const)(
    "calling %s() twice keeps the last (override) value",
    (_name, build, value, message) => {
      expect(build(empty()).validate(value)).toEqual([
        { message, path: [], value },
      ]);
    }
  );

  it("multipleOf override: integer() then multipleOf(5) restores multipleOf to 5", () => {
    const v = empty().integer().multipleOf(5);
    expect(v.validate(7)).toEqual([
      { message: "number was not a multiple of 5", path: [], value: 7 },
    ]);
    // 7 is no longer rejected as a non-integer
    expect(v.validate(10)).toEqual([]);
  });

  it("builders preserve untouched options on a pre-configured validator", () => {
    const v = new NumberValidator({ min: 0, max: 100 }).multipleOf(5);
    // min/max still enforced alongside the newly added multipleOf
    expect(v.validate(-3)).toEqual([
      { message: "number was not a multiple of 5", path: [], value: -3 },
      { message: "-3 must be greater than or equal to 0", path: [], value: -3 },
    ]);
  });
});

describe("validate() - type guard for non-numbers", () => {
  const aSymbol = Symbol("s");
  const aFn = () => 0;
  it.each([
    ["string", "hello"],
    ["empty string", ""],
    ["numeric string", "42"],
    ["null", null],
    ["undefined", undefined],
    ["boolean true", true],
    ["boolean false", false],
    ["object", {}],
    ["array", []],
    ["bigint", 1n],
    ["symbol", aSymbol],
    ["function", aFn],
  ])("returns a single 'must be a number' error for %s", (_label, value) => {
    const errors = empty().validate(value as any);
    expect(errors).toEqual([{ message: "must be a number", path: [], value }]);
    expect(errors).toHaveLength(1);
  });

  it("propagates a custom path into the type error", () => {
    expect(empty().validate("x", ["a", 0])).toEqual([
      { message: "must be a number", path: ["a", 0], value: "x" },
    ]);
  });

  it("returns the type error early, ignoring any constraints", () => {
    // "5" would also violate min/max/multipleOf if it were a number, but the
    // type check returns before any constraint is evaluated.
    const v = new NumberValidator({ min: 100, max: 1, multipleOf: 7 });
    expect(v.validate("5")).toEqual([
      { message: "must be a number", path: [], value: "5" },
    ]);
  });
});

describe("validate() - min", () => {
  it("rejects a value below min with the exact message", () => {
    expect(new NumberValidator({ min: 5 }).validate(3)).toEqual([
      { message: "3 must be greater than or equal to 5", path: [], value: 3 },
    ]);
  });

  it("accepts a value equal to min (inclusive boundary)", () => {
    expect(new NumberValidator({ min: 5 }).validate(5)).toEqual([]);
  });

  it("accepts a value above min", () => {
    expect(new NumberValidator({ min: 5 }).validate(6)).toEqual([]);
  });

  it("min: 0 is still enforced (not skipped by truthiness)", () => {
    const v = new NumberValidator({ min: 0 });
    expect(v.validate(-1)).toEqual([
      { message: "-1 must be greater than or equal to 0", path: [], value: -1 },
    ]);
    expect(v.validate(0)).toEqual([]);
  });
});

describe("validate() - max", () => {
  it("rejects a value above max with the exact message", () => {
    expect(new NumberValidator({ max: 10 }).validate(11)).toEqual([
      { message: "11 must be less than or equal to 10", path: [], value: 11 },
    ]);
  });

  it("accepts a value equal to max (inclusive boundary)", () => {
    expect(new NumberValidator({ max: 10 }).validate(10)).toEqual([]);
  });

  it("accepts a value below max", () => {
    expect(new NumberValidator({ max: 10 }).validate(9)).toEqual([]);
  });

  it("max: 0 is still enforced (not skipped by truthiness)", () => {
    const v = new NumberValidator({ max: 0 });
    expect(v.validate(1)).toEqual([
      { message: "1 must be less than or equal to 0", path: [], value: 1 },
    ]);
    expect(v.validate(0)).toEqual([]);
    expect(v.validate(-1)).toEqual([]);
  });
});

describe("validate() - multipleOf / integer", () => {
  it("rejects a non-multiple with the multiple message", () => {
    expect(new NumberValidator({ multipleOf: 2 }).validate(3)).toEqual([
      { message: "number was not a multiple of 2", path: [], value: 3 },
    ]);
  });

  it("accepts a multiple", () => {
    expect(new NumberValidator({ multipleOf: 2 }).validate(4)).toEqual([]);
  });

  it("multipleOf: 1 reports the integer-specific message", () => {
    expect(new NumberValidator({ multipleOf: 1 }).validate(1.5)).toEqual([
      { message: "number was not an integer", path: [], value: 1.5 },
    ]);
    expect(new NumberValidator({ multipleOf: 1 }).validate(2)).toEqual([]);
  });

  it("supports fractional multipleOf", () => {
    expect(new NumberValidator({ multipleOf: 0.5 }).validate(1.5)).toEqual([]);
    expect(new NumberValidator({ multipleOf: 0.5 }).validate(0.7)).toEqual([
      { message: "number was not a multiple of 0.5", path: [], value: 0.7 },
    ]);
  });

  it("supports negative multipleOf (interpolated into the message)", () => {
    expect(new NumberValidator({ multipleOf: -2 }).validate(3)).toEqual([
      { message: "number was not a multiple of -2", path: [], value: 3 },
    ]);
    expect(new NumberValidator({ multipleOf: -2 }).validate(4)).toEqual([]);
  });

  it("QUIRK: multipleOf: 0 is falsy, so the check is skipped entirely", () => {
    const v = new NumberValidator({ multipleOf: 0 });
    expect(v.validate(7)).toEqual([]);
    expect(v.validate(0)).toEqual([]);
  });
});

describe("validate() - error accumulation & ordering", () => {
  it("accumulates multipleOf and min errors in [multipleOf, min] order", () => {
    const v = new NumberValidator({ multipleOf: 2, min: 10 });
    expect(v.validate(5)).toEqual([
      { message: "number was not a multiple of 2", path: [], value: 5 },
      { message: "5 must be greater than or equal to 10", path: [], value: 5 },
    ]);
  });

  it("accumulates multipleOf and max errors in [multipleOf, max] order", () => {
    const v = new NumberValidator({ multipleOf: 2, max: 10 });
    expect(v.validate(13)).toEqual([
      { message: "number was not a multiple of 2", path: [], value: 13 },
      { message: "13 must be less than or equal to 10", path: [], value: 13 },
    ]);
  });

  it("accumulates min and max errors when both are violated", () => {
    // min > max is a degenerate config; a value between them violates both.
    const v = new NumberValidator({ min: 5, max: 3 });
    expect(v.validate(4)).toEqual([
      { message: "4 must be greater than or equal to 5", path: [], value: 4 },
      { message: "4 must be less than or equal to 3", path: [], value: 4 },
    ]);
  });

  it("returns an empty array when all constraints are satisfied", () => {
    const v = new NumberValidator({ min: 0, max: 100, multipleOf: 5 });
    expect(v.validate(10)).toEqual([]);
  });
});

describe("validate() - path handling", () => {
  it("defaults the path to [] when omitted", () => {
    expect(new NumberValidator({ min: 5 }).validate(3)[0].path).toEqual([]);
  });

  it("carries the provided path into every accumulated error", () => {
    const v = new NumberValidator({ multipleOf: 2, min: 10 });
    const errors = v.validate(5, ["items", 2]);
    expect(errors.map((e) => e.path)).toEqual([
      ["items", 2],
      ["items", 2],
    ]);
  });

  it("passes the path argument through by reference (no copy)", () => {
    const path = ["a"];
    const errors = new NumberValidator({ min: 5 }).validate(3, path);
    expect(errors[0].path).toBe(path);
  });

  it("returns a fresh array on every call", () => {
    const v = empty();
    const a = v.validate(5);
    const b = v.validate(5);
    expect(a).toEqual([]);
    expect(b).toEqual([]);
    expect(a).not.toBe(b);
  });
});

describe("validate() - special numeric values", () => {
  it("QUIRK: NaN passes the type guard and, with no constraints, is treated as valid", () => {
    expect(empty().validate(NaN)).toEqual([]);
  });

  it("NaN fails a multipleOf constraint (NaN % n is NaN)", () => {
    expect(new NumberValidator({ multipleOf: 2 }).validate(NaN)).toEqual([
      { message: "number was not a multiple of 2", path: [], value: NaN },
    ]);
  });

  it("QUIRK: NaN passes min and max (NaN comparisons are always false)", () => {
    expect(new NumberValidator({ min: 5 }).validate(NaN)).toEqual([]);
    expect(new NumberValidator({ max: 5 }).validate(NaN)).toEqual([]);
    expect(new NumberValidator({ min: 0, max: 10 }).validate(NaN)).toEqual([]);
  });

  it("Infinity violates max but satisfies min", () => {
    expect(new NumberValidator({ max: 10 }).validate(Infinity)).toEqual([
      { message: "Infinity must be less than or equal to 10", path: [], value: Infinity },
    ]);
    expect(new NumberValidator({ min: 10 }).validate(Infinity)).toEqual([]);
  });

  it("-Infinity violates min but satisfies max", () => {
    expect(new NumberValidator({ min: 10 }).validate(-Infinity)).toEqual([
      { message: "-Infinity must be greater than or equal to 10", path: [], value: -Infinity },
    ]);
    expect(new NumberValidator({ max: 10 }).validate(-Infinity)).toEqual([]);
  });

  it("Infinity violates multipleOf (Infinity % n is NaN)", () => {
    expect(new NumberValidator({ multipleOf: 2 }).validate(Infinity)).toEqual([
      { message: "number was not a multiple of 2", path: [], value: Infinity },
    ]);
  });

  it("-0 behaves like 0: it is a multiple and is interpolated as '0'", () => {
    expect(new NumberValidator({ multipleOf: 2 }).validate(-0)).toEqual([]);
    expect(new NumberValidator({ min: 0 }).validate(-0)).toEqual([]);
    expect(new NumberValidator({ max: 0 }).validate(-0)).toEqual([]);
    expect(new NumberValidator({ min: 1 }).validate(-0)).toEqual([
      { message: "0 must be greater than or equal to 1", path: [], value: -0 },
    ]);
  });

  it("MAX_VALUE is treated as an even multiple; MIN_VALUE is not", () => {
    expect(new NumberValidator({ multipleOf: 2 }).validate(Number.MAX_VALUE)).toEqual([]);
    expect(new NumberValidator({ multipleOf: 2 }).validate(Number.MIN_VALUE)).toEqual([
      { message: "number was not a multiple of 2", path: [], value: Number.MIN_VALUE },
    ]);
  });
});

describe("isValid()", () => {
  it("returns a boolean, not an array", () => {
    expect(empty().isValid(5)).toBe(true);
    expect(empty().isValid("5")).toBe(false);
  });

  it.each([
    ["string", "5"],
    ["null", null],
    ["undefined", undefined],
    ["object", {}],
    ["array", []],
    ["boolean", true],
    ["bigint", 1n],
  ])("returns false for non-number %s", (_label, value) => {
    expect(empty().isValid(value)).toBe(false);
  });

  it("honors inclusive min and max boundaries", () => {
    const v = new NumberValidator({ min: 0, max: 10 });
    expect(v.isValid(0)).toBe(true);
    expect(v.isValid(10)).toBe(true);
    expect(v.isValid(5)).toBe(true);
    expect(v.isValid(-1)).toBe(false);
    expect(v.isValid(11)).toBe(false);
  });

  it("checks multipleOf, with 0 a valid multiple of any nonzero divisor", () => {
    const v = new NumberValidator({ multipleOf: 3 });
    expect(v.isValid(9)).toBe(true);
    expect(v.isValid(-9)).toBe(true);
    expect(v.isValid(0)).toBe(true);
    expect(v.isValid(8)).toBe(false);
  });

  it("combines all three clauses", () => {
    const v = new NumberValidator({ min: 0, max: 100, multipleOf: 5 });
    expect(v.isValid(50)).toBe(true);
    expect(v.isValid(7)).toBe(false); // in range but not a multiple
  });
});

describe("isValid() - documented inconsistencies with validate()", () => {
  it("multipleOf: 0 makes isValid always false, even though validate() reports no error", () => {
    const v = new NumberValidator({ multipleOf: 0 });
    // isValid: `value % 0 === 0` -> `NaN === 0` -> false, for any number.
    expect(v.isValid(4)).toBe(false);
    expect(v.isValid(0)).toBe(false);
    // validate() skips the falsy multipleOf entirely, so it sees no error.
    expect(v.validate(4)).toEqual([]);
  });

  it("NaN: isValid is true with no constraints but false once a bound exists", () => {
    expect(empty().isValid(NaN)).toBe(true);
    expect(new NumberValidator({ min: 5 }).isValid(NaN)).toBe(false);
    expect(new NumberValidator({ max: 5 }).isValid(NaN)).toBe(false);
    expect(new NumberValidator({ multipleOf: 2 }).isValid(NaN)).toBe(false);
    // ...whereas validate(NaN) reports no error for min/max bounds (see above).
    expect(new NumberValidator({ min: 5 }).validate(NaN)).toEqual([]);
  });

  it("Infinity: valid unbounded, invalid once a max or multipleOf is set", () => {
    expect(empty().isValid(Infinity)).toBe(true);
    expect(new NumberValidator({ max: 10 }).isValid(Infinity)).toBe(false);
    expect(new NumberValidator({ multipleOf: 2 }).isValid(Infinity)).toBe(false);
  });
});

describe("checkValid() (inherited, exercised through NumberValidator)", () => {
  /** Runs `fn`, returning the thrown error, or failing the test if nothing was thrown. */
  function caught(fn: () => unknown): FailedValidationError {
    try {
      fn();
    } catch (e) {
      return e as FailedValidationError;
    }
    throw new Error("expected checkValid to throw, but it returned normally");
  }

  it("returns the value unchanged when valid", () => {
    expect(new NumberValidator({ min: 0 }).checkValid(5)).toBe(5);
  });

  it("throws a FailedValidationError for an invalid value", () => {
    const v = empty();
    expect(() => v.checkValid("x")).toThrow(FailedValidationError);

    const e = caught(() => v.checkValid("x"));
    expect(e).toBeInstanceOf(FailedValidationError);
    expect(e.isFailedValidationError).toBe(true);
    expect(e.errors).toEqual([{ message: "must be a number", path: [], value: "x" }]);
    // Empty path joins to "" and is dropped, leaving just the message.
    expect(e.message).toBe("must be a number");
  });

  it("joins multiple error messages with '; '", () => {
    const v = new NumberValidator({ multipleOf: 2, min: 10 });
    const e = caught(() => v.checkValid(5));
    expect(e.errors).toHaveLength(2);
    expect(e.message).toBe(
      "number was not a multiple of 2; 5 must be greater than or equal to 10"
    );
  });

  it("prefixes a non-empty path as 'path.parts: message' and forwards the path", () => {
    const v = new NumberValidator({ min: 5 });
    const e = caught(() => v.checkValid(3, ["a", 0]));
    expect(e.errors[0].path).toEqual(["a", 0]);
    expect(e.message).toBe("a.0: 3 must be greater than or equal to 5");
  });
});

describe("toJsonSchema() / _toJsonSchema()", () => {
  it("maps options to multipleOf/minimum/maximum and strips undefined keys", () => {
    expect(new NumberValidator({ min: 1, max: 10, multipleOf: 2 }).toJsonSchema()).toStrictEqual({
      type: "number",
      multipleOf: 2,
      minimum: 1,
      maximum: 10,
    });
  });

  it("returns only { type: 'number' } when no options are set", () => {
    expect(empty().toJsonSchema()).toStrictEqual({ type: "number" });
  });

  it.each([
    ["min", { min: 0 }, { type: "number", minimum: 0 }],
    ["max", { max: 0 }, { type: "number", maximum: 0 }],
    ["multipleOf", { multipleOf: 0 }, { type: "number", multipleOf: 0 }],
  ] as const)(
    "keeps a falsy %s value of 0 (only undefined is stripped)",
    (_name, options, expected) => {
      expect(new NumberValidator(options).toJsonSchema()).toStrictEqual(expected);
    }
  );

  it("caches the result and returns the same reference on repeated calls", () => {
    const v = new NumberValidator({ min: 1 });
    const first = v.toJsonSchema();
    const second = v.toJsonSchema();
    expect(second).toBe(first);
  });

  it("_toJsonSchema() (raw) retains undefined-valued keys and is not cached", () => {
    const v = empty();
    const raw = v._toJsonSchema();
    expect(Object.keys(raw).sort()).toEqual([
      "maximum",
      "minimum",
      "multipleOf",
      "type",
    ]);
    // A fresh object each call, distinct from the cached, stripped schema.
    expect(v._toJsonSchema()).not.toBe(raw);
    expect(v.toJsonSchema()).not.toBe(raw);
  });
});
