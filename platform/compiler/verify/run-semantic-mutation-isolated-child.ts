import { buildAcceptanceCoverage } from './build-acceptance-coverage.ts';
import { readLockFile } from '../../shared/lock-utils.ts';
import type { VerificationReport } from '../../shared/verification-types.ts';

import * as core from './run-semantic-mutation-isolated-child-core.ts';

export * from './run-semantic-mutation-isolated-child-core.ts';

function exactValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function classifySemanticMutationIsolatedVerificationArtifactSet(
  input: core.SemanticMutationIsolatedVerificationArtifactSet
): core.SemanticMutationIsolatedVerificationOutcome {
  const structural = core.classifySemanticMutationIsolatedVerificationArtifactSet(input);
  if (structural === 'blocked') return 'blocked';

  const report = input.verificationReport as VerificationReport;
  const overall = report.summary.claimSummary?.overall.overallStatus;
  if (overall === 'passed') {
    return input.childExitCode === 0 &&
      report.fast.status === 'passed' && report.runtime.status === 'passed'
      ? 'passed'
      : 'blocked';
  }
  if (overall === 'failed') {
    return input.childExitCode !== 0 ? 'failed' : 'blocked';
  }
  return 'blocked';
}

export async function runSemanticMutationIsolatedVerificationChild(
  projectRoot: string,
  stagingWorkspaceRoot: string,
  signal?: AbortSignal,
  options: core.IsolatedVerificationRunOptions = {}
): Promise<core.IsolatedVerificationArtifacts> {
  const artifacts = await core.runSemanticMutationIsolatedVerificationChild(
    projectRoot,
    stagingWorkspaceRoot,
    signal,
    options
  );
  const overall = artifacts.verificationReport.summary.claimSummary?.overall.overallStatus;

  if (overall === 'passed' && artifacts.status === 'passed') {
    const lock = await readLockFile(stagingWorkspaceRoot);
    const expectedCoverage = await buildAcceptanceCoverage(
      stagingWorkspaceRoot,
      lock,
      artifacts.runtimeReport,
      artifacts.verificationReport.fast
    );
    if (!exactValue(artifacts.acceptanceCoverage, expectedCoverage)) {
      throw new core.SemanticMutationIsolatedVerificationUnavailableError({
        stage: 'artifact-protocol',
        artifact: 'acceptance-coverage'
      });
    }
    return artifacts;
  }

  if (overall === 'failed' && artifacts.status === 'failed') return artifacts;

  throw new core.SemanticMutationIsolatedVerificationUnavailableError({
    stage: 'artifact-protocol',
    artifact: 'verification-set'
  });
}
