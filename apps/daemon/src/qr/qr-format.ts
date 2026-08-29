// Format and version information (ISO/IEC 18004 § 7.9 and § 7.10): BCH codes over GF(2),
// computed rather than tabulated. Format is 5 data bits (2 level, 3 mask) with 10 check bits,
// masked with 0x5412; version is 6 data bits with 12 check bits, unmasked.

export type EcLevel = 'L' | 'M' | 'Q' | 'H';

const levelBits: Record<EcLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };
// x^10 + x^8 + x^5 + x^4 + x^2 + x + 1
const formatGenerator = 0x537;
// x^12 + x^11 + x^10 + x^9 + x^8 + x^5 + x^2 + 1
const versionGenerator = 0x1f25;
const formatMask = 0x5412;

const bitLength = (n: number): number => n.toString(2).length;

// The remainder of value·x^degree divided by the generator, as an integer of `degree` bits.
const bchRemainder = (value: number, generator: number, degree: number): number => {
  let remainder = value << degree;
  const generatorLength = bitLength(generator);
  while (bitLength(remainder) >= generatorLength) {
    remainder ^= generator << (bitLength(remainder) - generatorLength);
  }
  return remainder;
};

const bits = (mask: number, level: EcLevel = 'M'): number => {
  const data = (levelBits[level] << 3) | mask;
  return ((data << 10) | bchRemainder(data, formatGenerator, 10)) ^ formatMask;
};

const versionBits = (version: number): number =>
  (version << 12) | bchRemainder(version, versionGenerator, 12);

export const qrFormat: { bits: typeof bits; versionBits: typeof versionBits } = {
  bits,
  versionBits,
};
