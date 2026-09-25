import nodePath from 'node:path';

import { assertCanonicalPortableLogicalPath } from '../../../contracts/logical-path.ts';
import type {
  RepositoryModuleGraph, RepositoryModuleGraphImportObservation,
  RepositoryModuleGraphReference
} from '../architecture/contract.ts';
import {
  assertRepositoryModuleGraphPath,
  isTestOnlyRepositoryModulePath
} from '../architecture/contract.ts';

export type {

  RepositoryModuleGraph
} from '../architecture/contract.ts';

export type RepositoryModuleGraphCompileInput = Readonly<{
  /** Exact snapshot addresses. Semantic subject, owner and role are separate compiler facts. */
  readonly files: readonly string[];
  /** Compiler-issued facts from the same Source Program generation. */
  readonly imports: readonly RepositoryModuleGraphImportObservation[];
  readonly unresolvedFiles?: readonly string[];
}>;

function textOrder(left: string, right: string): number {
  return left.localeCompare(right, 'en-US');
}

function canonicalRepositoryPath(value: string): string {
  return assertRepositoryModuleGraphPath(
    assertCanonicalPortableLogicalPath(value, 'Repository program path')
  );
}

/**
 * Resolve lexical candidates without filesystem discovery. The exact Source
 * Program file set chooses the target; retained candidates make deletion and
 * rename impact observable even when the target no longer exists.
 */
export function resolveRepositoryModuleImportCandidates(
  sourcePath: string,
  specifier: string
): readonly string[] {
  if (!specifier.startsWith('.')) return Object.freeze([]);
  const base = nodePath.posix.join(nodePath.posix.dirname(sourcePath), specifier);
  if (!base || base === '.' || base === '..' || base.startsWith('../')) return Object.freeze([]);
  const extension = nodePath.posix.extname(base);
  const candidates = (() => {
    if (/^\.(?:[cm]?tsx?)$/u.test(extension)) return [base];
    if (/^\.(?:[cm]?jsx?)$/u.test(extension)) {
      const stem = base.slice(0, -extension.length);
      return [base, `${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`];
    }
    if (extension) return [base];
    return [
      `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.cts`,
      `${base}.js`, `${base}.jsx`, `${base}.mjs`, `${base}.cjs`,
      `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.mts`, `${base}/index.cts`
    ];
  })();
  // Candidate order is semantic resolver precedence, not presentation order.
  // Sorting here can select a lower-priority existing module and thereby bind
  // compiler symbols and runtime impact to the wrong file.
  return Object.freeze([...new Set(candidates.map(canonicalRepositoryPath))]);
}

/** Pure assembly of one module graph from compiler-issued observations. */
export function assembleRepositoryModuleGraph(
  input: RepositoryModuleGraphCompileInput
): RepositoryModuleGraph {
  const files = Object.freeze([...new Set(input.files.map(canonicalRepositoryPath))].sort(textOrder));
  const fileSet = new Set(files);
  const unresolvedFiles = new Set<string>(
    (input.unresolvedFiles ?? []).map(canonicalRepositoryPath)
  );
  const references: RepositoryModuleGraphReference[] = [];
  const reverseConsumers = new Map<string, Set<string>>();
  const forwardDependencies = new Map<string, Set<string>>();
  const runtimeForwardDependencies = new Map<string, Set<string>>();

  const importsByFile = new Map<string, RepositoryModuleGraphImportObservation[]>();
  for (const reference of input.imports) {
    const from = canonicalRepositoryPath(reference.from);
    if (!fileSet.has(from)) throw new Error(`module import is outside its exact file census: ${from}`);
    const imports = importsByFile.get(from) ?? [];
    imports.push(Object.freeze({ ...reference, from }));
    importsByFile.set(from, imports);
  }
  for (const moduleFile of files) {
    const imports = importsByFile.get(moduleFile) ?? Object.freeze([]);
    const uniqueImports = new Map<string, RepositoryModuleGraphImportObservation>();
    for (const reference of imports) {
      const key = `${reference.kind}\0${reference.specifier}`;
      const previous = uniqueImports.get(key);
      // Runtime membership is a union: a later type-only import must not erase
      // a value import of the same target. The result is input-order independent.
      if (previous === undefined || (previous.typeOnly && !reference.typeOnly)) {
        uniqueImports.set(key, reference);
      }
    }
    for (const reference of uniqueImports.values()) {
      const candidates = resolveRepositoryModuleImportCandidates(moduleFile, reference.specifier);
      const resolvedTarget = candidates.find((candidate) => fileSet.has(candidate)) ?? null;
      if (resolvedTarget !== null
          && isTestOnlyRepositoryModulePath(resolvedTarget)
          && !isTestOnlyRepositoryModulePath(moduleFile)) {
        throw new Error(
          `production repository module imports test-only module: ${moduleFile} -> ${resolvedTarget}`
        );
      }
      if (reference.specifier.startsWith('.') && resolvedTarget === null) {
        unresolvedFiles.add(moduleFile);
      }
      const graphReference = Object.freeze({
        from: reference.from,
        kind: reference.kind,
        specifier: reference.specifier,
        typeOnly: reference.typeOnly,
        candidateTargets: candidates,
        resolvedTarget
      });
      references.push(graphReference);
      if (resolvedTarget !== null) {
        const dependencies = forwardDependencies.get(moduleFile) ?? new Set<string>();
        dependencies.add(resolvedTarget);
        forwardDependencies.set(moduleFile, dependencies);
        if (!reference.typeOnly) {
          const runtimeDependencies = runtimeForwardDependencies.get(moduleFile) ?? new Set<string>();
          runtimeDependencies.add(resolvedTarget);
          runtimeForwardDependencies.set(moduleFile, runtimeDependencies);
        }
      }
      for (const candidate of candidates) {
        const consumers = reverseConsumers.get(candidate) ?? new Set<string>();
        consumers.add(moduleFile);
        reverseConsumers.set(candidate, consumers);
      }
    }
  }
  // Build canonical adjacency once. Repeated graph queries only copy the
  // frozen result; they no longer sort the same dependency sets every time.
  const sortedAdjacency = (index: ReadonlyMap<string, ReadonlySet<string>>) =>
    new Map([...index].map(([key, values]) => [key, Object.freeze([...values].sort(textOrder))] as const));
  const consumersByPath = sortedAdjacency(reverseConsumers);
  const dependenciesByPath = sortedAdjacency(forwardDependencies);
  const runtimeDependenciesByPath = sortedAdjacency(runtimeForwardDependencies);
  references.sort((left, right) => (
    textOrder(left.from, right.from)
    || textOrder(left.specifier, right.specifier)
    || textOrder(left.kind, right.kind)
  ));
  return Object.freeze({
    files,
    references: Object.freeze(references),
    unresolvedFiles: Object.freeze([...unresolvedFiles].sort(textOrder)),
    directConsumers: (modulePath) => Object.freeze([
      ...(consumersByPath.get(canonicalRepositoryPath(modulePath)) ?? [])
    ]),
    directDependencies: (modulePath) => Object.freeze([
      ...(dependenciesByPath.get(canonicalRepositoryPath(modulePath)) ?? [])
    ]),
    directRuntimeDependencies: (modulePath) => Object.freeze([
      ...(runtimeDependenciesByPath.get(canonicalRepositoryPath(modulePath)) ?? [])
    ])
  });
}
