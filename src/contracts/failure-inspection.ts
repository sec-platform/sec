import { inspect } from 'node:util';

export function inspectFailureValue(value: unknown): string {
  try {
    return inspect(value, { customInspect: false, getters: false });
  } catch {
    return '[Failure value cannot be inspected]';
  }
}

/**
 * Extract a string error code from an unknown error object.
 * Handles both `Error` instances with `code` property and plain objects.
 */
export function getErrorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  try {
    // Read once. Error classification must not replace the original failure
    // with a throwing accessor, Proxy trap, or revoked Proxy exception.
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  } catch {
    return undefined;
  }
}

/** A diagnostic projection, never a failure classifier or recovery authority.
 * Non-Error objects are inspected without custom formatters or getters.
 */
export function failureMessage(error: unknown): string {
  try {
    if (error instanceof Error) {
      const message = error.message;
      if (typeof message === 'string') return message;
    }
  } catch { /* The original thrown value may be a revoked Proxy. */ }
  return error === null || (typeof error !== 'object' && typeof error !== 'function')
    ? String(error) : inspectFailureValue(error);
}
