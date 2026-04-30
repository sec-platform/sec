import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CI_ARTIFACT_FILES } from '../../shared/ci-artifact-contract.ts';
import { uniqueSorted } from '../../shared/collections.ts';
import { CompilerError } from '../../shared/errors.ts';
import { listFilesRecursive, writeJson } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { addGeneratedPaths } from '../../shared/lock-utils.ts';
import { getWorkspacePaths, relativePosixPath } from '../../shared/paths.ts';
import type { PolicyReport } from '../../shared/policy-types.ts';
import type {
  FastVerificationLaneReport,
  RuntimeVerificationLaneReport,
  VerificationLane,
  VerificationReport
} from '../../shared/verification-types.ts';
import { buildAcceptanceCoverage } from './build-acceptance-coverage.ts';
import { runPolicyGate } from './run-policy-gate.ts';
import { runRuntimeVerification } from './run-runtime-verification.ts';
import { formatCompilerFailure, typecheckProject } from './typecheck-project.ts';

interface SuiteModule {
  runSuite?: () => Promise<void> | void;
}

function createSkippedPolicyReport(): PolicyReport {
  return {
    status: 'skipped',
    official: {
      policies: [],
      sources: [],
      violations: []
    },
    project: {
      policies: [],
      sources: [],
      violations: []
    },
    merged: {
      policies: []
    },
    violations: []
  };
}

function createSkippedFastLane(): FastVerificationLaneReport {
  return {
    status: 'skipped',
    build: {
      status: 'skipped'
    },
    unit: {
      status: 'skipped',
      passed: []
    },
    acceptance: {
      status: 'skipped',
      passed: [],
      failed: []
    },
    policy: {
      status: 'skipped',
      violations: []
    },
    policyReport: createSkippedPolicyReport(),
    logs: {
      stdout: '',
      stderr: ''
    }
  };
}

function createSkippedRuntimeLane(): RuntimeVerificationLaneReport {
  return {
    status: 'skipped',
    build: {
      status: 'skipped',
      passed: [],
      failed: [],
      command: 'npm run build'
    },
    unit: {
      status: 'skipped',
      passed: [],
      failed: [],
      command: 'npm run test:unit'
    },
    acceptance: {
      status: 'skipped',
      passed: [],
      failed: [],
      command: 'npm run test:acceptance'
    },
    logs: {
      stdout: '',
      stderr: ''
    }
  };
}

async function listSuiteFiles(rootDir: string, suffix: string): Promise<string[]> {
  return (await listFilesRecursive(rootDir))
    .filter((file) => file.endsWith(suffix))
    .sort((left, right) => left.localeCompare(right))
    .map((file) => relativePosixPath(rootDir, file));
}

async function runSuiteFiles(rootDir: string, suffix: string): Promise<string[]> {
  const files = (await listFilesRecursive(rootDir))
    .filter((file) => file.endsWith(suffix))
    .sort((left, right) => left.localeCompare(right));
  const results: string[] = [];

  for (const file of files) {
    const moduleUrl = `${pathToFileURL(file).href}?t=${Date.now()}`;
    const testModule = (await import(moduleUrl)) as SuiteModule;
    if (typeof testModule.runSuite !== 'function') {
      throw new CompilerError('VERIFY-BUILD-002', `Test file "${file}" must export runSuite()`);
    }
    await testModule.runSuite();
    results.push(relativePosixPath(rootDir, file));
  }

  return results;
}

async function runFastVerification(
  workspaceRoot: string,
  projectRoot: string
): Promise<{
  lane: FastVerificationLaneReport;
  failure: unknown | null;
}> {
  const unitRoot = path.join(projectRoot, 'tests', 'unit');
  const acceptanceRoot = path.join(projectRoot, 'tests', 'acceptance');
  const acceptanceFiles = await listSuiteFiles(acceptanceRoot, '.test.ts');
  const lane = createSkippedFastLane();
  let failure: unknown | null = null;

  try {
    await typecheckProject(projectRoot);
    lane.build.status = 'passed';
  } catch (error) {
    lane.build.status = 'failed';
    lane.status = 'failed';
    lane.logs.stderr = formatCompilerFailure(error);
    return { lane, failure: error };
  }

  try {
    lane.unit.passed = await runSuiteFiles(unitRoot, '.test.ts');
    lane.unit.status = 'passed';
  } catch (error) {
    lane.unit.status = 'failed';
    lane.status = 'failed';
    lane.logs.stderr = formatCompilerFailure(error);
    return { lane, failure: error };
  }

  try {
    lane.acceptance.passed = await runSuiteFiles(acceptanceRoot, '.test.ts');
    lane.acceptance.status = 'passed';
  } catch (error) {
    lane.acceptance.status = 'failed';
    lane.acceptance.failed = acceptanceFiles;
    lane.status = 'failed';
    lane.logs.stderr = formatCompilerFailure(error);
    return { lane, failure: error };
  }

  const policyReport = await runPolicyGate(workspaceRoot);
  lane.policyReport = policyReport;
  lane.policy = {
    status: policyReport.status,
    violations: policyReport.violations
  };
  lane.logs.stdout = [
    'typecheck:passed',
    `unit:${lane.unit.passed.join(',')}`,
    `acceptance:${lane.acceptance.passed.join(',')}`,
    `policy:${policyReport.status}`
  ].join(' ');

  if (policyReport.status === 'failed') {
    failure = new CompilerError('VERIFY-POLICY-001', 'Policy gate failed', policyReport.violations);
    lane.status = 'failed';
    lane.logs.stderr = formatCompilerFailure(failure);
    return { lane, failure };
  }

  lane.status = 'passed';
  lane.acceptance.failed = [];
  return { lane, failure: null };
}

function summarizeLogs(
  fast: FastVerificationLaneReport,
  runtime: RuntimeVerificationLaneReport
): VerificationReport['logs'] {
  const stdout = [fast.logs.stdout, runtime.logs.stdout].filter(Boolean).join('\n');
  const stderr = [fast.logs.stderr, runtime.logs.stderr].filter(Boolean).join('\n');
  return { stdout, stderr };
}

function summarizeReport(
  lane: VerificationLane,
  fast: FastVerificationLaneReport,
  runtime: RuntimeVerificationLaneReport
): VerificationReport['summary'] {
  const failedLanes: Array<'fast' | 'runtime'> = [];

  if ((lane === 'fast' || lane === 'all') && fast.status === 'failed') {
    failedLanes.push('fast');
  }
  if (runtime.status === 'failed') {
    failedLanes.push('runtime');
  }

  return {
    status: failedLanes.length === 0 ? 'passed' : 'failed',
    requestedLane: lane,
    failedLanes
  };
}

function updateVerifyPassState(lock: LockFile, report: VerificationReport): void {
  if (report.summary.requestedLane === 'all') {
    lock.passStatus.verify = report.summary.status === 'passed' ? 'succeeded' : 'failed';
    return;
  }

  lock.passStatus.verify = report.summary.status === 'failed' ? 'failed' : 'pending';
}

function updateVerifiedSlotTasks(lock: LockFile, report: VerificationReport): void {
  if (report.summary.requestedLane !== 'all' || report.summary.status !== 'passed') {
    return;
  }

  const verifiedBy = uniqueSorted([
    ...report.unit.passed.map((file) => `tests/unit/${file}`),
    ...report.acceptance.passed.map((file) => `tests/acceptance/${file}`),
    ...report.runtime.unit.passed,
    ...report.runtime.acceptance.passed
  ]);

  for (const task of lock.slotTasks) {
    if (task.status === 'filled' || task.status === 'verified') {
      task.status = 'verified';
      task.provenanceHints.verifiedBy = [...verifiedBy];
    }
  }
}

function ensureGeneratedPaths(lock: LockFile): void {
  addGeneratedPaths(lock, [
    CI_ARTIFACT_FILES.verificationReport,
    CI_ARTIFACT_FILES.runtimeReport,
    CI_ARTIFACT_FILES.policyReport,
    CI_ARTIFACT_FILES.acceptanceCoverage
  ]);
}

export async function verifyProject(
  workspaceRoot: string,
  lock: LockFile,
  lane: VerificationLane = 'all',
  options: { emitTiming?: boolean } = {}
): Promise<VerificationReport> {
  const {
    projectRoot,
    acceptanceCoveragePath,
    lockPath,
    policyReportPath,
    runtimeReportPath,
    verificationReportPath
  } = getWorkspacePaths(workspaceRoot);

  if (lock.passStatus.adapt !== 'succeeded') {
    throw new CompilerError('VERIFY-BLOCKED-001', 'adapt must succeed before verify');
  }

  const fastResult =
    lane === 'runtime' ? { lane: createSkippedFastLane(), failure: null } : await runFastVerification(workspaceRoot, projectRoot);
  const shouldRunRuntime = fastResult.lane.status === 'passed' || lane === 'runtime';
  const runtimeLane = shouldRunRuntime
    ? await runRuntimeVerification(projectRoot, lane === 'all' ? 'full' : 'service', { emitTiming: options.emitTiming })
    : createSkippedRuntimeLane();
  const summary = summarizeReport(lane, fastResult.lane, runtimeLane);
  const report: VerificationReport = {
    build: fastResult.lane.build,
    unit: fastResult.lane.unit,
    acceptance: fastResult.lane.acceptance,
    policy: fastResult.lane.policy,
    fast: fastResult.lane,
    runtime: runtimeLane,
    summary,
    logs: summarizeLogs(fastResult.lane, runtimeLane)
  };
  const coverage = await buildAcceptanceCoverage(workspaceRoot, lock, runtimeLane);
  const policyReport = fastResult.lane.policyReport ?? createSkippedPolicyReport();

  ensureGeneratedPaths(lock);
  updateVerifyPassState(lock, report);
  updateVerifiedSlotTasks(lock, report);

  await Promise.all([
    writeJson(verificationReportPath, report),
    writeJson(runtimeReportPath, runtimeLane),
    writeJson(policyReportPath, policyReport),
    writeJson(acceptanceCoveragePath, coverage),
    writeJson(lockPath, lock)
  ]);

  if (summary.status === 'failed') {
    throw new CompilerError('VERIFY-ACCEPTANCE-003', 'Project verification failed', report);
  }

  return report;
}
