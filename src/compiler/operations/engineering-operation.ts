import YAML from 'yaml';

import { publishCanonicalWorkspaceFile } from '../../workspace/files.ts';
import { getWorkspacePaths } from '../../workspace/runtime/paths.ts';
import type { AppMode, PlanFile } from '../contract.ts';
import { loadPlan, validatePlan } from '../parse/load-plan.ts';

export type EngineeringOperationKind =
  | 'set-app-name'
  | 'set-app-mode'
  | 'add-acceptance'
  | 'add-block'
  | 'remove-block';

export type EngineeringOperation =
  | { id: string; kind: 'set-app-name'; value: string }
  | { id: string; kind: 'set-app-mode'; value: AppMode }
  | { id: string; kind: 'add-acceptance'; acceptanceId: string }
  | { id: string; kind: 'add-block'; blockId: string; version: string }
  | { id: string; kind: 'remove-block'; blockId: string };

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
    return result(operation, 'applied', `removed block ${operation.blockId}`);
  }
  const unreachable: never = operation;
  return unreachable;
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
