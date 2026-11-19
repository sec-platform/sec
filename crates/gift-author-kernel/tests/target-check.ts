// Focused native target verification. Run after building the locked Rust binary.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { parseAuthorGeneration, type AuthorGenerationResult } from '../../../src/adapters/compilation/author-analysis-transport.ts';
import { compileAuthorModule } from '../../../src/adapters/compilation/author-kernel.ts';
import { runCommand } from '../../../src/adapters/runtime-state/physical/runtime/process.ts';
import { withNativeTestWorkspace } from '../../../src/adapters/self-hosting/development/runner/native-test-workspace.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const kernel = process.argv[2];
assert.ok(kernel, 'Pass the workspace-relative built Rust executable');
assert.equal(ts.version, '6.0.3', 'Use the repository-pinned target compiler');
const sourceFile = 'crates/gift-author-kernel/fixtures/shared-views.module.json';
const sourceBytes = readFileSync(path.join(root, sourceFile));
const source = JSON.parse(sourceBytes.toString('utf8'));
await withNativeTestWorkspace(root, async work => {
const results: unknown[] = [];
const runtime = await runCommand('node', ['--version'], { cwd: root, timeoutMs: 10_000, maxStdoutBytes: 1024, maxStderrBytes: 1024 });
assert.equal(runtime.code, 0, runtime.stderr);
const big = '922337203685477580812345678901234567890';
const nine = { enabled: true, label: 'nine', score: '9' };
const five = { enabled: true, label: 'repeated-five', score: '5' };
const large = { enabled: true, label: 'very-positive', score: big };
const original = [nine, five, five, large];
const above = [nine, large];

async function check(name: string, value: unknown, expected: unknown): Promise<void> {
  const input = path.join(work, `${name}.module.json`);
  writeFileSync(input, JSON.stringify(value, null, 2), { flag: 'wx' });
  const bundle = await compileAuthorModule(root, path.relative(root, input), kernel);
  const output = path.join(work, name);
  mkdirSync(output);
  assert.deepEqual(bundle.artifacts.map(member => member.path).sort(), ['package.json', 'src/index.ts', 'src/main.ts', 'tsconfig.json']);
  for (const member of bundle.artifacts) {
    const filename = path.join(output, member.path);
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, member.content, { flag: 'wx' });
  }
  const configFile = path.join(output, 'tsconfig.json');
  const config = ts.readConfigFile(configFile, ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, output);
  assert.equal(parsed.errors.length, 0);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => output, getCanonicalFileName: filename => filename, getNewLine: () => '\n'
  }));
  const indexSource = program.getSourceFile(path.join(output, 'src/index.ts'));
  assert.ok(indexSource);
  const declarations = indexSource.statements.filter(statement => ts.isVariableStatement(statement) || ts.isFunctionDeclaration(statement) || ts.isTypeAliasDeclaration(statement));
  const generated = declarations.filter(statement => {
    if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && /^d\d+$/.test(declaration.name.text));
    return statement.name !== undefined && /^d\d+$/.test(statement.name.text);
  });
  assert.equal(generated.length, bundle.source_map.length);
  for (const [index, statement] of generated.entries()) {
    const mapping = bundle.source_map[index];
    assert.equal(mapping.start_line, indexSource.getLineAndCharacterOfPosition(statement.getStart(indexSource)).line + 1);
    assert.equal(mapping.end_line, indexSource.getLineAndCharacterOfPosition(statement.end).line + 1);
  }
  assert.equal(program.emit().emitSkipped, false);
  const execution = await runCommand('node', [path.join(output, 'dist/main.js')], {
    cwd: output, timeoutMs: 10_000, maxStdoutBytes: 1024 * 1024, maxStderrBytes: 64 * 1024
  });
  assert.equal(execution.code, 0, execution.stderr);
  assert.deepEqual(JSON.parse(execution.stdout), expected);
  assert.ok(bundle.source_map.every(mapping => mapping.source_revision === bundle.source_revision));
  const clean = await compileAuthorModule(root, path.relative(root, input), kernel);
  assert.deepEqual(clean, bundle, 'Repeated clean compilation of fixed bytes must be identical');
  results.push({ name, sourceRevision: bundle.source_revision, semanticRevision: bundle.semantic_revision,
    compiler: ts.version, build: 'PASS', runtime: runtime.stdout.trim(), output: JSON.parse(execution.stdout) });
}

async function checkRustProject(): Promise<unknown> {
  const rustc = process.env.RUSTC;
  assert.ok(rustc && path.isAbsolute(rustc), 'The native runner must pass its exact absolute RUSTC executable');
  const projectDirectory = path.join(work, 'rust-project');
  mkdirSync(path.join(projectDirectory, 'src'), { recursive: true });
  mkdirSync(path.join(projectDirectory, 'profiles'));
  const relative = (filename: string): string => path.relative(root, filename).replaceAll('\\', '/');
  const revision = (bytes: Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const scalar = (name: string) => ({ tag: 'scalar', name });
  const literal = (name: string, value: unknown) => ({ op: 'literal', type: scalar(name), value });
  const variable = (name: string) => ({ op: 'var', name });
  const local = (name: string) => ({ op: 'symbol', ref: `local:${name}` });
  const imported = (name: string) => ({ op: 'symbol', ref: { space: 'import', alias: 'support', export: name } });
  const call = (callee: unknown, arguments_: unknown[]) => ({ op: 'call', callee, arguments: arguments_ });
  const parameter = (name: string, type: unknown) => ({ name, type });
  const fn = (parameters: unknown[], returns: unknown, body: unknown) => ({ kind: 'core:function', body: { parameters, returns, body } });
  const recordType = (names: string[]) => ({ tag: 'record', fields: Object.fromEntries(names.map(name => [name, { type: scalar('text') }])) });
  const record = (fields: [string, unknown][]) => ({ op: 'record', fields: fields.map(([name, value]) => ({ name, value })) });
  const pair = recordType(['first', 'second']);
  const triple = recordType(['first', 'second', 'third']);
  const unicodeText = 'A"\\\0\n\r\té e\u0301 東京 😀\u2028\u2029';
  const main = {
    schema: 'gift.author-module/design-converged', moduleId: 'target:Main',
    imports: { support: { mode: 'workspace', moduleId: 'target:Support' } },
    definitions: {
      Flag: { kind: 'core:type', body: { type: scalar('bool') } },
      BoolValue: fn([], scalar('bool'), literal('bool', true)),
      UnitValue: fn([], scalar('unit'), { op: 'exec:block', statements: [] }),
      TextValue: fn([], scalar('text'), literal('text', unicodeText)),
      Repeat: fn([parameter('value', scalar('text'))], pair, record([['first', variable('value')], ['second', variable('value')]])),
      Shadow: fn([parameter('value', scalar('text'))], pair, {
        op: 'let', name: 'saved', value: variable('value'), body: {
          op: 'let', name: 'value', value: variable('value'), body: {
            op: 'let', name: 'value', value: literal('text', 'inner'),
            body: record([['second', variable('value')], ['first', variable('saved')]])
          }
        }
      }),
      Choose: fn([parameter('flag', { tag: 'nominal', ref: 'local:Flag' })], scalar('text'), {
        op: 'if', condition: variable('flag'),
        then: call(imported('Echo'), [literal('text', 'chosen-true')]),
        otherwise: call(imported('Echo'), [literal('text', 'chosen-false')])
      }),
      Ordered: fn([], triple, call(imported('Pack'), [literal('text', 'first'), literal('text', 'second'), literal('text', 'third')])),
      ProjectSecond: fn([], scalar('text'), { op: 'field', record: call(local('Ordered'), []), name: 'second' })
    },
    exports: {
      bool_value: { definitionId: 'BoolValue' }, unit_value: { definitionId: 'UnitValue' },
      text_value: { definitionId: 'TextValue' }, repeat: { definitionId: 'Repeat' },
      shadow: { definitionId: 'Shadow' }, choose: { definitionId: 'Choose' },
      ordered: { definitionId: 'Ordered' }, project_second: { definitionId: 'ProjectSecond' },
      forwarded: { import: 'support', export: 'Echo' }
    }
  };
  const support = {
    schema: 'gift.author-module/design-converged', moduleId: 'target:Support',
    definitions: {
      Echo: fn([parameter('value', scalar('text'))], scalar('text'), variable('value')),
      Pack: fn(['first', 'second', 'third'].map(name => parameter(name, scalar('text'))), triple,
        record([['third', variable('third')], ['first', variable('first')], ['second', variable('second')]]))
    },
    exports: { Echo: { definitionId: 'Echo' }, Pack: { definitionId: 'Pack' } }
  };
  const profileRef = { id: 'target:rust-source-profile', revision: 'fixture-1' };
  const project = {
    schema: 'gift.project/design-converged', projectId: 'project:target-oracle',
    sourceScopes: [{ root: 'src', kind: 'semantic', editSource: { mode: 'file' } }],
    defaultTarget: 'rust', targets: { rust: {
      profileRef, outputRoots: [{ rootId: 'main', moduleId: 'target:Main' }],
      parameters: { edition: '2024', crateName: 'gift_target_oracle', stdProfile: 'std', crateShape: 'library', emit: 'source' }
    } }
  };
  const profile = {
    schema: 'gift.target-profile-manifest/design-converged', profile: profileRef, publisher: 'target-oracle',
    accepts: ['core:function'],
    representation: { language: 'rust', textIndexUnit: 'unicode-scalar', integerMode: 'other-qualified', exceptionModel: 'panic', moduleMode: 'library' },
    loweringRefs: [{ moduleId: 'gift:rust-source-library', export: 'emit' }],
    toolchainRequirements: [{ id: 'rustc', revision: 'source-only-not-materialized' }],
    members: [{ role: 'source', required: true, pathPattern: 'lib.rs' }],
    host: { effects: [], runtimeRequirements: ['std'] },
    compatibility: { policy: 'exact', migrationRequired: false }, evidenceObligations: ['source-preservation', 'source-map']
  };
  const captured = new Map<string, Uint8Array>();
  const writeFixture = (filename: string, value: unknown): Buffer => {
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\r\n`);
    writeFileSync(filename, bytes, { flag: 'wx' });
    captured.set(relative(filename), bytes);
    return bytes;
  };
  const projectPath = path.join(projectDirectory, 'gift.project.json');
  const mainPath = path.join(projectDirectory, 'src', 'main.json');
  const supportPath = path.join(projectDirectory, 'src', 'support.json');
  const profilePath = path.join(projectDirectory, 'profiles', 'rust.json');
  writeFixture(projectPath, project);
  const mainBytes = writeFixture(mainPath, main);
  const supportBytes = writeFixture(supportPath, support);
  const profileBytes = writeFixture(profilePath, profile);
  const input = relative(projectPath);
  const waiting = await compileAuthorModule(root, input, kernel, { kind: 'generate' });
  assert.equal(waiting.state, 'waiting');
  assert.equal(waiting.generation, null);
  assert.ok(waiting.needs.some(need => need.code === 'SourceAbsent' && need.locator === relative(path.join(projectDirectory, 'gift.lock.json'))),
    JSON.stringify(waiting.needs));
  // Persistent target coordinates use the actual Project identity and installed
  // interpretation. A profileRef is an identity request, never a file locator.
  const bindingKey = JSON.stringify({
    project_scope: project.projectId, resolution_domain: 'gift:captured-author-resolver/1', interpretation: waiting.interpretation,
    slot: { role: 'target_profile', target: 'rust' }
  });
  const lock = {
    schema: 'gift.binding-lock/1', projectId: project.projectId,
    resolutionInputs: { resolver: waiting.resolver_binding, grammarRevision: waiting.grammar_revision, requests: { [bindingKey]: profileRef } },
    bindings: { [bindingKey]: 'rust-profile' },
    nodes: { 'rust-profile': {
      kind: 'target-profile', subjectId: profileRef.id, revision: profileRef.revision, dependencies: [], locationHint: 'profiles/rust.json',
      content: { algorithm: 'sha256', digest: revision(profileBytes).slice(7), byteLength: profileBytes.length,
        format: 'gift.target-profile-manifest/design-converged' }
    } }
  };
  const lockPath = path.join(projectDirectory, 'gift.lock.json');
  writeFixture(lockPath, lock);
  const generated = await compileAuthorModule(root, input, kernel, { kind: 'generate' });
  assert.equal(generated.state, 'prepared', JSON.stringify(generated.needs));
  const output = generated.generation;
  assert.ok(output, 'Prepared generation must retain its actual source Method result');
  assert.equal(output.state, 'complete', JSON.stringify({ needs: output.needs, problems: output.problems }));
  assert.equal(output.members_complete, true);
  assert.deepEqual(output.artifacts.map(member => member.path), ['lib.rs']);
  assert.ok(output.unrequested_checks.includes('rustc-compilation'));
  assert.ok(output.unrequested_checks.includes('execution'));
  assert.ok(output.context);
  assert.equal(output.context.crate_name, 'gift_target_oracle');
  assert.equal(output.context.edition, '2024');
  assert.equal(output.context.crate_shape, 'library');
  assert.equal(output.context.emit, 'source');
  assert.ok(output.provenance);
  assert.deepEqual(output.provenance.binding, JSON.parse(bindingKey));
  assert.equal(output.provenance.profile_id, profileRef.id);
  assert.equal(output.provenance.profile_revision, profileRef.revision);
  assert.equal(output.provenance.profile_source_revision, revision(profileBytes));
  assert.equal(output.provenance.lock_revision, revision(captured.get(relative(lockPath))!));
  const analyzed = generated.analysis;
  assert.ok(analyzed);
  const mainModule = generated.modules.find(module => module.module_use.module_id === main.moduleId);
  const supportModule = generated.modules.find(module => module.module_use.module_id === support.moduleId);
  assert.ok(mainModule && supportModule);
  assert.equal(mainModule.source_revision, revision(mainBytes));
  assert.equal(supportModule.source_revision, revision(supportBytes));
  const declaration = (module: number, name: string) => {
    const found = analyzed.names.declarations.find(item => item.module === module && item.name === name);
    assert.ok(found, `Expected the real declaration ${name}`);
    return found.id;
  };
  const orderedId = declaration(mainModule.id, 'Ordered');
  const packId = declaration(supportModule.id, 'Pack');
  assert.ok(output.dependencies.find(item => item.declaration === orderedId)?.callees.includes(packId));
  for (const mapping of output.source_map) {
    const original = mapping.source_module === mainModule.id ? mainBytes : mapping.source_module === supportModule.id ? supportBytes : undefined;
    assert.ok(original, 'A generated declaration must map to one of the two authored modules');
    assert.equal(mapping.source_revision, revision(original));
  }
  assert.ok(output.source_map.some(mapping => mapping.source_module === supportModule.id && mapping.definition === 'Pack'));
  assert.ok(output.source_map.some(mapping => mapping.source_module === mainModule.id && mapping.definition === 'Ordered'));
  assert.deepEqual(output.exports.map(item => item.export).sort(), Object.keys(main.exports).sort());
  const forwarded = output.exports.find(item => item.export === 'forwarded');
  assert.ok(forwarded);
  assert.equal(forwarded.declaration, declaration(supportModule.id, 'Echo'));
  assert.ok(forwarded.route.some(hop => hop.via_import === 'support'));
  const explicit = await compileAuthorModule(root, input, kernel, { kind: 'generate', target: 'rust' });
  assert.equal(explicit.state, 'prepared');
  assert.ok(explicit.generation);
  assert.equal(explicit.generation.state, 'complete');
  assert.deepEqual(explicit.generation.artifacts, output.artifacts, 'Explicit selection and its authored default generate the same library');
  assert.deepEqual(explicit.generation.context, output.context);
  assert.deepEqual(explicit.generation.provenance, output.provenance);
  const unknown = await compileAuthorModule(root, input, kernel, { kind: 'generate', target: 'not-a-target' });
  assert.equal(unknown.state, 'waiting');
  assert.equal(unknown.generation, null);
  assert.ok(unknown.needs.some(need => need.code === 'NeedsTargetSelection' && need.path === '/targets/not-a-target'));
  const cli = await runCommand(process.execPath, ['src/bootstrap/cli/cli.ts', 'author', '--generate', 'rust', '--input', input, '--kernel', kernel, '--json'], {
    cwd: root, timeoutMs: 30_000, maxStdoutBytes: 64 * 1024 * 1024, maxStderrBytes: 64 * 1024
  });
  assert.equal(cli.code, 0, cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout), explicit, 'The actual CLI must expose the real generation transport result');
  const conflicting = await runCommand(process.execPath, ['src/bootstrap/cli/cli.ts', 'author', '--generate', 'rust', '--read', '--input', input, '--kernel', kernel, '--json'], {
    cwd: root, timeoutMs: 30_000, maxStdoutBytes: 64 * 1024, maxStderrBytes: 64 * 1024
  });
  assert.notEqual(conflicting.code, 0, 'Generate and read are mutually exclusive actual CLI modes');
  const expected = { budget: generated.budget.requested, rootLocator: input, basis: generated.basis,
    interpretation: generated.interpretation, target: 'rust' };
  assert.deepEqual(parseAuthorGeneration(generated, captured, expected), generated, 'The actual result is the protocol control');
  // The host verifies retained profile/lock bytes and report associations.
  // Their semantic identity is checked by the original Rust Reader/resolver;
  // this oracle does not add a second profile or lock interpreter here.
  const protocolCases: string[] = [];
  const rejectWire = (name: string, mutate: (copy: AuthorGenerationResult) => void): void => {
    const copy = structuredClone(generated);
    mutate(copy);
    assert.throws(() => parseAuthorGeneration(copy, captured, expected), /AUTHOR-ANALYSIS-PROTOCOL|Native|Generation|Rust|captured|Analysis/,
      `Reject tampered ${name} at the actual host boundary`);
    protocolCases.push(name);
  };
  const wrongRevision = `sha256:${'0'.repeat(64)}`;
  rejectWire('candidate basis', copy => { copy.generation!.input_basis = wrongRevision; });
  rejectWire('captured source revision', copy => { copy.sources.find(item => item.locator === relative(mainPath))!.revision = wrongRevision; });
  rejectWire('profile bytes', copy => { copy.generation!.provenance!.profile_source_revision = wrongRevision; });
  rejectWire('lock bytes', copy => { copy.generation!.provenance!.lock_revision = wrongRevision; });
  rejectWire('export declaration', copy => { copy.generation!.exports.find(item => item.export === 'ordered')!.declaration = declaration(mainModule.id, 'BoolValue'); });
  rejectWire('export route', copy => { copy.generation!.exports.find(item => item.export === 'forwarded')!.route[0]!.export = 'bool_value'; });
  rejectWire('export route qualification', copy => {
    const hop = copy.generation!.exports.find(item => item.export === 'forwarded')!.route[0]!;
    hop.qualification = hop.qualification === 'capture-local' ? 'module-use' : 'capture-local';
  });
  rejectWire('source-map definition', copy => { copy.generation!.source_map[0]!.definition = 'not-the-original-definition'; });
  rejectWire('source-map pointer', copy => {
    const mapping = copy.generation!.source_map.find(item => item.definition === 'Ordered')!;
    mapping.source_pointer = '/definitions/BoolValue';
  });
  rejectWire('source-map declaration', copy => {
    const mapping = copy.generation!.source_map.find(item => item.definition === 'Ordered')!;
    mapping.declaration = declaration(mainModule.id, 'BoolValue');
  });
  rejectWire('source-map range', copy => { copy.generation!.source_map[0]!.end_line = output.artifacts[0]!.content.split('\n').length + 1; });
  const nativeDirectory = path.join(work, 'rust-native');
  mkdirSync(nativeDirectory);
  const libraryPath = path.join(nativeDirectory, 'lib.rs');
  writeFileSync(libraryPath, output.artifacts[0]!.content, { flag: 'wx' });
  const libraryArtifact = path.join(nativeDirectory, `lib${output.context.crate_name}.rlib`);
  const compilation = await runCommand(rustc, ['--crate-name', output.context.crate_name, '--edition', output.context.edition,
    '--crate-type', 'rlib', libraryPath, '-o', libraryArtifact], {
    cwd: nativeDirectory, timeoutMs: 30_000, maxStdoutBytes: 1024 * 1024, maxStderrBytes: 64 * 1024
  });
  assert.equal(compilation.code, 0, compilation.stderr);
  const harnessPath = path.join(nativeDirectory, 'oracle.rs');
  writeFileSync(harnessPath, `extern crate gift_target_oracle as generated;

fn expected_text() -> String {
    ['A', '"', '\\\\', '\\0', '\\n', '\\r', '\\t', 'é', ' ', 'e', '\\u{301}', ' ', '東', '京', ' ', '😀', '\\u{2028}', '\\u{2029}'].into_iter().collect()
}

#[test]
fn bool_unit_alias_and_if_values() {
    assert!(generated::bool_value());
    assert_eq!(generated::unit_value(), ());
    assert_eq!(generated::choose(true), "chosen-true");
    assert_eq!(generated::choose(false), "chosen-false");
}

#[test]
fn exact_text_and_repeated_owned_values() {
    let expected = expected_text();
    assert_eq!(generated::text_value().as_bytes(), expected.as_bytes());
    let repeated = generated::repeat(expected.clone());
    assert_eq!(repeated.first.as_bytes(), expected.as_bytes());
    assert_eq!(repeated.second.as_bytes(), expected.as_bytes());
    assert_eq!(generated::forwarded(expected.clone()).as_bytes(), expected.as_bytes());
}

#[test]
fn lexical_shadowing_and_noncommutative_argument_and_field_positions() {
    let shadowed = generated::shadow("outer".to_owned());
    assert_eq!(shadowed.first, "outer");
    assert_eq!(shadowed.second, "inner");
    let ordered = generated::ordered();
    assert_eq!(ordered.first, "first");
    assert_eq!(ordered.second, "second");
    assert_eq!(ordered.third, "third");
    assert_eq!(generated::project_second(), "second");
}
`, { flag: 'wx' });
  const harnessArtifact = path.join(nativeDirectory, process.platform === 'win32' ? 'oracle.exe' : 'oracle');
  const harnessCompilation = await runCommand(rustc, ['--test', '--crate-name', 'gift_target_oracle_tests', '--edition', output.context.edition,
    harnessPath, '--extern', `${output.context.crate_name}=${libraryArtifact}`, '-o', harnessArtifact], {
    cwd: nativeDirectory, timeoutMs: 30_000, maxStdoutBytes: 1024 * 1024, maxStderrBytes: 64 * 1024
  });
  assert.equal(harnessCompilation.code, 0, harnessCompilation.stderr);
  const execution = await runCommand(harnessArtifact, [], {
    cwd: nativeDirectory, timeoutMs: 10_000, maxStdoutBytes: 1024 * 1024, maxStderrBytes: 64 * 1024
  });
  assert.equal(execution.code, 0, execution.stderr);
  for (const [filename, bytes] of captured) {
    assert.deepEqual(readFileSync(path.join(root, filename)), bytes, `Generation and native checks preserve ${filename}`);
  }
  return { target: 'rust', library: 'PASS', harness: 'PASS', cli: 'PASS', protocolCases,
    sourceRevisions: generated.modules.map(module => module.source_revision), output: execution.stdout };
}

try {
  await check('baseline', source, { inherited: original, fixed: original });
  const threshold = structuredClone(source);
  threshold.definitions.DefaultThreshold.body.value.value = '8';
  await check('shared-threshold', threshold, { inherited: above, fixed: original });
  const strict = structuredClone(source);
  strict.definitions.MeetsThreshold.body.body.cases.find((branch: { constructor: string }) => branch.constructor === 'Equal').body.value = false;
  await check('shared-policy', strict, { inherited: above, fixed: above });
  const empty = structuredClone(source);
  empty.definitions.Rows.body.value.items = [];
  await check('empty', empty, { inherited: [], fixed: [] });
  const negative = structuredClone(source);
  negative.definitions.DefaultThreshold.body.value.value = `-${big}`;
  await check('exact-negative', negative, {
    inherited: [nine, five, five, { enabled: true, label: 'very-negative', score: `-${big}` }, large], fixed: original
  });
  const reordered = { ...source, definitions: Object.fromEntries(Object.entries(source.definitions).reverse()) };
  await check('reordered', reordered, { inherited: original, fixed: original });
  const unicode = structuredClone(source);
  unicode.definitions.Rows.body.value.items[0].fields.find((field: { name: string }) => field.name === 'label').value.value = 'a\u2028b\u2029c';
  const unicodeExpected = [{ ...nine, label: 'a\u2028b\u2029c' }, five, five, large];
  await check('unicode-line-separators', unicode, { inherited: unicodeExpected, fixed: unicodeExpected });
  const cli = await runCommand(process.execPath, ['src/bootstrap/cli/cli.ts', 'author', '--input', sourceFile, '--kernel', kernel, '--json'], {
    cwd: root, timeoutMs: 30_000, maxStdoutBytes: 64 * 1024 * 1024, maxStderrBytes: 64 * 1024
  });
  assert.equal(cli.code, 0, cli.stderr);
  const direct = await compileAuthorModule(root, sourceFile, kernel);
  assert.deepEqual(JSON.parse(cli.stdout), direct, 'Actual CLI and compiler adapter must expose the same exact bundle');
  assert.deepEqual(readFileSync(path.join(root, sourceFile)), sourceBytes, 'Compilation must not mutate author bytes');
  const rust = await checkRustProject();
  console.log(JSON.stringify({ status: 'PASS', variants: results.length, cli: 'PASS', results, rust }));
} catch (error) {
  console.error('Target verification failed');
  throw error;
}
}, process.argv[3], { parentOwnsCleanup: process.argv[3] !== undefined });
