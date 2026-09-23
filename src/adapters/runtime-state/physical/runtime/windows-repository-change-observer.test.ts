import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  armWindowsRepositoryChangeObserver,
  settleWindowsRepositoryChangeObserver
} from './windows-repository-change-observer.ts';

async function withFixture(
  operation: (root: string) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sec-repository-observer-'));
  try {
    await mkdir(path.join(root, 'nested'));
    await operation(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test.skipIf(process.platform !== 'win32')(
  'Windows repository observer settles an unchanged retained root with zero events',
  async () => withFixture(async (root) => {
    const resolution = await armWindowsRepositoryChangeObserver({
      roots: [root],
      deadlineAtUnixMs: Date.now() + 10_000
    });
    expect(resolution.status).toBe('ready');
    if (resolution.status !== 'ready') return;
    const settlement = await settleWindowsRepositoryChangeObserver(resolution.observer);
    expect(settlement.status).toBe('zero-events');
  })
);

test.skipIf(process.platform !== 'win32')(
  'terminal observer settlement leaves no deadline timer or worker that keeps a fresh process alive',
  () => {
    const moduleUrl = new URL('./windows-repository-change-observer.ts', import.meta.url).href;
    const child = spawnSync(process.execPath, ['--no-env-file', '--eval', [
      `const observer = await import(${JSON.stringify(moduleUrl)});`,
      "const fs = await import('node:fs/promises');",
      "const os = await import('node:os');",
      "const path = await import('node:path');",
      "const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-repository-observer-child-'));",
      'try {',
      '  const resolution = await observer.armWindowsRepositoryChangeObserver({',
      '    roots: [root], deadlineAtUnixMs: Date.now() + 60_000',
      '  });',
      "  if (resolution.status !== 'ready') process.exit(2);",
      '  const settlement = await observer.settleWindowsRepositoryChangeObserver(resolution.observer);',
      "  if (settlement.status !== 'zero-events') process.exit(3);",
      '} finally {',
      '  await fs.rm(root, { force: true, recursive: true });',
      '}'
    ].join('\n')], {
      encoding: 'utf8',
      timeout: 5_000
    });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
    expect(child.stderr).toBe('');
  }
);

test.skipIf(process.platform !== 'win32')(
  'Windows repository observer detects write-and-remove ABA before settlement',
  async () => withFixture(async (root) => {
    const resolution = await armWindowsRepositoryChangeObserver({
      roots: [root],
      deadlineAtUnixMs: Date.now() + 10_000
    });
    expect(resolution.status).toBe('ready');
    if (resolution.status !== 'ready') return;
    const target = path.join(root, 'nested', 'transient.txt');
    await writeFile(target, 'transient', 'utf8');
    await rm(target);
    const settlement = await settleWindowsRepositoryChangeObserver(resolution.observer);
    expect(settlement.status).toBe('events');
    if (settlement.status !== 'events') return;
    expect(settlement.events.some(({ path: observedPath }) => (
      observedPath.replace(/\\/gu, '/') === 'nested/transient.txt'
    ))).toBeTrue();
  })
);

test.skipIf(process.platform !== 'win32')(
  'Windows repository observer detects an in-place write even when bytes are restored',
  async () => withFixture(async (root) => {
    const target = path.join(root, 'nested', 'stable.txt');
    await writeFile(target, 'stable', 'utf8');
    const resolution = await armWindowsRepositoryChangeObserver({
      roots: [root],
      deadlineAtUnixMs: Date.now() + 10_000
    });
    expect(resolution.status).toBe('ready');
    if (resolution.status !== 'ready') return;
    await writeFile(target, 'changed', 'utf8');
    await writeFile(target, 'stable', 'utf8');
    const settlement = await settleWindowsRepositoryChangeObserver(resolution.observer);
    expect(settlement.status).toBe('events');
    if (settlement.status !== 'events') return;
    expect(settlement.events.some(({ action, path: observedPath }) => (
      action === 'modified' && observedPath.replace(/\\/gu, '/') === 'nested/stable.txt'
    ))).toBeTrue();
  })
);
