import { createHash } from 'node:crypto';

import { expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';


import {
  CreateHostedArtifactObservation,
  EvaluateMergeGate,
  MergeGateInputSchema,
  MergeGateProducerIdentity,
  CodexDevelopmentMergeGateTerminalStatusContext,
  ParseMergeGateResult,
  assertCanonicalMergeMessage,
  createMergeGateProvenance,
  type MergeGateInput
} from '../../src/adapters/self-hosting/control/integration/merge-gate.ts';
import { createMainHealthLedger } from '../../src/adapters/self-hosting/control/main-health/contract.ts';
import { createScopeAuthorization } from '../../src/adapters/self-hosting/control/scope/authorization.ts';
import { encodeVerificationActionData } from '../../src/adapters/verification/platform/action/contract/action.ts';
import { buildCiVerificationActionPlanClosure, type CiVerificationActionCandidate } from '../../src/adapters/verification/platform/action/contract/ci.ts';
import { assertVerificationSessionArtifactCurrent, createVerificationEvidenceProducer, finalizeVerificationEvidence, finalizeVerificationSessionArtifact, refreshVerificationSessionArtifact } from '../../src/adapters/verification/platform/ci/contract/evidence.ts';
import { REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT, SEC_REVIEW_STABILITY_POLICY, createReviewSnapshotDigest, createReviewStabilityReceipt, renderIndependentReviewTrailer } from '../../src/adapters/verification/platform/review/contract/stability.ts';
import { createVerificationSession } from '../../src/adapters/verification/platform/session/contract/session.ts';
import { BuildVerificationGateResult } from '../../src/assurance/verification/result/contract/result.ts';

const BASE = '1'.repeat(40);
const BASE_TREE = '2'.repeat(40);
const HEAD = '3'.repeat(40);
const HEAD_TREE = '4'.repeat(40);
const D = (value: string): `sha256:${string}` => `sha256:${value.repeat(64).slice(0, 64)}`;
const MANIFEST = D('a');
const PROPOSAL = D('b');
const ENVIRONMENT = D('c');
const RULESET = D('d');
const REPOSITORY = 'sec-platform/sec';
const PR = 42;
const MANIFEST_PATH = 'config/repository/work-packages/t2-v1.md';
const VERIFIED_AT = '2026-08-09T00:10:00.000Z';
const MERGE_AT = '2026-08-09T00:20:00.000Z';

function review(options: {
  stage: 'pre-expensive' | 'pre-merge';
  sessionRevision: `sha256:${string}`;
  scopeRevision: `sha256:${string}`;
  scopeDigest: `sha256:${string}`;
  sourceRef: string;
  sourceRunId: string;
  reviewedAt?: string;
  expiresAt?: string;
}) {
  const snapshotBase = {
    paginationComplete: true as const,
    reviewedHeadSha: HEAD,
    reviewPageDigests: [D(options.stage === 'pre-merge' ? '7' : '6')],
    threadPageDigests: [D('8')],
    reviewCount: 1,
    threadCount: 0,
    unresolvedBlockingThreadCount: 0 as const,
    requestChangesPrincipalIds: [] as readonly []
  };
  const snapshot = { ...snapshotBase, snapshotDigest: createReviewSnapshotDigest(snapshotBase) };
  return createReviewStabilityReceipt({
    stage: options.stage,
    repository: REPOSITORY,
    prNumber: PR,
    sessionRevision: options.sessionRevision,
    scopeAuthorizationRevision: options.scopeRevision,
    scopeAuthorizationReceiptDigest: options.scopeDigest,
    headSha: HEAD,
    headTreeSha: HEAD_TREE,
    policy: SEC_REVIEW_STABILITY_POLICY,
    principal: {
      kind: 'github-app',
      actorNodeId: 'BOT_kgDOC98s_g',
      appId: 1144995,
      appNodeId: 'A_kwHOAOQ6Gs4AEXij',
      appSlug: 'chatgpt-codex-connector',
      reviewState: 'COMMENTED'
    },
    independence: {
      candidateAuthorNodeId: 'USER_author',
      integrationPrincipalNodeId: 'USER_integrator'
    },
    producer: {
      identity: 'src/adapters/verification/platform/ci/runtime/verification-session-github.ts',
      executionIdentity: `github-review-observer:${REPOSITORY}:${PR}:${HEAD}`,
      providerIdentity: 'github',
      candidateWriteCapability: 'read-only',
      capabilityReceiptDigest: REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT,
      trustedRevision: SEC_REVIEW_STABILITY_POLICY.trustedRevision,
      sourceTransport: 'github-graphql',
      sourceRunId: options.sourceRunId,
      sourceRef: options.sourceRef,
      sourceDigest: snapshot.snapshotDigest
    },
    snapshot,
    reviewedAt: options.reviewedAt ?? (options.stage === 'pre-merge' ? MERGE_AT : VERIFIED_AT),
    expiresAt: options.expiresAt ?? '2026-08-09T01:00:00.000Z'
  });
}

function fixture(resultStatus: 'passed' | 'failed' = 'passed'): MergeGateInput {
  const scopeSeed = createScopeAuthorization({
    repository: REPOSITORY,
    prNumber: PR,
    baseSha: BASE,
    baseTreeSha: BASE_TREE,
    headSha: HEAD,
    headTreeSha: HEAD_TREE,
    manifestPath: MANIFEST_PATH,
    manifestDigest: MANIFEST,
    proposalDigest: PROPOSAL,
    authorizedPaths: ['platform/shared/a.ts', 'scripts/a.ts'],
    sessionProposalDigest: PROPOSAL,
    actionPlanClosureDigest: D('0'),
    profile: 'quick',
    environmentDigest: ENVIRONMENT,
    issuer: {
      principalId: 'A0',
      role: 'trusted-base-a0',
      trustRevision: BASE,
      producerIdentity: 'trusted-scope-runtime',
      sourceTransport: 'trusted-base',
      sourceRunId: 'scope-1',
      sourceRef: 'refs/heads/main',
      sourceDigest: D('1')
    },
    issuedAt: '2026-08-09T00:00:00.000Z',
    expiresAt: '2026-08-09T01:00:00.000Z'
  });
  const actionCandidate: CiVerificationActionCandidate = {
    baseSha: BASE,
    baseTreeSha: BASE_TREE,
    headSha: HEAD,
    headTreeSha: HEAD_TREE,
    manifestPath: MANIFEST_PATH,
    manifestDigest: MANIFEST,
    scopeAuthorizationRevision: scopeSeed.authorizationRevision,
    profile: 'quick',
    toolchainRevision: 'bun@1.3.14',
    providerRevision: 'github-actions@trusted-default',
    contractRevision: 'ci-verification-v19',
    requiredBlobs: [
      { path: '.bun-version', digest: D('a') },
      { path: 'bun.lock', digest: D('b') },
      { path: 'bunfig.toml', digest: D('c') },
      { path: 'package.json', digest: D('d') },
      { path: MANIFEST_PATH, digest: MANIFEST }
    ]
  };
  const expectedActionPlan = buildCiVerificationActionPlanClosure({
    candidate: actionCandidate,
    gates: [{
      id: 'typecheck',
      phase: 'quick',
      argv: ['bun', 'run', 'typecheck'],
      runtime: 'bun',
      environment: {},
      coveredScopeIds: []
    }]
  });
  const scopeAuthorization = createScopeAuthorization({
    ...scopeSeed,
    actionPlanClosureDigest: expectedActionPlan.actionPlanDigest,
    authorizationRevision: undefined,
    authorizationDigest: undefined
  } as never);
  const mainHealth = createMainHealthLedger({
    repository: REPOSITORY,
    defaultBranch: 'main',
    mainSha: BASE,
    mainTreeSha: BASE_TREE,
    status: 'healthy',
    failureFingerprints: [],
    owner: null,
    repairWorkPackage: null,
    expiresAt: '2026-08-09T01:00:00.000Z',
    allowedLanes: ['ordinary'],
    trustRevision: BASE,
    observedAt: '2026-08-09T00:00:00.000Z',
    producer: {
      identity: 'src/adapters/self-hosting/control/main-health/main-health-observation.ts',
      trustRevision: BASE,
      sourceTransport: 'github-api',
      sourceRunId: 'health-1',
      sourceRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`,
      sourceDigest: D('2')
    }
  });
  const session = createVerificationSession({
    sessionId: 'session-42',
    createdAt: '2026-08-09T00:01:00.000Z',
    repository: REPOSITORY,
    prNumber: PR,
    baseSha: BASE,
    baseTreeSha: BASE_TREE,
    headSha: HEAD,
    headTreeSha: HEAD_TREE,
    manifestPath: MANIFEST_PATH,
    manifestDigest: MANIFEST,
    sessionProposalDigest: PROPOSAL,
    scopeAuthorizationRevision: scopeAuthorization.authorizationRevision,
    scopeAuthorizationReceiptDigest: scopeAuthorization.authorizationDigest,
    actionPlanClosureDigest: expectedActionPlan.actionPlanDigest,
    profile: 'quick',
    environmentDigest: ENVIRONMENT,
    trustRevision: BASE,
    reviewPolicyDigest: SEC_REVIEW_STABILITY_POLICY.policyDigest,
    evidenceRequirementDigest: D('3'),
    integrationPolicyDigest: D('4'),
    mainHealthRef: {
      mainSha: BASE,
      mainTreeSha: BASE_TREE,
      healthRevision: mainHealth.healthRevision,
      ledgerReceiptDigest: mainHealth.ledgerDigest
    }
  });
  const workflowRef = `.github/workflows/compiler-pr-validation.yml@${BASE}`;
  const producer = createVerificationEvidenceProducer({
    sourceTransport: 'github-actions',
    workflowPath: '.github/workflows/compiler-pr-validation.yml',
    workflowRef,
    workflowSha: BASE,
    runId: 'verify-100',
    runAttempt: 1,
    actorNodeId: 'USER_integrator'
  });
  const preGateReview = review({
    stage: 'pre-expensive',
    sessionRevision: session.sessionRevision,
    scopeRevision: scopeAuthorization.authorizationRevision,
    scopeDigest: scopeAuthorization.authorizationDigest,
    sourceRef: `github://${REPOSITORY}/pull/${PR}@${HEAD}`,
    sourceRunId: D('6')
  });
  const action = expectedActionPlan.actions[0]!.action;
  const gate = {
    action,
    result: BuildVerificationGateResult({
      gateId: 'typecheck',
      gateRevision: action.operation.revision,
      owner: 'ci-verification-maintainer',
      requirementKey: 'gate:typecheck',
      subjectRevision: HEAD,
      inputDigest: action.actionKey,
      applicability: 'required',
      status: resultStatus,
      disposition: 'executed',
      reasonCode: resultStatus === 'passed' ? 'executed-success' : 'executed-failure',
      requiredForClaims: ['gate:typecheck'],
      supportedClaims: ['gate:typecheck'],
      environment: {
        runtime: 'bun@1.3.14',
        os: 'linux',
        arch: 'x64',
        filesystem: null,
        capabilities: [],
        toolchainRevision: 'bun@1.3.14',
        providerRevisions: ['github-actions@trusted-default']
      },
      execution: {
        argv: ['bun', 'run', 'typecheck'],
        startedAt: VERIFIED_AT,
        finishedAt: '2026-08-09T00:11:00.000Z',
        durationMs: 60_000,
        exitCode: resultStatus === 'passed' ? 0 : 1,
        outputDigest: D('5'),
        failureFingerprint: resultStatus === 'failed' ? D('9') : null
      },
      evidenceRefs: [],
      invalidationRules: ['ActionKey changes'],
      diagnostic: resultStatus === 'failed' ? 'known failure' : null
    }),
    cleanup: { status: 'not-required' as const, evidenceRefs: [], diagnostic: null }
  };
  const evidence = finalizeVerificationEvidence({
    contractRevision: 'ci-verification-v19',
    sessionRevision: session.sessionRevision,
    sessionProposalDigest: PROPOSAL,
    scopeAuthorizationRevision: scopeAuthorization.authorizationRevision,
    scopeAuthorizationDigest: scopeAuthorization.authorizationDigest,
    reviewReceiptDigest: preGateReview.receiptDigest,
    mainHealthRevision: mainHealth.healthRevision,
    mainHealthDigest: mainHealth.ledgerDigest,
    trustRevision: BASE,
    profile: 'quick',
    baseSha: BASE,
    baseTreeSha: BASE_TREE,
    headSha: HEAD,
    headTreeSha: HEAD_TREE,
    manifestPath: MANIFEST_PATH,
    manifestDigest: MANIFEST,
    producer,
    actionPlan: expectedActionPlan,
    status: resultStatus,
    startedAt: VERIFIED_AT,
    finishedAt: '2026-08-09T00:11:00.000Z',
    gates: [gate],
    evidenceRefs: [],
    invalidationRules: ['session/action/review/main/trust changes']
  });
  const artifact = finalizeVerificationSessionArtifact({
    scopeAuthorization,
    session,
    preGateReview,
    mainHealth,
    evidence,
    producer
  });
  const artifactBytes = `${encodeVerificationActionData(artifact)}\n`;
  const artifactByteDigest = `sha256:${createHash('sha256').update(artifactBytes).digest('hex')}` as const;
  const hostedObservation = (artifactId: string, runId: string, runAttempt: number) =>
    CreateHostedArtifactObservation({
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
  const provenance = createMergeGateProvenance({
    workflowPath: '.github/workflows/sec-merge-gate.yml',
    workflowRef: `.github/workflows/sec-merge-gate.yml@${BASE}`,
    workflowSha: BASE,
    eventName: 'workflow_run',
    sourceRunId: 'merge-200',
    sourceRunAttempt: 1,
    actorNodeId: 'USER_integrator',
    actorPermission: 'maintain'
  });
  const mergeMainHealth = createMainHealthLedger({
    repository: REPOSITORY,
    defaultBranch: 'main',
    mainSha: BASE,
    mainTreeSha: BASE_TREE,
    status: 'healthy',
    failureFingerprints: [],
    owner: null,
    repairWorkPackage: null,
    expiresAt: '2026-08-09T01:00:00.000Z',
    allowedLanes: ['ordinary'],
    trustRevision: BASE,
    observedAt: '2026-08-09T00:15:00.000Z',
    producer: {
      identity: 'src/adapters/self-hosting/control/main-health/main-health-observation.ts',
      trustRevision: BASE,
      sourceTransport: 'github-api',
      sourceRunId: provenance.sourceRunId,
      sourceRef: `github-check-runs:${REPOSITORY}@${BASE}`,
      sourceDigest: D('2')
    }
  });
  const preMergeReview = review({
    stage: 'pre-merge',
    sessionRevision: session.sessionRevision,
    scopeRevision: scopeAuthorization.authorizationRevision,
    scopeDigest: scopeAuthorization.authorizationDigest,
    sourceRef: `github://${REPOSITORY}/pull/${PR}@${HEAD}`,
    sourceRunId: D('7')
  });
  return {
    schema: MergeGateInputSchema,
    provenance,
    candidate: {
      repository: REPOSITORY,
      prNumber: PR,
      draft: false,
      headOpenPullRequestCount: 1,
      currentBaseSha: BASE,
      currentBaseTreeSha: BASE_TREE,
      headSha: HEAD,
      headTreeSha: HEAD_TREE,
      baseIsAncestor: true,
      behindBy: 0,
      manifestPath: MANIFEST_PATH,
      manifestDigest: MANIFEST,
      changedPaths: ['platform/shared/a.ts', 'scripts/a.ts']
    },
    artifact,
    hostedArtifactOrigin,
    hostedArtifactTransport,
    expectedActionPlan,
    reviewReceipt: preMergeReview,
    reviewSnapshotDigest: preMergeReview.snapshot.snapshotDigest,
    mainHealth: mergeMainHealth,
    environmentDigest: ENVIRONMENT,
    trustRevision: BASE,
    platformObservation: { status: 'available', rulesetDigest: RULESET, reason: null },
    consumptionOperationId: D('e'),
    issuedAt: MERGE_AT,
    expiresAt: '2026-08-09T00:30:00.000Z'
  };
}

function refreshArtifact(base: MergeGateInput) {
  const refreshedAt = '2026-08-09T02:00:00.000Z';
  const expiresAt = '2026-08-09T03:00:00.000Z';
  const scopeAuthorization = createScopeAuthorization({
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
  const mainHealth = createMainHealthLedger({
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
  const session = createVerificationSession({
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
  const producer = createVerificationEvidenceProducer({
    sourceTransport: 'github-actions',
    workflowPath: '.github/workflows/compiler-pr-validation.yml',
    workflowRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`,
    workflowSha: BASE,
    runId: 'verify-124',
    runAttempt: 1,
    actorNodeId: 'USER_integrator'
  });
  return refreshVerificationSessionArtifact({
    previousArtifact: base.artifact,
    scopeAuthorization,
    session,
    preGateReview,
    mainHealth,
    producer,
    refreshedAt
  });
}

test('trusted current-base gate authorizes exact candidate facts without executing merge', () => {
  const result = EvaluateMergeGate(fixture());
  expect(result.status).toBe('authorized');
  expect(result.terminalStatusContext).toBe(CodexDevelopmentMergeGateTerminalStatusContext);
  expect(result.terminalStatusContext).toBe('sec/integration-authorization');
  expect(result.authorization.headSha).toBe(HEAD);
  expect(result.authorization.scopeAuthorizationRevision)
    .toBe(fixture().artifact.scopeAuthorization.authorizationRevision);
  expect(result.authorization.issuer).toMatchObject({
    producerIdentity: MergeGateProducerIdentity,
    trustedRevision: BASE,
    sourceRef: `.github/workflows/sec-merge-gate.yml@${BASE}`,
    sourceRunId: 'merge-200:1'
  });
  expect(result.reviewReceipt.receiptDigest).toBe(result.authorization.reviewReceiptDigest);
  expect(result.mainHealth.ledgerDigest).toBe(result.authorization.mainHealthReceiptDigest);
  expect(result.platformObservation.rulesetDigest).toBe(result.authorization.rulesetDigest);
  expect(result.hostedArtifactOrigin.artifactId).toBe('1000');
  expect(result.hostedArtifactTransport.artifactId).toBe('1001');
  expect(result.hostedArtifactOrigin.artifactByteDigest)
    .toBe(result.hostedArtifactTransport.artifactByteDigest);
  expect(ParseMergeGateResult(JSON.stringify(result))).toEqual(result);
});

test('explicit maintainer-rooted policy preserves unavailable enforcement without claiming no-bypass', () => {
  const base = fixture();
  const result = EvaluateMergeGate({
    ...base,
    platformObservation: {
      status: 'platform-enforcement-unavailable',
      rulesetDigest: RULESET,
      reason: 'ruleset readback unavailable'
    }
  });
  expect(result.platformObservation).toEqual({
    status: 'platform-enforcement-unavailable',
    rulesetDigest: RULESET,
    reason: 'ruleset readback unavailable'
  });
  expect(result.authorization.rulesetDigest).toBe(RULESET);
  expect(() => EvaluateMergeGate({
    ...base,
    platformObservation: {
      status: 'available',
      rulesetDigest: RULESET,
      reason: 'degraded observation'
    }
  })).toThrow('must not carry a degraded reason');
  expect(() => EvaluateMergeGate({
    ...base,
    platformObservation: {
      status: 'platform-enforcement-unavailable',
      rulesetDigest: RULESET,
      reason: null
    }
  })).toThrow('reason must be bounded canonical text');
});

test('fresh MainHealth receipt may change provenance while stable health semantics remain exact', () => {
  const base = fixture();
  const fresh = createMainHealthLedger({
    repository: REPOSITORY,
    defaultBranch: 'main',
    mainSha: BASE,
    mainTreeSha: BASE_TREE,
    status: 'healthy',
    failureFingerprints: [],
    owner: null,
    repairWorkPackage: null,
    expiresAt: '2026-08-09T01:10:00.000Z',
    allowedLanes: ['ordinary'],
    trustRevision: BASE,
    observedAt: '2026-08-09T00:15:00.000Z',
    producer: {
      identity: 'src/adapters/self-hosting/control/main-health/main-health-observation.ts',
      trustRevision: BASE,
      sourceTransport: 'github-api',
      sourceRunId: 'health-merge-fresh',
      sourceRef: `github-check-runs:${REPOSITORY}@${BASE}`,
      sourceDigest: D('f')
    }
  });
  expect(fresh.healthRevision).toBe(base.artifact.session.mainHealthRef.healthRevision);
  expect(fresh.ledgerDigest).not.toBe(base.artifact.session.mainHealthRef.ledgerReceiptDigest);
  const result = EvaluateMergeGate({ ...base, mainHealth: fresh });
  expect(result.mainHealth.ledgerDigest).toBe(fresh.ledgerDigest);
  expect(result.authorization.mainHealthReceiptDigest).toBe(fresh.ledgerDigest);
});

test('fresh MainHealth provenance rejects workflow references, wrong revisions and foreign producers', () => {
  const base = fixture();
  const invalidProducers = [
    { ...base.mainHealth.producer, sourceRef: base.provenance.workflowRef },
    { ...base.mainHealth.producer, sourceRef: `github-check-runs:${REPOSITORY}@${HEAD}` },
    { ...base.mainHealth.producer, sourceRef: `github-check-runs:other/repository@${BASE}` },
    { ...base.mainHealth.producer, identity: 'caller-supplied-health-observer' }
  ];
  for (const producer of invalidProducers) {
    const mainHealth = createMainHealthLedger({ ...base.mainHealth, producer });
    // Recompute a valid content digest: provenance, not incidental tampering,
    // must be what prevents an otherwise matching receipt from authorizing.
    expect(mainHealth.healthRevision).toBe(base.mainHealth.healthRevision);
    expect(() => EvaluateMergeGate({ ...base, mainHealth }))
      .toThrow('fresh MainHealth producer provenance is not bound to the trusted authorization runtime');
  }
});

test('expired authority receipts re-finalize fresh Evidence while reusing exact Action Results', () => {
  const base = fixture();
  expect(() => assertVerificationSessionArtifactCurrent(
    base.artifact,
    '2026-08-09T00:30:00.000Z'
  )).not.toThrow();
  expect(() => assertVerificationSessionArtifactCurrent(
    base.artifact,
    '2026-08-09T02:00:00.000Z'
  )).toThrow('expired');

  const refreshed = refreshArtifact(base);
  expect(refreshed.session.sessionRevision).toBe(base.artifact.session.sessionRevision);
  expect(refreshed.scopeAuthorization.authorizationRevision)
    .toBe(base.artifact.scopeAuthorization.authorizationRevision);
  expect(refreshed.evidence.actionPlan).toEqual(base.artifact.evidence.actionPlan);
  expect(refreshed.evidence.gates).toEqual(base.artifact.evidence.gates);
  expect(refreshed.evidence.scopeAuthorizationDigest)
    .not.toBe(base.artifact.evidence.scopeAuthorizationDigest);
  expect(refreshed.evidence.evidenceRefs)
    .toContain(`verification-session-artifact:${base.artifact.artifactDigest}`);
  expect(refreshed.artifactDigest).not.toBe(base.artifact.artifactDigest);
  expect(() => assertVerificationSessionArtifactCurrent(
    refreshed,
    '2026-08-09T02:00:00.000Z'
  )).not.toThrow();

  const refreshedFailure = refreshArtifact(fixture('failed'));
  expect(refreshedFailure.evidence.status).toBe('failed');
  expect(refreshedFailure.evidence.gates[0]!.result.status).toBe('failed');
  expect(() => refreshVerificationSessionArtifact({
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
  const cases: MergeGateInput[] = [
    { ...base, provenance: { ...base.provenance, workflowSha: HEAD } },
    { ...base, artifact: { ...base.artifact, producer: { ...base.artifact.producer, runId: 'forged' } } },
    { ...base, hostedArtifactOrigin: { ...base.hostedArtifactOrigin, artifactByteDigest: D('f') } },
    { ...base, hostedArtifactTransport: { ...base.hostedArtifactTransport, workflowSha: HEAD } },
    {
      ...base,
      hostedArtifactTransport: {
        ...base.hostedArtifactTransport,
        runId: base.hostedArtifactOrigin.runId,
        runAttempt: base.hostedArtifactOrigin.runAttempt
      }
    },
    { ...base, reviewSnapshotDigest: D('f') },
    { ...base, candidate: { ...base.candidate, baseIsAncestor: false as never } },
    { ...base, consumptionOperationId: 'merge:42' as never }
  ];
  for (const value of cases) expect(() => EvaluateMergeGate(value)).toThrow();
});

test('Action closure mismatch and non-PASS terminal facts cannot authorize integration', () => {
  const base = fixture();
  const driftedPlan = buildCiVerificationActionPlanClosure({
    candidate: {
      baseSha: BASE,
      baseTreeSha: BASE_TREE,
      headSha: HEAD,
      headTreeSha: HEAD_TREE,
      manifestPath: MANIFEST_PATH,
      manifestDigest: MANIFEST,
      scopeAuthorizationRevision: base.artifact.scopeAuthorization.authorizationRevision,
      profile: 'quick',
      toolchainRevision: 'bun@9.9.9',
      providerRevision: 'github-actions@trusted-default',
      contractRevision: 'ci-verification-v19',
      requiredBlobs: [
        { path: '.bun-version', digest: D('a') },
        { path: 'bun.lock', digest: D('b') },
        { path: 'bunfig.toml', digest: D('c') },
        { path: 'package.json', digest: D('d') }
      ]
    },
    gates: [{
      id: 'typecheck',
      phase: 'quick',
      argv: ['bun', 'run', 'typecheck'],
      runtime: 'bun',
      environment: {},
      coveredScopeIds: []
    }]
  });
  expect(() => EvaluateMergeGate({ ...base, expectedActionPlan: driftedPlan }))
    .toThrow();
  expect(() => EvaluateMergeGate({
    ...base,
    artifact: { ...base.artifact, evidence: { ...base.artifact.evidence, status: 'failed' } }
  })).toThrow();
});

test('merge message trailers must derive from validated receipts; free text is rejected', () => {
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
  const canonicalReview = renderIndependentReviewTrailer(reviewReceipt);
  expect(() => assertCanonicalMergeMessage({
    authorizationMarkers: markers,
    reviewReceipt,
    expectedTitle: title,
    message: `${title}\n\n${markers.join('\n')}\n${canonicalReview}`
  })).not.toThrow();
  for (const message of [
    `${title}\n\n${markers.join('\n')}\nIndependent-Exact-Head-Review: P0=0 P1=0 P2=0`,
    `${title}\n\n${markers.join('\n')}\nManual-Transition-Receipt: sha256:${'c'.repeat(64)}`,
    `${title}\n\n${markers.join('\n')}\n${canonicalReview}\nCo-authored-by: Someone <someone@example.com>`,
    `${title}\n\n${markers.slice(0, -1).join('\n')}\n${canonicalReview}`
  ]) {
    expect(() => assertCanonicalMergeMessage({
      authorizationMarkers: markers,
      reviewReceipt,
      expectedTitle: title,
      message
    })).toThrow('exact typed title and trailer');
  }
  expect(() => assertCanonicalMergeMessage({
    authorizationMarkers: [...markers, canonicalReview],
    reviewReceipt,
    expectedTitle: title,
    message: `${title}\n\n${markers.join('\n')}\n${canonicalReview}`
  })).toThrow('exactly once');

  const statusMarkers = [
    'Verification-Session: sha256:' + '1'.repeat(64),
    'Integration-Authorization: auth-2',
    'Integration-Authorization-Receipt: sha256:' + '2'.repeat(64),
    'Integration-Authorization-Operation: sha256:' + '3'.repeat(64),
    'Integration-Authorization-Status-Publication: sha256:' + '4'.repeat(64),
    'Integration-Authorization-Status-Id: 456',
    'Merge-Gate-Result: sha256:' + '5'.repeat(64),
    'Platform-Observation: sha256:' + '6'.repeat(64),
    'Platform-Enforcement: platform-enforcement-unavailable',
    'Platform-No-Bypass-Claim: false',
    'Issue-Disposition-Plan: sha256:' + '7'.repeat(64),
    'Issue-Disposition-Mode: progress-only',
    'Issue-Disposition-Tracking: issue-311',
    'Issue-Disposition-Prose: sha256:' + '8'.repeat(64)
  ];
  expect(() => assertCanonicalMergeMessage({
    authorizationMarkers: statusMarkers,
    reviewReceipt,
    expectedTitle: title,
    message: `${title}\n${statusMarkers.join('\n')}\n${canonicalReview}`
  })).not.toThrow();
  expect(() => assertCanonicalMergeMessage({
    authorizationMarkers: statusMarkers.map((line) => line === 'Platform-No-Bypass-Claim: false'
      ? 'Platform-No-Bypass-Claim: true' : line),
    reviewReceipt,
    expectedTitle: title,
    message: `${title}\n${statusMarkers.join('\n')}\n${canonicalReview}`
  })).toThrow('platform claim markers are invalid');
});

type WorkflowStep = Readonly<{
  name: string;
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Readonly<Record<string, unknown>>;
  with?: Readonly<Record<string, unknown>>;
}>;
type WorkflowJob = Readonly<{
  needs?: string | readonly string[];
  if?: string;
  permissions?: Readonly<Record<string, string>>;
  outputs?: Readonly<Record<string, string>>;
  steps: readonly WorkflowStep[];
}>;
type MergeWorkflow = Readonly<{
  on: Readonly<Record<string, unknown>>;
  permissions: Readonly<Record<string, string>>;
  concurrency?: Readonly<Record<string, unknown>>;
  jobs: Readonly<Record<string, WorkflowJob>>;
}>;

async function readMergeWorkflow(): Promise<MergeWorkflow> {
  const source = await Bun.file(
    new URL('../../.github/workflows/sec-merge-gate.yml', import.meta.url)
  ).text();
  return parseYaml(source) as MergeWorkflow;
}

async function readCompilerWorkflow(): Promise<MergeWorkflow> {
  const source = await Bun.file(
    new URL('../../.github/workflows/compiler-pr-validation.yml', import.meta.url)
  ).text();
  return parseYaml(source) as MergeWorkflow;
}

function githubScript(step: WorkflowStep | undefined): string {
  const script = step?.with?.script;
  if (typeof script !== 'string') throw new Error('Expected one github-script body.');
  return script;
}

async function executeMergePlan(options: Readonly<{
    sourceStatus?: string;
    sourceConclusion?: string | null;
    sourceRunAttempt?: number;
    sourceDisplayTitle?: string;
    artifactDigest?: `sha256:${string}`;
    artifactRunId?: number;
  }> = {}) {
  const workflow = await readMergeWorkflow();
  const script = githubScript(workflow.jobs.plan?.steps[0]);
  const sessionRevision = D('9');
  const artifactName =
    `sec-verification-session-v2-pr-${PR}-session-${sessionRevision.slice(7)}-run-100-attempt-2`;
  const outputs = new Map<string, string>();
  const github = {
    rest: {
      actions: {
        getWorkflowRun: async () => ({ data: {
          id: 100, run_attempt: 2, workflow_id: 307443415, event: 'repository_dispatch',
          status: options.sourceStatus ?? 'completed',
          conclusion: options.sourceConclusion === undefined ? 'success' : options.sourceConclusion,
          head_sha: BASE,
          display_title: options.sourceDisplayTitle
            ?? `verify session PR #${PR} session ${sessionRevision}`,
          actor: { login: 'integrator', node_id: 'USER_integrator' },
          triggering_actor: { login: 'integrator', node_id: 'USER_integrator' }
        } }),
        getWorkflow: async () => ({ data: { path: '.github/workflows/compiler-pr-validation.yml' } }),
        listWorkflowRunArtifacts: async () => ({ data: { artifacts: [] } })
      },
      repos: {
        get: async () => ({ data: { id: 123, full_name: 'sec-platform/sec', default_branch: 'main' } }),
        getCollaboratorPermissionLevel: async () => ({ data: { permission: 'maintain' } }),
        getBranch: async () => ({ data: { commit: { sha: BASE } } }),
        compareCommitsWithBasehead: async () => ({ data: {
          status: 'identical', base_commit: { sha: BASE }, merge_base_commit: { sha: BASE }, behind_by: 0
        } })
      },
      pulls: {
        get: async () => ({ data: {
          state: 'open', draft: false,
          base: { sha: BASE, repo: { id: 123 } },
          head: { sha: HEAD, repo: { id: 123 } }
        } })
      },
      users: {
        getByUsername: async () => ({ data: { login: 'integrator', node_id: 'USER_integrator' } })
      }
    },
    paginate: async () => [{
      id: 9018395538,
      name: artifactName,
      digest: options.artifactDigest ?? D('8'),
      expired: false,
      size_in_bytes: 100,
      workflow_run: { id: options.artifactRunId ?? 100 }
    }]
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => (...values: unknown[]) => Promise<void>;
  await new AsyncFunction('github', 'context', 'core', 'process', script)(
    github,
    { repo: { owner: 'sec-platform', repo: 'sec' },
      payload: {
        action: 'completed',
        repository: { id: 123, full_name: 'sec-platform/sec' },
        workflow_run: { id: 100, run_attempt: options.sourceRunAttempt ?? 2 }
      } },
    { setOutput: (name: string, value: string) => outputs.set(name, value), notice: () => undefined },
    { env: { WORKFLOW_RUN_JSON: JSON.stringify({ id: 100,
      run_attempt: options.sourceRunAttempt ?? 2 }), WORKFLOW_SHA: BASE } }
  );
  return outputs;
}

test('merge plan derives terminal identity from completed source-run API readback', async () => {
  const outputs = await executeMergePlan();
  expect(Object.fromEntries(outputs)).toEqual({
    ready: 'true',
    'base-sha': BASE,
    'current-main-sha': BASE,
    'head-sha': HEAD,
    'pr-number': String(PR),
    'session-revision': D('9').slice(7)
  });
  await expect(executeMergePlan({ artifactRunId: 101 }))
    .rejects.toThrow('exactly one live provenance-bound terminal Session artifact');
});

test('merge wakeup is event-driven and rejects stale or nonterminal provider observations', async () => {
  const workflow = await readMergeWorkflow();
  const script = githubScript(workflow.jobs.plan?.steps[0]);
  expect(script).not.toContain('setTimeout');
  expect(script).not.toContain('for (let attempt');
  await expect(executeMergePlan({ sourceStatus: 'in_progress', sourceConclusion: null }))
    .rejects.toThrow('wakeup disagrees with source run API settlement');
  const staleCompletion = await executeMergePlan({ sourceRunAttempt: 1 });
  expect(Object.fromEntries(staleCompletion)).toEqual({ ready: 'false' });
  const unrelatedCompletion = await executeMergePlan({
    sourceDisplayTitle: 'produce one hosted verification action'
  });
  expect(Object.fromEntries(unrelatedCompletion)).toEqual({ ready: 'false' });
});

test('compiler exposes one terminal artifact and relies on native completion wakeup', async () => {
  const workflow = await readCompilerWorkflow();
  const coordinator = workflow.jobs['coordinate-verification-session']!;
  const names = coordinator.steps.map(({ name }) => name);
  const upload = names.indexOf('Upload sole terminal Verification Session artifact');
  const terminal = names.indexOf('Preserve exact terminal five-state Session result');
  expect(upload).toBeGreaterThan(-1);
  expect(terminal).toBeGreaterThan(upload);
  const dispatchSites = Object.values(workflow.jobs).flatMap((job) => job.steps)
    .filter((candidate) => typeof candidate.with?.script === 'string' &&
      candidate.with.script.includes('createDispatchEvent'));
  expect(dispatchSites).toHaveLength(0);
});

test('hosted integration splits read-only authorization, terminal status, and merge effects', async () => {
  const workflow = await readMergeWorkflow();
  const plan = workflow.jobs.plan!;
  const authorize = workflow.jobs.authorize!;
  const terminal = workflow.jobs['terminal-status']!;
  const integrate = workflow.jobs.integrate!;

  expect(workflow.on.repository_dispatch).toBeUndefined();
  expect(workflow.on.workflow_run).toEqual({
    workflows: ['compiler-pr-validation'], types: ['completed']
  });
  expect(workflow.permissions).toEqual({ actions: 'read', contents: 'read' });
  expect(workflow.concurrency).toEqual({
    group: 'sec-integration-${{ github.repository_id }}-${{ github.event.repository.default_branch }}',
    'cancel-in-progress': false,
    queue: 'max'
  });

  expect(plan.steps).toHaveLength(1);
  expect(plan.if).toBeUndefined();
  expect(plan.steps[0]?.uses)
    .toBe('actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3');

  expect(authorize.needs).toBe('plan');
  expect(authorize.if).toBe("${{ needs.plan.outputs.ready == 'true' }}");
  expect(authorize.permissions).toEqual({
    actions: 'read',
    checks: 'read',
    contents: 'read',
    issues: 'read',
    'pull-requests': 'read',
    statuses: 'read'
  });
  expect(authorize.steps.map(({ name }) => name)).toContain('Prepare exact integration recovery artifact');
  expect(authorize.steps.map(({ name }) => name)).toContain('Prove exact main authority rulesets before terminal authorization');
  expect(authorize.steps.map(({ name }) => name)).not.toContain('Integrate exact hosted Session and publish live readback status');

  expect(terminal.needs).toEqual(['plan', 'authorize']);
  expect(terminal.permissions).toEqual({
    contents: 'read',
    'pull-requests': 'read',
    statuses: 'write'
  });
  expect(terminal.steps[0]?.env?.STATUS_CONTEXT).toBe('sec/integration-authorization');

  expect(integrate.needs).toEqual(['plan', 'authorize', 'terminal-status']);
  expect(integrate.permissions).toEqual({
    actions: 'read',
    checks: 'read',
    contents: 'write',
    issues: 'write',
    'pull-requests': 'write',
    statuses: 'read'
  });
  const integrateNames = integrate.steps.map(({ name }) => name);
  expect(integrateNames).toContain('Download exact integration preflight and recovery artifact');
  expect(integrateNames).toContain('Re-prove exact main authority rulesets before integration effect');
  expect(integrateNames).toContain('Re-read terminal authorization subject before effect');
  expect(integrateNames).toContain('Integrate exact hosted Session and publish live readback status');
  expect(integrateNames).toContain('Close out exact integrated branch');
  expect(integrateNames).toContain('Publish exact branch closeout receipt');
  expect(integrateNames.indexOf('Re-prove exact main authority rulesets before integration effect'))
    .toBeLessThan(integrateNames.indexOf('Integrate exact hosted Session and publish live readback status'));
  expect(integrateNames.indexOf('Re-read terminal authorization subject before effect'))
    .toBeLessThan(integrateNames.indexOf('Integrate exact hosted Session and publish live readback status'));
  expect(integrateNames.indexOf('Download exact integration preflight and recovery artifact'))
    .toBeLessThan(integrateNames.indexOf('Integrate exact hosted Session and publish live readback status'));
});
