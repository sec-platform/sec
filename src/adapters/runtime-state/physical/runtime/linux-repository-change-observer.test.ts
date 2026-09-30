import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
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
    await writeFile(path.join(root, 'nested', 'stable.txt'), 'stable', 'utf8');
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
  'Linux repository observer detects nested write-and-remove ABA',
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
  'Linux repository observer detects an in-place write even when bytes are restored',
  async () => withFixture(async (root) => {
    const target = path.join(root, 'nested', 'stable.txt');
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
  'Linux repository observer detects retained root replacement through its parent entry',
  async () => {
    const host = await mkdtemp(path.join(os.tmpdir(), 'sec-linux-repository-root-replace-'));
    const root = path.join(host, 'repository');
    const displaced = path.join(host, 'repository-old');
    try {
      await mkdir(root);
      const resolution = await armLinuxRepositoryChangeObserver({
        roots: [root],
        deadlineAtUnixMs: Date.now() + 10_000
      });
      expect(resolution.status).toBe('ready');
      if (resolution.status !== 'ready') return;
      await rename(root, displaced);
      await mkdir(root);
      const settlement = await settleLinuxRepositoryChangeObserver(resolution.observer);
      expect(['events', 'identity-changed']).toContain(settlement.status);
    } finally {
      await rm(host, { force: true, recursive: true });
    }
  }
);
