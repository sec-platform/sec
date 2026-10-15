import path from 'node:path';
import { canonicalJson } from '../../../../contracts/canonical.ts';
import { CodedFailure } from '../../../../contracts/failure.ts';
import { formatJsonFile } from '../../../../contracts/json-text.ts';
import { generatedStateDigest, type GeneratedStatePhysicalIdentity } from '../../../../execution/generated-state/contract.ts';
import { inspectExactNoFollowDirectoryPresence, inspectNoFollowDirectoryChain, inspectNoFollowOrdinaryFileEntry, readNoFollowOrdinaryFile, type PhysicalDirectoryIdentity } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { resolveSecWorkspaceRuntimeRoots } from '../../../runtime-state/workspace-state/paths.ts';
import { generatedStatePhysicalIdentity, hasExactObjectKeys, isCanonicalAbsolutePath, isCanonicalGeneratedStatePhysicalIdentity, isSha256Digest, sameGeneratedStateIdentity } from './dependency-transition/contract.ts';
import { sameHostPath } from './host-path.ts';

/** Original durable coordination location; observation never creates or repairs it. */
export interface InstallLockOwner {
  createdAt: string;
  pid: number;
  token: string;
}


export type NoFollowOwnedFileObservation = Readonly<{
  parent: PhysicalDirectoryIdentity;
  name: string;
  device: string;
  inode: string;
  size: number;
}>;

export function isInstallLockOwner(value: unknown): value is InstallLockOwner {
  const owner = value as Partial<InstallLockOwner> | null;
  return owner !== null && typeof owner === 'object' &&
    typeof owner.createdAt === 'string' && Number.isSafeInteger(owner.pid) && (owner.pid ?? 0) > 0 &&
    typeof owner.token === 'string' && owner.token.length > 0;
}


export function observeNoFollowOwnedFile(
  filePath: string,
  label: string
): NoFollowOwnedFileObservation | null {
  const presence = inspectExactNoFollowDirectoryPresence(path.dirname(filePath), `${label} parent`);
  if (presence.state === 'absent') return null;
  const parent = presence.directory.target;
  const name = path.basename(filePath);
  const entry = inspectNoFollowOrdinaryFileEntry(parent, name);
  if (entry === null) return null;
  if (entry.kind !== 'file') {
    throw new CodedFailure('RUNTIME-DEPS-003', `${label} is occupied by a non-file identity and is preserved`, {
      path: filePath,
      kind: entry.kind
    });
  }
  return Object.freeze({
    parent,
    name,
    device: entry.device,
    inode: entry.inode,
    size: entry.size
  });
}

export function sameNoFollowOwnedFileObservation(
  left: NoFollowOwnedFileObservation,
  right: NoFollowOwnedFileObservation
): boolean {
  return left.parent.path === right.parent.path &&
    left.parent.device === right.parent.device &&
    left.parent.inode === right.parent.inode &&
    left.parent.objectId === right.parent.objectId &&
    left.name === right.name && left.device === right.device &&
    left.inode === right.inode && left.size === right.size;
}

export function readNoFollowOwnedFileBytes(
  observation: NoFollowOwnedFileObservation,
  label: string
): Buffer {
  const before = observeNoFollowOwnedFile(
    path.join(observation.parent.path, observation.name),
    `${label} read`
  );
  if (before === null || !sameNoFollowOwnedFileObservation(before, observation)) {
    throw new CodedFailure('RUNTIME-DEPS-003', `${label} identity changed before read and is preserved`);
  }
  const bytes = readNoFollowOrdinaryFile(observation.parent, observation.name);
  if (bytes === null) {
    throw new CodedFailure('RUNTIME-DEPS-003', `${label} disappeared during read and is preserved`);
  }
  const after = observeNoFollowOwnedFile(
    path.join(observation.parent.path, observation.name),
    `${label} readback`
  );
  if (after === null || !sameNoFollowOwnedFileObservation(after, observation)) {
    throw new CodedFailure('RUNTIME-DEPS-003', `${label} identity changed during read and is preserved`);
  }
  return Buffer.from(bytes);
}


export function parseInstallLockOwner(value: unknown): InstallLockOwner | null {
  return isInstallLockOwner(value) ? value : null;
}


export const COMPILER_DEPENDENCY_COORDINATION_CUTOVER_SCHEMA =
  'sec-compiler-dependency-coordination-cutover-v1' as const;
export const COMPILER_DEPENDENCY_COORDINATION_LOCATOR_SCHEMA =
  'sec-compiler-dependency-coordination-locator-v1' as const;
export const COMPILER_DEPENDENCY_COORDINATION_CUTOVER_KEYS = Object.freeze([
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

export const COMPILER_DEPENDENCY_COORDINATION_LOCATOR_KEYS = Object.freeze([
  'cutoverDigest', 'locatorDigest', 'schema', 'stateRoot', 'stateRootPhysical'
]);

export type CompilerDependencyCoordinationLocator = Readonly<{
  schema: typeof COMPILER_DEPENDENCY_COORDINATION_LOCATOR_SCHEMA;
  cutoverDigest: `sha256:${string}`;
  locatorDigest: `sha256:${string}`;
  stateRoot: string;
  stateRootPhysical: GeneratedStatePhysicalIdentity;
}>;

export function parseCompilerDependencyCoordinationCutover(
  bytes: Uint8Array
): CompilerDependencyCoordinationCutover {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value = JSON.parse(text) as unknown;
  if (!hasExactObjectKeys(value, COMPILER_DEPENDENCY_COORDINATION_CUTOVER_KEYS)) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency coordination cutover has noncanonical keys');
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
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency coordination cutover fields are invalid');
  }
  const { cutoverDigest: _cutoverDigest, ...unsigned } = cutover;
  if (generatedStateDigest(canonicalJson(unsigned)) !== cutover.cutoverDigest ||
      formatJsonFile(canonicalJson(cutover)) !== text) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency coordination cutover digest or bytes changed');
  }
  return Object.freeze(cutover);
}

export function parseCompilerDependencyCoordinationLocator(
  bytes: Uint8Array
): CompilerDependencyCoordinationLocator {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value = JSON.parse(text) as unknown;
  if (!hasExactObjectKeys(value, COMPILER_DEPENDENCY_COORDINATION_LOCATOR_KEYS)) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency coordination locator has noncanonical keys');
  }
  const locator = value as CompilerDependencyCoordinationLocator;
  if (locator.schema !== COMPILER_DEPENDENCY_COORDINATION_LOCATOR_SCHEMA ||
      !isCanonicalAbsolutePath(locator.stateRoot) ||
      !isCanonicalGeneratedStatePhysicalIdentity(locator.stateRootPhysical) ||
      !isSha256Digest(locator.cutoverDigest) || !isSha256Digest(locator.locatorDigest)) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency coordination locator fields are invalid');
  }
  const { locatorDigest: _locatorDigest, ...unsigned } = locator;
  if (generatedStateDigest(canonicalJson(unsigned)) !== locator.locatorDigest ||
      formatJsonFile(canonicalJson(locator)) !== text) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency coordination locator digest or bytes changed');
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
    throw new CodedFailure('RUNTIME-DEPS-004', message, { migrationRequired: true });
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
    throw new CodedFailure('RUNTIME-DEPS-004', message, { migrationRequired: true });
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


export function resolveCompilerDependencyCoordinationRoots(compilerDependencyRoot: string): Readonly<{
  cutover: CompilerDependencyCoordinationCutover;
  locator: CompilerDependencyCoordinationLocator;
  roots: ReturnType<typeof resolveSecWorkspaceRuntimeRoots>;
}> {
  const cutover = readCompilerDependencyCoordinationCutover(compilerDependencyRoot);
  const locator = readCompilerDependencyCoordinationLocator(compilerDependencyRoot, cutover);
  const roots = resolveSecWorkspaceRuntimeRoots({
    repositoryRoot: compilerDependencyRoot,
    environment: Object.freeze({ ...process.env, SEC_STATE_HOME: locator.stateRoot })
  });
  const coordinationRoot = path.join(
    roots.workspaceStateRoot,
    'compiler-dependency-coordination',
    'v1'
  );
  let stateRoot: PhysicalDirectoryIdentity;
  let coordination: PhysicalDirectoryIdentity;
  try {
    stateRoot = inspectNoFollowDirectoryChain(
      roots.stateRoot,
      'Compiler dependency coordination located Runtime State root'
    ).target;
    inspectNoFollowDirectoryChain(
      roots.workspaceStateRoot,
      'Compiler dependency coordination located workspace State root'
    );
    coordination = inspectNoFollowDirectoryChain(
      coordinationRoot,
      'Compiler dependency coordination located root'
    ).target;
    inspectNoFollowDirectoryChain(
      path.join(coordinationRoot, 'consumers'),
      'Compiler dependency coordination existing consumers'
    );
  } catch {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Compiler dependency coordination locator is unavailable and is preserved',
      { migrationRequired: true }
    );
  }
  if (roots.workspaceLocatorKey !== cutover.workspaceLocatorKey ||
      !sameHostPath(roots.stateRoot, locator.stateRoot) ||
      !sameGeneratedStateIdentity(generatedStatePhysicalIdentity(stateRoot), locator.stateRootPhysical) ||
      !sameGeneratedStateIdentity(
        generatedStatePhysicalIdentity(coordination),
        cutover.coordinationRootPhysical
      )) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Compiler dependency coordination locator does not resolve its bound Runtime State layout',
      { migrationRequired: true }
    );
  }
  return Object.freeze({ cutover, locator, roots });
}


export function observeCompilerDependencyCoordinationRoots(root: string): ReturnType<typeof resolveCompilerDependencyCoordinationRoots> | null {
  if (observeNoFollowOwnedFile(compilerDependencyCoordinationLocatorPath(root), 'Compiler dependency durable locator') === null) return null;
  return resolveCompilerDependencyCoordinationRoots(root);
}
