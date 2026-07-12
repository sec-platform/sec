import type {
  FactProvenance,
  SemanticEntity
} from '../../shared/engineering-ir-types.ts';
import type { LoadedSemanticContract } from '../../shared/semantic-contract-types.ts';
import { splitLinkedSemanticReference } from '../semantic-linker.ts';
import type { FactInput } from './ir-fact-store.ts';
import {
  contractEffectId,
  contractEntityId,
  contractEventId,
  contractFieldId,
  contractOperationId,
  contractPermissionId,
  contractPolicyId,
  contractResponsibilityId,
  contractScenarioId,
  contractStateId,
  scenarioStepEntityId,
  semanticEntity,
  valueAttribute
} from './ir-identity.ts';
import { uniqueSorted } from './ir-normalization.ts';

export interface BuildSink {
  addEntity(entity: SemanticEntity): void;
  addFact(input: FactInput): string;
  claimSemanticNamespace(input: LoadedSemanticContract): void;
}

function contractProvenance(input: LoadedSemanticContract): FactProvenance[] {
  return [{
    kind: 'contract',
    sourceId: `semantic-contract:${input.contract.id}`,
    sourcePath: input.contractPath
  }];
}

function addDeclaredEntity(sink: BuildSink, blockId: string, provenance: FactProvenance[], entity: SemanticEntity): void {
  sink.addEntity(entity);
  sink.addFact({
    subject: blockId,
    predicate: 'DECLARES',
    object: { kind: 'entity', entityId: entity.id },
    authority: 'authoritative',
    provenance
  });
}

function linkedEntityId(
  reference: string,
  identity: (namespace: string, id: string) => string
): string {
  const { namespace, id } = splitLinkedSemanticReference(reference);
  return identity(namespace, id);
}

function linkedTargetId(reference: string): string {
  const { namespace, id } = splitLinkedSemanticReference(reference);
  const [entityId, fieldId] = id.split('.');
  return fieldId
    ? contractFieldId(namespace, entityId!, fieldId)
    : contractEntityId(namespace, entityId!);
}

export function appendSemanticContract(input: LoadedSemanticContract, sink: BuildSink): void {
  sink.claimSemanticNamespace(input);
  const { contract } = input;
  const blockId = `block:${input.blockId}`;
  const provenance = contractProvenance(input);

  for (const entity of contract.entities) {
    const entityId = contractEntityId(contract.namespace, entity.id);
    addDeclaredEntity(sink, blockId, provenance, semanticEntity(entityId, 'entity', entity.label ?? entity.id));
    for (const field of entity.fields) {
      const fieldId = contractFieldId(contract.namespace, entity.id, field.id);
      addDeclaredEntity(sink, blockId, provenance, semanticEntity(fieldId, 'field', field.id, [
        valueAttribute('type', field.type),
        valueAttribute('required', field.required ?? false),
        valueAttribute('mutable', field.mutable ?? false)
      ]));
      sink.addFact({
        subject: entityId,
        predicate: 'CONTAINS',
        object: { kind: 'entity', entityId: fieldId },
        authority: 'authoritative',
        provenance
      });
    }
  }

  for (const responsibility of contract.responsibilities) {
    addDeclaredEntity(sink, blockId, provenance, semanticEntity(
      contractResponsibilityId(contract.namespace, responsibility.id),
      'responsibility',
      responsibility.label ?? responsibility.id,
      [valueAttribute('role', responsibility.role)]
    ));
  }

  for (const operation of contract.operations) {
    addDeclaredEntity(sink, blockId, provenance, semanticEntity(
      contractOperationId(contract.namespace, operation.id),
      'operation',
      operation.label ?? operation.id,
      [
        valueAttribute('inputs', operation.inputs),
        ...(operation.output ? [valueAttribute('output', operation.output)] : [])
      ]
    ));
  }

  for (const event of contract.events) {
    addDeclaredEntity(sink, blockId, provenance, semanticEntity(
      contractEventId(contract.namespace, event.id),
      'event',
      event.label ?? event.id,
      event.payloadType ? [valueAttribute('payloadType', event.payloadType)] : []
    ));
  }

  for (const policy of contract.policies) {
    const semanticPolicyId = contractPolicyId(contract.namespace, policy.id);
    addDeclaredEntity(sink, blockId, provenance, semanticEntity(
      semanticPolicyId,
      'policy',
      policy.label ?? policy.id,
      policy.rule ? [valueAttribute('rule', policy.rule)] : []
    ));
    for (const verificationPolicyId of policy.verifiedBy ?? []) {
      const verificationEntityId = `policy:${verificationPolicyId}`;
      sink.addFact({ subject: verificationEntityId, predicate: 'ENFORCES', object: { kind: 'entity', entityId: semanticPolicyId }, authority: 'authoritative', provenance });
      sink.addFact({ subject: semanticPolicyId, predicate: 'VERIFIED_BY', object: { kind: 'entity', entityId: verificationEntityId }, authority: 'authoritative', provenance });
    }
  }

  for (const permission of contract.permissions) {
    addDeclaredEntity(sink, blockId, provenance, semanticEntity(
      contractPermissionId(contract.namespace, permission.id),
      'permission',
      permission.label ?? permission.id,
      permission.scope ? [valueAttribute('scope', permission.scope)] : []
    ));
  }

  for (const effect of contract.effects) {
    addDeclaredEntity(sink, blockId, provenance, semanticEntity(
      contractEffectId(contract.namespace, effect.id),
      'effect',
      effect.label ?? effect.id,
      [
        valueAttribute('effectKind', effect.kind),
        ...(effect.target ? [valueAttribute('target', effect.target)] : [])
      ]
    ));
  }

  for (const state of contract.states) {
    addDeclaredEntity(sink, blockId, provenance, semanticEntity(
      contractStateId(contract.namespace, state.id),
      'state',
      state.label ?? state.id,
      [valueAttribute('values', uniqueSorted(state.values))]
    ));
  }

  for (const scenario of contract.scenarios) {
    addDeclaredEntity(sink, blockId, provenance, semanticEntity(
      contractScenarioId(contract.namespace, scenario.id),
      'scenario',
      scenario.label ?? scenario.id
    ));
  }

  for (const responsibility of contract.responsibilities) {
    const responsibilityId = contractResponsibilityId(contract.namespace, responsibility.id);
    for (const target of responsibility.owns) {
      sink.addFact({ subject: responsibilityId, predicate: 'OWNS', object: { kind: 'entity', entityId: linkedTargetId(target) }, authority: 'authoritative', provenance });
    }
    for (const operation of responsibility.implements) {
      sink.addFact({ subject: responsibilityId, predicate: 'IMPLEMENTS', object: { kind: 'entity', entityId: linkedEntityId(operation, contractOperationId) }, authority: 'authoritative', provenance });
    }
    for (const dependency of responsibility.dependsOn) {
      sink.addFact({ subject: responsibilityId, predicate: 'DEPENDS_ON', object: { kind: 'entity', entityId: linkedEntityId(dependency, contractResponsibilityId) }, authority: 'authoritative', provenance });
    }
  }

  for (const operation of contract.operations) {
    const operationId = contractOperationId(contract.namespace, operation.id);
    for (const target of operation.reads) sink.addFact({ subject: operationId, predicate: 'READS', object: { kind: 'entity', entityId: linkedTargetId(target) }, authority: 'authoritative', provenance });
    for (const target of operation.writes) sink.addFact({ subject: operationId, predicate: 'WRITES', object: { kind: 'entity', entityId: linkedTargetId(target) }, authority: 'authoritative', provenance });
    for (const target of operation.mutates) sink.addFact({ subject: operationId, predicate: 'MUTATES', object: { kind: 'entity', entityId: linkedTargetId(target) }, authority: 'authoritative', provenance });
    for (const policy of operation.requiresPolicies) sink.addFact({ subject: operationId, predicate: 'REQUIRES', object: { kind: 'entity', entityId: linkedEntityId(policy, contractPolicyId) }, authority: 'authoritative', provenance });
    for (const permission of operation.requiresPermissions) sink.addFact({ subject: operationId, predicate: 'REQUIRES_PERMISSION', object: { kind: 'entity', entityId: linkedEntityId(permission, contractPermissionId) }, authority: 'authoritative', provenance });
    for (const effect of operation.performsEffects) sink.addFact({ subject: operationId, predicate: 'PERFORMS_EFFECT', object: { kind: 'entity', entityId: linkedEntityId(effect, contractEffectId) }, authority: 'authoritative', provenance });
    for (const event of operation.emits) sink.addFact({ subject: operationId, predicate: 'EMITS', object: { kind: 'entity', entityId: linkedEntityId(event, contractEventId) }, authority: 'authoritative', provenance });
    for (const invoked of operation.invokes) sink.addFact({ subject: operationId, predicate: 'INVOKES', object: { kind: 'entity', entityId: linkedEntityId(invoked, contractOperationId) }, authority: 'authoritative', provenance });
    for (const awaited of operation.awaits) sink.addFact({ subject: operationId, predicate: 'AWAITS', object: { kind: 'entity', entityId: linkedEntityId(awaited, contractOperationId) }, authority: 'authoritative', provenance });
  }

  for (const state of contract.states) {
    const stateId = contractStateId(contract.namespace, state.id);
    const ownerId = linkedEntityId(state.owner, contractResponsibilityId);
    const { namespace: entityNamespace, id: entityId } = splitLinkedSemanticReference(state.entity);
    const fieldId = contractFieldId(entityNamespace, entityId, state.field);
    sink.addFact({ subject: ownerId, predicate: 'OWNS', object: { kind: 'entity', entityId: stateId }, authority: 'authoritative', provenance });
    sink.addFact({ subject: stateId, predicate: 'DECLARES', object: { kind: 'entity', entityId: fieldId }, authority: 'authoritative', provenance });
    for (const value of state.values) sink.addFact({ subject: stateId, predicate: 'GUARANTEES', object: { kind: 'value', value }, authority: 'authoritative', provenance });
    for (const transition of state.transitions) {
      const operationId = linkedEntityId(transition.by, contractOperationId);
      sink.addFact({
        subject: stateId,
        predicate: 'TRANSITIONS_TO',
        object: {
          kind: 'value',
          value: { from: transition.from, to: transition.to, by: operationId }
        },
        authority: 'authoritative',
        provenance
      });
      sink.addFact({ subject: operationId, predicate: 'MUTATES', object: { kind: 'entity', entityId: stateId }, authority: 'authoritative', provenance });
    }
  }

  for (const scenario of contract.scenarios) {
    const scenarioId = contractScenarioId(contract.namespace, scenario.id);
    const entryEntityId = linkedEntityId(scenario.entry, contractOperationId);
    sink.addFact({ subject: scenarioId, predicate: 'INVOKES', object: { kind: 'entity', entityId: entryEntityId }, authority: 'authoritative', provenance });

    for (const step of [...scenario.steps].sort((left, right) => left.id.localeCompare(right.id))) {
      const stepEntityId = scenarioStepEntityId(scenarioId, step.id);
      const operationEntityId = linkedEntityId(step.operation, contractOperationId);
      addDeclaredEntity(sink, blockId, provenance, semanticEntity(stepEntityId, 'scenario-step', step.id));
      sink.addFact({ subject: scenarioId, predicate: 'CONTAINS', object: { kind: 'entity', entityId: stepEntityId }, authority: 'authoritative', provenance });
      sink.addFact({ subject: stepEntityId, predicate: 'INVOKES', object: { kind: 'entity', entityId: operationEntityId }, authority: 'authoritative', provenance });
      if (step.awaits) {
        sink.addFact({ subject: stepEntityId, predicate: 'AWAITS', object: { kind: 'entity', entityId: operationEntityId }, authority: 'authoritative', provenance });
      }
      if (step.retryMaxAttempts !== undefined) {
        sink.addFact({ subject: stepEntityId, predicate: 'RETRIES', object: { kind: 'value', value: { maxAttempts: step.retryMaxAttempts } }, authority: 'authoritative', provenance });
      }
      for (const dependencyId of uniqueSorted(step.after)) {
        sink.addFact({
          subject: scenarioStepEntityId(scenarioId, dependencyId),
          predicate: 'PRECEDES',
          object: { kind: 'entity', entityId: stepEntityId },
          authority: 'authoritative',
          provenance
        });
      }
      if (step.onError) {
        sink.addFact({
          subject: scenarioStepEntityId(scenarioId, step.onError),
          predicate: 'HANDLES',
          object: { kind: 'entity', entityId: stepEntityId },
          authority: 'authoritative',
          provenance
        });
      }
    }

    const acceptanceEntityIds = scenario.acceptance.map((acceptanceId) => `acceptance:${acceptanceId}`);
    for (const acceptanceEntityId of acceptanceEntityIds) {
      sink.addFact({ subject: scenarioId, predicate: 'VERIFIED_BY', object: { kind: 'entity', entityId: acceptanceEntityId }, authority: 'authoritative', provenance });
    }
  }
}
