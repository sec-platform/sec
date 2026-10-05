import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { withPrivateMaintenanceReceiptWriter } from '../../src/adapters/self-hosting/control/repository-maintenance/receipt-file.ts';

async function fixture(operation: (root: string) => Promise<void>) {
  const root = mkdtempSync(path.join(tmpdir(), 'maintenance-receipt-'));
  try { await operation(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('private receipt publication retains atomic replacement and closes the writer after success', async () => {
  await fixture(async (root) => {
    let escaped: ((value: unknown) => void) | undefined;
    await withPrivateMaintenanceReceiptWriter(root, async (persist) => {
      escaped = persist;
      persist({ progress: ['effect-started'], results: [] });
      persist({ progress: ['effect-started', 'effect-returned'], results: ['retired'] });
      expect(JSON.parse(readFileSync(path.join(root, 'maintenance-result.json'), 'utf8')))
        .toEqual({ progress: ['effect-started', 'effect-returned'], results: ['retired'] });
      expect(statSync(path.join(root, 'maintenance-result.json')).mode & 0o777).toBe(0o600);
      expect(readdirSync(root)).toEqual(['maintenance-result.json']);
    });
    expect(() => escaped!({ unauthorized: true })).toThrow();
  });
});

test('receipt root rejects public mode and symlink ancestry before the callback', async () => {
  await fixture(async (root) => {
    const privateRoot = path.join(root, 'private');
    mkdirSync(privateRoot, { mode: 0o700 });
    const linked = path.join(root, 'linked');
    symlinkSync(privateRoot, linked);
    let called = false;
    const callback = async () => { called = true; };
    await expect(withPrivateMaintenanceReceiptWriter(linked, callback)).rejects.toThrow();
    mkdirSync(path.join(privateRoot, 'child'), { mode: 0o700 });
    await expect(withPrivateMaintenanceReceiptWriter(path.join(linked, 'child'), callback)).rejects.toThrow();
    chmodSync(privateRoot, 0o755);
    await expect(withPrivateMaintenanceReceiptWriter(privateRoot, callback)).rejects.toThrow('mode 0700');
    expect(called).toBe(false);
  });
});

test('receipt writer rejects directory identity replacement and permission drift', async () => {
  await fixture(async (root) => {
    const privateRoot = path.join(root, 'private');
    mkdirSync(privateRoot, { mode: 0o700 });
    await expect(withPrivateMaintenanceReceiptWriter(privateRoot, async (persist) => {
      renameSync(privateRoot, path.join(root, 'displaced'));
      mkdirSync(privateRoot, { mode: 0o700 });
      persist({ changed: true });
    })).rejects.toThrow();
    expect(readdirSync(privateRoot)).toEqual([]);
    expect(readdirSync(path.join(root, 'displaced'))).toEqual([]);
    await expect(withPrivateMaintenanceReceiptWriter(privateRoot, async (persist) => {
      chmodSync(privateRoot, 0o755);
      persist({ changed: true });
    })).rejects.toThrow('mode 0700');
    expect(readdirSync(privateRoot)).toEqual([]);
  });
});

test('failed receipt rename cleans its exclusive candidate and does not follow an output symlink', async () => {
  await fixture(async (root) => {
    const target = path.join(root, 'maintenance-result.json');
    mkdirSync(target);
    writeFileSync(path.join(target, 'keep'), 'unchanged');
    await expect(withPrivateMaintenanceReceiptWriter(root, async (persist) => {
      persist({ results: [] });
    })).rejects.toThrow();
    expect(readFileSync(path.join(target, 'keep'), 'utf8')).toBe('unchanged');
    expect(readdirSync(root)).toEqual(['maintenance-result.json']);
    rmSync(target, { recursive: true });
    const outside = path.join(root, 'outside');
    writeFileSync(outside, 'unchanged');
    symlinkSync(outside, target);
    await withPrivateMaintenanceReceiptWriter(root, async (persist) => { persist({ results: [] }); });
    expect(readFileSync(outside, 'utf8')).toBe('unchanged');
    expect(statSync(target).isFile()).toBe(true);
  });
});

test('receipt callback failure preserves the published receipt and closes its borrowed writer', async () => {
  await fixture(async (root) => {
    const failure = new Error('injected effect callback failure');
    let escaped: ((value: unknown) => void) | undefined;
    await expect(withPrivateMaintenanceReceiptWriter(root, async (persist) => {
      escaped = persist;
      persist({ progress: ['effect-started'] });
      throw failure;
    })).rejects.toBe(failure);
    expect(JSON.parse(readFileSync(path.join(root, 'maintenance-result.json'), 'utf8')))
      .toEqual({ progress: ['effect-started'] });
    expect(readdirSync(root)).toEqual(['maintenance-result.json']);
    expect(() => escaped!({ replaced: true })).toThrow();
  });
});
