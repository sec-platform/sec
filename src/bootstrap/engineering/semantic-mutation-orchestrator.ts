import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { FactDeltaEndpointContext } from '../../semantics/engineering-ir/delta-types.ts';
import { type SemanticMutationApplyInput, type SemanticMutationApplyOutcome, type SemanticMutationInternalRecoveryOutcome, type SemanticMutationRecoveryOutcome, type SemanticMutationRecoveryRecord, type SemanticMutationRequestIdentity, type SemanticMutationRequestRecordView, type SemanticMutationTransactionInput } from '../../semantics/mutation/transaction.ts';
import type { SemanticMutationBase, SemanticMutationPlan, SemanticMutationResult, SemanticMutationVerificationExecutionRef } from '../../semantics/mutation/types.ts';
import { SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID, SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION, type SemanticMutationVerificationCapabilityPlan } from '../../assurance/verification/contract/types.ts';
import { acquireWorkspaceWriteLease, assertWorkspaceWriteLease, withWorkspaceWriteLease, WorkspaceWriteLeaseError, type WorkspaceWriteLeaseToken } from '../../adapters/filesystem/write-lease.ts';
import { buildWorkspaceSemanticBundle } from '../../adapters/workspace/semantic-bundle.ts';
import {
  atomicPublishSemanticMutationSource,
  atomicRestoreSemanticMutationSource,
  readSemanticMutationTransactionArtifacts,
  writeSemanticMutationTransactionArtifacts
} from '../../adapters/mutation/atomic-source-publish.ts';
import { semanticMutationByteDigest } from '../../compiler/semantic-mutation/canonical.ts';
import {
  deriveStagedSemanticMutation,
  type DerivedSemanticMutationTransaction
} from '../../adapters/mutation/derive-staged-mutation.ts';
import {
  appendSemanticMutationRecoveryRecord,
  loadLatestSemanticMutationRecoveryRecord,
  pruneSemanticMutationTerminalRecords,
  querySemanticMutationRequestRecord
} from '../../adapters/mutation/mutation-recovery-record.ts';
import { readRejectedSemanticMutationTerminal, writeRejectedSemanticMutationTerminal } from '../../adapters/mutation/mutation-terminal-record.ts';
import {
  inspectSemanticMutationRecoveryAuthority
} from '../../adapters/mutation/recovery-authority.ts';
import {
  buildSemanticMutationVerificationExecutionRef
} from '../../assurance/verification/semantic-mutation/execution-ref.ts';
import { readSemanticMutationSource } from '../../adapters/mutation/source-path-boundary.ts';
import {
  assertSemanticMutationTransactionRoot,
  semanticMutationTransactionRoot,
  type SemanticMutationCommitFence
} from '../../adapters/mutation/transaction-identity.ts';
import {
  runSemanticMutationIsolatedVerificationChild
} from '../../adapters/verification/run-semantic-mutation-isolated-child.ts';
import { semanticMutationIsolatedVerificationEvidenceDigest } from '../../assurance/verification/semantic-mutation/isolated-evidence.ts';
import {
  SemanticMutationIsolatedVerificationUnavailableError,
  type SemanticMutationIsolatedVerificationFailure
} from '../../adapters/verification/semantic-mutation-isolated-verification-failure.ts';
import {
  executeSemanticMutationVerification
} from '../../adapters/verification/semantic-mutation-verification-adapter.ts';
import {
  createSemanticMutationVerificationPlanningAdapter,
  DEFAULT_SEMANTIC_MUTATION_ISOLATION_CAPABILITY_PROBE,
  type SemanticMutationIsolationCapabilityProbeFactory
} from '../../adapters/verification/semantic-mutation-planning-adapter.ts';
import {
  assertStagedVerificationProofBinding,
  issueStagedVerificationProof,
  type StagedVerificationProof
} from '../../adapters/verification/staged-verification-proof.ts';
import { type ReadySemanticMutationPlan } from '../../application/semantic-mutation-state.ts';
import {
  advanceSemanticMutationRecoveryRecord as nextRecordDraft,
  buildPreparedSemanticMutationRecoveryRecord
} from '../../application/semantic-mutation-recovery.ts';
import { planSemanticMutation } from '../../application/semantic-mutation-plan.ts';
import {
  coordinateSemanticMutationRecovery,
  projectSemanticMutationRecoveryOutcome
} from '../../application/semantic-mutation-recovery-coordinator.ts';
import {
  recoverSemanticMutationRecord,
  type SemanticMutationPreparedRecoveryDerivation,
  type SemanticMutationRecordRecoveryOperations
} from '../../application/semantic-mutation-record-recovery.ts';
import { publishRejectedSemanticMutationTerminal } from '../../application/semantic-mutation-terminal-publication.ts';
import {
  projectSemanticMutationRequestRecordView,
  querySemanticMutationRequestView
} from '../../application/semantic-mutation-query.ts';
import {
  executePreparedSemanticMutationApply,
  prepareSemanticMutationApply,
  rejectSemanticMutationWorkspaceWriterAdmission,
  type ReadySemanticMutationApplyDerivation
} from '../../application/semantic-mutation-apply.ts';
import {
  coordinateSemanticMutationIsolatedVerification,
  type SemanticMutationIsolationFailureObservation
} from '../../application/semantic-mutation-isolated-verification.ts';
import { compileWorkspace } from './pipeline-orchestrator.ts';
import { executeWorkspaceWriteEffect } from '../../adapters/filesystem/workspace-write-effect.ts';
import { projectSemanticMutationLiveRebuild } from '../../application/semantic-mutation-live-rebuild.ts';

type ReadyPlan = ReadySemanticMutationPlan;

interface SemanticMutationInternalApplyOptions {
  readonly testCrashPoint?: 'after-prepared';
  readonly testDependencies?: Partial<SemanticMutationCoordinatorDependencies>;
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
  return publishRejectedSemanticMutationTerminal({
    publish: () => executeWorkspaceWriteEffect(workspaceRoot, token, commitFence =>
      writeRejectedSemanticMutationTerminal(
        transactionRoot,
        requestIdentityDigest,
        requestRevision,
        planRevision,
        result,
        commitFence
      )
    ),
    prune: () => executeWorkspaceWriteEffect(
      workspaceRoot,
      token,
      commitFence => pruneSemanticMutationTerminalRecords(workspaceRoot, commitFence)
    )
  });
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
  return coordinateSemanticMutationIsolatedVerification(
    derived.plan,
    derived.verificationCapabilityPlan,
    {
      commitFence,
      executeVerification: executeSemanticMutationVerification,
      runArtifacts: () => runSemanticMutationIsolatedVerificationChild(
        derived.stagingWorkspaceRoot,
        {
          capabilityPlan: derived.verificationCapabilityPlan,
          workspaceRoot,
          workspaceWriteLease
        }
      ),
      classifyFailure: (error): SemanticMutationIsolationFailureObservation =>
        error instanceof SemanticMutationIsolatedVerificationUnavailableError
          ? error.failure
          : Object.freeze({ stage: 'binding-mismatch' as const }),
      blockedEvidenceDigest: failure =>
        semanticMutationIsolatedVerificationEvidenceDigest({
          status: 'blocked',
          failure: failure as SemanticMutationIsolatedVerificationFailure
        }),
      buildExecutionRef: buildSemanticMutationVerificationExecutionRef,
      issueProof: issueStagedVerificationProof,
      assertProofBinding: assertStagedVerificationProofBinding,
      ...(leaseContext.recordBlockedFailure === undefined
        ? {}
        : {
            recordBlockedFailure: failure =>
              leaseContext.recordBlockedFailure!(
                failure as SemanticMutationIsolatedVerificationFailure
              )
          }),
      ...(leaseContext.recordPassedVerificationProof === undefined
        ? {}
        : { recordPassedVerificationProof: leaseContext.recordPassedVerificationProof })
    }
  );
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
  return projectSemanticMutationLiveRebuild(compiled);
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



function semanticMutationRecordRecoveryOperations(
  workspaceRoot: string,
  transactionRoot: string,
  record: SemanticMutationRecoveryRecord,
  token: WorkspaceWriteLeaseToken,
  dependencies: SemanticMutationCoordinatorDependencies
): SemanticMutationRecordRecoveryOperations {
  return {
    isExecutionBoundaryFailure: error => error instanceof WorkspaceWriteLeaseError,
    observeLiveDigest: async record => {
      const source = await readSemanticMutationSource(
        workspaceRoot,
        transactionRoot,
        record.relativePath
      );
      return semanticMutationByteDigest(source.bytes);
    },
    appendDraft: draft => executeWorkspaceWriteEffect(
      workspaceRoot,
      token,
      commitFence => dependencies.appendRecoveryRecord(
        transactionRoot,
        draft,
        commitFence
      )
    ),
    restoreSource: async () => {
      await assertWorkspaceWriteLease(workspaceRoot, token);
      const artifacts = await dependencies.readTransactionArtifacts(transactionRoot);
      return dependencies.restoreSource(
        workspaceRoot,
        transactionRoot,
        artifacts.plan,
        artifacts.manifest,
        () => assertWorkspaceWriteLease(workspaceRoot, token)
      );
    },
    rebuildLive: proof => dependencies.rebuildLive(workspaceRoot, token, proof),
    assertProofBinding: assertStagedVerificationProofBinding,
    buildPreparedBase: async record => {
      await assertWorkspaceWriteLease(workspaceRoot, token);
      const bundle = await buildWorkspaceSemanticBundle(workspaceRoot);
      return endpointFromBundle(record.base.transactionId, bundle.snapshot);
    },
    derivePrepared: async (current, base) => {
      await assertWorkspaceWriteLease(workspaceRoot, token);
      return executeWorkspaceWriteEffect(
        workspaceRoot,
        token,
        commitFence => dependencies.derive(
          workspaceRoot,
          {
            request: current.request,
            base,
            authorization: current.authorization
          },
          createSemanticMutationVerificationPlanningAdapter({
            adapterId: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID,
            adapterRevision: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION,
            workspaceRoot,
            workspaceWriteLease: token,
            isolationCapabilityProbe: dependencies.isolationCapabilityProbe
          }),
          commitFence
        )
      ) as Promise<SemanticMutationPreparedRecoveryDerivation>;
    },
    verifyPrepared: derived => executeWorkspaceWriteEffect(
      workspaceRoot,
      token,
      commitFence => dependencies.verify(
        derived as DerivedSemanticMutationTransaction & {
          readonly plan: ReadyPlan;
          readonly staged: FactDeltaEndpointContext;
          readonly stagingWorkspaceRoot: string;
          readonly verificationCapabilityPlan: SemanticMutationVerificationCapabilityPlan;
        },
        {
          commitFence,
          workspaceRoot,
          workspaceWriteLease: token
        }
      )
    ),
    readPreparedArtifacts: () => dependencies.readTransactionArtifacts(transactionRoot),
    publishPreparedArtifacts: artifacts => executeWorkspaceWriteEffect(
      workspaceRoot,
      token,
      commitFence => dependencies.publishSource(
        workspaceRoot,
        transactionRoot,
        artifacts.plan,
        artifacts.manifest,
        commitFence
      )
    ),
    publishRejected: result => writeRejectedTerminalAndPrune(
      workspaceRoot,
      transactionRoot,
      token,
      record.requestIdentityDigest,
      record.requestRevision,
      record.planRevision,
      result
    )
  };
}

async function recoverRecord(
  workspaceRoot: string,
  transactionRoot: string,
  record: SemanticMutationRecoveryRecord,
  token: WorkspaceWriteLeaseToken,
  dependencies: SemanticMutationCoordinatorDependencies =
    DEFAULT_SEMANTIC_MUTATION_COORDINATOR_DEPENDENCIES
): Promise<SemanticMutationInternalRecoveryOutcome> {
  return recoverSemanticMutationRecord(
    record,
    semanticMutationRecordRecoveryOperations(
      workspaceRoot,
      transactionRoot,
      record,
      token,
      dependencies
    )
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
    prune: () => executeWorkspaceWriteEffect(
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
  return projectSemanticMutationRecoveryOutcome(outcome);
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
  return projectSemanticMutationRecoveryOutcome(outcome);
}

export function querySemanticMutationRequest(
  workspaceRoot: string,
  identity: SemanticMutationRequestIdentity
): Promise<SemanticMutationRequestRecordView | null> {
  return querySemanticMutationRequestView(identity, {
    read: requested => querySemanticMutationRequestRecord(workspaceRoot, requested),
    project: (record, requested) => projectSemanticMutationRequestRecordView(record, requested)
  });
}

async function planSemanticMutationTransactionInternal(
  workspaceRoot: string,
  input: SemanticMutationTransactionInput,
  isolationCapabilityProbe: SemanticMutationIsolationCapabilityProbeFactory
): Promise<SemanticMutationPlan> {
  return withWorkspaceWriteLease(workspaceRoot, undefined, token => planSemanticMutation({
    inspectRecovery: () => inspectSemanticMutationRecoveryAuthority(workspaceRoot),
    derive: () => executeWorkspaceWriteEffect(workspaceRoot, token, commitFence =>
      deriveStagedSemanticMutation(
        workspaceRoot,
        input,
        createSemanticMutationVerificationPlanningAdapter({
        adapterId: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID,
        adapterRevision: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION,
        workspaceRoot,
        workspaceWriteLease: token,
        isolationCapabilityProbe
      }),
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
  const preparation = prepareSemanticMutationApply(input);
  if (preparation.status === 'rejected') return preparation.outcome;
  const prepared = preparation.prepared;

  let handle: Awaited<ReturnType<typeof acquireWorkspaceWriteLease>>;
  try {
    handle = await acquireWorkspaceWriteLease(workspaceRoot);
  } catch (error) {
    if (error instanceof WorkspaceWriteLeaseError) {
      return rejectSemanticMutationWorkspaceWriterAdmission(prepared);
    }
    throw error;
  }

  const token = handle.token;
  const transactionRoot = semanticMutationTransactionRoot(
    workspaceRoot,
    prepared.requestIdentityDigest
  );
  try {
    return await executePreparedSemanticMutationApply(prepared, {
      recover: () => recoverWithLease(workspaceRoot, token, dependencies),
      readRetained: identity => querySemanticMutationRequestRecord(workspaceRoot, identity),
      derive: () => executeWorkspaceWriteEffect(workspaceRoot, token, commitFence =>
        dependencies.derive(
          workspaceRoot,
          input,
          createSemanticMutationVerificationPlanningAdapter({
            adapterId: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID,
            adapterRevision: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION,
            workspaceRoot,
            workspaceWriteLease: token,
            isolationCapabilityProbe: dependencies.isolationCapabilityProbe
          }),
          commitFence
        )
      ),
      publishRejected: (result, planRevision) => writeRejectedTerminalAndPrune(
        workspaceRoot,
        transactionRoot,
        token,
        prepared.requestIdentityDigest,
        prepared.normalized.requestRevision,
        planRevision,
        result
      ),
      verify: async derived => {
        let isolatedVerificationFailure: SemanticMutationIsolatedVerificationFailure | undefined;
        let stagedVerificationProof: StagedVerificationProof | undefined;
        const verification = await executeWorkspaceWriteEffect(
          workspaceRoot,
          token,
          commitFence => dependencies.verify(
            derived as DerivedSemanticMutationTransaction & ReadySemanticMutationApplyDerivation,
            {
              commitFence,
              recordBlockedFailure: failure => { isolatedVerificationFailure = failure; },
              recordPassedVerificationProof: proof => { stagedVerificationProof = proof; },
              workspaceRoot,
              workspaceWriteLease: token
            }
          )
        );
        return {
          verification,
          ...(isolatedVerificationFailure === undefined
            ? {}
            : { isolatedVerificationFailure }),
          ...(stagedVerificationProof === undefined ? {} : { stagedVerificationProof })
        };
      },
      issueTransactionId: () => `tx:semantic-mutation-live:${randomUUID()}`,
      writeTransactionArtifacts: derived => executeWorkspaceWriteEffect(
        workspaceRoot,
        token,
        commitFence => dependencies.writeTransactionArtifacts(
          transactionRoot,
          derived.editPlan,
          derived.rollbackManifest,
          derived.originalBytes,
          derived.stagedBytes,
          commitFence
        )
      ),
      persistPrepared: (derived, verification, transactionId) =>
        executeWorkspaceWriteEffect(workspaceRoot, token, commitFence =>
          dependencies.appendRecoveryRecord(
            transactionRoot,
            buildPreparedSemanticMutationRecoveryRecord({
              request: input,
              plan: derived.plan,
              editPlan: derived.editPlan,
              rollbackManifest: derived.rollbackManifest,
              transactionId,
              requestIdentityDigest: prepared.requestIdentityDigest,
              verification
            }),
            commitFence
          )
        ),
      ...(options.testCrashPoint === 'after-prepared'
        ? { afterPrepared: crashAfterPreparedForTest }
        : {}),
      publishSource: async derived => {
        await assertWorkspaceWriteLease(workspaceRoot, token);
        return dependencies.publishSource(
          workspaceRoot,
          transactionRoot,
          derived.editPlan,
          derived.rollbackManifest,
          () => assertWorkspaceWriteLease(workspaceRoot, token)
        );
      },
      observeCurrentDigest: async derived => {
        const current = await readSemanticMutationSource(
          workspaceRoot,
          transactionRoot,
          derived.editPlan.relativePath
        );
        return semanticMutationByteDigest(current.bytes);
      },
      appendAuthoringCommitted: (record, diagnostics) =>
        executeWorkspaceWriteEffect(workspaceRoot, token, commitFence =>
          dependencies.appendRecoveryRecord(
            transactionRoot,
            nextRecordDraft(
              record,
              'authoring-committed',
              diagnostics === undefined ? {} : { diagnostics }
            ),
            commitFence
          )
        ),
      markRecoveryRequired: (record, state, diagnostic) => markRecoveryRequired(
        workspaceRoot,
        transactionRoot,
        record,
        token,
        state,
        diagnostic,
        dependencies
      ),
      rollbackCommitted: (record, diagnostic) => rollbackCommittedMutation(
        workspaceRoot,
        transactionRoot,
        record,
        token,
        diagnostic,
        dependencies
      ),
      completeCommitted: (record, proof) => completeCommittedMutation(
        workspaceRoot,
        transactionRoot,
        record,
        token,
        dependencies,
        proof
      ),
      prune: () => executeWorkspaceWriteEffect(
        workspaceRoot,
        token,
        commitFence => pruneSemanticMutationTerminalRecords(workspaceRoot, commitFence)
      ),
      isExecutionBoundaryFailure: error => error instanceof WorkspaceWriteLeaseError
    });
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
