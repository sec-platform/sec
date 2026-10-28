import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dependencyTransitionRecordBytes, parseDependencyTransitionRecord } from '../../../src/adapters/toolchain/dependencies/runtime/dependency-transition/codec.ts';
import {
  advanceDependencyTransition, beginDependencyTransition, markDependencyTransitionFailure,
  readDependencyTransition, readDependencyTransitionLedger, transitionFailure
} from '../../../src/adapters/toolchain/dependencies/runtime/dependency-transition/operation.ts';
import { dependencyTransitionNamespacePaths } from '../../../src/adapters/toolchain/dependencies/runtime/dependency-transition/store.ts';
import { runtimeDependencyOperationControls } from '../../../src/adapters/toolchain/dependencies/runtime/operation-controls.ts';
import { runtimeDependencySourceGeneration } from '../../../src/adapters/toolchain/dependencies/runtime/source-generation.ts';
import { settleResources } from '../../../src/execution/resource-settlement.ts';

// Repository execution uses actual source compilation and retained state owners.
// Local replay explicitly replaces physical/namespace/migration/rollover/digest
// boundaries and is NOT native durability, migration or process authority proof.
async function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-transition-record-'));
  try {
    mkdirSync(path.join(root, 'source')); writeFileSync(path.join(root, 'source/value'), 'input');
    const options = runtimeDependencyOperationControls({ lockTimeoutMs: 20_000 });
    const sourceGeneration = await runtimeDependencySourceGeneration({ ownerRoot: root,
      sourcePath: path.join(root, 'source'), binding: { fixture: 'transition' }, options });
    return { root, options, sourceGeneration };
  } catch (error) {
    settleResources({ primary: { label: 'transition-record-fixture-construction', error },
      cleanup: [{ label: 'transition-record-fixture-root',
        settle: () => rmSync(root, { recursive: true, force: true }) }] });
    throw error;
  }
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

test('begin rejects a structural source clone before creating any transition namespace', async () => using(async f => {
  await assert.rejects(beginDependencyTransition({ ...request(f), sourceGeneration: { ...f.sourceGeneration } }),
    (error: unknown) => error instanceof Error && error.message.includes('was not issued by the physical source compiler'));
  assert.equal(existsSync(path.join(f.root, '.tmp')), false);
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
  await assert.rejects(advanceDependencyTransition({ ...first }, { phase: 'complete' }, f.options), {
    code: 'RUNTIME-DEPS-004',
    message: 'Dependency transition write requires an owner-admitted immutable record'
  });
}));

test('falsy failure projections stay nonempty and reach the durable writer unchanged', async () => {
  const failures = [undefined, null, false, 0, ''].map(reason => transitionFailure(reason));
  for (const failure of failures) {
    assert.equal(failure.code, 'UNKNOWN');
    assert.equal(typeof failure.message, 'string'); assert.ok(failure.message.length > 0);
  }
  // The writer unconditionally projects its reason before the common successor
  // publication. Keep the input classes above and one real persistence route.
  await using(async f => {
    const first = await beginDependencyTransition(request(f));
    const next = await markDependencyTransitionFailure(first, undefined, f.options);
    assert.deepEqual(next.failure, failures[0]); assert.equal(next.durability, 'unknown');
    assert.deepEqual(await readDependencyTransition(f.root, f.options), next);
  });
});

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
