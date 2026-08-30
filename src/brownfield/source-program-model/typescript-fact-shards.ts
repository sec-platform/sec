import { compareCodeUnits, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import type {
  SourceProgramCapabilityInvocation,
  SourceProgramDeclaration,
  SourceProgramEntrypoint,
  SourceProgramFile,
  SourceProgramLiteral,
  SourceProgramModel,
  SourceProgramReference,
  SourceProgramSpan,
  SourceProgramUnknown
} from './contract.ts';

const DIGEST = /^sha256:[0-9a-f]{64}$/u;

export const SOURCE_PROGRAM_TYPESCRIPT_FACT_SHARD_SCHEMA = Object.freeze({
  identity: 'typescript-source-program-file-semantic-facts',
  bindings: Object.freeze([
    'compilerRevision',
    'moduleDigest',
    'providerRevision',
    'rawFileDigest'
  ]),
  factCollections: Object.freeze([
    'capabilities',
    'declarations',
    'entrypoints',
    'literals',
    'references',
    'unknowns'
  ]),
  root: 'ordered-content-addressed-shards'
});

export const SOURCE_PROGRAM_TYPESCRIPT_FACT_SHARD_SCHEMA_DIGEST =
  sha256(SOURCE_PROGRAM_TYPESCRIPT_FACT_SHARD_SCHEMA);

export interface TypeScriptSourceProgramFactShard {
  readonly schemaDigest: string;
  readonly compilerRevision: string;
  readonly providerRevision: string;
  readonly rawFileDigest: string;
  readonly moduleDigest: string;
  readonly path: string;
  readonly file: SourceProgramFile;
  readonly declarations: readonly SourceProgramDeclaration[];
  readonly references: readonly SourceProgramReference[];
  readonly literals: readonly SourceProgramLiteral[];
  readonly entrypoints: readonly SourceProgramEntrypoint[];
  readonly capabilities: readonly SourceProgramCapabilityInvocation[];
  readonly unknowns: readonly SourceProgramUnknown[];
  readonly shardDigest: string;
}

type ShardFacts = Omit<TypeScriptSourceProgramFactShard,
  'compilerRevision' | 'moduleDigest' | 'providerRevision' | 'rawFileDigest'
  | 'schemaDigest' | 'shardDigest'>;

function sortByPathAndSpan<
  Value extends { readonly path: string; readonly span?: SourceProgramSpan | null }
>(left: Value, right: Value): number {
  return compareCodeUnits(left.path, right.path)
    || (left.span?.start ?? -1) - (right.span?.start ?? -1)
    || (left.span?.end ?? -1) - (right.span?.end ?? -1);
}

function exactPath(path: string, values: readonly { readonly path: string }[]): boolean {
  return values.every((value) => value.path === path);
}

export function compileTypeScriptSourceProgramFactShard(input: Readonly<{
  compilerRevision: string;
  providerRevision: string;
  rawFileDigest: string;
  moduleDigest: string;
  facts: ShardFacts;
}>): TypeScriptSourceProgramFactShard {
  const { facts } = input;
  if (![input.compilerRevision, input.providerRevision, input.rawFileDigest, input.moduleDigest]
    .every((digest) => DIGEST.test(digest))) {
    throw new Error(`TypeScript Source Program fact shard has invalid identity: ${facts.path}`);
  }
  if (facts.file.path !== facts.path || ![
    facts.declarations,
    facts.references,
    facts.literals,
    facts.entrypoints,
    facts.capabilities,
    facts.unknowns
  ].every((values) => exactPath(facts.path, values))) {
    throw new Error(`TypeScript Source Program fact shard crosses file boundary: ${facts.path}`);
  }
  const canonicalFacts = Object.freeze({
    path: facts.path,
    file: facts.file,
    declarations: Object.freeze([...facts.declarations].sort((left, right) =>
      sortByPathAndSpan(left, right) || compareCodeUnits(left.name, right.name))),
    references: Object.freeze([...facts.references].sort((left, right) =>
      sortByPathAndSpan(left, right) || compareCodeUnits(left.kind, right.kind))),
    literals: Object.freeze([...facts.literals].sort((left, right) =>
      sortByPathAndSpan(left, right) || compareCodeUnits(left.value, right.value))),
    entrypoints: Object.freeze([...facts.entrypoints].sort((left, right) =>
      sortByPathAndSpan(left, right) || compareCodeUnits(left.name, right.name))),
    capabilities: Object.freeze([...facts.capabilities].sort((left, right) =>
      sortByPathAndSpan(left, right) || compareCodeUnits(left.operation, right.operation))),
    unknowns: Object.freeze([...facts.unknowns].sort((left, right) =>
      sortByPathAndSpan(left, right) || compareCodeUnits(left.code, right.code)))
  });
  const canonical = Object.freeze({
    schemaDigest: SOURCE_PROGRAM_TYPESCRIPT_FACT_SHARD_SCHEMA_DIGEST,
    compilerRevision: input.compilerRevision,
    providerRevision: input.providerRevision,
    rawFileDigest: input.rawFileDigest,
    moduleDigest: input.moduleDigest,
    ...canonicalFacts
  });
  return Object.freeze({
    ...canonical,
    shardDigest: sha256(canonical)
  });
}

const EMPTY_COMPONENT = Object.freeze([]);
const EMPTY_COMPONENT_DIGEST = sha256(EMPTY_COMPONENT);

export function assembleTypeScriptSourceProgramModel(input: Readonly<{
  sourceRevision: string;
  compilerRevision: string;
  provider: Readonly<{ readonly id: string; readonly revision: string }>;
  shards: readonly TypeScriptSourceProgramFactShard[];
}>): SourceProgramModel {
  if (input.sourceRevision.trim().length === 0 || !DIGEST.test(input.compilerRevision)) {
    throw new Error('TypeScript Source Program root identity is invalid');
  }
  const providerRevision = sha256(input.provider);
  const shards = [...input.shards].sort((left, right) => compareCodeUnits(left.path, right.path));
  if (new Set(shards.map(({ path }) => path)).size !== shards.length
      || shards.some((shard) => shard.schemaDigest !== SOURCE_PROGRAM_TYPESCRIPT_FACT_SHARD_SCHEMA_DIGEST
        || shard.compilerRevision !== input.compilerRevision
        || shard.providerRevision !== providerRevision)) {
    throw new Error('TypeScript Source Program root contains incompatible fact shards');
  }
  const providers = Object.freeze([input.provider]);
  const rootIdentity = Object.freeze({
    schemaDigest: SOURCE_PROGRAM_TYPESCRIPT_FACT_SHARD_SCHEMA_DIGEST,
    sourceRevision: input.sourceRevision,
    compilerRevision: input.compilerRevision,
    providerDigest: sha256(providers),
    shardDigests: Object.freeze(shards.map(({ shardDigest }) => shardDigest)),
    componentDigests: Object.freeze({
      candidates: EMPTY_COMPONENT_DIGEST,
      dependencies: EMPTY_COMPONENT_DIGEST,
      entrypointClosures: EMPTY_COMPONENT_DIGEST,
      moduleRoles: EMPTY_COMPONENT_DIGEST,
      packages: EMPTY_COMPONENT_DIGEST
    })
  });
  return Object.freeze({
    sourceRevision: input.sourceRevision,
    providers,
    files: Object.freeze(shards.map(({ file }) => file)),
    moduleRoles: EMPTY_COMPONENT,
    declarations: Object.freeze(shards.flatMap(({ declarations }) => declarations)),
    references: Object.freeze(shards.flatMap(({ references }) => references)),
    literals: Object.freeze(shards.flatMap(({ literals }) => literals)),
    entrypoints: Object.freeze(shards.flatMap(({ entrypoints }) => entrypoints)),
    entrypointClosures: EMPTY_COMPONENT,
    packages: EMPTY_COMPONENT,
    dependencies: EMPTY_COMPONENT,
    capabilities: Object.freeze(shards.flatMap(({ capabilities }) => capabilities)),
    candidates: EMPTY_COMPONENT,
    unknowns: Object.freeze(shards.flatMap(({ unknowns }) => unknowns)),
    modelDigest: sha256(rootIdentity)
  });
}
