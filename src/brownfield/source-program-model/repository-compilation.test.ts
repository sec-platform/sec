import { expect, test } from 'bun:test';

import { rawSha256, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import { compileSecRepositoryModuleMembershipSnapshot } from '../../system-architecture/repository-modules/contract.ts';
import {
  compileVirtualRepositorySourceProgramCompilation
} from './repository-compilation.ts';
import { compileRepositorySourceProgramModelFromWorkspaceSnapshot } from './repository.ts';
import {
  compileSourceProgramTestObservationsFromWorkspaceSnapshot,
  workspaceSourceSnapshotIdentityForTestObservations
} from './test-observations.ts';
import {
  compileTypeScriptSourceProgramModelFromWorkspaceSnapshot,
  workspaceSourceSnapshotIdentityForTypeScriptModel
} from './typescript.ts';
import {
  assertWorkspaceSourceSnapshot,
  compileVirtualWorkspaceSourceSnapshot,
  type WorkspaceSourceSnapshot,
  type WorkspaceSourceSnapshotSubject
} from './workspace-source-snapshot.ts';

function fixture(value: number) {
  const descriptorPath = 'src/example/sec.module.json';
  const sources = Object.freeze({
    'src/example/operation.ts': `export const value = ${value};\n`,
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
    'tests/example.test.ts'
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
