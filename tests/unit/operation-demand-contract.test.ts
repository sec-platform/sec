import { expect, test } from 'bun:test';

import {
  assertSecOperationDemandGraphV1,
  compileSecOperationDemandGraphV1
} from '../../platform/shared/operation-demand-contract.ts';

test('one demand compiler derives terminal transition and no ambient execution capability', () => {
  const graph = compileSecOperationDemandGraphV1({
    operation: 'work-selection-observe',
    terminalWorkIds: ['issue-271', 'issue-186']
  });

  expect(graph.input.terminalWorkIds).toEqual(['issue-186', 'issue-271']);
  expect(graph.transitionDemands).toEqual(['roadmap-terminal-compaction']);
  expect(graph.capabilityDemands).toEqual([]);
  expect(graph.verificationObligations).toEqual([
    'operation-demand-integrity',
    'roadmap-terminal-topology'
  ]);
});

test('the same demand compiler keeps browser absent from compiler-only operations', () => {
  for (const operation of [
    'check-affected',
    'check-fast',
    'imports-apply',
    'imports-check',
    'imports-freeze',
    'test-fast',
    'test-direct-fast',
    'test-contract-freeze',
    'typecheck'
  ] as const) {
    const graph = compileSecOperationDemandGraphV1({ operation, terminalWorkIds: [] });
    expect(graph.capabilityDemands).toEqual(['compiler-dependency-tree']);
    expect(graph.verificationObligations).not.toContain('browser-runtime-materialization');
    if (operation.startsWith('test-')) {
      expect(graph.verificationObligations).toContain('test-process-isolation');
    }
  }
});

test('browser is materialized only for operations whose selected execution can consume it', () => {
  for (const operation of [
    'test-slow',
    'test-full',
    'test-direct-slow',
    'test-direct-ambiguous'
  ] as const) {
    const graph = compileSecOperationDemandGraphV1({ operation, terminalWorkIds: [] });
    expect(graph.capabilityDemands).toEqual(['browser-runtime', 'compiler-dependency-tree']);
    expect(graph.verificationObligations).toContain('browser-runtime-materialization');
  }
});

test('dependency setup is the only operation that can demand managed Git hooks', () => {
  const setup = compileSecOperationDemandGraphV1({
    operation: 'dependency-setup',
    terminalWorkIds: [],
    hookPolicy: 'always'
  });
  expect(setup.capabilityDemands).toEqual([
    'compiler-dependency-tree',
    'managed-git-hooks'
  ]);
  expect(setup.verificationObligations).toContain('git-hook-lifecycle');

  const nestedHook = compileSecOperationDemandGraphV1({
    operation: 'dependency-setup',
    terminalWorkIds: [],
    hookPolicy: 'never'
  });
  expect(nestedHook.capabilityDemands).toEqual(['compiler-dependency-tree']);
  expect(nestedHook.verificationObligations).not.toContain('git-hook-lifecycle');
});

test('demand identity is order-independent and forged ambient demand is rejected', () => {
  const graph = compileSecOperationDemandGraphV1({
    operation: 'work-selection-observe',
    terminalWorkIds: ['issue-271', 'issue-186']
  });
  const reordered = compileSecOperationDemandGraphV1({
    operation: 'work-selection-observe',
    terminalWorkIds: ['issue-186', 'issue-271']
  });
  expect(reordered).toEqual(graph);

  expect(() => assertSecOperationDemandGraphV1({
    ...graph,
    capabilityDemands: ['browser-runtime']
  })).toThrow('differs from the canonical compiler output');
});
