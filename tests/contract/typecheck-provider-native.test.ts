import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY, executeTypeScriptNativeChecker } from '../../src/adapters/toolchain/typescript/checker.ts';
import { copyInstalledNativeCheckerFixture, selectNativeChecker, withCheckerExecutionBoundary } from './typecheck-provider-fixture.ts';

test.skipIf(process.platform !== 'win32')('provider-issued native checker writes incremental state only inside its action-private auxiliary capability', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-native-typecheck-effect-'));
  try {
    const nodeModulesPath = await copyInstalledNativeCheckerFixture(root);
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(projectRoot);
    await Promise.all([
      fs.writeFile(path.join(projectRoot, 'input.ts'), 'export const answer: number = 42;\n'),
      fs.writeFile(path.join(projectRoot, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          incremental: true,
          noEmit: true,
          strict: true,
          types: []
        },
        files: ['input.ts']
      }))
    ]);
    const checker = await selectNativeChecker(nodeModulesPath);
    const result = await withCheckerExecutionBoundary(
      projectRoot,
      nodeModulesPath,
      checker,
      1,
      (boundary) => executeTypeScriptNativeChecker(checker, {
        ...boundary,
        deadlineAtUnixMs: Date.now() + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.timeoutMs
      })
    );
    expect(result).toMatchObject({ status: 'exited', code: 0 });
    expect((await fs.lstat(path.join(
      root,
      'action-private-auxiliary',
      'tsconfig.tsbuildinfo'
    ))).isFile()).toBe(true);
    await expect(fs.lstat(path.join(projectRoot, 'tsconfig.tsbuildinfo')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'win32')('expired or cancelled native checker operation creates no incremental state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-native-typecheck-deadline-'));
  try {
    const nodeModulesPath = await copyInstalledNativeCheckerFixture(root);
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(projectRoot);
    await fs.writeFile(path.join(projectRoot, 'tsconfig.json'), JSON.stringify({ files: [] }));
    const checker = await selectNativeChecker(nodeModulesPath);
    await withCheckerExecutionBoundary(
      projectRoot,
      nodeModulesPath,
      checker,
      0,
      async (boundary) => {
        expect(await executeTypeScriptNativeChecker(checker, {
          ...boundary,
          deadlineAtUnixMs: Date.now() - 1
        })).toMatchObject({ status: 'unverified', reason: 'deadline-exhausted' });
        const buildInfoFile = path.join(
          boundary.auxiliaryDirectory.childPath,
          boundary.buildInfoFileName
        );
        await expect(fs.lstat(buildInfoFile)).rejects.toMatchObject({ code: 'ENOENT' });
        const controller = new AbortController();
        controller.abort();
        expect(await executeTypeScriptNativeChecker(checker, {
          ...boundary,
          deadlineAtUnixMs: Date.now() + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.timeoutMs,
          signal: controller.signal
        })).toMatchObject({ status: 'unverified', reason: 'cancelled' });
        await expect(fs.lstat(buildInfoFile)).rejects.toMatchObject({ code: 'ENOENT' });
      }
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
