import { expect, test } from 'bun:test';

import {
  classifySemanticMutationIsolatedVerificationArtifactSet,
  type SemanticMutationIsolatedVerificationArtifactSet
} from '../../platform/compiler/verify/run-semantic-mutation-isolated-child.ts';
import {
  isCanonicalVerificationArtifactSet
} from '../../platform/shared/verification-artifact-contract.ts';
import {
  CodexDevelopmentAggregateVerificationClaimsV1,
  CodexDevelopmentBuildVerificationGateResultV1,
  type VerificationGateEnvironmentV1,
  type VerificationGateResultV1
} from '../../platform/shared/verification-result-contract.ts';

const INPUT_REVISION = `sha256:${'1'.repeat(64)}`;
const SEMANTIC_REVISION = `sha256:${'2'.repeat(64)}`;
const INPUT_DIGEST = `sha256:${'3'.repeat(64)}`;
const OUTPUT_DIGEST = `sha256:${'4'.repeat(64)}`;

function environment(): VerificationGateEnvironmentV1 {
  return {
    runtime: 'bun@1.3.14',
    os: 'linux',
    arch: 'x64',
    filesystem: 'ext4',
    capabilities: [],
    toolchainRevision: 'ci-verification-v19',
    providerRevisions: []
  };
}

function gate(gateId: string, status: 'passed' | 'failed'): VerificationGateResultV1 {
  return CodexDevelopmentBuildVerificationGateResultV1({
    gateId,
    gateRevision: 'verification-artifact-claim-summary-v1',
    owner: 'verification-artifact-contract',
    requirementKey: gateId,
    subjectRevision: SEMANTIC_REVISION,
    inputDigest: INPUT_DIGEST,
    applicability: 'required',
    status,
    disposition: 'executed',
    reasonCode: status === 'passed' ? 'executed-success' : 'executed-failure',
    requiredForClaims: ['verification-all'],
    supportedClaims: status === 'passed' ? ['verification-all'] : [],
    environment: environment(),
    execution: {
      argv: ['bun', 'run', gateId],
      startedAt: '2026-08-01T00:00:00.000Z',
      finishedAt: '2026-08-01T00:00:01.000Z',
      durationMs: 1000,
      exitCode: status === 'passed' ? 0 : 1,
      outputDigest: OUTPUT_DIGEST,
      failureFingerprint: status === 'passed' ? null : `${gateId}-failed`
    },
    evidenceRefs: [],
    invalidationRules: ['subject-revision-change'],
    diagnostic: null
  });
}

function policyReport() {
  return {
    status: 'skipped' as const,
    official: { policies: [], sources: [], violations: [] },
    project: { policies: [], sources: [], violations: [] },
    merged: { policies: [] },
    violations: []
  };
}

function semanticBundle() {
  return {
    snapshot: {
      ir: {
        inputRevision: INPUT_REVISION,
        semanticRevision: SEMANTIC_REVISION
      }
    },
    generatorPlan: {
      inputRevision: INPUT_REVISION,
      semanticRevision: SEMANTIC_REVISION,
      tasks: []
    },
    semanticViews: {
      formatVersion: '1',
      inputRevision: INPUT_REVISION,
      semanticRevision: SEMANTIC_REVISION,
      views: []
    },
    semanticContractSources: []
  };
}

function artifactSet(status: 'passed' | 'failed'): SemanticMutationIsolatedVerificationArtifactSet {
  const policy = policyReport();
  const fastLogs = { stdout: 'fast-verification', stderr: '' };
  const runtimeLogs = status === 'passed'
    ? { stdout: 'runtime-verification', stderr: '' }
    : { stdout: '', stderr: 'runtime-verification-failed' };
  const fast = {
    status: 'passed' as const,
    build: { status: 'passed' as const },
    unit: { status: 'passed' as const, passed: [] },
    acceptance: { status: 'passed' as const, passed: [], failed: [] },
    policy: { status: 'skipped' as const, violations: [] },
    policyReport: policy,
    logs: fastLogs
  };
  const runtime = status === 'passed' ? {
    status: 'passed' as const,
    build: { status: 'passed' as const, passed: ['next build'], failed: [], command: 'bun run build' },
    unit: { status: 'passed' as const, passed: ['runtime-unit'], failed: [], command: 'bun run test:unit' },
    acceptance: {
      status: 'passed' as const,
      passed: ['runtime-acceptance'],
      failed: [],
      command: 'bun run test:acceptance'
    },
    logs: runtimeLogs
  } : {
    status: 'failed' as const,
    build: { status: 'failed' as const, passed: [], failed: ['next build'], command: 'bun run build' },
    unit: { status: 'skipped' as const, passed: [], failed: [], command: null },
    acceptance: { status: 'skipped' as const, passed: [], failed: [], command: null },
    logs: runtimeLogs
  };
  const gates = [
    gate('fast-verification', 'passed'),
    gate('runtime-verification', status)
  ];
  const overall = CodexDevelopmentAggregateVerificationClaimsV1({
    claims: [{
      claimId: 'verification-all',
      requiredGateIds: ['fast-verification', 'runtime-verification'],
      owningEnvironments: ['linux-x64']
    }],
    gateResults: gates
  });

  return {
    childExitCode: status === 'passed' ? 0 : 1,
    verificationReport: {
      build: fast.build,
      unit: fast.unit,
      acceptance: fast.acceptance,
      policy: fast.policy,
      fast,
      runtime,
      summary: {
        status,
        requestedLane: 'all' as const,
        failedLanes: status === 'passed' ? [] : ['runtime'],
        claimSummary: { overall, gates }
      },
      logs: {
        stdout: [fastLogs.stdout, runtimeLogs.stdout].filter(Boolean).join('\n'),
        stderr: [fastLogs.stderr, runtimeLogs.stderr].filter(Boolean).join('\n')
      }
    },
    runtimeReport: runtime,
    policyReport: policy,
    acceptanceCoverage: {
      formatVersion: '1',
      status: runtime.status,
      acceptancePassed: [],
      blocks: [],
      slots: [],
      uncoveredBlocks: [],
      uncoveredSlots: []
    },
    semanticBundle: semanticBundle()
  };
}

test('canonical artifact contract accepts claimSummary reports from current verification writer', () => {
  const passed = artifactSet('passed');
  const failed = artifactSet('failed');

  expect(isCanonicalVerificationArtifactSet(passed)).toBe(true);
  expect(isCanonicalVerificationArtifactSet(failed)).toBe(true);
  expect(classifySemanticMutationIsolatedVerificationArtifactSet(passed)).toBe('passed');
  expect(classifySemanticMutationIsolatedVerificationArtifactSet(failed)).toBe('failed');
});

test('claimSummary overall status must agree with the legacy summary projection', () => {
  const candidate = structuredClone(artifactSet('passed')) as SemanticMutationIsolatedVerificationArtifactSet & {
    verificationReport: {
      summary: {
        status: 'passed' | 'failed';
        claimSummary: {
          overall: {
            overallStatus: 'passed' | 'failed' | 'not-run' | 'unsupported' | 'invalidated';
          };
        };
      };
    };
  };
  candidate.verificationReport.summary.claimSummary.overall.overallStatus = 'invalidated';

  expect(isCanonicalVerificationArtifactSet(candidate)).toBe(false);
  expect(classifySemanticMutationIsolatedVerificationArtifactSet(candidate)).toBe('blocked');
});

test('unknown claimSummary fields remain fail-closed', () => {
  const candidate = structuredClone(artifactSet('passed')) as SemanticMutationIsolatedVerificationArtifactSet & {
    verificationReport: {
      summary: {
        claimSummary: Record<string, unknown>;
      };
    };
  };
  candidate.verificationReport.summary.claimSummary.forged = true;

  expect(isCanonicalVerificationArtifactSet(candidate)).toBe(false);
  expect(classifySemanticMutationIsolatedVerificationArtifactSet(candidate)).toBe('blocked');
});
