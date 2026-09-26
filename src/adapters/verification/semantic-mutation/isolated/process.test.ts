import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runSemanticMutationIsolatedProcess } from './process.ts';

function environment(): NodeJS.ProcessEnv {
  return Object.freeze({ PATH: process.env.PATH ?? '', LANG: 'C.UTF-8' });
}

test('isolated verification process publishes the owner-observed lifecycle', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sec-semantic-process-'));
  let fenceCount = 0;
  try {
    const observed = await runSemanticMutationIsolatedProcess({
      command: process.execPath,
      args: ['--no-env-file', '--eval', "process.stdout.write('ok')"],
      cwd: root,
      environment: environment(),
      timeoutMs: 5_000,
      outputLimitBytes: 1024,
      commitFence: async () => { fenceCount += 1; }
    });
    expect(observed.code).toBe(0);
    expect(Buffer.from(observed.stdout).toString('utf8')).toBe('ok');
    expect(observed.stderr).toBe('');
    expect(observed.outcome.status).toBe('exited');
    expect(observed.outcome.termination).toMatchObject({
      childCloseObserved: true,
      streamsDrained: true,
      treeClosed: true
    });
    expect(fenceCount).toBeGreaterThan(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('isolated verification process keeps bounded output failure as lifecycle evidence', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sec-semantic-process-limit-'));
  try {
    const observed = await runSemanticMutationIsolatedProcess({
      command: process.execPath,
      args: ['--no-env-file', '--eval', "process.stdout.write('x'.repeat(4096))"],
      cwd: root,
      environment: environment(),
      timeoutMs: 5_000,
      outputLimitBytes: 64,
      commitFence: async () => {}
    });
    expect(observed.outcome.status).toBe('observer-failed');
    expect(observed.outcome.stdout.bytes).toBeGreaterThan(64);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
