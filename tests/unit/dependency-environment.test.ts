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
    const paths = getWorkspacePaths(workspaceRoot);
    await Promise.all([
      fs.mkdir(paths.modelRoot, { recursive: true }),
      fs.mkdir(paths.srcRoot, { recursive: true }),
      fs.mkdir(paths.secRoot, { recursive: true })
    ]);
    const report = await getDoctorReport(workspaceRoot);
    const dependencyCheck = report.checks.find(({ id }) => id === 'runtime-dependencies');
    const rootsCheck = report.checks.find(({ id }) => id === 'workspace-roots');

    expect(dependencyCheck).toMatchObject({
      id: 'runtime-dependencies',
      status: report.dependencies.mode === 'warm-project' ? 'ok' : 'warn'
    });
    expect(rootsCheck).toEqual({
      id: 'workspace-roots',
      status: 'ok',
      message: 'Workspace roots exist: workspace, model, src, .sec.'
    });
    expect(report.dependencies.projectNodeModules.path).toBe(
      path.join(paths.workspaceRoot, 'node_modules')
    );
  }, 'engineering-compiler-dependency-doctor-');
});

test('project dependency cleanup stays within the selected workspace owner root', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { workspaceRoot: targetWorkspaceRoot } = getWorkspacePaths(workspaceRoot);
    const projectNodeModules = path.join(targetWorkspaceRoot, 'node_modules');
    const projectStamp = path.join(targetWorkspaceRoot, '.runtime-deps.stamp.json');
    await fs.mkdir(projectNodeModules, { recursive: true });
    await fs.writeFile(projectStamp, '{}\n', 'utf8');

    const targets = await cleanDependencyEnvironment(
      workspaceRoot,
      { project: true, force: true }
    );

    expect(targets).toContain(projectNodeModules);
    expect(targets).toContain(projectStamp);
    expect(targets.every((target) => path.relative(targetWorkspaceRoot, target)
      .split(path.sep).every((segment) => segment !== '..'))).toBe(true);
    await expect(fs.stat(projectNodeModules)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(projectStamp)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 'engineering-compiler-dependency-clean-');
});
