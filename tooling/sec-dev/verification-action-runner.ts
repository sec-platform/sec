/**
 * Minimal local VerificationAction V2 execution coordinator.
 *
 * The coordinator owns physical-start/reuse/join decisions only. It never
 * promotes a journal observation into VerificationResult truth and never
 * invokes trusted CI/dev-runner surfaces.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import {
  createUnwiredVerificationActionEffectProviderV1,
  createVerificationActionCallbackEffectProviderV1,
  executeVerifiedCiActionPlanV1
} from '../../platform/dev-runner/verification-action-executor.ts';
import {
  readGitTreeRevision,
  resolveExactHeadCommit
} from '../../platform/git/objects.ts';
import {
  createDevelopmentCriticalPathStaticClosureV1,
  parseDevelopmentCriticalPathStaticClosureV1,
  type DevelopmentCriticalPathStaticClosureV1
} from '../../platform/shared/development-critical-path-contract.ts';
import { inspectNoFollowDirectoryChainV1 } from '../../platform/shared/physical-no-follow.ts';
import {
  parseCiVerificationActionPlanClosureV1,
  type CiVerificationActionPlanClosureV1,
  type CiVerificationExecutionEnvironmentV2,
  type CiVerificationNormalizedOperationV2
} from '../../platform/shared/verification-action-ci-contract.ts';
import {
  createVerificationActionExecutionBindingV1,
  createVerificationActionPlanClosureV1,
  createVerificationActionTerminalV2,
  encodeVerificationActionDataV2,
  isVerificationActionRunnableV2,
  parseVerificationActionKeyV2,
  parseVerificationActionPlanClosureV1,
  parseVerificationActionPlanV2,
  verificationActionDependsOnChangedInputsV2,
  type VerificationActionDependencyResolutionV2,
  type VerificationActionDependencyStateV2,
  type VerificationActionDependencyV2,
  type VerificationActionEffectCapabilityV1,
  type VerificationActionEffectProviderV1,
  type VerificationActionEvidenceV1,
  type VerificationActionExecutionBindingV1,
  type VerificationActionExecutionBudgetV1,
  type VerificationActionKeyDigest,
  type VerificationActionKeyV2,
  type VerificationActionPlanClosureV1,
  type VerificationActionPlanV2,
  type VerificationActionTerminalV2
} from '../../platform/shared/verification-action-contract.ts';
import {
  analyzeDevelopmentCriticalPathStaticClosureForRepositoryV2,
  assertDevelopmentCriticalPathStaticGenerationCurrentV1,
  consumeDevelopmentCriticalPathStaticAnalysisAuthorityV2,
  readDevelopmentCriticalPathStaticAnalysisAuthorityV2,
  type DevelopmentCriticalPathStaticAnalysisAuthorityV2
} from './development-critical-path.ts';
import { acquireSecRuntimeJournalAuthorityV1 } from './runtime-state-authority.ts';
import {
  createRuntimeStateJournalFileSystemV1,
  type RuntimeStateJournalFileSystemV1
} from './runtime-state-journal-filesystem.ts';
import { resolveSecWorkspaceRuntimeRootsV1 } from './runtime-state-paths.ts';
import {
  acquireVerificationActionClaimV1,
  appendVerificationActionJournalEventV2,
  assertVerificationActionEvidenceJournalBindingV1,
  commitVerificationActionEvidenceTerminalUnderClaimV1,
  publishVerificationActionEvidenceV1,
  publishVerificationActionSettlementV1,
  publishVerificationActionStartReceiptV1,
  publishVerificationActionStaticClosureV1,
  readVerificationActionEvidenceV1,
  readVerificationActionJournalV2,
  readVerificationActionSettlementV1,
  readVerificationActionStaticClosureV1,
  releaseVerificationActionClaimV1,
  renewVerificationActionClaimV1,
  revokeVerificationActionClaimV1,
  type VerificationActionJournalReadbackV2,
  type VerificationActionJournalStateV2
} from './verification-action-journal.ts';

export type VerificationActionRunDispositionV2 = 'executed' | 'joined' | 'reused' | 'blocked';

export interface VerificationActionRunOutcomeV2 {
  readonly actionKey: VerificationActionKeyDigest;
  readonly disposition: VerificationActionRunDispositionV2;
  readonly state: VerificationActionJournalStateV2 | null;
  readonly terminal: VerificationActionTerminalV2 | null;
  readonly evidence: VerificationActionEvidenceV1 | null;
  readonly physicalExecution: boolean;
  readonly reason: string | null;
}

export const LOCAL_VERIFICATION_ACTION_DAG_RESULT_SCHEMA_V2 =
  'sec-local-verification-action-dag-result-v2' as const;

export type LocalVerificationActionDagResultV2 = Readonly<{
  schema: typeof LOCAL_VERIFICATION_ACTION_DAG_RESULT_SCHEMA_V2;
  actionPlanDigest: VerificationActionKeyDigest;
  executionEnvironmentRevision: string;
  status: 'passed' | 'failed' | 'blocked';
  actionResults: readonly VerificationActionRunOutcomeV2[];
  terminalDigest: VerificationActionKeyDigest;
}>;

export type ExecuteLocalVerificationActionDagInputV2 = Readonly<{
  /** Trusted checkout that owns the durable local Action journal. */
  authorityRoot: string;
  /** Detached exact-candidate worktree used only for physical execution. */
  candidateRoot: string;
  actionPlanClosure: CiVerificationActionPlanClosureV1;
  executionEnvironment: CiVerificationExecutionEnvironmentV2;
  environment?: NodeJS.ProcessEnv;
  runner?: VerificationActionRunnerV2;
  recordedAt?: () => string;
  executeNormalizedOperation?: (
    operation: CiVerificationNormalizedOperationV2
  ) => Promise<number> | number;
  inspectRepository: VerificationActionRepositoryInspectorV2;
}>;

export type VerificationActionRepositoryObservationV2 = Readonly<{
  headSha: string;
  headTreeSha: string;
  trackedClean: boolean;
  gitCommonDirectory: string;
}>;

/**
 * Narrow effect capability granted by the outer VerificationSession adapter.
 * The Action coordinator can request one complete repository observation but
 * cannot choose a process, executable, environment, or arbitrary Git argv.
 */
export type VerificationActionRepositoryInspectorV2 = (
  repositoryRoot: string
) => VerificationActionRepositoryObservationV2;

export type VerificationActionStaticAdmissionRequestV1 = Readonly<{
  plan: VerificationActionPlanV2;
  actionPlanClosureDigest: VerificationActionKeyDigest;
  dependencyEvidence?: readonly VerificationActionDependencyResolutionV2[];
}>;

/**
 * Capability boundary between the pure VerificationAction coordinator and the
 * exact-tree static producer. Production wiring derives this capability from
 * the canonical analyzer; pure state-machine tests can provide an in-memory
 * producer without reading Git, Runtime State, or the filesystem.
 *
 * A returned closure is data, not Effect authority. The coordinator still
 * performs exactly one `assertCurrent` immediately before the provider Effect.
 */
export interface VerificationActionStaticAdmissionProviderV1 {
  readonly providerRevision: string;
  derive(input: VerificationActionStaticAdmissionRequestV1): DevelopmentCriticalPathStaticClosureV1;
  assertCurrent(input: Readonly<{
    plan: VerificationActionPlanV2;
    actionPlanClosureDigest: VerificationActionKeyDigest;
    closure: DevelopmentCriticalPathStaticClosureV1;
  }>): void;
}

export type VerificationActionRuntimeStatePortProviderV1 = (
  canonicalRuntimeStateRepositoryRoot: string
) => RuntimeStateJournalFileSystemV1 | Promise<RuntimeStateJournalFileSystemV1>;

export type VerificationActionRepositoryRootIdentityProviderV1 = (
  repositoryRoot: string
) => string;

export type VerificationActionProviderPhaseV1 = 'issue' | 'execute' | 'observe' | 'release';

export interface VerificationActionDeadlinePortV1 {
  run<T>(input: Readonly<{
    phase: VerificationActionProviderPhaseV1;
    timeoutMs: number;
    timeoutError: () => Error;
    run: (signal: AbortSignal) => Promise<T>;
  }>): Promise<T>;
}

export interface VerificationActionExecutionBindingProviderV1 {
  observe(input: Readonly<{
    action: VerificationActionKeyV2;
    actionPlanDigest: VerificationActionKeyDigest;
    actionPlanClosureDigest: VerificationActionKeyDigest;
    closure: DevelopmentCriticalPathStaticClosureV1;
    runtimeStateRepositoryRoot: string;
    staticAuthorityRepositoryRoot: string;
    physicalExecutionRepositoryRoot: string;
    providerRevision: string;
  }>): VerificationActionExecutionBindingV1;
  assertCurrent(binding: VerificationActionExecutionBindingV1): void;
}

export type VerificationActionRunnerOptionsV2 = Readonly<{
  /**
   * Typed state-port transport. Production omits this and acquires canonical
   * no-follow/fsync Runtime State; pure contract tests may inject an in-memory
   * CAS port while exercising the identical journal parser/state machine.
   */
  runtimeStatePortProvider?: VerificationActionRuntimeStatePortProviderV1;
  /** Pure-test identity seam only; production retains physical realpath observation. */
  repositoryRootIdentityProvider?: VerificationActionRepositoryRootIdentityProviderV1;
  /** Scheduling transport only; timeout never proves provider or process-tree settlement. */
  deadlinePort?: VerificationActionDeadlinePortV1;
  /** Test/host port only; production uses exact no-follow/Git root observation. */
  executionBindingProvider?: VerificationActionExecutionBindingProviderV1;
}>;

export interface VerificationActionExecuteInputV2 {
  /** Durable SEC Runtime State authority. It need not contain a Git worktree. */
  readonly runtimeStateRepositoryRoot: string;
  /** Exact immutable Git object/read root used only by the static authority producer. */
  readonly staticAuthorityRepositoryRoot: string;
  /** Canonical root that owns any physical Effect for this invocation. */
  readonly physicalExecutionRepositoryRoot: string;
  readonly action: VerificationActionKeyV2;
  readonly executionDomain?: string;
  /** Stable identity of the physical owner; nested calls inherit it. */
  readonly ownerToken?: string;
  readonly plan?: VerificationActionPlanV2;
  /** Full canonical producer closure; production callers must prove plan membership. */
  readonly actionPlanClosure?: VerificationActionPlanClosureV1;
  /** Canonical producer closure digest; caller-local plan hashing is forbidden. */
  readonly actionPlanClosureDigest?: VerificationActionKeyDigest;
  /** Opaque exact-tree analyzer authority; a serializable DTO cannot authorize Effect. */
  readonly staticAnalysis?: DevelopmentCriticalPathStaticAnalysisAuthorityV2;
  /** Explicit static producer capability; production defaults to the exact-tree analyzer. */
  readonly staticAdmissionProvider?: VerificationActionStaticAdmissionProviderV1;
  /** Provider-issued Effect capability path. Required for production. */
  readonly effectProvider?: VerificationActionEffectProviderV1;
  readonly recordedAt?: () => string;
  readonly leaseDurationMs?: number;
}

type InFlight = Promise<VerificationActionRunOutcomeV2>;
type ExecutionContext = Readonly<{
  ownerToken: string;
  ownerKeys: ReadonlySet<string>;
}>;

// ActionKey remains the semantic identity.  A live flight is ephemeral and is
// additionally scoped to the canonical physical journal/workspace root, so
// two isolated repositories with the same semantic action never join.
const IN_FLIGHT_ACTIONS = new Map<string, InFlight>();
const EXECUTION_CONTEXT = new AsyncLocalStorage<ExecutionContext>();
let ownerSequence = 0;

function canonicalAction(action: unknown): VerificationActionKeyV2 {
  return parseVerificationActionKeyV2(encodeVerificationActionDataV2(action));
}

function boundedError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const sanitized = text.replace(/[\u0000-\u001f]/gu, ' ');
  return `verification action failed: ${sanitized}`.slice(0, 1024);
}

function boundedToken(value: string | undefined, label: string, fallback: () => string): string {
  if (value === undefined) return fallback();
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || /[\u0000-\u001f]/u.test(value)) {
    throw new Error(`${label} must be bounded text.`);
  }
  return value;
}

function nextOwnerToken(): string {
  ownerSequence += 1;
  return `verification-action-owner-${ownerSequence}`;
}

function canonicalPhysicalRepositoryRoot(repositoryRoot: string): string {
  const physicalRoot = realpathSync.native(path.resolve(repositoryRoot));
  return process.platform === 'win32' ? physicalRoot.toLowerCase() : physicalRoot;
}

function observeVerificationActionExecutionBindingV1(input: Readonly<{
  action: VerificationActionKeyV2;
  actionPlanDigest: VerificationActionKeyDigest;
  actionPlanClosureDigest: VerificationActionKeyDigest;
  closure: DevelopmentCriticalPathStaticClosureV1;
  runtimeStateRepositoryRoot: string;
  staticAuthorityRepositoryRoot: string;
  physicalExecutionRepositoryRoot: string;
  providerRevision: string;
}>): VerificationActionExecutionBindingV1 {
  const staticHeadSha = resolveExactHeadCommit(input.staticAuthorityRepositoryRoot);
  const staticHeadTreeSha = readGitTreeRevision(input.staticAuthorityRepositoryRoot);
  if (staticHeadTreeSha === null || staticHeadSha !== input.closure.analysisReadback.repository.headSha
      || staticHeadTreeSha !== input.closure.analysisReadback.repository.headTreeSha) {
    throw new Error('static authority root differs from the admitted exact Git tree.');
  }
  const physicalHeadTreeSha = readGitTreeRevision(input.physicalExecutionRepositoryRoot);
  if (physicalHeadTreeSha === null) {
    throw new Error('physical execution root has no exact Git tree.');
  }
  return createVerificationActionExecutionBindingV1({
    actionKey: input.action.actionKey,
    actionPlanDigest: input.actionPlanDigest,
    actionPlanClosureDigest: input.actionPlanClosureDigest,
    staticClosureDigest: input.closure.closureDigest,
    staticGenerationDigest: input.closure.analysisReadback.staticGeneration.generationDigest,
    runtimeStateRoot: inspectNoFollowDirectoryChainV1(
      input.runtimeStateRepositoryRoot,
      'VerificationAction Runtime State root'
    ).target,
    staticAuthorityRoot: {
      physical: inspectNoFollowDirectoryChainV1(
        input.staticAuthorityRepositoryRoot,
        'VerificationAction static authority root'
      ).target,
      headSha: staticHeadSha,
      headTreeSha: staticHeadTreeSha
    },
    physicalExecutionRoot: {
      physical: inspectNoFollowDirectoryChainV1(
        input.physicalExecutionRepositoryRoot,
        'VerificationAction physical execution root'
      ).target,
      headSha: resolveExactHeadCommit(input.physicalExecutionRepositoryRoot),
      headTreeSha: physicalHeadTreeSha
    },
    providerRevision: input.providerRevision
  });
}

function assertVerificationActionExecutionBindingCurrentV1(
  binding: VerificationActionExecutionBindingV1
): void {
  const assertPhysical = (
    expected: VerificationActionExecutionBindingV1['runtimeStateRoot'],
    label: string
  ): void => {
    const current = inspectNoFollowDirectoryChainV1(expected.path, label).target;
    if (encodeVerificationActionDataV2(current) !== encodeVerificationActionDataV2(expected)) {
      throw new Error(`${label} physical identity changed.`);
    }
  };
  assertPhysical(binding.runtimeStateRoot, 'VerificationAction Runtime State root');
  assertPhysical(binding.staticAuthorityRoot.physical, 'VerificationAction static authority root');
  assertPhysical(binding.physicalExecutionRoot.physical, 'VerificationAction physical execution root');
  if (resolveExactHeadCommit(binding.staticAuthorityRoot.physical.path) !== binding.staticAuthorityRoot.headSha
      || readGitTreeRevision(binding.staticAuthorityRoot.physical.path) !== binding.staticAuthorityRoot.headTreeSha) {
    throw new Error('VerificationAction static authority Git identity changed.');
  }
  if (resolveExactHeadCommit(binding.physicalExecutionRoot.physical.path) !== binding.physicalExecutionRoot.headSha
      || readGitTreeRevision(binding.physicalExecutionRoot.physical.path) !== binding.physicalExecutionRoot.headTreeSha) {
    throw new Error('VerificationAction physical execution Git identity changed.');
  }
}

function localDagDigest(value: unknown): VerificationActionKeyDigest {
  return `sha256:${createHash('sha256').update(encodeVerificationActionDataV2(value)).digest('hex')}`;
}

function exactTreeStaticAdmissionProviderV1(input: Readonly<{
  repositoryRoot: string;
  staticAnalysis?: DevelopmentCriticalPathStaticAnalysisAuthorityV2;
}>): VerificationActionStaticAdmissionProviderV1 {
  let authority = input.staticAnalysis;
  const authorityFor = (
    plan: VerificationActionPlanV2,
    actionPlanClosureDigest: VerificationActionKeyDigest
  ): DevelopmentCriticalPathStaticAnalysisAuthorityV2 => {
    authority ??= analyzeDevelopmentCriticalPathStaticClosureForRepositoryV2({
      repositoryRoot: input.repositoryRoot,
      plan,
      actionPlanClosureDigest,
      manifestPath: plan.action.inputClosure.find(({ path: inputPath }) =>
        inputPath.startsWith('docs/work-packages/') && inputPath.endsWith('.md'))?.path
    });
    return authority;
  };
  return Object.freeze({
    providerRevision: 'sec-development-critical-path-static-admission-provider-v1',
    derive(request: VerificationActionStaticAdmissionRequestV1) {
      const readback = readDevelopmentCriticalPathStaticAnalysisAuthorityV2(
        authorityFor(request.plan, request.actionPlanClosureDigest),
        {
          plan: request.plan,
          expectedActionPlanClosureDigest: request.actionPlanClosureDigest
        }
      );
      return createDevelopmentCriticalPathStaticClosureV1(
        request.plan,
        readback,
        request.actionPlanClosureDigest,
        request.dependencyEvidence
      );
    },
    assertCurrent(request: Parameters<VerificationActionStaticAdmissionProviderV1['assertCurrent']>[0]) {
      const readback = consumeDevelopmentCriticalPathStaticAnalysisAuthorityV2(
        authorityFor(request.plan, request.actionPlanClosureDigest),
        {
          plan: request.plan,
          expectedActionPlanClosureDigest: request.actionPlanClosureDigest
        }
      );
      if (readback.staticGeneration.generationDigest !==
          request.closure.analysisReadback.staticGeneration.generationDigest) {
        throw new Error('static generation changed before Effect.');
      }
    }
  });
}

function durableStaticAdmissionProviderV1(input: Readonly<{
  repositoryRoot: string;
  closure: DevelopmentCriticalPathStaticClosureV1;
}>): VerificationActionStaticAdmissionProviderV1 {
  const retained = parseDevelopmentCriticalPathStaticClosureV1(input.closure);
  return Object.freeze({
    providerRevision: 'sec-development-critical-path-durable-static-admission-v1',
    derive(request: VerificationActionStaticAdmissionRequestV1) {
      const actionPlanDigest = localDagDigest(request.plan);
      if (retained.actionKey !== request.plan.action.actionKey
          || retained.actionPlanDigest !== actionPlanDigest
          || retained.analysisReadback.actionPlanClosureDigest !== request.actionPlanClosureDigest) {
        throw new Error('durable static admission does not bind the requested canonical Action plan.');
      }
      return createDevelopmentCriticalPathStaticClosureV1(
        request.plan,
        retained.analysisReadback,
        request.actionPlanClosureDigest,
        request.dependencyEvidence
      );
    },
    assertCurrent(request: Parameters<VerificationActionStaticAdmissionProviderV1['assertCurrent']>[0]) {
      if (request.closure.analysisReadback.staticGeneration.generationDigest !==
          retained.analysisReadback.staticGeneration.generationDigest) {
        throw new Error('durable Action admission changed static generation before Effect.');
      }
      assertDevelopmentCriticalPathStaticGenerationCurrentV1(
        retained.analysisReadback.staticGeneration,
        input.repositoryRoot
      );
    }
  });
}

function resolveDependency(
  fs: RuntimeStateJournalFileSystemV1,
  dependency: VerificationActionDependencyV2
): VerificationActionDependencyResolutionV2 {
  const journal = readVerificationActionJournalV2(fs, dependency.actionKey);
  // A cheap-preflight dependency is a root gate. Its own producer-owned
  // topology must not require another cheap preflight, independent of lane
  // or cost policy.
  if (dependency.kind === 'cheap-preflight' &&
    journal.action !== null && journal.action.requiredCheapPreflightActionKeys.length > 0) {
    return {
      actionKey: dependency.actionKey,
      state: 'unknown',
      observationDigest: journal.events.at(-1)?.eventDigest ?? null
    };
  }
  let state: VerificationActionDependencyStateV2;
  switch (journal.latestState) {
    case null:
      state = 'unknown';
      break;
    case 'queued':
      state = 'queued';
      break;
    case 'running':
      state = 'running';
      break;
    case 'invalidated':
      state = 'invalidated';
      break;
    case 'cancelled':
      state = 'cancelled';
      break;
    case 'terminal':
    case 'reused':
      switch (journal.terminal?.status) {
        case 'passed':
          state = 'terminal-passed';
          break;
        case 'failed':
          state = 'terminal-failed';
          break;
        case 'not-run':
          state = 'not-run';
          break;
        case 'unsupported':
          state = 'unsupported';
          break;
        case 'invalidated':
          state = 'invalidated';
          break;
        default:
          state = 'unknown';
          break;
      }
      break;
  }
  return {
    actionKey: dependency.actionKey,
    state,
    observationDigest: journal.events.at(-1)?.eventDigest ?? null
  };
}

function resolveDependencyStates(
  fs: RuntimeStateJournalFileSystemV1,
  plan: VerificationActionPlanV2
): readonly VerificationActionDependencyResolutionV2[] {
  return Object.freeze(plan.dependencies.map((dependency) => Object.freeze(
    resolveDependency(fs, dependency)
  )));
}

function dependencyClosureUnchanged(
  before: readonly VerificationActionDependencyResolutionV2[],
  after: readonly VerificationActionDependencyResolutionV2[]
): boolean {
  if (before.length !== after.length) return false;
  return before.every((entry, index) => {
    const candidate = after[index];
    return candidate !== undefined && candidate.actionKey === entry.actionKey &&
      candidate.state === entry.state &&
      (candidate.observationDigest ?? null) === (entry.observationDigest ?? null);
  });
}

function outcome(
  actionKey: VerificationActionKeyDigest,
  disposition: VerificationActionRunDispositionV2,
  state: VerificationActionJournalStateV2 | null,
  terminal: VerificationActionTerminalV2 | null,
  physicalExecution: boolean,
  reason: string | null,
  evidence: VerificationActionEvidenceV1 | null = null
): VerificationActionRunOutcomeV2 {
  return Object.freeze({
    actionKey,
    disposition,
    state,
    terminal,
    evidence,
    physicalExecution,
    reason: reason === null ? null : reason.slice(0, 1024)
  });
}

const REAL_VERIFICATION_ACTION_DEADLINE_PORT_V1: VerificationActionDeadlinePortV1 = Object.freeze({
  async run<T>(input: Readonly<{
    phase: VerificationActionProviderPhaseV1;
    timeoutMs: number;
    timeoutError: () => Error;
    run: (signal: AbortSignal) => Promise<T>;
  }>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = input.timeoutError();
        controller.abort(error);
        reject(error);
      }, input.timeoutMs);
    });
    try {
      return await Promise.race([input.run(controller.signal), deadline]);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }
});

function runProviderPhaseWithDeadlineV1<T>(
  deadlinePort: VerificationActionDeadlinePortV1,
  input: Readonly<{
    phase: 'issue' | 'observe' | 'release';
    timeoutMs: number;
    run: (signal: AbortSignal) => Promise<T>;
  }>
): Promise<T> {
  return deadlinePort.run({
    ...input,
    timeoutError: () => new Error(
      `VerificationAction provider ${input.phase} exceeded its phase budget of ${input.timeoutMs}ms.`
    )
  });
}

async function reconcileTerminalEvidenceV1(input: Readonly<{
  provider: VerificationActionEffectProviderV1;
  journal: VerificationActionJournalReadbackV2;
  fs: RuntimeStateJournalFileSystemV1;
  actionKey: VerificationActionKeyDigest;
  actionPlanDigest: VerificationActionKeyDigest;
  executionBindingDigest: VerificationActionKeyDigest;
  staticClosureDigest: VerificationActionKeyDigest;
  budget: VerificationActionExecutionBudgetV1;
  deadlinePort: VerificationActionDeadlinePortV1;
}>): Promise<Readonly<{ evidence: VerificationActionEvidenceV1 | null; reason: string | null }>> {
  try {
    const evidence = assertVerificationActionEvidenceJournalBindingV1({
      journal: input.journal,
      actionKey: input.actionKey,
      actionPlanDigest: input.actionPlanDigest,
      executionBindingDigest: input.executionBindingDigest,
      staticClosureDigest: input.staticClosureDigest
    });
    const settled = readVerificationActionSettlementV1(input.fs, input.actionKey);
    if (settled?.state === 'settled') {
      if (settled.evidenceDigest !== evidence.evidenceDigest
          || settled.executionBindingDigest !== evidence.executionBindingDigest
          || settled.providerRevision !== evidence.providerRevision) {
        return Object.freeze({
          evidence: null,
          reason: 'verification-action-settled-evidence-binding-mismatch'
        });
      }
      return Object.freeze({ evidence, reason: null });
    }
    publishVerificationActionSettlementV1({
      fs: input.fs,
      evidence,
      phase: 'observe',
      state: 'pending',
      reasonCode: 'provider-observation-pending',
      detail: 'awaiting exact provider Evidence observation',
      observedAt: new Date().toISOString()
    });
    const observed = await runProviderPhaseWithDeadlineV1(input.deadlinePort, {
      phase: 'observe',
      timeoutMs: input.budget.evidenceObservationTimeoutMs,
      run: (signal) => input.provider.observe({
        actionKey: input.actionKey,
        actionPlanDigest: input.actionPlanDigest,
        executionBindingDigest: input.executionBindingDigest,
        staticClosureDigest: input.staticClosureDigest,
        readPublishedEvidence: async () => readVerificationActionEvidenceV1(input.fs, input.actionKey),
        signal
      })
    });
    if (observed === null) {
      return Object.freeze({ evidence: null, reason: 'verification-action-evidence-provider-observation-missing' });
    }
    if (observed.evidenceDigest !== evidence.evidenceDigest ||
        encodeVerificationActionDataV2(observed) !== encodeVerificationActionDataV2(evidence)) {
      return Object.freeze({ evidence: null, reason: 'verification-action-evidence-provider-observation-mismatch' });
    }
    return Object.freeze({ evidence, reason: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (input.journal.evidence !== null && input.journal.evidence !== undefined) {
      try {
        publishVerificationActionSettlementV1({
          fs: input.fs,
          evidence: input.journal.evidence,
          phase: 'observe',
          state: 'pending',
          reasonCode: 'provider-observation-failed',
          detail: message,
          observedAt: new Date().toISOString()
        });
      } catch { /* preserve the original reconciliation failure */ }
    }
    return Object.freeze({
      evidence: null,
      reason: `verification-action-evidence-reconcile-failed: ${message.slice(0, 512)}`
    });
  }
}

async function settleObservedProviderEvidenceV1(input: Readonly<{
  provider: VerificationActionEffectProviderV1;
  fs: RuntimeStateJournalFileSystemV1;
  action: VerificationActionKeyV2;
  capability?: VerificationActionEffectCapabilityV1 | null;
  evidence: VerificationActionEvidenceV1;
  budget: VerificationActionExecutionBudgetV1;
  deadlinePort: VerificationActionDeadlinePortV1;
}>): Promise<string | null> {
  try {
    const settled = readVerificationActionSettlementV1(input.fs, input.evidence.actionKey);
    if (settled?.state === 'settled') {
      return settled.evidenceDigest === input.evidence.evidenceDigest
          && settled.executionBindingDigest === input.evidence.executionBindingDigest
          && settled.providerRevision === input.evidence.providerRevision
        ? null
        : 'verification-action-provider-settlement-binding-mismatch';
    }
    publishVerificationActionSettlementV1({
      fs: input.fs,
      evidence: input.evidence,
      phase: 'release',
      state: 'pending',
      reasonCode: 'provider-release-pending',
      detail: 'awaiting provider resource release',
      observedAt: new Date().toISOString()
    });
    await runProviderPhaseWithDeadlineV1(input.deadlinePort, {
      phase: 'release',
      timeoutMs: input.budget.providerReleaseTimeoutMs,
      run: (signal) => input.provider.release({
        action: input.action,
        capability: input.capability ?? null,
        evidence: input.evidence,
        signal
      })
    });
    publishVerificationActionSettlementV1({
      fs: input.fs,
      evidence: input.evidence,
      phase: 'complete',
      state: 'settled',
      reasonCode: 'settled',
      detail: 'provider Evidence observed and resources released',
      observedAt: new Date().toISOString()
    });
    return null;
  } catch (error) {
    try {
      publishVerificationActionSettlementV1({
        fs: input.fs,
        evidence: input.evidence,
        phase: 'release',
        state: 'pending',
        reasonCode: 'provider-release-failed',
        detail: boundedError(error),
        observedAt: new Date().toISOString()
      });
    } catch { /* keep the provider failure as the primary outcome */ }
    return `verification-action-provider-settlement-failed: ${boundedError(error)}`;
  }
}

function terminalSettlementPendingReasonV1(reason: string): string {
  return reason.startsWith('terminal-settlement-pending:')
    ? reason
    : `terminal-settlement-pending: ${reason}`;
}

function staticClosureAdmissionAllowedV1(
  closure: DevelopmentCriticalPathStaticClosureV1,
  plan: VerificationActionPlanV2,
  actionPlanDigest: VerificationActionKeyDigest
): boolean {
  if (closure.status === 'blocked' || closure.actionKey !== plan.action.actionKey ||
      closure.actionPlanDigest !== actionPlanDigest ||
      closure.analysisReadback.actionKey !== plan.action.actionKey ||
      closure.analysisReadback.actionPlanDigest !== actionPlanDigest ||
      closure.analysisReadback.repository.trackedClean !== true ||
      closure.analysisReadback.producer.identity !== 'tooling/sec-dev/development-critical-path.ts') {
    return false;
  }
  // Proof policy is part of ActionKey identity.  Never derive the required
  // strength from the closure itself: doing so would let a producer issue a
  // weaker bounded key and have it accepted merely because that closure is
  // internally self-consistent.  The analyzer must satisfy the policy the
  // producer committed to when constructing this exact ActionKey.
  const requiredKind = plan.action.staticProofRequirement === 'required-producer-bound'
    ? 'required'
    : 'bounded-action-admission';
  return closure.proofScope.kind === requiredKind &&
    closure.analysisReadback.proofScope.kind === requiredKind &&
    (requiredKind === 'required'
      ? closure.status === 'required-closed'
      : closure.status === 'bounded-closed');
}

function staticClosureBlockedReasonV1(
  prefix: 'pre-effect-static-closure-blocked' | 'effect-admission-static-closure-blocked',
  closure: DevelopmentCriticalPathStaticClosureV1,
  dependencyReason: string | null = null
): string {
  const missingEdges = closure.unknowns
    .map((unknown) => unknown.missingEdge)
    .filter((entry, index, values) => values.indexOf(entry) === index)
    .slice(0, 4);
  const detail = Object.freeze({
    status: closure.status,
    proofScope: closure.proofScope,
    openDefectClasses: closure.openDefectClasses.slice(0, 4),
    unresolvedModules: closure.analysisReadback.unresolvedModuleFiles.slice(0, 4),
    missingEdges,
    unknownCount: closure.unknowns.length,
    dependencyReason
  });
  return `${prefix}: ${encodeVerificationActionDataV2(detail)}`.slice(0, 1024);
}





export class VerificationActionRunnerV2 {
  readonly #journalFileSystemPromises = new Map<string, Promise<RuntimeStateJournalFileSystemV1>>();
  readonly #journalFileSystems = new Map<string, RuntimeStateJournalFileSystemV1>();
  readonly #runtimeStatePortProvider: VerificationActionRuntimeStatePortProviderV1 | undefined;
  readonly #executionBindingProvider: VerificationActionExecutionBindingProviderV1 | undefined;
  readonly #repositoryRootIdentityProvider: VerificationActionRepositoryRootIdentityProviderV1;
  readonly #deadlinePort: VerificationActionDeadlinePortV1;

  constructor(options: VerificationActionRunnerOptionsV2 = {}) {
    this.#runtimeStatePortProvider = options.runtimeStatePortProvider;
    this.#executionBindingProvider = options.executionBindingProvider;
    this.#repositoryRootIdentityProvider = options.repositoryRootIdentityProvider
      ?? canonicalPhysicalRepositoryRoot;
    this.#deadlinePort = options.deadlinePort ?? REAL_VERIFICATION_ACTION_DEADLINE_PORT_V1;
  }

  async #journalFileSystem(repositoryRoot: string): Promise<RuntimeStateJournalFileSystemV1> {
    const physicalRoot = this.#repositoryRootIdentityProvider(repositoryRoot);
    let pending = this.#journalFileSystemPromises.get(physicalRoot);
    if (pending === undefined) {
      pending = (this.#runtimeStatePortProvider === undefined ? (async () => {
        const authority = await acquireSecRuntimeJournalAuthorityV1({ repositoryRoot: physicalRoot });
        await authority.assertCurrent();
        const roots = resolveSecWorkspaceRuntimeRootsV1({ repositoryRoot: physicalRoot });
        const fs = createRuntimeStateJournalFileSystemV1(
          authority.directory(roots.workspaceStateRoot)
        );
        this.#journalFileSystems.set(physicalRoot, fs);
        return fs;
      })() : Promise.resolve(this.#runtimeStatePortProvider(physicalRoot)).then((fs) => {
        this.#journalFileSystems.set(physicalRoot, fs);
        return fs;
      })).catch((error) => {
        this.#journalFileSystemPromises.delete(physicalRoot);
        this.#journalFileSystems.delete(physicalRoot);
        throw error;
      });
      this.#journalFileSystemPromises.set(physicalRoot, pending);
    }
    return pending;
  }

  #retainedJournalFileSystem(repositoryRoot: string): RuntimeStateJournalFileSystemV1 {
    const physicalRoot = this.#repositoryRootIdentityProvider(repositoryRoot);
    const fs = this.#journalFileSystems.get(physicalRoot);
    if (fs === undefined) {
      throw new Error('VerificationAction journal authority must be acquired before synchronous mutation.');
    }
    return fs;
  }

  async execute(input: VerificationActionExecuteInputV2): Promise<VerificationActionRunOutcomeV2> {
    const action = canonicalAction(input.action);
    const runtimeStateRepositoryRoot = this.#repositoryRootIdentityProvider(input.runtimeStateRepositoryRoot);
    const staticAuthorityRepositoryRoot = this.#repositoryRootIdentityProvider(
      input.staticAuthorityRepositoryRoot
    );
    const physicalExecutionRepositoryRoot = this.#repositoryRootIdentityProvider(
      input.physicalExecutionRepositoryRoot
    );
    boundedToken(input.executionDomain, 'executionDomain', () => 'process');
    const inheritedContext = EXECUTION_CONTEXT.getStore();
    if (inheritedContext !== undefined && input.ownerToken !== undefined &&
      input.ownerToken !== inheritedContext.ownerToken) {
      throw new Error('ownerToken cannot override the inherited execution owner.');
    }
    const ownerToken = boundedToken(
      inheritedContext?.ownerToken ?? input.ownerToken,
      'ownerToken',
      nextOwnerToken
    );
    const ownerKeys = inheritedContext?.ownerKeys;
    if (input.plan === undefined) {
      return outcome(
        action.actionKey,
        'blocked',
        null,
        null,
        false,
        'explicit action plan required; scheduler lane and dependency topology are mandatory'
      );
    }
    const plan = parseVerificationActionPlanV2(encodeVerificationActionDataV2(input.plan));
    let expectedActionPlanClosureDigest = input.actionPlanClosureDigest;
    if (input.actionPlanClosure !== undefined) {
      const producerClosure = parseVerificationActionPlanClosureV1(
        encodeVerificationActionDataV2(input.actionPlanClosure)
      );
      const matchingPlan = producerClosure.plans.find(({ action: member }) =>
        member.actionKey === action.actionKey
      );
      if (matchingPlan === undefined || encodeVerificationActionDataV2(matchingPlan) !==
          encodeVerificationActionDataV2(plan)) {
        return outcome(action.actionKey, 'blocked', null, null, false,
          'canonical action plan closure does not contain the exact requested Action plan');
      }
      if (expectedActionPlanClosureDigest !== undefined &&
          expectedActionPlanClosureDigest !== producerClosure.closureDigest) {
        return outcome(action.actionKey, 'blocked', null, null, false,
          'caller action plan closure digest differs from canonical producer closure');
      }
      expectedActionPlanClosureDigest = producerClosure.closureDigest;
    }
    if (expectedActionPlanClosureDigest === undefined ||
        (input.actionPlanClosure === undefined && input.staticAdmissionProvider === undefined
          && input.staticAnalysis === undefined)) {
      return outcome(
        action.actionKey,
        'blocked',
        null,
        null,
        false,
        'full canonical action plan closure required; digest-only production admission is forbidden'
      );
    }
    if (plan.action.actionKey !== action.actionKey) {
      throw new Error('VerificationAction plan action key does not match execution action.');
    }
    const actionPlanDigest = localDagDigest(plan);
    const journalFs = await this.#journalFileSystem(runtimeStateRepositoryRoot);
    if (input.staticAdmissionProvider !== undefined && input.staticAnalysis !== undefined) {
      throw new Error('staticAdmissionProvider and legacy staticAnalysis authority are mutually exclusive.');
    }
    let durableClosure: DevelopmentCriticalPathStaticClosureV1 | null = null;
    if (input.staticAdmissionProvider === undefined && input.staticAnalysis === undefined) {
      try {
        durableClosure = readVerificationActionStaticClosureV1(journalFs, action.actionKey);
      } catch (error) {
        return outcome(action.actionKey, 'blocked', null, null, false,
          `durable-static-admission-invalid: ${boundedError(error)}`);
      }
      if (durableClosure !== null &&
          (durableClosure.actionPlanDigest !== actionPlanDigest ||
           durableClosure.analysisReadback.actionPlanClosureDigest !== expectedActionPlanClosureDigest)) {
        return outcome(action.actionKey, 'blocked', null, null, false,
          'durable-static-admission-conflict: current Action pointer binds a different producer closure');
      }
    }
    const staticAdmissionProvider = input.staticAdmissionProvider ??
      (durableClosure === null
        ? exactTreeStaticAdmissionProviderV1({
            repositoryRoot: staticAuthorityRepositoryRoot,
            staticAnalysis: input.staticAnalysis
          })
        : durableStaticAdmissionProviderV1({
            repositoryRoot: staticAuthorityRepositoryRoot,
            closure: durableClosure
          }));
    boundedToken(staticAdmissionProvider.providerRevision, 'static admission providerRevision', () => {
      throw new Error('static admission providerRevision is required.');
    });
    // This is the one physical-start admission boundary for local, hosted and
    // trusted-runtime callers. The pure composer verifies the externally
    // observed exact-tree census before Runtime State mutation or domain Effect.
    let staticClosure;
    try {
      staticClosure = parseDevelopmentCriticalPathStaticClosureV1(
        staticAdmissionProvider.derive({
          plan,
          actionPlanClosureDigest: expectedActionPlanClosureDigest
        })
      );
    } catch (error) {
      const detail = boundedError(error);
      return outcome(
        action.actionKey,
        'blocked',
        null,
        null,
        false,
        detail.includes('not issued by the exact-tree analyzer')
          ? `static-closure-provenance-missing: ${detail}`
          : `pre-effect-static-closure-invalid: ${detail}`
      );
    }
    if (staticClosure.analysisReadback.actionPlanClosureDigest !== expectedActionPlanClosureDigest ||
        !staticClosureAdmissionAllowedV1(staticClosure, plan, localDagDigest(plan))) {
      return outcome(
        action.actionKey,
        'blocked',
        null,
        null,
        false,
        staticClosureBlockedReasonV1('pre-effect-static-closure-blocked', staticClosure)
      );
    }
    const effectProvider = input.effectProvider ?? createUnwiredVerificationActionEffectProviderV1();
    if (effectProvider.providerRevision === 'unwired') {
      return outcome(
        action.actionKey,
        'blocked',
        null,
        null,
        false,
        'verification-effect-provider-unwired: A0 must wire a provider-issued Effect capability'
      );
    }
    if (effectProvider.providerRevision !== action.environment.providerRevision) {
      return outcome(
        action.actionKey,
        'blocked',
        null,
        null,
        false,
        'verification-effect-provider-revision-mismatch'
      );
    }
    const beforeDependencies = resolveDependencyStates(journalFs, plan);
    const runnable = isVerificationActionRunnableV2(plan, beforeDependencies);
    let effectAdmissionClosure;
    try {
      effectAdmissionClosure = parseDevelopmentCriticalPathStaticClosureV1(
        staticAdmissionProvider.derive({
          plan,
          actionPlanClosureDigest: expectedActionPlanClosureDigest,
          dependencyEvidence: beforeDependencies
        })
      );
    } catch (error) {
      const detail = boundedError(error);
      return outcome(action.actionKey, 'blocked', null, null, false,
        detail.includes('not issued by the exact-tree analyzer')
          ? `static-closure-provenance-missing: ${detail}`
          : `pre-effect-static-closure-stale: ${detail}`);
    }
    if (effectAdmissionClosure.analysisReadback.actionPlanClosureDigest !== expectedActionPlanClosureDigest ||
        !staticClosureAdmissionAllowedV1(effectAdmissionClosure, plan, localDagDigest(plan))) {
      return outcome(
        action.actionKey,
        'blocked',
        null,
        null,
        false,
        staticClosureBlockedReasonV1(
          'effect-admission-static-closure-blocked',
          effectAdmissionClosure,
          runnable.reason
        )
      );
    }
    if (!runnable.runnable) {
      return outcome(action.actionKey, 'blocked', null, null, false, runnable.reason);
    }
    let executionBinding: VerificationActionExecutionBindingV1;
    try {
      const bindingInput = {
        action,
        actionPlanDigest,
        actionPlanClosureDigest: expectedActionPlanClosureDigest,
        closure: effectAdmissionClosure,
        runtimeStateRepositoryRoot,
        staticAuthorityRepositoryRoot,
        physicalExecutionRepositoryRoot,
        providerRevision: effectProvider.providerRevision
      } as const;
      executionBinding = this.#executionBindingProvider?.observe(bindingInput)
        ?? observeVerificationActionExecutionBindingV1(bindingInput);
    } catch (error) {
      return outcome(action.actionKey, 'blocked', null, null, false,
        `verification-action-execution-binding-invalid: ${boundedError(error)}`);
    }
    const flightKey = executionBinding.bindingDigest;
    const ownerKey = `${ownerToken}\0${flightKey}`;
    if (ownerKeys?.has(ownerKey) && IN_FLIGHT_ACTIONS.has(flightKey)) {
      return outcome(
        action.actionKey,
        'blocked',
        'running',
        null,
        false,
        'reentrant-cycle: same execution owner cannot await its own live action'
      );
    }
    const publishedStaticClosure = publishVerificationActionStaticClosureV1({
      fs: journalFs,
      closure: effectAdmissionClosure
    });
    if (publishedStaticClosure.closureDigest !== effectAdmissionClosure.closureDigest) {
      return outcome(action.actionKey, 'blocked', null, null, false,
        'pre-effect-static-closure-blocked: durable readback differs');
    }

    // Plan authorization is caller-local. A non-runnable caller must not join
    // an already-running action and inherit a terminal projection it lacks.
    const existingFlight = IN_FLIGHT_ACTIONS.get(flightKey);
    if (existingFlight !== undefined) {
      const joined = await existingFlight;
      let currentStaticClosure: ReturnType<typeof readVerificationActionStaticClosureV1>;
      try {
        currentStaticClosure = readVerificationActionStaticClosureV1(journalFs, action.actionKey);
      } catch (error) {
        return outcome(action.actionKey, 'blocked', null, null, false,
          `joined action authority changed while awaiting: ${boundedError(error)}`);
      }
      if (currentStaticClosure === null ||
          currentStaticClosure.closureDigest !== effectAdmissionClosure.closureDigest) {
        return outcome(action.actionKey, 'blocked', null, null, false,
          'joined action static closure changed while awaiting');
      }
      const currentDependencies = resolveDependencyStates(journalFs, plan);
      const currentRunnable = isVerificationActionRunnableV2(plan, currentDependencies);
      if (!currentRunnable.runnable) {
        return outcome(action.actionKey, 'blocked', null, null, false,
          `joined action dependency closure changed while awaiting: ${currentRunnable.reason}`);
      }
      const currentJournal = readVerificationActionJournalV2(journalFs, action.actionKey);
      if ((currentJournal.latestState !== 'terminal' && currentJournal.latestState !== 'reused') ||
          currentJournal.terminal === null) {
        return outcome(action.actionKey, 'blocked', currentJournal.latestState, null, false,
          `joined action has no current terminal after await${joined.reason === null ? '' : `: ${joined.reason}`}`);
      }
      if (joined.terminal !== null &&
          encodeVerificationActionDataV2(joined.terminal) !==
            encodeVerificationActionDataV2(currentJournal.terminal)) {
        return outcome(action.actionKey, 'blocked', currentJournal.latestState, null, false,
          'joined action terminal changed while awaiting');
      }
      const joinedEvidence = await reconcileTerminalEvidenceV1({
        provider: effectProvider,
        journal: currentJournal,
        fs: journalFs,
        actionKey: action.actionKey,
        actionPlanDigest,
        executionBindingDigest: executionBinding.bindingDigest,
        staticClosureDigest: effectAdmissionClosure.closureDigest,
        budget: action.environment.executionBudget,
        deadlinePort: this.#deadlinePort
      });
      if (joinedEvidence.reason !== null) {
        return outcome(action.actionKey, 'blocked', currentJournal.latestState, null, false, joinedEvidence.reason);
      }
      if (joinedEvidence.evidence === null) {
        return outcome(action.actionKey, 'blocked', currentJournal.latestState, null, false,
          'verification-action-evidence-reconcile-failed');
      }
      const joinedSettlementFailure = await settleObservedProviderEvidenceV1({
        provider: effectProvider,
        fs: journalFs,
        action,
        evidence: joinedEvidence.evidence,
        budget: action.environment.executionBudget,
        deadlinePort: this.#deadlinePort
      });
      if (joinedSettlementFailure !== null) {
        return outcome(action.actionKey, 'blocked', currentJournal.latestState, currentJournal.terminal, false,
          terminalSettlementPendingReasonV1(joinedSettlementFailure), joinedEvidence.evidence);
      }
      return outcome(
        action.actionKey,
        'joined',
        currentJournal.latestState,
        currentJournal.terminal,
        false,
        currentJournal.terminal.status === 'failed'
          ? 'known joined terminal failure; never projected as PASS'
          : null,
        joinedEvidence.evidence
      );
    }

    const claim = acquireVerificationActionClaimV1({
      fs: journalFs,
      action,
      ownerToken,
      now: input.recordedAt?.() ?? new Date().toISOString(),
      leaseDurationMs: input.leaseDurationMs
    });
    if (claim.disposition === 'terminal') {
      const terminalJournal = readVerificationActionJournalV2(journalFs, action.actionKey);
      const terminalEvidence = await reconcileTerminalEvidenceV1({
        provider: effectProvider,
        journal: terminalJournal,
        fs: journalFs,
        actionKey: action.actionKey,
        actionPlanDigest,
        executionBindingDigest: executionBinding.bindingDigest,
        staticClosureDigest: effectAdmissionClosure.closureDigest,
        budget: action.environment.executionBudget,
        deadlinePort: this.#deadlinePort
      });
      if (terminalEvidence.reason !== null || terminalEvidence.evidence === null) {
        return outcome(action.actionKey, 'blocked', terminalJournal.latestState, null, false,
          terminalEvidence.reason ?? 'verification-action-evidence-reconcile-failed');
      }
      const terminalSettlementFailure = await settleObservedProviderEvidenceV1({
        provider: effectProvider,
        fs: journalFs,
        action,
        evidence: terminalEvidence.evidence,
        budget: action.environment.executionBudget,
        deadlinePort: this.#deadlinePort
      });
      if (terminalSettlementFailure !== null) {
        return outcome(action.actionKey, 'blocked', terminalJournal.latestState, terminalJournal.terminal, false,
          terminalSettlementPendingReasonV1(terminalSettlementFailure), terminalEvidence.evidence);
      }
      return outcome(action.actionKey, 'reused', 'reused', claim.terminal, false,
        claim.terminal?.status === 'failed' ? 'known terminal failure reused; never projected as PASS' : null,
        terminalEvidence.evidence);
    }
    if (claim.disposition === 'joined') {
      const joinedJournal = readVerificationActionJournalV2(journalFs, action.actionKey);
      if (joinedJournal.latestState !== 'terminal' && joinedJournal.latestState !== 'reused') {
        return outcome(action.actionKey, 'blocked', joinedJournal.latestState, null, false,
          'verification-action-reconcile-required-before-join');
      }
      const joinedEvidence = await reconcileTerminalEvidenceV1({
        provider: effectProvider,
        journal: joinedJournal,
        fs: journalFs,
        actionKey: action.actionKey,
        actionPlanDigest,
        executionBindingDigest: executionBinding.bindingDigest,
        staticClosureDigest: effectAdmissionClosure.closureDigest,
        budget: action.environment.executionBudget,
        deadlinePort: this.#deadlinePort
      });
      if (joinedEvidence.reason !== null || joinedEvidence.evidence === null || joinedJournal.terminal === null) {
        return outcome(action.actionKey, 'blocked', joinedJournal.latestState, null, false,
          joinedEvidence.reason ?? 'verification-action-reconcile-failed');
      }
      const joinedSettlementFailure = await settleObservedProviderEvidenceV1({
        provider: effectProvider,
        fs: journalFs,
        action,
        evidence: joinedEvidence.evidence,
        budget: action.environment.executionBudget,
        deadlinePort: this.#deadlinePort
      });
      if (joinedSettlementFailure !== null) {
        return outcome(action.actionKey, 'blocked', joinedJournal.latestState, joinedJournal.terminal, false,
          terminalSettlementPendingReasonV1(joinedSettlementFailure), joinedEvidence.evidence);
      }
      return outcome(action.actionKey, 'joined', joinedJournal.latestState,
        joinedJournal.terminal, false, null, joinedEvidence.evidence);
    }
    if (claim.disposition === 'blocked' || claim.disposition === 'contended') {
      return outcome(action.actionKey, 'blocked', null, null, false, claim.reason);
    }
    const releaseClaim = () => releaseVerificationActionClaimV1({
      fs: journalFs,
      actionKey: action.actionKey,
      ownerToken
    });
    const leaseDurationMs = input.leaseDurationMs ?? 300_000;
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      try {
        if (!renewVerificationActionClaimV1({
          fs: journalFs,
          actionKey: action.actionKey,
          ownerToken,
          now: input.recordedAt?.() ?? new Date().toISOString(),
          leaseDurationMs
        })) leaseLost = true;
      } catch { leaseLost = true; }
    }, Math.max(250, Math.floor(leaseDurationMs / 3)));
    heartbeat.unref();
    const stopHeartbeat = () => clearInterval(heartbeat);

    const journal = readVerificationActionJournalV2(journalFs, action.actionKey);
    if (journal.latestState === 'invalidated' || journal.latestState === 'cancelled') {
      stopHeartbeat();
      releaseClaim();
      return outcome(action.actionKey, 'blocked', journal.latestState, null, false,
        `action is already ${journal.latestState}; delete the disposable V2 journal to execute cleanly`);
    }
    if (journal.latestState === 'terminal' || journal.latestState === 'reused') {
      stopHeartbeat();
      if (journal.terminal === null) throw new Error('VerificationAction terminal state has no terminal fact.');
      const terminalEvidence = await reconcileTerminalEvidenceV1({
        provider: effectProvider,
        journal,
        fs: journalFs,
        actionKey: action.actionKey,
        actionPlanDigest,
        executionBindingDigest: executionBinding.bindingDigest,
        staticClosureDigest: effectAdmissionClosure.closureDigest,
        budget: action.environment.executionBudget,
        deadlinePort: this.#deadlinePort
      });
      if (terminalEvidence.reason !== null || terminalEvidence.evidence === null) {
        return outcome(action.actionKey, 'blocked', journal.latestState, null, false,
          terminalEvidence.reason ?? 'verification-action-evidence-reconcile-failed');
      }
      const terminalSettlementFailure = await settleObservedProviderEvidenceV1({
        provider: effectProvider,
        fs: journalFs,
        action,
        evidence: terminalEvidence.evidence,
        budget: action.environment.executionBudget,
        deadlinePort: this.#deadlinePort
      });
      if (terminalSettlementFailure !== null) {
        releaseClaim();
        return outcome(action.actionKey, 'blocked', journal.latestState, journal.terminal, false,
          terminalSettlementPendingReasonV1(terminalSettlementFailure), terminalEvidence.evidence);
      }
      releaseClaim();
      return outcome(action.actionKey, 'reused', 'reused', journal.terminal, false,
        journal.terminal.status === 'failed' ? 'known terminal failure reused; never projected as PASS' : null,
        terminalEvidence.evidence);
    }
    if (journal.latestState === 'queued' || journal.latestState === 'running') {
      stopHeartbeat();
      try {
        const recoveredEvidence = await runProviderPhaseWithDeadlineV1(this.#deadlinePort, {
          phase: 'observe',
          timeoutMs: action.environment.executionBudget.evidenceObservationTimeoutMs,
          run: (signal) => effectProvider.observe({
            actionKey: action.actionKey,
            actionPlanDigest,
            executionBindingDigest: executionBinding.bindingDigest,
            staticClosureDigest: effectAdmissionClosure.closureDigest,
            readPublishedEvidence: async () => readVerificationActionEvidenceV1(journalFs, action.actionKey),
            signal
          })
        });
        if (recoveredEvidence !== null &&
            recoveredEvidence.actionKey === action.actionKey &&
            recoveredEvidence.actionPlanDigest === actionPlanDigest &&
            recoveredEvidence.executionBindingDigest === executionBinding.bindingDigest &&
            recoveredEvidence.staticClosureDigest === effectAdmissionClosure.closureDigest &&
            recoveredEvidence.providerRevision === effectProvider.providerRevision) {
          const committed = commitVerificationActionEvidenceTerminalUnderClaimV1({
            fs: journalFs,
            action,
            ownerToken,
            now: input.recordedAt?.() ?? new Date().toISOString(),
            recordedAt: input.recordedAt?.(),
            actionPlanDigest,
            executionBindingDigest: executionBinding.bindingDigest,
            staticClosureDigest: effectAdmissionClosure.closureDigest,
            evidence: recoveredEvidence,
            note: 'recovered provider terminal Evidence after process interruption'
          });
          if (committed !== null) {
            const settlementFailure = await settleObservedProviderEvidenceV1({
              provider: effectProvider,
              fs: journalFs,
              action,
              evidence: recoveredEvidence,
              budget: action.environment.executionBudget,
              deadlinePort: this.#deadlinePort
            });
            if (settlementFailure !== null) {
              releaseClaim();
              return outcome(action.actionKey, 'blocked', 'terminal', recoveredEvidence.terminal, false,
                terminalSettlementPendingReasonV1(settlementFailure), recoveredEvidence);
            }
            releaseClaim();
            return outcome(action.actionKey, 'reused', 'terminal', recoveredEvidence.terminal, false,
              recoveredEvidence.terminal.status === 'failed'
                ? 'recovered known provider terminal failure; never projected as PASS'
                : 'recovered provider terminal Evidence without replay',
              recoveredEvidence);
          }
        }
      } catch (error) {
        return outcome(action.actionKey, 'blocked', journal.latestState, null, false,
          `verification-action-provider-recovery-failed; recovery lease retained: ${boundedError(error)}`);
      }
      return outcome(action.actionKey, 'blocked', journal.latestState, null, false,
        `persisted ${journal.latestState} action has no provable provider terminal; recovery lease retained and blind re-execution is forbidden`);
    } else {
      appendVerificationActionJournalEventV2({ fs: journalFs, action,
        state: 'queued', recordedAt: input.recordedAt?.(), note: null });
      appendVerificationActionJournalEventV2({ fs: journalFs, action,
        state: 'running', recordedAt: input.recordedAt?.(), note: null });
      publishVerificationActionStartReceiptV1({
        fs: journalFs,
        receipt: {
          actionKey: action.actionKey,
          actionPlanDigest,
          executionBindingDigest: executionBinding.bindingDigest,
          staticClosureDigest: effectAdmissionClosure.closureDigest,
          providerRevision: effectProvider.providerRevision,
          startedAt: input.recordedAt?.() ?? new Date().toISOString()
        }
      });
    }

    // The map is populated before the provider Effect can run. The deferred
    // body also preserves the owner context for synchronous and awaited nested
    // dispatches, even when they change executionDomain.
    let resolveFlight!: (value: VerificationActionRunOutcomeV2) => void;
    let rejectFlight!: (error: unknown) => void;
    const flight = new Promise<VerificationActionRunOutcomeV2>((resolve, reject) => {
      resolveFlight = resolve;
      rejectFlight = reject;
    });
    IN_FLIGHT_ACTIONS.set(flightKey, flight);
    void (async () => {
      await Promise.resolve();
      try {
        (this.#executionBindingProvider?.assertCurrent
          ?? assertVerificationActionExecutionBindingCurrentV1)(executionBinding);
        staticAdmissionProvider.assertCurrent({
          plan,
          actionPlanClosureDigest: expectedActionPlanClosureDigest,
          closure: effectAdmissionClosure
        });
      } catch (error) {
        appendVerificationActionJournalEventV2({
          fs: journalFs,
          action,
          state: 'invalidated',
          recordedAt: input.recordedAt?.(),
          note: `static authority changed before Effect: ${boundedError(error)}`
        });
        stopHeartbeat();
        releaseClaim();
        resolveFlight(outcome(action.actionKey, 'blocked', 'invalidated', null, false,
          `pre-effect-static-closure-stale-before-effect: ${boundedError(error)}`));
        return;
      }
      let evidence: VerificationActionEvidenceV1 | null = null;
      let capability: VerificationActionEffectCapabilityV1 | null = null;
      let physicalExecutionStarted = false;
      const note: string | null = null;
      try {
        const start = readVerificationActionJournalV2(journalFs, action.actionKey).startReceipt;
        if (start === null || start === undefined) throw new Error('durable start receipt is missing before Effect issuance');
        const currentOwnerKeys = new Set(ownerKeys ?? []);
        currentOwnerKeys.add(ownerKey);
        capability = await runProviderPhaseWithDeadlineV1(this.#deadlinePort, {
          phase: 'issue',
          timeoutMs: action.environment.executionBudget.capabilityIssueTimeoutMs,
          run: (signal) => effectProvider.issue({
            action,
            actionPlanDigest,
            executionBindingDigest: executionBinding.bindingDigest,
            staticClosureDigest: effectAdmissionClosure.closureDigest,
            start,
            signal
          })
        });
        const descriptor = capability.descriptor;
        if (descriptor.actionKey !== action.actionKey ||
            descriptor.actionPlanDigest !== actionPlanDigest ||
            descriptor.executionBindingDigest !== executionBinding.bindingDigest ||
            descriptor.staticClosureDigest !== effectAdmissionClosure.closureDigest ||
            descriptor.providerRevision !== effectProvider.providerRevision ||
            descriptor.oneShot !== true) {
          throw new Error('provider-issued Effect capability binding is invalid');
        }
        physicalExecutionStarted = true;
        evidence = await this.#deadlinePort.run({
          phase: 'execute',
          timeoutMs: action.environment.executionBudget.absoluteTimeoutMs,
          timeoutError: () => new Error(
            `VerificationAction provider exceeded its absolute execution budget of ${
              action.environment.executionBudget.absoluteTimeoutMs}ms.`
          ),
          run: (signal) => EXECUTION_CONTEXT.run(
              Object.freeze({ ownerToken, ownerKeys: currentOwnerKeys }),
              () => effectProvider.execute({
                action,
                capability: capability!,
                signal,
                evidencePublication: Object.freeze({
                  publish: async (providerEvidence: VerificationActionEvidenceV1) =>
                    publishVerificationActionEvidenceV1({ fs: journalFs, evidence: providerEvidence }),
                  read: async () => readVerificationActionEvidenceV1(journalFs, action.actionKey)
                })
              })
            )
        });
        if (evidence.actionKey !== action.actionKey ||
            evidence.actionPlanDigest !== actionPlanDigest ||
            evidence.executionBindingDigest !== executionBinding.bindingDigest ||
            evidence.staticClosureDigest !== effectAdmissionClosure.closureDigest ||
            evidence.providerRevision !== effectProvider.providerRevision ||
            evidence.capabilityDigest !== descriptor.capabilityDigest) {
          throw new Error('provider terminal Evidence binding is invalid');
        }
      } catch (error) {
        stopHeartbeat();
        resolveFlight(outcome(action.actionKey, 'blocked', 'running', null, physicalExecutionStarted,
          `verification-action-effect-failed: ${boundedError(error)}`));
        return;
      }
      const terminal = evidence.terminal;
      const afterExecution = readVerificationActionJournalV2(
        journalFs,
        action.actionKey
      );
      try {
        (this.#executionBindingProvider?.assertCurrent
          ?? assertVerificationActionExecutionBindingCurrentV1)(executionBinding);
      } catch (error) {
        appendVerificationActionJournalEventV2({
          fs: journalFs,
          action,
          state: 'invalidated',
          recordedAt: input.recordedAt?.(),
          note: `execution binding changed during physical execution: ${boundedError(error)}`
        });
        stopHeartbeat();
        resolveFlight(outcome(action.actionKey, 'blocked', 'invalidated', null, true,
          `physical result discarded because execution binding changed: ${boundedError(error)}`, evidence));
        return;
      }
      if (afterExecution.latestState === 'invalidated' || afterExecution.latestState === 'cancelled') {
        stopHeartbeat();
        resolveFlight(outcome(
          action.actionKey,
          'blocked',
          afterExecution.latestState,
          null,
          true,
          `physical result discarded because action was ${afterExecution.latestState}`,
          evidence
        ));
        return;
      }
      const afterDependencies = resolveDependencyStates(journalFs, plan);
      const afterRunnable = isVerificationActionRunnableV2(plan, afterDependencies);
      if (!dependencyClosureUnchanged(beforeDependencies, afterDependencies) || !afterRunnable.runnable) {
        appendVerificationActionJournalEventV2({
          fs: journalFs,
          action,
          state: 'invalidated',
          recordedAt: input.recordedAt?.(),
          note: `dependency closure changed during physical execution; ${afterRunnable.reason ?? 'terminal commit rejected'}`
        });
        stopHeartbeat();
        resolveFlight(outcome(
          action.actionKey,
          'blocked',
          'invalidated',
          null,
          true,
          'physical result discarded because dependency closure was not stable',
          evidence
        ));
        return;
      }
      try {
        stopHeartbeat();
        if (leaseLost) {
          resolveFlight(outcome(action.actionKey, 'blocked', 'running', null, true,
            'physical result discarded because the durable claim lease was lost', evidence));
          return;
        }
        const committed = commitVerificationActionEvidenceTerminalUnderClaimV1({
          fs: journalFs,
          action,
          ownerToken,
          now: input.recordedAt?.() ?? new Date().toISOString(),
          recordedAt: input.recordedAt?.(),
          actionPlanDigest,
          executionBindingDigest: executionBinding.bindingDigest,
          staticClosureDigest: effectAdmissionClosure.closureDigest,
          evidence,
          note
        });
        if (committed === null) {
          resolveFlight(outcome(action.actionKey, 'blocked', 'running', null, true,
            'physical result discarded because terminal commit did not own the live claim', evidence));
          return;
        }
        const terminalJournal = readVerificationActionJournalV2(journalFs, action.actionKey);
        const committedEvidence = await reconcileTerminalEvidenceV1({
          provider: effectProvider,
          journal: terminalJournal,
          fs: journalFs,
          actionKey: action.actionKey,
          actionPlanDigest,
          executionBindingDigest: executionBinding.bindingDigest,
          staticClosureDigest: effectAdmissionClosure.closureDigest,
          budget: action.environment.executionBudget,
          deadlinePort: this.#deadlinePort
        });
        if (committedEvidence.reason !== null || committedEvidence.evidence === null || capability === null) {
          resolveFlight(outcome(
            action.actionKey,
            'blocked',
            terminalJournal.latestState,
            terminalJournal.terminal,
            true,
            `terminal-settlement-pending: ${committedEvidence.reason ?? 'verification-action-evidence-reconcile-failed'}`,
            evidence
          ));
          return;
        }
        const settlementFailure = await settleObservedProviderEvidenceV1({
          provider: effectProvider,
          fs: journalFs,
          action,
          capability,
          evidence: committedEvidence.evidence,
          budget: action.environment.executionBudget,
          deadlinePort: this.#deadlinePort
        });
        if (settlementFailure !== null) {
          resolveFlight(outcome(action.actionKey, 'blocked', 'terminal', terminalJournal.terminal, true,
            terminalSettlementPendingReasonV1(settlementFailure), committedEvidence.evidence));
          return;
        }
        if (!releaseClaim()) {
          resolveFlight(outcome(action.actionKey, 'blocked', 'terminal', terminalJournal.terminal, true,
            'verification-action-claim-release-failed-after-evidence-consistency', committedEvidence.evidence));
          return;
        }
        resolveFlight(outcome(action.actionKey, 'executed', 'terminal', terminal, true, note,
          committedEvidence.evidence));
      } catch (error) {
        stopHeartbeat();
        const settlementJournal = readVerificationActionJournalV2(journalFs, action.actionKey);
        const settlementTerminal = settlementJournal.latestState === 'terminal' || settlementJournal.latestState === 'reused'
          ? settlementJournal.terminal
          : null;
        resolveFlight(outcome(
          action.actionKey,
          'blocked',
          settlementJournal.latestState,
          settlementTerminal,
          true,
          `${settlementTerminal === null ? 'verification-action-effect-failed' : 'terminal-settlement-pending'}: ${boundedError(error)}`,
          evidence
        ));
      }
    })().catch((error) => {
      stopHeartbeat();
      resolveFlight(outcome(action.actionKey, 'blocked', 'running', null, true,
        `verification-action-runner-failed: ${boundedError(error)}`));
    });
    try {
      return await flight;
    } finally {
      if (IN_FLIGHT_ACTIONS.get(flightKey) === flight) {
        IN_FLIGHT_ACTIONS.delete(flightKey);
      }
    }
  }

  invalidate(
    repositoryRoot: string,
    action: VerificationActionKeyV2,
    note = 'action input or upstream closure changed'
  ): VerificationActionJournalReadbackV2 {
    const canonical = canonicalAction(action);
    const fs = this.#retainedJournalFileSystem(repositoryRoot);
    const current = readVerificationActionJournalV2(fs, canonical.actionKey);
    if (current.latestState === null || current.latestState === 'invalidated' ||
      current.latestState === 'cancelled') return current;
    return revokeVerificationActionClaimV1({ fs, action: canonical,
      state: 'invalidated', note });
  }

  invalidateIfDependent(input: {
    repositoryRoot: string;
    action: VerificationActionKeyV2;
    changedInputPaths: readonly string[] | null;
    changedUpstreamActionKeys?: readonly VerificationActionKeyDigest[];
    note?: string;
  }): VerificationActionJournalReadbackV2 {
    const action = canonicalAction(input.action);
    if (!verificationActionDependsOnChangedInputsV2(
      action,
      input.changedInputPaths,
      input.changedUpstreamActionKeys ?? []
    )) {
      return readVerificationActionJournalV2(
        this.#retainedJournalFileSystem(input.repositoryRoot),
        action.actionKey
      );
    }
    return this.invalidate(input.repositoryRoot, action, input.note);
  }
}

export function createVerificationActionRunnerV2(): VerificationActionRunnerV2 {
  return new VerificationActionRunnerV2();
}

/**
 * Execute one canonical local quick Action DAG for developer feedback.
 *
 * This seam deliberately returns only local journal terminals. It never emits,
 * finalizes, or projects hosted CI Evidence.
 */
export async function executeLocalVerificationActionDagV2(
  input: ExecuteLocalVerificationActionDagInputV2
): Promise<LocalVerificationActionDagResultV2> {
  const authorityRoot = realpathSync.native(path.resolve(input.authorityRoot));
  const candidateRoot = path.resolve(input.candidateRoot);
  const closure = parseCiVerificationActionPlanClosureV1(
    encodeVerificationActionDataV2(input.actionPlanClosure)
  );
  const executionEnvironment = input.executionEnvironment;
  if (executionEnvironment.kind !== 'local' || executionEnvironment.runnerImage !== null) {
    throw new Error('local VerificationAction DAG requires one canonical local execution environment.');
  }
  if (closure.actions.length === 0 || closure.actions.length !== closure.normalizedOperations.length) {
    throw new Error('local VerificationAction DAG requires one non-empty canonical Action closure.');
  }
  const firstOperation = closure.normalizedOperations[0]!;
  if (closure.normalizedOperations.some((operation) =>
    operation.phase !== 'quick' ||
    operation.candidate.executionEnvironmentRevision !== executionEnvironment.executionEnvironmentRevision ||
    operation.candidate.profile !== 'quick'
  ) || closure.actions.some((plan) =>
    plan.action.environment.providerRevision !== executionEnvironment.executionEnvironmentRevision ||
    plan.action.environment.toolchainRevision !== executionEnvironment.toolchainRevision
  )) {
    throw new Error('local VerificationAction DAG closure/environment identity mismatch.');
  }
  const authority = input.inspectRepository(authorityRoot);
  const candidate = input.inspectRepository(candidateRoot);
  const canonicalCommonDirectory = (value: string): string => (
    process.platform === 'win32' ? realpathSync.native(value).toLowerCase() : realpathSync.native(value)
  );
  if (!authority.trackedClean || !candidate.trackedClean ||
      canonicalCommonDirectory(authority.gitCommonDirectory) !==
        canonicalCommonDirectory(candidate.gitCommonDirectory) ||
      candidate.headSha !== firstOperation.candidate.headSha ||
      candidate.headTreeSha !== firstOperation.candidate.headTreeSha ||
      closure.normalizedOperations.some((operation) =>
        operation.candidate.headSha !== candidate.headSha ||
        operation.candidate.headTreeSha !== candidate.headTreeSha
      )) {
    throw new Error('local VerificationAction DAG requires the exact clean candidate head and tree.');
  }

  const runner = input.runner ?? createVerificationActionRunnerV2();
  const producerActionPlanClosure = createVerificationActionPlanClosureV1({
    producer: {
      identity: 'sec-ci-verification-action-plan-closure',
      revision: closure.producerRevision
    },
    plans: closure.actions
  });
  const actionResults: VerificationActionRunOutcomeV2[] = [];
  for (let index = 0; index < closure.actions.length; index += 1) {
    const plan = closure.actions[index]!;
    const normalizedOperation = closure.normalizedOperations[index]!;
    const result = await runner.execute({
      runtimeStateRepositoryRoot: authorityRoot,
      staticAuthorityRepositoryRoot: candidateRoot,
      physicalExecutionRepositoryRoot: candidateRoot,
      action: plan.action,
      plan,
      actionPlanClosure: producerActionPlanClosure,
      executionDomain: `local-dev-runner:${executionEnvironment.executionEnvironmentRevision}`,
      recordedAt: input.recordedAt,
      effectProvider: createVerificationActionCallbackEffectProviderV1({
        providerRevision: plan.action.environment.providerRevision,
        execute: async () => {
          const exitCode = await executeVerifiedCiActionPlanV1({
            plan,
            authorizedClosure: closure,
            repositoryRoot: candidateRoot,
            environment: input.environment,
            executeNormalizedOperation: input.executeNormalizedOperation
          });
          const status = exitCode === 0 ? 'passed' as const : 'failed' as const;
          return {
            terminal: createVerificationActionTerminalV2({
              status,
              reasonCode: status === 'passed' ? 'executed-success' : 'executed-failure',
              resultDigest: localDagDigest({
                actionKey: plan.action.actionKey,
                normalizedOperationDigest: normalizedOperation.semanticDigest,
                exitCode,
                executionEnvironmentRevision: executionEnvironment.executionEnvironmentRevision
              })
            })
          };
        }
      })
    });
    actionResults.push(result);
  }
  const status = actionResults.some((entry) => entry.disposition === 'blocked' || entry.terminal === null)
    ? 'blocked' as const
    : actionResults.some((entry) => entry.terminal?.status !== 'passed')
      ? 'failed' as const
      : 'passed' as const;
  const withoutDigest = Object.freeze({
    schema: LOCAL_VERIFICATION_ACTION_DAG_RESULT_SCHEMA_V2,
    actionPlanDigest: closure.actionPlanDigest as VerificationActionKeyDigest,
    executionEnvironmentRevision: executionEnvironment.executionEnvironmentRevision,
    status,
    actionResults: Object.freeze(actionResults)
  });
  return Object.freeze({ ...withoutDigest, terminalDigest: localDagDigest(withoutDigest) });
}
