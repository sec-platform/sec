import type { SemanticEntity } from '../../semantics/engineering-ir/entity-types.ts';
import type { SemanticFact, SemanticValue } from '../../semantics/engineering-ir/fact-types.ts';
import type { ScenarioDefinition, ScenarioStepDefinition } from '../../semantics/engineering-ir/scenario-types.ts';
import { compareCodeUnits } from '../../contracts/canonical.ts';
import { CompilerError } from '../errors.ts';

function entityObjectId(fact: SemanticFact): string | undefined {
  return fact.object.kind === 'entity' ? fact.object.entityId : undefined;
}

function singleFact(facts: readonly SemanticFact[], description: string): SemanticFact {
  if (facts.length !== 1) {
    throw new CompilerError('IR-SCENARIO-001', `${description} requires exactly one canonical Fact`, {
      factIds: facts.map((fact) => fact.id)
    });
  }
  return facts[0]!;
}

function retryMaxAttempts(value: SemanticValue, stepId: string): number {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !('maxAttempts' in value) ||
    !Number.isInteger(value.maxAttempts) ||
    (value.maxAttempts as number) < 1
  ) {
    throw new CompilerError('IR-SCENARIO-002', `Scenario step "${stepId}" RETRIES value must be { maxAttempts: positive integer }`);
  }
  return value.maxAttempts as number;
}

export function deriveScenarioDefinitions(
  entities: readonly SemanticEntity[],
  facts: readonly SemanticFact[]
): ScenarioDefinition[] {
  const scenarios = entities.filter((entity) => entity.kind === 'scenario');
  if (scenarios.length === 0) return [];
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const outgoing = new Map<string, SemanticFact[]>();
  const incomingRelations = new Map<string, SemanticFact[]>();
  const relationOrder = new Map<SemanticFact, number>();
  for (const fact of facts) {
    const existing = outgoing.get(fact.subject);
    if (existing) existing.push(fact);
    else outgoing.set(fact.subject, [fact]);
    if (fact.predicate === 'PRECEDES' || fact.predicate === 'HANDLES') {
      // Keep the original first-error order, including repeated object references.
      if (!relationOrder.has(fact)) relationOrder.set(fact, relationOrder.size);
      const objectId = entityObjectId(fact);
      if (objectId !== undefined) {
        const incoming = incomingRelations.get(objectId);
        if (incoming) incoming.push(fact);
        else incomingRelations.set(objectId, [fact]);
      }
    }
  }

  return scenarios
    .map((scenarioEntity) => {
      const scenarioFacts = outgoing.get(scenarioEntity.id) ?? [];
      const entryFact = singleFact(
        scenarioFacts.filter((fact) => fact.predicate === 'INVOKES' && fact.object.kind === 'entity'),
        `Scenario "${scenarioEntity.id}" entry`
      );
      const entryEntityId = entityObjectId(entryFact)!;
      if (entityById.get(entryEntityId)?.kind !== 'operation') {
        throw new CompilerError('IR-SCENARIO-003', `Scenario "${scenarioEntity.id}" entry must reference an operation`);
      }

      const stepEntities = scenarioFacts
        .filter((fact) => fact.predicate === 'CONTAINS' && fact.object.kind === 'entity')
        .map((fact) => entityById.get(entityObjectId(fact)!))
        .filter((entity): entity is SemanticEntity => entity?.kind === 'scenario-step')
        .sort((left, right) => compareCodeUnits(left.id, right.id));
      const stepIds = new Set(stepEntities.map((entity) => entity.id));

      // Inspect only incident relations, not every Fact for every scenario.
      // Both directions matter: an outside step can point into this scenario.
      let crossingFact: SemanticFact | undefined;
      for (const stepId of stepIds) {
        for (const incident of [outgoing.get(stepId) ?? [], incomingRelations.get(stepId) ?? []]) {
          for (const fact of incident) {
            if (fact.predicate !== 'PRECEDES' && fact.predicate !== 'HANDLES') continue;
            const objectId = entityObjectId(fact);
            if ((!stepIds.has(fact.subject) || objectId === undefined || !stepIds.has(objectId)) &&
              (crossingFact === undefined || relationOrder.get(fact)! < relationOrder.get(crossingFact)!)) {
              crossingFact = fact;
            }
          }
        }
      }
      if (crossingFact !== undefined) {
        throw new CompilerError('IR-SCENARIO-004', `Scenario relation Fact "${crossingFact.id}" crosses the contained step boundary`);
      }

      const steps: ScenarioStepDefinition[] = stepEntities.map((stepEntity) => {
        const stepFacts = outgoing.get(stepEntity.id) ?? [];
        const invokeFact = singleFact(
          stepFacts.filter((fact) => fact.predicate === 'INVOKES' && fact.object.kind === 'entity'),
          `Scenario step "${stepEntity.id}" invocation`
        );
        const operationEntityId = entityObjectId(invokeFact)!;
        if (entityById.get(operationEntityId)?.kind !== 'operation') {
          throw new CompilerError('IR-SCENARIO-003', `Scenario step "${stepEntity.id}" must invoke an operation`);
        }

        const awaitFacts = stepFacts.filter((fact) => fact.predicate === 'AWAITS');
        if (awaitFacts.length > 1 || (awaitFacts[0] && entityObjectId(awaitFacts[0]) !== operationEntityId)) {
          throw new CompilerError('IR-SCENARIO-005', `Scenario step "${stepEntity.id}" AWAITS must reference its invoked operation`);
        }
        const retryFacts = stepFacts.filter((fact) => fact.predicate === 'RETRIES');
        if (retryFacts.length > 1 || (retryFacts[0] && retryFacts[0].object.kind !== 'value')) {
          throw new CompilerError('IR-SCENARIO-002', `Scenario step "${stepEntity.id}" requires at most one value RETRIES Fact`);
        }
        const incoming = incomingRelations.get(stepEntity.id) ?? [];
        const afterStepIds = incoming
          .filter((fact) => fact.predicate === 'PRECEDES')
          .map((fact) => fact.subject)
          .sort((left, right) => compareCodeUnits(left, right));
        const handlerFacts = incoming.filter((fact) => fact.predicate === 'HANDLES');
        if (handlerFacts.length > 1) {
          throw new CompilerError('IR-SCENARIO-006', `Scenario step "${stepEntity.id}" has multiple error handlers`);
        }

        return {
          id: stepEntity.id,
          operationEntityId,
          afterStepIds,
          awaits: awaitFacts.length === 1,
          ...(retryFacts[0] ? { retryMaxAttempts: retryMaxAttempts(retryFacts[0].object.kind === 'value' ? retryFacts[0].object.value : null, stepEntity.id) } : {}),
          ...(handlerFacts[0] ? { onErrorStepId: handlerFacts[0].subject } : {})
        };
      });

      const acceptanceEntityIds = scenarioFacts
        .filter((fact) => fact.predicate === 'VERIFIED_BY' && fact.object.kind === 'entity')
        .map((fact) => entityObjectId(fact)!)
        .sort((left, right) => compareCodeUnits(left, right));
      const relatedSubjectIds = new Set([scenarioEntity.id, ...stepIds]);

      return {
        id: scenarioEntity.id,
        label: scenarioEntity.label,
        entryEntityId,
        factIds: [...relatedSubjectIds]
          .flatMap((subject) => (outgoing.get(subject) ?? []).map((fact) => fact.id))
          .sort((left, right) => compareCodeUnits(left, right)),
        steps,
        acceptanceEntityIds
      };
    })
    .sort((left, right) => compareCodeUnits(left.id, right.id));
}

export function deriveScenarioDefinition(
  entities: readonly SemanticEntity[],
  facts: readonly SemanticFact[],
  scenarioId: string
): ScenarioDefinition | undefined {
  return deriveScenarioDefinitions(entities, facts).find((scenario) => scenario.id === scenarioId);
}
