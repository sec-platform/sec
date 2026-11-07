import { test, expect } from 'bun:test';
import assert from 'node:assert/strict';
import { canonicalJson, rawSha256, sha256 } from '../../../contracts/canonical.ts';
import {
  assembleTypeScriptSourceProgramModel,
  compileTypeScriptSourceProgramFactShard,
  encodeTypeScriptSourceProgramFactShard,
  parseTypeScriptSourceProgramFactShard
} from './typescript-fact-shards.ts';
import {
  compileTypeScriptSourceProgramModelIncremental,
  releaseTypeScriptSourceProgramWorkspace
} from './typescript.ts';
import { sourceInput } from './test/typescript-model-input.ts';

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

for (const mode of ['issued', 'foreign', 'shallow-frozen'] as const) {
  test(`model assembly owns ${mode} shard contents and the provider descriptor`, () => {
    const issued = compileTypeScriptSourceProgramFactShard(fixture());
    const shard = mode === 'issued' ? issued : structuredClone(issued);
    if (mode === 'shallow-frozen') Object.freeze(shard);
    const mutableProvider = { ...provider };
    const model = assembleTypeScriptSourceProgramModel({ sourceRevision: 'snapshot', compilerRevision: digest,
      provider: mutableProvider, shards: [shard] });
    if (mode === 'issued') {
      // Captured from the actual prior production implementation at tree
      // d167cbd5973c69ff57d10cfa4e10b47bde4c12ec, not recomputed by the SUT oracle.
      assert.equal(shard.shardDigest, 'sha256:343091b3e98e4d1a5986ce608ed6e33a2648a08ddb26f0d12ea246208a2711e6');
      assert.equal(model.modelDigest, 'sha256:fa3125014898671b230b6cd928cff32ae800c7c9e0dc284c42ae07f20e66c16c');
    }
    const before = canonicalBytes(model);
    assertDeeplyFrozen(model);
    mutableProvider.id = 'foreign-identity';
    assert.equal(Reflect.set(shard.file, 'path', 'src/replacement.ts'), mode !== 'issued');
    assert.equal(canonicalBytes(model), before);
    if (mode === 'issued') {
      const expectedFacts = fixture().facts;
      assert.deepEqual(model.files, [expectedFacts.file]);
      assert.deepEqual(model.references, expectedFacts.references);
    }
  });
}

test('foreign shard objects and persisted bytes cannot stand in for a canonical content readback', () => {
  const issued = compileTypeScriptSourceProgramFactShard(fixture());
  const canonical = canonicalBytes(issued);
  for (const source of [
    canonical.replace('{', '{"path":"foreign.ts",'),
    `${canonical}\n{}`,
    canonical.replace('{', '{"foreign":true,')
  ]) {
    assert.throws(() => parseTypeScriptSourceProgramFactShard(new TextEncoder().encode(source)));
  }
  const changed = JSON.parse(canonical) as Record<string, unknown>;
  changed.rawFileDigest = sha256('foreign');
  assert.throws(() => parseTypeScriptSourceProgramFactShard(new TextEncoder().encode(
    canonicalBytes(changed)
  )), /digest-bound/);
  for (const mutation of [
    (value: typeof issued) => Reflect.set(value.file, 'path', 'src/not-in-shard.ts'),
    (value: typeof issued) => Reflect.set(value.declarations[0]!, 'name', 'forged'),
    (value: typeof issued) => Reflect.set(value.returnProvenances[0]!.normalReturns, '0', { kind: 'opaque' }),
    (value: typeof issued) => Reflect.set(value, 'extra', true)
  ]) {
    const foreign = structuredClone(issued);
    mutation(foreign);
    Object.freeze(foreign);
    assert.throws(() => assembleTypeScriptSourceProgramModel({ sourceRevision: 'snapshot', compilerRevision: digest,
      provider, shards: [foreign] }));
  }
});

test('empty observed literals remain canonical facts without weakening structural rejection', () => {
  try {
    const input = sourceInput({
      'src/example/empty.ts': "export const EMPTY = '';\n"
    });
    const compiled = compileTypeScriptSourceProgramModelIncremental(input, null);
    const shard = compiled.state.factShards[0]!;
    const bytes = encodeTypeScriptSourceProgramFactShard(shard);
    const parsed = parseTypeScriptSourceProgramFactShard(bytes);

    expect(parsed).toEqual(shard);
    expect(parsed.literals.some(({ value }) => value === '')).toBe(true);

    const nonString = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    (nonString.literals as Record<string, unknown>[])[0]!.value = 0;
    expect(() => parseTypeScriptSourceProgramFactShard(new TextEncoder().encode(
      JSON.stringify(canonicalJson(nonString))
    ))).toThrow('must be text');

    const missing = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    delete (missing.literals as Record<string, unknown>[])[0]!.value;
    expect(() => parseTypeScriptSourceProgramFactShard(new TextEncoder().encode(
      JSON.stringify(canonicalJson(missing))
    ))).toThrow('noncanonical keys');

  } finally {
    releaseTypeScriptSourceProgramWorkspace();
  }
});
