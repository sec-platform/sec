import crypto from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleepMs } from 'node:timers/promises';
import { canonicalEquals, canonicalJson, compareCodeUnits, digest, sortedKeys } from '../../../../contracts/canonical.ts';
import { type CommitFence } from "../../../../contracts/commit-fence.ts";
import { parseExactJson } from '../../../../contracts/exact-json.ts';
import { boundedFailureCode } from '../../../../contracts/failure-inspection.ts';
import { CodedFailure } from '../../../../contracts/failure.ts';
import { formatJsonFile } from "../../../../contracts/json-text.ts";
import { isPathInside } from "../../../../contracts/relative-path.ts";
import { COMPILER_STAGING_LIFECYCLE_OWNER, COMPILER_STAGING_LIFECYCLE_RULE } from '../../../../execution/dependency-generated-state.ts';
import { generatedStateDigest, type GeneratedStatePhysicalIdentity, type GeneratedStateRegistration } from '../../../../execution/generated-state/contract.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation
} from '../../../../execution/operation/semantic.ts';
import { isFileNotFoundError, readJson } from "../../../filesystem/files.ts";
import { assertPhysicalGenerationRetirementReceipt, assertPhysicallyDisjointDirectoryChains, assertRetainedNoFollowProvenDirectoryGeneration, assertSameNoFollowDirectoryIdentity, copyNoFollowDirectoryTreesBulk, createExclusiveNoFollowRandomDirectory, createNoFollowOrdinaryDirectoryChain, deleteRetainedNoFollowEntry, inspectExactNoFollowDirectoryPresence, inspectExactNoFollowLinkEntry, inspectNoFollowDirectoryChain, inspectNoFollowDirectoryChild, inspectNoFollowDirectoryLeaf, inspectNoFollowLinkEntry, inspectNoFollowOrdinaryFileEntry, materializeRetainedNoFollowProvenDirectoryGeneration, openWindowsLegacySealedDirectoryRelocation, PhysicalNoFollowError, prepareWindowsLegacySealedDirectoryRelocation, publishExclusiveDurableCanonicalFile, publishExclusiveNoFollowLink, readNoFollowOrdinaryFile, relocateRetainedNoFollowDirectoryAcrossParents, relocateRetainedNoFollowLinkAcrossParents, relocateWindowsLegacySealedDirectory, reopenRetainedNoFollowProvenDirectoryGeneration, replaceDurableCanonicalFile, retireNoFollowDirectoryTree, retireNoFollowProvenDirectoryGeneration, scanNoFollowDirectoryDirectMetadata, scanNoFollowDirectoryTreeInventory, scanNoFollowDirectoryTreeMetadata, type PhysicalDirectoryIdentity, type PhysicalGenerationRetirementReceipt, type RetainedNoFollowProvenDirectoryGeneration, type WindowsLegacySealedDirectoryRelocationCapability } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { WindowsHostDirectoryAuthorityError } from '../../../runtime-state/physical/runtime/windows-host-filesystem-authority.ts';
import { resolveSecWorkspaceRuntimeRoots } from '../../../runtime-state/workspace-state/paths.ts';
import { acquireSecRuntimeStatePhysicalAuthority } from '../../../runtime-state/workspace-state/physical-authority.ts';
import { compilerRoot } from "../../../workspace-context.ts";
import type { DependencyFreshnessLockObservation } from '../contract/dependency-freshness.ts';
import {
  buildRuntimeDependencyMaterializationBinding,
  isRuntimeDependencyMaterializationBinding,
  isRuntimeDepsPreboundBinding,
  loadRuntimeDependencySpec,
  parseLegacyRuntimeDependencyMaterializationV2ForRecovery,
  RUNTIME_DEPS_PREBOUND_BINDING_FILE,
  type RuntimeDependencyMaterializationBinding,
  type RuntimeDependencySpec
} from '../contract/runtime-dependency-spec.ts';
import { runBunInstall } from './compiler-install-process.ts';
import {
  canonicalCompilerDependencyGenerationOwnerRoot,
  compilerDependencyLocatorObservation,
  isCanonicalLocalCompilerDependencyGeneration
} from './compiler-locator.ts';
import {
  assertCompilerDependencyInputsCurrent,
  COMPILER_DEPENDENCY_INSTALL_ARGS,
  compilerDependencyIdentity,
  compilerDependencyInputFenceMatches,
  compilerInstallConfigSha256,
  currentRuntimeExecutableIdentity,
  observeCompilerDependencyIdentity,
  type CompilerDependencyIdentity
} from './compiler-materialization-input.ts';
import {
  generatedStatePhysicalIdentity,
  hasExactObjectKeys,
  isCanonicalAbsolutePath,
  isCanonicalGeneratedStatePhysicalIdentity,
  isSha256Digest,
  sameGeneratedStateIdentity,
  sameGeneratedStateIdentity as sameGeneratedStatePhysicalIdentity,
  sourceGenerationWithPath,
  transitionAbsentSlot,
  transitionSlotFromPhysical,
  transitionSlotMatches,
  type DependencyTransitionJournal,
  type DependencyTransitionNamespace,
  type DependencyTransitionSlot,
  type RuntimeDependencySourceGeneration
} from './dependency-transition/contract.ts';
import {
  inspectLegacyDependencyTransitionNamespace,
  migrateLegacyDependencyTransitionUnderLease
} from './dependency-transition/migration.ts';
import {
  advanceDependencyTransition,
  assertDirectStageRootSelector,
  assertTransitionBackupSelector,
  assertTransitionOperationKey,
  beginDependencyTransition,
  compilerTransitionBackupPath,
  markDependencyTransitionFailure,
  projectTransitionBackupPath,
  readDependencyTransition,
  readDependencyTransitionLedger,
  transitionFailure
} from './dependency-transition/operation.ts';
import {
  inspectActiveDependencyTransitionRollover,
  recoverDependencyTransitionRollover
} from './dependency-transition/rollover.ts';
import {
  dependencyTransitionNamespacePaths,
  ensureDependencyTransitionNamespace,
  inspectDependencyTransitionNamespace,
  observeDependencyTransitionSlot,
  readNoFollowDirectNames,
  writeDurableTransitionFile
} from './dependency-transition/store.ts';
import { sameHostPath } from './host-path.ts';
import {
  bindAndRetireCompilerDependencyPreimage,
  bindExistingCompilerDependencyGeneration,
  bindExistingLegacySharedDependencyRoot,
  birthAndBindCompilerDependencyGeneration,
  COMPILER_NODE_MODULES_LIFECYCLE_OWNER,
  COMPILER_NODE_MODULES_LIFECYCLE_PRODUCER,
  COMPILER_NODE_MODULES_LIFECYCLE_RULE,
  COMPILER_STAGING_LIFECYCLE_PRODUCER,
  compilerDependencyStagingLifecycleExpectation,
  ensureCompilerDependencyPreimageRetiredForRecovery,
  legacySharedDependencyRetirementExpectation,
  settleRetiredCompilerDependencyGeneration
} from './lifecycle-registration.ts';
import { linkedWorktreeDependencyOwnerRoot } from './linked-worktree-owner.ts';
// Binding observation is read-only; this owner keeps the complete transition,
// recovery and generation-retention lifecycle rather than splitting its custody.
import {
  COMPILER_DEPS_BINDING_FILE,
  COMPILER_DEPS_BINDING_KEYS,
  compilerDependencyBindingMatchesIdentity,
  compilerDependencyDirectRootResolution,
  compilerDependencyGenerationBinding,
  compilerDependencyPackageBindings,
  compilerRuntimeMaterializationBinding,
  hasCompleteRuntimeDeps,
  readCompilerDepsBinding,
  runtimeDependencyTreeMatchesBinding,
  type CompilerDepsBinding
} from './materialization-binding.ts';
import {
  MAX_DEPENDENCY_OPERATION_TIMEOUT_MS,
  runtimeDependencyOperationContext,
  runtimeDependencyOperationDeadlineAt,
  runtimeDependencyOperationEffectFence,
  runtimeDependencyOperationOptions,
  runtimeDependencyOperationRemainingMs,
  waitForRuntimeDependencyOperation,
  type RuntimeDependencyInstallOptions,
  type RuntimeDependencyOperationOptions
} from './operation-context.ts';
import {
  measureRuntimeDependencyOperationPhaseAsync
} from './operation-telemetry.ts';
import {
  assertRuntimeDependencySourceGenerationIssued,
  isGeneratedStatePhysicalIdentity,
  isRuntimeDependencySourceGeneration,
  issuedRuntimeDependencySourceGenerationWithPath,
  issueRuntimeDependencySourceGenerationFromProvenDirectory,
  RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES,
  RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
  runtimeDependencySourceGeneration,
  runtimeDependencyTreeIdentity,
  sameRuntimeDependencySourceGenerationContent
} from './source-generation.ts';

export { compilerDependencyLocatorWorktreeRetirementProvider } from './compiler-locator.ts';
export {
  observeCompilerDependencyMaterializationInput,
  type CompilerDependencyMaterializationDigest,
  type CompilerDependencyMaterializationInputProjection
} from './compiler-materialization-input.ts';
export type { RuntimeDependencySourceGeneration } from './dependency-transition/contract.ts';
export { COMPILER_DEPENDENCY_EXECUTION_RETENTION_POLICY } from './operation-context.ts';

export interface RuntimeDepsStamp {
  binding: Readonly<RuntimeDependencyMaterializationBinding>;
  formatVersion: 'runtime-deps-stamp-v4';
  manifestHash: string;
  packageManager: 'bun';
  installedAt: string;
  sourceGeneration: Readonly<RuntimeDependencySourceGeneration>;
  target: Readonly<RuntimeDependencyTargetIdentity>;
}

export interface RuntimeDependencyTargetIdentity {
  readonly schema: 'sec-runtime-dependency-target-identity-v1';
  readonly kind: 'directory' | 'link';
  readonly physical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly linkTarget: string | null;
}

export interface CompilerDepsReadyState {
  manifestHash: string;
  nodeModulesPath: string;
  packageManager: 'bun';
  readonly requiresFreshProcess: boolean;
  root: string;
  readonly runtimeMaterialization?: Readonly<RuntimeDependencyMaterializationBinding> | null;
  readonly sourceGeneration?: Readonly<RuntimeDependencySourceGeneration>;
  source: 'existing' | 'installed';
  readonly transitionDigest: `sha256:${string}`;
  readonly executionGenerationAuthority: CompilerDependencyExecutionGenerationAuthority;
}

/**
 * Opaque dependency-owner authority for materializing one read-only compiler
 * dependency generation. The visible digest is an identity projection only;
 * the private issuer record owns the physical root, content proof and lease.
 */
export interface CompilerDependencyExecutionGenerationAuthority {
  readonly generationDigest: `sha256:${string}`;
}

export interface CompilerDependencyExecutionRetirementReceipt {
  readonly schema: 'sec-compiler-dependency-execution-retirement-v1';
  readonly generationDigest: `sha256:${string}`;
  readonly generationPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly leaseId: `sha256:${string}`;
  readonly releaseRecordDigest: `sha256:${string}`;
  readonly terminal: 'released';
}

export interface RetainedCompilerDependencyReadGeneration {
  readonly assertAuthorityCurrent: () => Promise<void>;
  readonly generationDigest: `sha256:${string}`;
  readonly physicalGeneration: RetainedNoFollowProvenDirectoryGeneration;
  readonly retire: () => Promise<CompilerDependencyReadGenerationRetirementReceipt>;
}

const issuedCompilerDependencyReadGenerations = new WeakSet<object>();

export function assertRetainedCompilerDependencyReadGeneration(
  generation: RetainedCompilerDependencyReadGeneration
): void {
  if (!issuedCompilerDependencyReadGenerations.has(generation)) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency read generation is not owner-issued');
  }
  generation.physicalGeneration.assertCurrent();
}

/**
 * Process-local terminal for a read-generation lease.  This is deliberately
 * not a serialized schema: only the dependency owner can issue the object and
 * consumers must retain the exact object identity through settlement.
 */
export interface CompilerDependencyReadGenerationRetirementReceipt {
  readonly generationDigest: `sha256:${string}`;
  readonly physicalRoot: PhysicalGenerationRetirementReceipt['root'];
  readonly terminal: 'released';
}

export interface CompilerDependencyEnvironmentRetirementReceipt {
  readonly owner: 'compiler-dependency-runtime';
  readonly root: string;
  readonly rootIdentity:
    | Readonly<{
        readonly state: 'present';
        readonly physical: GeneratedStatePhysicalIdentity;
      }>
    | Readonly<{
        readonly state: 'absent';
        readonly absenceDigest: `sha256:${string}`;
      }>;
  readonly operationId: string;
  readonly outcome: string;
  readonly locatorPreimage:
    | Readonly<{ readonly state: 'absent' }>
    | Readonly<{
        readonly state: 'present';
        readonly physical: GeneratedStatePhysicalIdentity;
        readonly linkTarget: string;
      }>;
  readonly locatorRetirement: 'not-required' | 'retired';
  readonly nodeModulesReadback: 'absent';
  readonly generationCollection: 'complete' | 'root-absent';
  readonly terminal: 'retired';
  readonly receiptDigest: `sha256:${string}`;
}

export interface RetainedCompilerDependencyExecutionGeneration {
  readonly directRootResolution: DependencyFreshnessLockObservation;
  readonly generationDigest: `sha256:${string}`;
  readonly physicalGeneration: RetainedNoFollowProvenDirectoryGeneration;
  retire(): Promise<CompilerDependencyExecutionRetirementReceipt>;
}

const issuedCompilerDependencyExecutionRetirementReceipts = new WeakSet<object>();
const issuedCompilerDependencyReadGenerationRetirementReceipts = new WeakSet<object>();
const issuedCompilerDependencyEnvironmentRetirementReceipts = new WeakSet<object>();

function issueCompilerDependencyEnvironmentRetirementReceipt(
  unsigned: Omit<CompilerDependencyEnvironmentRetirementReceipt, 'receiptDigest'>
): CompilerDependencyEnvironmentRetirementReceipt {
  const receipt = Object.freeze({
    ...unsigned,
    receiptDigest: generatedStateDigest(canonicalJson(unsigned))
  });
  issuedCompilerDependencyEnvironmentRetirementReceipts.add(receipt);
  return receipt;
}

export function assertCompilerDependencyExecutionRetirementReceipt(
  receipt: CompilerDependencyExecutionRetirementReceipt
): void {
  if (!issuedCompilerDependencyExecutionRetirementReceipts.has(receipt)) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Compiler dependency execution retirement receipt was not issued by its owner'
    );
  }
}

export function assertCompilerDependencyReadGenerationRetirementReceipt(
  receipt: CompilerDependencyReadGenerationRetirementReceipt,
  expectedGenerationDigest: `sha256:${string}`
): void {
  if (!issuedCompilerDependencyReadGenerationRetirementReceipts.has(receipt)
      || receipt.generationDigest !== expectedGenerationDigest
      || receipt.terminal !== 'released') {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Compiler dependency read generation retirement was not issued for the expected generation'
    );
  }
}

export function assertCompilerDependencyEnvironmentRetirementReceipt(
  receipt: CompilerDependencyEnvironmentRetirementReceipt,
  expectedRoot: string
): void {
  if (!issuedCompilerDependencyEnvironmentRetirementReceipts.has(receipt)) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Compiler dependency environment retirement receipt was not issued by its owner'
    );
  }
  const root = path.resolve(expectedRoot);
  const { receiptDigest, ...unsigned } = receipt;
  const validRootIdentity = receipt.rootIdentity.state === 'present'
    ? isCanonicalGeneratedStatePhysicalIdentity(receipt.rootIdentity.physical)
    : isSha256Digest(receipt.rootIdentity.absenceDigest);
  const validLocatorPreimage = receipt.locatorPreimage.state === 'absent' ||
    (isCanonicalGeneratedStatePhysicalIdentity(receipt.locatorPreimage.physical) &&
      typeof receipt.locatorPreimage.linkTarget === 'string' &&
      receipt.locatorPreimage.linkTarget.length > 0);
  const validTerminalProjection = receipt.rootIdentity.state === 'absent'
    ? receipt.locatorPreimage.state === 'absent' &&
      receipt.locatorRetirement === 'not-required' &&
      receipt.generationCollection === 'root-absent'
    : receipt.generationCollection === 'complete' &&
      (receipt.locatorPreimage.state === 'absent'
        ? receipt.locatorRetirement === 'not-required'
        : receipt.locatorRetirement === 'retired');
  if (receipt.owner !== 'compiler-dependency-runtime' || receipt.root !== root ||
      !isCanonicalAbsolutePath(receipt.root) || receipt.operationId.length === 0 ||
      receipt.outcome.length === 0 || receipt.nodeModulesReadback !== 'absent' ||
      receipt.terminal !== 'retired' || !validRootIdentity || !validLocatorPreimage ||
      !validTerminalProjection || !isSha256Digest(receiptDigest) ||
      generatedStateDigest(canonicalJson(unsigned)) !== receiptDigest) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Compiler dependency environment retirement receipt is malformed or belongs to another root'
    );
  }
  issuedCompilerDependencyEnvironmentRetirementReceipts.delete(receipt);
}

type CompilerDependencyExecutionGenerationAuthorityRecord = Readonly<{
  binding: Readonly<CompilerDepsBinding>;
  directRootResolution: DependencyFreshnessLockObservation;
  identity: CompilerDependencyIdentity;
  kind: 'none' | 'generation-published' | 'locator-published';
  nodeModulesPath: string;
  root: string;
  sourceGeneration: Readonly<RuntimeDependencySourceGeneration>;
  source: 'existing' | 'installed';
}>;

const compilerDependencyExecutionGenerationAuthorities =
  new WeakMap<object, CompilerDependencyExecutionGenerationAuthorityRecord>();

function issueCompilerDependencyExecutionGenerationAuthority(
  record: CompilerDependencyExecutionGenerationAuthorityRecord
): CompilerDependencyExecutionGenerationAuthority {
  const authority = Object.freeze({ generationDigest: record.sourceGeneration.epoch });
  compilerDependencyExecutionGenerationAuthorities.set(authority, record);
  return authority;
}

export function assertCompilerDependencyExecutionGenerationAuthority(
  authority: CompilerDependencyExecutionGenerationAuthority
): void {
  if (!compilerDependencyExecutionGenerationAuthorities.has(authority)) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Compiler dependency execution generation authority was not issued by its owner'
    );
  }
}

export function projectCompilerDepsReadyState(
  authority: CompilerDependencyExecutionGenerationAuthority
): CompilerDepsReadyState {
  assertCompilerDependencyExecutionGenerationAuthority(authority);
  const record = compilerDependencyExecutionGenerationAuthorities.get(authority)!;
  const transitionDigest = generatedStateDigest(Object.freeze({
    schema: 'sec-compiler-dependency-transition-v1',
    kind: record.kind,
    root: record.root,
    nodeModulesPath: record.nodeModulesPath,
    manifestHash: record.identity.manifestHash,
    bindingDigest: generatedStateDigest(record.binding),
    sourceGeneration: record.sourceGeneration
  }));
  return Object.freeze({
    manifestHash: record.identity.manifestHash,
    nodeModulesPath: record.nodeModulesPath,
    packageManager: 'bun' as const,
    requiresFreshProcess: record.kind !== 'none',
    root: record.root,
    runtimeMaterialization: record.binding.runtimeMaterialization,
    sourceGeneration: record.sourceGeneration,
    source: record.source,
    transitionDigest,
    executionGenerationAuthority: authority
  });
}

export interface DependencyAuthorityPaths {
  readonly compilerModulesRoot: string;
  readonly dependencyModules: string;
  readonly sharedDepsRoot: string;
}
function requireGeneratedStateLifecycle(options: RuntimeDependencyInstallOptions) {
  const lifecycle = options.generatedStateLifecycle;
  if (lifecycle === undefined) throw new CodedFailure('IMPORT-AUTHORITY-004', 'Dependency operation has no bootstrap-bound generated-state lifecycle capability.');
  return lifecycle;
}
/** Read-only location fact from the original coordination locator owner. */
export function observeCompilerDependencyLifecycleStateRoot(root: string): string | null {
  return observeNoFollowOwnedFile(compilerDependencyCoordinationLocatorPath(root),
    'Compiler dependency generated-state locator') === null ? null : resolveCompilerDependencyCoordinationRoots(root).roots.stateRoot;
}
function selectGeneratedStateLifecycle(options: RuntimeDependencyOperationOptions, workspaceRoot: string): RuntimeDependencyOperationOptions {
  const factory = options.generatedStateLifecycleFactory;
  return factory === undefined ? options : runtimeDependencyOperationOptions({ ...options,
    generatedStateLifecycle: factory.forWorkspace(path.resolve(workspaceRoot)) });
}





export async function disposeCanonicalSharedDependencies(
  options: RuntimeDependencyInstallOptions = {},
  outcome = 'maintainer-clean-requested',
  dependencyRoot = compilerRoot
): Promise<boolean> {
  const operationOptions = runtimeDependencyOperationOptions(options);
  const root = path.resolve(dependencyRoot);
  const sharedDepsRoot = dependencyAuthorityPaths(root).sharedDepsRoot;
  runtimeDependencyOperationRemainingMs(operationOptions, 'Shared dependency retirement admission');
  const observedRoot = await physicalSharedDependencyDirectory(sharedDepsRoot, true);
  if (observedRoot === null) return false;
  const spec = loadRuntimeDependencySpec(path.join(root, 'package.json'));
  const lifecycleOptions = selectGeneratedStateLifecycle(operationOptions, root);
  const lifecycle = lifecycleOptions.generatedStateLifecycle;
  const observeRetirement = lifecycle?.observeRetirement;
  if (lifecycle === undefined || observeRetirement === undefined || lifecycle.bind === undefined) {
    throw new CodedFailure(
      'IMPORT-AUTHORITY-004',
      'Shared dependency retirement requires owner-issued provenance observation and binding; physical root is preserved'
    );
  }

  const preLeaseInventory = await sharedDependencyRetirementInventory(
    observedRoot,
    spec,
    lifecycleOptions,
    'Shared dependency retirement pre-lease inventory'
  );
  const expectation = legacySharedDependencyRetirementExpectation(
    generatedStatePhysicalIdentity(observedRoot)
  );
  // A legacy v1 registration may still reside in the predecessor registration
  // store. Bind is read-only with respect to the dependency root; it migrates
  // only the durable registration ledger, then proves the exact physical
  // identity before any dependency Effect is admitted.
  await bindExistingLegacySharedDependencyRoot(
    lifecycleOptions,
    generatedStatePhysicalIdentity(observedRoot)
  );
  const preLeaseObservation = await observeRetirement('.shared-deps', expectation);
  const { assertGeneratedStateRetirementObservation } = await import(
    '../../../runtime-state/generated-state/lifecycle-evidence.ts'
  );
  await assertGeneratedStateRetirementObservation(preLeaseObservation, { workspaceRoot: root, relativePath: preLeaseObservation.relativePath });
  if (preLeaseObservation.status !== 'active') {
    throw new CodedFailure(
      'IMPORT-AUTHORITY-004',
      'Legacy shared dependency root has no exact historical retirement registration; physical root is preserved',
      {
        inventoryDigest: preLeaseInventory.treeDigest,
        membership: preLeaseInventory.membership,
        observationDigest: preLeaseObservation.observationDigest,
        status: preLeaseObservation.status
      }
    );
  }
  return withCompilerDependencyTransitionLease(root, lifecycleOptions, async (leaseOptions) => {
    const current = await physicalSharedDependencyDirectory(sharedDepsRoot, true);
    if (current === null || !sameGeneratedStateIdentity(
      generatedStatePhysicalIdentity(current),
      generatedStatePhysicalIdentity(observedRoot)
    )) {
      throw new CodedFailure(
        'IMPORT-AUTHORITY-004',
        'Shared dependency root changed before lifecycle disposal; current state is preserved'
      );
    }
    const currentInventory = await sharedDependencyRetirementInventory(
      current,
      spec,
      leaseOptions,
      'Shared dependency retirement under-lease inventory'
    );
    if (currentInventory.treeDigest !== preLeaseInventory.treeDigest ||
        currentInventory.treeEntryCount !== preLeaseInventory.treeEntryCount ||
        currentInventory.membership !== preLeaseInventory.membership) {
      throw new CodedFailure(
        'IMPORT-AUTHORITY-004',
        'Shared dependency root changed before lifecycle disposal; current state is preserved'
      );
    }
    await bindExistingLegacySharedDependencyRoot(leaseOptions, generatedStatePhysicalIdentity(current));
    await runtimeDependencyOperationEffectFence(leaseOptions, 'Shared dependency retirement');
    const receipt = await lifecycle.disposed('.shared-deps', {
      outcome,
      profile: 'all-rebuildable'
    });
    const { assertGeneratedStateDisposalReceipt } = await import(
      '../../../runtime-state/generated-state/lifecycle-evidence.ts'
    );
    await assertGeneratedStateDisposalReceipt(receipt, { workspaceRoot: root, relativePath: receipt.relativePath });
    if (receipt.profile !== 'all-rebuildable' || receipt.terminal !== 'disposed' ||
        !sameGeneratedStateIdentity(receipt.physical, generatedStatePhysicalIdentity(current)) ||
        physicalSharedDependencyDirectory(sharedDepsRoot, true) !== null) {
      throw new CodedFailure(
        'IMPORT-AUTHORITY-004',
        'Shared dependency retirement terminal receipt differs from the admitted root'
      );
    }
    runtimeDependencyOperationRemainingMs(leaseOptions, 'Shared dependency retirement receipt readback');
    return true;
  });
}

/**
 * Retire the compiler dependency projection and every consumer-zero immutable
 * generation owned by one dependency root.  Filesystem callers cannot safely
 * remove a published root directly because the physical owner deliberately
 * seals generations against mutation; cleanup is therefore a domain
 * operation, not a recursive-delete transport.
 */
export async function disposeCompilerDependencyEnvironment(
  dependencyRoot: string,
  options: RuntimeDependencyInstallOptions = {},
  outcome = 'maintainer-clean-requested'
): Promise<CompilerDependencyEnvironmentRetirementReceipt> {
  const root = path.resolve(dependencyRoot);
  if (outcome.length === 0) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency environment retirement outcome is absent');
  }
  const boundedOptions = runtimeDependencyOperationOptions(options);
  return measureRuntimeDependencyOperationPhaseAsync(boundedOptions, 'cleanup', async () => {
    const admittedRoot = inspectExactNoFollowDirectoryPresence(
      root,
      'Compiler dependency environment retirement root'
    );
    if (admittedRoot.state === 'absent') {
      const rootIdentity = Object.freeze({
        state: 'absent' as const,
        absenceDigest: generatedStateDigest(canonicalJson({ root, state: 'absent' }))
      });
      const unsigned = Object.freeze({
        owner: 'compiler-dependency-runtime' as const,
        root,
        rootIdentity,
        operationId: runtimeDependencyOperationContext(boundedOptions).operationId,
        outcome,
        locatorPreimage: Object.freeze({ state: 'absent' as const }),
        locatorRetirement: 'not-required' as const,
        nodeModulesReadback: 'absent' as const,
        generationCollection: 'root-absent' as const,
        terminal: 'retired' as const
      });
      return issueCompilerDependencyEnvironmentRetirementReceipt(unsigned);
    }
    const admittedRootPhysical = generatedStatePhysicalIdentity(admittedRoot.directory.target);
    const operationOptions = selectGeneratedStateLifecycle(boundedOptions, root);
    return withCompilerDependencyTransitionLease(root, operationOptions, async (leaseOptions) => {
      runtimeDependencyOperationRemainingMs(
        leaseOptions,
        'Compiler dependency environment retirement admission'
      );
      const underLeaseRoot = inspectNoFollowDirectoryChain(
        root,
        'Compiler dependency environment retirement root under lease'
      ).target;
      if (!sameGeneratedStateIdentity(
        generatedStatePhysicalIdentity(underLeaseRoot),
        admittedRootPhysical
      )) {
        throw new CodedFailure(
          'RUNTIME-DEPS-004',
          'Compiler dependency environment root changed before retirement'
        );
      }
      const locator = compilerDependencyLocatorObservation(root, 'node_modules');
      const locatorPreimage = locator === null
        ? Object.freeze({ state: 'absent' as const })
        : Object.freeze({
            state: 'present' as const,
            physical: locator.source,
            linkTarget: locator.linkTarget
          });
      if (locator === null && inspectExactNoFollowDirectoryPresence(
        path.join(root, 'node_modules'),
        'Compiler dependency environment retirement locator preimage'
      ).state !== 'absent') {
        throw new CodedFailure(
          'IMPORT-AUTHORITY-004',
          'Compiler dependency environment retirement encountered an unmanaged node_modules directory'
        );
      }
      if (locator !== null) {
        await disposeCompilerDependencyLocator(root, leaseOptions, outcome);
      }
      await collectReleasedCompilerDependencyGenerations(root, leaseOptions);
      if (inspectExactNoFollowDirectoryPresence(
        path.join(root, 'node_modules'),
        'Compiler dependency environment retirement locator terminal readback'
      ).state !== 'absent') {
        throw new CodedFailure(
          'IMPORT-AUTHORITY-004',
          'Compiler dependency environment retirement left its canonical locator'
        );
      }
      const finalRoot = inspectNoFollowDirectoryChain(
        root,
        'Compiler dependency environment retirement root terminal readback'
      ).target;
      if (!sameGeneratedStateIdentity(
        generatedStatePhysicalIdentity(finalRoot),
        admittedRootPhysical
      )) {
        throw new CodedFailure(
          'RUNTIME-DEPS-004',
          'Compiler dependency environment root changed before terminal readback'
        );
      }
      const unsigned = Object.freeze({
        owner: 'compiler-dependency-runtime' as const,
        root,
        rootIdentity: Object.freeze({
          state: 'present' as const,
          physical: admittedRootPhysical
        }),
        operationId: runtimeDependencyOperationContext(leaseOptions).operationId,
        outcome,
        locatorPreimage,
        locatorRetirement: locator === null ? 'not-required' as const : 'retired' as const,
        nodeModulesReadback: 'absent' as const,
        generationCollection: 'complete' as const,
        terminal: 'retired' as const
      });
      return issueCompilerDependencyEnvironmentRetirementReceipt(unsigned);
    });
  });
}

export function dependencyAuthorityPaths(
  dependencyRoot = compilerRoot
): Readonly<DependencyAuthorityPaths> {
  const root = path.resolve(dependencyRoot);
  const sharedDepsRoot = path.join(root, '.shared-deps');
  return Object.freeze({
    compilerModulesRoot: path.join(root, 'node_modules'),
    dependencyModules: path.join(sharedDepsRoot, 'node_modules'),
    sharedDepsRoot
  });
}

type PhysicalControlFileIdentity = Readonly<{
  dev: string;
  ino: string;
  mode: string;
  nlink: string;
}>;

function physicalControlFileIdentity(metadata: Readonly<{
  dev: bigint | number;
  ino: bigint | number;
  mode: bigint | number;
  nlink: bigint | number;
}>): PhysicalControlFileIdentity {
  return Object.freeze({
    dev: String(metadata.dev),
    ino: String(metadata.ino),
    mode: String(metadata.mode),
    nlink: String(metadata.nlink)
  });
}

function samePhysicalControlFileIdentity(
  left: PhysicalControlFileIdentity,
  right: PhysicalControlFileIdentity
): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode &&
    left.nlink === right.nlink;
}

async function observePhysicalControlFile(filePath: string): Promise<PhysicalControlFileIdentity> {
  const metadata = await fs.lstat(filePath, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink() ||
    metadata.nlink !== 1n ||
    !sameHostPath(await fs.realpath(filePath), filePath)) {
    throw new CodedFailure('RUNTIME-DEPS-002', `Runtime dependency control file is not physical: ${filePath}`);
  }
  return physicalControlFileIdentity(metadata);
}

async function readPhysicalControlText(filePath: string): Promise<string> {
  const before = await observePhysicalControlFile(filePath);
  const handle = await fs.open(filePath, 'r');
  try {
    const opened = physicalControlFileIdentity(await handle.stat({ bigint: true }));
    if (!samePhysicalControlFileIdentity(before, opened)) {
      throw new CodedFailure('RUNTIME-DEPS-002', `Runtime dependency control file changed: ${filePath}`);
    }
    const text = await handle.readFile('utf8');
    const after = physicalControlFileIdentity(await handle.stat({ bigint: true }));
    const current = await observePhysicalControlFile(filePath);
    if (!samePhysicalControlFileIdentity(opened, after) ||
      !samePhysicalControlFileIdentity(after, current)) {
      throw new CodedFailure('RUNTIME-DEPS-002', `Runtime dependency control file changed: ${filePath}`);
    }
    return text;
  } finally {
    await handle.close();
  }
}

async function runtimeDependencyTargetIdentity(
  targetPath: string
): Promise<RuntimeDependencyTargetIdentity | null> {
  const absoluteTarget = path.resolve(targetPath);
  const parent = inspectNoFollowDirectoryChain(
    path.dirname(absoluteTarget),
    'Runtime dependency target parent'
  ).target;
  const name = path.basename(absoluteTarget);
  let link: ReturnType<typeof inspectNoFollowLinkEntry>;
  try {
    link = inspectNoFollowLinkEntry(parent, name);
  } catch (error) {
    // The link primitive intentionally rejects a non-link leaf. A following
    // exact directory observation below distinguishes that ordinary case from
    // a foreign file/reparse entry, which remains a typed blocker.
    if (error instanceof PhysicalNoFollowError &&
      (error.code === 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED' ||
        error.code === 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH')) {
      link = null;
    } else {
      throw error;
    }
  }
  if (link !== null) {
    if (link.kind !== 'link' || link.linkTarget === null) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Runtime dependency target is not a valid physical link');
    }
    return Object.freeze({
      schema: 'sec-runtime-dependency-target-identity-v1' as const,
      kind: 'link' as const,
      physical: Object.freeze({
        device: link.device,
        inode: link.inode,
        objectId: generatedStateDigest({ kind: 'link', target: link.linkTarget })
      }),
      linkTarget: link.linkTarget
    });
  }
  const directory = inspectExactNoFollowDirectoryPresence(
    absoluteTarget,
    'Runtime dependency target directory'
  );
  if (directory.state === 'absent') return null;
  return Object.freeze({
    schema: 'sec-runtime-dependency-target-identity-v1' as const,
    kind: 'directory' as const,
    physical: generatedStatePhysicalIdentity(directory.directory.target),
    linkTarget: null
  });
}

function isRuntimeDependencyTargetIdentity(
  value: unknown
): value is RuntimeDependencyTargetIdentity {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const target = value as Partial<RuntimeDependencyTargetIdentity>;
  return target.schema === 'sec-runtime-dependency-target-identity-v1' &&
    (target.kind === 'directory' || target.kind === 'link') &&
    isGeneratedStatePhysicalIdentity(target.physical) &&
    (target.linkTarget === null || typeof target.linkTarget === 'string');
}

// A staging failure can precede any durable intent. Compiler and project
// writers therefore keep their operation-owned physical preimages through this
// private disposal boundary. A parsed intent or selector alone is not disposal
// authority; separating them from their callers would lose that ownership.
type DependencyTransitionStageAuthority = Readonly<{
  /** Canonical parent under which the operation may create its stage root. */
  parent: string;
  /** Registered operation selector for the direct stage-root child. */
  prefix: string;
  /** Closed-world direct children emitted by this staging operation. */
  allowedDirectChildren: readonly string[];
  /** Compiler staging roots have a required-at-birth generated-state receipt. */
  lifecycle?: Readonly<{
    owner: string;
    producer: string;
    ruleId: string;
  }>;
}>;

const COMPILER_DEPENDENCY_STAGE_INTENT_SCHEMA =
  'sec-compiler-dependency-stage-intent-v1' as const;
const COMPILER_DEPENDENCY_STAGE_INTENT_DIRECTORY =
  '.compiler-stage-intents-v1' as const;
const COMPILER_DEPENDENCY_STAGE_INTENT_CAPACITY = 10_000;
const COMPILER_DEPENDENCY_STAGE_RETIREMENT_SCHEMA =
  'sec-compiler-dependency-stage-retirement-intent-v1' as const;

type CompilerDependencyStageIntentPhase = 'prepared' | 'disposing' | 'settled';

type CompilerDependencyStageIntent = Readonly<{
  schema: typeof COMPILER_DEPENDENCY_STAGE_INTENT_SCHEMA;
  intentDigest: `sha256:${string}`;
  previousIntentDigest: `sha256:${string}` | null;
  phase: CompilerDependencyStageIntentPhase;
  operationKey: `sha256:${string}`;
  operationId: string;
  operationInitialBudgetMs: number;
  ownerRoot: string;
  ownerRootPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  stageRootPath: string;
  stageRootPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  relativeStagePath: string;
  allowedDirectChildren: readonly string[];
  lifecycle: Readonly<{ owner: string; producer: string; ruleId: string }>;
  outcome: string | null;
}>;

type CompilerDependencyStageIntentUnsigned = Omit<CompilerDependencyStageIntent, 'intentDigest'>;

type CompilerDependencyStageRetirementIntent = Readonly<{
  schema: typeof COMPILER_DEPENDENCY_STAGE_RETIREMENT_SCHEMA;
  ownerRoot: string;
  ownerRootPhysical: GeneratedStatePhysicalIdentity;
  intentRootPhysical: GeneratedStatePhysicalIdentity;
  operationKey: `sha256:${string}`;
  entries: readonly Readonly<{
    name: string;
    device: string;
    inode: string;
    bytesBase64: string;
  }>[];
  intentDigest: `sha256:${string}`;
}>;

const COMPILER_DEPENDENCY_STAGE_INTENT_KEYS = Object.freeze([
  'allowedDirectChildren', 'intentDigest', 'lifecycle', 'operationId',
  'operationInitialBudgetMs', 'operationKey', 'outcome', 'ownerRoot',
  'ownerRootPhysical', 'phase', 'previousIntentDigest', 'relativeStagePath',
  'schema', 'stageRootPath', 'stageRootPhysical'
] as const);

function compilerDependencyStageIntent(
  input: CompilerDependencyStageIntentUnsigned
): CompilerDependencyStageIntent {
  const unsigned = Object.freeze({ ...input });
  return Object.freeze({
    ...unsigned,
    intentDigest: generatedStateDigest(canonicalJson(unsigned))
  });
}

function preparedCompilerDependencyStageIntent(input: Readonly<{
  operationId: string;
  operationInitialBudgetMs: number;
  ownerRoot: PhysicalDirectoryIdentity;
  stageRoot: DependencyTransitionSlot;
}>): CompilerDependencyStageIntent {
  const authority = compilerDependencyStageAuthority(input.ownerRoot.path);
  if (input.stageRoot.kind !== 'directory' || input.stageRoot.physical === null || authority.lifecycle === undefined) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency staging root has no durable intent identity');
  }
  return compilerDependencyStageIntent({
    schema: COMPILER_DEPENDENCY_STAGE_INTENT_SCHEMA,
    previousIntentDigest: null,
    phase: 'prepared',
    operationKey: generatedStateDigest(Object.freeze({
      schema: 'sec-compiler-dependency-stage-operation-v1',
      operationId: input.operationId,
      ownerRoot: input.ownerRoot.path,
      ownerRootPhysical: generatedStatePhysicalIdentity(input.ownerRoot),
      stageRootPath: input.stageRoot.path,
      stageRootPhysical: input.stageRoot.physical
    })),
    operationId: input.operationId,
    operationInitialBudgetMs: input.operationInitialBudgetMs,
    ownerRoot: input.ownerRoot.path,
    ownerRootPhysical: generatedStatePhysicalIdentity(input.ownerRoot),
    stageRootPath: input.stageRoot.path,
    stageRootPhysical: input.stageRoot.physical,
    relativeStagePath: path.relative(input.ownerRoot.path, input.stageRoot.path).replaceAll('\\', '/'),
    allowedDirectChildren: authority.allowedDirectChildren,
    lifecycle: authority.lifecycle,
    outcome: null
  });
}

function compilerDependencyStageIntentBytes(intent: CompilerDependencyStageIntent): Buffer {
  return Buffer.from(formatJsonFile(canonicalJson(intent)), 'utf8');
}

function compilerDependencyStageIntentName(intent: CompilerDependencyStageIntent): string {
  return `stage-${intent.operationKey.slice('sha256:'.length)}-${intent.phase}.json`;
}

function parseCompilerDependencyStageIntent(
  bytes: Uint8Array,
  expectedName?: string
): CompilerDependencyStageIntent {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch {
    throw new CodedFailure('RUNTIME-DEPS-002', 'Compiler dependency stage intent is not canonical JSON');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      !canonicalEquals(sortedKeys(value as Record<string, unknown>), COMPILER_DEPENDENCY_STAGE_INTENT_KEYS)) {
    throw new CodedFailure('RUNTIME-DEPS-002', 'Compiler dependency stage intent has noncanonical keys');
  }
  const intent = value as CompilerDependencyStageIntent;
  const authority = compilerDependencyStageAuthority(intent.ownerRoot);
  const expectedRelativePath = path.relative(intent.ownerRoot, intent.stageRootPath).replaceAll('\\', '/');
  const expectedOperationKey = generatedStateDigest(Object.freeze({
    schema: 'sec-compiler-dependency-stage-operation-v1',
    operationId: intent.operationId,
    ownerRoot: path.resolve(intent.ownerRoot),
    ownerRootPhysical: intent.ownerRootPhysical,
    stageRootPath: path.resolve(intent.stageRootPath),
    stageRootPhysical: intent.stageRootPhysical
  }));
  if (intent.schema !== COMPILER_DEPENDENCY_STAGE_INTENT_SCHEMA ||
      !isSha256Digest(intent.intentDigest) ||
      (intent.previousIntentDigest !== null && !isSha256Digest(intent.previousIntentDigest)) ||
      !['prepared', 'disposing', 'settled'].includes(intent.phase) ||
      !isSha256Digest(intent.operationKey) ||
      intent.operationKey !== expectedOperationKey ||
      typeof intent.operationId !== 'string' || intent.operationId.length === 0 ||
      !Number.isSafeInteger(intent.operationInitialBudgetMs) || intent.operationInitialBudgetMs < 1 ||
      typeof intent.ownerRoot !== 'string' || !path.isAbsolute(intent.ownerRoot) ||
      !isGeneratedStatePhysicalIdentity(intent.ownerRootPhysical) ||
      typeof intent.stageRootPath !== 'string' || !path.isAbsolute(intent.stageRootPath) ||
      !isGeneratedStatePhysicalIdentity(intent.stageRootPhysical) ||
      typeof intent.relativeStagePath !== 'string' || intent.relativeStagePath !== expectedRelativePath ||
      path.dirname(path.resolve(intent.stageRootPath)) !== path.resolve(authority.parent) ||
      !path.basename(intent.stageRootPath).startsWith(authority.prefix) ||
      !Array.isArray(intent.allowedDirectChildren) ||
      !canonicalEquals(intent.allowedDirectChildren, authority.allowedDirectChildren) ||
      intent.lifecycle === null || typeof intent.lifecycle !== 'object' ||
      !canonicalEquals(sortedKeys(intent.lifecycle as unknown as Record<string, unknown>), ['owner', 'producer', 'ruleId']) ||
      intent.lifecycle.owner !== authority.lifecycle?.owner ||
      intent.lifecycle.producer !== authority.lifecycle?.producer ||
      intent.lifecycle.ruleId !== authority.lifecycle?.ruleId ||
      (intent.phase === 'settled' ? typeof intent.outcome !== 'string' || intent.outcome.length === 0 : intent.outcome !== null)) {
    throw new CodedFailure('RUNTIME-DEPS-002', 'Compiler dependency stage intent is invalid or foreign');
  }
  const { intentDigest: _intentDigest, ...unsigned } = intent;
  if (compilerDependencyStageIntent(unsigned).intentDigest !== intent.intentDigest ||
      formatJsonFile(canonicalJson(intent)) !== Buffer.from(bytes).toString('utf8') ||
      (expectedName !== undefined && compilerDependencyStageIntentName(intent) !== expectedName)) {
    throw new CodedFailure('RUNTIME-DEPS-002', 'Compiler dependency stage intent digest or bytes changed');
  }
  return Object.freeze(intent);
}

function assertCompilerDependencyStageIntentBytes(bytes: Uint8Array): void {
  parseCompilerDependencyStageIntent(bytes);
}

function compilerDependencyStageRetirementName(operationKey: `sha256:${string}`): string {
  return `retiring-${operationKey.slice('sha256:'.length)}.json`;
}

function parseCompilerDependencyStageRetirementIntent(
  bytes: Uint8Array,
  name: string
): CompilerDependencyStageRetirementIntent {
  let value: unknown;
  try { value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown; }
  catch { throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler stage retirement marker is not JSON'); }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler stage retirement marker is foreign');
  }
  const intent = value as CompilerDependencyStageRetirementIntent;
  const { intentDigest, ...material } = intent;
  if (intent.schema !== COMPILER_DEPENDENCY_STAGE_RETIREMENT_SCHEMA ||
      !isSha256Digest(intent.operationKey) ||
      compilerDependencyStageRetirementName(intent.operationKey) !== name ||
      !path.isAbsolute(intent.ownerRoot) || path.resolve(intent.ownerRoot) !== intent.ownerRoot ||
      !isGeneratedStatePhysicalIdentity(intent.ownerRootPhysical) ||
      !isGeneratedStatePhysicalIdentity(intent.intentRootPhysical) ||
      !Array.isArray(intent.entries) || intent.entries.length !== 3 ||
      !isSha256Digest(intentDigest) || generatedStateDigest(canonicalJson(material)) !== intentDigest ||
      formatJsonFile(canonicalJson(intent)) !== Buffer.from(bytes).toString('utf8')) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler stage retirement marker identity or bytes differ');
  }
  const phases = ['prepared', 'disposing', 'settled'] as const;
  const parsed = intent.entries.map((entry, index) => {
    const expectedName = `stage-${intent.operationKey.slice('sha256:'.length)}-${phases[index]}.json`;
    if (entry === null || typeof entry !== 'object' ||
        entry.name !== expectedName ||
        typeof entry.device !== 'string' || entry.device.length === 0 ||
        typeof entry.inode !== 'string' || entry.inode.length === 0 ||
        typeof entry.bytesBase64 !== 'string' ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(entry.bytesBase64)) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler stage retirement marker entry is invalid');
    }
    const phase = parseCompilerDependencyStageIntent(Buffer.from(entry.bytesBase64, 'base64'), entry.name);
    if (phase.operationKey !== intent.operationKey) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler stage retirement marker operation changed');
    }
    return phase;
  });
  if (parsed[1]!.previousIntentDigest !== parsed[0]!.intentDigest ||
      parsed[2]!.previousIntentDigest !== parsed[1]!.intentDigest ||
      parsed[2]!.phase !== 'settled') {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler stage retirement marker chain is not terminal');
  }
  return Object.freeze(intent);
}

function assertCompilerDependencyStageRetirementIntentBytes(bytes: Uint8Array): void {
  const value = JSON.parse(Buffer.from(bytes).toString('utf8')) as { operationKey: `sha256:${string}` };
  parseCompilerDependencyStageRetirementIntent(bytes, compilerDependencyStageRetirementName(value.operationKey));
}

async function compilerDependencyStageIntentRoot(
  root: string,
  options: RuntimeDependencyOperationOptions,
  create: boolean
): Promise<PhysicalDirectoryIdentity | null> {
  const parentPath = path.join(path.resolve(root), '.tmp', 'dependency-installs');
  let parent: PhysicalDirectoryIdentity;
  try {
    parent = inspectNoFollowDirectoryChain(parentPath, 'Compiler dependency stage intent parent').target;
  } catch (error) {
    if (!create && error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') return null;
    throw error;
  }
  if (!create) {
    try {
      return inspectNoFollowDirectoryChain(
        path.join(parent.path, COMPILER_DEPENDENCY_STAGE_INTENT_DIRECTORY),
        'Compiler dependency stage intent root'
      ).target;
    } catch (error) {
      if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') return null;
      throw error;
    }
  }
  await runtimeDependencyOperationEffectFence(options, 'Compiler dependency stage intent namespace creation');
  return createNoFollowOrdinaryDirectoryChain(parent, [COMPILER_DEPENDENCY_STAGE_INTENT_DIRECTORY]);
}

async function retireEmptyCompilerDependencyStageIntentRoot(
  root: string,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const intentRoot = await compilerDependencyStageIntentRoot(root, options, false);
  if (intentRoot === null) return;
  const names = await readNoFollowDirectNames(
    intentRoot, 'Compiler stage retirement namespace readback',
    COMPILER_DEPENDENCY_STAGE_INTENT_CAPACITY, options
  );
  if (names.length !== 0) return;
  const parent = inspectNoFollowDirectoryChain(path.dirname(intentRoot.path), 'Compiler stage retirement parent').target;
  await runtimeDependencyOperationEffectFence(options, 'Compiler stage retirement namespace deletion');
  deleteRetainedNoFollowEntry({
    root: parent,
    relativePath: path.basename(intentRoot.path),
    kind: 'directory',
    device: intentRoot.device,
    inode: intentRoot.inode,
    ancestorDirectories: []
  });
  if (await compilerDependencyStageIntentRoot(root, options, false) !== null) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler stage retirement namespace remains');
  }
}

/** Resume only a durable marker issued from a fully validated terminal chain. */
async function recoverCompilerDependencyStageIntentRetirements(
  ownerRoot: string,
  options: RuntimeDependencyOperationOptions
): Promise<readonly `sha256:${string}`[]> {
  const intentRoot = await compilerDependencyStageIntentRoot(ownerRoot, options, false);
  if (intentRoot === null) return Object.freeze([]);
  const names = await readNoFollowDirectNames(
    intentRoot, 'Compiler stage retirement recovery census',
    COMPILER_DEPENDENCY_STAGE_INTENT_CAPACITY, options
  );
  const markerNames = names.filter((name) => /^retiring-[0-9a-f]{64}\.json$/u.test(name));
  const recovered: `sha256:${string}`[] = [];
  for (const name of markerNames) {
    const markerEntry = inspectNoFollowOrdinaryFileEntry(intentRoot, name);
    if (markerEntry === null || markerEntry.bytes === null) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler stage retirement marker disappeared');
    }
    const marker = parseCompilerDependencyStageRetirementIntent(markerEntry.bytes, name);
    const owner = inspectNoFollowDirectoryChain(ownerRoot, 'Compiler stage retirement owner recovery').target;
    if (marker.ownerRoot !== path.resolve(ownerRoot) ||
        !sameGeneratedStateIdentity(marker.ownerRootPhysical, generatedStatePhysicalIdentity(owner)) ||
        !sameGeneratedStateIdentity(marker.intentRootPhysical, generatedStatePhysicalIdentity(intentRoot))) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler stage retirement marker physical binding changed');
    }
    const settled = parseCompilerDependencyStageIntent(
      Buffer.from(marker.entries[2]!.bytesBase64, 'base64'), marker.entries[2]!.name
    );
    if ((await observeDependencyTransitionSlot(settled.stageRootPath)).kind !== 'absent') {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler stage retirement recovery found present stage');
    }
    const inventory = await requireGeneratedStateLifecycle(options).inspect([settled.relativeStagePath]);
    const registrationState = inventory.entries[0]?.registrationState;
    if (registrationState !== 'retired' && registrationState !== 'missing') {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler stage retirement recovery registration is not terminal');
    }
    const remaining = marker.entries.map((expected) => {
      const current = inspectNoFollowOrdinaryFileEntry(intentRoot, expected.name);
      if (current === null) return null;
      const expectedBytes = Buffer.from(expected.bytesBase64, 'base64');
      if (current.bytes === null || current.device !== expected.device ||
          current.inode !== expected.inode || !Buffer.from(current.bytes).equals(expectedBytes)) {
        throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler stage retirement remaining file changed');
      }
      return { name: expected.name, entry: current };
    });
    for (const current of remaining) {
      if (current === null) continue;
      await runtimeDependencyOperationEffectFence(options, 'Compiler dependency terminal stage intent retirement');
      deleteRetainedNoFollowEntry({
        root: intentRoot,
        relativePath: current.name,
        kind: 'file',
        device: current.entry.device,
        inode: current.entry.inode,
        expectedFileBytes: current.entry.bytes!,
        ancestorDirectories: []
      });
      if (inspectNoFollowOrdinaryFileEntry(intentRoot, current.name) !== null) {
        throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler stage retirement file remains after deletion');
      }
    }
    await runtimeDependencyOperationEffectFence(options, 'Compiler stage retirement marker deletion');
    deleteRetainedNoFollowEntry({
      root: intentRoot,
      relativePath: name,
      kind: 'file',
      device: markerEntry.device,
      inode: markerEntry.inode,
      expectedFileBytes: markerEntry.bytes,
      ancestorDirectories: []
    });
    if (inspectNoFollowOrdinaryFileEntry(intentRoot, name) !== null) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler stage retirement marker remains');
    }
    recovered.push(marker.operationKey);
  }
  await retireEmptyCompilerDependencyStageIntentRoot(ownerRoot, options);
  return Object.freeze(recovered);
}

async function writeCompilerDependencyStageIntent(
  root: string,
  intent: CompilerDependencyStageIntent,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const intentRoot = await compilerDependencyStageIntentRoot(root, options, true);
  const name = compilerDependencyStageIntentName(intent);
  const bytes = compilerDependencyStageIntentBytes(intent);
  await runtimeDependencyOperationEffectFence(options, `Compiler dependency stage intent ${intent.phase} publication`);
  writeDurableTransitionFile(intentRoot!, name, bytes, assertCompilerDependencyStageIntentBytes, true);
  const readback = inspectNoFollowOrdinaryFileEntry(intentRoot!, name);
  if (readback === null || readback.bytes === null) {
    throw new CodedFailure('RUNTIME-DEPS-002', 'Compiler dependency stage intent disappeared after publication');
  }
  parseCompilerDependencyStageIntent(readback.bytes, name);
}

async function advanceCompilerDependencyStageIntent(
  root: string,
  previous: CompilerDependencyStageIntent,
  phase: Exclude<CompilerDependencyStageIntentPhase, 'prepared'>,
  outcome: string | null,
  options: RuntimeDependencyOperationOptions
): Promise<CompilerDependencyStageIntent> {
  const { intentDigest: _intentDigest, ...priorUnsigned } = previous;
  const next = compilerDependencyStageIntent({
    ...priorUnsigned,
    previousIntentDigest: previous.intentDigest,
    phase,
    outcome
  });
  await writeCompilerDependencyStageIntent(root, next, options);
  return next;
}

async function readCompilerDependencyStageIntents(
  root: string,
  options: RuntimeDependencyOperationOptions
): Promise<Readonly<{
  active: readonly CompilerDependencyStageIntent[];
  representedStagePaths: ReadonlySet<string>;
  settled: readonly CompilerDependencyStageIntent[];
}>> {
  const intentRoot = await compilerDependencyStageIntentRoot(root, options, false);
  if (intentRoot === null) {
    return Object.freeze({
      active: Object.freeze([]),
      representedStagePaths: new Set<string>(),
      settled: Object.freeze([])
    });
  }
  const names = await readNoFollowDirectNames(
    intentRoot,
    'Compiler dependency stage intent census',
    COMPILER_DEPENDENCY_STAGE_INTENT_CAPACITY,
    options
  );
  const byOperation = new Map<string, Map<CompilerDependencyStageIntentPhase, CompilerDependencyStageIntent>>();
  const representedStagePaths = new Set<string>();
  for (const name of names) {
    if (/^retiring-[0-9a-f]{64}\.json$/u.test(name)) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler stage retirement is pending owner recovery', {
        recoveryRoute: 'retireSettledCompilerDependencyStageIntents',
        marker: name
      });
    }
    if (!/^stage-[0-9a-f]{64}-(?:prepared|disposing|settled)\.json$/u.test(name)) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency stage intent namespace contains unknown residue', { name });
    }
    const entry = inspectNoFollowOrdinaryFileEntry(intentRoot, name);
    if (entry === null || entry.bytes === null) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency stage intent disappeared during census', { name });
    }
    const intent = parseCompilerDependencyStageIntent(entry.bytes, name);
    representedStagePaths.add(path.resolve(intent.stageRootPath));
    const phases = byOperation.get(intent.operationKey) ?? new Map();
    if (phases.has(intent.phase)) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency stage intent has duplicate operation phase', {
        operationKey: intent.operationKey,
        phase: intent.phase
      });
    }
    phases.set(intent.phase, intent);
    byOperation.set(intent.operationKey, phases);
  }
  const active: CompilerDependencyStageIntent[] = [];
  const terminal: CompilerDependencyStageIntent[] = [];
  for (const [operationKey, phases] of byOperation) {
    const prepared = phases.get('prepared');
    const disposing = phases.get('disposing');
    const settled = phases.get('settled');
    if (prepared === undefined ||
        (disposing !== undefined && disposing.previousIntentDigest !== prepared.intentDigest) ||
        (settled !== undefined && settled.previousIntentDigest !== disposing?.intentDigest) ||
        (settled !== undefined && disposing === undefined)) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency stage intent chain is partial or foreign', { operationKey });
    }
    if (settled === undefined) active.push(disposing ?? prepared);
    else terminal.push(settled);
  }
  active.sort((left, right) => compareCodeUnits(left.operationKey, right.operationKey));
  terminal.sort((left, right) => compareCodeUnits(left.operationKey, right.operationKey));
  return Object.freeze({
    active: Object.freeze(active),
    representedStagePaths,
    settled: Object.freeze(terminal)
  });
}

async function settleCompilerDependencyStageIntent(
  root: string,
  current: CompilerDependencyStageIntent,
  outcome: string,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  let disposing = current;
  if (disposing.phase === 'prepared') {
    disposing = await advanceCompilerDependencyStageIntent(root, disposing, 'disposing', null, options);
  }
  if (disposing.phase !== 'disposing') {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency stage intent is not disposal-authorized');
  }
  const stageRoot = await observeDependencyTransitionSlot(disposing.stageRootPath);
  if (stageRoot.kind === 'absent') {
    const lifecycle = options.generatedStateLifecycle;
    const settleAbsent = lifecycle?.settleAbsent;
    if (lifecycle === undefined || settleAbsent === undefined) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency stage disappeared without lifecycle settlement authority');
    }
    await runtimeDependencyOperationEffectFence(options, 'Compiler dependency absent stage lifecycle settlement');
    const expected = Object.freeze({
      owner: disposing.lifecycle.owner,
      producer: disposing.lifecycle.producer,
      ruleId: disposing.lifecycle.ruleId,
      physical: disposing.stageRootPhysical
    });
    const quarantine = lifecycle.quarantine;
    if (quarantine !== undefined) {
      const inventory = await requireGeneratedStateLifecycle(options).inspect([disposing.relativeStagePath]);
      const entry = inventory.entries[0];
      if (entry?.registrationState === 'retired' || entry?.registrationState === 'missing') {
        const receipt = await quarantine(disposing.relativeStagePath, { outcome, profile: 'automatic' });
        const { assertGeneratedStateCleanupContinuationReceipt } = await import(
          '../../../runtime-state/generated-state/lifecycle-evidence.ts'
        );
        await assertGeneratedStateCleanupContinuationReceipt(receipt, { workspaceRoot: root });
        if ((receipt.terminal !== 'completed' && receipt.terminal !== 'continuation-required') ||
            receipt.blockers.length !== 0) {
          throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency absent stage quarantine receipt differs');
        }
        await advanceCompilerDependencyStageIntent(root, disposing, 'settled', outcome, options);
        if (receipt.terminal === 'continuation-required') {
          throw new CodedFailure(
            'RUNTIME-DEPS-004',
            'Compiler dependency absent stage quarantine requires one fresh bounded continuation',
            { cleanupContinuation: receipt, continuationRequired: true }
          );
        }
        return;
      }
    }
    // A prior process may have durably retired the registration before it
    // failed to remove the pointer.  Close that already-authorized state
    // first; otherwise terminalize the exact active registration and prove
    // the resulting receipt.  Neither route grants generic cleanup authority.
    const settledRetired = await lifecycle.settleRetired?.(
      disposing.relativeStagePath,
      expected
    ) ?? false;
    if (!settledRetired) {
      const receipt = await settleAbsent(disposing.relativeStagePath, expected, outcome);
      if (receipt.schema !== 'sec-generated-state-absent-registration-settlement-v1' ||
          receipt.relativePath !== disposing.relativeStagePath ||
          receipt.outcome !== outcome || receipt.terminal !== 'disposed' ||
          !sameGeneratedStateIdentity(receipt.physical, disposing.stageRootPhysical)) {
        throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency absent stage lifecycle receipt differs');
      }
    }
  } else {
    if (stageRoot.kind !== 'directory' || stageRoot.physical === null ||
        !sameGeneratedStateIdentity(stageRoot.physical, disposing.stageRootPhysical)) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency stage intent root identity changed; residue is preserved', {
        stageRootPath: disposing.stageRootPath
      });
    }
    const nodeModulesPath = path.join(disposing.stageRootPath, 'node_modules');
    const nodeModules = await observeDependencyTransitionSlot(nodeModulesPath);
    await disposeDependencyTransitionStage(
      root,
      disposing.stageRootPath,
      options,
      outcome,
      nodeModules,
      stageRoot,
      compilerDependencyStageAuthority(root)
    );
  }
  const after = await observeDependencyTransitionSlot(disposing.stageRootPath);
  if (after.kind !== 'absent') {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency stage remained after intent settlement', {
      stageRootPath: disposing.stageRootPath,
      observed: after
    });
  }
  await advanceCompilerDependencyStageIntent(root, disposing, 'settled', outcome, options);
}

async function migrateRegisteredLegacyCompilerDependencyStages(
  root: string,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const stageAuthority = compilerDependencyStageAuthority(root);
  if (stageAuthority.lifecycle === undefined) return;
  let parent: PhysicalDirectoryIdentity;
  try {
    parent = inspectNoFollowDirectoryChain(
      stageAuthority.parent,
      'Legacy compiler dependency stage parent'
    ).target;
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') return;
    throw error;
  }
  const { representedStagePaths } = await readCompilerDependencyStageIntents(root, options);
  const directNames = await readNoFollowDirectNames(
    parent,
    'Legacy compiler dependency stage namespace census',
    COMPILER_DEPENDENCY_STAGE_INTENT_CAPACITY,
    options
  );
  const candidates = directNames
    .filter((name) => name.startsWith(stageAuthority.prefix))
    .map((name) => path.join(parent.path, name))
    .filter((stagePath) => !representedStagePaths.has(path.resolve(stagePath)));

  const lifecycle = options.generatedStateLifecycle;
  if (lifecycle === undefined || lifecycle.inspect === undefined || lifecycle.observeRetirement === undefined) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Legacy compiler dependency stage migration requires one root-bound lifecycle inventory authority'
    );
  }
  const {
    assertGeneratedStateCleanupContinuationReceipt,
    assertGeneratedStateRetirementObservation
  } = await import('../../../runtime-state/generated-state/lifecycle-evidence.ts');
  runtimeDependencyOperationRemainingMs(options, 'Legacy compiler dependency lifecycle census admission');
  const lifecycleCensus = await lifecycle.inspect();
  runtimeDependencyOperationRemainingMs(options, 'Legacy compiler dependency lifecycle census readback');
  const registeredMissing = lifecycleCensus.entries.filter((entry) => {
    const absolute = path.resolve(root, ...entry.relativePath.split('/'));
    return entry.ruleId === stageAuthority.lifecycle!.ruleId &&
      path.dirname(absolute) === path.resolve(stageAuthority.parent) &&
      path.basename(absolute).startsWith(stageAuthority.prefix) &&
      !representedStagePaths.has(absolute) && entry.kind === 'missing';
  });
  const missingWithoutRetirement = registeredMissing.filter(
    ({ registrationState }) => registrationState !== 'retired' && registrationState !== 'missing'
  );
  if (missingWithoutRetirement.length > 0) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Missing legacy compiler dependency stages have no terminal retirement authority',
      { relativePaths: missingWithoutRetirement.map(({ relativePath }) => relativePath) }
    );
  }
  if (candidates.length === 0 && registeredMissing.length === 0) return;
  const validated: Array<Readonly<{
    relativePath: string;
    stageRoot: DependencyTransitionSlot;
    registration: GeneratedStateRegistration | null;
    registrationState: 'active' | 'retired';
  }>> = [];
  // Complete every selected physical and generated-state read before the
  // first durable migration intent. Direct siblings outside the registered
  // stage selector remain unclassified and untouched: their basename cannot
  // grant this owner either adoption or retirement authority, and they do not
  // invalidate an exact active registration for a disjoint physical root.
  for (const stagePath of candidates) {
    const stageRoot = await observeDependencyTransitionSlot(stagePath);
    if (stageRoot.kind !== 'directory' || stageRoot.physical === null) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Legacy compiler dependency stage disappeared during census', { stagePath });
    }
    const stageIdentity = inspectNoFollowDirectoryChain(stagePath, 'Legacy compiler dependency stage').target;
    if (!sameGeneratedStateIdentity(generatedStatePhysicalIdentity(stageIdentity), stageRoot.physical)) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Legacy compiler dependency stage physical identity changed during census');
    }
    const directChildren = scanNoFollowDirectoryTreeMetadata(stageIdentity, {
      deadlineAtMs: runtimeDependencyOperationDeadlineAt(options, 'Legacy compiler dependency stage closed-world census'),
      maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
      signal: runtimeDependencyOperationContext(options).signal
    }).filter((child) => !child.relativePath.includes('/'));
    const allowedChildren = new Set(stageAuthority.allowedDirectChildren);
    const unknownChildren = directChildren.filter(({ relativePath }) => !allowedChildren.has(relativePath));
    const invalidOwnedChildren = directChildren.filter(({ relativePath, kind }) =>
      (relativePath === 'node_modules' && kind !== 'directory') ||
      (relativePath !== 'node_modules' && kind !== 'file'));
    if (unknownChildren.length > 0 || invalidOwnedChildren.length > 0) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Legacy compiler dependency stage has foreign or malformed descendants', {
        stagePath,
        unknownChildren: unknownChildren.map(({ relativePath }) => relativePath),
        invalidOwnedChildren: invalidOwnedChildren.map(({ relativePath, kind }) => ({ relativePath, kind }))
      });
    }
    const relativePath = path.relative(root, stagePath).replaceAll('\\', '/');
    runtimeDependencyOperationRemainingMs(options, 'Legacy compiler dependency registration observation admission');
    const observed = await lifecycle.observeRetirement(relativePath, {
      owner: stageAuthority.lifecycle.owner,
      producer: stageAuthority.lifecycle.producer,
      ruleId: stageAuthority.lifecycle.ruleId,
      physical: stageRoot.physical
    });
    runtimeDependencyOperationRemainingMs(options, 'Legacy compiler dependency registration observation readback');
    await assertGeneratedStateRetirementObservation(observed, { workspaceRoot: root, relativePath: observed.relativePath });
    const activeRegistration = observed.status === 'active';
    const retiredRegistration = observed.status === 'retired-present';
    if (observed.relativePath !== relativePath ||
        (!activeRegistration && !retiredRegistration) || observed.registrationDigest === null ||
        observed.physical === null ||
        !sameGeneratedStateIdentity(observed.physical, stageRoot.physical)) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Legacy compiler dependency stage has no exact active or retired registration receipt', {
        relativePath,
        observed: {
          physical: observed.physical,
          registrationDigest: observed.registrationDigest,
          status: observed.status
        }
      });
    }
    let registration: GeneratedStateRegistration | null = null;
    if (activeRegistration) {
      const bind = lifecycle.bind;
      if (bind === undefined) {
        throw new CodedFailure(
          'RUNTIME-DEPS-004',
          'Active legacy compiler dependency stage has no registration binding authority'
        );
      }
      runtimeDependencyOperationRemainingMs(options, 'Legacy compiler dependency registration binding admission');
      registration = await bind(relativePath, {
        owner: stageAuthority.lifecycle.owner,
        producer: stageAuthority.lifecycle.producer,
        ruleId: stageAuthority.lifecycle.ruleId,
        physical: stageRoot.physical
      });
      runtimeDependencyOperationRemainingMs(options, 'Legacy compiler dependency registration binding readback');
      if (registration.phase !== 'active' || registration.relativePath !== relativePath ||
          registration.registrationDigest !== observed.registrationDigest ||
          !sameGeneratedStateIdentity(registration.root, stageRoot.physical)) {
        throw new CodedFailure('RUNTIME-DEPS-004', 'Legacy compiler dependency registration changed after inventory');
      }
    }
    validated.push(Object.freeze({
      relativePath,
      stageRoot,
      registration,
      registrationState: activeRegistration ? 'active' : 'retired'
    }));
  }

  const quarantine = lifecycle.quarantine;
  if (quarantine === undefined &&
      (registeredMissing.some(({ registrationState }) => registrationState === 'retired') ||
        validated.some(({ registrationState }) => registrationState === 'retired'))) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Retired legacy compiler dependency stages have no bounded quarantine continuation authority'
    );
  }
  for (const entry of registeredMissing.filter(({ registrationState }) => registrationState === 'retired')) {
    await runtimeDependencyOperationEffectFence(options, 'Missing retired legacy stage continuation admission');
    const receipt = await quarantine!(entry.relativePath, {
      outcome: 'legacy-generation-staging-retired',
      profile: 'automatic'
    });
    await assertGeneratedStateCleanupContinuationReceipt(receipt, { workspaceRoot: root });
    if ((receipt.terminal !== 'completed' && receipt.terminal !== 'continuation-required') ||
        receipt.blockers.length !== 0) {
      throw new CodedFailure(
        'RUNTIME-DEPS-004',
        'Missing retired legacy stage continuation did not preserve one exact quarantine receipt'
      );
    }
    if (receipt.terminal === 'continuation-required') {
      throw new CodedFailure(
        'RUNTIME-DEPS-004',
        'Missing retired legacy stage requires one fresh bounded quarantine continuation',
        { cleanupContinuation: receipt, continuationRequired: true }
      );
    }
  }

  const retired = validated.filter(({ registrationState }) => registrationState === 'retired');
  for (const candidate of retired) {
    await runtimeDependencyOperationEffectFence(options, 'Retired legacy compiler dependency stage quarantine');
    const receipt = await quarantine!(candidate.relativePath, {
      outcome: 'legacy-generation-staging-retired',
      profile: 'automatic'
    });
    await assertGeneratedStateCleanupContinuationReceipt(receipt, { workspaceRoot: root });
    if ((receipt.terminal !== 'completed' && receipt.terminal !== 'continuation-required') ||
        receipt.blockers.length !== 0 ||
        (await observeDependencyTransitionSlot(candidate.stageRoot.path)).kind !== 'absent') {
      throw new CodedFailure(
        'RUNTIME-DEPS-004',
        'Retired legacy compiler dependency stage quarantine failed exact source absence readback'
      );
    }
    if (receipt.terminal === 'continuation-required') {
      throw new CodedFailure(
        'RUNTIME-DEPS-004',
        'Retired legacy compiler dependency stage requires one fresh bounded quarantine continuation',
        { cleanupContinuation: receipt, continuationRequired: true }
      );
    }
  }

  const ownerRoot = inspectNoFollowDirectoryChain(root, 'Legacy compiler dependency stage migration owner').target;
  for (const candidate of validated.filter(({ registrationState }) => registrationState === 'active')) {
    if (candidate.registration === null) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Active legacy compiler dependency stage lost its bound registration');
    }
    await runtimeDependencyOperationEffectFence(options, 'Legacy compiler dependency stage migration admission');
    const current = await observeDependencyTransitionSlot(candidate.stageRoot.path);
    if (!transitionSlotMatches(current, candidate.stageRoot)) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Legacy compiler dependency stage changed before migration intent');
    }
    const prepared = preparedCompilerDependencyStageIntent({
      operationId: candidate.registration.operationId,
      operationInitialBudgetMs: runtimeDependencyOperationContext(options).initialBudgetMs,
      ownerRoot,
      stageRoot: candidate.stageRoot
    });
    await writeCompilerDependencyStageIntent(root, prepared, options);
    await settleCompilerDependencyStageIntent(
      root,
      prepared,
      'legacy-generation-staging-retired',
      options
    );
  }
}

async function recoverCompilerDependencyStageIntents(
  root: string,
  options: RuntimeDependencyOperationOptions,
  pendingTransition: DependencyTransitionJournal | null = null
): Promise<void> {
  const { active } = await readCompilerDependencyStageIntents(root, options);
  for (const intent of active) {
    const owner = inspectNoFollowDirectoryChain(root, 'Compiler dependency stage recovery owner').target;
    if (path.resolve(intent.ownerRoot) !== owner.path ||
        !sameGeneratedStateIdentity(generatedStatePhysicalIdentity(owner), intent.ownerRootPhysical)) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency stage intent owner epoch changed; residue is preserved');
    }
    const transitionStageRoot = (pendingTransition?.kind === 'compiler-generation' ||
        pendingTransition?.kind === 'compiler-local-locator') &&
        pendingTransition.phase !== 'complete' && pendingTransition.phase !== 'rolled-back'
      ? pendingTransition.stageRoot
      : null;
    if (intent.phase === 'prepared' && transitionStageRoot?.kind === 'directory' &&
        transitionStageRoot.physical !== null &&
        path.resolve(intent.stageRootPath) === path.resolve(transitionStageRoot.path) &&
        sameGeneratedStateIdentity(intent.stageRootPhysical, transitionStageRoot.physical)) {
      // Publication recovery owns this exact stage.  Settling its birth intent
      // first would delete the only durable source generation and turn a
      // recoverable v2 -> v3 transition into an endless reinstall loop.
      continue;
    }
    // The intent itself is the durable owner authorization.  Settlement must
    // also terminalize a stage that is already absent: the physical deletion
    // may have completed before the disposing record or lifecycle receipt was
    // durably published.  settleCompilerDependencyStageIntent advances the
    // intent first, disposes the exact lifecycle registration, proves absence,
    // and only then publishes the terminal record.
    await settleCompilerDependencyStageIntent(root, intent, 'generation-staging-recovered', options);
  }
}

function compilerDependencyStageAuthority(root: string): DependencyTransitionStageAuthority {
  return Object.freeze({
    parent: path.join(path.resolve(root), '.tmp', 'dependency-installs'),
    prefix: 'c.staging-',
    allowedDirectChildren: Object.freeze(['bun.lock', 'bunfig.toml', 'node_modules', 'package.json']),
    lifecycle: Object.freeze({
      owner: COMPILER_STAGING_LIFECYCLE_OWNER,
      producer: COMPILER_STAGING_LIFECYCLE_PRODUCER,
      ruleId: COMPILER_STAGING_LIFECYCLE_RULE
    })
  });
}

function runtimeDependencyStageAuthority(sharedDepsRoot: string): DependencyTransitionStageAuthority {
  return Object.freeze({
    parent: path.resolve(sharedDepsRoot),
    prefix: '.runtime-generation-',
    allowedDirectChildren: Object.freeze(['node_modules'])
  });
}

function projectDependencyStageAuthority(projectRoot: string): DependencyTransitionStageAuthority {
  return Object.freeze({
    parent: path.join(path.resolve(projectRoot), '.tmp'),
    prefix: 'project.staging-',
    allowedDirectChildren: Object.freeze(['node_modules'])
  });
}

async function disposeDependencyTransitionStage(
  root: string,
  stageRootPath: string,
  options: RuntimeDependencyOperationOptions,
  outcome: string,
  expectedStage: DependencyTransitionSlot | null,
  expectedStageRoot: DependencyTransitionSlot | null,
  authority: DependencyTransitionStageAuthority
): Promise<void> {
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition stage disposal admission');
  if (expectedStageRoot === null || expectedStageRoot.kind !== 'directory' ||
      expectedStageRoot.physical === null || path.resolve(expectedStageRoot.path) !== path.resolve(stageRootPath)) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Dependency transition staging root has no operation-owned physical identity; residue is preserved',
      { stageRootPath, expectedStageRoot }
    );
  }
  const stageRootParent = path.resolve(authority.parent);
  const normalizedStageRootPath = path.resolve(stageRootPath);
  if (path.dirname(normalizedStageRootPath) !== stageRootParent ||
      !path.basename(normalizedStageRootPath).startsWith(authority.prefix)) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Dependency transition staging root is outside its registered operation selector; residue is preserved',
      { stageRootPath, stageRootParent, prefix: authority.prefix }
    );
  }
  const stageRoot = await observeDependencyTransitionSlot(stageRootPath);
  if (stageRoot.kind === 'absent') return;
  if (!transitionSlotMatches(stageRoot, expectedStageRoot)) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Dependency transition staging root identity changed; residue is preserved',
      { stageRootPath, expectedStageRoot, observedStageRoot: stageRoot }
    );
  }
  const stagePath = expectedStage?.path ?? null;
  if (stagePath !== null && (
      path.dirname(path.resolve(stagePath)) !== path.resolve(stageRootPath) ||
      path.basename(path.resolve(stagePath)) !== 'node_modules')) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Dependency transition stage is not the recorded child of its staging root; residue is preserved',
      { stagePath, stageRootPath }
    );
  }
  const stage = stagePath === null ? null : await observeDependencyTransitionSlot(stagePath);
  if (expectedStage !== null) {
    if (!transitionSlotMatches(stage!, expectedStage)) {
      throw new CodedFailure(
        'RUNTIME-DEPS-004',
        'Dependency transition stage identity changed; residue is preserved',
        { stagePath, expectedStage, observedStage: stage }
      );
    }
  } else if (stage !== null && stage.kind !== 'absent') {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Dependency transition staging root contains an unrecorded child; residue is preserved',
      { stageRootPath, observedStage: stage }
    );
  }
  if (expectedStage === null) {
    const unrecorded = scanNoFollowDirectoryTreeMetadata(
      inspectNoFollowDirectoryChain(stageRootPath, 'Dependency transition empty staging root').target,
      {
        deadlineAtMs: runtimeDependencyOperationDeadlineAt(options, 'Dependency transition empty staging root census'),
        maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
        signal: runtimeDependencyOperationContext(options).signal
      }
    );
    if (unrecorded.length > 0) {
      throw new CodedFailure(
        'RUNTIME-DEPS-004',
        'Dependency transition staging root has unrecorded residue; it is preserved',
        { stageRootPath, entryCount: unrecorded.length }
      );
    }
  }
  // The generated-state lifecycle is itself an Effect owner and may remove
  // the complete root.  Establish the closed-world physical preimage before
  // invoking it; otherwise a foreign child could be swept by that owner and
  // disappear before the retained inventory below observes it.
  const preLifecycleRoot = inspectNoFollowDirectoryChain(
    stageRootPath,
    'Dependency transition staging lifecycle preimage'
  ).target;
  if (!sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(preLifecycleRoot),
    expectedStageRoot.physical
  )) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Dependency transition staging root changed before lifecycle settlement; residue is preserved'
    );
  }
  const preLifecycleDirectChildren = scanNoFollowDirectoryTreeMetadata(preLifecycleRoot, {
    deadlineAtMs: runtimeDependencyOperationDeadlineAt(options, 'Dependency transition staging lifecycle preimage census'),
    maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
    signal: runtimeDependencyOperationContext(options).signal
  }).filter((entry) => !entry.relativePath.includes('/'));
  const declaredChildren = new Set(authority.allowedDirectChildren);
  const foreignPreimageChildren = preLifecycleDirectChildren
    .filter(({ relativePath }) => !declaredChildren.has(relativePath));
  if (foreignPreimageChildren.length > 0) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Dependency transition staging root contains unknown operation descendants; residue is preserved',
      { stageRootPath, unknownDirectChildren: foreignPreimageChildren.map(({ relativePath }) => relativePath) }
    );
  }
  const relativeStagePath = path.relative(root, stageRootPath).replaceAll('\\', '/');
  if (options.generatedStateLifecycle !== undefined) {
    if (authority.lifecycle !== undefined) {
      const observeRetirement = options.generatedStateLifecycle.observeRetirement;
      if (observeRetirement === undefined) {
        throw new CodedFailure(
          'RUNTIME-DEPS-004',
          'Dependency transition staging root has no owner-bound lifecycle observation; residue is preserved',
          { stageRootPath }
        );
      }
      const expectedLifecycle = Object.freeze({
        owner: authority.lifecycle.owner,
        producer: authority.lifecycle.producer,
        ruleId: authority.lifecycle.ruleId,
        physical: generatedStatePhysicalIdentity(expectedStageRoot.physical)
      });
      const lifecycleObservation = await observeRetirement(
        relativeStagePath,
        expectedLifecycle
      );
      const { assertGeneratedStateRetirementObservation } = await import(
        '../../../runtime-state/generated-state/lifecycle-evidence.ts'
      );
      await assertGeneratedStateRetirementObservation(lifecycleObservation, { workspaceRoot: root, relativePath: lifecycleObservation.relativePath });
      if ((lifecycleObservation.status !== 'active' &&
          lifecycleObservation.status !== 'retired-present') ||
          lifecycleObservation.physical === null ||
          !sameGeneratedStateIdentity(
            lifecycleObservation.physical,
            expectedStageRoot.physical
          )) {
        throw new CodedFailure(
          'RUNTIME-DEPS-004',
          'Dependency transition staging root has no exact lifecycle registration; residue is preserved',
          {
            observationDigest: lifecycleObservation.observationDigest,
            stageRootPath,
            status: lifecycleObservation.status
          }
        );
      }
      if (lifecycleObservation.status === 'active') {
        const bind = options.generatedStateLifecycle.bind;
        if (bind === undefined) {
          throw new CodedFailure(
            'RUNTIME-DEPS-004',
            'Dependency transition staging root has no read-only lifecycle binding path; residue is preserved',
            { stageRootPath }
          );
        }
        await runtimeDependencyOperationEffectFence(options, 'Dependency transition staging lifecycle bind');
        await bind(relativeStagePath, expectedLifecycle);
      }
      const quarantine = options.generatedStateLifecycle.quarantine;
      if (quarantine !== undefined) {
        await runtimeDependencyOperationEffectFence(options, 'Dependency transition staging lifecycle quarantine');
        const receipt = await quarantine(relativeStagePath, { outcome, profile: 'automatic' });
        const { assertGeneratedStateCleanupContinuationReceipt } = await import(
          '../../../runtime-state/generated-state/lifecycle-evidence.ts'
        );
        await assertGeneratedStateCleanupContinuationReceipt(receipt, { workspaceRoot: root });
        if ((receipt.terminal !== 'completed' && receipt.terminal !== 'continuation-required') ||
            receipt.blockers.length !== 0 || receipt.requested.length !== 1 ||
            receipt.requested[0] !== relativeStagePath ||
            (await observeDependencyTransitionSlot(stageRootPath)).kind !== 'absent') {
          throw new CodedFailure(
            'RUNTIME-DEPS-004',
            'Dependency transition staging quarantine did not reach one terminal source absence; residue is preserved'
          );
        }
        if (receipt.terminal === 'continuation-required') {
          throw new CodedFailure(
            'RUNTIME-DEPS-004',
            'Dependency transition staging quarantine requires one fresh bounded continuation',
            { cleanupContinuation: receipt, continuationRequired: true }
          );
        }
        return;
      }
    }
    // Lifecycle disposal is an authority-bearing operation.  A missing,
    // foreign, or stale registration must block and preserve the stage; the
    // physical inventory below is only the second half of a successful
    // operation-owned disposal, never a provenance fallback.  Swallowing the
    // lifecycle error would let a forged journal turn an arbitrary directory
    // into deletion authority after the validation interval.
    await runtimeDependencyOperationEffectFence(options, 'Dependency transition staging lifecycle disposal');
    const disposalReceipt = await options.generatedStateLifecycle.disposed(relativeStagePath, {
      outcome,
      profile: 'automatic'
    });
    const { assertGeneratedStateDisposalReceipt } = await import(
      '../../../runtime-state/generated-state/lifecycle-evidence.ts'
    );
    await assertGeneratedStateDisposalReceipt(disposalReceipt, { workspaceRoot: root, relativePath: disposalReceipt.relativePath });
    if (disposalReceipt.relativePath !== relativeStagePath ||
        disposalReceipt.profile !== 'automatic' || disposalReceipt.terminal !== 'disposed') {
      throw new CodedFailure(
        'RUNTIME-DEPS-004',
        'Dependency transition staging lifecycle receipt differs; residue is preserved'
      );
    }
    runtimeDependencyOperationRemainingMs(options, 'Dependency transition staging lifecycle disposal readback');
    const afterLifecycleRoot = await observeDependencyTransitionSlot(stageRootPath);
    if (afterLifecycleRoot.kind === 'absent') return;
    if (!transitionSlotMatches(afterLifecycleRoot, expectedStageRoot)) {
      throw new CodedFailure(
        'RUNTIME-DEPS-004',
        'Dependency transition staging root changed during lifecycle disposal; residue is preserved',
        { stageRootPath, expectedStageRoot, observedStageRoot: afterLifecycleRoot }
      );
    }
    if (expectedStage !== null) {
      const afterLifecycleStage = await observeDependencyTransitionSlot(stagePath!);
      if (!transitionSlotMatches(afterLifecycleStage, expectedStage)) {
        throw new CodedFailure(
          'RUNTIME-DEPS-004',
          'Dependency transition stage changed during lifecycle disposal; residue is preserved',
          { stagePath, expectedStage, observedStage: afterLifecycleStage }
        );
      }
    }
  }
  // Even operation-created staging roots are disposed through the retained
  // no-follow inventory below. A basename prefix is metadata, not authority,
  // and cannot close the validation -> replacement race for a substituted
  // stage. Unknown or drifted stage entries therefore remain preserved and
  // return a typed blocker.
  const stageRootIdentity = inspectNoFollowDirectoryChain(
    stageRootPath,
    'Dependency transition staging root cleanup'
  ).target;
  if (!sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(stageRootIdentity),
    expectedStageRoot.physical
  )) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Dependency transition staging root changed before inventory; residue is preserved',
      { stageRootPath, expectedStageRoot }
    );
  }
  // Rebuild the closed-world direct-child manifest immediately before the
  // retained inventory.  Lifecycle retirement above is itself an Effect and
  // can leave an operation-created root alive; an earlier preflight would
  // permit an unknown child inserted during that Effect to be swept by the
  // subsequent inventory.  Only children in the producer's declared shape
  // may enter the inventory.  Anything else is preserved and typed-blocked.
  const directChildren = scanNoFollowDirectoryTreeMetadata(stageRootIdentity, {
    deadlineAtMs: runtimeDependencyOperationDeadlineAt(options, 'Dependency transition staging direct-child census'),
    maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
    signal: runtimeDependencyOperationContext(options).signal
  }).filter((entry) => !entry.relativePath.includes('/'));
  const allowedDirectChildren = new Set(authority.allowedDirectChildren);
  const unknownDirectChildren = directChildren.filter(({ relativePath }) => !allowedDirectChildren.has(relativePath));
  if (unknownDirectChildren.length > 0) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Dependency transition staging root contains unknown operation descendants; residue is preserved',
      { stageRootPath, unknownDirectChildren: unknownDirectChildren.map(({ relativePath }) => relativePath) }
    );
  }
  const inventory = scanNoFollowDirectoryTreeMetadata(stageRootIdentity, {
    deadlineAtMs: runtimeDependencyOperationDeadlineAt(options, 'Dependency transition staging disposal inventory'),
    maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
    signal: runtimeDependencyOperationContext(options).signal
  });
  const byPath = new Map(inventory.map((entry) => [entry.relativePath, entry]));
  const ordered = [...inventory].sort((left, right) => {
    const depth = (value: string): number => value.split('/').length;
    return depth(right.relativePath) - depth(left.relativePath) || compareCodeUnits(right.relativePath, left.relativePath);
  });
  for (const entry of ordered) {
    await runtimeDependencyOperationEffectFence(options, 'Dependency transition staging descendant disposal');
    const parts = entry.relativePath.split('/');
    parts.pop();
    const ancestors = parts.map((_, index) => parts.slice(0, index + 1).join('/'))
      .map((relativePath) => {
        const ancestor = byPath.get(relativePath);
        if (ancestor === undefined || ancestor.kind !== 'directory') {
          throw new CodedFailure('RUNTIME-DEPS-002', 'Dependency transition stage inventory has an incomplete ancestor chain');
        }
        return Object.freeze({
          relativePath,
          device: ancestor.device,
          inode: ancestor.inode
        });
      });
    deleteRetainedNoFollowEntry({
      root: stageRootIdentity,
      relativePath: entry.relativePath,
      kind: entry.kind,
      device: entry.device,
      inode: entry.inode,
      expectedLinkTarget: entry.linkTarget ?? undefined,
      ancestorDirectories: ancestors
    });
  }
  const currentStageRoot = await observeDependencyTransitionSlot(stageRootPath);
  if (!transitionSlotMatches(currentStageRoot, expectedStageRoot)) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Dependency transition staging root changed before final disposal; residue is preserved',
      { stageRootPath, expectedStageRoot, observedStageRoot: currentStageRoot }
    );
  }
  const parent = inspectNoFollowDirectoryChain(path.dirname(stageRootPath), 'Dependency transition staging root parent').target;
  await runtimeDependencyOperationEffectFence(options, 'Dependency transition staging root disposal');
  deleteRetainedNoFollowEntry({
    root: parent,
    relativePath: path.basename(stageRootPath),
    kind: 'directory',
    device: expectedStageRoot.physical.device,
    inode: expectedStageRoot.physical.inode,
    ancestorDirectories: Object.freeze([])
  });
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition staging root disposal readback');
}

export async function readRuntimeDepsStamp(stampPath: string): Promise<RuntimeDepsStamp | null> {
  let stampText: string;
  try {
    stampText = await readPhysicalControlText(stampPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  try {
    const value = JSON.parse(stampText) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const stamp = value as Partial<RuntimeDepsStamp>;
    if (stamp.formatVersion !== 'runtime-deps-stamp-v4' ||
      stamp.packageManager !== 'bun' ||
      typeof stamp.manifestHash !== 'string' ||
      typeof stamp.installedAt !== 'string' ||
      Number.isNaN(Date.parse(stamp.installedAt)) ||
      new Date(stamp.installedAt).toISOString() !== stamp.installedAt ||
      !isRuntimeDependencyMaterializationBinding(stamp.binding) ||
      !isRuntimeDependencySourceGeneration(stamp.sourceGeneration) ||
      !isRuntimeDependencyTargetIdentity(stamp.target) ||
      stamp.binding.manifestHash !== stamp.manifestHash) return null;
    const binding = buildRuntimeDependencyMaterializationBinding({
      manifestHash: stamp.binding.manifestHash,
      packages: stamp.binding.packages,
      rootPackages: stamp.binding.rootPackages,
      toolchain: stamp.binding.toolchain
    });
    const canonical: RuntimeDepsStamp = {
      binding,
      formatVersion: 'runtime-deps-stamp-v4',
      installedAt: stamp.installedAt,
      manifestHash: stamp.manifestHash,
      packageManager: 'bun',
      sourceGeneration: stamp.sourceGeneration,
      target: stamp.target
    };
    return canonicalEquals(value, canonical) ? Object.freeze(canonical) : null;
  } catch {
    return null;
  }
}

async function writeRuntimeDepsStamp(
  stampPath: string,
  stamp: RuntimeDepsStamp,
  commitFence?: CommitFence
): Promise<void> {
  const canonical: RuntimeDepsStamp = {
    binding: stamp.binding,
    formatVersion: 'runtime-deps-stamp-v4',
    installedAt: stamp.installedAt,
    manifestHash: stamp.manifestHash,
    packageManager: 'bun',
    sourceGeneration: stamp.sourceGeneration,
    target: stamp.target
  };
  if (stamp.formatVersion !== 'runtime-deps-stamp-v4' ||
    stamp.packageManager !== 'bun' ||
    stamp.binding.manifestHash !== stamp.manifestHash ||
    !isRuntimeDependencyMaterializationBinding(stamp.binding) ||
    !isRuntimeDependencySourceGeneration(stamp.sourceGeneration) ||
    !isRuntimeDependencyTargetIdentity(stamp.target) ||
    Number.isNaN(Date.parse(stamp.installedAt)) ||
    new Date(stamp.installedAt).toISOString() !== stamp.installedAt ||
    !canonicalEquals(stamp, canonical)) {
    throw new CodedFailure('RUNTIME-DEPS-002', 'Runtime dependency stamp is non-canonical');
  }
  const parent = inspectNoFollowDirectoryChain(
    path.dirname(path.resolve(stampPath)),
    'Runtime dependency stamp parent'
  ).target;
  const name = path.basename(stampPath);
  const bytes = Buffer.from(formatJsonFile(canonical), 'utf8');
  const validate = (candidate: Uint8Array): void => {
    if (!Buffer.from(candidate).equals(bytes)) {
      throw new CodedFailure('RUNTIME-DEPS-002', 'Runtime dependency stamp canonical bytes changed');
    }
  };
  await commitFence?.();
  const existing = inspectNoFollowOrdinaryFileEntry(parent, name);
  if (existing === null) {
    publishExclusiveDurableCanonicalFile({ parent, name, bytes, validate });
  } else {
    replaceDurableCanonicalFile({
      parent,
      name,
      bytes,
      expectedExisting: { device: existing.device, inode: existing.inode },
      validate
    });
  }
  await commitFence?.();
  const readback = readNoFollowOrdinaryFile(parent, name);
  if (readback === null || !Buffer.from(readback).equals(bytes)) {
    throw new CodedFailure(
      'RUNTIME-DEPS-002',
      'Runtime dependency stamp changed before exact publication readback'
    );
  }
}

function physicalSharedDependencyDirectory(
  directoryPath: string,
  allowMissing: boolean
): PhysicalDirectoryIdentity | null {
  const presence = inspectExactNoFollowDirectoryPresence(
    path.resolve(directoryPath),
    'Shared dependency authority root'
  );
  if (presence.state === 'absent') {
    if (allowMissing) return null;
    throw new CodedFailure('RUNTIME-DEPS-002', 'Shared dependency authority root is absent');
  }
  return presence.directory.target;
}

async function copyPhysicalTrees(input: Readonly<{
  options: RuntimeDependencyOperationOptions;
  includeRelativePaths?: readonly string[];
  invalidSource: (detail: 'changed' | 'reparse' | 'special') => Error;
  maximumEntries?: number;
  roots: readonly Readonly<{ source: string; target: string }>[];
  skipNestedNodeModules?: boolean;
}>): Promise<void> {
  try {
    await copyNoFollowDirectoryTreesBulk(
      input.roots.map((root) => Object.freeze({
        source: inspectNoFollowDirectoryChain(root.source, 'Physical tree bulk source').target,
        target: root.target
      })),
      {
        assertCurrent: async () => runtimeDependencyOperationEffectFence(
          input.options,
          'Runtime dependency bulk copy'
        ),
        deadlineAtMs: runtimeDependencyOperationDeadlineAt(
          input.options,
          'Runtime dependency bulk copy deadline'
        ),
        includeRelativePaths: input.includeRelativePaths,
        maximumEntries: input.maximumEntries,
        maximumBytes: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES,
        signal: runtimeDependencyOperationContext(input.options).signal,
        skipNestedNodeModules: input.skipNestedNodeModules
      }
    );
    return;
  } catch (error) {
    if (error instanceof PhysicalNoFollowError) {
      const detail = error.code === 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'
        ? 'changed' as const
        : error.code === 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH'
          ? 'reparse' as const
          : null;
      if (detail !== null) throw input.invalidSource(detail);
    }
    throw error;
  }
}

function projectStampPath(projectRoot: string): string {
  return path.join(projectRoot, '.runtime-deps.stamp.json');
}

interface InstallLockOwner {
  createdAt: string;
  pid: number;
  token: string;
}

type InstallLockTerminalHandoffRequest = Readonly<{
  compilerRootPhysical: GeneratedStatePhysicalIdentity;
  coordinationRootPhysical: GeneratedStatePhysicalIdentity;
  workspaceLocatorKey: `sha256:${string}`;
}>;
const installLockTerminalHandoffRequests = new WeakMap<object, InstallLockTerminalHandoffRequest>();
function issueInstallLockTerminalHandoffRequest(
  input: InstallLockTerminalHandoffRequest
): InstallLockTerminalHandoffRequest {
  const request = Object.freeze({ ...input });
  installLockTerminalHandoffRequests.set(request, request);
  return request;
}

const INSTALL_LOCK_RECLAIM_SCHEMA =
  'sec-runtime-dependency-install-lock-reclaim-v1' as const;

interface InstallLockReclaimOwner {
  schema: typeof INSTALL_LOCK_RECLAIM_SCHEMA;
  createdAt: string;
  pid: number;
  token: string;
  lock: Readonly<{
    device: string;
    inode: string;
    size: number;
  }>;
}

type NoFollowOwnedFileObservation = Readonly<{
  parent: PhysicalDirectoryIdentity;
  name: string;
  device: string;
  inode: string;
  size: number;
}>;

function isInstallLockOwner(value: unknown): value is InstallLockOwner {
  const owner = value as Partial<InstallLockOwner> | null;
  return owner !== null && typeof owner === 'object' &&
    typeof owner.createdAt === 'string' && Number.isSafeInteger(owner.pid) && (owner.pid ?? 0) > 0 &&
    typeof owner.token === 'string' && owner.token.length > 0;
}

function isInstallLockReclaimOwner(value: unknown): value is InstallLockReclaimOwner {
  if (!hasExactObjectKeys(value, ['createdAt', 'lock', 'pid', 'schema', 'token'])) return false;
  const owner = value as Partial<InstallLockReclaimOwner>;
  return owner.schema === INSTALL_LOCK_RECLAIM_SCHEMA &&
    typeof owner.createdAt === 'string' &&
    Number.isSafeInteger(owner.pid) && (owner.pid ?? 0) > 0 &&
    typeof owner.token === 'string' && owner.token.length > 0 &&
    hasExactObjectKeys(owner.lock, ['device', 'inode', 'size']) &&
    typeof owner.lock.device === 'string' && owner.lock.device.length > 0 &&
    typeof owner.lock.inode === 'string' && owner.lock.inode.length > 0 &&
    Number.isSafeInteger(owner.lock.size) && (owner.lock.size ?? -1) >= 0;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/**
 * Capture one ordinary file below a retained no-follow parent.  A lease
 * cleanup operation may only consume this observation; it never turns a
 * later path lookup into authority for deletion.
 */
function observeNoFollowOwnedFile(
  filePath: string,
  label: string
): NoFollowOwnedFileObservation | null {
  const presence = inspectExactNoFollowDirectoryPresence(path.dirname(filePath), `${label} parent`);
  if (presence.state === 'absent') return null;
  const parent = presence.directory.target;
  const name = path.basename(filePath);
  const entry = inspectNoFollowOrdinaryFileEntry(parent, name);
  if (entry === null) return null;
  if (entry.kind !== 'file') {
    throw new CodedFailure('RUNTIME-DEPS-003', `${label} is occupied by a non-file identity and is preserved`, {
      path: filePath,
      kind: entry.kind
    });
  }
  return Object.freeze({
    parent,
    name,
    device: entry.device,
    inode: entry.inode,
    size: entry.size
  });
}

function sameNoFollowOwnedFileObservation(
  left: NoFollowOwnedFileObservation,
  right: NoFollowOwnedFileObservation
): boolean {
  return left.parent.path === right.parent.path &&
    left.parent.device === right.parent.device &&
    left.parent.inode === right.parent.inode &&
    left.parent.objectId === right.parent.objectId &&
    left.name === right.name && left.device === right.device &&
    left.inode === right.inode && left.size === right.size;
}

function readNoFollowOwnedFileBytes(
  observation: NoFollowOwnedFileObservation,
  label: string
): Buffer {
  const before = observeNoFollowOwnedFile(
    path.join(observation.parent.path, observation.name),
    `${label} read`
  );
  if (before === null || !sameNoFollowOwnedFileObservation(before, observation)) {
    throw new CodedFailure('RUNTIME-DEPS-003', `${label} identity changed before read and is preserved`);
  }
  const bytes = readNoFollowOrdinaryFile(observation.parent, observation.name);
  if (bytes === null) {
    throw new CodedFailure('RUNTIME-DEPS-003', `${label} disappeared during read and is preserved`);
  }
  const after = observeNoFollowOwnedFile(
    path.join(observation.parent.path, observation.name),
    `${label} readback`
  );
  if (after === null || !sameNoFollowOwnedFileObservation(after, observation)) {
    throw new CodedFailure('RUNTIME-DEPS-003', `${label} identity changed during read and is preserved`);
  }
  return Buffer.from(bytes);
}

function readNoFollowOwnedFileJson(
  observation: NoFollowOwnedFileObservation,
  label: string
): unknown {
  try {
    return JSON.parse(readNoFollowOwnedFileBytes(observation, label).toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

function deleteNoFollowOwnedFile(
  filePath: string,
  expected: NoFollowOwnedFileObservation,
  label: string
): void {
  const current = observeNoFollowOwnedFile(filePath, `${label} cleanup`);
  if (current === null) return;
  if (!sameNoFollowOwnedFileObservation(current, expected)) {
    throw new CodedFailure('RUNTIME-DEPS-003', `${label} identity changed before exact cleanup and is preserved`, {
      path: filePath
    });
  }
  deleteRetainedNoFollowEntry({
    root: expected.parent,
    relativePath: expected.name,
    kind: 'file',
    device: expected.device,
    inode: expected.inode,
    ancestorDirectories: []
  });
}

const INSTALL_LOCK_DELETE_MAX_ATTEMPTS = 8;
const WINDOWS_TRANSIENT_DELETE_CODES = new Set(['EACCES', 'EBUSY', 'EPERM']);
const LEGACY_INSTALL_LOCK_RECLAIM_MAXIMUM_LIFETIME_MS =
  MAX_DEPENDENCY_OPERATION_TIMEOUT_MS +
  INSTALL_LOCK_DELETE_MAX_ATTEMPTS * 1_000 +
  5_000;

/**
 * Windows may transiently reject deletion of an ordinary lock file even
 * while its retained identity remains unchanged.  The dependency owner owns
 * that retry policy; the generic physical primitive remains one strict
 * retained-identity effect.  Every retry re-observes both physical identity
 * and owner bytes, consumes the original operation deadline/signal/poll
 * ledger, and treats absence as the only successful terminal readback.
 */
async function settleInstallLockOwnedFileDeletion(input: Readonly<{
  assertExpected(observation: NoFollowOwnedFileObservation): void;
  expected: NoFollowOwnedFileObservation;
  filePath: string;
  label: string;
  options: RuntimeDependencyOperationOptions;
}>): Promise<'absent' | 'deleted'> {
  const hostPlatform = input.options.testInstallLockDeletePlatform ?? process.platform;
  const sleep = input.options.sleep ?? sleepMs;
  for (let attempt = 1; attempt <= INSTALL_LOCK_DELETE_MAX_ATTEMPTS; attempt += 1) {
    const current = observeNoFollowOwnedFile(input.filePath, `${input.label} settlement`);
    if (current === null) return 'absent';
    if (!sameNoFollowOwnedFileObservation(current, input.expected)) {
      throw new CodedFailure(
        'RUNTIME-DEPS-003',
        `${input.label} identity changed during deletion settlement; replacement is preserved`,
        { attempt, filePath: input.filePath, outcome: 'preserved-replacement' }
      );
    }
    input.assertExpected(current);
    try {
      await input.options.testInstallLockDelete?.(input.filePath, attempt);
      deleteNoFollowOwnedFile(input.filePath, input.expected, input.label);
      // The retained physical primitive already proves absence before returning.
      // A new waiter may acquire the same name immediately after that readback.
      return 'deleted';
    } catch (error) {
      const afterFailure = observeNoFollowOwnedFile(input.filePath, `${input.label} retry readback`);
      if (afterFailure === null) return 'deleted';
      if (!sameNoFollowOwnedFileObservation(afterFailure, input.expected)) {
        throw new CodedFailure(
          'RUNTIME-DEPS-003',
          `${input.label} was replaced after deletion failure and is preserved`,
          {
            attempt,
            deleteFailure: runtimeDependencyFailureEvidence(error),
            filePath: input.filePath,
            outcome: 'preserved-replacement'
          }
        );
      }
      input.assertExpected(afterFailure);
      const code = (error as NodeJS.ErrnoException).code;
      if (hostPlatform !== 'win32' || code === undefined ||
          !WINDOWS_TRANSIENT_DELETE_CODES.has(code)) throw error;
      if (attempt === INSTALL_LOCK_DELETE_MAX_ATTEMPTS) {
        throw new CodedFailure(
          'RUNTIME-DEPS-003',
          `${input.label} deletion settlement remained unknown after bounded Windows retries`,
          {
            attempt,
            deleteFailure: runtimeDependencyFailureEvidence(error),
            filePath: input.filePath,
            outcome: 'unknown'
          }
        );
      }
      try {
        runtimeDependencyOperationRemainingMs(input.options, `${input.label} deletion retry`);
        await waitForRuntimeDependencyOperation(
          input.options,
          runtimeDependencyOperationContext(input.options).pollIntervalMs,
          sleep,
          `${input.label} Windows deletion retry`
        );
      } catch (deadlineOrAbort) {
        throw new CodedFailure(
          'RUNTIME-DEPS-003',
          `${input.label} deletion settlement deadline or cancellation left an unknown exact identity`,
          {
            attempt,
            deleteFailure: runtimeDependencyFailureEvidence(error),
            filePath: input.filePath,
            outcome: 'unknown',
            settlementFailure: runtimeDependencyFailureEvidence(deadlineOrAbort)
          }
        );
      }
    }
  }
  throw new Error('Unreachable install lock deletion settlement state.');
}

function parseInstallLockOwner(value: unknown): InstallLockOwner | null {
  return isInstallLockOwner(value) ? value : null;
}

async function reclaimOrphanInstallLock(
  lockPath: string,
  options: RuntimeDependencyOperationOptions
): Promise<boolean> {
  const reclaimPath = `${lockPath}.reclaim`;
  const initialLockObservation = observeNoFollowOwnedFile(
    lockPath,
    'Install lock orphan candidate admission'
  );
  if (initialLockObservation === null) return true;
  const initialOwner = parseInstallLockOwner(
    readNoFollowOwnedFileJson(initialLockObservation, 'Install lock orphan candidate admission')
  );
  if (initialOwner === null || processIsAlive(initialOwner.pid)) return false;
  const initialCreatedAtMs = Date.parse(initialOwner.createdAt);
  if (!Number.isFinite(initialCreatedAtMs) || Date.now() - initialCreatedAtMs < 5_000) return false;
  let reclaimMarker: Readonly<{
    bytes: Buffer;
    observation: NoFollowOwnedFileObservation;
    owner: InstallLockReclaimOwner;
  }> | null = null;
  try {
    const reclaimParent = inspectNoFollowDirectoryChain(path.dirname(reclaimPath), 'Install lock reclaim marker parent').target;
    const reclaimOwner: InstallLockReclaimOwner = Object.freeze({
      schema: INSTALL_LOCK_RECLAIM_SCHEMA,
      createdAt: (options.now ?? (() => new Date().toISOString()))(),
      pid: process.pid,
      token: crypto.randomUUID(),
      lock: Object.freeze({
        device: initialLockObservation.device,
        inode: initialLockObservation.inode,
        size: initialLockObservation.size
      })
    });
    const reclaimBytes = Buffer.from(formatJsonFile(reclaimOwner), 'utf8');
    try {
      const publication = publishExclusiveDurableCanonicalFile({
        parent: reclaimParent,
        name: path.basename(reclaimPath),
        bytes: reclaimBytes,
        validate: (bytes) => {
          const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
          if (!isInstallLockReclaimOwner(parsed) || parsed.token !== reclaimOwner.token) {
            throw new Error('Install lock reclaim marker bytes differ.');
          }
        }
      });
      if (!publication.created) return false;
      const published = observeNoFollowOwnedFile(reclaimPath, 'Install lock reclaim marker publication');
      if (published === null || published.device !== publication.physical.device ||
          published.inode !== publication.physical.inode) {
        throw new CodedFailure(
          'RUNTIME-DEPS-003',
          'Install lock reclaim marker publication identity changed; current marker is preserved'
        );
      }
    } catch (error) {
      if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED') {
        throw new CodedFailure(
          'RUNTIME-DEPS-003',
          'Install lock reclaim marker publication remained unknown; current marker is preserved',
          { cause: runtimeDependencyFailureEvidence(error), reclaimPath }
        );
      }
      throw error;
    }
    const reclaimObservation = observeNoFollowOwnedFile(reclaimPath, 'Install lock reclaim marker');
    if (reclaimObservation === null) {
      throw new CodedFailure('RUNTIME-DEPS-003', 'Install lock reclaim marker disappeared after exclusive publication');
    }
    reclaimMarker = Object.freeze({
      bytes: reclaimBytes,
      observation: reclaimObservation,
      owner: reclaimOwner
    });

    const lockObservation = observeNoFollowOwnedFile(lockPath, 'Install lock orphan candidate');
    if (lockObservation === null) return true;
    if (!sameNoFollowOwnedFileObservation(lockObservation, initialLockObservation)) return false;
    const owner = parseInstallLockOwner(readNoFollowOwnedFileJson(lockObservation, 'Install lock orphan candidate'));
    // Do not reopen the lock through a second path-based stat just to obtain
    // mtime/dev/ino.  The retained no-follow observation above is the only
    // deletion authority; owner.createdAt is the durable freshness field and
    // malformed records are preserved rather than guessed stale.
    if (owner === null) return false;
    if (processIsAlive(owner.pid)) return false;
    const createdAtMs = Date.parse(owner.createdAt);
    if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs < 5000) return false;

    // Delete the stale lock in place through the retained parent/name/identity
    // capability.  There is no path-only rename followed by a broad unlink,
    // so a replacement can only result in a typed preservation blocker.
    await settleInstallLockOwnedFileDeletion({
      assertExpected: (current) => {
        const currentOwner = parseInstallLockOwner(
          readNoFollowOwnedFileJson(current, 'Install lock orphan candidate retry')
        );
        if (currentOwner?.token !== owner.token) {
          throw new CodedFailure(
            'RUNTIME-DEPS-003',
            'Install lock orphan candidate bytes changed during deletion settlement; current owner is preserved'
          );
        }
      },
      expected: lockObservation,
      filePath: lockPath,
      label: 'Install lock orphan candidate',
      options
    });
    return true;
  } finally {
    if (reclaimMarker !== null) {
      const {
        bytes: reclaimBytes,
        observation: reclaimObservation,
        owner: reclaimOwner
      } = reclaimMarker;
      await settleInstallLockOwnedFileDeletion({
        assertExpected: (current) => {
          const currentOwner = readNoFollowOwnedFileJson(current, 'Install lock reclaim marker cleanup');
          if (!isInstallLockReclaimOwner(currentOwner) ||
              currentOwner.token !== reclaimOwner.token ||
              !readNoFollowOwnedFileBytes(
                current,
                'Install lock reclaim marker cleanup bytes'
              ).equals(reclaimBytes)) {
            throw new CodedFailure(
              'RUNTIME-DEPS-003',
              'Install lock reclaim marker bytes changed during deletion settlement; residue is preserved'
            );
          }
        },
        expected: reclaimObservation,
        filePath: reclaimPath,
        label: 'Install lock reclaim marker',
        options
      });
    }
  }
}

function parseInstallLockReclaimOwner(value: unknown): InstallLockReclaimOwner | null {
  return isInstallLockReclaimOwner(value) ? value : null;
}

function isLegacyInstallLockReclaimBytes(bytes: Buffer): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\r?\n$/u
    .test(bytes.toString('utf8'));
}

type InstallLockReclaimState = 'absent' | 'active' | 'terminal-handoff';

async function reclaimLockState(
  reclaimPath: string,
  lockPath: string,
  options: RuntimeDependencyOperationOptions
): Promise<InstallLockReclaimState> {
  const observation = observeNoFollowOwnedFile(reclaimPath, 'Install lock reclaim marker');
  if (observation === null) return 'absent';
  const bytes = readNoFollowOwnedFileBytes(observation, 'Install lock reclaim marker');
  const terminalHandoff = (() => {
    try {
      return parseCompilerDependencyCoordinationCutover(bytes);
    } catch {
      return null;
    }
  })();
  if (terminalHandoff !== null) {
    const pairedLock = observeNoFollowOwnedFile(lockPath, 'Install lock terminal handoff pair');
    if (pairedLock === null) return 'active';
    const pairedBytes = readNoFollowOwnedFileBytes(pairedLock, 'Install lock terminal handoff pair');
    const pairedOwner = (() => {
      try {
        return parseInstallLockOwner(JSON.parse(pairedBytes.toString('utf8')) as unknown);
      } catch {
        return null;
      }
    })();
    return pairedOwner !== null && pairedOwner.token === terminalHandoff.lockOwnerToken &&
        pairedLock.device === terminalHandoff.lock.device && pairedLock.inode === terminalHandoff.lock.inode &&
        pairedLock.size === terminalHandoff.lock.size &&
        generatedStateDigest([...pairedBytes]) === terminalHandoff.lockOwnerBytesDigest
      ? 'terminal-handoff'
      : 'active';
  }
  const owner = (() => {
    try {
      return parseInstallLockReclaimOwner(JSON.parse(bytes.toString('utf8')) as unknown);
    } catch {
      return null;
    }
  })();
  if (owner !== null) {
    if (processIsAlive(owner.pid)) return 'active';
    const createdAtMs = Date.parse(owner.createdAt);
    if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs < 5_000) return 'active';
    await settleInstallLockOwnedFileDeletion({
      assertExpected: (current) => {
        const currentOwner = readNoFollowOwnedFileJson(current, 'Install lock orphan reclaim marker');
        if (!isInstallLockReclaimOwner(currentOwner) || currentOwner.token !== owner.token) {
          throw new CodedFailure(
            'RUNTIME-DEPS-003',
            'Install lock reclaim marker owner changed; current marker is preserved'
          );
        }
      },
      expected: observation,
      filePath: reclaimPath,
      label: 'Install lock orphan reclaim marker',
      options
    });
    return 'absent';
  }

  // The former reclaim grammar persisted only a UUID.  It is never accepted
  // by the normal marker reader.  Migration may retire one exact legacy leaf
  // only after its retained identity remains stable, its filesystem age is
  // beyond the maximum lifetime of every former operation/settlement, and
  // any paired lock owner is also provably dead.  Unknown bytes remain a
  // typed preservation barrier.
  if (!isLegacyInstallLockReclaimBytes(bytes)) return 'active';
  let legacyMtimeMs: number;
  try {
    const stat = lstatSync(reclaimPath);
    if (!stat.isFile()) return 'active';
    legacyMtimeMs = stat.mtimeMs;
  } catch {
    return 'active';
  }
  const readback = observeNoFollowOwnedFile(reclaimPath, 'Legacy install lock reclaim marker readback');
  if (readback === null || !sameNoFollowOwnedFileObservation(readback, observation) ||
      !readNoFollowOwnedFileBytes(readback, 'Legacy install lock reclaim marker bytes').equals(bytes) ||
      !Number.isFinite(legacyMtimeMs) ||
      Date.now() - legacyMtimeMs < LEGACY_INSTALL_LOCK_RECLAIM_MAXIMUM_LIFETIME_MS) {
    return 'active';
  }
  const lockObservation = observeNoFollowOwnedFile(lockPath, 'Legacy install lock owner');
  if (lockObservation !== null) {
    const lockOwner = parseInstallLockOwner(
      readNoFollowOwnedFileJson(lockObservation, 'Legacy install lock owner')
    );
    const lockCreatedAtMs = lockOwner === null ? Number.NaN : Date.parse(lockOwner.createdAt);
    if (lockOwner === null || processIsAlive(lockOwner.pid) ||
        !Number.isFinite(lockCreatedAtMs) ||
        Date.now() - lockCreatedAtMs < LEGACY_INSTALL_LOCK_RECLAIM_MAXIMUM_LIFETIME_MS) {
      return 'active';
    }
  }
  await settleInstallLockOwnedFileDeletion({
    assertExpected: (current) => {
      if (!readNoFollowOwnedFileBytes(current, 'Legacy install lock reclaim marker cleanup').equals(bytes)) {
        throw new CodedFailure(
          'RUNTIME-DEPS-003',
          'Legacy install lock reclaim marker bytes changed; current marker is preserved'
        );
      }
    },
    expected: observation,
    filePath: reclaimPath,
    label: 'Legacy install lock reclaim marker migration',
    options
  });
  return 'absent';
}

class InstallLockTerminalHandoffObservedError extends Error {
  constructor(readonly lockPath: string) {
    super(`Install lock reached its terminal handoff: ${lockPath}`);
    this.name = 'InstallLockTerminalHandoffObservedError';
  }
}

function runtimeDependencyFailureEvidence(error: unknown): Readonly<{
  code: string | null;
  details: unknown;
  message: string;
  name: string;
}> {
  const value = error instanceof Error ? error : new Error(String(error));
  const code = 'code' in value && typeof value.code === 'string' ? value.code : null;
  return Object.freeze({
    code,
    details: value instanceof CodedFailure ? value.details : null,
    message: value.message.slice(0, 1_024),
    name: value.name
  });
}

type RuntimeDependencyCapturedFailure = Readonly<{ error: unknown }>;

function runtimeDependencyInstallLockSettlementFailure(input: Readonly<{
  callbackFailure?: RuntimeDependencyCapturedFailure;
  cleanupFailure?: RuntimeDependencyCapturedFailure;
  fenceFailure?: RuntimeDependencyCapturedFailure;
  lockPath: string;
}>): CodedFailure {
  return new CodedFailure(
    'RUNTIME-DEPS-003',
    'Runtime dependency install lock settlement failed; exact failure evidence is preserved',
    {
      failureOrder: Object.freeze(['primary', 'fence', 'cleanup']),
      callbackFailure: input.callbackFailure === undefined
        ? null
        : runtimeDependencyFailureEvidence(input.callbackFailure.error),
      fenceFailure: input.fenceFailure === undefined
        ? null
        : runtimeDependencyFailureEvidence(input.fenceFailure.error),
      cleanupFailure: input.cleanupFailure === undefined
        ? null
        : runtimeDependencyFailureEvidence(input.cleanupFailure.error),
      lockPath: input.lockPath
    }
  );
}

async function withInstallLock<T>(
  lockPath: string,
  options: RuntimeDependencyInstallOptions,
  callback: () => Promise<T>
): Promise<T> {
  const operationOptions = runtimeDependencyOperationOptions(options);
  const context = runtimeDependencyOperationContext(operationOptions);
  const pollIntervalMs = context.pollIntervalMs;
  const sleep = operationOptions.sleep ?? sleepMs;
  const { owner, ownerObservation } = await measureRuntimeDependencyOperationPhaseAsync(
    operationOptions,
    'lease-wait',
    async () => {
      let owner: InstallLockOwner | null = null;
      let ownerObservation: NoFollowOwnedFileObservation | null = null;

      // Every caller admits the lock below an already-created owner namespace.
      // Reopening that namespace through the no-follow chain prevents a redirected
      // parent from becoming the lease's hidden second authority.
      runtimeDependencyOperationRemainingMs(operationOptions, 'Install lock parent admission');
      inspectNoFollowDirectoryChain(path.dirname(lockPath), 'Install lock parent');

      while (true) {
        runtimeDependencyOperationRemainingMs(operationOptions, 'Install lock admission');
        const reclaimState = await reclaimLockState(`${lockPath}.reclaim`, lockPath, operationOptions);
        if (reclaimState === 'terminal-handoff') {
          throw new InstallLockTerminalHandoffObservedError(lockPath);
        }
        if (reclaimState === 'active') {
          await waitForRuntimeDependencyOperation(
            operationOptions,
            pollIntervalMs,
            sleep,
            `Waiting for install lock reclaim marker ${lockPath}`
          );
          continue;
        }
        runtimeDependencyOperationRemainingMs(operationOptions, 'Install lock publication fence');
        await operationOptions.beforeCommit?.();
        runtimeDependencyOperationRemainingMs(operationOptions, 'Install lock publication');
        owner = {
          createdAt: (operationOptions.now ?? (() => new Date().toISOString()))(),
          pid: process.pid,
          token: crypto.randomUUID()
        };
        const parent = inspectNoFollowDirectoryChain(path.dirname(lockPath), 'Install lock parent').target;
        const ownerBytes = Buffer.from(formatJsonFile(owner), 'utf8');
        try {
          publishExclusiveDurableCanonicalFile({
            parent,
            name: path.basename(lockPath),
            bytes: ownerBytes,
            validate: (bytes) => {
              const value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
              if (!isInstallLockOwner(value)) throw new Error('Install lock owner record is malformed.');
            }
          });
          runtimeDependencyOperationRemainingMs(operationOptions, 'Install lock publication readback');
        } catch (error) {
          // Only an exclusive name collision is contention. A durability
          // failure can leave our own visible lock without a durable receipt;
          // it must stop the operation even when readback observes that file.
          if (!(error instanceof PhysicalNoFollowError)
              || error.code !== 'PHYSICAL_NO_FOLLOW_EXCLUSIVE_CONFLICT') throw error;
          const existing = observeNoFollowOwnedFile(lockPath, 'Install lock contention');
          if (existing === null) {
            // Another owner can release its exact lock after our exclusive
            // publication loses the name race but before our retained census.
            continue;
          }
        }
        const current = observeNoFollowOwnedFile(lockPath, 'Install lock owner');
        if (current !== null) {
          const currentOwner = parseInstallLockOwner(readNoFollowOwnedFileJson(current, 'Install lock owner'));
          if (currentOwner?.token === owner.token) {
            ownerObservation = current;
            break;
          }
        }
        owner = null;
        ownerObservation = null;
        runtimeDependencyOperationRemainingMs(operationOptions, 'Install lock orphan recovery');
        if (await reclaimOrphanInstallLock(lockPath, operationOptions)) {
          runtimeDependencyOperationRemainingMs(operationOptions, 'Install lock orphan recovery readback');
          continue;
        }
        await waitForRuntimeDependencyOperation(
          operationOptions,
          pollIntervalMs,
          sleep,
          `Waiting for install lock ${lockPath}`
        );
      }
      return Object.freeze({ owner, ownerObservation });
    }
  );

  let callbackFailed = false;
  let callbackFailure: RuntimeDependencyCapturedFailure | undefined;
  let callbackResult!: T;
  try {
    runtimeDependencyOperationRemainingMs(operationOptions, 'Install lock callback admission');
    callbackResult = await callback();
    runtimeDependencyOperationRemainingMs(operationOptions, 'Install lock callback settlement');
  } catch (error) {
    callbackFailed = true;
    callbackFailure = Object.freeze({ error });
  }

  // Settlement is deliberately outside the operation budget: once this
  // process owns the exact token, neither an exhausted deadline nor an abort
  // may strand it.  The caller fence is still observed, but its failure cannot
  // skip the retained identity/token CAS deletion below.
  let fenceFailure: RuntimeDependencyCapturedFailure | undefined;
  try {
    await operationOptions.beforeCommit?.();
  } catch (error) {
    fenceFailure = Object.freeze({ error });
  }
  let cleanupFailure: RuntimeDependencyCapturedFailure | undefined;
  let terminalHandoff = false;
  try {
    if (owner !== null && ownerObservation !== null) {
      const terminalHandoffRequest = typeof callbackResult === 'object' && callbackResult !== null
        ? installLockTerminalHandoffRequests.get(callbackResult)
        : undefined;
      if (!callbackFailed && fenceFailure === undefined && terminalHandoffRequest !== undefined) {
        const request = terminalHandoffRequest;
        const ownerBytes = Buffer.from(formatJsonFile(owner), 'utf8');
        const unsigned = Object.freeze({
          schema: COMPILER_DEPENDENCY_COORDINATION_CUTOVER_SCHEMA,
          compilerRootPhysical: request.compilerRootPhysical,
          coordinationRootPhysical: request.coordinationRootPhysical,
          lock: Object.freeze({
            device: ownerObservation.device,
            inode: ownerObservation.inode,
            size: ownerObservation.size
          }),
          lockOwnerBytesDigest: generatedStateDigest([...ownerBytes]),
          lockOwnerToken: owner.token,
          workspaceLocatorKey: request.workspaceLocatorKey
        });
        const marker = Object.freeze({
          ...unsigned,
          cutoverDigest: generatedStateDigest(canonicalJson(unsigned))
        });
        const markerBytes = Buffer.from(formatJsonFile(canonicalJson(marker)), 'utf8');
        const markerPath = `${lockPath}.reclaim`;
        publishExclusiveDurableCanonicalFile({
          parent: inspectNoFollowDirectoryChain(path.dirname(markerPath), 'Install lock terminal handoff parent').target,
          name: path.basename(markerPath),
          bytes: markerBytes,
          validate: (candidate) => { parseCompilerDependencyCoordinationCutover(candidate); }
        });
        const readback = observeNoFollowOwnedFile(markerPath, 'Install lock terminal handoff readback');
        if (readback === null || !readNoFollowOwnedFileBytes(readback, 'Install lock terminal handoff readback')
          .equals(markerBytes)) {
          throw new CodedFailure('RUNTIME-DEPS-003', 'Install lock terminal handoff failed exact readback');
        }
        const finalLock = observeNoFollowOwnedFile(lockPath, 'Install lock terminal handoff lock readback');
        if (finalLock === null || !sameNoFollowOwnedFileObservation(finalLock, ownerObservation) ||
            !readNoFollowOwnedFileBytes(finalLock, 'Install lock terminal handoff lock readback')
              .equals(ownerBytes)) {
          throw new CodedFailure(
            'RUNTIME-DEPS-003',
            'Install lock terminal handoff changed its retained legacy lock and is preserved'
          );
        }
        terminalHandoff = true;
      }
      if (terminalHandoff) {
        installLockTerminalHandoffRequests.delete(callbackResult as object);
      } else {
      const current = observeNoFollowOwnedFile(lockPath, 'Install lock owner cleanup');
      if (current === null) {
        throw new CodedFailure(
          'RUNTIME-DEPS-003',
          'Install lock owner disappeared before exact settlement',
          { lockPath, token: owner.token }
        );
      }
      const currentOwner = parseInstallLockOwner(
        readNoFollowOwnedFileJson(current, 'Install lock owner cleanup')
      );
      if (currentOwner?.token !== owner.token) {
        throw new CodedFailure(
          'RUNTIME-DEPS-003',
          'Install lock owner changed before exact settlement; replacement is preserved',
          { lockPath, token: owner.token }
        );
      }
      await settleInstallLockOwnedFileDeletion({
        assertExpected: (observation) => {
          const currentOwner = parseInstallLockOwner(
            readNoFollowOwnedFileJson(observation, 'Install lock owner cleanup retry')
          );
          if (currentOwner?.token !== owner!.token) {
            throw new CodedFailure(
              'RUNTIME-DEPS-003',
              'Install lock owner bytes changed during deletion settlement; replacement is preserved'
            );
          }
        },
        expected: ownerObservation,
        filePath: lockPath,
        label: 'Install lock owner',
        options: operationOptions
      });
      }
    }
  } catch (error) {
    cleanupFailure = Object.freeze({ error });
  }

  if (callbackFailed) {
    if (fenceFailure !== undefined || cleanupFailure !== undefined) {
      throw runtimeDependencyInstallLockSettlementFailure({
        callbackFailure,
        cleanupFailure,
        fenceFailure,
        lockPath
      });
    }
    throw callbackFailure!.error;
  }
  if (fenceFailure !== undefined && cleanupFailure !== undefined) {
    throw runtimeDependencyInstallLockSettlementFailure({ cleanupFailure, fenceFailure, lockPath });
  }
  if (fenceFailure !== undefined) throw fenceFailure.error;
  if (cleanupFailure !== undefined) throw cleanupFailure.error;
  return callbackResult;
}

type CompilerDependencyCoordinationSession = Readonly<{
  consumers: PhysicalDirectoryIdentity;
}>;

const COMPILER_DEPENDENCY_COORDINATION_CUTOVER_SCHEMA =
  'sec-compiler-dependency-coordination-cutover-v1' as const;
const COMPILER_DEPENDENCY_COORDINATION_LOCATOR_SCHEMA =
  'sec-compiler-dependency-coordination-locator-v1' as const;
const COMPILER_DEPENDENCY_COORDINATION_CUTOVER_KEYS = Object.freeze([
  'compilerRootPhysical', 'coordinationRootPhysical', 'cutoverDigest',
  'lock', 'lockOwnerBytesDigest', 'lockOwnerToken', 'schema', 'workspaceLocatorKey'
]);

type CompilerDependencyCoordinationCutover = Readonly<{
  schema: typeof COMPILER_DEPENDENCY_COORDINATION_CUTOVER_SCHEMA;
  compilerRootPhysical: GeneratedStatePhysicalIdentity;
  coordinationRootPhysical: GeneratedStatePhysicalIdentity;
  cutoverDigest: `sha256:${string}`;
  lock: Readonly<{ device: string; inode: string; size: number }>;
  lockOwnerBytesDigest: `sha256:${string}`;
  lockOwnerToken: string;
  workspaceLocatorKey: `sha256:${string}`;
}>;

const COMPILER_DEPENDENCY_COORDINATION_LOCATOR_KEYS = Object.freeze([
  'cutoverDigest', 'locatorDigest', 'schema', 'stateRoot', 'stateRootPhysical'
]);

type CompilerDependencyCoordinationLocator = Readonly<{
  schema: typeof COMPILER_DEPENDENCY_COORDINATION_LOCATOR_SCHEMA;
  cutoverDigest: `sha256:${string}`;
  locatorDigest: `sha256:${string}`;
  stateRoot: string;
  stateRootPhysical: GeneratedStatePhysicalIdentity;
}>;

function parseCompilerDependencyCoordinationCutover(
  bytes: Uint8Array
): CompilerDependencyCoordinationCutover {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value = JSON.parse(text) as unknown;
  if (!hasExactObjectKeys(value, COMPILER_DEPENDENCY_COORDINATION_CUTOVER_KEYS)) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency coordination cutover has noncanonical keys');
  }
  const cutover = value as CompilerDependencyCoordinationCutover;
  if (cutover.schema !== COMPILER_DEPENDENCY_COORDINATION_CUTOVER_SCHEMA ||
      !isCanonicalGeneratedStatePhysicalIdentity(cutover.compilerRootPhysical) ||
      !isCanonicalGeneratedStatePhysicalIdentity(cutover.coordinationRootPhysical) ||
      !isSha256Digest(cutover.cutoverDigest) || !isSha256Digest(cutover.lockOwnerBytesDigest) ||
      !isSha256Digest(cutover.workspaceLocatorKey) || typeof cutover.lockOwnerToken !== 'string' ||
      cutover.lockOwnerToken.length === 0 || typeof cutover.lock !== 'object' || cutover.lock === null ||
      typeof cutover.lock.device !== 'string' || typeof cutover.lock.inode !== 'string' ||
      !Number.isSafeInteger(cutover.lock.size) || cutover.lock.size < 1) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency coordination cutover fields are invalid');
  }
  const { cutoverDigest: _cutoverDigest, ...unsigned } = cutover;
  if (generatedStateDigest(canonicalJson(unsigned)) !== cutover.cutoverDigest ||
      formatJsonFile(canonicalJson(cutover)) !== text) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency coordination cutover digest or bytes changed');
  }
  return Object.freeze(cutover);
}

function parseCompilerDependencyCoordinationLocator(
  bytes: Uint8Array
): CompilerDependencyCoordinationLocator {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value = JSON.parse(text) as unknown;
  if (!hasExactObjectKeys(value, COMPILER_DEPENDENCY_COORDINATION_LOCATOR_KEYS)) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency coordination locator has noncanonical keys');
  }
  const locator = value as CompilerDependencyCoordinationLocator;
  if (locator.schema !== COMPILER_DEPENDENCY_COORDINATION_LOCATOR_SCHEMA ||
      !isCanonicalAbsolutePath(locator.stateRoot) ||
      !isCanonicalGeneratedStatePhysicalIdentity(locator.stateRootPhysical) ||
      !isSha256Digest(locator.cutoverDigest) || !isSha256Digest(locator.locatorDigest)) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency coordination locator fields are invalid');
  }
  const { locatorDigest: _locatorDigest, ...unsigned } = locator;
  if (generatedStateDigest(canonicalJson(unsigned)) !== locator.locatorDigest ||
      formatJsonFile(canonicalJson(locator)) !== text) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency coordination locator digest or bytes changed');
  }
  return Object.freeze(locator);
}

function compilerDependencyCoordinationMarkerPath(compilerDependencyRoot: string): string {
  return path.join(compilerDependencyRoot, '.tmp', 'dependency-installs', 'compiler.lock.reclaim');
}

function compilerDependencyCoordinationLocatorPath(compilerDependencyRoot: string): string {
  return `${compilerDependencyCoordinationMarkerPath(compilerDependencyRoot)}.locator`;
}

function readCompilerDependencyCoordinationCutover(
  compilerDependencyRoot: string
): CompilerDependencyCoordinationCutover {
  const legacyLockPath = path.join(
    compilerDependencyRoot,
    '.tmp',
    'dependency-installs',
    'compiler.lock'
  );
  const marker = observeNoFollowOwnedFile(
    compilerDependencyCoordinationMarkerPath(compilerDependencyRoot),
    'Compiler dependency coordination cutover'
  );
  const legacyLock = observeNoFollowOwnedFile(legacyLockPath, 'Compiler dependency coordination legacy lock');
  const migrationRequired = (message: string): never => {
    throw new CodedFailure('RUNTIME-DEPS-004', message, { migrationRequired: true });
  };
  if (marker === null || legacyLock === null) {
    return migrationRequired('Compiler dependency coordination requires an explicit architecture migration');
  }
  let cutover: CompilerDependencyCoordinationCutover;
  try {
    cutover = parseCompilerDependencyCoordinationCutover(
      readNoFollowOwnedFileBytes(marker, 'Compiler dependency coordination cutover')
    );
  } catch {
    return migrationRequired('Compiler dependency coordination cutover is unknown and preserved');
  }
  const lockBytes = readNoFollowOwnedFileBytes(
    legacyLock,
    'Compiler dependency coordination legacy lock'
  );
  const lockOwner = (() => {
    try {
      return parseInstallLockOwner(JSON.parse(lockBytes.toString('utf8')) as unknown);
    } catch {
      return null;
    }
  })();
  const compilerRootPhysical = generatedStatePhysicalIdentity(inspectNoFollowDirectoryChain(
    compilerDependencyRoot,
    'Compiler dependency coordination compiler root'
  ).target);
  if (lockOwner === null || lockOwner.token !== cutover.lockOwnerToken ||
      generatedStateDigest([...lockBytes]) !== cutover.lockOwnerBytesDigest ||
      legacyLock.device !== cutover.lock.device || legacyLock.inode !== cutover.lock.inode ||
      legacyLock.size !== cutover.lock.size ||
      !sameGeneratedStateIdentity(compilerRootPhysical, cutover.compilerRootPhysical)) {
    return migrationRequired('Compiler dependency coordination cutover binding changed and is preserved');
  }
  return cutover;
}

function readCompilerDependencyCoordinationLocator(
  compilerDependencyRoot: string,
  cutover: CompilerDependencyCoordinationCutover
): CompilerDependencyCoordinationLocator {
  const migrationRequired = (message: string): never => {
    throw new CodedFailure('RUNTIME-DEPS-004', message, { migrationRequired: true });
  };
  const observation = observeNoFollowOwnedFile(
    compilerDependencyCoordinationLocatorPath(compilerDependencyRoot),
    'Compiler dependency coordination locator'
  );
  if (observation === null) {
    return migrationRequired('Compiler dependency coordination locator requires an explicit architecture migration');
  }
  let locator: CompilerDependencyCoordinationLocator;
  try {
    locator = parseCompilerDependencyCoordinationLocator(
      readNoFollowOwnedFileBytes(observation, 'Compiler dependency coordination locator')
    );
  } catch {
    return migrationRequired('Compiler dependency coordination locator is unknown and preserved');
  }
  if (locator.cutoverDigest !== cutover.cutoverDigest) {
    return migrationRequired('Compiler dependency coordination locator binding changed and is preserved');
  }
  return locator;
}

function assertCompilerDependencyCoordinationCutover(input: Readonly<{
  compilerDependencyRoot: string;
  coordinationRoot: PhysicalDirectoryIdentity;
  workspaceLocatorKey: `sha256:${string}`;
}>): void {
  const cutover = readCompilerDependencyCoordinationCutover(input.compilerDependencyRoot);
  const migrationRequired = (message: string): never => {
    throw new CodedFailure('RUNTIME-DEPS-004', message, { migrationRequired: true });
  };
  if (input.workspaceLocatorKey !== cutover.workspaceLocatorKey ||
      !sameGeneratedStateIdentity(
        generatedStatePhysicalIdentity(input.coordinationRoot),
        cutover.coordinationRootPhysical
      )) {
    return migrationRequired('Compiler dependency coordination cutover binding changed and is preserved');
  }
}

function compilerDependencyCoordinationLocatorRecord(input: Readonly<{
  cutover: CompilerDependencyCoordinationCutover;
  stateRoot: PhysicalDirectoryIdentity;
}>): CompilerDependencyCoordinationLocator {
  const unsigned = Object.freeze({
    schema: COMPILER_DEPENDENCY_COORDINATION_LOCATOR_SCHEMA,
    stateRoot: input.stateRoot.finalPath,
    stateRootPhysical: generatedStatePhysicalIdentity(input.stateRoot),
    cutoverDigest: input.cutover.cutoverDigest
  });
  return Object.freeze({
    ...unsigned,
    locatorDigest: generatedStateDigest(canonicalJson(unsigned))
  });
}

function publishCompilerDependencyCoordinationLocator(input: Readonly<{
  compilerDependencyRoot: string;
  cutover: CompilerDependencyCoordinationCutover;
  stateRoot: PhysicalDirectoryIdentity;
}>): CompilerDependencyCoordinationLocator {
  const locator = compilerDependencyCoordinationLocatorRecord(input);
  const bytes = Buffer.from(formatJsonFile(canonicalJson(locator)), 'utf8');
  const locatorPath = compilerDependencyCoordinationLocatorPath(input.compilerDependencyRoot);
  const parent = inspectNoFollowDirectoryChain(
    path.dirname(locatorPath),
    'Compiler dependency coordination locator parent'
  ).target;
  const existing = observeNoFollowOwnedFile(locatorPath, 'Compiler dependency coordination existing locator');
  if (existing !== null) {
    // Readiness calls revisit this migration boundary. Re-publishing an
    // already-bound locator creates a transient candidate in the repository,
    // even when the exclusive final name cannot change. Preserve zero-write
    // reads and fail closed on a different existing locator.
    if (!readNoFollowOwnedFileBytes(existing, 'Compiler dependency coordination existing locator').equals(bytes)) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency coordination locator binding changed and is preserved', {
        migrationRequired: true
      });
    }
  } else {
    publishExclusiveDurableCanonicalFile({
      parent,
      name: path.basename(locatorPath),
      bytes,
      validate: (candidate) => { parseCompilerDependencyCoordinationLocator(candidate); }
    });
  }
  const readback = observeNoFollowOwnedFile(locatorPath, 'Compiler dependency coordination locator readback');
  if (readback === null || !readNoFollowOwnedFileBytes(
    readback,
    'Compiler dependency coordination locator readback'
  ).equals(bytes)) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency coordination locator failed exact readback');
  }
  return locator;
}

function resolveCompilerDependencyCoordinationRoots(compilerDependencyRoot: string): Readonly<{
  cutover: CompilerDependencyCoordinationCutover;
  locator: CompilerDependencyCoordinationLocator;
  roots: ReturnType<typeof resolveSecWorkspaceRuntimeRoots>;
}> {
  const cutover = readCompilerDependencyCoordinationCutover(compilerDependencyRoot);
  const locator = readCompilerDependencyCoordinationLocator(compilerDependencyRoot, cutover);
  const roots = resolveSecWorkspaceRuntimeRoots({
    repositoryRoot: compilerDependencyRoot,
    environment: Object.freeze({ ...process.env, SEC_STATE_HOME: locator.stateRoot })
  });
  const coordinationRoot = path.join(
    roots.workspaceStateRoot,
    'compiler-dependency-coordination',
    'v1'
  );
  let stateRoot: PhysicalDirectoryIdentity;
  let coordination: PhysicalDirectoryIdentity;
  try {
    stateRoot = inspectNoFollowDirectoryChain(
      roots.stateRoot,
      'Compiler dependency coordination located Runtime State root'
    ).target;
    inspectNoFollowDirectoryChain(
      roots.workspaceStateRoot,
      'Compiler dependency coordination located workspace State root'
    );
    coordination = inspectNoFollowDirectoryChain(
      coordinationRoot,
      'Compiler dependency coordination located root'
    ).target;
    inspectNoFollowDirectoryChain(
      path.join(coordinationRoot, 'consumers'),
      'Compiler dependency coordination existing consumers'
    );
  } catch {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Compiler dependency coordination locator is unavailable and is preserved',
      { migrationRequired: true }
    );
  }
  if (roots.workspaceLocatorKey !== cutover.workspaceLocatorKey ||
      !sameHostPath(roots.stateRoot, locator.stateRoot) ||
      !sameGeneratedStateIdentity(generatedStatePhysicalIdentity(stateRoot), locator.stateRootPhysical) ||
      !sameGeneratedStateIdentity(
        generatedStatePhysicalIdentity(coordination),
        cutover.coordinationRootPhysical
      )) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Compiler dependency coordination locator does not resolve its bound Runtime State layout',
      { migrationRequired: true }
    );
  }
  return Object.freeze({ cutover, locator, roots });
}

const compilerDependencyCoordinationSessions = new WeakMap<object, CompilerDependencyCoordinationSession>();

async function withCompilerDependencyCoordinationLease<T>(
  compilerDependencyRoot: string,
  options: RuntimeDependencyInstallOptions,
  callback: (operationOptions: RuntimeDependencyOperationOptions) => Promise<T>
): Promise<T> {
  const operationOptions = runtimeDependencyOperationOptions(options);
  const root = path.resolve(compilerDependencyRoot);
  const resolved = resolveCompilerDependencyCoordinationRoots(root);
  const roots = resolved.roots;
  const coordinationRoot = path.join(
    roots.workspaceStateRoot,
    'compiler-dependency-coordination',
    'v1'
  );
  const consumersRoot = path.join(coordinationRoot, 'consumers');
  const context = runtimeDependencyOperationContext(operationOptions);
  const authority = await acquireSecRuntimeStatePhysicalAuthority({
    repositoryRoot: root,
    stateRoot: roots.stateRoot,
    cacheRoot: roots.cacheRoot,
    requiredDirectories: [roots.workspaceStateRoot, coordinationRoot, consumersRoot],
    deadlineAtUnixMs: context.deadlineAtUnixMs
  });
  let result: { value: T } | undefined;
  let primary: { error: unknown } | undefined;
  try {
    result = { value: await withInstallLock(
      path.join(coordinationRoot, 'compiler.lock'),
      operationOptions,
      async () => {
        authority.assertRootIdentityCurrent();
        const current = resolveCompilerDependencyCoordinationRoots(root);
        if (current.cutover.cutoverDigest !== resolved.cutover.cutoverDigest ||
            current.locator.locatorDigest !== resolved.locator.locatorDigest ||
            !sameGeneratedStateIdentity(
              generatedStatePhysicalIdentity(authority.stateRoot),
              current.locator.stateRootPhysical
            ) || !sameGeneratedStateIdentity(
              generatedStatePhysicalIdentity(authority.directory(coordinationRoot)),
              current.cutover.coordinationRootPhysical
            )) {
          throw new CodedFailure(
            'RUNTIME-DEPS-004',
            'Compiler dependency coordination binding changed during admission',
            { migrationRequired: true }
          );
        }
        const session = Object.freeze({ consumers: authority.directory(consumersRoot) });
        compilerDependencyCoordinationSessions.set(operationOptions, session);
        try {
          await settleCompilerDependencyConsumerCompactionIntents(session.consumers, operationOptions);
          return await callback(operationOptions);
        } finally {
          compilerDependencyCoordinationSessions.delete(operationOptions);
        }
      }
    ) };
  } catch (error) {
    primary = { error };
  }
  let releaseFailure: { error: unknown } | undefined;
  try {
    await authority.release();
  } catch (error) {
    releaseFailure = { error };
  }
  if (primary !== undefined) {
    if (releaseFailure !== undefined) {
      throw new AggregateError(
        [primary.error, releaseFailure.error],
        'Compiler dependency coordination operation and Runtime State authority settlement both failed'
      );
    }
    throw primary.error;
  }
  if (releaseFailure !== undefined) throw releaseFailure.error;
  return result!.value;
}

function compilerDependencyCoordinationSession(
  options: RuntimeDependencyOperationOptions
): CompilerDependencyCoordinationSession {
  const session = compilerDependencyCoordinationSessions.get(options);
  if (session === undefined) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Compiler dependency consumer operation has no Runtime State coordination lease'
    );
  }
  return session;
}

async function migrateCompilerDependencyCoordination(
  compilerDependencyRoot: string,
  options: RuntimeDependencyInstallOptions = {}
): Promise<boolean> {
  const operationOptions = runtimeDependencyOperationOptions(options);
  const root = path.resolve(compilerDependencyRoot);
  const ambientRoots = resolveSecWorkspaceRuntimeRoots({ repositoryRoot: root });
  const existingMarker = observeNoFollowOwnedFile(
    compilerDependencyCoordinationMarkerPath(root),
    'Compiler dependency coordination migration marker'
  );
  const existingLocator = observeNoFollowOwnedFile(
    compilerDependencyCoordinationLocatorPath(root),
    'Compiler dependency coordination migration locator'
  );
  if (existingMarker === null && existingLocator !== null) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Compiler dependency coordination locator exists without its cutover and is preserved',
      { migrationRequired: true }
    );
  }
  const roots = existingMarker !== null && existingLocator !== null
    ? resolveCompilerDependencyCoordinationRoots(root).roots
    : ambientRoots;
  const coordinationRootPath = path.join(roots.workspaceStateRoot, 'compiler-dependency-coordination', 'v1');
  const consumersRootPath = path.join(coordinationRootPath, 'consumers');
  if (existingMarker !== null && existingLocator === null) {
    const cutover = readCompilerDependencyCoordinationCutover(root);
    const coordination = inspectNoFollowDirectoryChain(
      coordinationRootPath,
      'Compiler dependency coordination existing migration root'
    ).target;
    if (roots.workspaceLocatorKey !== cutover.workspaceLocatorKey ||
        !sameGeneratedStateIdentity(generatedStatePhysicalIdentity(coordination), cutover.coordinationRootPhysical)) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency coordination migration binding changed', {
        migrationRequired: true
      });
    }
    inspectNoFollowDirectoryChain(consumersRootPath, 'Compiler dependency coordination existing migration consumers');
  }
  const authority = await acquireSecRuntimeStatePhysicalAuthority({
    repositoryRoot: root,
    stateRoot: roots.stateRoot,
    cacheRoot: roots.cacheRoot,
    requiredDirectories: [roots.workspaceStateRoot, coordinationRootPath, consumersRootPath],
    deadlineAtUnixMs: runtimeDependencyOperationContext(operationOptions).deadlineAtUnixMs
  });
  let primary: { error: unknown } | undefined;
  try {
    const compilerRootIdentity = inspectNoFollowDirectoryChain(
      root,
      'Compiler dependency coordination migration compiler root'
    ).target;
    createNoFollowOrdinaryDirectoryChain(compilerRootIdentity, ['.tmp', 'dependency-installs']);
    const coordinationRoot = authority.directory(coordinationRootPath);
    try {
      assertCompilerDependencyCoordinationCutover({
        compilerDependencyRoot: root,
        coordinationRoot,
        workspaceLocatorKey: roots.workspaceLocatorKey
      });
      const cutover = readCompilerDependencyCoordinationCutover(root);
      publishCompilerDependencyCoordinationLocator({
        compilerDependencyRoot: root,
        cutover,
        stateRoot: authority.stateRoot
      });
      readCompilerDependencyCoordinationLocator(root, cutover);
      return true;
    } catch (error) {
      const migrationRequired = error instanceof CodedFailure && typeof error.details === 'object' &&
        error.details !== null && !Array.isArray(error.details) &&
        error.details.migrationRequired === true;
      if (!migrationRequired ||
          observeNoFollowOwnedFile(path.join(root, '.tmp', 'dependency-installs', 'compiler.lock.reclaim'),
            'Compiler dependency coordination migration marker') !== null) throw error;
    }
    const legacyLockPath = path.join(root, '.tmp', 'dependency-installs', 'compiler.lock');
    let request: ReturnType<typeof issueInstallLockTerminalHandoffRequest>;
    try {
      request = await withInstallLock(legacyLockPath, operationOptions, async () => {
      await settleCompilerDependencyRecoveryUnderLease(root, operationOptions);
      const pending = await readDependencyTransition(root, operationOptions);
      if (pending !== null && pending.phase !== 'complete' && pending.phase !== 'rolled-back') {
        throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency coordination migration found nonterminal transition');
      }
      const namespace = inspectDependencyTransitionNamespace(root);
      const legacyConsumers = namespace === null ? null : inspectNoFollowDirectoryChild(namespace.journalRoot, 'consumers');
      const targetConsumers = authority.directory(consumersRootPath);
      const phases = new Map<string, Partial<Record<
        'acquired' | 'released',
        CompilerDependencyConsumerRecord
      >>>();
      const migratedRecords = new Map<string, Buffer>();
      const retainConsumerRecord = (name: string, bytes: Buffer): void => {
        if (name.includes('/')) {
          throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler consumer namespace contains nested residue');
        }
        const existingBytes = migratedRecords.get(name);
        if (existingBytes !== undefined) {
          if (!existingBytes.equals(bytes)) {
            throw new CodedFailure('RUNTIME-DEPS-004', 'Runtime State compiler consumer migration found foreign bytes');
          }
          return;
        }
        migratedRecords.set(name, Buffer.from(bytes));
        if (name.startsWith('zero-')) {
          parseCompilerDependencyConsumerZeroReceipt(bytes, name);
          return;
        }
        const record = parseCompilerDependencyConsumerRecord(bytes, name);
        const chain = phases.get(record.leaseId) ?? {};
        if (chain[record.phase] !== undefined) {
          throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency consumer chain has a duplicate phase');
        }
        chain[record.phase] = record;
        phases.set(record.leaseId, chain);
      };
      // Runtime State may already hold records published by an earlier
      // interrupted cutover. They are part of the migration preimage, not
      // foreign residue. Admit their exact bytes and validate them before
      // unioning legacy records under the same lock and physical authority.
      const existingTargetInventory = scanNoFollowDirectoryTreeInventory(targetConsumers, {
        deadlineAtMs: runtimeDependencyOperationContext(operationOptions).deadlineAtMonotonicMs,
        maximumBytes: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES,
        maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
        signal: runtimeDependencyOperationContext(operationOptions).signal
      });
      for (const entry of existingTargetInventory) {
        if (entry.kind !== 'file' || entry.relativePath.includes('/')) {
          throw new CodedFailure('RUNTIME-DEPS-004', 'Runtime State compiler consumer namespace contains unknown residue');
        }
        const bytes = readNoFollowOrdinaryFile(targetConsumers, entry.relativePath);
        if (bytes === null) {
          throw new CodedFailure('RUNTIME-DEPS-004', 'Runtime State compiler consumer record disappeared');
        }
        retainConsumerRecord(entry.relativePath, Buffer.from(bytes));
      }
      if (legacyConsumers !== null) {
        const inventory = scanNoFollowDirectoryTreeInventory(legacyConsumers, {
          deadlineAtMs: runtimeDependencyOperationContext(operationOptions).deadlineAtMonotonicMs,
          maximumBytes: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES,
          maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
          signal: runtimeDependencyOperationContext(operationOptions).signal
        });
        for (const entry of inventory) {
          if (entry.kind !== 'file' || entry.relativePath.includes('/')) {
            throw new CodedFailure('RUNTIME-DEPS-004', 'Legacy compiler consumer namespace contains unknown residue');
          }
          const bytes = readNoFollowOrdinaryFile(legacyConsumers, entry.relativePath);
          if (bytes === null) throw new CodedFailure('RUNTIME-DEPS-004', 'Legacy compiler consumer record disappeared');
          retainConsumerRecord(entry.relativePath, Buffer.from(bytes));
        }
      }
      if ([...phases.values()].some((chain) => {
        const acquired = chain.acquired;
        const released = chain.released;
        return acquired === undefined || (released !== undefined &&
          (released.previousRecordDigest !== acquired.recordDigest ||
            released.generationDigest !== acquired.generationDigest ||
            !sameHostPath(released.generationPath, acquired.generationPath) ||
            !sameGeneratedStateIdentity(released.generationPhysical, acquired.generationPhysical)));
      })) {
        throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency coordination migration found an invalid consumer chain');
      }
      // Validate the entire union before publishing any missing target record.
      // Invalid chains or conflicting preimages must not poison a resumable cutover.
      for (const [name, bytes] of migratedRecords) {
        const existing = readNoFollowOrdinaryFile(targetConsumers, name);
        if (existing !== null) {
          if (!Buffer.from(existing).equals(bytes)) {
            throw new CodedFailure('RUNTIME-DEPS-004', 'Runtime State compiler consumer migration found foreign bytes');
          }
          continue;
        }
        publishExclusiveDurableCanonicalFile({
          parent: targetConsumers,
          name,
          bytes,
          validate: (candidate) => {
            if (!Buffer.from(candidate).equals(bytes)) throw new Error('Migrated consumer bytes changed');
          }
        });
      }
      const targetInventory = scanNoFollowDirectoryTreeInventory(targetConsumers, {
        deadlineAtMs: runtimeDependencyOperationContext(operationOptions).deadlineAtMonotonicMs,
        maximumBytes: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES,
        maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
        signal: runtimeDependencyOperationContext(operationOptions).signal
      });
      if (targetInventory.length !== migratedRecords.size) {
        throw new CodedFailure('RUNTIME-DEPS-004', 'Runtime State compiler consumer migration has foreign residue');
      }
      for (const entry of targetInventory) {
        const expectedBytes = migratedRecords.get(entry.relativePath);
        const actualBytes = entry.kind === 'file' && !entry.relativePath.includes('/')
          ? readNoFollowOrdinaryFile(targetConsumers, entry.relativePath)
          : null;
        if (expectedBytes === undefined || actualBytes === null ||
            !Buffer.from(actualBytes).equals(expectedBytes)) {
          throw new CodedFailure('RUNTIME-DEPS-004', 'Runtime State compiler consumer migration readback changed');
        }
      }
        return issueInstallLockTerminalHandoffRequest({
        compilerRootPhysical: generatedStatePhysicalIdentity(inspectNoFollowDirectoryChain(
          root,
          'Compiler dependency coordination migration root'
        ).target),
        coordinationRootPhysical: generatedStatePhysicalIdentity(coordinationRoot),
        workspaceLocatorKey: roots.workspaceLocatorKey
        });
      });
    } catch (error) {
      if (!(error instanceof InstallLockTerminalHandoffObservedError) ||
          !sameHostPath(error.lockPath, legacyLockPath)) throw error;
      assertCompilerDependencyCoordinationCutover({
        compilerDependencyRoot: root,
        coordinationRoot,
        workspaceLocatorKey: roots.workspaceLocatorKey
      });
      const observedCutover = readCompilerDependencyCoordinationCutover(root);
      publishCompilerDependencyCoordinationLocator({
        compilerDependencyRoot: root,
        cutover: observedCutover,
        stateRoot: authority.stateRoot
      });
      readCompilerDependencyCoordinationLocator(root, observedCutover);
      return false;
    }
    installLockTerminalHandoffRequests.delete(request);
    const cutover = readCompilerDependencyCoordinationCutover(root);
    publishCompilerDependencyCoordinationLocator({
      compilerDependencyRoot: root,
      cutover,
      stateRoot: authority.stateRoot
    });
    readCompilerDependencyCoordinationLocator(root, cutover);
  } catch (error) {
    primary = { error };
  } finally {
    try {
      await authority.release();
    } catch (error) {
      if (primary !== undefined) {
        throw new AggregateError([primary.error, error], 'Compiler coordination migration and authority settlement failed');
      }
      throw error;
    }
  }
  if (primary !== undefined) throw primary.error;
  return false;
}

/**
 * One owner-local lease serializes every dependency transition that can
 * mutate a compiler generation or one of its projections.  It is deliberately
 * not an in-process "depth" cache: unrelated concurrent callers must wait for
 * the same physical lease instead of being mistaken for a re-entrant call and
 * racing lifecycle registration. Callers acquire this lease before any
 * shared/project lock so transition order is compiler-root -> projection-root
 * everywhere.
 */
async function withCompilerDependencyTransitionLease<T>(
  compilerDependencyRoot: string,
  options: RuntimeDependencyInstallOptions,
  callback: (operationOptions: RuntimeDependencyOperationOptions) => Promise<T>
): Promise<T> {
  const operationOptions = runtimeDependencyOperationOptions(options);
  const root = path.resolve(compilerDependencyRoot);
  // The compiler-root transition lease is the registry-owned compiler.lock;
  // do not create a second unregistered lock identity for the same owner.
  // Lease admission is the writer boundary, so it may materialize the
  // canonical lock namespace.  withInstallLock itself remains inspect-only;
  // this keeps every read/recovery path from creating directories while still
  // allowing a first compiler install to acquire its owner-local lease.
  return withCompilerDependencyCoordinationLease(root, operationOptions, async () => {
    await settleCompilerDependencyRecoveryUnderLease(root, operationOptions);
    const result = await callback(operationOptions);
    await collectReleasedCompilerDependencyGenerations(root, operationOptions);
    return result;
  });
}

async function settleCompilerDependencyRecoveryUnderLease(
  root: string,
  operationOptions: RuntimeDependencyOperationOptions
): Promise<void> {
  await measureRuntimeDependencyOperationPhaseAsync(operationOptions, 'recovery', async () => {
    // Compiler staging is born before package installation and therefore has
    // its own durable recovery intent. Recover that owner-local effect before
    // reading publication transitions; the latter deliberately begins only
    // after a valid staged binding/source generation exists.
    await recoverCompilerDependencyStageIntentRetirements(root, operationOptions);
    await migrateLegacyDependencyTransitionUnderLease(root, operationOptions);
    // A rollover is the only journal operation that can leave the canonical
    // records root absent.  Recover it while the same compiler-root lease is
    // held, before any generation, locator, runtime, or project writer reads
    // the ledger.  This keeps recovery and normal publication on one owner
    // local transition writer.
    await recoverDependencyTransitionRollover(root, operationOptions);
    const pending = await readDependencyTransition(root, operationOptions);
    await recoverCompilerDependencyStageIntents(root, operationOptions, pending);
    if (pending !== null && pending.phase !== 'complete' && pending.phase !== 'rolled-back') {
      if (pending.kind === 'compiler-generation' || pending.kind === 'compiler-local-locator' ||
          pending.kind === 'compiler-locator') {
        await recoverCompilerDependencyTransition(
          root,
          dependencyAuthorityPaths(root).compilerModulesRoot,
          await observeCompilerDependencyIdentity(root, operationOptions),
          operationOptions
        );
      } else if (pending.kind === 'compiler-bridge') {
        throw new CodedFailure(
          'RUNTIME-DEPS-004',
          'Legacy compiler-root project bridge requires an explicit architecture migration',
          { transitionDigest: pending.recordDigest, migrationRequired: true }
        );
      }
    }
    // Only after every durable stage intent and active publication journal is
    // terminal may an unrepresented registered staging root be classified as
    // legacy. Reversing this order can retire a live journal input or let an
    // unrelated unknown sibling prevent the journal's zero-effect rollback.
    await migrateRegisteredLegacyCompilerDependencyStages(root, operationOptions);
  });
}

/**
 * Perform the sole durable v1-to-v2 journal migration entry.  The caller can
 * provide only the owner root and bounded operation options; source records,
 * target records, and the migration intent are derived and authenticated by
 * this owner while holding the compiler-root lease.
 */
export async function migrateDependencyTransitionJournal(
  ownerRoot: string,
  options: RuntimeDependencyInstallOptions = {}
): Promise<void> {
  const operationOptions = selectGeneratedStateLifecycle(runtimeDependencyOperationOptions(options), ownerRoot);
  const alreadyCutOver = await migrateCompilerDependencyCoordination(ownerRoot, operationOptions);
  if (alreadyCutOver) {
    await withCompilerDependencyTransitionLease(ownerRoot, operationOptions, async () => undefined);
  }
}

export interface CompilerDependencyStageIntentRetirementReceipt {
  readonly schema: 'sec-compiler-dependency-stage-intent-retirement-v1';
  readonly ownerRoot: string;
  readonly ownerRootPhysical: GeneratedStatePhysicalIdentity;
  readonly retiredOperationKeys: readonly `sha256:${string}`[];
  readonly terminal: 'absent';
  readonly receiptDigest: `sha256:${string}`;
}

/** Close only terminal staging journals while the dependency transition owner holds its lease. */
export async function retireSettledCompilerDependencyStageIntents(
  ownerRoot: string,
  options: RuntimeDependencyInstallOptions = {}
): Promise<CompilerDependencyStageIntentRetirementReceipt> {
  ownerRoot = path.resolve(ownerRoot);
  const bound = selectGeneratedStateLifecycle(runtimeDependencyOperationOptions(options), ownerRoot);
  await migrateCompilerDependencyCoordination(ownerRoot, bound);
  // Keep the locator generation intact until the worktree-retirement provider
  // consumes it. The ordinary transition wrapper collects released generations
  // on exit, which would invalidate that later provider plan.
  return withCompilerDependencyCoordinationLease(ownerRoot, bound, async () => {
    const locked = runtimeDependencyOperationOptions(bound);
    const recoveredOperationKeys = await recoverCompilerDependencyStageIntentRetirements(ownerRoot, locked);
    await settleCompilerDependencyRecoveryUnderLease(ownerRoot, locked);
    const owner = inspectNoFollowDirectoryChain(ownerRoot, 'Compiler dependency stage retirement owner').target;
    const { active, settled } = await readCompilerDependencyStageIntents(ownerRoot, locked);
    if (active.length !== 0) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Active compiler dependency stage intent cannot be retired', {
        operationKeys: active.map(({ operationKey }) => operationKey)
      });
    }
    const transition = await readDependencyTransition(ownerRoot, locked);
    if (transition !== null && transition.phase !== 'complete' && transition.phase !== 'rolled-back') {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency stage metadata has a pending transition');
    }
    for (const intent of settled) {
      if ((await observeDependencyTransitionSlot(intent.stageRootPath)).kind !== 'absent') {
        throw new CodedFailure('RUNTIME-DEPS-004', 'Settled compiler dependency stage is present', {
          operationKey: intent.operationKey
        });
      }
      const inventory = await requireGeneratedStateLifecycle(locked).inspect([intent.relativeStagePath]);
      const registrationState = inventory.entries[0]?.registrationState;
      if (registrationState !== 'retired' && registrationState !== 'missing') {
        throw new CodedFailure('RUNTIME-DEPS-004', 'Settled compiler dependency stage registration remains active or unknown', {
          operationKey: intent.operationKey,
          registrationState: registrationState ?? null
        });
      }
    }
    const intentRoot = await compilerDependencyStageIntentRoot(ownerRoot, locked, false);
    if (intentRoot !== null) {
      for (const intent of settled) {
        const entries = [] as Array<CompilerDependencyStageRetirementIntent['entries'][number]>;
        for (const phase of ['prepared', 'disposing', 'settled'] as const) {
          const name = `stage-${intent.operationKey.slice('sha256:'.length)}-${phase}.json`;
          const entry = inspectNoFollowOrdinaryFileEntry(intentRoot, name);
          if (entry === null || entry.bytes === null) {
            throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency stage intent changed before retirement');
          }
          const current = parseCompilerDependencyStageIntent(entry.bytes, name);
          if (current.operationKey !== intent.operationKey ||
              (phase === 'settled' && current.intentDigest !== intent.intentDigest)) {
            throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency stage intent changed before retirement');
          }
          entries.push(Object.freeze({
            name,
            device: entry.device,
            inode: entry.inode,
            bytesBase64: Buffer.from(entry.bytes).toString('base64')
          }));
        }
        const material = Object.freeze({
          schema: COMPILER_DEPENDENCY_STAGE_RETIREMENT_SCHEMA,
          ownerRoot,
          ownerRootPhysical: generatedStatePhysicalIdentity(owner),
          intentRootPhysical: generatedStatePhysicalIdentity(intentRoot),
          operationKey: intent.operationKey,
          entries: Object.freeze(entries)
        });
        const marker = Object.freeze({ ...material, intentDigest: generatedStateDigest(canonicalJson(material)) });
        const markerName = compilerDependencyStageRetirementName(intent.operationKey);
        const markerBytes = Buffer.from(formatJsonFile(canonicalJson(marker)), 'utf8');
        parseCompilerDependencyStageRetirementIntent(markerBytes, markerName);
        await runtimeDependencyOperationEffectFence(locked, 'Compiler dependency stage retirement marker publication');
        writeDurableTransitionFile(
          intentRoot, markerName, markerBytes,
          assertCompilerDependencyStageRetirementIntentBytes, true
        );
        const published = inspectNoFollowOrdinaryFileEntry(intentRoot, markerName);
        if (published === null || published.bytes === null ||
            parseCompilerDependencyStageRetirementIntent(published.bytes, markerName).intentDigest !== marker.intentDigest) {
          throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency stage retirement marker publication readback differs');
        }
        await recoverCompilerDependencyStageIntentRetirements(ownerRoot, locked);
      }
      await retireEmptyCompilerDependencyStageIntentRoot(ownerRoot, locked);
    }
    const material = Object.freeze({
      schema: 'sec-compiler-dependency-stage-intent-retirement-v1' as const,
      ownerRoot,
      ownerRootPhysical: generatedStatePhysicalIdentity(owner),
      retiredOperationKeys: Object.freeze([...new Set([
        ...recoveredOperationKeys,
        ...settled.map(({ operationKey }) => operationKey)
      ])].sort(compareCodeUnits)),
      terminal: 'absent' as const
    });
    return Object.freeze({ ...material, receiptDigest: generatedStateDigest(material) });
  });
}

export function observeDependencyGeneratedStateWorkspace(workspaceRoot: string): GeneratedStatePhysicalIdentity {
  return generatedStatePhysicalIdentity(inspectNoFollowDirectoryChain(workspaceRoot, 'Dependency generated-state settlement workspace').target);
}


async function materializeIsolatedNodeModules(
  source: string,
  target: string,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  await runtimeDependencyOperationEffectFence(options, 'Isolated dependency materialization admission');
  if ((await observeDependencyTransitionSlot(target)).kind !== 'absent') {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Isolated dependency target must be absent before materialization');
  }
  await copyPhysicalTrees({
    options,
    invalidSource: (detail) => new CodedFailure(
      'RUNTIME-DEPS-004',
      detail === 'changed'
        ? 'Preinstalled dependency tree changed during materialization'
        : `Preinstalled dependency tree contains a ${detail} entry`
    ),
    roots: [{ source, target }]
  });
}

async function dependencyBridgeTargets(
  bridgePath: string,
  expectedTarget: string
): Promise<boolean> {
  try {
    const metadata = await fs.lstat(bridgePath);
    if (!metadata.isSymbolicLink()) return false;
    return sameHostPath(await fs.realpath(bridgePath), await fs.realpath(expectedTarget));
  } catch (error) {
    if (isFileNotFoundError(error)) return false;
    throw error;
  }
}

type ProjectStampObservation = Readonly<{
  present: boolean;
  stamp: RuntimeDepsStamp | null;
}>;

async function observeProjectStamp(projectRoot: string): Promise<ProjectStampObservation> {
  const root = inspectNoFollowDirectoryChain(
    projectRoot,
    'Project dependency stamp root'
  ).target;
  const entry = inspectNoFollowOrdinaryFileEntry(root, path.basename(projectStampPath(projectRoot)));
  if (entry === null || entry.bytes === null) return Object.freeze({ present: false, stamp: null });
  const stamp = await readRuntimeDepsStamp(projectStampPath(projectRoot));
  return Object.freeze({ present: true, stamp });
}

function sameRuntimeDependencyTargetIdentity(
  left: Readonly<RuntimeDependencyTargetIdentity>,
  right: Readonly<RuntimeDependencyTargetIdentity>
): boolean {
  return left.kind === right.kind && left.linkTarget === right.linkTarget &&
    sameGeneratedStateIdentity(left.physical, right.physical);
}

async function assertProjectProjectionPreimage(input: Readonly<{
  current: DependencyTransitionSlot;
  expectedBinding: Readonly<RuntimeDependencyMaterializationBinding>;
  expectedLinkTarget: string | null;
  expectedSourceGeneration?: Readonly<RuntimeDependencySourceGeneration>;
  options: RuntimeDependencyOperationOptions;
  projectRoot: string;
  runtimeSpec: RuntimeDependencySpec;
  targetPath: string;
}>): Promise<RuntimeDepsStamp | null> {
  const stampState = await observeProjectStamp(input.projectRoot);
  if (input.current.kind === 'absent') {
    if (stampState.present) {
      throw new CodedFailure(
        'RUNTIME-DEPS-004',
        'Project dependency stamp is stale while its target is absent; physical state is preserved'
      );
    }
    return null;
  }
  const stamp = stampState.stamp;
  if (stamp === null) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Project dependency target has no valid v4 stamp; physical target is preserved'
    );
  }
  if (stamp.binding.revision !== input.expectedBinding.revision ||
      !canonicalEquals(stamp.binding, input.expectedBinding) ||
      stamp.sourceGeneration.bindingDigest !== generatedStateDigest(input.expectedBinding)) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Project dependency target provenance does not match the requested binding; physical target is preserved'
    );
  }
  const expectedSourceGeneration = input.expectedSourceGeneration ?? stamp.sourceGeneration;
  let currentSource: RuntimeDependencySourceGeneration | null;
  try {
    currentSource = await runtimeDependencySourceGeneration({
      binding: input.expectedBinding,
      options: input.options,
      ownerRoot: expectedSourceGeneration.ownerRoot,
      sourcePath: expectedSourceGeneration.sourcePath
    });
  } catch (error) {
    if (!isFileNotFoundError(error)) throw error;
    currentSource = null;
  }
  if (currentSource === null || currentSource.epoch !== expectedSourceGeneration.epoch ||
      !sameRuntimeDependencySourceGenerationContent(currentSource, expectedSourceGeneration) ||
      !sameGeneratedStateIdentity(currentSource.physical, expectedSourceGeneration.physical) ||
      currentSource.epoch !== stamp.sourceGeneration.epoch ||
      !sameRuntimeDependencySourceGenerationContent(currentSource, stamp.sourceGeneration) ||
      !sameGeneratedStateIdentity(currentSource.physical, stamp.sourceGeneration.physical) ||
      !sameGeneratedStateIdentity(currentSource.ownerRootPhysical, stamp.sourceGeneration.ownerRootPhysical)) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Project dependency source generation changed before target retirement; physical target is preserved'
    );
  }
  const target = await runtimeDependencyTargetIdentity(input.targetPath);
  const exactLink = input.expectedLinkTarget === null
    ? null
    : inspectExactNoFollowLinkEntry(
        inspectNoFollowDirectoryChain(
          path.dirname(path.resolve(input.targetPath)),
          'Project dependency locator parent'
        ).target,
        path.basename(path.resolve(input.targetPath)),
        input.expectedLinkTarget
      );
  if (target === null || input.current.physical === null ||
      !sameRuntimeDependencyTargetIdentity(target, stamp.target) ||
      !sameGeneratedStateIdentity(target.physical, input.current.physical) ||
      (input.expectedLinkTarget === null
        ? target.kind !== 'directory'
        : target.kind !== 'link' || target.linkTarget === null || exactLink === null ||
          target.linkTarget !== exactLink.linkTarget)) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Project dependency target identity changed before exact retirement; physical target is preserved'
    );
  }
  // The runtime spec is intentionally part of the readback boundary. A valid
  // stamp with an otherwise incompatible closure must not be treated as
  // ownership merely because its digest happens to match one field.
  if (!await runtimeDependencyTreeMatchesBinding({
    expected: input.expectedBinding,
    nodeModulesPath: input.targetPath,
    root: path.resolve(compilerRoot),
    runtimeSpec: input.runtimeSpec
  }) && target.kind === 'directory') {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Project dependency target content no longer matches its stamped binding; physical target is preserved'
    );
  }
  return stamp;
}

type ProjectProjectionTransitionInput = Readonly<{
  binding: Readonly<RuntimeDependencyMaterializationBinding>;
  compilerDependencyRoot: string;
  isolated: boolean;
  nodeModulesPath: string;
  options: RuntimeDependencyOperationOptions;
  projectRootPath: string;
  runtimeSpec: RuntimeDependencySpec;
  sourceGeneration: Readonly<RuntimeDependencySourceGeneration>;
  sourceNodeModulesPath: string;
  stampPath: string;
}>;

async function assertProjectSourceGenerationCurrent(
  input: Pick<ProjectProjectionTransitionInput, 'binding' | 'options' | 'sourceGeneration'>
): Promise<RuntimeDependencySourceGeneration> {
  const current = await runtimeDependencySourceGeneration({
    binding: input.binding,
    options: input.options,
    ownerRoot: input.sourceGeneration.ownerRoot,
    sourcePath: input.sourceGeneration.sourcePath
  });
  if (current.epoch !== input.sourceGeneration.epoch ||
      !sameRuntimeDependencySourceGenerationContent(current, input.sourceGeneration) ||
      !sameGeneratedStateIdentity(current.physical, input.sourceGeneration.physical) ||
      !sameGeneratedStateIdentity(current.ownerRootPhysical, input.sourceGeneration.ownerRootPhysical)) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Runtime dependency source generation changed before project projection effect'
    );
  }
  return current;
}

async function deleteExactDependencyLocator(
  targetPath: string,
  expected: DependencyTransitionSlot,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  if (expected.kind !== 'link' || expected.physical === null || expected.linkTarget === null) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Project dependency locator preimage is not an exact link');
  }
  const parent = inspectNoFollowDirectoryChain(
    path.dirname(path.resolve(targetPath)),
    'Project dependency locator cleanup parent'
  ).target;
  const entry = inspectNoFollowLinkEntry(parent, path.basename(path.resolve(targetPath)));
  if (entry === null || entry.kind !== 'link' || entry.linkTarget === null ||
      entry.linkTarget !== expected.linkTarget ||
      !sameGeneratedStateIdentity(Object.freeze({
        device: entry.device,
        inode: entry.inode,
        objectId: generatedStateDigest({ kind: 'link', target: entry.linkTarget })
      }), expected.physical)) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Project dependency locator changed before exact retirement');
  }
  await runtimeDependencyOperationEffectFence(options, 'Project dependency locator retirement');
  deleteRetainedNoFollowEntry({
    root: parent,
    relativePath: path.basename(path.resolve(targetPath)),
    kind: 'link',
    device: entry.device,
    inode: entry.inode,
    expectedLinkTarget: entry.linkTarget,
    ancestorDirectories: Object.freeze([])
  });
  if ((await observeDependencyTransitionSlot(targetPath)).kind !== 'absent') {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Project dependency locator remains after exact retirement');
  }
}

async function invokeProjectProjectionHook(
  options: RuntimeDependencyInstallOptions,
  stage: 'prepared' | 'backed-up' | 'published' | 'binding-validated' | 'stamp-readback'
): Promise<void> {
  await options.testProjectProjectionHook?.(stage);
}

async function assertProjectProjectionPublished(input: Readonly<{
  binding: Readonly<RuntimeDependencyMaterializationBinding>;
  compilerDependencyRoot: string;
  isolated: boolean;
  nodeModulesPath: string;
  options: RuntimeDependencyOperationOptions;
  runtimeSpec: RuntimeDependencySpec;
  sourceGeneration: Readonly<RuntimeDependencySourceGeneration>;
  sourceNodeModulesPath: string;
}>): Promise<Readonly<{
  sourceGeneration: RuntimeDependencySourceGeneration;
  target: RuntimeDependencyTargetIdentity;
}>> {
  const sourceGeneration = await assertProjectSourceGenerationCurrent(input);
  const target = await runtimeDependencyTargetIdentity(input.nodeModulesPath);
  if (target === null || (input.isolated ? target.kind !== 'directory' : target.kind !== 'link')) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Project dependency projection published an unexpected target kind');
  }
  if (input.isolated) {
    if (!await runtimeDependencyTreeMatchesBinding({
      expected: input.binding,
      nodeModulesPath: input.nodeModulesPath,
      root: input.compilerDependencyRoot,
      runtimeSpec: input.runtimeSpec
    })) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Isolated dependency projection failed exact readback');
    }
  } else if (target.linkTarget === null ||
      !await dependencyBridgeTargets(input.nodeModulesPath, input.sourceNodeModulesPath)) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Project dependency bridge failed exact target readback');
  }
  return Object.freeze({ sourceGeneration, target });
}

async function publishProjectDependencyProjection(
  input: ProjectProjectionTransitionInput
): Promise<void> {
  const {
    binding,
    compilerDependencyRoot,
    isolated,
    nodeModulesPath,
    options,
    projectRootPath,
    runtimeSpec,
    sourceGeneration,
    sourceNodeModulesPath,
    stampPath
  } = input;
  const projectRootIdentity = inspectNoFollowDirectoryChain(
    projectRootPath,
    'Project dependency projection root'
  ).target;
  await runtimeDependencyOperationEffectFence(options, 'Project dependency staging namespace creation');
  const stagingParentIdentity = createNoFollowOrdinaryDirectoryChain(
    projectRootIdentity,
    ['.tmp']
  );
  await runtimeDependencyOperationEffectFence(options, 'Project dependency staging-root creation');
  const stagingRoot = createExclusiveNoFollowRandomDirectory(
    stagingParentIdentity,
    'project.staging-'
  ).path;
  const stagingNodeModulesPath = path.join(stagingRoot, 'node_modules');
  const stagingRootSlot = await observeDependencyTransitionSlot(stagingRoot);
  let stagingNodeModulesSlot: DependencyTransitionSlot | null = null;
  let transition: DependencyTransitionJournal | null = null;
  try {
    if (isolated) {
      await materializeIsolatedNodeModules(sourceNodeModulesPath, stagingNodeModulesPath, options);
    } else {
      await createCompilerDependencyLocator(
        stagingNodeModulesPath,
        sourceNodeModulesPath,
        sourceGeneration.physical,
        options
      );
    }
    stagingNodeModulesSlot = await observeDependencyTransitionSlot(
      stagingNodeModulesPath,
      generatedStateDigest(binding)
    );
    if (stagingNodeModulesSlot.kind === 'absent') {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Project dependency stage disappeared before durable intent');
    }
    await assertProjectSourceGenerationCurrent({ binding, options, sourceGeneration });

    const currentBeforeIntent = await observeDependencyTransitionSlot(nodeModulesPath);
    await assertProjectProjectionPreimage({
      current: currentBeforeIntent,
      expectedBinding: binding,
      expectedLinkTarget: isolated ? null : sourceNodeModulesPath,
      expectedSourceGeneration: sourceGeneration,
      options,
      projectRoot: projectRootPath,
      runtimeSpec,
      targetPath: nodeModulesPath
    });
    const namespace = await ensureDependencyTransitionNamespace(compilerDependencyRoot, options);
    const backupPath = currentBeforeIntent.kind === 'directory'
      ? path.join(
        namespace.backupRoot.path,
        `project-preimage-${generatedStateDigest({
          schema: 'sec-project-dependency-preimage-v1',
          projectRoot: projectRootPath,
          target: currentBeforeIntent,
          sourceGeneration
        }).slice('sha256:'.length, 'sha256:'.length + 32)}`
      )
      : null;
    transition = await beginDependencyTransition({
      kind: 'project-projection',
      ownerRoot: compilerDependencyRoot,
      destinationPath: nodeModulesPath,
      stagePath: stagingNodeModulesPath,
      stageRootPath: stagingRoot,
      backupPath,
      sourceGeneration,
      bindingDigest: generatedStateDigest(binding),
      options
    });
    await invokeProjectProjectionHook(options, 'prepared');

    const currentPreimage = await observeDependencyTransitionSlot(nodeModulesPath);
    if (!transitionSlotMatches(currentPreimage, transition.preimage)) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Project dependency preimage changed before backup; physical target is preserved');
    }
    await assertProjectProjectionPreimage({
      current: currentPreimage,
      expectedBinding: binding,
      expectedLinkTarget: isolated ? null : sourceNodeModulesPath,
      expectedSourceGeneration: sourceGeneration,
      options,
      projectRoot: projectRootPath,
      runtimeSpec,
      targetPath: nodeModulesPath
    });
    if (currentPreimage.kind === 'directory') {
      if (backupPath === null) throw new CodedFailure('RUNTIME-DEPS-004', 'Project dependency directory has no owned backup path');
      await renameCompilerDependencyDirectory(nodeModulesPath, backupPath, options);
    } else if (currentPreimage.kind === 'link') {
      await deleteExactDependencyLocator(nodeModulesPath, currentPreimage, options);
    }
    transition = await advanceDependencyTransition(transition, {
      destination: transitionAbsentSlot(nodeModulesPath),
      backup: backupPath === null ? null : await observeDependencyTransitionSlot(backupPath),
      phase: 'backed-up',
      durability: 'known',
      failure: null
    }, options);
    await invokeProjectProjectionHook(options, 'backed-up');

    await assertProjectSourceGenerationCurrent({ binding, options, sourceGeneration });
    if (isolated) {
      await renameCompilerDependencyDirectory(stagingNodeModulesPath, nodeModulesPath, options);
    } else {
      await renameDependencyLocator(
        stagingNodeModulesPath,
        nodeModulesPath,
        sourceNodeModulesPath,
        options
      );
    }
    transition = await advanceDependencyTransition(transition, {
      destination: await observeDependencyTransitionSlot(nodeModulesPath, generatedStateDigest(binding)),
      stage: transitionAbsentSlot(stagingNodeModulesPath),
      phase: 'published',
      durability: 'known',
      failure: null
    }, options);
    await invokeProjectProjectionHook(options, 'published');

    const validated = await assertProjectProjectionPublished({
      binding,
      compilerDependencyRoot,
      isolated,
      nodeModulesPath,
      options,
      runtimeSpec,
      sourceGeneration,
      sourceNodeModulesPath
    });
    transition = await advanceDependencyTransition(transition, {
      destination: await observeDependencyTransitionSlot(nodeModulesPath, generatedStateDigest(binding)),
      phase: 'binding-validated',
      durability: 'known',
      failure: null
    }, options);
    await invokeProjectProjectionHook(options, 'binding-validated');

    await options.beforeCommit?.();
    const stamp = Object.freeze({
      binding,
      formatVersion: 'runtime-deps-stamp-v4' as const,
      manifestHash: runtimeSpec.manifestHash,
      packageManager: 'bun' as const,
      installedAt: (options.now ?? (() => new Date().toISOString()))(),
      sourceGeneration: validated.sourceGeneration,
      target: validated.target
    });
    await writeRuntimeDepsStamp(stampPath, stamp, options.beforeCommit);
    const stampReadback = await readRuntimeDepsStamp(stampPath);
    if (stampReadback === null || !canonicalEquals(stampReadback, stamp)) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Project dependency stamp failed exact readback; recovery is required');
    }
    transition = await advanceDependencyTransition(transition, {
      destination: await observeDependencyTransitionSlot(nodeModulesPath, generatedStateDigest(binding)),
      sourceGeneration: validated.sourceGeneration,
      phase: 'stamp-readback',
      durability: 'known',
      failure: null
    }, options);
    await invokeProjectProjectionHook(options, 'stamp-readback');

    await disposeDependencyTransitionStage(
      compilerDependencyRoot,
      stagingRoot,
      runtimeDependencyOperationOptions({ ...options, generatedStateLifecycle: undefined }),
      'project-projection-published',
      transition.stage,
      transition.stageRoot,
      projectDependencyStageAuthority(projectRootPath)
    );
    transition = await advanceDependencyTransition(transition, {
      destination: await observeDependencyTransitionSlot(nodeModulesPath, generatedStateDigest(binding)),
      stage: transitionAbsentSlot(stagingNodeModulesPath),
      stageRoot: transitionAbsentSlot(stagingRoot),
      backup: transition.backup,
      phase: 'complete',
      durability: 'known',
      failure: null
    }, options);
  } catch (error) {
    if (transition !== null) {
      await markDependencyTransitionFailure(transition, error, options).catch(() => undefined);
    } else {
      await disposeDependencyTransitionStage(
        compilerDependencyRoot,
        stagingRoot,
        runtimeDependencyOperationOptions({ ...options, generatedStateLifecycle: undefined }),
        'project-projection-staging-failed',
        stagingNodeModulesSlot,
        stagingRootSlot,
        projectDependencyStageAuthority(projectRootPath)
      ).catch(() => undefined);
    }
    const cause = error instanceof Error ? error.message : String(error);
    throw new CodedFailure('RUNTIME-DEPS-004', `Project dependency projection requires recovery: ${cause}`, {
      cause,
      transitionDigest: transition?.recordDigest ?? null,
      recoveryRequired: transition !== null
    });
  }
}

function assertCompilerTransitionRecoveryTopology(
  transition: DependencyTransitionJournal,
  root: string,
  nodeModulesPath: string
): void {
  const canonicalRoot = path.resolve(root);
  const canonicalDestination = path.resolve(nodeModulesPath);
  if (transition.ownerRoot !== canonicalRoot || transition.destination.path !== canonicalDestination ||
      transition.preimage.path !== canonicalDestination) {
    throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler transition journal targets a foreign canonical path');
  }
  assertTransitionOperationKey(transition);
  const expectedBackupPath = transition.kind === 'compiler-generation'
    ? compilerTransitionBackupPath(canonicalRoot, 'node_modules', transition.sourceGeneration)
    : transition.kind === 'compiler-local-locator'
      ? compilerTransitionBackupPath(canonicalRoot, 'generation', transition.sourceGeneration)
      : transition.kind === 'compiler-locator'
      ? compilerTransitionBackupPath(canonicalRoot, 'locator-preimage', transition.sourceGeneration)
      : transition.kind === 'runtime-projection'
        ? compilerTransitionBackupPath(canonicalRoot, 'runtime', transition.sourceGeneration)
        : undefined;
  assertTransitionBackupSelector(transition, expectedBackupPath);
  if (transition.kind === 'compiler-generation') {
    if (transition.stage === null || transition.stageRoot === null) {
      throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler generation transition has no canonical staging slots');
    }
    assertDirectStageRootSelector(
      transition.stageRoot,
      path.join(canonicalRoot, '.tmp', 'dependency-installs'),
      'c.staging-'
    );
    if (transition.stage.path !== path.join(transition.stageRoot.path, 'node_modules')) {
      throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler generation transition stage is not its exact node_modules child');
    }
    if (transition.sourceGeneration.ownerRoot !== canonicalRoot ||
        (transition.sourceGeneration.sourcePath !== transition.stage.path &&
          transition.sourceGeneration.sourcePath !== canonicalDestination)) {
      throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler generation transition source path is foreign');
    }
    return;
  }
  if (transition.kind === 'compiler-local-locator') {
    if (transition.backup === null ||
        transition.sourceGeneration.ownerRoot !== canonicalRoot ||
        path.resolve(transition.sourceGeneration.sourcePath) !== path.resolve(transition.backup.path)) {
      throw new CodedFailure('IMPORT-AUTHORITY-004', 'Local compiler locator transition generation slot is foreign');
    }
    if (transition.stage !== null && transition.stageRoot !== null) {
      assertDirectStageRootSelector(
        transition.stageRoot,
        path.join(canonicalRoot, '.tmp', 'dependency-installs'),
        'c.staging-'
      );
      if (transition.stage.path !== path.join(transition.stageRoot.path, 'node_modules')) {
        throw new CodedFailure('IMPORT-AUTHORITY-004', 'Local compiler locator stage is not its exact node_modules child');
      }
    } else if (transition.stage !== null || transition.stageRoot !== null) {
      throw new CodedFailure('IMPORT-AUTHORITY-004', 'Local compiler locator staging topology is incomplete');
    }
    return;
  }
  if (transition.kind === 'compiler-locator') {
    if (transition.stage !== null || transition.stageRoot !== null ||
        transition.sourceGeneration.sourcePath === canonicalDestination ||
        sameHostPath(transition.sourceGeneration.ownerRoot, canonicalRoot) ||
        !isPathInside(
          transition.sourceGeneration.ownerRoot,
          transition.sourceGeneration.sourcePath
        )) {
      throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler locator transition topology is foreign');
    }
    return;
  }
  if (transition.kind === 'runtime-projection') {
    if (transition.stage === null || transition.stageRoot === null) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Runtime projection transition has no canonical staging slots');
    }
    const sharedRoot = dependencyAuthorityPaths(canonicalRoot).sharedDepsRoot;
    assertDirectStageRootSelector(transition.stageRoot, sharedRoot, '.runtime-generation-');
    if (transition.stage.path !== path.join(transition.stageRoot.path, 'node_modules')) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Runtime projection stage is not its exact node_modules child');
    }
    return;
  }
  if (transition.kind === 'compiler-bridge') {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Compiler bridge recovery must use its project bridge owner boundary'
    );
  }
  throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler recovery cannot consume a project transition');
}

function assertProjectTransitionRecoveryTopology(
  transition: DependencyTransitionJournal,
  input: ProjectProjectionTransitionInput
): void {
  const compilerRoot = path.resolve(input.compilerDependencyRoot);
  const target = path.resolve(input.nodeModulesPath);
  if (transition.ownerRoot !== compilerRoot || transition.destination.path !== target ||
      transition.preimage.path !== target || transition.kind !== 'project-projection') {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Project transition journal targets a foreign canonical path');
  }
  assertTransitionOperationKey(transition);
  assertTransitionBackupSelector(
    transition,
    transition.backup === null
      ? undefined
      : projectTransitionBackupPath(
        compilerRoot,
        input.projectRootPath,
        transition.preimage,
        transition.sourceGeneration
      )
  );
  if (transition.stage === null || transition.stageRoot === null) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Project transition has no canonical staging slots');
  }
  assertDirectStageRootSelector(
    transition.stageRoot,
    path.join(path.resolve(input.projectRootPath), '.tmp'),
    'project.staging-'
  );
  if (transition.stage.path !== path.join(transition.stageRoot.path, 'node_modules')) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Project transition stage is not its exact node_modules child');
  }
  if (!sameHostPath(transition.sourceGeneration.sourcePath, input.sourceNodeModulesPath)) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Project transition source generation path is foreign');
  }
}

/** Settle only a ledger-authenticated projection whose entire former fixture
 * and every operation slot have physically disappeared. The compiler ledger
 * remains the sole owner of both historical projection kinds.
 */
export async function settleAbandonedLegacyProjection(
  transition: DependencyTransitionJournal,
  ownerRoot: string,
  canonicalTarget: string,
  options: RuntimeDependencyOperationOptions
): Promise<boolean> {
  if ((transition.kind !== 'runtime-projection' && transition.kind !== 'project-projection') ||
      transition.phase !== 'recovery-required' ||
      (transition.kind === 'runtime-projection'
        ? transition.failure?.code !== 'IMPORT-AUTHORITY-004'
        : transition.failure?.code !== 'RUNTIME-DEPS-004' &&
          transition.failure?.code !== 'IMPORT-AUTHORITY-004') ||
      sameHostPath(transition.destination.path, canonicalTarget)) return false;

  const root = path.resolve(ownerRoot);
  const sourceOwnerRoot = path.resolve(transition.sourceGeneration.ownerRoot);
  const projectionRoot = path.dirname(transition.destination.path);
  const fixtureRoot = transition.kind === 'runtime-projection'
    ? path.dirname(projectionRoot) : projectionRoot;
  const ownerPhysical = generatedStatePhysicalIdentity(
    inspectNoFollowDirectoryChain(root, 'Abandoned projection owner').target
  );
  if (transition.ownerRoot !== root ||
      !sameGeneratedStateIdentity(transition.ownerRootPhysical, ownerPhysical) ||
      !sameHostPath(sourceOwnerRoot, root) ||
      !isPathInside(sourceOwnerRoot, transition.sourceGeneration.sourcePath) ||
      isPathInside(root, fixtureRoot) ||
      transition.destination.path !== path.join(projectionRoot, 'node_modules') ||
      transition.preimage.path !== transition.destination.path ||
      transition.preimage.kind !== 'absent' ||
      transition.stage === null || transition.stageRoot === null ||
      transition.stage.path !== path.join(transition.stageRoot.path, 'node_modules') ||
      (transition.kind === 'runtime-projection' &&
        (path.basename(projectionRoot) !== '.shared-deps' ||
          transition.backup === null || transition.backup.kind !== 'absent'))) {
    throw new CodedFailure('IMPORT-AUTHORITY-004', 'Abandoned projection topology is not an exact legacy fixture');
  }
  assertTransitionOperationKey(transition);
  if (transition.kind === 'runtime-projection') {
    assertDirectStageRootSelector(transition.stageRoot, projectionRoot, '.runtime-generation-');
    assertTransitionBackupSelector(
      transition,
      compilerTransitionBackupPath(root, 'runtime', transition.sourceGeneration)
    );
  } else {
    assertDirectStageRootSelector(transition.stageRoot, path.join(projectionRoot, '.tmp'), 'project.staging-');
    assertTransitionBackupSelector(
      transition,
      transition.backup === null ? undefined : projectTransitionBackupPath(
        root,
        projectionRoot,
        transition.preimage,
        transition.sourceGeneration
      )
    );
  }

  // A prepared project transition that never published any destination has
  // no source-dependent effect to recover. Authenticate its entire immutable
  // attempt chain before allowing terminal rollback without reading source.
  let noPublishedProjectEffect = false;
  if (transition.kind === 'project-projection' && transition.backup === null &&
      transition.destination.kind === 'absent') {
    const ledger = await readDependencyTransitionLedger(root, options);
    if (ledger?.tip?.recordDigest === transition.recordDigest) {
      let cursor: DependencyTransitionJournal | undefined = transition;
      while (cursor !== undefined) {
        if (cursor.kind !== 'project-projection' ||
            cursor.attemptNonce !== transition.attemptNonce ||
            cursor.operationKey !== transition.operationKey ||
            cursor.ownerRoot !== transition.ownerRoot ||
            !sameGeneratedStateIdentity(cursor.ownerRootPhysical, transition.ownerRootPhysical) ||
            cursor.destination.path !== transition.destination.path ||
            cursor.destination.kind !== 'absent' ||
            cursor.preimage.path !== transition.preimage.path ||
            cursor.preimage.kind !== 'absent' || cursor.backup !== null ||
            cursor.stage?.path !== transition.stage.path ||
            cursor.stageRoot?.path !== transition.stageRoot.path ||
            !canonicalEquals(cursor.sourceGeneration, transition.sourceGeneration)) break;
        if (cursor.phase === 'prepared') {
          noPublishedProjectEffect = true;
          break;
        }
        if (cursor.phase !== 'recovery-required' || cursor.previousRecordDigest === null) break;
        cursor = ledger.records.get(cursor.previousRecordDigest);
      }
    }
  }

  if (!noPublishedProjectEffect) {
    const sourceBinding = await compilerDependencyGenerationBinding(
      sourceOwnerRoot,
      transition.sourceGeneration.sourcePath,
      path.join(transition.sourceGeneration.sourcePath, COMPILER_DEPS_BINDING_FILE),
      await compilerDependencyIdentity(sourceOwnerRoot)
    );
    const runtimeBinding = sourceBinding?.runtimeMaterialization ?? null;
    if (runtimeBinding === null ||
        generatedStateDigest(runtimeBinding) !== transition.sourceGeneration.bindingDigest) {
      throw new CodedFailure('IMPORT-AUTHORITY-004', 'Abandoned projection source binding is not exact');
    }
    const currentSource = await runtimeDependencySourceGeneration({
      binding: runtimeBinding,
      options,
      ownerRoot: sourceOwnerRoot,
      sourcePath: transition.sourceGeneration.sourcePath
    });
    if (currentSource.epoch !== transition.sourceGeneration.epoch ||
        !sameRuntimeDependencySourceGenerationContent(currentSource, transition.sourceGeneration) ||
        !sameGeneratedStateIdentity(currentSource.physical, transition.sourceGeneration.physical) ||
        !sameGeneratedStateIdentity(currentSource.ownerRootPhysical, transition.sourceGeneration.ownerRootPhysical)) {
      throw new CodedFailure('IMPORT-AUTHORITY-004', 'Abandoned projection source generation changed');
    }
  }
  const assertAbsent = async (): Promise<void> => {
    const observed = await Promise.all([
      observeDependencyTransitionSlot(fixtureRoot),
      observeDependencyTransitionSlot(transition.destination.path),
      observeDependencyTransitionSlot(transition.stage!.path),
      observeDependencyTransitionSlot(transition.stageRoot!.path),
      transition.backup === null
        ? Promise.resolve(null)
        : observeDependencyTransitionSlot(transition.backup.path)
    ]);
    if (observed.some((slot) => slot !== null && slot.kind !== 'absent')) {
      throw new CodedFailure('IMPORT-AUTHORITY-004', 'Abandoned projection still has physical residue');
    }
  };
  await assertAbsent();
  await runtimeDependencyOperationEffectFence(options, 'Abandoned legacy projection terminal settlement');
  await assertAbsent();
  await advanceDependencyTransition(transition, {
    destination: transitionAbsentSlot(transition.destination.path),
    stage: transitionAbsentSlot(transition.stage.path),
    stageRoot: transitionAbsentSlot(transition.stageRoot.path),
    backup: transition.backup === null ? null : transitionAbsentSlot(transition.backup.path),
    phase: 'rolled-back',
    durability: 'known',
    failure: transition.failure
  }, options);
  return true;
}

async function recoverProjectDependencyTransition(
  input: ProjectProjectionTransitionInput
): Promise<void> {
  const initial = await readDependencyTransition(input.compilerDependencyRoot, input.options);
  if (initial === null || initial.kind !== 'project-projection' ||
      initial.phase === 'complete' || initial.phase === 'rolled-back') return;
  let transition = initial;
  const failRecovery = async (error: unknown): Promise<never> => {
    await markDependencyTransitionFailure(transition, error, input.options).catch(() => undefined);
    const cause = error instanceof Error ? error.message : String(error);
    throw new CodedFailure('RUNTIME-DEPS-004', `Project dependency transition requires owner recovery: ${cause}`, {
      cause,
      transitionDigest: transition.recordDigest,
      recoveryRequired: true
    });
  };
  try {
    if (await settleAbandonedLegacyProjection(
      transition,
      input.compilerDependencyRoot,
      input.nodeModulesPath,
      input.options
    )) return;
    assertProjectTransitionRecoveryTopology(initial, input);
    const owner = inspectNoFollowDirectoryChain(
      input.compilerDependencyRoot,
      'Project dependency transition owner root recovery'
    ).target;
    if (!sameGeneratedStateIdentity(
      generatedStatePhysicalIdentity(owner),
      transition.ownerRootPhysical
    )) {
      return failRecovery(new CodedFailure('RUNTIME-DEPS-004', 'Project dependency transition owner root identity changed'));
    }
    if (transition.sourceGeneration.bindingDigest !== generatedStateDigest(input.binding) ||
        transition.sourceGeneration.epoch !== input.sourceGeneration.epoch ||
        !sameRuntimeDependencySourceGenerationContent(transition.sourceGeneration, input.sourceGeneration) ||
        !sameGeneratedStateIdentity(transition.sourceGeneration.physical, input.sourceGeneration.physical) ||
        !sameGeneratedStateIdentity(transition.sourceGeneration.ownerRootPhysical, input.sourceGeneration.ownerRootPhysical)) {
      return failRecovery(new CodedFailure('RUNTIME-DEPS-004', 'Project dependency transition source generation is foreign or stale'));
    }

    const stagePath = transition.stage?.path ?? null;
    const stageRootPath = transition.stageRoot?.path ?? null;
    const backupPath = transition.backup?.path ?? null;
    let active = await observeDependencyTransitionSlot(transition.destination.path);
    let stage = stagePath === null ? null : await observeDependencyTransitionSlot(stagePath);
    let stageRoot = stageRootPath === null ? null : await observeDependencyTransitionSlot(stageRootPath);
    let backup = backupPath === null ? null : await observeDependencyTransitionSlot(backupPath);

    if (transition.stageRoot !== null &&
        (stageRoot === null || !transitionSlotMatches(stageRoot, transition.stageRoot))) {
      const alreadyDisposed = transition.stageRoot.kind === 'directory' &&
        transition.stage?.kind === 'absent' && stageRoot?.kind === 'absent' &&
        (transition.phase === 'published' || transition.phase === 'binding-validated' ||
          transition.phase === 'stamp-readback' || transition.phase === 'recovery-required');
      if (!alreadyDisposed) {
        return failRecovery(new CodedFailure('RUNTIME-DEPS-004', 'Project dependency staging root identity changed and is preserved'));
      }
    }

    if (transition.backup !== null) {
      if (transition.backup.kind === 'absent') {
        if (backup === null || backup.kind !== 'absent') {
          return failRecovery(new CodedFailure('RUNTIME-DEPS-004', 'Foreign project dependency backup is preserved'));
        }
      } else if (backup === null || !transitionSlotMatches(backup, transition.backup)) {
        return failRecovery(new CodedFailure('RUNTIME-DEPS-004', 'Project dependency backup identity changed and is preserved'));
      }
    }

    const expectedLinkTarget = input.isolated ? null : input.sourceNodeModulesPath;
    const preimageMatches = transitionSlotMatches(active, transition.preimage);
    if (transition.phase === 'prepared' ||
        (transition.phase === 'recovery-required' && transition.destination.kind === transition.preimage.kind &&
          preimageMatches)) {
      if (!preimageMatches) {
        if (active.kind !== 'absent' || transition.preimage.kind === 'absent' ||
            backup === null || backup.kind !== 'directory' ||
            transition.backup === null || !transitionSlotMatches(backup, transition.backup)) {
          return failRecovery(new CodedFailure('RUNTIME-DEPS-004', 'Project dependency preimage topology is unknown and preserved'));
        }
      } else {
        await assertProjectProjectionPreimage({
          current: active,
          expectedBinding: input.binding,
          expectedLinkTarget,
          expectedSourceGeneration: input.sourceGeneration,
          options: input.options,
          projectRoot: input.projectRootPath,
          runtimeSpec: input.runtimeSpec,
          targetPath: input.nodeModulesPath
        });
        if (active.kind === 'directory') {
          if (backupPath === null) return failRecovery(new CodedFailure('RUNTIME-DEPS-004', 'Project dependency preimage has no operation-owned backup'));
          await renameCompilerDependencyDirectory(input.nodeModulesPath, backupPath, input.options);
        } else if (active.kind === 'link') {
          await deleteExactDependencyLocator(input.nodeModulesPath, active, input.options);
        }
        active = await observeDependencyTransitionSlot(input.nodeModulesPath);
        backup = backupPath === null ? null : await observeDependencyTransitionSlot(backupPath);
        transition = await advanceDependencyTransition(transition, {
          destination: transitionAbsentSlot(input.nodeModulesPath),
          backup,
          phase: 'backed-up',
          durability: 'known',
          failure: null
        }, input.options);
      }
    }

    active = await observeDependencyTransitionSlot(input.nodeModulesPath);
    stage = stagePath === null ? null : await observeDependencyTransitionSlot(stagePath);
    if (transition.phase === 'backed-up' || transition.phase === 'recovery-required' ||
        transition.phase === 'prepared') {
      if (active.kind === 'absent' && stage !== null && stage.kind !== 'absent') {
        await assertProjectSourceGenerationCurrent({
          binding: input.binding,
          options: input.options,
          sourceGeneration: input.sourceGeneration
        });
        if (input.isolated) {
          if (stage.kind !== 'directory') return failRecovery(new CodedFailure('RUNTIME-DEPS-004', 'Project dependency staged directory is foreign and preserved'));
          await renameCompilerDependencyDirectory(stagePath!, input.nodeModulesPath, input.options);
        } else {
          if (stage.kind !== 'link') return failRecovery(new CodedFailure('RUNTIME-DEPS-004', 'Project dependency staged bridge is foreign and preserved'));
          await renameDependencyLocator(stagePath!, input.nodeModulesPath, input.sourceNodeModulesPath, input.options);
        }
        active = await observeDependencyTransitionSlot(input.nodeModulesPath, generatedStateDigest(input.binding));
        stage = await observeDependencyTransitionSlot(stagePath!);
        transition = await advanceDependencyTransition(transition, {
          destination: active,
          stage,
          stageRoot,
          phase: 'published',
          durability: 'known',
          failure: null
        }, input.options);
      } else if (active.kind !== 'absent') {
        if (transition.destination.kind !== 'absent' &&
            !transitionSlotMatches(active, transition.destination)) {
          return failRecovery(new CodedFailure('RUNTIME-DEPS-004', 'Project dependency published target identity is foreign and preserved'));
        }
        if (transition.destination.kind === 'absent' &&
            (transition.phase !== 'recovery-required' || stage === null || stage.kind === 'absent')) {
          return failRecovery(new CodedFailure('RUNTIME-DEPS-004', 'Project dependency target appeared without a durable publish receipt'));
        }
      } else if (transition.phase !== 'recovery-required') {
        return failRecovery(new CodedFailure('RUNTIME-DEPS-004', 'Project dependency transition has no staged or active target'));
      }
    }

    active = await observeDependencyTransitionSlot(input.nodeModulesPath, generatedStateDigest(input.binding));
    if (active.kind === 'absent') {
      return failRecovery(new CodedFailure('RUNTIME-DEPS-004', 'Project dependency transition has no recoverable target'));
    }
    if (transition.destination.kind !== 'absent' && !transitionSlotMatches(active, transition.destination)) {
      return failRecovery(new CodedFailure('RUNTIME-DEPS-004', 'Project dependency destination identity changed and is preserved'));
    }
    const validated = await assertProjectProjectionPublished({
      binding: input.binding,
      compilerDependencyRoot: input.compilerDependencyRoot,
      isolated: input.isolated,
      nodeModulesPath: input.nodeModulesPath,
      options: input.options,
      runtimeSpec: input.runtimeSpec,
      sourceGeneration: input.sourceGeneration,
      sourceNodeModulesPath: input.sourceNodeModulesPath
    });
    transition = await advanceDependencyTransition(transition, {
      destination: await observeDependencyTransitionSlot(input.nodeModulesPath, generatedStateDigest(input.binding)),
      stage: stagePath === null ? null : await observeDependencyTransitionSlot(stagePath),
      stageRoot,
      phase: 'binding-validated',
      durability: 'known',
      failure: null
    }, input.options);

    const stampState = await observeProjectStamp(input.projectRootPath);
    if (stampState.stamp !== null &&
        stampState.stamp.binding.revision !== input.binding.revision) {
      return failRecovery(new CodedFailure('RUNTIME-DEPS-004', 'Foreign project dependency stamp is preserved'));
    }
    const stamp = Object.freeze({
      binding: input.binding,
      formatVersion: 'runtime-deps-stamp-v4' as const,
      manifestHash: input.runtimeSpec.manifestHash,
      packageManager: 'bun' as const,
      installedAt: stampState.stamp?.binding.revision === input.binding.revision
        ? stampState.stamp.installedAt
        : (input.options.now ?? (() => new Date().toISOString()))(),
      sourceGeneration: validated.sourceGeneration,
      target: validated.target
    });
    if (stampState.stamp === null || !canonicalEquals(stampState.stamp, stamp)) {
      await writeRuntimeDepsStamp(input.stampPath, stamp, input.options.beforeCommit);
    }
    const stampReadback = await readRuntimeDepsStamp(input.stampPath);
    if (stampReadback === null || !canonicalEquals(stampReadback, stamp)) {
      return failRecovery(new CodedFailure('RUNTIME-DEPS-004', 'Recovered project dependency stamp failed exact readback'));
    }
    transition = await advanceDependencyTransition(transition, {
      destination: await observeDependencyTransitionSlot(input.nodeModulesPath, generatedStateDigest(input.binding)),
      sourceGeneration: validated.sourceGeneration,
      phase: 'stamp-readback',
      durability: 'known',
      failure: null
    }, input.options);
    if (stagePath !== null) {
      await disposeDependencyTransitionStage(
        input.compilerDependencyRoot,
        path.dirname(stagePath),
        runtimeDependencyOperationOptions({ ...input.options, generatedStateLifecycle: undefined }),
        'project-projection-recovered',
        transition.stage,
        transition.stageRoot,
        projectDependencyStageAuthority(input.projectRootPath)
      );
    }
    await advanceDependencyTransition(transition, {
      destination: await observeDependencyTransitionSlot(input.nodeModulesPath, generatedStateDigest(input.binding)),
      stage: stagePath === null ? null : transitionAbsentSlot(stagePath),
      stageRoot: stageRootPath === null ? null : transitionAbsentSlot(stageRootPath),
      backup: transition.backup,
      phase: 'complete',
      durability: 'known',
      failure: null
    }, input.options);
  } catch (error) {
    return failRecovery(error);
  }
}

type CompilerDependencyBridgeSourceObservation = Readonly<{
  binding: Readonly<CompilerDepsBinding>;
  ownerRoot: string;
  sourceGeneration: Readonly<RuntimeDependencySourceGeneration>;
  sourcePath: string;
}>;

type CompilerDependencyBridgeRecoveryBinding = Readonly<{
  bunVersion: string;
  declaredBunVersion: string;
  value: Readonly<Record<string, unknown>>;
}>;

type CompilerDependencyBridgeRecoverySourceObservation = Readonly<{
  binding: CompilerDependencyBridgeRecoveryBinding;
  ownerRoot: string;
  sourceGeneration: Readonly<RuntimeDependencySourceGeneration>;
  sourcePath: string;
}>;

/**
 * Reconstructs bridge provenance from the canonical compiler generation.  A
 * bridge journal never treats its caller-supplied source path or a link's
 * current realpath as authority: the owner root, binding, tree digest and
 * source physical identity are all rebuilt before a bridge effect or
 * recovery effect is admitted.
 */
async function compilerDependencyBridgeSourceObservation(
  consumerRootInput: string,
  sourceOwnerRootInput: string,
  sourcePath: string,
  options: RuntimeDependencyOperationOptions,
  expected?: Readonly<RuntimeDependencySourceGeneration>
): Promise<CompilerDependencyBridgeSourceObservation> {
  const consumerRoot = path.resolve(consumerRootInput);
  const ownerRoot = path.resolve(sourceOwnerRootInput);
  const absoluteSourcePath = path.resolve(sourcePath);
  const canonicalNodeModulesPath = dependencyAuthorityPaths(consumerRoot).compilerModulesRoot;
  const currentGenerationPath = path.resolve(await fs.realpath(canonicalNodeModulesPath));
  if (!isPathInside(ownerRoot, absoluteSourcePath) ||
      !sameHostPath(currentGenerationPath, absoluteSourcePath)) {
    throw new CodedFailure(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency bridge source is not the current canonical node_modules generation'
    );
  }
  const ownerIdentity = await compilerDependencyIdentity(consumerRoot);
  const binding = await compilerDependencyGenerationBinding(
    consumerRoot,
    absoluteSourcePath,
    path.join(absoluteSourcePath, COMPILER_DEPS_BINDING_FILE),
    ownerIdentity
  );
  if (binding === null) {
    throw new CodedFailure(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency bridge source has no current canonical generation binding'
    );
  }
  const sourceGeneration = await runtimeDependencySourceGeneration({
    binding,
    options,
    ownerRoot,
    sourcePath: absoluteSourcePath
  });
  if (expected !== undefined && (
    sourceGeneration.ownerRoot !== path.resolve(expected.ownerRoot) ||
    !sameGeneratedStateIdentity(sourceGeneration.ownerRootPhysical, expected.ownerRootPhysical) ||
    sourceGeneration.sourcePath !== path.resolve(expected.sourcePath) ||
    generatedStateDigest(binding) !== expected.bindingDigest ||
    sourceGeneration.epoch !== expected.epoch ||
    sourceGeneration.treeDigest !== expected.treeDigest ||
    sourceGeneration.treeEntryCount !== expected.treeEntryCount ||
    !sameGeneratedStateIdentity(sourceGeneration.physical, expected.physical)
  )) {
    throw new CodedFailure(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency bridge source generation changed and is preserved'
    );
  }
  return Object.freeze({
    binding,
    ownerRoot,
    sourceGeneration,
    sourcePath: absoluteSourcePath
  });
}

/**
 * Re-observe an already-issued bridge source for recovery without admitting a
 * new compiler materialization.  The immutable transition binds the exact
 * binding object, source tree, owner/source physical identities and epoch;
 * recovery proves those persisted facts directly.  In particular it must not
 * call compilerDependencyIdentity(): the current Bun/packageManager identity
 * authorizes a new install, not settlement of an older durable effect.
 */
async function compilerDependencyBridgeRecoverySourceObservation(
  ownerRootInput: string,
  expected: Readonly<RuntimeDependencySourceGeneration>,
  options: RuntimeDependencyOperationOptions
): Promise<CompilerDependencyBridgeRecoverySourceObservation> {
  const ownerRoot = path.resolve(ownerRootInput);
  const absoluteSourcePath = path.resolve(expected.sourcePath);
  const canonicalNodeModulesPath = dependencyAuthorityPaths(ownerRoot).compilerModulesRoot;
  const currentGenerationPath = path.resolve(await fs.realpath(canonicalNodeModulesPath));
  if (expected.ownerRoot !== ownerRoot ||
      !sameGeneratedStateIdentity(expected.ownerRootPhysical, inspectNoFollowDirectoryChain(
        ownerRoot,
        'Compiler dependency bridge recovery owner root'
      ).target) ||
      !isPathInside(ownerRoot, absoluteSourcePath) ||
      !sameHostPath(currentGenerationPath, absoluteSourcePath)) {
    throw new CodedFailure(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency bridge recovery source is outside its persisted owner topology'
    );
  }
  runtimeDependencyOperationRemainingMs(options, 'Compiler dependency bridge recovery binding admission');
  const bindingValue = parseExactJson(
    await readPhysicalControlText(path.join(absoluteSourcePath, COMPILER_DEPS_BINDING_FILE)),
    'Compiler dependency bridge recovery binding',
    { rootObjectKeys: COMPILER_DEPS_BINDING_KEYS },
    64
  );
  if (bindingValue === null || typeof bindingValue !== 'object' || Array.isArray(bindingValue) ||
      Object.getPrototypeOf(bindingValue) !== Object.prototype) {
    throw new CodedFailure(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency bridge recovery binding is not one exact object'
    );
  }
  const bindingRecord = bindingValue as Record<string, unknown>;
  const bunVersion = bindingRecord.bunVersion;
  const declaredBunVersion = bindingRecord.declaredBunVersion;
  const observedBindingDigest = generatedStateDigest(bindingRecord);
  if (bindingRecord.formatVersion !== 'compiler-deps-binding-v5' ||
      typeof bunVersion !== 'string' || bunVersion.length === 0 ||
      typeof declaredBunVersion !== 'string' || declaredBunVersion.length === 0 ||
      observedBindingDigest !== expected.bindingDigest) {
    throw new CodedFailure(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency bridge recovery binding differs from the persisted generation',
      {
        expectedBindingDigest: expected.bindingDigest,
        observedBindingDigest
      }
    );
  }
  const binding: CompilerDependencyBridgeRecoveryBinding = Object.freeze({
    bunVersion,
    declaredBunVersion,
    value: Object.freeze(bindingRecord)
  });
  const sourceGeneration = await runtimeDependencySourceGeneration({
    binding: binding.value,
    options,
    ownerRoot,
    sourcePath: absoluteSourcePath
  });
  if (sourceGeneration.epoch !== expected.epoch ||
      sourceGeneration.treeDigest !== expected.treeDigest ||
      sourceGeneration.treeEntryCount !== expected.treeEntryCount ||
      !sameGeneratedStateIdentity(sourceGeneration.ownerRootPhysical, expected.ownerRootPhysical) ||
      !sameGeneratedStateIdentity(sourceGeneration.physical, expected.physical)) {
    throw new CodedFailure(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency bridge recovery source generation changed and is preserved'
    );
  }
  return Object.freeze({
    binding,
    ownerRoot,
    sourceGeneration,
    sourcePath: absoluteSourcePath
  });
}

function isCurrentBunIdentityOnlyRecoveryFailure(
  transition: DependencyTransitionJournal,
  binding: CompilerDependencyBridgeRecoveryBinding,
  predecessor: DependencyTransitionJournal | undefined
): boolean {
  if (transition.phase !== 'recovery-required' ||
      transition.failure?.code !== 'IMPORT-AUTHORITY-001' ||
      predecessor === undefined ||
      transition.previousRecordDigest !== predecessor.recordDigest ||
      predecessor.operationKey !== transition.operationKey ||
      predecessor.phase !== 'prepared' || predecessor.failure !== null ||
      predecessor.durability !== 'known' || predecessor.destination.kind !== 'absent') return false;
  const match = /^Bun runtime identity mismatch: canonical=([^,\s]+), packageManager=([^,\s]+), actual=([^,\s]+)$/u
    .exec(transition.failure.message);
  if (match === null) return false;
  const [, canonical, packageManager, actual] = match;
  return canonical === packageManager &&
    canonical === binding.declaredBunVersion &&
    canonical === binding.bunVersion &&
    actual !== canonical;
}

function assertCompilerDependencyBridgeTransitionTopology(
  transition: DependencyTransitionJournal,
  compilerDependencyRoot: string,
  bridgeConsumerRoot: string,
  bridgePath: string
): void {
  const ownerRoot = path.resolve(bridgeConsumerRoot);
  const sourceOwnerRoot = path.resolve(compilerDependencyRoot);
  const destination = path.resolve(bridgePath);
  if (transition.kind !== 'project-runtime-bridge' ||
      transition.ownerRoot !== ownerRoot ||
      transition.destination.path !== destination ||
      transition.preimage.path !== destination ||
      transition.preimage.kind !== 'absent' ||
      transition.stage !== null || transition.stageRoot !== null || transition.backup !== null ||
      transition.sourceGeneration.ownerRoot !== sourceOwnerRoot ||
      !isPathInside(sourceOwnerRoot, transition.sourceGeneration.sourcePath) ||
      path.resolve(destination) === path.resolve(transition.sourceGeneration.sourcePath)) {
    throw new CodedFailure(
      'IMPORT-AUTHORITY-004',
      'Compiler bridge transition journal targets a foreign canonical topology'
    );
  }
  assertTransitionOperationKey(transition);
}

function compilerDependencyBridgeLinkMatches(
  bridgePath: string,
  source: Readonly<Pick<CompilerDependencyBridgeSourceObservation, 'sourceGeneration' | 'sourcePath'>>,
  expected?: DependencyTransitionSlot
): boolean {
  const bridgeRoot = path.dirname(path.resolve(bridgePath));
  const bridgeName = path.basename(path.resolve(bridgePath));
  const bridge = inspectExactNoFollowLinkEntry(
    inspectNoFollowDirectoryChain(bridgeRoot, 'Compiler dependency bridge consumer root').target,
    bridgeName,
    source.sourcePath
  );
  if (bridge === null || bridge.kind !== 'link' || bridge.linkTarget === null) return false;
  if (expected !== undefined) {
    const observed = transitionSlotFromPhysical({
      path: bridgePath,
      kind: 'link',
      physical: Object.freeze({
        device: bridge.device,
        inode: bridge.inode,
        objectId: generatedStateDigest({ kind: 'link', target: bridge.linkTarget })
      }),
      linkTarget: bridge.linkTarget,
      bindingDigest: expected.bindingDigest
    });
    if (!transitionSlotMatches(observed, expected)) return false;
  }
  return true;
}

async function recoverCompilerDependencyBridgeTransition(
  compilerDependencyRoot: string,
  bridgeConsumerRoot: string,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const ownerRoot = path.resolve(bridgeConsumerRoot);
  const bridgePath = path.join(ownerRoot, 'node_modules');
  const initialLedger = await readDependencyTransitionLedger(ownerRoot, options);
  const initial = initialLedger?.tip ?? null;
  if (initial === null || initial.phase === 'complete' || initial.phase === 'rolled-back') return;
  if (initial.kind !== 'project-runtime-bridge') {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Compiler bridge recovery found another active compiler transition; residue is preserved'
    );
  }
  let transition = initial;
  let issuedRecoveryFailure: CodedFailure | null = null;
  const failRecovery = async (error: unknown): Promise<never> => {
    // A recovery-required record is already the durable failure evidence. A
    // retry may either settle that exact failure or preserve it; it must not
    // grow a new journal record merely because the same blocker was observed
    // again. First-time recovery failures are still journaled below.
    if (transition.phase !== 'recovery-required') {
      await markDependencyTransitionFailure(transition, error, options).catch(() => undefined);
    }
    issuedRecoveryFailure = new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency bridge requires owner recovery', {
      cause: error instanceof Error ? error.message : String(error),
      causeDetails: error instanceof CodedFailure ? error.details : null,
      existingFailure: transition.failure,
      transitionDigest: transition.recordDigest,
      recoveryRequired: true
    });
    throw issuedRecoveryFailure;
  };

  try {
    assertCompilerDependencyBridgeTransitionTopology(
      transition,
      compilerDependencyRoot,
      ownerRoot,
      bridgePath
    );
    const ownerIdentity = inspectNoFollowDirectoryChain(
      ownerRoot,
      'Compiler dependency bridge owner root recovery'
    ).target;
    if (!sameGeneratedStateIdentity(
      generatedStatePhysicalIdentity(ownerIdentity),
      transition.ownerRootPhysical
    )) {
      return failRecovery(new CodedFailure(
        'IMPORT-AUTHORITY-004',
        'Compiler dependency bridge owner root identity changed'
      ));
    }
    const source = await compilerDependencyBridgeRecoverySourceObservation(
      compilerDependencyRoot,
      transition.sourceGeneration,
      options
    ).catch((error) => failRecovery(error));
    const recoveryPredecessor = transition.previousRecordDigest === null
      ? undefined
      : initialLedger?.records.get(transition.previousRecordDigest);
    if (transition.phase === 'recovery-required' &&
        !isCurrentBunIdentityOnlyRecoveryFailure(
          transition,
          source.binding,
          recoveryPredecessor
        )) {
      return failRecovery(new CodedFailure(
        'IMPORT-AUTHORITY-004',
        'Compiler dependency bridge recovery-required failure is not the retired current-Bun admission premise'
      ));
    }
    let bridge = await observeDependencyTransitionSlot(bridgePath, transition.sourceGeneration.bindingDigest);
    const bridgeMatches = (): boolean => compilerDependencyBridgeLinkMatches(
      bridgePath,
      source,
      transition.phase === 'prepared' || transition.phase === 'recovery-required'
        ? undefined
        : transition.destination
    );

    if (transition.phase === 'prepared') {
      if (bridge.kind === 'absent') {
        transition = await advanceDependencyTransition(transition, {
          destination: transitionAbsentSlot(bridgePath),
          phase: 'rolled-back',
          durability: 'known',
          failure: null
        }, options);
        return;
      }
      if (bridge.kind !== 'link' || !bridgeMatches()) {
        return failRecovery(new CodedFailure(
          'IMPORT-AUTHORITY-004',
          'Compiler dependency bridge contains a foreign pre-effect target and is preserved'
        ));
      }
      bridge = await observeDependencyTransitionSlot(bridgePath, transition.sourceGeneration.bindingDigest);
      transition = await advanceDependencyTransition(transition, {
        destination: bridge,
        phase: 'published',
        durability: 'known',
        failure: null
      }, options);
    }

    if (transition.phase !== 'published' && transition.phase !== 'recovery-required') {
      return failRecovery(new CodedFailure(
        'IMPORT-AUTHORITY-004',
        `Compiler dependency bridge has unsupported recovery phase ${transition.phase}`
      ));
    }
    bridge = await observeDependencyTransitionSlot(bridgePath, transition.sourceGeneration.bindingDigest);
    if (bridge.kind === 'absent') {
      transition = await advanceDependencyTransition(transition, {
        destination: transitionAbsentSlot(bridgePath),
        phase: 'rolled-back',
        durability: 'known',
        failure: null
      }, options);
      return;
    }
    if (bridge.kind !== 'link' || !bridgeMatches()) {
      return failRecovery(new CodedFailure(
        'IMPORT-AUTHORITY-004',
        'Compiler dependency bridge recovery target is foreign and preserved'
      ));
    }
    const locator = compilerDependencyLocatorObservation(
      path.resolve(bridgeConsumerRoot),
      'node_modules'
    );
    if (locator === null) {
      return failRecovery(new CodedFailure(
        'IMPORT-AUTHORITY-004',
        'Compiler dependency bridge locator disappeared before exact cleanup'
      ));
    }
    await deleteExactCompilerDependencyLocator(path.resolve(bridgeConsumerRoot), locator, options);
    const after = await observeDependencyTransitionSlot(bridgePath);
    if (after.kind !== 'absent') {
      return failRecovery(new CodedFailure(
        'IMPORT-AUTHORITY-004',
        'Compiler dependency bridge cleanup failed exact absence readback'
      ));
    }
    await options.beforeCommit?.();
    await advanceDependencyTransition(transition, {
      destination: after,
      phase: 'rolled-back',
      durability: 'known',
      failure: null
    }, options);
  } catch (error) {
    if (error === issuedRecoveryFailure) throw error;
    return failRecovery(error);
  }
}

async function assertNoLegacyCompilerBridgeRecovery(
  compilerDependencyRoot: string,
  bridgePath: string,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const legacy = (await readDependencyTransitionLedger(
    compilerDependencyRoot,
    options
  ))?.tip ?? null;
  if (legacy !== null && legacy.kind === 'compiler-bridge' &&
      legacy.phase !== 'complete' && legacy.phase !== 'rolled-back' &&
      path.resolve(legacy.destination.path) === path.resolve(bridgePath)) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Legacy compiler-root project bridge requires an explicit architecture migration',
      { transitionDigest: legacy.recordDigest, migrationRequired: true }
    );
  }
}

async function withProjectDependencyBridgeLease<T>(
  projectRoot: string,
  options: RuntimeDependencyOperationOptions,
  callback: (lockedOptions: RuntimeDependencyOperationOptions) => Promise<T>
): Promise<T> {
  const root = path.resolve(projectRoot);
  await runtimeDependencyOperationEffectFence(options, 'Project runtime bridge lease namespace admission');
  const owner = inspectNoFollowDirectoryChain(root, 'Project runtime bridge owner root').target;
  createNoFollowOrdinaryDirectoryChain(owner, ['.tmp', 'dependency-installs']);
  await runtimeDependencyOperationEffectFence(options, 'Project runtime bridge lease namespace readback');
  return withInstallLock(
    path.join(root, '.tmp', 'dependency-installs', 'project-runtime.lock'),
    options,
    () => callback(options)
  );
}

export async function withProjectDependencyBridge<T>(
  projectRoot: string,
  callback: () => Promise<T>,
  options: RuntimeDependencyInstallOptions = {}
): Promise<T> {
  const operationOptions = runtimeDependencyOperationOptions(options);
  const consumerRoot = path.resolve(projectRoot);
  const bridgePath = path.join(consumerRoot, 'node_modules');
  const compilerDependencyRoot = path.resolve(compilerRoot);
  await assertNoLegacyCompilerBridgeRecovery(compilerDependencyRoot, bridgePath, operationOptions);
  const authority = await observeCompilerDependencyExecutionGenerationAuthority(
    operationOptions,
    compilerDependencyRoot
  );
  if (authority === null) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency bridge source is unavailable');
  }
  const authorityRecord = compilerDependencyExecutionGenerationAuthorities.get(authority)!;
  const retained = await retainCompilerDependencyReadGeneration(authority, {
    deadlineAtUnixMs: runtimeDependencyOperationContext(operationOptions).deadlineAtUnixMs,
    signal: runtimeDependencyOperationContext(operationOptions).signal
  });
  let outcome: { value: T } | undefined;
  let primary: { error: unknown } | undefined;
  try {
    const source = await compilerDependencyBridgeSourceObservation(
      authorityRecord.root,
      authorityRecord.sourceGeneration.ownerRoot,
      authorityRecord.sourceGeneration.sourcePath,
      operationOptions,
      authorityRecord.sourceGeneration
    );
    outcome = { value: await withProjectDependencyBridgeLease(consumerRoot, operationOptions, async (lockedOptions) => {
    await recoverCompilerDependencyBridgeTransition(
      compilerDependencyRoot,
      consumerRoot,
      lockedOptions
    );
    await retained.physicalGeneration.assertAuthorityCurrent();
    const existing = await observeDependencyTransitionSlot(
      bridgePath,
      generatedStateDigest(source.binding)
    );
    if (existing.kind !== 'absent') {
      const runtimeBinding = source.binding.runtimeMaterialization;
      if (runtimeBinding == null) {
        throw new CodedFailure(
          'IMPORT-AUTHORITY-004',
          'Existing project dependency projection has no runtime materialization binding'
        );
      }
      const runtimeSourceGeneration = await runtimeDependencySourceGeneration({
        binding: runtimeBinding,
        options: lockedOptions,
        ownerRoot: source.ownerRoot,
        sourcePath: source.sourcePath
      });
      await assertProjectProjectionPreimage({
        current: existing,
        expectedBinding: runtimeBinding,
        expectedLinkTarget: source.sourcePath,
        expectedSourceGeneration: runtimeSourceGeneration,
        options: lockedOptions,
        projectRoot: consumerRoot,
        runtimeSpec: await loadRuntimeDependencySpec(),
        targetPath: bridgePath
      });
      runtimeDependencyOperationRemainingMs(lockedOptions, 'Project dependency bridge callback admission');
      const result = await callback();
      runtimeDependencyOperationRemainingMs(lockedOptions, 'Project dependency bridge callback settlement');
      await retained.assertAuthorityCurrent();
      const after = await observeDependencyTransitionSlot(bridgePath);
      if (after.kind !== 'link' || !compilerDependencyBridgeLinkMatches(bridgePath, source, after)) {
        throw new CodedFailure(
          'IMPORT-AUTHORITY-004',
          'Existing project dependency bridge changed during callback and is preserved'
        );
      }
      return result;
    }

    let transition = await beginDependencyTransition({
      kind: 'project-runtime-bridge',
      ownerRoot: consumerRoot,
      destinationPath: bridgePath,
      stagePath: null,
      stageRootPath: null,
      backupPath: null,
      sourceGeneration: source.sourceGeneration,
      bindingDigest: generatedStateDigest(source.binding),
      options: lockedOptions
    });
    try {
      await retained.physicalGeneration.assertAuthorityCurrent();
      await createCompilerDependencyLocator(
        bridgePath,
        source.sourcePath,
        source.sourceGeneration.physical,
        lockedOptions
      );
      const published = await observeDependencyTransitionSlot(
        bridgePath,
        generatedStateDigest(source.binding)
      );
      if (published.kind !== 'link' || !compilerDependencyBridgeLinkMatches(bridgePath, source, published)) {
        throw new CodedFailure(
          'IMPORT-AUTHORITY-004',
          'Compiler dependency bridge publication failed exact link readback'
        );
      }
      transition = await advanceDependencyTransition(transition, {
        destination: published,
        phase: 'published',
        durability: 'known',
        failure: null
      }, lockedOptions);
      runtimeDependencyOperationRemainingMs(lockedOptions, 'Project dependency bridge callback admission');
      const result = await callback();
      runtimeDependencyOperationRemainingMs(lockedOptions, 'Project dependency bridge callback settlement');
      await retained.assertAuthorityCurrent();
      await removeCompilerDependencyBridge(consumerRoot, source, transition, lockedOptions);
      return result;
    } catch (error) {
      try {
        await retained.assertAuthorityCurrent();
        await removeCompilerDependencyBridge(consumerRoot, source, transition, lockedOptions);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `Compiler dependency bridge callback failed and transition ${transition.recordDigest} residue is preserved for recovery`
        );
      }
      throw error;
    }
    }) };
  } catch (error) {
    primary = { error };
  }
  let retirementFailure: { error: unknown } | undefined;
  try {
    await retained.retire();
  } catch (error) {
    retirementFailure = { error };
  }
  if (primary !== undefined) {
    if (retirementFailure !== undefined) {
      throw new AggregateError(
        [primary.error, retirementFailure.error],
        'Project dependency bridge consumer and retained generation settlement both failed'
      );
    }
    throw primary.error;
  }
  if (retirementFailure !== undefined) throw retirementFailure.error;
  return outcome!.value;
}

async function removeCompilerDependencyBridge(
  consumerRoot: string,
  source: CompilerDependencyBridgeSourceObservation,
  transition: DependencyTransitionJournal,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  if (transition.phase === 'rolled-back' || transition.phase === 'complete') return;
  // The caller retains and revalidates the exact source generation before
  // entering this cleanup effect. The transition still binds the destination
  // to that source so a changed locator is preserved rather than adopted.
  const bridgePath = path.join(path.resolve(consumerRoot), 'node_modules');
  const current = await observeDependencyTransitionSlot(bridgePath);
  if (current.kind === 'absent') {
    await advanceDependencyTransition(transition, {
      destination: transitionAbsentSlot(bridgePath),
      phase: 'rolled-back',
      durability: 'known',
      failure: null
    }, options);
    return;
  }
  if (current.kind !== 'link' || !compilerDependencyBridgeLinkMatches(bridgePath, source, transition.destination)) {
    throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency bridge changed before exact cleanup and is preserved');
  }
  const locator = compilerDependencyLocatorObservation(path.resolve(consumerRoot), 'node_modules');
  if (locator === null) {
    throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency bridge locator disappeared before exact cleanup');
  }
  await deleteExactCompilerDependencyLocator(path.resolve(consumerRoot), locator, options);
  const after = await observeDependencyTransitionSlot(bridgePath);
  if (after.kind !== 'absent') {
    throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency bridge cleanup failed exact absence readback');
  }
  await advanceDependencyTransition(transition, {
    destination: after,
    phase: 'rolled-back',
    durability: 'known',
    failure: null
  }, options);
}

// Outward diagnostics admit exact dependency/physical codes and native errno
// labels only. Recovery continues to consume the existing durable stage intent.
const COMPILER_DEPENDENCY_STAGING_FAILURE_CODES: ReadonlySet<string> = new Set([
  'IMPORT-AUTHORITY-001', 'IMPORT-AUTHORITY-002', 'IMPORT-AUTHORITY-004',
  'RUNTIME-DEPS-001', 'RUNTIME-DEPS-002', 'RUNTIME-DEPS-003', 'RUNTIME-DEPS-004',
  'RUNTIME-DEPS-SETTLEMENT-001',
  'PHYSICAL_NO_FOLLOW_ABSENT', 'PHYSICAL_NO_FOLLOW_EXCLUSIVE_CONFLICT',
  'PHYSICAL_NO_FOLLOW_READ_LIMIT_EXCEEDED', 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH',
  'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
  'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED',
  'EACCES', 'EBUSY', 'EEXIST', 'EFBIG', 'EINTR', 'EINVAL', 'EIO', 'EISDIR',
  'ELOOP', 'EMFILE', 'ENFILE', 'ENOENT', 'ENOSPC', 'ENOSYS', 'ENOTDIR',
  'ENOTEMPTY', 'ENOTSUP', 'EPERM', 'EROFS', 'ETIMEDOUT', 'EXDEV'
]);

type CompilerDependencyMaterializationSource =
  | Readonly<{ kind: 'install' }>
  | Readonly<{ kind: 'retained-content'; generation: RetainedNoFollowProvenDirectoryGeneration }>;

const COMPILER_DEPENDENCY_INSTALL_SOURCE = Object.freeze({ kind: 'install' as const });
const COMPILER_DEPENDENCY_CONTENT_INPUTS = Object.freeze([
  '.bun-version', 'bun.lock', 'bunfig.toml', 'package.json'
] as const);

/** The trusted transport authenticates the archive. This owner independently
 * binds its retained physical content to the exact target runtime inputs. */
async function assertCompilerDependencyRetainedContent(
  generation: RetainedNoFollowProvenDirectoryGeneration,
  root: string,
  options: RuntimeDependencyOperationOptions
): Promise<PhysicalDirectoryIdentity> {
  assertRetainedNoFollowProvenDirectoryGeneration(generation, 'Compiler dependency transported content');
  runtimeDependencyOperationRemainingMs(options, 'Compiler dependency transported content admission');
  generation.assertCurrent();
  await generation.assertAuthorityCurrent();
  const content = assertSameNoFollowDirectoryIdentity(generation.root, 'Compiler dependency content root');
  const target = inspectNoFollowDirectoryChain(root, 'Compiler dependency content consumer');
  assertPhysicallyDisjointDirectoryChains(content, target, 'Compiler dependency content and consumer');
  const context = runtimeDependencyOperationContext(options);
  const children = scanNoFollowDirectoryDirectMetadata(content.target, {
    deadlineAtMs: context.deadlineAtMonotonicMs,
    maximumEntries: COMPILER_DEPENDENCY_CONTENT_INPUTS.length + 1,
    signal: context.signal
  });
  if (children.some((entry) => entry.relativePath === 'node_modules'
    ? entry.kind !== 'directory'
    : !COMPILER_DEPENDENCY_CONTENT_INPUTS.some((name) => name === entry.relativePath)
      || entry.kind !== 'file')) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency content has an unexpected root member');
  }
  for (const name of COMPILER_DEPENDENCY_CONTENT_INPUTS) {
    const sourceBytes = readNoFollowOrdinaryFile(content.target, name);
    const targetBytes = readNoFollowOrdinaryFile(target.target, name);
    if (sourceBytes === null || targetBytes === null) {
      if (name === 'bunfig.toml' && sourceBytes === null && targetBytes === null) continue;
      throw new CodedFailure('RUNTIME-DEPS-004', `Compiler dependency content input is absent: ${name}`);
    }
    if (!Buffer.from(sourceBytes).equals(Buffer.from(targetBytes))) {
      throw new CodedFailure('RUNTIME-DEPS-004', `Compiler dependency content input differs: ${name}`);
    }
  }
  const modules = inspectNoFollowDirectoryChild(content.target, 'node_modules', 'Compiler dependency content modules');
  if (modules === null) throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency content modules are absent');
  await generation.assertAuthorityCurrent();
  generation.assertCurrent();
  assertSameNoFollowDirectoryIdentity(target.target, 'Compiler dependency content consumer readback');
  return modules;
}

async function stageCompilerDependencyGeneration(
  root: string,
  identity: CompilerDependencyIdentity,
  options: RuntimeDependencyOperationOptions,
  materializationSource: CompilerDependencyMaterializationSource = COMPILER_DEPENDENCY_INSTALL_SOURCE
): Promise<{
  binding: CompilerDepsBinding;
  stageIntent: CompilerDependencyStageIntent;
  stagingRoot: string;
  stagingRootSlot: DependencyTransitionSlot;
}> {
  const stagingParent = path.join(root, '.tmp', 'dependency-installs');
  const compilerRootIdentity = inspectNoFollowDirectoryChain(
    root,
    'Compiler dependency staging root'
  ).target;
  await runtimeDependencyOperationEffectFence(options, 'Compiler dependency staging namespace creation');
  createNoFollowOrdinaryDirectoryChain(
    compilerRootIdentity,
    ['.tmp', 'dependency-installs']
  );
  await runtimeDependencyOperationEffectFence(options, 'Compiler dependency staging-root creation');
  const stagingParentIdentity = inspectNoFollowDirectoryChain(
    stagingParent,
    'Compiler dependency staging parent'
  ).target;
  const stagingRoot = createExclusiveNoFollowRandomDirectory(
    stagingParentIdentity,
    'c.staging-'
  ).path;
  const stagingRootSlot = await observeDependencyTransitionSlot(stagingRoot);
  const stagingRelativePath = path.relative(root, stagingRoot).replaceAll('\\', '/');
  let lifecycleRegistered = false;
  let stageIntent: CompilerDependencyStageIntent | null = null;
  let stagingNodeModulesSlot: DependencyTransitionSlot | null = null;
  try {
    if (options.generatedStateLifecycle !== undefined) {
      await runtimeDependencyOperationEffectFence(options, 'Compiler dependency staging lifecycle birth');
      await options.generatedStateLifecycle.born(
        stagingRelativePath,
        `compiler-dependency-generation:${identity.manifestHash}:${path.basename(stagingRoot)}`
      );
      lifecycleRegistered = true;
    }
    const operationContext = runtimeDependencyOperationContext(options);
    const preparedStageIntent = preparedCompilerDependencyStageIntent({
      operationId: operationContext.operationId,
      operationInitialBudgetMs: operationContext.initialBudgetMs,
      ownerRoot: compilerRootIdentity,
      stageRoot: stagingRootSlot
    });
    await writeCompilerDependencyStageIntent(root, preparedStageIntent, options);
    stageIntent = preparedStageIntent;
    const sourceRootIdentity = inspectNoFollowDirectoryChain(
      root,
      'Compiler dependency source root'
    ).target;
    const stagedRootIdentity = inspectNoFollowDirectoryChain(
      stagingRoot,
      'Compiler dependency staging root readback'
    ).target;
    const stageCanonicalInput = async (name: 'package.json' | 'bun.lock' | 'bunfig.toml') => {
      const sourceEntry = inspectNoFollowOrdinaryFileEntry(sourceRootIdentity, name);
      if (sourceEntry === null) return null;
      if (sourceEntry.kind !== 'file' || sourceEntry.bytes === null) {
        throw new CodedFailure(
          'IMPORT-AUTHORITY-001',
          `Compiler dependency input ${name} is not an ordinary no-follow file`
        );
      }
      // The source parent and the newly-created stage parent are both fenced
      // immediately around publication.  Publication itself is no-replace,
      // retained-parent and durable; a substituted source is therefore a
      // typed failure rather than a path-following copy.
      assertSameNoFollowDirectoryIdentity(sourceRootIdentity, 'Compiler dependency source root before stage input');
      assertSameNoFollowDirectoryIdentity(stagedRootIdentity, 'Compiler dependency staging root before stage input');
      const bytes = Buffer.from(sourceEntry.bytes);
      await runtimeDependencyOperationEffectFence(options, `Compiler dependency staged ${name} publication`);
      publishExclusiveDurableCanonicalFile({
        parent: stagedRootIdentity,
        name,
        bytes,
        validate: (candidate) => {
          if (!Buffer.from(candidate).equals(bytes)) {
            throw new CodedFailure('IMPORT-AUTHORITY-001', `Compiler dependency staged input ${name} bytes differ`);
          }
        }
      });
      assertSameNoFollowDirectoryIdentity(sourceRootIdentity, 'Compiler dependency source root after stage input');
      assertSameNoFollowDirectoryIdentity(stagedRootIdentity, 'Compiler dependency staging root after stage input');
      const stagedEntry = inspectNoFollowOrdinaryFileEntry(stagedRootIdentity, name);
      if (stagedEntry === null || stagedEntry.kind !== 'file' || stagedEntry.bytes === null ||
          !Buffer.from(stagedEntry.bytes).equals(bytes)) {
        throw new CodedFailure('IMPORT-AUTHORITY-001', `Compiler dependency staged input ${name} failed exact readback`);
      }
      return bytes;
    };
    const sourcePackageBytes = await stageCanonicalInput('package.json');
    const sourceLockBytes = await stageCanonicalInput('bun.lock');
    if (sourcePackageBytes === null || sourceLockBytes === null ||
        digest(sourcePackageBytes) !== identity.packageSourceSha256 ||
        digest(sourceLockBytes) !== identity.lockSha256) {
      throw new CodedFailure('IMPORT-AUTHORITY-001', 'Compiler dependency inputs changed before staging');
    }
    const installConfigBytes = await stageCanonicalInput('bunfig.toml');
    if (compilerInstallConfigSha256(installConfigBytes) !== identity.installConfigSha256) {
      throw new CodedFailure('IMPORT-AUTHORITY-001', 'Compiler dependency install config changed before staging');
    }

    const cacheDir = path.join(resolveSecWorkspaceRuntimeRoots({
      repositoryRoot: root,
      environment: process.env
    }).cacheRoot, 'bun-install');
    const runtimeExecutable = await currentRuntimeExecutableIdentity(true);
    if (runtimeExecutable.path !== identity.bunExecutablePath ||
      runtimeExecutable.sha256 !== identity.bunExecutableSha256) {
      throw new CodedFailure('IMPORT-AUTHORITY-001', 'Bun executable changed before dependency materialization');
    }
    const compilerInputFence = async (): Promise<void> => {
      assertCompilerDependencyInputsCurrent(root, identity);
    };
    await compilerInputFence();
    if (materializationSource.kind === 'install') {
      await runBunInstall(
        stagingRoot,
        options,
        COMPILER_DEPENDENCY_INSTALL_ARGS,
        cacheDir,
        runtimeExecutable,
        compilerInputFence
      );
    } else {
      const source = await assertCompilerDependencyRetainedContent(materializationSource.generation, root, options);
      await copyNoFollowDirectoryTreesBulk([{ source, target: path.join(stagingRoot, 'node_modules') }], {
        assertCurrent: async () => {
          await runtimeDependencyOperationEffectFence(options, 'Compiler dependency content materialization');
          materializationSource.generation.assertCurrent();
          await materializationSource.generation.assertAuthorityCurrent();
          await compilerInputFence();
        },
        deadlineAtMs: operationContext.deadlineAtMonotonicMs,
        maximumBytes: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES,
        maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
        excludeRelativePaths: [COMPILER_DEPS_BINDING_FILE],
        preserveFilePermissionMode: true,
        signal: operationContext.signal
      });
      await assertCompilerDependencyRetainedContent(materializationSource.generation, root, options);
    }
    await compilerInputFence();
    const nodeModulesPath = path.join(stagingRoot, 'node_modules');
    const packages = await compilerDependencyPackageBindings(nodeModulesPath, identity);
    const runtimeMaterialization = await compilerRuntimeMaterializationBinding(root, nodeModulesPath, identity);
    const binding = {
      architecture: identity.architecture,
      bunExecutablePath: identity.bunExecutablePath,
      bunExecutableSha256: identity.bunExecutableSha256,
      bunVersion: identity.bunVersion,
      declaredBunVersion: identity.declaredBunVersion,
      dependencyManifestSha256: identity.dependencyManifestSha256,
      formatVersion: 'compiler-deps-binding-v5',
      installConfigSha256: identity.installConfigSha256,
      lockSha256: identity.lockSha256,
      manifestHash: identity.manifestHash,
      packages,
      platform: identity.platform,
      runtimeMaterialization
    } satisfies CompilerDepsBinding;
    const nodeModulesIdentity = inspectNoFollowDirectoryChain(
      nodeModulesPath,
      'Compiler dependency staged node_modules'
    ).target;
    const bindingBytes = Buffer.from(formatJsonFile(binding), 'utf8');
    await runtimeDependencyOperationEffectFence(options, 'Compiler dependency staged binding publication');
    publishExclusiveDurableCanonicalFile({
      parent: nodeModulesIdentity,
      name: COMPILER_DEPS_BINDING_FILE,
      bytes: bindingBytes,
      validate: (candidate) => {
        if (!Buffer.from(candidate).equals(bindingBytes)) {
          throw new CodedFailure('IMPORT-AUTHORITY-002', 'Compiler dependency staged binding bytes differ');
        }
      }
    });
    assertSameNoFollowDirectoryIdentity(nodeModulesIdentity, 'Compiler dependency staged node_modules readback');
    stagingNodeModulesSlot = await observeDependencyTransitionSlot(
      nodeModulesPath,
      generatedStateDigest(binding)
    );
    if (stagingNodeModulesSlot.kind === 'absent') {
      throw new CodedFailure('IMPORT-AUTHORITY-002', 'Compiler dependency generation stage disappeared before publication');
    }
    return { binding, stageIntent, stagingRoot, stagingRootSlot };
  } catch (error) {
    try {
      if (stageIntent !== null) {
        await settleCompilerDependencyStageIntent(
          root,
          stageIntent,
          lifecycleRegistered ? 'generation-aborted' : 'generation-aborted-before-registration',
          options
        );
      } else {
        await disposeDependencyTransitionStage(
          root,
          stagingRoot,
          options,
          lifecycleRegistered ? 'generation-aborted' : 'generation-aborted-before-registration',
          stagingNodeModulesSlot,
          stagingRootSlot,
          compilerDependencyStageAuthority(root)
        );
      }
    } catch (disposeError) {
      const materializationCode = boundedFailureCode(error, COMPILER_DEPENDENCY_STAGING_FAILURE_CODES);
      const cleanupCode = boundedFailureCode(disposeError, COMPILER_DEPENDENCY_STAGING_FAILURE_CODES);
      throw new CodedFailure(
        'IMPORT-AUTHORITY-004',
        `Compiler dependency generation staging residue is preserved for recovery; materialization=${materializationCode}; cleanup=${cleanupCode}`,
        { materializationCode, cleanupCode, recoveryRequired: true }
      );
    }
    if (error instanceof CodedFailure && error.code.startsWith('IMPORT-AUTHORITY-')) throw error;
    const causeMessage = error instanceof CodedFailure
      ? JSON.stringify(error.details).slice(-2000)
      : error instanceof Error ? error.message : String(error);
    throw new CodedFailure(
      'IMPORT-AUTHORITY-002',
      `Compiler dependency generation could not be materialized: ${causeMessage}`,
      {
      cause: error instanceof CodedFailure ? {
        code: error.code,
        details: error.details,
        message: error.message
      } : error instanceof Error ? error.message : String(error)
      }
    );
  }
}

type CompilerDependencyDirectoryIdentity = Readonly<{
  dev: string;
  ino: string;
  mode: string;
}>;

const COMPILER_DEPENDENCY_RENAME_MAX_ATTEMPTS = 8;
const COMPILER_DEPENDENCY_RENAME_INITIAL_DELAY_MS = 25;
const COMPILER_DEPENDENCY_RENAME_MAX_DELAY_MS = 200;
const WINDOWS_TRANSIENT_RENAME_CODES = new Set(['EACCES', 'EBUSY', 'EPERM']);

async function compilerDependencyDirectoryIdentity(
  directoryPath: string
): Promise<CompilerDependencyDirectoryIdentity | null> {
  try {
    const metadata = await fs.lstat(directoryPath, { bigint: true });
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`Compiler dependency generation is not a physical directory: ${directoryPath}`);
    }
    return Object.freeze({
      dev: String(metadata.dev),
      ino: String(metadata.ino),
      mode: String(metadata.mode)
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function sameCompilerDependencyDirectoryIdentity(
  left: CompilerDependencyDirectoryIdentity | null,
  right: CompilerDependencyDirectoryIdentity
): boolean {
  return left !== null && left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

async function renameCompilerDependencyDirectory(
  source: string,
  target: string,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  // The test seam deliberately retains the historical retry surface so the
  // integration suite can inject a post-effect exception. Production never
  // uses fs.rename directly: the no-follow primitive owns both retained
  // parents, no-replace semantics, fsync and physical readback.
  if (options.testCompilerRename !== undefined) {
    const expectedSource = await compilerDependencyDirectoryIdentity(source);
    if (expectedSource === null) {
      throw new Error(`Compiler dependency generation source is unavailable: ${source}`);
    }
    if ((await compilerDependencyDirectoryIdentity(target)) !== null) {
      throw new Error(`Compiler dependency generation target already exists: ${target}`);
    }

    const hostPlatform = options.testCompilerPublishPlatform ?? process.platform;
    const sleep = options.sleep ?? sleepMs;
    for (let attempt = 1; attempt <= COMPILER_DEPENDENCY_RENAME_MAX_ATTEMPTS; attempt += 1) {
      await runtimeDependencyOperationEffectFence(options, 'Compiler dependency test rename');
      const currentSource = await compilerDependencyDirectoryIdentity(source);
      const currentTarget = await compilerDependencyDirectoryIdentity(target);
      if (!sameCompilerDependencyDirectoryIdentity(currentSource, expectedSource) || currentTarget !== null) {
        throw new Error('Compiler dependency generation identity changed before publish');
      }
      try {
        await options.testCompilerRename(source, target);
        return;
      } catch (error) {
        const sourceAfterFailure = await compilerDependencyDirectoryIdentity(source);
        const targetAfterFailure = await compilerDependencyDirectoryIdentity(target);
        if (sourceAfterFailure === null &&
          sameCompilerDependencyDirectoryIdentity(targetAfterFailure, expectedSource)) {
          // The injected seam may have performed the rename and then thrown.
          // Topology is exact, so recovery can continue in the caller.
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        const retryable = hostPlatform === 'win32' &&
          code !== undefined &&
          WINDOWS_TRANSIENT_RENAME_CODES.has(code) &&
          attempt < COMPILER_DEPENDENCY_RENAME_MAX_ATTEMPTS;
        if (!retryable) throw error;
        if (!sameCompilerDependencyDirectoryIdentity(sourceAfterFailure, expectedSource) ||
          targetAfterFailure !== null) {
          throw new Error('Compiler dependency generation identity changed after transient publish failure', {
            cause: error
          });
        }
        const delayMs = Math.min(
          COMPILER_DEPENDENCY_RENAME_INITIAL_DELAY_MS * (2 ** (attempt - 1)),
          COMPILER_DEPENDENCY_RENAME_MAX_DELAY_MS
        );
        await waitForRuntimeDependencyOperation(
          options,
          delayMs,
          sleep,
          'Compiler dependency transient rename retry'
        );
      }
    }
    return;
  }

  const expectedSource = inspectNoFollowDirectoryChain(
    source,
    'Compiler dependency generation source'
  ).target;
  const destinationParent = inspectNoFollowDirectoryChain(
    path.dirname(path.resolve(target)),
    'Compiler dependency generation destination parent'
  ).target;
  const currentTarget = await observeDependencyTransitionSlot(target);
  if (currentTarget.kind !== 'absent') {
    throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency generation target is occupied and preserved');
  }
  await runtimeDependencyOperationEffectFence(options, 'Compiler dependency retained directory relocation');
  try {
    relocateRetainedNoFollowDirectoryAcrossParents({
      directory: expectedSource,
      destinationParent,
      tombstoneName: path.basename(path.resolve(target))
    });
  } catch (error) {
    const sourceAfter = inspectExactNoFollowDirectoryPresence(source, 'Compiler dependency generation source');
    const targetAfter = await observeDependencyTransitionSlot(target);
    if (sourceAfter.state === 'absent' && targetAfter.kind === 'directory' &&
      targetAfter.physical !== null && sameGeneratedStateIdentity(
        targetAfter.physical,
        generatedStatePhysicalIdentity(expectedSource)
      )) {
      throw new CodedFailure(
        'RUNTIME-DEPS-002',
        'Compiler dependency generation rename reached topology but durability is unknown; recovery is required',
        { cause: error instanceof Error ? error.message : String(error), source, target }
      );
    }
    throw error;
  }
}

/**
 * Moves an operation-owned locator without ever following its target.  A
 * project projection uses this for the staged bridge link so its journal has
 * the same prepared -> published topology as an isolated directory copy.
 */
async function renameDependencyLocator(
  source: string,
  target: string,
  expectedLinkTarget: string,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const sourceParent = inspectNoFollowDirectoryChain(
    path.dirname(path.resolve(source)),
    'Dependency locator source parent'
  ).target;
  const targetParent = inspectNoFollowDirectoryChain(
    path.dirname(path.resolve(target)),
    'Dependency locator destination parent'
  ).target;
  const sourceEntry = inspectExactNoFollowLinkEntry(
    sourceParent,
    path.basename(path.resolve(source)),
    expectedLinkTarget
  );
  if (sourceEntry === null || sourceEntry.kind !== 'link' || sourceEntry.linkTarget === null) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Dependency locator stage is not the expected physical link');
  }
  if ((await observeDependencyTransitionSlot(target)).kind !== 'absent') {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Dependency locator destination is occupied and preserved');
  }
  const expectedSource = inspectNoFollowDirectoryChain(
    expectedLinkTarget,
    'Dependency locator source target'
  ).target;
  await runtimeDependencyOperationEffectFence(options, 'Dependency locator retained relocation');
  try {
    relocateRetainedNoFollowLinkAcrossParents({
      sourceParent,
      destinationParent: targetParent,
      sourceName: path.basename(path.resolve(source)),
      destinationName: path.basename(path.resolve(target)),
      expectedSource,
      expectedTargetPath: expectedLinkTarget
    });
  } catch (error) {
    const sourceAfter = inspectNoFollowLinkEntry(sourceParent, path.basename(path.resolve(source)));
    const targetAfter = inspectExactNoFollowLinkEntry(
      targetParent,
      path.basename(path.resolve(target)),
      expectedLinkTarget
    );
    if (sourceAfter === null && targetAfter?.kind === 'link') {
      throw new CodedFailure('RUNTIME-DEPS-002', 'Dependency locator rename reached topology but durability is unknown; recovery is required', {
        cause: error instanceof Error ? error.message : String(error),
        source,
        target
      });
    }
    throw error;
  }
  const sourceAfter = inspectNoFollowLinkEntry(sourceParent, path.basename(path.resolve(source)));
  const targetAfter = inspectExactNoFollowLinkEntry(
    targetParent,
    path.basename(path.resolve(target)),
    expectedLinkTarget
  );
  const targetIdentity = targetAfter === null || targetAfter.linkTarget === null
    ? null
    : Object.freeze({
      device: targetAfter.device,
      inode: targetAfter.inode,
      objectId: generatedStateDigest({ kind: 'link', target: targetAfter.linkTarget })
    });
  const expectedIdentity = Object.freeze({
    device: sourceEntry.device,
    inode: sourceEntry.inode,
    objectId: generatedStateDigest({ kind: 'link', target: sourceEntry.linkTarget })
  });
  if (sourceAfter !== null || targetAfter === null || targetAfter.kind !== 'link' ||
      targetAfter.linkTarget === null || targetIdentity === null ||
      !sameGeneratedStatePhysicalIdentity(targetIdentity, expectedIdentity) ||
      !sameGeneratedStateIdentity(
        generatedStatePhysicalIdentity(targetParent),
        generatedStatePhysicalIdentity(inspectNoFollowDirectoryChain(
          path.dirname(path.resolve(target)),
          'Dependency locator destination parent readback'
        ).target)
      )) {
    throw new CodedFailure('RUNTIME-DEPS-002', 'Dependency locator rename failed exact no-follow readback; recovery is required', {
      source,
      target,
      targetAfter
    });
  }
}

async function publishLocalCompilerDependencyLocator(
  root: string,
  activeNodeModulesPath: string,
  stagingRoot: string | null,
  stageIntent: CompilerDependencyStageIntent | null,
  binding: CompilerDepsBinding,
  identity: CompilerDependencyIdentity,
  sourceGeneration: RuntimeDependencySourceGeneration,
  options: RuntimeDependencyOperationOptions
): Promise<RuntimeDependencySourceGeneration> {
  return measureRuntimeDependencyOperationPhaseAsync(options, 'publication', () =>
    publishLocalCompilerDependencyLocatorInternal(
      root,
      activeNodeModulesPath,
      stagingRoot,
      stageIntent,
      binding,
      identity,
      sourceGeneration,
      options
    ));
}

async function publishLocalCompilerDependencyLocatorInternal(
  root: string,
  activeNodeModulesPath: string,
  stagingRoot: string | null,
  stageIntent: CompilerDependencyStageIntent | null,
  binding: CompilerDepsBinding,
  identity: CompilerDependencyIdentity,
  sourceGeneration: RuntimeDependencySourceGeneration,
  options: RuntimeDependencyOperationOptions
): Promise<RuntimeDependencySourceGeneration> {
  const generationPath = compilerTransitionBackupPath(root, 'generation', sourceGeneration);
  const active = await observeDependencyTransitionSlot(activeNodeModulesPath);
  let preimageBindingDigest: `sha256:${string}` | null = null;
  if (active.kind === 'directory') {
    preimageBindingDigest = (await compilerDependencyGeneratedPreimageAuthority(
      root,
      activeNodeModulesPath,
      options
    )).authorityDigest;
  } else if (active.kind === 'link') {
    const preimageBinding = await compilerDependencyConsumerBridgeBinding(
      root,
      activeNodeModulesPath,
      identity,
      options
    );
    if (preimageBinding === null) {
      throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency locator preimage has no canonical binding');
    }
    preimageBindingDigest = generatedStateDigest(preimageBinding);
  } else if (active.kind !== 'absent') {
    throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency locator preimage is foreign and preserved');
  }
  const stagedPath = stagingRoot === null ? null : path.join(stagingRoot, 'node_modules');
  let transition = await beginDependencyTransition({
    kind: 'compiler-local-locator',
    ownerRoot: root,
    destinationPath: activeNodeModulesPath,
    stagePath: stagedPath,
    stageRootPath: stagingRoot,
    backupPath: generationPath,
    sourceGeneration: issuedRuntimeDependencySourceGenerationWithPath(sourceGeneration, generationPath),
    bindingDigest: generatedStateDigest(binding),
    preimageBindingDigest,
    options
  });
  try {
    await recoverCompilerDependencyTransition(root, activeNodeModulesPath, identity, options);
    const terminal = await readDependencyTransition(root, options);
    if (terminal === null || terminal.operationKey !== transition.operationKey ||
        terminal.phase !== 'complete' || terminal.kind !== 'compiler-local-locator') {
      throw new CodedFailure(
        'IMPORT-AUTHORITY-004',
        'Compiler dependency immutable generation transition has no terminal receipt'
      );
    }
    transition = terminal;
    if (stageIntent !== null && stagingRoot !== null) {
      const intents = await readCompilerDependencyStageIntents(root, options);
      if (intents.active.some((candidate) => candidate.intentDigest === stageIntent.intentDigest)) {
        throw new CodedFailure(
          'IMPORT-AUTHORITY-004',
          'Compiler dependency immutable generation retained its staging intent after publication'
        );
      }
    }
    return transition.sourceGeneration;
  } catch (error) {
    await markDependencyTransitionFailure(transition, error, options).catch(() => undefined);
    const recoveryCause = error instanceof CodedFailure && error.details !== null &&
      typeof error.details === 'object' && 'cause' in error.details &&
      typeof error.details.cause === 'string'
      ? error.details.cause
      : null;
    throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency immutable generation publication failed', {
      cause: error instanceof Error ? error.message : String(error),
      causeDetails: error instanceof CodedFailure ? error.details : null,
      recoveryCause,
      recoveryRequired: true,
      transitionDigest: transition.recordDigest
    });
  }
}

async function createCompilerDependencyLocator(
  linkPath: string,
  sourcePath: string,
  expectedSource: Readonly<GeneratedStatePhysicalIdentity>,
  options: RuntimeDependencyOperationOptions
): Promise<Readonly<{ source: GeneratedStatePhysicalIdentity; linkTarget: string }>> {
  const parent = inspectNoFollowDirectoryChain(
    path.dirname(linkPath),
    'Compiler dependency locator parent'
  ).target;
  const existing = await observeDependencyTransitionSlot(linkPath);
  if (existing.kind !== 'absent') {
    throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency locator target is occupied and preserved');
  }
  const sourceIdentity = inspectNoFollowDirectoryChain(
    sourcePath,
    'Compiler dependency locator source'
  ).target;
  const source = generatedStatePhysicalIdentity(sourceIdentity);
  if (!sameGeneratedStateIdentity(source, expectedSource)) {
    throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency locator publication failed exact readback', {
      expectedSource,
      source,
      sourcePath
    });
  }
  try {
    await runtimeDependencyOperationEffectFence(options, 'Compiler dependency locator publication');
    assertSameNoFollowDirectoryIdentity(parent, 'Compiler dependency locator parent publication');
    assertSameNoFollowDirectoryIdentity(sourceIdentity, 'Compiler dependency locator source publication');
    publishExclusiveNoFollowLink({
      parent,
      name: path.basename(path.resolve(linkPath)),
      source: sourceIdentity,
      expectedTargetPath: sourcePath
    });
    const published = inspectExactNoFollowLinkEntry(
      parent,
      path.basename(path.resolve(linkPath)),
      sourcePath
    );
    if (published === null || published.kind !== 'link' || published.linkTarget === null) {
      throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency locator disappeared after publication');
    }
    return Object.freeze({
      source: Object.freeze({
        device: published.device,
        inode: published.inode,
        objectId: generatedStateDigest({ kind: 'link', target: published.linkTarget })
      }),
      linkTarget: published.linkTarget
    });
  } catch (error) {
    throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency locator publication failed exact readback', {
      expectedSource,
      source,
      sourcePath,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
}

async function recoverCompilerDependencyTransition(
  root: string,
  nodeModulesPath: string,
  identity: CompilerDependencyIdentity,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const initialTransition = await readDependencyTransition(root, options);
  if (initialTransition === null || initialTransition.phase === 'complete' || initialTransition.phase === 'rolled-back') return;
  let transition: DependencyTransitionJournal = initialTransition;

  const activePath = transition.destination.path;
  const stagePath = transition.stage?.path ?? null;
  const stageRootPath = transition.stageRoot?.path ?? null;
  const backupPath = transition.backup?.path ?? null;
  const expectedSourcePhysical = transition.sourceGeneration.physical;

  const failRecovery = async (error: unknown): Promise<never> => {
    try {
      transition = await markDependencyTransitionFailure(transition, error, options);
    } catch {
      // Preserve the original typed blocker if the journal itself is no longer
      // writable; no destructive fallback is safe at this boundary.
    }
    throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency transition requires owner recovery', {
      cause: error instanceof Error ? error.message : String(error),
      causeDetails: error instanceof CodedFailure ? error.details : null,
      transitionDigest: transition.recordDigest,
      phase: transition.phase
    });
  };

  const currentActive = async (): Promise<DependencyTransitionSlot> => {
    const observed = await observeDependencyTransitionSlot(activePath);
    if (observed.kind === 'directory' && observed.physical !== null &&
        transition.preimage.kind === 'directory' && transition.preimage.physical !== null &&
        sameGeneratedStateIdentity(observed.physical, transition.preimage.physical)) {
      return observeDependencyTransitionSlot(activePath, transition.preimage.bindingDigest);
    }
    if (observed.kind === 'directory' && observed.physical !== null &&
        sameGeneratedStateIdentity(observed.physical, transition.sourceGeneration.physical)) {
      return observeDependencyTransitionSlot(activePath, transition.sourceGeneration.bindingDigest);
    }
    return observed;
  };
  const currentStage = () => stagePath === null
    ? Promise.resolve<DependencyTransitionSlot | null>(null)
    : observeDependencyTransitionSlot(stagePath, transition.sourceGeneration.bindingDigest);
  const currentStageRoot = () => stageRootPath === null
    ? Promise.resolve<DependencyTransitionSlot | null>(null)
    : observeDependencyTransitionSlot(stageRootPath, transition.sourceGeneration.bindingDigest);
  const currentBackup = () => backupPath === null
    ? Promise.resolve<DependencyTransitionSlot | null>(null)
    : observeDependencyTransitionSlot(
      backupPath,
      transition.kind === 'compiler-local-locator'
        ? transition.sourceGeneration.bindingDigest
        : transition.preimage.bindingDigest
    );

  try {
    if (await settleAbandonedLegacyProjection(transition, root, nodeModulesPath, options)) return;
    assertCompilerTransitionRecoveryTopology(initialTransition, root, nodeModulesPath);
    let active = await currentActive();
    let stage = await currentStage();
    let stageRoot = await currentStageRoot();
    let backup = await currentBackup();

    // A preimage and a new target are independent authorities.  An earlier
    // writer incorrectly copied the target binding digest into the prepared
    // preimage slot.  That operation published no target effect, so recovery
    // may only settle its exact operation-owned stage and record the unchanged
    // active physical preimage as rolled back.  A successor transition must
    // then authenticate the preimage from its own persisted binding and
    // actual bytes; the old record is never upgraded or treated as authority.
    if (transition.kind === 'compiler-generation' && transition.phase === 'recovery-required' &&
        transition.failure?.code === 'IMPORT-AUTHORITY-004' &&
        transition.preimage.bindingDigest === transition.sourceGeneration.bindingDigest &&
        transition.preimage.kind === 'directory' && transition.preimage.physical !== null &&
        active.kind === 'directory' && active.physical !== null &&
        sameGeneratedStateIdentity(active.physical, transition.preimage.physical) &&
        transition.stage?.kind === 'directory' && transition.stage.physical !== null &&
        stage?.kind === 'directory' && stage.physical !== null &&
        sameGeneratedStateIdentity(stage.physical, transition.stage.physical) &&
        transition.stageRoot?.kind === 'directory' && transition.stageRoot.physical !== null &&
        stageRoot?.kind === 'directory' && stageRoot.physical !== null &&
        sameGeneratedStateIdentity(stageRoot.physical, transition.stageRoot.physical) &&
        backup?.kind === 'absent') {
      const stageIntents = await readCompilerDependencyStageIntents(root, options);
      const stageIntent = stageIntents.active.find((intent) =>
        stageRootPath !== null && path.resolve(intent.stageRootPath) === path.resolve(stageRootPath));
      if (stageIntent === undefined) {
        return failRecovery(new CodedFailure(
          'IMPORT-AUTHORITY-004',
          'Compiler dependency invalid transition stage has no exact disposal authority'
        ));
      }
      await settleCompilerDependencyStageIntent(
        root,
        stageIntent,
        'invalid-preimage-authority-transition-rolled-back',
        options
      );
      stage = await currentStage();
      stageRoot = await currentStageRoot();
      if (stage?.kind !== 'absent' || stageRoot?.kind !== 'absent') {
        return failRecovery(new CodedFailure(
          'IMPORT-AUTHORITY-004',
          'Compiler dependency invalid transition stage settlement did not reach terminal absence'
        ));
      }
      transition = await advanceDependencyTransition(transition, {
        destination: active,
        stage,
        stageRoot,
        backup,
        phase: 'rolled-back',
        durability: 'known',
        failure: transition.failure
      }, options);
      return;
    }

    if (transition.kind === 'compiler-generation' &&
        (transition.phase === 'prepared' || transition.phase === 'recovery-required') &&
        transition.preimage.kind === 'directory' && transition.preimage.physical !== null &&
        transition.destination.kind === 'directory' && transition.destination.physical !== null &&
        transition.stage?.kind === 'directory' && transition.stage.physical !== null &&
        transition.stageRoot?.kind === 'directory' && transition.stageRoot.physical !== null &&
        active.kind === 'directory' && active.physical !== null &&
        sameGeneratedStateIdentity(active.physical, transition.preimage.physical) &&
        sameGeneratedStateIdentity(active.physical, transition.destination.physical) &&
        stage?.kind === 'absent' && stageRoot?.kind === 'absent' && backup?.kind === 'absent') {
      const stageIntents = await readCompilerDependencyStageIntents(root, options);
      if (stageRootPath !== null &&
          !stageIntents.active.some((intent) =>
            path.resolve(intent.stageRootPath) === path.resolve(stageRootPath))) {
        // The immutable journal binds observations, but it is not the issuer
        // of stage ownership.  Once both the stage and its generated-state
        // intent/receipt are absent, even a physically unchanged destination
        // cannot prove who created the missing generation.  Preserve the
        // destination and fail closed instead of letting caller-constructible
        // journal bytes manufacture a rollback receipt.
        return failRecovery(new CodedFailure(
          'IMPORT-AUTHORITY-004',
          'Compiler dependency prepared transition has no stage lifecycle provenance; unchanged preimage is preserved'
        ));
      }
    }
    if (transition.kind === 'compiler-generation' && transition.phase === 'recovery-required' &&
        transition.preimage.kind === 'directory' && transition.preimage.physical !== null &&
        active.kind === 'directory' && active.physical !== null &&
        sameGeneratedStateIdentity(active.physical, transition.preimage.physical) &&
        transition.stage?.kind === 'directory' && transition.stage.physical !== null &&
        stage?.kind === 'directory' && stage.physical !== null &&
        sameGeneratedStateIdentity(stage.physical, transition.stage.physical) &&
        transition.stageRoot?.kind === 'directory' && transition.stageRoot.physical !== null &&
        stageRoot?.kind === 'directory' && stageRoot.physical !== null &&
        sameGeneratedStateIdentity(stageRoot.physical, transition.stageRoot.physical) &&
        backup?.kind === 'absent') {
      // The preimage relocation produced no topology Effect.  Retrying that
      // operation is unsafe on Windows because another process may still be
      // consuming the exact active generation.  The journal already proves
      // the unchanged preimage, exact operation-owned stage and absent
      // backup, so the only recovery action is to retire the stage and close
      // this attempt as rolled back.  A successor operation can then publish
      // an immutable generation and switch only the locator.
      const stageIntents = await readCompilerDependencyStageIntents(root, options);
      const stageIntent = stageIntents.active.find((intent) =>
        stageRootPath !== null && path.resolve(intent.stageRootPath) === path.resolve(stageRootPath));
      if (stageIntent === undefined) {
        return failRecovery(new CodedFailure(
          'IMPORT-AUTHORITY-004',
          'Compiler dependency failed relocation stage has no exact disposal authority'
        ));
      }
      await settleCompilerDependencyStageIntent(
        root,
        stageIntent,
        'preimage-relocation-not-applied-rolled-back',
        options
      );
      stage = await currentStage();
      stageRoot = await currentStageRoot();
      if (stage?.kind !== 'absent' || stageRoot?.kind !== 'absent') {
        return failRecovery(new CodedFailure(
          'IMPORT-AUTHORITY-004',
          'Compiler dependency failed relocation stage did not reach terminal absence'
        ));
      }
      await advanceDependencyTransition(transition, {
        destination: active,
        stage,
        stageRoot,
        backup,
        phase: 'rolled-back',
        durability: 'known',
        failure: transition.failure
      }, options);
      return;
    }
    if (transition.stageRoot !== null &&
        (stageRoot === null || !transitionSlotMatches(stageRoot, transition.stageRoot))) {
      // A crash can occur after the exact retained disposal effect and before
      // the journal's stageRoot=absent receipt.  Once the staged child is also
      // recorded absent, an absent live root is a safe already-disposed
      // topology; no new deletion authority is inferred from it.  Any
      // reappeared or substituted root remains a typed residue blocker.
      let durableStageSettlement = false;
      const recordedStageRoot = transition.stageRoot;
      const recordedStagePhysical = recordedStageRoot.physical;
      if (transition.kind === 'compiler-local-locator' &&
          transition.phase === 'recovery-required' &&
          transition.stage?.kind === 'directory' && stage?.kind === 'absent' &&
          recordedStageRoot.kind === 'directory' && recordedStagePhysical !== null &&
          stageRoot?.kind === 'absent' &&
          backup?.kind === 'directory' && backup.physical !== null &&
          sameGeneratedStateIdentity(backup.physical, transition.sourceGeneration.physical)) {
        const stageIntents = await readCompilerDependencyStageIntents(root, options);
        durableStageSettlement = stageIntents.settled.some((intent) =>
          (intent.outcome === 'immutable-generation-published' ||
            intent.outcome === 'generation-staging-recovered') &&
          path.resolve(intent.stageRootPath) === path.resolve(recordedStageRoot.path) &&
          sameGeneratedStateIdentity(intent.stageRootPhysical, recordedStagePhysical)
        );
      }
      const alreadyDisposed = transition.stageRoot.kind === 'directory' &&
        transition.stage?.kind === 'absent' && stageRoot?.kind === 'absent' &&
        (transition.phase === 'published' || transition.phase === 'binding-validated' ||
          transition.phase === 'stamp-readback' || transition.phase === 'recovery-required');
      if (!alreadyDisposed && !durableStageSettlement) {
        return failRecovery(new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency staging root identity changed and is preserved'));
      }
    }

    if (transition.kind === 'compiler-generation') {
      if (transition.preimage.kind !== 'absent' && transition.preimage.kind !== 'directory') {
        return failRecovery(new CodedFailure('IMPORT-AUTHORITY-004', 'Foreign compiler dependency preimage is preserved'));
      }
      if (transition.preimage.kind === 'directory' && backupPath !== null &&
        (transition.phase === 'prepared' || transition.phase === 'recovery-required') &&
        active.kind === 'directory' &&
        transition.preimage.physical !== null &&
        sameGeneratedStateIdentity(active.physical!, transition.preimage.physical) &&
        backup?.kind === 'absent') {
        const preimageAuthority = await compilerDependencyGeneratedPreimageAuthority(root, activePath, options, {
          // v2 is never a ready generation.  It is consumed only by this
          // durable recovery branch after the current v3 stage, exact
          // preimage physical epoch, backup absence and transition identity
          // have all been read back under the compiler-root lease.
          allowLegacyRuntimeMaterializationV2: transition.phase === 'recovery-required'
        });
        if (preimageAuthority.authorityDigest !== transition.preimage.bindingDigest) {
          return failRecovery(new CodedFailure(
            'IMPORT-AUTHORITY-004',
            'Compiler dependency preimage authority differs from the durable transition'
          ));
        }
        await retireCompilerDependencyExecutionProofIfPresent(root, activePath, options);
        await ensureCompilerDependencyPreimageRetiredForRecovery(
          options,
          transition.preimage.physical!,
          'generation-recovery-superseded', root
        );
        if (process.platform === 'win32' && transition.phase === 'recovery-required' &&
            preimageAuthority.reason === 'binding-content-diverged') {
          await relocateLegacyCompilerDependencyPreimage(
            root,
            transition,
            preimageAuthority,
            options,
            backupPath
          );
        } else {
          await renameCompilerDependencyDirectory(activePath, backupPath, options);
        }
        transition = await advanceDependencyTransition(transition, {
          destination: transitionAbsentSlot(activePath),
          backup: await observeDependencyTransitionSlot(backupPath, transition.preimage.bindingDigest),
          phase: 'backed-up',
          durability: 'known',
          failure: null
        }, options);
        active = await currentActive();
        stage = await currentStage();
        stageRoot = await currentStageRoot();
        backup = await currentBackup();
      } else if (transition.phase === 'prepared' && active.kind === 'absent' &&
        backup?.kind === 'directory' && stage?.kind === 'directory' && stageRoot?.kind === 'directory') {
        transition = await advanceDependencyTransition(transition, {
          destination: transitionAbsentSlot(activePath),
          stageRoot,
          backup,
          phase: 'backed-up',
          durability: 'known',
          failure: null
        }, options);
      }

      if ((transition.phase === 'prepared' || transition.phase === 'backed-up' || transition.phase === 'recovery-required') &&
        stagePath !== null && stage?.kind === 'directory' && stageRoot?.kind === 'directory') {
        if (active.kind !== 'absent') {
          if (transition.phase === 'recovery-required' && active.kind === 'directory' &&
            active.physical !== null && sameGeneratedStateIdentity(active.physical, expectedSourcePhysical)) {
            // The publish effect completed before the process lost its
            // receipt; continue with exact post-effect readback.
          } else {
            return failRecovery(new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency transition active target is occupied by an unexpected identity'));
          }
        } else {
          await renameCompilerDependencyDirectory(stagePath, activePath, options);
        }
        active = await currentActive();
        stage = await currentStage();
        stageRoot = await currentStageRoot();
        if (active.kind !== 'directory' || active.physical === null ||
          !sameGeneratedStateIdentity(active.physical, expectedSourcePhysical)) {
          return failRecovery(new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency transition active target failed identity readback'));
        }
        transition = await advanceDependencyTransition(transition, {
          destination: active,
          stage: stage ?? transitionAbsentSlot(stagePath),
          stageRoot,
          phase: 'published',
          durability: 'known',
          failure: null
        }, options);
      } else if ((transition.phase === 'prepared' || transition.phase === 'backed-up' ||
          transition.phase === 'recovery-required') && stagePath !== null &&
          stage?.kind === 'absent' && transition.stage?.kind === 'directory' &&
          transition.stage.physical !== null && active.kind === 'directory' &&
          active.physical !== null &&
          sameGeneratedStateIdentity(active.physical, transition.stage.physical)) {
        // The stage-to-active rename completed before its journal receipt.
        // The recorded stage identity, the now-absent exact child and the
        // active target identity together prove that exact move; no path or
        // source-generation identity is inferred independently.
        transition = await advanceDependencyTransition(transition, {
          destination: active,
          stage: transitionAbsentSlot(stagePath),
          stageRoot,
          sourceGeneration: sourceGenerationWithPath(transition.sourceGeneration, activePath),
          phase: 'published',
          durability: 'known',
          failure: null
        }, options);
      }

      if (active.kind !== 'directory' || active.physical === null ||
        !sameGeneratedStateIdentity(active.physical, expectedSourcePhysical)) {
        return failRecovery(new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency transition has no exact active generation'));
      }
      const binding = await compilerDependencyGenerationBinding(
        root,
        activePath,
        path.join(activePath, COMPILER_DEPS_BINDING_FILE),
        identity
      );
      if (binding === null || generatedStateDigest(binding) !== transition.sourceGeneration.bindingDigest) {
        return failRecovery(new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency transition active binding drifted'));
      }
      if (options.generatedStateLifecycle !== undefined) {
        // A crash may land after the active generation rename and journal
        // publication but before the producer registration is durably born.
        // Recovery may not declare the transition complete until the exact
        // active physical generation is bound and read back by the lifecycle
        // owner under this same compiler-root lease.
        await recoverCompilerDependencyGenerationLifecycle({
          active,
          options,
          root,
          stage,
          stagePath,
          stageRoot,
          stageRootPath,
          stagingRoot: transition.stageRoot?.path ?? path.dirname(stagePath ?? activePath),
          transition
        });
      }
      stage = await currentStage();
      stageRoot = await currentStageRoot();
      if (stageRootPath !== null && stageRoot?.kind === 'directory') {
        await disposeDependencyTransitionStage(
          root,
          stageRootPath,
          options,
          'generation-recovered',
          transition.stage,
          transition.stageRoot,
          compilerDependencyStageAuthority(root)
        );
      }
      active = await currentActive();
      stage = await currentStage();
      stageRoot = await currentStageRoot();
      backup = await currentBackup();
      transition = await advanceDependencyTransition(transition, {
        destination: active,
        stage: stage ?? (stagePath === null ? null : transitionAbsentSlot(stagePath)),
        stageRoot: stageRoot ?? (stageRootPath === null ? null : transitionAbsentSlot(stageRootPath)),
        backup,
        sourceGeneration: sourceGenerationWithPath(transition.sourceGeneration, activePath),
        phase: 'complete',
        durability: 'known',
        failure: null
      }, options);
      return;
    }

    if (transition.kind === 'compiler-local-locator') {
      if (backupPath === null) {
        return failRecovery(new CodedFailure('IMPORT-AUTHORITY-004', 'Local compiler locator has no immutable generation slot'));
      }
      let generation = await currentBackup();
      if (generation?.kind === 'absent' && stage?.kind === 'directory' && stageRoot?.kind === 'directory') {
        await renameCompilerDependencyDirectory(stage.path, backupPath, options);
        generation = await currentBackup();
        stage = await currentStage();
        stageRoot = await currentStageRoot();
      } else if (generation?.kind === 'absent' && transition.preimage.kind === 'directory' &&
          transition.preimage.physical !== null && active.kind === 'directory' && active.physical !== null &&
          sameGeneratedStateIdentity(active.physical, transition.preimage.physical)) {
        const preimageAuthority = await compilerDependencyGeneratedPreimageAuthority(
          root,
          activePath,
          options
        );
        if (preimageAuthority.authorityDigest !== transition.preimage.bindingDigest) {
          return failRecovery(new CodedFailure(
            'IMPORT-AUTHORITY-004',
            'Local compiler locator preimage authority differs from the durable transition'
          ));
        }
        await retireCompilerDependencyExecutionProofIfPresent(root, activePath, options);
        await bindAndRetireCompilerDependencyPreimage(
          options,
          transition.preimage.physical,
          'local-generation-locator-migration'
        );
        await renameCompilerDependencyDirectory(activePath, backupPath, options);
        active = await currentActive();
        generation = await currentBackup();
      }
      if (generation?.kind !== 'directory' || generation.physical === null ||
          !sameGeneratedStateIdentity(generation.physical, expectedSourcePhysical)) {
        return failRecovery(new CodedFailure(
          'IMPORT-AUTHORITY-004',
          'Local compiler immutable generation is absent or changed'
        ));
      }
      const generationBinding = await compilerDependencyGenerationBinding(
        root,
        backupPath,
        path.join(backupPath, COMPILER_DEPS_BINDING_FILE),
        identity
      );
      if (generationBinding === null ||
          generatedStateDigest(generationBinding) !== transition.sourceGeneration.bindingDigest) {
        return failRecovery(new CodedFailure(
          'IMPORT-AUTHORITY-004',
          'Local compiler immutable generation binding drifted'
        ));
      }
      const immutableSourceGeneration = await runtimeDependencySourceGeneration({
        binding: generationBinding,
        options,
        ownerRoot: root,
        sourcePath: backupPath
      });
      if (immutableSourceGeneration.epoch !== transition.sourceGeneration.epoch ||
          !sameRuntimeDependencySourceGenerationContent(
            immutableSourceGeneration,
            transition.sourceGeneration
          ) ||
          !sameGeneratedStateIdentity(
            immutableSourceGeneration.physical,
            transition.sourceGeneration.physical
          )) {
        return failRecovery(new CodedFailure(
          'IMPORT-AUTHORITY-004',
          'Local compiler immutable generation changed before read-only sealing'
        ));
      }
      if (transition.preimage.kind === 'directory' && transition.preimage.physical !== null) {
        if (active.kind === 'directory' && active.physical !== null &&
            sameGeneratedStateIdentity(active.physical, transition.preimage.physical)) {
          const preimageAuthority = await compilerDependencyGeneratedPreimageAuthority(
            root,
            activePath,
            options
          );
          if (preimageAuthority.authorityDigest !== transition.preimage.bindingDigest) {
            return failRecovery(new CodedFailure(
              'IMPORT-AUTHORITY-004',
              'Local compiler locator preimage authority differs before legacy cutover'
            ));
          }
          const legacyBinding = await readCompilerDepsBinding(
            path.join(activePath, COMPILER_DEPS_BINDING_FILE)
          );
          if (legacyBinding === null) {
            return failRecovery(new CodedFailure(
              'IMPORT-AUTHORITY-004',
              'Legacy compiler dependency generation has no canonical binding'
            ));
          }
          const legacyGeneration = await runtimeDependencySourceGeneration({
            binding: legacyBinding,
            options,
            ownerRoot: root,
            sourcePath: activePath
          });
          const legacyGenerationPath = compilerTransitionBackupPath(
            root,
            'generation',
            legacyGeneration
          );
          if (sameHostPath(legacyGenerationPath, backupPath)) {
            return failRecovery(new CodedFailure(
              'IMPORT-AUTHORITY-004',
              'Legacy and replacement compiler dependency generations have the same durable locator'
            ));
          }
          if (process.platform !== 'win32') {
            return failRecovery(new CodedFailure(
              'RUNTIME-DEPS-004',
              'Legacy compiler dependency locator cutover requires a platform-owned durable relocation capability'
            ));
          }
          await retireCompilerDependencyExecutionProofIfPresent(root, activePath, options);
          await ensureCompilerDependencyPreimageRetiredForRecovery(
            options,
            transition.preimage.physical,
            'local-generation-locator-cutover', root
          );
          const relocated = await relocateLegacyCompilerDependencyPreimage(
            root,
            transition,
            preimageAuthority,
            options,
            legacyGenerationPath
          );
          if (!sameGeneratedStateIdentity(relocated.physical, transition.preimage.physical)) {
            return failRecovery(new CodedFailure(
              'IMPORT-AUTHORITY-004',
              'Legacy compiler dependency relocation changed its physical generation'
            ));
          }
          active = await currentActive();
        } else if (active.kind === 'absent' && process.platform === 'win32') {
          // A crash after the owner-issued physical relocation leaves the
          // prepared/complete relocation intent as the only recovery input.
          // Reopen that exact capability and read the terminal topology back;
          // never infer relocation authority from absence alone.
          await relocateLegacyCompilerDependencyPreimage(
            root,
            transition,
            null,
            options
          );
          active = await currentActive();
        }
        if (active.kind === 'absent') {
          await settleRetiredCompilerDependencyGeneration(
            options,
            transition.preimage.physical
          );
        }
      }
      const activeAlreadyPublished = active.kind === 'link' &&
        sameHostPath(await fs.realpath(activePath).catch(() => ''), backupPath);
      if (active.kind === 'link' && !activeAlreadyPublished) {
        const locator = compilerDependencyLocatorObservation(root, 'node_modules');
        if (locator === null || transition.preimage.kind !== 'link' ||
            transition.preimage.physical === null ||
            !sameGeneratedStateIdentity(locator.source, transition.preimage.physical)) {
          return failRecovery(new CodedFailure(
            'IMPORT-AUTHORITY-004',
            'Local compiler locator preimage changed and is preserved'
          ));
        }
        await disposeCompilerDependencyLocator(
          root,
          options,
          'incompatible-compiler-dependency-locator'
        );
        active = await currentActive();
      }
      // Publication order is part of the capability contract: a locator may
      // never expose a writable generation. The physical generation owner
      // issues the persisted proof; a different consumer root can only reopen
      // that proof before its locator becomes visible.
      await ensureCompilerDependencyGenerationReadOnlyProof(
        root,
        immutableSourceGeneration,
        options
      );
      if (active.kind === 'absent') {
        // The slot is empty: any retired predecessor registration must reach
        // its terminal disposition before this producer signs a new birth.
        await settleRetiredCompilerDependencyGeneration(options);
        await createCompilerDependencyLocator(activePath, backupPath, generation.physical, options);
        active = await currentActive();
      }
      if (active.kind !== 'link' || !sameHostPath(await fs.realpath(activePath).catch(() => ''), backupPath)) {
        return failRecovery(new CodedFailure(
          'IMPORT-AUTHORITY-004',
          'Local compiler locator failed exact publication readback'
        ));
      }
      const observedBinding = await compilerDependencyConsumerBridgeBinding(
        root,
        activePath,
        identity,
        options
      );
      if (observedBinding === null || generatedStateDigest(observedBinding) !==
          transition.sourceGeneration.bindingDigest) {
        return failRecovery(new CodedFailure(
          'IMPORT-AUTHORITY-004',
          'Local compiler locator binding differs after publication'
        ));
      }
      if (compilerDependencyLocatorObservation(root, 'node_modules') === null) {
        return failRecovery(new CodedFailure('IMPORT-AUTHORITY-004', 'Local compiler locator identity disappeared'));
      }
      // The transition owner created this exact locator. `born` is keyed by
      // deterministic producer inputs and is therefore the recovery-capable
      // publication path whether this invocation performed the link Effect
      // or merely read it back after a crash.
      await recoverCompilerDependencyLocatorLifecycle({
        binding: observedBinding,
        generationPath: backupPath,
        generationPhysical: transition.sourceGeneration.physical,
        identity,
        options,
        root,
        stageRoot,
        stageRootPath,
        transition
      });
      // The recovery dance above may republish the locator, so the slot must
      // be re-read before the terminal receipt records its destination.
      active = await currentActive();
      if (stageRootPath !== null && stageRoot?.kind === 'directory') {
        const stageIntents = await readCompilerDependencyStageIntents(root, options);
        const stageIntent = stageIntents.active.find((intent) =>
          path.resolve(intent.stageRootPath) === path.resolve(stageRootPath));
        if (stageIntent === undefined) {
          return failRecovery(new CodedFailure(
            'IMPORT-AUTHORITY-004',
            'Local compiler locator stage has no exact settlement intent'
          ));
        }
        await settleCompilerDependencyStageIntent(
          root,
          stageIntent,
          'immutable-generation-published',
          options
        );
      }
      stage = await currentStage();
      stageRoot = await currentStageRoot();
      const sourceGeneration = await runtimeDependencySourceGeneration({
        binding: observedBinding,
        options,
        ownerRoot: root,
        sourcePath: backupPath
      });
      if (sourceGeneration.epoch !== immutableSourceGeneration.epoch ||
          !sameRuntimeDependencySourceGenerationContent(sourceGeneration, immutableSourceGeneration) ||
          !sameGeneratedStateIdentity(sourceGeneration.physical, immutableSourceGeneration.physical)) {
        return failRecovery(new CodedFailure(
          'IMPORT-AUTHORITY-004',
          'Local compiler immutable generation changed before terminal receipt'
        ));
      }
      await advanceDependencyTransition(transition, {
        destination: active,
        stage: stage ?? (stagePath === null ? null : transitionAbsentSlot(stagePath)),
        stageRoot: stageRoot ?? (stageRootPath === null ? null : transitionAbsentSlot(stageRootPath)),
        backup: generation,
        sourceGeneration,
        phase: 'complete',
        durability: 'known',
        failure: null
      }, options);
      return;
    }

    if (transition.kind === 'compiler-locator') {
      const sourcePath = transition.sourceGeneration.sourcePath;
      const sourceOwnerRoot = transition.sourceGeneration.ownerRoot;
      const currentSourcePath = await fs.realpath(
        dependencyAuthorityPaths(sourceOwnerRoot).compilerModulesRoot
      ).catch(() => null);
      if (currentSourcePath === null || !sameHostPath(currentSourcePath, sourcePath)) {
        return failRecovery(new CodedFailure(
          'IMPORT-AUTHORITY-004',
          'Linked compiler dependency source is no longer its owner current generation'
        ));
      }
      const sourceIdentity = await compilerDependencyIdentity(sourceOwnerRoot);
      const sourceBinding = await compilerDependencyGenerationBinding(
        sourceOwnerRoot,
        sourcePath,
        path.join(sourcePath, COMPILER_DEPS_BINDING_FILE),
        sourceIdentity
      );
      if (sourceBinding === null || generatedStateDigest(sourceBinding) !== transition.sourceGeneration.bindingDigest) {
        return failRecovery(new CodedFailure('IMPORT-AUTHORITY-004', 'Linked compiler dependency source drifted and is preserved'));
      }
      const sourceGeneration = await runtimeDependencySourceGeneration({
        binding: sourceBinding,
        options,
        ownerRoot: sourceOwnerRoot,
        sourcePath
      });
      if (!sameGeneratedStateIdentity(sourceGeneration.physical, expectedSourcePhysical) ||
        sourceGeneration.epoch !== transition.sourceGeneration.epoch ||
        !sameRuntimeDependencySourceGenerationContent(sourceGeneration, transition.sourceGeneration)) {
        return failRecovery(new CodedFailure('IMPORT-AUTHORITY-004', 'Linked compiler dependency source physical epoch drifted'));
      }
      if (transition.preimage.kind !== 'absent' && transition.preimage.kind !== 'directory') {
        return failRecovery(new CodedFailure('IMPORT-AUTHORITY-004', 'Foreign linked compiler dependency target is preserved'));
      }
      if (transition.preimage.kind === 'directory' && backupPath !== null && transition.phase === 'prepared' &&
        active.kind === 'directory' && transition.preimage.physical !== null && active.physical !== null &&
        sameGeneratedStateIdentity(active.physical, transition.preimage.physical) && backup?.kind === 'absent') {
        const preimageAuthority = await compilerDependencyGeneratedPreimageAuthority(
          root,
          activePath,
          options
        );
        if (preimageAuthority.authorityDigest !== transition.preimage.bindingDigest) {
          return failRecovery(new CodedFailure(
            'IMPORT-AUTHORITY-004',
            'Linked compiler dependency preimage authority differs from the durable transition'
          ));
        }
        await retireCompilerDependencyExecutionProofIfPresent(root, activePath, options);
        await bindAndRetireCompilerDependencyPreimage(
          options,
          transition.preimage.physical!,
          'locator-transition-superseded'
        );
        await renameCompilerDependencyDirectory(activePath, backupPath, options);
        transition = await advanceDependencyTransition(transition, {
          destination: transitionAbsentSlot(activePath),
          stageRoot,
          backup: await currentBackup(),
          phase: 'backed-up',
          durability: 'known',
          failure: null
        }, options);
      }
      active = await currentActive();
      if (active.kind === 'absent') {
        // Publication restores birth legality: settle any retired predecessor
        // while the slot is still empty, then create the exact locator.
        await settleRetiredCompilerDependencyGeneration(options, transition.preimage.physical ?? undefined);
        await createCompilerDependencyLocator(activePath, sourcePath, sourceGeneration.physical, options);
        active = await currentActive();
        transition = await advanceDependencyTransition(transition, {
          destination: active,
          stageRoot,
          sourceGeneration,
          phase: 'published',
          durability: 'known',
          failure: null
        }, options);
      } else if (active.kind !== 'link' || active.linkTarget === null ||
        !sameHostPath(await fs.realpath(activePath).catch(() => ''), sourcePath)) {
        return failRecovery(new CodedFailure('IMPORT-AUTHORITY-004', 'Linked compiler dependency target is foreign and preserved'));
      } else {
        // A prior attempt published this exact locator and stopped before its
        // lifecycle birth was signed.  The retired predecessor is terminal
        // only while the slot is missing, so retract the locator, settle the
        // predecessor, republish the identical generation, and let the birth
        // below sign that exact publication.
        const recoveredLocator = compilerDependencyLocatorObservation(root, 'node_modules');
        if (recoveredLocator === null) {
          return failRecovery(new CodedFailure('IMPORT-AUTHORITY-004', 'Recovered linked compiler dependency locator has no physical identity'));
        }
        await deleteExactCompilerDependencyLocator(root, recoveredLocator, options);
        await settleRetiredCompilerDependencyGeneration(options, transition.preimage.physical ?? undefined);
        await createCompilerDependencyLocator(activePath, sourcePath, sourceGeneration.physical, options);
        active = await currentActive();
      }
      const observedBinding = await compilerDependencyConsumerBridgeBinding(root, activePath, identity, options);
      if (observedBinding === null || generatedStateDigest(observedBinding) !== transition.sourceGeneration.bindingDigest) {
        return failRecovery(new CodedFailure('IMPORT-AUTHORITY-004', 'Linked compiler dependency locator failed recovery binding'));
      }
      await publishCompilerDependencyLocatorLifecycle(root, identity, observedBinding, options);
      transition = await advanceDependencyTransition(transition, {
        destination: active,
        backup: await currentBackup(),
        sourceGeneration,
        phase: 'complete',
        durability: 'known',
        failure: null
      }, options);
      return;
    }

    if (transition.kind === 'runtime-projection') {
      if (transition.preimage.kind !== 'absent' && transition.preimage.kind !== 'directory') {
        return failRecovery(new CodedFailure('RUNTIME-DEPS-004', 'Foreign shared dependency preimage is preserved'));
      }
      // A runtime projection has two independent physical identities: the
      // immutable compiler/shared source generation and the copied active
      // destination.  Recovering the latter by comparing it to
      // sourceGeneration.physical would either reject a valid copy or, worse,
      // make a destination path look like source authority.  Reconstruct and
      // re-read the source binding/tree before any remaining publish effect.
      const sourcePath = transition.sourceGeneration.sourcePath;
      if (path.resolve(sourcePath) === path.resolve(activePath) ||
          path.basename(sourcePath).toLocaleLowerCase('en-US') !== 'node_modules') {
        return failRecovery(new CodedFailure('RUNTIME-DEPS-004', 'Shared dependency source topology is foreign and preserved'));
      }
      const sourceOwnerRoot = path.resolve(transition.sourceGeneration.ownerRoot);
      const sourceCompilerIdentity = await compilerDependencyIdentity(sourceOwnerRoot);
      const sourceBinding = await compilerDependencyGenerationBinding(
        sourceOwnerRoot,
        sourcePath,
        path.join(sourcePath, COMPILER_DEPS_BINDING_FILE),
        sourceCompilerIdentity
      );
      const sourceRuntimeBinding = sourceBinding?.runtimeMaterialization ?? null;
      if (sourceRuntimeBinding === null ||
          generatedStateDigest(sourceRuntimeBinding) !== transition.sourceGeneration.bindingDigest) {
        return failRecovery(new CodedFailure('RUNTIME-DEPS-004', 'Shared dependency source binding is missing or foreign and preserved'));
      }
      const currentSourceGeneration = await runtimeDependencySourceGeneration({
        binding: sourceRuntimeBinding,
        options,
        ownerRoot: sourceOwnerRoot,
        sourcePath
      });
      if (currentSourceGeneration.epoch !== transition.sourceGeneration.epoch ||
          !sameRuntimeDependencySourceGenerationContent(currentSourceGeneration, transition.sourceGeneration) ||
          !sameGeneratedStateIdentity(currentSourceGeneration.physical, transition.sourceGeneration.physical) ||
          !sameGeneratedStateIdentity(currentSourceGeneration.ownerRootPhysical, transition.sourceGeneration.ownerRootPhysical)) {
        return failRecovery(new CodedFailure('RUNTIME-DEPS-004', 'Shared dependency source generation changed and is preserved'));
      }
      if (transition.preimage.kind === 'directory' && backupPath !== null &&
        transition.phase === 'prepared' && active.kind === 'directory' &&
        transition.preimage.physical !== null && active.physical !== null &&
        sameGeneratedStateIdentity(active.physical, transition.preimage.physical) &&
        backup?.kind === 'absent') {
        await renameCompilerDependencyDirectory(activePath, backupPath, options);
        transition = await advanceDependencyTransition(transition, {
          destination: transitionAbsentSlot(activePath),
          stageRoot,
          backup: await currentBackup(),
          phase: 'backed-up',
          durability: 'known',
          failure: null
        }, options);
        active = await currentActive();
        stage = await currentStage();
      }
      if (stagePath !== null && stage?.kind === 'directory' && stageRoot?.kind === 'directory') {
        if (active.kind !== 'absent') {
          if (active.kind !== 'directory' || active.physical === null ||
            (transition.destination.kind === 'directory' && transition.destination.physical !== null &&
              !sameGeneratedStateIdentity(active.physical, transition.destination.physical)) &&
            !sameGeneratedStateIdentity(active.physical, stage.physical!)) {
            return failRecovery(new CodedFailure('RUNTIME-DEPS-004', 'Shared dependency transition target is occupied by an unexpected identity'));
          }
        } else {
          await renameCompilerDependencyDirectory(stagePath, activePath, options);
        }
        active = await currentActive();
        stage = await currentStage();
        stageRoot = await currentStageRoot();
        if (active.kind !== 'directory' || active.physical === null ||
          (stage?.kind === 'directory' && stage.physical !== null
            ? !sameGeneratedStateIdentity(active.physical, stage.physical)
            : transition.destination.kind !== 'directory' || transition.destination.physical === null ||
              !sameGeneratedStateIdentity(active.physical, transition.destination.physical))) {
          return failRecovery(new CodedFailure('RUNTIME-DEPS-004', 'Shared dependency transition active identity is invalid'));
        }
        transition = await advanceDependencyTransition(transition, {
          destination: active,
          stage: stage ?? transitionAbsentSlot(stagePath),
          stageRoot,
          sourceGeneration: transition.sourceGeneration,
          phase: 'published',
          durability: 'known',
          failure: null
        }, options);
      } else if ((transition.phase === 'backed-up' || transition.phase === 'recovery-required') &&
          stagePath !== null && stage?.kind === 'absent' &&
          transition.stage?.kind === 'directory' && transition.stage.physical !== null &&
          active.kind === 'directory' && active.physical !== null &&
          sameGeneratedStateIdentity(active.physical, transition.stage.physical)) {
        // The stage-to-active rename may have completed just before a process
        // lost the `published` journal receipt.  The recorded stage identity
        // is the only acceptable proof for this uncertain topology; the
        // source generation identity is intentionally not reused as a target
        // identity.
        transition = await advanceDependencyTransition(transition, {
          destination: active,
          stage: transitionAbsentSlot(stagePath),
          stageRoot,
          phase: 'published',
          durability: 'known',
          failure: null
        }, options);
      }
      if (active.kind !== 'directory' || active.physical === null ||
        transition.destination.kind !== 'directory' || transition.destination.physical === null ||
        !sameGeneratedStateIdentity(active.physical, transition.destination.physical)) {
        return failRecovery(new CodedFailure('RUNTIME-DEPS-004', 'Shared dependency transition has no exact active projection'));
      }
      stage = await currentStage();
      stageRoot = await currentStageRoot();
      if (stageRootPath !== null && stageRoot?.kind === 'directory') {
        await disposeDependencyTransitionStage(
          root,
          stageRootPath,
          options,
          'runtime-projection-recovered',
          transition.stage,
          transition.stageRoot,
          runtimeDependencyStageAuthority(path.dirname(stageRootPath))
        );
      }
      transition = await advanceDependencyTransition(transition, {
        destination: await currentActive(),
        stage: stagePath === null ? null : transitionAbsentSlot(stagePath),
        stageRoot: stageRootPath === null ? null : transitionAbsentSlot(stageRootPath),
        backup: await currentBackup(),
        phase: 'complete',
        durability: 'known',
        failure: null
      }, options);
    }
  } catch (error) {
    return failRecovery(error);
  }
}

class CompilerDependencyBridgeIncompatibleError extends CodedFailure {
  constructor(readonly bridgePath: string) {
    super(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency consumer bridge has incompatible canonical inputs',
      { bridgePath }
    );
    this.name = 'CompilerDependencyBridgeIncompatibleError';
  }
}

async function compilerDependencyConsumerBridgeBinding(
  consumerRoot: string,
  bridgePath: string,
  consumerIdentity: CompilerDependencyIdentity,
  options: RuntimeDependencyInstallOptions
): Promise<Readonly<CompilerDepsBinding> | null> {
  const bridgeMetadata = await fs.lstat(bridgePath, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (bridgeMetadata === null || !bridgeMetadata.isSymbolicLink()) return null;

  try {
    const generationPath = path.resolve(await fs.realpath(bridgePath).catch((error: NodeJS.ErrnoException) => {
      // The physical owner can retire an old immutable generation while a
      // linked worktree still holds its locator.  The lifecycle owner must
      // authenticate that locator before disposal; target reachability alone
      // cannot turn it into an unowned filesystem entry.
      if (error.code === 'ENOENT') throw new CompilerDependencyBridgeIncompatibleError(bridgePath);
      throw error;
    }));
    const generationMetadata = await fs.lstat(generationPath, { bigint: true });
    const canonicalGenerationOwner = canonicalCompilerDependencyGenerationOwnerRoot(generationPath);
    const localGeneration = canonicalGenerationOwner !== null &&
      sameHostPath(canonicalGenerationOwner, consumerRoot);
    const ownerRoot = canonicalGenerationOwner ?? path.dirname(generationPath);
    if (!generationMetadata.isDirectory() || generationMetadata.isSymbolicLink() ||
      (canonicalGenerationOwner === null &&
        path.basename(generationPath).toLocaleLowerCase('en-US') !== 'node_modules') ||
      (canonicalGenerationOwner === null && sameHostPath(ownerRoot, consumerRoot))) {
      throw new Error('Dependency consumer bridge target is not one external physical generation.');
    }
    const ownerIdentity = await compilerDependencyIdentity(ownerRoot);
    if (ownerIdentity.manifestHash !== consumerIdentity.manifestHash) {
      throw new CompilerDependencyBridgeIncompatibleError(bridgePath);
    }
    const binding = await compilerDependencyGenerationBinding(
      ownerRoot,
      generationPath,
      path.join(generationPath, COMPILER_DEPS_BINDING_FILE),
      ownerIdentity
    );
    if (binding === null) {
      if (localGeneration) {
        // A dependency-input change makes the previous immutable local
        // generation a legitimate stale locator preimage.  Classify that
        // owner-bound state as incompatible so the transition lease can
        // replace only the locator; an external generation still requires a
        // positive owner binding and remains a typed authority failure.
        throw new CompilerDependencyBridgeIncompatibleError(bridgePath);
      }
      throw new Error('Dependency consumer bridge target has no valid owner binding.');
    }
    await options.testCompilerBridgeValidationHook?.('binding-observed');
    const finalOwnerIdentity = await compilerDependencyIdentity(ownerRoot);
    const finalConsumerIdentity = await compilerDependencyIdentity(consumerRoot);
    const finalBinding = await compilerDependencyGenerationBinding(
      ownerRoot,
      generationPath,
      path.join(generationPath, COMPILER_DEPS_BINDING_FILE),
      finalOwnerIdentity
    );
    await options.testCompilerBridgeValidationHook?.('final-binding-observed');
    // No asynchronous work may follow this fence: every mutable input and
    // physical bridge identity is observed in one final synchronous interval.
    const finalBridgeMetadata = lstatSync(bridgePath, { bigint: true });
    const finalGenerationPath = path.resolve(realpathSync(bridgePath));
    const finalGenerationMetadata = lstatSync(finalGenerationPath, { bigint: true });
    if (!finalBridgeMetadata.isSymbolicLink() ||
      finalBridgeMetadata.dev !== bridgeMetadata.dev ||
      finalBridgeMetadata.ino !== bridgeMetadata.ino ||
      finalBridgeMetadata.mode !== bridgeMetadata.mode ||
      !sameHostPath(finalGenerationPath, generationPath) ||
      !finalGenerationMetadata.isDirectory() || finalGenerationMetadata.isSymbolicLink() ||
      finalGenerationMetadata.dev !== generationMetadata.dev ||
      finalGenerationMetadata.ino !== generationMetadata.ino ||
      finalGenerationMetadata.mode !== generationMetadata.mode ||
      !compilerDependencyInputFenceMatches(ownerRoot, finalOwnerIdentity) ||
      !compilerDependencyInputFenceMatches(consumerRoot, finalConsumerIdentity)) {
      throw new Error('Dependency consumer bridge identity changed during validation.');
    }
    if (finalConsumerIdentity.manifestHash !== consumerIdentity.manifestHash ||
      finalOwnerIdentity.manifestHash !== finalConsumerIdentity.manifestHash ||
      finalBinding === null || !canonicalEquals(finalBinding, binding)) {
      throw new Error('Dependency consumer bridge binding changed during validation.');
    }
    return finalBinding;
  } catch (error) {
    if (error instanceof CompilerDependencyBridgeIncompatibleError) throw error;
    throw new CodedFailure(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency consumer bridge is incompatible',
      { cause: error instanceof Error ? error.message : String(error), bridgePath }
    );
  }
}

type CompilerDependencyBridgeObservation =
  | Readonly<{ status: 'absent'; binding: null }>
  | Readonly<{ status: 'incompatible'; binding: null }>
  | Readonly<{ status: 'ready'; binding: Readonly<CompilerDepsBinding> }>;

async function observeCompilerDependencyBridge(
  consumerRoot: string,
  bridgePath: string,
  consumerIdentity: CompilerDependencyIdentity,
  options: RuntimeDependencyInstallOptions
): Promise<CompilerDependencyBridgeObservation> {
  try {
    const binding = await compilerDependencyConsumerBridgeBinding(
      consumerRoot,
      bridgePath,
      consumerIdentity,
      options
    );
    return binding === null
      ? Object.freeze({ status: 'absent', binding: null })
      : Object.freeze({ status: 'ready', binding });
  } catch (error) {
    if (error instanceof CompilerDependencyBridgeIncompatibleError) {
      return Object.freeze({ status: 'incompatible', binding: null });
    }
    throw error;
  }
}

async function resolveLinkedWorktreeDependencyGeneration(input: Readonly<{
  consumerRoot: string;
  consumerIdentity: CompilerDependencyIdentity;
  options: RuntimeDependencyOperationOptions;
}>): Promise<Readonly<{
  binding: CompilerDepsBinding;
  nodeModulesPath: string;
  sourceGeneration: RuntimeDependencySourceGeneration;
}> | null> {
  const ownerAuthority = linkedWorktreeDependencyOwnerRoot(input.consumerRoot);
  if (ownerAuthority === null) return null;
  try {
    const ownerRoot = ownerAuthority.ownerRoot;
    ownerAuthority.assertCurrent();
    const ownerIdentity = await compilerDependencyIdentity(ownerRoot);
    ownerAuthority.assertCurrent();
    if (ownerIdentity.manifestHash !== input.consumerIdentity.manifestHash) return null;
    const nodeModulesPath = dependencyAuthorityPaths(ownerRoot).compilerModulesRoot;
    const generationPath = path.resolve(await fs.realpath(nodeModulesPath).catch(() => nodeModulesPath));
    const binding = await compilerDependencyGenerationBinding(
      ownerRoot,
      generationPath,
      path.join(generationPath, COMPILER_DEPS_BINDING_FILE),
      ownerIdentity
    );
    ownerAuthority.assertCurrent();
    if (binding === null) return null;
    const [finalOwnerIdentity, finalConsumerIdentity, finalBinding] = await Promise.all([
      compilerDependencyIdentity(ownerRoot),
      compilerDependencyIdentity(input.consumerRoot),
      compilerDependencyGenerationBinding(
        ownerRoot,
        generationPath,
        path.join(generationPath, COMPILER_DEPS_BINDING_FILE),
        ownerIdentity
      )
    ]);
    ownerAuthority.assertCurrent();
    if (finalOwnerIdentity.manifestHash !== input.consumerIdentity.manifestHash ||
        finalConsumerIdentity.manifestHash !== input.consumerIdentity.manifestHash ||
        finalBinding === null || !canonicalEquals(finalBinding, binding)) {
      throw new CodedFailure(
        'IMPORT-AUTHORITY-004',
        'Linked worktree dependency generation changed during validation'
      );
    }
    const sourceGeneration = await runtimeDependencySourceGeneration({
      binding: finalBinding,
      options: input.options,
      ownerRoot,
      sourcePath: generationPath
    });
    ownerAuthority.assertCurrent();
    return Object.freeze({ binding: finalBinding, nodeModulesPath: generationPath, sourceGeneration });
  } finally {
    ownerAuthority.dispose();
  }
}

async function bindExistingCompilerDependencyLocator(
  root: string,
  identity: CompilerDependencyIdentity,
  binding: CompilerDepsBinding,
  options: RuntimeDependencyInstallOptions
): Promise<void> {
  if (options.generatedStateLifecycle === undefined) return;
  const locator = compilerDependencyLocatorObservation(root, 'node_modules');
  if (locator === null) {
    throw new CodedFailure('IMPORT-AUTHORITY-004', 'Existing compiler dependency locator disappeared before provenance binding');
  }
  const bind = options.generatedStateLifecycle.bind;
  if (bind === undefined) {
    throw new CodedFailure('IMPORT-AUTHORITY-004', 'Existing compiler dependency locator has no read-only provenance binding path');
  }
  await bind('node_modules', {
    owner: COMPILER_NODE_MODULES_LIFECYCLE_OWNER,
    producer: COMPILER_NODE_MODULES_LIFECYCLE_PRODUCER,
    ruleId: COMPILER_NODE_MODULES_LIFECYCLE_RULE,
    physical: locator.source
  });
  const registrationBinding = await compilerDependencyConsumerBridgeBinding(
    root,
    path.join(root, 'node_modules'),
    identity,
    options
  );
  if (registrationBinding === null || !canonicalEquals(registrationBinding, binding)) {
    throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency locator changed after provenance binding');
  }
}

async function disposeCompilerDependencyLocator(
  root: string,
  options: RuntimeDependencyInstallOptions,
  outcome: string
): Promise<boolean> {
  const locator = compilerDependencyLocatorObservation(root, 'node_modules');
  if (locator === null) return false;
  const lifecycle = options.generatedStateLifecycle;
  if (lifecycle?.bind === undefined || lifecycle.observeRetirement === undefined) {
    throw new CodedFailure(
      'IMPORT-AUTHORITY-004',
      'Incompatible compiler dependency locator has no lifecycle disposal authority'
    );
  }
  const expected = Object.freeze({
    owner: COMPILER_NODE_MODULES_LIFECYCLE_OWNER,
    producer: COMPILER_NODE_MODULES_LIFECYCLE_PRODUCER,
    ruleId: COMPILER_NODE_MODULES_LIFECYCLE_RULE,
    physical: locator.source
  });
  const observation = await lifecycle.observeRetirement('node_modules', expected);
  const { assertGeneratedStateDisposalReceipt, assertGeneratedStateRetirementObservation } = await import(
    '../../../runtime-state/generated-state/lifecycle-evidence.ts'
  );
  await assertGeneratedStateRetirementObservation(observation, { workspaceRoot: root, relativePath: observation.relativePath });
  if (observation.status === 'active') await lifecycle.bind('node_modules', expected);
  else if (observation.status !== 'retired-present') {
    throw new CodedFailure(
      'IMPORT-AUTHORITY-004',
      'Incompatible compiler dependency locator retirement state is not recoverable'
    );
  }
  const receipt = await lifecycle.disposed('node_modules', {
    outcome,
    profile: 'all-rebuildable'
  });
  await assertGeneratedStateDisposalReceipt(receipt, { workspaceRoot: root, relativePath: receipt.relativePath });
  if (receipt.relativePath !== 'node_modules' || receipt.profile !== 'all-rebuildable') {
    throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency locator disposal receipt differs');
  }
  if (compilerDependencyLocatorObservation(root, 'node_modules') !== null) {
    throw new CodedFailure(
      'IMPORT-AUTHORITY-004',
      'Incompatible compiler dependency locator remains after lifecycle disposal'
    );
  }
  return true;
}

/**
 * A locator created by this producer is the sole positive path allowed to
 * issue a fresh lifecycle registration.  Existing/fresh-process locators use
 * `bindExistingCompilerDependencyLocator` above and can never self-sign.
 */
async function publishCompilerDependencyLocatorLifecycle(
  root: string,
  identity: CompilerDependencyIdentity,
  binding: CompilerDepsBinding,
  options: RuntimeDependencyInstallOptions
): Promise<void> {
  if (options.generatedStateLifecycle === undefined) return;
  const locator = compilerDependencyLocatorObservation(root, 'node_modules');
  if (locator === null) {
    throw new CodedFailure('IMPORT-AUTHORITY-004', 'Published compiler dependency locator has no physical identity');
  }
  await options.generatedStateLifecycle.born(
    'node_modules',
    `compiler-dependency-bridge:${identity.manifestHash}:${generatedStateDigest(binding)}`
  );
  await bindExistingCompilerDependencyLocator(root, identity, binding, options);
}

async function recoverCompilerDependencyLocatorLifecycle(input: Readonly<{
  binding: CompilerDepsBinding;
  generationPath: string;
  generationPhysical: GeneratedStatePhysicalIdentity;
  identity: CompilerDependencyIdentity;
  options: RuntimeDependencyOperationOptions;
  root: string;
  stageRoot: DependencyTransitionSlot | null;
  stageRootPath: string | null;
  transition: DependencyTransitionJournal;
}>): Promise<void> {
  const lifecycle = input.options.generatedStateLifecycle;
  const observeRetirement = lifecycle?.observeRetirement;
  if (lifecycle === undefined) {
    throw new CodedFailure(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency locator recovery requires a producer lifecycle capability'
    );
  }
  if (observeRetirement === undefined) {
    throw new CodedFailure(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency locator recovery requires producer retirement observation'
    );
  }
  if (lifecycle.bind === undefined) {
    throw new CodedFailure(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency locator recovery requires producer binding'
    );
  }
  const locator = compilerDependencyLocatorObservation(input.root, 'node_modules');
  if (locator === null) {
    throw new CodedFailure('IMPORT-AUTHORITY-004', 'Recovered compiler dependency locator has no physical identity');
  }
  const expected = Object.freeze({
    owner: COMPILER_NODE_MODULES_LIFECYCLE_OWNER,
    producer: COMPILER_NODE_MODULES_LIFECYCLE_PRODUCER,
    ruleId: COMPILER_NODE_MODULES_LIFECYCLE_RULE,
    physical: locator.source
  });
  const observation = await observeRetirement('node_modules', expected);
  const { assertGeneratedStateRetirementObservation } = await import(
    '../../../runtime-state/generated-state/lifecycle-evidence.ts'
  );
  await assertGeneratedStateRetirementObservation(observation, { workspaceRoot: input.root, relativePath: observation.relativePath });
  if (observation.status === 'active') {
    await bindExistingCompilerDependencyLocator(
      input.root,
      input.identity,
      input.binding,
      input.options
    );
    return;
  }
  const recordedStagePhysical = input.transition.stageRoot?.physical;
  const recoverableStageRegistration = observation.status === 'mismatch' &&
    input.stageRootPath !== null && input.stageRoot?.kind === 'directory' &&
    input.stageRoot.physical !== null && recordedStagePhysical !== null &&
    recordedStagePhysical !== undefined &&
    sameGeneratedStateIdentity(input.stageRoot.physical, recordedStagePhysical);
  if (recoverableStageRegistration) {
    const relativeStageRoot = path.relative(input.root, input.stageRootPath!).replaceAll('\\', '/');
    await lifecycle.bind(
      relativeStageRoot,
      compilerDependencyStagingLifecycleExpectation(input.stageRoot!.physical!)
    );
    // Birth is legal only while the phase ledger holds no registration, and
    // settlement is legal only while the slot is physically missing.  A
    // retired predecessor left by an interrupted publication therefore needs
    // the same retract -> settle -> restore order as the generation recovery
    // dance: remove this transition's exact locator, settle the retired
    // registration, republish the identical immutable generation, and only
    // then sign birth and binding on that exact publication.
    await deleteExactCompilerDependencyLocator(input.root, locator, input.options);
    await settleRetiredCompilerDependencyGeneration(input.options);
    await createCompilerDependencyLocator(
      path.join(input.root, 'node_modules'),
      input.generationPath,
      input.generationPhysical,
      input.options
    );
    await publishCompilerDependencyLocatorLifecycle(
      input.root,
      input.identity,
      input.binding,
      input.options
    );
    return;
  }
  throw new CodedFailure(
    'IMPORT-AUTHORITY-004',
    'Compiler dependency locator provenance is foreign, stale, retired, or unresolved and is preserved',
    { observationDigest: observation.observationDigest, status: observation.status }
  );
}

async function deleteExactCompilerDependencyLocator(
  rootPath: string,
  expected: Readonly<{ source: GeneratedStatePhysicalIdentity; linkTarget: string }>,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const root = inspectNoFollowDirectoryChain(rootPath, 'Compiler dependency locator cleanup root').target;
  const locator = inspectNoFollowLinkEntry(root, 'node_modules');
  if (locator === null) {
    throw new Error('Compiler dependency locator disappeared before exact rollback.');
  }
  if (locator.linkTarget === null || locator.kind !== 'link') {
    throw new Error('Compiler dependency locator changed before exact rollback.');
  }
  const observedSource = Object.freeze({
    device: locator.device,
    inode: locator.inode,
    objectId: generatedStateDigest({ kind: 'link', target: locator.linkTarget })
  });
  if (!sameGeneratedStatePhysicalIdentity(observedSource, expected.source)
      || locator.linkTarget !== expected.linkTarget) {
    throw new Error('Compiler dependency locator changed before exact rollback.');
  }
  await runtimeDependencyOperationEffectFence(options, 'Compiler dependency locator rollback');
  deleteRetainedNoFollowEntry({
    root,
    relativePath: 'node_modules',
    kind: 'link',
    device: locator.device,
    inode: locator.inode,
    expectedLinkTarget: locator.linkTarget,
    ancestorDirectories: Object.freeze([])
  });
  if (compilerDependencyLocatorObservation(rootPath, 'node_modules') !== null) {
    throw new Error('Compiler dependency locator remains after exact rollback.');
  }
}

type SharedDependencyRetirementInventory = Readonly<{
  membership: 'current-spec' | 'not-current-spec';
  treeDigest: `sha256:${string}`;
  treeEntryCount: number;
}>;

async function sharedDependencyRetirementInventory(
  root: PhysicalDirectoryIdentity,
  spec: RuntimeDependencySpec,
  options: RuntimeDependencyOperationOptions,
  label: string
): Promise<SharedDependencyRetirementInventory> {
  runtimeDependencyOperationRemainingMs(options, `${label} admission`);
  const before = assertSameNoFollowDirectoryIdentity(root, `${label} root before inventory`).target;
  const inventory = scanNoFollowDirectoryTreeInventory(before, {
    deadlineAtMs: runtimeDependencyOperationDeadlineAt(options, label),
    maximumBytes: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES,
    maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
    signal: runtimeDependencyOperationContext(options).signal
  });
  const stampPresent = inventory.some(({ relativePath }) =>
    relativePath === 'runtime-deps.stamp.json'
  );
  const stamp = stampPresent
    ? await readRuntimeDepsStamp(path.join(before.path, 'runtime-deps.stamp.json'))
    : null;
  if (stampPresent && stamp === null) {
    throw new CodedFailure(
      'RUNTIME-DEPS-002',
      'Shared dependency retirement cannot classify a present noncanonical runtime dependency stamp; physical root is preserved'
    );
  }
  const after = assertSameNoFollowDirectoryIdentity(root, `${label} root after inventory`).target;
  if (!sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(before),
    generatedStatePhysicalIdentity(after)
  )) {
    throw new CodedFailure(
      'IMPORT-AUTHORITY-004',
      'Shared dependency root identity changed during bounded retirement inventory; physical root is preserved'
    );
  }
  const identity = runtimeDependencyTreeIdentity(inventory);
  return Object.freeze({
    membership: stamp?.manifestHash === spec.manifestHash ? 'current-spec' : 'not-current-spec',
    ...identity
  });
}

async function recoverCompilerDependencyGenerationLifecycle(input: Readonly<{
  active: DependencyTransitionSlot;
  options: RuntimeDependencyOperationOptions;
  root: string;
  stage: DependencyTransitionSlot | null;
  stagePath: string | null;
  stageRoot: DependencyTransitionSlot | null;
  stageRootPath: string | null;
  stagingRoot: string;
  transition: DependencyTransitionJournal;
}>): Promise<void> {
  if (input.active.kind !== 'directory' || input.active.physical === null) {
    throw new CodedFailure(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency lifecycle recovery has no exact active generation'
    );
  }
  try {
    await bindExistingCompilerDependencyGeneration(input.options, input.active.physical);
    return;
  } catch (bindingError) {
    const lifecycle = input.options.generatedStateLifecycle;
    const stageRegistrationPhysical = input.transition.stageRoot?.physical;
    if (lifecycle?.bind === undefined || input.stagePath === null || input.stageRootPath === null ||
        input.stage?.kind !== 'absent' || input.stageRoot?.kind !== 'directory' ||
        input.stageRoot.physical === null || stageRegistrationPhysical === undefined ||
        stageRegistrationPhysical === null ||
        !sameGeneratedStateIdentity(input.stageRoot.physical, stageRegistrationPhysical) ||
        !sameGeneratedStateIdentity(input.active.physical, input.transition.sourceGeneration.physical)) {
      throw bindingError;
    }

    const relativeStageRoot = path.relative(input.root, input.stageRootPath).replaceAll('\\', '/');
    await lifecycle.bind(
      relativeStageRoot,
      compilerDependencyStagingLifecycleExpectation(input.stageRoot.physical)
    );

    // The only recoverable missing-birth window is:
    //   staged registration active -> physical rename -> active birth absent.
    // Move the same retained directory back to its recorded empty stage slot,
    // settle the prior retired target registration while the target is absent,
    // then replay the original rename and issuer birth.  Every interruption of
    // this sequence remains recognizable from the immutable transition record.
    await retireCompilerDependencyExecutionProofIfPresent(
      input.root,
      input.active.path,
      input.options
    );
    await renameCompilerDependencyDirectory(input.active.path, input.stagePath, input.options);
    let activeRestored = false;
    try {
      await settleRetiredCompilerDependencyGeneration(
        input.options,
        input.transition.preimage.kind === 'directory'
          ? input.transition.preimage.physical ?? undefined
          : undefined
      );
      await renameCompilerDependencyDirectory(input.stagePath, input.active.path, input.options);
      activeRestored = true;
      const restored = await observeDependencyTransitionSlot(
        input.active.path,
        input.transition.sourceGeneration.bindingDigest
      );
      if (restored.kind !== 'directory' || restored.physical === null ||
          !sameGeneratedStateIdentity(restored.physical, input.active.physical)) {
        throw new CodedFailure(
          'IMPORT-AUTHORITY-004',
          'Compiler dependency lifecycle recovery changed the active physical generation'
        );
      }
      await birthAndBindCompilerDependencyGeneration(
        input.options,
        input.stagingRoot,
        restored.physical
      );
    } catch (error) {
      if (!activeRestored) {
        const currentStage = await observeDependencyTransitionSlot(input.stagePath).catch(() => null);
        const currentActive = await observeDependencyTransitionSlot(input.active.path).catch(() => null);
        if (currentStage?.kind === 'directory' && currentStage.physical !== null &&
            sameGeneratedStateIdentity(currentStage.physical, input.active.physical) &&
            currentActive?.kind === 'absent') {
          await renameCompilerDependencyDirectory(input.stagePath, input.active.path, input.options);
        }
      }
      throw error;
    }
  }
}

/**
 * Proves that an incompatible physical directory is an SEC-generated
 * dependency generation before it may be moved out of the active locator.
 * The binding is not required to match the new epoch, but its own package
 * manifests and immutable envelope must still match the physical preimage.
 */
type CompilerDependencyPreimagePackageObservation = Readonly<{
  locator: string;
  expectedManifestSha256: string;
  expectedVersion: string;
  actualDeclaredName: string;
  actualManifestSha256: string;
  actualVersion: string;
  matchesBinding: boolean;
}>;

type CompilerDependencyPreimageAuthority = Readonly<{
  schema: 'sec-compiler-dependency-quarantine-preimage-v1';
  authorityDigest: `sha256:${string}`;
  bindingDigest: `sha256:${string}`;
  runtimeMaterializationDigest: `sha256:${string}` | null;
  packages: readonly CompilerDependencyPreimagePackageObservation[];
  physical: Readonly<GeneratedStatePhysicalIdentity>;
  treeDigest: `sha256:${string}`;
  treeEntryCount: number;
  reason: 'binding-current' | 'binding-content-diverged';
}>;

type CompilerDependencyLegacyRelocationIntent = Readonly<{
  schema: 'sec-compiler-dependency-legacy-relocation-intent-v1';
  intentDigest: `sha256:${string}`;
  previousIntentDigest: `sha256:${string}` | null;
  phase: 'prepared' | 'complete';
  operationKey: `sha256:${string}`;
  transitionRecordDigest: `sha256:${string}`;
  preimageAuthorityDigest: `sha256:${string}`;
  targetGenerationDigest: `sha256:${string}`;
  sourcePath: string;
  destinationPath: string;
  sourcePhysical: Readonly<GeneratedStatePhysicalIdentity>;
  relocationProofText: string;
  relocationProofDigest: `sha256:${string}`;
  predecessorDescriptorDigest: `sha256:${string}` | null;
  temporaryDescriptorDigest: `sha256:${string}` | null;
}>;

function compilerDependencyLegacyRelocationIntent(
  input: Omit<CompilerDependencyLegacyRelocationIntent, 'intentDigest' | 'schema'>
): CompilerDependencyLegacyRelocationIntent {
  const unsigned = Object.freeze({
    schema: 'sec-compiler-dependency-legacy-relocation-intent-v1' as const,
    ...input
  });
  return Object.freeze({ ...unsigned, intentDigest: generatedStateDigest(unsigned) });
}

function parseCompilerDependencyLegacyRelocationIntent(
  bytes: Uint8Array,
  expectedName?: string
): CompilerDependencyLegacyRelocationIntent {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch (error) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency legacy relocation intent is invalid JSON', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency legacy relocation intent is invalid');
  }
  const intent = value as CompilerDependencyLegacyRelocationIntent;
  const keys = [
    'destinationPath', 'intentDigest', 'operationKey', 'phase', 'predecessorDescriptorDigest',
    'preimageAuthorityDigest', 'previousIntentDigest', 'relocationProofDigest',
    'relocationProofText', 'schema', 'sourcePath', 'sourcePhysical', 'targetGenerationDigest',
    'temporaryDescriptorDigest', 'transitionRecordDigest'
  ];
  if (Object.keys(value).sort(compareCodeUnits).join('\0') !== keys.sort(compareCodeUnits).join('\0') ||
      intent.schema !== 'sec-compiler-dependency-legacy-relocation-intent-v1' ||
      !isSha256Digest(intent.intentDigest) || !isSha256Digest(intent.operationKey) ||
      !isSha256Digest(intent.transitionRecordDigest) || !isSha256Digest(intent.preimageAuthorityDigest) ||
      !isSha256Digest(intent.targetGenerationDigest) || !isSha256Digest(intent.relocationProofDigest) ||
      !isGeneratedStatePhysicalIdentity(intent.sourcePhysical) ||
      !path.isAbsolute(intent.sourcePath) || !path.isAbsolute(intent.destinationPath) ||
      !['prepared', 'complete'].includes(intent.phase) ||
      !(intent.previousIntentDigest === null || isSha256Digest(intent.previousIntentDigest)) ||
      !(intent.predecessorDescriptorDigest === null || isSha256Digest(intent.predecessorDescriptorDigest)) ||
      !(intent.temporaryDescriptorDigest === null || isSha256Digest(intent.temporaryDescriptorDigest)) ||
      digest(Buffer.from(intent.relocationProofText, 'utf8')) !== intent.relocationProofDigest.slice('sha256:'.length) ||
      compilerDependencyLegacyRelocationIntent({
        previousIntentDigest: intent.previousIntentDigest,
        phase: intent.phase,
        operationKey: intent.operationKey,
        transitionRecordDigest: intent.transitionRecordDigest,
        preimageAuthorityDigest: intent.preimageAuthorityDigest,
        targetGenerationDigest: intent.targetGenerationDigest,
        sourcePath: intent.sourcePath,
        destinationPath: intent.destinationPath,
        sourcePhysical: intent.sourcePhysical,
        relocationProofText: intent.relocationProofText,
        relocationProofDigest: intent.relocationProofDigest,
        predecessorDescriptorDigest: intent.predecessorDescriptorDigest,
        temporaryDescriptorDigest: intent.temporaryDescriptorDigest
      }).intentDigest !== intent.intentDigest ||
      (expectedName !== undefined && expectedName !== `relocation-${intent.operationKey.slice('sha256:'.length)}-${intent.phase}.json`)) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency legacy relocation intent differs from its canonical identity');
  }
  return Object.freeze(intent);
}

function assertCompilerDependencyLegacyRelocationIntentBytes(bytes: Uint8Array): void {
  parseCompilerDependencyLegacyRelocationIntent(bytes);
}

function compilerDependencyLegacyRelocationOperation(
  transition: DependencyTransitionJournal,
  options: RuntimeDependencyOperationOptions
): BoundSemanticOperation {
  const context = runtimeDependencyOperationContext(options);
  const contractDigest = generatedStateDigest(Object.freeze({
    schema: 'sec-compiler-dependency-legacy-relocation-contract-v1',
    operationKey: transition.operationKey,
    preimage: transition.preimage,
    targetGenerationDigest: transition.sourceGeneration.epoch
  }));
  const attempt = issueSemanticOperationAttemptContext({
    authorityGrantDigest: transition.recordDigest,
    runIdDigest: generatedStateDigest(Object.freeze({ operationId: context.operationId })),
    resumeEpochDigest: transition.previousRecordDigest
  });
  const requirement = Object.freeze({
    id: 'runtime-physical.legacy-relocation',
    contractDigest,
    effectKinds: Object.freeze(['filesystem', 'persistent-state'] as const),
    failureKinds: Object.freeze([
      'descriptor-drift', 'identity-drift', 'deadline-exhausted', 'relocation-failed'
    ])
  });
  const plan = compileSemanticOperationPlan({
    operation: 'compiler-dependency.legacy-relocation',
    intentDigest: transition.operationKey,
    // Recovery attempts change the journal tip, but never the stable physical
    // operation identity.  Bind retries to the immutable operation key and
    // keep the current record only in the attempt authority grant.
    decisionDigest: transition.operationKey,
    deadlineAtUnixMs: Date.now() + Math.max(1, Math.floor(runtimeDependencyOperationRemainingMs(
      options,
      'Compiler dependency legacy relocation operation admission'
    ))),
    aggregateBudgets: Object.freeze([
      Object.freeze({ resource: 'duration-ms' as const, maximum: Math.max(1, Math.floor(
        context.deadlineAtMonotonicMs - performance.now()
      )) }),
      Object.freeze({ resource: 'records' as const, maximum: 2 })
    ]),
    requirements: Object.freeze([requirement]),
    attempt
  });
  const binding = compileCapabilityBinding({
    requirementId: requirement.id,
    contractDigest,
    providerIdentityDigest: generatedStateDigest(Object.freeze({
      schema: 'sec-runtime-physical-provider-v1',
      platform: process.platform
    }))
  });
  return bindSemanticOperation(plan, [binding]);
}

async function compilerDependencyGeneratedPreimageAuthority(
  ownerRoot: string,
  nodeModulesPath: string,
  options: RuntimeDependencyOperationOptions,
  recovery: Readonly<{ allowLegacyRuntimeMaterializationV2: boolean }> = Object.freeze({
    allowLegacyRuntimeMaterializationV2: false
  })
): Promise<CompilerDependencyPreimageAuthority> {
  const bindingPath = path.join(nodeModulesPath, COMPILER_DEPS_BINDING_FILE);
  const bindingMetadata = await fs.lstat(bindingPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (bindingMetadata === null || !bindingMetadata.isFile() || bindingMetadata.isSymbolicLink()) {
    throw new CodedFailure(
      'IMPORT-AUTHORITY-004',
      'Existing node_modules is not an owned compiler dependency generation and is preserved'
    );
  }
  const candidate = await readJson<unknown>(bindingPath).catch(() => null);
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)
      || Object.getPrototypeOf(candidate) !== Object.prototype) {
    throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency preimage binding is malformed and preserved');
  }
  const binding = candidate as Record<string, unknown>;
  if (Object.keys(binding).sort(compareCodeUnits).join('\0')
      !== [...COMPILER_DEPS_BINDING_KEYS].sort(compareCodeUnits).join('\0')
      || binding.formatVersion !== 'compiler-deps-binding-v5'
      || typeof binding.architecture !== 'string'
      || typeof binding.bunExecutablePath !== 'string'
      || typeof binding.bunExecutableSha256 !== 'string'
      || typeof binding.bunVersion !== 'string'
      || typeof binding.declaredBunVersion !== 'string'
      || typeof binding.dependencyManifestSha256 !== 'string'
      || !(binding.installConfigSha256 === null || typeof binding.installConfigSha256 === 'string')
      || typeof binding.lockSha256 !== 'string'
      || typeof binding.manifestHash !== 'string'
      || typeof binding.platform !== 'string'
      || !Array.isArray(binding.packages)
      || binding.packages.length === 0
      || binding.packages.length > 10_000
      || !(binding.runtimeMaterialization === null
        || isRuntimeDependencyMaterializationBinding(binding.runtimeMaterialization)
        || (recovery.allowLegacyRuntimeMaterializationV2 &&
          parseLegacyRuntimeDependencyMaterializationV2ForRecovery(
            binding.runtimeMaterialization
          ) !== null))) {
    throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency preimage binding shape is invalid and preserved');
  }
  for (const value of [
    binding.bunExecutableSha256,
    binding.dependencyManifestSha256,
    binding.lockSha256,
    binding.manifestHash,
    ...(binding.installConfigSha256 === null ? [] : [binding.installConfigSha256])
  ]) {
    if (!/^[0-9a-f]{64}$/u.test(value as string)) {
      throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency preimage digest is invalid and preserved');
    }
  }
  const packageNames = new Set<string>();
  const packageObservations: CompilerDependencyPreimagePackageObservation[] = [];
  for (const rawPackage of binding.packages) {
    if (rawPackage === null || typeof rawPackage !== 'object' || Array.isArray(rawPackage)
        || Object.getPrototypeOf(rawPackage) !== Object.prototype) {
      throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency preimage package binding is invalid');
    }
    const packageBinding = rawPackage as Record<string, unknown>;
    const expectedKeys = packageBinding.entry === undefined
      ? ['manifestSha256', 'name', 'version']
      : ['entry', 'manifestSha256', 'name', 'version'];
    if (Object.keys(packageBinding).sort(compareCodeUnits).join('\0') !== expectedKeys.join('\0')
        || typeof packageBinding.name !== 'string'
        || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u.test(packageBinding.name)
        || typeof packageBinding.version !== 'string'
        || packageBinding.version.length === 0
        || typeof packageBinding.manifestSha256 !== 'string'
        || !/^[0-9a-f]{64}$/u.test(packageBinding.manifestSha256)
        || packageNames.has(packageBinding.name)) {
      throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency preimage package identity is invalid');
    }
    packageNames.add(packageBinding.name);
    if (packageBinding.entry !== undefined) {
      const entry = packageBinding.entry;
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)
          || Object.getPrototypeOf(entry) !== Object.prototype
          || Object.keys(entry).sort(compareCodeUnits).join('\0') !== ['path', 'sha256'].join('\0')
          || typeof (entry as Record<string, unknown>).path !== 'string'
          || typeof (entry as Record<string, unknown>).sha256 !== 'string'
          || !/^[0-9a-f]{64}$/u.test((entry as Record<string, unknown>).sha256 as string)) {
        throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency preimage entry identity is invalid');
      }
    }
    const packageManifestPath = path.join(
      nodeModulesPath,
      ...packageBinding.name.split('/'),
      'package.json'
    );
    let manifestHandle: Awaited<ReturnType<typeof fs.open>>;
    try {
      manifestHandle = await fs.open(packageManifestPath, 'r');
    } catch (error) {
      throw new CodedFailure(
        'IMPORT-AUTHORITY-004',
        'Compiler dependency preimage package manifest cannot be opened safely',
        { cause: error instanceof Error ? error.message : String(error) }
      );
    }
    let manifestBytes: Buffer;
    try {
      const opened = await manifestHandle.stat();
      const manifestMetadata = await fs.lstat(packageManifestPath);
      const physicalManifestPath = await fs.realpath(packageManifestPath);
      if (!opened.isFile() || !manifestMetadata.isFile() || manifestMetadata.isSymbolicLink()
        || opened.dev !== manifestMetadata.dev || opened.ino !== manifestMetadata.ino
        || opened.mode !== manifestMetadata.mode || opened.size !== manifestMetadata.size
        || opened.mtimeMs !== manifestMetadata.mtimeMs
        || !isPathInside(nodeModulesPath, physicalManifestPath)) {
        throw new CodedFailure(
          'IMPORT-AUTHORITY-004',
          'Compiler dependency preimage package manifest is not one stable physical file'
        );
      }
      manifestBytes = await manifestHandle.readFile();
      const [afterHandle, afterPath] = await Promise.all([
        manifestHandle.stat(),
        fs.lstat(packageManifestPath)
      ]);
      if (afterHandle.dev !== opened.dev || afterHandle.ino !== opened.ino
        || afterHandle.mode !== opened.mode || afterHandle.size !== opened.size
        || afterHandle.mtimeMs !== opened.mtimeMs
        || afterPath.dev !== opened.dev || afterPath.ino !== opened.ino
        || afterPath.mode !== opened.mode || afterPath.size !== opened.size
        || afterPath.mtimeMs !== opened.mtimeMs) {
        throw new CodedFailure(
          'IMPORT-AUTHORITY-004',
          'Compiler dependency preimage package manifest changed during retained read'
        );
      }
    } finally {
      await manifestHandle.close();
    }
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as Record<string, unknown>;
    // `packageBinding.name` is the dependency locator under node_modules, not
    // necessarily the package's declared name: npm aliases deliberately make
    // those identities differ (for example `@typescript/native` resolves to
    // the `typescript` package).  The exact manifest digest binds the declared
    // package name without conflating it with the locator identity.
    const actualManifestSha256 = digest(manifestBytes);
    if (typeof manifest.name !== 'string'
        || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u.test(manifest.name)
        || typeof manifest.version !== 'string' || manifest.version.length === 0) {
      throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency preimage package manifest identity is invalid and preserved');
    }
    packageObservations.push(Object.freeze({
      locator: packageBinding.name,
      expectedManifestSha256: packageBinding.manifestSha256,
      expectedVersion: packageBinding.version,
      actualDeclaredName: manifest.name,
      actualManifestSha256,
      actualVersion: manifest.version,
      matchesBinding: actualManifestSha256 === packageBinding.manifestSha256 &&
        manifest.version === packageBinding.version
    }));
  }
  packageObservations.sort((left, right) => compareCodeUnits(left.locator, right.locator));
  const bindingDigest = generatedStateDigest(binding);
  const runtimeMaterializationDigest = binding.runtimeMaterialization === null
    ? null
    : generatedStateDigest(binding.runtimeMaterialization);
  const reason = packageObservations.every(({ matchesBinding }) => matchesBinding)
    ? 'binding-current' as const
    : 'binding-content-diverged' as const;
  const authorityBasis = Object.freeze({
    schema: 'sec-compiler-dependency-quarantine-preimage-v1' as const,
    bindingDigest,
    runtimeMaterializationDigest,
    packages: Object.freeze(packageObservations),
    reason
  });
  const generation = await runtimeDependencySourceGeneration({
    binding: authorityBasis,
    options,
    ownerRoot,
    sourcePath: nodeModulesPath
  });
  const unsigned = Object.freeze({
    ...authorityBasis,
    physical: generation.physical,
    treeDigest: generation.treeDigest,
    treeEntryCount: generation.treeEntryCount
  });
  return Object.freeze({
    ...unsigned,
    authorityDigest: generatedStateDigest(unsigned)
  });
}

async function relocateLegacyCompilerDependencyPreimage(
  root: string,
  transition: DependencyTransitionJournal,
  authority: CompilerDependencyPreimageAuthority | null,
  options: RuntimeDependencyOperationOptions,
  requestedDestinationPath?: string
): Promise<Readonly<{
  destinationPath: string;
  physical: GeneratedStatePhysicalIdentity;
}>> {
  if (process.platform !== 'win32' || transition.preimage.kind !== 'directory' ||
      transition.preimage.physical === null ||
      (authority !== null && transition.preimage.bindingDigest !== authority.authorityDigest)) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency legacy relocation admission is not satisfied');
  }
  const namespace = await ensureDependencyTransitionNamespace(root, options);
  await runtimeDependencyOperationEffectFence(options, 'Compiler dependency legacy relocation namespace creation');
  const intentRoot = createNoFollowOrdinaryDirectoryChain(
    namespace.backupRoot,
    ['legacy-relocations']
  );
  const preparedName = `relocation-${transition.operationKey.slice('sha256:'.length)}-prepared.json`;
  const completeName = `relocation-${transition.operationKey.slice('sha256:'.length)}-complete.json`;
  const operation = compilerDependencyLegacyRelocationOperation(transition, options);
  const existingComplete = inspectNoFollowOrdinaryFileEntry(intentRoot, completeName);
  if (existingComplete !== null && existingComplete.bytes !== null) {
    const complete = parseCompilerDependencyLegacyRelocationIntent(existingComplete.bytes, completeName);
    if (complete.phase !== 'complete' ||
        complete.preimageAuthorityDigest !== transition.preimage.bindingDigest ||
        complete.targetGenerationDigest !== transition.sourceGeneration.epoch ||
        complete.operationKey !== transition.operationKey ||
        complete.sourcePath !== transition.preimage.path ||
        !sameGeneratedStateIdentity(complete.sourcePhysical, transition.preimage.physical) ||
        !sameHostPath(path.dirname(complete.destinationPath), namespace.backupRoot.path) ||
        (requestedDestinationPath !== undefined &&
          !sameHostPath(complete.destinationPath, requestedDestinationPath))) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency legacy relocation completion is foreign');
    }
    const relocated = relocateWindowsLegacySealedDirectory(
      openWindowsLegacySealedDirectoryRelocation({
        operation,
        recoveryProofText: complete.relocationProofText
      })
    );
    return Object.freeze({
      destinationPath: complete.destinationPath,
      physical: generatedStatePhysicalIdentity(relocated.destination)
    });
  }
  let prepared: CompilerDependencyLegacyRelocationIntent;
  let relocationCapability: WindowsLegacySealedDirectoryRelocationCapability;
  const existingPrepared = inspectNoFollowOrdinaryFileEntry(intentRoot, preparedName);
  if (existingPrepared !== null && existingPrepared.bytes !== null) {
    prepared = parseCompilerDependencyLegacyRelocationIntent(existingPrepared.bytes, preparedName);
    relocationCapability = openWindowsLegacySealedDirectoryRelocation({
      operation,
      recoveryProofText: prepared.relocationProofText
    });
  } else {
    if (authority === null || requestedDestinationPath === undefined) {
      throw new CodedFailure(
        'RUNTIME-DEPS-004',
        'Compiler dependency legacy relocation has no durable prepared authority'
      );
    }
    if (!sameHostPath(path.dirname(requestedDestinationPath), namespace.backupRoot.path)) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency legacy relocation destination is foreign');
    }
    const source = inspectNoFollowDirectoryChain(
      transition.preimage.path,
      'Compiler dependency legacy relocation source'
    ).target;
    if (!sameGeneratedStateIdentity(generatedStatePhysicalIdentity(source), authority.physical)) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency legacy relocation source physical identity changed');
    }
    relocationCapability = prepareWindowsLegacySealedDirectoryRelocation({
      directory: source,
      destinationParent: namespace.backupRoot,
      destinationName: path.basename(requestedDestinationPath),
      operation
    });
    const proofText = relocationCapability.recoveryProofText;
    prepared = compilerDependencyLegacyRelocationIntent({
      previousIntentDigest: null,
      phase: 'prepared',
      operationKey: transition.operationKey,
      transitionRecordDigest: transition.recordDigest,
      preimageAuthorityDigest: authority.authorityDigest,
      targetGenerationDigest: transition.sourceGeneration.epoch,
      sourcePath: transition.preimage.path,
      destinationPath: requestedDestinationPath,
      sourcePhysical: authority.physical,
      relocationProofText: proofText,
      relocationProofDigest: `sha256:${digest(Buffer.from(proofText, 'utf8'))}`,
      predecessorDescriptorDigest: null,
      temporaryDescriptorDigest: null
    });
    await runtimeDependencyOperationEffectFence(options, 'Compiler dependency legacy relocation intent publication');
    writeDurableTransitionFile(
      intentRoot,
      preparedName,
      Buffer.from(JSON.stringify(canonicalJson(prepared)), 'utf8'),
      assertCompilerDependencyLegacyRelocationIntentBytes,
      true
    );
    const readback = inspectNoFollowOrdinaryFileEntry(intentRoot, preparedName);
    if (readback === null || readback.bytes === null ||
        parseCompilerDependencyLegacyRelocationIntent(readback.bytes, preparedName).intentDigest !== prepared.intentDigest) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency legacy relocation intent failed readback');
    }
  }
  if (prepared.operationKey !== transition.operationKey ||
      prepared.preimageAuthorityDigest !== transition.preimage.bindingDigest ||
      prepared.targetGenerationDigest !== transition.sourceGeneration.epoch ||
      prepared.sourcePath !== transition.preimage.path ||
      !sameGeneratedStateIdentity(prepared.sourcePhysical, transition.preimage.physical) ||
      (requestedDestinationPath !== undefined &&
        !sameHostPath(prepared.destinationPath, requestedDestinationPath)) ||
      !sameHostPath(path.dirname(prepared.destinationPath), namespace.backupRoot.path)) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency legacy relocation prepared identity is foreign');
  }
  await runtimeDependencyOperationEffectFence(options, 'Compiler dependency legacy relocation');
  const relocated = relocateWindowsLegacySealedDirectory(relocationCapability);
  const complete = compilerDependencyLegacyRelocationIntent({
    previousIntentDigest: prepared.intentDigest,
    phase: 'complete',
    operationKey: prepared.operationKey,
    transitionRecordDigest: transition.recordDigest,
    preimageAuthorityDigest: prepared.preimageAuthorityDigest,
    targetGenerationDigest: prepared.targetGenerationDigest,
    sourcePath: prepared.sourcePath,
    destinationPath: prepared.destinationPath,
    sourcePhysical: prepared.sourcePhysical,
    relocationProofText: prepared.relocationProofText,
    relocationProofDigest: prepared.relocationProofDigest,
    predecessorDescriptorDigest: relocated.predecessorDescriptorDigest,
    temporaryDescriptorDigest: relocated.temporaryDescriptorDigest
  });
  await runtimeDependencyOperationEffectFence(options, 'Compiler dependency legacy relocation completion publication');
  writeDurableTransitionFile(
    intentRoot,
    completeName,
    Buffer.from(JSON.stringify(canonicalJson(complete)), 'utf8'),
    assertCompilerDependencyLegacyRelocationIntentBytes,
    true
  );
  const completionReadback = inspectNoFollowOrdinaryFileEntry(intentRoot, completeName);
  if (completionReadback === null || completionReadback.bytes === null ||
      parseCompilerDependencyLegacyRelocationIntent(completionReadback.bytes, completeName).intentDigest !== complete.intentDigest) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency legacy relocation completion failed readback');
  }
  return Object.freeze({
    destinationPath: prepared.destinationPath,
    physical: generatedStatePhysicalIdentity(relocated.destination)
  });
}

const COMPILER_DEPENDENCY_CONSUMER_SCHEMA = 'sec-compiler-dependency-consumer-v1' as const;
const COMPILER_DEPENDENCY_CONSUMER_RECORD_KEYS = Object.freeze([
  'generationDigest', 'generationPhysical', 'generationPath', 'leaseId',
  'phase', 'previousRecordDigest', 'recordDigest', 'schema'
]);

interface CompilerDependencyConsumerRecord {
  readonly schema: typeof COMPILER_DEPENDENCY_CONSUMER_SCHEMA;
  readonly recordDigest: `sha256:${string}`;
  readonly previousRecordDigest: `sha256:${string}` | null;
  readonly leaseId: `sha256:${string}`;
  readonly generationDigest: `sha256:${string}`;
  readonly generationPath: string;
  readonly generationPhysical: GeneratedStatePhysicalIdentity;
  readonly phase: 'acquired' | 'released';
}

type CompilerDependencyConsumerUnsigned = Omit<CompilerDependencyConsumerRecord, 'recordDigest'>;

function compilerDependencyConsumerRecord(
  input: CompilerDependencyConsumerUnsigned
): CompilerDependencyConsumerRecord {
  const unsigned = Object.freeze({ ...input });
  return Object.freeze({
    ...unsigned,
    recordDigest: generatedStateDigest(canonicalJson(unsigned))
  });
}

function parseCompilerDependencyConsumerRecord(
  bytes: Uint8Array,
  expectedName?: string
): CompilerDependencyConsumerRecord {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency consumer record is not canonical JSON', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (!hasExactObjectKeys(value, COMPILER_DEPENDENCY_CONSUMER_RECORD_KEYS)) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency consumer record has noncanonical keys');
  }
  const record = value as unknown as CompilerDependencyConsumerRecord;
  if (record.schema !== COMPILER_DEPENDENCY_CONSUMER_SCHEMA ||
      !isSha256Digest(record.recordDigest) ||
      (!isSha256Digest(record.previousRecordDigest) && record.previousRecordDigest !== null) ||
      !isSha256Digest(record.leaseId) || !isSha256Digest(record.generationDigest) ||
      !isCanonicalAbsolutePath(record.generationPath) ||
      !isCanonicalGeneratedStatePhysicalIdentity(record.generationPhysical) ||
      (record.phase !== 'acquired' && record.phase !== 'released')) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency consumer record fields are invalid');
  }
  const { recordDigest: _recordDigest, ...unsigned } = record;
  if (generatedStateDigest(canonicalJson(unsigned)) !== record.recordDigest) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency consumer record digest is invalid');
  }
  const expectedBytes = formatJsonFile(canonicalJson(record));
  if (expectedBytes !== Buffer.from(bytes).toString('utf8')) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency consumer record bytes are noncanonical');
  }
  if (expectedName !== undefined && expectedName !==
      `consumer-${record.leaseId.slice('sha256:'.length)}-${record.phase}.json`) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency consumer filename differs from its lease');
  }
  return Object.freeze(record);
}

async function compilerDependencyConsumerRoot(
  options: RuntimeDependencyOperationOptions
): Promise<PhysicalDirectoryIdentity> {
  runtimeDependencyOperationRemainingMs(options, 'Compiler dependency consumer namespace admission');
  return compilerDependencyCoordinationSession(options).consumers;
}

async function acquireCompilerDependencyConsumer(
  sourceGeneration: RuntimeDependencySourceGeneration,
  options: RuntimeDependencyOperationOptions
): Promise<CompilerDependencyConsumerRecord> {
  const consumers = await compilerDependencyConsumerRoot(options);
  const leaseId = generatedStateDigest(Object.freeze({
    schema: 'sec-compiler-dependency-consumer-lease-id-v1',
    generationDigest: sourceGeneration.epoch,
    generationPhysical: sourceGeneration.physical,
    nonce: crypto.randomUUID()
  }));
  const record = compilerDependencyConsumerRecord({
    schema: COMPILER_DEPENDENCY_CONSUMER_SCHEMA,
    previousRecordDigest: null,
    leaseId,
    generationDigest: sourceGeneration.epoch,
    generationPath: path.resolve(sourceGeneration.sourcePath),
    generationPhysical: sourceGeneration.physical,
    phase: 'acquired'
  });
  const name = `consumer-${leaseId.slice('sha256:'.length)}-acquired.json`;
  const recordBytes = Buffer.from(formatJsonFile(canonicalJson(record)), 'utf8');
  await runtimeDependencyOperationEffectFence(options, 'Compiler dependency consumer acquisition');
  publishExclusiveDurableCanonicalFile({
    parent: consumers,
    name,
    bytes: recordBytes,
    validate: (candidate) => { parseCompilerDependencyConsumerRecord(candidate, name); }
  });
  const readback = inspectNoFollowOrdinaryFileEntry(consumers, name);
  if (readback === null || readback.bytes === null ||
      parseCompilerDependencyConsumerRecord(readback.bytes, name).recordDigest !== record.recordDigest) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency consumer acquisition failed readback');
  }
  return record;
}

async function releaseCompilerDependencyConsumerUnderLease(
  acquired: CompilerDependencyConsumerRecord,
  retirement: PhysicalGenerationRetirementReceipt,
  options: RuntimeDependencyOperationOptions
): Promise<CompilerDependencyConsumerRecord> {
  assertPhysicalGenerationRetirementReceipt(retirement);
  if (acquired.phase !== 'acquired' || path.resolve(retirement.root.path) !== acquired.generationPath ||
      retirement.root.device !== acquired.generationPhysical.device ||
      retirement.root.inode !== acquired.generationPhysical.inode ||
      retirement.root.objectId !== acquired.generationPhysical.objectId) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Physical retirement receipt does not bind the acquired dependency consumer');
  }
  return publishCompilerDependencyConsumerReleaseUnderLease(acquired, options);
}

async function publishCompilerDependencyConsumerReleaseUnderLease(
  acquired: CompilerDependencyConsumerRecord,
  options: RuntimeDependencyOperationOptions
): Promise<CompilerDependencyConsumerRecord> {
  const consumers = await compilerDependencyConsumerRoot(options);
  const released = compilerDependencyConsumerRecord({
    schema: COMPILER_DEPENDENCY_CONSUMER_SCHEMA,
    previousRecordDigest: acquired.recordDigest,
    leaseId: acquired.leaseId,
    generationDigest: acquired.generationDigest,
    generationPath: acquired.generationPath,
    generationPhysical: acquired.generationPhysical,
    phase: 'released'
  });
  const name = `consumer-${acquired.leaseId.slice('sha256:'.length)}-released.json`;
  const existing = inspectNoFollowOrdinaryFileEntry(consumers, name);
  if (existing !== null && existing.bytes !== null) {
    const parsed = parseCompilerDependencyConsumerRecord(existing.bytes, name);
    if (parsed.recordDigest !== released.recordDigest) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency consumer release receipt is foreign');
    }
  } else {
    await runtimeDependencyOperationEffectFence(options, 'Compiler dependency consumer release');
    publishExclusiveDurableCanonicalFile({
      parent: consumers,
      name,
      bytes: Buffer.from(formatJsonFile(canonicalJson(released)), 'utf8'),
      validate: (candidate) => { parseCompilerDependencyConsumerRecord(candidate, name); }
    });
  }
  const readback = inspectNoFollowOrdinaryFileEntry(consumers, name);
  if (readback === null || readback.bytes === null ||
      parseCompilerDependencyConsumerRecord(readback.bytes, name).recordDigest !== released.recordDigest) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency consumer release failed readback');
  }
  const census = readCompilerDependencyConsumerCensus(consumers, {
    epoch: acquired.generationDigest,
    physical: acquired.generationPhysical,
    sourcePath: acquired.generationPath
  }, options);
  if (census.active.length !== 0) return released;
  await publishCompilerDependencyConsumerZeroReceipt(
    consumers,
    {
      epoch: acquired.generationDigest,
      physical: acquired.generationPhysical,
      sourcePath: acquired.generationPath
    },
    census.censusDigest,
    census.terminalRecords,
    'terminal-compaction',
    options
  );
  return released;
}

async function releaseCompilerDependencyConsumer(
  root: string,
  acquired: CompilerDependencyConsumerRecord,
  retirement: PhysicalGenerationRetirementReceipt,
  onTerminal?: (released: CompilerDependencyConsumerRecord) => void
): Promise<CompilerDependencyConsumerRecord> {
  return withCompilerDependencyCoordinationLease(
    root,
    { lockTimeoutMs: 30_000 },
    async (options) => {
      const released = await releaseCompilerDependencyConsumerUnderLease(acquired, retirement, options);
      onTerminal?.(released);
      await settleCompilerDependencyConsumerCompactionIntents(
        compilerDependencyCoordinationSession(options).consumers,
        options
      );
      return released;
    }
  );
}

const COMPILER_DEPENDENCY_CONSUMER_ZERO_SCHEMA =
  'sec-compiler-dependency-consumer-zero-v1' as const;
const COMPILER_DEPENDENCY_CONSUMER_ZERO_SCHEMA_V2 =
  'sec-compiler-dependency-consumer-zero-v2' as const;
const COMPILER_DEPENDENCY_CONSUMER_ZERO_KEYS = Object.freeze([
  'censusDigest', 'generationDigest', 'generationPath', 'generationPhysical',
  'receiptDigest', 'schema', 'terminal'
]);
const COMPILER_DEPENDENCY_CONSUMER_ZERO_KEYS_V2 = Object.freeze([
  ...COMPILER_DEPENDENCY_CONSUMER_ZERO_KEYS,
  'purpose', 'terminalRecords'
]);

type CompilerDependencyConsumerCompactionEntry = Readonly<{
  acquired: CompilerDependencyConsumerRecord;
  acquiredName: string;
  released: CompilerDependencyConsumerRecord;
  releasedName: string;
}>;

interface CompilerDependencyConsumerZeroReceipt {
  readonly schema: typeof COMPILER_DEPENDENCY_CONSUMER_ZERO_SCHEMA |
    typeof COMPILER_DEPENDENCY_CONSUMER_ZERO_SCHEMA_V2;
  readonly censusDigest: `sha256:${string}`;
  readonly generationDigest: `sha256:${string}`;
  readonly generationPath: string;
  readonly generationPhysical: GeneratedStatePhysicalIdentity;
  readonly receiptDigest: `sha256:${string}`;
  readonly terminal: 'consumer-zero';
  readonly purpose?: 'generation-retirement' | 'terminal-compaction';
  readonly terminalRecords?: readonly CompilerDependencyConsumerCompactionEntry[];
}

function compilerDependencyConsumerZeroReceipt(input: Omit<
  CompilerDependencyConsumerZeroReceipt,
  'receiptDigest'
>): CompilerDependencyConsumerZeroReceipt {
  const unsigned = Object.freeze({ ...input });
  return Object.freeze({
    ...unsigned,
    receiptDigest: generatedStateDigest(canonicalJson(unsigned))
  });
}

function parseCompilerDependencyConsumerZeroReceipt(
  bytes: Uint8Array,
  expectedName?: string
): CompilerDependencyConsumerZeroReceipt {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency consumer-zero receipt is not canonical JSON', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  const isV1 = hasExactObjectKeys(value, COMPILER_DEPENDENCY_CONSUMER_ZERO_KEYS);
  const isV2 = hasExactObjectKeys(value, COMPILER_DEPENDENCY_CONSUMER_ZERO_KEYS_V2);
  if (!isV1 && !isV2) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency consumer-zero receipt has noncanonical keys');
  }
  const receipt = value as unknown as CompilerDependencyConsumerZeroReceipt;
  const embeddedRecordIsCanonical = (
    record: CompilerDependencyConsumerRecord,
    name: string
  ): boolean => {
    try {
      return parseCompilerDependencyConsumerRecord(
        Buffer.from(formatJsonFile(canonicalJson(record)), 'utf8'),
        name
      ).recordDigest === record.recordDigest;
    } catch {
      return false;
    }
  };
  const compactionEntryIsCanonical = (
    raw: unknown,
    index: number,
    entries: readonly unknown[]
  ): boolean => {
    if (!hasExactObjectKeys(raw, ['acquired', 'acquiredName', 'released', 'releasedName'])) return false;
    const entry = raw as unknown as CompilerDependencyConsumerCompactionEntry;
    const previous = index === 0
      ? null
      : entries[index - 1] as CompilerDependencyConsumerCompactionEntry;
    return typeof entry.acquiredName === 'string' && typeof entry.releasedName === 'string' &&
      /^consumer-[0-9a-f]{64}-acquired\.json$/u.test(entry.acquiredName) &&
      /^consumer-[0-9a-f]{64}-released\.json$/u.test(entry.releasedName) &&
      embeddedRecordIsCanonical(entry.acquired, entry.acquiredName) &&
      embeddedRecordIsCanonical(entry.released, entry.releasedName) &&
      entry.acquiredName === `consumer-${entry.acquired.leaseId.slice('sha256:'.length)}-acquired.json` &&
      entry.releasedName === `consumer-${entry.released.leaseId.slice('sha256:'.length)}-released.json` &&
      entry.acquired.phase === 'acquired' && entry.released.phase === 'released' &&
      entry.acquired.leaseId === entry.released.leaseId &&
      entry.released.previousRecordDigest === entry.acquired.recordDigest &&
      entry.acquired.generationDigest === receipt.generationDigest &&
      entry.released.generationDigest === receipt.generationDigest &&
      sameHostPath(entry.acquired.generationPath, receipt.generationPath) &&
      sameHostPath(entry.released.generationPath, receipt.generationPath) &&
      sameGeneratedStateIdentity(entry.acquired.generationPhysical, receipt.generationPhysical) &&
      sameGeneratedStateIdentity(entry.released.generationPhysical, receipt.generationPhysical) &&
      (previous === null || compareCodeUnits(previous.acquiredName, entry.acquiredName) < 0);
  };
  if ((isV1 && receipt.schema !== COMPILER_DEPENDENCY_CONSUMER_ZERO_SCHEMA) ||
      (isV2 && receipt.schema !== COMPILER_DEPENDENCY_CONSUMER_ZERO_SCHEMA_V2) ||
      !isSha256Digest(receipt.censusDigest) || !isSha256Digest(receipt.generationDigest) ||
      !isSha256Digest(receipt.receiptDigest) || !isCanonicalAbsolutePath(receipt.generationPath) ||
      !isCanonicalGeneratedStatePhysicalIdentity(receipt.generationPhysical) ||
      receipt.terminal !== 'consumer-zero') {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency consumer-zero receipt fields are invalid');
  }
  if (receipt.schema === COMPILER_DEPENDENCY_CONSUMER_ZERO_SCHEMA_V2 &&
      ((receipt.purpose !== 'generation-retirement' && receipt.purpose !== 'terminal-compaction') ||
        !Array.isArray(receipt.terminalRecords) || receipt.terminalRecords.some(
          (entry, index, entries) => !compactionEntryIsCanonical(entry, index, entries)
        ))) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency consumer-zero compaction intent is invalid');
  }
  const { receiptDigest: _receiptDigest, ...unsigned } = receipt;
  if (generatedStateDigest(canonicalJson(unsigned)) !== receipt.receiptDigest ||
      formatJsonFile(canonicalJson(receipt)) !== Buffer.from(bytes).toString('utf8')) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency consumer-zero receipt digest or bytes changed');
  }
  const canonicalName = `zero-${receipt.generationDigest.slice('sha256:'.length, 'sha256:'.length + 24)}-${receipt.censusDigest.slice('sha256:'.length, 'sha256:'.length + 24)}.json`;
  if (expectedName !== undefined && expectedName !== canonicalName) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency consumer-zero receipt filename differs');
  }
  return Object.freeze(receipt);
}

async function settleCompilerDependencyConsumerCompactionIntents(
  consumers: PhysicalDirectoryIdentity,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const inventory = scanNoFollowDirectoryTreeInventory(consumers, {
    deadlineAtMs: runtimeDependencyOperationContext(options).deadlineAtMonotonicMs,
    maximumBytes: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES,
    maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
    signal: runtimeDependencyOperationContext(options).signal
  });
  for (const entry of inventory) {
    if (entry.kind !== 'file' || entry.relativePath.includes('/') ||
        !entry.relativePath.startsWith('zero-')) continue;
    const intentObservation = observeNoFollowOwnedFile(
      path.join(consumers.path, entry.relativePath),
      'Compiler dependency consumer compaction intent'
    );
    if (intentObservation === null) continue;
    const intent = parseCompilerDependencyConsumerZeroReceipt(
      readNoFollowOwnedFileBytes(intentObservation, 'Compiler dependency consumer compaction intent'),
      entry.relativePath
    );
    if (intent.schema !== COMPILER_DEPENDENCY_CONSUMER_ZERO_SCHEMA_V2) continue;
    for (const terminal of intent.terminalRecords ?? []) {
      for (const candidate of [
        Object.freeze({ digest: terminal.released.recordDigest, name: terminal.releasedName }),
        Object.freeze({ digest: terminal.acquired.recordDigest, name: terminal.acquiredName })
      ]) {
        const candidatePath = path.join(consumers.path, candidate.name);
        const observation = observeNoFollowOwnedFile(
          candidatePath,
          'Compiler dependency consumer compaction record'
        );
        if (observation === null) continue;
        const parsed = parseCompilerDependencyConsumerRecord(
          readNoFollowOwnedFileBytes(observation, 'Compiler dependency consumer compaction record'),
          candidate.name
        );
        if (parsed.recordDigest !== candidate.digest) {
          throw new CodedFailure(
            'RUNTIME-DEPS-004',
            'Compiler dependency consumer compaction record is foreign and preserved'
          );
        }
        await runtimeDependencyOperationEffectFence(
          options,
          'Compiler dependency consumer compaction record retirement'
        );
        deleteNoFollowOwnedFile(
          candidatePath,
          observation,
          'Compiler dependency consumer compaction record'
        );
      }
    }
    if (intent.purpose === 'terminal-compaction') {
      await runtimeDependencyOperationEffectFence(
        options,
        'Compiler dependency consumer compaction intent retirement'
      );
      deleteNoFollowOwnedFile(
        path.join(consumers.path, entry.relativePath),
        intentObservation,
        'Compiler dependency consumer compaction intent'
      );
    }
  }
}

type CompilerDependencyConsumerCensus = Readonly<{
  active: readonly CompilerDependencyConsumerRecord[];
  censusDigest: `sha256:${string}`;
  terminalRecords: readonly Readonly<{
    acquired: CompilerDependencyConsumerRecord;
    acquiredName: string;
    released: CompilerDependencyConsumerRecord;
    releasedName: string;
  }>[];
}>;

function readCompilerDependencyConsumerCensus(
  consumers: PhysicalDirectoryIdentity,
  generation: Readonly<{
    epoch: `sha256:${string}`;
    physical: GeneratedStatePhysicalIdentity;
    sourcePath: string;
  }>,
  options: RuntimeDependencyOperationOptions
): CompilerDependencyConsumerCensus {
  const context = runtimeDependencyOperationContext(options);
  const inventory = scanNoFollowDirectoryTreeInventory(consumers, {
    deadlineAtMs: context.deadlineAtMonotonicMs,
    maximumBytes: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES,
    maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
    signal: context.signal
  });
  const records = new Map<string, Partial<Record<'acquired' | 'released', CompilerDependencyConsumerRecord>>>();
  const recordDigests: string[] = [];
  for (const entry of inventory) {
    if (entry.kind !== 'file' || entry.relativePath.includes('/')) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency consumer namespace contains unknown residue');
    }
    const bytes = readNoFollowOrdinaryFile(consumers, entry.relativePath);
    if (bytes === null) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency consumer record disappeared during census');
    }
    if (entry.relativePath.startsWith('zero-')) {
      parseCompilerDependencyConsumerZeroReceipt(bytes, entry.relativePath);
      continue;
    }
    const record = parseCompilerDependencyConsumerRecord(bytes, entry.relativePath);
    const phases = records.get(record.leaseId) ?? {};
    if (phases[record.phase] !== undefined) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency consumer lease has duplicate phase records');
    }
    phases[record.phase] = record;
    records.set(record.leaseId, phases);
    recordDigests.push(record.recordDigest);
  }
  const active: CompilerDependencyConsumerRecord[] = [];
  const terminalRecords: Array<CompilerDependencyConsumerCensus['terminalRecords'][number]> = [];
  for (const [leaseId, phases] of records) {
    const acquired = phases.acquired;
    const released = phases.released;
    if (acquired === undefined || (released !== undefined &&
        (released.previousRecordDigest !== acquired.recordDigest ||
          released.generationDigest !== acquired.generationDigest ||
          released.generationPath !== acquired.generationPath ||
          !sameGeneratedStateIdentity(released.generationPhysical, acquired.generationPhysical)))) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency consumer lease chain is partial or foreign', {
        leaseId
      });
    }
    if (released === undefined && acquired.generationDigest === generation.epoch &&
        sameHostPath(acquired.generationPath, generation.sourcePath) &&
        sameGeneratedStateIdentity(acquired.generationPhysical, generation.physical)) {
      active.push(acquired);
    } else if (released !== undefined && acquired.generationDigest === generation.epoch &&
        sameHostPath(acquired.generationPath, generation.sourcePath) &&
        sameGeneratedStateIdentity(acquired.generationPhysical, generation.physical)) {
      terminalRecords.push(Object.freeze({
        acquired,
        acquiredName: `consumer-${leaseId.slice('sha256:'.length)}-acquired.json`,
        released,
        releasedName: `consumer-${leaseId.slice('sha256:'.length)}-released.json`
      }));
    }
  }
  recordDigests.sort(compareCodeUnits);
  active.sort((left, right) => compareCodeUnits(left.leaseId, right.leaseId));
  terminalRecords.sort((left, right) => compareCodeUnits(left.acquiredName, right.acquiredName));
  return Object.freeze({
    active: Object.freeze(active),
    terminalRecords: Object.freeze(terminalRecords),
    censusDigest: generatedStateDigest(Object.freeze({
      schema: 'sec-compiler-dependency-consumer-census-v1',
      recordDigests: Object.freeze(recordDigests)
    }))
  });
}

async function publishCompilerDependencyConsumerZeroReceipt(
  consumers: PhysicalDirectoryIdentity,
  generation: Readonly<{
    epoch: `sha256:${string}`;
    physical: GeneratedStatePhysicalIdentity;
    sourcePath: string;
  }>,
  censusDigest: `sha256:${string}`,
  terminalRecords: CompilerDependencyConsumerCensus['terminalRecords'],
  purpose: 'generation-retirement' | 'terminal-compaction',
  options: RuntimeDependencyOperationOptions
): Promise<CompilerDependencyConsumerZeroReceipt> {
  const receipt = compilerDependencyConsumerZeroReceipt({
    schema: COMPILER_DEPENDENCY_CONSUMER_ZERO_SCHEMA_V2,
    censusDigest,
    generationDigest: generation.epoch,
    generationPath: path.resolve(generation.sourcePath),
    generationPhysical: generation.physical,
    purpose,
    terminalRecords,
    terminal: 'consumer-zero'
  });
  const name = `zero-${generation.epoch.slice('sha256:'.length, 'sha256:'.length + 24)}-${censusDigest.slice('sha256:'.length, 'sha256:'.length + 24)}.json`;
  const existing = inspectNoFollowOrdinaryFileEntry(consumers, name);
  if (existing === null) {
    await runtimeDependencyOperationEffectFence(
      options,
      'Compiler dependency consumer-zero receipt publication'
    );
    publishExclusiveDurableCanonicalFile({
      parent: consumers,
      name,
      bytes: Buffer.from(formatJsonFile(canonicalJson(receipt)), 'utf8'),
      validate: (candidate) => { parseCompilerDependencyConsumerZeroReceipt(candidate, name); }
    });
  }
  const readback = inspectNoFollowOrdinaryFileEntry(consumers, name);
  if (readback === null || readback.bytes === null ||
      parseCompilerDependencyConsumerZeroReceipt(readback.bytes, name).receiptDigest !== receipt.receiptDigest) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency consumer-zero receipt failed readback');
  }
  return receipt;
}

async function collectReleasedCompilerDependencyGenerations(
  root: string,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const namespace = inspectDependencyTransitionNamespace(root);
  if (namespace === null) return;
  const activePath = dependencyAuthorityPaths(root).compilerModulesRoot;
  let activeGenerationPath: string | null = null;
  try {
    activeGenerationPath = path.resolve(await fs.realpath(activePath));
  } catch (error) {
    if (!isFileNotFoundError(error)) throw error;
  }
  type GenerationCandidate = Readonly<{
    generationDigest: `sha256:${string}`;
    generationPath: string;
    generationPhysical: GeneratedStatePhysicalIdentity;
    sourceGeneration: RuntimeDependencySourceGeneration | null;
  }>;
  const uniqueGenerations = new Map<string, GenerationCandidate>();
  const releasedLegacyGenerations = new Map<string, GeneratedStatePhysicalIdentity>();
  const generationKey = (generationDigest: `sha256:${string}`, generationPath: string): string =>
    `${generationDigest}\0${generationPath}`;
  const ledger = await readDependencyTransitionLedger(root, options);
  for (const transition of ledger?.records.values() ?? []) {
    if (transition.kind !== 'compiler-local-locator' || transition.phase !== 'complete') continue;
    const candidate: GenerationCandidate = Object.freeze({
      generationDigest: transition.sourceGeneration.epoch,
      generationPath: transition.sourceGeneration.sourcePath,
      generationPhysical: transition.sourceGeneration.physical,
      sourceGeneration: transition.sourceGeneration
    });
    uniqueGenerations.set(generationKey(candidate.generationDigest, candidate.generationPath), candidate);
  }
  const consumers = compilerDependencyCoordinationSession(options).consumers;
  const consumerRecords: CompilerDependencyConsumerRecord[] = [];
  const consumerZeroReceipts: CompilerDependencyConsumerZeroReceipt[] = [];
  if (consumers !== null) {
    const acquiredInventory = scanNoFollowDirectoryTreeInventory(consumers, {
      deadlineAtMs: runtimeDependencyOperationContext(options).deadlineAtMonotonicMs,
      maximumBytes: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES,
      maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
      signal: runtimeDependencyOperationContext(options).signal
    });
    for (const entry of acquiredInventory) {
      if (entry.kind !== 'file' || entry.relativePath.includes('/')) {
        throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency consumer namespace contains unknown residue');
      }
      const bytes = readNoFollowOrdinaryFile(consumers, entry.relativePath);
      if (bytes === null) {
        throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency consumer record disappeared during collection');
      }
      if (entry.relativePath.startsWith('zero-')) {
        consumerZeroReceipts.push(parseCompilerDependencyConsumerZeroReceipt(bytes, entry.relativePath));
        continue;
      }
      consumerRecords.push(parseCompilerDependencyConsumerRecord(bytes, entry.relativePath));
    }
  }
  const legacyRelocations = inspectNoFollowDirectoryChild(
    namespace.backupRoot,
    'legacy-relocations'
  );
  if (legacyRelocations !== null) {
    const relocationInventory = scanNoFollowDirectoryTreeInventory(legacyRelocations, {
      deadlineAtMs: runtimeDependencyOperationContext(options).deadlineAtMonotonicMs,
      maximumBytes: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES,
      maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
      signal: runtimeDependencyOperationContext(options).signal
    });
    const relocationRecords = new Map<string, CompilerDependencyLegacyRelocationIntent>();
    for (const entry of relocationInventory) {
      if (entry.kind !== 'file' || entry.relativePath.includes('/')) {
        throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency legacy relocation namespace contains unknown residue');
      }
      const bytes = readNoFollowOrdinaryFile(legacyRelocations, entry.relativePath);
      if (bytes === null) {
        throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency legacy relocation record disappeared during collection');
      }
      const intent = parseCompilerDependencyLegacyRelocationIntent(bytes, entry.relativePath);
      relocationRecords.set(`${intent.operationKey}\0${intent.phase}`, intent);
    }
    for (const intent of relocationRecords.values()) {
      if (intent.phase === 'prepared' &&
          !relocationRecords.has(`${intent.operationKey}\0complete`)) {
        throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency legacy relocation is nonterminal');
      }
      if (intent.phase !== 'complete') continue;
      const prepared = relocationRecords.get(`${intent.operationKey}\0prepared`);
      const transition = ledger?.records.get(intent.transitionRecordDigest);
      const preparedTransition = prepared === undefined
        ? undefined
        : ledger?.records.get(prepared.transitionRecordDigest);
      let transitionDescendsFromPrepared = false;
      if (transition !== undefined && preparedTransition !== undefined && ledger !== null) {
        let cursor: DependencyTransitionJournal | undefined = transition;
        const visited = new Set<`sha256:${string}`>();
        while (cursor !== undefined && !visited.has(cursor.recordDigest)) {
          if (cursor.recordDigest === preparedTransition.recordDigest) {
            transitionDescendsFromPrepared = true;
            break;
          }
          visited.add(cursor.recordDigest);
          cursor = cursor.previousRecordDigest === null
            ? undefined
            : ledger.records.get(cursor.previousRecordDigest);
        }
      }
      if (prepared === undefined || intent.previousIntentDigest !== prepared.intentDigest ||
          intent.preimageAuthorityDigest !== prepared.preimageAuthorityDigest ||
          intent.targetGenerationDigest !== prepared.targetGenerationDigest ||
          intent.sourcePath !== prepared.sourcePath ||
          intent.destinationPath !== prepared.destinationPath ||
          intent.relocationProofDigest !== prepared.relocationProofDigest ||
          intent.relocationProofText !== prepared.relocationProofText ||
          !sameGeneratedStateIdentity(intent.sourcePhysical, prepared.sourcePhysical) ||
          transition === undefined ||
          preparedTransition === undefined ||
          !transitionDescendsFromPrepared ||
          (transition.kind !== 'compiler-generation' &&
            transition.kind !== 'compiler-local-locator') ||
          transition.kind !== preparedTransition.kind ||
          transition.operationKey !== intent.operationKey ||
          preparedTransition.operationKey !== intent.operationKey ||
          transition.preimage.kind !== 'directory' ||
          preparedTransition.preimage.kind !== 'directory' ||
          transition.preimage.physical === null ||
          preparedTransition.preimage.physical === null ||
          transition.preimage.bindingDigest !== intent.preimageAuthorityDigest ||
          preparedTransition.preimage.bindingDigest !== intent.preimageAuthorityDigest ||
          !sameHostPath(transition.preimage.path, intent.sourcePath) ||
          !sameHostPath(preparedTransition.preimage.path, intent.sourcePath) ||
          !sameGeneratedStateIdentity(transition.preimage.physical, intent.sourcePhysical) ||
          !sameGeneratedStateIdentity(preparedTransition.preimage.physical, intent.sourcePhysical) ||
          transition.sourceGeneration.epoch !== intent.targetGenerationDigest ||
          preparedTransition.sourceGeneration.epoch !== intent.targetGenerationDigest ||
          !sameHostPath(
            path.dirname(intent.destinationPath),
            dependencyTransitionNamespacePaths(root).backupRoot
          ) ||
          (transition.kind === 'compiler-generation' &&
            (transition.backup === null ||
              !sameHostPath(transition.backup.path, intent.destinationPath)))) {
        throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency legacy relocation chain is partial or foreign');
      }
      const destination = inspectExactNoFollowDirectoryPresence(
        intent.destinationPath,
        'Compiler dependency relocated legacy generation'
      );
      if (destination.state === 'absent') {
        const terminal = consumerZeroReceipts.find((receipt) =>
          sameHostPath(receipt.generationPath, intent.destinationPath) &&
          sameGeneratedStateIdentity(receipt.generationPhysical, intent.sourcePhysical));
        if (terminal === undefined) {
          throw new CodedFailure(
            'RUNTIME-DEPS-004',
            'Absent compiler dependency relocated legacy generation has no consumer-zero receipt'
          );
        }
        continue;
      }
      const binding = await readCompilerDepsBinding(
        path.join(intent.destinationPath, COMPILER_DEPS_BINDING_FILE)
      );
      if (binding === null) {
        throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency relocated legacy generation binding is absent');
      }
      const generation = await runtimeDependencySourceGeneration({
        binding,
        options,
        ownerRoot: root,
        sourcePath: intent.destinationPath
      });
      if (!sameGeneratedStateIdentity(generation.physical, intent.sourcePhysical)) {
        throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency relocated legacy generation identity differs');
      }
      if (transition.kind === 'compiler-local-locator' && !sameHostPath(
        compilerTransitionBackupPath(root, 'generation', generation),
        intent.destinationPath
      )) {
        throw new CodedFailure(
          'RUNTIME-DEPS-004',
          'Compiler dependency relocated legacy generation path differs from its exact generation identity'
        );
      }
      const key = generationKey(generation.epoch, generation.sourcePath);
      releasedLegacyGenerations.set(key, generation.physical);
      uniqueGenerations.set(key, Object.freeze({
        generationDigest: generation.epoch,
        generationPath: generation.sourcePath,
        generationPhysical: generation.physical,
        sourceGeneration: generation
      }));
    }
  }
  for (const record of consumerRecords) {
    if (record.phase === 'acquired') {
      const key = generationKey(record.generationDigest, record.generationPath);
      const existing = uniqueGenerations.get(key);
      uniqueGenerations.set(key, Object.freeze({
        generationDigest: record.generationDigest,
        generationPath: record.generationPath,
        generationPhysical: record.generationPhysical,
        sourceGeneration: existing?.sourceGeneration ?? null
      }));
    }
  }
  const candidates = [...uniqueGenerations.values()].filter((candidate) =>
    activeGenerationPath === null || !sameHostPath(activeGenerationPath, candidate.generationPath));
  if (candidates.length === 0) return;
  for (const acquired of candidates) {
    const releasedLegacyPhysical = releasedLegacyGenerations.get(generationKey(
      acquired.generationDigest,
      acquired.generationPath
    ));
    if (!isCanonicalLocalCompilerDependencyGeneration(root, acquired.generationPath) &&
        (releasedLegacyPhysical === undefined || !sameGeneratedStateIdentity(
          releasedLegacyPhysical,
          acquired.generationPhysical
        ))) {
      // The coordination census is shared by linked worktrees.  A consumer of
      // another owner's physical generation contributes to that owner's GC
      // census, but this root has no authority to collect that generation.
      if (isPathInside(root, acquired.generationPath)) {
        throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency consumer names a noncanonical local generation path');
      }
      continue;
    }
    const censusProjection = Object.freeze({
      epoch: acquired.generationDigest,
      physical: acquired.generationPhysical,
      sourcePath: acquired.generationPath
    });
    const census = readCompilerDependencyConsumerCensus(consumers, censusProjection, options);
    // An acquired consumer is the complete negative authority for GC.  Do
    // not even reopen its physical generation: on Windows the consumer's
    // retained handles deliberately exclude publisher mutation/deletion and
    // physical probing here would turn a correct live holder into an error.
    if (census.active.length !== 0) continue;
    const generationPresent = await fs.lstat(acquired.generationPath).then(
      (metadata) => metadata.isDirectory() && !metadata.isSymbolicLink(),
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    );
    if (!generationPresent) {
      const zero = consumerZeroReceipts.find((receipt) =>
        receipt.generationDigest === acquired.generationDigest &&
        sameHostPath(receipt.generationPath, acquired.generationPath) &&
        sameGeneratedStateIdentity(receipt.generationPhysical, acquired.generationPhysical)
      );
      if (zero === undefined) {
        throw new CodedFailure(
          'RUNTIME-DEPS-004',
          'Absent compiler dependency generation has no exact consumer-zero receipt',
          {
            generationDigest: acquired.generationDigest,
            generationPath: acquired.generationPath
          }
        );
      }
      continue;
    }
    const binding = await readCompilerDepsBinding(path.join(acquired.generationPath, COMPILER_DEPS_BINDING_FILE));
    if (binding === null) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency released generation binding is absent');
    }
    const observedGeneration = await runtimeDependencySourceGeneration({
      binding,
      options,
      ownerRoot: root,
      sourcePath: acquired.generationPath
    });
    if (!sameGeneratedStateIdentity(observedGeneration.physical, acquired.generationPhysical)) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency released generation physical authority differs');
    }
    const generation = observedGeneration.epoch === acquired.generationDigest
      ? observedGeneration
      : acquired.sourceGeneration;
    if (generation === null || generation.epoch !== acquired.generationDigest ||
        !sameHostPath(generation.sourcePath, acquired.generationPath) ||
        !sameGeneratedStateIdentity(generation.physical, acquired.generationPhysical) ||
        generatedStateDigest(binding) !== generation.bindingDigest) {
      throw new CodedFailure(
        'RUNTIME-DEPS-004',
        'Compiler dependency released generation has no owner-issued pre-mutation authority'
      );
    }
    await publishCompilerDependencyConsumerZeroReceipt(
      consumers,
      generation,
      census.censusDigest,
      census.terminalRecords,
      'generation-retirement',
      options
    );
    await settleCompilerDependencyConsumerCompactionIntents(consumers, options);
    // The persisted proof is the only authority that may restore publisher
    // write/delete access.  Reopen the exact child only after that terminal
    // ACL/mode readback; attempting a deletion-capable parent-relative open
    // while the proven tree is still read-only correctly fails on Windows.
    await retireCompilerDependencyExecutionProofIfPresent(
      root,
      acquired.generationPath,
      options,
      generation
    );
    const generationRoot = inspectNoFollowDirectoryChain(
      acquired.generationPath,
      'Compiler dependency released generation collection root'
    ).target;
    if (!sameGeneratedStateIdentity(generatedStatePhysicalIdentity(generationRoot), acquired.generationPhysical)) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency released generation physical identity changed');
    }
    const inventory = scanNoFollowDirectoryTreeInventory(generationRoot, {
      deadlineAtMs: runtimeDependencyOperationContext(options).deadlineAtMonotonicMs,
      maximumBytes: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES,
      maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
      signal: runtimeDependencyOperationContext(options).signal
    });
    await runtimeDependencyOperationEffectFence(options, 'Compiler dependency consumer-zero generation retirement');
    const parent = assertSameNoFollowDirectoryIdentity(
      namespace.backupRoot,
      'Compiler dependency generation collection parent'
    ).target;
    retireNoFollowDirectoryTree({
      deadlineAtMonotonicMs: runtimeDependencyOperationContext(options).deadlineAtMonotonicMs,
      inventory,
      parent,
      root: generationRoot
    });
    if (inspectNoFollowDirectoryLeaf(parent, path.basename(acquired.generationPath)) !== null) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency consumer-zero collection left generation residue');
    }
  }
}

type RetiredCompilerDependencyPreimage = Readonly<{
  backupPath: string;
  bindingDigest: `sha256:${string}`;
  identity: CompilerDependencyDirectoryIdentity;
  retiredRegistrationDigest: `sha256:${string}` | null;
}>;

function assertCompilerDependencyProofOwnerCurrent(
  sourceGeneration: RuntimeDependencySourceGeneration,
  label: string
): PhysicalDirectoryIdentity {
  const owner = inspectNoFollowDirectoryChain(sourceGeneration.ownerRoot, label).target;
  if (!sameHostPath(owner.path, sourceGeneration.ownerRoot) || !sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(owner),
    sourceGeneration.ownerRootPhysical
  )) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency proof owner root changed');
  }
  return owner;
}

function assertCompilerDependencyProofNamespaceCurrent(
  namespace: DependencyTransitionNamespace,
  sourceGeneration: RuntimeDependencySourceGeneration,
  label: string
): void {
  const owner = assertSameNoFollowDirectoryIdentity(namespace.ownerRoot, label).target;
  if (!sameHostPath(owner.path, sourceGeneration.ownerRoot) || !sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(owner),
    sourceGeneration.ownerRootPhysical
  )) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency proof namespace owner changed');
  }
}

function inspectCompilerDependencyProofNamespace(
  sourceGeneration: RuntimeDependencySourceGeneration,
  label: string
): DependencyTransitionNamespace | null {
  const owner = assertCompilerDependencyProofOwnerCurrent(sourceGeneration, `${label} owner`);
  const namespace = inspectDependencyTransitionNamespace(owner.path);
  if (namespace !== null) {
    assertCompilerDependencyProofNamespaceCurrent(namespace, sourceGeneration, `${label} namespace`);
  }
  return namespace;
}

async function ensureCompilerDependencyProofNamespace(
  sourceGeneration: RuntimeDependencySourceGeneration,
  options: RuntimeDependencyOperationOptions,
  label: string
): Promise<DependencyTransitionNamespace> {
  const owner = assertCompilerDependencyProofOwnerCurrent(sourceGeneration, `${label} owner`);
  const namespace = await ensureDependencyTransitionNamespace(owner, options);
  assertCompilerDependencyProofNamespaceCurrent(namespace, sourceGeneration, `${label} namespace`);
  return namespace;
}

async function retireCompilerDependencyExecutionProofIfPresent(
  root: string,
  sourcePath: string,
  options: RuntimeDependencyOperationOptions,
  expectedSourceGeneration?: RuntimeDependencySourceGeneration
): Promise<void> {
  const binding = await readCompilerDepsBinding(path.join(sourcePath, COMPILER_DEPS_BINDING_FILE));
  if (binding === null) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency generation binding is unavailable before proof retirement');
  }
  const sourceGeneration = expectedSourceGeneration ?? await runtimeDependencySourceGeneration({
    binding,
    options,
    ownerRoot: root,
    sourcePath
  });
  if (!sameHostPath(sourceGeneration.sourcePath, sourcePath) ||
      !sameHostPath(sourceGeneration.ownerRoot, root) ||
      generatedStateDigest(binding) !== sourceGeneration.bindingDigest) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Compiler dependency execution proof retirement authority is foreign'
    );
  }
  const namespace = inspectCompilerDependencyProofNamespace(
    sourceGeneration,
    'Compiler dependency execution proof retirement'
  );
  if (namespace === null) return;
  const proofRoot = inspectNoFollowDirectoryChild(namespace.backupRoot, 'read-only-generations');
  if (proofRoot === null) return;
  assertCompilerDependencyProofNamespaceCurrent(
    namespace,
    sourceGeneration,
    'Compiler dependency execution proof retirement read admission'
  );
  const sourceRoot = inspectNoFollowDirectoryChain(
    sourcePath,
    'Compiler dependency execution proof retirement source root'
  ).target;
  if (!sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(sourceRoot),
    sourceGeneration.physical
  )) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Compiler dependency execution proof retirement physical identity changed'
    );
  }
  const proofName = `${sourceGeneration.epoch.slice('sha256:'.length)}.json`;
  const proofPath = path.join(proofRoot.path, proofName);
  const proofObservation = observeNoFollowOwnedFile(
    proofPath,
    'Compiler dependency execution proof retirement'
  );
  if (proofObservation === null) return;
  const proofBytes = readNoFollowOrdinaryFile(proofRoot, proofName);
  const proofReadback = observeNoFollowOwnedFile(
    proofPath,
    'Compiler dependency execution proof retirement readback'
  );
  if (proofBytes === null || proofReadback === null ||
      !sameNoFollowOwnedFileObservation(proofObservation, proofReadback)) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency execution proof changed before retirement');
  }
  assertCompilerDependencyProofNamespaceCurrent(
    namespace,
    sourceGeneration,
    'Compiler dependency execution proof retirement readback'
  );
  let proofText: string;
  try {
    proofText = new TextDecoder('utf-8', { fatal: true }).decode(proofBytes);
  } catch (error) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency execution proof is not exact UTF-8', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  assertCompilerDependencyProofNamespaceCurrent(
    namespace,
    sourceGeneration,
    'Compiler dependency execution proof retirement effect admission'
  );
  await runtimeDependencyOperationEffectFence(options, 'Compiler dependency execution generation retirement');
  const context = runtimeDependencyOperationContext(options);
  const remainingMs = runtimeDependencyOperationRemainingMs(
    options,
    'Compiler dependency execution generation retirement'
  );
  await retireNoFollowProvenDirectoryGeneration({
    binding: {
      generationDigest: sourceGeneration.epoch,
      treeDigest: sourceGeneration.treeDigest,
      treeEntryCount: sourceGeneration.treeEntryCount
    },
    // The operation ledger is monotonic and may return a fractional remainder.
    // The physical owner requires one bounded wall-clock integer; floor rather
    // than round so this projection can only narrow the parent budget.
    deadlineAtUnixMs: Date.now() + Math.max(1, Math.floor(remainingMs)),
    proofText,
    root: sourceRoot,
    signal: context.signal
  });
  assertCompilerDependencyProofNamespaceCurrent(
    namespace,
    sourceGeneration,
    'Compiler dependency execution proof file retirement admission'
  );
  await runtimeDependencyOperationEffectFence(options, 'Compiler dependency execution proof retirement receipt');
  deleteNoFollowOwnedFile(
    proofPath,
    proofObservation,
    'Compiler dependency execution proof retirement'
  );
  if (observeNoFollowOwnedFile(proofPath, 'Compiler dependency execution proof retirement terminal') !== null) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency execution proof retirement left nonterminal residue');
  }
  assertCompilerDependencyProofNamespaceCurrent(
    namespace,
    sourceGeneration,
    'Compiler dependency execution proof retirement terminal readback'
  );
}

async function retireIncompatibleCompilerDependencyTarget(
  root: string,
  nodeModulesPath: string,
  options: RuntimeDependencyOperationOptions,
  requestedBackupPath?: string
): Promise<RetiredCompilerDependencyPreimage | null> {
  const identity = await compilerDependencyDirectoryIdentity(nodeModulesPath);
  if (identity === null) return null;
  const preimageAuthority = await compilerDependencyGeneratedPreimageAuthority(
    root,
    nodeModulesPath,
    options
  );
  const bindingDigest = preimageAuthority.authorityDigest;
  const backupsRoot = path.join(root, '.tmp', 'dependency-installs', 'compiler-backups');
  const backupPath = requestedBackupPath ?? path.join(
    backupsRoot,
    `locator-preimage-${bindingDigest.slice('sha256:'.length, 'sha256:'.length + 24)}`
  );
  const compilerRootIdentity = inspectNoFollowDirectoryChain(
    root,
    'Compiler dependency backup owner root'
  ).target;
  await runtimeDependencyOperationEffectFence(options, 'Compiler dependency preimage backup namespace creation');
  createNoFollowOrdinaryDirectoryChain(
    compilerRootIdentity,
    ['.tmp', 'dependency-installs', 'compiler-backups']
  );
  await runtimeDependencyOperationEffectFence(options, 'Compiler dependency preimage retirement');
  const observed = await observeDependencyTransitionSlot(nodeModulesPath, bindingDigest);
  if (observed.kind !== 'directory' || observed.physical === null) {
    throw new CodedFailure(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency preimage changed before producer provenance binding and is preserved'
    );
  }
  await retireCompilerDependencyExecutionProofIfPresent(root, nodeModulesPath, options);
  const retiredRegistrationDigest = await bindAndRetireCompilerDependencyPreimage(
    options,
    Object.freeze({
      device: observed.physical.device,
      inode: observed.physical.inode,
      objectId: observed.physical.objectId
    }),
    'external-generation-locator-transition'
  );
  await renameCompilerDependencyDirectory(nodeModulesPath, backupPath, options);
  return Object.freeze({ backupPath, bindingDigest, identity, retiredRegistrationDigest });
}

async function restoreRetiredCompilerDependencyTarget(
  nodeModulesPath: string,
  retired: RetiredCompilerDependencyPreimage,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const lifecycle = options.generatedStateLifecycle;
  if (lifecycle?.restore === undefined || retired.retiredRegistrationDigest === null) {
    throw new CodedFailure(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency rollback has no exact lifecycle restore predecessor; recovery backup is preserved'
    );
  }
  const currentTarget = await observeDependencyTransitionSlot(nodeModulesPath);
  if (currentTarget.kind !== 'absent') {
    throw new CodedFailure(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency transition target is occupied; exact preimage remains in recovery backup'
    );
  }
  const backupSlot = await observeDependencyTransitionSlot(retired.backupPath);
  if (backupSlot.kind !== 'directory' || backupSlot.physical === null) {
    throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency recovery backup is absent or foreign and preserved');
  }
  const backupIdentity = await compilerDependencyDirectoryIdentity(retired.backupPath);
  if (!sameCompilerDependencyDirectoryIdentity(backupIdentity, retired.identity)) {
    throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency transition recovery preimage identity changed and is preserved');
  }
  await renameCompilerDependencyDirectory(retired.backupPath, nodeModulesPath, options);
  const restored = await observeDependencyTransitionSlot(nodeModulesPath, retired.bindingDigest);
  if (restored.kind !== 'directory' || restored.physical === null ||
      !sameGeneratedStateIdentity(restored.physical, backupSlot.physical)) {
    throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency rollback target identity changed before lifecycle restore');
  }
  await runtimeDependencyOperationEffectFence(options, 'Compiler dependency retired preimage lifecycle restore');
  await lifecycle.restore(
    'node_modules',
    retired.retiredRegistrationDigest,
    restored.physical,
    'compiler-dependency-preimage-restored'
  );
}

type CompilerDependencyTransitionKind = 'none' | 'generation-published' | 'locator-published';

async function ensureCompilerDependencyGenerationReadOnlyProof(
  root: string,
  sourceGeneration: RuntimeDependencySourceGeneration,
  options: RuntimeDependencyOperationOptions
): Promise<Readonly<{
  proofText: string;
  sourceRoot: PhysicalDirectoryIdentity;
}>> {
  runtimeDependencyOperationRemainingMs(
    options,
    'Compiler dependency read-only generation admission'
  );
  let sourceRoot = inspectNoFollowDirectoryChain(
    sourceGeneration.sourcePath,
    'Compiler dependency read-only generation root'
  ).target;
  if (!sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(sourceRoot),
    sourceGeneration.physical
  )) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency read-only generation root changed');
  }
  const proofOwnerRoot = path.resolve(sourceGeneration.ownerRoot);
  const ownsProof = sameHostPath(root, proofOwnerRoot);
  const namespace = ownsProof
    ? await ensureCompilerDependencyProofNamespace(
        sourceGeneration,
        options,
        'Compiler dependency source owner proof'
      )
    : inspectCompilerDependencyProofNamespace(
        sourceGeneration,
        'Compiler dependency source owner proof'
      );
  if (namespace === null) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Compiler dependency source owner proof namespace is unavailable'
    );
  }
  let proofRoot = inspectNoFollowDirectoryChild(
    namespace.backupRoot,
    'read-only-generations',
    'Compiler dependency source owner proof root'
  );
  if (proofRoot === null) {
    if (!ownsProof) {
      throw new CodedFailure(
        'RUNTIME-DEPS-004',
        'Compiler dependency source owner proof is unavailable'
      );
    }
    await runtimeDependencyOperationEffectFence(
      options,
      'Compiler dependency execution proof namespace publication'
    );
    proofRoot = createNoFollowOrdinaryDirectoryChain(
      namespace.backupRoot,
      ['read-only-generations']
    );
  }
  assertCompilerDependencyProofNamespaceCurrent(
    namespace,
    sourceGeneration,
    'Compiler dependency source owner proof read admission'
  );
  const proofName = `${sourceGeneration.epoch.slice('sha256:'.length)}.json`;
  const proofPath = path.join(proofRoot.path, proofName);
  const proofEntry = inspectNoFollowOrdinaryFileEntry(proofRoot, proofName);
  const initialProofObservation = observeNoFollowOwnedFile(
    proofPath,
    'Compiler dependency source owner proof'
  );
  if ((proofEntry === null) !== (initialProofObservation === null)
      || (proofEntry !== null && initialProofObservation !== null
        && (proofEntry.device !== initialProofObservation.device
          || proofEntry.inode !== initialProofObservation.inode))) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency source owner proof changed before read');
  }
  const proofBytes = readNoFollowOrdinaryFile(proofRoot, proofName);
  const initialProofReadback = observeNoFollowOwnedFile(
    proofPath,
    'Compiler dependency source owner proof readback'
  );
  if ((proofBytes === null) !== (initialProofReadback === null)
      || (initialProofObservation === null) !== (initialProofReadback === null)
      || (initialProofObservation !== null && initialProofReadback !== null
        && !sameNoFollowOwnedFileObservation(initialProofObservation, initialProofReadback))) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency source owner proof changed during read');
  }
  let proofText: string | null;
  try {
    proofText = proofBytes === null
      ? null
      : new TextDecoder('utf-8', { fatal: true }).decode(proofBytes);
  } catch (error) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency execution proof is not exact UTF-8', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  const context = runtimeDependencyOperationContext(options);
  let materialized: Readonly<{
    generation: RetainedNoFollowProvenDirectoryGeneration;
    proofText: string;
  }>;
  const binding = Object.freeze({
    generationDigest: sourceGeneration.epoch,
    treeDigest: sourceGeneration.treeDigest,
    treeEntryCount: sourceGeneration.treeEntryCount
  });
  const observeInventory = (
    rootIdentity = sourceRoot
  ): ReturnType<typeof scanNoFollowDirectoryTreeInventory> => {
    const inventory = scanNoFollowDirectoryTreeInventory(rootIdentity, {
      deadlineAtMs: context.deadlineAtMonotonicMs,
      maximumBytes: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES,
      maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
      signal: context.signal
    });
    const observedTree = runtimeDependencyTreeIdentity(inventory);
    if (observedTree.treeDigest !== sourceGeneration.treeDigest
        || observedTree.treeEntryCount !== sourceGeneration.treeEntryCount) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency read-only generation content changed');
    }
    return inventory;
  };
  const seal = async (
    inventory = observeInventory()
  ): Promise<Readonly<{
    generation: RetainedNoFollowProvenDirectoryGeneration;
    proofText: string;
  }>> => {
    const sealed = await materializeRetainedNoFollowProvenDirectoryGeneration({
      binding,
      deadlineAtUnixMs: Date.now() + Math.max(1, Math.floor(
        runtimeDependencyOperationRemainingMs(options, 'Compiler dependency read-only generation seal')
      )),
      inventory,
      proofText: null,
      root: sourceRoot,
      signal: context.signal
    });
    try {
      await runtimeDependencyOperationEffectFence(
        options,
        'Compiler dependency sealed generation proof publication'
      );
      await sealed.generation.assertAuthorityCurrent();
      const sealedRoot = inspectNoFollowDirectoryChain(
        sourceGeneration.sourcePath,
        'Compiler dependency sealed generation readback root'
      ).target;
      if (!sameGeneratedStateIdentity(
        generatedStatePhysicalIdentity(sealedRoot),
        sourceGeneration.physical
      )) {
        throw new CodedFailure(
          'RUNTIME-DEPS-004',
          'Compiler dependency generation changed after proof seal'
        );
      }
      observeInventory(sealedRoot);
      await sealed.generation.assertAuthorityCurrent();
      return sealed;
    } catch (error) {
      const settlementFailures: unknown[] = [];
      try {
        const retirement = await sealed.generation.retire();
        assertPhysicalGenerationRetirementReceipt(retirement);
      } catch (retirementError) {
        settlementFailures.push(retirementError);
      }
      try {
        const currentRoot = inspectNoFollowDirectoryChain(
          sourceGeneration.sourcePath,
          'Compiler dependency rejected proof retirement root'
        ).target;
        await retireNoFollowProvenDirectoryGeneration({
          binding,
          deadlineAtUnixMs: Date.now() + Math.max(1, Math.floor(
            runtimeDependencyOperationRemainingMs(options, 'Compiler dependency rejected proof retirement')
          )),
          proofText: sealed.proofText,
          root: currentRoot,
          signal: context.signal
        });
      } catch (retirementError) {
        settlementFailures.push(retirementError);
      }
      if (settlementFailures.length !== 0) {
        throw new AggregateError(
          [error, ...settlementFailures],
          'Compiler dependency proof validation and physical settlement both failed'
        );
      }
      if (error instanceof CodedFailure && error.code === 'RUNTIME-DEPS-004') throw error;
      throw new CodedFailure(
        'RUNTIME-DEPS-004',
        'Compiler dependency sealed generation changed before proof publication',
        { cause: error instanceof Error ? error.message : String(error) }
      );
    }
  };
  let recoveredOwnerProof = false;
  if (proofText === null) {
    if (!ownsProof) {
      throw new CodedFailure(
        'RUNTIME-DEPS-004',
        'Compiler dependency source owner proof is unavailable'
      );
    }
    materialized = await seal();
  } else {
    try {
      materialized = await materializeRetainedNoFollowProvenDirectoryGeneration({
        binding,
        deadlineAtUnixMs: Date.now() + Math.max(1, Math.floor(
          runtimeDependencyOperationRemainingMs(options, 'Compiler dependency read-only generation reopen')
        )),
        proofText,
        root: sourceRoot,
        signal: context.signal
      });
    } catch (error) {
      if (!ownsProof || !(error instanceof WindowsHostDirectoryAuthorityError)
          || error.failure !== 'physical-identity-changed') {
        throw error;
      }
      const inventory = observeInventory();
      await runtimeDependencyOperationEffectFence(
        options,
        'Compiler dependency owner proof recovery retirement'
      );
      await retireNoFollowProvenDirectoryGeneration({
        binding,
        deadlineAtUnixMs: Date.now() + Math.max(1, Math.floor(
          runtimeDependencyOperationRemainingMs(options, 'Compiler dependency owner proof recovery retirement')
        )),
        proofText,
        root: sourceRoot,
        signal: context.signal
      });
      sourceRoot = inspectNoFollowDirectoryChain(
        sourceGeneration.sourcePath,
        'Compiler dependency recovered generation root'
      ).target;
      if (!sameGeneratedStateIdentity(
        generatedStatePhysicalIdentity(sourceRoot),
        sourceGeneration.physical
      )) {
        throw new CodedFailure(
          'RUNTIME-DEPS-004',
          'Compiler dependency generation changed during owner proof recovery'
        );
      }
      materialized = await seal(inventory);
      recoveredOwnerProof = true;
    }
  }
  const effectiveProofText = materialized.proofText;
  let authorityFailure: RuntimeDependencyCapturedFailure | undefined;
  try {
    await materialized.generation.assertAuthorityCurrent();
  } catch (error) {
    authorityFailure = Object.freeze({ error });
  }
  let retainedRetirementFailure: RuntimeDependencyCapturedFailure | undefined;
  try {
    const retirement = await materialized.generation.retire();
    assertPhysicalGenerationRetirementReceipt(retirement);
  } catch (error) {
    retainedRetirementFailure = Object.freeze({ error });
  }
  if (authorityFailure !== undefined && retainedRetirementFailure !== undefined) {
    throw new AggregateError(
      [authorityFailure.error, retainedRetirementFailure.error],
      'Compiler dependency generation authority and retained-capability retirement both failed'
    );
  }
  if (authorityFailure !== undefined) throw authorityFailure.error;
  if (retainedRetirementFailure !== undefined) throw retainedRetirementFailure.error;

  const publicationRequired = proofBytes === null || recoveredOwnerProof;
  let publishedProofObservation: NoFollowOwnedFileObservation | null = null;
  try {
    if (publicationRequired) {
      assertCompilerDependencyProofNamespaceCurrent(
        namespace,
        sourceGeneration,
        'Compiler dependency execution proof publication admission'
      );
      await runtimeDependencyOperationEffectFence(
        options,
        'Compiler dependency execution proof publication'
      );
      const bytes = Buffer.from(effectiveProofText, 'utf8');
      const validate = (candidate: Uint8Array): void => {
        if (!Buffer.from(candidate).equals(bytes)) {
          throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency execution proof bytes changed');
        }
      };
      if (proofBytes === null) {
        const receipt = publishExclusiveDurableCanonicalFile({
          parent: proofRoot,
          name: proofName,
          bytes,
          validate
        });
        if (receipt.created) {
          const observation = observeNoFollowOwnedFile(
            proofPath,
            'Compiler dependency published execution proof'
          );
          if (observation === null || observation.device !== receipt.physical.device
              || observation.inode !== receipt.physical.inode) {
            throw new CodedFailure(
              'RUNTIME-DEPS-004',
              'Compiler dependency published execution proof identity changed'
            );
          }
          publishedProofObservation = observation;
        }
      } else {
        if (proofEntry === null) {
          throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency source owner proof changed');
        }
        const receipt = replaceDurableCanonicalFile({
          parent: proofRoot,
          name: proofName,
          bytes,
          expectedExisting: { device: proofEntry.device, inode: proofEntry.inode },
          validate
        });
        const observation = observeNoFollowOwnedFile(
          proofPath,
          'Compiler dependency replaced execution proof'
        );
        if (observation === null || observation.device !== receipt.physical.device
            || observation.inode !== receipt.physical.inode) {
          throw new CodedFailure(
            'RUNTIME-DEPS-004',
            'Compiler dependency replaced execution proof identity changed'
          );
        }
        publishedProofObservation = observation;
      }
    }
    assertCompilerDependencyProofNamespaceCurrent(
      namespace,
      sourceGeneration,
      'Compiler dependency execution proof readback admission'
    );
    const readback = readNoFollowOrdinaryFile(proofRoot, proofName);
    if (readback === null || Buffer.from(readback).toString('utf8') !== effectiveProofText) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency execution proof readback changed');
    }
    assertCompilerDependencyProofNamespaceCurrent(
      namespace,
      sourceGeneration,
      'Compiler dependency execution proof final readback'
    );
  } catch (error) {
    if (!publicationRequired) throw error;
    const settlementFailures: unknown[] = [];
    let currentProofObservation: NoFollowOwnedFileObservation | null | undefined;
    try {
      assertCompilerDependencyProofNamespaceCurrent(
        namespace,
        sourceGeneration,
        'Compiler dependency rejected proof publication settlement admission'
      );
      currentProofObservation = observeNoFollowOwnedFile(
        proofPath,
        'Compiler dependency rejected proof publication settlement'
      );
    } catch (observationError) {
      settlementFailures.push(observationError);
    }
    const ownedProofObservation = publishedProofObservation !== null
      && currentProofObservation !== null && currentProofObservation !== undefined
      && sameNoFollowOwnedFileObservation(publishedProofObservation, currentProofObservation)
      ? publishedProofObservation
      : recoveredOwnerProof && initialProofObservation !== null
        && currentProofObservation !== null && currentProofObservation !== undefined
        && sameNoFollowOwnedFileObservation(initialProofObservation, currentProofObservation)
        ? initialProofObservation
        : null;
    if (currentProofObservation !== null && currentProofObservation !== undefined
        && ownedProofObservation === null) {
      settlementFailures.push(new CodedFailure(
        'RUNTIME-DEPS-004',
        'Compiler dependency rejected proof publication left unowned proof state'
      ));
    }
    let physicalRetired = false;
    if (currentProofObservation !== undefined
        && (currentProofObservation === null || ownedProofObservation !== null)) {
      try {
        await runtimeDependencyOperationEffectFence(
          options,
          'Compiler dependency rejected proof publication retirement'
        );
        const currentRoot = inspectNoFollowDirectoryChain(
          sourceGeneration.sourcePath,
          'Compiler dependency rejected proof publication root'
        ).target;
        await retireNoFollowProvenDirectoryGeneration({
          binding,
          deadlineAtUnixMs: Date.now() + Math.max(1, Math.floor(
            runtimeDependencyOperationRemainingMs(options, 'Compiler dependency rejected proof publication retirement')
          )),
          proofText: effectiveProofText,
          root: currentRoot,
          signal: context.signal
        });
        physicalRetired = true;
      } catch (retirementError) {
        settlementFailures.push(retirementError);
      }
    }
    if (physicalRetired) {
      try {
        assertCompilerDependencyProofNamespaceCurrent(
          namespace,
          sourceGeneration,
          'Compiler dependency rejected proof publication cleanup'
        );
        const proofAfterRetirement = observeNoFollowOwnedFile(
          proofPath,
          'Compiler dependency rejected proof publication cleanup'
        );
        if ((proofAfterRetirement === null) !== (ownedProofObservation === null)
            || (proofAfterRetirement !== null && ownedProofObservation !== null
              && !sameNoFollowOwnedFileObservation(ownedProofObservation, proofAfterRetirement))) {
          throw new CodedFailure(
            'RUNTIME-DEPS-004',
            'Compiler dependency rejected proof publication ownership changed during retirement'
          );
        }
        if (ownedProofObservation !== null) {
          const publishedBytes = readNoFollowOrdinaryFile(proofRoot, proofName);
          const publishedReadback = observeNoFollowOwnedFile(
            proofPath,
            'Compiler dependency rejected proof publication cleanup readback'
          );
          if (publishedBytes === null || publishedReadback === null
              || !sameNoFollowOwnedFileObservation(ownedProofObservation, publishedReadback)) {
            throw new CodedFailure(
              'RUNTIME-DEPS-004',
              'Compiler dependency rejected proof publication ownership changed'
            );
          }
          await runtimeDependencyOperationEffectFence(
            options,
            'Compiler dependency rejected proof publication cleanup'
          );
          assertCompilerDependencyProofNamespaceCurrent(
            namespace,
            sourceGeneration,
            'Compiler dependency rejected proof publication deletion admission'
          );
          deleteNoFollowOwnedFile(
            proofPath,
            ownedProofObservation,
            'Compiler dependency rejected proof publication cleanup'
          );
          if (observeNoFollowOwnedFile(
            proofPath,
            'Compiler dependency rejected proof publication cleanup terminal'
          ) !== null) {
            throw new CodedFailure(
              'RUNTIME-DEPS-004',
              'Compiler dependency rejected proof publication cleanup left residue'
            );
          }
        }
        assertCompilerDependencyProofNamespaceCurrent(
          namespace,
          sourceGeneration,
          'Compiler dependency rejected proof publication cleanup terminal readback'
        );
      } catch (cleanupError) {
        settlementFailures.push(cleanupError);
      }
    }
    if (settlementFailures.length !== 0) {
      throw new AggregateError(
        [error, ...settlementFailures],
        'Compiler dependency proof publication and physical settlement both failed'
      );
    }
    throw error;
  }
  return Object.freeze({ proofText: effectiveProofText, sourceRoot });
}

export async function retainCompilerDependencyExecutionGeneration(
  authority: CompilerDependencyExecutionGenerationAuthority,
  input: Readonly<{ deadlineAtUnixMs: number; signal?: AbortSignal }>
): Promise<RetainedCompilerDependencyExecutionGeneration> {
  assertCompilerDependencyExecutionGenerationAuthority(authority);
  const record = compilerDependencyExecutionGenerationAuthorities.get(authority)!;
  if (!Number.isSafeInteger(input.deadlineAtUnixMs) || input.deadlineAtUnixMs <= Date.now()
      || input.signal?.aborted === true) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency execution generation admission expired');
  }
  const lockTimeoutMs = Math.max(1, Math.min(
    MAX_DEPENDENCY_OPERATION_TIMEOUT_MS,
    input.deadlineAtUnixMs - Date.now()
  ));
  let pendingGeneration: RetainedNoFollowProvenDirectoryGeneration | undefined;
  const admitted = await withCompilerDependencyCoordinationLease(
    record.sourceGeneration.ownerRoot,
    { deadlineAtUnixMs: input.deadlineAtUnixMs, lockTimeoutMs, signal: input.signal },
    async (options) => {
      runtimeDependencyOperationRemainingMs(options, 'Compiler dependency execution generation admission');
      await assertCompilerDependencyReadTransitionTerminal(record.sourceGeneration.ownerRoot, options);
      if (!sameHostPath(record.root, record.sourceGeneration.ownerRoot)) {
        await assertCompilerDependencyReadTransitionTerminal(record.root, options);
      }
      const sealed = await ensureCompilerDependencyGenerationReadOnlyProof(
        record.root,
        record.sourceGeneration,
        options
      );
      const currentRoot = assertSameNoFollowDirectoryIdentity(
        sealed.sourceRoot,
        'Compiler dependency execution generation retained root'
      ).target;
      const materialized = await materializeRetainedNoFollowProvenDirectoryGeneration({
        binding: {
          generationDigest: record.sourceGeneration.epoch,
          treeDigest: record.sourceGeneration.treeDigest,
          treeEntryCount: record.sourceGeneration.treeEntryCount
        },
        deadlineAtUnixMs: input.deadlineAtUnixMs,
        proofText: sealed.proofText,
        root: currentRoot,
        signal: input.signal
      });
      pendingGeneration = materialized.generation;
      await materialized.generation.assertAuthorityCurrent();
      const acquired = await acquireCompilerDependencyConsumer(
        record.sourceGeneration,
        options
      );
      return Object.freeze({ acquired, generation: materialized.generation });
    }
  ).catch(async (error) => {
    if (pendingGeneration === undefined) throw error;
    try {
      await pendingGeneration.retire();
    } catch (retirementError) {
      throw new AggregateError(
        [error, retirementError],
        'Compiler dependency execution generation admission and physical settlement both failed'
      );
    }
    throw error;
  });
  const materialized = Object.freeze({ generation: admitted.generation });
  pendingGeneration = undefined;
  try {
    await materialized.generation.assertAuthorityCurrent();
  } catch (error) {
    try {
      const physicalReceipt = await materialized.generation.retire();
      await releaseCompilerDependencyConsumer(record.sourceGeneration.ownerRoot, admitted.acquired, physicalReceipt);
    } catch { /* durable acquisition residue preserves the authority failure */ }
    throw error;
  }
  let physicalRetirement: PhysicalGenerationRetirementReceipt | null = null;
  let durableRelease: CompilerDependencyConsumerRecord | null = null;
  let terminalRetirement: CompilerDependencyExecutionRetirementReceipt | null = null;
  let retirementAttempt: Promise<CompilerDependencyExecutionRetirementReceipt> | null = null;
  return Object.freeze({
    directRootResolution: record.directRootResolution,
    generationDigest: record.sourceGeneration.epoch,
    physicalGeneration: materialized.generation,
    retire: () => {
      if (terminalRetirement !== null) return Promise.resolve(terminalRetirement);
      if (retirementAttempt !== null) return retirementAttempt;
      retirementAttempt = (async () => {
        const physicalReceipt = physicalRetirement ?? await materialized.generation.retire();
        assertPhysicalGenerationRetirementReceipt(physicalReceipt);
        physicalRetirement = physicalReceipt;
        let released: CompilerDependencyConsumerRecord;
        if (durableRelease === null) {
          released = await releaseCompilerDependencyConsumer(
            record.sourceGeneration.ownerRoot,
            admitted.acquired,
            physicalReceipt,
            (terminal) => { durableRelease = terminal; }
          );
        } else {
          await withCompilerDependencyCoordinationLease(record.sourceGeneration.ownerRoot, { lockTimeoutMs: 30_000 }, async () => {});
          released = durableRelease;
        }
        const receipt: CompilerDependencyExecutionRetirementReceipt = Object.freeze({
          schema: 'sec-compiler-dependency-execution-retirement-v1' as const,
          generationDigest: admitted.acquired.generationDigest,
          generationPhysical: Object.freeze({ ...admitted.acquired.generationPhysical }),
          leaseId: admitted.acquired.leaseId,
          releaseRecordDigest: released.recordDigest,
          terminal: 'released' as const
        });
        issuedCompilerDependencyExecutionRetirementReceipts.add(receipt);
        terminalRetirement = receipt;
        return receipt;
      })().finally(() => {
        if (terminalRetirement === null) retirementAttempt = null;
      });
      return retirementAttempt;
    }
  });
}

/**
 * Reopens an already-published, owner-proven compiler dependency generation
 * for one read-only consumer. Unlike execution retention, this operation does
 * not acquire the compiler transition lease or publish consumer ledger state;
 * absence of the existing publisher proof is therefore an unavailable read,
 * never permission to seal, repair, install or materialize dependency state.
 */
export async function retainCompilerDependencyReadGeneration(
  authority: CompilerDependencyExecutionGenerationAuthority,
  input: Readonly<{ deadlineAtUnixMs: number; signal?: AbortSignal }>
): Promise<RetainedCompilerDependencyReadGeneration> {
  assertCompilerDependencyExecutionGenerationAuthority(authority);
  if (!Number.isSafeInteger(input.deadlineAtUnixMs) || input.deadlineAtUnixMs <= Date.now() ||
      input.signal?.aborted === true) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency read generation admission expired');
  }
  const expected = compilerDependencyExecutionGenerationAuthorities.get(authority)!;
  const operationOptions = runtimeDependencyOperationOptions({
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    signal: input.signal
  });
  const assertOwnerAuthorityCurrent = async (
    sourceRoot: PhysicalDirectoryIdentity,
    boundary: string
  ): Promise<void> => {
    runtimeDependencyOperationRemainingMs(operationOptions, boundary);
    assertCompilerDependencyInputsCurrent(expected.root, expected.identity);
    const [currentGenerationPath, currentBinding] = await Promise.all([
      fs.realpath(expected.nodeModulesPath).then((value) => path.resolve(value)),
      readCompilerDepsBinding(path.join(expected.sourceGeneration.sourcePath, COMPILER_DEPS_BINDING_FILE))
    ]);
    const currentRoot = assertSameNoFollowDirectoryIdentity(sourceRoot, boundary).target;
    if (!sameHostPath(currentGenerationPath, expected.sourceGeneration.sourcePath) ||
        currentBinding === null || !canonicalEquals(currentBinding, expected.binding) ||
        !sameGeneratedStateIdentity(
          generatedStatePhysicalIdentity(currentRoot),
          expected.sourceGeneration.physical
        )) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency read generation authority changed');
    }
  };
  let pendingGeneration: RetainedNoFollowProvenDirectoryGeneration | undefined;
  let admitted: Readonly<{
    acquired: CompilerDependencyConsumerRecord;
    generation: RetainedNoFollowProvenDirectoryGeneration;
    sourceRoot: PhysicalDirectoryIdentity;
  }>;
  try {
    admitted = await withCompilerDependencyCoordinationLease(
      expected.sourceGeneration.ownerRoot,
      operationOptions,
      async (lockedOptions) => {
        // A prior opaque observation cannot authorize a read after the physical
        // owner has entered recovery. Recheck under that owner's GC/writer lease.
        await assertCompilerDependencyReadTransitionTerminal(expected.sourceGeneration.ownerRoot, lockedOptions);
        if (!sameHostPath(expected.root, expected.sourceGeneration.ownerRoot)) {
          await assertCompilerDependencyReadTransitionTerminal(expected.root, lockedOptions);
        }
        const sourceRoot = inspectNoFollowDirectoryChain(
          expected.sourceGeneration.sourcePath,
          'Compiler dependency read generation root'
        ).target;
        if (!sameGeneratedStateIdentity(
          generatedStatePhysicalIdentity(sourceRoot),
          expected.sourceGeneration.physical
        )) {
          throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency read generation root changed');
        }
        await assertOwnerAuthorityCurrent(
          sourceRoot,
          'Compiler dependency read generation authority admission'
        );
        const namespace = inspectCompilerDependencyProofNamespace(
          expected.sourceGeneration,
          'Compiler dependency read generation proof'
        );
        if (namespace === null) {
          throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency read generation proof is unavailable');
        }
        const proofRoot = inspectNoFollowDirectoryChild(
          namespace.backupRoot,
          'read-only-generations',
          'Compiler dependency read generation proof root'
        );
        if (proofRoot === null) {
          throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency read generation proof is unavailable');
        }
        const proofName = `${expected.sourceGeneration.epoch.slice('sha256:'.length)}.json`;
        const proofBytes = readNoFollowOrdinaryFile(proofRoot, proofName);
        if (proofBytes === null) {
          throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency read generation proof is unavailable');
        }
        assertCompilerDependencyProofNamespaceCurrent(
          namespace,
          expected.sourceGeneration,
          'Compiler dependency read generation proof readback'
        );
        let proofText: string;
        try {
          proofText = new TextDecoder('utf-8', { fatal: true }).decode(proofBytes);
        } catch (error) {
          throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency read generation proof is not exact UTF-8', {
            cause: error instanceof Error ? error.message : String(error)
          });
        }
        const reopened = await reopenRetainedNoFollowProvenDirectoryGeneration({
          deadlineAtUnixMs: input.deadlineAtUnixMs,
          proofText,
          root: sourceRoot,
          signal: input.signal
        });
        pendingGeneration = reopened.generation;
        if (reopened.binding.generationDigest !== expected.sourceGeneration.epoch ||
            reopened.binding.treeDigest !== expected.sourceGeneration.treeDigest ||
            reopened.binding.treeEntryCount !== expected.sourceGeneration.treeEntryCount) {
          throw new CodedFailure(
            'RUNTIME-DEPS-004',
            'Compiler dependency read generation proof differs from its owner authority'
          );
        }
        await reopened.generation.assertAuthorityCurrent();
        await assertOwnerAuthorityCurrent(
          sourceRoot,
          'Compiler dependency read generation authority readback'
        );
        assertCompilerDependencyProofNamespaceCurrent(
          namespace,
          expected.sourceGeneration,
          'Compiler dependency read generation proof final readback'
        );
        const acquired = await acquireCompilerDependencyConsumer(
          expected.sourceGeneration,
          lockedOptions
        );
        return Object.freeze({ acquired, generation: reopened.generation, sourceRoot });
      }
    );
    pendingGeneration = undefined;
  } catch (error) {
    if (pendingGeneration !== undefined) {
      try {
        await pendingGeneration.retire();
      } catch (retirementError) {
        throw new AggregateError(
          [error, retirementError],
          'Compiler dependency read generation admission and physical settlement both failed'
        );
      }
    }
    throw error;
  }
  let physicalRetirement: PhysicalGenerationRetirementReceipt | null = null;
  let durableRelease: CompilerDependencyConsumerRecord | null = null;
  let terminalRetirement: CompilerDependencyReadGenerationRetirementReceipt | null = null;
  let retirementAttempt: Promise<CompilerDependencyReadGenerationRetirementReceipt> | null = null;
  const retained: RetainedCompilerDependencyReadGeneration = Object.freeze({
    assertAuthorityCurrent: async () => {
      await admitted.generation.assertAuthorityCurrent();
      await assertOwnerAuthorityCurrent(
        admitted.sourceRoot,
        'Compiler dependency read generation consumer readback'
      );
    },
    generationDigest: expected.sourceGeneration.epoch,
    physicalGeneration: admitted.generation,
    retire: () => {
      if (terminalRetirement !== null) return Promise.resolve(terminalRetirement);
      if (retirementAttempt !== null) return retirementAttempt;
      retirementAttempt = (async () => {
        const physicalReceipt = physicalRetirement ?? await admitted.generation.retire();
        assertPhysicalGenerationRetirementReceipt(physicalReceipt);
        physicalRetirement = physicalReceipt;
        if (durableRelease === null) {
          await releaseCompilerDependencyConsumer(
            expected.sourceGeneration.ownerRoot,
            admitted.acquired,
            physicalReceipt,
            (terminal) => { durableRelease = terminal; }
          );
        } else {
          await withCompilerDependencyCoordinationLease(expected.sourceGeneration.ownerRoot, { lockTimeoutMs: 30_000 }, async () => {});
        }
        const receipt: CompilerDependencyReadGenerationRetirementReceipt = Object.freeze({
          generationDigest: expected.sourceGeneration.epoch,
          physicalRoot: physicalReceipt.root,
          terminal: 'released' as const
        });
        issuedCompilerDependencyReadGenerationRetirementReceipts.add(receipt);
        terminalRetirement = receipt;
        return receipt;
      })().finally(() => {
        if (terminalRetirement === null) retirementAttempt = null;
      });
      return retirementAttempt;
    }
  });
  issuedCompilerDependencyReadGenerations.add(retained);
  return retained;
}

function createCompilerDepsReadyState(input: Readonly<{
  binding: Readonly<CompilerDepsBinding>;
  identity: CompilerDependencyIdentity;
  kind: CompilerDependencyTransitionKind;
  nodeModulesPath: string;
  root: string;
  sourceGeneration: Readonly<RuntimeDependencySourceGeneration>;
  source: 'existing' | 'installed';
}>): CompilerDepsReadyState {
  const authority = issueCompilerDependencyExecutionGenerationAuthority({
    binding: input.binding,
    directRootResolution: compilerDependencyDirectRootResolution(input.binding, input.identity),
    identity: input.identity,
    kind: input.kind,
    nodeModulesPath: input.nodeModulesPath,
    root: input.root,
    sourceGeneration: input.sourceGeneration,
    source: input.source
  });
  return projectCompilerDepsReadyState(authority);
}

type CompilerDependencyReadyObservation =
  | Readonly<{
      binding: Readonly<CompilerDepsBinding>;
      kind: 'external-bridge' | 'local-generation';
      nodeModulesPath: string;
      sourceGeneration: Readonly<RuntimeDependencySourceGeneration>;
    }>
  | Readonly<{
      kind: 'incompatible-bridge';
      nodeModulesPath: string;
    }>;

type CompilerDependencyPublishedProofObservation =
  | Exclude<CompilerDependencyReadyObservation, Readonly<{ kind: 'incompatible-bridge' }>>
  | Readonly<{ kind: 'owner-proof-recovery-required' }>;

/**
 * Reads the one admitted compiler dependency surface without publishing or
 * repairing it. A linked-worktree locator and a local physical generation are
 * two representations of the same readiness contract, so read-only consumers
 * must not reimplement the generation-only half of that contract.
 */
async function observeCompilerDependencyReady(
  root: string,
  nodeModulesPath: string,
  identity: CompilerDependencyIdentity,
  options: RuntimeDependencyOperationOptions
): Promise<CompilerDependencyReadyObservation | null> {
  const bridge = await observeCompilerDependencyBridge(
    root,
    nodeModulesPath,
    identity,
    options
  );
  if (bridge.status === 'incompatible') {
    return Object.freeze({ kind: 'incompatible-bridge', nodeModulesPath });
  }
  if (bridge.status === 'ready') {
    const bridgeBinding = bridge.binding;
    const generationPath = path.resolve(await fs.realpath(nodeModulesPath));
    const ownerRoot = canonicalCompilerDependencyGenerationOwnerRoot(generationPath) ??
      path.dirname(generationPath);
    const sourceGeneration = await runtimeDependencySourceGeneration({
      binding: bridgeBinding,
      options,
      ownerRoot,
      sourcePath: generationPath
    });
    return Object.freeze({
      binding: bridgeBinding,
      kind: 'external-bridge',
      nodeModulesPath,
      sourceGeneration
    });
  }
  const generationBinding = await compilerDependencyGenerationBinding(
    root,
    nodeModulesPath,
    path.join(nodeModulesPath, COMPILER_DEPS_BINDING_FILE),
    identity
  );
  if (generationBinding === null) return null;
  const sourceGeneration = await runtimeDependencySourceGeneration({
    binding: generationBinding,
    options,
    ownerRoot: root,
    sourcePath: nodeModulesPath
  });
  return Object.freeze({
    binding: generationBinding,
    kind: 'local-generation',
    nodeModulesPath,
    sourceGeneration
  });
}

const COMPILER_DEPENDENCY_EXECUTION_PROOF_CAPACITY = 4_096;

/**
 * Reopens the retained publisher proof before asking the dependency owner to
 * inventory the tree. Canonical compiler generations encode the first 96
 * epoch bits in their immutable directory name, so the owner can select the
 * one full proof without trusting a mutable locator or scanning descendants.
 */
async function observeCompilerDependencyReadyFromRetainedProof(
  root: string,
  nodeModulesPath: string,
  identity: CompilerDependencyIdentity,
  options: RuntimeDependencyOperationOptions
): Promise<CompilerDependencyPublishedProofObservation | null> {
  const bridge = await observeCompilerDependencyBridge(root, nodeModulesPath, identity, options);
  if (bridge.status === 'incompatible') return null;
  const binding = bridge.status === 'ready'
    ? bridge.binding
    : await compilerDependencyGenerationBinding(
      root,
      nodeModulesPath,
      path.join(nodeModulesPath, COMPILER_DEPS_BINDING_FILE),
      identity
    );
  if (binding === null) return null;
  let generationPath: string;
  try {
    generationPath = path.resolve(await fs.realpath(nodeModulesPath));
  } catch (error) {
    if (isFileNotFoundError(error)) return null;
    throw error;
  }
  const ownerRoot = canonicalCompilerDependencyGenerationOwnerRoot(generationPath);
  if (ownerRoot === null) return null;
  const generationSelector = path.basename(generationPath).slice('generation-'.length);
  const owner = inspectNoFollowDirectoryChain(
    ownerRoot,
    'Compiler dependency retained proof owner root'
  ).target;
  const generationRoot = inspectNoFollowDirectoryChain(
    generationPath,
    'Compiler dependency retained proof generation root'
  ).target;
  const namespace = inspectDependencyTransitionNamespace(ownerRoot);
  const ownerProofUnavailable = (): CompilerDependencyPublishedProofObservation => {
    if (sameHostPath(root, ownerRoot)) {
      return Object.freeze({ kind: 'owner-proof-recovery-required' as const });
    }
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency source owner proof is unavailable');
  };
  if (namespace === null) return ownerProofUnavailable();
  const namespaceOwner = assertSameNoFollowDirectoryIdentity(
    namespace.ownerRoot,
    'Compiler dependency retained proof namespace owner'
  ).target;
  if (!sameHostPath(namespaceOwner.path, ownerRoot)
      || !sameGeneratedStateIdentity(
        generatedStatePhysicalIdentity(namespaceOwner),
        generatedStatePhysicalIdentity(owner)
      )) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency retained proof namespace owner changed');
  }
  const proofRoot = inspectNoFollowDirectoryChild(
    namespace.backupRoot,
    'read-only-generations',
    'Compiler dependency retained proof root'
  );
  if (proofRoot === null) return ownerProofUnavailable();
  const proofNames = (await readNoFollowDirectNames(
    proofRoot,
    'Compiler dependency retained proof census',
    COMPILER_DEPENDENCY_EXECUTION_PROOF_CAPACITY,
    options
  )).filter((name) => (
    name.startsWith(generationSelector)
    && /^[0-9a-f]{64}\.json$/u.test(name)
  ));
  if (proofNames.length === 0) return ownerProofUnavailable();
  if (proofNames.length !== 1) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency generation selector matches multiple retained proofs');
  }
  const proofBytes = readNoFollowOrdinaryFile(proofRoot, proofNames[0]!);
  if (proofBytes === null) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency retained proof disappeared during readback');
  }
  let proofText: string;
  try {
    proofText = new TextDecoder('utf-8', { fatal: true }).decode(proofBytes);
  } catch (error) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency retained proof is not exact UTF-8', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  const context = runtimeDependencyOperationContext(options);
  let reopened: Awaited<ReturnType<typeof reopenRetainedNoFollowProvenDirectoryGeneration>>;
  try {
    reopened = await reopenRetainedNoFollowProvenDirectoryGeneration({
      deadlineAtUnixMs: Date.now() + Math.max(1, Math.floor(
        runtimeDependencyOperationRemainingMs(options, 'Compiler dependency retained proof')
      )),
      proofText,
      root: generationRoot,
      signal: context.signal
    });
  } catch (error) {
    if (!(error instanceof WindowsHostDirectoryAuthorityError)
        || error.failure !== 'physical-identity-changed') {
      throw error;
    }
    return ownerProofUnavailable();
  }
  let result: Exclude<CompilerDependencyReadyObservation, Readonly<{ kind: 'incompatible-bridge' }>> | undefined;
  let readbackFailure: RuntimeDependencyCapturedFailure | undefined;
  try {
    const sourceGeneration = issueRuntimeDependencySourceGenerationFromProvenDirectory({
      binding,
      generation: reopened.generation,
      ownerRoot,
      proofBinding: reopened.binding,
      sourcePath: generationPath
    });
    if (`${sourceGeneration.epoch.slice('sha256:'.length)}.json` !== proofNames[0]) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency retained proof selector differs from its source epoch');
    }
    await options.beforeCommit?.();
    runtimeDependencyOperationRemainingMs(options, 'Compiler dependency retained proof readback');
    await reopened.generation.assertAuthorityCurrent();
    const [finalIdentity, finalBinding, finalGenerationPath] = await Promise.all([
      observeCompilerDependencyIdentity(root, options),
      readCompilerDepsBinding(path.join(generationPath, COMPILER_DEPS_BINDING_FILE)),
      fs.realpath(nodeModulesPath).then((value) => path.resolve(value))
    ]);
    if (!canonicalEquals(finalIdentity, identity) || finalBinding === null
        || !canonicalEquals(finalBinding, binding)
        || finalGenerationPath !== generationPath) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency generation changed during retained proof readback');
    }
    result = Object.freeze({
      binding,
      kind: bridge.status === 'ready' ? 'external-bridge' as const : 'local-generation' as const,
      nodeModulesPath,
      sourceGeneration
    });
  } catch (error) {
    readbackFailure = Object.freeze({ error });
  }
  let retirementFailure: RuntimeDependencyCapturedFailure | undefined;
  try {
    const retirement = await reopened.generation.retire();
    assertPhysicalGenerationRetirementReceipt(retirement);
  } catch (error) {
    retirementFailure = Object.freeze({ error });
  }
  if (readbackFailure !== undefined && retirementFailure !== undefined) {
    throw new AggregateError(
      [readbackFailure.error, retirementFailure.error],
      'Compiler dependency retained proof readback and capability retirement both failed'
    );
  }
  if (readbackFailure !== undefined) throw readbackFailure.error;
  if (retirementFailure !== undefined) throw retirementFailure.error;
  return result!;
}

async function observeCompilerDependencyReadyFromPublishedProof(
  root: string,
  nodeModulesPath: string,
  identity: CompilerDependencyIdentity,
  options: RuntimeDependencyOperationOptions,
  observed: Exclude<CompilerDependencyReadyObservation, Readonly<{ kind: 'incompatible-bridge' }>>
): Promise<CompilerDependencyPublishedProofObservation> {
  let generationPath: string;
  try {
    generationPath = path.resolve(await fs.realpath(nodeModulesPath));
  } catch (error) {
    if (isFileNotFoundError(error)) {
      throw new CodedFailure(
        'RUNTIME-DEPS-004',
        'Compiler dependency published generation disappeared before proof readback'
      );
    }
    throw error;
  }
  const binding = await readCompilerDepsBinding(path.join(generationPath, COMPILER_DEPS_BINDING_FILE));
  if (binding === null || !compilerDependencyBindingMatchesIdentity(binding, identity)
      || !canonicalEquals(binding, observed.binding)
      || !sameHostPath(generationPath, observed.sourceGeneration.sourcePath)) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Compiler dependency published generation changed before proof readback'
    );
  }
  const generationRoot = inspectNoFollowDirectoryChain(
    generationPath,
    'Compiler dependency published generation root'
  ).target;
  const generationPhysical = generatedStatePhysicalIdentity(generationRoot);
  if (!sameGeneratedStateIdentity(observed.sourceGeneration.physical, generationPhysical)) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Compiler dependency published generation physical identity changed before proof readback'
    );
  }
  const ownerRecoveryRequired = (): CompilerDependencyPublishedProofObservation => {
    if (sameHostPath(root, observed.sourceGeneration.ownerRoot)) {
      return Object.freeze({ kind: 'owner-proof-recovery-required' as const });
    }
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Compiler dependency source owner proof is unavailable'
    );
  };
  const namespace = inspectCompilerDependencyProofNamespace(
    observed.sourceGeneration,
    'Compiler dependency published generation proof'
  );
  if (namespace === null) return ownerRecoveryRequired();
  const proofRoot = inspectNoFollowDirectoryChild(
    namespace.backupRoot,
    'read-only-generations',
    'Compiler dependency published generation proof root'
  );
  if (proofRoot === null) return ownerRecoveryRequired();
  const proofName = `${observed.sourceGeneration.epoch.slice('sha256:'.length)}.json`;
  const proofBytes = readNoFollowOrdinaryFile(proofRoot, proofName);
  if (proofBytes === null) return ownerRecoveryRequired();
  assertCompilerDependencyProofNamespaceCurrent(
    namespace,
    observed.sourceGeneration,
    'Compiler dependency published generation proof readback'
  );
  let proofText: string;
  try {
    proofText = new TextDecoder('utf-8', { fatal: true }).decode(proofBytes);
  } catch (error) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency published generation proof is not exact UTF-8', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  const context = runtimeDependencyOperationContext(options);
  let reopened: Awaited<ReturnType<typeof reopenRetainedNoFollowProvenDirectoryGeneration>>;
  try {
    reopened = await reopenRetainedNoFollowProvenDirectoryGeneration({
      deadlineAtUnixMs: Date.now() + Math.max(1, Math.floor(
        runtimeDependencyOperationRemainingMs(options, 'Compiler dependency published generation proof')
      )),
      proofText,
      root: generationRoot,
      signal: context.signal
    });
  } catch (error) {
    if (!(error instanceof WindowsHostDirectoryAuthorityError)
        || error.failure !== 'physical-identity-changed') {
      throw error;
    }
    if (!sameHostPath(root, observed.sourceGeneration.ownerRoot)) {
      throw new CodedFailure(
        'RUNTIME-DEPS-004',
        'Compiler dependency source owner proof changed; owner recovery is required'
      );
    }
    return Object.freeze({ kind: 'owner-proof-recovery-required' as const });
  }
  let result: Exclude<CompilerDependencyReadyObservation, Readonly<{ kind: 'incompatible-bridge' }>> | undefined;
  let readbackFailure: RuntimeDependencyCapturedFailure | undefined;
  try {
    if (reopened.binding.generationDigest !== observed.sourceGeneration.epoch
        || reopened.binding.treeDigest !== observed.sourceGeneration.treeDigest
        || reopened.binding.treeEntryCount !== observed.sourceGeneration.treeEntryCount) {
      throw new CodedFailure(
        'RUNTIME-DEPS-004',
        'Compiler dependency published generation proof differs from its immutable transition'
      );
    }
    await options.beforeCommit?.();
    runtimeDependencyOperationRemainingMs(
      options,
      'Compiler dependency published generation readback'
    );
    await reopened.generation.assertAuthorityCurrent();
    const [finalIdentity, finalBinding, finalGenerationPath] = await Promise.all([
      observeCompilerDependencyIdentity(root, options),
      readCompilerDepsBinding(path.join(generationPath, COMPILER_DEPS_BINDING_FILE)),
      fs.realpath(nodeModulesPath).then((value) => path.resolve(value))
    ]);
    const finalRoot = assertSameNoFollowDirectoryIdentity(
      generationRoot,
      'Compiler dependency published generation final root'
    ).target;
    if (!canonicalEquals(finalIdentity, identity) || finalBinding === null
        || !canonicalEquals(finalBinding, binding)
        || finalGenerationPath !== generationPath
        || !sameGeneratedStateIdentity(generatedStatePhysicalIdentity(finalRoot), generationPhysical)) {
      throw new CodedFailure(
        'RUNTIME-DEPS-004',
        'Compiler dependency published generation changed during proof readback'
      );
    }
    assertCompilerDependencyProofNamespaceCurrent(
      namespace,
      observed.sourceGeneration,
      'Compiler dependency published generation proof final readback'
    );
    result = Object.freeze({
      binding,
      kind: 'external-bridge' as const,
      nodeModulesPath,
      sourceGeneration: observed.sourceGeneration
    });
  } catch (error) {
    readbackFailure = Object.freeze({ error });
  }
  let retirementFailure: RuntimeDependencyCapturedFailure | undefined;
  try {
    const retirement = await reopened.generation.retire();
    assertPhysicalGenerationRetirementReceipt(retirement);
  } catch (error) {
    retirementFailure = Object.freeze({ error });
  }
  if (readbackFailure !== undefined && retirementFailure !== undefined) {
    throw new AggregateError(
      [readbackFailure.error, retirementFailure.error],
      'Compiler dependency proof readback and retained-capability retirement both failed'
    );
  }
  if (readbackFailure !== undefined) throw readbackFailure.error;
  if (retirementFailure !== undefined) throw retirementFailure.error;
  return result!;
}

async function assertCompilerDependencyReadTransitionTerminal(
  root: string,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const pendingTransition = (await readDependencyTransitionLedger(root, options))?.tip ?? null;
  if (pendingTransition !== null && pendingTransition.phase !== 'complete' &&
      pendingTransition.phase !== 'rolled-back') {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Compiler dependency generation observation is blocked by nonterminal recovery state'
    );
  }
}

/**
 * Observe only an already-published compiler dependency generation and issue
 * the same opaque authority consumed by the retained execution owner. This
 * path never recovers, publishes, installs or repairs dependency state. A
 * nonterminal owner journal is therefore a typed blocker, not an invitation
 * to turn a freshness/read operation into a writer.
 * Null means no compatible current execution authority: the locator can be
 * absent or bound to other canonical inputs. Unknown or corrupt state throws.
 */
export async function observeCompilerDependencyExecutionGenerationAuthority(
  options: RuntimeDependencyInstallOptions = {},
  compilerDependencyRoot = compilerRoot
): Promise<CompilerDependencyExecutionGenerationAuthority | null> {
  const operationOptions = runtimeDependencyOperationOptions(options);
  const root = path.resolve(compilerDependencyRoot);
  const nodeModulesPath = dependencyAuthorityPaths(root).compilerModulesRoot;
  runtimeDependencyOperationRemainingMs(
    operationOptions,
    'Compiler dependency generation observation admission'
  );
  await operationOptions.beforeCommit?.();
  runtimeDependencyOperationRemainingMs(
    operationOptions,
    'Compiler dependency generation observation source admission'
  );
  await assertCompilerDependencyReadTransitionTerminal(root, operationOptions);
  const identity = await observeCompilerDependencyIdentity(root, operationOptions);
  const retainedProof = await observeCompilerDependencyReadyFromRetainedProof(
    root,
    nodeModulesPath,
    identity,
    operationOptions
  );
  if (retainedProof !== null) {
    if (retainedProof.kind === 'owner-proof-recovery-required') return null;
    return issueCompilerDependencyExecutionGenerationAuthority({
      binding: retainedProof.binding,
      directRootResolution: compilerDependencyDirectRootResolution(
        retainedProof.binding,
        identity
      ),
      identity,
      kind: 'none',
      nodeModulesPath,
      root,
      sourceGeneration: retainedProof.sourceGeneration,
      source: 'existing'
    });
  }
  const observed = await observeCompilerDependencyReady(
    root,
    nodeModulesPath,
    identity,
    operationOptions
  );
  if (observed === null) {
    const slot = await observeDependencyTransitionSlot(nodeModulesPath);
    if (slot.kind === 'absent') return null;
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Compiler dependency generation is present without an exact owner binding'
    );
  }
  if (observed.kind === 'incompatible-bridge') {
    return null;
  }
  const published = await observeCompilerDependencyReadyFromPublishedProof(
    root,
    nodeModulesPath,
    identity,
    operationOptions,
    observed
  );
  if (published.kind === 'owner-proof-recovery-required') return null;
  return issueCompilerDependencyExecutionGenerationAuthority({
    binding: published.binding,
    directRootResolution: compilerDependencyDirectRootResolution(
      published.binding,
      identity
    ),
    identity,
    kind: 'none',
    nodeModulesPath,
    root,
    sourceGeneration: published.sourceGeneration,
    source: 'existing'
  });
}

async function ensureCompilerDepsReadyInternal(
  options: RuntimeDependencyInstallOptions = {},
  compilerDependencyRoot = compilerRoot,
  admittedSource?: CompilerDependencyExecutionGenerationAuthorityRecord,
  materializationSource: CompilerDependencyMaterializationSource = COMPILER_DEPENDENCY_INSTALL_SOURCE
): Promise<CompilerDepsReadyState> {
  const operationOptions = runtimeDependencyOperationOptions(options);
  const root = path.resolve(compilerDependencyRoot);
  const lifecycleOptions = selectGeneratedStateLifecycle(operationOptions, root);
  await migrateCompilerDependencyCoordination(root, lifecycleOptions);
  const nodeModulesPath = dependencyAuthorityPaths(root).compilerModulesRoot;
  const bindingPath = path.join(nodeModulesPath, COMPILER_DEPS_BINDING_FILE);

  // A legacy v1 root is evidence requiring the owner migration before any
  // readiness read can classify it as absent.  Route that one-way conversion
  // through the compiler-root lease; do not let the normal reader dual-read
  // or fall through to a fresh install.
  if (inspectLegacyDependencyTransitionNamespace(root) !== null) {
    await withCompilerDependencyTransitionLease(root, lifecycleOptions, async () => undefined);
  }

  const identity = await observeCompilerDependencyIdentity(root, lifecycleOptions);
  const activeRollover = await inspectActiveDependencyTransitionRollover(root, lifecycleOptions);
  if (activeRollover !== null && activeRollover.active !== null) {
    // Admission is still read-only; the lease callback above is the only
    // place that may perform the retained-root recovery effect.
    await withCompilerDependencyTransitionLease(root, lifecycleOptions, async () => undefined);
  }
  const pendingTransition = await readDependencyTransition(root, lifecycleOptions);
  if (pendingTransition !== null && pendingTransition.kind !== 'project-projection' &&
      pendingTransition.kind !== 'compiler-bridge' &&
      pendingTransition.phase !== 'complete' && pendingTransition.phase !== 'rolled-back') {
    await withCompilerDependencyTransitionLease(root, lifecycleOptions, async (lockedOptions) => {
      await recoverCompilerDependencyTransition(root, nodeModulesPath, identity, lockedOptions);
    });
  }
  const observed = await observeCompilerDependencyReady(
    root,
    nodeModulesPath,
    identity,
    lifecycleOptions
  );
  if (materializationSource.kind === 'retained-content' && observed !== null) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency content consumer appeared before admission');
  }
  if (observed?.kind === 'incompatible-bridge') {
    await withCompilerDependencyTransitionLease(root, lifecycleOptions, async (lockedOptions) => {
      const current = await observeCompilerDependencyReady(
        root,
        nodeModulesPath,
        identity,
        lockedOptions
      );
      if (current?.kind !== 'incompatible-bridge') {
        throw new CodedFailure(
          'IMPORT-AUTHORITY-004',
          'Compiler dependency locator changed before incompatible-state retirement'
        );
      }
      if (!await disposeCompilerDependencyLocator(
        root,
        lockedOptions,
        'incompatible-compiler-dependency-locator'
      )) {
        throw new CodedFailure(
          'IMPORT-AUTHORITY-004',
          'Incompatible compiler dependency locator disappeared before lifecycle disposal'
        );
      }
    });
  }
  if (observed?.kind === 'external-bridge') {
    return withCompilerDependencyTransitionLease(root, lifecycleOptions, async (lockedOptions) => {
      const current = await observeCompilerDependencyReady(
        root,
        nodeModulesPath,
        identity,
        lockedOptions
      );
      if (current?.kind !== 'external-bridge'
          || !canonicalEquals(current.binding, observed.binding)) {
        throw new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler dependency locator changed before lifecycle binding');
      }
      await ensureCompilerDependencyGenerationReadOnlyProof(
        root,
        current.sourceGeneration,
        lockedOptions
      );
      await bindExistingCompilerDependencyLocator(root, identity, current.binding, lockedOptions);
      return createCompilerDepsReadyState({
        binding: current.binding,
        identity,
        kind: 'none',
        nodeModulesPath,
        root,
        sourceGeneration: current.sourceGeneration,
        source: 'existing'
      });
    });
  }
  if (observed?.kind === 'local-generation') {
    return withCompilerDependencyTransitionLease(root, lifecycleOptions, async (lockedOptions) => {
      const current = await observeCompilerDependencyReady(
        root,
        nodeModulesPath,
        identity,
        lockedOptions
      );
      if (current?.kind !== 'local-generation') {
        throw new CodedFailure(
          'IMPORT-AUTHORITY-004',
          'Compiler dependency generation changed before lifecycle binding; current state is preserved'
        );
      }
      if (lockedOptions.generatedStateLifecycle !== undefined) {
        await bindExistingCompilerDependencyGeneration(
          lockedOptions,
          current.sourceGeneration.physical
        );
      }
      const migratedGeneration = await publishLocalCompilerDependencyLocator(
        root,
        nodeModulesPath,
        null,
        null,
        current.binding,
        identity,
        current.sourceGeneration,
        lockedOptions
      );
      return createCompilerDepsReadyState({
        binding: current.binding,
        identity,
        kind: 'locator-published',
        nodeModulesPath,
        root,
        sourceGeneration: migratedGeneration,
        source: 'existing'
      });
    });
  }
  const ready = () => compilerDependencyGenerationBinding(
    root,
    nodeModulesPath,
    bindingPath,
    identity
  );

  return withCompilerDependencyTransitionLease(root, lifecycleOptions, async (lockedOptions) => {
    if (materializationSource.kind === 'retained-content'
        && (await observeDependencyTransitionSlot(nodeModulesPath)).kind !== 'absent') {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency content consumer appeared before materialization');
    }
    const lockedBridge = await compilerDependencyConsumerBridgeBinding(
      root,
      nodeModulesPath,
      identity,
      lockedOptions
    );
    if (lockedBridge !== null) {
      await bindExistingCompilerDependencyLocator(root, identity, lockedBridge, lockedOptions);
      const generationPath = path.resolve(await fs.realpath(nodeModulesPath));
      const generationOwnerRoot = canonicalCompilerDependencyGenerationOwnerRoot(generationPath) ??
        path.dirname(generationPath);
      return createCompilerDepsReadyState({
        binding: lockedBridge,
        identity,
        kind: 'none',
        nodeModulesPath,
        root,
        sourceGeneration: await runtimeDependencySourceGeneration({
          binding: lockedBridge,
          options: lockedOptions,
          ownerRoot: generationOwnerRoot,
          sourcePath: generationPath
        }),
        source: 'existing'
      });
    }
    await disposeCompilerDependencyLocator(
      root,
      lockedOptions,
      'incompatible-compiler-dependency-locator'
    );
    const lockedExisting = await ready();
    if (lockedExisting !== null) {
      const existingSourceGeneration = await runtimeDependencySourceGeneration({
        binding: lockedExisting,
        options: lockedOptions,
        ownerRoot: root,
        sourcePath: nodeModulesPath
      });
      if (lockedOptions.generatedStateLifecycle !== undefined) {
        await bindExistingCompilerDependencyGeneration(
          lockedOptions,
          existingSourceGeneration.physical
        );
      }
      const migratedGeneration = await publishLocalCompilerDependencyLocator(
        root,
        nodeModulesPath,
        null,
        null,
        lockedExisting,
        identity,
        existingSourceGeneration,
        lockedOptions
      );
      const readyState = createCompilerDepsReadyState({
        binding: lockedExisting,
        identity,
        kind: 'locator-published',
        nodeModulesPath,
        root,
        sourceGeneration: migratedGeneration,
        source: 'existing'
      });
      return readyState;
    }

    const sharedWorktreeGeneration = admittedSource === undefined
      ? materializationSource.kind === 'retained-content' ? null : await resolveLinkedWorktreeDependencyGeneration({
          consumerRoot: root,
          consumerIdentity: identity,
          options: lockedOptions
        })
      : Object.freeze({
          binding: admittedSource.binding,
          nodeModulesPath: admittedSource.sourceGeneration.sourcePath,
          sourceGeneration: admittedSource.sourceGeneration
        });
    if (sharedWorktreeGeneration !== null) {
      let createdLocator = false;
      let createdLocatorIdentity: Readonly<{
        source: GeneratedStatePhysicalIdentity;
        linkTarget: string;
      }> | null = null;
      let lifecycleBindingAttempted = false;
      let retiredPreimage: RetiredCompilerDependencyPreimage | null = null;
      const sourceGeneration = sharedWorktreeGeneration.sourceGeneration;
      const locatorBackupPath = path.join(
        (await ensureDependencyTransitionNamespace(root, lockedOptions)).backupRoot.path,
        `locator-preimage-${sourceGeneration.epoch.slice('sha256:'.length, 'sha256:'.length + 24)}`
      );
      let transition: DependencyTransitionJournal | null = null;
      try {
        const currentTarget = await observeDependencyTransitionSlot(nodeModulesPath);
        const preimageAuthority = currentTarget.kind === 'directory'
          ? await compilerDependencyGeneratedPreimageAuthority(
            root,
            nodeModulesPath,
            lockedOptions
          )
          : null;
        if (currentTarget.kind !== 'directory' && currentTarget.kind !== 'absent') {
          throw new CodedFailure('IMPORT-AUTHORITY-004', 'Foreign compiler dependency locator target is preserved');
        }
        transition = await beginDependencyTransition({
          kind: 'compiler-locator',
          ownerRoot: root,
          destinationPath: nodeModulesPath,
          stagePath: null,
          backupPath: locatorBackupPath,
          sourceGeneration,
          bindingDigest: generatedStateDigest(sharedWorktreeGeneration.binding),
          preimageBindingDigest: preimageAuthority?.authorityDigest ?? null,
          options: lockedOptions
        });
        if (transition.preimage.kind === 'directory') {
          retiredPreimage = await retireIncompatibleCompilerDependencyTarget(
            root,
            nodeModulesPath,
            lockedOptions,
            locatorBackupPath
          );
          transition = await advanceDependencyTransition(transition, {
            destination: transitionAbsentSlot(nodeModulesPath),
            backup: await observeDependencyTransitionSlot(locatorBackupPath),
            phase: 'backed-up',
            durability: 'known',
            failure: null
          }, lockedOptions);
        }
        // A retired predecessor registration is terminal only while the slot
        // is empty; settle it here so the publication below can take birth.
        await settleRetiredCompilerDependencyGeneration(lockedOptions, transition.preimage.physical ?? undefined);
        await createCompilerDependencyLocator(
          nodeModulesPath,
          sharedWorktreeGeneration.nodeModulesPath,
          sourceGeneration.physical,
          lockedOptions
        );
        createdLocator = true;
        createdLocatorIdentity = compilerDependencyLocatorObservation(root, 'node_modules');
        if (createdLocatorIdentity === null) {
          throw new CodedFailure('IMPORT-AUTHORITY-004', 'Published compiler dependency locator has no physical identity');
        }
        transition = await advanceDependencyTransition(transition, {
          destination: await observeDependencyTransitionSlot(nodeModulesPath),
          sourceGeneration,
          phase: 'published',
          durability: 'known',
          failure: null
        }, lockedOptions);
        const binding = await compilerDependencyConsumerBridgeBinding(
          root,
          nodeModulesPath,
          identity,
          lockedOptions
        );
        if (binding === null || !canonicalEquals(binding, sharedWorktreeGeneration.binding)) {
          throw new CodedFailure('IMPORT-AUTHORITY-004', 'Published compiler dependency locator failed exact readback');
        }
        lifecycleBindingAttempted = true;
        await publishCompilerDependencyLocatorLifecycle(root, identity, binding, lockedOptions);
        await advanceDependencyTransition(transition, {
          destination: await observeDependencyTransitionSlot(nodeModulesPath),
          backup: await observeDependencyTransitionSlot(locatorBackupPath),
          sourceGeneration,
          phase: 'complete',
          durability: 'known',
          failure: null
        }, lockedOptions);
        return createCompilerDepsReadyState({
          binding,
          identity,
          kind: 'locator-published',
          nodeModulesPath,
          root,
          sourceGeneration,
          source: 'existing'
        });
      } catch (error) {
        // Before lifecycle ownership starts, this process still owns the exact
        // locator publication and may CAS-unlink it. Once lifecycle binding is
        // attempted, preserve the locator: the next invocation can adopt the
        // exact active registration and finish retirement without orphaning a
        // durable registration or touching the external generation.
        const rollbackFailures: unknown[] = [];
        if (createdLocator && !lifecycleBindingAttempted && createdLocatorIdentity !== null) {
          try {
            await deleteExactCompilerDependencyLocator(root, createdLocatorIdentity, lockedOptions);
          } catch (rollbackError) {
            rollbackFailures.push(rollbackError);
          }
        }
        if (retiredPreimage !== null && !lifecycleBindingAttempted &&
          (await observeDependencyTransitionSlot(nodeModulesPath)).kind === 'absent') {
          try {
            await restoreRetiredCompilerDependencyTarget(
              nodeModulesPath,
              retiredPreimage,
              lockedOptions
            );
          } catch (rollbackError) {
            rollbackFailures.push(rollbackError);
          }
        }
        if (transition !== null) {
          if (rollbackFailures.length === 0 && !lifecycleBindingAttempted) {
            await advanceDependencyTransition(transition, {
              destination: await observeDependencyTransitionSlot(nodeModulesPath),
              backup: await observeDependencyTransitionSlot(locatorBackupPath),
              phase: 'rolled-back',
              durability: 'known',
              failure: transitionFailure(error)
            }, lockedOptions).catch((journalError) => { rollbackFailures.push(journalError); });
          } else if (lifecycleBindingAttempted || rollbackFailures.length > 0) {
            await markDependencyTransitionFailure(transition, error, lockedOptions).catch((journalError) => {
              rollbackFailures.push(journalError);
            });
          }
        }
        if (rollbackFailures.length > 0) {
          const rollbackFailure = rollbackFailures.length === 1
            ? rollbackFailures[0]
            : new AggregateError(
                rollbackFailures,
                'Compiler dependency locator rollback had multiple failures.'
              );
          throw new CodedFailure(
            'IMPORT-AUTHORITY-004',
            'Compiler dependency locator transition failed and exact rollback requires recovery',
            {
              cause: error instanceof Error ? error.message : String(error),
              causeDetails: error instanceof CodedFailure ? error.details : null,
              recoveryBackup: retiredPreimage?.backupPath ?? null,
              rollbackFailure: rollbackFailure instanceof Error
                ? rollbackFailure.message
                : String(rollbackFailure)
            }
          );
        }
        throw error;
      }
    }

    const staged = await stageCompilerDependencyGeneration(root, identity, lockedOptions, materializationSource);
    const stagedBinding = await compilerDependencyGenerationBinding(
      root,
      path.join(staged.stagingRoot, 'node_modules'),
      path.join(staged.stagingRoot, 'node_modules', COMPILER_DEPS_BINDING_FILE),
      identity
    );
    if (stagedBinding === null) {
      throw new CodedFailure('IMPORT-AUTHORITY-002', 'Staged compiler dependency generation has no valid binding');
    }
    const stagedGeneration = await runtimeDependencySourceGeneration({
      binding: stagedBinding,
      options: lockedOptions,
      ownerRoot: root,
      sourcePath: path.join(staged.stagingRoot, 'node_modules')
    });
    const publishedGeneration = await publishLocalCompilerDependencyLocator(
      root,
      nodeModulesPath,
      staged.stagingRoot,
      staged.stageIntent,
      stagedBinding,
      identity,
      stagedGeneration,
      lockedOptions
    );
    const published = await measureRuntimeDependencyOperationPhaseAsync(
      lockedOptions,
      'validation',
      () => observeCompilerDependencyReady(
        root,
        nodeModulesPath,
        identity,
        lockedOptions
      )
    );
    if (published?.kind !== 'external-bridge' || !canonicalEquals(published.binding, stagedBinding)) {
      throw new CodedFailure('IMPORT-AUTHORITY-002', 'Published compiler dependency generation failed validation');
    }

    const readyState = createCompilerDepsReadyState({
      binding: published.binding,
      identity,
      kind: 'generation-published',
      nodeModulesPath,
      root,
      sourceGeneration: publishedGeneration,
      source: materializationSource.kind === 'retained-content' ? 'existing' : 'installed'
    });
    return readyState;
  });
}

/** Trusted transport may lend one genuine retained content generation; only
 * this compiler owner may publish a newly qualified target runtime. */
export async function ensureCompilerDepsReadyFromRetainedContent(
  content: RetainedNoFollowProvenDirectoryGeneration,
  options: RuntimeDependencyInstallOptions,
  compilerDependencyRoot: string
): Promise<CompilerDepsReadyState> {
  assertRetainedNoFollowProvenDirectoryGeneration(content, 'Compiler dependency transported content');
  const operationOptions = runtimeDependencyOperationOptions(options);
  const root = path.resolve(compilerDependencyRoot);
  const targetRoot = inspectNoFollowDirectoryChain(root, 'Compiler dependency imported consumer').target;
  await assertCompilerDependencyRetainedContent(content, root, operationOptions);
  const identity = await observeCompilerDependencyIdentity(root, operationOptions);
  if ((await observeDependencyTransitionSlot(path.join(root, 'node_modules'))).kind !== 'absent') {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency content import requires an absent consumer locator');
  }
  const targetOptions = operationOptions.generatedStateLifecycle === undefined
    ? selectGeneratedStateLifecycle(operationOptions, root)
    : operationOptions;
  content.assertCurrent();
  await content.assertAuthorityCurrent();
  assertSameNoFollowDirectoryIdentity(targetRoot, 'Compiler dependency imported consumer before publication');
  assertCompilerDependencyInputsCurrent(root, identity);
  const ready = await ensureCompilerDepsReadyInternal(targetOptions, root, undefined, {
    kind: 'retained-content', generation: content
  });
  await assertCompilerDependencyRetainedContent(content, root, operationOptions);
  assertSameNoFollowDirectoryIdentity(targetRoot, 'Compiler dependency imported consumer after publication');
  assertCompilerDependencyInputsCurrent(root, identity);
  return ready;
}

/**
 * Keep an already-compatible target, otherwise reuse one explicitly admitted
 * live compiler generation through the existing locator transition. The source
 * is an exact fallback, not a request to replace a compatible target. It selects
 * no mutable project link and authorizes no install, recovery or sibling search.
 */
export async function ensureCompilerDepsReadyFromGeneration(
  authority: CompilerDependencyExecutionGenerationAuthority,
  options: RuntimeDependencyInstallOptions = {},
  compilerDependencyRoot = compilerRoot
): Promise<CompilerDepsReadyState> {
  assertCompilerDependencyExecutionGenerationAuthority(authority);
  const source = compilerDependencyExecutionGenerationAuthorities.get(authority)!;
  const operationOptions = runtimeDependencyOperationOptions(options);
  const root = path.resolve(compilerDependencyRoot);
  const identity = await observeCompilerDependencyIdentity(root, operationOptions);
  if (!canonicalEquals(identity, source.identity)) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Explicit compiler dependency source has incompatible canonical inputs');
  }
  const current = await observeCompilerDependencyExecutionGenerationAuthority(operationOptions, source.root);
  const currentSource = current === null ? null : compilerDependencyExecutionGenerationAuthorities.get(current)!;
  if (currentSource === null || !canonicalEquals(currentSource.identity, source.identity) ||
      !canonicalEquals(currentSource.binding, source.binding) ||
      !canonicalEquals(currentSource.sourceGeneration, source.sourceGeneration)) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Explicit compiler dependency source authority is no longer current');
  }
  const context = runtimeDependencyOperationContext(operationOptions);
  const retained = await retainCompilerDependencyReadGeneration(authority, {
    deadlineAtUnixMs: context.deadlineAtUnixMs,
    signal: context.signal
  });
  let ready: CompilerDepsReadyState | undefined;
  let primary: RuntimeDependencyCapturedFailure | undefined;
  try {
    await retained.assertAuthorityCurrent();
    // The fresh observation owns transition-capable source provenance; the
    // caller authority can contain a serialized publication projection.
    ready = await ensureCompilerDepsReadyInternal(operationOptions, root, currentSource);
    await retained.assertAuthorityCurrent();
    await assertCompilerDependencyReadTransitionTerminal(source.sourceGeneration.ownerRoot, operationOptions);
    if (!sameHostPath(source.root, source.sourceGeneration.ownerRoot)) {
      await assertCompilerDependencyReadTransitionTerminal(source.root, operationOptions);
    }
    assertCompilerDependencyInputsCurrent(root, identity);
  } catch (error) {
    primary = Object.freeze({ error });
  }
  let retirementFailure: RuntimeDependencyCapturedFailure | undefined;
  try {
    const receipt = await retained.retire();
    assertCompilerDependencyReadGenerationRetirementReceipt(receipt, authority.generationDigest);
  } catch (error) {
    retirementFailure = Object.freeze({ error });
  }
  if (primary !== undefined && retirementFailure !== undefined) {
    throw new AggregateError([primary.error, retirementFailure.error],
      'Compiler dependency source reuse and retained-consumer settlement both failed');
  }
  if (primary !== undefined) throw primary.error;
  if (retirementFailure !== undefined) throw retirementFailure.error;
  return ready!;
}

function compilerDependencyReadyInFlightKey(
  options: RuntimeDependencyInstallOptions,
  root: string
): string | null {
  // Hooks, fences, lifecycle sessions and retry seams carry caller-local
  // effects; joining those calls would silently drop an owner's observation.
  if (options.beforeCommit !== undefined || options.generatedStateLifecycle !== undefined || options.generatedStateLifecycleFactory !== undefined ||
      options.signal !== undefined || options.monotonicNowMs !== undefined || options.now !== undefined ||
      options.sleep !== undefined || options.testMaterialization !== undefined ||
      options.testCompilerPublishHook !== undefined || options.testCompilerBridgeValidationHook !== undefined ||
      options.testCompilerRename !== undefined) return null;
  return JSON.stringify([
    path.resolve(root),
    options.installMode ?? 'allow',
    options.lockTimeoutMs ?? null,
    options.pollIntervalMs ?? null,
    options.testCompilerPublishPlatform ?? null
  ]);
}

const compilerDependencyReadyInFlight = new Map<string, Promise<CompilerDepsReadyState>>();

export async function ensureCompilerDepsReady(
  options: RuntimeDependencyInstallOptions = {},
  compilerDependencyRoot = compilerRoot
): Promise<CompilerDepsReadyState> {
  options = runtimeDependencyOperationOptions(options);
  const key = compilerDependencyReadyInFlightKey(options, compilerDependencyRoot);
  if (key === null) return ensureCompilerDepsReadyInternal(options, compilerDependencyRoot);
  const existing = compilerDependencyReadyInFlight.get(key);
  if (existing !== undefined) return existing;
  const pending = ensureCompilerDepsReadyInternal(options, compilerDependencyRoot);
  compilerDependencyReadyInFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (compilerDependencyReadyInFlight.get(key) === pending) {
      compilerDependencyReadyInFlight.delete(key);
    }
  }
}
export interface PreparedProjectDependencySource {
  readonly binding: Readonly<RuntimeDependencyMaterializationBinding>;
  readonly sourceGeneration: RuntimeDependencySourceGeneration;
  readonly sourceNodeModulesPath: string;
  readonly compilerDependencyRoot: string;
}
export async function readProjectDependencyRuntimeSpec() { return loadRuntimeDependencySpec(); }
export function observeProjectCanonicalDependencyPaths() {
  const root = path.resolve(compilerRoot);
  return Object.freeze({ compilerDependencyRoot: root, compilerNodeModulesPath: dependencyAuthorityPaths(root).compilerModulesRoot });
}
export async function observeProjectCompilerDependencySource(options: RuntimeDependencyInstallOptions) {
  const paths = observeProjectCanonicalDependencyPaths();
  const operationOptions = runtimeDependencyOperationOptions(options);
  const ready = await observeCompilerDependencyReady(paths.compilerDependencyRoot, paths.compilerNodeModulesPath,
    await compilerDependencyIdentity(paths.compilerDependencyRoot), operationOptions);
  if (ready === null || ready.kind === 'incompatible-bridge') return null;
  const sourceGeneration = ready.sourceGeneration ?? await runtimeDependencySourceGeneration({
    binding: ready.binding, options: operationOptions, ownerRoot: paths.compilerDependencyRoot, sourcePath: paths.compilerNodeModulesPath });
  return Object.freeze({ ...ready, sourceGeneration });
}
export function readProjectDependencySourceGeneration(binding: Readonly<RuntimeDependencyMaterializationBinding>, ownerRoot:string, sourcePath:string, options:RuntimeDependencyInstallOptions) {
  return runtimeDependencySourceGeneration({ binding, ownerRoot, sourcePath, options });
}
export async function verifyIsolatedProjectDependencySource(binding: Readonly<RuntimeDependencyMaterializationBinding>, sourcePath:string) {
  return runtimeDependencyTreeMatchesBinding({ expected:binding,nodeModulesPath:sourcePath,root:path.resolve(compilerRoot),runtimeSpec:await loadRuntimeDependencySpec() });
}

export async function ensureProjectDependencies(
  projectRoot: string,
  options: RuntimeDependencyInstallOptions = {},
  preparedSource?: PreparedProjectDependencySource
): Promise<void> {
  let operationOptions = runtimeDependencyOperationOptions(options);
  const runtimeSpec = await loadRuntimeDependencySpec();
  const projectRootPath = path.resolve(projectRoot);
  const nodeModulesPath = path.join(projectRootPath, 'node_modules');
  if (operationOptions.installMode === 'prebound-only') {
    await runtimeDependencyOperationEffectFence(operationOptions, 'Prebound dependency read admission');
    const [binding, installed] = await Promise.all([
      readJson<unknown>(path.join(nodeModulesPath, RUNTIME_DEPS_PREBOUND_BINDING_FILE))
        .catch(() => null),
      hasCompleteRuntimeDeps(nodeModulesPath, runtimeSpec)
    ]);
    await runtimeDependencyOperationEffectFence(operationOptions, 'Prebound dependency readback');
    if (!installed || !isRuntimeDepsPreboundBinding(binding, runtimeSpec.manifestHash)) {
      throw new CodedFailure(
        'RUNTIME-DEPS-004',
        'Plan-bound dependency tree is unavailable for isolated verification'
      );
    }
    return;
  }
  const isolated = operationOptions.installMode === 'offline-copy-only';
  const compilerDependencyRoot = path.resolve(compilerRoot);
  operationOptions = selectGeneratedStateLifecycle(operationOptions, projectRootPath);
  if (preparedSource === undefined || path.resolve(preparedSource.compilerDependencyRoot) !== compilerDependencyRoot ||
      preparedSource.binding.manifestHash !== runtimeSpec.manifestHash ||
      preparedSource.sourceNodeModulesPath !== preparedSource.sourceGeneration.sourcePath) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Project dependency source preparation is missing, foreign, or malformed');
  }
  const { binding, sourceGeneration, sourceNodeModulesPath } = preparedSource;
  assertRuntimeDependencySourceGenerationIssued(sourceGeneration);
  const currentSource = await observeProjectCompilerDependencySource(operationOptions);
  if (currentSource === null ||
      !canonicalEquals(currentSource.binding.runtimeMaterialization, binding) ||
      currentSource.sourceGeneration.ownerRoot !== sourceGeneration.ownerRoot ||
      currentSource.sourceGeneration.sourcePath !== sourceGeneration.sourcePath) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Project dependency prepared source is outside the canonical owner');
  }
  if (isolated && !await runtimeDependencyTreeMatchesBinding({ expected: binding, nodeModulesPath: sourceNodeModulesPath,
      root: compilerDependencyRoot, runtimeSpec })) throw new CodedFailure('RUNTIME-DEPS-004', 'Canonical compiler runtime materialization is unavailable for isolated verification');

  const projectTransitionInput: ProjectProjectionTransitionInput = Object.freeze({
    binding,
    compilerDependencyRoot,
    isolated,
    nodeModulesPath,
    options: operationOptions,
    projectRootPath,
    runtimeSpec,
    sourceGeneration,
    sourceNodeModulesPath,
    stampPath: projectStampPath(projectRootPath)
  });
  const stampPath = projectStampPath(projectRootPath);
  await withCompilerDependencyTransitionLease(
    compilerDependencyRoot,
    operationOptions,
    async (lockedOptions) => {
      await withProjectDependencyBridgeLease(
        projectRootPath,
        lockedOptions,
        async (projectLockedOptions) => {
          const lockedTransitionInput: ProjectProjectionTransitionInput = Object.freeze({
            ...projectTransitionInput,
            options: projectLockedOptions
          });
          await recoverProjectDependencyTransition(lockedTransitionInput);
          await runtimeDependencyOperationEffectFence(projectLockedOptions, 'Project dependency cache admission');
          const currentStamp = await readRuntimeDepsStamp(stampPath);
          const currentTarget = await runtimeDependencyTargetIdentity(nodeModulesPath);
          let sourceStillCurrent: boolean;
          try {
            const current = await runtimeDependencySourceGeneration({
              binding,
              options: projectLockedOptions,
              ownerRoot: sourceGeneration.ownerRoot,
              sourcePath: sourceGeneration.sourcePath
            });
            sourceStillCurrent = current.epoch === sourceGeneration.epoch &&
              sameRuntimeDependencySourceGenerationContent(current, sourceGeneration) &&
              sameGeneratedStateIdentity(current.physical, sourceGeneration.physical);
          } catch (error) {
            if (!isFileNotFoundError(error)) throw error;
            sourceStillCurrent = false;
          }
          const cacheReady = !projectLockedOptions.rematerialize &&
            sourceStillCurrent &&
            currentStamp?.binding.revision === binding.revision &&
            canonicalEquals(currentStamp.binding, binding) &&
            currentStamp.sourceGeneration.epoch === sourceGeneration.epoch &&
            sameRuntimeDependencySourceGenerationContent(currentStamp.sourceGeneration, sourceGeneration) &&
            sameGeneratedStateIdentity(currentStamp.sourceGeneration.physical, sourceGeneration.physical) &&
            currentTarget !== null &&
            currentTarget.kind === currentStamp.target.kind &&
            currentTarget.linkTarget === currentStamp.target.linkTarget &&
            sameGeneratedStateIdentity(currentTarget.physical, currentStamp.target.physical) &&
            (isolated
              ? await runtimeDependencyTreeMatchesBinding({
                expected: binding,
                nodeModulesPath,
                root: compilerDependencyRoot,
                runtimeSpec
              })
              : await dependencyBridgeTargets(nodeModulesPath, sourceNodeModulesPath));
          await runtimeDependencyOperationEffectFence(projectLockedOptions, 'Project dependency ready-state settlement');
          if (cacheReady) return;
          await publishProjectDependencyProjection(lockedTransitionInput);
        }
      );
    }
  );
}
