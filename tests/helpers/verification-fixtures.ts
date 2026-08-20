import fs from 'node:fs/promises';
import path from 'node:path';

import { readJson, writeJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import {
  buildExpectedProductVerificationClaimSummary,
  inferProductVerificationRuntimeMode
} from '../../platform/shared/product-verification-profile.ts';
import type {
  AcceptanceCoverageReport,
  LockFile,
  PolicyReport,
  VerificationReport
} from '../../platform/shared/types.ts';

export function emptyVerificationLogs(): VerificationReport['logs'] {
  return { stdout: '', stderr: '' };
}

type VerificationArtifactFixtureOptions = {
  policyReport?: PolicyReport;
  acceptanceCoverage?: AcceptanceCoverageReport;
};

function emptyPolicyReport(): PolicyReport {
  return {
    status: 'skipped',
    official: { policies: [], sources: [], violations: [] },
    project: { policies: [], sources: [], violations: [] },
    merged: { policies: [] },
    violations: [],
    diagnostics: []
  };
}

function emptyAcceptanceCoverage(
  status: VerificationReport['runtime']['status']
): AcceptanceCoverageReport {
  return {
    formatVersion: '1',
    status,
    acceptancePassed: [],
    blocks: [],
    slots: [],
    uncoveredBlocks: [],
    uncoveredSlots: []
  };
}

export async function writeCanonicalVerificationArtifactSetFixture(
  workspaceRoot: string,
  input: VerificationReport,
  options: VerificationArtifactFixtureOptions = {}
): Promise<VerificationReport> {
  const policyReport = structuredClone(options.policyReport ?? emptyPolicyReport());
  const runtime = structuredClone(input.runtime);
  const acceptanceCoverage = structuredClone(
    options.acceptanceCoverage ?? emptyAcceptanceCoverage(runtime.status)
  );
  const fast = {
    ...structuredClone(input.fast),
    policy: {
      status: policyReport.status,
      violations: structuredClone(policyReport.violations)
    },
    policyReport: structuredClone(policyReport)
  };
  const claimSummary = buildExpectedProductVerificationClaimSummary(
    'all',
    structuredClone(fast),
    structuredClone(runtime),
    inferProductVerificationRuntimeMode(runtime, 'all'),
    structuredClone(policyReport),
    structuredClone(acceptanceCoverage)
  );
  const failedLanes = [
    ...(fast.status === 'failed' ? ['fast' as const] : []),
    ...(runtime.status === 'failed' ? ['runtime' as const] : [])
  ];
  const report: VerificationReport = {
    build: structuredClone(fast.build),
    unit: structuredClone(fast.unit),
    acceptance: structuredClone(fast.acceptance),
    policy: structuredClone(fast.policy),
    fast,
    runtime,
    summary: {
      status: claimSummary.overall.overallStatus === 'passed' ? 'passed' : 'failed',
      requestedLane: 'all',
      failedLanes,
      claimSummary
    },
    logs: {
      stdout: [fast.logs.stdout, runtime.logs.stdout].filter(Boolean).join('\n'),
      stderr: [fast.logs.stderr, runtime.logs.stderr].filter(Boolean).join('\n')
    }
  };
  const paths = getWorkspacePaths(workspaceRoot);
  await fs.mkdir(path.dirname(paths.verificationReportPath), { recursive: true });
  await Promise.all([
    writeJson(paths.runtimeReportPath, runtime),
    writeJson(paths.policyReportPath, policyReport),
    writeJson(paths.acceptanceCoveragePath, acceptanceCoverage),
    writeJson(paths.verificationReportPath, report)
  ]);
  return report;
}

export async function writeFailedFastUnitVerification(
  workspaceRoot: string,
  message: string,
  options: { slotTasks?: LockFile['slotTasks'] } = {}
): Promise<void> {
  const { lockPath, verificationReportPath } = getWorkspacePaths(workspaceRoot);
  const lock = await readJson<LockFile>(lockPath);
  lock.passStatus.verify = 'failed';
  if (options.slotTasks !== undefined) {
    lock.slotTasks = options.slotTasks;
  }
  await writeJson(lockPath, lock);

  const report = await readJson<VerificationReport>(verificationReportPath);
  report.unit.status = 'failed';
  report.fast.status = 'failed';
  report.fast.unit.status = 'failed';
  report.fast.logs.stderr = message;
  report.summary.status = 'failed';
  report.summary.failedLanes = ['fast'];
  report.logs.stderr = message;
  await writeJson(verificationReportPath, report);
}

export async function writePassingVerificationState(workspaceRoot: string): Promise<void> {
  const { lockPath, verificationReportPath } = getWorkspacePaths(workspaceRoot);
  const lock = await readJson<LockFile>(lockPath);
  lock.passStatus.verify = 'succeeded';
  await writeJson(lockPath, lock);

  const report = await readJson<VerificationReport>(verificationReportPath);
  report.unit.status = 'passed';
  report.unit.passed = [];
  report.acceptance.status = 'passed';
  report.acceptance.passed = [];
  report.acceptance.failed = [];
  report.policy.status = 'passed';
  report.policy.violations = [];
  report.fast.status = 'passed';
  report.fast.unit.status = 'passed';
  report.summary.status = 'passed';
  report.summary.requestedLane = 'all';
  report.summary.failedLanes = [];
  await writeJson(verificationReportPath, report);
}
