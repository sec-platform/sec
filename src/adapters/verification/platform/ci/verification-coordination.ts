import { CI_VERIFICATION_CONTRACT_REVISION } from '../../../../assurance/verification/contract/revision.ts';
import { CodexDevelopmentBuildVerificationGateResult, type VerificationGateResult, type VerificationResultStatus } from '../../../../assurance/verification/result/contract/result.ts';
import type { CiVerificationActionPlanClosure, VerificationActionKeyDigest } from '../../../../execution/verification/action.ts';
import type { HostedActionExecutionTicket, HostedActionRawResult, HostedActionResolution, VerificationSessionHostedEnvelope } from "../../../../execution/verification/hosted.ts";
import type { VerificationEvidence } from '../../../../execution/verification/session.ts';
import { encodeVerificationActionData, isVerificationActionRunnable, type VerificationActionDependencyResolution } from '../action/contract/action.ts';
import { resolveCiVerificationHostedExecutionEnvironment } from '../action/contract/ci.ts';
import { reduceVerificationActionProviderState, verificationActionProviderStartArtifactName, verificationActionProviderTerminalAnchorName, verificationActionProviderTerminalArtifactName, type VerificationActionProviderStartObservation, type VerificationActionProviderStatusReadback, type VerificationActionProviderTerminalAnchorObservation } from '../action/contract/provider.ts';
import { aggregateV4Status, CodexDevelopmentAssertVerificationActionTerminalArtifact, CodexDevelopmentCreateVerificationEvidenceProducer, CodexDevelopmentFinalizeVerificationActionTerminalArtifact, CodexDevelopmentFinalizeVerificationEvidenceV4, type CodexDevelopmentVerificationActionArtifactProducer, type CodexDevelopmentVerificationActionTerminalArtifact } from './contract/evidence.ts';
import { CodexDevelopmentCreateHostedSutExecutionAuthorization, CodexDevelopmentParseHostedActionRawResult, CodexDevelopmentReduceHostedSutObservation } from './contract/hosted-sut-observation.ts';
import type { CodexDevelopmentHostedActionArtifactObservation, CodexDevelopmentHostedActionCoordination, CodexDevelopmentHostedActionStartObservation, CodexDevelopmentHostedActionTerminalAnchorObservation } from './verification-hosted-action-contract.ts';
import { CI_VERIFICATION_ACTION_COORDINATION_SCHEMA, ciActionDigest, CodexDevelopmentParseHostedActionExecutionTicket, CodexDevelopmentParseHostedActionResolution, INVALIDATION_RULES, parseHostedEnvelope } from './verification-hosted-action-contract.ts';
import { hostedSutInventoryClosureFromTicket } from './verification-sut.ts';



export function CodexDevelopmentAssembleHostedActionTerminal(input: Readonly<{
  resolution: HostedActionResolution<import("../action/contract/ci.ts").CiVerificationExecutionEnvironment, typeof import("./verification-hosted-action-contract.ts").CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA>;
  ticket: HostedActionExecutionTicket<import("./contract/evidence.ts").CodexDevelopmentVerificationActionArtifactProducer, typeof import("./verification-hosted-action-contract.ts").CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA>;
  rawResult: HostedActionRawResult<typeof import("./contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY, typeof import("./contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, typeof import("./contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA, typeof import("./contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA>;
  expectedRawResultDigest: VerificationActionKeyDigest;
  producer: CodexDevelopmentVerificationActionArtifactProducer;
}>): CodexDevelopmentVerificationActionTerminalArtifact {
  const resolution = CodexDevelopmentParseHostedActionResolution(
    encodeVerificationActionData(input.resolution)
  );
  const ticket = CodexDevelopmentParseHostedActionExecutionTicket(
    encodeVerificationActionData(input.ticket)
  );
  const rawResult = CodexDevelopmentParseHostedActionRawResult(
    encodeVerificationActionData(input.rawResult)
  );
  const memberIndex = resolution.actionPlanClosure.actions.findIndex(
    (member) => member.action.actionKey === resolution.actionPlan.action.actionKey
  );
  const normalizedOperation = resolution.actionPlanClosure.normalizedOperations[memberIndex];
  if (normalizedOperation === undefined ||
      normalizedOperation.semanticDigest !== resolution.actionPlan.action.operation.semanticDigest) {
    throw new Error('Hosted Action assembler cannot reconstruct the exact normalized operation.');
  }
  if (ticket.resolutionDigest !== resolution.resolutionDigest ||
      ticket.actionKey !== resolution.actionPlan.action.actionKey ||
      ticket.candidateSha !== resolution.artifactInput.headSha ||
      ticket.candidateBytesDigest !== resolution.artifactInput.candidateBytesDigest ||
      encodeVerificationActionData(input.producer) !== encodeVerificationActionData(ticket.producer)) {
    throw new Error('Hosted Action assembler inputs differ from the original trusted execution ticket.');
  }
  const authorization = CodexDevelopmentCreateHostedSutExecutionAuthorization({
    resolutionDigest: resolution.resolutionDigest,
    ticketDigest: ticket.ticketDigest,
    actionPlan: resolution.actionPlan,
    normalizedOperation,
    candidateSha: ticket.candidateSha,
    candidateBytesDigest: ticket.candidateBytesDigest,
    manifestPath: resolution.artifactInput.manifestPath,
    inventoryClosure: hostedSutInventoryClosureFromTicket(ticket),
    producer: input.producer
  });
  const terminal = CodexDevelopmentReduceHostedSutObservation({
    actionPlan: resolution.actionPlan,
    normalizedOperation,
    candidateSha: ticket.candidateSha,
    candidateBytesDigest: ticket.candidateBytesDigest,
    manifestPath: resolution.artifactInput.manifestPath,
    producer: input.producer,
    authorization,
    observation: rawResult,
    expectedRawResultDigest: input.expectedRawResultDigest
  });
  return CodexDevelopmentFinalizeVerificationActionTerminalArtifact({
    actionPlan: resolution.actionPlan,
    normalizedOperation,
    result: terminal.result,
    cleanup: terminal.cleanup,
    executionEnvironment: resolveCiVerificationHostedExecutionEnvironment(resolution.actionPlan.action.environment.providerRevision),
    input: resolution.artifactInput,
    producer: input.producer,
    executionProof: terminal.proof
  });
}

function terminalDependencyState(
  artifact: CodexDevelopmentVerificationActionTerminalArtifact | undefined
): VerificationActionDependencyResolution['state'] {
  if (artifact === undefined) return 'unknown';
  if (artifact.cleanup.status === 'failed') return 'terminal-failed';
  switch (artifact.result.status) {
    case 'passed': return 'terminal-passed';
    case 'failed': return 'terminal-failed';
    case 'not-run': return 'not-run';
    case 'unsupported': return 'unsupported';
    case 'invalidated': return 'invalidated';
  }
}

function deriveHostedSyntheticNotRunActionKeys(
  plan: CiVerificationActionPlanClosure,
  terminalArtifactsByKey: ReadonlyMap<VerificationActionKeyDigest,
    CodexDevelopmentVerificationActionTerminalArtifact>
): ReadonlySet<VerificationActionKeyDigest> {
  const syntheticNotRunActionKeys = new Set<VerificationActionKeyDigest>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const member of plan.actions) {
      const actionKey = member.action.actionKey;
      if (terminalArtifactsByKey.has(actionKey) || syntheticNotRunActionKeys.has(actionKey)) continue;
      const hasDirectNonPassingDependency = member.dependencies.some((dependency) => {
        if (syntheticNotRunActionKeys.has(dependency.actionKey)) return true;
        const dependencyArtifact = terminalArtifactsByKey.get(dependency.actionKey);
        return dependencyArtifact !== undefined && terminalDependencyState(dependencyArtifact) !== 'terminal-passed';
      });
      if (hasDirectNonPassingDependency) {
        syntheticNotRunActionKeys.add(actionKey);
        changed = true;
      }
    }
  }
  return syntheticNotRunActionKeys;
}

export function CodexDevelopmentCoordinateHostedActions(input: Readonly<{
  envelope: VerificationSessionHostedEnvelope<typeof import("./contract/session-request.ts").VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA>;
  observations: readonly CodexDevelopmentHostedActionArtifactObservation[];
  startObservations: readonly CodexDevelopmentHostedActionStartObservation[];
  terminalAnchorObservations: readonly CodexDevelopmentHostedActionTerminalAnchorObservation[];
  providerStatusReadbacks: readonly VerificationActionProviderStatusReadback[];
}>): CodexDevelopmentHostedActionCoordination {
  const envelope = parseHostedEnvelope(input.envelope);
  const plan = envelope.actionPlanClosure;
  const membersByKey = new Map(plan.actions.map((member) => [member.action.actionKey, member] as const));
  const actionKeyForName = (name: string, kind: 'start' | 'terminal' | 'anchor'): VerificationActionKeyDigest => {
    const member = plan.actions.find((entry) => {
      if (kind === 'start') return verificationActionProviderStartArtifactName(entry.action.actionKey) === name;
      if (kind === 'terminal') return verificationActionProviderTerminalArtifactName(entry.action.actionKey) === name;
      return verificationActionProviderTerminalAnchorName(entry.action.actionKey) === name;
    });
    if (member === undefined) throw new Error('Hosted Action provider artifact is outside the canonical Session closure.');
    return member.action.actionKey;
  };
  const origins = new Set<string>();
  const assertCurrentBaseOrigin = (
    origin: CodexDevelopmentVerificationActionArtifactProducer | null,
    label: string
  ): void => {
    if (origin === null || origin.repository !== envelope.scopeAuthorization.repository ||
        origin.workflowSha !== envelope.session.baseSha ||
        origin.workflowRef !== `.github/workflows/compiler-pr-validation.yml@${envelope.session.baseSha}`) {
      throw new Error(`${label} is not produced by the exact trusted current-base workflow.`);
    }
  };
  const claimOrigin = (originId: string): void => {
    if (origins.has(originId)) throw new Error('Hosted Action provider index repeats one artifact origin.');
    origins.add(originId);
  };
  const terminalsByKey = new Map<VerificationActionKeyDigest, CodexDevelopmentHostedActionArtifactObservation>();
  for (const observation of input.observations) {
    const provider = observation.providerObservation;
    assertCurrentBaseOrigin(provider.referencedOrigin, 'Hosted Action terminal origin');
    claimOrigin(provider.originId);
    const actionKey = actionKeyForName(provider.artifactName, 'terminal');
    if (terminalsByKey.has(actionKey)) throw new Error('Hosted ActionKey has multiple terminal origins.');
    if (observation.artifact !== null) {
      const member = membersByKey.get(actionKey)!;
      CodexDevelopmentAssertVerificationActionTerminalArtifact(observation.artifact, {
        actionPlan: member,
        executionEnvironmentRevision: resolveCiVerificationHostedExecutionEnvironment(member.action.environment.providerRevision).executionEnvironmentRevision
      });
      if (provider.payload === null || provider.payload.payloadDigest !== observation.artifact.artifactDigest ||
          provider.payload.actionKey !== actionKey || provider.payload.candidateSha !== envelope.session.headSha ||
          encodeVerificationActionData(provider.payload.producer) !==
            encodeVerificationActionData(observation.artifact.producer)) {
        throw new Error('Hosted Action terminal provider fact differs from the canonical terminal artifact.');
      }
    }
    terminalsByKey.set(actionKey, observation);
  }
  const startsByKey = new Map<VerificationActionKeyDigest, VerificationActionProviderStartObservation>();
  for (const observation of input.startObservations) {
    assertCurrentBaseOrigin(observation.referencedOrigin, 'Hosted Action start origin');
    claimOrigin(observation.originId);
    const actionKey = actionKeyForName(observation.artifactName, 'start');
    if (startsByKey.has(actionKey)) throw new Error('Hosted ActionKey has multiple start origins.');
    startsByKey.set(actionKey, observation);
  }
  const anchorsByKey = new Map<VerificationActionKeyDigest, VerificationActionProviderTerminalAnchorObservation>();
  for (const observation of input.terminalAnchorObservations) {
    assertCurrentBaseOrigin(observation.referencedOrigin, 'Hosted Action terminal anchor origin');
    claimOrigin(observation.originId);
    const actionKey = actionKeyForName(observation.artifactName, 'anchor');
    if (anchorsByKey.has(actionKey)) throw new Error('Hosted ActionKey has multiple terminal anchor origins.');
    anchorsByKey.set(actionKey, observation);
  }
  const statusReadbacksByKey = new Map<VerificationActionKeyDigest, VerificationActionProviderStatusReadback>();
  const statusIds = new Set<number>();
  for (const readback of input.providerStatusReadbacks) {
    if (!membersByKey.has(readback.actionKey) || statusReadbacksByKey.has(readback.actionKey)) {
      throw new Error('Hosted Action provider readback is outside or duplicates the canonical Session closure.');
    }
    for (const status of readback.statuses) {
      assertCurrentBaseOrigin(status.referencedOrigin, 'Hosted Action status referenced origin');
      if (statusIds.has(status.id)) throw new Error('Hosted Action provider index repeats one status id.');
      statusIds.add(status.id);
    }
    statusReadbacksByKey.set(readback.actionKey, readback);
  }
  if (statusReadbacksByKey.size !== plan.actions.length) {
    throw new Error('Hosted Action provider status census is incomplete for the canonical Session closure.');
  }

  const byKey = new Map<VerificationActionKeyDigest, CodexDevelopmentVerificationActionTerminalArtifact>();
  const repairable: VerificationActionKeyDigest[] = [];
  const firstExecutionCandidates = new Set<VerificationActionKeyDigest>();
  for (const member of plan.actions) {
    const actionKey = member.action.actionKey;
    const decision = reduceVerificationActionProviderState({
      repositoryId: statusReadbacksByKey.get(actionKey)!.repositoryId,
      repository: envelope.scopeAuthorization.repository,
      actionKey,
      candidateSha: envelope.session.headSha,
      executionEnvironmentRevision: resolveCiVerificationHostedExecutionEnvironment(member.action.environment.providerRevision).executionEnvironmentRevision,
      statusReadback: statusReadbacksByKey.get(actionKey)!,
      startObservations: startsByKey.has(actionKey) ? [startsByKey.get(actionKey)!] : [],
      terminalObservations: terminalsByKey.has(actionKey)
        ? [terminalsByKey.get(actionKey)!.providerObservation]
        : [],
      terminalAnchorObservations: anchorsByKey.has(actionKey) ? [anchorsByKey.get(actionKey)!] : []
    });
    if (decision.disposition === 'blocked') {
      return finalizeCoordination(
        plan.actionPlanDigest, 'blocked', [], [...byKey.keys()],
        plan.actions.filter((entry) => !byKey.has(entry.action.actionKey)).map((entry) => entry.action.actionKey),
        decision.reason
      );
    }
    if (decision.disposition === 'start-allowed') {
      firstExecutionCandidates.add(actionKey);
      continue;
    }
    const terminal = terminalsByKey.get(actionKey);
    if (terminal?.artifact === null || terminal?.artifact === undefined ||
        decision.terminalPayloadDigest !== terminal.artifact.artifactDigest) {
      throw new Error('Hosted Action provider terminal decision has no exact terminal artifact bytes.');
    }
    byKey.set(actionKey, terminal.artifact);
    if (decision.disposition === 'repair-terminal-anchor' ||
        decision.disposition === 'repair-terminal-status') {
      repairable.push(actionKey);
    }
  }

  const missing = plan.actions.filter((entry) => !byKey.has(entry.action.actionKey));
  const syntheticNotRunActionKeys = deriveHostedSyntheticNotRunActionKeys(plan, byKey);
  const runnable: VerificationActionKeyDigest[] = [];
  for (const member of missing) {
    if (syntheticNotRunActionKeys.has(member.action.actionKey)) continue;
    if (!firstExecutionCandidates.has(member.action.actionKey)) continue;
    const dependencies = member.dependencies.map((dependency) => Object.freeze({
      actionKey: dependency.actionKey,
      state: syntheticNotRunActionKeys.has(dependency.actionKey)
        ? 'not-run' as const
        : terminalDependencyState(byKey.get(dependency.actionKey)),
      observationDigest: (byKey.get(dependency.actionKey)?.artifactDigest ?? null) as VerificationActionKeyDigest | null
    }));
    const runnableDecision = isVerificationActionRunnable(member, dependencies);
    if (runnableDecision.runnable) runnable.push(member.action.actionKey);
  }
  const dispatch = [...new Set([...repairable, ...runnable])];
  if (dispatch.length > 0) {
    return finalizeCoordination(plan.actionPlanDigest, 'dispatch', dispatch, [...byKey.keys()],
      missing.map((entry) => entry.action.actionKey), null);
  }
  if (byKey.size + syntheticNotRunActionKeys.size === plan.actions.length) {
    return finalizeCoordination(plan.actionPlanDigest, 'complete', [], [...byKey.keys()],
      missing.map((entry) => entry.action.actionKey), null);
  }
  return finalizeCoordination(plan.actionPlanDigest, 'waiting', [], [...byKey.keys()],
    missing.map((entry) => entry.action.actionKey), 'required upstream Action terminal has not arrived');
}

function finalizeCoordination(
  actionPlanDigest: VerificationActionKeyDigest,
  disposition: CodexDevelopmentHostedActionCoordination['disposition'],
  dispatchActionKeys: readonly VerificationActionKeyDigest[],
  terminalActionKeys: readonly VerificationActionKeyDigest[],
  missingActionKeys: readonly VerificationActionKeyDigest[],
  reason: string | null
): CodexDevelopmentHostedActionCoordination {
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_COORDINATION_SCHEMA,
    disposition,
    actionPlanDigest,
    dispatchActionKeys: Object.freeze([...dispatchActionKeys].sort()),
    terminalActionKeys: Object.freeze([...terminalActionKeys].sort()),
    missingActionKeys: Object.freeze([...missingActionKeys].sort()),
    reason
  });
  return Object.freeze({ ...withoutDigest, coordinationDigest: ciActionDigest(withoutDigest) });
}

/** Sole projection from an authenticated terminal to its reusable gate. */
export function projectHostedTerminalGate(
  action: CiVerificationActionPlanClosure['actions'][number]['action'],
  artifact: CodexDevelopmentVerificationActionTerminalArtifact
) {
  const evidenceRef = `verification-action-artifact:${artifact.artifactDigest}`;
  const reusableTerminal = artifact.result.status === 'passed' || artifact.result.status === 'failed';
  const result = CodexDevelopmentBuildVerificationGateResult({
    ...artifact.result,
    disposition: reusableTerminal ? 'reused' : artifact.result.disposition,
    execution: reusableTerminal ? null : artifact.result.execution,
    evidenceRefs: [...new Set([...artifact.result.evidenceRefs, evidenceRef])]
  });
  return Object.freeze({ action, result, cleanup: artifact.cleanup });
}

export function CodexDevelopmentComposeHostedEvidence(input: Readonly<{
  envelope: VerificationSessionHostedEnvelope<typeof import("./contract/session-request.ts").VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA>;
  observations: readonly CodexDevelopmentHostedActionArtifactObservation[];
  startObservations: readonly CodexDevelopmentHostedActionStartObservation[];
  terminalAnchorObservations: readonly CodexDevelopmentHostedActionTerminalAnchorObservation[];
  providerStatusReadbacks: readonly VerificationActionProviderStatusReadback[];
  producer: ReturnType<typeof CodexDevelopmentCreateVerificationEvidenceProducer>;
  now?: () => Date;
}>): Readonly<{
  coordination: CodexDevelopmentHostedActionCoordination;
  evidence: VerificationEvidence<typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult> | null;
}> {
  const envelope = parseHostedEnvelope(input.envelope);
  const coordination = CodexDevelopmentCoordinateHostedActions({
    envelope,
    observations: input.observations,
    startObservations: input.startObservations,
    terminalAnchorObservations: input.terminalAnchorObservations,
    providerStatusReadbacks: input.providerStatusReadbacks
  });
  if (coordination.disposition !== 'complete') {
    return Object.freeze({ coordination, evidence: null });
  }
  const byKey = new Map<VerificationActionKeyDigest, CodexDevelopmentVerificationActionTerminalArtifact>();
  for (const observation of input.observations) {
    if (!observation.providerObservation.expired && observation.artifact !== null) {
      byKey.set(observation.artifact.actionPlan.action.actionKey, observation.artifact);
    }
  }
  const syntheticNotRunActionKeys = deriveHostedSyntheticNotRunActionKeys(
    envelope.actionPlanClosure,
    byKey
  );
  const gates = envelope.actionPlanClosure.actions.map((member) => {
    const artifact = byKey.get(member.action.actionKey);
    if (artifact !== undefined) {
      return projectHostedTerminalGate(member.action, artifact);
    }
    if (!syntheticNotRunActionKeys.has(member.action.actionKey)) {
      throw new Error('Hosted Evidence composition is complete without a terminal or failed prerequisite.');
    }
    return Object.freeze({
      action: member.action,
      result: CodexDevelopmentBuildVerificationGateResult({
        gateId: member.action.operation.identity,
        gateRevision: member.action.operation.revision,
        owner: 'ci-verification-maintainer',
        requirementKey: `gate:${member.action.operation.identity}`,
        subjectRevision: envelope.session.headSha,
        inputDigest: member.action.actionKey,
        applicability: 'required',
        status: 'not-run',
        disposition: 'not-executed',
        reasonCode: 'fail-fast-prerequisite-failed',
        requiredForClaims: [`gate:${member.action.operation.identity}`],
        supportedClaims: [`gate:${member.action.operation.identity}`],
        environment: null,
        execution: null,
        evidenceRefs: [],
        invalidationRules: ['ActionKey or dependency closure changes'],
        diagnostic: 'A declared direct prerequisite has a canonical nonpassing hosted Action outcome.'
      }),
      cleanup: Object.freeze({ status: 'not-required' as const, evidenceRefs: Object.freeze([]), diagnostic: null })
    });
  });
  const timestamps = [...byKey.values()].flatMap((artifact) => artifact.result.execution === null
    ? []
    : [artifact.result.execution.startedAt, artifact.result.execution.finishedAt]);
  const observedAt = (input.now ?? (() => new Date()))().toISOString();
  const startedAt = [...timestamps, observedAt].sort()[0]!;
  const finishedAt = [...timestamps, observedAt].sort().at(-1)!;
  const status = aggregateV4Status(gates);
  const evidence = CodexDevelopmentFinalizeVerificationEvidenceV4({
    contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
    sessionRevision: envelope.session.sessionRevision,
    sessionProposalDigest: envelope.session.sessionProposalDigest,
    scopeAuthorizationRevision: envelope.scopeAuthorization.authorizationRevision,
    scopeAuthorizationDigest: envelope.scopeAuthorization.authorizationDigest,
    reviewReceiptDigest: envelope.preGateReview.receiptDigest,
    mainHealthRevision: envelope.mainHealth.healthRevision,
    mainHealthDigest: envelope.mainHealth.ledgerDigest,
    trustRevision: envelope.session.trustRevision,
    profile: envelope.session.profile as 'quick' | 'full',
    baseSha: envelope.session.baseSha,
    baseTreeSha: envelope.session.baseTreeSha,
    headSha: envelope.session.headSha,
    headTreeSha: envelope.session.headTreeSha,
    manifestPath: envelope.session.manifestPath,
    manifestDigest: envelope.session.manifestDigest,
    producer: input.producer,
    actionPlan: envelope.actionPlanClosure,
    status,
    startedAt,
    finishedAt,
    gates,
    evidenceRefs: [...byKey.values()].map((artifact) =>
      `verification-action-artifact:${artifact.artifactDigest}`
    ),
    invalidationRules: [
      ...INVALIDATION_RULES,
      'Session, Scope, Review, MainHealth, trust, Action member, or immutable terminal origin changes'
    ]
  });
  return Object.freeze({ coordination, evidence });
}
