import path from 'node:path';
import { generatedStateDigest, type GeneratedStateCleanupProfile } from '../../execution/generated-state/contract.ts';
import type { GeneratedStateDomainOwnerOperation, GeneratedStateDomainOwnerReceipt } from '../../execution/generated-state/operation-port.ts';
import { settleGeneratedState, type GeneratedStateCleanupDependencies } from './cleanup.ts';
import { inspectGeneratedState, planGeneratedStateCleanup } from './inventory.ts';

export function parseGeneratedStateOperation(args: readonly string[]) {
  const operation = args[0];
  if (operation !== 'inspect' && operation !== 'plan' && operation !== 'cleanup') throw new Error(
    'Generated-state operation requires inspect, plan, or cleanup with optional --workspace <absolute-path> and --profile <automatic|safe|all-rebuildable>.');
  let workspaceRoot = process.cwd(), profile: GeneratedStateCleanupProfile = 'safe';
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '--workspace') {
      const value = args[index + 1];
      if (value === undefined || !path.isAbsolute(value)) throw new Error('Generated-state --workspace must be one absolute path.');
      workspaceRoot = path.resolve(value); index += 1; continue;
    }
    if (argument === '--profile') {
      const value = args[index + 1];
      if (value !== 'automatic' && value !== 'safe' && value !== 'all-rebuildable') throw new Error('Generated-state --profile is invalid.');
      profile = value; index += 1; continue;
    }
    throw new Error(`Generated-state operation argument is unsupported: ${argument}`);
  }
  return Object.freeze({ operation, workspaceRoot, profile });
}
export async function runGeneratedStateOperation(parsed: ReturnType<typeof parseGeneratedStateOperation>, repositoryRoot: string,
  domainOwners: readonly GeneratedStateDomainOwnerOperation[], dependencies: GeneratedStateCleanupDependencies): Promise<unknown> {
  const resolvedRepositoryRoot = path.resolve(repositoryRoot);
  const inventory = await inspectGeneratedState({ repositoryRoot: resolvedRepositoryRoot, workspaceRoot: parsed.workspaceRoot }, dependencies);
  if (parsed.operation === 'inspect') return inventory;
  const genericPlan = planGeneratedStateCleanup({ inventory, profile: parsed.profile });
  const ownerPlans = Object.freeze(domainOwners.map(owner => {
    const plan = owner.plan({ repositoryRoot: resolvedRepositoryRoot, workspaceRoot: parsed.workspaceRoot, inventory, profile: parsed.profile });
    if (plan.owner !== owner.owner || plan.inventoryDigest !== inventory.inventoryDigest) throw new Error('Generated-state domain owner returned a foreign plan.');
    return plan;
  }));
  if (parsed.operation === 'plan') return Object.freeze({ schema: 'sec-generated-state-cleanup-plan-v1', repositoryRoot: resolvedRepositoryRoot,
    workspaceRoot: parsed.workspaceRoot, inventoryDigest: inventory.inventoryDigest, profile: parsed.profile,
    selected: genericPlan.selected, protected: genericPlan.protected, ownerPlans });
  const ownerReceipts: GeneratedStateDomainOwnerReceipt[] = [];
  for (let index = 0; index < domainOwners.length; index += 1) {
    const owner = domainOwners[index]!, plan = ownerPlans[index]!, receipt = await owner.settle(plan);
    if (receipt.owner !== owner.owner || receipt.planDigest !== plan.planDigest || receipt.terminal !== 'completed') throw new Error(`Generated-state domain owner settlement is not terminal: ${owner.owner}`);
    ownerReceipts.push(receipt);
  }
  const cleanup = await settleGeneratedState({ repositoryRoot: resolvedRepositoryRoot, workspaceRoot: parsed.workspaceRoot, profile: parsed.profile }, dependencies);
  const material = Object.freeze({ schema: 'sec-generated-state-operation-settlement-v1' as const, repositoryRoot: resolvedRepositoryRoot,
    workspaceRoot: parsed.workspaceRoot, profile: parsed.profile, beforeInventoryDigest: inventory.inventoryDigest,
    ownerReceipts: Object.freeze(ownerReceipts), cleanup, cleanupSettlementDigest: cleanup.settlementDigest, terminal: cleanup.terminal });
  return Object.freeze({ ...material, receiptDigest: generatedStateDigest(material) });
}
