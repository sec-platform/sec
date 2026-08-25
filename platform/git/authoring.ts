import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import path from 'node:path';

import { compareCodeUnits, rawSha256, sha256 } from '../shared/canonical-primitives.ts';
import { CodexDevelopmentIsCanonicalRepositoryPathV1 } from '../shared/repository-path-contract.ts';
import {
  readGitTreeRevision,
  readGitWorkingTreeStatus,
  resolveExactHeadCommit
} from './objects.ts';
import { readGitTransportBytes } from './transport.ts';

export type GitMutableAuthoringFileV1 = Readonly<{
  path: string;
  kind: 'ordinary-file' | 'symbolic-link';
  byteSize: number;
  contentDigest: `sha256:${string}`;
}>;

export type GitMutableAuthoringSnapshotV1 = Readonly<{
  schema: 'sec-git-mutable-authoring-snapshot-v1';
  effectAuthority: 'none';
  baseHeadSha: string;
  baseHeadTreeSha: string;
  changedPaths: readonly string[];
  statusDigest: `sha256:${string}`;
  trackedPatchDigest: `sha256:${string}`;
  untrackedFiles: readonly GitMutableAuthoringFileV1[];
  snapshotDigest: `sha256:${string}`;
}>;

const AUTHORING_PATCH_MAX_BYTES = 512 * 1024 * 1024;
const AUTHORING_UNTRACKED_MAX_BYTES = 512 * 1024 * 1024;
const AUTHORING_PATH_MAX_COUNT = 250_000;

function readGitAuthoringTransportV1(repositoryRoot: string): Readonly<{
  status: readonly string[];
  trackedPatch: Buffer;
  trackedPaths: readonly string[];
  untrackedPaths: readonly string[];
}> {
  const status = readGitWorkingTreeStatus(repositoryRoot);
  const trackedPatch = readGitTransportBytes(repositoryRoot, [
    '-c', 'core.quotepath=false', 'diff', '--binary', '--full-index', 'HEAD', '--'
  ], { maxBuffer: AUTHORING_PATCH_MAX_BYTES, label: 'Git mutable authoring patch' });
  const { trackedPaths, untrackedPaths } = parseGitWorkingTreeChangedPathsV1(status);
  if (trackedPaths.length + untrackedPaths.length > AUTHORING_PATH_MAX_COUNT) {
    throw new Error('Git mutable authoring path census exceeds its bounded count');
  }
  for (const repositoryPath of [...trackedPaths, ...untrackedPaths]) {
    if (!CodexDevelopmentIsCanonicalRepositoryPathV1(repositoryPath)) {
      throw new Error(`Git mutable authoring path is not canonical: ${repositoryPath}`);
    }
  }
  return Object.freeze({
    status: Object.freeze([...status]),
    trackedPatch,
    trackedPaths: Object.freeze([...trackedPaths].sort(compareCodeUnits)),
    untrackedPaths: Object.freeze([...untrackedPaths].sort(compareCodeUnits))
  });
}

function parseGitWorkingTreeChangedPathsV1(status: readonly string[]): Readonly<{
  trackedPaths: readonly string[];
  untrackedPaths: readonly string[];
}> {
  const trackedPaths = new Set<string>();
  const untrackedPaths = new Set<string>();
  for (let index = 0; index < status.length; index += 1) {
    const entry = status[index]!;
    if (entry.length < 4 || entry[2] !== ' ') {
      throw new Error('Git mutable authoring status returned a malformed record');
    }
    const code = entry.slice(0, 2);
    const repositoryPath = entry.slice(3);
    if (!CodexDevelopmentIsCanonicalRepositoryPathV1(repositoryPath)) {
      throw new Error(`Git mutable authoring path is not canonical: ${repositoryPath}`);
    }
    const target = code === '??' ? untrackedPaths : trackedPaths;
    target.add(repositoryPath);
    if (code.includes('R') || code.includes('C')) {
      const previousPath = status[index + 1];
      if (previousPath === undefined
          || !CodexDevelopmentIsCanonicalRepositoryPathV1(previousPath)) {
        throw new Error(`Git mutable authoring rename/copy record is malformed: ${repositoryPath}`);
      }
      trackedPaths.add(previousPath);
      index += 1;
    }
  }
  return Object.freeze({
    trackedPaths: Object.freeze([...trackedPaths].sort(compareCodeUnits)),
    untrackedPaths: Object.freeze([...untrackedPaths].sort(compareCodeUnits))
  });
}

/** One-process mutable path probe for an Effect-admission producer closure. */
export function readGitWorkingTreeChangedPathsV1(repositoryRoot: string): readonly string[] {
  const { trackedPaths, untrackedPaths } = parseGitWorkingTreeChangedPathsV1(
    readGitWorkingTreeStatus(repositoryRoot)
  );
  return Object.freeze([...new Set([...trackedPaths, ...untrackedPaths])].sort(compareCodeUnits));
}

function readUntrackedAuthoringFilesV1(
  repositoryRoot: string,
  repositoryPaths: readonly string[]
): readonly GitMutableAuthoringFileV1[] {
  let totalBytes = 0;
  return Object.freeze(repositoryPaths.map((repositoryPath) => {
    const absolutePath = path.resolve(repositoryRoot, ...repositoryPath.split('/'));
    const relative = path.relative(repositoryRoot, absolutePath);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Git mutable authoring path escapes the repository: ${repositoryPath}`);
    }
    const before = lstatSync(absolutePath, { bigint: true });
    const kind = before.isFile()
      ? 'ordinary-file' as const
      : before.isSymbolicLink()
        ? 'symbolic-link' as const
        : (() => { throw new Error(`Git mutable authoring path is not an ordinary file or link: ${repositoryPath}`); })();
    const bytes = kind === 'ordinary-file'
      ? readFileSync(absolutePath)
      : Buffer.from(readlinkSync(absolutePath), 'utf8');
    const after = lstatSync(absolutePath, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.mode !== after.mode
        || before.size !== after.size || before.mtimeNs !== after.mtimeNs) {
      throw new Error(`Git mutable authoring file changed during observation: ${repositoryPath}`);
    }
    totalBytes += bytes.byteLength;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > AUTHORING_UNTRACKED_MAX_BYTES) {
      throw new Error('Git mutable authoring untracked bytes exceed their bounded total');
    }
    return Object.freeze({
      path: repositoryPath,
      kind,
      byteSize: bytes.byteLength,
      contentDigest: rawSha256(bytes)
    });
  }));
}

/**
 * Content-address the mutable authoring surface without writing the index,
 * object database, refs, or worktree. This is an incremental-analysis input,
 * never an Effect, verification, merge, or completion authority.
 */
export function readGitMutableAuthoringSnapshotV1(
  repositoryRoot: string
): GitMutableAuthoringSnapshotV1 {
  const baseHeadSha = resolveExactHeadCommit(repositoryRoot);
  const baseHeadTreeSha = readGitTreeRevision(repositoryRoot);
  if (baseHeadTreeSha === null) throw new Error('Git mutable authoring snapshot has no base HEAD tree');
  const before = readGitAuthoringTransportV1(repositoryRoot);
  const untrackedFiles = readUntrackedAuthoringFilesV1(repositoryRoot, before.untrackedPaths);
  const after = readGitAuthoringTransportV1(repositoryRoot);
  if (resolveExactHeadCommit(repositoryRoot) !== baseHeadSha
      || readGitTreeRevision(repositoryRoot) !== baseHeadTreeSha
      || !Buffer.from(before.trackedPatch).equals(after.trackedPatch)
      || sha256(before.status) !== sha256(after.status)
      || sha256(before.trackedPaths) !== sha256(after.trackedPaths)
      || sha256(before.untrackedPaths) !== sha256(after.untrackedPaths)) {
    throw new Error('Git mutable authoring surface changed during observation');
  }
  const untrackedReadback = readUntrackedAuthoringFilesV1(repositoryRoot, after.untrackedPaths);
  if (sha256(untrackedFiles) !== sha256(untrackedReadback)) {
    throw new Error('Git mutable authoring untracked bytes changed during observation');
  }
  const material = Object.freeze({
    schema: 'sec-git-mutable-authoring-snapshot-v1' as const,
    effectAuthority: 'none' as const,
    baseHeadSha,
    baseHeadTreeSha,
    changedPaths: Object.freeze([...new Set([
      ...before.trackedPaths,
      ...before.untrackedPaths
    ])].sort(compareCodeUnits)),
    statusDigest: sha256(before.status) as `sha256:${string}`,
    trackedPatchDigest: rawSha256(before.trackedPatch),
    untrackedFiles
  });
  return Object.freeze({
    ...material,
    snapshotDigest: sha256(material) as `sha256:${string}`
  });
}
