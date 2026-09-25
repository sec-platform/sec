import {
  canonicalJson,
  compareCodeUnits,
  isPlainObject,
  sha256
} from '../../../contracts/canonical.ts';
import { decodeExactUtf8 } from "../../../contracts/utf8.ts";
import { normalizeRepositoryModulePath } from '../architecture/contract.ts';
import type {
  SourceProgramCapabilityInvocation,
  SourceProgramDeclaration,
  SourceProgramEntrypoint,
  SourceProgramFile,
  SourceProgramLiteral,
  SourceProgramModel,
  SourceProgramReference,
  SourceProgramReturnProvenance,
  SourceProgramSpan,
  SourceProgramUnknown
} from './contract.ts';

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SHARD_KEYS = Object.freeze([
  'capabilities', 'compilerRevision', 'declarations', 'entrypoints', 'file',
  'literals', 'moduleDigest', 'path', 'providerRevision', 'rawFileDigest', 'semanticDependencyScope',
  'references', 'returnProvenances', 'schemaDigest', 'shardDigest', 'unknowns'
]);
const ENUMS = Object.freeze({
  observationClass: new Set(['observed', 'derived', 'unknown']),
  surface: new Set(['production', 'test', 'fixture', 'workflow', 'resource']),
  semanticKind: new Set(['pure-reexport', 'declaration-owner', 'executable', 'unknown']),
  referenceKind: new Set(['reference', 'import', 'reexport', 'call', 'construct']),
  referenceSourceRelation: new Set(['declaration', 'module-initialization']),
  literalContext: new Set(['producer', 'reader', 'argument', 'assertion', 'literal']),
  entrypointKind: new Set(['package-script', 'package-bin', 'cli-command', 'module-entrypoint', 'git-hook', 'workflow']),
  capability: new Set(['process', 'filesystem', 'network', 'dynamic-code', 'provider']),
  transport: new Set(['native-runtime', 'repository-provider', 'runtime-built-in-api', 'package-api', 'unknown'])
});

const SOURCE_PROGRAM_TYPESCRIPT_FACT_SHARD_SCHEMA = Object.freeze({
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
    'returnProvenances',
    'unknowns'
  ]),
  capabilitySource: 'compiler-issued-owning-declaration-observation',
  invalidation: 'typescript-owner-semantic-dependency-scope',
  referenceSource: 'compiler-issued-declaration-or-module-initialization',
  surfaceCoverage: 'production-and-test-with-production-projections-filtered',
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
  readonly semanticDependencyScope: 'module-scoped' | 'global-or-ambient' | 'unknown';
  readonly path: string;
  readonly file: SourceProgramFile;
  readonly declarations: readonly SourceProgramDeclaration[];
  readonly references: readonly SourceProgramReference[];
  readonly returnProvenances: readonly SourceProgramReturnProvenance[];
  readonly literals: readonly SourceProgramLiteral[];
  readonly entrypoints: readonly SourceProgramEntrypoint[];
  readonly capabilities: readonly SourceProgramCapabilityInvocation[];
  readonly unknowns: readonly SourceProgramUnknown[];
  readonly shardDigest: string;
}

type ShardFacts = Omit<TypeScriptSourceProgramFactShard,
  'compilerRevision' | 'moduleDigest' | 'providerRevision' | 'rawFileDigest'
  | 'schemaDigest' | 'semanticDependencyScope' | 'shardDigest'>;

function exactObject(
  value: unknown,
  keys: readonly string[],
  label: string
): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error(`${label} must be one exact object`);
  const actual = Object.keys(value).sort(compareCodeUnits);
  const expected = [...keys].sort(compareCodeUnits);
  if (actual.length !== expected.length
      || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has noncanonical keys`);
  }
}

function exactString(value: unknown, label: string, nullable = false): asserts value is string | null {
  if ((nullable && value === null) || (typeof value === 'string' && value.length > 0)) return;
  throw new Error(`${label} must be ${nullable ? 'null or ' : ''}non-empty text`);
}

/** Exact observed text whose empty value is semantically distinct from absence. */
function exactText(value: unknown, label: string, nullable = false): asserts value is string | null {
  if ((nullable && value === null) || typeof value === 'string') return;
  throw new Error(`${label} must be ${nullable ? 'null or ' : ''}text`);
}

function exactDigest(value: unknown, label: string, nullable = false): asserts value is string | null {
  if ((nullable && value === null) || (typeof value === 'string' && DIGEST.test(value))) return;
  throw new Error(`${label} must be ${nullable ? 'null or ' : ''}an exact digest`);
}

function exactStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be a text array`);
  }
}

function exactEnum(value: unknown, values: ReadonlySet<string>, label: string): asserts value is string {
  if (typeof value !== 'string' || !values.has(value)) throw new Error(`${label} is invalid`);
}

function exactSpan(value: unknown, label: string, nullable = false): void {
  if (nullable && value === null) return;
  exactObject(value, ['start', 'end', 'startLine', 'startColumn', 'endLine', 'endColumn'], label);
  for (const key of ['start', 'end', 'startLine', 'startColumn', 'endLine', 'endColumn']) {
    const number = value[key];
    if (!Number.isSafeInteger(number) || (number as number) < 0) {
      throw new Error(`${label}.${key} must be a non-negative safe integer`);
    }
  }
  if ((value.start as number) > (value.end as number)) throw new Error(`${label} is reversed`);
}

const MAX_RETURN_PROVENANCE_VALUES = 32;
const MAX_RETURN_PROVENANCE_ARGUMENTS = 32;
const MAX_RETURN_PROVENANCE_ARGUMENT_VALUES = 8;

function exactReturnArgumentProvenance(value: unknown, label: string): void {
  if (!isPlainObject(value) || typeof value.kind !== 'string') {
    throw new Error(`${label} must be one return argument provenance value`);
  }
  if (value.kind === 'parameter') {
    exactObject(value, ['index', 'kind'], label);
    if (!Number.isSafeInteger(value.index) || (value.index as number) < 0) {
      throw new Error(`${label}.index must be a non-negative safe integer`);
    }
    return;
  }
  if (value.kind === 'literal' || value.kind === 'opaque') {
    exactObject(value, ['kind'], label);
    return;
  }
  throw new Error(`${label}.kind is invalid`);
}

function exactReturnValueProvenance(value: unknown, label: string): void {
  if (isPlainObject(value) && value.kind === 'call-result') {
    exactObject(value, ['arguments', 'kind', 'targetObservationId'], label);
    exactDigest(value.targetObservationId, `${label}.targetObservationId`);
    if (!Array.isArray(value.arguments)
        || value.arguments.length > MAX_RETURN_PROVENANCE_ARGUMENTS) {
      throw new Error(`${label}.arguments exceeds the bounded provenance grammar`);
    }
    value.arguments.forEach((argument, argumentIndex) => {
      if (!Array.isArray(argument)
          || argument.length === 0
          || argument.length > MAX_RETURN_PROVENANCE_ARGUMENT_VALUES) {
        throw new Error(
          `${label}.arguments[${argumentIndex}] exceeds the bounded provenance grammar`
        );
      }
      argument.forEach((item, itemIndex) => exactReturnArgumentProvenance(
        item,
        `${label}.arguments[${argumentIndex}][${itemIndex}]`
      ));
    });
    return;
  }
  exactReturnArgumentProvenance(value, label);
}

function exactShardFacts(value: Record<string, unknown>): void {
  exactObject(value.file, [
    'contentDigest', 'moduleId', 'path', 'semanticKind',
    'semanticObservationClass', 'surface'
  ], 'TypeScript fact shard file');
  exactString(value.file.path, 'TypeScript fact shard file path');
  exactDigest(value.file.contentDigest, 'TypeScript fact shard file content digest');
  exactString(value.file.moduleId, 'TypeScript fact shard file module', true);
  exactEnum(value.file.surface, ENUMS.surface, 'TypeScript fact shard file surface');
  exactEnum(value.file.semanticKind, ENUMS.semanticKind, 'TypeScript fact shard file semantic kind');
  exactEnum(value.file.semanticObservationClass, ENUMS.observationClass, 'TypeScript fact shard file observation class');

  const collection = (name: string, keys: readonly string[], validate: (entry: Record<string, unknown>, index: number) => void): void => {
    const values = value[name];
    if (!Array.isArray(values)) throw new Error(`TypeScript fact shard ${name} must be an array`);
    values.forEach((entry, index) => {
      exactObject(entry, keys, `TypeScript fact shard ${name}[${index}]`);
      validate(entry, index);
    });
  };
  collection('declarations', [
    'declarationDigest', 'exported', 'kind', 'moduleId', 'name',
    'observationId', 'path', 'span'
  ], (entry, index) => {
    exactDigest(entry.declarationDigest, `declarations[${index}].declarationDigest`);
    exactDigest(entry.observationId, `declarations[${index}].observationId`);
    exactString(entry.path, `declarations[${index}].path`);
    exactString(entry.moduleId, `declarations[${index}].moduleId`, true);
    exactString(entry.name, `declarations[${index}].name`);
    exactString(entry.kind, `declarations[${index}].kind`);
    if (typeof entry.exported !== 'boolean') throw new Error(`declarations[${index}].exported must be boolean`);
    exactSpan(entry.span, `declarations[${index}].span`);
  });
  collection('references', [
    'kind', 'moduleSpecifier', 'name', 'observationClass', 'path', 'span',
    'sourceObservationId', 'sourceRelation', 'targetObservationId', 'targetPath'
  ], (entry, index) => {
    exactString(entry.path, `references[${index}].path`);
    exactEnum(entry.kind, ENUMS.referenceKind, `references[${index}].kind`);
    exactString(entry.name, `references[${index}].name`);
    exactText(entry.moduleSpecifier, `references[${index}].moduleSpecifier`, true);
    exactDigest(entry.sourceObservationId, `references[${index}].sourceObservationId`, true);
    exactEnum(
      entry.sourceRelation,
      ENUMS.referenceSourceRelation,
      `references[${index}].sourceRelation`
    );
    exactDigest(entry.targetObservationId, `references[${index}].targetObservationId`, true);
    exactString(entry.targetPath, `references[${index}].targetPath`, true);
    exactEnum(entry.observationClass, ENUMS.observationClass, `references[${index}].observationClass`);
    exactSpan(entry.span, `references[${index}].span`);
  });
  collection('returnProvenances', [
    'declarationObservationId', 'normalReturns', 'path'
  ], (entry, index) => {
    exactString(entry.path, `returnProvenances[${index}].path`);
    exactDigest(
      entry.declarationObservationId,
      `returnProvenances[${index}].declarationObservationId`
    );
    if (!Array.isArray(entry.normalReturns)
        || entry.normalReturns.length > MAX_RETURN_PROVENANCE_VALUES) {
      throw new Error(
        `returnProvenances[${index}].normalReturns exceeds the bounded provenance grammar`
      );
    }
    entry.normalReturns.forEach((value, valueIndex) => exactReturnValueProvenance(
      value,
      `returnProvenances[${index}].normalReturns[${valueIndex}]`
    ));
  });
  collection('literals', ['context', 'contextSpan', 'path', 'span', 'value'], (entry, index) => {
    exactString(entry.path, `literals[${index}].path`);
    exactText(entry.value, `literals[${index}].value`);
    exactEnum(entry.context, ENUMS.literalContext, `literals[${index}].context`);
    exactSpan(entry.contextSpan, `literals[${index}].contextSpan`, true);
    exactSpan(entry.span, `literals[${index}].span`);
  });
  collection('entrypoints', [
    'command', 'kind', 'name', 'observationClass', 'observationId', 'path',
    'span', 'targetEntrypoints', 'targetPackages', 'targetPaths'
  ], (entry, index) => {
    exactDigest(entry.observationId, `entrypoints[${index}].observationId`);
    exactString(entry.path, `entrypoints[${index}].path`);
    exactEnum(entry.kind, ENUMS.entrypointKind, `entrypoints[${index}].kind`);
    exactString(entry.name, `entrypoints[${index}].name`);
    exactText(entry.command, `entrypoints[${index}].command`, true);
    exactStringArray(entry.targetEntrypoints, `entrypoints[${index}].targetEntrypoints`);
    exactStringArray(entry.targetPaths, `entrypoints[${index}].targetPaths`);
    exactStringArray(entry.targetPackages, `entrypoints[${index}].targetPackages`);
    exactEnum(entry.observationClass, ENUMS.observationClass, `entrypoints[${index}].observationClass`);
    exactSpan(entry.span, `entrypoints[${index}].span`, true);
  });
  collection('capabilities', [
    'capability', 'moduleId', 'moduleSpecifier', 'observationClass', 'observationId', 'operation',
    'owningDeclarationObservationId', 'path', 'providerCapability', 'providerModuleId', 'span', 'subject',
    'surface', 'transport'
  ], (entry, index) => {
    exactDigest(entry.observationId, `capabilities[${index}].observationId`);
    exactString(entry.path, `capabilities[${index}].path`);
    exactEnum(entry.surface, ENUMS.surface, `capabilities[${index}].surface`);
    exactEnum(entry.capability, ENUMS.capability, `capabilities[${index}].capability`);
    exactString(entry.operation, `capabilities[${index}].operation`);
    exactEnum(entry.transport, ENUMS.transport, `capabilities[${index}].transport`);
    exactEnum(entry.observationClass, ENUMS.observationClass, `capabilities[${index}].observationClass`);
    exactString(entry.moduleId, `capabilities[${index}].moduleId`, true);
    exactText(entry.subject, `capabilities[${index}].subject`, true);
    exactText(entry.moduleSpecifier, `capabilities[${index}].moduleSpecifier`, true);
    exactString(entry.providerCapability, `capabilities[${index}].providerCapability`, true);
    exactString(entry.providerModuleId, `capabilities[${index}].providerModuleId`, true);
    exactDigest(
      entry.owningDeclarationObservationId,
      `capabilities[${index}].owningDeclarationObservationId`,
      true
    );
    exactSpan(entry.span, `capabilities[${index}].span`);
  });
  collection('unknowns', ['code', 'detail', 'path', 'span'], (entry, index) => {
    exactString(entry.code, `unknowns[${index}].code`);
    exactString(entry.path, `unknowns[${index}].path`);
    exactText(entry.detail, `unknowns[${index}].detail`);
    exactSpan(entry.span, `unknowns[${index}].span`, true);
  });
}

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
  semanticDependencyScope: TypeScriptSourceProgramFactShard['semanticDependencyScope'];
  facts: ShardFacts;
}>): TypeScriptSourceProgramFactShard {
  const { facts } = input;
  if (![input.compilerRevision, input.providerRevision, input.rawFileDigest, input.moduleDigest]
    .every((digest) => DIGEST.test(digest))) {
    throw new Error(`TypeScript Source Program fact shard has invalid identity: ${facts.path}`);
  }
  if (!['module-scoped', 'global-or-ambient', 'unknown'].includes(input.semanticDependencyScope)) {
    throw new Error(`TypeScript Source Program fact shard has invalid semantic dependency scope: ${facts.path}`);
  }
  if (facts.file.path !== facts.path || ![
    facts.declarations,
    facts.references,
    facts.returnProvenances,
    facts.literals,
    facts.entrypoints,
    facts.capabilities,
    facts.unknowns
  ].every((values) => exactPath(facts.path, values))) {
    throw new Error(`TypeScript Source Program fact shard crosses file boundary: ${facts.path}`);
  }
  const declarationObservationIds = new Set(
    facts.declarations.map(({ observationId }) => observationId)
  );
  if (new Set(facts.returnProvenances.map(({ declarationObservationId }) => (
    declarationObservationId
  ))).size !== facts.returnProvenances.length
      || facts.returnProvenances.some(({ declarationObservationId }) => (
        !declarationObservationIds.has(declarationObservationId)
      ))) {
    throw new Error(
      `TypeScript Source Program return provenance is not bound to one shard declaration: ${facts.path}`
    );
  }
  const canonicalFacts = Object.freeze({
    path: facts.path,
    file: facts.file,
    declarations: Object.freeze([...facts.declarations].sort((left, right) =>
      sortByPathAndSpan(left, right) || compareCodeUnits(left.name, right.name))),
    references: Object.freeze([...facts.references].sort((left, right) =>
      sortByPathAndSpan(left, right) || compareCodeUnits(left.kind, right.kind))),
    returnProvenances: Object.freeze([...facts.returnProvenances].sort((left, right) =>
      compareCodeUnits(left.path, right.path)
      || compareCodeUnits(left.declarationObservationId, right.declarationObservationId))),
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
    semanticDependencyScope: input.semanticDependencyScope,
    ...canonicalFacts
  });
  return Object.freeze({
    ...canonical,
    shardDigest: sha256(canonical)
  });
}

export function encodeTypeScriptSourceProgramFactShard(
  shard: TypeScriptSourceProgramFactShard
): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalJson(shard)));
  // The parser proves these exact bytes equal its canonical, digest-bound
  // encoding. Keep that full validation, but do not serialize and allocate
  // an identical second byte buffer for every shard in the fact pack.
  parseTypeScriptSourceProgramFactShard(bytes);
  return bytes;
}

export function parseTypeScriptSourceProgramFactShard(
  bytes: Uint8Array
): TypeScriptSourceProgramFactShard {
  const source = decodeExactUtf8(bytes, 'TypeScript Source Program fact shard');
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error('TypeScript Source Program fact shard is not exact JSON', { cause: error });
  }
  exactObject(parsed, SHARD_KEYS, 'TypeScript Source Program fact shard');
  for (const key of [
    'schemaDigest', 'compilerRevision', 'providerRevision', 'rawFileDigest',
    'moduleDigest', 'shardDigest'
  ]) exactDigest(parsed[key], `TypeScript fact shard ${key}`);
  exactString(parsed.path, 'TypeScript fact shard path');
  exactEnum(
    parsed.semanticDependencyScope,
    new Set(['module-scoped', 'global-or-ambient', 'unknown']),
    'TypeScript fact shard semantic dependency scope'
  );
  if (normalizeRepositoryModulePath(parsed.path as string) !== parsed.path) {
    throw new Error('TypeScript fact shard path is not canonical');
  }
  exactShardFacts(parsed);
  const canonical = compileTypeScriptSourceProgramFactShard({
    compilerRevision: parsed.compilerRevision as string,
    providerRevision: parsed.providerRevision as string,
    rawFileDigest: parsed.rawFileDigest as string,
    moduleDigest: parsed.moduleDigest as string,
    semanticDependencyScope: parsed.semanticDependencyScope as TypeScriptSourceProgramFactShard['semanticDependencyScope'],
    facts: Object.freeze({
      path: parsed.path as string,
      file: parsed.file as unknown as SourceProgramFile,
      declarations: parsed.declarations as unknown as readonly SourceProgramDeclaration[],
      references: parsed.references as unknown as readonly SourceProgramReference[],
      returnProvenances: parsed.returnProvenances as unknown as readonly SourceProgramReturnProvenance[],
      literals: parsed.literals as unknown as readonly SourceProgramLiteral[],
      entrypoints: parsed.entrypoints as unknown as readonly SourceProgramEntrypoint[],
      capabilities: parsed.capabilities as unknown as readonly SourceProgramCapabilityInvocation[],
      unknowns: parsed.unknowns as unknown as readonly SourceProgramUnknown[]
    })
  });
  if (parsed.schemaDigest !== SOURCE_PROGRAM_TYPESCRIPT_FACT_SHARD_SCHEMA_DIGEST
      || parsed.shardDigest !== canonical.shardDigest
      || source !== JSON.stringify(canonicalJson(canonical))) {
    throw new Error('TypeScript Source Program fact shard is not canonical or digest-bound');
  }
  return canonical;
}

const EMPTY_COMPONENT = Object.freeze([]);
const EMPTY_COMPONENT_DIGEST = sha256(EMPTY_COMPONENT);

export function assembleTypeScriptModel(input: Readonly<{
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
      packages: EMPTY_COMPONENT_DIGEST
    })
  });
  return Object.freeze({
    sourceRevision: input.sourceRevision,
    providers,
    files: Object.freeze(shards.map(({ file }) => file)),
    declarations: Object.freeze(shards.flatMap(({ declarations }) => declarations)),
    references: Object.freeze(shards.flatMap(({ references }) => references)),
    returnProvenances: Object.freeze(shards.flatMap(({ returnProvenances }) => returnProvenances)),
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
