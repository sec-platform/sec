import { createHash } from 'node:crypto';

import {
  ENGINEERING_IR_FORMAT_VERSION,
  type EngineeringIR,
  type EvidenceReference,
  type FactProvenance,
  type ScenarioDefinition,
  type SemanticAttribute,
  type SemanticAttributeValue,
  type SemanticAuthority,
  type SemanticEntity,
  type SemanticEntityId,
  type SemanticEntityKind,
  type SemanticFact,
  type SemanticFactObject,
  type SemanticPredicate,
  type SemanticPrimitive,
  type SemanticValue
} from '../../shared/engineering-ir-types.ts';
import { CompilerError } from '../../shared/errors.ts';
import type { ResolvedBlock, SlotTask } from '../../shared/lock-types.ts';
import type { BlockManifest } from '../../shared/plan-manifest-types.ts';
import type { ProvenanceArtifact } from '../../shared/provenance-types.ts';
import type { LoadedSemanticContract, SemanticContract } from '../../shared/semantic-contract-types.ts';

export interface EngineeringIRManifestInput {
  blockId: string;
  manifestPath?: string;
  manifest: Pick<BlockManifest, 'requires' | 'provides' | 'pins'>;
}

export interface BuildEngineeringIRInput {
  app: { name: string };
  resolvedBlocks: readonly ResolvedBlock[];
  manifests: readonly EngineeringIRManifestInput[];
  slotTasks: readonly SlotTask[];
  acceptanceIds: readonly string[];
  policyIds: readonly string[];
  provenanceArtifacts: readonly ProvenanceArtifact[];
  semanticContracts?: readonly LoadedSemanticContract[];
}

interface FactInput {
  subject: SemanticEntityId;
  predicate: SemanticPredicate;
  object: SemanticFactObject;
  authority: SemanticAuthority;
  provenance: FactProvenance[];
  evidence?: EvidenceReference[];
  confidence?: number;
}

interface BuildSink {
  addEntity(entity: SemanticEntity): void;
  addFact(input: FactInput): string;
  addScenario(scenario: ScenarioDefinition): void;
}

const AUTHORITY_STRENGTH: Record<SemanticAuthority, number> = {
  inferred: 0,
  observed: 1,
  derived: 2,
  authoritative: 3
};

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function uniqueSortedByKey<Value>(values: readonly Value[], keyOf: (value: Value) => string): Value[] {
  const byKey = new Map<string, Value>();
  for (const value of values) byKey.set(keyOf(value), value);
  return [...byKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
}

function normalizeSemanticValue(value: SemanticValue): SemanticValue {
  if (Array.isArray(value)) return value.map(normalizeSemanticValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeSemanticValue(entry)])
    );
  }
  return value;
}

function normalizeFactObject(object: SemanticFactObject): SemanticFactObject {
  return object.kind === 'entity'
    ? object
    : { kind: 'value', value: normalizeSemanticValue(object.value) };
}

function normalizeAttributeValue(value: SemanticAttributeValue): SemanticAttributeValue {
  return Array.isArray(value) ? uniqueSorted(value) : value;
}

function normalizeAttributes(attributes: readonly SemanticAttribute[]): SemanticAttribute[] {
  return [...attributes]
    .map((attribute) => ({ ...attribute, value: normalizeAttributeValue(attribute.value) }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function objectKey(object: SemanticFactObject): string {
  const normalized = normalizeFactObject(object);
  return normalized.kind === 'entity'
    ? `entity:${normalized.entityId}`
    : `value:${JSON.stringify(normalized.value)}`;
}

function factIdentity(input: Pick<FactInput, 'subject' | 'predicate' | 'object'>): string {
  return `${input.subject}\u0000${input.predicate}\u0000${objectKey(input.object)}`;
}

function provenanceKey(provenance: FactProvenance): string {
  return [provenance.kind, provenance.sourceId, provenance.sourcePath ?? '', provenance.revision ?? ''].join('\u0000');
}

function evidenceKey(evidence: EvidenceReference): string {
  return [evidence.kind, evidence.ref, evidence.digest ?? ''].join('\u0000');
}

function normalizeProvenance(provenance: readonly FactProvenance[]): FactProvenance[] {
  return uniqueSortedByKey(provenance, provenanceKey);
}

function normalizeEvidence(evidence: readonly EvidenceReference[]): EvidenceReference[] {
  return uniqueSortedByKey(evidence, evidenceKey);
}

function assertFactInput(input: FactInput): void {
  const confidence = input.confidence ?? 1;
  if (confidence < 0 || confidence > 1) {
    throw new CompilerError('IR-AUTHORITY-001', 'Semantic fact confidence must be between 0 and 1', {
      subject: input.subject,
      predicate: input.predicate,
      object: input.object,
      confidence
    });
  }
  if (input.provenance.length === 0) {
    throw new CompilerError('IR-AUTHORITY-002', 'Semantic fact must include provenance', {
      subject: input.subject,
      predicate: input.predicate,
      object: input.object
    });
  }
}

function buildFact(input: FactInput): SemanticFact {
  assertFactInput(input);
  const normalizedObject = normalizeFactObject(input.object);
  const identity = factIdentity({ ...input, object: normalizedObject });
  return {
    id: `fact:${digest(identity).slice(0, 24)}`,
    subject: input.subject,
    predicate: input.predicate,
    object: normalizedObject,
    authority: input.authority,
    confidence: input.confidence ?? 1,
    provenance: normalizeProvenance(input.provenance),
    evidence: normalizeEvidence(input.evidence ?? []),
    validFrom: 'build'
  };
}

function mergeFacts(existing: SemanticFact, incoming: SemanticFact): SemanticFact {
  if (factIdentity(existing) !== factIdentity(incoming)) {
    throw new CompilerError('IR-FACT-001', `Semantic fact id "${existing.id}" collides across different triples`, {
      existing: { subject: existing.subject, predicate: existing.predicate, object: existing.object },
      incoming: { subject: incoming.subject, predicate: incoming.predicate, object: incoming.object }
    });
  }

  const authorityDifference = AUTHORITY_STRENGTH[incoming.authority] - AUTHORITY_STRENGTH[existing.authority];
  const authority = authorityDifference > 0 ? incoming.authority : existing.authority;
  const confidence = authorityDifference > 0
    ? incoming.confidence
    : authorityDifference < 0
      ? existing.confidence
      : Math.max(existing.confidence, incoming.confidence);

  return {
    ...existing,
    authority,
    confidence,
    provenance: normalizeProvenance([...existing.provenance, ...incoming.provenance]),
    evidence: normalizeEvidence([...existing.evidence, ...incoming.evidence])
  };
}

function semanticEntity(
  id: string,
  kind: SemanticEntityKind,
  label: string,
  attributes: readonly SemanticAttribute[] = []
): SemanticEntity {
  return { id, kind, label, attributes: normalizeAttributes(attributes) };
}

function valueAttribute(key: string, value: SemanticPrimitive | string[]): SemanticAttribute {
  return { key, value };
}

function manifestProvenance(entry: EngineeringIRManifestInput): FactProvenance[] {
  return [{
    kind: 'contract',
    sourceId: `manifest:${entry.blockId}`,
    ...(entry.manifestPath ? { sourcePath: entry.manifestPath } : {})
  }];
}

function compilerProvenance(sourceId: string): FactProvenance[] {
  return [{ kind: 'compiler', sourceId }];
}

function contractProvenance(input: LoadedSemanticContract): FactProvenance[] {
  return [{
    kind: 'contract',
    sourceId: `semantic-contract:${input.contract.id}`,
    sourcePath: input.contractPath
  }];
}

function contractEntityId(namespace: string, id: string): string {
  return `entity:${namespace}:${id}`;
}

function contractFieldId(namespace: string, entityId: string, fieldId: string): string {
  return `field:${namespace}:${entityId}.${fieldId}`;
}

function contractResponsibilityId(namespace: string, id: string): string {
  return `responsibility:${namespace}:${id}`;
}

function contractOperationId(namespace: string, id: string): string {
  return `operation:${namespace}:${id}`;
}

function contractStateId(namespace: string, id: string): string {
  return `state:${namespace}:${id}`;
}

function contractEventId(namespace: string, id: string): string {
  return `event:${namespace}:${id}`;
}

function contractPolicyId(namespace: string, id: string): string {
  return `policy:${namespace}:${id}`;
}

function contractPermissionId(namespace: string, id: string): string {
  return `permission:${namespace}:${id}`;
}

function contractEffectId(namespace: string, id: string): string {
  return `effect:${namespace}:${id}`;
}

function contractScenarioId(namespace: string, id: string): string {
  return `scenario:${namespace}:${id}`;
}

function contractTargetId(contract: SemanticContract, target: string): string {
  const [entityId, fieldId] = target.split('.');
  return fieldId
    ? contractFieldId(contract.namespace, entityId!, fieldId)
    : contractEntityId(contract.namespace, entityId!);
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

function appendSemanticContract(input: LoadedSemanticContract, sink: BuildSink): void {
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
    addDeclaredEntity(sink, blockId, provenance, semanticEntity(
      contractPolicyId(contract.namespace, policy.id),
      'policy',
      policy.label ?? policy.id,
      policy.rule ? [valueAttribute('rule', policy.rule)] : []
    ));
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
      [valueAttribute('values', state.values)]
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
      sink.addFact({ subject: responsibilityId, predicate: 'OWNS', object: { kind: 'entity', entityId: contractTargetId(contract, target) }, authority: 'authoritative', provenance });
    }
    for (const operation of responsibility.implements) {
      sink.addFact({ subject: responsibilityId, predicate: 'IMPLEMENTS', object: { kind: 'entity', entityId: contractOperationId(contract.namespace, operation) }, authority: 'authoritative', provenance });
    }
    for (const dependency of responsibility.dependsOn) {
      sink.addFact({ subject: responsibilityId, predicate: 'DEPENDS_ON', object: { kind: 'entity', entityId: contractResponsibilityId(contract.namespace, dependency) }, authority: 'authoritative', provenance });
    }
  }

  for (const operation of contract.operations) {
    const operationId = contractOperationId(contract.namespace, operation.id);
    for (const target of operation.reads) sink.addFact({ subject: operationId, predicate: 'READS', object: { kind: 'entity', entityId: contractTargetId(contract, target) }, authority: 'authoritative', provenance });
    for (const target of operation.writes) sink.addFact({ subject: operationId, predicate: 'WRITES', object: { kind: 'entity', entityId: contractTargetId(contract, target) }, authority: 'authoritative', provenance });
    for (const target of operation.mutates) sink.addFact({ subject: operationId, predicate: 'MUTATES', object: { kind: 'entity', entityId: contractTargetId(contract, target) }, authority: 'authoritative', provenance });
    for (const policy of operation.requiresPolicies) sink.addFact({ subject: operationId, predicate: 'REQUIRES', object: { kind: 'entity', entityId: contractPolicyId(contract.namespace, policy) }, authority: 'authoritative', provenance });
    for (const permission of operation.requiresPermissions) sink.addFact({ subject: operationId, predicate: 'REQUIRES_PERMISSION', object: { kind: 'entity', entityId: contractPermissionId(contract.namespace, permission) }, authority: 'authoritative', provenance });
    for (const effect of operation.performsEffects) sink.addFact({ subject: operationId, predicate: 'PERFORMS_EFFECT', object: { kind: 'entity', entityId: contractEffectId(contract.namespace, effect) }, authority: 'authoritative', provenance });
    for (const event of operation.emits) sink.addFact({ subject: operationId, predicate: 'EMITS', object: { kind: 'entity', entityId: contractEventId(contract.namespace, event) }, authority: 'authoritative', provenance });
    for (const invoked of operation.invokes) sink.addFact({ subject: operationId, predicate: 'INVOKES', object: { kind: 'entity', entityId: contractOperationId(contract.namespace, invoked) }, authority: 'authoritative', provenance });
    for (const awaited of operation.awaits) sink.addFact({ subject: operationId, predicate: 'AWAITS', object: { kind: 'entity', entityId: contractOperationId(contract.namespace, awaited) }, authority: 'authoritative', provenance });
  }

  for (const state of contract.states) {
    const stateId = contractStateId(contract.namespace, state.id);
    const ownerId = contractResponsibilityId(contract.namespace, state.owner);
    const fieldId = contractFieldId(contract.namespace, state.entity, state.field);
    sink.addFact({ subject: ownerId, predicate: 'OWNS', object: { kind: 'entity', entityId: stateId }, authority: 'authoritative', provenance });
    sink.addFact({ subject: stateId, predicate: 'DECLARES', object: { kind: 'entity', entityId: fieldId }, authority: 'authoritative', provenance });
    for (const value of state.values) sink.addFact({ subject: stateId, predicate: 'GUARANTEES', object: { kind: 'value', value }, authority: 'authoritative', provenance });
    for (const transition of state.transitions) {
      const operationId = contractOperationId(contract.namespace, transition.by);
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
    const entryEntityId = contractOperationId(contract.namespace, scenario.entry);
    const factIds: string[] = [];
    factIds.push(sink.addFact({ subject: scenarioId, predicate: 'INVOKES', object: { kind: 'entity', entityId: entryEntityId }, authority: 'authoritative', provenance }));
    for (const operationId of uniqueSorted(scenario.steps.map((step) => contractOperationId(contract.namespace, step.operation)))) {
      factIds.push(sink.addFact({ subject: scenarioId, predicate: 'CONTAINS', object: { kind: 'entity', entityId: operationId }, authority: 'authoritative', provenance }));
    }
    const acceptanceEntityIds = scenario.acceptance.map((acceptanceId) => `acceptance:${acceptanceId}`);
    for (const acceptanceEntityId of acceptanceEntityIds) {
      factIds.push(sink.addFact({ subject: scenarioId, predicate: 'VERIFIED_BY', object: { kind: 'entity', entityId: acceptanceEntityId }, authority: 'authoritative', provenance }));
    }
    sink.addScenario({
      id: scenarioId,
      label: scenario.label ?? scenario.id,
      entryEntityId,
      factIds,
      steps: scenario.steps.map((step) => ({
        id: step.id,
        operationEntityId: contractOperationId(contract.namespace, step.operation),
        afterStepIds: step.after,
        awaits: step.awaits ?? false,
        ...(step.retryMaxAttempts !== undefined ? { retryMaxAttempts: step.retryMaxAttempts } : {}),
        ...(step.onError ? { onErrorStepId: step.onError } : {})
      })),
      acceptanceEntityIds
    });
  }
}

function normalizeScenario(scenario: ScenarioDefinition): ScenarioDefinition {
  return {
    ...scenario,
    factIds: uniqueSorted(scenario.factIds),
    steps: [...scenario.steps]
      .map((step) => ({ ...step, afterStepIds: uniqueSorted(step.afterStepIds) }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    acceptanceEntityIds: uniqueSorted(scenario.acceptanceEntityIds)
  };
}

function revisionPayload(
  graphId: string,
  appId: string,
  entities: readonly SemanticEntity[],
  facts: readonly SemanticFact[],
  scenarios: readonly ScenarioDefinition[]
): string {
  return JSON.stringify({
    formatVersion: ENGINEERING_IR_FORMAT_VERSION,
    graphId,
    appId,
    entities,
    facts: facts.map(({ validFrom: _validFrom, validTo: _validTo, ...fact }) => fact),
    scenarios
  });
}

export function buildEngineeringIR(input: BuildEngineeringIRInput): EngineeringIR {
  const entities = new Map<string, SemanticEntity>();
  const facts = new Map<string, SemanticFact>();
  const scenarios = new Map<string, ScenarioDefinition>();
  const appId = `app:${input.app.name}`;
  const graphId = `engineering-ir:${input.app.name}`;

  const addEntity = (entity: SemanticEntity): void => {
    const existing = entities.get(entity.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(entity)) {
        throw new CompilerError('IR-IDENTITY-001', `Semantic entity "${entity.id}" has conflicting definitions`);
      }
      return;
    }
    entities.set(entity.id, entity);
  };

  const addFact = (factInput: FactInput): string => {
    const fact = buildFact(factInput);
    const existing = facts.get(fact.id);
    facts.set(fact.id, existing ? mergeFacts(existing, fact) : fact);
    return fact.id;
  };

  const addScenario = (scenario: ScenarioDefinition): void => {
    const normalized = normalizeScenario(scenario);
    const existing = scenarios.get(normalized.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(normalized)) {
      throw new CompilerError('IR-IDENTITY-004', `Scenario "${normalized.id}" has conflicting definitions`);
    }
    scenarios.set(normalized.id, normalized);
  };

  const sink: BuildSink = { addEntity, addFact, addScenario };
  addEntity(semanticEntity(appId, 'app', input.app.name));

  for (const block of [...input.resolvedBlocks].sort((left, right) => left.id.localeCompare(right.id))) {
    const blockId = `block:${block.id}`;
    addEntity(semanticEntity(blockId, 'block', block.id, [
      valueAttribute('version', block.version),
      valueAttribute('manifestKind', block.kind),
      valueAttribute('registrySourceId', block.registrySourceId)
    ]));
    addFact({ subject: appId, predicate: 'CONTAINS', object: { kind: 'entity', entityId: blockId }, authority: 'derived', provenance: compilerProvenance('resolve:resolved-block') });
  }

  const resolvedBlockIds = new Set(input.resolvedBlocks.map((block) => block.id));
  for (const entry of [...input.manifests].sort((left, right) => left.blockId.localeCompare(right.blockId))) {
    if (!resolvedBlockIds.has(entry.blockId)) throw new CompilerError('IR-IDENTITY-002', `Manifest input references unresolved block "${entry.blockId}"`);
    const blockId = `block:${entry.blockId}`;
    const provenance = manifestProvenance(entry);

    for (const capability of uniqueSorted(entry.manifest.requires)) {
      const capabilityId = `capability:${capability}`;
      addEntity(semanticEntity(capabilityId, 'capability', capability));
      addFact({ subject: blockId, predicate: 'DEPENDS_ON', object: { kind: 'entity', entityId: capabilityId }, authority: 'authoritative', provenance });
    }
    for (const capability of uniqueSorted(entry.manifest.provides)) {
      const capabilityId = `capability:${capability}`;
      addEntity(semanticEntity(capabilityId, 'capability', capability));
      addFact({ subject: blockId, predicate: 'PROVIDES', object: { kind: 'entity', entityId: capabilityId }, authority: 'authoritative', provenance });
    }
    for (const pin of [...entry.manifest.pins.inputs].sort((left, right) => left.id.localeCompare(right.id))) {
      const portId = `port:${entry.blockId}:input:${pin.id}`;
      addEntity(semanticEntity(portId, 'port', pin.id, [valueAttribute('direction', 'input'), valueAttribute('type', pin.type), valueAttribute('required', pin.required ?? false)]));
      addFact({ subject: blockId, predicate: 'REQUIRES', object: { kind: 'entity', entityId: portId }, authority: 'authoritative', provenance });
    }
    for (const pin of [...entry.manifest.pins.outputs].sort((left, right) => left.id.localeCompare(right.id))) {
      const portId = `port:${entry.blockId}:output:${pin.id}`;
      addEntity(semanticEntity(portId, 'port', pin.id, [valueAttribute('direction', 'output'), valueAttribute('type', pin.type), valueAttribute('required', pin.required ?? false)]));
      addFact({ subject: blockId, predicate: 'PROVIDES', object: { kind: 'entity', entityId: portId }, authority: 'authoritative', provenance });
    }
  }

  const slotEntityByTaskId = new Map<string, string>();
  for (const task of [...input.slotTasks].sort((left, right) => `${left.block}:${left.id}`.localeCompare(`${right.block}:${right.id}`))) {
    const blockId = `block:${task.block}`;
    if (!entities.has(blockId)) throw new CompilerError('IR-IDENTITY-003', `Slot "${task.id}" references unknown block "${task.block}"`);
    const slotId = `slot:${task.block}:${task.id}`;
    slotEntityByTaskId.set(task.id, slotId);
    addEntity(semanticEntity(slotId, 'slot', task.id, [
      valueAttribute('slotKind', task.kind),
      valueAttribute('target', task.target),
      valueAttribute('symbol', task.symbol),
      ...(task.inputType ? [valueAttribute('inputType', task.inputType)] : []),
      ...(task.outputType ? [valueAttribute('outputType', task.outputType)] : [])
    ]));
    addFact({ subject: blockId, predicate: 'CONTAINS', object: { kind: 'entity', entityId: slotId }, authority: 'derived', provenance: compilerProvenance('resolve:slot-task') });
  }

  for (const acceptanceId of uniqueSorted(input.acceptanceIds)) addEntity(semanticEntity(`acceptance:${acceptanceId}`, 'acceptance', acceptanceId));
  for (const policyId of uniqueSorted(input.policyIds)) addEntity(semanticEntity(`policy:${policyId}`, 'policy', policyId));

  for (const contract of [...(input.semanticContracts ?? [])].sort((left, right) => `${left.blockId}:${left.contract.namespace}:${left.contract.id}`.localeCompare(`${right.blockId}:${right.contract.namespace}:${right.contract.id}`))) {
    if (!resolvedBlockIds.has(contract.blockId)) throw new CompilerError('IR-IDENTITY-005', `Semantic contract "${contract.contract.id}" references unresolved block "${contract.blockId}"`);
    appendSemanticContract(contract, sink);
  }

  for (const artifact of [...input.provenanceArtifacts].sort((left, right) => left.path.localeCompare(right.path))) {
    const artifactId = `artifact:${artifact.path}`;
    addEntity(semanticEntity(artifactId, 'artifact', artifact.path, [
      valueAttribute('originType', artifact.originType),
      valueAttribute('originId', artifact.originId),
      valueAttribute('overrideStatus', artifact.overrideStatus),
      ...(artifact.generatedByPass ? [valueAttribute('generatedByPass', artifact.generatedByPass)] : [])
    ]));
    const slotOrigin = artifact.originType === 'slot' ? slotEntityByTaskId.get(artifact.originId) : undefined;
    const blockOrigin = artifact.sourceBlock && entities.has(`block:${artifact.sourceBlock}`)
      ? `block:${artifact.sourceBlock}`
      : artifact.originType === 'block' && entities.has(`block:${artifact.originId}`)
        ? `block:${artifact.originId}`
        : undefined;
    addFact({
      subject: artifactId,
      predicate: 'ORIGINATES_FROM',
      object: { kind: 'entity', entityId: slotOrigin ?? blockOrigin ?? appId },
      authority: 'derived',
      provenance: compilerProvenance('artifact-provenance'),
      evidence: [{ kind: 'artifact-provenance', ref: artifact.path }]
    });
  }

  const sortedEntities = [...entities.values()].sort((left, right) => left.id.localeCompare(right.id));
  const entityIds = new Set(sortedEntities.map((entity) => entity.id));
  const sortedFacts = [...facts.values()].sort((left, right) => left.id.localeCompare(right.id));
  const sortedScenarios = [...scenarios.values()].sort((left, right) => left.id.localeCompare(right.id));

  for (const fact of sortedFacts) {
    if (!entityIds.has(fact.subject)) throw new CompilerError('IR-FACT-002', `Fact "${fact.id}" references missing subject "${fact.subject}"`);
    if (fact.object.kind === 'entity' && !entityIds.has(fact.object.entityId)) throw new CompilerError('IR-FACT-003', `Fact "${fact.id}" references missing object "${fact.object.entityId}"`);
    if (fact.confidence < 0 || fact.confidence > 1) throw new CompilerError('IR-AUTHORITY-001', `Fact "${fact.id}" confidence must be between 0 and 1`);
    if (fact.provenance.length === 0) throw new CompilerError('IR-AUTHORITY-002', `Fact "${fact.id}" must include provenance`);
  }

  for (const scenario of sortedScenarios) {
    if (!entityIds.has(scenario.id) || !entityIds.has(scenario.entryEntityId)) throw new CompilerError('IR-FACT-004', `Scenario "${scenario.id}" references missing semantic entities`);
    for (const step of scenario.steps) if (!entityIds.has(step.operationEntityId)) throw new CompilerError('IR-FACT-005', `Scenario "${scenario.id}" step "${step.id}" references missing operation "${step.operationEntityId}"`);
    for (const acceptanceEntityId of scenario.acceptanceEntityIds) if (!entityIds.has(acceptanceEntityId)) throw new CompilerError('IR-FACT-006', `Scenario "${scenario.id}" references missing acceptance "${acceptanceEntityId}"`);
  }

  const revision = `sha256:${digest(revisionPayload(graphId, appId, sortedEntities, sortedFacts, sortedScenarios))}`;
  const factsWithRevision = sortedFacts.map((fact) => ({ ...fact, validFrom: revision }));

  return {
    formatVersion: ENGINEERING_IR_FORMAT_VERSION,
    graphId,
    revision,
    appId,
    entities: sortedEntities,
    facts: factsWithRevision,
    scenarios: sortedScenarios
  };
}
