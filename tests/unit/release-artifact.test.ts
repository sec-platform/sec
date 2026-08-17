import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildReleaseArtifactV1 } from '../../platform/release/release-artifact.ts';
import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

function git(repositoryRoot: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

test('dirty release source is rejected before replacing the previously accepted artifact', async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-release-dirty-'));
  try {
    git(repositoryRoot, ['init', '--quiet']);
    git(repositoryRoot, ['config', 'user.email', 'tests@example.com']);
    git(repositoryRoot, ['config', 'user.name', 'SEC Tests']);
    await fs.writeFile(path.join(repositoryRoot, '.gitignore'), 'dist/\n');
    await fs.writeFile(path.join(repositoryRoot, 'tracked.txt'), 'clean\n');
    git(repositoryRoot, ['add', '--all']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'initial']);

    const distRoot = path.join(repositoryRoot, 'dist');
    await fs.mkdir(distRoot);
    const acceptedMarker = path.join(distRoot, 'accepted.txt');
    await fs.writeFile(acceptedMarker, 'previous-accepted-artifact\n');
    await fs.writeFile(path.join(repositoryRoot, 'tracked.txt'), 'dirty\n');

    await expect(buildReleaseArtifactV1(repositoryRoot, distRoot))
      .rejects.toThrow('requires a clean tracked and untracked repository surface');
    await expect(fs.readFile(acceptedMarker, 'utf8')).resolves.toBe('previous-accepted-artifact\n');
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test('release build entrypoint no longer owns live dist mutation or bundling', async () => {
  const entrypoint = await readCompilerFile('scripts/build-release.ts');
  const owner = await readCompilerFile('platform/release/release-artifact.ts');

  expect(entrypoint).toContain('buildReleaseArtifactV1');
  expect(entrypoint).not.toContain('Bun.build');
  expect(entrypoint).not.toContain('rmSync');
  expect(entrypoint).not.toContain('cpSync');
  expect(entrypoint).not.toContain('chmodSync');

  expect(owner).toContain("['ls-tree', '-r', '-z', '--full-tree', 'HEAD']");
  expect(owner).toContain('Release source tree contains unsupported Git entry');
  expect(owner).toContain('Frozen release source contains a Git LFS pointer');
  expect(owner).toContain("['archive', '--format=tar', 'HEAD']");
  expect(owner).toContain('.sec-release-artifact-stage-');
  expect(owner).toContain('sec-release-source-');
  expect(owner).toContain("['install', '--frozen-lockfile', '--ignore-scripts']");
  expect(owner).toContain('Frozen dependency materialization changed package.json or bun.lock');
  expect(owner).toContain('Release bundle consumed an input outside frozen source');
  expect(owner).toContain('dependencyLockDigest');
  expect(owner).toContain('sec-release-artifact-manifest-v1');
  expect(owner).toContain('release artifact physical file inventory differs from manifest');
  expect(owner).not.toContain('Bun.build({');
});
