export type SecErrorDetails =
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
export class SecError extends Error {
  public readonly code: string;
  public readonly details: SecErrorDetails;

  constructor(
    code: string,
    message: string,
    details: SecErrorDetails = {},
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'SecError';
    this.code = code;
    this.details = details;
  }
}
