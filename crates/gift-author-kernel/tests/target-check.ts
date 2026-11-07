// Focused native target verification. Run after building the locked Rust binary.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
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
  console.log(JSON.stringify({ status: 'PASS', variants: results.length, cli: 'PASS', results }));
} catch (error) {
  console.error('Target verification failed');
  throw error;
}
}, process.argv[3], { parentOwnsCleanup: process.argv[3] !== undefined });
