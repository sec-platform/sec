import { expect, test } from 'bun:test';

import { rawSha256 } from '../../../contracts/canonical.ts';
import { compileRepositoryModuleMembershipSnapshot } from '../architecture/contract.ts';
import { compileSourceProgramDeclarationTopology } from './declaration-topology.ts';
import { compileVirtualRepositorySourceProgramCompilation } from './repository-compilation.ts';
import { compileVirtualSnapshot } from './workspace-source-snapshot.ts';

function compileFixture(sources: Readonly<Record<string, string>>) {
  const descriptorPath = 'src/example/module.json';
  const files = Object.entries(sources).map(([repositoryPath, source]) => ({
    path: repositoryPath,
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
        operationObligations: [],
        causalRelations: [],
        preDependencyBootstrap: false
      })
    }]
  });
  const sourceRevision = rawSha256(JSON.stringify([...files].sort((left, right) => (
    left.path.localeCompare(right.path, 'en-US')
  ))));
  const workspaceSnapshot = compileVirtualSnapshot({
    subject: {
      kind: 'virtual-mutation',
      provenance: {
        kind: 'source-program-virtual-mutation',
        baseSnapshotDigest: rawSha256('declaration-topology-base'),
        mutationDigest: sourceRevision
      }
    },
    files,
    moduleMembership
  });
  return compileVirtualRepositorySourceProgramCompilation({ workspaceSnapshot });
}

const cyclicSources = Object.freeze({
  'src/example/a.ts': [
    "import { b } from './b.ts';",
    'export function a(value: number): number {',
    '  return value <= 0 ? 0 : b(value - 1);',
    '}',
    ''
  ].join('\n'),
  'src/example/b.ts': [
    "import { a } from './a.ts';",
    'export function b(value: number): number {',
    '  return value <= 0 ? 0 : a(value - 1);',
    '}',
    ''
  ].join('\n')
});

test('compiler-issued declaration attribution produces one exact cross-file topology', () => {
  const compilation = compileFixture(cyclicSources);
  const topology = compileSourceProgramDeclarationTopology(compilation);
  const cycle = topology.strongComponents.find(({ paths }) => (
    paths.includes('src/example/a.ts') && paths.includes('src/example/b.ts')
  ));

  expect(cycle?.paths).toEqual(['src/example/a.ts', 'src/example/b.ts']);
  expect(cycle?.declarationObservationIds).toHaveLength(2);
  expect(topology.edges.some(({ sourcePath, targetPath }) => (
    sourcePath === 'src/example/a.ts' && targetPath === 'src/example/b.ts'
  ))).toBeTrue();
  expect(topology.edges.some(({ sourcePath, targetPath }) => (
    sourcePath === 'src/example/b.ts' && targetPath === 'src/example/a.ts'
  ))).toBeTrue();
  expect(topology.unknowns.some(({ code }) => code === 'module-initialization-relation')).toBeTrue();
  expect(topology.topologyDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
});

test('topology rejects structural receipt copies and remains deterministic across input order', () => {
  const first = compileFixture(cyclicSources);
  const reversed = compileFixture(Object.freeze({
    'src/example/b.ts': cyclicSources['src/example/b.ts'],
    'src/example/a.ts': cyclicSources['src/example/a.ts']
  }));

  expect(compileSourceProgramDeclarationTopology(first).topologyDigest)
    .toBe(compileSourceProgramDeclarationTopology(reversed).topologyDigest);
  expect(() => compileSourceProgramDeclarationTopology(Object.freeze({ ...first })))
    .toThrow('requires one compiler-issued compilation receipt');
});
