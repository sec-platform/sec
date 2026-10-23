import { expect, test } from 'bun:test';
import { rawSha256, sha256, canonicalJson } from '../../../contracts/canonical.ts';
import {
  compileTypeScriptSourceProgramModel,
  compileTypeScriptSourceProgramModelIncremental,
  observeTypeScriptSourceProgramPerformanceForTests,
  adoptTypeScriptSourceProgramFactShardsFromWorkspaceSnapshot,
  compileTypeScriptSourceProgramModelIncrementalFromWorkspaceSnapshot,
  releaseTypeScriptSourceProgramWorkspace,
  sourceProgramCurrentExactReturnProvenances
} from './typescript.ts';
import { compileVirtualWorkspaceSourceSnapshot } from './workspace-source-snapshot.ts';
import {
  encodeTypeScriptSourceProgramFactShard,
  parseTypeScriptSourceProgramFactShard,
  SOURCE_PROGRAM_TYPESCRIPT_FACT_SHARD_SCHEMA_DIGEST
} from './typescript-fact-shards.ts';
import { moduleMembership, sourceInput } from './test/typescript-model-input.ts';

test('incremental source facts invalidate the reverse consumer closure and remain byte-equivalent to full compilation', () => {
  const moduleMembership = Object.freeze({
    descriptors: Object.freeze([]),
    graphRoots: Object.freeze([]),
    moduleRoots: Object.freeze([]),
    moduleForPath: () => null
  });
  const sourceInput = (sources: Readonly<Record<string, string>>) => {
    const files = Object.entries(sources)
      .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
      .map(([path, source]) => Object.freeze({ path, source, contentDigest: rawSha256(source) }));
    return Object.freeze({
      sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
      files,
      moduleMembership
    });
  };
  const initialInput = sourceInput({
    'src/example/contract.ts': 'export const VALUE = 1;\n',
    'src/example/consumer.ts': "import { VALUE } from './contract.ts';\nexport const RESULT = VALUE;\n",
    'src/example/leaf.ts': 'export const LEAF = 1;\n'
  });
  const initial = compileTypeScriptSourceProgramModelIncremental(initialInput, null);
  expect(initial.mode).toBe('full');

  const changedBytesWithStaleDeclaredDigest = Object.freeze({
    ...initialInput,
    files: Object.freeze(initialInput.files.map((file) => file.path === 'src/example/contract.ts'
      ? Object.freeze({ ...file, source: 'export const VALUE = 3;\n' })
      : file))
  });
  const changedBytes = compileTypeScriptSourceProgramModelIncremental(
    changedBytesWithStaleDeclaredDigest,
    initial.state
  );
  expect(changedBytes.mode).toBe('incremental');
  expect(changedBytes.invalidatedPaths).toEqual([
    'src/example/consumer.ts',
    'src/example/contract.ts'
  ]);
  expect(changedBytes.model).toEqual(
    compileTypeScriptSourceProgramModel(changedBytesWithStaleDeclaredDigest)
  );

  const exact = compileTypeScriptSourceProgramModelIncremental(initialInput, initial.state);
  expect(exact.mode).toBe('exact');
  expect(exact.invalidatedPaths).toEqual([]);
  expect(exact.model).toEqual(compileTypeScriptSourceProgramModel(initialInput));

  const foreignProviderState = Object.freeze({
    ...exact.state,
    providerRevision: sha256('foreign-typescript-workspace-generation')
  });
  const providerChanged = compileTypeScriptSourceProgramModelIncremental(
    initialInput,
    foreignProviderState
  );
  expect(providerChanged.mode).toBe('full');
  expect(providerChanged.invalidatedPaths).toEqual([
    'src/example/consumer.ts',
    'src/example/contract.ts',
    'src/example/leaf.ts'
  ]);
  expect(providerChanged.model).toEqual(compileTypeScriptSourceProgramModel(initialInput));

  const leafInput = sourceInput({
    'src/example/contract.ts': 'export const VALUE = 1;\n',
    'src/example/consumer.ts': "import { VALUE } from './contract.ts';\nexport const RESULT = VALUE;\n",
    'src/example/leaf.ts': 'export const LEAF = 2;\n'
  });
  const leaf = compileTypeScriptSourceProgramModelIncremental(leafInput, initial.state);
  expect(leaf.mode).toBe('incremental');
  expect(leaf.invalidatedPaths).toEqual(['src/example/leaf.ts']);
  expect(leaf.model).toEqual(compileTypeScriptSourceProgramModel(leafInput));

  const contractInput = sourceInput({
    'src/example/contract.ts': 'export const VALUE = 2;\n',
    'src/example/consumer.ts': "import { VALUE } from './contract.ts';\nexport const RESULT = VALUE;\n",
    'src/example/leaf.ts': 'export const LEAF = 2;\n'
  });
  const contract = compileTypeScriptSourceProgramModelIncremental(contractInput, leaf.state);
  expect(contract.mode).toBe('incremental');
  expect(contract.invalidatedPaths).toEqual([
    'src/example/consumer.ts',
    'src/example/contract.ts'
  ]);
  expect(contract.model).toEqual(compileTypeScriptSourceProgramModel(contractInput));
});

test('TypeScript fact shards reuse unchanged semantic facts and remain clean-compile equivalent', () => {
  try {
    const initialInput = sourceInput({
      'src/example/contract.ts': 'export const VALUE = 1;\n',
      'src/example/consumer.ts': "import { VALUE } from './contract.ts';\nexport const RESULT = VALUE;\n",
      'src/example/leaf.ts': 'export const LEAF = 1;\n'
    });
    const initial = compileTypeScriptSourceProgramModelIncremental(initialInput, null);
    const changedInput = sourceInput({
      'src/example/contract.ts': 'export const VALUE = 2;\n',
      'src/example/consumer.ts': "import { VALUE } from './contract.ts';\nexport const RESULT = VALUE;\n",
      'src/example/leaf.ts': 'export const LEAF = 1;\n'
    });
    const changed = compileTypeScriptSourceProgramModelIncremental(changedInput, initial.state);
    const initialByPath = new Map(initial.state.factShards.map((shard) => [shard.path, shard] as const));
    const changedByPath = new Map(changed.state.factShards.map((shard) => [shard.path, shard] as const));

    expect(changed.mode).toBe('incremental');
    expect(changed.model).toEqual(compileTypeScriptSourceProgramModel(changedInput));
    expect(changedByPath.get('src/example/leaf.ts')).toBe(initialByPath.get('src/example/leaf.ts'));
    expect(changedByPath.get('src/example/contract.ts')).not.toBe(initialByPath.get('src/example/contract.ts'));
    expect(changed.state.factShards.every(({ schemaDigest }) =>
      schemaDigest === SOURCE_PROGRAM_TYPESCRIPT_FACT_SHARD_SCHEMA_DIGEST)).toBe(true);
    expect(changed.model.modelDigest).not.toBe(initial.model.modelDigest);
    const nextRevision = compileTypeScriptSourceProgramModelIncremental(Object.freeze({
      ...changedInput,
      sourceRevision: sha256({ parent: changedInput.sourceRevision, unrelatedRepositoryChange: true })
    }), changed.state);
    expect(nextRevision.mode).toBe('exact');
    expect(nextRevision.state.factShards.every((shard, index) =>
      shard === changed.state.factShards[index])).toBe(true);
    expect(nextRevision.model.modelDigest).not.toBe(changed.model.modelDigest);
  } finally {
    releaseTypeScriptSourceProgramWorkspace();
  }
});

test('test-surface facts retain exact reuse and incremental-clean declaration and Effect provenance', () => {
  try {
    const initialInput = sourceInput({
      'src/example/operation.ts': "import { readFile } from 'node:fs/promises';\nexport async function effect() { await readFile('a'); }\n",
      'tests/effect.test.ts': "import { effect } from '../src/example/operation.ts';\nexport const run = async () => { await effect(); };\n",
      'tests/pure.test.ts': 'export const pure = () => 1;\n'
    });
    const initial = compileTypeScriptSourceProgramModelIncremental(initialInput, null);
    const exact = compileTypeScriptSourceProgramModelIncremental(initialInput, initial.state);
    expect(exact.mode).toBe('exact');
    expect(exact.invalidatedPaths).toEqual([]);
    expect(exact.model).toBe(initial.model);
    expect(exact.state).toBe(initial.state);
    expect(exact.state.factShards[0]).toBe(initial.state.factShards[0]);
    const changedInput = sourceInput({
      'src/example/operation.ts': "import { readFile } from 'node:fs/promises';\nexport async function effect() { await readFile('a'); }\n",
      'tests/effect.test.ts': "import { effect as invoke } from '../src/example/operation.ts';\nexport const run = async () => { await invoke(); };\n",
      'tests/pure.test.ts': 'export const pure = () => 1;\n'
    });
    const changed = compileTypeScriptSourceProgramModelIncremental(changedInput, initial.state);
    const clean = compileTypeScriptSourceProgramModel(changedInput);
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
  } finally {
    releaseTypeScriptSourceProgramWorkspace();
  }
});

test('return provenance remains canonical across shard serialization and incremental reassembly', () => {
  try {
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
    const initial = compileTypeScriptSourceProgramModelIncremental(initialInput, null);
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
    const changed = compileTypeScriptSourceProgramModelIncremental(changedInput, initial.state);
    const changedReaderShard = changed.state.factShards.find(
      ({ path }) => path === 'src/example/reader.ts'
    );
    expect(changed.mode).toBe('incremental');
    const clean = compileTypeScriptSourceProgramModel(changedInput);
    expect(changedReaderShard).not.toBe(readerShard);
    expect(changed.model.returnProvenances).toEqual(clean.returnProvenances);
    expect(sourceProgramCurrentExactReturnProvenances(changed.model)).toEqual(
      sourceProgramCurrentExactReturnProvenances(clean)
    );
  } finally {
    releaseTypeScriptSourceProgramWorkspace();
  }
});

test('ambient declarations, global augmentations, and resolver graph changes force a clean compilation while an unrelated added module reuses retained fact shards', () => {
  try {
    const assertFullEquivalent = (
      initialSources: Readonly<Record<string, string>>,
      changedSources: Readonly<Record<string, string>>
    ): void => {
      const initial = compileTypeScriptSourceProgramModelIncremental(sourceInput(initialSources), null);
      const changedInput = sourceInput(changedSources);
      const changed = compileTypeScriptSourceProgramModelIncremental(changedInput, initial.state);

      expect(changed.mode).toBe('full');
      expect(changed.model).toEqual(compileTypeScriptSourceProgramModel(changedInput));
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
    // An unrelated added module changes no retained resolution: the untouched
    // shard is reused, only the added path is invalidated, and the assembled
    // model remains clean-compile equivalent.
    const addedInitial = compileTypeScriptSourceProgramModelIncremental(sourceInput({
      'src/example/value.ts': 'export const VALUE = 1;\n'
    }), null);
    const addedInput = sourceInput({
      'src/example/value.ts': 'export const VALUE = 1;\n',
      'src/example/added.ts': 'export const ADDED = 1;\n'
    });
    const added = compileTypeScriptSourceProgramModelIncremental(addedInput, addedInitial.state);
    expect(added.mode).toBe('incremental');
    expect(added.invalidatedPaths).toEqual(['src/example/added.ts']);
    expect(added.model).toEqual(compileTypeScriptSourceProgramModel(addedInput));
    assertFullEquivalent({
      'src/example/consumer.ts': "import { VALUE } from './first.ts';\nexport const RESULT = VALUE;\n",
      'src/example/first.ts': 'export const VALUE = 1;\n',
      'src/example/second.ts': 'export const VALUE = 2;\n'
    }, {
      'src/example/consumer.ts': "import { VALUE } from './second.ts';\nexport const RESULT = VALUE;\n",
      'src/example/first.ts': 'export const VALUE = 1;\n',
      'src/example/second.ts': 'export const VALUE = 2;\n'
    });
  } finally {
    releaseTypeScriptSourceProgramWorkspace();
  }
});

test('TypeScript root digest binds raw bytes even when a caller reuses a declared content digest', () => {
  try {
    const initialInput = sourceInput({
      'src/example/value.ts': 'export const VALUE = 1;\n'
    });
    const initial = compileTypeScriptSourceProgramModelIncremental(initialInput, null);
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
    const before = observeTypeScriptSourceProgramPerformanceForTests();
    const changed = compileTypeScriptSourceProgramModelIncremental(staleDigestInput, initial.state);
    const after = observeTypeScriptSourceProgramPerformanceForTests();

    expect(after.rawSourceHashOperations - before.rawSourceHashOperations).toBe(1);
    expect(changed.state.factShards[0]?.rawFileDigest)
      .not.toBe(initial.state.factShards[0]?.rawFileDigest);
    expect(changed.model.modelDigest).not.toBe(initial.model.modelDigest);
    expect(changed.model).toEqual(compileTypeScriptSourceProgramModel(staleDigestInput));
  } finally {
    releaseTypeScriptSourceProgramWorkspace();
  }
});

test('sealed fact shards remain the incremental authority after the TypeScript workspace is released', () => {
  try {
    const initialInput = sourceInput({
      'src/example/contract.ts': 'export const VALUE = 1;\n',
      'src/example/consumer.ts': "import { VALUE } from './contract.ts';\nexport const RESULT = VALUE;\n"
    });
    const initial = compileTypeScriptSourceProgramModelIncremental(initialInput, null);
    releaseTypeScriptSourceProgramWorkspace();
    const changedInput = sourceInput({
      'src/example/contract.ts': 'export const VALUE = 2;\n',
      'src/example/consumer.ts': "import { VALUE } from './contract.ts';\nexport const RESULT = VALUE;\n"
    });
    const changed = compileTypeScriptSourceProgramModelIncremental(changedInput, initial.state);

    expect(changed.mode).toBe('incremental');
    expect(changed.model).toEqual(compileTypeScriptSourceProgramModel(changedInput));
  } finally {
    releaseTypeScriptSourceProgramWorkspace();
  }
});

test('workspace-signed incremental performance observation remains clean-compile equivalent', () => {
  try {
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
      const snapshot = compileVirtualWorkspaceSourceSnapshot({
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
    const initial = compileTypeScriptSourceProgramModelIncrementalFromWorkspaceSnapshot(
      initialInput,
      null,
      initialInput.snapshot
    );
    const changedInput = snapshotFor(2);
    const before = observeTypeScriptSourceProgramPerformanceForTests();
    const startedAt = performance.now();
    const changed = compileTypeScriptSourceProgramModelIncrementalFromWorkspaceSnapshot(
      changedInput,
      initial.state,
      changedInput.snapshot
    );
    const durationMs = performance.now() - startedAt;
    const after = observeTypeScriptSourceProgramPerformanceForTests();
    const delta = Object.freeze(Object.fromEntries(Object.keys(after).map((key) => [
      key,
      after[key as keyof typeof after] - before[key as keyof typeof before]
    ])));

    console.log(`SEC_TYPESCRIPT_PERF=${JSON.stringify({ durationMs, ...delta })}`);
    expect(changed.mode).toBe('incremental');
    expect(changed.model).toEqual(compileTypeScriptSourceProgramModel(changedInput));
    expect(delta).toMatchObject({
      dependencyReferenceVisits: 0,
      rawSourceHashBytes: 0,
      rawSourceHashOperations: 0,
      semanticScopeParseOperations: 1
    });
  } finally {
    releaseTypeScriptSourceProgramWorkspace();
  }
});

function structuralCacheFixture(sources: Readonly<Record<string, string>>, label: string) {
  const input = sourceInput(sources);
  const snapshot = compileVirtualWorkspaceSourceSnapshot({
    ...input, subject: { kind: 'virtual-mutation', provenance: {
      kind: 'source-program-virtual-mutation', baseSnapshotDigest: sha256('before'), mutationDigest: sha256(label)
    } }
  });
  return { input: { ...input, sourceRevision: snapshot.sourceRevision }, snapshot };
}

test('cache-adopted shards alone cannot authorize structural incremental reuse', () => {
  try {
    const before = structuralCacheFixture({ 'src/stable.ts': 'export const value = 1;\n' }, 'before');
    const previous = compileTypeScriptSourceProgramModelIncrementalFromWorkspaceSnapshot(before.input, null, before.snapshot);
    const adopted = adoptTypeScriptSourceProgramFactShardsFromWorkspaceSnapshot(
      before.input, previous.state.factShards, before.snapshot, { moduleGraphDigest: before.snapshot.moduleGraphDigest }
    );
    const after = structuralCacheFixture({ 'src/stable.ts': 'export const value = 1;\n', 'src/new.ts': 'export const added = 2;\n' }, 'after');
    const result = compileTypeScriptSourceProgramModelIncrementalFromWorkspaceSnapshot(after.input, adopted, after.snapshot);
    expect(result.mode).toBe('full');
    expect(result.model).toEqual(compileTypeScriptSourceProgramModel(after.input));
    const exact = compileTypeScriptSourceProgramModelIncrementalFromWorkspaceSnapshot(before.input, adopted, before.snapshot);
    expect(exact.mode).toBe('exact');
    const afterExact = compileTypeScriptSourceProgramModelIncrementalFromWorkspaceSnapshot(after.input, exact.state, after.snapshot);
    expect(afterExact.mode).toBe('full');
    expect(afterExact.model).toEqual(result.model);
    const edited = structuralCacheFixture({ 'src/stable.ts': 'export const value = 2;\n' }, 'edited');
    expect(edited.snapshot.moduleGraphDigest).toBe(before.snapshot.moduleGraphDigest);
    const ordinaryIncremental = compileTypeScriptSourceProgramModelIncrementalFromWorkspaceSnapshot(edited.input, adopted, edited.snapshot);
    expect(ordinaryIncremental.mode).toBe('incremental');
    const addedAfterEdit = structuralCacheFixture({ 'src/stable.ts': 'export const value = 2;\n', 'src/new.ts': 'export const added = 2;\n' }, 'edited-added');
    const afterIncremental = compileTypeScriptSourceProgramModelIncrementalFromWorkspaceSnapshot(addedAfterEdit.input, ordinaryIncremental.state, addedAfterEdit.snapshot);
    expect(afterIncremental.mode).toBe('full');
    expect(afterIncremental.model).toEqual(compileTypeScriptSourceProgramModel(addedAfterEdit.input));
  } finally {
    releaseTypeScriptSourceProgramWorkspace();
  }
});

test('cache-adopted baseline keeps unchanged triple-slash inputs in its full fallback', () => {
  try {
    const before = structuralCacheFixture({
      'src/helper.ts': 'export const value = 1;\n',
      'src/library.ts': '/// <reference lib="es2022" />\nexport const library = true;\n'
    }, 'directives-before');
    const previous = compileTypeScriptSourceProgramModelIncrementalFromWorkspaceSnapshot(before.input, null, before.snapshot);
    const adopted = adoptTypeScriptSourceProgramFactShardsFromWorkspaceSnapshot(
      before.input, previous.state.factShards, before.snapshot, { moduleGraphDigest: before.snapshot.moduleGraphDigest }
    );
    const after = structuralCacheFixture({
      'src/helper.ts': 'export const value = 2;\n',
      'src/library.ts': '/// <reference lib="es2022" />\nexport const library = true;\n'
    }, 'directives-after');
    expect(after.snapshot.moduleGraphDigest).toBe(before.snapshot.moduleGraphDigest);
    const result = compileTypeScriptSourceProgramModelIncrementalFromWorkspaceSnapshot(after.input, adopted, after.snapshot);
    expect(result.mode).toBe('full');
    expect(result.model).toEqual(compileTypeScriptSourceProgramModel(after.input));
  } finally {
    releaseTypeScriptSourceProgramWorkspace();
  }
});
