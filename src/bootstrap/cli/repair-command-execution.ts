import { formatCompilerFailure } from '../../compiler/errors.ts';
import { runRepairWithFailureReadback as executeRepair } from '../../application/repair-execution.ts';

/** Assemble the repair use case with this CLI's non-authoritative diagnostics. */
export function runRepairWithFailureReadback<T>(
  execute: () => Promise<T>,
  readback: () => Promise<void>
): Promise<T> {
  return executeRepair(execute, readback, (secondary) => {
    console.error(`Repair failure readback also failed: ${formatCompilerFailure(secondary)}`);
  });
}
