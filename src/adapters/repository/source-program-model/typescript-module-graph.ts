import type {
  RepositoryModuleGraph,
  RepositoryModuleGraphImport,
  RepositoryModuleGraphImportObservation
} from '../architecture/contract.ts';
import {
  normalizeRepositoryModulePath
} from '../architecture/contract.ts';
import type {
  SourceProgramCompilationOperation
} from './compilation-operation.ts';
import {
  resolveSourceProgramCompilationOperation
} from './compilation-operation.ts';
import {
  compareCodeUnits,
  rawSha256,
  sha256
} from '../../../contracts/canonical.ts';
import type {
  SourceProgramFileInput
} from './contract.ts';
import {
  typeScriptModuleImportFacts
} from './typescript-module-imports.ts';
import {
  assembleRepositoryModuleGraph
} from './module-graph.ts';
import type {
  TypeScriptSourceProgramFileIdentity
} from './typescript-input.ts';
import {
  SOURCE_EXTENSION,
  sourceProgramFileSnapshotDigest
} from './typescript-input.ts';
import {
  compileExactTypeScriptProgram
} from './typescript-workspace.ts';

/** Canonical TypeScript module observation orchestration; graph assembly remains compiler-independent. */
export type RepositoryModuleGraphInput = Readonly<{
  readonly files: readonly string[];
  /** Return null when the exact snapshot has no bytes for the address. */
  readonly readSource: (moduleFile: string) => string | null;
  /** Non-TypeScript embedded-language facts issued by their own frontend. */
  readonly readImports?: (
    moduleFile: string,
    source: string
  ) => readonly RepositoryModuleGraphImport[];
  readonly unresolvedFiles?: readonly string[];
  readonly operation?: SourceProgramCompilationOperation;
}>;

/**
 * The only ordinary TypeScript/JavaScript module-graph frontend.  It reuses
 * the process Language Service and feeds typed observations to the pure graph
 * assembler; downstream consumers never parse source bytes themselves.
 */
export function compileRepositoryModuleGraph(
  input: RepositoryModuleGraphInput
): RepositoryModuleGraph {
  const operation = resolveSourceProgramCompilationOperation(input.operation);
  const files = Object.freeze([...new Set(input.files.map(normalizeRepositoryModulePath))]
    .sort(compareCodeUnits));
  const sourceByPath = new Map<string, string>();
  const unresolvedFiles = new Set((input.unresolvedFiles ?? []).map(normalizeRepositoryModulePath));
  for (const repositoryPathValue of files) {
    const source = input.readSource(repositoryPathValue);
    if (source === null) unresolvedFiles.add(repositoryPathValue);
    else sourceByPath.set(repositoryPathValue, source);
  }
  const typeScriptFiles = new Map<string, SourceProgramFileInput>();
  const identities = new Map<string, TypeScriptSourceProgramFileIdentity>();
  for (const [repositoryPathValue, source] of sourceByPath) {
    if (!SOURCE_EXTENSION.test(repositoryPathValue)) continue;
    const contentDigest = rawSha256(source) as `sha256:${string}`;
    const file = Object.freeze({ path: repositoryPathValue, source, contentDigest });
    typeScriptFiles.set(repositoryPathValue, file);
    identities.set(repositoryPathValue, Object.freeze({
      file,
      moduleDigest: sha256(null) as `sha256:${string}`,
      rawFileDigest: sourceProgramFileSnapshotDigest(file, contentDigest)
    }));
  }
  const imports: RepositoryModuleGraphImportObservation[] = [];
  if (typeScriptFiles.size > 0) {
    const observations = typeScriptModuleImportFacts(
      compileExactTypeScriptProgram(typeScriptFiles, identities, operation)
    );
    imports.push(...observations.imports);
    for (const file of observations.unresolvedFiles) unresolvedFiles.add(file);
  }
  if (input.readImports !== undefined) {
    for (const [repositoryPathValue, source] of sourceByPath) {
      if (SOURCE_EXTENSION.test(repositoryPathValue)) continue;
      try {
        imports.push(...input.readImports(repositoryPathValue, source).map((observation) => (
          Object.freeze({ ...observation, from: repositoryPathValue })
        )));
      } catch {
        unresolvedFiles.add(repositoryPathValue);
      }
    }
  }
  return assembleRepositoryModuleGraph({
    files,
    imports: Object.freeze(imports),
    unresolvedFiles: Object.freeze([...unresolvedFiles])
  });
}
