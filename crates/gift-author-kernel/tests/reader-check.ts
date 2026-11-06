// Native transport and the real repository author CLI, without target generation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseAuthorAnalysis, type AuthorAnalysisResult } from '../../../src/adapters/compilation/author-analysis-transport.ts';
import { compileAuthorModule, parseAuthorNameAnalysis, type AuthorNameAnalysis } from '../../../src/adapters/compilation/author-kernel.ts';
import { runCommand } from '../../../src/adapters/runtime-state/physical/runtime/process.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const kernel = process.argv[2];
assert.ok(kernel, 'Pass the workspace-relative built Rust executable');
const work = mkdtempSync(path.join(root, '.tmp', 'gift-author-reader-'));
const moduleBytes = Buffer.from('{"schema":"gift.author-module/design-converged","moduleId":"module:reader-check","definitions":{"":{"req:enum-value":{},"name":"名称"}},"exports":[""],"annotations":{"number":1.2300E+02}}\r\n');
const input = path.join(work, 'module.json');
writeFileSync(input, moduleBytes, { flag: 'wx' });
const relative = path.relative(root, input);
const result = await compileAuthorModule(root, relative, kernel, true);
assert.equal(result.stage, 'structural');
assert.equal(result.source_revision, `sha256:${createHash('sha256').update(moduleBytes).digest('hex')}`);
assert.deepEqual(readFileSync(input), moduleBytes);
assert.ok(result.nodes.some(node => node.kind === 'number' && node.value === '1.2300E+02'));
assert.equal('artifacts' in result, false);
const cli = await runCommand('bun', ['run', 'sec', '--', 'author', '--read', '--input', relative, '--kernel', kernel, '--json'], {
  cwd: root, timeoutMs: 30_000, maxStdoutBytes: 4 * 1024 * 1024, maxStderrBytes: 64 * 1024
});
assert.equal(cli.code, 0, cli.stderr);
assert.deepEqual(JSON.parse(cli.stdout), result);
const project = path.join(work, 'project.json');
writeFileSync(project, JSON.stringify({ schema: 'gift.project/design-converged', projectId: 'project:reader', sourceScopes: [] }), { flag: 'wx' });
const projectResult = await compileAuthorModule(root, path.relative(root, project), kernel, true);
assert.equal(projectResult.source_format, 'gift.project/design-converged');
const invalid = path.join(work, 'invalid.json');
writeFileSync(invalid, '{"schema":"gift.author-module/design-converged","definitions":{},"definitions":{}}', { flag: 'wx' });
await assert.rejects(compileAuthorModule(root, path.relative(root, invalid), kernel, true), /InvalidAuthorSource/);
const legacy = await compileAuthorModule(root, 'crates/gift-author-kernel/fixtures/shared-views.module.json', kernel);
assert.equal(legacy.artifacts.length, 4);
await assert.rejects(compileAuthorModule(root, 'crates/gift-author-kernel/fixtures/shared-views.module.json', kernel, true), /UnsupportedAuthorSchema/);
const namesPath = path.join(work, 'names.json');
const namesBytes = Buffer.from(JSON.stringify({ schema: 'gift.author-module/design-converged', moduleId: 'module:names', definitions: {
  T: { kind: 'core:type', body: { type: { tag: 'scalar', name: 'bool' } } },
  Alias: { kind: 'core:type', body: { type: { tag: 'nominal', ref: { space: 'local', definition: 'T' } } } },
  Compose: { kind: 'core:function', body: { parameters: [{ name: 'x', type: { tag: 'scalar', name: 'int' } }], body: {
    op: 'exec:block', statements: [
      { op: 'let', name: 'y', value: { op: 'var', name: 'x' } },
      { op: 'eval', value: { op: 'lambda', params: [{ name: 'z', type: { tag: 'scalar', name: 'int' } }],
        body: { op: 'exec:block', statements: [{ op: 'return', value: { op: 'var', name: 'y' } }] } } },
      { op: 'while', condition: { op: 'literal', type: { tag: 'scalar', name: 'bool' }, value: true },
        body: { op: 'exec:block', statements: [{ op: 'break' }] } }
    ], result: { op: 'var', name: 'y' }
  } } },
  '': { 'req:enum-value': {} }
}, exports: ['T', ''] }));
writeFileSync(namesPath, namesBytes, { flag: 'wx' });
const namesRelative = path.relative(root, namesPath);
const names = await compileAuthorModule(root, namesRelative, kernel, 'names');
assert.equal(names.stage, 'names');
assert.equal(names.schema, 'gift.author-names/2');
assert.equal(names.identity_scope, 'capture-local');
assert.equal(names.declarations.length, 4);
assert.equal(names.references.length, 1);
const nameReference = names.references[0];
assert.ok(nameReference?.resolution.state === 'resolved');
assert.equal(names.declarations[nameReference.resolution.declaration]?.name, 'T');
assert.ok(names.unchecked.includes('types'));
assert.equal('artifacts' in names, false);
assert.deepEqual(readFileSync(namesPath), namesBytes);
const lexical = names.lexical;
const localY = lexical.bindings.find(binding => binding.name === 'y' && binding.kind === 'let');
assert.ok(localY);
const resultUse = lexical.uses.find(use => lexical.occurrences[use.occurrence]?.expanded_path === '/definitions/Compose/body/body/result');
assert.ok(resultUse?.resolution.state === 'resolved');
assert.equal(resultUse.resolution.binding, localY.id);
const useOrigin = lexical.occurrences[resultUse.occurrence]?.origin;
assert.ok(useOrigin);
assert.equal(useOrigin.pointer, '/definitions/Compose/body/body/result');
assert.deepEqual(JSON.parse(namesBytes.subarray(useOrigin.start, useOrigin.end).toString('utf8')), { op: 'var', name: 'y' });
assert.ok(lexical.captures.some(capture => capture.binding === localY.id && lexical.scopes[capture.scope]?.kind === 'lambda'));
assert.ok(lexical.exits.some(exit => exit.kind === 'return' && exit.target.state === 'resolved' && lexical.scopes[exit.target.scope]?.kind === 'lambda'));
assert.ok(lexical.exits.some(exit => exit.kind === 'break' && exit.target.state === 'resolved' && lexical.scopes[exit.target.scope]?.kind === 'loop'));

// Mutate the actual producer result at the real host parser boundary. No fake
// compiler, fallback or alternate interpreter supplies these transport checks.
const protocolCases: string[] = [];
function rejectWire(name: string, mutate: (copy: AuthorNameAnalysis) => void): void {
  const copy = structuredClone(names);
  mutate(copy);
  assert.throws(() => parseAuthorNameAnalysis(copy, namesBytes), { code: 'AUTHOR-COMPILE-PROTOCOL' }, name);
  protocolCases.push(name);
}
assert.throws(() => parseAuthorNameAnalysis({ ...names, schema: 'gift.author-names/1' }, namesBytes), { code: 'AUTHOR-COMPILE-PROTOCOL' });
protocolCases.push('old-result-version-refused');
assert.throws(() => parseAuthorNameAnalysis({ ...names, lexical: undefined }, namesBytes), { code: 'AUTHOR-COMPILE-PROTOCOL' });
protocolCases.push('missing-arena-refused');
rejectWire('occurrence-index', copy => { copy.lexical.occurrences[0]!.id = copy.lexical.occurrences.length; });
rejectWire('source-range', copy => { copy.lexical.occurrences[0]!.origin = { pointer: '', start: 0, end: namesBytes.length + 1 }; });
rejectWire('scope-parent-cycle', copy => { copy.lexical.scopes[0]!.parent = 0; });
rejectWire('binding-scope-edge', copy => { copy.lexical.bindings[0]!.scope = copy.lexical.scopes.length; });
rejectWire('duplicate-domain', copy => { copy.lexical.bindings[0]!.domains = ['value', 'value']; });
rejectWire('use-binding-edge', copy => { copy.lexical.uses[0]!.resolution = { state: 'resolved', binding: copy.lexical.bindings.length }; });
rejectWire('control-target-kind', copy => {
  const exit = copy.lexical.exits.find(item => item.kind === 'break');
  const target = copy.lexical.scopes.find(item => item.kind === 'function');
  assert.ok(exit && target);
  exit.target = { state: 'resolved', scope: target.id };
});
rejectWire('capture-boundary-kind', copy => {
  const target = copy.lexical.scopes.find(item => item.kind === 'function');
  assert.ok(target);
  copy.lexical.captures[0]!.scope = target.id;
});
rejectWire('pending-occurrence-edge', copy => { copy.lexical.pending_regions.push({ occurrence: copy.lexical.occurrences.length, code: 'unavailable' }); });
assert.throws(() => parseAuthorNameAnalysis(names, Buffer.concat([namesBytes, Buffer.from(' ')])), { code: 'AUTHOR-COMPILE-REVISION' });
protocolCases.push('different-captured-bytes');
const namesCli = await runCommand('bun', ['run', 'sec', '--', 'author', '--names', '--input', namesRelative, '--kernel', kernel, '--json'], {
  cwd: root, timeoutMs: 30_000, maxStdoutBytes: 4 * 1024 * 1024, maxStderrBytes: 64 * 1024
});
assert.equal(namesCli.code, 0, namesCli.stderr);
assert.deepEqual(JSON.parse(namesCli.stdout), names);
const conflictingModes = await runCommand('bun', ['run', 'sec', '--', 'author', '--read', '--names', '--input', namesRelative, '--kernel', kernel, '--json'], {
  cwd: root, timeoutMs: 30_000, maxStdoutBytes: 64 * 1024, maxStderrBytes: 64 * 1024
});
assert.notEqual(conflictingModes.code, 0);
await assert.rejects(compileAuthorModule(root, 'crates/gift-author-kernel/fixtures/shared-views.module.json', kernel, 'names'), /UnsupportedAuthorSchema/);
await assert.rejects(compileAuthorModule(root, path.relative(root, project), kernel, 'names'), /NeedsModuleCapture/);

// The same frontend consumes an ordinary module and a captured Project. These
// assertions concern actual source-bound semantic results, without emitting a target.
const intType = { tag: 'scalar', name: 'int' };
const leafFunction = { kind: 'core:function', body: { parameters: [], returns: intType,
  body: { op: 'literal', type: intType, value: '9' } } };
const analysisModuleBytes = Buffer.from(`${JSON.stringify({ schema: 'gift.author-module/design-converged',
  moduleId: 'module:analysis-leaf', definitions: { Leaf: leafFunction }, exports: ['Leaf'] })}\r\n`);
const analysisModulePath = path.join(work, 'analysis.module.json');
writeFileSync(analysisModulePath, analysisModuleBytes, { flag: 'wx' });
const analyzed = await compileAuthorModule(root, path.relative(root, analysisModulePath), kernel, 'analyze');
assert.equal(analyzed.state, 'prepared');
assert.equal(analyzed.schema, 'gift.author-analysis/1');
assert.equal(analyzed.purpose, 'analyze');
assert.equal('artifacts' in analyzed, false);
assert.ok(analyzed.analysis);
assert.equal(analyzed.analysis.names.identity_scope, 'module-use');
assert.deepEqual(analyzed.analysis.problems, []);
assert.deepEqual(analyzed.analysis.body_problems, []);
const leaf = analyzed.analysis.names.declarations.find(declaration => declaration.name === 'Leaf');
assert.ok(leaf);
assert.ok(analyzed.analysis.signatures.some(signature => signature.declaration === leaf.id
  && signature.state === 'type_ready' && signature.body_type_checked));
assert.ok(analyzed.analysis.effects.declarations.some(effect => effect.declaration === leaf.id
  && effect.state === 'body_derived' && effect.may.length === 0));
assert.deepEqual(readFileSync(analysisModulePath), analysisModuleBytes);

const projectRoot = path.join(work, 'analyzed-project');
mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
const projectSources = new Map<string, Buffer>([
  ['project.json', Buffer.from(JSON.stringify({ schema: 'gift.project/design-converged',
    projectId: 'project:analysis', sourceScopes: [{ root: 'src', kind: 'semantic',
      editSource: { mode: 'file' } }] }))],
  ['src/library.module.json', analysisModuleBytes],
  ['src/consumer.module.json', Buffer.from(JSON.stringify({ schema: 'gift.author-module/design-converged',
    moduleId: 'module:analysis-consumer', imports: { library: { mode: 'workspace', moduleId: 'module:analysis-leaf' } },
    definitions: { Use: { kind: 'core:function', body: { parameters: [], returns: intType,
      body: { op: 'call', callee: { op: 'symbol', ref: { space: 'import', alias: 'library', export: 'Leaf' } },
        arguments: [] } } } }, exports: { forwarded: { import: 'library', export: 'Leaf' } } }))]
]);
for (const [locator, bytes] of projectSources) writeFileSync(path.join(projectRoot, locator), bytes, { flag: 'wx' });
const analyzedProjectRelative = path.relative(root, path.join(projectRoot, 'project.json'));
const analyzedProjectLocator = analyzedProjectRelative.split(path.sep).join('/');
const analyzedProject = await compileAuthorModule(root, analyzedProjectRelative, kernel, 'analyze');
assert.equal(analyzedProject.state, 'prepared');
assert.deepEqual(analyzedProject.requests, []);
assert.deepEqual(analyzedProject.needs, []);
assert.equal(analyzedProject.modules.length, 2);
assert.ok(analyzedProject.budget.requested.work < analyzed.budget.requested.work,
  'Project capture continuation must consume the original native work balance');
assert.ok(analyzedProject.budget.requested.allocation_bytes < analyzed.budget.requested.allocation_bytes,
  'Project capture continuation must consume the original native allocation balance');
assert.ok(analyzedProject.analysis);
assert.deepEqual(analyzedProject.analysis.problems, []);
assert.deepEqual(analyzedProject.analysis.body_problems, []);
const projectNames = analyzedProject.analysis.names;
const targetDeclaration = projectNames.declarations.find(declaration => declaration.name === 'Leaf');
const callerDeclaration = projectNames.declarations.find(declaration => declaration.name === 'Use');
assert.ok(targetDeclaration && callerDeclaration);
assert.notEqual(targetDeclaration.module, callerDeclaration.module);
const forwarded = projectNames.exports.find(exported => exported.name === 'forwarded');
assert.ok(forwarded?.resolution.state === 'resolved');
assert.equal(forwarded.resolution.declaration, targetDeclaration.id);
assert.ok(projectNames.references.some(reference => reference.module === callerDeclaration.module
  && reference.resolution.state === 'resolved' && reference.resolution.declaration === targetDeclaration.id));
for (const declaration of [targetDeclaration, callerDeclaration]) {
  assert.ok(analyzedProject.analysis.signatures.some(signature => signature.declaration === declaration.id
    && signature.state === 'type_ready' && signature.body_type_checked));
  assert.ok(analyzedProject.analysis.effects.declarations.some(effect => effect.declaration === declaration.id
    && effect.state === 'body_derived' && effect.may.length === 0));
}
for (const [locator, bytes] of projectSources) assert.deepEqual(readFileSync(path.join(projectRoot, locator)), bytes);
const capturedSources = new Map<string, Uint8Array>();
for (const source of analyzedProject.sources) {
  const localLocator = path.posix.relative(path.posix.dirname(analyzedProjectLocator), source.locator);
  const bytes = projectSources.get(localLocator);
  assert.ok(bytes, `Unexpected capture locator ${source.locator}`);
  assert.equal(source.byte_length, bytes.byteLength);
  assert.equal(source.revision, `sha256:${createHash('sha256').update(bytes).digest('hex')}`);
  capturedSources.set(source.locator, bytes);
}
assert.equal(capturedSources.size, projectSources.size);
assert.deepEqual(parseAuthorAnalysis(analyzedProject, capturedSources,
  { budget: analyzedProject.budget.requested, rootLocator: analyzedProjectLocator }), analyzedProject);
const analysisProtocolCases: string[] = [];
function rejectAnalysis(name: string, mutate: (copy: AuthorAnalysisResult) => void): void {
  const copy = structuredClone(analyzedProject);
  mutate(copy);
  assert.throws(() => parseAuthorAnalysis(copy, capturedSources,
    { budget: analyzedProject.budget.requested, rootLocator: analyzedProjectLocator }), name);
  analysisProtocolCases.push(name);
}
rejectAnalysis('captured-revision', copy => { copy.sources[0]!.revision = `sha256:${'0'.repeat(64)}`; });
rejectAnalysis('module-source-association', copy => { copy.modules[0]!.locator = copy.modules[1]!.locator; });
rejectAnalysis('module-use-association', copy => { copy.modules[0]!.module_use.module_id = 'module:forged'; });
rejectAnalysis('source-range', copy => {
  const source = copy.analysis!.sources.find(item => item.origin !== null);
  assert.ok(source?.origin);
  source.origin.end = 32 * 1024 * 1024 + 1;
});
rejectAnalysis('foreign-source-module', copy => { copy.analysis!.sources[0]!.module = copy.modules.length; });
rejectAnalysis('foreign-declaration-owner', copy => {
  const source = copy.analysis!.sources.find(item => item.owner !== null);
  assert.ok(source);
  const foreign = copy.analysis!.names.declarations.find(item => item.module !== source.module);
  assert.ok(foreign);
  source.owner = foreign.id;
});
rejectAnalysis('capture-parent-escape', copy => {
  copy.state = 'waiting'; copy.requests = [{ kind: 'file', path: '../outside.json', scope_root: '.' }];
});
rejectAnalysis('capture-absolute-escape', copy => {
  copy.state = 'waiting'; copy.requests = [{ kind: 'file', path: 'C:/outside.json', scope_root: '.' }];
});
rejectAnalysis('native-budget-refill', copy => { copy.budget.remaining.work = copy.budget.requested.work + 1; });
const analysisCli = await runCommand('bun', ['run', 'sec', '--', 'author', '--analyze', '--input', analyzedProjectRelative,
  '--kernel', kernel, '--json'], { cwd: root, timeoutMs: 30_000, maxStdoutBytes: 4 * 1024 * 1024, maxStderrBytes: 64 * 1024 });
assert.equal(analysisCli.code, 0, analysisCli.stderr);
assert.deepEqual(JSON.parse(analysisCli.stdout), analyzedProject);
const conflictingAnalysisModes = await runCommand('bun', ['run', 'sec', '--', 'author', '--analyze', '--names',
  '--input', analyzedProjectRelative, '--kernel', kernel, '--json'], {
  cwd: root, timeoutMs: 30_000, maxStdoutBytes: 64 * 1024, maxStderrBytes: 64 * 1024
});
assert.notEqual(conflictingAnalysisModes.code, 0);
const wrongTypePath = path.join(work, 'wrong-result-type.module.json');
writeFileSync(wrongTypePath, JSON.stringify({ schema: 'gift.author-module/design-converged', moduleId: 'module:wrong-type',
  definitions: { Wrong: { ...leafFunction, body: { ...leafFunction.body, returns: { tag: 'scalar', name: 'bool' } } } } }), { flag: 'wx' });
const wrongType = await compileAuthorModule(root, path.relative(root, wrongTypePath), kernel, 'analyze');
assert.ok(wrongType.analysis);
assert.ok(wrongType.analysis.signatures.some(signature => signature.state === 'rejected')
  || wrongType.analysis.body_problems.length > 0, 'An Int result cannot satisfy a Bool return contract');
writeFileSync(path.join(work, 'evidence.json'), JSON.stringify({ sourceRevision: result.source_revision, grammarRevision: result.grammar_revision,
  nameInputRevision: names.input_revision, protocolCases, analysisProtocolCases,
  analysisInputBasis: analyzedProject.analysis.input_basis,
  cases: ['exact-source-and-number-lexeme', 'actual-cli', 'project', 'duplicate-key', 'historical-compile', 'no-reader-fallback',
    'native-name-analysis', 'native-lexical-arena', 'host-protocol-boundaries', 'actual-name-cli', 'exclusive-modes', 'no-name-format-fallback', 'project-needs-capture',
    'actual-module-analysis', 'project-workspace-import', 'public-forwarding', 'source-bound-types-and-effects',
    'analysis-protocol-boundaries', 'actual-analysis-cli', 'analysis-exclusive-modes', 'semantic-type-rejection'], result: 'PASS' }, null, 2));
console.log(JSON.stringify({ result: 'PASS', evidence: path.join(work, 'evidence.json') }));
