import { describe, it, expect } from "vitest";
import NumberValidator from "../src/number-validator";
import { FailedValidationError } from "../src/interfaces";

const unconstrained = () => new NumberValidator({});

describe("validate: type guard", () => {
  it("rejects a string with the must-be-a-number error", () => {
    expect(unconstrained().validate("5")).toEqual([
      { message: "must be a number", path: [], value: "5" },
    ]);
  });

  it("rejects undefined with the must-be-a-number error", () => {
    expect(unconstrained().validate(undefined)).toEqual([
      { message: "must be a number", path: [], value: undefined },
    ]);
  });

  it("rejects null with the must-be-a-number error", () => {
    expect(unconstrained().validate(null)).toEqual([
      { message: "must be a number", path: [], value: null },
    ]);
  });

  it("rejects boolean true with the must-be-a-number error", () => {
    expect(unconstrained().validate(true)).toEqual([
      { message: "must be a number", path: [], value: true },
    ]);
  });

  it("returns early for non-numbers, ignoring every constraint", () => {
    const validator = new NumberValidator({ multipleOf: 2, min: 10, max: 20 });
    expect(validator.validate("nope")).toEqual([
      { message: "must be a number", path: [], value: "nope" },
    ]);
  });

  it("passes a provided path through by reference in the type error", () => {
    const path = ["a", 0];
    const result = unconstrained().validate("x", path);
    expect(result[0].path).toBe(path);
  });

  it("uses an empty array as the default path for the type error", () => {
    expect(unconstrained().validate("x")[0].path).toEqual([]);
  });
});

describe("validate: unconstrained numbers", () => {
  it("accepts a plain number with no errors", () => {
    expect(unconstrained().validate(42)).toEqual([]);
  });

  it("accepts zero with no errors", () => {
    expect(unconstrained().validate(0)).toEqual([]);
  });

  it("accepts a negative number with no errors", () => {
    expect(unconstrained().validate(-7)).toEqual([]);
  });
});

describe("validate: multipleOf", () => {
  it("accepts an exact multiple", () => {
    expect(new NumberValidator({ multipleOf: 3 }).validate(9)).toEqual([]);
  });

  it("treats zero as a multiple of any divisor", () => {
    expect(new NumberValidator({ multipleOf: 3 }).validate(0)).toEqual([]);
  });

  it("rejects a non-multiple with the multiple-of message", () => {
    expect(new NumberValidator({ multipleOf: 3 }).validate(7)).toEqual([
      { message: "number was not a multiple of 3", path: [], value: 7 },
    ]);
  });

  it("uses the integer message when multipleOf is exactly 1", () => {
    expect(new NumberValidator({ multipleOf: 1 }).validate(1.5)).toEqual([
      { message: "number was not an integer", path: [], value: 1.5 },
    ]);
  });

  it("accepts an integer when multipleOf is 1", () => {
    expect(new NumberValidator({ multipleOf: 1 }).validate(4)).toEqual([]);
  });

  it("interpolates a negative multipleOf into the message", () => {
    expect(new NumberValidator({ multipleOf: -2 }).validate(3)).toEqual([
      { message: "number was not a multiple of -2", path: [], value: 3 },
    ]);
  });

  it("interpolates a fractional multipleOf into the message", () => {
    expect(new NumberValidator({ multipleOf: 0.5 }).validate(0.3)).toEqual([
      { message: "number was not a multiple of 0.5", path: [], value: 0.3 },
    ]);
  });

  it("accepts a value divisible by a fractional multipleOf", () => {
    expect(new NumberValidator({ multipleOf: 0.5 }).validate(1.5)).toEqual([]);
  });

  it("skips the check entirely when multipleOf is 0 (falsy)", () => {
    expect(new NumberValidator({ multipleOf: 0 }).validate(7)).toEqual([]);
  });

  it("forwards the path to the multipleOf error", () => {
    expect(new NumberValidator({ multipleOf: 3 }).validate(7, ["k"])).toEqual([
      { message: "number was not a multiple of 3", path: ["k"], value: 7 },
    ]);
  });
});

describe("validate: min (inclusive)", () => {
  it("accepts a value greater than min", () => {
    expect(new NumberValidator({ min: 5 }).validate(6)).toEqual([]);
  });

  it("accepts a value equal to min", () => {
    expect(new NumberValidator({ min: 5 }).validate(5)).toEqual([]);
  });

  it("rejects a value below min with the greater-than-or-equal message", () => {
    expect(new NumberValidator({ min: 5 }).validate(4)).toEqual([
      { message: "4 must be greater than or equal to 5", path: [], value: 4 },
    ]);
  });

  it("enforces min of 0 by rejecting a negative value", () => {
    expect(new NumberValidator({ min: 0 }).validate(-1)).toEqual([
      { message: "-1 must be greater than or equal to 0", path: [], value: -1 },
    ]);
  });

  it("accepts 0 when min is 0", () => {
    expect(new NumberValidator({ min: 0 }).validate(0)).toEqual([]);
  });
});

describe("validate: max (inclusive)", () => {
  it("accepts a value less than max", () => {
    expect(new NumberValidator({ max: 5 }).validate(4)).toEqual([]);
  });

  it("accepts a value equal to max", () => {
    expect(new NumberValidator({ max: 5 }).validate(5)).toEqual([]);
  });

  it("rejects a value above max with the less-than-or-equal message", () => {
    expect(new NumberValidator({ max: 5 }).validate(6)).toEqual([
      { message: "6 must be less than or equal to 5", path: [], value: 6 },
    ]);
  });

  it("enforces max of 0 by rejecting a positive value", () => {
    expect(new NumberValidator({ max: 0 }).validate(1)).toEqual([
      { message: "1 must be less than or equal to 0", path: [], value: 1 },
    ]);
  });

  it("accepts 0 when max is 0", () => {
    expect(new NumberValidator({ max: 0 }).validate(0)).toEqual([]);
  });
});

describe("validate: error accumulation order", () => {
  it("orders multipleOf before min when both are violated", () => {
    expect(new NumberValidator({ min: 10, multipleOf: 2 }).validate(5)).toEqual([
      { message: "number was not a multiple of 2", path: [], value: 5 },
      { message: "5 must be greater than or equal to 10", path: [], value: 5 },
    ]);
  });

  it("orders min before max when both are violated (impossible-range)", () => {
    expect(new NumberValidator({ min: 10, max: 5 }).validate(7)).toEqual([
      { message: "7 must be greater than or equal to 10", path: [], value: 7 },
      { message: "7 must be less than or equal to 5", path: [], value: 7 },
    ]);
  });

  it("accumulates multipleOf, min and max errors in order", () => {
    const validator = new NumberValidator({ multipleOf: 2, min: 10, max: 3 });
    expect(validator.validate(5)).toEqual([
      { message: "number was not a multiple of 2", path: [], value: 5 },
      { message: "5 must be greater than or equal to 10", path: [], value: 5 },
      { message: "5 must be less than or equal to 3", path: [], value: 5 },
    ]);
  });
});

describe("builders: immutability and chaining", () => {
  it("min() returns a new instance", () => {
    const base = unconstrained();
    expect(base.min(5)).not.toBe(base);
  });

  it("min() leaves the original validator unchanged", () => {
    const base = unconstrained();
    base.min(5);
    expect(base.validate(0)).toEqual([]);
  });

  it("max() returns a new instance", () => {
    const base = unconstrained();
    expect(base.max(5)).not.toBe(base);
  });

  it("multipleOf() returns a new instance", () => {
    const base = unconstrained();
    expect(base.multipleOf(2)).not.toBe(base);
  });

  it("carries previously-set options forward when chaining", () => {
    const validator = unconstrained().min(2).max(8).multipleOf(2);
    expect(validator.validate(4)).toEqual([]);
  });

  it("applies all chained constraints together", () => {
    const validator = unconstrained().min(2).max(8).multipleOf(2);
    expect(validator.validate(10)).toEqual([
      { message: "10 must be less than or equal to 8", path: [], value: 10 },
    ]);
  });

  it("overrides min when called twice, keeping the last value", () => {
    const validator = unconstrained().min(5).min(10);
    expect(validator.validate(7)).toEqual([
      { message: "7 must be greater than or equal to 10", path: [], value: 7 },
    ]);
  });

  it("overrides max when called twice, keeping the last value", () => {
    const validator = unconstrained().max(10).max(5);
    expect(validator.validate(7)).toEqual([
      { message: "7 must be less than or equal to 5", path: [], value: 7 },
    ]);
  });

  it("overrides multipleOf when called twice, keeping the last value", () => {
    const validator = unconstrained().multipleOf(2).multipleOf(3);
    expect(validator.validate(2)).toEqual([
      { message: "number was not a multiple of 3", path: [], value: 2 },
    ]);
  });
});

describe("builders: integer()", () => {
  it("rejects a non-integer with the integer message", () => {
    expect(unconstrained().integer().validate(1.5)).toEqual([
      { message: "number was not an integer", path: [], value: 1.5 },
    ]);
  });

  it("accepts an integer", () => {
    expect(unconstrained().integer().validate(3)).toEqual([]);
  });

  it("is equivalent to multipleOf(1) in its schema", () => {
    expect(unconstrained().integer()._toJsonSchema()).toEqual(
      unconstrained().multipleOf(1)._toJsonSchema()
    );
  });
});

describe("isValid", () => {
  it("returns true for an unconstrained number", () => {
    expect(unconstrained().isValid(5)).toBe(true);
  });

  it("returns false for a non-number", () => {
    expect(unconstrained().isValid("5")).toBe(false);
  });

  it("returns true at the max boundary", () => {
    expect(new NumberValidator({ max: 5 }).isValid(5)).toBe(true);
  });

  it("returns false above max", () => {
    expect(new NumberValidator({ max: 5 }).isValid(6)).toBe(false);
  });

  it("returns true at the min boundary", () => {
    expect(new NumberValidator({ min: 5 }).isValid(5)).toBe(true);
  });

  it("returns false below min", () => {
    expect(new NumberValidator({ min: 5 }).isValid(4)).toBe(false);
  });

  it("returns true for an exact multiple", () => {
    expect(new NumberValidator({ multipleOf: 3 }).isValid(9)).toBe(true);
  });

  it("returns false for a non-multiple", () => {
    expect(new NumberValidator({ multipleOf: 3 }).isValid(7)).toBe(false);
  });
});

describe("isValid vs validate inconsistency for multipleOf 0", () => {
  it("validate ignores multipleOf 0 and accepts the value", () => {
    expect(new NumberValidator({ multipleOf: 0 }).validate(7)).toEqual([]);
  });

  it("isValid treats multipleOf 0 as an active divisor and always fails", () => {
    expect(new NumberValidator({ multipleOf: 0 }).isValid(7)).toBe(false);
  });

  it("isValid fails even for 0 itself when multipleOf is 0", () => {
    expect(new NumberValidator({ multipleOf: 0 }).isValid(0)).toBe(false);
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
    let caught: FailedValidationError | undefined;
    try {
      new NumberValidator({ min: 10 }).checkValid(5);
    } catch (e) {
      caught = e as FailedValidationError;
    }
    expect(caught?.isFailedValidationError).toBe(true);
  });

  it("exposes the validation errors array on the thrown error", () => {
    let caught: FailedValidationError | undefined;
    try {
      new NumberValidator({ min: 10 }).checkValid(5);
    } catch (e) {
      caught = e as FailedValidationError;
    }
    expect(caught?.errors).toEqual([
      { message: "5 must be greater than or equal to 10", path: [], value: 5 },
    ]);
  });

  it("renders the message-only form when the path is empty", () => {
    let caught: FailedValidationError | undefined;
    try {
      new NumberValidator({ min: 10 }).checkValid(5);
    } catch (e) {
      caught = e as FailedValidationError;
    }
    expect(caught?.message).toBe("5 must be greater than or equal to 10");
  });

  it("prefixes the path when a non-empty path is given", () => {
    let caught: FailedValidationError | undefined;
    try {
      new NumberValidator({ min: 10 }).checkValid(5, ["a", 0]);
    } catch (e) {
      caught = e as FailedValidationError;
    }
    expect(caught?.message).toBe("a.0: 5 must be greater than or equal to 10");
  });

  it("joins multiple errors with a semicolon in the message", () => {
    let caught: FailedValidationError | undefined;
    try {
      new NumberValidator({ multipleOf: 2, min: 10 }).checkValid(5);
    } catch (e) {
      caught = e as FailedValidationError;
    }
    expect(caught?.message).toBe(
      "number was not a multiple of 2; 5 must be greater than or equal to 10"
    );
  });
});

describe("toJsonSchema (cached, undefined stripped)", () => {
  it("emits only type for an unconstrained validator", () => {
    expect(unconstrained().toJsonSchema()).toEqual({ type: "number" });
  });

  it("includes minimum, maximum and multipleOf when set", () => {
    const validator = new NumberValidator({ min: 1, max: 9, multipleOf: 2 });
    expect(validator.toJsonSchema()).toEqual({
      type: "number",
      minimum: 1,
      maximum: 9,
      multipleOf: 2,
    });
  });

  it("includes only the options that are set", () => {
    expect(new NumberValidator({ min: 1 }).toJsonSchema()).toEqual({
      type: "number",
      minimum: 1,
    });
  });

  it("returns the same cached reference on repeated calls", () => {
    const validator = new NumberValidator({ min: 1 });
    expect(validator.toJsonSchema()).toBe(validator.toJsonSchema());
  });
});

describe("_toJsonSchema (raw, retains undefined, not cached)", () => {
  it("retains undefined-valued keys for unset options", () => {
    expect(unconstrained()._toJsonSchema()).toEqual({
      type: "number",
      multipleOf: undefined,
      minimum: undefined,
      maximum: undefined,
    });
  });

  it("populates every key when all options are set", () => {
    const validator = new NumberValidator({ min: 1, max: 9, multipleOf: 2 });
    expect(validator._toJsonSchema()).toEqual({
      type: "number",
      multipleOf: 2,
      minimum: 1,
      maximum: 9,
    });
  });

  it("returns a fresh object on each call (not cached)", () => {
    const validator = new NumberValidator({ min: 1 });
    expect(validator._toJsonSchema()).not.toBe(validator._toJsonSchema());
  });
});

describe("special numerics: validate", () => {
  it("accepts NaN when unconstrained (passes typeof number)", () => {
    expect(unconstrained().validate(NaN)).toEqual([]);
  });

  it("reports NaN as not a multiple when multipleOf is set", () => {
    expect(new NumberValidator({ multipleOf: 2 }).validate(NaN)).toEqual([
      { message: "number was not a multiple of 2", path: [], value: NaN },
    ]);
  });

  it("does not flag NaN against min (NaN < min is false)", () => {
    expect(new NumberValidator({ min: 0 }).validate(NaN)).toEqual([]);
  });

  it("does not flag NaN against max (NaN > max is false)", () => {
    expect(new NumberValidator({ max: 0 }).validate(NaN)).toEqual([]);
  });

  it("flags Infinity against max but not min", () => {
    const validator = new NumberValidator({ min: 0, max: 100 });
    expect(validator.validate(Infinity)).toEqual([
      {
        message: "Infinity must be less than or equal to 100",
        path: [],
        value: Infinity,
      },
    ]);
  });

  it("reports Infinity as not a multiple", () => {
    expect(new NumberValidator({ multipleOf: 2 }).validate(Infinity)).toEqual([
      { message: "number was not a multiple of 2", path: [], value: Infinity },
    ]);
  });

  it("flags -Infinity against min but not max", () => {
    const validator = new NumberValidator({ min: 0, max: 100 });
    expect(validator.validate(-Infinity)).toEqual([
      {
        message: "-Infinity must be greater than or equal to 0",
        path: [],
        value: -Infinity,
      },
    ]);
  });

  it("interpolates -0 as 0 in the min error message", () => {
    expect(new NumberValidator({ min: 5 }).validate(-0)).toEqual([
      { message: "0 must be greater than or equal to 5", path: [], value: -0 },
    ]);
  });

  it("treats -0 like 0 against min of 0 (no error)", () => {
    expect(new NumberValidator({ min: 0 }).validate(-0)).toEqual([]);
  });

  it("treats Number.MAX_VALUE as an even multiple", () => {
    expect(
      new NumberValidator({ multipleOf: 2 }).validate(Number.MAX_VALUE)
    ).toEqual([]);
  });

  it("treats Number.MIN_VALUE as not an even multiple", () => {
    expect(
      new NumberValidator({ multipleOf: 2 }).validate(Number.MIN_VALUE)
    ).toEqual([
      {
        message: "number was not a multiple of 2",
        path: [],
        value: Number.MIN_VALUE,
      },
    ]);
  });
});

describe("special numerics: isValid", () => {
  it("returns true for NaN when unconstrained", () => {
    expect(unconstrained().isValid(NaN)).toBe(true);
  });

  it("returns false for NaN once a max is set", () => {
    expect(new NumberValidator({ max: 0 }).isValid(NaN)).toBe(false);
  });

  it("returns false for NaN once a min is set", () => {
    expect(new NumberValidator({ min: 0 }).isValid(NaN)).toBe(false);
  });

  it("returns false for NaN once a multipleOf is set", () => {
    expect(new NumberValidator({ multipleOf: 2 }).isValid(NaN)).toBe(false);
  });
});
