import { expect, test } from 'bun:test';
import { withAcquiredResource } from '../../../src/execution/resource-settlement.ts';

import { buildAffectedTestInventory } from '../../../src/adapters/verification/platform/test-impact/affected.ts';
import { selectSlowTestRiskClosure } from '../../../src/adapters/verification/platform/test-impact/slow-risk-selection.ts';
import { createRemovedDocumentationTestImpactFixture } from '../../helpers/test-impact-provider.ts';

const readme = 'src/adapters/providers/docker/README.md';

function withRemovedDocumentationFixture(
  use: (fixture: Awaited<ReturnType<typeof createRemovedDocumentationTestImpactFixture>>) => void,
  ...options: Parameters<typeof createRemovedDocumentationTestImpactFixture>
): Promise<void> {
  return withAcquiredResource({
    operationLabel: 'removed documentation assertions',
    resourceLabel: 'removed documentation fixture',
    acquire: () => createRemovedDocumentationTestImpactFixture(...options),
    use,
    release: fixture => fixture.dispose()
  });
}

test('an exact removed Markdown blob retains its compiler-issued module test responsibility', async () => {
  await withRemovedDocumentationFixture(fixture => {
    const result = selectSlowTestRiskClosure([readme], fixture.provider, fixture.transition);
    expect(result.resolved).toBe(true);
    expect(result.owners).toContain('adapters.providers.docker');
    expect(result.unresolvedPaths).toEqual([]);
    expect(buildAffectedTestInventory([readme], fixture.provider).selectedFastTests)
      .toEqual(['tests/unit/verification/trusted-runtime-container.test.ts']);
  });
});

test('removed Markdown ownership remains unresolved when its module descriptor changed', async () => {
  await withRemovedDocumentationFixture(fixture => {
    const result = selectSlowTestRiskClosure([readme], fixture.provider, fixture.transition);
    expect(result.resolved).toBe(false);
    expect(result.unresolvedPaths).toEqual([readme]);
  }, true);
});

test('a removed Markdown owner without a current test responsibility remains unresolved', async () => {
  await withRemovedDocumentationFixture(fixture => {
    const result = selectSlowTestRiskClosure([readme], fixture.provider, fixture.transition);
    expect(result.resolved).toBe(false);
    expect(result.unresolvedPaths).toEqual([readme]);
  }, false, false);
});
