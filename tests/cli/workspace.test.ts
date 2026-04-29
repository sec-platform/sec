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
  PlanFile,
  RepairPlan,
  ReviewSummary,
  UpgradeDiagnostics,
  UpgradePlan,
  VerificationReport
} from '../../platform/shared/types.ts';
import { writeJson } from '../../platform/shared/fs.ts';
import { readYaml, writeYaml } from '../../platform/shared/yaml.ts';
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

test('CLI init creates the developer source layer', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });

    const paths = getWorkspacePaths(workspaceRoot);
    await expect(fs.stat(paths.developerSourceRoot)).resolves.toMatchObject({});
    await expect(fs.stat(paths.sourceSlotsRoot)).resolves.toMatchObject({});
    await expect(fs.stat(paths.sourceOverridesRoot)).resolves.toMatchObject({});
    await expect(fs.stat(paths.sourcePoliciesRoot)).resolves.toMatchObject({});
    await expect(fs.stat(paths.sourceAcceptanceRoot)).resolves.toMatchObject({});
    await expect(fs.stat(paths.sourceAssetsRoot)).resolves.toMatchObject({});
    await expect(fs.stat(paths.sourcePrivateRegistryRoot)).resolves.toMatchObject({});
    await expect(fs.stat(paths.sourceViewsRoot)).resolves.toMatchObject({});
    await expect(fs.stat(paths.sourceViewMutationsRoot)).resolves.toMatchObject({});
    await expect(fs.stat(paths.sourceEnvRoot)).resolves.toMatchObject({});
  });
});

test('CLI applies Workbench view mutations back to source app plan', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });

    const paths = getWorkspacePaths(workspaceRoot);
    await writeJson(path.join(paths.sourceViewMutationsRoot, 'workspace-name.json'), {
      formatVersion: '1',
      mutations: [
        {
          id: 'rename-workspace-from-view',
          kind: 'set-app-name',
          value: 'field-service-admin'
        },
        {
          id: 'add-view-driven-acceptance',
          kind: 'add-acceptance',
          acceptanceId: 'view_can_update_workspace_name'
        },
        {
          id: 'clarify-customer-normalizer-slot',
          kind: 'set-slot-description',
          slotId: 'customer_normalizer',
          description: 'Workbench-edited slot description.'
        }
      ]
    });

    const textResult = await runCli(workspaceRoot, ['workbench', 'mutations', 'apply']);
    expect(textResult).toMatchObject({
      code: 0,
      stderr: ''
    });
    expect(textResult.stdout).toContain('Workbench mutations applied; files=1; applied=3; skipped=0');
    expect(textResult.stdout).toContain('target: source/app.yaml');

    const plan = await readYaml<PlanFile>(paths.planPath);
    expect(plan.app.name).toBe('field-service-admin');
    expect(plan.acceptance.map((entry) => entry.id)).toContain('view_can_update_workspace_name');
    expect(plan.slots.find((slot) => slot.id === 'customer_normalizer')?.description).toBe('Workbench-edited slot description.');

    const jsonResult = await runCli(workspaceRoot, ['workbench', 'mutations', 'apply', '--json', '--compact']);
    expect(jsonResult.code).toBe(0);
    expect(jsonResult.stderr).toBe('');
    expect(JSON.parse(jsonResult.stdout)).toMatchObject({
      formatVersion: '1',
      status: 'skipped',
      sourceRoot: 'source/views/mutations',
      targetPath: 'source/app.yaml',
      mutationFileCount: 1,
      mutationCount: 3,
      appliedCount: 0,
      skippedCount: 3
    });

    const report = JSON.parse(await fs.readFile(paths.viewMutationReportPath, 'utf8'));
    expect(report).toMatchObject({
      formatVersion: '1',
      status: 'skipped',
      mutationFileCount: 1,
      mutationCount: 3
    });
  });
});

test('CLI rejects Workbench slot source mutations outside slot source', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });

    const paths = getWorkspacePaths(workspaceRoot);
    await writeJson(path.join(paths.sourceViewMutationsRoot, 'invalid-slot-source.json'), {
      formatVersion: '1',
      mutations: [
        {
          id: 'move-slot-to-app-code',
          kind: 'set-slot-source-path',
          slotId: 'customer_normalizer',
          sourcePath: 'source/code/app/customer-normalizer.ts'
        }
      ]
    });

    const result = await runCli(workspaceRoot, ['workbench', 'mutations', 'apply']);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('WORKBENCH-MUTATION-002 move-slot-to-app-code.sourcePath must stay under source/code/slots/**');
    expect(result.stderr).toContain('"source/views/mutations"');
    expect(result.stderr).toContain('"control/workflow/view-mutation-report.json"');
  });
});

test('CLI defaults verification to the fast lane', async () => {
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

test('CLI adds private registry blocks and preserves registry metadata on resolve', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    await installPrivateBannerBlock(workspaceRoot);
    const { lockPath, planPath } = getWorkspacePaths(workspaceRoot);

    await expect(runCli(workspaceRoot, ['add', 'private/banner-basic'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Added block private/banner-basic@0.1.0 from private (private)\n',
      stderr: ''
    });
    await expect(fs.readFile(planPath, 'utf8')).resolves.toContain('private/banner-basic');

    await expect(runCli(workspaceRoot, ['resolve'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Resolved 4 blocks\n',
      stderr: ''
    });
    const lock = JSON.parse(await fs.readFile(lockPath, 'utf8')) as {
      resolvedBlocks: Array<{ id: string; registrySourceId: string; registryKind: string; registryLocation: string }>;
    };
    expect(lock.resolvedBlocks.find((block) => block.id === 'private/banner-basic')).toMatchObject({
      registrySourceId: 'private',
      registryKind: 'private',
      registryLocation: 'workspace'
    });
  });
});
