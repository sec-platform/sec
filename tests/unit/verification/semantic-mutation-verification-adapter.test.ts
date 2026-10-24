import { expect, test } from 'bun:test';

import {
  type SemanticMutationIsolationCapabilityProbe
} from '../../../src/adapters/verification/semantic-mutation-isolation-capability.ts';
import {
  planSemanticMutationVerificationCapabilities
} from '../../../src/adapters/verification/semantic-mutation-verification-adapter.ts';
import { buildSemanticMutationVerificationExecutionRef } from '../../../src/assurance/verification/semantic-mutation/execution-ref.ts';
import { assertSemanticMutationVerificationReportInvariant } from '../../../src/assurance/verification/semantic-mutation/report-contract.ts';
import { SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID, SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION, SEMANTIC_MUTATION_VERIFICATION_REPORT_REVISION } from '../../../src/assurance/verification/contract/types.ts';
import {
  executeSemanticMutationVerification
} from '../../../src/assurance/verification/semantic-mutation/verification-runtime.ts';
import { type BuildEngineeringIRInput } from '../../../src/compiler/ir/build-engineering-ir.ts';
import { buildValidatedEngineeringIR } from '../../../src/compiler/ir/validate-engineering-ir.ts';
import { sha256 } from '../../../src/compiler/semantic-mutation/canonical.ts';
import type { VerificationRequirement } from '../../../src/semantics/mutation/types.ts';

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

function requirements(): VerificationRequirement[] {
  return [
    { kind: 'acceptance', acceptanceEntityId: 'acceptance:item_can_transition' },
    { kind: 'pass', passId: 'verify' },
    { kind: 'selector', selector: 'typecheck' }
  ];
}

const availableIsolationProbe: SemanticMutationIsolationCapabilityProbe =
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
    expect(plan.capabilities).toEqual(requirements().map(requirement => ({
      requirement, status: 'non-runnable', isolated: false
    })));
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

test('issued verification executes one exact requirement union and refuses forged report or execution bindings', async () => {
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
    expect(Object.keys(input as object).sort()).toEqual([
      'runner', 'planRevision', 'attempted', 'stagedSourceDigest',
      'requiredVerificationDigest', 'requirements'
    ].sort());
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

  {
    const report = first;
    const requirements = canonicalRequirements;
    const inputRevision = snapshot.ir.inputRevision;
    const semanticRevision = snapshot.ir.semanticRevision;
    const isolationCapabilityProbe = availableIsolationProbe;
    expect(Object.keys(report)).toEqual([
      'formatRevision', 'adapterId', 'adapterRevision', 'planRevision', 'attempted',
      'stagedSourceDigest', 'requiredVerificationDigest', 'executions', 'status', 'reportRevision'
    ]);
    expect(Object.keys(report.executions[0]!)).toEqual([
      'requirement', 'runner', 'status', 'evidenceDigest'
    ]);
    for (const key of ['inputRevision', 'semanticRevision'] as const) {
      let coercions = 0;
      const candidate = { ...report, attempted: { ...report.attempted,
        [key]: { toString() { coercions++; return report.attempted[key]; } } } };
      expect(() => assertSemanticMutationVerificationReportInvariant(candidate)).toThrow();
      expect(coercions).toBe(0);
      await expect(executeSemanticMutationVerification({ capabilityPlan, requirements,
        planRevision, attempted: candidate.attempted as never, stagedSourceDigest,
        requiredVerificationDigest }, runner)).rejects.toThrow('invalid or blocked');
      expect(coercions).toBe(0);
      expect(calls).toBe(2);
    }
    for (const key of ['planRevision', 'stagedSourceDigest', 'requiredVerificationDigest'] as const) {
      let coercions = 0;
      expect(() => assertSemanticMutationVerificationReportInvariant({ ...report,
        [key]: { toString() { coercions++; return report[key]; } } })).toThrow();
      expect(coercions).toBe(0);
      expect(() => assertSemanticMutationVerificationReportInvariant({ ...report,
        [key]: `blake3:${'a'.repeat(64)}` })).toThrow();
    }

    const execution = buildSemanticMutationVerificationExecutionRef(report);
    expect(Object.keys(execution)).toEqual([
      'adapterId', 'adapterRevision', 'reportRevision', 'planRevision', 'attempted',
      'stagedSourceDigest', 'requiredVerificationDigest', 'status', 'verificationExecutionRevision'
    ]);
    expect(() => buildSemanticMutationVerificationExecutionRef({
      ...report,
      reportRevision: sha256('forged-report-revision')
    })).toThrow('revision is stale or forged');
    expect(() => buildSemanticMutationVerificationExecutionRef({
      ...report,
      forgedExtra: true
    } as never)).toThrow('non-canonical schema');

    await expect(executeSemanticMutationVerification({
      capabilityPlan,
      requirements,
      planRevision,
      attempted,
      stagedSourceDigest,
      requiredVerificationDigest: sha256('forged-union')
    }, runner)).rejects.toThrow('invalid or blocked');
    expect(calls).toBe(2);

    await expect(executeSemanticMutationVerification({
      capabilityPlan,
      requirements,
      planRevision,
      attempted: { ...attempted, transactionId: '' },
      stagedSourceDigest,
      requiredVerificationDigest
    }, runner)).rejects.toThrow('invalid or blocked');
    const nonShaEndpointPlan = structuredClone(capabilityPlan) as unknown as Record<string, unknown>;
    nonShaEndpointPlan.snapshotInputRevision = 'not-a-sha256-revision';
    delete nonShaEndpointPlan.capabilityPlanRevision;
    nonShaEndpointPlan.capabilityPlanRevision = sha256({
      domain: 'semantic-mutation-verification-capability-plan-v1',
      ...nonShaEndpointPlan
    });
    await expect(executeSemanticMutationVerification({
      capabilityPlan: nonShaEndpointPlan as never,
      requirements,
      planRevision,
      attempted: { ...attempted, inputRevision: 'not-a-sha256-revision' },
      stagedSourceDigest,
      requiredVerificationDigest
    }, runner)).rejects.toThrow('invalid or blocked');
    await expect(executeSemanticMutationVerification({
      capabilityPlan,
      requirements: requirements.map((requirement, index) => index === 0
        ? { ...requirement, forgedExtra: true } : requirement) as never,
      planRevision,
      attempted,
      stagedSourceDigest,
      requiredVerificationDigest
    }, runner)).rejects.toThrow('invalid or blocked');
    expect(calls).toBe(2);

    const forgedCapabilityPlan = structuredClone(capabilityPlan) as unknown as Record<string, unknown>;
    const forgedCapabilities = forgedCapabilityPlan.capabilities as Array<Record<string, unknown>>;
    forgedCapabilities[0] = { ...forgedCapabilities[0], isolated: false };
    delete forgedCapabilityPlan.capabilityPlanRevision;
    forgedCapabilityPlan.capabilityPlanRevision = sha256({
      domain: 'semantic-mutation-verification-capability-plan-v1',
      ...forgedCapabilityPlan
    });
    await expect(executeSemanticMutationVerification({
      capabilityPlan: forgedCapabilityPlan as never,
      requirements,
      planRevision,
      attempted,
      stagedSourceDigest,
      requiredVerificationDigest
    }, runner)).rejects.toThrow('invalid or blocked');
    expect(calls).toBe(2);

    const externalEffectPlan = await planSemanticMutationVerificationCapabilities({
      snapshot: {
        ir: {
          inputRevision,
          semanticRevision,
          entities: [{
            id: 'effect:external',
            kind: 'effect',
            label: 'External call',
            attributes: [{ key: 'effectKind', value: 'external-service-call' }]
          }],
          facts: []
        }
      } as never,
      requirements: [{ kind: 'pass', passId: 'verify' }],
      isolationCapabilityProbe
    });
    expect(externalEffectPlan.status).toBe('blocked');
    expect(externalEffectPlan.capabilities[0]).toMatchObject({
      status: 'non-runnable',
      isolated: false
    });
    const blockedPlan = await planSemanticMutationVerificationCapabilities({
      snapshot,
      requirements: [...canonicalRequirements, { kind: 'pass', passId: 'unknown' }],
      isolationCapabilityProbe: availableIsolationProbe
    });
    for (const rejectedPlan of [blockedPlan, structuredClone(capabilityPlan)]) {
      await expect(executeSemanticMutationVerification({
        ...input,
        capabilityPlan: rejectedPlan
      }, runner)).rejects.toThrow('invalid or blocked');
    }
    expect(calls).toBe(2);
  }
});
