import {
  SecError,
  type SecErrorDetails
} from '../system-architecture/foundation/contract/failure.ts';

export { SecError as CompilerError };
export type CompilerErrorDetails = SecErrorDetails;

export function formatCompilerFailure(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  if (error instanceof SecError && error.details) {
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
  throw new SecError(code, message, details);
}
