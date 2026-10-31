import { withTempWorkspace } from '../../testkit/workspace.ts';
import { settleWorkspaceCallback, settleWorkspaceCleanups } from '../../testkit/workspace-cleanup.ts';
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs, { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  disposeExactReleaseGitTree,
  materializeExactReleaseGitTree
} from '../../../src/adapters/release/release-git-tree-source.ts';
import {
  assertReleaseBunRuntimeRequirement,
  buildFrozenReleaseBundle,
  disposeFrozenReleaseSource,
  prepareFrozenReleaseSource,
  type ReleaseBuilderIdentity
} from '../../../src/adapters/release/release-source-materialization.ts';
import { PACKAGE_SOURCE_LAUNCHER_SCRIPT } from '../../../src/adapters/toolchain/runtime.ts';

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
    windowsHide: true,
    // Fixture commit identity is local to this child; avoid two Git config
    // subprocesses per independent repository while retaining native Git commits.
    ...(executable === 'git' ? { env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'SEC Tests',
      GIT_AUTHOR_EMAIL: 'tests@example.com',
      GIT_COMMITTER_NAME: 'SEC Tests',
      GIT_COMMITTER_EMAIL: 'tests@example.com'
    } } : {})
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
}

async function initMinimalBunRepository(repositoryRoot: string, entrypointSource: string): Promise<void> {
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
    entrypointSource
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

test('release runtime requirement rejects absent and mismatched Bun without a Node fallback', () => {
  const requirement = currentBuilder();
  for (const observedVersion of [null, '0.0.0']) {
    try {
      assertReleaseBunRuntimeRequirement(requirement, observedVersion);
      throw new Error('expected an unsupported Bun runtime failure');
    } catch (error) {
      expect(error).toMatchObject({
        name: 'CodedFailure',
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
  await withTempWorkspace(async sourceRoot => {
    const artifactRoot = path.join(sourceRoot, 'artifact-must-not-exist');
    const entrypoint = path.join(sourceRoot, ...FIXTURE_ENTRYPOINT.source.split('/'));
    await fs.mkdir(path.dirname(entrypoint), { recursive: true });
    await fs.writeFile(entrypoint, 'console.log("fixture");\n');
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
  }, 'sec-release-builder-unavailable-');
});


test('Bun-target release bundle rejects a non-Bun source interpreter directive before build', async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-release-bad-shebang-'));
  const artifactRoot = await mkdtemp(path.join(tmpdir(), 'sec-release-bad-shebang-artifact-')).catch(error =>
    settleWorkspaceCallback(async () => { throw error; },
      () => rm(repositoryRoot, { recursive: true, force: true })));
  let sourceUseSettled = true;
  await settleWorkspaceCallback(async () => {
    await initMinimalBunRepository(repositoryRoot, '#!/usr/bin/env node\nconsole.log("fixture");\n');
    sourceUseSettled = false;
    const frozen = await prepareFrozenReleaseSource(repositoryRoot);
    sourceUseSettled = true;
    await settleWorkspaceCallback(async () => {
      sourceUseSettled = false;
      await expect(buildFrozenReleaseBundle(frozen, artifactRoot))
        .rejects.toThrow('non-Bun interpreter directive');
      sourceUseSettled = true;
    }, async () => {
      if (sourceUseSettled) await disposeFrozenReleaseSource(frozen);
    });
  }, async () => {
    // Preserve both roots when builder/installer termination is not proven.
    if (!sourceUseSettled) return;
    await settleWorkspaceCleanups([
      () => rm(repositoryRoot, { recursive: true, force: true }),
      () => rm(artifactRoot, { recursive: true, force: true })
    ]);
  });
});

test('Bun-target release bundle consumes the exact frozen source and rejects later tracked drift', async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-release-bun-bin-'));
  const artifactRoot = await mkdtemp(path.join(tmpdir(), 'sec-release-bun-artifact-')).catch(error =>
    settleWorkspaceCallback(async () => { throw error; },
      () => rm(repositoryRoot, { recursive: true, force: true })));
  let sourceUseSettled = true;
  await settleWorkspaceCallback(async () => {
    await initMinimalBunRepository(repositoryRoot, 'console.log("fixture");\n');
    const identityLines = git(repositoryRoot, ['rev-parse', 'HEAD', 'HEAD^{tree}']).split('\n');
    expect(identityLines).toHaveLength(2);
    const [expectedCommit, expectedTree] = identityLines as [string, string];
    await fs.writeFile(path.join(repositoryRoot, 'local-note.txt'), 'untracked-noise\n');

    sourceUseSettled = false;
    const frozen = await prepareFrozenReleaseSource(repositoryRoot);
    sourceUseSettled = true;
    await settleWorkspaceCallback(async () => {
      expect(frozen.sourceCommit).toBe(expectedCommit);
      expect(frozen.sourceTree).toBe(expectedTree);
      await expect(fs.readFile(path.join(frozen.root, 'tracked.txt'), 'utf8'))
        .resolves.toBe('committed\n');
      await expect(fs.lstat(path.join(frozen.root, 'local-note.txt')))
        .rejects.toMatchObject({ code: 'ENOENT' });
      expect(frozen.dependencyLockDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);

      sourceUseSettled = false;
      await buildFrozenReleaseBundle(frozen, artifactRoot);
      sourceUseSettled = true;
      const entrypoint = path.join(artifactRoot, 'index.js');
      expect(await fs.readFile(path.join(artifactRoot, '.bun-version'), 'utf8'))
        .toBe(`${Bun.version}\n`);
      const entrypointBytes = await fs.readFile(entrypoint);
      expect(entrypointBytes.toString('utf8').startsWith('#!/usr/bin/env bun\n'))
        .toBe(true);
      if (process.platform !== 'win32') {
        expect((await fs.stat(entrypoint)).mode & 0o111).not.toBe(0);
      }
      const launched = Bun.spawnSync({
        cmd: [process.execPath, entrypoint],
        cwd: artifactRoot,
        stderr: 'pipe',
        stdout: 'pipe'
      });
      expect(launched.exitCode).toBe(0);
      expect(launched.stdout.toString('utf8')).toBe('fixture\n');
      expect(launched.stderr.toString('utf8')).toBe('');
    }, async () => {
      if (sourceUseSettled) await disposeFrozenReleaseSource(frozen);
    });

    await fs.writeFile(path.join(repositoryRoot, 'tracked.txt'), 'dirty-tracked-builder-surface\n');
    sourceUseSettled = false;
    await expect(prepareFrozenReleaseSource(repositoryRoot))
      .rejects.toThrow('Release tracked worktree/index differs from captured source commit');
    sourceUseSettled = true;
  }, async () => {
    // Preserve both roots when builder/installer termination is not proven.
    if (!sourceUseSettled) return;
    await settleWorkspaceCleanups([
      () => rm(repositoryRoot, { recursive: true, force: true }),
      () => rm(artifactRoot, { recursive: true, force: true })
    ]);
  });
}, 20_000);

test('exact Git source preserves archive-sensitive and binary bytes without replacement-object views', async () => {
  await withTempWorkspace(async repositoryRoot => {
    const binaryPath = process.platform === 'win32'
      ? 'binary payload.bin'
      : 'binary\tpayload.bin';
    const expectedBinary = Buffer.from([0x00, 0xff, 0x80, 0x0a, 0x09, 0x7f]);
    await initRepository(repositoryRoot);
    await fs.writeFile(
      path.join(repositoryRoot, '.gitattributes'),
      'tracked.txt export-ignore export-subst\n'
    );
    await fs.writeFile(path.join(repositoryRoot, 'tracked.txt'), 'literal $Format:%H$ bytes\n');
    await fs.writeFile(path.join(repositoryRoot, 'replacement-source.txt'), 'original-committed-bytes\n');
    await fs.writeFile(path.join(repositoryRoot, binaryPath), expectedBinary);
    git(repositoryRoot, ['add', '--all']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'exact-source-bytes']);
    const originalBlob = git(repositoryRoot, ['rev-parse', 'HEAD:replacement-source.txt']);
    const replacementPath = path.join(repositoryRoot, 'replacement.tmp');
    await fs.writeFile(replacementPath, 'replacement-view-bytes\n');
    const replacementBlob = git(repositoryRoot, ['hash-object', '-w', 'replacement.tmp']);
    await fs.rm(replacementPath);
    git(repositoryRoot, ['replace', originalBlob, replacementBlob]);
    expect(git(repositoryRoot, ['cat-file', 'blob', originalBlob])).toContain('replacement-view-bytes');

    const materialized = await materializeExactReleaseGitTree(repositoryRoot);
    try {
      await expect(fs.readFile(path.join(materialized.root, 'tracked.txt'), 'utf8'))
        .resolves.toBe('literal $Format:%H$ bytes\n');
      await expect(fs.readFile(path.join(materialized.root, 'replacement-source.txt'), 'utf8'))
        .resolves.toBe('original-committed-bytes\n');
      await expect(fs.readFile(path.join(materialized.root, binaryPath)))
        .resolves.toEqual(expectedBinary);
    } finally {
      await disposeExactReleaseGitTree(materialized);
    }
  }, 'sec-release-exact-bytes-');
});

test.skipIf(process.platform === 'win32')('release source rejects a Git symlink mode before materialization', async () => {
  await withTempWorkspace(async repositoryRoot => {
    await initRepository(repositoryRoot);
    await fs.writeFile(path.join(repositoryRoot, 'link-target.txt'), 'target.txt');
    const blob = git(repositoryRoot, ['hash-object', '-w', 'link-target.txt']);
    git(repositoryRoot, ['update-index', '--add', '--cacheinfo', '120000', blob, 'linked-entry']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'symlink-tree']);
    await fs.symlink('target.txt', path.join(repositoryRoot, 'linked-entry'));

    await expect(materializeExactReleaseGitTree(repositoryRoot))
      .rejects.toThrow(/unsupported Git entry linked-entry \(120000 blob\)/u);
  }, 'sec-release-symlink-tree-');
});

test('release source rejects Git LFS pointer bytes instead of packaging pointer text', async () => {
  await withTempWorkspace(async repositoryRoot => {
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
  }, 'sec-release-lfs-pointer-');
});

test('release Git admission rejects unavailable providers before materialization', async () => {
  const unavailableRoot = path.join(tmpdir(), `sec-release-provider-absent-${crypto.randomUUID()}`);
  await expect(materializeExactReleaseGitTree(unavailableRoot)).rejects.toMatchObject({
    name: 'GitReadAuthorityError',
    failure: {
      kind: 'unresolved-git-read-provider',
      status: 'unavailable'
    }
  });
  await expect(fs.lstat(unavailableRoot)).rejects.toMatchObject({ code: 'ENOENT' });
});
