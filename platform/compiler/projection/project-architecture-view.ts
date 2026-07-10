import type { EngineeringIR, SemanticFact } from '../../shared/engineering-ir-types.ts';
import { SEMANTIC_VIEW_FORMAT_VERSION, type SemanticView, type ViewBadge, type ViewEdge, type ViewNode } from '../../shared/semantic-view-types.ts';
import { indexEngineeringIR } from '../ir/index-engineering-ir.ts';
import {
  buildProvenanceOverlay,
  buildSemanticInspector,
  buildViewNode,
  mergeViewEdge,
  referencesForFacts,
  summarizeFactAssertions,
  viewEdgeId
} from './semantic-view-utils.ts';

function factTargetId(fact: SemanticFact): string | null {
  return fact.object.kind === 'entity' ? fact.object.entityId : null;
}

export function projectArchitectureView(ir: EngineeringIR, subjectId?: string): SemanticView {
  const index = indexEngineeringIR(ir);
  const responsibilities = index.entitiesByKind.get('responsibility') ?? [];
  const nodes = new Map<string, ViewNode>();
  const edges = new Map<string, ViewEdge>();

  for (const responsibility of responsibilities) {
    const responsibilityFacts = index.outgoingFactsBySubject.get(responsibility.id) ?? [];
    const implementationFacts = responsibilityFacts.filter((fact) => fact.predicate === 'IMPLEMENTS');
    const operationIds = implementationFacts.flatMap((fact) => {
      const targetId = factTargetId(fact);
      return targetId ? [targetId] : [];
    });
    const operationFacts = operationIds.flatMap((operationId) => index.outgoingFactsBySubject.get(operationId) ?? []);
    const relevantFacts = [...responsibilityFacts, ...operationFacts];
    const badges: ViewBadge[] = [];
    if (responsibilityFacts.some((fact) => fact.predicate === 'OWNS')) badges.push('stateful');
    if (operationFacts.some((fact) => fact.predicate === 'PERFORMS_EFFECT')) badges.push('io');
    if (operationFacts.some((fact) => fact.predicate === 'AWAITS')) badges.push('async');
    if (operationFacts.some((fact) => fact.predicate === 'REQUIRES_PERMISSION')) badges.push('permission');
    if (relevantFacts.some((fact) => summarizeFactAssertions(fact).hasInferred)) badges.push('inferred');
    nodes.set(responsibility.id, buildViewNode(index, responsibility.id, { badges, facts: relevantFacts }));

    for (const dependencyFact of responsibilityFacts.filter((fact) => fact.predicate === 'DEPENDS_ON')) {
      const targetId = factTargetId(dependencyFact);
      if (!targetId || index.entityById.get(targetId)?.kind !== 'responsibility') continue;
      mergeViewEdge(edges, {
        id: viewEdgeId(responsibility.id, 'DEPENDS_ON', targetId),
        source: responsibility.id,
        target: targetId,
        relation: 'DEPENDS_ON',
        label: 'depends on',
        references: referencesForFacts([dependencyFact])
      });
    }

    for (const operationId of operationIds) {
      const operationImplementationFacts = implementationFacts.filter((fact) => factTargetId(fact) === operationId);
      for (const relationFact of index.outgoingFactsBySubject.get(operationId) ?? []) {
        if (!['PERFORMS_EFFECT', 'REQUIRES_PERMISSION'].includes(relationFact.predicate)) continue;
        const targetId = factTargetId(relationFact);
        if (!targetId) continue;
        const targetEntity = index.entityById.get(targetId);
        if (!targetEntity) continue;
        const badge: ViewBadge = relationFact.predicate === 'PERFORMS_EFFECT' ? 'io' : 'permission';
        const existingNodeFacts = [relationFact];
        nodes.set(targetId, buildViewNode(index, targetId, { badges: [badge], facts: existingNodeFacts, group: targetEntity.kind }));
        mergeViewEdge(edges, {
          id: viewEdgeId(responsibility.id, relationFact.predicate, targetId),
          source: responsibility.id,
          target: targetId,
          relation: relationFact.predicate,
          label: relationFact.predicate === 'PERFORMS_EFFECT' ? 'performs' : 'requires permission',
          references: referencesForFacts([...operationImplementationFacts, relationFact])
        });
      }
    }
  }

  const sortedNodes = [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id));
  const sortedEdges = [...edges.values()].sort((left, right) => left.id.localeCompare(right.id));
  const subject = subjectId ?? responsibilities[0]?.id ?? ir.appId;
  return {
    formatVersion: SEMANTIC_VIEW_FORMAT_VERSION,
    viewKind: 'architecture',
    subject,
    nodes: sortedNodes,
    edges: sortedEdges,
    inspector: buildSemanticInspector(ir, subject),
    overlays: [buildProvenanceOverlay(ir, [...sortedNodes, ...sortedEdges])]
  };
}
