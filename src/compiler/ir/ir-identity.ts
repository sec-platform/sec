import { canonicalJson, rawSha256Hex, normalizedArtifactTarget } from '../../contracts/canonical.ts';
import type { LoadedSemanticContract } from '../../semantics/definitions/types.ts';
import type { SemanticAttribute, SemanticEntity, SemanticEntityKind, SemanticPrimitive } from '../../semantics/engineering-ir/entity-types.ts';
import type { SemanticFact, SemanticFactObject } from '../../semantics/engineering-ir/fact-types.ts';
import type { ScenarioDefinition } from '../../semantics/engineering-ir/scenario-types.ts';
import { CompilerError } from '../errors.ts';
import { normalizeAttributes, normalizeFactObject } from './ir-normalization.ts';

export { normalizedArtifactTarget };

type FactIdentityInput = Pick<SemanticFact, 'subject' | 'predicate' | 'object'>;

export interface SemanticNamespaceOwner {
  identity: string;
  label: string;
}

function assertAppIdentity(id: string | undefined): asserts id is string {
  if (!id?.trim()) {
    throw new CompilerError('IR-IDENTITY-007', 'Engineering IR requires a non-empty app.id');
  }
}

export function appEntityId(id: string | undefined): string {
  assertAppIdentity(id);
  return `app:${id}`;
}

export function engineeringGraphId(id: string | undefined): string {
  assertAppIdentity(id);
  return `engineering-ir:${id}`;
}

export function capabilityEntityId(id: string): string {
  return `capability:${id}`;
}

function objectKey(object: SemanticFactObject): string {
  const normalized = normalizeFactObject(object);
  return normalized.kind === 'entity'
    ? `entity:${normalized.entityId}`
    : `value:${JSON.stringify(normalized.value)}`;
}

export function factIdentity(input: FactIdentityInput): string {
  return `${input.subject}\u0000${input.predicate}\u0000${objectKey(input.object)}`;
}

export function semanticEntity(
  id: string,
  kind: SemanticEntityKind,
  label: string,
  attributes: readonly SemanticAttribute[] = []
): SemanticEntity {
  return { id, kind, label, attributes: normalizeAttributes(attributes) };
}

export function valueAttribute(key: string, value: SemanticPrimitive | string[]): SemanticAttribute {
  return { key, value };
}

export function contractEntityId(namespace: string, id: string): string {
  return `entity:${namespace}:${id}`;
}

export function contractFieldId(namespace: string, entityId: string, fieldId: string): string {
  return `field:${namespace}:${entityId}.${fieldId}`;
}

export function contractResponsibilityId(namespace: string, id: string): string {
  return `responsibility:${namespace}:${id}`;
}

export function contractResponsibilityBindingId(
  namespace: string,
  responsibilityId: string,
  targetKind: string,
  targetId: string,
  declarationPath: string,
  declarationExportName: string
): string {
  return `responsibility-binding:${namespace}:${responsibilityId}:${rawSha256Hex(JSON.stringify({
    targetKind,
    targetId,
    declarationPath: normalizedArtifactTarget(declarationPath),
    declarationExportName
  }))}`;
}

export function contractOperationId(namespace: string, id: string): string {
  return `operation:${namespace}:${id}`;
}

export function contractStateId(namespace: string, id: string): string {
  return `state:${namespace}:${id}`;
}

export function contractEventId(namespace: string, id: string): string {
  return `event:${namespace}:${id}`;
}

export function contractPolicyId(namespace: string, id: string): string {
  return `policy:${namespace}:${id}`;
}

export function contractPermissionId(namespace: string, id: string): string {
  return `permission:${namespace}:${id}`;
}

export function contractEffectId(namespace: string, id: string): string {
  return `effect:${namespace}:${id}`;
}

export function contractScenarioId(namespace: string, id: string): string {
  return `scenario:${namespace}:${id}`;
}

export function generatorEntityId(blockId: string, generatorId: string): string {
  return `generator:${blockId}:${generatorId}`;
}

export function artifactEntityId(target: string): string {
  return `artifact:${normalizedArtifactTarget(target)}`;
}

export function scenarioStepEntityId(scenarioId: string, stepId: string): string {
  return `${scenarioId}#step:${stepId}`;
}


function semanticContractOwnerIdentity(input: LoadedSemanticContract): string {
  return rawSha256Hex(JSON.stringify({
    blockId: input.blockId,
    contractPath: input.contractPath,
    contract: canonicalJson(input.contract)
  }));
}

function semanticContractOwnerLabel(input: LoadedSemanticContract): string {
  return `${input.blockId}:${input.contract.id}@${input.contractPath}`;
}


export function addEntity(entities: Map<string, SemanticEntity>, entity: SemanticEntity): void {
  const existing = entities.get(entity.id);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(entity)) {
      throw new CompilerError('IR-IDENTITY-001', `Semantic entity "${entity.id}" has conflicting definitions`);
    }
    return;
  }
  entities.set(entity.id, entity);
}

export function claimSemanticNamespace(
  semanticNamespaceOwnerByNamespace: Map<string, SemanticNamespaceOwner>,
  contractInput: LoadedSemanticContract
): void {
  const namespace = contractInput.contract.namespace;
  const owner = {
    identity: semanticContractOwnerIdentity(contractInput),
    label: semanticContractOwnerLabel(contractInput)
  };
  const existing = semanticNamespaceOwnerByNamespace.get(namespace);
  if (existing && existing.identity !== owner.identity) {
    throw new CompilerError(
      'IR-IDENTITY-006',
      `Semantic namespace "${namespace}" is claimed by distinct contracts "${existing.label}" and "${owner.label}"`,
      { namespace, existingOwner: existing.label, incomingOwner: owner.label }
    );
  }
  semanticNamespaceOwnerByNamespace.set(namespace, owner);
}

export function assertEngineeringIRReferences(
  entityIds: ReadonlySet<string>,
  facts: readonly SemanticFact[],
  scenarios: readonly ScenarioDefinition[]
): void {
  for (const fact of facts) {
    if (!entityIds.has(fact.subject)) throw new CompilerError('IR-FACT-002', `Fact "${fact.id}" references missing subject "${fact.subject}"`);
    if (fact.object.kind === 'entity' && !entityIds.has(fact.object.entityId)) throw new CompilerError('IR-FACT-003', `Fact "${fact.id}" references missing object "${fact.object.entityId}"`);
    if (fact.assertions.length === 0) throw new CompilerError('IR-AUTHORITY-004', `Fact "${fact.id}" must include at least one assertion`);
    for (const assertion of fact.assertions) {
      if (assertion.confidence < 0 || assertion.confidence > 1) throw new CompilerError('IR-AUTHORITY-001', `Fact assertion "${assertion.id}" confidence must be between 0 and 1`);
      if (assertion.provenance.length === 0) throw new CompilerError('IR-AUTHORITY-002', `Fact assertion "${assertion.id}" must include provenance`);
    }
  }

  for (const scenario of scenarios) {
    if (!entityIds.has(scenario.id) || !entityIds.has(scenario.entryEntityId)) throw new CompilerError('IR-FACT-004', `Scenario "${scenario.id}" references missing semantic entities`);
    for (const step of scenario.steps) if (!entityIds.has(step.operationEntityId)) throw new CompilerError('IR-FACT-005', `Scenario "${scenario.id}" step "${step.id}" references missing operation "${step.operationEntityId}"`);
    for (const acceptanceEntityId of scenario.acceptanceEntityIds) if (!entityIds.has(acceptanceEntityId)) throw new CompilerError('IR-FACT-006', `Scenario "${scenario.id}" references missing acceptance "${acceptanceEntityId}"`);
  }
}
