import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  SEMANTIC_MUTATION_ISOLATED_BOOTSTRAP_RELATIVE_PATH,
  SEMANTIC_MUTATION_ISOLATED_STAGED_LOADER_RELATIVE_PATH,
  SEMANTIC_MUTATION_ISOLATED_RUNNER_CORE_RELATIVE_PATH,
  semanticMutationIsolatedBootstrapBytes,
  semanticMutationIsolatedStagedLoaderBytes,
  readSemanticMutationIsolatedProgressTrace
} from '../../src/adapters/verification/isolation/isolated-verification-child-progress.ts';
import { SEMANTIC_MUTATION_ISOLATED_EXIT_CODES } from '../../src/assurance/verification/semantic-mutation/isolated-progress.ts';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  buildSemanticMutationIsolatedVerificationEnvironment,
  createSemanticMutationIsolatedVerificationSupervisor
} from '../../src/adapters/verification/run-semantic-mutation-isolated-child.ts';
import { SEMANTIC_MUTATION_ISOLATED_BUNFIG_RELATIVE_PATH } from '../../src/adapters/verification/semantic-mutation-isolated-runtime-plan.ts';
import type { WorkspaceWriteLeaseToken } from '../../src/adapters/filesystem/write-lease.ts';

test('isolated semantic verification environment contains no ambient network or credential authority', () => {
  const root = path.resolve('.tmp', 'isolated-runtime-environment');
  const environment = buildSemanticMutationIsolatedVerificationEnvironment(root);

  expect(environment.SEC_ISOLATED_VERIFICATION).toBe('1');
  expect(environment.CI).toBe('true');
  expect(environment.PATH).toBe('');
  expect(Object.keys(environment).some((key) => /proxy|token|credential|secret/iu.test(key))).toBe(false);
  for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR']) {
    expect(path.resolve(environment[key]!).startsWith(root)).toBe(true);
  }
});

test('isolated semantic supervisor launches only the staged Bun bootstrap', async () => {
  const stagingRoot = path.resolve('.tmp', 'isolated-runtime-supervisor');
  let observed: { command: string; args: string[] } | undefined;
  const supervisor = createSemanticMutationIsolatedVerificationSupervisor({
    commandRunner: async (command, args) => {
      observed = { command, args: [...args] };
      return { code: 0, stdout: '', stderr: '' };
    }
  });

  await supervisor({
    commitFence: async () => undefined,
    env: buildSemanticMutationIsolatedVerificationEnvironment(stagingRoot),
    runnerRelativePath: '.isolated-compiler/runner-bootstrap.mjs',
    stagingWorkspaceRoot: stagingRoot,
    workspaceRoot: path.dirname(stagingRoot),
    workspaceWriteLease: {} as WorkspaceWriteLeaseToken
  });

  expect(observed).toEqual({
    command: process.execPath,
    args: [
      '--no-env-file',
      `--config=${path.join(stagingRoot, ...SEMANTIC_MUTATION_ISOLATED_BUNFIG_RELATIVE_PATH.split('/'))}`,
      '--no-install',
      path.join(stagingRoot, '.isolated-compiler', 'runner-bootstrap.mjs')
    ]
  });
});

test('generated bootstrap relocates to the staged root and imports its exact staged core', async () => {
  await withGeneratedRuntime(async (root, bootstrap) => {
    const child = spawnSync(process.execPath, ['--no-env-file', '--no-install', bootstrap], {
      cwd: path.dirname(root), encoding: 'utf8', timeout: 5000
    });
    expect(child.error).toBeUndefined();
    expect(child.stderr).toBe('');
    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({ cwd: root });
    expect(await readSemanticMutationIsolatedProgressTrace(root)).toEqual({
      status: 'valid', trace: {
        checkpoints: ['bootstrap-entered', 'loader-entered', 'core-import-started'],
        lastCheckpoint: 'core-import-started'
      }
    });
  });
});

test('generated bootstrap rejects a moved entrypoint before publishing progress or importing core', async () => {
  await withGeneratedRuntime(async (root, bootstrap) => {
    const moved = path.join(path.dirname(bootstrap), 'wrong-bootstrap.mjs');
    await rename(bootstrap, moved);
    const child = spawnSync(process.execPath, ['--no-env-file', '--no-install', moved], {
      cwd: path.dirname(root), encoding: 'utf8', timeout: 5000
    });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.bootstrapEnvironmentBoundaryFailure);
    expect(child.stdout).toBe('');
    expect(await readdir(path.join(root, '.isolated-process', 'child'))).toEqual([]);
  });
});

async function withGeneratedRuntime(run: (root: string, bootstrap: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-isolated-relocation-'));
  try {
    const bootstrap = path.join(root, SEMANTIC_MUTATION_ISOLATED_BOOTSTRAP_RELATIVE_PATH);
    const files = [
      [bootstrap, semanticMutationIsolatedBootstrapBytes()],
      [path.join(root, SEMANTIC_MUTATION_ISOLATED_STAGED_LOADER_RELATIVE_PATH),
        semanticMutationIsolatedStagedLoaderBytes({
          formatRevision: 'semantic-mutation-isolated-bundled-loader-binding-v1',
          executionRevision: 'semantic-mutation-bundled-core-relocation-v1'
        })],
      [path.join(root, SEMANTIC_MUTATION_ISOLATED_RUNNER_CORE_RELATIVE_PATH),
        new TextEncoder().encode('console.log(JSON.stringify({ cwd: process.cwd() }));\n')]
    ] as const;
    for (const [file, bytes] of files) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes);
    }
    await mkdir(path.join(root, '.isolated-process', 'child'), { recursive: true });
    await run(root, bootstrap);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
