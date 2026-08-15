import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';

import {
  CodexDevelopmentAssertVerificationSessionArtifactCurrentV2,
  CodexDevelopmentCreateVerificationEvidenceProducerV4,
  CodexDevelopmentFinalizeVerificationEvidenceV4,
  CodexDevelopmentFinalizeVerificationSessionArtifactV2,
  CodexDevelopmentRefreshVerificationSessionArtifactV2
} from '../../platform/shared/ci-evidence-contract.ts';
import { createMainHealthLedgerV1 } from '../../platform/shared/main-health-contract.ts';
import {
  REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT_V1,
  SEC_REVIEW_STABILITY_POLICY_V1,
  createReviewSnapshotDigestV1,
  createReviewStabilityReceiptV1,
  renderIndependentReviewTrailerV1
} from '../../platform/shared/review-stability-contract.ts';
import { createScopeAuthorizationV1 } from '../../platform/shared/scope-authorization-contract.ts';
import {
  buildCiVerificationActionPlanClosureV1,
  type CiVerificationActionCandidateV1
} from '../../platform/shared/verification-action-ci-contract.ts';
import { encodeVerificationActionDataV2 } from '../../platform/shared/verification-action-contract.ts';
import { CodexDevelopmentBuildVerificationGateResultV1 } from '../../platform/shared/verification-result-contract.ts';
import { createVerificationSessionV2 } from '../../platform/shared/verification-session-contract.ts';
import {
  CodexDevelopmentCreateHostedArtifactObservationV2,
  CodexDevelopmentEvaluateMergeGateV2,
  CodexDevelopmentMergeGateInputSchemaV2,
  CodexDevelopmentParseMergeGateResultV2,
  assertCanonicalMergeMessageV1,
  createMergeGateProvenanceV2,
  type CodexDevelopmentMergeGateInputV2
} from '../../scripts/codex/merge-gate.ts';

const BASE = '1'.repeat(40), BASE_TREE = '2'.repeat(40), HEAD = '3'.repeat(40), HEAD_TREE = '4'.repeat(40);
const D = (value: string): `sha256:${string}` => `sha256:${value.repeat(64).slice(0, 64)}`;
const MANIFEST = D('a'), PROPOSAL = D('b'), ENVIRONMENT = D('c'), RULESET = D('d');
const REPOSITORY = 'sec-platform/sec', PR = 42, MANIFEST_PATH = 'docs/work-packages/t2-v1.md';
const VERIFIED_AT = '2026-08-09T00:10:00.000Z', MERGE_AT = '2026-08-09T00:20:00.000Z';

function review(options: {
  stage: 'pre-expensive' | 'pre-merge'; sessionRevision: `sha256:${string}`;
  scopeRevision: `sha256:${string}`; scopeDigest: `sha256:${string}`;
  sourceRef: string; sourceRunId: string; reviewedAt?: string; expiresAt?: string;
}) {
  const snapshotBase = {
    paginationComplete: true as const,
    reviewedHeadSha: HEAD,
    reviewPageDigests: [D(options.stage === 'pre-merge' ? '7' : '6')],
    threadPageDigests: [D('8')], reviewCount: 1, threadCount: 0,
    unresolvedBlockingThreadCount: 0 as const, requestChangesPrincipalIds: [] as readonly []
  };
  const snapshot = { ...snapshotBase, snapshotDigest: createReviewSnapshotDigestV1(snapshotBase) };
  return createReviewStabilityReceiptV1({
    stage: options.stage, repository: REPOSITORY, prNumber: PR,
    sessionRevision: options.sessionRevision,
    scopeAuthorizationRevision: options.scopeRevision,
    scopeAuthorizationReceiptDigest: options.scopeDigest,
    headSha: HEAD, headTreeSha: HEAD_TREE, policy: SEC_REVIEW_STABILITY_POLICY_V1,
    principal: {
      kind: 'github-app',
      actorNodeId: 'BOT_kgDOC98s_g',
      appId: 1144995,
      appNodeId: 'A_kwHOAOQ6Gs4AEXij',
      appSlug: 'chatgpt-codex-connector',
      reviewState: 'COMMENTED'
    },
    independence: { candidateAuthorNodeId: 'USER_author', integrationPrincipalNodeId: 'USER_integrator' },
    producer: {
      identity: 'scripts/codex/verification-session-github.ts',
      executionIdentity: `github-review-observer:${REPOSITORY}:${PR}:${HEAD}`,
      providerIdentity: 'github', candidateWriteCapability: 'read-only',
      capabilityReceiptDigest: REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT_V1,
      trustedRevision: SEC_REVIEW_STABILITY_POLICY_V1.trustedRevision,
      sourceTransport: 'github-graphql', sourceRunId: options.sourceRunId,
      sourceRef: options.sourceRef, sourceDigest: snapshot.snapshotDigest
    },
    snapshot,
    reviewedAt: options.reviewedAt ?? (options.stage === 'pre-merge' ? MERGE_AT : VERIFIED_AT),
    expiresAt: options.expiresAt ?? '2026-08-09T01:00:00.000Z'
  });
}

function fixture(resultStatus: 'passed' | 'failed' = 'passed'): CodexDevelopmentMergeGateInputV2 {
  const scopeSeed = createScopeAuthorizationV1({
    repository: REPOSITORY, prNumber: PR, baseSha: BASE, baseTreeSha: BASE_TREE,
    headSha: HEAD, headTreeSha: HEAD_TREE, manifestPath: MANIFEST_PATH, manifestDigest: MANIFEST,
    proposalDigest: PROPOSAL, authorizedPaths: ['platform/shared/a.ts', 'scripts/a.ts'],
    sessionProposalDigest: PROPOSAL, actionPlanClosureDigest: D('0'), profile: 'quick',
    environmentDigest: ENVIRONMENT,
    issuer: {
      principalId: 'A0', role: 'trusted-base-a0', trustRevision: BASE,
      producerIdentity: 'trusted-scope-runtime', sourceTransport: 'trusted-base', sourceRunId: 'scope-1',
      sourceRef: 'refs/heads/main', sourceDigest: D('1')
    }, issuedAt: '2026-08-09T00:00:00.000Z', expiresAt: '2026-08-09T01:00:00.000Z'
  });
  const actionCandidate: CiVerificationActionCandidateV1 = {
    baseSha: BASE, baseTreeSha: BASE_TREE, headSha: HEAD, headTreeSha: HEAD_TREE,
    manifestPath: MANIFEST_PATH, manifestDigest: MANIFEST,
    scopeAuthorizationRevision: scopeSeed.authorizationRevision,
    profile: 'quick', toolchainRevision: 'bun@1.3.14',
    providerRevision: 'github-actions@trusted-default', contractRevision: 'ci-verification-v19',
    requiredBlobs: [
      { path: '.bun-version', digest: D('a') },
      { path: 'bun.lock', digest: D('b') },
      { path: 'bunfig.toml', digest: D('c') },
      { path: 'package.json', digest: D('d') },
      { path: MANIFEST_PATH, digest: MANIFEST }
    ]
  };
  const expectedActionPlan = buildCiVerificationActionPlanClosureV1({
    candidate: actionCandidate,
    gates: [{ id: 'typecheck', phase: 'quick', argv: ['bun', 'run', 'typecheck'], runtime: 'bun', environment: {}, coveredScopeIds: [] }]
  });
  const scopeAuthorization = createScopeAuthorizationV1({
    ...scopeSeed, actionPlanClosureDigest: expectedActionPlan.actionPlanDigest,
    authorizationRevision: undefined, authorizationDigest: undefined
  } as never);
  const mainHealth = createMainHealthLedgerV1({
    repository: REPOSITORY, defaultBranch: 'main', mainSha: BASE, mainTreeSha: BASE_TREE,
    status: 'healthy', failureFingerprints: [], owner: null, repairWorkPackage: null,
    expiresAt: '2026-08-09T01:00:00.000Z', allowedLanes: ['ordinary'], trustRevision: BASE,
    observedAt: '2026-08-09T00:00:00.000Z',
    producer: {
      identity: 'platform/shared/default-branch-revision-health.ts', trustRevision: BASE,
      sourceTransport: 'github-api', sourceRunId: 'health-1',
      sourceRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`, sourceDigest: D('2')
    }
  });
  const session = createVerificationSessionV2({
    sessionId: 'session-42', createdAt: '2026-08-09T00:01:00.000Z', repository: REPOSITORY,
    prNumber: PR, baseSha: BASE, baseTreeSha: BASE_TREE, headSha: HEAD, headTreeSha: HEAD_TREE,
    manifestPath: MANIFEST_PATH, manifestDigest: MANIFEST, sessionProposalDigest: PROPOSAL,
    scopeAuthorizationRevision: scopeAuthorization.authorizationRevision,
    scopeAuthorizationReceiptDigest: scopeAuthorization.authorizationDigest,
    actionPlanClosureDigest: expectedActionPlan.actionPlanDigest, profile: 'quick', environmentDigest: ENVIRONMENT,
    trustRevision: BASE, reviewPolicyDigest: SEC_REVIEW_STABILITY_POLICY_V1.policyDigest,
    evidenceRequirementDigest: D('3'), integrationPolicyDigest: D('4'),
    mainHealthRef: { mainSha: BASE, mainTreeSha: BASE_TREE, healthRevision: mainHealth.healthRevision, ledgerReceiptDigest: mainHealth.ledgerDigest }
  });
  const workflowRef = `.github/workflows/compiler-pr-validation.yml@${BASE}`;
  const producer = CodexDevelopmentCreateVerificationEvidenceProducerV4({
    sourceTransport: 'github-actions', workflowPath: '.github/workflows/compiler-pr-validation.yml',
    workflowRef, workflowSha: BASE, runId: 'verify-100', runAttempt: 1, actorNodeId: 'USER_integrator'
  });
  const preGateReview = review({
    stage: 'pre-expensive', sessionRevision: session.sessionRevision,
    scopeRevision: scopeAuthorization.authorizationRevision, scopeDigest: scopeAuthorization.authorizationDigest,
    sourceRef: `github://${REPOSITORY}/pull/${PR}@${HEAD}`, sourceRunId: D('6')
  });
  const action = expectedActionPlan.actions[0]!.action;
  const gate = {
    action,
    result: CodexDevelopmentBuildVerificationGateResultV1({
      gateId: 'typecheck', gateRevision: action.operation.revision, owner: 'ci-verification-maintainer',
      requirementKey: 'gate:typecheck', subjectRevision: HEAD, inputDigest: action.actionKey,
      applicability: 'required', status: resultStatus, disposition: 'executed',
      reasonCode: resultStatus === 'passed' ? 'executed-success' : 'executed-failure',
      requiredForClaims: ['gate:typecheck'], supportedClaims: ['gate:typecheck'],
      environment: { runtime: 'bun@1.3.14', os: 'linux', arch: 'x64', filesystem: null, capabilities: [], toolchainRevision: 'bun@1.3.14', providerRevisions: ['github-actions@trusted-default'] },
      execution: { argv: ['bun', 'run', 'typecheck'], startedAt: VERIFIED_AT, finishedAt: '2026-08-09T00:11:00.000Z', durationMs: 60_000,
        exitCode: resultStatus === 'passed' ? 0 : 1, outputDigest: D('5'), failureFingerprint: resultStatus === 'failed' ? D('9') : null },
      evidenceRefs: [], invalidationRules: ['ActionKey changes'], diagnostic: resultStatus === 'failed' ? 'known failure' : null
    }), cleanup: { status: 'not-required' as const, evidenceRefs: [], diagnostic: null }
  };
  const evidence = CodexDevelopmentFinalizeVerificationEvidenceV4({
    contractRevision: 'ci-verification-v19', sessionRevision: session.sessionRevision,
    sessionProposalDigest: PROPOSAL, scopeAuthorizationRevision: scopeAuthorization.authorizationRevision,
    scopeAuthorizationDigest: scopeAuthorization.authorizationDigest, reviewReceiptDigest: preGateReview.receiptDigest,
    mainHealthRevision: mainHealth.healthRevision, mainHealthDigest: mainHealth.ledgerDigest, trustRevision: BASE,
    profile: 'quick', baseSha: BASE, baseTreeSha: BASE_TREE, headSha: HEAD, headTreeSha: HEAD_TREE,
    manifestPath: MANIFEST_PATH, manifestDigest: MANIFEST, producer, actionPlan: expectedActionPlan,
    status: resultStatus, startedAt: VERIFIED_AT, finishedAt: '2026-08-09T00:11:00.000Z', gates: [gate],
    evidenceRefs: [], invalidationRules: ['session/action/review/main/trust changes']
  });
  const artifact = CodexDevelopmentFinalizeVerificationSessionArtifactV2({
    scopeAuthorization, session, preGateReview, mainHealth, evidence, producer
  });
  const artifactBytes = `${encodeVerificationActionDataV2(artifact)}\n`;
  const artifactByteDigest = `sha256:${createHash('sha256').update(artifactBytes).digest('hex')}` as const;
  const hostedObservation = (artifactId: string, runId: string, runAttempt: number) =>
    CodexDevelopmentCreateHostedArtifactObservationV2({
      artifactId,
      artifactName: `sec-verification-session-v2-pr-${PR}-session-${session.sessionRevision.slice('sha256:'.length)}-run-${runId}-attempt-${runAttempt}`,
      artifactFileName: 'verification-session-artifact.json',
      artifactByteDigest,
      artifactByteLength: Buffer.byteLength(artifactBytes, 'utf8'),
      artifactExpired: false,
      workflowPath: '.github/workflows/compiler-pr-validation.yml',
      workflowRef,
      workflowSha: BASE,
      runId,
      runAttempt,
      eventName: 'repository_dispatch',
      actorNodeId: 'USER_integrator',
      actorPermission: 'maintain',
      downloadTransport: 'github-actions-artifact-api'
    });
  const hostedArtifactOrigin = hostedObservation('1000', producer.runId, producer.runAttempt);
  const hostedArtifactTransport = hostedObservation('1001', 'verify-101', 1);
  const provenance = createMergeGateProvenanceV2({
    workflowPath: '.github/workflows/sec-merge-gate.yml',
    workflowRef: `.github/workflows/sec-merge-gate.yml@${BASE}`, workflowSha: BASE,
    eventName: 'workflow_run', sourceRunId: 'merge-200', sourceRunAttempt: 1,
    actorNodeId: 'USER_integrator', actorPermission: 'maintain'
  });
  const mergeMainHealth = createMainHealthLedgerV1({
    repository: REPOSITORY, defaultBranch: 'main', mainSha: BASE, mainTreeSha: BASE_TREE,
    status: 'healthy', failureFingerprints: [], owner: null, repairWorkPackage: null,
    expiresAt: '2026-08-09T01:00:00.000Z', allowedLanes: ['ordinary'], trustRevision: BASE,
    observedAt: '2026-08-09T00:15:00.000Z',
    producer: {
      identity: 'platform/shared/default-branch-revision-health.ts', trustRevision: BASE,
      sourceTransport: 'github-api', sourceRunId: provenance.sourceRunId,
      sourceRef: provenance.workflowRef, sourceDigest: D('2')
    }
  });
  const preMergeReview = review({
    stage: 'pre-merge', sessionRevision: session.sessionRevision,
    scopeRevision: scopeAuthorization.authorizationRevision, scopeDigest: scopeAuthorization.authorizationDigest,
    sourceRef: `github://${REPOSITORY}/pull/${PR}@${HEAD}`, sourceRunId: D('7')
  });
  return {
    schema: CodexDevelopmentMergeGateInputSchemaV2, provenance,
    candidate: { repository: REPOSITORY, prNumber: PR, draft: false, headOpenPullRequestCount: 1,
      currentBaseSha: BASE, currentBaseTreeSha: BASE_TREE, headSha: HEAD, headTreeSha: HEAD_TREE,
      baseIsAncestor: true, behindBy: 0, manifestPath: MANIFEST_PATH, manifestDigest: MANIFEST,
      changedPaths: ['platform/shared/a.ts', 'scripts/a.ts'] },
    artifact, hostedArtifactOrigin, hostedArtifactTransport, expectedActionPlan, reviewReceipt: preMergeReview,
    reviewSnapshotDigest: preMergeReview.snapshot.snapshotDigest, mainHealth: mergeMainHealth, environmentDigest: ENVIRONMENT,
    trustRevision: BASE,
    platformObservation: { status: 'available', rulesetDigest: RULESET, reason: null },
    consumptionOperationId: D('e'),
    issuedAt: MERGE_AT, expiresAt: '2026-08-09T00:30:00.000Z'
  };
}

function refreshArtifact(base: CodexDevelopmentMergeGateInputV2) {
  const refreshedAt = '2026-08-09T02:00:00.000Z';
  const expiresAt = '2026-08-09T03:00:00.000Z';
  const scopeAuthorization = createScopeAuthorizationV1({
    ...base.artifact.scopeAuthorization,
    issuer: {
      ...base.artifact.scopeAuthorization.issuer,
      sourceRunId: 'scope-refresh-2',
      sourceDigest: D('f')
    },
    issuedAt: refreshedAt,
    expiresAt,
    authorizationRevision: undefined,
    authorizationDigest: undefined
  } as never);
  const mainHealth = createMainHealthLedgerV1({
    ...base.artifact.mainHealth,
    observedAt: refreshedAt,
    expiresAt,
    producer: {
      ...base.artifact.mainHealth.producer,
      sourceRunId: 'health-refresh-2',
      sourceDigest: D('e')
    },
    healthRevision: undefined,
    ledgerDigest: undefined
  } as never);
  const session = createVerificationSessionV2({
    ...base.artifact.session,
    sessionId: 'session-42-refresh-2',
    createdAt: refreshedAt,
    scopeAuthorizationReceiptDigest: scopeAuthorization.authorizationDigest,
    mainHealthRef: {
      ...base.artifact.session.mainHealthRef,
      ledgerReceiptDigest: mainHealth.ledgerDigest
    },
    sessionRevision: undefined
  } as never);
  const preGateReview = review({
    stage: 'pre-expensive',
    sessionRevision: session.sessionRevision,
    scopeRevision: scopeAuthorization.authorizationRevision,
    scopeDigest: scopeAuthorization.authorizationDigest,
    sourceRef: `github://${REPOSITORY}/pull/${PR}@${HEAD}`,
    sourceRunId: D('d'),
    reviewedAt: refreshedAt,
    expiresAt
  });
  const producer = CodexDevelopmentCreateVerificationEvidenceProducerV4({
    sourceTransport: 'github-actions',
    workflowPath: '.github/workflows/compiler-pr-validation.yml',
    workflowRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`,
    workflowSha: BASE,
    runId: 'verify-124',
    runAttempt: 1,
    actorNodeId: 'USER_integrator'
  });
  return CodexDevelopmentRefreshVerificationSessionArtifactV2({
    previousArtifact: base.artifact,
    scopeAuthorization,
    session,
    preGateReview,
    mainHealth,
    producer,
    refreshedAt
  });
}

test('trusted current-base gate authorizes a multi-commit candidate without executing merge', () => {
  const result = CodexDevelopmentEvaluateMergeGateV2(fixture());
  expect(result.status).toBe('authorized');
  expect(result.terminalStatusContext).toBe('sec/merge-gate');
  expect(result.authorization.headSha).toBe(HEAD);
  expect(result.authorization.scopeAuthorizationRevision).toBe(fixture().artifact.scopeAuthorization.authorizationRevision);
  expect(result.authorization.issuer).toMatchObject({
    producerIdentity: 'scripts/codex/merge-gate.ts',
    trustedRevision: BASE,
    sourceRef: `.github/workflows/sec-merge-gate.yml@${BASE}`,
    sourceRunId: 'merge-200:1'
  });
  expect(result.reviewReceipt.receiptDigest).toBe(result.authorization.reviewReceiptDigest);
  expect(result.mainHealth.ledgerDigest).toBe(result.authorization.mainHealthReceiptDigest);
  expect(result.platformObservation.rulesetDigest).toBe(result.authorization.rulesetDigest);
  expect(result.hostedArtifactOrigin.artifactId).toBe('1000');
  expect(result.hostedArtifactTransport.artifactId).toBe('1001');
  expect(result.hostedArtifactOrigin.artifactByteDigest).toBe(result.hostedArtifactTransport.artifactByteDigest);
  expect(CodexDevelopmentParseMergeGateResultV2(JSON.stringify(result))).toEqual(result);
});

test('fresh MainHealth receipt may change provenance while stable health semantics remain exact', () => {
  const base = fixture();
  const fresh = createMainHealthLedgerV1({
    repository: REPOSITORY, defaultBranch: 'main', mainSha: BASE, mainTreeSha: BASE_TREE,
    status: 'healthy', failureFingerprints: [], owner: null, repairWorkPackage: null,
    expiresAt: '2026-08-09T01:10:00.000Z', allowedLanes: ['ordinary'], trustRevision: BASE,
    observedAt: '2026-08-09T00:15:00.000Z',
    producer: {
      identity: 'platform/shared/default-branch-revision-health.ts', trustRevision: BASE, sourceTransport: 'github-api',
      sourceRunId: 'health-merge-fresh', sourceRef: base.provenance.workflowRef, sourceDigest: D('f')
    }
  });
  expect(fresh.healthRevision).toBe(base.artifact.session.mainHealthRef.healthRevision);
  expect(fresh.ledgerDigest).not.toBe(base.artifact.session.mainHealthRef.ledgerReceiptDigest);
  const result = CodexDevelopmentEvaluateMergeGateV2({ ...base, mainHealth: fresh });
  expect(result.mainHealth.ledgerDigest).toBe(fresh.ledgerDigest);
  expect(result.authorization.mainHealthReceiptDigest).toBe(fresh.ledgerDigest);
});

test('expired authority receipts re-finalize fresh V4 Evidence while reusing exact Action Results', () => {
  const base = fixture();
  expect(() => CodexDevelopmentAssertVerificationSessionArtifactCurrentV2(
    base.artifact,
    '2026-08-09T00:30:00.000Z'
  )).not.toThrow();
  expect(() => CodexDevelopmentAssertVerificationSessionArtifactCurrentV2(
    base.artifact,
    '2026-08-09T02:00:00.000Z'
  )).toThrow('expired');

  const refreshed = refreshArtifact(base);
  expect(refreshed.session.sessionRevision).toBe(base.artifact.session.sessionRevision);
  expect(refreshed.scopeAuthorization.authorizationRevision).toBe(base.artifact.scopeAuthorization.authorizationRevision);
  expect(refreshed.evidence.actionPlan).toEqual(base.artifact.evidence.actionPlan);
  expect(refreshed.evidence.gates).toEqual(base.artifact.evidence.gates);
  expect(refreshed.evidence.scopeAuthorizationDigest).not.toBe(base.artifact.evidence.scopeAuthorizationDigest);
  expect(refreshed.evidence.evidenceRefs).toContain(`verification-session-artifact:${base.artifact.artifactDigest}`);
  expect(refreshed.artifactDigest).not.toBe(base.artifact.artifactDigest);
  expect(() => CodexDevelopmentAssertVerificationSessionArtifactCurrentV2(
    refreshed,
    '2026-08-09T02:00:00.000Z'
  )).not.toThrow();

  const refreshedFailure = refreshArtifact(fixture('failed'));
  expect(refreshedFailure.evidence.status).toBe('failed');
  expect(refreshedFailure.evidence.gates[0]!.result.status).toBe('failed');
  expect(() => CodexDevelopmentRefreshVerificationSessionArtifactV2({
    previousArtifact: base.artifact,
    scopeAuthorization: base.artifact.scopeAuthorization,
    session: base.artifact.session,
    preGateReview: base.artifact.preGateReview,
    mainHealth: base.artifact.mainHealth,
    producer: refreshed.producer,
    refreshedAt: '2026-08-09T00:30:00.000Z'
  })).toThrow('newly observed authority receipt');
});

test('candidate workflow, forged artifact provenance, review drift, and incomplete ancestry fail closed', () => {
  const base = fixture();
  const cases: CodexDevelopmentMergeGateInputV2[] = [
    { ...base, provenance: { ...base.provenance, workflowSha: HEAD } },
    { ...base, artifact: { ...base.artifact, producer: { ...base.artifact.producer, runId: 'forged' } } },
    { ...base, hostedArtifactOrigin: { ...base.hostedArtifactOrigin, artifactByteDigest: D('f') } },
    { ...base, hostedArtifactTransport: { ...base.hostedArtifactTransport, workflowSha: HEAD } },
    { ...base, hostedArtifactTransport: { ...base.hostedArtifactTransport, runId: base.hostedArtifactOrigin.runId,
      runAttempt: base.hostedArtifactOrigin.runAttempt } },
    { ...base, reviewSnapshotDigest: D('f') },
    { ...base, candidate: { ...base.candidate, baseIsAncestor: false as never } },
    { ...base, consumptionOperationId: 'merge:42' as never }
  ];
  for (const value of cases) expect(() => CodexDevelopmentEvaluateMergeGateV2(value)).toThrow();
});

test('V4 Action closure mismatch and non-PASS terminal facts cannot authorize integration', () => {
  const base = fixture();
  const driftedPlan = buildCiVerificationActionPlanClosureV1({
    candidate: {
      baseSha: BASE, baseTreeSha: BASE_TREE, headSha: HEAD, headTreeSha: HEAD_TREE,
      manifestPath: MANIFEST_PATH, manifestDigest: MANIFEST,
      scopeAuthorizationRevision: base.artifact.scopeAuthorization.authorizationRevision,
      profile: 'quick', toolchainRevision: 'bun@9.9.9',
      providerRevision: 'github-actions@trusted-default', contractRevision: 'ci-verification-v19',
      requiredBlobs: [
        { path: '.bun-version', digest: D('a') },
        { path: 'bun.lock', digest: D('b') },
        { path: 'bunfig.toml', digest: D('c') },
        { path: 'package.json', digest: D('d') }
      ]
    },
    gates: [{ id: 'typecheck', phase: 'quick', argv: ['bun', 'run', 'typecheck'], runtime: 'bun', environment: {}, coveredScopeIds: [] }]
  });
  expect(() => CodexDevelopmentEvaluateMergeGateV2({ ...base, expectedActionPlan: driftedPlan })).toThrow();
  expect(() => CodexDevelopmentEvaluateMergeGateV2({
    ...base,
    artifact: { ...base.artifact, evidence: { ...base.artifact.evidence, status: 'failed' } }
  })).toThrow();
});

test('legacy scope-attestation, raw merge, and admin merge authority are absent', async () => {
  const source = await Bun.file(new URL('../../scripts/codex/merge-gate.ts', import.meta.url)).text();
  expect(source).not.toContain('sec-scope-attest-v1');
  expect(source).not.toContain('--admin');
  expect(source).not.toContain('gh pr merge');
  expect(source).toContain("command !== 'authorize'");
});

test('merge message trailers must derive from validated receipts; PR #345 free text is rejected', () => {
  const markers = [
    'Integration-Authorization: auth-1',
    'Integration-Authorization-Receipt: sha256:' + 'a'.repeat(64),
    'Integration-Authorization-Operation: sha256:' + 'c'.repeat(64),
    'Integration-Authorization-Publication: sha256:' + 'd'.repeat(64),
    'Integration-Authorization-Publication-Digest: sha256:' + 'e'.repeat(64),
    'Integration-Authorization-Comment: 123',
    'Verification-Session: sha256:' + 'b'.repeat(64)
  ];
  const title = 'Verified integration deadbeef';
  const reviewReceipt = fixture().reviewReceipt;
  const canonicalReview = renderIndependentReviewTrailerV1(reviewReceipt);
  expect(() => assertCanonicalMergeMessageV1({
    authorizationMarkers: markers, reviewReceipt, expectedTitle: title,
    message: `${title}\n\n${markers.join('\n')}\n${canonicalReview}`
  })).not.toThrow();
  expect(() => assertCanonicalMergeMessageV1({
    authorizationMarkers: markers, reviewReceipt, expectedTitle: title,
    message: `${title}\n\n${markers.join('\n')}\nIndependent-Exact-Head-Review: P0=0 P1=0 P2=0`
  })).toThrow('exact typed title and trailer');
  expect(() => assertCanonicalMergeMessageV1({
    authorizationMarkers: markers, reviewReceipt, expectedTitle: title,
    message: `${title}\n\n${markers.join('\n')}\nManual-Transition-Receipt: sha256:` + 'c'.repeat(64)
  })).toThrow('exact typed title and trailer');
  expect(() => assertCanonicalMergeMessageV1({
    authorizationMarkers: markers, reviewReceipt, expectedTitle: title,
    message: `${title}\n\n${markers.join('\n')}\n${canonicalReview}\nCo-authored-by: Someone <someone@example.com>`
  })).toThrow('exact typed title and trailer');
  expect(() => assertCanonicalMergeMessageV1({
    authorizationMarkers: [...markers, canonicalReview], reviewReceipt, expectedTitle: title,
    message: `${title}\n\n${markers.join('\n')}\n${canonicalReview}`
  })).toThrow('exactly once');
  expect(() => assertCanonicalMergeMessageV1({
    authorizationMarkers: markers, reviewReceipt, expectedTitle: title,
    message: `${title}\n\n${markers.slice(0, -1).join('\n')}\n${canonicalReview}`
  })).toThrow('exact typed title and trailer');
});

test('hosted integration workflow delegates one globally serialized live-readback transaction', async () => {
  type Step = Readonly<{
    name: string;
    id?: string;
    if?: string;
    uses?: string;
    run?: string;
    with?: Readonly<Record<string, unknown>>;
  }>;
  type Job = Readonly<{
    needs?: string;
    if?: string;
    permissions?: Readonly<Record<string, string>>;
    concurrency?: Readonly<Record<string, unknown>>;
    steps: readonly Step[];
  }>;
  type Workflow = Readonly<{
    on: Readonly<Record<string, unknown>>;
    permissions: Readonly<Record<string, string>>;
    jobs: Readonly<Record<string, Job>>;
  }>;

  const source = await Bun.file(new URL('../../.github/workflows/sec-merge-gate.yml', import.meta.url)).text();
  const workflow = parseYaml(source) as Workflow;
  const plan = workflow.jobs.plan!;
  const integrate = workflow.jobs.integrate!;

  expect(workflow.on.workflow_run).toEqual({ workflows: ['compiler-pr-validation'], types: ['completed'] });
  expect(workflow.permissions).toEqual({ actions: 'read', contents: 'read' });
  expect(plan.steps).toHaveLength(1);
  expect(plan.steps[0]?.uses).toBe('actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b');
  const planScript = String(plan.steps[0]?.with?.script ?? '');
  const externalTerminalTitle = /^verify session PR #([1-9][0-9]*) session (sha256:[0-9a-f]{64})$/u;
  expect(planScript).not.toContain('createCommitStatus');
  expect(planScript).not.toContain("run.name !== 'compiler-pr-validation'");
  expect(planScript).toContain(externalTerminalTitle.source);
  const workflowLookupIndex = planScript.indexOf('github.rest.actions.getWorkflow');
  const workflowPathGuardIndex = planScript.indexOf(
    "sourceWorkflow.data.path !== '.github/workflows/compiler-pr-validation.yml'"
  );
  expect(workflowLookupIndex).toBeGreaterThan(-1);
  expect(workflowPathGuardIndex).toBeGreaterThan(workflowLookupIndex);
  expect(planScript).toContain('listWorkflowRunArtifacts');
  const expectedArtifactNameIndex = planScript.indexOf('const expectedArtifactName =');
  const exactArtifactFilterIndex = planScript.indexOf(
    'artifacts.filter((artifact) => artifact.name === expectedArtifactName)'
  );
  const exactArtifactUniquenessIndex = planScript.indexOf('sessionArtifacts.length !== 1');
  expect(expectedArtifactNameIndex).toBeGreaterThan(-1);
  expect(exactArtifactFilterIndex).toBeGreaterThan(expectedArtifactNameIndex);
  expect(exactArtifactUniquenessIndex).toBeGreaterThan(exactArtifactFilterIndex);
  expect(planScript).toContain('sessionArtifacts.length !== 1');
  expect(planScript).toContain('sessionArtifact.workflow_run?.id !== run.id');
  expect(planScript).toContain('sec-verification-session-v2-pr-${terminalTitle[1]}-session-${terminalTitle[2].slice(7)}-run-${run.id}-attempt-${run.run_attempt}');
  expect(planScript).not.toContain("artifact.name.startsWith('sec-verification-session-v2-pr-')");
  expect(externalTerminalTitle.test(`verify session PR #42 session sha256:${'a'.repeat(64)}`)).toBe(true);
  expect(externalTerminalTitle.test(`produce Action sha256:${'b'.repeat(64)}`)).toBe(false);

  expect(integrate.needs).toBe('plan');
  expect(integrate.permissions).toEqual({
    actions: 'read',
    checks: 'read',
    contents: 'write',
    'pull-requests': 'write',
    issues: 'write',
    statuses: 'write'
  });
  expect(integrate.concurrency).toEqual({
    group: 'sec-integration-${{ github.repository_id }}-${{ github.event.repository.default_branch }}',
    'cancel-in-progress': false,
    queue: 'max'
  });
  expect(integrate.steps.map(({ name }) => name)).toEqual([
    'Checkout trusted current default base',
    'Setup trusted Bun',
    'Cache trusted integration Bun install',
    'Install trusted integration dependencies from frozen lock',
    'Create exact integration durable directory',
    'Resolve exact hosted integration lane',
    'Validate exact hosted integration lane projection',
    'Reject blocked hosted integration lane',
    'Upload exact branch closeout recovery artifact',
    'Read back exact branch closeout recovery artifact',
    'Close out exact integrated branch',
    'Publish exact branch closeout receipt',
    'Retain exact integration and closeout publication projections'
  ]);
  expect(integrate.steps.filter(({ run }) => run !== undefined)).toHaveLength(7);

  const checkout = integrate.steps[0]!;
  expect(checkout.uses).toBe('actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd');
  expect(checkout.with).toMatchObject({
    ref: '${{ needs.plan.outputs.base-sha }}',
    'persist-credentials': false
  });
  expect(checkout.with?.path).toBeUndefined();

  const durableDirectory = integrate.steps[4]?.run ?? '';
  expect(durableDirectory).toContain('mkdir -p -- "${SEC_INTEGRATION_DURABLE_DIRECTORY}"');
  expect(durableDirectory).toContain('test ! -L "${SEC_INTEGRATION_DURABLE_DIRECTORY}"');
  const route = integrate.steps[5]?.run ?? '';
  expect(route).toContain('verification-session.ts prepare-integration-hosted');
  expect(route).toContain('--output "${SEC_INTEGRATION_DURABLE_DIRECTORY}/integration-projection.json"');
  expect(integrate.steps[6]?.run).toContain('sec-verification-session-hosted-integration-route-v1');
  const blockedLane = "${{ steps.prepare-integration.outputs.integration-lane == 'blocked' }}";
  const openLane = "${{ steps.prepare-integration.outputs.integration-lane == 'open-first-effect' }}";
  const effectLane = "${{ steps.prepare-integration.outputs.integration-lane == 'open-first-effect' || steps.prepare-integration.outputs.integration-lane == 'merged-recovery' }}";
  expect(integrate.steps[7]).toMatchObject({
    name: 'Reject blocked hosted integration lane',
    if: blockedLane
  });
  expect(integrate.steps[8]?.if).toBe(openLane);
  expect(integrate.steps[8]?.with).toMatchObject({
    path: '.tmp/codex/branch-closeout-recovery.json',
    'include-hidden-files': true
  });
  expect(integrate.steps[9]?.if).toBe(openLane);

  const command = integrate.steps[10]?.run ?? '';
  expect(command).toContain('bun scripts/codex/verification-session.ts integrate-hosted');
  expect(command).toContain('--repository "${{ github.repository }}"');
  expect(command).toContain('--output "${SEC_INTEGRATION_DURABLE_DIRECTORY}/integration-projection.json"');
  expect(integrate.steps[10]?.if).toBe(effectLane);
  expect(source.match(/verification-session\.ts integrate-hosted/gu)).toHaveLength(1);
  for (const forbidden of [
    'prepare-merge-gate', 'merge-gate.ts authorize', '--input', '--artifact', '--authorization',
    '--claim', '--store', '--request', '--session', 'gh pr merge', 'actions/download-artifact'
  ]) expect(source).not.toContain(forbidden);
  expect(source).not.toContain('path: .tmp/codex/candidate');
  expect(source).not.toContain('createCommitStatus');

  const sessionSource = readFileSync(path.resolve(import.meta.dir,
    '../../scripts/codex/verification-session.ts'), 'utf8');
  expect(sessionSource).toContain('async function joinExactPostMergeMainHealthV1');
  expect(sessionSource).toContain('createCiMainHealthRequestOperationIdV1(input.mainSha)');
  expect(sessionSource).not.toContain("encodeVerificationActionDataV2({\n    schema: 'sec-produce-main-health-request-v1'");
  expect(sessionSource).toContain("'sec-produce-main-health-v1'");
  expect(sessionSource).toContain('Canonical MainHealth workflow is not active.');
  expect(sessionSource).toContain('MainHealth dispatch resolved to multiple exact workflow runs.');
  expect(sessionSource).toContain('Exact MainHealth run has no unique successful canonical sec/main-health check.');
  expect(sessionSource).toContain('function assertBoundPostMergeMainV1');
  expect(sessionSource).toContain('First-effect merge commit ancestry or tree readback drifted.');
  expect(sessionSource).toContain('Recovered PR merge commit is not an ancestor of the planned live main.');
  expect(sessionSource.indexOf('assertBoundPostMergeMainV1'))
    .toBeLessThan(sessionSource.indexOf('await joinExactPostMergeMainHealthV1'));
  const integrateSource = sessionSource.slice(sessionSource.indexOf("if (command === 'integrate-hosted')"),
    sessionSource.indexOf("if (command === 'closeout-mutate-hosted')"));
  expect(integrateSource.indexOf('await joinExactPostMergeMainHealthV1'))
    .toBeLessThan(integrateSource.indexOf('consumeSameHostWorktreeCloseoutV1'));
  expect(integrate.steps[11]).toMatchObject({
    name: 'Publish exact branch closeout receipt',
    id: 'closeout-publish-hosted',
    if: effectLane
  });

  const closeoutProjection = integrate.steps[12]!;
  expect(closeoutProjection.uses)
    .toBe('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');
  expect(closeoutProjection.with).toMatchObject({
    name: 'sec-closeout-projections-v1-run-${{ github.run_id }}-attempt-${{ github.run_attempt }}',
    'include-hidden-files': true
  });
  expect(String(closeoutProjection.with?.path))
    .toContain('.tmp/codex/integration-projection.json');
  expect(String(closeoutProjection.with?.path))
    .toContain('.tmp/codex/closeout-publication-projection.json');
  expect(closeoutProjection.if)
    .toBe("always() && !cancelled() && hashFiles('.tmp/codex/integration-projection.json') != ''");
  expect(source).not.toContain('closeout-mutation-projection.json');
  expect(source).not.toContain('Upload diagnostic integration projection');
});

test('exact-head workflow review findings preserve recovery base and install merge TS dependencies', async () => {
  type Step = Readonly<{
    name: string;
    uses?: string;
    run?: string;
    env?: Readonly<Record<string, string>>;
    with?: Readonly<Record<string, unknown>>;
  }>;
  type Workflow = Readonly<{
    jobs: Readonly<Record<string, Readonly<{
      outputs?: Readonly<Record<string, string>>;
      steps: readonly Step[];
    }>>>;
  }>;
  const workflow = parseYaml(await Bun.file(
    new URL('../../.github/workflows/sec-merge-gate.yml', import.meta.url)
  ).text()) as Workflow;
  const plan = workflow.jobs.plan!;
  const integrate = workflow.jobs.integrate!;
  const planScript = String(plan.steps[0]?.with?.script ?? '');

  expect(plan.outputs).toMatchObject({
    'base-sha': '${{ steps.source.outputs.base-sha }}',
    'current-main-sha': '${{ steps.source.outputs.current-main-sha }}'
  });
  expect(planScript).toContain('const sessionBaseSha = run.head_sha');
  expect(planScript).toContain('process.env.WORKFLOW_SHA !== sessionBaseSha');
  expect(planScript).toContain('basehead: `${sessionBaseSha}...${currentBase}`');
  expect(planScript).toContain("core.setOutput('base-sha', sessionBaseSha)");
  expect(planScript).toContain("core.setOutput('current-main-sha', currentBase)");

  const checkoutIndex = integrate.steps.findIndex(
    ({ name }) => name === 'Checkout trusted current default base'
  );
  const setupIndex = integrate.steps.findIndex(({ name }) => name === 'Setup trusted Bun');
  const cacheIndex = integrate.steps.findIndex(
    ({ name }) => name === 'Cache trusted integration Bun install'
  );
  const installIndex = integrate.steps.findIndex(
    ({ name }) => name === 'Install trusted integration dependencies from frozen lock'
  );
  const durableDirectoryIndex = integrate.steps.findIndex(
    ({ name }) => name === 'Create exact integration durable directory'
  );
  const firstEntrypointIndex = integrate.steps.findIndex(
    ({ run }) => run?.includes('bun scripts/') === true
  );
  const orderedIndices = [checkoutIndex, setupIndex, cacheIndex, installIndex,
    durableDirectoryIndex, firstEntrypointIndex];
  expect(orderedIndices.every((index) => index >= 0)).toBe(true);
  expect(integrate.steps[checkoutIndex]?.with).toMatchObject({
    ref: '${{ needs.plan.outputs.base-sha }}'
  });
  expect(orderedIndices).toEqual([...orderedIndices].sort((left, right) => left - right));
  expect(integrate.steps[cacheIndex]?.uses)
    .toBe('actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830');
  expect(integrate.steps[installIndex]?.run).toBe('bun install --frozen-lockfile');

  const integrateCloseout = integrate.steps.find(
    ({ name }) => name === 'Close out exact integrated branch'
  )!;
  expect(integrateCloseout.env).toMatchObject({
    PRE_MERGE_MAIN_SHA: '${{ needs.plan.outputs.base-sha }}',
    PLANNED_CURRENT_MAIN_SHA: '${{ needs.plan.outputs.current-main-sha }}',
    MAIN_HEALTH_RUNNER_QUEUE_ALLOWANCE_MINUTES: 10,
    MAIN_HEALTH_PRODUCER_TIMEOUT_MINUTES: 30,
    MAIN_HEALTH_JOIN_POLL_INTERVAL_SECONDS: 10
  });
  const sessionSource = await Bun.file(new URL('../../scripts/codex/verification-session.ts', import.meta.url)).text();
  expect(sessionSource).toContain('async function joinExactPostMergeMainHealthV1');
  expect(sessionSource).toContain('Canonical MainHealth workflow is not active.');
  expect(sessionSource).toContain('MainHealth dispatch resolved to multiple exact workflow runs.');
  expect(sessionSource).toContain('Exact MainHealth run has no unique successful canonical sec/main-health check.');
  expect(sessionSource).not.toContain('MAIN_HEALTH_PRECEDING_PRODUCER_TIMEOUT_MINUTES');
  expect(sessionSource).toContain('queueAllowance * 60 * 1000');
  expect(sessionSource).toContain('producerTimeout * 60 * 1000');
  expect(sessionSource).toContain('pollSeconds * 1000');
});
