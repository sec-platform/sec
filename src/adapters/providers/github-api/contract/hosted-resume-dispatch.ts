import { sha256 } from '../../../../contracts/canonical.ts';
import { parseExactJsonBytes } from '../../../../contracts/exact-json.ts';

export const HOSTED_RESUME_DISPATCH_EVENT = 'sec-resume-verification-session-v1' as const;
export const HOSTED_RESUME_SIGNAL_SCHEMA = 'sec-verification-session-resume-signal-v1' as const;
export type HostedResumeEmitter = Readonly<{
  repositoryId: string; repository: string; workflowPath: '.github/workflows/merge-gate.yml';
  workflowSha: string; runId: string; runAttempt: 1; jobId: string; checkRunId: string;
  policyJobId: 'integrate'; phase: 'resume-verification-session';
  stepName: 'Resume canonical verification Session'; stepNumber: number;
}>;
export type HostedResumeSignal = Readonly<{
  schema: typeof HOSTED_RESUME_SIGNAL_SCHEMA;
  wakeKey: `sha256:${string}`;
  completedAction: Readonly<{ providerEnvelope: Readonly<Record<string, unknown>>;
    runId: string; runAttempt: number; terminalArtifactId: string; terminalArtifactName: string;
    terminalArchiveDigest: `sha256:${string}`; terminalPayloadDigest: `sha256:${string}` }>;
  emitter: HostedResumeEmitter;
  signalDigest: `sha256:${string}`;
}>;
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw new Error('Hosted resume wire fields differ.');
  return value as Record<string, unknown>;
}
function positive(value: unknown): value is string { return typeof value === 'string' && /^[1-9][0-9]{0,19}$/u.test(value); }
function digest(value: unknown): value is `sha256:${string}` { return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value); }
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

/** Bounded data projection only; original CI owns Action/request/cause semantics. */
export function parseHostedResumeDispatchSignal(source: string): HostedResumeSignal {
  const value = object(parseExactJsonBytes(Buffer.from(source, 'utf8'), 'Hosted resume signal',
    { maximumInputBytes: 32 * 1024, maximumDepth: 32 }),
  ['schema', 'wakeKey', 'completedAction', 'emitter', 'signalDigest']);
  const completed = object(value.completedAction, ['providerEnvelope', 'runId', 'runAttempt',
    'terminalArtifactId', 'terminalArtifactName', 'terminalArchiveDigest', 'terminalPayloadDigest']);
  const emitter = object(value.emitter, ['repositoryId', 'repository', 'workflowPath', 'workflowSha',
    'runId', 'runAttempt', 'jobId', 'checkRunId', 'policyJobId', 'phase', 'stepName', 'stepNumber']);
  if (value.schema !== HOSTED_RESUME_SIGNAL_SCHEMA || !digest(value.wakeKey) || !digest(value.signalDigest)
      || completed.providerEnvelope === null || typeof completed.providerEnvelope !== 'object'
      || Array.isArray(completed.providerEnvelope) || !positive(completed.runId)
      || !Number.isSafeInteger(completed.runAttempt) || Number(completed.runAttempt) < 1 || Number(completed.runAttempt) > 1000
      || !positive(completed.terminalArtifactId) || typeof completed.terminalArtifactName !== 'string'
      || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/u.test(completed.terminalArtifactName)
      || !digest(completed.terminalArchiveDigest) || !digest(completed.terminalPayloadDigest)
      || !positive(emitter.repositoryId) || typeof emitter.repository !== 'string'
      || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(emitter.repository)
      || emitter.workflowPath !== '.github/workflows/merge-gate.yml'
      || typeof emitter.workflowSha !== 'string' || !/^[0-9a-f]{40}$/u.test(emitter.workflowSha)
      || !positive(emitter.runId) || emitter.runAttempt !== 1 || !positive(emitter.jobId) || !positive(emitter.checkRunId)
      || emitter.policyJobId !== 'integrate' || emitter.phase !== 'resume-verification-session'
      || emitter.stepName !== 'Resume canonical verification Session'
      || !Number.isSafeInteger(emitter.stepNumber) || Number(emitter.stepNumber) < 1 || Number(emitter.stepNumber) > 100) {
    throw new Error('Hosted resume wire identity is invalid.');
  }
  if (value.wakeKey !== sha256({ schema: 'sec-verification-session-wake-key-v1', completedAction: completed })
      || value.signalDigest !== sha256({ schema: value.schema, wakeKey: value.wakeKey,
        completedAction: completed, emitter })) throw new Error('Hosted resume wire digest differs.');
  return freeze(value) as HostedResumeSignal;
}
