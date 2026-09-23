import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dependencyTransitionRecordBytes, parseDependencyTransitionRecord } from '../../src/adapters/toolchain/dependencies/runtime/dependency-transition/codec.ts';
import {
  advanceDependencyTransition, beginDependencyTransition, markDependencyTransitionFailure,
  readDependencyTransition, readDependencyTransitionLedger, transitionFailure
} from '../../src/adapters/toolchain/dependencies/runtime/dependency-transition/operation.ts';
import { dependencyTransitionNamespacePaths } from '../../src/adapters/toolchain/dependencies/runtime/dependency-transition/store.ts';
import { runtimeDependencyOperationControls } from '../../src/adapters/toolchain/dependencies/runtime/operation-controls.ts';
import { runtimeDependencySourceGeneration } from '../../src/adapters/toolchain/dependencies/runtime/source-generation.ts';

// Repository execution uses actual source compilation and retained state owners.
// Local replay explicitly replaces physical/namespace/migration/rollover/digest
// boundaries and is NOT native durability, migration or process authority proof.
async function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-transition-record-'));
  mkdirSync(path.join(root, 'source')); writeFileSync(path.join(root, 'source/value'), 'input');
  const options = runtimeDependencyOperationControls({ lockTimeoutMs: 20_000 });
  const sourceGeneration = await runtimeDependencySourceGeneration({ ownerRoot: root,
    sourcePath: path.join(root, 'source'), binding: { fixture: 'transition' }, options });
  return { root, options, sourceGeneration };
}
function request(f: Awaited<ReturnType<typeof fixture>>) {
  return { kind: 'compiler-bridge' as const, ownerRoot: f.root, destinationPath: path.join(f.root, 'bridge'),
    stagePath: null, stageRootPath: null, backupPath: null, sourceGeneration: f.sourceGeneration,
    bindingDigest: f.sourceGeneration.bindingDigest, options: f.options };
}
async function using(run: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  const f = await fixture(); try { await run(f); } finally { rmSync(f.root, { recursive: true, force: true }); }
}

function assertDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value));
  for (const nested of Object.values(value)) assertDeepFrozen(nested);
}

test('begin, successor and durable readback retain one exact canonical immutable record', async () => using(async f => {
  const first = await beginDependencyTransition(request(f));
  assert.equal(first.phase, 'prepared'); assert.equal(first.sequence, 1);
  assert.deepEqual(await readDependencyTransition(f.root, f.options), first);
  assertDeepFrozen(first);
  const second = await advanceDependencyTransition(first, { phase: 'complete' }, f.options);
  assert.equal(second.sequence, 2); assert.equal(second.previousRecordDigest, first.recordDigest);
  assert.equal(second.operationKey, first.operationKey); assertDeepFrozen(second);
  assert.deepEqual(await readDependencyTransition(f.root, f.options), second);
  const parsed = parseDependencyTransitionRecord(dependencyTransitionRecordBytes(second));
  assertDeepFrozen(parsed); assert.deepEqual(parsed, second);
}));

test('begin never retargets owner or source after asynchronous slot observation starts', async () => using(async f => {
  const input = request(f);
  const expectedDestination = input.destinationPath;
  const pending = beginDependencyTransition(input);
  Object.assign(input, { ownerRoot: path.join(f.root, 'missing-owner'), destinationPath: path.join(f.root, 'other'),
    sourceGeneration: { ...f.sourceGeneration, ownerRoot: path.join(f.root, 'missing-source') } });
  const result = await pending;
  assert.equal(result.ownerRoot, f.root); assert.equal(result.destination.path, expectedDestination);
  assert.equal(result.sourceGeneration.ownerRoot, f.root);
}));

test('relative begin paths are interpreted at invocation, not after an await changes cwd', async () => using(async f => {
  const original = process.cwd();
  try {
    process.chdir(f.root);
    const pending = beginDependencyTransition({ ...request(f), ownerRoot: '.', destinationPath: 'bridge' });
    process.chdir(tmpdir());
    const result = await pending;
    assert.equal(result.ownerRoot, f.root); assert.equal(result.destination.path, path.join(f.root, 'bridge'));
  } finally { process.chdir(original); }
}));

test('begin captures only known request fields and narrows effect options before callbacks', async () => using(async f => {
  let calls = 0;
  const rawOptions = new Proxy({ ...f.options, beforeCommit: async () => { calls++; },
    get generatedStateLifecycle() { assert.fail('unrelated lifecycle'); throw new Error('unreachable'); }, get testMaterialization() { assert.fail('test capability'); throw new Error('unreachable'); }
  }, { ownKeys() { assert.fail('whole options enumeration'); } });
  const input = { ...request(f), options: rawOptions };
  const pending = beginDependencyTransition(input);
  rawOptions.beforeCommit = async () => assert.fail('late replacement');
  await pending; assert.ok(calls > 0);
}));

test('each begin decision field is captured once before provider calls', async () => using(async f => {
  const values = request(f), reads = new Map<string, number>(), input = {};
  for (const [key, value] of Object.entries(values)) Object.defineProperty(input, key,
    { enumerable: true, get() { reads.set(key, (reads.get(key) ?? 0) + 1); return value; } });
  await beginDependencyTransition(input as typeof values);
  assert.ok([...reads.values()].every(count => count === 1));
}));

for (const [key, value] of [['sequence', 3], ['attemptNonce', 'replaced'], ['operationKey', 'sha256:' + '0'.repeat(64)],
  ['previousRecordDigest', null], ['preimage', null], ['schema', 'wrong']] as const) {
  test(`a successor cannot override immutable ${key}`, async () => using(async f => {
    const first = await beginDependencyTransition(request(f)); let effects = 0;
    await assert.rejects(advanceDependencyTransition(first, { phase: 'complete', [key]: value } as never,
      { ...f.options, async beforeCommit() { effects++; } }));
    assert.equal(effects, 0); assert.deepEqual(await readDependencyTransition(f.root, f.options), first);
  }));
}

test('update accessors, hidden fields and symbols are refused before evaluating their values', async () => using(async f => {
  const first = await beginDependencyTransition(request(f));
  const accessor = Object.defineProperty({}, 'phase', { enumerable: true, get() { assert.fail('getter invoked'); } });
  const hidden = Object.defineProperty({}, 'phase', { value: 'complete', enumerable: false });
  for (const patch of [accessor, hidden, { phase: 'complete', [Symbol('extra')]: true }, null, []]) {
    await assert.rejects(advanceDependencyTransition(first, patch as never, f.options));
  }
  assert.deepEqual(await readDependencyTransition(f.root, f.options), first);
}));

test('nested successor data cannot drift during namespace admission or publication', async () => using(async f => {
  const first = await beginDependencyTransition(request(f));
  const failure = { code: 'ORIGINAL', message: 'original failure' };
  const next = await advanceDependencyTransition(first, { phase: 'recovery-required', durability: 'unknown', failure },
    { ...f.options, async beforeCommit() { failure.code = 'REPLACED'; failure.message = 'changed'; } });
  assert.deepEqual(next.failure, { code: 'ORIGINAL', message: 'original failure' });
  assert.notEqual(next.failure, failure); assertDeepFrozen(next);
  assert.deepEqual(await readDependencyTransition(f.root, f.options), next);
}));

test('the existing record schema refuses malformed updates before any namespace effect', async () => using(async f => {
  const first = await beginDependencyTransition(request(f)); let effects = 0;
  await assert.rejects(advanceDependencyTransition(first, { phase: 'not-a-phase' as never },
    { ...f.options, async beforeCommit() { effects++; } }));
  assert.equal(effects, 0);
  assert.deepEqual(await readDependencyTransition(f.root, f.options), first);
}));

test('invalid begin record shape is rejected before creating a ledger namespace', async () => using(async f => {
  let effects = 0;
  await assert.rejects(beginDependencyTransition({ ...request(f), kind: 'unknown-kind' as never,
    options: { ...f.options, async beforeCommit() { effects++; } } }));
  assert.equal(effects, 0); assert.equal(existsSync(dependencyTransitionNamespacePaths(f.root).recordsRoot), false);
}));

test('project runtime bridge records bind a project locator to an external issued source generation', async () => using(async f => {
  const projectRoot = path.join(f.root, 'project');
  mkdirSync(projectRoot);
  const record = await beginDependencyTransition({
    ...request(f),
    kind: 'project-runtime-bridge',
    ownerRoot: projectRoot,
    destinationPath: path.join(projectRoot, 'node_modules')
  });
  assert.equal(record.ownerRoot, projectRoot);
  assert.equal(record.sourceGeneration.ownerRoot, f.root);
  assert.deepEqual(parseDependencyTransitionRecord(dependencyTransitionRecordBytes(record)), record);
}));

test('read-only observation ignores effect capabilities and has no namespace creation side effect', async () => using(async f => {
  const options = new Proxy({ ...f.options, get beforeCommit() { assert.fail('reader acquired write fence'); throw new Error('unreachable'); },
    get generatedStateLifecycle() { assert.fail('reader acquired lifecycle'); throw new Error('unreachable'); } }, { ownKeys() { assert.fail('reader enumerated facade'); } });
  assert.equal(await readDependencyTransitionLedger(f.root, options), null);
  assert.equal(existsSync(dependencyTransitionNamespacePaths(f.root).recordsRoot), false);
}));

test('cancellation during an absent-ledger observation does not become a successful null result', async () => using(async f => {
  const controller = new AbortController(), reason = new Error('cancelled');
  const options = runtimeDependencyOperationControls({ ...f.options, signal: controller.signal });
  const pending = readDependencyTransitionLedger(f.root, options); controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
}));

test('a structural clone of a valid record is not admitted to effectful succession', async () => using(async f => {
  const first = await beginDependencyTransition(request(f));
  await assert.rejects(advanceDependencyTransition({ ...first }, { phase: 'complete' }, f.options), /owner-admitted/);
}));

for (const reason of [undefined, null, false, 0, '']) {
  test(`failure ${String(reason)} can be recorded without a secondary description exception`, async () => using(async f => {
    const first = await beginDependencyTransition(request(f));
    const failure = transitionFailure(reason);
    assert.equal(typeof failure.code, 'string'); assert.ok(failure.code.length > 0);
    assert.equal(typeof failure.message, 'string'); assert.ok(failure.message.length > 0);
    const next = await markDependencyTransitionFailure(first, reason, f.options);
    assert.deepEqual(next.failure, failure); assert.equal(next.durability, 'unknown');
    assert.deepEqual(await readDependencyTransition(f.root, f.options), next);
  }));
}

test('hostile failure objects cannot prevent the transition failure record from being produced', async () => using(async f => {
  const first = await beginDependencyTransition(request(f));
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  const projected = transitionFailure(proxy);
  assert.equal(projected.code, 'UNKNOWN'); assert.ok(projected.message.length > 0);
  const next = await markDependencyTransitionFailure(first, proxy, f.options);
  assert.deepEqual(next.failure, projected);
  let conversions = 0;
  const reason = { get code() { throw new Error('code'); }, toString() { conversions++; throw new Error('string'); } };
  assert.equal(transitionFailure(reason).code, 'UNKNOWN'); assert.equal(conversions, 0);
}));
