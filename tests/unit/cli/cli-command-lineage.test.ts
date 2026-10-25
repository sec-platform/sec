import { test } from 'bun:test';
import { Command } from 'commander';
import assert from 'node:assert/strict';
import { commandFromRoot, commandPath } from '../../../src/entry/cli/command-options.ts';

test('lineage preserves command order and the actual root name', () => {
  const root = new Command().name('renamed');
  const leaf = root.command('pipeline').command('inspect');
  assert.equal(commandPath(leaf), 'renamed pipeline inspect');
  assert.equal(commandFromRoot(leaf, 'verify'), 'renamed verify');
});
