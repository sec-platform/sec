import crypto from 'node:crypto';
import { lstatSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleepMs } from 'node:timers/promises';

import { canonicalJson } from '../../../../contracts/canonical.ts';
import { FailureError } from '../../../../contracts/failure.ts';
import { formatJsonFile } from '../../../../contracts/json-text.ts';
import {
  generatedStateDigest,
  type GeneratedStatePhysicalIdentity
} from '../../../runtime-state/generated-state/contract.ts';
import {
  createNoFollowOrdinaryDirectoryChain,
  inspectExactNoFollowDirectoryPresence,
  inspectNoFollowDirectoryChain,
  PhysicalNoFollowError,
  publishExclusiveDurableCanonicalFile,
  type PhysicalDirectoryIdentity
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { migrateRuntimeStateDirectoryGeneration } from '../../../runtime-state/workspace-state/layout-migration.ts';
import { resolveWorkspaceRuntimeRoots } from '../../../runtime-state/workspace-state/paths.ts';
import { acquireRuntimeStatePhysicalAuthority } from '../../../runtime-state/workspace-state/physical-authority.ts';
import {
  generatedStatePhysicalIdentity,
  hasExactObjectKeys,
  isCanonicalAbsolutePath,
  isCanonicalGeneratedStatePhysicalIdentity,
  isSha256Digest,
  sameGeneratedStateIdentity
} from './dependency-transition/contract.ts';
import { sameHostPath } from './host-path.ts';
import {
  MAX_DEPENDENCY_OPERATION_TIMEOUT_MS,
  runtimeDependencyOperationContext,
  runtimeDependencyOperationOptions,
  runtimeDependencyOperationRemainingMs,
  waitForRuntimeDependencyOperation,
  type RuntimeDependencyInstallOptions,
  type RuntimeDependencyOperationOptions
} from './operation-context.ts';
import { measureRuntimeDependencyOperationPhaseAsync } from './operation-telemetry.ts';
import {
  deleteNoFollowOwnedFile,
  observeNoFollowOwnedFile,
  readNoFollowOwnedFileBytes,
  readNoFollowOwnedFileJson,
  sameNoFollowOwnedFileObservation,
  type NoFollowOwnedFileObservation
} from './owned-file-provider.ts';

interface InstallLockOwner {
  createdAt: string;
  pid: number;
  token: string;
}

const INSTALL_LOCK_OWNER_KEYS = Object.freeze(['createdAt', 'pid', 'token']);
const INSTALL_LOCK_RECLAIM_OWNER_KEYS = Object.freeze(['createdAt', 'lock', 'pid', 'schema', 'token']);

function isInstallLockOwner(value: unknown): value is InstallLockOwner {
  if (!hasExactObjectKeys(value, INSTALL_LOCK_OWNER_KEYS)) return false;
  const owner = value as unknown as InstallLockOwner;
  return typeof owner.createdAt === 'string' && Number.isFinite(Date.parse(owner.createdAt)) &&
    Number.isSafeInteger(owner.pid) && owner.pid > 0 &&
    typeof owner.token === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(owner.token);
}

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== 'ESRCH';
  }
}

export type InstallLockTerminalHandoffRequest = Readonly<{
  compilerRootPhysical: GeneratedStatePhysicalIdentity;
  coordinationRootPhysical: GeneratedStatePhysicalIdentity;
  workspaceLocatorKey: `sha256:${string}`;
}>;
const installLockTerminalHandoffRequests = new WeakMap<object, InstallLockTerminalHandoffRequest>();
export function issueInstallLockTerminalHandoffRequest(
  input: InstallLockTerminalHandoffRequest
): InstallLockTerminalHandoffRequest {
  const request = Object.freeze({ ...input });
  installLockTerminalHandoffRequests.set(request, request);
  return request;
}

export function consumeInstallLockTerminalHandoffRequest(
  request: InstallLockTerminalHandoffRequest
): void {
  if (installLockTerminalHandoffRequests.get(request) !== request) {
    throw new FailureError(
      'RUNTIME-DEPS-004',
      'Install lock terminal handoff request is not owner-issued or was already consumed'
    );
  }
  installLockTerminalHandoffRequests.delete(request);
}

const INSTALL_LOCK_RECLAIM_SCHEMA =
  'sec-runtime-dependency-install-lock-reclaim-v1' as const;

interface InstallLockReclaimOwner {
  schema: typeof INSTALL_LOCK_RECLAIM_SCHEMA;
  createdAt: string;
  pid: number;
  token: string;
  lock: Readonly<{
    device: string;
    inode: string;
    size: number;
  }>;
}

function isInstallLockReclaimOwner(value: unknown): value is InstallLockReclaimOwner {
  if (!hasExactObjectKeys(value, INSTALL_LOCK_RECLAIM_OWNER_KEYS)) return false;
  const owner = value as unknown as InstallLockReclaimOwner;
  const lock = owner.lock;
  return owner.schema === INSTALL_LOCK_RECLAIM_SCHEMA &&
    typeof owner.createdAt === 'string' && Number.isFinite(Date.parse(owner.createdAt)) &&
    Number.isSafeInteger(owner.pid) && owner.pid > 0 &&
    typeof owner.token === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(owner.token) &&
    typeof lock === 'object' && lock !== null &&
    typeof lock.device === 'string' && lock.device.length > 0 &&
    typeof lock.inode === 'string' && lock.inode.length > 0 &&
    Number.isSafeInteger(lock.size) && lock.size > 0;
}

const INSTALL_LOCK_DELETE_MAX_ATTEMPTS = 8;
const WINDOWS_TRANSIENT_DELETE_CODES = new Set(['EACCES', 'EBUSY', 'EPERM']);
const LEGACY_INSTALL_LOCK_RECLAIM_MAXIMUM_LIFETIME_MS =
  MAX_DEPENDENCY_OPERATION_TIMEOUT_MS +
  INSTALL_LOCK_DELETE_MAX_ATTEMPTS * 1_000 +
  5_000;

/**
 * Windows may transiently reject deletion of an ordinary lock file even
 * while its retained identity remains unchanged.  The dependency owner owns
 * that retry policy; the generic physical primitive remains one strict
 * retained-identity effect.  Every retry re-observes both physical identity
 * and owner bytes, consumes the original operation deadline/signal/poll
 * ledger, and treats absence as the only successful terminal readback.
 */
async function settleInstallLockOwnedFileDeletion(input: Readonly<{
  assertExpected(observation: NoFollowOwnedFileObservation): void;
  expected: NoFollowOwnedFileObservation;
  filePath: string;
  label: string;
  options: RuntimeDependencyOperationOptions;
}>): Promise<'absent' | 'deleted'> {
  const hostPlatform = input.options.testInstallLockDeletePlatform ?? process.platform;
  const sleep = input.options.sleep ?? sleepMs;
  for (let attempt = 1; attempt <= INSTALL_LOCK_DELETE_MAX_ATTEMPTS; attempt += 1) {
    const current = observeNoFollowOwnedFile(input.filePath, `${input.label} settlement`);
    if (current === null) return 'absent';
    if (!sameNoFollowOwnedFileObservation(current, input.expected)) {
      throw new FailureError(
        'RUNTIME-DEPS-003',
        `${input.label} identity changed during deletion settlement; replacement is preserved`,
        { attempt, filePath: input.filePath, outcome: 'preserved-replacement' }
      );
    }
    input.assertExpected(current);
    try {
      await input.options.testInstallLockDelete?.(input.filePath, attempt);
      deleteNoFollowOwnedFile(input.filePath, input.expected, input.label);
      if (observeNoFollowOwnedFile(input.filePath, `${input.label} absence readback`) === null) {
        return 'deleted';
      }
      throw Object.assign(new Error(`${input.label} remained after exact deletion`), { code: 'EBUSY' });
    } catch (error) {
      const afterFailure = observeNoFollowOwnedFile(input.filePath, `${input.label} retry readback`);
      if (afterFailure === null) return 'deleted';
      if (!sameNoFollowOwnedFileObservation(afterFailure, input.expected)) {
        throw new FailureError(
          'RUNTIME-DEPS-003',
          `${input.label} was replaced after deletion failure and is preserved`,
          {
            attempt,
            deleteFailure: runtimeDependencyFailureEvidence(error),
            filePath: input.filePath,
            outcome: 'preserved-replacement'
          }
        );
      }
      input.assertExpected(afterFailure);
      const code = (error as NodeJS.ErrnoException).code;
      if (hostPlatform !== 'win32' || code === undefined ||
          !WINDOWS_TRANSIENT_DELETE_CODES.has(code)) throw error;
      if (attempt === INSTALL_LOCK_DELETE_MAX_ATTEMPTS) {
        throw new FailureError(
          'RUNTIME-DEPS-003',
          `${input.label} deletion settlement remained unknown after bounded Windows retries`,
          {
            attempt,
            deleteFailure: runtimeDependencyFailureEvidence(error),
            filePath: input.filePath,
            outcome: 'unknown'
          }
        );
      }
      try {
        runtimeDependencyOperationRemainingMs(input.options, `${input.label} deletion retry`);
        await waitForRuntimeDependencyOperation(
          input.options,
          runtimeDependencyOperationContext(input.options).pollIntervalMs,
          sleep,
          `${input.label} Windows deletion retry`
        );
      } catch (deadlineOrAbort) {
        throw new FailureError(
          'RUNTIME-DEPS-003',
          `${input.label} deletion settlement deadline or cancellation left an unknown exact identity`,
          {
            attempt,
            deleteFailure: runtimeDependencyFailureEvidence(error),
            filePath: input.filePath,
            outcome: 'unknown',
            settlementFailure: runtimeDependencyFailureEvidence(deadlineOrAbort)
          }
        );
      }
    }
  }
  throw new Error('Unreachable install lock deletion settlement state.');
}

function parseInstallLockOwner(value: unknown): InstallLockOwner | null {
  return isInstallLockOwner(value) ? value : null;
}

async function reclaimOrphanInstallLock(
  lockPath: string,
  options: RuntimeDependencyOperationOptions
): Promise<boolean> {
  const reclaimPath = `${lockPath}.reclaim`;
  const initialLockObservation = observeNoFollowOwnedFile(
    lockPath,
    'Install lock orphan candidate admission'
  );
  if (initialLockObservation === null) return true;
  const initialOwner = parseInstallLockOwner(
    readNoFollowOwnedFileJson(initialLockObservation, 'Install lock orphan candidate admission')
  );
  if (initialOwner === null || processIsAlive(initialOwner.pid)) return false;
  const initialCreatedAtMs = Date.parse(initialOwner.createdAt);
  if (!Number.isFinite(initialCreatedAtMs) || Date.now() - initialCreatedAtMs < 5_000) return false;
  let reclaimMarker: Readonly<{
    bytes: Buffer;
    observation: NoFollowOwnedFileObservation;
    owner: InstallLockReclaimOwner;
  }> | null = null;
  try {
    const reclaimParent = inspectNoFollowDirectoryChain(path.dirname(reclaimPath), 'Install lock reclaim marker parent').target;
    const reclaimOwner: InstallLockReclaimOwner = Object.freeze({
      schema: INSTALL_LOCK_RECLAIM_SCHEMA,
      createdAt: (options.now ?? (() => new Date().toISOString()))(),
      pid: process.pid,
      token: crypto.randomUUID(),
      lock: Object.freeze({
        device: initialLockObservation.device,
        inode: initialLockObservation.inode,
        size: initialLockObservation.size
      })
    });
    const reclaimBytes = Buffer.from(formatJsonFile(reclaimOwner), 'utf8');
    try {
      const publication = publishExclusiveDurableCanonicalFile({
        parent: reclaimParent,
        name: path.basename(reclaimPath),
        bytes: reclaimBytes,
        validate: (bytes) => {
          const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
          if (!isInstallLockReclaimOwner(parsed) || parsed.token !== reclaimOwner.token) {
            throw new Error('Install lock reclaim marker bytes differ.');
          }
        }
      });
      if (!publication.created) return false;
      const published = observeNoFollowOwnedFile(reclaimPath, 'Install lock reclaim marker publication');
      if (published === null || published.device !== publication.physical.device ||
          published.inode !== publication.physical.inode) {
        throw new FailureError(
          'RUNTIME-DEPS-003',
          'Install lock reclaim marker publication identity changed; current marker is preserved'
        );
      }
    } catch (error) {
      if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED') {
        throw new FailureError(
          'RUNTIME-DEPS-003',
          'Install lock reclaim marker publication remained unknown; current marker is preserved',
          { cause: runtimeDependencyFailureEvidence(error), reclaimPath }
        );
      }
      throw error;
    }
    const reclaimObservation = observeNoFollowOwnedFile(reclaimPath, 'Install lock reclaim marker');
    if (reclaimObservation === null) {
      throw new FailureError('RUNTIME-DEPS-003', 'Install lock reclaim marker disappeared after exclusive publication');
    }
    reclaimMarker = Object.freeze({
      bytes: reclaimBytes,
      observation: reclaimObservation,
      owner: reclaimOwner
    });

    const lockObservation = observeNoFollowOwnedFile(lockPath, 'Install lock orphan candidate');
    if (lockObservation === null) return true;
    if (!sameNoFollowOwnedFileObservation(lockObservation, initialLockObservation)) return false;
    const owner = parseInstallLockOwner(readNoFollowOwnedFileJson(lockObservation, 'Install lock orphan candidate'));
    // Do not reopen the lock through a second path-based stat just to obtain
    // mtime/dev/ino.  The retained no-follow observation above is the only
    // deletion authority; owner.createdAt is the durable freshness field and
    // malformed records are preserved rather than guessed stale.
    if (owner === null) return false;
    if (processIsAlive(owner.pid)) return false;
    const createdAtMs = Date.parse(owner.createdAt);
    if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs < 5000) return false;

    // Delete the stale lock in place through the retained parent/name/identity
    // capability.  There is no path-only rename followed by a broad unlink,
    // so a replacement can only result in a typed preservation blocker.
    await settleInstallLockOwnedFileDeletion({
      assertExpected: (current) => {
        const currentOwner = parseInstallLockOwner(
          readNoFollowOwnedFileJson(current, 'Install lock orphan candidate retry')
        );
        if (currentOwner?.token !== owner.token) {
          throw new FailureError(
            'RUNTIME-DEPS-003',
            'Install lock orphan candidate bytes changed during deletion settlement; current owner is preserved'
          );
        }
      },
      expected: lockObservation,
      filePath: lockPath,
      label: 'Install lock orphan candidate',
      options
    });
    return true;
  } finally {
    if (reclaimMarker !== null) {
      const {
        bytes: reclaimBytes,
        observation: reclaimObservation,
        owner: reclaimOwner
      } = reclaimMarker;
      await settleInstallLockOwnedFileDeletion({
        assertExpected: (current) => {
          const currentOwner = readNoFollowOwnedFileJson(current, 'Install lock reclaim marker cleanup');
          if (!isInstallLockReclaimOwner(currentOwner) ||
              currentOwner.token !== reclaimOwner.token ||
              !readNoFollowOwnedFileBytes(
                current,
                'Install lock reclaim marker cleanup bytes'
              ).equals(reclaimBytes)) {
            throw new FailureError(
              'RUNTIME-DEPS-003',
              'Install lock reclaim marker bytes changed during deletion settlement; residue is preserved'
            );
          }
        },
        expected: reclaimObservation,
        filePath: reclaimPath,
        label: 'Install lock reclaim marker',
        options
      });
    }
  }
}

function parseInstallLockReclaimOwner(value: unknown): InstallLockReclaimOwner | null {
  return isInstallLockReclaimOwner(value) ? value : null;
}

function isLegacyInstallLockReclaimBytes(bytes: Buffer): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\r?\n$/u
    .test(bytes.toString('utf8'));
}

type InstallLockReclaimState = 'absent' | 'active' | 'terminal-handoff';

async function reclaimLockState(
  reclaimPath: string,
  lockPath: string,
  options: RuntimeDependencyOperationOptions
): Promise<InstallLockReclaimState> {
  const observation = observeNoFollowOwnedFile(reclaimPath, 'Install lock reclaim marker');
  if (observation === null) return 'absent';
  const bytes = readNoFollowOwnedFileBytes(observation, 'Install lock reclaim marker');
  const terminalHandoff = (() => {
    try {
      return parseCompilerDependencyCoordinationCutover(bytes);
    } catch {
      return null;
    }
  })();
  if (terminalHandoff !== null) {
    const pairedLock = observeNoFollowOwnedFile(lockPath, 'Install lock terminal handoff pair');
    if (pairedLock === null) return 'active';
    const pairedBytes = readNoFollowOwnedFileBytes(pairedLock, 'Install lock terminal handoff pair');
    const pairedOwner = (() => {
      try {
        return parseInstallLockOwner(JSON.parse(pairedBytes.toString('utf8')) as unknown);
      } catch {
        return null;
      }
    })();
    return pairedOwner !== null && pairedOwner.token === terminalHandoff.lockOwnerToken &&
        pairedLock.device === terminalHandoff.lock.device && pairedLock.inode === terminalHandoff.lock.inode &&
        pairedLock.size === terminalHandoff.lock.size &&
        generatedStateDigest([...pairedBytes]) === terminalHandoff.lockOwnerBytesDigest
      ? 'terminal-handoff'
      : 'active';
  }
  const owner = (() => {
    try {
      return parseInstallLockReclaimOwner(JSON.parse(bytes.toString('utf8')) as unknown);
    } catch {
      return null;
    }
  })();
  if (owner !== null) {
    if (processIsAlive(owner.pid)) return 'active';
    const createdAtMs = Date.parse(owner.createdAt);
    if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs < 5_000) return 'active';
    await settleInstallLockOwnedFileDeletion({
      assertExpected: (current) => {
        const currentOwner = readNoFollowOwnedFileJson(current, 'Install lock orphan reclaim marker');
        if (!isInstallLockReclaimOwner(currentOwner) || currentOwner.token !== owner.token) {
          throw new FailureError(
            'RUNTIME-DEPS-003',
            'Install lock reclaim marker owner changed; current marker is preserved'
          );
        }
      },
      expected: observation,
      filePath: reclaimPath,
      label: 'Install lock orphan reclaim marker',
      options
    });
    return 'absent';
  }

  // The former reclaim grammar persisted only a UUID.  It is never accepted
  // by the normal marker reader.  Migration may retire one exact legacy leaf
  // only after its retained identity remains stable, its filesystem age is
  // beyond the maximum lifetime of every former operation/settlement, and
  // any paired lock owner is also provably dead.  Unknown bytes remain a
  // typed preservation barrier.
  if (!isLegacyInstallLockReclaimBytes(bytes)) return 'active';
  let legacyMtimeMs: number;
  try {
    const stat = lstatSync(reclaimPath);
    if (!stat.isFile()) return 'active';
    legacyMtimeMs = stat.mtimeMs;
  } catch {
    return 'active';
  }
  const readback = observeNoFollowOwnedFile(reclaimPath, 'Legacy install lock reclaim marker readback');
  if (readback === null || !sameNoFollowOwnedFileObservation(readback, observation) ||
      !readNoFollowOwnedFileBytes(readback, 'Legacy install lock reclaim marker bytes').equals(bytes) ||
      !Number.isFinite(legacyMtimeMs) ||
      Date.now() - legacyMtimeMs < LEGACY_INSTALL_LOCK_RECLAIM_MAXIMUM_LIFETIME_MS) {
    return 'active';
  }
  const lockObservation = observeNoFollowOwnedFile(lockPath, 'Legacy install lock owner');
  if (lockObservation !== null) {
    const lockOwner = parseInstallLockOwner(
      readNoFollowOwnedFileJson(lockObservation, 'Legacy install lock owner')
    );
    const lockCreatedAtMs = lockOwner === null ? Number.NaN : Date.parse(lockOwner.createdAt);
    if (lockOwner === null || processIsAlive(lockOwner.pid) ||
        !Number.isFinite(lockCreatedAtMs) ||
        Date.now() - lockCreatedAtMs < LEGACY_INSTALL_LOCK_RECLAIM_MAXIMUM_LIFETIME_MS) {
      return 'active';
    }
  }
  await settleInstallLockOwnedFileDeletion({
    assertExpected: (current) => {
      if (!readNoFollowOwnedFileBytes(current, 'Legacy install lock reclaim marker cleanup').equals(bytes)) {
        throw new FailureError(
          'RUNTIME-DEPS-003',
          'Legacy install lock reclaim marker bytes changed; current marker is preserved'
        );
      }
    },
    expected: observation,
    filePath: reclaimPath,
    label: 'Legacy install lock reclaim marker migration',
    options
  });
  return 'absent';
}

export class InstallLockTerminalHandoffObservedError extends Error {
  constructor(readonly lockPath: string) {
    super(`Install lock reached its terminal handoff: ${lockPath}`);
    this.name = 'InstallLockTerminalHandoffObservedError';
  }
}

function runtimeDependencyFailureEvidence(error: unknown): Readonly<{
  code: string | null;
  details: unknown;
  message: string;
  name: string;
}> {
  const value = error instanceof Error ? error : new Error(String(error));
  const code = 'code' in value && typeof value.code === 'string' ? value.code : null;
  return Object.freeze({
    code,
    details: value instanceof FailureError ? value.details : null,
    message: value.message.slice(0, 1_024),
    name: value.name
  });
}

export type RuntimeDependencyCapturedFailure = Readonly<{ error: unknown }>;

function runtimeDependencyInstallLockSettlementFailure(input: Readonly<{
  callbackFailure?: RuntimeDependencyCapturedFailure;
  cleanupFailure?: RuntimeDependencyCapturedFailure;
  fenceFailure?: RuntimeDependencyCapturedFailure;
  lockPath: string;
}>): FailureError {
  return new FailureError(
    'RUNTIME-DEPS-003',
    'Runtime dependency install lock settlement failed; exact failure evidence is preserved',
    {
      failureOrder: Object.freeze(['primary', 'fence', 'cleanup']),
      callbackFailure: input.callbackFailure === undefined
        ? null
        : runtimeDependencyFailureEvidence(input.callbackFailure.error),
      fenceFailure: input.fenceFailure === undefined
        ? null
        : runtimeDependencyFailureEvidence(input.fenceFailure.error),
      cleanupFailure: input.cleanupFailure === undefined
        ? null
        : runtimeDependencyFailureEvidence(input.cleanupFailure.error),
      lockPath: input.lockPath
    }
  );
}

type InstallLockLeaseControl = Readonly<{
  relocateOwnerDirectory(input: Readonly<{
    label: string;
    currentParentPath: string;
    successorParentPath: string;
  }>): void;
}>;

export async function withInstallLock<T>(
  lockPath: string,
  options: RuntimeDependencyInstallOptions,
  callback: (lease: InstallLockLeaseControl) => Promise<T>
): Promise<T> {
  const operationOptions = runtimeDependencyOperationOptions(options);
  const context = runtimeDependencyOperationContext(operationOptions);
  const pollIntervalMs = context.pollIntervalMs;
  const sleep = operationOptions.sleep ?? sleepMs;
  const { owner, ownerObservation } = await measureRuntimeDependencyOperationPhaseAsync(
    operationOptions,
    'lease-wait',
    async () => {
      let owner: InstallLockOwner | null = null;
      let ownerObservation: NoFollowOwnedFileObservation | null = null;

      // Every caller admits the lock below an already-created owner namespace.
      // Reopening that namespace through the no-follow chain prevents a redirected
      // parent from becoming the lease's hidden second authority.
      runtimeDependencyOperationRemainingMs(operationOptions, 'Install lock parent admission');
      inspectNoFollowDirectoryChain(path.dirname(lockPath), 'Install lock parent');

      while (true) {
        runtimeDependencyOperationRemainingMs(operationOptions, 'Install lock admission');
        const reclaimState = await reclaimLockState(`${lockPath}.reclaim`, lockPath, operationOptions);
        if (reclaimState === 'terminal-handoff') {
          throw new InstallLockTerminalHandoffObservedError(lockPath);
        }
        if (reclaimState === 'active') {
          await waitForRuntimeDependencyOperation(
            operationOptions,
            pollIntervalMs,
            sleep,
            `Waiting for install lock reclaim marker ${lockPath}`
          );
          continue;
        }
        runtimeDependencyOperationRemainingMs(operationOptions, 'Install lock publication fence');
        await operationOptions.beforeCommit?.();
        runtimeDependencyOperationRemainingMs(operationOptions, 'Install lock publication');
        owner = {
          createdAt: (operationOptions.now ?? (() => new Date().toISOString()))(),
          pid: process.pid,
          token: crypto.randomUUID()
        };
        const parent = inspectNoFollowDirectoryChain(path.dirname(lockPath), 'Install lock parent').target;
        const ownerBytes = Buffer.from(formatJsonFile(owner), 'utf8');
        try {
          publishExclusiveDurableCanonicalFile({
            parent,
            name: path.basename(lockPath),
            bytes: ownerBytes,
            validate: (bytes) => {
              const value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
              if (!isInstallLockOwner(value)) throw new Error('Install lock owner record is malformed.');
            }
          });
          runtimeDependencyOperationRemainingMs(operationOptions, 'Install lock publication readback');
        } catch (error) {
          // A valid existing lease, or a recently-created malformed lease, is
          // contention rather than an invitation to replace its bytes.  The
          // exact reclaimer below decides whether an old identity may be
          // removed. Parent/reparse failures remain typed blockers.
          const contention = error instanceof PhysicalNoFollowError &&
            error.code === 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED'
            ? observeNoFollowOwnedFile(lockPath, 'Install lock contention') !== null
            : (() => {
                const existing = observeNoFollowOwnedFile(lockPath, 'Install lock contention');
                return existing !== null;
              })();
          if (!contention) throw error;
        }
        const current = observeNoFollowOwnedFile(lockPath, 'Install lock owner');
        if (current !== null) {
          const currentOwner = parseInstallLockOwner(readNoFollowOwnedFileJson(current, 'Install lock owner'));
          if (currentOwner?.token === owner.token) {
            ownerObservation = current;
            break;
          }
        }
        owner = null;
        ownerObservation = null;
        runtimeDependencyOperationRemainingMs(operationOptions, 'Install lock orphan recovery');
        if (await reclaimOrphanInstallLock(lockPath, operationOptions)) {
          runtimeDependencyOperationRemainingMs(operationOptions, 'Install lock orphan recovery readback');
          continue;
        }
        await waitForRuntimeDependencyOperation(
          operationOptions,
          pollIntervalMs,
          sleep,
          `Waiting for install lock ${lockPath}`
        );
      }
      return Object.freeze({ owner, ownerObservation });
    }
  );

  let settlementLockPath = lockPath;
  let settlementOwnerObservation = ownerObservation;
  const leaseControl: InstallLockLeaseControl = Object.freeze({
    relocateOwnerDirectory(input): void {
      if (owner === null || settlementOwnerObservation === null) {
        throw new FailureError('RUNTIME-DEPS-003', 'Install lock relocation requires an admitted owner');
      }
      const currentParentPath = path.resolve(input.currentParentPath);
      const successorParentPath = path.resolve(input.successorParentPath);
      if (path.resolve(path.dirname(settlementLockPath)) !== currentParentPath) {
        throw new FailureError('RUNTIME-DEPS-003', 'Install lock relocation source does not own the admitted lease');
      }
      let migrationFailure: unknown;
      try {
        migrateRuntimeStateDirectoryGeneration({
          label: input.label,
          legacyPath: currentParentPath,
          currentPath: successorParentPath,
          mode: 'quiescent'
        });
      } catch (error) {
        migrationFailure = error;
      }
      const legacyReadback = inspectExactNoFollowDirectoryPresence(
        currentParentPath,
        `Install lock ${input.label} legacy parent readback`
      );
      const successorReadback = inspectExactNoFollowDirectoryPresence(
        successorParentPath,
        `Install lock ${input.label} successor parent readback`
      );
      if (legacyReadback.state === 'absent' && successorReadback.state === 'present' &&
          successorReadback.directory.target.device === settlementOwnerObservation.parent.device &&
          successorReadback.directory.target.inode === settlementOwnerObservation.parent.inode &&
          successorReadback.directory.target.objectId === settlementOwnerObservation.parent.objectId) {
        const relocatedLockPath = path.join(successorParentPath, path.basename(settlementLockPath));
        const relocated = observeNoFollowOwnedFile(relocatedLockPath, 'Install lock relocation readback');
        if (relocated !== null && relocated.device === settlementOwnerObservation.device &&
            relocated.inode === settlementOwnerObservation.inode &&
            relocated.size === settlementOwnerObservation.size) {
          const relocatedOwner = parseInstallLockOwner(
            readNoFollowOwnedFileJson(relocated, 'Install lock relocation owner readback')
          );
          if (relocatedOwner?.token === owner.token) {
            settlementLockPath = relocatedLockPath;
            settlementOwnerObservation = relocated;
          }
        }
      }
      if (migrationFailure !== undefined) throw migrationFailure;
      if (settlementLockPath !== path.join(successorParentPath, path.basename(lockPath))) {
        throw new FailureError(
          'RUNTIME-DEPS-003',
          'Install lock relocation did not preserve the admitted owner identity'
        );
      }
    }
  });

  let callbackFailed = false;
  let callbackFailure: RuntimeDependencyCapturedFailure | undefined;
  let callbackResult!: T;
  try {
    runtimeDependencyOperationRemainingMs(operationOptions, 'Install lock callback admission');
    callbackResult = await callback(leaseControl);
    runtimeDependencyOperationRemainingMs(operationOptions, 'Install lock callback settlement');
  } catch (error) {
    callbackFailed = true;
    callbackFailure = Object.freeze({ error });
  }

  // Settlement is deliberately outside the operation budget: once this
  // process owns the exact token, neither an exhausted deadline nor an abort
  // may strand it.  The caller fence is still observed, but its failure cannot
  // skip the retained identity/token CAS deletion below.
  let fenceFailure: RuntimeDependencyCapturedFailure | undefined;
  try {
    await operationOptions.beforeCommit?.();
  } catch (error) {
    fenceFailure = Object.freeze({ error });
  }
  let cleanupFailure: RuntimeDependencyCapturedFailure | undefined;
  let terminalHandoff = false;
  try {
    if (owner !== null && ownerObservation !== null) {
      const terminalHandoffRequest = typeof callbackResult === 'object' && callbackResult !== null
        ? installLockTerminalHandoffRequests.get(callbackResult)
        : undefined;
      if (!callbackFailed && fenceFailure === undefined && terminalHandoffRequest !== undefined) {
        const request = terminalHandoffRequest;
        const ownerBytes = Buffer.from(formatJsonFile(owner), 'utf8');
        const unsigned = Object.freeze({
          schema: COMPILER_DEPENDENCY_COORDINATION_CUTOVER_SCHEMA,
          compilerRootPhysical: request.compilerRootPhysical,
          coordinationRootPhysical: request.coordinationRootPhysical,
          lock: Object.freeze({
            device: ownerObservation.device,
            inode: ownerObservation.inode,
            size: ownerObservation.size
          }),
          lockOwnerBytesDigest: generatedStateDigest([...ownerBytes]),
          lockOwnerToken: owner.token,
          workspaceLocatorKey: request.workspaceLocatorKey
        });
        const marker = Object.freeze({
          ...unsigned,
          cutoverDigest: generatedStateDigest(canonicalJson(unsigned))
        });
        const markerBytes = Buffer.from(formatJsonFile(canonicalJson(marker)), 'utf8');
        const markerPath = `${lockPath}.reclaim`;
        publishExclusiveDurableCanonicalFile({
          parent: inspectNoFollowDirectoryChain(path.dirname(markerPath), 'Install lock terminal handoff parent').target,
          name: path.basename(markerPath),
          bytes: markerBytes,
          validate: (candidate) => { parseCompilerDependencyCoordinationCutover(candidate); }
        });
        const readback = observeNoFollowOwnedFile(markerPath, 'Install lock terminal handoff readback');
        if (readback === null || !readNoFollowOwnedFileBytes(readback, 'Install lock terminal handoff readback')
          .equals(markerBytes)) {
          throw new FailureError('RUNTIME-DEPS-003', 'Install lock terminal handoff failed exact readback');
        }
        const finalLock = observeNoFollowOwnedFile(lockPath, 'Install lock terminal handoff lock readback');
        if (finalLock === null || !sameNoFollowOwnedFileObservation(finalLock, ownerObservation) ||
            !readNoFollowOwnedFileBytes(finalLock, 'Install lock terminal handoff lock readback')
              .equals(ownerBytes)) {
          throw new FailureError(
            'RUNTIME-DEPS-003',
            'Install lock terminal handoff changed its retained legacy lock and is preserved'
          );
        }
        terminalHandoff = true;
      }
      if (terminalHandoff) {
        installLockTerminalHandoffRequests.delete(callbackResult as object);
      } else {
      if (settlementOwnerObservation === null) {
        throw new FailureError('RUNTIME-DEPS-003', 'Install lock settlement lost its admitted owner observation');
      }
      const current = observeNoFollowOwnedFile(settlementLockPath, 'Install lock owner cleanup');
      if (current === null) {
        throw new FailureError(
          'RUNTIME-DEPS-003',
          'Install lock owner disappeared before exact settlement',
          { lockPath: settlementLockPath, token: owner.token }
        );
      }
      const currentOwner = parseInstallLockOwner(
        readNoFollowOwnedFileJson(current, 'Install lock owner cleanup')
      );
      if (currentOwner?.token !== owner.token) {
        throw new FailureError(
          'RUNTIME-DEPS-003',
          'Install lock owner changed before exact settlement; replacement is preserved',
          { lockPath: settlementLockPath, token: owner.token }
        );
      }
      await settleInstallLockOwnedFileDeletion({
        assertExpected: (observation) => {
          const currentOwner = parseInstallLockOwner(
            readNoFollowOwnedFileJson(observation, 'Install lock owner cleanup retry')
          );
          if (currentOwner?.token !== owner!.token) {
            throw new FailureError(
              'RUNTIME-DEPS-003',
              'Install lock owner bytes changed during deletion settlement; replacement is preserved'
            );
          }
        },
        expected: settlementOwnerObservation,
        filePath: settlementLockPath,
        label: 'Install lock owner',
        options: operationOptions
      });
      }
    }
  } catch (error) {
    cleanupFailure = Object.freeze({ error });
  }

  if (callbackFailed) {
    if (fenceFailure !== undefined || cleanupFailure !== undefined) {
      throw runtimeDependencyInstallLockSettlementFailure({
        callbackFailure,
        cleanupFailure,
        fenceFailure,
        lockPath
      });
    }
    throw callbackFailure!.error;
  }
  if (fenceFailure !== undefined && cleanupFailure !== undefined) {
    throw runtimeDependencyInstallLockSettlementFailure({ cleanupFailure, fenceFailure, lockPath });
  }
  if (fenceFailure !== undefined) throw fenceFailure.error;
  if (cleanupFailure !== undefined) throw cleanupFailure.error;
  return callbackResult;
}

export type CompilerDependencyCoordinationSession = Readonly<{
  consumers: PhysicalDirectoryIdentity;
}>;

const COMPILER_DEPENDENCY_COORDINATION_CUTOVER_SCHEMA =
  'sec-compiler-dependency-coordination-cutover-v1' as const;
const COMPILER_DEPENDENCY_COORDINATION_LOCATOR_SCHEMA =
  'sec-compiler-dependency-coordination-locator-v1' as const;
const COMPILER_DEPENDENCY_COORDINATION_CUTOVER_KEYS = Object.freeze([
  'compilerRootPhysical', 'coordinationRootPhysical', 'cutoverDigest',
  'lock', 'lockOwnerBytesDigest', 'lockOwnerToken', 'schema', 'workspaceLocatorKey'
]);

export type CompilerDependencyCoordinationCutover = Readonly<{
  schema: typeof COMPILER_DEPENDENCY_COORDINATION_CUTOVER_SCHEMA;
  compilerRootPhysical: GeneratedStatePhysicalIdentity;
  coordinationRootPhysical: GeneratedStatePhysicalIdentity;
  cutoverDigest: `sha256:${string}`;
  lock: Readonly<{ device: string; inode: string; size: number }>;
  lockOwnerBytesDigest: `sha256:${string}`;
  lockOwnerToken: string;
  workspaceLocatorKey: `sha256:${string}`;
}>;

const COMPILER_DEPENDENCY_COORDINATION_LOCATOR_KEYS = Object.freeze([
  'cutoverDigest', 'locatorDigest', 'schema', 'stateRoot', 'stateRootPhysical'
]);

type CompilerDependencyCoordinationLocator = Readonly<{
  schema: typeof COMPILER_DEPENDENCY_COORDINATION_LOCATOR_SCHEMA;
  cutoverDigest: `sha256:${string}`;
  locatorDigest: `sha256:${string}`;
  stateRoot: string;
  stateRootPhysical: GeneratedStatePhysicalIdentity;
}>;

function parseCompilerDependencyCoordinationCutover(
  bytes: Uint8Array
): CompilerDependencyCoordinationCutover {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value = JSON.parse(text) as unknown;
  if (!hasExactObjectKeys(value, COMPILER_DEPENDENCY_COORDINATION_CUTOVER_KEYS)) {
    throw new FailureError('RUNTIME-DEPS-004', 'Compiler dependency coordination cutover has noncanonical keys');
  }
  const cutover = value as CompilerDependencyCoordinationCutover;
  if (cutover.schema !== COMPILER_DEPENDENCY_COORDINATION_CUTOVER_SCHEMA ||
      !isCanonicalGeneratedStatePhysicalIdentity(cutover.compilerRootPhysical) ||
      !isCanonicalGeneratedStatePhysicalIdentity(cutover.coordinationRootPhysical) ||
      !isSha256Digest(cutover.cutoverDigest) || !isSha256Digest(cutover.lockOwnerBytesDigest) ||
      !isSha256Digest(cutover.workspaceLocatorKey) || typeof cutover.lockOwnerToken !== 'string' ||
      cutover.lockOwnerToken.length === 0 || typeof cutover.lock !== 'object' || cutover.lock === null ||
      typeof cutover.lock.device !== 'string' || typeof cutover.lock.inode !== 'string' ||
      !Number.isSafeInteger(cutover.lock.size) || cutover.lock.size < 1) {
    throw new FailureError('RUNTIME-DEPS-004', 'Compiler dependency coordination cutover fields are invalid');
  }
  const { cutoverDigest: _cutoverDigest, ...unsigned } = cutover;
  if (generatedStateDigest(canonicalJson(unsigned)) !== cutover.cutoverDigest ||
      formatJsonFile(canonicalJson(cutover)) !== text) {
    throw new FailureError('RUNTIME-DEPS-004', 'Compiler dependency coordination cutover digest or bytes changed');
  }
  return Object.freeze(cutover);
}

function parseCompilerDependencyCoordinationLocator(
  bytes: Uint8Array
): CompilerDependencyCoordinationLocator {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value = JSON.parse(text) as unknown;
  if (!hasExactObjectKeys(value, COMPILER_DEPENDENCY_COORDINATION_LOCATOR_KEYS)) {
    throw new FailureError('RUNTIME-DEPS-004', 'Compiler dependency coordination locator has noncanonical keys');
  }
  const locator = value as CompilerDependencyCoordinationLocator;
  if (locator.schema !== COMPILER_DEPENDENCY_COORDINATION_LOCATOR_SCHEMA ||
      !isCanonicalAbsolutePath(locator.stateRoot) ||
      !isCanonicalGeneratedStatePhysicalIdentity(locator.stateRootPhysical) ||
      !isSha256Digest(locator.cutoverDigest) || !isSha256Digest(locator.locatorDigest)) {
    throw new FailureError('RUNTIME-DEPS-004', 'Compiler dependency coordination locator fields are invalid');
  }
  const { locatorDigest: _locatorDigest, ...unsigned } = locator;
  if (generatedStateDigest(canonicalJson(unsigned)) !== locator.locatorDigest ||
      formatJsonFile(canonicalJson(locator)) !== text) {
    throw new FailureError('RUNTIME-DEPS-004', 'Compiler dependency coordination locator digest or bytes changed');
  }
  return Object.freeze(locator);
}

export function compilerDependencyCoordinationMarkerPath(compilerDependencyRoot: string): string {
  return path.join(compilerDependencyRoot, '.tmp', 'dependency-installs', 'compiler.lock.reclaim');
}

export function compilerDependencyCoordinationLocatorPath(compilerDependencyRoot: string): string {
  return `${compilerDependencyCoordinationMarkerPath(compilerDependencyRoot)}.locator`;
}

export function readCompilerDependencyCoordinationCutover(
  compilerDependencyRoot: string
): CompilerDependencyCoordinationCutover {
  const legacyLockPath = path.join(
    compilerDependencyRoot,
    '.tmp',
    'dependency-installs',
    'compiler.lock'
  );
  const marker = observeNoFollowOwnedFile(
    compilerDependencyCoordinationMarkerPath(compilerDependencyRoot),
    'Compiler dependency coordination cutover'
  );
  const legacyLock = observeNoFollowOwnedFile(legacyLockPath, 'Compiler dependency coordination legacy lock');
  const migrationRequired = (message: string): never => {
    throw new FailureError('RUNTIME-DEPS-004', message, { migrationRequired: true });
  };
  if (marker === null || legacyLock === null) {
    return migrationRequired('Compiler dependency coordination requires an explicit architecture migration');
  }
  let cutover: CompilerDependencyCoordinationCutover;
  try {
    cutover = parseCompilerDependencyCoordinationCutover(
      readNoFollowOwnedFileBytes(marker, 'Compiler dependency coordination cutover')
    );
  } catch {
    return migrationRequired('Compiler dependency coordination cutover is unknown and preserved');
  }
  const lockBytes = readNoFollowOwnedFileBytes(
    legacyLock,
    'Compiler dependency coordination legacy lock'
  );
  const lockOwner = (() => {
    try {
      return parseInstallLockOwner(JSON.parse(lockBytes.toString('utf8')) as unknown);
    } catch {
      return null;
    }
  })();
  const compilerRootPhysical = generatedStatePhysicalIdentity(inspectNoFollowDirectoryChain(
    compilerDependencyRoot,
    'Compiler dependency coordination compiler root'
  ).target);
  if (lockOwner === null || lockOwner.token !== cutover.lockOwnerToken ||
      generatedStateDigest([...lockBytes]) !== cutover.lockOwnerBytesDigest ||
      legacyLock.device !== cutover.lock.device || legacyLock.inode !== cutover.lock.inode ||
      legacyLock.size !== cutover.lock.size ||
      !sameGeneratedStateIdentity(compilerRootPhysical, cutover.compilerRootPhysical)) {
    return migrationRequired('Compiler dependency coordination cutover binding changed and is preserved');
  }
  return cutover;
}

export function readCompilerDependencyCoordinationLocator(
  compilerDependencyRoot: string,
  cutover: CompilerDependencyCoordinationCutover
): CompilerDependencyCoordinationLocator {
  const migrationRequired = (message: string): never => {
    throw new FailureError('RUNTIME-DEPS-004', message, { migrationRequired: true });
  };
  const observation = observeNoFollowOwnedFile(
    compilerDependencyCoordinationLocatorPath(compilerDependencyRoot),
    'Compiler dependency coordination locator'
  );
  if (observation === null) {
    return migrationRequired('Compiler dependency coordination locator requires an explicit architecture migration');
  }
  let locator: CompilerDependencyCoordinationLocator;
  try {
    locator = parseCompilerDependencyCoordinationLocator(
      readNoFollowOwnedFileBytes(observation, 'Compiler dependency coordination locator')
    );
  } catch {
    return migrationRequired('Compiler dependency coordination locator is unknown and preserved');
  }
  if (locator.cutoverDigest !== cutover.cutoverDigest) {
    return migrationRequired('Compiler dependency coordination locator binding changed and is preserved');
  }
  return locator;
}

export function assertCompilerDependencyCoordinationCutover(input: Readonly<{
  compilerDependencyRoot: string;
  coordinationRoot: PhysicalDirectoryIdentity;
  workspaceLocatorKey: `sha256:${string}`;
}>): void {
  const cutover = readCompilerDependencyCoordinationCutover(input.compilerDependencyRoot);
  const migrationRequired = (message: string): never => {
    throw new FailureError('RUNTIME-DEPS-004', message, { migrationRequired: true });
  };
  if (input.workspaceLocatorKey !== cutover.workspaceLocatorKey ||
      !sameGeneratedStateIdentity(
        generatedStatePhysicalIdentity(input.coordinationRoot),
        cutover.coordinationRootPhysical
      )) {
    return migrationRequired('Compiler dependency coordination cutover binding changed and is preserved');
  }
}

function compilerDependencyCoordinationLocatorRecord(input: Readonly<{
  cutover: CompilerDependencyCoordinationCutover;
  stateRoot: PhysicalDirectoryIdentity;
}>): CompilerDependencyCoordinationLocator {
  const unsigned = Object.freeze({
    schema: COMPILER_DEPENDENCY_COORDINATION_LOCATOR_SCHEMA,
    stateRoot: input.stateRoot.finalPath,
    stateRootPhysical: generatedStatePhysicalIdentity(input.stateRoot),
    cutoverDigest: input.cutover.cutoverDigest
  });
  return Object.freeze({
    ...unsigned,
    locatorDigest: generatedStateDigest(canonicalJson(unsigned))
  });
}

export function publishCompilerDependencyCoordinationLocator(input: Readonly<{
  compilerDependencyRoot: string;
  cutover: CompilerDependencyCoordinationCutover;
  stateRoot: PhysicalDirectoryIdentity;
}>): CompilerDependencyCoordinationLocator {
  const locator = compilerDependencyCoordinationLocatorRecord(input);
  const bytes = Buffer.from(formatJsonFile(canonicalJson(locator)), 'utf8');
  const locatorPath = compilerDependencyCoordinationLocatorPath(input.compilerDependencyRoot);
  const parent = inspectNoFollowDirectoryChain(
    path.dirname(locatorPath),
    'Compiler dependency coordination locator parent'
  ).target;
  publishExclusiveDurableCanonicalFile({
    parent,
    name: path.basename(locatorPath),
    bytes,
    validate: (candidate) => { parseCompilerDependencyCoordinationLocator(candidate); }
  });
  const readback = observeNoFollowOwnedFile(locatorPath, 'Compiler dependency coordination locator readback');
  if (readback === null || !readNoFollowOwnedFileBytes(
    readback,
    'Compiler dependency coordination locator readback'
  ).equals(bytes)) {
    throw new FailureError('RUNTIME-DEPS-004', 'Compiler dependency coordination locator failed exact readback');
  }
  return locator;
}

export function compilerDependencyCoordinationRoot(workspaceStateRoot: string): string {
  return path.join(workspaceStateRoot, 'compiler-dependency-coordination', 'journal');
}

export function legacyCompilerDependencyCoordinationRoot(workspaceStateRoot: string): string {
  return path.join(workspaceStateRoot, 'compiler-dependency-coordination', 'v1');
}

type CompilerDependencyCoordinationLayout = Readonly<{
  kind: 'current' | 'legacy';
  rootPath: string;
  root: PhysicalDirectoryIdentity;
}>;

export function inspectCompilerDependencyCoordinationLayout(
  workspaceStateRoot: string,
  expectedPhysical?: GeneratedStatePhysicalIdentity
): CompilerDependencyCoordinationLayout {
  const currentPath = compilerDependencyCoordinationRoot(workspaceStateRoot);
  const legacyPath = legacyCompilerDependencyCoordinationRoot(workspaceStateRoot);
  const current = inspectExactNoFollowDirectoryPresence(
    currentPath,
    'Compiler dependency coordination current root'
  );
  const legacy = inspectExactNoFollowDirectoryPresence(
    legacyPath,
    'Compiler dependency coordination legacy root'
  );
  if (current.state === 'present' && legacy.state === 'present') {
    throw new FailureError(
      'RUNTIME-DEPS-004',
      'Compiler dependency coordination current and legacy roots both exist and are preserved',
      { migrationRequired: true }
    );
  }
  const selected = current.state === 'present'
    ? Object.freeze({ kind: 'current' as const, rootPath: currentPath, root: current.directory.target })
    : legacy.state === 'present'
      ? Object.freeze({ kind: 'legacy' as const, rootPath: legacyPath, root: legacy.directory.target })
      : null;
  if (selected === null) {
    throw new FailureError(
      'RUNTIME-DEPS-004',
      'Compiler dependency coordination root is unavailable and is preserved',
      { migrationRequired: true }
    );
  }
  if (expectedPhysical !== undefined && !sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(selected.root),
    expectedPhysical
  )) {
    throw new FailureError(
      'RUNTIME-DEPS-004',
      'Compiler dependency coordination physical binding changed and is preserved',
      { migrationRequired: true }
    );
  }
  inspectNoFollowDirectoryChain(
    path.join(selected.rootPath, 'consumers'),
    'Compiler dependency coordination existing consumers'
  );
  return selected;
}

export function resolveCompilerDependencyCoordinationRoots(
  compilerDependencyRoot: string,
  options: Readonly<{ allowLegacyLayout?: boolean }> = {}
): Readonly<{
  cutover: CompilerDependencyCoordinationCutover;
  locator: CompilerDependencyCoordinationLocator;
  roots: ReturnType<typeof resolveWorkspaceRuntimeRoots>;
  layout: CompilerDependencyCoordinationLayout;
}> {
  const cutover = readCompilerDependencyCoordinationCutover(compilerDependencyRoot);
  const locator = readCompilerDependencyCoordinationLocator(compilerDependencyRoot, cutover);
  const roots = resolveWorkspaceRuntimeRoots({
    repositoryRoot: compilerDependencyRoot,
    environment: Object.freeze({ ...process.env, SEC_STATE_HOME: locator.stateRoot })
  });
  let stateRoot: PhysicalDirectoryIdentity;
  let layout: CompilerDependencyCoordinationLayout;
  try {
    stateRoot = inspectNoFollowDirectoryChain(
      roots.stateRoot,
      'Compiler dependency coordination located Runtime State root'
    ).target;
    inspectNoFollowDirectoryChain(
      roots.workspaceStateRoot,
      'Compiler dependency coordination located workspace State root'
    );
    layout = inspectCompilerDependencyCoordinationLayout(
      roots.workspaceStateRoot,
      cutover.coordinationRootPhysical
    );
  } catch {
    throw new FailureError(
      'RUNTIME-DEPS-004',
      'Compiler dependency coordination locator is unavailable and is preserved',
      { migrationRequired: true }
    );
  }
  if (layout.kind === 'legacy' && options.allowLegacyLayout !== true) {
    throw new FailureError(
      'RUNTIME-DEPS-004',
      'Compiler dependency coordination legacy layout requires an explicit migration',
      { migrationRequired: true }
    );
  }
  if (roots.workspaceLocatorKey !== cutover.workspaceLocatorKey ||
      !sameHostPath(roots.stateRoot, locator.stateRoot) ||
      !sameGeneratedStateIdentity(generatedStatePhysicalIdentity(stateRoot), locator.stateRootPhysical)) {
    throw new FailureError(
      'RUNTIME-DEPS-004',
      'Compiler dependency coordination locator does not resolve its bound Runtime State layout',
      { migrationRequired: true }
    );
  }
  return Object.freeze({ cutover, locator, roots, layout });
}

const compilerDependencyCoordinationSessions = new WeakMap<object, CompilerDependencyCoordinationSession>();

export async function withDependencyCoordinationLease<T>(
  compilerDependencyRoot: string,
  options: RuntimeDependencyInstallOptions,
  callback: (operationOptions: RuntimeDependencyOperationOptions) => Promise<T>,
  hooks: Readonly<{
    beforeOperation?(
      session: CompilerDependencyCoordinationSession,
      operationOptions: RuntimeDependencyOperationOptions
    ): Promise<void>;
  }> = {}
): Promise<T> {
  const operationOptions = runtimeDependencyOperationOptions(options);
  const root = path.resolve(compilerDependencyRoot);
  const resolved = resolveCompilerDependencyCoordinationRoots(root);
  const roots = resolved.roots;
  const coordinationRoot = resolved.layout.rootPath;
  const consumersRoot = path.join(coordinationRoot, 'consumers');
  const context = runtimeDependencyOperationContext(operationOptions);
  const authority = await acquireRuntimeStatePhysicalAuthority({
    repositoryRoot: root,
    stateRoot: roots.stateRoot,
    cacheRoot: roots.cacheRoot,
    requiredDirectories: [roots.workspaceStateRoot, coordinationRoot, consumersRoot],
    deadlineAtUnixMs: context.deadlineAtUnixMs
  });
  let result: { value: T } | undefined;
  let primary: { error: unknown } | undefined;
  try {
    result = { value: await withInstallLock(
      path.join(coordinationRoot, 'compiler.lock'),
      operationOptions,
      async () => {
        authority.assertRootIdentityCurrent();
        const current = resolveCompilerDependencyCoordinationRoots(root);
        if (current.cutover.cutoverDigest !== resolved.cutover.cutoverDigest ||
            current.locator.locatorDigest !== resolved.locator.locatorDigest ||
            !sameGeneratedStateIdentity(
              generatedStatePhysicalIdentity(authority.stateRoot),
              current.locator.stateRootPhysical
            ) || !sameGeneratedStateIdentity(
              generatedStatePhysicalIdentity(authority.directory(coordinationRoot)),
              current.cutover.coordinationRootPhysical
            )) {
          throw new FailureError(
            'RUNTIME-DEPS-004',
            'Compiler dependency coordination binding changed during admission',
            { migrationRequired: true }
          );
        }
        const session = Object.freeze({ consumers: authority.directory(consumersRoot) });
        compilerDependencyCoordinationSessions.set(operationOptions, session);
        try {
          await hooks.beforeOperation?.(session, operationOptions);
          return await callback(operationOptions);
        } finally {
          compilerDependencyCoordinationSessions.delete(operationOptions);
        }
      }
    ) };
  } catch (error) {
    primary = { error };
  }
  let releaseFailure: { error: unknown } | undefined;
  try {
    await authority.release();
  } catch (error) {
    releaseFailure = { error };
  }
  if (primary !== undefined) {
    if (releaseFailure !== undefined) {
      throw new AggregateError(
        [primary.error, releaseFailure.error],
        'Compiler dependency coordination operation and Runtime State authority settlement both failed'
      );
    }
    throw primary.error;
  }
  if (releaseFailure !== undefined) throw releaseFailure.error;
  return result!.value;
}

export function compilerDependencyCoordinationSession(
  options: RuntimeDependencyOperationOptions
): CompilerDependencyCoordinationSession {
  const session = compilerDependencyCoordinationSessions.get(options);
  if (session === undefined) {
    throw new FailureError(
      'RUNTIME-DEPS-004',
      'Compiler dependency consumer operation has no Runtime State coordination lease'
    );
  }
  return session;
}

