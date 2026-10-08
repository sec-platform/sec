import {
  compareCodeUnits,
  rawSha256,
  sha256
} from '../../../contracts/canonical.ts';
import type {
  RepositoryModuleGraph,
  RepositoryModuleGraphImport,
  RepositoryModuleGraphImportObservation
} from '../architecture/contract.ts';
import {
  normalizeRepositoryPath
} from '../architecture/contract.ts';
import type {
  SourceProgramCompilationOperation
} from './compilation-operation.ts';
import {
  resolveSourceProgramCompilationOperation
} from './compilation-operation.ts';
import type {
  SourceProgramFileInput
} from './contract.ts';
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
  typeScriptModuleImportFacts
} from './typescript-module-imports.ts';
import {
  compileExactTypeScriptProgram
} from './typescript-workspace.ts';

/** Canonical TypeScript module observation orchestration; graph assembly remains compiler-independent. */
export type SourceProgramRepositoryModuleGraphInput = Readonly<{
  readonly files: readonly string[];
  /** Return null when the exact snapshot has no bytes for the address. */
  readonly readSource: (moduleFile: string) => string | null;
  /** Non-TypeScript embedded-language facts issued by their own frontend. */
  readonly readEmbeddedLanguageImports?: (
    moduleFile: string,
    source: string
  ) => readonly RepositoryModuleGraphImport[];
  readonly unresolvedFiles?: readonly string[];
  readonly operation?: SourceProgramCompilationOperation;
}>;

/**
 * Source Program module-graph orchestration. Ordinary TypeScript/JavaScript
 * imports come from the process Language Service; embedded-language imports
 * come from their frontend. The pure assembler consumes both observations.
 */
export function compileSourceProgramRepositoryModuleGraph(
  input: SourceProgramRepositoryModuleGraphInput
): RepositoryModuleGraph {
  const operation = resolveSourceProgramCompilationOperation(input.operation);
  const files = Object.freeze([...new Set(input.files.map(normalizeRepositoryPath))]
    .sort(compareCodeUnits));
  const sourceByPath = new Map<string, string>();
  const unresolvedFiles = new Set((input.unresolvedFiles ?? []).map(normalizeRepositoryPath));
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
  if (input.readEmbeddedLanguageImports !== undefined) {
    for (const [repositoryPathValue, source] of sourceByPath) {
      if (SOURCE_EXTENSION.test(repositoryPathValue)) continue;
      try {
        imports.push(...input.readEmbeddedLanguageImports(repositoryPathValue, source).map((observation) => (
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
