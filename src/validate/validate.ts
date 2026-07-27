// Ported from ts-sentinel/src/validate/validate.ts (see that repo for the canonical source) —
// kept in sync by hand, not a live dependency (ts-sentinel is ESM-only, incompatible with this
// package's CJS/NestJS consumers via require()).

/** Thrown by validation helpers on failure. `field` identifies which input failed. */
export class ValidationError extends Error {
  constructor(
    public readonly field: string,
    message: string
  ) {
    super(`${field}: ${message}`);
    this.name = "ValidationError";
  }
}

/** Checks that value, after trimming whitespace, is not empty. Returns the error, or null. */
export function nonEmpty(field: string, value: string): ValidationError | null {
  if (value.trim() === "") {
    return new ValidationError(field, "must not be empty");
  }
  return null;
}

/** Checks that value does not exceed `max` characters. Returns the error, or null. */
export function maxLength(field: string, value: string, max: number): ValidationError | null {
  if ([...value].length > max) {
    return new ValidationError(field, `must not exceed ${max} characters`);
  }
  return null;
}

/** Checks that value is a member of `allowed`. Returns the error, or null. */
export function oneOf(field: string, value: string, allowed: string[]): ValidationError | null {
  if (allowed.includes(value)) {
    return null;
  }
  return new ValidationError(field, `must be one of ${JSON.stringify(allowed)}`);
}
