import { expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  applyViewMutations,
  type ViewMutationReport
} from '../../platform/compiler/workbench/apply-view-mutations.ts';
import { loadWorkspacePlan } from '../../platform/compiler/parse/load-plan.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { PhysicalNoFollowError } from '../../platform/shared/physical-no-follow.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function planYaml(name: string): string {
  return [
    'app:',
    '  id: test-app',
    `  name: ${name}`,
    '  stack: nextjs-ts-prisma-sqlite',
    '  packageManager: pnpm',
    '  mode: single-tenant',
    'registry:',
    '  sources: []',
    'blocks: []',
    'slots: []',
    'acceptance: []',
    ''
  ].join('\n');
}

function renameMutation(value: string): string {
  return `${JSON.stringify({
    formatVersion: '1',
    mutations: [{ id: 'rename', kind: 'set-app-name', value }]
  })}\n`;
}

async function prepareCanonicalPlan(workspaceRoot: string): Promise<ReturnType<typeof getWorkspacePaths>> {
  const paths = getWorkspacePaths(workspaceRoot);
  await fs.mkdir(path.dirname(paths.planPath), { recursive: true });
  await fs.writeFile(paths.planPath, planYaml('Before'), 'utf8');
  return paths;
}

test('ordinary retained Workbench mutations update canonical Plan and emit the canonical report', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const paths = await prepareCanonicalPlan(workspaceRoot);
    await fs.mkdir(paths.sourceViewMutationsRoot, { recursive: true });
    await fs.writeFile(
      path.join(paths.sourceViewMutationsRoot, 'rename.json'),
      renameMutation('After'),
      'utf8'
    );

    let fenceCalls = 0;
    const report = await applyViewMutations(workspaceRoot, async () => {
      fenceCalls += 1;
    });

    expect(report.status).toBe('applied');
    expect(report.mutationFileCount).toBe(1);
    expect(report.mutationCount).toBe(1);
    expect(report.appliedCount).toBe(1);
    expect((await loadWorkspacePlan(workspaceRoot)).app.name).toBe('After');
    expect(JSON.parse(await fs.readFile(paths.viewMutationReportPath, 'utf8')) as ViewMutationReport)
      .toEqual(report);
    expect(fenceCalls).toBeGreaterThanOrEqual(4);
  });
});

test('a linked Workbench mutation root is rejected instead of importing commands through it', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const paths = await prepareCanonicalPlan(workspaceRoot);
    await fs.mkdir(path.dirname(paths.sourceViewMutationsRoot), { recursive: true });
    const externalMutationRoot = path.join(workspaceRoot, 'external-mutations');
    await fs.mkdir(externalMutationRoot, { recursive: true });
    await fs.writeFile(path.join(externalMutationRoot, 'rename.json'), renameMutation('Outside'), 'utf8');
    await fs.symlink(
      externalMutationRoot,
      paths.sourceViewMutationsRoot,
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    try {
      await applyViewMutations(workspaceRoot, async () => undefined);
    } catch (error) {
      expect(error).toBeInstanceOf(PhysicalNoFollowError);
      expect((error as PhysicalNoFollowError).code).toBe('PHYSICAL_NO_FOLLOW_UNSAFE_PATH');
      expect((await loadWorkspacePlan(workspaceRoot)).app.name).toBe('Before');
      return;
    }
    throw new Error('Expected linked Workbench mutation root to be rejected.');
  });
});

test('a link entry anywhere inside the Workbench mutation tree fails closed', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const paths = await prepareCanonicalPlan(workspaceRoot);
    await fs.mkdir(paths.sourceViewMutationsRoot, { recursive: true });
    await fs.writeFile(path.join(paths.sourceViewMutationsRoot, 'rename.json'), renameMutation('After'), 'utf8');

    const externalDirectory = path.join(workspaceRoot, 'external-link-target');
    await fs.mkdir(externalDirectory, { recursive: true });
    await fs.symlink(
      externalDirectory,
      path.join(paths.sourceViewMutationsRoot, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    await expect(applyViewMutations(workspaceRoot, async () => undefined))
      .rejects.toMatchObject({ code: 'WORKBENCH-MUTATION-011' });
    expect((await loadWorkspacePlan(workspaceRoot)).app.name).toBe('Before');
  });
});

test('an oversized Workbench mutation file is rejected before JSON command execution', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const paths = await prepareCanonicalPlan(workspaceRoot);
    await fs.mkdir(paths.sourceViewMutationsRoot, { recursive: true });
    await fs.writeFile(
      path.join(paths.sourceViewMutationsRoot, 'oversized.json'),
      renameMutation('x'.repeat(1024 * 1024)),
      'utf8'
    );

    await expect(applyViewMutations(workspaceRoot, async () => undefined))
      .rejects.toMatchObject({ code: 'WORKBENCH-MUTATION-012' });
    expect((await loadWorkspacePlan(workspaceRoot)).app.name).toBe('Before');
  });
});
