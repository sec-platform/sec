import { expect, test } from 'bun:test';

import { ACCEPTANCE_COVERAGE_FORMAT_VERSION, type AcceptanceCoverageReport } from '../../src/assurance/acceptance/coverage.ts';
import { isCanonicalVerificationArtifactSet } from '../../src/assurance/verification/artifact/contract/artifact.ts';
import { buildExpectedProductVerificationClaimSummary, PRODUCT_FAST_GATE_ID, PRODUCT_POLICY_CLAIM_ID, PRODUCT_POLICY_GATE_ID } from '../../src/assurance/verification/profile/contract/product.ts';
import type { VerificationClaimResult, VerificationGateResult, VerificationReasonCode, VerificationResultStatus } from '../../src/assurance/verification/result/contract/result.ts';
import {
  classifyIsolatedVerificationArtifactSet,
  type IsolatedVerificationArtifactSet
} from '../../src/assurance/verification/semantic-mutation/isolated/classification.ts';
import { productVerificationObservationsFixture } from '../helpers/verification-fixtures.ts';

const INPUT_REVISION = `sha256:${'1'.repeat(64)}`;
const SEMANTIC_REVISION = `sha256:${'2'.repeat(64)}`;
const ACCEPTANCE_ID = 'user_can_create_customer';
const BLOCK_ID = 'entity/customer-basic';
const POLICY_SOURCE = 'catalog/policies/official/tenant.yaml';

type PolicyStatus = 'passed' | 'failed' | 'skipped';

interface RuntimeStep {
  status: PolicyStatus;
  passed: string[];
  failed: string[];
  command: string | null;
}

interface MutableClaimSummaryArtifactSet extends IsolatedVerificationArtifactSet {
  verificationReport: {
    build: { status: PolicyStatus };
    policy: { status: PolicyStatus; violations: unknown[] };
    fast: {
      status: PolicyStatus;
      build: { status: PolicyStatus };
      policy: { status: PolicyStatus; violations: unknown[] };
      policyReport: ReturnType<typeof policyReport>;
    };
    runtime: {
      status: PolicyStatus;
      build: RuntimeStep;
      unit: RuntimeStep;
      acceptance: RuntimeStep;
    };
    summary: {
      status: 'passed' | 'failed';
      claimSummary: {
        overall: {
          overallStatus: VerificationResultStatus;
          overallReasonCode: VerificationReasonCode;
          claimResults: VerificationClaimResult[];
        };
        gates: VerificationGateResult[];
      };
    };
  };
  runtimeReport: {
    status: PolicyStatus;
    build: RuntimeStep;
    unit: RuntimeStep;
    acceptance: RuntimeStep;
  };
  policyReport: ReturnType<typeof policyReport>;
  acceptanceCoverage: {
    formatVersion: string;
    status: PolicyStatus;
    acceptancePassed: string[];
    blocks: Array<{
      id: string;
      declaredAcceptance: string[];
      coveredBy: string[];
      uncovered: boolean;
    }>;
    uncoveredBlocks: string[];
  };
}

function policyReport(status: 'passed' | 'skipped' = 'passed') {
  const hasPolicy = status === 'passed';
  return {
    status,
    official: {
      policies: hasPolicy ? ['tenant-policy'] : [],
      sources: hasPolicy ? [{ path: POLICY_SOURCE, policyIds: ['tenant-policy'] }] : [],
      violations: [] as ReturnType<typeof blockingViolation>[]
    },
    project: {
      policies: [],
      sources: [],
      violations: [] as ReturnType<typeof blockingViolation>[]
    },
    merged: {
      policies: hasPolicy ? [{
        id: 'tenant-policy',
        sourceScope: 'official' as const,
        sourcePath: POLICY_SOURCE,
        targets: ['src/customer.ts']
      }] : []
    },
    violations: [] as ReturnType<typeof blockingViolation>[],
    diagnostics: [],
    ...(hasPolicy ? {
      evaluation: {
        providerId: 'fixture-semantic-policy-provider',
        providerRevision: '1',
        assurance: 'semantic' as const,
        requiredSemanticPredicates: ['FLOWS_TO'],
        unsupportedSemanticPredicates: []
      }
    } : {})
  };
}

function blockingViolation() {
  return {
    id: 'tenant-policy',
    severity: 'blocker' as const,
    appliesTo: [BLOCK_ID],
    rule: 'tenant_context_must_flow_to_query' as const,
    files: ['src/customer.ts'],
    message: 'Tenant context is missing.',
    sourceScope: 'official' as const,
    sourcePath: POLICY_SOURCE
  };
}

function coverage(status: 'passed' | 'failed'): AcceptanceCoverageReport {
  const complete = status === 'passed';
  return {
    formatVersion: ACCEPTANCE_COVERAGE_FORMAT_VERSION,
    status,
    acceptancePassed: complete ? [ACCEPTANCE_ID] : [],
    blocks: [{
      id: BLOCK_ID,
      declaredAcceptance: [ACCEPTANCE_ID],
      coveredBy: complete ? [ACCEPTANCE_ID] : [],
      uncovered: !complete
    }],
    uncoveredBlocks: complete ? [] : [BLOCK_ID]
  };
}

function semanticBundle() {
  return {
    snapshot: { ir: { inputRevision: INPUT_REVISION, semanticRevision: SEMANTIC_REVISION } },
    generatorPlan: { inputRevision: INPUT_REVISION, semanticRevision: SEMANTIC_REVISION, tasks: [] },
    semanticViews: {
      formatVersion: '1', inputRevision: INPUT_REVISION, semanticRevision: SEMANTIC_REVISION, views: []
    },
    semanticContractSources: []
  };
}

function artifactSet(status: 'passed' | 'failed'): IsolatedVerificationArtifactSet {
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
    build: {
      status: 'passed' as const, passed: ['bun run build'], failed: [], command: 'bun run build'
    },
    unit: {
      status: 'passed' as const,
      passed: ['tests/runtime/unit/runtime.test.ts'],
      failed: [],
      command: 'bun run test:unit'
    },
    acceptance: {
      status: 'passed' as const,
      passed: ['tests/acceptance/customer-flow.test.ts'],
      failed: [],
      command: 'bun run test:acceptance'
    },
    logs: runtimeLogs
  } : {
    status: 'failed' as const,
    build: {
      status: 'failed' as const,
      passed: [],
      failed: ['bun run build'],
      command: 'bun run build'
    },
    unit: { status: 'skipped' as const, passed: [], failed: [], command: null },
    acceptance: { status: 'skipped' as const, passed: [], failed: [], command: null },
    logs: runtimeLogs
  };
  const acceptanceCoverage = coverage(status);
  const claimSummary = buildExpectedProductVerificationClaimSummary(
    'all', fast, runtime, 'full', policy, acceptanceCoverage,
    productVerificationObservationsFixture()
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
    acceptanceCoverage,
    semanticBundle: semanticBundle()
  };
}

function mutablePassedArtifact(): MutableClaimSummaryArtifactSet {
  return structuredClone(artifactSet('passed')) as MutableClaimSummaryArtifactSet;
}

function invalidateCoverage(candidate: MutableClaimSummaryArtifactSet): void {
  candidate.acceptanceCoverage.acceptancePassed = [];
  for (const entry of candidate.acceptanceCoverage.blocks) {
    entry.coveredBy = [];
    entry.uncovered = true;
  }
  candidate.acceptanceCoverage.uncoveredBlocks = candidate.acceptanceCoverage.blocks.map((entry) => entry.id);
}

function expectBlocked(candidate: IsolatedVerificationArtifactSet): void {
  expect(isCanonicalVerificationArtifactSet(candidate)).toBe(false);
  expect(classifyIsolatedVerificationArtifactSet(candidate)).toBe('blocked');
}

test('canonical artifact contract accepts complete current-writer pass and failure inventories', () => {
  const passed = artifactSet('passed');
  const failed = artifactSet('failed');
  expect(isCanonicalVerificationArtifactSet(passed)).toBe(true);
  expect(isCanonicalVerificationArtifactSet(failed)).toBe(true);
  expect(classifyIsolatedVerificationArtifactSet(passed)).toBe('passed');
  expect(classifyIsolatedVerificationArtifactSet(failed)).toBe('failed');
});

test('current production artifacts cannot delete claimSummary and fall back to legacy PASS', () => {
  const candidate = mutablePassedArtifact() as any;
  delete candidate.verificationReport.summary.claimSummary;
  expectBlocked(candidate);
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

test('fast, runtime and policy reports must match their green aggregate', () => {
  const fastDrift = mutablePassedArtifact();
  fastDrift.verificationReport.fast.build.status = 'skipped';
  fastDrift.verificationReport.build.status = 'skipped';
  expectBlocked(fastDrift);

  const policyDrift = mutablePassedArtifact();
  const violation = blockingViolation();
  policyDrift.policyReport.violations = [violation];
  policyDrift.policyReport.official.violations = [violation];
  policyDrift.verificationReport.fast.policyReport.violations = [violation];
  policyDrift.verificationReport.fast.policyReport.official.violations = [violation];
  policyDrift.verificationReport.fast.policy.violations = [violation];
  policyDrift.verificationReport.policy.violations = [violation];
  expectBlocked(policyDrift);

  const runtimeDrift = mutablePassedArtifact();
  const skipped: RuntimeStep = { status: 'skipped', passed: [], failed: [], command: null };
  runtimeDrift.verificationReport.runtime.acceptance = skipped;
  runtimeDrift.runtimeReport.acceptance = structuredClone(skipped);
  invalidateCoverage(runtimeDrift);
  expectBlocked(runtimeDrift);
});

test('skipped policy cannot conceal declared inventory', () => {
  const candidate = mutablePassedArtifact();
  candidate.policyReport.status = 'skipped';
  candidate.verificationReport.fast.policyReport.status = 'skipped';
  candidate.verificationReport.fast.policy.status = 'skipped';
  candidate.verificationReport.policy.status = 'skipped';
  expectBlocked(candidate);
});

test('full-runtime PASS requires nonblank inventories and commands', () => {
  const blankInventory = mutablePassedArtifact();
  blankInventory.verificationReport.runtime.unit.passed = [''];
  blankInventory.runtimeReport.unit.passed = [''];
  expectBlocked(blankInventory);

  const missingCommand = mutablePassedArtifact();
  missingCommand.verificationReport.runtime.unit.command = null;
  missingCommand.runtimeReport.unit.command = null;
  expectBlocked(missingCommand);
});

test('coverage cannot be emptied or partially forged under a green claim summary', () => {
  const missingCoverage = mutablePassedArtifact();
  invalidateCoverage(missingCoverage);
  expectBlocked(missingCoverage);

  const forgedCoverage = mutablePassedArtifact();
  forgedCoverage.acceptanceCoverage.acceptancePassed = [];
  expectBlocked(forgedCoverage);

  const partialCoverage = mutablePassedArtifact();
  partialCoverage.acceptanceCoverage.blocks[0]!.declaredAcceptance.push('second_requirement');
  partialCoverage.acceptanceCoverage.blocks[0]!.uncovered = false;
  expectBlocked(partialCoverage);
});

test('all-lane artifacts cannot replace full runtime proof with a service projection', () => {
  const candidate = mutablePassedArtifact();
  const skipped: RuntimeStep = { status: 'skipped', passed: [], failed: [], command: null };
  candidate.verificationReport.runtime.acceptance = skipped;
  candidate.runtimeReport.acceptance = structuredClone(skipped);
  invalidateCoverage(candidate);
  candidate.verificationReport.summary.status = 'failed';
  const expected = buildExpectedProductVerificationClaimSummary(
    'all',
    candidate.verificationReport.fast as any,
    candidate.verificationReport.runtime as any,
    'service',
    candidate.policyReport,
    candidate.acceptanceCoverage as any,
    productVerificationObservationsFixture('all', 'service')
  );
  candidate.verificationReport.summary.claimSummary = {
    overall: expected.overall,
    gates: [...expected.gates]
  };
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

test('object member reordering preserves a semantically identical artifact', () => {
  const candidate = mutablePassedArtifact();
  const original = candidate.verificationReport.summary.claimSummary;
  candidate.verificationReport.summary.claimSummary = {
    gates: original.gates,
    overall: {
      claimResults: original.overall.claimResults,
      overallReasonCode: original.overall.overallReasonCode,
      overallStatus: original.overall.overallStatus
    }
  };
  expect(isCanonicalVerificationArtifactSet(candidate)).toBe(true);
  expect(classifyIsolatedVerificationArtifactSet(candidate)).toBe('passed');
});
