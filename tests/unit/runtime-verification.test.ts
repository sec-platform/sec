import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  createSkippedRuntimeLane,
  normalizeRuntimeVerificationLog,
  runtimeVerificationInvocation
} from '../../src/compiler/verify/run-runtime-verification.ts';

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

test('isolated runtime invocation is fixed to staged Bun config and forbids install', async () => {
  const root = await mkdtemp(path.join(process.cwd(), '.tmp-runtime-invocation-'));
  try {
    const config = path.join(root, 'bunfig.toml');
    await mkdir(root, { recursive: true });
    await writeFile(config, '[test]\n', 'utf8');
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
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
