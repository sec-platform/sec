/** Non-authoritative display only. Never use this for validation, persistence,
 * authorization, cleanup or a completion receipt. Unexpected asynchronous
 * rejection is observed, but presentation is not allowed to hold the operation. */
export function observeOptionalDiagnostic(effect: () => unknown): void {
  try { void Promise.resolve(effect()).catch(() => {}); }
  catch { /* Preserve the operation outcome when optional presentation fails. */ }
}
