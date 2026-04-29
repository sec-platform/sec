import { expect, test } from 'vitest';

import {
  RUNTIME_USAGE,
  WORKBENCH_USAGE
} from '../../platform/cli/usage.ts';
import { expectAcceptanceUsageError, expectLockUsageError, expectPolicyUsageError, expectPostgresUsageError, expectRepairUsageError, runCliInProcess as runCli, usageErrorStderr, withTempWorkspace } from '../helpers/test-utils.ts';

test('CLI prints usage for missing or unknown commands', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    for (const args of [[], ['unknown'], ['unknown', '--flag']]) {
      const result = await runCli(workspaceRoot, args);
      expect(result).toMatchObject({
        code: 0,
        stderr: ''
      });
      expect(result.stdout).toContain('Usage: platform');
      expect(result.stdout).toContain('init');
      expect(result.stdout).toContain('resolve');
      expect(result.stdout).toContain('compose');
      expect(result.stdout).toContain('verify');
    }
  });
});

test('CLI reports argument usage errors', async () => {
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
    await expect(runCli(workspaceRoot, ['workbench'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr(WORKBENCH_USAGE)
    });
    await expect(runCli(workspaceRoot, ['workbench', 'mutations'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr(WORKBENCH_USAGE)
    });
    await expect(runCli(workspaceRoot, ['workbench', 'mutations', 'apply', '--compact'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr(WORKBENCH_USAGE)
    });
    await expect(runCli(workspaceRoot, ['workbench', 'mutations', 'apply', '--json', '--compact', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: usageErrorStderr(WORKBENCH_USAGE)
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
