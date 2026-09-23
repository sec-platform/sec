import { lstat, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  normalizeRuntimeVerificationLog,
  runRuntimeVerification,
  runtimeVerificationInvocation
} from '../../src/adapters/verification/run-runtime-verification.ts';
import { createSkippedRuntimeLane } from '../../src/assurance/verification/project/report.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('runtime verification skips empty inventory without preparing dependencies or launching a process', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const report = await runRuntimeVerification(workspaceRoot, 'full', {
      beforeCommit: () => {
        throw new Error('Empty runtime inventory must not prepare dependencies');
      },
      commandRunnerForTests: async () => {
        throw new Error('Empty runtime inventory must not launch a process');
      }
    });
    expect(report).toEqual({
      status: 'passed',
      build: { status: 'skipped', passed: [], failed: [], command: null },
      unit: { status: 'skipped', passed: [], failed: [], command: null },
      acceptance: { status: 'skipped', passed: [], failed: [], command: null },
      logs: { stdout: '', stderr: '' }
    });
  }, 'runtime-empty-inventory-');
});

test('non-isolated runtime verification retains the compiler dependency bridge through the command', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const runtimeTestRoot = path.join(workspaceRoot, 'tests', 'runtime', 'unit');
    const bridgePath = path.join(workspaceRoot, 'node_modules');
    await mkdir(runtimeTestRoot, { recursive: true });
    await writeFile(path.join(runtimeTestRoot, 'consumer.test.ts'), 'export {};\n', 'utf8');

    const report = await runRuntimeVerification(workspaceRoot, 'full', {
      commandRunnerForTests: async (_command, _args, options) => {
        expect(options.cwd).toBe(workspaceRoot);
        expect((await lstat(bridgePath)).isSymbolicLink()).toBe(true);
        expect(await stat(path.join(bridgePath, 'yaml', 'package.json'))).toBeDefined();
        return { code: 0, stdout: '', stderr: '' };
      },
      emitTiming: false
    });

    expect(report.unit.status).toBe('passed');
    await expect(lstat(bridgePath)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 'runtime-retained-dependency-bridge-');
});

test('runtime verification contract invokes only the generated unit suite', () => {
  expect(runtimeVerificationInvocation(path.resolve('project'))).toEqual({
    command: 'bun',
    args: ['run', 'test:unit']
  });
  expect(createSkippedRuntimeLane()).toEqual({
    status: 'skipped',
    build: { status: 'skipped', passed: [], failed: [], command: null },
    unit: { status: 'skipped', passed: [], failed: [], command: null },
    acceptance: { status: 'skipped', passed: [], failed: [], command: null },
    logs: { stdout: '', stderr: '' }
  });
  expect(normalizeRuntimeVerificationLog('failed [12.4ms]')).toBe('failed [duration]');
});

test('isolated runtime invocation is fixed to staged Bun config and forbids install', () => {
  const root = path.resolve('staged-runtime');
  const config = path.join(root, 'bunfig.toml');
  expect(runtimeVerificationInvocation(path.join(root, 'project'), true, config)).toEqual({
    command: process.execPath,
    args: [
      '--no-env-file',
      `--config=${config}`,
      '--no-install',
      'test',
      'tests/runtime/unit'
    ]
  });
});
