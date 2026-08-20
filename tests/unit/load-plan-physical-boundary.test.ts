import { expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { loadWorkspacePlan } from '../../platform/compiler/parse/load-plan.ts';
import { resolveWorkspacePlanPath } from '../../platform/shared/paths.ts';
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

test('workspace plan prefers a physical canonical source and only falls back when canonical is truly absent', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const sourceRoot = path.join(workspaceRoot, 'source');
    const projectRoot = path.join(workspaceRoot, 'project');
    await fs.mkdir(sourceRoot, { recursive: true });
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'app.plan.yaml'), planYaml('Legacy'), 'utf8');

    expect((await loadWorkspacePlan(workspaceRoot)).app.name).toBe('Legacy');

    await fs.writeFile(path.join(sourceRoot, 'app.yaml'), planYaml('Canonical'), 'utf8');
    expect((await loadWorkspacePlan(workspaceRoot)).app.name).toBe('Canonical');
  });
});

test('unsafe canonical Plan ancestry blocks instead of silently falling back to legacy authority', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const projectRoot = path.join(workspaceRoot, 'project');
    const externalCanonicalRoot = path.join(workspaceRoot, 'external-canonical');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(externalCanonicalRoot, { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'app.plan.yaml'), planYaml('Legacy'), 'utf8');

    await fs.symlink(
      externalCanonicalRoot,
      path.join(workspaceRoot, 'source'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    try {
      await loadWorkspacePlan(workspaceRoot);
    } catch (error) {
      expect(error).toBeInstanceOf(PhysicalNoFollowError);
      expect((error as PhysicalNoFollowError).code).toBe('PHYSICAL_NO_FOLLOW_UNSAFE_PATH');
      return;
    }
    throw new Error('Expected unsafe canonical Plan ancestry to block legacy fallback.');
  });
});

test('a dangling canonical Plan entry keeps canonical precedence over a valid legacy Plan', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const sourceRoot = path.join(workspaceRoot, 'source');
    const projectRoot = path.join(workspaceRoot, 'project');
    await fs.mkdir(sourceRoot, { recursive: true });
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'app.plan.yaml'), planYaml('Legacy'), 'utf8');

    const canonicalPath = path.join(sourceRoot, 'app.yaml');
    await fs.symlink(path.join(workspaceRoot, 'missing-plan.yaml'), canonicalPath, 'file');

    expect(await resolveWorkspacePlanPath(workspaceRoot)).toBe(canonicalPath);
    expect(() => loadWorkspacePlan(workspaceRoot))
      .toThrow(expect.objectContaining({ code: 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH' }));
  });
});
