import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import {
  compileRepositoryModuleGraph,
  compileTypeScriptModel,
  releaseTypeScriptWorkspace,
  typeScriptCompilerIdentity
} from './typescript.ts';
import {
  TYPESCRIPT_SOURCE_PROGRAM_PROVIDER,
  TYPESCRIPT_WORKSPACE_COMPILER_OPTIONS,
  TYPESCRIPT_WORKSPACE_DEPENDENCY_GENERATION_DIGEST
} from './typescript-profile.ts';
import {
  assembleTypeScriptModel,
  compileTypeScriptSourceProgramFactShard,
  SOURCE_PROGRAM_TYPESCRIPT_FACT_SHARD_SCHEMA_DIGEST
} from './typescript-fact-shards.ts';

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
      const model = compileTypeScriptModel({ sourceRevision: rawSha256(source), files, moduleMembership });
      const graph = compileRepositoryModuleGraph({ files: files.map(({ path }) => path),
        readSource: (path) => files.find((file) => file.path === path)?.source ?? null });
      const references = model.references.filter((reference) => reference.kind === 'import'
        && reference.targetPath === 'src/b.ts');
      assert.equal(references.length, hasDependency ? 1 : 0);
      for (const reference of references) assert.equal(reference.moduleSpecifier, './b.ts');
      assert.deepEqual(graph.directRuntimeDependencies('src/a.ts'), hasDependency ? ['src/b.ts'] : []);
      assert.equal(model.unknowns.some(({ code }) => code === 'dynamic-module-unresolved'), unresolved);
      assert.deepEqual(graph.unresolvedFiles, unresolved ? ['src/a.ts'] : []);
    } finally {
      releaseTypeScriptWorkspace();
    }
  });
}

test('prior name-only interpretation cannot reuse persisted shards as the new semantic generation', () => {
  const oldCompilerRevision = sha256({
    compilerConfigDigest: sha256(TYPESCRIPT_WORKSPACE_COMPILER_OPTIONS),
    dependencyGenerationDigest: TYPESCRIPT_WORKSPACE_DEPENDENCY_GENERATION_DIGEST,
    factShardSchemaDigest: SOURCE_PROGRAM_TYPESCRIPT_FACT_SHARD_SCHEMA_DIGEST,
    provider: TYPESCRIPT_SOURCE_PROGRAM_PROVIDER,
    semanticOwner: 'src/adapters/repository/source-program-model/typescript.ts'
  });
  const identity = typeScriptCompilerIdentity();
  assert.notEqual(identity.compilerRevision, oldCompilerRevision);
  const shard = compileTypeScriptSourceProgramFactShard({
    compilerRevision: oldCompilerRevision, providerRevision: identity.providerRevision,
    rawFileDigest: rawSha256('export {};'), moduleDigest: sha256(null), semanticDependencyScope: 'module-scoped',
    facts: {
      path: 'src/a.ts', file: { path: 'src/a.ts', contentDigest: rawSha256('export {};'), moduleId: null,
        surface: 'production', semanticKind: 'executable', semanticObservationClass: 'derived' },
      declarations: [], references: [], returnProvenances: [], literals: [], entrypoints: [], capabilities: [], unknowns: []
    }
  });
  assert.throws(() => assembleTypeScriptModel({ sourceRevision: rawSha256('export {};'),
    compilerRevision: identity.compilerRevision, provider: identity.provider, shards: [shard] }), /incompatible fact shards/);
});
