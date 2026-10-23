import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { isSecRepositoryTestModulePath } from './repository-test-path.ts';

test('repository test identity preserves dotted suffixes and portable path spellings', () => {
  for (const file of [
    'tests/unit/example.test.ts',
    'tests/integration/example.spec.mts',
    'src/example/example.test.tsx',
    'src/example/example.spec.cjs',
    '.\\src\\example\\windows.test.ts',
    './tests/unit/example_test.ts',
    '.\\src\\nested\\example_spec.tsx'
  ]) {
    assert.equal(isSecRepositoryTestModulePath(file), true, file);
  }
});

test('underscore test and spec files use the same executable-test identity across script extensions', () => {
  for (const file of [
    'src/nested/example_test.ts',
    'tests/nested/example_spec.tsx',
    'src/nested/example_spec.mts',
    'tests/nested/example_test.cts',
    'src/nested/example_test.js',
    'tests/nested/example_spec.jsx',
    'src/nested/example_spec.mjs',
    'tests/nested/example_test.cjs'
  ]) {
    assert.equal(isSecRepositoryTestModulePath(file), true, file);
  }
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
    assert.equal(isSecRepositoryTestModulePath(file), false, file);
  }
});
