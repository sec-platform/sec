import { PASS_INITIAL_STATES, type PassId } from '../compiler/contract/pass-status.ts';
import { CompilerError } from '../compiler/errors.ts';
import { describePipelineFailure } from './pipeline-failure.ts';

const issuedPassFailures = new WeakSet<object>();

export class PipelinePassFailure extends CompilerError {
  readonly originPass: PassId;

  constructor(originPass: PassId, error: unknown) {
    const failure = describePipelineFailure(error);
    let details = {};
    try {
      if (error instanceof CompilerError) details = error.details ?? {};
    } catch {
      // Keep the original cause when its diagnostic details are unreadable.
    }
    super(failure.code, failure.message, details);
    this.name = 'PipelinePassFailure';
    this.originPass = originPass;
    Object.defineProperty(this, 'originPass', {
      value: originPass,
      enumerable: true,
      writable: false,
      configurable: false
    });
    this.cause = error;
    issuedPassFailures.add(this);
  }
}

export function isPipelinePassFailure(value: unknown): value is PipelinePassFailure {
  return typeof value === 'object' && value !== null && issuedPassFailures.has(value);
}

export async function runPipelinePass<T>(
  originPass: PassId,
  execute: () => T | Promise<T>
): Promise<T> {
  if (!Object.hasOwn(PASS_INITIAL_STATES, originPass)) {
    throw new CompilerError('PIPELINE-USAGE-001', 'Unknown pipeline pass');
  }
  try {
    return await execute();
  } catch (error) {
    if (isPipelinePassFailure(error)) throw error;
    throw new PipelinePassFailure(originPass, error);
  }
}
