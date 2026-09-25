import { expect, test } from 'bun:test';

import type {
  DependencyCleanOptions,
  DependencyEnvironmentStatus
} from '../../src/adapters/toolchain/dependencies/environment.ts';
import * as dependencyEnvironmentDomain from '../../src/adapters/toolchain/dependencies/environment.ts';
import type { DependencyEnvironmentCommandDomain } from '../../src/bootstrap/cli/register-commands.ts';
import { formatDependencyEnvironmentStatus } from '../../src/entry/cli/dependency-environment.ts';
import {
  runCliInProcess as runCli,
  type CliResult,
  type CliRunOptions
} from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

type DependencyCommandCall = Readonly<{
  method: 'clean' | 'relink' | 'status' | 'warmup';
  options?: DependencyCleanOptions;
  workspaceRoot: string;
}>;

function dependencyStatus(workspaceRoot: string): DependencyEnvironmentStatus {
  const entry = (name: string) => ({
    entryCount: 1,
    exists: true,
    kind: 'physical' as const,
    path: `${workspaceRoot}/${name}`,
    sizeBytes: 1
  });
  return {
    bunPackageCache: entry('bun-package-cache'),
    manifestHash: 'dependency-manifest',
    mode: 'warm-compiler',
    projectNodeModules: entry('project-node-modules'),
    recommendedAction: 'platform deps relink',
    compilerNodeModules: entry('compiler-node-modules')
  };
}

function errorCode(result: CliResult): unknown {
  for (const line of result.stderr.split(/\r?\n/u)) {
    try {
      const payload = JSON.parse(line) as { code?: unknown };
      if (payload.code !== undefined) return payload.code;
    } catch {
      // Human diagnostics are not control-flow authority.
    }
  }
  return undefined;
}

test('dependency maintenance CLI routes through one explicit command domain without global effects', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const calls: DependencyCommandCall[] = [];
    const status = dependencyStatus(workspaceRoot);
    const domain = {
      ...dependencyEnvironmentDomain,
      cleanDependencyEnvironment: async (root: string | undefined, options: DependencyCleanOptions) => {
        const observedRoot = root ?? process.cwd();
        calls.push({ method: 'clean', options, workspaceRoot: observedRoot });
        return [`${observedRoot}/node_modules`, `${observedRoot}/.runtime-deps.stamp.json`];
      },
      getDependencyEnvironmentStatus: async (root?: string) => {
        calls.push({ method: 'status', workspaceRoot: root ?? process.cwd() });
        return status;
      },
      getDoctorReport: async () => ({
        checkCount: 0,
        checks: [],
        dependencies: status,
        status: 'ok' as const
      }),
      relinkProjectDependencies: async (root?: string) => {
        calls.push({ method: 'relink', workspaceRoot: root ?? process.cwd() });
        return status;
      },
      warmupDependencyEnvironment: async (root?: string) => {
        calls.push({ method: 'warmup', workspaceRoot: root ?? process.cwd() });
        return status;
      }
    } satisfies DependencyEnvironmentCommandDomain;
    const cli: CliRunOptions = {
      domainLoaders: { loadDependencyEnvironmentDomain: async () => domain }
    };

    const text = await runCli(workspaceRoot, ['deps', 'status'], cli);
    expect(text).toMatchObject({ code: 0, stderr: '' });
    expect(text.stdout.trimEnd()).toBe(formatDependencyEnvironmentStatus(status).trimEnd());

    const json = await runCli(workspaceRoot, ['deps', 'status', '--json'], cli);
    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({
      manifestHash: status.manifestHash,
      mode: status.mode,
      recommendedAction: status.recommendedAction,
      compilerNodeModules: { kind: 'physical' }
    });

    const compact = await runCli(workspaceRoot, ['deps', 'status', '--json', '--compact'], cli);
    expect(compact.code).toBe(0);
    expect(compact.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(compact.stdout)).toMatchObject({ mode: status.mode });

    expect((await runCli(workspaceRoot, ['deps', 'warmup', '--json'], cli)).code).toBe(0);
    expect((await runCli(workspaceRoot, ['deps', 'relink', '--json'], cli)).code).toBe(0);
    expect((await runCli(workspaceRoot, ['deps', 'clean', '--project'], cli)).code).toBe(0);

    expect(calls).toEqual([
      { method: 'status', workspaceRoot },
      { method: 'status', workspaceRoot },
      { method: 'status', workspaceRoot },
      { method: 'warmup', workspaceRoot },
      { method: 'relink', workspaceRoot },
      { method: 'clean', options: expect.objectContaining({ project: true }), workspaceRoot }
    ]);

    for (const args of [
      ['deps', 'status', '--compact'],
      ['deps', 'relink', '--compact'],
      ['deps', 'clean', '--all'],
      ['deps', 'clean', '--force']
    ]) {
      const invalid = await runCli(workspaceRoot, args, cli);
      expect(invalid.code).toBe(1);
      expect(errorCode(invalid)).toBe('CLI-USAGE-001');
    }
    expect(calls).toHaveLength(6);
  });
});
