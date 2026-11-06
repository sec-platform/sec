// Native transport and the real repository author CLI, without target generation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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
writeFileSync(path.join(work, 'evidence.json'), JSON.stringify({ sourceRevision: result.source_revision, grammarRevision: result.grammar_revision,
  nameInputRevision: names.input_revision, protocolCases,
  cases: ['exact-source-and-number-lexeme', 'actual-cli', 'project', 'duplicate-key', 'historical-compile', 'no-reader-fallback',
    'native-name-analysis', 'native-lexical-arena', 'host-protocol-boundaries', 'actual-name-cli', 'exclusive-modes', 'no-name-format-fallback', 'project-needs-capture'], result: 'PASS' }, null, 2));
console.log(JSON.stringify({ result: 'PASS', evidence: path.join(work, 'evidence.json') }));
