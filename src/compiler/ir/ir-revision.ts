import { compareCodeUnits, rawSha256Hex, normalizedArtifactTarget, stableById, uniqueSorted, uniqueSortedByKey } from '../../contracts/canonical.ts';
import type { LoadedSemanticContract, SemanticContract } from '../../semantics/definitions/types.ts';
import { type SemanticEntity } from '../../semantics/engineering-ir/entity-types.ts';
import { type SemanticFact } from '../../semantics/engineering-ir/fact-types.ts';
import { ENGINEERING_IR_FORMAT_VERSION } from '../../semantics/engineering-ir/root-types.ts';
import { type ScenarioDefinition } from '../../semantics/engineering-ir/scenario-types.ts';
import type { ManifestGenerator } from '../../semantics/generation/types.ts';
import type { PolicyRule } from '../../semantics/policies/types.ts';
import type { BlockManifest, ManifestPin, ResolvedBlock } from '../contract.ts';

export { rawSha256Hex };

interface InputRevisionManifest {
  blockId: string;
  manifest: Pick<BlockManifest, 'requires' | 'provides' | 'pins'> &
    Partial<Pick<BlockManifest, 'generators'>>;
}

export interface InputRevisionDomain {
  app: { id: string; name: string };
  resolvedBlocks: readonly ResolvedBlock[];
  manifests: readonly InputRevisionManifest[];
  acceptanceIds: readonly string[];
  policyDeclarations: readonly PolicyRule[];
  semanticContracts?: readonly LoadedSemanticContract[];
  observedFlows?: readonly InputRevisionObservedFlow[];
}

interface InputRevisionObservedFlow {
  readonly providerId: string;
  readonly sourceCapability: string;
  readonly sourcePath: string;
  readonly sourceRevision: string;
  readonly target: string;
}

function canonicalSemanticContract(contract: SemanticContract): object {
  return {
    formatVersion: contract.formatVersion,
    id: contract.id,
    namespace: contract.namespace,
    imports: [...(contract.imports ?? [])]
      .sort((left, right) => compareCodeUnits(left.alias, right.alias))
      .map((entry) => ({
        alias: entry.alias,
        namespace: entry.namespace,
        contractId: entry.contractId
      })),
    entities: stableById(contract.entities).map((entity) => ({
      id: entity.id,
      label: entity.label ?? entity.id,
      fields: stableById(entity.fields).map((field) => ({
        id: field.id,
        type: field.type,
        required: field.required ?? false,
        mutable: field.mutable ?? false
      }))
    })),
    states: stableById(contract.states).map((state) => ({
      id: state.id,
      label: state.label ?? state.id,
      entity: state.entity,
      field: state.field,
      owner: state.owner,
      values: uniqueSorted(state.values),
      transitions: uniqueSortedByKey(
        state.transitions.map((transition) => ({ from: transition.from, to: transition.to, by: transition.by })),
        (transition) => `${transition.from}\u0000${transition.to}\u0000${transition.by}`
      )
    })),
    responsibilities: stableById(contract.responsibilities).map((responsibility) => ({
      id: responsibility.id,
      label: responsibility.label ?? responsibility.id,
      bindings: uniqueSortedByKey(
        (responsibility.bindings ?? []).map((binding) => ({
          target: {
            kind: binding.target.kind,
            id: binding.target.id
          },
          declaration: {
            path: normalizedArtifactTarget(binding.declaration.path),
            exportName: binding.declaration.exportName
          }
        })),
        (binding) => JSON.stringify(binding)
      ),
      owns: uniqueSorted(responsibility.owns),
      implements: uniqueSorted(responsibility.implements),
      dependsOn: uniqueSorted(responsibility.dependsOn)
    })),
    operations: stableById(contract.operations).map((operation) => ({
      id: operation.id,
      label: operation.label ?? operation.id,
      responsibility: operation.responsibility,
      inputs: [...operation.inputs],
      output: operation.output ?? null,
      reads: uniqueSorted(operation.reads),
      writes: uniqueSorted(operation.writes),
      mutates: uniqueSorted(operation.mutates),
      requiresPolicies: uniqueSorted(operation.requiresPolicies),
      requiresPermissions: uniqueSorted(operation.requiresPermissions),
      performsEffects: uniqueSorted(operation.performsEffects),
      emits: uniqueSorted(operation.emits),
      invokes: uniqueSorted(operation.invokes),
      awaits: uniqueSorted(operation.awaits)
    })),
    events: stableById(contract.events).map((event) => ({
      id: event.id,
      label: event.label ?? event.id,
      payloadType: event.payloadType ?? null
    })),
    policies: stableById(contract.policies).map((policy) => ({
      id: policy.id,
      label: policy.label ?? policy.id,
      rule: policy.rule ?? null,
      verifiedBy: uniqueSorted(policy.verifiedBy ?? [])
    })),
    permissions: stableById(contract.permissions).map((permission) => ({
      id: permission.id,
      label: permission.label ?? permission.id,
      scope: permission.scope ?? null
    })),
    effects: stableById(contract.effects).map((effect) => ({
      id: effect.id,
      label: effect.label ?? effect.id,
      kind: effect.kind,
      target: effect.target ?? null
    })),
    scenarios: stableById(contract.scenarios).map((scenario) => ({
      id: scenario.id,
      label: scenario.label ?? scenario.id,
      entry: scenario.entry,
      steps: stableById(scenario.steps).map((step) => ({
        id: step.id,
        operation: step.operation,
        after: uniqueSorted(step.after),
        awaits: step.awaits ?? false,
        retryMaxAttempts: step.retryMaxAttempts ?? null,
        onError: step.onError ?? null
      })),
      acceptance: uniqueSorted(scenario.acceptance)
    }))
  };
}

function canonicalPins(pins: readonly ManifestPin[]): object[] {
  const declarations = pins.map((pin) => ({
    id: pin.id,
    type: pin.type,
    required: pin.required ?? false
  }));
  return uniqueSortedByKey(declarations, (declaration) => JSON.stringify(declaration));
}

function canonicalManifest(entry: InputRevisionManifest): object {
  return {
    blockId: entry.blockId,
    requires: uniqueSorted(entry.manifest.requires),
    provides: uniqueSorted(entry.manifest.provides),
    pins: {
      inputs: canonicalPins(entry.manifest.pins.inputs),
      outputs: canonicalPins(entry.manifest.pins.outputs)
    },
    generators: stableById(entry.manifest.generators ?? []).map(canonicalGenerator)
  };
}

function canonicalGenerator(generator: ManifestGenerator): object {
  switch (generator.kind) {
    case 'generate-state-transition-map':
      return {
        id: generator.id,
        kind: generator.kind,
        contract: generator.contract,
        state: generator.state,
        target: normalizedArtifactTarget(generator.target),
        consumes: uniqueSorted(generator.consumes),
        produces: generator.produces,
        typeBinding: { ...generator.typeBinding },
        verification: uniqueSorted(generator.verification)
      };
  }
}

function canonicalResolvedBlocks(blocks: readonly ResolvedBlock[]): object[] {
  const declarations = blocks.map((block) => ({
    id: block.id,
    version: block.version,
    kind: block.kind,
    registrySourceId: block.registrySourceId
  }));
  return uniqueSortedByKey(declarations, (declaration) => JSON.stringify(declaration));
}

function canonicalManifestDeclarations(manifests: readonly InputRevisionManifest[]): object[] {
  const declarations = manifests.map(canonicalManifest);
  return uniqueSortedByKey(declarations, (declaration) => JSON.stringify(declaration));
}

function canonicalSemanticContractDeclarations(contracts: readonly LoadedSemanticContract[]): object[] {
  const declarations = contracts.map((entry) => ({
    blockId: entry.blockId,
    contract: canonicalSemanticContract(entry.contract)
  }));
  return uniqueSortedByKey(declarations, (declaration) => JSON.stringify(declaration));
}

function canonicalPolicyDeclarations(policies: readonly PolicyRule[]): object[] {
  const declarations = policies.map((policy) => ({
    id: policy.id,
    severity: policy.severity,
    appliesTo: uniqueSorted(policy.appliesTo),
    rule: policy.rule
  }));
  return uniqueSortedByKey(declarations, (declaration) => JSON.stringify(declaration));
}

function canonicalObservedFlows(flows: readonly InputRevisionObservedFlow[]): object[] {
  return uniqueSortedByKey(flows.map((flow) => ({
    providerId: flow.providerId,
    sourceCapability: flow.sourceCapability,
    sourcePath: normalizedArtifactTarget(flow.sourcePath),
    sourceRevision: flow.sourceRevision,
    target: normalizedArtifactTarget(flow.target)
  })), (flow) => JSON.stringify(flow));
}

export function inputRevisionPayload(input: InputRevisionDomain): string {
  const observedFlows = canonicalObservedFlows(input.observedFlows ?? []);
  return JSON.stringify({
    domain: 'engineering-ir-input-v1',
    app: {
      id: input.app.id,
      name: input.app.name
    },
    resolvedBlocks: canonicalResolvedBlocks(input.resolvedBlocks),
    manifests: canonicalManifestDeclarations(input.manifests),
    semanticContracts: canonicalSemanticContractDeclarations(input.semanticContracts ?? []),
    acceptanceIds: uniqueSorted(input.acceptanceIds),
    policyDeclarations: canonicalPolicyDeclarations(input.policyDeclarations),
    ...(observedFlows.length > 0 ? { observedFlows } : {})
  });
}

export function semanticRevisionPayload(
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
    facts: facts.map((fact) => ({
      ...fact,
      assertions: fact.assertions.map(({ validFromRevision: _validFromRevision, validToRevision: _validToRevision, ...assertion }) => assertion)
    })),
    scenarios
  });
}
