import { formatCompilerFailure } from '../../compiler/errors.ts';
import { runRepairWithFailureReadback as executeRepair } from '../../application/repair-execution.ts';
import { reportRepairFailureReadback } from '../../entry/cli/repair-failure-readback.ts';

/** Assemble the repair use case with this CLI's non-authoritative diagnostics. */
export function runRepairWithFailureReadback<T>(
  execute: () => Promise<T>,
  readback: () => Promise<void>
): Promise<T> {
  return executeRepair(execute, readback, secondary => {
    reportRepairFailureReadback(formatCompilerFailure(secondary));
  });
}
