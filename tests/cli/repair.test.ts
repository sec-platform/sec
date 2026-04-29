import fs from 'node:fs/promises';
import { expect, test } from 'vitest';

import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import type {
  ExplainGraph,
  RepairPlan,
  VerificationReport
} from '../../platform/shared/types.ts';
import { expectCliSuccess, runCliInProcess as runCli, runCliPipeline, withTempWorkspace } from '../helpers/test-utils.ts';

test('CLI emits repair dry-run JSON for CI consumers', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await runCliPipeline(workspaceRoot, { verifyLane: 'fast' });

    const { lockPath, repairPlanPath, verificationReportPath } = getWorkspacePaths(workspaceRoot);
    const lock = JSON.parse(await fs.readFile(lockPath, 'utf8')) as { passStatus: { verify: string } };
    lock.passStatus.verify = 'failed';
    await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');

    const report = JSON.parse(await fs.readFile(verificationReportPath, 'utf8')) as VerificationReport;
    report.unit.status = 'failed';
    report.fast.status = 'failed';
    report.fast.unit.status = 'failed';
    report.fast.logs.stderr = 'Unit verification failed for customer_normalizer';
    report.summary.status = 'failed';
    report.summary.failedLanes = ['fast'];
    report.logs.stderr = 'Unit verification failed for customer_normalizer';
    await fs.writeFile(verificationReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    const textResult = await runCli(workspaceRoot, ['repair', '--dry-run']);
    expect(textResult.code).toBe(0);
    expect(textResult.stderr).toBe('');
    expect(textResult.stdout).toContain('Repair pending (1 tasks, 0 blockers) (dry-run)');
    expect(textResult.stdout).toContain('Source verification: failed; requires verification: false');
    expect(textResult.stdout).toContain('Task repair_slot_customer_normalizer: entity/customer-basic -> source/code/slots/customer_normalizer.ts');
    expect(textResult.stdout).toContain(
      'Review repair_slot_customer_normalizer: writeBounds=source/code/slots/customer_normalizer.ts; symbols=normalizeCustomerInput; tests=tests/unit/customer-normalizer.test.ts, tests/acceptance/customer-flow.test.ts; forbidden=modify_other_files, add_dependencies, access_database, change_exports; failureTargets=none'
    );
    expect(textResult.stdout).toContain(
      'Preview repair_slot_customer_normalizer: changed=false; +0; -0;'
    );
    expect(textResult.stdout).toContain(
      'Failure fast/unit; issue=slot; repairable=true;'
    );
    expect(textResult.stdout).toContain(
      'Unit verification failed for customer_normalizer'
    );

    const result = await runCli(workspaceRoot, ['repair', '--dry-run', '--json']);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');

    const repairPlan = JSON.parse(result.stdout) as RepairPlan;
    expect(result.stdout).toContain('\n  "status": "pending"');
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
    expect(repairPlan.tasks[0].failurePoints).toEqual([
      expect.objectContaining({
        lane: 'fast',
        kind: 'unit',
        issueType: 'slot',
        repairable: true,
        artifactPath: 'tests/unit',
        message: 'Unit verification failed for customer_normalizer'
      })
    ]);
    expect(repairPlan.tasks[0].preview).toMatchObject({
      changed: false
    });

    const writtenRepairPlan = JSON.parse(await fs.readFile(repairPlanPath, 'utf8')) as RepairPlan;
    expect(writtenRepairPlan).toEqual(repairPlan);

    const planText = await runCli(workspaceRoot, ['repair', 'plan']);
    expect(planText.code).toBe(0);
    expect(planText.stderr).toBe('');
    expect(planText.stdout).toContain('Repair pending (1 tasks, 0 blockers) (dry-run)');
    expect(planText.stdout).toContain('Task repair_slot_customer_normalizer: entity/customer-basic -> source/code/slots/customer_normalizer.ts');

    const planJson = await runCli(workspaceRoot, ['repair', 'plan', '--json']);
    expect(planJson.code).toBe(0);
    expect(planJson.stderr).toBe('');
    expect(planJson.stdout).toContain('\n  "status": "pending"');
    expect(JSON.parse(planJson.stdout)).toEqual(repairPlan);

    const planCompactJson = await runCli(workspaceRoot, ['repair', 'plan', '--json', '--compact']);
    expect(planCompactJson.code).toBe(0);
    expect(planCompactJson.stderr).toBe('');
    expect(planCompactJson.stdout).not.toContain('\n  "status"');
    expect(JSON.parse(planCompactJson.stdout)).toEqual(repairPlan);

    await withTempWorkspace(async (missingPlanWorkspace) => {
      await expect(runCli(missingPlanWorkspace, ['repair', 'plan'])).resolves.toMatchObject({
        code: 1,
        stdout: '',
        stderr: expect.stringContaining('Repair plan not found; run platform repair --dry-run first')
      });
    });

    const compactResult = await runCli(workspaceRoot, ['repair', '--dry-run', '--json', '--compact']);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout).not.toContain('\n  "status"');
    expect(JSON.parse(compactResult.stdout)).toEqual(repairPlan);

    lock.passStatus.verify = 'succeeded';
    await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
    report.unit.status = 'passed';
    report.fast.status = 'passed';
    report.fast.unit.status = 'passed';
    report.summary.status = 'passed';
    report.summary.requestedLane = 'all';
    report.summary.failedLanes = [];
    await fs.writeFile(verificationReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    await expectCliSuccess(workspaceRoot, ['lock'], 'Locked project\n');

    const explainText = await runCli(workspaceRoot, ['explain']);
    expect(explainText.code).toBe(0);
    expect(explainText.stderr).toBe('');
    expect(explainText.stdout).toContain(
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
    );

    const explainJson = await runCli(workspaceRoot, ['explain', '--json']);
    expect(explainJson.code).toBe(0);
    expect(explainJson.stderr).toBe('');
    const explainPayload = JSON.parse(explainJson.stdout) as {
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
    };
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
});

test('CLI emits blocked repair JSON for CI consumers', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await runCliPipeline(workspaceRoot, { verifyLane: 'fast' });

    const { lockPath, repairPlanPath, verificationReportPath } = getWorkspacePaths(workspaceRoot);
    const lock = JSON.parse(await fs.readFile(lockPath, 'utf8')) as {
      passStatus: { verify: string };
      slotTasks: unknown[];
    };
    lock.passStatus.verify = 'failed';
    lock.slotTasks = [];
    await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');

    const report = JSON.parse(await fs.readFile(verificationReportPath, 'utf8')) as VerificationReport;
    report.unit.status = 'failed';
    report.fast.status = 'failed';
    report.fast.unit.status = 'failed';
    report.fast.logs.stderr = 'Unit verification failed without slot ownership';
    report.summary.status = 'failed';
    report.summary.failedLanes = ['fast'];
    report.logs.stderr = 'Unit verification failed without slot ownership';
    await fs.writeFile(verificationReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

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
    expect(repairPlan.blockers).toEqual([
      expect.objectContaining({
        blockerId: 'repair_blocker_no_slot_tasks',
        boundary: 'slot',
        reason: 'No eligible slot tasks are present in graph.lock.json for the current verification failure'
      })
    ]);
    expect(repairPlan.blockers?.[0]?.failurePoints).toEqual([
      expect.objectContaining({
        lane: 'fast',
        kind: 'unit',
        repairable: true,
        message: 'Unit verification failed without slot ownership'
      })
    ]);

    const writtenRepairPlan = JSON.parse(await fs.readFile(repairPlanPath, 'utf8')) as RepairPlan;
    expect(writtenRepairPlan).toEqual(repairPlan);

    const planText = await runCli(workspaceRoot, ['repair', 'plan']);
    expect(planText.code).toBe(0);
    expect(planText.stderr).toBe('');
    expect(planText.stdout).toContain('Repair blocked (0 tasks, 1 blockers) (dry-run)');
    expect(planText.stdout).toContain('Blocker repair_blocker_no_slot_tasks: slot;');

    const planJson = await runCli(workspaceRoot, ['repair', 'plan', '--json', '--compact']);
    expect(planJson.code).toBe(0);
    expect(planJson.stderr).toBe('');
    expect(planJson.stdout).not.toContain('\n  "status"');
    expect(JSON.parse(planJson.stdout)).toEqual(repairPlan);

    const compactResult = await runCli(workspaceRoot, ['repair', '--dry-run', '--json', '--compact']);
    expect(compactResult.code).toBe(1);
    expect(compactResult.stderr).toContain('REPAIR-BLOCKED-001');
    expect(compactResult.stdout).not.toContain('\n  "status"');
    expect(JSON.parse(compactResult.stdout)).toEqual(repairPlan);
  });
});
