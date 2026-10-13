import path from 'node:path';
import {
  createNoFollowDirectoryCreateTestActorForTests,
  createNoFollowOrdinaryDirectoryChain,
  createRetainedNoFollowFileTransactionTestActorForTests,
  deleteRetainedNoFollowEntry,
  flushNoFollowDirectory,
  inspectNoFollowDirectoryChain,
  inspectNoFollowDirectoryLeaf,
  inspectNoFollowOrdinaryFileEntry,
  PhysicalNoFollowError,
  readNoFollowOrdinaryFile,
  type RetainedNoFollowFileObservation,
  type RetainedNoFollowFileTransaction,
  retainNoFollowFileTransaction,
  scanNoFollowDirectoryDirectMetadata
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { byteDigest, type DurabilityEvent } from './document-control-journal-codec.ts';
import {
  assertInitiallyAbsentEntryTransition,
  classifyInitiallyAbsentEntryTuple,
  documentControlRecoveryEntryStem,
  type DocumentControlRecoveryTargetKey,
  type InitiallyAbsentTupleEdge,
  type InitiallyAbsentTupleEntry,
  type InitiallyAbsentTuplePlatform,
  type InitiallyAbsentTupleState
} from './document-control-plane-contract.ts';

/**
 * Document-control exact PRE/NEXT publication over the existing no-follow physical
 * owner. Retained identity, no-replace transitions, flush ordering and exact-byte
 * cleanup are one responsibility; generic filesystem calls cannot replace them.
 * This leaf knows no freeze phase or terminal outcome. The recovery owner supplies
 * exact logical targets and owns when these admitted transitions may occur.
 */

export type AnchoredObjectIdentity = Readonly<{ device: string; inode: string }> | string;

interface RetainedPublishObjectAuthority {
  readonly transaction: RetainedNoFollowFileTransaction;
  readonly observation: RetainedNoFollowFileObservation;
  readonly relativePath: string;
}

export function sameAnchoredObjectIdentity(
  left: AnchoredObjectIdentity,
  right: AnchoredObjectIdentity
): boolean {
  if (typeof left === 'string' || typeof right === 'string') {
    return typeof left === 'string' && left === right;
  }
  return left.device === right.device && left.inode === right.inode;
}

export type DurabilityObserver = (
  event: DurabilityEvent
) => Promise<void> | void;

export class DurabilityBarrierError extends Error {
  readonly code = 'DOCUMENT-CONTROL-DURABILITY-001' as const;
  readonly operation: 'file-flush' | 'parent-directory-barrier';
  readonly targetPath: string;

  constructor(input: {
    operation: 'file-flush' | 'parent-directory-barrier';
    targetPath: string;
    cause: unknown;
  }) {
    super(
      `Document control ${input.operation} is unsupported or failed for ${input.targetPath}.`,
      { cause: input.cause }
    );
    this.name = 'DurabilityBarrierError';
    this.operation = input.operation;
    this.targetPath = input.targetPath;
  }
}

export class UnsafeAnchoredPathError extends Error {
  readonly code = 'DOCUMENT-CONTROL-UNSAFE-PATH-001' as const;
  readonly targetPath: string;
  readonly reparseTag: number | null;

  constructor(input: {
    label: string;
    targetPath: string;
    reparseTag?: number;
    cause?: unknown;
  }) {
    super(
      `${input.label} must not traverse or target a symbolic link, junction, or reparse point.`,
      input.cause === undefined ? undefined : { cause: input.cause }
    );
    this.name = 'UnsafeAnchoredPathError';
    this.targetPath = input.targetPath;
    this.reparseTag = input.reparseTag ?? null;
  }
}

export class UnsupportedAnchoredPathEffectError extends Error {
  readonly code = 'DOCUMENT-CONTROL-POSIX-CAPABILITY-001' as const;
  readonly capability: string;

  constructor(capability: string) {
    super(`Anchored document-control POSIX effects require the ${capability} capability.`);
    this.name = 'UnsupportedAnchoredPathEffectError';
    this.capability = capability;
  }
}

export interface FreezeDurabilityOptions {
  readonly observer?: DurabilityObserver;
  /** Internal deterministic test seam. Production always uses the platform barrier. */
  readonly parentDirectoryBarrier?: (directoryPath: string) => Promise<void>;
  /** Internal deterministic test seam invoked only after rename source/parent anchors are open. */
  readonly beforeAnchoredRename?: (event: Readonly<{
    label: string;
    sourcePath: string;
    targetPath: string;
  }>) => Promise<void> | void;
  /** Internal deterministic test seam after namespace mutation and before its retained-object flush. */
  readonly afterAnchoredNamespaceMutationBeforeFlush?: (event: Readonly<{
    label: string;
    sourcePath: string;
    targetPath: string;
  }>) => Promise<void> | void;
  /** Internal deterministic seam after containing-parent anchors are retained and before creation. */
  readonly beforeAnchoredCreate?: (event: Readonly<{
    label: string;
    kind: 'directory' | 'file';
    parentPath: string;
    targetPath: string;
  }>) => void;
  /** Internal deterministic seam after exact cleanup bytes are read from the opened object. */
  readonly beforeAnchoredCleanup?: (event: Readonly<{
    label: string;
    filePath: string;
  }>) => Promise<void> | void;
  /** Internal Linux-only deterministic seam after exact PRE recovery link identity readback. */
  readonly afterExactPreRecoveryLink?: (event: Readonly<{
    label: string;
    targetPath: string;
    recoveryPath: string;
  }>) => Promise<void> | void;
  readonly beforeCreatedParentBarrier?: (event: Readonly<{
    parentPath: string;
    createdPath: string;
  }>) => void;
  readonly createdParentBarrierObserver?: (event: Readonly<{
    parentPath: string;
    createdPath: string;
  }>) => void;
}

function systemErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

export function isMissingError(error: unknown): boolean {
  return systemErrorCode(error) === 'ENOENT'
    || (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT');
}

export function pathComparisonValue(candidate: string): string {
  const resolved = path.resolve(candidate);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function assertPathContained(root: string, candidate: string, label: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new UnsafeAnchoredPathError({ label, targetPath: candidate });
  }
}

export function physicalIdentity(entry: Readonly<{ device: string; inode: string }>): Readonly<{ device: string; inode: string }> {
  return Object.freeze({ device: entry.device, inode: entry.inode });
}

function transactionRelativePath(boundaryRoot: string, candidatePath: string, label: string): string {
  assertPathContained(boundaryRoot, candidatePath, label);
  const relative = path.relative(path.resolve(boundaryRoot), path.resolve(candidatePath));
  if (relative.length === 0) {
    throw new UnsafeAnchoredPathError({ label, targetPath: candidatePath });
  }
  return relative;
}

export function mapDocumentPhysicalError(error: unknown, input: Readonly<{
  label: string;
  targetPath: string;
  operation?: 'file-flush' | 'parent-directory-barrier';
}>): never {
  if (error instanceof DurabilityBarrierError
      || error instanceof UnsafeAnchoredPathError
      || error instanceof UnsupportedAnchoredPathEffectError) throw error;
  if (error instanceof PhysicalNoFollowError) {
    if (error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') {
      throw Object.assign(new Error(`${input.label} is absent.`, { cause: error }), { code: 'ENOENT' });
    }
    if (error.code === 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED' && input.operation !== undefined) {
      throw new DurabilityBarrierError({
        operation: input.operation,
        targetPath: input.targetPath,
        cause: error
      });
    }
    if (error.code === 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE') {
      throw new UnsupportedAnchoredPathEffectError(error.code);
    }
    if (error.code === 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH'
        || error.code === 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED') {
      throw new UnsafeAnchoredPathError({
        label: input.label,
        targetPath: input.targetPath,
        cause: error
      });
    }
    throw error;
  }
  throw error;
}

export async function canonicalDirectoryBoundary(root: string, label: string): Promise<string> {
  try {
    return inspectNoFollowDirectoryChain(path.resolve(root), label).target.path;
  } catch (error) {
    return mapDocumentPhysicalError(error, { label, targetPath: root });
  }
}

export function scanDirectDirectoryNames(directoryPath: string, label: string): readonly string[] {
  const directory = inspectNoFollowDirectoryChain(path.resolve(directoryPath), label).target;
  return Object.freeze(scanNoFollowDirectoryDirectMetadata(directory, {
    deadlineAtMs: performance.now() + 30_000,
    maximumEntries: 10_000
  }).map((entry) => entry.relativePath).sort());
}

export async function inspectSafePath(input: {
  boundaryRoot: string;
  candidatePath: string;
  label: string;
  finalKind: 'file' | 'directory';
  allowMissing: boolean;
}): Promise<string | null> {
  const boundary = inspectNoFollowDirectoryChain(path.resolve(input.boundaryRoot), `${input.label} boundary`).target;
  const candidate = path.resolve(input.candidatePath);
  assertPathContained(boundary.path, candidate, input.label);
  try {
    if (input.finalKind === 'directory') {
      return inspectNoFollowDirectoryChain(candidate, input.label).target.path;
    }
    const parent = inspectNoFollowDirectoryChain(path.dirname(candidate), `${input.label} parent`).target;
    const entry = inspectNoFollowOrdinaryFileEntry(parent, path.basename(candidate));
    if (entry === null) {
      if (input.allowMissing) return null;
      throw Object.assign(new Error(`${input.label} is absent.`), { code: 'ENOENT' });
    }
    return candidate;
  } catch (error) {
    if (input.allowMissing && isMissingError(error)) return null;
    return mapDocumentPhysicalError(error, { label: input.label, targetPath: candidate });
  }
}

export async function ensureSafeDirectory(input: {
  boundaryRoot: string;
  directoryPath: string;
  label: string;
  durability?: FreezeDurabilityOptions;
}): Promise<string> {
  const boundary = inspectNoFollowDirectoryChain(path.resolve(input.boundaryRoot), `${input.label} boundary`).target;
  const relative = transactionRelativePath(boundary.path, input.directoryPath, input.label);
  const segments = relative.split(path.sep);
  try {
    const testActor = input.durability === undefined || (
      input.durability.beforeAnchoredCreate === undefined
      && input.durability.beforeCreatedParentBarrier === undefined
      && input.durability.createdParentBarrierObserver === undefined
    ) ? undefined : createNoFollowDirectoryCreateTestActorForTests({
      ...(input.durability.beforeAnchoredCreate === undefined ? {} : {
        beforeCreate: (event) => input.durability?.beforeAnchoredCreate?.({
          label: input.label,
          kind: 'directory',
          parentPath: event.parentPath,
          targetPath: event.targetPath
        })
      }),
      ...(input.durability.beforeCreatedParentBarrier === undefined ? {} : {
        beforeParentBarrier: (event) => {
          try {
            input.durability?.beforeCreatedParentBarrier?.(event);
          } catch (error) {
            throw new DurabilityBarrierError({
              operation: 'parent-directory-barrier',
              targetPath: event.parentPath,
              cause: error
            });
          }
        }
      }),
      ...(input.durability.createdParentBarrierObserver === undefined ? {} : {
        durabilityObserver: input.durability.createdParentBarrierObserver
      })
    });
    let current = boundary;
    for (const segment of segments) {
      const existing = inspectNoFollowDirectoryLeaf(current, segment, input.label);
      if (existing !== null) {
        current = existing;
        continue;
      }
      current = createNoFollowOrdinaryDirectoryChain(current, [segment], testActor);
    }
    return current.path;
  } catch (error) {
    return mapDocumentPhysicalError(error, { label: input.label, targetPath: input.directoryPath });
  }
}

function readPhysicalFile(boundaryRoot: string, filePath: string, label: string): Buffer | null {
  const candidate = path.resolve(filePath);
  assertPathContained(boundaryRoot, candidate, label);
  try {
    const parent = inspectNoFollowDirectoryChain(path.dirname(candidate), `${label} parent`).target;
    const bytes = readNoFollowOrdinaryFile(parent, path.basename(candidate));
    return bytes === null ? null : Buffer.from(bytes);
  } catch (error) {
    if (isMissingError(error)) return null;
    return mapDocumentPhysicalError(error, { label, targetPath: candidate });
  }
}

export async function readSafeRegularFile(input: {
  boundaryRoot: string;
  filePath: string;
  label: string;
}): Promise<Buffer> {
  const bytes = readPhysicalFile(input.boundaryRoot, input.filePath, input.label);
  if (bytes === null) throw Object.assign(new Error(`${input.label} is absent.`), { code: 'ENOENT' });
  return bytes;
}

export async function readOptionalSafeRegularFile(input: {
  boundaryRoot: string;
  filePath: string;
  label: string;
}): Promise<Buffer | null> {
  return readPhysicalFile(input.boundaryRoot, input.filePath, input.label);
}

export async function observeOptionalSafeRegularFile(input: {
  boundaryRoot: string;
  filePath: string;
  label: string;
}): Promise<Readonly<{ bytes: Buffer; identity: AnchoredObjectIdentity }> | null> {
  const candidate = path.resolve(input.filePath);
  assertPathContained(input.boundaryRoot, candidate, input.label);
  try {
    const parent = inspectNoFollowDirectoryChain(path.dirname(candidate), `${input.label} parent`).target;
    const entry = inspectNoFollowOrdinaryFileEntry(parent, path.basename(candidate));
    return entry === null ? null : Object.freeze({
      bytes: Buffer.from(entry.bytes!),
      identity: physicalIdentity(entry)
    });
  } catch (error) {
    if (isMissingError(error)) return null;
    return mapDocumentPhysicalError(error, { label: input.label, targetPath: candidate });
  }
}

async function withRetainedPhysicalTransaction<T>(
  boundaryRoot: string,
  label: string,
  operation: (transaction: RetainedNoFollowFileTransaction) => Promise<T> | T,
  durability?: FreezeDurabilityOptions
): Promise<T> {
  let transaction: RetainedNoFollowFileTransaction | null = null;
  let primaryFailure: Readonly<{ error: unknown }> | undefined;
  try {
    const retainedActorRequested = durability !== undefined && (
      durability.beforeAnchoredCreate !== undefined
      || durability.beforeAnchoredRename !== undefined
      || durability.afterAnchoredNamespaceMutationBeforeFlush !== undefined
      || durability.beforeAnchoredCleanup !== undefined
      || durability.parentDirectoryBarrier !== undefined
      || durability.observer !== undefined
    );
    const testActor = !retainedActorRequested ? undefined
      : createRetainedNoFollowFileTransactionTestActorForTests({
          ...(durability.beforeAnchoredCreate === undefined ? {} : {
            beforeCreate: async (event) => durability.beforeAnchoredCreate?.({ ...event, kind: 'file' })
          }),
          ...(durability.beforeAnchoredRename === undefined ? {} : {
            beforeRename: durability.beforeAnchoredRename
          }),
          ...(durability.afterAnchoredNamespaceMutationBeforeFlush === undefined ? {} : {
            afterNamespaceMutationBeforeFlush: durability.afterAnchoredNamespaceMutationBeforeFlush
          }),
          ...(durability.beforeAnchoredCleanup === undefined ? {} : {
            beforeCleanup: durability.beforeAnchoredCleanup
          }),
          ...(durability.parentDirectoryBarrier === undefined ? {} : {
            beforeParentBarrier: async (event) => {
              try {
                await durability.parentDirectoryBarrier?.(event.parentPath);
              } catch (error) {
                throw new DurabilityBarrierError({
                  operation: 'parent-directory-barrier',
                  targetPath: event.parentPath,
                  cause: error
                });
              }
            }
          }),
          ...(durability.observer === undefined ? {} : {
            durabilityObserver: durability.observer
          })
        });
    transaction = retainNoFollowFileTransaction(boundaryRoot, label, testActor);
    return await operation(transaction);
  } catch (error) {
    try {
      return mapDocumentPhysicalError(error, { label, targetPath: boundaryRoot });
    } catch (mappedError) {
      primaryFailure = Object.freeze({ error: mappedError });
      throw mappedError;
    }
  } finally {
    try {
      transaction?.dispose();
    } catch (settlementError) {
      if (primaryFailure !== undefined) {
        throw new AggregateError(
          [primaryFailure.error, settlementError],
          `${label} failed and its retained physical transaction could not be settled.`
        );
      }
      throw settlementError;
    }
  }
}

function assertRetainedPublishAuthority(input: Readonly<{
  boundaryRoot: string;
  filePath: string;
  label: string;
  authority: RetainedPublishObjectAuthority;
  expectedBytes?: Buffer;
  expectedIdentity?: AnchoredObjectIdentity;
}>): void {
  const expectedRelativePath = transactionRelativePath(
    input.boundaryRoot,
    input.filePath,
    input.label
  );
  if (pathComparisonValue(input.authority.transaction.rootPath)
      !== pathComparisonValue(input.boundaryRoot)
      || pathComparisonValue(input.authority.relativePath)
        !== pathComparisonValue(expectedRelativePath)) {
    throw new Error(`${input.label} retained authority does not bind the requested path.`);
  }
  if (input.expectedBytes !== undefined
      && !Buffer.from(input.authority.observation.bytes).equals(input.expectedBytes)) {
    throw new Error(`${input.label} changed before its selected effect; preserving it.`);
  }
  if (input.expectedIdentity !== undefined
      && !sameAnchoredObjectIdentity(
        input.authority.observation.identity,
        input.expectedIdentity
      )) {
    throw new Error(`${input.label} identity changed before its selected effect; preserving it.`);
  }
}

export async function removeOptionalSafeRegularFile(input: {
  boundaryRoot: string;
  filePath: string;
  label: string;
  expectedBytes: Buffer;
  expectedIdentity?: AnchoredObjectIdentity;
  retained?: RetainedPublishObjectAuthority;
  durability?: FreezeDurabilityOptions;
}): Promise<void> {
  const run = async (authority: RetainedPublishObjectAuthority): Promise<void> => {
    assertRetainedPublishAuthority({
      boundaryRoot: input.boundaryRoot,
      filePath: input.filePath,
      label: input.label,
      authority,
      expectedBytes: input.expectedBytes,
      ...(input.expectedIdentity === undefined ? {} : { expectedIdentity: input.expectedIdentity })
    });
    await authority.transaction.removeExact(authority.relativePath, authority.observation, input.label);
  };
  if (input.retained !== undefined) {
    await run(input.retained);
    return;
  }
  await withRetainedPhysicalTransaction(input.boundaryRoot, input.label, async (transaction) => {
    const relativePath = transactionRelativePath(input.boundaryRoot, input.filePath, input.label);
    const observation = transaction.observe(relativePath, input.label);
    if (observation === null) return;
    await run({ transaction, observation, relativePath });
  }, input.durability);
}

export async function removeExactEmptyDirectory(input: {
  boundaryRoot: string;
  directoryPath: string;
  label: string;
  expectedIdentity?: AnchoredObjectIdentity;
}): Promise<void> {
  const directory = inspectNoFollowDirectoryChain(path.resolve(input.directoryPath), input.label).target;
  const parent = inspectNoFollowDirectoryChain(path.dirname(directory.path), `${input.label} parent`).target;
  assertPathContained(input.boundaryRoot, directory.path, input.label);
  if (input.expectedIdentity !== undefined
      && !sameAnchoredObjectIdentity(physicalIdentity(directory), input.expectedIdentity)) {
    throw new Error(`${input.label} identity changed before exact cleanup; preserving it.`);
  }
  deleteRetainedNoFollowEntry({
    root: parent,
    relativePath: path.basename(directory.path),
    kind: 'directory',
    device: directory.device,
    inode: directory.inode,
    ancestorDirectories: []
  });
}

export async function createSafeRegularFileExclusive(input: {
  boundaryRoot: string;
  filePath: string;
  bytes: Buffer;
  label: string;
  durability?: FreezeDurabilityOptions;
}): Promise<void> {
  await withRetainedPhysicalTransaction(input.boundaryRoot, input.label, async (transaction) => {
    const relativePath = transactionRelativePath(input.boundaryRoot, input.filePath, input.label);
    await transaction.createExclusive(relativePath, input.bytes, input.label);
  }, input.durability);
}

export async function defaultParentDirectoryBarrier(directoryPath: string): Promise<void> {
  try {
    flushNoFollowDirectory(inspectNoFollowDirectoryChain(directoryPath, 'Document control directory barrier').target);
  } catch (error) {
    return mapDocumentPhysicalError(error, {
      label: 'Document control directory barrier',
      targetPath: directoryPath,
      operation: 'parent-directory-barrier'
    });
  }
}

export async function flushPublishedFile(input: {
  boundaryRoot: string;
  targetPath: string;
  label: string;
  durability: FreezeDurabilityOptions;
  expectedBytes?: Buffer;
  expectedIdentity?: AnchoredObjectIdentity;
  retained?: RetainedPublishObjectAuthority;
}): Promise<void> {
  const run = async (authority: RetainedPublishObjectAuthority): Promise<void> => {
    assertRetainedPublishAuthority({
      boundaryRoot: input.boundaryRoot,
      filePath: input.targetPath,
      label: input.label,
      authority,
      ...(input.expectedBytes === undefined ? {} : { expectedBytes: input.expectedBytes }),
      ...(input.expectedIdentity === undefined ? {} : { expectedIdentity: input.expectedIdentity })
    });
    await authority.transaction.flushExact(authority.relativePath, authority.observation, input.label);
  };
  if (input.retained !== undefined) await run(input.retained);
  else await withRetainedPhysicalTransaction(input.boundaryRoot, input.label, async (transaction) => {
    const relativePath = transactionRelativePath(input.boundaryRoot, input.targetPath, input.label);
    const observation = transaction.observe(relativePath, input.label);
    if (observation === null) throw new Error(`${input.label} is absent before flush.`);
    await run({ transaction, observation, relativePath });
  }, input.durability);
}

async function durableRename(input: {
  boundaryRoot: string;
  sourcePath: string;
  targetPath: string;
  label: string;
  durability: FreezeDurabilityOptions;
  replaceExisting?: boolean;
  expectedSourceBytes?: Buffer;
  expectedSourceIdentity?: AnchoredObjectIdentity;
  retained?: RetainedPublishObjectAuthority;
}): Promise<void> {
  if (input.replaceExisting !== false) {
    throw new UnsupportedAnchoredPathEffectError('retained no-replace rename');
  }
  const run = async (authority: RetainedPublishObjectAuthority): Promise<void> => {
    assertRetainedPublishAuthority({
      boundaryRoot: input.boundaryRoot,
      filePath: input.sourcePath,
      label: input.label,
      authority,
      ...(input.expectedSourceBytes === undefined ? {} : { expectedBytes: input.expectedSourceBytes }),
      ...(input.expectedSourceIdentity === undefined ? {} : {
        expectedIdentity: input.expectedSourceIdentity
      })
    });
    await authority.transaction.renameNoReplace(
      authority.relativePath,
      transactionRelativePath(input.boundaryRoot, input.targetPath, input.label),
      authority.observation,
      input.label
    );
  };
  if (input.retained !== undefined) return run(input.retained);
  await withRetainedPhysicalTransaction(input.boundaryRoot, input.label, async (transaction) => {
    const relativePath = transactionRelativePath(input.boundaryRoot, input.sourcePath, input.label);
    const observation = transaction.observe(relativePath, input.label);
    if (observation === null) throw new Error(`${input.label} source is absent.`);
    await run({ transaction, observation, relativePath });
  }, input.durability);
}

async function durableLinkOpenedPosixFile(input: {
  boundaryRoot: string;
  sourcePath: string;
  targetPath: string;
  expectedSourceBytes: Buffer;
  expectedSourceIdentity?: AnchoredObjectIdentity;
  label: string;
  durability: FreezeDurabilityOptions;
  retained?: RetainedPublishObjectAuthority;
}): Promise<void> {
  const run = async (authority: RetainedPublishObjectAuthority): Promise<void> => {
    assertRetainedPublishAuthority({
      boundaryRoot: input.boundaryRoot,
      filePath: input.sourcePath,
      label: input.label,
      authority,
      expectedBytes: input.expectedSourceBytes,
      ...(input.expectedSourceIdentity === undefined ? {} : {
        expectedIdentity: input.expectedSourceIdentity
      })
    });
    await authority.transaction.linkExactNoReplace(
      authority.relativePath,
      transactionRelativePath(input.boundaryRoot, input.targetPath, input.label),
      authority.observation,
      input.label
    );
  };
  if (input.retained !== undefined) return run(input.retained);
  await withRetainedPhysicalTransaction(input.boundaryRoot, input.label, async (transaction) => {
    const relativePath = transactionRelativePath(input.boundaryRoot, input.sourcePath, input.label);
    const observation = transaction.observe(relativePath, input.label);
    if (observation === null) throw new Error(`${input.label} source is absent.`);
    await run({ transaction, observation, relativePath });
  }, input.durability);
}

export async function assertPosixEntryIdentity(input: {
  boundaryRoot: string;
  leftPath: string;
  rightPath: string;
  label: string;
}): Promise<void> {
  const [left, right] = await Promise.all([
    observeOptionalSafeRegularFile({ boundaryRoot: input.boundaryRoot, filePath: input.leftPath, label: `${input.label} left` }),
    observeOptionalSafeRegularFile({ boundaryRoot: input.boundaryRoot, filePath: input.rightPath, label: `${input.label} right` })
  ]);
  if (left === null || right === null || !sameAnchoredObjectIdentity(left.identity, right.identity)) {
    throw new Error(`${input.label} does not name one exact physical object.`);
  }
}

export async function assertRegularRepositoryFile(repositoryRoot: string, repositoryPath: string): Promise<string> {
  const candidate = path.join(repositoryRoot, ...repositoryPath.split('/'));
  return (await inspectSafePath({
    boundaryRoot: repositoryRoot,
    candidatePath: candidate,
    label: `Document control target ${repositoryPath}`,
    finalKind: 'file',
    allowMissing: false
  }))!;
}

export async function resolveRecoverableRepositoryFile(
  repositoryRoot: string,
  repositoryPath: string
): Promise<string> {
  const candidate = path.join(repositoryRoot, ...repositoryPath.split('/'));
  await inspectSafePath({
    boundaryRoot: repositoryRoot,
    candidatePath: candidate,
    label: `Recoverable document control target ${repositoryPath}`,
    finalKind: 'file',
    allowMissing: true
  });
  return candidate;
}

export function entryRecoveryPath(input: {
  artifactRoot: string;
  operationId: string;
  targetKey: DocumentControlRecoveryTargetKey;
  suffix: 'pre' | 'retired-pre' | 'retired-next';
}): string {
  const stem = documentControlRecoveryEntryStem({
    operationId: input.operationId,
    targetKey: input.targetKey
  });
  return path.join(input.artifactRoot, `${stem}.${input.suffix}`);
}

interface PublishEntryObservation {
  readonly bytes: Buffer | null;
  readonly identity: AnchoredObjectIdentity | null;
  readonly retained?: RetainedPublishObjectAuthority;
}

interface PublishEntryResolution {
  readonly state: PublishEntryState;
  readonly target: PublishEntryObservation;
  readonly next: PublishEntryObservation;
  readonly quarantine: PublishEntryObservation;
  readonly retiredPre: PublishEntryObservation;
  readonly retiredNext: PublishEntryObservation;
}

type PublishEntryState =
  | 'linux-fresh'
  | 'linux-s0'
  | 'linux-s1'
  | 'linux-s2'
  | 'linux-s3'
  | 'linux-s4'
  | 'windows-pristine'
  | 'windows-prepared'
  | 'windows-quarantined'
  | 'windows-installed';

function samePublishEntryIdentity(
  left: PublishEntryObservation,
  right: PublishEntryObservation
): boolean {
  if (left.identity === null || right.identity === null) return false;
  if (typeof left.identity === 'string' || typeof right.identity === 'string') {
    return typeof left.identity === 'string' && left.identity === right.identity;
  }
  return left.identity.device === right.identity.device && left.identity.inode === right.identity.inode;
}

function hasPublishEntryBytes(entry: PublishEntryObservation, expected: Buffer): boolean {
  return entry.bytes !== null && entry.bytes.equals(expected);
}

/**
 * Resolve the complete persisted entry tuple before any effect.  This is the
 * sole authority for recovery legality: callers must never infer a state from
 * a partial census or from byte equality alone.
 */
export async function classifyPublishEntryState(input: Readonly<{
  boundaryRoot: string;
  targetPath: string;
  nextPath: string;
  quarantinePath: string;
  retiredPrePath: string;
  retiredNextPath: string;
  pre: Buffer;
  next: Buffer;
  label: string;
  retainRecoveryEntries?: boolean;
  observations?: Readonly<{
    target: PublishEntryObservation;
    next: PublishEntryObservation;
    quarantine: PublishEntryObservation;
    retiredPre: PublishEntryObservation;
    retiredNext: PublishEntryObservation;
  }>;
}>): Promise<PublishEntryResolution> {
  const readEntry = async (filePath: string, label: string): Promise<PublishEntryObservation> => {
    const observation = await observeOptionalSafeRegularFile({
      boundaryRoot: input.boundaryRoot,
      filePath,
      label
    });
    return observation === null
      ? Object.freeze({ bytes: null, identity: null })
      : Object.freeze({ bytes: observation.bytes, identity: observation.identity });
  };
  const observed = input.observations ?? Object.freeze({
    target: await readEntry(input.targetPath, input.label),
    next: await readEntry(input.nextPath, `${input.label} NEXT recovery entry`),
    quarantine: await readEntry(input.quarantinePath, `${input.label} PRE quarantine`),
    retiredPre: await readEntry(input.retiredPrePath, `${input.label} retired PRE entry`),
    retiredNext: await readEntry(input.retiredNextPath, `${input.label} retired NEXT entry`)
  });
  const { target, next, quarantine, retiredPre, retiredNext } = observed;
  const absent = (entry: PublishEntryObservation) => entry.bytes === null;
  const exact = (entry: PublishEntryObservation, bytes: Buffer) => hasPublishEntryBytes(entry, bytes);
  const fail = (): never => {
    throw new Error(`${input.label} recovery tuple is not a legal pre-effect state; preserving every entry.`);
  };
  const resolve = (state: PublishEntryState): PublishEntryResolution => Object.freeze({
    state, target, next, quarantine, retiredPre, retiredNext
  });

  if (process.platform === 'linux') {
    if (exact(target, input.pre) && absent(next) && absent(quarantine)
        && absent(retiredPre) && absent(retiredNext)) return resolve('linux-fresh');
    if (exact(target, input.pre) && exact(next, input.next) && absent(quarantine)
        && absent(retiredPre) && absent(retiredNext)) return resolve('linux-s0');
    if (exact(target, input.pre) && exact(next, input.next) && exact(quarantine, input.pre)
        && samePublishEntryIdentity(target, quarantine) && absent(retiredPre) && absent(retiredNext)) {
      return resolve('linux-s1');
    }
    if (absent(target) && exact(next, input.next) && exact(quarantine, input.pre)
        && exact(retiredPre, input.pre) && samePublishEntryIdentity(quarantine, retiredPre)
        && absent(retiredNext)) return resolve('linux-s2');
    if (exact(target, input.next) && exact(next, input.next) && exact(quarantine, input.pre)
        && exact(retiredPre, input.pre) && samePublishEntryIdentity(target, next)
        && samePublishEntryIdentity(quarantine, retiredPre) && absent(retiredNext)) return resolve('linux-s3');
    if (exact(target, input.next) && absent(next) && exact(quarantine, input.pre)
        && exact(retiredPre, input.pre) && exact(retiredNext, input.next)
        && samePublishEntryIdentity(target, retiredNext)
        && samePublishEntryIdentity(quarantine, retiredPre)) return resolve('linux-s4');
    return fail();
  }
  if (process.platform === 'win32') {
    // POSIX recovery names must never participate in the Windows atomic-rename protocol.
    if (!absent(retiredPre) || !absent(retiredNext)) return fail();
    if (exact(target, input.pre) && absent(next) && absent(quarantine)) return resolve('windows-pristine');
    if (exact(target, input.pre) && exact(next, input.next) && absent(quarantine)) return resolve('windows-prepared');
    if (absent(target) && exact(next, input.next) && exact(quarantine, input.pre)) {
      return resolve('windows-quarantined');
    }
    // A successful rename consumes NEXT.  PRE may remain only while cleanup is retained.
    if (exact(target, input.next) && absent(next) && exact(quarantine, input.pre)) {
      return resolve('windows-installed');
    }
    if (input.retainRecoveryEntries !== true && exact(target, input.next) && absent(next)
        && absent(quarantine)) return resolve('windows-installed');
    return fail();
  }
  throw new Error(`Entry CAS is unsupported on ${process.platform}.`);
}

export type PublishTupleClassifierInput = Readonly<{
  boundaryRoot: string;
  targetPath: string;
  nextPath: string;
  quarantinePath: string;
  retiredPrePath: string;
  retiredNextPath: string;
  pre: Buffer;
  next: Buffer;
  label: string;
  retainRecoveryEntries?: boolean;
}>;

type PublishTupleClassifierSource = Readonly<{
  boundaryRoot: string;
  artifactRoot: string;
  targetPath: string;
  targetKey: DocumentControlRecoveryTargetKey;
  nextPath: string;
  pre: Buffer;
  next: Buffer;
  label: string;
  operationId: string;
  retainRecoveryEntries?: boolean;
}>;

export function createPublishTupleClassifierInput(
  input: PublishTupleClassifierSource
): PublishTupleClassifierInput {
  return Object.freeze({
    boundaryRoot: input.boundaryRoot,
    targetPath: input.targetPath,
    nextPath: input.nextPath,
    quarantinePath: entryRecoveryPath({ ...input, suffix: 'pre' }),
    retiredPrePath: entryRecoveryPath({ ...input, suffix: 'retired-pre' }),
    retiredNextPath: entryRecoveryPath({ ...input, suffix: 'retired-next' }),
    pre: input.pre,
    next: input.next,
    label: input.label,
    retainRecoveryEntries: input.retainRecoveryEntries
  });
}

/** Retains every extant tuple object and its anchored parent for exactly one selected publisher edge. */
async function withRetainedPublishEntryTuple<T>(
  input: PublishTupleClassifierInput,
  operation: (resolution: PublishEntryResolution) => Promise<T> | T,
  durability?: FreezeDurabilityOptions
): Promise<T> {
  const paths = [
    [input.targetPath, input.label, 'target'],
    [input.nextPath, `${input.label} NEXT recovery entry`, 'next'],
    [input.quarantinePath, `${input.label} PRE quarantine`, 'quarantine'],
    [input.retiredPrePath, `${input.label} retired PRE entry`, 'retiredPre'],
    [input.retiredNextPath, `${input.label} retired NEXT entry`, 'retiredNext']
  ] as const;
  return withRetainedPhysicalTransaction(input.boundaryRoot, input.label, async (transaction) => {
    const relativeByKey = Object.fromEntries(paths.map(([filePath, , key]) => [
      key,
      transactionRelativePath(input.boundaryRoot, filePath, input.label)
    ])) as Record<(typeof paths)[number][2], string>;
    const retained = transaction.observeTuple(paths.map(([filePath, label, key]) => Object.freeze({
      key,
      relativePath: transactionRelativePath(input.boundaryRoot, filePath, label),
      label
    })));
    const observations = Object.fromEntries(paths.map(([, , key]) => {
      const observation = retained[key] ?? null;
      return [key, observation === null
        ? Object.freeze({ bytes: null, identity: null })
        : Object.freeze({
            bytes: Buffer.from(observation.bytes),
            identity: observation.identity,
            retained: Object.freeze({
              transaction,
              observation,
              relativePath: relativeByKey[key]
            })
          })];
    }));
    return operation(await classifyPublishEntryState({
      ...input,
      observations: observations as unknown as Readonly<{
        target: PublishEntryObservation;
        next: PublishEntryObservation;
        quarantine: PublishEntryObservation;
        retiredPre: PublishEntryObservation;
        retiredNext: PublishEntryObservation;
      }>
    }));
  }, durability);
}

function samePublishEntryObservation(
  left: PublishEntryObservation,
  right: PublishEntryObservation
): boolean {
  if ((left.bytes === null) !== (right.bytes === null)) return false;
  if (left.bytes !== null && !left.bytes.equals(right.bytes!)) return false;
  return (left.identity === null && right.identity === null)
    || samePublishEntryIdentity(left, right);
}

function assertPublishEntryTransitionIdentity(
  predecessor: PublishEntryResolution,
  successor: PublishEntryResolution
): void {
  const requireSame = (left: PublishEntryObservation, right: PublishEntryObservation, label: string): void => {
    if (!samePublishEntryIdentity(left, right)) {
      throw new Error(`Publish entry successor did not retain the authorized ${label} identity.`);
    }
  };
  const requireAbsent = (entry: PublishEntryObservation, label: string): void => {
    if (entry.identity !== null || entry.bytes !== null) {
      throw new Error(`Publish entry successor did not remove the required ${label} entry.`);
    }
  };
  const edge = `${predecessor.state}->${successor.state}`;
  switch (edge) {
    case 'windows-prepared->windows-quarantined':
      requireSame(predecessor.target, successor.quarantine, 'Windows PRE quarantine');
      requireSame(predecessor.next, successor.next, 'Windows NEXT');
      requireAbsent(successor.target, 'Windows PRE target');
      return;
    case 'windows-quarantined->windows-installed':
      requireSame(predecessor.next, successor.target, 'Windows installed NEXT');
      requireSame(predecessor.quarantine, successor.quarantine, 'Windows retained PRE');
      requireAbsent(successor.next, 'Windows consumed NEXT');
      return;
    case 'windows-installed->windows-installed':
      requireSame(predecessor.target, successor.target, 'Windows installed target');
      return;
    case 'linux-s0->linux-s1':
      requireSame(predecessor.target, successor.target, 'Linux PRE target');
      requireSame(predecessor.target, successor.quarantine, 'Linux PRE quarantine');
      requireSame(predecessor.next, successor.next, 'Linux NEXT');
      return;
    case 'linux-s1->linux-s2':
      requireSame(predecessor.target, successor.quarantine, 'Linux retained PRE');
      requireSame(predecessor.target, successor.retiredPre, 'Linux retired PRE');
      requireSame(predecessor.next, successor.next, 'Linux NEXT');
      requireAbsent(successor.target, 'Linux retired target');
      return;
    case 'linux-s2->linux-s3':
      requireSame(predecessor.next, successor.target, 'Linux installed NEXT');
      requireSame(predecessor.next, successor.next, 'Linux active NEXT');
      requireSame(predecessor.quarantine, successor.quarantine, 'Linux PRE quarantine');
      requireSame(predecessor.retiredPre, successor.retiredPre, 'Linux retired PRE');
      return;
    case 'linux-s3->linux-s4':
      requireSame(predecessor.target, successor.target, 'Linux installed NEXT');
      requireSame(predecessor.next, successor.retiredNext, 'Linux retired NEXT');
      requireSame(predecessor.quarantine, successor.quarantine, 'Linux PRE quarantine');
      requireSame(predecessor.retiredPre, successor.retiredPre, 'Linux retired PRE');
      requireAbsent(successor.next, 'Linux active NEXT');
      return;
    default:
      return;
  }
}

export async function publishEntryNoReplaceCas(input: {
  boundaryRoot: string;
  artifactRoot: string;
  targetPath: string;
  targetKey: DocumentControlRecoveryTargetKey;
  nextPath: string;
  pre: Buffer;
  next: Buffer;
  label: string;
  operationId: string;
  faultAfterNextPrepared?: () => void;
  faultAfterPreQuarantine?: () => void;
  faultAfterNextInstall?: () => void;
  retainRecoveryEntries?: boolean;
  durability: FreezeDurabilityOptions;
}): Promise<void> {
  const classifier = createPublishTupleClassifierInput(input);
  const { quarantinePath, retiredPrePath, retiredNextPath } = classifier;
  let resolution = await classifyPublishEntryState(classifier);
  let state = resolution.state;
  const assertBeforeEffect = async (): Promise<void> => {
    await withRetainedPublishEntryTuple(classifier, async (retained) => {
      const expected = resolution;
      if (retained.state !== expected.state
          || !samePublishEntryObservation(retained.target, expected.target)
          || !samePublishEntryObservation(retained.next, expected.next)
          || !samePublishEntryObservation(retained.quarantine, expected.quarantine)
          || !samePublishEntryObservation(retained.retiredPre, expected.retiredPre)
          || !samePublishEntryObservation(retained.retiredNext, expected.retiredNext)) {
        throw new Error(`${input.label} retained tuple changed before its selected edge; preserving every entry.`);
      }
    }, input.durability);
  };
  const runSelectedRetainedEdge = async <T>(
    edge: (retained: PublishEntryResolution) => Promise<T>
  ): Promise<T> => withRetainedPublishEntryTuple(classifier, async (retained) => {
    const expected = resolution;
    if (retained.state !== expected.state
        || !samePublishEntryObservation(retained.target, expected.target)
        || !samePublishEntryObservation(retained.next, expected.next)
        || !samePublishEntryObservation(retained.quarantine, expected.quarantine)
        || !samePublishEntryObservation(retained.retiredPre, expected.retiredPre)
        || !samePublishEntryObservation(retained.retiredNext, expected.retiredNext)) {
      throw new Error(`${input.label} retained tuple changed before its selected edge; preserving every entry.`);
    }
    return edge(retained);
  }, input.durability);
  const assertDeclaredSuccessor = async (
    predecessor: PublishEntryResolution,
    successor: PublishEntryState
  ): Promise<void> => {
    const observed = await classifyPublishEntryState(classifier);
    if (observed.state !== successor) {
      throw new Error(`${input.label} effect did not produce its declared ${successor} successor.`);
    }
    assertPublishEntryTransitionIdentity(predecessor, observed);
    resolution = observed;
    state = observed.state;
  };

  if (input.pre.equals(input.next)
      && (state === 'linux-fresh' || state === 'windows-pristine')) {
    await runSelectedRetainedEdge(async () => undefined);
    return;
  }

  if (state === 'windows-installed') {
    if (input.retainRecoveryEntries !== true) {
      await runSelectedRetainedEdge(async (retained) => removeOptionalSafeRegularFile({
        boundaryRoot: input.boundaryRoot,
        filePath: quarantinePath,
        label: `${input.label} exact PRE quarantine cleanup`,
        expectedBytes: input.pre,
        expectedIdentity: retained.quarantine.identity!,
        retained: retained.quarantine.retained,
        durability: input.durability
      }));
      // W2 becomes W3 only after its sole permitted cleanup edge.
      await assertDeclaredSuccessor(resolution, 'windows-installed');
    }
    await runSelectedRetainedEdge(async (retained) => flushPublishedFile({
      boundaryRoot: input.boundaryRoot,
      targetPath: input.targetPath,
      label: input.label,
      durability: input.durability
      , expectedBytes: input.next, expectedIdentity: retained.target.identity!
      , retained: retained.target.retained
    }));
    return;
  }

  if (state === 'linux-s4') {
    await runSelectedRetainedEdge(async (retained) => flushPublishedFile({
      boundaryRoot: input.boundaryRoot,
      targetPath: input.targetPath,
      label: input.label,
      durability: input.durability
      , expectedBytes: input.next, expectedIdentity: retained.target.identity!
      , retained: retained.target.retained
    }));
    return;
  }

  if (state === 'linux-fresh' || state === 'windows-pristine') {
    await runSelectedRetainedEdge(async () => createSafeRegularFileExclusive({
      boundaryRoot: input.boundaryRoot,
      filePath: input.nextPath,
      bytes: input.next,
      label: `${input.label} NEXT recovery entry`,
      durability: input.durability
    }));
    await assertDeclaredSuccessor(resolution, process.platform === 'linux' ? 'linux-s0' : 'windows-prepared');
    await assertBeforeEffect();
  }
  input.faultAfterNextPrepared?.();

  if (state === 'windows-prepared') {
    if (process.platform === 'win32') {
      await runSelectedRetainedEdge(async (retained) => durableRename({
        boundaryRoot: input.boundaryRoot,
        sourcePath: input.targetPath,
        targetPath: quarantinePath,
        label: `${input.label} PRE quarantine`,
        durability: input.durability,
        replaceExisting: false,
        expectedSourceBytes: input.pre,
        expectedSourceIdentity: retained.target.identity!,
        retained: retained.target.retained
      }));
    }
    input.faultAfterPreQuarantine?.();
    await assertDeclaredSuccessor(resolution, 'windows-quarantined');
  }

  if (state === 'linux-s0') {
    await runSelectedRetainedEdge(async (retained) => durableLinkOpenedPosixFile({
      boundaryRoot: input.boundaryRoot,
      sourcePath: input.targetPath,
      targetPath: quarantinePath,
      expectedSourceBytes: input.pre,
      expectedSourceIdentity: retained.target.identity!,
      label: `${input.label} exact PRE recovery link`,
      durability: input.durability,
      retained: retained.target.retained
    }));
    await assertPosixEntryIdentity({
      boundaryRoot: input.boundaryRoot,
      leftPath: input.targetPath,
      rightPath: quarantinePath,
      label: `${input.label} PRE recovery identity`
    });
    await input.durability.afterExactPreRecoveryLink?.(Object.freeze({
      label: input.label,
      targetPath: input.targetPath,
      recoveryPath: quarantinePath
    }));
    await assertDeclaredSuccessor(resolution, 'linux-s1');
  }
  if (state === 'linux-s1') {
    await runSelectedRetainedEdge(async (retained) => durableRename({
      boundaryRoot: input.boundaryRoot,
      sourcePath: input.targetPath,
      targetPath: retiredPrePath,
      label: `${input.label} PRE entry retirement`,
      durability: input.durability,
      replaceExisting: false,
      expectedSourceBytes: input.pre,
      expectedSourceIdentity: retained.target.identity!,
      retained: retained.target.retained
    }));
    await assertPosixEntryIdentity({
      boundaryRoot: input.boundaryRoot,
      leftPath: quarantinePath,
      rightPath: retiredPrePath,
      label: `${input.label} retired PRE identity`
    });
    input.faultAfterPreQuarantine?.();
    await assertDeclaredSuccessor(resolution, 'linux-s2');
  }

  if (state === 'windows-quarantined') {
    await runSelectedRetainedEdge(async (retained) => durableRename({
      boundaryRoot: input.boundaryRoot,
      sourcePath: input.nextPath,
      targetPath: input.targetPath,
      label: `${input.label} NEXT install`,
      durability: input.durability,
      replaceExisting: false,
      expectedSourceBytes: input.next,
      expectedSourceIdentity: retained.next.identity!,
      retained: retained.next.retained
    }));
    await assertDeclaredSuccessor(resolution, 'windows-installed');
  } else if (state === 'linux-s2') {
    await runSelectedRetainedEdge(async (retained) => durableLinkOpenedPosixFile({
      boundaryRoot: input.boundaryRoot,
      sourcePath: input.nextPath,
      targetPath: input.targetPath,
      expectedSourceBytes: input.next,
      expectedSourceIdentity: retained.next.identity!,
      label: `${input.label} exact NEXT install`,
      durability: input.durability,
      retained: retained.next.retained
    }));
    await assertDeclaredSuccessor(resolution, 'linux-s3');
  }
  input.faultAfterNextInstall?.();

  if (!(await readSafeRegularFile({
    boundaryRoot: input.boundaryRoot,
    filePath: input.targetPath,
    label: `${input.label} NEXT readback`
  })).equals(input.next)) {
    throw new Error(`${input.label} NEXT readback failed.`);
  }
  if (resolution.state === 'windows-installed' && input.retainRecoveryEntries !== true) {
    await runSelectedRetainedEdge(async (retained) => removeOptionalSafeRegularFile({
      boundaryRoot: input.boundaryRoot,
      filePath: quarantinePath,
      label: `${input.label} exact PRE quarantine cleanup`,
      expectedBytes: input.pre,
      expectedIdentity: retained.quarantine.identity!,
      retained: retained.quarantine.retained,
      durability: input.durability
    }));
    await assertDeclaredSuccessor(resolution, 'windows-installed');
  } else if (resolution.state === 'linux-s3') {
    await runSelectedRetainedEdge(async (retained) => durableRename({
      boundaryRoot: input.boundaryRoot,
      sourcePath: input.nextPath,
      targetPath: retiredNextPath,
      label: `${input.label} NEXT recovery retirement`,
      durability: input.durability,
      replaceExisting: false,
      expectedSourceBytes: input.next,
      expectedSourceIdentity: retained.next.identity!,
      retained: retained.next.retained
    }));
    await assertPosixEntryIdentity({
      boundaryRoot: input.boundaryRoot,
      leftPath: input.targetPath,
      rightPath: retiredNextPath,
      label: `${input.label} installed NEXT identity`
    });
    await assertDeclaredSuccessor(resolution, 'linux-s4');
  }
}

export function atomicCasNextPath(filePath: string, operationId: string): string {
  return path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${operationId.slice('sha256:'.length)}.next`
  );
}

interface InitiallyAbsentEntryResolution {
  readonly state: InitiallyAbsentTupleState;
  readonly tuple: Readonly<{
    target: InitiallyAbsentTupleEntry;
    next: InitiallyAbsentTupleEntry;
    retiredNext: InitiallyAbsentTupleEntry;
  }>;
  readonly target: PublishEntryObservation;
  readonly next: PublishEntryObservation;
  readonly retiredNext: PublishEntryObservation;
}

type InitiallyAbsentTupleClassifierInput = Readonly<{
  boundaryRoot: string;
  targetPath: string;
  nextPath: string;
  retiredNextPath: string;
  next: Buffer;
  label: string;
}>;

export function initialTupleEntryAdapter(
  entry: PublishEntryObservation,
  next: Buffer
): InitiallyAbsentTupleEntry {
  const identity = entry.identity === null
    ? null
    : typeof entry.identity === 'string'
      ? entry.identity
      : `${entry.identity.device}:${entry.identity.inode}`;
  if (entry.bytes === null) return Object.freeze({ byteClass: 'absent', identity });
  return Object.freeze({ byteClass: entry.bytes.equals(next) ? 'exact-next' : 'unknown', identity });
}

function initialTupleResolutionAdapter(input: Readonly<{
  next: Buffer;
  target: PublishEntryObservation;
  nextEntry: PublishEntryObservation;
  retiredNext: PublishEntryObservation;
  label: string;
}>): InitiallyAbsentEntryResolution {
  const tuple = Object.freeze({
    target: initialTupleEntryAdapter(input.target, input.next),
    next: initialTupleEntryAdapter(input.nextEntry, input.next),
    retiredNext: initialTupleEntryAdapter(input.retiredNext, input.next)
  });
  const resolution = classifyInitiallyAbsentEntryTuple({
    platform: process.platform as InitiallyAbsentTuplePlatform,
    tuple
  });
  if (resolution.status === 'invalid') {
    throw new Error(`${input.label} initially-absent T/N/R contract rejected the observation (${resolution.reason}); preserving every entry.`);
  }
  return Object.freeze({
    state: resolution.state,
    tuple,
    target: input.target,
    next: input.nextEntry,
    retiredNext: input.retiredNext
  });
}

/** Anchored observation adapter; the T/N/R grammar itself lives in the contract. */
async function observeInitiallyAbsentEntryTuple(
  input: InitiallyAbsentTupleClassifierInput & Readonly<{
    observations?: Readonly<{
      target: PublishEntryObservation;
      next: PublishEntryObservation;
      retiredNext: PublishEntryObservation;
    }>;
  }>
): Promise<InitiallyAbsentEntryResolution> {
  const readEntry = async (filePath: string, label: string): Promise<PublishEntryObservation> => {
    const observation = await observeOptionalSafeRegularFile({
      boundaryRoot: input.boundaryRoot,
      filePath,
      label
    });
    return observation === null
      ? Object.freeze({ bytes: null, identity: null })
      : Object.freeze({ bytes: observation.bytes, identity: observation.identity });
  };
  const observed = input.observations ?? Object.freeze({
    target: await readEntry(input.targetPath, input.label),
    next: await readEntry(input.nextPath, `${input.label} NEXT recovery entry`),
    retiredNext: await readEntry(input.retiredNextPath, `${input.label} retired NEXT entry`)
  });
  return initialTupleResolutionAdapter({
    next: input.next,
    target: observed.target,
    nextEntry: observed.next,
    retiredNext: observed.retiredNext,
    label: input.label
  });
}

/** Retains every present initial T/N/R object and parent anchor through exactly one selected edge. */
async function withRetainedInitiallyAbsentEntryTuple<T>(
  input: InitiallyAbsentTupleClassifierInput,
  operation: (resolution: InitiallyAbsentEntryResolution) => Promise<T> | T,
  durability?: FreezeDurabilityOptions
): Promise<T> {
  const paths = [
    [input.targetPath, input.label, 'target'],
    [input.nextPath, `${input.label} NEXT recovery entry`, 'next'],
    [input.retiredNextPath, `${input.label} retired NEXT entry`, 'retiredNext']
  ] as const;
  return withRetainedPhysicalTransaction(input.boundaryRoot, input.label, async (transaction) => {
    const retained = transaction.observeTuple(paths.map(([filePath, label, key]) => Object.freeze({
      key,
      relativePath: transactionRelativePath(input.boundaryRoot, filePath, label),
      label
    })));
    const observations = Object.fromEntries(paths.map(([filePath, , key]) => {
      const observation = retained[key] ?? null;
      const relativePath = transactionRelativePath(input.boundaryRoot, filePath, input.label);
      return [key, observation === null
        ? Object.freeze({ bytes: null, identity: null })
        : Object.freeze({
            bytes: Buffer.from(observation.bytes),
            identity: observation.identity,
            retained: Object.freeze({ transaction, observation, relativePath })
          })];
    }));
    return operation(await observeInitiallyAbsentEntryTuple({
      ...input,
      observations: observations as unknown as Readonly<{
        target: PublishEntryObservation;
        next: PublishEntryObservation;
        retiredNext: PublishEntryObservation;
      }>
    }));
  }, durability);
}

function assertInitiallyAbsentTransitionFromContract(
  predecessor: InitiallyAbsentEntryResolution,
  successor: InitiallyAbsentEntryResolution,
  expectedEdge: InitiallyAbsentTupleEdge,
  label: string
): void {
  const resolution = assertInitiallyAbsentEntryTransition({
    platform: process.platform as InitiallyAbsentTuplePlatform,
    predecessor: predecessor.tuple,
    successor: successor.tuple,
    expectedEdge
  });
  if (resolution.status === 'invalid') {
    throw new Error(`${label} initially-absent T/N/R transition contract rejected ${expectedEdge} (${resolution.reason}); preserving every entry.`);
  }
}

export async function publishInitiallyAbsentEntryNoReplace(input: {
  boundaryRoot: string;
  targetPath: string;
  targetKey: DocumentControlRecoveryTargetKey;
  nextPath: string;
  next: Buffer;
  label: string;
  durability: FreezeDurabilityOptions;
}): Promise<void> {
  const retiredNextPath = entryRecoveryPath({
    artifactRoot: input.boundaryRoot,
    operationId: byteDigest(input.next),
    targetKey: input.targetKey,
    suffix: 'retired-next'
  });
  const classifier = Object.freeze({
    boundaryRoot: input.boundaryRoot, targetPath: input.targetPath, nextPath: input.nextPath,
    retiredNextPath, next: input.next, label: input.label
  });
  let resolution = await observeInitiallyAbsentEntryTuple(classifier);
  const runSelectedRetainedEdge = async <T>(
    edge: (retained: InitiallyAbsentEntryResolution) => Promise<T>
  ): Promise<T> => withRetainedInitiallyAbsentEntryTuple(classifier, async (retained) => {
    if (retained.state !== resolution.state
        || !samePublishEntryObservation(retained.target, resolution.target)
        || !samePublishEntryObservation(retained.next, resolution.next)
        || !samePublishEntryObservation(retained.retiredNext, resolution.retiredNext)) {
      throw new Error(`${input.label} initially-absent tuple changed before its selected edge; preserving every entry.`);
    }
    return edge(retained);
  }, input.durability);
  const assertSuccessor = async (
    predecessor: InitiallyAbsentEntryResolution,
    expectedEdge: InitiallyAbsentTupleEdge
  ): Promise<void> => {
    const successor = await observeInitiallyAbsentEntryTuple(classifier);
    assertInitiallyAbsentTransitionFromContract(predecessor, successor, expectedEdge, input.label);
    resolution = successor;
  };
  if (resolution.state === 'win32-w2' || resolution.state === 'linux-l3') {
    await runSelectedRetainedEdge(async (retained) => flushPublishedFile({
      boundaryRoot: input.boundaryRoot, targetPath: input.targetPath, label: input.label, durability: input.durability,
      expectedBytes: input.next, expectedIdentity: retained.target.identity!, retained: retained.target.retained
    }));
    return;
  }
  if (resolution.state === 'win32-w0' || resolution.state === 'linux-l0') {
    await runSelectedRetainedEdge(async () => createSafeRegularFileExclusive({
      boundaryRoot: input.boundaryRoot, filePath: input.nextPath, bytes: input.next,
      label: `${input.label} NEXT recovery entry`, durability: input.durability
    }));
    await assertSuccessor(
      resolution,
      process.platform === 'win32' ? 'win32-w0->win32-w1' : 'linux-l0->linux-l1'
    );
  }
  if (resolution.state === 'win32-w1') {
    await runSelectedRetainedEdge(async (retained) => durableRename({
      boundaryRoot: input.boundaryRoot, sourcePath: input.nextPath, targetPath: input.targetPath,
      label: `${input.label} initial NEXT install`, durability: input.durability, replaceExisting: false,
      expectedSourceBytes: input.next, expectedSourceIdentity: retained.next.identity!, retained: retained.next.retained
    }));
    await assertSuccessor(resolution, 'win32-w1->win32-w2');
    return;
  }
  if (resolution.state === 'linux-l1') {
    await runSelectedRetainedEdge(async (retained) => durableLinkOpenedPosixFile({
      boundaryRoot: input.boundaryRoot, sourcePath: input.nextPath, targetPath: input.targetPath,
      expectedSourceBytes: input.next, expectedSourceIdentity: retained.next.identity!,
      label: `${input.label} exact initial NEXT install`, durability: input.durability, retained: retained.next.retained
    }));
    await assertSuccessor(resolution, 'linux-l1->linux-l2');
  }
  if (resolution.state === 'linux-l2') {
    await runSelectedRetainedEdge(async (retained) => durableRename({
      boundaryRoot: input.boundaryRoot, sourcePath: input.nextPath, targetPath: retiredNextPath,
      label: `${input.label} initial NEXT recovery retirement`, durability: input.durability, replaceExisting: false,
      expectedSourceBytes: input.next, expectedSourceIdentity: retained.next.identity!, retained: retained.next.retained
    }));
    await assertSuccessor(resolution, 'linux-l2->linux-l3');
  }
}
