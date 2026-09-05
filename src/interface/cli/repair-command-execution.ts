import { formatCompilerFailure } from '../../compiler/errors.ts';

/** Repair may leave a diagnostic plan on failure; inspecting it is not a second repair. */
export async function runRepairWithFailureReadback<T>(
  execute: () => Promise<T>,
  readback: () => Promise<void>
): Promise<T> {
  try {
    return await execute();
  } catch (primary) {
    try {
      await readback();
    } catch (secondary) {
      try {
        console.error(`Repair failure readback also failed: ${formatCompilerFailure(secondary)}`);
      } catch { /* Even the diagnostic sink must not replace the original repair failure. */ }
    }
    throw primary;
  }
}
