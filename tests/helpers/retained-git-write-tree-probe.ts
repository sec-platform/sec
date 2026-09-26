import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isolatedGitReadEnvironment } from '../../src/adapters/providers/git-read/runtime/session.ts';
import { inspectNoFollowDirectoryChain, inspectNoFollowOrdinaryFileEntry, retainNoFollowDirectoryForChildProcess, retainNoFollowOrdinaryFileForChildProcess } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';

function git(repositoryRoot: string, ...args: string[]) {
  return spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: isolatedGitReadEnvironment()
  });
}

function requireSuccess(result: ReturnType<typeof git>, label: string): string {
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed: ${result.error?.message ?? result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

/** Probe immutable consumption separately from native cache-tree mutation.
 * This fixture is not an authorization or a production docs-doctor receipt. */
export function runRetainedGitWriteTreeProbe(warmIndex = true): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-retained-git-write-tree-'));
  const repositoryRoot = path.join(root, 'repository');
  const snapshotRoot = path.join(root, 'snapshot');
  mkdirSync(repositoryRoot);
  mkdirSync(snapshotRoot);
  try {
    requireSuccess(git(repositoryRoot, 'init'), 'git init');
    writeFileSync(path.join(repositoryRoot, 'tracked.txt'), 'retained Git input\n', 'utf8');
    requireSuccess(git(repositoryRoot, 'add', 'tracked.txt'), 'git add');
    // write-tree may populate a cold index even with GIT_OPTIONAL_LOCKS=0.
    // Warm before retaining when testing read-only consumption; the negative
    // cold-index case must still be rejected by the post-execution fence.
    if (warmIndex) requireSuccess(git(repositoryRoot, 'write-tree'), 'warm Git index');
    const indexCandidate = requireSuccess(
      git(repositoryRoot, 'rev-parse', '--git-path', 'index'),
      'git index path'
    );
    const objectCandidate = requireSuccess(
      git(repositoryRoot, 'rev-parse', '--git-path', 'objects'),
      'git object path'
    );
    const indexPath = path.isAbsolute(indexCandidate)
      ? indexCandidate
      : path.resolve(repositoryRoot, indexCandidate);
    const objectPath = path.isAbsolute(objectCandidate)
      ? objectCandidate
      : path.resolve(repositoryRoot, objectCandidate);
    const indexParent = inspectNoFollowDirectoryChain(path.dirname(indexPath), 'Git index parent');
    const indexEntry = inspectNoFollowOrdinaryFileEntry(indexParent.target, path.basename(indexPath));
    if (indexEntry === null || indexEntry.bytes === null) throw new Error('Git index entry is absent.');
    writeFileSync(path.join(snapshotRoot, 'index'), indexEntry.bytes);
    const snapshotIndexParent = inspectNoFollowDirectoryChain(snapshotRoot, 'snapshot index parent');
    const snapshotIndexEntry = inspectNoFollowOrdinaryFileEntry(snapshotIndexParent.target, 'index');
    if (snapshotIndexEntry === null) throw new Error('Snapshot index entry is absent.');
    const scratchObjectsPath = path.join(snapshotRoot, 'objects');
    mkdirSync(scratchObjectsPath);

    const originalObjects = retainNoFollowDirectoryForChildProcess(
      inspectNoFollowDirectoryChain(objectPath, 'original Git objects'),
      3
    );
    const scratchObjects = retainNoFollowDirectoryForChildProcess(
      inspectNoFollowDirectoryChain(scratchObjectsPath, 'scratch Git objects'),
      4
    );
    const snapshotIndex = retainNoFollowOrdinaryFileForChildProcess(
      snapshotIndexParent,
      snapshotIndexEntry,
      5
    );
    try {
      const result = spawnSync('git', ['write-tree'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: isolatedGitReadEnvironment({
          GIT_INDEX_FILE: snapshotIndex.childPath,
          GIT_OBJECT_DIRECTORY: scratchObjects.childPath,
          GIT_ALTERNATE_OBJECT_DIRECTORIES: originalObjects.childPath
        }),
        stdio: [
          'pipe',
          'pipe',
          'pipe',
          originalObjects.stdioSourceDescriptor ?? 'ignore',
          scratchObjects.stdioSourceDescriptor ?? 'ignore',
          snapshotIndex.stdioSourceDescriptor ?? 'ignore'
        ]
      });
      const treeSha = requireSuccess(result, 'retained git write-tree');
      if (!/^[0-9a-f]{40}$/u.test(treeSha)) throw new Error('Retained git write-tree returned a noncanonical tree.');
      snapshotIndex.assertCurrent();
      scratchObjects.assertCurrent();
      originalObjects.assertCurrent();
      return treeSha;
    } finally {
      snapshotIndex.dispose();
      scratchObjects.dispose();
      originalObjects.dispose();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
