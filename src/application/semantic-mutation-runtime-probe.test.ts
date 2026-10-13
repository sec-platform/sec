import { expect, test } from 'bun:test';
import { assertIsolatedStagingTree } from '../adapters/verification/assert-isolated-staging-tree.ts';
import { probePreparedSemanticMutationRuntime } from './semantic-mutation-runtime-probe.ts';

test('invalid native staging admission cannot ensure dependencies or probe runtime', async () => {
  let ensureCalls = 0;
  let probeCalls = 0;
  const result = await probePreparedSemanticMutationRuntime({
    stagingWorkspaceRoot: process.cwd(),
    admitStagingWorkspace: assertIsolatedStagingTree,
    async ensureCompilerReady() { ensureCalls += 1; },
    async probeRuntime() { probeCalls += 1; return { status: 'available' }; }
  });
  expect(result.status).toBe('unavailable');
  expect(ensureCalls).toBe(0);
  expect(probeCalls).toBe(0);
});

test('admitted staging ensures dependencies before the original native probe', async () => {
  const order: string[] = [];
  const result = await probePreparedSemanticMutationRuntime({
    stagingWorkspaceRoot: 'admitted-staging',
    async admitStagingWorkspace(root) { expect(root).toBe('admitted-staging'); order.push('admit'); },
    async ensureCompilerReady() { order.push('ensure'); },
    async probeRuntime(root) { expect(root).toBe('admitted-staging'); order.push('probe'); return { status: 'available' }; }
  });
  expect(order).toEqual(['admit', 'ensure', 'probe']);
  expect(result.status).toBe('available');
});

test('dependency failure cannot start a runtime probe', async () => {
  let probeCalls = 0;
  const result = await probePreparedSemanticMutationRuntime({
    stagingWorkspaceRoot: 'admitted-staging',
    async admitStagingWorkspace() {},
    async ensureCompilerReady() { throw new Error('dependency owner blocked'); },
    async probeRuntime() { probeCalls += 1; return { status: 'available' }; }
  });
  expect(result.status).toBe('unavailable');
  expect(probeCalls).toBe(0);
});
