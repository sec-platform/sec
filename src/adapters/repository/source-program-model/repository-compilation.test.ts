import { expect, test } from 'bun:test';

import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { compileSecRepositoryModuleMembershipSnapshot } from '../architecture/contract.ts';
import {
  createSourceProgramCompilationOperation,
  SourceProgramCompilationInterruptedError
} from './compilation-operation.ts';
import {
  type RepositoryCompilationCacheProvider,
  type RepositoryCompilationGenerationReceipt
} from './repository-compilation-cache.ts';
import {
  compileVirtualRepositorySourceProgramCompilation,
  repositoryCompilationDiagnosticsForTests,
  type RepositorySourceProgramCompilationReceipt
} from './repository-compilation.ts';
import { compileRepositorySourceProgramModelFromWorkspaceSnapshot } from './repository.ts';
import {
  compileSourceProgramTestObservationsFromWorkspaceSnapshot,
  workspaceSourceSnapshotIdentityForTestObservations
} from './test-observations.ts';
import {
  compileTypeScriptSourceProgramModelFromWorkspaceSnapshot,
  sourceProgramCurrentExactReturnProvenances,
  workspaceSourceSnapshotIdentityForTypeScriptModel
} from './typescript.ts';
import {
  assertWorkspaceSourceSnapshot,
  compileVirtualWorkspaceSourceSnapshot,
  compileWorkspaceTypeScriptProjectInput,
  type WorkspaceSourceSnapshot,
  type WorkspaceSourceSnapshotSubject
} from './workspace-source-snapshot.ts';

function fixture(value: number) {
  const descriptorPath = 'src/example/module.json';
  const sources = Object.freeze({
    'src/example/operation.ts': `export const value = ${value};\n`,
    'tsconfig.json': `${JSON.stringify({
      compilerOptions: { strict: true },
      include: ['src/**/*.ts']
    })}\n`,
    'tests/example.test.ts': [
      "import { expect, test } from 'bun:test';",
      "import { value } from '../src/example/operation.ts';",
      "test('value', () => expect(value).toBeGreaterThan(0));",
      ''
    ].join('\n')
  });
  const files = Object.entries(sources)
    .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
    .map(([path, source]) => Object.freeze({
      path,
      source,
      contentDigest: rawSha256(source)
    }));
  const moduleMembership = compileSecRepositoryModuleMembershipSnapshot({
    repositoryFiles: [...files.map(({ path }) => path), descriptorPath],
    descriptorSources: [{
      descriptorPath,
      source: JSON.stringify({
        importGraph: 'runtime',
        externalEntrypoints: [],
        capabilityProviders: [],
        preDependencyBootstrap: false
      })
    }]
  });
  return Object.freeze({
    files: Object.freeze(files),
    moduleMembership,
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest })))
  });
}

function virtualSnapshotSubject(identity: string): WorkspaceSourceSnapshotSubject {
  return Object.freeze({
    kind: 'virtual-mutation',
    provenance: Object.freeze({
      kind: 'source-program-virtual-mutation',
      baseSnapshotDigest: sha256('source-program-test-base') as `sha256:${string}`,
      mutationDigest: sha256(identity) as `sha256:${string}`
    })
  });
}

test('one owner-issued virtual snapshot compiles one graph for every Source Program projection', () => {
  const input = fixture(1);
  const workspaceSnapshot = compileVirtualWorkspaceSourceSnapshot({
    ...input,
    subject: virtualSnapshotSubject('virtual-observation') as Extract<WorkspaceSourceSnapshotSubject, { kind: 'virtual-mutation' }>
  });
  const receipt = compileVirtualRepositorySourceProgramCompilation({
    workspaceSnapshot
  });

  expect(receipt.subject.kind).toBe('virtual-mutation');
  expect(receipt.snapshotDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(receipt.moduleGraphDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(receipt.moduleGraphCompilationCount).toBe(1);
  expect(receipt.workspaceSnapshot.moduleGraphCompilationCount).toBe(1);
  expect(receipt.workspaceSnapshot.moduleGraph.files).toEqual([
    'src/example/operation.ts',
    'tests/example.test.ts',
    'tsconfig.json'
  ]);
  expect(workspaceSourceSnapshotIdentityForTypeScriptModel(receipt.typeScriptCompilation.model))
    .toBe(receipt.workspaceSnapshotIdentityDigest);
  expect(workspaceSourceSnapshotIdentityForTestObservations(receipt.testObservations))
    .toBe(receipt.workspaceSnapshotIdentityDigest);
  expect(receipt.model.sourceRevision).toBe(workspaceSnapshot.sourceRevision);
  expect(receipt.receiptDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
});

test('repository compilation contexts reject fact mixing and keep virtual mutation explicit', () => {
  const left = fixture(1);
  const right = fixture(1);
  const leftContext = compileVirtualWorkspaceSourceSnapshot({
    ...left,
    subject: virtualSnapshotSubject('left-observation') as Extract<WorkspaceSourceSnapshotSubject, { kind: 'virtual-mutation' }>
  });
  const mutationSubject: WorkspaceSourceSnapshotSubject = Object.freeze({
    kind: 'virtual-mutation',
    provenance: Object.freeze({
      kind: 'source-program-virtual-mutation',
      baseSnapshotDigest: leftContext.snapshotDigest,
      mutationDigest: sha256('replace value') as `sha256:${string}`
    })
  });
  const rightContext = compileVirtualWorkspaceSourceSnapshot({
    ...right,
    subject: mutationSubject as Extract<WorkspaceSourceSnapshotSubject, { kind: 'virtual-mutation' }>
  });
  const leftModel = compileTypeScriptSourceProgramModelFromWorkspaceSnapshot({
    ...left,
    sourceRevision: leftContext.sourceRevision
  }, leftContext);
  const rightModel = compileTypeScriptSourceProgramModelFromWorkspaceSnapshot({
    ...right,
    sourceRevision: rightContext.sourceRevision
  }, rightContext);

  expect(rightContext.subject.kind).toBe('virtual-mutation');
  expect(() => compileSourceProgramTestObservationsFromWorkspaceSnapshot({
    productionModel: leftModel,
    files: right.files,
    moduleMembership: right.moduleMembership
  }, rightContext)).toThrow('cannot mix a production model');

  const leftObservations = compileSourceProgramTestObservationsFromWorkspaceSnapshot({
    productionModel: leftModel,
    files: left.files,
    moduleMembership: left.moduleMembership
  }, leftContext);
  expect(() => compileRepositorySourceProgramModelFromWorkspaceSnapshot({
    ...right,
    sourceRevision: rightContext.sourceRevision,
    typescriptModel: rightModel,
    testObservations: leftObservations
  }, rightContext)).toThrow('cannot mix test facts');
});

test('workspace source snapshot origin cannot be forged by structural copying', () => {
  const input = fixture(1);
  const issued = compileVirtualWorkspaceSourceSnapshot({
    ...input,
    subject: virtualSnapshotSubject('issued-context') as Extract<WorkspaceSourceSnapshotSubject, { kind: 'virtual-mutation' }>
  });
  expect(() => assertWorkspaceSourceSnapshot(issued)).not.toThrow();

  const forged = Object.freeze({ ...issued }) as WorkspaceSourceSnapshot;
  expect(() => assertWorkspaceSourceSnapshot(forged))
    .toThrow('was not issued by the Source Program owner');
});

test('workspace source snapshot owns immutable repository-relative source bytes', () => {
  const input = fixture(1);
  const mutableFile = {
    ...input.files[0]!
  };
  const issued = compileVirtualWorkspaceSourceSnapshot({
    ...input,
    files: [mutableFile, ...input.files.slice(1)],
    subject: virtualSnapshotSubject('immutable-snapshot') as Extract<WorkspaceSourceSnapshotSubject, { kind: 'virtual-mutation' }>
  });
  const admitted = issued.file(mutableFile.path);
  expect(admitted).not.toBeNull();
  expect(admitted?.source).toBe(mutableFile.source);
  expect(admitted?.path.startsWith('/')).toBeFalse();
  expect(Object.isFrozen(issued.files)).toBeTrue();
  expect(Object.isFrozen(admitted)).toBeTrue();

  mutableFile.source = 'export const replacement = true;\n';
  expect(issued.file(admitted!.path)?.source).toBe(admitted!.source);
  expect(issued.files.some((file) => 'bytesBase64' in file || 'physicalPath' in file)).toBeFalse();
});

test('cache absence and open, read, or publish failure preserve the cold semantic generation', () => {
  const input = fixture(1);
  const workspaceSnapshot = compileVirtualWorkspaceSourceSnapshot({
    ...input,
    subject: virtualSnapshotSubject('cache-failure-fallback') as Extract<WorkspaceSourceSnapshotSubject, { kind: 'virtual-mutation' }>
  });
  const projectInput = compileWorkspaceTypeScriptProjectInput(
    workspaceSnapshot,
    'tsconfig.json'
  );
  const cold = compileVirtualRepositorySourceProgramCompilation({
    workspaceSnapshot,
    projectInput
  });
  const openFailure: RepositoryCompilationCacheProvider = Object.freeze({
    openContentAddressedHint: () => {
      throw new Error('cache-open-failed');
    }
  });
  const readFailure: RepositoryCompilationCacheProvider = Object.freeze({
    openContentAddressedHint: (generation: RepositoryCompilationGenerationReceipt) => Object.freeze({
      keyDigest: generation.generationDigest,
      loadExact: () => { throw new Error('cache-read-failed'); },
      loadPredecessor: () => { throw new Error('cache-predecessor-read-failed'); },
      publish: () => { throw new Error('cache-publish-failed'); }
    })
  });
  const publishFailure: RepositoryCompilationCacheProvider = Object.freeze({
    openContentAddressedHint: (generation: RepositoryCompilationGenerationReceipt) => {
      const keyDigest = generation.generationDigest;
      const miss = Object.freeze({ status: 'miss' as const, keyDigest });
      return Object.freeze({
        keyDigest,
        loadExact: () => miss,
        loadPredecessor: () => miss,
        publish: () => { throw new Error('cache-publish-failed'); }
      });
    }
  });

  for (const cacheProvider of [openFailure, readFailure, publishFailure]) {
    const recovered = compileVirtualRepositorySourceProgramCompilation({
      cacheProvider,
      workspaceSnapshot,
      projectInput
    });
    expect(recovered.typeScriptCompilation.mode).toBe('full');
    expect(recovered.typeScriptCompilation.model).toEqual(cold.typeScriptCompilation.model);
    expect(recovered.testObservations).toEqual(cold.testObservations);
    expect(recovered.model).toEqual(cold.model);
    expect(recovered.projectGeneration).toEqual(cold.projectGeneration);
    expect(recovered.cacheReceipt).toBeNull();
    expect(recovered.receiptDigest).toBe(cold.receiptDigest);
  }
});

test('read-only cache consumption preserves reads and the semantic receipt without publication', () => {
  const input = fixture(1);
  const workspaceSnapshot = compileVirtualWorkspaceSourceSnapshot({
    ...input,
    subject: virtualSnapshotSubject('read-only-cache') as Extract<WorkspaceSourceSnapshotSubject, { kind: 'virtual-mutation' }>
  });
  const projectInput = compileWorkspaceTypeScriptProjectInput(workspaceSnapshot, 'tsconfig.json');
  const calls = { exact: 0, predecessor: 0, publish: 0 };
  const provider: RepositoryCompilationCacheProvider = Object.freeze({
    openContentAddressedHint: (generation: RepositoryCompilationGenerationReceipt) => {
      const miss = Object.freeze({ status: 'miss' as const, keyDigest: generation.generationDigest });
      return Object.freeze({
        keyDigest: generation.generationDigest,
        loadExact: () => { calls.exact++; return miss; },
        loadPredecessor: () => { calls.predecessor++; return miss; },
        publish: () => { calls.publish++; return miss; }
      });
    }
  });
  const readOnly = compileVirtualRepositorySourceProgramCompilation({
    cacheProvider: provider,
    cacheAccess: 'read-only',
    workspaceSnapshot,
    projectInput
  });
  expect(calls).toEqual({ exact: 1, predecessor: 1, publish: 0 });

  const readWrite = compileVirtualRepositorySourceProgramCompilation({
    cacheProvider: provider,
    cacheAccess: 'read-write',
    workspaceSnapshot,
    projectInput
  });
  expect(calls).toEqual({ exact: 2, predecessor: 2, publish: 1 });
  expect(readOnly.model).toEqual(readWrite.model);
  expect(readOnly.testObservations).toEqual(readWrite.testObservations);
  expect(readOnly.projectGeneration).toEqual(readWrite.projectGeneration);
  expect(readOnly.receiptDigest).toBe(readWrite.receiptDigest);
});

test('one bounded compilation reports exact phases and rejects late cache publication', () => {
  const input = fixture(1);
  const workspaceSnapshot = compileVirtualWorkspaceSourceSnapshot({
    ...input,
    subject: virtualSnapshotSubject('bounded-compilation') as Extract<WorkspaceSourceSnapshotSubject, { kind: 'virtual-mutation' }>
  });
  const projectInput = compileWorkspaceTypeScriptProjectInput(workspaceSnapshot, 'tsconfig.json');
  const operation = createSourceProgramCompilationOperation({
    deadlineAtUnixMs: Date.now() + 30_000
  });
  const receipt = compileVirtualRepositorySourceProgramCompilation({
    workspaceSnapshot,
    projectInput,
    operation
  });
  const diagnostics = repositoryCompilationDiagnosticsForTests(workspaceSnapshot);
  expect(receipt.typeScriptCompilation.mode).toBe('full');
  const events = diagnostics?.phaseEvents ?? [];
  expect(events.length).toBeGreaterThan(0);
  expect(events.every((event, index) => (
    index === 0 || event.elapsedMs >= events[index - 1]!.elapsedMs
  ))).toBeTrue();
  const intervalByPhase = new Map(events.map(({ phase }) => [
    phase,
    events.filter((event) => event.phase === phase)
  ]));
  expect([...intervalByPhase.values()].every((interval) => (
    interval.length === 2
      && interval[0]?.state === 'start'
      && interval[1]?.state === 'complete'
  ))).toBeTrue();
  expect(intervalByPhase.has('program-materialization')).toBeTrue();
  expect(intervalByPhase.has('fact-shard-assembly')).toBeTrue();
  expect(events.at(-1)).toEqual(expect.objectContaining({
    phase: 'settlement',
    state: 'complete'
  }));

  let publishCount = 0;
  const expired = createSourceProgramCompilationOperation({
    deadlineAtUnixMs: Date.now() - 1
  });
  const cacheProvider: RepositoryCompilationCacheProvider = Object.freeze({
    openContentAddressedHint: (generation: RepositoryCompilationGenerationReceipt) => {
      const miss = Object.freeze({
        status: 'miss' as const,
        keyDigest: generation.generationDigest
      });
      return Object.freeze({
        keyDigest: generation.generationDigest,
        loadExact: () => miss,
        loadPredecessor: () => miss,
        publish: () => {
          publishCount += 1;
          return miss;
        }
      });
    }
  });
  let failure: unknown;
  try {
    compileVirtualRepositorySourceProgramCompilation({
      workspaceSnapshot,
      projectInput,
      cacheProvider,
      operation: expired
    });
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(SourceProgramCompilationInterruptedError);
  expect((failure as SourceProgramCompilationInterruptedError).code)
    .toBe('source-program-compilation-deadline-exhausted');
  expect(publishCount).toBe(0);
});


function incrementalFixture(sources: Readonly<Record<string, string>>, label: string,
  modes: Readonly<Record<string, '100644' | '100755'>> = {}) {
  const inputFiles = Object.entries(sources).sort(([a], [b]) => a.localeCompare(b, 'en-US'))
    .map(([path, source]) => Object.freeze({ path, source, contentDigest: rawSha256(source), mode: modes[path] ?? '100644' }));
  const moduleMembership = compileSecRepositoryModuleMembershipSnapshot({
    repositoryFiles: inputFiles.map(({ path }) => path),
    descriptorSources: inputFiles.filter(({ path }) => path.endsWith('/module.json'))
      .map(({ path: descriptorPath, source }) => ({ descriptorPath, source }))
  });
  const workspaceSnapshot = compileVirtualWorkspaceSourceSnapshot({
    files: inputFiles, moduleMembership,
    subject: virtualSnapshotSubject(label) as Extract<WorkspaceSourceSnapshotSubject, { kind: 'virtual-mutation' }>
  });
  return {
    workspaceSnapshot,
    projectInput: compileWorkspaceTypeScriptProjectInput(workspaceSnapshot, 'tsconfig.json')
  };
}

const incrementalFixtureBase = {
  'src/example/module.json': JSON.stringify({ importGraph: 'runtime', externalEntrypoints: [] }),
  'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true }, include: ['src/example/**/*.ts', 'tests/**/*.ts'] }),
  'package.json': JSON.stringify({ type: 'module', private: true }),
  'src/example/helper.ts': 'export const value = 1;\n',
  'src/example/consumer.ts': "import { value } from './helper.ts'; export const result = value;\n",
  'src/example/unrelated.ts': 'export const stable = 7;\n'
};
const addedTestSource = "import { expect, test } from 'bun:test'; import { value } from '../src/example/helper.ts'; test('value', () => expect(value).toBe(1));\n";
const incrementalScenarios: readonly Readonly<{
  name: string; before?: Readonly<Record<string, string>>;
  after: Readonly<Record<string, string>>; remove?: string; mode: 'incremental' | 'full';
}>[] = [
  { name: 'isolated new test', after: { 'tests/added.test.ts': addedTestSource }, mode: 'incremental' },
  { name: 'shared helper', after: { 'src/example/helper.ts': 'export const value = 2;\n' }, mode: 'incremental' },
  { name: 'formerly unresolved import', before: { 'src/example/consumer.ts': "import { value } from './late.ts'; export const result = value;\n" }, after: { 'src/example/late.ts': 'export const value = 2;\n' }, mode: 'full' },
  { name: 'star re-export', before: { 'src/example/barrel.ts': "export * from './helper.ts';\n", 'src/example/consumer.ts': "import { value } from './barrel.ts'; export const result = value;\n" }, after: { 'src/example/helper.ts': 'export const value = 2;\n' }, mode: 'incremental' },
  { name: 'global augmentation', after: { 'src/example/global.ts': 'export {}; declare global { interface Window { value: number } }\n' }, mode: 'full' },
  { name: 'unchanged global dependency', before: { 'src/example/global.ts': 'export {}; declare global { const GLOBAL: number; }\n', 'src/example/helper.ts': 'export const value = GLOBAL;\n' }, after: { 'src/example/helper.ts': 'export const value = GLOBAL + 1;\n' }, mode: 'full' },
  { name: 'unchanged global augmentation', before: { 'src/example/global.ts': 'export {}; declare global { interface Window { value: number } }\n' }, after: { 'tests/added.test.ts': addedTestSource }, mode: 'full' },
  { name: 'unchanged triple-slash reference', before: { 'src/example/library.ts': '/// <reference lib="es2022" />\nexport const library = true;\n' }, after: { 'tests/added.test.ts': addedTestSource }, mode: 'full' },
  { name: 'package change', after: { 'package.json': JSON.stringify({ type: 'module', private: true, version: '2' }) }, mode: 'full' },
  { name: 'tsconfig change', after: { 'tsconfig.json': JSON.stringify({ compilerOptions: { strict: false }, include: ['src/example/**/*.ts', 'tests/**/*.ts'] }) }, mode: 'full' },
  { name: 'unchanged unknown frontier', before: { 'src/example/dynamic.ts': 'export const load = (name: string) => import(name);\n' }, after: { 'src/example/helper.ts': 'export const value = 2;\n' }, mode: 'full' },
  { name: 'unknown dynamic frontier', after: { 'src/example/dynamic.ts': 'export const load = (name: string) => import(name);\n' }, mode: 'full' },
  { name: 'module deletion', remove: 'src/example/unrelated.ts', after: {}, mode: 'full' },
  { name: 'resolution candidate shadowing', before: { 'src/example/choice/index.ts': 'export const choice = 1;\n', 'src/example/consumer.ts': "import { choice } from './choice'; export const result = choice;\n" }, after: { 'src/example/choice.ts': 'export const choice = 2;\n' }, mode: 'full' }
];

for (const scenario of incrementalScenarios) {
  test(`live baseline incremental/full facts agree for ${scenario.name}`, () => {
    const before = { ...incrementalFixtureBase, ...scenario.before };
    const after: Record<string, string> = { ...before, ...scenario.after };
    if (scenario.remove !== undefined) delete after[scenario.remove];
    const baselineInput = incrementalFixture(before, `${scenario.name}:before`);
    const currentInput = incrementalFixture(after, `${scenario.name}:after`);
    const baseline = compileVirtualRepositorySourceProgramCompilation(baselineInput);
    const reused = compileVirtualRepositorySourceProgramCompilation({ ...currentInput, previousCompilation: baseline });
    const full = compileVirtualRepositorySourceProgramCompilation(currentInput);
    expect(reused.typeScriptCompilation.model).toEqual(full.typeScriptCompilation.model);
    expect(reused.typeScriptCompilation.mode).toBe(scenario.mode);
    expect(reused.testObservations).toEqual(full.testObservations);
    expect(reused.model).toEqual(full.model);
    expect(reused.receiptDigest).toBe(full.receiptDigest);
    expect(sourceProgramCurrentExactReturnProvenances(reused.typeScriptCompilation.model))
      .toEqual(sourceProgramCurrentExactReturnProvenances(full.typeScriptCompilation.model));
    if (scenario.mode === 'incremental') {
      const retained = reused.typeScriptCompilation.state.factShards.find(({ path }) => path === 'src/example/unrelated.ts');
      expect(retained).toBe(baseline.typeScriptCompilation.state.factShards.find(({ path }) => path === 'src/example/unrelated.ts'));
      expect(reused.typeScriptCompilation.invalidatedPaths).not.toContain('src/example/unrelated.ts');
    }
  }, 30_000);
}

test('a rejected live baseline cannot fall through to a persistent predecessor', () => {
  const baselineInput = incrementalFixture(incrementalFixtureBase, 'guard:before');
  const baseline = compileVirtualRepositorySourceProgramCompilation(baselineInput);
  const changedInput = incrementalFixture({ ...incrementalFixtureBase,
    'package.json': JSON.stringify({ type: 'module', version: 'changed' }) }, 'guard:after');
  const sameInput = incrementalFixture({ ...incrementalFixtureBase, 'tests/added.test.ts': addedTestSource }, 'guard:clone');
  for (const [currentInput, previousCompilation] of [
    [changedInput, baseline],
    [sameInput, { ...baseline } as RepositorySourceProgramCompilationReceipt]
  ] as const) {
    let predecessorReads = 0;
    const cacheProvider: RepositoryCompilationCacheProvider = {
      openContentAddressedHint: generation => {
        const miss = { status: 'miss' as const, keyDigest: generation.generationDigest };
        return { keyDigest: generation.generationDigest, loadExact: () => miss,
          loadPredecessor: () => { predecessorReads++; return miss; }, publish: () => miss };
      }
    };
    const result = compileVirtualRepositorySourceProgramCompilation({ ...currentInput,
      previousCompilation, cacheProvider, cacheAccess: 'read-only' });
    expect(result.typeScriptCompilation.mode).toBe('full');
    expect(predecessorReads).toBe(0);
    expect(result.model).toEqual(compileVirtualRepositorySourceProgramCompilation(currentInput).model);
  }
});


test('live baseline reuse requires two observed project inputs and unchanged non-source modes', () => {
  const before = incrementalFixture(incrementalFixtureBase, 'context:before');
  const after = incrementalFixture({ ...incrementalFixtureBase, 'tests/added.test.ts': addedTestSource }, 'context:after');
  const withProject = compileVirtualRepositorySourceProgramCompilation(before);
  const withoutProject = compileVirtualRepositorySourceProgramCompilation({ workspaceSnapshot: before.workspaceSnapshot });
  const modeChange = incrementalFixture(incrementalFixtureBase, 'context:mode', { 'package.json': '100755' });
  for (const input of [
    { ...after, previousCompilation: withoutProject },
    { workspaceSnapshot: after.workspaceSnapshot, previousCompilation: withProject },
    { ...modeChange, previousCompilation: withProject }
  ]) {
    const result = compileVirtualRepositorySourceProgramCompilation(input);
    expect(result.typeScriptCompilation.mode).toBe('full');
    const { previousCompilation: _previous, ...currentInput } = input;
    expect(result.model).toEqual(compileVirtualRepositorySourceProgramCompilation(currentInput).model);
  }
});
