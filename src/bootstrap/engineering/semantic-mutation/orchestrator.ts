import { randomUUID } from 'node:crypto';
import { executeWorkspaceWriteEffect } from '../../../adapters/filesystem/workspace-write-effect.ts';
import { acquireWorkspaceWriteLease, assertWorkspaceWriteLease, withWorkspaceWriteLease, WorkspaceWriteLeaseError, type WorkspaceWriteLeaseToken } from '../../../adapters/filesystem/write-lease.ts';
import {
  atomicPublishSemanticMutationSource,
  atomicRestoreSemanticMutationSource,
  readSemanticMutationTransactionArtifacts,
  settleSemanticMutationSourceReplacementResidue,
  writeSemanticMutationTransactionArtifacts
} from '../../../adapters/mutation/atomic-source-publish.ts';
import {
  deriveStagedSemanticMutation,
  type DerivedSemanticMutationTransaction
} from '../../../adapters/mutation/derive-staged-mutation.ts';
import {
  appendSemanticMutationRecoveryRecord,
  pruneSemanticMutationTerminalRecords,
  querySemanticMutationRequestRecord
} from '../../../adapters/mutation/mutation-recovery-record.ts';
import { writeRejectedSemanticMutationTerminal } from '../../../adapters/mutation/mutation-terminal-record.ts';
import {
  inspectSemanticMutationRecoveryAuthority
} from '../../../adapters/mutation/recovery-authority.ts';
import { readSemanticMutationSource } from '../../../adapters/mutation/source-path-boundary.ts';
import { migrateSemanticMutationStateLayout } from '../../../adapters/mutation/state-layout-migration.ts';
import {
  semanticMutationTransactionRoot,
  type SemanticMutationCommitFence
} from '../../../adapters/mutation/transaction-identity.ts';
import {
  runIsolatedVerificationChild
} from '../../../adapters/verification/semantic-mutation/isolated/child.ts';
import {
  IsolatedVerificationUnavailableError,
  type IsolatedVerificationFailure
} from '../../../adapters/verification/semantic-mutation/isolated/verification-failure.ts';
import {
  createSemanticMutationVerificationPlanningAdapter,
  DEFAULT_SEMANTIC_MUTATION_ISOLATION_CAPABILITY_PROBE,
  type SemanticMutationIsolationCapabilityProbeFactory
} from '../../../adapters/verification/semantic-mutation/planning.ts';
import {
  assertStagedVerificationProofBinding,
  issueStagedVerificationProof
} from '../../../adapters/verification/staged-verification-proof.ts';
import { buildWorkspaceSemanticBundle } from '../../../adapters/workspace/semantic-bundle.ts';
import {
  executePreparedSemanticMutationApply,
  executeSemanticMutationApplyAdmission,
  type PreparedSemanticMutationApply,
  type ReadySemanticMutationApplyDerivation
} from '../../../application/semantic-mutation/apply.ts';
import {
  coordinateSemanticMutationIsolatedVerification,
  type IsolationFailureObservation
} from '../../../application/semantic-mutation/isolated/verification.ts';
import { projectSemanticMutationLiveRebuild } from '../../../application/semantic-mutation/live-rebuild.ts';
import { planSemanticMutation } from '../../../application/semantic-mutation/plan.ts';
import {
  projectSemanticMutationRequestRecordView,
  querySemanticMutationRequestView
} from '../../../application/semantic-mutation/query.ts';
import {
  completeCommitted as completeCommittedSemanticMutation,
  markRecoveryRequired as markSemanticMutationRecoveryRequired,
  recoverSemanticMutationRecord,
  rollbackCommitted as rollbackCommittedSemanticMutation,
  type SemanticMutationPreparedRecoveryDerivation,
  type SemanticMutationRecordRecoveryOperations
} from '../../../application/semantic-mutation/record-recovery.ts';
import {
  coordinateSemanticMutationRecovery,
  projectSemanticMutationRecoveryOutcome
} from '../../../application/semantic-mutation/recovery-coordinator.ts';
import {
  buildPreparedSemanticMutationRecoveryRecord,
  advanceSemanticMutationRecoveryRecord as nextRecordDraft
} from '../../../application/semantic-mutation/recovery.ts';
import { type ReadySemanticMutationPlan } from '../../../application/semantic-mutation/state.ts';
import { publishRejectedSemanticMutationTerminal } from '../../../application/semantic-mutation/terminal-publication.ts';
import { SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID, SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION, type SemanticMutationVerificationCapabilityPlan } from '../../../assurance/verification/contract/types.ts';
import {
  buildSemanticMutationVerificationExecutionRef
} from '../../../assurance/verification/semantic-mutation/execution-ref.ts';
import { isolatedVerificationEvidenceDigest } from '../../../assurance/verification/semantic-mutation/isolated/evidence.ts';
import {
  executeSemanticMutationVerification
} from '../../../assurance/verification/semantic-mutation/verification-runtime.ts';
import type { StagedVerificationProof } from '../../../assurance/verification/staged-proof/contract.ts';
import { semanticMutationByteDigest } from '../../../compiler/semantic-mutation/canonical.ts';
import type { FactDeltaEndpointContext } from '../../../semantics/engineering-ir/delta-types.ts';
import { type SemanticMutationApplyInput, type SemanticMutationApplyOutcome, type SemanticMutationInternalRecoveryOutcome, type SemanticMutationRecoveryOutcome, type SemanticMutationRecoveryRecord, type SemanticMutationRequestIdentity, type SemanticMutationRequestRecordView, type SemanticMutationTransactionInput } from '../../../semantics/mutation/transaction.ts';
import type { SemanticMutationBase, SemanticMutationPlan, SemanticMutationResult, SemanticMutationVerificationExecutionRef } from '../../../semantics/mutation/types.ts';
import { compileWorkspace } from '../pipeline-orchestrator.ts';

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
    publish: async () => {
      await executeWorkspaceWriteEffect(workspaceRoot, token, commitFence =>
        writeRejectedSemanticMutationTerminal(
          transactionRoot,
          requestIdentityDigest,
          requestRevision,
          planRevision,
          result,
          commitFence
        )
      );
    },
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
      failure: IsolatedVerificationFailure
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
      runArtifacts: () => runIsolatedVerificationChild(
        derived.stagingWorkspaceRoot,
        {
          capabilityPlan: derived.verificationCapabilityPlan,
          workspaceRoot,
          workspaceWriteLease
        }
      ),
      classifyFailure: (error): IsolationFailureObservation =>
        error instanceof IsolatedVerificationUnavailableError
          ? error.failure
          : Object.freeze({ stage: 'binding-mismatch' as const }),
      blockedEvidenceDigest: failure =>
        isolatedVerificationEvidenceDigest({
          status: 'blocked',
          failure: failure as IsolatedVerificationFailure
        }),
      buildExecutionRef: buildSemanticMutationVerificationExecutionRef,
      issueProof: issueStagedVerificationProof,
      assertProofBinding: assertStagedVerificationProofBinding,
      ...(leaseContext.recordBlockedFailure === undefined
        ? {}
        : {
            recordBlockedFailure: failure =>
              leaseContext.recordBlockedFailure!(
                failure as IsolatedVerificationFailure
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
  readonly settleSourceReplacementResidue: typeof settleSemanticMutationSourceReplacementResidue;
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
    settleSourceReplacementResidue: settleSemanticMutationSourceReplacementResidue,
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
    settleSourceReplacementResidue: () => executeWorkspaceWriteEffect(
      workspaceRoot,
      token,
      async commitFence => {
        const artifacts = await dependencies.readTransactionArtifacts(transactionRoot);
        await dependencies.settleSourceReplacementResidue(
          workspaceRoot,
          transactionRoot,
          artifacts.plan,
          artifacts.manifest,
          artifacts.originalBytes,
          artifacts.stagedBytes,
          commitFence
        );
      }
    ),
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
      return {
        transactionId: record.base.transactionId,
        inputRevision: bundle.snapshot.ir.inputRevision,
        semanticRevision: bundle.snapshot.ir.semanticRevision,
        snapshot: bundle.snapshot
      };
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
  await executeWorkspaceWriteEffect(
    workspaceRoot,
    token,
    commitFence => migrateSemanticMutationStateLayout(workspaceRoot, commitFence)
  );
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
  return withWorkspaceWriteLease(workspaceRoot, undefined, async token => {
    await executeWorkspaceWriteEffect(
      workspaceRoot,
      token,
      commitFence => migrateSemanticMutationStateLayout(workspaceRoot, commitFence)
    );
    return planSemanticMutation({
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
    });
  });
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

function crashAfterPreparedForTest(): never {
  const error = new Error(
    'Semantic Mutation test crash after the prepared generation became durable'
  ) as NodeJS.ErrnoException;
  error.name = 'SemanticMutationAfterPreparedTestCrash';
  error.code = 'SEMANTIC_MUTATION_TEST_CRASH_AFTER_PREPARED';
  throw error;
}

async function applySemanticMutationInternal(
  workspaceRoot: string,
  input: SemanticMutationApplyInput,
  options: SemanticMutationInternalApplyOptions = {}
): Promise<SemanticMutationApplyOutcome> {
  const dependencies = coordinatorDependencies(options.testDependencies);
  return executeSemanticMutationApplyAdmission(input, {
    acquire: async () => {
      const handle = await acquireWorkspaceWriteLease(workspaceRoot);
      return {
        lease: handle.token,
        release: () => handle.release()
      };
    },
    isWriterAdmissionFailure: error => error instanceof WorkspaceWriteLeaseError,
    execute: async (prepared: PreparedSemanticMutationApply, token) => {
      await executeWorkspaceWriteEffect(
        workspaceRoot,
        token,
        commitFence => migrateSemanticMutationStateLayout(workspaceRoot, commitFence)
      );
      const transactionRoot = semanticMutationTransactionRoot(
        workspaceRoot,
        prepared.requestIdentityDigest
      );
      return executePreparedSemanticMutationApply(prepared, {
        recover: () => recoverWithLease(workspaceRoot, token, dependencies),
        readRetained: identity =>
          querySemanticMutationRequestRecord(workspaceRoot, identity),
        derive: () => executeWorkspaceWriteEffect(
          workspaceRoot,
          token,
          commitFence => dependencies.derive(
            workspaceRoot,
            prepared.input,
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
        publishRejected: (result, planRevision) =>
          writeRejectedTerminalAndPrune(
            workspaceRoot,
            transactionRoot,
            token,
            prepared.requestIdentityDigest,
            prepared.normalized.requestRevision,
            planRevision,
            result
          ),
        verify: async derived => {
          let isolatedVerificationFailure:
            IsolatedVerificationFailure | undefined;
          let stagedVerificationProof: StagedVerificationProof | undefined;
          const verification = await executeWorkspaceWriteEffect(
            workspaceRoot,
            token,
            commitFence => dependencies.verify(
              derived as DerivedSemanticMutationTransaction &
                ReadySemanticMutationApplyDerivation,
              {
                commitFence,
                recordBlockedFailure: failure => {
                  isolatedVerificationFailure = failure;
                },
                recordPassedVerificationProof: proof => {
                  stagedVerificationProof = proof;
                },
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
            ...(stagedVerificationProof === undefined
              ? {}
              : { stagedVerificationProof })
          };
        },
        issueTransactionId: () => `tx:semantic-mutation-live:${randomUUID()}`,
        writeTransactionArtifacts: async derived => {
          await executeWorkspaceWriteEffect(
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
          );
        },
        persistPrepared: (derived, verification, transactionId) =>
          executeWorkspaceWriteEffect(
            workspaceRoot,
            token,
            commitFence => dependencies.appendRecoveryRecord(
              transactionRoot,
              buildPreparedSemanticMutationRecoveryRecord({
                request: prepared.input,
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
          executeWorkspaceWriteEffect(
            workspaceRoot,
            token,
            commitFence => dependencies.appendRecoveryRecord(
              transactionRoot,
              nextRecordDraft(
                record,
                'authoring-committed',
                diagnostics === undefined ? {} : { diagnostics }
              ),
              commitFence
            )
          ),
        markRecoveryRequired: (record, state, diagnostic) =>
          markSemanticMutationRecoveryRequired(
            record,
            state,
            diagnostic,
            semanticMutationRecordRecoveryOperations(
              workspaceRoot,
              transactionRoot,
              record,
              token,
              dependencies
            )
          ),
        rollbackCommitted: (record, diagnostic) =>
          rollbackCommittedSemanticMutation(
            record,
            diagnostic,
            semanticMutationRecordRecoveryOperations(
              workspaceRoot,
              transactionRoot,
              record,
              token,
              dependencies
            )
          ),
        completeCommitted: (record, proof) =>
          completeCommittedSemanticMutation(
            record,
            semanticMutationRecordRecoveryOperations(
              workspaceRoot,
              transactionRoot,
              record,
              token,
              dependencies
            ),
            proof
          ),
        prune: () => executeWorkspaceWriteEffect(
          workspaceRoot,
          token,
          commitFence => pruneSemanticMutationTerminalRecords(
            workspaceRoot,
            commitFence
          )
        ),
        isExecutionBoundaryFailure: error => error instanceof WorkspaceWriteLeaseError
      });
    }
  });
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
