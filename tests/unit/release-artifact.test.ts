import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs, { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  RELEASE_BUN_ENTRYPOINT_SHEBANG,
  releaseBunEntrypointBytes
} from '../../src/adapters/release/release-artifact.ts';
import { materializeExactReleaseGitTree } from '../../src/adapters/release/release-git-tree-source.ts';
import {
  assertReleaseBunRuntimeRequirement,
  buildFrozenReleaseBundle,
  disposeFrozenReleaseSource,
  prepareFrozenReleaseSource,
  type ReleaseBuilderIdentity
} from '../../src/adapters/release/release-source-materialization.ts';
import { PACKAGE_SOURCE_LAUNCHER_SCRIPT } from '../../src/adapters/toolchain/runtime.ts';

const FIXTURE_ENTRYPOINT = Object.freeze({
  artifact: 'dist/index.js',
  command: 'fixture',
  source: 'src/entry/cli/cli.ts'
});

function currentBuilder(overrides: Partial<ReleaseBuilderIdentity> = {}): ReleaseBuilderIdentity {
  return Object.freeze({
    schema: 'sec-release-builder-identity-v1',
    runtime: 'bun',
    version: Bun.version,
    executableSha256: `sha256:${'a'.repeat(64)}`,
    platform: process.platform,
    architecture: process.arch,
    ...overrides
  });
}

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
  await fs.writeFile(path.join(repositoryRoot, '.bun-version'), `${Bun.version}\n`);
  const sourcePath = path.join(
    repositoryRoot,
    ...FIXTURE_ENTRYPOINT.source.split('/')
  );
  await fs.mkdir(path.dirname(sourcePath), { recursive: true });
  await fs.writeFile(
    sourcePath,
    'console.log("fixture");\n'
  );
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
    source: `./${FIXTURE_ENTRYPOINT.source}`,
    packageManager: `bun@${Bun.version}`,
    bin: {
      [FIXTURE_ENTRYPOINT.command]:
        `./${FIXTURE_ENTRYPOINT.artifact}`
    },
    scripts: {
      [FIXTURE_ENTRYPOINT.command]: PACKAGE_SOURCE_LAUNCHER_SCRIPT
    },
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

    const frozen = await prepareFrozenReleaseSource(repositoryRoot);
    try {
      expect(frozen.sourceCommit).toBe(expectedCommit);
      expect(frozen.sourceTree).toBe(expectedTree);
      await expect(fs.readFile(path.join(frozen.root, 'tracked.txt'), 'utf8'))
        .resolves.toBe('committed\n');
      await expect(fs.lstat(path.join(frozen.root, 'local-note.txt')))
        .rejects.toMatchObject({ code: 'ENOENT' });
      expect(frozen.dependencyLockDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    } finally {
      await disposeFrozenReleaseSource(frozen);
    }
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test('release runtime requirement rejects absent and mismatched Bun without a Node fallback', () => {
  const requirement = currentBuilder();
  for (const observedVersion of [null, '0.0.0']) {
    try {
      assertReleaseBunRuntimeRequirement(requirement, observedVersion);
      throw new Error('expected an unsupported Bun runtime failure');
    } catch (error) {
      expect(error).toMatchObject({
        name: 'SecError',
        code: 'RUNTIME-LAYOUT-001',
        details: {
          disposition: 'unsupported',
          runtime: 'bun',
          requiredVersion: Bun.version,
          observedVersion
        }
      });
    }
  }
  expect(() => assertReleaseBunRuntimeRequirement(requirement, Bun.version)).not.toThrow();
});

test('release builder identity mismatch blocks before an artifact process can publish', async () => {
  const sourceRoot = await mkdtemp(path.join(tmpdir(), 'sec-release-builder-unavailable-'));
  const artifactRoot = path.join(sourceRoot, 'artifact-must-not-exist');
  try {
    await expect(buildFrozenReleaseBundle(Object.freeze({
      schema: 'sec-frozen-release-source-v1' as const,
      root: sourceRoot,
      sourceCommit: 'a'.repeat(40),
      sourceTree: 'b'.repeat(40),
      packageVersion: '1.0.0',
      entrypoint: FIXTURE_ENTRYPOINT,
      dependencies: Object.freeze([]),
      dependencyLockDigest: `sha256:${'c'.repeat(64)}` as const,
      builder: currentBuilder({ executableSha256: `sha256:${'d'.repeat(64)}` }),
      stageRoot: sourceRoot
    }), artifactRoot)).rejects.toThrow('Release Bun builder identity changed before bundle execution');
    await expect(fs.lstat(artifactRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
  }
});

test('release entrypoint normalization permits only the Bun interpreter directive', () => {
  const source = Buffer.from('console.log("fixture");\n', 'utf8');
  const normalized = releaseBunEntrypointBytes(source);
  expect(normalized.toString('utf8')).toBe(`${RELEASE_BUN_ENTRYPOINT_SHEBANG}${source}`);
  expect(releaseBunEntrypointBytes(normalized)).toEqual(normalized);
  expect(() => releaseBunEntrypointBytes(
    Buffer.from('#!/usr/bin/env node\nconsole.log("fixture");\n', 'utf8')
  )).toThrow('non-Bun interpreter directive');
});

test('Bun-target release bundle launches under the retained Bun generation', async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-release-bun-bin-'));
  const artifactRoot = await mkdtemp(path.join(tmpdir(), 'sec-release-bun-artifact-'));
  try {
    await initMinimalBunRepository(repositoryRoot);
    const frozen = await prepareFrozenReleaseSource(repositoryRoot);
    try {
      await buildFrozenReleaseBundle(frozen, artifactRoot);
      const entrypoint = path.join(artifactRoot, 'index.js');
      const entrypointBytes = releaseBunEntrypointBytes(await fs.readFile(entrypoint));
      await fs.writeFile(entrypoint, entrypointBytes);
      await fs.chmod(entrypoint, 0o755);

      expect(entrypointBytes.toString('utf8').startsWith(RELEASE_BUN_ENTRYPOINT_SHEBANG))
        .toBe(true);
      const launched = Bun.spawnSync({
        cmd: [process.execPath, entrypoint],
        cwd: artifactRoot,
        stderr: 'pipe',
        stdout: 'pipe'
      });
      expect(launched.exitCode).toBe(0);
      expect(launched.stdout.toString('utf8')).toBe('fixture\n');
      expect(launched.stderr.toString('utf8')).toBe('');
    } finally {
      await disposeFrozenReleaseSource(frozen);
    }
  } finally {
    await Promise.all([
      rm(repositoryRoot, { recursive: true, force: true }),
      rm(artifactRoot, { recursive: true, force: true })
    ]);
  }
}, 20_000);

test('tracked worktree or index drift is rejected against the captured source commit', async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-release-tracked-drift-'));
  try {
    await initMinimalBunRepository(repositoryRoot);
    await fs.writeFile(path.join(repositoryRoot, 'tracked.txt'), 'dirty-tracked-builder-surface\n');

    await expect(prepareFrozenReleaseSource(repositoryRoot))
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

    const materialized = await materializeExactReleaseGitTree(repositoryRoot);
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

    const materialized = await materializeExactReleaseGitTree(repositoryRoot);
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

    await expect(materializeExactReleaseGitTree(repositoryRoot))
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

    await expect(materializeExactReleaseGitTree(repositoryRoot))
      .rejects.toThrow('Frozen release source contains a Git LFS pointer: asset.bin');
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test('exact Git source preserves binary blobs behind NUL-delimited path records', async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-release-binary-'));
  const binaryPath = process.platform === 'win32'
    ? 'binary payload.bin'
    : 'binary\tpayload.bin';
  const expected = Buffer.from([0x00, 0xff, 0x80, 0x0a, 0x09, 0x7f]);
  try {
    await initRepository(repositoryRoot);
    await fs.writeFile(path.join(repositoryRoot, binaryPath), expected);
    git(repositoryRoot, ['add', '--all']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'binary-nul-record']);

    const materialized = await materializeExactReleaseGitTree(repositoryRoot);
    try {
      await expect(fs.readFile(path.join(materialized.root, binaryPath)))
        .resolves.toEqual(expected);
    } finally {
      await rm(materialized.stageRoot, { recursive: true, force: true });
    }
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test('release Git admission rejects expired operations and unavailable providers before materialization', async () => {
  await expect(materializeExactReleaseGitTree(process.cwd(), {
    deadlineAtUnixMs: Date.now() - 1
  })).rejects.toThrow('requires one future absolute deadline');

  const unavailableRoot = path.join(tmpdir(), `sec-release-provider-absent-${crypto.randomUUID()}`);
  await expect(materializeExactReleaseGitTree(unavailableRoot)).rejects.toMatchObject({
    name: 'GitReadAuthorityError',
    message: 'Git read provider is unavailable.',
    failure: {
      kind: 'unresolved-git-read-provider',
      status: 'unavailable'
    }
  });
  await expect(fs.lstat(unavailableRoot)).rejects.toMatchObject({ code: 'ENOENT' });
});
