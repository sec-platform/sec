import { expect, test } from 'bun:test';

import { CompilerError } from '../../platform/shared/errors.ts';
import {
  buildRuntimeDependencySpec,
  type RootPackageJson
} from '../../platform/shared/runtime-dependency-spec.ts';

function rootPackage(playwrightVersion: string): RootPackageJson {
  return {
    dependencies: {
      next: '^16.2.4',
      react: '^19.2.5',
      'react-dom': '^19.2.5',
      yaml: '^2.8.3'
    },
    devDependencies: {
      '@playwright/test': playwrightVersion,
      '@types/bun': '^1.3.13',
      '@types/node': '^25.6.0',
      '@types/react': '^19.2.14',
      '@types/react-dom': '^19.2.3',
      'ts-morph': '^28.0.0',
      typescript: '6.0.3'
    }
  };
}

test('runtime dependency spec preserves one exact Playwright release identity', () => {
  const spec = buildRuntimeDependencySpec(rootPackage('1.59.1'));

  expect(spec.devDependencies['@playwright/test']).toBe('1.59.1');
  expect(spec.manifestHash).toMatch(/^[a-f0-9]{64}$/);
});

for (const version of [
  '^1.59.1',
  '~1.59.1',
  '>=1.59.1',
  '1.59.x',
  'latest',
  'npm:@playwright/test@1.59.1',
  '1.59.1-next.1',
  '1.59.1+local',
  '01.59.1',
  '1.059.1',
  '1.59.01'
]) {
  test(`runtime dependency spec rejects non-exact Playwright identity ${version}`, () => {
    try {
      buildRuntimeDependencySpec(rootPackage(version));
      throw new Error('expected buildRuntimeDependencySpec to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(CompilerError);
      expect((error as CompilerError).code).toBe('RUNTIME-DEPS-000');
      expect((error as Error).message).toContain('one exact numeric release');
    }
  });
}
