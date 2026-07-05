import { CompilerError } from '../../shared/errors.ts';
import type {
  EngineeringIR,
  SemanticAttributeValue,
  SemanticFact,
  SemanticPredicate,
  SemanticValue
} from '../../shared/engineering-ir-types.ts';
import {
  INSPECTOR_SECTION_IDS,
  type InspectorItem,
  type InspectorSection,
  type ViewBadge,
  type ViewEdge,
  type ViewNode,
  type ViewOverlay,
  type ViewReference
} from '../../shared/semantic-view-types.ts';
import { indexEngineeringIR, type EngineeringIRIndex } from '../ir/index-engineering-ir.ts';

const AUTHORITY_STRENGTH = {
  inferred: 0,
  observed: 1,
  derived: 2,
  authoritative: 3
} as const;

export function uniqueSorted<Value extends string>(values: readonly Value[]): Value[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function predicates(...values: SemanticPredicate[]): ReadonlySet<SemanticPredicate> {
  return new Set(values);
}

export function uniqueReferences(references: readonly ViewReference[]): ViewReference[] {
  const byKey = new Map<string, ViewReference>();
  for (const reference of references) byKey.set(`${reference.kind}:${reference.ref}`, reference);
  return [...byKey.values()].sort((left, right) =>
    `${left.kind}:${left.ref}`.localeCompare(`${right.kind}:${right.ref}`)
  );
}

export function referencesForFacts(facts: readonly SemanticFact[]): ViewReference[] {
  return uniqueReferences(facts.flatMap((fact) => [
    { kind: 'fact' as const, ref: fact.id },
    ...fact.evidence.map((evidence) => ({ kind: 'evidence' as const, ref: `${evidence.kind}:${evidence.ref}` }))
  ]));
}

export function entityAttribute(
  index: EngineeringIRIndex,
  entityId: string,
  key: string
): SemanticAttributeValue | undefined {
  return index.entityById.get(entityId)?.attributes.find((attribute) => attribute.key === key)?.value;
}

export function buildViewNode(
  index: EngineeringIRIndex,
  entityId: string,
  options: {
    id?: string;
    badges?: readonly ViewBadge[];
    group?: string;
    facts?: readonly SemanticFact[];
    references?: readonly ViewReference[];
  } = {}
): ViewNode {
  const entity = index.entityById.get(entityId);
  if (!entity) throw new CompilerError('VIEW-PROJECTION-001', `Unknown semantic entity "${entityId}"`);
  const role = entityAttribute(index, entityId, 'role');
  return {
    id: options.id ?? entity.id,
    entityId: entity.id,
    entityKind: entity.kind,
    label: entity.label,
    ...(typeof role === 'string' ? { role } : {}),
    badges: uniqueSorted(options.badges ?? []),
    ...(options.group ? { group: options.group } : {}),
    references: uniqueReferences([
      { kind: 'entity', ref: entity.id },
      ...referencesForFacts(options.facts ?? []),
      ...(options.references ?? [])
    ])
  };
}

function relationValue(fact: SemanticFact, direction: 'outgoing' | 'incoming'): SemanticValue {
  if (direction === 'incoming') return fact.subject;
  return fact.object.kind === 'entity' ? fact.object.entityId : fact.object.value;
}

function relationItems(
  facts: readonly SemanticFact[],
  predicateSet: ReadonlySet<SemanticPredicate>,
  direction: 'outgoing' | 'incoming'
): InspectorItem[] {
  return facts
    .filter((fact) => predicateSet.has(fact.predicate))
    .map((fact) => ({
      key: `${direction}:${fact.predicate}`,
      value: relationValue(fact, direction),
      references: referencesForFacts([fact])
    }));
}

export function buildSemanticInspector(ir: EngineeringIR, subjectId: string): InspectorSection[] {
  const index = indexEngineeringIR(ir);
  const entity = index.entityById.get(subjectId);
  if (!entity) throw new CompilerError('VIEW-INSPECTOR-001', `Unknown inspector subject "${subjectId}"`);
  const outgoing = index.outgoingFactsBySubject.get(subjectId) ?? [];
  const incoming = index.incomingFactsByEntityObject.get(subjectId) ?? [];
  const allFacts = [...outgoing, ...incoming].sort((left, right) => left.id.localeCompare(right.id));
  const entityReference: ViewReference[] = [{ kind: 'entity', ref: entity.id }];

  const itemsBySection = new Map<string, InspectorItem[]>();
  const set = (section: string, items: InspectorItem[]): void => {
    itemsBySection.set(section, items);
  };

  set('IDENTITY', [
    { key: 'id', value: entity.id, references: entityReference },
    { key: 'kind', value: entity.kind, references: entityReference },
    { key: 'label', value: entity.label, references: entityReference }
  ]);
  set('ROLE', entity.attributes
    .filter((attribute) => attribute.key === 'role')
    .map((attribute) => ({ key: attribute.key, value: attribute.value, references: entityReference })));
  set('CONTRACT', [
    ...entity.attributes
      .filter((attribute) => ['inputs', 'output', 'type', 'required', 'mutable', 'payloadType'].includes(attribute.key))
      .map((attribute) => ({ key: attribute.key, value: attribute.value, references: entityReference })),
    ...relationItems(outgoing, predicates('DECLARES', 'IMPLEMENTS', 'REQUIRES', 'GUARANTEES', 'PROVIDES'), 'outgoing')
  ]);
  set('OWNED STATE', relationItems(outgoing, predicates('OWNS'), 'outgoing'));
  set('DATA', [
    ...relationItems(outgoing, predicates('READS', 'WRITES', 'MUTATES', 'FLOWS_TO', 'DERIVES_FROM', 'TRANSFORMS_TO', 'VALIDATES', 'SANITIZES', 'SERIALIZES_AS', 'DESERIALIZES_FROM', 'PERSISTS_AS'), 'outgoing'),
    ...relationItems(incoming, predicates('READS', 'WRITES', 'MUTATES', 'FLOWS_TO', 'DERIVES_FROM', 'TRANSFORMS_TO', 'VALIDATES', 'SANITIZES', 'SERIALIZES_AS', 'DESERIALIZES_FROM', 'PERSISTS_AS'), 'incoming')
  ]);
  set('EFFECTS', relationItems(outgoing, predicates('PERFORMS_EFFECT'), 'outgoing'));
  set('ERRORS', relationItems(outgoing, predicates('HANDLES', 'VIOLATES'), 'outgoing'));
  set('LIFECYCLE', [
    ...relationItems(outgoing, predicates('INITIALIZES', 'DISPOSES', 'TRANSITIONS_TO', 'ESCAPES'), 'outgoing'),
    ...entity.attributes
      .filter((attribute) => attribute.key === 'values')
      .map((attribute) => ({ key: attribute.key, value: attribute.value, references: entityReference }))
  ]);
  set('CONCURRENCY', relationItems(outgoing, predicates('AWAITS', 'FORKS_TO', 'JOINS', 'RETRIES'), 'outgoing'));
  set('PERMISSIONS', relationItems(outgoing, predicates('REQUIRES_PERMISSION', 'CROSSES_BOUNDARY'), 'outgoing'));
  set('RELATIONS', [
    ...relationItems(outgoing, new Set(outgoing.map((fact) => fact.predicate)), 'outgoing'),
    ...relationItems(incoming, new Set(incoming.map((fact) => fact.predicate)), 'incoming')
  ]);
  set('EVIDENCE', allFacts.map((fact) => ({
    key: fact.id,
    value: {
      authority: fact.authority,
      confidence: fact.confidence,
      provenance: fact.provenance.map((entry) => `${entry.kind}:${entry.sourceId}`),
      evidence: fact.evidence.map((entry) => `${entry.kind}:${entry.ref}`)
    },
    references: referencesForFacts([fact])
  })));

  return INSPECTOR_SECTION_IDS.map((id) => ({
    id,
    items: itemsBySection.get(id) ?? []
  }));
}

export function buildProvenanceOverlay(
  ir: EngineeringIR,
  targets: readonly { id: string; references: readonly ViewReference[] }[]
): ViewOverlay {
  const index = indexEngineeringIR(ir);
  const entries = targets.flatMap((target) => {
    const factIds = uniqueSorted(target.references.filter((reference) => reference.kind === 'fact').map((reference) => reference.ref));
    const facts = factIds.flatMap((factId) => {
      const fact = index.factById.get(factId);
      return fact ? [fact] : [];
    });
    if (facts.length === 0) return [];

    const authority = [...facts]
      .sort((left, right) => AUTHORITY_STRENGTH[right.authority] - AUTHORITY_STRENGTH[left.authority])[0]!.authority;
    const authorityFacts = facts.filter((fact) => fact.authority === authority);
    return [{
      targetId: target.id,
      factIds,
      authority,
      confidence: Math.max(...authorityFacts.map((fact) => fact.confidence)),
      provenanceKinds: uniqueSorted(facts.flatMap((fact) => fact.provenance.map((entry) => entry.kind))),
      evidenceRefs: uniqueSorted(facts.flatMap((fact) => fact.evidence.map((entry) => `${entry.kind}:${entry.ref}`)))
    }];
  });

  return {
    kind: 'provenance-authority',
    entries: entries.sort((left, right) => left.targetId.localeCompare(right.targetId))
  };
}

export function mergeViewEdge(map: Map<string, ViewEdge>, edge: ViewEdge): void {
  const existing = map.get(edge.id);
  if (!existing) {
    map.set(edge.id, { ...edge, references: uniqueReferences(edge.references) });
    return;
  }
  map.set(edge.id, { ...existing, references: uniqueReferences([...existing.references, ...edge.references]) });
}

export function viewEdgeId(source: string, relation: string, target: string, label = ''): string {
  return `edge:${source}:${relation}:${target}:${label}`;
}
