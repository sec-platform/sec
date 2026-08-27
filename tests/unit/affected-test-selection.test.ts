import { describe, expect, test } from 'bun:test';

import { selectCiPrRiskSlowSuites } from '../../platform/shared/ci-pr-risk-selection.ts';
import { hasTestImpactForFile } from '../../platform/shared/test-impact-contract.ts';

describe('affected test selection batch optimization', () => {
  test('selectCiPrRiskSlowSuites resolves files with known test impact', () => {
    // platform/shared/test-impact-contract.ts matches a fallback rule
    // (owner: 'test-impact') → hasTestImpactForFile returns true → resolved.
    const result = selectCiPrRiskSlowSuites(['platform/shared/test-impact-contract.ts']);
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
      'platform/shared/test-impact-contract.ts',
      'platform/shared/collections.ts'
    ]);
    expect(result.resolved).toBe(true);
  });

  test('hasTestImpactForFile is consistent with selectCiPrRiskSlowSuites resolution', () => {
    // The batch optimization in ci-pr-risk-selection uses hasTestImpactForFile
    // instead of per-file CodexDevelopmentBuildAffectedTestInventoryV1. Verify
    // the two are consistent for resolved and unresolved files.
    const resolvedFile = 'platform/shared/test-impact-contract.ts';
    expect(hasTestImpactForFile(resolvedFile)).toBe(true);

    const unresolvedFile = 'fixtures/nonexistent-affected-test.txt';
    expect(hasTestImpactForFile(unresolvedFile)).toBe(false);
  });

  test('physical placement universes remain resolved before reverse imports exist', () => {
    expect(hasTestImpactForFile('platform/shared/new-owner.ts')).toBe(true);
    expect(hasTestImpactForFile('tooling/sec-dev/new-runtime-owner.ts')).toBe(true);
    expect(hasTestImpactForFile('scripts/codex/worktree-physical-closeout-contract.ts')).toBe(true);
    expect(hasTestImpactForFile('docs/scripts/docs-doctor.ts')).toBe(true);
  });

  test('selectCiPrRiskSlowSuites resolves when all files have known impact', () => {
    // Mix of fallback-matched and module-graph-derived files.
    const result = selectCiPrRiskSlowSuites([
      'platform/shared/test-impact-contract.ts',
      'platform/shared/ci-pr-risk-selection.ts'
    ]);
    expect(result.resolved).toBe(true);
    // The overall inventory should have been computed once (batch), and
    // per-file resolution done via hasTestImpactForFile (reverse-map lookup).
    expect(result.owners.length).toBeGreaterThan(0);
  });
});
