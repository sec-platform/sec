import { test } from 'bun:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { renderStateTransitionMapSource } from '../../../src/adapters/targets/typescript/state-transition-source.ts';
import type { StateTransitionMapGeneratorPlanTask } from '../../../src/semantics/generation/types.ts';

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
  const input = task(); input.stateId = 'workflow-state';
  const source = renderStateTransitionMapSource(input);
  assert.ok(source.startsWith('// @generated semantic-task:workflow-map contract:workflow state:workflow-state\n'));
  const parsed = ts.createSourceFile('generated.ts', source, ts.ScriptTarget.Latest, true);
  const declaration = parsed.statements.find(ts.isImportDeclaration);
  assert.ok(declaration && ts.isImportDeclaration(declaration));
  assert.ok(ts.isStringLiteral(declaration.moduleSpecifier));
  assert.equal(declaration.moduleSpecifier.text, './workflow-types.ts');
  assert.equal(declaration.importClause?.isTypeOnly, true);
  const bindings = declaration.importClause?.namedBindings;
  assert.ok(bindings && ts.isNamedImports(bindings));
  assert.deepEqual(bindings.elements.map(element => [element.name.text, element.propertyName?.text]), [['State', undefined]]);
  const generated = await execute(source) as unknown as { WORKFLOW_STATE_VALUES: string[]; WORKFLOW_STATE_TRANSITIONS: unknown[]; NEXT_WORKFLOW_STATE: Record<string, string> };
  assert.deepEqual(generated.WORKFLOW_STATE_VALUES, ['done', 'pending']);
  assert.deepEqual(generated.NEXT_WORKFLOW_STATE, { done: 'done', pending: 'done' });
  assert.deepEqual(generated.WORKFLOW_STATE_TRANSITIONS, [
    { from: 'done', to: 'done', by: 'act1' }, { from: 'pending', to: 'done', by: 'act0' }
  ]);
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

test('malformed transition functions and injected type bindings never publish generated source', () => {
  const missing = task(); missing.transitions.pop();
  assert.throws(() => renderStateTransitionMapSource(missing), {
    code: 'GENERATOR-PLAN-004', message: 'State "workflow" requires exactly one outgoing transition from "done"'
  });
  const duplicate = task(); duplicate.transitions.push({ ...duplicate.transitions[0]! });
  const foreign = task(); foreign.transitions[0]!.to = 'undeclared';
  const unknownSource = task(); unknownSource.transitions[0]!.from = 'undeclared';
  const repeatedState = task(); repeatedState.stateValues.push('pending');
  for (const input of [duplicate, foreign, unknownSource, repeatedState]) {
    assert.throws(() => renderStateTransitionMapSource(input), error =>
      error instanceof Error && /State "workflow"/.test(error.message));
  }
  const injected = task(); injected.typeBinding.name = 'State, Unexpected';
  assert.throws(() => renderStateTransitionMapSource(injected), error =>
    error instanceof TypeError && error.message === 'Named import must name one identifier');
});

test('rendering neither mutates caller plan data nor makes declaration order an output dependency', () => {
  const input = task(['a:b', 'a', 'c', 'b:c'], ['c', 'b:c', 'a', 'a:b']), before = JSON.stringify(input);
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
  const input = task();
  input.id = ['\n', '\r', '\r\n', '\u2028', '\u2029']
    .map(separator => `id${separator}throw new Error("not data");`).join('');
  const generated = await execute(renderStateTransitionMapSource(input));
  assert.equal(generated.NEXT_WORKFLOW.pending, 'done');
});
