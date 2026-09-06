import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { analyzeRolloverHistory } from '../../src/toolchain/dependencies/runtime/dependency-transition/rollover-history.ts';
import { isRolloverPhase, rolloverIntentNameMatches, assertRolloverPhaseAdvance } from '../../src/toolchain/dependencies/runtime/dependency-transition/rollover-phase.ts';
import type { DependencyTransitionRolloverIntent as Intent } from '../../src/toolchain/dependencies/runtime/dependency-transition/rollover.ts';

const id = (n: number) => `sha256:${n.toString(16).padStart(64, '0')}` as const;
const physical = (n: number) => ({ device: 'test-device', inode: String(n), objectId: `object-${n}` });
function epoch(n = 1): Intent[] {
  const source = physical(n), next = physical(n + 1);
  // Expected states are test inputs independent of the production phase table.
  const states = [
    ['prepared', null, null, null, false], ['staged', null, next, null, false],
    ['backed-up', source, next, null, false], ['published', source, null, next, false],
    ['retiring', source, null, next, false], ['retired', null, null, next, true], ['complete', null, null, next, true]
  ] as const;
  return states.map(([phase, retiredRecordsPhysical, nextRecordsPhysical, publishedRecordsRootPhysical, retiredRecordsDisposed]) => ({
    schema: 'sec-dependency-transition-rollover-v1', intentDigest: id(n), previousIntentDigest: n === 1 ? null : id(n - 1),
    sequence: n, phase, ownerRoot: '/workspace', ownerRootPhysical: physical(0), recordsRootPath: '/workspace/records',
    sourceRecordsRootPhysical: source, retiredRecordsPath: `/workspace/rollovers/records-retired-${n}`,
    nextRecordsPath: `/workspace/rollovers/records-next-${n}`, retiredRecordsPhysical, nextRecordsPhysical,
    publishedRecordsRootPhysical, retiredRecordsDisposed, terminalRecordDigest: id(100 + n), ledgerDigest: id(200 + n),
    recordCount: 3, checkpoint: { recordDigest: id(300 + n) } as Intent['checkpoint']
  }));
}
const inspect = (records: Intent[], residue: string[] = []) => analyzeRolloverHistory(records, residue, () => {});

test('all legal phase prefixes retain exact latest objects and accept arbitrary census order', () => {
  const values = epoch();
  for (let i = 1; i <= values.length; i++) {
    const result = inspect(values.slice(0, i).reverse());
    assert.equal(result.active, i === 7 ? null : values[i - 1]);
    assert.equal(result.latestComplete, i === 7 ? values[6] : null); assert.ok(Object.isFrozen(result));
  }
});

test('one prepared receipt owns an unrecorded next directory after an interrupted creation', () => {
  assert.equal(inspect(epoch().slice(0, 1), ['records-next-1']).active?.phase, 'prepared');
  assert.throws(() => inspect(epoch(), ['records-next-1']), /foreign/);
});

test('multiple epochs bind source identity to the actual previous published root', () => {
  const records = [...epoch(), ...epoch(2).slice(0, 3)]; const result = inspect(records.reverse());
  assert.equal(result.active?.sequence, 2); assert.equal(result.latestComplete?.sequence, 1);
  const bad = epoch(2).map(r => ({ ...r, sourceRecordsRootPhysical: physical(900) }));
  assert.throws(() => inspect([...epoch(), ...bad.slice(0, 1)]), /physical records generation/);
});

test('stable digest equality alone cannot authorize a substituted next or published directory', () => {
  const first = epoch(); first[2] = { ...first[2]!, nextRecordsPhysical: physical(999) };
  assert.throws(() => inspect(first), /continuity/);
  const second = epoch(); second[4] = { ...second[4]!, publishedRecordsRootPhysical: physical(999) };
  assert.throws(() => inspect(second), /continuity/);
});

test('a retired archive must be the same source directory, not another exact-looking object', () => {
  const receipts = epoch(); receipts[2] = { ...receipts[2]!, retiredRecordsPhysical: physical(999) };
  assert.throws(() => inspect(receipts), /phase/);
});

test('duplicates, missing prefixes and phase jumps never select an arbitrary receipt', () => {
  const receipts = epoch();
  for (const values of [[receipts[1]!], [...receipts, receipts[3]!], receipts.filter((_, i) => i !== 2)]) assert.throws(() => inspect(values));
  assert.throws(() => assertRolloverPhaseAdvance(receipts[0]!, receipts[2]!));
});

test('forked, disconnected, missing and incomplete predecessor histories reject', () => {
  const a = epoch(), b = epoch(2), c = epoch(3).map(r => ({ ...r, previousIntentDigest: id(1), sequence: 2 }));
  for (const records of [[...a, ...b, ...c], b, [...a.slice(0, 5), ...b], [...a, ...epoch(3)]]) assert.throws(() => inspect(records));
});

test('unknown residue remains preserved and cannot be hidden by an empty receipt collection', () => {
  assert.deepEqual(inspect([]), { active: null, latestComplete: null });
  assert.throws(() => inspect([], ['records-next-1']), /foreign/);
  assert.throws(() => inspect(epoch().slice(0, 3), ['records-next-other']), /foreign/);
});

test('every history traversal uses caller budget checks, including an empty result', () => {
  const failure = {}; assert.throws(() => analyzeRolloverHistory([], [], () => { throw failure; }), e => e === failure);
  let checks = 0;
  assert.throws(() => analyzeRolloverHistory([...epoch(), ...epoch(2)], [], () => { if (++checks === 20) throw failure; }), e => e === failure);
  assert.equal(checks, 20);
});

test('phase IDs and receipt spelling reject inherited or unrecognized values', () => {
  for (const value of ['constructor', '__proto__', '', null, 1, false]) assert.equal(isRolloverPhase(value), false);
  assert.equal(rolloverIntentNameMatches(`rollover-${'a'.repeat(64)}-prepared.json`), true);
  for (const name of [`rollover-${'a'.repeat(64)}-unknown.json`, `rollover-${'a'.repeat(63)}-prepared.json`, '../rollover-x-prepared.json']) assert.equal(rolloverIntentNameMatches(name), false);
});

test('history work grows linearly in accepted receipt count, not in possible epoch pairs', () => {
  const records = Array.from({ length: 200 }, (_, i) => epoch(i + 1)).flat();
  let checks = 0; const result = analyzeRolloverHistory(records, [], () => { checks++; });
  assert.equal(result.latestComplete?.sequence, 200); assert.equal(result.active, null);
  assert.ok(checks < records.length * 4 + 10);
});
