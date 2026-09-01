import { expect, test } from 'bun:test';

import {
  consumeRuntimeDependencyTestMaterialization,
  issueRuntimeDependencyTestMaterialization,
  type RuntimeDependencyTestMaterializationCapability
} from './materialization-fixture-capability.ts';

test('dependency test materialization accepts only the exact owner-issued capability', async () => {
  const capability = issueRuntimeDependencyTestMaterialization(async (request) => ({
    code: 0,
    stderr: '',
    stdout: `${request.cwd}:${request.args.join(',')}:${request.timeoutMs}`
  }));

  await expect(consumeRuntimeDependencyTestMaterialization(capability, {
    args: ['install'],
    cwd: 'fixture-root',
    timeoutMs: 250
  })).resolves.toEqual({
    code: 0,
    stderr: '',
    stdout: 'fixture-root:install:250'
  });

  await expect(consumeRuntimeDependencyTestMaterialization(
    Object.freeze({}) as RuntimeDependencyTestMaterializationCapability,
    { args: [], cwd: 'fixture-root', timeoutMs: 250 }
  )).rejects.toMatchObject({
    code: 'RUNTIME-DEPS-004',
    message: 'Compiler dependency test materialization requires an owner-issued capability'
  });
});
