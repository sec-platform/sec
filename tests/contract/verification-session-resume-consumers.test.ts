import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { AuthenticatedGitHubJobOrigin } from '../../src/adapters/providers/github-api/hosted-job-origin.ts';
import { createScopeAuthorization, createScopeAuthorizationRevision } from '../../src/adapters/self-hosting/control/scope/authorization.ts';
import { encodeVerificationActionData } from '../../src/adapters/verification/platform/action/contract/action.ts';
import { buildCiVerificationActionPlanClosure, CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT, ciVerificationGateStep, createCiVerificationActionParentDispatchPlan, createCiVerificationActionProposal, createCiVerificationActionProviderEnvelope } from '../../src/adapters/verification/platform/action/contract/ci.ts';
import { CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS } from '../../src/adapters/verification/platform/action/contract/environment.ts';
import { CI_COMPILER_WORKFLOW_RUN_IDENTITY, CI_GITHUB_ACTIONS_IDENTITY_POLICY, verificationActionProviderTerminalArtifactName } from '../../src/adapters/verification/platform/action/contract/provider.ts';
import { CodexDevelopmentCreateVerificationEvidenceProducer, parseVerificationEvidenceProducer } from '../../src/adapters/verification/platform/ci/contract/evidence.ts';
import { createResumedSessionProducer, parseResumedSessionProducer, RESUMED_SESSION_PRODUCER_SCHEMA } from '../../src/adapters/verification/platform/ci/contract/resumed-session-producer.ts';
import { assertAuthenticatedSessionResumeProducerCurrent, type SessionResumeAdmission } from '../../src/adapters/verification/platform/ci/runtime/verification-session-resume-authority.ts';
import { createCiVerificationSessionResumeSignal } from '../../src/adapters/verification/platform/ci/runtime/verification-session-resume-contract.ts';
import { assertVerificationSessionEnvelopeProducer, createVerificationSessionPerJobHostedRequest, parseVerificationSessionHostedEnvelope, VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA, VERIFICATION_SESSION_RESUMED_HOSTED_ENVELOPE_SCHEMA } from '../../src/adapters/verification/platform/ci/runtime/verification-session-runtime.ts';
import { CodexDevelopmentCiVerificationHostedActionCli } from '../../src/adapters/verification/platform/ci/verification-cli.ts';
import { CI_VERIFICATION_ACTION_ARTIFACT_INDEX_SCHEMA, parseHostedEnvelope } from '../../src/adapters/verification/platform/ci/verification-hosted-action-contract.ts';
import { createVerificationSession } from '../../src/adapters/verification/platform/session/contract/session.ts';
import { CI_VERIFICATION_CONTRACT_REVISION } from '../../src/assurance/verification/contract/revision.ts';
import { sha256 } from '../../src/contracts/canonical.ts';

const BASE = 'a'.repeat(40);
const BASE_TREE = 'b'.repeat(40);
const HEAD = 'c'.repeat(40);
const HEAD_TREE = 'd'.repeat(40);
const REPOSITORY = 'sec-platform/sec';
const WORKFLOW = CI_COMPILER_WORKFLOW_RUN_IDENTITY.workflowPath;
const NOW = '2026-10-03T00:00:00.000Z';
const originalParentActor = { login: 'maintainer', id: 101, nodeId: 'U_101', type: 'User', permission: 'maintain' } as const;

/** Data fixtures only: no current job/review authority, API proof or execution
 * success is issued here. Scope and Session use their original data codecs. */
function fixture() {
  const candidate = { repository: REPOSITORY, prNumber: 7, baseSha: BASE, baseTreeSha: BASE_TREE,
    headSha: HEAD, headTreeSha: HEAD_TREE, manifestPath: 'config/repository/work-packages/resume.md',
    manifestDigest: sha256('manifest'), profile: 'quick' as const, environmentDigest: sha256('environment') };
  const scopeInput = { ...candidate, proposalDigest: sha256('scope proposal'), authorizedPaths: ['src/example.ts'],
    issuer: { principalId: originalParentActor.nodeId, role: 'trusted-base-a0' as const,
      trustRevision: BASE, producerIdentity: 'data-fixture' } };
  const scopeAuthorizationRevision = createScopeAuthorizationRevision(scopeInput);
  const environment = CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT;
  const actionPlanClosure = buildCiVerificationActionPlanClosure({ candidate: {
    ...candidate, scopeAuthorizationRevision, toolchainRevision: environment.toolchainRevision,
    providerRevision: environment.executionEnvironmentRevision, contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
    requiredBlobs: CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS.map(file => ({ path: file, digest: sha256(file) }))
  }, gates: [ciVerificationGateStep({ id: 'typecheck', phase: 'quick', args: ['run', 'typecheck'] })] });
  const scopeAuthorization = createScopeAuthorization({ ...scopeInput,
    sessionProposalDigest: sha256('session proposal'), actionPlanClosureDigest: actionPlanClosure.actionPlanDigest,
    issuer: { ...scopeInput.issuer, sourceTransport: 'github-actions', sourceRunId: '11',
      sourceRef: `${WORKFLOW}@${BASE}`, sourceDigest: sha256('human source') },
    issuedAt: NOW, expiresAt: '2026-10-03T00:10:00.000Z' });
  const session = createVerificationSession({ ...candidate, sessionId: 'resume-data-fixture', createdAt: NOW,
    sessionProposalDigest: scopeAuthorization.sessionProposalDigest, scopeAuthorizationRevision,
    scopeAuthorizationReceiptDigest: scopeAuthorization.authorizationDigest,
    actionPlanClosureDigest: actionPlanClosure.actionPlanDigest, trustRevision: BASE,
    reviewPolicyDigest: sha256('review policy'), evidenceRequirementDigest: sha256('evidence policy'),
    integrationPolicyDigest: sha256('integration policy'), mainHealthRef: {
      mainSha: BASE, mainTreeSha: BASE_TREE, healthRevision: sha256('health revision'), ledgerReceiptDigest: sha256('health receipt')
    } });
  const request = createVerificationSessionPerJobHostedRequest({ prNumber: candidate.prNumber,
    expectedBaseSha: BASE, expectedBaseTreeSha: BASE_TREE, expectedHeadSha: HEAD, expectedHeadTreeSha: HEAD_TREE,
    manifestPath: candidate.manifestPath, manifestDigest: candidate.manifestDigest, profile: candidate.profile,
    expectedScopeProposalDigest: scopeAuthorization.proposalDigest, expectedActionPlanDigest: actionPlanClosure.actionPlanDigest,
    expectedSessionRevision: session.sessionRevision, reviewPolicyDigest: session.reviewPolicyDigest });
  const proposal = createCiVerificationActionProposal({ sessionRequest: request,
    proposedActionKey: actionPlanClosure.actions[0]!.action.actionKey });
  const parentPlan = createCiVerificationActionParentDispatchPlan({ repositoryId: '1', repository: REPOSITORY,
    parentRunId: '11', parentRunAttempt: 1, parentJobId: '12', parentWorkflowSha: BASE,
    parentWorkflowRef: `${REPOSITORY}/${WORKFLOW}@refs/heads/main`, parentActor: originalParentActor, proposals: [proposal] });
  const providerEnvelope = createCiVerificationActionProviderEnvelope({ proposal, parentPlan,
    parentDispatchPlanArtifactId: '13', parentDispatchPlanArchiveDigest: sha256('parent archive') });
  const resumeSignal = createCiVerificationSessionResumeSignal({ completedAction: { providerEnvelope,
    runId: '21', runAttempt: 1, terminalArtifactId: '31',
    terminalArtifactName: verificationActionProviderTerminalArtifactName(proposal.proposedActionKey),
    terminalArchiveDigest: sha256('terminal archive'), terminalPayloadDigest: sha256('terminal payload') },
  emitter: { repositoryId: '1', repository: REPOSITORY, workflowPath: '.github/workflows/merge-gate.yml',
    workflowSha: BASE, runId: '41', runAttempt: 1, jobId: '42', checkRunId: '43', policyJobId: 'integrate',
    phase: 'resume-verification-session', stepName: 'Resume canonical verification Session', stepNumber: 6 } });
  const resumedProducer = createResumedSessionProducer({ workflowRef: `${WORKFLOW}@${BASE}`, workflowSha: BASE,
    runId: '51', runAttempt: 2, originalParentActor, resumeSignal });
  const common = { requestOperationId: request.requestOperationId, scopeAuthorization, session, actionPlanClosure,
    preGateReview: { receiptDigest: sha256('review receipt data') },
    mainHealth: { healthRevision: session.mainHealthRef.healthRevision, ledgerDigest: session.mainHealthRef.ledgerReceiptDigest } };
  const legacy = sealEnvelope({ schema: VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA, ...common });
  const resumed = sealEnvelope({ schema: VERIFICATION_SESSION_RESUMED_HOSTED_ENVELOPE_SCHEMA, ...common, resumedProducer });
  const legacyProducer = CodexDevelopmentCreateVerificationEvidenceProducer({ sourceTransport: 'github-actions',
    workflowPath: WORKFLOW, workflowRef: `${WORKFLOW}@${BASE}`, workflowSha: BASE,
    runId: '11', runAttempt: 1, actorNodeId: originalParentActor.nodeId });
  return { legacy, resumed, resumedProducer, legacyProducer, request };
}

function sealEnvelope<T extends Record<string, unknown>>(fields: T) {
  return { ...fields, envelopeDigest: sha256(fields) };
}

function replaceEnvelope(value: Record<string, unknown>, changes: Record<string, unknown>) {
  const { envelopeDigest: _digest, ...fields } = value;
  return sealEnvelope({ ...fields, ...changes });
}

function replaceProducer(value: ReturnType<typeof createResumedSessionProducer>, changes: Record<string, unknown>) {
  const { sourceDigest: _digest, ...fields } = value;
  const changed = { ...fields, ...changes };
  return { ...changed, sourceDigest: sha256(changed) };
}

test('legacy envelope retains its exact canonical data roundtrip and legacy producer semantics', () => {
  const { legacy, legacyProducer } = fixture();
  const bytes = encodeVerificationActionData(legacy);
  const decoded = parseHostedEnvelope(JSON.parse(bytes));
  expect(encodeVerificationActionData(decoded)).toBe(bytes);
  expect(decoded.schema).toBe(VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA);
  expect(decoded.resumedProducer).toBeUndefined();
  expect(() => assertVerificationSessionEnvelopeProducer(decoded, legacyProducer)).not.toThrow();
  expect(parseVerificationEvidenceProducer(legacyProducer)).toEqual(legacyProducer);
});

test('resumed hosted consumer delegates the versioned data codec and retains actual App versus original human', () => {
  const { resumed, resumedProducer } = fixture();
  const bytes = encodeVerificationActionData(resumed);
  const decoded = parseHostedEnvelope(JSON.parse(bytes));
  expect(decoded).toEqual(parseVerificationSessionHostedEnvelope(JSON.parse(bytes)));
  expect(encodeVerificationActionData(decoded)).toBe(bytes);
  expect(decoded.resumedProducer).toEqual(resumedProducer);
  expect(resumedProducer.schema).toBe(RESUMED_SESSION_PRODUCER_SCHEMA);
  expect(resumedProducer.actorNodeId).toBe(CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.nodeId);
  expect(resumedProducer.actorNodeId).not.toBe(decoded.scopeAuthorization.issuer.principalId);
  expect(resumedProducer.originalParentActor.nodeId).toBe(decoded.scopeAuthorization.issuer.principalId);
  expect(() => assertVerificationSessionEnvelopeProducer(decoded, resumedProducer)).not.toThrow();
  expect(parseVerificationEvidenceProducer(resumedProducer)).toEqual(resumedProducer);
});

test('consumer rejects missing resumed producer, version crossing, extensions and checksum drift', () => {
  const { resumed, resumedProducer, legacy } = fixture();
  const { resumedProducer: _producer, envelopeDigest: _digest, ...missing } = resumed;
  for (const value of [sealEnvelope(missing),
    replaceEnvelope(resumed, { schema: VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA }),
    replaceEnvelope(legacy, { resumedProducer }), replaceEnvelope(resumed, { extra: true }),
    replaceEnvelope(resumed, { schema: 'unsupported-envelope-version' }),
    { ...resumed, envelopeDigest: sha256('wrong envelope') }
  ]) expect(() => parseHostedEnvelope(value)).toThrow();
  const decoded = parseHostedEnvelope(resumed);
  expect(() => assertVerificationSessionEnvelopeProducer(parseHostedEnvelope(legacy), resumedProducer)).toThrow('actual producer');
  expect(() => assertVerificationSessionEnvelopeProducer(decoded, fixture().legacyProducer)).toThrow('actual producer');
});

test('resumed producer rejects a relabelled actor, changed original human and wrong source even with fresh digests', () => {
  const { resumed, resumedProducer } = fixture();
  for (const changes of [
    { actorNodeId: originalParentActor.nodeId },
    { originalParentActor: { ...originalParentActor, nodeId: 'U_OTHER' } },
    { workflowSha: HEAD, workflowRef: `${WORKFLOW}@${HEAD}` },
    { workflowPath: '.github/workflows/merge-gate.yml', workflowRef: `.github/workflows/merge-gate.yml@${BASE}` },
    { sourceTransport: 'local-dev-runner' }, { schema: 'unsupported-producer-version' }
  ]) expect(() => parseHostedEnvelope(replaceEnvelope(resumed, {
    resumedProducer: replaceProducer(resumedProducer, changes)
  }))).toThrow();
});

test('exact envelope producer rejects other valid App runs and attempts instead of accepting the same actor', () => {
  const { resumed, resumedProducer } = fixture();
  const decoded = parseHostedEnvelope(resumed);
  for (const changes of [{ runId: '52' }, { runAttempt: 3 }]) {
    const different = parseResumedSessionProducer(replaceProducer(resumedProducer, changes));
    expect(different.actorNodeId).toBe(resumedProducer.actorNodeId);
    expect(() => assertVerificationSessionEnvelopeProducer(decoded, different)).toThrow('actual producer');
  }
  expect(() => parseHostedEnvelope(replaceEnvelope(resumed, { requestOperationId: sha256('other request') }))).toThrow('request operation');
});

test('resumed CLI refuses absent or fabricated private admission before any evidence publication', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-resume-consumer-'));
  try {
    const envelope = path.join(root, 'envelope.json'), index = path.join(root, 'index.json'), output = path.join(root, 'evidence.json');
    writeFileSync(envelope, encodeVerificationActionData(fixture().resumed));
    writeFileSync(index, JSON.stringify({ schema: CI_VERIFICATION_ACTION_ARTIFACT_INDEX_SCHEMA,
      terminalObservations: [], startObservations: [], terminalAnchorObservations: [], providerStatusReadbacks: [] }));
    const argv = ['compose-hosted-evidence', '--envelope', envelope, '--artifact-index', index, '--output', output];
    await expect(CodexDevelopmentCiVerificationHostedActionCli(argv)).rejects.toThrow('live coordinator job origin');
    // The snapshot must carry the supplied handle through to its private owner,
    // which rejects it. This is not a mock granting positive private authority.
    const origin = {} as AuthenticatedGitHubJobOrigin;
    await expect(CodexDevelopmentCiVerificationHostedActionCli(argv, { origin })).rejects.toThrow('resume admission');
    await expect(CodexDevelopmentCiVerificationHostedActionCli(argv, {
      origin, resumeAdmission: {} as SessionResumeAdmission
    })).rejects.toThrow('producer admission was not issued in this live callback');
    expect(existsSync(output)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('provider workflow identity remains the canonical compiler workflow YAML path', () => {
  expect(CI_COMPILER_WORKFLOW_RUN_IDENTITY.workflowPath).toBe('.github/workflows/compiler-pr-validation.yml');
});

test('decoded resumed producer data cannot issue a current private producer admission', () => {
  const { resumedProducer, request } = fixture();
  const data = parseResumedSessionProducer(resumedProducer);
  expect(() => assertAuthenticatedSessionResumeProducerCurrent({} as SessionResumeAdmission, {
    producer: data, request
  })).toThrow();
});
