// The PWA's own error class (docs/engineering.md § TypeScript). `code` is an RPC error code from
// the box (protocol.md § 7) or one of the client-side conditions: `offline`, `bad_pairing`,
// `relay_refused`, `bad_reply`, `bad_version`, `insecure_transport`, `timeout`.

export class ClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ClientError';
    this.code = code;
  }
}
