import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

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

test('frozen release source ignores dirty worktree bytes and binds one exact commit/tree', async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-release-source-'));
  try {
    await initMinimalBunRepository(repositoryRoot);
    const expectedCommit = git(repositoryRoot, ['rev-parse', 'HEAD']);
    const expectedTree = git(repositoryRoot, ['rev-parse', `${expectedCommit}^{tree}`]);
    await fs.writeFile(path.join(repositoryRoot, 'tracked.txt'), 'dirty-ambient-worktree\n');

    const frozen = await prepareFrozenReleaseSourceV1(repositoryRoot);
    try {
      expect(frozen.sourceCommit).toBe(expectedCommit);
      expect(frozen.sourceTree).toBe(expectedTree);
      await expect(fs.readFile(path.join(frozen.root, 'tracked.txt'), 'utf8'))
        .resolves.toBe('committed\n');
      expect(frozen.dependencyLockDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    } finally {
      await disposeFrozenReleaseSourceV1(frozen);
    }
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test('release source rejects a Git symlink mode before archive/materialization', async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-release-symlink-tree-'));
  try {
    await initRepository(repositoryRoot);
    await fs.writeFile(path.join(repositoryRoot, 'link-target.txt'), 'target.txt');
    const blob = git(repositoryRoot, ['hash-object', '-w', 'link-target.txt']);
    git(repositoryRoot, ['update-index', '--add', '--cacheinfo', '120000', blob, 'linked-entry']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'symlink-tree']);

    await expect(prepareFrozenReleaseSourceV1(repositoryRoot))
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

    await expect(prepareFrozenReleaseSourceV1(repositoryRoot))
      .rejects.toThrow('Frozen release source contains a Git LFS pointer: asset.bin');
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test('release build entrypoint and artifact owner remain thin over frozen source/materialization', async () => {
  const entrypoint = await readCompilerFile('scripts/build-release.ts');
  const artifactOwner = await readCompilerFile('platform/release/release-artifact.ts');
  const sourceOwner = await readCompilerFile('platform/release/release-source-materialization.ts');

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
  expect(artifactOwner).not.toContain('git archive');
  expect(artifactOwner).not.toContain('install --frozen-lockfile');

  expect(sourceOwner).toContain("['rev-parse', '--verify', 'HEAD^{commit}']");
  expect(sourceOwner).toContain('`${sourceCommit}^{tree}`');
  expect(sourceOwner).toContain("['ls-tree', '-r', '-z', '--full-tree', sourceCommit]");
  expect(sourceOwner).toContain("['archive', '--format=tar', sourceCommit]");
  expect(sourceOwner).not.toContain("['archive', '--format=tar', 'HEAD']");
  expect(sourceOwner).toContain("['install', '--frozen-lockfile', '--ignore-scripts']");
  expect(sourceOwner).toContain('Frozen dependency materialization changed package.json or bun.lock');
  expect(sourceOwner).toContain('Release bundle consumed an input outside frozen source');
  expect(sourceOwner).toContain('Release source tree contains unsupported Git entry');
  expect(sourceOwner).toContain('Frozen release source contains a Git LFS pointer');
});
