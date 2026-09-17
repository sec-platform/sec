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
