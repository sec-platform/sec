import { expect, test } from 'bun:test';

import { buildAffectedTestInventory } from '../../../src/adapters/verification/platform/test-impact/affected.ts';
import { selectSlowTestRiskClosure } from '../../../src/adapters/verification/platform/test-impact/slow-risk-selection.ts';
import { createRemovedDocumentationTestImpactFixture } from '../../helpers/test-impact-provider.ts';

const readme = 'src/adapters/providers/docker/README.md';

test('an exact removed Markdown blob retains its compiler-issued module test responsibility', async () => {
  const fixture = await createRemovedDocumentationTestImpactFixture();
  try {
    const result = selectSlowTestRiskClosure([readme], fixture.provider, fixture.transition);
    expect(result.resolved).toBe(true);
    expect(result.owners).toContain('adapters.providers.docker');
    expect(result.unresolvedPaths).toEqual([]);
    expect(buildAffectedTestInventory([readme], fixture.provider).selectedFastTests)
      .toEqual(['tests/unit/verification/trusted-runtime-container.test.ts']);
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
