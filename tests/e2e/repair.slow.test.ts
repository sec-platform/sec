import { expect, test } from 'bun:test';

import { readJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import type {
  ExplainGraph,
  RepairPlan
} from '../../platform/shared/types.ts';
import {
  writeFailedFastUnitVerification,
  writePassingVerificationState
} from '../helpers/verification-fixtures.ts';
import {
  expectCliJson,
  expectCliSuccess,
  expectCliText,
  runCliInProcess as runCli,
  runCliPipeline
} from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('CLI emits repair dry-run JSON for CI consumers', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await runCliPipeline(workspaceRoot, { verifyLane: 'fast' });

    const { repairPlanPath } = getWorkspacePaths(workspaceRoot);
    await writeFailedFastUnitVerification(workspaceRoot, 'Unit verification failed for customer_normalizer');

    await expectCliText(workspaceRoot, ['repair', '--dry-run'], [
      'Repair pending (1 tasks, 0 blockers) (dry-run)',
      'Source verification: failed; requires verification: false',
      'Task repair_slot_customer_normalizer: entity/customer-basic -> source/code/slots/customer_normalizer.ts',
      'Review repair_slot_customer_normalizer: writeBounds=source/code/slots/customer_normalizer.ts; symbols=normalizeCustomerInput; tests=tests/unit/customer-normalizer.test.ts, tests/acceptance/customer-flow.test.ts; forbidden=modify_other_files, add_dependencies, access_database, change_exports; failureTargets=none',
      'Preview repair_slot_customer_normalizer: changed=false; +0; -0;',
      'Failure fast/unit; issue=slot; repairable=true;',
      'Unit verification failed for customer_normalizer'
    ]);

    const repairPlan = await expectCliJson<RepairPlan>(
      workspaceRoot,
      ['repair', '--dry-run', '--json'],
      undefined,
      { stdoutMarkers: ['\n  "status": "pending"'] }
    );
    expect(repairPlan).toMatchObject({
      formatVersion: '1',
      status: 'pending',
      sourceVerificationStatus: 'failed',
      requiresVerification: false
    });
    expect(repairPlan.tasks).toHaveLength(1);
    expect(repairPlan.tasks[0]).toMatchObject({
      taskId: 'repair_slot_customer_normalizer',
      taskKind: 'repair-slot',
      category: 'slot-rewrite',
      sourceSlotId: 'customer_normalizer',
      targetBlock: 'entity/customer-basic',
      targetFile: 'source/code/slots/customer_normalizer.ts',
      review: {
        allowedPathCount: 1,
        requiredSymbolCount: 1,
        forbiddenOperationCount: 4,
        testCount: 2,
        failureTargetCount: 0,
        sourceSlotStatus: 'filled',
        sourceWritableZones: ['source/code/slots/customer_normalizer.ts', 'custom/'],
        sourceProvenanceHints: {
          generator: 'mock-local-synthesizer',
          verifiedBy: []
        },
        writeBounds: ['source/code/slots/customer_normalizer.ts'],
        requiredSymbols: ['normalizeCustomerInput'],
        forbiddenOperations: [
          'modify_other_files',
          'add_dependencies',
          'access_database',
          'change_exports'
        ],
        testsToPass: [
          'tests/unit/customer-normalizer.test.ts',
          'tests/acceptance/customer-flow.test.ts'
        ],
        failureTargets: []
      }
    });
    expect(repairPlan.tasks[0].failurePoints).toHaveLength(1);
    expect(repairPlan.tasks[0].failurePoints[0]).toMatchObject({
      lane: 'fast',
      kind: 'unit',
      issueType: 'slot',
      repairable: true,
      artifactPath: 'tests/unit'
    });
    expect(repairPlan.tasks[0].preview).toMatchObject({
      changed: false
    });

    const writtenRepairPlan = await readJson<RepairPlan>(repairPlanPath);
    expect(writtenRepairPlan).toEqual(repairPlan);

    await expectCliText(workspaceRoot, ['repair', 'plan'], [
      'Repair pending (1 tasks, 0 blockers) (dry-run)',
      'Task repair_slot_customer_normalizer: entity/customer-basic -> source/code/slots/customer_normalizer.ts'
    ]);

    const planJson = await expectCliJson<RepairPlan>(
      workspaceRoot,
      ['repair', 'plan', '--json'],
      undefined,
      { stdoutMarkers: ['\n  "status": "pending"'] }
    );
    expect(planJson).toEqual(repairPlan);

    const planCompactJson = await expectCliJson<RepairPlan>(
      workspaceRoot,
      ['repair', 'plan', '--json', '--compact'],
      undefined,
      { compact: true }
    );
    expect(planCompactJson).toEqual(repairPlan);

    await withTempWorkspace(async (missingPlanWorkspace) => {
      await expect(runCli(missingPlanWorkspace, ['repair', 'plan'])).resolves.toMatchObject({
        code: 1,
        stdout: '',
        stderr: expect.stringContaining('Repair plan not found; run platform repair --dry-run first')
      });
    });

    const compactResult = await expectCliJson<RepairPlan>(
      workspaceRoot,
      ['repair', '--dry-run', '--json', '--compact'],
      undefined,
      { compact: true }
    );
    expect(compactResult).toEqual(repairPlan);

    await writePassingVerificationState(workspaceRoot);

    await expectCliSuccess(workspaceRoot, ['lock'], 'Locked project\n');

    await expectCliText(workspaceRoot, ['explain'], [
      [
        'Repair: pending',
        'tasks: 1',
        'blockers: 0',
        'changed previews: 0',
        'requires verification: false',
        'trace: repair-not-applied->apply-repair',
        'categories: slot-rewrite=1',
        'issues: slot=1',
        'targets: none',
        'repairability: repairable=1'
      ].join('; ')
    ]);

    const explainPayload = await expectCliJson<{
      graph: ExplainGraph;
      reviewSummary: {
        repairSummary?: {
          status: string;
          taskCount: number;
          blockerCount: number;
          previewCount: number;
          changedPreviewCount: number;
          failurePointCount: number;
          verificationTrace: {
            pendingReason: string;
            nextAction: string;
          };
          failureTaxonomy: {
            laneSummaries: Array<{ id: string; count: number }>;
            kindSummaries: Array<{ id: string; count: number }>;
            issueTypeSummaries: Array<{ id: string; count: number }>;
            repairabilitySummaries: Array<{ id: string; count: number }>;
          };
          targetSummaries: Array<{ id: string; targetType: string; count: number }>;
          taskCategorySummaries: Array<{ id: string; count: number }>;
          targetFileCount: number;
          targetFiles: string[];
          taskSummaries: Array<{
            taskId: string;
            allowedPathCount: number;
            requiredSymbolCount: number;
            forbiddenOperationCount: number;
            testCount: number;
            failureTargetCount: number;
            writeBounds: string[];
            requiredSymbols: string[];
            forbiddenOperations: string[];
            testsToPass: string[];
            failureTargets: string[];
          }>;
        };
      };
    }>(workspaceRoot, ['explain', '--json']);
    expect(explainPayload.reviewSummary.repairSummary).toMatchObject({
      status: 'pending',
      taskCount: 1,
      blockerCount: 0,
      previewCount: 1,
      changedPreviewCount: 0,
      failurePointCount: 1,
      verificationTrace: {
        pendingReason: 'repair-not-applied',
        nextAction: 'apply-repair'
      },
      failureTaxonomy: {
        laneSummaries: [{ id: 'fast', count: 1 }],
        kindSummaries: [{ id: 'unit', count: 1 }],
        issueTypeSummaries: [{ id: 'slot', count: 1 }],
        repairabilitySummaries: [{ id: 'repairable', count: 1 }]
      },
      targetSummaries: [],
      taskCategorySummaries: [{ id: 'slot-rewrite', count: 1 }],
      targetFileCount: 1,
      targetFiles: ['source/code/slots/customer_normalizer.ts'],
      taskSummaries: [
        expect.objectContaining({
          taskId: 'repair_slot_customer_normalizer',
          allowedPathCount: 1,
          requiredSymbolCount: 1,
          forbiddenOperationCount: 4,
          testCount: 2,
          failureTargetCount: 0,
          writeBounds: ['source/code/slots/customer_normalizer.ts'],
          requiredSymbols: ['normalizeCustomerInput'],
          forbiddenOperations: [
            'modify_other_files',
            'add_dependencies',
            'access_database',
            'change_exports'
          ],
          testsToPass: [
            'tests/unit/customer-normalizer.test.ts',
            'tests/acceptance/customer-flow.test.ts'
          ],
          failureTargets: []
        })
      ]
    });
  });
}, 120000);

test('CLI emits blocked repair JSON for CI consumers', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await runCliPipeline(workspaceRoot, { verifyLane: 'fast' });

    const { repairPlanPath } = getWorkspacePaths(workspaceRoot);
    await writeFailedFastUnitVerification(workspaceRoot, 'Unit verification failed without slot ownership', {
      slotTasks: []
    });

    const textResult = await runCli(workspaceRoot, ['repair', '--dry-run']);
    expect(textResult.code).toBe(1);
    expect(textResult.stdout).toContain('Repair blocked (0 tasks, 1 blockers) (dry-run)');
    expect(textResult.stdout).toContain('Blocker repair_blocker_no_slot_tasks: slot;');
    expect(textResult.stdout).toContain(
      'Failure fast/unit; issue=slot; repairable=true;'
    );
    expect(textResult.stdout).toContain('Unit verification failed without slot ownership');
    expect(textResult.stderr).toContain('REPAIR-BLOCKED-001');

    const result = await runCli(workspaceRoot, ['repair', '--dry-run', '--json']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('REPAIR-BLOCKED-001');
    expect(result.stderr).toContain('No eligible slot tasks are present in graph.lock.json');

    const repairPlan = JSON.parse(result.stdout) as RepairPlan;
    expect(result.stdout).toContain('\n  "status": "blocked"');
    expect(repairPlan).toMatchObject({
      formatVersion: '1',
      status: 'blocked',
      sourceVerificationStatus: 'failed',
      requiresVerification: false,
      tasks: []
    });
    expect(repairPlan.blockers?.length ?? 0).toBeGreaterThan(0);
    expect(repairPlan.blockers?.[0]).toMatchObject({
      blockerId: 'repair_blocker_no_slot_tasks',
      boundary: 'slot'
    });
    expect(repairPlan.blockers?.[0]?.failurePoints).toHaveLength(1);

    const writtenRepairPlan = await readJson<RepairPlan>(repairPlanPath);
    expect(writtenRepairPlan).toEqual(repairPlan);

    await expectCliText(workspaceRoot, ['repair', 'plan'], [
      'Repair blocked (0 tasks, 1 blockers) (dry-run)',
      'Blocker repair_blocker_no_slot_tasks: slot;'
    ]);

    const planJson = await expectCliJson<RepairPlan>(
      workspaceRoot,
      ['repair', 'plan', '--json', '--compact'],
      undefined,
      { compact: true }
    );
    expect(planJson).toEqual(repairPlan);

    const compactResult = await runCli(workspaceRoot, ['repair', '--dry-run', '--json', '--compact']);
    expect(compactResult.code).toBe(1);
    expect(compactResult.stderr).toContain('REPAIR-BLOCKED-001');
    expect(compactResult.stdout).not.toContain('\n  "status"');
    expect(JSON.parse(compactResult.stdout)).toEqual(repairPlan);
  });
}, 120000);
