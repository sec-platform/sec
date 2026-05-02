import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'bun:test';

import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
import { readJson, writeJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import type {
  PlanFile
} from '../../platform/shared/types.ts';
import { readYaml } from '../../platform/shared/yaml.ts';
import { expectCliJson, expectCliSuccess, expectCliText, runCliInProcess as runCli, runCliPipeline } from '../helpers/cli-helpers.ts';
import { installPrivateBannerBlock } from '../helpers/private-registry-fixtures.ts';
import { withTempWorkspace } from '../helpers/workspace-fixtures.ts';

type ViewMutationReportSnapshot = {
  formatVersion: string;
  status: string;
  mutationFileCount: number;
  mutationCount: number;
};

type WorkspaceLockSnapshot = {
  resolvedBlocks: Array<{ id: string; registrySourceId: string; registryKind: string; registryLocation: string }>;
};

type WorkspacePathsSnapshot = ReturnType<typeof getWorkspacePaths>;

function developerSourceLayerDirectories(paths: WorkspacePathsSnapshot): string[] {
  return [
    paths.developerSourceRoot,
    paths.sourceSlotsRoot,
    paths.sourceOverridesRoot,
    paths.sourcePoliciesRoot,
    paths.sourceAcceptanceRoot,
    paths.sourceAssetsRoot,
    paths.sourcePrivateRegistryRoot,
    paths.sourceViewsRoot,
    paths.sourceViewMutationsRoot,
    paths.sourceEnvRoot
  ];
}

async function expectDirectoriesExist(directories: readonly string[]): Promise<void> {
  for (const directory of directories) {
    await expect(fs.stat(directory)).resolves.toMatchObject({});
  }
}

test('CLI accepts init commands', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliSuccess(workspaceRoot, ['init'], 'Initialized project workspace\n');
    await expectCliSuccess(workspaceRoot, ['init', '--reset'], 'Initialized project workspace\n');
  });
});

test('CLI init creates the developer source layer', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliSuccess(workspaceRoot, ['init', '--reset'], 'Initialized project workspace\n');

    const paths = getWorkspacePaths(workspaceRoot);
    await expectDirectoriesExist(developerSourceLayerDirectories(paths));
  });
});

test('CLI applies Workbench view mutations back to source app plan', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliSuccess(workspaceRoot, ['init', '--reset'], 'Initialized project workspace\n');

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

    await expectCliText(workspaceRoot, ['workbench', 'mutations', 'apply'], [
      'Workbench mutations applied; files=1; applied=3; skipped=0',
      'target: source/app.yaml'
    ]);

    const plan = await readYaml<PlanFile>(paths.planPath);
    expect(plan.app.name).toBe('field-service-admin');
    expect(plan.acceptance.map((entry) => entry.id)).toContain('view_can_update_workspace_name');
    expect(plan.slots.find((slot) => slot.id === 'customer_normalizer')?.description).toBe('Workbench-edited slot description.');

    await expectCliJson(
      workspaceRoot,
      ['workbench', 'mutations', 'apply', '--json', '--compact'],
      {
        formatVersion: '1',
        status: 'skipped',
        sourceRoot: 'source/views/mutations',
        targetPath: 'source/app.yaml',
        mutationFileCount: 1,
        mutationCount: 3,
        appliedCount: 0,
        skippedCount: 3
      },
      { compact: true }
    );

    const report = await readJson<ViewMutationReportSnapshot>(paths.viewMutationReportPath);
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
    await expectCliSuccess(workspaceRoot, ['init', '--reset'], 'Initialized project workspace\n');

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
    expect(result.stderr).toContain(`"${CI_ARTIFACT_FILES.viewMutationReport}"`);
  });
});

test('CLI defaults verification to the fast lane', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await runCliPipeline(workspaceRoot);

    await expectCliText(workspaceRoot, ['verify'], ['Verification passed (fast)\n']);
  });
});

test('CLI adds private registry blocks and preserves registry metadata on resolve', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliSuccess(workspaceRoot, ['init', '--reset'], 'Initialized project workspace\n');
    await installPrivateBannerBlock(workspaceRoot);
    const { lockPath, planPath } = getWorkspacePaths(workspaceRoot);

    await expectCliSuccess(
      workspaceRoot,
      ['add', 'private/banner-basic'],
      'Added block private/banner-basic@0.1.0 from private (private)\n'
    );
    await expect(fs.readFile(planPath, 'utf8')).resolves.toContain('private/banner-basic');

    await expectCliSuccess(workspaceRoot, ['resolve'], 'Resolved 4 blocks\n');
    const lock = await readJson<WorkspaceLockSnapshot>(lockPath);
    expect(lock.resolvedBlocks.find((block) => block.id === 'private/banner-basic')).toMatchObject({
      registrySourceId: 'private',
      registryKind: 'private',
      registryLocation: 'workspace'
    });
  });
});
