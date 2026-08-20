import path from 'node:path';

import {
  inspectNoFollowDirectoryChainV1,
  PhysicalNoFollowError,
  readNoFollowOrdinaryFileV1,
  type PhysicalDirectoryIdentityV1
} from './physical-no-follow.ts';

/**
 * Bind one already-authorized physical directory. Only exact physical absence
 * maps to null. The returned identity is not a permanently trusted cache:
 * every retained leaf read revalidates it before opening the leaf.
 */
export function retainOptionalDirectoryV1(
  absoluteDirectoryPath: string,
  label = 'retained directory'
): PhysicalDirectoryIdentityV1 | null {
  const resolvedDirectoryPath = path.resolve(absoluteDirectoryPath);
  try {
    return inspectNoFollowDirectoryChainV1(
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
export function readOptionalRetainedOrdinaryLeafV1(
  parent: PhysicalDirectoryIdentityV1,
  name: string
): Uint8Array | null {
  return readNoFollowOrdinaryFileV1(parent, name);
}

/**
 * Mechanical physical read of one already-authorized absolute file path.
 * Domain containment/permission decisions remain with the caller. Only exact
 * physical absence maps to null; links, non-ordinary entries, identity races,
 * inaccessible ancestors and the underlying bounded-read ceiling fail closed.
 */
export function readOptionalRetainedOrdinaryFileV1(
  absolutePath: string,
  label = 'retained file'
): Uint8Array | null {
  const resolvedPath = path.resolve(absolutePath);
  const parent = retainOptionalDirectoryV1(
    path.dirname(resolvedPath),
    `${label} parent`
  );
  return parent === null
    ? null
    : readOptionalRetainedOrdinaryLeafV1(parent, path.basename(resolvedPath));
}

export function decodeExactUtf8V1(bytes: Uint8Array, label = 'retained file'): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`${label} is not exact UTF-8`, { cause: error });
  }
}

function parseRetainedJsonV1<T>(bytes: Uint8Array, label: string): T {
  const source = decodeExactUtf8V1(bytes, label);
  try {
    return JSON.parse(source) as T;
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

export function readOptionalRetainedJsonLeafV1<T>(
  parent: PhysicalDirectoryIdentityV1,
  name: string,
  label = 'retained JSON file'
): T | null {
  const bytes = readOptionalRetainedOrdinaryLeafV1(parent, name);
  return bytes === null ? null : parseRetainedJsonV1<T>(bytes, label);
}

export function readOptionalRetainedJsonV1<T>(
  absolutePath: string,
  label = 'retained JSON file'
): T | null {
  const bytes = readOptionalRetainedOrdinaryFileV1(absolutePath, label);
  return bytes === null ? null : parseRetainedJsonV1<T>(bytes, label);
}
