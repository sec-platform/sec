import { test } from 'bun:test';
import { Command } from 'commander';
import assert from 'node:assert/strict';
import { commandFromRoot, commandPath } from '../../../src/entry/cli/command-options.ts';

function command(name: string, parent?: Command): Command { return { name: () => name, parent } as Command; }

test('lineage preserves command order and the root-only projection does not read child names', () => {
  const root = new Command().name('renamed');
  const leaf = root.command('pipeline').command('inspect');
  assert.equal(commandPath(leaf), 'renamed pipeline inspect');
  leaf.name = (() => assert.fail('root lookup inspected child name')) as Command['name'];
  assert.equal(commandFromRoot(leaf, 'verify'), 'renamed verify');
});

test('both command projections refuse cyclic parents instead of looping', () => {
  const root = command('sec'), leaf = command('inspect', root);
  Object.defineProperty(root, 'parent', { value: leaf });
  for (const project of [commandPath, commandFromRoot]) assert.throws(() => project(leaf), /parent cycle/);
});

