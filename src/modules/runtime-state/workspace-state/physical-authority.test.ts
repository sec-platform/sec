import { expect, test } from 'bun:test';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  assertPhysicallyDisjointDirectoryChainsV1,
  inspectNoFollowDirectoryChainV1,
  type PhysicalDirectoryChainV1,
  type PhysicalDirectoryIdentityV1
} from '../../platform/shared/physical-no-follow.ts';
import { acquireSecRuntimeCachePhysicalAuthorityV1 } from '../../tooling/sec-dev/runtime-state-authority.ts';

test('runtime cache authority materializes one no-follow tree physically outside the repository', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-cache-authority-'));
  try {
    const repositoryRoot = path.join(root, 'repository');
    const cacheRoot = path.join(root, 'cache');
    const snapshots = path.join(cacheRoot, 'docs-doctor', 'index-snapshots', 'v1');
    mkdirSync(repositoryRoot);

    const authority = acquireSecRuntimeCachePhysicalAuthorityV1({
      repositoryRoot,
      cacheRoot,
      requiredDirectories: [snapshots]
    });

    expect(authority.directory(snapshots).objectId).toBe(
      inspectNoFollowDirectoryChainV1(snapshots, 'cache authority readback').target.objectId
    );
    authority.assertCurrent();
    if (process.platform === 'linux') {
      expect(lstatSync(cacheRoot).mode & 0o077).toBe(0);
      expect(lstatSync(snapshots).mode & 0o077).toBe(0);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runtime cache authority rejects a symlink or junction ancestor before creating descendants', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-cache-reparse-'));
  try {
    const repositoryRoot = path.join(root, 'repository');
    const cacheRoot = path.join(root, 'cache-link');
    const forbiddenDescendant = path.join(cacheRoot, 'docs-doctor');
    mkdirSync(repositoryRoot);
    symlinkSync(repositoryRoot, cacheRoot, process.platform === 'win32' ? 'junction' : 'dir');

    expect(() => acquireSecRuntimeCachePhysicalAuthorityV1({
      repositoryRoot,
      cacheRoot,
      requiredDirectories: [forbiddenDescendant]
    })).toThrow();
    expect(existsSync(path.join(repositoryRoot, 'docs-doctor'))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('physical disjointness rejects different lexical paths for the same physical object', () => {
  const identity = (physical: string, lexical: string): PhysicalDirectoryIdentityV1 => Object.freeze({
    schema: 'sec-physical-no-follow-v1',
    path: lexical,
    finalPath: lexical,
    device: '7',
    inode: '11',
    objectId: physical
  });
  const chain = (target: PhysicalDirectoryIdentityV1): PhysicalDirectoryChainV1 => Object.freeze({
    target,
    ancestors: Object.freeze([target])
  });
  expect(() => assertPhysicallyDisjointDirectoryChainsV1(
    chain(identity('same-object', '/first/path')),
    chain(identity('same-object', '/bind/alias')),
    'alias roots'
  )).toThrow('physically disjoint');
});
