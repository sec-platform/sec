import { readJson, writeJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import type { LockFile, VerificationReport } from '../../platform/shared/types.ts';

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
