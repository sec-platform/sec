import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';

import { buildReviewSummary, writeReviewSummary } from '../../platform/compiler/emit/write-review-summary.ts';
import {
  adaptWorkspace,
  composeWorkspace,
  initWorkspace,
  resolveWorkspace,
  verifyWorkspace
} from '../../platform/orchestrator.ts';
import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
import { readJson, writeJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import type {
  AcceptanceCoverageReport,
  LockFile,
  ProvenanceFile,
  VerificationReport
} from '../../platform/shared/types.ts';
import { createWorkspace } from '../helpers/test-utils.ts';

async function readReviewInputs(workspaceRoot: string): Promise<{
  lock: LockFile;
  provenance: ProvenanceFile;
  report: VerificationReport;
  coverage: AcceptanceCoverageReport;
}> {
  const { acceptanceCoveragePath, lockPath, provenancePath, verificationReportPath } = getWorkspacePaths(workspaceRoot);
  const [lock, provenance, report, coverage] = await Promise.all([
    readJson<LockFile>(lockPath),
    readJson<ProvenanceFile>(provenancePath),
    readJson<VerificationReport>(verificationReportPath),
    readJson<AcceptanceCoverageReport>(acceptanceCoveragePath)
  ]);

  return { lock, provenance, report, coverage };
}

test('writeReviewSummary persists generated path in lock', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-review-write-');
  const { lockPath, reviewSummaryPath } = getWorkspacePaths(workspaceRoot);
  const lock: LockFile = {
    formatVersion: '1',
    app: {
      name: 'customer-admin',
      stack: 'nextjs',
      mode: 'single-tenant'
    },
    resolvedBlocks: [],
    resolvedCapabilities: [],
    installPlan: [],
    slotTasks: [],
    generatedPaths: [],
    acceptancePlan: [],
    passStatus: {
      parse: 'succeeded',
      align: 'succeeded',
      resolve: 'succeeded',
      compose: 'succeeded',
      adapt: 'succeeded',
      verify: 'succeeded',
      repair: 'skipped',
      lock: 'succeeded',
      emit: 'pending'
    }
  };
  const provenance: ProvenanceFile = {
    formatVersion: '1',
    artifacts: []
  };
  const report: VerificationReport = {
    build: { status: 'passed' },
    unit: { status: 'passed', passed: [] },
    acceptance: { status: 'passed', passed: [], failed: [] },
    policy: { status: 'passed', violations: [] },
    fast: {
      status: 'passed',
      build: { status: 'passed' },
      unit: { status: 'passed', passed: [] },
      acceptance: { status: 'passed', passed: [], failed: [] },
      policy: { status: 'passed', violations: [] },
      logs: { stdout: '', stderr: '' }
    },
    runtime: {
      status: 'skipped',
      build: { status: 'skipped', passed: [], failed: [], command: 'npm run build' },
      unit: { status: 'skipped', passed: [], failed: [], command: 'npm run test:unit' },
      acceptance: { status: 'skipped', passed: [], failed: [], command: 'npm run test:acceptance' },
      logs: { stdout: '', stderr: '' }
    },
    summary: {
      status: 'passed',
      requestedLane: 'fast',
      failedLanes: []
    },
    logs: { stdout: '', stderr: '' }
  };
  const coverage: AcceptanceCoverageReport = {
    formatVersion: '1',
    status: 'passed',
    acceptancePassed: [],
    blocks: [],
    slots: [],
    uncoveredBlocks: [],
    uncoveredSlots: []
  };
  await writeJson(lockPath, lock);

  const summary = await writeReviewSummary(workspaceRoot, lock, provenance, report, coverage);
  const persistedLock = await readJson<LockFile>(lockPath);
  const persistedSummary = await readJson<typeof summary>(reviewSummaryPath);

  expect(summary.ciSummary).toEqual({
    status: 'passed',
    failureCount: 0,
    regressionRiskCount: 0,
    conflictHintCount: 0,
    impactedBlockCount: 0,
    impactedSlotCount: 0,
    runtimeEntryCount: 0
  });
  expect(summary).toMatchObject({
    changeSourceCount: 0,
    runtimeEntryCount: 0,
    installImpactCount: 0
  });
  expect(summary.conflictHints).toEqual([]);
  expect(persistedSummary).toEqual(summary);
  expect(persistedLock.generatedPaths).toEqual([CI_ARTIFACT_FILES.reviewSummary]);
});

test('buildReviewSummary captures fast-lane policy failures as structured failure points', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-review-fast-');
  const { projectRoot } = getWorkspacePaths(workspaceRoot);

  await initWorkspace(workspaceRoot, { reset: true });
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  await adaptWorkspace(workspaceRoot);

  await fs.writeFile(
    path.join(projectRoot, 'src', 'installed', 'entity', 'customer-service.ts'),
    `import type { CustomerInput, CustomerRecord, Database } from '../../runtime/database.ts';\nimport type { Session } from '../auth/session.ts';\nimport { normalizeCustomerInput } from '../../../custom/customer_normalizer.ts';\n\nexport function createCustomer(db: Database, session: Session, input: CustomerInput): CustomerRecord {\n  const normalized = normalizeCustomerInput(input);\n  const customer: CustomerRecord = {\n    id: db.nextCustomerId++,\n    tenantId: session.tenantId,\n    ...normalized\n  };\n  db.customers.push(customer);\n  return customer;\n}\n\nexport function listCustomers(db: Database, session: Session): CustomerRecord[] {\n  return db.customers.filter((customer) => customer.tenantId === session.tenantId);\n}\n`,
    'utf8'
  );

  await expect(verifyWorkspace(workspaceRoot)).rejects.toThrow();

  const { lock, provenance, report, coverage } = await readReviewInputs(workspaceRoot);
  const summary = await buildReviewSummary(workspaceRoot, lock, provenance, report, coverage);

  expect(summary.formatVersion).toBe('2');
  expect(summary.ciSummary.status).toBe('failed');
  expect(summary.ciSummary.failureCount).toBeGreaterThanOrEqual(2);
  expect(summary.failurePoints).toEqual(
    expect.arrayContaining([
      {
        lane: 'all',
        kind: 'summary',
        artifactPath: CI_ARTIFACT_FILES.verificationReport,
        message: 'Verification failed in lanes: fast'
      },
      {
        lane: 'fast',
        kind: 'policy',
        artifactPath: CI_ARTIFACT_FILES.policyReport,
        message: 'Policy tenant-scope-required: Tenant-scoped queries must derive tenant context and filter by tenantId.'
      }
    ])
  );
});

test('buildReviewSummary adds failed verification targets as structured failure points', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-review-runtime-targets-');
  const lock: LockFile = {
    formatVersion: '1',
    app: {
      name: 'customer-admin',
      stack: 'nextjs',
      mode: 'single-tenant'
    },
    resolvedBlocks: [
      {
        id: 'entity/customer-basic',
        version: '0.1.0',
        kind: 'capability',
        installOrder: 1,
        manifestPath: 'manifest.yaml',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'platform/registry/official'
      }
    ],
    resolvedCapabilities: [],
    installPlan: [],
    slotTasks: [],
    generatedPaths: [],
    acceptancePlan: [],
    passStatus: {
      parse: 'succeeded',
      align: 'succeeded',
      resolve: 'succeeded',
      compose: 'succeeded',
      adapt: 'succeeded',
      verify: 'failed',
      repair: 'pending',
      lock: 'pending',
      emit: 'pending'
    }
  };
  const provenance: ProvenanceFile = {
    formatVersion: '1',
    artifacts: []
  };
  const coverage: AcceptanceCoverageReport = {
    formatVersion: '1',
    status: 'failed',
    acceptancePassed: [],
    blocks: [],
    slots: [],
    uncoveredBlocks: ['entity/customer-basic'],
    uncoveredSlots: []
  };
  const report: VerificationReport = {
    build: { status: 'passed' },
    unit: { status: 'passed', passed: [] },
    acceptance: { status: 'passed', passed: [], failed: [] },
    policy: { status: 'passed', violations: [] },
    fast: {
      status: 'failed',
      build: { status: 'passed' },
      unit: { status: 'passed', passed: [] },
      acceptance: {
        status: 'failed',
        passed: [],
        failed: ['tests/acceptance/customer-normalizer.test.ts', 'tests/acceptance/customer-normalizer.test.ts']
      },
      policy: { status: 'passed', violations: [] },
      logs: { stdout: '', stderr: 'fast failed' }
    },
    runtime: {
      status: 'failed',
      build: { status: 'passed', passed: ['next build'], failed: [], command: 'npm run build' },
      unit: {
        status: 'failed',
        passed: [],
        failed: ['tests/runtime/unit/customer-runtime.test.ts', 'tests/runtime/unit/customer-runtime.test.ts'],
        command: 'npm run test:unit'
      },
      acceptance: {
        status: 'failed',
        passed: [],
        failed: ['tests/runtime/acceptance/customer-flow.spec.ts'],
        command: 'npm run test:acceptance'
      },
      logs: { stdout: '', stderr: 'runtime failed' }
    },
    summary: {
      status: 'failed',
      requestedLane: 'all',
      failedLanes: ['fast', 'runtime']
    },
    logs: { stdout: '', stderr: 'runtime failed' }
  };

  const summary = await buildReviewSummary(workspaceRoot, lock, provenance, report, coverage);

  expect(
    summary.failurePoints.filter(
      (point) => point.message === 'Fast-lane acceptance test failed: tests/acceptance/customer-normalizer.test.ts'
    )
  ).toHaveLength(1);
  expect(
    summary.failurePoints.filter(
      (point) => point.message === 'Runtime unit test failed: tests/runtime/unit/customer-runtime.test.ts'
    )
  ).toHaveLength(1);
  expect(summary.failurePoints).toEqual(
    expect.arrayContaining([
      {
        lane: 'fast',
        kind: 'acceptance',
        artifactPath: CI_ARTIFACT_FILES.verificationReport,
        message: 'Fast-lane acceptance test failed: tests/acceptance/customer-normalizer.test.ts'
      },
      {
        lane: 'runtime',
        kind: 'unit',
        artifactPath: CI_ARTIFACT_FILES.runtimeReport,
        message: 'Runtime unit tests failed'
      },
      {
        lane: 'runtime',
        kind: 'unit',
        artifactPath: CI_ARTIFACT_FILES.runtimeReport,
        message: 'Runtime unit test failed: tests/runtime/unit/customer-runtime.test.ts'
      },
      {
        lane: 'runtime',
        kind: 'acceptance',
        artifactPath: CI_ARTIFACT_FILES.runtimeReport,
        message: 'Runtime acceptance test failed: tests/runtime/acceptance/customer-flow.spec.ts'
      }
    ])
  );
  expect(summary.regressionRisks).toContainEqual({
    kind: 'coverage-gap',
    blockId: 'entity/customer-basic',
    message: 'Block entity/customer-basic has no runtime acceptance coverage'
  });
});

test('buildReviewSummary groups ticket runtime entries into explicit vertical attribution', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-review-ticket-attribution-');
  const lock: LockFile = {
    formatVersion: '1',
    app: {
      name: 'customer-admin',
      stack: 'nextjs',
      mode: 'single-tenant'
    },
    resolvedBlocks: [
      {
        id: 'ticket/basic',
        version: '0.1.0',
        kind: 'capability',
        installOrder: 1,
        manifestPath: 'manifest.yaml',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'platform/registry/official'
      },
      {
        id: 'export/csv-basic',
        version: '0.1.0',
        kind: 'capability',
        installOrder: 2,
        manifestPath: 'manifest.yaml',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'platform/registry/official'
      },
      {
        id: 'reporting/ticket-summary',
        version: '0.1.0',
        kind: 'capability',
        installOrder: 3,
        manifestPath: 'manifest.yaml',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'platform/registry/official'
      }
    ],
    resolvedCapabilities: [],
    installPlan: [
      {
        stepId: 'ticket/basic:1',
        blockId: 'ticket/basic',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'platform/registry/official',
        sourceRoot: 'ticket.basic',
        action: 'copy',
        from: 'files/app/tickets/page.tsx',
        to: 'app/tickets/page.tsx'
      },
      {
        stepId: 'export/csv-basic:2',
        blockId: 'export/csv-basic',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'platform/registry/official',
        sourceRoot: 'export.csv-basic',
        action: 'copy',
        from: 'files/app/api/tickets/export/route.ts',
        to: 'app/api/tickets/export/route.ts'
      },
      {
        stepId: 'reporting/ticket-summary:3',
        blockId: 'reporting/ticket-summary',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'platform/registry/official',
        sourceRoot: 'reporting.ticket-summary',
        action: 'copy',
        from: 'files/app/api/tickets/summary/route.ts',
        to: 'app/api/tickets/summary/route.ts'
      },
      {
        stepId: 'reporting/ticket-summary:4',
        blockId: 'reporting/ticket-summary',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'platform/registry/official',
        sourceRoot: 'reporting.ticket-summary',
        action: 'copy',
        from: 'files/src/installed/reporting/ticket-summary.ts',
        to: 'src/installed/reporting/ticket-summary.ts'
      }
    ],
    slotTasks: [],
    generatedPaths: [
      'app/tickets/page.tsx',
      'app/api/tickets/route.ts',
      'app/api/tickets/export/route.ts',
      'app/api/tickets/summary/route.ts',
      'app/api/tickets/summary/export/route.ts'
    ],
    acceptancePlan: [],
    passStatus: {
      parse: 'succeeded',
      align: 'succeeded',
      resolve: 'succeeded',
      compose: 'succeeded',
      adapt: 'succeeded',
      verify: 'succeeded',
      repair: 'skipped',
      lock: 'succeeded',
      emit: 'pending'
    }
  };
  const provenance: ProvenanceFile = {
    formatVersion: '1',
    artifacts: [
      {
        path: 'app/tickets/page.tsx',
        originType: 'generated',
        originId: 'app/tickets/page.tsx',
        generatedByPass: 'compose',
        verifiedBy: [],
        overrideStatus: 'none'
      },
      {
        path: 'app/api/tickets/summary/route.ts',
        originType: 'generated',
        originId: 'app/api/tickets/summary/route.ts',
        generatedByPass: 'compose',
        verifiedBy: [],
        overrideStatus: 'none'
      },
      {
        path: 'app/api/tickets/summary/export/route.ts',
        originType: 'generated',
        originId: 'app/api/tickets/summary/export/route.ts',
        generatedByPass: 'compose',
        verifiedBy: [],
        overrideStatus: 'none'
      }
    ]
  };
  const coverage: AcceptanceCoverageReport = {
    formatVersion: '1',
    status: 'passed',
    acceptancePassed: [],
    blocks: [],
    slots: [],
    uncoveredBlocks: [],
    uncoveredSlots: []
  };
  const report: VerificationReport = {
    build: { status: 'passed' },
    unit: { status: 'passed', passed: [] },
    acceptance: { status: 'passed', passed: [], failed: [] },
    policy: { status: 'passed', violations: [] },
    fast: {
      status: 'passed',
      build: { status: 'passed' },
      unit: { status: 'passed', passed: [] },
      acceptance: { status: 'passed', passed: [], failed: [] },
      policy: { status: 'passed', violations: [] },
      logs: { stdout: '', stderr: '' }
    },
    runtime: {
      status: 'passed',
      build: { status: 'passed', passed: [], failed: [], command: 'npm run build' },
      unit: { status: 'passed', passed: [], failed: [], command: 'npm run test:unit' },
      acceptance: { status: 'passed', passed: [], failed: [], command: 'npm run test:acceptance' },
      logs: { stdout: '', stderr: '' }
    },
    summary: {
      status: 'passed',
      requestedLane: 'all',
      failedLanes: []
    },
    logs: { stdout: '', stderr: '' }
  };

  const summary = await buildReviewSummary(workspaceRoot, lock, provenance, report, coverage);

  expect(summary).toMatchObject({
    changeSourceCount: 3,
    runtimeEntryCount: 3,
    installImpactCount: 3
  });
  expect(summary.runtimeEntries).toEqual(
    expect.arrayContaining([
      {
        path: 'app/api/tickets/summary/route.ts',
        kind: 'api',
        vertical: 'ticket',
        relatedBlocks: ['reporting/ticket-summary', 'ticket/basic']
      },
      {
        path: 'app/api/tickets/summary/export/route.ts',
        kind: 'api',
        vertical: 'ticket',
        relatedBlocks: ['export/csv-basic', 'reporting/ticket-summary', 'ticket/basic']
      }
    ])
  );
  expect(summary.verticalSlices).toEqual([
    {
      id: 'ticket',
      runtimeEntries: [
        'app/api/tickets/summary/export/route.ts',
        'app/api/tickets/summary/route.ts',
        'app/tickets/page.tsx'
      ],
      relatedBlocks: ['export/csv-basic', 'reporting/ticket-summary', 'ticket/basic']
    }
  ]);
  expect(summary.installImpacts).toEqual([
    {
      blockId: 'export/csv-basic',
      actionKinds: ['copy'],
      sourceRoots: ['export.csv-basic'],
      targetPaths: ['app/api/tickets/export/route.ts'],
      verticals: ['ticket'],
      runtimeEntries: ['app/api/tickets/export/route.ts']
    },
    {
      blockId: 'reporting/ticket-summary',
      actionKinds: ['copy'],
      sourceRoots: ['reporting.ticket-summary'],
      targetPaths: ['app/api/tickets/summary/route.ts', 'src/installed/reporting/ticket-summary.ts'],
      verticals: ['ticket'],
      runtimeEntries: ['app/api/tickets/summary/route.ts']
    },
    {
      blockId: 'ticket/basic',
      actionKinds: ['copy'],
      sourceRoots: ['ticket.basic'],
      targetPaths: ['app/tickets/page.tsx'],
      verticals: ['ticket'],
      runtimeEntries: ['app/tickets/page.tsx']
    }
  ]);
  expect(summary.installImpactSummary).toEqual({
    impactCount: 3,
    blockCount: 3,
    actionKindCount: 1,
    sourceRootCount: 3,
    targetPathCount: 4,
    verticalCount: 1,
    runtimeEntryCount: 3,
    groupCount: 1,
    blocks: ['export/csv-basic', 'reporting/ticket-summary', 'ticket/basic'],
    actionKinds: ['copy'],
    sourceRoots: ['export.csv-basic', 'reporting.ticket-summary', 'ticket.basic'],
    targetPaths: [
      'app/api/tickets/export/route.ts',
      'app/api/tickets/summary/route.ts',
      'app/tickets/page.tsx',
      'src/installed/reporting/ticket-summary.ts'
    ],
    verticals: ['ticket'],
    runtimeEntries: [
      'app/api/tickets/export/route.ts',
      'app/api/tickets/summary/route.ts',
      'app/tickets/page.tsx'
    ],
    groupSummaries: [
      {
        vertical: 'ticket',
        blockCount: 3,
        actionKindCount: 1,
        runtimeEntryCount: 3,
        targetPathCount: 4,
        blocks: ['export/csv-basic', 'reporting/ticket-summary', 'ticket/basic'],
        actionKinds: ['copy'],
        runtimeEntries: [
          'app/api/tickets/export/route.ts',
          'app/api/tickets/summary/route.ts',
          'app/tickets/page.tsx'
        ],
        targetPaths: [
          'app/api/tickets/export/route.ts',
          'app/api/tickets/summary/route.ts',
          'app/tickets/page.tsx',
          'src/installed/reporting/ticket-summary.ts'
        ]
      }
    ]
  });
  expect(summary.changeSources.find((source) => source.path === 'app/api/tickets/summary/export/route.ts')).toEqual({
    path: 'app/api/tickets/summary/export/route.ts',
    originType: 'generated',
    originId: 'app/api/tickets/summary/export/route.ts',
    runtimeKind: 'api',
    vertical: 'ticket',
    relatedBlocks: ['export/csv-basic', 'reporting/ticket-summary', 'ticket/basic']
  });
});
