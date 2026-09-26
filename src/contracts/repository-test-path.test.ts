import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { isRepositoryTestModulePath } from './repository-test-path.ts';

test('repository test identity preserves dotted suffixes and portable path spellings', () => {
  for (const file of [
    'tests/unit/example.test.ts',
    'tests/integration/example.spec.mts',
    'src/example/example.test.tsx',
    'src/example/example.spec.cjs',
    '.\\src\\example\\windows.test.ts'
  ]) {
    assert.equal(isRepositoryTestModulePath(file), true, file);
  }
});

test('underscore test and spec files use the same executable-test identity across script extensions', () => {
  for (const root of ['src', 'tests']) {
    for (const suffix of ['_test', '_spec']) {
      for (const extension of ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs']) {
        const file = `${root}/nested/example${suffix}.${extension}`;
        assert.equal(isRepositoryTestModulePath(file), true, file);
      }
    }
  }
});

test('underscore identities retain the existing leading-dot and separator projection', () => {
  assert.equal(isRepositoryTestModulePath('./tests/unit/example_test.ts'), true);
  assert.equal(isRepositoryTestModulePath('.\\src\\nested\\example_spec.tsx'), true);
});

test('support modules and unsupported extensions are not promoted into executable tests', () => {
  for (const file of [
    'src/example/runtime.ts',
    'src/example/test/helper.ts',
    'tests/helpers/fixture.ts',
    'fixtures/example.test.ts',
    'fixtures/example_test.ts',
    'src/example/example.test.cjsx',
    'src/example/example.spec.mjsx',
    'src/example/example.test.json',
    'tests/example_test.json',
    'tests/example_spec.cjsx',
    'tests/example_specification.ts'
  ]) {
    assert.equal(isRepositoryTestModulePath(file), false, file);
  }
});
