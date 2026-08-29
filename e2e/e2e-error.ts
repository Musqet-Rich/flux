// The one error the E2E harness throws: something in the stack could not be started.
export class E2eError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'E2eError';
  }
}
