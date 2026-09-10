import path from 'node:path';

import {
  inspectNoFollowDirectoryChain,
  PhysicalNoFollowError,
  readNoFollowOrdinaryFile,
  type PhysicalDirectoryIdentity
} from './physical-no-follow.ts';

/**
 * Bind one already-authorized physical directory. Only exact physical absence
 * maps to null. The returned identity is not a permanently trusted cache:
 * every retained leaf read revalidates it before opening the leaf.
 */
export function retainOptionalDirectory(
  absoluteDirectoryPath: string,
  label = 'retained directory'
): PhysicalDirectoryIdentity | null {
  const resolvedDirectoryPath = path.resolve(absoluteDirectoryPath);
  try {
    return inspectNoFollowDirectoryChain(
      resolvedDirectoryPath,
      label
    ).target;
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Read one sibling below an already-bound parent. The physical primitive
 * revalidates the parent identity for every leaf, so sharing the initial
 * parent binding removes redundant chain observations without weakening the
 * substitution fence between sibling reads.
 */
export function readOptionalRetainedOrdinaryLeaf(
  parent: PhysicalDirectoryIdentity,
  name: string,
  options: Readonly<{ maximumBytes?: number }> = {}
): Uint8Array | null {
  return readNoFollowOrdinaryFile(parent, name, options);
}

/**
 * Mechanical physical read of one already-authorized absolute file path.
 * Domain containment/permission decisions remain with the caller. Only exact
 * physical absence maps to null; links, non-ordinary entries, identity races,
 * inaccessible ancestors and the underlying bounded-read ceiling fail closed.
 */
export function readOptionalRetainedOrdinaryFile(
  absolutePath: string,
  label = 'retained file'
): Uint8Array | null {
  const resolvedPath = path.resolve(absolutePath);
  const parent = retainOptionalDirectory(
    path.dirname(resolvedPath),
    `${label} parent`
  );
  return parent === null
    ? null
    : readOptionalRetainedOrdinaryLeaf(parent, path.basename(resolvedPath));
}

export function decodeExactUtf8(bytes: Uint8Array, label = 'retained file'): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`${label} is not exact UTF-8`, { cause: error });
  }
}

function parseRetainedJson<T>(bytes: Uint8Array, label: string): T {
  const source = decodeExactUtf8(bytes, label);
  try {
    return JSON.parse(source) as T;
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

export function readOptionalRetainedJsonLeaf<T>(
  parent: PhysicalDirectoryIdentity,
  name: string,
  label = 'retained JSON file'
): T | null {
  const bytes = readOptionalRetainedOrdinaryLeaf(parent, name);
  return bytes === null ? null : parseRetainedJson<T>(bytes, label);
}

export function readOptionalRetainedJson<T>(
  absolutePath: string,
  label = 'retained JSON file'
): T | null {
  const bytes = readOptionalRetainedOrdinaryFile(absolutePath, label);
  return bytes === null ? null : parseRetainedJson<T>(bytes, label);
}
