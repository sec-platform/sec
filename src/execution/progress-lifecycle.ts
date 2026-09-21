import { observeOptionalDiagnostic as observe } from './optional-diagnostic.ts';

/** Progress is an observer, never the authority for the action's result.
 * Providers implement synchronous UI methods. Any accidentally returned
 * thenable is rejection-observed, not awaited or treated as settled UI work. */
export interface ProgressObserver {
  start(text: string): unknown;
  succeed(text: string): unknown;
  fail(text: string): unknown;
  stop(): unknown;
}


export async function withProgressLifecycle<T>(
  text: string,
  create: () => ProgressObserver,
  execute: () => Promise<T>
): Promise<T> {
  let observer: ProgressObserver | undefined;
  try { observer = create(); }
  catch { /* Optional presentation may be unavailable; execution still runs. */ }
  try {
    observe(() => observer?.start(text));
    let result: T;
    try { result = await execute(); }
    catch (error) {
      observe(() => observer?.fail(text));
      throw error;
    }
    // A successful action followed by display failure is not a failed action.
    observe(() => observer?.succeed(text));
    return result;
  } finally {
    // The handle is captured before start, so even a partially failed start
    // has a cleanup opportunity. A broken stop cannot replace a primary error.
    observe(() => observer?.stop());
  }
}
