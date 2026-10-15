import { buildAcceptanceCoverageReport } from '../../src/assurance/acceptance/build-coverage.ts';
import { createSkippedRuntimeLane, productVerificationSubjectRevision } from '../../src/assurance/verification/project/report.ts';
import type { LockFile } from '../../src/compiler/contract.ts';
import { sha256 } from '../../src/contracts/canonical.ts';
import { buildPassingReviewReport, buildReviewLock, buildRuntimeVerificationReport } from './review-fixtures.ts';
import { buildSemanticViewFixture } from './semantic-view-fixtures.ts';
import { writeCanonicalVerificationArtifactSetFixture } from './verification-fixtures.ts';

export function buildCurrentVerificationLock(options: Parameters<typeof buildReviewLock>[0] = {}): LockFile {
  return buildReviewLock({
    semanticLoweringTasks: [],
    semanticViews: buildSemanticViewFixture(sha256('fixture-input'), sha256('fixture-semantic')),
    resolvedBlocks: [{ id: 'feature/auth', version: '0.1.0', kind: 'capability', installOrder: 1,
      manifestPath: 'auth.yaml', registrySourceId: 'fixture', registryKind: 'private', registryLocation: 'workspace', registryPath: 'auth' }],
    acceptancePlan: ['user_can_login'],
    acceptanceSources: [{ declaringBlockId: 'feature/auth', acceptance: { id: 'user_can_login', source: { tests: ['tests/acceptance/auth-flow.test.ts'] } } }],
    installPlan: [{ stepId: 'auth:test', blockId: 'feature/auth', registrySourceId: 'fixture', registryKind: 'private',
      registryLocation: 'workspace', registryPath: 'auth', sourceRoot: 'files', action: 'copy', from: 'auth.test.ts', to: 'tests/acceptance/auth-flow.test.ts' }],
    ...options
  });
}

/** Synthetic pre-existing data, using the established profile-aware
 * fixture writer. It does not execute or qualify the consumer's transition. */
export async function writeCurrentVerificationFixture(
  root: string, lock: LockFile, options: { failed?: boolean; lane?: 'all' | 'fast' } = {}
) {
  const runtime = options.failed || options.lane === 'fast' ? createSkippedRuntimeLane() : buildRuntimeVerificationReport({
    build: { passed: ['fixture-build'] }, unit: { passed: ['tests/unit/fixture.test.ts'] },
    acceptance: { passed: ['tests/acceptance/auth-flow.test.ts'] }
  });
  const report = buildPassingReviewReport({
    fast: {
      status: options.failed ? 'failed' : 'passed',
      build: { status: 'passed' },
      unit: { status: options.failed ? 'failed' : 'passed', passed: [] },
      acceptance: { status: options.failed ? 'skipped' : 'passed',
        passed: options.failed ? [] : ['auth-flow.test.ts'], failed: [] },
      policy: { status: 'skipped', violations: [] },
      logs: { stdout: '', stderr: options.failed ? 'unit fixture failure' : '' }
    }, runtime
  });
  const acceptanceCoverage = buildAcceptanceCoverageReport({ lock, fast: report.fast, runtime });
  const verificationReport = await writeCanonicalVerificationArtifactSetFixture(root, report, {
    lane: options.lane ?? 'all',
    subjectRevision: productVerificationSubjectRevision(lock),
    acceptanceCoverage
  });
  return { verificationReport, runtimeReport: verificationReport.runtime, acceptanceCoverage };
}
