import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  SEMANTIC_MUTATION_ISOLATED_BOOTSTRAP_RELATIVE_PATH,
  SEMANTIC_MUTATION_ISOLATED_RUNNER_CORE_RELATIVE_PATH,
  SEMANTIC_MUTATION_ISOLATED_STAGED_LOADER_RELATIVE_PATH,
  semanticMutationIsolatedBootstrapBytes,
  semanticMutationIsolatedStagedLoaderBytes
} from '../../src/adapters/verification/isolation/isolated-verification-child-progress.ts';
import {
  parseSemanticMutationIsolatedProgressTransportBytes,
  SEMANTIC_MUTATION_ISOLATED_EXIT_CODES,
  semanticMutationIsolatedProgressFrameText
} from '../../src/assurance/verification/semantic-mutation/isolated-progress.ts';

import { expect, test } from 'bun:test';

import type { WorkspaceWriteLeaseToken } from '../../src/adapters/filesystem/write-lease.ts';
import {
  buildSemanticMutationIsolatedVerificationEnvironment,
  createSemanticMutationIsolatedVerificationSupervisor
} from '../../src/adapters/verification/run-semantic-mutation-isolated-child.ts';
import { SEMANTIC_MUTATION_ISOLATED_BUNFIG_RELATIVE_PATH } from '../../src/adapters/verification/semantic-mutation-isolated-runtime-plan.ts';

test('isolated semantic verification environment contains no ambient network or credential authority', () => {
  const root = path.resolve('.tmp', 'isolated-runtime-environment');
  const environment = buildSemanticMutationIsolatedVerificationEnvironment(root);

  expect(environment.SEC_ISOLATED_VERIFICATION).toBe('1');
  expect(environment.CI).toBe('true');
  expect(environment.PATH).toBe('');
  expect(Object.keys(environment).some((key) => /proxy|token|credential|secret/iu.test(key))).toBe(false);
  for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR']) {
    expect(path.resolve(environment[key]!).startsWith(`${root}${path.sep}`)).toBe(true);
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

test('generated bootstrap relocates to the staged root and emits exact progress transport', async () => {
  await withGeneratedRuntime(async (root, bootstrap) => {
    const child = spawnSync(process.execPath, ['--no-env-file', '--no-install', bootstrap], {
      cwd: path.dirname(root), timeout: 5000
    });
    expect(child.error).toBeUndefined();
    expect(Buffer.from(child.stderr ?? []).toString('utf8')).toBe('');
    expect(child.status).toBe(0);
    expect(parseSemanticMutationIsolatedProgressTransportBytes(
      new Uint8Array(child.stdout ?? [])
    )).toEqual({
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
      cwd: path.dirname(root), timeout: 5000
    });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.bootstrapEnvironmentBoundaryFailure);
    expect(Buffer.from(child.stdout ?? []).byteLength).toBe(0);
    expect(await readdir(path.join(root, '.isolated-process', 'child'))).toEqual([]);
  });
});



test('progress transport preserves committed and pending checkpoint state and rejects foreign stdout', () => {
  const committed = [
    semanticMutationIsolatedProgressFrameText('pending', 'bootstrap-entered'),
    semanticMutationIsolatedProgressFrameText('committed', 'bootstrap-entered'),
    semanticMutationIsolatedProgressFrameText('pending', 'loader-entered')
  ].join('');
  expect(parseSemanticMutationIsolatedProgressTransportBytes(
    new TextEncoder().encode(committed)
  )).toEqual({
    status: 'valid',
    trace: {
      checkpoints: ['bootstrap-entered'],
      lastCheckpoint: 'bootstrap-entered',
      pendingCheckpoint: 'loader-entered'
    }
  });
  expect(parseSemanticMutationIsolatedProgressTransportBytes(
    new TextEncoder().encode('ordinary child stdout\n')
  )).toEqual({ status: 'protocol-error' });
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
        new TextEncoder().encode(
          `if (process.cwd() !== ${JSON.stringify(root)}) process.exitCode = 93;\n`
        )]
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


test('isolated runtime probe admits staging before source resolution and sandbox checks', () => {
  const probeModule = path.resolve(import.meta.dir, '../../src/adapters/verification/run-semantic-mutation-isolated-child.ts');
  const sourcesModule = path.resolve(import.meta.dir, '../../src/adapters/verification/run-runtime-verification.ts');
  const sandboxModule = path.resolve(import.meta.dir, '../../src/adapters/verification/fast-suite-sandbox-capability.ts');
  const script = `
    import { mock } from 'bun:test';
    import { mkdir, mkdtemp, rm } from 'node:fs/promises';
    import { tmpdir } from 'node:os';
    import path from 'node:path';
    const [probeModule, sourcesModule, sandboxModule] = process.argv.slice(1);
    let sourceResolutions = 0, sandboxCalls = 0;
    let rejectSourceResolution = true;
    const sources = await import(sourcesModule);
    mock.module(sourcesModule, () => ({
      ...sources,
      resolveIsolatedRuntimeDependencySources: () => {
        sourceResolutions++;
        if (rejectSourceResolution) throw new Error('source resolution intercepted');
        return { compilerModulesRoot: root, dependencyModules: root };
      }
    }));
    mock.module(sandboxModule, () => ({
      hasProvenFastSuiteProcessWideWriteSandbox: async () => { sandboxCalls++; return false; }
    }));
    const { probeSemanticMutationIsolatedRuntimeCapability: probe } = await import(probeModule);
    const root = await mkdtemp(path.join(tmpdir(), 'sec-probe-admission-'));
    const stage = path.join(root, '.sec', 'semantic-mutation', 'v1', 'transactions', 'a'.repeat(64), 'workspace');
    try {
      const observations = [];
      const observe = async (candidate) => {
        const before = sourceResolutions, beforeSandbox = sandboxCalls;
        observations.push({ result: await probe(candidate),
          sourceResolutions: sourceResolutions - before,
          sandboxCalls: sandboxCalls - beforeSandbox });
      };
      for (const rejected of [root, stage]) await observe(rejected);
      await mkdir(stage, { recursive: true });
      await observe(stage);
      rejectSourceResolution = false;
      await observe(stage);
      console.log(JSON.stringify(observations));
    } finally { await rm(root, { recursive: true, force: true }); }
  `;
  const child = spawnSync(process.execPath, [
    '--no-env-file', '--no-install', '--eval', script, '--',
    probeModule, sourcesModule, sandboxModule
  ], {
    encoding: 'utf8', timeout: 10_000
  });
  expect(child.error).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  expect(JSON.parse(child.stdout)).toEqual([
    { result: { status: 'unavailable' }, sourceResolutions: 0, sandboxCalls: 0 },
    { result: { status: 'unavailable' }, sourceResolutions: 0, sandboxCalls: 0 },
    { result: { status: 'unavailable' }, sourceResolutions: 1, sandboxCalls: 0 },
    { result: { status: 'unavailable' }, sourceResolutions: 1, sandboxCalls: 1 }
  ]);
});
