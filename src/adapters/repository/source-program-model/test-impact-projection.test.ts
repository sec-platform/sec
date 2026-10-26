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
import { compileVirtualWorkspaceSourceSnapshot } from './workspace-source-snapshot.ts';

const membership = compileRepositoryModuleMembership(path.resolve(import.meta.dir, '../../../..'));

function fixture(sources: Readonly<Record<string, string>>) {
  const sourceRevision = rawSha256(JSON.stringify(sources));
  const workspaceSnapshot = compileVirtualWorkspaceSourceSnapshot({
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

const projectionSources = {
  'src/compiler/projection-fixture.ts': 'export const fixture = 1;',
  'tests/unit/projection-fixture.test.ts': [
    "import { fixture } from '../../src/compiler/projection-fixture.ts';",
    'if (!fixture) throw new Error();'
  ].join('\n')
};

test('compact TestImpact projection retains exact bindings through its codec and distinguishes changed source bytes', () => {
  const { repositoryCompilation, projection } = fixture(projectionSources);
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

  const encoded = encodeTestImpactProjectionReceipt(projection);
  const parsed = parseTestImpactProjectionReceipt(encoded);
  expect(parsed).toEqual(projection);
  expect(() => assertIssuedTestImpactProjection(parsed)).toThrow('owner-issued');
  expect(() => parseTestImpactProjectionReceipt(
    encoded.replace('"schema":', '"schema":"duplicate","schema":')
  )).toThrow('duplicate key');

  const unknown = JSON.parse(encoded) as Record<string, unknown>;
  unknown.unexpected = true;
  expect(() => parseTestImpactProjectionReceipt(JSON.stringify(unknown))).toThrow();

  const changed = fixture({
    ...projectionSources,
    'src/compiler/projection-fixture.ts': 'export const fixture = 2;'
  }).projection;
  expect(changed.sourceRevision).not.toBe(projection.sourceRevision);
  expect(changed.snapshotDigest).not.toBe(projection.snapshotDigest);
  expect(changed.projectionDigest).not.toBe(projection.projectionDigest);
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
