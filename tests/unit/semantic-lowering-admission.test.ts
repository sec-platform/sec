import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { DEFAULT_TEST_TIMEOUT_MS } from '../../src/adapters/self-hosting/development/runner/test-execution-policy.ts';
import { lowerSemanticTasks, renderStateTransitionMapSource } from '../../src/adapters/targets/typescript/semantic-lowering.ts';
import type { PipelineSemanticContext } from '../../src/compiler/pipeline/semantic-context.ts';
import { assertUniqueSemanticOutputPaths } from '../../src/compiler/semantic-output-paths.ts';
import { assertStateTransitionFunctions } from '../../src/compiler/state-transition-plan.ts';
import type { StateTransitionMapGeneratorPlanTask } from '../../src/semantics/generation/types.ts';

function task(id = 'one', values = ['open', 'closed']): StateTransitionMapGeneratorPlanTask {
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
function context(tasks = [task()]): PipelineSemanticContext {
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
  mkdirSync(path.join(root, 'src'));
  try { await run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function evaluatedMap(value: StateTransitionMapGeneratorPlanTask): Record<string, string> {
  const generated = renderStateTransitionMapSource(value);
  const code = ts.transpileModule(generated, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const sandbox = { exports: {} as Record<string, unknown> };
  runInNewContext(code, sandbox);
  return sandbox.exports.NEXT_TICKET_STATUS as Record<string, string>;
}

test('separator-containing states cannot collide in transition sort order', () => {
  const value = task('one', ['a:b', 'a', 'c', 'b:c']);
  value.transitions = [
    { from: 'a:b', to: 'c', by: 'op', operationEntityId: 'op:1' },
    { from: 'a', to: 'b:c', by: 'op', operationEntityId: 'op:2' },
    { from: 'c', to: 'a', by: 'op', operationEntityId: 'op:3' },
    { from: 'b:c', to: 'a:b', by: 'op', operationEntityId: 'op:4' }
  ];
  assert.equal(renderStateTransitionMapSource(value), renderStateTransitionMapSource({ ...value,
    stateValues: [...value.stateValues].reverse(), transitions: [...value.transitions].reverse() }));
});

test('__proto__ is a real transition key rather than object-literal prototype syntax', () => {
  const map = evaluatedMap(task('one', ['__proto__', 'open', 'constructor']));
  assert.ok(Object.hasOwn(map, '__proto__'));
  assert.equal(map.__proto__, 'open'); assert.equal(map.open, 'constructor'); assert.equal(map.constructor as unknown, '__proto__');
});

test('numeric-looking and empty state values keep their exact runtime lookup meaning', () => {
  const value = task('one', ['10', '2', '', '0']); const map = evaluatedMap(value);
  for (const transition of value.transitions) assert.equal(map[transition.from], transition.to);
});

for (const [name, mutate] of [
  ['duplicate states', (value: StateTransitionMapGeneratorPlanTask) => value.stateValues.push('open')],
  ['unknown source', (value: StateTransitionMapGeneratorPlanTask) => { value.transitions[0]!.from = 'missing'; }],
  ['unknown target', (value: StateTransitionMapGeneratorPlanTask) => { value.transitions[0]!.to = 'missing'; }],
  ['two outgoing edges', (value: StateTransitionMapGeneratorPlanTask) => value.transitions.push({ ...value.transitions[0]! })],
  ['missing outgoing edge', (value: StateTransitionMapGeneratorPlanTask) => value.transitions.pop()]
] as const) {
  test(`the same state validator rejects ${name} in plan checking and rendering`, () => {
    const value = task(); mutate(value);
    assert.throws(() => assertStateTransitionFunctions([value]));
    assert.throws(() => renderStateTransitionMapSource(value));
  });
}

for (const targets of [['src/a.ts', 'src/a.ts'], ['src/a.ts', 'src/A.ts'], ['src/a', 'src/a/child.ts'], ['src/a/child.ts', 'src/a']]) {
  test(`output ownership rejects conflicting file targets ${targets.join(' | ')}`, () => {
    const first = { ...task('one'), target: targets[0]! }, second = { ...task('two'), target: targets[1]! };
    assert.throws(() => assertUniqueSemanticOutputPaths([first, second]));
  });
}

test('duplicate task identities cannot manufacture two independently published results', () => {
  assert.throws(() => assertUniqueSemanticOutputPaths([task('same'), { ...task('same'), target: 'src/other.ts' }]));
});

test('siblings and delimiter-like file names that do not contain each other remain admissible', () => {
  assert.doesNotThrow(() => assertUniqueSemanticOutputPaths([
    { ...task('one'), target: 'src/a.ts' }, { ...task('two'), target: 'src/a-test.ts' },
    { ...task('three'), target: 'src/a.tsx' }, { ...task('four'), target: 'src/a-test/child.ts' }
  ]));
});

for (const failure of ['path', 'kind', 'state', 'duplicate-target', 'duplicate-id', 'entity', 'revision'] as const) {
  test(`a later ${failure} error is rejected before the first task is written`, async () => fixture(async root => {
    const first = task('one'), second = task('two'); const input = context([first, second]);
    switch (failure) {
      case 'path': second.target = '../escape.ts'; break;
      case 'kind': Object.assign(second, { kind: 'unknown' }); break;
      case 'state': second.transitions = []; break;
      case 'duplicate-target': second.target = first.target; break;
      case 'duplicate-id': second.id = first.id; break;
      case 'entity': second.generatorEntityId = 'generator:absent'; break;
      case 'revision': second.inputRevision = 'changed'; break;
    }
    let fences = 0;
    await assert.rejects(lowerSemanticTasks(root, input, async () => { fences++; }));
    assert.equal(fences, 0); assert.equal(existsSync(path.join(root, first.target)), false);
  }));
}

test('publication and returned bindings use one captured task/transaction generation', async () => fixture(async root => {
  const first = task('one'), second = task('two'); const input = context([first, second]);
  const result = await lowerSemanticTasks(root, input, async () => {
    Object.assign(input, { transactionId: 'tx:replacement', semanticRevision: 'replacement' });
    second.target = 'src/wrong.ts'; second.typeBinding.name = 'WrongType'; second.stateValues.push('extra');
    Object.assign(input.generatorPlan, { tasks: [task('injected')] });
  });
  assert.deepEqual(result.generatedPaths, ['src/one.ts', 'src/two.ts']);
  assert.equal(existsSync(path.join(root, 'src/wrong.ts')), false);
  assert.equal(existsSync(path.join(root, 'src/injected.ts')), false);
  assert.ok(readFileSync(path.join(root, 'src/two.ts'), 'utf8').includes('TicketStatus'));
  for (const emitted of result.tasks) {
    assert.equal(emitted.artifactBinding?.compilationTransactionId, 'tx:original');
    assert.equal(emitted.artifactBinding?.semanticRevision, 'semantic');
  }
  assert.deepEqual(result.tasks[1]!.stateValues, ['open', 'closed']);
}));

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

test.skipIf(process.platform !== 'win32' && process.platform !== 'linux')('an absent semantic target under an existing parent becomes a retained no-op on retry', async () => fixture(async root => {
  const value = task(), target = path.join(root, value.target);
  assert.equal(existsSync(target), false); assert.equal(existsSync(path.dirname(target)), true);
  let fences = 0;
  await lowerSemanticTasks(root, context([value]), async () => { fences++; });
  assert.equal(readFileSync(target, 'utf8'), renderStateTransitionMapSource(value));
  utimesSync(target, new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'));
  const before = statSync(target, { bigint: true });
  const result = await lowerSemanticTasks(root, context([value]), async () => { fences++; });
  const after = statSync(target, { bigint: true });
  assert.equal(fences, 2); assert.equal(after.ino, before.ino); assert.equal(after.mtimeNs, before.mtimeNs);
  assert.equal(result.tasks[0]!.status, 'generated');
}));

test('changed and missing semantic targets retain their original ordinary write behavior', async () => fixture(async root => {
  const changed = task('changed'), added = { ...task('added'), target: 'src/new/added.ts' };
  const target = path.join(root, changed.target);
  // Equal size still requires exact bytes, rather than a metadata-only fast path.
  const expected = renderStateTransitionMapSource(changed);
  writeFileSync(target, 'x'.repeat(Buffer.byteLength(expected)));
  if (process.platform !== 'win32') chmodSync(target, 0o640);
  const mode = statSync(target).mode;
  await lowerSemanticTasks(root, context([changed, added]));
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

test('semantic no-op checks the original semantic generation and permits a fresh retry after failure', async () => fixture(async root => {
  const value = task(), target = path.join(root, value.target);
  const source = renderStateTransitionMapSource(value); writeFileSync(target, source);
  const input = context([value]);
  await assert.rejects(lowerSemanticTasks(root, input, async () => {
    Object.assign(input.snapshot.ir, { semanticRevision: 'next' });
  }), /revision changed/);
  assert.equal(readFileSync(target, 'utf8'), source);
  writeFileSync(target, source); // independently observes all pins were released
  const result = await lowerSemanticTasks(root, context([value]));
  assert.equal(result.tasks[0]!.status, 'generated');
}));

test('equal-byte symbolic targets cannot qualify for semantic no-op', async () => fixture(async root => {
  const value = task(), target = path.join(root, value.target), peer = path.join(root, 'peer.ts');
  const source = renderStateTransitionMapSource(value);
  writeFileSync(peer, source); symlinkSync(peer, target, 'file');
  await assert.rejects(lowerSemanticTasks(root, context([value])));
  assert.equal(readFileSync(peer, 'utf8'), source);
}));

for (const primary of [undefined, null, false, 0, ''] as const) {
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
    const result = Bun.spawnSync([process.execPath, script], {
      cwd: process.cwd(), env: process.env, stdout: 'pipe', stderr: 'pipe', timeout: DEFAULT_TEST_TIMEOUT_MS
    });
    assert.equal(result.exitCode, 0, Buffer.from(result.stderr).toString('utf8'));
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
  const result = Bun.spawnSync([process.execPath, script], {
    cwd: process.cwd(), env: process.env, stdout: 'pipe', stderr: 'pipe', timeout: DEFAULT_TEST_TIMEOUT_MS
  });
  assert.equal(result.exitCode, 0, Buffer.from(result.stderr).toString('utf8'));
}));

test('returned task data is independently owned and remains mutable for its next lifecycle', async () => fixture(async root => {
  const original = task(); const result = await lowerSemanticTasks(root, context([original]));
  result.tasks[0]!.stateValues.push('consumer-owned');
  assert.deepEqual(original.stateValues, ['open', 'closed']); assert.equal(Object.isFrozen(original), false);
}));

test('an IR revision change at the commit fence is not silently admitted', async () => fixture(async root => {
  const input = context();
  await assert.rejects(lowerSemanticTasks(root, input, async () => {
    Object.assign(input.snapshot.ir, { semanticRevision: 'next' });
  }), /revision changed/);
  assert.equal(existsSync(path.join(root, 'src/one.ts')), false);
}));

test('relative workspaces are fixed before an asynchronous write fence', async () => fixture(async root => {
  const previous = process.cwd();
  try {
    process.chdir(root);
    const result = await lowerSemanticTasks('.', context(), async () => { process.chdir(tmpdir()); });
    assert.deepEqual(result.generatedPaths, ['src/one.ts']); assert.ok(existsSync(path.join(root, 'src/one.ts')));
  } finally { process.chdir(previous); }
}));

test('invalid effect callback is refused even for an otherwise empty plan', async () => fixture(async root => {
  await assert.rejects(lowerSemanticTasks(root, context([]), 'bad' as never), TypeError);
}));

test('same-revision IR object replacement cannot retarget the accepted lowering input', async () => fixture(async root => {
  const input = context();
  await assert.rejects(lowerSemanticTasks(root, input, async () => {
    Object.assign(input.snapshot, { ir: { ...input.snapshot.ir } });
  }), /revision changed/);
  assert.equal(existsSync(path.join(root, 'src/one.ts')), false);
}));

for (const key of ['transactionId', 'inputRevision', 'semanticRevision']) {
  test(`empty ${key} cannot become a successful artifact binding`, async () => fixture(async root => {
    const input = context(); Object.assign(input, { [key]: '' });
    await assert.rejects(lowerSemanticTasks(root, input, async () => assert.fail('invalid identity admitted')));
  }));
}
