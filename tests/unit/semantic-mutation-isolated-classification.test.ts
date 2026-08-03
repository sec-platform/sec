import { expect, test } from 'bun:test';

import {
  classifySemanticMutationIsolatedVerificationArtifactSet,
  type SemanticMutationIsolatedVerificationArtifactSet
} from '../../platform/compiler/verify/run-semantic-mutation-isolated-child.ts';
import { buildExpectedProductVerificationClaimSummary } from '../../platform/shared/product-verification-profile.ts';
import { isCanonicalVerificationArtifactSet } from '../../platform/shared/verification-artifact-contract.ts';
import type { RuntimeVerificationLaneReport } from '../../platform/shared/verification-types.ts';

const INPUT_REVISION = `sha256:${'1'.repeat(64)}`;
const SEMANTIC_REVISION = `sha256:${'2'.repeat(64)}`;

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

function artifact(runtime: RuntimeVerificationLaneReport): SemanticMutationIsolatedVerificationArtifactSet {
  const policy = policyReport();
  const fast = {
    status: 'passed' as const,
    build: { status: 'passed' as const },
    unit: { status: 'passed' as const, passed: [] },
    acceptance: { status: 'passed' as const, passed: [], failed: [] },
    policy: { status: 'skipped' as const, violations: [] },
    policyReport: policy,
    logs: { stdout: 'fast', stderr: '' }
  };
  const coverage = {
    formatVersion: '1' as const,
    status: runtime.status,
    acceptancePassed: [],
    blocks: [],
    slots: [],
    uncoveredBlocks: [],
    uncoveredSlots: []
  };
  const claimSummary = buildExpectedProductVerificationClaimSummary(
    'all',
    fast,
    runtime,
    'full',
    policy,
    coverage
  );
  return {
    childExitCode: 1,
    verificationReport: {
      build: fast.build,
      unit: fast.unit,
      acceptance: fast.acceptance,
      policy: fast.policy,
      fast,
      runtime,
      summary: {
        status: 'failed',
        requestedLane: 'all',
        failedLanes: runtime.status === 'failed' ? ['runtime'] : [],
        claimSummary
      },
      logs: {
        stdout: [fast.logs.stdout, runtime.logs.stdout].filter(Boolean).join('\n'),
        stderr: [fast.logs.stderr, runtime.logs.stderr].filter(Boolean).join('\n')
      }
    },
    runtimeReport: runtime,
    policyReport: policy,
    acceptanceCoverage: coverage,
    semanticBundle: semanticBundle()
  };
}

function zeroTestRuntime(): RuntimeVerificationLaneReport {
  return {
    status: 'passed',
    build: { status: 'passed', passed: ['next build'], failed: [], command: 'bun run build' },
    unit: { status: 'passed', passed: [], failed: [], command: 'bun run test:unit' },
    acceptance: {
      status: 'passed',
      passed: [],
      failed: [],
      command: 'bun run test:acceptance'
    },
    logs: { stdout: '', stderr: 'verification summary invalidated' }
  };
}

test('nonzero zero-test invalidation is blocked rather than physical failure', () => {
  expect(classifySemanticMutationIsolatedVerificationArtifactSet(
    artifact(zeroTestRuntime())
  )).toBe('blocked');
});

test('nonzero canonical failed claim remains a physical failure', () => {
  const failedRuntime: RuntimeVerificationLaneReport = {
    status: 'failed',
    build: { status: 'failed', passed: [], failed: ['next build'], command: 'bun run build' },
    unit: { status: 'skipped', passed: [], failed: [], command: 'bun run test:unit' },
    acceptance: {
      status: 'skipped',
      passed: [],
      failed: [],
      command: 'bun run test:acceptance'
    },
    logs: { stdout: '', stderr: 'physical build failure' }
  };
  expect(classifySemanticMutationIsolatedVerificationArtifactSet(
    artifact(failedRuntime)
  )).toBe('failed');
});

test('artifact acceptancePassed is recomputed from physical fast and runtime paths', () => {
  const candidate = artifact(zeroTestRuntime());
  expect(isCanonicalVerificationArtifactSet(candidate)).toBe(true);

  const forged = structuredClone(candidate) as SemanticMutationIsolatedVerificationArtifactSet & {
    acceptanceCoverage: { acceptancePassed: string[] };
  };
  forged.acceptanceCoverage.acceptancePassed = ['user_can_login'];
  expect(isCanonicalVerificationArtifactSet(forged)).toBe(false);
});

test('uncovered inventory preserves producer order instead of lexicographic order', () => {
  const candidate = structuredClone(artifact(zeroTestRuntime())) as
    SemanticMutationIsolatedVerificationArtifactSet & {
      acceptanceCoverage: {
        blocks: Array<{
          id: string;
          declaredAcceptance: string[];
          coveredBy: string[];
          uncovered: boolean;
        }>;
        uncoveredBlocks: string[];
      };
    };
  candidate.acceptanceCoverage.blocks = [
    { id: 'z-block', declaredAcceptance: [], coveredBy: [], uncovered: true },
    { id: 'a-block', declaredAcceptance: [], coveredBy: [], uncovered: true }
  ];
  candidate.acceptanceCoverage.uncoveredBlocks = ['z-block', 'a-block'];
  expect(isCanonicalVerificationArtifactSet(candidate)).toBe(true);

  candidate.acceptanceCoverage.uncoveredBlocks = ['a-block', 'z-block'];
  expect(isCanonicalVerificationArtifactSet(candidate)).toBe(false);
});
