import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isolatedGitReadEnvironment } from '../../platform/git/read-environment.ts';
import {
  inspectNoFollowDirectoryChainV1,
  inspectNoFollowOrdinaryFileEntryV1,
  retainNoFollowDirectoryForChildProcessV1,
  retainNoFollowOrdinaryFileForChildProcessV1
} from '../../platform/shared/physical-no-follow.ts';

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

/** Cross-platform probe for the exact three retained Git inputs used by docs-doctor. */
export function runRetainedGitWriteTreeProbeV1(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-retained-git-write-tree-'));
  const repositoryRoot = path.join(root, 'repository');
  const snapshotRoot = path.join(root, 'snapshot');
  mkdirSync(repositoryRoot);
  mkdirSync(snapshotRoot);
  try {
    requireSuccess(git(repositoryRoot, 'init'), 'git init');
    writeFileSync(path.join(repositoryRoot, 'tracked.txt'), 'retained Git input\n', 'utf8');
    requireSuccess(git(repositoryRoot, 'add', 'tracked.txt'), 'git add');
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
    const indexParent = inspectNoFollowDirectoryChainV1(path.dirname(indexPath), 'Git index parent');
    const indexEntry = inspectNoFollowOrdinaryFileEntryV1(indexParent.target, path.basename(indexPath));
    if (indexEntry === null || indexEntry.bytes === null) throw new Error('Git index entry is absent.');
    writeFileSync(path.join(snapshotRoot, 'index'), indexEntry.bytes);
    const snapshotIndexParent = inspectNoFollowDirectoryChainV1(snapshotRoot, 'snapshot index parent');
    const snapshotIndexEntry = inspectNoFollowOrdinaryFileEntryV1(snapshotIndexParent.target, 'index');
    if (snapshotIndexEntry === null) throw new Error('Snapshot index entry is absent.');
    const scratchObjectsPath = path.join(snapshotRoot, 'objects');
    mkdirSync(scratchObjectsPath);

    const originalObjects = retainNoFollowDirectoryForChildProcessV1(
      inspectNoFollowDirectoryChainV1(objectPath, 'original Git objects'),
      3
    );
    const scratchObjects = retainNoFollowDirectoryForChildProcessV1(
      inspectNoFollowDirectoryChainV1(scratchObjectsPath, 'scratch Git objects'),
      4
    );
    const snapshotIndex = retainNoFollowOrdinaryFileForChildProcessV1(
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
