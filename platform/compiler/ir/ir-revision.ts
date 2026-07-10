import { createHash } from 'node:crypto';

import {
  ENGINEERING_IR_FORMAT_VERSION,
  type ScenarioDefinition,
  type SemanticEntity,
  type SemanticFact
} from '../../shared/engineering-ir-types.ts';
import type { ResolvedBlock, SlotTask } from '../../shared/lock-types.ts';
import type { BlockManifest } from '../../shared/plan-manifest-types.ts';
import type {
  LoadedSemanticContract,
  SemanticContract
} from '../../shared/semantic-contract-types.ts';

export interface InputRevisionManifest {
  blockId: string;
  manifest: Pick<BlockManifest, 'requires' | 'provides' | 'pins'>;
}

export interface InputRevisionDomain {
  app: { id: string; name: string };
  resolvedBlocks: readonly ResolvedBlock[];
  manifests: readonly InputRevisionManifest[];
  slotTasks: readonly SlotTask[];
  acceptanceIds: readonly string[];
  policyIds: readonly string[];
  semanticContracts?: readonly LoadedSemanticContract[];
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function stableById<Value extends { id: string }>(values: readonly Value[]): Value[] {
  return [...values].sort((left, right) => left.id.localeCompare(right.id));
}

function canonicalSemanticContract(contract: SemanticContract): object {
  return {
    formatVersion: contract.formatVersion,
    id: contract.id,
    namespace: contract.namespace,
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
      transitions: [...state.transitions]
        .map((transition) => ({ from: transition.from, to: transition.to, by: transition.by }))
        .sort((left, right) => `${left.from}:${left.to}:${left.by}`.localeCompare(`${right.from}:${right.to}:${right.by}`))
    })),
    responsibilities: stableById(contract.responsibilities).map((responsibility) => ({
      id: responsibility.id,
      label: responsibility.label ?? responsibility.id,
      role: responsibility.role,
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
      rule: policy.rule ?? null
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

export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function inputRevisionPayload(input: InputRevisionDomain): string {
  return JSON.stringify({
    domain: 'engineering-ir-input-v1',
    app: {
      id: input.app.id,
      name: input.app.name
    },
    resolvedBlocks: [...input.resolvedBlocks]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((block) => ({
        id: block.id,
        version: block.version,
        kind: block.kind,
        registrySourceId: block.registrySourceId
      })),
    manifests: [...input.manifests]
      .sort((left, right) => left.blockId.localeCompare(right.blockId))
      .map((entry) => ({
        blockId: entry.blockId,
        requires: uniqueSorted(entry.manifest.requires),
        provides: uniqueSorted(entry.manifest.provides),
        pins: {
          inputs: stableById(entry.manifest.pins.inputs).map((pin) => ({
            id: pin.id,
            type: pin.type,
            required: pin.required ?? false
          })),
          outputs: stableById(entry.manifest.pins.outputs).map((pin) => ({
            id: pin.id,
            type: pin.type,
            required: pin.required ?? false
          }))
        }
      })),
    semanticContracts: [...(input.semanticContracts ?? [])]
      .sort((left, right) => `${left.blockId}:${left.contract.namespace}:${left.contract.id}`.localeCompare(`${right.blockId}:${right.contract.namespace}:${right.contract.id}`))
      .map((entry) => ({
        blockId: entry.blockId,
        contract: canonicalSemanticContract(entry.contract)
      })),
    slotTasks: [...input.slotTasks]
      .sort((left, right) => `${left.block}:${left.id}`.localeCompare(`${right.block}:${right.id}`))
      .map((task) => ({
        id: task.id,
        block: task.block,
        kind: task.kind,
        target: task.target,
        symbol: task.symbol,
        inputType: task.inputType ?? null,
        outputType: task.outputType ?? null
      })),
    acceptanceIds: uniqueSorted(input.acceptanceIds),
    policyIds: uniqueSorted(input.policyIds)
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
    facts: facts.map(({ validFrom: _validFrom, validTo: _validTo, ...fact }) => fact),
    scenarios
  });
}
