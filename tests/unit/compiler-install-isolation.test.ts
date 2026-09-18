import { expect, test } from 'bun:test';
import { canonicalJson, digest } from '../../src/contracts/canonical.ts';
import {
  COMPILER_DEPENDENCY_INSTALL_ARGS,
  compilerInstallConfigSha256
} from '../../src/adapters/toolchain/dependencies/runtime/compiler-materialization-input.ts';

test('compiler installation requires independent files and binds this policy into generation identity', () => {
  expect(COMPILER_DEPENDENCY_INSTALL_ARGS).toEqual([
    'install', '--frozen-lockfile', '--ignore-scripts', '--backend=copyfile'
  ]);
  expect(Object.isFrozen(COMPILER_DEPENDENCY_INSTALL_ARGS)).toBe(true);
  expect(compilerInstallConfigSha256(null)).not.toBe(digest(JSON.stringify(canonicalJson({ install: null }))));
  expect(compilerInstallConfigSha256(null)).toBe(digest(JSON.stringify(canonicalJson({
    install: null, argv: COMPILER_DEPENDENCY_INSTALL_ARGS
  }))));
});
