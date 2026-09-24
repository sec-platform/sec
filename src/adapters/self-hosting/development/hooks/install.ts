import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { chmod, lstat } from 'node:fs/promises';
import path from 'node:path';

import { canonicalJson, sha256 } from '../../../../contracts/canonical.ts';
import { withAcquiredResource } from '../../../../execution/resource-settlement.ts';
import { issueOperationRequirementBindingContext } from '../../../../execution/operation/requirement-binding-context.ts';
import {
  bindSecSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation,
  type OperationDigest
} from '../../../../execution/operation/semantic.ts';
import { withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import { GIT_READ_DEFAULT_OPERATION_BUDGET, isolatedGitReadEnvironment, isProductionGitReadSession, type GitReadProviderResolutionFailure, type GitReadSession, type GitReadSessionResolution } from '../../../providers/git-read/runtime/session.ts';
import {
  assertGitConfigEffectReceipt,
  closeGitConfigTargetCapability,
  issueGitConfigTargetCapability,
  replaceAllGitConfigValue
} from '../../../providers/git/config-effect.ts';
import {
  assertGitPhysicalProviderReceipt,
  closeGitPhysicalProvider,
  openGitPhysicalProvider,
  type GitPhysicalProviderCapability
} from '../../../providers/git/physical-provider.ts';
import { acquirePhysicalMutationLease, type PhysicalMutationLeaseHandle, type PhysicalMutationLeaseOwner } from '../../../runtime-state/physical/runtime/mutation-lease.ts';
import { createExclusiveNoFollowDirectory, deleteRetainedNoFollowEntry, inspectExactNoFollowDirectoryPresence, inspectNoFollowDirectoryChain, inspectNoFollowOrdinaryFileEntry, PhysicalNoFollowError, publishExclusiveDurableCanonicalFile, replaceDurableCanonicalFile, scanNoFollowDirectoryTree, scanNoFollowDirectoryTreeMetadata, type PhysicalDirectoryChain, type PhysicalDirectoryIdentity } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertProcessResourceSessionReceipt,
  openProcessResourceSession,
  type ProcessResourceSession
} from '../../../runtime-state/physical/runtime/process-resource-session.ts';

const MANAGED_HOOKS_PATH = '.githooks';
const MANAGED_COMMON_DIRECTORY = 'sec-managed-hooks-v3';
const MANAGED_HOOK_BUN_INVOCATION = /^(exec )?bun(?= )/gmu;
const MANAGED_PRE_COMMIT = MANAGED_HOOKS_PATH + '/pre-commit';
const MANAGED_HOOKS = [
  MANAGED_PRE_COMMIT,
  MANAGED_HOOKS_PATH + '/pre-push',
  MANAGED_HOOKS_PATH + '/post-checkout',
  MANAGED_HOOKS_PATH + '/post-merge',
  MANAGED_HOOKS_PATH + '/post-rewrite'
] as const;
const MANAGED_GENERATION_NAMES = MANAGED_HOOKS.map((hook) => path.basename(hook));
const MARKER_FILE_NAME = '.last-install';
const LEASE_FILE_PREFIX = 'lease-';
const CONFIG_TRANSITION_DIRECTORY_PREFIX = 'config-transition-';
const CONFIG_TRANSITION_PREPARED_FILE = 'prepared';
const CONFIG_TRANSITION_INTENT_FILE = 'intent';
const CONFIG_TRANSITION_COMPLETE_FILE = 'complete';
const CONFIG_TRANSITION_STEP_PREFIX = 'step-';
const CONFIG_TRANSITION_RETIRE_INTENT_PREFIX = 'retire-';
const CONFIG_TRANSITION_RETIRED_PREFIX = 'retired-';
const MANAGED_GENERATION_NAME = /^generation-[0-9a-f]{64}(?:-[0-9a-f-]{36})?$/u;
const MAX_MANAGED_GENERATIONS = 8;

const DEFAULT_GIT_INVOCATION_BUDGET = Object.freeze({
  deadlineMs: 30_000,
  maxProcesses: 128,
  maxStdoutBytes: 8 * 1024 * 1024,
  maxStderrBytes: 512 * 1024,
  maxRecords: 32_768,
  maxCommandStdoutBytes: 2 * 1024 * 1024,
  maxCommandStderrBytes: 128 * 1024
});
const INSTALL_REQUIREMENT = 'development.hooks.process';
const INSTALL_CONTRACT = sha256({
  owner: 'development.hooks',
  operation: 'install',
  processBoundary: 'one-process-resource-session'
}) as OperationDigest;
const PROCESS_PROVIDER = sha256({
  owner: 'runtime-state.physical',
  provider: 'process-resource-session'
}) as OperationDigest;

function compileInstallOperation(input: Readonly<{
  repoRoot: string;
  lifecycle: boolean;
  deadlineAtUnixMs: number;
}>): BoundSemanticOperation {
  const plan = compileSemanticOperationPlan({
    operation: 'development.hooks.install',
    intentDigest: sha256({ repoRoot: input.repoRoot, lifecycle: input.lifecycle }) as OperationDigest,
    decisionDigest: INSTALL_CONTRACT,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: INSTALL_CONTRACT
    }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: DEFAULT_GIT_INVOCATION_BUDGET.deadlineMs },
      { resource: 'input-bytes', maximum: 1 },
      { resource: 'output-bytes', maximum: DEFAULT_GIT_INVOCATION_BUDGET.maxStdoutBytes
        + DEFAULT_GIT_INVOCATION_BUDGET.maxStderrBytes },
      { resource: 'processes', maximum: DEFAULT_GIT_INVOCATION_BUDGET.maxProcesses }
    ],
    requirements: [{
      id: INSTALL_REQUIREMENT,
      contractDigest: INSTALL_CONTRACT,
      effectKinds: ['filesystem', 'process', 'provider'],
      failureKinds: [
        'filesystem.identity-drift',
        'filesystem.write-failed',
        'process.cancelled',
        'process.deadline-exhausted',
        'process.output-budget-exhausted',
        'process.settlement-unproven',
        'process.unavailable'
      ]
    }]
  });
  return bindSecSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: INSTALL_REQUIREMENT,
    contractDigest: INSTALL_CONTRACT,
    providerIdentityDigest: PROCESS_PROVIDER
  })]);
}

interface GitInvocationBudgetOptions {
  readonly deadlineMs?: number;
  readonly maxProcesses?: number;
  readonly maxStdoutBytes?: number;
  readonly maxStderrBytes?: number;
  readonly maxRecords?: number;
  readonly maxCommandStdoutBytes?: number;
  readonly maxCommandStderrBytes?: number;
}

type GitSpawnKind = 'git-read' | 'git-config';

type GitProviderAdmission = Readonly<{
  readonly route: GitReadProviderResolutionFailure['route'];
  readonly status: GitReadProviderResolutionFailure['status'];
  readonly reason: GitReadProviderResolutionFailure['reason'];
  readonly detailDigest: `sha256:${string}`;
}>;

function environmentProjectionKey(environment: Readonly<Record<string, string>>): string {
  return JSON.stringify(canonicalJson(environment));
}

class GitInvocationBudget {
  readonly deadlineAt: number;
  readonly maxProcesses: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly maxRecords: number;
  readonly maxCommandStdoutBytes: number;
  readonly maxCommandStderrBytes: number;
  readonly environment: Readonly<Record<string, string>>;
  private processCount = 0;
  private stdoutBytes = 0;
  private stderrBytes = 0;
  private recordCount = 0;
  private readonly providerEnvironmentKey: string;
  private providerSession: GitReadSession | null = null;
  private readonly providerResolutionOverride: GitReadSessionResolution | undefined;
  private readonly testOnlyBeforeSpawn: ((kind: GitSpawnKind) => void) | undefined;

  constructor(
    options: GitInvocationBudgetOptions = {},
    providerResolutionOverride?: GitReadSessionResolution,
    testOnlyBeforeSpawn?: (kind: GitSpawnKind) => void
  ) {
    const values = { ...DEFAULT_GIT_INVOCATION_BUDGET, ...options };
    for (const [label, value] of Object.entries(values)) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error('Git installer ' + label + ' budget must be a positive safe integer');
      }
    }
    this.deadlineAt = Date.now() + values.deadlineMs;
    this.maxProcesses = values.maxProcesses;
    this.maxStdoutBytes = values.maxStdoutBytes;
    this.maxStderrBytes = values.maxStderrBytes;
    this.maxRecords = values.maxRecords;
    this.maxCommandStdoutBytes = values.maxCommandStdoutBytes;
    this.maxCommandStderrBytes = values.maxCommandStderrBytes;
    this.environment = Object.freeze(isolatedGitReadEnvironment());
    this.providerEnvironmentKey = environmentProjectionKey(this.environment);
    this.providerResolutionOverride = providerResolutionOverride;
    this.testOnlyBeforeSpawn = testOnlyBeforeSpawn;
  }

  beforeProcess(label: string): number {
    const remaining = this.deadlineAt - Date.now();
    this.assertWithin(label + ' start');
    if (this.processCount >= this.maxProcesses) {
      throw new GitHookTransitionConflict(
        'Git installer invocation budget exhausted before ' + label + ' (process count)'
      );
    }
    this.processCount += 1;
    return remaining;
  }

  assertWithin(label: string): void {
    if (Date.now() >= this.deadlineAt) {
      throw new GitHookTransitionConflict(
        'Git installer invocation budget exhausted at ' + label + ' (deadline)'
      );
    }
  }

  private assertEnvironmentCurrent(label: string): void {
    this.assertWithin(label + ' environment start');
    const current = isolatedGitReadEnvironment();
    if (environmentProjectionKey(current) !== this.providerEnvironmentKey) {
      throw new GitHookTransitionConflict(label + ' canonical Git environment changed');
    }
    this.assertWithin(label + ' environment completion');
  }

  private bindGitExecutable(): GitReadSession {
    this.assertEnvironmentCurrent('Git executable binding');
    if (this.providerSession !== null) return this.providerSession;
    this.assertWithin('Git executable resolution start');
    const resolution = this.providerResolutionOverride;
    if (resolution === undefined) {
      throw new GitHookTransitionConflict(
        'Git installer production provider must be issued by the GitRead authority owner'
      );
    }
    if (resolution.status !== 'ready') {
      throw providerAdmissionConflict(resolution);
    }
    const session = resolution.session;
    if (session.failure !== null || session.gitExecutableIdentity === null) {
      throw new GitHookTransitionConflict(
        'Canonical host Git provider identity could not be resolved within the installer invocation'
      );
    }
    if (environmentProjectionKey(session.env) !== this.providerEnvironmentKey) {
      throw new GitHookTransitionConflict('Canonical Git provider environment projection changed during binding');
    }
    const identity = session.gitExecutableIdentity;
    if (!path.isAbsolute(identity.realPath) || identity.path.length === 0) {
      throw new GitHookTransitionConflict('Canonical host Git provider returned a non-absolute executable identity');
    }
    this.assertWithin('Git executable resolution completion');
    this.providerSession = session;
    return session;
  }

  assertGitExecutableCurrent(label: string, options: { readonly verifyExecutable?: boolean } = {}): void {
    this.assertWithin(label + ' executable start');
    this.assertEnvironmentCurrent(label);
    const session = this.bindGitExecutable();
    if (options.verifyExecutable !== false && !session.verifyExecutable()) {
      throw new GitHookTransitionConflict(
        label + ' canonical Git executable identity changed'
          + (session.failure === null ? '' : ': ' + session.failure.detail)
      );
    }
    this.assertWithin(label + ' executable completion');
  }

  hostGitExecutionTarget(): string {
    const session = this.bindGitExecutable();
    if (
      session.providerRoute !== 'host-local-git-v1'
      || session.providerIdentity?.route !== 'host-local-git-v1'
      || session.gitExecutableIdentity === null
    ) {
      throw new GitHookTransitionConflict('Canonical Git provider executable identity is unavailable');
    }
    return path.resolve(session.gitExecutableIdentity.realPath);
  }

  borrowedReadSessionFor(repoRoot: string): GitReadSession | null {
    const session = this.bindGitExecutable();
    return canonicalPath(session.cwd) === canonicalPath(path.resolve(repoRoot)) ? session : null;
  }

  nestedReadBudget(label: string) {
    const remaining = this.deadlineAt - Date.now();
    this.assertWithin(label + ' nested session budget');
    return Object.freeze({
      ...GIT_READ_DEFAULT_OPERATION_BUDGET,
      deadlineMs: Math.min(GIT_READ_DEFAULT_OPERATION_BUDGET.deadlineMs, remaining),
      maxProcesses: 1,
      maxStdoutBytes: Math.min(this.maxCommandStdoutBytes, GIT_READ_DEFAULT_OPERATION_BUDGET.maxStdoutBytes),
      maxStderrBytes: Math.min(this.maxCommandStderrBytes, GIT_READ_DEFAULT_OPERATION_BUDGET.maxStderrBytes),
      maxRecords: Math.min(this.maxRecords, GIT_READ_DEFAULT_OPERATION_BUDGET.maxRecords),
      maxCommandStdoutBytes: Math.min(
        this.maxCommandStdoutBytes,
        GIT_READ_DEFAULT_OPERATION_BUDGET.maxCommandStdoutBytes
      ),
      maxCommandStderrBytes: Math.min(
        this.maxCommandStderrBytes,
        GIT_READ_DEFAULT_OPERATION_BUDGET.maxCommandStderrBytes
      )
    });
  }

  beforeSpawn(kind: GitSpawnKind): void {
    this.testOnlyBeforeSpawn?.(kind);
  }

  assertGitExecutableIfBound(label: string): void {
    if (this.providerSession !== null) this.assertGitExecutableCurrent(label);
  }

  releaseBorrowedSession(): void {
    const session = this.providerSession;
    this.providerSession = null;
    if (session === null) return;
    if (session.failure !== null) {
      throw new GitHookTransitionConflict(
        'Git installer borrowed provider failed before release: ' + session.failure.detail
      );
    }
  }

  afterProcess(
    stdout: string,
    stderr: string,
    label: string
  ): void {
    this.assertWithin(label + ' completion');
    const stdoutBytes = Buffer.byteLength(stdout, 'utf8');
    const stderrBytes = Buffer.byteLength(stderr, 'utf8');
    if (stdoutBytes > this.maxCommandStdoutBytes) {
      throw new GitHookTransitionConflict(
        'Git installer command output budget exhausted at ' + label + ' (stdout)'
      );
    }
    if (stderrBytes > this.maxCommandStderrBytes) {
      throw new GitHookTransitionConflict(
        'Git installer command output budget exhausted at ' + label + ' (stderr)'
      );
    }
    this.stdoutBytes += stdoutBytes;
    this.stderrBytes += stderrBytes;
    if (this.stdoutBytes > this.maxStdoutBytes || this.stderrBytes > this.maxStderrBytes) {
      throw new GitHookTransitionConflict(
        'Git installer invocation output budget exhausted at ' + label
      );
    }
    let records = 1;
    for (let index = 0; index < stdout.length; index += 1) {
      if (stdout.charCodeAt(index) === 0 || stdout.charCodeAt(index) === 10) records += 1;
    }
    this.recordCount += records;
    if (this.recordCount > this.maxRecords) {
      throw new GitHookTransitionConflict(
        'Git installer invocation record budget exhausted at ' + label
      );
    }
    this.assertWithin(label + ' budget accounting');
  }
}

const gitInvocationBudgetStorage = new AsyncLocalStorage<GitInvocationBudget>();

function currentGitInvocationBudget(): GitInvocationBudget {
  const budget = gitInvocationBudgetStorage.getStore();
  if (budget === undefined) {
    throw new GitHookTransitionConflict('Git installer Git access requires an active invocation budget');
  }
  return budget;
}

async function withGitInvocationBudget<T>(
  operation: () => T | Promise<T>,
  options: GitInvocationBudgetOptions = {},
  providerResolutionOverride?: GitReadSessionResolution,
  testOnlyBeforeSpawn?: (kind: GitSpawnKind) => void
): Promise<T> {
  const existing = gitInvocationBudgetStorage.getStore();
  if (existing !== undefined) return await operation();
  const budget = new GitInvocationBudget(
    options,
    providerResolutionOverride,
    testOnlyBeforeSpawn
  );
  return await gitInvocationBudgetStorage.run(budget, async () => {
    let result: T | undefined;
    let primaryFailure: Readonly<{ error: unknown }> | undefined;
    let releaseFailure: Readonly<{ error: unknown }> | undefined;
    try {
      result = await operation();
      budget.assertGitExecutableIfBound('installer invocation completion');
      budget.assertWithin('installer invocation completion');
    } catch (error) {
      primaryFailure = Object.freeze({ error });
    }
    try {
      budget.releaseBorrowedSession();
    } catch (error) {
      releaseFailure = Object.freeze({ error });
    }
    if (primaryFailure !== undefined && releaseFailure !== undefined) {
      throw new AggregateError(
        [primaryFailure.error, releaseFailure.error],
        'Git hook installer operation and borrowed-session release both failed.'
      );
    }
    if (primaryFailure !== undefined) throw primaryFailure.error;
    if (releaseFailure !== undefined) throw releaseFailure.error;
    return result as T;
  });
}

export interface GitHookInstallationResult {
  readonly status: 'installed' | 'managed' | 'conflict';
  readonly message: string;
}

export interface ManagedGitHookReadinessObservation {
  readonly disposition: 'ready' | 'materialization-required';
  readonly observationDigest: `sha256:${string}`;
}

interface ManagedHookSnapshot {
  readonly deployedBytes: Buffer;
  readonly name: string;
  readonly sourceBytes: Buffer;
}

interface HookMarkerRecord {
  readonly digest: string;
  readonly fingerprint: string;
  readonly generationName: string;
}

interface HookConfigState {
  readonly worktreeConfig: string | null;
  readonly commonHooksPath: string | null;
  readonly worktreeHooksPath: string | null;
}

interface PhysicalFileObservation {
  readonly state: 'absent' | 'present';
  readonly device: string | null;
  readonly inode: string | null;
  readonly size: number | null;
  readonly byteDigest: string | null;
}

interface ConfigPhysicalBoundary {
  readonly repoRoot: PhysicalDirectoryChain;
  readonly commonGitDir: PhysicalDirectoryChain;
  readonly worktreeGitDir: PhysicalDirectoryChain;
  readonly commonConfigParent: PhysicalDirectoryChain;
  readonly worktreeConfigParent: PhysicalDirectoryChain;
  readonly commonConfig: PhysicalFileObservation;
  readonly worktreeConfig: PhysicalFileObservation;
}

interface ConfigFileLockRecord {
  readonly schema: 'sec-managed-hook-config-lock-v1';
  readonly operationDigest: string;
  readonly stepIndex: number;
  readonly scope: 'local' | 'worktree';
  readonly configPath: string;
  readonly configParentKey: string;
  readonly configName: string;
  readonly stageName: string;
  readonly preimage: PhysicalFileObservation;
  readonly owner: PhysicalMutationLeaseOwner;
}

interface ConfigFileLockHandle {
  readonly parent: PhysicalDirectoryChain;
  readonly name: string;
  readonly record: ConfigFileLockRecord;
  readonly bytes: Buffer;
  release(): void;
}

interface ConfigObservation {
  readonly state: HookConfigState;
  readonly boundary: ConfigPhysicalBoundary;
}

interface ConfigTransitionStep {
  readonly index: number;
  readonly scope: 'local' | 'worktree';
  readonly key: keyof HookConfigState;
  readonly configKey: string;
  readonly value: string;
  readonly before: HookConfigState;
  readonly after: HookConfigState;
}

interface GenerationPhysicalFile {
  readonly name: string;
  readonly device: string;
  readonly inode: string;
  readonly size: number;
  readonly byteDigest: string;
}

interface GenerationPhysicalEvidence {
  readonly path: string;
  readonly chain: PhysicalDirectoryChain;
  readonly files: readonly GenerationPhysicalFile[];
}

interface ConfigTransitionIntent {
  readonly schema: 'sec-managed-hook-config-transition-v1';
  readonly operationDigest: string;
  readonly commonRoot: string;
  readonly commonRootKey: string;
  readonly repoRoot: string;
  readonly commonGitDir: string;
  readonly worktreeGitDir: string;
  readonly worktreeConfigPath: string;
  readonly preimage: HookConfigState;
  readonly target: HookConfigState;
  readonly initialBoundary: ConfigPhysicalBoundary;
  readonly markerRoot: PhysicalDirectoryChain;
  readonly bootstrapMarkerRoot: PhysicalDirectoryChain;
  readonly marker: HookMarkerRecord;
  readonly bootstrapMarker: HookMarkerRecord;
  readonly generation: GenerationPhysicalEvidence;
  readonly bootstrapGeneration: GenerationPhysicalEvidence;
  readonly priorGenerations: readonly PriorGenerationEvidence[];
  readonly steps: readonly ConfigTransitionStep[];
}

/**
 * Durable admission record written before a generation directory is created.
 * It intentionally carries no generation chain or file identity: those
 * physical facts do not exist yet.  The planned path/digest/source bytes are
 * nevertheless immutable, so a restart may adopt only the exact publication
 * it authorized and may never infer ownership from a generation name.
 */
interface ConfigTransitionGenerationPlan {
  readonly path: string;
  readonly digest: string;
  readonly fingerprint: string;
  readonly files: readonly Readonly<{
    readonly name: string;
    readonly size: number;
    readonly byteDigest: string;
  }>[];
}

interface ConfigTransitionPreparedIntent {
  readonly schema: 'sec-managed-hook-config-prepared-v1';
  readonly operationDigest: string;
  readonly commonRoot: string;
  readonly commonRootKey: string;
  readonly repoRoot: string;
  readonly commonGitDir: string;
  readonly worktreeGitDir: string;
  readonly worktreeConfigPath: string;
  readonly preimage: HookConfigState;
  readonly target: HookConfigState;
  readonly initialBoundary: ConfigPhysicalBoundary;
  readonly markerRoot: PhysicalDirectoryChain;
  readonly bootstrapMarkerRoot: PhysicalDirectoryChain;
  readonly marker: HookMarkerRecord;
  readonly bootstrapMarker: HookMarkerRecord;
  readonly generation: ConfigTransitionGenerationPlan;
  readonly bootstrapGeneration: ConfigTransitionGenerationPlan;
  readonly priorGenerations: readonly PriorGenerationEvidence[];
}

interface PriorGenerationEvidence {
  readonly digest: string;
  readonly evidence: GenerationPhysicalEvidence;
}

interface ConfigTransitionRetireIntent {
  readonly schema: 'sec-managed-hook-config-retire-intent-v1';
  readonly operationDigest: string;
  readonly index: number;
  readonly digest: string;
  readonly path: string;
}

interface ConfigTransitionRetiredReceipt {
  readonly schema: 'sec-managed-hook-config-retired-v1';
  readonly operationDigest: string;
  readonly index: number;
  readonly digest: string;
  readonly path: string;
}

interface ConfigTransitionReceipt {
  readonly schema: 'sec-managed-hook-config-step-v1';
  readonly operationDigest: string;
  readonly index: number;
  readonly after: HookConfigState;
  readonly boundary: ConfigPhysicalBoundary;
}

interface ConfigTransitionCompleteReceipt {
  readonly schema: 'sec-managed-hook-config-complete-v1';
  readonly operationDigest: string;
  readonly target: HookConfigState;
  readonly boundary: ConfigPhysicalBoundary;
}

interface ConfigTransitionHandle {
  readonly chain: PhysicalDirectoryChain;
  readonly intent: ConfigTransitionIntent;
  readonly name: string;
}

interface PrimaryBootstrapAuthority {
  readonly mode: 'local-tracking-lineage' | 'test-no-remote-fixture';
  readonly branch: 'main';
  readonly originUrl: string | null;
  readonly originHeadRef: string | null;
  readonly localHeadSha: string;
  readonly originHeadSha: string | null;
}

interface SourceContext {
  readonly binding: string;
  readonly commonChain: PhysicalDirectoryChain;
  readonly digest: string;
  readonly fingerprint: string;
  readonly repoRoot: string;
  readonly rootChain: PhysicalDirectoryChain;
  readonly snapshots: readonly ManagedHookSnapshot[];
  readonly bootstrapAuthority: PrimaryBootstrapAuthority | null;
  readonly requireHeadTree: boolean;
}

interface ManagedGenerationInspection {
  readonly state: 'missing' | 'occupied' | 'ready';
  readonly chain: PhysicalDirectoryChain | null;
}

interface GenerationMaterialization {
  readonly chain: PhysicalDirectoryChain;
  readonly digest: string;
  readonly path: string;
}

interface OperationLease {
  readonly commonRoot: PhysicalDirectoryIdentity;
  readonly name: string;
  readonly handle: PhysicalMutationLeaseHandle;
}

class GitHookTransitionConflict extends Error {
  readonly code = 'git-hook-transition-conflict';
  readonly retainOperationLease: boolean;
  readonly providerAdmission: GitProviderAdmission | null;

  constructor(
    message: string,
    retainOperationLease = false,
    providerAdmission: GitProviderAdmission | null = null
  ) {
    super(message.startsWith('Git hook transition conflict:')
      ? message
      : 'Git hook transition conflict: ' + message);
    this.name = 'GitHookTransitionConflict';
    this.retainOperationLease = retainOperationLease;
    this.providerAdmission = providerAdmission;
  }
}

function providerAdmissionConflict(
  failure: GitReadProviderResolutionFailure
): GitHookTransitionConflict {
  const admission = Object.freeze({
    route: failure.route,
    status: failure.status,
    reason: failure.reason,
    detailDigest: failure.detailDigest
  });
  return new GitHookTransitionConflict(
    'Git provider admission is ' + failure.status
      + ' for ' + failure.route
      + ' (' + failure.reason + '; ' + failure.detailDigest + '); '
      + 'Git hook authority was not changed.',
    false,
    admission
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asTransition(error: unknown): GitHookTransitionConflict {
  return error instanceof GitHookTransitionConflict
    ? error
    : new GitHookTransitionConflict(errorMessage(error));
}

function stoppedResult(message: string, lifecycle: boolean): GitHookInstallationResult {
  const conflict = new GitHookTransitionConflict(message);
  if (lifecycle) {
    return Object.freeze({ status: 'conflict', message: conflict.message });
  }
  throw conflict;
}

function canonicalPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function pathWithin(parent: string, child: string): boolean {
  const parentPath = canonicalPath(parent);
  const childPath = canonicalPath(child);
  if (parentPath === childPath) return true;
  const separator = path.sep;
  return childPath.startsWith(parentPath.endsWith(separator) ? parentPath : parentPath + separator);
}

function physicalIdentityKey(identity: PhysicalDirectoryIdentity): string {
  return [
    canonicalPath(identity.path),
    canonicalPath(identity.finalPath),
    identity.device,
    identity.inode,
    identity.objectId
  ].join('\0');
}

function physicalChainKey(chain: PhysicalDirectoryChain): string {
  return chain.ancestors.map(physicalIdentityKey).join('\0');
}

function sameIdentity(left: PhysicalDirectoryIdentity, right: PhysicalDirectoryIdentity): boolean {
  return physicalIdentityKey(left) === physicalIdentityKey(right);
}

function sameChain(left: PhysicalDirectoryChain, right: PhysicalDirectoryChain): boolean {
  return physicalChainKey(left) === physicalChainKey(right);
}

function sameLeaseOwner(
  left: PhysicalMutationLeaseOwner,
  right: PhysicalMutationLeaseOwner
): boolean {
  return left.schema === right.schema
    && left.host === right.host
    && left.pid === right.pid
    && left.processNonce === right.processNonce
    && left.token === right.token
    && left.createdAtMs === right.createdAtMs
    && left.expiresAtMs === right.expiresAtMs;
}

function samePhysicalFileObservation(
  left: PhysicalFileObservation,
  right: PhysicalFileObservation
): boolean {
  return left.state === right.state
    && left.device === right.device
    && left.inode === right.inode
    && left.size === right.size
    && left.byteDigest === right.byteDigest;
}

function physicalFileObservationFromEntry(
  entry: ReturnType<typeof inspectNoFollowOrdinaryFileEntry> | null
): PhysicalFileObservation {
  if (entry === null) {
    return Object.freeze({
      state: 'absent',
      device: null,
      inode: null,
      size: null,
      byteDigest: null
    });
  }
  if (entry.bytes === null) throw new GitHookTransitionConflict('Physical config file readback has no bytes');
  return Object.freeze({
    state: 'present',
    device: entry.device,
    inode: entry.inode,
    size: entry.size,
    byteDigest: 'sha256:' + createHash('sha256').update(entry.bytes).digest('hex')
  });
}

/**
 * Every control-file/tree operation is rooted in a previously captured full
 * no-follow chain. Re-resolve that complete chain at the operation boundary;
 * checking only the final directory identity would allow an ancestor
 * replacement to turn a lexical path into a different authority.
 */
function assertRetainedDirectoryChainCurrent(
  expected: PhysicalDirectoryChain,
  label: string
): PhysicalDirectoryChain {
  const budget = currentGitInvocationBudget();
  budget.assertWithin(label + ' start');
  const current = inspectNoFollowDirectoryChain(expected.target.path, label);
  budget.assertWithin(label + ' completion');
  if (!sameChain(expected, current)) {
    throw new GitHookTransitionConflict(label + ' physical ancestor chain changed');
  }
  return current;
}

function readRetainedFile(
  parent: PhysicalDirectoryChain,
  name: string,
  label: string
): ReturnType<typeof inspectNoFollowOrdinaryFileEntry> {
  const before = assertRetainedDirectoryChainCurrent(parent, label + ' parent');
  const entry = inspectNoFollowOrdinaryFileEntry(before.target, name);
  currentGitInvocationBudget().assertWithin(label + ' file completion');
  const after = assertRetainedDirectoryChainCurrent(parent, label + ' parent readback');
  if (!sameChain(parent, after)) {
    throw new GitHookTransitionConflict(label + ' parent physical ancestor chain changed during read');
  }
  return entry;
}

interface ConfigFileTarget {
  readonly scope: 'local' | 'worktree';
  readonly path: string;
  readonly parent: PhysicalDirectoryChain;
  readonly name: string;
  readonly expected: PhysicalFileObservation;
}

function configFileTarget(
  boundary: ConfigPhysicalBoundary,
  commonGitDir: string,
  worktreeConfigPath: string,
  scope: 'local' | 'worktree'
): ConfigFileTarget {
  const parent = scope === 'local'
    ? boundary.commonConfigParent
    : boundary.worktreeConfigParent;
  const name = scope === 'local' ? 'config' : path.basename(worktreeConfigPath);
  const targetPath = path.resolve(scope === 'local'
    ? path.join(commonGitDir, name)
    : worktreeConfigPath);
  if (canonicalPath(targetPath) !== canonicalPath(path.join(parent.target.path, name))) {
    throw new GitHookTransitionConflict('Git config target escaped its retained config parent');
  }
  return Object.freeze({
    scope,
    path: targetPath,
    parent,
    name,
    expected: scope === 'local' ? boundary.commonConfig : boundary.worktreeConfig
  });
}

function scanRetainedTree(
  root: PhysicalDirectoryChain,
  label: string
): ReturnType<typeof scanNoFollowDirectoryTree> {
  const budget = currentGitInvocationBudget();
  budget.assertWithin(label + ' start');
  const before = assertRetainedDirectoryChainCurrent(root, label + ' root');
  const entries = scanNoFollowDirectoryTree(before.target);
  budget.assertWithin(label + ' scan completion');
  const after = assertRetainedDirectoryChainCurrent(root, label + ' root readback');
  if (!sameChain(root, after)) {
    throw new GitHookTransitionConflict(label + ' physical ancestor chain changed during scan');
  }
  return entries;
}

function isExecutable(metadata: Awaited<ReturnType<typeof lstat>>): boolean {
  return metadata.isFile()
    && !metadata.isSymbolicLink()
    && (process.platform === 'win32' || (Number(metadata.mode) & 0o111) !== 0);
}

async function gitText(
  repoRoot: string,
  args: readonly string[],
  options: { readonly allowMissing?: boolean } = {}
): Promise<string | null> {
  return await gitReadText(repoRoot, args, { allowMissing: options.allowMissing });
}

async function gitReadText(
  repoRoot: string,
  args: readonly string[],
  options: { readonly allowMissing?: boolean } = {}
): Promise<string | null> {
  const root = path.resolve(repoRoot);
  const budget = currentGitInvocationBudget();
  const operationLabel = 'Git read';
  budget.assertGitExecutableCurrent(operationLabel, { verifyExecutable: false });
  budget.beforeProcess(operationLabel);
  budget.beforeSpawn('git-read');
  const run = async (session: GitReadSession) => {
    const command = await session.run(args);
    if (command.kind !== 'completed') {
      throw new GitHookTransitionConflict(
        'Git read provider rejected git ' + (args[0] ?? 'command') + ': ' + command.detail
      );
    }
    const stdout = Buffer.from(command.result.stdout).toString('utf8');
    const stderr = command.result.stderr;
    budget.afterProcess(stdout, stderr, operationLabel);
    const missingStatus = command.result.code === 1
      || command.result.code === 2
      || command.result.code === 5
      || command.result.code === 128;
    if (options.allowMissing && missingStatus && stdout.trim().length === 0) return null;
    if (command.result.code !== 0) {
      const detail = stderr.trim();
      throw new Error('git ' + (args[0] ?? 'command') + ' failed'
        + (detail.length > 0 ? ': ' + detail : ''));
    }
    return stdout.trim();
  };
  const borrowed = budget.borrowedReadSessionFor(root);
  const result = borrowed === null
    ? await withAuthorityGitReadSession({
      cwd: root,
      source: budget.environment,
      budget: budget.nestedReadBudget(operationLabel)
    }, run)
    : await run(borrowed);
  budget.assertGitExecutableCurrent(operationLabel + ' completion', { verifyExecutable: false });
  return result;
}

function managedCommonRoot(commonGitDir: string): string {
  return path.join(commonGitDir, MANAGED_COMMON_DIRECTORY);
}

function generationNameMatchesDigest(generationPath: string, digest: string): boolean {
  const name = path.basename(generationPath);
  return MANAGED_GENERATION_NAME.test(name)
    && (name === 'generation-' + digest || name.startsWith('generation-' + digest + '-'));
}

function isCurrentManagedCommonSetting(configured: string, commonGitDir: string): boolean {
  return path.isAbsolute(configured)
    && canonicalPath(path.dirname(configured)) === canonicalPath(managedCommonRoot(commonGitDir))
    && MANAGED_GENERATION_NAME.test(path.basename(configured));
}

function isManagedCommonSetting(configured: string, commonGitDir: string): boolean {
  return isCurrentManagedCommonSetting(configured, commonGitDir);
}

function resolveGitPath(repoRoot: string, configured: string): string {
  if (configured.length === 0) throw new Error('Git returned an empty hooks path');
  return path.isAbsolute(configured) ? path.resolve(configured) : path.resolve(repoRoot, configured);
}

function shellQuotedRuntimeExecutable(executable: string): string {
  if (executable.length === 0 || /[\0\r\n]/u.test(executable)) {
    throw new Error('Bun runtime executable path is invalid');
  }
  const shellPath = process.platform === 'win32' ? executable.replaceAll('\\', '/') : executable;
  return "'" + shellPath.replaceAll("'", "'\"'\"'") + "'";
}

function deployedHookBytes(name: string, sourceBytes: Buffer): Buffer {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes);
  const invocations = Array.from(source.matchAll(MANAGED_HOOK_BUN_INVOCATION));
  if (invocations.length !== 1) {
    throw new Error(name + ' must contain exactly one top-level Bun invocation');
  }
  const runtimeExecutable = shellQuotedRuntimeExecutable(process.execPath);
  return Buffer.from(
    source.replace(MANAGED_HOOK_BUN_INVOCATION, (_match, prefix: string | undefined) => (
      (prefix ?? '') + runtimeExecutable
    )),
    'utf8'
  );
}

async function managedHookSnapshots(
  repoRoot: string,
  options: { readonly requireHeadTree?: boolean } = {}
): Promise<readonly ManagedHookSnapshot[] | null> {
  const rootChain = inspectNoFollowDirectoryChain(repoRoot, 'Managed hook repository root');
  const sourceChain = inspectNoFollowDirectoryChain(
    path.join(rootChain.target.path, MANAGED_HOOKS_PATH),
    'Managed hook source root'
  );
  const sourceEntries = scanRetainedTree(sourceChain, 'Managed hook source inventory');
  if (
    sourceEntries.length !== MANAGED_GENERATION_NAMES.length
    || sourceEntries.some((entry) => (
      entry.relativePath.includes('/')
      || entry.kind !== 'file'
      || entry.bytes === null
      || !MANAGED_GENERATION_NAMES.includes(entry.relativePath)
    ))
  ) return null;
  const sourceByName = new Map(sourceEntries.map((entry) => [entry.relativePath, entry]));
  const trackedRecords = (await gitReadText(
    repoRoot,
    ['ls-files', '--stage', '-z', '--', ...MANAGED_HOOKS]
  ))?.split('\0').filter((record) => record.length > 0) ?? [];
  const trackedByPath = new Map<string, string>();
  for (const record of trackedRecords) {
    const match = /^(100755) ([0-9a-f]{40}|[0-9a-f]{64}) 0\t(.+)$/u.exec(record);
    if (
      match === null
      || !MANAGED_HOOKS.includes(match[3] as typeof MANAGED_HOOKS[number])
      || trackedByPath.has(match[3]!)
    ) return null;
    trackedByPath.set(match[3]!, match[2]!);
  }
  if (trackedByPath.size !== MANAGED_HOOKS.length) return null;
  const headByPath = new Map<string, string>();
  if (options.requireHeadTree === true) {
    const headRecords = (await gitReadText(
      repoRoot,
      ['ls-tree', '-z', '--full-tree', 'HEAD', '--', ...MANAGED_HOOKS],
      { allowMissing: true }
    ))?.split('\0').filter((record) => record.length > 0) ?? [];
    for (const record of headRecords) {
      const match = /^(100755) blob ([0-9a-f]{40}|[0-9a-f]{64})\t(.+)$/u.exec(record);
      if (
        match === null
        || !MANAGED_HOOKS.includes(match[3] as typeof MANAGED_HOOKS[number])
        || headByPath.has(match[3]!)
      ) return null;
      headByPath.set(match[3]!, match[2]!);
    }
    if (headByPath.size !== MANAGED_HOOKS.length) return null;
  }
  const snapshots: ManagedHookSnapshot[] = [];
  for (const hook of MANAGED_HOOKS) {
    const trackedObjectId = trackedByPath.get(hook);
    if (trackedObjectId === undefined) return null;
    const name = path.basename(hook);
    const sourceEntry = sourceByName.get(name);
    if (sourceEntry === undefined || sourceEntry.bytes === null) return null;
    const sourcePhysical = readRetainedFile(sourceChain, name, 'Managed hook source file');
    if (
      sourcePhysical === null
      || sourcePhysical.bytes === null
      || sourcePhysical.device !== sourceEntry.device
      || sourcePhysical.inode !== sourceEntry.inode
      || !Buffer.from(sourcePhysical.bytes).equals(Buffer.from(sourceEntry.bytes))
    ) return null;
    const sourceMetadata = await lstat(path.join(sourceChain.target.path, name));
    if (!isExecutable(sourceMetadata)) return null;
    if (process.platform !== 'win32' && (
      String(sourceMetadata.dev) !== sourcePhysical.device
      || String(sourceMetadata.ino) !== sourcePhysical.inode
    )) return null;
    const sourceBytes = Buffer.from(sourceEntry.bytes);
    const objectHash = trackedObjectId.length === 40 ? 'sha1' : 'sha256';
    const workingBlob = createHash(objectHash)
      .update('blob ' + sourceBytes.byteLength + '\0')
      .update(sourceBytes)
      .digest('hex');
    if (workingBlob !== trackedObjectId) return null;
    if (options.requireHeadTree === true && headByPath.get(hook) !== trackedObjectId) return null;
    snapshots.push(Object.freeze({
      deployedBytes: deployedHookBytes(name, sourceBytes),
      name,
      sourceBytes
    }));
  }
  assertRetainedDirectoryChainCurrent(sourceChain, 'Managed hook source root readback');
  assertRetainedDirectoryChainCurrent(rootChain, 'Managed hook repository root readback');
  return Object.freeze(snapshots);
}

function sourceFingerprint(snapshots: readonly ManagedHookSnapshot[]): string {
  const hash = createHash('sha256');
  hash.update('sec-managed-hook-source-fingerprint-v4\0');
  for (const snapshot of snapshots) {
    hash.update(snapshot.name + '\0' + snapshot.sourceBytes.byteLength + '\0');
    hash.update(snapshot.sourceBytes);
  }
  return hash.digest('hex');
}

function managedGenerationDigest(
  snapshots: readonly ManagedHookSnapshot[],
  binding: string
): string {
  const hash = createHash('sha256');
  hash.update('sec-managed-hooks-v4-physical-binding\0');
  hash.update(binding + '\0');
  for (const snapshot of snapshots) {
    hash.update(snapshot.name + '\0' + snapshot.sourceBytes.byteLength + '\0');
    hash.update(snapshot.sourceBytes);
    hash.update(snapshot.name + '\0' + snapshot.deployedBytes.byteLength + '\0');
    hash.update(snapshot.deployedBytes);
  }
  return hash.digest('hex');
}

function makeBinding(
  rootChain: PhysicalDirectoryChain,
  commonChain: PhysicalDirectoryChain
): string {
  return 'root\0' + physicalChainKey(rootChain)
    + '\0common\0' + physicalChainKey(commonChain);
}

async function createSourceContext(
  repoRoot: string,
  rootChain: PhysicalDirectoryChain,
  commonChain: PhysicalDirectoryChain,
  snapshots: readonly ManagedHookSnapshot[],
  options: {
    readonly bootstrapAuthority?: PrimaryBootstrapAuthority | null;
    readonly requireHeadTree?: boolean;
  } = {}
): Promise<SourceContext> {
  const bootstrapAuthority = options.bootstrapAuthority ?? null;
  const requireHeadTree = options.requireHeadTree === true;
  const binding = makeBinding(rootChain, commonChain);
  return Object.freeze({
    binding,
    bootstrapAuthority,
    commonChain,
    digest: managedGenerationDigest(snapshots, binding),
    fingerprint: sourceFingerprint(snapshots),
    repoRoot,
    requireHeadTree,
    rootChain,
    snapshots
  });
}

async function assertBootstrapAuthorityCurrent(
  context: SourceContext,
  label: string
): Promise<void> {
  if (context.bootstrapAuthority === null) return;
  const expected = context.bootstrapAuthority;
  try {
    const branch = await gitText(
      context.repoRoot,
      ['symbolic-ref', '--quiet', '--short', 'HEAD'],
      { allowMissing: true }
    );
    const localHeadSha = await gitText(
      context.repoRoot,
      ['rev-parse', '--verify', 'HEAD^{commit}'],
      { allowMissing: true }
    );
    const originUrl = await gitText(
      context.repoRoot,
      ['remote', 'get-url', 'origin'],
      { allowMissing: true }
    );
    const originHeadRef = originUrl === null ? null : await gitText(
      context.repoRoot,
      ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'],
      { allowMissing: true }
    );
    const originHeadSha = originUrl === null ? null : await gitText(
      context.repoRoot,
      ['rev-parse', '--verify', 'refs/remotes/origin/HEAD^{commit}'],
      { allowMissing: true }
    );
    if (
      branch === expected.branch
      && localHeadSha === expected.localHeadSha
      && originUrl === expected.originUrl
      && originHeadRef === expected.originHeadRef
      && originHeadSha === expected.originHeadSha
    ) return;
  } catch {
    // The typed transition conflict below is the only public settlement.
  }
  throw new GitHookTransitionConflict(label + ' canonical primary bootstrap authority changed');
}

async function assertSourceCurrent(context: SourceContext, label: string): Promise<void> {
  const root = inspectNoFollowDirectoryChain(context.repoRoot, label + ' repository root');
  const common = inspectNoFollowDirectoryChain(
    context.commonChain.target.path,
    label + ' common Git directory'
  );
  if (!sameChain(root, context.rootChain) || !sameChain(common, context.commonChain)) {
    throw new GitHookTransitionConflict(label + ' physical ancestor chain changed');
  }
  await assertBootstrapAuthorityCurrent(context, label);
  const snapshots = await managedHookSnapshots(context.repoRoot, {
    requireHeadTree: context.requireHeadTree
  });
  if (
    snapshots === null
    || managedGenerationDigest(snapshots, makeBinding(root, common)) !== context.digest
    || sourceFingerprint(snapshots) !== context.fingerprint
  ) {
    throw new GitHookTransitionConflict(label + ' tracked managed hook source changed');
  }
}

/**
 * Publication fences only need to re-prove the already frozen source bytes
 * and every retained physical ancestor.  The initial and terminal fences use
 * `managedHookSnapshots` to include the Git index object identity; the
 * intermediate fences deliberately avoid spawning Git again while retaining
 * the same no-follow physical proof.
 */
function assertSourcePhysicalCurrent(context: SourceContext, label: string): void {
  const root = inspectNoFollowDirectoryChain(context.repoRoot, label + ' repository root');
  const common = inspectNoFollowDirectoryChain(
    context.commonChain.target.path,
    label + ' common Git directory'
  );
  if (!sameChain(root, context.rootChain) || !sameChain(common, context.commonChain)) {
    throw new GitHookTransitionConflict(label + ' physical ancestor chain changed');
  }
  const source = inspectNoFollowDirectoryChain(
    path.join(root.target.path, MANAGED_HOOKS_PATH),
    label + ' managed hook source root'
  );
  const entries = scanRetainedTree(source, label + ' managed hook source inventory');
  const expected = new Map(context.snapshots.map((snapshot) => [snapshot.name, snapshot.sourceBytes]));
  if (
    entries.length !== expected.size
    || entries.some((entry) => (
      entry.relativePath.includes('/')
      || entry.kind !== 'file'
      || entry.bytes === null
      || !expected.has(entry.relativePath)
      || !Buffer.from(entry.bytes).equals(expected.get(entry.relativePath)!)
    ))
  ) {
    throw new GitHookTransitionConflict(label + ' tracked managed hook source changed');
  }
  assertRetainedDirectoryChainCurrent(source, label + ' managed hook source readback');
  assertRetainedDirectoryChainCurrent(root, label + ' repository root readback');
  assertRetainedDirectoryChainCurrent(common, label + ' common Git directory readback');
}

function markerBytes(record: HookMarkerRecord): Buffer {
  return Buffer.from(record.digest + '\n' + record.fingerprint + '\n' + record.generationName + '\n', 'utf8');
}

function parseMarkerBytes(bytes: Uint8Array): HookMarkerRecord | null {
  const lines = Buffer.from(bytes).toString('utf8').split('\n');
  const digest = lines[0]?.trim();
  const fingerprint = lines[1]?.trim();
  const generationName = lines[2]?.trim();
  if (
    lines.length !== 4
    || lines[3] !== ''
    || digest === undefined
    || !/^[0-9a-f]{64}$/u.test(digest)
    || fingerprint === undefined
    || !/^[0-9a-f]{64}$/u.test(fingerprint)
    || generationName === undefined
    || !MANAGED_GENERATION_NAME.test(generationName)
  ) return null;
  return Object.freeze({ digest, fingerprint, generationName });
}

function markerRootPath(gitDir: string): string {
  return path.join(gitDir, MANAGED_COMMON_DIRECTORY);
}

function markerParentPath(gitDir: string): string {
  return markerRootPath(gitDir);
}

function hasDurablePendingTransitionForConfiguredPath(input: {
  readonly commonRoot: PhysicalDirectoryChain | null;
  readonly configured: string | null;
  readonly scope: 'local' | 'worktree';
  readonly commonGitDir: string;
  readonly repoRoot: string;
}): boolean {
  if (input.commonRoot === null || input.configured === null) return false;
  const configuredPath = canonicalPath(resolveGitPath(input.repoRoot, input.configured));
  for (const namespace of inspectConfigTransitionNamespaces(input.commonRoot)) {
    const intentBytes = transitionFileBytes(namespace.chain, CONFIG_TRANSITION_INTENT_FILE);
    const preparedBytes = transitionFileBytes(namespace.chain, CONFIG_TRANSITION_PREPARED_FILE);
    let target: HookConfigState | null = null;
    let commonRoot: string | null = null;
    let recordRepoRoot: string | null = null;
    if (intentBytes !== null) {
      const intent = parseConfigTransitionIntent(
        intentBytes,
        'Pending Git config transition intent ' + namespace.name
      );
      target = intent.target;
      commonRoot = intent.commonRoot;
      recordRepoRoot = intent.repoRoot;
    } else if (preparedBytes !== null) {
      const prepared = parseConfigTransitionPreparedIntent(
        preparedBytes,
        'Pending Git config prepared transition intent ' + namespace.name
      );
      target = prepared.target;
      commonRoot = prepared.commonRoot;
      recordRepoRoot = prepared.repoRoot;
    }
    if (target === null || commonRoot === null || recordRepoRoot === null) continue;
    if (
      canonicalPath(commonRoot) !== canonicalPath(input.commonRoot.target.path)
      || canonicalPath(recordRepoRoot) !== canonicalPath(input.repoRoot)
    ) continue;
    const targetPath = input.scope === 'local' ? target.commonHooksPath : target.worktreeHooksPath;
    if (
      targetPath !== null
      && pathWithin(input.commonRoot.target.path, resolveGitPath(input.repoRoot, targetPath))
      && canonicalPath(resolveGitPath(input.repoRoot, targetPath)) === configuredPath
    ) return true;
  }
  return false;
}

function hasValidatedEffectiveHookLineage(input: {
  readonly isPrimaryWorktree: boolean;
  readonly markerRoot: PhysicalDirectoryChain | null;
  readonly marker: HookMarkerRecord | null;
  readonly commonRoot: PhysicalDirectoryChain | null;
  readonly commonConfigured: string | null;
  readonly worktreeConfigured: string | null;
  readonly commonGitDir: string;
  readonly repoRoot: string;
}): boolean {
  if (
    input.markerRoot === null
    || input.marker === null
    || input.commonRoot === null
    || input.commonConfigured === null
    || !isCurrentManagedCommonSetting(input.commonConfigured, input.commonGitDir)
  ) return false;
  const markerRoot = assertRetainedDirectoryChainCurrent(
    input.markerRoot,
    'Inherited common marker namespace'
  );
  const commonRoot = assertRetainedDirectoryChainCurrent(
    input.commonRoot,
    'Inherited common generation namespace'
  );
  if (
    canonicalPath(markerRoot.target.path) !== canonicalPath(commonRoot.target.path)
    || !sameChain(markerRoot, commonRoot)
  ) return false;
  const currentMarker = readMarkerFile(markerRoot);
  if (currentMarker === null || !sameHookMarker(currentMarker, input.marker)) return false;
  const generationPath = path.join(commonRoot.target.path, input.marker.generationName);
  const commonConfiguredPath = resolveGitPath(input.repoRoot, input.commonConfigured);
  const commonLineageIsExact = pathWithin(commonRoot.target.path, generationPath)
    && generationNameMatchesDigest(generationPath, input.marker.digest)
    && canonicalPath(commonConfiguredPath) === canonicalPath(generationPath);
  if (!commonLineageIsExact) return false;
  if (input.isPrimaryWorktree) {
    return input.worktreeConfigured === null
      || canonicalPath(resolveGitPath(input.repoRoot, input.worktreeConfigured)) === canonicalPath(generationPath);
  }
  if (
    input.worktreeConfigured === null
    || !isCurrentManagedCommonSetting(input.worktreeConfigured, input.commonGitDir)
  ) return false;
  return canonicalPath(resolveGitPath(input.repoRoot, input.worktreeConfigured)) === canonicalPath(generationPath);
}

function readMarkerFile(parent: PhysicalDirectoryChain): HookMarkerRecord | null {
  const marker = readRetainedFile(parent, MARKER_FILE_NAME, 'Managed hook marker');
  if (marker === null || marker.bytes === null) return null;
  return parseMarkerBytes(marker.bytes);
}

/**
 * A marker is an ownership claim only when its exact retained directory,
 * configured hooksPath, and common generation namespace agree.  In
 * particular, a marker must not be used to bless a same-named generation
 * after an external config writer has redirected hooksPath, or after the
 * marker's generation name/digest has been replaced.  Missing markers are
 * likewise a conflict when config still points at a v3 generation: the old
 * generation cannot be retired by name alone.
 */
function assertConfiguredMarkerLineage(input: {
  readonly markerRoot: PhysicalDirectoryChain | null;
  readonly marker: HookMarkerRecord | null;
  readonly configured: string | null;
  readonly scope: 'local' | 'worktree';
  readonly commonRoot: PhysicalDirectoryChain | null;
  readonly commonGitDir: string;
  readonly repoRoot: string;
  readonly label: string;
  readonly allowDurablePendingTransition?: boolean;
  readonly allowInheritedCommonLineage?: boolean;
}): void {
  const configuredIsCurrent = input.configured !== null
    && isCurrentManagedCommonSetting(input.configured, input.commonGitDir);
  if (!configuredIsCurrent && input.allowInheritedCommonLineage === true) return;
  if (input.marker === null) {
    if (
      configuredIsCurrent
      && input.allowDurablePendingTransition !== true
      && input.allowInheritedCommonLineage !== true
    ) {
      throw new GitHookTransitionConflict(
        input.label + ' has a managed hooksPath without its exact marker lineage'
      );
    }
    return;
  }
  if (input.markerRoot === null || input.commonRoot === null || !configuredIsCurrent) {
    throw new GitHookTransitionConflict(
      input.label + ' marker/config lineage is not an exact managed lineage'
    );
  }
  const markerRoot = assertRetainedDirectoryChainCurrent(
    input.markerRoot,
    input.label + ' marker namespace'
  );
  const currentMarker = readMarkerFile(markerRoot);
  if (currentMarker === null || !sameHookMarker(currentMarker, input.marker)) {
    throw new GitHookTransitionConflict(input.label + ' marker changed before lineage validation');
  }
  const commonRoot = assertRetainedDirectoryChainCurrent(
    input.commonRoot,
    input.label + ' common generation namespace'
  );
  const generationPath = path.join(commonRoot.target.path, input.marker.generationName);
  if (
    !pathWithin(commonRoot.target.path, generationPath)
    || !generationNameMatchesDigest(generationPath, input.marker.digest)
    || canonicalPath(resolveGitPath(input.repoRoot, input.configured!)) !== canonicalPath(generationPath)
  ) {
    throw new GitHookTransitionConflict(
      input.label + ' marker/config generation identity does not match the retained common namespace'
    );
  }
  assertRetainedDirectoryChainCurrent(markerRoot, input.label + ' marker namespace readback');
  assertRetainedDirectoryChainCurrent(commonRoot, input.label + ' common generation namespace readback');
}

function assertMarkerSlotSafe(parent: PhysicalDirectoryChain): void {
  const entries = scanRetainedTree(parent, 'Managed hook marker inventory');
  const direct = entries.find((entry) => entry.relativePath === MARKER_FILE_NAME);
  if (direct !== undefined && direct.kind !== 'file') {
    throw new GitHookTransitionConflict('Managed hook marker is occupied by a non-file entry');
  }
}

function writeMarkerFile(parent: PhysicalDirectoryChain, record: HookMarkerRecord): void {
  const budget = currentGitInvocationBudget();
  budget.assertWithin('Managed hook marker publication start');
  assertMarkerSlotSafe(parent);
  assertRetainedDirectoryChainCurrent(parent, 'Managed hook marker publication parent');
  const bytes = markerBytes(record);
  replaceDurableCanonicalFile({
    parent: parent.target,
    name: MARKER_FILE_NAME,
    bytes,
    validate: (candidate) => {
      if (parseMarkerBytes(candidate) === null) {
        throw new Error('Managed hook marker has invalid canonical bytes');
      }
    }
  });
  budget.assertWithin('Managed hook marker publication completion');
  assertRetainedDirectoryChainCurrent(parent, 'Managed hook marker publication parent readback');
  const readback = readRetainedFile(parent, MARKER_FILE_NAME, 'Managed hook marker readback');
  if (
    readback === null
    || readback.bytes === null
    || !Buffer.from(readback.bytes).equals(bytes)
  ) {
    throw new GitHookTransitionConflict('Managed hook marker physical readback differs');
  }
}

function inspectExistingDirectory(pathName: string, label: string): PhysicalDirectoryChain | null {
  const parent = inspectNoFollowDirectoryChain(path.dirname(pathName), label + ' parent');
  const presence = inspectExactNoFollowDirectoryPresence(pathName, label);
  if (presence.state === 'absent') {
    assertRetainedDirectoryChainCurrent(parent, label + ' parent readback');
    return null;
  }
  const directory = inspectNoFollowDirectoryChain(pathName, label + ' chain');
  if (
    !sameChain(directory, presence.directory)
    || !directory.ancestors.some((ancestor) => sameIdentity(ancestor, parent.target))
  ) {
    throw new GitHookTransitionConflict(label + ' escaped its retained parent');
  }
  assertRetainedDirectoryChainCurrent(directory, label + ' readback');
  assertRetainedDirectoryChainCurrent(parent, label + ' parent readback');
  return directory;
}

function ensureDirectoryNamespace(
  parent: PhysicalDirectoryChain,
  name: string,
  label: string
): PhysicalDirectoryChain {
  const retainedParent = assertRetainedDirectoryChainCurrent(parent, label + ' parent');
  const target = path.join(retainedParent.target.path, name);
  if (inspectExactNoFollowDirectoryPresence(target, label).state === 'absent') {
    try {
      createExclusiveNoFollowDirectory(retainedParent.target, name);
    } catch (error) {
      assertRetainedDirectoryChainCurrent(retainedParent, label + ' parent collision readback');
      if (inspectExactNoFollowDirectoryPresence(target, label + ' collision readback').state !== 'present') {
        throw asTransition(error);
      }
    }
  }
  const result = inspectNoFollowDirectoryChain(target, label + ' readback');
  assertRetainedDirectoryChainCurrent(retainedParent, label + ' parent readback');
  return result;
}

async function inspectManagedGeneration(
  generationPath: string,
  expectedSnapshots?: readonly ManagedHookSnapshot[]
): Promise<ManagedGenerationInspection> {
  const parentChain = inspectNoFollowDirectoryChain(
    path.dirname(generationPath),
    'Managed generation parent'
  );
  let generationChain: PhysicalDirectoryChain;
  try {
    const presence = inspectExactNoFollowDirectoryPresence(
      generationPath,
      'Managed generation'
    );
    if (presence.state === 'absent') {
      return Object.freeze({ state: 'missing', chain: null });
    }
    generationChain = presence.directory;
  } catch (error) {
    if (
      error instanceof PhysicalNoFollowError
      && error.code === 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH'
    ) {
      return Object.freeze({ state: 'occupied', chain: null });
    }
    throw error;
  }
  if (!generationChain.ancestors.some((ancestor) => sameIdentity(ancestor, parentChain.target))) {
    throw new GitHookTransitionConflict('Managed generation parent chain is not bound to the common namespace');
  }
  const entries = scanRetainedTree(generationChain, 'Managed generation inventory');
  if (
    entries.length !== MANAGED_GENERATION_NAMES.length
    || entries.some((entry) => (
      entry.relativePath.includes('/')
      || entry.kind !== 'file'
      || !MANAGED_GENERATION_NAMES.includes(entry.relativePath)
      || entry.bytes === null
    ))
  ) {
    return Object.freeze({ state: 'occupied', chain: generationChain });
  }
  const byName = new Map(entries.map((entry) => [entry.relativePath, entry]));
  for (const name of MANAGED_GENERATION_NAMES) {
    const scanned = byName.get(name);
    if (scanned === undefined || scanned.bytes === null) {
      return Object.freeze({ state: 'occupied', chain: generationChain });
    }
    const actual = readRetainedFile(generationChain, name, 'Managed generation file');
    const metadata = actual === null
      ? null
      : await lstat(path.join(generationChain.target.path, name));
    if (
      actual === null
      || actual.bytes === null
      || metadata === null
      || !isExecutable(metadata)
      || actual.device !== scanned.device
      || actual.inode !== scanned.inode
      || !Buffer.from(scanned.bytes).equals(Buffer.from(actual.bytes))
    ) {
      return Object.freeze({ state: 'occupied', chain: generationChain });
    }
  }
  const generationAfter = inspectNoFollowDirectoryChain(
    generationPath,
    'Managed generation readback'
  );
  const parentAfter = inspectNoFollowDirectoryChain(
    path.dirname(generationPath),
    'Managed generation parent readback'
  );
  if (!sameChain(generationChain, generationAfter) || !sameChain(parentChain, parentAfter)) {
    throw new GitHookTransitionConflict('Managed generation ancestor chain changed during readback');
  }
  if (expectedSnapshots === undefined) {
    return Object.freeze({ state: 'ready', chain: generationAfter });
  }
  const ready = expectedSnapshots.every((snapshot) => {
    const entry = byName.get(snapshot.name);
    return entry !== undefined
      && entry.bytes !== null
      && Buffer.from(entry.bytes).equals(snapshot.deployedBytes);
  });
  return Object.freeze({
    state: ready ? 'ready' : 'occupied',
    chain: generationAfter
  });
}

async function managedGenerationDigestMatches(
  generationPath: string,
  expectedDigest: string,
  expectedSnapshots: readonly ManagedHookSnapshot[]
): Promise<boolean> {
  if (!generationNameMatchesDigest(generationPath, expectedDigest)) return false;
  const inspected = await inspectManagedGeneration(generationPath, expectedSnapshots);
  return inspected.state === 'ready';
}

function generationPhysicalEvidence(
  materialization: GenerationMaterialization,
  snapshots: readonly ManagedHookSnapshot[],
  label: string
): GenerationPhysicalEvidence {
  const chain = inspectNoFollowDirectoryChain(materialization.path, label + ' root');
  if (!sameChain(chain, materialization.chain)) {
    throw new GitHookTransitionConflict(label + ' root changed before durable intent publication');
  }
  const entries = scanRetainedTree(chain, label + ' inventory');
  if (
    entries.length !== snapshots.length
    || entries.some((entry) => (
      entry.relativePath.includes('/')
      || entry.kind !== 'file'
      || entry.bytes === null
      || !snapshots.some((snapshot) => snapshot.name === entry.relativePath)
    ))
  ) {
    throw new GitHookTransitionConflict(label + ' inventory is not the frozen generation');
  }
  const byName = new Map(entries.map((entry) => [entry.relativePath, entry]));
  const files = snapshots.map((snapshot) => {
    const entry = byName.get(snapshot.name);
    const direct = readRetainedFile(chain, snapshot.name, label + ' file');
    if (
      entry === undefined
      || entry.bytes === null
      || direct === null
      || direct.bytes === null
      || direct.device !== entry.device
      || direct.inode !== entry.inode
      || !Buffer.from(direct.bytes).equals(Buffer.from(snapshot.deployedBytes))
    ) {
      throw new GitHookTransitionConflict(label + ' file changed before durable intent publication');
    }
    return Object.freeze({
      name: snapshot.name,
      device: direct.device,
      inode: direct.inode,
      size: direct.size,
      byteDigest: 'sha256:' + createHash('sha256').update(direct.bytes).digest('hex')
    });
  });
  return Object.freeze({
    path: materialization.path,
    chain,
    files: Object.freeze(files)
  });
}

function assertGenerationPhysicalEvidenceCurrent(
  evidence: GenerationPhysicalEvidence,
  commonRoot: PhysicalDirectoryChain,
  label: string
): void {
  const current = inspectNoFollowDirectoryChain(evidence.path, label + ' root');
  if (
    !sameChain(current, evidence.chain)
    || !current.ancestors.some((ancestor) => sameIdentity(ancestor, commonRoot.target))
  ) {
    throw new GitHookTransitionConflict(label + ' physical ancestor identity changed');
  }
  const entries = scanRetainedTree(current, label + ' inventory');
  const expected = new Map(evidence.files.map((file) => [file.name, file]));
  if (
    entries.length !== expected.size
    || entries.some((entry) => (
      entry.relativePath.includes('/')
      || entry.kind !== 'file'
      || entry.bytes === null
      || !expected.has(entry.relativePath)
    ))
  ) {
    throw new GitHookTransitionConflict(label + ' inventory changed');
  }
  for (const file of evidence.files) {
    const entry = expected.get(file.name)!;
    const actual = readRetainedFile(current, file.name, label + ' file');
    if (
      actual === null
      || actual.bytes === null
      || actual.device !== file.device
      || actual.inode !== file.inode
      || actual.size !== file.size
      || 'sha256:' + createHash('sha256').update(actual.bytes).digest('hex') !== file.byteDigest
    ) {
      throw new GitHookTransitionConflict(label + ' file identity or bytes changed: ' + file.name);
    }
    if (
      entry.device !== actual.device
      || entry.inode !== actual.inode
      || entry.size !== actual.size
    ) {
      throw new GitHookTransitionConflict(label + ' inventory metadata changed: ' + file.name);
    }
  }
  assertRetainedDirectoryChainCurrent(current, label + ' root readback');
}

/**
 * A prior configured generation is the only historical generation that this
 * operation may retire. Its marker/config pair supplies the ownership claim;
 * the retained inventory supplies the exact bytes used by the later CAS
 * deletion. Unknown generation-shaped directories remain evidence and are
 * never guessed to be ours.
 */
async function capturePriorGenerationForCleanup(
  generationPath: string | null,
  marker: HookMarkerRecord | null,
  desiredDigest: string,
  commonRoot: PhysicalDirectoryChain,
  label: string,
  options: {
    readonly expectedSnapshots: readonly ManagedHookSnapshot[];
    readonly markerRoot: PhysicalDirectoryChain;
    readonly configuredPath: string;
    readonly scope: 'local' | 'worktree';
    readonly repoRoot: string;
    readonly commonGitDir: string;
    readonly worktreeGitDir: string;
    readonly worktreeConfigPath: string;
  }
): Promise<Readonly<{
  digest: string;
  snapshots: readonly ManagedHookSnapshot[];
  evidence: GenerationPhysicalEvidence;
}> | null> {
  if (generationPath === null || marker === null) return null;
  const currentCommonRoot = assertRetainedDirectoryChainCurrent(
    commonRoot,
    label + ' common generation namespace'
  );
  const expectedPath = path.join(currentCommonRoot.target.path, marker.generationName);
  if (
    !pathWithin(currentCommonRoot.target.path, generationPath)
    || canonicalPath(generationPath) !== canonicalPath(expectedPath)
    || canonicalPath(options.configuredPath) !== canonicalPath(generationPath)
    || path.basename(generationPath) !== marker.generationName
    || !generationNameMatchesDigest(generationPath, marker.digest)
  ) {
    throw new GitHookTransitionConflict(label + ' marker/config generation lineage is not exact');
  }
  const configuredObservation = await readHookConfigObservation(
    options.repoRoot,
    options.commonGitDir,
    options.worktreeGitDir,
    options.worktreeConfigPath
  );
  const configured = options.scope === 'local'
    ? configuredObservation.state.commonHooksPath
    : configuredObservation.state.worktreeHooksPath;
  if (
    configured === null
    || !isCurrentManagedCommonSetting(configured, options.commonGitDir)
    || canonicalPath(resolveGitPath(options.repoRoot, configured)) !== canonicalPath(generationPath)
  ) {
    throw new GitHookTransitionConflict(label + ' configured hooksPath no longer proves its marker lineage');
  }
  const currentMarkerRoot = assertRetainedDirectoryChainCurrent(
    options.markerRoot,
    label + ' marker namespace'
  );
  const currentMarker = readMarkerFile(currentMarkerRoot);
  if (currentMarker === null || !sameHookMarker(currentMarker, marker)) {
    throw new GitHookTransitionConflict(label + ' marker changed before prior-generation capture');
  }
  const inspection = await inspectManagedGeneration(generationPath, options.expectedSnapshots);
  if (inspection.chain === null) {
    throw new GitHookTransitionConflict(label + ' configured generation is missing or physically unsafe');
  }
  const generation = assertRetainedDirectoryChainCurrent(
    inspection.chain,
    label + ' generation namespace'
  );
  if (!generation.ancestors.some((ancestor) => sameIdentity(ancestor, currentCommonRoot.target))) {
    throw new GitHookTransitionConflict(label + ' generation escaped its retained common namespace');
  }
  const entries = scanRetainedTree(generation, label + ' inventory');
  if (
    entries.length !== MANAGED_GENERATION_NAMES.length
    || entries.some((entry) => (
      entry.relativePath.includes('/')
      || entry.kind !== 'file'
      || entry.bytes === null
      || !MANAGED_GENERATION_NAMES.includes(entry.relativePath)
    ))
  ) {
    throw new GitHookTransitionConflict(
      label + ' configured generation has an unsafe or non-canonical ordinary-file inventory'
    );
  }
  const byName = new Map(entries.map((entry) => [entry.relativePath, entry]));
  const snapshots: ManagedHookSnapshot[] = [];
  const files: GenerationPhysicalFile[] = [];
  for (const name of MANAGED_GENERATION_NAMES) {
    const entry = byName.get(name);
    const direct = readRetainedFile(generation, name, label + ' file');
    if (
      entry === undefined
      || entry.bytes === null
      || direct === null
      || direct.bytes === null
      || entry.device !== direct.device
      || entry.inode !== direct.inode
      || !Buffer.from(entry.bytes).equals(Buffer.from(direct.bytes))
    ) {
      throw new GitHookTransitionConflict(label + ' inventory changed before its cleanup ownership was retained');
    }
    const deployedBytes = Buffer.from(direct.bytes);
    snapshots.push(Object.freeze({
      deployedBytes,
      name,
      // Historical source bytes are not needed for deletion. Preserve the
      // exact deployed inventory in both slots so no synthetic byte formula
      // can authorize deletion of a replacement.
      sourceBytes: Buffer.from(deployedBytes)
    }));
    files.push(Object.freeze({
      name,
      device: direct.device,
      inode: direct.inode,
      size: direct.size,
      byteDigest: 'sha256:' + createHash('sha256').update(direct.bytes).digest('hex')
    }));
  }
  const ready = inspection.state === 'ready';
  if (marker.digest === desiredDigest && ready) {
    assertRetainedDirectoryChainCurrent(generation, label + ' ready readback');
    assertRetainedDirectoryChainCurrent(currentMarkerRoot, label + ' marker namespace readback');
    assertRetainedDirectoryChainCurrent(currentCommonRoot, label + ' common generation namespace readback');
    return null;
  }
  const finalConfiguredObservation = await readHookConfigObservation(
    options.repoRoot,
    options.commonGitDir,
    options.worktreeGitDir,
    options.worktreeConfigPath
  );
  const finalConfigured = options.scope === 'local'
    ? finalConfiguredObservation.state.commonHooksPath
    : finalConfiguredObservation.state.worktreeHooksPath;
  if (
    finalConfigured === null
    || canonicalPath(resolveGitPath(options.repoRoot, finalConfigured)) !== canonicalPath(generationPath)
  ) {
    throw new GitHookTransitionConflict(label + ' configured hooksPath changed during prior-generation capture');
  }
  assertRetainedDirectoryChainCurrent(generation, label + ' readback');
  assertRetainedDirectoryChainCurrent(currentMarkerRoot, label + ' marker namespace readback');
  assertRetainedDirectoryChainCurrent(currentCommonRoot, label + ' common generation namespace readback');
  return Object.freeze({
    digest: marker.digest,
    snapshots: Object.freeze(snapshots),
    evidence: Object.freeze({
      path: generationPath,
      chain: generation,
      files: Object.freeze(files)
    })
  });
}

function deleteOwnedGeneration(
  commonRoot: PhysicalDirectoryChain,
  generation: PhysicalDirectoryChain,
  snapshots: readonly ManagedHookSnapshot[]
): void {
  const retainedCommon = assertRetainedDirectoryChainCurrent(
    commonRoot,
    'Owned managed generation deletion parent'
  );
  const current = assertRetainedDirectoryChainCurrent(
    generation,
    'Owned managed generation deletion root'
  );
  if (
    !sameChain(generation, current)
    || !current.ancestors.some((ancestor) => sameIdentity(ancestor, retainedCommon.target))
  ) {
    throw new GitHookTransitionConflict('Owned managed generation changed before deletion');
  }
  const expectedByName = new Map(snapshots.map((snapshot) => [snapshot.name, snapshot.deployedBytes]));
  const entries = scanRetainedTree(current, 'Owned managed generation deletion inventory');
  if (entries.some((entry) => (
    entry.relativePath.includes('/')
    || entry.kind !== 'file'
    || !expectedByName.has(entry.relativePath)
    || entry.bytes === null
    || !Buffer.from(entry.bytes).equals(expectedByName.get(entry.relativePath)!)
  ))) {
    throw new GitHookTransitionConflict('Managed generation inventory changed; deletion was retained');
  }
  for (const entry of entries) {
    assertRetainedDirectoryChainCurrent(
      commonRoot,
      'Owned managed generation deletion parent fence'
    );
    const before = assertRetainedDirectoryChainCurrent(
      current,
      'Owned managed generation deletion file root'
    );
    if (!sameChain(generation, before)) {
      throw new GitHookTransitionConflict('Managed generation ancestor changed during deletion');
    }
    const leaf = readRetainedFile(before, entry.relativePath, 'Owned managed generation deletion file');
    if (
      leaf === null
      || leaf.bytes === null
      || leaf.device !== entry.device
      || leaf.inode !== entry.inode
      || !Buffer.from(leaf.bytes).equals(Buffer.from(entry.bytes!))
    ) {
      throw new GitHookTransitionConflict('Managed generation file replacement was preserved');
    }
    deleteRetainedEntryBounded({
      root: before.target,
      relativePath: entry.relativePath,
      kind: 'file',
      device: entry.device,
      inode: entry.inode,
      ancestorDirectories: []
    }, 'Owned managed generation deletion file');
  }
  const parent = assertRetainedDirectoryChainCurrent(
    commonRoot,
    'Owned managed generation deletion parent'
  );
  const generationName = path.basename(generation.target.path);
  deleteRetainedEntryBounded({
    root: parent.target,
    relativePath: generationName,
    kind: 'directory',
    device: generation.target.device,
    inode: generation.target.inode,
    ancestorDirectories: []
  }, 'Owned managed generation deletion root');
  const absent = inspectExactNoFollowDirectoryPresence(
    path.join(parent.target.path, generationName),
    'Owned managed generation deletion readback'
  );
  if (absent.state !== 'absent') {
    throw new GitHookTransitionConflict('Owned managed generation remained after deletion');
  }
}

function deleteGenerationByEvidence(
  commonRoot: PhysicalDirectoryChain,
  evidence: GenerationPhysicalEvidence,
  label: string
): void {
  const retainedCommon = assertRetainedDirectoryChainCurrent(commonRoot, label + ' parent');
  const current = inspectNoFollowDirectoryChain(evidence.path, label + ' root');
  if (
    !sameChain(current, evidence.chain)
    || !current.ancestors.some((ancestor) => sameIdentity(ancestor, retainedCommon.target))
  ) {
    throw new GitHookTransitionConflict(label + ' physical ancestor identity changed');
  }
  const entries = scanRetainedTree(current, label + ' inventory');
  const expected = new Map(evidence.files.map((file) => [file.name, file]));
  if (
    entries.length !== expected.size
    || entries.some((entry) => (
      entry.relativePath.includes('/')
      || entry.kind !== 'file'
      || entry.bytes === null
      || !expected.has(entry.relativePath)
    ))
  ) {
    throw new GitHookTransitionConflict(label + ' inventory changed; deletion was retained');
  }
  for (const file of evidence.files) {
    const entry = expected.get(file.name)!;
    const direct = readRetainedFile(current, file.name, label + ' file');
    if (
      direct === null
      || direct.bytes === null
      || direct.device !== file.device
      || direct.inode !== file.inode
      || direct.size !== file.size
      || 'sha256:' + createHash('sha256').update(direct.bytes).digest('hex') !== file.byteDigest
      || entry.device !== direct.device
      || entry.inode !== direct.inode
    ) {
      throw new GitHookTransitionConflict(label + ' file identity or bytes changed; deletion was retained');
    }
    assertRetainedDirectoryChainCurrent(commonRoot, label + ' parent fence');
    const before = assertRetainedDirectoryChainCurrent(current, label + ' file root');
    deleteRetainedEntryBounded({
      root: before.target,
      relativePath: file.name,
      kind: 'file',
      device: file.device,
      inode: file.inode,
      ancestorDirectories: []
    }, label + ' file');
  }
  const parent = assertRetainedDirectoryChainCurrent(commonRoot, label + ' parent');
  deleteRetainedEntryBounded({
    root: parent.target,
    relativePath: path.basename(evidence.path),
    kind: 'directory',
    device: evidence.chain.target.device,
    inode: evidence.chain.target.inode,
    ancestorDirectories: []
  }, label + ' root');
  if (
    inspectExactNoFollowDirectoryPresence(
      path.join(parent.target.path, path.basename(evidence.path)),
      label + ' readback'
    ).state !== 'absent'
  ) {
    throw new GitHookTransitionConflict(label + ' generation remained after retained deletion');
  }
}

async function createAndPublishGeneration(
  commonRoot: PhysicalDirectoryChain,
  generationName: string,
  snapshots: readonly ManagedHookSnapshot[],
  source: SourceContext,
  beforePublication?: (commonRootPath: string) => void
): Promise<PhysicalDirectoryChain> {
  const budget = currentGitInvocationBudget();
  budget.assertWithin('Managed generation publication start');
  assertRetainedDirectoryChainCurrent(commonRoot, 'Managed generation publication parent');
  assertSourcePhysicalCurrent(source, 'Managed generation publication');
  beforePublication?.(commonRoot.target.path);
  assertRetainedDirectoryChainCurrent(commonRoot, 'Managed generation publication parent fence');
  const generationPath = path.join(commonRoot.target.path, generationName);
  let generation: PhysicalDirectoryChain;
  try {
    const identity = createExclusiveNoFollowDirectory(commonRoot.target, generationName);
    budget.assertWithin('Managed generation namespace creation completion');
    generation = inspectNoFollowDirectoryChain(identity.path, 'Managed generation publication root');
  } catch (error) {
    throw asTransition(error);
  }
  try {
    assertSourcePhysicalCurrent(source, 'Managed generation publication');
    assertRetainedDirectoryChainCurrent(commonRoot, 'Managed generation publication parent effect fence');
    for (const snapshot of snapshots) {
      const publication = publishExclusiveDurableCanonicalFile({
        parent: generation.target,
        name: snapshot.name,
        bytes: snapshot.deployedBytes,
        validate: (bytes) => {
          if (!Buffer.from(bytes).equals(snapshot.deployedBytes)) {
            throw new Error('Managed hook publication bytes differ from the frozen snapshot');
          }
        }
      });
      budget.assertWithin('Managed hook file publication completion');
      if (!publication.created) {
        throw new GitHookTransitionConflict('Managed hook publication unexpectedly adopted an existing file');
      }
      if (process.platform !== 'win32') {
        const before = inspectNoFollowDirectoryChain(
          generation.target.path,
          'Managed hook mode publication root'
        );
        await chmod(path.join(generation.target.path, snapshot.name), 0o755);
        budget.assertWithin('Managed hook mode publication completion');
        const after = inspectNoFollowDirectoryChain(
          generation.target.path,
          'Managed hook mode publication readback'
        );
        if (!sameChain(before, after)) {
          throw new GitHookTransitionConflict('Managed hook mode publication ancestor changed');
        }
      }
    }
    assertSourcePhysicalCurrent(source, 'Managed generation publication');
    assertRetainedDirectoryChainCurrent(commonRoot, 'Managed generation publication parent readback');
    const inspected = await inspectManagedGeneration(generationPath, snapshots);
    if (inspected.state !== 'ready' || inspected.chain === null) {
      throw new GitHookTransitionConflict('Managed generation final physical readback was not ready');
    }
    return inspected.chain;
  } catch (error) {
    try {
      deleteOwnedGeneration(commonRoot, generation, snapshots);
    } catch (cleanupError) {
      throw new GitHookTransitionConflict(
        'Managed generation publication failed and private generation cleanup was not proven: '
        + errorMessage(cleanupError)
      );
    }
    throw asTransition(error);
  }
}

function deterministicUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 32);
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-'
    + hex.slice(16, 20) + '-' + hex.slice(20, 32);
}

async function planManagedGenerationPath(
  commonRoot: PhysicalDirectoryChain,
  binding: string,
  snapshots: readonly ManagedHookSnapshot[],
  preferredGeneration: string | null
): Promise<Readonly<{ digest: string; path: string }>> {
  const digest = managedGenerationDigest(snapshots, binding);
  const primaryPath = path.join(commonRoot.target.path, 'generation-' + digest);
  const preferredPath = preferredGeneration !== null
    && pathWithin(commonRoot.target.path, preferredGeneration)
    && generationNameMatchesDigest(preferredGeneration, digest)
    ? preferredGeneration
    : null;
  let primary: ManagedGenerationInspection | null = null;
  if (preferredPath !== null) {
    const preferredInspection = await inspectManagedGeneration(preferredPath, snapshots);
    if (preferredInspection.state === 'ready') {
      return Object.freeze({ digest, path: preferredPath });
    }
    if (canonicalPath(preferredPath) === canonicalPath(primaryPath)) primary = preferredInspection;
  }
  primary ??= await inspectManagedGeneration(primaryPath, snapshots);
  if (primary.state === 'ready') return Object.freeze({ digest, path: primaryPath });
  const fallbackPath = path.join(
    commonRoot.target.path,
    'generation-' + digest + '-' + deterministicUuid(binding + '\0' + digest)
  );
  const candidatePath = primary.state === 'missing' ? primaryPath : fallbackPath;
  const candidateInspection = candidatePath === primaryPath
    ? primary
    : await inspectManagedGeneration(candidatePath, snapshots);
  if (candidateInspection.state === 'ready') {
    return Object.freeze({ digest, path: candidatePath });
  }
  return Object.freeze({ digest, path: candidatePath });
}

function makeGenerationPlan(
  planned: Readonly<{ digest: string; path: string }>,
  snapshots: readonly ManagedHookSnapshot[]
): ConfigTransitionGenerationPlan {
  if (!path.isAbsolute(planned.path) || !generationNameMatchesDigest(planned.path, planned.digest)) {
    throw new GitHookTransitionConflict('Managed generation plan is not an exact digest-bound path');
  }
  return Object.freeze({
    path: planned.path,
    digest: planned.digest,
    fingerprint: sourceFingerprint(snapshots),
    files: Object.freeze(snapshots.map((snapshot) => Object.freeze({
      name: snapshot.name,
      size: snapshot.deployedBytes.byteLength,
      byteDigest: 'sha256:' + createHash('sha256').update(snapshot.deployedBytes).digest('hex')
    })))
  });
}

function generationPlanFromEvidence(
  evidence: GenerationPhysicalEvidence,
  digest: string,
  fingerprint: string
): ConfigTransitionGenerationPlan {
  if (!generationNameMatchesDigest(evidence.path, digest) || !/^[0-9a-f]{64}$/u.test(fingerprint)) {
    throw new GitHookTransitionConflict('Managed generation evidence cannot reconstruct its prepared plan');
  }
  return Object.freeze({
    path: evidence.path,
    digest,
    fingerprint,
    files: Object.freeze(evidence.files.map((file) => Object.freeze({
      name: file.name,
      size: file.size,
      byteDigest: file.byteDigest
    })))
  });
}

async function materializeManagedGeneration(
  commonRoot: PhysicalDirectoryChain,
  binding: string,
  snapshots: readonly ManagedHookSnapshot[],
  source: SourceContext,
  preferredGeneration: string | null,
  expectedGenerationPath: string | null = null,
  beforePublication?: (commonRootPath: string) => void
): Promise<GenerationMaterialization> {
  const digest = managedGenerationDigest(snapshots, binding);
  const primaryPath = path.join(commonRoot.target.path, 'generation-' + digest);
  const preferredPath = preferredGeneration !== null
    && pathWithin(commonRoot.target.path, preferredGeneration)
    && generationNameMatchesDigest(preferredGeneration, digest)
    ? preferredGeneration
    : null;
  const asReady = (
    candidate: string,
    inspection: ManagedGenerationInspection
  ): GenerationMaterialization | null => {
    if (inspection.state === 'ready' && inspection.chain !== null) {
      return Object.freeze({ chain: inspection.chain, digest, path: candidate });
    }
    return null;
  };
  const assertExpectedPath = (candidate: string): void => {
    if (
      expectedGenerationPath !== null
      && canonicalPath(expectedGenerationPath) !== canonicalPath(candidate)
    ) {
      throw new GitHookTransitionConflict(
        'Managed generation publication diverged from its durable prepared path'
      );
    }
  };
  let primary: ManagedGenerationInspection | null = null;
  if (preferredPath !== null) {
    const preferredInspection = await inspectManagedGeneration(preferredPath, snapshots);
    const preferred = asReady(preferredPath, preferredInspection);
    if (preferred !== null) {
      assertExpectedPath(preferredPath);
      return preferred;
    }
    if (canonicalPath(preferredPath) === canonicalPath(primaryPath)) {
      primary = preferredInspection;
    }
  }
  primary ??= await inspectManagedGeneration(primaryPath, snapshots);
  const primaryReady = asReady(primaryPath, primary);
  if (primaryReady !== null) {
    assertExpectedPath(primaryPath);
    return primaryReady;
  }
  const fallbackPath = path.join(
    commonRoot.target.path,
    'generation-' + digest + '-' + deterministicUuid(binding + '\0' + digest)
  );
  const candidatePath = primary.state === 'missing' ? primaryPath : fallbackPath;
  const candidateInspection = candidatePath === primaryPath
    ? primary
    : await inspectManagedGeneration(candidatePath, snapshots);
  assertExpectedPath(candidatePath);
  const candidateReady = asReady(candidatePath, candidateInspection);
  if (candidateReady !== null) return candidateReady;
  if (candidateInspection.state === 'occupied') {
    throw new GitHookTransitionConflict('Managed generation candidate is occupied by a different physical value');
  }
  try {
    const chain = await createAndPublishGeneration(
      commonRoot,
      path.basename(candidatePath),
      snapshots,
      source,
      beforePublication
    );
    return Object.freeze({ chain, digest, path: candidatePath });
  } catch (error) {
    if (candidatePath === primaryPath) {
      const racedInspection = await inspectManagedGeneration(candidatePath, snapshots);
      const raced = asReady(candidatePath, racedInspection);
      if (raced !== null) return raced;
    }
    throw error;
  }
}

function firstRealHook(hooksPath: string): string | null {
  const budget = currentGitInvocationBudget();
  budget.assertWithin('Default Git hooks inventory start');
  const parent = inspectNoFollowDirectoryChain(
    path.dirname(hooksPath),
    'Default Git hooks parent'
  );
  const presence = inspectExactNoFollowDirectoryPresence(hooksPath, 'Default Git hooks directory');
  const directory = presence.state === 'present' ? presence.directory : null;
  if (directory === null) {
    assertRetainedDirectoryChainCurrent(parent, 'Default Git hooks parent readback');
    return null;
  }
  const retainedDirectory = inspectNoFollowDirectoryChain(
    hooksPath,
    'Default Git hooks directory chain'
  );
  if (
    !sameChain(directory, retainedDirectory)
    || !retainedDirectory.ancestors.some((ancestor) => sameIdentity(ancestor, parent.target))
  ) {
    throw new GitHookTransitionConflict('Default Git hooks directory escaped its retained parent');
  }
  const entries = scanNoFollowDirectoryTreeMetadata(directory.target, {
    deadlineAtMs: budget.deadlineAt,
    maximumEntries: 4096
  });
  budget.assertWithin('Default Git hooks inventory completion');
  const hook = entries.find((entry) => (
    !entry.relativePath.includes('/')
    && !entry.relativePath.endsWith('.sample')
  ));
  assertRetainedDirectoryChainCurrent(retainedDirectory, 'Default Git hooks directory readback');
  assertRetainedDirectoryChainCurrent(parent, 'Default Git hooks parent readback');
  return hook === undefined ? null : path.join(hooksPath, hook.relativePath);
}

function observeOptionalConfigFile(
  parent: PhysicalDirectoryChain,
  name: string,
  label: string
): PhysicalFileObservation {
  try {
    const direct = readRetainedFile(parent, name, label);
    if (direct === null) {
      return Object.freeze({
        state: 'absent',
        device: null,
        inode: null,
        size: null,
        byteDigest: null
      });
    }
    if (direct.bytes === null) throw new GitHookTransitionConflict(label + ' has no readable bytes');
    return Object.freeze({
      state: 'present',
      device: direct.device,
      inode: direct.inode,
      size: direct.size,
      byteDigest: 'sha256:' + createHash('sha256').update(direct.bytes).digest('hex')
    });
  } catch (error) {
    if (error instanceof GitHookTransitionConflict) throw error;
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH') {
      throw new GitHookTransitionConflict(label + ' is not an ordinary file');
    }
    throw error;
  }
}

function assertConfigPhysicalBoundary(
  repoRoot: string,
  commonGitDir: string,
  worktreeGitDir: string,
  worktreeConfigPath: string
): ConfigPhysicalBoundary {
  const repoRootChain = inspectNoFollowDirectoryChain(repoRoot, 'Git config repository root');
  const common = inspectNoFollowDirectoryChain(commonGitDir, 'Repository-common Git directory');
  const worktree = inspectNoFollowDirectoryChain(worktreeGitDir, 'Worktree Git directory');
  if (!pathWithin(worktree.target.path, worktreeConfigPath)) {
    throw new GitHookTransitionConflict('Git worktree config path escaped the retained worktree Git directory');
  }
  const commonConfigParent = inspectNoFollowDirectoryChain(
    path.dirname(path.join(common.target.path, 'config')),
    'Repository-common Git config parent'
  );
  const worktreeConfigParent = inspectNoFollowDirectoryChain(
    path.dirname(worktreeConfigPath),
    'Worktree Git config parent'
  );
  const commonConfig = observeOptionalConfigFile(
    commonConfigParent,
    'config',
    'Repository-common Git config'
  );
  const worktreeConfig = observeOptionalConfigFile(
    worktreeConfigParent,
    path.basename(worktreeConfigPath),
    'Worktree Git config'
  );
  return Object.freeze({
    repoRoot: repoRootChain,
    commonGitDir: common,
    worktreeGitDir: worktree,
    commonConfigParent,
    worktreeConfigParent,
    commonConfig,
    worktreeConfig
  });
}

async function configStateFromGit(
  repoRoot: string,
  worktreeConfigPath: string,
  boundary: ConfigPhysicalBoundary
): Promise<HookConfigState> {
  const localRaw = await gitText(
    repoRoot,
    [
      'config',
      '--local',
      '--null',
      '--get-regexp',
      '^(extensions\\.worktreeconfig|core\\.hookspath)$'
    ],
    { allowMissing: true }
  );
  let worktreeConfig: string | null = null;
  let commonHooksPath: string | null = null;
  if (localRaw !== null) {
    const records = localRaw.split('\0').filter((record) => record.length > 0);
    for (const record of records) {
      const separator = record.indexOf('\n');
      if (separator < 0) {
        throw new GitHookTransitionConflict('Git local config machine output is not key/value paired');
      }
      const key = record.slice(0, separator).toLocaleLowerCase('en-US');
      const value = record.slice(separator + 1);
      if (key === 'extensions.worktreeconfig') {
        if (worktreeConfig !== null) {
          throw new GitHookTransitionConflict('Git local extensions.worktreeConfig has duplicate values');
        }
        const normalized = value.toLocaleLowerCase('en-US');
        if (['true', 'yes', 'on', '1'].includes(normalized)) worktreeConfig = 'true';
        else if (['false', 'no', 'off', '0'].includes(normalized)) worktreeConfig = 'false';
        else throw new GitHookTransitionConflict('Git local extensions.worktreeConfig is not a canonical boolean');
      } else if (key === 'core.hookspath') {
        if (commonHooksPath !== null) {
          throw new GitHookTransitionConflict('Git local core.hooksPath has duplicate values');
        }
        commonHooksPath = value;
      } else {
        throw new GitHookTransitionConflict('Git local config returned an unexpected key');
      }
    }
  }
  const worktreeRaw = await gitText(
    repoRoot,
    ['config', '--file', worktreeConfigPath, '--null', '--get', 'core.hooksPath'],
    { allowMissing: true }
  );
  const worktreeHooksPath = worktreeRaw === null
    ? null
    : worktreeRaw.endsWith('\0') ? worktreeRaw.slice(0, -1) : worktreeRaw;
  if (boundary.commonConfig.state === 'present' && boundary.commonConfig.byteDigest === null) {
    throw new GitHookTransitionConflict('Repository-common Git config physical observation is incomplete');
  }
  if (boundary.worktreeConfig.state === 'present' && boundary.worktreeConfig.byteDigest === null) {
    throw new GitHookTransitionConflict('Worktree Git config physical observation is incomplete');
  }
  return Object.freeze({ worktreeConfig, commonHooksPath, worktreeHooksPath });
}

async function readHookConfigObservation(
  repoRoot: string,
  commonGitDir: string,
  worktreeGitDir: string,
  worktreeConfigPath: string
): Promise<ConfigObservation> {
  const boundary = assertConfigPhysicalBoundary(
    repoRoot,
    commonGitDir,
    worktreeGitDir,
    worktreeConfigPath
  );
  return Object.freeze({
    state: await configStateFromGit(repoRoot, worktreeConfigPath, boundary),
    boundary
  });
}

function sameHookConfigState(left: HookConfigState, right: HookConfigState): boolean {
  return left.worktreeConfig === right.worktreeConfig
    && left.commonHooksPath === right.commonHooksPath
    && left.worktreeHooksPath === right.worktreeHooksPath;
}

function sameHookMarker(left: HookMarkerRecord, right: HookMarkerRecord): boolean {
  return left.digest === right.digest
    && left.fingerprint === right.fingerprint
    && left.generationName === right.generationName;
}

function ownKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new GitHookTransitionConflict(label + ' has a non-canonical shape');
  }
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new GitHookTransitionConflict(label + ' is not an object');
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new GitHookTransitionConflict(label + ' is not a string');
  return value;
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(canonicalJson(value)) + '\n', 'utf8');
}

function stateRecord(state: HookConfigState): HookConfigState {
  return Object.freeze({
    worktreeConfig: state.worktreeConfig,
    commonHooksPath: state.commonHooksPath,
    worktreeHooksPath: state.worktreeHooksPath
  });
}

function parseHookConfigState(value: unknown, label: string): HookConfigState {
  const record = recordValue(value, label);
  ownKeys(record, ['worktreeConfig', 'commonHooksPath', 'worktreeHooksPath'], label);
  for (const key of ['worktreeConfig', 'commonHooksPath', 'worktreeHooksPath'] as const) {
    if (record[key] !== null && typeof record[key] !== 'string') {
      throw new GitHookTransitionConflict(label + '.' + key + ' is not nullable string');
    }
  }
  return stateRecord({
    worktreeConfig: record.worktreeConfig as string | null,
    commonHooksPath: record.commonHooksPath as string | null,
    worktreeHooksPath: record.worktreeHooksPath as string | null
  });
}

function parseHookMarkerRecord(value: unknown, label: string): HookMarkerRecord {
  const record = recordValue(value, label);
  ownKeys(record, ['digest', 'fingerprint', 'generationName'], label);
  const digest = stringValue(record.digest, label + '.digest');
  const fingerprint = stringValue(record.fingerprint, label + '.fingerprint');
  const generationName = stringValue(record.generationName, label + '.generationName');
  if (
    !/^[0-9a-f]{64}$/u.test(digest)
    || !/^[0-9a-f]{64}$/u.test(fingerprint)
    || !MANAGED_GENERATION_NAME.test(generationName)
  ) {
    throw new GitHookTransitionConflict(label + ' contains an invalid marker identity');
  }
  return Object.freeze({ digest, fingerprint, generationName });
}

function parseGenerationPhysicalEvidence(
  value: unknown,
  label: string
): GenerationPhysicalEvidence {
  const record = recordValue(value, label);
  ownKeys(record, ['path', 'chain', 'files'], label);
  const pathName = stringValue(record.path, label + '.path');
  if (!path.isAbsolute(pathName)) {
    throw new GitHookTransitionConflict(label + '.path is not absolute');
  }
  const chain = parsePhysicalChain(record.chain, label + '.chain');
  if (!Array.isArray(record.files) || record.files.length !== MANAGED_GENERATION_NAMES.length) {
    throw new GitHookTransitionConflict(label + '.files has an invalid count');
  }
  const files = record.files.map((value, index) => {
    const fileLabel = label + '.files[' + index + ']';
    const file = recordValue(value, fileLabel);
    ownKeys(file, ['name', 'device', 'inode', 'size', 'byteDigest'], fileLabel);
    const name = stringValue(file.name, fileLabel + '.name');
    if (name !== MANAGED_GENERATION_NAMES[index]) {
      throw new GitHookTransitionConflict(fileLabel + '.name is not in canonical generation order');
    }
    const device = stringValue(file.device, fileLabel + '.device');
    const inode = stringValue(file.inode, fileLabel + '.inode');
    const size = file.size;
    const byteDigest = stringValue(file.byteDigest, fileLabel + '.byteDigest');
    if (
      device.length === 0
      || inode.length === 0
      || !Number.isSafeInteger(size)
      || (size as number) < 0
      || !/^sha256:[0-9a-f]{64}$/u.test(byteDigest)
    ) {
      throw new GitHookTransitionConflict(fileLabel + ' has invalid physical file evidence');
    }
    return Object.freeze({ name, device, inode, size: size as number, byteDigest });
  });
  if (canonicalPath(chain.target.path) !== canonicalPath(pathName)) {
    throw new GitHookTransitionConflict(label + '.chain does not target .path');
  }
  return Object.freeze({ path: pathName, chain, files: Object.freeze(files) });
}

function parseGenerationPlan(
  value: unknown,
  label: string
): ConfigTransitionGenerationPlan {
  const record = recordValue(value, label);
  ownKeys(record, ['path', 'digest', 'fingerprint', 'files'], label);
  const pathName = stringValue(record.path, label + '.path');
  const digest = stringValue(record.digest, label + '.digest');
  const fingerprint = stringValue(record.fingerprint, label + '.fingerprint');
  if (
    !path.isAbsolute(pathName)
    || !/^[0-9a-f]{64}$/u.test(digest)
    || !generationNameMatchesDigest(pathName, digest)
    || !/^[0-9a-f]{64}$/u.test(fingerprint)
  ) {
    throw new GitHookTransitionConflict(label + ' is not an exact digest-bound generation plan');
  }
  if (!Array.isArray(record.files) || record.files.length !== MANAGED_GENERATION_NAMES.length) {
    throw new GitHookTransitionConflict(label + '.files has an invalid count');
  }
  const files = record.files.map((value, index) => {
    const fileLabel = label + '.files[' + index + ']';
    const file = recordValue(value, fileLabel);
    ownKeys(file, ['name', 'size', 'byteDigest'], fileLabel);
    const name = stringValue(file.name, fileLabel + '.name');
    const size = file.size;
    const byteDigest = stringValue(file.byteDigest, fileLabel + '.byteDigest');
    if (
      name !== MANAGED_GENERATION_NAMES[index]
      || !Number.isSafeInteger(size)
      || (size as number) < 0
      || !/^sha256:[0-9a-f]{64}$/u.test(byteDigest)
    ) {
      throw new GitHookTransitionConflict(fileLabel + ' contains invalid planned file identity');
    }
    return Object.freeze({ name, size: size as number, byteDigest });
  });
  return Object.freeze({ path: pathName, digest, fingerprint, files: Object.freeze(files) });
}

function parsePriorGenerationEvidenceList(
  value: unknown,
  commonRoot: string,
  label: string
): readonly PriorGenerationEvidence[] {
  if (!Array.isArray(value)) {
    throw new GitHookTransitionConflict(label + ' is not an array');
  }
  return Object.freeze(value.map((entryValue, index) => {
    const priorLabel = label + '[' + index + ']';
    const prior = recordValue(entryValue, priorLabel);
    ownKeys(prior, ['digest', 'evidence'], priorLabel);
    const digest = stringValue(prior.digest, priorLabel + '.digest');
    if (!/^[0-9a-f]{64}$/u.test(digest)) {
      throw new GitHookTransitionConflict(priorLabel + '.digest is invalid');
    }
    const evidence = parseGenerationPhysicalEvidence(prior.evidence, priorLabel + '.evidence');
    if (!generationNameMatchesDigest(evidence.path, digest) || !pathWithin(commonRoot, evidence.path)) {
      throw new GitHookTransitionConflict(priorLabel + ' path does not match its digest');
    }
    return Object.freeze({ digest, evidence });
  }));
}

function parseConfigTransitionPreparedIntent(
  bytes: Uint8Array,
  label: string
): ConfigTransitionPreparedIntent {
  const record = parseCanonicalJson(bytes, label);
  ownKeys(record, [
    'schema',
    'operationDigest',
    'commonRoot',
    'commonRootKey',
    'repoRoot',
    'commonGitDir',
    'worktreeGitDir',
    'worktreeConfigPath',
    'preimage',
    'target',
    'initialBoundary',
    'markerRoot',
    'bootstrapMarkerRoot',
    'marker',
    'bootstrapMarker',
    'generation',
    'bootstrapGeneration',
    'priorGenerations'
  ], label);
  if (record.schema !== 'sec-managed-hook-config-prepared-v1') {
    throw new GitHookTransitionConflict(label + ' schema is not recognized');
  }
  const operationDigest = stringValue(record.operationDigest, label + '.operationDigest');
  if (!/^[0-9a-f]{64}$/u.test(operationDigest)) {
    throw new GitHookTransitionConflict(label + '.operationDigest is invalid');
  }
  const commonRoot = stringValue(record.commonRoot, label + '.commonRoot');
  const repoRoot = stringValue(record.repoRoot, label + '.repoRoot');
  const commonGitDir = stringValue(record.commonGitDir, label + '.commonGitDir');
  const worktreeGitDir = stringValue(record.worktreeGitDir, label + '.worktreeGitDir');
  const worktreeConfigPath = stringValue(record.worktreeConfigPath, label + '.worktreeConfigPath');
  if ([commonRoot, repoRoot, commonGitDir, worktreeGitDir, worktreeConfigPath].some((value) => !path.isAbsolute(value))) {
    throw new GitHookTransitionConflict(label + ' contains a non-absolute path');
  }
  const candidate = Object.freeze({
    schema: 'sec-managed-hook-config-prepared-v1' as const,
    operationDigest,
    commonRoot,
    commonRootKey: stringValue(record.commonRootKey, label + '.commonRootKey'),
    repoRoot,
    commonGitDir,
    worktreeGitDir,
    worktreeConfigPath,
    preimage: parseHookConfigState(record.preimage, label + '.preimage'),
    target: parseHookConfigState(record.target, label + '.target'),
    initialBoundary: parseConfigPhysicalBoundary(record.initialBoundary, label + '.initialBoundary'),
    markerRoot: parsePhysicalChain(record.markerRoot, label + '.markerRoot'),
    bootstrapMarkerRoot: parsePhysicalChain(record.bootstrapMarkerRoot, label + '.bootstrapMarkerRoot'),
    marker: parseHookMarkerRecord(record.marker, label + '.marker'),
    bootstrapMarker: parseHookMarkerRecord(record.bootstrapMarker, label + '.bootstrapMarker'),
    generation: parseGenerationPlan(record.generation, label + '.generation'),
    bootstrapGeneration: parseGenerationPlan(record.bootstrapGeneration, label + '.bootstrapGeneration'),
    priorGenerations: parsePriorGenerationEvidenceList(
      record.priorGenerations,
      commonRoot,
      label + '.priorGenerations'
    )
  });
  if (!Buffer.from(bytes).equals(jsonBytes(candidate))) {
    throw new GitHookTransitionConflict(label + ' is not canonically encoded');
  }
  return candidate;
}

function parsePhysicalIdentity(value: unknown, label: string): PhysicalDirectoryIdentity {
  const record = recordValue(value, label);
  ownKeys(record, ['path', 'finalPath', 'device', 'inode', 'objectId'], label);
  const pathName = stringValue(record.path, label + '.path');
  const finalPath = stringValue(record.finalPath, label + '.finalPath');
  if (!path.isAbsolute(pathName) || !path.isAbsolute(finalPath)) {
    throw new GitHookTransitionConflict(label + ' contains a non-absolute path');
  }
  return Object.freeze({
    path: pathName,
    finalPath,
    device: stringValue(record.device, label + '.device'),
    inode: stringValue(record.inode, label + '.inode'),
    objectId: stringValue(record.objectId, label + '.objectId')
  });
}

function parsePhysicalChain(value: unknown, label: string): PhysicalDirectoryChain {
  const record = recordValue(value, label);
  ownKeys(record, ['target', 'ancestors'], label);
  if (!Array.isArray(record.ancestors) || record.ancestors.length === 0) {
    throw new GitHookTransitionConflict(label + '.ancestors is empty or not an array');
  }
  const target = parsePhysicalIdentity(record.target, label + '.target');
  const ancestors = Object.freeze(record.ancestors.map((entry, index) => (
    parsePhysicalIdentity(entry, label + '.ancestors[' + index + ']')
  )));
  if (!sameIdentity(target, ancestors.at(-1)!)) {
    throw new GitHookTransitionConflict(label + ' target is not its final ancestor');
  }
  return Object.freeze({ target, ancestors });
}

function parsePhysicalFileObservation(value: unknown, label: string): PhysicalFileObservation {
  const record = recordValue(value, label);
  ownKeys(record, ['state', 'device', 'inode', 'size', 'byteDigest'], label);
  const state = record.state;
  if (state !== 'absent' && state !== 'present') {
    throw new GitHookTransitionConflict(label + '.state is invalid');
  }
  if (state === 'absent') {
    if (record.device !== null || record.inode !== null || record.size !== null || record.byteDigest !== null) {
      throw new GitHookTransitionConflict(label + ' absent observation carries present identity');
    }
    return Object.freeze({ state, device: null, inode: null, size: null, byteDigest: null });
  }
  if (typeof record.device !== 'string' || typeof record.inode !== 'string'
      || !Number.isSafeInteger(record.size) || (record.size as number) < 0
      || typeof record.byteDigest !== 'string'
      || !/^sha256:[0-9a-f]{64}$/u.test(record.byteDigest)) {
    throw new GitHookTransitionConflict(label + ' present observation is invalid');
  }
  return Object.freeze({
    state,
    device: record.device,
    inode: record.inode,
    size: record.size as number,
    byteDigest: record.byteDigest
  });
}

function parseConfigPhysicalBoundary(value: unknown, label: string): ConfigPhysicalBoundary {
  const record = recordValue(value, label);
  ownKeys(record, [
    'repoRoot',
    'commonGitDir',
    'worktreeGitDir',
    'commonConfigParent',
    'worktreeConfigParent',
    'commonConfig',
    'worktreeConfig'
  ], label);
  return Object.freeze({
    repoRoot: parsePhysicalChain(record.repoRoot, label + '.repoRoot'),
    commonGitDir: parsePhysicalChain(record.commonGitDir, label + '.commonGitDir'),
    worktreeGitDir: parsePhysicalChain(record.worktreeGitDir, label + '.worktreeGitDir'),
    commonConfigParent: parsePhysicalChain(record.commonConfigParent, label + '.commonConfigParent'),
    worktreeConfigParent: parsePhysicalChain(record.worktreeConfigParent, label + '.worktreeConfigParent'),
    commonConfig: parsePhysicalFileObservation(record.commonConfig, label + '.commonConfig'),
    worktreeConfig: parsePhysicalFileObservation(record.worktreeConfig, label + '.worktreeConfig')
  });
}

function configBoundaryKey(boundary: ConfigPhysicalBoundary): string {
  return JSON.stringify(boundary);
}

function configStepDefinitions(): readonly Readonly<{
  readonly scope: 'local' | 'worktree';
  readonly key: keyof HookConfigState;
  readonly configKey: string;
}>[] {
  return Object.freeze([
    { scope: 'local', key: 'worktreeConfig', configKey: 'extensions.worktreeConfig' },
    { scope: 'local', key: 'commonHooksPath', configKey: 'core.hooksPath' },
    { scope: 'worktree', key: 'worktreeHooksPath', configKey: 'core.hooksPath' }
  ] as const);
}

function makeConfigTransitionSteps(
  preimage: HookConfigState,
  target: HookConfigState
): readonly ConfigTransitionStep[] {
  let before = stateRecord(preimage);
  const steps: ConfigTransitionStep[] = [];
  for (const [index, definition] of configStepDefinitions().entries()) {
    const value = target[definition.key];
    if (typeof value !== 'string') {
      throw new GitHookTransitionConflict('Git hook config target is missing ' + definition.configKey);
    }
    const after = stateRecord({ ...before, [definition.key]: value });
    steps.push(Object.freeze({
      index,
      scope: definition.scope,
      key: definition.key,
      configKey: definition.configKey,
      value,
      before,
      after
    }));
    before = after;
  }
  return Object.freeze(steps);
}

function makeConfigTransitionIntent(input: {
  readonly operationDigest: string;
  readonly commonRoot: PhysicalDirectoryChain;
  readonly repoRoot: string;
  readonly commonGitDir: string;
  readonly worktreeGitDir: string;
  readonly worktreeConfigPath: string;
  readonly preimage: HookConfigState;
  readonly target: HookConfigState;
  readonly initialBoundary: ConfigPhysicalBoundary;
  readonly markerRoot: PhysicalDirectoryChain;
  readonly bootstrapMarkerRoot: PhysicalDirectoryChain;
  readonly marker: HookMarkerRecord;
  readonly bootstrapMarker: HookMarkerRecord;
  readonly generation: GenerationPhysicalEvidence;
  readonly bootstrapGeneration: GenerationPhysicalEvidence;
  readonly priorGenerations: readonly PriorGenerationEvidence[];
}): ConfigTransitionIntent {
  return Object.freeze({
    schema: 'sec-managed-hook-config-transition-v1',
    operationDigest: input.operationDigest,
    commonRoot: input.commonRoot.target.path,
    commonRootKey: physicalChainKey(input.commonRoot),
    repoRoot: input.repoRoot,
    commonGitDir: input.commonGitDir,
    worktreeGitDir: input.worktreeGitDir,
    worktreeConfigPath: input.worktreeConfigPath,
    preimage: stateRecord(input.preimage),
    target: stateRecord(input.target),
    initialBoundary: input.initialBoundary,
    markerRoot: input.markerRoot,
    bootstrapMarkerRoot: input.bootstrapMarkerRoot,
    marker: input.marker,
    bootstrapMarker: input.bootstrapMarker,
    generation: input.generation,
    bootstrapGeneration: input.bootstrapGeneration,
    priorGenerations: Object.freeze(input.priorGenerations.map((prior) => Object.freeze({
      digest: prior.digest,
      evidence: prior.evidence
    }))),
    steps: makeConfigTransitionSteps(input.preimage, input.target)
  });
}

function makeConfigTransitionPreparedIntent(input: {
  readonly operationDigest: string;
  readonly commonRoot: PhysicalDirectoryChain;
  readonly repoRoot: string;
  readonly commonGitDir: string;
  readonly worktreeGitDir: string;
  readonly worktreeConfigPath: string;
  readonly preimage: HookConfigState;
  readonly target: HookConfigState;
  readonly initialBoundary: ConfigPhysicalBoundary;
  readonly markerRoot: PhysicalDirectoryChain;
  readonly bootstrapMarkerRoot: PhysicalDirectoryChain;
  readonly marker: HookMarkerRecord;
  readonly bootstrapMarker: HookMarkerRecord;
  readonly generation: ConfigTransitionGenerationPlan;
  readonly bootstrapGeneration: ConfigTransitionGenerationPlan;
  readonly priorGenerations: readonly PriorGenerationEvidence[];
}): ConfigTransitionPreparedIntent {
  return Object.freeze({
    schema: 'sec-managed-hook-config-prepared-v1',
    operationDigest: input.operationDigest,
    commonRoot: input.commonRoot.target.path,
    commonRootKey: physicalChainKey(input.commonRoot),
    repoRoot: input.repoRoot,
    commonGitDir: input.commonGitDir,
    worktreeGitDir: input.worktreeGitDir,
    worktreeConfigPath: input.worktreeConfigPath,
    preimage: stateRecord(input.preimage),
    target: stateRecord(input.target),
    initialBoundary: input.initialBoundary,
    markerRoot: input.markerRoot,
    bootstrapMarkerRoot: input.bootstrapMarkerRoot,
    marker: input.marker,
    bootstrapMarker: input.bootstrapMarker,
    generation: input.generation,
    bootstrapGeneration: input.bootstrapGeneration,
    priorGenerations: Object.freeze(input.priorGenerations.map((prior) => Object.freeze({
      digest: prior.digest,
      evidence: prior.evidence
    })))
  });
}

function transitionDirectoryName(operationDigest: string): string {
  if (!/^[0-9a-f]{64}$/u.test(operationDigest)) {
    throw new GitHookTransitionConflict('Config transition operation digest is invalid');
  }
  return CONFIG_TRANSITION_DIRECTORY_PREFIX + operationDigest;
}

function transitionFileBytes(chain: PhysicalDirectoryChain, name: string): Buffer | null {
  try {
    const entry = readRetainedFile(chain, name, 'Config transition file ' + name);
    if (entry === null) return null;
    if (entry.bytes === null) {
      throw new GitHookTransitionConflict('Config transition file has no readable bytes: ' + name);
    }
    return Buffer.from(entry.bytes);
  } catch (error) {
    if (error instanceof GitHookTransitionConflict) throw error;
    throw asTransition(error);
  }
}

function readConfigTransitionPrepared(
  transition: ConfigTransitionHandle
): ConfigTransitionPreparedIntent | null {
  const bytes = transitionFileBytes(transition.chain, CONFIG_TRANSITION_PREPARED_FILE);
  return bytes === null
    ? null
    : parseConfigTransitionPreparedIntent(bytes, 'Git config prepared transition');
}

function assertPreparedIntentMatchesTransition(
  commonRoot: PhysicalDirectoryChain,
  transition: ConfigTransitionHandle,
  label: string
): ConfigTransitionPreparedIntent {
  const prepared = readConfigTransitionPrepared(transition);
  if (prepared === null) {
    throw new GitHookTransitionConflict(label + ' has no durable prepared admission');
  }
  const expected = makeConfigTransitionPreparedIntent({
    operationDigest: transition.intent.operationDigest,
    commonRoot,
    repoRoot: transition.intent.repoRoot,
    commonGitDir: transition.intent.commonGitDir,
    worktreeGitDir: transition.intent.worktreeGitDir,
    worktreeConfigPath: transition.intent.worktreeConfigPath,
    preimage: transition.intent.preimage,
    target: transition.intent.target,
    initialBoundary: transition.intent.initialBoundary,
    markerRoot: transition.intent.markerRoot,
    bootstrapMarkerRoot: transition.intent.bootstrapMarkerRoot,
    marker: transition.intent.marker,
    bootstrapMarker: transition.intent.bootstrapMarker,
    generation: generationPlanFromEvidence(
      transition.intent.generation,
      transition.intent.marker.digest,
      transition.intent.marker.fingerprint
    ),
    bootstrapGeneration: generationPlanFromEvidence(
      transition.intent.bootstrapGeneration,
      transition.intent.bootstrapMarker.digest,
      transition.intent.bootstrapMarker.fingerprint
    ),
    priorGenerations: transition.intent.priorGenerations
  });
  if (!preparedIntentMatches(prepared, expected)) {
    throw new GitHookTransitionConflict(label + ' prepared admission diverged from the durable transition');
  }
  return prepared;
}

function parseCanonicalJson(bytes: Uint8Array, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    throw new GitHookTransitionConflict(label + ' is not valid UTF-8 JSON: ' + errorMessage(error));
  }
  const record = recordValue(parsed, label);
  if (!Buffer.from(bytes).equals(jsonBytes(record))) {
    throw new GitHookTransitionConflict(label + ' is not canonical durable JSON');
  }
  return record;
}

function configFileLockName(configName: string): string {
  return configName + '.lock';
}

function configStageName(operationDigest: string, stepIndex: number): string {
  if (!/^[0-9a-f]{64}$/u.test(operationDigest) || !Number.isSafeInteger(stepIndex) || stepIndex < 0) {
    throw new GitHookTransitionConflict('Git config stage identity is invalid');
  }
  return '.sec-managed-hook-config-' + operationDigest + '-' + stepIndex + '.tmp';
}

function parsePhysicalMutationLeaseOwner(
  value: unknown,
  label: string
): PhysicalMutationLeaseOwner {
  const record = recordValue(value, label);
  ownKeys(record, [
    'schema',
    'host',
    'pid',
    'processNonce',
    'token',
    'createdAtMs',
    'expiresAtMs'
  ], label);
  if (
    record.schema !== 'sec-physical-mutation-lease-v1'
    || typeof record.host !== 'string'
    || record.host.length === 0
    || !Number.isSafeInteger(record.pid)
    || (record.pid as number) <= 0
    || typeof record.processNonce !== 'string'
    || !/^[0-9a-f-]{36}$/u.test(record.processNonce)
    || typeof record.token !== 'string'
    || !/^[0-9a-f-]{36}$/u.test(record.token)
    || !Number.isSafeInteger(record.createdAtMs)
    || (record.createdAtMs as number) < 0
    || !Number.isSafeInteger(record.expiresAtMs)
    || (record.expiresAtMs as number) < (record.createdAtMs as number)
  ) {
    throw new GitHookTransitionConflict(label + ' is not a canonical physical lease owner');
  }
  return Object.freeze({
    schema: 'sec-physical-mutation-lease-v1',
    host: record.host,
    pid: record.pid as number,
    processNonce: record.processNonce,
    token: record.token,
    createdAtMs: record.createdAtMs as number,
    expiresAtMs: record.expiresAtMs as number
  });
}

function parseConfigFileLock(
  bytes: Uint8Array,
  label: string
): ConfigFileLockRecord {
  const record = parseCanonicalJson(bytes, label);
  ownKeys(record, [
    'schema',
    'operationDigest',
    'stepIndex',
    'scope',
    'configPath',
    'configParentKey',
    'configName',
    'stageName',
    'preimage',
    'owner'
  ], label);
  if (
    record.schema !== 'sec-managed-hook-config-lock-v1'
    || typeof record.operationDigest !== 'string'
    || !/^[0-9a-f]{64}$/u.test(record.operationDigest)
    || !Number.isSafeInteger(record.stepIndex)
    || (record.stepIndex as number) < 0
    || (record.scope !== 'local' && record.scope !== 'worktree')
    || typeof record.configPath !== 'string'
    || !path.isAbsolute(record.configPath)
    || typeof record.configParentKey !== 'string'
    || record.configParentKey.length === 0
    || typeof record.configName !== 'string'
    || typeof record.stageName !== 'string'
    || record.stageName !== configStageName(record.operationDigest, record.stepIndex as number)
  ) {
    throw new GitHookTransitionConflict(label + ' has an invalid canonical lock identity');
  }
  return Object.freeze({
    schema: 'sec-managed-hook-config-lock-v1',
    operationDigest: record.operationDigest,
    stepIndex: record.stepIndex as number,
    scope: record.scope,
    configPath: record.configPath,
    configParentKey: record.configParentKey,
    configName: record.configName,
    stageName: record.stageName,
    preimage: parsePhysicalFileObservation(record.preimage, label + '.preimage'),
    owner: parsePhysicalMutationLeaseOwner(record.owner, label + '.owner')
  });
}

function configLockRecordMatches(
  record: ConfigFileLockRecord,
  target: ConfigFileTarget,
  operationDigest: string,
  stepIndex: number
): boolean {
  return record.operationDigest === operationDigest
    && record.stepIndex === stepIndex
    && record.scope === target.scope
    && canonicalPath(record.configPath) === canonicalPath(target.path)
    && record.configParentKey === physicalChainKey(target.parent)
    && record.configName === target.name
    && record.stageName === configStageName(operationDigest, stepIndex)
    && samePhysicalFileObservation(record.preimage, target.expected);
}

function deleteRetainedFileExact(
  parent: PhysicalDirectoryChain,
  name: string,
  expected: ReturnType<typeof inspectNoFollowOrdinaryFileEntry>,
  label: string
): void {
  if (expected === null || expected.bytes === null) {
    throw new GitHookTransitionConflict(label + ' is absent before retained deletion');
  }
  const current = readRetainedFile(parent, name, label + ' readback');
  if (
    current === null
    || current.bytes === null
    || current.device !== expected.device
    || current.inode !== expected.inode
    || !Buffer.from(current.bytes).equals(Buffer.from(expected.bytes))
  ) {
    throw new GitHookTransitionConflict(label + ' was replaced; retained deletion was not attempted');
  }
  deleteRetainedEntryBounded({
    root: parent.target,
    relativePath: name,
    kind: 'file',
    device: expected.device,
    inode: expected.inode,
    ancestorDirectories: []
  }, label);
  if (readRetainedFile(parent, name, label + ' deletion readback') !== null) {
    throw new GitHookTransitionConflict(label + ' remained after retained deletion');
  }
}

function deleteRetainedEntryBounded(
  input: Parameters<typeof deleteRetainedNoFollowEntry>[0],
  label: string
): void {
  const budget = currentGitInvocationBudget();
  budget.assertWithin(label + ' start');
  deleteRetainedNoFollowEntry(input);
  budget.assertWithin(label + ' completion');
}

function releaseConfigFileLock(lock: ConfigFileLockHandle): void {
  deleteRetainedFileExact(
    lock.parent,
    lock.name,
    readRetainedFile(lock.parent, lock.name, 'Git config lock release'),
    'Git config lock release'
  );
}

function cleanupOwnedConfigStage(
  parent: PhysicalDirectoryChain,
  stageName: string,
  label: string
): void {
  const stageLockName = stageName + '.lock';
  const stageLock = readRetainedFile(parent, stageLockName, label + ' stage lock');
  if (stageLock !== null) {
    deleteRetainedFileExact(parent, stageLockName, stageLock, label + ' stage lock cleanup');
  }
  const stage = readRetainedFile(parent, stageName, label + ' stage');
  if (stage !== null) {
    deleteRetainedFileExact(parent, stageName, stage, label + ' stage cleanup');
  }
}

async function assertConfigStageValue(
  repoRoot: string,
  stagePath: string,
  configKey: string,
  expectedValue: string,
  label: string
): Promise<void> {
  const raw = await gitText(
    repoRoot,
    ['config', '--file', stagePath, '--null', '--get', configKey],
    { allowMissing: true }
  );
  const actual = raw === null
    ? null
    : raw.endsWith('\0') ? raw.slice(0, -1) : raw;
  if (actual !== expectedValue) {
    throw new GitHookTransitionConflict(label + ' does not contain the exact requested value');
  }
}

async function writeGitConfigFileValue(
  configFilePath: string,
  key: string,
  value: string,
  provider: GitPhysicalProviderCapability
): Promise<void> {
  const target = await issueGitConfigTargetCapability({ path: configFilePath });
  try {
    const receipt = await replaceAllGitConfigValue({ provider, target, key, value });
    assertGitConfigEffectReceipt(receipt);
  } finally {
    closeGitConfigTargetCapability(target);
  }
}

function acquireConfigFileLock(input: {
  readonly target: ConfigFileTarget;
  readonly operationDigest: string;
  readonly stepIndex: number;
  readonly lease: PhysicalMutationLeaseHandle;
}): ConfigFileLockHandle {
  const lockName = configFileLockName(input.target.name);
  const stageName = configStageName(input.operationDigest, input.stepIndex);
  const record: ConfigFileLockRecord = Object.freeze({
    schema: 'sec-managed-hook-config-lock-v1',
    operationDigest: input.operationDigest,
    stepIndex: input.stepIndex,
    scope: input.target.scope,
    configPath: input.target.path,
    configParentKey: physicalChainKey(input.target.parent),
    configName: input.target.name,
    stageName,
    preimage: input.target.expected,
    owner: input.lease.owner
  });
  const bytes = jsonBytes(record);
  let reclaimed = false;
  let publishedHere = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const published = publishExclusiveDurableCanonicalFile({
        parent: input.target.parent.target,
        name: lockName,
        bytes,
        validate: (candidate) => {
          if (!Buffer.from(candidate).equals(bytes)) {
            throw new Error('Git config lock bytes differ from the operation owner');
          }
        }
      });
      if (!published.created) {
        throw new GitHookTransitionConflict('Git config lock is occupied by an existing owner');
      }
      publishedHere = true;
      const readback = readRetainedFile(input.target.parent, lockName, 'Git config lock publication');
      if (
        readback === null
        || readback.bytes === null
        || readback.device === null
        || readback.inode === null
        || !Buffer.from(readback.bytes).equals(bytes)
      ) {
        throw new GitHookTransitionConflict('Git config lock physical readback differs');
      }
      const handle: ConfigFileLockHandle = Object.freeze({
        parent: input.target.parent,
        name: lockName,
        record,
        bytes,
        release: () => releaseConfigFileLock(handle)
      });
      return handle;
    } catch (error) {
      if (publishedHere) {
        try {
          const ownLock = readRetainedFile(
            input.target.parent,
            lockName,
            'Git config lock failed-publication cleanup'
          );
          if (
            ownLock !== null
            && ownLock.bytes !== null
            && Buffer.from(ownLock.bytes).equals(bytes)
          ) {
            deleteRetainedFileExact(
              input.target.parent,
              lockName,
              ownLock,
              'Git config lock failed-publication cleanup'
            );
            throw asTransition(error);
          }
        } catch (cleanupError) {
          if (cleanupError instanceof GitHookTransitionConflict && cleanupError !== error) {
            throw cleanupError;
          }
          throw new GitHookTransitionConflict(
            'Git config lock publication failed and its owner could not be safely retired: '
            + errorMessage(cleanupError),
            true
          );
        }
      }
      let existing: ReturnType<typeof inspectNoFollowOrdinaryFileEntry> | null;
      try {
        existing = readRetainedFile(input.target.parent, lockName, 'Git config lock collision');
      } catch (readError) {
        throw asTransition(readError);
      }
      if (existing === null || existing.bytes === null) throw asTransition(error);
      let existingRecord: ConfigFileLockRecord;
      try {
        existingRecord = parseConfigFileLock(existing.bytes, 'Git config lock collision');
      } catch (parseError) {
        throw new GitHookTransitionConflict(
          'Git config lock is foreign or malformed; the external owner was preserved: '
          + errorMessage(parseError)
        );
      }
      if (!configLockRecordMatches(
        existingRecord,
        input.target,
        input.operationDigest,
        input.stepIndex
      )) {
        throw new GitHookTransitionConflict('Git config lock belongs to a different operation; external owner was preserved');
      }
      if (
        input.lease.reclaimedOwner === null
        || !sameLeaseOwner(existingRecord.owner, input.lease.reclaimedOwner)
        || reclaimed
      ) {
        throw new GitHookTransitionConflict('Git config lock owner is live or liveness-unknown; external owner was preserved');
      }
      cleanupOwnedConfigStage(
        input.target.parent,
        existingRecord.stageName,
        'Reclaimed Git config lock'
      );
      deleteRetainedFileExact(
        input.target.parent,
        lockName,
        existing,
        'Reclaimed Git config lock'
      );
      reclaimed = true;
    }
  }
  throw new GitHookTransitionConflict('Git config lock was not acquired after exact dead-owner reclaim');
}

function reclaimConfigTransitionLocks(input: {
  readonly transition: ConfigTransitionHandle;
  readonly commonGitDir: string;
  readonly worktreeConfigPath: string;
  readonly lease: PhysicalMutationLeaseHandle;
}): void {
  const boundary = input.transition.intent.initialBoundary;
  const seen = new Set<string>();
  for (const step of input.transition.intent.steps) {
    const target = configFileTarget(
      boundary,
      input.commonGitDir,
      input.worktreeConfigPath,
      step.scope
    );
    const lockName = configFileLockName(target.name);
    const identityKey = physicalChainKey(target.parent) + '\0' + lockName;
    if (seen.has(identityKey)) continue;
    seen.add(identityKey);
    const existing = readRetainedFile(target.parent, lockName, 'Git config transition lock recovery');
    if (existing === null || existing.bytes === null) continue;
    let record: ConfigFileLockRecord;
    try {
      record = parseConfigFileLock(existing.bytes, 'Git config transition lock recovery');
    } catch (error) {
      throw new GitHookTransitionConflict(
        'Git config transition lock is foreign or malformed; it was preserved: ' + errorMessage(error)
      );
    }
    if (
      record.operationDigest !== input.transition.intent.operationDigest
      || canonicalPath(record.configPath) !== canonicalPath(target.path)
      || record.configParentKey !== physicalChainKey(target.parent)
      || record.configName !== target.name
    ) {
      throw new GitHookTransitionConflict('Git config transition lock belongs to a different operation; it was preserved');
    }
    const lockedStep = input.transition.intent.steps[record.stepIndex];
    if (lockedStep === undefined || lockedStep.scope !== record.scope) {
      throw new GitHookTransitionConflict('Git config transition lock step is not in the durable step order; it was preserved');
    }
    const expectedBoundary = record.stepIndex === 0
      ? input.transition.intent.initialBoundary
      : readConfigTransitionStep(input.transition, record.stepIndex - 1)?.boundary;
    if (
      expectedBoundary !== undefined
      && !samePhysicalFileObservation(
        record.preimage,
        record.scope === 'local' ? expectedBoundary.commonConfig : expectedBoundary.worktreeConfig
      )
    ) {
      throw new GitHookTransitionConflict('Git config transition lock preimage diverged; it was preserved');
    }
    if (
      input.lease.reclaimedOwner === null
      || !sameLeaseOwner(record.owner, input.lease.reclaimedOwner)
    ) {
      throw new GitHookTransitionConflict('Git config transition lock owner is live or liveness-unknown; it was preserved');
    }
    cleanupOwnedConfigStage(
      target.parent,
      record.stageName,
      'Reclaimed Git config transition'
    );
    deleteRetainedFileExact(
      target.parent,
      lockName,
      existing,
      'Reclaimed Git config transition lock'
    );
  }
}

async function writeGitConfigValueCas(input: {
  readonly repoRoot: string;
  readonly commonGitDir: string;
  readonly worktreeGitDir: string;
  readonly worktreeConfigPath: string;
  readonly step: ConfigTransitionStep;
  readonly expected: ConfigObservation;
  readonly operationDigest: string;
  readonly lease: PhysicalMutationLeaseHandle;
  readonly configEffectProvider: GitPhysicalProviderCapability;
}): Promise<ConfigObservation> {
  const target = configFileTarget(
    input.expected.boundary,
    input.commonGitDir,
    input.worktreeConfigPath,
    input.step.scope
  );
  const targetEntry = readRetainedFile(target.parent, target.name, 'Git config exact preimage');
  if (!samePhysicalFileObservation(
    physicalFileObservationFromEntry(targetEntry),
    target.expected
  )) {
    throw new GitHookTransitionConflict(
      'Git config physical preimage changed before provider lock acquisition for step ' + input.step.index
    );
  }
  const lock = acquireConfigFileLock({
    target,
    operationDigest: input.operationDigest,
    stepIndex: input.step.index,
    lease: input.lease
  });
  let retainedLock: ConfigFileLockHandle | null = lock;
  try {
    // The retained <config>.lock is the provider's real exclusion boundary:
    // Git config actors fail to acquire this same lock instead of racing a
    // read-then-write check.  Re-read both semantic and physical preimages
    // only after that lock has been published.
    const locked = await readHookConfigObservation(
      input.repoRoot,
      input.commonGitDir,
      input.worktreeGitDir,
      input.worktreeConfigPath
    );
    if (
      !sameHookConfigState(locked.state, input.expected.state)
      || configBoundaryKey(locked.boundary) !== configBoundaryKey(input.expected.boundary)
    ) {
      throw new GitHookTransitionConflict(
        'Git config provider-lock preimage changed before step ' + input.step.index + ' effect'
      );
    }
    const lockedEntry = readRetainedFile(target.parent, target.name, 'Git config provider-lock preimage');
    if (
      !samePhysicalFileObservation(
        physicalFileObservationFromEntry(lockedEntry),
        target.expected
      )
      || (targetEntry !== null && lockedEntry !== null && (
        lockedEntry.device !== targetEntry.device
        || lockedEntry.inode !== targetEntry.inode
        || lockedEntry.bytes === null
        || targetEntry.bytes === null
        || !Buffer.from(lockedEntry.bytes).equals(Buffer.from(targetEntry.bytes))
      ))
    ) {
      throw new GitHookTransitionConflict(
        'Git config provider-lock exact preimage changed before step ' + input.step.index + ' effect'
      );
    }
    const stageName = lock.record.stageName;
    const stagePath = path.join(target.parent.target.path, stageName);
    if (readRetainedFile(target.parent, stageName, 'Git config stage preimage') !== null) {
      throw new GitHookTransitionConflict('Git config stage is occupied by a prior or foreign value');
    }
    const sourceBytes = targetEntry?.bytes === null || targetEntry === null
      ? Buffer.alloc(0)
      : Buffer.from(targetEntry.bytes);
    const staged = publishExclusiveDurableCanonicalFile({
      parent: target.parent.target,
      name: stageName,
      bytes: sourceBytes,
      validate: (candidate) => {
        if (!Buffer.from(candidate).equals(sourceBytes)) {
          throw new Error('Git config stage initial bytes differ from the retained preimage');
        }
      }
    });
    if (!staged.created) {
      throw new GitHookTransitionConflict('Git config stage was occupied during exclusive publication');
    }
    await writeGitConfigFileValue(
      stagePath,
      input.step.configKey,
      input.step.value,
      input.configEffectProvider
    );
    if (readRetainedFile(target.parent, stageName + '.lock', 'Git config stage lock readback') !== null) {
      throw new GitHookTransitionConflict('Git config stage provider lock remained after its effect');
    }
    const stagedEntry = readRetainedFile(target.parent, stageName, 'Git config staged postimage');
    if (stagedEntry === null || stagedEntry.bytes === null) {
      throw new GitHookTransitionConflict('Git config staged postimage disappeared');
    }
    await assertConfigStageValue(
      input.repoRoot,
      stagePath,
      input.step.configKey,
      input.step.value,
      'Git config staged postimage'
    );
    const beforePublish = await readHookConfigObservation(
      input.repoRoot,
      input.commonGitDir,
      input.worktreeGitDir,
      input.worktreeConfigPath
    );
    if (
      !sameHookConfigState(beforePublish.state, input.expected.state)
      || configBoundaryKey(beforePublish.boundary) !== configBoundaryKey(input.expected.boundary)
    ) {
      throw new GitHookTransitionConflict('Git config preimage changed before retained provider publication');
    }
    replaceDurableCanonicalFile({
      parent: target.parent.target,
      name: target.name,
      bytes: stagedEntry.bytes,
      expectedExisting: targetEntry === null
        ? null
        : { device: targetEntry.device, inode: targetEntry.inode },
      validate: (candidate) => {
        if (!Buffer.from(candidate).equals(Buffer.from(stagedEntry.bytes!))) {
          throw new Error('Git config provider postimage bytes differ from the retained stage');
        }
      }
    });
    const after = await readHookConfigObservation(
      input.repoRoot,
      input.commonGitDir,
      input.worktreeGitDir,
      input.worktreeConfigPath
    );
    if (!sameHookConfigState(after.state, input.step.after)) {
      throw new GitHookTransitionConflict('Git config provider postimage semantic readback differs at step ' + input.step.index);
    }
    deleteRetainedFileExact(
      target.parent,
      stageName,
      stagedEntry,
      'Git config stage cleanup'
    );
    releaseConfigFileLock(lock);
    retainedLock = null;
    return after;
  } catch (error) {
    // Do not roll the config file back from a fresh read.  Private staging
    // state can be retired while our real provider lock is still held; the
    // target's current bytes remain the sole recovery input.  A crash before
    // this handler runs leaves both the provider lock and namespace lease for
    // canonical dead-owner recovery.
    if (retainedLock !== null) {
      try {
        cleanupOwnedConfigStage(
          target.parent,
          retainedLock.record.stageName,
          'Git config failed-effect recovery'
        );
        releaseConfigFileLock(retainedLock);
        retainedLock = null;
      } catch (cleanupError) {
        throw new GitHookTransitionConflict(
          'Git config effect failed and its provider lock could not be safely retired: '
          + errorMessage(cleanupError),
          true
        );
      }
    }
    throw asTransition(error);
  } finally {
    // A non-null lock here means the process is being interrupted while an
    // effect is active; its durable owner is intentionally left for the next
    // process to reclaim after proving this process dead.
    void retainedLock;
  }
}

function parseConfigTransitionStep(value: unknown, label: string): ConfigTransitionStep {
  const record = recordValue(value, label);
  ownKeys(record, ['index', 'scope', 'key', 'configKey', 'value', 'before', 'after'], label);
  if (!Number.isSafeInteger(record.index) || (record.index as number) < 0) {
    throw new GitHookTransitionConflict(label + '.index is invalid');
  }
  if (record.scope !== 'local' && record.scope !== 'worktree') {
    throw new GitHookTransitionConflict(label + '.scope is invalid');
  }
  if (!['worktreeConfig', 'commonHooksPath', 'worktreeHooksPath'].includes(String(record.key))) {
    throw new GitHookTransitionConflict(label + '.key is invalid');
  }
  const key = record.key as keyof HookConfigState;
  const definition = configStepDefinitions()[(record.index as number)];
  if (
    definition === undefined
    || definition.scope !== record.scope
    || definition.key !== key
    || definition.configKey !== record.configKey
  ) {
    throw new GitHookTransitionConflict(label + ' does not match the canonical config step order');
  }
  return Object.freeze({
    index: record.index as number,
    scope: record.scope,
    key,
    configKey: stringValue(record.configKey, label + '.configKey'),
    value: stringValue(record.value, label + '.value'),
    before: parseHookConfigState(record.before, label + '.before'),
    after: parseHookConfigState(record.after, label + '.after')
  });
}

function parseConfigTransitionIntent(bytes: Uint8Array, label: string): ConfigTransitionIntent {
  const record = parseCanonicalJson(bytes, label);
  ownKeys(record, [
    'schema',
    'operationDigest',
    'commonRoot',
    'commonRootKey',
    'repoRoot',
    'commonGitDir',
    'worktreeGitDir',
    'worktreeConfigPath',
    'preimage',
    'target',
    'initialBoundary',
    'markerRoot',
    'bootstrapMarkerRoot',
    'marker',
    'bootstrapMarker',
    'generation',
    'bootstrapGeneration',
    'priorGenerations',
    'steps'
  ], label);
  if (record.schema !== 'sec-managed-hook-config-transition-v1') {
    throw new GitHookTransitionConflict(label + ' schema is not recognized');
  }
  const operationDigest = stringValue(record.operationDigest, label + '.operationDigest');
  if (!/^[0-9a-f]{64}$/u.test(operationDigest)) {
    throw new GitHookTransitionConflict(label + '.operationDigest is invalid');
  }
  const commonRoot = stringValue(record.commonRoot, label + '.commonRoot');
  const repoRoot = stringValue(record.repoRoot, label + '.repoRoot');
  const commonGitDir = stringValue(record.commonGitDir, label + '.commonGitDir');
  const worktreeGitDir = stringValue(record.worktreeGitDir, label + '.worktreeGitDir');
  const worktreeConfigPath = stringValue(record.worktreeConfigPath, label + '.worktreeConfigPath');
  if ([commonRoot, repoRoot, commonGitDir, worktreeGitDir, worktreeConfigPath].some((value) => !path.isAbsolute(value))) {
    throw new GitHookTransitionConflict(label + ' contains a non-absolute path');
  }
  const preimage = parseHookConfigState(record.preimage, label + '.preimage');
  const target = parseHookConfigState(record.target, label + '.target');
  const initialBoundary = parseConfigPhysicalBoundary(record.initialBoundary, label + '.initialBoundary');
  const markerRoot = parsePhysicalChain(record.markerRoot, label + '.markerRoot');
  const bootstrapMarkerRoot = parsePhysicalChain(record.bootstrapMarkerRoot, label + '.bootstrapMarkerRoot');
  const marker = parseHookMarkerRecord(record.marker, label + '.marker');
  const bootstrapMarker = parseHookMarkerRecord(record.bootstrapMarker, label + '.bootstrapMarker');
  const generation = parseGenerationPhysicalEvidence(record.generation, label + '.generation');
  const bootstrapGeneration = parseGenerationPhysicalEvidence(
    record.bootstrapGeneration,
    label + '.bootstrapGeneration'
  );
  const priorGenerations = parsePriorGenerationEvidenceList(
    record.priorGenerations,
    commonRoot,
    label + '.priorGenerations'
  );
  if (!Array.isArray(record.steps) || record.steps.length !== configStepDefinitions().length) {
    throw new GitHookTransitionConflict(label + '.steps has an invalid count');
  }
  const steps = Object.freeze(record.steps.map((step, index) => (
    parseConfigTransitionStep(step, label + '.steps[' + index + ']')
  )));
  const expectedSteps = makeConfigTransitionSteps(preimage, target);
  if (JSON.stringify(steps) !== JSON.stringify(expectedSteps)) {
    throw new GitHookTransitionConflict(label + '.steps do not match its preimage and target');
  }
  const candidate = Object.freeze({
    schema: 'sec-managed-hook-config-transition-v1' as const,
    operationDigest,
    commonRoot,
    commonRootKey: stringValue(record.commonRootKey, label + '.commonRootKey'),
    repoRoot,
    commonGitDir,
    worktreeGitDir,
    worktreeConfigPath,
    preimage,
    target,
    initialBoundary,
    markerRoot,
    bootstrapMarkerRoot,
    marker,
    bootstrapMarker,
    generation,
    bootstrapGeneration,
    priorGenerations,
    steps
  });
  if (!Buffer.from(bytes).equals(jsonBytes(candidate))) {
    throw new GitHookTransitionConflict(label + ' is not canonically encoded');
  }
  return candidate;
}

function parseConfigTransitionReceipt(bytes: Uint8Array, label: string): ConfigTransitionReceipt {
  const record = parseCanonicalJson(bytes, label);
  ownKeys(record, ['schema', 'operationDigest', 'index', 'after', 'boundary'], label);
  if (record.schema !== 'sec-managed-hook-config-step-v1') {
    throw new GitHookTransitionConflict(label + ' schema is not recognized');
  }
  if (!Number.isSafeInteger(record.index) || (record.index as number) < 0) {
    throw new GitHookTransitionConflict(label + '.index is invalid');
  }
  return Object.freeze({
    schema: 'sec-managed-hook-config-step-v1',
    operationDigest: stringValue(record.operationDigest, label + '.operationDigest'),
    index: record.index as number,
    after: parseHookConfigState(record.after, label + '.after'),
    boundary: parseConfigPhysicalBoundary(record.boundary, label + '.boundary')
  });
}

function parseConfigTransitionComplete(
  bytes: Uint8Array,
  label: string
): ConfigTransitionCompleteReceipt {
  const record = parseCanonicalJson(bytes, label);
  ownKeys(record, ['schema', 'operationDigest', 'target', 'boundary'], label);
  if (record.schema !== 'sec-managed-hook-config-complete-v1') {
    throw new GitHookTransitionConflict(label + ' schema is not recognized');
  }
  return Object.freeze({
    schema: 'sec-managed-hook-config-complete-v1',
    operationDigest: stringValue(record.operationDigest, label + '.operationDigest'),
    target: parseHookConfigState(record.target, label + '.target'),
    boundary: parseConfigPhysicalBoundary(record.boundary, label + '.boundary')
  });
}

function parseConfigTransitionRetireIntent(
  bytes: Uint8Array,
  label: string
): ConfigTransitionRetireIntent {
  const record = parseCanonicalJson(bytes, label);
  ownKeys(record, ['schema', 'operationDigest', 'index', 'digest', 'path'], label);
  const operationDigest = stringValue(record.operationDigest, label + '.operationDigest');
  const digest = stringValue(record.digest, label + '.digest');
  const pathName = stringValue(record.path, label + '.path');
  if (
    record.schema !== 'sec-managed-hook-config-retire-intent-v1'
    || !/^[0-9a-f]{64}$/u.test(operationDigest)
    || !Number.isSafeInteger(record.index)
    || (record.index as number) < 0
    || !/^[0-9a-f]{64}$/u.test(digest)
    || !path.isAbsolute(pathName)
  ) {
    throw new GitHookTransitionConflict(label + ' has an invalid retirement identity');
  }
  return Object.freeze({
    schema: 'sec-managed-hook-config-retire-intent-v1',
    operationDigest,
    index: record.index as number,
    digest,
    path: pathName
  });
}

function parseConfigTransitionRetiredReceipt(
  bytes: Uint8Array,
  label: string
): ConfigTransitionRetiredReceipt {
  const record = parseCanonicalJson(bytes, label);
  ownKeys(record, ['schema', 'operationDigest', 'index', 'digest', 'path'], label);
  const operationDigest = stringValue(record.operationDigest, label + '.operationDigest');
  const digest = stringValue(record.digest, label + '.digest');
  const pathName = stringValue(record.path, label + '.path');
  if (
    record.schema !== 'sec-managed-hook-config-retired-v1'
    || !/^[0-9a-f]{64}$/u.test(operationDigest)
    || !Number.isSafeInteger(record.index)
    || (record.index as number) < 0
    || !/^[0-9a-f]{64}$/u.test(digest)
    || !path.isAbsolute(pathName)
  ) {
    throw new GitHookTransitionConflict(label + ' has an invalid retired identity');
  }
  return Object.freeze({
    schema: 'sec-managed-hook-config-retired-v1',
    operationDigest,
    index: record.index as number,
    digest,
    path: pathName
  });
}

function assertTransitionDirectoryBound(
  commonRoot: PhysicalDirectoryChain,
  transition: PhysicalDirectoryChain,
  label: string
): void {
  if (!transition.ancestors.some((ancestor) => sameIdentity(ancestor, commonRoot.target))) {
    throw new GitHookTransitionConflict(label + ' is not physically contained by the common Git namespace');
  }
}

function inspectOrCreateTransitionDirectory(
  commonRoot: PhysicalDirectoryChain,
  name: string
): PhysicalDirectoryChain {
  const retainedCommonRoot = assertRetainedDirectoryChainCurrent(
    commonRoot,
    'Git config transition namespace parent'
  );
  const target = path.join(retainedCommonRoot.target.path, name);
  const presence = inspectExactNoFollowDirectoryPresence(target, 'Git config transition namespace');
  if (presence.state === 'present') {
    assertTransitionDirectoryBound(retainedCommonRoot, presence.directory, 'Git config transition namespace');
    assertRetainedDirectoryChainCurrent(
      retainedCommonRoot,
      'Git config transition namespace parent readback'
    );
    return presence.directory;
  }
  try {
    const identity = createExclusiveNoFollowDirectory(retainedCommonRoot.target, name);
    const created = inspectNoFollowDirectoryChain(identity.path, 'Git config transition namespace readback');
    assertTransitionDirectoryBound(retainedCommonRoot, created, 'Git config transition namespace readback');
    assertRetainedDirectoryChainCurrent(
      retainedCommonRoot,
      'Git config transition namespace parent readback'
    );
    return created;
  } catch (error) {
    const commonAfter = assertRetainedDirectoryChainCurrent(
      retainedCommonRoot,
      'Git config transition namespace parent readback'
    );
    const raced = inspectExactNoFollowDirectoryPresence(target, 'Git config transition namespace race readback');
    if (raced.state === 'present') {
      assertTransitionDirectoryBound(commonAfter, raced.directory, 'Git config transition namespace race readback');
      return raced.directory;
    }
    throw asTransition(error);
  }
}

function transitionIntentMatches(
  actual: ConfigTransitionIntent,
  expected: ConfigTransitionIntent
): boolean {
  return actual.schema === expected.schema
    && actual.operationDigest === expected.operationDigest
    && canonicalPath(actual.commonRoot) === canonicalPath(expected.commonRoot)
    && actual.commonRootKey === expected.commonRootKey
    && canonicalPath(actual.repoRoot) === canonicalPath(expected.repoRoot)
    && canonicalPath(actual.commonGitDir) === canonicalPath(expected.commonGitDir)
    && canonicalPath(actual.worktreeGitDir) === canonicalPath(expected.worktreeGitDir)
    && canonicalPath(actual.worktreeConfigPath) === canonicalPath(expected.worktreeConfigPath)
    && sameHookConfigState(actual.preimage, expected.preimage)
    && sameHookConfigState(actual.target, expected.target)
    && configBoundaryKey(actual.initialBoundary) === configBoundaryKey(expected.initialBoundary)
    && sameChain(actual.markerRoot, expected.markerRoot)
    && sameChain(actual.bootstrapMarkerRoot, expected.bootstrapMarkerRoot)
    && JSON.stringify(actual.marker) === JSON.stringify(expected.marker)
    && JSON.stringify(actual.bootstrapMarker) === JSON.stringify(expected.bootstrapMarker)
    && JSON.stringify(actual.generation) === JSON.stringify(expected.generation)
    && JSON.stringify(actual.bootstrapGeneration) === JSON.stringify(expected.bootstrapGeneration)
    && JSON.stringify(actual.priorGenerations) === JSON.stringify(expected.priorGenerations);
}

function preparedIntentMatches(
  actual: ConfigTransitionPreparedIntent,
  expected: ConfigTransitionPreparedIntent
): boolean {
  return JSON.stringify(canonicalJson(actual)) === JSON.stringify(canonicalJson(expected));
}

/**
 * A config effect may legitimately advance the physical config boundary
 * before its immutable step receipt is published.  During that recovery
 * window the durable preimage remains authoritative; only the publication
 * identity may be compared with a fresh invocation.  Never replace the
 * durable preimage with the post-effect observation.
 */
function preparedPublicationIdentityMatches(
  actual: ConfigTransitionPreparedIntent,
  expected: ConfigTransitionPreparedIntent
): boolean {
  return actual.schema === expected.schema
    && actual.operationDigest === expected.operationDigest
    && canonicalPath(actual.commonRoot) === canonicalPath(expected.commonRoot)
    && actual.commonRootKey === expected.commonRootKey
    && canonicalPath(actual.repoRoot) === canonicalPath(expected.repoRoot)
    && canonicalPath(actual.commonGitDir) === canonicalPath(expected.commonGitDir)
    && canonicalPath(actual.worktreeGitDir) === canonicalPath(expected.worktreeGitDir)
    && canonicalPath(actual.worktreeConfigPath) === canonicalPath(expected.worktreeConfigPath)
    && sameHookConfigState(actual.target, expected.target)
    && sameChain(actual.markerRoot, expected.markerRoot)
    && sameChain(actual.bootstrapMarkerRoot, expected.bootstrapMarkerRoot)
    && JSON.stringify(actual.marker) === JSON.stringify(expected.marker)
    && JSON.stringify(actual.bootstrapMarker) === JSON.stringify(expected.bootstrapMarker)
    && JSON.stringify(actual.generation) === JSON.stringify(expected.generation)
    && JSON.stringify(actual.bootstrapGeneration) === JSON.stringify(expected.bootstrapGeneration)
    && JSON.stringify(actual.priorGenerations) === JSON.stringify(expected.priorGenerations);
}

function transitionPublicationIdentityMatches(
  actual: ConfigTransitionIntent,
  expected: ConfigTransitionIntent
): boolean {
  return actual.schema === expected.schema
    && actual.operationDigest === expected.operationDigest
    && canonicalPath(actual.commonRoot) === canonicalPath(expected.commonRoot)
    && actual.commonRootKey === expected.commonRootKey
    && canonicalPath(actual.repoRoot) === canonicalPath(expected.repoRoot)
    && canonicalPath(actual.commonGitDir) === canonicalPath(expected.commonGitDir)
    && canonicalPath(actual.worktreeGitDir) === canonicalPath(expected.worktreeGitDir)
    && canonicalPath(actual.worktreeConfigPath) === canonicalPath(expected.worktreeConfigPath)
    && sameHookConfigState(actual.target, expected.target)
    && sameChain(actual.markerRoot, expected.markerRoot)
    && sameChain(actual.bootstrapMarkerRoot, expected.bootstrapMarkerRoot)
    && JSON.stringify(actual.marker) === JSON.stringify(expected.marker)
    && JSON.stringify(actual.bootstrapMarker) === JSON.stringify(expected.bootstrapMarker)
    && JSON.stringify(actual.generation) === JSON.stringify(expected.generation)
    && JSON.stringify(actual.bootstrapGeneration) === JSON.stringify(expected.bootstrapGeneration)
    && JSON.stringify(actual.priorGenerations) === JSON.stringify(expected.priorGenerations);
}

function publishExclusiveTransitionFile(
  transition: PhysicalDirectoryChain,
  name: string,
  bytes: Buffer,
  label: string
): void {
  assertRetainedDirectoryChainCurrent(transition, label + ' parent');
  const published = publishExclusiveDurableCanonicalFile({
    parent: transition.target,
    name,
    bytes,
    validate: (candidate) => {
      if (!Buffer.from(candidate).equals(bytes)) throw new Error(label + ' bytes differ');
    }
  });
  const readback = transitionFileBytes(transition, name);
  if (readback === null || !readback.equals(bytes)) {
    if (published.created) throw new GitHookTransitionConflict(label + ' durable readback differs');
    throw new GitHookTransitionConflict(label + ' is occupied by a different durable value');
  }
  assertRetainedDirectoryChainCurrent(transition, label + ' parent readback');
}

function ensureConfigTransitionPrepared(input: {
  readonly commonRoot: PhysicalDirectoryChain;
  readonly operationDigest: string;
  readonly repoRoot: string;
  readonly commonGitDir: string;
  readonly worktreeGitDir: string;
  readonly worktreeConfigPath: string;
  readonly preimage: HookConfigState;
  readonly target: HookConfigState;
  readonly initialBoundary: ConfigPhysicalBoundary;
  readonly markerRoot: PhysicalDirectoryChain;
  readonly bootstrapMarkerRoot: PhysicalDirectoryChain;
  readonly marker: HookMarkerRecord;
  readonly bootstrapMarker: HookMarkerRecord;
  readonly generation: ConfigTransitionGenerationPlan;
  readonly bootstrapGeneration: ConfigTransitionGenerationPlan;
  readonly priorGenerations: readonly PriorGenerationEvidence[];
}): Readonly<{ chain: PhysicalDirectoryChain; intent: ConfigTransitionPreparedIntent; name: string }> {
  const name = transitionDirectoryName(input.operationDigest);
  const chain = inspectOrCreateTransitionDirectory(input.commonRoot, name);
  const expected = makeConfigTransitionPreparedIntent(input);
  const preparedBytes = transitionFileBytes(chain, CONFIG_TRANSITION_PREPARED_FILE);
  if (preparedBytes === null) {
    publishExclusiveTransitionFile(
      chain,
      CONFIG_TRANSITION_PREPARED_FILE,
      jsonBytes(expected),
      'Git config prepared transition intent'
    );
    return Object.freeze({ chain, intent: expected, name });
  }
  const actual = parseConfigTransitionPreparedIntent(
    preparedBytes,
    'Git config prepared transition intent'
  );
  const durableIntentBytes = transitionFileBytes(chain, CONFIG_TRANSITION_INTENT_FILE);
  if (durableIntentBytes === null && preparedIntentMatches(actual, expected)) {
    return Object.freeze({ chain, intent: actual, name });
  }
  if (durableIntentBytes === null) {
    throw new GitHookTransitionConflict(
      'Git config prepared transition intent belongs to a different exact target'
    );
  }
  const durableIntent = parseConfigTransitionIntent(
    durableIntentBytes,
    'Git config transition recovery intent'
  );
  const durableTransition: ConfigTransitionHandle = Object.freeze({
    chain,
    intent: durableIntent,
    name
  });
  assertPreparedIntentMatchesTransition(
    input.commonRoot,
    durableTransition,
    'Git config prepared transition recovery'
  );
  if (!preparedPublicationIdentityMatches(actual, expected)) {
    throw new GitHookTransitionConflict(
      'Git config prepared transition publication identity diverged during recovery'
    );
  }
  return Object.freeze({ chain, intent: actual, name });
}

function ensureConfigTransition(input: {
  readonly commonRoot: PhysicalDirectoryChain;
  readonly operationDigest: string;
  readonly repoRoot: string;
  readonly commonGitDir: string;
  readonly worktreeGitDir: string;
  readonly worktreeConfigPath: string;
  readonly preimage: HookConfigState;
  readonly target: HookConfigState;
  readonly initialBoundary: ConfigPhysicalBoundary;
  readonly markerRoot: PhysicalDirectoryChain;
  readonly bootstrapMarkerRoot: PhysicalDirectoryChain;
  readonly marker: HookMarkerRecord;
  readonly bootstrapMarker: HookMarkerRecord;
  readonly generation: GenerationPhysicalEvidence;
  readonly bootstrapGeneration: GenerationPhysicalEvidence;
  readonly generationPlan: ConfigTransitionGenerationPlan;
  readonly bootstrapGenerationPlan: ConfigTransitionGenerationPlan;
  readonly priorGenerations: readonly PriorGenerationEvidence[];
}): ConfigTransitionHandle {
  const name = transitionDirectoryName(input.operationDigest);
  const chain = inspectOrCreateTransitionDirectory(input.commonRoot, name);
  const expected = makeConfigTransitionIntent({
    operationDigest: input.operationDigest,
    commonRoot: input.commonRoot,
    repoRoot: input.repoRoot,
    commonGitDir: input.commonGitDir,
    worktreeGitDir: input.worktreeGitDir,
    worktreeConfigPath: input.worktreeConfigPath,
    preimage: input.preimage,
    target: input.target,
    initialBoundary: input.initialBoundary,
    markerRoot: input.markerRoot,
    bootstrapMarkerRoot: input.bootstrapMarkerRoot,
    marker: input.marker,
    bootstrapMarker: input.bootstrapMarker,
    generation: input.generation,
    bootstrapGeneration: input.bootstrapGeneration,
    priorGenerations: input.priorGenerations
  });
  const preparedBytes = transitionFileBytes(chain, CONFIG_TRANSITION_PREPARED_FILE);
  if (preparedBytes === null) {
    throw new GitHookTransitionConflict(
      'Git config transition intent cannot advance without its durable prepared admission'
    );
  }
  const prepared = parseConfigTransitionPreparedIntent(
    preparedBytes,
    'Git config prepared transition intent'
  );
  const intentBytes = transitionFileBytes(chain, CONFIG_TRANSITION_INTENT_FILE);
  const durableIntent = intentBytes === null
    ? null
    : parseConfigTransitionIntent(intentBytes, 'Git config transition recovery intent');
  if (durableIntent !== null) {
    assertPreparedIntentMatchesTransition(
      input.commonRoot,
      Object.freeze({ chain, intent: durableIntent, name }),
      'Git config transition recovery'
    );
  }
  const expectedPrepared = makeConfigTransitionPreparedIntent({
    operationDigest: input.operationDigest,
    commonRoot: input.commonRoot,
    repoRoot: input.repoRoot,
    commonGitDir: input.commonGitDir,
    worktreeGitDir: input.worktreeGitDir,
    worktreeConfigPath: input.worktreeConfigPath,
    preimage: input.preimage,
    target: input.target,
    initialBoundary: input.initialBoundary,
    markerRoot: input.markerRoot,
    bootstrapMarkerRoot: input.bootstrapMarkerRoot,
    marker: input.marker,
    bootstrapMarker: input.bootstrapMarker,
    generation: input.generationPlan,
    bootstrapGeneration: input.bootstrapGenerationPlan,
    priorGenerations: input.priorGenerations
  });
  if (
    durableIntent === null
      ? !preparedIntentMatches(prepared, expectedPrepared)
      : !preparedPublicationIdentityMatches(prepared, expectedPrepared)
  ) {
    throw new GitHookTransitionConflict(
      'Git config prepared transition intent diverged before physical publication was advanced'
    );
  }
  if (intentBytes === null) {
    publishExclusiveTransitionFile(
      chain,
      CONFIG_TRANSITION_INTENT_FILE,
      jsonBytes(expected),
      'Git config transition intent'
    );
    return Object.freeze({ chain, intent: expected, name });
  }
  const actual = durableIntent!;
  if (
    !transitionIntentMatches(actual, expected)
    && !transitionPublicationIdentityMatches(actual, expected)
  ) {
    throw new GitHookTransitionConflict('Git config transition intent belongs to a different exact target');
  }
  return Object.freeze({ chain, intent: actual, name });
}

function transitionStepFileName(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0 || index >= configStepDefinitions().length) {
    throw new GitHookTransitionConflict('Config transition step index is invalid');
  }
  return CONFIG_TRANSITION_STEP_PREFIX + index;
}

function transitionRetireIntentFileName(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new GitHookTransitionConflict('Config transition retirement index is invalid');
  }
  return CONFIG_TRANSITION_RETIRE_INTENT_PREFIX + index;
}

function transitionRetiredFileName(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new GitHookTransitionConflict('Config transition retired index is invalid');
  }
  return CONFIG_TRANSITION_RETIRED_PREFIX + index;
}

function readConfigTransitionStep(
  transition: ConfigTransitionHandle,
  index: number
): ConfigTransitionReceipt | null {
  const bytes = transitionFileBytes(
    transition.chain,
    transitionStepFileName(index)
  );
  return bytes === null
    ? null
    : parseConfigTransitionReceipt(bytes, 'Git config transition step ' + index);
}

function readConfigTransitionComplete(
  transition: ConfigTransitionHandle
): ConfigTransitionCompleteReceipt | null {
  const bytes = transitionFileBytes(
    transition.chain,
    CONFIG_TRANSITION_COMPLETE_FILE
  );
  return bytes === null
    ? null
    : parseConfigTransitionComplete(bytes, 'Git config transition completion');
}

function readConfigTransitionRetireIntent(
  transition: ConfigTransitionHandle,
  index: number
): ConfigTransitionRetireIntent | null {
  const bytes = transitionFileBytes(
    transition.chain,
    transitionRetireIntentFileName(index)
  );
  return bytes === null
    ? null
    : parseConfigTransitionRetireIntent(bytes, 'Git config retirement intent ' + index);
}

function readConfigTransitionRetiredReceipt(
  transition: ConfigTransitionHandle,
  index: number
): ConfigTransitionRetiredReceipt | null {
  const bytes = transitionFileBytes(
    transition.chain,
    transitionRetiredFileName(index)
  );
  return bytes === null
    ? null
    : parseConfigTransitionRetiredReceipt(bytes, 'Git config retired receipt ' + index);
}

function publishConfigTransitionRetireIntent(
  transition: ConfigTransitionHandle,
  receipt: ConfigTransitionRetireIntent
): void {
  publishExclusiveTransitionFile(
    transition.chain,
    transitionRetireIntentFileName(receipt.index),
    jsonBytes(receipt),
    'Git config retirement intent ' + receipt.index
  );
}

function publishConfigTransitionRetiredReceipt(
  transition: ConfigTransitionHandle,
  receipt: ConfigTransitionRetiredReceipt
): void {
  publishExclusiveTransitionFile(
    transition.chain,
    transitionRetiredFileName(receipt.index),
    jsonBytes(receipt),
    'Git config retired receipt ' + receipt.index
  );
}

function retirePriorGenerations(
  commonRoot: PhysicalDirectoryChain,
  transition: ConfigTransitionHandle,
  afterDelete?: (index: number, generationPath: string) => void
): void {
  const prior = transition.intent.priorGenerations;
  const retiredEvidencePaths = new Set<string>();
  for (const [index, item] of prior.entries()) {
    const evidencePathKey = canonicalPath(item.evidence.path);
    const intent = readConfigTransitionRetireIntent(transition, index);
    if (intent !== null && (
      intent.operationDigest !== transition.intent.operationDigest
      || intent.index !== index
      || intent.digest !== item.digest
      || canonicalPath(intent.path) !== canonicalPath(item.evidence.path)
    )) {
      throw new GitHookTransitionConflict('Git config prior-generation retirement intent diverged at ' + index);
    }
    const retired = readConfigTransitionRetiredReceipt(transition, index);
    if (retired !== null) {
      if (
        retired.operationDigest !== transition.intent.operationDigest
        || retired.index !== index
        || retired.digest !== item.digest
        || canonicalPath(retired.path) !== canonicalPath(item.evidence.path)
      ) {
        throw new GitHookTransitionConflict('Git config prior-generation retired receipt diverged at ' + index);
      }
      const absence = inspectExactNoFollowDirectoryPresence(
        item.evidence.path,
        'Retired managed generation readback'
      );
      if (absence.state !== 'absent') {
        throw new GitHookTransitionConflict('Retired managed generation was recreated after its durable deletion receipt');
      }
      retiredEvidencePaths.add(evidencePathKey);
      continue;
    }
    if (intent === null) {
      const existing = inspectExactNoFollowDirectoryPresence(
        item.evidence.path,
        'Prior managed generation retirement preimage'
      );
      if (existing.state === 'absent' && !retiredEvidencePaths.has(evidencePathKey)) {
        throw new GitHookTransitionConflict(
          'Prior managed generation disappeared before its durable retirement intent was published'
        );
      }
      publishConfigTransitionRetireIntent(transition, Object.freeze({
        schema: 'sec-managed-hook-config-retire-intent-v1',
        operationDigest: transition.intent.operationDigest,
        index,
        digest: item.digest,
        path: item.evidence.path
      }));
    }
    const current = inspectExactNoFollowDirectoryPresence(
      item.evidence.path,
      'Prior managed generation retirement'
    );
    if (current.state === 'absent') {
      publishConfigTransitionRetiredReceipt(transition, Object.freeze({
        schema: 'sec-managed-hook-config-retired-v1',
        operationDigest: transition.intent.operationDigest,
        index,
        digest: item.digest,
        path: item.evidence.path
      }));
      retiredEvidencePaths.add(evidencePathKey);
      continue;
    }
    if (current.directory === null) {
      throw new GitHookTransitionConflict('Prior managed generation retirement identity is unavailable');
    }
    deleteGenerationByEvidence(
      commonRoot,
      item.evidence,
      'Prior managed generation retirement ' + index
    );
    afterDelete?.(index, item.evidence.path);
    if (
      inspectExactNoFollowDirectoryPresence(
        item.evidence.path,
        'Prior managed generation retirement postimage'
      ).state !== 'absent'
    ) {
      throw new GitHookTransitionConflict('Prior managed generation retirement did not reach absence');
    }
    publishConfigTransitionRetiredReceipt(transition, Object.freeze({
      schema: 'sec-managed-hook-config-retired-v1',
      operationDigest: transition.intent.operationDigest,
      index,
      digest: item.digest,
      path: item.evidence.path
    }));
    retiredEvidencePaths.add(evidencePathKey);
  }
}

function assertConfigTransitionPhysicalCurrent(
  transition: ConfigTransitionHandle,
  commonRoot: PhysicalDirectoryChain
): void {
  const currentTransition = assertRetainedDirectoryChainCurrent(
    transition.chain,
    'Git config transition namespace fence'
  );
  if (!sameChain(transition.chain, currentTransition)) {
    throw new GitHookTransitionConflict('Git config transition namespace ancestor chain changed');
  }
  const currentCommon = assertRetainedDirectoryChainCurrent(
    commonRoot,
    'Git config transition common namespace fence'
  );
  if (!sameChain(commonRoot, currentCommon)) {
    throw new GitHookTransitionConflict('Git config transition common namespace ancestor chain changed');
  }
}

function publishConfigTransitionReceipt(
  transition: ConfigTransitionHandle,
  receipt: ConfigTransitionReceipt
): void {
  publishExclusiveTransitionFile(
    transition.chain,
    transitionStepFileName(receipt.index),
    jsonBytes(receipt),
    'Git config transition step ' + receipt.index
  );
}

function publishConfigTransitionComplete(
  transition: ConfigTransitionHandle,
  receipt: ConfigTransitionCompleteReceipt
): void {
  publishExclusiveTransitionFile(
    transition.chain,
    CONFIG_TRANSITION_COMPLETE_FILE,
    jsonBytes(receipt),
    'Git config transition completion'
  );
}

async function applyConfigTransition(input: {
  readonly transition: ConfigTransitionHandle;
  readonly commonRoot: PhysicalDirectoryChain;
  readonly operationLease: PhysicalMutationLeaseHandle;
  readonly repoRoot: string;
  readonly commonGitDir: string;
  readonly worktreeGitDir: string;
  readonly worktreeConfigPath: string;
  readonly testOnlyCrashAfterConfigStep?: number;
  readonly testOnlyConfigActorBeforeEffect?: (stepIndex: number, repoRoot: string) => void;
  readonly testOnlyConfigActorAfterStep?: (stepIndex: number, repoRoot: string) => void;
  readonly beforeConfigEffect?: () => void | Promise<void>;
  readonly configEffectProvider?: GitPhysicalProviderCapability;
}): Promise<ConfigObservation> {
  const { transition } = input;
  reclaimConfigTransitionLocks({
    transition,
    commonGitDir: input.commonGitDir,
    worktreeConfigPath: input.worktreeConfigPath,
    lease: input.operationLease
  });
  input.operationLease.acknowledgeReclaimedRecovery();
  const durableReceipts: (ConfigTransitionReceipt | null)[] = transition.intent.steps.map((step) => (
    readConfigTransitionStep(transition, step.index)
  ));
  let prefixLength = 0;
  while (prefixLength < durableReceipts.length && durableReceipts[prefixLength] !== null) {
    const receipt = durableReceipts[prefixLength]!;
    const step = transition.intent.steps[prefixLength]!;
    if (
      receipt.operationDigest !== transition.intent.operationDigest
      || receipt.index !== step.index
      || !sameHookConfigState(receipt.after, step.after)
    ) {
      throw new GitHookTransitionConflict('Git config transition durable prefix contains an invalid step receipt');
    }
    prefixLength += 1;
  }
  if (durableReceipts.slice(prefixLength).some((receipt) => receipt !== null)) {
    throw new GitHookTransitionConflict('Git config transition durable steps are not a contiguous prefix');
  }
  let previousReceipt = prefixLength === 0 ? null : durableReceipts[prefixLength - 1]!;
  let prefixObservation = await readHookConfigObservation(
    input.repoRoot,
    input.commonGitDir,
    input.worktreeGitDir,
    input.worktreeConfigPath
  );
  const expectedPrefixBoundary = previousReceipt === null
    ? transition.intent.initialBoundary
    : previousReceipt.boundary;
  if (prefixLength < transition.intent.steps.length) {
    const nextStep = transition.intent.steps[prefixLength]!;
    const prefixBoundaryKey = configBoundaryKey(prefixObservation.boundary);
    const expectedBoundaryKey = configBoundaryKey(expectedPrefixBoundary);
    const isBefore = sameHookConfigState(prefixObservation.state, nextStep.before);
    const isAfter = sameHookConfigState(prefixObservation.state, nextStep.after);
    if (!isBefore && !isAfter) {
      throw new GitHookTransitionConflict('Git hook configuration diverged from the durable config prefix');
    }
    if (isBefore && prefixBoundaryKey !== expectedBoundaryKey) {
      throw new GitHookTransitionConflict('Git hook configuration physical preimage diverged from its durable intent');
    }
    if (
      isAfter
      && !sameHookConfigState(nextStep.before, nextStep.after)
      && prefixBoundaryKey === expectedBoundaryKey
    ) {
      throw new GitHookTransitionConflict('Git hook configuration reached a step after-state without a physical effect boundary');
    }
    // A process can terminate after Git has durably applied a step but before
    // its immutable receipt is published.  The exact next semantic state plus
    // a fresh, valid physical boundary is the only recoverable prefix; all
    // other observations remain an external transition conflict.
    if (isAfter && !isBefore) {
      const recoveredReceipt: ConfigTransitionReceipt = Object.freeze({
        schema: 'sec-managed-hook-config-step-v1',
        operationDigest: transition.intent.operationDigest,
        index: nextStep.index,
        after: nextStep.after,
        boundary: prefixObservation.boundary
      });
      assertConfigTransitionPhysicalCurrent(transition, input.commonRoot);
      publishConfigTransitionReceipt(transition, recoveredReceipt);
      durableReceipts[prefixLength] = recoveredReceipt;
      prefixLength += 1;
      previousReceipt = recoveredReceipt;
      prefixObservation = await readHookConfigObservation(
        input.repoRoot,
        input.commonGitDir,
        input.worktreeGitDir,
        input.worktreeConfigPath
      );
    }
  } else if (
    previousReceipt !== null
    && (
      !sameHookConfigState(prefixObservation.state, transition.intent.target)
      || configBoundaryKey(prefixObservation.boundary) !== configBoundaryKey(previousReceipt.boundary)
    )
  ) {
    throw new GitHookTransitionConflict('Git hook configuration diverged from the durable config prefix');
  }
  for (let stepIndex = prefixLength; stepIndex < transition.intent.steps.length; stepIndex += 1) {
    const step = transition.intent.steps[stepIndex]!;
    assertConfigTransitionPhysicalCurrent(transition, input.commonRoot);
    const observed = await readHookConfigObservation(
      input.repoRoot,
      input.commonGitDir,
      input.worktreeGitDir,
      input.worktreeConfigPath
    );
    const expectedBoundary = previousReceipt === null
      ? transition.intent.initialBoundary
      : previousReceipt.boundary;
    if (
      configBoundaryKey(observed.boundary) !== configBoundaryKey(expectedBoundary)
      && !sameHookConfigState(observed.state, step.after)
    ) {
      throw new GitHookTransitionConflict('Git hook configuration physical preimage changed before step ' + step.index);
    }
    if (!sameHookConfigState(observed.state, step.before)
        && !sameHookConfigState(observed.state, step.after)) {
      throw new GitHookTransitionConflict('Git hook configuration changed before step ' + step.index);
    }
    let after = observed;
    await input.beforeConfigEffect?.();
    const beforeLock = await readHookConfigObservation(
      input.repoRoot,
      input.commonGitDir,
      input.worktreeGitDir,
      input.worktreeConfigPath
    );
    if (
      !sameHookConfigState(beforeLock.state, observed.state)
      || configBoundaryKey(beforeLock.boundary) !== configBoundaryKey(observed.boundary)
    ) {
      throw new GitHookTransitionConflict(
        'Git hook configuration preimage changed before provider lock acquisition for step ' + step.index
      );
    }
    if (sameHookConfigState(observed.state, step.before)
        && !sameHookConfigState(step.before, step.after)) {
      // The test seam runs after the final pre-lock observation so the actor
      // exercises the exact race that a normal Git config writer would face.
      // The actual effect acquires the same canonical <config>.lock first and
      // therefore never overwrites a provider mutation observed in that window.
      input.testOnlyConfigActorBeforeEffect?.(step.index, input.repoRoot);
      if (input.configEffectProvider === undefined) {
        throw new GitHookTransitionConflict('Git config Effect provider is unavailable.');
      }
      after = await writeGitConfigValueCas({
        repoRoot: input.repoRoot,
        commonGitDir: input.commonGitDir,
        worktreeGitDir: input.worktreeGitDir,
        worktreeConfigPath: input.worktreeConfigPath,
        step,
        expected: beforeLock,
        operationDigest: transition.intent.operationDigest,
        lease: input.operationLease,
        configEffectProvider: input.configEffectProvider
      });
    }
    input.testOnlyConfigActorAfterStep?.(step.index, input.repoRoot);
    if (input.testOnlyCrashAfterConfigStep === step.index) {
      throw new GitHookTransitionConflict(
        'Test-only interruption after Git config step ' + step.index + ' effect before receipt publication'
      );
    }
    assertConfigTransitionPhysicalCurrent(transition, input.commonRoot);
    const nextReceipt: ConfigTransitionReceipt = Object.freeze({
      schema: 'sec-managed-hook-config-step-v1',
      operationDigest: transition.intent.operationDigest,
      index: step.index,
      after: step.after,
      boundary: after.boundary
    });
    publishConfigTransitionReceipt(transition, nextReceipt);
    previousReceipt = nextReceipt;
  }
  assertConfigTransitionPhysicalCurrent(transition, input.commonRoot);
  const terminal = await readHookConfigObservation(
    input.repoRoot,
    input.commonGitDir,
    input.worktreeGitDir,
    input.worktreeConfigPath
  );
  if (!sameHookConfigState(terminal.state, transition.intent.target)) {
    throw new GitHookTransitionConflict('Git hook configuration terminal readback differs from its durable target');
  }
  const complete = readConfigTransitionComplete(transition);
  if (complete !== null) {
    if (
      complete.operationDigest !== transition.intent.operationDigest
      || !sameHookConfigState(complete.target, transition.intent.target)
      || configBoundaryKey(complete.boundary) !== configBoundaryKey(terminal.boundary)
    ) {
      throw new GitHookTransitionConflict('Git config transition terminal receipt diverged from readback');
    }
    return terminal;
  }
  publishConfigTransitionComplete(transition, Object.freeze({
    schema: 'sec-managed-hook-config-complete-v1',
    operationDigest: transition.intent.operationDigest,
    target: transition.intent.target,
    boundary: terminal.boundary
  }));
  return terminal;
}

function deleteConfigTransition(
  commonRoot: PhysicalDirectoryChain,
  transition: ConfigTransitionHandle
): void {
  assertConfigTransitionPhysicalCurrent(transition, commonRoot);
  const current = assertRetainedDirectoryChainCurrent(
    transition.chain,
    'Git config transition cleanup root'
  );
  const inventory = scanRetainedTree(current, 'Git config transition cleanup inventory');
  const expectedNames = new Set<string>([
    CONFIG_TRANSITION_PREPARED_FILE,
    CONFIG_TRANSITION_INTENT_FILE,
    CONFIG_TRANSITION_COMPLETE_FILE,
    ...transition.intent.steps.map((step) => transitionStepFileName(step.index)),
    ...transition.intent.priorGenerations.flatMap((_item, index) => [
      transitionRetireIntentFileName(index),
      transitionRetiredFileName(index)
    ])
  ]);
  if (
    inventory.length !== expectedNames.size
    || inventory.some((entry) => (
      entry.kind !== 'file'
      || entry.relativePath.includes('/')
      || !expectedNames.has(entry.relativePath)
      || entry.bytes === null
    ))
  ) {
    throw new GitHookTransitionConflict('Git config transition inventory changed; intent cleanup was retained');
  }
  const expectedByName = new Map<string, Buffer>();
  const prepared = assertPreparedIntentMatchesTransition(
    commonRoot,
    transition,
    'Git config transition cleanup'
  );
  expectedByName.set(CONFIG_TRANSITION_PREPARED_FILE, jsonBytes(prepared));
  expectedByName.set(CONFIG_TRANSITION_INTENT_FILE, jsonBytes(transition.intent));
  for (const step of transition.intent.steps) {
    const receipt = readConfigTransitionStep(transition, step.index);
    if (
      receipt === null
      || receipt.operationDigest !== transition.intent.operationDigest
      || receipt.index !== step.index
      || !sameHookConfigState(receipt.after, step.after)
    ) {
      throw new GitHookTransitionConflict('Git config transition step is not a complete exact prefix; intent cleanup was retained');
    }
    expectedByName.set(transitionStepFileName(step.index), jsonBytes(receipt));
  }
  for (const [index, item] of transition.intent.priorGenerations.entries()) {
    const retireIntent = readConfigTransitionRetireIntent(transition, index);
    const retired = readConfigTransitionRetiredReceipt(transition, index);
    if (
      retireIntent === null
      || retireIntent.operationDigest !== transition.intent.operationDigest
      || retireIntent.index !== index
      || retireIntent.digest !== item.digest
      || canonicalPath(retireIntent.path) !== canonicalPath(item.evidence.path)
      || retired === null
      || retired.operationDigest !== transition.intent.operationDigest
      || retired.index !== index
      || retired.digest !== item.digest
      || canonicalPath(retired.path) !== canonicalPath(item.evidence.path)
    ) {
      throw new GitHookTransitionConflict('Git config prior-generation retirement is not a complete exact prefix');
    }
    expectedByName.set(transitionRetireIntentFileName(index), jsonBytes(retireIntent));
    expectedByName.set(transitionRetiredFileName(index), jsonBytes(retired));
  }
  const complete = readConfigTransitionComplete(transition);
  if (
    complete === null
    || complete.operationDigest !== transition.intent.operationDigest
    || !sameHookConfigState(complete.target, transition.intent.target)
  ) {
    throw new GitHookTransitionConflict('Git config transition has no exact terminal receipt; intent cleanup was retained');
  }
  expectedByName.set(CONFIG_TRANSITION_COMPLETE_FILE, jsonBytes(complete));
  for (const entry of inventory) {
    const expected = expectedByName.get(entry.relativePath);
    if (expected === undefined || !Buffer.from(entry.bytes!).equals(expected)) {
      throw new GitHookTransitionConflict('Git config transition durable file changed; intent cleanup was retained');
    }
  }
  const deletionOrder = [
    ...transition.intent.priorGenerations.flatMap((_item, index) => [
      transitionRetiredFileName(index),
      transitionRetireIntentFileName(index)
    ]),
    ...transition.intent.steps.map((step) => transitionStepFileName(step.index)),
    CONFIG_TRANSITION_COMPLETE_FILE,
    CONFIG_TRANSITION_INTENT_FILE,
    CONFIG_TRANSITION_PREPARED_FILE
  ];
  for (const name of deletionOrder) {
    const entry = inventory.find((candidate) => candidate.relativePath === name);
    if (entry === undefined || entry.bytes === null) {
      throw new GitHookTransitionConflict('Git config transition cleanup inventory lost ' + name);
    }
    const before = assertRetainedDirectoryChainCurrent(
      current,
      'Git config transition cleanup file root'
    );
    if (!sameChain(current, before)) {
      throw new GitHookTransitionConflict('Git config transition cleanup ancestor chain changed');
    }
    const direct = readRetainedFile(before, name, 'Git config transition cleanup file');
    if (
      direct === null
      || direct.bytes === null
      || direct.device !== entry.device
      || direct.inode !== entry.inode
      || !Buffer.from(direct.bytes).equals(Buffer.from(entry.bytes))
    ) {
      throw new GitHookTransitionConflict('Git config transition cleanup file was replaced; intent was retained');
    }
    deleteRetainedEntryBounded({
      root: before.target,
      relativePath: name,
      kind: 'file',
      device: entry.device,
      inode: entry.inode,
      ancestorDirectories: []
    }, 'Git config transition cleanup file');
  }
  const parent = assertRetainedDirectoryChainCurrent(
    commonRoot,
    'Git config transition cleanup parent'
  );
  deleteRetainedEntryBounded({
    root: parent.target,
    relativePath: transition.name,
    kind: 'directory',
    device: transition.chain.target.device,
    inode: transition.chain.target.inode,
    ancestorDirectories: []
  }, 'Git config transition cleanup root');
  if (
    inspectExactNoFollowDirectoryPresence(
      path.join(parent.target.path, transition.name),
      'Git config transition cleanup readback'
    ).state !== 'absent'
  ) {
    throw new GitHookTransitionConflict('Git config transition namespace remained after exact cleanup');
  }
}

function inspectConfigTransitionNamespaces(
  commonRoot: PhysicalDirectoryChain
): readonly Readonly<{ name: string; chain: PhysicalDirectoryChain }>[] {
  const retainedCommonRoot = assertRetainedDirectoryChainCurrent(
    commonRoot,
    'Git config transition namespace inventory root'
  );
  const inventory = scanRetainedTree(commonRoot, 'Git config transition namespace inventory');
  const transitions: Readonly<{ name: string; chain: PhysicalDirectoryChain }>[] = [];
  for (const entry of inventory) {
    if (entry.relativePath.includes('/') || !entry.relativePath.startsWith(CONFIG_TRANSITION_DIRECTORY_PREFIX)) {
      continue;
    }
    if (entry.kind !== 'directory') {
      throw new GitHookTransitionConflict(
        'Unknown or forked Git config transition namespace was retained: ' + entry.relativePath
      );
    }
    const transitionPath = path.join(retainedCommonRoot.target.path, entry.relativePath);
    const presence = inspectExactNoFollowDirectoryPresence(
      transitionPath,
      'Git config transition namespace inventory'
    );
    if (presence.state !== 'present') {
      throw new GitHookTransitionConflict('Git config transition namespace inventory changed');
    }
    assertTransitionDirectoryBound(retainedCommonRoot, presence.directory, 'Git config transition namespace inventory');
    transitions.push(Object.freeze({ name: entry.relativePath, chain: presence.directory }));
  }
  assertRetainedDirectoryChainCurrent(
    retainedCommonRoot,
    'Git config transition namespace inventory root readback'
  );
  return Object.freeze(transitions);
}

function assertKnownConfigTransitionNamespaces(
  commonRoot: PhysicalDirectoryChain,
  expectedName: string
): void {
  for (const transition of inspectConfigTransitionNamespaces(commonRoot)) {
    if (transition.name !== expectedName) {
      throw new GitHookTransitionConflict(
        'Unknown or forked Git config transition namespace was retained: ' + transition.name
      );
    }
  }
}

async function settlePriorCompletedConfigTransitions(input: {
  readonly commonRoot: PhysicalDirectoryChain;
  readonly currentTransitionName: string;
  readonly repoRoot: string;
  readonly commonGitDir: string;
  readonly worktreeGitDir: string;
  readonly worktreeConfigPath: string;
  readonly markerRoot: PhysicalDirectoryChain;
  readonly bootstrapMarkerRoot: PhysicalDirectoryChain;
}): Promise<void> {
  for (const namespace of inspectConfigTransitionNamespaces(input.commonRoot)) {
    if (namespace.name === input.currentTransitionName) continue;
    const intentBytes = transitionFileBytes(namespace.chain, CONFIG_TRANSITION_INTENT_FILE);
    if (intentBytes === null) {
      const preparedBytes = transitionFileBytes(namespace.chain, CONFIG_TRANSITION_PREPARED_FILE);
      if (preparedBytes !== null) {
        const prepared = parseConfigTransitionPreparedIntent(
          preparedBytes,
          'Prior Git config prepared transition intent ' + namespace.name
        );
        if (transitionDirectoryName(prepared.operationDigest) !== namespace.name) {
          throw new GitHookTransitionConflict(
            'Prior prepared Git config transition directory does not match its operation digest: '
              + namespace.name
          );
        }
        throw new GitHookTransitionConflict(
          'Prior Git config prepared transition is incomplete and must be resumed before a new operation: '
            + namespace.name
        );
      }
      throw new GitHookTransitionConflict(
        'Prior Git config transition has no durable intent: ' + namespace.name
      );
    }
    const intent = parseConfigTransitionIntent(
      intentBytes,
      'Prior Git config transition intent ' + namespace.name
    );
    if (transitionDirectoryName(intent.operationDigest) !== namespace.name) {
      throw new GitHookTransitionConflict(
        'Prior Git config transition directory does not match its operation digest: ' + namespace.name
      );
    }
    const complete = readConfigTransitionComplete({
      chain: namespace.chain,
      intent,
      name: namespace.name
    });
    if (complete === null) {
      throw new GitHookTransitionConflict(
        'Prior Git config transition is incomplete and must be resumed before a new operation: ' + namespace.name
      );
    }
    await settleCompletedConfigTransition({
      commonRoot: input.commonRoot,
      transitionName: namespace.name,
      operationDigest: intent.operationDigest,
      repoRoot: input.repoRoot,
      commonGitDir: input.commonGitDir,
      worktreeGitDir: input.worktreeGitDir,
      worktreeConfigPath: input.worktreeConfigPath,
      markerRoot: input.markerRoot,
      bootstrapMarkerRoot: input.bootstrapMarkerRoot
    });
  }
}

async function settleCompletedConfigTransition(input: {
  readonly commonRoot: PhysicalDirectoryChain;
  readonly transitionName: string;
  readonly operationDigest: string;
  readonly repoRoot: string;
  readonly commonGitDir: string;
  readonly worktreeGitDir: string;
  readonly worktreeConfigPath: string;
  readonly markerRoot: PhysicalDirectoryChain;
  readonly bootstrapMarkerRoot: PhysicalDirectoryChain;
  readonly expectedGeneration?: string;
  readonly expectedBootstrap?: string;
}): Promise<boolean> {
  const transitionPath = path.join(input.commonRoot.target.path, input.transitionName);
  const presence = inspectExactNoFollowDirectoryPresence(
    transitionPath,
    'Git config completed transition namespace'
  );
  if (presence.state === 'absent') return false;
  assertTransitionDirectoryBound(
    input.commonRoot,
    presence.directory,
    'Git config completed transition namespace'
  );
  const chain = presence.directory;
  const intentBytes = transitionFileBytes(chain, CONFIG_TRANSITION_INTENT_FILE);
  if (intentBytes === null) {
    throw new GitHookTransitionConflict('Git config completed transition has no durable intent');
  }
  const intent = parseConfigTransitionIntent(
    intentBytes,
    'Git config completed transition intent'
  );
  if (
    intent.operationDigest !== input.operationDigest
    || canonicalPath(intent.commonRoot) !== canonicalPath(input.commonRoot.target.path)
    || intent.commonRootKey !== physicalChainKey(input.commonRoot)
    || canonicalPath(intent.repoRoot) !== canonicalPath(input.repoRoot)
    || canonicalPath(intent.commonGitDir) !== canonicalPath(input.commonGitDir)
    || canonicalPath(intent.worktreeGitDir) !== canonicalPath(input.worktreeGitDir)
    || canonicalPath(intent.worktreeConfigPath) !== canonicalPath(input.worktreeConfigPath)
    || !sameChain(intent.markerRoot, input.markerRoot)
    || !sameChain(intent.bootstrapMarkerRoot, input.bootstrapMarkerRoot)
    || intent.target.worktreeConfig !== 'true'
    || intent.target.commonHooksPath === null
    || intent.target.worktreeHooksPath === null
    || (input.expectedBootstrap !== undefined
      && canonicalPath(resolveGitPath(input.repoRoot, intent.target.commonHooksPath))
        !== canonicalPath(input.expectedBootstrap))
    || (input.expectedGeneration !== undefined
      && canonicalPath(resolveGitPath(input.repoRoot, intent.target.worktreeHooksPath))
        !== canonicalPath(input.expectedGeneration))
  ) {
    throw new GitHookTransitionConflict('Git config completed transition is bound to a different exact target');
  }
  const transition: ConfigTransitionHandle = Object.freeze({
    chain,
    intent,
    name: input.transitionName
  });
  assertPreparedIntentMatchesTransition(
    input.commonRoot,
    transition,
    'Git config completed transition'
  );
  const complete = readConfigTransitionComplete(transition);
  if (
    complete === null
    || complete.operationDigest !== intent.operationDigest
    || !sameHookConfigState(complete.target, intent.target)
  ) {
    throw new GitHookTransitionConflict('Git config completed transition has no exact terminal receipt');
  }
  const currentMarkerRoot = assertRetainedDirectoryChainCurrent(
    input.markerRoot,
    'Git config completed transition marker namespace'
  );
  const currentBootstrapMarkerRoot = assertRetainedDirectoryChainCurrent(
    input.bootstrapMarkerRoot,
    'Git config completed transition bootstrap marker namespace'
  );
  if (
    !sameChain(input.markerRoot, currentMarkerRoot)
    || !sameChain(input.bootstrapMarkerRoot, currentBootstrapMarkerRoot)
    || readMarkerFile(input.markerRoot) === null
    || JSON.stringify(readMarkerFile(input.markerRoot)) !== JSON.stringify(intent.marker)
    || readMarkerFile(input.bootstrapMarkerRoot) === null
    || JSON.stringify(readMarkerFile(input.bootstrapMarkerRoot)) !== JSON.stringify(intent.bootstrapMarker)
  ) {
    throw new GitHookTransitionConflict('Git config completed transition marker evidence diverged');
  }
  assertGenerationPhysicalEvidenceCurrent(
    intent.generation,
    input.commonRoot,
    'Git config completed transition generation'
  );
  assertGenerationPhysicalEvidenceCurrent(
    intent.bootstrapGeneration,
    input.commonRoot,
    'Git config completed transition bootstrap generation'
  );
  const terminal = await readHookConfigObservation(
    input.repoRoot,
    input.commonGitDir,
    input.worktreeGitDir,
    input.worktreeConfigPath
  );
  if (
    !sameHookConfigState(terminal.state, intent.target)
    || configBoundaryKey(terminal.boundary) !== configBoundaryKey(complete.boundary)
  ) {
    throw new GitHookTransitionConflict('Git config completed transition terminal readback diverged');
  }
  retirePriorGenerations(input.commonRoot, transition);
  deleteConfigTransition(input.commonRoot, transition);
  return true;
}

async function readPrimaryBootstrapAuthority(
  primaryRepoRoot: string,
  testOnlyNoRemoteFixture: boolean
): Promise<PrimaryBootstrapAuthority | null> {
  const branch = await gitText(
      primaryRepoRoot,
      ['symbolic-ref', '--quiet', '--short', 'HEAD'],
      { allowMissing: true }
    );
    if (branch !== 'main') return null;
    const localHeadSha = await gitText(
      primaryRepoRoot,
      ['rev-parse', '--verify', 'HEAD^{commit}'],
      { allowMissing: true }
    );
    if (localHeadSha === null || !/^[0-9a-f]{40}$|^[0-9a-f]{64}$/u.test(localHeadSha)) return null;
    const originUrl = await gitText(
      primaryRepoRoot,
      ['remote', 'get-url', 'origin'],
      { allowMissing: true }
    );
    if (originUrl === null || originUrl.length === 0) {
      if (!testOnlyNoRemoteFixture) return null;
      return Object.freeze({
        mode: 'test-no-remote-fixture',
        branch: 'main',
        originUrl: null,
        originHeadRef: null,
        localHeadSha,
        originHeadSha: null
      });
    }
    const originHeadRef = await gitText(
      primaryRepoRoot,
      ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'],
      { allowMissing: true }
    );
    if (originHeadRef !== 'refs/remotes/origin/main') return null;
    const originHeadSha = await gitText(
      primaryRepoRoot,
      ['rev-parse', '--verify', 'refs/remotes/origin/HEAD^{commit}'],
      { allowMissing: true }
    );
    const localDescendsCanonicalHead = originHeadSha !== null
      && await gitText(
        primaryRepoRoot,
        ['merge-base', '--is-ancestor', originHeadSha, localHeadSha],
        { allowMissing: true }
      ) !== null;
    if (!localDescendsCanonicalHead) return null;
  return Object.freeze({
    mode: 'local-tracking-lineage',
    branch: 'main',
    originUrl,
    originHeadRef,
    localHeadSha,
    originHeadSha
  });
}

function bootstrapAuthorityKey(authority: PrimaryBootstrapAuthority): string {
  return JSON.stringify(canonicalJson(authority));
}

function leaseDigest(
  commonRoot: PhysicalDirectoryChain,
  source: SourceContext,
  bootstrap: SourceContext,
  markerRoot: PhysicalDirectoryChain,
  bootstrapMarkerRoot: PhysicalDirectoryChain
): string {
  return createHash('sha256')
    .update('sec-managed-hook-operation-lease-v1\0')
    .update(physicalChainKey(commonRoot))
    .update('\0')
    .update(source.digest)
    .update('\0')
    .update(bootstrap.digest)
    .update('\0')
    .update('bootstrap-authority\0')
    .update(bootstrap.bootstrapAuthority === null
      ? 'none'
      : bootstrapAuthorityKey(bootstrap.bootstrapAuthority))
    .update('\0')
    .update('require-head-tree\0')
    .update(bootstrap.requireHeadTree ? '1' : '0')
    .update('\0')
    .update(physicalChainKey(markerRoot))
    .update('\0')
    .update(physicalChainKey(bootstrapMarkerRoot))
    .digest('hex');
}

async function acquireOperationLease(
  commonRoot: PhysicalDirectoryChain,
  options: {
    readonly ownerHost?: string;
    readonly ownerPid?: number;
  } = {}
): Promise<OperationLease | null> {
  // The canonical physical-mutation lease owns the same common Git
  // namespace as generations, but stores a host/pid/processNonce and
  // creation/expiry record.  Its retained-parent exclusive publication and
  // exact dead-owner reclaim make an interrupted operation recoverable without
  // inventing a second lease protocol in this installer.
  // The lease serializes the whole common Git namespace, not just one source
  // digest.  A digest-specific lease would let a newer source operation run
  // beside an interrupted older operation and strand its provider lock.
  const namespaceDigest = createHash('sha256')
    .update('sec-managed-hook-operation-namespace-lease-v1\0')
    .update(physicalChainKey(commonRoot))
    .digest('hex');
  const name = LEASE_FILE_PREFIX + namespaceDigest;
  try {
    const handle = acquirePhysicalMutationLease(commonRoot.target, name, {
      ownerHost: options.ownerHost,
      ownerPid: options.ownerPid
    });
    if (handle === null) return null;
    return Object.freeze({ commonRoot: commonRoot.target, name, handle });
  } catch (error) {
    throw asTransition(error);
  }
}

function releaseOperationLease(lease: OperationLease): void {
  try {
    if (lease.handle.recoveryPending) lease.handle.restoreReclaimedOwner();
    else lease.handle.release();
  } catch (error) {
    throw asTransition(error);
  }
}

async function cleanupStaleGenerations(
  commonRoot: PhysicalDirectoryChain,
  activePaths: readonly string[],
  known: readonly Readonly<{ digest: string; snapshots: readonly ManagedHookSnapshot[] }>[],
  beforeCleanup?: (generationPath: string) => void
): Promise<void> {
  const retainedCommon = assertRetainedDirectoryChainCurrent(
    commonRoot,
    'Managed generation cleanup parent'
  );
  const active = new Set(activePaths.map(canonicalPath));
  const inventory = scanRetainedTree(commonRoot, 'Managed generation cleanup inventory');
  const generationEntries = inventory.filter((entry) => (
    !entry.relativePath.includes('/')
    && MANAGED_GENERATION_NAME.test(entry.relativePath)
  ));
  if (generationEntries.some((entry) => entry.kind !== 'directory')) {
    throw new GitHookTransitionConflict(
      'Unsafe managed generation entry was retained and blocks cleanup'
    );
  }
  if (generationEntries.length > MAX_MANAGED_GENERATIONS) {
    throw new GitHookTransitionConflict(
      'Managed generation namespace exceeded its bounded capacity; unknown or forked generations were preserved'
    );
  }
  for (const entry of generationEntries) {
    assertRetainedDirectoryChainCurrent(commonRoot, 'Managed generation cleanup parent fence');
    const candidatePath = path.join(retainedCommon.target.path, entry.relativePath);
    if (active.has(canonicalPath(candidatePath))) continue;
    const match = known.find((item) => generationNameMatchesDigest(candidatePath, item.digest));
    if (match === undefined) {
      continue;
    }
    const inspected = await inspectManagedGeneration(candidatePath, match.snapshots);
    if (inspected.state !== 'ready' || inspected.chain === null) {
      throw new GitHookTransitionConflict(
        'Known-digest managed generation fork or replacement was retained: ' + entry.relativePath
      );
    }
    beforeCleanup?.(candidatePath);
    deleteOwnedGeneration(commonRoot, inspected.chain, match.snapshots);
  }
  assertRetainedDirectoryChainCurrent(commonRoot, 'Managed generation cleanup parent readback');
}

function assertManagedGenerationCapacity(
  commonRoot: PhysicalDirectoryChain,
  authorizedPriorPaths: readonly string[],
  additionalGenerationSlots: number,
  label: string
): void {
  const inventory = scanRetainedTree(commonRoot, label + ' inventory');
  const authorizedPrior = new Set(authorizedPriorPaths.map(canonicalPath));
  const generationEntries = inventory.filter((entry) => (
    !entry.relativePath.includes('/')
    && MANAGED_GENERATION_NAME.test(entry.relativePath)
  ));
  if (generationEntries.some((entry) => entry.kind !== 'directory')) {
    throw new GitHookTransitionConflict(
      label + ' contains an unsafe generation entry; it was retained and cannot provide capacity'
    );
  }
  const settledCount = generationEntries.filter((entry) => (
    !authorizedPrior.has(canonicalPath(path.join(commonRoot.target.path, entry.relativePath)))
  )).length;
  if (
    !Number.isSafeInteger(additionalGenerationSlots)
    || additionalGenerationSlots < 0
    || settledCount + additionalGenerationSlots > MAX_MANAGED_GENERATIONS
  ) {
    throw new GitHookTransitionConflict(
      label + ' reached its bounded capacity; unknown or forked generations must be retained and reconciled'
    );
  }
}

async function assertGenerationNamespace(
  commonRoot: PhysicalDirectoryChain,
  activePaths: readonly string[],
  known: readonly Readonly<{
    readonly digest: string;
    readonly snapshots: readonly ManagedHookSnapshot[];
  }>[],
  allowedPriorPaths: readonly string[],
  label: string
): Promise<void> {
  const retainedCommon = assertRetainedDirectoryChainCurrent(commonRoot, label + ' parent');
  const active = new Set(activePaths.map(canonicalPath));
  const allowedPrior = new Set(allowedPriorPaths.map(canonicalPath));
  const inventory = scanRetainedTree(commonRoot, label + ' inventory');
  const generationEntries = inventory.filter((entry) => (
    !entry.relativePath.includes('/')
    && MANAGED_GENERATION_NAME.test(entry.relativePath)
  ));
  if (generationEntries.some((entry) => entry.kind !== 'directory')) {
    throw new GitHookTransitionConflict(
      label + ' contains an unsafe generation entry; it was retained and cannot be adopted'
    );
  }
  const authorizedPriorEntries = generationEntries.filter((entry) => (
    allowedPrior.has(canonicalPath(path.join(retainedCommon.target.path, entry.relativePath)))
  ));
  const settledCount = generationEntries.length - authorizedPriorEntries.length;
  if (settledCount > MAX_MANAGED_GENERATIONS) {
    throw new GitHookTransitionConflict(
      label + ' exceeded its bounded capacity; unknown or forked generations were retained'
    );
  }
  for (const entry of generationEntries) {
    assertRetainedDirectoryChainCurrent(commonRoot, label + ' parent fence');
    const candidatePath = path.join(retainedCommon.target.path, entry.relativePath);
    if (allowedPrior.has(canonicalPath(candidatePath))) continue;
    const knownGeneration = known.find((item) => generationNameMatchesDigest(candidatePath, item.digest));
    if (active.has(canonicalPath(candidatePath))) {
      if (knownGeneration === undefined) {
        throw new GitHookTransitionConflict(
          'Unknown or forked active managed generation was retained and blocks ' + label + ': ' + entry.relativePath
        );
      }
      const activeInspection = await inspectManagedGeneration(candidatePath, knownGeneration.snapshots);
      if (activeInspection.state !== 'ready' || activeInspection.chain === null) {
        throw new GitHookTransitionConflict(
          'Configured managed generation is a fork or replacement and blocks ' + label + ': ' + entry.relativePath
        );
      }
      continue;
    }
    if (knownGeneration !== undefined) {
      const inspected = await inspectManagedGeneration(candidatePath, knownGeneration.snapshots);
      if (inspected.state !== 'ready' || inspected.chain === null) {
        throw new GitHookTransitionConflict(
          'Known-digest managed generation fork or replacement was retained and blocks ' + label + ': ' + entry.relativePath
        );
      }
      continue;
    }
    // An inactive generation without lineage is preserved as bounded residue.
    // It never becomes active or deletion-authorized, and capacity accounting
    // above prevents unbounded accumulation from widening this admission.
    continue;
  }
  assertRetainedDirectoryChainCurrent(commonRoot, label + ' parent readback');
}

/**
 * The post-intent check accepts only evidence already bound into the durable
 * transition.  A caller cannot authorize a stale generation by passing its
 * name; it must pass the immutable physical evidence retained by the intent.
 */
async function assertManagedGenerationNamespaceClean(
  commonRoot: PhysicalDirectoryChain,
  activePaths: readonly string[],
  known: readonly Readonly<{
    readonly digest: string;
    readonly snapshots: readonly ManagedHookSnapshot[];
  }>[],
  intentBoundPrior: readonly GenerationPhysicalEvidence[],
  label: string
): Promise<void> {
  await assertGenerationNamespace(
    commonRoot,
    activePaths,
    known,
    intentBoundPrior.map((evidence) => evidence.path),
    label
  );
}

/**
 * Before the transition intent exists, only an exact lineage capture may
 * provisionally reserve a prior path.  This admission check shares the same
 * namespace classification as the post-intent check but never authorizes a
 * path by name alone: its inputs are the freshly captured evidence paths.
 */
async function assertManagedGenerationNamespaceBeforePublication(
  commonRoot: PhysicalDirectoryChain,
  activePaths: readonly string[],
  known: readonly Readonly<{
    readonly digest: string;
    readonly snapshots: readonly ManagedHookSnapshot[];
  }>[],
  capturedPriorPaths: readonly string[],
  label: string
): Promise<void> {
  await assertGenerationNamespace(
    commonRoot,
    activePaths,
    known,
    capturedPriorPaths,
    label
  );
}

async function installGitHooksInternalWithBudget(options: {
  readonly repoRoot: string;
  readonly lifecycle?: boolean;
  readonly providerResolution?: GitReadSessionResolution;
  readonly observationOnly?: boolean;
  readonly configEffectProvider?: GitPhysicalProviderCapability;
  readonly testOnlyGitBudget?: GitInvocationBudgetOptions;
  readonly testOnlyProviderResolution?: GitReadSessionResolution;
  readonly testOnlyBeforeSpawn?: (kind: GitSpawnKind) => void;
  readonly testOnlyNoRemoteFixture?: boolean;
  readonly testOnlyCrashAfterConfigStep?: number;
  readonly testOnlyConfigActorBeforeEffect?: (stepIndex: number, repoRoot: string) => void;
  readonly testOnlyConfigActorAfterStep?: (stepIndex: number, repoRoot: string) => void;
  readonly testOnlyBeforeGenerationPublication?: (commonRootPath: string) => void;
  readonly testOnlyBeforeGenerationCleanup?: (generationPath: string) => void;
  readonly testOnlyBootstrapAuthorityActorBeforeConfigEffect?: (repoRoot: string) => void;
  readonly testOnlyCrashAfterMarkerPublication?: boolean;
  readonly testOnlyCrashAfterConfigIntent?: boolean;
  readonly testOnlyCrashAfterConfigPrepared?: boolean;
  readonly testOnlyCrashAfterGenerationPublication?: boolean;
  readonly testOnlyCrashAfterGenerationRetirementDelete?: boolean;
  readonly testOnlyCrashAfterOperationLeaseAcquisition?: boolean;
  readonly testOnlyLeaseOwnerHost?: string;
  readonly testOnlyLeaseOwnerPid?: number;
}): Promise<GitHookInstallationResult> {
  const lifecycle = options.lifecycle === true;
  const repoRoot = path.resolve(options.repoRoot);
  const repoRootChain = inspectNoFollowDirectoryChain(repoRoot, 'Git repository root');
  const commonGitDirText = await gitText(
    repoRoot,
    ['rev-parse', '--path-format=absolute', '--git-common-dir']
  );
  const worktreeGitDirText = await gitText(
    repoRoot,
    ['rev-parse', '--path-format=absolute', '--absolute-git-dir']
  );
  if (commonGitDirText === null || worktreeGitDirText === null) {
    throw new GitHookTransitionConflict('Git worktree identity is unavailable');
  }
  const commonGitDir = path.resolve(commonGitDirText);
  const worktreeGitDir = path.resolve(worktreeGitDirText);
  const commonChain = inspectNoFollowDirectoryChain(commonGitDir, 'Repository-common Git directory');
  const worktreeChain = inspectNoFollowDirectoryChain(worktreeGitDir, 'Worktree Git directory');
  const worktreeConfigPathText = await gitText(
    repoRoot,
    ['rev-parse', '--path-format=absolute', '--git-path', 'config.worktree']
  );
  if (worktreeConfigPathText === null) {
    throw new GitHookTransitionConflict('Git worktree config identity is unavailable');
  }
  const worktreeConfigPath = path.resolve(worktreeConfigPathText);
  if (!pathWithin(worktreeGitDir, worktreeConfigPath)) {
    throw new GitHookTransitionConflict('Git worktree config path is outside the exact worktree Git directory');
  }
  const primaryRepoRoot = path.dirname(commonGitDir);
  const primaryChain = inspectNoFollowDirectoryChain(primaryRepoRoot, 'Primary worktree root');
  const primaryTopLevel = await gitText(primaryRepoRoot, ['rev-parse', '--show-toplevel']);
  if (primaryTopLevel === null || canonicalPath(primaryTopLevel) !== canonicalPath(primaryRepoRoot)) {
    throw new GitHookTransitionConflict('Primary worktree bootstrap identity is unavailable');
  }
  const primaryCommonText = await gitText(
    primaryRepoRoot,
    ['rev-parse', '--path-format=absolute', '--git-common-dir']
  );
  if (primaryCommonText === null || canonicalPath(primaryCommonText) !== canonicalPath(commonGitDir)) {
    throw new GitHookTransitionConflict('Primary worktree common Git directory identity differs');
  }
  const initialConfigObservation = await readHookConfigObservation(
    repoRoot,
    commonGitDir,
    worktreeGitDir,
    worktreeConfigPath
  );
  const configPreimage = initialConfigObservation.state;
  const commonConfigured = configPreimage.commonHooksPath;
  const worktreeConfigured = configPreimage.worktreeHooksPath;
  const isPrimaryWorktree = canonicalPath(worktreeGitDir) === canonicalPath(commonGitDir);
  // A managed fast-path read has no effect authority to perform and may
  // reuse a previously verified bootstrap without contacting its remote.
  // Strict live bootstrap binding is acquired only when a new effect or
  // transition settlement is actually needed below.
  const fastSnapshots = await managedHookSnapshots(repoRoot);
  const fastBootstrapSnapshots = isPrimaryWorktree
    ? fastSnapshots
    : await managedHookSnapshots(primaryRepoRoot);
  if (fastSnapshots === null || fastBootstrapSnapshots === null) {
    return stoppedResult(
      'Tracked, executable, index-identical managed hooks are unavailable in the current or primary-bootstrap worktree; Git hook authority was not changed.',
      lifecycle
    );
  }
  const fastSourceContext = await createSourceContext(repoRoot, repoRootChain, commonChain, fastSnapshots);
  const fastBootstrapContext = await createSourceContext(
    primaryRepoRoot,
    primaryChain,
    commonChain,
    fastBootstrapSnapshots
  );
  const commonRootPath = managedCommonRoot(commonGitDir);
  const existingCommonRoot = inspectExistingDirectory(
    commonRootPath,
    'Managed Git hook generation namespace'
  );
  const markerRootExisting = inspectExistingDirectory(
    markerParentPath(worktreeGitDir),
    'Managed Git hook marker namespace'
  );
  const bootstrapMarkerRootExisting = isPrimaryWorktree
    ? markerRootExisting
    : inspectExistingDirectory(
      markerParentPath(commonGitDir),
      'Primary managed Git hook marker namespace'
    );
  const marker = markerRootExisting === null ? null : readMarkerFile(markerRootExisting);
  const bootstrapMarker = isPrimaryWorktree
    ? marker
    : bootstrapMarkerRootExisting === null ? null : readMarkerFile(bootstrapMarkerRootExisting);
  const pendingWorktreeTransition = hasDurablePendingTransitionForConfiguredPath({
    commonRoot: existingCommonRoot,
    configured: worktreeConfigured,
    scope: 'worktree',
    commonGitDir,
    repoRoot
  });
  const pendingCommonTransition = hasDurablePendingTransitionForConfiguredPath({
    commonRoot: existingCommonRoot,
    configured: commonConfigured,
    scope: 'local',
    commonGitDir,
    repoRoot
  });
  assertConfiguredMarkerLineage({
    markerRoot: bootstrapMarkerRootExisting,
    marker: bootstrapMarker,
    configured: commonConfigured,
    scope: 'local',
    commonRoot: existingCommonRoot,
    commonGitDir,
    repoRoot,
    label: 'Repository-common managed hook',
    allowDurablePendingTransition: pendingCommonTransition
  });
  const inheritedCommonLineage = hasValidatedEffectiveHookLineage({
    isPrimaryWorktree,
    markerRoot: bootstrapMarkerRootExisting,
    marker: bootstrapMarker,
    commonRoot: existingCommonRoot,
    commonConfigured,
    worktreeConfigured,
    commonGitDir,
    repoRoot
  });
  assertConfiguredMarkerLineage({
    markerRoot: markerRootExisting,
    marker,
    configured: worktreeConfigured,
    scope: 'worktree',
    commonRoot: existingCommonRoot,
    commonGitDir,
    repoRoot,
    label: 'Worktree managed hook',
    allowDurablePendingTransition: pendingWorktreeTransition,
    allowInheritedCommonLineage: inheritedCommonLineage
  });
  const sourceDigest = fastSourceContext.digest;
  const bootstrapDigest = fastBootstrapContext.digest;
  const primaryBranch = await gitText(
    primaryRepoRoot,
    ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    { allowMissing: true }
  );
  if (
    primaryBranch === 'main'
    && existingCommonRoot !== null
    && markerRootExisting !== null
    && bootstrapMarkerRootExisting !== null
    && marker !== null
    && bootstrapMarker !== null
    && marker.digest === sourceDigest
    && marker.fingerprint === fastSourceContext.fingerprint
    && bootstrapMarker.digest === bootstrapDigest
    && bootstrapMarker.fingerprint === fastBootstrapContext.fingerprint
  ) {
    const expectedGeneration = path.join(commonRootPath, marker.generationName);
    const expectedBootstrap = path.join(commonRootPath, bootstrapMarker.generationName);
    const exactConfig = configPreimage.worktreeConfig === 'true'
      && configPreimage.commonHooksPath !== null
      && configPreimage.worktreeHooksPath !== null
      && canonicalPath(resolveGitPath(repoRoot, configPreimage.commonHooksPath)) === canonicalPath(expectedBootstrap)
      && canonicalPath(resolveGitPath(repoRoot, configPreimage.worktreeHooksPath)) === canonicalPath(expectedGeneration);
    if (
      exactConfig
      && await managedGenerationDigestMatches(expectedGeneration, sourceDigest, fastSnapshots)
      && (expectedBootstrap === expectedGeneration
        || await managedGenerationDigestMatches(expectedBootstrap, bootstrapDigest, fastBootstrapSnapshots))
    ) {
      await assertSourceCurrent(fastSourceContext, 'Managed hook reuse');
      if (!isPrimaryWorktree) await assertSourceCurrent(fastBootstrapContext, 'Managed bootstrap reuse');
      const operationDigest = leaseDigest(
        existingCommonRoot,
        fastSourceContext,
        fastBootstrapContext,
        markerRootExisting,
        bootstrapMarkerRootExisting
      );
      const transitionName = transitionDirectoryName(operationDigest);
      const transitionNamespaces = inspectConfigTransitionNamespaces(existingCommonRoot);
      const pendingTransition = inspectExactNoFollowDirectoryPresence(
        path.join(existingCommonRoot.target.path, transitionName),
        'Git config managed-reuse transition namespace'
      );
      if (options.observationOnly === true) {
        if (transitionNamespaces.length > 0 || pendingTransition.state === 'present') {
          return Object.freeze({
            status: 'installed',
            message: 'Managed Git hook transition settlement is required.'
          });
        }
        await assertManagedGenerationNamespaceClean(
          existingCommonRoot,
          [expectedGeneration, expectedBootstrap],
          [
            { digest: sourceDigest, snapshots: fastSnapshots },
            { digest: bootstrapDigest, snapshots: fastBootstrapSnapshots }
          ],
          [],
          'managed readiness observation'
        );
        return Object.freeze({
          status: 'managed',
          message: 'Git hooks use an exact current managed generation.'
        });
      }
      if (transitionNamespaces.length > 0) {
        const fastLease = await acquireOperationLease(existingCommonRoot);
        if (fastLease === null) {
          return stoppedResult(
            'An equivalent managed Git hook cleanup already holds the operation lease; exact transition settlement was not yet ready.',
            lifecycle
          );
        }
        try {
          await settlePriorCompletedConfigTransitions({
            commonRoot: existingCommonRoot,
            currentTransitionName: transitionName,
            repoRoot,
            commonGitDir,
            worktreeGitDir,
            worktreeConfigPath,
            markerRoot: markerRootExisting,
            bootstrapMarkerRoot: bootstrapMarkerRootExisting
          });
          if (pendingTransition.state === 'present') {
            await settleCompletedConfigTransition({
              commonRoot: existingCommonRoot,
              transitionName,
              operationDigest,
              repoRoot,
              commonGitDir,
              worktreeGitDir,
              worktreeConfigPath,
              markerRoot: markerRootExisting,
              bootstrapMarkerRoot: bootstrapMarkerRootExisting,
              expectedGeneration,
              expectedBootstrap
            });
          }
          assertKnownConfigTransitionNamespaces(existingCommonRoot, transitionName);
          fastLease.handle.acknowledgeReclaimedRecovery();
        } finally {
          releaseOperationLease(fastLease);
        }
      }
      await assertManagedGenerationNamespaceClean(
        existingCommonRoot,
        [expectedGeneration, expectedBootstrap],
        [
          { digest: sourceDigest, snapshots: fastSnapshots },
          { digest: bootstrapDigest, snapshots: fastBootstrapSnapshots }
        ],
        [],
        'managed fast-path reuse'
      );
      return Object.freeze({
        status: 'managed',
        message: 'Git hooks already use the exact physical managed generation ' + expectedGeneration + '.'
      });
    }
  }
  if (options.observationOnly === true) {
    return Object.freeze({
      status: 'installed',
      message: 'Managed Git hook materialization is required.'
    });
  }
  if (
    worktreeConfigured !== null
    && !isManagedCommonSetting(worktreeConfigured, commonGitDir)
  ) {
    return conflictResult(worktreeConfigured, lifecycle);
  }
  if (commonConfigured !== null && !isManagedCommonSetting(commonConfigured, commonGitDir)) {
    return conflictResult(commonConfigured, lifecycle);
  }
  if (commonConfigured === null) {
    const realHook = firstRealHook(path.join(commonGitDir, 'hooks'));
    if (realHook !== null) return conflictResult(realHook, lifecycle);
  }
  const primaryBootstrapAuthority = await readPrimaryBootstrapAuthority(
    primaryRepoRoot,
    options.testOnlyNoRemoteFixture === true
  );
  if (primaryBootstrapAuthority === null) {
    return stoppedResult(
      'Primary worktree is not bound to the exact canonical main bootstrap; Git hook authority was not changed.',
      lifecycle
    );
  }
  const requireHeadTree = primaryBootstrapAuthority.mode !== 'test-no-remote-fixture';
  const snapshots = await managedHookSnapshots(repoRoot, {
    requireHeadTree: isPrimaryWorktree && requireHeadTree
  });
  const bootstrapSnapshots = isPrimaryWorktree
    ? snapshots
    : await managedHookSnapshots(primaryRepoRoot, { requireHeadTree });
  if (snapshots === null || bootstrapSnapshots === null) {
    return stoppedResult(
      'Tracked, executable, index-identical managed hooks are unavailable in the current or primary-bootstrap worktree; Git hook authority was not changed.',
      lifecycle
    );
  }
  const sourceContext = await createSourceContext(
    repoRoot,
    repoRootChain,
    commonChain,
    snapshots,
    {
      bootstrapAuthority: isPrimaryWorktree ? primaryBootstrapAuthority : null,
      requireHeadTree: isPrimaryWorktree && requireHeadTree
    }
  );
  const bootstrapContext = await createSourceContext(
    primaryRepoRoot,
    primaryChain,
    commonChain,
    bootstrapSnapshots,
    { bootstrapAuthority: primaryBootstrapAuthority, requireHeadTree }
  );
  const commonRoot = existingCommonRoot === null
    ? ensureDirectoryNamespace(commonChain, MANAGED_COMMON_DIRECTORY, 'Managed Git hook generation namespace')
    : existingCommonRoot;
  const markerRoot = markerRootExisting === null
    ? ensureDirectoryNamespace(worktreeChain, MANAGED_COMMON_DIRECTORY, 'Managed Git hook marker namespace')
    : markerRootExisting;
  const bootstrapMarkerRoot = isPrimaryWorktree
    ? markerRoot
    : bootstrapMarkerRootExisting === null
      ? ensureDirectoryNamespace(commonChain, MANAGED_COMMON_DIRECTORY, 'Primary managed Git hook marker namespace')
      : bootstrapMarkerRootExisting;
  const operationDigest = leaseDigest(
    commonRoot,
    sourceContext,
    bootstrapContext,
    markerRoot,
    bootstrapMarkerRoot
  );
  const transitionName = transitionDirectoryName(operationDigest);
  const lease = await acquireOperationLease(commonRoot, {
    ownerHost: options.testOnlyLeaseOwnerHost,
    ownerPid: options.testOnlyLeaseOwnerPid
  });
  if (lease === null) {
    return stoppedResult(
      'An equivalent managed Git hook publication already holds the operation lease; exact readback was not yet ready.',
      lifecycle
    );
  }
  if (options.testOnlyCrashAfterOperationLeaseAcquisition === true) {
    throw new GitHookTransitionConflict(
      'Test-only interruption after operation lease acquisition before protected effects'
    );
  }
  let result: GitHookInstallationResult | undefined;
  let operationError: unknown = null;
  try {
    settlePriorCompletedConfigTransitions({
      commonRoot,
      currentTransitionName: transitionName,
      repoRoot,
      commonGitDir,
      worktreeGitDir,
      worktreeConfigPath,
      markerRoot,
      bootstrapMarkerRoot
    });
    assertKnownConfigTransitionNamespaces(commonRoot, transitionName);
    const preferredGeneration = worktreeConfigured !== null
      && isCurrentManagedCommonSetting(worktreeConfigured, commonGitDir)
      ? resolveGitPath(repoRoot, worktreeConfigured)
      : null;
    const preferredBootstrap = commonConfigured !== null
      && isCurrentManagedCommonSetting(commonConfigured, commonGitDir)
      ? resolveGitPath(repoRoot, commonConfigured)
      : null;
    const priorGenerations: Array<Readonly<{
      digest: string;
      snapshots: readonly ManagedHookSnapshot[];
      evidence: GenerationPhysicalEvidence;
    }>> = [];
    const priorGeneration = await capturePriorGenerationForCleanup(
      preferredGeneration,
      marker,
      sourceContext.digest,
      commonRoot,
      'Prior worktree generation',
      {
        expectedSnapshots: snapshots,
        markerRoot,
        configuredPath: preferredGeneration!,
        scope: 'worktree',
        repoRoot,
        commonGitDir,
        worktreeGitDir,
        worktreeConfigPath
      }
    );
    if (
      priorGeneration !== null
      && !priorGenerations.some((prior) => (
        canonicalPath(prior.evidence.path) === canonicalPath(priorGeneration.evidence.path)
      ))
    ) priorGenerations.push(priorGeneration);
    const priorBootstrap = await capturePriorGenerationForCleanup(
      preferredBootstrap,
      bootstrapMarker,
      bootstrapContext.digest,
      commonRoot,
      'Prior bootstrap generation',
      {
        expectedSnapshots: bootstrapSnapshots,
        markerRoot: bootstrapMarkerRoot,
        configuredPath: preferredBootstrap!,
        scope: 'local',
        repoRoot,
        commonGitDir,
        worktreeGitDir,
        worktreeConfigPath
      }
    );
    if (
      priorBootstrap !== null
      && !priorGenerations.some((prior) => (
        canonicalPath(prior.evidence.path) === canonicalPath(priorBootstrap.evidence.path)
      ))
    ) priorGenerations.push(priorBootstrap);
    await assertManagedGenerationNamespaceBeforePublication(
      commonRoot,
      [preferredGeneration, preferredBootstrap].filter((value): value is string => value !== null),
      [
        { digest: sourceContext.digest, snapshots },
        { digest: bootstrapContext.digest, snapshots: bootstrapSnapshots }
      ],
      priorGenerations.map((prior) => prior.evidence.path),
      'managed generation publication admission'
    );
    assertManagedGenerationCapacity(
      commonRoot,
      priorGenerations.map((prior) => prior.evidence.path),
      isPrimaryWorktree ? 1 : 2,
      'Managed generation namespace before publication'
    );
    const preEffectObservation = await readHookConfigObservation(
      repoRoot,
      commonGitDir,
      worktreeGitDir,
      worktreeConfigPath
    );
    if (!sameHookConfigState(preEffectObservation.state, configPreimage)) {
      throw new GitHookTransitionConflict('Git hook configuration changed before the durable publication admission');
    }
    await assertSourceCurrent(sourceContext, 'Managed hook publication admission');
    if (!isPrimaryWorktree) await assertSourceCurrent(bootstrapContext, 'Managed bootstrap publication admission');
    const plannedGeneration = await planManagedGenerationPath(
      commonRoot,
      sourceContext.binding,
      snapshots,
      preferredGeneration
    );
    const plannedBootstrapGeneration = isPrimaryWorktree
      ? plannedGeneration
      : await planManagedGenerationPath(
        commonRoot,
        bootstrapContext.binding,
        bootstrapSnapshots,
        preferredBootstrap
      );
    const generationPlan = makeGenerationPlan(plannedGeneration, snapshots);
    const bootstrapGenerationPlan = isPrimaryWorktree
      ? generationPlan
      : makeGenerationPlan(plannedBootstrapGeneration, bootstrapSnapshots);
    const postimage: HookConfigState = Object.freeze({
      worktreeConfig: 'true',
      commonHooksPath: plannedBootstrapGeneration.path,
      worktreeHooksPath: plannedGeneration.path
    });
    const markerRecord: HookMarkerRecord = Object.freeze({
      digest: sourceContext.digest,
      fingerprint: sourceContext.fingerprint,
      generationName: path.basename(plannedGeneration.path)
    });
    const bootstrapMarkerRecord: HookMarkerRecord = Object.freeze({
      digest: bootstrapContext.digest,
      fingerprint: bootstrapContext.fingerprint,
      generationName: path.basename(plannedBootstrapGeneration.path)
    });
    const preparedTransition = ensureConfigTransitionPrepared({
      commonRoot,
      operationDigest,
      repoRoot,
      commonGitDir,
      worktreeGitDir,
      worktreeConfigPath,
      preimage: preEffectObservation.state,
      target: postimage,
      initialBoundary: preEffectObservation.boundary,
      markerRoot,
      bootstrapMarkerRoot,
      marker: markerRecord,
      bootstrapMarker: bootstrapMarkerRecord,
      generation: generationPlan,
      bootstrapGeneration: bootstrapGenerationPlan,
      priorGenerations: priorGenerations.map((prior) => Object.freeze({
        digest: prior.digest,
        evidence: prior.evidence
      }))
    });
    if (options.testOnlyCrashAfterConfigPrepared === true) {
      throw new GitHookTransitionConflict(
        'Test-only interruption after durable config prepared intent publication'
      );
    }
    const generation = await materializeManagedGeneration(
      commonRoot,
      sourceContext.binding,
      snapshots,
      sourceContext,
      preferredGeneration,
      preparedTransition.intent.generation.path,
      options.testOnlyBeforeGenerationPublication
    );
    if (options.testOnlyCrashAfterGenerationPublication === true) {
      throw new GitHookTransitionConflict(
        'Test-only interruption after managed generation publication before config intent'
      );
    }
    const bootstrapGeneration = isPrimaryWorktree
      ? generation
      : await materializeManagedGeneration(
        commonRoot,
        bootstrapContext.binding,
        bootstrapSnapshots,
        bootstrapContext,
        preferredBootstrap,
        preparedTransition.intent.bootstrapGeneration.path,
        options.testOnlyBeforeGenerationPublication
      );
    await assertSourceCurrent(sourceContext, 'Managed hook configuration fence');
    if (!isPrimaryWorktree) await assertSourceCurrent(bootstrapContext, 'Managed bootstrap configuration fence');
    const generationEvidence = generationPhysicalEvidence(
      generation,
      snapshots,
      'Managed hook generation intent'
    );
    const bootstrapGenerationEvidence = isPrimaryWorktree
      ? generationEvidence
      : generationPhysicalEvidence(
        bootstrapGeneration,
        bootstrapSnapshots,
        'Managed bootstrap generation intent'
      );
    const configTransition = ensureConfigTransition({
      commonRoot,
      operationDigest,
      repoRoot,
      commonGitDir,
      worktreeGitDir,
      worktreeConfigPath,
      preimage: preEffectObservation.state,
      target: postimage,
      initialBoundary: preEffectObservation.boundary,
      markerRoot,
      bootstrapMarkerRoot,
      marker: markerRecord,
      bootstrapMarker: bootstrapMarkerRecord,
      generation: generationEvidence,
      bootstrapGeneration: bootstrapGenerationEvidence,
      generationPlan,
      bootstrapGenerationPlan,
      priorGenerations: priorGenerations.map((prior) => Object.freeze({
        digest: prior.digest,
        evidence: prior.evidence
      }))
    });
    if (options.testOnlyCrashAfterConfigIntent === true) {
      throw new GitHookTransitionConflict(
        'Test-only interruption after config transition intent publication'
      );
    }
    await assertManagedGenerationNamespaceClean(
      commonRoot,
      [generation.path, bootstrapGeneration.path],
      [
        { digest: sourceContext.digest, snapshots },
        { digest: bootstrapContext.digest, snapshots: bootstrapSnapshots }
      ],
      configTransition.intent.priorGenerations.map((prior) => prior.evidence),
      'managed generation publication'
    );
    const configAfterObservation = await applyConfigTransition({
      transition: configTransition,
      commonRoot,
      operationLease: lease.handle,
      repoRoot,
      commonGitDir,
      worktreeGitDir,
      worktreeConfigPath,
      ...(options.configEffectProvider === undefined
        ? {}
        : { configEffectProvider: options.configEffectProvider }),
      testOnlyCrashAfterConfigStep: options.testOnlyCrashAfterConfigStep,
      testOnlyConfigActorBeforeEffect: options.testOnlyConfigActorBeforeEffect,
      testOnlyConfigActorAfterStep: options.testOnlyConfigActorAfterStep,
      beforeConfigEffect: async () => {
        options.testOnlyBootstrapAuthorityActorBeforeConfigEffect?.(repoRoot);
        await assertBootstrapAuthorityCurrent(
          bootstrapContext,
          'Managed hook configuration effect fence'
        );
      }
    });
    if (!sameHookConfigState(configAfterObservation.state, postimage)) {
      throw new GitHookTransitionConflict('Git hook configuration changed during final exact readback');
    }
    await assertSourceCurrent(sourceContext, 'Managed hook final readback');
    if (!isPrimaryWorktree) await assertSourceCurrent(bootstrapContext, 'Managed bootstrap final readback');
    if (!await managedGenerationDigestMatches(generation.path, generation.digest, snapshots)) {
      throw new GitHookTransitionConflict('Managed hook generation changed during final readback');
    }
    if (
      !isPrimaryWorktree
      && !await managedGenerationDigestMatches(
        bootstrapGeneration.path,
        bootstrapGeneration.digest,
        bootstrapSnapshots
      )
    ) {
      throw new GitHookTransitionConflict('Managed bootstrap generation changed during final readback');
    }
    await assertSourceCurrent(sourceContext, 'Managed hook marker effect fence');
    if (!isPrimaryWorktree) await assertSourceCurrent(bootstrapContext, 'Managed bootstrap marker effect fence');
    await assertBootstrapAuthorityCurrent(bootstrapContext, 'Managed hook marker effect fence');
    writeMarkerFile(markerRoot, markerRecord);
    if (!isPrimaryWorktree) {
      writeMarkerFile(bootstrapMarkerRoot, bootstrapMarkerRecord);
    }
    const markerAfter = readMarkerFile(markerRoot);
    const bootstrapMarkerAfter = isPrimaryWorktree
      ? markerAfter
      : readMarkerFile(bootstrapMarkerRoot);
    if (
      markerAfter === null
      || markerAfter.digest !== sourceContext.digest
      || markerAfter.fingerprint !== sourceContext.fingerprint
      || markerAfter.generationName !== path.basename(generation.path)
      || bootstrapMarkerAfter === null
      || bootstrapMarkerAfter.digest !== bootstrapContext.digest
      || bootstrapMarkerAfter.fingerprint !== bootstrapContext.fingerprint
      || bootstrapMarkerAfter.generationName !== path.basename(bootstrapGeneration.path)
    ) {
      throw new GitHookTransitionConflict('Managed hook marker final readback differs');
    }
    await assertSourceCurrent(sourceContext, 'Managed hook marker final readback');
    if (!isPrimaryWorktree) await assertSourceCurrent(bootstrapContext, 'Managed bootstrap marker final readback');
    const finalConfig = (await readHookConfigObservation(
      repoRoot,
      commonGitDir,
      worktreeGitDir,
      worktreeConfigPath
    )).state;
    if (!sameHookConfigState(finalConfig, postimage)) {
      throw new GitHookTransitionConflict('Git hook configuration changed after marker publication');
    }
    if (options.testOnlyCrashAfterMarkerPublication === true) {
      throw new GitHookTransitionConflict(
        'Test-only interruption after managed marker publication before transition cleanup'
      );
    }
    retirePriorGenerations(
      commonRoot,
      configTransition,
      options.testOnlyCrashAfterGenerationRetirementDelete === true
        ? (index) => {
          throw new GitHookTransitionConflict(
            'Test-only interruption after prior generation retirement delete at index ' + index
          );
        }
        : undefined
    );
    await cleanupStaleGenerations(
      commonRoot,
      [generation.path, bootstrapGeneration.path],
      [
        { digest: sourceContext.digest, snapshots },
        { digest: bootstrapContext.digest, snapshots: bootstrapSnapshots }
      ],
      options.testOnlyBeforeGenerationCleanup
    );
    const afterCleanupConfig = (await readHookConfigObservation(
      repoRoot,
      commonGitDir,
      worktreeGitDir,
      worktreeConfigPath
    )).state;
    if (!sameHookConfigState(afterCleanupConfig, postimage)) {
      throw new GitHookTransitionConflict('Git hook configuration changed during managed cleanup');
    }
    deleteConfigTransition(commonRoot, configTransition);
    const previouslyManaged = configPreimage.worktreeConfig === 'true'
      && configPreimage.commonHooksPath !== null
      && configPreimage.worktreeHooksPath !== null
      && canonicalPath(resolveGitPath(repoRoot, configPreimage.commonHooksPath)) === canonicalPath(bootstrapGeneration.path)
      && canonicalPath(resolveGitPath(repoRoot, configPreimage.worktreeHooksPath)) === canonicalPath(generation.path);
    result = Object.freeze({
      status: previouslyManaged ? 'managed' : 'installed',
      message: previouslyManaged
        ? 'Git hooks already use worktree-bound generation ' + generation.path + '.'
        : 'Configured worktree core.hooksPath=' + generation.path
          + '; repository bootstrap remains ' + bootstrapGeneration.path + '.'
    });
  } catch (error) {
    operationError = asTransition(error);
  }
  let releaseError: unknown = null;
  if (!(operationError instanceof GitHookTransitionConflict && operationError.retainOperationLease)) {
    try {
      releaseOperationLease(lease);
    } catch (error) {
      releaseError = asTransition(error);
    }
  }
  if (operationError !== null) {
    if (releaseError !== null) {
      throw new GitHookTransitionConflict(
        errorMessage(operationError) + '; operation lease release was not proven: ' + errorMessage(releaseError)
      );
    }
    throw operationError;
  }
  if (releaseError !== null) throw releaseError;
  if (result === undefined) throw new GitHookTransitionConflict('Managed Git hook operation produced no result');
  return result;
}

async function installGitHooksInternal(
  options: Parameters<typeof installGitHooksInternalWithBudget>[0]
): Promise<GitHookInstallationResult> {
  if (options.providerResolution !== undefined && options.testOnlyProviderResolution !== undefined) {
    throw new GitHookTransitionConflict('Git installer received competing production and test providers');
  }
  return await withGitInvocationBudget(
    () => installGitHooksInternalWithBudget(options),
    options.testOnlyGitBudget,
    options.providerResolution ?? options.testOnlyProviderResolution,
    options.testOnlyBeforeSpawn
  );
}

function conflictResult(configured: string, lifecycle: boolean): GitHookInstallationResult {
  return stoppedResult(
    'Existing Git hook authority is preserved at ' + configured + '; integrate ' + MANAGED_PRE_COMMIT + ' manually.',
    lifecycle
  );
}

async function withInstallResources<T>(input: Readonly<{
  repoRoot: string;
  lifecycle: boolean;
  providerResolution?: GitReadSessionResolution;
  use: (
    operation: BoundSemanticOperation,
    processSession: ProcessResourceSession,
    providerResolution: GitReadSessionResolution,
    configProvider: GitPhysicalProviderCapability | undefined
  ) => Promise<T>;
}>): Promise<T> {
  const deadlineAtUnixMs = Date.now() + DEFAULT_GIT_INVOCATION_BUDGET.deadlineMs;
  const operation = compileInstallOperation({
    repoRoot: input.repoRoot,
    lifecycle: input.lifecycle,
    deadlineAtUnixMs
  });
  return await withAcquiredResource({
    operationLabel: 'hook-install',
    resourceLabel: 'process-resource-session',
    acquire: () => openProcessResourceSession({
      operation,
      requirementBindingContext: issueOperationRequirementBindingContext({
        operation,
        requirementId: INSTALL_REQUIREMENT,
        resourceCeilings: operation.plan.execution.aggregateBudgets
      })
    }),
    use: async (processSession) => {
      const useResolution = async (providerResolution: GitReadSessionResolution): Promise<T> => {
        if (providerResolution.status !== 'ready') {
          return await input.use(operation, processSession, providerResolution, undefined);
        }
        const executable = providerResolution.session.gitExecutableIdentity?.realPath;
        if (executable === undefined) {
          throw new GitHookTransitionConflict('Git config Effect requires one retained Git executable identity.');
        }
        const resolution = openGitPhysicalProvider({
          cwd: input.repoRoot,
          executablePath: path.resolve(executable),
          operation,
          processSession,
          environment: providerResolution.session.env,
          environmentSource: {},
          maximumExecutableBytes: providerResolution.session.budget.maxExecutableBytes
        });
        if (resolution.status !== 'ready') {
          throw new GitHookTransitionConflict(
            `Git config Effect provider is unavailable (${resolution.reason}).`
          );
        }
        return await withAcquiredResource({
          operationLabel: 'hook-install',
          resourceLabel: 'git-config-provider',
          acquire: () => resolution.capability,
          use: (configProvider) => input.use(
            operation,
            processSession,
            providerResolution,
            configProvider
          ),
          release(configProvider) {
            assertGitPhysicalProviderReceipt(closeGitPhysicalProvider(configProvider), configProvider);
          }
        });
      };
      if (input.providerResolution !== undefined) {
        return await useResolution(input.providerResolution);
      }
      return await withAuthorityGitReadSession({
        cwd: input.repoRoot,
        operation,
        processSession,
        budget: DEFAULT_GIT_INVOCATION_BUDGET,
        deadlineAtUnixMs
      }, (session) => useResolution(Object.freeze({
        status: 'ready' as const,
        route: session.providerRoute,
        session
      })));
    },
    release(processSession) {
      assertProcessResourceSessionReceipt(processSession.close(), {
        operationIdentityDigest: operation.plan.identity.identityDigest,
        boundAttemptDigest: operation.boundAttemptDigest,
        requirementId: INSTALL_REQUIREMENT
      });
    }
  });
}

async function installWithProvider(
  options: Readonly<{ repoRoot: string; lifecycle?: boolean }>,
  providerResolution: GitReadSessionResolution,
  configEffectProvider: GitPhysicalProviderCapability
): Promise<GitHookInstallationResult> {
  try {
    return await installGitHooksInternal({
      ...options,
      providerResolution,
      configEffectProvider
    });
  } catch (error) {
    const conflict = asTransition(error);
    if (options.lifecycle === true) {
      return Object.freeze({ status: 'conflict', message: conflict.message });
    }
    throw conflict;
  }
}

export async function installGitHooks(options: {
  readonly repoRoot: string;
  readonly lifecycle?: boolean;
}): Promise<GitHookInstallationResult> {
  try {
    const repoRoot = path.resolve(options.repoRoot);
    return await withInstallResources({
      repoRoot,
      lifecycle: options.lifecycle === true,
      use: async (_operation, _processSession, providerResolution, configProvider) => {
        if (providerResolution.status !== 'ready' || configProvider === undefined) {
          throw new GitHookTransitionConflict('Git hook installer provider admission is unresolved.');
        }
        return await installWithProvider(
          { ...options, repoRoot },
          providerResolution,
          configProvider
        );
      }
    });
  } catch (error) {
    const conflict = asTransition(error);
    if (options.lifecycle === true) {
      return Object.freeze({ status: 'conflict', message: conflict.message });
    }
    throw conflict;
  }
}

/**
 * Reuses the caller's exact production Git observation and parent process
 * session. The scoped config provider borrows that ledger and is settled here;
 * no independent process session is opened.
 */
export async function installGitHooksWithSession(options: {
  readonly repoRoot: string;
  readonly lifecycle?: boolean;
  readonly session: GitReadSession;
  readonly operation: BoundSemanticOperation;
  readonly processSession: ProcessResourceSession;
}): Promise<GitHookInstallationResult> {
  if (!isProductionGitReadSession(options.session)) {
    throw new Error('Managed Git hook materialization requires a production Git session.');
  }
  const repoRoot = path.resolve(options.repoRoot);
  if (path.resolve(options.session.cwd) !== repoRoot) {
    throw new Error('Managed Git hook materialization session targets another worktree.');
  }
  if (options.session.failure !== null || options.session.gitExecutableIdentity === null) {
    throw new Error('Managed Git hook materialization requires one live retained Git provider.');
  }
  const resolution = openGitPhysicalProvider({
    cwd: repoRoot,
    executablePath: path.resolve(options.session.gitExecutableIdentity.realPath),
    operation: options.operation,
    processSession: options.processSession,
    environment: options.session.env,
    environmentSource: {},
    maximumExecutableBytes: options.session.budget.maxExecutableBytes
  });
  if (resolution.status !== 'ready') {
    throw new Error(`Managed Git hook config Effect provider is unavailable (${resolution.reason}).`);
  }
  const provider = resolution.capability;
  let result: GitHookInstallationResult | undefined;
  let primaryFailure: Readonly<{ error: unknown }> | undefined;
  let providerCloseFailure: Readonly<{ error: unknown }> | undefined;
  try {
    result = await installGitHooksInternal({
      repoRoot,
      ...(options.lifecycle === undefined ? {} : { lifecycle: options.lifecycle }),
      configEffectProvider: provider,
      providerResolution: Object.freeze({
        status: 'ready' as const,
        route: options.session.providerRoute,
        session: options.session
      })
    });
  } catch (error) {
    primaryFailure = Object.freeze({ error });
  }
  try {
    const receipt = closeGitPhysicalProvider(provider);
    assertGitPhysicalProviderReceipt(receipt, provider);
  } catch (error) {
    providerCloseFailure = Object.freeze({ error });
  }
  if (primaryFailure !== undefined && providerCloseFailure !== undefined) {
    throw new AggregateError(
      [primaryFailure.error, providerCloseFailure.error],
      'Managed Git hook materialization and provider close both failed.'
    );
  }
  if (primaryFailure !== undefined) throw primaryFailure.error;
  if (providerCloseFailure !== undefined) throw providerCloseFailure.error;
  if (result === undefined) {
    throw new Error('Managed Git hook materialization produced no terminal result.');
  }
  return result;
}

export async function observeManagedGitHooksWithSession(options: {
  readonly repoRoot: string;
  readonly session: GitReadSession;
}): Promise<ManagedGitHookReadinessObservation> {
  if (!isProductionGitReadSession(options.session)) {
    throw new Error('Managed Git hook observation requires a production Git session.');
  }
  const repoRoot = path.resolve(options.repoRoot);
  if (path.resolve(options.session.cwd) !== repoRoot) {
    throw new Error('Managed Git hook observation session targets another worktree.');
  }
  const result = await installGitHooksInternal({
    repoRoot,
    observationOnly: true,
    providerResolution: Object.freeze({
      status: 'ready' as const,
      route: options.session.providerRoute,
      session: options.session
    })
  });
  const disposition = result.status === 'managed' ? 'ready' : 'materialization-required';
  const observationDigest = sha256({
    owner: 'development.hooks', repoRoot, disposition, result
  }) as `sha256:${string}`;
  return Object.freeze({
    disposition,
    observationDigest
  });
}

/**
 * Explicit test-only provider for isolated repositories with no remote.  The
 * production CLI never parses or forwards this authority mode.
 */
export async function installGitHooksForTest(options: {
  readonly repoRoot: string;
  readonly lifecycle?: boolean;
  readonly noRemoteFixture?: boolean;
  readonly gitBudget?: GitInvocationBudgetOptions;
  readonly providerResolutionForTest?: GitReadSessionResolution;
  readonly beforeSpawnForTest?: (kind: GitSpawnKind) => void;
  readonly crashAfterConfigStep?: number;
  readonly configActorBeforeEffect?: (stepIndex: number, repoRoot: string) => void;
  readonly configActorAfterStep?: (stepIndex: number, repoRoot: string) => void;
  readonly beforeGenerationPublication?: (commonRootPath: string) => void;
  readonly beforeGenerationCleanup?: (generationPath: string) => void;
  readonly bootstrapAuthorityActorBeforeConfigEffect?: (repoRoot: string) => void;
  readonly crashAfterMarkerPublication?: boolean;
  readonly crashAfterConfigIntent?: boolean;
  readonly crashAfterConfigPrepared?: boolean;
  readonly crashAfterGenerationPublication?: boolean;
  readonly crashAfterGenerationRetirementDelete?: boolean;
  readonly crashAfterOperationLeaseAcquisition?: boolean;
  readonly leaseOwnerHost?: string;
  readonly leaseOwnerPid?: number;
}): Promise<GitHookInstallationResult> {
  try {
    const repoRoot = path.resolve(options.repoRoot);
    return await withInstallResources({
      repoRoot,
      lifecycle: options.lifecycle === true,
      ...(options.providerResolutionForTest === undefined
        ? {}
        : { providerResolution: options.providerResolutionForTest }),
      use: async (_operation, _processSession, providerResolution, configProvider) => await installGitHooksInternal({
        repoRoot,
        lifecycle: options.lifecycle,
        ...(configProvider === undefined ? {} : { configEffectProvider: configProvider }),
        testOnlyGitBudget: options.gitBudget,
        testOnlyProviderResolution: providerResolution,
        testOnlyBeforeSpawn: options.beforeSpawnForTest,
        testOnlyNoRemoteFixture: options.noRemoteFixture !== false,
        testOnlyCrashAfterConfigStep: options.crashAfterConfigStep,
        testOnlyConfigActorBeforeEffect: options.configActorBeforeEffect,
        testOnlyConfigActorAfterStep: options.configActorAfterStep,
        testOnlyBeforeGenerationPublication: options.beforeGenerationPublication,
        testOnlyBeforeGenerationCleanup: options.beforeGenerationCleanup,
        testOnlyBootstrapAuthorityActorBeforeConfigEffect:
          options.bootstrapAuthorityActorBeforeConfigEffect,
        testOnlyCrashAfterMarkerPublication: options.crashAfterMarkerPublication,
        testOnlyCrashAfterConfigIntent: options.crashAfterConfigIntent,
        testOnlyCrashAfterConfigPrepared: options.crashAfterConfigPrepared,
        testOnlyCrashAfterGenerationPublication: options.crashAfterGenerationPublication,
        testOnlyCrashAfterGenerationRetirementDelete:
          options.crashAfterGenerationRetirementDelete,
        testOnlyCrashAfterOperationLeaseAcquisition: options.crashAfterOperationLeaseAcquisition,
        testOnlyLeaseOwnerHost: options.leaseOwnerHost,
        testOnlyLeaseOwnerPid: options.leaseOwnerPid
      })
    });
  } catch (error) {
    const conflict = asTransition(error);
    if (options.lifecycle === true) {
      return Object.freeze({ status: 'conflict', message: conflict.message });
    }
    throw conflict;
  }
}

async function installGitHooksMainWithBudget(options: {
  readonly argv?: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly providerResolution: GitReadSessionResolution;
}): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const unknownArguments = argv.filter((argument) => argument !== '--lifecycle');
  if (unknownArguments.length > 0) {
    console.error('Unknown Git hook installer argument: ' + unknownArguments.join(', '));
    return 1;
  }
  const lifecycle = argv.includes('--lifecycle');
  const env = options.env ?? process.env;
  if (lifecycle && (env.CI === 'true' || env.CI === '1')) {
    console.log('Skipped Git hook installation in CI lifecycle.');
    return 0;
  }
  try {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    let repoRoot: string | null;
    try {
      repoRoot = await gitText(cwd, ['rev-parse', '--show-toplevel']);
    } catch (error) {
      // Lifecycle mode may skip a genuinely Gitless checkout, but it must
      // never turn an authority-provider admission failure into a successful
      // no-op.  The provider gate runs before this first child, so rethrowing
      // keeps unsupported/unknown Windows providers typed and zero-effect.
      if (
        !lifecycle
        || !(error instanceof GitHookTransitionConflict)
        || error.providerAdmission !== null
      ) throw error;
      console.warn('Skipped Git hook installation because no Git worktree is available.');
      return 0;
    }
    if (repoRoot === null || repoRoot.length === 0) throw new Error('Git repository root is unavailable');
    const result = await installGitHooks({ repoRoot, lifecycle });
    if (result.status === 'conflict') console.warn(result.message);
    else console.log(result.message);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export async function installGitHooksMain(options: {
  readonly argv?: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
} = {}): Promise<number> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  return await withAuthorityGitReadSession({
    cwd,
    source: isolatedGitReadEnvironment(options.env ?? process.env),
    budget: DEFAULT_GIT_INVOCATION_BUDGET
  }, async (session) => {
    const providerResolution = Object.freeze({
      status: 'ready' as const,
      route: session.providerRoute,
      session
    });
    return await withGitInvocationBudget(
      () => installGitHooksMainWithBudget({ ...options, cwd, providerResolution }),
      {},
      providerResolution
    );
  });
}

if (import.meta.main) {
  process.exitCode = await installGitHooksMain();
}
