// A partial that cannot expand as authored: an unknown ref, a duration the partial cannot honour, an
// align that cannot land. Carries the validation code and the authored path so the validator reports it
// like any other finding.
export class PartialError extends Error {
  constructor(
    readonly path: string,
    readonly code: string,
    message: string,
    readonly hint?: string
  ) {
    super(message);
    this.name = 'PartialError';
  }
}
