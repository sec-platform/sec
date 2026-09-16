import {
  REPAIR_PLAN_FORMAT_VERSION,
  validateRepairPlan,
  type RepairBlocker,
  type RepairFailurePoint,
  type RepairPlan
} from '../../semantic/repair/contract/types.ts';
import { uniqueSorted } from '../../system-architecture/foundation/runtime/canonical.ts';
import { CI_ARTIFACT_FILES } from '../../verification/ci-artifacts/contract/manifest.ts';
import type { VerificationReport } from '../../verification/contract/types.ts';
import { writeJson, type CommitFence } from '../../workspace/files.ts';
import { resolveWorkspaceArtifactPath, testsRelativePath } from '../../workspace/runtime/paths.ts';
import type { LockFile } from '../contract.ts';
import { writeProvenance } from '../emit/write-provenance.ts';
import { writeLockWithGeneratedPaths } from '../lock.ts';

function addFailedRepairPoint(
  points: RepairFailurePoint[],
  status: 'passed' | 'failed' | 'skipped',
  point: RepairFailurePoint
): void {
  if (status === 'failed') points.push(point);
}

function buildFailurePoints(report: VerificationReport): RepairFailurePoint[] {
  const points: RepairFailurePoint[] = [];

  addFailedRepairPoint(points, report.build.status, {
    lane: 'fast',
    kind: 'build',
    issueType: 'unknown',
    repairable: false,
    artifactPath: CI_ARTIFACT_FILES.verificationReport,
    message: report.fast.logs.stderr || 'Typecheck failed'
  });
  addFailedRepairPoint(points, report.unit.status, {
    lane: 'fast',
    kind: 'unit',
    issueType: 'unknown',
    repairable: false,
    artifactPath: `${testsRelativePath}/unit`,
    message: report.fast.logs.stderr || 'Unit verification failed'
  });
  addFailedRepairPoint(points, report.acceptance.status, {
    lane: 'fast',
    kind: 'acceptance',
    issueType: 'spec',
    repairable: false,
    artifactPath: `${testsRelativePath}/acceptance`,
    message: report.fast.logs.stderr || 'Acceptance verification failed',
    targetIds: uniqueSorted(report.acceptance.failed)
  });
  addFailedRepairPoint(points, report.policy.status, {
    lane: 'fast',
    kind: 'policy',
    issueType: 'spec',
    repairable: false,
    artifactPath: CI_ARTIFACT_FILES.policyReport,
    message: uniqueSorted(report.policy.violations.map((violation) => violation.message)).join('; ') || 'Policy verification failed',
    targetIds: uniqueSorted(report.policy.violations.flatMap((violation) => [violation.id, ...violation.files]))
  });
  addFailedRepairPoint(points, report.runtime.build.status, {
    lane: 'runtime',
    kind: 'runtime-build',
    issueType: 'kernel',
    repairable: false,
    artifactPath: CI_ARTIFACT_FILES.runtimeReport,
    message: report.runtime.logs.stderr || 'Runtime build failed'
  });
  addFailedRepairPoint(points, report.runtime.unit.status, {
    lane: 'runtime',
    kind: 'runtime-unit',
    issueType: 'unknown',
    repairable: false,
    artifactPath: CI_ARTIFACT_FILES.runtimeReport,
    message: report.runtime.logs.stderr || 'Runtime unit verification failed',
    targetIds: uniqueSorted(report.runtime.unit.failed)
  });
  addFailedRepairPoint(points, report.runtime.acceptance.status, {
    lane: 'runtime',
    kind: 'runtime-acceptance',
    issueType: 'spec',
    repairable: false,
    artifactPath: CI_ARTIFACT_FILES.runtimeReport,
    message: report.runtime.logs.stderr || 'Runtime acceptance verification failed',
    targetIds: uniqueSorted(report.runtime.acceptance.failed)
  });

  return points.length > 0 ? points : [{
    lane: 'all',
    kind: 'summary',
    issueType: 'unknown',
    repairable: false,
    artifactPath: CI_ARTIFACT_FILES.verificationReport,
    message: 'Verification failed without lane-specific failure details'
  }];
}

function repairBoundaryFor(point: RepairFailurePoint): RepairBlocker['boundary'] {
  return point.issueType === 'spec' || point.issueType === 'kernel'
    ? point.issueType
    : 'unknown';
}

function buildRepairBlockers(failurePoints: readonly RepairFailurePoint[]): RepairBlocker[] {
  return failurePoints.map((point, index) => {
    const boundary = repairBoundaryFor(point);
    return {
      blockerId: `repair_blocker_${index + 1}_${point.lane}_${point.kind}`,
      reason: `${point.kind} failure requires its canonical owner; compiler repair does not synthesize source`,
      boundary,
      decisionRequired: boundary === 'spec'
        ? 'Change the authoritative specification or installed Block source, then run verification again.'
        : boundary === 'kernel'
          ? 'Repair the compiler or runtime owner, then run verification again.'
          : 'Classify and repair the owning source boundary, then run verification again.',
      failurePoints: [point]
    };
  });
}

export function buildRepairPlan(report: VerificationReport): RepairPlan {
  if (report.summary.status === 'passed') {
    return {
      formatVersion: REPAIR_PLAN_FORMAT_VERSION,
      status: 'skipped',
      sourceVerificationStatus: 'passed',
      requiresVerification: false,
      tasks: []
    };
  }

  const failurePoints = buildFailurePoints(report);
  return {
    formatVersion: REPAIR_PLAN_FORMAT_VERSION,
    status: 'blocked',
    sourceVerificationStatus: 'failed',
    requiresVerification: false,
    tasks: [],
    blockers: buildRepairBlockers(failurePoints)
  };
}

export async function writeRepairPlan(
  workspaceRoot: string,
  plan: RepairPlan,
  lock: LockFile,
  commitFence?: CommitFence
): Promise<void> {
  const repairPlanPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.repairPlan);
  const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
  await writeJson(repairPlanPath, validateRepairPlan(plan), commitFence);
  await writeLockWithGeneratedPaths(lockPath, lock, [CI_ARTIFACT_FILES.repairPlan], commitFence);
  await writeProvenance(workspaceRoot, lock, commitFence);
}
