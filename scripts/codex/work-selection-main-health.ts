import path from 'node:path';

import { rawSha256, sha256 } from '../../platform/shared/canonical-primitives.ts';
import {
  createMainHealthLedgerV1,
  resolveOrdinaryMainHealthLaneV1,
  type MainHealthLedgerV1
} from '../../platform/shared/main-health-contract.ts';
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
  createObservedMainHealthInputV1,
  createTrustedLocalMainHealthInputV1,
  GITHUB_ACTIONS_MAIN_HEALTH_CHECK_PROVIDER_POLICY_V1,
  TRUSTED_LOCAL_MAIN_HEALTH_FRESHNESS_MS_V1
} from './main-health-observation.ts';
import { parseTrustedRuntimeMainHealthReceiptV1 } from './trusted-runtime-container.ts';
import type { GitHubCheckObservationV1 } from './verification-session-github.ts';

const WORK_SELECTION_MAIN_HEALTH_PROVIDER_SCHEMA_V1 =
  'sec-work-selection-main-health-providers-v1' as const;

type ProviderObservationV1 =
  | Readonly<{ kind: 'available'; ledger: MainHealthLedgerV1 }>
  | Readonly<{ kind: 'absent' }>
  | Readonly<{ kind: 'unavailable'; ref: SecWorkDigestV1 }>
  | Readonly<{ kind: 'invalid'; ref: SecWorkDigestV1 }>;

export type HostedMainHealthObservationV1 =
  | Readonly<{ kind: 'observed'; checks: readonly GitHubCheckObservationV1[] }>
  | Readonly<{ kind: 'unavailable'; ref: SecWorkDigestV1 }>;

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
  environment?: NodeJS.ProcessEnv;
}>): ProviderObservationV1 {
  let receiptBytes: Uint8Array | null = null;
  try {
    const layout = resolveSecRuntimeStateForRepositoryV1({
      repository: input.repository,
      repositoryRoot: input.repositoryRoot,
      ...(input.environment === undefined ? {} : { environment: input.environment })
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

    const receipt = parseTrustedRuntimeMainHealthReceiptV1(decodeExactUtf8(receiptBytes));
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
}>): ProviderObservationV1 {
  if (input.observation.kind === 'unavailable') return input.observation;
  const checks = input.observation.checks;
  const context = GITHUB_ACTIONS_MAIN_HEALTH_CHECK_PROVIDER_POLICY_V1.context;
  const providerPresent = checks.some((check) => (
    check.headSha === input.mainSha && check.name === context
  ));
  if (!providerPresent) return Object.freeze({ kind: 'absent' });

  const ledger = createMainHealthLedgerV1(createObservedMainHealthInputV1({
    repository: input.repository,
    mainSha: input.mainSha,
    mainTreeSha: input.mainTreeSha,
    trustRevision: input.mainSha,
    observedAt: input.now,
    expiresAt: input.expiresAt,
    sourceRunId: `work-selection-${input.mainSha}`,
    sourceRef: `github-check-runs:${input.repository}@${input.mainSha}`,
    checks
  }));
  if (ledger.status === 'locked') {
    return Object.freeze({
      kind: 'invalid',
      ref: ledger.healthRevision as SecWorkDigestV1
    });
  }
  return Object.freeze({ kind: 'available', ledger });
}

export function resolveWorkSelectionMainHealthProvidersV1(input: Readonly<{
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
  now: string;
  local: ProviderObservationV1;
  hosted: ProviderObservationV1;
}>): WorkSelectionMainHealthProjectionV1 {
  if (input.local.kind === 'invalid' || input.hosted.kind === 'invalid') {
    return Object.freeze({
      state: 'unresolved',
      ref: digestRef(Object.freeze({
        schema: WORK_SELECTION_MAIN_HEALTH_PROVIDER_SCHEMA_V1,
        status: 'provider-invalid',
        local: input.local.kind === 'invalid' ? input.local.ref : input.local.kind,
        hosted: input.hosted.kind === 'invalid' ? input.hosted.ref : input.hosted.kind
      }))
    });
  }

  const localLedger = input.local.kind === 'available' ? input.local.ledger : null;
  const hostedLedger = input.hosted.kind === 'available' ? input.hosted.ledger : null;
  if (localLedger !== null && hostedLedger !== null
      && localLedger.healthRevision !== hostedLedger.healthRevision) {
    return Object.freeze({
      state: 'unresolved',
      ref: digestRef(Object.freeze({
        schema: WORK_SELECTION_MAIN_HEALTH_PROVIDER_SCHEMA_V1,
        status: 'provider-conflict',
        localHealthRevision: localLedger.healthRevision,
        hostedHealthRevision: hostedLedger.healthRevision
      }))
    });
  }

  const selected = localLedger ?? hostedLedger;
  if (selected !== null) {
    return projectLedger({
      ledger: selected,
      now: input.now,
      repository: input.repository,
      defaultBranch: input.defaultBranch,
      mainSha: input.mainSha,
      mainTreeSha: input.mainTreeSha
    });
  }

  return Object.freeze({
    state: 'unresolved',
    ref: digestRef(Object.freeze({
      schema: WORK_SELECTION_MAIN_HEALTH_PROVIDER_SCHEMA_V1,
      status: 'provider-missing-or-unavailable',
      local: input.local.kind,
      hosted: input.hosted.kind,
      hostedRef: input.hosted.kind === 'unavailable' ? input.hosted.ref : null,
      repository: input.repository,
      defaultBranch: input.defaultBranch,
      mainSha: input.mainSha,
      mainTreeSha: input.mainTreeSha
    }))
  });
}

export function observeCanonicalWorkSelectionMainHealthV1(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
  now: string;
  hostedExpiresAt: string;
  hosted: HostedMainHealthObservationV1;
  runtimeStateEnvironment?: NodeJS.ProcessEnv;
}>): WorkSelectionMainHealthProjectionV1 {
  return resolveWorkSelectionMainHealthProvidersV1({
    repository: input.repository,
    defaultBranch: input.defaultBranch,
    mainSha: input.mainSha,
    mainTreeSha: input.mainTreeSha,
    now: input.now,
    local: observeTrustedLocalProvider({
      repositoryRoot: input.repositoryRoot,
      repository: input.repository,
      mainSha: input.mainSha,
      mainTreeSha: input.mainTreeSha,
      now: input.now,
      ...(input.runtimeStateEnvironment === undefined
        ? {}
        : { environment: input.runtimeStateEnvironment })
    }),
    hosted: observeHostedProvider({
      repository: input.repository,
      mainSha: input.mainSha,
      mainTreeSha: input.mainTreeSha,
      now: input.now,
      expiresAt: input.hostedExpiresAt,
      observation: input.hosted
    })
  });
}

export function observeHostedMainHealthChecksV1(input: Readonly<{
  repository: string;
  mainSha: string;
  observeChecks: () => readonly GitHubCheckObservationV1[];
}>): HostedMainHealthObservationV1 {
  try {
    return Object.freeze({ kind: 'observed', checks: Object.freeze([...input.observeChecks()]) });
  } catch (error) {
    const diagnostic = error instanceof Error
      ? `${error.name}:${error.message}`
      : `${typeof error}:${String(error)}`;
    return Object.freeze({
      kind: 'unavailable',
      ref: invalidRef(
        'hosted-main-health-transport-unavailable',
        `${input.repository}\n${input.mainSha}\n${diagnostic}`
      )
    });
  }
}
