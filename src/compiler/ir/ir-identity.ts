import { canonicalJson, digest, normalizedArtifactTarget } from '../../contracts/canonical.ts';
import { CodedFailure } from '../../contracts/failure.ts';
import { assertSemanticContractIdentityComponents, assertSemanticIdentityComponent, isSemanticIdentityComponent } from '../../semantics/definitions/identity-components.ts';
import type { LoadedSemanticContract } from '../../semantics/definitions/types.ts';
import type { SemanticAttribute, SemanticEntity, SemanticEntityKind, SemanticPrimitive } from '../../semantics/engineering-ir/entity-types.ts';
import type { SemanticFact, SemanticFactObject } from '../../semantics/engineering-ir/fact-types.ts';
import type { ScenarioDefinition } from '../../semantics/engineering-ir/scenario-types.ts';
import { normalizeAttributes, normalizeFactObject } from './ir-normalization.ts';
import type { InputRevisionDomain } from './ir-revision.ts';

export { normalizedArtifactTarget };

type FactIdentityInput = Pick<SemanticFact, 'subject' | 'predicate' | 'object'>;

export interface SemanticNamespaceOwner {
  identity: string;
  label: string;
}

/** Source identities must be admitted even when a declaration emits no IR entity.
 * Both fresh construction and cached snapshot validation use this same preflight.
 */
export function assertEngineeringIRInputIdentities(input: InputRevisionDomain): void {
  appEntityId(input.app.id);
  for (const block of input.resolvedBlocks) blockEntityId(block.id);
  for (const entry of input.manifests) {
    blockEntityId(entry.blockId);
    for (const capability of [...entry.manifest.requires, ...entry.manifest.provides]) capabilityEntityId(capability);
    for (const pin of entry.manifest.pins.inputs) portEntityId(entry.blockId, 'input', pin.id);
    for (const pin of entry.manifest.pins.outputs) portEntityId(entry.blockId, 'output', pin.id);
    for (const generator of entry.manifest.generators ?? []) {
      generatorEntityId(entry.blockId, generator.id);
      assertSemanticIdentityComponent(generator.contract, 'Generator contract id');
      assertSemanticIdentityComponent(generator.state, 'Generator state id');
    }
  }
  for (const id of input.acceptanceIds) acceptanceEntityId(id);
  for (const policy of input.policyDeclarations) verificationPolicyEntityId(policy.id);
  for (const loaded of input.semanticContracts ?? []) {
    blockEntityId(loaded.blockId);
    assertSemanticContractIdentityComponents(loaded.contract);
  }
  for (const flow of input.observedFlows ?? []) capabilityEntityId(flow.sourceCapability);
}

function assertAppIdentity(id: string | undefined): asserts id is string {
  if (!id?.trim()) {
    throw new CodedFailure('IR-IDENTITY-007', 'Engineering IR requires a non-empty app.id');
  }
  assertSemanticIdentityComponent(id, 'App id');
}

function scopedEntityId(kind: string, namespace: string, id: string): string {
  assertSemanticIdentityComponent(namespace, 'Semantic namespace');
  assertSemanticIdentityComponent(id, `${kind} id`);
  return `${kind}:${namespace}:${id}`;
}

export function blockEntityId(id: string): string {
  assertSemanticIdentityComponent(id, 'Block id');
  return `block:${id}`;
}

export function portEntityId(blockId: string, direction: 'input' | 'output', id: string): string {
  assertSemanticIdentityComponent(blockId, 'Port block id');
  assertSemanticIdentityComponent(id, 'Port id');
  if (direction !== 'input' && direction !== 'output') throw new CodedFailure('IR-IDENTITY-008', 'Invalid port direction');
  return `port:${blockId}:${direction}:${id}`;
}

export function acceptanceEntityId(id: string): string {
  assertSemanticIdentityComponent(id, 'Acceptance id');
  return `acceptance:${id}`;
}

export function verificationPolicyEntityId(id: string): string {
  assertSemanticIdentityComponent(id, 'Verification policy id');
  return `policy:${id}`;
}

/** Total v1 entity grammar, shared by construction and persisted IR validation. */
export function isCanonicalSemanticEntityIdentity(entity: Pick<SemanticEntity, 'id' | 'kind'>): boolean {
  const { id, kind } = entity;
  if (typeof id !== 'string' || id.includes('\u0000')) return false;
  if (kind === 'scenario-step') {
    const parts = id.split(':');
    // Colon is excluded from every component; #step itself remains legal text.
    // The suffix belongs only to the scenario-id component, never its namespace.
    return parts.length === 4 && parts[0] === 'scenario' &&
      isSemanticIdentityComponent(parts[1]) && parts[2]!.endsWith('#step') &&
      isSemanticIdentityComponent(parts[2]!.slice(0, -'#step'.length)) &&
      isSemanticIdentityComponent(parts[3]);
  }
  if (!id.startsWith(`${kind}:`)) return false;
  const body = id.slice(kind.length + 1);
  if (kind === 'artifact') return body.trim().length > 0 && normalizedArtifactTarget(body) === body;
  const parts = body.split(':');
  if (kind === 'port') return parts.length === 3 && isSemanticIdentityComponent(parts[0]) && (parts[1] === 'input' || parts[1] === 'output') && isSemanticIdentityComponent(parts[2]);
  if (kind === 'field') {
    if (parts.length !== 2 || !isSemanticIdentityComponent(parts[0])) return false;
    const target = parts[1]!.split('.');
    return target.length === 2 && target.every((part) => isSemanticIdentityComponent(part, true));
  }
  if (kind === 'responsibility-binding') return parts.length === 3 && isSemanticIdentityComponent(parts[0]) && isSemanticIdentityComponent(parts[1]) && /^[a-f0-9]{64}$/.test(parts[2]!);
  if (kind === 'generator') return parts.length === 2 && parts.every((part) => isSemanticIdentityComponent(part));
  if (['entity', 'responsibility', 'operation', 'scenario', 'state', 'event', 'permission', 'effect'].includes(kind)) {
    return parts.length === 2 && isSemanticIdentityComponent(parts[0]) && isSemanticIdentityComponent(parts[1], kind === 'entity');
  }
  if (kind === 'policy') return (parts.length === 1 || parts.length === 2) && parts.every((part) => isSemanticIdentityComponent(part));
  return ['app', 'block', 'capability', 'boundary', 'acceptance'].includes(kind) && parts.length === 1 && isSemanticIdentityComponent(body);
}

function assertCanonicalEntityIdentity(entity: Pick<SemanticEntity, 'id' | 'kind'>): void {
  if (!isCanonicalSemanticEntityIdentity(entity)) throw new CodedFailure('IR-IDENTITY-008', `Semantic entity "${entity.id}" has ambiguous or non-canonical ${entity.kind} identity; regenerate from valid source`);
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
  assertSemanticIdentityComponent(id, 'Capability id');
  return `capability:${id}`;
}

function objectKey(object: SemanticFactObject): string {
  const normalized = normalizeFactObject(object);
  return normalized.kind === 'entity'
    ? `entity:${normalized.entityId}`
    : `value:${JSON.stringify(normalized.value)}`;
}

export function factIdentity(input: FactIdentityInput): string {
  if (input.subject.includes('\u0000') || input.predicate.includes('\u0000') || (input.object.kind === 'entity' && input.object.entityId.includes('\u0000'))) {
    throw new CodedFailure('IR-IDENTITY-008', 'Fact identity components cannot contain NUL; regenerate from valid source');
  }
  return `${input.subject}\u0000${input.predicate}\u0000${objectKey(input.object)}`;
}

export function semanticEntity(
  id: string,
  kind: SemanticEntityKind,
  label: string,
  attributes: readonly SemanticAttribute[] = []
): SemanticEntity {
  assertCanonicalEntityIdentity({ id, kind });
  return { id, kind, label, attributes: normalizeAttributes(attributes) };
}

export function valueAttribute(key: string, value: SemanticPrimitive | string[]): SemanticAttribute {
  return { key, value };
}

export function contractEntityId(namespace: string, id: string): string {
  assertSemanticIdentityComponent(id, 'Entity id', true);
  return scopedEntityId('entity', namespace, id);
}

export function contractFieldId(namespace: string, entityId: string, fieldId: string): string {
  assertSemanticIdentityComponent(namespace, 'Semantic namespace');
  assertSemanticIdentityComponent(entityId, 'Entity id', true);
  assertSemanticIdentityComponent(fieldId, 'Field id', true);
  return `field:${namespace}:${entityId}.${fieldId}`;
}

export function contractResponsibilityId(namespace: string, id: string): string {
  return scopedEntityId('responsibility', namespace, id);
}

export function contractResponsibilityBindingId(
  namespace: string,
  responsibilityId: string,
  targetKind: string,
  targetId: string,
  declarationPath: string,
  declarationExportName: string
): string {
  assertSemanticIdentityComponent(namespace, 'Semantic namespace');
  assertSemanticIdentityComponent(responsibilityId, 'Responsibility id');
  assertSemanticIdentityComponent(targetKind, 'Binding target kind');
  assertCanonicalEntityIdentity({ id: targetId, kind: targetKind as SemanticEntityKind });
  return `responsibility-binding:${namespace}:${responsibilityId}:${digest(JSON.stringify({
    targetKind,
    targetId,
    declarationPath: normalizedArtifactTarget(declarationPath),
    declarationExportName
  }))}`;
}

export function contractOperationId(namespace: string, id: string): string {
  return scopedEntityId('operation', namespace, id);
}

export function contractStateId(namespace: string, id: string): string {
  return scopedEntityId('state', namespace, id);
}

export function contractEventId(namespace: string, id: string): string {
  return scopedEntityId('event', namespace, id);
}

export function contractPolicyId(namespace: string, id: string): string {
  return scopedEntityId('policy', namespace, id);
}

export function contractPermissionId(namespace: string, id: string): string {
  return scopedEntityId('permission', namespace, id);
}

export function contractEffectId(namespace: string, id: string): string {
  return scopedEntityId('effect', namespace, id);
}

export function contractScenarioId(namespace: string, id: string): string {
  return scopedEntityId('scenario', namespace, id);
}

export function generatorEntityId(blockId: string, generatorId: string): string {
  assertSemanticIdentityComponent(blockId, 'Generator block id');
  assertSemanticIdentityComponent(generatorId, 'Generator id');
  return `generator:${blockId}:${generatorId}`;
}

export function artifactEntityId(target: string): string {
  const id = `artifact:${normalizedArtifactTarget(target)}`;
  assertCanonicalEntityIdentity({ id, kind: 'artifact' });
  return id;
}

export function scenarioStepEntityId(scenarioId: string, stepId: string): string {
  assertCanonicalEntityIdentity({ id: scenarioId, kind: 'scenario' });
  assertSemanticIdentityComponent(stepId, 'Scenario step id');
  return `${scenarioId}#step:${stepId}`;
}


function semanticContractOwnerIdentity(input: LoadedSemanticContract): string {
  return digest(JSON.stringify({
    blockId: input.blockId,
    contractPath: input.contractPath,
    contract: canonicalJson(input.contract)
  }));
}

function semanticContractOwnerLabel(input: LoadedSemanticContract): string {
  return `${input.blockId}:${input.contract.id}@${input.contractPath}`;
}


export function addEntity(entities: Map<string, SemanticEntity>, entity: SemanticEntity): void {
  assertCanonicalEntityIdentity(entity);
  const existing = entities.get(entity.id);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(entity)) {
      throw new CodedFailure('IR-IDENTITY-001', `Semantic entity "${entity.id}" has conflicting definitions`);
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
    throw new CodedFailure(
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
    if (!entityIds.has(fact.subject)) throw new CodedFailure('IR-FACT-002', `Fact "${fact.id}" references missing subject "${fact.subject}"`);
    if (fact.object.kind === 'entity' && !entityIds.has(fact.object.entityId)) throw new CodedFailure('IR-FACT-003', `Fact "${fact.id}" references missing object "${fact.object.entityId}"`);
    if (fact.assertions.length === 0) throw new CodedFailure('IR-AUTHORITY-004', `Fact "${fact.id}" must include at least one assertion`);
    for (const assertion of fact.assertions) {
      if (!Number.isFinite(assertion.confidence) || assertion.confidence < 0 || assertion.confidence > 1) throw new CodedFailure('IR-AUTHORITY-001', `Fact assertion "${assertion.id}" confidence must be between 0 and 1`);
      if (assertion.provenance.length === 0) throw new CodedFailure('IR-AUTHORITY-002', `Fact assertion "${assertion.id}" must include provenance`);
    }
  }

  for (const scenario of scenarios) {
    if (!entityIds.has(scenario.id) || !entityIds.has(scenario.entryEntityId)) throw new CodedFailure('IR-FACT-004', `Scenario "${scenario.id}" references missing semantic entities`);
    for (const step of scenario.steps) if (!entityIds.has(step.operationEntityId)) throw new CodedFailure('IR-FACT-005', `Scenario "${scenario.id}" step "${step.id}" references missing operation "${step.operationEntityId}"`);
    for (const acceptanceEntityId of scenario.acceptanceEntityIds) if (!entityIds.has(acceptanceEntityId)) throw new CodedFailure('IR-FACT-006', `Scenario "${scenario.id}" references missing acceptance "${acceptanceEntityId}"`);
  }
}
