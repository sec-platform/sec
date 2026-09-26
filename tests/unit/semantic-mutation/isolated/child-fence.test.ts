import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ISOLATED_BOOTSTRAP_RELATIVE_PATH,
  ISOLATED_RUNNER_CORE_RELATIVE_PATH,
  ISOLATED_STAGED_LOADER_RELATIVE_PATH,
  bootstrapBytes,
  stagedLoaderBytes
} from '../../../../src/adapters/verification/semantic-mutation/isolated/child-progress.ts';
import {
  parseIsolatedProgressTransportBytes,
  ISOLATED_EXIT_CODES,
  isolatedProgressFrameText
} from '../../../../src/assurance/verification/semantic-mutation/isolated/progress.ts';

import { expect, test } from 'bun:test';

import type { WorkspaceWriteLeaseToken } from '../../../../src/adapters/filesystem/write-lease.ts';
import {
  buildIsolatedVerificationEnvironment,
  createIsolatedVerificationSupervisor
} from '../../../../src/adapters/verification/semantic-mutation/isolated/child.ts';
import { ISOLATED_BUNFIG_RELATIVE_PATH } from '../../../../src/adapters/verification/semantic-mutation/isolated/runtime-plan.ts';

test('isolated semantic verification environment contains no ambient network or credential authority', () => {
  const root = path.resolve('.tmp', 'isolated-runtime-environment');
  const environment = buildIsolatedVerificationEnvironment(root);

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
  const supervisor = createIsolatedVerificationSupervisor({
    commandRunner: async (command, args) => {
      observed = { command, args: [...args] };
      return { code: 0, stdout: '', stderr: '' };
    }
  });

  await supervisor({
    commitFence: async () => undefined,
    env: buildIsolatedVerificationEnvironment(stagingRoot),
    runnerRelativePath: '.isolated-compiler/runner-bootstrap.mjs',
    stagingWorkspaceRoot: stagingRoot,
    workspaceRoot: path.dirname(stagingRoot),
    workspaceWriteLease: {} as WorkspaceWriteLeaseToken
  });

  expect(observed).toEqual({
    command: process.execPath,
    args: [
      '--no-env-file',
      `--config=${path.join(stagingRoot, ...ISOLATED_BUNFIG_RELATIVE_PATH.split('/'))}`,
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
    expect(parseIsolatedProgressTransportBytes(
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
    expect(child.status).toBe(ISOLATED_EXIT_CODES.bootstrapEnvironmentBoundaryFailure);
    expect(Buffer.from(child.stdout ?? []).byteLength).toBe(0);
    expect(await readdir(path.join(root, '.isolated-process', 'child'))).toEqual([]);
  });
});



test('progress transport preserves committed and pending checkpoint state and rejects foreign stdout', () => {
  const committed = [
    isolatedProgressFrameText('pending', 'bootstrap-entered'),
    isolatedProgressFrameText('committed', 'bootstrap-entered'),
    isolatedProgressFrameText('pending', 'loader-entered')
  ].join('');
  expect(parseIsolatedProgressTransportBytes(
    new TextEncoder().encode(committed)
  )).toEqual({
    status: 'valid',
    trace: {
      checkpoints: ['bootstrap-entered'],
      lastCheckpoint: 'bootstrap-entered',
      pendingCheckpoint: 'loader-entered'
    }
  });
  expect(parseIsolatedProgressTransportBytes(
    new TextEncoder().encode('ordinary child stdout\n')
  )).toEqual({ status: 'protocol-error' });
});

async function withGeneratedRuntime(run: (root: string, bootstrap: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-isolated-relocation-'));
  try {
    const bootstrap = path.join(root, ISOLATED_BOOTSTRAP_RELATIVE_PATH);
    const files = [
      [bootstrap, bootstrapBytes()],
      [path.join(root, ISOLATED_STAGED_LOADER_RELATIVE_PATH),
        stagedLoaderBytes({
          formatRevision: 'semantic-mutation-isolated-bundled-loader-binding-v1',
          executionRevision: 'semantic-mutation-bundled-core-relocation-v1'
        })],
      [path.join(root, ISOLATED_RUNNER_CORE_RELATIVE_PATH),
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
