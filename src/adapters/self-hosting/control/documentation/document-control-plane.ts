import { AsyncLocalStorage } from 'node:async_hooks';
import { realpathSync } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { rawSha256Hex, rawSha256, sha256 } from '../../../../contracts/canonical.ts';
import { enableExecutionProgress, observeExecutionProgressPhase, reportExecutionProgress } from '../../../../execution/execution-progress.ts';
import { withWorkspaceWriteLease } from '../../../filesystem/write-lease.ts';
import { GitReadAuthorityError, withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import {
  createAuthorityGitScratchIndexTreeSession,
  isolatedGitReadEnvironment,
  type GitReadHostProviderResolutionReason,
  type GitReadSession,
  type GitReadSessionFailure,
  type GitScratchIndexTreeFailureReason,
  type GitScratchIndexTreeSession
} from '../../../providers/git-read/runtime/session.ts';
import type { GitHubApiCapability } from '../../../providers/github-api/operation-session.ts';
import { compileRepositoryModuleMembership } from '../../../repository/architecture/contract.ts';
import {
  createNoFollowDirectoryCreateTestActorForTests,
  createNoFollowOrdinaryDirectoryChain,
  createRetainedNoFollowFileTransactionTestActorForTests,
  deleteRetainedNoFollowEntry,
  flushNoFollowDirectory,
  inspectNoFollowDirectoryChain,
  inspectNoFollowDirectoryLeaf,
  inspectNoFollowOrdinaryFileEntry,
  PhysicalNoFollowError,
  readNoFollowOrdinaryFile,
  retainNoFollowFileTransaction,
  scanNoFollowDirectoryDirectMetadata,
  type PhysicalDirectoryIdentity,
  type RetainedNoFollowFileObservation,
  type RetainedNoFollowFileTransaction
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { GIT_READ_OPERATION_BUDGET } from '../../development/tooling/git/git-read.ts';
import {
  assertMainHealthPublicationAuthorityStable,
  observeCanonicalMainHealthForDocumentControlTesting,
  observeCanonicalMainHealthForPublication,
  observeMainHealthGitHubControlInventory,
  observeMainHealthGitHubDefaultBranchSha,
  withMainHealthGitHubReadSession
} from '../main-health/work-selection-main-health.ts';
import {
  issueActiveWorkPackageOwnerObservation,
  type ActiveWorkPackageOwnerObservation
} from '../task/contract/active-work-observation.ts';
import {
  ParseCurrentWorkPackageManifest,
  WorkPackageManifestDigest
} from '../task/contract/work-package.ts';
import {
  assertRoadmapTerminalCompactionCandidate,
  projectWorkRollingExactManifestBinding
} from '../work-selection/live-contract.ts';
import {
  observeWorkSelectionLive,
  observeWorkSelectionWithProvider,
  type WorkSelectionProvider
} from '../work-selection/runtime.ts';
import {
  AssertControlPlaneBinding,
  AssertInitiallyAbsentEntryTransition,
  AssertPriorFreezeProjection,
  AssertRollingMachineBaseBinding,
  ClassifyFreezeConvergence,
  ClassifyInitiallyAbsentEntryTuple,
  ClassifyPublishedControlBinding,
  ClassifyTerminalRetirementPrefix,
  CreateFreezeProjection,
  DocumentControlRecoveryEntryStem,
  ParseActivePointer,
  ParseCurrentStateSpec,
  ParseRollingMachineProjection,
  ParseRollingPlan,
  ParseRollingPlanHeadings,
  RequiresCommittedCandidateProjectionRefresh,
  ResolveActiveWorkPackage,
  ResolveWorkSelectionProjectionMode,
  type ActiveWorkPackageResolution,
  type CommittedCandidateReplanAuthority,
  type DefaultRefState,
  type DocumentControlRecoveryTargetKey,
  type InitiallyAbsentTupleEdge,
  type InitiallyAbsentTupleEntry,
  type InitiallyAbsentTuplePlatform,
  type InitiallyAbsentTupleState,
  type MainHealthRepairProjection,
  type WorkSelectionProjection
} from './document-control-plane-contract.ts';
import {
  buildGitHubOpenInventoryCountsArgs,
  buildGitHubOpenIssuesArgs,
  buildGitHubOpenPullRequestReviewThreadsArgs,
  buildGitHubOpenPullRequestsArgs,
  buildGitHubPullRequestReviewThreadsArgs,
  parseExactGitHubNumberedInventory,
  parseGitHubOpenInventoryCounts,
  parseGitHubOpenPullRequestReviewThreadPages,
  parseGitHubPullRequestReviewThreadPages,
  parseGitHubRepositoryIdentityFromRemoteUrl,
  replaceIncompleteGitHubReviewThreads,
  type GitHubReviewThreadConnection
} from './document-control-plane-github-observation.ts';

/**
 * One production read composition for the required Work Package admission.
 * Repair routing is observed first; ordinary WorkSelection is queried only
 * when that exact observation admits the ordinary lane. Nested provider calls
 * reuse the same MainHealth session and therefore one total request budget.
 */
export async function observeDocumentControlWorkRouting(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  exactMainSha: string;
  exactMainTreeSha: string;
}>): Promise<Readonly<{
  repairDecision: Awaited<ReturnType<typeof observeCanonicalMainHealthForPublication>>['repairDecision'];
  selection: Awaited<ReturnType<typeof observeWorkSelectionLive>> | null;
}>> {
  const testActor = documentControlRoutingTestScope.getStore();
  if (testActor !== undefined) {
    if (documentControlHostCliTestScope.getStore() !== documentControlHostCliTestIssuer
        || !documentControlRoutingTestActors.has(testActor)) {
      throw new Error('Document-control test routing actor is absent, forged, or outside its host test scope.');
    }
    const capability = testActor.githubCapability(input.repositoryRoot);
    return await testActor.withGitHubCapability(capability, async () => {
      const jointInput = Object.freeze({
        repositoryRoot: input.repositoryRoot,
        repository: input.repository,
        defaultBranch: input.defaultBranch,
        mainSha: input.exactMainSha,
        mainTreeSha: input.exactMainTreeSha,
        capability,
        environment: testActor.mainHealthEnvironment(input.repositoryRoot)
      });
      const first = await observeCanonicalMainHealthForDocumentControlTesting(jointInput);
      const second = await observeCanonicalMainHealthForDocumentControlTesting(jointInput);
      if (first.stableDigest !== second.stableDigest) {
        throw new Error('document-control test MainHealth snapshot drifted between T1 and T2');
      }
      const selection = second.repairDecision.routingState === 'ordinary-only'
        ? await observeWorkSelectionWithProvider({
            cwd: input.repositoryRoot,
            exactMain: input.exactMainSha,
            exactMainTree: input.exactMainTreeSha
          }, testActor.workSelectionProvider, async () => second.projection)
        : null;
      return Object.freeze({ repairDecision: second.repairDecision, selection });
    });
  }
  return await withMainHealthGitHubReadSession({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    operation: async () => {
      const snapshotInput = Object.freeze({
        repositoryRoot: input.repositoryRoot,
        repository: input.repository,
        defaultBranch: input.defaultBranch,
        mainSha: input.exactMainSha,
        mainTreeSha: input.exactMainTreeSha
      });
      const first = await observeCanonicalMainHealthForPublication(snapshotInput);
      // T2 remains inside the outer MainHealth session, so credential,
      // request-count, response-byte and total-deadline budgets cannot reset.
      const second = await observeCanonicalMainHealthForPublication(snapshotInput);
      assertMainHealthPublicationAuthorityStable(first.authority, second.authority);
      if (first.stableDigest !== second.stableDigest) {
        throw new Error('document-control MainHealth snapshot drifted between T1 and T2');
      }
      const repairDecision = second.repairDecision;
      const selection = repairDecision.routingState === 'ordinary-only'
          ? await observeWorkSelectionLive({
            cwd: input.repositoryRoot,
            exactMain: input.exactMainSha,
            exactMainTree: input.exactMainTreeSha,
            mainHealthSnapshot: second.workSelectionSnapshot
          })
        : null;
      return Object.freeze({ repairDecision, selection });
    }
  });
}

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type CommandOptions = {
  readonly input?: string | Uint8Array;
  readonly environment?: Readonly<Record<string, string>>;
};

type DocumentControlByteCommandResult = Readonly<{
  code: number;
  stdout: Uint8Array;
  stderr: string;
}>;

/**
 * Git observations consume the canonical production GitRead session. Git
 * object/index writes and GitHub calls remain separate semantic capabilities;
 * neither can inherit authority from the read session or raw transport.
 */
export type DocumentControlCliOperation =
  | 'git-read'
  | 'git-object-index-effect'
  | 'github-api-read'
  | 'github-effect';

export type DocumentControlCliAdmissionStatus =
  | 'unsupported'
  | 'unknown'
  | 'unavailable';

export type DocumentControlCliAdmissionReason =
  | GitReadHostProviderResolutionReason
  | GitReadSessionFailure['reason']
  | GitScratchIndexTreeFailureReason
  | 'semantic-closure-unproven'
  | 'working-directory-binding-drift';

export class DocumentControlCliAdmissionError extends Error {
  readonly code = 'DOCUMENT-CONTROL-CLI-ADMISSION-001' as const;
  readonly command: 'git' | 'gh';
  readonly operation: DocumentControlCliOperation;
  readonly status: DocumentControlCliAdmissionStatus;
  readonly reason: DocumentControlCliAdmissionReason;
  readonly detailDigest: `sha256:${string}`;

  constructor(input: Readonly<{
    command: 'git' | 'gh';
    operation: DocumentControlCliOperation;
    status: DocumentControlCliAdmissionStatus;
    reason: DocumentControlCliAdmissionReason;
    detailDigest: `sha256:${string}`;
  }>) {
    super(`Document-control ${input.command} ${input.operation} admission is ${input.status}.`);
    this.name = 'DocumentControlCliAdmissionError';
    this.command = input.command;
    this.operation = input.operation;
    this.status = input.status;
    this.reason = input.reason;
    this.detailDigest = input.detailDigest;
  }
}

const documentControlHostCliTestScope = new AsyncLocalStorage<symbol>();
const documentControlHostCliTestIssuer = Symbol('sec-document-control-host-cli-test-issuer-v1');
const documentControlGitReadScope = new AsyncLocalStorage<GitReadSession>();
export interface DocumentControlRoutingTestActor {
  readonly githubCapability: (repositoryRoot: string) => GitHubApiCapability;
  readonly withGitHubCapability: <T>(
    capability: GitHubApiCapability,
    operation: () => Promise<T>
  ) => Promise<T>;
  readonly workSelectionProvider: WorkSelectionProvider;
  readonly mainHealthEnvironment: (repositoryRoot: string) => NodeJS.ProcessEnv;
  readonly hostCliProvider: (
    command: 'git' | 'gh',
    args: readonly string[],
    cwd: string,
    options: CommandOptions
  ) => Promise<DocumentControlByteCommandResult> | DocumentControlByteCommandResult;
}
const documentControlRoutingTestActors = new WeakSet<object>();
const documentControlRoutingTestScope = new AsyncLocalStorage<DocumentControlRoutingTestActor>();

/** @internal Issues one isolated routing composition for document lifecycle tests. */
export function createDocumentControlRoutingTestActorForTests(
  actor: DocumentControlRoutingTestActor
): DocumentControlRoutingTestActor {
  const issued = Object.freeze({ ...actor });
  documentControlRoutingTestActors.add(issued);
  return issued;
}

/**
 * @internal Test-only host transport scope for the crash/CAS fixture suite.
 * Production callers must never import this seam; the provider-boundary
 * contract scans the production tree and rejects such a consumer. The
 * AsyncLocalStorage binding prevents a test fixture from changing the
 * process-global production route or leaking into an unrelated async task.
 */
export function withDocumentControlHostCliTestSession<T>(
  operation: () => T,
  routingActor?: DocumentControlRoutingTestActor
): T {
  if (routingActor !== undefined && !documentControlRoutingTestActors.has(routingActor)) {
    throw new Error('Document-control routing test actor is forged.');
  }
  return documentControlHostCliTestScope.run(documentControlHostCliTestIssuer, () => (
    routingActor === undefined ? operation() : documentControlRoutingTestScope.run(routingActor, operation)
  ));
}

function documentControlCliFailureDigest(input: Readonly<{
  command: 'git' | 'gh';
  operation: DocumentControlCliOperation;
  status: DocumentControlCliAdmissionStatus;
  reason: DocumentControlCliAdmissionReason;
  sourceDetailDigest?: `sha256:${string}`;
}>): `sha256:${string}` {
  return sha256({
    schema: 'sec-document-control-cli-admission-failure-v1',
    ...input
  }) as `sha256:${string}`;
}

function commandOperation(
  command: 'git' | 'gh',
  args: readonly string[]
): DocumentControlCliOperation {
  if (command === 'gh') {
    // The current document-control GitHub calls are all reads.  Keep the
    // effect category explicit for future callers so a new mutation cannot
    // inherit a read-session contract accidentally.
    return args.some((arg, index) => (
      arg === '--method=POST'
      || (arg === '--method' && args[index + 1] === 'POST')
    ))
      ? 'github-effect'
      : 'github-api-read';
  }
  const verb = args[0] ?? '';
  const objectOrIndexEffect = verb === 'write-tree'
    || (verb === 'hash-object' && args.includes('-w'))
    || verb === 'update-index'
    || verb === 'read-tree'
    || verb === 'index-pack';
  return objectOrIndexEffect ? 'git-object-index-effect' : 'git-read';
}

function documentControlCliFailure(
  command: 'git' | 'gh',
  operation: DocumentControlCliOperation,
  status: DocumentControlCliAdmissionStatus,
  reason: DocumentControlCliAdmissionReason,
  sourceDetailDigest?: `sha256:${string}`
): DocumentControlCliAdmissionError {
  return new DocumentControlCliAdmissionError({
    command,
    operation,
    status,
    reason,
    detailDigest: documentControlCliFailureDigest({
      command,
      operation,
      status,
      reason,
      ...(sourceDetailDigest === undefined ? {} : { sourceDetailDigest })
    })
  });
}

const ExternalCommandTimeoutMs = 30_000;
// One freeze holds one Git-read operation from admission through terminal
// verification and recovery retirement. These are maxima for the normal
// three-file control projection: entry (9), historical committed replan (21),
// staged snapshot (16), immutable baseline (4), branch/default-target (2),
// index paths (2), scratch build (11), and pre-journal fence (2).
const FreezePreparationRootCommands = 9 + 21 + 16 + 4 + 2 + 2 + 11 + 2;
// After PRE is journaled: index paths/materialization (13), published index
// snapshot (12), retired-manifest fence (2), terminal verification (12), and
// two semantic index checks during recovery retirement (12).
const FreezeContinuationRootCommands = 13 + 12 + 2 + 12 + 12;
// Scratch build and object materialization each issue three hash-object stdin
// commands and one update-index stdin command on the admitted Windows route.
const FreezePreparationStdinWorkers = process.platform === 'win32' ? 4 : 0;
const FreezeContinuationStdinWorkers = process.platform === 'win32' ? 4 : 0;
// A child without a retained Job controller can need both graceful and forced
// native termination helpers. This is a settlement reserve, not a retry budget.
const FreezeNativeSettlementReserve = 2;
const FreezeContinuationNativeResources = FreezeContinuationRootCommands
  + FreezeContinuationStdinWorkers + FreezeNativeSettlementReserve;
const FreezeNativeResourceBudget = FreezePreparationRootCommands
  + FreezePreparationStdinWorkers + FreezeContinuationNativeResources;
const FreezeGitReadBudget = Object.freeze({
  ...GIT_READ_OPERATION_BUDGET,
  maxProcesses: FreezeNativeResourceBudget
});
const CurrentStatePath = 'config/repository/current-state.yaml';
const ActivePointerPath = 'config/repository/active-work-package.md';
const RollingPlanPath = 'config/repository/rolling-plan.md';
const LegacyFreezeJournalSchema = 'sec-document-control-plane-freeze-journal-v4' as const;
const FreezeJournalSchema = 'sec-document-control-plane-freeze-journal-v5' as const;
const LegacyFreezeResultSchema = 'sec-document-control-plane-freeze-result-v1' as const;
const FreezeResultSchema = 'sec-document-control-plane-freeze-result-v2' as const;
const FreezeJournalRelativePath = '.tmp/codex/document-control-plane-freeze-v1/journal.json';

export type FreezeFault =
  | 'after-journal-prepare'
  | 'after-index-lock-write'
  | 'after-index-pre-quarantine'
  | 'after-index-next-install'
  | 'after-index-publish'
  | 'after-journal-index-published-pre-quarantine'
  | 'after-journal-index-published-next-install'
  | 'after-pointer-temp-write'
  | 'after-pointer-pre-quarantine'
  | 'after-pointer-next-install'
  | 'after-pointer-publish'
  | 'after-journal-pointer-published-pre-quarantine'
  | 'after-rolling-temp-write'
  | 'after-rolling-pre-quarantine'
  | 'after-rolling-next-install'
  | 'after-rolling-publish'
  | 'after-journal-rolling-published-pre-quarantine'
  | 'after-journal-terminal-pre-quarantine'
  | 'after-journal-terminal-next-install'
  | 'after-terminal';

export type DurabilityStage =
  | 'renamed'
  | 'file-flushed'
  | 'parent-barrier';

export interface DurabilityEvent {
  readonly label: string;
  readonly targetPath: string;
  readonly stage: DurabilityStage;
}

type AnchoredObjectIdentity = Readonly<{ device: string; inode: string }> | string;

interface RetainedPublishObjectAuthority {
  readonly transaction: RetainedNoFollowFileTransaction;
  readonly observation: RetainedNoFollowFileObservation;
  readonly relativePath: string;
}

function sameAnchoredObjectIdentity(
  left: AnchoredObjectIdentity,
  right: AnchoredObjectIdentity
): boolean {
  if (typeof left === 'string' || typeof right === 'string') {
    return typeof left === 'string' && left === right;
  }
  return left.device === right.device && left.inode === right.inode;
}

export type DurabilityObserver = (
  event: DurabilityEvent
) => Promise<void> | void;

export class DurabilityBarrierError extends Error {
  readonly code = 'DOCUMENT-CONTROL-DURABILITY-001' as const;
  readonly operation: 'file-flush' | 'parent-directory-barrier';
  readonly targetPath: string;

  constructor(input: {
    operation: 'file-flush' | 'parent-directory-barrier';
    targetPath: string;
    cause: unknown;
  }) {
    super(
      `Document control ${input.operation} is unsupported or failed for ${input.targetPath}.`,
      { cause: input.cause }
    );
    this.name = 'DurabilityBarrierError';
    this.operation = input.operation;
    this.targetPath = input.targetPath;
  }
}

export class UnsafeAnchoredPathError extends Error {
  readonly code = 'DOCUMENT-CONTROL-UNSAFE-PATH-001' as const;
  readonly targetPath: string;
  readonly reparseTag: number | null;

  constructor(input: {
    label: string;
    targetPath: string;
    reparseTag?: number;
    cause?: unknown;
  }) {
    super(
      `${input.label} must not traverse or target a symbolic link, junction, or reparse point.`,
      input.cause === undefined ? undefined : { cause: input.cause }
    );
    this.name = 'UnsafeAnchoredPathError';
    this.targetPath = input.targetPath;
    this.reparseTag = input.reparseTag ?? null;
  }
}

export class UnsupportedAnchoredPathEffectError extends Error {
  readonly code = 'DOCUMENT-CONTROL-POSIX-CAPABILITY-001' as const;
  readonly capability: string;

  constructor(capability: string) {
    super(`Anchored document-control POSIX effects require the ${capability} capability.`);
    this.name = 'UnsupportedAnchoredPathEffectError';
    this.capability = capability;
  }
}

interface FreezeDurabilityOptions {
  readonly observer?: DurabilityObserver;
  /** Internal deterministic test seam. Production always uses the platform barrier. */
  readonly parentDirectoryBarrier?: (directoryPath: string) => Promise<void>;
  /** Internal deterministic test seam invoked only after rename source/parent anchors are open. */
  readonly beforeAnchoredRename?: (event: Readonly<{
    label: string;
    sourcePath: string;
    targetPath: string;
  }>) => Promise<void> | void;
  /** Internal deterministic test seam after namespace mutation and before its retained-object flush. */
  readonly afterAnchoredNamespaceMutationBeforeFlush?: (event: Readonly<{
    label: string;
    sourcePath: string;
    targetPath: string;
  }>) => Promise<void> | void;
  /** Internal deterministic seam after containing-parent anchors are retained and before creation. */
  readonly beforeAnchoredCreate?: (event: Readonly<{
    label: string;
    kind: 'directory' | 'file';
    parentPath: string;
    targetPath: string;
  }>) => void;
  /** Internal deterministic seam after exact cleanup bytes are read from the opened object. */
  readonly beforeAnchoredCleanup?: (event: Readonly<{
    label: string;
    filePath: string;
  }>) => Promise<void> | void;
  /** Internal Linux-only deterministic seam after exact PRE recovery link identity readback. */
  readonly afterExactPreRecoveryLink?: (event: Readonly<{
    label: string;
    targetPath: string;
    recoveryPath: string;
  }>) => Promise<void> | void;
  readonly beforeCreatedParentBarrier?: (event: Readonly<{
    parentPath: string;
    createdPath: string;
  }>) => void;
  readonly createdParentBarrierObserver?: (event: Readonly<{
    parentPath: string;
    createdPath: string;
  }>) => void;
}

type FreezeJournalPhase =
  | 'prepared'
  | 'index-published'
  | 'pointer-published'
  | 'rolling-published'
  | 'terminal';

export interface FreezeResult {
  readonly schema: typeof LegacyFreezeResultSchema | typeof FreezeResultSchema;
  readonly status: 'ACTIVATED_INDEX_PENDING_COMMIT' | 'PROPOSED';
  readonly operationId: `sha256:${string}`;
  readonly baseSha: string;
  readonly baseTreeSha: string;
  readonly candidateTreeSha: string;
  readonly candidateHeadSha: null;
  readonly manifestPath: string;
  readonly manifestDigest: `sha256:${string}`;
  readonly indexPublished: true;
  readonly worktreeProjected: true;
}

/** The prior operation is settled; a composing owner must open a new session for the requested freeze. */
export class PriorFreezeOperationRetiredError extends Error {
  readonly code = 'DOCUMENT-CONTROL-PRIOR-FREEZE-RETIRED' as const;
  readonly priorOperationId: `sha256:${string}`;
  readonly repositoryRoot: string;
  readonly nextOperationStarted = false as const;

  constructor(priorOperationId: `sha256:${string}`, repositoryRoot: string) {
    super('Prior terminal freeze was verified and retired; the requested new freeze has not started.');
    this.priorOperationId = priorOperationId;
    this.repositoryRoot = repositoryRoot;
  }
}

interface FreezeJournalFile {
  readonly pre: string;
  readonly next: string;
}

interface FreezeJournal {
  readonly schema: typeof LegacyFreezeJournalSchema | typeof FreezeJournalSchema;
  readonly authoringDisposition?: 'activation' | 'proposal-only';
  readonly operationId: `sha256:${string}`;
  readonly phase: FreezeJournalPhase;
  readonly manifestPath: string;
  readonly manifestDigest: `sha256:${string}`;
  readonly reviewedOn: string;
  readonly baseSha: string;
  readonly baseTreeSha: string;
  readonly preIndexTreeSha: string;
  readonly candidateTreeSha: string;
  readonly files: Readonly<{
    manifest: FreezeJournalFile;
    pointer: FreezeJournalFile;
    rollingPlan: FreezeJournalFile;
  }>;
  readonly index: FreezeJournalFile;
  readonly indexTransportDigest: `sha256:${string}`;
  readonly result: FreezeResult;
}

interface ControlIndexSnapshot {
  readonly treeSha: string;
  readonly index: AnchoredIndexSnapshot;
  readonly stateBytes: Buffer;
  readonly pointerBytes: Buffer;
  readonly rollingPlanBytes: Buffer;
  readonly stateSource: string;
  readonly pointerSource: string;
  readonly rollingPlanSource: string;
  readonly candidateManifestBlob: Buffer | undefined;
  readonly targetManifestBlob: Buffer | undefined;
  readonly roadmapBlob: Buffer | undefined;
  readonly indexPaths: readonly string[];
  readonly stagedPaths: readonly string[];
  readonly worktreeStatus: string;
}

function systemErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function isMissingError(error: unknown): boolean {
  return systemErrorCode(error) === 'ENOENT'
    || (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT');
}

function pathComparisonValue(candidate: string): string {
  const resolved = path.resolve(candidate);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function assertPathContained(root: string, candidate: string, label: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new UnsafeAnchoredPathError({ label, targetPath: candidate });
  }
}

function physicalIdentity(entry: Readonly<{ device: string; inode: string }>): Readonly<{ device: string; inode: string }> {
  return Object.freeze({ device: entry.device, inode: entry.inode });
}

function transactionRelativePath(boundaryRoot: string, candidatePath: string, label: string): string {
  assertPathContained(boundaryRoot, candidatePath, label);
  const relative = path.relative(path.resolve(boundaryRoot), path.resolve(candidatePath));
  if (relative.length === 0) {
    throw new UnsafeAnchoredPathError({ label, targetPath: candidatePath });
  }
  return relative;
}

function mapDocumentPhysicalError(error: unknown, input: Readonly<{
  label: string;
  targetPath: string;
  operation?: 'file-flush' | 'parent-directory-barrier';
}>): never {
  if (error instanceof DurabilityBarrierError
      || error instanceof UnsafeAnchoredPathError
      || error instanceof UnsupportedAnchoredPathEffectError) throw error;
  if (error instanceof PhysicalNoFollowError) {
    if (error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') {
      throw Object.assign(new Error(`${input.label} is absent.`, { cause: error }), { code: 'ENOENT' });
    }
    if (error.code === 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED' && input.operation !== undefined) {
      throw new DurabilityBarrierError({
        operation: input.operation,
        targetPath: input.targetPath,
        cause: error
      });
    }
    if (error.code === 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE') {
      throw new UnsupportedAnchoredPathEffectError(error.code);
    }
    if (error.code === 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH'
        || error.code === 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED') {
      throw new UnsafeAnchoredPathError({
        label: input.label,
        targetPath: input.targetPath,
        cause: error
      });
    }
    throw error;
  }
  throw error;
}

async function canonicalDirectoryBoundary(root: string, label: string): Promise<string> {
  try {
    return inspectNoFollowDirectoryChain(path.resolve(root), label).target.path;
  } catch (error) {
    return mapDocumentPhysicalError(error, { label, targetPath: root });
  }
}

function scanDirectDirectoryNames(directoryPath: string, label: string): readonly string[] {
  const directory = inspectNoFollowDirectoryChain(path.resolve(directoryPath), label).target;
  return Object.freeze(scanNoFollowDirectoryDirectMetadata(directory, {
    deadlineAtMs: performance.now() + 30_000,
    maximumEntries: 10_000
  }).map((entry) => entry.relativePath).sort());
}

async function inspectSafePath(input: {
  boundaryRoot: string;
  candidatePath: string;
  label: string;
  finalKind: 'file' | 'directory';
  allowMissing: boolean;
}): Promise<string | null> {
  const boundary = inspectNoFollowDirectoryChain(path.resolve(input.boundaryRoot), `${input.label} boundary`).target;
  const candidate = path.resolve(input.candidatePath);
  assertPathContained(boundary.path, candidate, input.label);
  try {
    if (input.finalKind === 'directory') {
      return inspectNoFollowDirectoryChain(candidate, input.label).target.path;
    }
    const parent = inspectNoFollowDirectoryChain(path.dirname(candidate), `${input.label} parent`).target;
    const entry = inspectNoFollowOrdinaryFileEntry(parent, path.basename(candidate));
    if (entry === null) {
      if (input.allowMissing) return null;
      throw Object.assign(new Error(`${input.label} is absent.`), { code: 'ENOENT' });
    }
    return candidate;
  } catch (error) {
    if (input.allowMissing && isMissingError(error)) return null;
    return mapDocumentPhysicalError(error, { label: input.label, targetPath: candidate });
  }
}

async function ensureSafeDirectory(input: {
  boundaryRoot: string;
  directoryPath: string;
  label: string;
  durability?: FreezeDurabilityOptions;
}): Promise<string> {
  const boundary = inspectNoFollowDirectoryChain(path.resolve(input.boundaryRoot), `${input.label} boundary`).target;
  const relative = transactionRelativePath(boundary.path, input.directoryPath, input.label);
  const segments = relative.split(path.sep);
  try {
    const testActor = input.durability === undefined || (
      input.durability.beforeAnchoredCreate === undefined
      && input.durability.beforeCreatedParentBarrier === undefined
      && input.durability.createdParentBarrierObserver === undefined
    ) ? undefined : createNoFollowDirectoryCreateTestActorForTests({
      ...(input.durability.beforeAnchoredCreate === undefined ? {} : {
        beforeCreate: (event) => input.durability?.beforeAnchoredCreate?.({
          label: input.label,
          kind: 'directory',
          parentPath: event.parentPath,
          targetPath: event.targetPath
        })
      }),
      ...(input.durability.beforeCreatedParentBarrier === undefined ? {} : {
        beforeParentBarrier: (event) => {
          try {
            input.durability?.beforeCreatedParentBarrier?.(event);
          } catch (error) {
            throw new DurabilityBarrierError({
              operation: 'parent-directory-barrier',
              targetPath: event.parentPath,
              cause: error
            });
          }
        }
      }),
      ...(input.durability.createdParentBarrierObserver === undefined ? {} : {
        durabilityObserver: input.durability.createdParentBarrierObserver
      })
    });
    let current = boundary;
    for (const segment of segments) {
      const existing = inspectNoFollowDirectoryLeaf(current, segment, input.label);
      if (existing !== null) {
        current = existing;
        continue;
      }
      current = createNoFollowOrdinaryDirectoryChain(current, [segment], testActor);
    }
    return current.path;
  } catch (error) {
    return mapDocumentPhysicalError(error, { label: input.label, targetPath: input.directoryPath });
  }
}

function readPhysicalFile(boundaryRoot: string, filePath: string, label: string): Buffer | null {
  const candidate = path.resolve(filePath);
  assertPathContained(boundaryRoot, candidate, label);
  try {
    const parent = inspectNoFollowDirectoryChain(path.dirname(candidate), `${label} parent`).target;
    const bytes = readNoFollowOrdinaryFile(parent, path.basename(candidate));
    return bytes === null ? null : Buffer.from(bytes);
  } catch (error) {
    if (isMissingError(error)) return null;
    return mapDocumentPhysicalError(error, { label, targetPath: candidate });
  }
}

async function readSafeRegularFile(input: {
  boundaryRoot: string;
  filePath: string;
  label: string;
}): Promise<Buffer> {
  const bytes = readPhysicalFile(input.boundaryRoot, input.filePath, input.label);
  if (bytes === null) throw Object.assign(new Error(`${input.label} is absent.`), { code: 'ENOENT' });
  return bytes;
}

async function readOptionalSafeRegularFile(input: {
  boundaryRoot: string;
  filePath: string;
  label: string;
}): Promise<Buffer | null> {
  return readPhysicalFile(input.boundaryRoot, input.filePath, input.label);
}

async function observeOptionalSafeRegularFile(input: {
  boundaryRoot: string;
  filePath: string;
  label: string;
}): Promise<Readonly<{ bytes: Buffer; identity: AnchoredObjectIdentity }> | null> {
  const candidate = path.resolve(input.filePath);
  assertPathContained(input.boundaryRoot, candidate, input.label);
  try {
    const parent = inspectNoFollowDirectoryChain(path.dirname(candidate), `${input.label} parent`).target;
    const entry = inspectNoFollowOrdinaryFileEntry(parent, path.basename(candidate));
    return entry === null ? null : Object.freeze({
      bytes: Buffer.from(entry.bytes!),
      identity: physicalIdentity(entry)
    });
  } catch (error) {
    if (isMissingError(error)) return null;
    return mapDocumentPhysicalError(error, { label: input.label, targetPath: candidate });
  }
}

async function withRetainedPhysicalTransaction<T>(
  boundaryRoot: string,
  label: string,
  operation: (transaction: RetainedNoFollowFileTransaction) => Promise<T> | T,
  durability?: FreezeDurabilityOptions
): Promise<T> {
  let transaction: RetainedNoFollowFileTransaction | null = null;
  let primaryFailure: Readonly<{ error: unknown }> | undefined;
  try {
    const retainedActorRequested = durability !== undefined && (
      durability.beforeAnchoredCreate !== undefined
      || durability.beforeAnchoredRename !== undefined
      || durability.afterAnchoredNamespaceMutationBeforeFlush !== undefined
      || durability.beforeAnchoredCleanup !== undefined
      || durability.parentDirectoryBarrier !== undefined
      || durability.observer !== undefined
    );
    const testActor = !retainedActorRequested ? undefined
      : createRetainedNoFollowFileTransactionTestActorForTests({
          ...(durability.beforeAnchoredCreate === undefined ? {} : {
            beforeCreate: async (event) => durability.beforeAnchoredCreate?.({ ...event, kind: 'file' })
          }),
          ...(durability.beforeAnchoredRename === undefined ? {} : {
            beforeRename: durability.beforeAnchoredRename
          }),
          ...(durability.afterAnchoredNamespaceMutationBeforeFlush === undefined ? {} : {
            afterNamespaceMutationBeforeFlush: durability.afterAnchoredNamespaceMutationBeforeFlush
          }),
          ...(durability.beforeAnchoredCleanup === undefined ? {} : {
            beforeCleanup: durability.beforeAnchoredCleanup
          }),
          ...(durability.parentDirectoryBarrier === undefined ? {} : {
            beforeParentBarrier: async (event) => {
              try {
                await durability.parentDirectoryBarrier?.(event.parentPath);
              } catch (error) {
                throw new DurabilityBarrierError({
                  operation: 'parent-directory-barrier',
                  targetPath: event.parentPath,
                  cause: error
                });
              }
            }
          }),
          ...(durability.observer === undefined ? {} : {
            durabilityObserver: durability.observer
          })
        });
    transaction = retainNoFollowFileTransaction(boundaryRoot, label, testActor);
    return await operation(transaction);
  } catch (error) {
    try {
      return mapDocumentPhysicalError(error, { label, targetPath: boundaryRoot });
    } catch (mappedError) {
      primaryFailure = Object.freeze({ error: mappedError });
      throw mappedError;
    }
  } finally {
    try {
      transaction?.dispose();
    } catch (settlementError) {
      if (primaryFailure !== undefined) {
        throw new AggregateError(
          [primaryFailure.error, settlementError],
          `${label} failed and its retained physical transaction could not be settled.`
        );
      }
      throw settlementError;
    }
  }
}

function assertRetainedPublishAuthority(input: Readonly<{
  boundaryRoot: string;
  filePath: string;
  label: string;
  authority: RetainedPublishObjectAuthority;
  expectedBytes?: Buffer;
  expectedIdentity?: AnchoredObjectIdentity;
}>): void {
  const expectedRelativePath = transactionRelativePath(
    input.boundaryRoot,
    input.filePath,
    input.label
  );
  if (pathComparisonValue(input.authority.transaction.rootPath)
      !== pathComparisonValue(input.boundaryRoot)
      || pathComparisonValue(input.authority.relativePath)
        !== pathComparisonValue(expectedRelativePath)) {
    throw new Error(`${input.label} retained authority does not bind the requested path.`);
  }
  if (input.expectedBytes !== undefined
      && !Buffer.from(input.authority.observation.bytes).equals(input.expectedBytes)) {
    throw new Error(`${input.label} changed before its selected effect; preserving it.`);
  }
  if (input.expectedIdentity !== undefined
      && !sameAnchoredObjectIdentity(
        input.authority.observation.identity,
        input.expectedIdentity
      )) {
    throw new Error(`${input.label} identity changed before its selected effect; preserving it.`);
  }
}

async function removeOptionalSafeRegularFile(input: {
  boundaryRoot: string;
  filePath: string;
  label: string;
  expectedBytes: Buffer;
  expectedIdentity?: AnchoredObjectIdentity;
  retained?: RetainedPublishObjectAuthority;
  durability?: FreezeDurabilityOptions;
}): Promise<void> {
  const run = async (authority: RetainedPublishObjectAuthority): Promise<void> => {
    assertRetainedPublishAuthority({
      boundaryRoot: input.boundaryRoot,
      filePath: input.filePath,
      label: input.label,
      authority,
      expectedBytes: input.expectedBytes,
      ...(input.expectedIdentity === undefined ? {} : { expectedIdentity: input.expectedIdentity })
    });
    await authority.transaction.removeExact(authority.relativePath, authority.observation, input.label);
  };
  if (input.retained !== undefined) {
    await run(input.retained);
    return;
  }
  await withRetainedPhysicalTransaction(input.boundaryRoot, input.label, async (transaction) => {
    const relativePath = transactionRelativePath(input.boundaryRoot, input.filePath, input.label);
    const observation = transaction.observe(relativePath, input.label);
    if (observation === null) return;
    await run({ transaction, observation, relativePath });
  }, input.durability);
}

async function removeExactEmptyDirectory(input: {
  boundaryRoot: string;
  directoryPath: string;
  label: string;
  expectedIdentity?: AnchoredObjectIdentity;
}): Promise<void> {
  const directory = inspectNoFollowDirectoryChain(path.resolve(input.directoryPath), input.label).target;
  const parent = inspectNoFollowDirectoryChain(path.dirname(directory.path), `${input.label} parent`).target;
  assertPathContained(input.boundaryRoot, directory.path, input.label);
  if (input.expectedIdentity !== undefined
      && !sameAnchoredObjectIdentity(physicalIdentity(directory), input.expectedIdentity)) {
    throw new Error(`${input.label} identity changed before exact cleanup; preserving it.`);
  }
  deleteRetainedNoFollowEntry({
    root: parent,
    relativePath: path.basename(directory.path),
    kind: 'directory',
    device: directory.device,
    inode: directory.inode,
    ancestorDirectories: []
  });
}

async function createSafeRegularFileExclusive(input: {
  boundaryRoot: string;
  filePath: string;
  bytes: Buffer;
  label: string;
  durability?: FreezeDurabilityOptions;
}): Promise<void> {
  await withRetainedPhysicalTransaction(input.boundaryRoot, input.label, async (transaction) => {
    const relativePath = transactionRelativePath(input.boundaryRoot, input.filePath, input.label);
    await transaction.createExclusive(relativePath, input.bytes, input.label);
  }, input.durability);
}

async function defaultParentDirectoryBarrier(directoryPath: string): Promise<void> {
  try {
    flushNoFollowDirectory(inspectNoFollowDirectoryChain(directoryPath, 'Document control directory barrier').target);
  } catch (error) {
    return mapDocumentPhysicalError(error, {
      label: 'Document control directory barrier',
      targetPath: directoryPath,
      operation: 'parent-directory-barrier'
    });
  }
}

async function flushPublishedFile(input: {
  boundaryRoot: string;
  targetPath: string;
  label: string;
  durability: FreezeDurabilityOptions;
  expectedBytes?: Buffer;
  expectedIdentity?: AnchoredObjectIdentity;
  retained?: RetainedPublishObjectAuthority;
}): Promise<void> {
  const run = async (authority: RetainedPublishObjectAuthority): Promise<void> => {
    assertRetainedPublishAuthority({
      boundaryRoot: input.boundaryRoot,
      filePath: input.targetPath,
      label: input.label,
      authority,
      ...(input.expectedBytes === undefined ? {} : { expectedBytes: input.expectedBytes }),
      ...(input.expectedIdentity === undefined ? {} : { expectedIdentity: input.expectedIdentity })
    });
    await authority.transaction.flushExact(authority.relativePath, authority.observation, input.label);
  };
  if (input.retained !== undefined) await run(input.retained);
  else await withRetainedPhysicalTransaction(input.boundaryRoot, input.label, async (transaction) => {
    const relativePath = transactionRelativePath(input.boundaryRoot, input.targetPath, input.label);
    const observation = transaction.observe(relativePath, input.label);
    if (observation === null) throw new Error(`${input.label} is absent before flush.`);
    await run({ transaction, observation, relativePath });
  }, input.durability);
}

async function durableRename(input: {
  boundaryRoot: string;
  sourcePath: string;
  targetPath: string;
  label: string;
  durability: FreezeDurabilityOptions;
  replaceExisting?: boolean;
  expectedSourceBytes?: Buffer;
  expectedSourceIdentity?: AnchoredObjectIdentity;
  retained?: RetainedPublishObjectAuthority;
}): Promise<void> {
  if (input.replaceExisting !== false) {
    throw new UnsupportedAnchoredPathEffectError('retained no-replace rename');
  }
  const run = async (authority: RetainedPublishObjectAuthority): Promise<void> => {
    assertRetainedPublishAuthority({
      boundaryRoot: input.boundaryRoot,
      filePath: input.sourcePath,
      label: input.label,
      authority,
      ...(input.expectedSourceBytes === undefined ? {} : { expectedBytes: input.expectedSourceBytes }),
      ...(input.expectedSourceIdentity === undefined ? {} : {
        expectedIdentity: input.expectedSourceIdentity
      })
    });
    await authority.transaction.renameNoReplace(
      authority.relativePath,
      transactionRelativePath(input.boundaryRoot, input.targetPath, input.label),
      authority.observation,
      input.label
    );
  };
  if (input.retained !== undefined) return run(input.retained);
  await withRetainedPhysicalTransaction(input.boundaryRoot, input.label, async (transaction) => {
    const relativePath = transactionRelativePath(input.boundaryRoot, input.sourcePath, input.label);
    const observation = transaction.observe(relativePath, input.label);
    if (observation === null) throw new Error(`${input.label} source is absent.`);
    await run({ transaction, observation, relativePath });
  }, input.durability);
}

async function durableLinkOpenedPosixFile(input: {
  boundaryRoot: string;
  sourcePath: string;
  targetPath: string;
  expectedSourceBytes: Buffer;
  expectedSourceIdentity?: AnchoredObjectIdentity;
  label: string;
  durability: FreezeDurabilityOptions;
  retained?: RetainedPublishObjectAuthority;
}): Promise<void> {
  const run = async (authority: RetainedPublishObjectAuthority): Promise<void> => {
    assertRetainedPublishAuthority({
      boundaryRoot: input.boundaryRoot,
      filePath: input.sourcePath,
      label: input.label,
      authority,
      expectedBytes: input.expectedSourceBytes,
      ...(input.expectedSourceIdentity === undefined ? {} : {
        expectedIdentity: input.expectedSourceIdentity
      })
    });
    await authority.transaction.linkExactNoReplace(
      authority.relativePath,
      transactionRelativePath(input.boundaryRoot, input.targetPath, input.label),
      authority.observation,
      input.label
    );
  };
  if (input.retained !== undefined) return run(input.retained);
  await withRetainedPhysicalTransaction(input.boundaryRoot, input.label, async (transaction) => {
    const relativePath = transactionRelativePath(input.boundaryRoot, input.sourcePath, input.label);
    const observation = transaction.observe(relativePath, input.label);
    if (observation === null) throw new Error(`${input.label} source is absent.`);
    await run({ transaction, observation, relativePath });
  }, input.durability);
}

async function assertPosixEntryIdentity(input: {
  boundaryRoot: string;
  leftPath: string;
  rightPath: string;
  label: string;
}): Promise<void> {
  const [left, right] = await Promise.all([
    observeOptionalSafeRegularFile({ boundaryRoot: input.boundaryRoot, filePath: input.leftPath, label: `${input.label} left` }),
    observeOptionalSafeRegularFile({ boundaryRoot: input.boundaryRoot, filePath: input.rightPath, label: `${input.label} right` })
  ]);
  if (left === null || right === null || !sameAnchoredObjectIdentity(left.identity, right.identity)) {
    throw new Error(`${input.label} does not name one exact physical object.`);
  }
}
function byteDigest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${rawSha256Hex(bytes)}`;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(source: string, label: string): Buffer {
  if (typeof source !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(source)) {
    throw new Error(`${label} must be canonical base64.`);
  }
  const bytes = Buffer.from(source, 'base64');
  if (bytes.toString('base64') !== source) throw new Error(`${label} base64 is not canonical.`);
  return bytes;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly: ${wanted.join(', ')}.`);
  }
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  assertRecord(value, label);
  return value;
}

function textValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error(`${label} must be non-empty trimmed text.`);
  }
  return value;
}

function shaValue(value: unknown, label: string): string {
  const sha = textValue(value, label);
  if (!/^[0-9a-f]{40}$/u.test(sha)) throw new Error(`${label} must be a lowercase 40-character Git SHA.`);
  return sha;
}

function digestValue(value: unknown, label: string): `sha256:${string}` {
  const candidate = textValue(value, label);
  if (!/^sha256:[0-9a-f]{64}$/u.test(candidate)) throw new Error(`${label} must be a SHA-256 digest.`);
  return candidate as `sha256:${string}`;
}

function parseJournalFile(value: unknown, label: string): FreezeJournalFile {
  const record = recordValue(value, label);
  exactKeys(record, ['next', 'pre'], label);
  const pre = textValue(record.pre, `${label}.pre`);
  const next = textValue(record.next, `${label}.next`);
  fromBase64(pre, `${label}.pre`);
  fromBase64(next, `${label}.next`);
  return Object.freeze({ pre, next });
}

function freezeIndexTransportDigest(index: FreezeJournalFile): `sha256:${string}` {
  return sha256({ schema: 'sec-document-control-index-transport-v1', index }) as `sha256:${string}`;
}

function freezeOperationId(
  input: Omit<FreezeJournal, 'operationId' | 'phase' | 'result'>
): `sha256:${string}` {
  const { index: _indexTransport, indexTransportDigest: _transportDigest, ...semantic } = input;
  return sha256({
    ...semantic,
    indexSemanticIdentity: Object.freeze({
      preTreeSha: input.preIndexTreeSha,
      nextTreeSha: input.candidateTreeSha
    })
  }) as `sha256:${string}`;
}

function parseFreezeResult(value: unknown): FreezeResult {
  const record = recordValue(value, 'Freeze journal result');
  exactKeys(record, [
    'baseSha', 'baseTreeSha', 'candidateHeadSha', 'candidateTreeSha', 'indexPublished',
    'manifestDigest', 'manifestPath', 'operationId', 'schema', 'status', 'worktreeProjected'
  ], 'Freeze journal result');
  const legacy = record.schema === LegacyFreezeResultSchema;
  if ((!legacy && record.schema !== FreezeResultSchema)
      || (legacy
        ? record.status !== 'ACTIVATED_INDEX_PENDING_COMMIT'
        : record.status !== 'PROPOSED')
      || record.candidateHeadSha !== null || record.indexPublished !== true
      || record.worktreeProjected !== true) {
    throw new Error('Freeze journal result identity is invalid.');
  }
  return Object.freeze({
    schema: record.schema as FreezeResult['schema'],
    status: record.status as FreezeResult['status'],
    operationId: digestValue(record.operationId, 'Freeze result operationId'),
    baseSha: shaValue(record.baseSha, 'Freeze result baseSha'),
    baseTreeSha: shaValue(record.baseTreeSha, 'Freeze result baseTreeSha'),
    candidateTreeSha: shaValue(record.candidateTreeSha, 'Freeze result candidateTreeSha'),
    candidateHeadSha: null,
    manifestPath: textValue(record.manifestPath, 'Freeze result manifestPath'),
    manifestDigest: digestValue(record.manifestDigest, 'Freeze result manifestDigest'),
    indexPublished: true,
    worktreeProjected: true
  });
}

function parseFreezeJournal(source: string): FreezeJournal {
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch (error) {
    throw new Error('Document control freeze journal is invalid JSON.', { cause: error });
  }
  const record = recordValue(parsed, 'Freeze journal');
  const legacy = record.schema === LegacyFreezeJournalSchema;
  if (!legacy && record.schema !== FreezeJournalSchema) {
    throw new Error('Only freeze journal V4 or V5 can serve as recovery authority.');
  }
  exactKeys(record, [
    ...(legacy ? [] : ['authoringDisposition']),
    'baseSha', 'baseTreeSha', 'candidateTreeSha', 'files', 'index', 'manifestDigest',
    'indexTransportDigest', 'manifestPath', 'operationId', 'phase', 'preIndexTreeSha',
    'result', 'reviewedOn', 'schema'
  ], 'Freeze journal');
  if (!['prepared', 'index-published', 'pointer-published', 'rolling-published', 'terminal'].includes(String(record.phase))) {
    throw new Error('Freeze journal phase is invalid.');
  }
  const files = recordValue(record.files, 'Freeze journal files');
  exactKeys(files, ['manifest', 'pointer', 'rollingPlan'], 'Freeze journal files');
  const authoringDisposition = legacy
    ? undefined
    : record.authoringDisposition === 'proposal-only'
      ? record.authoringDisposition
      : (() => { throw new Error('Freeze journal V5 must describe proposal-only authoring.'); })();
  const semantic = Object.freeze({
    schema: record.schema as FreezeJournal['schema'],
    ...(authoringDisposition === undefined ? {} : { authoringDisposition }),
    manifestPath: textValue(record.manifestPath, 'Freeze journal manifestPath'),
    manifestDigest: digestValue(record.manifestDigest, 'Freeze journal manifestDigest'),
    reviewedOn: textValue(record.reviewedOn, 'Freeze journal reviewedOn'),
    baseSha: shaValue(record.baseSha, 'Freeze journal baseSha'),
    baseTreeSha: shaValue(record.baseTreeSha, 'Freeze journal baseTreeSha'),
    preIndexTreeSha: shaValue(record.preIndexTreeSha, 'Freeze journal preIndexTreeSha'),
    candidateTreeSha: shaValue(record.candidateTreeSha, 'Freeze journal candidateTreeSha'),
    files: Object.freeze({
      manifest: parseJournalFile(files.manifest, 'Freeze journal manifest file'),
      pointer: parseJournalFile(files.pointer, 'Freeze journal pointer file'),
      rollingPlan: parseJournalFile(files.rollingPlan, 'Freeze journal rolling-plan file')
    }),
    index: parseJournalFile(record.index, 'Freeze journal index'),
    indexTransportDigest: digestValue(
      record.indexTransportDigest,
      'Freeze journal indexTransportDigest'
    )
  });
  if (freezeIndexTransportDigest(semantic.index) !== semantic.indexTransportDigest) {
    throw new Error('Freeze journal index transport digest mismatch.');
  }
  const operationId = digestValue(record.operationId, 'Freeze journal operationId');
  if (freezeOperationId(semantic) !== operationId) throw new Error('Freeze journal operation digest mismatch.');
  const result = parseFreezeResult(record.result);
  if (result.operationId !== operationId || result.baseSha !== semantic.baseSha
      || result.baseTreeSha !== semantic.baseTreeSha || result.candidateTreeSha !== semantic.candidateTreeSha
      || result.manifestPath !== semantic.manifestPath || result.manifestDigest !== semantic.manifestDigest) {
    throw new Error('Freeze journal result is not bound to its operation.');
  }
  if ((authoringDisposition === 'proposal-only')
      !== (result.status === 'PROPOSED')) {
    throw new Error('Freeze journal result status differs from its authoring disposition.');
  }
  if (legacy && result.schema !== LegacyFreezeResultSchema) {
    throw new Error('Freeze journal V4 requires its original activated result contract.');
  }
  if (!legacy && result.schema !== FreezeResultSchema) {
    throw new Error('Freeze journal V5 requires its revision-matched result contract.');
  }
  const manifestBytes = fromBase64(semantic.files.manifest.next, 'Freeze journal manifest next bytes');
  if (WorkPackageManifestDigest(manifestBytes) !== semantic.manifestDigest) {
    throw new Error('Freeze journal manifest digest does not match its next bytes.');
  }
  return Object.freeze({
    ...semantic,
    operationId,
    phase: record.phase as FreezeJournalPhase,
    result
  });
}

function renderFreezeJournal(journal: FreezeJournal): Buffer {
  return Buffer.from(`${JSON.stringify(journal, null, 2)}\n`, 'utf8');
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

async function run(
  command: string,
  args: string[],
  cwd: string,
  options: CommandOptions = {}
): Promise<CommandResult> {
  if (command !== 'git' && command !== 'gh') {
    throw new Error(`Document-control command is outside the Git/GitHub boundary: ${command}`);
  }
  const operation = commandOperation(command, args);
  const testTransport = documentControlHostCliTestScope.getStore() === documentControlHostCliTestIssuer;
  if (command === 'gh' && !testTransport) {
    throw documentControlCliFailure(command, operation, 'unknown', 'semantic-closure-unproven');
  }
  const result = command === 'git'
    ? await runDocumentControlGitReadBytes(args, cwd, options)
    : await runDocumentControlTestCliBytes(command, args, cwd, options);
  return Object.freeze({
    code: result.code,
    stdout: Buffer.from(result.stdout).toString('utf8'),
    stderr: Buffer.from(result.stderr).toString('utf8')
  });
}

async function runDocumentControlTestCliBytes(
  command: 'git' | 'gh',
  args: readonly string[],
  cwd: string,
  options: CommandOptions
): Promise<DocumentControlByteCommandResult> {
  const actor = documentControlRoutingTestScope.getStore();
  if (actor === undefined || !documentControlRoutingTestActors.has(actor)) {
    throw new Error('Document-control host CLI test transport requires one owner-issued routing actor.');
  }
  return await actor.hostCliProvider(command, args, cwd, options);
}

async function runDocumentControlGitReadBytes(
  args: readonly string[],
  cwd: string,
  options: CommandOptions = {}
): Promise<DocumentControlByteCommandResult> {
  if (documentControlHostCliTestScope.getStore() === documentControlHostCliTestIssuer) {
    return runDocumentControlTestCliBytes('git', args, cwd, options);
  }

  const operation = commandOperation('git', args);
  if (operation !== 'git-read') {
    throw documentControlCliFailure('git', operation, 'unknown', 'semantic-closure-unproven');
  }
  const session = documentControlGitReadScope.getStore();
  if (session === undefined) {
    throw documentControlCliFailure('git', operation, 'unknown', 'semantic-closure-unproven');
  }
  if (pathComparisonValue(path.resolve(cwd)) !== pathComparisonValue(path.resolve(session.cwd))) {
    throw documentControlCliFailure('git', operation, 'unavailable', 'working-directory-binding-drift');
  }
  if ((options.environment !== undefined && Object.keys(options.environment).length > 0)
      || options.input !== undefined) {
    // Per-command repository/index/object overrides are a different semantic
    // capability. They must not be smuggled into the read session or reset its
    // immutable environment and aggregate budget.
    throw documentControlCliFailure('git', operation, 'unknown', 'semantic-closure-unproven');
  }
  const outcome = await session.run(args);
  if (outcome.kind !== 'completed') {
    throw documentControlCliFailure(
      'git',
      operation,
      'unavailable',
      outcome.reason,
      outcome.detailDigest
    );
  }
  return outcome.result;
}

function requireCommand(result: CommandResult, label: string): string {
  if (result.code !== 0) {
    throw new Error(`${label} failed: ${result.stderr.trim() || `exit ${result.code}`}`);
  }
  return result.stdout.trim();
}

function requireCommandOutput(result: CommandResult, label: string): string {
  if (result.code !== 0) {
    throw new Error(`${label} failed: ${result.stderr.trim() || `exit ${result.code}`}`);
  }
  return result.stdout;
}

async function readGitBlob(
  cwd: string,
  spec: string,
  environment: Readonly<Record<string, string>> = {}
): Promise<Buffer | undefined> {
  const result = await runDocumentControlGitReadBytes(
    ['show', spec],
    cwd,
    Object.keys(environment).length === 0 ? {} : { environment }
  );
  return result.code === 0 ? Buffer.from(result.stdout) : undefined;
}

interface ReadOnlyResolverGit {
  run(args: readonly string[], cwd: string, options?: CommandOptions): Promise<CommandResult>;
  readBlob(cwd: string, spec: string, options?: CommandOptions): Promise<Buffer | undefined>;
}

type ReadOnlyResolverGitObserver = (event: Readonly<{
  args: readonly string[];
  environment: Readonly<Record<string, string>>;
}>) => void;

function createReadOnlyResolverGit(
  observer?: ReadOnlyResolverGitObserver
): ReadOnlyResolverGit {
  const observeEnvironment = (
    args: readonly string[],
    environment: Readonly<Record<string, string>> | undefined
  ): Readonly<Record<string, string>> => {
    const observed = documentControlGitReadScope.getStore()?.env
      ?? Object.freeze(isolatedGitReadEnvironment(environment ?? {}, process.env));
    observer?.(Object.freeze({ args: Object.freeze([...args]), environment: observed }));
    return observed;
  };
  return Object.freeze({
    run(args: readonly string[], cwd: string, options: CommandOptions = {}) {
      const environment = observeEnvironment(args, options.environment);
      return run('git', [...args], cwd, {
        ...options,
        ...(documentControlGitReadScope.getStore() === undefined
          ? { environment }
          : {})
      });
    },
    async readBlob(cwd: string, spec: string, options: CommandOptions = {}) {
      const args = ['show', spec] as const;
      const environment = observeEnvironment(args, options.environment);
      const result = await runDocumentControlGitReadBytes(
        args,
        cwd,
        documentControlGitReadScope.getStore() === undefined
          ? { ...options, environment }
          : options
      );
      return result.code === 0 ? Buffer.from(result.stdout) : undefined;
    }
  });
}

async function requireGitBlob(cwd: string, spec: string, label: string): Promise<Buffer> {
  const blob = await readGitBlob(cwd, spec);
  if (blob === undefined) throw new Error(`${label} is absent from the immutable Git tree.`);
  return blob;
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`${label} must be valid UTF-8.`, { cause: error });
  }
}

function parseNulList(source: string): string[] {
  if (source.length === 0) return [];
  if (!source.endsWith('\0')) throw new Error('Git NUL-delimited path output is truncated.');
  return source.slice(0, -1).split('\0');
}

async function observeCommittedCandidateProjectionSourceTreeDelta(input: Readonly<{
  repositoryRoot: string;
  currentTree: string;
  rollingPlanSource: string;
}>): Promise<readonly string[] | null> {
  const projection = ParseRollingMachineProjection(input.rollingPlanSource);
  if (projection?.schema !== 'sec-work-rolling-transition-projection-v1'
      || projection.authority.kind !== 'committed-candidate-replan') {
    return null;
  }
  const observation = await run('git', [
    'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z',
    projection.authority.sourceTree, input.currentTree, '--'
  ], input.repositoryRoot);
  return observation.code === 0 ? Object.freeze(parseNulList(observation.stdout)) : null;
}

interface AnchoredIndexSnapshot {
  readonly bytes: Buffer;
  readonly identity: string;
}

async function readAnchoredIndexSnapshot(input: Readonly<{
  boundaryRoot: string;
  filePath: string;
  label: string;
}>): Promise<AnchoredIndexSnapshot> {
  const observation = await observeOptionalSafeRegularFile(input);
  if (observation === null) throw Object.assign(new Error(`${input.label} is absent.`), { code: 'ENOENT' });
  const identity = observation.identity;
  return Object.freeze({
    bytes: observation.bytes,
    identity: typeof identity === 'string'
      ? identity
      : `${identity.device}:${identity.inode}`
  });
}

interface ExternalScratchIndex {
  readonly treeSha: string;
  readonly index: AnchoredIndexSnapshot;
  run(args: readonly string[], options?: CommandOptions): Promise<CommandResult>;
  readBlob(spec: string): Promise<Buffer | undefined>;
}

async function withRepositoryIndexTreeThroughExternalScratch<T>(
  input: Readonly<{ repositoryRoot: string; resolverGit?: ReadOnlyResolverGit }>,
  observe: (snapshot: ExternalScratchIndex) => Promise<T> | T
): Promise<T> {
  const indexPaths = await resolveIndexPaths(input.repositoryRoot);
  const scratchRoot = await mkdtemp(path.join(tmpdir(), 'sec-document-control-index-'));
  try {
    const canonicalScratchRoot = await realpath(scratchRoot);
    const canonicalRepositoryRoot = await realpath(input.repositoryRoot);
    const canonicalGitDirectory = await realpath(indexPaths.gitDirectory);
    if (pathComparisonValue(canonicalScratchRoot).startsWith(`${pathComparisonValue(canonicalRepositoryRoot)}${path.sep}`)
        || pathComparisonValue(canonicalScratchRoot).startsWith(`${pathComparisonValue(canonicalGitDirectory)}${path.sep}`)) {
      throw new Error('External scratch index root must not be contained by the repository or Git directory.');
    }
    const before = await readAnchoredIndexSnapshot({
      boundaryRoot: indexPaths.gitDirectory,
      filePath: indexPaths.indexPath,
      label: 'Repository index nonmutating source'
    });
    let indexOperationFailure: Readonly<{ error: unknown }> | undefined;
    try {
      const scratchIndex = path.join(canonicalScratchRoot, 'index');
      const scratchObjects = path.join(canonicalScratchRoot, 'objects');
      await mkdir(scratchObjects);
      const repositoryObjectsCandidate = requireCommand(
        await run('git', ['rev-parse', '--git-path', 'objects'], input.repositoryRoot),
        'Repository object directory path'
      );
      const repositoryObjects = await realpath(path.isAbsolute(repositoryObjectsCandidate)
        ? repositoryObjectsCandidate
        : path.resolve(input.repositoryRoot, repositoryObjectsCandidate));
      await createSafeRegularFileExclusive({
        boundaryRoot: canonicalScratchRoot,
        filePath: scratchIndex,
        bytes: before.bytes,
        label: 'External scratch Git index',
        durability: {}
      });
      const environment = {
        GIT_INDEX_FILE: scratchIndex,
        GIT_OBJECT_DIRECTORY: scratchObjects,
        GIT_ALTERNATE_OBJECT_DIRECTORIES: repositoryObjects,
        GIT_OPTIONAL_LOCKS: '0'
      };
      const testTransport = documentControlHostCliTestScope.getStore() === documentControlHostCliTestIssuer;
      let productionScratch: GitScratchIndexTreeSession | null = null;
      if (!testTransport) {
        const gitReadSession = documentControlGitReadScope.getStore();
        if (gitReadSession === undefined) {
          throw documentControlCliFailure(
            'git', 'git-object-index-effect', 'unknown', 'semantic-closure-unproven'
          );
        }
        const resolution = await createAuthorityGitScratchIndexTreeSession({
          gitReadSession,
          scratchRoot: canonicalScratchRoot
        });
        if (resolution.status !== 'ready') {
          throw documentControlCliFailure(
            'git', 'git-object-index-effect', 'unavailable', resolution.reason
          );
        }
        productionScratch = resolution.session;
      }
      const scratchEnvironment = (options: CommandOptions = {}): CommandOptions => Object.freeze({
        ...options,
        environment: Object.freeze({ ...options.environment, ...environment })
      });
      const runScratch = async (
        args: readonly string[],
        options: CommandOptions = {}
      ): Promise<CommandResult> => {
        if (productionScratch === null) {
          const scratchOptions = scratchEnvironment(options);
          return input.resolverGit === undefined
            ? run('git', [...args], input.repositoryRoot, scratchOptions)
            : input.resolverGit.run(args, input.repositoryRoot, scratchOptions);
        }
        if (options.input !== undefined || (options.environment !== undefined
            && Object.keys(options.environment).length > 0)) {
          throw documentControlCliFailure(
            'git', 'git-object-index-effect', 'unknown', 'semantic-closure-unproven'
          );
        }
        if (args.length === 1 && args[0] === 'write-tree') {
          const result = await productionScratch.writeTree();
          if (result.status !== 'ready') {
            throw documentControlCliFailure(
              'git', 'git-object-index-effect', 'unavailable', result.reason
            );
          }
          return Object.freeze({ code: 0, stdout: `${result.value}\n`, stderr: '' });
        }
        const result = await productionScratch.observe(args);
        if (result.status !== 'ready') {
          throw documentControlCliFailure(
            'git', 'git-object-index-effect', 'unavailable', result.reason
          );
        }
        return Object.freeze({
          code: result.value.code,
          stdout: Buffer.from(result.value.stdout).toString('utf8'),
          stderr: Buffer.from(result.value.stderr).toString('utf8')
        });
      };
      let primaryFailure: Readonly<{ error: unknown }> | undefined;
      try {
        const treeSha = shaValue(requireCommand(
          await runScratch(['write-tree']),
          'Repository index tree through external scratch'
        ), 'Repository index tree through external scratch');
        return await observe(Object.freeze({
          treeSha,
          index: before,
          run: runScratch,
          async readBlob(spec: string) {
            const result = await runScratch(['show', spec]);
            return result.code === 0 ? Buffer.from(result.stdout) : undefined;
          }
        }));
      } catch (error) {
        primaryFailure = Object.freeze({ error });
        throw error;
      } finally {
        let closeFailure: Readonly<{ error: unknown }> | undefined;
        try {
          const reason = await productionScratch?.close();
          if (reason !== null && reason !== undefined) {
            closeFailure = Object.freeze({
              error: documentControlCliFailure(
                'git', 'git-object-index-effect', 'unavailable', reason
              )
            });
          }
        } catch (error) {
          closeFailure = Object.freeze({ error });
        }
        if (primaryFailure !== undefined && closeFailure !== undefined) {
          throw new AggregateError(
            [primaryFailure.error, closeFailure.error],
            'Document-control scratch observation and session close both failed.'
          );
        }
        if (closeFailure !== undefined) throw closeFailure.error;
      }
    } catch (error) {
      indexOperationFailure = Object.freeze({ error });
      throw error;
    } finally {
      let readbackFailure: Readonly<{ error: unknown }> | undefined;
      try {
        const after = await readAnchoredIndexSnapshot({
          boundaryRoot: indexPaths.gitDirectory,
          filePath: indexPaths.indexPath,
          label: 'Repository index nonmutating readback'
        });
        if (!after.bytes.equals(before.bytes) || after.identity !== before.identity) {
          throw new Error('External scratch Git index tree observation mutated the repository index.');
        }
      } catch (error) {
        readbackFailure = Object.freeze({ error });
      }
      if (indexOperationFailure !== undefined && readbackFailure !== undefined) {
        throw new AggregateError(
          [indexOperationFailure.error, readbackFailure.error],
          'Document-control scratch operation and repository-index readback both failed.'
        );
      }
      if (readbackFailure !== undefined) throw readbackFailure.error;
    }
  } catch (error) {
    const operationFailure = Object.freeze({ error });
    let cleanupFailure: Readonly<{ error: unknown }> | undefined;
    try {
      await rm(scratchRoot, { recursive: true, force: true });
      const removed = await lstat(scratchRoot).then(
        () => false,
        (removeError: unknown) => (removeError as NodeJS.ErrnoException).code === 'ENOENT'
      );
      if (!removed) throw new Error('External scratch Git index root remained after cleanup.');
    } catch (removeError) {
      cleanupFailure = Object.freeze({ error: removeError });
    }
    if (cleanupFailure !== undefined) {
      throw new AggregateError(
        [operationFailure.error, cleanupFailure.error],
        'Document-control scratch operation and root cleanup both failed.'
      );
    }
    throw operationFailure.error;
  }
  await rm(scratchRoot, { recursive: true, force: true });
  const removed = await lstat(scratchRoot).then(
    () => false,
    (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
  if (!removed) throw new Error('External scratch Git index root remained after cleanup.');
}

async function captureRepositoryIndexTreeThroughExternalScratch(input: Readonly<{
  repositoryRoot: string;
  resolverGit?: ReadOnlyResolverGit;
}>): Promise<Readonly<{ treeSha: string; index: AnchoredIndexSnapshot }>> {
  return withRepositoryIndexTreeThroughExternalScratch(input, ({ treeSha, index }) => (
    Object.freeze({ treeSha, index })
  ));
}

async function captureControlIndexSnapshot(
  repositoryRoot: string,
  options: Readonly<{
    resolverGit?: ReadOnlyResolverGit;
    targetManifestPath?: string;
    stagedBaseSha?: string;
    requiredStageZeroPaths?: readonly string[];
  }> = {}
): Promise<ControlIndexSnapshot> {
  return withRepositoryIndexTreeThroughExternalScratch(
    {
      repositoryRoot,
      ...(options.resolverGit === undefined ? {} : { resolverGit: options.resolverGit })
    },
    async ({ treeSha, index, run: runScratch, readBlob }) => {
      const requireSnapshotBlob = async (repositoryPath: string, label: string): Promise<Buffer> => {
        const blob = await readBlob(`:${repositoryPath}`);
        if (blob === undefined) throw new Error(`${label} is absent from the immutable Git index snapshot.`);
        return blob;
      };
      const stateBytes = await requireSnapshotBlob(CurrentStatePath, 'Current-state spec');
      const pointerBytes = await requireSnapshotBlob(ActivePointerPath, 'Active pointer');
      const rollingPlanBytes = await requireSnapshotBlob(RollingPlanPath, 'Rolling plan');
      const stateSource = decodeUtf8(stateBytes, 'Current-state spec');
      const pointerSource = decodeUtf8(pointerBytes, 'Active pointer');
      const rollingPlanSource = decodeUtf8(rollingPlanBytes, 'Rolling plan');
      const pointer = ParseActivePointer(pointerSource);
      const candidateManifestBlob = await readBlob(`:${pointer.manifest}`);
      const targetManifestBlob = options.targetManifestPath === undefined
        ? undefined
        : options.targetManifestPath === pointer.manifest
          ? candidateManifestBlob
          : await readBlob(`:${options.targetManifestPath}`);
      const roadmapBlob = await readBlob(':config/repository/work-selection.md');
      const indexPaths = Object.freeze(parseNulList(requireCommandOutput(
        await runScratch(['ls-files', '--cached', '-z']),
        'External index snapshot path inventory'
      )));
      let stagedPaths: readonly string[] = Object.freeze([]);
      if (options.stagedBaseSha !== undefined) {
        const unmerged = parseNulList(requireCommandOutput(
          await runScratch(['ls-files', '--unmerged', '-z']),
          'Unmerged external index snapshot inventory'
        ));
        if (unmerged.length > 0) throw new Error('Document control freeze rejects an unmerged Git index.');
        stagedPaths = Object.freeze(parseNulList(requireCommandOutput(
          await runScratch([
            'diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-renames',
            '--name-only', '-z', options.stagedBaseSha, '--'
          ]),
          'Staged external index snapshot inventory'
        )));
      }
      if (options.requiredStageZeroPaths !== undefined) {
        const source = requireCommandOutput(await runScratch(
          ['ls-files', '--stage', '-z', '--', ...options.requiredStageZeroPaths]
        ), 'Document control external index target inventory');
        for (const entry of parseNulList(source)) {
          const match = /^(\d{6}) ([0-9a-f]{40}) ([0-3])\t(.+)$/u.exec(entry);
          if (!match) throw new Error('Document control target index entry is malformed.');
          if (match[1] !== '100644' || match[3] !== '0') {
            throw new Error(`Document control target must be a stage-zero regular blob: ${match[4]}.`);
          }
        }
      }
      const worktreeStatus = requireCommand(
        await runScratch(['status', '--short', '--branch']),
        'Worktree status through external index snapshot'
      );
      return Object.freeze({
        treeSha: shaValue(treeSha, 'Git index tree snapshot'),
        index,
        stateBytes,
        pointerBytes,
        rollingPlanBytes,
        stateSource,
        pointerSource,
        rollingPlanSource,
        candidateManifestBlob,
        targetManifestBlob,
        roadmapBlob,
        indexPaths,
        stagedPaths,
        worktreeStatus
      });
    }
  );
}

async function assertRegularRepositoryFile(repositoryRoot: string, repositoryPath: string): Promise<string> {
  const candidate = path.join(repositoryRoot, ...repositoryPath.split('/'));
  return (await inspectSafePath({
    boundaryRoot: repositoryRoot,
    candidatePath: candidate,
    label: `Document control target ${repositoryPath}`,
    finalKind: 'file',
    allowMissing: false
  }))!;
}

async function resolveRecoverableRepositoryFile(
  repositoryRoot: string,
  repositoryPath: string
): Promise<string> {
  const candidate = path.join(repositoryRoot, ...repositoryPath.split('/'));
  await inspectSafePath({
    boundaryRoot: repositoryRoot,
    candidatePath: candidate,
    label: `Recoverable document control target ${repositoryPath}`,
    finalKind: 'file',
    allowMissing: true
  });
  return candidate;
}

function entryRecoveryPath(input: {
  artifactRoot: string;
  operationId: string;
  targetKey: DocumentControlRecoveryTargetKey;
  suffix: 'pre' | 'retired-pre' | 'retired-next';
}): string {
  const stem = DocumentControlRecoveryEntryStem({
    operationId: input.operationId,
    targetKey: input.targetKey
  });
  return path.join(input.artifactRoot, `${stem}.${input.suffix}`);
}

interface PublishEntryObservation {
  readonly bytes: Buffer | null;
  readonly identity: AnchoredObjectIdentity | null;
  readonly retained?: RetainedPublishObjectAuthority;
}

interface PublishEntryResolution {
  readonly state: PublishEntryState;
  readonly target: PublishEntryObservation;
  readonly next: PublishEntryObservation;
  readonly quarantine: PublishEntryObservation;
  readonly retiredPre: PublishEntryObservation;
  readonly retiredNext: PublishEntryObservation;
}

type PublishEntryState =
  | 'linux-fresh'
  | 'linux-s0'
  | 'linux-s1'
  | 'linux-s2'
  | 'linux-s3'
  | 'linux-s4'
  | 'windows-pristine'
  | 'windows-prepared'
  | 'windows-quarantined'
  | 'windows-installed';

function samePublishEntryIdentity(
  left: PublishEntryObservation,
  right: PublishEntryObservation
): boolean {
  if (left.identity === null || right.identity === null) return false;
  if (typeof left.identity === 'string' || typeof right.identity === 'string') {
    return typeof left.identity === 'string' && left.identity === right.identity;
  }
  return left.identity.device === right.identity.device && left.identity.inode === right.identity.inode;
}

function hasPublishEntryBytes(entry: PublishEntryObservation, expected: Buffer): boolean {
  return entry.bytes !== null && entry.bytes.equals(expected);
}

/**
 * Resolve the complete persisted entry tuple before any effect.  This is the
 * sole authority for recovery legality: callers must never infer a state from
 * a partial census or from byte equality alone.
 */
async function classifyPublishEntryState(input: Readonly<{
  boundaryRoot: string;
  targetPath: string;
  nextPath: string;
  quarantinePath: string;
  retiredPrePath: string;
  retiredNextPath: string;
  pre: Buffer;
  next: Buffer;
  label: string;
  retainRecoveryEntries?: boolean;
  observations?: Readonly<{
    target: PublishEntryObservation;
    next: PublishEntryObservation;
    quarantine: PublishEntryObservation;
    retiredPre: PublishEntryObservation;
    retiredNext: PublishEntryObservation;
  }>;
}>): Promise<PublishEntryResolution> {
  const readEntry = async (filePath: string, label: string): Promise<PublishEntryObservation> => {
    const observation = await observeOptionalSafeRegularFile({
      boundaryRoot: input.boundaryRoot,
      filePath,
      label
    });
    return observation === null
      ? Object.freeze({ bytes: null, identity: null })
      : Object.freeze({ bytes: observation.bytes, identity: observation.identity });
  };
  const observed = input.observations ?? Object.freeze({
    target: await readEntry(input.targetPath, input.label),
    next: await readEntry(input.nextPath, `${input.label} NEXT recovery entry`),
    quarantine: await readEntry(input.quarantinePath, `${input.label} PRE quarantine`),
    retiredPre: await readEntry(input.retiredPrePath, `${input.label} retired PRE entry`),
    retiredNext: await readEntry(input.retiredNextPath, `${input.label} retired NEXT entry`)
  });
  const { target, next, quarantine, retiredPre, retiredNext } = observed;
  const absent = (entry: PublishEntryObservation) => entry.bytes === null;
  const exact = (entry: PublishEntryObservation, bytes: Buffer) => hasPublishEntryBytes(entry, bytes);
  const fail = (): never => {
    throw new Error(`${input.label} recovery tuple is not a legal pre-effect state; preserving every entry.`);
  };
  const resolve = (state: PublishEntryState): PublishEntryResolution => Object.freeze({
    state, target, next, quarantine, retiredPre, retiredNext
  });

  if (process.platform === 'linux') {
    if (exact(target, input.pre) && absent(next) && absent(quarantine)
        && absent(retiredPre) && absent(retiredNext)) return resolve('linux-fresh');
    if (exact(target, input.pre) && exact(next, input.next) && absent(quarantine)
        && absent(retiredPre) && absent(retiredNext)) return resolve('linux-s0');
    if (exact(target, input.pre) && exact(next, input.next) && exact(quarantine, input.pre)
        && samePublishEntryIdentity(target, quarantine) && absent(retiredPre) && absent(retiredNext)) {
      return resolve('linux-s1');
    }
    if (absent(target) && exact(next, input.next) && exact(quarantine, input.pre)
        && exact(retiredPre, input.pre) && samePublishEntryIdentity(quarantine, retiredPre)
        && absent(retiredNext)) return resolve('linux-s2');
    if (exact(target, input.next) && exact(next, input.next) && exact(quarantine, input.pre)
        && exact(retiredPre, input.pre) && samePublishEntryIdentity(target, next)
        && samePublishEntryIdentity(quarantine, retiredPre) && absent(retiredNext)) return resolve('linux-s3');
    if (exact(target, input.next) && absent(next) && exact(quarantine, input.pre)
        && exact(retiredPre, input.pre) && exact(retiredNext, input.next)
        && samePublishEntryIdentity(target, retiredNext)
        && samePublishEntryIdentity(quarantine, retiredPre)) return resolve('linux-s4');
    return fail();
  }
  if (process.platform === 'win32') {
    // POSIX recovery names must never participate in the Windows atomic-rename protocol.
    if (!absent(retiredPre) || !absent(retiredNext)) return fail();
    if (exact(target, input.pre) && absent(next) && absent(quarantine)) return resolve('windows-pristine');
    if (exact(target, input.pre) && exact(next, input.next) && absent(quarantine)) return resolve('windows-prepared');
    if (absent(target) && exact(next, input.next) && exact(quarantine, input.pre)) {
      return resolve('windows-quarantined');
    }
    // A successful rename consumes NEXT.  PRE may remain only while cleanup is retained.
    if (exact(target, input.next) && absent(next) && exact(quarantine, input.pre)) {
      return resolve('windows-installed');
    }
    if (input.retainRecoveryEntries !== true && exact(target, input.next) && absent(next)
        && absent(quarantine)) return resolve('windows-installed');
    return fail();
  }
  throw new Error(`Entry CAS is unsupported on ${process.platform}.`);
}

type PublishTupleClassifierInput = Readonly<{
  boundaryRoot: string;
  targetPath: string;
  nextPath: string;
  quarantinePath: string;
  retiredPrePath: string;
  retiredNextPath: string;
  pre: Buffer;
  next: Buffer;
  label: string;
  retainRecoveryEntries?: boolean;
}>;

type PublishTupleClassifierSource = Readonly<{
  boundaryRoot: string;
  artifactRoot: string;
  targetPath: string;
  targetKey: DocumentControlRecoveryTargetKey;
  nextPath: string;
  pre: Buffer;
  next: Buffer;
  label: string;
  operationId: string;
  retainRecoveryEntries?: boolean;
}>;

function createPublishTupleClassifierInput(
  input: PublishTupleClassifierSource
): PublishTupleClassifierInput {
  return Object.freeze({
    boundaryRoot: input.boundaryRoot,
    targetPath: input.targetPath,
    nextPath: input.nextPath,
    quarantinePath: entryRecoveryPath({ ...input, suffix: 'pre' }),
    retiredPrePath: entryRecoveryPath({ ...input, suffix: 'retired-pre' }),
    retiredNextPath: entryRecoveryPath({ ...input, suffix: 'retired-next' }),
    pre: input.pre,
    next: input.next,
    label: input.label,
    retainRecoveryEntries: input.retainRecoveryEntries
  });
}

/** Retains every extant tuple object and its anchored parent for exactly one selected publisher edge. */
async function withRetainedPublishEntryTuple<T>(
  input: PublishTupleClassifierInput,
  operation: (resolution: PublishEntryResolution) => Promise<T> | T,
  durability?: FreezeDurabilityOptions
): Promise<T> {
  const paths = [
    [input.targetPath, input.label, 'target'],
    [input.nextPath, `${input.label} NEXT recovery entry`, 'next'],
    [input.quarantinePath, `${input.label} PRE quarantine`, 'quarantine'],
    [input.retiredPrePath, `${input.label} retired PRE entry`, 'retiredPre'],
    [input.retiredNextPath, `${input.label} retired NEXT entry`, 'retiredNext']
  ] as const;
  return withRetainedPhysicalTransaction(input.boundaryRoot, input.label, async (transaction) => {
    const relativeByKey = Object.fromEntries(paths.map(([filePath, , key]) => [
      key,
      transactionRelativePath(input.boundaryRoot, filePath, input.label)
    ])) as Record<(typeof paths)[number][2], string>;
    const retained = transaction.observeTuple(paths.map(([filePath, label, key]) => Object.freeze({
      key,
      relativePath: transactionRelativePath(input.boundaryRoot, filePath, label),
      label
    })));
    const observations = Object.fromEntries(paths.map(([, , key]) => {
      const observation = retained[key] ?? null;
      return [key, observation === null
        ? Object.freeze({ bytes: null, identity: null })
        : Object.freeze({
            bytes: Buffer.from(observation.bytes),
            identity: observation.identity,
            retained: Object.freeze({
              transaction,
              observation,
              relativePath: relativeByKey[key]
            })
          })];
    }));
    return operation(await classifyPublishEntryState({
      ...input,
      observations: observations as unknown as Readonly<{
        target: PublishEntryObservation;
        next: PublishEntryObservation;
        quarantine: PublishEntryObservation;
        retiredPre: PublishEntryObservation;
        retiredNext: PublishEntryObservation;
      }>
    }));
  }, durability);
}
function samePublishEntryObservation(
  left: PublishEntryObservation,
  right: PublishEntryObservation
): boolean {
  if ((left.bytes === null) !== (right.bytes === null)) return false;
  if (left.bytes !== null && !left.bytes.equals(right.bytes!)) return false;
  return (left.identity === null && right.identity === null)
    || samePublishEntryIdentity(left, right);
}

function assertPublishEntryTransitionIdentity(
  predecessor: PublishEntryResolution,
  successor: PublishEntryResolution
): void {
  const requireSame = (left: PublishEntryObservation, right: PublishEntryObservation, label: string): void => {
    if (!samePublishEntryIdentity(left, right)) {
      throw new Error(`Publish entry successor did not retain the authorized ${label} identity.`);
    }
  };
  const requireAbsent = (entry: PublishEntryObservation, label: string): void => {
    if (entry.identity !== null || entry.bytes !== null) {
      throw new Error(`Publish entry successor did not remove the required ${label} entry.`);
    }
  };
  const edge = `${predecessor.state}->${successor.state}`;
  switch (edge) {
    case 'windows-prepared->windows-quarantined':
      requireSame(predecessor.target, successor.quarantine, 'Windows PRE quarantine');
      requireSame(predecessor.next, successor.next, 'Windows NEXT');
      requireAbsent(successor.target, 'Windows PRE target');
      return;
    case 'windows-quarantined->windows-installed':
      requireSame(predecessor.next, successor.target, 'Windows installed NEXT');
      requireSame(predecessor.quarantine, successor.quarantine, 'Windows retained PRE');
      requireAbsent(successor.next, 'Windows consumed NEXT');
      return;
    case 'windows-installed->windows-installed':
      requireSame(predecessor.target, successor.target, 'Windows installed target');
      return;
    case 'linux-s0->linux-s1':
      requireSame(predecessor.target, successor.target, 'Linux PRE target');
      requireSame(predecessor.target, successor.quarantine, 'Linux PRE quarantine');
      requireSame(predecessor.next, successor.next, 'Linux NEXT');
      return;
    case 'linux-s1->linux-s2':
      requireSame(predecessor.target, successor.quarantine, 'Linux retained PRE');
      requireSame(predecessor.target, successor.retiredPre, 'Linux retired PRE');
      requireSame(predecessor.next, successor.next, 'Linux NEXT');
      requireAbsent(successor.target, 'Linux retired target');
      return;
    case 'linux-s2->linux-s3':
      requireSame(predecessor.next, successor.target, 'Linux installed NEXT');
      requireSame(predecessor.next, successor.next, 'Linux active NEXT');
      requireSame(predecessor.quarantine, successor.quarantine, 'Linux PRE quarantine');
      requireSame(predecessor.retiredPre, successor.retiredPre, 'Linux retired PRE');
      return;
    case 'linux-s3->linux-s4':
      requireSame(predecessor.target, successor.target, 'Linux installed NEXT');
      requireSame(predecessor.next, successor.retiredNext, 'Linux retired NEXT');
      requireSame(predecessor.quarantine, successor.quarantine, 'Linux PRE quarantine');
      requireSame(predecessor.retiredPre, successor.retiredPre, 'Linux retired PRE');
      requireAbsent(successor.next, 'Linux active NEXT');
      return;
    default:
      return;
  }
}

async function publishEntryNoReplaceCas(input: {
  boundaryRoot: string;
  artifactRoot: string;
  targetPath: string;
  targetKey: DocumentControlRecoveryTargetKey;
  nextPath: string;
  pre: Buffer;
  next: Buffer;
  label: string;
  operationId: string;
  faultAfterNextPrepared?: () => void;
  faultAfterPreQuarantine?: () => void;
  faultAfterNextInstall?: () => void;
  retainRecoveryEntries?: boolean;
  durability: FreezeDurabilityOptions;
}): Promise<void> {
  const classifier = createPublishTupleClassifierInput(input);
  const { quarantinePath, retiredPrePath, retiredNextPath } = classifier;
  let resolution = await classifyPublishEntryState(classifier);
  let state = resolution.state;
  const assertBeforeEffect = async (): Promise<void> => {
    await withRetainedPublishEntryTuple(classifier, async (retained) => {
      const expected = resolution;
      if (retained.state !== expected.state
          || !samePublishEntryObservation(retained.target, expected.target)
          || !samePublishEntryObservation(retained.next, expected.next)
          || !samePublishEntryObservation(retained.quarantine, expected.quarantine)
          || !samePublishEntryObservation(retained.retiredPre, expected.retiredPre)
          || !samePublishEntryObservation(retained.retiredNext, expected.retiredNext)) {
        throw new Error(`${input.label} retained tuple changed before its selected edge; preserving every entry.`);
      }
    }, input.durability);
  };
  const runSelectedRetainedEdge = async <T>(
    edge: (retained: PublishEntryResolution) => Promise<T>
  ): Promise<T> => withRetainedPublishEntryTuple(classifier, async (retained) => {
    const expected = resolution;
    if (retained.state !== expected.state
        || !samePublishEntryObservation(retained.target, expected.target)
        || !samePublishEntryObservation(retained.next, expected.next)
        || !samePublishEntryObservation(retained.quarantine, expected.quarantine)
        || !samePublishEntryObservation(retained.retiredPre, expected.retiredPre)
        || !samePublishEntryObservation(retained.retiredNext, expected.retiredNext)) {
      throw new Error(`${input.label} retained tuple changed before its selected edge; preserving every entry.`);
    }
    return edge(retained);
  }, input.durability);
  const assertDeclaredSuccessor = async (
    predecessor: PublishEntryResolution,
    successor: PublishEntryState
  ): Promise<void> => {
    const observed = await classifyPublishEntryState(classifier);
    if (observed.state !== successor) {
      throw new Error(`${input.label} effect did not produce its declared ${successor} successor.`);
    }
    assertPublishEntryTransitionIdentity(predecessor, observed);
    resolution = observed;
    state = observed.state;
  };

  if (input.pre.equals(input.next)
      && (state === 'linux-fresh' || state === 'windows-pristine')) {
    await runSelectedRetainedEdge(async () => undefined);
    return;
  }

  if (state === 'windows-installed') {
    if (input.retainRecoveryEntries !== true) {
      await runSelectedRetainedEdge(async (retained) => removeOptionalSafeRegularFile({
        boundaryRoot: input.boundaryRoot,
        filePath: quarantinePath,
        label: `${input.label} exact PRE quarantine cleanup`,
        expectedBytes: input.pre,
        expectedIdentity: retained.quarantine.identity!,
        retained: retained.quarantine.retained,
        durability: input.durability
      }));
      // W2 becomes W3 only after its sole permitted cleanup edge.
      await assertDeclaredSuccessor(resolution, 'windows-installed');
    }
    await runSelectedRetainedEdge(async (retained) => flushPublishedFile({
      boundaryRoot: input.boundaryRoot,
      targetPath: input.targetPath,
      label: input.label,
      durability: input.durability
      , expectedBytes: input.next, expectedIdentity: retained.target.identity!
      , retained: retained.target.retained
    }));
    return;
  }

  if (state === 'linux-s4') {
    await runSelectedRetainedEdge(async (retained) => flushPublishedFile({
      boundaryRoot: input.boundaryRoot,
      targetPath: input.targetPath,
      label: input.label,
      durability: input.durability
      , expectedBytes: input.next, expectedIdentity: retained.target.identity!
      , retained: retained.target.retained
    }));
    return;
  }

  if (state === 'linux-fresh' || state === 'windows-pristine') {
    await runSelectedRetainedEdge(async () => createSafeRegularFileExclusive({
      boundaryRoot: input.boundaryRoot,
      filePath: input.nextPath,
      bytes: input.next,
      label: `${input.label} NEXT recovery entry`,
      durability: input.durability
    }));
    await assertDeclaredSuccessor(resolution, process.platform === 'linux' ? 'linux-s0' : 'windows-prepared');
    await assertBeforeEffect();
  }
  input.faultAfterNextPrepared?.();

  if (state === 'windows-prepared') {
    if (process.platform === 'win32') {
      await runSelectedRetainedEdge(async (retained) => durableRename({
        boundaryRoot: input.boundaryRoot,
        sourcePath: input.targetPath,
        targetPath: quarantinePath,
        label: `${input.label} PRE quarantine`,
        durability: input.durability,
        replaceExisting: false,
        expectedSourceBytes: input.pre,
        expectedSourceIdentity: retained.target.identity!,
        retained: retained.target.retained
      }));
    }
    input.faultAfterPreQuarantine?.();
    await assertDeclaredSuccessor(resolution, 'windows-quarantined');
  }

  if (state === 'linux-s0') {
    await runSelectedRetainedEdge(async (retained) => durableLinkOpenedPosixFile({
      boundaryRoot: input.boundaryRoot,
      sourcePath: input.targetPath,
      targetPath: quarantinePath,
      expectedSourceBytes: input.pre,
      expectedSourceIdentity: retained.target.identity!,
      label: `${input.label} exact PRE recovery link`,
      durability: input.durability,
      retained: retained.target.retained
    }));
    await assertPosixEntryIdentity({
      boundaryRoot: input.boundaryRoot,
      leftPath: input.targetPath,
      rightPath: quarantinePath,
      label: `${input.label} PRE recovery identity`
    });
    await input.durability.afterExactPreRecoveryLink?.(Object.freeze({
      label: input.label,
      targetPath: input.targetPath,
      recoveryPath: quarantinePath
    }));
    await assertDeclaredSuccessor(resolution, 'linux-s1');
  }
  if (state === 'linux-s1') {
    await runSelectedRetainedEdge(async (retained) => durableRename({
      boundaryRoot: input.boundaryRoot,
      sourcePath: input.targetPath,
      targetPath: retiredPrePath,
      label: `${input.label} PRE entry retirement`,
      durability: input.durability,
      replaceExisting: false,
      expectedSourceBytes: input.pre,
      expectedSourceIdentity: retained.target.identity!,
      retained: retained.target.retained
    }));
    await assertPosixEntryIdentity({
      boundaryRoot: input.boundaryRoot,
      leftPath: quarantinePath,
      rightPath: retiredPrePath,
      label: `${input.label} retired PRE identity`
    });
    input.faultAfterPreQuarantine?.();
    await assertDeclaredSuccessor(resolution, 'linux-s2');
  }

  if (state === 'windows-quarantined') {
    await runSelectedRetainedEdge(async (retained) => durableRename({
      boundaryRoot: input.boundaryRoot,
      sourcePath: input.nextPath,
      targetPath: input.targetPath,
      label: `${input.label} NEXT install`,
      durability: input.durability,
      replaceExisting: false,
      expectedSourceBytes: input.next,
      expectedSourceIdentity: retained.next.identity!,
      retained: retained.next.retained
    }));
    await assertDeclaredSuccessor(resolution, 'windows-installed');
  } else if (state === 'linux-s2') {
    await runSelectedRetainedEdge(async (retained) => durableLinkOpenedPosixFile({
      boundaryRoot: input.boundaryRoot,
      sourcePath: input.nextPath,
      targetPath: input.targetPath,
      expectedSourceBytes: input.next,
      expectedSourceIdentity: retained.next.identity!,
      label: `${input.label} exact NEXT install`,
      durability: input.durability,
      retained: retained.next.retained
    }));
    await assertDeclaredSuccessor(resolution, 'linux-s3');
  }
  input.faultAfterNextInstall?.();

  if (!(await readSafeRegularFile({
    boundaryRoot: input.boundaryRoot,
    filePath: input.targetPath,
    label: `${input.label} NEXT readback`
  })).equals(input.next)) {
    throw new Error(`${input.label} NEXT readback failed.`);
  }
  if (resolution.state === 'windows-installed' && input.retainRecoveryEntries !== true) {
    await runSelectedRetainedEdge(async (retained) => removeOptionalSafeRegularFile({
      boundaryRoot: input.boundaryRoot,
      filePath: quarantinePath,
      label: `${input.label} exact PRE quarantine cleanup`,
      expectedBytes: input.pre,
      expectedIdentity: retained.quarantine.identity!,
      retained: retained.quarantine.retained,
      durability: input.durability
    }));
    await assertDeclaredSuccessor(resolution, 'windows-installed');
  } else if (resolution.state === 'linux-s3') {
    await runSelectedRetainedEdge(async (retained) => durableRename({
      boundaryRoot: input.boundaryRoot,
      sourcePath: input.nextPath,
      targetPath: retiredNextPath,
      label: `${input.label} NEXT recovery retirement`,
      durability: input.durability,
      replaceExisting: false,
      expectedSourceBytes: input.next,
      expectedSourceIdentity: retained.next.identity!,
      retained: retained.next.retained
    }));
    await assertPosixEntryIdentity({
      boundaryRoot: input.boundaryRoot,
      leftPath: input.targetPath,
      rightPath: retiredNextPath,
      label: `${input.label} installed NEXT identity`
    });
    await assertDeclaredSuccessor(resolution, 'linux-s4');
  }
}

function atomicCasNextPath(filePath: string, operationId: string): string {
  return path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${operationId.slice('sha256:'.length)}.next`
  );
}

async function writeAtomicCas(input: {
  repositoryRoot: string;
  filePath: string;
  targetKey: DocumentControlRecoveryTargetKey;
  pre: Buffer;
  next: Buffer;
  label: string;
  operationId: string;
  faultAfterTempWrite?: () => void;
  faultAfterPreQuarantine?: () => void;
  faultAfterNextInstall?: () => void;
  durability: FreezeDurabilityOptions;
}): Promise<void> {
  const transactionRoot = await resolveFreezeTransactionRoot(input.repositoryRoot, input.durability);
  const temporaryPath = atomicCasNextPath(input.filePath, input.operationId);
  await publishEntryNoReplaceCas({
    boundaryRoot: input.repositoryRoot,
    artifactRoot: transactionRoot,
    targetPath: input.filePath,
    targetKey: input.targetKey,
    nextPath: temporaryPath,
    pre: input.pre,
    next: input.next,
    label: input.label,
    operationId: input.operationId,
    faultAfterNextPrepared: input.faultAfterTempWrite,
    faultAfterPreQuarantine: input.faultAfterPreQuarantine,
    faultAfterNextInstall: input.faultAfterNextInstall,
    durability: input.durability
  });
}

interface InitiallyAbsentEntryResolution {
  readonly state: InitiallyAbsentTupleState;
  readonly tuple: Readonly<{
    target: InitiallyAbsentTupleEntry;
    next: InitiallyAbsentTupleEntry;
    retiredNext: InitiallyAbsentTupleEntry;
  }>;
  readonly target: PublishEntryObservation;
  readonly next: PublishEntryObservation;
  readonly retiredNext: PublishEntryObservation;
}

type InitiallyAbsentTupleClassifierInput = Readonly<{
  boundaryRoot: string;
  targetPath: string;
  nextPath: string;
  retiredNextPath: string;
  next: Buffer;
  label: string;
}>;

function initialTupleEntryAdapter(
  entry: PublishEntryObservation,
  next: Buffer
): InitiallyAbsentTupleEntry {
  const identity = entry.identity === null
    ? null
    : typeof entry.identity === 'string'
      ? entry.identity
      : `${entry.identity.device}:${entry.identity.inode}`;
  if (entry.bytes === null) return Object.freeze({ byteClass: 'absent', identity });
  return Object.freeze({ byteClass: entry.bytes.equals(next) ? 'exact-next' : 'unknown', identity });
}

function initialTupleResolutionAdapter(input: Readonly<{
  next: Buffer;
  target: PublishEntryObservation;
  nextEntry: PublishEntryObservation;
  retiredNext: PublishEntryObservation;
  label: string;
}>): InitiallyAbsentEntryResolution {
  const tuple = Object.freeze({
    target: initialTupleEntryAdapter(input.target, input.next),
    next: initialTupleEntryAdapter(input.nextEntry, input.next),
    retiredNext: initialTupleEntryAdapter(input.retiredNext, input.next)
  });
  const resolution = ClassifyInitiallyAbsentEntryTuple({
    platform: process.platform as InitiallyAbsentTuplePlatform,
    tuple
  });
  if (resolution.status === 'invalid') {
    throw new Error(`${input.label} initially-absent T/N/R contract rejected the observation (${resolution.reason}); preserving every entry.`);
  }
  return Object.freeze({
    state: resolution.state,
    tuple,
    target: input.target,
    next: input.nextEntry,
    retiredNext: input.retiredNext
  });
}

/** Anchored observation adapter; the T/N/R grammar itself lives in the contract. */
async function observeInitiallyAbsentEntryTuple(
  input: InitiallyAbsentTupleClassifierInput & Readonly<{
    observations?: Readonly<{
      target: PublishEntryObservation;
      next: PublishEntryObservation;
      retiredNext: PublishEntryObservation;
    }>;
  }>
): Promise<InitiallyAbsentEntryResolution> {
  const readEntry = async (filePath: string, label: string): Promise<PublishEntryObservation> => {
    const observation = await observeOptionalSafeRegularFile({
      boundaryRoot: input.boundaryRoot,
      filePath,
      label
    });
    return observation === null
      ? Object.freeze({ bytes: null, identity: null })
      : Object.freeze({ bytes: observation.bytes, identity: observation.identity });
  };
  const observed = input.observations ?? Object.freeze({
    target: await readEntry(input.targetPath, input.label),
    next: await readEntry(input.nextPath, `${input.label} NEXT recovery entry`),
    retiredNext: await readEntry(input.retiredNextPath, `${input.label} retired NEXT entry`)
  });
  return initialTupleResolutionAdapter({
    next: input.next,
    target: observed.target,
    nextEntry: observed.next,
    retiredNext: observed.retiredNext,
    label: input.label
  });
}

/** Retains every present initial T/N/R object and parent anchor through exactly one selected edge. */
async function withRetainedInitiallyAbsentEntryTuple<T>(
  input: InitiallyAbsentTupleClassifierInput,
  operation: (resolution: InitiallyAbsentEntryResolution) => Promise<T> | T,
  durability?: FreezeDurabilityOptions
): Promise<T> {
  const paths = [
    [input.targetPath, input.label, 'target'],
    [input.nextPath, `${input.label} NEXT recovery entry`, 'next'],
    [input.retiredNextPath, `${input.label} retired NEXT entry`, 'retiredNext']
  ] as const;
  return withRetainedPhysicalTransaction(input.boundaryRoot, input.label, async (transaction) => {
    const retained = transaction.observeTuple(paths.map(([filePath, label, key]) => Object.freeze({
      key,
      relativePath: transactionRelativePath(input.boundaryRoot, filePath, label),
      label
    })));
    const observations = Object.fromEntries(paths.map(([filePath, , key]) => {
      const observation = retained[key] ?? null;
      const relativePath = transactionRelativePath(input.boundaryRoot, filePath, input.label);
      return [key, observation === null
        ? Object.freeze({ bytes: null, identity: null })
        : Object.freeze({
            bytes: Buffer.from(observation.bytes),
            identity: observation.identity,
            retained: Object.freeze({ transaction, observation, relativePath })
          })];
    }));
    return operation(await observeInitiallyAbsentEntryTuple({
      ...input,
      observations: observations as unknown as Readonly<{
        target: PublishEntryObservation;
        next: PublishEntryObservation;
        retiredNext: PublishEntryObservation;
      }>
    }));
  }, durability);
}
function assertInitiallyAbsentTransitionFromContract(
  predecessor: InitiallyAbsentEntryResolution,
  successor: InitiallyAbsentEntryResolution,
  expectedEdge: InitiallyAbsentTupleEdge,
  label: string
): void {
  const resolution = AssertInitiallyAbsentEntryTransition({
    platform: process.platform as InitiallyAbsentTuplePlatform,
    predecessor: predecessor.tuple,
    successor: successor.tuple,
    expectedEdge
  });
  if (resolution.status === 'invalid') {
    throw new Error(`${label} initially-absent T/N/R transition contract rejected ${expectedEdge} (${resolution.reason}); preserving every entry.`);
  }
}

async function publishInitiallyAbsentEntryNoReplace(input: {
  boundaryRoot: string;
  targetPath: string;
  targetKey: DocumentControlRecoveryTargetKey;
  nextPath: string;
  next: Buffer;
  label: string;
  durability: FreezeDurabilityOptions;
}): Promise<void> {
  const retiredNextPath = entryRecoveryPath({
    artifactRoot: input.boundaryRoot,
    operationId: byteDigest(input.next),
    targetKey: input.targetKey,
    suffix: 'retired-next'
  });
  const classifier = Object.freeze({
    boundaryRoot: input.boundaryRoot, targetPath: input.targetPath, nextPath: input.nextPath,
    retiredNextPath, next: input.next, label: input.label
  });
  let resolution = await observeInitiallyAbsentEntryTuple(classifier);
  const runSelectedRetainedEdge = async <T>(
    edge: (retained: InitiallyAbsentEntryResolution) => Promise<T>
  ): Promise<T> => withRetainedInitiallyAbsentEntryTuple(classifier, async (retained) => {
    if (retained.state !== resolution.state
        || !samePublishEntryObservation(retained.target, resolution.target)
        || !samePublishEntryObservation(retained.next, resolution.next)
        || !samePublishEntryObservation(retained.retiredNext, resolution.retiredNext)) {
      throw new Error(`${input.label} initially-absent tuple changed before its selected edge; preserving every entry.`);
    }
    return edge(retained);
  }, input.durability);
  const assertSuccessor = async (
    predecessor: InitiallyAbsentEntryResolution,
    expectedEdge: InitiallyAbsentTupleEdge
  ): Promise<void> => {
    const successor = await observeInitiallyAbsentEntryTuple(classifier);
    assertInitiallyAbsentTransitionFromContract(predecessor, successor, expectedEdge, input.label);
    resolution = successor;
  };
  if (resolution.state === 'win32-w2' || resolution.state === 'linux-l3') {
    await runSelectedRetainedEdge(async (retained) => flushPublishedFile({
      boundaryRoot: input.boundaryRoot, targetPath: input.targetPath, label: input.label, durability: input.durability,
      expectedBytes: input.next, expectedIdentity: retained.target.identity!, retained: retained.target.retained
    }));
    return;
  }
  if (resolution.state === 'win32-w0' || resolution.state === 'linux-l0') {
    await runSelectedRetainedEdge(async () => createSafeRegularFileExclusive({
      boundaryRoot: input.boundaryRoot, filePath: input.nextPath, bytes: input.next,
      label: `${input.label} NEXT recovery entry`, durability: input.durability
    }));
    await assertSuccessor(
      resolution,
      process.platform === 'win32' ? 'win32-w0->win32-w1' : 'linux-l0->linux-l1'
    );
  }
  if (resolution.state === 'win32-w1') {
    await runSelectedRetainedEdge(async (retained) => durableRename({
      boundaryRoot: input.boundaryRoot, sourcePath: input.nextPath, targetPath: input.targetPath,
      label: `${input.label} initial NEXT install`, durability: input.durability, replaceExisting: false,
      expectedSourceBytes: input.next, expectedSourceIdentity: retained.next.identity!, retained: retained.next.retained
    }));
    await assertSuccessor(resolution, 'win32-w1->win32-w2');
    return;
  }
  if (resolution.state === 'linux-l1') {
    await runSelectedRetainedEdge(async (retained) => durableLinkOpenedPosixFile({
      boundaryRoot: input.boundaryRoot, sourcePath: input.nextPath, targetPath: input.targetPath,
      expectedSourceBytes: input.next, expectedSourceIdentity: retained.next.identity!,
      label: `${input.label} exact initial NEXT install`, durability: input.durability, retained: retained.next.retained
    }));
    await assertSuccessor(resolution, 'linux-l1->linux-l2');
  }
  if (resolution.state === 'linux-l2') {
    await runSelectedRetainedEdge(async (retained) => durableRename({
      boundaryRoot: input.boundaryRoot, sourcePath: input.nextPath, targetPath: retiredNextPath,
      label: `${input.label} initial NEXT recovery retirement`, durability: input.durability, replaceExisting: false,
      expectedSourceBytes: input.next, expectedSourceIdentity: retained.next.identity!, retained: retained.next.retained
    }));
    await assertSuccessor(resolution, 'linux-l2->linux-l3');
  }
}

async function resolveFreezeTransactionRoot(
  repositoryRoot: string,
  durability?: FreezeDurabilityOptions
): Promise<string> {
  return ensureSafeDirectory({
    boundaryRoot: repositoryRoot,
    directoryPath: path.join(repositoryRoot, '.tmp/codex/document-control-plane-freeze-v1'),
    label: 'Document control transaction directory',
    durability
  });
}

async function writeFreezeJournal(
  repositoryRoot: string,
  expectedPreBytes: Buffer | null,
  journal: FreezeJournal,
  durability: FreezeDurabilityOptions,
  faultAfter?: FreezeFault
): Promise<Buffer> {
  const transactionRoot = await resolveFreezeTransactionRoot(repositoryRoot, durability);
  const journalPath = path.join(repositoryRoot, FreezeJournalRelativePath);
  const temporaryPath = `${journalPath}.${journal.operationId.slice('sha256:'.length)}.${journal.phase}.next`;
  const nextBytes = renderFreezeJournal(journal);
  const label = `Freeze journal ${journal.phase}`;
  if (expectedPreBytes === null) {
    await publishInitiallyAbsentEntryNoReplace({
      boundaryRoot: transactionRoot,
      nextPath: temporaryPath,
      targetPath: journalPath,
      targetKey: 'freeze-journal',
      next: nextBytes,
      label,
      durability
    });
  } else {
    const preQuarantineFault: Readonly<Partial<Record<FreezeJournalPhase, FreezeFault>>> = {
      'index-published': 'after-journal-index-published-pre-quarantine',
      'pointer-published': 'after-journal-pointer-published-pre-quarantine',
      'rolling-published': 'after-journal-rolling-published-pre-quarantine',
      terminal: 'after-journal-terminal-pre-quarantine'
    };
    const nextInstallFault: Readonly<Partial<Record<FreezeJournalPhase, FreezeFault>>> = {
      'index-published': 'after-journal-index-published-next-install',
      terminal: 'after-journal-terminal-next-install'
    };
    await publishEntryNoReplaceCas({
      boundaryRoot: transactionRoot,
      artifactRoot: transactionRoot,
      targetPath: journalPath,
      targetKey: 'freeze-journal',
      nextPath: temporaryPath,
      pre: expectedPreBytes,
      next: nextBytes,
      label,
      operationId: byteDigest(nextBytes),
      retainRecoveryEntries: true,
      faultAfterPreQuarantine: () => {
        const expected = preQuarantineFault[journal.phase];
        if (expected !== undefined) maybeFault(faultAfter, expected);
      },
      faultAfterNextInstall: () => {
        const expected = nextInstallFault[journal.phase];
        if (expected !== undefined) maybeFault(faultAfter, expected);
      },
      durability
    });
  }
  const readback = await readSafeRegularFile({
    boundaryRoot: transactionRoot,
    filePath: journalPath,
    label: 'Freeze journal readback'
  });
  if (!readback.equals(nextBytes)) {
    throw new Error('Freeze journal readback does not equal the exact requested NEXT bytes.');
  }
  parseFreezeJournal(readback.toString('utf8'));
  return nextBytes;
}

interface AnchoredJournalEntry {
  readonly name: string;
  readonly filePath: string;
  readonly bytes: Buffer;
  readonly identity: string;
  readonly physicalIdentity: AnchoredObjectIdentity;
}

interface AnchoredJournalDirectory {
  readonly transactionRoot: string;
  readonly names: readonly string[];
  readEntry(name: string, label: string): Promise<AnchoredJournalEntry | null>;
  listNames(): readonly string[];
}

interface FreezeJournalRecoveryState {
  readonly expectedPreBytes: Buffer | null;
  readonly nextJournal: FreezeJournal;
  readonly nextBytes: Buffer;
  readonly nextPath: string;
  readonly completionMode:
    | 'canonical-install-required'
    | 'active-next-retirement-required'
    | 'complete';
  readonly durabilityEntries: readonly AnchoredJournalEntry[];
}

interface FreezeJournalSnapshot {
  readonly journal: FreezeJournal;
  readonly bytes: Buffer;
  readonly canonicalPresent: boolean;
  readonly recovery: FreezeJournalRecoveryState | null;
  readonly durabilityEntries: readonly AnchoredJournalEntry[];
}

function effectiveFreezeJournal(snapshot: FreezeJournalSnapshot | null): FreezeJournal | null {
  if (snapshot === null) return null;
  return snapshot.recovery?.completionMode === 'canonical-install-required'
    ? snapshot.recovery.nextJournal
    : snapshot.journal;
}

const FreezeJournalNextPhase: Readonly<Partial<Record<FreezeJournalPhase, FreezeJournalPhase>>> = Object.freeze({
  prepared: 'index-published',
  'index-published': 'pointer-published',
  'pointer-published': 'rolling-published',
  'rolling-published': 'terminal'
});

const FreezeJournalPreviousPhase: Readonly<Partial<Record<FreezeJournalPhase, FreezeJournalPhase>>> = Object.freeze({
  'index-published': 'prepared',
  'pointer-published': 'index-published',
  'rolling-published': 'pointer-published',
  terminal: 'rolling-published'
});

const FreezeJournalRecoveryNextName = /^journal\.json\.([0-9a-f]{64})\.(prepared|index-published|pointer-published|rolling-published|terminal)\.next$/u;
const FreezeEntryRecoveryName = /^\.entry-([0-9a-f]{64})\.(pre|retired-pre|retired-next)$/u;
const FreezeJournalPhases = Object.freeze([
  'prepared',
  'index-published',
  'pointer-published',
  'rolling-published',
  'terminal'
] as const satisfies readonly FreezeJournalPhase[]);

function freezeJournalAtPhase(journal: FreezeJournal, phase: FreezeJournalPhase): FreezeJournal {
  return Object.freeze({ ...journal, phase });
}

function parseCanonicalFreezeJournalBytes(bytes: Buffer, label: string): FreezeJournal {
  const journal = parseFreezeJournal(bytes.toString('utf8'));
  if (!bytes.equals(renderFreezeJournal(journal))) {
    throw new Error(`${label} bytes are valid but noncanonical; preserving the entry.`);
  }
  return journal;
}

function assertDirectJournalEntryName(name: string, label: string): void {
  if (name.length === 0 || path.basename(name) !== name || name === '.' || name === '..') {
    throw new Error(`${label} is not an exact direct transaction entry name.`);
  }
}

async function withAnchoredJournalDirectory<T>(
  repositoryRoot: string,
  operation: (directory: AnchoredJournalDirectory) => Promise<T>
): Promise<T | null> {
  const transactionRoot = path.join(repositoryRoot, path.dirname(FreezeJournalRelativePath));
  let directoryIdentity: PhysicalDirectoryIdentity;
  try {
    directoryIdentity = inspectNoFollowDirectoryChain(
      transactionRoot,
      'Freeze journal recovery transaction directory'
    ).target;
  } catch (error) {
    if (isMissingError(error)) return null;
    return mapDocumentPhysicalError(error, {
      label: 'Freeze journal recovery transaction directory',
      targetPath: transactionRoot
    });
  }
  const listNames = (): readonly string[] => Object.freeze(
    scanNoFollowDirectoryDirectMetadata(directoryIdentity, {
      deadlineAtMs: performance.now() + 30_000,
      maximumEntries: 10_000
    }).map((entry) => entry.relativePath).sort()
  );
  const readEntry = async (name: string, label: string): Promise<AnchoredJournalEntry | null> => {
    assertDirectJournalEntryName(name, label);
    const entry = inspectNoFollowOrdinaryFileEntry(directoryIdentity, name);
    if (entry === null) return null;
    if (entry.kind !== 'file' || entry.bytes === null) {
      throw new Error(`${label} must be an exact regular file.`);
    }
    return Object.freeze({
      name,
      filePath: path.join(directoryIdentity.path, name),
      bytes: Buffer.from(entry.bytes),
      identity: `${entry.device}:${entry.inode}`,
      physicalIdentity: physicalIdentity(entry)
    });
  };
  const names = listNames();
  return operation(Object.freeze({
    transactionRoot: directoryIdentity.path,
    names,
    listNames,
    readEntry
  }));
}
function sameDirectoryNames(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

async function assertAnchoredJournalCensusStable(
  directory: AnchoredJournalDirectory,
  entries: readonly AnchoredJournalEntry[]
): Promise<void> {
  const namesReadback = directory.listNames();
  if (!sameDirectoryNames(directory.names, namesReadback)) {
    throw new Error('Freeze journal recovery census changed during its anchored readback.');
  }
  for (const entry of entries) {
    const readback = await directory.readEntry(entry.name, `${entry.name} recovery census readback`);
    if (readback === null || readback.identity !== entry.identity || !readback.bytes.equals(entry.bytes)) {
      throw new Error(`Freeze journal recovery entry changed during readback: ${entry.name}.`);
    }
  }
}

async function readJournalRecoveryEntry(
  directory: AnchoredJournalDirectory,
  filePath: string,
  expectedBytes: Buffer,
  label: string
): Promise<AnchoredJournalEntry | null> {
  const entry = await directory.readEntry(path.basename(filePath), label);
  if (entry !== null && !entry.bytes.equals(expectedBytes)) {
    throw new Error(`${label} contains unknown bytes; preserving the entry.`);
  }
  return entry;
}

function initialJournalTupleEntryAdapter(
  entry: AnchoredJournalEntry | null,
  nextBytes: Buffer
): InitiallyAbsentTupleEntry {
  return initialTupleEntryAdapter(
    entry === null
      ? Object.freeze({ bytes: null, identity: null })
      : Object.freeze({ bytes: entry.bytes, identity: entry.identity }),
    nextBytes
  );
}

async function inspectJournalTransitionRecovery(input: {
  directory: AnchoredJournalDirectory;
  journalPath: string;
  expectedPreBytes: Buffer | null;
  nextBytes: Buffer;
  canonicalEntry: AnchoredJournalEntry | null;
  nextEntry: AnchoredJournalEntry;
}): Promise<readonly AnchoredJournalEntry[]> {
  const operationId = byteDigest(input.nextBytes);
  const quarantinePath = entryRecoveryPath({
    artifactRoot: input.directory.transactionRoot,
    operationId,
    targetKey: 'freeze-journal',
    suffix: 'pre'
  });
  const retiredPrePath = entryRecoveryPath({
    artifactRoot: input.directory.transactionRoot,
    operationId,
    targetKey: 'freeze-journal',
    suffix: 'retired-pre'
  });
  const retiredNextPath = entryRecoveryPath({
    artifactRoot: input.directory.transactionRoot,
    operationId,
    targetKey: 'freeze-journal',
    suffix: 'retired-next'
  });
  const quarantine = input.expectedPreBytes === null
    ? await input.directory.readEntry(path.basename(quarantinePath), 'Freeze journal unexpected PRE quarantine')
    : await readJournalRecoveryEntry(
      input.directory,
      quarantinePath,
      input.expectedPreBytes,
      'Freeze journal exact PRE quarantine'
    );
  const retiredPre = input.expectedPreBytes === null
    ? await input.directory.readEntry(path.basename(retiredPrePath), 'Freeze journal unexpected retired PRE entry')
    : await readJournalRecoveryEntry(
      input.directory,
      retiredPrePath,
      input.expectedPreBytes,
      'Freeze journal exact retired PRE entry'
    );
  const retiredNext = input.expectedPreBytes === null
    ? await input.directory.readEntry(
        path.basename(retiredNextPath),
        'Freeze journal initially-absent retired NEXT entry'
      )
    : await readJournalRecoveryEntry(
        input.directory,
        retiredNextPath,
        input.nextBytes,
        'Freeze journal exact retired NEXT entry'
      );
  const present = [quarantine, retiredPre, retiredNext].filter(
    (entry): entry is AnchoredJournalEntry => entry !== null
  );

  if (input.expectedPreBytes === null) {
    if (quarantine !== null || retiredPre !== null) {
      throw new Error('Initially-absent freeze journal recovery has unexpected PRE artifacts; preserving them.');
    }
    const initialResolution = ClassifyInitiallyAbsentEntryTuple({
      platform: process.platform as InitiallyAbsentTuplePlatform,
      tuple: Object.freeze({
        target: initialJournalTupleEntryAdapter(input.canonicalEntry, input.nextBytes),
        next: initialJournalTupleEntryAdapter(input.nextEntry, input.nextBytes),
        retiredNext: initialJournalTupleEntryAdapter(retiredNext, input.nextBytes)
      })
    });
    if (initialResolution.status === 'invalid') {
      throw new Error(`Initially-absent freeze journal T/N/R contract rejected transition recovery (${initialResolution.reason}); preserving every entry.`);
    }
    return Object.freeze(present);
  }

  if (input.canonicalEntry === null) {
    if (process.platform === 'win32') {
      if (quarantine === null || retiredPre !== null || retiredNext !== null) {
        throw new Error('Windows freeze journal PRE quarantine recovery is incomplete or conflicting.');
      }
    } else if (process.platform === 'linux') {
      if (quarantine === null || retiredPre === null || retiredNext !== null
          || quarantine.identity !== retiredPre.identity) {
        throw new Error('Linux freeze journal PRE quarantine recovery is incomplete or has unprovable identity.');
      }
    }
    return Object.freeze(present);
  }

  if (input.canonicalEntry.bytes.equals(input.expectedPreBytes)) {
    if (process.platform === 'win32') {
      if (quarantine !== null || retiredPre !== null || retiredNext !== null) {
        throw new Error('Windows freeze journal pre-quarantine recovery state is conflicting.');
      }
    } else if (process.platform === 'linux') {
      if (retiredPre !== null || retiredNext !== null
          || (quarantine !== null && quarantine.identity !== input.canonicalEntry.identity)) {
        throw new Error('Linux freeze journal pre-quarantine recovery identity is conflicting.');
      }
    }
    return Object.freeze(present);
  }

  if (!input.canonicalEntry.bytes.equals(input.nextBytes)) {
    throw new Error('Canonical freeze journal is neither the exact recovery PRE nor NEXT.');
  }
  if (process.platform === 'win32') {
    if (quarantine === null || retiredPre !== null || retiredNext !== null) {
      throw new Error('Windows installed freeze journal NEXT recovery state is incomplete or conflicting.');
    }
  } else if (process.platform === 'linux') {
    if (quarantine === null || retiredPre === null || quarantine.identity !== retiredPre.identity
        || (retiredNext !== null && retiredNext.identity !== input.canonicalEntry.identity)
        || (retiredNext === null && input.nextEntry.identity !== input.canonicalEntry.identity)) {
      throw new Error('Linux installed freeze journal NEXT recovery identity is incomplete or conflicting.');
    }
  }
  return Object.freeze(present);
}

type FreezeEntryRecoverySuffix = 'pre' | 'retired-pre' | 'retired-next';

interface FreezeEntryRecoveryExpectation {
  readonly bytes: Buffer;
  readonly identityGroup: string;
}

interface FreezeEntryRecoveryNames {
  readonly pre: string;
  readonly retiredPre: string;
  readonly retiredNext: string;
}

interface FreezeEntryRecoveryCensusPlan {
  readonly expectations: ReadonlyMap<string, FreezeEntryRecoveryExpectation>;
  readonly initialRetiredNext: string;
  readonly journalTransitions: ReadonlyMap<FreezeJournalPhase, FreezeEntryRecoveryNames>;
  readonly pointer: FreezeEntryRecoveryNames | null;
  readonly rollingPlan: FreezeEntryRecoveryNames | null;
  readonly effectivePhaseIndex: number;
}

function freezeJournalPhaseIndex(phase: FreezeJournalPhase): number {
  const index = FreezeJournalPhases.indexOf(phase);
  if (index < 0) throw new Error(`Unsupported freeze journal phase for recovery census: ${phase}.`);
  return index;
}

function freezeEntryRecoveryNames(input: {
  artifactRoot: string;
  operationId: string;
  targetKey: DocumentControlRecoveryTargetKey;
}): FreezeEntryRecoveryNames {
  const name = (suffix: FreezeEntryRecoverySuffix): string => path.basename(entryRecoveryPath({
    ...input,
    suffix
  }));
  return Object.freeze({
    pre: name('pre'),
    retiredPre: name('retired-pre'),
    retiredNext: name('retired-next')
  });
}

function createFreezeEntryRecoveryCensusPlan(input: {
  repositoryRoot: string;
  transactionRoot: string;
  journalPath: string;
  journal: FreezeJournal;
}): FreezeEntryRecoveryCensusPlan {
  const phaseBytes = new Map<FreezeJournalPhase, Buffer>(FreezeJournalPhases.map((phase) => [
    phase,
    renderFreezeJournal(freezeJournalAtPhase(input.journal, phase))
  ]));
  const requirePhaseBytes = (phase: FreezeJournalPhase): Buffer => {
    const bytes = phaseBytes.get(phase);
    if (bytes === undefined) throw new Error(`Missing canonical freeze journal bytes for phase ${phase}.`);
    return bytes;
  };
  const expectations = new Map<string, FreezeEntryRecoveryExpectation>();
  const add = (name: string, bytes: Buffer, identityGroup: string): void => {
    const prior = expectations.get(name);
    if (prior !== undefined && (!prior.bytes.equals(bytes) || prior.identityGroup !== identityGroup)) {
      throw new Error(`Freeze recovery census expectation collision for ${name}.`);
    }
    expectations.set(name, Object.freeze({ bytes, identityGroup }));
  };
  const effectivePhaseIndex = freezeJournalPhaseIndex(input.journal.phase);
  const preparedBytes = requirePhaseBytes('prepared');
  const initialNames = freezeEntryRecoveryNames({
    artifactRoot: input.transactionRoot,
    operationId: byteDigest(preparedBytes),
    targetKey: 'freeze-journal'
  });
  add(initialNames.retiredNext, preparedBytes, 'journal:prepared');

  const journalTransitions = new Map<FreezeJournalPhase, FreezeEntryRecoveryNames>();
  for (let index = 1; index <= effectivePhaseIndex; index += 1) {
    const phase = FreezeJournalPhases[index]!;
    const previousPhase = FreezeJournalPhases[index - 1]!;
    const nextBytes = requirePhaseBytes(phase);
    const previousBytes = requirePhaseBytes(previousPhase);
    const names = freezeEntryRecoveryNames({
      artifactRoot: input.transactionRoot,
      operationId: byteDigest(nextBytes),
      targetKey: 'freeze-journal'
    });
    journalTransitions.set(phase, names);
    add(names.pre, previousBytes, `journal:${previousPhase}`);
    if (process.platform === 'linux') {
      add(names.retiredPre, previousBytes, `journal:${previousPhase}`);
      add(names.retiredNext, nextBytes, `journal:${phase}`);
    }
  }

  const addProjectionRecovery = (
    targetKey: DocumentControlRecoveryTargetKey,
    pre: Buffer,
    next: Buffer,
    label: string
  ): FreezeEntryRecoveryNames => {
    const names = freezeEntryRecoveryNames({
      artifactRoot: input.transactionRoot,
      operationId: input.journal.operationId,
      targetKey
    });
    add(names.pre, pre, `${label}:pre`);
    if (process.platform === 'linux') {
      add(names.retiredPre, pre, `${label}:pre`);
      add(names.retiredNext, next, `${label}:next`);
    }
    return names;
  };

  const pointerPre = fromBase64(input.journal.files.pointer.pre, 'Freeze pointer PRE recovery census');
  const pointerNext = fromBase64(input.journal.files.pointer.next, 'Freeze pointer NEXT recovery census');
  const rollingPlanPre = fromBase64(
    input.journal.files.rollingPlan.pre,
    'Freeze rolling-plan PRE recovery census'
  );
  const rollingPlanNext = fromBase64(
    input.journal.files.rollingPlan.next,
    'Freeze rolling-plan NEXT recovery census'
  );
  const pointer = effectivePhaseIndex >= freezeJournalPhaseIndex('index-published')
      && !pointerPre.equals(pointerNext)
    ? addProjectionRecovery(
        'active-pointer',
        pointerPre,
        pointerNext,
        'pointer'
      )
    : null;
  const rollingPlan = effectivePhaseIndex >= freezeJournalPhaseIndex('pointer-published')
      && !rollingPlanPre.equals(rollingPlanNext)
    ? addProjectionRecovery(
        'rolling-plan',
        rollingPlanPre,
        rollingPlanNext,
        'rolling-plan'
      )
    : null;

  if (process.platform === 'win32') {
    if (effectivePhaseIndex > freezeJournalPhaseIndex('index-published') && pointer !== null) {
      expectations.delete(pointer.pre);
    }
    if (effectivePhaseIndex > freezeJournalPhaseIndex('pointer-published') && rollingPlan !== null) {
      expectations.delete(rollingPlan.pre);
    }
  }
  return Object.freeze({
    expectations,
    initialRetiredNext: initialNames.retiredNext,
    journalTransitions,
    pointer,
    rollingPlan,
    effectivePhaseIndex
  });
}

async function assertFreezeEntryRecoveryCensus(input: {
  repositoryRoot: string;
  plan: FreezeEntryRecoveryCensusPlan;
  entries: readonly AnchoredJournalEntry[];
  canonicalEntry: AnchoredJournalEntry | null;
  canonicalJournal: FreezeJournal | null;
  nextEntry: AnchoredJournalEntry | null;
  nextJournal: FreezeJournal | null;
}): Promise<void> {
  const entries = new Map(input.entries.map((entry) => [entry.name, entry]));
  const present = (name: string): boolean => entries.has(name);
  const terminalRetirement = input.plan.effectivePhaseIndex === freezeJournalPhaseIndex('terminal')
    && (input.canonicalJournal?.phase === 'terminal' || input.nextJournal?.phase === 'terminal');
  const preparedCanonicalEntry = input.canonicalJournal?.phase === 'prepared'
    ? input.canonicalEntry
    : null;
  const preparedNextEntry = input.nextJournal?.phase === 'prepared'
    ? input.nextEntry
    : null;
  const initialPreparedBytes = preparedNextEntry?.bytes ?? preparedCanonicalEntry?.bytes ?? null;
  for (const entry of input.entries) {
    const expected = input.plan.expectations.get(entry.name);
    if (expected === undefined) {
      throw new Error(`Unbound freeze entry recovery residue is preserved: ${entry.name}.`);
    }
    if (initialPreparedBytes !== null && entry.name === input.plan.initialRetiredNext) continue;
    if (!entry.bytes.equals(expected.bytes)) {
      throw new Error(`Freeze entry recovery residue contains unknown bytes and is preserved: ${entry.name}.`);
    }
  }

  if (process.platform === 'linux') {
    const identities = new Map<string, string>();
    const bindIdentity = (group: string, identity: string, name: string): void => {
      const prior = identities.get(group);
      if (prior !== undefined && prior !== identity) {
        throw new Error(`Linux freeze entry recovery identity is unprovable for ${name}.`);
      }
      identities.set(group, identity);
    };
    if (input.canonicalEntry !== null && input.canonicalJournal !== null
        && input.canonicalJournal.phase !== 'prepared') {
      bindIdentity(`journal:${input.canonicalJournal.phase}`, input.canonicalEntry.identity, input.canonicalEntry.name);
    }
    if (input.nextEntry !== null && input.nextJournal !== null
        && input.nextJournal.phase !== 'prepared') {
      bindIdentity(`journal:${input.nextJournal.phase}`, input.nextEntry.identity, input.nextEntry.name);
    }
    for (const entry of input.entries) {
      if (initialPreparedBytes !== null && entry.name === input.plan.initialRetiredNext) continue;
      bindIdentity(input.plan.expectations.get(entry.name)!.identityGroup, entry.identity, entry.name);
    }
  }

  const requirePresent = (name: string, label: string): void => {
    if (!present(name)) throw new Error(`${label} recovery residue is missing.`);
  };
  const requireAbsent = (name: string, label: string): void => {
    if (present(name)) throw new Error(`${label} recovery residue is conflicting and preserved.`);
  };
  if (initialPreparedBytes !== null) {
    const initialRetiredNext = entries.get(input.plan.initialRetiredNext) ?? null;
    const initialResolution = ClassifyInitiallyAbsentEntryTuple({
      platform: process.platform as InitiallyAbsentTuplePlatform,
      tuple: Object.freeze({
        target: initialJournalTupleEntryAdapter(preparedCanonicalEntry, initialPreparedBytes),
        next: initialJournalTupleEntryAdapter(preparedNextEntry, initialPreparedBytes),
        retiredNext: initialJournalTupleEntryAdapter(initialRetiredNext, initialPreparedBytes)
      })
    });
    if (initialResolution.status === 'invalid') {
      throw new Error(`Initial prepared freeze journal T/N/R contract rejected the recovery census (${initialResolution.reason}); preserving every entry.`);
    }
  } else if (process.platform === 'linux' && !terminalRetirement) {
    requirePresent(input.plan.initialRetiredNext, 'Retained initial journal NEXT');
  } else if (!terminalRetirement) {
    requireAbsent(input.plan.initialRetiredNext, 'Retained initial journal NEXT');
  }

  for (const [phase, names] of input.plan.journalTransitions) {
    const isActive = input.nextJournal?.phase === phase;
    if (!isActive) {
      if (terminalRetirement) continue;
      requirePresent(names.pre, `${phase} journal PRE`);
      if (process.platform === 'linux') {
        requirePresent(names.retiredPre, `${phase} journal retired PRE`);
        requirePresent(names.retiredNext, `${phase} journal retired NEXT`);
      }
      continue;
    }
    if (process.platform === 'win32') {
      if (input.canonicalEntry === null) requirePresent(names.pre, `${phase} active journal PRE`);
      else requireAbsent(names.pre, `${phase} pre-quarantine journal PRE`);
      continue;
    }
    if (input.canonicalEntry === null || input.canonicalJournal?.phase === phase) {
      requirePresent(names.pre, `${phase} active journal PRE`);
      requirePresent(names.retiredPre, `${phase} active journal retired PRE`);
      requireAbsent(names.retiredNext, `${phase} active journal retired NEXT`);
    } else {
      const hasPre = present(names.pre);
      const hasRetiredPre = present(names.retiredPre);
      const hasRetiredNext = present(names.retiredNext);
      if ((hasPre || hasRetiredPre || hasRetiredNext)
          && !(hasPre && !hasRetiredPre && !hasRetiredNext)) {
        throw new Error(`${phase} pre-quarantine journal recovery residue set is incomplete or conflicting and is preserved.`);
      }
    }
  }

  const assertProjectionState = async (
    names: FreezeEntryRecoveryNames | null,
    startPhase: FreezeJournalPhase,
    label: string,
    targetPath: string
  ): Promise<void> => {
    if (names === null) return;
    const startIndex = freezeJournalPhaseIndex(startPhase);
    if (process.platform === 'win32') {
      if (terminalRetirement) return;
      if (input.plan.effectivePhaseIndex > startIndex) requireAbsent(names.pre, `${label} completed PRE`);
      return;
    }
    const hasPre = present(names.pre);
    const hasRetiredPre = present(names.retiredPre);
    const hasRetiredNext = present(names.retiredNext);
    if (input.plan.effectivePhaseIndex > startIndex) {
      if (terminalRetirement) return;
      requirePresent(names.pre, `${label} completed PRE`);
      requirePresent(names.retiredPre, `${label} completed retired PRE`);
      requirePresent(names.retiredNext, `${label} completed retired NEXT`);
    } else if (hasPre && !hasRetiredPre && !hasRetiredNext) {
      await assertPosixEntryIdentity({
        boundaryRoot: input.repositoryRoot,
        leftPath: targetPath,
        rightPath: entries.get(names.pre)!.filePath,
        label: `${label} S1 PRE recovery identity`
      });
    } else if ((hasPre || hasRetiredPre || hasRetiredNext)
        && !(hasPre && hasRetiredPre && !hasRetiredNext)
        && !(hasPre && hasRetiredPre && hasRetiredNext)) {
      throw new Error(`${label} active recovery residue set is incomplete or conflicting and is preserved.`);
    }
  };
  await assertProjectionState(
    input.plan.pointer,
    'index-published',
    'Pointer',
    path.join(input.repositoryRoot, ...ActivePointerPath.split('/'))
  );
  await assertProjectionState(
    input.plan.rollingPlan,
    'pointer-published',
    'Rolling-plan',
    path.join(input.repositoryRoot, ...RollingPlanPath.split('/'))
  );
}

interface TerminalRetirementPlanEntry {
  readonly boundaryRoot: string;
  readonly filePath: string;
  readonly label: string;
  readonly expectedBytes: Buffer;
}

async function assertTerminalRetirementPrefix(input: {
  repositoryRoot: string;
  transactionRoot: string;
  journal: FreezeJournal;
  journalBytes: Buffer;
  transactionPlan?: FreezeEntryRecoveryCensusPlan;
}): Promise<void> {
  if (input.journal.phase !== 'terminal') {
    throw new Error('Terminal retirement prefix requires one terminal journal.');
  }
  const indexPaths = await resolveIndexPaths(input.repositoryRoot);
  const indexNames = freezeEntryRecoveryNames({
    artifactRoot: indexPaths.gitDirectory,
    operationId: input.journal.operationId,
    targetKey: 'git-index'
  });
  const entries: TerminalRetirementPlanEntry[] = [];
  if (input.journal.preIndexTreeSha !== input.journal.candidateTreeSha) {
    const indexPre = fromBase64(input.journal.index.pre, 'Terminal retirement index PRE');
    const indexNext = fromBase64(input.journal.index.next, 'Terminal retirement index NEXT');
    const orderedIndexNames = process.platform === 'win32'
      ? [indexNames.pre]
      : process.platform === 'linux'
        ? [indexNames.retiredNext, indexNames.retiredPre, indexNames.pre]
        : (() => { throw new Error(`Terminal retirement is unsupported on ${process.platform}.`); })();
    for (const name of orderedIndexNames) {
      entries.push(Object.freeze({
        boundaryRoot: indexPaths.gitDirectory,
        filePath: path.join(indexPaths.gitDirectory, name),
        label: `Terminal retirement Git index ${name}`,
        expectedBytes: name === indexNames.retiredNext ? indexNext : indexPre
      }));
    }
  }
  const allowedIndexNames = new Set(entries.map((entry) => path.basename(entry.filePath)));
  const unknownIndexName = scanDirectDirectoryNames(
    indexPaths.gitDirectory,
    'Terminal retirement Git index recovery census'
  )
    .filter((name) => name.startsWith('.entry-'))
    .find((name) => !allowedIndexNames.has(name));
  if (unknownIndexName !== undefined) {
    throw new Error(`Terminal retirement found unbound Git index residue and preserves it: ${unknownIndexName}.`);
  }

  const transactionPlan = input.transactionPlan ?? createFreezeEntryRecoveryCensusPlan({
    repositoryRoot: input.repositoryRoot,
    transactionRoot: input.transactionRoot,
    journalPath: path.join(input.transactionRoot, path.basename(FreezeJournalRelativePath)),
    journal: input.journal
  });
  const transactionExpectations = [...transactionPlan.expectations.entries()]
    .filter(([name]) => process.platform !== 'win32' || name !== transactionPlan.initialRetiredNext)
    .sort(([left], [right]) => left.localeCompare(right));
  for (const [name, expectation] of transactionExpectations) {
    entries.push(Object.freeze({
      boundaryRoot: input.transactionRoot,
      filePath: path.join(input.transactionRoot, name),
      label: `Terminal retirement transaction ${name}`,
      expectedBytes: expectation.bytes
    }));
  }
  const allowedTransactionNames = new Set(transactionExpectations.map(([name]) => name));
  const unknownTransactionName = scanDirectDirectoryNames(
    input.transactionRoot,
    'Terminal retirement transaction recovery census'
  )
    .filter((name) => name.startsWith('.entry-'))
    .find((name) => !allowedTransactionNames.has(name));
  if (unknownTransactionName !== undefined) {
    throw new Error(
      `Terminal retirement found unbound transaction residue and preserves it: ${unknownTransactionName}.`
    );
  }
  entries.push(Object.freeze({
    boundaryRoot: input.transactionRoot,
    filePath: path.join(input.transactionRoot, path.basename(FreezeJournalRelativePath)),
    label: 'Terminal retirement canonical journal',
    expectedBytes: input.journalBytes
  }));

  const presence: boolean[] = [];
  for (const entry of entries) {
    const observation = await observeOptionalSafeRegularFile({
      boundaryRoot: entry.boundaryRoot,
      filePath: entry.filePath,
      label: entry.label
    });
    presence.push(observation !== null);
    if (observation !== null && !observation.bytes.equals(entry.expectedBytes)) {
      throw new Error(`${entry.label} has unknown bytes and is preserved.`);
    }
  }
  const classification = ClassifyTerminalRetirementPrefix(presence);
  if (classification.status === 'invalid') {
    throw new Error('Terminal retirement residue topology is not one exact canonical deletion prefix; preserving it.');
  }
}

async function readFreezeJournalSnapshot(
  repositoryRoot: string,
  beforeCensusReadback?: () => Promise<void> | void
): Promise<FreezeJournalSnapshot | null> {
  return withAnchoredJournalDirectory(repositoryRoot, async (directory) => {
    const journalPath = path.join(directory.transactionRoot, path.basename(FreezeJournalRelativePath));
    const directEntries = new Map<string, AnchoredJournalEntry>();
    for (const name of directory.names) {
      const entry = await directory.readEntry(name, `Freeze transaction direct residue ${name}`);
      if (entry === null) throw new Error(`Freeze transaction direct residue disappeared during census: ${name}.`);
      directEntries.set(name, entry);
    }
    const relevantEntries = [...directEntries.values()];
    await beforeCensusReadback?.();
    await assertAnchoredJournalCensusStable(directory, relevantEntries);

    const canonicalEntry = directEntries.get('journal.json') ?? null;
    const journalRecoveryNames = directory.names.filter((name) => name.startsWith('journal.json.'));
    const malformedName = journalRecoveryNames.find((name) => !FreezeJournalRecoveryNextName.test(name));
    if (malformedName !== undefined) {
      throw new Error(`Unknown freeze journal recovery entry name is preserved: ${malformedName}.`);
    }
    if (journalRecoveryNames.length > 1) {
      throw new Error('Duplicate freeze journal active NEXT recovery entries are preserved.');
    }

    const canonicalJournal = canonicalEntry === null
      ? null
      : parseCanonicalFreezeJournalBytes(canonicalEntry.bytes, 'Freeze journal');
    const nextName = journalRecoveryNames[0];
    let nextEntry: AnchoredJournalEntry | null = null;
    let nextJournal: FreezeJournal | null = null;
    if (nextName !== undefined) {
      nextEntry = directEntries.get(nextName) ?? null;
      if (nextEntry === null) throw new Error('Freeze journal active NEXT recovery entry disappeared during census.');
      nextJournal = parseCanonicalFreezeJournalBytes(nextEntry.bytes, 'Freeze journal active NEXT recovery entry');
      const match = FreezeJournalRecoveryNextName.exec(nextName)!;
      if (match[1] !== nextJournal.operationId.slice('sha256:'.length) || match[2] !== nextJournal.phase) {
        throw new Error('Freeze journal active NEXT recovery filename is not bound to its operation and phase.');
      }
    }

    const entryRecoveryNames = directory.names.filter((name) => name.startsWith('.entry-'));
    const entryRecoveryEntries = entryRecoveryNames.map((name) => directEntries.get(name)!);
    const malformedEntryRecoveryName = entryRecoveryNames.find((name) => !FreezeEntryRecoveryName.test(name));
    if (malformedEntryRecoveryName !== undefined) {
      throw new Error(`Unknown freeze entry recovery residue name is preserved: ${malformedEntryRecoveryName}.`);
    }
    const unknownDirectName = directory.names.find((name) => (
      name !== 'journal.json'
      && !name.startsWith('journal.json.')
      && !name.startsWith('.entry-')
    ));

    if (canonicalJournal === null && nextJournal === null) {
      if (directory.names.length > 0) {
        throw new Error('Freeze journal is absent while direct transaction residues remain; preserving every residue.');
      }
      return null;
    }

    if (unknownDirectName !== undefined) {
      throw new Error(`Unknown freeze transaction direct residue is preserved: ${unknownDirectName}.`);
    }

    const censusJournal = nextJournal ?? canonicalJournal!;
    const censusPlan = createFreezeEntryRecoveryCensusPlan({
      repositoryRoot,
      transactionRoot: directory.transactionRoot,
      journalPath,
      journal: censusJournal
    });
    await assertFreezeEntryRecoveryCensus({
      repositoryRoot,
      plan: censusPlan,
      entries: entryRecoveryEntries,
      canonicalEntry,
      canonicalJournal,
      nextEntry,
      nextJournal
    });
    if (canonicalJournal?.phase === 'terminal' && nextJournal === null) {
      await assertTerminalRetirementPrefix({
        repositoryRoot,
        transactionRoot: directory.transactionRoot,
        journal: canonicalJournal,
        journalBytes: canonicalEntry!.bytes,
        transactionPlan: censusPlan
      });
    }

    if (canonicalJournal === null) {
      const predecessor = FreezeJournalPreviousPhase[nextJournal!.phase];
      const expectedPreBytes = predecessor === undefined
        ? null
        : renderFreezeJournal(freezeJournalAtPhase(nextJournal!, predecessor));
      const recoveryEntries = await inspectJournalTransitionRecovery({
        directory,
        journalPath,
        expectedPreBytes,
        nextBytes: nextEntry!.bytes,
        canonicalEntry: null,
        nextEntry: nextEntry!
      });
      relevantEntries.push(...recoveryEntries);
      await assertAnchoredJournalCensusStable(directory, relevantEntries);
      const recovery = Object.freeze({
        expectedPreBytes,
        nextJournal: nextJournal!,
        nextBytes: nextEntry!.bytes,
        nextPath: nextEntry!.filePath,
        completionMode: 'canonical-install-required' as const,
        durabilityEntries: Object.freeze([
          ...new Map(relevantEntries.map((entry) => [entry.filePath, entry])).values()
        ])
      });
      return Object.freeze({
        journal: nextJournal!,
        bytes: nextEntry!.bytes,
        canonicalPresent: false,
        recovery,
        durabilityEntries: recovery.durabilityEntries
      });
    }

    let recovery: FreezeJournalRecoveryState | null = null;
    if (nextJournal !== null) {
      let expectedPreBytes: Buffer | null;
      let completionMode: FreezeJournalRecoveryState['completionMode'];
      if (nextEntry!.bytes.equals(canonicalEntry!.bytes)) {
        if (nextEntry!.identity !== canonicalEntry!.identity) {
          throw new Error('Freeze journal canonical NEXT and active recovery name are different exact objects.');
        }
        if (process.platform !== 'linux') {
          throw new Error('An active freeze journal NEXT beside canonical NEXT is supported only as a Linux exact link.');
        }
        const predecessor = FreezeJournalPreviousPhase[nextJournal.phase];
        expectedPreBytes = predecessor === undefined
          ? null
          : renderFreezeJournal(freezeJournalAtPhase(nextJournal, predecessor));
        completionMode = 'active-next-retirement-required';
      } else {
        const successor = FreezeJournalNextPhase[canonicalJournal.phase];
        if (successor === undefined
            || !nextEntry!.bytes.equals(renderFreezeJournal(freezeJournalAtPhase(canonicalJournal, successor)))) {
          throw new Error('Freeze journal active NEXT is not the exact direct successor of canonical PRE.');
        }
        expectedPreBytes = canonicalEntry!.bytes;
        completionMode = 'canonical-install-required';
      }
      const recoveryEntries = await inspectJournalTransitionRecovery({
        directory,
        journalPath,
        expectedPreBytes,
        nextBytes: nextEntry!.bytes,
        canonicalEntry,
        nextEntry: nextEntry!
      });
      relevantEntries.push(...recoveryEntries);
      recovery = Object.freeze({
        expectedPreBytes,
        nextJournal,
        nextBytes: nextEntry!.bytes,
        nextPath: nextEntry!.filePath,
        completionMode,
        durabilityEntries: Object.freeze([
          ...new Map(relevantEntries.map((entry) => [entry.filePath, entry])).values()
        ])
      });
    } else if (canonicalJournal.phase === 'terminal') {
      const retainedTerminalEntries = relevantEntries.filter((entry) => entry.name.startsWith('.entry-'));
      if (retainedTerminalEntries.length > 0) {
        recovery = Object.freeze({
          expectedPreBytes: null,
          nextJournal: canonicalJournal,
          nextBytes: canonicalEntry!.bytes,
          nextPath: canonicalEntry!.filePath,
          completionMode: 'complete',
          durabilityEntries: Object.freeze(retainedTerminalEntries)
        });
      }
    } else {
      const predecessor = FreezeJournalPreviousPhase[canonicalJournal.phase];
      if (predecessor !== undefined) {
        const expectedPreBytes = renderFreezeJournal(freezeJournalAtPhase(canonicalJournal, predecessor));
        const syntheticNextEntry: AnchoredJournalEntry = Object.freeze({
          ...canonicalEntry!,
          name: 'journal.json'
        });
        const recoveryEntries = await inspectJournalTransitionRecovery({
          directory,
          journalPath,
          expectedPreBytes,
          nextBytes: canonicalEntry!.bytes,
          canonicalEntry,
          nextEntry: syntheticNextEntry
        });
        relevantEntries.push(...recoveryEntries);
        if (recoveryEntries.length > 0) {
          recovery = Object.freeze({
            expectedPreBytes,
            nextJournal: canonicalJournal,
            nextBytes: canonicalEntry!.bytes,
            nextPath: canonicalEntry!.filePath,
            completionMode: 'complete',
            durabilityEntries: recoveryEntries
          });
        }
      } else {
        const initialRetiredNextPath = entryRecoveryPath({
          artifactRoot: directory.transactionRoot,
          operationId: byteDigest(canonicalEntry!.bytes),
          targetKey: 'freeze-journal',
          suffix: 'retired-next'
        });
        const initialRetiredNext = await directory.readEntry(
          path.basename(initialRetiredNextPath),
          'Freeze journal initial retired NEXT entry'
        );
        const initialResolution = ClassifyInitiallyAbsentEntryTuple({
          platform: process.platform as InitiallyAbsentTuplePlatform,
          tuple: Object.freeze({
            target: initialJournalTupleEntryAdapter(canonicalEntry, canonicalEntry!.bytes),
            next: initialJournalTupleEntryAdapter(null, canonicalEntry!.bytes),
            retiredNext: initialJournalTupleEntryAdapter(initialRetiredNext, canonicalEntry!.bytes)
          })
        });
        if (initialResolution.status === 'invalid') {
          throw new Error(`Canonical prepared freeze journal T/N/R contract rejected the no-active-NEXT snapshot (${initialResolution.reason}); preserving every entry.`);
        }
        if (initialRetiredNext !== null) {
          relevantEntries.push(initialRetiredNext);
          recovery = Object.freeze({
            expectedPreBytes: null,
            nextJournal: canonicalJournal,
            nextBytes: canonicalEntry!.bytes,
            nextPath: canonicalEntry!.filePath,
            completionMode: 'complete',
            durabilityEntries: Object.freeze([initialRetiredNext])
          });
        }
      }
    }
    await assertAnchoredJournalCensusStable(directory, relevantEntries);
    return Object.freeze({
      journal: canonicalJournal,
      bytes: canonicalEntry!.bytes,
      canonicalPresent: true,
      recovery,
      durabilityEntries: Object.freeze([
        ...new Map(relevantEntries.map((entry) => [entry.filePath, entry])).values()
      ])
    });
  });
}

async function restoreFreezeJournalDurability(
  repositoryRoot: string,
  durability: FreezeDurabilityOptions,
  snapshot: FreezeJournalSnapshot
): Promise<void> {
  const transactionRoot = await resolveFreezeTransactionRoot(repositoryRoot, durability);
  const uniqueEntries = new Map(snapshot.durabilityEntries.map((entry) => [entry.filePath, entry]));
  for (const entry of uniqueEntries.values()) {
    const readback = await readSafeRegularFile({
      boundaryRoot: transactionRoot,
      filePath: entry.filePath,
      label: `Freeze journal recovery durability ${entry.name}`
    });
    if (!readback.equals(entry.bytes)) {
      throw new Error(`Freeze journal recovery durability entry changed: ${entry.name}.`);
    }
    await flushPublishedFile({
      boundaryRoot: transactionRoot,
      targetPath: entry.filePath,
      label: `Freeze journal recovery durability ${entry.name}`,
      durability,
      expectedBytes: entry.bytes,
      expectedIdentity: anchoredJournalEntryIdentity(entry)
    });
  }
}

function maybeFault(actual: FreezeFault | undefined, expected: FreezeFault): void {
  if (actual === expected) throw new Error(`Injected document control freeze fault: ${expected}.`);
}

interface GitIndexPaths {
  readonly gitDirectory: string;
  readonly indexPath: string;
  readonly lockPath: string;
}

async function resolveIndexPaths(
  repositoryRoot: string,
  allowMissingIndex = false
): Promise<GitIndexPaths> {
  const gitDirectoryCandidate = requireCommand(
    await run('git', ['rev-parse', '--absolute-git-dir'], repositoryRoot),
    'Git directory path'
  );
  const gitDirectory = await canonicalDirectoryBoundary(gitDirectoryCandidate, 'Git directory');
  const candidate = requireCommand(
    await run('git', ['rev-parse', '--git-path', 'index'], repositoryRoot),
    'Git index path'
  );
  const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(repositoryRoot, candidate);
  const indexPath = await inspectSafePath({
    boundaryRoot: gitDirectory,
    candidatePath: resolved,
    label: 'Git index',
    finalKind: 'file',
    allowMissing: allowMissingIndex
  });
  const resolvedIndexPath = indexPath ?? resolved;
  const lockPath = `${resolvedIndexPath}.lock`;
  await inspectSafePath({
    boundaryRoot: gitDirectory,
    candidatePath: lockPath,
    label: 'Git index lock',
    finalKind: 'file',
    allowMissing: true
  });
  return Object.freeze({ gitDirectory, indexPath: resolvedIndexPath, lockPath });
}

async function preflightFreezeProjectionEntryStates(
  repositoryRoot: string,
  snapshot: FreezeJournalSnapshot
): Promise<void> {
  const journal = effectiveFreezeJournal(snapshot)!;
  const transactionRoot = await canonicalDirectoryBoundary(
    path.join(repositoryRoot, path.dirname(FreezeJournalRelativePath)),
    'Document control recovery transaction directory'
  );
  const indexPaths = await resolveIndexPaths(repositoryRoot, true);
  const pointerPath = await resolveRecoverableRepositoryFile(repositoryRoot, ActivePointerPath);
  const rollingPlanPath = await resolveRecoverableRepositoryFile(repositoryRoot, RollingPlanPath);
  const classifiers: PublishTupleClassifierInput[] = [];
  if (journal.preIndexTreeSha === journal.candidateTreeSha) {
    await assertIndexSemanticIdentity({
      repositoryRoot,
      indexPaths,
      expectedTreeSha: journal.candidateTreeSha,
      label: 'Freeze preflight Git index semantic NOOP'
    });
  } else {
    classifiers.push(createPublishTupleClassifierInput({
      boundaryRoot: indexPaths.gitDirectory,
      artifactRoot: indexPaths.gitDirectory,
      targetPath: indexPaths.indexPath,
      targetKey: 'git-index',
      nextPath: indexPaths.lockPath,
      pre: fromBase64(journal.index.pre, 'Freeze preflight index PRE'),
      next: fromBase64(journal.index.next, 'Freeze preflight index NEXT'),
      label: 'Git index',
      operationId: journal.operationId
    }));
  }
  classifiers.push(
    createPublishTupleClassifierInput({
      boundaryRoot: repositoryRoot,
      artifactRoot: transactionRoot,
      targetPath: pointerPath,
      targetKey: 'active-pointer',
      nextPath: atomicCasNextPath(pointerPath, journal.operationId),
      pre: fromBase64(journal.files.pointer.pre, 'Freeze preflight pointer PRE'),
      next: fromBase64(journal.files.pointer.next, 'Freeze preflight pointer NEXT'),
      label: 'Active pointer',
      operationId: journal.operationId
    }),
    createPublishTupleClassifierInput({
      boundaryRoot: repositoryRoot,
      artifactRoot: transactionRoot,
      targetPath: rollingPlanPath,
      targetKey: 'rolling-plan',
      nextPath: atomicCasNextPath(rollingPlanPath, journal.operationId),
      pre: fromBase64(journal.files.rollingPlan.pre, 'Freeze preflight rolling-plan PRE'),
      next: fromBase64(journal.files.rollingPlan.next, 'Freeze preflight rolling-plan NEXT'),
      label: 'Rolling plan',
      operationId: journal.operationId
    })
  );
  for (const classifier of classifiers) {
    await classifyPublishEntryState(classifier);
  }
}

async function assertIndexSemanticIdentity(input: {
  repositoryRoot: string;
  indexPaths: GitIndexPaths;
  expectedTreeSha: string;
  label: string;
}): Promise<void> {
  const lockBytes = await readOptionalSafeRegularFile({
    boundaryRoot: input.indexPaths.gitDirectory,
    filePath: input.indexPaths.lockPath,
    label: `${input.label} lock`
  });
  if (lockBytes !== null) throw new Error(`${input.label} found an active Git index lock; preserving it.`);
  const { treeSha } = await captureRepositoryIndexTreeThroughExternalScratch({
    repositoryRoot: input.repositoryRoot,
    resolverGit: createReadOnlyResolverGit()
  });
  if (treeSha !== input.expectedTreeSha) {
    throw new Error(`${input.label} tree changed; preserving the current Git index.`);
  }
}

async function publishIndexCas(input: {
  gitDirectory: string;
  indexPath: string;
  lockPath: string;
  pre: Buffer;
  next: Buffer;
  operationId: string;
  faultAfterLockWrite?: () => void;
  faultAfterPreQuarantine?: () => void;
  faultAfterNextInstall?: () => void;
  durability: FreezeDurabilityOptions;
}): Promise<void> {
  await publishEntryNoReplaceCas({
    boundaryRoot: input.gitDirectory,
    artifactRoot: input.gitDirectory,
    targetPath: input.indexPath,
    targetKey: 'git-index',
    nextPath: input.lockPath,
    pre: input.pre,
    next: input.next,
    label: 'Git index',
    operationId: input.operationId,
    faultAfterNextPrepared: input.faultAfterLockWrite,
    faultAfterPreQuarantine: input.faultAfterPreQuarantine,
    faultAfterNextInstall: input.faultAfterNextInstall,
    durability: input.durability
  });
}

async function buildNextIndex(input: {
  repositoryRoot: string;
  gitDirectory: string;
  indexPath: string;
  targets: readonly Readonly<{ path: string; pre: Buffer | undefined; bytes: Buffer }>[];
  absentPaths: readonly string[];
}): Promise<Readonly<{ bytes: Buffer; treeSha: string }>> {
  const scratchRoot = await mkdtemp(path.join(tmpdir(), 'sec-document-control-freeze-index-'));
  let productionScratch: GitScratchIndexTreeSession | null = null;
  let primaryFailure: Readonly<{ error: unknown }> | undefined;
  try {
    try {
      const canonicalScratchRoot = await realpath(scratchRoot);
      const canonicalRepositoryRoot = await realpath(input.repositoryRoot);
      const canonicalGitDirectory = await realpath(input.gitDirectory);
      if (pathComparisonValue(canonicalScratchRoot).startsWith(`${pathComparisonValue(canonicalRepositoryRoot)}${path.sep}`)
          || pathComparisonValue(canonicalScratchRoot).startsWith(`${pathComparisonValue(canonicalGitDirectory)}${path.sep}`)) {
        throw new Error('External freeze scratch index root must not be contained by the repository or Git directory.');
      }
      const sourceIndex = await readSafeRegularFile({
        boundaryRoot: input.gitDirectory,
        filePath: input.indexPath,
        label: 'Git index source'
      });
      const scratchIndex = path.join(canonicalScratchRoot, 'index');
      const scratchObjects = path.join(canonicalScratchRoot, 'objects');
      await mkdir(scratchObjects);
      const repositoryObjectsCandidate = requireCommand(
        await run('git', ['rev-parse', '--git-path', 'objects'], input.repositoryRoot),
        'Repository object directory path'
      );
      const repositoryObjects = await realpath(path.isAbsolute(repositoryObjectsCandidate)
        ? repositoryObjectsCandidate
        : path.resolve(input.repositoryRoot, repositoryObjectsCandidate));
      await createSafeRegularFileExclusive({
        boundaryRoot: canonicalScratchRoot,
        filePath: scratchIndex,
        bytes: sourceIndex,
        label: 'External freeze scratch Git index',
        durability: {}
      });
      const environment = {
        GIT_INDEX_FILE: scratchIndex,
        GIT_OBJECT_DIRECTORY: scratchObjects,
        GIT_ALTERNATE_OBJECT_DIRECTORIES: repositoryObjects,
        GIT_OPTIONAL_LOCKS: '0'
      };
      const changedTargets = input.targets.filter(
        (target) => target.pre === undefined || !target.pre.equals(target.bytes)
      );
      const productionSession = documentControlGitReadScope.getStore();
      const testTransport = documentControlHostCliTestScope.getStore() === documentControlHostCliTestIssuer;
      if (!testTransport) {
        if (productionSession === undefined) {
          throw documentControlCliFailure(
            'git', 'git-object-index-effect', 'unknown', 'semantic-closure-unproven'
          );
        }
        const resolution = await createAuthorityGitScratchIndexTreeSession({
          gitReadSession: productionSession,
          scratchRoot: canonicalScratchRoot
        });
        if (resolution.status !== 'ready') {
          throw documentControlCliFailure(
            'git', 'git-object-index-effect', 'unavailable', resolution.reason
          );
        }
        productionScratch = resolution.session;
        const tree = await productionScratch.applyIndexDelta({
          additions: changedTargets.map((target) => Object.freeze({
            path: target.path,
            bytes: target.bytes
          })),
          removals: Object.freeze([...input.absentPaths])
        });
        if (tree.status !== 'ready') {
          throw documentControlCliFailure(
            'git', 'git-object-index-effect', 'unavailable', tree.reason
          );
        }
        const treeSha = shaValue(tree.value, 'Candidate tree');
        for (const target of input.targets) {
          const observed = await productionScratch.observe(['show', `${treeSha}:${target.path}`]);
          if (observed.status !== 'ready') {
            throw documentControlCliFailure(
              'git', 'git-object-index-effect', 'unavailable', observed.reason
            );
          }
          if (observed.value.code !== 0) {
            throw new Error(`Candidate ${target.path} is absent from the scratch tree.`);
          }
          const treeBytes = Buffer.from(observed.value.stdout);
          if (!treeBytes.equals(target.bytes)) {
            throw new Error(`Candidate tree bytes drifted for ${target.path}.`);
          }
        }
        for (const absentPath of input.absentPaths) {
          const observed = await productionScratch.observe(['show', `${treeSha}:${absentPath}`]);
          if (observed.status !== 'ready') {
            throw documentControlCliFailure(
              'git', 'git-object-index-effect', 'unavailable', observed.reason
            );
          }
          if (observed.value.code === 0) {
            throw new Error(`Candidate tree retained the retired path ${absentPath}.`);
          }
        }
        const bytes = await readSafeRegularFile({
          boundaryRoot: canonicalScratchRoot,
          filePath: scratchIndex,
          label: 'External freeze scratch Git index readback'
        });
        return Object.freeze({ bytes, treeSha });
      }
      const indexUpdates: string[] = [];
      for (const target of changedTargets) {
        const blobSha = requireCommand(
          await run('git', ['hash-object', '-w', '--stdin'], input.repositoryRoot, {
            environment,
            input: target.bytes
          }),
          `Scratch Git blob materialization for ${target.path}`
        );
        indexUpdates.push(`100644 ${blobSha}\t${target.path}\0`);
      }
      if (indexUpdates.length > 0) {
        requireCommand(await run(
          'git',
          ['update-index', '-z', '--index-info'],
          input.repositoryRoot,
          { environment, input: Buffer.from(indexUpdates.join(''), 'utf8') }
        ), 'Batched temporary Git index update');
      }
      if (input.absentPaths.length > 0) {
        requireCommand(await run(
          'git',
          ['update-index', '--remove', '-z', '--stdin'],
          input.repositoryRoot,
          { environment, input: Buffer.from(`${input.absentPaths.join('\0')}\0`, 'utf8') }
        ), 'Batched temporary Git index removal');
      }
      const treeSha = shaValue(
        requireCommand(
          await run('git', ['write-tree'], input.repositoryRoot, { environment }),
          'Candidate tree write'
        ),
        'Candidate tree'
      );
      for (const target of input.targets) {
        const treeBytes = await readGitBlob(input.repositoryRoot, `${treeSha}:${target.path}`, environment);
        if (treeBytes === undefined) throw new Error(`Candidate ${target.path} is absent from the scratch tree.`);
        if (!treeBytes.equals(target.bytes)) throw new Error(`Candidate tree bytes drifted for ${target.path}.`);
      }
      for (const absentPath of input.absentPaths) {
        if (await readGitBlob(input.repositoryRoot, `${treeSha}:${absentPath}`, environment) !== undefined) {
          throw new Error(`Candidate tree retained the retired path ${absentPath}.`);
        }
      }
      const bytes = await readSafeRegularFile({
        boundaryRoot: canonicalScratchRoot,
        filePath: scratchIndex,
        label: 'External freeze scratch Git index readback'
      });
      return Object.freeze({ bytes, treeSha });
    } catch (error) {
      primaryFailure = Object.freeze({ error });
      throw error;
    } finally {
      let closeFailure: Readonly<{ error: unknown }> | undefined;
      try {
        const reason = await productionScratch?.close();
        if (reason !== null && reason !== undefined) {
          closeFailure = Object.freeze({
            error: documentControlCliFailure(
              'git', 'git-object-index-effect', 'unavailable', reason
            )
          });
        }
      } catch (error) {
        closeFailure = Object.freeze({ error });
      }
      if (primaryFailure !== undefined && closeFailure !== undefined) {
        throw new AggregateError(
          [primaryFailure.error, closeFailure.error],
          'Freeze scratch index construction and session close both failed.'
        );
      }
      if (closeFailure !== undefined) throw closeFailure.error;
    }
  } catch (error) {
    const operationFailure = Object.freeze({ error });
    let cleanupFailure: Readonly<{ error: unknown }> | undefined;
    try {
      await rm(scratchRoot, { recursive: true, force: true });
      const removed = await lstat(scratchRoot).then(
        () => false,
        (removeError: unknown) => (removeError as NodeJS.ErrnoException).code === 'ENOENT'
      );
      if (!removed) throw new Error('External freeze scratch Git index root remained after cleanup.');
    } catch (removeError) {
      cleanupFailure = Object.freeze({ error: removeError });
    }
    if (cleanupFailure !== undefined) {
      throw new AggregateError(
        [operationFailure.error, cleanupFailure.error],
        'Freeze scratch index construction and root cleanup both failed.'
      );
    }
    throw operationFailure.error;
  }
  await rm(scratchRoot, { recursive: true, force: true });
  const removed = await lstat(scratchRoot).then(
    () => false,
    (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
  if (!removed) throw new Error('External freeze scratch Git index root remained after cleanup.');
}

async function materializeFreezeCandidateObjects(input: Readonly<{
  repositoryRoot: string;
  gitDirectory: string;
  journal: FreezeJournal;
}>): Promise<void> {
  const scratchRoot = await mkdtemp(path.join(tmpdir(), 'sec-document-control-materialize-index-'));
  let productionScratch: GitScratchIndexTreeSession | null = null;
  let primaryFailure: Readonly<{ error: unknown }> | undefined;
  try {
    const canonicalScratchRoot = await realpath(scratchRoot);
    const canonicalRepositoryRoot = await realpath(input.repositoryRoot);
    const canonicalGitDirectory = await realpath(input.gitDirectory);
    if (pathComparisonValue(canonicalScratchRoot).startsWith(`${pathComparisonValue(canonicalRepositoryRoot)}${path.sep}`)
        || pathComparisonValue(canonicalScratchRoot).startsWith(`${pathComparisonValue(canonicalGitDirectory)}${path.sep}`)) {
      throw new Error('Freeze object materialization scratch root must remain outside the repository and Git directory.');
    }
    const scratchIndex = path.join(canonicalScratchRoot, 'index');
    await createSafeRegularFileExclusive({
      boundaryRoot: canonicalScratchRoot,
      filePath: scratchIndex,
      bytes: fromBase64(input.journal.index.next, 'Freeze journal index NEXT object materialization'),
      label: 'Freeze object materialization scratch Git index',
      durability: {}
    });
    await mkdir(path.join(canonicalScratchRoot, 'objects'));
    const environment = {
      GIT_INDEX_FILE: scratchIndex,
      GIT_OPTIONAL_LOCKS: '0'
    };
    const nextFiles = [
      [input.journal.manifestPath, input.journal.files.manifest.next],
      [ActivePointerPath, input.journal.files.pointer.next],
      [RollingPlanPath, input.journal.files.rollingPlan.next]
    ] as const;
    const testTransport = documentControlHostCliTestScope.getStore() === documentControlHostCliTestIssuer;
    const productionSession = documentControlGitReadScope.getStore();
    if (!testTransport) {
      if (productionSession === undefined) {
        throw documentControlCliFailure(
          'git', 'git-object-index-effect', 'unknown', 'semantic-closure-unproven'
        );
      }
      const resolution = await createAuthorityGitScratchIndexTreeSession({
        gitReadSession: productionSession,
        scratchRoot: canonicalScratchRoot
      });
      if (resolution.status !== 'ready') {
        throw documentControlCliFailure(
          'git', 'git-object-index-effect', 'unavailable', resolution.reason
        );
      }
      productionScratch = resolution.session;
      const materialized = await productionScratch.materializeIndexDelta({
        additions: nextFiles.map(([repositoryPath, encodedBytes]) => Object.freeze({
          path: repositoryPath,
          bytes: fromBase64(encodedBytes, `Freeze ${repositoryPath} NEXT object materialization`)
        })),
        removals: Object.freeze([])
      });
      if (materialized.status !== 'ready') {
        throw documentControlCliFailure(
          'git', 'git-object-index-effect', 'unavailable', materialized.reason
        );
      }
      const materializedTreeSha = shaValue(materialized.value, 'Freeze materialized candidate tree');
      if (materializedTreeSha !== input.journal.candidateTreeSha) {
        throw new Error('Materialized freeze candidate tree does not equal the journal candidate tree.');
      }
      for (const [repositoryPath, encodedBytes] of nextFiles) {
        const expected = fromBase64(encodedBytes, `Freeze ${repositoryPath} NEXT object readback`);
        const actual = await readGitBlob(input.repositoryRoot, `${materializedTreeSha}:${repositoryPath}`);
        if (actual === undefined || !actual.equals(expected)) {
          throw new Error(`Materialized freeze candidate ${repositoryPath} does not equal the journal NEXT image.`);
        }
      }
      const retiredManifestPath = await freezeRetiredManifestPath(input.repositoryRoot, input.journal);
      if (retiredManifestPath !== null
          && await readGitBlob(input.repositoryRoot, `${materializedTreeSha}:${retiredManifestPath}`) !== undefined) {
        throw new Error('Materialized freeze candidate retained the prior pointer manifest.');
      }
      return;
    }
    const indexUpdates: string[] = [];
    for (const [repositoryPath, encodedBytes] of nextFiles) {
      const blobSha = requireCommand(await run('git', ['hash-object', '-w', '--stdin'], input.repositoryRoot, {
        input: fromBase64(encodedBytes, `Freeze ${repositoryPath} NEXT object materialization`)
      }), `Freeze ${repositoryPath} object materialization`);
      indexUpdates.push(`100644 ${blobSha}\t${repositoryPath}\0`);
    }
    requireCommand(await run(
      'git',
      ['update-index', '-z', '--index-info'],
      input.repositoryRoot,
      { environment, input: Buffer.from(indexUpdates.join(''), 'utf8') }
    ), 'Freeze object materialization scratch index refresh');
    const materializedTreeSha = shaValue(requireCommand(
      await run('git', ['write-tree'], input.repositoryRoot, { environment }),
      'Freeze candidate tree object materialization'
    ), 'Freeze materialized candidate tree');
    if (materializedTreeSha !== input.journal.candidateTreeSha) {
      throw new Error('Materialized freeze candidate tree does not equal the journal candidate tree.');
    }
    for (const [repositoryPath, encodedBytes] of nextFiles) {
      const expected = fromBase64(encodedBytes, `Freeze ${repositoryPath} NEXT object readback`);
      const actual = await readGitBlob(input.repositoryRoot, `${materializedTreeSha}:${repositoryPath}`);
      if (actual === undefined || !actual.equals(expected)) {
        throw new Error(`Materialized freeze candidate ${repositoryPath} does not equal the journal NEXT image.`);
      }
    }
    const retiredManifestPath = await freezeRetiredManifestPath(input.repositoryRoot, input.journal);
    if (retiredManifestPath !== null
        && await readGitBlob(input.repositoryRoot, `${materializedTreeSha}:${retiredManifestPath}`) !== undefined) {
      throw new Error('Materialized freeze candidate retained the prior pointer manifest.');
    }
  } catch (error) {
    primaryFailure = Object.freeze({ error });
    throw error;
  } finally {
    const settlementFailures: unknown[] = [];
    try {
      const reason = await productionScratch?.close();
      if (reason !== null && reason !== undefined) {
        settlementFailures.push(documentControlCliFailure(
          'git', 'git-object-index-effect', 'unavailable', reason
        ));
      }
    } catch (error) {
      settlementFailures.push(error);
    }
    try {
      await rm(scratchRoot, { recursive: true, force: true });
      const removed = await lstat(scratchRoot).then(
        () => false,
        (removeError: unknown) => (removeError as NodeJS.ErrnoException).code === 'ENOENT'
      );
      if (!removed) throw new Error('Freeze object materialization scratch root remained after cleanup.');
    } catch (error) {
      settlementFailures.push(error);
    }
    if (primaryFailure !== undefined) settlementFailures.unshift(primaryFailure.error);
    if (settlementFailures.length === 1) throw settlementFailures[0];
    if (settlementFailures.length > 1) {
      throw new AggregateError(
        settlementFailures,
        'Freeze object materialization and scratch closeout had multiple failures.'
      );
    }
  }
}

function assertCanonicalManifestPath(manifestPath: string): void {
  if (!/^config\/repository\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(manifestPath)) {
    throw new Error('freeze --manifest must be one canonical Work Package manifest path.');
  }
}

function assertReviewedOn(reviewedOn: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(reviewedOn)) {
    throw new Error('freeze --reviewed-on must be an ISO calendar date.');
  }
  const date = new Date(`${reviewedOn}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== reviewedOn) {
    throw new Error('freeze --reviewed-on must be a real ISO calendar date.');
  }
}

function assertNoUnrelatedStagedChanges(
  stagedPaths: readonly string[],
  targets: ReadonlySet<string>
): void {
  const unrelated = stagedPaths.filter((candidate) => !targets.has(candidate));
  if (unrelated.length > 0) {
    throw new Error(`Document control freeze rejects unrelated staged paths: ${unrelated.join(', ')}.`);
  }
}

async function assertCommittedCandidateReplanAuthority(input: {
  repositoryRoot: string;
  headSha: string;
  trustedDefaultSha: string;
  trustedDefaultTree: string;
  manifestPath: string;
}): Promise<CommittedCandidateReplanAuthority> {
  const ancestry = requireCommand(
    await run('git', ['rev-list', '--parents', '-n', '1', input.headSha], input.repositoryRoot),
    'Committed candidate ancestry'
  ).split(/\s+/u);
  if (ancestry.length !== 2 || ancestry[0] !== input.headSha || ancestry[1] !== input.trustedDefaultSha) {
    throw new Error(
      'Committed candidate replan requires one exact candidate generation whose sole parent is the live default.'
    );
  }
  const candidateState = await requireGitBlob(
    input.repositoryRoot,
    `${input.headSha}:${CurrentStatePath}`,
    'Committed candidate current-state authority'
  );
  const trustedState = await requireGitBlob(
    input.repositoryRoot,
    `${input.trustedDefaultSha}:${CurrentStatePath}`,
    'Live-default current-state authority'
  );
  if (!candidateState.equals(trustedState)) {
    throw new Error('Committed candidate replan must preserve the exact live-default current-state authority bytes.');
  }
  const spec = ParseCurrentStateSpec(
    decodeUtf8(candidateState, 'Committed candidate current-state')
  );
  const pointerBytes = await requireGitBlob(
    input.repositoryRoot,
    `${input.headSha}:${ActivePointerPath}`,
    'Committed candidate active pointer'
  );
  const pointerSource = decodeUtf8(pointerBytes, 'Committed candidate active pointer');
  const pointer = ParseActivePointer(pointerSource);
  AssertControlPlaneBinding({ spec, pointer });
  const rollingBytes = await requireGitBlob(
    input.repositoryRoot,
    `${input.headSha}:${RollingPlanPath}`,
    'Committed candidate rolling plan'
  );
  const rollingSource = decodeUtf8(rollingBytes, 'Committed candidate rolling plan');
  const rolling = ParseRollingPlanHeadings(rollingSource);
  const rollingMachine = ParseRollingMachineProjection(rollingSource);
  const manifestBytes = await requireGitBlob(
    input.repositoryRoot,
    `${input.headSha}:${input.manifestPath}`,
    'Committed candidate Work Package manifest'
  );
  const manifest = ParseCurrentWorkPackageManifest(
    decodeUtf8(manifestBytes, 'Committed candidate Work Package manifest'),
    input.manifestPath
  );
  if (pointer.manifest !== input.manifestPath
      || rolling.activePackageId !== manifest.id
      || manifest.base !== input.trustedDefaultSha) {
    throw new Error(
      'Committed candidate replan requires the exact active pointer, rolling plan, manifest path, and base binding.'
    );
  }
  if (ResolveWorkSelectionProjectionMode(spec) === 'required'
      && rollingMachine === null) {
    throw new Error('Committed candidate replan requires the prior machine projection identity.');
  }
  // A candidate is required to be a direct child of the live default.  When
  // it carries the exact projection bytes from that parent, the parent is the
  // publication authority; do not walk from an old base and mistake the first
  // unrelated descendant commit for the projection publication.  Historical
  // candidates that intentionally carry older bytes still take the bounded
  // ancestry path below.
  const liveDefaultRollingBytes = await requireGitBlob(
    input.repositoryRoot,
    `${input.trustedDefaultSha}:${RollingPlanPath}`,
    'Live-default rolling projection'
  );
  const rollingMatchesLiveDefault = liveDefaultRollingBytes.equals(rollingBytes);
  if (rollingMachine !== null) {
    if (rollingMachine.exactMain === input.trustedDefaultSha) {
      AssertRollingMachineBaseBinding({
        projection: rollingMachine,
        exactMain: input.trustedDefaultSha,
        exactMainTree: input.trustedDefaultTree
      });
    } else {
      if (rollingMachine.schema !== 'sec-work-rolling-transition-projection-v1'
          || rollingMachine.authority.kind !== 'committed-candidate-replan') {
        throw new Error(
          'Committed candidate replan can repair only one fully bound historical committed-candidate projection.'
        );
      }
      const historicalBaseTree = shaValue(requireCommand(
        await run('git', ['rev-parse', `${rollingMachine.exactMain}^{tree}`], input.repositoryRoot),
        'Historical rolling base tree'
      ), 'Historical rolling base tree');
      if (historicalBaseTree !== rollingMachine.exactMainTree) {
        throw new Error('Historical rolling projection tree does not bind its exact recorded base revision.');
      }
      const historicalBaseAncestry = await run(
        'git',
        ['merge-base', '--is-ancestor', rollingMachine.exactMain, input.trustedDefaultSha],
        input.repositoryRoot
      );
      if (historicalBaseAncestry.code !== 0) {
        throw new Error('Historical rolling projection base is not an ancestor of the live default.');
      }
      if (!rollingMatchesLiveDefault) {
        const publicationChain = requireCommand(
          await run('git', [
            'rev-list',
            '--first-parent',
            '--ancestry-path',
            '--reverse',
            `${rollingMachine.exactMain}..${input.trustedDefaultSha}`
          ], input.repositoryRoot),
          'Published rolling projection ancestry'
        ).split(/\s+/u);
        const publicationCommit = publicationChain[0];
        if (publicationCommit === undefined) {
          throw new Error('Historical rolling projection has no published live-default generation.');
        }
        const publicationAncestry = requireCommand(
          await run('git', ['rev-list', '--parents', '-n', '1', publicationCommit], input.repositoryRoot),
          'Published rolling projection commit ancestry'
        ).split(/\s+/u);
        if (publicationAncestry.length !== 2
            || publicationAncestry[0] !== publicationCommit
            || publicationAncestry[1] !== rollingMachine.exactMain) {
          throw new Error(
            'Published rolling projection must be the sole-parent first live-default generation after its exact base.'
          );
        }
        const publishedRollingBytes = await requireGitBlob(
          input.repositoryRoot,
          `${publicationCommit}:${RollingPlanPath}`,
          'Published rolling projection bytes'
        );
        if (!publishedRollingBytes.equals(rollingBytes)) {
          throw new Error('Candidate rolling bytes do not equal the exact published live-default projection.');
        }
        const publishedPointerSource = decodeUtf8(await requireGitBlob(
          input.repositoryRoot,
          `${publicationCommit}:${ActivePointerPath}`,
          'Published rolling projection pointer'
        ), 'Published rolling projection pointer');
        const publishedPointer = ParseActivePointer(publishedPointerSource);
        const publishedManifestBytes = await requireGitBlob(
          input.repositoryRoot,
          `${publicationCommit}:${input.manifestPath}`,
          'Published rolling projection manifest'
        );
        const publishedManifest = ParseCurrentWorkPackageManifest(
          decodeUtf8(publishedManifestBytes, 'Published rolling projection manifest'),
          input.manifestPath
        );
        const publishedManifestDigest = WorkPackageManifestDigest(publishedManifestBytes);
        if (publishedPointer.manifest !== input.manifestPath
            || publishedPointer.manifestDigest !== publishedManifestDigest
            || rollingMachine.active.manifestDigest !== publishedManifestDigest
            || publishedManifest.id !== rollingMachine.active.packageId
            || publishedManifest.tracking !== rollingMachine.active.tracking) {
          throw new Error('Historical rolling authority does not bind the exact published control generation.');
        }
      }
      const sourceAuthority = rollingMachine.authority;
      const sourceAncestry = requireCommand(
        await run('git', ['rev-list', '--parents', '-n', '1', sourceAuthority.sourceHead], input.repositoryRoot),
        'Historical committed-candidate source ancestry'
      ).split(/\s+/u);
      if (sourceAncestry.length !== 2
          || sourceAncestry[0] !== sourceAuthority.sourceHead
          || sourceAncestry[1] !== rollingMachine.exactMain) {
        throw new Error(
          'Historical committed-candidate source must have the recorded rolling base as its sole parent.'
        );
      }
      const sourceTree = shaValue(requireCommand(
        await run('git', ['rev-parse', `${sourceAuthority.sourceHead}^{tree}`], input.repositoryRoot),
        'Historical committed-candidate source tree'
      ), 'Historical committed-candidate source tree');
      if (sourceTree !== sourceAuthority.sourceTree) {
        throw new Error('Historical committed-candidate source tree does not match its recorded authority.');
      }
      const sourceManifestBytes = await requireGitBlob(
        input.repositoryRoot,
        `${sourceAuthority.sourceHead}:${input.manifestPath}`,
        'Historical committed-candidate source manifest'
      );
      const sourceManifestDigest = WorkPackageManifestDigest(sourceManifestBytes);
      if (sourceManifestDigest !== sourceAuthority.sourceManifestDigest) {
        throw new Error('Historical committed-candidate manifest does not bind its recorded source digest.');
      }
      const sourcePointer = decodeUtf8(await requireGitBlob(
        input.repositoryRoot,
        `${sourceAuthority.sourceHead}:${ActivePointerPath}`,
        'Historical committed-candidate source pointer'
      ), 'Historical committed-candidate source pointer');
      const sourceRolling = decodeUtf8(await requireGitBlob(
        input.repositoryRoot,
        `${sourceAuthority.sourceHead}:${RollingPlanPath}`,
        'Historical committed-candidate source rolling plan'
      ), 'Historical committed-candidate source rolling plan');
      if (rawSha256(sourcePointer) !== sourceAuthority.sourcePointerRevision
          || rawSha256(sourceRolling) !== sourceAuthority.sourceRollingRevision) {
        throw new Error('Historical committed-candidate control bytes do not match their recorded authority.');
      }
      const parsedSourcePointer = ParseActivePointer(sourcePointer);
      if (parsedSourcePointer.manifest !== input.manifestPath
          || parsedSourcePointer.manifestDigest !== sourceManifestDigest) {
        throw new Error('Historical committed-candidate source does not bind its exact manifest.');
      }
    }
    if (rollingMachine.active.packageId !== manifest.id
        || rollingMachine.active.tracking !== manifest.tracking
        || (rollingMachine.schema === 'sec-work-rolling-transition-projection-v1'
          && rollingMachine.active.manifestPath !== input.manifestPath)) {
      throw new Error('Committed candidate replan cannot replace package, tracking, or manifest identity.');
    }
  }
  const defaultManifestBlob = await readGitBlob(
    input.repositoryRoot,
    `${input.trustedDefaultSha}:${input.manifestPath}`
  );
  if (defaultManifestBlob !== undefined) {
    const defaultManifestDigest = WorkPackageManifestDigest(defaultManifestBlob);
    const pointerBindsDefault = defaultManifestDigest === pointer.manifestDigest;
    const pointerBindsRolling = rollingMachine?.schema === 'sec-work-rolling-transition-projection-v1'
      && rollingMachine.active.manifestDigest === pointer.manifestDigest;
    const binding = ClassifyPublishedControlBinding({
      authorityProven: true,
      historicalBaseIsLiveDefault: rollingMachine?.exactMain === input.trustedDefaultSha,
      pointerBindsDefault,
      pointerBindsHistoricalRolling: pointerBindsRolling,
      publishedTargetPresent: true,
      rollingTransition: rollingMachine?.schema === 'sec-work-rolling-transition-projection-v1'
    });
    if (binding.kind !== 'repairable') {
      throw new Error(
        `Published projection drift repair is blocked: ${binding.kind === 'blocked' ? binding.reason : 'absent'}.`
      );
    }
    const defaultManifest = ParseCurrentWorkPackageManifest(
      decodeUtf8(defaultManifestBlob, 'Live-default drifted Work Package manifest'),
      input.manifestPath
    );
    if (defaultManifest.id !== manifest.id || defaultManifest.tracking !== manifest.tracking) {
      throw new Error('Published Work Package drift repair cannot replace package or tracking identity.');
    }
  }
  const sourceTree = shaValue(
    requireCommand(
      await run('git', ['rev-parse', `${input.headSha}^{tree}`], input.repositoryRoot),
      'Committed candidate tree'
    ),
    'Committed candidate tree'
  );
  return Object.freeze({
    kind: 'committed-candidate-replan',
    sourceHead: input.headSha,
    sourceTree,
    sourceManifestDigest: WorkPackageManifestDigest(
      manifestBytes
    ) as `sha256:${string}`,
    sourcePointerRevision: rawSha256(pointerSource),
    sourceRollingRevision: rawSha256(rollingSource)
  });
}

async function assertInitialFreezeObservationFence(input: {
  repositoryRoot: string;
  defaultRef: string;
  headSha: string;
  localDefaultSha: string;
  indexPaths: GitIndexPaths;
  indexSnapshot: AnchoredIndexSnapshot;
  expectedIndexTreeSha: string;
  allowSemanticIndexDrift: boolean;
  worktreeFiles: readonly Readonly<{
    filePath: string;
    expectedBytes: Buffer;
    label: string;
  }>[];
  absentWorktreePaths?: readonly string[];
}): Promise<void> {
  const headReadback = shaValue(
    requireCommand(
      await run('git', ['rev-parse', 'HEAD'], input.repositoryRoot),
      'Pre-journal candidate HEAD readback'
    ),
    'Pre-journal candidate HEAD readback'
  );
  const localDefaultReadback = shaValue(
    requireCommand(
      await run('git', ['rev-parse', '--verify', input.defaultRef], input.repositoryRoot),
      'Pre-journal local default readback'
    ),
    'Pre-journal local default readback'
  );
  const indexReadback = await readAnchoredIndexSnapshot({
    boundaryRoot: input.indexPaths.gitDirectory,
    filePath: input.indexPaths.indexPath,
    label: 'Pre-journal Git index readback'
  });
  let indexStable = indexReadback.identity === input.indexSnapshot.identity
    && indexReadback.bytes.equals(input.indexSnapshot.bytes);
  let semanticIndexTreeReadback: string | null = null;
  if (!indexStable && input.allowSemanticIndexDrift) {
    const semanticReadback = await captureRepositoryIndexTreeThroughExternalScratch({
      repositoryRoot: input.repositoryRoot,
      resolverGit: createReadOnlyResolverGit()
    });
    semanticIndexTreeReadback = semanticReadback.treeSha;
    indexStable = semanticReadback.treeSha === input.expectedIndexTreeSha;
  }
  const worktreeStable = (await Promise.all(input.worktreeFiles.map(async (file) => (
    (await readSafeRegularFile({
      boundaryRoot: input.repositoryRoot,
      filePath: file.filePath,
      label: `Pre-journal ${file.label} readback`
    })).equals(file.expectedBytes)
  )))).every(Boolean);
  const absentWorktreeStable = (await Promise.all((input.absentWorktreePaths ?? []).map(
    async (repositoryPath) => (await inspectSafePath({
      boundaryRoot: input.repositoryRoot,
      candidatePath: path.join(input.repositoryRoot, ...repositoryPath.split('/')),
      label: `Pre-journal retired manifest ${repositoryPath}`,
      finalKind: 'file',
      allowMissing: true
    })) === null
  ))).every(Boolean);
  const changedInputs = [
    headReadback === input.headSha ? null : 'head',
    localDefaultReadback === input.localDefaultSha ? null : 'local-default',
    indexStable
      ? null
      : semanticIndexTreeReadback === null
        ? 'index'
        : `index-tree:${input.expectedIndexTreeSha}->${semanticIndexTreeReadback}`,
    worktreeStable ? null : 'worktree',
    absentWorktreeStable ? null : 'retired-manifest'
  ].filter((entry): entry is string => entry !== null);
  if (changedInputs.length > 0) {
    throw new Error(
      `Document control freeze inputs changed before initial journal publication: ${changedInputs.join(',')}.`
    );
  }
}

async function freezeRetiredManifestPath(
  repositoryRoot: string,
  journal: FreezeJournal
): Promise<string | null> {
  const basePointer = ParseActivePointer(decodeUtf8(await requireGitBlob(
    repositoryRoot,
    `${journal.baseSha}:${ActivePointerPath}`,
    'Freeze base active pointer'
  ), 'Freeze base active pointer'));
  const nextPointer = ParseActivePointer(decodeUtf8(fromBase64(
    journal.files.pointer.next,
    'Freeze pointer NEXT retirement binding'
  ), 'Freeze pointer NEXT retirement binding'));
  return basePointer.manifest === nextPointer.manifest ? null : basePointer.manifest;
}

async function assertFreezeRetiredManifestAbsent(input: Readonly<{
  repositoryRoot: string;
  repositoryPath: string;
  treeSha: string;
  label: string;
}>): Promise<void> {
  if (await readGitBlob(input.repositoryRoot, `${input.treeSha}:${input.repositoryPath}`) !== undefined) {
    throw new Error(`${input.label} remains in the candidate tree.`);
  }
  const remaining = await inspectSafePath({
    boundaryRoot: input.repositoryRoot,
    candidatePath: path.join(input.repositoryRoot, ...input.repositoryPath.split('/')),
    label: input.label,
    finalKind: 'file',
    allowMissing: true
  });
  if (remaining !== null) throw new Error(`${input.label} remains in the worktree.`);
}

function assertFreezeContinuationNativeCapacity(phase: string): void {
  if (documentControlHostCliTestScope.getStore() === documentControlHostCliTestIssuer) return;
  const capacity = documentControlGitReadScope.getStore()?.observeNativeResourceCapacity();
  if (capacity === undefined || capacity === null) {
    throw new Error(`Document control freeze ${phase} has no live native Git resource observation.`);
  }
  reportExecutionProgress({
    command: 'document-control-freeze',
    phase: 'native-capacity',
    state: 'running',
    detail: {
      operationPhase: phase,
      used: capacity.admitted,
      root: capacity.root,
      stdinWorker: capacity.stdinWorker,
      helper: capacity.helper,
      required: FreezeContinuationNativeResources,
      remaining: capacity.remaining
    }
  });
  if (capacity.remaining < FreezeContinuationNativeResources) {
    throw new Error(
      `Document control freeze native budget is insufficient before ${phase}: `
      + `used=${capacity.admitted}, root=${capacity.root}, stdinWorker=${capacity.stdinWorker}, `
      + `helper=${capacity.helper}, required=${FreezeContinuationNativeResources}, `
      + `remaining=${capacity.remaining}.`
    );
  }
}

async function advanceFreezeJournal(input: {
  repositoryRoot: string;
  journal: FreezeJournal;
  journalBytes: Buffer;
  faultAfter?: FreezeFault;
  durability: FreezeDurabilityOptions;
}): Promise<FreezeResult> {
  assertFreezeContinuationNativeCapacity(`journal-${input.journal.phase}`);
  let journal = input.journal;
  let journalBytes = input.journalBytes;
  const indexPaths = await resolveIndexPaths(input.repositoryRoot, true);
  const indexPre = fromBase64(journal.index.pre, 'Freeze journal index PRE');
  const indexNext = fromBase64(journal.index.next, 'Freeze journal index NEXT');
  if (journal.preIndexTreeSha === journal.candidateTreeSha) {
    await observeExecutionProgressPhase('document-control-freeze', 'index-noop-readback', () => assertIndexSemanticIdentity({
      repositoryRoot: input.repositoryRoot,
      indexPaths,
      expectedTreeSha: journal.candidateTreeSha,
      label: 'Freeze Git index semantic NOOP'
    }));
  } else {
    await observeExecutionProgressPhase('document-control-freeze', 'materialize-candidate-objects', () => materializeFreezeCandidateObjects({
      repositoryRoot: input.repositoryRoot,
      gitDirectory: indexPaths.gitDirectory,
      journal
    }));
    await observeExecutionProgressPhase('document-control-freeze', 'publish-index', () => publishIndexCas({
      ...indexPaths,
      pre: indexPre,
      next: indexNext,
      operationId: journal.operationId,
      faultAfterLockWrite: () => maybeFault(input.faultAfter, 'after-index-lock-write'),
      faultAfterPreQuarantine: () => maybeFault(input.faultAfter, 'after-index-pre-quarantine'),
      faultAfterNextInstall: () => maybeFault(input.faultAfter, 'after-index-next-install'),
      durability: input.durability
    }));
  }
  maybeFault(input.faultAfter, 'after-index-publish');
  if (journal.phase === 'prepared') {
    journal = Object.freeze({ ...journal, phase: 'index-published' });
    journalBytes = await writeFreezeJournal(
      input.repositoryRoot,
      journalBytes,
      journal,
      input.durability,
      input.faultAfter
    );
  }

  const manifestPath = await assertRegularRepositoryFile(input.repositoryRoot, journal.manifestPath);
  const manifestNext = fromBase64(journal.files.manifest.next, 'Freeze manifest NEXT');
  if (!(await readSafeRegularFile({
    boundaryRoot: input.repositoryRoot,
    filePath: manifestPath,
    label: 'Work Package manifest'
  })).equals(manifestNext)) {
    throw new Error('Work Package manifest bytes drifted after journal preparation.');
  }
  const pointerPath = await resolveRecoverableRepositoryFile(input.repositoryRoot, ActivePointerPath);
  await writeAtomicCas({
    repositoryRoot: input.repositoryRoot,
    filePath: pointerPath,
    targetKey: 'active-pointer',
    pre: fromBase64(journal.files.pointer.pre, 'Freeze pointer PRE'),
    next: fromBase64(journal.files.pointer.next, 'Freeze pointer NEXT'),
    label: 'Active pointer',
    operationId: journal.operationId,
    faultAfterTempWrite: () => maybeFault(input.faultAfter, 'after-pointer-temp-write'),
    faultAfterPreQuarantine: () => maybeFault(input.faultAfter, 'after-pointer-pre-quarantine'),
    faultAfterNextInstall: () => maybeFault(input.faultAfter, 'after-pointer-next-install'),
    durability: input.durability
  });
  maybeFault(input.faultAfter, 'after-pointer-publish');
  if (journal.phase === 'prepared' || journal.phase === 'index-published') {
    journal = Object.freeze({ ...journal, phase: 'pointer-published' });
    journalBytes = await writeFreezeJournal(
      input.repositoryRoot,
      journalBytes,
      journal,
      input.durability,
      input.faultAfter
    );
  }

  const rollingPlanPath = await resolveRecoverableRepositoryFile(input.repositoryRoot, RollingPlanPath);
  await writeAtomicCas({
    repositoryRoot: input.repositoryRoot,
    filePath: rollingPlanPath,
    targetKey: 'rolling-plan',
    pre: fromBase64(journal.files.rollingPlan.pre, 'Freeze rolling-plan PRE'),
    next: fromBase64(journal.files.rollingPlan.next, 'Freeze rolling-plan NEXT'),
    label: 'Rolling plan',
    operationId: journal.operationId,
    faultAfterTempWrite: () => maybeFault(input.faultAfter, 'after-rolling-temp-write'),
    faultAfterPreQuarantine: () => maybeFault(input.faultAfter, 'after-rolling-pre-quarantine'),
    faultAfterNextInstall: () => maybeFault(input.faultAfter, 'after-rolling-next-install'),
    durability: input.durability
  });
  maybeFault(input.faultAfter, 'after-rolling-publish');
  if (journal.phase !== 'rolling-published' && journal.phase !== 'terminal') {
    journal = Object.freeze({ ...journal, phase: 'rolling-published' });
    journalBytes = await writeFreezeJournal(
      input.repositoryRoot,
      journalBytes,
      journal,
      input.durability,
      input.faultAfter
    );
  }

  const readback = await observeExecutionProgressPhase('document-control-freeze', 'published-index-readback', () => captureControlIndexSnapshot(input.repositoryRoot, {
    targetManifestPath: journal.manifestPath
  }));
  if (readback.treeSha !== journal.candidateTreeSha) {
    throw new Error('Candidate index tree drifted before freeze terminal readback.');
  }
  const pointerBytes = fromBase64(journal.files.pointer.next, 'Freeze pointer NEXT');
  const rollingBytes = fromBase64(journal.files.rollingPlan.next, 'Freeze rolling-plan NEXT');
  if (readback.targetManifestBlob === undefined
      || !readback.targetManifestBlob.equals(manifestNext)
      || !readback.pointerBytes.equals(pointerBytes)
      || !readback.rollingPlanBytes.equals(rollingBytes)) {
    throw new Error('Candidate tree control bytes do not match the freeze NEXT images.');
  }
  const retiredManifestPath = await freezeRetiredManifestPath(input.repositoryRoot, journal);
  if (retiredManifestPath !== null) {
    await assertFreezeRetiredManifestAbsent({
      repositoryRoot: input.repositoryRoot,
      repositoryPath: retiredManifestPath,
      treeSha: readback.treeSha,
      label: 'Freeze successor retired manifest'
    });
  }
  const pointer = ParseActivePointer(decodeUtf8(pointerBytes, 'Freeze pointer NEXT'));
  const rolling = ParseRollingPlan(decodeUtf8(rollingBytes, 'Freeze rolling-plan NEXT'));
  AssertControlPlaneBinding({
    spec: ParseCurrentStateSpec(readback.stateSource),
    pointer
  });
  if (rolling.activePackageId !== path.posix.basename(pointer.manifest, '.md')
      || pointer.manifest !== journal.manifestPath
      || pointer.manifestDigest !== journal.manifestDigest) {
    throw new Error('Freeze terminal readback is not bound to one manifest/pointer/rolling-plan selection.');
  }
  if (journal.phase !== 'terminal') {
    journal = Object.freeze({ ...journal, phase: 'terminal' });
    journalBytes = await writeFreezeJournal(
      input.repositoryRoot,
      journalBytes,
      journal,
      input.durability,
      input.faultAfter
    );
  }
  maybeFault(input.faultAfter, 'after-terminal');
  const terminalSnapshot = await readFreezeJournalSnapshot(input.repositoryRoot);
  if (terminalSnapshot === null) throw new Error('Terminal freeze journal disappeared before retirement.');
  await observeExecutionProgressPhase('document-control-freeze', 'terminal-verification', () => verifyTerminalFreezeJournal({
    repositoryRoot: input.repositoryRoot,
    snapshot: terminalSnapshot,
    manifestPath: journal.manifestPath,
    manifestDigest: journal.manifestDigest,
    reviewedOn: journal.reviewedOn,
    retiredManifestPath
  }));
  await observeExecutionProgressPhase('document-control-freeze', 'journal-retirement', () => retireTerminalFreezeTransaction({
    repositoryRoot: input.repositoryRoot,
    snapshot: terminalSnapshot,
    durability: input.durability
  }));
  return journal.result;
}

async function verifyTerminalFreezeJournal(input: {
  repositoryRoot: string;
  snapshot: FreezeJournalSnapshot;
  manifestPath: string;
  manifestDigest: `sha256:${string}`;
  reviewedOn: string;
  retiredManifestPath?: string | null;
}): Promise<FreezeResult> {
  const journal = input.snapshot.journal;
  if (!input.snapshot.canonicalPresent || journal.phase !== 'terminal'
      || (input.snapshot.recovery !== null && input.snapshot.recovery.completionMode !== 'complete')) {
    throw new Error('Terminal freeze verification requires one complete canonical journal.');
  }
  if (journal.manifestPath !== input.manifestPath
      || journal.manifestDigest !== input.manifestDigest
      || journal.reviewedOn !== input.reviewedOn) {
    throw new Error('Terminal freeze journal does not match the exact requested authoring operation.');
  }

  const indexPaths = await resolveIndexPaths(input.repositoryRoot);
  await readSafeRegularFile({
    boundaryRoot: indexPaths.gitDirectory,
    filePath: indexPaths.indexPath,
    label: 'Terminal freeze Git index readback'
  });
  const lockBytes = await readOptionalSafeRegularFile({
    boundaryRoot: indexPaths.gitDirectory,
    filePath: indexPaths.lockPath,
    label: 'Terminal freeze Git index lock readback'
  });
  if (lockBytes !== null) {
    throw new Error('Terminal freeze verification found an active Git index lock; preserving it.');
  }

  const terminalGit = createReadOnlyResolverGit();
  const { treeSha } = await captureRepositoryIndexTreeThroughExternalScratch({
    repositoryRoot: input.repositoryRoot,
    resolverGit: terminalGit
  });
  if (treeSha !== journal.candidateTreeSha) {
    throw new Error('Terminal freeze Git index tree does not equal the journal candidate tree.');
  }
  const manifestNext = fromBase64(journal.files.manifest.next, 'Terminal freeze manifest NEXT');
  const pointerNext = fromBase64(journal.files.pointer.next, 'Terminal freeze pointer NEXT');
  const rollingNext = fromBase64(journal.files.rollingPlan.next, 'Terminal freeze rolling-plan NEXT');
  const requireTerminalTreeBlob = async (
    repositoryPath: string,
    expected: Buffer,
    label: string
  ): Promise<Buffer> => {
    const bytes = await terminalGit.readBlob(input.repositoryRoot, `${treeSha}:${repositoryPath}`);
    if (bytes === undefined || !bytes.equals(expected)) {
      throw new Error(`${label} does not equal the exact journal NEXT image in the terminal tree.`);
    }
    return bytes;
  };
  await requireTerminalTreeBlob(journal.manifestPath, manifestNext, 'Terminal freeze manifest');
  await requireTerminalTreeBlob(ActivePointerPath, pointerNext, 'Terminal freeze active pointer');
  await requireTerminalTreeBlob(RollingPlanPath, rollingNext, 'Terminal freeze rolling plan');
  const retiredManifestPath = input.retiredManifestPath === undefined
    ? await freezeRetiredManifestPath(input.repositoryRoot, journal)
    : input.retiredManifestPath;
  if (retiredManifestPath !== null) {
    await assertFreezeRetiredManifestAbsent({
      repositoryRoot: input.repositoryRoot,
      repositoryPath: retiredManifestPath,
      treeSha,
      label: 'Terminal freeze successor retired manifest'
    });
  }

  const manifestPath = await assertRegularRepositoryFile(input.repositoryRoot, journal.manifestPath);
  const pointerPath = await assertRegularRepositoryFile(input.repositoryRoot, ActivePointerPath);
  const rollingPlanPath = await assertRegularRepositoryFile(input.repositoryRoot, RollingPlanPath);
  const manifestWorktree = await readSafeRegularFile({
    boundaryRoot: input.repositoryRoot,
    filePath: manifestPath,
    label: 'Terminal freeze manifest worktree readback'
  });
  const pointerWorktree = await readSafeRegularFile({
    boundaryRoot: input.repositoryRoot,
    filePath: pointerPath,
    label: 'Terminal freeze pointer worktree readback'
  });
  const rollingWorktree = await readSafeRegularFile({
    boundaryRoot: input.repositoryRoot,
    filePath: rollingPlanPath,
    label: 'Terminal freeze rolling-plan worktree readback'
  });
  if (!manifestWorktree.equals(manifestNext)
      || !pointerWorktree.equals(pointerNext)
      || !rollingWorktree.equals(rollingNext)) {
    throw new Error('Terminal freeze worktree bytes do not equal all exact journal NEXT images.');
  }

  const stateSource = await terminalGit.readBlob(input.repositoryRoot, `${treeSha}:${CurrentStatePath}`);
  if (stateSource === undefined) throw new Error('Terminal freeze current-state spec is absent from the candidate tree.');
  const pointer = ParseActivePointer(decodeUtf8(pointerNext, 'Terminal freeze pointer NEXT'));
  const rolling = ParseRollingPlan(decodeUtf8(rollingNext, 'Terminal freeze rolling-plan NEXT'));
  AssertControlPlaneBinding({
    spec: ParseCurrentStateSpec(decodeUtf8(stateSource, 'Terminal freeze current-state spec')),
    pointer
  });
  if (rolling.activePackageId !== path.posix.basename(pointer.manifest, '.md')
      || pointer.manifest !== journal.manifestPath
      || pointer.manifestDigest !== journal.manifestDigest) {
    throw new Error('Terminal freeze selection is not bound to one manifest, pointer, and rolling plan.');
  }
  return journal.result;
}

function anchoredJournalEntryIdentity(entry: AnchoredJournalEntry): AnchoredObjectIdentity {
  return entry.physicalIdentity;
}

async function retireTerminalIndexRecovery(input: {
  repositoryRoot: string;
  journal: FreezeJournal;
  durability: FreezeDurabilityOptions;
}): Promise<void> {
  const indexPaths = await resolveIndexPaths(input.repositoryRoot);
  await assertIndexSemanticIdentity({
    repositoryRoot: input.repositoryRoot,
    indexPaths,
    expectedTreeSha: input.journal.candidateTreeSha,
    label: 'Terminal freeze Git index semantic readback'
  });
  const names = freezeEntryRecoveryNames({
    artifactRoot: indexPaths.gitDirectory,
    operationId: input.journal.operationId,
    targetKey: 'git-index'
  });
  const expected = new Map<string, Buffer>([
    [names.pre, fromBase64(input.journal.index.pre, 'Terminal index PRE retirement')],
    [names.retiredPre, fromBase64(input.journal.index.pre, 'Terminal index retired PRE retirement')],
    [names.retiredNext, fromBase64(input.journal.index.next, 'Terminal index retired NEXT retirement')]
  ]);
  const directRecoveryNames = scanDirectDirectoryNames(
    indexPaths.gitDirectory,
    'Terminal Git index recovery census'
  )
    .filter((name) => name.startsWith('.entry-'))
    .sort();
  const unknown = directRecoveryNames.find((name) => !expected.has(name));
  if (unknown !== undefined) {
    throw new Error(`Unbound Git index recovery residue is preserved: ${unknown}.`);
  }
  const observations = new Map<string, NonNullable<Awaited<ReturnType<typeof observeOptionalSafeRegularFile>>>>();
  for (const [name, bytes] of expected) {
    const observation = await observeOptionalSafeRegularFile({
      boundaryRoot: indexPaths.gitDirectory,
      filePath: path.join(indexPaths.gitDirectory, name),
      label: `Terminal Git index recovery ${name}`
    });
    if (observation === null) continue;
    if (!observation.bytes.equals(bytes)) {
      throw new Error(`Terminal Git index recovery residue has unknown bytes and is preserved: ${name}.`);
    }
    observations.set(name, observation);
  }
  const pre = observations.get(names.pre);
  const retiredPre = observations.get(names.retiredPre);
  if (pre !== undefined && retiredPre !== undefined
      && !sameAnchoredObjectIdentity(pre.identity, retiredPre.identity)) {
    throw new Error('Terminal Git index PRE recovery identity is unprovable; preserving both entries.');
  }
  for (const name of [names.retiredNext, names.retiredPre, names.pre]) {
    const observation = observations.get(name);
    if (observation === undefined) continue;
    await removeOptionalSafeRegularFile({
      boundaryRoot: indexPaths.gitDirectory,
      filePath: path.join(indexPaths.gitDirectory, name),
      label: `Terminal Git index recovery retirement ${name}`,
      expectedBytes: observation.bytes,
      expectedIdentity: observation.identity,
      durability: input.durability
    });
  }
  const remaining = scanDirectDirectoryNames(
    indexPaths.gitDirectory,
    'Terminal Git index remaining recovery census'
  ).filter((name) => name.startsWith('.entry-'));
  if (remaining.length > 0) {
    throw new Error(`Git index recovery residue remained after retirement: ${remaining.sort().join(', ')}.`);
  }
  if (process.platform === 'win32') {
    if (input.durability.parentDirectoryBarrier !== undefined) {
      await input.durability.parentDirectoryBarrier(indexPaths.gitDirectory);
    } else {
      await defaultParentDirectoryBarrier(indexPaths.gitDirectory);
    }
  }
  await assertIndexSemanticIdentity({
    repositoryRoot: input.repositoryRoot,
    indexPaths,
    expectedTreeSha: input.journal.candidateTreeSha,
    label: 'Terminal freeze Git index semantic retirement readback'
  });
}

async function retireTerminalFreezeTransaction(input: {
  repositoryRoot: string;
  snapshot: FreezeJournalSnapshot;
  durability: FreezeDurabilityOptions;
}): Promise<void> {
  const journal = input.snapshot.journal;
  if (!input.snapshot.canonicalPresent || journal.phase !== 'terminal'
      || (input.snapshot.recovery !== null && input.snapshot.recovery.completionMode !== 'complete')) {
    throw new Error('Only one complete terminal freeze journal can authorize recovery retirement.');
  }
  await retireTerminalIndexRecovery({
    repositoryRoot: input.repositoryRoot,
    journal,
    durability: input.durability
  });
  const transactionRoot = await canonicalDirectoryBoundary(
    path.join(input.repositoryRoot, path.dirname(FreezeJournalRelativePath)),
    'Terminal freeze transaction directory'
  );
  await assertTerminalRetirementPrefix({
    repositoryRoot: input.repositoryRoot,
    transactionRoot,
    journal,
    journalBytes: input.snapshot.bytes
  });
  const journalPath = path.join(transactionRoot, path.basename(FreezeJournalRelativePath));
  const directEntries = input.snapshot.durabilityEntries.filter(
    (entry) => pathComparisonValue(path.dirname(entry.filePath)) === pathComparisonValue(transactionRoot)
  );
  const canonical = directEntries.find((entry) => entry.name === 'journal.json');
  if (canonical === undefined || !canonical.bytes.equals(input.snapshot.bytes)) {
    throw new Error('Terminal freeze retirement lost its canonical journal authority.');
  }
  const recoveryEntries = directEntries
    .filter((entry) => entry.name !== 'journal.json')
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of recoveryEntries) {
    await removeOptionalSafeRegularFile({
      boundaryRoot: transactionRoot,
      filePath: entry.filePath,
      label: `Terminal freeze recovery retirement ${entry.name}`,
      expectedBytes: entry.bytes,
      expectedIdentity: anchoredJournalEntryIdentity(entry),
      durability: input.durability
    });
  }
  const journalOnly = await readFreezeJournalSnapshot(input.repositoryRoot);
  if (journalOnly === null || !journalOnly.canonicalPresent
      || journalOnly.journal.operationId !== journal.operationId
      || journalOnly.journal.phase !== 'terminal'
      || journalOnly.durabilityEntries.some((entry) => entry.name !== 'journal.json')) {
    throw new Error('Terminal freeze recovery census did not retire to the canonical journal only.');
  }
  if (process.platform === 'win32') {
    if (input.durability.parentDirectoryBarrier !== undefined) {
      await input.durability.parentDirectoryBarrier(transactionRoot);
    } else {
      await defaultParentDirectoryBarrier(transactionRoot);
    }
  }
  await removeOptionalSafeRegularFile({
    boundaryRoot: transactionRoot,
    filePath: journalPath,
    label: 'Terminal freeze canonical journal retirement',
    expectedBytes: journalOnly.bytes,
    expectedIdentity: anchoredJournalEntryIdentity(journalOnly.durabilityEntries[0]!),
    durability: input.durability
  });
  if (await readFreezeJournalSnapshot(input.repositoryRoot) !== null) {
    throw new Error('Terminal freeze journal remained after exact retirement.');
  }
  if (process.platform === 'win32') {
    if (input.durability.parentDirectoryBarrier !== undefined) {
      await input.durability.parentDirectoryBarrier(transactionRoot);
    } else {
      await defaultParentDirectoryBarrier(transactionRoot);
    }
  }
  await removeExactEmptyDirectory({
    boundaryRoot: input.repositoryRoot,
    directoryPath: transactionRoot,
    label: 'Terminal freeze transaction directory retirement'
  });
}

async function retireEmptyFreezeTransactionRootAfterJournalLast(input: {
  repositoryRoot: string;
  durability: FreezeDurabilityOptions;
}): Promise<void> {
  const transactionRoot = path.join(
    input.repositoryRoot,
    path.dirname(FreezeJournalRelativePath)
  );
  const observed = await inspectSafePath({
    boundaryRoot: input.repositoryRoot,
    candidatePath: transactionRoot,
    label: 'Journal-last empty freeze transaction directory',
    finalKind: 'directory',
    allowMissing: true
  });
  if (observed === null) return;
  const retainedDirectory = inspectNoFollowDirectoryChain(
    observed,
    'Journal-last empty freeze transaction directory census'
  ).target;
  const names = scanNoFollowDirectoryDirectMetadata(retainedDirectory, {
    deadlineAtMs: performance.now() + 30_000,
    maximumEntries: 10_000
  }).map((entry) => entry.relativePath).sort();
  if (names.length > 0) {
    throw new Error(
      `Freeze transaction directory has no journal authority and preserves direct residues: ${names.join(', ')}.`
    );
  }
  await removeExactEmptyDirectory({
    boundaryRoot: input.repositoryRoot,
    directoryPath: observed,
    label: 'Journal-last empty freeze transaction directory retirement',
    expectedIdentity: physicalIdentity(retainedDirectory)
  });
}

type FreezeDocumentControlPlaneInput = {
  cwd: string;
  manifestPath: string;
  reviewedOn: string;
  /** Author one untrusted tracking:none successor projection without activation authority. */
  proposalOnly?: boolean;
  faultAfter?: FreezeFault;
  /** Internal deterministic contract-test observer for rename durability ordering. */
  durabilityObserver?: DurabilityObserver;
  /** Internal deterministic contract-test seam for an unsupported directory barrier. */
  parentDirectoryBarrier?: (directoryPath: string) => Promise<void>;
  /** Internal deterministic contract-test seam before the post-admission local stability fence. */
  beforeInitialJournalFence?: () => Promise<void> | void;
  /** Internal deterministic contract-test seam after exact rename source/parent anchors are open. */
  beforeAnchoredRename?: FreezeDurabilityOptions['beforeAnchoredRename'];
  /** Internal deterministic seam after namespace mutation and before the retained-object flush. */
  afterAnchoredNamespaceMutationBeforeFlush?: FreezeDurabilityOptions['afterAnchoredNamespaceMutationBeforeFlush'];
  /** Internal deterministic seam after containing-parent anchors are retained and before creation. */
  beforeAnchoredCreate?: FreezeDurabilityOptions['beforeAnchoredCreate'];
  /** Internal deterministic seam after exact cleanup bytes are read from the opened object. */
  beforeAnchoredCleanup?: FreezeDurabilityOptions['beforeAnchoredCleanup'];
  /** Internal Linux-only fault seam after exact PRE recovery link identity readback. */
  afterExactPreRecoveryLink?: FreezeDurabilityOptions['afterExactPreRecoveryLink'];
  /** Internal deterministic fault seam immediately before a newly-created directory parent flush. */
  beforeCreatedParentBarrier?: FreezeDurabilityOptions['beforeCreatedParentBarrier'];
  /** Internal deterministic observer after a newly-created directory parent is durably flushed. */
  createdParentBarrierObserver?: FreezeDurabilityOptions['createdParentBarrierObserver'];
};

/**
 * Executes a freeze with the caller's already-bound Git read session.  The
 * public entrypoint below opens this session for production callers; tests and
 * composed control-plane operations may supply their own owner-issued scope.
 */
async function freezeDocumentControlPlaneWithSession(
  input: FreezeDocumentControlPlaneInput
): Promise<FreezeResult> {
  assertCanonicalManifestPath(input.manifestPath);
  assertReviewedOn(input.reviewedOn);
  const repositoryRoot = requireCommand(
    await run('git', ['rev-parse', '--show-toplevel'], input.cwd),
    'git repository discovery'
  );
  const durability: FreezeDurabilityOptions = Object.freeze({
    observer: input.durabilityObserver,
    parentDirectoryBarrier: input.parentDirectoryBarrier,
    beforeAnchoredRename: input.beforeAnchoredRename,
    afterAnchoredNamespaceMutationBeforeFlush: input.afterAnchoredNamespaceMutationBeforeFlush,
    beforeAnchoredCreate: input.beforeAnchoredCreate,
    beforeAnchoredCleanup: input.beforeAnchoredCleanup,
    afterExactPreRecoveryLink: input.afterExactPreRecoveryLink,
    beforeCreatedParentBarrier: input.beforeCreatedParentBarrier,
    createdParentBarrierObserver: input.createdParentBarrierObserver
  });
  return withWorkspaceWriteLease(repositoryRoot, undefined, async () => {
    let existingJournalSnapshot = await readFreezeJournalSnapshot(repositoryRoot);
    if (existingJournalSnapshot === null) {
      await retireEmptyFreezeTransactionRootAfterJournalLast({ repositoryRoot, durability });
    }
    const existingRecoveryIncomplete = existingJournalSnapshot?.recovery !== undefined
      && existingJournalSnapshot.recovery !== null
      && existingJournalSnapshot.recovery.completionMode !== 'complete';
    const requestedAuthoringDisposition = input.proposalOnly === true
      ? 'proposal-only' as const
      : 'activation' as const;
    if (existingJournalSnapshot !== null
        && (existingJournalSnapshot.journal.authoringDisposition ?? 'activation')
          !== requestedAuthoringDisposition) {
      throw new Error('Existing document-control journal belongs to another authoring disposition.');
    }
    if (existingJournalSnapshot !== null
        && (existingJournalSnapshot.journal.phase !== 'terminal' || existingRecoveryIncomplete)) {
      await preflightFreezeProjectionEntryStates(repositoryRoot, existingJournalSnapshot);
      await restoreFreezeJournalDurability(repositoryRoot, durability, existingJournalSnapshot);
    }
    if (existingJournalSnapshot?.recovery !== undefined
        && existingJournalSnapshot.recovery !== null
        && existingJournalSnapshot.recovery.completionMode !== 'complete') {
      const recovery = existingJournalSnapshot.recovery;
      const recoveredBytes = await writeFreezeJournal(
        repositoryRoot,
        recovery.expectedPreBytes,
        recovery.nextJournal,
        durability,
        input.faultAfter
      );
      const recoveredSnapshot = await readFreezeJournalSnapshot(repositoryRoot);
      if (recoveredSnapshot === null || !recoveredSnapshot.canonicalPresent
          || !recoveredSnapshot.bytes.equals(recoveredBytes)
          || !recoveredSnapshot.bytes.equals(recovery.nextBytes)
          || (recoveredSnapshot.recovery !== null
            && recoveredSnapshot.recovery.completionMode !== 'complete')) {
        throw new Error('Recovered freeze journal CAS is not canonically installed and completely retired.');
      }
      existingJournalSnapshot = recoveredSnapshot;
      await preflightFreezeProjectionEntryStates(repositoryRoot, recoveredSnapshot);
      await restoreFreezeJournalDurability(repositoryRoot, durability, recoveredSnapshot);
    }
    const manifestFile = await assertRegularRepositoryFile(repositoryRoot, input.manifestPath);
    const manifestBytes = await readSafeRegularFile({
      boundaryRoot: repositoryRoot,
      filePath: manifestFile,
      label: 'Work Package manifest'
    });
    const manifestDigest = WorkPackageManifestDigest(manifestBytes) as `sha256:${string}`;
    const existingJournal = existingJournalSnapshot?.journal ?? null;
    if (existingJournal !== null && existingJournal.phase !== 'terminal') {
      if (existingJournal.manifestPath !== input.manifestPath
          || existingJournal.manifestDigest !== manifestDigest
          || existingJournal.reviewedOn !== input.reviewedOn) {
        throw new Error('A competing nonterminal document control freeze journal exists.');
      }
      return advanceFreezeJournal({
        repositoryRoot,
        journal: existingJournal,
        journalBytes: existingJournalSnapshot!.bytes,
        faultAfter: input.faultAfter,
        durability
      });
    }
    if (existingJournal !== null && existingJournal.phase === 'terminal') {
      const previousResult = await verifyTerminalFreezeJournal({
        repositoryRoot,
        snapshot: existingJournalSnapshot!,
        manifestPath: existingJournal.manifestPath,
        manifestDigest: existingJournal.manifestDigest,
        reviewedOn: existingJournal.reviewedOn
      });
      await retireTerminalFreezeTransaction({
        repositoryRoot,
        snapshot: existingJournalSnapshot!,
        durability
      });
      existingJournalSnapshot = null;
      if (existingJournal.manifestPath === input.manifestPath
          && existingJournal.manifestDigest === manifestDigest
          && existingJournal.reviewedOn === input.reviewedOn) {
        return previousResult;
      }
      throw new PriorFreezeOperationRetiredError(previousResult.operationId, repositoryRoot);
    }

    const headSha = shaValue(
      requireCommand(await run('git', ['rev-parse', 'HEAD'], repositoryRoot), 'Candidate HEAD'),
      'Candidate HEAD'
    );
    const headStateBytes = await requireGitBlob(
      repositoryRoot,
      `${headSha}:${CurrentStatePath}`,
      'Immutable candidate current-state authority'
    );
    const spec = ParseCurrentStateSpec(
      decodeUtf8(headStateBytes, 'Immutable candidate current-state authority')
    );
    const localDefaultSha = shaValue(
      requireCommand(
        await run('git', ['rev-parse', '--verify', spec.resolver.defaultRef], repositoryRoot),
        'Local default ref'
      ),
      'Local default ref'
    );
    const baseTreeSha = shaValue(
      requireCommand(await run('git', ['rev-parse', `${localDefaultSha}^{tree}`], repositoryRoot), 'Base tree'),
      'Base tree'
    );
    const committedCandidateReplanAuthority = headSha === localDefaultSha
      ? undefined
      : await assertCommittedCandidateReplanAuthority({
        repositoryRoot,
        headSha,
        trustedDefaultSha: localDefaultSha,
        trustedDefaultTree: baseTreeSha,
        manifestPath: input.manifestPath
      });
    const defaultStateBytes = await requireGitBlob(
      repositoryRoot,
      `${localDefaultSha}:${CurrentStatePath}`,
      'Trusted default current-state authority'
    );
    const defaultSpec = ParseCurrentStateSpec(
      decodeUtf8(defaultStateBytes, 'Trusted default current-state authority')
    );
    const workSelectionProjectionMode = ResolveWorkSelectionProjectionMode(
      defaultSpec
    );

    // This complete local authority preflight uses an external object directory;
    // no repository object, index, journal, or control publication is permitted
    // before both it and the sole live-default admission have succeeded.
    const headPointerSource = decodeUtf8(await requireGitBlob(
      repositoryRoot,
      `${headSha}:${ActivePointerPath}`,
      'Immutable candidate active pointer preflight'
    ), 'Immutable candidate active pointer preflight');
    const headPointer = ParseActivePointer(headPointerSource);
    const targets = Object.freeze([...new Set([
      input.manifestPath,
      headPointer.manifest,
      ActivePointerPath,
      RollingPlanPath,
      ...(workSelectionProjectionMode === 'required' ? ['config/repository/work-selection.md'] : [])
    ])]);
    const targetSet = new Set<string>(targets);
    const snapshot = await observeExecutionProgressPhase('document-control-freeze', 'candidate-index-snapshot', () => captureControlIndexSnapshot(repositoryRoot, {
      targetManifestPath: input.manifestPath,
      stagedBaseSha: headSha,
      requiredStageZeroPaths: targets
    }));
    if (!snapshot.stateBytes.equals(headStateBytes)) {
      throw new Error('Document control freeze rejects staged current-state authority bytes.');
    }
    const pointer = ParseActivePointer(snapshot.pointerSource);
    AssertControlPlaneBinding({ spec, pointer });
    const rolling = ParseRollingPlan(snapshot.rollingPlanSource);
    if (rolling.activePackageId !== path.posix.basename(pointer.manifest, '.md')) {
      throw new Error('The immutable index pointer and rolling plan select different Work Packages.');
    }
    // HEAD is content-addressed; the earlier immutable read remains the same
    // observation across the index-only snapshot, so do not spawn a duplicate
    // Git child while preserving the independent staged-pointer comparison.
    const immutablePointerSource = headPointerSource;
    const immutableRollingPlanSource = decodeUtf8(await requireGitBlob(
      repositoryRoot,
      `${headSha}:${RollingPlanPath}`,
      'Immutable candidate rolling plan'
    ), 'Immutable candidate rolling plan');
    const immutablePointer = ParseActivePointer(immutablePointerSource);
    AssertControlPlaneBinding({ spec, pointer: immutablePointer });
    const immutableRolling = committedCandidateReplanAuthority !== undefined
        && workSelectionProjectionMode === 'required'
      ? ParseRollingPlanHeadings(immutableRollingPlanSource)
      : ParseRollingPlan(immutableRollingPlanSource);
    if (immutableRolling.activePackageId !== path.posix.basename(immutablePointer.manifest, '.md')) {
      throw new Error('Immutable HEAD pointer and rolling plan do not bind one selection baseline.');
    }
    const immutableCurrentManifestBytes = await requireGitBlob(
      repositoryRoot,
      `${headSha}:${immutablePointer.manifest}`,
      'Immutable candidate current Work Package manifest'
    );
    const immutableCurrentDefaultManifestBlob = await readGitBlob(
      repositoryRoot,
      `${localDefaultSha}:${immutablePointer.manifest}`
    ) ?? null;
    const immutableCurrentResolution = ResolveActiveWorkPackage({
      pointer: immutablePointer,
      candidateManifestBlob: immutableCurrentManifestBytes,
      defaultManifestBlob: immutableCurrentDefaultManifestBlob,
      defaultRefState: 'fresh'
    });

    // A successor freeze may stage deletion of the old pointer-bound manifest.
    // Its immutable HEAD bytes remain the semantic PRE image; absence from the
    // candidate index is the demanded retirement Effect, not missing authority.
    const currentManifestBlob = snapshot.candidateManifestBlob
      ?? immutableCurrentManifestBytes;
    const currentDefaultManifestBlob = await readGitBlob(
      repositoryRoot,
      `${localDefaultSha}:${pointer.manifest}`
    ) ?? null;
    const currentResolution = ResolveActiveWorkPackage({
      pointer,
      candidateManifestBlob: currentManifestBlob,
      defaultManifestBlob: currentDefaultManifestBlob,
      defaultRefState: 'fresh'
    });
    const repairableCommittedCandidateDigestDrift = committedCandidateReplanAuthority !== undefined
      && currentResolution.state === 'invalid'
      && currentResolution.reason === 'candidate-digest-mismatch';
    if (currentResolution.state === 'unresolved'
        || (currentResolution.state === 'invalid' && !repairableCommittedCandidateDigestDrift)) {
      throw new Error('Current active Work Package control plane is not resolvable before freeze.');
    }
    if (input.proposalOnly === true
        && (immutableCurrentResolution.state !== 'none'
          || immutableCurrentDefaultManifestBlob === null)) {
      throw new Error(
        'Proposal-only freeze requires a published current pointer manifest and no active Work Package.'
      );
    }

    assertNoUnrelatedStagedChanges(snapshot.stagedPaths, targetSet);
    const pointerFile = await assertRegularRepositoryFile(repositoryRoot, ActivePointerPath);
    const rollingPlanFile = await assertRegularRepositoryFile(repositoryRoot, RollingPlanPath);
    const pointerPre = Buffer.from(snapshot.pointerBytes);
    const rollingPlanPre = Buffer.from(snapshot.rollingPlanBytes);
    const [pointerWorktree, rollingPlanWorktree] = await Promise.all([
      readSafeRegularFile({
        boundaryRoot: repositoryRoot,
        filePath: pointerFile,
        label: 'Active pointer'
      }),
      readSafeRegularFile({
        boundaryRoot: repositoryRoot,
        filePath: rollingPlanFile,
        label: 'Rolling plan'
      })
    ]);
    if (!pointerWorktree.equals(pointerPre)) {
      throw new Error('Active pointer worktree bytes differ from the immutable index PRE image.');
    }
    const indexedTargetManifest = snapshot.targetManifestBlob;
    const defaultTargetManifest = await readGitBlob(
      repositoryRoot,
      `${localDefaultSha}:${input.manifestPath}`
    );
    const immutableRollingMachine = ParseRollingMachineProjection(
      immutableRollingPlanSource
    );
    const publishedBinding = ClassifyPublishedControlBinding({
      authorityProven: committedCandidateReplanAuthority !== undefined,
      historicalBaseIsLiveDefault: immutableRollingMachine?.exactMain === localDefaultSha,
      pointerBindsDefault: defaultTargetManifest !== undefined
        && WorkPackageManifestDigest(defaultTargetManifest) === immutablePointer.manifestDigest,
      pointerBindsHistoricalRolling:
        immutableRollingMachine?.schema === 'sec-work-rolling-transition-projection-v1'
        && immutableRollingMachine.active.manifestDigest === immutablePointer.manifestDigest,
      publishedTargetPresent: defaultTargetManifest !== undefined,
      rollingTransition: immutableRollingMachine?.schema === 'sec-work-rolling-transition-projection-v1'
    });
    if (publishedBinding.kind === 'blocked') {
      throw new Error(`Published Work Package binding is blocked: ${publishedBinding.reason}.`);
    }

    const indexedControlMatchesImmutableHead = snapshot.pointerSource === immutablePointerSource
      && snapshot.rollingPlanSource === immutableRollingPlanSource;
    let indexedControlMatchesPriorProjection = false;
    let priorProjectionFailure: unknown;
    if (!indexedControlMatchesImmutableHead && indexedTargetManifest !== undefined) {
      try {
        AssertPriorFreezeProjection({
          spec,
          immutableRollingPlanSource,
          pointerSource: snapshot.pointerSource,
          rollingPlanSource: snapshot.rollingPlanSource,
          manifestPath: input.manifestPath,
          manifestBytes: indexedTargetManifest,
          baseSha: localDefaultSha,
          baseTreeSha
        });
        indexedControlMatchesPriorProjection = true;
      } catch (error) {
        priorProjectionFailure = error;
      }
    }
    if (!indexedControlMatchesImmutableHead && !indexedControlMatchesPriorProjection) {
      throw new Error(
        'Staged control PRE must equal immutable HEAD or retain its exact immutable selection topology.',
        { cause: priorProjectionFailure }
      );
    }

    const requestedRollingPlanSource = rollingPlanWorktree.equals(rollingPlanPre)
      ? indexedControlMatchesPriorProjection
          && ParseRollingMachineProjection(snapshot.rollingPlanSource) === null
        ? snapshot.rollingPlanSource
        : undefined
      : decodeUtf8(rollingPlanWorktree, 'Requested rolling-plan projection');
    const targetManifest = ParseCurrentWorkPackageManifest(
      decodeUtf8(manifestBytes, 'Work Package manifest'),
      input.manifestPath
    );
    const targetManifestDigest = WorkPackageManifestDigest(
      manifestBytes
    ) as `sha256:${string}`;
    const committedCandidateProjectionRefreshRequired = workSelectionProjectionMode === 'required'
      && committedCandidateReplanAuthority !== undefined
      && targetManifest.id === immutableRolling.activePackageId
      && RequiresCommittedCandidateProjectionRefresh({
        projection: ParseRollingMachineProjection(immutableRollingPlanSource),
        exactMain: localDefaultSha,
        exactMainTree: baseTreeSha,
        active: {
          packageId: targetManifest.id,
          tracking: targetManifest.tracking,
          manifestPath: input.manifestPath,
          manifestDigest: targetManifestDigest
        },
        sourceTreeDeltaPaths: await observeCommittedCandidateProjectionSourceTreeDelta({
          repositoryRoot,
          currentTree: committedCandidateReplanAuthority.sourceTree,
          rollingPlanSource: immutableRollingPlanSource
        }),
        permittedProjectionDeltaPaths: targetSet
      });
    // This delta is projection-freshness input, not Work Package scope authority.
    // A non-projection path forces a new digest-bound projection; the Work Package
    // Gate independently owns whether that candidate path is permitted at all.
    let workSelectionProjection: WorkSelectionProjection | undefined;
    let mainHealthRepairProjection: MainHealthRepairProjection | undefined;
    if (targetManifest.id !== immutableRolling.activePackageId
        && input.proposalOnly !== true
        && workSelectionProjectionMode === 'required') {
      const candidateBranch = requireCommand(
        await run('git', ['branch', '--show-current'], repositoryRoot),
        'WorkDecision candidate branch'
      );
      if (candidateBranch.length === 0 || candidateBranch === spec.resolver.defaultBranch) {
        throw new Error('A new WorkDecision-selected package requires one non-default candidate branch.');
      }
      const { repairDecision, selection } = await observeDocumentControlWorkRouting({
        repositoryRoot,
        repository: spec.resolver.repository,
        defaultBranch: spec.resolver.defaultBranch,
        exactMainSha: localDefaultSha,
        exactMainTreeSha: baseTreeSha
      });
      if (repairDecision.routingState === 'repair-only') {
        if (currentResolution.state !== 'none'
            || currentDefaultManifestBlob === null
            || repairDecision.status !== 'repair-ready'
            || repairDecision.binding === null
            || repairDecision.binding.manifestPath !== input.manifestPath) {
          throw new Error(
            `MainHealth repair projection is unavailable, stale, or conflicts with an active package (${repairDecision.reasonCode}).`
          );
        }
        mainHealthRepairProjection = Object.freeze({
          decision: repairDecision,
          publishedActivePackage: Object.freeze({
            manifestPath: pointer.manifest,
            manifestDigest: pointer.manifestDigest,
            defaultManifestBytes: currentDefaultManifestBlob
          })
        });
      } else if (repairDecision.routingState === 'locked') {
        throw new Error(
          `MainHealth locks ordinary selection and repair (${repairDecision.reasonCode}).`
        );
      } else {
        if (selection === null) {
          throw new Error('Ordinary MainHealth routing did not produce one WorkDecision observation.');
        }
        if (selection.status !== 'resolved') {
          throw new Error(
            `WorkDecision observation is unresolved (${selection.reasonCodes.join(',')}): `
            + selection.blockerRefs.join(',')
          );
        }
        const decision = selection.receipt.decision;
        if (selection.terminalCompaction !== null) {
          const candidateRoadmap = snapshot.roadmapBlob;
          assertRoadmapTerminalCompactionCandidate({
            compaction: selection.terminalCompaction,
            roadmapSource: candidateRoadmap === undefined
              ? ''
              : decodeUtf8(candidateRoadmap, 'Candidate roadmap terminal compaction'),
            presentDelayedManifestPaths: selection.terminalCompaction.delayedManifestRetirementPaths
              .filter((manifestPath) => snapshot.indexPaths.includes(manifestPath))
          });
        }
        const selectedCatalogItem = selection.receipt.catalog.items.find(
          ({ workId }) => workId === decision.selectedWorkId
        );
        if (decision.status !== 'select-next'
            || selectedCatalogItem === undefined
            || selectedCatalogItem.packageId !== targetManifest.id
            || selectedCatalogItem.tracking !== targetManifest.tracking) {
          throw new Error(
            'Target manifest is not the exact package selected by the live WorkDecision: '
            + `decision=${decision.status}/${decision.selectedWorkId ?? 'none'}, `
            + `target=${targetManifest.id}/${targetManifest.tracking}, `
            + `current=${selection.receipt.input.current.activeState}/`
            + `${selection.receipt.input.current.closeoutState}.`
          );
        }
        workSelectionProjection = Object.freeze({ receipt: selection.receipt });
      }
    }
    const projection = CreateFreezeProjection({
      spec,
      currentPointerSource: immutablePointerSource,
      currentRollingPlanSource: immutableRollingPlanSource,
      currentManifestBytes: immutableCurrentManifestBytes,
      requestedRollingPlanSource,
      workSelectionProjection,
      mainHealthRepairProjection,
      proposalOnly: input.proposalOnly === true
        ? {
            currentResolution: immutableCurrentResolution,
            defaultManifestBytes: immutableCurrentDefaultManifestBlob!
          }
        : undefined,
      committedCandidateReplanProjection: workSelectionProjectionMode === 'required'
        && committedCandidateReplanAuthority !== undefined
        && targetManifest.id === immutableRolling.activePackageId
        && (
          committedCandidateProjectionRefreshRequired
          ||
          WorkPackageManifestDigest(manifestBytes)
            !== immutablePointer.manifestDigest
          || (
            requestedRollingPlanSource !== undefined
            && requestedRollingPlanSource !== immutableRollingPlanSource
          )
        )
        ? committedCandidateReplanAuthority
        : undefined,
      manifestPath: input.manifestPath,
      manifestBytes,
      baseSha: localDefaultSha,
      baseTreeSha,
      reviewedOn: input.reviewedOn
    });
    if (projection.retiredManifestPath === null) {
      if (snapshot.candidateManifestBlob === undefined) {
        throw new Error('Same-package freeze cannot retire its pointer-bound manifest.');
      }
    } else {
      const indexedRetiredManifestPresent = snapshot.indexPaths.includes(
        projection.retiredManifestPath
      );
      if (projection.retiredManifestPath !== immutablePointer.manifest) {
        throw new Error('Successor freeze retirement differs from the immutable prior pointer.');
      }
      if (indexedRetiredManifestPresent) {
        throw new Error('Successor freeze retained the prior pointer manifest in the candidate index.');
      }
      if (!snapshot.stagedPaths.includes(projection.retiredManifestPath)) {
        throw new Error(
          'Successor freeze prior pointer manifest deletion is not staged against exact HEAD; '
          + `observed staged paths: ${snapshot.stagedPaths.join(',') || 'none'}.`
        );
      }
      const retiredWorktreePath = path.join(
        repositoryRoot,
        ...projection.retiredManifestPath.split('/')
      );
      const remaining = await inspectSafePath({
        boundaryRoot: repositoryRoot,
        candidatePath: retiredWorktreePath,
        label: 'Successor freeze retired manifest',
        finalKind: 'file',
        allowMissing: true
      });
      if (remaining !== null) {
        throw new Error('Successor freeze prior manifest must be absent from the worktree.');
      }
    }
    const pointerNext = Buffer.from(projection.pointerSource, 'utf8');
    const rollingPlanNext = Buffer.from(projection.rollingPlanSource, 'utf8');
    const indexPaths = await resolveIndexPaths(repositoryRoot);
    if (existingJournalSnapshot === null) {
      const orphanRecovery = scanDirectDirectoryNames(
        indexPaths.gitDirectory,
        'Git index orphan recovery census'
      )
        .filter((name) => name.startsWith('.entry-'))
        .sort();
      if (orphanRecovery.length > 0) {
        throw new Error(
          `Git index recovery residue has no journal authority and is preserved: ${orphanRecovery.join(', ')}.`
        );
      }
    }
    if (await readOptionalSafeRegularFile({
      boundaryRoot: indexPaths.gitDirectory,
      filePath: indexPaths.lockPath,
      label: 'Git index preparation lock'
    }) !== null) {
      throw new Error('Document control freeze found an active Git index lock; preserving it.');
    }
    let indexReadback = await readAnchoredIndexSnapshot({
      boundaryRoot: indexPaths.gitDirectory,
      filePath: indexPaths.indexPath,
      label: 'Git index preparation readback'
    });
    if (indexReadback.identity !== snapshot.index.identity
        || !indexReadback.bytes.equals(snapshot.index.bytes)) {
      const semanticReadback = await captureRepositoryIndexTreeThroughExternalScratch({
        repositoryRoot,
        resolverGit: createReadOnlyResolverGit()
      });
      if (semanticReadback.treeSha !== snapshot.treeSha) {
        throw new Error(
          `Git index semantic tree changed during freeze preparation (before=${snapshot.treeSha}, `
          + `after=${semanticReadback.treeSha}).`
        );
      }
      indexReadback = semanticReadback.index;
    }
    const indexPre = Buffer.from(indexReadback.bytes);
    const liveDefaultSha = await observeLiveDefaultSha({
      repositoryRoot,
      repository: spec.resolver.repository,
      remote: spec.resolver.remote,
      defaultBranch: spec.resolver.defaultBranch,
      resolverGit: createReadOnlyResolverGit()
    });
    if (liveDefaultSha === undefined) {
      throw new Error('Pre-publication live default admission is unavailable.');
    }
    if (liveDefaultSha !== localDefaultSha) {
      throw new Error('Live default ref is stale before repository object publication; freeze fails closed.');
    }
    const createFreezeOperation = (
      candidateTreeSha: string,
      indexNext: Buffer
    ): Readonly<{
      journal: FreezeJournal;
      result: FreezeResult;
    }> => {
      const indexTransport = Object.freeze({ pre: toBase64(indexPre), next: toBase64(indexNext) });
      const semantic = Object.freeze({
        schema: projection.authoringDisposition === 'proposal-only'
          ? FreezeJournalSchema
          : LegacyFreezeJournalSchema,
        ...(projection.authoringDisposition === 'proposal-only'
          ? { authoringDisposition: projection.authoringDisposition }
          : {}),
        manifestPath: input.manifestPath,
        manifestDigest: projection.manifestDigest,
        reviewedOn: input.reviewedOn,
        baseSha: localDefaultSha,
        baseTreeSha,
        preIndexTreeSha: snapshot.treeSha,
        candidateTreeSha,
        files: Object.freeze({
          manifest: Object.freeze({ pre: toBase64(manifestBytes), next: toBase64(manifestBytes) }),
          pointer: Object.freeze({ pre: toBase64(pointerPre), next: toBase64(pointerNext) }),
          rollingPlan: Object.freeze({
            pre: toBase64(rollingPlanWorktree),
            next: toBase64(rollingPlanNext)
          })
        }),
        index: indexTransport,
        indexTransportDigest: freezeIndexTransportDigest(indexTransport)
      });
      const operationId = freezeOperationId(semantic);
      const result: FreezeResult = Object.freeze({
        schema: projection.authoringDisposition === 'proposal-only'
          ? FreezeResultSchema
          : LegacyFreezeResultSchema,
        status: projection.authoringDisposition === 'proposal-only'
          ? 'PROPOSED'
          : 'ACTIVATED_INDEX_PENDING_COMMIT',
        operationId,
        baseSha: localDefaultSha,
        baseTreeSha,
        candidateTreeSha,
        candidateHeadSha: null,
        manifestPath: input.manifestPath,
        manifestDigest: projection.manifestDigest,
        indexPublished: true,
        worktreeProjected: true
      });
      return Object.freeze({
        journal: Object.freeze({
          ...semantic,
          operationId,
          phase: 'prepared',
          result
        }),
        result
      });
    };
    const retirementSatisfied = projection.retiredManifestPath === null
      || !snapshot.indexPaths.includes(projection.retiredManifestPath);
    const convergence = ClassifyFreezeConvergence({
      targetManifestMatches: indexedTargetManifest !== undefined
        && indexedTargetManifest.equals(manifestBytes),
      pointerMatches: pointerPre.equals(pointerNext),
      indexedRollingMatches: rollingPlanPre.equals(rollingPlanNext),
      worktreeRollingMatches: rollingPlanWorktree.equals(rollingPlanNext),
      retirementSatisfied
    });
    if (convergence === 'semantic-noop') {
      const noop = createFreezeOperation(snapshot.treeSha, indexPre);
      await input.beforeInitialJournalFence?.();
      await assertInitialFreezeObservationFence({
        repositoryRoot,
        defaultRef: spec.resolver.defaultRef,
        headSha,
        localDefaultSha,
        indexPaths,
        indexSnapshot: indexReadback,
        expectedIndexTreeSha: snapshot.treeSha,
        allowSemanticIndexDrift: true,
        worktreeFiles: [
          { filePath: manifestFile, expectedBytes: manifestBytes, label: 'manifest' },
          { filePath: pointerFile, expectedBytes: pointerPre, label: 'active pointer' },
          { filePath: rollingPlanFile, expectedBytes: rollingPlanWorktree, label: 'rolling plan' }
        ],
        absentWorktreePaths: projection.retiredManifestPath === null
          ? []
          : [projection.retiredManifestPath]
      });
      return noop.result;
    }
    const built = await buildNextIndex({
      repositoryRoot,
      gitDirectory: indexPaths.gitDirectory,
      indexPath: indexPaths.indexPath,
      targets: [
        { path: input.manifestPath, pre: indexedTargetManifest, bytes: manifestBytes },
        { path: ActivePointerPath, pre: pointerPre, bytes: pointerNext },
        { path: RollingPlanPath, pre: rollingPlanPre, bytes: rollingPlanNext }
      ],
      absentPaths: projection.retiredManifestPath === null
        ? []
        : [projection.retiredManifestPath]
    });
    const operation = createFreezeOperation(built.treeSha, built.bytes);
    const builtConvergence = ClassifyFreezeConvergence({
      candidateTreeMatches: built.treeSha === snapshot.treeSha,
      targetManifestMatches: true,
      pointerMatches: pointerWorktree.equals(pointerNext),
      indexedRollingMatches: true,
      worktreeRollingMatches: rollingPlanWorktree.equals(rollingPlanNext),
      retirementSatisfied
    });
    if (builtConvergence === 'semantic-noop') {
      await input.beforeInitialJournalFence?.();
      await assertInitialFreezeObservationFence({
        repositoryRoot,
        defaultRef: spec.resolver.defaultRef,
        headSha,
        localDefaultSha,
        indexPaths,
        indexSnapshot: indexReadback,
        expectedIndexTreeSha: snapshot.treeSha,
        allowSemanticIndexDrift: true,
        worktreeFiles: [
          { filePath: manifestFile, expectedBytes: manifestBytes, label: 'manifest' },
          { filePath: pointerFile, expectedBytes: pointerNext, label: 'active pointer' },
          { filePath: rollingPlanFile, expectedBytes: rollingPlanNext, label: 'rolling plan' }
        ]
      });
      return operation.result;
    }
    await input.beforeInitialJournalFence?.();
    await observeExecutionProgressPhase('document-control-freeze', 'pre-journal-fence', () => assertInitialFreezeObservationFence({
      repositoryRoot,
      defaultRef: spec.resolver.defaultRef,
      headSha,
      localDefaultSha,
      indexPaths,
      indexSnapshot: indexReadback,
      expectedIndexTreeSha: snapshot.treeSha,
      allowSemanticIndexDrift: false,
      worktreeFiles: [
        { filePath: manifestFile, expectedBytes: manifestBytes, label: 'manifest' },
        { filePath: pointerFile, expectedBytes: pointerPre, label: 'active pointer' },
        { filePath: rollingPlanFile, expectedBytes: rollingPlanWorktree, label: 'rolling plan' }
      ],
      absentWorktreePaths: projection.retiredManifestPath === null
        ? []
        : [projection.retiredManifestPath]
    }));
    assertFreezeContinuationNativeCapacity('journal-prepare');
    const journalBytes = await observeExecutionProgressPhase('document-control-freeze', 'journal-preparation', () => writeFreezeJournal(
      repositoryRoot,
      existingJournalSnapshot?.bytes ?? null,
      operation.journal,
      durability,
      input.faultAfter
    ));
    maybeFault(input.faultAfter, 'after-journal-prepare');
    return advanceFreezeJournal({
      repositoryRoot,
      journal: operation.journal,
      journalBytes,
      faultAfter: input.faultAfter,
      durability
    });
  });
}

/**
 * Public freeze boundary.  A production caller must never reach the freeze
 * writer without the canonical Git-read issuer: the writer performs both
 * read-only repository census and index/object effects.  Test transport and a
 * composing production operation may provide an already-bound session; a
 * direct production call gets one bounded owner session here.
 */
export async function freezeDocumentControlPlane(
  input: FreezeDocumentControlPlaneInput
): Promise<FreezeResult> {
  if (documentControlGitReadScope.getStore() !== undefined) {
    return freezeDocumentControlPlaneWithSession(input);
  }
  if (documentControlHostCliTestScope.getStore() === documentControlHostCliTestIssuer) {
    return afterPriorTerminalFreezeRetirement(() => freezeDocumentControlPlaneWithSession(input));
  }
  const deadlineAtUnixMs = Date.now() + ExternalCommandTimeoutMs;
  try {
    return await afterPriorTerminalFreezeRetirement(() => withAuthorityGitReadSession({
      cwd: path.resolve(input.cwd),
      budget: FreezeGitReadBudget,
      deadlineAtUnixMs
    }, (session) => documentControlGitReadScope.run(
      session,
      () => freezeDocumentControlPlaneWithSession(input)
    )));
  } catch (error) {
    if (error instanceof DocumentControlCliAdmissionError) throw error;
    if (error instanceof GitReadAuthorityError) {
      throw documentControlCliFailure(
        'git',
        'git-read',
        'unavailable',
        error.failure.reason,
        error.failure.detailDigest
      );
    }
    throw error;
  }
}

async function afterPriorTerminalFreezeRetirement<T>(
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof PriorFreezeOperationRetiredError)) throw error;
    const remainingJournal = await readFreezeJournalSnapshot(error.repositoryRoot);
    if (remainingJournal !== null) {
      throw new Error(`Prior freeze ${error.priorOperationId} reported retirement but a journal remains.`);
    }
    reportExecutionProgress({
      command: 'document-control-freeze',
      phase: 'prior-operation-retired',
      state: 'complete',
      detail: { priorOperationId: error.priorOperationId, nextOperationStarted: false }
    });
    // A distinct requested operation starts only after the prior session has settled.
    return run();
  }
}

function unresolvedGitHubObservation(reason: string): Readonly<{
  status: 'unresolved';
  reason: string;
}> {
  return Object.freeze({ status: 'unresolved', reason });
}

function githubCommandFailure(label: string, result: CommandResult): string | null {
  if (result.code === 0) return null;
  return `${label} failed: ${result.stderr.trim() || `exit ${result.code}`}`;
}

async function observeLiveDefaultSha(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  remote: string;
  defaultBranch: string;
  resolverGit: ReadOnlyResolverGit;
}>): Promise<string | undefined> {
  const remoteUrl = await input.resolverGit.run(
    ['remote', 'get-url', input.remote],
    input.repositoryRoot
  );
  if (remoteUrl.code !== 0) return undefined;
  const githubRepository = parseGitHubRepositoryIdentityFromRemoteUrl(remoteUrl.stdout);
  if (githubRepository !== null) {
    if (githubRepository.toLowerCase() !== input.repository.toLowerCase()) return undefined;
    try {
      return await observeMainHealthGitHubDefaultBranchSha({
        repositoryRoot: input.repositoryRoot,
        repository: input.repository,
        defaultBranch: input.defaultBranch
      });
    } catch {
      return undefined;
    }
  }
  return optionalLiveDefaultSha(await input.resolverGit.run(
    ['ls-remote', '--exit-code', input.remote, `refs/heads/${input.defaultBranch}`],
    input.repositoryRoot
  ), 'Live default ref');
}

async function observeGitHubControlFacts(
  repositoryRoot: string,
  repository: string
): Promise<Readonly<Record<string, unknown>>> {
  if (documentControlHostCliTestScope.getStore() !== documentControlHostCliTestIssuer) {
    try {
      const inventory = await withMainHealthGitHubReadSession({
        repositoryRoot,
        repository,
        operation: async () => await observeMainHealthGitHubControlInventory({ repository })
      });
      return Object.freeze({ status: 'resolved', ...inventory });
    } catch (error) {
      return unresolvedGitHubObservation(error instanceof Error ? error.message : String(error));
    }
  }
  const countBeforeResult = await run(
    'gh',
    buildGitHubOpenInventoryCountsArgs(repository),
    repositoryRoot
  );
  const countBeforeFailure = githubCommandFailure('GitHub open inventory count', countBeforeResult);
  if (countBeforeFailure !== null) return unresolvedGitHubObservation(countBeforeFailure);

  try {
    const counts = parseGitHubOpenInventoryCounts(countBeforeResult.stdout);
    const [pullRequestsResult, issuesResult, reviewThreadsResult] = await Promise.all([
      run(
        'gh',
        buildGitHubOpenPullRequestsArgs(repository, counts.pullRequests),
        repositoryRoot
      ),
      run(
        'gh',
        buildGitHubOpenIssuesArgs(repository, counts.issues),
        repositoryRoot
      ),
      run(
        'gh',
        buildGitHubOpenPullRequestReviewThreadsArgs(repository),
        repositoryRoot
      )
    ]);
    const commandFailure = [
      githubCommandFailure('GitHub open pull request inventory', pullRequestsResult),
      githubCommandFailure('GitHub open issue inventory', issuesResult),
      githubCommandFailure('GitHub review-thread inventory', reviewThreadsResult)
    ].filter((reason): reason is string => reason !== null).join(' | ');
    if (commandFailure.length > 0) return unresolvedGitHubObservation(commandFailure);

    const openPullRequests = parseExactGitHubNumberedInventory(
      pullRequestsResult.stdout,
      'open pull request inventory',
      counts.pullRequests
    );
    const openIssues = parseExactGitHubNumberedInventory(
      issuesResult.stdout,
      'open issue inventory',
      counts.issues
    );
    const pullRequestNumbers = openPullRequests.map((pullRequest) => pullRequest.number as number);
    const reviewThreadInventory = parseGitHubOpenPullRequestReviewThreadPages(
      reviewThreadsResult.stdout,
      pullRequestNumbers
    );
    const replacements = new Map<number, GitHubReviewThreadConnection>();
    for (const pullRequestNumber of reviewThreadInventory.incompletePullRequestNumbers) {
      const result = await run(
        'gh',
        buildGitHubPullRequestReviewThreadsArgs(repository, pullRequestNumber),
        repositoryRoot
      );
      const failure = githubCommandFailure(
        `GitHub pull request ${pullRequestNumber} review-thread pagination`,
        result
      );
      if (failure !== null) return unresolvedGitHubObservation(failure);
      replacements.set(
        pullRequestNumber,
        parseGitHubPullRequestReviewThreadPages(result.stdout, pullRequestNumber)
      );
    }
    const reviewThreads = replaceIncompleteGitHubReviewThreads(
      reviewThreadInventory,
      replacements
    );

    const countAfterResult = await run(
      'gh',
      buildGitHubOpenInventoryCountsArgs(repository),
      repositoryRoot
    );
    const countAfterFailure = githubCommandFailure(
      'GitHub open inventory count readback',
      countAfterResult
    );
    if (countAfterFailure !== null) return unresolvedGitHubObservation(countAfterFailure);
    const countReadback = parseGitHubOpenInventoryCounts(countAfterResult.stdout);
    if (
      countReadback.pullRequests !== counts.pullRequests
      || countReadback.issues !== counts.issues
    ) {
      return unresolvedGitHubObservation(
        'GitHub open inventory count changed during the observation fence.'
      );
    }

    return Object.freeze({
      status: 'resolved',
      openPullRequests,
      openIssues,
      reviewThreads
    });
  } catch (error) {
    return unresolvedGitHubObservation(error instanceof Error ? error.message : String(error));
  }
}

async function resolveActivationBlockedStatus(input: {
  repositoryRoot: string;
  resolverGit: ReadOnlyResolverGit;
  journal: FreezeJournal | null;
  reason: 'activation-in-progress' | 'document-control-authoring-in-progress' | 'activation-observation-raced';
  terminal?: boolean;
}): Promise<Record<string, unknown>> {
  const stateSource = await readFile(path.join(input.repositoryRoot, CurrentStatePath), 'utf8');
  const spec = ParseCurrentStateSpec(stateSource);
  const localDefaultShaResult = await input.resolverGit.run(
    ['rev-parse', '--verify', spec.resolver.defaultRef],
    input.repositoryRoot
  );
  const localDefaultSha = localDefaultShaResult.code === 0 ? localDefaultShaResult.stdout.trim() : undefined;
  const liveDefaultSha = await observeLiveDefaultSha({
    repositoryRoot: input.repositoryRoot,
    repository: spec.resolver.repository,
    remote: spec.resolver.remote,
    defaultBranch: spec.resolver.defaultBranch,
    resolverGit: input.resolverGit
  });
  const defaultRefState: DefaultRefState = localDefaultSha === undefined || liveDefaultSha === undefined
    ? 'unavailable'
    : localDefaultSha === liveDefaultSha ? 'fresh' : 'stale';
  const headSha = requireCommand(
    await input.resolverGit.run(['rev-parse', 'HEAD'], input.repositoryRoot),
    'candidate head resolution'
  );
  const branch = requireCommand(
    await input.resolverGit.run(['branch', '--show-current'], input.repositoryRoot),
    'candidate branch resolution'
  )
    || '(detached)';
  const mergeBase = defaultRefState === 'fresh'
    ? requireCommand(
        await input.resolverGit.run(['merge-base', localDefaultSha!, headSha], input.repositoryRoot),
        'candidate merge-base resolution'
      )
    : undefined;
  return {
    schema: 'sec-resolved-current-state-v1',
    observedAt: new Date().toISOString(),
    source: CurrentStatePath,
    repository: {
      fullName: spec.resolver.repository,
      defaultBranch: spec.resolver.defaultBranch,
      localDefaultSha,
      liveDefaultSha,
      defaultRefState,
      tree: undefined
    },
    workspace: {
      headSha,
      branch,
      mergeBase,
      candidateTreeSha: null,
      status: 'activation observation blocked; worktree status intentionally not observed'
    },
    github: {
      status: 'unresolved',
      reason: input.reason === 'activation-in-progress'
        ? 'GitHub observation skipped while activation is nonterminal'
        : input.reason === 'document-control-authoring-in-progress'
        ? 'GitHub observation skipped while proposal authoring is nonterminal'
        : 'GitHub observation skipped because activation changed during status resolution'
    },
    activeWorkPackage: { state: 'unresolved', reason: input.reason },
    activation: input.journal === null ? null : {
      operationId: input.journal.operationId,
      phase: input.journal.phase,
      terminal: input.terminal ?? input.journal.phase === 'terminal'
    },
    stableFacts: spec.stableFacts
  };
}

function journalObservationIdentity(snapshot: FreezeJournalSnapshot | null): string | null {
  if (snapshot === null) return null;
  const journal = effectiveFreezeJournal(snapshot)!;
  return `${journal.operationId}\0${journal.phase}\0${snapshot.canonicalPresent ? 'canonical' : 'recovery'}\0${snapshot.recovery?.completionMode ?? 'none'}`;
}

function freezeJournalActivationInProgress(snapshot: FreezeJournalSnapshot | null): boolean {
  const journal = effectiveFreezeJournal(snapshot);
  return snapshot !== null && (
    journal!.phase !== 'terminal'
    || snapshot.recovery?.completionMode === 'canonical-install-required'
    || snapshot.recovery?.completionMode === 'active-next-retirement-required'
  );
}

function freezeJournalInProgressReason(
  journal: FreezeJournal | null
): 'activation-in-progress' | 'document-control-authoring-in-progress' {
  return journal?.authoringDisposition === 'proposal-only'
    ? 'document-control-authoring-in-progress'
    : 'activation-in-progress';
}

function optionalCommandSha(result: CommandResult, label: string): string | undefined {
  return result.code === 0 ? shaValue(result.stdout.trim(), label) : undefined;
}

function optionalLiveDefaultSha(result: CommandResult, label: string): string | undefined {
  if (result.code !== 0) return undefined;
  return shaValue(result.stdout.trim().split(/\s+/u)[0], label);
}

type ResolveLiveControlPlaneOptions = Readonly<{
  observeGitHub?: boolean;
  /** Deterministic contract-test seam for the journal/snapshot double-read race. */
  afterIndexSnapshot?: () => Promise<void> | void;
  /** Deterministic contract-test seam for exact-SHA/index/ref readback races. */
  beforeObservationReadback?: () => Promise<void> | void;
  /** Deterministic contract-test seam between anchored residue census reads. */
  beforeJournalRecoveryCensusReadback?: () => Promise<void> | void;
  /** Deterministic contract-test observation of the final read-only Git child environment. */
  resolverGitCommandObserver?: ReadOnlyResolverGitObserver;
}>;

export async function resolveLiveControlPlane(
  cwd: string,
  options: ResolveLiveControlPlaneOptions = {}
): Promise<Record<string, unknown>> {
  if (documentControlHostCliTestScope.getStore() === documentControlHostCliTestIssuer) {
    return resolveLiveControlPlaneWithGitReadSession(cwd, options);
  }
  try {
    const absoluteDeadline = Date.now() + ExternalCommandTimeoutMs;
    return await withAuthorityGitReadSession({
      cwd: path.resolve(cwd),
      budget: GIT_READ_OPERATION_BUDGET,
      deadlineAtUnixMs: absoluteDeadline
    }, (session) => documentControlGitReadScope.run(
      session,
      () => resolveLiveControlPlaneWithGitReadSession(cwd, options)
    ));
  } catch (error) {
    if (error instanceof DocumentControlCliAdmissionError) throw error;
    if (error instanceof GitReadAuthorityError) {
      throw documentControlCliFailure(
        'git',
        'git-read',
        'unavailable',
        error.failure.reason,
        error.failure.detailDigest
      );
    }
    throw error;
  }
}

function strictRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be one object.`);
  }
  return value as Record<string, unknown>;
}

function strictNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || value.includes('\0')) {
    throw new Error(`${label} must be one non-empty trimmed string.`);
  }
  return value;
}

function strictOptionalSha(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  const result = strictNonEmptyString(value, label);
  if (!/^[0-9a-f]{40}$/u.test(result)) throw new Error(`${label} must be one lowercase Git SHA.`);
  return result;
}

function issueActiveWorkObservation(
  resolved: Readonly<Record<string, unknown>>
): ActiveWorkPackageOwnerObservation {
  const repository = strictRecord(resolved.repository, 'Resolved repository');
  const workspace = strictRecord(resolved.workspace, 'Resolved workspace');
  const active = strictRecord(resolved.activeWorkPackage, 'Resolved active Work Package');
  const repositoryName = strictNonEmptyString(repository.fullName, 'Resolved repository.fullName');
  const defaultBranch = strictNonEmptyString(repository.defaultBranch, 'Resolved repository.defaultBranch');
  const observedAt = strictNonEmptyString(resolved.observedAt, 'Resolved observedAt');
  if (!Number.isFinite(Date.parse(observedAt))) {
    throw new Error('Resolved observedAt must be one ISO timestamp.');
  }
  const localDefaultSha = strictOptionalSha(repository.localDefaultSha, 'Resolved repository.localDefaultSha');
  const liveDefaultSha = strictOptionalSha(repository.liveDefaultSha, 'Resolved repository.liveDefaultSha');
  const state = active.state;
  if (state !== 'active' && state !== 'none' && state !== 'invalid' && state !== 'unresolved') {
    throw new Error('Resolved active Work Package state is invalid.');
  }
  const defaultSha = localDefaultSha !== null && localDefaultSha === liveDefaultSha
    ? localDefaultSha
    : null;
  let branch: string | null = null;
  let manifest: string | null = null;
  let reason: string | null = null;
  if (state === 'active') {
    if (repository.defaultRefState !== 'fresh' || defaultSha === null) {
      throw new Error('Active Work Package observation requires one fresh exact default ref.');
    }
    branch = strictNonEmptyString(workspace.branch, 'Resolved active Work Package branch');
    if (branch === '(detached)' || branch === defaultBranch) {
      throw new Error('Active Work Package branch must be one non-default candidate branch.');
    }
    manifest = strictNonEmptyString(active.manifest, 'Resolved active Work Package manifest');
  } else {
    reason = strictNonEmptyString(active.reason, 'Resolved active Work Package reason');
    if (state === 'none' && (repository.defaultRefState !== 'fresh' || defaultSha === null)) {
      throw new Error('No-active-work observation requires one fresh exact default ref.');
    }
  }
  return issueActiveWorkPackageOwnerObservation({
    repository: repositoryName,
    defaultBranch,
    defaultSha,
    observedAt,
    state,
    branch,
    manifest,
    reason
  });
}

/**
 * Runs the documentation owner's live resolver and emits the sole opaque
 * active-work observation accepted by production branch-lifecycle composition.
 */
export async function observeActiveWorkPackage(
  cwd: string
): Promise<ActiveWorkPackageOwnerObservation> {
  return issueActiveWorkObservation(await resolveLiveControlPlane(cwd, { observeGitHub: false }));
}

async function resolveLiveControlPlaneWithGitReadSession(
  cwd: string,
  options: ResolveLiveControlPlaneOptions
): Promise<Record<string, unknown>> {
  const resolverGit = createReadOnlyResolverGit(options.resolverGitCommandObserver);
  const repositoryRoot = requireCommand(
    await resolverGit.run(['rev-parse', '--show-toplevel'], cwd),
    'git repository discovery'
  );
  const activationJournalSnapshot = await readFreezeJournalSnapshot(
    repositoryRoot,
    options.beforeJournalRecoveryCensusReadback
  );
  const activationJournal = effectiveFreezeJournal(activationJournalSnapshot);
  if (freezeJournalActivationInProgress(activationJournalSnapshot)) {
    return resolveActivationBlockedStatus({
      repositoryRoot,
      resolverGit,
      journal: activationJournal,
      reason: freezeJournalInProgressReason(activationJournal),
      terminal: false
    });
  }
  let snapshot: ControlIndexSnapshot;
  try {
    snapshot = await captureControlIndexSnapshot(repositoryRoot, { resolverGit });
  } catch (error) {
    const racedJournalSnapshot = await readFreezeJournalSnapshot(
      repositoryRoot,
      options.beforeJournalRecoveryCensusReadback
    );
    const racedJournal = effectiveFreezeJournal(racedJournalSnapshot);
    if (freezeJournalActivationInProgress(racedJournalSnapshot)) {
      return resolveActivationBlockedStatus({
        repositoryRoot,
        resolverGit,
        journal: racedJournal,
        reason: freezeJournalInProgressReason(racedJournal),
        terminal: false
      });
    }
    throw error;
  }
  await options.afterIndexSnapshot?.();
  const spec = ParseCurrentStateSpec(snapshot.stateSource);
  const pointer = ParseActivePointer(snapshot.pointerSource);
  const rollingPlan = ParseRollingPlan(snapshot.rollingPlanSource);
  const rollingMachine = ParseRollingMachineProjection(snapshot.rollingPlanSource);
  const rollingManifestBinding = rollingMachine === null
    ? null
    : projectWorkRollingExactManifestBinding(rollingMachine);
  AssertControlPlaneBinding({ spec, pointer });
  if (rollingPlan.activePackageId !== path.posix.basename(pointer.manifest, '.md')) {
    throw new Error('Immutable index pointer and rolling plan select different Work Packages.');
  }
  if (ResolveWorkSelectionProjectionMode(spec) === 'required'
      && rollingMachine === null) {
    throw new Error('Required rolling projection is absent.');
  }
  if (rollingManifestBinding !== null
      && (rollingManifestBinding.active.manifestPath !== pointer.manifest
        || rollingManifestBinding.active.manifestDigest !== pointer.manifestDigest)) {
    throw new Error('Rolling machine projection does not bind the exact active pointer manifest.');
  }

  const localDefaultShaResult = await resolverGit.run(
    ['rev-parse', '--verify', spec.resolver.defaultRef],
    repositoryRoot
  );
  const localDefaultSha = optionalCommandSha(localDefaultShaResult, 'Local default ref');
  const liveDefaultSha = await observeLiveDefaultSha({
    repositoryRoot,
    repository: spec.resolver.repository,
    remote: spec.resolver.remote,
    defaultBranch: spec.resolver.defaultBranch,
    resolverGit
  });
  const defaultRefState: DefaultRefState = (
    localDefaultSha === undefined || liveDefaultSha === undefined
      ? 'unavailable'
      : localDefaultSha === liveDefaultSha
        ? 'fresh'
        : 'stale'
  );

  const candidateManifestBlob = snapshot.candidateManifestBlob;
  const defaultManifestBlob = defaultRefState === 'fresh'
    ? await resolverGit.readBlob(repositoryRoot, `${localDefaultSha}:${pointer.manifest}`) ?? null
    : null;
  const activeWorkPackage: ActiveWorkPackageResolution =
    ResolveActiveWorkPackage({
      pointer,
      candidateManifestBlob,
      defaultManifestBlob,
      defaultRefState
    });
  if (activeWorkPackage.state === 'active'
      && candidateManifestBlob !== undefined
      && rollingManifestBinding !== null) {
    const candidateManifest = ParseCurrentWorkPackageManifest(
      decodeUtf8(candidateManifestBlob, 'Rolling transition active manifest'),
      pointer.manifest
    );
    if (candidateManifest.id !== rollingManifestBinding.active.packageId
        || candidateManifest.tracking !== rollingManifestBinding.active.tracking) {
      throw new Error('Rolling machine projection does not bind the exact active manifest identity.');
    }
  }
  const mainTree = defaultRefState === 'fresh'
    ? shaValue(
        requireCommand(
          await resolverGit.run(['rev-parse', `${localDefaultSha}^{tree}`], repositoryRoot),
          'default-branch tree resolution'
        ),
        'Default-branch tree'
      )
    : undefined;
  // A rolling projection binds the default revision only while its manifest is
  // prospective. Once the exact manifest blob is published on default, the
  // projection is immutable transition history; requiring it to bind the
  // post-merge commit would make every successful publication self-lock the
  // resolver before it can reorient on the new main.
  if (activeWorkPackage.state === 'active'
      && rollingMachine !== null
      && localDefaultSha !== undefined
      && mainTree !== undefined) {
    AssertRollingMachineBaseBinding({
      projection: rollingMachine,
      exactMain: localDefaultSha,
      exactMainTree: mainTree
    });
  }
  const headSha = shaValue(
    requireCommand(await resolverGit.run(['rev-parse', 'HEAD'], repositoryRoot), 'candidate head resolution'),
    'Candidate HEAD'
  );
  const branch = requireCommand(
    await resolverGit.run(['branch', '--show-current'], repositoryRoot),
    'candidate branch resolution'
  ) || '(detached)';
  const mergeBase = defaultRefState === 'fresh'
    ? shaValue(
        requireCommand(
          await resolverGit.run(['merge-base', localDefaultSha!, headSha], repositoryRoot),
          'candidate merge-base resolution'
        ),
        'Candidate merge-base'
      )
    : undefined;
  const worktreeStatus = snapshot.worktreeStatus;
  const observeGitHub = options.observeGitHub !== false;
  const githubState = observeGitHub
    ? await observeGitHubControlFacts(repositoryRoot, spec.resolver.repository)
    : unresolvedGitHubObservation('GitHub observation skipped while activation is nonterminal');

  await options.beforeObservationReadback?.();
  let indexTreeReadback: string | null = null;
  try {
    ({ treeSha: indexTreeReadback } = await captureRepositoryIndexTreeThroughExternalScratch({
      repositoryRoot,
      resolverGit
    }));
  } catch {
    indexTreeReadback = null;
  }
  const headReadbackResult = await resolverGit.run(['rev-parse', 'HEAD'], repositoryRoot);
  const localDefaultReadbackResult = await resolverGit.run(
    ['rev-parse', '--verify', spec.resolver.defaultRef],
    repositoryRoot
  );
  const headShaReadback = optionalCommandSha(headReadbackResult, 'Candidate HEAD readback');
  const localDefaultShaReadback = optionalCommandSha(localDefaultReadbackResult, 'Local default ref readback');
  const liveDefaultShaReadback = await observeLiveDefaultSha({
    repositoryRoot,
    repository: spec.resolver.repository,
    remote: spec.resolver.remote,
    defaultBranch: spec.resolver.defaultBranch,
    resolverGit
  });
  // The journal is the seqlock: document-control authoring publishes it before any index/worktree
  // effect, so this read must be the final volatile observation in the fence.
  const activationJournalReadbackSnapshot = await readFreezeJournalSnapshot(
    repositoryRoot,
    options.beforeJournalRecoveryCensusReadback
  );
  const activationJournalReadback = effectiveFreezeJournal(activationJournalReadbackSnapshot);
  if (freezeJournalActivationInProgress(activationJournalReadbackSnapshot)) {
    return resolveActivationBlockedStatus({
      repositoryRoot,
      resolverGit,
      journal: activationJournalReadback,
      reason: freezeJournalInProgressReason(activationJournalReadback),
      terminal: false
    });
  }
  if (journalObservationIdentity(activationJournalReadbackSnapshot)
      !== journalObservationIdentity(activationJournalSnapshot)) {
    return resolveActivationBlockedStatus({
      repositoryRoot,
      resolverGit,
      journal: activationJournalReadback,
      reason: 'activation-observation-raced'
    });
  }
  if (
    indexTreeReadback !== snapshot.treeSha
    || headShaReadback !== headSha
    || localDefaultShaReadback !== localDefaultSha
    || liveDefaultShaReadback !== liveDefaultSha
  ) {
    return resolveActivationBlockedStatus({
      repositoryRoot,
      resolverGit,
      journal: activationJournalReadback,
      reason: 'activation-observation-raced'
    });
  }

  return {
    schema: 'sec-resolved-current-state-v1',
    observedAt: new Date().toISOString(),
    source: 'config/repository/current-state.yaml',
    repository: {
      fullName: spec.resolver.repository,
      defaultBranch: spec.resolver.defaultBranch,
      localDefaultSha,
      liveDefaultSha,
      defaultRefState,
      tree: mainTree
    },
    workspace: {
      headSha,
      branch,
      mergeBase,
      candidateTreeSha: snapshot.treeSha,
      status: worktreeStatus
    },
    github: githubState,
    activeWorkPackage,
    activation: activationJournalReadback === null ? null : {
      operationId: activationJournalReadback.operationId,
      phase: activationJournalReadback.phase,
      terminal: activationJournalReadback.phase === 'terminal'
    },
    stableFacts: spec.stableFacts
  };
}

export interface DocumentControlPlaneStatusCliProjection {
  readonly schema: 'sec-document-control-plane-status-cli-projection-v1';
  readonly resultDigest: `sha256:${string}`;
  readonly repository: unknown;
  readonly workspace: unknown;
  readonly github: Readonly<{
    status: unknown;
    reason?: unknown;
    openPullRequestNumbers?: readonly number[];
    openIssueCount?: number;
    reviewThreadPullRequestCount?: number;
  }>;
  readonly activeWorkPackage: unknown;
  readonly activation: unknown;
}

export function projectDocumentControlPlaneStatusCli(
  resolved: Readonly<Record<string, unknown>>
): DocumentControlPlaneStatusCliProjection {
  const github = resolved.github !== null
    && typeof resolved.github === 'object'
    && !Array.isArray(resolved.github)
    ? resolved.github as Record<string, unknown>
    : {};
  const openPullRequests = Array.isArray(github.openPullRequests)
    ? github.openPullRequests
    : undefined;
  const openIssues = Array.isArray(github.openIssues) ? github.openIssues : undefined;
  const reviewThreadPullRequestCount = Array.isArray(github.reviewThreads)
    ? github.reviewThreads.length
    : github.reviewThreads !== null
        && typeof github.reviewThreads === 'object'
      ? Object.keys(github.reviewThreads).length
      : undefined;
  return Object.freeze({
    schema: 'sec-document-control-plane-status-cli-projection-v1',
    resultDigest: rawSha256(JSON.stringify(resolved)),
    repository: resolved.repository,
    workspace: resolved.workspace,
    github: Object.freeze({
      status: github.status,
      ...(github.reason === undefined ? {} : { reason: github.reason }),
      ...(openPullRequests === undefined ? {} : {
        openPullRequestNumbers: Object.freeze(openPullRequests.flatMap((item) => (
          item !== null && typeof item === 'object' && !Array.isArray(item)
            && typeof (item as { number?: unknown }).number === 'number'
            ? [(item as { number: number }).number]
            : []
        )))
      }),
      ...(openIssues === undefined ? {} : { openIssueCount: openIssues.length }),
      ...(reviewThreadPullRequestCount === undefined ? {} : { reviewThreadPullRequestCount })
    }),
    activeWorkPackage: resolved.activeWorkPackage,
    activation: resolved.activation
  });
}

export async function runDocumentControlPlaneCli(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv.shift();
  const usage = 'Usage:\n'
    + '  bun src/adapters/self-hosting/control/documentation/document-control-plane.ts status [--workspace <path>] [--json] [--full]\n'
    + '  bun src/adapters/self-hosting/control/documentation/document-control-plane.ts freeze --workspace <candidate-path> '
    + '--manifest <path> --reviewed-on <YYYY-MM-DD> [--proposal-only] [--json]';
  if (command === 'status') {
    let workspace = process.cwd();
    for (let index = 0; index < argv.length; index += 1) {
      const argument = argv[index]!;
      if (argument === '--json' || argument === '--full') continue;
      if (argument !== '--workspace' || argv[index + 1] === undefined
          || argv[index + 1]!.startsWith('--')) throw new Error(usage);
      workspace = path.resolve(argv[index + 1]!);
      index += 1;
    }
    if (argv.filter((argument) => argument === '--json').length > 1
        || argv.filter((argument) => argument === '--full').length > 1
        || argv.filter((argument) => argument === '--workspace').length > 1) throw new Error(usage);
    const resolved = await observeExecutionProgressPhase('document-control-status', 'resolve-live-control-plane', () => resolveLiveControlPlane(workspace));
    const output = argv.includes('--full')
      ? resolved
      : projectDocumentControlPlaneStatusCli(resolved);
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    const repository = resolved.repository as { defaultRefState: DefaultRefState };
    const github = resolved.github as { status: string };
    const active = resolved.activeWorkPackage as ActiveWorkPackageResolution;
    if (
      repository.defaultRefState !== 'fresh'
      || github.status !== 'resolved'
      || active.state === 'invalid'
      || active.state === 'unresolved'
    ) process.exitCode = 1;
    return;
  }
  // CLI command dispatch selects the operation; freeze rebinds exact main/candidate/manifest authority internally.
  // codeql[js/user-controlled-bypass]
  if (command === 'freeze') {
    const values = new Map<string, string>();
    for (let index = 0; index < argv.length; index += 1) {
      const argument = argv[index]!;
      if (argument === '--json' || argument === '--proposal-only') continue;
      if (argument !== '--manifest' && argument !== '--reviewed-on' && argument !== '--workspace') {
        throw new Error(usage);
      }
      if (values.has(argument)) throw new Error(`Duplicate freeze option: ${argument}.`);
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${argument} requires a value.\n${usage}`);
      values.set(argument, value);
      index += 1;
    }
    const manifestPath = values.get('--manifest');
    const reviewedOn = values.get('--reviewed-on');
    const workspace = values.get('--workspace');
    if (manifestPath === undefined || reviewedOn === undefined || workspace === undefined) {
      throw new Error(usage);
    }
    if (argv.filter((argument) => argument === '--proposal-only').length > 1) {
      throw new Error('Duplicate freeze option: --proposal-only.');
    }
    const executionRoot = path.resolve(import.meta.dir, '..', '..', '..', '..', '..');
    const freezeDeadlineAtUnixMs = Date.now() + ExternalCommandTimeoutMs;
    const remainingFreezeBudget = (): number => Math.max(
      1,
      freezeDeadlineAtUnixMs - Date.now()
    );
    let executionDefaultBranch: string | undefined;
    await observeExecutionProgressPhase('document-control-freeze', 'trusted-main-preflight', () => withAuthorityGitReadSession({
      cwd: executionRoot,
      budget: Object.freeze({
        ...GIT_READ_OPERATION_BUDGET,
        deadlineMs: remainingFreezeBudget()
      }),
      deadlineAtUnixMs: freezeDeadlineAtUnixMs
    }, (session) => documentControlGitReadScope.run(session, async () => {
      const executionBranch = requireCommand(
        await run('git', ['branch', '--show-current'], executionRoot),
        'Document-control execution branch'
      );
      const executionHead = shaValue(
        requireCommand(await run('git', ['rev-parse', 'HEAD'], executionRoot), 'Document-control execution HEAD'),
        'Document-control execution HEAD'
      );
      const executionSpec = ParseCurrentStateSpec(decodeUtf8(await requireGitBlob(
        executionRoot,
        `${executionHead}:${CurrentStatePath}`,
        'Document-control execution current-state authority'
      ), 'Document-control execution current-state authority'));
      executionDefaultBranch = executionSpec.resolver.defaultBranch;
      const executionDefault = shaValue(requireCommand(
        await run('git', ['rev-parse', '--verify', executionSpec.resolver.defaultRef], executionRoot),
        'Document-control execution default'
      ), 'Document-control execution default');
      const executionSurfacePaths = [
        ...compileRepositoryModuleMembership(executionRoot).moduleRoots,
        'package.json',
        'bun.lock'
      ];
      const executionSurfaceStatus = await run('git', [
        'status', '--porcelain=v1', '--untracked-files=all', '--',
        ...executionSurfacePaths
      ], executionRoot);
      if (executionBranch !== 'main' || executionHead !== executionDefault
          || executionSurfaceStatus.code !== 0 || executionSurfaceStatus.stdout.length > 0) {
        throw new Error(
          'Document-control freeze must execute from the clean trusted main control surface; '
          + 'use --workspace to target the isolated candidate.'
        );
      }
    })));

    const requestedWorkspace = realpathSync(path.resolve(workspace));
    const result = await afterPriorTerminalFreezeRetirement(() => observeExecutionProgressPhase('document-control-freeze', 'candidate-authority-and-journal', () => withAuthorityGitReadSession({
      cwd: requestedWorkspace,
      budget: Object.freeze({
        ...FreezeGitReadBudget,
        deadlineMs: remainingFreezeBudget()
      }),
      deadlineAtUnixMs: freezeDeadlineAtUnixMs
    }, (session) => documentControlGitReadScope.run(session, async () => {
      const candidateRoot = path.resolve(requireCommand(
        await run('git', ['rev-parse', '--show-toplevel'], requestedWorkspace),
        'Document-control candidate root'
      ));
      const physicalKey = (value: string) => {
        const resolved = realpathSync(value).replaceAll('\\', '/');
        return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
      };
      const candidateBranch = requireCommand(
        await run('git', ['branch', '--show-current'], candidateRoot),
        'Document-control candidate branch'
      );
      if (physicalKey(candidateRoot) === physicalKey(executionRoot)
          || candidateBranch.length === 0
          || candidateBranch === executionDefaultBranch) {
        throw new Error(
          'Document-control freeze target must be one distinct isolated non-default candidate worktree.'
        );
      }
      return freezeDocumentControlPlaneWithSession({
        cwd: candidateRoot,
        manifestPath,
        reviewedOn,
        proposalOnly: argv.includes('--proposal-only')
      });
    }))));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  throw new Error(usage);
}

if (import.meta.main) {
  enableExecutionProgress();
  await observeExecutionProgressPhase(`document-control-${process.argv[2] ?? 'unknown'}`, 'command', runDocumentControlPlaneCli);
}
