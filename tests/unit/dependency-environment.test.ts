import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  cleanDependencyEnvironment,
  getDoctorReport
} from '../../src/toolchain/dependencies/environment.ts';
import { getWorkspacePaths } from '../../src/workspace/paths.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('dependency doctor projects the canonical dependency state without an external runtime probe', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const report = await getDoctorReport(workspaceRoot);
    const dependencyCheck = report.checks.find(({ id }) => id === 'runtime-dependencies');

    expect(dependencyCheck).toMatchObject({
      id: 'runtime-dependencies',
      status: report.dependencies.mode === 'warm-project' ? 'ok' : 'warn'
    });
  }, 'engineering-compiler-dependency-doctor-');
});

test('project dependency cleanup stays within the selected workspace owner root', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { projectRoot } = getWorkspacePaths(workspaceRoot);
    const projectNodeModules = path.join(projectRoot, 'node_modules');
    await fs.mkdir(projectNodeModules, { recursive: true });

    const targets = await cleanDependencyEnvironment(
      workspaceRoot,
      { project: true, force: true }
    );

    expect(targets).toContain(projectNodeModules);
    expect(targets.every((target) => path.relative(projectRoot, target)
      .split(path.sep).every((segment) => segment !== '..'))).toBe(true);
    await expect(fs.stat(projectNodeModules)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 'engineering-compiler-dependency-clean-');
});
