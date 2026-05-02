import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'bun:test';

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
import {
  buildOfficialCopyInstallStep,
  buildOfficialResolvedBlock
} from '../helpers/lock-fixtures.ts';
import {
  buildPassingReviewCoverage,
  buildPassingReviewReport,
  buildReviewInputs,
  buildReviewLock,
  buildReviewProvenance,
  buildRuntimeVerificationReport
} from '../helpers/review-fixtures.ts';
import { createWorkspace } from '../helpers/workspace-fixtures.ts';

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
  const { lock, provenance, report, coverage } = buildReviewInputs({
    lock: {
      app: { stack: 'nextjs' },
      passStatus: { lock: 'succeeded' }
    }
  });
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
  expect(summary.conflictHints).toEqual([] as any);
  expect(persistedSummary).toEqual(summary);
  expect(persistedLock.generatedPaths).toEqual([] as any);
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
  const lock = buildReviewLock({
    app: { stack: 'nextjs' },
    resolvedBlocks: [buildOfficialResolvedBlock({ id: 'entity/customer-basic', installOrder: 1 })],
    passStatus: {
      verify: 'failed',
      repair: 'pending'
    }
  });
  const provenance = buildReviewProvenance();
  const coverage = buildPassingReviewCoverage({
    status: 'failed',
    uncoveredBlocks: ['entity/customer-basic']
  });
  const report = buildPassingReviewReport({
    fast: {
      status: 'failed',
      acceptance: {
        status: 'failed',
        passed: [],
        failed: ['tests/acceptance/customer-normalizer.test.ts', 'tests/acceptance/customer-normalizer.test.ts']
      },
      logs: { stdout: '', stderr: 'fast failed' }
    },
    runtime: buildRuntimeVerificationReport({
      status: 'failed',
      build: { passed: ['next build'] },
      unit: {
        status: 'failed',
        failed: ['tests/runtime/unit/customer-runtime.test.ts', 'tests/runtime/unit/customer-runtime.test.ts']
      },
      acceptance: {
        status: 'failed',
        failed: ['tests/runtime/acceptance/customer-flow.spec.ts']
      },
      logs: { stdout: '', stderr: 'runtime failed' }
    }),
    summary: {
      status: 'failed',
      requestedLane: 'all',
      failedLanes: ['fast', 'runtime']
    },
    logs: { stdout: '', stderr: 'runtime failed' }
  });

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
  const { lock, provenance, coverage, report } = buildReviewInputs({
    lock: {
      app: { stack: 'nextjs' },
      resolvedBlocks: [
        buildOfficialResolvedBlock({ id: 'ticket/basic', installOrder: 1 }),
        buildOfficialResolvedBlock({ id: 'export/csv-basic', installOrder: 2 }),
        buildOfficialResolvedBlock({ id: 'reporting/ticket-summary', installOrder: 3 })
      ],
      installPlan: [
        buildOfficialCopyInstallStep({
          stepId: 'ticket/basic:1',
          blockId: 'ticket/basic',
          sourceRoot: 'ticket.basic',
          from: 'files/app/tickets/page.tsx',
          to: 'app/tickets/page.tsx'
        }),
        buildOfficialCopyInstallStep({
          stepId: 'export/csv-basic:2',
          blockId: 'export/csv-basic',
          sourceRoot: 'export.csv-basic',
          from: 'files/app/api/tickets/export/route.ts',
          to: 'app/api/tickets/export/route.ts'
        }),
        buildOfficialCopyInstallStep({
          stepId: 'reporting/ticket-summary:3',
          blockId: 'reporting/ticket-summary',
          sourceRoot: 'reporting.ticket-summary',
          from: 'files/app/api/tickets/summary/route.ts',
          to: 'app/api/tickets/summary/route.ts'
        }),
        buildOfficialCopyInstallStep({
          stepId: 'reporting/ticket-summary:4',
          blockId: 'reporting/ticket-summary',
          sourceRoot: 'reporting.ticket-summary',
          from: 'files/src/installed/reporting/ticket-summary.ts',
          to: 'src/installed/reporting/ticket-summary.ts'
        })
      ],
      generatedPaths: [
        'app/tickets/page.tsx',
        'app/api/tickets/route.ts',
        'app/api/tickets/export/route.ts',
        'app/api/tickets/summary/route.ts',
        'app/api/tickets/summary/export/route.ts'
      ],
      passStatus: { lock: 'succeeded' }
    },
    provenance: [
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
    ],
    report: {
      runtime: buildRuntimeVerificationReport(),
      summary: {
        requestedLane: 'all'
      }
    }
  });

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
  expect(summary.verticalSlices).toEqual([] as any);
  expect(summary.installImpacts).toEqual([] as any);
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
