import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isResourceCompositeSettlementError, readResourceCompositeSettlementFailures } from '../../../../execution/resource-settlement.ts';
import { withNativeTestWorkspace } from './native-test-workspace.ts';

async function fixture(execute: (root: string) => Promise<void>) {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-native-workspace-'));
  try {
    await execute(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('native workspace returns the oracle result and retires only its child under the default parent', async () => {
  await fixture(async root => {
    mkdirSync(path.join(root, '.tmp'));
    const unrelated = path.join(root, '.tmp', 'existing.txt');
    writeFileSync(unrelated, 'preserved');
    let workPath = '';
    const result = await withNativeTestWorkspace(root, async work => {
      workPath = work;
      expect(path.dirname(work)).toBe(path.join(root, '.tmp'));
      mkdirSync(path.join(work, 'nested'));
      writeFileSync(path.join(work, 'nested', 'output.json'), '{"result":1}');
      return { value: 1 };
    });
    expect(result).toEqual({ value: 1 });
    expect(existsSync(workPath)).toBe(false);
    expect(readdirSync(path.join(root, '.tmp'))).toEqual(['existing.txt']);
    expect(readFileSync(unrelated, 'utf8')).toBe('preserved');
  });
});

test('native workspace supports an existing executor parent and preserves an oracle failure after cleanup', async () => {
  await fixture(async root => {
    const parent = path.join(root, '.tmp', 'executor', 'oracles');
    mkdirSync(parent, { recursive: true });
    let workPath = '';
    const sentinel = new Error('oracle failure');
    let observed: unknown;
    try {
      await withNativeTestWorkspace(root, async work => {
        workPath = work;
        expect(path.dirname(work)).toBe(parent);
        writeFileSync(path.join(work, 'partial.txt'), 'partial');
        throw sentinel;
      }, '.tmp/executor/oracles');
    } catch (error) { observed = error; }
    expect(observed).toBe(sentinel);
    expect(existsSync(workPath)).toBe(false);
    expect(existsSync(parent)).toBe(true);
    expect(readdirSync(parent)).toEqual([]);
  });
});

test('native workspace rejects noncanonical and outside parents before executing an oracle', async () => {
  await fixture(async root => {
    mkdirSync(path.join(root, '.tmp'));
    for (const parent of ['', '.', '..', '../outside', '.tmp/../outside', '.tmp//child', '.tmp/./child',
      '.tmp-other', '.tmp\\child', path.join(root, '.tmp')]) {
      let executed = false;
      await expect(withNativeTestWorkspace(root, async () => { executed = true; }, parent)).rejects.toThrow();
      expect(executed).toBe(false);
      expect(readdirSync(path.join(root, '.tmp'))).toEqual([]);
    }
  });
});

test('native child transfers cleanup to its containing executor and unproven termination preserves recovery bytes', async () => {
  await fixture(async root => {
    const parent = path.join(root, '.tmp', 'executor');
    mkdirSync(parent, { recursive: true });
    let borrowed = '';
    await withNativeTestWorkspace(root, async work => {
      borrowed = work;
      writeFileSync(path.join(work, 'output.txt'), 'caller-owned');
    }, '.tmp/executor', { parentOwnsCleanup: true });
    expect(readFileSync(path.join(borrowed, 'output.txt'), 'utf8')).toBe('caller-owned');
    const sentinel = new Error('execution-tree-termination-unproven');
    let retained = '';
    let failure: unknown;
    try {
      await withNativeTestWorkspace(root, async work => {
        retained = work;
        writeFileSync(path.join(work, 'partial.txt'), 'needed-for-recovery');
        throw sentinel;
      }, undefined, { retirementAllowed: () => false });
    } catch (error) { failure = error; }
    expect(isResourceCompositeSettlementError(failure)).toBe(true);
    if (!isResourceCompositeSettlementError(failure)) throw new Error('Expected primary and pending-retirement failures');
    const failures = readResourceCompositeSettlementFailures(failure);
    expect(failures.map(entry => entry.error)).toContain(sentinel);
    expect(readFileSync(path.join(retained, 'partial.txt'), 'utf8')).toBe('needed-for-recovery');
    expect(existsSync(borrowed)).toBe(true);
  });
});

test('native workspace rejects a linked temporary parent and a linked descendant without touching the target', async () => {
  await fixture(async root => {
    const outside = path.join(root, 'outside');
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'keep.txt'), 'foreign target');
    const temporary = path.join(root, '.tmp');
    symlinkSync(outside, temporary, process.platform === 'win32' ? 'junction' : 'dir');
    let executed = false;
    await expect(withNativeTestWorkspace(root, async () => { executed = true; })).rejects.toThrow();
    expect(executed).toBe(false);
    expect(readFileSync(path.join(outside, 'keep.txt'), 'utf8')).toBe('foreign target');
    rmSync(temporary);
    mkdirSync(temporary);
    symlinkSync(outside, path.join(temporary, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(withNativeTestWorkspace(root, async () => { executed = true; }, '.tmp/linked')).rejects.toThrow();
    expect(executed).toBe(false);
    expect(readFileSync(path.join(outside, 'keep.txt'), 'utf8')).toBe('foreign target');
  });
});

test('native workspace refuses a replacement root and retains primary plus cleanup failures', async () => {
  await fixture(async root => {
    const sentinel = new Error('primary oracle error');
    let workPath = '';
    let observed: unknown;
    try {
      await withNativeTestWorkspace(root, async work => {
        workPath = work;
        writeFileSync(path.join(work, 'original.txt'), 'original');
        renameSync(work, `${work}-moved`);
        mkdirSync(work);
        writeFileSync(path.join(work, 'replacement.txt'), 'replacement');
        throw sentinel;
      });
    } catch (error) { observed = error; }
    expect(isResourceCompositeSettlementError(observed)).toBe(true);
    if (!isResourceCompositeSettlementError(observed)) throw observed;
    const failures = readResourceCompositeSettlementFailures(observed);
    expect(failures.some(failure => failure.error === sentinel)).toBe(true);
    expect(failures.some(failure => failure.label === 'native test workspace retirement')).toBe(true);
    expect(readFileSync(path.join(workPath, 'replacement.txt'), 'utf8')).toBe('replacement');
    expect(readFileSync(path.join(`${workPath}-moved`, 'original.txt'), 'utf8')).toBe('original');
  });
});
