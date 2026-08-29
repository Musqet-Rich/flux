import type { RpcErrorCode } from '@flux/protocol';

// The daemon's one error type (engineering.md § TypeScript). Codes are the RPC error codes from
// protocol.md § 7 so an error can cross the RPC boundary without translation.
export class DaemonError extends Error {
  readonly code: RpcErrorCode;

  constructor(code: RpcErrorCode, message: string) {
    super(message);
    this.name = 'DaemonError';
    this.code = code;
  }
}
