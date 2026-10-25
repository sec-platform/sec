import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_TEST_TIMEOUT_MS } from '../../../src/adapters/self-hosting/development/runner/test-execution-policy.ts';
import { lowerSemanticTasks, renderStateTransitionMapSource } from '../../../src/adapters/targets/typescript/semantic-lowering.ts';
import type { PipelineSemanticContext } from '../../../src/compiler/pipeline/semantic-context.ts';
import { assertUniqueSemanticOutputPaths } from '../../../src/compiler/semantic-output-paths.ts';
import type { StateTransitionMapGeneratorPlanTask } from '../../../src/semantics/generation/types.ts';
import { runRetainedBunTestCommand } from '../../testkit/process-resource.ts';

function task(id = 'one'): StateTransitionMapGeneratorPlanTask {
  const values = ['open', 'closed'];
  return {
    id, blockId: 'ticket/basic', generatorId: id, generatorEntityId: `generator:${id}`,
    artifactEntityId: `artifact:${id}`, inputRevision: 'input', semanticRevision: 'semantic',
    contractId: 'ticket', contractPath: 'contracts/ticket.yaml', contractNamespace: 'ticket',
    target: `src/${id}.ts`, consumes: ['state', 'transition'], produces: 'typescript-runtime-contract',
    verification: [], verifiedByEntityIds: [], registrySourceId: 'official', registryKind: 'official',
    registryLocation: 'compiler', registryPath: 'registry', kind: 'generate-state-transition-map',
    stateId: 'ticket-status', stateEntityId: 'state:ticket-status', stateValues: [...values],
    transitions: values.map((value, i) => ({ from: value, to: values[(i + 1) % values.length]!, by: `op${i}`, operationEntityId: `op:${i}` })),
    typeBinding: { name: 'TicketStatus', importFrom: './types.ts' }
  };
}

// Minimal linkage fixture for this lowerer's public contract. It is not claimed
// to be a complete validated production Engineering IR or an authority grant.
function context(tasks: StateTransitionMapGeneratorPlanTask[]): PipelineSemanticContext {
  return {
    transactionId: 'tx:original', inputRevision: 'input', semanticRevision: 'semantic',
    snapshot: { ir: { inputRevision: 'input', semanticRevision: 'semantic', facts: [],
      entities: tasks.flatMap(t => [{ id: t.generatorEntityId, kind: 'generator' }, { id: t.artifactEntityId, kind: 'artifact' }]) } },
    generatorPlan: { inputRevision: 'input', semanticRevision: 'semantic', tasks },
    semanticViews: {}
  } as unknown as PipelineSemanticContext;
}

async function fixture(run: (root: string) => Promise<void>) {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-lowering-admission-'));
  await settleWorkspaceCallback(async () => {
    mkdirSync(path.join(root, 'src'));
    await run(root);
  }, async () => { rmSync(root, { recursive: true, force: true }); });
}

test('semantic output ownership accepts distinct siblings but rejects duplicate identities and conflicting targets', () => {
  for (const targets of [['src/a.ts', 'src/a.ts'], ['src/a.ts', 'src/A.ts'], ['src/a', 'src/a/child.ts'], ['src/a/child.ts', 'src/a']]) {
    const first = { ...task('one'), target: targets[0]! }, second = { ...task('two'), target: targets[1]! };
    assert.throws(() => assertUniqueSemanticOutputPaths([first, second]));
  }
  assert.throws(() => assertUniqueSemanticOutputPaths([task('same'), { ...task('same'), target: 'src/other.ts' }]));
  assert.doesNotThrow(() => assertUniqueSemanticOutputPaths([
    { ...task('one'), target: 'src/a.ts' }, { ...task('two'), target: 'src/a-test.ts' },
    { ...task('three'), target: 'src/a.tsx' }, { ...task('four'), target: 'src/a-test/child.ts' }
  ]));
});

test.skipIf(process.platform !== 'win32' && process.platform !== 'linux')('exact-byte semantic no-op preserves timestamps, inode and mode with the current artifact binding', async () => fixture(async root => {
  const value = task(), target = path.join(root, value.target);
  const source = renderStateTransitionMapSource(value);
  writeFileSync(target, source);
  if (process.platform !== 'win32') chmodSync(target, 0o640);
  utimesSync(target, new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'));
  const before = statSync(target, { bigint: true });
  const input = context([value]); Object.assign(input, { transactionId: 'tx:no-op' });
  let fences = 0;
  const result = await lowerSemanticTasks(root, input, async () => { fences++; });
  const after = statSync(target, { bigint: true });
  assert.equal(readFileSync(target, 'utf8'), source);
  assert.equal(after.mtimeNs, before.mtimeNs); assert.equal(after.ctimeNs, before.ctimeNs);
  assert.equal(after.ino, before.ino); assert.equal(after.mode, before.mode);
  assert.equal(fences, 1); assert.deepEqual(result.generatedPaths, ['src/one.ts']);
  assert.equal(result.tasks[0]!.status, 'generated');
  assert.equal(result.tasks[0]!.artifactBinding?.compilationTransactionId, 'tx:no-op');
}));

test('changed and missing semantic targets retain their original ordinary write behavior', async () => fixture(async root => {
  const changed = task('changed'), added = { ...task('added'), target: 'src/new/added.ts' };
  const target = path.join(root, changed.target);
  // Equal size still requires exact bytes, rather than a metadata-only fast path.
  const expected = renderStateTransitionMapSource(changed);
  writeFileSync(target, 'x'.repeat(Buffer.byteLength(expected)));
  if (process.platform !== 'win32') chmodSync(target, 0o640);
  const mode = statSync(target).mode;
  const result = await lowerSemanticTasks(root, context([changed, added]));
  assert.deepEqual(result.generatedPaths, ['src/changed.ts', 'src/new/added.ts']);
  assert.deepEqual(result.tasks.map(value => ({ status: value.status, binding: value.artifactBinding })), [
    { status: 'generated', binding: { generatorEntityId: 'generator:changed', artifactEntityId: 'artifact:changed',
      semanticRevision: 'semantic', compilationTransactionId: 'tx:original' } },
    { status: 'generated', binding: { generatorEntityId: 'generator:added', artifactEntityId: 'artifact:added',
      semanticRevision: 'semantic', compilationTransactionId: 'tx:original' } }
  ]);
  assert.deepEqual(result.tasks[1]!.stateValues, ['open', 'closed']);
  assert.equal(readFileSync(target, 'utf8'), expected); assert.equal(statSync(target).mode, mode);
  const addedTarget = path.join(root, added.target);
  assert.equal(readFileSync(addedTarget, 'utf8'), renderStateTransitionMapSource(added));
  if (process.platform !== 'win32') assert.equal(statSync(addedTarget).mode & 0o777, 0o666 & ~process.umask());
}));

test('equal-byte semantic hardlinks detach before reporting generated', async () => fixture(async root => {
  const value = task(), target = path.join(root, value.target), peer = path.join(root, 'peer.ts');
  const source = renderStateTransitionMapSource(value);
  writeFileSync(peer, source); linkSync(peer, target);
  await lowerSemanticTasks(root, context([value]));
  assert.equal(statSync(target, { bigint: true }).nlink, 1n); assert.equal(statSync(peer, { bigint: true }).nlink, 1n);
  assert.notEqual(statSync(target, { bigint: true }).ino, statSync(peer, { bigint: true }).ino);
  writeFileSync(peer, 'foreign change');
  assert.equal(readFileSync(target, 'utf8'), source);
}));

test.skipIf(process.platform !== 'win32' && process.platform !== 'linux')('semantic no-op rejects an actual competing write at the fence and releases native retention', async () => fixture(async root => {
  const value = task(), target = path.join(root, value.target);
  writeFileSync(target, renderStateTransitionMapSource(value));
  await assert.rejects(lowerSemanticTasks(root, context([value]), async () => {
    writeFileSync(target, 'foreign change');
  }));
  // Windows rejects the competing write itself; Linux observes changed bytes.
  if (process.platform !== 'win32') assert.equal(readFileSync(target, 'utf8'), 'foreign change');
  writeFileSync(target, 'after failure');
  assert.equal(readFileSync(target, 'utf8'), 'after failure');
}));

test('equal-byte symbolic targets cannot qualify for semantic no-op', async () => fixture(async root => {
  const value = task(), target = path.join(root, value.target), peer = path.join(root, 'peer.ts');
  const source = renderStateTransitionMapSource(value);
  writeFileSync(peer, source); symlinkSync(peer, target, 'file');
  await assert.rejects(lowerSemanticTasks(root, context([value])));
  assert.equal(readFileSync(peer, 'utf8'), source);
}));

for (const primary of [undefined] as const) {
  test(`semantic no-op preserves the original falsy fence failure ${String(primary)}`, async () => fixture(async root => {
    const value = task(), target = path.join(root, value.target);
    const source = renderStateTransitionMapSource(value); writeFileSync(target, source);
    let caught = false;
    try { await lowerSemanticTasks(root, context([value]), () => { throw primary; }); }
    catch (error) { caught = true; assert.equal(error, primary); }
    assert.equal(caught, true); assert.equal(readFileSync(target, 'utf8'), source);
    writeFileSync(target, 'released'); assert.equal(readFileSync(target, 'utf8'), 'released');
  }));
}

for (const fault of ['fence-and-dispose', 'readback-and-dispose', 'different-and-dispose'] as const) {
  test.skipIf(process.platform !== 'win32' && process.platform !== 'linux')(`semantic retained target settlement keeps original failures after ${fault}`, async () => fixture(async root => {
    const value = task(), target = path.join(root, value.target);
    const source = fault === 'different-and-dispose' ? 'foreign bytes' : renderStateTransitionMapSource(value);
    writeFileSync(target, source);
    const script = path.join(root, 'settlement.ts');
    const modulePath = (relative: string) => JSON.stringify(path.resolve(relative));
    // Isolation keeps fault wrappers out of other native consumer cases. Every
    // wrapper delegates to an actual acquired Physical resource and closes it;
    // this is composition evidence, not new native authority.
    writeFileSync(script, `
      import assert from 'node:assert/strict';
      import { mock } from 'bun:test';
      import * as fs from 'node:fs';
      const physical = await import(${modulePath('src/adapters/runtime-state/physical/runtime/physical-no-follow.ts')});
      const originalRetain = physical.retainNoFollowOrdinaryFile;
      const primary = false, readback = Object.freeze({ readback: true }), cleanup = Object.freeze({ cleanup: true });
      const fault = ${JSON.stringify(fault)}; let disposed = 0;
      mock.module(${modulePath('src/adapters/runtime-state/physical/runtime/physical-no-follow.ts')}, () => ({ ...physical,
        retainNoFollowOrdinaryFile(...args) {
          const retained = originalRetain(...args);
          return { ...retained,
            assertCurrent() { retained.assertCurrent(); if (fault === 'readback-and-dispose') throw readback; },
            dispose() { retained.dispose(); disposed++; throw cleanup; }
          };
        }
      }));
      const { ResourceCompositeSettlementError } = await import(${modulePath('src/execution/resource-settlement.ts')});
      const { lowerSemanticTasks } = await import(${modulePath('src/adapters/targets/typescript/semantic-lowering.ts')});
      let caught = false;
      try {
        await lowerSemanticTasks(${JSON.stringify(root)}, ${JSON.stringify(context([value]))}, () => {
          if (fault === 'fence-and-dispose') throw primary;
        });
      } catch (error) {
        caught = true; assert.ok(error instanceof ResourceCompositeSettlementError);
        const expected = fault === 'fence-and-dispose' ? [primary, cleanup]
          : fault === 'readback-and-dispose' ? [readback, cleanup] : [cleanup];
        assert.deepEqual(error.errors, expected);
      }
      assert.equal(caught, true); assert.equal(disposed, 1);
      assert.equal(fs.readFileSync(${JSON.stringify(target)}, 'utf8'), ${JSON.stringify(source)});
      fs.writeFileSync(${JSON.stringify(target)}, 'after settlement');
      assert.equal(fs.readFileSync(${JSON.stringify(target)}, 'utf8'), 'after settlement');
    `);
    const result = await runRetainedBunTestCommand([script], {
      cwd: process.cwd(), env: process.env, timeoutMs: DEFAULT_TEST_TIMEOUT_MS
    });
    assert.equal(result.code, 0, result.stderr);
  }));
}

test('unsupported retained platforms keep the original writer without acquiring a no-op capability', async () => fixture(async root => {
  const value = task(), target = path.join(root, value.target), source = renderStateTransitionMapSource(value);
  writeFileSync(target, source);
  utimesSync(target, new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'));
  const before = statSync(target, { bigint: true }).mtimeNs;
  const script = path.join(root, 'platform.ts');
  const modulePath = (relative: string) => JSON.stringify(path.resolve(relative));
  writeFileSync(script, `
    import assert from 'node:assert/strict';
    import { mock } from 'bun:test';
    import * as fs from 'node:fs';
    const physical = await import(${modulePath('src/adapters/runtime-state/physical/runtime/physical-no-follow.ts')});
    let probes = 0;
    mock.module(${modulePath('src/adapters/runtime-state/physical/runtime/physical-no-follow.ts')}, () => ({ ...physical,
      inspectNoFollowDirectoryChain() { probes++; assert.fail('unsupported platform acquired retained authority'); }
    }));
    const { lowerSemanticTasks } = await import(${modulePath('src/adapters/targets/typescript/semantic-lowering.ts')});
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    let fences = 0;
    const result = await lowerSemanticTasks(${JSON.stringify(root)}, ${JSON.stringify(context([value]))}, () => { fences++; });
    assert.equal(probes, 0); assert.equal(fences, 1);
    assert.equal(result.tasks[0].status, 'generated');
    assert.equal(fs.readFileSync(${JSON.stringify(target)}, 'utf8'), ${JSON.stringify(source)});
    assert.notEqual(fs.statSync(${JSON.stringify(target)}, { bigint: true }).mtimeNs, ${before}n);
  `);
  const result = await runRetainedBunTestCommand([script], {
    cwd: process.cwd(), env: process.env, timeoutMs: DEFAULT_TEST_TIMEOUT_MS
  });
  assert.equal(result.code, 0, result.stderr);
}));

test('returned task data is independently owned and remains mutable for its next lifecycle', async () => fixture(async root => {
  const original = task(); Object.freeze(original.stateValues); Object.freeze(original);
  const result = await lowerSemanticTasks(root, context([original]));
  result.tasks[0]!.stateValues.push('consumer-owned');
  assert.deepEqual(original.stateValues, ['open', 'closed']);
}));
