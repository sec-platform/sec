import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import nodePath from 'node:path';

import { compileSourceProgramRepositoryModuleGraph } from '../source-program-model/source-program-module-graph.ts';
import {
  CANONICAL_SOURCE_MODULES,
  CANONICAL_STATIC_DEPENDENCIES,
  collectCanonicalSourceBoundaryViolations,
  collectRepositoryModuleBoundaryViolations,
  compileRepositoryModuleMembership,
  compileRepositoryModuleTopologyProjection,
  parseRepositoryModuleDescriptor,
  type CanonicalSourceModule,
  type RepositoryModuleMembership
} from './contract.ts';

const descriptor = parseRepositoryModuleDescriptor({
  importGraph: 'runtime',
  externalEntrypoints: []
}, 'src/policy-observation/module.json');

const membership: RepositoryModuleMembership = {
  descriptors: [descriptor],
  graphRoots: ['src'],
  moduleRoots: [descriptor.root],
  moduleForPath: () => descriptor
};

function importSpecifier(from: string, to: string): string {
  const relative = nodePath.posix.relative(nodePath.posix.dirname(from), to);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function violationsForEdge([from, to]: readonly [from: string, to: string]) {
  const graph = compileSourceProgramRepositoryModuleGraph({
    files: [from, to],
    readSource: (path) => path === from
      ? `import ${JSON.stringify(importSpecifier(from, to))};`
      : 'export {};'
  });
  return collectCanonicalSourceBoundaryViolations(graph);
}

const samplePath = (owner: CanonicalSourceModule): string =>
  `src/${owner}/__architecture_policy_fixture__.ts`;

test('canonical source roots enforce their declared static dependency policy', () => {
  const modules = [...CANONICAL_SOURCE_MODULES];
  expect(modules).toEqual([
    'contracts', 'workspace', 'semantics', 'compiler', 'assurance',
    'application', 'execution', 'adapters', 'entry', 'bootstrap'
  ]);

  for (const from of modules) {
    for (const to of modules) {
      if (from === to) continue;
      const violations = violationsForEdge([samplePath(from), samplePath(to)]);
      const allowed = (CANONICAL_STATIC_DEPENDENCIES[from] as readonly CanonicalSourceModule[]).includes(to);
      if (allowed) {
        expect(violations, `${from} -> ${to}`).not.toContainEqual(
          expect.objectContaining({ code: 'canonical-module-dependency' })
        );
      } else {
        expect(violations, `${from} -> ${to}`).toContainEqual(
          expect.objectContaining({ code: 'canonical-module-dependency' })
        );
      }
    }
  }
});

test('the tracked source tree has exactly the ten canonical responsibilities', () => {
  const repositoryRoot = nodePath.resolve(import.meta.dir, '../../../..');
  const actual = readdirSync(nodePath.join(repositoryRoot, 'src'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  expect(actual).toEqual([...CANONICAL_SOURCE_MODULES].sort());
});

test('the actual current source graph preserves canonical edges and acyclic source-program, generated-state, verification and GitHub owners', () => {
  const repositoryRoot = nodePath.resolve(import.meta.dir, '../../../..');
  const sourceRoot = nodePath.join(repositoryRoot, 'src');
  const files: string[] = [];
  const pending = [sourceRoot];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = nodePath.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolute);
      } else if (/\.(?:[cm]?[jt]s|[jt]sx)$/iu.test(entry.name)) {
        files.push(nodePath.relative(repositoryRoot, absolute).replaceAll('\\', '/'));
      }
    }
  }
  files.sort();
  const graph = compileSourceProgramRepositoryModuleGraph({
    files,
    readSource: (repositoryPath) => readFileSync(nodePath.join(repositoryRoot, repositoryPath), 'utf8')
  });
  const membership = compileRepositoryModuleMembership(repositoryRoot);
  const violations = collectCanonicalSourceBoundaryViolations(graph, membership);
  const acyclicOwnerRoots = [
    'src/adapters/repository/source-program-model/',
    'src/adapters/runtime-state/generated-state/',
    'src/execution/generated-state/',
    'src/execution/verification/',
    'src/adapters/providers/github-api/'
  ];
  expect(compileRepositoryModuleTopologyProjection(graph, membership).fileStrongComponents.filter(component =>
    component.paths.some(repositoryPath => acyclicOwnerRoots.some(root => repositoryPath.startsWith(root)))
  )).toEqual([]);
  expect(violations.filter(({ code }) =>
    code === 'canonical-module-dependency' || code === 'noncanonical-source-root' || code === 'core-no-host-io'
  )).toEqual([]);
});

test('canonical repository graph still rejects unresolved local imports and circular source relations', () => {
  const unresolved = compileSourceProgramRepositoryModuleGraph({
    files: ['src/compiler/feature/source.ts'],
    readSource: () => "import './missing.ts';"
  });
  expect(collectRepositoryModuleBoundaryViolations(unresolved, membership))
    .toContainEqual(expect.objectContaining({
      code: 'no-unresolved-production-dependencies',
      from: 'src/compiler/feature/source.ts'
    }));

  const circular = compileSourceProgramRepositoryModuleGraph({
    files: ['src/compiler/feature/a.ts', 'src/compiler/feature/b.ts'],
    readSource: (path) => path.endsWith('/a.ts')
      ? "import './b.ts';"
      : "import './a.ts';"
  });
  expect(collectRepositoryModuleBoundaryViolations(circular, membership))
    .toContainEqual(expect.objectContaining({ code: 'repository-module-internal-cycle' }));
});

test('pure computation roots reject direct host IO imports, including type-only leakage', () => {
  for (const domain of ['contracts', 'workspace', 'semantics', 'compiler', 'assurance', 'application'] as const) {
    for (const specifier of ['node:fs', 'fs', 'node:fs/promises', 'node:child_process', 'node:net', 'node:worker_threads', 'bun:ffi']) {
      for (const prefix of ['import', 'import type']) {
        const source = `src/${domain}/example.ts`;
        const graph = compileSourceProgramRepositoryModuleGraph({
          files: [source],
          readSource: () => `${prefix} { HostHandle } from ${JSON.stringify(specifier)};`
        });
        expect(collectCanonicalSourceBoundaryViolations(graph))
          .toContainEqual(expect.objectContaining({ code: 'core-no-host-io', from: source, to: specifier }));
      }
    }
  }
  const source = 'src/contracts/canonical.ts';
  const graph = compileSourceProgramRepositoryModuleGraph({
    files: [source], readSource: () => "import { createHash } from 'node:crypto';"
  });
  expect(collectCanonicalSourceBoundaryViolations(graph))
    .not.toContainEqual(expect.objectContaining({ code: 'core-no-host-io' }));
});

test('fine-grained descriptor cycles stay diagnostic inside one canonical package', () => {
  const makeDescriptor = (root: string) => parseRepositoryModuleDescriptor({
    importGraph: 'runtime',
    externalEntrypoints: []
  }, `${root}/module.json`);
  const first = makeDescriptor('src/adapters/first');
  const second = makeDescriptor('src/adapters/second');
  const membership = {
    descriptors: [first, second],
    graphRoots: ['src/adapters'],
    moduleRoots: [first.root, second.root],
    moduleForPath: (file: string) => file.startsWith('src/adapters/first/') ? first : second
  };
  const graph = compileSourceProgramRepositoryModuleGraph({
    files: ['src/adapters/first/index.ts', 'src/adapters/second/index.ts'],
    readSource: (file) => file.includes('/first/')
      ? "import '../second/index.ts'; export const first = true;"
      : "import '../first/index.ts'; export const second = true;"
  });
  const topology = compileRepositoryModuleTopologyProjection(graph, membership);

  expect(topology.strongComponents).toHaveLength(1);
  expect(topology.violations.some(({ code }) => code === 'module-dependency-cycle')).toBe(false);
});
