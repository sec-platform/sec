import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { canonicalJson, rawSha256, sha256 } from '../../../contracts/canonical.ts';
import {
  assembleTypeScriptModel,
  compileTypeScriptSourceProgramFactShard,
  encodeTypeScriptSourceProgramFactShard,
  parseTypeScriptSourceProgramFactShard
} from './typescript-fact-shards.ts';

const provider = { id: 'fixture-frontend', revision: 'fixed' };
const digest = rawSha256('fixed input');
const declarationId = rawSha256('declaration');
function fixture(): Parameters<typeof compileTypeScriptSourceProgramFactShard>[0] {
  const path = 'src/example.ts';
  const span = { start: 0, end: 1, startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 };
  return {
    compilerRevision: digest, providerRevision: sha256(provider), rawFileDigest: digest,
    moduleDigest: sha256(null), semanticDependencyScope: 'module-scoped',
    facts: {
      path,
      file: { path, contentDigest: digest, moduleId: null, surface: 'production',
        semanticKind: 'executable', semanticObservationClass: 'derived' },
      declarations: [{ path, span, name: 'run', kind: 'FunctionDeclaration', moduleId: null,
        exported: true, observationId: declarationId, declarationDigest: digest }],
      references: [{ path, span, name: 'run', kind: 'call', moduleSpecifier: null,
        sourceObservationId: declarationId, sourceRelation: 'declaration',
        targetObservationId: declarationId, targetPath: path, observationClass: 'derived' }],
      returnProvenances: [{ path, declarationObservationId: declarationId, normalReturns: [
        { kind: 'call-result', targetObservationId: declarationId,
          arguments: [[{ kind: 'parameter', index: 0 }], [{ kind: 'literal' }]] }
      ] }],
      literals: [{ path, span, value: 'value', context: 'producer', contextSpan: span }],
      entrypoints: [{ path, span, observationId: digest, name: 'run', kind: 'module-entrypoint',
        command: null, targetEntrypoints: [], targetPaths: [path], targetPackages: [], observationClass: 'derived' }],
      capabilities: [{ path, span, observationId: digest, moduleId: null, moduleSpecifier: 'node:fs',
        surface: 'production', capability: 'filesystem', operation: 'readFile', subject: null,
        transport: 'runtime-built-in-api', providerCapability: null, providerModuleId: null,
        owningDeclarationObservationId: declarationId, observationClass: 'observed' }],
      unknowns: [{ path, span, code: 'computed-property-unresolved', detail: 'key' }]
    }
  };
}

function assertDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeeplyFrozen(child);
}
const canonicalBytes = (value: unknown) => JSON.stringify(canonicalJson(value));

for (const mode of ['producer', 'parser'] as const) {
  test(`${mode} owns every nested fact without changing its digest-bound bytes`, () => {
    const issued = compileTypeScriptSourceProgramFactShard(fixture());
    const shard = mode === 'producer' ? issued
      : parseTypeScriptSourceProgramFactShard(encodeTypeScriptSourceProgramFactShard(issued));
    const before = canonicalBytes(shard);
    assertDeeplyFrozen(shard);
    const objects = [shard.file, shard.declarations[0]!.span, shard.references[0]!,
      shard.returnProvenances[0]!.normalReturns, shard.literals[0]!.contextSpan!,
      shard.entrypoints[0]!.targetPaths, shard.capabilities[0]!.span, shard.unknowns[0]!];
    for (const object of objects) assert.equal(Reflect.set(object, 'injected', true), false);
    assert.equal(Reflect.set(shard.file, 'path', 'src/unbound.ts'), false);
    assert.equal(canonicalBytes(shard), before);
    assert.equal(canonicalBytes(parseTypeScriptSourceProgramFactShard(encodeTypeScriptSourceProgramFactShard(shard))), before);
  });
}

test('producer input aliases remain writable but cannot mutate an issued shard', () => {
  const input = fixture();
  const shard = compileTypeScriptSourceProgramFactShard(input);
  const before = canonicalBytes(shard);
  assert.equal(Reflect.set(input.facts.file, 'path', 'src/replacement.ts'), true);
  assert.equal(Reflect.set(input.facts.declarations[0]!.span, 'start', 50), true);
  assert.equal(Reflect.set(input.facts.entrypoints[0]!.targetPaths, '0', 'src/replacement.ts'), true);
  assert.equal(canonicalBytes(shard), before);
});

for (const mode of ['issued', 'foreign', 'shallow-frozen'] as const) {
  test(`model assembly owns ${mode} shard contents and the provider descriptor`, () => {
    const issued = compileTypeScriptSourceProgramFactShard(fixture());
    const shard = mode === 'issued' ? issued : structuredClone(issued);
    if (mode === 'shallow-frozen') Object.freeze(shard);
    const mutableProvider = { ...provider };
    const model = assembleTypeScriptModel({ sourceRevision: 'snapshot', compilerRevision: digest,
      provider: mutableProvider, shards: [shard] });
    const before = canonicalBytes(model);
    assertDeeplyFrozen(model);
    mutableProvider.id = 'foreign-identity';
    assert.equal(Reflect.set(shard.file, 'path', 'src/replacement.ts'), mode !== 'issued');
    assert.equal(canonicalBytes(model), before);
    if (mode === 'issued') {
      assert.equal(model.files[0], shard.file);
      assert.equal(model.references[0], shard.references[0]);
    } else assert.notEqual(model.files[0], shard.file);
  });
}

test('foreign shard digests cannot stand in for a content readback', () => {
  const issued = compileTypeScriptSourceProgramFactShard(fixture());
  for (const mutation of [
    (value: typeof issued) => Reflect.set(value.file, 'path', 'src/not-in-shard.ts'),
    (value: typeof issued) => Reflect.set(value.declarations[0]!, 'name', 'forged'),
    (value: typeof issued) => Reflect.set(value.returnProvenances[0]!.normalReturns, '0', { kind: 'opaque' }),
    (value: typeof issued) => Reflect.set(value, 'extra', true)
  ]) {
    const foreign = structuredClone(issued);
    mutation(foreign);
    Object.freeze(foreign);
    assert.throws(() => assembleTypeScriptModel({ sourceRevision: 'snapshot', compilerRevision: digest,
      provider, shards: [foreign] }));
  }
});

test('snapshot normalization does not admit object prototypes previously rejected by the codec', () => {
  const input = fixture();
  Object.setPrototypeOf(input.facts.file, { foreign: true });
  assert.throws(() => compileTypeScriptSourceProgramFactShard(input), /plain objects/);
  const shard = compileTypeScriptSourceProgramFactShard(fixture());
  const foreignProvider = Object.assign(Object.create({ foreign: true }), provider);
  assert.throws(() => assembleTypeScriptModel({ sourceRevision: 'snapshot', compilerRevision: digest,
    provider: foreignProvider, shards: [shard] }), /plain objects/);
});

test('producer validates and hashes the same captured facts instead of rereading input accessors', () => {
  const input = fixture();
  let reads = 0;
  Object.defineProperty(input.facts.file, 'path', { enumerable: true,
    get: () => ++reads === 1 ? input.facts.path : 'src/unbound.ts' });
  const shard = compileTypeScriptSourceProgramFactShard(input);
  assert.equal(reads, 1);
  assert.equal(shard.file.path, shard.path);
  assert.deepEqual(parseTypeScriptSourceProgramFactShard(encodeTypeScriptSourceProgramFactShard(shard)), shard);
});

test('immutable ownership preserves the previously issued canonical wire digests', () => {
  // Captured from the actual prior production implementation at tree
  // d167cbd5973c69ff57d10cfa4e10b47bde4c12ec, not recomputed by the SUT oracle.
  const shard = compileTypeScriptSourceProgramFactShard(fixture());
  assert.equal(shard.shardDigest, 'sha256:343091b3e98e4d1a5986ce608ed6e33a2648a08ddb26f0d12ea246208a2711e6');
  const model = assembleTypeScriptModel({ sourceRevision: 'snapshot', compilerRevision: digest, provider, shards: [shard] });
  assert.equal(model.modelDigest, 'sha256:fa3125014898671b230b6cd928cff32ae800c7c9e0dc284c42ae07f20e66c16c');
});
