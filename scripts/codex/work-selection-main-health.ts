import path from 'node:path';

import { rawSha256, sha256 } from '../../platform/shared/canonical-primitives.ts';
import {
  createMainHealthLedgerV1,
  resolveOrdinaryMainHealthLaneV1,
  type MainHealthLedgerV1
} from '../../platform/shared/main-health-contract.ts';
import {
  compileMainHealthRepairDecisionV1,
  type MainHealthRepairDecisionV1,
  type MainHealthRepairObservationV1
} from '../../platform/shared/main-health-repair-contract.ts';
import {
  inspectExactNoFollowDirectoryPresenceV1,
  PhysicalNoFollowError,
  readNoFollowOrdinaryFileV1
} from '../../platform/shared/physical-no-follow.ts';
import { encodeVerificationActionDataV2 } from '../../platform/shared/verification-action-contract.ts';
import type {
  SecCurrentWorkLifecycleV1,
  SecWorkDigestV1
} from '../../platform/shared/work-selection-contract.ts';
import { resolveSecRuntimeStateForRepositoryV1 } from '../../tooling/sec-dev/runtime-state-paths.ts';
import {
  createRegisteredHostedMainHealthInputsV1,
  createTrustedLocalMainHealthInputV1,
  TRUSTED_LOCAL_MAIN_HEALTH_FRESHNESS_MS_V1
} from './main-health-observation.ts';
import { parseTrustedRuntimeMainHealthReceiptV2 } from './trusted-runtime-container.ts';
import {
  classifyGitHubObservationFailureV1,
  createVerificationSessionGitHubClientV1,
  type GitHubCheckObservationV1
} from './verification-session-github.ts';

const WORK_SELECTION_MAIN_HEALTH_PROVIDER_SCHEMA_V1 =
  'sec-work-selection-main-health-providers-v1' as const;

export type WorkSelectionMainHealthProviderObservationV1 =
  | Readonly<{ kind: 'available'; ledger: MainHealthLedgerV1 }>
  | Readonly<{ kind: 'absent' }>
  | Readonly<{ kind: 'unavailable'; ref: SecWorkDigestV1 }>
  | Readonly<{ kind: 'invalid'; ref: SecWorkDigestV1 }>;

type HostedMainHealthObservationV1 =
  | Readonly<{ kind: 'observed'; checks: readonly GitHubCheckObservationV1[] }>
  | Readonly<{ kind: 'unavailable'; ref: SecWorkDigestV1 }>
  | Readonly<{ kind: 'invalid'; ref: SecWorkDigestV1 }>;

export type WorkSelectionMainHealthProjectionV1 = Readonly<{
  state: SecCurrentWorkLifecycleV1['mainHealthState'];
  ref: SecWorkDigestV1;
}>;

function digestRef(value: unknown): SecWorkDigestV1 {
  return sha256(value) as SecWorkDigestV1;
}

function invalidRef(label: string, value: Uint8Array | string): SecWorkDigestV1 {
  return digestRef(Object.freeze({
    schema: WORK_SELECTION_MAIN_HEALTH_PROVIDER_SCHEMA_V1,
    label,
    valueDigest: rawSha256(value)
  }));
}

function decodeExactUtf8(bytes: Uint8Array): string {
  const source = Buffer.from(bytes);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(source);
  if (!Buffer.from(text, 'utf8').equals(source)) {
    throw new Error('trusted local MainHealth receipt is not exact UTF-8');
  }
  return text;
}

function projectLedger(input: Readonly<{
  ledger: MainHealthLedgerV1;
  now: string;
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
}>): WorkSelectionMainHealthProjectionV1 {
  const decision = resolveOrdinaryMainHealthLaneV1({
    ledger: input.ledger,
    now: input.now,
    expectedRepository: input.repository,
    expectedDefaultBranch: input.defaultBranch,
    expectedMainSha: input.mainSha,
    expectedMainTreeSha: input.mainTreeSha,
    expectedTrustRevision: input.mainSha
  });
  const state: SecCurrentWorkLifecycleV1['mainHealthState'] =
    decision.observationValidity === 'invalid' || decision.ledger === null
      ? 'unresolved'
      : input.ledger.status === 'degraded'
        ? 'unhealthy'
        : input.ledger.status === 'healthy' && decision.allowed
          ? 'healthy'
          : 'unresolved';
  return Object.freeze({
    state,
    ref: input.ledger.healthRevision as SecWorkDigestV1
  });
}

function observeTrustedLocalProvider(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  now: string;
}>): WorkSelectionMainHealthProviderObservationV1 {
  let receiptBytes: Uint8Array | null = null;
  try {
    const layout = resolveSecRuntimeStateForRepositoryV1({
      repository: input.repository,
      repositoryRoot: input.repositoryRoot
    });
    const root = path.join(layout.repositoryStateRoot, 'trusted-main-health', 'v1');
    const presence = inspectExactNoFollowDirectoryPresenceV1(
      root,
      'WorkSelection trusted MainHealth root'
    );
    if (presence.state === 'absent') return Object.freeze({ kind: 'absent' });
    receiptBytes = readNoFollowOrdinaryFileV1(
      presence.directory.target,
      `main-${input.mainSha}.json`
    );
    if (receiptBytes === null) return Object.freeze({ kind: 'absent' });

    const receipt = parseTrustedRuntimeMainHealthReceiptV2(decodeExactUtf8(receiptBytes));
    const canonicalReceiptBytes = Buffer.from(
      `${encodeVerificationActionDataV2(receipt)}\n`,
      'utf8'
    );
    if (!Buffer.from(receiptBytes).equals(canonicalReceiptBytes)) {
      return Object.freeze({
        kind: 'invalid',
        ref: invalidRef('trusted-local-noncanonical-bytes', receiptBytes)
      });
    }
    if (receipt.repository !== input.repository
        || receipt.mainSha !== input.mainSha
        || receipt.mainTreeSha !== input.mainTreeSha) {
      return Object.freeze({
        kind: 'invalid',
        ref: invalidRef('trusted-local-subject-mismatch', receiptBytes)
      });
    }
    const nowMs = Date.parse(input.now);
    const receiptObservedAtMs = Date.parse(receipt.observedAt);
    if (!Number.isFinite(receiptObservedAtMs) || !Number.isFinite(nowMs)
        || receiptObservedAtMs > nowMs) {
      return Object.freeze({
        kind: 'invalid',
        ref: invalidRef('trusted-local-time-invalid', receiptBytes)
      });
    }
    // The physical receipt is immutable exact-subject Evidence. Freshness
    // belongs to this read observation, so an unchanged main never needs the
    // four commands rerun merely because wall time advanced.
    const expiresAtMs = nowMs + TRUSTED_LOCAL_MAIN_HEALTH_FRESHNESS_MS_V1;
    const expiresAt = new Date(expiresAtMs).toISOString();
    return Object.freeze({
      kind: 'available',
      ledger: createMainHealthLedgerV1(createTrustedLocalMainHealthInputV1({
        schema: 'sec-trusted-local-main-health-observation-v1',
        repository: input.repository,
        mainSha: input.mainSha,
        mainTreeSha: input.mainTreeSha,
        trustRevision: input.mainSha,
        runtimeRef: `trusted-main-health-receipt:${receipt.receiptDigest}`,
        executionId: receipt.executionId,
        verificationReceiptDigest: receipt.receiptDigest,
        observedAt: input.now,
        expiresAt
      }))
    });
  } catch (error) {
    if (error instanceof PhysicalNoFollowError
        && error.code === 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE') {
      return Object.freeze({ kind: 'absent' });
    }
    return Object.freeze({
      kind: 'invalid',
      ref: invalidRef(
        'trusted-local-observation-invalid',
        receiptBytes ?? (error instanceof Error ? error.message : String(error))
      )
    });
  }
}

function observeHostedProvider(input: Readonly<{
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  now: string;
  expiresAt: string;
  observation: HostedMainHealthObservationV1;
}>): WorkSelectionMainHealthProviderObservationV1 {
  if (input.observation.kind === 'invalid') return input.observation;
  if (input.observation.kind === 'unavailable') return input.observation;
  const checks = input.observation.checks;
  const ledgers = createRegisteredHostedMainHealthInputsV1({
    repository: input.repository,
    mainSha: input.mainSha,
    mainTreeSha: input.mainTreeSha,
    trustRevision: input.mainSha,
    observedAt: input.now,
    expiresAt: input.expiresAt,
    sourceRef: `github-check-runs:${input.repository}@${input.mainSha}`,
    checks
  }).map((ledgerInput) => createMainHealthLedgerV1(ledgerInput));
  if (ledgers.length === 0) return Object.freeze({ kind: 'absent' });
  if (ledgers.some((ledger) => ledger.status === 'locked')
      || new Set(ledgers.map((ledger) => ledger.healthRevision)).size !== 1) {
    return Object.freeze({
      kind: 'invalid',
      ref: digestRef(Object.freeze({
        schema: WORK_SELECTION_MAIN_HEALTH_PROVIDER_SCHEMA_V1,
        status: 'hosted-provider-invalid-or-conflicting',
        healthRevisions: ledgers.map((ledger) => ledger.healthRevision).sort()
      }))
    });
  }
  return Object.freeze({ kind: 'available', ledger: ledgers[0]! });
}

export type CanonicalMainHealthProviderResolutionV1 = Readonly<{
  projection: WorkSelectionMainHealthProjectionV1;
  ledger: MainHealthLedgerV1 | null;
  repairObservation: MainHealthRepairObservationV1;
}>;

export function resolveWorkSelectionMainHealthProvidersV1(input: Readonly<{
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
  now: string;
  local: WorkSelectionMainHealthProviderObservationV1;
  hosted: WorkSelectionMainHealthProviderObservationV1;
}>): CanonicalMainHealthProviderResolutionV1 {
  if (input.local.kind === 'invalid' || input.hosted.kind === 'invalid') {
    const ref = digestRef(Object.freeze({
      schema: WORK_SELECTION_MAIN_HEALTH_PROVIDER_SCHEMA_V1,
      status: 'provider-invalid',
      local: input.local.kind === 'invalid' ? input.local.ref : input.local.kind,
      hosted: input.hosted.kind === 'invalid' ? input.hosted.ref : input.hosted.kind
    }));
    return Object.freeze({
      projection: Object.freeze({
        state: 'unresolved',
        ref
      }),
      ledger: null,
      repairObservation: Object.freeze({ kind: 'provider-invalid', observationRef: ref })
    });
  }

  const localLedger = input.local.kind === 'available' ? input.local.ledger : null;
  const hostedLedger = input.hosted.kind === 'available' ? input.hosted.ledger : null;
  if (localLedger !== null && hostedLedger !== null
      && localLedger.healthRevision !== hostedLedger.healthRevision) {
    const ref = digestRef(Object.freeze({
      schema: WORK_SELECTION_MAIN_HEALTH_PROVIDER_SCHEMA_V1,
      status: 'provider-conflict',
      localHealthRevision: localLedger.healthRevision,
      hostedHealthRevision: hostedLedger.healthRevision
    }));
    return Object.freeze({
      projection: Object.freeze({
        state: 'unresolved',
        ref
      }),
      ledger: null,
      repairObservation: Object.freeze({ kind: 'provider-conflict', observationRef: ref })
    });
  }

  const selected = localLedger ?? hostedLedger;
  if (selected !== null) {
    return Object.freeze({
      projection: projectLedger({
        ledger: selected,
        now: input.now,
        repository: input.repository,
        defaultBranch: input.defaultBranch,
        mainSha: input.mainSha,
        mainTreeSha: input.mainTreeSha
      }),
      ledger: selected,
      repairObservation: Object.freeze({ kind: 'available', ledger: selected })
    });
  }

  const ref = digestRef(Object.freeze({
    schema: WORK_SELECTION_MAIN_HEALTH_PROVIDER_SCHEMA_V1,
    status: 'provider-missing-or-unavailable',
    local: input.local.kind,
    hosted: input.hosted.kind,
    hostedRef: input.hosted.kind === 'unavailable' ? input.hosted.ref : null,
    repository: input.repository,
    defaultBranch: input.defaultBranch,
    mainSha: input.mainSha,
    mainTreeSha: input.mainTreeSha
  }));
  const unavailable = input.local.kind === 'unavailable' || input.hosted.kind === 'unavailable';
  return Object.freeze({
    projection: Object.freeze({
      state: 'unresolved',
      ref
    }),
    ledger: null,
    repairObservation: Object.freeze({
      kind: unavailable ? 'provider-unavailable' : 'provider-missing',
      observationRef: ref
    })
  });
}

function observeHostedMainHealthChecksV1(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  mainSha: string;
}>): HostedMainHealthObservationV1 {
  try {
    const checks = createVerificationSessionGitHubClientV1(input.repositoryRoot)
      .observeChecks(input.repository, input.mainSha);
    return Object.freeze({ kind: 'observed', checks: Object.freeze([...checks]) });
  } catch (error) {
    const failure = classifyGitHubObservationFailureV1(error);
    if (failure.kind === 'provider-invalid') {
      return Object.freeze({
        kind: 'invalid',
        ref: failure.responseDigest as SecWorkDigestV1
      });
    }
    return Object.freeze({
      kind: 'unavailable',
      ref: invalidRef(
        'hosted-main-health-transport-unavailable',
        `${input.repository}\n${input.mainSha}\n${failure.diagnostic}`
      )
    });
  }
}

function observeCanonicalMainHealthProvidersV1(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
}>): Readonly<{ observedAt: string; resolution: CanonicalMainHealthProviderResolutionV1 }> {
  const observedAt = new Date().toISOString();
  const hostedExpiresAt = new Date(
    Date.parse(observedAt) + TRUSTED_LOCAL_MAIN_HEALTH_FRESHNESS_MS_V1
  ).toISOString();
  const hosted = observeHostedMainHealthChecksV1({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    mainSha: input.mainSha
  });
  const resolution = resolveWorkSelectionMainHealthProvidersV1({
    repository: input.repository,
    defaultBranch: input.defaultBranch,
    mainSha: input.mainSha,
    mainTreeSha: input.mainTreeSha,
    now: observedAt,
    local: observeTrustedLocalProvider({
      repositoryRoot: input.repositoryRoot,
      repository: input.repository,
      mainSha: input.mainSha,
      mainTreeSha: input.mainTreeSha,
      now: observedAt
    }),
    hosted: observeHostedProvider({
      repository: input.repository,
      mainSha: input.mainSha,
      mainTreeSha: input.mainTreeSha,
      now: observedAt,
      expiresAt: hostedExpiresAt,
      observation: hosted
    })
  });
  return Object.freeze({ observedAt, resolution });
}

export function observeCanonicalMainHealthForWorkSelectionV1(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
}>): WorkSelectionMainHealthProjectionV1 {
  return observeCanonicalMainHealthProvidersV1(input).resolution.projection;
}

export function observeCanonicalMainHealthForRepairV1(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
}>): MainHealthRepairDecisionV1 {
  const observation = observeCanonicalMainHealthProvidersV1(input);
  return compileMainHealthRepairDecisionV1({
    observation: observation.resolution.repairObservation,
    now: observation.observedAt,
    expectedRepository: input.repository,
    expectedDefaultBranch: input.defaultBranch,
    expectedMainSha: input.mainSha,
    expectedMainTreeSha: input.mainTreeSha,
    expectedTrustRevision: input.mainSha
  });
}
