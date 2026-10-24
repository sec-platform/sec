import { expect, test } from 'bun:test';
import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { compileTypeScriptSourceProgramModel } from './typescript.ts';

test('TypeScript semantic compilation keeps production and test surfaces distinct while excluding resources', () => {
  const moduleMembership = Object.freeze({
    descriptors: Object.freeze([]),
    graphRoots: Object.freeze([]),
    moduleRoots: Object.freeze([]),
    moduleForPath: () => null
  });
  const files = [
    ['src/example.ts', 'export const productionValue = 1;\n'],
    ['tests/example.test.ts', 'export const mirroredTestValue = 2;\n'],
    ['catalog/registry/official/example/files/src/generated.ts', 'export const generatedResourceValue = 3;\n']
  ].map(([path, source]) => Object.freeze({
    path: path!,
    source: source!,
    contentDigest: rawSha256(source!)
  }));
  const model = compileTypeScriptSourceProgramModel({
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files,
    moduleMembership
  });

  expect(model.files.map(({ path, surface }) => ({ path, surface }))).toEqual([
    { path: 'src/example.ts', surface: 'production' },
    { path: 'tests/example.test.ts', surface: 'test' }
  ]);
  expect(model.declarations.map(({ name, path }) => ({ name, path }))).toEqual([
    { name: 'productionValue', path: 'src/example.ts' },
    { name: 'mirroredTestValue', path: 'tests/example.test.ts' }
  ]);
});

test('TypeScript semantic references preserve aliases without treating shadowed or dynamic computed names as target references', () => {
  const moduleMembership = Object.freeze({
    descriptors: Object.freeze([]),
    graphRoots: Object.freeze([]),
    moduleRoots: Object.freeze([]),
    moduleForPath: () => null
  });
  const sources = [
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
    }
  ];
  const files = sources.map(({ path, source }) => Object.freeze({
    path,
    source,
    contentDigest: rawSha256(source)
  }));
  const model = compileTypeScriptSourceProgramModel({
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files,
    moduleMembership
  });
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
});
