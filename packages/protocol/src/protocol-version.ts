// Exchanged in the relay join, in every handshake hello and in the `hello` RPC (protocol.md § 8).
// Both ends refuse to talk across versions; additive changes do not bump it. Version 2 bound the
// handshake transcript into key derivation (ADR 0019), so v1 and v2 peers derive different keys.
export const protocolVersion = 2;
