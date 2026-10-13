import { expect, test } from 'bun:test';
import { HOSTED_RESUME_SIGNAL_SCHEMA, parseHostedResumeDispatchSignal } from '../../src/adapters/providers/github-api/contract/hosted-resume-dispatch.ts';
import {
  dispatchHostedSessionResume, executeHostedSessionResumeReceiver, verifyHostedIntegrationRecovery,
  type HostedControlStepFact, type HostedRecoveryVerificationPorts
} from '../../src/application/verification-session-hosted.ts';
import { sha256 } from '../../src/contracts/canonical.ts';
import type { HostedResumeEmitter, VerificationSessionHostedEnvelope, VerificationSessionHostedFacts, VerificationSessionHostedRequest } from '../../src/execution/verification/hosted.ts';
import type { GitHubCandidateObservation, GitHubReviewBarrierObservation } from '../../src/execution/verification/session.ts';

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

type ResumeReceiverPorts = Parameters<typeof executeHostedSessionResumeReceiver>[1];
type ResumeHistory = Awaited<ReturnType<ResumeReceiverPorts['observeDispatchHistory']>>;

// Receiver CasePlan: observe the actual application boundary with explicit
// data/port doubles. No fixture issues native authentication or dispatch rights.
// Existing provider tests own history provenance; these cases own its consumer:
// observer-only history cannot authorize first/retry dispatch, while terminal
// evidence still follows the independent intake -> preparation -> finalize join.
function resumeReceiverFixture(options: Readonly<{ history?: ResumeHistory; terminal?: boolean;
  sourceAssessment?: 'selected' | 'unselected' | 'blocked' }> = {}) {
  const order: string[] = [];
  const digest = sha256('receiver-data-double');
  const now = '2026-10-05T00:00:00.000Z';
  const request: VerificationSessionHostedRequest<string> = {
    schema: 'request-data-double', prNumber: 42, expectedBaseSha: 'a'.repeat(40),
    expectedBaseTreeSha: 'b'.repeat(40), expectedHeadSha: 'c'.repeat(40), expectedHeadTreeSha: 'd'.repeat(40),
    manifestPath: 'manifest-data-double', manifestDigest: digest, profile: 'quick',
    expectedScopeProposalDigest: digest, expectedActionPlanDigest: digest,
    expectedSessionRevision: digest, reviewPolicyDigest: digest, requestOperationId: digest
  };
  const candidate: GitHubCandidateObservation = {
    repository: 'owner/repo', number: 42, state: 'OPEN', isDraft: false, isCrossRepository: false,
    authorNodeId: 'author-double', baseBranch: 'main', baseSha: request.expectedBaseSha,
    baseTreeSha: request.expectedBaseTreeSha, headBranch: 'topic', headSha: request.expectedHeadSha,
    headTreeSha: request.expectedHeadTreeSha, title: 'candidate-double', body: 'manifest-data-double',
    mergeCommitSha: null, mergeCommitTreeSha: null, mergeCommitMessage: null, mergeCommitParentShas: null
  };
  const review: Extract<GitHubReviewBarrierObservation, { status: 'clear' }> = {
    status: 'clear', principal: { kind: 'human', nodeId: 'reviewer-double', approvalState: 'APPROVED' },
    snapshot: { paginationComplete: true, reviewedHeadSha: candidate.headSha, reviewPageDigests: [digest],
      threadPageDigests: [digest], reviewCount: 1, threadCount: 0, unresolvedBlockingThreadCount: 0,
      requestChangesPrincipalIds: [], snapshotDigest: digest },
    authority: { sourceTransport: 'github-rest', sourceDigest: digest, executionIdentity: 'read-double',
      providerIdentity: 'github', candidateWriteCapability: 'read-only', capabilityReceiptDigest: digest },
    observedAt: now
  };
  const facts: VerificationSessionHostedFacts = {
    repository: candidate.repository, sessionId: 'session-double', createdAt: now, candidate,
    authorizedPaths: ['source-double'], sessionProposalDigest: digest,
    scopeIssuer: { principalId: 'original-human-double', role: 'trusted-base-a0', trustRevision: candidate.baseSha,
      producerIdentity: 'scope-double', sourceTransport: 'github-actions', sourceRunId: 'original-run-double',
      sourceRef: 'original-source-double', sourceDigest: digest },
    scopeIssuedAt: now, scopeExpiresAt: now, environmentDigest: digest,
    actionPlanClosure: { schema: 'sec-ci-verification-action-plan-closure-v2',
      producerRevision: 'sec-ci-verification-action-producer-v2', actions: [], normalizedOperations: [], actionPlanDigest: digest },
    testImpactTransitionDigest: digest,
    mainHealth: { repository: candidate.repository, defaultBranch: 'main', mainSha: candidate.baseSha,
      mainTreeSha: candidate.baseTreeSha, status: 'healthy', failureFingerprints: [], owner: null,
      repairWorkPackage: null, expiresAt: now, allowedLanes: ['ordinary'], trustRevision: candidate.baseSha,
      observedAt: now, producer: { identity: 'health-double', trustRevision: candidate.baseSha,
        sourceTransport: 'github-api', sourceRunId: 'health-run-double', sourceRef: 'health-source-double', sourceDigest: digest } },
    evidenceRequirementDigest: digest, integrationPolicyDigest: digest, reviewBarrier: review,
    reviewExpiresAt: now, integrationPrincipalNodeId: 'original-human-double'
  };
  const historicalEnvelope: VerificationSessionHostedEnvelope<string> = {
    schema: 'envelope-data-double', requestOperationId: request.requestOperationId,
    scopeAuthorization: { schema: 'sec-scope-authorization-v1', repository: candidate.repository, prNumber: 42,
      baseSha: candidate.baseSha, baseTreeSha: candidate.baseTreeSha, headSha: candidate.headSha,
      headTreeSha: candidate.headTreeSha, manifestPath: request.manifestPath, manifestDigest: digest,
      proposalDigest: digest, authorizedPaths: facts.authorizedPaths, sessionProposalDigest: digest,
      actionPlanClosureDigest: digest, profile: 'quick', environmentDigest: digest, issuer: facts.scopeIssuer,
      issuedAt: now, expiresAt: now, authorizationRevision: digest, authorizationDigest: digest },
    preGateReview: { schema: 'sec-review-stability-receipt-v1', stage: 'pre-expensive', repository: candidate.repository,
      prNumber: 42, sessionRevision: digest, scopeAuthorizationRevision: digest, scopeAuthorizationReceiptDigest: digest,
      headSha: candidate.headSha, headTreeSha: candidate.headTreeSha,
      policy: { schema: 'sec-review-stability-policy-v1', policyId: 'review-double', trustedRevision: candidate.baseSha,
        trustedApps: [], allowIndependentHumanApproval: true, policyDigest: digest },
      principal: review.principal, independence: { candidateAuthorNodeId: candidate.authorNodeId,
        integrationPrincipalNodeId: facts.integrationPrincipalNodeId },
      producer: { ...review.authority, identity: 'review-double', trustedRevision: candidate.baseSha,
        sourceRunId: 'review-run-double', sourceRef: 'review-source-double' },
      snapshot: review.snapshot, reviewedAt: now, expiresAt: now, reviewRevision: digest, receiptDigest: digest },
    mainHealth: { ...facts.mainHealth, schema: 'sec-main-health-ledger-v1', healthRevision: digest, ledgerDigest: digest },
    session: { schema: 'sec-verification-session-v2', sessionId: 'historical-session-double', createdAt: now,
      repository: candidate.repository, prNumber: 42, baseSha: candidate.baseSha, baseTreeSha: candidate.baseTreeSha,
      headSha: candidate.headSha, headTreeSha: candidate.headTreeSha, manifestPath: request.manifestPath,
      manifestDigest: digest, sessionProposalDigest: digest, scopeAuthorizationRevision: digest,
      scopeAuthorizationReceiptDigest: digest, actionPlanClosureDigest: digest, profile: 'quick', environmentDigest: digest,
      trustRevision: candidate.baseSha, reviewPolicyDigest: digest, evidenceRequirementDigest: digest,
      integrationPolicyDigest: digest, mainHealthRef: { mainSha: candidate.baseSha, mainTreeSha: candidate.baseTreeSha,
        healthRevision: digest, ledgerReceiptDigest: digest }, sessionRevision: request.expectedSessionRevision },
    actionPlanClosure: facts.actionPlanClosure, envelopeDigest: digest
  };
  const preparedEnvelope: VerificationSessionHostedEnvelope<string> = { ...historicalEnvelope,
    session: { ...historicalEnvelope.session, sessionId: 'freshly-prepared-session-double' },
    envelopeDigest: sha256('freshly-prepared-envelope-double') };
  const members = [sha256('completed-member'), sha256('other-member')].map(proposedActionKey =>
    Object.freeze({ proposal: Object.freeze({ proposedActionKey }) }));
  const originalCompletedAction = { ...completedAction, providerEnvelope: members[0]! };
  const signal = { schema: 'signal-data-double', completedAction: originalCompletedAction, emitter,
    wakeKey: sha256('wake-double'), signalDigest: sha256('signal-double') };
  const transport = {
    artifactId: 'resolution-artifact-double', artifactName: 'resolution-double', archiveDigest: sha256('resolution-archive-double'),
    files: { 'verification-action-provider-envelope.json': JSON.stringify(members[0]),
      'hosted-action-resolution.json': 'resolution-data-double', 'hosted-envelope.json': 'historical-envelope-data-double' }
  };
  const action = { originalRequest: request, completedAction: originalCompletedAction, resolutionTransport: transport,
    parentActor: { nodeId: facts.integrationPrincipalNodeId }, parentPlan: { proposals: members.map(member => member.proposal) } };
  const snapshots = members.map((member, index) => ({ terminal: { actionKey: member.proposal.proposedActionKey, index },
    start: { kind: 'start', index }, anchor: { kind: 'anchor', index }, status: { kind: 'status', index } }));
  const producer = Object.freeze({ kind: 'producer-port-double' });
  const evidence = Object.freeze({ kind: 'terminal-evidence-port-double' });
  const artifact = Object.freeze({ kind: 'finalized-artifact-port-double' });
  const qualification = Object.freeze({ kind: 'qualified-source-port-double' });
  const history: ResumeHistory = options.history ?? { disposition: 'observed', use: 'observer-only', reason: null };
  const coordination = { disposition: options.terminal ? 'terminal' : 'dispatch',
    dispatchActionKeys: options.terminal ? [] : [members[1]!.proposal.proposedActionKey] };
  const forbiddenEffects: string[] = [];
  const forbidden = (name: string): never => { forbiddenEffects.push(name); throw new Error(`Unexpected receiver effect: ${name}`); };
  const ports: ResumeReceiverPorts = {
    captureResolutionTransport: async completed => {
      order.push('capture'); expect(completed).toBe(signal.completedAction); return transport;
    },
    parseProviderEnvelope: source => { expect(source).toBe(transport.files['verification-action-provider-envelope.json']); return members[0]!; },
    parseEnvelope: source => { expect(source).toBe(transport.files['hosted-envelope.json']); return historicalEnvelope; },
    parseResolution: source => { expect(source).toBe(transport.files['hosted-action-resolution.json']); return 'resolved-member-double'; },
    resolveAction: input => {
      expect(input.envelope).toBe(historicalEnvelope); expect(input.providerEnvelope).toBe(members[0]); return 'resolved-member-double';
    },
    observeAuthenticatedAction: async authority => {
      order.push('authenticated-reread'); expect(authority.envelope).toBe(members[0]);
      expect(authority.actionPlanClosure).toBe(historicalEnvelope.actionPlanClosure);
      // A separate equal readback, not reuse of the captured transport object.
      return { ...action, resolutionTransport: structuredClone(transport), completedAction: structuredClone(originalCompletedAction) };
    },
    encodeData: JSON.stringify,
    preparation: {
      assertTrustedRequestCurrent: actual => { expect(actual).toBe(request); },
      observeCandidate: async (repository, prNumber) => {
        order.push('candidate'); expect(repository).toBe('owner/repo'); expect(prNumber).toBe(42); return candidate;
      },
      manifestLocator: body => body,
      readBlobText: async () => 'manifest-data-double', manifestDigest: () => digest,
      parseManifest: source => source, assertManifestOwnership: () => undefined,
      observeChangedSelection: async () => ({ changedPaths: ['source-double'], testImpactTransition: null, testImpactSourceProvider: null }),
      observeDependencyBlobs: async () => null,
      observeReviewBarrier: async () => review, observeChecks: async () => [],
      reconstructFacts: input => {
        expect(input.integrationPrincipalNodeId).toBe(facts.integrationPrincipalNodeId);
        expect(input.producerPrincipalNodeId).toBe(facts.integrationPrincipalNodeId); return facts;
      },
      prepareEnvelope: input => {
        order.push('prepare'); expect(input.request).toBe(request); return preparedEnvelope;
      },
      now: () => now
    },
    makeProviderEnvelope: proposal => {
      const member = members.find(value => value.proposal === proposal);
      if (member === undefined) throw new Error('Unknown fixture member');
      return member;
    },
    observeMember: async (authority, observedSignal) => {
      const index = members.findIndex(member => member === authority.envelope);
      expect(index).not.toBe(-1); expect(observedSignal).toBe(signal);
      expect(authority.actionPlanClosure).toBe(preparedEnvelope.actionPlanClosure);
      order.push(`member:${index}`); return snapshots[index]!;
    },
    providerIndex: snapshot => {
      const index = snapshots.findIndex(value => value === snapshot);
      if (index === -1) throw new Error('Unknown fixture snapshot');
      const value = snapshots[index]!;
      return { terminalObservations: [value.terminal], startObservations: [value.start],
        terminalAnchorObservations: [value.anchor], providerStatusReadbacks: [value.status] };
    },
    createProducer: envelope => { expect(envelope).toBe(preparedEnvelope); return producer; },
    compose: input => {
      order.push('compose'); expect(input.envelope).toBe(preparedEnvelope); expect(input.producer).toBe(producer);
      expect(input.observations).toEqual(snapshots.map(value => value.terminal));
      expect(input.startObservations).toEqual(snapshots.map(value => value.start));
      expect(input.terminalAnchorObservations).toEqual(snapshots.map(value => value.anchor));
      expect(input.providerStatusReadbacks).toEqual(snapshots.map(value => value.status));
      return { coordination, evidence: options.terminal ? evidence : null };
    },
    observeDispatchHistory: async input => {
      order.push('history'); expect(input.authority.envelope).toBe(members[0]);
      expect(input.authority.actionPlanClosure).toBe(preparedEnvelope.actionPlanClosure);
      expect(input.sessionRevision).toBe(request.expectedSessionRevision);
      expect(input.actionKeys).toEqual([members[1]!.proposal.proposedActionKey]); return history;
    },
    dispatchMissing: async () => forbidden('dispatch'), projectDispatchOutcome: () => forbidden('project-outcome'),
    recordDispatchOutcome: async () => forbidden('record-outcome'), exportDispatchOutcomes: async () => forbidden('export-outcomes'),
    qualifyCompletion: async input => {
      order.push('qualify-completion');
      expect(input.envelope).toBe(preparedEnvelope); expect(input.evidence).toBe(evidence);
      expect(input.signal).toBe(signal); expect(input.members).toEqual(members);
      if (options.sourceAssessment === undefined || options.sourceAssessment === 'unselected') {
        return { kind: 'qualified', qualification: undefined };
      }
      order.push('assess-source');
      await Promise.resolve();
      if (options.sourceAssessment === 'blocked') {
        return { kind: 'blocked', reason: 'Original author adoption is still required.', needs: ['original author decision'] };
      }
      order.push('qualified-source');
      return { kind: 'qualified', qualification };
    },
    finalize: input => {
      order.push('finalize'); expect(input.envelope).toBe(preparedEnvelope); expect(input.evidence).toBe(evidence);
      expect(input.sourceProgramTransitionQualification).toBe(options.sourceAssessment === 'selected' ? qualification : undefined);
      expect(input.signal).toBe(signal); return artifact;
    },
    writeTerminal: async value => { order.push('write-terminal'); expect(value).toBe(artifact); }
  };
  return { input: { signal, repository: 'owner/repo', sourceRunId: 'receiver-run-double', sourceRef: 'receiver-source-double' },
    ports, order, forbiddenEffects, history, coordination, artifact, transport };
}

test('observer-only resume histories stay unknown without first or retry dispatch effects', async () => {
  const histories: readonly ResumeHistory[] = [
    { disposition: 'observed', use: 'observer-only', reason: null },
    { disposition: 'unavailable', use: 'observer-only', reason: 'Original receiver history is incomplete.' }
  ];
  for (const history of histories) {
    const fixture = resumeReceiverFixture({ history });
    const first = await executeHostedSessionResumeReceiver(fixture.input, fixture.ports);
    const retry = await executeHostedSessionResumeReceiver(fixture.input, fixture.ports);
    const expected = { status: 'unknown', reason: history.reason
      ?? 'Historical observations cannot establish that an earlier receiver never entered dispatch.',
      coordination: fixture.coordination, history, artifact: null };
    for (const result of [first, retry]) {
      expect(result).toEqual(expected);
    }
    expect(fixture.forbiddenEffects).toEqual([]);
    expect(fixture.order).toEqual(Array.from({ length: 2 }, () =>
      ['capture', 'authenticated-reread', 'candidate', 'candidate', 'prepare', 'member:0', 'member:1', 'compose', 'history']).flat());
  }
});

test('terminal resume evidence reaches the original finalizer after the independent intake and every member', async () => {
  const fixture = resumeReceiverFixture({ terminal: true });
  const result = await executeHostedSessionResumeReceiver(fixture.input, fixture.ports);
  expect(result).toEqual({ status: 'finalized', coordination: fixture.coordination, artifact: fixture.artifact });
  expect(fixture.order).toEqual(['capture', 'authenticated-reread', 'candidate', 'candidate', 'prepare',
    'member:0', 'member:1', 'compose', 'qualify-completion', 'finalize', 'write-terminal']);
  expect(fixture.forbiddenEffects).toEqual([]);
});

test('selected SourceProgram qualification completes before terminal finalization', async () => {
  const fixture = resumeReceiverFixture({ terminal: true, sourceAssessment: 'selected' });
  const result = await executeHostedSessionResumeReceiver(fixture.input, fixture.ports);
  expect(result.status).toBe('finalized');
  expect(fixture.order.slice(-6)).toEqual(['compose', 'qualify-completion', 'assess-source',
    'qualified-source', 'finalize', 'write-terminal']);
  expect(fixture.forbiddenEffects).toEqual([]);
});

test('unselected SourceProgram does not execute assessment while retaining intake ordering', async () => {
  const fixture = resumeReceiverFixture({ terminal: true, sourceAssessment: 'unselected' });
  const result = await executeHostedSessionResumeReceiver(fixture.input, fixture.ports);
  expect(result.status).toBe('finalized');
  expect(fixture.order.slice(-4)).toEqual(['compose', 'qualify-completion', 'finalize', 'write-terminal']);
  expect(fixture.order).not.toContain('assess-source');
});

test('SourceProgram adoption Needs stops terminal finalization and publication', async () => {
  const fixture = resumeReceiverFixture({ terminal: true, sourceAssessment: 'blocked' });
  const result = await executeHostedSessionResumeReceiver(fixture.input, fixture.ports);
  expect(result.status).toBe('blocked'); expect(result.artifact).toBeNull();
  expect('reason' in result && result.reason).toBe('Original author adoption is still required.');
  expect('needs' in result && result.needs).toEqual(['original author decision']);
  expect('coordination' in result && result.coordination).toBe(fixture.coordination);
  expect(fixture.order.slice(-3)).toEqual(['compose', 'qualify-completion', 'assess-source']);
  expect(fixture.order).not.toContain('finalize'); expect(fixture.order).not.toContain('write-terminal');
  expect(fixture.forbiddenEffects).toEqual([]);
});

test('resume refuses a changed independent archive before preparation and terminal finalization', async () => {
  const fixture = resumeReceiverFixture({ terminal: true });
  const originalRead = fixture.ports.observeAuthenticatedAction;
  fixture.ports.observeAuthenticatedAction = async authority => ({ ...await originalRead(authority),
    resolutionTransport: { ...fixture.transport, archiveDigest: sha256('another-independent-archive') } });
  await expect(executeHostedSessionResumeReceiver(fixture.input, fixture.ports))
    .rejects.toThrow('Hosted resume independent authenticated readback differs from the original complete archive and wakeup.');
  expect(fixture.order).toEqual(['capture', 'authenticated-reread']);
  expect(fixture.forbiddenEffects).toEqual([]);
});

test('terminal resume awaits its original writer and preserves its failure', async () => {
  const fixture = resumeReceiverFixture({ terminal: true });
  const failure = new Error('terminal writer rejected the original artifact');
  const ports: ResumeReceiverPorts = { ...fixture.ports, writeTerminal: async artifact => {
    expect(artifact).toBe(fixture.artifact);
    await Promise.resolve();
    throw failure;
  } };
  await expect(executeHostedSessionResumeReceiver(fixture.input, ports)).rejects.toBe(failure);
  expect(fixture.order).toEqual(['capture', 'authenticated-reread', 'candidate', 'candidate', 'prepare',
    'member:0', 'member:1', 'compose', 'qualify-completion', 'finalize']);
  expect(fixture.forbiddenEffects).toEqual([]);
});
