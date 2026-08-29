import { describe, expect, test } from 'bun:test';

import { CI_VERIFICATION_HOSTED_PROVIDER_REVISION } from '../../src/verification/action/contract/environment.ts';
import type { VerificationActionKeyDigest } from '../../src/verification/action/contract/action.ts';
import { VERIFICATION_ACTION_PROVIDER_POLICY, createVerificationActionProviderStartMarker, createVerificationActionProviderTerminalAnchor, finalizeVerificationActionProviderStatusReadback, parseVerificationActionProviderStatusReadback, reduceVerificationActionProviderState, verificationActionProviderRunTargetUrl, verificationActionProviderStartArtifactName, verificationActionProviderStartDescription, verificationActionProviderStatusContext, verificationActionProviderTerminalAnchorName, verificationActionProviderTerminalArtifactName, verificationActionProviderTerminalDescription, type VerificationActionProviderOrigin, type VerificationActionProviderStartObservation, type VerificationActionProviderStateInput, type VerificationActionProviderStatusObservation, type VerificationActionProviderTerminalAnchorObservation, type VerificationActionProviderTerminalFact, type VerificationActionProviderTerminalObservation } from '../../src/verification/action/contract/provider.ts';

const ACTION = `sha256:${'a'.repeat(64)}` as VerificationActionKeyDigest;
const PAGE = `sha256:${'b'.repeat(64)}` as VerificationActionKeyDigest;
const START_ARCHIVE = `sha256:${'c'.repeat(64)}` as VerificationActionKeyDigest;
const TERMINAL_ARCHIVE = `sha256:${'d'.repeat(64)}` as VerificationActionKeyDigest;
const ANCHOR_ARCHIVE = `sha256:${'e'.repeat(64)}` as VerificationActionKeyDigest;
const PAYLOAD = `sha256:${'f'.repeat(64)}` as VerificationActionKeyDigest;
const BASE = '1'.repeat(40);
const HEAD = '2'.repeat(40);
const ENVIRONMENT = CI_VERIFICATION_HOSTED_PROVIDER_REVISION;

const origin: VerificationActionProviderOrigin = Object.freeze({
  repositoryId: 311,
  repository: 'openai/sec',
  workflowPath: '.github/workflows/compiler-pr-validation.yml',
  workflowRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`,
  workflowSha: BASE,
  runId: '9001',
  runAttempt: 1,
  appId: 15368,
  appNodeId: 'MDM6QXBwMTUzNjg=',
  sourceEvent: 'repository_dispatch'
});

const marker = createVerificationActionProviderStartMarker({
  actionKey: ACTION,
  candidateSha: HEAD,
  executionEnvironmentRevision: ENVIRONMENT,
  producer: origin
});

function status(
  id: number,
  nodeId: string,
  state: VerificationActionProviderStatusObservation['state'],
  description: string,
  referencedOrigin: VerificationActionProviderOrigin = origin,
  createdAt = id === 101 ? '2026-08-09T01:00:00.000Z' : '2026-08-09T01:01:00.000Z'
): VerificationActionProviderStatusObservation {
  return Object.freeze({
    id,
    nodeId,
    state,
    context: verificationActionProviderStatusContext(ACTION),
    description,
    targetUrl: verificationActionProviderRunTargetUrl(referencedOrigin),
    commitSha: HEAD,
    createdAt,
    updatedAt: createdAt,
    creator: VERIFICATION_ACTION_PROVIDER_POLICY.creator,
    referencedOrigin
  });
}

function readback(statuses: readonly VerificationActionProviderStatusObservation[]) {
  return finalizeVerificationActionProviderStatusReadback({
    repositoryId: origin.repositoryId,
    repository: origin.repository,
    actionKey: ACTION,
    candidateSha: HEAD,
    context: verificationActionProviderStatusContext(ACTION),
    perPage: 100,
    paginationComplete: true,
    pageDigests: [PAGE],
    statuses
  });
}

function startObservation(expired = false): VerificationActionProviderStartObservation {
  return Object.freeze({
    originId: '7001',
    artifactName: verificationActionProviderStartArtifactName(ACTION),
    archiveDigest: expired ? null : START_ARCHIVE,
    expired,
    payload: expired ? null : marker,
    referencedOrigin: expired ? null : origin
  });
}

function terminalFact(): VerificationActionProviderTerminalFact {
  return Object.freeze({
    actionKey: ACTION,
    candidateSha: HEAD,
    payloadDigest: PAYLOAD,
    producer: origin
  });
}

function terminalObservation(
  fact: VerificationActionProviderTerminalFact,
  expired = false
): VerificationActionProviderTerminalObservation {
  return Object.freeze({
    originId: '7002',
    artifactName: verificationActionProviderTerminalArtifactName(ACTION),
    archiveDigest: expired ? null : TERMINAL_ARCHIVE,
    expired,
    payload: expired ? null : fact,
    referencedOrigin: expired ? null : origin
  });
}

function anchorObservation(
  fact: VerificationActionProviderTerminalFact,
  expired = false
): VerificationActionProviderTerminalAnchorObservation {
  const anchor = createVerificationActionProviderTerminalAnchor({
    actionKey: ACTION,
    candidateSha: HEAD,
    startStatusId: 101,
    startStatusNodeId: 'STATUS_start',
    startArtifactOriginId: '7001',
    startArtifactName: verificationActionProviderStartArtifactName(ACTION),
    startArtifactArchiveDigest: START_ARCHIVE,
    startMarkerDigest: marker.markerDigest,
    terminalArtifactOriginId: '7002',
    terminalArtifactName: verificationActionProviderTerminalArtifactName(ACTION),
    terminalArtifactArchiveDigest: TERMINAL_ARCHIVE,
    terminalArtifactPayloadDigest: fact.payloadDigest,
    terminalAssemblerOrigin: origin,
    anchorPublisherOrigin: origin
  });
  return Object.freeze({
    originId: '7003',
    artifactName: verificationActionProviderTerminalAnchorName(ACTION),
    archiveDigest: expired ? null : ANCHOR_ARCHIVE,
    expired,
    payload: expired ? null : anchor,
    referencedOrigin: expired ? null : origin
  });
}

function state(overrides: Partial<VerificationActionProviderStateInput> = {}): VerificationActionProviderStateInput {
  return Object.freeze({
    repositoryId: origin.repositoryId,
    repository: origin.repository,
    actionKey: ACTION,
    candidateSha: HEAD,
    executionEnvironmentRevision: ENVIRONMENT,
    statusReadback: readback([]),
    startObservations: [],
    terminalObservations: [],
    terminalAnchorObservations: [],
    ...overrides
  });
}

function complete(
  terminalStatus = true,
  terminalStatusOrigin: VerificationActionProviderOrigin = origin,
  terminalStatusId = 102
): VerificationActionProviderStateInput {
  const fact = terminalFact();
  const anchor = anchorObservation(fact);
  const statuses: VerificationActionProviderStatusObservation[] = [
    status(101, 'STATUS_start', 'pending', verificationActionProviderStartDescription(marker.markerDigest))
  ];
  if (terminalStatus) {
    statuses.push(status(
      terminalStatusId,
      'STATUS_terminal',
      'success',
      verificationActionProviderTerminalDescription(anchor.payload!.anchorDigest),
      terminalStatusOrigin,
      '2026-08-09T01:01:00.000Z'
    ));
  }
  return state({
    statusReadback: readback(statuses),
    startObservations: [startObservation()],
    terminalObservations: [terminalObservation(fact)],
    terminalAnchorObservations: [anchor]
  });
}

describe('VerificationAction provider pure state contract', () => {
  test('zero complete status history and zero artifacts permits the sole physical start', () => {
    const result = reduceVerificationActionProviderState(state());
    expect(result.disposition).toBe('start-allowed');
    expect(result.physicalExecutionAllowed).toBe(true);
    expect(result.terminalAnchorRepairAllowed).toBe(false);
    expect(result.terminalStatusRepairAllowed).toBe(false);
  });

  test('a durable start without authenticated terminal bytes permanently blocks replay', () => {
    const result = reduceVerificationActionProviderState(state({
      statusReadback: readback([
        status(101, 'STATUS_start', 'pending', verificationActionProviderStartDescription(marker.markerDigest))
      ]),
      startObservations: [startObservation()]
    }));
    expect(result.disposition).toBe('blocked');
    expect(result.physicalExecutionAllowed).toBe(false);
    expect(result.reason).toContain('outcome is unknown');
  });

  test('exact terminal bytes without terminal status permit status-only repair', () => {
    const result = reduceVerificationActionProviderState(complete(false));
    expect(result.disposition).toBe('repair-terminal-status');
    expect(result.physicalExecutionAllowed).toBe(false);
    expect(result.terminalStatusRepairAllowed).toBe(true);
    expect(result.terminalPayloadDigest).toBe(PAYLOAD);
  });

  test('post-upload crash permits anchor repair without another physical execution', () => {
    const terminalWithoutAnchor = complete(false);
    const result = reduceVerificationActionProviderState({
      ...terminalWithoutAnchor,
      terminalAnchorObservations: []
    });
    expect(result.disposition).toBe('repair-terminal-anchor');
    expect(result.physicalExecutionAllowed).toBe(false);
    expect(result.terminalAnchorRepairAllowed).toBe(true);
    expect(result.terminalStatusRepairAllowed).toBe(false);
    expect(result.terminalPayloadDigest).toBe(PAYLOAD);
  });

  test('anchored terminal remains opaque to provider Result and cleanup semantics', () => {
    const result = reduceVerificationActionProviderState(complete());
    expect(result.disposition).toBe('terminal-anchored');
    expect(result.terminalPayloadDigest).toBe(PAYLOAD);
    expect('resultStatus' in result).toBe(false);
    expect('cleanupStatus' in result).toBe(false);
    expect(Object.keys(terminalFact()).sort()).toEqual([
      'actionKey', 'candidateSha', 'payloadDigest', 'producer'
    ]);
  });

  test('provider status cannot encode or promote Verification Result', () => {
    const canonical = complete();
    const forged = {
      ...canonical.statusReadback,
      statuses: canonical.statusReadback.statuses.map((entry) =>
        entry.state === 'success' ? { ...entry, state: 'failure' as const } : entry
      )
    };
    const withDigest = finalizeVerificationActionProviderStatusReadback({
      repositoryId: forged.repositoryId,
      repository: forged.repository,
      actionKey: forged.actionKey,
      candidateSha: forged.candidateSha,
      context: forged.context,
      perPage: 100,
      paginationComplete: true,
      pageDigests: forged.pageDigests,
      statuses: forged.statuses
    });
    expect(() => reduceVerificationActionProviderState({
      ...canonical,
      statusReadback: withDigest
    })).toThrow('non-neutral terminal');
  });

  test('later trusted repairer and nonmonotonic GitHub id do not replace anchor causality', () => {
    const repairer = Object.freeze({ ...origin, runId: '9002', runAttempt: 2 });
    const result = reduceVerificationActionProviderState(complete(true, repairer, 99));
    expect(result.disposition).toBe('terminal-anchored');
    expect(result.physicalExecutionAllowed).toBe(false);
  });

  test('retained tombstone plus expired terminal artifact blocks replay and reuse', () => {
    const canonical = complete();
    const result = reduceVerificationActionProviderState({
      ...canonical,
      terminalObservations: [terminalObservation(terminalFact(), true)]
    });
    expect(result.disposition).toBe('blocked');
    expect(result.reason).toContain('retained out');
  });

  test('duplicate origins and malformed or incomplete pagination fail closed', () => {
    expect(() => reduceVerificationActionProviderState({
      ...complete(),
      startObservations: [startObservation(), startObservation()]
    })).toThrow('multiple immutable origins');

    const canonical = readback([]);
    expect(() => parseVerificationActionProviderStatusReadback({
      ...canonical,
      paginationComplete: false
    })).toThrow('pagination');
    expect(() => parseVerificationActionProviderStatusReadback({
      ...canonical,
      pageDigests: []
    })).toThrow();
  });
});
