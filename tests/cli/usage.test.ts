import { expect, test } from 'vitest';
import { spawn } from 'node:child_process';
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
import { compilerRoot, getWorkspacePaths } from '../../platform/shared/paths.ts';
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
import { withTempWorkspace } from '../helpers/test-utils.ts';

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

test('CLI prints usage for missing or unknown commands', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    for (const args of [[], ['unknown'], ['unknown', '--flag']]) {
      const result = await runCli(workspaceRoot, args);
      expect(result).toMatchObject({
        code: 0,
        stderr: ''
      });
      expect(result.stdout).toBe(`${USAGE}\n`);
    }
  });
});

test('CLI reports argument usage errors', { timeout: 60000 }, async () => {
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
    await expectRepairUsageError(workspaceRoot, ['--extra']);
    await expectRepairUsageError(workspaceRoot, ['--dry-run', '--extra']);
    await expectRepairUsageError(workspaceRoot, ['--compact']);
    await expectRepairUsageError(workspaceRoot, ['--json', '--compact', '--extra']);
    await expectRepairUsageError(workspaceRoot, ['plan', '--compact']);
    await expectRepairUsageError(workspaceRoot, ['plan', '--json', '--extra']);
    await expect(runCli(workspaceRoot, ['upgrade', 'entity/customer-basic'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform upgrade (<block-id> <target-version> [--dry-run]|plan|diagnostics) [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['upgrade', 'entity/customer-basic', '0.2.0', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform upgrade (<block-id> <target-version> [--dry-run]|plan|diagnostics) [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['upgrade', 'entity/customer-basic', '0.2.0', '--dry-run', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform upgrade (<block-id> <target-version> [--dry-run]|plan|diagnostics) [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['upgrade', 'entity/customer-basic', '0.2.0', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform upgrade (<block-id> <target-version> [--dry-run]|plan|diagnostics) [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['upgrade', 'entity/customer-basic', '0.2.0', '--json', '--compact', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform upgrade (<block-id> <target-version> [--dry-run]|plan|diagnostics) [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['upgrade', 'plan', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform upgrade (<block-id> <target-version> [--dry-run]|plan|diagnostics) [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['upgrade', 'plan', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform upgrade (<block-id> <target-version> [--dry-run]|plan|diagnostics) [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['upgrade', 'plan', '--json', '--compact', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform upgrade (<block-id> <target-version> [--dry-run]|plan|diagnostics) [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['upgrade', 'diagnostics', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform upgrade (<block-id> <target-version> [--dry-run]|plan|diagnostics) [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['upgrade', 'diagnostics', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform upgrade (<block-id> <target-version> [--dry-run]|plan|diagnostics) [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['upgrade', 'diagnostics', '--json', '--compact', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform upgrade (<block-id> <target-version> [--dry-run]|plan|diagnostics) [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['explain', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform explain [--json [--compact]]|graph [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['explain', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform explain [--json [--compact]]|graph [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['explain', '--json', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform explain [--json [--compact]]|graph [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['artifacts'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform artifacts (--json [--compact]|manifest [--json [--compact]]|--paths [--json [--compact]] [--kind governance|view|test|contract])')
    });
    await expect(runCli(workspaceRoot, ['artifacts', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform artifacts (--json [--compact]|manifest [--json [--compact]]|--paths [--json [--compact]] [--kind governance|view|test|contract])')
    });
    await expect(runCli(workspaceRoot, ['artifacts', '--paths', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform artifacts (--json [--compact]|manifest [--json [--compact]]|--paths [--json [--compact]] [--kind governance|view|test|contract])')
    });
    await expect(runCli(workspaceRoot, ['artifacts', '--json', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform artifacts (--json [--compact]|manifest [--json [--compact]]|--paths [--json [--compact]] [--kind governance|view|test|contract])')
    });
    await expect(runCli(workspaceRoot, ['artifacts', '--paths', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform artifacts (--json [--compact]|manifest [--json [--compact]]|--paths [--json [--compact]] [--kind governance|view|test|contract])')
    });
    await expect(runCli(workspaceRoot, ['artifacts', 'manifest', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform artifacts (--json [--compact]|manifest [--json [--compact]]|--paths [--json [--compact]] [--kind governance|view|test|contract])')
    });
    await expect(runCli(workspaceRoot, ['artifacts', 'manifest', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform artifacts (--json [--compact]|manifest [--json [--compact]]|--paths [--json [--compact]] [--kind governance|view|test|contract])')
    });
    await expect(runCli(workspaceRoot, ['artifacts', 'manifest', '--json', '--compact', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform artifacts (--json [--compact]|manifest [--json [--compact]]|--paths [--json [--compact]] [--kind governance|view|test|contract])')
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
    await expectPolicyUsageError(workspaceRoot, []);
    await expectPolicyUsageError(workspaceRoot, ['report', '--compact']);
    await expectPolicyUsageError(workspaceRoot, ['sources', '--compact']);
    await expectPolicyUsageError(workspaceRoot, ['status']);
    await expectAcceptanceUsageError(workspaceRoot, []);
    await expectAcceptanceUsageError(workspaceRoot, ['coverage', '--compact']);
    await expectAcceptanceUsageError(workspaceRoot, ['blocks', '--compact']);
    await expectAcceptanceUsageError(workspaceRoot, ['slots', '--compact']);
    await expectAcceptanceUsageError(workspaceRoot, ['status']);
    await expect(runCli(workspaceRoot, ['runtime'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr(RUNTIME_USAGE)
    });
    await expect(runCli(workspaceRoot, ['runtime', 'report', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr(RUNTIME_USAGE)
    });
    await expect(runCli(workspaceRoot, ['runtime', 'status'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr(RUNTIME_USAGE)
    });
    await expect(runCli(workspaceRoot, ['install'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform install manifest [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['install', 'manifest', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform install manifest [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['install', 'status'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform install manifest [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['blocks'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform blocks usage [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['blocks', 'usage', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform blocks usage [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['blocks', 'status'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform blocks usage [--json [--compact]]')
    });
    await expectPostgresUsageError(workspaceRoot, []);
    await expectPostgresUsageError(workspaceRoot, ['contract', '--compact']);
    await expectPostgresUsageError(workspaceRoot, ['status']);
    await expectLockUsageError(workspaceRoot, ['--json']);
    await expectLockUsageError(workspaceRoot, ['inspect', '--compact']);
    await expectLockUsageError(workspaceRoot, ['status']);
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
    await expect(runCli(workspaceRoot, ['review'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform review <summary|matrix|diagnostics> [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['review', 'summary', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform review <summary|matrix|diagnostics> [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['review', 'status'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform review <summary|matrix|diagnostics> [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['contract'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform contract <freeze|errors|ci> [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['contract', 'freeze', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform contract <freeze|errors|ci> [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['contract', 'errors', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform contract <freeze|errors|ci> [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['contract', 'status'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform contract <freeze|errors|ci> [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane', 'slow'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform verify [--lane fast|runtime|all] [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform verify [--lane fast|runtime|all] [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['verify', 'fast'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform verify [--lane fast|runtime|all] [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane', 'fast', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform verify [--lane fast|runtime|all] [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['verify', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform verify [--lane fast|runtime|all] [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['verify', '--json', '--compact', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform verify [--lane fast|runtime|all] [--json [--compact]]')
    });
    await expect(runCli(workspaceRoot, ['resolve', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr('Usage: platform resolve')
    });
  });
});
