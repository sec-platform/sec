import { sha256 } from '../../../contracts/canonical.ts';
import { isDigest } from '../../../contracts/digest.ts';

import type { TypeScriptSourceProgramFactShard } from './typescript-fact-shards.ts';
import {
  assertTypeScriptCompilerIdentity,
  type TypeScriptCompilerIdentity
} from './typescript.ts';

const GENERATION_KEYS = Object.freeze([
  'compilerConfigDigest', 'compilerRevision', 'dependencyGenerationDigest',
  'environmentDigest', 'generationDigest', 'moduleGraphDigest',
  'moduleMembershipDigest', 'orderedSourceFactsDigest', 'projectConfigDigest',
  'projectInputDigest', 'providerRevision', 'receiptDigest', 'snapshotDigest',
  'workspaceSnapshotIdentityDigest'
]);
const CACHE_RECEIPT_KEYS = Object.freeze([
  'cacheReceiptDigest', 'generationDigest', 'manifestDigest', 'packDigest'
]);
const GENERATION_SCHEMA_DIGEST = sha256(Object.freeze({
  identity: 'repository-source-program-semantic-generation',
  authority: 'source-program-model',
  cache: 'optional-nonauthoritative-content-addressed-hint',
  receiptGrammar: GENERATION_KEYS
})) as `sha256:${string}`;
const CACHE_SCHEMA = Object.freeze({
  identity: 'repository-source-program-compilation-generation-store',
  keyDimensions: Object.freeze(['source-program-semantic-generation']),
  publication: 'immutable-canonical-fact-pack-and-manifest-last',
  generationReceiptSchemaDigest: GENERATION_SCHEMA_DIGEST,
  semanticAuthority: 'none-cache-is-disposable-acceleration',
  scope: 'disposable-runtime-cache'
});

export interface RepositoryCompilationGenerationReceipt {
  readonly generationDigest: `sha256:${string}`;
  readonly projectInputDigest: `sha256:${string}` | null;
  readonly projectConfigDigest: `sha256:${string}` | null;
  readonly workspaceSnapshotIdentityDigest: `sha256:${string}`;
  readonly orderedSourceFactsDigest: `sha256:${string}`;
  readonly snapshotDigest: `sha256:${string}`;
  readonly moduleMembershipDigest: `sha256:${string}`;
  readonly moduleGraphDigest: `sha256:${string}`;
  readonly compilerRevision: `sha256:${string}`;
  readonly providerRevision: `sha256:${string}`;
  readonly compilerConfigDigest: `sha256:${string}`;
  readonly dependencyGenerationDigest: `sha256:${string}`;
  readonly environmentDigest: `sha256:${string}`;
  readonly receiptDigest: `sha256:${string}`;
}

export type IssueRepositoryCompilationGenerationInput = Readonly<{
  projectInputDigest: `sha256:${string}` | null;
  projectConfigDigest: `sha256:${string}` | null;
  workspaceSnapshotIdentityDigest: `sha256:${string}`;
  orderedSourceFactsDigest: `sha256:${string}`;
  snapshotDigest: `sha256:${string}`;
  moduleMembershipDigest: `sha256:${string}`;
  moduleGraphDigest: `sha256:${string}`;
  compiler: TypeScriptCompilerIdentity;
}>;

function generationDimensions(input: IssueRepositoryCompilationGenerationInput) {
  return Object.freeze({
    schemaDigest: GENERATION_SCHEMA_DIGEST,
    projectInputDigest: input.projectInputDigest,
    projectConfigDigest: input.projectConfigDigest,
    workspaceSnapshotIdentityDigest: input.workspaceSnapshotIdentityDigest,
    orderedSourceFactsDigest: input.orderedSourceFactsDigest,
    snapshotDigest: input.snapshotDigest,
    moduleMembershipDigest: input.moduleMembershipDigest,
    moduleGraphDigest: input.moduleGraphDigest,
    compilerRevision: input.compiler.compilerRevision,
    providerRevision: input.compiler.providerRevision,
    compilerConfigDigest: input.compiler.compilerConfigDigest,
    dependencyGenerationDigest: input.compiler.dependencyGenerationDigest,
    environmentDigest: input.compiler.environmentDigest
  });
}

export function issueRepositoryCompilationGenerationReceipt(
  input: IssueRepositoryCompilationGenerationInput
): RepositoryCompilationGenerationReceipt {
  assertTypeScriptCompilerIdentity(input.compiler);
  const dimensions = generationDimensions(input);
  const generationDigest = sha256(dimensions) as `sha256:${string}`;
  const { schemaDigest: _schemaDigest, ...receipt } = Object.freeze({
    ...dimensions,
    generationDigest
  });
  return Object.freeze({
    ...receipt,
    receiptDigest: sha256(receipt) as `sha256:${string}`
  });
}

export function assertRepositoryCompilationGenerationReceipt(
  receipt: RepositoryCompilationGenerationReceipt
): void {
  const actual = Object.keys(receipt).sort();
  const expected = [...GENERATION_KEYS].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error('Repository compilation semantic generation receipt has noncanonical keys');
  }
  for (const [key, value] of Object.entries(receipt)) {
    if ((key === 'projectInputDigest' || key === 'projectConfigDigest') && value === null) continue;
    if (!isDigest(value, 'sha256')) {
      throw new Error(`Semantic generation receipt ${key} is invalid`);
    }
  }
  if ((receipt.projectInputDigest === null) !== (receipt.projectConfigDigest === null)) {
    throw new Error('Repository compilation semantic generation project identity is partial');
  }
  const dimensions = Object.freeze({
    schemaDigest: GENERATION_SCHEMA_DIGEST,
    projectInputDigest: receipt.projectInputDigest,
    projectConfigDigest: receipt.projectConfigDigest,
    workspaceSnapshotIdentityDigest: receipt.workspaceSnapshotIdentityDigest,
    orderedSourceFactsDigest: receipt.orderedSourceFactsDigest,
    snapshotDigest: receipt.snapshotDigest,
    moduleMembershipDigest: receipt.moduleMembershipDigest,
    moduleGraphDigest: receipt.moduleGraphDigest,
    compilerRevision: receipt.compilerRevision,
    providerRevision: receipt.providerRevision,
    compilerConfigDigest: receipt.compilerConfigDigest,
    dependencyGenerationDigest: receipt.dependencyGenerationDigest,
    environmentDigest: receipt.environmentDigest
  });
  const { receiptDigest, ...unsigned } = receipt;
  if (receipt.generationDigest !== sha256(dimensions)
      || receiptDigest !== sha256(unsigned)) {
    throw new Error('Repository compilation semantic generation receipt is not digest-bound');
  }
}

export interface RepositoryCompilationCacheReceipt {
  readonly generationDigest: `sha256:${string}`;
  readonly packDigest: `sha256:${string}`;
  readonly manifestDigest: `sha256:${string}`;
  readonly cacheReceiptDigest: `sha256:${string}`;
}

function assertRepositoryCompilationCacheReceipt(
  receipt: RepositoryCompilationCacheReceipt,
  generation: RepositoryCompilationGenerationReceipt
): void {
  assertRepositoryCompilationGenerationReceipt(generation);
  const actual = Object.keys(receipt).sort();
  const expected = [...CACHE_RECEIPT_KEYS].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error('Repository compilation cache receipt has noncanonical keys');
  }
  for (const value of Object.values(receipt)) {
    if (!isDigest(value, 'sha256')) {
      throw new Error('Repository compilation cache receipt digest is invalid');
    }
  }
  const { cacheReceiptDigest, ...unsigned } = receipt;
  if (receipt.generationDigest !== generation.generationDigest
      || cacheReceiptDigest !== sha256(unsigned)) {
    throw new Error('Repository compilation cache receipt is not generation-bound');
  }
}

export interface RepositoryCompilationCacheDiagnostics {
  readonly physicalBytes: number;
  readonly semanticParseMs: number;
}

export type RepositoryCompilationCacheLoad = Readonly<{
  status: 'hit';
  keyDigest: `sha256:${string}`;
  generation: RepositoryCompilationGenerationReceipt;
  cacheReceipt: RepositoryCompilationCacheReceipt;
  shards: readonly TypeScriptSourceProgramFactShard[];
  diagnostics: RepositoryCompilationCacheDiagnostics;
}> | Readonly<{
  status: 'miss';
  keyDigest: `sha256:${string}`;
}>;

export function assertExactRepositoryCompilationCacheLoad(
  load: RepositoryCompilationCacheLoad,
  generation: RepositoryCompilationGenerationReceipt
): void {
  assertRepositoryCompilationGenerationReceipt(generation);
  if (load.keyDigest !== generation.generationDigest) {
    throw new Error('Repository compilation cache hint is not content-addressed by semantic generation');
  }
  if (load.status === 'hit') {
    assertRepositoryCompilationGenerationReceipt(load.generation);
    if (load.generation.receiptDigest !== generation.receiptDigest) {
      throw new Error('Repository compilation cache loaded a foreign semantic generation');
    }
    assertRepositoryCompilationCacheReceipt(load.cacheReceipt, generation);
  }
}

/** Optional acceleration for one exact Source Program semantic generation. */
export interface RepositoryCompilationCacheHint {
  readonly keyDigest: `sha256:${string}`;
  loadExact(): RepositoryCompilationCacheLoad;
  loadPredecessor(): RepositoryCompilationCacheLoad;
  publish(shards: readonly TypeScriptSourceProgramFactShard[]): RepositoryCompilationCacheLoad;
}

/** Runtime Cache consumes this contract; Source Program never imports its implementation. */
export interface RepositoryCompilationCacheProvider {
  openContentAddressedHint(
    generation: RepositoryCompilationGenerationReceipt
  ): RepositoryCompilationCacheHint;
}

export function repositoryCompilationCacheSchemaDigest(): `sha256:${string}` {
  return sha256(CACHE_SCHEMA) as `sha256:${string}`;
}
