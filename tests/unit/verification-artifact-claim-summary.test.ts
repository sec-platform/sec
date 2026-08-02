import { expect, test } from 'bun:test';

import {
  classifySemanticMutationIsolatedVerificationArtifactSet,
  type SemanticMutationIsolatedVerificationArtifactSet
} from '../../platform/compiler/verify/run-semantic-mutation-isolated-child.ts';
import {
  isCanonicalVerificationArtifactSet
} from '../../platform/shared/verification-artifact-contract.ts';
import {
  buildExpectedProductVerificationClaimSummary,
  PRODUCT_FAST_GATE_ID,
  PRODUCT_POLICY_CLAIM_ID,
  PRODUCT_POLICY_GATE_ID
} from '../../platform/shared/product-verification-profile.ts';
import type {
  VerificationClaimResultV1,
  VerificationGateResultV1,
  VerificationReasonCode,
  VerificationResultStatus
} from '../../platform/shared/verification-result-contract.ts';

const INPUT_REVISION = `sha256:${'1'.repeat(64)}`;
const SEMANTIC_REVISION = `sha256:${'2'.repeat(64)}`;

interface MutableClaimSummaryArtifactSet extends SemanticMutationIsolatedVerificationArtifactSet {
  verificationReport: {
    policy: { status: 'passed' | 'failed' | 'skipped'; violations: unknown[] };
    fast: {
      policy: { status: 'passed' | 'failed' | 'skipped'; violations: unknown[] };
      policyReport: ReturnType<typeof policyReport>;
    };
    summary: {
      status: 'passed' | 'failed';
      claimSummary: {
        overall: {
          overallStatus: VerificationResultStatus;
          overallReasonCode: VerificationReasonCode;
          claimResults: VerificationClaimResultV1[];
        };
        gates: VerificationGateResultV1[];
      };
    };
  };
  policyReport: ReturnType<typeof policyReport>;
}

function policyReport(status: 'passed' | 'skipped' = 'passed') {
  const hasPolicy = status === 'passed';
  return {
    status,
    official: {
      policies: hasPolicy ? ['tenant-policy'] : [],
      sources: hasPolicy ? [{ path: 'policies/tenant.yaml', policyIds: ['tenant-policy'] }] : [],
      violations: []
    },
    project: { policies: [], sources: [], violations: [] },
    merged: {
      policies: hasPolicy ? [{
        id: 'tenant-policy',
        sourceScope: 'official' as const,
        sourcePath: 'policies/tenant.yaml',
        targets: ['src/customer.ts']
      }] : []
    },
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
    unit: { status: 'passed' as const, passed: ['unit/current-writer.test.ts'] },
    acceptance: {
      status: 'passed' as const,
      passed: ['acceptance/current-writer.test.ts'],
      failed: []
    },
    policy: { status: 'passed' as const, violations: [] },
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
  const claimSummary = buildExpectedProductVerificationClaimSummary(
    'all',
    fast,
    runtime,
    'full',
    policy
  );

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
        claimSummary
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
      acceptancePassed: runtime.acceptance.passed,
      blocks: [],
      slots: [],
      uncoveredBlocks: [],
      uncoveredSlots: []
    },
    semanticBundle: semanticBundle()
  };
}

function mutablePassedArtifact(): MutableClaimSummaryArtifactSet {
  return structuredClone(artifactSet('passed')) as MutableClaimSummaryArtifactSet;
}

function expectBlocked(candidate: SemanticMutationIsolatedVerificationArtifactSet): void {
  expect(isCanonicalVerificationArtifactSet(candidate)).toBe(false);
  expect(classifySemanticMutationIsolatedVerificationArtifactSet(candidate)).toBe('blocked');
}

test('canonical artifact contract accepts the complete current-writer inventory', () => {
  const passed = artifactSet('passed');
  const failed = artifactSet('failed');

  expect(isCanonicalVerificationArtifactSet(passed)).toBe(true);
  expect(isCanonicalVerificationArtifactSet(failed)).toBe(true);
  expect(classifySemanticMutationIsolatedVerificationArtifactSet(passed)).toBe('passed');
  expect(classifySemanticMutationIsolatedVerificationArtifactSet(failed)).toBe('failed');
});

test('claimSummary overall status must agree with the legacy summary projection', () => {
  const candidate = mutablePassedArtifact();
  candidate.verificationReport.summary.claimSummary.overall.overallStatus = 'invalidated';
  candidate.verificationReport.summary.claimSummary.overall.overallReasonCode = 'selection-unresolved';
  expectBlocked(candidate);
});

test('unknown claimSummary fields remain fail-closed', () => {
  const candidate = mutablePassedArtifact() as MutableClaimSummaryArtifactSet & {
    verificationReport: { summary: { claimSummary: Record<string, unknown> } };
  };
  candidate.verificationReport.summary.claimSummary.forged = true;
  expectBlocked(candidate);
});

test('overall passed cannot conceal a failed claim result', () => {
  const candidate = mutablePassedArtifact();
  const claim = candidate.verificationReport.summary.claimSummary.overall.claimResults[0]!;
  claim.status = 'failed';
  claim.reasonCode = 'executed-failure';
  claim.coverageComplete = false;
  expectBlocked(candidate);
});

test('complete current-writer gate and claim inventory is mandatory', () => {
  const candidate = mutablePassedArtifact();
  candidate.verificationReport.summary.claimSummary.gates =
    candidate.verificationReport.summary.claimSummary.gates.filter(
      (gate) => gate.gateId !== PRODUCT_POLICY_GATE_ID
    );
  candidate.verificationReport.summary.claimSummary.overall.claimResults =
    candidate.verificationReport.summary.claimSummary.overall.claimResults.filter(
      (claim) => claim.claimId !== PRODUCT_POLICY_CLAIM_ID
    );
  expectBlocked(candidate);
});

test('passed required gates must explicitly support their claim', () => {
  const candidate = mutablePassedArtifact();
  const fastGate = candidate.verificationReport.summary.claimSummary.gates.find(
    (gate) => gate.gateId === PRODUCT_FAST_GATE_ID
  )!;
  fastGate.supportedClaims = [];
  expectBlocked(candidate);
});

test('serialized gates must match their lane and policy reports', () => {
  const candidate = mutablePassedArtifact();
  const skipped = policyReport('skipped');
  candidate.verificationReport.fast.policyReport = skipped;
  candidate.verificationReport.fast.policy = { status: 'skipped', violations: [] };
  candidate.verificationReport.policy = { status: 'skipped', violations: [] };
  candidate.policyReport = skipped;
  expectBlocked(candidate);
});

test('duplicate identities and forged contribution references remain fail-closed', () => {
  const duplicate = mutablePassedArtifact();
  duplicate.verificationReport.summary.claimSummary.gates[1]!.gateId =
    duplicate.verificationReport.summary.claimSummary.gates[0]!.gateId;
  expectBlocked(duplicate);

  const forged = mutablePassedArtifact();
  forged.verificationReport.summary.claimSummary.overall.claimResults[0]!
    .contributingGateIds.push('forged-gate');
  expectBlocked(forged);
});

test('empty claim and gate sets cannot manufacture a passed aggregate', () => {
  const candidate = mutablePassedArtifact();
  candidate.verificationReport.summary.claimSummary.overall.claimResults = [];
  candidate.verificationReport.summary.claimSummary.gates = [];
  expectBlocked(candidate);
});
