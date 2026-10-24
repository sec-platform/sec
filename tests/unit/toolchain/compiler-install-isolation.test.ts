import { expect, test } from 'bun:test';
import {
  COMPILER_DEPENDENCY_INSTALL_ARGS,
  compilerInstallConfigSha256
} from '../../../src/adapters/toolchain/dependencies/runtime/compiler-materialization-input.ts';

test('compiler installation requires independent files and binds this policy into generation identity', () => {
  expect(COMPILER_DEPENDENCY_INSTALL_ARGS).toEqual([
    'install', '--frozen-lockfile', '--ignore-scripts', '--backend=copyfile'
  ]);
  expect(Object.isFrozen(COMPILER_DEPENDENCY_INSTALL_ARGS)).toBe(true);
  // Independent fixed SHA-256 of the canonical UTF-8 input:
  // {"argv":["install","--frozen-lockfile","--ignore-scripts","--backend=copyfile"],"install":null}
  expect(compilerInstallConfigSha256(null)).toBe(
    '7adc8f65376e6b966462784612b15f4c749f3c522ba6df29b1182563a5bb2495'
  );
});
