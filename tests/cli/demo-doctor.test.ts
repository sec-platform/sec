import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildBenchmarkTaskSuiteContract,
  formatBenchmarkTaskSuiteContract
} from '../../platform/shared/benchmark-contract.ts';
import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
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

test('CLI exposes demo checklist as text and JSON readiness contracts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const missingText = await runCli(workspaceRoot, ['demo', 'checklist']);
    expect(missingText.code).toBe(0);
    expect(missingText.stderr).toBe('');
    expect(missingText.stdout).toContain('Demo checklist attention; items=8; missing=8');
    expect(missingText.stdout).toContain(`verification-report: missing; ${CI_ARTIFACT_FILES.verificationReport}`);
    expect(missingText.stdout).toContain('Next command: npm run demo:quickstart');

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

    const readyText = await runCli(workspaceRoot, ['demo', 'checklist']);
    expect(readyText.code).toBe(0);
    expect(readyText.stderr).toBe('');
    expect(readyText.stdout).toContain('Demo checklist passed; items=8; missing=0');
    expect(readyText.stdout).toContain(`review-summary: passed; ${CI_ARTIFACT_FILES.reviewSummary}`);
    expect(readyText.stdout).toContain('Next command: npm run demo:closed-loop');

    const readyJson = await runCli(workspaceRoot, ['demo', 'checklist', '--json', '--compact']);
    expect(readyJson.code).toBe(0);
    expect(readyJson.stderr).toBe('');
    expect(readyJson.stdout).not.toContain('\n  "status"');
    expect(JSON.parse(readyJson.stdout)).toMatchObject({
      formatVersion: '1',
      status: 'passed',
      itemCount: 8,
      missingCount: 0,
      nextCommand: 'npm run demo:closed-loop',
      items: expect.arrayContaining([
        {
          id: 'explain-graph',
          status: 'passed',
          artifactPath: CI_ARTIFACT_FILES.explainGraph,
          command: 'npm run platform -- explain'
        }
      ])
    });
  });
}, 120000);

test('CLI exposes doctor as text and JSON readiness contracts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const doctor = await runCli(workspaceRoot, ['doctor']);
    expect(doctor.code).toBe(0);
    expect(doctor.stderr).toBe('');
    expect(doctor.stdout).toContain('Developer environment doctor');
    expect(doctor.stdout).toContain('Checks: 6');
    expect(doctor.stdout).toContain('node-version');
    expect(doctor.stdout).toContain('workspace-roots');
    expect(doctor.stdout).toContain('Workspace roots missing: source, project, control, .pjc; run platform init.');
    expect(doctor.stdout).toContain('runtime-dependencies');

    const doctorJson = await runCli(workspaceRoot, ['doctor', '--json']);
    expect(doctorJson.code).toBe(0);
    expect(doctorJson.stderr).toBe('');
    expect(JSON.parse(doctorJson.stdout)).toMatchObject({
      status: expect.any(String),
      checkCount: 6,
      checks: expect.arrayContaining([
        expect.objectContaining({ id: 'node-version' }),
        expect.objectContaining({ id: 'bun' }),
        expect.objectContaining({
          id: 'workspace-roots',
          status: 'warn',
          message: 'Workspace roots missing: source, project, control, .pjc; run platform init.'
        }),
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
      checkCount: 6,
      dependencies: expect.objectContaining({ mode: expect.any(String) })
    });

    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    const initializedDoctorJson = await runCli(workspaceRoot, ['doctor', '--json', '--compact']);
    expect(initializedDoctorJson.code).toBe(0);
    expect(initializedDoctorJson.stderr).toBe('');
    expect(JSON.parse(initializedDoctorJson.stdout)).toMatchObject({
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: 'workspace-roots',
          status: 'ok',
          message: 'Workspace roots exist: source, project, control, .pjc.'
        })
      ])
    });
  });
});
