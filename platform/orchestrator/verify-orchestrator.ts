import { verifyProject } from '../compiler/index.ts';
import { buildAcceptanceCoverage } from '../compiler/verify/build-acceptance-coverage.ts';
import { createSkippedRuntimeLane } from '../compiler/verify/run-runtime-verification.ts';
import { writePolicySnapshot } from '../compiler/verify/write-policy-snapshot.ts';
import { CI_ARTIFACT_FILES } from '../shared/ci-artifact-contract.ts';
import { formatCompilerFailure } from '../shared/errors.ts';
import { writeJson } from '../shared/fs.ts';
import type { LockFile } from '../shared/lock-types.ts';
import { addGeneratedPaths, readLockFile } from '../shared/lock-utils.ts';
import { getWorkspacePaths } from '../shared/paths.ts';
import { executePipelineStage } from '../shared/pipeline-kernel.ts';
import type { PipelineExecutionContext } from '../shared/pipeline-types.ts';
import type { VerificationLane, VerificationReport } from '../shared/verification-types.ts';

async function writeBlockedVerificationSnapshot(
  workspaceRoot: string,
  lock: LockFile,
  lane: Exclude<VerificationLane, 'runtime'>,
  failure: unknown
): Promise<void> {
  const policyReport = await writePolicySnapshot(workspaceRoot);
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
  const report: VerificationReport = {
    build: fast.build,
    unit: fast.unit,
    acceptance: fast.acceptance,
    policy: fast.policy,
    fast,
    runtime,
    summary: { status: 'failed', requestedLane: lane, failedLanes: ['fast'] },
    logs: { stdout: fast.logs.stdout, stderr: message }
  };
  const {
    acceptanceCoveragePath,
    lockPath,
    runtimeReportPath,
    verificationReportPath
  } = getWorkspacePaths(workspaceRoot);
  const coverage = await buildAcceptanceCoverage(workspaceRoot, lock, runtime);

  addGeneratedPaths(lock, [
    CI_ARTIFACT_FILES.verificationReport,
    CI_ARTIFACT_FILES.runtimeReport,
    CI_ARTIFACT_FILES.policyReport,
    CI_ARTIFACT_FILES.acceptanceCoverage
  ]);
  lock.passStatus.verify = 'failed';

  await Promise.all([
    writeJson(verificationReportPath, report),
    writeJson(runtimeReportPath, runtime),
    writeJson(acceptanceCoveragePath, coverage),
    writeJson(lockPath, lock)
  ]);
}

async function verifyWorkspaceCore(
  workspaceRoot: string,
  options: { lane?: VerificationLane; emitTiming?: boolean }
): Promise<{ lock: LockFile; report: VerificationReport }> {
  const lock = await readLockFile(workspaceRoot);
  const lane = options.lane ?? 'all';
  try {
    const report = await verifyProject(workspaceRoot, lock, lane, {
      emitTiming: options.emitTiming
    });
    return { lock, report };
  } catch (error) {
    if (lane !== 'runtime' && error instanceof Error && 'code' in error && error.code === 'ERROR-DRIFT-001') {
      await writeBlockedVerificationSnapshot(workspaceRoot, lock, lane, error);
    }
    throw error;
  }
}

export async function verifyWorkspace(
  workspaceRoot = process.cwd(),
  options: { lane?: VerificationLane; emitTiming?: boolean } = {},
  context?: PipelineExecutionContext
): Promise<{ lock: LockFile; report: VerificationReport }> {
  return executePipelineStage(
    workspaceRoot,
    'verify',
    context,
    () => verifyWorkspaceCore(workspaceRoot, options),
    {
      extractLock: (result) => result.lock,
      preserveOwnedPassStates: true
    }
  );
}
