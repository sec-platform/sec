import { createHash } from 'node:crypto';

import type { ResolvedBlock, SlotTask } from '../../shared/lock-types.ts';
import type { BlockManifest } from '../../shared/plan-manifest-types.ts';
import type { ProvenanceArtifact } from '../../shared/provenance-types.ts';
import { CompilerError } from '../../shared/errors.ts';
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
  type SemanticPrimitive
} from '../../shared/engineering-ir-types.ts';

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

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
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
  return object.kind === 'entity'
    ? `entity:${object.entityId}`
    : `value:${JSON.stringify(object.value)}`;
}

function factIdentity(input: Pick<FactInput, 'subject' | 'predicate' | 'object'>): string {
  return `${input.subject}\u0000${input.predicate}\u0000${objectKey(input.object)}`;
}

function buildFact(input: FactInput): SemanticFact {
  const identity = factIdentity(input);
  return {
    id: `fact:${digest(identity).slice(0, 24)}`,
    subject: input.subject,
    predicate: input.predicate,
    object: input.object,
    authority: input.authority,
    confidence: input.confidence ?? 1,
    provenance: [...input.provenance].sort((left, right) =>
      `${left.kind}:${left.sourceId}:${left.sourcePath ?? ''}`.localeCompare(
        `${right.kind}:${right.sourceId}:${right.sourcePath ?? ''}`
      )
    ),
    evidence: [...(input.evidence ?? [])].sort((left, right) =>
      `${left.kind}:${left.ref}`.localeCompare(`${right.kind}:${right.ref}`)
    ),
    validFrom: 'build'
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

function normalizeScenario(scenario: ScenarioDefinition): ScenarioDefinition {
  return { ...scenario, factIds: uniqueSorted(scenario.factIds) };
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

  const addFact = (factInput: FactInput): void => {
    const fact = buildFact(factInput);
    const existing = facts.get(fact.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(fact)) {
        throw new CompilerError('IR-FACT-001', `Semantic fact "${fact.id}" has conflicting definitions`);
      }
      return;
    }
    facts.set(fact.id, fact);
  };

  addEntity(semanticEntity(appId, 'app', input.app.name));

  for (const block of [...input.resolvedBlocks].sort((left, right) => left.id.localeCompare(right.id))) {
    const blockId = `block:${block.id}`;
    addEntity(semanticEntity(blockId, 'block', block.id, [
      valueAttribute('version', block.version),
      valueAttribute('manifestKind', block.kind),
      valueAttribute('registrySourceId', block.registrySourceId)
    ]));
    addFact({
      subject: appId,
      predicate: 'CONTAINS',
      object: { kind: 'entity', entityId: blockId },
      authority: 'derived',
      provenance: compilerProvenance('resolve:resolved-block')
    });
  }

  const resolvedBlockIds = new Set(input.resolvedBlocks.map((block) => block.id));
  for (const entry of [...input.manifests].sort((left, right) => left.blockId.localeCompare(right.blockId))) {
    if (!resolvedBlockIds.has(entry.blockId)) {
      throw new CompilerError('IR-IDENTITY-002', `Manifest input references unresolved block "${entry.blockId}"`);
    }

    const blockId = `block:${entry.blockId}`;
    const provenance = manifestProvenance(entry);

    for (const capability of uniqueSorted(entry.manifest.requires)) {
      const capabilityId = `capability:${capability}`;
      addEntity(semanticEntity(capabilityId, 'capability', capability));
      addFact({
        subject: blockId,
        predicate: 'DEPENDS_ON',
        object: { kind: 'entity', entityId: capabilityId },
        authority: 'authoritative',
        provenance
      });
    }

    for (const capability of uniqueSorted(entry.manifest.provides)) {
      const capabilityId = `capability:${capability}`;
      addEntity(semanticEntity(capabilityId, 'capability', capability));
      addFact({
        subject: blockId,
        predicate: 'PROVIDES',
        object: { kind: 'entity', entityId: capabilityId },
        authority: 'authoritative',
        provenance
      });
    }

    for (const pin of [...entry.manifest.pins.inputs].sort((left, right) => left.id.localeCompare(right.id))) {
      const portId = `port:${entry.blockId}:input:${pin.id}`;
      addEntity(semanticEntity(portId, 'port', pin.id, [
        valueAttribute('direction', 'input'),
        valueAttribute('type', pin.type),
        valueAttribute('required', pin.required ?? false)
      ]));
      addFact({
        subject: blockId,
        predicate: 'REQUIRES',
        object: { kind: 'entity', entityId: portId },
        authority: 'authoritative',
        provenance
      });
    }

    for (const pin of [...entry.manifest.pins.outputs].sort((left, right) => left.id.localeCompare(right.id))) {
      const portId = `port:${entry.blockId}:output:${pin.id}`;
      addEntity(semanticEntity(portId, 'port', pin.id, [
        valueAttribute('direction', 'output'),
        valueAttribute('type', pin.type),
        valueAttribute('required', pin.required ?? false)
      ]));
      addFact({
        subject: blockId,
        predicate: 'PROVIDES',
        object: { kind: 'entity', entityId: portId },
        authority: 'authoritative',
        provenance
      });
    }
  }

  const slotEntityByTaskId = new Map<string, string>();
  for (const task of [...input.slotTasks].sort((left, right) => `${left.block}:${left.id}`.localeCompare(`${right.block}:${right.id}`))) {
    const blockId = `block:${task.block}`;
    if (!entities.has(blockId)) {
      throw new CompilerError('IR-IDENTITY-003', `Slot "${task.id}" references unknown block "${task.block}"`);
    }
    const slotId = `slot:${task.block}:${task.id}`;
    slotEntityByTaskId.set(task.id, slotId);
    addEntity(semanticEntity(slotId, 'slot', task.id, [
      valueAttribute('slotKind', task.kind),
      valueAttribute('target', task.target),
      valueAttribute('symbol', task.symbol),
      ...(task.inputType ? [valueAttribute('inputType', task.inputType)] : []),
      ...(task.outputType ? [valueAttribute('outputType', task.outputType)] : [])
    ]));
    addFact({
      subject: blockId,
      predicate: 'CONTAINS',
      object: { kind: 'entity', entityId: slotId },
      authority: 'derived',
      provenance: compilerProvenance('resolve:slot-task')
    });
  }

  for (const acceptanceId of uniqueSorted(input.acceptanceIds)) {
    addEntity(semanticEntity(`acceptance:${acceptanceId}`, 'acceptance', acceptanceId));
  }

  for (const policyId of uniqueSorted(input.policyIds)) {
    addEntity(semanticEntity(`policy:${policyId}`, 'policy', policyId));
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
    const originEntityId = slotOrigin ?? blockOrigin ?? appId;

    addFact({
      subject: artifactId,
      predicate: 'ORIGINATES_FROM',
      object: { kind: 'entity', entityId: originEntityId },
      authority: 'derived',
      provenance: compilerProvenance('artifact-provenance'),
      evidence: [{ kind: 'artifact-provenance', ref: artifact.path }]
    });
  }

  const sortedEntities = [...entities.values()].sort((left, right) => left.id.localeCompare(right.id));
  const entityIds = new Set(sortedEntities.map((entity) => entity.id));
  const sortedFacts = [...facts.values()].sort((left, right) => left.id.localeCompare(right.id));

  for (const fact of sortedFacts) {
    if (!entityIds.has(fact.subject)) {
      throw new CompilerError('IR-FACT-002', `Fact "${fact.id}" references missing subject "${fact.subject}"`);
    }
    if (fact.object.kind === 'entity' && !entityIds.has(fact.object.entityId)) {
      throw new CompilerError('IR-FACT-003', `Fact "${fact.id}" references missing object "${fact.object.entityId}"`);
    }
    if (fact.confidence < 0 || fact.confidence > 1) {
      throw new CompilerError('IR-AUTHORITY-001', `Fact "${fact.id}" confidence must be between 0 and 1`);
    }
    if (fact.provenance.length === 0) {
      throw new CompilerError('IR-AUTHORITY-002', `Fact "${fact.id}" must include provenance`);
    }
  }

  const scenarios: ScenarioDefinition[] = [];
  const revision = `sha256:${digest(revisionPayload(graphId, appId, sortedEntities, sortedFacts, scenarios))}`;
  const factsWithRevision = sortedFacts.map((fact) => ({ ...fact, validFrom: revision }));

  return {
    formatVersion: ENGINEERING_IR_FORMAT_VERSION,
    graphId,
    revision,
    appId,
    entities: sortedEntities,
    facts: factsWithRevision,
    scenarios: scenarios.map(normalizeScenario)
  };
}
