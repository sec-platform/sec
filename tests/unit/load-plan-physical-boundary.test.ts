import { expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { loadWorkspacePlan } from '../../src/compiler/parse/load-plan.ts';
import { PhysicalNoFollowError } from '../../src/runtime-state/physical/runtime/physical-no-follow.ts';
import { resolveWorkspacePlanPath } from '../../src/workspace/runtime/paths.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function planYaml(name: string): string {
  return [
    'app:',
    '  id: test-app',
    `  name: ${name}`,
    '  stack: typescript-library',
    '  packageManager: pnpm',
    '  mode: single-tenant',
    'registry:',
    '  sources: []',
    'blocks: []',
    'acceptance: []',
    ''
  ].join('\n');
}

test('unsafe canonical Plan ancestry blocks before reading external bytes', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const externalPlanPath = path.join(workspaceRoot, 'external-plan.yaml');
    await fs.writeFile(externalPlanPath, planYaml('external-plan'), 'utf8');
    await fs.symlink(
      externalPlanPath,
      path.join(workspaceRoot, 'sec.yaml'),
      'file'
    );

    try {
      await loadWorkspacePlan(workspaceRoot);
    } catch (error) {
      expect(error).toBeInstanceOf(PhysicalNoFollowError);
      expect((error as PhysicalNoFollowError).code).toBe('PHYSICAL_NO_FOLLOW_UNSAFE_PATH');
      return;
    }
    throw new Error('Expected unsafe canonical Plan ancestry to block.');
  });
});

test('a dangling canonical Plan entry is rejected as unsafe authority', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const canonicalPath = path.join(workspaceRoot, 'sec.yaml');
    await fs.symlink(path.join(workspaceRoot, 'missing-plan.yaml'), canonicalPath, 'file');

    expect(await resolveWorkspacePlanPath(workspaceRoot)).toBe(canonicalPath);
    expect(() => loadWorkspacePlan(workspaceRoot))
      .toThrow(expect.objectContaining({ code: 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH' }));
  });
});
