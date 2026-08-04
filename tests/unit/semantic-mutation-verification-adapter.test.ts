import { createHash } from 'node:crypto';

import { expect, test } from 'bun:test';

import { buildValidatedEngineeringIR, type BuildEngineeringIRInput } from '../../platform/compiler/index.ts';
import {
  classifySemanticMutationIsolatedVerificationArtifactSet,
  type SemanticMutationIsolatedVerificationArtifactSet
} from '../../platform/compiler/verify/run-semantic-mutation-isolated-child.ts';
import {
  type SemanticMutationIsolationCapabilityProbeV1
} from '../../platform/compiler/verify/semantic-mutation-isolation-capability.ts';
import {
  executeSemanticMutationVerification,
  planSemanticMutationVerificationCapabilities
} from '../../platform/compiler/verify/semantic-mutation-verification-adapter.ts';
import { buildClaimSummary } from '../../platform/compiler/verify/verify-project.ts';
import type { VerificationRequirementV1 } from '../../platform/shared/semantic-mutation-types.ts';
import {
  SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID,
  SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION,
  SEMANTIC_MUTATION_VERIFICATION_REPORT_REVISION
} from '../../platform/shared/verification-types.ts';

function sha256(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function buildInput(): BuildEngineeringIRInput {
  return {
    app: { id: 'verification-app', name: 'Verification App' },
    resolvedBlocks: [{
      id: 'item/basic',
      version: '0.1.0',
      kind: 'capability',
      installOrder: 1,
      manifestPath: 'registry/item.basic/block.manifest.yaml',
      registrySourceId: 'official',
      registryKind: 'official',
      registryLocation: 'compiler',
      registryPath: 'registry/item.basic'
    }],
    manifests: [{
      blockId: 'item/basic',
      manifestPath: 'registry/item.basic/block.manifest.yaml',
      manifest: {
        requires: [],
        provides: ['item/write'],
        pins: { inputs: [], outputs: [] },
        generators: [{
          id: 'item-status-runtime-contract',
          kind: 'generate-state-transition-map',
          contract: 'item-core',
          state: 'item-status',
          target: 'src/installed/item/item-semantic-contract.ts',
          consumes: ['state', 'transition'],
          produces: 'typescript-runtime-contract',
          typeBinding: { name: 'ItemStatus', importFrom: '../../runtime/database.ts' },
          verification: ['typecheck', 'item_can_transition']
        }]
      }
    }],
    slotTasks: [],
    acceptanceIds: ['item_can_transition'],
    policyDeclarations: [],
    semanticContracts: [{
      blockId: 'item/basic',
      contractPath: 'registry/item.basic/contracts/item.yaml',
      contract: {
        formatVersion: '1',
        id: 'item-core',
        namespace: 'item',
        entities: [{
          id: 'Item',
          fields: [{ id: 'status', type: 'ItemStatus', required: true, mutable: true }]
        }],
        states: [{
          id: 'item-status',
          entity: 'Item',
          field: 'status',
          owner: 'ItemStateMachine',
          values: ['closed', 'open'],
          transitions: [{ from: 'open', to: 'closed', by: 'closeItem' }]
        }],
        responsibilities: [{
          id: 'ItemStateMachine',
          role: 'Own item status',
          owns: ['Item.status'],
          implements: ['closeItem'],
          dependsOn: []
        }],
        operations: [{
          id: 'closeItem',
          responsibility: 'ItemStateMachine',
          inputs: ['Item'],
          output: 'Item',
          reads: ['Item.status'],
          writes: [],
          mutates: ['Item.status'],
          requiresPolicies: [],
          requiresPermissions: [],
          performsEffects: [],
          emits: [],
          invokes: [],
          awaits: []
        }],
        events: [],
        policies: [],
        permissions: [],
        effects: [],
        scenarios: []
      }
    }]
  };
}

function requirements(): VerificationRequirementV1[] {
  return [
    { kind: 'acceptance', acceptanceEntityId: 'acceptance:item_can_transition' },
    { kind: 'pass', passId: 'verify' },
    { kind: 'selector', selector: 'typecheck' }
  ];
}

const availableIsolationProbe: SemanticMutationIsolationCapabilityProbeV1 =
  () => ({ status: 'available' });

test('local adapter plans only freshly proven isolated capabilities in canonical order', async () => {
  const snapshot = buildValidatedEngineeringIR(buildInput());
  let probeCalls = 0;
  const isolationCapabilityProbe = () => {
    probeCalls += 1;
    return { status: 'available' };
  };
  const first = await planSemanticMutationVerificationCapabilities({
    snapshot,
    requirements: [...requirements()].reverse(),
    isolationCapabilityProbe
  });
  const second = await planSemanticMutationVerificationCapabilities({
    snapshot,
    requirements: [...requirements()].reverse(),
    isolationCapabilityProbe
  });

  expect(probeCalls).toBe(2);
  expect(first).toEqual(second);
  expect(first).toMatchObject({
    adapterId: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID,
    adapterRevision: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION,
    status: 'runnable',
    blockedRequirementKeys: []
  });
  expect(first.capabilities.map((entry) => entry.requirement)).toEqual(requirements());
  expect(first.capabilities.every((entry) => entry.status === 'runnable' && entry.isolated)).toBe(true);
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(first.capabilities)).toBe(true);
});

test('missing, thrown, unavailable, and invalid probe evidence fail closed after one probe', async () => {
  const snapshot = buildValidatedEngineeringIR(buildInput());
  const candidates = [
    undefined,
    () => ({ status: 'unavailable' }),
    () => {
      throw new Error('probe failed');
    },
    () => ({ status: 'available', extra: true }),
    () => ({
      formatRevision: 'semantic-mutation-isolation-capability-evidence-v1',
      status: 'available'
    }),
    () => 'available'
  ];

  for (const candidate of candidates) {
    let probeCalls = 0;
    const isolationCapabilityProbe = candidate === undefined
      ? undefined
      : () => {
        probeCalls += 1;
        return candidate();
      };
    const plan = await planSemanticMutationVerificationCapabilities({
      snapshot,
      requirements: requirements(),
      isolationCapabilityProbe
    });
    expect(probeCalls).toBe(candidate === undefined ? 0 : 1);
    expect(plan.status).toBe('blocked');
    expect(plan.capabilities.every((entry) =>
      entry.status === 'non-runnable' && entry.isolated === false)).toBe(true);
  }
});

test('unknown, missing, duplicate, unsafe, non-runnable requirements are blocked', async () => {
  const snapshot = buildValidatedEngineeringIR(buildInput());
  const plan = await planSemanticMutationVerificationCapabilities({
    snapshot,
    requirements: [
      { kind: 'pass', passId: 'verify' },
      { kind: 'pass', passId: 'verify' },
      { kind: 'pass', passId: 'build' },
      { kind: 'acceptance', acceptanceEntityId: 'acceptance:missing' },
      { kind: 'selector', selector: '!unsafe' },
      { kind: 'selector', selector: 'missing_selector' }
    ],
    isolationCapabilityProbe: availableIsolationProbe
  });

  expect(plan.status).toBe('blocked');
  expect(plan.blockedRequirementKeys).toEqual([
    'acceptance\u0000acceptance:missing',
    'pass\u0000build',
    'pass\u0000verify',
    'selector\u0000!unsafe',
    'selector\u0000missing_selector'
  ]);
  expect(plan.capabilities.filter((entry) => entry.status === 'non-runnable')).toHaveLength(4);
});

test('execution calls verify-all once and emits an exact deterministic report binding', async () => {
  const snapshot = buildValidatedEngineeringIR(buildInput());
  const canonicalRequirements = requirements();
  let probeCalls = 0;
  const capabilityPlan = await planSemanticMutationVerificationCapabilities({
    snapshot,
    requirements: canonicalRequirements,
    isolationCapabilityProbe: () => {
      probeCalls += 1;
      return { status: 'available' };
    }
  });
  const attempted = {
    transactionId: 'tx:staged',
    inputRevision: snapshot.ir.inputRevision,
    semanticRevision: snapshot.ir.semanticRevision
  };
  const planRevision = sha256('plan');
  const stagedSourceDigest = sha256('staged-source');
  const requiredVerificationDigest = sha256({
    domain: 'semantic-mutation-required-verification-v1',
    requirements: canonicalRequirements
  });
  const evidenceDigest = sha256('verify-all-report');
  let calls = 0;
  const runner = (input: unknown) => {
    calls += 1;
    expect(Object.isFrozen(input)).toBe(true);
    return { status: 'passed' as const, evidenceDigest };
  };
  const input = {
    capabilityPlan,
    requirements: canonicalRequirements,
    planRevision,
    attempted,
    stagedSourceDigest,
    requiredVerificationDigest
  };

  const first = await executeSemanticMutationVerification(input, runner);
  const second = await executeSemanticMutationVerification(input, runner);

  expect(probeCalls).toBe(1);
  expect(calls).toBe(2);
  expect(first).toEqual(second);
  expect(first).toMatchObject({
    formatRevision: SEMANTIC_MUTATION_VERIFICATION_REPORT_REVISION,
    planRevision,
    attempted,
    stagedSourceDigest,
    requiredVerificationDigest,
    status: 'passed'
  });
  expect(first.executions).toHaveLength(3);
  expect(first.executions.every((entry) =>
    entry.runner === 'verify-all' && entry.status === 'passed' && entry.evidenceDigest === evidenceDigest)).toBe(true);
  const { reportRevision, ...withoutRevision } = first;
  expect(reportRevision).toBe(sha256({
    domain: 'semantic-mutation-verification-report-v1',
    ...withoutRevision
  }));
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(first.executions[0])).toBe(true);
  expect(JSON.stringify(first)).not.toContain('workspaceRoot');
  expect(JSON.stringify(first)).not.toContain('capabilityPlanRevision');
});

test('blocked plans and forged execution bindings never call the runner', async () => {
  const snapshot = buildValidatedEngineeringIR(buildInput());
  const canonicalRequirements = requirements();
  const capabilityPlan = await planSemanticMutationVerificationCapabilities({
    snapshot,
    requirements: [...canonicalRequirements, { kind: 'pass', passId: 'unknown' }],
    isolationCapabilityProbe: availableIsolationProbe
  });
  let calls = 0;

  await expect(executeSemanticMutationVerification({
    capabilityPlan,
    requirements: canonicalRequirements,
    planRevision: sha256('plan'),
    attempted: {
      transactionId: 'tx:staged',
      inputRevision: snapshot.ir.inputRevision,
      semanticRevision: snapshot.ir.semanticRevision
    },
    stagedSourceDigest: sha256('staged-source'),
    requiredVerificationDigest: sha256('forged')
  }, () => {
    calls += 1;
    return { status: 'passed', evidenceDigest: sha256('evidence') };
  })).rejects.toThrow('invalid or blocked');
  const runnablePlan = await planSemanticMutationVerificationCapabilities({
    snapshot,
    requirements: canonicalRequirements,
    isolationCapabilityProbe: availableIsolationProbe
  });
  await expect(executeSemanticMutationVerification({
    capabilityPlan: {
      ...runnablePlan,
      capabilityPlanRevision: sha256('forged-capability-plan')
    },
    requirements: canonicalRequirements,
    planRevision: sha256('plan'),
    attempted: {
      transactionId: 'tx:staged',
      inputRevision: snapshot.ir.inputRevision,
      semanticRevision: snapshot.ir.semanticRevision
    },
    stagedSourceDigest: sha256('staged-source'),
    requiredVerificationDigest: sha256({
      domain: 'semantic-mutation-required-verification-v1',
      requirements: canonicalRequirements
    })
  }, () => {
    calls += 1;
    return { status: 'passed', evidenceDigest: sha256('evidence') };
  })).rejects.toThrow('invalid or blocked');
  await expect(executeSemanticMutationVerification({
    capabilityPlan: structuredClone(runnablePlan),
    requirements: canonicalRequirements,
    planRevision: sha256('plan'),
    attempted: {
      transactionId: 'tx:staged',
      inputRevision: snapshot.ir.inputRevision,
      semanticRevision: snapshot.ir.semanticRevision
    },
    stagedSourceDigest: sha256('staged-source'),
    requiredVerificationDigest: sha256({
      domain: 'semantic-mutation-required-verification-v1',
      requirements: canonicalRequirements
    })
  }, () => {
    calls += 1;
    return { status: 'passed', evidenceDigest: sha256('evidence') };
  })).rejects.toThrow('invalid or blocked');
  expect(calls).toBe(0);
});

const ISOLATED_INPUT_REVISION = `sha256:${'1'.repeat(64)}`;
const ISOLATED_SEMANTIC_REVISION = `sha256:${'2'.repeat(64)}`;

function isolatedPolicyReport() {
  return {
    status: 'passed' as const,
    official: { policies: [], sources: [], violations: [] },
    project: { policies: [], sources: [], violations: [] },
    merged: { policies: [] },
    violations: []
  };
}

function isolatedSemanticBundle() {
  return {
    snapshot: {
      ir: {
        inputRevision: ISOLATED_INPUT_REVISION,
        semanticRevision: ISOLATED_SEMANTIC_REVISION
      }
    },
    generatorPlan: {
      inputRevision: ISOLATED_INPUT_REVISION,
      semanticRevision: ISOLATED_SEMANTIC_REVISION,
      tasks: []
    },
    semanticViews: {
      formatVersion: '1',
      inputRevision: ISOLATED_INPUT_REVISION,
      semanticRevision: ISOLATED_SEMANTIC_REVISION,
      views: []
    },
    semanticContractSources: []
  };
}

function isolatedArtifactSet(status: 'passed' | 'failed'): SemanticMutationIsolatedVerificationArtifactSet {
  const policy = isolatedPolicyReport();
  const fastLogs = { stdout: 'fast-verification', stderr: '' };
  const runtimeLogs = status === 'passed'
    ? { stdout: 'runtime-verification', stderr: '' }
    : { stdout: '', stderr: 'private failure at C:\\workspace\\secret' };
  const fast = {
    status: 'passed' as const,
    build: { status: 'passed' as const },
    unit: { status: 'passed' as const, passed: [] },
    acceptance: { status: 'passed' as const, passed: [], failed: [] },
    policy: { status: 'passed' as const, violations: [] },
    policyReport: policy,
    logs: fastLogs
  };
  const runtime = status === 'passed' ? {
    status: 'passed' as const,
    build: { status: 'passed' as const, passed: ['next build'], failed: [], command: 'bun run build' },
    unit: { status: 'passed' as const, passed: [], failed: [], command: 'bun run test:unit' },
    acceptance: { status: 'passed' as const, passed: [], failed: [], command: 'bun run test:acceptance' },
    logs: runtimeLogs
  } : {
    status: 'failed' as const,
    build: { status: 'failed' as const, passed: [], failed: ['next build'], command: 'bun run build' },
    unit: { status: 'skipped' as const, passed: [], failed: [], command: null },
    acceptance: { status: 'skipped' as const, passed: [], failed: [], command: null },
    logs: runtimeLogs
  };
  const claimSummary = buildClaimSummary('all', fast, runtime, 'full', policy);
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
        status: claimSummary.overall.overallStatus === 'passed' ? 'passed' : 'failed',
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
      acceptancePassed: [],
      blocks: [],
      slots: [],
      uncoveredBlocks: [],
      uncoveredSlots: []
    },
    semanticBundle: isolatedSemanticBundle()
  };
}

test('isolated child outcome accepts exact report-bound pass and nonzero verification failure', () => {
  expect(classifySemanticMutationIsolatedVerificationArtifactSet(isolatedArtifactSet('passed'))).toBe('passed');
  expect(classifySemanticMutationIsolatedVerificationArtifactSet(isolatedArtifactSet('failed'))).toBe('failed');
});

test('isolated child outcome blocks unavailable or incomplete artifact protocols without exposing logs', () => {
  const passedNonzero = { ...isolatedArtifactSet('passed'), childExitCode: 1 };
  const failedZero = { ...isolatedArtifactSet('failed'), childExitCode: 0 };
  const missingReport = { ...isolatedArtifactSet('failed'), runtimeReport: undefined };
  const forgedRuntime = structuredClone(isolatedArtifactSet('failed')) as
    SemanticMutationIsolatedVerificationArtifactSet & { runtimeReport: Record<string, unknown> };
  forgedRuntime.runtimeReport.forged = 'C:\\workspace\\secret';
  const mismatchedBundle = structuredClone(isolatedArtifactSet('failed')) as
    SemanticMutationIsolatedVerificationArtifactSet & {
      semanticBundle: { generatorPlan: { inputRevision: string } };
    };
  mismatchedBundle.semanticBundle.generatorPlan.inputRevision = `sha256:${'3'.repeat(64)}`;

  for (const candidate of [passedNonzero, failedZero, missingReport, forgedRuntime, mismatchedBundle]) {
    const outcome = classifySemanticMutationIsolatedVerificationArtifactSet(candidate);
    expect(outcome).toBe('blocked');
    expect(outcome).not.toContain('workspace');
    expect(outcome).not.toContain('secret');
  }
});
