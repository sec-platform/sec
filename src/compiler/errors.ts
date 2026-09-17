import { inspectFailureValue } from '../contracts/failure-inspection.ts';
export { getErrorCode, inspectFailureValue } from '../contracts/failure-inspection.ts';

import {
  SecError,
  type SecErrorDetails
} from '../contracts/failure.ts';

export { SecError as CompilerError };
export type CompilerErrorDetails = SecErrorDetails;

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
