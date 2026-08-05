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
import { linkWorkspaceSemanticContracts } from '../semantic-linker.ts';
import { appendSemanticContract, type BuildSink } from './append-semantic-contract.ts';
import { compareCodeUnits } from './ir-canonical-primitives.ts';
import { addFact as addFactToStore } from './ir-fact-store.ts';
import {
  addEntity as addEntityToStore,
  appEntityId,
  artifactEntityId,
  assertEngineeringIRReferences,
  claimSemanticNamespace as claimSemanticNamespaceForStore,
  engineeringGraphId,
  generatorEntityId,
  normalizedArtifactTarget,
  semanticEntity,
  valueAttribute,
  type SemanticNamespaceOwner
} from './ir-identity.ts';
import { compilerProvenance, manifestProvenance, uniqueSorted } from './ir-normalization.ts';
import {
  digest,
  inputRevisionPayload,
  semanticRevisionPayload,
  type InputRevisionDomain
} from './ir-revision.ts';
import { assertEngineeringIRPredicateSignatures } from './predicate-signatures.ts';
import { deriveScenarioDefinitions } from './scenario-facts.ts';

export interface EngineeringIRManifestInput {
  blockId: string;
  manifestPath?: string;
  manifest: Pick<BlockManifest, 'requires' | 'provides' | 'pins'> &
    Partial<Pick<BlockManifest, 'generators'>>;
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

  for (const block of [...input.resolvedBlocks].sort((left, right) => compareCodeUnits(left.id, right.id))) {
    const blockId = `block:${block.id}`;
    addEntity(semanticEntity(blockId, 'block', block.id, [
      valueAttribute('version', block.version),
      valueAttribute('manifestKind', block.kind),
      valueAttribute('registrySourceId', block.registrySourceId)
    ]));
    addFact({ subject: appId, predicate: 'CONTAINS', object: { kind: 'entity', entityId: blockId }, authority: 'derived', provenance: compilerProvenance('resolve:resolved-block') });
  }

  const resolvedBlockIds = new Set(input.resolvedBlocks.map((block) => block.id));
  for (const entry of [...input.manifests].sort((left, right) => compareCodeUnits(left.blockId, right.blockId))) {
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
    for (const pin of [...entry.manifest.pins.inputs].sort((left, right) => compareCodeUnits(left.id, right.id))) {
      const portId = `port:${entry.blockId}:input:${pin.id}`;
      addEntity(semanticEntity(portId, 'port', pin.id, [valueAttribute('direction', 'input'), valueAttribute('type', pin.type), valueAttribute('required', pin.required ?? false)]));
      addFact({ subject: blockId, predicate: 'REQUIRES', object: { kind: 'entity', entityId: portId }, authority: 'authoritative', provenance });
    }
    for (const pin of [...entry.manifest.pins.outputs].sort((left, right) => compareCodeUnits(left.id, right.id))) {
      const portId = `port:${entry.blockId}:output:${pin.id}`;
      addEntity(semanticEntity(portId, 'port', pin.id, [valueAttribute('direction', 'output'), valueAttribute('type', pin.type), valueAttribute('required', pin.required ?? false)]));
      addFact({ subject: blockId, predicate: 'PROVIDES', object: { kind: 'entity', entityId: portId }, authority: 'authoritative', provenance });
    }
  }

  for (const task of [...input.slotTasks].sort((left, right) => compareCodeUnits(`${left.block}:${left.id}`, `${right.block}:${right.id}`))) {
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

  const linkedContracts = linkWorkspaceSemanticContracts(
    input.semanticContracts ?? [],
    input.policyDeclarations.map((policy) => policy.id)
  );
  for (const contract of linkedContracts) {
    if (!resolvedBlockIds.has(contract.blockId)) throw new CompilerError('IR-IDENTITY-005', `Semantic contract "${contract.contract.id}" references unresolved block "${contract.blockId}"`);
    appendSemanticContract(contract, sink);
  }

  const acceptanceEntityIds = new Set(input.acceptanceIds.map((id) => `acceptance:${id}`));
  for (const entry of [...input.manifests].sort((left, right) => compareCodeUnits(left.blockId, right.blockId))) {
    const blockId = `block:${entry.blockId}`;
    const provenance = manifestProvenance(entry);
    for (const declaration of [...(entry.manifest.generators ?? [])].sort((left, right) => compareCodeUnits(left.id, right.id))) {
      const contractMatches = linkedContracts.filter((candidate) =>
        candidate.blockId === entry.blockId && candidate.contract.id === declaration.contract
      );
      if (contractMatches.length !== 1) {
        throw new CompilerError('GENERATOR-PLAN-001', `Unknown semantic contract "${declaration.contract}"`);
      }
      const loaded = contractMatches[0]!;
      const state = loaded.contract.states.find((candidate) => candidate.id === declaration.state);
      if (!state) {
        throw new CompilerError('GENERATOR-PLAN-002', `Unknown semantic state "${declaration.state}"`);
      }

      const generatorId = generatorEntityId(entry.blockId, declaration.id);
      const target = normalizedArtifactTarget(declaration.target);
      const artifactId = artifactEntityId(target);
      const stateId = `state:${loaded.contract.namespace}:${state.id}`;
      addEntity(semanticEntity(generatorId, 'generator', declaration.id, [
        valueAttribute('blockId', entry.blockId),
        valueAttribute('contractId', declaration.contract),
        valueAttribute('generatorKind', declaration.kind),
        valueAttribute('stateId', declaration.state),
        valueAttribute('target', target),
        valueAttribute('consumes', uniqueSorted(declaration.consumes)),
        valueAttribute('produces', declaration.produces),
        valueAttribute('typeBindingName', declaration.typeBinding.name),
        valueAttribute('typeBindingImportFrom', declaration.typeBinding.importFrom),
        valueAttribute('verification', uniqueSorted(declaration.verification))
      ]));
      addEntity(semanticEntity(artifactId, 'artifact', target, [
        valueAttribute('artifactKind', declaration.produces),
        valueAttribute('target', target)
      ]));
      addFact({ subject: blockId, predicate: 'DECLARES', object: { kind: 'entity', entityId: generatorId }, authority: 'authoritative', provenance });
      addFact({ subject: generatorId, predicate: 'CONSUMES', object: { kind: 'entity', entityId: stateId }, authority: 'authoritative', provenance });
      addFact({ subject: stateId, predicate: 'LOWERS_TO', object: { kind: 'entity', entityId: artifactId }, authority: 'derived', provenance: compilerProvenance(`generator:${generatorId}:lowering`) });
      addFact({ subject: generatorId, predicate: 'GENERATES', object: { kind: 'entity', entityId: artifactId }, authority: 'authoritative', provenance });
      for (const verificationId of uniqueSorted(declaration.verification)) {
        const acceptanceId = `acceptance:${verificationId}`;
        if (acceptanceEntityIds.has(acceptanceId)) {
          addFact({ subject: artifactId, predicate: 'VERIFIED_BY', object: { kind: 'entity', entityId: acceptanceId }, authority: 'authoritative', provenance });
        } else {
          addFact({ subject: artifactId, predicate: 'VERIFIED_BY', object: { kind: 'value', value: { selector: verificationId } }, authority: 'authoritative', provenance });
        }
      }
    }
  }

  const sortedEntities = [...entities.values()].sort((left, right) => compareCodeUnits(left.id, right.id));
  const entityIds = new Set(sortedEntities.map((entity) => entity.id));
  const sortedFacts = [...facts.values()].sort((left, right) => compareCodeUnits(left.id, right.id));
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
