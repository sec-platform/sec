import { expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildBenchmarkTaskSuiteContract,
  formatBenchmarkTaskSuiteContract
} from '../platform/shared/benchmark-contract.ts';
import {
  buildContractFreezeContract,
  formatContractFreezeContract
} from '../platform/shared/contract-freeze-contract.ts';
import {
  buildErrorProtocolContract,
  formatErrorProtocolContract
} from '../platform/shared/error-protocol-contract.ts';
import { compilerRoot, getWorkspacePaths } from '../platform/shared/paths.ts';
import {
  buildTestBudgetContract,
  formatTestBudgetContract
} from '../platform/shared/test-budget-contract.ts';
import {
  assertReferenceCheckClean,
  buildReferenceCheckReport,
  formatReferenceCheck
} from '../platform/shared/reference-check.ts';
import type { RepairPlan, UpgradePlan, VerificationReport } from '../platform/shared/types.ts';
import { writeYaml } from '../platform/shared/yaml.ts';

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

async function withTempWorkspace<T>(callback: (workspaceRoot: string) => Promise<T>): Promise<T> {
  const workspaceParent = path.join(process.cwd(), '.tmp', 'test-workspaces');
  await fs.mkdir(workspaceParent, { recursive: true });
  const workspaceRoot = await fs.mkdtemp(path.join(workspaceParent, 'engineering-compiler-cli-'));
  try {
    return await callback(workspaceRoot);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

function usageErrorStderr(usage: string): string {
  return [
    `UNEXPECTED ${usage}`,
    '{"recoverable":true,"issueType":"usage","suggestedActions":["retry-with-supported-arguments"]}',
    ''
  ].join('\n');
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

test('CLI prints usage for missing or unknown commands', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    for (const args of [[], ['unknown'], ['unknown', '--flag']]) {
      const result = await runCli(workspaceRoot, args);
      expect(result).toMatchObject({
        code: 0,
        stderr: ''
      });
      expect(result.stdout).toContain(
        'Usage: node platform/cli/index.ts <init|add|resolve|compose|adapt|verify|repair|upgrade|lock|explain|artifacts|doctor|deps|reference|benchmark|test|policy|acceptance|runtime|verification|provenance|contract>'
      );
      expect(result.stdout).toContain('Closed loop: npm run demo:closed-loop');
      expect(result.stdout).toContain('Readiness: platform doctor');
      expect(result.stdout).toContain('Governance paths: platform artifacts --paths --kind governance');
    }
  });
});

test('CLI accepts init commands', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
  });
});

test('CLI defaults verification to the fast lane', { timeout: 20000 }, async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['resolve'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Resolved 3 blocks\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['compose'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Composed project\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['adapt'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Adapted slots\n',
      stderr: ''
    });

    const result = await runCli(workspaceRoot, ['verify']);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Verification passed (fast)\n');
  });
});

test('CLI exposes doctor as text and JSON readiness contracts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const doctor = await runCli(workspaceRoot, ['doctor']);
    expect(doctor.code).toBe(0);
    expect(doctor.stderr).toBe('');
    expect(doctor.stdout).toContain('Developer environment doctor');
    expect(doctor.stdout).toContain('node-version');
    expect(doctor.stdout).toContain('runtime-dependencies');

    const doctorJson = await runCli(workspaceRoot, ['doctor', '--json']);
    expect(doctorJson.code).toBe(0);
    expect(doctorJson.stderr).toBe('');
    expect(JSON.parse(doctorJson.stdout)).toMatchObject({
      status: expect.any(String),
      checks: expect.arrayContaining([
        expect.objectContaining({ id: 'node-version' }),
        expect.objectContaining({ id: 'bun' }),
        expect.objectContaining({ id: 'runtime-dependencies' })
      ]),
      dependencies: expect.objectContaining({
        mode: expect.any(String),
        recommendedAction: expect.any(String)
      })
    });

    const doctorCompact = await runCli(workspaceRoot, ['doctor', '--json', '--compact']);
    expect(doctorCompact.code).toBe(0);
    expect(doctorCompact.stderr).toBe('');
    expect(doctorCompact.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(doctorCompact.stdout)).toMatchObject({
      status: expect.any(String),
      dependencies: expect.objectContaining({ mode: expect.any(String) })
    });
  });
});

test('CLI exposes dependency environment maintenance entrypoints', { timeout: 20000 }, async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const depsStatus = await runCli(workspaceRoot, ['deps', 'status']);
    expect(depsStatus.code).toBe(0);
    expect(depsStatus.stderr).toBe('');
    expect(depsStatus.stdout).toContain('Runtime dependency status');
    expect(depsStatus.stdout).toContain('top-level entries');
    expect(depsStatus.stdout).toContain('Recommended action:');

    const depsStatusJson = await runCli(workspaceRoot, ['deps', 'status', '--json']);
    expect(depsStatusJson.code).toBe(0);
    expect(depsStatusJson.stderr).toBe('');
    expect(JSON.parse(depsStatusJson.stdout)).toMatchObject({
      mode: expect.any(String),
      manifestHash: expect.any(String),
      recommendedAction: expect.any(String),
      sharedNodeModules: expect.objectContaining({ kind: expect.any(String) })
    });

    const depsStatusCompact = await runCli(workspaceRoot, ['deps', 'status', '--json', '--compact']);
    expect(depsStatusCompact.code).toBe(0);
    expect(depsStatusCompact.stderr).toBe('');
    expect(depsStatusCompact.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(depsStatusCompact.stdout)).toMatchObject({
      mode: expect.any(String),
      recommendedAction: expect.any(String)
    });

    const depsWarmupJson = await runCli(workspaceRoot, ['deps', 'warmup', '--json']);
    expect(depsWarmupJson.code).toBe(0);
    expect(depsWarmupJson.stderr).toBe('');
    expect(JSON.parse(depsWarmupJson.stdout)).toMatchObject({
      mode: expect.any(String),
      sharedNodeModules: expect.objectContaining({ exists: true }),
      recommendedAction: expect.any(String)
    });

    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });

    const depsRelinkJson = await runCli(workspaceRoot, ['deps', 'relink', 'project', '--json']);
    expect(depsRelinkJson.code).toBe(0);
    expect(depsRelinkJson.stderr).toBe('');
    expect(JSON.parse(depsRelinkJson.stdout)).toMatchObject({
      mode: expect.any(String),
      projectNodeModules: expect.objectContaining({ kind: expect.any(String) }),
      recommendedAction: expect.any(String)
    });

    const cleanProject = await runCli(workspaceRoot, ['deps', 'clean', '--project']);
    expect(cleanProject.code).toBe(0);
    expect(cleanProject.stderr).toBe('');
    expect(cleanProject.stdout).toBe('Cleaned 2 dependency paths\n');

    const invalidRelink = await runCli(workspaceRoot, ['deps', 'relink']);
    expect(invalidRelink.code).toBe(1);
    expect(invalidRelink.stderr).toContain('platform deps relink project');

    const invalidDepsStatusJson = await runCli(workspaceRoot, ['deps', 'status', '--compact']);
    expect(invalidDepsStatusJson.code).toBe(1);
    expect(invalidDepsStatusJson.stderr).toContain('platform deps status [--json [--compact]]');

    const invalidRelinkJson = await runCli(workspaceRoot, ['deps', 'relink', 'project', '--compact']);
    expect(invalidRelinkJson.code).toBe(1);
    expect(invalidRelinkJson.stderr).toContain('platform deps relink project [--json [--compact]]');

    const invalidCleanAll = await runCli(workspaceRoot, ['deps', 'clean', '--all']);
    expect(invalidCleanAll.code).toBe(1);
    expect(invalidCleanAll.stderr).toContain('platform deps clean --all --force');

    const invalidForce = await runCli(workspaceRoot, ['deps', 'clean', '--force']);
    expect(invalidForce.code).toBe(1);
    expect(invalidForce.stderr).toContain('platform deps clean --all --force');
  });
});

test('CLI exposes reference drift check as text and JSON contracts', async () => {
  const report = await buildReferenceCheckReport({
    root: compilerRoot,
    commandRunner: async (command, args) => {
      if (command === 'git') {
        expect(args).toEqual(['diff', '--name-only', '--exit-code', '--', 'project']);
        return { code: 1, stdout: 'project/app.plan.yaml\nproject/generated/review-summary.json\n', stderr: '' };
      }

      expect(args.slice(-2)).toEqual(['run', 'reference:refresh']);
      return { code: 0, stdout: '', stderr: '' };
    }
  });

  expect(formatReferenceCheck(report)).toContain('Reference workspace drifted');
  expect(formatReferenceCheck(report)).toContain(
    'Changed paths: project/app.plan.yaml, project/generated/review-summary.json'
  );
  expect(JSON.stringify(report)).not.toContain('\n');
  expect(report).toMatchObject({
    formatVersion: '1',
    status: 'drifted',
    root: compilerRoot,
    refreshCommand: 'npm run reference:refresh',
    refreshExitCode: 0,
    diffCommand: 'git diff --name-only --exit-code -- project',
    diffExitCode: 1,
    changedPathCount: 2,
    changedPaths: ['project/app.plan.yaml', 'project/generated/review-summary.json'],
    recommendedAction: 'inspect-project-drift-and-refresh-reference'
  });
  expect(() => assertReferenceCheckClean(report)).toThrow('reference workspace drift detected');

  const refreshFailedReport = await buildReferenceCheckReport({
    root: compilerRoot,
    commandRunner: async () => ({ code: 2, stdout: '', stderr: 'refresh failed' })
  });
  expect(refreshFailedReport).toMatchObject({
    status: 'refresh-failed',
    refreshExitCode: 2,
    diffExitCode: -1,
    changedPathCount: 0,
    recommendedAction: 'fix-reference-refresh-before-reference-check'
  });
  expect(() => assertReferenceCheckClean(refreshFailedReport)).toThrow('reference refresh failed');

  const diffFailedReport = await buildReferenceCheckReport({
    root: compilerRoot,
    commandRunner: async (command) =>
      command === 'git'
        ? { code: 128, stdout: '', stderr: 'diff failed' }
        : { code: 0, stdout: '', stderr: '' }
  });
  expect(diffFailedReport).toMatchObject({
    status: 'diff-failed',
    refreshExitCode: 0,
    diffExitCode: 128,
    changedPathCount: 0,
    recommendedAction: 'inspect-git-diff-command'
  });
  expect(() => assertReferenceCheckClean(diffFailedReport)).toThrow('reference diff command failed');
});

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
    taskCount: 5,
    tasks: expect.arrayContaining([
      expect.objectContaining({
        id: 'add-block',
        gate: 'resolve compose adapt verify lock explain',
        scoreFocus: ['success-rate', 'files-touched', 'verification-status']
      }),
      expect.objectContaining({
        id: 'repair-slot',
        gate: 'repair verify',
        scoreFocus: ['repairability', 'attempt-count', 'verification-status']
      }),
      expect.objectContaining({
        id: 'override-conflict',
        gate: 'upgrade --dry-run',
        scoreFocus: ['conflict-detection', 'machine-recoverability']
      })
    ]),
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
    expect(textResult.stdout).toContain('Task override-conflict: surface one override conflict during upgrade planning');

    const jsonResult = await runCli(workspaceRoot, ['benchmark', 'suite', '--json']);
    expect(jsonResult.code).toBe(0);
    expect(jsonResult.stderr).toBe('');
    expect(JSON.parse(jsonResult.stdout)).toMatchObject({
      suiteId: 'engineering-compiler-core',
      taskCount: 5
    });

    const compactResult = await runCli(workspaceRoot, ['benchmark', 'suite', '--json', '--compact']);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(compactResult.stdout)).toMatchObject({
      suiteId: 'engineering-compiler-core',
      taskCount: 5
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
    defaultLane: 'fast',
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
    expect(textResult.stdout).toContain('Lane fast; nextBuild=false; playwright=false');

    const jsonResult = await runCli(workspaceRoot, ['test', 'budget', '--json']);
    expect(jsonResult.code).toBe(0);
    expect(jsonResult.stderr).toBe('');
    expect(JSON.parse(jsonResult.stdout)).toMatchObject({
      defaultLane: 'fast',
      lanes: expect.arrayContaining([
        expect.objectContaining({ id: 'all', nextBuild: true, playwright: true })
      ])
    });

    const compactResult = await runCli(workspaceRoot, ['test', 'budget', '--json', '--compact']);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(compactResult.stdout)).toMatchObject({
      defaultLane: 'fast'
    });
  });
});

test('CLI exposes contract freeze target list as text and JSON contracts', async () => {
  const contract = buildContractFreezeContract();
  expect(formatContractFreezeContract(contract)).toContain('Contract freeze active');
  expect(formatContractFreezeContract(contract)).toContain('Target tests/cli.test.ts; pattern=');
  expect(JSON.stringify(contract)).not.toContain('\n');
  expect(contract).toMatchObject({
    formatVersion: '1',
    status: 'active',
    command: 'npm run test:contract-freeze',
    targetCount: 3,
    targets: expect.arrayContaining([
      expect.objectContaining({
        file: 'tests/cli.test.ts',
        testNamePattern: expect.stringContaining('CLI exposes contract freeze target list as text and JSON contracts')
      }),
      expect.objectContaining({
        file: 'tests/project-runtime.test.ts',
        testNamePattern: expect.stringContaining('test budget and benchmark contracts document slow lanes')
      }),
      expect.objectContaining({
        file: 'tests/pipeline.test.ts',
        testNamePattern: 'v0.1 pipeline runs end to end in a temporary workspace'
      })
    ])
  });

  await withTempWorkspace(async (workspaceRoot) => {
    const textResult = await runCli(workspaceRoot, ['contract', 'freeze']);
    expect(textResult.code).toBe(0);
    expect(textResult.stderr).toBe('');
    expect(textResult.stdout).toContain('Contract freeze active');
    expect(textResult.stdout).toContain('Target tests/pipeline.test.ts; pattern=v0.1 pipeline runs end to end');

    const jsonResult = await runCli(workspaceRoot, ['contract', 'freeze', '--json']);
    expect(jsonResult.code).toBe(0);
    expect(jsonResult.stderr).toBe('');
    expect(JSON.parse(jsonResult.stdout)).toMatchObject({
      status: 'active',
      targetCount: 3
    });

    const compactResult = await runCli(workspaceRoot, ['contract', 'freeze', '--json', '--compact']);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(compactResult.stdout)).toMatchObject({
      status: 'active',
      targetCount: 3
    });
  });
});

test('CLI exposes error protocol as text and JSON contracts', async () => {
  const contract = buildErrorProtocolContract();
  expect(formatErrorProtocolContract(contract)).toContain('Error protocol active');
  expect(formatErrorProtocolContract(contract)).toContain('Example upgrade-error; code=UPGRADE-CONFLICT-001');
  expect(JSON.stringify(contract)).not.toContain('\n');
  expect(contract).toMatchObject({
    formatVersion: '1',
    status: 'active',
    command: 'npm run platform -- contract errors --json',
    exampleCount: 6,
    issueTypes: ['composition', 'kernel', 'slot', 'spec', 'usage'],
    examples: expect.arrayContaining([
      expect.objectContaining({
        id: 'usage-error',
        output: expect.objectContaining({
          recoverable: true,
          issueType: 'usage',
          suggestedActions: ['retry-with-supported-arguments']
        })
      }),
      expect.objectContaining({
        id: 'verify-error',
        output: expect.objectContaining({
          recoverable: false,
          issueType: 'spec',
          suggestedActions: ['inspect-verification-report', 'run-platform-explain']
        })
      }),
      expect.objectContaining({
        id: 'upgrade-error',
        output: expect.objectContaining({
          recoverable: true,
          issueType: 'composition',
          suggestedActions: ['run-platform-upgrade-dry-run', 'inspect-upgrade-diagnostics']
        })
      })
    ])
  });

  await withTempWorkspace(async (workspaceRoot) => {
    const textResult = await runCli(workspaceRoot, ['contract', 'errors']);
    expect(textResult.code).toBe(0);
    expect(textResult.stderr).toBe('');
    expect(textResult.stdout).toContain('Error protocol active');
    expect(textResult.stdout).toContain('Example repair-error; code=REPAIR-BLOCKED-001');

    const jsonResult = await runCli(workspaceRoot, ['contract', 'errors', '--json']);
    expect(jsonResult.code).toBe(0);
    expect(jsonResult.stderr).toBe('');
    expect(JSON.parse(jsonResult.stdout)).toMatchObject({
      status: 'active',
      exampleCount: 6,
      suggestedActionCount: 9
    });

    const compactResult = await runCli(workspaceRoot, ['contract', 'errors', '--json', '--compact']);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(compactResult.stdout)).toMatchObject({
      status: 'active',
      exampleCount: 6
    });
  });
});

test('CLI adds private registry blocks and preserves registry metadata on resolve', { timeout: 20000 }, async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    await installPrivateBannerBlock(workspaceRoot);

    await expect(runCli(workspaceRoot, ['add', 'private/banner-basic'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Added block private/banner-basic@0.1.0 from private (private)\n',
      stderr: ''
    });
    await expect(fs.readFile(path.join(workspaceRoot, 'project', 'app.plan.yaml'), 'utf8')).resolves.toContain('private/banner-basic');

    await expect(runCli(workspaceRoot, ['resolve'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Resolved 4 blocks\n',
      stderr: ''
    });
    const lock = JSON.parse(await fs.readFile(path.join(workspaceRoot, 'project', 'graph.lock.json'), 'utf8')) as {
      resolvedBlocks: Array<{ id: string; registrySourceId: string; registryKind: string; registryLocation: string }>;
    };
    expect(lock.resolvedBlocks.find((block) => block.id === 'private/banner-basic')).toMatchObject({
      registrySourceId: 'private',
      registryKind: 'private',
      registryLocation: 'workspace'
    });
  });
});

test('CLI exposes policy report as text and JSON contracts', { timeout: 120000 }, async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['resolve'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Resolved 3 blocks\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['compose'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Composed project\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['adapt'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Adapted slots\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane', 'fast'])).resolves.toMatchObject({
      code: 0,
      stderr: ''
    });

    const textResult = await runCli(workspaceRoot, ['policy', 'report']);
    expect(textResult.code).toBe(0);
    expect(textResult.stderr).toBe('');
    expect(textResult.stdout).toContain('Policy report passed; official=1; project=0; merged=1; violations=0');
    expect(textResult.stdout).toContain('Policy tenant-scope-required; scope=official; source=platform/policies/official/policy.spec.yaml; targets=src/installed/entity/customer-service.ts');

    const jsonResult = await runCli(workspaceRoot, ['policy', 'report', '--json']);
    expect(jsonResult.code).toBe(0);
    expect(jsonResult.stderr).toBe('');
    const policyReport = JSON.parse(jsonResult.stdout) as {
      status: string;
      merged: { policies: Array<{ id: string; targets: string[] }> };
      violations: unknown[];
    };
    expect(policyReport).toMatchObject({
      status: 'passed',
      violations: []
    });
    expect(policyReport.merged.policies).toEqual([
      expect.objectContaining({
        id: 'tenant-scope-required',
        targets: ['src/installed/entity/customer-service.ts']
      })
    ]);

    const compactResult = await runCli(workspaceRoot, ['policy', 'report', '--json', '--compact']);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(compactResult.stdout)).toMatchObject({
      status: 'passed'
    });
  });
});

test('CLI exposes acceptance coverage as text and JSON contracts', { timeout: 120000 }, async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['resolve'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Resolved 3 blocks\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['compose'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Composed project\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['adapt'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Adapted slots\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane', 'fast'])).resolves.toMatchObject({
      code: 0,
      stderr: ''
    });

    const textResult = await runCli(workspaceRoot, ['acceptance', 'coverage']);
    expect(textResult.code).toBe(0);
    expect(textResult.stderr).toBe('');
    expect(textResult.stdout).toContain('Acceptance coverage passed; acceptancePassed=');
    expect(textResult.stdout).toContain('blocks=0/3; slots=0/1; uncoveredBlocks=3; uncoveredSlots=1');
    expect(textResult.stdout).toContain('Uncovered blocks: auth/basic-session, tenant/basic-workspace, entity/customer-basic');
    expect(textResult.stdout).toContain('Block entity/customer-basic; declared=3; coveredBy=none; uncovered=true');
    expect(textResult.stdout).toContain('Slot customer_normalizer; declared=2; coveredBy=none; uncovered=true');

    const jsonResult = await runCli(workspaceRoot, ['acceptance', 'coverage', '--json']);
    expect(jsonResult.code).toBe(0);
    expect(jsonResult.stderr).toBe('');
    const coverageReport = JSON.parse(jsonResult.stdout) as {
      status: string;
      blocks: Array<{ id: string; coveredBy: string[]; uncovered: boolean }>;
      slots: Array<{ id: string; coveredBy: string[]; uncovered: boolean }>;
      uncoveredBlocks: string[];
      uncoveredSlots: string[];
    };
    expect(coverageReport).toMatchObject({
      status: 'passed',
      uncoveredBlocks: ['auth/basic-session', 'tenant/basic-workspace', 'entity/customer-basic'],
      uncoveredSlots: ['customer_normalizer']
    });
    expect(coverageReport.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'entity/customer-basic',
          uncovered: true
        })
      ])
    );
    expect(coverageReport.slots).toEqual([
      expect.objectContaining({
        id: 'customer_normalizer',
        uncovered: true
      })
    ]);

    const compactResult = await runCli(workspaceRoot, ['acceptance', 'coverage', '--json', '--compact']);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(compactResult.stdout)).toMatchObject({
      status: 'passed',
      uncoveredBlocks: ['auth/basic-session', 'tenant/basic-workspace', 'entity/customer-basic'],
      uncoveredSlots: ['customer_normalizer']
    });
  });
});

test('CLI exposes runtime report as text and JSON contracts', { timeout: 120000 }, async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['resolve'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Resolved 3 blocks\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['compose'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Composed project\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['adapt'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Adapted slots\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane', 'fast'])).resolves.toMatchObject({
      code: 0,
      stderr: ''
    });

    const textResult = await runCli(workspaceRoot, ['runtime', 'report']);
    expect(textResult.code).toBe(0);
    expect(textResult.stderr).toBe('');
    expect(textResult.stdout).toContain('Runtime report passed');
    expect(textResult.stdout).toContain('Build: skipped; passed=0; failed=0; command=npm run build');
    expect(textResult.stdout).toContain('Unit: passed; passed=');
    expect(textResult.stdout).toContain('failed=0; command=npm run test:unit');
    expect(textResult.stdout).toContain('Acceptance: skipped; passed=0; failed=0; command=npm run test:acceptance');

    const jsonResult = await runCli(workspaceRoot, ['runtime', 'report', '--json']);
    expect(jsonResult.code).toBe(0);
    expect(jsonResult.stderr).toBe('');
    const runtimeReport = JSON.parse(jsonResult.stdout) as {
      status: string;
      build: { status: string };
      unit: { status: string; failed: string[] };
      acceptance: { status: string };
    };
    expect(runtimeReport).toMatchObject({
      status: 'passed',
      build: { status: 'skipped' },
      unit: { status: 'passed', failed: [] },
      acceptance: { status: 'skipped' }
    });

    const compactResult = await runCli(workspaceRoot, ['runtime', 'report', '--json', '--compact']);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(compactResult.stdout)).toMatchObject({
      status: 'passed',
      build: { status: 'skipped' },
      acceptance: { status: 'skipped' }
    });
  });
});

test('CLI exposes verification report as text and JSON contracts', { timeout: 120000 }, async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['resolve'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Resolved 3 blocks\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['compose'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Composed project\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['adapt'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Adapted slots\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane', 'fast'])).resolves.toMatchObject({
      code: 0,
      stderr: ''
    });

    const textResult = await runCli(workspaceRoot, ['verification', 'report']);
    expect(textResult.code).toBe(0);
    expect(textResult.stderr).toBe('');
    expect(textResult.stdout).toContain('Verification report passed; requestedLane=fast; failedLanes=none');
    expect(textResult.stdout).toContain('Fast: passed; build=passed; unit=passed; acceptance=passed; policy=passed');
    expect(textResult.stdout).toContain('Runtime: passed; build=skipped; unit=passed; acceptance=skipped');

    const jsonResult = await runCli(workspaceRoot, ['verification', 'report', '--json']);
    expect(jsonResult.code).toBe(0);
    expect(jsonResult.stderr).toBe('');
    const verificationReport = JSON.parse(jsonResult.stdout) as {
      summary: { status: string; requestedLane: string; failedLanes: string[] };
      fast: { status: string; policy: { status: string } };
      runtime: { status: string; acceptance: { status: string } };
    };
    expect(verificationReport).toMatchObject({
      summary: {
        status: 'passed',
        requestedLane: 'fast',
        failedLanes: []
      },
      fast: { status: 'passed', policy: { status: 'passed' } },
      runtime: { status: 'passed', acceptance: { status: 'skipped' } }
    });

    const compactResult = await runCli(workspaceRoot, ['verification', 'report', '--json', '--compact']);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(compactResult.stdout)).toMatchObject({
      summary: {
        status: 'passed',
        requestedLane: 'fast'
      }
    });
  });
});

test('CLI exposes provenance registry as text and JSON contracts', { timeout: 120000 }, async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['resolve'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Resolved 3 blocks\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['compose'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Composed project\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['adapt'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Adapted slots\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane', 'all'])).resolves.toMatchObject({
      code: 0,
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['lock'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Locked project\n',
      stderr: ''
    });

    const textResult = await runCli(workspaceRoot, ['provenance', 'registry']);
    expect(textResult.code).toBe(0);
    expect(textResult.stderr).toBe('');
    expect(textResult.stdout).toContain('Provenance registry; artifacts=');
    expect(textResult.stdout).toContain('Origins: block=');
    expect(textResult.stdout).toContain('slot=');
    expect(textResult.stdout).toContain('Registry sources: official=');
    expect(textResult.stdout).toContain('origin=slot:');

    const jsonResult = await runCli(workspaceRoot, ['provenance', 'registry', '--json']);
    expect(jsonResult.code).toBe(0);
    expect(jsonResult.stderr).toBe('');
    const provenance = JSON.parse(jsonResult.stdout) as {
      formatVersion: string;
      artifacts: Array<{
        path: string;
        originType: string;
        registrySourceId?: string;
        verifiedBy: string[];
        overrideStatus: string;
      }>;
    };
    expect(provenance.formatVersion).toBe('1');
    expect(provenance.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'custom/customer_normalizer.ts',
          originType: 'slot',
          overrideStatus: 'none'
        }),
        expect.objectContaining({
          path: 'src/installed/entity/customer-service.ts',
          originType: 'block',
          registrySourceId: 'official'
        })
      ])
    );

    const compactResult = await runCli(workspaceRoot, ['provenance', 'registry', '--json', '--compact']);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(compactResult.stdout)).toMatchObject({
      formatVersion: '1',
      artifacts: expect.any(Array)
    });
  });
});

test('CLI emits explain JSON for CI consumers', { timeout: 120000 }, async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['resolve'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Resolved 3 blocks\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['compose'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Composed project\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['adapt'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Adapted slots\n',
      stderr: ''
    });
    const verification = await runCli(workspaceRoot, ['verify', '--lane', 'all']);
    expect(verification.code).toBe(0);
    expect(verification.stderr).toBe('');
    expect(verification.stdout).toContain('Verification passed (all)');
    await expect(runCli(workspaceRoot, ['lock'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Locked project\n',
      stderr: ''
    });

    const textResult = await runCli(workspaceRoot, ['explain']);
    expect(textResult.code).toBe(0);
    expect(textResult.stderr).toBe('');
    expect(textResult.stdout).toContain('Explain graph');
    expect(textResult.stdout).toContain('Node types:');
    expect(textResult.stdout).toContain('block=');
    expect(textResult.stdout).toContain('policy=');
    expect(textResult.stdout).toContain('Edge types:');
    expect(textResult.stdout).toContain('depends_on=');
    expect(textResult.stdout).toContain('Coverage: 3 blocks; 1 slots;');
    expect(textResult.stdout).toContain('uncovered blocks=0');
    expect(textResult.stdout).toContain('uncovered slots=0');
    expect(textResult.stdout).toContain('Coverage detail: passed;');
    expect(textResult.stdout).toContain('covered blocks: 3/3');
    expect(textResult.stdout).toContain('covered slots: 1/1');
    expect(textResult.stdout).toContain('Provenance origins:');
    expect(textResult.stdout).toContain('block=');
    expect(textResult.stdout).toContain('slot=');
    expect(textResult.stdout).toContain('Provenance detail: artifacts:');
    expect(textResult.stdout).toContain('registry:');
    expect(textResult.stdout).toContain('unverified:');
    expect(textResult.stdout).toContain('Install impact: 3 impacts; groups: 2; actions: copy, merge-prisma;');
    expect(textResult.stdout).toContain('runtime entries: 0; targets: 6');
    expect(textResult.stdout).toContain(
      'CI status: passed; failures: 0; regression risks: 0; conflict hints: 0'
    );
    expect(textResult.stdout).toContain('Chain: attention; stages: 3/4; attention: 1; failed: 0');
    expect(textResult.stdout).toContain('E2E verification: passed; lane=all; failed=none; evidence=ci=passed, failures=0');
    expect(textResult.stdout).toContain('E2E coverage: passed; blocks=3/3; slots=1/1; evidence=blocks=3/3, slots=1/1');
    expect(textResult.stdout).toContain('E2E artifacts: attention; total=0; missing=0; evidence=artifacts=missing');
    expect(textResult.stdout).toContain('E2E review: passed; review-summary=generated; evidence=review-summary=generated');
    expect(textResult.stdout).toContain('Impacted: 3 blocks, 1 slots,');
    expect(textResult.stdout).toContain(
      'Policy: passed; official: 1; project: 0; merged: 1; violations: 0'
    );

    const result = await runCli(workspaceRoot, ['explain', '--json']);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');

    const compactResult = await runCli(workspaceRoot, ['explain', '--json', '--compact']);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout.trim()).not.toContain('\n');

    const payload = JSON.parse(result.stdout) as {
      graph: { nodes: Array<{ id: string; type: string }>; edges: unknown[] };
      e2eMatrix: {
        status: string;
        rowCount: number;
        rows: Array<{ stage: string; status: string; detail: string; evidence: string[] }>;
      };
      reviewSummary: {
        formatVersion: string;
        ciSummary: { status: string; failureCount: number };
        chainSummary: {
          status: string;
          stageCount: number;
          passedStageCount: number;
          attentionStageCount: number;
          failedStageCount: number;
          stageSummaries: Array<{ id: string; status: string; detail: string }>;
        };
        coverageSummary?: {
          status: string;
          acceptancePassedCount: number;
          blockCount: number;
          slotCount: number;
          coveredBlockCount: number;
          coveredSlotCount: number;
          uncoveredBlockCount: number;
          uncoveredSlotCount: number;
          blockSummaries: Array<{ id: string; coveredByCount: number; coveredBy: string[] }>;
          slotSummaries: Array<{ id: string; coveredByCount: number; coveredBy: string[] }>;
        };
        provenanceSummary?: {
          artifactCount: number;
          overrideArtifactCount: number;
          registryArtifactCount: number;
          unverifiedArtifactCount: number;
          originSummaries: Array<{ originType: string; count: number; paths: string[] }>;
          generatedPassSummaries: Array<{ pass: string; count: number; paths: string[] }>;
        };
        policySummary?: {
          status: string;
          officialPolicyCount: number;
          projectPolicyCount: number;
          mergedPolicyCount: number;
          sourceCount: number;
          violationCount: number;
          sourceSummaries: Array<{ scope: string; path: string; policyIds: string[] }>;
          mergedSummaries: Array<{ id: string; targetCount: number; targets: string[] }>;
        };
        installImpactSummary: {
          impactCount: number;
          groupCount: number;
          blockCount: number;
          actionKinds: string[];
          runtimeEntryCount: number;
          targetPathCount: number;
          groupSummaries: Array<{
            vertical: string;
            blockCount: number;
            actionKinds: string[];
            runtimeEntries: string[];
            targetPaths: string[];
          }>;
        };
        impactedBlocks: string[];
        failurePoints: unknown[];
      };
    };
    expect(JSON.parse(compactResult.stdout)).toMatchObject({
      e2eMatrix: {
        status: 'attention',
        rowCount: 4
      },
      reviewSummary: {
        formatVersion: '2',
        chainSummary: { stageCount: 4 }
      }
    });
    expect(payload.graph.nodes.some((node) => node.id === 'policy:tenant-scope-required')).toBe(true);
    expect(payload.graph.edges.length).toBeGreaterThan(0);
    expect(payload.e2eMatrix).toMatchObject({
      status: 'attention',
      rowCount: 4,
      rows: [
        { stage: 'verification', status: 'passed', evidence: ['ci=passed', 'failures=0'] },
        { stage: 'coverage', status: 'passed', evidence: ['blocks=3/3', 'slots=1/1'] },
        { stage: 'artifacts', status: 'attention', evidence: ['artifacts=missing'] },
        { stage: 'review', status: 'passed', evidence: ['review-summary=generated'] }
      ]
    });
    expect(payload.reviewSummary.formatVersion).toBe('2');
    expect(payload.reviewSummary.ciSummary).toMatchObject({
      status: 'passed',
      failureCount: 0
    });
    expect(payload.reviewSummary.chainSummary).toMatchObject({
      status: 'attention',
      stageCount: 4,
      passedStageCount: 3,
      attentionStageCount: 1,
      failedStageCount: 0,
      stageSummaries: [
        { id: 'verification', status: 'passed', detail: 'lane=all; failed=none' },
        { id: 'coverage', status: 'passed', detail: 'blocks=3/3; slots=1/1' },
        { id: 'artifacts', status: 'attention', detail: 'total=0; missing=0' },
        { id: 'review', status: 'passed', detail: 'review-summary=generated' }
      ]
    });
    expect(payload.reviewSummary.coverageSummary).toMatchObject({
      status: 'passed',
      blockCount: 3,
      slotCount: 1,
      coveredBlockCount: 3,
      coveredSlotCount: 1,
      uncoveredBlockCount: 0,
      uncoveredSlotCount: 0
    });
    expect(payload.reviewSummary.coverageSummary?.blockSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'entity/customer-basic',
          coveredByCount: 3,
          coveredBy: ['tenant_only_sees_own_customers', 'user_can_create_customer', 'user_can_list_customers']
        })
      ])
    );
    expect(payload.reviewSummary.coverageSummary?.slotSummaries).toEqual([
      expect.objectContaining({
        id: 'customer_normalizer',
        coveredByCount: 2,
        coveredBy: ['tenant_only_sees_own_customers', 'user_can_create_customer']
      })
    ]);
    expect(payload.reviewSummary.provenanceSummary).toMatchObject({
      overrideArtifactCount: 0,
      registryArtifactCount: expect.any(Number),
      unverifiedArtifactCount: expect.any(Number),
      originSummaries: expect.arrayContaining([
        expect.objectContaining({
          originType: 'block',
          count: expect.any(Number)
        }),
        expect.objectContaining({
          originType: 'slot',
          count: expect.any(Number)
        })
      ]),
      generatedPassSummaries: expect.arrayContaining([
        expect.objectContaining({
          pass: 'compose',
          count: expect.any(Number)
        })
      ])
    });
    expect(payload.reviewSummary.provenanceSummary?.artifactCount).toBeGreaterThan(0);
    expect(payload.reviewSummary.policySummary).toMatchObject({
      status: 'passed',
      officialPolicyCount: 1,
      projectPolicyCount: 0,
      mergedPolicyCount: 1,
      sourceCount: 2,
      violationCount: 0,
      sourceSummaries: [
        {
          scope: 'official',
          path: 'platform/policies/official/policy.spec.yaml',
          policyIds: ['tenant-scope-required']
        },
        {
          scope: 'project',
          path: 'project/policies/policy.spec.yaml',
          policyIds: []
        }
      ],
      mergedSummaries: [
        {
          id: 'tenant-scope-required',
          targetCount: 1,
          targets: ['src/installed/entity/customer-service.ts']
        }
      ]
    });
    expect(payload.reviewSummary.installImpactSummary).toMatchObject({
      impactCount: 3,
      groupCount: 2,
      blockCount: 3,
      actionKinds: ['copy', 'merge-prisma'],
      runtimeEntryCount: 0,
      targetPathCount: 6,
      groupSummaries: expect.arrayContaining([
        expect.objectContaining({
          vertical: 'customer',
          blockCount: 1,
          actionKinds: ['copy', 'merge-prisma'],
          runtimeEntries: [],
          targetPaths: expect.arrayContaining([
            'prisma/schema.prisma',
            'src/installed/entity/customer-service.ts',
            'tests/acceptance/customer-flow.test.ts',
            'tests/unit/customer-normalizer.test.ts'
          ])
        }),
        expect.objectContaining({
          vertical: 'none',
          blockCount: 2,
          actionKinds: ['copy'],
          runtimeEntries: [],
          targetPaths: expect.arrayContaining([
            'src/installed/auth/session.ts',
            'src/installed/tenant/context.ts'
          ])
        })
      ])
    });
    expect(payload.reviewSummary.impactedBlocks).toEqual(
      expect.arrayContaining([
        'auth/basic-session',
        'entity/customer-basic',
        'tenant/basic-workspace'
      ])
    );
    expect(payload.reviewSummary.failurePoints).toEqual([]);
  });
});

test('CLI emits artifact manifest JSON for CI upload consumers', { timeout: 120000 }, async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['resolve'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Resolved 3 blocks\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['compose'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Composed project\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['adapt'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Adapted slots\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane', 'all'])).resolves.toMatchObject({
      code: 0,
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['lock'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Locked project\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['explain'])).resolves.toMatchObject({
      code: 0,
      stderr: ''
    });

    const result = await runCli(workspaceRoot, ['artifacts', '--json']);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');

    const manifest = JSON.parse(result.stdout) as {
      formatVersion: string;
      root: string;
      summary: {
        artifactStatus: 'passed' | 'attention';
        artifactCount: number;
        governanceCount: number;
        viewCount: number;
        testCount: number;
        contractCount: number;
        contractPaths: string[];
        missingCount: number;
        missingReasonCounts: Record<string, number>;
      };
      artifacts: Array<{ path: string; kind: string; uploadName: string; exists: boolean }>;
      uploadGroups: Array<{ kind: string; count: number; paths: string[] }>;
      missing: Array<{ path: string; reason: string; declaredBy: string }>;
    };
    expect(manifest).toMatchObject({
      formatVersion: '1',
      root: 'project'
    });
    expect(manifest.missing).toEqual([]);
    expect(manifest.summary).toEqual({
      artifactStatus: 'passed',
      artifactCount: manifest.artifacts.length,
      governanceCount: manifest.artifacts.filter((artifact) => artifact.kind === 'governance').length,
      viewCount: manifest.artifacts.filter((artifact) => artifact.kind === 'view').length,
      testCount: manifest.artifacts.filter((artifact) => artifact.kind === 'test').length,
      contractCount: 0,
      contractPaths: [],
      missingCount: 0,
      missingReasonCounts: {
        'declared-generated-missing': 0,
        'fixed-governance-missing': 0,
        'fixed-view-missing': 0
      }
    });
    const governancePaths = manifest.artifacts
      .filter((artifact) => artifact.kind === 'governance')
      .map((artifact) => artifact.path);
    const viewPaths = manifest.artifacts
      .filter((artifact) => artifact.kind === 'view')
      .map((artifact) => artifact.path);
    const testPaths = manifest.artifacts
      .filter((artifact) => artifact.kind === 'test')
      .map((artifact) => artifact.path);
    const expectedUploadGroups = [
      {
        kind: 'governance',
        count: manifest.summary.governanceCount,
        paths: governancePaths
      },
      {
        kind: 'view',
        count: manifest.summary.viewCount,
        paths: viewPaths
      }
    ];
    if (testPaths.length > 0) {
      expectedUploadGroups.push({
        kind: 'test',
        count: manifest.summary.testCount,
        paths: testPaths
      });
    }
    expect(manifest.uploadGroups).toEqual(expectedUploadGroups);
    expect(manifest.artifacts).toEqual(
      expect.arrayContaining([
        {
          path: 'generated/ci-artifacts.json',
          kind: 'governance',
          uploadName: 'generated__ci-artifacts.json',
          exists: true
        },
        {
          path: 'generated/review-summary.json',
          kind: 'governance',
          uploadName: 'generated__review-summary.json',
          exists: true
        },
        {
          path: 'generated/explain-graph.json',
          kind: 'governance',
          uploadName: 'generated__explain-graph.json',
          exists: true
        },
        {
          path: 'generated/views/source-view.html',
          kind: 'view',
          uploadName: 'generated__views__source-view.html',
          exists: true
        }
      ])
    );

    const { lockPath, provenancePath, reviewSummaryPath, sourceViewPath } = getWorkspacePaths(workspaceRoot);
    const lock = JSON.parse(await fs.readFile(lockPath, 'utf8')) as { generatedPaths: string[] };
    const provenance = JSON.parse(await fs.readFile(provenancePath, 'utf8')) as {
      artifacts: Array<{ path: string; generatedByPass?: string }>;
    };
    expect(lock.generatedPaths).toContain('generated/ci-artifacts.json');
    expect(provenance.artifacts).toContainEqual(
      expect.objectContaining({
        path: 'generated/ci-artifacts.json',
        generatedByPass: 'artifacts'
      })
    );

    const explainResult = await runCli(workspaceRoot, ['explain', '--json']);
    const explainPayload = JSON.parse(explainResult.stdout) as {
      reviewSummary: {
        artifactSummary?: typeof manifest.summary & { uploadGroups?: typeof manifest.uploadGroups };
      };
    };
    expect(explainPayload.reviewSummary.artifactSummary).toMatchObject(manifest.summary);
    expect(explainPayload.reviewSummary.artifactSummary?.uploadGroups).toEqual(manifest.uploadGroups);

    const contractArtifactPath = path.join(workspaceRoot, 'project', 'generated', 'postgres-contract.json');
    await fs.mkdir(path.dirname(contractArtifactPath), { recursive: true });
    await fs.writeFile(contractArtifactPath, '{"provider":"postgres"}\n', 'utf8');
    const lockWithContractArtifact = JSON.parse(await fs.readFile(lockPath, 'utf8')) as { generatedPaths: string[] };
    lockWithContractArtifact.generatedPaths.push('generated/postgres-contract.json');
    await fs.writeFile(lockPath, `${JSON.stringify(lockWithContractArtifact, null, 2)}\n`, 'utf8');

    const contractResult = await runCli(workspaceRoot, ['artifacts', '--json']);
    expect(contractResult.code).toBe(0);
    expect(contractResult.stderr).toBe('');
    const contractManifest = JSON.parse(contractResult.stdout) as typeof manifest;
    expect(contractManifest.summary).toMatchObject({
      contractCount: 1,
      contractPaths: ['generated/postgres-contract.json']
    });

    const contractPathsResult = await runCli(workspaceRoot, ['artifacts', '--paths', '--kind', 'contract']);
    expect(contractPathsResult.code).toBe(0);
    expect(contractPathsResult.stderr).toBe('');
    expect(contractPathsResult.stdout.trim()).toBe('project/generated/postgres-contract.json');

    const contractPathsJsonResult = await runCli(workspaceRoot, [
      'artifacts',
      '--paths',
      '--json',
      '--kind',
      'contract'
    ]);
    expect(contractPathsJsonResult.code).toBe(0);
    expect(contractPathsJsonResult.stderr).toBe('');
    const contractPathsCompactResult = await runCli(workspaceRoot, [
      'artifacts',
      '--paths',
      '--json',
      '--compact',
      '--kind',
      'contract'
    ]);
    expect(contractPathsCompactResult.code).toBe(0);
    expect(contractPathsCompactResult.stderr).toBe('');
    expect(contractPathsCompactResult.stdout.trim()).not.toContain('\n');
    const contractPathsJson = JSON.parse(contractPathsJsonResult.stdout) as {
      kind: string;
      count: number;
      paths: string[];
      byKind: Record<string, number>;
      uploadGroups: Array<{ kind: string; count: number; paths: string[] }>;
    };
    expect(contractPathsJson).toMatchObject({
      kind: 'contract',
      count: 1,
      paths: ['project/generated/postgres-contract.json'],
      byKind: { contract: 1 },
      uploadGroups: [
        {
          kind: 'contract',
          count: 1,
          paths: ['project/generated/postgres-contract.json']
        }
      ]
    });
    expect(JSON.parse(contractPathsCompactResult.stdout)).toEqual(contractPathsJson);

    const explainWithContractResult = await runCli(workspaceRoot, ['explain']);
    expect(explainWithContractResult.code).toBe(0);
    expect(explainWithContractResult.stderr).toBe('');
    expect(explainWithContractResult.stdout).toContain('contracts: 1');

    const contractReviewSummary = JSON.parse(await fs.readFile(reviewSummaryPath, 'utf8')) as {
      artifactSummary?: typeof contractManifest.summary;
    };
    expect(contractReviewSummary.artifactSummary).toMatchObject({
      contractCount: 1,
      contractPaths: ['generated/postgres-contract.json']
    });

    const lockWithMissingArtifact = JSON.parse(await fs.readFile(lockPath, 'utf8')) as { generatedPaths: string[] };
    lockWithMissingArtifact.generatedPaths.push('generated/missing-diagnostic.json');
    await fs.writeFile(lockPath, `${JSON.stringify(lockWithMissingArtifact, null, 2)}\n`, 'utf8');

    const lockMissingResult = await runCli(workspaceRoot, ['artifacts', '--json']);
    expect(lockMissingResult.code).toBe(0);
    expect(lockMissingResult.stderr).toBe('');

    const manifestWithLockMissing = JSON.parse(lockMissingResult.stdout) as typeof manifest;
    const lockMissingDiagnostics = [
      {
        path: 'generated/missing-diagnostic.json',
        reason: 'declared-generated-missing',
        declaredBy: 'graph.lock.json'
      }
    ];
    expect(manifestWithLockMissing.summary.artifactStatus).toBe('attention');
    expect(manifestWithLockMissing.summary.missingCount).toBe(1);
    expect(manifestWithLockMissing.summary.missingReasonCounts).toEqual({
      'declared-generated-missing': 1,
      'fixed-governance-missing': 0,
      'fixed-view-missing': 0
    });
    expect(manifestWithLockMissing.missing).toEqual(lockMissingDiagnostics);

    const explainWithMissingResult = await runCli(workspaceRoot, ['explain', '--json']);
    const explainWithMissingPayload = JSON.parse(explainWithMissingResult.stdout) as {
      reviewSummary: {
        artifactSummary?: typeof manifest.summary & {
          uploadGroups?: typeof manifest.uploadGroups;
          missing?: typeof lockMissingDiagnostics;
        };
      };
    };
    expect(explainWithMissingPayload.reviewSummary.artifactSummary?.uploadGroups).toEqual(
      manifestWithLockMissing.uploadGroups
    );
    expect(explainWithMissingPayload.reviewSummary.artifactSummary?.missing).toEqual(lockMissingDiagnostics);

    const testPathsBeforeFixture = await runCli(workspaceRoot, ['artifacts', '--paths', '--kind', 'test']);
    expect(testPathsBeforeFixture.code).toBe(0);
    expect(testPathsBeforeFixture.stderr).toBe('');
    expect(testPathsBeforeFixture.stdout === '\n' || testPathsBeforeFixture.stdout === 'project/test-results/**\n').toBe(true);

    await fs.mkdir(path.join(workspaceRoot, 'project', 'test-results'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'project', 'test-results', 'runtime.xml'), '<testsuite />\n', 'utf8');

    const testPathsResult = await runCli(workspaceRoot, ['artifacts', '--paths', '--kind', 'test']);
    expect(testPathsResult.code).toBe(0);
    expect(testPathsResult.stderr).toBe('');
    expect(testPathsResult.stdout).toBe('project/test-results/**\n');

    const testPathsJsonResult = await runCli(workspaceRoot, [
      'artifacts',
      '--paths',
      '--json',
      '--kind',
      'test'
    ]);
    expect(testPathsJsonResult.code).toBe(0);
    expect(testPathsJsonResult.stderr).toBe('');
    expect(JSON.parse(testPathsJsonResult.stdout)).toEqual({
      formatVersion: '1',
      root: 'project',
      kind: 'test',
      artifactStatus: 'attention',
      count: 1,
      paths: ['project/test-results/**'],
      byKind: {
        test: 1
      },
      uploadGroups: [
        {
          kind: 'test',
          count: 1,
          paths: ['project/test-results/**']
        }
      ],
      missingCount: 1,
      missingReasonCounts: {
        'declared-generated-missing': 1,
        'fixed-governance-missing': 0,
        'fixed-view-missing': 0
      },
      missing: lockMissingDiagnostics
    });

    const testManifestResult = await runCli(workspaceRoot, ['artifacts', '--json']);
    const testManifest = JSON.parse(testManifestResult.stdout) as typeof manifest;
    expect(testManifest.summary.testCount).toBe(1);
    expect(testManifest.uploadGroups).toContainEqual({
      kind: 'test',
      count: 1,
      paths: ['test-results/**']
    });

    const refreshedReviewSummary = JSON.parse(await fs.readFile(reviewSummaryPath, 'utf8')) as {
      artifactSummary?: typeof testManifest.summary & { uploadGroups?: typeof testManifest.uploadGroups };
    };
    expect(refreshedReviewSummary.artifactSummary).toMatchObject({
      testCount: 1
    });
    expect(refreshedReviewSummary.artifactSummary?.uploadGroups).toContainEqual({
      kind: 'test',
      count: 1,
      paths: ['test-results/**']
    });

    const refreshedSourceView = await fs.readFile(sourceViewPath, 'utf8');
    expect(refreshedSourceView).toContain('<td>Test Artifacts</td><td>1</td>');
    expect(refreshedSourceView).toContain('<td>test</td>');
    expect(refreshedSourceView).toContain('test-results/**');

    await fs.rm(path.join(workspaceRoot, 'project', 'generated', 'policy-report.json'));
    await fs.rm(sourceViewPath);

    const missingResult = await runCli(workspaceRoot, ['artifacts', '--json']);
    expect(missingResult.code).toBe(0);
    expect(missingResult.stderr).toBe('');

    const manifestWithMissing = JSON.parse(missingResult.stdout) as typeof manifest;
    const fixedMissingDiagnostics = [
      ...lockMissingDiagnostics,
      {
        path: 'generated/policy-report.json',
        reason: 'fixed-governance-missing',
        declaredBy: 'artifact-manifest'
      },
      {
        path: 'generated/views/source-view.html',
        reason: 'fixed-view-missing',
        declaredBy: 'artifact-manifest'
      }
    ];
    expect(manifestWithMissing.summary.artifactStatus).toBe('attention');
    expect(manifestWithMissing.summary.missingCount).toBe(3);
    expect(manifestWithMissing.summary.missingReasonCounts).toEqual({
      'declared-generated-missing': 1,
      'fixed-governance-missing': 1,
      'fixed-view-missing': 1
    });
    expect(manifestWithMissing.missing).toEqual(fixedMissingDiagnostics);

    const compactResult = await runCli(workspaceRoot, ['artifacts', '--json', '--compact']);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(compactResult.stdout)).toMatchObject({
      formatVersion: '1',
      root: 'project'
    });

    const pathsResult = await runCli(workspaceRoot, ['artifacts', '--paths']);
    expect(pathsResult.code).toBe(0);
    expect(pathsResult.stderr).toBe('');
    const uploadPaths = pathsResult.stdout.trim().split('\n');
    expect(uploadPaths).toContain('project/generated/ci-artifacts.json');
    expect(uploadPaths).toContain('project/generated/review-summary.json');
    expect(uploadPaths).not.toContain('project/generated/missing-diagnostic.json');
    expect(uploadPaths).not.toContain('project/generated/views/source-view.html');

    const pathsJsonResult = await runCli(workspaceRoot, ['artifacts', '--paths', '--json']);
    expect(pathsJsonResult.code).toBe(0);
    expect(pathsJsonResult.stderr).toBe('');
    const pathsJson = JSON.parse(pathsJsonResult.stdout) as {
      formatVersion: string;
      root: string;
      kind: string;
      artifactStatus: 'passed' | 'attention';
      count: number;
      paths: string[];
      byKind: Record<string, number>;
      uploadGroups: Array<{ kind: string; count: number; paths: string[] }>;
      missingCount: number;
      missingReasonCounts: Record<string, number>;
      missing: typeof fixedMissingDiagnostics;
    };
    expect(pathsJson.formatVersion).toBe('1');
    expect(pathsJson.root).toBe('project');
    expect(pathsJson.kind).toBe('all');
    expect(pathsJson.artifactStatus).toBe('attention');
    expect(pathsJson.count).toBe(uploadPaths.length);
    expect(pathsJson.paths).toEqual(uploadPaths);
    expect(pathsJson.byKind.view).toBe(
      uploadPaths.filter((pathEntry) => pathEntry.includes('/views/')).length
    );
    expect(pathsJson.byKind.test).toBe(1);
    expect(Object.values(pathsJson.byKind).reduce((total, count) => total + count, 0)).toBe(
      uploadPaths.length
    );
    expect(pathsJson.uploadGroups).toContainEqual({
      kind: 'test',
      count: 1,
      paths: ['project/test-results/**']
    });
    expect(pathsJson.uploadGroups).toContainEqual({
      kind: 'view',
      count: pathsJson.byKind.view,
      paths: uploadPaths.filter((pathEntry) => pathEntry.includes('/views/'))
    });
    expect(pathsJson.uploadGroups.reduce((total, group) => total + group.count, 0)).toBe(
      uploadPaths.length
    );
    expect(pathsJson.missingCount).toBe(fixedMissingDiagnostics.length);
    expect(pathsJson.missingReasonCounts).toEqual({
      'declared-generated-missing': 1,
      'fixed-governance-missing': 1,
      'fixed-view-missing': 1
    });
    expect(pathsJson.missing).toEqual(fixedMissingDiagnostics);

    const governancePathsResult = await runCli(workspaceRoot, ['artifacts', '--paths', '--kind', 'governance']);
    expect(governancePathsResult.code).toBe(0);
    expect(governancePathsResult.stderr).toBe('');
    const governanceUploadPaths = governancePathsResult.stdout.trim().split('\n');
    expect(governanceUploadPaths).toContain('project/generated/ci-artifacts.json');
    expect(governanceUploadPaths).toContain('project/generated/review-summary.json');
    expect(governanceUploadPaths).not.toContain('project/generated/views/slot-rule-view.html');

    const viewPathsJsonResult = await runCli(workspaceRoot, [
      'artifacts',
      '--paths',
      '--json',
      '--kind',
      'view'
    ]);
    expect(viewPathsJsonResult.code).toBe(0);
    expect(viewPathsJsonResult.stderr).toBe('');
    const viewPathsJson = JSON.parse(viewPathsJsonResult.stdout) as {
      formatVersion: string;
      root: string;
      kind: string;
      count: number;
      paths: string[];
      byKind: Record<string, number>;
      uploadGroups: Array<{ kind: string; count: number; paths: string[] }>;
    };
    expect(viewPathsJson.formatVersion).toBe('1');
    expect(viewPathsJson.root).toBe('project');
    expect(viewPathsJson.kind).toBe('view');
    expect(viewPathsJson.paths).toEqual(['project/generated/views/slot-rule-view.html']);
    expect(viewPathsJson.count).toBe(viewPathsJson.paths.length);
    expect(viewPathsJson.byKind).toEqual({ view: 1 });
    expect(viewPathsJson.uploadGroups).toEqual([
      {
        kind: 'view',
        count: 1,
        paths: ['project/generated/views/slot-rule-view.html']
      }
    ]);
    expect(viewPathsJson.paths).not.toContain('project/generated/ci-artifacts.json');

  });
});

test('CLI emits repair dry-run JSON for CI consumers', { timeout: 20000 }, async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['resolve'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Resolved 3 blocks\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['compose'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Composed project\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['adapt'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Adapted slots\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane', 'fast'])).resolves.toMatchObject({
      code: 0,
      stderr: ''
    });

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
    expect(textResult.stdout).toContain('Task repair_slot_customer_normalizer: entity/customer-basic -> custom/customer_normalizer.ts');
    expect(textResult.stdout).toContain(
      'Review repair_slot_customer_normalizer: writeBounds=custom/customer_normalizer.ts; symbols=normalizeCustomerInput; tests=tests/unit/customer-normalizer.test.ts, tests/acceptance/customer-flow.test.ts; forbidden=modify_other_files, add_dependencies, access_database, change_exports; failureTargets=none'
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
      targetFile: 'custom/customer_normalizer.ts',
      review: {
        allowedPathCount: 1,
        requiredSymbolCount: 1,
        forbiddenOperationCount: 4,
        testCount: 2,
        failureTargetCount: 0,
        writeBounds: ['custom/customer_normalizer.ts'],
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

    lock.passStatus.verify = 'succeeded';
    await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
    report.unit.status = 'passed';
    report.fast.status = 'passed';
    report.fast.unit.status = 'passed';
    report.summary.status = 'passed';
    report.summary.requestedLane = 'all';
    report.summary.failedLanes = [];
    await fs.writeFile(verificationReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    await expect(runCli(workspaceRoot, ['lock'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Locked project\n',
      stderr: ''
    });

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
      targetFiles: ['custom/customer_normalizer.ts'],
      taskSummaries: [
        expect.objectContaining({
          taskId: 'repair_slot_customer_normalizer',
          allowedPathCount: 1,
          requiredSymbolCount: 1,
          forbiddenOperationCount: 4,
          testCount: 2,
          failureTargetCount: 0,
          writeBounds: ['custom/customer_normalizer.ts'],
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

test('CLI emits blocked repair JSON for CI consumers', { timeout: 20000 }, async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['resolve'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Resolved 3 blocks\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['compose'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Composed project\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['adapt'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Adapted slots\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane', 'fast'])).resolves.toMatchObject({
      code: 0,
      stderr: ''
    });

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
  });
});

test('CLI emits upgrade dry-run JSON for CI consumers', { timeout: 20000 }, async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    const textResult = await runCli(workspaceRoot, [
      'upgrade',
      'auth/basic-session',
      '0.1.1',
      '--dry-run'
    ]);
    expect(textResult.code).toBe(0);
    expect(textResult.stderr).toBe('');
    expect(textResult.stdout).toContain(
      'Upgrade auth/basic-session 0.1.0 -> 0.1.1 (dry-run)'
    );
    expect(textResult.stdout).toContain(
      'Status: planned; migrations: 2; preflight checks:'
    );
    expect(textResult.stdout).toContain(
      'Migration kinds: file-replace=1, json-array-append=1'
    );
    expect(textResult.stdout).toContain(
      'Impacts: src/installed/auth/session.ts, upgrade.metadata.json'
    );
    expect(textResult.stdout).toContain('Requires verification: true (1 migrations)');
    expect(textResult.stdout).toContain(
      'Migration mig-auth-session-refresh: file-replace;'
    );
    expect(textResult.stdout).toContain(
      'target=src/installed/auth/session.ts; source=files/src/installed/auth/session.ts; role=file; requiresVerification=true'
    );
    expect(textResult.stdout).toContain(
      'Migration mig-auth-session-upgrade-metadata: json-array-append;'
    );
    expect(textResult.stdout).toContain(
      'target=upgrade.metadata.json; role=json; path=upgradedBlocks; items=1; requiresVerification=false'
    );
    expect(textResult.stdout).toContain('Preflight version-range: passed; evidence=');
    expect(textResult.stdout).toContain('Preflight migration-entries: passed; evidence=');

    const result = await runCli(workspaceRoot, [
      'upgrade',
      'auth/basic-session',
      '0.1.1',
      '--dry-run',
      '--json'
    ]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');

    const upgradePlan = JSON.parse(result.stdout) as UpgradePlan;
    expect(upgradePlan).toMatchObject({
      blockId: 'auth/basic-session',
      fromVersion: '0.1.0',
      toVersion: '0.1.1',
      status: 'planned',
      migrationKindCounts: {
        'file-replace': 1,
        'json-array-append': 1
      }
    });
    expect(upgradePlan.impacts).toEqual(['src/installed/auth/session.ts', 'upgrade.metadata.json']);
    expect(upgradePlan.migrationOperations).toEqual([
      {
        id: 'mig-auth-session-refresh',
        kind: 'file-replace',
        target: 'src/installed/auth/session.ts',
        role: 'file',
        source: 'files/src/installed/auth/session.ts'
      },
      {
        id: 'mig-auth-session-upgrade-metadata',
        kind: 'json-array-append',
        target: 'upgrade.metadata.json',
        role: 'json',
        path: ['upgradedBlocks'],
        itemCount: 1
      }
    ]);

    await expect(runCli(workspaceRoot, ['resolve'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Resolved 3 blocks\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['compose'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Composed project\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['adapt'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Adapted slots\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane', 'fast'])).resolves.toMatchObject({
      code: 0,
      stderr: ''
    });

    const { lockPath, verificationReportPath } = getWorkspacePaths(workspaceRoot);
    const lock = JSON.parse(await fs.readFile(lockPath, 'utf8')) as {
      passStatus: { verify: string };
    };
    lock.passStatus.verify = 'succeeded';
    await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');

    const report = JSON.parse(await fs.readFile(verificationReportPath, 'utf8')) as VerificationReport;
    report.unit.status = 'passed';
    report.unit.passed = [];
    report.acceptance.status = 'passed';
    report.acceptance.passed = [];
    report.acceptance.failed = [];
    report.policy.status = 'passed';
    report.policy.violations = [];
    report.fast.status = 'passed';
    report.summary.status = 'passed';
    report.summary.requestedLane = 'all';
    report.summary.failedLanes = [];
    await fs.writeFile(verificationReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    await expect(runCli(workspaceRoot, ['lock'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Locked project\n',
      stderr: ''
    });

    const explainText = await runCli(workspaceRoot, ['explain']);
    expect(explainText.code).toBe(0);
    expect(explainText.stderr).toBe('');
    expect(explainText.stdout).toContain(
      [
        'Upgrade: planned',
        'auth/basic-session 0.1.0 -> 0.1.1',
        'migrations: 2',
        'impacts: 2',
        'sources: 1',
        'slots: 0',
        'requires verification: true',
        'verification: required=1, skipped=1'
      ].join('; ')
    );

    const explainJson = await runCli(workspaceRoot, ['explain', '--json']);
    expect(explainJson.code).toBe(0);
    expect(explainJson.stderr).toBe('');
    const explainPayload = JSON.parse(explainJson.stdout) as {
      reviewSummary: {
        upgradeSummary?: {
          status: string;
          blockId: string;
          preflightCheckCount: number;
          preflightEvidenceCount: number;
          migrationCount: number;
          migrationKindCounts: Record<string, number>;
          requiresVerification: boolean;
          requiresVerificationCount: number;
          impactCount: number;
          impacts: string[];
          verificationSummaries: Array<{ id: string; count: number }>;
          preflightSummaries: Array<{ group: string; checkCount: number; evidenceCount: number }>;
          migrationSummaries: Array<{
            id: string;
            kind: string;
            source?: string;
            target: string;
            requiresVerification: boolean;
          }>;
        };
      };
    };
    expect(explainPayload.reviewSummary.upgradeSummary).toMatchObject({
      status: 'planned',
      blockId: 'auth/basic-session',
      preflightCheckCount: upgradePlan.preflightChecks.length,
      migrationCount: 2,
      migrationKindCounts: {
        'file-replace': 1,
        'json-array-append': 1
      },
      requiresVerification: true,
      requiresVerificationCount: 1,
      impactCount: 2,
      impacts: ['src/installed/auth/session.ts', 'upgrade.metadata.json'],
      verificationSummaries: [
        { id: 'required', count: 1 },
        { id: 'skipped', count: 1 }
      ]
    });
    expect(explainPayload.reviewSummary.upgradeSummary?.preflightEvidenceCount).toBeGreaterThan(0);
    expect(explainPayload.reviewSummary.upgradeSummary?.preflightSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          group: 'migration',
          checkCount: expect.any(Number),
          evidenceCount: expect.any(Number)
        })
      ])
    );
    expect(explainPayload.reviewSummary.upgradeSummary?.migrationSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'mig-auth-session-refresh',
          kind: 'file-replace',
          source: 'files/src/installed/auth/session.ts',
          target: 'src/installed/auth/session.ts',
          requiresVerification: true
        })
      ])
    );
  });
});

test('CLI reports argument usage errors', { timeout: 40000 }, async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--unknown'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform init [--reset]')
    });
    await expect(runCli(workspaceRoot, ['init', '--reset', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform init [--reset]')
    });
    await expect(runCli(workspaceRoot, ['add'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform add <block-id>')
    });
    await expect(runCli(workspaceRoot, ['add', 'entity/customer-basic', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform add <block-id>')
    });
    await expect(runCli(workspaceRoot, ['repair', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform repair [--dry-run] [--json]')
    });
    await expect(runCli(workspaceRoot, ['repair', '--dry-run', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform repair [--dry-run] [--json]')
    });
    await expect(runCli(workspaceRoot, ['upgrade', 'entity/customer-basic'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform upgrade <block-id> <target-version> [--dry-run] [--json]')
    });
    await expect(runCli(workspaceRoot, ['upgrade', 'entity/customer-basic', '0.2.0', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform upgrade <block-id> <target-version> [--dry-run] [--json]')
    });
    await expect(runCli(workspaceRoot, ['upgrade', 'entity/customer-basic', '0.2.0', '--dry-run', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform upgrade <block-id> <target-version> [--dry-run] [--json]')
    });
    await expect(runCli(workspaceRoot, ['explain', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform explain [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['explain', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform explain [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['explain', '--json', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform explain [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['artifacts'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform artifacts (--json [--compact]|--paths [--json [--compact]] [--kind governance|view|test|contract])')
    });
    await expect(runCli(workspaceRoot, ['artifacts', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform artifacts (--json [--compact]|--paths [--json [--compact]] [--kind governance|view|test|contract])')
    });
    await expect(runCli(workspaceRoot, ['artifacts', '--paths', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform artifacts (--json [--compact]|--paths [--json [--compact]] [--kind governance|view|test|contract])')
    });
    await expect(runCli(workspaceRoot, ['artifacts', '--json', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform artifacts (--json [--compact]|--paths [--json [--compact]] [--kind governance|view|test|contract])')
    });
    await expect(runCli(workspaceRoot, ['artifacts', '--paths', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform artifacts (--json [--compact]|--paths [--json [--compact]] [--kind governance|view|test|contract])')
    });
    await expect(runCli(workspaceRoot, ['doctor', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform doctor [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['doctor', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform doctor [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['doctor', '--json', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform doctor [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['reference'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform reference check [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['reference', 'check', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform reference check [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['reference', 'status'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform reference check [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['benchmark'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform benchmark suite [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['benchmark', 'suite', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform benchmark suite [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['benchmark', 'status'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform benchmark suite [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['test'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform test budget [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['test', 'budget', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform test budget [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['test', 'status'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform test budget [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['policy'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform policy report [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['policy', 'report', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform policy report [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['policy', 'status'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform policy report [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['acceptance'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform acceptance coverage [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['acceptance', 'coverage', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform acceptance coverage [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['acceptance', 'status'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform acceptance coverage [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['runtime'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform runtime report [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['runtime', 'report', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform runtime report [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['runtime', 'status'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform runtime report [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['verification'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform verification report [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['verification', 'report', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform verification report [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['verification', 'status'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform verification report [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['provenance'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform provenance registry [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['provenance', 'registry', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform provenance registry [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['provenance', 'status'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform provenance registry [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['contract'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform contract <freeze|errors> [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['contract', 'freeze', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform contract <freeze|errors> [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['contract', 'errors', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform contract <freeze|errors> [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['contract', 'status'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform contract <freeze|errors> [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane', 'slow'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform verify [--lane fast|runtime|all]')
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform verify [--lane fast|runtime|all]')
    });
    await expect(runCli(workspaceRoot, ['verify', 'fast'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform verify [--lane fast|runtime|all]')
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane', 'fast', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform verify [--lane fast|runtime|all]')
    });
    await expect(runCli(workspaceRoot, ['resolve', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform resolve')
    });
  });
});
