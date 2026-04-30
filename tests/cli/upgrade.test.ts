import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';

import { writeJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import type {
  ExplainGraph,
  UpgradeDiagnostics,
  UpgradePlan
} from '../../platform/shared/types.ts';
import { writeYaml } from '../../platform/shared/yaml.ts';
import {
  expectCliJson,
  expectCliSuccess,
  expectCliText,
  runCliInProcess as runCli,
  runCliPipeline
} from '../helpers/cli-helpers.ts';
import { writePassingVerificationState } from '../helpers/verification-fixtures.ts';
import { withTempWorkspace } from '../helpers/workspace-fixtures.ts';

test('CLI emits text migration operation details in upgrade summaries', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliSuccess(workspaceRoot, ['init', '--reset'], 'Initialized project workspace\n');

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
    await expectCliSuccess(
      workspaceRoot,
      ['add', 'private/text-upgrade'],
      'Added block private/text-upgrade@0.1.0 from private (private)\n'
    );

    await expectCliText(workspaceRoot, ['upgrade', 'private/text-upgrade', '0.2.0', '--dry-run'], [
      'Operation roles: directory=1, text=1',
      'Migration mig-upgrade-notes-regex: text-replace-regex;',
      'target=docs/upgrade-notes.md; role=text; replacementLength=15; pattern=status: pending; flags=g; requiresVerification=true',
      'Migration mig-report-directory-archive: rename-directory;',
      'target=generated/reports/archive/current; source=generated/reports/current; role=directory; requiresVerification=false'
    ]);
  });
});

test('CLI emits upgrade dry-run JSON for CI consumers', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliSuccess(workspaceRoot, ['init', '--reset'], 'Initialized project workspace\n');
    await expectCliText(workspaceRoot, [
      'upgrade',
      'auth/basic-session',
      '0.1.1',
      '--dry-run'
    ], [
      'Upgrade auth/basic-session 0.1.0 -> 0.1.1 (dry-run)',
      'Status: planned; migrations: 2; preflight checks:',
      'Migration kinds: file-replace=1, json-array-append=1',
      'Operation roles: file=1, json=1',
      'Impacts: src/installed/auth/session.ts, upgrade.metadata.json',
      'Preflight evidence: 10',
      'Requires verification: true (1 migrations)',
      'Migration mig-auth-session-refresh: file-replace;',
      'target=src/installed/auth/session.ts; source=files/src/installed/auth/session.ts; role=file; requiresVerification=true',
      'Migration mig-auth-session-upgrade-metadata: json-array-append;',
      'target=upgrade.metadata.json; role=json; path=upgradedBlocks; items=1; requiresVerification=false',
      'Preflight version-range: passed; evidence=',
      'Preflight migration-entries: passed; evidence='
    ]);

    const upgradePlan = await expectCliJson<UpgradePlan>(
      workspaceRoot,
      [
        'upgrade',
        'auth/basic-session',
        '0.1.1',
        '--dry-run',
        '--json'
      ],
      undefined,
      { stdoutMarkers: ['\n  "blockId": "auth/basic-session"'] }
    );
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

    const compactResult = await expectCliJson<UpgradePlan>(
      workspaceRoot,
      [
        'upgrade',
        'auth/basic-session',
        '0.1.1',
        '--dry-run',
        '--json',
        '--compact'
      ],
      undefined,
      { compact: true }
    );
    expect(compactResult).toEqual(upgradePlan);

    await expectCliText(workspaceRoot, ['upgrade', 'plan'], [
      'Upgrade auth/basic-session 0.1.0 -> 0.1.1 (dry-run)',
      'Operation roles: file=1, json=1'
    ]);

    const inspectJson = await expectCliJson<UpgradePlan>(
      workspaceRoot,
      ['upgrade', 'plan', '--json', '--compact'],
      undefined,
      { compact: true }
    );
    expect(inspectJson).toEqual(upgradePlan);

    await withTempWorkspace(async (missingPlanWorkspace) => {
      await expect(runCli(missingPlanWorkspace, ['upgrade', 'plan'])).resolves.toMatchObject({
        code: 1,
        stdout: '',
        stderr: expect.stringContaining(
          'Upgrade plan not found; run platform upgrade <block-id> <target-version> --dry-run first'
        )
      });
    });

    await runCliPipeline(workspaceRoot, { init: false, verifyLane: 'fast' });

    const { upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
    await writePassingVerificationState(workspaceRoot);

    await expectCliSuccess(workspaceRoot, ['lock'], 'Locked project\n');

    await expectCliText(workspaceRoot, ['explain'], [
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
    ]);

    const explainPayload = await expectCliJson<{
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
    }>(workspaceRoot, ['explain', '--json']);
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

    await expectCliText(workspaceRoot, ['explain', 'graph'], [
      'Explain graph ',
      'Node types:',
      'Edge types:',
      'Coverage overlay:',
      'Provenance overlay:'
    ]);

    const graphPayload = await expectCliJson<ExplainGraph>(
      workspaceRoot,
      ['explain', 'graph', '--json', '--compact'],
      undefined,
      { compact: true }
    );
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

    await expectCliText(workspaceRoot, ['upgrade', 'diagnostics'], [
      'Upgrade diagnostics apply',
      'Failed check: migration-file-operations; code: UPGRADE-MIGRATION-016',
      'Attribution: migration=mig-auth-session-refresh, kind=file-replace, target=src/installed/auth/session.ts, source=files/src/installed/auth/session.ts, rollback=restored'
    ]);

    const upgradeDiagnosticsJson = await expectCliJson<UpgradeDiagnostics>(
      workspaceRoot,
      ['upgrade', 'diagnostics', '--json', '--compact'],
      undefined,
      { compact: true }
    );
    expect(upgradeDiagnosticsJson).toEqual(upgradeDiagnostics);

    await withTempWorkspace(async (missingDiagnosticsWorkspace) => {
      await expect(runCli(missingDiagnosticsWorkspace, ['upgrade', 'diagnostics'])).resolves.toMatchObject({
        code: 1,
        stdout: '',
        stderr: expect.stringContaining(
          'Upgrade diagnostics not found; run platform upgrade <block-id> <target-version> --dry-run first'
        )
      });
    });

    await expectCliText(workspaceRoot, ['explain'], [
      'Upgrade diagnostics: apply; migration-file-operations; UPGRADE-MIGRATION-016; file-replace target "src/installed/auth/session.ts" is missing; attribution: migration=mig-auth-session-refresh, kind=file-replace, target=src/installed/auth/session.ts, source=files/src/installed/auth/session.ts, rollback=restored'
    ]);
  });
});
