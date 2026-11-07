import { expect, test } from 'bun:test';
import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import {
  compileTypeScriptSourceProgramModel,
  observeSourceProgramTypeScriptRename,
  observeSourceProgramTypeScriptSyntax
} from './typescript.ts';
import { moduleMembership } from './test/typescript-model-input.ts';

test('TypeScript semantic compilation preserves surfaces, references, syntax and revision isolation', () => {
  const sources = [
    { path: "src/example.ts", source: "export const productionValue = 1;\n" },
    { path: "tests/example.test.ts", source: "export const mirroredTestValue = 2;\n" },
    { path: "catalog/registry/official/example/files/src/generated.ts", source: "export const generatedResourceValue = 3;\n" },
    {
      path: 'src/bootstrap/reference-target.ts',
      source: 'export const target = 1;\nexport default target;\n'
    },
    {
      path: 'src/bootstrap/reference-consumer.ts',
      source: [
        "import defaultAlias, { target as renamed } from './reference-target.ts';",
        "import * as namespaceAlias from './reference-target.ts';",
        "export { target as exposed } from './reference-target.ts';",
        'const local = renamed;',
        'const shorthand = { local };',
        'function shadow(renamed: number) { return renamed; }',
        "const quoted = namespaceAlias['target'];",
        "const computed = namespaceAlias[String('target')];",
        'export const result = defaultAlias + renamed + namespaceAlias.target',
        '  + shorthand.local + shadow(1) + quoted + computed + Math.max(1, 2);'
      ].join('\n')
    },
    { path: 'tests/invalid.test.ts', source: 'export const = ;\n' }
  ];
  const files = sources.map(({ path, source }) => Object.freeze({
    path, source, contentDigest: rawSha256(source)
  }));
  const model = compileTypeScriptSourceProgramModel({
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files,
    moduleMembership
  });

  expect(model.files.filter(({ path }) => path === 'src/example.ts' || path === 'tests/example.test.ts').map(({ path, surface }) => ({ path, surface }))).toEqual([
    { path: 'src/example.ts', surface: 'production' },
    { path: 'tests/example.test.ts', surface: 'test' }
  ]);
  expect(model.declarations.filter(({ path }) => path === 'src/example.ts' || path === 'tests/example.test.ts').map(({ name, path }) => ({ name, path }))).toEqual([
    { name: 'productionValue', path: 'src/example.ts' },
    { name: 'mirroredTestValue', path: 'tests/example.test.ts' }
  ]);
  expect(model.files.some(({ path }) => path.startsWith('catalog/registry/official/'))).toBe(false);
  expect(model.declarations.some(({ name }) => name === 'generatedResourceValue')).toBe(false);

  const targetReferences = model.references.filter(({ targetPath }) => (
    targetPath === 'src/bootstrap/reference-target.ts'
  ));

  expect(targetReferences.map(({ kind, name, moduleSpecifier }) => ({
    kind,
    name,
    moduleSpecifier
  }))).toEqual([
    { kind: 'import', name: 'default', moduleSpecifier: './reference-target.ts' },
    { kind: 'import', name: 'target', moduleSpecifier: './reference-target.ts' },
    { kind: 'import', name: '*', moduleSpecifier: './reference-target.ts' },
    { kind: 'reexport', name: 'target', moduleSpecifier: './reference-target.ts' },
    { kind: 'reference', name: 'renamed', moduleSpecifier: './reference-target.ts' },
    { kind: 'reference', name: 'defaultAlias', moduleSpecifier: './reference-target.ts' },
    { kind: 'reference', name: 'renamed', moduleSpecifier: './reference-target.ts' },
    { kind: 'reference', name: 'target', moduleSpecifier: null },
    { kind: 'reference', name: 'target', moduleSpecifier: null }
  ]);
  expect(observeSourceProgramTypeScriptSyntax(model, 'tests/invalid.test.ts')).toEqual(
    expect.objectContaining({ status: 'resolved', syntax: 'invalid' })
  );

  const source = files.find(({ path }) => path === 'src/example.ts')!.source;
  const position = source.indexOf('productionValue');
  expect(observeSourceProgramTypeScriptRename(model, 'src/example.ts', position)).toEqual(
    expect.objectContaining({ status: 'resolved', canRename: true })
  );
  const changedFiles = files.map((file) => {
    if (file.path !== 'src/example.ts') return file;
    const changedSource = 'export const productionValue = 3;\n';
    return Object.freeze({ ...file, source: changedSource, contentDigest: rawSha256(changedSource) });
  });
  compileTypeScriptSourceProgramModel({
    sourceRevision: sha256(changedFiles.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files: changedFiles,
    moduleMembership
  });
  expect(observeSourceProgramTypeScriptRename(model, 'src/example.ts', position)).toEqual(
    expect.objectContaining({ status: 'unresolved', reason: 'generation-stale' })
  );
});
