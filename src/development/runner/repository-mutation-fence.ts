import { lstat, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';

import { rawSha256, sha256, uniqueSorted } from '../../system-architecture/foundation/runtime/canonical.ts';
import { GitReadAuthorityError, withAuthorityGitReadSession } from '../../external-capabilities/git-read/authority.ts';
import { type GitReadSession } from '../../external-capabilities/git-read/runtime/session.ts';
import { compilerRoot } from '../../workspace/paths.ts';
import { CodexDevelopmentIsCanonicalRepositoryPath } from '../../system-architecture/foundation/contract/repository-path.ts';

export interface RepositoryMutationState {
  readonly schema: 'sec-repository-mutation-state-v1';
  readonly digest: `sha256:${string}`;
  readonly changedPaths: readonly string[];
}

export interface RepositoryMutationFenceOptions {
  readonly repositoryRoot?: string;
  readonly report?: (message: string) => void;
}

async function gitBytes(session: GitReadSession, args: string[], label: string): Promise<Uint8Array> {
  const command = await session.run(['-c', 'core.quotepath=false', ...args]);
  if (command.kind !== 'completed') {
    throw new GitReadAuthorityError(`Repository mutation fence could not ${label}.`, command);
  }
  if (command.result.code !== 0) {
    throw new Error(
      `Repository mutation fence could not ${label}: ${command.result.stderr.trim()}`
    );
  }
  return command.result.stdout;
}

function decodeNulRecords(bytes: Uint8Array, label: string): string[] {
  if (bytes.byteLength === 0) return [];
  let value: string;
  try {
    value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`Repository mutation fence ${label} is not UTF-8`);
  }
  if (!value.endsWith('\0')) {
    throw new Error(`Repository mutation fence ${label} is not NUL terminated`);
  }
  return value.slice(0, -1).split('\0');
}

function canonicalPath(value: string, label: string): string {
  if (!CodexDevelopmentIsCanonicalRepositoryPath(value)) {
    throw new Error(`Repository mutation fence ${label} contains a non-canonical path`);
  }
  return value;
}

function statusPaths(bytes: Uint8Array): string[] {
  const records = decodeNulRecords(bytes, 'status');
  const paths: string[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    if (record.length < 4 || record[2] !== ' ') {
      throw new Error('Repository mutation fence status record is malformed');
    }
    paths.push(canonicalPath(record.slice(3), 'status'));
    if (record[0] === 'R' || record[0] === 'C' || record[1] === 'R' || record[1] === 'C') {
      const previousPath = records[index + 1];
      if (previousPath === undefined) {
        throw new Error('Repository mutation fence rename status is incomplete');
      }
      paths.push(canonicalPath(previousPath, 'status'));
      index += 1;
    }
  }
  return uniqueSorted(paths);
}

async function untrackedState(
  repositoryRoot: string,
  inventoryBytes: Uint8Array
): Promise<ReadonlyArray<Readonly<{ path: string; kind: 'file' | 'symlink'; digest: `sha256:${string}` }>>> {
  const paths = decodeNulRecords(inventoryBytes, 'untracked inventory')
    .map((repositoryPath) => canonicalPath(repositoryPath, 'untracked inventory'));
  if (new Set(paths).size !== paths.length) {
    throw new Error('Repository mutation fence untracked inventory contains duplicates');
  }
  return Promise.all(paths.sort().map(async (repositoryPath) => {
    const filePath = path.join(repositoryRoot, ...repositoryPath.split('/'));
    const metadata = await lstat(filePath);
    if (metadata.isSymbolicLink()) {
      return Object.freeze({
        path: repositoryPath,
        kind: 'symlink' as const,
        digest: rawSha256(await readlink(filePath))
      });
    }
    if (!metadata.isFile()) {
      throw new Error('Repository mutation fence untracked entry is not a regular file or symlink');
    }
    return Object.freeze({
      path: repositoryPath,
      kind: 'file' as const,
      digest: rawSha256(await readFile(filePath))
    });
  }));
}

/**
 * Captures the exact Git-visible repository state without requiring a clean
 * candidate. The mature Git porcelain/plumbing surfaces own tracked/index
 * identity; only untracked ordinary files are hashed locally. Comparing two
 * snapshots therefore detects a test that adds, removes, stages, or rewrites
 * repository state while preserving legitimate pre-existing dirty work.
 */
export async function captureRepositoryMutationState(
  repositoryRoot = compilerRoot
): Promise<RepositoryMutationState> {
  return withAuthorityGitReadSession({
    cwd: repositoryRoot,
    environment: { LANG: 'C', LC_ALL: 'C' },
    budget: {
      deadlineMs: 30_000,
      maxProcesses: 5,
      maxStdoutBytes: 64 * 1024 * 1024,
      maxStderrBytes: 512 * 1024,
      maxRecords: 250_000
    }
  }, async (session) => {
    const head = await gitBytes(session, ['rev-parse', '--verify', 'HEAD^{commit}'], 'resolve HEAD');
    const index = await gitBytes(session, ['ls-files', '--stage', '-z'], 'snapshot the index');
    const trackedDiff = await gitBytes(session, [
      'diff', '--binary', '--no-ext-diff', '--full-index', '--no-renames', 'HEAD', '--', '.'
    ], 'snapshot tracked worktree changes');
    const status = await gitBytes(session, [
      'status', '--porcelain=v1', '-z', '--untracked-files=all'
    ], 'snapshot repository status');
    const untrackedInventory = await gitBytes(session, [
      'ls-files', '--others', '--exclude-standard', '-z'
    ], 'inventory untracked files');
    const headText = new TextDecoder('utf-8', { fatal: true }).decode(head).trim();
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(headText)) {
      throw new Error('Repository mutation fence HEAD is not one exact object id');
    }
    const indexRecords = decodeNulRecords(index, 'index inventory');
    const changedPaths = statusPaths(status);
    const untrackedPaths = decodeNulRecords(untrackedInventory, 'untracked inventory');
    const recordFailure = session.consumeRecords(
      indexRecords.length + changedPaths.length + untrackedPaths.length
    );
    if (recordFailure !== null) {
      throw new GitReadAuthorityError(
        'Repository mutation fence record inventory exceeded its authority budget.',
        recordFailure
      );
    }
    const untracked = await untrackedState(repositoryRoot, untrackedInventory);
    const identity = {
      head: headText,
      indexDigest: rawSha256(index),
      trackedDiffDigest: rawSha256(trackedDiff),
      statusDigest: rawSha256(status),
      untracked
    };
    return Object.freeze({
      schema: 'sec-repository-mutation-state-v1',
      digest: sha256(identity) as `sha256:${string}`,
      changedPaths: Object.freeze(changedPaths)
    });
  });
}

/** Runs one complete developer command behind a single before/after fence. */
export async function runRepositoryZeroWriteOperation(
  commandId: string,
  operation: () => Promise<number>,
  options: RepositoryMutationFenceOptions = {}
): Promise<number> {
  const repositoryRoot = options.repositoryRoot ?? compilerRoot;
  const report = options.report ?? console.error;
  const before = await captureRepositoryMutationState(repositoryRoot);
  let result = 1;
  let hasPrimaryFailure = false;
  let primaryFailure: unknown;
  try {
    result = await operation();
  } catch (error) {
    hasPrimaryFailure = true;
    primaryFailure = error;
  }

  try {
    const after = await captureRepositoryMutationState(repositoryRoot);
    if (after.digest !== before.digest) {
      const observedPaths = uniqueSorted([
        ...before.changedPaths,
        ...after.changedPaths
      ]);
      report(
        `${commandId} mutated Git-visible repository state; test and check commands must be zero-write. `
        + `before=${before.digest}; after=${after.digest}; `
        + `observedPaths=${observedPaths.join(', ') || 'none'}`
      );
      result = 1;
    }
  } catch (error) {
    report(
      `${commandId} repository mutation readback failed: `
      + `${error instanceof Error ? error.message : String(error)}`
    );
    result = 1;
  }
  if (hasPrimaryFailure) throw primaryFailure;
  return result;
}
