import { describe, it, expect, beforeEach } from "vitest";
import NumberValidator from "../src/number-validator";

describe("NumberValidator", () => {
  let validator: NumberValidator;

  beforeEach(() => {
    validator = new NumberValidator({});
  });

  it("should validate a simple number", () => {
    const errors = validator.validate(5);
    expect(errors).toEqual([]);
  });

  it("should reject non-number values", () => {
    const errors = validator.validate("5");
    expect(errors).toEqual([{ message: "must be a number", path: [], value: "5" }]);
  });

  it("should enforce min", () => {
    const minValidator = new NumberValidator({ min: 10 });
    const errors = minValidator.validate(5);
    expect(errors).toEqual([{ message: "5 must be greater than or equal to 10", path: [], value: 5 }]);
  });

  it("should enforce max", () => {
    const maxValidator = new NumberValidator({ max: 10 });
    const errors = maxValidator.validate(15);
    expect(errors).toEqual([{ message: "15 must be less than or equal to 10", path: [], value: 15 }]);
  });

  it("should enforce multipleOf", () => {
    const modValidator = new NumberValidator({ multipleOf: 3 });
    const errors = modValidator.validate(10);
    expect(errors).toEqual([{ message: "number was not a multiple of 3", path: [], value: 10 }]);
  });

  it("should accept valid multipleOf", () => {
    const modValidator = new NumberValidator({ multipleOf: 5 });
    const errors = modValidator.validate(10);
    expect(errors).toEqual([]);
  });

  it("should enforce integer via integer() method", () => {
    const intValidator = new NumberValidator({}).integer();
    const errors = intValidator.validate(3.5);
    expect(errors).toEqual([{ message: "number was not an integer", path: [], value: 3.5 }]);
  });

  it("should accept integer values", () => {
    const intValidator = new NumberValidator({}).integer();
    const errors = intValidator.validate(4);
    expect(errors).toEqual([]);
    const complexValidator = new NumberValidator({ min: 5, max: 15, multipleOf: 5 });
    const errors2 = complexValidator.validate(12);
    expect(errors2).toEqual([{ message: "number was not a multiple of 5", path: [], value: 12 }]);
  });

  it("should be invalid when below min even if multipleOf is satisfied", () => {
    const validator = new NumberValidator({ min: 10, multipleOf: 2 });
    const errors = validator.validate(8);
    expect(errors).toEqual([{ message: "8 must be greater than or equal to 10", path: [], value: 8 }]);
  });

  it("should be valid when all constraints satisfied", () => {
    const validator = new NumberValidator({ min: 5, max: 20, multipleOf: 5 });
    const errors = validator.validate(10);
    expect(errors).toEqual([]);
  });

  describe("isValid method", () => {
    it("should return true for valid numbers", () => {
      const validator = new NumberValidator({ min: 1, max: 10, multipleOf: 1 });
      expect(validator.isValid(5)).toBe(true);
    });

    it("should return false for invalid numbers", () => {
      const validator = new NumberValidator({ min: 1, max: 10, multipleOf: 2 });
      expect(validator.isValid(3)).toBe(false);
    });
  });
});