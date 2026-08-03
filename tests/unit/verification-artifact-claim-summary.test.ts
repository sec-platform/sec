import { expect, test } from 'bun:test';

import {
  classifySemanticMutationIsolatedVerificationArtifactSet,
  type SemanticMutationIsolatedVerificationArtifactSet
} from '../../platform/compiler/verify/run-semantic-mutation-isolated-child.ts';
import { isCanonicalVerificationArtifactSet } from '../../platform/shared/verification-artifact-contract.ts';
import {
  buildBlockedProductVerificationClaimSummary,
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

type PolicyStatus = 'passed' | 'failed' | 'skipped';

interface RuntimeStep {
  status: PolicyStatus;
  passed: string[];
  failed: string[];
  command: string | null;
}

interface MutableClaimSummaryArtifactSet extends SemanticMutationIsolatedVerificationArtifactSet {
  verificationReport: {
    build: { status: PolicyStatus };
    unit: { status: PolicyStatus; passed: string[] };
    acceptance: { status: PolicyStatus; passed: string[]; failed: string[] };
    policy: { status: PolicyStatus; violations: unknown[] };
    fast: {
      status: PolicyStatus;
      build: { status: PolicyStatus };
      unit: { status: PolicyStatus; passed: string[] };
      acceptance: { status: PolicyStatus; passed: string[]; failed: string[] };
      policy: { status: PolicyStatus; violations: unknown[] };
      policyReport: ReturnType<typeof policyReport>;
      logs: { stdout: string; stderr: string };
    };
    runtime: {
      status: PolicyStatus;
      build: RuntimeStep;
      unit: RuntimeStep;
      acceptance: RuntimeStep;
      logs: { stdout: string; stderr: string };
    };
    summary: {
      status: 'passed' | 'failed';
      requestedLane: 'all';
      failedLanes: Array<'fast' | 'runtime'>;
      claimSummary: {
        overall: {
          overallStatus: VerificationResultStatus;
          overallReasonCode: VerificationReasonCode;
          claimResults: VerificationClaimResultV1[];
        };
        gates: VerificationGateResultV1[];
      };
    };
    logs: { stdout: string; stderr: string };
  };
  runtimeReport: {
    status: PolicyStatus;
    build: RuntimeStep;
    unit: RuntimeStep;
    acceptance: RuntimeStep;
    logs: { stdout: string; stderr: string };
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
    slots: Array<{
      id: string;
      declaredAcceptance: string[];
      coveredBy: string[];
      uncovered: boolean;
    }>;
    uncoveredBlocks: string[];
    uncoveredSlots: string[];
  };
}

function policyReport(status: 'passed' | 'skipped' = 'passed') {
  const hasPolicy = status === 'passed';
  return {
    status,
    official: {
      policies: hasPolicy ? ['tenant-policy'] : [],
      sources: hasPolicy ? [{ path: 'policies/tenant.yaml', policyIds: ['tenant-policy'] }] : [],
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
        sourcePath: 'policies/tenant.yaml',
        targets: ['src/customer.ts']
      }] : []
    },
    violations: [] as ReturnType<typeof blockingViolation>[]
  };
}

function blockingViolation() {
  return {
    id: 'tenant-policy',
    severity: 'blocker' as const,
    appliesTo: ['customer-service'],
    rule: 'tenant_context_must_flow_to_query',
    files: ['src/customer.ts'],
    message: 'Tenant context is missing.',
    sourceScope: 'official' as const,
    sourcePath: 'policies/tenant.yaml'
  };
}

function semanticBundle() {
  return {
    snapshot: { ir: { inputRevision: INPUT_REVISION, semanticRevision: SEMANTIC_REVISION } },
    generatorPlan: { inputRevision: INPUT_REVISION, semanticRevision: SEMANTIC_REVISION, tasks: [] },
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
    build: {
      status: 'passed' as const, passed: ['next build'], failed: [], command: 'bun run build'
    },
    unit: {
      status: 'passed' as const, passed: ['runtime-unit'], failed: [], command: 'bun run test:unit'
    },
    acceptance: {
      status: 'passed' as const,
      passed: ['runtime-acceptance'],
      failed: [],
      command: 'bun run test:acceptance'
    },
    logs: runtimeLogs
  } : {
    status: 'failed' as const,
    build: {
      status: 'failed' as const, passed: [], failed: ['next build'], command: 'bun run build'
    },
    unit: { status: 'skipped' as const, passed: [], failed: [], command: 'bun run test:unit' },
    acceptance: {
      status: 'skipped' as const,
      passed: [],
      failed: [],
      command: 'bun run test:acceptance'
    },
    logs: runtimeLogs
  };
  const claimSummary = buildExpectedProductVerificationClaimSummary(
    'all', fast, runtime, 'full', policy
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

function blockedArtifactSet(): SemanticMutationIsolatedVerificationArtifactSet {
  const candidate = structuredClone(artifactSet('failed')) as MutableClaimSummaryArtifactSet;
  candidate.verificationReport.fast.status = 'failed';
  candidate.verificationReport.fast.build.status = 'skipped';
  candidate.verificationReport.fast.unit = { status: 'skipped', passed: [] };
  candidate.verificationReport.fast.acceptance = { status: 'skipped', passed: [], failed: [] };
  candidate.verificationReport.build = candidate.verificationReport.fast.build;
  candidate.verificationReport.unit = candidate.verificationReport.fast.unit;
  candidate.verificationReport.acceptance = candidate.verificationReport.fast.acceptance;
  candidate.verificationReport.runtime = {
    status: 'skipped',
    build: { status: 'skipped', passed: [], failed: [], command: 'bun run build' },
    unit: { status: 'skipped', passed: [], failed: [], command: 'bun run test:unit' },
    acceptance: {
      status: 'skipped', passed: [], failed: [], command: 'bun run test:acceptance'
    },
    logs: { stdout: '', stderr: '' }
  };
  candidate.runtimeReport = structuredClone(candidate.verificationReport.runtime);
  candidate.verificationReport.summary.status = 'failed';
  candidate.verificationReport.summary.failedLanes = ['fast'];
  candidate.verificationReport.summary.claimSummary =
    buildBlockedProductVerificationClaimSummary('all') as MutableClaimSummaryArtifactSet[
      'verificationReport'
    ]['summary']['claimSummary'];
  candidate.verificationReport.logs = {
    stdout: candidate.verificationReport.fast.logs.stdout,
    stderr: candidate.verificationReport.fast.logs.stderr
  };
  candidate.acceptanceCoverage.status = 'skipped';
  candidate.acceptanceCoverage.acceptancePassed = [];
  return candidate;
}

function mutablePassedArtifact(): MutableClaimSummaryArtifactSet {
  return structuredClone(artifactSet('passed')) as MutableClaimSummaryArtifactSet;
}

function expectBlocked(candidate: SemanticMutationIsolatedVerificationArtifactSet): void {
  expect(isCanonicalVerificationArtifactSet(candidate)).toBe(false);
  expect(classifySemanticMutationIsolatedVerificationArtifactSet(candidate)).toBe('blocked');
}

test('canonical artifact contract accepts ordinary pass/failure and blocked snapshot profiles', () => {
  const passed = artifactSet('passed');
  const failed = artifactSet('failed');
  const blocked = blockedArtifactSet();
  expect(isCanonicalVerificationArtifactSet(passed)).toBe(true);
  expect(isCanonicalVerificationArtifactSet(failed)).toBe(true);
  expect(isCanonicalVerificationArtifactSet(blocked)).toBe(true);
  expect(classifySemanticMutationIsolatedVerificationArtifactSet(passed)).toBe('passed');
  expect(classifySemanticMutationIsolatedVerificationArtifactSet(failed)).toBe('failed');
  expect(classifySemanticMutationIsolatedVerificationArtifactSet(blocked)).toBe('failed');
});

test('current production artifacts cannot delete claimSummary and fall back to legacy PASS', () => {
  const candidate = mutablePassedArtifact() as any;
  delete candidate.verificationReport.summary.claimSummary;
  expectBlocked(candidate);
});

test('claimSummary aggregate and complete inventory are mandatory', () => {
  const contradictory = mutablePassedArtifact();
  contradictory.verificationReport.summary.claimSummary.overall.overallStatus = 'invalidated';
  contradictory.verificationReport.summary.claimSummary.overall.overallReasonCode = 'selection-unresolved';
  expectBlocked(contradictory);

  const incomplete = mutablePassedArtifact();
  incomplete.verificationReport.summary.claimSummary.gates =
    incomplete.verificationReport.summary.claimSummary.gates.filter(
      (gate) => gate.gateId !== PRODUCT_POLICY_GATE_ID
    );
  incomplete.verificationReport.summary.claimSummary.overall.claimResults =
    incomplete.verificationReport.summary.claimSummary.overall.claimResults.filter(
      (claim) => claim.claimId !== PRODUCT_POLICY_CLAIM_ID
    );
  expectBlocked(incomplete);
});

test('passed gates, contributions and object shape remain fail-closed', () => {
  const unsupported = mutablePassedArtifact();
  unsupported.verificationReport.summary.claimSummary.gates.find(
    (gate) => gate.gateId === PRODUCT_FAST_GATE_ID
  )!.supportedClaims = [];
  expectBlocked(unsupported);

  const forged = mutablePassedArtifact();
  forged.verificationReport.summary.claimSummary.overall.claimResults[0]!
    .contributingGateIds.push('forged-gate');
  expectBlocked(forged);

  const unknown = mutablePassedArtifact() as MutableClaimSummaryArtifactSet & {
    verificationReport: { summary: { claimSummary: Record<string, unknown> } };
  };
  unknown.verificationReport.summary.claimSummary.forged = true;
  expectBlocked(unknown);
});

test('fast, runtime and policy physical reports must match the green aggregate', () => {
  const fastDrift = mutablePassedArtifact();
  fastDrift.verificationReport.fast.build.status = 'skipped';
  fastDrift.verificationReport.build.status = 'skipped';
  expectBlocked(fastDrift);

  const runtimeDrift = mutablePassedArtifact();
  const skipped: RuntimeStep = {
    status: 'skipped', passed: [], failed: [], command: 'bun run test:acceptance'
  };
  runtimeDrift.verificationReport.runtime.acceptance = skipped;
  runtimeDrift.runtimeReport.acceptance = structuredClone(skipped);
  runtimeDrift.acceptanceCoverage.acceptancePassed = [];
  expectBlocked(runtimeDrift);

  const policyDrift = mutablePassedArtifact();
  const violation = blockingViolation();
  policyDrift.policyReport.violations = [violation];
  policyDrift.policyReport.official.violations = [violation];
  policyDrift.verificationReport.fast.policyReport.violations = [violation];
  policyDrift.verificationReport.fast.policyReport.official.violations = [violation];
  policyDrift.verificationReport.fast.policy.violations = [violation];
  policyDrift.verificationReport.policy.violations = [violation];
  expectBlocked(policyDrift);
});

test('policy declaration, merged inventory and scoped violation partitions close exactly', () => {
  const scopedOnly = mutablePassedArtifact();
  const violation = blockingViolation();
  scopedOnly.policyReport.official.violations = [violation];
  scopedOnly.verificationReport.fast.policyReport.official.violations = [violation];
  expectBlocked(scopedOnly);

  const forgedMerged = mutablePassedArtifact();
  forgedMerged.policyReport.official.policies = [];
  forgedMerged.policyReport.official.sources = [];
  forgedMerged.verificationReport.fast.policyReport.official.policies = [];
  forgedMerged.verificationReport.fast.policyReport.official.sources = [];
  expectBlocked(forgedMerged);

  const skippedWithInventory = mutablePassedArtifact();
  skippedWithInventory.policyReport.status = 'skipped';
  skippedWithInventory.verificationReport.fast.policyReport.status = 'skipped';
  skippedWithInventory.verificationReport.fast.policy.status = 'skipped';
  skippedWithInventory.verificationReport.policy.status = 'skipped';
  expectBlocked(skippedWithInventory);
});

test('full-runtime PASS accepts empty physical inventories but rejects blank entries or missing commands', () => {
  const emptyAcceptance = mutablePassedArtifact();
  emptyAcceptance.verificationReport.runtime.acceptance.passed = [];
  emptyAcceptance.runtimeReport.acceptance.passed = [];
  emptyAcceptance.acceptanceCoverage.acceptancePassed = [];
  emptyAcceptance.verificationReport.summary.claimSummary =
    buildExpectedProductVerificationClaimSummary(
      'all',
      emptyAcceptance.verificationReport.fast as any,
      emptyAcceptance.verificationReport.runtime as any,
      'full',
      emptyAcceptance.policyReport
    ) as MutableClaimSummaryArtifactSet['verificationReport']['summary']['claimSummary'];
  expect(isCanonicalVerificationArtifactSet(emptyAcceptance)).toBe(true);

  const blankInventory = mutablePassedArtifact();
  blankInventory.verificationReport.runtime.unit.passed = [''];
  blankInventory.runtimeReport.unit.passed = [''];
  expectBlocked(blankInventory);

  const missingCommand = mutablePassedArtifact();
  missingCommand.verificationReport.runtime.unit.command = null;
  missingCommand.runtimeReport.unit.command = null;
  expectBlocked(missingCommand);
});

test('coverage references must be declared and accepted', () => {
  const candidate = mutablePassedArtifact();
  candidate.acceptanceCoverage.blocks = [{
    id: 'block',
    declaredAcceptance: [],
    coveredBy: ['forged'],
    uncovered: false
  }];
  expectBlocked(candidate);
});

test('empty claim/gate sets and all-lane service substitution remain blocked', () => {
  const empty = mutablePassedArtifact();
  empty.verificationReport.summary.claimSummary.overall.claimResults = [];
  empty.verificationReport.summary.claimSummary.gates = [];
  expectBlocked(empty);

  const service = mutablePassedArtifact();
  const skipped: RuntimeStep = {
    status: 'skipped', passed: [], failed: [], command: 'bun run test:acceptance'
  };
  service.verificationReport.runtime.acceptance = skipped;
  service.runtimeReport.acceptance = structuredClone(skipped);
  service.verificationReport.summary.status = 'failed';
  service.verificationReport.summary.claimSummary =
    buildExpectedProductVerificationClaimSummary(
      'all', service.verificationReport.fast as any,
      service.verificationReport.runtime as any, 'service', service.policyReport
    ) as MutableClaimSummaryArtifactSet['verificationReport']['summary']['claimSummary'];
  expectBlocked(service);
});

test('object member reordering does not invalidate a semantically identical claim summary', () => {
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
  expect(classifySemanticMutationIsolatedVerificationArtifactSet(candidate)).toBe('passed');
});
