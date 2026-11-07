import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { writeJson } from "../../../src/adapters/filesystem/files.ts";
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../../../src/adapters/workspace-context.ts";
import { readYaml, writeYaml } from '../../../src/adapters/workspace/yaml.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import {
  expectCliSuccess,
  expectCliText,
  runCliInProcess,
} from '../../testkit/cli.ts';
import { withWorkspaceScenario } from '../../testkit/workspace.ts';

test('CLI emits text migration operation details in upgrade summaries', async () => {
  await withWorkspaceScenario('empty-default', async (workspaceRoot) => {
    const { privateRegistryRoot } = getWorkspacePaths(workspaceRoot);
    const projectRoot = workspaceRoot;
    const blockRoot = path.join(privateRegistryRoot, 'private.text-upgrade');
    const versionRoot = path.join(blockRoot, 'versions', '0.2.0');
    await fs.mkdir(path.join(blockRoot, 'files', 'src', 'installed', 'private'), { recursive: true });
    await fs.mkdir(path.join(versionRoot, 'files', 'src', 'installed', 'private'), { recursive: true });
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
      acceptance: []
    };
    await writeYaml(path.join(blockRoot, 'block.manifest.yaml'), baseManifest);
    await writeYaml(path.join(versionRoot, 'block.manifest.yaml'), {
      ...baseManifest,
      version: '0.2.0',
      upgrade: {
        from: ['0.1.x'],
        migrations: [
          {
            id: 'mig-upgrade-notes-literal',
            kind: 'text-replace',
            entry: 'migrations/upgrade-notes-literal.json',
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
    await writeJson(path.join(versionRoot, 'migrations', 'upgrade-notes-literal.json'), {
      id: 'mig-upgrade-notes-literal',
      kind: 'text-replace',
      reason: 'Replace upgrade notes marker.',
      target: 'docs/upgrade-notes.md',
      search: 'status: pending',
      replacement: 'status: applied'
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

    const planPath = getWorkspacePaths(workspaceRoot).workspaceConfigPath;
    const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
    const beforePlan = await fs.readFile(planPath);
    const beforeLock = await fs.readFile(lockPath);
    const upgradePlanPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradePlan);

    await expectCliText(workspaceRoot, ['upgrade', 'private/text-upgrade', '0.2.0', '--dry-run'], [
      'Operation roles: directory=1, text=1',
      'Migration mig-upgrade-notes-literal: text-replace;',
      'target=docs/upgrade-notes.md; role=text; searchLength=15; replacementLength=15; requiresVerification=true',
      'Migration mig-report-directory-archive: rename-directory;',
      'target=generated/reports/archive/current; source=generated/reports/current; role=directory; requiresVerification=false'
    ]);

    // A successful preview and a rejected incompatible range must be read-only.
    expect(await fs.readFile(planPath)).toEqual(beforePlan);
    expect(await fs.readFile(lockPath)).toEqual(beforeLock);
    await expect(fs.lstat(upgradePlanPath)).rejects.toMatchObject({ code: 'ENOENT' });

    const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
    const manifest = await readYaml<Record<string, unknown>>(manifestPath);
    await writeYaml(manifestPath, {
      ...manifest,
      upgrade: { ...(manifest.upgrade as Record<string, unknown>), from: ['0.1'] }
    });
    const incompatible = await runCliInProcess(workspaceRoot, [
      'upgrade', 'private/text-upgrade', '0.2.0', '--dry-run'
    ]);
    expect(incompatible.code).toBe(1);
    expect(incompatible.stderr).toContain('UPGRADE-BLOCKED-002');
    expect(await fs.readFile(planPath)).toEqual(beforePlan);
    expect(await fs.readFile(lockPath)).toEqual(beforeLock);
    await expect(fs.lstat(upgradePlanPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeDiagnostics)))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });
}, 120000);
