import type { SemanticFact, SemanticValueObject } from '../../semantics/engineering-ir/fact-types.ts';
import type { ValidatedEngineeringIRSnapshot } from '../../semantics/engineering-ir/validated-types.ts';
import { SEMANTIC_VIEW_FORMAT_VERSION, type SemanticView, type ViewEdge, type ViewNode } from '../../semantics/projection/types.ts';
import { compareCodeUnits } from '../../contracts/canonical.ts';
import { CompilerError } from '../errors.ts';
import { indexValidatedEngineeringIR } from '../ir/index-engineering-ir.ts';
import {
  buildProvenanceOverlay,
  buildSemanticInspector,
  buildViewNode,
  mergeViewEdge,
  referencesForFacts,
  uniqueSorted,
  viewEdgeId
} from './semantic-view-utils.ts';

function entityTargetId(fact: SemanticFact): string | null {
  return fact.object.kind === 'entity' ? fact.object.entityId : null;
}

function transitionValue(fact: SemanticFact): SemanticValueObject | null {
  if (fact.object.kind !== 'value' || fact.object.value === null || Array.isArray(fact.object.value) || typeof fact.object.value !== 'object') {
    return null;
  }
  return fact.object.value;
}

export function projectStateView(snapshot: ValidatedEngineeringIRSnapshot, subjectId: string): SemanticView {
  const index = indexValidatedEngineeringIR(snapshot);
  const subject = index.entityById.get(subjectId);
  if (!subject) throw new CompilerError('VIEW-STATE-001', `Unknown state view subject "${subjectId}"`);

  const stateIds = subject.kind === 'state'
    ? [subject.id]
    : subject.kind === 'responsibility'
      ? uniqueSorted((index.outgoingFactsBySubject.get(subject.id) ?? [])
          .filter((fact) => fact.predicate === 'OWNS')
          .flatMap((fact) => {
            const targetId = entityTargetId(fact);
            return targetId && index.entityById.get(targetId)?.kind === 'state' ? [targetId] : [];
          }))
      : [];

  if (stateIds.length === 0) {
    throw new CompilerError('VIEW-STATE-002', `Subject "${subjectId}" does not identify or own semantic state`);
  }

  const nodes = new Map<string, ViewNode>();
  const edges = new Map<string, ViewEdge>();

  for (const stateId of stateIds) {
    const stateFacts = index.outgoingFactsBySubject.get(stateId) ?? [];
    nodes.set(stateId, buildViewNode(index, stateId, { badges: ['stateful'], facts: stateFacts, group: 'state' }));

    const ownerFacts = (index.incomingFactsByEntityObject.get(stateId) ?? []).filter((fact) =>
      fact.predicate === 'OWNS' && index.entityById.get(fact.subject)?.kind === 'responsibility'
    );
    for (const ownerFact of ownerFacts) {
      nodes.set(ownerFact.subject, buildViewNode(index, ownerFact.subject, { badges: ['stateful'], facts: [ownerFact], group: 'owner' }));
      mergeViewEdge(edges, {
        id: viewEdgeId(ownerFact.subject, 'OWNS', stateId),
        source: ownerFact.subject,
        target: stateId,
        relation: 'OWNS',
        label: 'owns',
        references: referencesForFacts([ownerFact])
      });
    }

    const fieldFacts = stateFacts.filter((fact) => fact.predicate === 'DECLARES' && entityTargetId(fact));
    const targetIds = new Set<string>([stateId]);
    for (const fieldFact of fieldFacts) {
      const fieldId = entityTargetId(fieldFact)!;
      targetIds.add(fieldId);
      nodes.set(fieldId, buildViewNode(index, fieldId, { facts: [fieldFact], group: 'state-field' }));
      mergeViewEdge(edges, {
        id: viewEdgeId(stateId, 'DECLARES', fieldId),
        source: stateId,
        target: fieldId,
        relation: 'DECLARES',
        label: 'backed by',
        references: referencesForFacts([fieldFact])
      });
    }

    for (const targetId of targetIds) {
      for (const fact of index.incomingFactsByEntityObject.get(targetId) ?? []) {
        if (!['READS', 'WRITES', 'MUTATES'].includes(fact.predicate)
            || index.entityById.get(fact.subject)?.kind !== 'operation') continue;
        const operationFacts = index.outgoingFactsBySubject.get(fact.subject) ?? [];
        nodes.set(fact.subject, buildViewNode(index, fact.subject, { facts: operationFacts, group: 'operation' }));
        mergeViewEdge(edges, {
          id: viewEdgeId(fact.subject, fact.predicate, targetId),
          source: fact.subject,
          target: targetId,
          relation: fact.predicate,
          label: fact.predicate.toLowerCase(),
          references: referencesForFacts([fact])
        });
      }
    }

    for (const transitionFact of stateFacts.filter((fact) => fact.predicate === 'TRANSITIONS_TO')) {
      const value = transitionValue(transitionFact);
      const from = typeof value?.from === 'string' ? value.from : '?';
      const to = typeof value?.to === 'string' ? value.to : '?';
      const operationId = typeof value?.by === 'string' ? value.by : null;
      if (operationId && index.entityById.get(operationId)?.kind === 'operation') {
        nodes.set(operationId, buildViewNode(index, operationId, {
          facts: index.outgoingFactsBySubject.get(operationId) ?? [],
          group: 'operation'
        }));
      }
      mergeViewEdge(edges, {
        id: `edge:fact:${transitionFact.id}`,
        source: stateId,
        value: transitionFact.object.kind === 'value' ? transitionFact.object.value : undefined,
        relation: 'TRANSITIONS_TO',
        label: `${from} → ${to}${operationId ? ` by ${index.entityById.get(operationId)?.label ?? operationId}` : ''}`,
        references: referencesForFacts([transitionFact])
      });
    }
  }

  const sortedNodes = [...nodes.values()].sort((left, right) => compareCodeUnits(left.id, right.id));
  const sortedEdges = [...edges.values()].sort((left, right) => compareCodeUnits(left.id, right.id));
  return {
    formatVersion: SEMANTIC_VIEW_FORMAT_VERSION,
    viewKind: 'state',
    subject: subjectId,
    nodes: sortedNodes,
    edges: sortedEdges,
    inspector: buildSemanticInspector(snapshot, subjectId),
    overlays: [buildProvenanceOverlay(snapshot, [...sortedNodes, ...sortedEdges])]
  };
}
