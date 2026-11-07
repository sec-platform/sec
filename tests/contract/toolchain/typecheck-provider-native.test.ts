import { expect, test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY, executeTypeScriptNativeChecker } from '../../../src/adapters/toolchain/typescript/checker.ts';
import { copyInstalledNativeCheckerFixture, selectNativeChecker, withNativeCheckerExecutionWorkspace } from './typecheck-provider-fixture.ts';

// Native checking must consume the repository policy itself, not the JS
// checker's result or a test-authored replacement for noUnused/include.
async function writeRepositoryProject(root: string, source: string): Promise<string> {
  const projectRoot = path.join(root, 'project');
  const config = JSON.parse(await fs.readFile(
    fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)), 'utf8'
  ));
  await fs.mkdir(projectRoot);
  await fs.writeFile(path.join(projectRoot, 'package.json'), '{"type":"module"}\n');
  await fs.writeFile(path.join(projectRoot, 'tsconfig.json'), JSON.stringify({
    ...config, compilerOptions: { ...config.compilerOptions, types: [] }
  }));
  for (const surface of ['src', 'tests']) {
    const directory = path.join(projectRoot, surface);
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'entry.ts'), source);
    await fs.writeFile(path.join(directory, 'provider.ts'),
      'export const value = 1; export type Payload = { value: number };\n');
    await fs.writeFile(path.join(directory, 'effects.ts'), 'export const initialized = 1;\n');
  }
  return projectRoot;
}

test.skipIf(process.platform !== 'win32')('provider-issued native checker writes incremental state only inside its action-private auxiliary capability', async () => {
  await withNativeCheckerExecutionWorkspace('sec-native-typecheck-effect-', async (root, withBoundary) => {
    const nodeModulesPath = await copyInstalledNativeCheckerFixture(root);
    const projectRoot = await writeRepositoryProject(root, [
      'import { value } from "./provider.js";',
      'import type { Payload } from "./provider.js";',
      'import "./effects.js";',
      'const used = value;',
      'export function callback(_error: unknown, input: Payload) { return input.value + used; }',
      'export type PublicContract = { value: number }; export const entrypoint = 1;'
    ].join('\n'));
    const checker = await selectNativeChecker(nodeModulesPath);
    const diagnosticArguments = ['--listFiles', '--pretty', 'false'];
    const result = await withBoundary(
      projectRoot,
      nodeModulesPath,
      checker,
      1,
      (boundary) => executeTypeScriptNativeChecker(checker, {
        ...boundary,
        args: diagnosticArguments,
        deadlineAtUnixMs: Date.now() + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.timeoutMs
      }),
      diagnosticArguments
    );
    expect(result).toMatchObject({ status: 'exited', code: 0 });
    assert.equal(result.status, 'exited');
    assert.equal(result.stderr, '');
    const selectedFiles = result.stdout.split(/\r?\n/u).map(file => file.replaceAll('\\', '/'));
    for (const surface of ['src', 'tests']) {
      assert.ok(selectedFiles.includes(path.join(projectRoot, surface, 'entry.ts').replaceAll('\\', '/')),
        `The native checker must actually select ${surface}/entry.ts`);
    }
    expect((await fs.lstat(path.join(
      root,
      'action-private-auxiliary',
      'tsconfig.tsbuildinfo'
    ))).isFile()).toBe(true);
    await expect(fs.lstat(path.join(projectRoot, 'tsconfig.tsbuildinfo')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });
});

test.skipIf(process.platform !== 'win32')('repository policy rejects each unused binding through the native checker on src and tests', async () => {
  await withNativeCheckerExecutionWorkspace('sec-native-unused-policy-', async (root, withBoundary) => {
    const nodeModulesPath = await copyInstalledNativeCheckerFixture(root);
    const projectRoot = await writeRepositoryProject(root, [
      'import { value } from "./provider.js";',
      'import type { Payload } from "./provider.js";',
      'const discarded = 1;',
      'function redundant(value: number) { return value; }',
      'export function evaluate(unused: number) { return 1; }'
    ].join('\n'));
    const checker = await selectNativeChecker(nodeModulesPath);
    const diagnosticArguments = ['--pretty', 'false'];
    const result = await withBoundary(
      projectRoot, nodeModulesPath, checker, 1,
      boundary => executeTypeScriptNativeChecker(checker, {
        ...boundary,
        args: diagnosticArguments,
        deadlineAtUnixMs: Date.now() + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.timeoutMs
      }),
      diagnosticArguments
    );
    assert.equal(result.status, 'exited', 'An unverified provider is not an unused-code rejection');
    assert.notEqual(result.code, 0);
    assert.equal(result.stderr, '');
    const diagnostics = result.stdout.trim().split(/\r?\n/u).map(line => {
      const match = /^(.*)\((\d+),(\d+)\): error TS(\d+): '([^']+)' /u.exec(line);
      assert.ok(match, `Unexpected native diagnostic: ${line}`);
      const file = path.isAbsolute(match[1]!) ? path.relative(projectRoot, match[1]!) : match[1]!;
      return { file: file.replaceAll('\\', '/'), line: Number(match[2]), column: Number(match[3]),
        code: Number(match[4]), binding: match[5] };
    }).sort((left, right) => left.file === right.file ? left.line - right.line : left.file < right.file ? -1 : 1);
    const expected = ['src', 'tests'].flatMap(surface => [
      { line: 1, column: 10, code: 6133, binding: 'value' },
      { line: 2, column: 15, code: 6196, binding: 'Payload' },
      { line: 3, column: 7, code: 6133, binding: 'discarded' },
      { line: 4, column: 10, code: 6133, binding: 'redundant' },
      { line: 5, column: 26, code: 6133, binding: 'unused' }
    ].map(diagnostic => ({ file: `${surface}/entry.ts`, ...diagnostic })));
    assert.deepEqual(diagnostics, expected, 'Every intended unused binding, and no other error, must be reported');
  });
});

test.skipIf(process.platform !== 'win32')('expired or cancelled native checker operation creates no incremental state', async () => {
  await withNativeCheckerExecutionWorkspace('sec-native-typecheck-deadline-', async (root, withBoundary) => {
    const nodeModulesPath = await copyInstalledNativeCheckerFixture(root);
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(projectRoot);
    await fs.writeFile(path.join(projectRoot, 'tsconfig.json'), JSON.stringify({ files: [] }));
    const checker = await selectNativeChecker(nodeModulesPath);
    await withBoundary(
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
  });
});
