import { ValidationError, nonEmpty, maxLength, oneOf } from "../src/validate";

describe("nonEmpty", () => {
  const cases: Array<[string, string, boolean]> = [
    ["field", "value", false],
    ["field", "", true],
    ["field", "   ", true],
    ["field", "  x  ", false],
  ];

  it.each(cases)("field=%s value=%p expectsError=%p", (field, value, expectsError) => {
    const result = nonEmpty(field, value);
    if (expectsError) {
      expect(result).toBeInstanceOf(ValidationError);
      expect(result?.field).toBe(field);
    } else {
      expect(result).toBeNull();
    }
  });
});

describe("maxLength", () => {
  const cases: Array<[string, number, boolean]> = [
    ["abc", 3, false],
    ["abcd", 3, true],
    ["", 0, false],
    ["a", 0, true],
  ];

  it.each(cases)("value=%p max=%p expectsError=%p", (value, max, expectsError) => {
    const result = maxLength("field", value, max);
    if (expectsError) {
      expect(result).toBeInstanceOf(ValidationError);
    } else {
      expect(result).toBeNull();
    }
  });

  it("counts unicode code points, not UTF-16 code units", () => {
    // "𝔘" is a surrogate pair (2 UTF-16 units) but 1 code point.
    expect(maxLength("field", "𝔘", 1)).toBeNull();
  });
});

describe("oneOf", () => {
  it("returns null when value is allowed", () => {
    expect(oneOf("field", "b", ["a", "b", "c"])).toBeNull();
  });

  it("returns a ValidationError when value is not allowed", () => {
    const result = oneOf("field", "z", ["a", "b", "c"]);
    expect(result).toBeInstanceOf(ValidationError);
    expect(result?.message).toContain("must be one of");
  });
});

describe("ValidationError", () => {
  it("sets field, name, and a formatted message", () => {
    const err = new ValidationError("email", "must not be empty");
    expect(err.field).toBe("email");
    expect(err.name).toBe("ValidationError");
    expect(err.message).toBe("email: must not be empty");
    expect(err).toBeInstanceOf(Error);
  });
});
