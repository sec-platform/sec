import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { generateRuntimeLibraryScaffold } from '../../src/adapters/compilation/compose/generate-runtime-library.ts';
import { TemplateEngine } from '../../src/adapters/compilation/compose/template-engine.ts';

const lock = () => ({ resolvedBlocks: [] } as never);
async function fixture(run: (root: string, target: string) => Promise<void>) {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-scaffold-'));
  const target = path.join(root, 'src/runtime/store.ts'); mkdirSync(path.dirname(target), { recursive: true });
  // The unrelated empty fast inventory is already materialized; these cases
  // isolate the store's publication and no-op preconditions.
  mkdirSync(path.join(root, 'tests'), { recursive: true });
  writeFileSync(path.join(root, 'tests/fast.test.ts'), "import { test } from 'node:test';\ntest.skip('no installed fast suites', () => {});\n");
  const render = TemplateEngine.render;
  TemplateEngine.render = () => 'generated';
  try { await run(root, target); } finally { TemplateEngine.render = render; rmSync(root, { recursive: true, force: true }); }
}

test('runtime scaffold refuses a modified existing target instead of overwriting it', async () => fixture(async (root, target) => {
  writeFileSync(target, 'old');
  await assert.rejects(generateRuntimeLibraryScaffold(root, lock(), async () => { writeFileSync(target, 'user'); }), /preimage changed/);
  assert.equal(readFileSync(target, 'utf8'), 'user');
}));

test('a concurrently created scaffold file with different bytes is not overwritten', async () => fixture(async (root, target) => {
  await assert.rejects(generateRuntimeLibraryScaffold(root, lock(), async () => { writeFileSync(target, 'user'); }));
  assert.equal(readFileSync(target, 'utf8'), 'user');
}));

test('unchanged scaffold content needs no write grant', async () => fixture(async (root, target) => {
  writeFileSync(target, 'generated');
  const paths = await generateRuntimeLibraryScaffold(root, lock(), async () => assert.fail('no-op write'));
  assert.ok(paths.includes('src/runtime/store.ts')); assert.equal(readFileSync(target, 'utf8'), 'generated');
}));

test('an aborted scaffold invocation cannot render or acquire write authority', async () => fixture(async root => {
  const controller = new AbortController(), reason = new Error('cancelled'); controller.abort(reason);
  TemplateEngine.render = () => assert.fail('cancelled render');
  await assert.rejects(generateRuntimeLibraryScaffold(root, lock(), async () => assert.fail('cancelled write'), controller.signal), error => error === reason);
}));

test('render callbacks cannot change the selected workspace of this invocation', async () => fixture(async (root, target) => {
  const cwd = process.cwd();
  try {
    process.chdir(root); TemplateEngine.render = () => { process.chdir(tmpdir()); return 'generated'; };
    await generateRuntimeLibraryScaffold('.', lock()); assert.equal(readFileSync(target, 'utf8'), 'generated');
  } finally { process.chdir(cwd); }
}));

test.skipIf(process.platform === 'win32')('generated fast registration preserves hostile names as inert literals', async () => fixture(async root => {
  const names = ['quote\'"`);globalThis.__secLiteralAttack=true;(".test.ts',
    '<script>literal<.test.ts', 'line\u2028separator\u2029.test.ts', 'percent%23#?.test.ts'];
  mkdirSync(path.join(root, 'tests/unit'), { recursive: true });
  for (const name of names) writeFileSync(path.join(root, 'tests/unit', name), 'export function runSuite() {}\n');
  await generateRuntimeLibraryScaffold(root, lock());
  const text = readFileSync(path.join(root, 'tests/fast.test.ts'), 'utf8');
  const source = ts.createSourceFile('fast.test.ts', text, ts.ScriptTarget.Latest, true);
  const syntax = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
  assert.equal(syntax.diagnostics?.length ?? 0, 0);
  assert.equal(source.statements.length, names.length + 1);
  assert.ok(ts.isImportDeclaration(source.statements[0]!));
  for (const character of ['<', '>', '\u2028', '\u2029']) assert.equal(text.includes(character), false);
  // Link only the emitted program's two platform dependencies. No suite file
  // executes: dynamic imports are recorded, while the real callback structure
  // is evaluated so injected top-level or callback statements remain visible.
  const transformed = ts.transform(source, [context => rootNode => {
    const visit: ts.Visitor = node => {
      if (ts.isImportDeclaration(node)) return undefined;
      if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) return ts.factory.createIdentifier('moduleContext');
      const visited = ts.visitEachChild(node, visit, context);
      if (ts.isCallExpression(visited) && visited.expression.kind === ts.SyntaxKind.ImportKeyword) {
        return ts.factory.createCallExpression(ts.factory.createIdentifier('loadSuite'), undefined, visited.arguments);
      }
      return visited;
    };
    return ts.visitNode(rootNode, visit) as ts.SourceFile;
  }]);
  const registrations: Array<{ name: string; run: () => Promise<void> }> = [];
  const imports: string[] = []; let runs = 0;
  const sandbox = { URL, moduleContext: { url: 'file:///fixture/tests/fast.test.ts' },
    test: (name: string, run: () => Promise<void>) => registrations.push({ name, run }),
    loadSuite: async (url: string) => { imports.push(url); return { runSuite: () => { runs++; } }; },
    __secLiteralAttack: false };
  try { new vm.Script(ts.createPrinter().printFile(transformed.transformed[0]!)).runInNewContext(sandbox); }
  finally { transformed.dispose(); }
  for (const registration of registrations) await registration.run();
  const expected = names.map(name => `unit/${name}`).sort();
  assert.deepEqual(registrations.map(value => value.name), expected);
  assert.deepEqual(imports.map(value => decodeURIComponent(new URL(value).pathname)), expected.map(value => `/fixture/tests/${value}`));
  assert.equal(runs, names.length);
  assert.equal(sandbox.__secLiteralAttack, false);
}));
