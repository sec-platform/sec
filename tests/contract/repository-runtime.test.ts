import { describe, expect, test } from 'bun:test';

import { readCompilerPackageJson } from '../helpers/compiler-fixtures.ts';

describe('developer contract entrypoints', () => {
  test('contract scripts bypass dev-runner', async () => {
    const { scripts } = await readCompilerPackageJson();

    expect(scripts['test:budget']).not.toContain('dev-runner');
    expect(scripts['test:benchmark-contract']).not.toContain('dev-runner');
    expect(scripts['reference:check']).not.toContain('reference-clean');
  });
});
