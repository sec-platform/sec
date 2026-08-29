import type { SemanticEntity } from '../../semantic/engineering-ir/contract/entity-types.ts';
import type { SemanticFact, SemanticValue } from '../../semantic/engineering-ir/contract/fact-types.ts';
import type { ScenarioDefinition, ScenarioStepDefinition } from '../../semantic/engineering-ir/contract/scenario-types.ts';
import { CompilerError } from '../errors.ts';
import { compareCodeUnits } from '../../system-architecture/foundation/runtime/canonical.ts';

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
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const outgoing = new Map<string, SemanticFact[]>();
  for (const fact of facts) {
    const existing = outgoing.get(fact.subject);
    if (existing) existing.push(fact);
    else outgoing.set(fact.subject, [fact]);
  }

  return entities
    .filter((entity) => entity.kind === 'scenario')
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

      for (const fact of facts.filter((candidate) => candidate.predicate === 'PRECEDES' || candidate.predicate === 'HANDLES')) {
        const objectId = entityObjectId(fact);
        if ((stepIds.has(fact.subject) || (objectId !== undefined && stepIds.has(objectId))) &&
          (!stepIds.has(fact.subject) || objectId === undefined || !stepIds.has(objectId))) {
          throw new CompilerError('IR-SCENARIO-004', `Scenario relation Fact "${fact.id}" crosses the contained step boundary`);
        }
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
        const afterStepIds = facts
          .filter((fact) => fact.predicate === 'PRECEDES' && entityObjectId(fact) === stepEntity.id)
          .map((fact) => fact.subject)
          .sort((left, right) => compareCodeUnits(left, right));
        const handlerFacts = facts.filter((fact) => fact.predicate === 'HANDLES' && entityObjectId(fact) === stepEntity.id);
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
        factIds: facts
          .filter((fact) => relatedSubjectIds.has(fact.subject))
          .map((fact) => fact.id)
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
