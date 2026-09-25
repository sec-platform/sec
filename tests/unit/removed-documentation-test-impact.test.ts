import { expect, test } from 'bun:test';

import { BuildAffectedTestInventory } from '../../src/adapters/verification/platform/test-impact/affected.ts';
import { createRepositoryTestImpactSourceProvider } from '../../src/adapters/verification/platform/test-impact/runtime/impact.ts';
import { CreateTestImpactTransitionObservation } from '../../src/adapters/verification/platform/test-impact/runtime/transition.ts';
import { selectSlowTestRiskClosure } from '../../src/adapters/verification/platform/test-impact/slow-risk-selection.ts';
import { createRemovedDocumentationTestImpactFixture } from '../helpers/test-impact-provider.ts';

const readme = 'src/adapters/providers/docker/README.md';

test('an exact removed Markdown blob retains its compiler-issued module test responsibility', async () => {
  const fixture = await createRemovedDocumentationTestImpactFixture();
  try {
    const result = selectSlowTestRiskClosure([readme], fixture.provider, fixture.transition);
    expect(result.resolved).toBe(true);
    expect(result.owners).toContain('adapters.providers.docker');
    expect(result.unresolvedPaths).toEqual([]);
    expect(BuildAffectedTestInventory([readme], fixture.provider).selectedFastTests)
      .toEqual(['tests/unit/trusted-runtime-container.test.ts']);
  } finally {
    fixture.dispose();
  }
});

test('removed Markdown ownership remains unresolved when its module descriptor changed', async () => {
  const fixture = await createRemovedDocumentationTestImpactFixture(true);
  try {
    const result = selectSlowTestRiskClosure([readme], fixture.provider, fixture.transition);
    expect(result.resolved).toBe(false);
    expect(result.unresolvedPaths).toEqual([readme]);
  } finally {
    fixture.dispose();
  }
});

test('a removed Markdown owner without a current test responsibility remains unresolved', async () => {
  const fixture = await createRemovedDocumentationTestImpactFixture(false, false);
  try {
    const result = selectSlowTestRiskClosure([readme], fixture.provider, fixture.transition);
    expect(result.resolved).toBe(false);
    expect(result.unresolvedPaths).toEqual([readme]);
  } finally {
    fixture.dispose();
  }
});

test('a transition DTO cannot be spliced onto an issued Source Program projection', async () => {
  const fixture = await createRemovedDocumentationTestImpactFixture();
  try {
    const mismatchedTransition = CreateTestImpactTransitionObservation({
      baseSha: fixture.transition.baseSha,
      headSha: 'f'.repeat(40),
      records: [{ status: 'removed', path: readme }],
      readPathBlob: (revision, repositoryPath) => (
        revision === fixture.transition.baseSha && repositoryPath === readme
          ? {
              mode: fixture.transition.removedPathBlobs[0]!.baseMode,
              blobSha: fixture.transition.removedPathBlobs[0]!.baseBlobSha
            }
          : null
      )
    });
    expect(() => createRepositoryTestImpactSourceProvider({
      projection: fixture.provider.projection,
      testInventory: fixture.provider.testInventory,
      activeDocumentationPaths: [],
      transition: mismatchedTransition
    } as unknown as Parameters<typeof createRepositoryTestImpactSourceProvider>[0]))
      .toThrow('owner-issued Git/source composition');
  } finally {
    fixture.dispose();
  }
});
