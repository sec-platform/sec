import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'bun:test';

import { rawSha256 } from '../../../contracts/canonical.ts';
import { withAuthorityGitReadSession } from '../../providers/git-read/authority.ts';
import { GIT_READ_EXACT_TREE_OPERATION_BUDGET } from '../../providers/git-read/runtime/session.ts';
import { inspectNoFollowDirectoryChain } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { GIT_READ_OPERATION_BUDGET } from '../../self-hosting/development/tooling/git/git-read.ts';
import { retainCompilerDependencyExecutionGeneration } from '../../toolchain/dependencies/runtime.ts';
import {
  issueCompilerDependencyFixtureOperation,
  retireCompilerDependencyFixtureOperation,
  settleCompilerDependencyFixtureOperation
} from '../../toolchain/dependencies/test/runtime.ts';
import { materializeTypeScriptExecutionGeneration } from '../../toolchain/typescript/execution-generation.ts';
import {
  acquireExactGitTreeSnapshot,
  acquireStagedIndexSnapshot,
  acquireWorkingTreeSnapshot,
  assertTypeScriptProjectGenerationEvidence,
  compileVirtualSnapshot,
  compileTypeScriptProjectFactIdentity,
  compileTypeScriptProjectInput,
  issueTypeScriptProjectGenerationEvidence,
  projectTypeScriptProjectFactIdentity,
  readBackStagedIndexSnapshot
} from './workspace-source-snapshot.ts';

const temporaryRepositories: string[] = [];

function git(repositoryRoot: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

async function createRepository(): Promise<Readonly<{ commitSha: string; repositoryRoot: string }>> {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-workspace-source-generation-'));
  temporaryRepositories.push(repositoryRoot);
  git(repositoryRoot, ['init', '--quiet']);
  git(repositoryRoot, ['config', 'user.email', 'tests@example.com']);
  git(repositoryRoot, ['config', 'user.name', 'SEC Tests']);
  git(repositoryRoot, ['config', 'core.autocrlf', 'false']);
  await mkdir(path.join(repositoryRoot, 'src', 'example'), { recursive: true });
  await writeFile(
    path.join(repositoryRoot, 'src', 'example', 'module.json'),
    `${JSON.stringify({
      importGraph: 'runtime',
      externalEntrypoints: [],
      capabilityProviders: [],
      preDependencyBootstrap: false
    }, null, 2)}\n`
  );
  await writeFile(
    path.join(repositoryRoot, 'src', 'example', 'value.ts'),
    'export const value = 1;\n'
  );
  await writeFile(
    path.join(repositoryRoot, 'src', 'example', 'removed.ts'),
    'export const removed = true;\n'
  );
  await writeFile(
    path.join(repositoryRoot, 'src', 'example', 'excluded.ts'),
    'export const excluded = true;\n'
  );
  await writeFile(
    path.join(repositoryRoot, 'src', 'example', 'non-checker.yaml'),
    'kind: source-program-resource\n'
  );
  await writeFile(
    path.join(repositoryRoot, 'tsconfig.json'),
    `${JSON.stringify({
      compilerOptions: { strict: true },
      include: ['src/**/*.ts'],
      exclude: ['src/example/excluded.ts']
    }, null, 2)}\n`
  );
  git(repositoryRoot, ['add', '--all']);
  git(repositoryRoot, ['update-index', '--chmod=+x', 'src/example/value.ts']);
  git(repositoryRoot, ['commit', '--quiet', '-m', 'source generation fixture']);
  return Object.freeze({
    commitSha: git(repositoryRoot, ['rev-parse', 'HEAD']),
    repositoryRoot
  });
}

async function exactSnapshot(repositoryRoot: string, commitSha: string) {
  return withAuthorityGitReadSession({
    cwd: repositoryRoot,
    budget: GIT_READ_EXACT_TREE_OPERATION_BUDGET
  }, (session) => acquireExactGitTreeSnapshot({ session, commitSha }));
}

async function workingSnapshot(repositoryRoot: string) {
  return withAuthorityGitReadSession({
    cwd: repositoryRoot,
    budget: Object.freeze({ ...GIT_READ_OPERATION_BUDGET, maxProcesses: 4 })
  }, (session) => acquireWorkingTreeSnapshot({ session }));
}

function virtualProjectSnapshot(sources: Readonly<Record<string, string>>) {
  return compileVirtualSnapshot({
    subject: Object.freeze({
      kind: 'virtual-mutation' as const,
      provenance: Object.freeze({
        kind: 'source-program-virtual-mutation' as const,
        baseSnapshotDigest: rawSha256('project-input-test-base'),
        mutationDigest: rawSha256(JSON.stringify(sources))
      })
    }),
    files: Object.entries(sources).map(([sourcePath, source]) => Object.freeze({
      path: sourcePath,
      source,
      contentDigest: rawSha256(source)
    })),
    moduleMembership: Object.freeze({
      descriptors: Object.freeze([]),
      graphRoots: Object.freeze([]),
      moduleRoots: Object.freeze([]),
      moduleForPath: () => null
    })
  });
}

afterEach(async () => {
  while (temporaryRepositories.length > 0) {
    await rm(temporaryRepositories.pop()!, { recursive: true, force: true });
  }
});

test('working tree and exact Git tree issue one transport-neutral source generation', async () => {
  const { commitSha, repositoryRoot } = await createRepository();
  const exact = await exactSnapshot(repositoryRoot, commitSha);
  const working = await workingSnapshot(repositoryRoot);

  expect(working.sourceRevision).toBe(exact.sourceRevision);
  expect(working.files.map(({ path: repositoryPath, mode, contentDigest }) => ({
    path: repositoryPath,
    mode,
    contentDigest
  }))).toEqual(exact.files.map(({ path: repositoryPath, mode, contentDigest }) => ({
    path: repositoryPath,
    mode,
    contentDigest
  })));
  expect(exact.file('src/example/value.ts')?.mode).toBe('100755');
  expect(working.file('src/example/value.ts')?.mode).toBe('100755');
  expect(working.subjectDigest).not.toBe(exact.subjectDigest);
  expect(working.physicalObservationReceipt?.kind).toBe('working-tree-observation');
  expect(exact.physicalObservationReceipt).toMatchObject({ kind: 'git-tree', commitSha });
});

test('staged index snapshot binds exact index bytes and blocks later index drift', async () => {
  const { repositoryRoot } = await createRepository();
  await withAuthorityGitReadSession({
    cwd: repositoryRoot,
    budget: GIT_READ_OPERATION_BUDGET
  }, async (session) => {
    const snapshot = await acquireStagedIndexSnapshot({ session });
    expect(snapshot.physicalObservationReceipt?.kind).toBe('staged-index-observation');
    await writeFile(
      path.join(repositoryRoot, 'src', 'example', 'value.ts'),
      'export const value = 2;\n'
    );
    git(repositoryRoot, ['add', 'src/example/value.ts']);
    await expect(readBackStagedIndexSnapshot(snapshot, session))
      .rejects.toThrow('index changed before readback');
  });
});

test('Project fact identity is stable across observation sessions and consumes opaque generation identity', async () => {
  const { repositoryRoot } = await createRepository();
  const first = await workingSnapshot(repositoryRoot);
  const second = await workingSnapshot(repositoryRoot);
  const generationDigest = `sha256:${'a'.repeat(64)}` as const;
  expect(compileTypeScriptProjectFactIdentity(first, 'tsconfig.json', {
    dependencyGenerationDigest: generationDigest
  })).toEqual(compileTypeScriptProjectFactIdentity(second, 'tsconfig.json', {
    dependencyGenerationDigest: generationDigest
  }));
});

test('Project fact identity resolves repository imports with the canonical TypeScript resolver', () => {
  const snapshot = virtualProjectSnapshot({
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        allowImportingTsExtensions: true,
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        noEmit: true
      },
      files: ['src/entry.ts']
    }),
    'package.json': '{"type":"module"}\n',
    'src/entry.ts': [
      "import profile from './profile.json' with { type: 'json' };",
      "import legacy = require('./legacy.cjs');",
      "import workerPath from './worker.mjs' with { type: 'file' };",
      "export { hidden } from './hidden.js';",
      "void import('./dynamic.mjs', { with: { type: 'file' } });",
      "type Imported = import('./types.js').Imported;",
      'export const profileName: Imported = `${profile.name}:${workerPath}:${legacy}`;'
    ].join('\n'),
    'src/dynamic.d.mts': 'declare const dynamic: string; export default dynamic;\n',
    'src/hidden.ts': 'export const hidden = true;\n',
    'src/legacy.d.cts': 'declare const legacy: string; export = legacy;\n',
    'src/profile.json': '{"name":"source-program"}\n',
    'src/types.ts': 'export type Imported = string;\n',
    'src/worker.d.mts': 'declare const workerPath: string; export default workerPath;\n',
    'src/worker.mjs': 'export default "worker";\n'
  });
  expect(compileTypeScriptProjectFactIdentity(snapshot, 'tsconfig.json', {
    dependencyGenerationDigest: null
  })).toEqual(projectTypeScriptProjectFactIdentity(
    compileTypeScriptProjectInput(snapshot, 'tsconfig.json')
  ));
});

test('working generation includes dirty and untracked source while excluding deleted membership', async () => {
  const { commitSha, repositoryRoot } = await createRepository();
  const exact = await exactSnapshot(repositoryRoot, commitSha);
  await writeFile(
    path.join(repositoryRoot, 'src', 'example', 'value.ts'),
    'export const value = 2;\n'
  );
  await unlink(path.join(repositoryRoot, 'src', 'example', 'removed.ts'));
  await writeFile(
    path.join(repositoryRoot, 'src', 'example', 'untracked.ts'),
    'export const untracked = true;\n'
  );

  const working = await workingSnapshot(repositoryRoot);
  expect(working.sourceRevision).not.toBe(exact.sourceRevision);
  expect(working.file('src/example/value.ts')?.source).toContain('value = 2');
  expect(working.file('src/example/untracked.ts')).not.toBeNull();
  expect(working.file('src/example/removed.ts')).toBeNull();

  await rename(
    path.join(repositoryRoot, 'src', 'example', 'untracked.ts'),
    path.join(repositoryRoot, 'src', 'example', 'renamed.ts')
  );
  const renamed = await workingSnapshot(repositoryRoot);
  expect(renamed.file('src/example/untracked.ts')).toBeNull();
  expect(renamed.file('src/example/renamed.ts')?.source).toContain('untracked = true');
});

test('working generation observes same-mtime byte changes and index optimization flags fail closed', async () => {
  const { repositoryRoot } = await createRepository();
  const valuePath = path.join(repositoryRoot, 'src', 'example', 'value.ts');
  const before = await lstat(valuePath);
  await writeFile(valuePath, 'export const value = 9;\n');
  await utimes(valuePath, before.atime, before.mtime);
  const changed = await workingSnapshot(repositoryRoot);
  expect(changed.file('src/example/value.ts')?.source).toContain('value = 9');

  git(repositoryRoot, ['checkout', '--', 'src/example/value.ts']);
  git(repositoryRoot, ['update-index', '--assume-unchanged', 'src/example/value.ts']);
  await writeFile(valuePath, 'export const value = 7;\n');
  const assumeUnchanged = await workingSnapshot(repositoryRoot);
  expect(assumeUnchanged.file('src/example/value.ts')?.source).toContain('value = 7');
  git(repositoryRoot, ['update-index', '--no-assume-unchanged', 'src/example/value.ts']);

  git(repositoryRoot, ['checkout', '--', 'src/example/value.ts']);
  git(repositoryRoot, ['update-index', '--skip-worktree', 'src/example/value.ts']);
  await writeFile(valuePath, 'export const value = 5;\n');
  const skipWorktree = await workingSnapshot(repositoryRoot);
  expect(skipWorktree.file('src/example/value.ts')?.source).toContain('value = 5');
  git(repositoryRoot, ['update-index', '--no-skip-worktree', 'src/example/value.ts']);
});

test('working-tree project generation evidence is owner-issued and opaque', async () => {
  const { repositoryRoot } = await createRepository();
  await withAuthorityGitReadSession({
    cwd: repositoryRoot,
    budget: Object.freeze({ ...GIT_READ_OPERATION_BUDGET, maxProcesses: 8 })
  }, async (session) => {
    const snapshot = await acquireWorkingTreeSnapshot({ session });
    const projectInput = compileTypeScriptProjectInput(snapshot, 'tsconfig.json');
    const evidence = issueTypeScriptProjectGenerationEvidence(
      snapshot,
      projectInput
    );
    const valuePath = path.join(repositoryRoot, 'src', 'example', 'value.ts');
    await writeFile(valuePath, 'export const value = 9;\n');
    await writeFile(valuePath, 'export const value = 1;\n');
    expect(() => assertTypeScriptProjectGenerationEvidence({ ...evidence }))
      .toThrow('was not issued by the Source Program owner');
    expect(evidence.projectInput.projectInputDigest).toMatch(/^sha256:/u);
    expect(evidence.projectInput.sourceFacts.map(({ path: sourcePath }) => sourcePath))
      .not.toContain('src/example/excluded.ts');
    expect(evidence.projectInput.externalSourceFacts.some(({ kind }) => (
      kind === 'default-library'
    ))).toBe(true);
    await writeFile(
      path.join(repositoryRoot, 'src', 'example', 'excluded.ts'),
      'export const excluded = "changed outside Program input";\n'
    );
    const changedSnapshot = await acquireWorkingTreeSnapshot({ session });
    const changedInput = compileTypeScriptProjectInput(changedSnapshot, 'tsconfig.json');
    expect(changedSnapshot.sourceRevision).not.toBe(snapshot.sourceRevision);
    expect(changedInput.projectInputDigest).toBe(projectInput.projectInputDigest);
    expect(changedInput.observationDigest).not.toBe(projectInput.observationDigest);
  });
});

test('ProjectInput preserves TypeScript requested path identity on Windows', () => {
  const snapshot = virtualProjectSnapshot({
    'src/example/removed.ts': 'export const removed = true;\n',
    'src/example/value.ts': "import { removed } from './removed.ts'; export const value = removed;\n",
    'tsconfig.json': `${JSON.stringify({
      compilerOptions: { allowImportingTsExtensions: true, strict: true },
      include: ['src/**/*.ts']
    }, null, 2)}\n`
  });
  const projectInput = compileTypeScriptProjectInput(snapshot, 'tsconfig.json');

  expect(projectInput.sourceFacts.map(({ path: sourcePath }) => sourcePath)).toEqual([
    'src/example/removed.ts',
    'src/example/value.ts',
    'tsconfig.json'
  ]);
});

test('ProjectInput represents a valid config with no matched TypeScript inputs as an empty generation', () => {
  const snapshot = virtualProjectSnapshot({
    'src/example/value.ts': 'export const value = true;\n',
    'tsconfig.json': `${JSON.stringify({
      compilerOptions: { strict: true },
      include: ['src/absent/**/*.ts']
    }, null, 2)}\n`
  });
  const projectInput = compileTypeScriptProjectInput(snapshot, 'tsconfig.json');

  expect(projectInput.sourceFacts.map(({ path: sourcePath }) => sourcePath)).toEqual([
    'tsconfig.json'
  ]);
  expect(projectInput.externalSourceFacts).toEqual([]);

  const invalidSnapshot = virtualProjectSnapshot({
    'tsconfig.json': `${JSON.stringify({
      compilerOptions: { strict: 'not-a-boolean' },
      include: ['src/absent/**/*.ts']
    }, null, 2)}\n`
  });
  expect(() => compileTypeScriptProjectInput(invalidSnapshot, 'tsconfig.json'))
    .toThrow('TypeScript ProjectInput config is invalid');

  const explicitlyInvalidEmptySnapshot = virtualProjectSnapshot({
    'tsconfig.json': `${JSON.stringify({ files: [] }, null, 2)}\n`
  });
  expect(() => compileTypeScriptProjectInput(
    explicitlyInvalidEmptySnapshot,
    'tsconfig.json'
  )).toThrow('TypeScript ProjectInput config is invalid');
});

test('ProjectInput rejects source escape before any materialization authority is requested', async () => {
  const { repositoryRoot } = await createRepository();
  await writeFile(
    path.join(repositoryRoot, 'src', 'example', 'value.ts'),
    "import '/foreign.ts'; export const value = 1;\n"
  );
  await withAuthorityGitReadSession({
    cwd: repositoryRoot,
    budget: Object.freeze({ ...GIT_READ_OPERATION_BUDGET, maxProcesses: 8 })
  }, async (session) => {
    const snapshot = await acquireWorkingTreeSnapshot({ session });
    expect(() => compileTypeScriptProjectInput(snapshot, 'tsconfig.json'))
      .toThrow('absolute or invalid import');
    await writeFile(
      path.join(repositoryRoot, 'src', 'example', 'value.ts'),
      "import '../../../foreign'; export const value = 1;\n"
    );
    const parentEscape = await acquireWorkingTreeSnapshot({ session });
    expect(() => compileTypeScriptProjectInput(parentEscape, 'tsconfig.json'))
      .toThrow('import escapes its snapshot');
  });
});

test('ProjectInput cannot observe host package declarations without one retained dependency generation', async () => {
  const { repositoryRoot } = await createRepository();
  await writeFile(
    path.join(repositoryRoot, 'src', 'example', 'value.ts'),
    "import type { Command } from 'commander'; export const value: Command | null = null;\n"
  );
  await withAuthorityGitReadSession({
    cwd: repositoryRoot,
    budget: Object.freeze({ ...GIT_READ_OPERATION_BUDGET, maxProcesses: 4 })
  }, async (session) => {
    const snapshot = await acquireWorkingTreeSnapshot({ session });
    const projectInput = compileTypeScriptProjectInput(snapshot, 'tsconfig.json');
    expect(projectInput.dependencyGenerationDigest).toBeNull();
    expect(projectInput.externalSourceFacts.some(({ kind }) => kind === 'dependency-generation'))
      .toBe(false);
    expect(projectInput.externalSourceFacts.some(({ path: sourcePath }) => (
      sourcePath.includes('commander')
    ))).toBe(false);
  });
});

test('immutable execution generation isolates workspace mutation and retires its physical tree', async () => {
  const { repositoryRoot } = await createRepository();
  const ownerRoot = await mkdtemp(path.join(tmpdir(), 'sec-source-execution-owner-'));
  temporaryRepositories.push(ownerRoot);
  const generationParentPath = path.join(ownerRoot, 'generations');
  const dependencyRootPath = path.join(ownerRoot, 'dependencies');
  await Promise.all([
    mkdir(generationParentPath),
    mkdir(dependencyRootPath)
  ]);
  const dependencyFixture = await issueCompilerDependencyFixtureOperation({
    dependencies: { commander: '1.0.0' },
    dependencyRootPath,
    devDependencies: { 'ts-morph': '1.0.0', typescript: '1.0.0' },
    lockfileBytes: 'fixture-lock\n',
    packages: [{ main: 'index.d.ts', name: 'commander', version: '1.0.0' }, {
      main: 'dist/ts-morph-common.js',
      name: '@ts-morph/common',
      version: '1.0.0'
    }, {
      main: './script/mod.js',
      name: 'code-block-writer',
      version: '1.0.0'
    }, {
      main: 'dist/ts-morph.js',
      name: 'ts-morph',
      version: '1.0.0'
    }, {
      main: './lib/typescript.js',
      name: 'typescript',
      version: '1.0.0'
    }]
  });
  const dependencyGeneration = await settleCompilerDependencyFixtureOperation(dependencyFixture);
  try {
    await writeFile(
      path.join(repositoryRoot, 'src', 'example', 'value.ts'),
      "import 'commander'; export const value = 1;\n"
    );
    await withAuthorityGitReadSession({
      cwd: repositoryRoot,
      budget: Object.freeze({ ...GIT_READ_OPERATION_BUDGET, maxProcesses: 4 })
    }, async (session) => {
      const snapshot = await acquireWorkingTreeSnapshot({ session });
      const retainedDependencyGeneration = await retainCompilerDependencyExecutionGeneration(
        dependencyGeneration.executionGenerationAuthority,
        { deadlineAtUnixMs: Date.now() + 30_000 }
      );
      const evidence = issueTypeScriptProjectGenerationEvidence(
        snapshot,
        compileTypeScriptProjectInput(snapshot, 'tsconfig.json', {
          dependencyGeneration: retainedDependencyGeneration.physicalGeneration,
          dependencyGenerationDigest: retainedDependencyGeneration.generationDigest
        })
      );
      expect(evidence.projectInput.externalSourceFacts.some(({ kind, path: sourcePath }) => (
        kind === 'dependency-generation' && sourcePath.startsWith('commander/')
      ))).toBe(true);
      const generation = await materializeTypeScriptExecutionGeneration(evidence, {
        deadlineAtUnixMs: Date.now() + 30_000,
        dependencyGeneration: retainedDependencyGeneration,
        dependencyLocatorPath: dependencyGeneration.nodeModulesPath,
        generationParent: inspectNoFollowDirectoryChain(generationParentPath).target
      });
      // childPath names the child descriptor table, not this process's table.
      const generationRoot = generation.workingDirectory.root.path;
      try {
        await writeFile(path.join(repositoryRoot, 'src', 'example', 'value.ts'), 'export const value = 9;\n');
        expect(await readFile(path.join(generationRoot, 'src', 'example', 'value.ts'), 'utf8'))
          .toBe("import 'commander'; export const value = 1;\n");
        expect(await lstat(path.join(generationRoot, 'src', 'example', 'non-checker.yaml'))
          .then(() => true, () => false)).toBe(false);
        await expect(writeFile(
          path.join(generationRoot, 'src', 'example', 'value.ts'),
          'export const value = 7;\n'
        )).rejects.toBeDefined();
        await expect(writeFile(
          path.join(dependencyGeneration.nodeModulesPath, 'typescript', 'lib', 'typescript.js'),
          'module.exports = 2;\n'
        )).rejects.toBeDefined();
        await expect(unlink(path.join(
          dependencyGeneration.nodeModulesPath,
          'typescript',
          'lib',
          'typescript.js'
        )))
          .rejects.toBeDefined();
        await generation.assertCurrent();
      } finally {
        await generation.retire();
      }
      expect(await lstat(generationRoot).then(() => true, () => false)).toBe(false);
      await expect(generation.assertCurrent()).rejects.toThrow('retired');

      const generationParentBeforeForeignLocator = await readdir(generationParentPath);
      const foreignGenerationPath = path.join(ownerRoot, 'foreign-dependency-generation');
      await mkdir(foreignGenerationPath);
      const foreignPreimage = await lstat(foreignGenerationPath, { bigint: true });
      // Keep the predecessor alive so a filesystem cannot immediately reuse its inode.
      await rename(foreignGenerationPath, `${foreignGenerationPath}.predecessor`);
      await mkdir(foreignGenerationPath);
      const foreignReplacement = await lstat(foreignGenerationPath, { bigint: true });
      expect(foreignReplacement.ino).not.toBe(foreignPreimage.ino);
      const replacementDependencyGeneration = await retainCompilerDependencyExecutionGeneration(
        dependencyGeneration.executionGenerationAuthority,
        { deadlineAtUnixMs: Date.now() + 30_000 }
      );
      const replacementEvidence = issueTypeScriptProjectGenerationEvidence(
        snapshot,
        compileTypeScriptProjectInput(snapshot, 'tsconfig.json', {
          dependencyGeneration: replacementDependencyGeneration.physicalGeneration,
          dependencyGenerationDigest: replacementDependencyGeneration.generationDigest
        })
      );
      await expect(materializeTypeScriptExecutionGeneration(replacementEvidence, {
        deadlineAtUnixMs: Date.now() + 30_000,
        dependencyGeneration: replacementDependencyGeneration,
        dependencyLocatorPath: foreignGenerationPath,
        generationParent: inspectNoFollowDirectoryChain(generationParentPath).target
      })).rejects.toThrow('targets a foreign generation');
      expect(await readdir(generationParentPath)).toEqual(generationParentBeforeForeignLocator);
    });
  } finally {
    await retireCompilerDependencyFixtureOperation(dependencyFixture);
  }
}, 30_000);

test('repository audit projects the owner-issued exact source generation', async () => {
  const { auditRepository } = await import('../repository-audit/cli.ts');
  const { commitSha, repositoryRoot } = await createRepository();
  const exact = await exactSnapshot(repositoryRoot, commitSha);
  const report = await auditRepository(repositoryRoot, { defaultRef: commitSha });

  expect(report.sourceProgram.sourceRevision).toBe(exact.sourceRevision);
  expect(report.sourceProgramCompilation.snapshotDigest).toBe(exact.snapshotDigest);
  expect(report.sourceProgramCompilation.moduleGraphDigest).toBe(exact.moduleGraphDigest);
});
