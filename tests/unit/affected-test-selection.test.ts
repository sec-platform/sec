import { afterAll, describe, expect, test } from 'bun:test';
import {
  hasTestImpactForFile
} from '../../src/verification/test-impact/runtime/impact.ts';
import { CodexDevelopmentCreateTestImpactTransitionObservation } from '../../src/verification/test-impact/runtime/transition.ts';
import { selectSlowTestRiskClosure } from '../../src/verification/test-impact/slow-risk-selection.ts';
import { acquireExactRepositoryTestImpactProviderFixture } from '../helpers/test-impact-provider.ts';

const testImpactFixture = await acquireExactRepositoryTestImpactProviderFixture();
const provider = testImpactFixture.provider;
afterAll(() => testImpactFixture.dispose());
const resolvedSource = 'src/compiler/verify/run-runtime-verification.ts';

describe('affected test selection batch optimization', () => {
  test('slow-test risk closure resolves files with known test impact', () => {
    const result = selectSlowTestRiskClosure([resolvedSource], provider);
    expect(result.resolved).toBe(true);
  });

  test('owner-issued projection maps a source change to the canonical slow suite', () => {
    const result = selectSlowTestRiskClosure([
      'src/compiler/verify/run-runtime-verification.ts'
    ], provider);
    expect(result.resolved).toBe(true);
    expect(result.affectedSlowTests).toContain('tests/e2e/dry-run-plan.test.ts');
    expect(result.suites).toContain('e2e-dry-run-plan');
  });

  test('managed git hooks reuse their Source Program entrypoint and owner consumer closure', () => {
    const result = selectSlowTestRiskClosure(['.githooks/post-merge'], provider);
    expect(result.resolved).toBe(true);
    expect(result.owners).toContain('development.hooks');
    expect(result.affectedSlowTests).toContain('tests/e2e/install-git-hooks.test.ts');
    expect(result.suites).toContain('e2e-install-git-hooks');
  });

  test('slow-test risk closure marks unresolved files without test impact', () => {
    // A fixtures path is not a test impact source (classifyTestImpactSource
    // returns null for fixtures/) and matches no declaration/fallback → unresolved.
    const result = selectSlowTestRiskClosure(['fixtures/nonexistent-affected-test.txt'], provider);
    expect(result.resolved).toBe(false);
    expect(result.unresolvedPaths).toEqual(['fixtures/nonexistent-affected-test.txt']);
  });

  test('slow-test risk closure handles multiple files in batch', () => {
    // Multiple files with known impact should all resolve.
    const result = selectSlowTestRiskClosure([
      resolvedSource,
      'src/compiler/verify/run-runtime-verification.ts'
    ], provider);
    expect(result.resolved).toBe(true);
  });

  test('test-impact resolution is consistent with slow-risk closure resolution', () => {
    // The batch selection and the single-source query must consume the same
    // owner-issued projection instead of compiling independent source graphs.
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

  test('slow-test risk closure resolves when all files have known impact', () => {
    // Mix a semantic source kind with a module-graph-derived file.
    const result = selectSlowTestRiskClosure([
      'package.json',
      resolvedSource
    ], provider);
    expect(result.resolved).toBe(true);
    // The overall inventory should have been computed once (batch), and
    // per-file resolution done via hasTestImpactForFile (reverse-map lookup).
    expect(result.owners.length).toBeGreaterThan(0);
  });

  test('compile-only test project inputs resolve without inventing runtime tests', () => {
    for (const sourcePath of [
      'tests/unit/architecture-contracts.typecheck.ts',
      'tests/unit/workspace-action.typecheck.ts'
    ]) {
      const result = selectSlowTestRiskClosure([sourcePath], provider);
      expect(result.resolved).toBe(true);
      expect(result.unresolvedPaths).toEqual([]);
      expect(result.slowTests).toEqual([]);
    }
  });

  test('typecheck spelling cannot resolve an arbitrary or absent source', () => {
    for (const sourcePath of [
      'src/compiler/foreign.typecheck.ts',
      'tests/unit/absent.typecheck.ts'
    ]) {
      const result = selectSlowTestRiskClosure([sourcePath], provider);
      expect(result.resolved).toBe(false);
      expect(result.unresolvedPaths).toEqual([sourcePath]);
    }
  });

  test('unregistered deleted or renamed slow paths remain typed-unresolved', () => {
    // The e2e naming convention alone does not identify a canonical slow
    // suite. A path that is absent from the immutable suite registry must not
    // become a free-running slow child after a delete/rename transition.
    const result = selectSlowTestRiskClosure(['tests/e2e/deleted-unknown.test.ts'], provider);
    expect(result.resolved).toBe(false);
    expect(result.owners).toContain('bounded-slow-risk');
    expect(result.reasons).toContain('changed-files-unresolved');
    expect(result.slowTests).toEqual(['tests/e2e/deleted-unknown.test.ts']);
    expect(result.unresolvedPaths).toEqual(['tests/e2e/deleted-unknown.test.ts']);
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
    const result = selectSlowTestRiskClosure([
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
    expect(result.unresolvedPaths).toEqual([]);
  });
});
