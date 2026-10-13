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
