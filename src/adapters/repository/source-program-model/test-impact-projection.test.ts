import { expect, test } from 'bun:test';
import path from 'node:path';

import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { compileRepositoryModuleMembership } from '../architecture/contract.ts';
import { compileVirtualRepositorySourceProgramCompilation } from './repository-compilation.ts';
import {
  assertIssuedTestImpactProjection,
  compileVirtualTestImpactProjection,
  encodeTestImpactProjectionReceipt,
  parseTestImpactProjectionReceipt
} from './test-impact-projection.ts';
import { compileVirtualSnapshot } from './workspace-source-snapshot.ts';

const membership = compileRepositoryModuleMembership(path.resolve(import.meta.dir, '../../../..'));

function fixture(sources: Readonly<Record<string, string>>) {
  const sourceRevision = rawSha256(JSON.stringify(sources));
  const workspaceSnapshot = compileVirtualSnapshot({
    subject: {
      kind: 'virtual-mutation',
      provenance: {
        kind: 'source-program-virtual-mutation',
        baseSnapshotDigest: rawSha256('test-impact-projection-base'),
        mutationDigest: sourceRevision
      }
    },
    files: Object.entries(sources).map(([repositoryPath, source]) => ({
      path: repositoryPath,
      source,
      contentDigest: rawSha256(source)
    })),
    moduleMembership: membership
  });
  const repositoryCompilation = compileVirtualRepositorySourceProgramCompilation({ workspaceSnapshot });
  const projection = compileVirtualTestImpactProjection({
    workspaceSnapshot,
    repositoryModel: repositoryCompilation.model,
    typeScriptModel: repositoryCompilation.typeScriptCompilation.model,
    testObservations: repositoryCompilation.testObservations
  });
  return { repositoryCompilation, projection };
}

test('compact TestImpact projection binds the exact compilation purpose without copying full facts', () => {
  const { repositoryCompilation, projection } = fixture({
    'src/compiler/projection-fixture.ts': 'export const fixture = true;',
    'tests/unit/projection-fixture.test.ts': [
      "import { fixture } from '../../src/compiler/projection-fixture.ts';",
      'if (!fixture) throw new Error();'
    ].join('\n')
  });
  expect(() => assertIssuedTestImpactProjection(projection)).toThrow('owner-issued');
  expect(projection.purpose).toBe('test-impact-selection');
  expect(projection.subjectDigest).toBe(repositoryCompilation.subjectDigest);
  expect(projection.workspaceSnapshotIdentityDigest)
    .toBe(repositoryCompilation.workspaceSnapshotIdentityDigest);
  expect(projection.moduleGraphDigest).toBe(repositoryCompilation.moduleGraphDigest);
  expect(projection.testObservationDigest).toBe(repositoryCompilation.testObservations.observationDigest);
  expect(projection.files.every((file) => !('source' in file))).toBeTrue();
  expect(projection.moduleOwners).toContainEqual({
    moduleId: 'compiler',
    root: 'src/compiler'
  });
  expect('registrations' in projection).toBeFalse();
  const fullConsumerPayloadBytes = Buffer.byteLength(JSON.stringify({
    model: repositoryCompilation.typeScriptCompilation.model,
    testObservations: repositoryCompilation.testObservations,
    moduleGraph: repositoryCompilation.workspaceSnapshot.moduleGraph,
    moduleMembership: repositoryCompilation.workspaceSnapshot.moduleMembership.descriptors
  }));
  expect(Buffer.byteLength(encodeTestImpactProjectionReceipt(projection), 'utf8'))
    .toBeLessThan(fullConsumerPayloadBytes);
});

test('compact projection retains compiler-observed test consumers as canonical observation edges', () => {
  const { projection } = fixture({
    'src/compiler/observed-fixture.ts': 'export const observed = true;',
    'tests/unit/observed-fixture.test.ts': [
      "import { readFileSync } from 'node:fs';",
      "readFileSync('src/compiler/observed-fixture.ts', 'utf8');"
    ].join('\n'),
    'tests/unit/program-fixture.test.ts': [
      "import { spawnSync } from 'node:child_process';",
      "import { test } from 'bun:test';",
      "import path from 'node:path';",
      "test.skipIf(process.platform !== 'win32')('program', () => {",
      "  const program = path.resolve(import.meta.dir, '../../src/compiler/observed-fixture.ts');",
      "  spawnSync(process.execPath, [program]);",
      "});"
    ].join('\n')
  });
  expect(projection.observedTestConsumers).toEqual([{
    targetPath: 'src/compiler/observed-fixture.ts',
    testPath: 'tests/unit/observed-fixture.test.ts'
  }, {
    targetPath: 'src/compiler/observed-fixture.ts',
    testPath: 'tests/unit/program-fixture.test.ts'
  }]);

  const encoded = encodeTestImpactProjectionReceipt(projection);
  const outsideSnapshot = JSON.parse(encoded) as Record<string, unknown>;
  outsideSnapshot.observedTestConsumers = [{
    targetPath: 'src/compiler/absent.ts',
    testPath: 'tests/unit/observed-fixture.test.ts'
  }];
  const { projectionDigest: _discarded, ...unsigned } = outsideSnapshot;
  outsideSnapshot.projectionDigest = sha256(unsigned);
  expect(() => parseTestImpactProjectionReceipt(JSON.stringify(outsideSnapshot)))
    .toThrow('within its snapshot');
});

test('strict projection codec rejects ambiguity and parsed data cannot acquire process authority', () => {
  const { projection } = fixture({
    'src/compiler/codec-fixture.ts': 'export const codec = true;',
    'tests/unit/codec-fixture.test.ts': "import '../../src/compiler/codec-fixture.ts';"
  });
  const encoded = encodeTestImpactProjectionReceipt(projection);
  const parsed = parseTestImpactProjectionReceipt(encoded);
  expect(parsed).toEqual(projection);
  expect(() => assertIssuedTestImpactProjection(parsed)).toThrow('owner-issued');
  expect(() => parseTestImpactProjectionReceipt(
    encoded.replace('"schema":', '"schema":"duplicate","schema":')
  )).toThrow('duplicate key');

  const forged = JSON.parse(encoded) as Record<string, unknown>;
  forged.testObservationDigest = rawSha256('foreign-observation');
  const { projectionDigest: _discarded, ...unsigned } = forged;
  forged.projectionDigest = sha256(unsigned);
  const selfConsistentBytes = JSON.stringify(forged);
  const decodedForgery = parseTestImpactProjectionReceipt(selfConsistentBytes);
  expect(() => assertIssuedTestImpactProjection(decodedForgery)).toThrow('owner-issued');

  const unknown = JSON.parse(encoded) as Record<string, unknown>;
  unknown.unexpected = true;
  expect(() => parseTestImpactProjectionReceipt(JSON.stringify(unknown))).toThrow();
});

test('changed exact source bytes produce a different TestImpact projection identity', () => {
  const first = fixture({
    'src/compiler/change-fixture.ts': 'export const changed = 1;',
    'tests/unit/change-fixture.test.ts': "import '../../src/compiler/change-fixture.ts';"
  }).projection;
  const second = fixture({
    'src/compiler/change-fixture.ts': 'export const changed = 2;',
    'tests/unit/change-fixture.test.ts': "import '../../src/compiler/change-fixture.ts';"
  }).projection;
  expect(second.sourceRevision).not.toBe(first.sourceRevision);
  expect(second.snapshotDigest).not.toBe(first.snapshotDigest);
  expect(second.projectionDigest).not.toBe(first.projectionDigest);
});
