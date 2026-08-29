import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { PhysicalNoFollowError } from '../../src/runtime-state/physical/runtime/physical-no-follow.ts';
import { decodeExactUtf8, readOptionalRetainedJsonLeaf, readOptionalRetainedJson, readOptionalRetainedOrdinaryFile, retainOptionalDirectory } from '../../src/runtime-state/physical/runtime/retained-file-read.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('retained ordinary-file read maps only physical absence to null', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    expect(readOptionalRetainedOrdinaryFile(
      path.join(workspaceRoot, 'missing.json'),
      'missing fixture'
    )).toBeNull();

    const directoryPath = path.join(workspaceRoot, 'directory');
    await fs.mkdir(directoryPath);
    expect(() => readOptionalRetainedOrdinaryFile(directoryPath, 'directory fixture'))
      .toThrow(PhysicalNoFollowError);
  });
});

test('retained ordinary-file read rejects a linked ancestor instead of following external authority', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const externalRoot = path.join(workspaceRoot, 'external');
    const linkedRoot = path.join(workspaceRoot, 'linked');
    await fs.mkdir(externalRoot);
    await fs.writeFile(path.join(externalRoot, 'authority.json'), '{"value":1}\n', 'utf8');
    await fs.symlink(
      externalRoot,
      linkedRoot,
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    expect(() => readOptionalRetainedOrdinaryFile(
      path.join(linkedRoot, 'authority.json'),
      'linked fixture'
    )).toThrow(PhysicalNoFollowError);
  });
});

test('shared retained parent binding still rejects directory substitution before every sibling read', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const parentPath = path.join(workspaceRoot, 'workflow');
    const movedPath = path.join(workspaceRoot, 'workflow-old');
    await fs.mkdir(parentPath);
    await fs.writeFile(path.join(parentPath, 'first.json'), '{"value":1}\n', 'utf8');
    const parent = retainOptionalDirectory(parentPath, 'workflow fixture');
    expect(parent).not.toBeNull();
    if (parent === null) throw new Error('workflow fixture parent unexpectedly absent');

    expect(readOptionalRetainedJsonLeaf<{ value: number }>(
      parent,
      'first.json',
      'first sibling fixture'
    )).toEqual({ value: 1 });

    await fs.rename(parentPath, movedPath);
    await fs.mkdir(parentPath);
    await fs.writeFile(path.join(parentPath, 'second.json'), '{"value":2}\n', 'utf8');

    expect(() => readOptionalRetainedJsonLeaf(
      parent,
      'second.json',
      'substituted sibling fixture'
    )).toThrow(PhysicalNoFollowError);
  });
});

test('exact UTF-8 decoder rejects invalid byte sequences', () => {
  expect(() => decodeExactUtf8(new Uint8Array([0xff]), 'invalid fixture'))
    .toThrow('not exact UTF-8');
});

test('retained JSON read distinguishes invalid JSON from absence', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const invalidPath = path.join(workspaceRoot, 'invalid.json');
    await fs.writeFile(invalidPath, '{not-json}\n', 'utf8');

    expect(() => readOptionalRetainedJson(invalidPath, 'invalid JSON fixture'))
      .toThrow('not valid JSON');
    expect(readOptionalRetainedJson(
      path.join(workspaceRoot, 'absent.json'),
      'absent JSON fixture'
    )).toBeNull();
  });
});
