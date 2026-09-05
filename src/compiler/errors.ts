import { inspect } from 'node:util';

import {
  SecError,
  type SecErrorDetails
} from '../system-architecture/foundation/contract/failure.ts';

export { SecError as CompilerError };
export type CompilerErrorDetails = SecErrorDetails;

function inspectFailureValue(value: unknown): string {
  try {
    return inspect(value, { customInspect: false, getters: false });
  } catch {
    return '[Failure value cannot be inspected]';
  }
}

export function formatCompilerFailure(error: unknown): string {
  try {
    if (!(error instanceof Error)) return String(error);

    const primary = error.stack ?? error.message;
    if (typeof primary !== 'string') return inspectFailureValue(error);
    if (!(error instanceof SecError)) return primary;
    let details: SecErrorDetails | undefined;
    try {
      details = error.details;
      return details ? `${primary}\n${JSON.stringify(details, null, 2)}` : primary;
    } catch {
      // Snapshot details once. Circular values, bigint and failing hooks must
      // not replace the primary failure with a secondary formatting exception.
      return `${primary}\n[Details could not be rendered as JSON]\n${inspectFailureValue(details)}`;
    }
  } catch {
    // Even instanceof, stack access or String() can throw for supplied values.
    return inspectFailureValue(error);
  }
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
