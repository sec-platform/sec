import { describe, expect, test } from 'bun:test';

import { CodexDevelopmentCreateTestImpactTransitionObservation } from '../../src/verification/test-impact/runtime/transition.ts';
import { selectCiPrRiskSlowSuites } from '../../src/verification/ci/runtime/pr-risk-selection.ts';
import { hasTestImpactForFile } from '../../src/verification/test-impact/runtime/impact.ts';

describe('affected test selection batch optimization', () => {
  test('selectCiPrRiskSlowSuites resolves files with known test impact', () => {
    const result = selectCiPrRiskSlowSuites(['source/model/example.plan.yaml']);
    expect(result.resolved).toBe(true);
  });

  test('selectCiPrRiskSlowSuites marks unresolved files without test impact', () => {
    // A fixtures path is not a test impact source (classifyTestImpactSource
    // returns null for fixtures/) and matches no declaration/fallback → unresolved.
    const result = selectCiPrRiskSlowSuites(['fixtures/nonexistent-affected-test.txt']);
    expect(result.resolved).toBe(false);
  });

  test('selectCiPrRiskSlowSuites handles multiple files in batch', () => {
    // Multiple files with known impact should all resolve.
    const result = selectCiPrRiskSlowSuites([
      'source/model/example.plan.yaml',
      'catalog/registry/official/example/block.manifest.yaml'
    ]);
    expect(result.resolved).toBe(true);
  });

  test('hasTestImpactForFile is consistent with selectCiPrRiskSlowSuites resolution', () => {
    // The batch optimization in ci-pr-risk-selection uses hasTestImpactForFile
    // instead of per-file CodexDevelopmentBuildAffectedTestInventoryV1. Verify
    // the two are consistent for resolved and unresolved files.
    const resolvedFile = 'source/model/example.plan.yaml';
    expect(hasTestImpactForFile(resolvedFile)).toBe(true);

    const unresolvedFile = 'fixtures/nonexistent-affected-test.txt';
    expect(hasTestImpactForFile(unresolvedFile)).toBe(false);
  });

  test('unowned prospective paths remain unresolved instead of inheriting a directory fallback', () => {
    expect(hasTestImpactForFile('platform/shared/new-owner.ts')).toBe(false);
    expect(hasTestImpactForFile('src/development/tooling/new-runtime-owner.ts')).toBe(false);
    expect(hasTestImpactForFile('scripts/codex/new-control-sink.ts')).toBe(false);
  });

  test('selectCiPrRiskSlowSuites resolves when all files have known impact', () => {
    // Mix a semantic source kind with a module-graph-derived file.
    const result = selectCiPrRiskSlowSuites([
      'source/model/example.plan.yaml',
      'src/verification/ci/runtime/pr-risk-selection.ts'
    ]);
    expect(result.resolved).toBe(true);
    // The overall inventory should have been computed once (batch), and
    // per-file resolution done via hasTestImpactForFile (reverse-map lookup).
    expect(result.owners.length).toBeGreaterThan(0);
  });

  test('unregistered deleted or renamed slow paths remain typed-unresolved', () => {
    // The e2e naming convention alone does not identify a canonical slow
    // suite. A path that is absent from the immutable suite registry must not
    // become a free-running slow child after a delete/rename transition.
    const result = selectCiPrRiskSlowSuites(['tests/e2e/deleted-unknown.test.ts']);
    expect(result.resolved).toBe(false);
    expect(result.owners).toContain('bounded-slow-risk');
    expect(result.reasons).toContain('changed-files-unresolved');
    expect(result.slowTests).toEqual(['tests/e2e/deleted-unknown.test.ts']);
  });

  test('renamed slow paths retain the canonical successor suite without becoming runnable', () => {
    const transition = CodexDevelopmentCreateTestImpactTransitionObservation({
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
      records: [{
        status: 'renamed',
        previousPath: 'tests/e2e/old-graph-name.test.ts',
        path: 'tests/e2e/graph.test.ts'
      }],
      readPathBlob: () => null
    });
    const result = selectCiPrRiskSlowSuites([
      'tests/e2e/old-graph-name.test.ts',
      'tests/e2e/graph.test.ts'
    ], undefined, transition);

    expect(result.resolved).toBe(true);
    expect(result.suites).toEqual(['e2e-graph']);
    expect(result.slowTests).toEqual([]);
    expect(result.affectedSlowTests).toEqual([
      'tests/e2e/graph.test.ts',
      'tests/e2e/old-graph-name.test.ts'
    ]);
  });
});
