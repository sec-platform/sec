import { expect, test } from 'bun:test';
import { createCiVerificationActionParentDispatchPlan, createCiVerificationActionProposal, createCiVerificationActionProviderEnvelope } from '../../src/adapters/verification/platform/action/contract/ci.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY, verificationActionProviderTerminalArtifactName } from '../../src/adapters/verification/platform/action/contract/provider.ts';
import { CodexDevelopmentCreateVerificationEvidenceProducer, parseVerificationEvidenceProducer } from '../../src/adapters/verification/platform/ci/contract/evidence.ts';
import { createResumedSessionProducer, parseResumedSessionProducer } from '../../src/adapters/verification/platform/ci/contract/resumed-session-producer.ts';
import { createCiVerificationSessionResumeSignal } from '../../src/adapters/verification/platform/ci/runtime/verification-session-resume-contract.ts';
import { createVerificationSessionPerJobHostedRequest } from '../../src/adapters/verification/platform/ci/runtime/verification-session-runtime.ts';
import { sha256 } from '../../src/contracts/canonical.ts';

function fixture() {
  const base = 'a'.repeat(40);
  const actor = { login: 'maintainer', id: 101, nodeId: 'U_101', type: 'User', permission: 'maintain' } as const;
  const request = createVerificationSessionPerJobHostedRequest({ prNumber: 7, expectedBaseSha: base,
    expectedBaseTreeSha: 'b'.repeat(40), expectedHeadSha: 'c'.repeat(40), expectedHeadTreeSha: 'd'.repeat(40),
    manifestPath: 'config/repository/work-packages/resume.json', manifestDigest: sha256('manifest'), profile: 'quick',
    expectedScopeProposalDigest: sha256('scope'), expectedActionPlanDigest: sha256('plan'),
    expectedSessionRevision: sha256('session'), reviewPolicyDigest: sha256('review') });
  const proposal = createCiVerificationActionProposal({ sessionRequest: request, proposedActionKey: sha256('action') });
  const parentPlan = createCiVerificationActionParentDispatchPlan({ repositoryId: '1', repository: 'sec-platform/sec',
    parentRunId: '11', parentRunAttempt: 1, parentJobId: '12', parentWorkflowSha: base,
    parentWorkflowRef: 'sec-platform/sec/.github/workflows/compiler-pr-validation.yml@refs/heads/main',
    parentActor: actor, proposals: [proposal] });
  const providerEnvelope = createCiVerificationActionProviderEnvelope({ proposal, parentPlan,
    parentDispatchPlanArtifactId: '13', parentDispatchPlanArchiveDigest: sha256('archive') });
  const signal = createCiVerificationSessionResumeSignal({ completedAction: { providerEnvelope, runId: '21', runAttempt: 1,
    terminalArtifactId: '31', terminalArtifactName: verificationActionProviderTerminalArtifactName(proposal.proposedActionKey),
    terminalArchiveDigest: sha256('terminal archive'), terminalPayloadDigest: sha256('terminal') },
  emitter: { repositoryId: '1', repository: 'sec-platform/sec', workflowPath: '.github/workflows/merge-gate.yml',
    workflowSha: base, runId: '41', runAttempt: 1, jobId: '42', checkRunId: '43', policyJobId: 'integrate',
    phase: 'resume-verification-session', stepName: 'Resume canonical verification Session', stepNumber: 6 } });
  return createResumedSessionProducer({ workflowRef: `.github/workflows/compiler-pr-validation.yml@${base}`,
    workflowSha: base, runId: '51', runAttempt: 1, originalParentActor: actor, resumeSignal: signal });
}
function rehash(value: ReturnType<typeof fixture>) {
  const { sourceDigest: _old, ...fields } = value;
  return { ...fields, sourceDigest: sha256(fields) };
}

test('resumed producer records the actual App separately from its original human authority', () => {
  const value = fixture();
  expect(parseVerificationEvidenceProducer(value)).toEqual(value);
  expect(value.actorNodeId).toBe(CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.nodeId);
  expect(value.originalParentActor.nodeId).toBe('U_101');
  expect(value.runId).toBe('51');
  expect(value.resumeSignal.completedAction.runId).toBe('21');
  expect(Object.isFrozen(value.originalParentActor)).toBe(true);
});

test('legacy producer cannot acquire resumed fields by downgrade or extension', () => {
  const value = fixture();
  const { schema: _schema, sourceDigest: _digest, ...downgraded } = value;
  expect(() => CodexDevelopmentCreateVerificationEvidenceProducer(downgraded)).toThrow('cannot issue');
  expect(() => parseVerificationEvidenceProducer({ ...downgraded, sourceDigest: sha256(downgraded) })).toThrow();
});

test('correctly rehashed producer data still rejects actor, source and missing cause changes', () => {
  const value = fixture();
  for (const mutation of [
    { ...value, actorNodeId: 'U_101' },
    { ...value, originalParentActor: { ...value.originalParentActor, type: 'Bot' } },
    { ...value, originalParentActor: { ...value.originalParentActor, permission: 'write' } },
    { ...value, originalParentActor: { ...value.originalParentActor, nodeId: value.actorNodeId } },
    { ...value, workflowSha: 'f'.repeat(40), workflowRef: `.github/workflows/compiler-pr-validation.yml@${'f'.repeat(40)}` },
    { ...value, resumeSignal: null }
  ]) expect(() => parseResumedSessionProducer(rehash(mutation as typeof value))).toThrow();
});
