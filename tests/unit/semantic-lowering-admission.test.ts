import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { PipelineSemanticContext } from '../../src/compiler/pipeline/types.ts';
import { lowerSemanticTasks, renderStateTransitionMapSource } from '../../src/compiler/semantic-lowering.ts';
import { assertUniqueSemanticOutputPaths } from '../../src/compiler/semantic-output-paths.ts';
import { assertStateTransitionFunctions } from '../../src/compiler/state-transition-plan.ts';
import type { StateTransitionMapGeneratorPlanTask } from '../../src/semantic/generation/contract/types.ts';

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
