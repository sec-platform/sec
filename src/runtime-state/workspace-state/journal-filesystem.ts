import { createHash } from 'node:crypto';
import path from 'node:path';

import { acquirePhysicalMutationLease, type PhysicalMutationLeaseOptions } from '../physical/runtime/mutation-lease.ts';
import { PhysicalNoFollowError, assertSameNoFollowDirectoryIdentity, createNoFollowOrdinaryDirectoryChain, deleteRetainedNoFollowEntry, inspectNoFollowDirectoryChild, inspectNoFollowOrdinaryFileEntry, publishExclusiveDurableCanonicalFile, readNoFollowOrdinaryFile, replaceDurableCanonicalFile, type PhysicalDirectoryIdentity } from '../physical/runtime/physical-no-follow.ts';

export interface RuntimeStateJournalFileSystem {
  readonly rootPath: string;
  exists(filePath: string): boolean;
  readText(filePath: string): string;
  ensureDirectory(directoryPath: string): void;
  appendFsyncCas(filePath: string, expectedText: string, text: string): boolean;
  createExclusiveFsync(filePath: string, text: string): boolean;
  replaceFsync(filePath: string, text: string): void;
  deleteIfPresent(filePath: string): boolean;
}

export type RuntimeStateJournalFileSystemOptions = PhysicalMutationLeaseOptions;

export function runtimeStateJournalMutationLeaseName(rootPath: string, filePath: string): string {
  return `.journal-mutation-${createHash('sha256')
    .update(path.relative(path.resolve(rootPath), path.resolve(filePath)))
    .digest('hex')}.lock`;
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

  const withMutationLease = <T>(filePath: string, operation: () => T): T | null => {
    const retained = fileParent(filePath, true)!;
    const lockName = runtimeStateJournalMutationLeaseName(rootPath, filePath);
    const lease = acquirePhysicalMutationLease(retained.parent, lockName, options);
    if (lease === null) return null;
    try {
      return operation();
    } finally {
      lease.release();
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
