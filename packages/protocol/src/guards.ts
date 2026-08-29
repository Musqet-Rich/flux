// Combinators for the hand-written type guards (ADR 0009). Everything crossing the wire is
// `unknown` until one of these says otherwise. Kept as one object because the file-shape rule
// allows one primary export per file and these only make sense together.

const isString = (value: unknown): value is string => typeof value === 'string';

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

// Finite only: NaN and Infinity are not representable in JSON and never valid on the wire.
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

// A whole number at or above `min`; seq, counts and line numbers are all of this shape.
const isInteger = (value: unknown, min = 0): value is number =>
  Number.isInteger(value) && isNumber(value) && value >= min;

// A plain object as JSON produces it. Arrays and null are objects to `typeof` but not records.
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isArrayOf = <T>(value: unknown, item: (v: unknown) => v is T): value is T[] =>
  Array.isArray(value) && value.every((v) => item(v));

const isOneOf = <const T extends readonly string[]>(
  value: unknown,
  options: T,
): value is T[number] => isString(value) && options.includes(value);

// `undefined` passes, so the field may be absent; `null` does not (exactOptionalPropertyTypes).
const isOptional = <T>(value: unknown, guard: (v: unknown) => v is T): value is T | undefined =>
  value === undefined || guard(value);

export const guards: {
  isString: typeof isString;
  isBoolean: typeof isBoolean;
  isNumber: typeof isNumber;
  isInteger: typeof isInteger;
  isRecord: typeof isRecord;
  isArrayOf: typeof isArrayOf;
  isOneOf: typeof isOneOf;
  isOptional: typeof isOptional;
} = { isString, isBoolean, isNumber, isInteger, isRecord, isArrayOf, isOneOf, isOptional };
