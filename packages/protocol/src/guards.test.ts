import { expect, test } from 'vitest';

import { guards } from './guards.ts';

const { isString, isBoolean, isNumber, isInteger, isRecord, isArrayOf, isOneOf, isOptional } =
  guards;

test('isString', () => {
  expect(isString('a')).toBe(true);
  expect(isString('')).toBe(true);
  expect(isString(1)).toBe(false);
  expect(isString(null)).toBe(false);
});

test('isBoolean', () => {
  expect(isBoolean(true)).toBe(true);
  expect(isBoolean(false)).toBe(true);
  expect(isBoolean(0)).toBe(false);
  expect(isBoolean('true')).toBe(false);
});

test('isNumber rejects NaN and Infinity', () => {
  expect(isNumber(0)).toBe(true);
  expect(isNumber(-1.5)).toBe(true);
  expect(isNumber(Number.NaN)).toBe(false);
  expect(isNumber(Number.POSITIVE_INFINITY)).toBe(false);
  expect(isNumber('1')).toBe(false);
});

test('isInteger applies the minimum', () => {
  expect(isInteger(0)).toBe(true);
  expect(isInteger(1, 1)).toBe(true);
  expect(isInteger(0, 1)).toBe(false);
  expect(isInteger(1.5)).toBe(false);
  expect(isInteger(-1)).toBe(false);
  expect(isInteger('1')).toBe(false);
});

test('isRecord accepts plain objects only', () => {
  expect(isRecord({})).toBe(true);
  expect(isRecord({ a: 1 })).toBe(true);
  expect(isRecord([])).toBe(false);
  expect(isRecord(null)).toBe(false);
  expect(isRecord('x')).toBe(false);
});

test('isArrayOf checks every item', () => {
  expect(isArrayOf([], isString)).toBe(true);
  expect(isArrayOf(['a', 'b'], isString)).toBe(true);
  expect(isArrayOf(['a', 1], isString)).toBe(false);
  expect(isArrayOf('ab', isString)).toBe(false);
});

test('isOneOf', () => {
  const states = ['idle', 'running'] as const;
  expect(isOneOf('idle', states)).toBe(true);
  expect(isOneOf('gone', states)).toBe(false);
  expect(isOneOf(1, states)).toBe(false);
});

test('isOptional passes undefined but not null', () => {
  expect(isOptional(undefined, isString)).toBe(true);
  expect(isOptional('a', isString)).toBe(true);
  expect(isOptional(null, isString)).toBe(false);
  expect(isOptional(1, isString)).toBe(false);
});
