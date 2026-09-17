import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { PhysicalNoFollowError } from '../../src/runtime-state/physical/runtime/physical-no-follow.ts';
import {
  calculateCanonicalProjectFileHash,
  calculateProjectFileHash
} from '../../src/adapters/workspace/project-file-hash.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('canonical provenance hashes normalize UTF-8 line endings without weakening raw baseline hashes', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const lfPath = path.join(workspaceRoot, 'lf.txt');
    const crlfPath = path.join(workspaceRoot, 'crlf.txt');
    const binaryAPath = path.join(workspaceRoot, 'binary-a.bin');
    const binaryBPath = path.join(workspaceRoot, 'binary-b.bin');

    await fs.writeFile(lfPath, 'first\nsecond\n');
    await fs.writeFile(crlfPath, 'first\r\nsecond\r\n');
    await fs.writeFile(binaryAPath, Buffer.from([0, 13, 10, 255]));
    await fs.writeFile(binaryBPath, Buffer.from([0, 10, 10, 255]));

    expect(await calculateProjectFileHash(lfPath)).not.toBe(await calculateProjectFileHash(crlfPath));
    expect(await calculateCanonicalProjectFileHash(lfPath)).toBe(
      await calculateCanonicalProjectFileHash(crlfPath)
    );
    expect(await calculateProjectFileHash(binaryAPath)).not.toBe(await calculateProjectFileHash(binaryBPath));
    expect(await calculateCanonicalProjectFileHash(binaryAPath)).not.toBe(
      await calculateCanonicalProjectFileHash(binaryBPath)
    );
  });
});

test('project hashing maps only physical absence to undefined', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    expect(await calculateProjectFileHash(path.join(workspaceRoot, 'missing.txt'))).toBeUndefined();
    expect(await calculateCanonicalProjectFileHash(path.join(workspaceRoot, 'missing.txt'))).toBeUndefined();

    const directory = path.join(workspaceRoot, 'directory');
    await fs.mkdir(directory);
    expect(() => calculateProjectFileHash(directory)).toThrow(PhysicalNoFollowError);
  });
});

test('project hashing rejects a linked ancestor instead of hashing bytes outside the physical project path', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const externalRoot = path.join(workspaceRoot, 'external');
    const linkedRoot = path.join(workspaceRoot, 'linked');
    await fs.mkdir(externalRoot);
    await fs.writeFile(path.join(externalRoot, 'artifact.txt'), 'outside\n', 'utf8');
    await fs.symlink(
      externalRoot,
      linkedRoot,
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    expect(() => calculateProjectFileHash(path.join(linkedRoot, 'artifact.txt')))
      .toThrow(PhysicalNoFollowError);
  });
});
