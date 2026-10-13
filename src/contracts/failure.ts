export type CodedFailureDetails =
  | Record<string, unknown>
  | string
  | number
  | boolean
  | null
  | unknown[];

/**
 * Cross-domain typed failure carrier. Domain owners define codes and
 * projections; this class only preserves one runtime identity across package
 * boundaries so lower capabilities never import a higher domain error module.
 */
export class CodedFailure extends Error {
  public readonly code: string;
  public readonly details: CodedFailureDetails;

  constructor(
    code: string,
    message: string,
    details: CodedFailureDetails = {},
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'CodedFailure';
    this.code = code;
    this.details = details;
  }
}

/** Throw a domain-coded failure without introducing a second Error identity. */
export function fail(code: string, message: string, details: CodedFailureDetails = {}): never {
  throw new CodedFailure(code, message, details);
}
