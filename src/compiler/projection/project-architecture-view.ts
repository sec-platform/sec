import type { SemanticEntityKind } from '../../semantics/engineering-ir/entity-types.ts';
import type { SemanticFact } from '../../semantics/engineering-ir/fact-types.ts';
import type { ValidatedEngineeringIRSnapshot } from '../../semantics/engineering-ir/validated-types.ts';
import { SEMANTIC_VIEW_FORMAT_VERSION, type SemanticView, type ViewBadge, type ViewEdge, type ViewNode } from '../../semantics/projection/types.ts';
import { compareCodeUnits } from '../../contracts/canonical.ts';
import { indexValidatedEngineeringIR } from '../ir/index-engineering-ir.ts';
import {
  buildProvenanceOverlay,
  buildSemanticInspector,
  buildViewNode,
  referencesForFacts,
  viewEdgeId
} from './semantic-view-utils.ts';

const ARCHITECTURE_ENTITY_KINDS = new Set<SemanticEntityKind>([
  'app',
  'block',
  'capability',
  'port',
  'entity',
  'field',
  'responsibility',
  'operation',
  'state',
  'event',
  'policy',
  'permission',
  'effect',
  'boundary',
  'generator',
  'artifact'
]);

function badgesFor(entityKind: SemanticEntityKind, facts: readonly SemanticFact[]): ViewBadge[] {
  const badges: ViewBadge[] = [];
  if (entityKind === 'state' || facts.some((fact) => ['OWNS', 'MUTATES'].includes(fact.predicate))) {
    badges.push('stateful');
  }
  if (entityKind === 'effect' || facts.some((fact) => fact.predicate === 'PERFORMS_EFFECT')) {
    badges.push('io');
  }
  if (entityKind === 'permission' || facts.some((fact) => fact.predicate === 'REQUIRES_PERMISSION')) {
    badges.push('permission');
  }
  if (facts.some((fact) => fact.predicate === 'AWAITS')) badges.push('async');
  return badges;
}

function relationLabel(predicate: SemanticFact['predicate']): string {
  return predicate.toLowerCase().replaceAll('_', ' ');
}

export function projectArchitectureView(
  snapshot: ValidatedEngineeringIRSnapshot,
  subjectId?: string
): SemanticView {
  const { ir } = snapshot;
  const index = indexValidatedEngineeringIR(snapshot);
  const includedEntities = ir.entities.filter((entity) => ARCHITECTURE_ENTITY_KINDS.has(entity.kind));
  const includedIds = new Set(includedEntities.map((entity) => entity.id));
  const architectureFacts = ir.facts.filter((fact) =>
    includedIds.has(fact.subject) &&
    fact.object.kind === 'entity' &&
    includedIds.has(fact.object.entityId)
  );

  const nodes: ViewNode[] = includedEntities.map((entity) => {
    // A node only needs its incident facts. Self-edges appear in both indexes
    // but must retain the single occurrence selected by the original filter.
    const facts = [
      ...(index.outgoingFactsBySubject.get(entity.id) ?? []),
      ...(index.incomingFactsByEntityObject.get(entity.id) ?? []).filter((fact) => fact.subject !== entity.id)
    ].filter((fact) => includedIds.has(fact.subject) && fact.object.kind === 'entity'
      && includedIds.has(fact.object.entityId));
    return buildViewNode(index, entity.id, {
      badges: badgesFor(entity.kind, facts),
      facts,
      group: entity.kind
    });
  }).sort((left, right) => compareCodeUnits(left.id, right.id));

  const edges: ViewEdge[] = architectureFacts.map((fact) => ({
    id: viewEdgeId(fact.subject, fact.predicate, fact.object.kind === 'entity' ? fact.object.entityId : '', fact.id),
    source: fact.subject,
    target: fact.object.kind === 'entity' ? fact.object.entityId : undefined,
    relation: fact.predicate,
    label: relationLabel(fact.predicate),
    references: referencesForFacts([fact])
  })).sort((left, right) => compareCodeUnits(left.id, right.id));

  const subject = subjectId ?? ir.appId;
  return {
    formatVersion: SEMANTIC_VIEW_FORMAT_VERSION,
    viewKind: 'architecture',
    subject,
    nodes,
    edges,
    inspector: buildSemanticInspector(snapshot, subject),
    overlays: [buildProvenanceOverlay(snapshot, [...nodes, ...edges])]
  };
}
