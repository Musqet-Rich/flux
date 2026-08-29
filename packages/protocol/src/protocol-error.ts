// The one error type this package throws (engineering.md § TypeScript: Error subclasses
// defined in the package). `code` is stable and machine-readable; `message` is for humans.
export type ProtocolErrorCode =
  | 'bad_base64'
  | 'bad_frame'
  | 'bad_nonce'
  | 'bad_key'
  | 'bad_message'
  | 'decrypt_failed'
  | 'insecure_transport';

export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;

  constructor(code: ProtocolErrorCode, message: string) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
  }
}
