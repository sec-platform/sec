import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { buildWorkspaceSemanticBundle } from '../compiler/semantic-frontend.ts';
import {
  atomicPublishSemanticMutationSource,
  atomicRestoreSemanticMutationSource,
  readSemanticMutationTransactionArtifacts,
  writeSemanticMutationTransactionArtifacts
} from '../compiler/semantic-mutation/atomic-source-publish.ts';
import {
  canonicalDiagnostics,
  diagnosticRevision,
  mutationDiagnostic,
  SemanticMutationContractError,
  sha256
} from '../compiler/semantic-mutation/canonical.ts';
import {
  deriveStagedSemanticMutation,
  type DerivedSemanticMutationTransactionV1
} from '../compiler/semantic-mutation/derive-staged-mutation.ts';
import {
  appendSemanticMutationRecoveryRecord,
  loadLatestSemanticMutationRecoveryRecord,
  projectSemanticMutationRequestRecordView,
  pruneSemanticMutationTerminalRecords,
  querySemanticMutationRequestRecord,
  recoveryDiagnostic
} from '../compiler/semantic-mutation/mutation-recovery-record.ts';
import { readRejectedSemanticMutationTerminal, writeRejectedSemanticMutationTerminal } from '../compiler/semantic-mutation/mutation-terminal-record.ts';
import { normalizeSemanticMutationRequest } from '../compiler/semantic-mutation/normalize-request.ts';
import { semanticMutationByteDigest } from '../compiler/semantic-mutation/semantic-contract-yaml-adapter.ts';
import {
  buildSemanticMutationResult,
  buildSemanticMutationVerificationExecutionRef
} from '../compiler/semantic-mutation/semantic-mutation-result.ts';
import { readSemanticMutationSource } from '../compiler/semantic-mutation/source-path-boundary.ts';
import {
  assertSemanticMutationTransactionRoot,
  semanticMutationRequestIdentityDigest,
  semanticMutationTransactionRoot,
  type SemanticMutationCommitFence
} from '../compiler/semantic-mutation/transaction-identity.ts';
import { semanticMutationRequiredVerificationDigest } from '../compiler/semantic-mutation/verification-policy.ts';
import {
  probeSemanticMutationIsolatedRuntimeCapability,
  runSemanticMutationIsolatedVerificationChild,
  SemanticMutationIsolatedVerificationUnavailableError,
  type IsolatedVerificationArtifacts,
  type SemanticMutationIsolatedVerificationFailure
} from '../compiler/verify/run-semantic-mutation-isolated-child.ts';
import {
  executeSemanticMutationVerification,
  planSemanticMutationVerificationCapabilities
} from '../compiler/verify/semantic-mutation-verification-adapter.ts';
import type { FactDeltaEndpointContext } from '../shared/engineering-ir-types.ts';
import {
  type SemanticMutationApplyInputV1,
  type SemanticMutationApplyOutcomeV1,
  type SemanticMutationInternalRecoveryOutcomeV1,
  type SemanticMutationRecoveryFailureState,
  type SemanticMutationRecoveryOutcomeV1,
  type SemanticMutationRecoveryRecordV1,
  type SemanticMutationRequestIdentityV1,
  type SemanticMutationRequestRecordViewV1,
  type SemanticMutationTransactionInputV1
} from '../shared/semantic-mutation-transaction-types.ts';
import type {
  NormalizedSemanticMutationRequestV2,
  SemanticMutationBaseV2,
  SemanticMutationDiagnosticV2,
  SemanticMutationPlanV2,
  SemanticMutationResultV2,
  SemanticMutationVerificationExecutionRefV2
} from '../shared/semantic-mutation-types.ts';
import {
  SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID,
  SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION,
  type SemanticMutationVerificationCapabilityPlanV1
} from '../shared/verification-types.ts';
import { windowsAppContainerCapability } from '../shared/windows-appcontainer-executor.ts';
import {
  acquireWorkspaceWriteLease,
  assertWorkspaceWriteLease,
  withWorkspaceWriteLease,
  WorkspaceWriteLeaseError,
  type WorkspaceWriteLeaseToken
} from '../shared/workspace-write-lease.ts';
import { compileWorkspace } from './pipeline-orchestrator.ts';

type ReadyPlan = Extract<SemanticMutationPlanV2, { readonly status: 'ready' }>;
type RecoveryRecordDraft = Omit<
  SemanticMutationRecoveryRecordV1,
  'formatRevision' | 'sequence' | 'previousRecordRevision' | 'terminalSequence' | 'recordRevision'
>;

interface SemanticMutationInternalApplyOptions {
  readonly testCrashPoint?: 'after-prepared';
  readonly testDependencies?: Partial<SemanticMutationCoordinatorDependencies>;
}

interface SemanticMutationIsolationCapabilityProbeRequestV1 {
  readonly stagingWorkspaceRoot: string;
  readonly workspaceRoot: string;
  readonly workspaceWriteLease: WorkspaceWriteLeaseToken;
}

type SemanticMutationIsolationCapabilityProbeFactoryV1 = (
  request: SemanticMutationIsolationCapabilityProbeRequestV1
) => unknown | Promise<unknown>;

const DEFAULT_SEMANTIC_MUTATION_ISOLATION_CAPABILITY_PROBE:
  SemanticMutationIsolationCapabilityProbeFactoryV1 = async (request) => {
    const runtime = await probeSemanticMutationIsolatedRuntimeCapability(
      request.stagingWorkspaceRoot
    );
    if (runtime.status !== 'available') return Object.freeze({ status: 'unavailable' });
    return windowsAppContainerCapability().status === 'available'
      ? runtime
      : Object.freeze({ status: 'unavailable' as const });
  };

function crashAfterPreparedForTest(): never {
  const error = new Error(
    'Semantic Mutation test crash after the prepared generation became durable'
  ) as NodeJS.ErrnoException;
  error.name = 'SemanticMutationAfterPreparedTestCrash';
  error.code = 'SEMANTIC_MUTATION_TEST_CRASH_AFTER_PREPARED';
  throw error;
}

function endpointFromBundle(
  transactionId: string,
  snapshot: Awaited<ReturnType<typeof buildWorkspaceSemanticBundle>>['snapshot']
): FactDeltaEndpointContext {
  return {
    transactionId,
    inputRevision: snapshot.ir.inputRevision,
    semanticRevision: snapshot.ir.semanticRevision,
    snapshot
  };
}

function planningAdapter(
  workspaceRoot: string,
  workspaceWriteLease: WorkspaceWriteLeaseToken,
  isolationCapabilityProbe = DEFAULT_SEMANTIC_MUTATION_ISOLATION_CAPABILITY_PROBE
) {
  return {
    adapterId: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID,
    adapterRevision: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION,
    capabilityPlan(
      staged: FactDeltaEndpointContext,
      requirements: ReadyPlan['requiredVerification'],
      stagingWorkspaceRoot: string
    ) {
      return planSemanticMutationVerificationCapabilities({
        snapshot: staged.snapshot,
        requirements,
        isolationCapabilityProbe: () => isolationCapabilityProbe({
          stagingWorkspaceRoot,
          workspaceRoot,
          workspaceWriteLease
        })
      });
    }
  } as const;
}

function requestRejected(
  requestId: string,
  requestRevision: string,
  diagnostics: readonly SemanticMutationDiagnosticV2[]
): SemanticMutationApplyOutcomeV1 {
  const canonical = canonicalDiagnostics(diagnostics);
  return {
    status: 'request-rejected',
    requestId,
    requestRevision,
    diagnostics: canonical,
    diagnosticRevision: diagnosticRevision(canonical)
  };
}

async function fencedWorkspaceWrite<Value>(
  workspaceRoot: string,
  token: WorkspaceWriteLeaseToken,
  operation: (commitFence: SemanticMutationCommitFence) => Promise<Value>
): Promise<Value> {
  const commitFence = () => assertWorkspaceWriteLease(workspaceRoot, token);
  await commitFence();
  return operation(commitFence);
}

async function writeRejectedTerminalAndPrune(
  workspaceRoot: string,
  transactionRoot: string,
  token: WorkspaceWriteLeaseToken,
  requestIdentityDigest: string,
  requestRevision: string,
  planRevision: string,
  result: Extract<SemanticMutationResultV2, { readonly status: 'rejected' }>
): Promise<void> {
  await fencedWorkspaceWrite(workspaceRoot, token, (commitFence) =>
    writeRejectedSemanticMutationTerminal(
      transactionRoot,
      requestIdentityDigest,
      requestRevision,
      planRevision,
      result,
      commitFence
    )
  );
  await fencedWorkspaceWrite(
    workspaceRoot,
    token,
    (commitFence) => pruneSemanticMutationTerminalRecords(workspaceRoot, commitFence)
  );
}

function terminalRecoveryOutcome(
  outcome: Extract<SemanticMutationInternalRecoveryOutcomeV1, { readonly status: 'recovery-required' }>
): SemanticMutationApplyOutcomeV1 {
  const result = outcome.record.result;
  if (!result || result.status !== 'recovery-required') {
    throw new Error('Recovery-required outcome is missing its durable terminal result');
  }
  return { status: 'terminal', result };
}

function untrustedRequestId(input: SemanticMutationApplyInputV1): string {
  return typeof input.request?.requestId === 'string' ? input.request.requestId : '';
}

function recordDraft(
  state: 'prepared',
  input: SemanticMutationApplyInputV1,
  derived: DerivedSemanticMutationTransactionV1 & {
    readonly plan: ReadyPlan;
    readonly editPlan: NonNullable<DerivedSemanticMutationTransactionV1['editPlan']>;
    readonly rollbackManifest: NonNullable<DerivedSemanticMutationTransactionV1['rollbackManifest']>;
  },
  transactionId: string,
  requestIdentityDigest: string,
  verification: SemanticMutationVerificationExecutionRefV2,
  diagnostics: readonly SemanticMutationDiagnosticV2[] = []
): RecoveryRecordDraft {
  return {
    state,
    transactionId,
    requestIdentityDigest,
    requestRevision: derived.plan.requestRevision,
    authorizationRevision: derived.plan.authorizationRevision,
    expectedPlanRevision: input.expectedPlanRevision,
    planRevision: derived.plan.planRevision,
    editPlanRevision: derived.editPlan.editPlanRevision,
    rollbackManifestDigest: derived.rollbackManifest.rollbackManifestDigest,
    relativePath: derived.editPlan.relativePath,
    beforeByteDigest: derived.editPlan.beforeByteDigest,
    committedByteDigest: derived.editPlan.stagedByteDigest,
    base: derived.plan.base,
    staged: derived.plan.staged,
    verificationExecutionRevision: verification.verificationExecutionRevision,
    verificationReportRevision: verification.reportRevision,
    request: input.request,
    authorization: input.authorization,
    plan: derived.plan,
    verification,
    diagnostics
  };
}

function nextRecordDraft(
  record: SemanticMutationRecoveryRecordV1,
  state: Exclude<SemanticMutationRecoveryRecordV1['state'], 'prepared'>,
  fields: {
    readonly diagnostics?: readonly SemanticMutationDiagnosticV2[];
    readonly result?: SemanticMutationResultV2;
    readonly recoveryState?: SemanticMutationRecoveryFailureState;
  } = {}
): RecoveryRecordDraft {
  return {
    state,
    transactionId: record.transactionId,
    requestIdentityDigest: record.requestIdentityDigest,
    requestRevision: record.requestRevision,
    authorizationRevision: record.authorizationRevision,
    expectedPlanRevision: record.expectedPlanRevision,
    planRevision: record.planRevision,
    editPlanRevision: record.editPlanRevision,
    rollbackManifestDigest: record.rollbackManifestDigest,
    relativePath: record.relativePath,
    beforeByteDigest: record.beforeByteDigest,
    committedByteDigest: record.committedByteDigest,
    base: record.base,
    staged: record.staged,
    verificationExecutionRevision: record.verificationExecutionRevision,
    verificationReportRevision: record.verificationReportRevision,
    request: record.request,
    authorization: record.authorization,
    plan: record.plan,
    verification: record.verification,
    ...(fields.result === undefined ? {} : { result: fields.result }),
    ...(fields.recoveryState === undefined ? {} : { recoveryState: fields.recoveryState }),
    diagnostics: fields.diagnostics ?? record.diagnostics
  };
}

function isolatedVerificationBlockedResult(
  failure?: SemanticMutationIsolatedVerificationFailure
): {
  readonly status: 'blocked';
  readonly evidenceDigest: string;
} {
  return {
    status: 'blocked',
    evidenceDigest: sha256({
      domain: 'semantic-mutation-isolated-verification-evidence-v1',
      reason: 'isolated-verification-unavailable',
      ...(failure === undefined ? {} : { failure })
    })
  };
}

function isolatedVerificationEvidenceDigest(artifacts: IsolatedVerificationArtifacts): string {
  const snapshot = artifacts.semanticBundle.snapshot.ir;
  const generatedReport = artifacts.verificationReport;
  return sha256({
    domain: 'semantic-mutation-isolated-verification-evidence-v1',
    completedStages: ['resolve', 'semantic', 'compose', 'adapt', 'verify'],
    inputRevision: snapshot.inputRevision,
    semanticRevision: snapshot.semanticRevision,
    generatedArtifactRawDigests: artifacts.rawDigests,
    report: {
      summary: generatedReport.summary,
      build: generatedReport.build,
      unit: generatedReport.unit,
      acceptance: generatedReport.acceptance,
      policy: generatedReport.policy,
      runtime: {
        status: generatedReport.runtime.status,
        build: generatedReport.runtime.build,
        unit: generatedReport.runtime.unit,
        acceptance: generatedReport.runtime.acceptance
      }
    }
  });
}

async function runIsolatedVerification(
  derived: DerivedSemanticMutationTransactionV1 & {
    readonly plan: ReadyPlan;
    readonly staged: FactDeltaEndpointContext;
    readonly stagingWorkspaceRoot: string;
    readonly verificationCapabilityPlan: SemanticMutationVerificationCapabilityPlanV1;
  },
  leaseContext: {
    readonly commitFence: SemanticMutationCommitFence;
    readonly recordBlockedFailure?: (
      failure: SemanticMutationIsolatedVerificationFailure
    ) => void;
    readonly workspaceRoot: string;
    readonly workspaceWriteLease: WorkspaceWriteLeaseToken;
  }
): Promise<SemanticMutationVerificationExecutionRefV2> {
  const { commitFence, workspaceRoot, workspaceWriteLease } = leaseContext;
  await commitFence();
  const requiredDigest = semanticMutationRequiredVerificationDigest(derived.plan.requiredVerification);
  const report = await executeSemanticMutationVerification({
    capabilityPlan: derived.verificationCapabilityPlan,
    requirements: derived.plan.requiredVerification,
    planRevision: derived.plan.planRevision,
    attempted: derived.plan.staged,
    stagedSourceDigest: derived.plan.sourceChanges[0].stagedByteDigest,
    requiredVerificationDigest: requiredDigest
  }, async () => {
    try {
      const artifacts = await runSemanticMutationIsolatedVerificationChild(
        derived.stagingWorkspaceRoot,
        {
          capabilityPlan: derived.verificationCapabilityPlan,
          commitFence,
          workspaceRoot,
          workspaceWriteLease
        }
      );
      await commitFence();
      const snapshot = artifacts.semanticBundle.snapshot.ir;
      const generatedReport = artifacts.verificationReport;
      if (snapshot.inputRevision !== derived.plan.staged.inputRevision ||
        snapshot.semanticRevision !== derived.plan.staged.semanticRevision ||
        generatedReport.summary.status !== artifacts.status ||
        (artifacts.status === 'passed' &&
          (generatedReport.summary.failedLanes.length !== 0 ||
            generatedReport.fast.status !== 'passed' || generatedReport.runtime.status !== 'passed'))) {
        const failure = Object.freeze({ stage: 'binding-mismatch' as const });
        leaseContext.recordBlockedFailure?.(failure);
        return isolatedVerificationBlockedResult(failure);
      }
      return {
        status: artifacts.status,
        evidenceDigest: isolatedVerificationEvidenceDigest(artifacts)
      };
    } catch (error) {
      const failure = error instanceof SemanticMutationIsolatedVerificationUnavailableError
        ? error.failure
        : Object.freeze({ stage: 'binding-mismatch' as const });
      leaseContext.recordBlockedFailure?.(failure);
      return isolatedVerificationBlockedResult(failure);
    }
  });
  await commitFence();
  return buildSemanticMutationVerificationExecutionRef(report);
}

async function liveRebuild(
  workspaceRoot: string,
  token: WorkspaceWriteLeaseToken
): Promise<SemanticMutationBaseV2> {
  await assertWorkspaceWriteLease(workspaceRoot, token);
  const compiled = await compileWorkspace(workspaceRoot, {
    source: 'api',
    from: 'resolve',
    through: 'emit',
    verificationLane: 'all',
    workspaceWriteLease: token
  });
  const proof = compiled.completionProof;
  if (!compiled.semanticContext || !proof ||
    proof.transactionId !== compiled.transactionId ||
    proof.transactionId !== compiled.semanticContext.transactionId ||
    proof.inputRevision !== compiled.semanticContext.inputRevision ||
    proof.semanticRevision !== compiled.semanticContext.semanticRevision) {
    throw new Error('Live Semantic Mutation rebuild did not complete the registry-owned downstream closure');
  }
  return {
    transactionId: compiled.semanticContext.transactionId,
    inputRevision: compiled.semanticContext.inputRevision,
    semanticRevision: compiled.semanticContext.semanticRevision
  };
}

interface SemanticMutationCoordinatorDependencies {
  readonly derive: typeof deriveStagedSemanticMutation;
  readonly isolationCapabilityProbe: SemanticMutationIsolationCapabilityProbeFactoryV1;
  readonly verify: typeof runIsolatedVerification;
  readonly writeTransactionArtifacts: typeof writeSemanticMutationTransactionArtifacts;
  readonly appendRecoveryRecord: typeof appendSemanticMutationRecoveryRecord;
  readonly publishSource: typeof atomicPublishSemanticMutationSource;
  readonly readTransactionArtifacts: typeof readSemanticMutationTransactionArtifacts;
  readonly restoreSource: typeof atomicRestoreSemanticMutationSource;
  readonly rebuildLive: typeof liveRebuild;
}

type SemanticMutationPlanningTestDependencies = Readonly<
  Pick<SemanticMutationCoordinatorDependencies, 'isolationCapabilityProbe'>
>;

const DEFAULT_SEMANTIC_MUTATION_COORDINATOR_DEPENDENCIES: SemanticMutationCoordinatorDependencies =
  Object.freeze({
    derive: deriveStagedSemanticMutation,
    isolationCapabilityProbe: DEFAULT_SEMANTIC_MUTATION_ISOLATION_CAPABILITY_PROBE,
    verify: runIsolatedVerification,
    writeTransactionArtifacts: writeSemanticMutationTransactionArtifacts,
    appendRecoveryRecord: appendSemanticMutationRecoveryRecord,
    publishSource: atomicPublishSemanticMutationSource,
    readTransactionArtifacts: readSemanticMutationTransactionArtifacts,
    restoreSource: atomicRestoreSemanticMutationSource,
    rebuildLive: liveRebuild
  });

function coordinatorDependencies(
  overrides: Partial<SemanticMutationCoordinatorDependencies> | undefined
): SemanticMutationCoordinatorDependencies {
  return overrides === undefined
    ? DEFAULT_SEMANTIC_MUTATION_COORDINATOR_DEPENDENCIES
    : { ...DEFAULT_SEMANTIC_MUTATION_COORDINATOR_DEPENDENCIES, ...overrides };
}

function readyPlan(record: SemanticMutationRecoveryRecordV1): ReadyPlan {
  if (record.plan.status !== 'ready') throw new Error('Active recovery record does not bind a ready plan');
  return record.plan;
}

async function markRecoveryRequired(
  workspaceRoot: string,
  transactionRoot: string,
  record: SemanticMutationRecoveryRecordV1,
  token: WorkspaceWriteLeaseToken,
  recoveryState: SemanticMutationRecoveryFailureState,
  diagnostic: SemanticMutationDiagnosticV2,
  dependencies: SemanticMutationCoordinatorDependencies =
    DEFAULT_SEMANTIC_MUTATION_COORDINATOR_DEPENDENCIES
): Promise<Extract<SemanticMutationInternalRecoveryOutcomeV1, { readonly status: 'recovery-required' }>> {
  const plan = readyPlan(record);
  const result = buildSemanticMutationResult(plan, {
    status: 'recovery-required',
    transactionId: record.transactionId,
    attempted: plan.staged,
    verification: record.verification as SemanticMutationVerificationExecutionRefV2 & { readonly status: 'passed' },
    recoveryState,
    diagnostics: [diagnostic]
  });
  if (result.status !== 'recovery-required') throw new Error('Recovery-required evidence did not form a recovery result');
  const terminal = await fencedWorkspaceWrite(workspaceRoot, token, (commitFence) =>
    dependencies.appendRecoveryRecord(transactionRoot, nextRecordDraft(
      record,
      'recovery-required',
      { recoveryState, result, diagnostics: [diagnostic] }
    ), commitFence)
  );
  return { status: 'recovery-required', record: terminal };
}

async function rollbackCommittedMutation(
  workspaceRoot: string,
  transactionRoot: string,
  record: SemanticMutationRecoveryRecordV1,
  token: WorkspaceWriteLeaseToken,
  cause: SemanticMutationDiagnosticV2,
  dependencies: SemanticMutationCoordinatorDependencies =
    DEFAULT_SEMANTIC_MUTATION_COORDINATOR_DEPENDENCIES
): Promise<SemanticMutationInternalRecoveryOutcomeV1> {
  const plan = readyPlan(record);
  try {
    await assertWorkspaceWriteLease(workspaceRoot, token);
    const artifacts = await dependencies.readTransactionArtifacts(transactionRoot);
    await dependencies.restoreSource(
      workspaceRoot,
      transactionRoot,
      artifacts.plan,
      artifacts.manifest,
      () => assertWorkspaceWriteLease(workspaceRoot, token)
    );
    const restored = await dependencies.rebuildLive(workspaceRoot, token);
    if (restored.inputRevision !== plan.base.inputRevision ||
      restored.semanticRevision !== plan.base.semanticRevision) {
      return markRecoveryRequired(
        workspaceRoot,
        transactionRoot,
        record,
        token,
        'rebuild-failed',
        recoveryDiagnostic('Restored source did not rebuild the exact base semantic endpoint'),
        dependencies
      );
    }
    const result = buildSemanticMutationResult(plan, {
      status: 'rolled-back',
      transactionId: record.transactionId,
      attempted: plan.staged,
      verification: record.verification as SemanticMutationVerificationExecutionRefV2 & { readonly status: 'passed' },
      diagnostics: [cause]
    });
    if (result.status !== 'rolled-back') throw new Error('Rollback evidence did not form a rolled-back result');
    await fencedWorkspaceWrite(workspaceRoot, token, (commitFence) =>
      dependencies.appendRecoveryRecord(
        transactionRoot,
        nextRecordDraft(record, 'rolled-back', { result, diagnostics: [cause] }),
        commitFence
      )
    );
    return { status: 'terminal', result };
  } catch (error) {
    if (error instanceof WorkspaceWriteLeaseError) throw error;
    const concurrent = error instanceof Error && error.message.includes('not committed by this transaction');
    return markRecoveryRequired(
      workspaceRoot,
      transactionRoot,
      record,
      token,
      concurrent ? 'concurrent-write' : 'rollback-failed',
      recoveryDiagnostic(
        concurrent
          ? 'Rollback CAS detected source bytes not owned by this transaction'
          : 'Atomic rollback or restored rebuild failed'
      ),
      dependencies
    );
  }
}

async function completeCommittedMutation(
  workspaceRoot: string,
  transactionRoot: string,
  record: SemanticMutationRecoveryRecordV1,
  token: WorkspaceWriteLeaseToken,
  dependencies: SemanticMutationCoordinatorDependencies =
    DEFAULT_SEMANTIC_MUTATION_COORDINATOR_DEPENDENCIES
): Promise<SemanticMutationInternalRecoveryOutcomeV1> {
  const plan = readyPlan(record);
  let result: Extract<SemanticMutationResultV2, { readonly status: 'accepted' }>;
  try {
    const accepted = await dependencies.rebuildLive(workspaceRoot, token);
    const liveSource = await readSemanticMutationSource(workspaceRoot, transactionRoot, record.relativePath);
    if (accepted.inputRevision !== plan.staged.inputRevision ||
      accepted.semanticRevision !== plan.staged.semanticRevision ||
      semanticMutationByteDigest(liveSource.bytes) !== record.committedByteDigest) {
      throw new Error('Live rebuild does not exactly match staged revisions and committed source digest');
    }
    const candidate = buildSemanticMutationResult(plan, {
      status: 'accepted',
      transactionId: record.transactionId,
      attempted: plan.staged,
      accepted,
      verification: record.verification as SemanticMutationVerificationExecutionRefV2 & { readonly status: 'passed' }
    });
    if (candidate.status !== 'accepted') throw new Error('Accepted evidence did not form an accepted result');
    result = candidate;
  } catch (error) {
    if (error instanceof WorkspaceWriteLeaseError) throw error;
    return rollbackCommittedMutation(
      workspaceRoot,
      transactionRoot,
      record,
      token,
      mutationDiagnostic(
        'SEMANTIC-MUTATION-012',
        'rollback',
        'Post-publish live rebuild failed exact staged endpoint validation'
      ),
      dependencies
    );
  }
  try {
    await fencedWorkspaceWrite(workspaceRoot, token, (commitFence) =>
      dependencies.appendRecoveryRecord(
        transactionRoot,
        nextRecordDraft(record, 'verified', { result, diagnostics: [] }),
        commitFence
      )
    );
    return { status: 'terminal', result };
  } catch (error) {
    if (error instanceof WorkspaceWriteLeaseError) throw error;
    return markRecoveryRequired(
      workspaceRoot,
      transactionRoot,
      record,
      token,
      'rebuild-failed',
      recoveryDiagnostic('Committed source could not durably finalize its verified journal state'),
      dependencies
    );
  }
}

async function rejectPreparedRecovery(
  workspaceRoot: string,
  transactionRoot: string,
  record: SemanticMutationRecoveryRecordV1,
  token: WorkspaceWriteLeaseToken,
  diagnostic: SemanticMutationDiagnosticV2
): Promise<SemanticMutationInternalRecoveryOutcomeV1> {
  const plan = readyPlan(record);
  const result = buildSemanticMutationResult(plan, {
    status: 'rejected',
    transactionId: record.transactionId,
    attempted: plan.staged,
    verification: record.verification,
    diagnostics: [diagnostic]
  });
  if (result.status !== 'rejected') {
    throw new Error('Prepared recovery rejection did not form a rejected terminal result');
  }
  await writeRejectedTerminalAndPrune(
    workspaceRoot,
    transactionRoot,
    token,
    record.requestIdentityDigest,
    record.requestRevision,
    record.planRevision,
    result
  );
  return { status: 'terminal', result };
}

function exactPreparedRecoveryBinding(
  record: SemanticMutationRecoveryRecordV1,
  derived: DerivedSemanticMutationTransactionV1,
  verification: SemanticMutationVerificationExecutionRefV2,
  artifacts: Awaited<ReturnType<typeof readSemanticMutationTransactionArtifacts>>
): boolean {
  if (derived.plan.status !== 'ready' || !derived.editPlan || !derived.rollbackManifest ||
    !derived.originalBytes || !derived.stagedBytes || !derived.staged) return false;
  return JSON.stringify(derived.plan) === JSON.stringify(record.plan) &&
    derived.plan.planRevision === record.planRevision &&
    derived.editPlan.editPlanRevision === record.editPlanRevision &&
    derived.rollbackManifest.rollbackManifestDigest === record.rollbackManifestDigest &&
    derived.editPlan.relativePath === record.relativePath &&
    derived.editPlan.beforeByteDigest === record.beforeByteDigest &&
    derived.editPlan.stagedByteDigest === record.committedByteDigest &&
    JSON.stringify(derived.plan.base) === JSON.stringify(record.base) &&
    JSON.stringify(derived.plan.staged) === JSON.stringify(record.staged) &&
    JSON.stringify(verification) === JSON.stringify(record.verification) &&
    JSON.stringify(artifacts.plan) === JSON.stringify(derived.editPlan) &&
    JSON.stringify(artifacts.manifest) === JSON.stringify(derived.rollbackManifest) &&
    semanticMutationByteDigest(artifacts.originalBytes) === record.beforeByteDigest &&
    semanticMutationByteDigest(artifacts.stagedBytes) === record.committedByteDigest &&
    semanticMutationByteDigest(derived.originalBytes) === record.beforeByteDigest &&
    semanticMutationByteDigest(derived.stagedBytes) === record.committedByteDigest;
}

async function recoverRecord(
  workspaceRoot: string,
  transactionRoot: string,
  record: SemanticMutationRecoveryRecordV1,
  token: WorkspaceWriteLeaseToken,
  isolationCapabilityProbe = DEFAULT_SEMANTIC_MUTATION_ISOLATION_CAPABILITY_PROBE
): Promise<SemanticMutationInternalRecoveryOutcomeV1> {
  if (record.state === 'verified' || record.state === 'rolled-back') {
    throw new Error('Retained terminal history is not recoverable workspace authority');
  }
  if (record.state === 'recovery-required') return { status: 'recovery-required', record };
  let digest: string;
  try {
    const source = await readSemanticMutationSource(workspaceRoot, transactionRoot, record.relativePath);
    digest = semanticMutationByteDigest(source.bytes);
  } catch (error) {
    if (error instanceof WorkspaceWriteLeaseError) throw error;
    return markRecoveryRequired(
      workspaceRoot,
      transactionRoot,
      record,
      token,
      'concurrent-write',
      recoveryDiagnostic('Crash recovery could not safely observe the live source')
    );
  }
  if (digest !== record.beforeByteDigest && digest !== record.committedByteDigest) {
    return markRecoveryRequired(
      workspaceRoot,
      transactionRoot,
      record,
      token,
      'concurrent-write',
      recoveryDiagnostic('Crash recovery detected third-party source bytes')
    );
  }
  if (record.state === 'prepared' && digest === record.beforeByteDigest) {
    let artifactsForPublish: Awaited<ReturnType<typeof readSemanticMutationTransactionArtifacts>> | undefined;
    let bundle: Awaited<ReturnType<typeof buildWorkspaceSemanticBundle>>;
    try {
      await assertWorkspaceWriteLease(workspaceRoot, token);
      bundle = await buildWorkspaceSemanticBundle(workspaceRoot);
    } catch (error) {
      if (error instanceof WorkspaceWriteLeaseError) throw error;
      return markRecoveryRequired(
        workspaceRoot,
        transactionRoot,
        record,
        token,
        'rebuild-failed',
        recoveryDiagnostic('Prepared recovery could not rebuild the live semantic workspace')
      );
    }
    try {
      await assertWorkspaceWriteLease(workspaceRoot, token);
      const base = endpointFromBundle(record.base.transactionId, bundle.snapshot);
      const derived = await fencedWorkspaceWrite(workspaceRoot, token, (commitFence) =>
        deriveStagedSemanticMutation(workspaceRoot, {
          request: record.request,
          base,
          authorization: record.authorization
        }, planningAdapter(workspaceRoot, token, isolationCapabilityProbe), commitFence)
      );
      if (derived.plan.status !== 'ready' || !derived.staged || !derived.stagingWorkspaceRoot ||
        !derived.verificationCapabilityPlan) {
        return rejectPreparedRecovery(
          workspaceRoot,
          transactionRoot,
          record,
          token,
          mutationDiagnostic(
            'SEMANTIC-MUTATION-007',
            'cas',
            'Prepared recovery could not reproduce the retained staged transaction'
          )
        );
      }
      const verification = await fencedWorkspaceWrite(workspaceRoot, token, (commitFence) =>
        runIsolatedVerification(derived as typeof derived & {
          readonly plan: ReadyPlan;
          readonly staged: FactDeltaEndpointContext;
          readonly stagingWorkspaceRoot: string;
          readonly verificationCapabilityPlan: SemanticMutationVerificationCapabilityPlanV1;
        }, {
          commitFence,
          workspaceRoot,
          workspaceWriteLease: token
        })
      );
      const artifacts = await readSemanticMutationTransactionArtifacts(transactionRoot);
      if (!exactPreparedRecoveryBinding(record, derived, verification, artifacts)) {
        return rejectPreparedRecovery(
          workspaceRoot,
          transactionRoot,
          record,
          token,
          mutationDiagnostic(
            verification.verificationExecutionRevision === record.verificationExecutionRevision
              ? 'SEMANTIC-MUTATION-007'
              : 'SEMANTIC-MUTATION-010',
            verification.verificationExecutionRevision === record.verificationExecutionRevision
              ? 'cas'
              : 'impact-verification',
            'Prepared recovery evidence no longer exactly binds the retained transaction'
          )
        );
      }
      artifactsForPublish = artifacts;
    } catch (error) {
      if (error instanceof WorkspaceWriteLeaseError) throw error;
      return rejectPreparedRecovery(
        workspaceRoot,
        transactionRoot,
        record,
        token,
        mutationDiagnostic(
          'SEMANTIC-MUTATION-007',
          'cas',
          'Prepared recovery could not safely reproduce retained transaction evidence'
        )
      );
    }
    if (!artifactsForPublish) throw new Error('Prepared recovery lost its exact publish artifacts');
    await fencedWorkspaceWrite(workspaceRoot, token, (commitFence) =>
      atomicPublishSemanticMutationSource(
        workspaceRoot,
        transactionRoot,
        artifactsForPublish.plan,
        artifactsForPublish.manifest,
        commitFence
      )
    );
  }
  let committedRecord = record;
  if (record.state === 'prepared') {
    committedRecord = await fencedWorkspaceWrite(workspaceRoot, token, (commitFence) =>
      appendSemanticMutationRecoveryRecord(
        transactionRoot,
        nextRecordDraft(record, 'authoring-committed'),
        commitFence
      )
    );
  }
  if (digest === record.beforeByteDigest && record.state === 'authoring-committed') {
    let restored: SemanticMutationBaseV2;
    try {
      restored = await liveRebuild(workspaceRoot, token);
    } catch (error) {
      if (error instanceof WorkspaceWriteLeaseError) throw error;
      return markRecoveryRequired(
        workspaceRoot,
        transactionRoot,
        record,
        token,
        'restore-validation-failed',
        recoveryDiagnostic('Crash recovery could not validate the restored semantic endpoint')
      );
    }
    const plan = readyPlan(record);
    if (restored.inputRevision !== plan.base.inputRevision || restored.semanticRevision !== plan.base.semanticRevision) {
      return markRecoveryRequired(
        workspaceRoot,
        transactionRoot,
        record,
        token,
        'restore-validation-failed',
        recoveryDiagnostic('Crash recovery found restored bytes but not the exact base endpoint')
      );
    }
    const result = buildSemanticMutationResult(plan, {
      status: 'rolled-back',
      transactionId: record.transactionId,
      attempted: plan.staged,
      verification: record.verification as SemanticMutationVerificationExecutionRefV2 & { readonly status: 'passed' },
      diagnostics: [recoveryDiagnostic('Crash recovery verified an already-restored source')]
    });
    if (result.status !== 'rolled-back') throw new Error('Restored recovery did not form rolled-back result');
    await fencedWorkspaceWrite(workspaceRoot, token, (commitFence) =>
      appendSemanticMutationRecoveryRecord(
        transactionRoot,
        nextRecordDraft(record, 'rolled-back', { result, diagnostics: result.diagnostics }),
        commitFence
      )
    );
    return { status: 'terminal', result };
  }
  return completeCommittedMutation(workspaceRoot, transactionRoot, committedRecord, token);
}

interface SemanticMutationRecoveryAuthoritySnapshot {
  readonly unfinished: readonly {
    readonly transactionRoot: string;
    readonly record: SemanticMutationRecoveryRecordV1;
  }[];
  readonly blocked: {
    readonly transactionRoot: string;
    readonly record: SemanticMutationRecoveryRecordV1;
  } | undefined;
}

async function inspectSemanticMutationRecoveryAuthority(
  workspaceRoot: string
): Promise<SemanticMutationRecoveryAuthoritySnapshot> {
  const transactionsRoot = path.join(
    path.resolve(workspaceRoot),
    '.sec',
    'semantic-mutation',
    'v1',
    'transactions'
  );
  let transactionNames: string[];
  try {
    transactionNames = (await readdir(transactionsRoot)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { unfinished: [], blocked: undefined };
    }
    throw error;
  }
  const authorities: Array<{
    readonly transactionRoot: string;
    readonly record: SemanticMutationRecoveryRecordV1;
  }> = [];
  for (const name of transactionNames) {
    const transactionRoot = path.join(transactionsRoot, name);
    await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot);
    if (await readRejectedSemanticMutationTerminal(transactionRoot)) continue;
    const record = await loadLatestSemanticMutationRecoveryRecord(transactionRoot);
    if (record && (record.state === 'prepared' || record.state === 'authoring-committed' ||
      record.state === 'recovery-required')) {
      authorities.push({ transactionRoot, record });
    }
  }
  const unfinished = authorities.filter(({ record }) =>
    record.state === 'prepared' || record.state === 'authoring-committed'
  );
  if (unfinished.length > 1) {
    throw new Error('Semantic Mutation recovery found multiple unfinished transactions');
  }
  return {
    unfinished,
    blocked: authorities.find(({ record }) => record.state === 'recovery-required')
  };
}

async function recoverWithLease(
  workspaceRoot: string,
  token: WorkspaceWriteLeaseToken,
  isolationCapabilityProbe = DEFAULT_SEMANTIC_MUTATION_ISOLATION_CAPABILITY_PROBE
): Promise<SemanticMutationInternalRecoveryOutcomeV1> {
  const { unfinished, blocked } = await inspectSemanticMutationRecoveryAuthority(workspaceRoot);
  if (blocked) return { status: 'recovery-required', record: blocked.record };

  let lastTerminal: SemanticMutationInternalRecoveryOutcomeV1 = { status: 'clean' };
  for (const { transactionRoot, record } of unfinished) {
    const outcome = await recoverRecord(
      workspaceRoot,
      transactionRoot,
      record,
      token,
      isolationCapabilityProbe
    );
    if (outcome.status === 'recovery-required') return outcome;
    if (outcome.status === 'terminal' &&
      (outcome.result.status === 'accepted' || outcome.result.status === 'rolled-back')) {
      await fencedWorkspaceWrite(
        workspaceRoot,
        token,
        (commitFence) => pruneSemanticMutationTerminalRecords(workspaceRoot, commitFence)
      );
    }
    lastTerminal = outcome;
  }
  await fencedWorkspaceWrite(
    workspaceRoot,
    token,
    (commitFence) => pruneSemanticMutationTerminalRecords(workspaceRoot, commitFence)
  );
  return lastTerminal;
}

export async function recoverSemanticMutationWorkspace(
  workspaceRoot: string
): Promise<SemanticMutationRecoveryOutcomeV1> {
  const outcome = await withWorkspaceWriteLease(
    workspaceRoot,
    undefined,
    (token) => recoverWithLease(
      workspaceRoot,
      token,
      DEFAULT_SEMANTIC_MUTATION_ISOLATION_CAPABILITY_PROBE
    )
  );
  return outcome.status === 'recovery-required'
    ? { status: 'recovery-required', record: projectSemanticMutationRequestRecordView(outcome.record) }
    : outcome;
}

export async function querySemanticMutationRequest(
  workspaceRoot: string,
  identity: SemanticMutationRequestIdentityV1
): Promise<SemanticMutationRequestRecordViewV1 | null> {
  const record = await querySemanticMutationRequestRecord(workspaceRoot, identity);
  return record === null ? null : projectSemanticMutationRequestRecordView(record, identity);
}

async function planSemanticMutationTransactionInternal(
  workspaceRoot: string,
  input: SemanticMutationTransactionInputV1,
  isolationCapabilityProbe: SemanticMutationIsolationCapabilityProbeFactoryV1
): Promise<SemanticMutationPlanV2> {
  return withWorkspaceWriteLease(workspaceRoot, undefined, async (token) => {
    const recoveryAuthority = await inspectSemanticMutationRecoveryAuthority(workspaceRoot);
    if (recoveryAuthority.unfinished.length !== 0 || recoveryAuthority.blocked !== undefined) {
      throw new Error(
        'Semantic Mutation planning is blocked by unfinished or recovery-required workspace state'
      );
    }
    return (await fencedWorkspaceWrite(workspaceRoot, token, (commitFence) =>
      deriveStagedSemanticMutation(
        workspaceRoot,
        input,
        planningAdapter(workspaceRoot, token, isolationCapabilityProbe),
        commitFence
      )
    )).plan;
  });
}

export async function planSemanticMutationTransaction(
  workspaceRoot: string,
  input: SemanticMutationTransactionInputV1
): Promise<SemanticMutationPlanV2> {
  return planSemanticMutationTransactionInternal(
    workspaceRoot,
    input,
    DEFAULT_SEMANTIC_MUTATION_ISOLATION_CAPABILITY_PROBE
  );
}

async function applySemanticMutationInternal(
  workspaceRoot: string,
  input: SemanticMutationApplyInputV1,
  options: SemanticMutationInternalApplyOptions = {}
): Promise<SemanticMutationApplyOutcomeV1> {
  const dependencies = coordinatorDependencies(options.testDependencies);
  let normalized: NormalizedSemanticMutationRequestV2;
  try {
    normalized = normalizeSemanticMutationRequest(input.request);
  } catch (error) {
    if (error instanceof SemanticMutationContractError) {
      return requestRejected(untrustedRequestId(input), '', [error.diagnostic]);
    }
    throw error;
  }
  const identity = {
    graphId: normalized.graphId,
    appId: normalized.appId,
    requestId: normalized.requestId
  } as const;
  const requestIdentityDigest = semanticMutationRequestIdentityDigest(identity);
  let handle: Awaited<ReturnType<typeof acquireWorkspaceWriteLease>>;
  try {
    handle = await acquireWorkspaceWriteLease(workspaceRoot);
  } catch (error) {
    if (error instanceof WorkspaceWriteLeaseError) {
      return requestRejected(normalized.requestId, normalized.requestRevision, [mutationDiagnostic(
        'SEMANTIC-MUTATION-007',
        'cas',
        'Workspace writer lease is busy or cannot be safely reclaimed'
      )]);
    }
    throw error;
  }
  const token = handle.token;
  try {
    const recovery = await recoverWithLease(
      workspaceRoot,
      token,
      dependencies.isolationCapabilityProbe
    );
    if (recovery.status === 'recovery-required') {
      if (recovery.record.requestIdentityDigest === requestIdentityDigest) {
        return terminalRecoveryOutcome(recovery);
      }
      return requestRejected(normalized.requestId, normalized.requestRevision, [mutationDiagnostic(
        'SEMANTIC-MUTATION-012',
        'rollback',
        'Workspace has an unresolved Semantic Mutation recovery record'
      )]);
    }
    const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, requestIdentityDigest);
    const retained = await querySemanticMutationRequestRecord(workspaceRoot, identity);
    if (retained) {
      if (retained.requestRevision !== normalized.requestRevision) {
        return requestRejected(normalized.requestId, normalized.requestRevision, [mutationDiagnostic(
          'SEMANTIC-MUTATION-001',
          'request',
          'Retained request identity is already bound to a different request revision'
        )]);
      }
      if ('formatRevision' in retained && retained.formatRevision === 'semantic-mutation-rejected-terminal-record-v1') {
        return { status: 'terminal', result: retained.result };
      }
      if ('state' in retained && (retained.state === 'verified' || retained.state === 'rolled-back')) {
        if (!retained.result) throw new Error('Retained terminal history is missing its immutable result');
        return { status: 'terminal', result: retained.result };
      }
      if ('state' in retained) {
        throw new Error('Semantic Mutation recovery left an unfinished request authority');
      }
    }

    const derived = await fencedWorkspaceWrite(workspaceRoot, token, (commitFence) =>
      dependencies.derive(
        workspaceRoot,
        input,
        planningAdapter(workspaceRoot, token, dependencies.isolationCapabilityProbe),
        commitFence
      )
    );
    if (derived.plan.status === 'rejected') {
      const rejectedPlan = derived.plan;
      if (rejectedPlan.rejectedAt === 'request') {
        return requestRejected(
          rejectedPlan.requestId ?? normalized.requestId,
          normalized.requestRevision,
          rejectedPlan.diagnostics
        );
      }
      const result = buildSemanticMutationResult(rejectedPlan);
      if (result.status !== 'rejected') throw new Error('Rejected plan did not form a rejected result');
      await writeRejectedTerminalAndPrune(
        workspaceRoot,
        transactionRoot,
        token,
        requestIdentityDigest,
        normalized.requestRevision,
        rejectedPlan.planRevision,
        result
      );
      return { status: 'terminal', result };
    }
    if (!derived.transactionRoot || !derived.stagingWorkspaceRoot || !derived.editPlan ||
      !derived.rollbackManifest || !derived.originalBytes || !derived.stagedBytes || !derived.staged ||
      !derived.verificationCapabilityPlan) {
      throw new Error('Ready Semantic Mutation plan is missing staged transaction evidence');
    }
    const ready = derived.plan;
    const editPlan = derived.editPlan;
    const rollbackManifest = derived.rollbackManifest;
    const originalBytes = derived.originalBytes;
    const stagedBytes = derived.stagedBytes;
    if (ready.planRevision !== input.expectedPlanRevision) {
      const result = buildSemanticMutationResult(ready, {
        status: 'rejected',
        diagnostics: [mutationDiagnostic(
          'SEMANTIC-MUTATION-007',
          'cas',
          'Expected plan revision does not match the lease-recomputed plan'
        )]
      });
      if (result.status !== 'rejected') throw new Error('Plan CAS rejection did not form rejected result');
      await writeRejectedTerminalAndPrune(
        workspaceRoot,
        transactionRoot,
        token,
        requestIdentityDigest,
        normalized.requestRevision,
        ready.planRevision,
        result
      );
      return { status: 'terminal', result };
    }

    let isolatedVerificationFailure: SemanticMutationIsolatedVerificationFailure | undefined;
    const verification = await fencedWorkspaceWrite(workspaceRoot, token, (commitFence) =>
      dependencies.verify(derived as typeof derived & {
        readonly plan: ReadyPlan;
        readonly staged: FactDeltaEndpointContext;
        readonly stagingWorkspaceRoot: string;
        readonly verificationCapabilityPlan: SemanticMutationVerificationCapabilityPlanV1;
      }, {
        commitFence,
        recordBlockedFailure: (failure) => {
          isolatedVerificationFailure = failure;
        },
        workspaceRoot,
        workspaceWriteLease: token
      })
    );
    const transactionId = `tx:semantic-mutation-live:${randomUUID()}`;
    if (verification.status !== 'passed') {
      const result = buildSemanticMutationResult(ready, {
        status: 'rejected',
        transactionId,
        attempted: ready.staged,
        verification,
        diagnostics: [mutationDiagnostic(
          'SEMANTIC-MUTATION-010',
          'impact-verification',
          'Isolated Semantic Mutation Verification did not pass',
          isolatedVerificationFailure === undefined
            ? {}
            : { details: { isolatedVerification: isolatedVerificationFailure } }
        )]
      });
      if (result.status !== 'rejected') throw new Error('Verification rejection did not form rejected result');
      await writeRejectedTerminalAndPrune(
        workspaceRoot,
        transactionRoot,
        token,
        requestIdentityDigest,
        normalized.requestRevision,
        ready.planRevision,
        result
      );
      return { status: 'terminal', result };
    }

    await fencedWorkspaceWrite(workspaceRoot, token, (commitFence) =>
      dependencies.writeTransactionArtifacts(
        transactionRoot,
        editPlan,
        rollbackManifest,
        originalBytes,
        stagedBytes,
        commitFence
      )
    );
    let record = await fencedWorkspaceWrite(workspaceRoot, token, (commitFence) =>
      dependencies.appendRecoveryRecord(
        transactionRoot,
        recordDraft(
          'prepared',
          input,
          derived as typeof derived & {
            readonly plan: ReadyPlan;
            readonly editPlan: NonNullable<typeof derived.editPlan>;
            readonly rollbackManifest: NonNullable<typeof derived.rollbackManifest>;
          },
          transactionId,
          requestIdentityDigest,
          verification
        ),
        commitFence
      )
    );
    if (options.testCrashPoint === 'after-prepared') crashAfterPreparedForTest();
    try {
      await assertWorkspaceWriteLease(workspaceRoot, token);
      await dependencies.publishSource(
        workspaceRoot,
        transactionRoot,
        editPlan,
        rollbackManifest,
        () => assertWorkspaceWriteLease(workspaceRoot, token)
      );
    } catch (error) {
      const diagnostic = error instanceof Error && 'diagnostic' in error
        ? (error as { readonly diagnostic: SemanticMutationDiagnosticV2 }).diagnostic
        : mutationDiagnostic('SEMANTIC-MUTATION-011', 'publish', 'Atomic source publish failed');
      let currentDigest: string;
      try {
        const current = await readSemanticMutationSource(workspaceRoot, transactionRoot, editPlan.relativePath);
        currentDigest = semanticMutationByteDigest(current.bytes);
      } catch {
        const recoveryRequired = await markRecoveryRequired(
          workspaceRoot,
          transactionRoot,
          record,
          token,
          'rebuild-failed',
          recoveryDiagnostic('Atomic publish failure could not prove the current live source digest'),
          dependencies
        );
        return terminalRecoveryOutcome(recoveryRequired);
      }
      if (currentDigest === editPlan.stagedByteDigest) {
        record = await fencedWorkspaceWrite(workspaceRoot, token, (commitFence) =>
          dependencies.appendRecoveryRecord(
            transactionRoot,
            nextRecordDraft(record, 'authoring-committed', { diagnostics: [diagnostic] }),
            commitFence
          )
        );
        const rolledBack = await rollbackCommittedMutation(
          workspaceRoot,
          transactionRoot,
          record,
          token,
          diagnostic,
          dependencies
        );
        if (rolledBack.status === 'terminal') {
          await fencedWorkspaceWrite(
            workspaceRoot,
            token,
            (commitFence) => pruneSemanticMutationTerminalRecords(workspaceRoot, commitFence)
          );
          return { status: 'terminal', result: rolledBack.result };
        }
        if (rolledBack.status === 'recovery-required') return terminalRecoveryOutcome(rolledBack);
        throw new Error('Post-publish rollback returned a non-terminal recovery outcome');
      }
      if (currentDigest !== editPlan.beforeByteDigest) {
        const recoveryRequired = await markRecoveryRequired(
          workspaceRoot,
          transactionRoot,
          record,
          token,
          'concurrent-write',
          recoveryDiagnostic('Atomic publish failure left unowned live source bytes'),
          dependencies
        );
        return terminalRecoveryOutcome(recoveryRequired);
      }
      const result = buildSemanticMutationResult(ready, {
        status: 'rejected',
        transactionId,
        attempted: ready.staged,
        verification,
        diagnostics: [diagnostic]
      });
      if (result.status !== 'rejected') throw new Error('Publish rejection did not form rejected result');
      await writeRejectedTerminalAndPrune(
        workspaceRoot,
        transactionRoot,
        token,
        requestIdentityDigest,
        normalized.requestRevision,
        ready.planRevision,
        result
      );
      return { status: 'terminal', result };
    }
    try {
      record = await fencedWorkspaceWrite(workspaceRoot, token, (commitFence) =>
        dependencies.appendRecoveryRecord(
          transactionRoot,
          nextRecordDraft(record, 'authoring-committed'),
          commitFence
        )
      );
    } catch (error) {
      if (error instanceof WorkspaceWriteLeaseError) throw error;
      const recoveryRequired = await markRecoveryRequired(
        workspaceRoot,
        transactionRoot,
        record,
        token,
        'rebuild-failed',
        recoveryDiagnostic('Published source could not durably record its authoring commit'),
        dependencies
      );
      return terminalRecoveryOutcome(recoveryRequired);
    }
    const terminal = await completeCommittedMutation(
      workspaceRoot,
      transactionRoot,
      record,
      token,
      dependencies
    );
    await fencedWorkspaceWrite(
      workspaceRoot,
      token,
      (commitFence) => pruneSemanticMutationTerminalRecords(workspaceRoot, commitFence)
    );
    if (terminal.status === 'terminal') return { status: 'terminal', result: terminal.result };
    if (terminal.status === 'recovery-required') return terminalRecoveryOutcome(terminal);
    throw new Error('Committed Semantic Mutation did not reach a terminal recovery outcome');
  } finally {
    await handle.release();
  }
}

export async function applySemanticMutation(
  workspaceRoot: string,
  input: SemanticMutationApplyInputV1
): Promise<SemanticMutationApplyOutcomeV1> {
  return applySemanticMutationInternal(workspaceRoot, input);
}

/** Internal deterministic crash seam. Deliberately absent from every public façade. */
export async function applySemanticMutationWithAfterPreparedTestCrash(
  workspaceRoot: string,
  input: SemanticMutationApplyInputV1
): Promise<SemanticMutationApplyOutcomeV1> {
  return applySemanticMutationInternal(workspaceRoot, input, { testCrashPoint: 'after-prepared' });
}

/**
 * Internal deterministic planning seam for failure-matrix tests. This symbol is intentionally
 * absent from the orchestrator and compiler façades and must never become a product API.
 */
export async function planSemanticMutationTransactionWithTestDependencies(
  workspaceRoot: string,
  input: SemanticMutationTransactionInputV1,
  testDependencies: SemanticMutationPlanningTestDependencies
): Promise<SemanticMutationPlanV2> {
  return planSemanticMutationTransactionInternal(
    workspaceRoot,
    input,
    testDependencies.isolationCapabilityProbe
  );
}

/**
 * Internal deterministic coordinator seam for failure-matrix tests. This symbol is intentionally
 * absent from the orchestrator and compiler façades and must never become a product API.
 */
export async function applySemanticMutationWithTestDependencies(
  workspaceRoot: string,
  input: SemanticMutationApplyInputV1,
  testDependencies: Partial<SemanticMutationCoordinatorDependencies>
): Promise<SemanticMutationApplyOutcomeV1> {
  return applySemanticMutationInternal(workspaceRoot, input, { testDependencies });
}
