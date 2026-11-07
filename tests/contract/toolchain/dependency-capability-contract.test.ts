import { expect, test } from 'bun:test';

import {
  assertDependencyCapabilityClosure
} from '../../../src/adapters/toolchain/dependencies/contract/dependency-capability-contract.ts';
import { readCompilerPackageJson } from '../../helpers/compiler-fixtures.ts';

test('the runtime dependency projection exactly covers the root package manifest', async () => {
  const manifest = await readCompilerPackageJson();
  // A passing source manifest alone cannot detect a disabled validator. Keep
  // the source-backed success plus independently constructed negative inputs.
  expect(manifest.dependencies).toHaveProperty('commander');
  expect(manifest.dependencies).toHaveProperty('yaml');
  expect(manifest.devDependencies).toHaveProperty('typescript');
  expect(() => assertDependencyCapabilityClosure(manifest)).not.toThrow();

  const withoutYaml = { ...manifest.dependencies };
  delete withoutYaml.yaml;
  const withUnknown = {
    ...manifest.dependencies, 'unowned-fixture-package': '0.0.0'
  };
  const inWrongSection = { ...manifest.dependencies, typescript: manifest.devDependencies!.typescript };
  const withoutTypeScript = { ...manifest.devDependencies };
  delete withoutTypeScript.typescript;
  for (const mutated of [
    { ...manifest, dependencies: withoutYaml },
    { ...manifest, dependencies: withUnknown },
    { ...manifest, dependencies: inWrongSection, devDependencies: withoutTypeScript }
  ]) {
    expect(() => assertDependencyCapabilityClosure(mutated))
      .toThrow(/differs from package\.json/u);
  }
  expect(() => assertDependencyCapabilityClosure({
    ...manifest, trustedDependencies: ['untrusted-fixture-package']
  })).toThrow(/must not grant install-script trust/u);
});
