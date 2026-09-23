import { test } from 'bun:test';
import type { Command } from 'commander';
import assert from 'node:assert/strict';
import { commandFromRoot, commandPath } from '../../src/entry/cli/command-options.ts';

function command(name: string, parent?: Command): Command { return { name: () => name, parent } as Command; }

test('lineage preserves command order and the root-only projection does not read child names', () => {
  const root = command('sec'), middle = command('pipeline', root), leaf = command('inspect', middle);
  assert.equal(commandPath(leaf), 'sec pipeline inspect');
  leaf.name = (() => assert.fail('root lookup inspected child name')) as Command['name'];
  assert.equal(commandFromRoot(leaf, 'verify'), 'sec verify');
});

test('both command projections refuse cyclic parents instead of looping', () => {
  const root = command('sec'), leaf = command('inspect', root);
  Object.defineProperty(root, 'parent', { value: leaf });
  for (const project of [commandPath, commandFromRoot]) assert.throws(() => project(leaf), /parent cycle/);
});

test('a parent slot is sampled once per node', () => {
  let reads = 0;
  const root = command('sec'), leaf = command('inspect');
  Object.defineProperty(leaf, 'parent', { get() { reads++; return root; } });
  assert.equal(commandFromRoot(leaf, 'verify'), 'sec verify'); assert.equal(reads, 1);
});
