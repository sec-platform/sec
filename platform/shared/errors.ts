export type CompilerErrorDetails =
  | Record<string, unknown>
  | string
  | number
  | boolean
  | null
  | unknown[];

export class CompilerError extends Error {
  public readonly code: string;
  public readonly details: CompilerErrorDetails;

  constructor(code: string, message: string, details: CompilerErrorDetails = {}) {
    super(message);
    this.name = 'CompilerError';
    this.code = code;
    this.details = details;
  }
}

export function formatCompilerFailure(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  if (error instanceof CompilerError && error.details) {
    return `${error.stack ?? error.message}\n${JSON.stringify(error.details, null, 2)}`;
  }

  return error.stack ?? error.message;
}

/**
 * Extract a string error code from an unknown error object.
 * Handles both `Error` instances with `code` property and plain objects.
 */
export function getErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

/**
 * Throw a `CompilerError` — shared factory used across compiler modules
 * to avoid redefining the same `fail` wrapper.
 */
export function fail(code: string, message: string, details: CompilerErrorDetails = {}): never {
  throw new CompilerError(code, message, details);
}
