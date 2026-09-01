import path from 'node:path';

import {
  createNoFollowOrdinaryDirectoryChain,
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  type PhysicalDirectoryChain,
  type PhysicalDirectoryIdentity
} from './physical-no-follow.ts';
import {
  resolveWindowsKnownFolderPath,
  type WindowsKnownFolder
} from './windows-known-folders.ts';

export type RetainedRuntimeStateDirectoryFailureCode =
  | 'RETAINED_RUNTIME_STATE_DIRECTORY_CLOSED'
  | 'RETAINED_RUNTIME_STATE_DIRECTORY_CLOSE_FAILED'
  | 'RETAINED_RUNTIME_STATE_DIRECTORY_INVALID_INPUT'
  | 'RETAINED_RUNTIME_STATE_DIRECTORY_OPEN_FAILED';

export class RetainedRuntimeStateDirectoryError extends Error {
  readonly code: RetainedRuntimeStateDirectoryFailureCode;

  constructor(
    code: RetainedRuntimeStateDirectoryFailureCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'RetainedRuntimeStateDirectoryError';
    this.code = code;
  }
}

export interface RetainedRuntimeStateDirectoryCloseReceipt {
  readonly state: 'closed';
  readonly path: string;
  readonly root: PhysicalDirectoryIdentity;
  readonly directory: PhysicalDirectoryIdentity;
}

/**
 * One physical runtime-state directory whose owner root, derived directory,
 * and complete ancestor chain remain retained for a bounded child lifecycle.
 */
export interface RetainedRuntimeStateDirectory {
  readonly path: string;
  readonly root: PhysicalDirectoryIdentity;
  readonly directory: PhysicalDirectoryIdentity;
  assertCurrent(): void;
  close(): RetainedRuntimeStateDirectoryCloseReceipt;
}

const ISSUED_RETAINED_RUNTIME_STATE_DIRECTORIES = new WeakSet<object>();

export function assertRetainedRuntimeStateDirectory(
  value: unknown
): asserts value is RetainedRuntimeStateDirectory {
  if (value === null || typeof value !== 'object'
      || !ISSUED_RETAINED_RUNTIME_STATE_DIRECTORIES.has(value)) {
    throw new RetainedRuntimeStateDirectoryError(
      'RETAINED_RUNTIME_STATE_DIRECTORY_INVALID_INPUT',
      'Runtime-state directory was not issued by the retained physical owner.'
    );
  }
}

export type RuntimeStateDirectoryOpenMode = 'create-or-open' | 'open-existing';

function validateSegments(segments: readonly string[]): readonly string[] {
  if (!Array.isArray(segments) || segments.length > 32) {
    throw new RetainedRuntimeStateDirectoryError(
      'RETAINED_RUNTIME_STATE_DIRECTORY_INVALID_INPUT',
      'Retained runtime-state directory segments are invalid.'
    );
  }
  for (const segment of segments) {
    if (typeof segment !== 'string' || segment.length === 0 || segment.length > 255
      || segment === '.' || segment === '..' || /[\\/\0]/u.test(segment)) {
      throw new RetainedRuntimeStateDirectoryError(
        'RETAINED_RUNTIME_STATE_DIRECTORY_INVALID_INPUT',
        'Retained runtime-state directory segment is invalid.'
      );
    }
  }
  return Object.freeze([...segments]);
}

function samePhysicalIdentity(
  left: PhysicalDirectoryIdentity,
  right: PhysicalDirectoryIdentity
): boolean {
  return left.path === right.path && left.finalPath === right.finalPath
    && left.device === right.device && left.inode === right.inode
    && left.objectId === right.objectId;
}

/**
 * Opens beneath an already owner-issued root. Creation, when explicitly
 * selected, is relative to that retained physical identity and never to an
 * ambient or caller-invented absolute path.
 */
export function openRetainedRuntimeStateDirectoryAtOwnerIssuedRoot(input: Readonly<{
  childDescriptor: number;
  mode: RuntimeStateDirectoryOpenMode;
  root: PhysicalDirectoryChain;
  segments?: readonly string[];
}>): RetainedRuntimeStateDirectory {
  const segments = validateSegments(input.segments ?? []);
  let retained: ReturnType<typeof retainNoFollowDirectoryForChildProcess> | null = null;
  try {
    const currentRoot = inspectNoFollowDirectoryChain(
      input.root.target.path,
      'Retained runtime-state owner root'
    );
    if (!samePhysicalIdentity(input.root.target, currentRoot.target)) {
      throw new Error('Retained runtime-state owner root identity changed before open.');
    }
    const expectedDirectory = input.mode === 'create-or-open'
      ? createNoFollowOrdinaryDirectoryChain(currentRoot.target, segments)
      : inspectNoFollowDirectoryChain(
        path.join(currentRoot.target.path, ...segments),
        'Retained runtime-state directory'
      ).target;
    const directoryChain = inspectNoFollowDirectoryChain(
      expectedDirectory.path,
      'Retained runtime-state directory'
    );
    if (!samePhysicalIdentity(expectedDirectory, directoryChain.target)) {
      throw new Error('Retained runtime-state directory identity changed before retention.');
    }
    retained = retainNoFollowDirectoryForChildProcess(
      directoryChain,
      input.childDescriptor,
      'Retained runtime-state directory'
    );
    let closeReceipt: RetainedRuntimeStateDirectoryCloseReceipt | null = null;
    let closeFailure: RetainedRuntimeStateDirectoryError | null = null;
    const capability: RetainedRuntimeStateDirectory = Object.freeze({
      path: directoryChain.target.path,
      root: currentRoot.target,
      directory: directoryChain.target,
      assertCurrent(): void {
        if (closeReceipt !== null || closeFailure !== null) {
          throw new RetainedRuntimeStateDirectoryError(
            'RETAINED_RUNTIME_STATE_DIRECTORY_CLOSED',
            'Retained runtime-state directory is closed.'
          );
        }
        retained!.assertCurrent();
      },
      close(): RetainedRuntimeStateDirectoryCloseReceipt {
        if (closeFailure !== null) throw closeFailure;
        if (closeReceipt !== null) return closeReceipt;
        const failures: unknown[] = [];
        try { retained!.assertCurrent(); } catch (error) { failures.push(error); }
        // Disposal is unconditional: identity drift revokes successful
        // readback, but it must never retain the handle or suppress closure of
        // sibling runtime roots.
        try { retained!.dispose(); } catch (error) { failures.push(error); }
        try {
          if (failures.length > 0) {
            throw failures.length === 1
              ? failures[0]
              : new AggregateError(
                failures,
                'Retained runtime-state directory readback and disposal failed.'
              );
          }
          closeReceipt = Object.freeze({
            state: 'closed' as const,
            path: directoryChain.target.path,
            root: currentRoot.target,
            directory: directoryChain.target
          });
          return closeReceipt;
        } catch (error) {
          closeFailure = new RetainedRuntimeStateDirectoryError(
            'RETAINED_RUNTIME_STATE_DIRECTORY_CLOSE_FAILED',
            'Retained runtime-state directory could not close with exact identity.',
            { cause: error }
          );
          throw closeFailure;
        }
      }
    });
    ISSUED_RETAINED_RUNTIME_STATE_DIRECTORIES.add(capability);
    return capability;
  } catch (error) {
    try { retained?.dispose(); } catch { /* retain the typed open failure */ }
    if (error instanceof RetainedRuntimeStateDirectoryError) throw error;
    throw new RetainedRuntimeStateDirectoryError(
      'RETAINED_RUNTIME_STATE_DIRECTORY_OPEN_FAILED',
      'Retained runtime-state directory could not be opened.',
      { cause: error }
    );
  }
}

/** Resolves the root from the current Windows token, then retains its physical identity. */
export async function openRetainedWindowsRuntimeStateDirectory(input: Readonly<{
  childDescriptor: number;
  folder: WindowsKnownFolder;
  mode?: RuntimeStateDirectoryOpenMode;
  segments?: readonly string[];
}>): Promise<RetainedRuntimeStateDirectory> {
  try {
    const ownerPath = await resolveWindowsKnownFolderPath(input.folder);
    const root = inspectNoFollowDirectoryChain(
      ownerPath,
      `Windows runtime-state ${input.folder} owner root`
    );
    return openRetainedRuntimeStateDirectoryAtOwnerIssuedRoot({
      childDescriptor: input.childDescriptor,
      mode: input.mode ?? 'open-existing',
      root,
      ...(input.segments === undefined ? {} : { segments: input.segments })
    });
  } catch (error) {
    if (error instanceof RetainedRuntimeStateDirectoryError) throw error;
    throw new RetainedRuntimeStateDirectoryError(
      'RETAINED_RUNTIME_STATE_DIRECTORY_OPEN_FAILED',
      `Windows runtime-state ${input.folder} owner root could not be opened.`,
      { cause: error }
    );
  }
}
