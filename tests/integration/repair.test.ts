import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { LockFile, PlanFile } from '../../src/compiler/contract.ts';
import { lockWorkspace, repairWorkspace } from '../../src/compiler/orchestration/cli.ts';
import { applyRepairPlan } from '../../src/compiler/repair/build-repair-plan.ts';
import { buildTaskEnvelope } from '../../src/compiler/synthesize/build-task-envelope.ts';
import { synthesizeSlotSource } from '../../src/compiler/synthesize/mock-slot-synthesizer.ts';
import type { RepairPlan } from '../../src/semantic/repair/contract/types.ts';
import { countLineDiff } from '../../src/system-architecture/foundation/runtime/diff.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import type { VerificationReport } from '../../src/verification/contract/types.ts';
import { readJson, writeJson } from '../../src/workspace/files.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from '../../src/workspace/paths.ts';
import { writeYaml } from '../../src/workspace/yaml.ts';
import {
  buildCustomerNormalizerLock,
  buildCustomerNormalizerPlan,
  buildRepairPlanArtifact,
  buildRepairTask
} from '../helpers/repair-fixtures.ts';
import { buildPassingReviewReport } from '../helpers/review-fixtures.ts';
import { writeCanonicalVerificationArtifactSetFixture } from '../helpers/verification-fixtures.ts';
import { expectCliText, runCliInProcess as runCli } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function plan(): PlanFile {
  return buildCustomerNormalizerPlan({
    slotDescription: 'Name required; email lowercased; phone digits only; company defaults to Unknown.'
  });
}

function lock(status: LockFile['slotTasks'][number]['status'] = 'failed'): LockFile {
  return buildCustomerNormalizerLock({ slotStatus: status });
}

function failedUnitReport(): VerificationReport {
  return buildPassingReviewReport({
    unit: { status: 'failed', passed: [] },
    fast: {
      status: 'failed',
      unit: { status: 'failed', passed: [] },
      logs: { stdout: '', stderr: 'unit assertion failed' }
    },
    summary: {
      status: 'failed',
      failedLanes: ['fast']
    },
    logs: { stdout: '', stderr: 'unit assertion failed' }
  });
}

function generatedRepairSource(fixturePlan: PlanFile, fixtureLock: LockFile): string {
  const slotTask = fixtureLock.slotTasks[0];
  if (!slotTask) {
    throw new Error('expected repair slot task');
  }
  return synthesizeSlotSource(buildTaskEnvelope(fixturePlan, fixtureLock, slotTask));
}

async function writeRepairFixture(
  workspaceRoot: string,
  fixtureLock: LockFile = lock(),
  source = 'export function normalizeCustomerInput(input: unknown): unknown { return input; }\n'
): Promise<void> {
  const paths = getWorkspacePaths(workspaceRoot);
  const planPath = paths.workspaceConfigPath;
  const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
  const repairPlanPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.repairPlan);
  await fs.mkdir(path.join(workspaceRoot, 'custom'), { recursive: true });
  await writeYaml(planPath, plan());
  await writeJson(lockPath, fixtureLock);
  await writeCanonicalVerificationArtifactSetFixture(workspaceRoot, failedUnitReport());
  await fs.writeFile(path.join(workspaceRoot, 'custom', 'customer_normalizer.ts'), source, 'utf8');
}

test('repair writes only slot-scoped source and requires verification rerun', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeRepairFixture(workspaceRoot);

    const { lock: repairedLock, repairPlan } = await repairWorkspace(workspaceRoot);
    const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
    const repairPlanPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.repairPlan);
    const writtenSource = await fs.readFile(path.join(workspaceRoot, 'custom', 'customer_normalizer.ts'), 'utf8');
    const persistedLock = await readJson<LockFile>(lockPath);
    const persistedRepairPlan = await readJson<RepairPlan>(repairPlanPath);

    expect(repairPlan.status).toBe('applied');
    expect(repairPlan.requiresVerification).toBe(true);
    expect(repairPlan.tasks[0].category).toBe('slot-rewrite');
    expect(repairPlan.tasks[0].allowedPaths).toHaveLength(1);
    expect(repairPlan.tasks[0].allowedPaths).toContain('custom/customer_normalizer.ts');
    expect(writtenSource).toContain('// @generated task:fill_slot_customer_normalizer');
    expect(writtenSource).toContain('export function normalizeCustomerInput');
    expect(repairedLock.passStatus.repair).toBe('succeeded');
    expect(repairedLock.passStatus.verify).toBe('pending');
    expect(persistedLock.passStatus.verify).toBe('pending');
    expect(persistedRepairPlan.status).toBe('applied');
    expect(persistedRepairPlan.requiresVerification).toBe(true);
    expect(persistedRepairPlan.tasks[0].category).toBe('slot-rewrite');
    expect(persistedLock.slotTasks[0].status).toBe('filled');
    expect(persistedLock.generatedPaths).toContain(CI_ARTIFACT_FILES.repairPlan);
    expect(persistedRepairPlan.tasks[0].failurePoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'unit',
          repairable: true
        })
      ])
    );
  });
});

test('repair dry-run returns a pending preview without mutating source, Lock, or control artifacts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeRepairFixture(workspaceRoot);

    const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
    const repairPlanPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.repairPlan);
    const lockBefore = await fs.readFile(lockPath);
    const sourcePath = path.join(workspaceRoot, 'custom', 'customer_normalizer.ts');
    const sourceBefore = await fs.readFile(sourcePath);

    const { lock: plannedLock, repairPlan } = await repairWorkspace(workspaceRoot, { dryRun: true });

    const lockAfter = await fs.readFile(lockPath);
    const sourceAfter = await fs.readFile(sourcePath);
    expect(repairPlan.status).toBe('pending');
    expect(repairPlan.requiresVerification).toBe(false);
    expect(repairPlan.tasks[0].category).toBe('slot-rewrite');
    expect(repairPlan.tasks[0].preview).toMatchObject({
      beforeLines: 1,
      changed: true
    });
    expect(repairPlan.tasks[0].preview?.afterLines).toBeGreaterThan(1);
    expect(repairPlan.tasks[0].preview?.addedLines).toBeGreaterThan(0);
    expect(plannedLock.passStatus.verify).toBe('failed');
    expect(Buffer.from(lockAfter).equals(Buffer.from(lockBefore))).toBe(true);
    expect(Buffer.from(sourceAfter).equals(Buffer.from(sourceBefore))).toBe(true);
    expect(plannedLock.passStatus.repair).toBe('pending');
    expect(plannedLock.slotTasks[0].status).toBe('failed');
    expect(plannedLock.generatedPaths).not.toContain(CI_ARTIFACT_FILES.repairPlan);
    await expect(fs.lstat(repairPlanPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

test('line diff counts appended lines without treating missing EOF newline as a rewrite', () => {
  expect(countLineDiff('const a = 1', 'const a = 1\nconst b = 2')).toEqual({
    added: 1,
    removed: 0
  });
});

test('repair dry-run counts inserted lines without treating the shifted file as rewritten', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const fixturePlan = plan();
    const fixtureLock = lock();
    const generatedSource = generatedRepairSource(fixturePlan, fixtureLock);
    const importLine = "import type { CustomerInput, NormalizedCustomerInput } from '../src/runtime/database.ts';\n";
    expect(generatedSource).toContain(importLine);
    const sourceWithMissingImport = generatedSource.replace(importLine, '');

    await writeRepairFixture(workspaceRoot, fixtureLock, sourceWithMissingImport);

    const { repairPlan } = await repairWorkspace(workspaceRoot, { dryRun: true });

    expect(repairPlan.tasks[0].preview).toMatchObject({
      changed: true,
      addedLines: 1,
      removedLines: 0
    });
  });
});

test('repair writes blocked plans before reporting non-repairable failures', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeRepairFixture(workspaceRoot, {
      ...lock(),
      slotTasks: []
    });

    const result = await runCli(workspaceRoot, ['repair']);
    const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
    const repairPlanPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.repairPlan);
    const persistedLock = await readJson<LockFile>(lockPath);
    const persistedRepairPlan = await readJson<RepairPlan>(repairPlanPath);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('REPAIR-BLOCKED-001');
    expect(result.stderr).toContain('No eligible slot tasks are present in graph.lock.json');
    expect(persistedLock.passStatus.repair).toBe('failed');
    expect(persistedRepairPlan.status).toBe('blocked');
    expect(persistedRepairPlan.blockers).toHaveLength(1);
  });
});

test('repair blocks lock until verification reruns', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeRepairFixture(workspaceRoot);

    await repairWorkspace(workspaceRoot);

    await expect(lockWorkspace(workspaceRoot)).rejects.toMatchObject({
      code: 'PIPELINE-BLOCKED-002',
      details: {
        stageId: 'lock',
        blockers: [{ passId: 'verify', state: 'pending' }]
      }
    });
  });
});

test('repair CLI reports applied plans as verify pending', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeRepairFixture(workspaceRoot);

    await expectCliText(
      workspaceRoot,
      ['repair'],
      [
        'Repair applied (1 tasks, 0 blockers); verify pending',
        'Source verification: failed; requires verification: true',
        'Task repair_slot_customer_normalizer: entity/customer-basic -> custom/customer_normalizer.ts',
        'Failure fast/unit; issue=slot; repairable=true; unit assertion failed'
      ]
    );
  });
});

test('repair CLI reports dry-run plans without applying them', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeRepairFixture(workspaceRoot);

    await expectCliText(
      workspaceRoot,
      ['repair', '--dry-run'],
      [
        'Repair pending (1 tasks, 0 blockers) (dry-run)',
        'Source verification: failed; requires verification: false',
        'Task repair_slot_customer_normalizer: entity/customer-basic -> custom/customer_normalizer.ts',
        'Preview repair_slot_customer_normalizer: changed=true;',
        'Failure fast/unit; issue=slot; repairable=true; unit assertion failed'
      ]
    );
  });
});

test('repair blocks targets that escape the workspace root before writing source', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeRepairFixture(workspaceRoot);
    const fixtureLock = lock();
    const repairPlan = buildRepairPlanArtifact({
      tasks: [
        buildRepairTask({
          targetFile: '../../outside.ts',
          allowedPaths: ['../../outside.ts'],
          failurePoints: [
            {
              lane: 'fast',
              kind: 'unit',
              issueType: 'slot',
              repairable: true,
              artifactPath: 'tests/unit',
              message: 'Unit verification failed'
            }
          ]
        })
      ]
    });

    await expect(applyRepairPlan(workspaceRoot, plan(), fixtureLock, repairPlan)).rejects.toThrow(
      'Repair target "../../outside.ts" escapes workspace root'
    );
    await expect(fs.readFile(path.resolve(workspaceRoot, '..', 'outside.ts'), 'utf8')).rejects.toThrow();
  });
});
