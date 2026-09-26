import { expect, test } from 'bun:test';

import {
  assertOperationDemandGraph,
  compileOperationDemandGraph
} from '../../src/adapters/self-hosting/control/operation/demand.ts';

test('one demand compiler derives terminal transition and no ambient execution capability', () => {
  const graph = compileOperationDemandGraph({
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

test('all executable operations derive the same compiler dependency capability', () => {
  const processIsolatedOperations = new Set([
    'test-direct-ambiguous',
    'test-direct-fast',
    'test-fast',
    'test-full'
  ]);
  for (const operation of [
    'check-affected',
    'check-fast',
    'imports-apply',
    'imports-check',
    'imports-freeze',
    'test-fast',
    'test-direct-fast',
    'test-slow',
    'test-full',
    'test-direct-slow',
    'test-direct-ambiguous',
    'typecheck'
  ] as const) {
    const graph = compileOperationDemandGraph({ operation, terminalWorkIds: [] });
    expect(graph.capabilityDemands).toEqual(['compiler-dependency-tree']);
    if (processIsolatedOperations.has(operation)) {
      expect(graph.verificationObligations).toContain('test-process-isolation');
    } else {
      expect(graph.verificationObligations).not.toContain('test-process-isolation');
    }
  }
});

test('dependency setup is the only operation that can demand managed Git hooks', () => {
  const setup = compileOperationDemandGraph({
    operation: 'dependency-setup',
    terminalWorkIds: [],
    hookPolicy: 'always'
  });
  expect(setup.capabilityDemands).toEqual([
    'compiler-dependency-tree',
    'managed-git-hooks'
  ]);
  expect(setup.verificationObligations).toContain('git-hook-lifecycle');

  const nestedHook = compileOperationDemandGraph({
    operation: 'dependency-setup',
    terminalWorkIds: [],
    hookPolicy: 'never'
  });
  expect(nestedHook.capabilityDemands).toEqual(['compiler-dependency-tree']);
  expect(nestedHook.verificationObligations).not.toContain('git-hook-lifecycle');
});

test('demand identity is order-independent and forged ambient demand is rejected', () => {
  const graph = compileOperationDemandGraph({
    operation: 'work-selection-observe',
    terminalWorkIds: ['issue-271', 'issue-186']
  });
  const reordered = compileOperationDemandGraph({
    operation: 'work-selection-observe',
    terminalWorkIds: ['issue-186', 'issue-271']
  });
  expect(reordered).toEqual(graph);

  expect(() => assertOperationDemandGraph({
    ...graph,
    capabilityDemands: ['compiler-dependency-tree']
  })).toThrow('differs from the canonical compiler output');
});
