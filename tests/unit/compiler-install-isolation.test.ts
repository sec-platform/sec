import { expect, test } from 'bun:test';
import {
  COMPILER_DEPENDENCY_INSTALL_ARGS,
  compilerInstallConfigSha256
} from '../../src/adapters/toolchain/dependencies/runtime/compiler-materialization-input.ts';
import { canonicalJson, rawSha256Hex } from '../../src/contracts/canonical.ts';

test('compiler installation requires independent files and binds this policy into generation identity', () => {
  expect(Object.isFrozen(COMPILER_DEPENDENCY_INSTALL_ARGS)).toBe(true);
  expect(COMPILER_DEPENDENCY_INSTALL_ARGS.length).toBeGreaterThan(1);
  expect(new Set(COMPILER_DEPENDENCY_INSTALL_ARGS).size).toBe(COMPILER_DEPENDENCY_INSTALL_ARGS.length);
  expect(COMPILER_DEPENDENCY_INSTALL_ARGS.every((argument) => argument.length > 0)).toBe(true);
  expect(compilerInstallConfigSha256(null)).not.toBe(rawSha256Hex(JSON.stringify(canonicalJson({ install: null }))));
  expect(compilerInstallConfigSha256(null)).toBe(rawSha256Hex(JSON.stringify(canonicalJson({
    install: null, argv: COMPILER_DEPENDENCY_INSTALL_ARGS
  }))));
});
