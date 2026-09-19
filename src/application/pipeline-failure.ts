import { CompilerError, getErrorCode, inspectFailureValue } from '../compiler/errors.ts';

/** Failure description is diagnostic only; the original value remains the cause. */
export function describePipelineFailure(error: unknown): Readonly<{ code: string; message: string }> {
  let code = 'UNEXPECTED';
  try { if (error instanceof CompilerError) code = getErrorCode(error) ?? code; }
  catch { /* A revoked proxy is still a failure value. */ }
  try {
    if (error instanceof Error) {
      const message = error.message;
      if (typeof message === 'string') return { code, message };
    }
  } catch { /* Fall back without invoking a custom formatter. */ }
  const primitive = error === null || (typeof error !== 'object' && typeof error !== 'function');
  return { code, message: primitive ? String(error) : inspectFailureValue(error) };
}

export interface PipelineSettlementFailureEntry {
  readonly operation: string;
  readonly reason: unknown;
}

/** A failed settlement is not optional diagnostic output. It may fail before
 * or after a durable write; do not infer physical absence. Preserve both
 * the execution cause and every attempted settlement failure, never hide either. */
export class PipelineSettlementFailure extends CompilerError {
  readonly settlementFailures: readonly PipelineSettlementFailureEntry[];

  constructor(primary: unknown, failures: readonly PipelineSettlementFailureEntry[]) {
    super('PIPELINE-SETTLEMENT-001', 'Pipeline failed and failure settlement did not complete', {
      primary: describePipelineFailure(primary),
      settlements: failures.map(({ operation, reason }) => ({ operation, ...describePipelineFailure(reason) }))
    }, { cause: primary });
    this.name = 'PipelineSettlementFailure';
    this.settlementFailures = Object.freeze(failures.map(entry => Object.freeze({ ...entry })));
  }
}

/** Each step retains its own commit fence. Never retries or bypasses a refusal. */
export async function settlePipelineFailure(
  primary: unknown,
  steps: readonly Readonly<{ operation: string; run: () => Promise<void> }> []
): Promise<never> {
  // Fix the settlement inventory before invoking any step. Neither a prior
  // callback nor its await may replace later work or labels. Keep the actual
  // receiver: providers may own private state that a record clone cannot carry.
  const captured: Array<Readonly<{ operation: string; run: () => Promise<void> }>> = [];
  try {
    if (!Array.isArray(steps)) throw new TypeError('Pipeline settlement steps must be an array');
    const length = steps.length;
    for (let index = 0; index < length; index += 1) {
      if (!Object.hasOwn(steps, index)) throw new TypeError('Pipeline settlement steps must be dense');
      const receiver = steps[index]!;
      const { operation, run } = receiver;
      if (typeof operation !== 'string' || operation.length === 0 || typeof run !== 'function') {
        throw new TypeError('Pipeline settlement steps need a name and callable operation');
      }
      captured.push(Object.freeze({ operation, run: async () => { await Reflect.apply(run, receiver, []); } }));
    }
  } catch (reason) {
    throw new PipelineSettlementFailure(primary, [{ operation: 'settlement-plan', reason }]);
  }
  const failures: PipelineSettlementFailureEntry[] = [];
  for (const step of captured) {
    try { await step.run(); }
    catch (reason) { failures.push({ operation: step.operation, reason }); }
  }
  if (failures.length > 0) throw new PipelineSettlementFailure(primary, failures);
  throw primary;
}
