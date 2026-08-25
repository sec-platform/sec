import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';

import { sha256 } from '../../platform/shared/canonical-primitives.ts';
import {
  acquireEnvironmentDependencyCacheConsumerV2,
  beginEnvironmentDependencyCacheMaterializationV2,
  createEnvironmentDependencyCacheBirthV2,
  createEnvironmentDependencyCacheHandleV1,
  createEnvironmentDependencyCacheSettlementV2,
  parseEnvironmentDependencyCacheIdentityV1,
  parseEnvironmentDependencyCacheSettlementV2,
  parseEnvironmentDependencyCacheStateV2,
  recoverEnvironmentDependencyCacheConsumerV2,
  recoverEnvironmentDependencyCacheMaterializationV2,
  reduceEnvironmentDependencyCachePublishedStateV2,
  releaseEnvironmentDependencyCacheConsumerV2,
  transitionEnvironmentDependencyCacheTerminalV2,
  type EnvironmentDependencyCacheHandleV1,
  type EnvironmentDependencyCacheIdentityV1,
  type EnvironmentDependencyCacheSettlementV2,
  type EnvironmentDependencyCacheStateV2
} from '../../platform/shared/environment-materialization-contract.ts';
import { acquirePhysicalMutationLeaseV1 } from '../../platform/shared/physical-mutation-lease.ts';
import {
  deleteRetainedNoFollowEntryV1,
  inspectNoFollowDirectoryChildV1,
  inspectNoFollowOrdinaryFileDigestV1,
  scanNoFollowDirectoryTreeMetadataV1
} from '../../platform/shared/physical-no-follow.ts';
import {
  resolveSecRuntimeDependencyCacheLocatorsV2,
  type SecRuntimeDependencyCacheLocatorsV2
} from '../../platform/shared/sec-runtime-state-contract.ts';
import {
  acquireSecRuntimeCachePhysicalAuthorityV1,
  acquireSecRuntimeStatePhysicalAuthorityV1
} from './runtime-state-authority.ts';
import { createRuntimeStateJournalFileSystemV1 } from './runtime-state-journal-filesystem.ts';
import { resolveSecRuntimeStateForRepositoryV1 } from './runtime-state-paths.ts';

export const ENVIRONMENT_DEPENDENCY_CACHE_LIFECYCLE_POLICY_V2 = Object.freeze({
  schema: 'sec-environment-dependency-cache-lifecycle-policy-v2',
  ownerLeaseMilliseconds: 15 * 60 * 1_000,
  maxEntries: 32,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
  maxStateRecords: 256,
  maxPhysicalInventoryEntries: 256,
  maxPhysicalOverheadBytes: 32 * 1024 * 1024
});

export interface EnvironmentDependencyCacheLifecycleV2 {
  readonly locators: SecRuntimeDependencyCacheLocatorsV2;
  current(): EnvironmentDependencyCacheStateV2;
  beginMaterialization(now?: string): EnvironmentDependencyCacheStateV2;
  recoverMaterialization(now?: string): EnvironmentDependencyCacheStateV2;
  publishPhysical(input: Readonly<{
    sourceSnapshotDigest: string;
    archiveProjectionDigest: string;
    now?: string;
  }>): EnvironmentDependencyCacheStateV2;
  acquire(input: Readonly<{
    consumerId: string;
    now?: string;
  }>): Readonly<{
    current: EnvironmentDependencyCacheStateV2;
    handle: EnvironmentDependencyCacheHandleV1;
  }>;
  recoverDeadConsumers(now?: string): Readonly<{
    current: EnvironmentDependencyCacheStateV2;
    recoveredConsumerIds: readonly string[];
  }>;
  release(input: Readonly<{
    consumerId: string;
    acquireCredentialDigest: string;
    now?: string;
  }>): Readonly<{
    current: EnvironmentDependencyCacheStateV2;
    releaseCredentialDigest: `sha256:${string}`;
  }>;
  retire(input?: Readonly<{
    now?: string;
    expectedResourceId?: `sha256:${string}`;
    expectedStateDigest?: `sha256:${string}`;
  }>): EnvironmentDependencyCacheSettlementV2;
}

function canonicalNow(value?: string): string {
  const now = value ?? new Date().toISOString();
  if (new Date(now).toISOString() !== now) {
    throw new Error('Environment dependency cache lifecycle time is not canonical ISO time.');
  }
  return now;
}

function encodeState(state: EnvironmentDependencyCacheStateV2): string {
  return `${JSON.stringify(parseEnvironmentDependencyCacheStateV2(state))}\n`;
}

type LocalLinuxProcessIdentityV1 = Readonly<{
  host: string;
  bootId: string;
  pid: number;
  processStartTicks: string;
}>;

function linuxBootIdV1(): string {
  const bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim().toLowerCase();
  if (!/^[0-9a-f-]{36}$/u.test(bootId)) {
    throw new Error('typed-block:dependency-cache-linux-boot-identity-invalid');
  }
  return bootId;
}

function linuxProcessStartTicksV1(pid: number): string | null {
  let source: string;
  try {
    source = readFileSync(`/proc/${pid}/stat`, 'utf8');
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error &&
        (error.code === 'ENOENT' || error.code === 'ESRCH')) return null;
    throw new Error('typed-block:dependency-cache-process-liveness-unknown');
  }
  const commandEnd = source.lastIndexOf(') ');
  const fields = commandEnd < 0 ? [] : source.slice(commandEnd + 2).trim().split(/\s+/u);
  const processStartTicks = fields[19];
  if (processStartTicks === undefined || !/^\d+$/u.test(processStartTicks)) {
    throw new Error('typed-block:dependency-cache-process-identity-invalid');
  }
  return processStartTicks;
}

function currentLinuxProcessIdentityV1(): LocalLinuxProcessIdentityV1 {
  const processStartTicks = linuxProcessStartTicksV1(process.pid);
  if (processStartTicks === null) {
    throw new Error('typed-block:dependency-cache-current-process-identity-absent');
  }
  return Object.freeze({
    host: hostname(),
    bootId: linuxBootIdV1(),
    pid: process.pid,
    processStartTicks
  });
}

function observeLocalLinuxOwnerDeathV1(
  owner: Readonly<{
    ownerHost: string;
    ownerBootId: string;
    ownerPid: number;
    ownerProcessStartTicks: string;
  }>,
  observer: LocalLinuxProcessIdentityV1
): Readonly<{
  reason: 'host-boot-replaced' | 'process-absent' | 'process-identity-replaced';
  observedProcessStartTicks: string | null;
}> {
  if (owner.ownerHost !== observer.host) {
    throw new Error('typed-block:dependency-cache-owner-remote-liveness-unknown');
  }
  if (owner.ownerBootId !== observer.bootId) {
    return Object.freeze({ reason: 'host-boot-replaced', observedProcessStartTicks: null });
  }
  const observedProcessStartTicks = linuxProcessStartTicksV1(owner.ownerPid);
  if (observedProcessStartTicks === null) {
    return Object.freeze({ reason: 'process-absent', observedProcessStartTicks });
  }
  if (observedProcessStartTicks !== owner.ownerProcessStartTicks) {
    return Object.freeze({ reason: 'process-identity-replaced', observedProcessStartTicks });
  }
  throw new Error('typed-block:dependency-cache-expired-owner-alive');
}

function readState(
  readText: (filePath: string) => string,
  filePath: string
): EnvironmentDependencyCacheStateV2 {
  return parseEnvironmentDependencyCacheStateV2(readText(filePath));
}

/**
 * Opens the one repository-scoped Runtime/Dependency semantic owner.  It
 * publishes immutable birth and mutable current in durable Runtime State
 * before the caller is allowed to acquire disposable Runtime Cache authority
 * or execute Bun/archive Effects.
 */
export async function openEnvironmentDependencyCacheLifecycleV2(input: Readonly<{
  repository: string;
  repositoryRoot: string;
  identity: EnvironmentDependencyCacheIdentityV1;
  providerRevision: string;
  platform: 'linux/amd64';
  now?: string;
  environment?: NodeJS.ProcessEnv;
}>): Promise<EnvironmentDependencyCacheLifecycleV2> {
  if (input.platform !== 'linux/amd64' || process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error('typed-block:dependency-cache-provider-platform-mismatch');
  }
  if (!/^[^/\s]+\/[^/\s]+$/u.test(input.repository)) {
    throw new Error('Environment dependency cache repository identity is invalid.');
  }
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const identity = parseEnvironmentDependencyCacheIdentityV1(input.identity);
  const createdAt = canonicalNow(input.now);
  const lifecycleOwner = currentLinuxProcessIdentityV1();
  const birth = createEnvironmentDependencyCacheBirthV2({
    identity,
    providerRevision: input.providerRevision,
    createdAt,
    leaseExpiresAt: new Date(
      Date.parse(createdAt) + ENVIRONMENT_DEPENDENCY_CACHE_LIFECYCLE_POLICY_V2.ownerLeaseMilliseconds
    ).toISOString(),
    maxEntries: ENVIRONMENT_DEPENDENCY_CACHE_LIFECYCLE_POLICY_V2.maxEntries,
    maxTotalBytes: ENVIRONMENT_DEPENDENCY_CACHE_LIFECYCLE_POLICY_V2.maxTotalBytes,
    owner: lifecycleOwner
  });
  const layout = resolveSecRuntimeStateForRepositoryV1({
    repository: input.repository,
    repositoryRoot,
    ...(input.environment === undefined ? {} : { environment: input.environment })
  });
  const birthLocators = resolveSecRuntimeDependencyCacheLocatorsV2({
    layout,
    identityDigest: identity.identityDigest,
    resourceId: birth.resourceId
  });
  let locators = birthLocators;
  // Only durable state roots are materialized here.  The disposable cache
  // entry remains absent until birth/current readback has succeeded.
  const authority = await acquireSecRuntimeStatePhysicalAuthorityV1({
    repositoryRoot,
    stateRoot: layout.stateRoot,
    cacheRoot: layout.cacheRoot,
    requiredDirectories: [
      layout.repositoryStateRoot,
      layout.dependencyCacheRegistrationRoot,
      layout.dependencyCacheCurrentRoot,
      layout.dependencyCacheSettlementRoot,
      layout.dependencyCacheObjectRoot
    ]
  });
  await authority.assertCurrent();
  const fileSystem = createRuntimeStateJournalFileSystemV1(
    authority.directory(layout.repositoryStateRoot)
  );
  const birthText = encodeState(birth);
  const currentExists = fileSystem.exists(locators.currentPath);
  let registration: EnvironmentDependencyCacheStateV2;
  let pendingRebirth: Readonly<{
    state: EnvironmentDependencyCacheStateV2;
    text: string;
    locators: SecRuntimeDependencyCacheLocatorsV2;
  }> | null = null;
  if (currentExists) {
    const observedCurrentText = fileSystem.readText(locators.currentPath);
    const observedCurrent = parseEnvironmentDependencyCacheStateV2(observedCurrentText);
    locators = resolveSecRuntimeDependencyCacheLocatorsV2({
      layout,
      identityDigest: identity.identityDigest,
      resourceId: observedCurrent.resourceId
    });
    if (!fileSystem.exists(locators.registrationPath)) {
      throw new Error('typed-block:dependency-cache-current-without-registration');
    }
    registration = readState(fileSystem.readText, locators.registrationPath);
    if (fileSystem.exists(birthLocators.birthPath)) {
      const pendingBirthText = fileSystem.readText(birthLocators.birthPath);
      const pendingBirth = parseEnvironmentDependencyCacheStateV2(pendingBirthText);
      if (pendingBirth.resourceId === observedCurrent.resourceId &&
          pendingBirth.stateDigest === registration.stateDigest) {
        if (!fileSystem.deleteFsyncCas(birthLocators.birthPath, pendingBirthText)) {
          throw new Error('typed-block:dependency-cache-birth-intent-cleanup-conflict');
        }
      } else if (observedCurrent.phase === 'physical-clean' &&
          pendingBirth.phase === 'registered' &&
          pendingBirth.identityDigest === identity.identityDigest &&
          pendingBirth.closureDigest === identity.closureDigest &&
          pendingBirth.providerRevision === input.providerRevision) {
        pendingRebirth = Object.freeze({
          state: pendingBirth,
          text: pendingBirthText,
          locators: resolveSecRuntimeDependencyCacheLocatorsV2({
            layout,
            identityDigest: identity.identityDigest,
            resourceId: pendingBirth.resourceId
          })
        });
      } else {
        throw new Error('typed-block:dependency-cache-birth-intent-conflict');
      }
    }
    if (observedCurrent.phase === 'physical-clean') {
      // A crash after the physical-clean CAS but before settlement publication
      // is resumable by retire().  Rebirth is admitted only after the exact
      // resource settlement exists and any cleanup intent has been retired.
      if (fileSystem.exists(locators.settlementPath)) {
        const settlement = parseEnvironmentDependencyCacheSettlementV2(
          fileSystem.readText(locators.settlementPath)
        );
        if (settlement.resourceId !== observedCurrent.resourceId ||
            settlement.finalStateDigest !== observedCurrent.stateDigest) {
          throw new Error('typed-block:dependency-cache-settlement-conflict');
        }
        const cacheAuthority = acquireSecRuntimeCachePhysicalAuthorityV1({
          repositoryRoot,
          cacheRoot: layout.cacheRoot,
          requiredDirectories: [layout.dependencyCachePhysicalRoot]
        });
        cacheAuthority.assertCurrent();
        if (inspectNoFollowDirectoryChildV1(
          cacheAuthority.directory(layout.dependencyCachePhysicalRoot),
          path.basename(locators.cacheEntryPath),
          'dependency cache rebirth absence readback'
        ) !== null) {
          throw new Error('typed-block:dependency-cache-rebirth-physical-residue');
        }
        if (fileSystem.exists(locators.objectPath)) {
          const intentText = fileSystem.readText(locators.objectPath);
          const intent = parseEnvironmentDependencyCacheStateV2(intentText);
          if (intent.phase !== 'gc-pending' || intent.resourceId !== observedCurrent.resourceId ||
              !fileSystem.deleteFsyncCas(locators.objectPath, intentText)) {
            throw new Error('typed-block:dependency-cache-settled-intent-conflict');
          }
        }
        const rebirth = pendingRebirth ?? Object.freeze({
          state: birth,
          text: birthText,
          locators: birthLocators
        });
        if (pendingRebirth === null &&
            !fileSystem.createExclusiveFsync(rebirth.locators.birthPath, rebirth.text)) {
          throw new Error('typed-block:dependency-cache-rebirth-intent-contended');
        }
        if (fileSystem.exists(rebirth.locators.registrationPath)) {
          const existingRegistration = readState(
            fileSystem.readText, rebirth.locators.registrationPath
          );
          if (existingRegistration.stateDigest !== rebirth.state.stateDigest) {
            throw new Error('typed-block:dependency-cache-rebirth-registration-conflict');
          }
        } else if (!fileSystem.createExclusiveFsync(
          rebirth.locators.registrationPath, rebirth.text
        )) {
          throw new Error('typed-block:dependency-cache-rebirth-registration-contended');
        }
        if (!fileSystem.replaceFsyncCas(
          rebirth.locators.currentPath, observedCurrentText, rebirth.text
        )) {
          throw new Error('typed-block:dependency-cache-rebirth-current-cas-conflict');
        }
        if (!fileSystem.deleteFsyncCas(rebirth.locators.birthPath, rebirth.text)) {
          throw new Error('typed-block:dependency-cache-rebirth-intent-cleanup-conflict');
        }
        // Retired registration and settlement are immutable history. Their
        // bounded compaction belongs to aggregate reconciliation; deleting
        // either inside rebirth would create a cross-record crash cutpoint.
        locators = rebirth.locators;
        registration = rebirth.state;
      }
    }
  } else {
    let admittedBirth = birth;
    let admittedBirthText = birthText;
    if (fileSystem.exists(birthLocators.birthPath)) {
      admittedBirthText = fileSystem.readText(birthLocators.birthPath);
      admittedBirth = parseEnvironmentDependencyCacheStateV2(admittedBirthText);
      if (admittedBirth.phase !== 'registered' ||
          admittedBirth.identityDigest !== identity.identityDigest ||
          admittedBirth.closureDigest !== identity.closureDigest ||
          admittedBirth.providerRevision !== input.providerRevision) {
        throw new Error('typed-block:dependency-cache-birth-intent-conflict');
      }
      locators = resolveSecRuntimeDependencyCacheLocatorsV2({
        layout,
        identityDigest: identity.identityDigest,
        resourceId: admittedBirth.resourceId
      });
    } else if (!fileSystem.createExclusiveFsync(birthLocators.birthPath, birthText)) {
      throw new Error('typed-block:dependency-cache-birth-intent-contended');
    }
    if (!fileSystem.exists(locators.registrationPath) &&
        !fileSystem.createExclusiveFsync(locators.registrationPath, admittedBirthText)) {
      throw new Error('typed-block:dependency-cache-registration-contended');
    }
    registration = readState(fileSystem.readText, locators.registrationPath);
    if (registration.stateDigest !== admittedBirth.stateDigest ||
        !fileSystem.createExclusiveFsync(locators.currentPath, encodeState(registration))) {
      throw new Error('typed-block:dependency-cache-current-contended');
    }
    if (!fileSystem.deleteFsyncCas(locators.birthPath, admittedBirthText)) {
      throw new Error('typed-block:dependency-cache-birth-intent-cleanup-conflict');
    }
  }
  if (registration.phase !== 'registered' ||
      registration.identityDigest !== identity.identityDigest ||
      registration.closureDigest !== identity.closureDigest ||
      registration.providerRevision !== input.providerRevision) {
    throw new Error('typed-block:dependency-cache-registration-conflict');
  }

  const exactCurrent = (): Readonly<{
    state: EnvironmentDependencyCacheStateV2;
    text: string;
  }> => {
    const text = fileSystem.readText(locators.currentPath);
    const state = parseEnvironmentDependencyCacheStateV2(text);
    if (state.resourceId !== registration.resourceId ||
        state.identityDigest !== identity.identityDigest ||
        state.closureDigest !== identity.closureDigest ||
        state.providerRevision !== registration.providerRevision) {
      throw new Error('typed-block:dependency-cache-current-binding-conflict');
    }
    return Object.freeze({ state, text });
  };

  const replace = (
    expected: Readonly<{ state: EnvironmentDependencyCacheStateV2; text: string }>,
    next: EnvironmentDependencyCacheStateV2
  ): EnvironmentDependencyCacheStateV2 => {
    if (next.previousStateDigest !== expected.state.stateDigest ||
        next.transitionEpoch !== expected.state.transitionEpoch + 1) {
      throw new Error('Environment dependency cache transition is not exact-current bound.');
    }
    if (!fileSystem.replaceFsyncCas(locators.currentPath, expected.text, encodeState(next))) {
      throw new Error('typed-block:dependency-cache-current-cas-conflict');
    }
    const readback = exactCurrent().state;
    if (readback.stateDigest !== next.stateDigest) {
      throw new Error('Environment dependency cache current durable readback mismatch.');
    }
    return readback;
  };

  return Object.freeze({
    locators,
    current: (): EnvironmentDependencyCacheStateV2 => exactCurrent().state,
    beginMaterialization(now?: string): EnvironmentDependencyCacheStateV2 {
      const expected = exactCurrent();
      if (expected.state.phase !== 'registered') {
        throw new Error(`typed-block:dependency-cache-${expected.state.phase}`);
      }
      const updatedAt = canonicalNow(now);
      return replace(expected, beginEnvironmentDependencyCacheMaterializationV2({
        current: expected.state,
        updatedAt,
        leaseExpiresAt: new Date(
          Date.parse(updatedAt) + ENVIRONMENT_DEPENDENCY_CACHE_LIFECYCLE_POLICY_V2.ownerLeaseMilliseconds
        ).toISOString(),
        owner: currentLinuxProcessIdentityV1()
      }));
    },
    recoverMaterialization(now?: string): EnvironmentDependencyCacheStateV2 {
      const expected = exactCurrent();
      const recoveredAt = canonicalNow(now);
      if (expected.state.phase !== 'materializing' ||
          Date.parse(expected.state.leaseExpiresAt) > Date.parse(recoveredAt)) {
        throw new Error('typed-block:dependency-cache-materialization-not-recoverable');
      }
      const observer = currentLinuxProcessIdentityV1();
      const death = observeLocalLinuxOwnerDeathV1(expected.state, observer);
      const deathProofDigest = sha256(Object.freeze({
        schema: 'sec-environment-dependency-cache-owner-death-proof-v2',
        resourceId: expected.state.resourceId,
        currentStateDigest: expected.state.stateDigest,
        ownerLeaseDigest: expected.state.ownerLeaseDigest,
        owner: Object.freeze({
          host: expected.state.ownerHost,
          bootId: expected.state.ownerBootId,
          pid: expected.state.ownerPid,
          processStartTicks: expected.state.ownerProcessStartTicks
        }),
        observer,
        observedProcessStartTicks: death.observedProcessStartTicks,
        reason: death.reason,
        observedAt: recoveredAt
      }));
      return replace(expected, recoverEnvironmentDependencyCacheMaterializationV2({
        current: expected.state,
        recoveredAt,
        leaseExpiresAt: new Date(
          Date.parse(recoveredAt) + ENVIRONMENT_DEPENDENCY_CACHE_LIFECYCLE_POLICY_V2.ownerLeaseMilliseconds
        ).toISOString(),
        reason: death.reason,
        deathProofDigest,
        owner: observer
      }));
    },
    publishPhysical(publication: Readonly<{
      sourceSnapshotDigest: string;
      archiveProjectionDigest: string;
      now?: string;
    }>): EnvironmentDependencyCacheStateV2 {
      const expected = exactCurrent();
      if (expected.state.phase !== 'materializing') {
        throw new Error('typed-block:dependency-cache-not-materializing');
      }
      const cacheAuthority = acquireSecRuntimeCachePhysicalAuthorityV1({
        repositoryRoot,
        cacheRoot: layout.cacheRoot,
        requiredDirectories: [layout.dependencyCachePhysicalRoot]
      });
      const parent = cacheAuthority.directory(layout.dependencyCachePhysicalRoot);
      const entry = inspectNoFollowDirectoryChildV1(
        parent, path.basename(locators.cacheEntryPath),
        'dependency cache publication entry'
      );
      if (entry === null) {
        throw new Error('typed-block:dependency-cache-publication-entry-absent');
      }
      const archiveName = path.basename(locators.cacheArchivePath);
      const before = inspectNoFollowOrdinaryFileDigestV1(entry, archiveName);
      const after = inspectNoFollowOrdinaryFileDigestV1(entry, archiveName);
      if (before === null || after === null || before.byteDigest !== after.byteDigest ||
          before.size !== after.size || before.unixMode === null || after.unixMode !== before.unixMode ||
          (before.unixMode & 0o222) !== 0) {
        throw new Error('typed-block:dependency-cache-publication-physical-readback-conflict');
      }
      return replace(expected, reduceEnvironmentDependencyCachePublishedStateV2({
        current: expected.state,
        updatedAt: canonicalNow(publication.now),
        archiveDigest: before.byteDigest,
        archiveBytes: before.size,
        sourceSnapshotDigest: publication.sourceSnapshotDigest,
        archiveProjectionDigest: publication.archiveProjectionDigest
      }));
    },
    acquire(acquisition: Readonly<{ consumerId: string; now?: string }>) {
      const expected = exactCurrent();
      const acquiredAt = canonicalNow(acquisition.now);
      const next = acquireEnvironmentDependencyCacheConsumerV2({
        current: expected.state,
        consumerId: acquisition.consumerId,
        updatedAt: acquiredAt,
        leaseExpiresAt: new Date(
          Date.parse(acquiredAt) + ENVIRONMENT_DEPENDENCY_CACHE_LIFECYCLE_POLICY_V2.ownerLeaseMilliseconds
        ).toISOString(),
        owner: currentLinuxProcessIdentityV1()
      });
      const current = replace(expected, next.current);
      return Object.freeze({
        current,
        handle: createEnvironmentDependencyCacheHandleV1({
          current,
          consumerId: acquisition.consumerId
        })
      });
    },
    recoverDeadConsumers(now?: string) {
      const observedAt = canonicalNow(now);
      const observer = currentLinuxProcessIdentityV1();
      const recoveredConsumerIds: string[] = [];
      for (;;) {
        const expected = exactCurrent();
        const expired = expected.state.activeConsumers.find(
          (consumer) => Date.parse(consumer.leaseExpiresAt) <= Date.parse(observedAt)
        );
        if (expired === undefined) {
          return Object.freeze({
            current: expected.state,
            recoveredConsumerIds: Object.freeze(recoveredConsumerIds)
          });
        }
        const death = observeLocalLinuxOwnerDeathV1(expired, observer);
        const deathProofDigest = sha256(Object.freeze({
          schema: 'sec-environment-dependency-cache-consumer-death-proof-v2',
          resourceId: expected.state.resourceId,
          currentStateDigest: expected.state.stateDigest,
          consumer: expired,
          observer,
          observedProcessStartTicks: death.observedProcessStartTicks,
          reason: death.reason,
          observedAt
        }));
        replace(expected, recoverEnvironmentDependencyCacheConsumerV2({
          current: expected.state,
          consumerId: expired.consumerId,
          acquireCredentialDigest: expired.acquireCredentialDigest,
          reason: death.reason,
          observedAt,
          deathProofDigest
        }));
        recoveredConsumerIds.push(expired.consumerId);
      }
    },
    release(release: Readonly<{
      consumerId: string;
      acquireCredentialDigest: string;
      now?: string;
    }>) {
      const expected = exactCurrent();
      const next = releaseEnvironmentDependencyCacheConsumerV2({
        current: expected.state,
        consumerId: release.consumerId,
        acquireCredentialDigest: release.acquireCredentialDigest,
        updatedAt: canonicalNow(release.now)
      });
      return Object.freeze({
        current: replace(expected, next.current),
        releaseCredentialDigest: next.releaseCredentialDigest
      });
    },
    retire(retirement: Readonly<{
      now?: string;
      expectedResourceId?: `sha256:${string}`;
      expectedStateDigest?: `sha256:${string}`;
    }> = {}): EnvironmentDependencyCacheSettlementV2 {
      const retiredAt = canonicalNow(retirement.now);
      let expected = exactCurrent();
      if ((retirement.expectedResourceId !== undefined &&
          expected.state.resourceId !== retirement.expectedResourceId) ||
          (retirement.expectedStateDigest !== undefined &&
          expected.state.stateDigest !== retirement.expectedStateDigest)) {
        throw new Error('typed-block:dependency-cache-retirement-expected-current-conflict');
      }
      if (expected.state.activeConsumers.length !== 0) {
        throw new Error('typed-block:dependency-cache-retirement-consumer-active');
      }
      if (expected.state.phase === 'published') {
        replace(expected, transitionEnvironmentDependencyCacheTerminalV2({
          current: expected.state,
          phase: 'terminal',
          updatedAt: retiredAt
        }));
        expected = exactCurrent();
      }
      if (expected.state.phase === 'terminal') {
        replace(expected, transitionEnvironmentDependencyCacheTerminalV2({
          current: expected.state,
          phase: 'gc-pending',
          updatedAt: retiredAt
        }));
        expected = exactCurrent();
      }
      if (expected.state.phase !== 'gc-pending' && expected.state.phase !== 'physical-clean') {
        throw new Error(`typed-block:dependency-cache-retirement-${expected.state.phase}`);
      }

      let physicalClean = expected.state;
      if (expected.state.phase === 'gc-pending') {
        const intentText = encodeState(expected.state);
        const intentPreexisting = fileSystem.exists(locators.objectPath);
        if (intentPreexisting) {
          const intent = readState(fileSystem.readText, locators.objectPath);
          if (intent.stateDigest !== expected.state.stateDigest) {
            throw new Error('typed-block:dependency-cache-gc-intent-conflict');
          }
        }

        const cacheAuthority = acquireSecRuntimeCachePhysicalAuthorityV1({
          repositoryRoot,
          cacheRoot: layout.cacheRoot,
          requiredDirectories: [layout.dependencyCachePhysicalRoot]
        });
        cacheAuthority.assertCurrent();
        const parent = cacheAuthority.directory(layout.dependencyCachePhysicalRoot);
        const gcLeaseName = `.dependency-cache-gc-${expected.state.resourceId.slice(7)}.lease`;
        const gcLease = acquirePhysicalMutationLeaseV1(parent, gcLeaseName);
        if (gcLease === null) {
          throw new Error('typed-block:dependency-cache-gc-contended');
        }
        try {
          const entry = inspectNoFollowDirectoryChildV1(
            parent, path.basename(locators.cacheEntryPath), 'dependency cache GC entry'
          );
          if (entry === null) {
            if (!intentPreexisting) {
              throw new Error('typed-block:dependency-cache-gc-entry-absent-before-intent');
            }
          } else {
            const archive = inspectNoFollowOrdinaryFileDigestV1(
              entry, path.basename(locators.cacheArchivePath)
            );
            if (archive !== null && (archive.byteDigest !== expected.state.archiveDigest ||
                archive.size !== expected.state.archiveBytes)) {
              throw new Error('typed-block:dependency-cache-gc-archive-binding-conflict');
            }
            if (archive === null && !intentPreexisting) {
              throw new Error('typed-block:dependency-cache-gc-archive-absent-before-intent');
            }
            if (!intentPreexisting &&
                !fileSystem.createExclusiveFsync(locators.objectPath, intentText)) {
              throw new Error('typed-block:dependency-cache-gc-intent-contended');
            }
            const inventory = scanNoFollowDirectoryTreeMetadataV1(entry, {
              maximumEntries: 3,
              deadlineAtMs: performance.now() + 5_000
            });
            const allowed = new Set([
              path.basename(locators.cacheArchivePath),
              path.basename(locators.cacheReceiptPath)
            ]);
            if (inventory.some((item) => item.kind !== 'file' ||
                item.relativePath.includes('/') || !allowed.has(item.relativePath))) {
              throw new Error('typed-block:dependency-cache-gc-foreign-residue');
            }
            for (const item of inventory) {
              deleteRetainedNoFollowEntryV1({
                root: entry,
                relativePath: item.relativePath,
                kind: 'file',
                device: item.device,
                inode: item.inode,
                ancestorDirectories: []
              });
            }
            const retainedEntry = inspectNoFollowDirectoryChildV1(
              parent, path.basename(locators.cacheEntryPath), 'dependency cache GC retained entry'
            );
            if (retainedEntry === null) {
              throw new Error('typed-block:dependency-cache-gc-entry-identity-lost');
            }
            deleteRetainedNoFollowEntryV1({
              root: parent,
              relativePath: path.basename(locators.cacheEntryPath),
              kind: 'directory',
              device: retainedEntry.device,
              inode: retainedEntry.inode,
              ancestorDirectories: []
            });
          }
          if (inspectNoFollowDirectoryChildV1(
            parent, path.basename(locators.cacheEntryPath), 'dependency cache GC absence readback'
          ) !== null) {
            throw new Error('typed-block:dependency-cache-gc-physical-residue');
          }
        } finally {
          gcLease.release();
        }
        expected = exactCurrent();
        physicalClean = replace(expected, transitionEnvironmentDependencyCacheTerminalV2({
          current: expected.state,
          phase: 'physical-clean',
          updatedAt: retiredAt
        }));
      } else {
        const cacheAuthority = acquireSecRuntimeCachePhysicalAuthorityV1({
          repositoryRoot,
          cacheRoot: layout.cacheRoot,
          requiredDirectories: [layout.dependencyCachePhysicalRoot]
        });
        const parent = cacheAuthority.directory(layout.dependencyCachePhysicalRoot);
        if (inspectNoFollowDirectoryChildV1(
          parent, path.basename(locators.cacheEntryPath), 'dependency cache settled absence readback'
        ) !== null) {
          throw new Error('typed-block:dependency-cache-physical-clean-residue');
        }
      }
      const settlement = createEnvironmentDependencyCacheSettlementV2({
        current: physicalClean,
        physicalAbsenceDigest: sha256(Object.freeze({
          schema: 'sec-environment-dependency-cache-physical-absence-v2',
          resourceId: physicalClean.resourceId,
          cacheEntryPath: locators.cacheEntryPath,
          archiveAbsent: true
        })),
        settledAt: retiredAt
      });
      let readback: EnvironmentDependencyCacheSettlementV2;
      if (fileSystem.exists(locators.settlementPath)) {
        readback = parseEnvironmentDependencyCacheSettlementV2(
          fileSystem.readText(locators.settlementPath)
        );
        if (readback.resourceId !== physicalClean.resourceId ||
            readback.finalStateDigest !== physicalClean.stateDigest) {
          throw new Error('typed-block:dependency-cache-existing-settlement-conflict');
        }
      } else {
        const settlementText = `${JSON.stringify(settlement)}\n`;
        if (!fileSystem.createExclusiveFsync(locators.settlementPath, settlementText)) {
          throw new Error('typed-block:dependency-cache-settlement-contended');
        }
        readback = parseEnvironmentDependencyCacheSettlementV2(
          fileSystem.readText(locators.settlementPath)
        );
        if (readback.settlementDigest !== settlement.settlementDigest) {
          throw new Error('Environment dependency cache settlement durable readback mismatch.');
        }
      }
      if (fileSystem.exists(locators.objectPath)) {
        const intentText = fileSystem.readText(locators.objectPath);
        const intent = parseEnvironmentDependencyCacheStateV2(intentText);
        if (intent.phase !== 'gc-pending' || intent.resourceId !== physicalClean.resourceId ||
            !fileSystem.deleteFsyncCas(locators.objectPath, intentText)) {
          throw new Error('typed-block:dependency-cache-gc-intent-cleanup-conflict');
        }
      }
      return readback;
    }
  });
}

/**
 * Enforces the repository aggregate budget from durable current records.  It
 * never selects an active consumer or the caller-protected identity, and each
 * selected resource is retired through the same lifecycle/physical owner.
 */
export async function enforceEnvironmentDependencyCacheBudgetV2(input: Readonly<{
  repository: string;
  repositoryRoot: string;
  protectedIdentityDigest: `sha256:${string}`;
  platform: 'linux/amd64';
  environment?: NodeJS.ProcessEnv;
  now?: string;
}>): Promise<Readonly<{
  entriesBefore: number;
  entriesAfter: number;
  bytesBefore: number;
  bytesAfter: number;
  retiredResourceIds: readonly `sha256:${string}`[];
}>> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const layout = resolveSecRuntimeStateForRepositoryV1({
    repository: input.repository,
    repositoryRoot,
    ...(input.environment === undefined ? {} : { environment: input.environment })
  });
  const authority = await acquireSecRuntimeStatePhysicalAuthorityV1({
    repositoryRoot,
    stateRoot: layout.stateRoot,
    cacheRoot: layout.cacheRoot,
    requiredDirectories: [
      layout.repositoryStateRoot,
      layout.dependencyCacheRegistrationRoot,
      layout.dependencyCacheCurrentRoot,
      layout.dependencyCacheSettlementRoot,
      layout.dependencyCacheObjectRoot
    ]
  });
  const fileSystem = createRuntimeStateJournalFileSystemV1(
    authority.directory(layout.repositoryStateRoot)
  );
  const readStates = () => fileSystem.listOrdinaryFiles(
    layout.dependencyCacheCurrentRoot,
    ENVIRONMENT_DEPENDENCY_CACHE_LIFECYCLE_POLICY_V2.maxStateRecords
  ).map((filePath) => Object.freeze({
    filePath,
    state: parseEnvironmentDependencyCacheStateV2(fileSystem.readText(filePath))
  }));
  const openStateOwner = (state: EnvironmentDependencyCacheStateV2) =>
    openEnvironmentDependencyCacheLifecycleV2({
      repository: input.repository,
      repositoryRoot,
      identity: {
        schema: 'sec-environment-dependency-cache-identity-v1',
        closureDigest: state.closureDigest,
        identityDigest: state.identityDigest
      },
      providerRevision: state.providerRevision,
      platform: input.platform,
      ...(input.environment === undefined ? {} : { environment: input.environment }),
      ...(input.now === undefined ? {} : { now: input.now })
    });
  let states = readStates();
  for (const observed of states.filter(({ state }) => {
    if (state.phase === 'terminal' || state.phase === 'gc-pending') return true;
    if (state.phase !== 'physical-clean') return false;
    const observedLocators = resolveSecRuntimeDependencyCacheLocatorsV2({
      layout,
      identityDigest: state.identityDigest,
      resourceId: state.resourceId
    });
    return !fileSystem.exists(observedLocators.settlementPath);
  })) {
    const owner = await openStateOwner(observed.state);
    const current = owner.current();
    if (current.resourceId === observed.state.resourceId &&
        (current.phase === 'terminal' || current.phase === 'gc-pending' ||
        current.phase === 'physical-clean')) {
      owner.retire({
        expectedResourceId: current.resourceId,
        expectedStateDigest: current.stateDigest,
        ...(input.now === undefined ? {} : { now: input.now })
      });
    }
  }
  states = readStates();
  let live = states.filter(({ state }) => state.phase === 'published');
  const initialEntries = live.length;
  const initialBytes = live.reduce((total, { state }) => total + (state.archiveBytes ?? 0), 0);
  if (initialEntries > ENVIRONMENT_DEPENDENCY_CACHE_LIFECYCLE_POLICY_V2.maxEntries ||
      initialBytes > ENVIRONMENT_DEPENDENCY_CACHE_LIFECYCLE_POLICY_V2.maxTotalBytes) {
    const recoveryNow = canonicalNow(input.now);
    for (const observed of live.filter(({ state }) => state.activeConsumers.some(
      (consumer) => Date.parse(consumer.leaseExpiresAt) <= Date.parse(recoveryNow)
    ))) {
      const owner = await openStateOwner(observed.state);
      owner.recoverDeadConsumers(recoveryNow);
    }
    states = readStates();
    live = states.filter(({ state }) => state.phase === 'published');
  }
  const entriesBefore = live.length;
  const bytesBefore = live.reduce((total, { state }) => total + (state.archiveBytes ?? 0), 0);
  let entriesAfter = entriesBefore;
  let bytesAfter = bytesBefore;
  const retiredResourceIds: `sha256:${string}`[] = [];
  const candidates = live
    .filter(({ state }) => state.identityDigest !== input.protectedIdentityDigest &&
      state.activeConsumers.length === 0)
    .sort((left, right) => Date.parse(left.state.updatedAt) - Date.parse(right.state.updatedAt) ||
      left.state.resourceId.localeCompare(right.state.resourceId, 'en-US'));
  while (entriesAfter > ENVIRONMENT_DEPENDENCY_CACHE_LIFECYCLE_POLICY_V2.maxEntries ||
      bytesAfter > ENVIRONMENT_DEPENDENCY_CACHE_LIFECYCLE_POLICY_V2.maxTotalBytes) {
    const selected = candidates.shift();
    if (selected === undefined) {
      throw new Error('typed-block:dependency-cache-budget-active-or-protected');
    }
    const owner = await openStateOwner(selected.state);
    const settlement = owner.retire({
      expectedResourceId: selected.state.resourceId,
      expectedStateDigest: selected.state.stateDigest,
      ...(input.now === undefined ? {} : { now: input.now })
    });
    if (settlement.resourceId !== selected.state.resourceId) {
      throw new Error('typed-block:dependency-cache-budget-settlement-resource-conflict');
    }
    entriesAfter -= 1;
    bytesAfter -= selected.state.archiveBytes ?? 0;
    retiredResourceIds.push(selected.state.resourceId);
  }
  const currentResourceIds = new Set(readStates().map(({ state }) => state.resourceId));
  const settledHistory = fileSystem.listOrdinaryFiles(
    layout.dependencyCacheSettlementRoot,
    ENVIRONMENT_DEPENDENCY_CACHE_LIFECYCLE_POLICY_V2.maxStateRecords
  ).map((settlementPath) => Object.freeze({
    settlementPath,
    settlementText: fileSystem.readText(settlementPath)
  })).map((entry) => Object.freeze({
    ...entry,
    settlement: parseEnvironmentDependencyCacheSettlementV2(entry.settlementText)
  })).filter(({ settlement }) => !currentResourceIds.has(settlement.resourceId))
    .sort((left, right) => Date.parse(right.settlement.settledAt) -
      Date.parse(left.settlement.settledAt) ||
      right.settlement.resourceId.localeCompare(left.settlement.resourceId, 'en-US'));
  for (const obsolete of settledHistory.slice(
    ENVIRONMENT_DEPENDENCY_CACHE_LIFECYCLE_POLICY_V2.maxEntries
  )) {
    const obsoleteLocators = resolveSecRuntimeDependencyCacheLocatorsV2({
      layout,
      identityDigest: obsolete.settlement.identityDigest,
      resourceId: obsolete.settlement.resourceId
    });
    if (fileSystem.exists(obsoleteLocators.objectPath)) {
      throw new Error('typed-block:dependency-cache-history-compaction-gc-intent-present');
    }
    if (fileSystem.exists(obsoleteLocators.registrationPath)) {
      const registrationText = fileSystem.readText(obsoleteLocators.registrationPath);
      const registration = parseEnvironmentDependencyCacheStateV2(registrationText);
      if (registration.resourceId !== obsolete.settlement.resourceId ||
          !fileSystem.deleteFsyncCas(obsoleteLocators.registrationPath, registrationText)) {
        throw new Error('typed-block:dependency-cache-history-registration-conflict');
      }
    }
    if (!fileSystem.deleteFsyncCas(obsolete.settlementPath, obsolete.settlementText)) {
      throw new Error('typed-block:dependency-cache-history-settlement-conflict');
    }
  }
  const physicalAuthority = acquireSecRuntimeCachePhysicalAuthorityV1({
    repositoryRoot,
    cacheRoot: layout.cacheRoot,
    requiredDirectories: [layout.dependencyCachePhysicalRoot]
  });
  physicalAuthority.assertCurrent();
  const physicalRoot = physicalAuthority.directory(layout.dependencyCachePhysicalRoot);
  const physicalInventory = scanNoFollowDirectoryTreeMetadataV1(physicalRoot, {
    maximumEntries: ENVIRONMENT_DEPENDENCY_CACHE_LIFECYCLE_POLICY_V2.maxPhysicalInventoryEntries,
    deadlineAtMs: performance.now() + 5_000
  });
  const finalStates = readStates();
  const stateByPhysicalEntry = new Map(finalStates.map(({ state }) => {
    const stateLocators = resolveSecRuntimeDependencyCacheLocatorsV2({
      layout,
      identityDigest: state.identityDigest,
      resourceId: state.resourceId
    });
    return [path.basename(stateLocators.cacheEntryPath), state] as const;
  }));
  const topLevelDirectories = physicalInventory.filter(
    (entry) => !entry.relativePath.includes('/') && entry.kind === 'directory'
  );
  if (physicalInventory.some((entry) => !entry.relativePath.includes('/') &&
      entry.kind !== 'directory')) {
    throw new Error('typed-block:dependency-cache-physical-root-foreign-residue');
  }
  for (const entry of topLevelDirectories) {
    const owner = stateByPhysicalEntry.get(entry.relativePath);
    if (owner === undefined || owner.phase === 'registered' || owner.phase === 'physical-clean') {
      throw new Error('typed-block:dependency-cache-physical-entry-without-live-owner');
    }
  }
  const physicalBytes = physicalInventory.reduce(
    (total, entry) => total + (entry.kind === 'file' ? entry.size : 0), 0
  );
  if (topLevelDirectories.length > ENVIRONMENT_DEPENDENCY_CACHE_LIFECYCLE_POLICY_V2.maxEntries ||
      physicalBytes > ENVIRONMENT_DEPENDENCY_CACHE_LIFECYCLE_POLICY_V2.maxTotalBytes +
        ENVIRONMENT_DEPENDENCY_CACHE_LIFECYCLE_POLICY_V2.maxPhysicalOverheadBytes) {
    throw new Error('typed-block:dependency-cache-physical-budget-unresolved');
  }
  return Object.freeze({
    entriesBefore,
    entriesAfter,
    bytesBefore,
    bytesAfter,
    retiredResourceIds: Object.freeze(retiredResourceIds)
  });
}
