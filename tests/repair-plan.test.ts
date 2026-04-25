import { expect, test } from 'vitest';

import { buildRepairPlan } from '../platform/compiler/repair/build-repair-plan.ts';
import { PASS_STATUS_PENDING } from '../platform/shared/constants.ts';
import type { LockFile, PlanFile, VerificationReport } from '../platform/shared/types.ts';

const plan: PlanFile = {
  app: {
    name: 'customer-admin',
    stack: 'nextjs-ts-prisma-sqlite',
    packageManager: 'pnpm',
    mode: 'single-tenant'
  },
  registry: {
    sources: []
  },
  blocks: [{ id: 'entity/customer-basic', version: '0.1.0' }],
  slots: [
    {
      id: 'customer_normalizer',
      block: 'entity/customer-basic',
      kind: 'adapter',
      target: 'custom/customer_normalizer.ts',
      symbol: 'normalizeCustomerInput',
      description: 'Normalize customer input.'
    }
  ],
  acceptance: [{ id: 'user_can_create_customer' }]
};

const lock: LockFile = {
  formatVersion: '1',
  app: {
    name: 'customer-admin',
    stack: 'nextjs-ts-prisma-sqlite',
    mode: 'single-tenant'
  },
  resolvedBlocks: [
    {
      id: 'entity/customer-basic',
      version: '0.1.0',
      kind: 'capability',
      installOrder: 1,
      manifestPath: 'block.manifest.yaml',
      registrySourceId: 'official',
      registryKind: 'official',
      registryLocation: 'compiler',
      registryPath: 'platform/registry/official'
    }
  ],
  resolvedCapabilities: ['customer/write'],
  installPlan: [],
  slotTasks: [
    {
      id: 'customer_normalizer',
      block: 'entity/customer-basic',
      target: 'custom/customer_normalizer.ts',
      symbol: 'normalizeCustomerInput',
      kind: 'adapter',
      status: 'filled',
      writableZones: ['custom/customer_normalizer.ts'],
      provenanceHints: {
        generator: 'mock-local-synthesizer',
        verifiedBy: []
      }
    }
  ],
  generatedPaths: [],
  acceptancePlan: ['user_can_create_customer'],
  passStatus: {
    ...PASS_STATUS_PENDING,
    parse: 'succeeded',
    align: 'succeeded',
    resolve: 'succeeded',
    compose: 'succeeded',
    adapt: 'succeeded',
    verify: 'failed'
  }
};

const failedReport: VerificationReport = {
  build: {
    status: 'passed'
  },
  unit: {
    status: 'failed',
    passed: []
  },
  acceptance: {
    status: 'passed',
    passed: ['customer-flow.test.ts'],
    failed: []
  },
  policy: {
    status: 'failed',
    violations: [
      {
        id: 'tenant-scope-required',
        severity: 'error',
        appliesTo: ['entity/customer-basic'],
        rule: 'tenant_context_must_flow_to_query',
        files: ['src/installed/entity/customer-service.ts'],
        message: 'Z policy issue.',
        sourceScope: 'official',
        sourcePath: 'platform/policies/official/policy.spec.yaml'
      },
      {
        id: 'tenant-scope-required',
        severity: 'error',
        appliesTo: ['entity/customer-basic'],
        rule: 'tenant_context_must_flow_to_query',
        files: ['src/installed/entity/customer-service.ts'],
        message: 'A policy issue.',
        sourceScope: 'official',
        sourcePath: 'platform/policies/official/policy.spec.yaml'
      },
      {
        id: 'tenant-scope-required',
        severity: 'error',
        appliesTo: ['entity/customer-basic'],
        rule: 'tenant_context_must_flow_to_query',
        files: ['src/installed/entity/customer-service.ts'],
        message: 'A policy issue.',
        sourceScope: 'official',
        sourcePath: 'platform/policies/official/policy.spec.yaml'
      }
    ]
  },
  fast: {
    status: 'failed',
    build: {
      status: 'passed'
    },
    unit: {
      status: 'failed',
      passed: []
    },
    acceptance: {
      status: 'passed',
      passed: ['customer-flow.test.ts'],
      failed: []
    },
    policy: {
      status: 'failed',
      violations: []
    },
    logs: {
      stdout: 'typecheck:passed',
      stderr: 'unit assertion failed'
    }
  },
  runtime: {
    status: 'skipped',
    build: {
      status: 'skipped',
      passed: [],
      failed: [],
      command: 'npm run build'
    },
    unit: {
      status: 'skipped',
      passed: [],
      failed: [],
      command: 'npm run test:unit'
    },
    acceptance: {
      status: 'skipped',
      passed: [],
      failed: [],
      command: 'npm run test:acceptance'
    },
    logs: {
      stdout: '',
      stderr: ''
    }
  },
  summary: {
    status: 'failed',
    requestedLane: 'fast',
    failedLanes: ['fast']
  },
  logs: {
    stdout: 'typecheck:passed',
    stderr: 'unit assertion failed'
  }
};

test('repair plan skips when verification passed', () => {
  const report: VerificationReport = {
    ...failedReport,
    build: { status: 'passed' },
    unit: { status: 'passed', passed: [] },
    acceptance: { status: 'passed', passed: [], failed: [] },
    policy: { status: 'passed', violations: [] },
    fast: {
      ...failedReport.fast,
      status: 'passed',
      unit: { status: 'passed', passed: [] },
      policy: { status: 'passed', violations: [] },
      logs: { stdout: '', stderr: '' }
    },
    runtime: {
      ...failedReport.runtime,
      status: 'skipped'
    },
    summary: {
      status: 'passed',
      requestedLane: 'all',
      failedLanes: []
    },
    logs: { stdout: '', stderr: '' }
  };

  expect(buildRepairPlan(plan, lock, report)).toEqual({
    formatVersion: '1',
    status: 'skipped',
    sourceVerificationStatus: 'passed',
    tasks: []
  });
});

test('repair plan includes structured failure points for slot and spec failures', () => {
  const repairPlan = buildRepairPlan(plan, lock, failedReport);

  expect(repairPlan.status).toBe('pending');
  expect(repairPlan.tasks).toHaveLength(1);
  expect(repairPlan.tasks[0].failureSummary).toBe('build=passed; unit=failed; acceptance=passed; policy=failed; runtime=skipped');
  expect(repairPlan.tasks[0].failurePoints).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        lane: 'fast',
        kind: 'unit',
        issueType: 'slot',
        repairable: true,
        artifactPath: 'tests/unit'
      }),
      expect.objectContaining({
        lane: 'fast',
        kind: 'policy',
        issueType: 'spec',
        repairable: false,
        artifactPath: 'generated/policy-report.json',
        message: 'A policy issue.; Z policy issue.'
      })
    ])
  );
});

test('repair plan falls back when failed summary has no lane details', () => {
  const report: VerificationReport = {
    ...failedReport,
    build: { status: 'passed' },
    unit: { status: 'passed', passed: [] },
    acceptance: { status: 'passed', passed: [], failed: [] },
    policy: { status: 'passed', violations: [] },
    fast: {
      ...failedReport.fast,
      status: 'passed',
      unit: { status: 'passed', passed: [] },
      policy: { status: 'passed', violations: [] },
      logs: { stdout: '', stderr: '' }
    },
    runtime: {
      ...failedReport.runtime,
      status: 'skipped'
    },
    summary: {
      status: 'failed',
      requestedLane: 'all',
      failedLanes: []
    }
  };

  const repairPlan = buildRepairPlan(plan, lock, report);

  expect(repairPlan.tasks[0].failurePoints).toEqual([
    {
      lane: 'all',
      kind: 'summary',
      issueType: 'unknown',
      repairable: false,
      artifactPath: 'generated/verification-report.json',
      message: 'Verification failed without lane-specific failure details'
    }
  ]);
});
