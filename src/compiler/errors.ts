export { getErrorCode, inspectFailureValue } from '../contracts/failure-inspection.ts';

import {
  SecError,
  type SecErrorDetails
} from '../contracts/failure.ts';
export { formatFailure as formatCompilerFailure } from '../contracts/failure-format.ts';

export { SecError as CompilerError };
export type CompilerErrorDetails = SecErrorDetails;
