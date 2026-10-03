import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { decodeGitIndexGeneration } from '../../src/adapters/providers/git-read/runtime/scratch-index-generation.ts';
import { isolatedGitReadEnvironment } from '../../src/adapters/providers/git-read/runtime/session.ts';
import { inspectNoFollowDirectoryChain, inspectNoFollowOrdinaryFileEntry, retainNoFollowDirectoryForChildProcess, retainNoFollowOrdinaryFile, retainNoFollowOrdinaryFileForChildProcess } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { settleResources, type ResourceSettlementFailure } from '../../src/execution/resource-settlement.ts';

function git(repositoryRoot: string, args: string[], input?: string) {
  return spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: isolatedGitReadEnvironment(),
    timeout: 5000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    input
  });
}

function requireSuccess(result: ReturnType<typeof git>, label: string): string {
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed: ${result.error?.message ?? result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

/** Native Git owns its writable private index beneath a retained parent.
 * An immutable file is only used to test rejection of that incorrect custody.
 * This fixture is not an authorization or a production docs-doctor receipt. */
export function runRetainedGitWriteTreeProbeV1(options: Readonly<{
  warmIndex?: boolean;
  indexCustody?: 'retained-parent' | 'immutable-file';
}> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-retained-git-write-tree-'));
  const repositoryRoot = path.join(root, 'repository');
  const snapshotRoot = path.join(root, 'snapshot');
  const cleanup = [{ label: 'Git probe root', settle: () => rmSync(root, { recursive: true, force: true }) }];
  const own = <T extends { dispose(): void }>(resource: T, label: string): T => {
    cleanup.unshift({ label, settle: () => resource.dispose() });
    return resource;
  };
  let primary: ResourceSettlementFailure | undefined;
  try {
    mkdirSync(repositoryRoot);
    mkdirSync(snapshotRoot);
    requireSuccess(git(repositoryRoot, ['init']), 'git init');
    writeFileSync(path.join(repositoryRoot, 'tracked.txt'), 'retained Git input\n', 'utf8');
    requireSuccess(git(repositoryRoot, ['add', 'tracked.txt']), 'git add');
    const blob = requireSuccess(git(repositoryRoot, ['rev-parse', ':tracked.txt']), 'tracked blob');
    const expectedTree = requireSuccess(
      git(repositoryRoot, ['mktree'], `100644 blob ${blob}\ttracked.txt\n`),
      'independent expected tree'
    );
    if (options.warmIndex !== false) {
      assert.equal(requireSuccess(git(repositoryRoot, ['write-tree']), 'warm Git index'), expectedTree);
    }
    const indexCandidate = requireSuccess(
      git(repositoryRoot, ['rev-parse', '--git-path', 'index']),
      'git index path'
    );
    const objectCandidate = requireSuccess(
      git(repositoryRoot, ['rev-parse', '--git-path', 'objects']),
      'git object path'
    );
    const indexPath = path.isAbsolute(indexCandidate)
      ? indexCandidate
      : path.resolve(repositoryRoot, indexCandidate);
    const objectPath = path.isAbsolute(objectCandidate)
      ? objectCandidate
      : path.resolve(repositoryRoot, objectCandidate);
    const indexParent = inspectNoFollowDirectoryChain(path.dirname(indexPath), 'Git index parent');
    const sourceIndex = own(retainNoFollowOrdinaryFile(indexParent, path.basename(indexPath)), 'original Git index');
    const sourceBytes = sourceIndex.readBytes();
    const expectedIndex = decodeGitIndexGeneration(sourceBytes, 'sha1');
    writeFileSync(path.join(snapshotRoot, 'index'), sourceBytes);
    const snapshotIndexParent = inspectNoFollowDirectoryChain(snapshotRoot, 'snapshot index parent');
    const scratchObjectsPath = path.join(snapshotRoot, 'objects');
    mkdirSync(scratchObjectsPath);

    const originalObjects = own(retainNoFollowDirectoryForChildProcess(
      inspectNoFollowDirectoryChain(objectPath, 'original Git objects'),
      3
    ), 'original Git objects');
    const scratchObjects = own(retainNoFollowDirectoryForChildProcess(
      inspectNoFollowDirectoryChain(scratchObjectsPath, 'scratch Git objects'),
      4
    ), 'scratch Git objects');
    const scratchParent = own(retainNoFollowDirectoryForChildProcess(
      snapshotIndexParent,
      5
    ), 'writable scratch parent');
    const immutableIndex = options.indexCustody === 'immutable-file'
      ? own(retainNoFollowOrdinaryFileForChildProcess(
        snapshotIndexParent,
        inspectNoFollowOrdinaryFileEntry(snapshotIndexParent.target, 'index')!,
        6
      ), 'immutable scratch index') : undefined;
    const result = spawnSync('git', ['write-tree'], {
      cwd: repositoryRoot,
      timeout: 5000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      encoding: 'utf8',
      env: isolatedGitReadEnvironment({
        GIT_INDEX_FILE: immutableIndex?.childPath ?? `${scratchParent.childPath}${path.sep}index`,
        GIT_OBJECT_DIRECTORY: scratchObjects.childPath,
        GIT_ALTERNATE_OBJECT_DIRECTORIES: originalObjects.childPath
      }),
      stdio: [
        'pipe',
        'pipe',
        'pipe',
        originalObjects.stdioSourceDescriptor ?? 'ignore',
        scratchObjects.stdioSourceDescriptor ?? 'ignore',
        scratchParent.stdioSourceDescriptor ?? 'ignore',
        immutableIndex?.stdioSourceDescriptor ?? 'ignore'
      ]
    });
    const treeSha = requireSuccess(result, 'retained git write-tree');
    assert.match(treeSha, /^[0-9a-f]{40}$/u);
    assert.equal(treeSha, expectedTree);
    assert.deepEqual(sourceIndex.readBytes(), sourceBytes, 'native Git must preserve the exact original PRE');
    scratchParent.assertCurrent();
    scratchObjects.assertCurrent();
    originalObjects.assertCurrent();
    assert.equal(inspectNoFollowOrdinaryFileEntry(snapshotIndexParent.target, 'index.lock'), null);
    const nextIndex = own(retainNoFollowOrdinaryFile(snapshotIndexParent, 'index'), 'private index readback');
    const observedIndex = decodeGitIndexGeneration(nextIndex.readBytes(), 'sha1');
    // Native stat/cache refresh is allowed only in the private successor. Every
    // staged entry and protected extension must still describe the exact input.
    const entries = (generation: typeof expectedIndex) => ({
      ...generation,
      entries: generation.entries.map(({ statHex, ...entry }) => entry)
    });
    assert.deepEqual(entries(observedIndex), entries(expectedIndex));
    immutableIndex?.assertCurrent();
    return treeSha;
  } catch (error) {
    primary = { label: 'retained Git write-tree probe', error };
    throw error;
  } finally {
    settleResources({ primary, cleanup });
  }
}
