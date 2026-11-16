import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { PhysicalNoFollowError } from '../../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { readOptionalRetainedJson, readOptionalRetainedJsonLeaf, readOptionalRetainedOrdinaryFile, retainOptionalDirectory } from '../../../src/adapters/runtime-state/physical/runtime/retained-file-read.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

test('retained ordinary-file reads distinguish physical absence from directory and linked-ancestor failures', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    expect(readOptionalRetainedOrdinaryFile(
      path.join(workspaceRoot, 'missing.json'),
      'missing fixture'
    )).toBeNull();

    const directoryPath = path.join(workspaceRoot, 'directory');
    await fs.mkdir(directoryPath);
    expect(() => readOptionalRetainedOrdinaryFile(directoryPath, 'directory fixture'))
      .toThrow(PhysicalNoFollowError);

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

test('retained JSON reads distinguish invalid JSON and UTF-8 from absence while revalidating shared parents', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const invalidPath = path.join(workspaceRoot, 'invalid.json');
    const parent = retainOptionalDirectory(workspaceRoot, 'JSON fixture parent');
    if (parent === null) throw new Error('JSON fixture parent unexpectedly absent');

    await fs.writeFile(invalidPath, 'null\n', 'utf8');
    expect(() => readOptionalRetainedJson(invalidPath, 'null JSON fixture'))
      .toThrow('null JSON fixture must not be JSON null');
    expect(() => readOptionalRetainedJsonLeaf(parent, 'invalid.json', 'null JSON sibling'))
      .toThrow('null JSON sibling must not be JSON null');

    for (const value of [false, { value: null }]) {
      await fs.writeFile(invalidPath, JSON.stringify(value), 'utf8');
      expect(readOptionalRetainedJson(invalidPath, 'present JSON fixture')).toEqual(value);
    }

    await fs.writeFile(invalidPath, '{not-json}\n', 'utf8');
    expect(() => readOptionalRetainedJson(invalidPath, 'invalid JSON fixture'))
      .toThrow('not valid JSON');

    await fs.writeFile(invalidPath, Buffer.concat([
      Buffer.from('{"value":"'),
      Buffer.from([0xff]),
      Buffer.from('"}')
    ]));
    expect(() => readOptionalRetainedJson(invalidPath, 'invalid UTF-8 fixture'))
      .toThrow('not exact UTF-8');

    expect(readOptionalRetainedJson(
      path.join(workspaceRoot, 'absent.json'),
      'absent JSON fixture'
    )).toBeNull();
    expect(readOptionalRetainedJsonLeaf(parent, 'absent.json', 'absent JSON sibling')).toBeNull();

    const sharedParentPath = path.join(workspaceRoot, 'workflow');
    const movedParentPath = path.join(workspaceRoot, 'workflow-old');
    await fs.mkdir(sharedParentPath);
    await fs.writeFile(path.join(sharedParentPath, 'first.json'), '{"value":1}\n', 'utf8');
    const sharedParent = retainOptionalDirectory(sharedParentPath, 'workflow fixture');
    if (sharedParent === null) throw new Error('workflow fixture parent unexpectedly absent');

    expect(readOptionalRetainedJsonLeaf<{ value: number }>(
      sharedParent,
      'first.json',
      'first sibling fixture'
    )).toEqual({ value: 1 });

    await fs.rename(sharedParentPath, movedParentPath);
    await fs.mkdir(sharedParentPath);
    await fs.writeFile(path.join(sharedParentPath, 'second.json'), '{"value":2}\n', 'utf8');

    expect(() => readOptionalRetainedJsonLeaf(
      sharedParent,
      'second.json',
      'substituted sibling fixture'
    )).toThrow(PhysicalNoFollowError);
  });
});
