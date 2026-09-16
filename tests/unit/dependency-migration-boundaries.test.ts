import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generatedStateDigest } from '../../src/runtime-state/generated-state/contract.ts';
import { inspectNoFollowDirectoryChain } from '../../src/runtime-state/physical/runtime/physical-no-follow.ts';
import { generatedStatePhysicalIdentity, runtimeDependencySourceGenerationEpoch } from '../../src/toolchain/dependencies/runtime/dependency-transition/contract.ts';
import { migrateLegacyDependencyTransitionUnderLease, readDependencyTransitionMigrationIntents } from '../../src/toolchain/dependencies/runtime/dependency-transition/migration.ts';
import { dependencyTransitionNamespacePaths, inspectDependencyTransitionNamespace } from '../../src/toolchain/dependencies/runtime/dependency-transition/store.ts';
import { runtimeDependencyOperationControls } from '../../src/toolchain/dependencies/runtime/operation-controls.ts';

// Uses native retained providers in repository execution. Local replay declares
// ordinary-FS physical and digest/codec boundaries explicitly; it is not FFI proof.
async function fixture(run: (root: string) => Promise<void>) {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-migration-boundary-'));
  try { await run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
const control = () => runtimeDependencyOperationControls({ lockTimeoutMs: 20_000 });
function legacy(root: string, phase: 'complete' | 'prepared' = 'complete') {
  const paths = dependencyTransitionNamespacePaths(root);
  const recordsRoot = path.join(paths.backupRoot, '.dependency-transition-v1', 'records'); mkdirSync(recordsRoot, { recursive: true });
  const physical = generatedStatePhysicalIdentity(inspectNoFollowDirectoryChain(root).target), digest = generatedStateDigest({ source: 'fixture' });
  const source = { ownerRoot: root, ownerRootPhysical: physical, physical, bindingDigest: digest, treeDigest: digest, treeEntryCount: 0 };
  const slot = { path: path.join(root, 'target'), kind: 'absent' as const, physical: null, linkTarget: null, bindingDigest: null };
  const unsigned = { schema: 'sec-dependency-transition-journal-v1', previousRecordDigest: null, sequence: 1,
    operationKey: digest, attemptNonce: 'migration-source', kind: 'compiler-generation', ownerRoot: root, ownerRootPhysical: physical,
    destination: slot, preimage: slot, stage: null, backup: null,
    sourceGeneration: { schema: 'sec-runtime-dependency-source-generation-v1', ...source, sourcePath: path.join(root, 'source'), epoch: runtimeDependencySourceGenerationEpoch(source) },
    phase, durability: 'known', failure: null };
  const record = { ...unsigned, recordDigest: generatedStateDigest(unsigned) };
  const filename = path.join(recordsRoot, `record-${record.recordDigest.slice(7)}.json`);
  writeFileSync(filename, JSON.stringify(record, null, 2) + '\n');
  return { paths, recordsRoot, filename, bytes: readFileSync(filename) };
}

test('legacy terminal migration preserves source bytes and returns immutable intent values', async () => fixture(async root => {
  const source = legacy(root), options = control();
  await migrateLegacyDependencyTransitionUnderLease(root, options);
  const namespace = inspectDependencyTransitionNamespace(root)!;
  const value = await readDependencyTransitionMigrationIntents(namespace, options);
  assert.equal(value.prepared!.phase, 'prepared'); assert.equal(value.complete!.phase, 'complete');
  assert.equal(value.complete!.previousIntentDigest, value.prepared!.intentDigest);
  assert.equal(value.complete!.targetRecordCount, 0);
  assert.ok(Object.isFrozen(value.complete!.ownerRootPhysical));
  assert.equal(Reflect.set(value.complete!.sourceRecordsRootPhysical, 'inode', 'changed'), false);
  assert.deepEqual(readFileSync(source.filename), source.bytes);
  assert.deepEqual(readdirSync(namespace.recordsRoot.path), []);
}));

test('completed migration remains idempotent and a reader never acquires write callbacks', async () => fixture(async root => {
  legacy(root); await migrateLegacyDependencyTransitionUnderLease(root, control());
  await migrateLegacyDependencyTransitionUnderLease(root, { ...control(), async beforeCommit() { assert.fail('complete migration rewrote state'); } });
  const options = new Proxy({ ...control(), get beforeCommit() { assert.fail('reader observed fence'); throw new Error('unreachable'); },
    get installMode() { assert.fail('reader observed install mode'); throw new Error('unreachable'); } }, { ownKeys() { assert.fail('reader enumerated facade'); } });
  const value = await readDependencyTransitionMigrationIntents(inspectDependencyTransitionNamespace(root)!, options);
  assert.equal(value.complete!.phase, 'complete');
}));

test('cancelled migration without any source refuses before namespace effects', async () => fixture(async root => {
  const controller = new AbortController(), reason = Object.freeze({ stopped: true });
  const options = runtimeDependencyOperationControls({ signal: controller.signal }); controller.abort(reason);
  await assert.rejects(migrateLegacyDependencyTransitionUnderLease(root, options), error => error === reason);
  assert.equal(existsSync(dependencyTransitionNamespacePaths(root).backupRoot), false);
}));

test('a nonterminal legacy source cannot create a new v2 namespace', async () => fixture(async root => {
  const source = legacy(root, 'prepared');
  await assert.rejects(migrateLegacyDependencyTransitionUnderLease(root, control()), /terminal/);
  assert.equal(existsSync(source.paths.journalRoot), false); assert.deepEqual(readFileSync(source.filename), source.bytes);
}));

test('migration captures its root before a fence changes cwd and options', async () => fixture(async root => {
  legacy(root); const cwd = process.cwd(); let calls = 0;
  const options = { ...control(), async beforeCommit() { calls++; process.chdir(tmpdir()); options.beforeCommit = async () => assert.fail('replacement callback'); } };
  try {
    process.chdir(root); await migrateLegacyDependencyTransitionUnderLease('.', options);
    assert.ok(calls > 0); assert.equal((await readDependencyTransitionMigrationIntents(inspectDependencyTransitionNamespace(root)!, control())).complete!.phase, 'complete');
  } finally { process.chdir(cwd); }
}));

test('interrupted prepared migration resumes from its existing receipt without altering v1', async () => fixture(async root => {
  const source = legacy(root), failure = new Error('interrupted'); let injected = false;
  await assert.rejects(migrateLegacyDependencyTransitionUnderLease(root, { ...control(), async beforeCommit() {
    if (!injected && existsSync(source.paths.journalRoot) && readdirSync(source.paths.journalRoot).some(name => /^migration-.*-prepared\.json$/.test(name))) {
      injected = true; throw failure;
    }
  } }), error => error === failure);
  assert.equal(injected, true); assert.deepEqual(readFileSync(source.filename), source.bytes);
  await migrateLegacyDependencyTransitionUnderLease(root, control());
  const intents = await readDependencyTransitionMigrationIntents(inspectDependencyTransitionNamespace(root)!, control());
  assert.equal(intents.complete!.phase, 'complete'); assert.deepEqual(readFileSync(source.filename), source.bytes);
}));

test('cancellation after intent enumeration starts cannot produce a successful result', async () => fixture(async root => {
  legacy(root); await migrateLegacyDependencyTransitionUnderLease(root, control());
  const controller = new AbortController(), reason = new Error('cancelled');
  const options = runtimeDependencyOperationControls({ signal: controller.signal });
  const pending = readDependencyTransitionMigrationIntents(inspectDependencyTransitionNamespace(root)!, options);
  controller.abort(reason); await assert.rejects(pending, error => error === reason);
}));

test('migration is a true no-effect operation when both source and target are absent', async () => fixture(async root => {
  await migrateLegacyDependencyTransitionUnderLease(root, { ...control(), async beforeCommit() { assert.fail('unnecessary effect'); } });
  assert.equal(existsSync(dependencyTransitionNamespacePaths(root).backupRoot), false);
}));
