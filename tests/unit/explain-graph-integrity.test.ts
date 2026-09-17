import { expect, test } from 'bun:test';

import { buildExplainGraph } from '../../src/adapters/compilation/emit/write-explain-graph.ts';
import type { AcceptanceCoverageReport } from '../../src/assurance/acceptance/coverage.ts';
import type { ViewEdge, ViewNode } from '../../src/semantics/projection/types.ts';
import type { ProvenanceFile } from '../../src/semantics/provenance/types.ts';
import { buildReviewLock } from '../helpers/review-fixtures.ts';
import { buildSemanticViewFixture } from '../helpers/semantic-view-fixtures.ts';

const EMPTY_PROVENANCE: ProvenanceFile = {
  formatVersion: '1',
  artifacts: []
};

const EMPTY_COVERAGE: AcceptanceCoverageReport = {
  formatVersion: '1',
  status: 'passed',
  acceptancePassed: [],
  blocks: [],
  uncoveredBlocks: []
};

function node(id: string, label = id, entityKind: ViewNode['entityKind'] = 'entity'): ViewNode {
  return {
    id,
    entityId: id,
    entityKind,
    label,
    badges: [],
    references: []
  };
}

function lockWithProjection(nodes: ViewNode[], edges: ViewEdge[] = []) {
  const semanticViews = buildSemanticViewFixture();
  return buildReviewLock({
    semanticViews: {
      ...semanticViews,
      views: [{
        ...semanticViews.views[0]!,
        nodes,
        edges
      }]
    }
  });
}

test('explain graph rejects one node identity with conflicting definitions', async () => {
  const lock = lockWithProjection([
    node('app:customer-admin', 'different-label', 'app')
  ]);

  await expect(buildExplainGraph(
    process.cwd(),
    lock,
    EMPTY_PROVENANCE,
    EMPTY_COVERAGE,
    null
  )).rejects.toMatchObject({ code: 'EXPLAIN-GRAPH-001' });
});

test('explain graph rejects every edge whose endpoint was never registered', async () => {
  const source = node('app:customer-admin', 'customer-admin', 'app');
  const lock = lockWithProjection([source], [{
    id: 'edge:dangling',
    source: source.id,
    target: 'entity:missing',
    relation: 'CONTAINS',
    label: 'dangling',
    references: []
  }]);

  await expect(buildExplainGraph(
    process.cwd(),
    lock,
    EMPTY_PROVENANCE,
    EMPTY_COVERAGE,
    null
  )).rejects.toMatchObject({ code: 'EXPLAIN-GRAPH-002' });
});

test('edge tuple identity cannot collide through colon-bearing node ids', async () => {
  const app = node('app:customer-admin', 'customer-admin', 'app');
  const firstSource = node('a');
  const firstTarget = node('b:depends_on:c');
  const secondSource = node('a:contains:b');
  const secondTarget = node('c');
  const lock = lockWithProjection(
    [app, firstSource, firstTarget, secondSource, secondTarget],
    [{
      id: 'edge:first',
      source: firstSource.id,
      target: firstTarget.id,
      relation: 'CONTAINS',
      label: 'first',
      references: []
    }, {
      id: 'edge:second',
      source: secondSource.id,
      target: secondTarget.id,
      relation: 'DEPENDS_ON',
      label: 'second',
      references: []
    }]
  );

  const graph = await buildExplainGraph(
    process.cwd(),
    lock,
    EMPTY_PROVENANCE,
    EMPTY_COVERAGE,
    null
  );

  expect(graph.edges).toEqual([
    { from: firstSource.id, to: firstTarget.id, type: 'contains' },
    { from: secondSource.id, to: secondTarget.id, type: 'depends_on' }
  ]);
});

test('provenance and coverage register their block endpoints explicitly', async () => {
  const app = node('app:customer-admin', 'customer-admin', 'app');
  const lock = lockWithProjection([app]);
  lock.acceptancePlan = ['acceptance-1'];
  const provenance: ProvenanceFile = {
    formatVersion: '1',
    artifacts: [{
      path: 'generated.txt',
      originType: 'block',
      originId: 'fixture/basic',
      sourceBlock: 'fixture/basic',
      generatedByPass: 'compose',
      verifiedBy: [],
      overrideStatus: 'none'
    }]
  };
  const coverage: AcceptanceCoverageReport = {
    ...EMPTY_COVERAGE,
    acceptancePassed: ['acceptance-1'],
    blocks: [{ id: 'fixture/basic', declaredAcceptance: ['acceptance-1'], coveredBy: ['acceptance-1'], uncovered: false }]
  };

  const graph = await buildExplainGraph(
    process.cwd(),
    lock,
    provenance,
    coverage,
    null
  );

  expect(graph.nodes).toContainEqual({
    id: 'block:fixture/basic',
    type: 'block',
    label: 'fixture/basic'
  });
  expect(graph.edges).toContainEqual({
    from: 'file:generated.txt',
    to: 'block:fixture/basic',
    type: 'originates_from'
  });
  expect(graph.edges).toContainEqual({
    from: 'block:fixture/basic',
    to: 'acceptance:acceptance-1',
    type: 'verified_by'
  });
});
