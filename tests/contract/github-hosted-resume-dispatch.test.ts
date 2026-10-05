import { expect, test } from 'bun:test';
import { parseHostedResumeDispatchSignal } from '../../src/adapters/providers/github-api/contract/hosted-resume-dispatch.ts';
import { sha256 } from '../../src/contracts/canonical.ts';

const digest: `sha256:${string}` = `sha256:${'a'.repeat(64)}`;
function wire(): ReturnType<typeof parseHostedResumeDispatchSignal> {
  // Lower wire projection fixture only: CI independently validates the complete
  // original Action envelope and human authorization; no live grant is minted.
  const completedAction = { providerEnvelope: { schema: 'fixture-original-action-envelope' },
    runId: '21', runAttempt: 1, terminalArtifactId: '31', terminalArtifactName: 'sec-verification-action-fixture',
    terminalArchiveDigest: digest, terminalPayloadDigest: digest };
  const emitter = { repositoryId: '1', repository: 'sec-platform/sec', workflowPath: '.github/workflows/merge-gate.yml',
    workflowSha: 'b'.repeat(40), runId: '41', runAttempt: 1, jobId: '42', checkRunId: '43', policyJobId: 'integrate',
    phase: 'resume-verification-session', stepName: 'Resume canonical verification Session', stepNumber: 6 } as const;
  const content = { schema: 'sec-verification-session-resume-signal-v1',
    wakeKey: sha256({ schema: 'sec-verification-session-wake-key-v1', completedAction }), completedAction, emitter } as const;
  return { ...content, signalDigest: sha256(content) };
}
function rehash<T extends { signalDigest: unknown }>(value: T) {
  const { signalDigest: _old, ...content } = value;
  return { ...content, signalDigest: sha256(content) };
}

test('fixed resume wire retains stable work identity separately from the actual emitter', () => {
  const first = wire();
  const next = rehash({ ...first, emitter: { ...first.emitter, runId: '45', jobId: '46', checkRunId: '47' } });
  const parsedFirst = parseHostedResumeDispatchSignal(JSON.stringify(first));
  const parsedNext = parseHostedResumeDispatchSignal(JSON.stringify(next));
  expect(parsedFirst).toEqual(first);
  expect(parsedNext).toEqual(next);
  expect(parsedFirst.wakeKey).toBe(parsedNext.wakeKey);
  expect(parsedNext.signalDigest).not.toBe(parsedFirst.signalDigest);
  expect(Object.isFrozen(parsedFirst.emitter)).toBe(true);
});

test('resume wire rejects wrong phase, rerun and domain identity', () => {
  const first = wire();
  for (const emitter of [{ ...first.emitter, runAttempt: 2 }, { ...first.emitter, policyJobId: 'authorize' },
    { ...first.emitter, phase: 'integrate-hosted' }, { ...first.emitter, stepName: 'Arbitrary caller phase' },
    { ...first.emitter, workflowPath: '.github/workflows/compiler-pr-validation.yml' },
    { ...first.emitter, jobId: '0' }, { ...first.emitter, stepNumber: 0 }]) {
    expect(() => parseHostedResumeDispatchSignal(JSON.stringify(rehash({ ...first, emitter }))))
      .toThrow('Hosted resume wire identity is invalid.');
  }
});

test('resume wire rejects extension fields and duplicate keys', () => {
  const first = wire();
  const source = JSON.stringify(first);
  expect(() => parseHostedResumeDispatchSignal(JSON.stringify({ ...first, event_type: 'arbitrary' })))
    .toThrow('Hosted resume wire fields differ.');
  expect(() => parseHostedResumeDispatchSignal(source.replace('"runId":"41"', '"runId":"41","runId":"41"')))
    .toThrow('contains duplicate key "runId"');
  expect(() => parseHostedResumeDispatchSignal(source.replace('"emitter":', `"emitter":${JSON.stringify(first.emitter)},"emitter":`)))
    .toThrow('contains duplicate key "emitter"');
});

test('resume wire binds the wake key and complete signal digest', () => {
  const first = wire();
  // Recompute the outer digest so only the completed-Action wake identity is wrong.
  expect(() => parseHostedResumeDispatchSignal(JSON.stringify(rehash({ ...first, wakeKey: `sha256:${'f'.repeat(64)}` }))))
    .toThrow('Hosted resume wire digest differs.');
  // This is another valid emitter identity with the original signal digest.
  expect(() => parseHostedResumeDispatchSignal(JSON.stringify({ ...first, emitter: { ...first.emitter, jobId: '99' } })))
    .toThrow('Hosted resume wire digest differs.');
});

test('resume wire enforces the 32 KiB input boundary before parsing', () => {
  const first = wire();
  const source = JSON.stringify(first);
  const atLimit = source + ' '.repeat(32 * 1024 - Buffer.byteLength(source, 'utf8'));
  expect(Buffer.byteLength(atLimit, 'utf8')).toBe(32 * 1024);
  expect(parseHostedResumeDispatchSignal(atLimit)).toEqual(first);
  expect(() => parseHostedResumeDispatchSignal(`${atLimit} `))
    .toThrow('exceeds its maximum input size of 32768 bytes');
});
