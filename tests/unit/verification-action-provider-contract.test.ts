import { describe, expect, test } from 'bun:test';

import { CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2 } from '../../platform/shared/ci-verification-revision.ts';
import type { VerificationActionKeyDigest } from '../../platform/shared/verification-action-contract.ts';
import {
  VERIFICATION_ACTION_PROVIDER_POLICY_V2,
  createVerificationActionProviderStartMarkerV2,
  createVerificationActionProviderTerminalAnchorV2,
  finalizeVerificationActionProviderStatusReadbackV2,
  parseVerificationActionProviderStatusReadbackV2,
  reduceVerificationActionProviderStateV2,
  verificationActionProviderRunTargetUrlV2,
  verificationActionProviderStartArtifactNameV2,
  verificationActionProviderStartDescriptionV2,
  verificationActionProviderStatusContextV2,
  verificationActionProviderTerminalAnchorNameV2,
  verificationActionProviderTerminalArtifactNameV2,
  verificationActionProviderTerminalDescriptionV2,
  type VerificationActionProviderOriginV2,
  type VerificationActionProviderStartObservationV2,
  type VerificationActionProviderStateInputV2,
  type VerificationActionProviderStatusObservationV2,
  type VerificationActionProviderTerminalAnchorObservationV2,
  type VerificationActionProviderTerminalFactV2,
  type VerificationActionProviderTerminalObservationV2
} from '../../platform/shared/verification-action-provider-contract.ts';

const ACTION = `sha256:${'a'.repeat(64)}` as VerificationActionKeyDigest;
const PAGE = `sha256:${'b'.repeat(64)}` as VerificationActionKeyDigest;
const START_ARCHIVE = `sha256:${'c'.repeat(64)}` as VerificationActionKeyDigest;
const TERMINAL_ARCHIVE = `sha256:${'d'.repeat(64)}` as VerificationActionKeyDigest;
const ANCHOR_ARCHIVE = `sha256:${'e'.repeat(64)}` as VerificationActionKeyDigest;
const PAYLOAD = `sha256:${'f'.repeat(64)}` as VerificationActionKeyDigest;
const BASE = '1'.repeat(40);
const HEAD = '2'.repeat(40);
const ENVIRONMENT = CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2;

const origin: VerificationActionProviderOriginV2 = Object.freeze({
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

const marker = createVerificationActionProviderStartMarkerV2({
  actionKey: ACTION,
  candidateSha: HEAD,
  executionEnvironmentRevision: ENVIRONMENT,
  producer: origin
});

function status(
  id: number,
  nodeId: string,
  state: VerificationActionProviderStatusObservationV2['state'],
  description: string,
  referencedOrigin: VerificationActionProviderOriginV2 = origin,
  createdAt = id === 101 ? '2026-08-09T01:00:00.000Z' : '2026-08-09T01:01:00.000Z'
): VerificationActionProviderStatusObservationV2 {
  return Object.freeze({
    id,
    nodeId,
    state,
    context: verificationActionProviderStatusContextV2(ACTION),
    description,
    targetUrl: verificationActionProviderRunTargetUrlV2(referencedOrigin),
    commitSha: HEAD,
    createdAt,
    updatedAt: createdAt,
    creator: VERIFICATION_ACTION_PROVIDER_POLICY_V2.creator,
    referencedOrigin
  });
}

function readback(statuses: readonly VerificationActionProviderStatusObservationV2[]) {
  return finalizeVerificationActionProviderStatusReadbackV2({
    repositoryId: origin.repositoryId,
    repository: origin.repository,
    actionKey: ACTION,
    candidateSha: HEAD,
    context: verificationActionProviderStatusContextV2(ACTION),
    perPage: 100,
    paginationComplete: true,
    pageDigests: [PAGE],
    statuses
  });
}

function startObservation(expired = false): VerificationActionProviderStartObservationV2 {
  return Object.freeze({
    originId: '7001',
    artifactName: verificationActionProviderStartArtifactNameV2(ACTION),
    archiveDigest: expired ? null : START_ARCHIVE,
    expired,
    payload: expired ? null : marker,
    referencedOrigin: expired ? null : origin
  });
}

function terminalFact(): VerificationActionProviderTerminalFactV2 {
  return Object.freeze({
    actionKey: ACTION,
    candidateSha: HEAD,
    payloadDigest: PAYLOAD,
    producer: origin
  });
}

function terminalObservation(
  fact: VerificationActionProviderTerminalFactV2,
  expired = false
): VerificationActionProviderTerminalObservationV2 {
  return Object.freeze({
    originId: '7002',
    artifactName: verificationActionProviderTerminalArtifactNameV2(ACTION),
    archiveDigest: expired ? null : TERMINAL_ARCHIVE,
    expired,
    payload: expired ? null : fact,
    referencedOrigin: expired ? null : origin
  });
}

function anchorObservation(
  fact: VerificationActionProviderTerminalFactV2,
  expired = false
): VerificationActionProviderTerminalAnchorObservationV2 {
  const anchor = createVerificationActionProviderTerminalAnchorV2({
    actionKey: ACTION,
    candidateSha: HEAD,
    startStatusId: 101,
    startStatusNodeId: 'STATUS_start',
    startArtifactOriginId: '7001',
    startArtifactName: verificationActionProviderStartArtifactNameV2(ACTION),
    startArtifactArchiveDigest: START_ARCHIVE,
    startMarkerDigest: marker.markerDigest,
    terminalArtifactOriginId: '7002',
    terminalArtifactName: verificationActionProviderTerminalArtifactNameV2(ACTION),
    terminalArtifactArchiveDigest: TERMINAL_ARCHIVE,
    terminalArtifactPayloadDigest: fact.payloadDigest,
    terminalAssemblerOrigin: origin,
    anchorPublisherOrigin: origin
  });
  return Object.freeze({
    originId: '7003',
    artifactName: verificationActionProviderTerminalAnchorNameV2(ACTION),
    archiveDigest: expired ? null : ANCHOR_ARCHIVE,
    expired,
    payload: expired ? null : anchor,
    referencedOrigin: expired ? null : origin
  });
}

function state(overrides: Partial<VerificationActionProviderStateInputV2> = {}): VerificationActionProviderStateInputV2 {
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
  terminalStatusOrigin: VerificationActionProviderOriginV2 = origin,
  terminalStatusId = 102
): VerificationActionProviderStateInputV2 {
  const fact = terminalFact();
  const anchor = anchorObservation(fact);
  const statuses: VerificationActionProviderStatusObservationV2[] = [
    status(101, 'STATUS_start', 'pending', verificationActionProviderStartDescriptionV2(marker.markerDigest))
  ];
  if (terminalStatus) {
    statuses.push(status(
      terminalStatusId,
      'STATUS_terminal',
      'success',
      verificationActionProviderTerminalDescriptionV2(anchor.payload!.anchorDigest),
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
    const result = reduceVerificationActionProviderStateV2(state());
    expect(result.disposition).toBe('start-allowed');
    expect(result.physicalExecutionAllowed).toBe(true);
    expect(result.terminalAnchorRepairAllowed).toBe(false);
    expect(result.terminalStatusRepairAllowed).toBe(false);
  });

  test('a durable start without authenticated terminal bytes permanently blocks replay', () => {
    const result = reduceVerificationActionProviderStateV2(state({
      statusReadback: readback([
        status(101, 'STATUS_start', 'pending', verificationActionProviderStartDescriptionV2(marker.markerDigest))
      ]),
      startObservations: [startObservation()]
    }));
    expect(result.disposition).toBe('blocked');
    expect(result.physicalExecutionAllowed).toBe(false);
    expect(result.reason).toContain('outcome is unknown');
  });

  test('exact terminal bytes without terminal status permit status-only repair', () => {
    const result = reduceVerificationActionProviderStateV2(complete(false));
    expect(result.disposition).toBe('repair-terminal-status');
    expect(result.physicalExecutionAllowed).toBe(false);
    expect(result.terminalStatusRepairAllowed).toBe(true);
    expect(result.terminalPayloadDigest).toBe(PAYLOAD);
  });

  test('post-upload crash permits anchor repair without another physical execution', () => {
    const terminalWithoutAnchor = complete(false);
    const result = reduceVerificationActionProviderStateV2({
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
    const result = reduceVerificationActionProviderStateV2(complete());
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
    const withDigest = finalizeVerificationActionProviderStatusReadbackV2({
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
    expect(() => reduceVerificationActionProviderStateV2({
      ...canonical,
      statusReadback: withDigest
    })).toThrow('non-neutral terminal');
  });

  test('later trusted repairer and nonmonotonic GitHub id do not replace anchor causality', () => {
    const repairer = Object.freeze({ ...origin, runId: '9002', runAttempt: 2 });
    const result = reduceVerificationActionProviderStateV2(complete(true, repairer, 99));
    expect(result.disposition).toBe('terminal-anchored');
    expect(result.physicalExecutionAllowed).toBe(false);
  });

  test('retained tombstone plus expired terminal artifact blocks replay and reuse', () => {
    const canonical = complete();
    const result = reduceVerificationActionProviderStateV2({
      ...canonical,
      terminalObservations: [terminalObservation(terminalFact(), true)]
    });
    expect(result.disposition).toBe('blocked');
    expect(result.reason).toContain('retained out');
  });

  test('duplicate origins and malformed or incomplete pagination fail closed', () => {
    expect(() => reduceVerificationActionProviderStateV2({
      ...complete(),
      startObservations: [startObservation(), startObservation()]
    })).toThrow('multiple immutable origins');

    const canonical = readback([]);
    expect(() => parseVerificationActionProviderStatusReadbackV2({
      ...canonical,
      paginationComplete: false
    })).toThrow('pagination');
    expect(() => parseVerificationActionProviderStatusReadbackV2({
      ...canonical,
      pageDigests: []
    })).toThrow();
  });
});
