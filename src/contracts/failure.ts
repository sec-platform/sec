export type FailureDetails =
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
export class FailureError extends Error {
  public readonly code: string;
  public readonly details: FailureDetails;

  constructor(
    code: string,
    message: string,
    details: FailureDetails = {},
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'SecError';
    this.code = code;
    this.details = details;
  }
}

/** Throw a domain-coded failure without introducing a second Error identity. */
export function fail(code: string, message: string, details: FailureDetails = {}): never {
  throw new FailureError(code, message, details);
}
