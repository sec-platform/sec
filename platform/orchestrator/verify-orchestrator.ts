import {
  buildAcceptanceCoverage,
  createSkippedRuntimeLane
} from '../compiler/index.ts';
import {
  revalidateStagedVerificationProof,
  type StagedVerificationProof
} from '../compiler/verify/staged-verification-proof.ts';
import {
  assertStagedVerificationLiveContext,
  buildBlockedClaimSummary,
  verifyProject
} from '../compiler/verify/verify-project.ts';
import { writePolicySnapshot } from '../compiler/verify/write-policy-snapshot.ts';
import { CI_ARTIFACT_FILES } from '../shared/ci-artifact-contract.ts';
import { formatCompilerFailure } from '../shared/errors.ts';
import { writeJson } from '../shared/fs.ts';
import type { LockFile } from '../shared/lock-types.ts';
import { addGeneratedPaths, readLockFile } from '../shared/lock-utils.ts';
import { getWorkspacePaths } from '../shared/paths.ts';
import { executePipelineStage } from '../shared/pipeline-kernel.ts';
import type { PipelineExecutionContext } from '../shared/pipeline-types.ts';
import type { CanonicalVerificationArtifactSet } from '../shared/verification-artifact-contract.ts';
import type { VerificationLane, VerificationReport } from '../shared/verification-types.ts';
import { assertWorkspaceWriteLease } from '../shared/workspace-write-lease.ts';
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
    getWorkspacePaths(workspaceRoot).projectRoot,
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
  const policyReport = await writePolicySnapshot(workspaceRoot, beforeCommit);
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
  const claimSummary = buildBlockedClaimSummary(lane);
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
  const {
    acceptanceCoveragePath,
    lockPath,
    runtimeReportPath,
    verificationReportPath
  } = getWorkspacePaths(workspaceRoot);
  const coverage = await buildAcceptanceCoverage(workspaceRoot, lock, runtime, fast);

  addGeneratedPaths(lock, [
    CI_ARTIFACT_FILES.verificationReport,
    CI_ARTIFACT_FILES.runtimeReport,
    CI_ARTIFACT_FILES.policyReport,
    CI_ARTIFACT_FILES.acceptanceCoverage
  ]);
  lock.passStatus.verify = 'failed';

  await beforeCommit();
  await Promise.all([
    writeJson(verificationReportPath, report, beforeCommit),
    writeJson(runtimeReportPath, runtime, beforeCommit),
    writeJson(acceptanceCoveragePath, coverage, beforeCommit),
    writeJson(lockPath, lock, beforeCommit)
  ]);
}

async function verifyWorkspaceCore(
  workspaceRoot: string,
  options: VerifyWorkspaceOptions,
  context: PipelineExecutionContext
): Promise<{ lock: LockFile; report: VerificationReport }> {
  const lock = await readLockFile(workspaceRoot);
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
    if (lane !== 'runtime' && error instanceof Error && 'code' in error && error.code === 'ERROR-DRIFT-001') {
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
