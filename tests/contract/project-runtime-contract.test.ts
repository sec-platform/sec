import { expect, test } from 'bun:test';

import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

test('compiler generation binding is the sole reusable dependency identity', async () => {
  const source = await readCompilerFile('platform/shared/project-runtime.ts');

  expect(source).toContain("'.sec-compiler-deps-binding-v3.json'");
  expect(source).toContain('runtimeMaterialization');
  expect(source).toContain('compilerRuntimeMaterializationBinding');
  expect(source).toContain('currentRuntimeExecutableIdentity(true)');
  expect(source).toContain('bunExecutableSha256');
  expect(source).not.toContain('compiler-deps.stamp.json');
  expect(source).not.toContain('readCompilerDepsStamp');
  expect(source).not.toContain('writeCompilerDepsStamp');
});

test('zero-consumer generic ConfigCache is retired', async () => {
  await expect(readCompilerFile('platform/shared/config-cache.ts')).rejects.toThrow();
});
