export { formatFailure as formatCompilerFailure } from '../contracts/failure-format.ts';
export { getErrorCode, inspectFailureValue } from '../contracts/failure-inspection.ts';

import {
  FailureError,
  type FailureDetails
} from '../contracts/failure.ts';

export { FailureError as CompilerError };
export type CompilerErrorDetails = FailureDetails;
