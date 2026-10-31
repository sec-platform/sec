import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { ResourceCompositeSettlementError as PhysicalResourceCompositeSettlementError, settleResources as settlePhysicalResources, settleResourcesAsync as settlePhysicalResourcesAsync } from '../../../src/execution/resource-settlement.ts';

test('synchronous settlement preserves exact primary failures and still attempts every cleanup', async () => {
  const events: string[] = [], failure = new Error('first cleanup');
  await assert.rejects(async () => settlePhysicalResources({ cleanup: [
    { label: 'first', settle() { events.push('first'); throw failure; } },
    { label: 'second', settle() { events.push('second'); } }
  ] }), error => {
    assert.ok(error instanceof PhysicalResourceCompositeSettlementError);
    assert.deepEqual(error.failures, [{ label: 'first', error: failure }]);
    assert.deepEqual(error.errors, [failure]);
    return true;
  });
  assert.deepEqual(events, ['first', 'second']);
  const unaccompanied = new Error('operation failed');
  await assert.rejects(async () => settlePhysicalResources({ primary: { label: 'run', error: unaccompanied }, cleanup: [] }),
    error => error === unaccompanied);
  await assert.rejects(async () => settlePhysicalResources({ primary: { label: 'run', error: null }, cleanup: [{
    label: 'cleanup', settle() { events.push('primary-cleanup'); }
  }] }), error => error === null);
  assert.deepEqual(events, ['first', 'second', 'primary-cleanup']);
});

test('async settlement waits for each cleanup before attempting peers and returning', async () => {
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(r => { release = r; }), begun = new Promise<void>(r => { entered = r; });
  const events: string[] = [];
  const second = { label: 'second', async settle() { events.push('start:second'); await Promise.resolve(); events.push('second'); } };
  const third = { label: 'third', settle() { events.push('third'); } };
  const pending = settlePhysicalResourcesAsync({ cleanup: [{ label: 'first', async settle() { entered(); await held; events.push('first'); } }, second, third] });
  try {
    await begun;
    assert.deepEqual(events, []);
  } finally { release(); await pending; }
  assert.deepEqual(events, ['first', 'start:second', 'second', 'third']);
});

test('async settlement preserves the primary and all cleanup failures while attempting every peer', async () => {
  const primary = undefined;
  const first = new Error('first cleanup'), third = new Error('third cleanup');
  const events: string[] = [];
  const primaryInput = { label: 'run', error: primary };
  await assert.rejects(settlePhysicalResourcesAsync({ primary: primaryInput, cleanup: [
    { label: 'first', async settle() {
      events.push('first'); throw first;
    } },
    { label: 'second', async settle() { events.push('second'); } },
    { label: 'third', async settle() { events.push('third'); throw third; } }
  ] }), error => {
    assert.ok(error instanceof PhysicalResourceCompositeSettlementError);
    assert.deepEqual(error.failures, [
      { label: 'run', error: primary },
      { label: 'first', error: first },
      { label: 'third', error: third }
    ]);
    assert.deepEqual(error.errors, [primary, first, third]);
    return true;
  });
  assert.deepEqual(events, ['first', 'second', 'third']);
});
