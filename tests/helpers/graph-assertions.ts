import { expect } from 'bun:test';

import type {
  ExplainGraph,
  ExplainGraphEdge,
  ExplainGraphNode,
  ReviewConflictHint,
  ReviewRegressionRisk,
  ReviewSummary
} from '../../platform/shared/types.ts';

export function expectGraphNode(graph: Pick<ExplainGraph, 'nodes'>, expected: Partial<ExplainGraphNode>): void {
  expect(graph.nodes).toEqual(expect.arrayContaining([expect.objectContaining(expected)]));
}

export function expectNoGraphNode(graph: Pick<ExplainGraph, 'nodes'>, expected: Partial<ExplainGraphNode>): void {
  expect(graph.nodes).not.toEqual(expect.arrayContaining([expect.objectContaining(expected)]));
}

export function expectGraphEdge(graph: Pick<ExplainGraph, 'edges'>, expected: Partial<ExplainGraphEdge>): void {
  expect(graph.edges).toEqual(expect.arrayContaining([expect.objectContaining(expected)]));
}

export function expectNoGraphEdge(graph: Pick<ExplainGraph, 'edges'>, expected: Partial<ExplainGraphEdge>): void {
  expect(graph.edges).not.toEqual(expect.arrayContaining([expect.objectContaining(expected)]));
}

export function expectReviewConflictHint(
  reviewSummary: Pick<ReviewSummary, 'conflictHints'>,
  expected: ReviewConflictHint
): void {
  expect(reviewSummary.conflictHints).toEqual(expect.arrayContaining([expected]));
}

export function expectReviewRegressionRisk(
  reviewSummary: Pick<ReviewSummary, 'regressionRisks'>,
  expected: ReviewRegressionRisk
): void {
  expect(reviewSummary.regressionRisks).toEqual(expect.arrayContaining([expected]));
}
