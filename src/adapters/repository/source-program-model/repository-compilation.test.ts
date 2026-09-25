import { expect, test } from 'bun:test';

import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { compileRepositoryModuleMembershipSnapshot } from '../architecture/contract.ts';
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
  repositoryCompilationDiagnosticsForTests
} from './repository-compilation.ts';
import { compileRepositoryModelFromSnapshot } from './repository.ts';
import {
  compileTestObservationsFromSnapshot,
  snapshotIdentityForTestObservations
} from './test-observations.ts';
import {
  compileTypeScriptModelWithCompilation,
  workspaceSnapshotIdentityForTypeScriptModel
} from './typescript.ts';
import {
  assertWorkspaceSourceSnapshot,
  compileVirtualSnapshot,
  compileTypeScriptProjectInput,
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
  const moduleMembership = compileRepositoryModuleMembershipSnapshot({
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
  const workspaceSnapshot = compileVirtualSnapshot({
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
  expect(workspaceSnapshotIdentityForTypeScriptModel(receipt.typeScriptCompilation.model))
    .toBe(receipt.workspaceSnapshotIdentityDigest);
  expect(snapshotIdentityForTestObservations(receipt.testObservations))
    .toBe(receipt.workspaceSnapshotIdentityDigest);
  expect(receipt.model.sourceRevision).toBe(workspaceSnapshot.sourceRevision);
  expect(receipt.receiptDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
});

test('repository compilation contexts reject fact mixing and keep virtual mutation explicit', () => {
  const left = fixture(1);
  const right = fixture(1);
  const leftContext = compileVirtualSnapshot({
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
  const rightContext = compileVirtualSnapshot({
    ...right,
    subject: mutationSubject as Extract<WorkspaceSourceSnapshotSubject, { kind: 'virtual-mutation' }>
  });
  const leftModel = compileTypeScriptModelWithCompilation({
    ...left,
    sourceRevision: leftContext.sourceRevision
  }, leftContext);
  const rightModel = compileTypeScriptModelWithCompilation({
    ...right,
    sourceRevision: rightContext.sourceRevision
  }, rightContext);

  expect(rightContext.subject.kind).toBe('virtual-mutation');
  expect(() => compileTestObservationsFromSnapshot({
    productionModel: leftModel,
    files: right.files,
    moduleMembership: right.moduleMembership
  }, rightContext)).toThrow('cannot mix a production model');

  const leftObservations = compileTestObservationsFromSnapshot({
    productionModel: leftModel,
    files: left.files,
    moduleMembership: left.moduleMembership
  }, leftContext);
  expect(() => compileRepositoryModelFromSnapshot({
    ...right,
    sourceRevision: rightContext.sourceRevision,
    typescriptModel: rightModel,
    testObservations: leftObservations
  }, rightContext)).toThrow('cannot mix test facts');
});

test('workspace source snapshot origin cannot be forged by structural copying', () => {
  const input = fixture(1);
  const issued = compileVirtualSnapshot({
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
  const issued = compileVirtualSnapshot({
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
  const workspaceSnapshot = compileVirtualSnapshot({
    ...input,
    subject: virtualSnapshotSubject('cache-failure-fallback') as Extract<WorkspaceSourceSnapshotSubject, { kind: 'virtual-mutation' }>
  });
  const projectInput = compileTypeScriptProjectInput(
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
  const workspaceSnapshot = compileVirtualSnapshot({
    ...input,
    subject: virtualSnapshotSubject('read-only-cache') as Extract<WorkspaceSourceSnapshotSubject, { kind: 'virtual-mutation' }>
  });
  const projectInput = compileTypeScriptProjectInput(workspaceSnapshot, 'tsconfig.json');
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
  const workspaceSnapshot = compileVirtualSnapshot({
    ...input,
    subject: virtualSnapshotSubject('bounded-compilation') as Extract<WorkspaceSourceSnapshotSubject, { kind: 'virtual-mutation' }>
  });
  const projectInput = compileTypeScriptProjectInput(workspaceSnapshot, 'tsconfig.json');
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
