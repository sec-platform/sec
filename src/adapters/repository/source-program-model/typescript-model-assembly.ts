import type {
  TypeScriptSourceProgramFactShard
} from './typescript-fact-shards.ts';
import {
  assembleTypeScriptModel,
  compileTypeScriptSourceProgramFactShard
} from './typescript-fact-shards.ts';
import type {
  SourceProgramCapabilityInvocation,
  SourceProgramCompilation,
  SourceProgramDeclaration,
  SourceProgramEntrypoint,
  SourceProgramFile,
  SourceProgramFileInput,
  SourceProgramLiteral,
  SourceProgramModel,
  SourceProgramReference,
  SourceProgramReturnProvenance,
  SourceProgramUnknown
} from './contract.ts';
import type {
  RepositoryModuleMembership
} from '../architecture/contract.ts';
import type {
  SourceProgramCompilationOperation
} from './compilation-operation.ts';
import {
  sourceProgramCompilationCheckpoint
} from './compilation-operation.ts';
import type {
  TypeScriptSourceProgramFileIdentity
} from './typescript-input.ts';
import {
  TYPESCRIPT_SOURCE_PROGRAM_COMPILER_REVISION,
  TYPESCRIPT_SOURCE_PROGRAM_PROVIDER,
  TYPESCRIPT_SOURCE_PROGRAM_PROVIDER_REVISION
} from './typescript-profile.ts';

/** Canonical model issuance, immutable fact packs and repository-compilation binding. */
const compiledTypeScriptModels = new WeakSet<object>();

const factShardsByModel = new WeakMap<object, readonly TypeScriptSourceProgramFactShard[]>();

const repositoryCompilationDigestByModel = new WeakMap<object, `sha256:${string}`>();

export function workspaceSnapshotIdentityForTypeScriptModel(
  model: SourceProgramModel
): `sha256:${string}` | null {
  return repositoryCompilationDigestByModel.get(model) ?? null;
}

export function bindTypeScriptModelToRepositoryCompilation(
  model: SourceProgramModel,
  context: SourceProgramCompilation | undefined
): SourceProgramModel {
  if (context !== undefined) {
    repositoryCompilationDigestByModel.set(model, context.identityDigest);
  }
  return model;
}

export function isCompiledTypeScriptModel(
  value: SourceProgramModel
): boolean {
  return compiledTypeScriptModels.has(value);
}

export function canonicalTypeScriptModel(input: Readonly<{
  sourceRevision: string;
  fileInputs: ReadonlyMap<string, SourceProgramFileInput>;
  sourceFileIdentities: ReadonlyMap<string, TypeScriptSourceProgramFileIdentity>;
  semanticDependencyScopes: ReadonlyMap<
    string,
    TypeScriptSourceProgramFactShard['semanticDependencyScope']
  >;
  moduleMembership: RepositoryModuleMembership;
  files: readonly SourceProgramFile[];
  declarations: readonly SourceProgramDeclaration[];
  references: readonly SourceProgramReference[];
  returnProvenances: readonly SourceProgramReturnProvenance[];
  literals: readonly SourceProgramLiteral[];
  entrypoints: readonly SourceProgramEntrypoint[];
  capabilities: readonly SourceProgramCapabilityInvocation[];
  unknowns: readonly SourceProgramUnknown[];
  operation: SourceProgramCompilationOperation;
}>): SourceProgramModel {
  const groupByPath = <Value extends { readonly path: string }>(
    values: readonly Value[]
  ): ReadonlyMap<string, readonly Value[]> => {
    const groups = new Map<string, Value[]>();
    for (const value of values) {
      const group = groups.get(value.path);
      if (group === undefined) groups.set(value.path, [value]);
      else group.push(value);
    }
    return groups;
  };
  const declarationsByPath = groupByPath(input.declarations);
  const referencesByPath = groupByPath(input.references);
  const returnProvenancesByPath = groupByPath(input.returnProvenances);
  const literalsByPath = groupByPath(input.literals);
  const entrypointsByPath = groupByPath(input.entrypoints);
  const capabilitiesByPath = groupByPath(input.capabilities);
  const unknownsByPath = groupByPath(input.unknowns);
  sourceProgramCompilationCheckpoint(input.operation, 'fact-shard-assembly', 'start');
  const shards = input.files.map((file) => {
    sourceProgramCompilationCheckpoint(input.operation, 'fact-shard-assembly');
    const fileInput = input.fileInputs.get(file.path);
    const fileIdentity = input.sourceFileIdentities.get(file.path);
    const semanticDependencyScope = input.semanticDependencyScopes.get(file.path);
    if (fileInput === undefined || fileIdentity === undefined
        || semanticDependencyScope === undefined) {
      throw new Error(`TypeScript Source Program fact shard lacks raw source: ${file.path}`);
    }
    return compileTypeScriptSourceProgramFactShard({
      compilerRevision: TYPESCRIPT_SOURCE_PROGRAM_COMPILER_REVISION,
      providerRevision: TYPESCRIPT_SOURCE_PROGRAM_PROVIDER_REVISION,
      rawFileDigest: fileIdentity.rawFileDigest,
      moduleDigest: fileIdentity.moduleDigest,
      semanticDependencyScope,
      facts: Object.freeze({
        path: file.path,
        file,
        declarations: declarationsByPath.get(file.path) ?? Object.freeze([]),
        references: referencesByPath.get(file.path) ?? Object.freeze([]),
        returnProvenances: returnProvenancesByPath.get(file.path) ?? Object.freeze([]),
        literals: literalsByPath.get(file.path) ?? Object.freeze([]),
        entrypoints: entrypointsByPath.get(file.path) ?? Object.freeze([]),
        capabilities: capabilitiesByPath.get(file.path) ?? Object.freeze([]),
        unknowns: unknownsByPath.get(file.path) ?? Object.freeze([])
      })
    });
  });
  const model = assembleTypeScriptModel({
    sourceRevision: input.sourceRevision,
    compilerRevision: TYPESCRIPT_SOURCE_PROGRAM_COMPILER_REVISION,
    provider: TYPESCRIPT_SOURCE_PROGRAM_PROVIDER,
    shards
  });
  compiledTypeScriptModels.add(model);
  factShardsByModel.set(model, Object.freeze(shards));
  sourceProgramCompilationCheckpoint(input.operation, 'fact-shard-assembly', 'complete');
  return model;
}

export function assembleCanonicalTypeScriptModel(
  sourceRevision: string,
  shards: readonly TypeScriptSourceProgramFactShard[]
): SourceProgramModel {
  const model = assembleTypeScriptModel({
    sourceRevision,
    compilerRevision: TYPESCRIPT_SOURCE_PROGRAM_COMPILER_REVISION,
    provider: TYPESCRIPT_SOURCE_PROGRAM_PROVIDER,
    shards
  });
  compiledTypeScriptModels.add(model);
  factShardsByModel.set(model, shards);
  return model;
}

export function readTypeScriptFactShards(model: SourceProgramModel): readonly TypeScriptSourceProgramFactShard[] | undefined {
  return factShardsByModel.get(model);
}
