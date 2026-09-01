import { afterAll, describe, expect, test } from 'bun:test';
import { selectCiSlowTestClosure } from '../../src/verification/ci/runtime/slow-test-selection.ts';
import { hasTestImpactForFile } from '../../src/verification/test-impact/runtime/impact.ts';
import { CodexDevelopmentCreateTestImpactTransitionObservation } from '../../src/verification/test-impact/runtime/transition.ts';
import { acquireExactRepositoryTestImpactProviderFixture } from '../helpers/test-impact-provider.ts';

const testImpactFixture = await acquireExactRepositoryTestImpactProviderFixture();
const provider = testImpactFixture.provider;
afterAll(() => testImpactFixture.dispose());
const resolvedSource = 'src/verification/ci/runtime/slow-test-selection.ts';

describe('affected test selection batch optimization', () => {
  test('selectCiSlowTestClosure resolves files with known test impact', () => {
    const result = selectCiSlowTestClosure([resolvedSource], provider);
    expect(result.resolved).toBe(true);
  });

  test('owner-issued projection maps a source change to the canonical slow suite', () => {
    const result = selectCiSlowTestClosure([
      'src/compiler/verify/run-runtime-verification.ts'
    ], provider);
    expect(result.resolved).toBe(true);
    expect(result.affectedSlowTests).toContain('tests/e2e/dry-run-plan.test.ts');
    expect(result.suites).toContain('e2e-dry-run-plan');
  });

  test('selectCiSlowTestClosure marks unresolved files without test impact', () => {
    // A fixtures path is not a test impact source (classifyTestImpactSource
    // returns null for fixtures/) and matches no declaration/fallback → unresolved.
    const result = selectCiSlowTestClosure(['fixtures/nonexistent-affected-test.txt'], provider);
    expect(result.resolved).toBe(false);
  });

  test('selectCiSlowTestClosure handles multiple files in batch', () => {
    // Multiple files with known impact should all resolve.
    const result = selectCiSlowTestClosure([
      resolvedSource,
      'src/compiler/verify/run-runtime-verification.ts'
    ], provider);
    expect(result.resolved).toBe(true);
  });

  test('hasTestImpactForFile is consistent with selectCiSlowTestClosure resolution', () => {
    // The batch optimization in slow-test-selection uses hasTestImpactForFile
    // instead of per-file CodexDevelopmentBuildAffectedTestInventoryV1. Verify
    // the two are consistent for resolved and unresolved files.
    const resolvedFile = resolvedSource;
    expect(hasTestImpactForFile(resolvedFile, provider)).toBe(true);

    const unresolvedFile = 'fixtures/nonexistent-affected-test.txt';
    expect(hasTestImpactForFile(unresolvedFile, provider)).toBe(false);
  });

  test('unowned prospective paths remain unresolved instead of inheriting a directory fallback', () => {
    expect(hasTestImpactForFile('platform/shared/new-owner.ts', provider)).toBe(false);
    expect(hasTestImpactForFile('src/development/tooling/new-runtime-owner.ts', provider)).toBe(false);
    expect(hasTestImpactForFile('scripts/codex/new-control-sink.ts', provider)).toBe(false);
  });

  test('selectCiSlowTestClosure resolves when all files have known impact', () => {
    // Mix a semantic source kind with a module-graph-derived file.
    const result = selectCiSlowTestClosure([
      'src/compiler/verify/run-runtime-verification.ts',
      resolvedSource
    ], provider);
    expect(result.resolved).toBe(true);
    // The overall inventory should have been computed once (batch), and
    // per-file resolution done via hasTestImpactForFile (reverse-map lookup).
    expect(result.owners.length).toBeGreaterThan(0);
  });

  test('unregistered deleted or renamed slow paths remain typed-unresolved', () => {
    // The e2e naming convention alone does not identify a canonical slow
    // suite. A path that is absent from the immutable suite registry must not
    // become a free-running slow child after a delete/rename transition.
    const result = selectCiSlowTestClosure(['tests/e2e/deleted-unknown.test.ts'], provider);
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
    const result = selectCiSlowTestClosure([
      'tests/e2e/old-graph-name.test.ts',
      'tests/e2e/graph.test.ts'
    ], provider, transition);

    expect(result.resolved).toBe(true);
    expect(result.suites).toEqual(['e2e-graph']);
    expect(result.slowTests).toEqual([]);
    expect(result.affectedSlowTests).toEqual([
      'tests/e2e/graph.test.ts',
      'tests/e2e/old-graph-name.test.ts'
    ]);
  });
});
