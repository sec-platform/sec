import YAML from 'yaml';

import { publishCanonicalWorkspaceFile } from '../../workspace/files.ts';
import { getWorkspacePaths } from '../../workspace/paths.ts';
import type { AppMode, PlanFile, PlanSlot, SlotKind } from '../contract.ts';
import { CompilerError } from '../errors.ts';
import { loadPlan, validatePlan } from '../parse/load-plan.ts';

export type EngineeringOperationKind =
  | 'set-app-name'
  | 'set-app-mode'
  | 'add-acceptance'
  | 'set-slot-description'
  | 'set-slot-source-path'
  | 'add-block'
  | 'remove-block'
  | 'bind-slot'
  | 'unbind-slot';

export type EngineeringOperation =
  | { id: string; kind: 'set-app-name'; value: string }
  | { id: string; kind: 'set-app-mode'; value: AppMode }
  | { id: string; kind: 'add-acceptance'; acceptanceId: string }
  | { id: string; kind: 'set-slot-description'; slotId: string; description: string }
  | { id: string; kind: 'set-slot-source-path'; slotId: string; sourcePath: string }
  | { id: string; kind: 'add-block'; blockId: string; version: string }
  | { id: string; kind: 'remove-block'; blockId: string }
  | {
      id: string;
      kind: 'bind-slot';
      slotId: string;
      block: string;
      slotKind: SlotKind;
      target: string;
      sourcePath: string;
      symbol: string;
      description?: string;
    }
  | { id: string; kind: 'unbind-slot'; slotId: string };

export interface EngineeringOperationResult {
  readonly id: string;
  readonly kind: EngineeringOperationKind;
  readonly status: 'applied' | 'skipped';
  readonly detail: string;
}

export type EngineeringOperationCommitFence = () => Promise<void>;

function result(
  operation: EngineeringOperation,
  status: EngineeringOperationResult['status'],
  detail: string
): EngineeringOperationResult {
  return Object.freeze({ id: operation.id, kind: operation.kind, status, detail });
}

function applyOperation(plan: PlanFile, operation: EngineeringOperation): EngineeringOperationResult {
  if (operation.kind === 'set-app-name') {
    if (plan.app.name === operation.value) return result(operation, 'skipped', 'app name already matches');
    plan.app.name = operation.value;
    return result(operation, 'applied', `set app.name to ${operation.value}`);
  }
  if (operation.kind === 'set-app-mode') {
    if (plan.app.mode === operation.value) return result(operation, 'skipped', 'app mode already matches');
    plan.app.mode = operation.value;
    return result(operation, 'applied', `set app.mode to ${operation.value}`);
  }
  if (operation.kind === 'add-acceptance') {
    if (plan.acceptance.some((entry) => entry.id === operation.acceptanceId)) {
      return result(operation, 'skipped', 'acceptance already exists');
    }
    plan.acceptance.push({ id: operation.acceptanceId });
    return result(operation, 'applied', `added acceptance ${operation.acceptanceId}`);
  }
  if (operation.kind === 'add-block') {
    if (plan.blocks.some((block) => block.id === operation.blockId)) {
      return result(operation, 'skipped', `block ${operation.blockId} already installed`);
    }
    plan.blocks.push({ id: operation.blockId, version: operation.version });
    return result(operation, 'applied', `installed block ${operation.blockId}@${operation.version}`);
  }
  if (operation.kind === 'remove-block') {
    if (!plan.blocks.some((block) => block.id === operation.blockId)) {
      return result(operation, 'skipped', `block ${operation.blockId} not installed`);
    }
    plan.blocks = plan.blocks.filter((block) => block.id !== operation.blockId);
    plan.slots = plan.slots.filter((slot) => slot.block !== operation.blockId);
    return result(operation, 'applied', `removed block ${operation.blockId} and its slots`);
  }
  if (operation.kind === 'bind-slot') {
    const existingIndex = plan.slots.findIndex((slot) => slot.id === operation.slotId);
    const newSlot: PlanSlot = {
      id: operation.slotId,
      block: operation.block,
      kind: operation.slotKind,
      target: operation.target,
      sourcePath: operation.sourcePath,
      symbol: operation.symbol,
      description: operation.description ?? ''
    };
    if (existingIndex !== -1) {
      const existing = plan.slots[existingIndex]!;
      const matches = existing.block === newSlot.block
        && existing.kind === newSlot.kind
        && existing.target === newSlot.target
        && existing.sourcePath === newSlot.sourcePath
        && existing.symbol === newSlot.symbol
        && existing.description === newSlot.description;
      if (matches) return result(operation, 'skipped', `slot ${operation.slotId} already bound with same config`);
      plan.slots[existingIndex] = newSlot;
      return result(operation, 'applied', `updated slot ${operation.slotId} binding`);
    }
    plan.slots.push(newSlot);
    return result(operation, 'applied', `bound slot ${operation.slotId} to ${operation.block}`);
  }
  if (operation.kind === 'unbind-slot') {
    if (!plan.slots.some((slot) => slot.id === operation.slotId)) {
      return result(operation, 'skipped', `slot ${operation.slotId} not bound`);
    }
    plan.slots = plan.slots.filter((slot) => slot.id !== operation.slotId);
    return result(operation, 'applied', `unbound slot ${operation.slotId}`);
  }

  const slot = plan.slots.find((entry) => entry.id === operation.slotId);
  if (!slot) {
    throw new CompilerError(
      'ENGINEERING-OPERATION-001',
      `Engineering operation slot "${operation.slotId}" does not exist in sec.yaml`,
      { operationId: operation.id, operationKind: operation.kind, slotId: operation.slotId }
    );
  }
  if (operation.kind === 'set-slot-description') {
    if (slot.description === operation.description) return result(operation, 'skipped', 'slot description already matches');
    slot.description = operation.description;
    return result(operation, 'applied', `set ${operation.slotId}.description`);
  }
  if (slot.sourcePath === operation.sourcePath) return result(operation, 'skipped', 'slot sourcePath already matches');
  slot.sourcePath = operation.sourcePath;
  return result(operation, 'applied', `set ${operation.slotId}.sourcePath to ${operation.sourcePath}`);
}

/**
 * Canonical Plan operation writer. Ingresses normalize transport-specific DTOs
 * into EngineeringOperation values, then this owner alone mutates/validates and
 * publishes sec.yaml.
 */
export async function applyEngineeringOperations(
  workspaceRoot: string,
  operations: readonly EngineeringOperation[],
  commitFence: EngineeringOperationCommitFence
): Promise<readonly EngineeringOperationResult[]> {
  const { workspaceConfigPath } = getWorkspacePaths(workspaceRoot);
  const plan = await loadPlan(workspaceConfigPath);
  const results = operations.map((operation) => applyOperation(plan, operation));
  if (results.some((entry) => entry.status === 'applied')) {
    validatePlan(plan);
    await publishCanonicalWorkspaceFile({
      workspaceRoot,
      targetPath: workspaceConfigPath,
      bytes: Buffer.from(YAML.stringify(plan, { indent: 2 }), 'utf8'),
      label: 'Engineering Operation Plan publication',
      commitFence
    });
  }
  return Object.freeze(results);
}
