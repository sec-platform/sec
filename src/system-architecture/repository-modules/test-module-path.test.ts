import { expect, test } from 'bun:test';

import { isSecRepositoryTestModulePath } from './test-module-path.ts';

test('repository test module identity includes root and colocated JS or TypeScript tests', () => {
  for (const path of [
    'tests/unit/example.test.ts',
    'tests/integration/example.spec.mts',
    'src/example/example.test.tsx',
    'src/example/example.spec.cjs',
    '.\\src\\example\\windows.test.ts'
  ]) {
    expect(isSecRepositoryTestModulePath(path)).toBe(true);
  }
});

test('repository test module identity excludes production and test-support modules', () => {
  for (const path of [
    'src/example/runtime.ts',
    'src/example/test/helper.ts',
    'tests/helpers/fixture.ts',
    'fixtures/example.test.ts',
    'src/example/example.test.cjsx',
    'src/example/example.spec.mjsx',
    'src/example/example.test.json'
  ]) {
    expect(isSecRepositoryTestModulePath(path)).toBe(false);
  }
});
