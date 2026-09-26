import path from 'node:path';

import type { CanonicalVerificationArtifactSet } from '../../assurance/verification/artifact/contract/artifact.ts';
import type {
  FastVerificationLaneReport,
  VerificationReport
} from '../../assurance/verification/contract/types.ts';
import type { ProductVerificationGateObservation } from '../../assurance/verification/profile/contract/product.ts';
import { createSkippedFastLane } from '../../assurance/verification/project/report.ts';
import { snapshotVerificationData } from '../../assurance/verification/result/contract/result.ts';
import type { LockFile } from '../../compiler/contract.ts';
import { CompilerError, formatCompilerFailure } from '../../compiler/errors.ts';
import { canonicalEquals, compareCodeUnits, sha256 } from '../../contracts/canonical.ts';
import type { Logger } from '../../contracts/logging.ts';
import { isNativeAborted, throwIfNativeAborted } from '../../contracts/native-abort.ts';
import { relativePosixPath } from '../../contracts/relative-path.ts';
import { defaultLogger } from '../diagnostics/json-logger.ts';
import { listFilesRecursive } from '../filesystem/discovery.ts';
import { withProjectDependencyBridge } from '../toolchain/dependencies/runtime.ts';
import { getWorkspacePaths } from '../workspace-context.ts';
import { buildAcceptanceCoverage } from './build-acceptance-coverage.ts';
import { runPolicyGate } from './run-policy-gate.ts';
import {
  FAST_SUITE_PROCESS_PROVIDER_REVISION,
  runSuiteProcesses
} from './run-suite-processes.ts';
import { typecheckProject } from './typecheck-project.ts';

function productVerificationEnvironment(): NonNullable<
  ProductVerificationGateObservation['environment']
> {
  return {
    runtime: `bun@${Bun.version}`,
    os: process.platform,
    arch: process.arch,
    filesystem: null,
    capabilities: ['child-process-product-verification'],
    toolchainRevision: `bun@${Bun.version}`,
    providerRevisions: [FAST_SUITE_PROCESS_PROVIDER_REVISION]
  };
}

export function captureProductVerificationObservation(
  binding: ProductVerificationGateObservation,
  status: 'passed' | 'failed' | 'skipped',
  output: unknown,
  startedAtMs: number,
  finishedAtMs: number
): ProductVerificationGateObservation {
  if (status === 'skipped') return binding;
  const outputDigest = sha256(output);
  return {
    ...binding,
    environment: productVerificationEnvironment(),
    execution: {
      argv: [process.execPath, ...process.argv.slice(1)],
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: Math.max(0, Math.round(finishedAtMs - startedAtMs)),
      exitCode: status === 'passed' ? 0 : 1,
      outputDigest,
      failureFingerprint: status === 'failed' ? outputDigest : null
    }
  };
}

async function listSuiteFiles(
  rootDir: string,
  suffix: string
): Promise<readonly string[]> {
  // The same captured inventory must drive execution and its report. A later
  // filesystem scan would silently select a different verification subject.
  return Object.freeze((await listFilesRecursive(rootDir))
    .filter(file => file.endsWith(suffix))
    .sort((left, right) => compareCodeUnits(left, right)));
}

function throwFastCancellation(
  signal: AbortSignal | undefined,
  executionFailure: unknown
): void {
  if (!isNativeAborted(signal)) return;
  try {
    throwIfNativeAborted(signal);
  } catch (cancellation) {
    if (cancellation === executionFailure) throw executionFailure;
    throw new AggregateError(
      [executionFailure, cancellation],
      'Verification execution failed during cancellation',
      { cause: executionFailure }
    );
  }
}

/** Execute the concrete fast lane. Application owns whether and when it runs. */
export async function runFastVerification(
  workspaceRoot: string,
  isolated: boolean,
  signal?: AbortSignal,
  beforeCommit?: () => Promise<void>
): Promise<{
  lane: FastVerificationLaneReport;
  failure?: Readonly<{ reason: unknown }>;
}> {
  throwIfNativeAborted(signal);
  await beforeCommit?.();
  const testsRoot = getWorkspacePaths(workspaceRoot).testsRoot;
  const unitRoot = path.join(testsRoot, 'unit');
  const acceptanceRoot = path.join(testsRoot, 'acceptance');
  const acceptanceFiles = await listSuiteFiles(acceptanceRoot, '.test.ts');
  const unitFiles = await listSuiteFiles(unitRoot, '.test.ts');
  await beforeCommit?.();
  throwIfNativeAborted(signal);
  const lane = createSkippedFastLane();
  let failure: Readonly<{ reason: unknown }> | undefined;

  const runSuiteGroup = (
    suiteRoot: string,
    files: readonly string[],
    onSuitePassed: (file: string) => void
  ): Promise<void> => {
    const execute = () => runSuiteProcesses({
      workspaceRoot,
      suiteRoot,
      files,
      onSuitePassed,
      signal,
      commitFence: beforeCommit,
      workspaceInputMode: isolated ? 'sealed-generation' : 'live-workspace'
    });
    return isolated
      ? execute()
      : withProjectDependencyBridge(workspaceRoot, execute, {
          beforeCommit,
          signal
        });
  };

  try {
    await typecheckProject(workspaceRoot, { isolated });
    throwIfNativeAborted(signal);
    lane.build.status = 'passed';
  } catch (error) {
    throwFastCancellation(signal, error);
    lane.build.status = 'failed';
    lane.status = 'failed';
    lane.logs.stderr = formatCompilerFailure(error);
    return { lane, failure: { reason: error } };
  }

  try {
    await runSuiteGroup(unitRoot, unitFiles, file => {
      lane.unit.passed.push(relativePosixPath(unitRoot, file));
    });
    lane.unit.status = 'passed';
  } catch (error) {
    throwFastCancellation(signal, error);
    lane.unit.status = 'failed';
    lane.status = 'failed';
    lane.logs.stderr = formatCompilerFailure(error);
    return { lane, failure: { reason: error } };
  }

  try {
    await runSuiteGroup(acceptanceRoot, acceptanceFiles, file => {
      lane.acceptance.passed.push(relativePosixPath(acceptanceRoot, file));
    });
    lane.acceptance.status = 'passed';
  } catch (error) {
    throwFastCancellation(signal, error);
    lane.acceptance.status = 'failed';
    // The loader stops at the first failure. A passed prefix and an unrun
    // suffix must not be relabeled as failed executions.
    const failedFile = acceptanceFiles[lane.acceptance.passed.length];
    lane.acceptance.failed = failedFile === undefined
      ? []
      : [relativePosixPath(acceptanceRoot, failedFile)];
    lane.status = 'failed';
    lane.logs.stderr = formatCompilerFailure(error);
    return { lane, failure: { reason: error } };
  }

  throwIfNativeAborted(signal);
  const policyReport = await runPolicyGate(workspaceRoot);
  throwIfNativeAborted(signal);
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
    failure = {
      reason: new CompilerError(
        'VERIFY-POLICY-001',
        'Policy gate failed',
        policyReport.violations
      )
    };
    lane.status = 'failed';
    lane.logs.stderr = formatCompilerFailure(failure.reason);
    return { lane, failure };
  }

  lane.status = 'passed';
  lane.acceptance.failed = [];
  return { lane };
}

/** Re-observe policy and coverage after consuming a staged proof. */
export async function assertStagedVerificationLiveContext(
  workspaceRoot: string,
  lock: LockFile,
  artifacts: Pick<
    CanonicalVerificationArtifactSet,
    'verificationReport' | 'runtimeReport' | 'policyReport' | 'acceptanceCoverage'
  >
): Promise<void> {
  workspaceRoot = path.resolve(workspaceRoot);
  const expected = snapshotVerificationData(
    artifacts,
    'Staged Verification live-context input'
  ) as unknown as typeof artifacts;
  const [coverageResult, policyResult] = await Promise.allSettled([
    buildAcceptanceCoverage(
      workspaceRoot,
      lock,
      expected.runtimeReport,
      expected.verificationReport.fast
    ),
    runPolicyGate(workspaceRoot)
  ]);
  if (policyResult.status === 'rejected' &&
      coverageResult.status === 'rejected') {
    throw new AggregateError(
      [policyResult.reason, coverageResult.reason],
      'Live Verification policy and acceptance observations both failed',
      { cause: policyResult.reason }
    );
  }
  if (policyResult.status === 'rejected') throw policyResult.reason;
  if (coverageResult.status === 'rejected') throw coverageResult.reason;
  if (!canonicalEquals(policyResult.value, expected.policyReport) ||
      !canonicalEquals(coverageResult.value, expected.acceptanceCoverage)) {
    throw new Error(
      'Live Verification policy or acceptance context changed after staged proof'
    );
  }
}

/** Physical diagnostic projection only; it cannot change verification outcome. */
export function reportProductVerificationFailure(
  report: VerificationReport,
  logger: Logger = defaultLogger
): void {
  if (report.runtime.acceptance?.status === 'failed') {
    try {
      logger.error(
        'VERIFY-ACCEPTANCE-003: runtime acceptance failed',
        {
          passed: report.runtime.acceptance.passed,
          failed: report.runtime.acceptance.failed,
          command: report.runtime.acceptance.command,
          stdout: report.runtime.logs?.stdout?.slice(0, 3000),
          stderr: report.runtime.logs?.stderr?.slice(0, 3000)
        }
      );
    } catch {
      // Diagnostics cannot replace the canonical verification outcome.
    }
  }
  try {
    console.error(
      'VERIFY-ACCEPTANCE-003 full report:',
      JSON.stringify(report, null, 2)
    );
  } catch {
    // Keep independent optional diagnostics non-authoritative.
  }
}
