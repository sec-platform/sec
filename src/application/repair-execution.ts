import { observeOptionalDiagnostic } from '../execution/optional-diagnostic.ts';

/** Read failure artifacts once after the requested repair fails. The original
 * failure remains authoritative; optional reporting cannot block its return. */
export async function runRepairWithFailureReadback<T>(
  execute: () => Promise<T>,
  readback: () => Promise<void>,
  reportReadbackFailure: (failure: unknown) => unknown
): Promise<T> {
  try {
    return await execute();
  } catch (primary) {
    try {
      await readback();
    } catch (secondary) {
      observeOptionalDiagnostic(() => reportReadbackFailure(secondary));
    }
    throw primary;
  }
}
