import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { withAuthorityGitReadSession } from '../../providers/git-read/authority.ts';
import { inspectNoFollowDirectoryChain } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { GIT_READ_OPERATION_BUDGET } from '../../self-hosting/development/tooling/git/git-read.ts';
import {
  observeCompilerDependencyExecutionGenerationAuthority,
  retainCompilerDependencyReadGeneration
} from '../../toolchain/dependencies/runtime.ts';
import { compileRepositorySourceProgramCompilation } from '../source-program-model/repository-compilation.ts';
import { acquireWorkingTreeSnapshot } from '../source-program-model/workspace-source-snapshot.ts';
import { executeKnipUnusedSymbolProvider } from './knip-provider.ts';

function git(repositoryRoot: string, args: readonly string[]): void {
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
}

async function observe(repositoryRoot: string) {
  return withAuthorityGitReadSession({
    cwd: repositoryRoot,
    budget: Object.freeze({ ...GIT_READ_OPERATION_BUDGET, maxProcesses: 4 })
  }, async (session) => {
    const workspaceSnapshot = await acquireWorkingTreeSnapshot({ session });
    const compilation = compileRepositorySourceProgramCompilation({
      workspaceSnapshot,
      repositoryRoot
    });
    return Object.freeze({ workspaceSnapshot, model: compilation.model });
  });
}

test('sealed Knip provider binds source, config and dependencies and signs only after cleanup', async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'sec-knip-provider-'));
  const repositoryRoot = path.join(fixtureRoot, 'repository');
  const generationParentPath = path.join(fixtureRoot, 'generations');
  await Promise.all([
    mkdir(path.join(repositoryRoot, 'src', 'example'), { recursive: true }),
    mkdir(generationParentPath)
  ]);
  git(repositoryRoot, ['init', '--quiet']);
  git(repositoryRoot, ['config', 'user.email', 'tests@example.com']);
  git(repositoryRoot, ['config', 'user.name', 'SEC Tests']);
  git(repositoryRoot, ['config', 'core.autocrlf', 'false']);
  await Promise.all([
    writeFile(path.join(repositoryRoot, 'package.json'), `${JSON.stringify({
      private: true,
      scripts: { start: 'bun src/example/index.ts' }
    }, null, 2)}\n`),
    writeFile(path.join(repositoryRoot, 'knip.json'), `${JSON.stringify({
      entry: ['src/example/index.ts!'],
      project: ['src/**/*.ts']
    }, null, 2)}\n`),
    writeFile(path.join(repositoryRoot, 'tsconfig.json'), `${JSON.stringify({
      compilerOptions: { strict: true },
      include: ['src/**/*.ts']
    }, null, 2)}\n`),
    writeFile(path.join(repositoryRoot, 'src', 'example', 'module.json'), `${JSON.stringify({
      importGraph: 'runtime',
      externalEntrypoints: ['src/example/index.ts'],
      capabilityProviders: [],
      preDependencyBootstrap: false
    }, null, 2)}\n`),
    writeFile(
      path.join(repositoryRoot, 'src', 'example', 'index.ts'),
      "import { used } from './library.ts';\nconsole.log(used);\n"
    ),
    writeFile(
      path.join(repositoryRoot, 'src', 'example', 'library.ts'),
      'export const used = 1;\nexport const unused = 2;\n'
    )
  ]);
  git(repositoryRoot, ['add', '--all']);
  git(repositoryRoot, ['commit', '--quiet', '-m', 'sealed Knip fixture']);

  const deadlineAtUnixMs = Date.now() + 60_000;
  const authority = await observeCompilerDependencyExecutionGenerationAuthority({ deadlineAtUnixMs });
  if (authority === null) throw new Error('Knip test requires the canonical compiler dependency generation');
  const dependencyGeneration = await retainCompilerDependencyReadGeneration(
    authority,
    { deadlineAtUnixMs }
  );
  try {
    const initial = await observe(repositoryRoot);
    const generationParent = inspectNoFollowDirectoryChain(
      generationParentPath,
      'Knip test generation parent'
    ).target;
    const completed = await executeKnipUnusedSymbolProvider({
      ...initial,
      dependencyGeneration,
      generationParent,
      deadlineAtUnixMs
    });
    expect(completed.status).toBe('completed');
    if (completed.status !== 'completed') throw new Error('Knip did not complete');
    expect(completed.receipt).toMatchObject({
      provider: 'knip',
      settlement: 'completed',
      sourceRevision: initial.model.sourceRevision,
      candidates: [{ path: 'src/example/library.ts', name: 'unused' }]
    });
    expect(await readdir(generationParentPath)).toEqual([]);

    await writeFile(
      path.join(repositoryRoot, 'src', 'example', 'library.ts'),
      'export const used = 3;\nexport const unused = 4;\n'
    );
    const changed = await observe(repositoryRoot);
    const sourceDrift = await executeKnipUnusedSymbolProvider({
      workspaceSnapshot: initial.workspaceSnapshot,
      model: changed.model,
      dependencyGeneration,
      generationParent,
      deadlineAtUnixMs
    });
    expect(sourceDrift).toMatchObject({
      status: 'unresolved',
      diagnostic: { reason: 'source-drift' }
    });
    expect('receipt' in sourceDrift).toBeFalse();

    await writeFile(path.join(repositoryRoot, 'knip.json'), `${JSON.stringify({
      entry: ['src/example/library.ts'],
      project: ['src/**/*.ts']
    }, null, 2)}\n`);
    const entrypointDrift = await observe(repositoryRoot);
    const uncoveredEntrypoint = await executeKnipUnusedSymbolProvider({
      ...entrypointDrift,
      dependencyGeneration,
      generationParent,
      deadlineAtUnixMs
    });
    expect(uncoveredEntrypoint).toMatchObject({
      status: 'unresolved',
      diagnostic: { reason: 'configuration-unbound' }
    });
    expect('receipt' in uncoveredEntrypoint).toBeFalse();

    await writeFile(path.join(repositoryRoot, 'knip.json'), `${JSON.stringify({
      entry: ['../outside.ts'],
      project: ['src/**/*.ts']
    }, null, 2)}\n`);
    const configless = await observe(repositoryRoot);
    const configDrift = await executeKnipUnusedSymbolProvider({
      ...configless,
      dependencyGeneration,
      generationParent,
      deadlineAtUnixMs
    });
    expect(configDrift).toMatchObject({
      status: 'unresolved',
      diagnostic: { reason: 'configuration-unbound' }
    });
    expect('receipt' in configDrift).toBeFalse();

    const failed = await executeKnipUnusedSymbolProvider({
      ...initial,
      dependencyGeneration,
      generationParent,
      deadlineAtUnixMs,
      bunExecutablePath: path.join(fixtureRoot, 'absent-bun.exe')
    });
    expect(failed).toMatchObject({
      status: 'unresolved',
      diagnostic: { reason: 'execution-failed' }
    });
    expect('receipt' in failed).toBeFalse();
    expect(await readdir(generationParentPath)).toEqual([]);
  } finally {
    await dependencyGeneration.retire();
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}, 90_000);
