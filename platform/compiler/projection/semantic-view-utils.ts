import type {
  SemanticAttributeValue,
  SemanticAuthority,
  SemanticFact,
  SemanticPredicate,
  SemanticValue,
  ValidatedEngineeringIRSnapshot
} from '../../shared/engineering-ir-types.ts';
import { CompilerError } from '../../shared/errors.ts';
import {
  INSPECTOR_SECTION_IDS,
  type AuthorityOverlayStatus,
  type InspectorItem,
  type InspectorSection,
  type ViewBadge,
  type ViewEdge,
  type ViewNode,
  type ViewOverlay,
  type ViewReference
} from '../../shared/semantic-view-types.ts';
import { indexValidatedEngineeringIR, type EngineeringIRIndex } from '../ir/index-engineering-ir.ts';
import { compareCodeUnits, uniqueSorted } from '../ir/ir-canonical-primitives.ts';

export { uniqueSorted };

export interface FactAssertionSummary {
  status: AuthorityOverlayStatus;
  authorities: SemanticAuthority[];
  hasConflict: boolean;
  hasInferred: boolean;
  assertionCount: number;
  confidence: {
    min: number;
    max: number;
  };
}

export function summarizeFactAssertions(fact: SemanticFact): FactAssertionSummary {
  const authorities = [...new Set(fact.assertions.map((assertion) => assertion.authority))]
    .sort(compareCodeUnits);
  if (authorities.length === 0) {
    throw new CompilerError('IR-AUTHORITY-004', `Semantic fact "${fact.id}" must include at least one assertion`);
  }

  const hasConflict = false;
  const hasInferred = authorities.includes('inferred');
  const confidences = fact.assertions.map((assertion) => assertion.confidence);

  return {
    status: authorityOverlayStatus(authorities, hasConflict),
    authorities,
    // FactAssertion currently represents positive claims about one exact triple.
    // Predicate-specific contradictions live across Facts and require a validator with graph context.
    hasConflict,
    hasInferred,
    assertionCount: fact.assertions.length,
    confidence: {
      min: Math.min(...confidences),
      max: Math.max(...confidences)
    }
  };
}

function authorityOverlayStatus(
  authorities: readonly SemanticAuthority[],
  hasConflict: boolean
): AuthorityOverlayStatus {
  if (hasConflict) return 'conflict';
  if (authorities.length > 1) return 'mixed';
  return authorities[0] === 'inferred' ? 'inferred' : 'uniform';
}

function predicates(...values: SemanticPredicate[]): ReadonlySet<SemanticPredicate> {
  return new Set(values);
}

export function uniqueReferences(references: readonly ViewReference[]): ViewReference[] {
  const byKey = new Map<string, ViewReference>();
  for (const reference of references) byKey.set(`${reference.kind}:${reference.ref}`, reference);
  return [...byKey.values()].sort((left, right) =>
    compareCodeUnits(`${left.kind}:${left.ref}`, `${right.kind}:${right.ref}`)
  );
}

export function referencesForFacts(facts: readonly SemanticFact[]): ViewReference[] {
  return uniqueReferences(facts.flatMap((fact) => [
    { kind: 'fact' as const, ref: fact.id },
    ...fact.assertions.flatMap((assertion) => assertion.evidence.map((evidence) => ({
      kind: 'evidence' as const,
      ref: `${evidence.kind}:${evidence.ref}`
    })))
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
  const facts = options.facts ?? [];
  const badges = [...(options.badges ?? [])];
  if (facts.some((fact) => summarizeFactAssertions(fact).hasInferred)) badges.push('inferred');
  return {
    id: options.id ?? entity.id,
    entityId: entity.id,
    entityKind: entity.kind,
    label: entity.label,
    ...(typeof role === 'string' ? { role } : {}),
    badges: uniqueSorted(badges),
    ...(options.group ? { group: options.group } : {}),
    references: uniqueReferences([
      { kind: 'entity', ref: entity.id },
      ...referencesForFacts(facts),
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

export function buildSemanticInspector(
  snapshot: ValidatedEngineeringIRSnapshot,
  subjectId: string
): InspectorSection[] {
  const index = indexValidatedEngineeringIR(snapshot);
  const entity = index.entityById.get(subjectId);
  if (!entity) throw new CompilerError('VIEW-INSPECTOR-001', `Unknown inspector subject "${subjectId}"`);
  const outgoing = index.outgoingFactsBySubject.get(subjectId) ?? [];
  const incoming = index.incomingFactsByEntityObject.get(subjectId) ?? [];
  const allFacts = [...outgoing, ...incoming].sort((left, right) => compareCodeUnits(left.id, right.id));
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
  set('EVIDENCE', allFacts.map((fact) => {
    const summary = summarizeFactAssertions(fact);
    return {
      key: fact.id,
      value: {
        status: summary.status,
        authorities: summary.authorities,
        hasConflict: summary.hasConflict,
        hasInferred: summary.hasInferred,
        assertionCount: summary.assertionCount,
        confidence: summary.confidence,
        assertions: fact.assertions.map((assertion) => ({
          id: assertion.id,
          authority: assertion.authority,
          confidence: assertion.confidence,
          provenance: assertion.provenance.map((entry) => `${entry.kind}:${entry.sourceId}`),
          evidence: assertion.evidence.map((entry) => `${entry.kind}:${entry.ref}`),
          validFromRevision: assertion.validFromRevision,
          ...(assertion.validToRevision ? { validToRevision: assertion.validToRevision } : {})
        }))
      },
      references: referencesForFacts([fact])
    };
  }));

  return INSPECTOR_SECTION_IDS.map((id) => ({
    id,
    items: itemsBySection.get(id) ?? []
  }));
}

export function buildProvenanceOverlay(
  snapshot: ValidatedEngineeringIRSnapshot,
  targets: readonly { id: string; references: readonly ViewReference[] }[]
): ViewOverlay {
  const index = indexValidatedEngineeringIR(snapshot);
  const entries = targets.flatMap((target) => {
    const factIds = uniqueSorted(target.references.filter((reference) => reference.kind === 'fact').map((reference) => reference.ref));
    const facts = factIds.flatMap((factId) => {
      const fact = index.factById.get(factId);
      return fact ? [fact] : [];
    });
    if (facts.length === 0) return [];

    const assertions = facts.flatMap((fact) => fact.assertions);
    const summaries = facts.map(summarizeFactAssertions);
    const authorities = uniqueSorted(assertions.map((assertion) => assertion.authority));
    const hasConflict = summaries.some((summary) => summary.hasConflict);
    const confidences = assertions.map((assertion) => assertion.confidence);
    return [{
      targetId: target.id,
      factIds,
      status: authorityOverlayStatus(authorities, hasConflict),
      authorities,
      hasInferred: authorities.includes('inferred'),
      hasConflict,
      confidence: {
        min: Math.min(...confidences),
        max: Math.max(...confidences)
      },
      provenanceKinds: uniqueSorted(assertions.flatMap((assertion) => assertion.provenance.map((entry) => entry.kind))),
      evidenceRefs: uniqueSorted(assertions.flatMap((assertion) => assertion.evidence.map((entry) => `${entry.kind}:${entry.ref}`)))
    }];
  });

  return {
    kind: 'provenance-authority',
    entries: entries.sort((left, right) => compareCodeUnits(left.targetId, right.targetId))
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
