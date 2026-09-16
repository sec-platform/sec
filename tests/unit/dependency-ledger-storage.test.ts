import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generatedStateDigest } from '../../src/runtime-state/generated-state/contract.ts';
import { inspectNoFollowDirectoryChain } from '../../src/runtime-state/physical/runtime/physical-no-follow.ts';
import { dependencyTransitionDigestWithoutRecord, dependencyTransitionRecordBytes, transitionRecordName } from '../../src/toolchain/dependencies/runtime/dependency-transition/codec.ts';
import { generatedStatePhysicalIdentity, runtimeDependencySourceGenerationEpoch, type DependencyTransitionJournal } from '../../src/toolchain/dependencies/runtime/dependency-transition/contract.ts';
import {
  dependencyTransitionNamespacePaths, ensureDependencyTransitionNamespace, inspectDependencyTransitionNamespace,
  readDependencyTransitionRecordSet,
  readNoFollowDirectNames
} from '../../src/toolchain/dependencies/runtime/dependency-transition/store.ts';
import { runtimeDependencyOperationContext, runtimeDependencyOperationControls } from '../../src/toolchain/dependencies/runtime/operation-controls.ts';

async function fixture(run: (root: string) => Promise<void>) {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-ledger-storage-'));
  try { await run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
const controls = () => runtimeDependencyOperationControls({ lockTimeoutMs: 20_000 });
function record(root: string, previous: DependencyTransitionJournal | null = null, nonce = 'record'): DependencyTransitionJournal {
  const physical = generatedStatePhysicalIdentity(inspectNoFollowDirectoryChain(root).target);
  const digest = generatedStateDigest({ input: 'test' });
  const source = { ownerRoot: root, ownerRootPhysical: physical, sourcePath: path.join(root, 'source'), physical,
    bindingDigest: digest, treeDigest: digest, treeEntryCount: 0 };
  const absent = { path: path.join(root, 'target'), kind: 'absent' as const, physical: null, linkTarget: null, bindingDigest: null };
  const unsigned = { schema: 'sec-dependency-transition-journal-v2' as const, previousRecordDigest: previous?.recordDigest ?? null,
    sequence: (previous?.sequence ?? 0) + 1, operationKey: digest, attemptNonce: nonce, kind: 'compiler-bridge' as const,
    ownerRoot: root, ownerRootPhysical: physical, destination: absent, preimage: absent, stage: null, stageRoot: null, backup: null,
    sourceGeneration: { schema: 'sec-runtime-dependency-source-generation-v1' as const, ...source, epoch: runtimeDependencySourceGenerationEpoch(source) },
    phase: 'complete' as const, durability: 'known' as const, failure: null };
  return { ...unsigned, recordDigest: dependencyTransitionDigestWithoutRecord(unsigned) };
}
function save(root: string, value: DependencyTransitionJournal) {
  writeFileSync(path.join(root, transitionRecordName(value.recordDigest)), dependencyTransitionRecordBytes(value));
}

test('direct enumeration is sorted, bounded, and ignores unrelated effect capabilities', async () => fixture(async root => {
  for (const name of ['z', 'a', 'middle']) writeFileSync(path.join(root, name), 'x');
  const input = new Proxy({ ...controls(), get beforeCommit() { assert.fail('reader acquired write fence'); throw new Error('unreachable'); },
    get generatedStateLifecycle() { assert.fail('reader acquired lifecycle'); throw new Error('unreachable'); } }, { ownKeys() { assert.fail('enumerated facade'); } });
  const names = await readNoFollowDirectNames(inspectNoFollowDirectoryChain(root).target, 'names', 3, input);
  assert.deepEqual(names, ['a', 'middle', 'z']); assert.ok(Object.isFrozen(names));
  await assert.rejects(readNoFollowDirectNames(inspectNoFollowDirectoryChain(root).target, 'names', 2, controls()), /capacity/);
}));

for (const maximum of [-1, NaN, Infinity, 0.5]) test(`invalid name capacity ${maximum} fails before sampling controls`, async () => fixture(async root => {
  await assert.rejects(readNoFollowDirectNames(inspectNoFollowDirectoryChain(root).target, 'names', maximum,
    { monotonicNowMs() { assert.fail('invalid capacity read clock'); } }), /capacity/);
}));

test('zero capacity admits an empty directory but not one observed entry', async () => fixture(async root => {
  const directory = inspectNoFollowDirectoryChain(root).target;
  assert.deepEqual(await readNoFollowDirectNames(directory, 'empty', 0, controls()), []);
  writeFileSync(path.join(root, 'one'), 'x');
  await assert.rejects(readNoFollowDirectNames(directory, 'nonempty', 0, controls()), /capacity/);
}));

test('name enumeration notices parent cancellation and preserves the exact reason', async () => fixture(async root => {
  writeFileSync(path.join(root, 'one'), 'x');
  const controller = new AbortController(), reason = Object.freeze({ stopped: true });
  const input = runtimeDependencyOperationControls({ lockTimeoutMs: 20_000, signal: controller.signal });
  const pending = readNoFollowDirectNames(inspectNoFollowDirectoryChain(root).target, 'cancel', 10, input);
  controller.abort(reason); await assert.rejects(pending, error => error === reason);
}));

test('missing namespace and damaged present namespace are different states', async () => fixture(async root => {
  assert.equal(inspectDependencyTransitionNamespace(root), null);
  const paths = dependencyTransitionNamespacePaths(root); mkdirSync(paths.journalRoot, { recursive: true });
  await assert.rejects(Promise.resolve().then(() => inspectDependencyTransitionNamespace(root)), /without its records root/);
  mkdirSync(paths.recordsRoot);
  const existing = inspectDependencyTransitionNamespace(root)!;
  assert.equal(existing.recordsRoot.path, paths.recordsRoot); assert.equal(existing.rolloversRoot, null);
  assert.equal(existsSync(paths.rolloversRoot), false);
}));

test('namespace writer fixes its original root and callback receiver before its fence', async () => fixture(async root => {
  const original = process.cwd();
  class Input { #calls = 0; async beforeCommit() { this.#calls++; process.chdir(tmpdir()); } get calls() { return this.#calls; } }
  const input = Object.assign(new Input(), controls());
  try {
    process.chdir(root); const result = await ensureDependencyTransitionNamespace('.', input);
    assert.equal(result.ownerRoot.path, root); assert.ok(input.calls > 0);
    assert.equal(result.recordsRoot.path, dependencyTransitionNamespacePaths(root).recordsRoot);
  } finally { process.chdir(original); }
}));

test('namespace writer rejects an owner replacement before creating anything in the foreign root', async () => fixture(async root => {
  const expectedOwner = inspectNoFollowDirectoryChain(root).target;
  const displacedRoot = `${root}.displaced`;
  let replaced = false;
  try {
    await assert.rejects(ensureDependencyTransitionNamespace(expectedOwner, {
      ...controls(),
      async beforeCommit() {
        if (replaced) return;
        renameSync(root, displacedRoot);
        mkdirSync(root);
        replaced = true;
      }
    }), /owner root effect admission/);
    assert.equal(replaced, true);
    assert.equal(existsSync(dependencyTransitionNamespacePaths(root).backupRoot), false);
    assert.equal(existsSync(dependencyTransitionNamespacePaths(displacedRoot).backupRoot), false);
  } finally {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    if (existsSync(displacedRoot)) renameSync(displacedRoot, root);
  }
}));

test('cancelled namespace admission performs no directory creation', async () => fixture(async root => {
  const controller = new AbortController(), reason = new Error('cancelled');
  const input = runtimeDependencyOperationControls({ signal: controller.signal }); controller.abort(reason);
  await assert.rejects(ensureDependencyTransitionNamespace(root, input), error => error === reason);
  assert.equal(existsSync(dependencyTransitionNamespacePaths(root).backupRoot), false);
}));

test('empty and nonempty ledger projections cannot be altered through a Map mutator', async () => fixture(async root => {
  const directory = inspectNoFollowDirectoryChain(root).target, operation = runtimeDependencyOperationContext(controls());
  const empty = readDependencyTransitionRecordSet(directory, root, operation, 'empty');
  assert.equal(empty.records.size, 0); assert.throws(() => Map.prototype.set.call(empty.records, 'x', {}), TypeError);
  const one = record(root), two = record(root, one, 'next'); save(root, two); save(root, one);
  const value = readDependencyTransitionRecordSet(directory, root, operation, 'ledger');
  assert.equal(value.records.size, 2); assert.equal(value.tip!.recordDigest, two.recordDigest);
  assert.throws(() => Map.prototype.clear.call(value.records), TypeError);
  value.records.forEach((_entry, _key, view) => { assert.equal(view, value.records); assert.throws(() => Map.prototype.clear.call(view), TypeError); });
  assert.equal(value.records.size, 2); assert.ok(Object.isFrozen(value.records));
}));

test('ledger cancellation is enforced even if the public signal properties lie', async () => fixture(async root => {
  const controller = new AbortController(), reason = Object.freeze({ scan: 'cancelled' });
  const input = runtimeDependencyOperationControls({ signal: controller.signal });
  Object.defineProperty(controller.signal, 'aborted', { value: false }); controller.abort(reason);
  assert.throws(() => readDependencyTransitionRecordSet(inspectNoFollowDirectoryChain(root).target, root,
    runtimeDependencyOperationContext(input), 'cancelled'), error => error === reason);
}));

test('a fabricated ledger context is refused rather than accepted by its clock fields', async () => fixture(async root => {
  const context = runtimeDependencyOperationContext(controls());
  assert.throws(() => readDependencyTransitionRecordSet(inspectNoFollowDirectoryChain(root).target, root,
    { ...context }, 'copied'), /not owner-issued/);
}));

for (const shape of ['unknown-entry', 'fork', 'missing-predecessor', 'two-roots']) {
  test(`existing ledger graph rejection remains effective: ${shape}`, async () => fixture(async root => {
    const one = record(root), two = record(root, one, 'second');
    if (shape === 'unknown-entry') writeFileSync(path.join(root, 'foreign.txt'), 'foreign');
    else if (shape === 'missing-predecessor') save(root, two);
    else { save(root, one); save(root, two); save(root, shape === 'fork' ? record(root, one, 'fork') : record(root, null, 'new-root')); }
    assert.throws(() => readDependencyTransitionRecordSet(inspectNoFollowDirectoryChain(root).target, root,
      runtimeDependencyOperationContext(controls()), shape));
  }));
}
