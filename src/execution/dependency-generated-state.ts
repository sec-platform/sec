import path from 'node:path';
import { compareCodeUnits } from '../contracts/canonical.ts';
import { CodedFailure } from '../contracts/failure.ts';
import { generatedStateDigest, type GeneratedStateCleanupProfile, type GeneratedStateInventory, type GeneratedStatePhysicalIdentity } from './generated-state/contract.ts';
export const COMPILER_STAGING_LIFECYCLE_RULE = 'compiler-dependency-staging' as const;
export const COMPILER_STAGING_LIFECYCLE_OWNER = 'compiler-dependency-runtime' as const;
const sameGeneratedStateIdentity = (a: GeneratedStatePhysicalIdentity,b: GeneratedStatePhysicalIdentity) => a.device===b.device&&a.inode===b.inode&&a.objectId===b.objectId;
const COMPILER_DEPENDENCY_GENERATED_STATE_PLAN_SCHEMA =
  'sec-compiler-dependency-generated-state-settlement-plan-v1' as const;
const COMPILER_DEPENDENCY_GENERATED_STATE_RECEIPT_SCHEMA =
  'sec-compiler-dependency-generated-state-settlement-receipt-v1' as const;

export interface CompilerDependencyGeneratedStateSettlementPlan {
  readonly schema: typeof COMPILER_DEPENDENCY_GENERATED_STATE_PLAN_SCHEMA;
  readonly owner: 'compiler-dependency-runtime';
  readonly repositoryRoot: string;
  readonly workspaceRoot: string;
  readonly workspace: GeneratedStatePhysicalIdentity;
  readonly profile: GeneratedStateCleanupProfile;
  readonly inventoryDigest: `sha256:${string}`;
  readonly selected: readonly Readonly<{
    readonly relativePath: string;
    readonly physicalIdentity: GeneratedStatePhysicalIdentity;
    readonly registrationDigest: `sha256:${string}`;
  }>[];
  readonly planDigest: `sha256:${string}`;
}

export interface CompilerDependencyGeneratedStateSettlementReceipt {
  readonly schema: typeof COMPILER_DEPENDENCY_GENERATED_STATE_RECEIPT_SCHEMA;
  readonly owner: 'compiler-dependency-runtime';
  readonly planDigest: `sha256:${string}`;
  readonly beforeInventoryDigest: `sha256:${string}`;
  readonly afterInventoryDigest: `sha256:${string}`;
  readonly outcomes: readonly Readonly<{
    readonly relativePath: string;
    readonly outcome: 'absent' | 'preserved-replacement' | 'residue';
  }>[];
  readonly terminal: 'completed' | 'partial-residue';
  readonly receiptDigest: `sha256:${string}`;
}
export function planCompilerDependencyGeneratedStateSettlement(input: Readonly<{
  repositoryRoot: string;
  workspaceRoot: string;
  inventory: GeneratedStateInventory;
  profile: GeneratedStateCleanupProfile;
  workspaceIdentity: GeneratedStatePhysicalIdentity;
}>): CompilerDependencyGeneratedStateSettlementPlan {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const workspaceRoot = path.resolve(input.workspaceRoot);
  if (input.inventory.repositoryRoot !== repositoryRoot) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Dependency generated-state inventory belongs to another repository');
  }
  const workspaceIdentity = input.workspaceIdentity;
  if (!sameGeneratedStateIdentity(workspaceIdentity, input.inventory.workspace)) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Dependency generated-state workspace identity changed before planning');
  }
  const selected = Object.freeze(input.inventory.entries
    .filter((entry) => entry.ruleId === COMPILER_STAGING_LIFECYCLE_RULE &&
      entry.owner === COMPILER_STAGING_LIFECYCLE_OWNER && entry.kind === 'directory' &&
      entry.registrationState === 'active' && entry.registrationDigest !== null &&
      entry.physicalIdentity !== null && entry.cleanupProfiles.includes(input.profile))
    .map((entry) => Object.freeze({
      relativePath: entry.relativePath,
      physicalIdentity: entry.physicalIdentity!,
      registrationDigest: entry.registrationDigest!
    }))
    .sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath)));
  const material = Object.freeze({
    schema: COMPILER_DEPENDENCY_GENERATED_STATE_PLAN_SCHEMA,
    owner: COMPILER_STAGING_LIFECYCLE_OWNER,
    repositoryRoot,
    workspaceRoot,
    workspace: workspaceIdentity,
    profile: input.profile,
    inventoryDigest: input.inventory.inventoryDigest,
    selected
  });
  return Object.freeze({ ...material, planDigest: generatedStateDigest(material) });
}
export function compileCompilerDependencyGeneratedStateReceipt(plan: CompilerDependencyGeneratedStateSettlementPlan, before: GeneratedStateInventory, after: GeneratedStateInventory): CompilerDependencyGeneratedStateSettlementReceipt {
const outcomes = Object.freeze(plan.selected.map((selected) => {
    const current = after.entries.find(({ relativePath }) => relativePath === selected.relativePath);
    const outcome = current === undefined || current.kind === 'missing'
      ? 'absent' as const
      : current.physicalIdentity !== null &&
          sameGeneratedStateIdentity(current.physicalIdentity, selected.physicalIdentity)
        ? 'residue' as const
        : 'preserved-replacement' as const;
    return Object.freeze({ relativePath: selected.relativePath, outcome });
  }));
  const terminal = outcomes.every(({ outcome }) => outcome === 'absent')
    ? 'completed' as const
    : 'partial-residue' as const;
  const material = Object.freeze({
    schema: COMPILER_DEPENDENCY_GENERATED_STATE_RECEIPT_SCHEMA,
    owner: COMPILER_STAGING_LIFECYCLE_OWNER,
    planDigest: plan.planDigest,
    beforeInventoryDigest: before.inventoryDigest,
    afterInventoryDigest: after.inventoryDigest,
    outcomes,
    terminal
  });
  return Object.freeze({ ...material, receiptDigest: generatedStateDigest(material) });

}
