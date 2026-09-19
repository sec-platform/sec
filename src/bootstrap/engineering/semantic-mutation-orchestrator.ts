import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { FactDeltaEndpointContext } from '../../semantics/engineering-ir/delta-types.ts';
import { type SemanticMutationApplyInput, type SemanticMutationApplyOutcome, type SemanticMutationInternalRecoveryOutcome, type SemanticMutationRecoveryFailureState, type SemanticMutationRecoveryOutcome, type SemanticMutationRecoveryRecord, type SemanticMutationRequestIdentity, type SemanticMutationRequestRecordView, type SemanticMutationTransactionInput } from '../../semantics/mutation/transaction.ts';
import type { NormalizedSemanticMutationRequest, SemanticMutationBase, SemanticMutationDiagnostic, SemanticMutationPlan, SemanticMutationResult, SemanticMutationVerificationExecutionRef } from '../../semantics/mutation/types.ts';
import { SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID, SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION, type SemanticMutationVerificationCapabilityPlan } from '../../assurance/verification/contract/types.ts';
import { acquireWorkspaceWriteLease, assertWorkspaceWriteLease, createWorkspaceWriteCommitFence, withWorkspaceWriteLease, WorkspaceWriteLeaseError, type WorkspaceWriteLeaseToken } from '../../adapters/filesystem/write-lease.ts';
import { buildWorkspaceSemanticBundle } from '../../adapters/workspace/semantic-bundle.ts';
import {
  atomicPublishSemanticMutationSource,
  atomicRestoreSemanticMutationSource,
  readSemanticMutationTransactionArtifacts,
  writeSemanticMutationTransactionArtifacts
} from '../../adapters/mutation/atomic-source-publish.ts';
import {
  mutationDiagnostic,
  SemanticMutationContractError,
  semanticMutationByteDigest,
  sha256
} from '../../compiler/semantic-mutation/canonical.ts';
import {
  deriveStagedSemanticMutation,
  type DerivedSemanticMutationTransaction
} from '../../adapters/mutation/derive-staged-mutation.ts';
import {
  appendSemanticMutationRecoveryRecord,
  loadLatestSemanticMutationRecoveryRecord,
  projectSemanticMutationRequestRecordView,
  pruneSemanticMutationTerminalRecords,
  querySemanticMutationRequestRecord,
  recoveryDiagnostic
} from '../../adapters/mutation/mutation-recovery-record.ts';
import { readRejectedSemanticMutationTerminal, writeRejectedSemanticMutationTerminal } from '../../adapters/mutation/mutation-terminal-record.ts';
import {
  inspectSemanticMutationRecoveryAuthority
} from '../../adapters/mutation/recovery-authority.ts';
import { normalizeSemanticMutationRequest } from '../../compiler/semantic-mutation/normalize-request.ts';
import {
  buildSemanticMutationResult,
  buildSemanticMutationVerificationExecutionRef
} from '../../adapters/mutation/semantic-mutation-result.ts';
import { readSemanticMutationSource } from '../../adapters/mutation/source-path-boundary.ts';
import {
  assertSemanticMutationTransactionRoot,
  semanticMutationRequestIdentityDigest,
  semanticMutationTransactionRoot,
  type SemanticMutationCommitFence
} from '../../adapters/mutation/transaction-identity.ts';
import { semanticMutationRequiredVerificationDigest } from '../../compiler/semantic-mutation/verification-policy.ts';
import {
  probeSemanticMutationIsolatedRuntimeCapability,
  runSemanticMutationIsolatedVerificationChild,
  type IsolatedVerificationArtifacts
} from '../../adapters/verification/run-semantic-mutation-isolated-child.ts';
import { semanticMutationIsolatedVerificationEvidenceDigest } from '../../adapters/verification/semantic-mutation-isolated-verification-evidence.ts';
import {
  SemanticMutationIsolatedVerificationUnavailableError,
  type SemanticMutationIsolatedVerificationFailure
} from '../../adapters/verification/semantic-mutation-isolated-verification-failure.ts';
import {
  executeSemanticMutationVerification,
  planSemanticMutationVerificationCapabilities
} from '../../adapters/verification/semantic-mutation-verification-adapter.ts';
import {
  assertStagedVerificationProofBinding,
  issueStagedVerificationProof,
  type StagedVerificationProof
} from '../../adapters/verification/staged-verification-proof.ts';
import {
  buildStagedVerificationProofBinding
} from '../../assurance/verification/staged-proof/contract.ts';
import {
  requireReadySemanticMutationPlan as readyPlan,
  semanticMutationRequestRejected as requestRejected,
  semanticMutationTerminalRecoveryOutcome as terminalRecoveryOutcome,
  semanticMutationUntrustedRequestId as untrustedRequestId,
  type ReadySemanticMutationPlan
} from '../../application/semantic-mutation-state.ts';
import {
  advanceSemanticMutationRecoveryRecord as nextRecordDraft,
  buildPreparedSemanticMutationRecoveryRecord,
  exactPreparedSemanticMutationRecoveryBinding as exactPreparedRecoveryBinding,
  prepareSemanticMutationAcceptedTransition,
  prepareSemanticMutationPreparedRejection,
  prepareSemanticMutationRecoveryRequiredTransition,
  prepareSemanticMutationRolledBackTransition
} from '../../application/semantic-mutation-recovery.ts';
import { planSemanticMutation } from '../../application/semantic-mutation-plan.ts';
import { coordinateSemanticMutationRecovery } from '../../application/semantic-mutation-recovery-coordinator.ts';
import { compileWorkspace } from './pipeline-orchestrator.ts';

type ReadyPlan = ReadySemanticMutationPlan;

interface SemanticMutationInternalApplyOptions {
  readonly testCrashPoint?: 'after-prepared';
  readonly testDependencies?: Partial<SemanticMutationCoordinatorDependencies>;
}

interface SemanticMutationIsolationCapabilityProbeRequest {
  readonly stagingWorkspaceRoot: string;
  readonly workspaceRoot: string;
  readonly workspaceWriteLease: WorkspaceWriteLeaseToken;
}

type SemanticMutationIsolationCapabilityProbeFactory = (
  request: SemanticMutationIsolationCapabilityProbeRequest
) => unknown | Promise<unknown>;

const DEFAULT_SEMANTIC_MUTATION_ISOLATION_CAPABILITY_PROBE:
  SemanticMutationIsolationCapabilityProbeFactory = async (request) => {
    const runtime = await probeSemanticMutationIsolatedRuntimeCapability(
      request.stagingWorkspaceRoot
    );
    return runtime.status === 'available'
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



async function fencedWorkspaceWrite<Value>(
  workspaceRoot: string,
  token: WorkspaceWriteLeaseToken,
  operation: (commitFence: SemanticMutationCommitFence) => Promise<Value>
): Promise<Value> {
  const commitFence = createWorkspaceWriteCommitFence(workspaceRoot, token);
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
  result: Extract<SemanticMutationResult, { readonly status: 'rejected' }>
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







function isolatedVerificationBlockedResult(
  failure?: SemanticMutationIsolatedVerificationFailure
): {
  readonly status: 'blocked';
  readonly evidenceDigest: string;
} {
  return {
    status: 'blocked',
    evidenceDigest: semanticMutationIsolatedVerificationEvidenceDigest({
      status: 'blocked',
      ...(failure === undefined ? {} : { failure })
    })
  };
}

async function runIsolatedVerification(
  derived: DerivedSemanticMutationTransaction & {
    readonly plan: ReadyPlan;
    readonly staged: FactDeltaEndpointContext;
    readonly stagingWorkspaceRoot: string;
    readonly verificationCapabilityPlan: SemanticMutationVerificationCapabilityPlan;
  },
  leaseContext: {
    readonly commitFence: SemanticMutationCommitFence;
    readonly recordBlockedFailure?: (
      failure: SemanticMutationIsolatedVerificationFailure
    ) => void;
    readonly recordPassedVerificationProof?: (
      proof: StagedVerificationProof
    ) => void;
    readonly workspaceRoot: string;
    readonly workspaceWriteLease: WorkspaceWriteLeaseToken;
  }
): Promise<SemanticMutationVerificationExecutionRef> {
  const { commitFence, workspaceRoot, workspaceWriteLease } = leaseContext;
  await commitFence();
  const requiredDigest = semanticMutationRequiredVerificationDigest(derived.plan.requiredVerification);
  let passedArtifacts: IsolatedVerificationArtifacts | undefined;
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
      if (artifacts.status === 'passed') passedArtifacts = artifacts;
      return {
        status: artifacts.status,
        evidenceDigest: semanticMutationIsolatedVerificationEvidenceDigest({
          status: 'passed',
          artifacts
        })
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
  const execution = buildSemanticMutationVerificationExecutionRef(report);
  if (execution.status === 'passed') {
    if (!passedArtifacts) {
      throw new Error('Passed isolated Verification is missing its canonical artifact set');
    }
    const passedExecution = Object.freeze({ ...execution, status: 'passed' as const });
    const evidenceDigest = semanticMutationIsolatedVerificationEvidenceDigest({
      status: 'passed',
      artifacts: passedArtifacts
    });
    if (!passedArtifacts.stagedVerificationProofSource ||
      report.status !== 'passed' || report.executions.some((candidate) =>
        candidate.status !== 'passed' || candidate.runner !== 'verify-all' ||
        candidate.evidenceDigest !== evidenceDigest)) {
      throw new Error('Passed isolated Verification does not own one exact staged proof source');
    }
    const binding = buildStagedVerificationProofBinding(passedExecution, sha256(report));
    const proof = await issueStagedVerificationProof({
      source: passedArtifacts.stagedVerificationProofSource,
      evidenceDigest,
      binding
    });
    assertStagedVerificationProofBinding(proof, binding);
    await commitFence();
    leaseContext.recordPassedVerificationProof?.(proof);
  }
  return execution;
}

async function liveRebuild(
  workspaceRoot: string,
  token: WorkspaceWriteLeaseToken,
  stagedVerificationProof?: StagedVerificationProof
): Promise<SemanticMutationBase> {
  await assertWorkspaceWriteLease(workspaceRoot, token);
  const compiled = await compileWorkspace(workspaceRoot, {
    source: 'api',
    from: 'resolve',
    through: 'emit',
    verificationLane: 'all',
    ...(stagedVerificationProof ? { stagedVerificationProof } : {}),
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
  readonly isolationCapabilityProbe: SemanticMutationIsolationCapabilityProbeFactory;
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



async function markRecoveryRequired(
  workspaceRoot: string,
  transactionRoot: string,
  record: SemanticMutationRecoveryRecord,
  token: WorkspaceWriteLeaseToken,
  recoveryState: SemanticMutationRecoveryFailureState,
  diagnostic: SemanticMutationDiagnostic,
  dependencies: SemanticMutationCoordinatorDependencies =
    DEFAULT_SEMANTIC_MUTATION_COORDINATOR_DEPENDENCIES
): Promise<Extract<SemanticMutationInternalRecoveryOutcome, { readonly status: 'recovery-required' }>> {
  const transition = prepareSemanticMutationRecoveryRequiredTransition(
    record,
    recoveryState,
    diagnostic
  );
  const terminal = await fencedWorkspaceWrite(workspaceRoot, token, commitFence =>
    dependencies.appendRecoveryRecord(transactionRoot, transition.draft, commitFence)
  );
  return { status: 'recovery-required', record: terminal };
}

async function rollbackCommittedMutation(
  workspaceRoot: string,
  transactionRoot: string,
  record: SemanticMutationRecoveryRecord,
  token: WorkspaceWriteLeaseToken,
  cause: SemanticMutationDiagnostic,
  dependencies: SemanticMutationCoordinatorDependencies =
    DEFAULT_SEMANTIC_MUTATION_COORDINATOR_DEPENDENCIES
): Promise<SemanticMutationInternalRecoveryOutcome> {
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
    const transition = prepareSemanticMutationRolledBackTransition(record, cause);
    await fencedWorkspaceWrite(workspaceRoot, token, commitFence =>
      dependencies.appendRecoveryRecord(transactionRoot, transition.draft, commitFence)
    );
    return { status: 'terminal', result: transition.result };
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
  record: SemanticMutationRecoveryRecord,
  token: WorkspaceWriteLeaseToken,
  dependencies: SemanticMutationCoordinatorDependencies =
    DEFAULT_SEMANTIC_MUTATION_COORDINATOR_DEPENDENCIES,
  stagedVerificationProof?: StagedVerificationProof
): Promise<SemanticMutationInternalRecoveryOutcome> {
  const plan = readyPlan(record);
  const verifiedExecution = record.verification as
    SemanticMutationVerificationExecutionRef & { readonly status: 'passed' };
  let result: Extract<SemanticMutationResult, { readonly status: 'accepted' }>;
  try {
    if (stagedVerificationProof) {
      assertStagedVerificationProofBinding(
        stagedVerificationProof,
        buildStagedVerificationProofBinding(
          verifiedExecution,
          stagedVerificationProof.verificationReportDigest
        )
      );
    }
    const accepted = await dependencies.rebuildLive(workspaceRoot, token, stagedVerificationProof);
    const liveSource = await readSemanticMutationSource(workspaceRoot, transactionRoot, record.relativePath);
    if (accepted.inputRevision !== plan.staged.inputRevision ||
      accepted.semanticRevision !== plan.staged.semanticRevision ||
      semanticMutationByteDigest(liveSource.bytes) !== record.committedByteDigest) {
      throw new Error('Live rebuild does not exactly match staged revisions and committed source digest');
    }
    result = prepareSemanticMutationAcceptedTransition(record, accepted).result;
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
    const transition = prepareSemanticMutationAcceptedTransition(record, result.accepted);
    await fencedWorkspaceWrite(workspaceRoot, token, commitFence =>
      dependencies.appendRecoveryRecord(transactionRoot, transition.draft, commitFence)
    );
    return { status: 'terminal', result: transition.result };
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
  record: SemanticMutationRecoveryRecord,
  token: WorkspaceWriteLeaseToken,
  diagnostic: SemanticMutationDiagnostic
): Promise<SemanticMutationInternalRecoveryOutcome> {
  const result = prepareSemanticMutationPreparedRejection(record, diagnostic);
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



async function recoverRecord(
  workspaceRoot: string,
  transactionRoot: string,
  record: SemanticMutationRecoveryRecord,
  token: WorkspaceWriteLeaseToken,
  dependencies: SemanticMutationCoordinatorDependencies =
    DEFAULT_SEMANTIC_MUTATION_COORDINATOR_DEPENDENCIES
): Promise<SemanticMutationInternalRecoveryOutcome> {
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
      recoveryDiagnostic('Crash recovery could not safely observe the live source'),
      dependencies
    );
  }
  if (digest !== record.beforeByteDigest && digest !== record.committedByteDigest) {
    return markRecoveryRequired(
      workspaceRoot,
      transactionRoot,
      record,
      token,
      'concurrent-write',
      recoveryDiagnostic('Crash recovery detected third-party source bytes'),
      dependencies
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
        recoveryDiagnostic('Prepared recovery could not rebuild the live semantic workspace'),
        dependencies
      );
    }
    try {
      await assertWorkspaceWriteLease(workspaceRoot, token);
      const base = endpointFromBundle(record.base.transactionId, bundle.snapshot);
      const derived = await fencedWorkspaceWrite(workspaceRoot, token, (commitFence) =>
        dependencies.derive(workspaceRoot, {
          request: record.request,
          base,
          authorization: record.authorization
        }, planningAdapter(
          workspaceRoot,
          token,
          dependencies.isolationCapabilityProbe
        ), commitFence)
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
        dependencies.verify(derived as typeof derived & {
          readonly plan: ReadyPlan;
          readonly staged: FactDeltaEndpointContext;
          readonly stagingWorkspaceRoot: string;
          readonly verificationCapabilityPlan: SemanticMutationVerificationCapabilityPlan;
        }, {
          commitFence,
          workspaceRoot,
          workspaceWriteLease: token
        })
      );
      const artifacts = await dependencies.readTransactionArtifacts(transactionRoot);
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
      dependencies.publishSource(
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
      dependencies.appendRecoveryRecord(
        transactionRoot,
        nextRecordDraft(record, 'authoring-committed'),
        commitFence
      )
    );
  }
  if (digest === record.beforeByteDigest && record.state === 'authoring-committed') {
    let restored: SemanticMutationBase;
    try {
      restored = await dependencies.rebuildLive(workspaceRoot, token);
    } catch (error) {
      if (error instanceof WorkspaceWriteLeaseError) throw error;
      return markRecoveryRequired(
        workspaceRoot,
        transactionRoot,
        record,
        token,
        'restore-validation-failed',
        recoveryDiagnostic('Crash recovery could not validate the restored semantic endpoint'),
        dependencies
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
        recoveryDiagnostic('Crash recovery found restored bytes but not the exact base endpoint'),
        dependencies
      );
    }
    const transition = prepareSemanticMutationRolledBackTransition(
      record,
      recoveryDiagnostic('Crash recovery verified an already-restored source')
    );
    await fencedWorkspaceWrite(workspaceRoot, token, commitFence =>
      dependencies.appendRecoveryRecord(transactionRoot, transition.draft, commitFence)
    );
    return { status: 'terminal', result: transition.result };
  }
  return completeCommittedMutation(
    workspaceRoot,
    transactionRoot,
    committedRecord,
    token,
    dependencies
  );
}

async function recoverWithLease(
  workspaceRoot: string,
  token: WorkspaceWriteLeaseToken,
  dependencies: SemanticMutationCoordinatorDependencies =
    DEFAULT_SEMANTIC_MUTATION_COORDINATOR_DEPENDENCIES
): Promise<SemanticMutationInternalRecoveryOutcome> {
  return coordinateSemanticMutationRecovery({
    inspectAuthority: () => inspectSemanticMutationRecoveryAuthority(workspaceRoot),
    recoverRecord: (transactionRoot, record) => recoverRecord(
      workspaceRoot,
      transactionRoot,
      record,
      token,
      dependencies
    ),
    prune: () => fencedWorkspaceWrite(
      workspaceRoot,
      token,
      commitFence => pruneSemanticMutationTerminalRecords(workspaceRoot, commitFence)
    )
  });
}

export async function recoverSemanticMutationWorkspace(
  workspaceRoot: string
): Promise<SemanticMutationRecoveryOutcome> {
  const outcome = await withWorkspaceWriteLease(
    workspaceRoot,
    undefined,
    (token) => recoverWithLease(
      workspaceRoot,
      token,
      DEFAULT_SEMANTIC_MUTATION_COORDINATOR_DEPENDENCIES
    )
  );
  return outcome.status === 'recovery-required'
    ? { status: 'recovery-required', record: projectSemanticMutationRequestRecordView(outcome.record) }
    : outcome;
}

/** Internal deterministic recovery seam. Deliberately absent from every public facade. */
export async function recoverSemanticMutationWorkspaceWithTestDependencies(
  workspaceRoot: string,
  testDependencies: Partial<SemanticMutationCoordinatorDependencies>
): Promise<SemanticMutationRecoveryOutcome> {
  const outcome = await withWorkspaceWriteLease(
    workspaceRoot,
    undefined,
    (token) => recoverWithLease(
      workspaceRoot,
      token,
      coordinatorDependencies(testDependencies)
    )
  );
  return outcome.status === 'recovery-required'
    ? { status: 'recovery-required', record: projectSemanticMutationRequestRecordView(outcome.record) }
    : outcome;
}

export async function querySemanticMutationRequest(
  workspaceRoot: string,
  identity: SemanticMutationRequestIdentity
): Promise<SemanticMutationRequestRecordView | null> {
  const record = await querySemanticMutationRequestRecord(workspaceRoot, identity);
  return record === null ? null : projectSemanticMutationRequestRecordView(record, identity);
}

async function planSemanticMutationTransactionInternal(
  workspaceRoot: string,
  input: SemanticMutationTransactionInput,
  isolationCapabilityProbe: SemanticMutationIsolationCapabilityProbeFactory
): Promise<SemanticMutationPlan> {
  return withWorkspaceWriteLease(workspaceRoot, undefined, token => planSemanticMutation({
    inspectRecovery: () => inspectSemanticMutationRecoveryAuthority(workspaceRoot),
    derive: () => fencedWorkspaceWrite(workspaceRoot, token, commitFence =>
      deriveStagedSemanticMutation(
        workspaceRoot,
        input,
        planningAdapter(workspaceRoot, token, isolationCapabilityProbe),
        commitFence
      )
    )
  }));
}

export async function planSemanticMutationTransaction(
  workspaceRoot: string,
  input: SemanticMutationTransactionInput
): Promise<SemanticMutationPlan> {
  return planSemanticMutationTransactionInternal(
    workspaceRoot,
    input,
    DEFAULT_SEMANTIC_MUTATION_ISOLATION_CAPABILITY_PROBE
  );
}

async function applySemanticMutationInternal(
  workspaceRoot: string,
  input: SemanticMutationApplyInput,
  options: SemanticMutationInternalApplyOptions = {}
): Promise<SemanticMutationApplyOutcome> {
  const dependencies = coordinatorDependencies(options.testDependencies);
  let normalized: NormalizedSemanticMutationRequest;
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
      dependencies
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
    let stagedVerificationProof: StagedVerificationProof | undefined;
    const verification = await fencedWorkspaceWrite(workspaceRoot, token, (commitFence) =>
      dependencies.verify(derived as typeof derived & {
        readonly plan: ReadyPlan;
        readonly staged: FactDeltaEndpointContext;
        readonly stagingWorkspaceRoot: string;
        readonly verificationCapabilityPlan: SemanticMutationVerificationCapabilityPlan;
      }, {
        commitFence,
        recordBlockedFailure: (failure) => {
          isolatedVerificationFailure = failure;
        },
        recordPassedVerificationProof: (proof) => {
          stagedVerificationProof = proof;
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
        buildPreparedSemanticMutationRecoveryRecord({
          request: input,
          plan: ready,
          editPlan,
          rollbackManifest,
          transactionId,
          requestIdentityDigest,
          verification
        }),
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
        ? (error as { readonly diagnostic: SemanticMutationDiagnostic }).diagnostic
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
      dependencies,
      stagedVerificationProof
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
  input: SemanticMutationApplyInput
): Promise<SemanticMutationApplyOutcome> {
  return applySemanticMutationInternal(workspaceRoot, input);
}

/** Internal deterministic crash seam. Deliberately absent from every public façade. */
export async function applySemanticMutationWithAfterPreparedTestCrash(
  workspaceRoot: string,
  input: SemanticMutationApplyInput,
  testDependencies: Partial<SemanticMutationCoordinatorDependencies>
): Promise<SemanticMutationApplyOutcome> {
  return applySemanticMutationInternal(workspaceRoot, input, {
    testCrashPoint: 'after-prepared',
    testDependencies
  });
}

/**
 * Internal deterministic planning seam for failure-matrix tests. This symbol is intentionally
 * absent from the orchestrator and compiler façades and must never become a product API.
 */
export async function planSemanticMutationTransactionWithTestDependencies(
  workspaceRoot: string,
  input: SemanticMutationTransactionInput,
  testDependencies: SemanticMutationPlanningTestDependencies
): Promise<SemanticMutationPlan> {
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
  input: SemanticMutationApplyInput,
  testDependencies: Partial<SemanticMutationCoordinatorDependencies>
): Promise<SemanticMutationApplyOutcome> {
  return applySemanticMutationInternal(workspaceRoot, input, { testDependencies });
}
