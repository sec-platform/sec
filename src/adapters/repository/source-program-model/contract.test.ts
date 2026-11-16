import { expect, test } from 'bun:test';
import { isSourceProgramInputPath, sourceProgramSurfaceForPath } from './contract.ts';

test('source program retains only the two exact reviewed Python resources in its byte census', () => {
  for (const helper of [
    'src/adapters/verification/platform/ci/runtime/hosted-sut-supervisor.py',
    'src/adapters/runtime-state/physical/runtime/linux-verification-unit-helper.py'
  ]) {
    expect(isSourceProgramInputPath(helper)).toBe(true);
    expect(sourceProgramSurfaceForPath(helper)).toBe('resource');
    for (const other of [helper.replace(/[^/]+$/u, 'other.py'),
      `../${helper}`, `${helper}.bak`]) {
      expect(isSourceProgramInputPath(other)).toBe(false);
    }
  }
  for (const other of ['src/other.py', 'tests/fixture.py']) {
    expect(isSourceProgramInputPath(other)).toBe(false);
  }
});

test('source program classifies catalog-installed code as a resource surface', () => {
  expect(sourceProgramSurfaceForPath(
    'catalog/registry/official/example/files/src/installed/example.ts'
  )).toBe('resource');
  expect(sourceProgramSurfaceForPath('src/example.ts')).toBe('production');
  expect(sourceProgramSurfaceForPath('tests/unit/example.test.ts')).toBe('test');
  expect(sourceProgramSurfaceForPath('examples/reference-workspace/src/example.ts')).toBe('resource');
  expect(sourceProgramSurfaceForPath('source/code/example.ts')).toBe('resource');
});

test('source program input closure excludes target workspaces and generated artifacts', () => {
  expect(isSourceProgramInputPath('src/example.ts')).toBe(true);
  expect(isSourceProgramInputPath('tests/unit/example.test.ts')).toBe(true);
  expect(isSourceProgramInputPath('src/example/module.json')).toBe(true);
  expect(isSourceProgramInputPath('.github/workflows/ci.yml')).toBe(true);
  expect(isSourceProgramInputPath('.documentation/documents.json')).toBe(true);
  expect(isSourceProgramInputPath('.documentation/baseline.json')).toBe(true);
  expect(isSourceProgramInputPath('docs/authority.json')).toBe(false);
  expect(isSourceProgramInputPath(
    'examples/reference-workspace/.sec/artifacts/evidence/review-summary.json'
  )).toBe(false);
  expect(isSourceProgramInputPath('examples/reference-workspace/src/example.ts')).toBe(false);
  expect(isSourceProgramInputPath(
    'catalog/registry/official/example/files/src/installed/example.ts'
  )).toBe(false);
});
