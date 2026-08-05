import type {
  SemanticFact,
  SemanticValue,
  ValidatedEngineeringIRSnapshot
} from '../../shared/engineering-ir-types.ts';
import { CompilerError } from '../../shared/errors.ts';
import {
  SEMANTIC_VIEW_FORMAT_VERSION,
  type SemanticView,
  type ViewBadge,
  type ViewEdge,
  type ViewNode,
  type ViewReference
} from '../../shared/semantic-view-types.ts';
import { indexValidatedEngineeringIR } from '../ir/index-engineering-ir.ts';
import { compareCodeUnits } from '../ir/ir-canonical-primitives.ts';
import {
  buildProvenanceOverlay,
  buildSemanticInspector,
  buildViewNode,
  referencesForFacts,
  uniqueReferences
} from './semantic-view-utils.ts';

const SCENARIO_RELATIONS = new Set<SemanticFact['predicate']>([
  'CONTAINS',
  'INVOKES',
  'PRECEDES',
  'AWAITS',
  'RETRIES',
  'HANDLES'
]);

function scenarioReferences(scenarioId: string, stepIds: readonly string[] = []): ViewReference[] {
  return [
    { kind: 'scenario', ref: scenarioId },
    ...stepIds.map((ref) => ({ kind: 'scenario-step' as const, ref }))
  ];
}

function relationLabel(fact: SemanticFact): string {
  if (fact.predicate !== 'RETRIES' || fact.object.kind !== 'value') {
    return fact.predicate.toLowerCase().replaceAll('_', ' ');
  }
  const value = fact.object.value;
  const maxAttempts = value !== null && !Array.isArray(value) && typeof value === 'object'
    ? value.maxAttempts
    : undefined;
  return typeof maxAttempts === 'number' ? `retries up to ${maxAttempts}` : 'retries';
}

function entityObjectId(fact: SemanticFact): string | undefined {
  return fact.object.kind === 'entity' ? fact.object.entityId : undefined;
}

export function projectScenarioView(
  snapshot: ValidatedEngineeringIRSnapshot,
  scenarioId: string
): SemanticView {
  const { ir } = snapshot;
  const index = indexValidatedEngineeringIR(snapshot);
  const scenario = index.entityById.get(scenarioId);
  if (!scenario || scenario.kind !== 'scenario') {
    throw new CompilerError('VIEW-SCENARIO-001', `Unknown scenario "${scenarioId}"`);
  }

  const containsFacts = (index.outgoingFactsBySubject.get(scenarioId) ?? []).filter((fact) =>
    fact.predicate === 'CONTAINS' &&
    fact.object.kind === 'entity' &&
    index.entityById.get(fact.object.entityId)?.kind === 'scenario-step'
  );
  const stepIds = containsFacts.map((fact) => fact.object.kind === 'entity' ? fact.object.entityId : '').sort();
  const stepIdSet = new Set(stepIds);
  const scenarioFacts = ir.facts.filter((fact) => {
    if (!SCENARIO_RELATIONS.has(fact.predicate)) return false;
    if (fact.subject === scenarioId) return fact.predicate === 'CONTAINS' || fact.predicate === 'INVOKES';
    return stepIdSet.has(fact.subject);
  });
  const operationIds = new Set(scenarioFacts.flatMap((fact) => {
    const targetId = entityObjectId(fact);
    return targetId && index.entityById.get(targetId)?.kind === 'operation' ? [targetId] : [];
  }));
  const entryOperationIds = new Set(scenarioFacts.filter((fact) =>
    fact.subject === scenarioId && fact.predicate === 'INVOKES'
  ).flatMap((fact) => entityObjectId(fact) ?? []));

  const nodes = new Map<string, ViewNode>();
  nodes.set(scenarioId, buildViewNode(index, scenarioId, {
    group: 'scenario',
    facts: scenarioFacts.filter((fact) => fact.subject === scenarioId),
    references: scenarioReferences(scenarioId)
  }));

  for (const stepId of stepIds) {
    const stepFacts = scenarioFacts.filter((fact) =>
      fact.subject === stepId || entityObjectId(fact) === stepId
    );
    const invokedOperationIds = stepFacts.filter((fact) => fact.subject === stepId && fact.predicate === 'INVOKES')
      .flatMap((fact) => entityObjectId(fact) ?? []);
    const badges: ViewBadge[] = [];
    if (invokedOperationIds.some((operationId) => entryOperationIds.has(operationId)) &&
        !scenarioFacts.some((fact) => fact.predicate === 'PRECEDES' && entityObjectId(fact) === stepId)) {
      badges.push('entry');
    }
    if (stepFacts.some((fact) => fact.predicate === 'AWAITS')) badges.push('async');
    if (stepFacts.some((fact) => fact.predicate === 'RETRIES')) badges.push('retry');
    nodes.set(stepId, buildViewNode(index, stepId, {
      badges,
      facts: stepFacts,
      group: 'scenario-step',
      references: scenarioReferences(scenarioId, [stepId])
    }));
  }

  for (const operationId of [...operationIds].sort()) {
    const operationFacts = [
      ...(index.outgoingFactsBySubject.get(operationId) ?? []),
      ...(index.incomingFactsByEntityObject.get(operationId) ?? [])
    ];
    const badges: ViewBadge[] = [];
    if (operationFacts.some((fact) => fact.predicate === 'PERFORMS_EFFECT')) badges.push('io');
    if (operationFacts.some((fact) => fact.predicate === 'REQUIRES_PERMISSION')) badges.push('permission');
    if (operationFacts.some((fact) => fact.predicate === 'AWAITS')) badges.push('async');
    nodes.set(operationId, buildViewNode(index, operationId, {
      badges,
      facts: operationFacts,
      group: 'operation',
      references: scenarioReferences(scenarioId)
    }));
  }

  const edges: ViewEdge[] = scenarioFacts.map((fact) => {
    const target = entityObjectId(fact);
    const stepReferences = [fact.subject, target].filter((id): id is string => !!id && stepIdSet.has(id));
    return {
      id: `edge:fact:${fact.id}`,
      source: fact.subject,
      ...(target ? { target } : {}),
      ...(fact.object.kind === 'value' ? { value: fact.object.value as SemanticValue } : {}),
      relation: fact.predicate,
      label: relationLabel(fact),
      references: uniqueReferences([
        ...scenarioReferences(scenarioId, stepReferences),
        ...referencesForFacts([fact])
      ])
    };
  }).sort((left, right) => compareCodeUnits(left.id, right.id));
  const sortedNodes = [...nodes.values()].sort((left, right) => compareCodeUnits(left.id, right.id));

  return {
    formatVersion: SEMANTIC_VIEW_FORMAT_VERSION,
    viewKind: 'scenario',
    subject: scenarioId,
    nodes: sortedNodes,
    edges,
    inspector: buildSemanticInspector(snapshot, scenarioId),
    overlays: [buildProvenanceOverlay(snapshot, [...sortedNodes, ...edges])]
  };
}
