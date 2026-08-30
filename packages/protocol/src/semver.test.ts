import { expect, test } from 'vitest';

import { semver } from './semver.ts';

test('isValid accepts X.Y.Z and X.Y.Z-pre, rejects the rest', () => {
  expect(semver.isValid('1.2.3')).toBe(true);
  expect(semver.isValid('0.0.0')).toBe(true);
  expect(semver.isValid('10.20.30')).toBe(true);
  expect(semver.isValid('0.0.0-dev')).toBe(true);
  expect(semver.isValid('1.2.3-rc.1')).toBe(true);
  expect(semver.isValid('1.2')).toBe(false);
  expect(semver.isValid('1.2.3.4')).toBe(false);
  expect(semver.isValid('v1.2.3')).toBe(false);
  expect(semver.isValid('1.2.x')).toBe(false);
  expect(semver.isValid('')).toBe(false);
  expect(semver.isValid('1.2.3-')).toBe(false);
});

test('isNewer compares equal versions as not newer', () => {
  expect(semver.isNewer('1.2.3', '1.2.3')).toBe(false);
});

test('isNewer compares the major field either way', () => {
  expect(semver.isNewer('2.0.0', '1.9.9')).toBe(true);
  expect(semver.isNewer('1.9.9', '2.0.0')).toBe(false);
});

test('isNewer compares the minor field either way', () => {
  expect(semver.isNewer('1.3.0', '1.2.9')).toBe(true);
  expect(semver.isNewer('1.2.9', '1.3.0')).toBe(false);
});

test('isNewer compares the patch field either way', () => {
  expect(semver.isNewer('1.2.4', '1.2.3')).toBe(true);
  expect(semver.isNewer('1.2.3', '1.2.4')).toBe(false);
});

test('a pre-release sorts below the same core release', () => {
  expect(semver.isNewer('1.0.0', '1.0.0-dev')).toBe(true);
  expect(semver.isNewer('1.0.0-dev', '1.0.0')).toBe(false);
  expect(semver.isNewer('0.0.0', '0.0.0-dev')).toBe(true);
});

test('two pre-releases order by ASCII, equal ones are not newer', () => {
  expect(semver.isNewer('1.0.0-rc.2', '1.0.0-rc.1')).toBe(true);
  expect(semver.isNewer('1.0.0-rc.1', '1.0.0-rc.2')).toBe(false);
  expect(semver.isNewer('1.0.0-dev', '1.0.0-dev')).toBe(false);
});

test('isNewer is false when either version is invalid', () => {
  expect(semver.isNewer('nope', '1.0.0')).toBe(false);
  expect(semver.isNewer('1.0.0', 'nope')).toBe(false);
  expect(semver.isNewer('nope', 'also-nope')).toBe(false);
});

test('atLeast is inclusive of the floor and orders around it', () => {
  expect(semver.atLeast('1.0.0', '1.0.0')).toBe(true);
  expect(semver.atLeast('1.2.0', '1.0.0')).toBe(true);
  expect(semver.atLeast('0.9.9', '1.0.0')).toBe(false);
  expect(semver.atLeast('1.0.0-dev', '1.0.0')).toBe(false);
});

test('atLeast is false when either version is invalid', () => {
  expect(semver.atLeast('nope', '1.0.0')).toBe(false);
  expect(semver.atLeast('1.0.0', 'nope')).toBe(false);
});
