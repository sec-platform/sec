import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  armLinuxRepositoryChangeObserver,
  settleLinuxRepositoryChangeObserver
} from './linux-repository-change-observer.ts';

async function withFixture(
  operation: (root: string) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sec-linux-repository-observer-'));
  try {
    await mkdir(path.join(root, 'nested'));
    await operation(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test.skipIf(process.platform !== 'linux')(
  'Linux repository observer settles an unchanged retained root with zero events',
  async () => withFixture(async (root) => {
    const resolution = await armLinuxRepositoryChangeObserver({
      roots: [root],
      deadlineAtUnixMs: Date.now() + 10_000
    });
    expect(resolution.status).toBe('ready');
    if (resolution.status !== 'ready') return;
    const settlement = await settleLinuxRepositoryChangeObserver(resolution.observer);
    expect(settlement.status).toBe('zero-events');
  })
);

test.skipIf(process.platform !== 'linux')(
  'Linux repository observer detects write-and-remove ABA in an existing nested directory',
  async () => withFixture(async (root) => {
    const resolution = await armLinuxRepositoryChangeObserver({
      roots: [root],
      deadlineAtUnixMs: Date.now() + 10_000
    });
    expect(resolution.status).toBe('ready');
    if (resolution.status !== 'ready') return;
    const target = path.join(root, 'nested', 'transient.txt');
    await writeFile(target, 'transient', 'utf8');
    await rm(target);
    const settlement = await settleLinuxRepositoryChangeObserver(resolution.observer);
    expect(settlement.status).toBe('events');
    if (settlement.status !== 'events') return;
    expect(settlement.events.some(({ path: observedPath }) => (
      observedPath === 'nested/transient.txt'
    ))).toBeTrue();
  })
);

test.skipIf(process.platform !== 'linux')(
  'Linux repository observer detects in-place bytes restored before settlement',
  async () => withFixture(async (root) => {
    const target = path.join(root, 'nested', 'stable.txt');
    await writeFile(target, 'stable', 'utf8');
    const resolution = await armLinuxRepositoryChangeObserver({
      roots: [root],
      deadlineAtUnixMs: Date.now() + 10_000
    });
    expect(resolution.status).toBe('ready');
    if (resolution.status !== 'ready') return;
    await writeFile(target, 'changed', 'utf8');
    await writeFile(target, 'stable', 'utf8');
    const settlement = await settleLinuxRepositoryChangeObserver(resolution.observer);
    expect(settlement.status).toBe('events');
    if (settlement.status !== 'events') return;
    expect(settlement.events.some(({ action, path: observedPath }) => (
      action === 'modified' && observedPath === 'nested/stable.txt'
    ))).toBeTrue();
  })
);

test.skipIf(process.platform !== 'linux')(
  'Linux repository observer detects a directory created after the recursive readiness barrier',
  async () => withFixture(async (root) => {
    const resolution = await armLinuxRepositoryChangeObserver({
      roots: [root],
      deadlineAtUnixMs: Date.now() + 10_000
    });
    expect(resolution.status).toBe('ready');
    if (resolution.status !== 'ready') return;
    await mkdir(path.join(root, 'nested', 'late'));
    await writeFile(path.join(root, 'nested', 'late', 'child.txt'), 'child', 'utf8');
    const settlement = await settleLinuxRepositoryChangeObserver(resolution.observer);
    expect(settlement.status).toBe('events');
    if (settlement.status !== 'events') return;
    expect(settlement.events.some(({ action, path: observedPath }) => (
      action === 'added' && observedPath === 'nested/late'
    ))).toBeTrue();
  })
);
