import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';
import { writeBuffer, writeJson } from "../../../src/adapters/filesystem/files.ts";

async function fixture(run: (root: string) => Promise<void>) {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-write-snapshot-'));
  await settleWorkspaceCallback(() => run(root),
    async () => rmSync(root, { recursive: true, force: true }));
}

test('native serialization failures stay exact and have no file effects', async () => fixture(async root => {
  const reason = Object.freeze({ conversion: 'failed' });
  await assert.rejects(writeJson(path.join(root, 'value'), { details: { toJSON() { throw reason; } } }), error => error === reason);
  const circular: { self?: unknown } = {}; circular.self = circular;
  await assert.rejects(writeJson(path.join(root, 'value'), { details: circular }), TypeError);
  assert.equal(existsSync(path.join(root, 'value')), false);
}));

test('a rejected fence cannot write its captured bytes and its original reason survives', async () => fixture(async root => {
  const target = path.join(root, 'value'); writeFileSync(target, 'before');
  for (const reason of [undefined, new Error('rejected')]) {
    await assert.rejects(writeBuffer(target, Buffer.from('after'), async () => { throw reason; }), error => error === reason);
    assert.equal(readFileSync(target, 'utf8'), 'before');
  }
}));
