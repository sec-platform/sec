import type { EngineeringIR } from '../../shared/engineering-ir-types.ts';
import { CompilerError } from '../../shared/errors.ts';
import { SEMANTIC_VIEW_FORMAT_VERSION, type SemanticView, type ViewBadge, type ViewEdge, type ViewNode } from '../../shared/semantic-view-types.ts';
import { indexEngineeringIR } from '../ir/index-engineering-ir.ts';
import {
  buildProvenanceOverlay,
  buildSemanticInspector,
  buildViewNode,
  mergeViewEdge,
  uniqueReferences,
  viewEdgeId
} from './semantic-view-utils.ts';

export function projectScenarioView(ir: EngineeringIR, scenarioId: string): SemanticView {
  const index = indexEngineeringIR(ir);
  const scenario = ir.scenarios.find((entry) => entry.id === scenarioId);
  if (!scenario) throw new CompilerError('VIEW-SCENARIO-001', `Unknown scenario "${scenarioId}"`);

  const nodes = new Map<string, ViewNode>();
  const edges = new Map<string, ViewEdge>();
  const stepById = new Map(scenario.steps.map((step) => [step.id, step]));
  const entryStepId = scenario.steps.find((step) =>
    step.operationEntityId === scenario.entryEntityId && step.afterStepIds.length === 0
  )?.id ?? scenario.steps.find((step) => step.operationEntityId === scenario.entryEntityId)?.id;

  for (const step of scenario.steps) {
    const nodeId = `${scenario.id}#step:${step.id}`;
    const operationFacts = index.outgoingFactsBySubject.get(step.operationEntityId) ?? [];
    const badges: ViewBadge[] = [];
    if (step.id === entryStepId) badges.push('entry');
    if (step.awaits || operationFacts.some((fact) => fact.predicate === 'AWAITS')) badges.push('async');
    if (step.retryMaxAttempts !== undefined) badges.push('retry');
    if (operationFacts.some((fact) => fact.predicate === 'PERFORMS_EFFECT')) badges.push('io');
    if (operationFacts.some((fact) => fact.predicate === 'REQUIRES_PERMISSION')) badges.push('permission');
    if (operationFacts.some((fact) => fact.authority === 'inferred')) badges.push('inferred');
    nodes.set(nodeId, buildViewNode(index, step.operationEntityId, {
      id: nodeId,
      badges,
      facts: operationFacts,
      group: 'scenario-step',
      references: [
        { kind: 'scenario', ref: scenario.id },
        { kind: 'scenario-step', ref: `${scenario.id}#${step.id}` }
      ]
    }));
  }

  for (const step of scenario.steps) {
    const targetNodeId = `${scenario.id}#step:${step.id}`;
    for (const dependencyId of step.afterStepIds) {
      if (!stepById.has(dependencyId)) continue;
      const sourceNodeId = `${scenario.id}#step:${dependencyId}`;
      mergeViewEdge(edges, {
        id: viewEdgeId(sourceNodeId, 'SCENARIO_PRECEDES', targetNodeId),
        source: sourceNodeId,
        target: targetNodeId,
        relation: 'SCENARIO_PRECEDES',
        label: step.awaits ? 'await' : 'then',
        references: uniqueReferences([
          { kind: 'scenario', ref: scenario.id },
          { kind: 'scenario-step', ref: `${scenario.id}#${dependencyId}` },
          { kind: 'scenario-step', ref: `${scenario.id}#${step.id}` }
        ])
      });
    }
    if (step.onErrorStepId && stepById.has(step.onErrorStepId)) {
      const errorNodeId = `${scenario.id}#step:${step.onErrorStepId}`;
      mergeViewEdge(edges, {
        id: viewEdgeId(targetNodeId, 'SCENARIO_ERROR', errorNodeId),
        source: targetNodeId,
        target: errorNodeId,
        relation: 'SCENARIO_ERROR',
        label: 'on error',
        references: uniqueReferences([
          { kind: 'scenario', ref: scenario.id },
          { kind: 'scenario-step', ref: `${scenario.id}#${step.id}` },
          { kind: 'scenario-step', ref: `${scenario.id}#${step.onErrorStepId}` }
        ])
      });
    }
  }

  const sortedNodes = [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id));
  const sortedEdges = [...edges.values()].sort((left, right) => left.id.localeCompare(right.id));
  return {
    formatVersion: SEMANTIC_VIEW_FORMAT_VERSION,
    viewKind: 'scenario',
    subject: scenario.id,
    nodes: sortedNodes,
    edges: sortedEdges,
    inspector: buildSemanticInspector(ir, scenario.id),
    overlays: [buildProvenanceOverlay(ir, [...sortedNodes, ...sortedEdges])]
  };
}
