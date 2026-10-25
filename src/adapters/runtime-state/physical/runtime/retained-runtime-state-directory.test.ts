import { settleWorkspaceCallback } from '../../../../../tests/testkit/workspace-cleanup.ts';
import { settleResourcesAsync } from '../../../../execution/resource-settlement.ts';
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  assertRetainedWindowsHostNamespaceDirectory,
  inspectNoFollowDirectoryChain,
  retainWindowsHostNamespaceDirectoryById
} from './physical-no-follow.ts';
import {
  RetainedRuntimeStateDirectoryError,
  openRetainedRuntimeStateDirectoryAtOwnerIssuedRoot
} from './retained-runtime-state-directory.ts';

test.skipIf(process.platform !== 'win32')('Windows host namespace proof is FileId-bound, retained, and closed explicitly', async () => {
  const container = await mkdtemp(path.join(os.tmpdir(), 'sec-host-namespace-'));
  const rootPath = path.join(container, 'root');
  const movedPath = path.join(container, 'moved');
  let retainedProof: ReturnType<typeof retainWindowsHostNamespaceDirectoryById> | undefined;
  await settleWorkspaceCallback(async () => {
    await mkdir(rootPath);
    const identity = inspectNoFollowDirectoryChain(rootPath, 'host namespace test root').target;
    const proof = retainWindowsHostNamespaceDirectoryById(identity, 'host namespace test proof');
    retainedProof = proof;
    proof.assertCurrent();
    expect(() => assertRetainedWindowsHostNamespaceDirectory(Object.freeze({})))
      .toThrow('was not issued');

    const forgedPath = path.join(container, 'forged');
    expect(() => retainWindowsHostNamespaceDirectoryById(Object.freeze({
      ...identity,
      path: forgedPath,
      finalPath: path.toNamespacedPath(forgedPath)
    }), 'forged host namespace proof')).toThrow('does not resolve');

    await rename(rootPath, movedPath);
    expect(() => proof.assertCurrent()).toThrow('escaped its exact lexical path');
    proof.dispose();
    retainedProof = undefined;
    expect(() => assertRetainedWindowsHostNamespaceDirectory(proof)).toThrow('live host namespace');
  }, async () => {
    await settleResourcesAsync({ cleanup: [
      { label: 'host namespace proof', settle: () => retainedProof?.dispose() },
      { label: 'host namespace root', settle: () => rm(container, { recursive: true, force: true }) }
    ] });
  });
});

test('runtime-state directory is created beneath and retained from its owner-issued root', async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'sec-runtime-state-root-'));
  await settleWorkspaceCallback(async () => {
    const root = inspectNoFollowDirectoryChain(rootPath, 'test runtime-state root');
    expect(() => openRetainedRuntimeStateDirectoryAtOwnerIssuedRoot({
      childDescriptor: 63,
      mode: 'create-or-open',
      root,
      segments: ['..']
    })).toThrow('segment is invalid');
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
    expect(retained.close()).toEqual(receipt);
    expect(() => retained.assertCurrent()).toThrow(RetainedRuntimeStateDirectoryError);
  }, async () => {
    await rm(rootPath, { recursive: true, force: true });
  });
});

test('runtime-state open-existing reports an absent child as a typed open failure', async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'sec-runtime-state-root-'));
  await settleWorkspaceCallback(async () => {
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
  }, async () => {
    await rm(rootPath, { recursive: true, force: true });
  });
});
