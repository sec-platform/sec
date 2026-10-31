import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { dependencyTransitionRecordBytes, transitionRecordName } from '../../../src/adapters/toolchain/dependencies/runtime/dependency-transition/codec.ts';
import { inspectActiveDependencyTransitionRollover, recoverDependencyTransitionRollover, rolloverDependencyTransitionLedger } from '../../../src/adapters/toolchain/dependencies/runtime/dependency-transition/rollover.ts';
import { dependencyTransitionLedgerDigest, inspectDependencyTransitionNamespace } from '../../../src/adapters/toolchain/dependencies/runtime/dependency-transition/store.ts';
import { runtimeDependencyOperationControls } from '../../../src/adapters/toolchain/dependencies/runtime/operation-controls.ts';
import { canonicalJson } from '../../../src/contracts/canonical.ts';
import { formatJsonFile } from "../../../src/contracts/json-text.ts";
import { createRolloverFixture } from '../../helpers/rollover-fixture.ts';
import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';

type Fixture = ReturnType<typeof createRolloverFixture>;
async function using(run: (f: Fixture) => Promise<void>) {
  const f = createRolloverFixture();
  return settleWorkspaceCallback(() => run(f), async () => f.cleanup());
}
async function assertComplete(f: Fixture) {
  const result = await inspectActiveDependencyTransitionRollover(f.root, f.options);
  assert.equal(result?.active, null); assert.equal(result?.latestComplete?.phase, 'complete');
  assert.deepEqual(fs.readdirSync(f.paths.recordsRoot), [transitionRecordName(f.checkpoint.recordDigest)]);
  assert.deepEqual(fs.readFileSync(path.join(f.paths.recordsRoot, transitionRecordName(f.checkpoint.recordDigest))), dependencyTransitionRecordBytes(f.checkpoint));
  assert.equal(fs.existsSync(f.prepared.retiredRecordsPath), false); assert.equal(fs.existsSync(f.prepared.nextRecordsPath), false);
  return result!;
}
async function stopAtRetirement(f: Fixture) {
  const stop = new Error('intentional retirement interruption');
  await assert.rejects(recoverDependencyTransitionRollover(f.root, { ...f.options, async beforeCommit() {
    if (fs.existsSync(f.receiptPath('retiring'))) throw stop;
  } }), e => e === stop);
  assert.equal(fs.existsSync(f.receiptPath('retiring')), true);
}

// All production source is used in native execution. The accompanying local
// replay explicitly substitutes physical/store providers, not parser or phases.
test('prepared recovery preserves read-only immutable observation and is idempotent after completion', async () => using(async f => {
  fs.mkdirSync(f.prepared.nextRecordsPath);
  const controls = new Proxy({ ...f.options, get beforeCommit() { assert.fail('write callback'); throw new Error('unreachable'); },
    get generatedStateLifecycle() { return assert.fail('lifecycle'); }, get installMode() { return assert.fail('mode'); }
  }, { ownKeys() { assert.fail('whole input enumeration'); } });
  const observed = await inspectActiveDependencyTransitionRollover(f.root, controls);
  assert.equal(observed?.active?.phase, 'prepared');
  assert.equal(Reflect.set(observed!.active!.checkpoint.sourceGeneration.physical, 'inode', 'changed'), false);
  assert.equal(Reflect.set(observed!.active!.ownerRootPhysical, 'inode', 'changed'), false);
  assert.equal(Object.isFrozen(observed!.active!.checkpoint), true);
  await recoverDependencyTransitionRollover(f.root, f.options);
  const before = await assertComplete(f);
  await recoverDependencyTransitionRollover(f.root, { ...f.options, async beforeCommit() { assert.fail('already completed effect'); } });
  assert.deepEqual(await assertComplete(f), before);
}));

for (let boundary = 1; boundary <= 16; boundary++) {
  test(`an interruption at effect boundary ${boundary} resumes without losing a phase or checkpoint`, async () => using(async f => {
    const stop = Object.freeze({ boundary }); let effects = 0;
    await assert.rejects(recoverDependencyTransitionRollover(f.root, { ...f.options, async beforeCommit() {
      if (++effects === boundary) throw stop;
    } }), e => e === stop);
    if (boundary === 14) {
      assert.equal(fs.existsSync(f.receiptPath('retiring')), true);
      assert.deepEqual(fs.readdirSync(f.prepared.retiredRecordsPath), []);
    }
    await recoverDependencyTransitionRollover(f.root, f.options);
    await assertComplete(f);
  }), 60_000);
}

test('missing inventory with a surviving record never authorizes deleting that record', async () => using(async f => {
  await stopAtRetirement(f);
  const names = fs.readdirSync(f.prepared.retiredRecordsPath);
  for (const name of names.filter(n => n.startsWith('disposal-inventory'))) fs.unlinkSync(path.join(f.prepared.retiredRecordsPath, name));
  const remaining = fs.readdirSync(f.prepared.retiredRecordsPath);
  await assert.rejects(recoverDependencyTransitionRollover(f.root, f.options), /inventory.*absent/);
  assert.deepEqual(fs.readdirSync(f.prepared.retiredRecordsPath), remaining);
}));

test('unknown late-sorting residue vetoes all archive deletions before effects', async () => using(async f => {
  await stopAtRetirement(f);
  fs.writeFileSync(path.join(f.prepared.retiredRecordsPath, 'zz-user-file'), 'keep');
  const before = fs.readdirSync(f.prepared.retiredRecordsPath); let effects = 0;
  await assert.rejects(recoverDependencyTransitionRollover(f.root, { ...f.options, async beforeCommit() { effects++; } }), /foreign residue/);
  assert.equal(effects, 0); assert.deepEqual(fs.readdirSync(f.prepared.retiredRecordsPath), before);
}));

test('a missing replacement checkpoint preserves the old archive', async () => using(async f => {
  await stopAtRetirement(f);
  const before = fs.readdirSync(f.prepared.retiredRecordsPath);
  fs.unlinkSync(path.join(f.paths.recordsRoot, transitionRecordName(f.checkpoint.recordDigest)));
  await assert.rejects(recoverDependencyTransitionRollover(f.root, f.options), /checkpoint/);
  assert.deepEqual(fs.readdirSync(f.prepared.retiredRecordsPath), before);
}));

test('a record modified in the effect fence is rechecked before deletion', async () => using(async f => {
  await stopAtRetirement(f);
  const record = fs.readdirSync(f.prepared.retiredRecordsPath).filter(n => n.startsWith('record-')).sort()[0]!;
  let changed = false;
  await assert.rejects(recoverDependencyTransitionRollover(f.root, { ...f.options, async beforeCommit() {
    if (!changed) { changed = true; fs.writeFileSync(path.join(f.prepared.retiredRecordsPath, record), 'user-change'); }
  } }), /changed after disposal/);
  assert.equal(fs.readFileSync(path.join(f.prepared.retiredRecordsPath, record), 'utf8'), 'user-change');
}));

test('replacement removed by the commit fence prevents the first archive leaf deletion', async () => using(async f => {
  await stopAtRetirement(f); const before = fs.readdirSync(f.prepared.retiredRecordsPath); let changed = false;
  await assert.rejects(recoverDependencyTransitionRollover(f.root, { ...f.options, async beforeCommit() {
    if (!changed) { changed = true; fs.unlinkSync(path.join(f.paths.recordsRoot, transitionRecordName(f.checkpoint.recordDigest))); }
  } }), /checkpoint changed/);
  assert.deepEqual(fs.readdirSync(f.prepared.retiredRecordsPath), before);
}));

test('recovery captures its relative root and fence before callback mutation', async () => using(async f => {
  const previous = process.cwd();
  const options = { ...f.options, async beforeCommit() {
    process.chdir(path.dirname(f.root)); options.beforeCommit = async () => assert.fail('replacement fence');
  } };
  try {
    process.chdir(f.root);
    await recoverDependencyTransitionRollover('.', options);
    await assertComplete(f);
  } finally { process.chdir(previous); }
}));

test('cancellation during an empty census is not returned as successful observation', async () => using(async f => {
  fs.unlinkSync(f.receiptPath('prepared'));
  const controller = new AbortController(), reason = new Error('cancelled');
  const options = runtimeDependencyOperationControls({ ...f.options, signal: controller.signal });
  const pending = inspectActiveDependencyTransitionRollover(f.root, options); controller.abort(reason);
  await assert.rejects(pending, e => e === reason);
}));

test('canonical JSON bytes cannot admit malformed UTF-8 through replacement-character decoding', async () => using(async f => {
  // Metadata objectId is a string and participates in the stable identity digest;
  // a later phase-only value permits valid JSON with a replacement character.
  await stopAtRetirement(f);
  const raw = fs.readFileSync(f.receiptPath('retiring'));
  const parsed = JSON.parse(raw.toString());
  parsed.publishedRecordsRootPhysical.objectId = '\ufffd';
  const canonical = Buffer.from(formatJsonFile(canonicalJson(parsed)));
  const at = canonical.indexOf(Buffer.from('\ufffd')); assert.ok(at >= 0);
  const corrupted = Buffer.concat([canonical.subarray(0, at), Buffer.from([0xff]), canonical.subarray(at + 3)]);
  fs.writeFileSync(f.receiptPath('retiring'), corrupted);
  await assert.rejects(inspectActiveDependencyTransitionRollover(f.root, f.options), /canonical/);
}));

test('a disposal inventory digest round-trips the existing v1 decoded projection exactly', async () => using(async f => {
  await stopAtRetirement(f);
  const name = fs.readdirSync(f.prepared.retiredRecordsPath).find(n => n.startsWith('disposal-inventory-'))!;
  const source = fs.readFileSync(path.join(f.prepared.retiredRecordsPath, name));
  const inventory = JSON.parse(source.toString('utf8'));
  const { generatedStateDigest } = await import("../../../src/execution/generated-state/contract.ts");
  // Historical valid v1 bytes are hashed using this fixed outer field order
  // and the already-canonical nested object order. No second schema is needed.
  const expectedDigest = generatedStateDigest({ schema: inventory.schema, intentDigest: inventory.intentDigest,
    archivePhysical: inventory.archivePhysical, ledgerDigest: inventory.ledgerDigest,
    recordCount: inventory.recordCount, entries: inventory.entries });
  assert.equal(inventory.inventoryDigest, expectedDigest);
  assert.deepEqual(Buffer.from(formatJsonFile(canonicalJson(inventory))), source);
  await recoverDependencyTransitionRollover(f.root, f.options); await assertComplete(f);
}));

test('phase-specific physical identity substitution is rejected before recovery effects', async () => using(async f => {
  await stopAtRetirement(f);
  const receipt = JSON.parse(fs.readFileSync(f.receiptPath('retiring'), 'utf8'));
  // These phase-specific fields do not contribute to the stable intent digest.
  receipt.publishedRecordsRootPhysical.inode = 'substituted';
  fs.writeFileSync(f.receiptPath('retiring'), formatJsonFile(canonicalJson(receipt)));
  const before = fs.readdirSync(f.prepared.retiredRecordsPath); let effects = 0;
  await assert.rejects(recoverDependencyTransitionRollover(f.root, { ...f.options, async beforeCommit() { effects++; } }), /continuity/);
  assert.equal(effects, 0); assert.deepEqual(fs.readdirSync(f.prepared.retiredRecordsPath), before);
}));

test('a complete historical epoch cannot silently have its physical checkpoint changed', async () => using(async f => {
  await recoverDependencyTransitionRollover(f.root, f.options);
  const receipt = JSON.parse(fs.readFileSync(f.receiptPath('complete'), 'utf8'));
  receipt.publishedRecordsRootPhysical.objectId = 'other';
  fs.writeFileSync(f.receiptPath('complete'), formatJsonFile(canonicalJson(receipt)));
  await assert.rejects(inspectActiveDependencyTransitionRollover(f.root, f.options), /continuity/);
}));

test('a ledger below the canonical rollover threshold performs no namespace or publication effects', async () => using(async f => {
  fs.unlinkSync(f.receiptPath('prepared'));
  fs.mkdirSync(f.paths.backupRoot, { recursive: true });
  const ledger = { namespace: inspectDependencyTransitionNamespace(f.root)!, records: f.records,
    ledgerDigest: dependencyTransitionLedgerDigest(f.records), tip: f.terminal };
  await assert.rejects(rolloverDependencyTransitionLedger(f.root, ledger, f.terminal,
    { ...f.options, beforeCommit() { assert.fail('premature namespace effect'); } }), /predecessor receipt/);
  assert.deepEqual(fs.readdirSync(f.paths.rolloversRoot), []);
  assert.equal(fs.readdirSync(f.paths.recordsRoot).length, f.records.size);
}));
