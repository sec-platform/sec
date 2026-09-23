import { expect, test } from 'bun:test';

import {
  assertDependencyCapabilityClosure
} from '../../src/adapters/toolchain/dependencies/contract/dependency-capability-contract.ts';
import { readCompilerPackageJson } from '../helpers/compiler-fixtures.ts';

test('the runtime dependency projection exactly covers the root package manifest', async () => {
  const manifest = await readCompilerPackageJson();
  expect(() => assertDependencyCapabilityClosure(manifest)).not.toThrow();
});
