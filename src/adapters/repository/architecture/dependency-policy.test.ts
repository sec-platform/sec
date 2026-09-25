import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import nodePath from 'node:path';
import ts from 'typescript';

import { compileRepositoryModuleGraph } from '../source-program-model/typescript.ts';
import {
  collectCanonicalSourceBoundaryViolations,
  collectRepositoryModuleBoundaryViolations,
  compileRepositoryModuleMembership,
  compileRepositoryModuleTopologyProjection,
  parseModuleDescriptor,
  CANONICAL_SOURCE_MODULES,
  CANONICAL_STATIC_DEPENDENCIES,
  type CanonicalSourceModule,
  type RepositoryModuleMembership
} from './contract.ts';

const descriptor = parseModuleDescriptor({
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
  const graph = compileRepositoryModuleGraph({
    files: [from, to],
    readSource: (path) => path === from
      ? `import ${JSON.stringify(importSpecifier(from, to))};`
      : 'export {};'
  });
  return collectCanonicalSourceBoundaryViolations(graph);
}

const samplePath = (owner: CanonicalSourceModule): string =>
  `src/${owner}/__architecture_policy_fixture__.ts`;

test('canonical source roots and the 33 static dependency edges are the exact SEC-086 package contract', () => {
  const modules = [...CANONICAL_SOURCE_MODULES];
  expect(modules).toEqual([
    'contracts', 'workspace', 'semantics', 'compiler', 'assurance',
    'application', 'execution', 'adapters', 'entry', 'bootstrap'
  ]);
  expect(Object.values(CANONICAL_STATIC_DEPENDENCIES).reduce((sum, deps) => sum + deps.length, 0)).toBe(33);

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

  const membership = compileRepositoryModuleMembership(repositoryRoot);
  expect(membership.descriptors.some(({ root }) => root.startsWith('src/control'))).toBe(false);
});

test('the actual current source graph has no forbidden canonical-module edge', () => {
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
  const graph = compileRepositoryModuleGraph({
    files,
    readSource: (repositoryPath) => readFileSync(nodePath.join(repositoryRoot, repositoryPath), 'utf8')
  });
  const violations = collectCanonicalSourceBoundaryViolations(
    graph,
    compileRepositoryModuleMembership(repositoryRoot)
  );
  expect(violations.filter(({ code }) =>
    code === 'canonical-module-dependency' || code === 'noncanonical-source-root' || code === 'core-no-host-io'
  )).toEqual([]);
});

test('canonical repository graph still rejects unresolved local imports and circular source relations', () => {
  const unresolved = compileRepositoryModuleGraph({
    files: ['src/compiler/feature/source.ts'],
    readSource: () => "import './missing.ts';"
  });
  expect(collectRepositoryModuleBoundaryViolations(unresolved, membership))
    .toContainEqual(expect.objectContaining({
      code: 'no-unresolved-production-dependencies',
      from: 'src/compiler/feature/source.ts'
    }));

  const circular = compileRepositoryModuleGraph({
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
        const graph = compileRepositoryModuleGraph({
          files: [source],
          readSource: () => `${prefix} { HostHandle } from ${JSON.stringify(specifier)};`
        });
        expect(collectCanonicalSourceBoundaryViolations(graph))
          .toContainEqual(expect.objectContaining({ code: 'core-no-host-io', from: source, to: specifier }));
      }
    }
  }
  const source = 'src/contracts/canonical.ts';
  const graph = compileRepositoryModuleGraph({
    files: [source], readSource: () => "import { createHash } from 'node:crypto';"
  });
  expect(collectCanonicalSourceBoundaryViolations(graph))
    .not.toContainEqual(expect.objectContaining({ code: 'core-no-host-io' }));
});

test('host SHA primitives have exactly two production owners: application digest and Git object identity', () => {
  const repositoryRoot = nodePath.resolve(import.meta.dir, '../../../..');
  const sourceRoot = nodePath.join(repositoryRoot, 'src');
  const allowedOwners = new Set([
    'src/contracts/digest.ts',
    'src/contracts/git-object-id.ts'
  ]);
  const owners: string[] = [];
  const pending = [sourceRoot];

  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = nodePath.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolute);
        continue;
      }
      if (!/\.(?:[cm]?[jt]s|[jt]sx)$/iu.test(entry.name) || /\.(?:test|spec)\.[cm]?[jt]sx?$/iu.test(entry.name)) {
        continue;
      }

      const repositoryPath = nodePath.relative(repositoryRoot, absolute).replaceAll('\\', '/');
      const source = readFileSync(absolute, 'utf8');
      const sourceFile = ts.createSourceFile(repositoryPath, source, ts.ScriptTarget.Latest, true);
      for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)
          || !ts.isStringLiteral(statement.moduleSpecifier)
          || statement.moduleSpecifier.text !== 'node:crypto') {
          continue;
        }
        const bindings = statement.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) continue;
        if (bindings.elements.some((element) => (element.propertyName ?? element.name).text === 'createHash')) {
          owners.push(repositoryPath);
        }
      }
    }
  }

  expect([...new Set(owners)].sort()).toEqual([...allowedOwners].sort());
});

test('fine-grained descriptor cycles stay diagnostic inside one canonical package', () => {
  const makeDescriptor = (root: string) => parseModuleDescriptor({
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
  const graph = compileRepositoryModuleGraph({
    files: ['src/adapters/first/index.ts', 'src/adapters/second/index.ts'],
    readSource: (file) => file.includes('/first/')
      ? "import '../second/index.ts'; export const first = true;"
      : "import '../first/index.ts'; export const second = true;"
  });
  const topology = compileRepositoryModuleTopologyProjection(graph, membership);

  expect(topology.strongComponents).toHaveLength(1);
  expect(topology.violations.some(({ code }) => code === 'module-dependency-cycle')).toBe(false);
});
