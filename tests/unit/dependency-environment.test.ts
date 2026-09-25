import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  cleanDependencyEnvironment,
  getDoctorReport
} from '../../src/adapters/toolchain/dependencies/environment.ts';
import {
  dependencyMaterializationLocations,
  disposeDependencyMaterializationCollection,
  disposeDependencyProviderCache
} from '../../src/adapters/toolchain/dependencies/runtime/materialization-location.ts';
import type { RuntimeStateEnvironment } from '../../src/adapters/runtime-state/workspace-state/layout.ts';
import { getWorkspacePaths } from "../../src/adapters/workspace-context.ts";
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

test('Runtime Cache materialization collection retirement is exact and idempotent', async () => {
  await withTempWorkspace(async (repositoryRoot) => {
    const environment: RuntimeStateEnvironment = Object.freeze({
      SEC_CACHE_HOME: path.join(repositoryRoot, '..', 'runtime-cache'),
      SEC_STATE_HOME: path.join(repositoryRoot, '..', 'runtime-state')
    });
    const locations = dependencyMaterializationLocations(repositoryRoot, environment);
    const generationRoot = path.join(locations.collectionRoot, 'a'.repeat(64));
    const foreignSibling = path.join(locations.cacheRoot, 'foreign-provider-cache');
    await fs.mkdir(path.join(generationRoot, 'node_modules'), { recursive: true });
    await fs.mkdir(foreignSibling, { recursive: true });
    await fs.writeFile(path.join(generationRoot, 'node_modules', 'content.bin'), 'materialized\n');
    await fs.writeFile(path.join(foreignSibling, 'keep.bin'), 'foreign\n');

    expect(disposeDependencyMaterializationCollection(repositoryRoot, environment)).toBe(true);
    await expect(fs.stat(locations.collectionRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(foreignSibling, 'keep.bin'), 'utf8')).toBe('foreign\n');
    expect(disposeDependencyMaterializationCollection(repositoryRoot, environment)).toBe(false);
  }, 'engineering-compiler-materialization-clean-');
});

test('Bun provider cache retirement cannot consume sibling Runtime Cache authority', async () => {
  await withTempWorkspace(async (repositoryRoot) => {
    const environment: RuntimeStateEnvironment = Object.freeze({
      SEC_CACHE_HOME: path.join(repositoryRoot, '..', 'runtime-cache'),
      SEC_STATE_HOME: path.join(repositoryRoot, '..', 'runtime-state')
    });
    const locations = dependencyMaterializationLocations(repositoryRoot, environment);
    const foreignSibling = path.join(path.dirname(locations.bunPackageCacheRoot), 'foreign-provider');
    await fs.mkdir(path.join(locations.bunPackageCacheRoot, 'package'), { recursive: true });
    await fs.mkdir(foreignSibling, { recursive: true });
    await fs.writeFile(path.join(locations.bunPackageCacheRoot, 'package', 'content.bin'), 'bun-cache\n');
    await fs.writeFile(path.join(foreignSibling, 'keep.bin'), 'foreign\n');

    expect(disposeDependencyProviderCache(repositoryRoot, environment)).toBe(true);
    await expect(fs.stat(locations.bunPackageCacheRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(foreignSibling, 'keep.bin'), 'utf8')).toBe('foreign\n');
    expect(disposeDependencyProviderCache(repositoryRoot, environment)).toBe(false);
  }, 'engineering-compiler-provider-cache-clean-');
});
