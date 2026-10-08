import fs from 'node:fs/promises';
import path from 'node:path';

import { writeJson } from "../../src/adapters/filesystem/files.ts";
import { resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import type { AcceptanceCoverageReport } from '../../src/assurance/acceptance/coverage.ts';
import { snapshotVerificationPublicationArtifacts } from '../../src/assurance/verification/artifact/publication.ts';
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import type { VerificationReport } from '../../src/assurance/verification/contract/types.ts';
import {
  buildExpectedProductVerificationClaimSummary,
  buildProductVerificationObservationBindings,
  inferProductVerificationRuntimeMode,
  type ProductVerificationGateObservation,
  type ProductVerificationObservations,
  type ProductVerificationRuntimeMode
} from '../../src/assurance/verification/profile/contract/product.ts';
import { sha256 } from '../../src/contracts/canonical.ts';
import type { PolicyReport } from '../../src/semantics/policies/types.ts';

export function emptyVerificationLogs(): VerificationReport['logs'] {
  return { stdout: '', stderr: '' };
}

type VerificationArtifactFixtureOptions = {
  policyReport?: PolicyReport;
  acceptanceCoverage?: AcceptanceCoverageReport;
  subjectRevision?: string;
  lane?: VerificationReport['summary']['requestedLane'];
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

function emptyAcceptanceCoverage(status: VerificationReport['runtime']['status']): AcceptanceCoverageReport {
  return {
    formatVersion: '1',
    status,
    acceptancePassed: [],
    blocks: [],
    uncoveredBlocks: []
  };
}

export function productVerificationObservationsFixture(
  lane: VerificationReport['summary']['requestedLane'] = 'all',
  runtimeMode: ProductVerificationRuntimeMode = 'full',
  subjectRevision: string = sha256({ fixture: 'product-verification-subject' })
): ProductVerificationObservations {
  const bindings = buildProductVerificationObservationBindings(subjectRevision, lane, runtimeMode);
  const executed = (binding: ProductVerificationGateObservation, label: string): ProductVerificationGateObservation => ({
    ...binding,
    environment: {
      runtime: 'bun@test',
      os: process.platform,
      arch: process.arch,
      filesystem: null,
      capabilities: ['verification-fixture'],
      toolchainRevision: 'bun@test',
      providerRevisions: []
    },
    execution: {
      argv: ['bun', 'test', label],
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:00.001Z',
      durationMs: 1,
      exitCode: 0,
      outputDigest: sha256({ fixture: label }),
      failureFingerprint: null
    }
  });
  return {
    fast: executed(bindings.fast, 'fast'),
    runtime: executed(bindings.runtime, 'runtime'),
    policy: executed(bindings.policy, 'policy')
  };
}

export async function writeCanonicalVerificationArtifactSetFixture(
  workspaceRoot: string,
  input: VerificationReport,
  options: VerificationArtifactFixtureOptions = {}
): Promise<VerificationReport> {
  const lane = options.lane ?? 'all';
  const policyReport = structuredClone(options.policyReport ?? emptyPolicyReport());
  const runtime = structuredClone(input.runtime);
  const acceptanceCoverage = structuredClone(options.acceptanceCoverage ?? emptyAcceptanceCoverage(runtime.status));
  const fast = {
    ...structuredClone(input.fast),
    policy: {
      status: policyReport.status,
      violations: structuredClone(policyReport.violations)
    },
    policyReport: structuredClone(policyReport)
  };
  const claimSummary = buildExpectedProductVerificationClaimSummary(
    lane,
    structuredClone(fast),
    structuredClone(runtime),
    inferProductVerificationRuntimeMode(runtime, lane),
    structuredClone(policyReport),
    structuredClone(acceptanceCoverage),
    productVerificationObservationsFixture(lane, inferProductVerificationRuntimeMode(runtime, lane), options.subjectRevision)
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
      requestedLane: lane,
      failedLanes,
      claimSummary
    },
    logs: {
      stdout: [fast.logs.stdout, runtime.logs.stdout].filter(Boolean).join('\n'),
      stderr: [fast.logs.stderr, runtime.logs.stderr].filter(Boolean).join('\n')
    }
  };
  snapshotVerificationPublicationArtifacts({ verificationReport: report, runtimeReport: runtime, policyReport, acceptanceCoverage });
  const paths = {
    runtimeReportPath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.runtimeReport),
    policyReportPath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.policyReport),
    acceptanceCoveragePath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.acceptanceCoverage),
    verificationReportPath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.verificationReport)
  };
  await fs.mkdir(path.dirname(paths.verificationReportPath), { recursive: true });
  await Promise.all([
    writeJson(paths.runtimeReportPath, runtime),
    writeJson(paths.policyReportPath, policyReport),
    writeJson(paths.acceptanceCoveragePath, acceptanceCoverage),
    writeJson(paths.verificationReportPath, report)
  ]);
  return report;
}
