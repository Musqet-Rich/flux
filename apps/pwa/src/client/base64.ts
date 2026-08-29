// Standard base64 (the `btoa` alphabet, with padding) for attachment chunks and thumbnails
// (protocol.md § 7, `attach.chunk` and `attach.read`). The protocol package's `base64url` is
// for keys; the box decodes chunk data with Node's own decoder, which reads this alphabet.
// Encoding goes through `String.fromCharCode` in slices, since spreading a whole file into
// one call would blow the argument limit.

const sliceSize = 0x8000;

const encode = (bytes: Uint8Array): string => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += sliceSize) {
    binary += String.fromCodePoint(...bytes.subarray(offset, offset + sliceSize));
  }
  return btoa(binary);
};

const decode = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(text), (char) => char.codePointAt(0) ?? 0);

export const base64: { encode: typeof encode; decode: typeof decode } = { encode, decode };
