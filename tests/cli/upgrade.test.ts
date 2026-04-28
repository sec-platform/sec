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

test('CLI emits text migration operation details in upgrade summaries', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });

    const { privateRegistryRoot, projectRoot } = getWorkspacePaths(workspaceRoot);
    const blockRoot = path.join(privateRegistryRoot, 'private.text-upgrade');
    const versionRoot = path.join(blockRoot, 'versions', '0.2.0');
    await fs.mkdir(path.join(blockRoot, 'files', 'src', 'installed', 'private'), { recursive: true });
    await fs.mkdir(path.join(versionRoot, 'files', 'src', 'installed', 'private'), { recursive: true });
    await fs.mkdir(path.join(versionRoot, 'migrations'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, 'docs'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, 'generated', 'reports', 'current'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'docs', 'upgrade-notes.md'), 'status: pending\n', 'utf8');
    await fs.writeFile(path.join(projectRoot, 'generated', 'reports', 'current', 'summary.json'), '{}\n', 'utf8');
    await fs.writeFile(
      path.join(blockRoot, 'files', 'src', 'installed', 'private', 'text-upgrade.ts'),
      'export const TEXT_UPGRADE_BLOCK_VERSION = \'0.1.0\';\n',
      'utf8'
    );
    await fs.writeFile(
      path.join(versionRoot, 'files', 'src', 'installed', 'private', 'text-upgrade.ts'),
      'export const TEXT_UPGRADE_BLOCK_VERSION = \'0.2.0\';\n',
      'utf8'
    );
    const baseManifest = {
      id: 'private/text-upgrade',
      version: '0.1.0',
      kind: 'governance',
      stackProfiles: ['nextjs-ts-prisma-sqlite'],
      requires: [],
      provides: ['private/text-upgrade'],
      conflicts: [],
      installs: [
        {
          kind: 'copy',
          from: 'files/src/installed/private/text-upgrade.ts',
          to: 'src/installed/private/text-upgrade.ts'
        }
      ],
      pins: {
        inputs: [],
        outputs: []
      },
      slots: [],
      acceptance: [],
      routes: []
    };
    await writeYaml(path.join(blockRoot, 'block.manifest.yaml'), baseManifest);
    await writeYaml(path.join(versionRoot, 'block.manifest.yaml'), {
      ...baseManifest,
      version: '0.2.0',
      upgrade: {
        from: ['0.1.x'],
        migrations: [
          {
            id: 'mig-upgrade-notes-regex',
            kind: 'text-replace-regex',
            entry: 'migrations/upgrade-notes-regex.json',
            fromVersion: '0.1.0',
            toVersion: '0.2.0',
            requiresVerification: true
          },
          {
            id: 'mig-report-directory-archive',
            kind: 'rename-directory',
            entry: 'migrations/report-directory-archive.json',
            fromVersion: '0.1.0',
            toVersion: '0.2.0',
            requiresVerification: false
          }
        ]
      }
    });
    await writeJson(path.join(versionRoot, 'migrations', 'upgrade-notes-regex.json'), {
      id: 'mig-upgrade-notes-regex',
      kind: 'text-replace-regex',
      reason: 'Replace upgrade notes marker.',
      target: 'docs/upgrade-notes.md',
      pattern: 'status: pending',
      replacement: 'status: applied',
      flags: 'g'
    });
    await writeJson(path.join(versionRoot, 'migrations', 'report-directory-archive.json'), {
      id: 'mig-report-directory-archive',
      kind: 'rename-directory',
      reason: 'Archive generated reports directory.',
      source: 'generated/reports/current',
      target: 'generated/reports/archive/current'
    });
    await expect(runCli(workspaceRoot, ['add', 'private/text-upgrade'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Added block private/text-upgrade@0.1.0 from private (private)\n',
      stderr: ''
    });

    const textResult = await runCli(workspaceRoot, ['upgrade', 'private/text-upgrade', '0.2.0', '--dry-run']);

    expect(textResult.code).toBe(0);
    expect(textResult.stderr).toBe('');
    expect(textResult.stdout).toContain('Operation roles: directory=1, text=1');
    expect(textResult.stdout).toContain('Migration mig-upgrade-notes-regex: text-replace-regex;');
    expect(textResult.stdout).toContain(
      'target=docs/upgrade-notes.md; role=text; replacementLength=15; pattern=status: pending; flags=g; requiresVerification=true'
    );
    expect(textResult.stdout).toContain('Migration mig-report-directory-archive: rename-directory;');
    expect(textResult.stdout).toContain(
      'target=generated/reports/archive/current; source=generated/reports/current; role=directory; requiresVerification=false'
    );
  });
});

test('CLI emits upgrade dry-run JSON for CI consumers', async () => {
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
    expect(textResult.stdout).toContain('Operation roles: file=1, json=1');
    expect(textResult.stdout).toContain(
      'Impacts: src/installed/auth/session.ts, upgrade.metadata.json'
    );
    expect(textResult.stdout).toContain('Preflight evidence: 10');
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
    expect(result.stdout).toContain('\n  "blockId": "auth/basic-session"');
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

    const compactResult = await runCli(workspaceRoot, [
      'upgrade',
      'auth/basic-session',
      '0.1.1',
      '--dry-run',
      '--json',
      '--compact'
    ]);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout).not.toContain('\n  "blockId"');
    expect(JSON.parse(compactResult.stdout)).toEqual(upgradePlan);

    const inspectText = await runCli(workspaceRoot, ['upgrade', 'plan']);
    expect(inspectText.code).toBe(0);
    expect(inspectText.stderr).toBe('');
    expect(inspectText.stdout).toContain('Upgrade auth/basic-session 0.1.0 -> 0.1.1 (dry-run)');
    expect(inspectText.stdout).toContain('Operation roles: file=1, json=1');

    const inspectJson = await runCli(workspaceRoot, ['upgrade', 'plan', '--json', '--compact']);
    expect(inspectJson.code).toBe(0);
    expect(inspectJson.stderr).toBe('');
    expect(inspectJson.stdout).not.toContain('\n  "blockId"');
    expect(JSON.parse(inspectJson.stdout)).toEqual(upgradePlan);

    await withTempWorkspace(async (missingPlanWorkspace) => {
      await expect(runCli(missingPlanWorkspace, ['upgrade', 'plan'])).resolves.toMatchObject({
        code: 1,
        stdout: '',
        stderr: expect.stringContaining(
          'Upgrade plan not found; run platform upgrade <block-id> <target-version> --dry-run first'
        )
      });
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

    const { lockPath, upgradeDiagnosticsPath, verificationReportPath } = getWorkspacePaths(workspaceRoot);
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
        `preflight checks: ${upgradePlan.preflightChecks.length}`,
        'preflight evidence: 10',
        'impacts: 2',
        'operations: 2',
        'operation roles: file=1, json=1',
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
      graph: ExplainGraph;
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
          sourceMigrationCount: number;
          slotMigrationCount: number;
          verificationSummaries: Array<{ id: string; count: number }>;
          preflightSummaries: Array<{ group: string; checkCount: number; evidenceCount: number }>;
          migrationSummaries: Array<{
            id: string;
            kind: string;
            source?: string;
            target: string;
            requiresVerification: boolean;
          }>;
          migrationOperationCount: number;
          migrationOperationSummaries: Array<{
            id: string;
            kind: string;
            target: string;
            role: string;
            source?: string;
            path?: string[];
            itemCount?: number;
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
      sourceMigrationCount: 1,
      slotMigrationCount: 0,
      migrationOperationCount: 2,
      migrationOperationSummaries: [
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
      ],
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

    const graphText = await runCli(workspaceRoot, ['explain', 'graph']);
    expect(graphText.code).toBe(0);
    expect(graphText.stderr).toBe('');
    expect(graphText.stdout).toContain('Explain graph ');
    expect(graphText.stdout).toContain('Node types:');
    expect(graphText.stdout).toContain('Edge types:');
    expect(graphText.stdout).toContain('Coverage overlay:');
    expect(graphText.stdout).toContain('Provenance overlay:');

    const graphJson = await runCli(workspaceRoot, ['explain', 'graph', '--json', '--compact']);
    expect(graphJson.code).toBe(0);
    expect(graphJson.stderr).toBe('');
    expect(graphJson.stdout).not.toContain('\n  "nodes"');
    const graphPayload = JSON.parse(graphJson.stdout) as ExplainGraph;
    expect(graphPayload.nodes).toEqual(explainPayload.graph.nodes);
    expect(graphPayload.edges).toEqual(explainPayload.graph.edges);

    const upgradeDiagnostics: UpgradeDiagnostics = {
      formatVersion: '1',
      status: 'blocked',
      phase: 'apply',
      blockId: 'auth/basic-session',
      targetVersion: '0.1.1',
      failedCheck: 'migration-file-operations',
      errorCode: 'UPGRADE-MIGRATION-016',
      message: 'file-replace target "src/installed/auth/session.ts" is missing',
      details: {
        migrationId: 'mig-auth-session-refresh',
        migrationKind: 'file-replace',
        target: 'src/installed/auth/session.ts',
        source: 'files/src/installed/auth/session.ts',
        rollbackStatus: 'restored'
      }
    };
    await writeJson(upgradeDiagnosticsPath, upgradeDiagnostics);

    const upgradeDiagnosticsText = await runCli(workspaceRoot, ['upgrade', 'diagnostics']);
    expect(upgradeDiagnosticsText.code).toBe(0);
    expect(upgradeDiagnosticsText.stderr).toBe('');
    expect(upgradeDiagnosticsText.stdout).toContain('Upgrade diagnostics apply');
    expect(upgradeDiagnosticsText.stdout).toContain('Failed check: migration-file-operations; code: UPGRADE-MIGRATION-016');
    expect(upgradeDiagnosticsText.stdout).toContain(
      'Attribution: migration=mig-auth-session-refresh, kind=file-replace, target=src/installed/auth/session.ts, source=files/src/installed/auth/session.ts, rollback=restored'
    );

    const upgradeDiagnosticsJson = await runCli(workspaceRoot, ['upgrade', 'diagnostics', '--json', '--compact']);
    expect(upgradeDiagnosticsJson.code).toBe(0);
    expect(upgradeDiagnosticsJson.stderr).toBe('');
    expect(upgradeDiagnosticsJson.stdout).not.toContain('\n  "formatVersion"');
    expect(JSON.parse(upgradeDiagnosticsJson.stdout)).toEqual(upgradeDiagnostics);

    await withTempWorkspace(async (missingDiagnosticsWorkspace) => {
      await expect(runCli(missingDiagnosticsWorkspace, ['upgrade', 'diagnostics'])).resolves.toMatchObject({
        code: 1,
        stdout: '',
        stderr: expect.stringContaining(
          'Upgrade diagnostics not found; run platform upgrade <block-id> <target-version> --dry-run first'
        )
      });
    });

    const blockedExplainText = await runCli(workspaceRoot, ['explain']);
    expect(blockedExplainText.code).toBe(0);
    expect(blockedExplainText.stderr).toBe('');
    expect(blockedExplainText.stdout).toContain(
      'Upgrade diagnostics: apply; migration-file-operations; UPGRADE-MIGRATION-016; file-replace target "src/installed/auth/session.ts" is missing; attribution: migration=mig-auth-session-refresh, kind=file-replace, target=src/installed/auth/session.ts, source=files/src/installed/auth/session.ts, rollback=restored'
    );
  });
});
