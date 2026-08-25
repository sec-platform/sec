import { lstat, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';

import { isolatedGitReadEnvironment } from '../git/read-environment.ts';
import { rawSha256, sha256, uniqueSorted } from '../shared/canonical-primitives.ts';
import { compilerRoot } from '../shared/paths.ts';
import { runCommandBytes } from '../shared/process.ts';
import { CodexDevelopmentIsCanonicalRepositoryPathV1 } from '../shared/repository-path-contract.ts';

export interface RepositoryMutationStateV1 {
  readonly schema: 'sec-repository-mutation-state-v1';
  readonly digest: `sha256:${string}`;
  readonly changedPaths: readonly string[];
}

export interface RepositoryMutationFenceOptionsV1 {
  readonly repositoryRoot?: string;
  readonly report?: (message: string) => void;
}

async function gitBytes(repositoryRoot: string, args: string[], label: string): Promise<Uint8Array> {
  const result = await runCommandBytes('git', ['-c', 'core.quotepath=false', ...args], {
    cwd: repositoryRoot,
    env: isolatedGitReadEnvironment(),
    envMode: 'replace',
    maxStderrBytes: 64 * 1024,
    maxStdoutBytes: 128 * 1024 * 1024,
    timeoutMs: 30_000
  });
  if (result.code !== 0) {
    throw new Error(`Repository mutation fence could not ${label}: ${result.stderr.trim()}`);
  }
  return result.stdout;
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
  if (!CodexDevelopmentIsCanonicalRepositoryPathV1(value)) {
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
export async function captureRepositoryMutationStateV1(
  repositoryRoot = compilerRoot
): Promise<RepositoryMutationStateV1> {
  const [head, index, trackedDiff, status, untrackedInventory] = await Promise.all([
    gitBytes(repositoryRoot, ['rev-parse', '--verify', 'HEAD^{commit}'], 'resolve HEAD'),
    gitBytes(repositoryRoot, ['ls-files', '--stage', '-z'], 'snapshot the index'),
    gitBytes(repositoryRoot, [
      'diff', '--binary', '--no-ext-diff', '--full-index', '--no-renames', 'HEAD', '--', '.'
    ], 'snapshot tracked worktree changes'),
    gitBytes(repositoryRoot, [
      'status', '--porcelain=v1', '-z', '--untracked-files=all'
    ], 'snapshot repository status'),
    gitBytes(repositoryRoot, [
      'ls-files', '--others', '--exclude-standard', '-z'
    ], 'inventory untracked files')
  ]);
  const headText = new TextDecoder('utf-8', { fatal: true }).decode(head).trim();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(headText)) {
    throw new Error('Repository mutation fence HEAD is not one exact object id');
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
    changedPaths: Object.freeze(statusPaths(status))
  });
}

/** Runs one complete developer command behind a single before/after fence. */
export async function runRepositoryZeroWriteOperationV1(
  commandId: string,
  operation: () => Promise<number>,
  options: RepositoryMutationFenceOptionsV1 = {}
): Promise<number> {
  const repositoryRoot = options.repositoryRoot ?? compilerRoot;
  const report = options.report ?? console.error;
  const before = await captureRepositoryMutationStateV1(repositoryRoot);
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
    const after = await captureRepositoryMutationStateV1(repositoryRoot);
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
