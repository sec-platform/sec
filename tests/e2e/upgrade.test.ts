import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { upgradeWorkspace } from '../../src/change-management/upgrade/orchestration.ts';
import { writeJson } from '../../src/workspace/files.ts';
import { getWorkspacePaths } from '../../src/workspace/paths.ts';
import type { ExplainGraph } from '../../src/semantic/projection/contract/explain.ts';
import type { UpgradeDiagnostics, UpgradePlan } from '../../src/change-management/upgrade/contract/types.ts';
import { writeYaml } from '../../src/workspace/yaml.ts';
import { writeSlotUpgradeFixture } from '../helpers/slot-upgrade-fixtures.ts';
import { writePassingVerificationState } from '../helpers/verification-fixtures.ts';
import {
  expectCliJson,
  expectCliSuccess,
  expectCliText,
  runCliInProcess as runCli,
  runCliPipeline
} from '../testkit/cli.ts';
import { withTempWorkspace, withWorkspaceScenario } from '../testkit/workspace.ts';

test('CLI emits text migration operation details in upgrade summaries', async () => {
  await withWorkspaceScenario('empty-default', async (workspaceRoot) => {
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
      stackProfiles: ['typescript-library'],
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
}, 120000);

test('upgrade apply publishes one coherent version transition and preserves the migrated project target', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeSlotUpgradeFixture(workspaceRoot);
    const paths = getWorkspacePaths(workspaceRoot);
    const slotTarget = path.join(paths.projectRoot, 'custom', 'customer_normalizer.ts');
    const inheritedInstallSource = path.join(
      paths.privateRegistryRoot,
      'private.slot-contract',
      'files',
      'src',
      'installed',
      'private',
      'slot-contract.ts'
    );
    const originalTarget = 'export function normalizeCustomer(input: CustomerInputV1): CustomerRecordInput { return input; }\n';
    await fs.mkdir(path.dirname(inheritedInstallSource), { recursive: true });
    await fs.writeFile(inheritedInstallSource, 'export const slotContract = true;\n', 'utf8');
    await fs.mkdir(path.dirname(slotTarget), { recursive: true });
    await fs.writeFile(slotTarget, originalTarget, 'utf8');

    const result = await upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0');

    expect(result.plan.blocks).toContainEqual({ id: 'private/slot-contract', version: '0.2.0' });
    expect(result.lock.resolvedBlocks).toContainEqual(expect.objectContaining({
      id: 'private/slot-contract',
      version: '0.2.0'
    }));
    expect(result.upgradePlan).toMatchObject({
      blockId: 'private/slot-contract',
      fromVersion: '0.1.0',
      toVersion: '0.2.0',
      status: 'applied',
      migrationKindCounts: { 'slot-contract-update': 1 }
    });
    expect(result.upgradePlan.migrationOperations).toContainEqual(expect.objectContaining({
      id: 'mig-customer-normalizer-contract',
      kind: 'slot-contract-update',
      target: 'custom/customer_normalizer.ts',
      inputType: 'CustomerInputV2'
    }));
    await expect(fs.readFile(slotTarget, 'utf8')).resolves.toBe(originalTarget);

    const persistedPlan = JSON.parse(await fs.readFile(paths.upgradePlanPath, 'utf8')) as UpgradePlan;
    expect(persistedPlan).toEqual(result.upgradePlan);
  });
}, 180000);
