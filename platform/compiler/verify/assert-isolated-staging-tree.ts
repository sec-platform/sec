import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import { CompilerError } from '../../shared/errors.ts';

type FileMetadata = Awaited<ReturnType<typeof lstat>>;

interface ReparsePointInspector {
  hasReparsePoint(filePath: string): boolean;
  close(): void;
}

const FILE_ATTRIBUTE_REPARSE_POINT = 0x0000_0400;
const INVALID_FILE_ATTRIBUTES = 0xffff_ffff;

function isolationFailure(message: string, relativePath: string): never {
  throw new CompilerError('VERIFY-ISOLATION-001', message, { relativePath });
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

async function inspectEntry(
  canonicalRoot: string,
  absolutePath: string,
  relativePath: string,
  reparsePoints: ReparsePointInspector
): Promise<void> {
  const before = await lstat(absolutePath);
  if (before.isSymbolicLink() || reparsePoints.hasReparsePoint(absolutePath)) {
    isolationFailure('Staging tree contains a symbolic link, junction, or reparse point', relativePath);
  }
  if (!before.isDirectory() && !before.isFile()) {
    isolationFailure('Staging tree contains an unsupported special entry', relativePath);
  }
  if (before.isFile() && Number(before.nlink) !== 1) {
    isolationFailure('Staging tree contains a hard-linked file', relativePath);
  }

  const canonicalEntry = await realpath(absolutePath);
  const expectedEntry = relativePath === '.'
    ? canonicalRoot
    : path.resolve(canonicalRoot, ...relativePath.split('/'));
  if (!isInside(canonicalRoot, canonicalEntry) || foldedPath(canonicalEntry) !== foldedPath(expectedEntry)) {
    isolationFailure('Staging entry realpath escapes or aliases the isolated workspace', relativePath);
  }

  if (before.isDirectory()) {
    const entries = await readdir(absolutePath);
    for (const name of entries.sort((left, right) => left.localeCompare(right))) {
      const childRelative = relativePath === '.' ? name : `${relativePath}/${name}`;
      await inspectEntry(canonicalRoot, path.join(absolutePath, name), childRelative, reparsePoints);
    }
  }

  const after = await lstat(absolutePath);
  if (!sameIdentity(before, after)) {
    isolationFailure('Staging entry identity changed while its isolation boundary was inspected', relativePath);
  }
}

export async function assertIsolatedStagingTree(stagingWorkspaceRoot: string): Promise<void> {
  const resolvedRoot = path.resolve(stagingWorkspaceRoot);
  let reparsePoints: ReparsePointInspector | undefined;
  try {
    reparsePoints = await createReparsePointInspector();
    const rootMetadata = await lstat(resolvedRoot);
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink() || reparsePoints.hasReparsePoint(resolvedRoot)) {
      isolationFailure('Isolated staging root must be a real directory without reparse traversal', '.');
    }
    const canonicalRoot = await realpath(resolvedRoot);
    if (foldedPath(canonicalRoot) !== foldedPath(resolvedRoot)) {
      isolationFailure('Isolated staging root realpath aliases another workspace', '.');
    }
    await inspectEntry(canonicalRoot, resolvedRoot, '.', reparsePoints);
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
