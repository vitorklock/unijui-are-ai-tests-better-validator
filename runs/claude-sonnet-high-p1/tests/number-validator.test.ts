import { describe, it, expect } from "vitest";
import NumberValidator from "../src/number-validator";
import { FailedValidationError } from "../src/interfaces";

const num = new NumberValidator({});

describe("validate — type check", () => {
  it("returns no errors for a plain number", () => {
    expect(num.validate(42)).toEqual([]);
  });

  it("returns an error for a string", () => {
    const errors = num.validate("42");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("must be a number");
  });

  it("returns an error for null", () => {
    expect(num.validate(null)).toHaveLength(1);
  });

  it("attaches the provided path to the error", () => {
    const errors = num.validate("x", ["foo", 0]);
    expect(errors[0].path).toEqual(["foo", 0]);
  });

  it("defaults path to empty array", () => {
    expect(num.validate("x")[0].path).toEqual([]);
  });
});

describe("validate — min", () => {
  const v = num.min(5);

  it("accepts value equal to min", () => {
    expect(v.validate(5)).toEqual([]);
  });

  it("accepts value above min", () => {
    expect(v.validate(10)).toEqual([]);
  });

  it("rejects value below min", () => {
    const errors = v.validate(4);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("greater than or equal to 5");
  });
});

describe("validate — max", () => {
  const v = num.max(10);

  it("accepts value equal to max", () => {
    expect(v.validate(10)).toEqual([]);
  });

  it("accepts value below max", () => {
    expect(v.validate(3)).toEqual([]);
  });

  it("rejects value above max", () => {
    const errors = v.validate(11);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("less than or equal to 10");
  });
});

describe("validate — multipleOf", () => {
  const v = num.multipleOf(3);

  it("accepts exact multiple", () => {
    expect(v.validate(9)).toEqual([]);
  });

  it("accepts zero (0 % n === 0)", () => {
    expect(v.validate(0)).toEqual([]);
  });

  it("rejects non-multiple", () => {
    const errors = v.validate(7);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("multiple of 3");
  });
});

describe("validate — integer", () => {
  const v = num.integer();

  it("accepts whole numbers", () => {
    expect(v.validate(4)).toEqual([]);
  });

  it("rejects floats", () => {
    const errors = v.validate(1.5);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("number was not an integer");
  });
});

describe("validate — combined constraints", () => {
  const v = num.min(0).max(100).multipleOf(5);

  it("accepts value satisfying all constraints", () => {
    expect(v.validate(50)).toEqual([]);
  });

  it("collects multiple errors simultaneously", () => {
    // -1 is below min AND not a multiple of 5
    const errors = v.validate(-1);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe("isValid", () => {
  it("returns true for a valid number", () => {
    expect(num.min(1).max(10).isValid(5)).toBe(true);
  });

  it("returns false for a non-number", () => {
    expect(num.isValid("5")).toBe(false);
  });

  it("returns false when below min", () => {
    expect(num.min(5).isValid(4)).toBe(false);
  });

  it("returns false when above max", () => {
    expect(num.max(5).isValid(6)).toBe(false);
  });

  it("returns false for non-multiple", () => {
    expect(num.multipleOf(2).isValid(3)).toBe(false);
  });
});

describe("checkValid (inherited)", () => {
  it("returns the value when valid", () => {
    expect(num.checkValid(7)).toBe(7);
  });

  it("throws FailedValidationError when invalid", () => {
    expect(() => num.min(10).checkValid(1)).toThrowError(FailedValidationError);
  });
});

describe("toJsonSchema", () => {
  it("emits type number with no constraints", () => {
    expect(num.toJsonSchema()).toEqual({ type: "number" });
  });

  it("includes minimum when min is set", () => {
    expect(num.min(3).toJsonSchema()).toMatchObject({ minimum: 3 });
  });

  it("includes maximum when max is set", () => {
    expect(num.max(99).toJsonSchema()).toMatchObject({ maximum: 99 });
  });

  it("includes multipleOf when set", () => {
    expect(num.multipleOf(5).toJsonSchema()).toMatchObject({ multipleOf: 5 });
  });

  it("caches the schema across calls", () => {
    const v = num.min(1);
    expect(v.toJsonSchema()).toBe(v.toJsonSchema());
  });
});
