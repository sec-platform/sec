import type { CanonicalVerificationArtifactSet } from '../../verification/artifact/contract/artifact.ts';
import { CI_ARTIFACT_FILES } from '../../verification/ci-artifacts/contract/manifest.ts';
import type { VerificationLane, VerificationReport } from '../../verification/contract/types.ts';
import { buildBlockedProductVerificationClaimSummary } from '../../verification/profile/contract/product.ts';
import { ProjectIntegrityError } from '../../workspace/contract/project-integrity.ts';
import { assertWorkspaceWriteLease } from '../../workspace/lease.ts';
import type { LockFile } from '../contract.ts';
import { formatCompilerFailure } from '../errors.ts';
import { addGeneratedPaths, readLockFile } from '../lock.ts';
import { executePipelineStage } from '../pipeline/kernel.ts';
import type { PipelineExecutionContext } from '../pipeline/types.ts';
import { buildAcceptanceCoverage } from '../verify/build-acceptance-coverage.ts';
import { runPolicyGate } from '../verify/run-policy-gate.ts';
import { createSkippedRuntimeLane } from '../verify/run-runtime-verification.ts';
import {
  revalidateStagedVerificationProof,
  type StagedVerificationProof
} from '../verify/staged-verification-proof.ts';
import { publishVerificationArtifactSet } from '../verify/verification-artifact-publication.ts';
import {
  assertStagedVerificationLiveContext,
  productVerificationObservationBindings,
  verifyProject
} from '../verify/verify-project.ts';
import {
  assertIsolatedVerificationCapability,
  type IsolatedVerificationCapability
} from './isolated-verification-capability.ts';
export type { StagedVerificationProof };

export interface VerifyWorkspaceOptions {
  readonly emitTiming?: boolean;
  readonly isolatedVerificationCapability?: IsolatedVerificationCapability;
  readonly lane?: VerificationLane;
  readonly signal?: AbortSignal;
  readonly stagedVerificationProof?: StagedVerificationProof;
}

export async function assertStagedVerificationProofAfterPipeline(
  workspaceRoot: string,
  lock: LockFile,
  artifacts: CanonicalVerificationArtifactSet,
  proof: StagedVerificationProof
): Promise<void> {
  await revalidateStagedVerificationProof(
    workspaceRoot,
    lock,
    proof
  );
  await assertStagedVerificationLiveContext(workspaceRoot, lock, artifacts);
}

async function writeBlockedVerificationSnapshot(
  workspaceRoot: string,
  lock: LockFile,
  lane: Exclude<VerificationLane, 'runtime'>,
  failure: unknown,
  beforeCommit: () => Promise<void>
): Promise<void> {
  const policyReport = await runPolicyGate(workspaceRoot);
  const runtime = createSkippedRuntimeLane();
  const message = formatCompilerFailure(failure);
  const fast: VerificationReport['fast'] = {
    status: 'failed',
    build: { status: 'skipped' },
    unit: { status: 'skipped', passed: [] },
    acceptance: { status: 'skipped', passed: [], failed: [] },
    policy: { status: policyReport.status, violations: policyReport.violations },
    policyReport,
    logs: { stdout: `policy:${policyReport.status}`, stderr: message }
  };
  const claimSummary = buildBlockedProductVerificationClaimSummary(
    lane,
    productVerificationObservationBindings(lock, lane, 'service')
  );
  const report: VerificationReport = {
    build: fast.build,
    unit: fast.unit,
    acceptance: fast.acceptance,
    policy: fast.policy,
    fast,
    runtime,
    summary: {
      status: 'failed',
      requestedLane: lane,
      failedLanes: ['fast'],
      claimSummary
    },
    logs: { stdout: fast.logs.stdout, stderr: message }
  };
  const coverage = await buildAcceptanceCoverage(workspaceRoot, lock, runtime, fast);

  addGeneratedPaths(lock, [
    CI_ARTIFACT_FILES.verificationReport,
    CI_ARTIFACT_FILES.runtimeReport,
    CI_ARTIFACT_FILES.policyReport,
    CI_ARTIFACT_FILES.acceptanceCoverage
  ]);
  lock.passStatus.verify = 'failed';

  await publishVerificationArtifactSet({
    workspaceRoot,
    lock,
    artifacts: {
      verificationReport: report,
      runtimeReport: runtime,
      policyReport,
      acceptanceCoverage: coverage
    },
    commitFence: beforeCommit
  });
}

async function verifyWorkspaceCore(
  workspaceRoot: string,
  options: VerifyWorkspaceOptions,
  context: PipelineExecutionContext
): Promise<{ lock: LockFile; report: VerificationReport }> {
  const lock = readLockFile(workspaceRoot);
  const lane = options.lane ?? 'all';
  const isolated = options.isolatedVerificationCapability !== undefined;
  if (isolated) {
    assertIsolatedVerificationCapability(workspaceRoot, options.isolatedVerificationCapability);
  }
  const beforeCommit = () => assertWorkspaceWriteLease(workspaceRoot, context.workspaceWriteLease);
  try {
    const report = await verifyProject(workspaceRoot, lock, lane, {
      emitTiming: isolated ? false : options.emitTiming,
      isolated,
      beforeCommit,
      ...(context.onEvent
        ? { pipelineObserver: { onEvent: context.onEvent, transactionId: context.transactionId } }
        : {}),
      signal: options.signal,
      ...(options.stagedVerificationProof
        ? { stagedVerificationProof: options.stagedVerificationProof }
        : {}),
      ...(isolated
        ? {
            stagingTreeOptions: {
              workspaceWriteLease: context.workspaceWriteLease
            }
          }
        : {})
    });
    return { lock, report };
  } catch (error) {
    if (lane !== 'runtime' && error instanceof ProjectIntegrityError) {
      await writeBlockedVerificationSnapshot(workspaceRoot, lock, lane, error, beforeCommit);
    }
    throw error;
  }
}

export async function verifyWorkspace(
  workspaceRoot = process.cwd(),
  options: VerifyWorkspaceOptions = {},
  context?: PipelineExecutionContext
): Promise<{ lock: LockFile; report: VerificationReport }> {
  return executePipelineStage(
    workspaceRoot,
    'verify',
    context,
    (stageContext) => verifyWorkspaceCore(workspaceRoot, options, stageContext),
    {
      extractLock: (result) => result.lock,
      preserveOwnedPassStates: true
    }
  );
}
