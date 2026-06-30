import { describe, it, expect } from "vitest";
import NumberValidator from "../src/number-validator";

/**
 * Tests for NumberValidator. Each test exercises a single behavior and asserts
 * the exact return value (including error message, path and offending value) so
 * that any change to the validation logic is detected.
 */
describe("NumberValidator", () => {
  describe("validate() type checking", () => {
    it.each([
      { label: "a string", value: "5" },
      { label: "a boolean", value: true },
      { label: "null", value: null },
      { label: "undefined", value: undefined },
      { label: "an object", value: { not: "a number" } },
      { label: "an array", value: [1, 2] },
    ])("reports a single 'must be a number' error for $label", ({ value }) => {
      expect(new NumberValidator({}).validate(value)).toEqual([
        { message: "must be a number", path: [], value },
      ]);
    });

    it("short-circuits on a non-number, ignoring the other constraints", () => {
      // min/max/multipleOf are all set, but the type check returns early so only
      // one error is produced rather than several.
      const validator = new NumberValidator({ min: 0, max: 10, multipleOf: 2 });

      expect(validator.validate("nope")).toEqual([
        { message: "must be a number", path: [], value: "nope" },
      ]);
    });
  });

  describe("validate() with no constraints", () => {
    it("returns no errors for a plain number", () => {
      expect(new NumberValidator({}).validate(42)).toEqual([]);
    });
  });

  describe("validate() multipleOf constraint", () => {
    it("accepts a value that is a multiple", () => {
      expect(new NumberValidator({ multipleOf: 3 }).validate(9)).toEqual([]);
    });

    it("treats zero as a multiple of any divisor", () => {
      expect(new NumberValidator({ multipleOf: 3 }).validate(0)).toEqual([]);
    });

    it("accepts a negative multiple", () => {
      expect(new NumberValidator({ multipleOf: 2 }).validate(-4)).toEqual([]);
    });

    it("rejects a value that is not a multiple", () => {
      expect(new NumberValidator({ multipleOf: 3 }).validate(10)).toEqual([
        { message: "number was not a multiple of 3", path: [], value: 10 },
      ]);
    });

    it("rejects a negative non-multiple", () => {
      expect(new NumberValidator({ multipleOf: 2 }).validate(-5)).toEqual([
        { message: "number was not a multiple of 2", path: [], value: -5 },
      ]);
    });

    it("uses the integer-specific message when multipleOf is 1", () => {
      expect(new NumberValidator({ multipleOf: 1 }).validate(1.5)).toEqual([
        { message: "number was not an integer", path: [], value: 1.5 },
      ]);
    });

    it("ignores the constraint when multipleOf is 0 (falsy guard)", () => {
      // validate guards with `if (multipleOf && ...)`, so a multipleOf of 0 is
      // treated as "no constraint" and every number passes.
      expect(new NumberValidator({ multipleOf: 0 }).validate(7)).toEqual([]);
    });
  });

  describe("validate() min constraint", () => {
    it("accepts a value equal to min (boundary is inclusive)", () => {
      expect(new NumberValidator({ min: 10 }).validate(10)).toEqual([]);
    });

    it("accepts a value just above min", () => {
      expect(new NumberValidator({ min: 10 }).validate(11)).toEqual([]);
    });

    it("rejects a value just below min", () => {
      expect(new NumberValidator({ min: 10 }).validate(9)).toEqual([
        { message: "9 must be greater than or equal to 10", path: [], value: 9 },
      ]);
    });

    it("enforces a min of 0 rather than treating 0 as unset", () => {
      // min uses `typeof min !== "undefined"`, so 0 is a real lower bound.
      expect(new NumberValidator({ min: 0 }).validate(-1)).toEqual([
        { message: "-1 must be greater than or equal to 0", path: [], value: -1 },
      ]);
    });

    it("accepts 0 when min is 0", () => {
      expect(new NumberValidator({ min: 0 }).validate(0)).toEqual([]);
    });
  });

  describe("validate() max constraint", () => {
    it("accepts a value equal to max (boundary is inclusive)", () => {
      expect(new NumberValidator({ max: 10 }).validate(10)).toEqual([]);
    });

    it("accepts a value just below max", () => {
      expect(new NumberValidator({ max: 10 }).validate(9)).toEqual([]);
    });

    it("rejects a value just above max", () => {
      expect(new NumberValidator({ max: 10 }).validate(11)).toEqual([
        { message: "11 must be less than or equal to 10", path: [], value: 11 },
      ]);
    });

    it("enforces a max of 0 rather than treating 0 as unset", () => {
      expect(new NumberValidator({ max: 0 }).validate(1)).toEqual([
        { message: "1 must be less than or equal to 0", path: [], value: 1 },
      ]);
    });

    it("accepts 0 when max is 0", () => {
      expect(new NumberValidator({ max: 0 }).validate(0)).toEqual([]);
    });
  });

  describe("validate() with multiple constraints", () => {
    it("returns no errors when every constraint is satisfied", () => {
      const validator = new NumberValidator({ min: 0, max: 10, multipleOf: 2 });

      expect(validator.validate(4)).toEqual([]);
    });

    it("reports the multipleOf error before the min error", () => {
      // 5 is below min (10) and not a multiple of 2.
      const validator = new NumberValidator({ min: 10, multipleOf: 2 });

      expect(validator.validate(5)).toEqual([
        { message: "number was not a multiple of 2", path: [], value: 5 },
        { message: "5 must be greater than or equal to 10", path: [], value: 5 },
      ]);
    });

    it("reports the multipleOf error before the max error", () => {
      // 15 is above max (10) and not a multiple of 2.
      const validator = new NumberValidator({ max: 10, multipleOf: 2 });

      expect(validator.validate(15)).toEqual([
        { message: "number was not a multiple of 2", path: [], value: 15 },
        { message: "15 must be less than or equal to 10", path: [], value: 15 },
      ]);
    });
  });

  describe("validate() error path", () => {
    it("propagates a provided path into a value error", () => {
      const validator = new NumberValidator({ min: 0 });

      expect(validator.validate(-1, ["user", "age"])).toEqual([
        { message: "-1 must be greater than or equal to 0", path: ["user", "age"], value: -1 },
      ]);
    });

    it("propagates a provided path into the type-mismatch error", () => {
      expect(new NumberValidator({}).validate("x", ["items", 0])).toEqual([
        { message: "must be a number", path: ["items", 0], value: "x" },
      ]);
    });
  });

  describe("isValid()", () => {
    it("returns true for a number when there are no constraints", () => {
      expect(new NumberValidator({}).isValid(5)).toBe(true);
    });

    it.each([
      { label: "a string", value: "5" },
      { label: "null", value: null },
      { label: "undefined", value: undefined },
      { label: "an object", value: {} },
    ])("returns false for $label", ({ value }) => {
      expect(new NumberValidator({}).isValid(value)).toBe(false);
    });

    it("returns true at the min boundary", () => {
      expect(new NumberValidator({ min: 10 }).isValid(10)).toBe(true);
    });

    it("returns false just below min", () => {
      expect(new NumberValidator({ min: 10 }).isValid(9)).toBe(false);
    });

    it("returns true at the max boundary", () => {
      expect(new NumberValidator({ max: 10 }).isValid(10)).toBe(true);
    });

    it("returns false just above max", () => {
      expect(new NumberValidator({ max: 10 }).isValid(11)).toBe(false);
    });

    it("returns true for a multiple", () => {
      expect(new NumberValidator({ multipleOf: 5 }).isValid(15)).toBe(true);
    });

    it("returns false for a non-multiple", () => {
      expect(new NumberValidator({ multipleOf: 5 }).isValid(16)).toBe(false);
    });

    it("returns true only when all constraints pass together", () => {
      expect(new NumberValidator({ min: 0, max: 10, multipleOf: 2 }).isValid(4)).toBe(true);
    });

    it("returns false when a single constraint among several fails", () => {
      // 3 is within [0, 10] but is not a multiple of 2.
      expect(new NumberValidator({ min: 0, max: 10, multipleOf: 2 }).isValid(3)).toBe(false);
    });

    it("returns false for every value when multipleOf is 0", () => {
      // Unlike validate(), isValid checks `multipleOf === undefined`, so a
      // multipleOf of 0 is an active divisor and `n % 0 === 0` is never true.
      expect(new NumberValidator({ multipleOf: 0 }).isValid(7)).toBe(false);
    });
  });

  describe("builder methods", () => {
    it("min() returns a validator that enforces the lower bound", () => {
      expect(new NumberValidator({}).min(5).validate(4)).toEqual([
        { message: "4 must be greater than or equal to 5", path: [], value: 4 },
      ]);
    });

    it("max() returns a validator that enforces the upper bound", () => {
      expect(new NumberValidator({}).max(5).validate(6)).toEqual([
        { message: "6 must be less than or equal to 5", path: [], value: 6 },
      ]);
    });

    it("multipleOf() returns a validator that enforces divisibility", () => {
      expect(new NumberValidator({}).multipleOf(4).validate(6)).toEqual([
        { message: "number was not a multiple of 4", path: [], value: 6 },
      ]);
    });

    it("integer() rejects a non-integer with the integer message", () => {
      // integer() is an alias for multipleOf(1).
      expect(new NumberValidator({}).integer().validate(2.5)).toEqual([
        { message: "number was not an integer", path: [], value: 2.5 },
      ]);
    });

    it("integer() accepts a whole number", () => {
      expect(new NumberValidator({}).integer().validate(3)).toEqual([]);
    });

    it("does not mutate the original validator", () => {
      const original = new NumberValidator({});

      original.min(5);

      // The derived validator is a new instance, so the original still has no bound.
      expect(original.validate(4)).toEqual([]);
    });

    it("accumulates constraints when chained", () => {
      const validator = new NumberValidator({}).min(0).max(10).multipleOf(2);

      expect(validator.validate(3)).toEqual([
        { message: "number was not a multiple of 2", path: [], value: 3 },
      ]);
    });

    it("min() carries a previously set, different constraint forward", () => {
      // The builder spreads existing options, so the earlier max bound must survive.
      const validator = new NumberValidator({}).max(10).min(0);

      expect(validator.validate(15)).toEqual([
        { message: "15 must be less than or equal to 10", path: [], value: 15 },
      ]);
    });

    it("max() carries a previously set, different constraint forward", () => {
      const validator = new NumberValidator({}).min(0).max(10);

      expect(validator.validate(-5)).toEqual([
        { message: "-5 must be greater than or equal to 0", path: [], value: -5 },
      ]);
    });

    it("multipleOf() carries a previously set, different constraint forward", () => {
      const validator = new NumberValidator({}).min(10).multipleOf(2);

      expect(validator.validate(4)).toEqual([
        { message: "4 must be greater than or equal to 10", path: [], value: 4 },
      ]);
    });

    it("lets a later builder call override an earlier one for the same option", () => {
      const validator = new NumberValidator({}).min(5).min(10);

      // If min(5) had not been overridden, 7 would pass.
      expect(validator.validate(7)).toEqual([
        { message: "7 must be greater than or equal to 10", path: [], value: 7 },
      ]);
    });
  });

  describe("JSON schema output", () => {
    it("maps every option to its JSON Schema keyword", () => {
      const schema = new NumberValidator({ min: 1, max: 10, multipleOf: 2 })._toJsonSchema();

      expect(schema).toStrictEqual({
        type: "number",
        multipleOf: 2,
        minimum: 1,
        maximum: 10,
      });
    });

    it("leaves unset options as undefined in the raw schema", () => {
      const schema = new NumberValidator({ min: 1 })._toJsonSchema();

      expect(schema).toStrictEqual({
        type: "number",
        multipleOf: undefined,
        minimum: 1,
        maximum: undefined,
      });
    });

    it("strips undefined fields for a constraint-free validator", () => {
      expect(new NumberValidator({}).toJsonSchema()).toStrictEqual({ type: "number" });
    });

    it("emits only the configured constraints", () => {
      expect(new NumberValidator({ min: 1, multipleOf: 2 }).toJsonSchema()).toStrictEqual({
        type: "number",
        multipleOf: 2,
        minimum: 1,
      });
    });
  });

  describe("NaN handling (typeof NaN === 'number')", () => {
    it("validate accepts NaN when there are no constraints", () => {
      expect(new NumberValidator({}).validate(NaN)).toEqual([]);
    });

    it("validate flags NaN as not a multiple when multipleOf is set", () => {
      expect(new NumberValidator({ multipleOf: 2 }).validate(NaN)).toEqual([
        { message: "number was not a multiple of 2", path: [], value: NaN },
      ]);
    });

    it("validate does not flag NaN against min or max (NaN comparisons are always false)", () => {
      // Arbitrary non-zero bounds that clearly bracket NaN; both `NaN < min` and
      // `NaN > max` evaluate to false, so no bound error is produced.
      expect(new NumberValidator({ min: -100, max: 100 }).validate(NaN)).toEqual([]);
    });

    it("isValid returns false for NaN once a bound is set", () => {
      expect(new NumberValidator({ min: 0 }).isValid(NaN)).toBe(false);
    });
  });
});
