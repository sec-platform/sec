import path from 'node:path';

import { sha256 } from '../../../contracts/canonical.ts';
import {
  assertSemanticOperationProjection,
  type BoundSemanticOperation
} from '../../../execution/operation/semantic.ts';
import { acquirePhysicalMutationLease } from '../physical/runtime/mutation-lease.ts';
import type { PhysicalDirectoryChain } from '../physical/runtime/physical-no-follow.ts';
import {
  RetainedRuntimeStateDirectoryError,
  openRetainedRuntimeStateDirectoryAtOwnerIssuedRoot,
  openRetainedWindowsRuntimeStateDirectory,
  type RetainedRuntimeStateDirectory
} from '../physical/runtime/retained-runtime-state-directory.ts';
import { resolveWindowsKnownFolderPath } from '../physical/runtime/windows-known-folders.ts';
import { resolveWorkspaceRuntimeRoots } from './paths.ts';

const EXTERNAL_PROVIDER_COORDINATION_CHILD_DESCRIPTOR = 60;
const MAXIMUM_EXTERNAL_PROVIDER_COORDINATION_DURATION_MS = 300_000;

export type ExternalProviderCoordinationLeaseFailureReason =
  | 'deadline-exhausted'
  | 'invalid-input'
  | 'path-unavailable'
  | 'settlement-unknown';

export class ExternalProviderCoordinationLeaseError extends Error {
  readonly reason: ExternalProviderCoordinationLeaseFailureReason;

  constructor(
    reason: ExternalProviderCoordinationLeaseFailureReason,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'ExternalProviderCoordinationLeaseError';
    this.reason = reason;
  }
}

export interface ExternalProviderCoordinationLease {
  readonly coordinationDigest: `sha256:${string}`;
  readonly deadlineAtUnixMs: number;
  readonly endpointIdentity: string;
  readonly operationIdentityDigest: `sha256:${string}`;
  readonly providerEpochDigest: `sha256:${string}`;
  readonly providerId: string;
}

export interface ExternalProviderCoordinationLeaseInput {
  readonly endpointIdentity: string;
  /** Correlation/budget projection only; Runtime State owns lease Effect admission. */
  readonly operation: BoundSemanticOperation;
  readonly providerId: string;
  readonly requirementId: string;
  readonly repositoryRoot: string;
}

export interface ExternalProviderCoordinationLeaseTestIssuer {
  readonly kind: 'external-provider-coordination-test-issuer';
}

const issuedExternalProviderCoordinationLeases = new WeakSet<object>();
const issuedExternalProviderCoordinationLeaseTestIssuers = new WeakSet<object>();

export function issueExternalProviderCoordinationLeaseTestIssuerForTests():
ExternalProviderCoordinationLeaseTestIssuer {
  const issuer = Object.freeze({
    kind: 'external-provider-coordination-test-issuer' as const
  });
  issuedExternalProviderCoordinationLeaseTestIssuers.add(issuer);
  return issuer;
}

export function assertExternalProviderCoordinationLease(
  lease: ExternalProviderCoordinationLease
): void {
  if (!issuedExternalProviderCoordinationLeases.has(lease)) {
    throw new ExternalProviderCoordinationLeaseError(
      'invalid-input',
      'External-provider coordination lease is not owner-issued.'
    );
  }
}

function boundedIdentity(value: unknown, label: string, maximumLength = 2_048): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength
      || value.trim() !== value || /[\u0000-\u001f]/u.test(value)) {
    throw new ExternalProviderCoordinationLeaseError(
      'invalid-input',
      `External-provider coordination ${label} is invalid.`
    );
  }
  return value;
}

function validateInput(
  input: ExternalProviderCoordinationLeaseInput
): Readonly<{
  deadlineAtUnixMs: number;
  endpointIdentity: string;
  operation: BoundSemanticOperation;
  operationIdentityDigest: `sha256:${string}`;
  providerEpochDigest: `sha256:${string}`;
  providerId: string;
  requirementId: string;
  repositoryRoot: string;
}> {
  try {
    assertSemanticOperationProjection(input.operation);
  } catch (error) {
    throw new ExternalProviderCoordinationLeaseError(
      'invalid-input',
      'External-provider coordination requires a canonical semantic operation projection.',
      { cause: error }
    );
  }
  const requirementId = boundedIdentity(input.requirementId, 'requirement id', 256);
  const requirement = input.operation.plan.execution.requirements.find(
    ({ id }) => id === requirementId
  );
  const binding = input.operation.bindings.find(
    ({ requirementId: candidate }) => candidate === requirementId
  );
  if (requirement === undefined || binding === undefined
      || binding.contractDigest !== requirement.contractDigest
      || !requirement.effectKinds.includes('filesystem')
      || !requirement.effectKinds.includes('provider')) {
    throw new ExternalProviderCoordinationLeaseError(
      'invalid-input',
      'External-provider coordination requires its exact filesystem/provider binding.'
    );
  }
  const durationBudget = input.operation.plan.execution.aggregateBudgets.find(
    ({ resource }) => resource === 'duration-ms'
  )?.maximum;
  if (durationBudget === undefined || !Number.isSafeInteger(durationBudget)
      || durationBudget < 1) {
    throw new ExternalProviderCoordinationLeaseError(
      'invalid-input',
      'External-provider coordination requires a positive duration budget.'
    );
  }
  const now = Date.now();
  const deadlineAtUnixMs = Math.min(
    input.operation.plan.attempt.deadlineAtUnixMs,
    now + Math.min(durationBudget, MAXIMUM_EXTERNAL_PROVIDER_COORDINATION_DURATION_MS)
  );
  if (!Number.isSafeInteger(deadlineAtUnixMs) || deadlineAtUnixMs <= now) {
    throw new ExternalProviderCoordinationLeaseError(
      'deadline-exhausted',
      'External-provider coordination deadline is exhausted.'
    );
  }
  const providerId = boundedIdentity(input.providerId, 'provider id', 128);
  if (!/^[a-z][a-z0-9.-]{0,127}$/u.test(providerId)) {
    throw new ExternalProviderCoordinationLeaseError(
      'invalid-input',
      'External-provider coordination provider id is noncanonical.'
    );
  }
  return Object.freeze({
    deadlineAtUnixMs,
    endpointIdentity: boundedIdentity(input.endpointIdentity, 'endpoint identity'),
    operation: input.operation,
    operationIdentityDigest: input.operation.plan.identity.identityDigest,
    providerEpochDigest: binding.providerIdentityDigest,
    providerId,
    requirementId,
    repositoryRoot: boundedIdentity(input.repositoryRoot, 'repository root')
  });
}

export function externalProviderCoordinationLeaseName(input: Readonly<{
  endpointIdentity: string;
  providerId: string;
}>): string {
  const providerId = boundedIdentity(input.providerId, 'provider id', 128);
  const endpointIdentity = boundedIdentity(input.endpointIdentity, 'endpoint identity');
  const coordinationKey = sha256({
    domain: 'sec.external-provider.coordination',
    endpointIdentity,
    providerId
  }).slice('sha256:'.length);
  return `provider-${coordinationKey}.lease.json`;
}

function externalProviderCoordinationSegments(input: Readonly<{
  localAppData: string;
  repositoryRoot: string;
}>): readonly string[] {
  const roots = resolveWorkspaceRuntimeRoots({
    environment: { LOCALAPPDATA: input.localAppData },
    repositoryRoot: input.repositoryRoot
  });
  const relativeStateRoot = path.win32.relative(input.localAppData, roots.stateRoot);
  const segments = relativeStateRoot.split(path.win32.sep).filter((segment) => segment.length > 0);
  if (segments.length === 0 || segments.some((segment) => segment === '..')) {
    throw new ExternalProviderCoordinationLeaseError(
      'invalid-input',
      'SEC external-provider coordination state root escapes its Known Folder owner.'
    );
  }
  return Object.freeze([...segments, 'external-providers']);
}

export function secUserExternalProviderCoordinationPath(input: Readonly<{
  localAppData: string;
  repositoryRoot: string;
}>): string {
  const { localAppData, repositoryRoot } = input;
  const canonicalRoot = path.win32.resolve(localAppData);
  if (!path.win32.isAbsolute(localAppData) || canonicalRoot !== localAppData) {
    throw new ExternalProviderCoordinationLeaseError(
      'invalid-input',
      'SEC external-provider coordination Known Folder path is noncanonical.'
    );
  }
  return path.win32.join(canonicalRoot, ...externalProviderCoordinationSegments({
    localAppData: canonicalRoot,
    repositoryRoot
  }));
}

async function withRetainedCoordinationDirectory<T>(
  retained: RetainedRuntimeStateDirectory,
  input: ReturnType<typeof validateInput>,
  operation: (lease: ExternalProviderCoordinationLease) => Promise<T>,
  testOnlyBeforeRecoveryAcknowledgement?: (leasePath: string) => void
): Promise<T | null> {
  const canonical = input;
  const coordinationDigest = sha256({
    domain: 'sec.external-provider.coordination.operation',
    endpointIdentity: canonical.endpointIdentity,
    boundAttemptDigest: canonical.operation.boundAttemptDigest,
    bindingDigest: canonical.operation.bindings.find(
      ({ requirementId }) => requirementId === canonical.requirementId
    )!.bindingDigest,
    deadlineAtUnixMs: canonical.deadlineAtUnixMs,
    operationIdentityDigest: canonical.operationIdentityDigest,
    providerEpochDigest: canonical.providerEpochDigest,
    providerId: canonical.providerId
  }) as `sha256:${string}`;
  let physicalLease: ReturnType<typeof acquirePhysicalMutationLease>;
  try {
    retained.assertCurrent();
    const remaining = canonical.deadlineAtUnixMs - Date.now();
    if (remaining < 1) {
      throw new ExternalProviderCoordinationLeaseError(
        'deadline-exhausted',
        'External-provider coordination deadline is exhausted before lease acquisition.'
      );
    }
    physicalLease = acquirePhysicalMutationLease(
      retained.directory,
      externalProviderCoordinationLeaseName(canonical),
      { ttlMs: remaining }
    );
  } catch (error) {
    try {
      retained.close();
    } catch (settlementError) {
      throw new ExternalProviderCoordinationLeaseError(
        'settlement-unknown',
        'External-provider coordination admission did not settle its retained directory.',
        { cause: new AggregateError([error, settlementError]) }
      );
    }
    if (error instanceof ExternalProviderCoordinationLeaseError) throw error;
    throw new ExternalProviderCoordinationLeaseError(
      'path-unavailable',
      'External-provider coordination lease path changed during admission.',
      { cause: error }
    );
  }
  if (physicalLease === null) {
    try {
      retained.close();
    } catch (error) {
      throw new ExternalProviderCoordinationLeaseError(
        'settlement-unknown',
        'External-provider coordination contender could not settle its retained directory.',
        { cause: error }
      );
    }
    return null;
  }
  let value: T | undefined;
  let operationFailure: unknown;
  let operationFailed = false;
  try {
    // Coordination owns exclusion only; provider state has its own durable identity.
    testOnlyBeforeRecoveryAcknowledgement?.(path.join(
      retained.path,
      externalProviderCoordinationLeaseName(canonical)
    ));
    physicalLease.acknowledgeReclaimedRecovery();
    const lease = Object.freeze({
      coordinationDigest,
      deadlineAtUnixMs: canonical.deadlineAtUnixMs,
      endpointIdentity: canonical.endpointIdentity,
      operationIdentityDigest: canonical.operationIdentityDigest,
      providerEpochDigest: canonical.providerEpochDigest,
      providerId: canonical.providerId
    });
    issuedExternalProviderCoordinationLeases.add(lease);
    value = await operation(lease);
  } catch (error) {
    operationFailure = error;
    operationFailed = true;
  }
  if (!operationFailed && Date.now() > canonical.deadlineAtUnixMs) {
    operationFailure = new ExternalProviderCoordinationLeaseError(
      'deadline-exhausted',
      'External-provider coordination operation exceeded its canonical deadline.'
    );
    operationFailed = true;
  }

  const settlementFailures: unknown[] = [];
  try {
    if (physicalLease.recoveryPending) physicalLease.restoreReclaimedOwner();
    else physicalLease.release();
  } catch (error) { settlementFailures.push(error); }
  try { retained.assertCurrent(); } catch (error) { settlementFailures.push(error); }
  try { retained.close(); } catch (error) { settlementFailures.push(error); }
  if (settlementFailures.length > 0) {
    if (operationFailed) settlementFailures.unshift(operationFailure);
    throw new ExternalProviderCoordinationLeaseError(
      'settlement-unknown',
      'External-provider coordination lease did not settle with exact physical identity.',
      {
        cause: settlementFailures.length === 1
          ? settlementFailures[0]
          : new AggregateError(settlementFailures)
      }
    );
  }
  if (operationFailed) throw operationFailure;
  return value as T;
}

/** Test/provider seam rooted in an already retained physical owner. */
export async function withExternalProviderCoordinationLeaseAtOwnerIssuedRoot<T>(input: Readonly<{
  coordination: ExternalProviderCoordinationLeaseInput;
  issuer: ExternalProviderCoordinationLeaseTestIssuer;
  operation: (lease: ExternalProviderCoordinationLease) => Promise<T>;
  root: PhysicalDirectoryChain;
  testOnlyBeforeRecoveryAcknowledgement?: (leasePath: string) => void;
}>): Promise<T | null> {
  if (!issuedExternalProviderCoordinationLeaseTestIssuers.has(input.issuer)) {
    throw new ExternalProviderCoordinationLeaseError(
      'invalid-input',
      'External-provider coordination test root requires its owner-issued test issuer.'
    );
  }
  const coordination = validateInput(input.coordination);
  const segments = externalProviderCoordinationSegments({
    localAppData: input.root.target.path,
    repositoryRoot: coordination.repositoryRoot
  });
  let retained: RetainedRuntimeStateDirectory;
  try {
    retained = openRetainedRuntimeStateDirectoryAtOwnerIssuedRoot({
      childDescriptor: EXTERNAL_PROVIDER_COORDINATION_CHILD_DESCRIPTOR,
      mode: 'create-or-open',
      root: input.root,
      segments
    });
  } catch (error) {
    throw new ExternalProviderCoordinationLeaseError(
      'path-unavailable',
      'External-provider coordination Runtime State path is unavailable.',
      { cause: error }
    );
  }
  return await withRetainedCoordinationDirectory(
    retained,
    coordination,
    input.operation,
    input.testOnlyBeforeRecoveryAcknowledgement
  );
}

/**
 * Coordinates one user-level provider operation across all SEC workspaces.
 * The current token's Known Folder is read from the OS; ambient LOCALAPPDATA
 * and provider-owned directories never participate in SEC lease placement.
 */
export async function withUserExternalProviderCoordinationLease<T>(input: Readonly<{
  coordination: ExternalProviderCoordinationLeaseInput;
  operation: (lease: ExternalProviderCoordinationLease) => Promise<T>;
}>): Promise<T | null> {
  const coordination = validateInput(input.coordination);
  let retained: RetainedRuntimeStateDirectory | null = null;
  try {
    const localAppData = await resolveWindowsKnownFolderPath('local-app-data');
    const segments = externalProviderCoordinationSegments({
      localAppData,
      repositoryRoot: coordination.repositoryRoot
    });
    retained = await openRetainedWindowsRuntimeStateDirectory({
      childDescriptor: EXTERNAL_PROVIDER_COORDINATION_CHILD_DESCRIPTOR,
      folder: 'local-app-data',
      mode: 'create-or-open',
      segments
    });
    if (retained.root.path !== localAppData || retained.path !== secUserExternalProviderCoordinationPath({
      localAppData: retained.root.path,
      repositoryRoot: coordination.repositoryRoot
    })) {
      throw new Error('SEC external-provider coordination path derivation changed.');
    }
  } catch (error) {
    if (retained !== null) {
      try {
        retained.close();
      } catch (settlementError) {
        throw new ExternalProviderCoordinationLeaseError(
          'settlement-unknown',
          'SEC user-level coordination admission did not settle its retained directory.',
          { cause: new AggregateError([error, settlementError]) }
        );
      }
    }
    if (error instanceof ExternalProviderCoordinationLeaseError) throw error;
    throw new ExternalProviderCoordinationLeaseError(
      'path-unavailable',
      'SEC user-level external-provider coordination Runtime State is unavailable.',
      { cause: error }
    );
  }
  try {
    return await withRetainedCoordinationDirectory(
      retained,
      coordination,
      input.operation
    );
  } catch (error) {
    if (error instanceof RetainedRuntimeStateDirectoryError) {
      throw new ExternalProviderCoordinationLeaseError(
        'path-unavailable',
        'SEC user-level external-provider coordination Runtime State changed.',
        { cause: error }
      );
    }
    throw error;
  }
}
