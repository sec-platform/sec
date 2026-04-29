import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildBenchmarkTaskSuiteContract,
  formatBenchmarkTaskSuiteContract
} from '../../platform/shared/benchmark-contract.ts';
import {
  buildCiContract,
  formatCiContract
} from '../../platform/shared/ci-contract.ts';
import {
  buildContractFreezeContract,
  formatContractFreezeContract
} from '../../platform/shared/contract-freeze-contract.ts';
import {
  buildErrorProtocolContract,
  formatErrorProtocolContract
} from '../../platform/shared/error-protocol-contract.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import {
  buildTestBudgetContract,
  formatTestBudgetContract
} from '../../platform/shared/test-budget-contract.ts';
import {
  ACCEPTANCE_USAGE,
  LOCK_USAGE,
  POLICY_USAGE,
  POSTGRES_USAGE,
  REPAIR_USAGE,
  RUNTIME_USAGE,
  USAGE
} from '../../platform/cli/usage.ts';
import {
  assertReferenceCheckClean,
  buildReferenceCheckReport,
  formatReferenceCheck
} from '../../platform/shared/reference-check.ts';
import type {
  ExplainGraph,
  RepairPlan,
  ReviewSummary,
  UpgradeDiagnostics,
  UpgradePlan,
  VerificationReport
} from '../../platform/shared/types.ts';
import { writeJson } from '../../platform/shared/fs.ts';
import { writeYaml } from '../../platform/shared/yaml.ts';
import { withTempWorkspace, runCliInProcess as runCli } from '../helpers/test-utils.ts';

function usageErrorStderr(usage: string): string {
  return [
    `UNEXPECTED ${usage}`,
    JSON.stringify({
      code: 'UNEXPECTED',
      message: usage,
      recoverable: true,
      issueType: 'usage',
      suggestedActions: ['retry-with-supported-arguments'],
      artifactPaths: []
    }),
    ''
  ].join('\n');
}

async function expectRepairUsageError(workspaceRoot: string, args: string[]): Promise<void> {
  await expect(runCli(workspaceRoot, ['repair', ...args])).resolves.toMatchObject({
    code: 1,
    stdout: '',
    stderr: usageErrorStderr(REPAIR_USAGE)
  });
}

async function expectLockUsageError(workspaceRoot: string, args: string[]): Promise<void> {
  await expect(runCli(workspaceRoot, ['lock', ...args])).resolves.toMatchObject({
    code: 1,
    stdout: '',
    stderr: usageErrorStderr(LOCK_USAGE)
  });
}

async function expectPolicyUsageError(workspaceRoot: string, args: string[]): Promise<void> {
  await expect(runCli(workspaceRoot, ['policy', ...args])).resolves.toMatchObject({
    code: 1,
    stdout: '',
    stderr: usageErrorStderr(POLICY_USAGE)
  });
}

async function expectAcceptanceUsageError(workspaceRoot: string, args: string[]): Promise<void> {
  await expect(runCli(workspaceRoot, ['acceptance', ...args])).resolves.toMatchObject({
    code: 1,
    stdout: '',
    stderr: usageErrorStderr(ACCEPTANCE_USAGE)
  });
}

async function expectPostgresUsageError(workspaceRoot: string, args: string[]): Promise<void> {
  await expect(runCli(workspaceRoot, ['postgres', ...args])).resolves.toMatchObject({
    code: 1,
    stdout: '',
    stderr: usageErrorStderr(POSTGRES_USAGE)
  });
}

async function installPrivateBannerBlock(workspaceRoot: string): Promise<void> {
  const { privateRegistryRoot } = getWorkspacePaths(workspaceRoot);
  const blockRoot = path.join(privateRegistryRoot, 'private.banner-basic');

  await fs.mkdir(path.join(blockRoot, 'files', 'src', 'installed', 'private'), { recursive: true });
  await fs.mkdir(path.join(blockRoot, 'files', 'tests', 'unit'), { recursive: true });

  await writeYaml(path.join(blockRoot, 'block.manifest.yaml'), {
    id: 'private/banner-basic',
    version: '0.1.0',
    kind: 'governance',
    stackProfiles: ['nextjs-ts-prisma-sqlite'],
    compatibility: {
      blockApi: '1',
      compilerApi: '1',
      stackProfiles: ['nextjs-ts-prisma-sqlite']
    },
    requires: [],
    provides: ['governance/banner'],
    conflicts: [],
    installs: [
      {
        kind: 'copy',
        from: 'files/src/installed/private/banner.ts',
        to: 'src/installed/private/banner.ts'
      },
      {
        kind: 'copy',
        from: 'files/tests/unit/private-banner.test.ts',
        to: 'tests/unit/private-banner.test.ts'
      }
    ],
    pins: {
      inputs: [],
      outputs: [
        {
          id: 'banner_message',
          type: 'string',
          required: true
        }
      ]
    },
    slots: [],
    acceptance: [],
    routes: []
  });

  await fs.writeFile(
    path.join(blockRoot, 'files', 'src', 'installed', 'private', 'banner.ts'),
    `export function projectBanner(projectName: string): string {\n  return \`private-banner:\${projectName}\`;\n}\n`,
    'utf8'
  );

  await fs.writeFile(
    path.join(blockRoot, 'files', 'tests', 'unit', 'private-banner.test.ts'),
    `import assert from 'node:assert/strict';\nimport { projectBanner } from '../../src/installed/private/banner.ts';\n\nexport async function runSuite() {\n  assert.equal(projectBanner('customer-admin'), 'private-banner:customer-admin');\n}\n`,
    'utf8'
  );
}

test('CLI exposes benchmark task-suite as text and JSON contracts', async () => {
  const contract = buildBenchmarkTaskSuiteContract();
  expect(formatBenchmarkTaskSuiteContract(contract)).toContain(
    'Benchmark suite engineering-compiler-core (active)'
  );
  expect(formatBenchmarkTaskSuiteContract(contract)).toContain(
    'Task add-block: install one capability block into a clean workspace; gate=resolve compose adapt verify lock explain'
  );
  expect(JSON.stringify(contract)).not.toContain('\n');
  expect(contract).toMatchObject({
    formatVersion: '1',
    suiteId: 'engineering-compiler-core',
    status: 'active',
    command: 'npm run platform -- benchmark suite --json',
    runnerCommand: 'npm run test:benchmark-contract',
    taskCount: 5,
    artifactPathCount: 11,
    artifactPaths: [
      'control/evidence/acceptance-coverage.json',
      'control/evidence/policy-report.json',
      'control/evidence/review-summary.json',
      'control/evidence/verification-report.json',
      'control/graph/explain-graph.json',
      'control/provenance/provenance.json',
      'control/state/graph.lock.json',
      'control/workflow/repair-plan.json',
      'control/workflow/upgrade-diagnostics.json',
      'control/workflow/upgrade-plan.json',
      'source/patches/override-manifest.yaml'
    ],
    tasks: expect.arrayContaining([
      expect.objectContaining({
        id: 'add-block',
        gate: 'resolve compose adapt verify lock explain',
        command: 'npm run demo:quickstart',
        artifactPathCount: 4,
        artifactPaths: expect.arrayContaining([
          'control/state/graph.lock.json',
          'control/evidence/verification-report.json',
          'control/graph/explain-graph.json'
        ]),
        scoreFocusCount: 3,
        scoreFocus: ['success-rate', 'files-touched', 'verification-status']
      }),
      expect.objectContaining({
        id: 'repair-slot',
        gate: 'repair verify',
        command: 'npm run platform -- repair --dry-run --json --compact',
        artifactPathCount: 3,
        artifactPaths: expect.arrayContaining([
          'control/workflow/repair-plan.json',
          'control/provenance/provenance.json'
        ]),
        scoreFocusCount: 3,
        scoreFocus: ['repairability', 'attempt-count', 'verification-status']
      }),
      expect.objectContaining({
        id: 'override-conflict',
        gate: 'upgrade --dry-run',
        command: 'npm run platform -- upgrade <block-id> <target-version> --dry-run --json --compact',
        artifactPathCount: 3,
        artifactPaths: expect.arrayContaining([
          'source/patches/override-manifest.yaml',
          'control/workflow/upgrade-diagnostics.json'
        ]),
        scoreFocusCount: 2,
        scoreFocus: ['conflict-detection', 'machine-recoverability']
      })
    ]),
    scoreDimensionCount: 9,
    scoreDimensions: expect.arrayContaining([
      'success-rate',
      'wall-time',
      'verification-status',
      'machine-recoverability'
    ])
  });

  await withTempWorkspace(async (workspaceRoot) => {
    const textResult = await runCli(workspaceRoot, ['benchmark', 'suite']);
    expect(textResult.code).toBe(0);
    expect(textResult.stderr).toBe('');
    expect(textResult.stdout).toContain('Benchmark suite engineering-compiler-core (active)');
    expect(textResult.stdout).toContain('Command: npm run platform -- benchmark suite --json');
    expect(textResult.stdout).toContain('Runner command: npm run test:benchmark-contract');
    expect(textResult.stdout).toContain('Artifact paths: 11');
    expect(textResult.stdout).toContain('Score dimension count: 9');
    expect(textResult.stdout).toContain(
      'Artifact path list: control/evidence/acceptance-coverage.json, control/evidence/policy-report.json, control/evidence/review-summary.json, control/evidence/verification-report.json, control/graph/explain-graph.json, control/provenance/provenance.json, control/state/graph.lock.json, control/workflow/repair-plan.json, control/workflow/upgrade-diagnostics.json, control/workflow/upgrade-plan.json, source/patches/override-manifest.yaml'
    );
    expect(textResult.stdout).toContain('Task override-conflict: surface one override conflict during upgrade planning');
    expect(textResult.stdout).toContain('command=npm run platform -- upgrade <block-id> <target-version> --dry-run --json --compact');
    expect(textResult.stdout).toContain('artifactCount=3; artifacts=source/patches/override-manifest.yaml, control/workflow/upgrade-diagnostics.json, control/evidence/review-summary.json');
    expect(textResult.stdout).toContain('scoreFocusCount=2; score=conflict-detection, machine-recoverability');

    const jsonResult = await runCli(workspaceRoot, ['benchmark', 'suite', '--json']);
    expect(jsonResult.code).toBe(0);
    expect(jsonResult.stderr).toBe('');
    expect(JSON.parse(jsonResult.stdout)).toMatchObject({
      suiteId: 'engineering-compiler-core',
      command: 'npm run platform -- benchmark suite --json',
      runnerCommand: 'npm run test:benchmark-contract',
      taskCount: 5,
      artifactPathCount: 11,
      artifactPaths: expect.arrayContaining([
        'control/evidence/review-summary.json',
        'control/workflow/upgrade-plan.json',
        'control/provenance/provenance.json'
      ]),
      tasks: expect.arrayContaining([
        expect.objectContaining({ id: 'add-block', artifactPathCount: 4, scoreFocusCount: 3 }),
        expect.objectContaining({ id: 'override-conflict', artifactPathCount: 3, scoreFocusCount: 2 })
      ]),
      scoreDimensionCount: 9
    });

    const compactResult = await runCli(workspaceRoot, ['benchmark', 'suite', '--json', '--compact']);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(compactResult.stdout)).toMatchObject({
      suiteId: 'engineering-compiler-core',
      runnerCommand: 'npm run test:benchmark-contract',
      taskCount: 5,
      artifactPathCount: 11,
      tasks: expect.arrayContaining([
        expect.objectContaining({ id: 'add-block', artifactPathCount: 4, scoreFocusCount: 3 }),
        expect.objectContaining({ id: 'override-conflict', artifactPathCount: 3, scoreFocusCount: 2 })
      ]),
      scoreDimensionCount: 9
    });
  });
});

test('CLI exposes test budget as text and JSON contracts', async () => {
  const contract = buildTestBudgetContract();
  expect(formatTestBudgetContract(contract)).toContain('Test budget default lane: fast');
  expect(formatTestBudgetContract(contract)).toContain(
    'Lane all; nextBuild=true; playwright=true; command=npm run platform -- verify --lane all'
  );
  expect(JSON.stringify(contract)).not.toContain('\n');
  expect(contract).toMatchObject({
    formatVersion: '1',
    command: 'npm run platform -- test budget --json',
    runnerCommand: 'npm run test:budget',
    defaultLane: 'fast',
    laneCount: 3,
    slowLaneCount: 1,
    slowLaneIds: ['all'],
    lanes: [
      {
        id: 'fast',
        nextBuild: false,
        playwright: false,
        command: 'npm run platform -- verify'
      },
      {
        id: 'runtime',
        nextBuild: false,
        playwright: false,
        command: 'npm run platform -- verify --lane runtime'
      },
      {
        id: 'all',
        nextBuild: true,
        playwright: true,
        command: 'npm run platform -- verify --lane all'
      }
    ],
    localDefault: 'fast lane plus targeted named tests',
    fullRuntimeGate: 'scheduled CI or explicit release/demo verification'
  });

  await withTempWorkspace(async (workspaceRoot) => {
    const textResult = await runCli(workspaceRoot, ['test', 'budget']);
    expect(textResult.code).toBe(0);
    expect(textResult.stderr).toBe('');
    expect(textResult.stdout).toContain('Test budget default lane: fast');
    expect(textResult.stdout).toContain('Command: npm run platform -- test budget --json');
    expect(textResult.stdout).toContain('Runner command: npm run test:budget');
    expect(textResult.stdout).toContain('Lanes: 3');
    expect(textResult.stdout).toContain('Slow lane count: 1');
    expect(textResult.stdout).toContain('Slow lanes: all');
    expect(textResult.stdout).toContain('Lane fast; nextBuild=false; playwright=false');

    const jsonResult = await runCli(workspaceRoot, ['test', 'budget', '--json']);
    expect(jsonResult.code).toBe(0);
    expect(jsonResult.stderr).toBe('');
    expect(JSON.parse(jsonResult.stdout)).toMatchObject({
      command: 'npm run platform -- test budget --json',
      runnerCommand: 'npm run test:budget',
      defaultLane: 'fast',
      laneCount: 3,
      slowLaneCount: 1,
      slowLaneIds: ['all'],
      lanes: expect.arrayContaining([
        expect.objectContaining({ id: 'all', nextBuild: true, playwright: true })
      ])
    });

    const compactResult = await runCli(workspaceRoot, ['test', 'budget', '--json', '--compact']);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(compactResult.stdout)).toMatchObject({
      runnerCommand: 'npm run test:budget',
      defaultLane: 'fast',
      laneCount: 3,
      slowLaneCount: 1,
      slowLaneIds: ['all']
    });
  });
});
