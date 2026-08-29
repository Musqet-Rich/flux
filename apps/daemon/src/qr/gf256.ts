import { DaemonError } from '../daemon-error.ts';

// GF(2^8) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d) and generator element 2
// (ISO/IEC 18004 § 7.5.2). Log and antilog tables turn multiplication into lookups.

const order = 255;
const exp = new Uint8Array(order * 2);
const log = new Uint8Array(order + 1);

const at = (table: Uint8Array, index: number): number => {
  const entry = table[index];
  if (entry === undefined) throw new DaemonError('internal', `gf256 index ${index}`);
  return entry;
};

let element = 1;
for (let i = 0; i < order; i += 1) {
  exp[i] = element;
  log[element] = i;
  element *= 2;
  if (element > order) element ^= 0x11d;
}
// The antilog table is doubled so `mul` never needs a modulo.
for (let i = order; i < order * 2; i += 1) exp[i] = at(exp, i - order);

const mul = (a: number, b: number): number =>
  a === 0 || b === 0 ? 0 : at(exp, at(log, a) + at(log, b));

// The n-th power of the generator element, 2^n.
const pow = (n: number): number => at(exp, n % order);

export const gf256: { mul: typeof mul; pow: typeof pow } = { mul, pow };
