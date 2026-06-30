import { describe, it, expect } from "vitest";
import NumberValidator from "../src/number-validator";

describe("NumberValidator", () => {
  // Constructor
  it("should store provided options", () => {
    const validator = new NumberValidator({ multipleOf: 3, min: 5, max: 10 });
    expect(validator).toBeInstanceOf(NumberValidator);
    // @ts-ignore - options is private, but we can access via validator as any
    expect(validator["options"]).toEqual({ multipleOf: 3, min: 5, max: 10 });
  });

  // min method
  it("should create a new validator with updated min", () => {
    const original = new NumberValidator({ min: 2 });
    const updated = original.min(5);
    expect(updated).toBeInstanceOf(NumberValidator);
    expect(updated["options"].min).toBe(5);
    expect(updated["options"].min).not.toBe(original["options"].min);
  });

  // max method
  it("should create a new validator with updated max", () => {
    const original = new NumberValidator({ max: 2 });
    const updated = original.max(5);
    expect(updated["options"].max).toBe(5);
  });

  // multipleOf method
  it("should create a new validator with updated multipleOf", () => {
    const original = new NumberValidator({});
    const updated = original.multipleOf(7);
    expect(updated["options"].multipleOf).toBe(7);
  });

  // integer method
  it("should create a new validator with multipleOf set to 1", () => {
    const original = new NumberValidator({});
    const updated = original.integer();
    expect(updated["options"].multipleOf).toBe(1);
  });

  // validate method
  describe("validate", () => {
    it("should return empty array for valid number", () => {
      const validator = new NumberValidator({});
      const errors = validator.validate(42);
      expect(errors).toHaveLength(0);
    });

    it("should report 'must be a number' for non-number values", () => {
      const validator = new NumberValidator({});
      const errors = validator.validate("not a number");
      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual({
        message: "must be a number",
        path: [],
        value: "not a number",
      });
    });

    it("should enforce multipleOf when provided", () => {
      const validator = new NumberValidator({ multipleOf: 4 });
      // valid multiple
      let errors = validator.validate(8);
      expect(errors).toHaveLength(0);
      // invalid multiple
      errors = validator.validate(7);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual({
        message: "number was not a multiple of 4",
        path: [],
        value: 7,
      });
    });

    it("should use singular message when multipleOf is 1", () => {
      const validator = new NumberValidator({ multipleOf: 1 });
      const errors = validator.validate(3.5);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual({
        message: "number was not an integer",
        path: [],
        value: 3.5,
      });
    });

    it("should enforce min constraint", () => {
      const validator = new NumberValidator({ min: 10 });
      let errors = validator.validate(5);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual({
        message: "5 must be greater than or equal to 10",
        path: [],
        value: 5,
      });
      // valid case
      errors = validator.validate(10);
      expect(errors).toHaveLength(0);
    });

    it("should enforce max constraint", () => {
      const validator = new NumberValidator({ max: 10 });
      let errors = validator.validate(15);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual({
        message: "15 must be less than or equal to 10",
        path: [],
        value: 15,
      });
      // valid case
      errors = validator.validate(10);
      expect(errors).toHaveLength(0);
    });

    it("should combine multiple constraints", () => {
      const validator = new NumberValidator({ min: 5, max: 15, multipleOf: 5 });
      // 3 violates min and multipleOf
      let errors = validator.validate(3);
      expect(errors).toHaveLength(2);
      const messages = errors.map(e => e.message);
      expect(messages).toContain("3 must be greater than or equal to 5");
      expect(messages).toContain("number was not a multiple of 5");
      // 20 violates max
      errors = validator.validate(20);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain("less than or equal to 15");
      // 7 violates multipleOf
      errors = validator.validate(7);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain("not a multiple of 5");
    });
  });

  // isValid method
  describe("isValid", () => {
    it("should return true for valid numbers", () => {
      const validator = new NumberValidator({});
      expect(validator.isValid(123)).toBe(true);
    });

    it("should return false for non-number values", () => {
      const validator = new NumberValidator({});
      expect(validator.isValid("abc")).toBe(false);
    });

    it("should respect min constraint", () => {
      const validator = new NumberValidator({ min: 5 });
      expect(validator.isValid(3)).toBe(false);
      expect(validator.isValid(5)).toBe(true);
    });

    it("should respect max constraint", () => {
      const validator = new NumberValidator({ max: 5 });
      expect(validator.isValid(8)).toBe(false);
      expect(validator.isValid(5)).toBe(true);
    });

    it("should respect multipleOf constraint", () => {
      const validator = new NumberValidator({ multipleOf: 3 });
      expect(validator.isValid(4)).toBe(false);
      expect(validator.isValid(6)).toBe(true);
    });

    it("should work with combined constraints", () => {
      const validator = new NumberValidator({ min: 2, max: 10, multipleOf: 2 });
      expect(validator.isValid(1)).toBe(false); // below min
      expect(validator.isValid(11)).toBe(false); // above max
      expect(validator.isValid(3)).toBe(false); // not multiple of 2
      expect(validator.isValid(4)).toBe(true); // valid
    });
  });

  // _toJsonSchema method
  describe("_toJsonSchema", () => {
    it("should return base schema", () => {
      const validator = new NumberValidator({});
      const schema = validator._toJsonSchema();
      expect(schema).toEqual({
        type: "number",
        // other fields may be undefined; but JSON schema allows missing
      });
    });

    it("should include minimum in schema", () => {
      const validator = new NumberValidator({ min: 5 });
      const schema = validator._toJsonSchema();
      expect(schema).toMatchObject({ minimum: 5 });
    });

    it("should include maximum in schema", () => {
      const validator = new NumberValidator({ max: 10 });
      const schema = validator._toJsonSchema();
      expect(schema).toMatchObject({ maximum: 10 });
    });

    it("should include multipleOf in schema", () => {
      const validator = new NumberValidator({ multipleOf: 7 });
      const schema = validator._toJsonSchema();
      expect(schema).toMatchObject({ multipleOf: 7 });
    });

    it("should include all constraints in schema", () => {
      const validator = new NumberValidator({ min: 1, max: 5, multipleOf: 2 });
      const schema = validator._toJsonSchema();
      expect(schema).toMatchObject({
        minimum: 1,
        maximum: 5,
        multipleOf: 2,
      });
    });
  });
});