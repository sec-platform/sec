import { expect, test } from 'bun:test';
import { HOSTED_RESUME_SIGNAL_SCHEMA, parseHostedResumeDispatchSignal } from '../../src/adapters/providers/github-api/contract/hosted-resume-dispatch.ts';
import {
  dispatchHostedSessionResume, verifyHostedIntegrationRecovery,
  type HostedControlStepFact, type HostedRecoveryVerificationPorts
} from '../../src/application/verification-session-hosted.ts';
import { sha256 } from '../../src/contracts/canonical.ts';
import type { HostedResumeEmitter } from '../../src/execution/verification/hosted.ts';

// These are explicit data/port doubles. They prove application ordering and
// compatibility with the original wire parser, never native job qualification.
const emitter: HostedResumeEmitter = Object.freeze({
  repositoryId: '1', repository: 'owner/repo', workflowPath: '.github/workflows/merge-gate.yml',
  workflowSha: 'a'.repeat(40), runId: '2', runAttempt: 1, jobId: '3', checkRunId: '4',
  policyJobId: 'integrate', phase: 'resume-verification-session',
  stepName: 'Resume canonical verification Session', stepNumber: 5
});
const completedAction = Object.freeze({ providerEnvelope: Object.freeze({ example: 'data-double' }),
  runId: '6', runAttempt: 1, terminalArtifactId: '7', terminalArtifactName: 'terminal',
  terminalArchiveDigest: sha256('archive'), terminalPayloadDigest: sha256('payload') });

test('resume sender emits the exact original signal after observing terminal facts', async () => {
  const order: string[] = [];
  const result = await dispatchHostedSessionResume('authority-double', {
    signalSchema: HOSTED_RESUME_SIGNAL_SCHEMA,
    observeCompletedAction: async authority => {
      expect(authority).toBe('authority-double'); order.push('terminal'); return { completedAction };
    },
    observeEmitter: () => { order.push('emitter'); return emitter; },
    digest: sha256,
    encodeData: JSON.stringify,
    dispatchSignal: async source => {
      order.push('dispatch');
      const signal = parseHostedResumeDispatchSignal(source);
      expect(signal.completedAction).toEqual(completedAction);
      expect(signal.emitter).toEqual(emitter);
      return { status: 'submitted', signalDigest: signal.signalDigest };
    }
  });
  expect(order).toEqual(['terminal', 'emitter', 'dispatch']);
  expect(result.status).toBe('submitted');
});

test('unavailable Action facts cannot emit a resume signal, including falsy failures', async () => {
  let laterCalls = 0;
  let caught: unknown = Symbol('not-caught');
  try {
    await dispatchHostedSessionResume('authority-double', {
      signalSchema: HOSTED_RESUME_SIGNAL_SCHEMA,
      observeCompletedAction: async () => { throw null; },
      observeEmitter: () => { laterCalls += 1; return emitter; },
      digest: sha256, encodeData: JSON.stringify,
      dispatchSignal: async () => { laterCalls += 1; return { status: 'submitted', signalDigest: sha256('wrong') }; }
    });
  } catch (error) { caught = error; }
  expect(caught).toBeNull();
  expect(laterCalls).toBe(0);
});

test('resume sender refuses a dispatch readback for another signal', async () => {
  await expect(dispatchHostedSessionResume('authority-double', {
    signalSchema: HOSTED_RESUME_SIGNAL_SCHEMA,
    observeCompletedAction: async () => ({ completedAction }), observeEmitter: () => emitter,
    digest: sha256, encodeData: JSON.stringify,
    dispatchSignal: async () => ({ status: 'submitted', signalDigest: sha256('other-signal') })
  })).rejects.toThrow('Hosted resume dispatch readback names another signal.');
});

const controlStep = (name: string, conclusion: string | null): HostedControlStepFact =>
  Object.freeze({ name, number: 1, status: 'completed', conclusion });

function identity(overrides: Readonly<{ preparation?: string | null; upload?: string | null }>): ReturnType<HostedRecoveryVerificationPorts['readControlStepFacts']> {
  return Object.freeze({
    preparation: controlStep('Prepare exact integration recovery artifact', overrides.preparation ?? 'success'),
    upload: controlStep('Upload exact branch closeout recovery artifact', overrides.upload ?? 'success')
  });
}

const localRecovery = Object.freeze({ artifactName: 'sec-branch-closeout-recovery-v1-double',
  recoveryDigest: sha256('recovery-bytes'), preflightDigest: sha256('preflight-bytes') });

function recoveryPorts(overrides: Partial<HostedRecoveryVerificationPorts>): {
  ports: HostedRecoveryVerificationPorts; written: unknown[];
} {
  const written: unknown[] = [];
  return {
    written,
    ports: {
      readControlStepFacts: () => identity({}),
      readProducedRecoveryTransport: () => localRecovery,
      readRunAttemptRecoveryArtifactNames: async () => Object.freeze([]),
      readVerifiedHostedRecoveryTransport: async () => localRecovery,
      writeProjection: (_path, value) => { written.push(value); },
      resolveOutputPath: value => value, now: () => '2026-10-04T00:00:00.000Z',
      ...overrides
    }
  };
}

test('recovery verification accepts only provider bytes equal to the local writer', async () => {
  const { ports, written } = recoveryPorts({});
  const projection = JSON.parse(await verifyHostedIntegrationRecovery(
    { repository: 'owner/repo', outputPath: 'out.json' }, ports)) as Record<string, unknown>;
  expect(projection).toMatchObject({ status: 'verified', lane: 'recovery-uploaded',
    artifactName: localRecovery.artifactName, recoveryDigest: localRecovery.recoveryDigest,
    preflightDigest: localRecovery.preflightDigest, output: 'out.json' });
  expect(written).toEqual([expect.objectContaining({ status: 'verified', lane: 'recovery-uploaded' })]);
});

test('a skipped upload verifies only when the attempt has no provider recovery artifact', async () => {
  const { ports, written } = recoveryPorts({
    readControlStepFacts: () => identity({ upload: 'skipped' }), readProducedRecoveryTransport: () => null
  });
  const projection = JSON.parse(await verifyHostedIntegrationRecovery(
    { repository: 'owner/repo', outputPath: 'out.json' }, ports)) as Record<string, unknown>;
  expect(projection).toMatchObject({ status: 'verified', lane: 'recovery-absent' });
  expect(written).toHaveLength(1);
});

test('recovery verification rejects unproven preparation, orphaned uploads and mismatched bytes', async () => {
  const cases: readonly Readonly<{ ports: HostedRecoveryVerificationPorts; message: RegExp }>[] = [
    { ports: recoveryPorts({ readControlStepFacts: () => identity({ preparation: 'failure' }) }).ports,
      message: /completed successful preparation step/ },
    { ports: recoveryPorts({ readProducedRecoveryTransport: () => null }).ports,
      message: /upload step is not skipped/ },
    { ports: recoveryPorts({ readControlStepFacts: () => identity({ upload: 'skipped' }) }).ports,
      message: /without its successful upload step/ },
    { ports: recoveryPorts({ readControlStepFacts: () => identity({ upload: 'skipped' }),
        readProducedRecoveryTransport: () => null,
        readRunAttemptRecoveryArtifactNames: async () => Object.freeze([localRecovery.artifactName]) }).ports,
      message: /still has a provider artifact/ },
    { ports: recoveryPorts({ readVerifiedHostedRecoveryTransport: async () => Object.freeze({
        artifactName: localRecovery.artifactName, recoveryDigest: sha256('other-bytes'),
        preflightDigest: localRecovery.preflightDigest }) }).ports,
      message: /differ from their original local writer/ }
  ];
  for (const negative of cases) {
    await expect(verifyHostedIntegrationRecovery(
      { repository: 'owner/repo', outputPath: 'out.json' }, negative.ports)).rejects.toThrow(negative.message);
  }
});
