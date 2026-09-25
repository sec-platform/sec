import { expect, test } from 'bun:test';

import { canonicalJson, rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { compileRepositoryModuleMembershipSnapshot } from '../architecture/contract.ts';
import { compileRepositoryModelFromSnapshot } from './repository.ts';
import {
  compileTypeScriptSourceProgramFactShard,
  encodeTypeScriptSourceProgramFactShard,
  parseTypeScriptSourceProgramFactShard,
  SOURCE_PROGRAM_TYPESCRIPT_FACT_SHARD_SCHEMA_DIGEST
} from './typescript-fact-shards.ts';
import {
  adoptTypeScriptFactShards,
  compileTypeScriptModel,
  compileTypeScriptModelIncremental,
  compileTypeScriptModelIncrementalWithCompilation,
  observeTypeScriptPerformanceForTests,
  releaseTypeScriptWorkspace,
  currentExactReturnProvenances
} from './typescript.ts';
import { compileVirtualSnapshot } from './workspace-source-snapshot.ts';

const moduleMembership = Object.freeze({
  descriptors: Object.freeze([]),
  graphRoots: Object.freeze([]),
  moduleRoots: Object.freeze([]),
  moduleForPath: () => null
});

function sourceInput(sources: Readonly<Record<string, string>>) {
  const files = Object.entries(sources)
    .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
    .map(([path, source]) => Object.freeze({ path, source, contentDigest: rawSha256(source) }));
  return Object.freeze({
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files,
    moduleMembership
  });
}

test('TypeScript fact shards reuse unchanged semantic facts and remain clean-compile equivalent', () => {
  const initialInput = sourceInput({
    'src/example/contract.ts': 'export const VALUE = 1;\n',
    'src/example/consumer.ts': "import { VALUE } from './contract.ts';\nexport const RESULT = VALUE;\n",
    'src/example/leaf.ts': 'export const LEAF = 1;\n'
  });
  const initial = compileTypeScriptModelIncremental(initialInput, null);
  const changedInput = sourceInput({
    'src/example/contract.ts': 'export const VALUE = 2;\n',
    'src/example/consumer.ts': "import { VALUE } from './contract.ts';\nexport const RESULT = VALUE;\n",
    'src/example/leaf.ts': 'export const LEAF = 1;\n'
  });
  const changed = compileTypeScriptModelIncremental(changedInput, initial.state);
  const initialByPath = new Map(initial.state.factShards.map((shard) => [shard.path, shard] as const));
  const changedByPath = new Map(changed.state.factShards.map((shard) => [shard.path, shard] as const));

  expect(changed.mode).toBe('incremental');
  expect(changed.model).toEqual(compileTypeScriptModel(changedInput));
  expect(changedByPath.get('src/example/leaf.ts')).toBe(initialByPath.get('src/example/leaf.ts'));
  expect(changedByPath.get('src/example/contract.ts')).not.toBe(initialByPath.get('src/example/contract.ts'));
  expect(changed.state.factShards.every(({ schemaDigest }) =>
    schemaDigest === SOURCE_PROGRAM_TYPESCRIPT_FACT_SHARD_SCHEMA_DIGEST)).toBe(true);
  expect(changed.model.modelDigest).not.toBe(initial.model.modelDigest);
  const nextRevision = compileTypeScriptModelIncremental(Object.freeze({
    ...changedInput,
    sourceRevision: sha256({ parent: changedInput.sourceRevision, unrelatedRepositoryChange: true })
  }), changed.state);
  expect(nextRevision.mode).toBe('exact');
  expect(nextRevision.state.factShards.every((shard, index) =>
    shard === changed.state.factShards[index])).toBe(true);
  expect(nextRevision.model.modelDigest).not.toBe(changed.model.modelDigest);
  releaseTypeScriptWorkspace();
});

test('test-surface declaration and Effect provenance remains incremental-clean equivalent', () => {
  const initialInput = sourceInput({
    'src/example/operation.ts': "import { readFile } from 'node:fs/promises';\nexport async function effect() { await readFile('a'); }\n",
    'tests/effect.test.ts': "import { effect } from '../src/example/operation.ts';\nexport const run = async () => { await effect(); };\n",
    'tests/pure.test.ts': 'export const pure = () => 1;\n'
  });
  const initial = compileTypeScriptModelIncremental(initialInput, null);
  const changedInput = sourceInput({
    'src/example/operation.ts': "import { readFile } from 'node:fs/promises';\nexport async function effect() { await readFile('a'); }\n",
    'tests/effect.test.ts': "import { effect as invoke } from '../src/example/operation.ts';\nexport const run = async () => { await invoke(); };\n",
    'tests/pure.test.ts': 'export const pure = () => 1;\n'
  });
  const changed = compileTypeScriptModelIncremental(changedInput, initial.state);
  const clean = compileTypeScriptModel(changedInput);
  const effectCapability = changed.model.capabilities.find(({ path }) => (
    path === 'src/example/operation.ts'
  ));
  const testCall = changed.model.references.find(({ path, kind }) => (
    path === 'tests/effect.test.ts' && kind === 'call'
  ));

  expect(changed.mode).toBe('incremental');
  expect(changed.model).toEqual(clean);
  expect(testCall?.sourceObservationId).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(testCall?.targetObservationId).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(effectCapability?.owningDeclarationObservationId).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(changed.state.factShards.find(({ path }) => path === 'tests/pure.test.ts'))
    .toBe(initial.state.factShards.find(({ path }) => path === 'tests/pure.test.ts'));
  releaseTypeScriptWorkspace();
});

test('return provenance remains canonical across shard serialization and incremental reassembly', () => {
  const initialInput = sourceInput({
    'src/example/parser.ts': 'export function parseValue(source: string) { return JSON.parse(source); }\n',
    'src/example/helper.ts': [
      "import { parseValue } from './parser.ts';",
      'export function ownerHelper(source: string) { return parseValue(source); }'
    ].join('\n'),
    'src/example/index.ts': "export { ownerHelper } from './helper.ts';\n",
    'src/example/reader.ts': [
      "import { ownerHelper } from './index.ts';",
      'export function readValue(source: string) { const value = ownerHelper(source); return value; }'
    ].join('\n'),
    'src/example/unrelated.ts': 'export const UNRELATED = 1;\n'
  });
  const initial = compileTypeScriptModelIncremental(initialInput, null);
  const readerShard = initial.state.factShards.find(({ path }) => path === 'src/example/reader.ts')!;
  const parsedReaderShard = parseTypeScriptSourceProgramFactShard(
    encodeTypeScriptSourceProgramFactShard(readerShard)
  );
  expect(parsedReaderShard.returnProvenances).toEqual(readerShard.returnProvenances);
  expect(readerShard.returnProvenances).toHaveLength(1);
  expect(readerShard.returnProvenances.every(({ normalReturns }) => (
    normalReturns.length === 1 && normalReturns[0]?.kind === 'call-result'
  ))).toBe(true);
  const forged = JSON.parse(new TextDecoder().decode(
    encodeTypeScriptSourceProgramFactShard(readerShard)
  )) as Record<string, unknown>;
  (forged.returnProvenances as Record<string, unknown>[])[0]!.declarationObservationId =
    sha256('forged-declaration');
  expect(() => parseTypeScriptSourceProgramFactShard(new TextEncoder().encode(
    JSON.stringify(canonicalJson(forged))
  ))).toThrow('return provenance is not bound to one shard declaration');

  const changedInput = sourceInput({
    'src/example/parser.ts': 'export function parseValue(source: string) { return JSON.parse(source); }\n',
    'src/example/helper.ts': [
      "import { parseValue } from './parser.ts';",
      'export function ownerHelper(source: string) { const parsed = parseValue(source); return parsed; }'
    ].join('\n'),
    'src/example/index.ts': "export { ownerHelper } from './helper.ts';\n",
    'src/example/reader.ts': [
      "import { ownerHelper } from './index.ts';",
      'export function readValue(source: string) { const value = ownerHelper(source); return value; }'
    ].join('\n'),
    'src/example/unrelated.ts': 'export const UNRELATED = 1;\n'
  });
  const changed = compileTypeScriptModelIncremental(changedInput, initial.state);
  const changedReaderShard = changed.state.factShards.find(
    ({ path }) => path === 'src/example/reader.ts'
  );
  expect(changed.mode).toBe('incremental');
  const clean = compileTypeScriptModel(changedInput);
  expect(changedReaderShard).not.toBe(readerShard);
  expect(changed.model.returnProvenances).toEqual(clean.returnProvenances);
  expect(currentExactReturnProvenances(changed.model)).toEqual(
    currentExactReturnProvenances(clean)
  );
  releaseTypeScriptWorkspace();
});

test('self-consistent forged return hints cannot replace current exact Program provenance', () => {
  const sources = {
    'src/example/parser.ts': [
      'export interface Value { readonly status: string; }',
      'export function parseValue(source: string): Value { return JSON.parse(source) as Value; }'
    ].join('\n'),
    'src/example/reader.ts': [
      "import { parseValue, type Value } from './parser.ts';",
      'export function readValue(source: string): Value { parseValue(source); return source as unknown as Value; }'
    ].join('\n')
  };
  const descriptorPath = 'src/example/module.json';
  const descriptorSource = JSON.stringify({
    importGraph: 'runtime',
    externalEntrypoints: [],
    causalRelations: [{
      subject: 'example.value',
      relation: 'declares',
      symbol: { path: 'src/example/parser.ts', name: 'Value' },
      operation: null
    }, {
      subject: 'example.value',
      relation: 'parses',
      symbol: { path: 'src/example/parser.ts', name: 'parseValue' },
      operation: null
    }, {
      subject: 'example.value',
      relation: 'reads-back',
      symbol: { path: 'src/example/reader.ts', name: 'readValue' },
      operation: null
    }]
  });
  const causalMembership = compileRepositoryModuleMembershipSnapshot({
    repositoryFiles: [...Object.keys(sources), descriptorPath],
    descriptorSources: [{ descriptorPath, source: descriptorSource }]
  });
  const files = Object.entries(sources).map(([path, source]) => Object.freeze({
    path,
    source,
    contentDigest: rawSha256(source)
  }));
  const rawInput = Object.freeze({
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files,
    moduleMembership: causalMembership
  });
  const snapshot = compileVirtualSnapshot({
    subject: Object.freeze({
      kind: 'virtual-mutation' as const,
      provenance: Object.freeze({
        kind: 'source-program-virtual-mutation' as const,
        baseSnapshotDigest: sha256('return-provenance-base') as `sha256:${string}`,
        mutationDigest: sha256('return-provenance-forgery') as `sha256:${string}`
      })
    }),
    files: rawInput.files,
    moduleMembership: causalMembership
  });
  const input = Object.freeze({ ...rawInput, sourceRevision: snapshot.sourceRevision });
  const clean = compileTypeScriptModelIncrementalWithCompilation(
    input,
    null,
    snapshot
  );
  const parser = clean.model.declarations.find(({ name }) => name === 'parseValue')!;
  const reader = clean.model.declarations.find(({ name }) => name === 'readValue')!;
  const forgedShards = clean.state.factShards.map((shard) => {
    if (shard.path !== reader.path) return shard;
    return compileTypeScriptSourceProgramFactShard({
      compilerRevision: shard.compilerRevision,
      providerRevision: shard.providerRevision,
      rawFileDigest: shard.rawFileDigest,
      moduleDigest: shard.moduleDigest,
      semanticDependencyScope: shard.semanticDependencyScope,
      facts: Object.freeze({
        path: shard.path,
        file: shard.file,
        declarations: shard.declarations,
        references: shard.references,
        returnProvenances: Object.freeze([Object.freeze({
          path: reader.path,
          declarationObservationId: reader.observationId,
          normalReturns: Object.freeze([Object.freeze({
            kind: 'call-result' as const,
            targetObservationId: parser.observationId,
            arguments: Object.freeze([Object.freeze([
              Object.freeze({ kind: 'parameter' as const, index: 0 })
            ])])
          })])
        })]),
        literals: shard.literals,
        entrypoints: shard.entrypoints,
        capabilities: shard.capabilities,
        unknowns: shard.unknowns
      })
    });
  });
  const adopted = adoptTypeScriptFactShards(
    input,
    forgedShards,
    snapshot
  );
  const exact = compileTypeScriptModelIncrementalWithCompilation(
    input,
    adopted,
    snapshot
  );
  const persistedHint = exact.model.returnProvenances.find(
    ({ declarationObservationId }) => declarationObservationId === reader.observationId
  );
  const currentExact = currentExactReturnProvenances(exact.model)?.find(
    ({ declarationObservationId }) => declarationObservationId === reader.observationId
  );

  expect(exact.mode).toBe('exact');
  expect(persistedHint?.normalReturns[0]?.kind).toBe('call-result');
  expect(currentExact?.normalReturns).toEqual([Object.freeze({ kind: 'opaque' })]);
  expect(currentExact).not.toEqual(persistedHint);
  const repositoryModel = compileRepositoryModelFromSnapshot({
    sourceRevision: input.sourceRevision,
    files: input.files,
    moduleMembership: causalMembership,
    typescriptModel: exact.model
  }, snapshot);
  expect(repositoryModel.candidates).toContainEqual(expect.objectContaining({
    code: 'causal-relation-owner-bypass',
    subject: 'example.value:parser/readback'
  }));
  releaseTypeScriptWorkspace();
});

test('ambient declarations, global augmentations, file-set changes, and resolver graph changes force a clean compilation', () => {
  const assertFullEquivalent = (
    initialSources: Readonly<Record<string, string>>,
    changedSources: Readonly<Record<string, string>>
  ): void => {
    const initial = compileTypeScriptModelIncremental(sourceInput(initialSources), null);
    const changedInput = sourceInput(changedSources);
    const changed = compileTypeScriptModelIncremental(changedInput, initial.state);

    expect(changed.mode).toBe('full');
    expect(changed.model).toEqual(compileTypeScriptModel(changedInput));
  };

  assertFullEquivalent({
    'src/example/globals.d.ts': 'declare const GLOBAL_VALUE: 1;\n',
    'src/example/use.ts': 'export const VALUE = GLOBAL_VALUE;\n'
  }, {
    'src/example/globals.d.ts': 'declare const GLOBAL_VALUE: 2;\n',
    'src/example/use.ts': 'export const VALUE = GLOBAL_VALUE;\n'
  });
  assertFullEquivalent({
    'src/example/augment.ts': "export {};\ndeclare global { interface Window { value: 1 } }\n",
    'src/example/use.ts': 'export const VALUE = window.value;\n'
  }, {
    'src/example/augment.ts': "export {};\ndeclare global { interface Window { value: 2 } }\n",
    'src/example/use.ts': 'export const VALUE = window.value;\n'
  });
  assertFullEquivalent({
    'src/example/value.ts': 'export const VALUE = 1;\n'
  }, {
    'src/example/value.ts': 'export const VALUE = 1;\n',
    'src/example/added.ts': 'export const ADDED = 1;\n'
  });
  assertFullEquivalent({
    'src/example/consumer.ts': "import { VALUE } from './first.ts';\nexport const RESULT = VALUE;\n",
    'src/example/first.ts': 'export const VALUE = 1;\n',
    'src/example/second.ts': 'export const VALUE = 2;\n'
  }, {
    'src/example/consumer.ts': "import { VALUE } from './second.ts';\nexport const RESULT = VALUE;\n",
    'src/example/first.ts': 'export const VALUE = 1;\n',
    'src/example/second.ts': 'export const VALUE = 2;\n'
  });
  releaseTypeScriptWorkspace();
});

test('TypeScript root digest binds raw bytes even when a caller reuses a declared content digest', () => {
  const initialInput = sourceInput({
    'src/example/value.ts': 'export const VALUE = 1;\n'
  });
  const initial = compileTypeScriptModelIncremental(initialInput, null);
  const staleDigestInput = Object.freeze({
    ...initialInput,
    sourceFileIdentities: new Map([['src/example/value.ts', Object.freeze({
      file: initialInput.files[0],
      moduleDigest: sha256(null),
      rawFileDigest: initial.state.fileDigests['src/example/value.ts']
    })]]),
    files: Object.freeze(initialInput.files.map((file) => Object.freeze({
      ...file,
      source: 'export const VALUE = 2;\n'
    })))
  });
  const before = observeTypeScriptPerformanceForTests();
  const changed = compileTypeScriptModelIncremental(staleDigestInput, initial.state);
  const after = observeTypeScriptPerformanceForTests();

  expect(after.rawSourceHashOperations - before.rawSourceHashOperations).toBe(1);
  expect(changed.state.factShards[0]?.rawFileDigest)
    .not.toBe(initial.state.factShards[0]?.rawFileDigest);
  expect(changed.model.modelDigest).not.toBe(initial.model.modelDigest);
  expect(changed.model).toEqual(compileTypeScriptModel(staleDigestInput));
  releaseTypeScriptWorkspace();
});

test('sealed fact shards remain the incremental authority after the TypeScript workspace is released', () => {
  const initialInput = sourceInput({
    'src/example/contract.ts': 'export const VALUE = 1;\n',
    'src/example/consumer.ts': "import { VALUE } from './contract.ts';\nexport const RESULT = VALUE;\n"
  });
  const initial = compileTypeScriptModelIncremental(initialInput, null);
  releaseTypeScriptWorkspace();
  const changedInput = sourceInput({
    'src/example/contract.ts': 'export const VALUE = 2;\n',
    'src/example/consumer.ts': "import { VALUE } from './contract.ts';\nexport const RESULT = VALUE;\n"
  });
  const changed = compileTypeScriptModelIncremental(changedInput, initial.state);

  expect(changed.mode).toBe('incremental');
  expect(changed.model).toEqual(compileTypeScriptModel(changedInput));
  releaseTypeScriptWorkspace();
});

test('non-production TypeScript files cannot poison the exact incremental identity', () => {
  const input = sourceInput({
    'src/example/value.ts': 'export const VALUE = 1;\n',
    'tests/example/value.test.ts': "import { expect, test } from 'bun:test';\ntest('value', () => expect(1).toBe(1));\n"
  });
  const initial = compileTypeScriptModelIncremental(input, null);
  const exact = compileTypeScriptModelIncremental(input, initial.state);

  expect(exact.mode).toBe('exact');
  expect(exact.invalidatedPaths).toEqual([]);
  expect(exact.model).toBe(initial.model);
  expect(exact.state).toBe(initial.state);
  expect(exact.state.factShards[0]).toBe(initial.state.factShards[0]);
  releaseTypeScriptWorkspace();
});

test('empty observed literals remain canonical facts without weakening structural rejection', () => {
  const input = sourceInput({
    'src/example/empty.ts': "export const EMPTY = '';\n"
  });
  const compiled = compileTypeScriptModelIncremental(input, null);
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

  releaseTypeScriptWorkspace();
});

test('workspace-signed incremental performance observation remains clean-compile equivalent', () => {
  const dependencies = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [
    `src/performance/dependency-${String(index).padStart(2, '0')}.ts`,
    `export const VALUE_${index} = ${index};\n`
  ]));
  const unrelated = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [
    `src/performance/unrelated-${String(index).padStart(2, '0')}.ts`,
    `export const UNRELATED_${index} = ${index};\n`
  ]));
  const rootSource = (revision: number): string => [
    ...Object.keys(dependencies).map((dependencyPath, index) => (
      `import { VALUE_${index} } from './${dependencyPath.split('/').at(-1)}';`
    )),
    `export const REVISION = ${revision};`
  ].join('\n');
  const snapshotFor = (revision: number) => {
    const raw = sourceInput({
      ...dependencies,
      ...unrelated,
      'src/performance/root.ts': rootSource(revision)
    });
    const snapshot = compileVirtualSnapshot({
      subject: Object.freeze({
        kind: 'virtual-mutation' as const,
        provenance: Object.freeze({
          kind: 'source-program-virtual-mutation' as const,
          baseSnapshotDigest: sha256('source-program-performance-base') as `sha256:${string}`,
          mutationDigest: sha256({ revision }) as `sha256:${string}`
        })
      }),
      files: raw.files,
      moduleMembership
    });
    return Object.freeze({ ...raw, sourceRevision: snapshot.sourceRevision, snapshot });
  };

  const initialInput = snapshotFor(1);
  const initial = compileTypeScriptModelIncrementalWithCompilation(
    initialInput,
    null,
    initialInput.snapshot
  );
  const changedInput = snapshotFor(2);
  const before = observeTypeScriptPerformanceForTests();
  const startedAt = performance.now();
  const changed = compileTypeScriptModelIncrementalWithCompilation(
    changedInput,
    initial.state,
    changedInput.snapshot
  );
  const durationMs = performance.now() - startedAt;
  const after = observeTypeScriptPerformanceForTests();
  const delta = Object.freeze(Object.fromEntries(Object.keys(after).map((key) => [
    key,
    after[key as keyof typeof after] - before[key as keyof typeof before]
  ])));

  console.log(`SEC_TYPESCRIPT_PERF=${JSON.stringify({ durationMs, ...delta })}`);
  expect(changed.mode).toBe('incremental');
  expect(changed.model).toEqual(compileTypeScriptModel(changedInput));
  expect(delta).toMatchObject({
    dependencyReferenceVisits: 0,
    rawSourceHashBytes: 0,
    rawSourceHashOperations: 0,
    semanticScopeParseOperations: 1
  });
  releaseTypeScriptWorkspace();
});
