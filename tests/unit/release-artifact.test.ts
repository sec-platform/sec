import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { materializeExactReleaseGitTreeV1 } from '../../platform/release/release-git-tree-source.ts';
import {
  disposeFrozenReleaseSourceV1,
  prepareFrozenReleaseSourceV1
} from '../../platform/release/release-source-materialization.ts';
import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

function command(repositoryRoot: string, executable: string, args: readonly string[]): string {
  const result = spawnSync(executable, [...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `${executable} ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

function git(repositoryRoot: string, args: readonly string[]): string {
  return command(repositoryRoot, 'git', args);
}

async function initRepository(repositoryRoot: string): Promise<void> {
  git(repositoryRoot, ['init', '--quiet']);
  git(repositoryRoot, ['config', 'user.email', 'tests@example.com']);
  git(repositoryRoot, ['config', 'user.name', 'SEC Tests']);
}

async function initMinimalBunRepository(repositoryRoot: string): Promise<void> {
  await initRepository(repositoryRoot);
  await fs.writeFile(path.join(repositoryRoot, '.gitignore'), 'node_modules/\n');
  await fs.mkdir(path.join(repositoryRoot, 'vendor', 'fixture-dependency'), { recursive: true });
  await fs.writeFile(path.join(repositoryRoot, 'vendor', 'fixture-dependency', 'package.json'), `${JSON.stringify({
    name: 'fixture-dependency',
    version: '1.0.0',
    main: 'index.js'
  }, null, 2)}\n`);
  await fs.writeFile(
    path.join(repositoryRoot, 'vendor', 'fixture-dependency', 'index.js'),
    'export const fixture = true;\n'
  );
  await fs.writeFile(path.join(repositoryRoot, 'package.json'), `${JSON.stringify({
    name: 'sec-release-fixture',
    version: '1.0.0',
    private: true,
    type: 'module',
    packageManager: `bun@${Bun.version}`,
    dependencies: {
      'fixture-dependency': 'file:./vendor/fixture-dependency'
    }
  }, null, 2)}\n`);
  command(repositoryRoot, process.execPath, ['install', '--ignore-scripts']);
  await fs.writeFile(path.join(repositoryRoot, 'tracked.txt'), 'committed\n');
  git(repositoryRoot, ['add', '--all']);
  git(repositoryRoot, ['commit', '--quiet', '-m', 'initial']);
}

test('frozen release source ignores untracked noise and binds one exact commit/tree', async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-release-source-'));
  try {
    await initMinimalBunRepository(repositoryRoot);
    const expectedCommit = git(repositoryRoot, ['rev-parse', 'HEAD']);
    const expectedTree = git(repositoryRoot, ['rev-parse', `${expectedCommit}^{tree}`]);
    await fs.writeFile(path.join(repositoryRoot, 'local-note.txt'), 'untracked-noise\n');

    const frozen = await prepareFrozenReleaseSourceV1(repositoryRoot);
    try {
      expect(frozen.sourceCommit).toBe(expectedCommit);
      expect(frozen.sourceTree).toBe(expectedTree);
      await expect(fs.readFile(path.join(frozen.root, 'tracked.txt'), 'utf8'))
        .resolves.toBe('committed\n');
      await expect(fs.lstat(path.join(frozen.root, 'local-note.txt')))
        .rejects.toMatchObject({ code: 'ENOENT' });
      expect(frozen.dependencyLockDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    } finally {
      await disposeFrozenReleaseSourceV1(frozen);
    }
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test('tracked worktree or index drift is rejected against the captured source commit', async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-release-tracked-drift-'));
  try {
    await initMinimalBunRepository(repositoryRoot);
    await fs.writeFile(path.join(repositoryRoot, 'tracked.txt'), 'dirty-tracked-builder-surface\n');

    await expect(prepareFrozenReleaseSourceV1(repositoryRoot))
      .rejects.toThrow('Release tracked worktree/index differs from captured source commit');
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test('exact Git source ignores archive export-ignore/export-subst semantics and preserves blob bytes', async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-release-archive-attributes-'));
  try {
    await initRepository(repositoryRoot);
    await fs.writeFile(
      path.join(repositoryRoot, '.gitattributes'),
      'tracked.txt export-ignore export-subst\n'
    );
    await fs.writeFile(path.join(repositoryRoot, 'tracked.txt'), 'literal $Format:%H$ bytes\n');
    git(repositoryRoot, ['add', '--all']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'archive-attributes']);

    const materialized = await materializeExactReleaseGitTreeV1(repositoryRoot);
    try {
      await expect(fs.readFile(path.join(materialized.root, 'tracked.txt'), 'utf8'))
        .resolves.toBe('literal $Format:%H$ bytes\n');
    } finally {
      await rm(materialized.stageRoot, { recursive: true, force: true });
    }
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test('exact Git source disables replacement-object views', async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-release-replace-object-'));
  try {
    await initRepository(repositoryRoot);
    await fs.writeFile(path.join(repositoryRoot, 'tracked.txt'), 'original-committed-bytes\n');
    git(repositoryRoot, ['add', '--all']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'original']);
    const originalBlob = git(repositoryRoot, ['rev-parse', 'HEAD:tracked.txt']);
    const replacementPath = path.join(repositoryRoot, 'replacement.tmp');
    await fs.writeFile(replacementPath, 'replacement-view-bytes\n');
    const replacementBlob = git(repositoryRoot, ['hash-object', '-w', 'replacement.tmp']);
    await fs.rm(replacementPath);
    git(repositoryRoot, ['replace', originalBlob, replacementBlob]);
    expect(git(repositoryRoot, ['cat-file', 'blob', originalBlob])).toContain('replacement-view-bytes');

    const materialized = await materializeExactReleaseGitTreeV1(repositoryRoot);
    try {
      await expect(fs.readFile(path.join(materialized.root, 'tracked.txt'), 'utf8'))
        .resolves.toBe('original-committed-bytes\n');
    } finally {
      await rm(materialized.stageRoot, { recursive: true, force: true });
    }
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test('release source rejects a Git symlink mode before materialization', async () => {
  if (process.platform === 'win32') return;
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-release-symlink-tree-'));
  try {
    await initRepository(repositoryRoot);
    await fs.writeFile(path.join(repositoryRoot, 'link-target.txt'), 'target.txt');
    const blob = git(repositoryRoot, ['hash-object', '-w', 'link-target.txt']);
    git(repositoryRoot, ['update-index', '--add', '--cacheinfo', '120000', blob, 'linked-entry']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'symlink-tree']);
    await fs.symlink('target.txt', path.join(repositoryRoot, 'linked-entry'));

    await expect(materializeExactReleaseGitTreeV1(repositoryRoot))
      .rejects.toThrow(/unsupported Git entry linked-entry \(120000 blob\)/u);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test('release source rejects Git LFS pointer bytes instead of packaging pointer text', async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-release-lfs-pointer-'));
  try {
    await initRepository(repositoryRoot);
    await fs.writeFile(path.join(repositoryRoot, 'asset.bin'), [
      'version https://git-lfs.github.com/spec/v1',
      `oid sha256:${'a'.repeat(64)}`,
      'size 123',
      ''
    ].join('\n'));
    git(repositoryRoot, ['add', '--all']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'lfs-pointer']);

    await expect(materializeExactReleaseGitTreeV1(repositoryRoot))
      .rejects.toThrow('Frozen release source contains a Git LFS pointer: asset.bin');
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test('release build entrypoint and artifact owner remain thin over exact source/materialization', async () => {
  const entrypoint = await readCompilerFile('scripts/build-release.ts');
  const artifactOwner = await readCompilerFile('platform/release/release-artifact.ts');
  const sourceOwner = await readCompilerFile('platform/release/release-source-materialization.ts');
  const gitOwner = await readCompilerFile('platform/release/release-git-tree-source.ts');

  expect(entrypoint).toContain('buildReleaseArtifactV1');
  expect(entrypoint).not.toContain('Bun.build');
  expect(entrypoint).not.toContain('rmSync');
  expect(entrypoint).not.toContain('cpSync');
  expect(entrypoint).not.toContain('chmodSync');

  expect(artifactOwner).toContain('prepareFrozenReleaseSourceV1');
  expect(artifactOwner).toContain('buildFrozenReleaseBundleV1');
  expect(artifactOwner).toContain('.sec-release-artifact-stage-');
  expect(artifactOwner).toContain('dependencyLockDigest');
  expect(artifactOwner).toContain('sec-release-artifact-manifest-v1');
  expect(artifactOwner).toContain('release artifact physical file inventory differs from manifest');
  expect(artifactOwner).toContain('previous artifact restoration did not converge');
  expect(artifactOwner).toContain('failed candidate could not be isolated');
  expect(artifactOwner).toContain('inspectNoFollowDirectoryChainV1');
  expect(artifactOwner).toContain('assertSameNoFollowDirectoryIdentityV1');
  expect(artifactOwner).not.toContain('fs.mkdir(destinationParent');
  expect(artifactOwner).not.toContain('git archive');

  expect(sourceOwner).toContain('materializeExactReleaseGitTreeV1');
  expect(sourceOwner).toContain("'--frozen-lockfile'");
  expect(sourceOwner).toContain("'--ignore-scripts'");
  expect(sourceOwner).toContain("'copyfile'");
  expect(sourceOwner).toContain('Frozen dependency materialization changed package.json or bun.lock');
  expect(sourceOwner).toContain('Release bundle consumed a physical input outside frozen source');
  expect(sourceOwner).toContain('fs.realpath(absoluteInput)');
  expect(sourceOwner).not.toContain('git archive');
  expect(sourceOwner).not.toContain("['archive'");

  expect(gitOwner).toContain("['rev-parse', '--verify', 'HEAD^{commit}']");
  expect(gitOwner).toContain("['diff', '--quiet', '--no-ext-diff', '--no-textconv', sourceCommit, '--']");
  expect(gitOwner).toContain("['ls-tree', '-r', '-z', '--full-tree', '-l', sourceCommit]");
  expect(gitOwner).toContain("['cat-file', '--batch']");
  expect(gitOwner).toContain("env.GIT_NO_REPLACE_OBJECTS = '1'");
  expect(gitOwner).toContain("env.GIT_NO_LAZY_FETCH = '1'");
  expect(gitOwner).toContain('RELEASE_GIT_BLOB_BATCH_MAX_BYTES');
  expect(gitOwner).toContain('physicalSourceRoot');
  expect(gitOwner).toContain('Release source tree contains unsupported Git entry');
  expect(gitOwner).toContain('Frozen release source contains a Git LFS pointer');
  expect(gitOwner).not.toContain('git archive');
  expect(gitOwner).not.toContain("['archive'");
  expect(gitOwner).not.toContain("'tar'");
});
