import { settleWorkspaceCallback } from '../../../../tests/testkit/workspace-cleanup.ts';
import { spawnSync } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, expect, test } from 'bun:test';

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
  acquireExactGitTreeWorkspaceSourceSnapshotFromSession,
  acquireStagedIndexWorkspaceSourceSnapshot,
  acquireStagedWorkspaceSourceSelection,
  acquireWorkingTreeWorkspaceSourceSnapshot,
  assertWorkspaceTypeScriptProjectGenerationEvidence,
  compileWorkspaceTypeScriptProjectInput,
  issueWorkspaceTypeScriptProjectGenerationEvidence,
  readBackStagedIndexWorkspaceSourceSnapshot,
  readBackStagedWorkspaceSourceSelection
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

// The committed Git source program is immutable fixture input. Its actual
// worktree, index and refs are copied into each independent native observation.
type SourceGenerationFixture = Readonly<{ commitSha: string; repositoryRoot: string }>;
let sourceGenerationTemplate: Promise<SourceGenerationFixture> | undefined;

async function buildSourceGenerationTemplate(): Promise<SourceGenerationFixture> {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-workspace-source-template-'));
  try {
  git(repositoryRoot, ['init', '--quiet']);
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
  git(repositoryRoot, ['-c', 'user.name=SEC Tests', '-c', 'user.email=tests@example.com', 'commit', '--quiet', '-m', 'source generation fixture']);
  return Object.freeze({
    commitSha: git(repositoryRoot, ['rev-parse', 'HEAD']),
    repositoryRoot
  });
  } catch (error) {
    try { await rm(repositoryRoot, { recursive: true, force: true }); }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Source snapshot base setup and cleanup both failed');
    }
    throw error;
  }
}


afterAll(async () => {
  if (sourceGenerationTemplate === undefined) return;
  const settled = await Promise.allSettled([sourceGenerationTemplate]);
  if (settled[0]?.status === 'fulfilled') {
    await rm(settled[0].value.repositoryRoot, { recursive: true, force: true });
  }
  sourceGenerationTemplate = undefined;
});

async function createRepository(): Promise<SourceGenerationFixture> {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-workspace-source-generation-'));
  temporaryRepositories.push(repositoryRoot);
  const template = await (sourceGenerationTemplate ??= buildSourceGenerationTemplate());
  await cp(template.repositoryRoot, repositoryRoot, { recursive: true });
  return Object.freeze({ repositoryRoot, commitSha: template.commitSha });
}

async function exactSnapshot(repositoryRoot: string, commitSha: string) {
  return withAuthorityGitReadSession({
    cwd: repositoryRoot,
    budget: GIT_READ_EXACT_TREE_OPERATION_BUDGET
  }, (session) => acquireExactGitTreeWorkspaceSourceSnapshotFromSession({ session, commitSha }));
}

async function workingSnapshot(repositoryRoot: string) {
  return withAuthorityGitReadSession({
    cwd: repositoryRoot,
    budget: Object.freeze({ ...GIT_READ_OPERATION_BUDGET, maxProcesses: 4 })
  }, (session) => acquireWorkingTreeWorkspaceSourceSnapshot({ session }));
}



afterEach(async () => {
  while (temporaryRepositories.length > 0) {
    await rm(temporaryRepositories.pop()!, { recursive: true, force: true });
  }
});

test('staged index snapshot binds exact index bytes and blocks later index drift', async () => {
  const { repositoryRoot } = await createRepository();
  await withAuthorityGitReadSession({
    cwd: repositoryRoot,
    budget: GIT_READ_OPERATION_BUDGET
  }, async (session) => {
    const candidateBase = git(repositoryRoot, ['rev-parse', 'HEAD']);
    const selection = await acquireStagedWorkspaceSourceSelection({ session, candidateBase });
    expect(selection.selectedPaths).toEqual([]);
    await expect(readBackStagedWorkspaceSourceSelection({ ...selection }, session))
      .rejects.toThrow('not owner-issued');
    const snapshot = await acquireStagedIndexWorkspaceSourceSnapshot({ session });
    expect(snapshot.physicalObservationReceipt?.kind).toBe('staged-index-observation');
    await writeFile(
      path.join(repositoryRoot, 'src', 'example', 'value.ts'),
      'export const value = 2;\n'
    );
    git(repositoryRoot, ['add', 'src/example/value.ts']);
    await expect(readBackStagedIndexWorkspaceSourceSnapshot(snapshot, session))
      .rejects.toThrow('index changed before readback');
    await expect(readBackStagedWorkspaceSourceSelection(selection, session))
      .rejects.toThrow('index changed before readback');
  });
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
    const snapshot = await acquireWorkingTreeWorkspaceSourceSnapshot({ session });
    const projectInput = compileWorkspaceTypeScriptProjectInput(snapshot, 'tsconfig.json');
    const evidence = issueWorkspaceTypeScriptProjectGenerationEvidence(
      snapshot,
      projectInput
    );
    expect(() => assertWorkspaceTypeScriptProjectGenerationEvidence({ ...evidence }))
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
    const changedSnapshot = await acquireWorkingTreeWorkspaceSourceSnapshot({ session });
    const changedInput = compileWorkspaceTypeScriptProjectInput(changedSnapshot, 'tsconfig.json');
    expect(changedSnapshot.sourceRevision).not.toBe(snapshot.sourceRevision);
    expect(changedInput.projectInputDigest).toBe(projectInput.projectInputDigest);
    expect(changedInput.observationDigest).not.toBe(projectInput.observationDigest);
  });
});





test('immutable execution generation isolates workspace mutation and retires its physical tree', async () => {
  const { repositoryRoot } = await createRepository();
  const ownerRoot = await mkdtemp(path.join(tmpdir(), 'sec-source-execution-owner-'));
  temporaryRepositories.push(ownerRoot);
  const generationParentPath = path.join(ownerRoot, 'generations');
  const dependencyRootPath = path.join(ownerRoot, 'dependencies');
  const preparedDirectories = await Promise.allSettled([
    mkdir(generationParentPath),
    mkdir(dependencyRootPath)
  ]);
  const preparationFailures = preparedDirectories.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
  if (preparationFailures.length === 1) throw preparationFailures[0];
  if (preparationFailures.length > 1) {
    throw new AggregateError(preparationFailures, 'Execution generation directory preparation failed');
  }
  const dependencyFixture = await issueCompilerDependencyFixtureOperation({
    dependencies: { commander: '1.0.0' },
    dependencyRootPath,
    devDependencies: { typescript: '1.0.0' },
    lockfileBytes: 'fixture-lock\n',
    packages: [{ main: 'index.d.ts', name: 'commander', version: '1.0.0' }, {
      main: './lib/typescript.js',
      name: 'typescript',
      version: '1.0.0'
    }]
  });
  await settleWorkspaceCallback(async () => {
    const dependencyGeneration = await settleCompilerDependencyFixtureOperation(dependencyFixture);
    await writeFile(
      path.join(repositoryRoot, 'src', 'example', 'value.ts'),
      "import 'commander'; export const value = 1;\n"
    );
    await withAuthorityGitReadSession({
      cwd: repositoryRoot,
      budget: Object.freeze({ ...GIT_READ_OPERATION_BUDGET, maxProcesses: 4 })
    }, async (session) => {
      const snapshot = await acquireWorkingTreeWorkspaceSourceSnapshot({ session });
      const withoutDependency = compileWorkspaceTypeScriptProjectInput(snapshot, 'tsconfig.json');
      expect(withoutDependency.dependencyGenerationDigest).toBeNull();
      expect(withoutDependency.externalSourceFacts.some(({ kind }) => kind === 'dependency-generation'))
        .toBe(false);
      expect(withoutDependency.externalSourceFacts.some(({ path: sourcePath }) => sourcePath.includes('commander')))
        .toBe(false);
      const retainedDependencyGeneration = await retainCompilerDependencyExecutionGeneration(
        dependencyGeneration.executionGenerationAuthority,
        { deadlineAtUnixMs: Date.now() + 30_000 }
      );
      const evidence = issueWorkspaceTypeScriptProjectGenerationEvidence(
        snapshot,
        compileWorkspaceTypeScriptProjectInput(snapshot, 'tsconfig.json', {
          dependencyGeneration: retainedDependencyGeneration.physicalGeneration,
          dependencyGenerationDigest: retainedDependencyGeneration.generationDigest
        })
      );
      expect(evidence.projectInput.externalSourceFacts.some(({ kind, path: sourcePath }) => (
        kind === 'dependency-generation' && sourcePath.startsWith('commander/')
      ))).toBe(true);
      for (const rejection of ['cancelled', 'deadline', 'foreign-evidence']) {
        const rejectedDependency = await retainCompilerDependencyExecutionGeneration(
          dependencyGeneration.executionGenerationAuthority,
          { deadlineAtUnixMs: Date.now() + 30_000 }
        );
        let releases = 0;
        const rejectedInput = {
          deadlineAtUnixMs: rejection === 'deadline' ? Date.now() - 1 : Date.now() + 30_000,
          dependencyGeneration: {
            physicalGeneration: rejectedDependency.physicalGeneration,
            generationDigest: rejectedDependency.generationDigest,
            retire: async () => { releases += 1; await rejectedDependency.retire(); }
          },
          dependencyLocatorPath: dependencyGeneration.nodeModulesPath,
          generationParent: inspectNoFollowDirectoryChain(generationParentPath).target,
          ...(rejection === 'cancelled' ? { signal: AbortSignal.abort() } : {})
        };
        await expect(materializeTypeScriptExecutionGeneration(
          rejection === 'foreign-evidence' ? { ...evidence } : evidence,
          rejectedInput
        )).rejects.toThrow(rejection === 'cancelled' ? 'cancelled' : rejection === 'deadline' ? 'deadline' : 'not issued');
        expect(releases).toBe(1);
        expect(await readdir(generationParentPath)).toEqual([]);
      }
      let dependencyRetirementAttempts = 0;
      const generation = await materializeTypeScriptExecutionGeneration(evidence, {
        deadlineAtUnixMs: Date.now() + 30_000,
        dependencyGeneration: {
          physicalGeneration: retainedDependencyGeneration.physicalGeneration,
          generationDigest: retainedDependencyGeneration.generationDigest,
          retire: async () => {
            dependencyRetirementAttempts += 1;
            if (dependencyRetirementAttempts === 1) throw new Error('dependency release temporarily unavailable');
            await retainedDependencyGeneration.retire();
          }
        },
        dependencyLocatorPath: dependencyGeneration.nodeModulesPath,
        generationParent: inspectNoFollowDirectoryChain(generationParentPath).target
      });
      // childPath names the child descriptor table, not this process's table.
      const generationRoot = generation.workingDirectory.root.path;
      try {
        await writeFile(path.join(repositoryRoot, 'src', 'example', 'value.ts'), 'export const value = 9;\n');
        expect(await readFile(path.join(generationRoot, 'src', 'example', 'value.ts'), 'utf8'))
          .toBe("import 'commander'; export const value = 1;\n");
        await expect(lstat(path.join(generationRoot, 'src', 'example', 'non-checker.yaml')))
          .rejects.toMatchObject({ code: 'ENOENT' });
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
        await expect(generation.retire()).rejects.toThrow('preserved physical residue');
        await expect(lstat(generationRoot)).rejects.toMatchObject({ code: 'ENOENT' });
        const receipt = await generation.retire();
        expect(await generation.retire()).toEqual(receipt);
        expect(dependencyRetirementAttempts).toBe(2);
      }
      await expect(lstat(generationRoot)).rejects.toMatchObject({ code: 'ENOENT' });
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
      const replacementEvidence = issueWorkspaceTypeScriptProjectGenerationEvidence(
        snapshot,
        compileWorkspaceTypeScriptProjectInput(snapshot, 'tsconfig.json', {
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
  }, () => retireCompilerDependencyFixtureOperation(dependencyFixture));
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
