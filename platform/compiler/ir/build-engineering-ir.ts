import {
  ENGINEERING_IR_FORMAT_VERSION,
  type EngineeringIR,
  type SemanticEntity,
  type SemanticFact
} from '../../shared/engineering-ir-types.ts';
import { CompilerError } from '../../shared/errors.ts';
import type { ResolvedBlock, SlotTask } from '../../shared/lock-types.ts';
import type { BlockManifest } from '../../shared/plan-manifest-types.ts';
import type { PolicyRule } from '../../shared/policy-types.ts';
import type { LoadedSemanticContract } from '../../shared/semantic-contract-types.ts';
import { appendSemanticContract, type BuildSink } from './append-semantic-contract.ts';
import { addFact as addFactToStore } from './ir-fact-store.ts';
import {
  addEntity as addEntityToStore,
  appEntityId,
  assertEngineeringIRReferences,
  claimSemanticNamespace as claimSemanticNamespaceForStore,
  engineeringGraphId,
  semanticEntity,
  valueAttribute,
  type SemanticNamespaceOwner
} from './ir-identity.ts';
import { compilerProvenance, manifestProvenance, uniqueSorted } from './ir-normalization.ts';
import { assertEngineeringIRPredicateSignatures } from './predicate-signatures.ts';
import {
  digest,
  inputRevisionPayload,
  semanticRevisionPayload,
  type InputRevisionDomain
} from './ir-revision.ts';
import { deriveScenarioDefinitions } from './scenario-facts.ts';

export interface EngineeringIRManifestInput {
  blockId: string;
  manifestPath?: string;
  manifest: Pick<BlockManifest, 'requires' | 'provides' | 'pins'>;
}

export interface BuildEngineeringIRInput extends InputRevisionDomain {
  app: { id: string; name: string };
  resolvedBlocks: readonly ResolvedBlock[];
  manifests: readonly EngineeringIRManifestInput[];
  slotTasks: readonly SlotTask[];
  acceptanceIds: readonly string[];
  policyDeclarations: readonly PolicyRule[];
  semanticContracts?: readonly LoadedSemanticContract[];
}

export function buildEngineeringIR(input: BuildEngineeringIRInput): EngineeringIR {
  const entities = new Map<string, SemanticEntity>();
  const facts = new Map<string, SemanticFact>();
  const semanticNamespaceOwnerByNamespace = new Map<string, SemanticNamespaceOwner>();
  const appId = appEntityId(input.app.id);
  const graphId = engineeringGraphId(input.app.id);
  const inputRevision = `sha256:${digest(inputRevisionPayload(input))}`;

  const addEntity: BuildSink['addEntity'] = (entity) => addEntityToStore(entities, entity);
  const addFact: BuildSink['addFact'] = (factInput) => addFactToStore(facts, factInput);
  const claimSemanticNamespace: BuildSink['claimSemanticNamespace'] = (contractInput) =>
    claimSemanticNamespaceForStore(semanticNamespaceOwnerByNamespace, contractInput);

  const sink: BuildSink = { addEntity, addFact, claimSemanticNamespace };
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

  for (const task of [...input.slotTasks].sort((left, right) => `${left.block}:${left.id}`.localeCompare(`${right.block}:${right.id}`))) {
    const blockId = `block:${task.block}`;
    if (!entities.has(blockId)) throw new CompilerError('IR-IDENTITY-003', `Slot "${task.id}" references unknown block "${task.block}"`);
    const slotId = `slot:${task.block}:${task.id}`;
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
  for (const policyId of uniqueSorted(input.policyDeclarations.map((policy) => policy.id))) addEntity(semanticEntity(`policy:${policyId}`, 'policy', policyId));

  for (const contract of [...(input.semanticContracts ?? [])].sort((left, right) => `${left.blockId}:${left.contract.namespace}:${left.contract.id}`.localeCompare(`${right.blockId}:${right.contract.namespace}:${right.contract.id}`))) {
    if (!resolvedBlockIds.has(contract.blockId)) throw new CompilerError('IR-IDENTITY-005', `Semantic contract "${contract.contract.id}" references unresolved block "${contract.blockId}"`);
    appendSemanticContract(contract, sink);
  }

  const sortedEntities = [...entities.values()].sort((left, right) => left.id.localeCompare(right.id));
  const entityIds = new Set(sortedEntities.map((entity) => entity.id));
  const sortedFacts = [...facts.values()].sort((left, right) => left.id.localeCompare(right.id));
  const sortedScenarios = deriveScenarioDefinitions(sortedEntities, sortedFacts);

  assertEngineeringIRReferences(entityIds, sortedFacts, sortedScenarios);
  assertEngineeringIRPredicateSignatures(sortedEntities, sortedFacts);

  const semanticRevision = `sha256:${digest(semanticRevisionPayload(graphId, appId, sortedEntities, sortedFacts, sortedScenarios))}`;
  const factsWithRevision = sortedFacts.map((fact) => ({
    ...fact,
    assertions: fact.assertions.map((assertion) => ({ ...assertion, validFromRevision: semanticRevision }))
  }));

  return {
    formatVersion: ENGINEERING_IR_FORMAT_VERSION,
    graphId,
    inputRevision,
    semanticRevision,
    appId,
    entities: sortedEntities,
    facts: factsWithRevision,
    scenarios: sortedScenarios
  };
}
