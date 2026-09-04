import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { CompilerError } from '../../src/compiler/errors.ts';
import {
  OPAQUE_MODULE_MATERIALIZATION_MODES,
  opaqueModuleMaterializationEnvironment,
  resolveOpaqueModuleMaterializationMode,
  type OpaqueModuleMaterializationMode
} from '../../src/compiler/compose/opaque-module-materialization.ts';

const invalid = (error: unknown): boolean =>
  error instanceof CompilerError && error.code === 'OPAQUE-MODULE-004';

test('explicit materialization input rejects values forged past TypeScript', () => {
  for (const value of ['', 'production', 'BUILD-COPY', false, null, 0, {}, []]) {
    assert.throws(() => resolveOpaqueModuleMaterializationMode(
      value as OpaqueModuleMaterializationMode, {}
    ), invalid);
  }
});

test('valid explicit materialization does not observe irrelevant environment inputs', () => {
  let reads = 0;
  const environment = { get NODE_ENV(): string { reads++; throw new Error('must not read'); } };
  for (const mode of OPAQUE_MODULE_MATERIALIZATION_MODES) {
    assert.equal(resolveOpaqueModuleMaterializationMode(mode, environment), mode);
  }
  assert.equal(reads, 0);
});

test('legacy materialization keeps exact defaults, agreement and fail-closed conflicts', () => {
  assert.equal(resolveOpaqueModuleMaterializationMode(undefined, {}), 'workspace-link');
  assert.equal(resolveOpaqueModuleMaterializationMode(undefined, { NODE_ENV: 'production' }), 'build-copy');
  assert.equal(resolveOpaqueModuleMaterializationMode(undefined, { SEC_BUILD_MODE: 'false', BUILD_MODE: 'false' }), 'workspace-link');
  assert.equal(resolveOpaqueModuleMaterializationMode(undefined, { SEC_BUILD_MODE: 'true', BUILD_MODE: 'true' }), 'build-copy');
  assert.throws(() => resolveOpaqueModuleMaterializationMode(undefined, { NODE_ENV: 'production', BUILD_MODE: 'false' }), invalid);
  assert.throws(() => resolveOpaqueModuleMaterializationMode(undefined, { SEC_BUILD_MODE: 'true', BUILD_MODE: 'false' }), invalid);
  assert.throws(() => resolveOpaqueModuleMaterializationMode(undefined, { BUILD_MODE: 'TRUE' }), invalid);
});

test('materialization environment is an immutable observation rather than a live alias', () => {
  const input = { NODE_ENV: 'development', SEC_BUILD_MODE: 'false', UNRELATED: 'ignored' };
  const snapshot = opaqueModuleMaterializationEnvironment(input);
  input.NODE_ENV = 'production';
  input.SEC_BUILD_MODE = 'true';
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(snapshot.NODE_ENV, 'development');
  assert.equal(snapshot.SEC_BUILD_MODE, 'false');
  assert.equal(Object.hasOwn(snapshot, 'UNRELATED'), false);
});

test('materialization vocabulary cannot be mutated after consumers captured it', () => {
  assert.equal(Object.isFrozen(OPAQUE_MODULE_MATERIALIZATION_MODES), true);
  assert.equal(Reflect.set(OPAQUE_MODULE_MATERIALIZATION_MODES, '0', 'forged'), false);
  assert.equal(OPAQUE_MODULE_MATERIALIZATION_MODES[0], 'workspace-link');
});
