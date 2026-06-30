import { describe, it, expect } from "vitest";
import NumberValidator from "../src/number-validator";
import { FailedValidationError } from "../src/interfaces";

const make = () => new NumberValidator({});

describe("validate: typeof guard (non-number)", () => {
  it.each([
    ["string", "5"],
    ["boolean", true],
    ["null", null],
    ["undefined", undefined],
    ["object", {}],
    ["array", []],
  ])("rejects a %s value with the exact must-be-a-number error", (_label, value) => {
    expect(make().validate(value)).toEqual([
      { message: "must be a number", path: [], value },
    ]);
  });

  it("returns early for a non-number even when min, max and multipleOf are all set", () => {
    const v = new NumberValidator({ min: 10, max: 20, multipleOf: 3 });
    expect(v.validate("nope")).toEqual([
      { message: "must be a number", path: [], value: "nope" },
    ]);
  });

  it("passes the provided path through into the error", () => {
    expect(make().validate("x", ["a", 0])).toEqual([
      { message: "must be a number", path: ["a", 0], value: "x" },
    ]);
  });

  it("defaults the path to an empty array when none is given", () => {
    expect(make().validate("x")[0].path).toEqual([]);
  });

  it("passes the same path array through by reference", () => {
    const path = ["a", 0];
    expect(make().validate("x", path)[0].path).toBe(path);
  });
});

describe("validate: no constraints", () => {
  it("returns an empty array for a plain number", () => {
    expect(make().validate(42)).toEqual([]);
  });

  it("returns an empty array for NaN when unconstrained", () => {
    expect(make().validate(NaN)).toEqual([]);
  });

  it("returns an empty array for zero when unconstrained", () => {
    expect(make().validate(0)).toEqual([]);
  });
});

describe("validate: multipleOf", () => {
  it("accepts an exact multiple", () => {
    expect(new NumberValidator({ multipleOf: 3 }).validate(9)).toEqual([]);
  });

  it("rejects a non-multiple with the exact multiple-of message", () => {
    expect(new NumberValidator({ multipleOf: 3 }).validate(8)).toEqual([
      { message: "number was not a multiple of 3", path: [], value: 8 },
    ]);
  });

  it("distinguishes modulo from multiplication (9 % 3 === 0 but 9 * 3 !== 0)", () => {
    expect(new NumberValidator({ multipleOf: 3 }).validate(9)).toEqual([]);
  });

  it("treats zero as a multiple of any divisor", () => {
    expect(new NumberValidator({ multipleOf: 3 }).validate(0)).toEqual([]);
  });

  it("emits the integer message when multipleOf is exactly 1", () => {
    expect(new NumberValidator({ multipleOf: 1 }).validate(1.5)).toEqual([
      { message: "number was not an integer", path: [], value: 1.5 },
    ]);
  });

  it("does not emit the integer message for a non-1 divisor", () => {
    expect(new NumberValidator({ multipleOf: 2 }).validate(3)).toEqual([
      { message: "number was not a multiple of 2", path: [], value: 3 },
    ]);
  });

  it("interpolates a negative divisor into the message", () => {
    expect(new NumberValidator({ multipleOf: -2 }).validate(3)).toEqual([
      { message: "number was not a multiple of -2", path: [], value: 3 },
    ]);
  });

  it("interpolates a fractional divisor into the message", () => {
    expect(new NumberValidator({ multipleOf: 0.5 }).validate(0.3)).toEqual([
      { message: "number was not a multiple of 0.5", path: [], value: 0.3 },
    ]);
  });

  it("accepts an integer when multipleOf is 1", () => {
    expect(new NumberValidator({ multipleOf: 1 }).validate(4)).toEqual([]);
  });
});

describe("validate: multipleOf 0 is falsy and skips the check", () => {
  it.each([
    ["non-zero integer", 7],
    ["zero", 0],
    ["fraction", 1.5],
  ])("returns no error for a %s when multipleOf is 0", (_label, value) => {
    expect(new NumberValidator({ multipleOf: 0 }).validate(value)).toEqual([]);
  });
});

describe("validate: min (inclusive)", () => {
  it("rejects a value below min with the exact message", () => {
    expect(new NumberValidator({ min: 5 }).validate(4)).toEqual([
      { message: "4 must be greater than or equal to 5", path: [], value: 4 },
    ]);
  });

  it("accepts a value equal to min", () => {
    expect(new NumberValidator({ min: 5 }).validate(5)).toEqual([]);
  });

  it("accepts a value above min", () => {
    expect(new NumberValidator({ min: 5 }).validate(6)).toEqual([]);
  });

  it("enforces min of 0: rejects -1", () => {
    expect(new NumberValidator({ min: 0 }).validate(-1)).toEqual([
      { message: "-1 must be greater than or equal to 0", path: [], value: -1 },
    ]);
  });

  it("enforces min of 0: accepts 0", () => {
    expect(new NumberValidator({ min: 0 }).validate(0)).toEqual([]);
  });
});

describe("validate: max (inclusive)", () => {
  it("rejects a value above max with the exact message", () => {
    expect(new NumberValidator({ max: 5 }).validate(6)).toEqual([
      { message: "6 must be less than or equal to 5", path: [], value: 6 },
    ]);
  });

  it("accepts a value equal to max", () => {
    expect(new NumberValidator({ max: 5 }).validate(5)).toEqual([]);
  });

  it("accepts a value below max", () => {
    expect(new NumberValidator({ max: 5 }).validate(4)).toEqual([]);
  });

  it("enforces max of 0: rejects 1", () => {
    expect(new NumberValidator({ max: 0 }).validate(1)).toEqual([
      { message: "1 must be less than or equal to 0", path: [], value: 1 },
    ]);
  });

  it("enforces max of 0: accepts 0", () => {
    expect(new NumberValidator({ max: 0 }).validate(0)).toEqual([]);
  });
});

describe("validate: error accumulation order is [multipleOf, min, max]", () => {
  it("orders multipleOf before min when both are violated", () => {
    expect(new NumberValidator({ min: 10, multipleOf: 2 }).validate(5)).toEqual([
      { message: "number was not a multiple of 2", path: [], value: 5 },
      { message: "5 must be greater than or equal to 10", path: [], value: 5 },
    ]);
  });

  it("orders min before max when both are violated (no multipleOf)", () => {
    const v = new NumberValidator({ min: 10, max: 20 });
    expect(v.validate(5)).toEqual([
      { message: "5 must be greater than or equal to 10", path: [], value: 5 },
    ]);
  });

  it("emits all three errors in [multipleOf, min, max] order", () => {
    const v = new NumberValidator({ multipleOf: 2, min: 10, max: 4 });
    expect(v.validate(5)).toEqual([
      { message: "number was not a multiple of 2", path: [], value: 5 },
      { message: "5 must be greater than or equal to 10", path: [], value: 5 },
      { message: "5 must be less than or equal to 4", path: [], value: 5 },
    ]);
  });

  it("emits exactly two errors (multipleOf and max) when min is satisfied", () => {
    const v = new NumberValidator({ multipleOf: 2, min: 0, max: 4 });
    expect(v.validate(5)).toEqual([
      { message: "number was not a multiple of 2", path: [], value: 5 },
      { message: "5 must be less than or equal to 4", path: [], value: 5 },
    ]);
  });
});

describe("validate: special numerics", () => {
  it("treats NaN as a valid number type and reports no bound errors", () => {
    expect(new NumberValidator({ min: 0, max: 10 }).validate(NaN)).toEqual([]);
  });

  it("reports a multiple error for NaN once multipleOf is set", () => {
    expect(new NumberValidator({ multipleOf: 2 }).validate(NaN)).toEqual([
      { message: "number was not a multiple of 2", path: [], value: NaN },
    ]);
  });

  it("rejects Infinity against max and multipleOf but not min", () => {
    const v = new NumberValidator({ min: 0, max: 10, multipleOf: 2 });
    expect(v.validate(Infinity)).toEqual([
      { message: "number was not a multiple of 2", path: [], value: Infinity },
      { message: "Infinity must be less than or equal to 10", path: [], value: Infinity },
    ]);
  });

  it("rejects -Infinity against min and multipleOf but not max", () => {
    const v = new NumberValidator({ min: 0, max: 10, multipleOf: 2 });
    expect(v.validate(-Infinity)).toEqual([
      { message: "number was not a multiple of 2", path: [], value: -Infinity },
      { message: "-Infinity must be greater than or equal to 0", path: [], value: -Infinity },
    ]);
  });

  it("treats -0 like 0 and interpolates it as \"0\" in the min message", () => {
    expect(new NumberValidator({ min: 5 }).validate(-0)).toEqual([
      { message: "0 must be greater than or equal to 5", path: [], value: -0 },
    ]);
  });

  it("treats Number.MAX_VALUE as an even multiple", () => {
    expect(new NumberValidator({ multipleOf: 2 }).validate(Number.MAX_VALUE)).toEqual([]);
  });

  it("treats Number.MIN_VALUE as not an even multiple", () => {
    expect(new NumberValidator({ multipleOf: 2 }).validate(Number.MIN_VALUE)).toEqual([
      { message: "number was not a multiple of 2", path: [], value: Number.MIN_VALUE },
    ]);
  });
});

describe("isValid", () => {
  it("returns true for an unconstrained number", () => {
    expect(make().isValid(7)).toBe(true);
  });

  it("returns false for a non-number", () => {
    expect(make().isValid("7")).toBe(false);
  });

  it("returns true at the inclusive max boundary", () => {
    expect(new NumberValidator({ max: 5 }).isValid(5)).toBe(true);
  });

  it("returns false above max", () => {
    expect(new NumberValidator({ max: 5 }).isValid(6)).toBe(false);
  });

  it("returns true at the inclusive min boundary", () => {
    expect(new NumberValidator({ min: 5 }).isValid(5)).toBe(true);
  });

  it("returns false below min", () => {
    expect(new NumberValidator({ min: 5 }).isValid(4)).toBe(false);
  });

  it("returns true for an exact multiple", () => {
    expect(new NumberValidator({ multipleOf: 3 }).isValid(9)).toBe(true);
  });

  it("returns false for a non-multiple", () => {
    expect(new NumberValidator({ multipleOf: 3 }).isValid(8)).toBe(false);
  });

  it("returns false for NaN once a bound is set", () => {
    expect(new NumberValidator({ min: 0 }).isValid(NaN)).toBe(false);
  });

  it("returns true for NaN when unconstrained", () => {
    expect(make().isValid(NaN)).toBe(true);
  });

  it("is always false when multipleOf is 0 because n % 0 is NaN (validate/isValid inconsistency)", () => {
    expect(new NumberValidator({ multipleOf: 0 }).isValid(6)).toBe(false);
  });

  it("validate accepts the same value that isValid rejects when multipleOf is 0", () => {
    expect(new NumberValidator({ multipleOf: 0 }).validate(6)).toEqual([]);
  });
});

describe("builders: immutability and chaining", () => {
  it("min() returns a new instance", () => {
    const base = make();
    expect(base.min(5)).not.toBe(base);
  });

  it("min() does not mutate the original validator", () => {
    const base = make();
    base.min(5);
    expect(base.validate(-100)).toEqual([]);
  });

  it("max() returns a new instance that enforces the bound", () => {
    expect(make().max(5).validate(6)).toEqual([
      { message: "6 must be less than or equal to 5", path: [], value: 6 },
    ]);
  });

  it("multipleOf() returns a new instance that enforces the divisor", () => {
    expect(make().multipleOf(3).validate(8)).toEqual([
      { message: "number was not a multiple of 3", path: [], value: 8 },
    ]);
  });

  it("carries previously-set options forward through chaining", () => {
    const v = make().min(10).max(20);
    expect(v.validate(5)).toEqual([
      { message: "5 must be greater than or equal to 10", path: [], value: 5 },
    ]);
  });

  it("keeps the last value when the same builder is called twice (override)", () => {
    const v = make().min(10).min(3);
    expect(v.validate(5)).toEqual([]);
  });

  it("integer() rejects a fraction with the integer message", () => {
    expect(make().integer().validate(1.5)).toEqual([
      { message: "number was not an integer", path: [], value: 1.5 },
    ]);
  });

  it("integer() accepts a whole number", () => {
    expect(make().integer().validate(4)).toEqual([]);
  });
});

describe("checkValid", () => {
  it("returns the value unchanged when valid", () => {
    expect(new NumberValidator({ min: 0 }).checkValid(5)).toBe(5);
  });

  it("throws a FailedValidationError when invalid", () => {
    expect(() => new NumberValidator({ min: 10 }).checkValid(5)).toThrow(
      FailedValidationError
    );
  });

  it("marks the thrown error with isFailedValidationError", () => {
    let caught: any;
    try {
      new NumberValidator({ min: 10 }).checkValid(5);
    } catch (e) {
      caught = e;
    }
    expect(caught.isFailedValidationError).toBe(true);
  });

  it("exposes the validation errors array on the thrown error", () => {
    let caught: any;
    try {
      new NumberValidator({ min: 10 }).checkValid(5);
    } catch (e) {
      caught = e;
    }
    expect(caught.errors).toEqual([
      { message: "5 must be greater than or equal to 10", path: [], value: 5 },
    ]);
  });

  it("joins multiple error messages with a semicolon when path is empty", () => {
    let caught: any;
    try {
      new NumberValidator({ multipleOf: 2, max: 4 }).checkValid(5);
    } catch (e) {
      caught = e;
    }
    expect(caught.message).toBe(
      "number was not a multiple of 2; 5 must be less than or equal to 4"
    );
  });

  it("renders a non-empty path as \"a.0: <message>\"", () => {
    let caught: any;
    try {
      new NumberValidator({ min: 10 }).checkValid(5, ["a", 0]);
    } catch (e) {
      caught = e;
    }
    expect(caught.message).toBe("a.0: 5 must be greater than or equal to 10");
  });
});

describe("toJsonSchema", () => {
  it("includes type plus set options and strips undefined", () => {
    const v = new NumberValidator({ min: 1, max: 10, multipleOf: 2 });
    expect(v.toJsonSchema()).toEqual({
      type: "number",
      minimum: 1,
      maximum: 10,
      multipleOf: 2,
    });
  });

  it("omits undefined-valued keys when options are empty", () => {
    expect(make().toJsonSchema()).toEqual({ type: "number" });
  });

  it("returns the same cached reference on repeat calls", () => {
    const v = new NumberValidator({ min: 1 });
    expect(v.toJsonSchema()).toBe(v.toJsonSchema());
  });
});

describe("_toJsonSchema", () => {
  it("retains undefined-valued keys for unset options", () => {
    expect(make()._toJsonSchema()).toEqual({
      type: "number",
      multipleOf: undefined,
      minimum: undefined,
      maximum: undefined,
    });
  });

  it("maps set options to schema keys", () => {
    const v = new NumberValidator({ min: 1, max: 10, multipleOf: 2 });
    expect(v._toJsonSchema()).toEqual({
      type: "number",
      multipleOf: 2,
      minimum: 1,
      maximum: 10,
    });
  });

  it("returns a fresh, uncached object on each call", () => {
    const v = make();
    expect(v._toJsonSchema()).not.toBe(v._toJsonSchema());
  });
});
