import path from 'node:path';

import { compareCodeUnits, uniqueSorted } from '../contracts/canonical.ts';
import { summarizeCounts } from '../contracts/collections.ts';
import type {
  LockFile,
  ManifestEntry,
  PlanFile,
  UpgradeMigration
} from '../compiler/contract.ts';
import { CompilerError } from '../compiler/errors.ts';
import {
  assertUpgradeAllowed,
  buildUpgradePreflightChecks,
  buildUpgradePreview,
  collectMigrationImpacts,
  lockStateRevision,
  planningRequestRevision,
  type UpgradePreflightEvidence,
  type UpgradeVersionRangeMatcher
} from '../compiler/upgrade/planning.ts';
import type { UpgradeMigrationEntry } from '../semantics/upgrade/manifest-types.ts';
import { executeUpgradePlanningWithFailurePublication } from './upgrade-failure-publication.ts';
import {
  upgradeArtifactDigest,
  type UpgradeExecutionTerminal,
  type UpgradePlan,
  type UpgradePreview
} from '../semantics/upgrade/upgrade-artifact.ts';

type UpgradePlanningMaterial = UpgradePlan | UpgradePreview;

type Awaitable<T> = T | PromiseLike<T>;

export type UpgradePlanningUseCaseInput = Readonly<{
  blockId: string;
  currentBlock: PlanFile['blocks'][number] | undefined;
  lock: LockFile | null;
  plan: PlanFile;
  targetVersion: string;
  workspaceRoot: string;
}>;

export type PlannedWorkspaceUpgrade = Readonly<{
  currentBlock: PlanFile['blocks'][number];
  impacts: string[];
  migrationEntries: UpgradeMigrationEntry[];
  targetManifestRoot: string;
  upgradePreview: UpgradePreview;
}>;

export interface UpgradeWorkspacePreviewReadOperations {
  loadWorkspacePlan(workspaceRoot: string): Promise<PlanFile>;
  readLockFile(workspaceRoot: string): Promise<LockFile>;
}

export type UpgradeApplyPlanningFailureContext = Readonly<{
  blockId: string;
  targetVersion: string;
  workspaceIdentityDigest: string;
  planningRequestRevision: string;
  existingLock: LockFile | null;
}>;

export interface UpgradeApplyPlanningOperations extends UpgradeWorkspacePreviewReadOperations {
  readOptionalLock(workspaceRoot: string): Promise<LockFile | null>;
  clearPlan(): Promise<void>;
  clearExecutionTerminal(): Promise<void>;
  publishDiagnostics(
    failure: CompilerError,
    context: UpgradeApplyPlanningFailureContext
  ): Promise<void>;
}

export type PreparedUpgradeApplyPlanning = Readonly<{
  plan: PlanFile;
  existingLock: LockFile | null;
  plannedUpgrade: PlannedWorkspaceUpgrade;
  planningRequestRevision: string;
}>;

export interface UpgradePlanningUseCaseOperations {
  loadTargetManifest(input: Readonly<{
    blockId: string;
    targetVersion: string;
    workspaceRoot: string;
    registrySources: PlanFile['registry']['sources'];
  }>): Awaitable<ManifestEntry>;
  loadMigrationEntries(
    targetManifestRoot: string,
    blockId: string,
    targetVersion: string,
    migrations: UpgradeMigration[]
  ): Promise<UpgradeMigrationEntry[]>;
  collectPreflightEvidence(input: Readonly<{
    blockId: string;
    impacts: string[];
    migrationEntries: UpgradeMigrationEntry[];
    targetManifestRoot: string;
    workspaceRoot: string;
  }>): Promise<UpgradePreflightEvidence>;
  matchesVersionRange: UpgradeVersionRangeMatcher;
}

export async function planWorkspaceUpgrade(
  input: UpgradePlanningUseCaseInput,
  operations: UpgradePlanningUseCaseOperations
): Promise<PlannedWorkspaceUpgrade> {
  if ([
    operations.loadTargetManifest,
    operations.loadMigrationEntries,
    operations.collectPreflightEvidence,
    operations.matchesVersionRange
  ].some(operation => typeof operation !== 'function')) {
    throw new TypeError('Upgrade planning operations must be callable');
  }

  const { blockId, currentBlock, lock, plan, targetVersion, workspaceRoot } = input;
  if (!currentBlock?.version) {
    throw new CompilerError(
      'UPGRADE-BLOCKED-003',
      `Block "${blockId}" is not declared in app.plan.yaml`
    );
  }

  const currentVersion = currentBlock.version;
  const targetEntry = await operations.loadTargetManifest.call(operations, {
    blockId,
    targetVersion,
    workspaceRoot,
    registrySources: plan.registry.sources
  });
  const migrations = targetEntry.manifest.upgrade?.migrations ?? [];
  const acceptedRanges = targetEntry.manifest.upgrade?.from ?? [];
  assertUpgradeAllowed(
    currentVersion,
    targetVersion,
    migrations,
    acceptedRanges,
    operations.matchesVersionRange
  );

  const targetManifestRoot = path.dirname(targetEntry.manifestPath);
  const migrationEntries = await operations.loadMigrationEntries.call(
    operations,
    targetManifestRoot,
    blockId,
    targetVersion,
    migrations
  );
  const impacts = uniqueSorted([
    ...targetEntry.manifest.installs.map(install => install.to),
    ...collectMigrationImpacts(migrationEntries)
  ]);
  const evidence = await operations.collectPreflightEvidence.call(operations, {
    blockId,
    impacts,
    migrationEntries,
    targetManifestRoot,
    workspaceRoot
  });
  const preflightChecks = buildUpgradePreflightChecks({
    acceptedRanges,
    currentVersion,
    evidence,
    impacts,
    migrationEntries,
    migrations,
    targetVersion
  });
  const compatibility = targetEntry.manifest.compatibility;
  if (!compatibility) {
    throw new CompilerError(
      'UPGRADE-BLOCKED-004',
      `Block "${blockId}" target compatibility is unresolved`
    );
  }
  const sourceRevision = upgradeArtifactDigest({
    domain: 'sec.upgrade.source',
    manifest: targetEntry.manifest,
    manifestPath: targetEntry.manifestPath,
    registrySourceId: targetEntry.registrySourceId,
    registryKind: targetEntry.registryKind,
    registryLocation: targetEntry.registryLocation,
    registryPath: targetEntry.registryPath,
    migrationEntries
  });
  const lockRevision = lockStateRevision(lock);

  return Object.freeze({
    currentBlock,
    impacts,
    migrationEntries,
    targetManifestRoot,
    upgradePreview: buildUpgradePreview(
      blockId,
      currentVersion,
      targetVersion,
      upgradeArtifactDigest({
        domain: 'sec.upgrade.planning-input',
        blockId,
        targetVersion,
        workspacePlan: plan,
        sourceRevision,
        lockRevision,
        compatibility
      }),
      sourceRevision,
      lockRevision,
      compatibility,
      preflightChecks,
      impacts,
      migrations,
      migrationEntries
    )
  });
}

/**
 * Read one retained workspace snapshot and compute the Upgrade preview.
 * Application owns the use-case ordering; bootstrap only binds the concrete
 * workspace readers and planning providers.
 */
export async function planUpgradeWorkspaceFromWorkspace(
  workspaceRoot: string,
  blockId: string,
  targetVersion: string,
  planningOperations: UpgradePlanningUseCaseOperations,
  readOperations: UpgradeWorkspacePreviewReadOperations
): Promise<{
  resultKind: 'preview';
  plan: PlanFile;
  lock: LockFile;
  upgradePlan: UpgradePreview;
}> {
  if (typeof readOperations.loadWorkspacePlan !== 'function' ||
      typeof readOperations.readLockFile !== 'function') {
    throw new TypeError('Upgrade workspace preview readers must be callable');
  }
  const plan = await readOperations.loadWorkspacePlan.call(readOperations, workspaceRoot);
  const lock = await readOperations.readLockFile.call(readOperations, workspaceRoot);
  const currentBlock = plan.blocks.find((block) => block.id === blockId);
  const plannedUpgrade = await planWorkspaceUpgrade({
    blockId,
    currentBlock,
    lock,
    plan,
    targetVersion,
    workspaceRoot
  }, planningOperations);
  return Object.freeze({
    resultKind: 'preview' as const,
    plan,
    lock,
    upgradePlan: plannedUpgrade.upgradePreview
  });
}

/**
 * Prepare one write-authorized Upgrade apply from a retained workspace view.
 * Application owns request-revision binding, planning failure behavior and the
 * resulting planned use-case state. Bootstrap supplies only concrete I/O.
 */
export async function prepareUpgradeApplyPlanning(
  input: Readonly<{
    workspaceRoot: string;
    blockId: string;
    targetVersion: string;
    workspaceIdentityDigest: string;
  }>,
  planningOperations: UpgradePlanningUseCaseOperations,
  operations: UpgradeApplyPlanningOperations
): Promise<PreparedUpgradeApplyPlanning> {
  if (typeof operations.loadWorkspacePlan !== 'function' ||
      typeof operations.readOptionalLock !== 'function' ||
      typeof operations.clearPlan !== 'function' ||
      typeof operations.clearExecutionTerminal !== 'function' ||
      typeof operations.publishDiagnostics !== 'function') {
    throw new TypeError('Upgrade apply planning operations must be callable');
  }

  const plan = await operations.loadWorkspacePlan.call(operations, input.workspaceRoot);
  const existingLock = await operations.readOptionalLock.call(operations, input.workspaceRoot);
  const currentBlock = plan.blocks.find((block) => block.id === input.blockId);
  const requestRevision = planningRequestRevision({
    workspaceIdentityDigest: input.workspaceIdentityDigest,
    blockId: input.blockId,
    targetVersion: input.targetVersion,
    plan,
    lock: existingLock
  });

  const plannedUpgrade = await executeUpgradePlanningWithFailurePublication(
    () => planWorkspaceUpgrade({
      blockId: input.blockId,
      currentBlock,
      lock: existingLock,
      plan,
      targetVersion: input.targetVersion,
      workspaceRoot: input.workspaceRoot
    }, planningOperations),
    {
      clearPlan: () => operations.clearPlan.call(operations),
      clearExecutionTerminal: () => operations.clearExecutionTerminal.call(operations),
      publishDiagnostics: failure => operations.publishDiagnostics.call(
        operations,
        failure,
        {
          blockId: input.blockId,
          targetVersion: input.targetVersion,
          workspaceIdentityDigest: input.workspaceIdentityDigest,
          planningRequestRevision: requestRevision,
          existingLock
        }
      )
    }
  );

  return Object.freeze({
    plan,
    existingLock,
    plannedUpgrade,
    planningRequestRevision: requestRevision
  });
}

type CountView = Readonly<{ id: string; count: number }>;

type UpgradeMigrationView = Readonly<{
  id: string;
  kind: string;
  target: string;
  source?: string;
  role?: string;
  path?: readonly string[];
  updateCount?: number;
  itemCount?: number;
  valueKeyCount?: number;
  contentLength?: number;
  searchLength?: number;
  replacementLength?: number;
  pattern?: string;
  flags?: string;
  requiresVerification: boolean;
}>;

type UpgradePreflightView = Readonly<{
  id: string;
  status: string;
  evidenceCount: number;
}>;

export type UpgradePlanningView = Readonly<{
  blockId: string;
  fromVersion: string;
  toVersion: string;
  presentation: 'preview' | 'planned' | 'applied';
  migrationCount: number;
  preflightCheckCount: number;
  migrationKindCounts: readonly CountView[];
  operationRoleCounts: readonly CountView[];
  impacts: readonly string[];
  preflightEvidenceCount: number;
  requiresVerificationCount: number;
  migrations: readonly UpgradeMigrationView[];
  preflightChecks: readonly UpgradePreflightView[];
}>;

function projectCountRecord(record: Readonly<Record<string, number>>): readonly CountView[] {
  return Object.entries(record)
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([id, count]) => ({ id, count }));
}

function projectUpgradePlanning(
  plan: UpgradePlanningMaterial,
  presentation: UpgradePlanningView['presentation']
): UpgradePlanningView {
  const operationsById = new Map(plan.migrationOperations.map((operation) => [operation.id, operation]));
  const migrations = plan.migrationSummaries.slice(0, 3).map((migration) => {
    const operation = operationsById.get(migration.id);
    return {
      id: migration.id,
      kind: migration.kind,
      target: migration.target,
      ...(migration.source ? { source: migration.source } : {}),
      ...(operation?.role === undefined ? {} : { role: operation.role }),
      ...(operation?.path === undefined ? {} : { path: [...operation.path] }),
      ...(operation?.updateCount === undefined ? {} : { updateCount: operation.updateCount }),
      ...(operation?.itemCount === undefined ? {} : { itemCount: operation.itemCount }),
      ...(operation?.valueKeyCount === undefined ? {} : { valueKeyCount: operation.valueKeyCount }),
      ...(operation?.contentLength === undefined ? {} : { contentLength: operation.contentLength }),
      ...(operation?.searchLength === undefined ? {} : { searchLength: operation.searchLength }),
      ...(operation?.replacementLength === undefined ? {} : { replacementLength: operation.replacementLength }),
      ...(operation?.pattern === undefined ? {} : { pattern: operation.pattern }),
      ...(operation?.flags === undefined ? {} : { flags: operation.flags }),
      requiresVerification: migration.requiresVerification
    };
  });

  return {
    blockId: plan.blockId,
    fromVersion: plan.fromVersion,
    toVersion: plan.toVersion,
    presentation,
    migrationCount: plan.migrations.length,
    preflightCheckCount: plan.preflightChecks.length,
    migrationKindCounts: projectCountRecord(plan.migrationKindCounts),
    operationRoleCounts: summarizeCounts(plan.migrationOperations.map((operation) => operation.role)),
    impacts: [...plan.impacts],
    preflightEvidenceCount: plan.preflightChecks.reduce((count, check) => count + check.evidence.length, 0),
    requiresVerificationCount: plan.migrationSummaries.filter((migration) => migration.requiresVerification).length,
    migrations,
    preflightChecks: plan.preflightChecks.slice(0, 3).map((check) => ({
      id: check.id,
      status: check.status,
      evidenceCount: check.evidence.length
    }))
  };
}

export function projectUpgradePreview(preview: UpgradePreview): UpgradePlanningView {
  return projectUpgradePlanning(preview, 'preview');
}

export function projectUpgradePlan(
  plan: UpgradePlan,
  executionTerminal: UpgradeExecutionTerminal | null
): UpgradePlanningView {
  return projectUpgradePlanning(
    plan,
    executionTerminal?.settlement === 'applied' ? 'applied' : 'planned'
  );
}
