import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import { CompilerError } from '../../compiler/errors.ts';
import { compareCodeUnits } from '../../contracts/canonical.ts';
import { isSemanticMutationStagingWorkspace } from '../../workspace/contract/semantic-mutation/staging.ts';
import { WORKSPACE_WRITE_LEASE_DIRECTORY_NAME, inspectWorkspaceWriteLease, withWorkspaceWriteLeaseControlPlaneQuiesced, type WorkspaceWriteLeaseToken } from '../filesystem/write-lease.ts';
import { ISOLATED_VERIFICATION_ENV_KEY } from '../runtime-state/physical/runtime/process.ts';

type FileMetadata = Awaited<ReturnType<typeof lstat>>;
type IsolationFilesystemOperation =
  | 'entry-lstat'
  | 'entry-readdir'
  | 'entry-realpath'
  | 'entry-revalidate'
  | 'entry-revalidate-readdir'
  | 'root-lstat'
  | 'root-realpath';

interface StagingEntrySnapshot {
  readonly absolutePath: string;
  readonly childNames?: readonly string[];
  readonly metadata: FileMetadata;
  readonly relativePath: string;
}

type CanonicalHardLinkProof = (
  absolutePath: string,
  metadata: FileMetadata
) => Promise<boolean>;

export interface IsolatedStagingTreeOptions {
  readonly executionBoundary?: 'windows-appcontainer';
  readonly workspaceWriteLease?: WorkspaceWriteLeaseToken;
}

interface IsolatedStagingTreeTestOptions extends IsolatedStagingTreeOptions {
  readonly afterInitialTraversal: () => Promise<void> | void;
}

interface ReparsePointInspector {
  hasReparsePoint(filePath: string): boolean;
  close(): void;
}

const FILE_ATTRIBUTE_REPARSE_POINT = 0x0000_0400;
const INVALID_FILE_ATTRIBUTES = 0xffff_ffff;
const ISOLATION_SCAN_CONCURRENCY = 64;

function isolationFailure(message: string, relativePath: string): never {
  throw new CompilerError('VERIFY-ISOLATION-001', message, { relativePath });
}

async function proveFilesystemOperation<T>(
  operation: IsolationFilesystemOperation,
  action: () => Promise<T>
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof CompilerError) throw error;
    throw new CompilerError(
      'VERIFY-ISOLATION-001',
      'Isolated staging tree boundary could not be proven',
      {
        errorCode: error instanceof Error && 'code' in error ? String(error.code) : 'UNKNOWN',
        operation
      }
    );
  }
}

function foldedPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function sameIdentity(left: FileMetadata, right: FileMetadata): boolean {
  return String(left.dev) === String(right.dev) &&
    String(left.ino) === String(right.ino) &&
    Number(left.mode) === Number(right.mode) &&
    Number(left.nlink) === Number(right.nlink);
}

async function createReparsePointInspector(): Promise<ReparsePointInspector> {
  if (process.platform !== 'win32') {
    return { hasReparsePoint: () => false, close: () => undefined };
  }
  const { dlopen, FFIType } = await import('bun:ffi');
  const kernel32 = dlopen('kernel32.dll', {
    GetFileAttributesW: {
      args: [FFIType.ptr],
      returns: FFIType.u32
    }
  } as const);
  return {
    hasReparsePoint(filePath: string): boolean {
      const widePath = Buffer.from(`${path.toNamespacedPath(path.resolve(filePath))}\0`, 'utf16le');
      const attributes = kernel32.symbols.GetFileAttributesW(widePath);
      if (attributes === INVALID_FILE_ATTRIBUTES) {
        isolationFailure('Staging entry Windows attributes could not be proven', filePath);
      }
      return (attributes & FILE_ATTRIBUTE_REPARSE_POINT) !== 0;
    },
    close(): void {
      kernel32.close();
    }
  };
}

async function runCanonicalBatches<T, R>(
  items: readonly T[],
  worker: (item: T, canonicalIndex: number) => Promise<R>
): Promise<readonly R[]> {
  const output: R[] = [];
  for (let offset = 0; offset < items.length; offset += ISOLATION_SCAN_CONCURRENCY) {
    const batch = items.slice(offset, offset + ISOLATION_SCAN_CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((item, index) =>
      Promise.resolve().then(() => worker(item, offset + index))));
    const failure = settled.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    for (const result of settled) {
      if (result.status === 'fulfilled') output.push(result.value);
    }
  }
  return Object.freeze(output);
}

async function inspectEntrySnapshot(
  canonicalRoot: string,
  absolutePath: string,
  relativePath: string,
  reparsePoints: ReparsePointInspector,
  requireRealpathProof: boolean,
  proveCanonicalHardLink?: CanonicalHardLinkProof
): Promise<StagingEntrySnapshot> {
  const before = await proveFilesystemOperation('entry-lstat', () => lstat(absolutePath));
  if (before.isSymbolicLink() || reparsePoints.hasReparsePoint(absolutePath)) {
    isolationFailure('Staging tree contains a symbolic link, junction, or reparse point', relativePath);
  }
  if (!before.isDirectory() && !before.isFile()) {
    isolationFailure('Staging tree contains an unsupported special entry', relativePath);
  }
  if (before.isFile() && Number(before.nlink) !== 1 &&
    (!proveCanonicalHardLink || !await proveCanonicalHardLink(absolutePath, before))) {
    isolationFailure('Staging tree contains a hard-linked file', relativePath);
  }

  const expectedEntry = relativePath === '.'
    ? canonicalRoot
    : path.resolve(canonicalRoot, ...relativePath.split('/'));
  if (requireRealpathProof) {
    const canonicalEntry = await proveFilesystemOperation(
      'entry-realpath',
      () => realpath(absolutePath)
    );
    if (!isInside(canonicalRoot, canonicalEntry) ||
      foldedPath(canonicalEntry) !== foldedPath(expectedEntry)) {
      isolationFailure('Staging entry realpath escapes or aliases the isolated workspace', relativePath);
    }
  }

  const childNames = before.isDirectory()
    ? Object.freeze((await proveFilesystemOperation(
        'entry-readdir',
        () => readdir(absolutePath)
      )).sort((left, right) => compareCodeUnits(left, right)))
    : undefined;
  if (!before.isDirectory()) {
    const after = await proveFilesystemOperation('entry-revalidate', () => lstat(absolutePath));
    if (after.isSymbolicLink() || reparsePoints.hasReparsePoint(absolutePath) ||
      !sameIdentity(before, after)) {
      isolationFailure(
        'Staging entry identity changed while its isolation boundary was inspected',
        relativePath
      );
    }
  }
  return Object.freeze({
    absolutePath,
    ...(childNames === undefined ? {} : { childNames }),
    metadata: before,
    relativePath
  });
}

async function revalidateEntrySnapshot(
  snapshot: StagingEntrySnapshot,
  reparsePoints: ReparsePointInspector
): Promise<void> {
  const beforeChildren = await proveFilesystemOperation(
    'entry-revalidate',
    () => lstat(snapshot.absolutePath)
  );
  if (beforeChildren.isSymbolicLink() || reparsePoints.hasReparsePoint(snapshot.absolutePath) ||
    !sameIdentity(snapshot.metadata, beforeChildren)) {
    isolationFailure(
      'Staging entry identity changed while its isolation boundary was inspected',
      snapshot.relativePath
    );
  }
  if (snapshot.childNames === undefined) return;

  const childNames = Object.freeze((await proveFilesystemOperation(
    'entry-revalidate-readdir',
    () => readdir(snapshot.absolutePath)
  )).sort((left, right) => compareCodeUnits(left, right)));
  const afterChildren = await proveFilesystemOperation(
    'entry-revalidate',
    () => lstat(snapshot.absolutePath)
  );
  if (afterChildren.isSymbolicLink() || reparsePoints.hasReparsePoint(snapshot.absolutePath) ||
    !sameIdentity(snapshot.metadata, afterChildren)) {
    isolationFailure(
      'Staging entry identity changed while its isolation boundary was inspected',
      snapshot.relativePath
    );
  }
  if (childNames.length !== snapshot.childNames.length ||
    childNames.some((name, index) => name !== snapshot.childNames![index])) {
    isolationFailure(
      'Staging directory entries changed while its isolation boundary was inspected',
      snapshot.relativePath
    );
  }
}

async function inspectTree(
  canonicalRoot: string,
  resolvedRoot: string,
  reparsePoints: ReparsePointInspector,
  requireRealpathProof: boolean,
  proveCanonicalHardLink?: CanonicalHardLinkProof,
  afterInitialTraversal?: () => Promise<void> | void
): Promise<void> {
  let frontier: readonly Readonly<{ absolutePath: string; relativePath: string }>[] =
    Object.freeze([{ absolutePath: resolvedRoot, relativePath: '.' }]);
  const snapshots: StagingEntrySnapshot[] = [];
  while (frontier.length > 0) {
    const inspected = await runCanonicalBatches(frontier, (entry) => inspectEntrySnapshot(
      canonicalRoot,
      entry.absolutePath,
      entry.relativePath,
      reparsePoints,
      requireRealpathProof,
      proveCanonicalHardLink
    ));
    snapshots.push(...inspected);
    frontier = Object.freeze(inspected.flatMap((snapshot) =>
      snapshot.childNames?.map((name) => {
        if (name === '' || name === '.' || name === '..' || name.includes('/') ||
          name.includes('\\') || name.includes('\0')) {
          isolationFailure('Staging tree contains a non-canonical child name', snapshot.relativePath);
        }
        return Object.freeze({
          absolutePath: path.join(snapshot.absolutePath, name),
          relativePath: snapshot.relativePath === '.' ? name : `${snapshot.relativePath}/${name}`
        });
      }) ?? []));
  }
  await afterInitialTraversal?.();
  await runCanonicalBatches(snapshots, (snapshot) =>
    revalidateEntrySnapshot(snapshot, reparsePoints));
}

async function assertIsolatedStagingTreeInternal(
  stagingWorkspaceRoot: string,
  options: IsolatedStagingTreeOptions,
  testOptions?: IsolatedStagingTreeTestOptions
): Promise<void> {
  const resolvedRoot = path.resolve(stagingWorkspaceRoot);
  const appContainerBoundary = options.executionBoundary === 'windows-appcontainer';
  let reparsePoints: ReparsePointInspector | undefined;
  try {
    if (appContainerBoundary && (process.platform !== 'win32' ||
      process.env[ISOLATED_VERIFICATION_ENV_KEY] !== '1' ||
      !isSemanticMutationStagingWorkspace(resolvedRoot))) {
      isolationFailure('Windows AppContainer staging scan boundary is invalid', '.');
    }
    const inspect = async (proveCanonicalHardLink?: CanonicalHardLinkProof): Promise<void> => {
      reparsePoints = await createReparsePointInspector();
      const rootMetadata = await proveFilesystemOperation('root-lstat', () => lstat(resolvedRoot));
      if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink() ||
        reparsePoints.hasReparsePoint(resolvedRoot)) {
        isolationFailure('Isolated staging root must be a real directory without reparse traversal', '.');
      }
      const canonicalRoot = appContainerBoundary
        ? resolvedRoot
        : await proveFilesystemOperation('root-realpath', () => realpath(resolvedRoot));
      if (!appContainerBoundary && foldedPath(canonicalRoot) !== foldedPath(resolvedRoot)) {
        isolationFailure('Isolated staging root realpath aliases another workspace', '.');
      }
      // On Windows every entry is checked with GetFileAttributesW below. Once the
      // canonical root is proven, rejecting every reparse point makes another
      // realpath syscall per descendant redundant. POSIX still needs realpath to
      // prove that an otherwise ordinary-looking descendant stays under the root.
      const requireEntryRealpathProof = !appContainerBoundary && process.platform !== 'win32';
      await inspectTree(
        canonicalRoot,
        resolvedRoot,
        reparsePoints,
        requireEntryRealpathProof,
        proveCanonicalHardLink,
        testOptions?.afterInitialTraversal
      );
    };
    if (options.workspaceWriteLease) {
      await withWorkspaceWriteLeaseControlPlaneQuiesced(
        resolvedRoot,
        options.workspaceWriteLease,
        async () => {
          const leaseRoot = path.join(
            resolvedRoot,
            '.sec',
            WORKSPACE_WRITE_LEASE_DIRECTORY_NAME
          );
          await inspect(async (absolutePath, metadata) => {
            if (!isInside(leaseRoot, absolutePath)) return false;
            const inspection = await inspectWorkspaceWriteLease(resolvedRoot);
            if (!inspection.authorityPaths.some((authorityPath) =>
              foldedPath(authorityPath) === foldedPath(absolutePath))) {
              return false;
            }
            const revalidated = await proveFilesystemOperation(
              'entry-revalidate',
              () => lstat(absolutePath)
            );
            return sameIdentity(metadata, revalidated);
          });
        }
      );
    } else {
      await inspect();
    }
  } catch (error) {
    if (error instanceof CompilerError) throw error;
    throw new CompilerError(
      'VERIFY-ISOLATION-001',
      'Isolated staging tree boundary could not be proven',
      { errorCode: error instanceof Error && 'code' in error ? String(error.code) : 'UNKNOWN' }
    );
  } finally {
    reparsePoints?.close();
  }
}

export async function assertIsolatedStagingTree(
  stagingWorkspaceRoot: string,
  options: IsolatedStagingTreeOptions = {}
): Promise<void> {
  await assertIsolatedStagingTreeInternal(stagingWorkspaceRoot, options);
}

/** Test-only seam for deterministic mutation between traversal and final revalidation. */
export async function assertIsolatedStagingTreeForTests(
  stagingWorkspaceRoot: string,
  options: IsolatedStagingTreeTestOptions
): Promise<void> {
  await assertIsolatedStagingTreeInternal(stagingWorkspaceRoot, options, options);
}
