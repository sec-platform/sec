import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  cleanDependencyEnvironment,
  getDoctorReport
} from '../../platform/shared/dependency-environment.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

async function writeNodeRuntime(tempRoot: string): Promise<string> {
  const candidate = path.join(tempRoot, process.platform === 'win32' ? 'node.exe' : 'node');
  await fs.writeFile(candidate, 'node fixture\n', 'utf8');
  return fs.realpath(candidate);
}

function nodeProbe(nodeExecutablePath: string, version: string, bunVersion: string | null = null) {
  return {
    code: 0,
    stdout: JSON.stringify({
      bunVersion,
      executablePath: nodeExecutablePath,
      format: 'sec-external-node-runtime-v1',
      releaseName: 'node',
      version
    }),
    stderr: ''
  };
}

test('doctor reports the same verified external Node authority used by Playwright bootstrap', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const nodeExecutablePath = await writeNodeRuntime(workspaceRoot);
    const report = await getDoctorReport(workspaceRoot, {
      nodeRuntime: {
        commandRunner: async (command) => {
          expect(command).toBe(nodeExecutablePath);
          return nodeProbe(nodeExecutablePath, '24.15.0');
        },
        nodeExecutablePath
      },
      sharedDepsRoot: path.join(workspaceRoot, '.shared-deps')
    });
    const nodeCheck = report.checks.find(({ id }) => id === 'node-version');

    expect(nodeCheck).toEqual({
      id: 'node-version',
      status: 'ok',
      message: `External Node.js 24.15.0 detected at ${nodeExecutablePath}; Node.js 22 or newer is required.`
    });
  }, 'engineering-compiler-doctor-node-');
});

test('doctor fails closed for Bun compatibility metadata or an incompatible external Node', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const nodeExecutablePath = await writeNodeRuntime(workspaceRoot);
    for (const [version, bunVersion] of [
      ['20.19.0', null],
      ['24.3.0', '1.3.14']
    ] as const) {
      const report = await getDoctorReport(workspaceRoot, {
        nodeRuntime: {
          commandRunner: async () => nodeProbe(nodeExecutablePath, version, bunVersion),
          nodeExecutablePath
        },
        sharedDepsRoot: path.join(workspaceRoot, '.shared-deps')
      });
      expect(report.checks.find(({ id }) => id === 'node-version')).toMatchObject({
        id: 'node-version',
        status: 'fail'
      });
      expect(report.status).toBe('fail');
    }
  }, 'engineering-compiler-doctor-node-failure-');
});

test('dependency clean removes each custom domain-owned root once without selecting its nested cache twice', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { projectRoot } = getWorkspacePaths(workspaceRoot);
    const sharedRoot = path.join(projectRoot, '.shared-deps');
    await fs.mkdir(path.join(projectRoot, 'node_modules'), { recursive: true });
    await fs.mkdir(path.join(sharedRoot, '.bun-cache'), { recursive: true });
    const targets = await cleanDependencyEnvironment(
      workspaceRoot,
      { all: true, force: true },
      { sharedDepsRoot: sharedRoot }
    );

    expect(targets).toHaveLength(3);
    expect(targets).not.toContain(path.join(sharedRoot, '.bun-cache'));
    await expect(fs.stat(path.join(projectRoot, 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(sharedRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 'engineering-compiler-dependency-clean-');
});
