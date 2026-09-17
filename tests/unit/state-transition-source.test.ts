import { test } from 'bun:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { renderStateTransitionMapSource } from '../../src/compiler/codegen/state-transition-source.ts';
import type { StateTransitionMapGeneratorPlanTask } from '../../src/semantics/generation/types.ts';

function task(values = ['pending', 'done'], next = ['done', 'done']): StateTransitionMapGeneratorPlanTask {
  return {
    kind: 'generate-state-transition-map', id: 'workflow-map', blockId: 'fixture', generatorId: 'map',
    generatorEntityId: 'generator:map', artifactEntityId: 'artifact:map', inputRevision: 'input-1', semanticRevision: 'semantic-1',
    contractId: 'workflow', contractPath: 'workflow', contractNamespace: 'fixture', target: 'generated.ts',
    consumes: ['state', 'transition'], produces: 'typescript-runtime-contract', verification: [], verifiedByEntityIds: [],
    registrySourceId: 'fixture', registryKind: 'official', registryLocation: 'compiler', registryPath: 'fixture',
    stateId: 'workflow', stateEntityId: 'state:workflow', stateValues: values,
    transitions: values.map((from, i) => ({ from, to: next[i]!, by: `act${i}`, operationEntityId: `operation:${i}` })),
    typeBinding: { name: 'State', importFrom: './workflow-types.ts' }
  };
}

type Generated = {
  WORKFLOW_VALUES: readonly string[];
  WORKFLOW_TRANSITIONS: readonly { from: string; to: string; by: string }[];
  NEXT_WORKFLOW: Readonly<Record<string, string>>;
};
async function execute(text: string): Promise<Generated> {
  const { outputText, diagnostics } = ts.transpileModule(text, { reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  assert.deepEqual((diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error), []);
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

test('the actual state renderer produces a runnable total transition map with only public transition data', async () => {
  const generated = await execute(renderStateTransitionMapSource(task()));
  assert.deepEqual(generated.WORKFLOW_VALUES, ['done', 'pending']);
  assert.deepEqual(generated.NEXT_WORKFLOW, { done: 'done', pending: 'done' });
  assert.deepEqual(generated.WORKFLOW_TRANSITIONS, [
    { from: 'done', to: 'done', by: 'act1' }, { from: 'pending', to: 'done', by: 'act0' }
  ]);
});

test('all 27 deterministic total functions on three states survive TS generation and native execution', async () => {
  const states = ['a', 'b', 'c'];
  for (let encoded = 0; encoded < 27; encoded++) {
    const next = states.map((_, i) => states[Math.floor(encoded / (3 ** i)) % 3]!);
    const generated = await execute(renderStateTransitionMapSource(task(states, next)));
    for (let i = 0; i < states.length; i++) {
      assert.equal(generated.NEXT_WORKFLOW[states[i]!], next[i]);
      assert.equal(Object.hasOwn(generated.NEXT_WORKFLOW, states[i]!), true);
    }
    assert.deepEqual(Object.keys(generated.NEXT_WORKFLOW).sort(), states);
  }
});

test('prototype-like names, Unicode and escaped strings remain own data keys with the requested targets', async () => {
  const states = ['__proto__', 'constructor', 'toString', '', '1', '02', 'quote"', 'line\nend', 'slash\\', '界🙂'];
  const next = states.map((_, i) => states[(i + 1) % states.length]!);
  const generated = await execute(renderStateTransitionMapSource(task(states, next)));
  assert.deepEqual([...generated.WORKFLOW_VALUES], [...states].sort());
  assert.equal(Object.getPrototypeOf(generated.NEXT_WORKFLOW), Object.prototype);
  for (let i = 0; i < states.length; i++) {
    assert.equal(Object.hasOwn(generated.NEXT_WORKFLOW, states[i]!), true);
    assert.equal(generated.NEXT_WORKFLOW[states[i]!], next[i]);
  }
});

test('the empty state domain retains its existing valid empty-function interpretation', async () => {
  const generated = await execute(renderStateTransitionMapSource(task([], [])));
  assert.deepEqual(generated.WORKFLOW_VALUES, []);
  assert.deepEqual(generated.WORKFLOW_TRANSITIONS, []);
  assert.deepEqual(generated.NEXT_WORKFLOW, {});
});

test('missing, duplicate and foreign transition endpoints retain the real validator rejection', () => {
  const missing = task(); missing.transitions.pop();
  const duplicate = task(); duplicate.transitions.push({ ...duplicate.transitions[0]! });
  const foreign = task(); foreign.transitions[0]!.to = 'undeclared';
  const repeatedState = task(); repeatedState.stateValues.push('pending');
  for (const input of [missing, duplicate, foreign, repeatedState]) {
    assert.throws(() => renderStateTransitionMapSource(input), error =>
      error instanceof Error && /State "workflow"/.test(error.message));
  }
});

test('rendering neither mutates caller plan data nor makes declaration order an output dependency', () => {
  const input = task(), before = JSON.stringify(input);
  const first = renderStateTransitionMapSource(input);
  assert.equal(JSON.stringify(input), before);
  const reordered = structuredClone(input); reordered.stateValues.reverse(); reordered.transitions.reverse();
  assert.equal(renderStateTransitionMapSource(reordered), first);
});

test('generated TS passes strict checking against the real declared state-union fixture', () => {
  const files = new Map([
    ['/virtual/generated.ts', renderStateTransitionMapSource(task())],
    ['/virtual/workflow-types.ts', 'export type State = "pending" | "done";\n']
  ]);
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, strict: true, noEmit: true };
  const host = ts.createCompilerHost(options), read = host.readFile.bind(host), exists = host.fileExists.bind(host), get = host.getSourceFile.bind(host);
  host.fileExists = name => files.has(name) || exists(name);
  host.readFile = name => files.get(name) ?? read(name);
  host.getSourceFile = (name, ...args) => files.has(name)
    ? ts.createSourceFile(name, files.get(name)!, options.target!, true) : get(name, ...args);
  host.directoryExists = name => name === '/virtual' || ts.sys.directoryExists(name);
  const program = ts.createProgram([...files.keys()], options, host);
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
});

test('generated source is accepted for a TSX destination without changing its state contract', async () => {
  const input = task(); input.target = 'view.tsx';
  const generated = await execute(renderStateTransitionMapSource(input));
  assert.equal(generated.NEXT_WORKFLOW.pending, 'done');
  assert.equal(generated.NEXT_WORKFLOW.done, 'done');
});

test('plan metadata remains a line comment rather than becoming executable source', async () => {
  const input = task(); input.id = 'id\nthrow new Error("not data");';
  const generated = await execute(renderStateTransitionMapSource(input));
  assert.equal(generated.NEXT_WORKFLOW.pending, 'done');
});
