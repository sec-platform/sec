import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { inspectNoFollowDirectoryChain } from './physical-no-follow.ts';
import {
  RetainedRuntimeStateDirectoryError,
  openRetainedRuntimeStateDirectoryAtOwnerIssuedRoot
} from './retained-runtime-state-directory.ts';

test('runtime-state directory is created beneath and retained from its owner-issued root', async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'sec-runtime-state-root-'));
  try {
    const root = inspectNoFollowDirectoryChain(rootPath, 'test runtime-state root');
    const retained = openRetainedRuntimeStateDirectoryAtOwnerIssuedRoot({
      childDescriptor: 63,
      mode: 'create-or-open',
      root,
      segments: ['Docker']
    });
    expect(retained.path).toBe(path.join(rootPath, 'Docker'));
    expect(path.isAbsolute(retained.path)).toBe(true);
    expect(retained.root.objectId).toBe(root.target.objectId);
    expect(retained.directory.path).toBe(retained.path);
    retained.assertCurrent();
    const receipt = retained.close();
    expect(receipt.state).toBe('closed');
    expect(retained.close()).toBe(receipt);
    expect(() => retained.assertCurrent()).toThrow(RetainedRuntimeStateDirectoryError);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test('runtime-state directory rejects path escape before any create effect', async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'sec-runtime-state-root-'));
  try {
    const root = inspectNoFollowDirectoryChain(rootPath, 'test runtime-state root');
    expect(() => openRetainedRuntimeStateDirectoryAtOwnerIssuedRoot({
      childDescriptor: 63,
      mode: 'create-or-open',
      root,
      segments: ['..']
    })).toThrow('segment is invalid');
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test('runtime-state open-existing reports an absent child as a typed open failure', async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'sec-runtime-state-root-'));
  try {
    const root = inspectNoFollowDirectoryChain(rootPath, 'test runtime-state root');
    try {
      openRetainedRuntimeStateDirectoryAtOwnerIssuedRoot({
        childDescriptor: 63,
        mode: 'open-existing',
        root,
        segments: ['absent']
      });
      throw new Error('expected typed open failure');
    } catch (error) {
      expect(error).toBeInstanceOf(RetainedRuntimeStateDirectoryError);
      expect((error as RetainedRuntimeStateDirectoryError).code)
        .toBe('RETAINED_RUNTIME_STATE_DIRECTORY_OPEN_FAILED');
    }
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});
