import { expect, test } from 'bun:test';
import { HOSTED_RESUME_SIGNAL_SCHEMA, parseHostedResumeDispatchSignal } from '../../src/adapters/providers/github-api/contract/hosted-resume-dispatch.ts';
import { dispatchHostedSessionResume } from '../../src/application/verification-session-hosted.ts';
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
