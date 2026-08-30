// The ed25519 release-signing public keys (ADR 0022). A release manifest signed by ANY one of
// these is trusted, so the box runs only bytes an offline key signed. The set is three from 1.0:
// one live signer and two spares kept offline, so a lost or destroyed signing machine is recovered
// by signing the next release with a spare the daemons already trust — no scramble to re-key.
export const trustedKeys: string[] = [
  `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAgxsI5pG1dFpWMil0SsyHLOsVJVXEXquUcKm8gA4rKGc=
-----END PUBLIC KEY-----
`,
  `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAWFsNn/5hDuiHpZREmICSZMtS2cHj019/ObP6KLwxGXg=
-----END PUBLIC KEY-----
`,
  `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAWKiT069wl6UVOQNMrKNT2bhY3SgsQZTZ6hPsRl5WnLo=
-----END PUBLIC KEY-----
`,
];
