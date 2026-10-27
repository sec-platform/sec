import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { resolveOpaqueModuleMaterializationMode } from '../../../src/compiler/target-materialization.ts';
import { CodedFailure } from '../../../src/contracts/failure.ts';

const invalid = (error: unknown): boolean =>
  error instanceof CodedFailure && error.code === 'OPAQUE-MODULE-004';

test('legacy materialization keeps exact defaults, agreement and fail-closed conflicts', () => {
  assert.equal(resolveOpaqueModuleMaterializationMode(undefined, {}), 'workspace-link');
  assert.equal(resolveOpaqueModuleMaterializationMode(undefined, { NODE_ENV: 'production' }), 'build-copy');
  assert.equal(resolveOpaqueModuleMaterializationMode(undefined, { SEC_BUILD_MODE: 'false', BUILD_MODE: 'false' }), 'workspace-link');
  assert.equal(resolveOpaqueModuleMaterializationMode(undefined, { SEC_BUILD_MODE: 'true', BUILD_MODE: 'true' }), 'build-copy');
  assert.throws(() => resolveOpaqueModuleMaterializationMode(undefined, { NODE_ENV: 'production', BUILD_MODE: 'false' }), invalid);
  assert.throws(() => resolveOpaqueModuleMaterializationMode(undefined, { NODE_ENV: 'production', SEC_BUILD_MODE: 'false' }),
    (error: unknown) => invalid(error) && /materialization inputs conflict/.test((error as Error).message));
  assert.throws(() => resolveOpaqueModuleMaterializationMode(undefined, { SEC_BUILD_MODE: 'true', BUILD_MODE: 'false' }), invalid);
  assert.throws(() => resolveOpaqueModuleMaterializationMode(undefined, { SEC_BUILD_MODE: '1' }),
    (error: unknown) => invalid(error) && /must be exactly "true" or "false"/.test((error as Error).message));
});
