import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { compileSourceProgramRepositoryModuleGraph } from './source-program-module-graph.ts';
import {
  assembleTypeScriptSourceProgramModel,
  compileTypeScriptSourceProgramFactShard,
} from './typescript-fact-shards.ts';
import {
  compileTypeScriptSourceProgramModel,
  compileTypeScriptSourceProgramModelIncremental,
  releaseTypeScriptSourceProgramWorkspace,
  sourceProgramTypeScriptCompilerIdentity
} from './typescript.ts';

const moduleMembership = Object.freeze({
  descriptors: Object.freeze([]), graphRoots: Object.freeze([]),
  moduleRoots: Object.freeze([]), moduleForPath: () => null
});
const cases = [
  ['ordinary same-named function', 'function require() {} require();', false, false],
  ['ordinary same-named parameter', "function run(require: () => void) { require(); }", false, false],
  ['ordinary same-named binding', "const require = () => 1; require('./b.ts');", false, false],
  ['literal require', "require('./b.ts');", true, false],
  ['immutable require alias', "const load = require; load('./b.ts');", true, false],
  ['immutable alias chain', "const first = require; const load = first; load('./b.ts');", true, false],
  ['computed alias', 'const load = require; load(target);', false, true],
  ['mutable alias', "let load = require; load('./b.ts');", false, true],
  ['module require', "module.require('./b.ts');", true, false],
  ['ordinary module member', "const module = {require: () => 1}; module.require('./b.ts');", false, false],
  ['unwrapped dynamic operand', "void import(('./b.ts' as const));", true, false],
  ['dynamic missing operand', 'void import();', false, true],
  ['conditional alias', "const load = flag ? require : ordinary; load('./b.ts');", false, true],
  ['factory has a different root', "import {createRequire} from 'node:module'; const load = createRequire('/other/tree.js'); load('./b.ts');", false, true],
  ['namespace factory has unresolved root', "import * as mod from 'node:module'; const load = mod.createRequire(import.meta.url); load('./b.ts');", false, true],
  ['indirect invocation', "require.call(null, './b.ts');", false, true]
] as const;

for (const [name, source, hasDependency, unresolved] of cases) {
  test(`graph and semantic facts share loader identity: ${name}`, () => {
    try {
      const files = [
        { path: 'src/a.ts', source, contentDigest: rawSha256(source) },
        { path: 'src/b.ts', source: 'export const value = 1;', contentDigest: rawSha256('export const value = 1;') }
      ];
      const model = compileTypeScriptSourceProgramModel({ sourceRevision: rawSha256(source), files, moduleMembership });
      const graph = compileSourceProgramRepositoryModuleGraph({ files: files.map(({ path }) => path),
        readSource: (path) => files.find((file) => file.path === path)?.source ?? null });
      const references = model.references.filter((reference) => reference.kind === 'import'
        && reference.targetPath === 'src/b.ts');
      assert.equal(references.length, hasDependency ? 1 : 0);
      for (const reference of references) assert.equal(reference.moduleSpecifier, './b.ts');
      assert.deepEqual(graph.directRuntimeDependencies('src/a.ts'), hasDependency ? ['src/b.ts'] : []);
      assert.equal(model.unknowns.some(({ code }) => code === 'dynamic-module-unresolved'), unresolved);
      assert.deepEqual(graph.unresolvedFiles, unresolved ? ['src/a.ts'] : []);
    } finally {
      releaseTypeScriptSourceProgramWorkspace();
    }
  });
}

test('fact shards from an independent foreign compiler revision cannot join the current generation', () => {
  const foreignCompilerRevision = sha256({ fixture: 'independent-foreign-compiler-revision' });
  const identity = sourceProgramTypeScriptCompilerIdentity();
  assert.notEqual(identity.compilerRevision, foreignCompilerRevision);
  const shard = compileTypeScriptSourceProgramFactShard({
    compilerRevision: foreignCompilerRevision, providerRevision: identity.providerRevision,
    rawFileDigest: rawSha256('export {};'), moduleDigest: sha256(null), semanticDependencyScope: 'module-scoped',
    facts: {
      path: 'src/a.ts', file: { path: 'src/a.ts', contentDigest: rawSha256('export {};'), moduleId: null,
        surface: 'production', semanticKind: 'executable', semanticObservationClass: 'derived' },
      declarations: [], references: [], returnProvenances: [], literals: [], entrypoints: [], capabilities: [], unknowns: []
    }
  });
  assert.throws(() => assembleTypeScriptSourceProgramModel({ sourceRevision: rawSha256('export {};'),
    compilerRevision: identity.compilerRevision, provider: identity.provider, shards: [shard] }), /incompatible fact shards/);
});

function packageInput(target: 'one' | 'two', extraLoad = '') {
  const sources: Readonly<Record<string, string>> = {
    'package.json': JSON.stringify({ type: 'module', imports: { '#entry': `./src/${target}.ts` } }),
    'src/main.ts': `export { value } from '#entry'; void import('#entry'); ${extraLoad}`,
    'src/one.ts': 'export const value = 1;',
    'src/two.ts': 'export const value = 2;'
  };
  const files = Object.entries(sources).map(([path, source]) => ({ path, source, contentDigest: rawSha256(source) }));
  return { files, moduleMembership, sourceRevision: sha256(files) };
}

test('graph and semantic lowering share the compiler-selected package import and retain its lookup inputs', () => {
  try {
    const input = packageInput('one');
    const model = compileTypeScriptSourceProgramModel(input);
    const sources = new Map(input.files.map((file) => [file.path, file.source]));
    const graph = compileSourceProgramRepositoryModuleGraph({
      files: [...sources.keys()], readSource: (path) => sources.get(path) ?? null
    });
    const imports = graph.references.filter((reference) => reference.from === 'src/main.ts');
    assert.equal(imports.length, 2);
    for (const reference of imports) {
      assert.equal(reference.resolvedTarget, 'src/one.ts');
      assert.ok(reference.candidateTargets.includes('package.json'));
      assert.ok(reference.candidateTargets.includes('src/package.json'));
    }
    assert.deepEqual(graph.directConsumers('src/package.json'), ['src/main.ts']);
    assert.ok(graph.directDependencies('src/main.ts').includes('package.json'));
    assert.ok(graph.directRuntimeDependencies('src/main.ts').includes('src/one.ts'));
    assert.deepEqual(graph.unresolvedFiles, []);
    assert.ok(model.references.some((reference) => reference.moduleSpecifier === '#entry'
      && reference.targetPath === 'src/one.ts'));
    assert.equal(model.unknowns.some((unknown) => unknown.code === 'external-module-opaque'
      && unknown.detail === '#entry'), false);
  } finally {
    releaseTypeScriptSourceProgramWorkspace();
  }
});

test('a resolved package occurrence does not erase another computed load in the same module', () => {
  try {
    const input = packageInput('one', 'void import(dynamicTarget);');
    const model = compileTypeScriptSourceProgramModel(input);
    const sources = new Map(input.files.map((file) => [file.path, file.source]));
    const graph = compileSourceProgramRepositoryModuleGraph({
      files: [...sources.keys()], readSource: (path) => sources.get(path) ?? null
    });
    assert.ok(graph.references.some((reference) => reference.from === 'src/main.ts'
      && reference.resolvedTarget === 'src/one.ts'));
    assert.deepEqual(graph.unresolvedFiles, ['src/main.ts']);
    assert.ok(model.unknowns.some((unknown) => unknown.path === 'src/main.ts'
      && unknown.code === 'dynamic-module-unresolved'));
  } finally {
    releaseTypeScriptSourceProgramWorkspace();
  }
});

test('package metadata changes invalidate semantic shards even when every TypeScript byte is unchanged', () => {
  try {
    const first = compileTypeScriptSourceProgramModelIncremental(packageInput('one'), null);
    const second = compileTypeScriptSourceProgramModelIncremental(packageInput('two'), first.state);
    assert.equal(second.mode, 'full');
    assert.notEqual(second.state.resolutionMetadataDigest, first.state.resolutionMetadataDigest);
    const targets = second.model.references.filter((reference) => reference.moduleSpecifier === '#entry')
      .map((reference) => reference.targetPath);
    assert.ok(targets.length > 0);
    assert.ok(targets.every((target) => target === 'src/two.ts'));
    assert.ok(first.model.references.some((reference) => reference.moduleSpecifier === '#entry'
      && reference.targetPath === 'src/one.ts'));
  } finally {
    releaseTypeScriptSourceProgramWorkspace();
  }
});

for (const [name, specifier, imports] of [
  ['extension substitution', './one.js', {}],
  ['conditional package target', '#entry', {
    '#entry': { types: './src/one.ts', bun: './src/two.ts', default: './src/two.ts' }
  }]
] as const) {
  test(`compiler resolution keeps unproved runtime selection visible: ${name}`, () => {
    try {
      const base = packageInput('one');
      const files = base.files.map((file) => {
        const source = file.path === 'package.json' ? JSON.stringify({ type: 'module', imports })
          : file.path === 'src/main.ts'
            ? `export { value } from '${specifier}'; void import('${specifier}');` : file.source;
        return { ...file, source, contentDigest: rawSha256(source) };
      });
      const model = compileTypeScriptSourceProgramModel({ ...base, files, sourceRevision: sha256(files) });
      const sources = new Map(files.map((file) => [file.path, file.source]));
      const graph = compileSourceProgramRepositoryModuleGraph({
        files: [...sources.keys()], readSource: (path) => sources.get(path) ?? null
      });
      const references = graph.references.filter((reference) => reference.from === 'src/main.ts');
      assert.equal(references.length, 2);
      assert.ok(references.every((reference) => reference.resolvedTarget === 'src/one.ts'));
      assert.ok(references.every((reference) => reference.runtime.kind === 'unresolved'));
      assert.ok(references.every((reference) => reference.candidateTargets.includes('src/one.ts')));
      assert.deepEqual(graph.unresolvedFiles, ['src/main.ts']);
      assert.ok(model.unknowns.some((unknown) => unknown.code === 'module-resolution-unresolved'));
      assert.ok(model.unknowns.some((unknown) => unknown.code === 'dynamic-module-unresolved'));
      // The compiler's symbolic target remains useful; it cannot close runtime loading.
      assert.ok(model.references.some((reference) => reference.kind === 'reexport'
        && reference.targetPath === 'src/one.ts'));
    } finally {
      releaseTypeScriptSourceProgramWorkspace();
    }
  });
}

test('type-only imports preserve compiler targets without requiring a runtime address', () => {
  try {
    const sources = new Map([
      ['src/main.ts', "import type { Value } from './one.js'; export type Local = Value;"],
      ['src/one.ts', 'export type Value = string;']
    ]);
    const files = [...sources].map(([path, source]) => ({ path, source, contentDigest: rawSha256(source) }));
    const model = compileTypeScriptSourceProgramModel({ files, moduleMembership, sourceRevision: sha256(files) });
    const graph = compileSourceProgramRepositoryModuleGraph({
      files: [...sources.keys()], readSource: (path) => sources.get(path) ?? null
    });
    assert.equal(graph.references[0]?.resolvedTarget, 'src/one.ts');
    assert.deepEqual(graph.directRuntimeDependencies('src/main.ts'), []);
    assert.deepEqual(graph.unresolvedFiles, []);
    assert.equal(model.unknowns.some((unknown) => unknown.code === 'module-resolution-unresolved'), false);
  } finally {
    releaseTypeScriptSourceProgramWorkspace();
  }
});
