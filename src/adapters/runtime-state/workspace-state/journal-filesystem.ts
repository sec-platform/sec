import path from 'node:path';

import { rawSha256Hex } from '../../../contracts/canonical.ts';
import { acquirePhysicalMutationLease, type PhysicalMutationLeaseOptions } from '../physical/runtime/mutation-lease.ts';
import { PhysicalNoFollowError, assertSameNoFollowDirectoryIdentity, createNoFollowOrdinaryDirectoryChain, deleteRetainedNoFollowEntry, inspectNoFollowDirectoryChain, inspectNoFollowDirectoryChild, inspectNoFollowOrdinaryFileEntry, publishExclusiveDurableCanonicalFile, readNoFollowOrdinaryFile, replaceDurableCanonicalFile, retainNoFollowOrdinaryFile, type PhysicalDirectoryIdentity, type RetainedNoFollowOrdinaryFile } from '../physical/runtime/physical-no-follow.ts';

interface RuntimeStateJournalReadBounds {
  readonly deadlineAtMonotonicMs: number;
  readonly maximumBytes: number;
}

export interface RuntimeStateJournalRetainedText {
  readonly text: string;
  readonly byteLength: number;
  readonly physical: Readonly<{ device: string; inode: string }>;
}

export type RuntimeStateJournalReadFailureKind = 'deadline-exhausted' | 'maximum-bytes-exceeded';

export class RuntimeStateJournalReadError extends Error {
  readonly kind: RuntimeStateJournalReadFailureKind;

  constructor(kind: RuntimeStateJournalReadFailureKind, message: string) {
    super(`Runtime State journal ${message}`);
    this.name = 'RuntimeStateJournalReadError';
    this.kind = kind;
  }
}

export interface RuntimeStateJournalFileSystem {
  readonly rootPath: string;
  exists(filePath: string): boolean;
  readText(filePath: string): string;
  /** Retains, bounds and reads one exact file handle; null means only that the leaf is absent. */
  readTextRetained(filePath: string, bounds: RuntimeStateJournalReadBounds): string | null;
  /** Retains one exact file and returns the bytes with the same-handle physical identity. */
  observeTextRetained(
    filePath: string,
    bounds: RuntimeStateJournalReadBounds
  ): RuntimeStateJournalRetainedText | null;
  ensureDirectory(directoryPath: string): void;
  appendFsyncCas(filePath: string, expectedText: string, text: string): boolean;
  replaceFsyncCas(filePath: string, expectedText: string, text: string): boolean;
  deleteFsyncCas(filePath: string, expectedText: string): boolean;
  createExclusiveFsync(filePath: string, text: string): boolean;
  mutateTextFsync(filePath: string, initialText: string, maximumBytes: number,
    mutate: (currentText: string) => string): string;
  replaceFsync(filePath: string, text: string): void;
  deleteIfPresent(filePath: string): boolean;
}

export type RuntimeStateJournalFileSystemOptions = PhysicalMutationLeaseOptions;

export function runtimeStateJournalMutationLeaseName(rootPath: string, filePath: string): string {
  return `.journal-mutation-${rawSha256Hex(path.relative(path.resolve(rootPath), path.resolve(filePath)))}.lock`;
}

function relativeSegments(rootPath: string, targetPath: string, allowRoot: boolean): readonly string[] {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if ((!allowRoot && relative.length === 0) || path.isAbsolute(relative)
      || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error('Runtime State journal path escapes its retained workspace root.');
  }
  if (relative.length === 0) return Object.freeze([]);
  const segments = relative.split(path.sep);
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..'
      || segment.includes('\0') || segment.length > 255)) {
    throw new Error('Runtime State journal path is not canonical.');
  }
  return Object.freeze(segments);
}

function exactBytes(expected: Buffer): (actual: Uint8Array) => void {
  return (actual) => {
    if (!Buffer.from(actual).equals(expected)) {
      throw new Error('Runtime State journal durable readback differs from requested bytes.');
    }
  };
}

function assertReadBounds(bounds: RuntimeStateJournalReadBounds): void {
  if (!Number.isFinite(bounds.deadlineAtMonotonicMs) || bounds.deadlineAtMonotonicMs < 0) {
    throw new RuntimeStateJournalReadError(
      'deadline-exhausted',
      'read deadline must be one finite absolute monotonic timestamp.'
    );
  }
  if (!Number.isSafeInteger(bounds.maximumBytes) || bounds.maximumBytes < 0) {
    throw new RuntimeStateJournalReadError(
      'maximum-bytes-exceeded',
      'read byte ceiling must be one nonnegative safe integer.'
    );
  }
  if (performance.now() >= bounds.deadlineAtMonotonicMs) {
    throw new RuntimeStateJournalReadError('deadline-exhausted', 'read deadline is exhausted.');
  }
}

export function createRuntimeStateJournalFileSystem(
  retainedWorkspaceStateRoot: PhysicalDirectoryIdentity,
  options: RuntimeStateJournalFileSystemOptions = {}
): RuntimeStateJournalFileSystem {
  const rootPath = path.resolve(retainedWorkspaceStateRoot.path);

  const root = (): PhysicalDirectoryIdentity => assertSameNoFollowDirectoryIdentity(
    retainedWorkspaceStateRoot,
    'Runtime State journal workspace root'
  ).target;

  const existingDirectory = (directoryPath: string): PhysicalDirectoryIdentity | null => {
    let current = root();
    for (const segment of relativeSegments(rootPath, directoryPath, true)) {
      const next = inspectNoFollowDirectoryChild(current, segment, 'Runtime State journal directory');
      if (next === null) return null;
      current = next;
    }
    return current;
  };

  const ensuredDirectory = (directoryPath: string): PhysicalDirectoryIdentity => {
    const segments = relativeSegments(rootPath, directoryPath, true);
    return segments.length === 0
      ? root()
      : createNoFollowOrdinaryDirectoryChain(root(), segments);
  };

  const fileParent = (
    filePath: string,
    create: boolean
  ): Readonly<{ parent: PhysicalDirectoryIdentity; name: string }> | null => {
    const segments = relativeSegments(rootPath, filePath, false);
    const name = segments.at(-1)!;
    const directoryPath = path.join(rootPath, ...segments.slice(0, -1));
    const parent = create ? ensuredDirectory(directoryPath) : existingDirectory(directoryPath);
    return parent === null ? null : Object.freeze({ parent, name });
  };

  const readBytes = (filePath: string): Buffer | null => {
    const retained = fileParent(filePath, false);
    if (retained === null) return null;
    const bytes = readNoFollowOrdinaryFile(retained.parent, retained.name);
    return bytes === null ? null : Buffer.from(bytes);
  };

  const observeTextRetained = (
    filePath: string,
    bounds: RuntimeStateJournalReadBounds
  ): RuntimeStateJournalRetainedText | null => {
    assertReadBounds(bounds);
    const retained = fileParent(filePath, false);
    if (retained === null) return null;
    if (inspectNoFollowOrdinaryFileEntry(retained.parent, retained.name) === null) return null;
    const parentChain = inspectNoFollowDirectoryChain(
      retained.parent.path,
      'Runtime State journal retained read parent'
    );
    let file: RetainedNoFollowOrdinaryFile;
    try {
      file = retainNoFollowOrdinaryFile(
        parentChain,
        retained.name,
        undefined,
        'Runtime State journal retained read'
      );
    } catch (error) {
      if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') {
        return null;
      }
      throw error;
    }
    try {
      assertReadBounds(bounds);
      if (file.size > bounds.maximumBytes) {
        throw new RuntimeStateJournalReadError(
          'maximum-bytes-exceeded',
          `retained file size ${file.size} exceeds maximumBytes ${bounds.maximumBytes}.`
        );
      }
      const bytes = file.readBytes();
      if (performance.now() >= bounds.deadlineAtMonotonicMs) {
        throw new RuntimeStateJournalReadError('deadline-exhausted', 'read deadline expired during observation.');
      }
      if (bytes.byteLength > bounds.maximumBytes) {
        throw new RuntimeStateJournalReadError(
          'maximum-bytes-exceeded',
          `retained bytes ${bytes.byteLength} exceed maximumBytes ${bounds.maximumBytes}.`
        );
      }
      return Object.freeze({
        text: Buffer.from(bytes).toString('utf8'),
        byteLength: bytes.byteLength,
        physical: file.physical
      });
    } finally {
      file.dispose();
    }
  };

  const withMutationLease = <T>(filePath: string, operation: () => T): T | null => {
    const retained = fileParent(filePath, true)!;
    const lockName = runtimeStateJournalMutationLeaseName(rootPath, filePath);
    const lease = acquirePhysicalMutationLease(retained.parent, lockName, options);
    if (lease === null) return null;
    let primaryFailure: unknown;
    let hasPrimaryFailure = false;
    try {
      // Journal recovery is bound to journal identity, never to a lease PID.
      lease.acknowledgeReclaimedRecovery();
      return operation();
    } catch (error) {
      primaryFailure = error;
      hasPrimaryFailure = true;
      throw error;
    } finally {
      try {
        if (lease.recoveryPending) lease.restoreReclaimedOwner();
        else lease.release();
      } catch (settlementFailure) {
        if (hasPrimaryFailure) {
          throw new AggregateError(
            [primaryFailure, settlementFailure],
            'Runtime State journal mutation and lease settlement both failed.'
          );
        }
        throw settlementFailure;
      }
    }
  };

  return Object.freeze({
    rootPath,
    exists: (filePath: string): boolean => readBytes(filePath) !== null,
    readText: (filePath: string): string => {
      const bytes = readBytes(filePath);
      if (bytes === null) throw new Error(`Runtime State journal file is absent: ${filePath}`);
      return bytes.toString('utf8');
    },
    readTextRetained: (
      filePath: string,
      bounds: RuntimeStateJournalReadBounds
    ) => observeTextRetained(filePath, bounds)?.text ?? null,
    observeTextRetained,
    ensureDirectory: (directoryPath: string): void => { ensuredDirectory(directoryPath); },
    appendFsyncCas(filePath: string, expectedText: string, text: string): boolean {
      return withMutationLease(filePath, () => {
        const current = readBytes(filePath)?.toString('utf8') ?? '';
        if (current !== expectedText) return false;
        const next = Buffer.from(`${current}${text}`, 'utf8');
        const retained = fileParent(filePath, true)!;
        replaceDurableCanonicalFile({
          parent: retained.parent,
          name: retained.name,
          bytes: next,
          validate: exactBytes(next)
        });
        return true;
      }) ?? false;
    },
    replaceFsyncCas(filePath: string, expectedText: string, text: string): boolean {
      return withMutationLease(filePath, () => {
        const current = readBytes(filePath)?.toString('utf8') ?? '';
        if (current !== expectedText) return false;
        const retained = fileParent(filePath, true)!;
        const bytes = Buffer.from(text, 'utf8');
        replaceDurableCanonicalFile({
          parent: retained.parent,
          name: retained.name,
          bytes,
          validate: exactBytes(bytes)
        });
        return true;
      }) ?? false;
    },
    deleteFsyncCas(filePath: string, expectedText: string): boolean {
      return withMutationLease(filePath, () => {
        const retained = fileParent(filePath, false);
        if (retained === null) return false;
        let file: RetainedNoFollowOrdinaryFile;
        try {
          file = retainNoFollowOrdinaryFile(
            inspectNoFollowDirectoryChain(
              retained.parent.path,
              'Runtime State journal exact deletion parent'
            ),
            retained.name,
            undefined,
            'Runtime State journal exact deletion'
          );
        } catch (error) {
          if (error instanceof PhysicalNoFollowError
              && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') return false;
          throw error;
        }
        try {
          const expected = Buffer.from(expectedText, 'utf8');
          if (file.size !== expected.byteLength
              || !Buffer.from(file.readBytes()).equals(expected)) return false;
          file.assertCurrent();
          const entry = inspectNoFollowOrdinaryFileEntry(retained.parent, retained.name);
          if (entry === null || entry.device !== file.physical.device
              || entry.inode !== file.physical.inode) return false;
          // The retained read handle excludes DELETE sharing on Windows.
          // Release it before the physical owner opens its byte-CAS delete
          // handle; that owner rechecks both FileId and bytes before effect.
          file.dispose();
          deleteRetainedNoFollowEntry({
            root: retained.parent,
            relativePath: entry.relativePath,
            kind: 'file',
            device: entry.device,
            inode: entry.inode,
            expectedFileBytes: expected,
            ancestorDirectories: []
          });
          return true;
        } finally {
          file.dispose();
        }
      }) ?? false;
    },
    createExclusiveFsync(filePath: string, text: string): boolean {
      const retained = fileParent(filePath, true)!;
      const bytes = Buffer.from(text, 'utf8');
      try {
        return publishExclusiveDurableCanonicalFile({
          parent: retained.parent,
          name: retained.name,
          bytes,
          validate: () => undefined
        }).created;
      } catch (error) {
        if (error instanceof PhysicalNoFollowError
            && readNoFollowOrdinaryFile(retained.parent, retained.name) !== null) return false;
        throw error;
      }
    },
    mutateTextFsync(filePath: string, initialText: string, maximumBytes: number,
      mutate: (currentText: string) => string): string {
      if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
        throw new Error('Runtime State journal mutation byte ceiling is invalid.');
      }
      const next = withMutationLease(filePath, () => {
        const retained = fileParent(filePath, true)!;
        const currentBytes = readNoFollowOrdinaryFile(retained.parent, retained.name);
        if (currentBytes !== null && currentBytes.byteLength > maximumBytes)
          throw new Error('Runtime State journal mutation source exceeds its byte ceiling.');
        const current = currentBytes === null ? initialText : Buffer.from(currentBytes).toString('utf8');
        const text = mutate(current);
        if (currentBytes !== null && text === current) return text;
        const bytes = Buffer.from(text, 'utf8');
        if (bytes.byteLength > maximumBytes)
          throw new Error('Runtime State journal mutation result exceeds its byte ceiling.');
        const publication = {
          parent: retained.parent, name: retained.name, bytes, validate: exactBytes(bytes)
        };
        if (currentBytes === null) publishExclusiveDurableCanonicalFile(publication);
        else replaceDurableCanonicalFile(publication);
        return text;
      });
      if (next === null) throw new Error('Runtime State journal mutation is contended.');
      return next;
    },
    replaceFsync(filePath: string, text: string): void {
      const replaced = withMutationLease(filePath, () => {
        const retained = fileParent(filePath, true)!;
        const bytes = Buffer.from(text, 'utf8');
        replaceDurableCanonicalFile({
          parent: retained.parent,
          name: retained.name,
          bytes,
          validate: exactBytes(bytes)
        });
      });
      if (replaced === null) throw new Error('Runtime State journal mutation is contended.');
    },
    deleteIfPresent(filePath: string): boolean {
      const deleted = withMutationLease(filePath, () => {
        const retained = fileParent(filePath, false);
        if (retained === null) return false;
        const entry = inspectNoFollowOrdinaryFileEntry(retained.parent, retained.name);
        if (entry === null) return false;
        deleteRetainedNoFollowEntry({
          root: retained.parent,
          relativePath: entry.relativePath,
          kind: 'file',
          device: entry.device,
          inode: entry.inode,
          ancestorDirectories: []
        });
        return true;
      });
      if (deleted === null) throw new Error('Runtime State journal deletion is contended.');
      return deleted;
    }
  });
}
