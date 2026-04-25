import { expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { applyRepairPlan } from '../platform/compiler/repair/build-repair-plan.ts';
import { lockWorkspace, repairWorkspace } from '../platform/orchestrator.ts';
import { writeJson } from '../platform/shared/fs.ts';
import { compilerRoot, getWorkspacePaths } from '../platform/shared/paths.ts';
import { writeYaml } from '../platform/shared/yaml.ts';
import type { LockFile, PlanFile, RepairPlan, VerificationReport } from '../platform/shared/types.ts';

function plan(): PlanFile {
  return {
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
        description: 'Name required; email lowercased; phone digits only; company defaults to Unknown.'
      }
    ],
    acceptance: [{ id: 'user_can_create_customer' }]
  };
}

function lock(status: LockFile['slotTasks'][number]['status'] = 'failed'): LockFile {
  return {
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
        status,
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
}

function failedUnitReport(): VerificationReport {
  return {
    build: { status: 'passed' },
    unit: { status: 'failed', passed: [] },
    acceptance: { status: 'passed', passed: [], failed: [] },
    policy: { status: 'passed', violations: [] },
    fast: {
      status: 'failed',
      build: { status: 'passed' },
      unit: { status: 'failed', passed: [] },
      acceptance: { status: 'passed', passed: [], failed: [] },
      policy: { status: 'passed', violations: [] },
      logs: { stdout: '', stderr: 'unit assertion failed' }
    },
    runtime: {
      status: 'skipped',
      build: { status: 'skipped', passed: [], failed: [], command: 'npm run build' },
      unit: { status: 'skipped', passed: [], failed: [], command: 'npm run test:unit' },
      acceptance: { status: 'skipped', passed: [], failed: [], command: 'npm run test:acceptance' },
      logs: { stdout: '', stderr: '' }
    },
    summary: {
      status: 'failed',
      requestedLane: 'fast',
      failedLanes: ['fast']
    },
    logs: { stdout: '', stderr: 'unit assertion failed' }
  };
}

function runCli(workspaceRoot: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(compilerRoot, 'platform', 'cli', 'index.ts'), ...args], {
      cwd: workspaceRoot,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      });
    });
  });
}

async function writeRepairFixture(workspaceRoot: string, fixtureLock: LockFile = lock()): Promise<void> {
  const { planPath, lockPath, verificationReportPath, projectRoot } = getWorkspacePaths(workspaceRoot);
  await fs.mkdir(path.join(projectRoot, 'custom'), { recursive: true });
  await fs.mkdir(path.dirname(verificationReportPath), { recursive: true });
  await writeYaml(planPath, plan());
  await writeJson(lockPath, fixtureLock);
  await writeJson(verificationReportPath, failedUnitReport());
  await fs.writeFile(
    path.join(projectRoot, 'custom', 'customer_normalizer.ts'),
    'export function normalizeCustomerInput(input: unknown): unknown { return input; }\n',
    'utf8'
  );
}

test('repair writes only slot-scoped source and requires verification rerun', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-repair-'));
  try {
    await writeRepairFixture(workspaceRoot);

    const { lock: repairedLock, repairPlan } = await repairWorkspace(workspaceRoot);
    const { lockPath, repairPlanPath, projectRoot } = getWorkspacePaths(workspaceRoot);
    const writtenSource = await fs.readFile(path.join(projectRoot, 'custom', 'customer_normalizer.ts'), 'utf8');
    const persistedLock = JSON.parse(await fs.readFile(lockPath, 'utf8')) as LockFile;
    const persistedRepairPlan = JSON.parse(await fs.readFile(repairPlanPath, 'utf8'));

    expect(repairPlan.status).toBe('applied');
    expect(repairPlan.tasks[0].allowedPaths).toEqual(['custom/customer_normalizer.ts']);
    expect(writtenSource).toContain('// @generated task:fill_slot_customer_normalizer');
    expect(writtenSource).toContain('export function normalizeCustomerInput');
    expect(repairedLock.passStatus.repair).toBe('succeeded');
    expect(repairedLock.passStatus.verify).toBe('pending');
    expect(persistedLock.passStatus.verify).toBe('pending');
    expect(persistedRepairPlan.status).toBe('applied');
    expect(persistedLock.slotTasks[0].status).toBe('filled');
    expect(persistedLock.generatedPaths).toContain('generated/repair-plan.json');
    expect(persistedRepairPlan.tasks[0].failurePoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'unit',
          repairable: true
        })
      ])
    );
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('repair blocks lock until verification reruns', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-repair-lock-'));
  try {
    await writeRepairFixture(workspaceRoot);

    await repairWorkspace(workspaceRoot);

    await expect(lockWorkspace(workspaceRoot)).rejects.toMatchObject({ code: 'LOCK-BLOCKED-001' });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('repair CLI reports applied plans as verify pending', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-repair-cli-'));
  try {
    await writeRepairFixture(workspaceRoot);

    const result = await runCli(workspaceRoot, ['repair']);

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('Repair applied (1 tasks); verify pending');
    expect(result.stderr).toBe('');
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('repair blocks targets that escape the project root before writing source', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-repair-scope-'));
  try {
    await writeRepairFixture(workspaceRoot);
    const fixtureLock = lock();
    const repairPlan: RepairPlan = {
      formatVersion: '1',
      status: 'pending',
      sourceVerificationStatus: 'failed',
      tasks: [
        {
          taskId: 'repair_slot_customer_normalizer',
          taskKind: 'repair-slot',
          phase: 'repair',
          sourceSlotId: 'customer_normalizer',
          targetBlock: 'entity/customer-basic',
          targetFile: '../outside.ts',
          allowedPaths: ['../outside.ts'],
          requiredSymbols: ['normalizeCustomerInput'],
          forbiddenOperations: [],
          testsToPass: [],
          failureSummary: 'build=passed; unit=failed; acceptance=passed; policy=passed; runtime=skipped',
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
        }
      ]
    };

    await expect(applyRepairPlan(workspaceRoot, plan(), fixtureLock, repairPlan)).rejects.toThrow(
      'Repair target "../outside.ts" escapes project root'
    );
    await expect(fs.readFile(path.join(workspaceRoot, 'outside.ts'), 'utf8')).rejects.toThrow();
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
