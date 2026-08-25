/**
 * Tooling adapter for the pure Development Critical Path Spine contract.
 *
 * This file owns the bounded read-only static analyzer adapter and observes
 * existing Action journal facts. It owns no journal mutation, provider,
 * network, cache, domain execution, or cleanup effect.
 */

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  readGitMutableAuthoringSnapshotV1,
  readGitWorkingTreeChangedPathsV1,
  type GitMutableAuthoringSnapshotV1
} from '../../platform/git/authoring.ts';
import {
  chunkBlobEntries,
  readBlobEntryBatch,
  readCommitBlobInventory,
  readGitChangedRecords,
  readGitObjectFormat,
  readGitTreeRevision,
  resolveExactHeadCommit
} from '../../platform/git/objects.ts';
import { compareCodeUnits, rawSha256, sha256 } from '../../platform/shared/canonical-primitives.ts';
import {
  compileDevelopmentCriticalPathMainDeltaV1,
  compileDevelopmentCriticalPathNonMisleadingProjectionV1,
  compileDevelopmentCriticalPathV1,
  createDevelopmentCriticalPathActionObservationV1,
  createDevelopmentCriticalPathStaticAnalysisReadbackV2,
  createDevelopmentCriticalPathWholeDeltaSubjectV1,
  createDevelopmentCriticalPathWholeDeltaUnknownV1,
  DEVELOPMENT_CRITICAL_PATH_STATIC_CLOSURE_DIMENSIONS_V1,
  parseDevelopmentCriticalPathStaticAnalysisReadbackV2,
  parseDevelopmentCriticalPathStaticGenerationV1,
  type DevelopmentCriticalPathActionObservationV1,
  type DevelopmentCriticalPathCanonicalOwnerV1,
  type DevelopmentCriticalPathDigest,
  type DevelopmentCriticalPathEnvironmentFactV1,
  type DevelopmentCriticalPathMainHealthObservationV1,
  type DevelopmentCriticalPathMainIdentityV1,
  type DevelopmentCriticalPathNonMisleadingProjectionV1,
  type DevelopmentCriticalPathProjectionV1,
  type DevelopmentCriticalPathProviderFactV1,
  type DevelopmentCriticalPathRetirementOwnerFactV1,
  type DevelopmentCriticalPathStaticAnalysisReadbackV2,
  type DevelopmentCriticalPathStaticClosureDimensionV1,
  type DevelopmentCriticalPathStaticClosureV1,
  type DevelopmentCriticalPathStaticProducerV1,
  type DevelopmentCriticalPathStaticUnknownV1,
  type DevelopmentCriticalPathWholeDeltaChangeV1,
  type DevelopmentCriticalPathWholeDeltaConsumerV1,
  type DevelopmentCriticalPathWholeDeltaOwnerProjectionV1,
  type DevelopmentCriticalPathWholeDeltaRevisionFactV1,
  type DevelopmentCriticalPathWholeDeltaSubjectV1
} from '../../platform/shared/development-critical-path-contract.ts';
import {
  parseDocumentationAuthorityRegistry,
  resolveDocumentationOperationOwnersV1
} from '../../platform/shared/documentation-authority-contract.ts';
import {
  createTestImpactSourceProviderV2,
  readRepositoryModuleGraphV1,
  resolveTestImpactSelectionTrustBoundary
} from '../../platform/shared/test-impact-contract.ts';
import {
  encodeVerificationActionDataV2,
  parseVerificationActionKeyV2,
  type VerificationActionDependencyResolutionV2,
  type VerificationActionKeyDigest,
  type VerificationActionKeyV2,
  type VerificationActionPlanV2
} from '../../platform/shared/verification-action-contract.ts';
import { CodexDevelopmentParseCurrentWorkPackageManifestV1 } from '../../scripts/codex/work-package-contract.ts';
import type {
  VerificationActionJournalReadbackV2,
  VerificationActionJournalStateV2
} from './verification-action-journal.ts';

export type DevelopmentCriticalPathInFlightEvidenceV1 = Readonly<{
  readonly actionKey: VerificationActionKeyDigest;
  readonly claimDigest: DevelopmentCriticalPathDigest;
  readonly authenticated: boolean;
}>;

export type DevelopmentCriticalPathActionJournalObservationV1 = Readonly<{
  readonly action: VerificationActionKeyV2;
  readonly journal: VerificationActionJournalReadbackV2;
  readonly inFlight: DevelopmentCriticalPathInFlightEvidenceV1 | null;
}>;

function fail(message: string): never {
  throw new Error(`DevelopmentCriticalPath tooling ${message}`);
}

const staticAnalysisCache = new Map<string, DevelopmentCriticalPathStaticAnalysisReadbackV2>();
type StaticRepositoryCensusV2 = Readonly<{
  inventory: ReturnType<typeof readCommitBlobInventory>;
  trackedByteCount: number;
  byPath: ReadonlyMap<string, ReturnType<typeof readCommitBlobInventory>[number]>;
  bytesByObject: ReadonlyMap<string, Buffer>;
  source: (inputPath: string) => Buffer;
  registryBytes: Buffer;
  registry: ReturnType<typeof parseDocumentationAuthorityRegistry>;
  graph: ReturnType<typeof readRepositoryModuleGraphV1>;
  graphBoundary: ReturnType<typeof resolveTestImpactSelectionTrustBoundary>;
  inventoryDigest: DevelopmentCriticalPathDigest;
  moduleGraphDigest: DevelopmentCriticalPathDigest;
  producerSourceDigest: DevelopmentCriticalPathDigest;
  producerClosurePaths: readonly string[];
  producerClosureDigest: DevelopmentCriticalPathDigest;
}>;
const staticRepositoryCensusCache = new Map<string, StaticRepositoryCensusV2>();
const STATIC_ANALYSIS_CACHE_LIMIT = 64;
const STATIC_REPOSITORY_CENSUS_CACHE_LIMIT = 4;
const STATIC_REPOSITORY_CENSUS_CACHE_BYTE_LIMIT = 512 * 1024 * 1024;
let staticRepositoryCensusCacheBytes = 0;
let staticAnalyzerInvocationCount = 0;
let staticRepositoryCensusLookupCount = 0;
let staticRepositoryCensusBuildCount = 0;

/**
 * Read-only owner telemetry for proving admission reuse. These counters are
 * diagnostics only: they never participate in an authority decision and do
 * not expose cache contents or permit callers to reset or mutate the owner.
 */
export type DevelopmentCriticalPathStaticAnalyzerTelemetryV2 = Readonly<{
  readonly analyzerInvocationCount: number;
  readonly censusLookupCount: number;
  readonly censusBuildCount: number;
}>;

export function readDevelopmentCriticalPathStaticAnalyzerTelemetryV2():
  DevelopmentCriticalPathStaticAnalyzerTelemetryV2 {
  return Object.freeze({
    analyzerInvocationCount: staticAnalyzerInvocationCount,
    censusLookupCount: staticRepositoryCensusLookupCount,
    censusBuildCount: staticRepositoryCensusBuildCount
  });
}

export type DevelopmentCriticalPathStaticAnalysisAuthorityV2 = Readonly<{
  readonly schema: 'sec-development-critical-path-static-analysis-authority-v2';
  readonly readback: DevelopmentCriticalPathStaticAnalysisReadbackV2;
}>;

type StaticAnalysisAuthorityBindingV2 = Readonly<{
  repositoryRoot: string;
  headSha: string;
  headTreeSha: string;
  actionKey: VerificationActionKeyDigest;
  actionPlanDigest: DevelopmentCriticalPathDigest;
  actionPlanClosureDigest: DevelopmentCriticalPathDigest;
  producerSourceDigest: DevelopmentCriticalPathDigest;
  producerClosurePaths: readonly string[];
  producerClosureDigest: DevelopmentCriticalPathDigest;
  staticGenerationDigest: DevelopmentCriticalPathDigest;
  readbackDigest: DevelopmentCriticalPathDigest;
}>;

const STATIC_ANALYSIS_AUTHORITIES = new WeakMap<
  DevelopmentCriticalPathStaticAnalysisAuthorityV2,
  StaticAnalysisAuthorityBindingV2
>();
const runtimeAnalyzerSourceDigest = rawSha256(readFileSync(fileURLToPath(import.meta.url)));

function rememberBounded<K, V>(cache: Map<K, V>, key: K, value: V, limit: number): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) cache.delete(cache.keys().next().value!);
}

function rememberStaticRepositoryCensus(key: string, value: StaticRepositoryCensusV2): void {
  const replaced = staticRepositoryCensusCache.get(key);
  if (replaced !== undefined) staticRepositoryCensusCacheBytes -= replaced.trackedByteCount;
  staticRepositoryCensusCache.delete(key);
  staticRepositoryCensusCache.set(key, value);
  staticRepositoryCensusCacheBytes += value.trackedByteCount;
  while (staticRepositoryCensusCache.size > STATIC_REPOSITORY_CENSUS_CACHE_LIMIT
      || staticRepositoryCensusCacheBytes > STATIC_REPOSITORY_CENSUS_CACHE_BYTE_LIMIT) {
    const oldestKey = staticRepositoryCensusCache.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = staticRepositoryCensusCache.get(oldestKey)!;
    staticRepositoryCensusCache.delete(oldestKey);
    staticRepositoryCensusCacheBytes -= oldest.trackedByteCount;
  }
}

function transitiveModuleClosureV1(
  graph: ReturnType<typeof readRepositoryModuleGraphV1>,
  root: string
): readonly string[] {
  const visited = new Set<string>();
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const dependency of graph.directDependencies(current)) {
      if (!visited.has(dependency)) queue.push(dependency);
    }
  }
  return Object.freeze([...visited].sort(compareCodeUnits));
}

function readStaticRepositoryCensusV2(input: Readonly<{
  repositoryRoot: string;
  headSha: string;
  headTreeSha: string;
}>): StaticRepositoryCensusV2 {
  staticRepositoryCensusLookupCount += 1;
  const cacheKey = `${input.repositoryRoot}\0${input.headSha}\0${input.headTreeSha}`;
  const cached = staticRepositoryCensusCache.get(cacheKey);
  if (cached !== undefined) {
    rememberStaticRepositoryCensus(cacheKey, cached);
    return cached;
  }
  staticRepositoryCensusBuildCount += 1;
  const inventory = readCommitBlobInventory(input.repositoryRoot, input.headSha);
  const trackedByteCount = inventory.reduce((sum, entry) => sum + entry.byteSize, 0);
  if (inventory.length > 250_000 || !Number.isSafeInteger(trackedByteCount)
      || trackedByteCount > 16 * 1024 * 1024 * 1024) {
    fail('tracked repository census exceeds the static analyzer budget.');
  }
  const byPath = new Map(inventory.map((entry) => [entry.path, entry]));
  const bytesByObject = new Map<string, Buffer>();
  const moduleInventory = createTestImpactSourceProviderV2({
    repositoryFiles: inventory.map(({ path: inputPath }) => inputPath),
    readModuleSource: () => null
  });
  const eagerlyObservedPaths = new Set([
    ...moduleInventory.moduleFiles,
    'docs/authority.json',
    'tooling/sec-dev/development-critical-path.ts'
  ]);
  const eagerlyObservedEntries = inventory.filter(({ path: inputPath }) =>
    eagerlyObservedPaths.has(inputPath));
  for (const batch of chunkBlobEntries(eagerlyObservedEntries, {
    maxBytes: 16 * 1024 * 1024,
    maxItems: 512
  })) {
    for (const [objectId, bytes] of readBlobEntryBatch(input.repositoryRoot, batch)) bytesByObject.set(objectId, bytes);
  }
  const source = (inputPath: string): Buffer => {
    const entry = byPath.get(inputPath);
    let bytes = entry === undefined ? undefined : bytesByObject.get(entry.objectId);
    if (entry !== undefined && bytes === undefined) {
      bytes = readBlobEntryBatch(input.repositoryRoot, [entry]).get(entry.objectId);
      if (bytes !== undefined) bytesByObject.set(entry.objectId, bytes);
    }
    if (bytes === undefined) fail(`tracked static input is unavailable: ${inputPath}.`);
    return bytes;
  };
  const producerSourceDigest = rawSha256(source('tooling/sec-dev/development-critical-path.ts'));
  const registryBytes = source('docs/authority.json');
  const registry = parseDocumentationAuthorityRegistry(registryBytes.toString('utf8'));
  const moduleProvider = createTestImpactSourceProviderV2({
    repositoryFiles: inventory.map(({ path: inputPath }) => inputPath),
    readModuleSource: (modulePath) => {
      const entry = byPath.get(modulePath);
      const bytes = entry === undefined ? undefined : bytesByObject.get(entry.objectId);
      return bytes === undefined ? null : bytes.toString('utf8');
    }
  });
  const graph = readRepositoryModuleGraphV1(moduleProvider);
  const graphBoundary = resolveTestImpactSelectionTrustBoundary(moduleProvider);
  const producerClosurePaths = transitiveModuleClosureV1(
    graph,
    'tooling/sec-dev/development-critical-path.ts'
  );
  const producerClosureDigest = sha256(producerClosurePaths.map((inputPath) => {
    const entry = byPath.get(inputPath);
    if (entry === undefined) fail(`static analyzer producer closure path is untracked: ${inputPath}.`);
    return Object.freeze({ path: inputPath, mode: entry.mode, objectId: entry.objectId });
  })) as DevelopmentCriticalPathDigest;
  const result = Object.freeze({
    inventory,
    trackedByteCount,
    byPath,
    bytesByObject,
    source,
    registryBytes,
    registry,
    graph,
    graphBoundary,
    inventoryDigest: sha256(inventory) as DevelopmentCriticalPathDigest,
    moduleGraphDigest: sha256(Object.freeze({ files: graph.files, references: graph.references })) as DevelopmentCriticalPathDigest,
    producerSourceDigest,
    producerClosurePaths,
    producerClosureDigest
  });
  rememberStaticRepositoryCensus(cacheKey, result);
  return result;
}

function issueStaticAnalysisAuthorityV2(
  repositoryRoot: string,
  readback: DevelopmentCriticalPathStaticAnalysisReadbackV2,
  census: StaticRepositoryCensusV2
): DevelopmentCriticalPathStaticAnalysisAuthorityV2 {
  const authority = Object.freeze({
    schema: 'sec-development-critical-path-static-analysis-authority-v2' as const,
    readback
  });
  STATIC_ANALYSIS_AUTHORITIES.set(authority, Object.freeze({
    repositoryRoot,
    headSha: readback.repository.headSha,
    headTreeSha: readback.repository.headTreeSha,
    actionKey: readback.actionKey,
    actionPlanDigest: readback.actionPlanDigest,
    actionPlanClosureDigest: readback.actionPlanClosureDigest,
    producerSourceDigest: readback.producer.sourceDigest,
    producerClosurePaths: census.producerClosurePaths,
    producerClosureDigest: census.producerClosureDigest,
    staticGenerationDigest: readback.staticGeneration.generationDigest,
    readbackDigest: readback.readbackDigest
  }));
  return authority;
}

function readBoundDevelopmentCriticalPathStaticAnalysisAuthorityV2(
  authority: DevelopmentCriticalPathStaticAnalysisAuthorityV2,
  input: Readonly<{
    plan: VerificationActionPlanV2;
    expectedActionPlanClosureDigest: DevelopmentCriticalPathDigest;
  }>
): DevelopmentCriticalPathStaticAnalysisReadbackV2 {
  const binding = STATIC_ANALYSIS_AUTHORITIES.get(authority);
  if (binding === undefined || authority.schema !== 'sec-development-critical-path-static-analysis-authority-v2') {
    fail('static analysis authority was not issued by the exact-tree analyzer.');
  }
  const actionPlanDigest = sha256(input.plan) as DevelopmentCriticalPathDigest;
  if (binding.actionKey !== input.plan.action.actionKey
      || binding.actionPlanDigest !== actionPlanDigest
      || binding.readbackDigest !== authority.readback.readbackDigest
      || binding.producerSourceDigest !== runtimeAnalyzerSourceDigest
      || binding.staticGenerationDigest !== authority.readback.staticGeneration.generationDigest
      || binding.actionPlanClosureDigest !== input.expectedActionPlanClosureDigest) {
    fail('static analysis authority binding does not match the requested Action subject.');
  }
  return parseDevelopmentCriticalPathStaticAnalysisReadbackV2(authority.readback);
}

/**
 * Pure Action derivation from one already-issued immutable generation.  The
 * result carries no Effect authority; production Effect admission must still
 * call consumeDevelopmentCriticalPathStaticAnalysisAuthorityV2 exactly once
 * at the live boundary.
 */
export function readDevelopmentCriticalPathStaticAnalysisAuthorityV2(
  authority: DevelopmentCriticalPathStaticAnalysisAuthorityV2,
  input: Readonly<{
    plan: VerificationActionPlanV2;
    expectedActionPlanClosureDigest: DevelopmentCriticalPathDigest;
  }>
): DevelopmentCriticalPathStaticAnalysisReadbackV2 {
  return readBoundDevelopmentCriticalPathStaticAnalysisAuthorityV2(authority, input);
}

export function consumeDevelopmentCriticalPathStaticAnalysisAuthorityV2(
  authority: DevelopmentCriticalPathStaticAnalysisAuthorityV2,
  input: Readonly<{
    plan: VerificationActionPlanV2;
    expectedActionPlanClosureDigest: DevelopmentCriticalPathDigest;
  }>
): DevelopmentCriticalPathStaticAnalysisReadbackV2 {
  const readback = readBoundDevelopmentCriticalPathStaticAnalysisAuthorityV2(authority, input);
  const binding = STATIC_ANALYSIS_AUTHORITIES.get(authority)!;
  const headSha = resolveExactHeadCommit(binding.repositoryRoot);
  const headTreeSha = readGitTreeRevision(binding.repositoryRoot);
  if (headSha !== binding.headSha || headTreeSha !== binding.headTreeSha) {
    fail('static analysis authority exact repository binding is stale.');
  }
  const driftedProducerPaths = readGitWorkingTreeChangedPathsV1(binding.repositoryRoot).filter((inputPath) =>
    binding.producerClosurePaths.includes(inputPath));
  if (driftedProducerPaths.length > 0) {
    fail(`static analysis authority producer closure is stale: ${driftedProducerPaths.join(', ')}.`);
  }
  return readback;
}

/**
 * Cross-process freshness fence for a durable StaticGeneration publication.
 * The generation object is immutable data, not authority; this function
 * rebinds it to the current exact Git tree and the executing producer closure
 * immediately before Effect. It deliberately performs no repository census.
 */
export function assertDevelopmentCriticalPathStaticGenerationCurrentV1(
  generationValue: DevelopmentCriticalPathStaticAnalysisReadbackV2['staticGeneration'],
  repositoryRootValue: string
): void {
  const generation = parseDevelopmentCriticalPathStaticGenerationV1(generationValue);
  const repositoryRoot = realpathSync.native(repositoryRootValue);
  const headSha = resolveExactHeadCommit(repositoryRoot);
  const headTreeSha = readGitTreeRevision(repositoryRoot);
  if (headSha !== generation.repository.headSha || headTreeSha !== generation.repository.headTreeSha) {
    fail('durable static generation exact repository binding is stale.');
  }
  if (generation.producer.sourceDigest !== runtimeAnalyzerSourceDigest) {
    fail('durable static generation producer source differs from the executing producer.');
  }
  const producerPaths = new Set(generation.producerClosure.paths);
  const driftedProducerPaths = readGitWorkingTreeChangedPathsV1(repositoryRoot).filter((inputPath) =>
    producerPaths.has(inputPath));
  if (driftedProducerPaths.length > 0) {
    fail(`durable static generation producer closure is stale: ${driftedProducerPaths.join(', ')}.`);
  }
}

export type DevelopmentCriticalPathAuthoringObservationV1 = Readonly<{
  schema: 'sec-development-critical-path-authoring-observation-v1';
  effectAuthority: 'none';
  snapshot: GitMutableAuthoringSnapshotV1;
  producerClosure: Readonly<{
    closureDigest: DevelopmentCriticalPathDigest;
    paths: readonly string[];
    changedPaths: readonly string[];
    status: 'exact' | 'drifted';
  }>;
  authoringState: 'clean' | 'dirty-unrelated' | 'dirty-producer-closure';
  disposition: 'exact-object-analysis-ready' | 'authoring-analysis-only';
  observationDigest: DevelopmentCriticalPathDigest;
}>;

export function classifyDevelopmentCriticalPathAuthoringDispositionV1(input: Readonly<{
  changedPaths: readonly string[];
  producerClosurePaths: readonly string[];
}>): Readonly<{
  changedProducerPaths: readonly string[];
  authoringState: DevelopmentCriticalPathAuthoringObservationV1['authoringState'];
  disposition: DevelopmentCriticalPathAuthoringObservationV1['disposition'];
}> {
  const producerPaths = new Set(input.producerClosurePaths);
  const changedProducerPaths = Object.freeze(
    [...new Set(input.changedPaths.filter((inputPath) => producerPaths.has(inputPath)))].sort()
  );
  return Object.freeze({
    changedProducerPaths,
    authoringState: input.changedPaths.length === 0
      ? 'clean' as const
      : changedProducerPaths.length === 0
        ? 'dirty-unrelated' as const
        : 'dirty-producer-closure' as const,
    disposition: changedProducerPaths.length === 0
      ? 'exact-object-analysis-ready' as const
      : 'authoring-analysis-only' as const
  });
}

/**
 * Observe dirty authoring as content-addressed, non-authoritative input.  An
 * unrelated draft never blocks exact-object analysis; a changed producer
 * module is reported as authoring-only and can never issue Effect authority.
 */
export function observeDevelopmentCriticalPathAuthoringSnapshotV1(
  repositoryRootInput: string
): DevelopmentCriticalPathAuthoringObservationV1 {
  const repositoryRoot = realpathSync.native(repositoryRootInput);
  const snapshot = readGitMutableAuthoringSnapshotV1(repositoryRoot);
  const census = readStaticRepositoryCensusV2({
    repositoryRoot,
    headSha: snapshot.baseHeadSha,
    headTreeSha: snapshot.baseHeadTreeSha
  });
  const classification = classifyDevelopmentCriticalPathAuthoringDispositionV1({
    changedPaths: snapshot.changedPaths,
    producerClosurePaths: census.producerClosurePaths
  });
  const changedPaths = classification.changedProducerPaths;
  const producerClosure = Object.freeze({
    closureDigest: census.producerClosureDigest,
    paths: census.producerClosurePaths,
    changedPaths,
    status: changedPaths.length === 0 ? 'exact' as const : 'drifted' as const
  });
  const material = Object.freeze({
    schema: 'sec-development-critical-path-authoring-observation-v1' as const,
    effectAuthority: 'none' as const,
    snapshot,
    producerClosure,
    authoringState: classification.authoringState,
    disposition: classification.disposition
  });
  return Object.freeze({
    ...material,
    observationDigest: sha256(material) as DevelopmentCriticalPathDigest
  });
}

type StaticInventoryEntryV2 = ReturnType<typeof readCommitBlobInventory>[number];
type StaticChangedRecordV2 = ReturnType<typeof readGitChangedRecords>[number];

/**
 * Convert the Git observer's machine records and two exact inventories into
 * one content-addressed whole-delta change list.  Any inconsistency is
 * returned as data so the caller can publish a typed Unknown instead of
 * turning a partial diff into a proof.
 */
function buildWholeDeltaChangesV1(input: Readonly<{
  records: readonly StaticChangedRecordV2[];
  baseInventory: readonly StaticInventoryEntryV2[];
  headInventory: readonly StaticInventoryEntryV2[];
}>): Readonly<{
  changes: readonly DevelopmentCriticalPathWholeDeltaChangeV1[];
  inconsistencies: readonly string[];
}> {
  const baseByPath = new Map(input.baseInventory.map((entry) => [entry.path, entry] as const));
  const headByPath = new Map(input.headInventory.map((entry) => [entry.path, entry] as const));
  const inconsistencies: string[] = [];
  const changes: DevelopmentCriticalPathWholeDeltaChangeV1[] = [];
  const recordPaths = new Set<string>();
  for (const record of input.records) {
    const previousPath = record.previousPath ?? null;
    const basePath = record.status === 'renamed' || record.status === 'copied'
      ? previousPath
      : record.path;
    const baseEntry = basePath === undefined || basePath === null ? undefined : baseByPath.get(basePath);
    const headEntry = headByPath.get(record.path);
    const previousHeadEntry = previousPath === null ? undefined : headByPath.get(previousPath);
    if (record.status === 'added' && (baseEntry !== undefined || headEntry === undefined)) {
      inconsistencies.push(`added:${record.path}`);
    } else if (record.status === 'changed' && (baseEntry === undefined || headEntry === undefined)) {
      inconsistencies.push(`changed:${record.path}`);
    } else if (record.status === 'removed' && (baseEntry === undefined || headEntry !== undefined)) {
      inconsistencies.push(`removed:${record.path}`);
    } else if (record.status === 'renamed' && (
      previousPath === null || baseEntry === undefined || headEntry === undefined || previousHeadEntry !== undefined
    )) {
      inconsistencies.push(`renamed:${previousPath ?? '<missing>'}->${record.path}`);
    } else if (record.status === 'copied' && (
      previousPath === null || baseEntry === undefined || headEntry === undefined || previousHeadEntry === undefined
    )) {
      inconsistencies.push(`copied:${previousPath ?? '<missing>'}->${record.path}`);
    }
    if (record.status === 'renamed' && previousPath !== null) {
      recordPaths.add(previousPath);
      recordPaths.add(record.path);
    } else {
      recordPaths.add(record.path);
    }
    const material = Object.freeze({
      status: record.status,
      path: record.path,
      previousPath,
      baseMode: baseEntry?.mode ?? null,
      headMode: headEntry?.mode ?? null,
      baseObjectId: baseEntry?.objectId ?? null,
      headObjectId: headEntry?.objectId ?? null,
      baseByteSize: baseEntry?.byteSize ?? null,
      headByteSize: headEntry?.byteSize ?? null
    });
    changes.push(Object.freeze({
      changeDigest: sha256(material) as DevelopmentCriticalPathDigest,
      ...material
    }));
  }
  const inventoryDeltaPaths = new Set<string>();
  for (const path of new Set([...baseByPath.keys(), ...headByPath.keys()])) {
    const baseEntry = baseByPath.get(path);
    const headEntry = headByPath.get(path);
    if (baseEntry === undefined || headEntry === undefined
        || baseEntry.objectId !== headEntry.objectId
        || baseEntry.mode !== headEntry.mode
        || baseEntry.byteSize !== headEntry.byteSize) {
      inventoryDeltaPaths.add(path);
    }
  }
  if (JSON.stringify([...recordPaths].sort(compareCodeUnits))
      !== JSON.stringify([...inventoryDeltaPaths].sort(compareCodeUnits))) {
    inconsistencies.push('Git changed records do not cover the exact base/head inventory delta.');
  }
  return Object.freeze({
    changes: Object.freeze(changes.sort((left, right) => compareCodeUnits(left.changeDigest, right.changeDigest))),
    inconsistencies: Object.freeze([...new Set(inconsistencies)].sort(compareCodeUnits))
  });
}

export type DevelopmentCriticalPathManifestOwnedPathPresenceV1 =
  | 'present'
  | 'authorized-deletion'
  | 'authorized-absence'
  | 'missing-unproven';

/**
 * Classify an owned path from exact head inventory plus the exact base-to-head
 * Git delta. An absent path is not equivalent to an authorized deletion: the
 * latter must be carried by a canonical removed record whose head object is
 * absent and whose base object is present. A path absent from both exact base
 * and head is an authorized scope-only path: Work Package ownership grants a
 * write boundary, not a requirement that every granted path exist.
 */
export function classifyDevelopmentCriticalPathManifestOwnedPathPresenceV1(input: Readonly<{
  ownedPath: string;
  headObjectId: string | null;
  /** undefined means the exact base inventory is unavailable. */
  baseObjectId?: string | null;
  changes: readonly DevelopmentCriticalPathWholeDeltaChangeV1[];
}>): DevelopmentCriticalPathManifestOwnedPathPresenceV1 {
  if (input.headObjectId !== null) return 'present';
  if (input.changes.some((change) => (
    (change.status === 'removed'
      && change.path === input.ownedPath
      && change.previousPath === null
      && change.baseObjectId !== null
      && change.headObjectId === null)
    || (change.status === 'renamed'
      && change.previousPath === input.ownedPath
      && change.baseObjectId !== null
      && change.headObjectId !== null)
  ))) return 'authorized-deletion';
  return input.baseObjectId === null ? 'authorized-absence' : 'missing-unproven';
}

function wholeDeltaConsumerV1(input: Readonly<{
  consumerRef: string;
  sourceLocations: readonly string[];
  inputDigest: DevelopmentCriticalPathDigest;
  required: boolean;
}>): DevelopmentCriticalPathWholeDeltaConsumerV1 {
  const material = Object.freeze({
    consumerRef: input.consumerRef,
    sourceLocations: Object.freeze([...new Set(input.sourceLocations)].sort(compareCodeUnits)),
    inputDigest: input.inputDigest,
    required: input.required
  });
  return Object.freeze({
    consumerDigest: sha256(material) as DevelopmentCriticalPathDigest,
    ...material
  });
}

function wholeDeltaOwnerProjectionV1(input: Readonly<{
  owner: DevelopmentCriticalPathCanonicalOwnerV1;
  producer: DevelopmentCriticalPathStaticProducerV1;
  consumerRefs: readonly string[];
  required: boolean;
}>): DevelopmentCriticalPathWholeDeltaOwnerProjectionV1 {
  const material = Object.freeze({
    owner: input.owner,
    producer: input.producer,
    consumerRefs: Object.freeze([...new Set(input.consumerRefs)].sort(compareCodeUnits)),
    required: input.required
  });
  return Object.freeze({
    projectionDigest: sha256(material) as DevelopmentCriticalPathDigest,
    ...material
  });
}

export function analyzeDevelopmentCriticalPathStaticClosureV2(input: Readonly<{
  repositoryRoot: string;
  plan: VerificationActionPlanV2;
  actionPlanClosureDigest: DevelopmentCriticalPathDigest;
  expectedHeadSha: string;
  expectedHeadTreeSha: string;
  manifestPath?: string;
  /**
   * Compile-time tombstone for the retired caller-map seam.  Runtime callers
   * that cross the type boundary still receive the same typed rejection.
   */
  virtualInputs?: never;
}>): DevelopmentCriticalPathStaticAnalysisAuthorityV2 {
  staticAnalyzerInvocationCount += 1;
  const plan = input.plan;
  if (input.virtualInputs !== undefined) {
    fail('ordinary virtual input digest maps are unbound; use an analyzer-issued exact-source producer authority.');
  }
  const repositoryRoot = realpathSync.native(input.repositoryRoot);
  const headSha = resolveExactHeadCommit(repositoryRoot);
  const headTreeSha = readGitTreeRevision(repositoryRoot);
  if (headTreeSha === null) fail('static analyzer could not resolve the exact HEAD tree.');
  const objectFormat = readGitObjectFormat(repositoryRoot);
  const repositoryIdentityBlockers = [
    ...(headSha === input.expectedHeadSha ? [] : ['head-sha-drift']),
    ...(headTreeSha === input.expectedHeadTreeSha ? [] : ['head-tree-drift']),
    ...(objectFormat === 'sha1' || objectFormat === 'sha256' ? [] : ['unsupported-object-format'])
  ];
  if (repositoryIdentityBlockers.length > 0) {
    fail(`exact repository identity or clean-state changed during static analysis: ${repositoryIdentityBlockers.join(', ')}.`);
  }
  const canonicalObjectFormat: 'sha1' | 'sha256' = objectFormat === 'sha1' || objectFormat === 'sha256'
    ? objectFormat
    : fail('exact repository object format is unsupported.');
  const census = readStaticRepositoryCensusV2({
    repositoryRoot,
    headSha,
    headTreeSha
  });
  if (census.producerSourceDigest !== runtimeAnalyzerSourceDigest) {
    fail('exact-tree analyzer source bytes differ from the executing trusted producer.');
  }
  const driftedProducerPaths = readGitWorkingTreeChangedPathsV1(repositoryRoot).filter((inputPath) =>
    census.producerClosurePaths.includes(inputPath));
  if (driftedProducerPaths.length > 0) {
    fail(`exact-tree analyzer producer closure differs from the executing authoring surface: ${driftedProducerPaths.join(', ')}.`);
  }
  const cacheKey = sha256(Object.freeze({
    repositoryRoot,
    headSha: input.expectedHeadSha,
    headTreeSha: input.expectedHeadTreeSha,
    actionKey: plan.action.actionKey,
    actionPlanClosureDigest: input.actionPlanClosureDigest,
    manifestPath: input.manifestPath ?? null
  })) as DevelopmentCriticalPathDigest;
  const cached = staticAnalysisCache.get(cacheKey);
  if (cached !== undefined) {
    rememberBounded(staticAnalysisCache, cacheKey, cached, STATIC_ANALYSIS_CACHE_LIMIT);
    return issueStaticAnalysisAuthorityV2(repositoryRoot, cached, census);
  }
  const {
    inventory, trackedByteCount, registryBytes, registry, source,
    graph, graphBoundary, inventoryDigest, moduleGraphDigest, producerSourceDigest
  } = census;
  for (const member of plan.action.inputClosure) {
    const observedDigest = member.path === 'main.tree'
      ? sha256(headTreeSha) as DevelopmentCriticalPathDigest
      : member.path === 'affected.plan'
        ? input.actionPlanClosureDigest
        : rawSha256(source(member.path));
    if (observedDigest !== member.digest) fail(`Action input bytes drifted for ${member.path}.`);
  }
  let manifestPath = input.manifestPath;
  if (manifestPath === undefined) {
    manifestPath = plan.action.inputClosure.find(({ path: inputPath }) =>
      inputPath.startsWith('docs/work-packages/') && inputPath.endsWith('.md'))?.path;
  }
  const manifestBytes = manifestPath === undefined ? null : source(manifestPath);
  const manifest = manifestBytes === null ? null : CodexDevelopmentParseCurrentWorkPackageManifestV1(
    manifestBytes.toString('utf8'), manifestPath
  );
  let baseInventory: readonly StaticInventoryEntryV2[] | null = null;
  let changedRecords: readonly StaticChangedRecordV2[] | null = null;
  let baseRevisionFact: DevelopmentCriticalPathWholeDeltaRevisionFactV1 | null = null;
  let baseFactError: string | null = null;
  if (manifest?.base === undefined) {
    baseFactError = 'frozen Work Package manifest base is unavailable';
  } else {
    try {
      const baseTreeSha = readGitTreeRevision(repositoryRoot, manifest.base);
      if (baseTreeSha === null) {
        baseFactError = `manifest base ${manifest.base} has no exact Git tree`;
      } else {
        const observedBaseInventory = readCommitBlobInventory(repositoryRoot, manifest.base);
        baseInventory = observedBaseInventory;
        changedRecords = readGitChangedRecords(repositoryRoot, manifest.base, headSha);
        baseRevisionFact = Object.freeze({
          commitSha: manifest.base,
          treeSha: baseTreeSha,
          inventoryDigest: sha256(observedBaseInventory) as DevelopmentCriticalPathDigest
        });
      }
    } catch (error) {
      baseFactError = error instanceof Error ? error.message : String(error);
    }
  }
  const headRevisionFact: DevelopmentCriticalPathWholeDeltaRevisionFactV1 = Object.freeze({
    commitSha: headSha,
    treeSha: headTreeSha,
    inventoryDigest
  });
  const ownerClosure = manifest === null
    ? registry.documents
    : resolveDocumentationOperationOwnersV1({
        registry,
        authorityRefs: manifest.authorityRefs ?? [],
        changedPaths: manifest.tasks.flatMap(({ ownedPaths }) => ownedPaths)
          .filter((ownedPath) => ownedPath.endsWith('.md')).sort()
      });
  const ownerDocuments = ownerClosure.map(({ id, path: ownerPath }) => Object.freeze({
    id,
    path: ownerPath,
    digest: rawSha256(source(ownerPath))
  }));
  const manifestDigest = manifestBytes === null
    ? sha256(Object.freeze({ kind: 'system-static-analysis', actionKey: plan.action.actionKey })) as DevelopmentCriticalPathDigest
    : rawSha256(manifestBytes);
  const common = Object.freeze({
    inventoryDigest,
    moduleGraphDigest,
    manifestDigest,
    ownerRegistryDigest: rawSha256(registryBytes),
    actionPlanClosureDigest: input.actionPlanClosureDigest
  });
  /**
   * Regexes are intentionally only candidate hints.  They are useful for
   * diagnostics and bounded work estimation, but no dimension may call their
   * result a census or an owner closure without an exact producer proof.
   */
  const pathsMatching = (pattern: RegExp) => inventory
    .filter(({ path: inputPath }) => pattern.test(inputPath))
    .map(({ path: inputPath, objectId, byteSize }) => ({ path: inputPath, objectId, byteSize }));
  const actionPlanDigest = sha256(plan) as DevelopmentCriticalPathDigest;
  const ownerRecords = Object.freeze(registry.documents
    .filter(({ owns }) => owns.length > 0)
    .map((record) => Object.freeze({
      recordId: record.id,
      path: record.path,
      domain: record.domain,
      owns: Object.freeze([...record.owns])
    }))
    .sort((left, right) => compareCodeUnits(left.recordId, right.recordId)));
  const ownerById = new Map(ownerRecords.map((owner) => [owner.recordId, owner] as const));
  const ownerFor = (recordId: string): DevelopmentCriticalPathCanonicalOwnerV1 => {
    const owner = ownerById.get(recordId);
    if (owner === undefined) fail(`canonical owner ${recordId} is absent from docs/authority.json.`);
    return owner;
  };
  const producerBinding: DevelopmentCriticalPathStaticProducerV1 = Object.freeze({
    identity: 'tooling/sec-dev/development-critical-path.ts',
    revision: 'sec-development-critical-path-static-analyzer-v3',
    sourceDigest: producerSourceDigest
  });
  const dimensionClaims: Record<DevelopmentCriticalPathStaticClosureDimensionV1, Readonly<{
    owner: DevelopmentCriticalPathCanonicalOwnerV1;
    producer: DevelopmentCriticalPathStaticProducerV1;
    subjectDigest: DevelopmentCriticalPathDigest;
  }>> = {
    'public-contract': { owner: ownerFor('verification-governance'), producer: producerBinding, subjectDigest: actionPlanDigest },
    'authority-owner': { owner: ownerFor('documentation-registry'), producer: producerBinding, subjectDigest: rawSha256(registryBytes) },
    'imports-consumers': { owner: ownerFor('delta-impact'), producer: producerBinding, subjectDigest: moduleGraphDigest },
    'dependency-closure': { owner: ownerFor('verification-governance'), producer: producerBinding, subjectDigest: actionPlanDigest },
    'state-transitions': { owner: ownerFor('system-architecture'), producer: producerBinding, subjectDigest: actionPlanDigest },
    'effect-capabilities': { owner: ownerFor('capability-block'), producer: producerBinding, subjectDigest: plan.action.actionKey },
    'storage-current': { owner: ownerFor('runtime-distribution'), producer: producerBinding, subjectDigest: producerSourceDigest },
    'resource-budget-timeout': { owner: ownerFor('runtime-distribution'), producer: producerBinding, subjectDigest: actionPlanDigest },
    'retention-retirement': { owner: ownerFor('change-management'), producer: producerBinding, subjectDigest: producerSourceDigest },
    'dynamic-static-publication': { owner: ownerFor('verification-governance'), producer: producerBinding, subjectDigest: producerSourceDigest },
    'documentation-projection': { owner: ownerFor('documentation-registry'), producer: producerBinding, subjectDigest: sha256(ownerDocuments) as DevelopmentCriticalPathDigest },
    'unknown-ledger': { owner: ownerFor('development-governance'), producer: producerBinding, subjectDigest: inventoryDigest }
  };
  const observedDimension = (
    dimension: DevelopmentCriticalPathStaticClosureDimensionV1,
    inputValue: unknown,
    defectClasses: readonly string[] = [],
    unknowns: readonly DevelopmentCriticalPathStaticUnknownV1[] = [],
    stopCondition: 'tracked-owner-surface-exhausted' | 'module-graph-unresolved' | 'analyzer-failed' =
      'tracked-owner-surface-exhausted',
    coverageBasis: 'producer-exact' | 'candidate-hint' = 'producer-exact'
  ) => Object.freeze({
    claim: Object.freeze(dimensionClaims[dimension]),
    input: inputValue,
    coverage: unknowns.length === 0 && coverageBasis === 'producer-exact'
      ? 'bounded-census-complete' as const
      : 'unknown' as const,
    coverageBasis,
    stopCondition,
    defectClasses: Object.freeze([...defectClasses].sort()),
    unknowns: Object.freeze([...unknowns].sort((left, right) => compareCodeUnits(left.unknownId, right.unknownId)))
  });
  const publicContracts = pathsMatching(
    /^(?:platform\/shared\/|tooling\/sec-dev\/).*(?:contract|schema|registry).*\.[cm]?tsx?$/u
  );
  const stateOwners = pathsMatching(/(?:contract|journal|lifecycle|state).*\.[cm]?tsx?$/u);
  const effectShells = pathsMatching(/^(?:scripts|tooling|platform\/dev-runner)\/.*\.[cm]?tsx?$/u);
  const storageOwners = pathsMatching(/(?:runtime-state|journal|cache|receipt|pointer).*\.[cm]?tsx?$/u);
  const resourceOwners = pathsMatching(
    /(?:environment-spec|benchmark|process|runner).*\.[cm]?tsx?$|^platform\/shared\/environment-specs\//u
  );
  const lifecycleOwners = pathsMatching(
    /(?:generated-state|physical-no-follow|worktree|retire|settlement|cleanup).*\.[cm]?tsx?$/u
  );
  const publicationOwners = pathsMatching(
    /(?:development-critical-path|verification-action-journal|closeout).*\.[cm]?tsx?$/u
  );
  const unknownFor = (
    dimension: DevelopmentCriticalPathStaticClosureDimensionV1,
    missingEdge: string,
    source: string,
    blockingEffect: DevelopmentCriticalPathStaticUnknownV1['blockingEffect'] = 'pre-effect',
    minimumResolution = 'trusted exact producer receipt'
  ): DevelopmentCriticalPathStaticUnknownV1 => {
    const material = Object.freeze({
      subject: `development-critical-path:${dimension}`,
      ownerRef: dimensionClaims[dimension].owner,
      producerRef: producerBinding,
      missingEdge,
      sourceLocations: Object.freeze([source]),
      inputRevision: producerBinding.revision,
      requiredAuthority: 'sec-development-critical-path-static-analysis',
      blockingEffect,
      freshness: 'fresh' as const,
      invalidationPredicates: Object.freeze(['exact-head-or-source-digest-drift']),
      recoveryOwner: dimensionClaims[dimension].owner,
      recovery: 'recompute-exact-static-analysis-readback',
      minimumResolution
    });
    return Object.freeze({
      unknownId: sha256(material) as DevelopmentCriticalPathDigest,
      ...material
    });
  };
  const candidateHintUnknown = (
    dimension: DevelopmentCriticalPathStaticClosureDimensionV1,
    source: string
  ) => [unknownFor(
    dimension,
    'regex path selection is a candidate hint without an exact producer census',
    source,
    'none'
  )];
  const wholeDeltaScope = plan.action.staticProofRequirement === 'required-producer-bound'
    ? 'required-producer-bound' as const
    : 'bounded-action-admission' as const;
  const wholeDeltaUnknowns: DevelopmentCriticalPathStaticUnknownV1[] = [];
  const wholeDeltaUnknown = (
    missingEdge: string,
    sourceLocation: string,
    blockingEffect: DevelopmentCriticalPathStaticUnknownV1['blockingEffect'] =
      wholeDeltaScope === 'required-producer-bound' ? 'required-proof' : 'none'
  ) =>
    createDevelopmentCriticalPathWholeDeltaUnknownV1({
      subject: 'development-critical-path:whole-delta',
      ownerRef: dimensionClaims['unknown-ledger'].owner,
      producerRef: producerBinding,
      missingEdge,
      sourceLocations: [sourceLocation],
      blockingEffect,
      minimumResolution: 'exact manifest base, Git changed records, and owner/consumer fixed-point closure'
    });
  if (baseFactError !== null) {
    wholeDeltaUnknowns.push(wholeDeltaUnknown(
      `base revision fact unavailable: ${baseFactError}`,
      manifestPath ?? 'docs/authority.json'
    ));
  }
  const exactChanges = baseInventory === null || changedRecords === null
    ? Object.freeze({ changes: Object.freeze([] as DevelopmentCriticalPathWholeDeltaChangeV1[]), inconsistencies: Object.freeze([] as string[]) })
    : buildWholeDeltaChangesV1({
        records: changedRecords,
        baseInventory,
        headInventory: inventory
      });
  for (const inconsistency of exactChanges.inconsistencies) {
    wholeDeltaUnknowns.push(wholeDeltaUnknown(
      `exact base/head changed-record mismatch: ${inconsistency}`,
      manifestPath ?? 'docs/authority.json'
    ));
  }
  const requiredOwnerIds = new Set(ownerClosure.map(({ id }) => id));
  const requiredOwners = Object.freeze(ownerRecords.filter(({ recordId }) => requiredOwnerIds.has(recordId)));
  if (wholeDeltaScope === 'required-producer-bound' && requiredOwners.length === 0) {
    wholeDeltaUnknowns.push(wholeDeltaUnknown(
      'required owner closure is empty; no canonical owner projection can be bound',
      'docs/authority.json'
    ));
  }
  if (wholeDeltaScope === 'required-producer-bound') {
    wholeDeltaUnknowns.push(wholeDeltaUnknown(
      'canonical domain-owner projection receipts are not yet available; exact document digests cannot self-certify domain semantics',
      'docs/authority.json'
    ));
  }
  const consumersByRef = new Map<string, DevelopmentCriticalPathWholeDeltaConsumerV1>();
  const addConsumer = (consumer: DevelopmentCriticalPathWholeDeltaConsumerV1): void => {
    const prior = consumersByRef.get(consumer.consumerRef);
    if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(consumer)) {
      wholeDeltaUnknowns.push(wholeDeltaUnknown(
        `consumer reference has conflicting exact inputs: ${consumer.consumerRef}`,
        consumer.sourceLocations[0] ?? 'docs/authority.json'
      ));
      return;
    }
    consumersByRef.set(consumer.consumerRef, consumer);
  };
  const ownerDocumentsById = new Map(ownerDocuments.map((document) => [document.id, document] as const));
  const ownerProjections: DevelopmentCriticalPathWholeDeltaOwnerProjectionV1[] = [];
  for (const owner of requiredOwners) {
    const document = ownerDocumentsById.get(owner.recordId);
    if (document === undefined) continue;
    const consumerRef = `owner-claim:${owner.recordId}`;
    addConsumer(wholeDeltaConsumerV1({
      consumerRef,
      sourceLocations: [owner.path],
      inputDigest: document.digest,
      required: true
    }));
    ownerProjections.push(wholeDeltaOwnerProjectionV1({
      owner,
      producer: producerBinding,
      consumerRefs: [consumerRef],
      required: true
    }));
  }
  for (const change of exactChanges.changes) {
    addConsumer(wholeDeltaConsumerV1({
      consumerRef: `delta:${change.status}:${change.path}`,
      sourceLocations: [change.path, ...(change.previousPath === null ? [] : [change.previousPath])],
      inputDigest: change.changeDigest,
      required: wholeDeltaScope === 'required-producer-bound'
    }));
  }
  for (const member of plan.action.inputClosure) {
    addConsumer(wholeDeltaConsumerV1({
      consumerRef: `action-input:${member.path}`,
      sourceLocations: [member.path],
      inputDigest: member.digest as DevelopmentCriticalPathDigest,
      // The exact digest is sufficient for bounded Action admission. Domain
      // owner projection becomes mandatory only for the stronger required
      // proof scope; otherwise every ordinary toolchain blob would create a
      // fake owner/consumer gap and make bounded execution impossible.
      required: wholeDeltaScope === 'required-producer-bound'
    }));
  }
  const baseInventoryByPath = baseInventory === null
    ? null
    : new Map(baseInventory.map((entry) => [entry.path, entry] as const));
  for (const ownedPath of manifest?.tasks.flatMap(({ ownedPaths }) => ownedPaths) ?? []) {
    const entry = census.byPath.get(ownedPath);
    const presence = classifyDevelopmentCriticalPathManifestOwnedPathPresenceV1({
      ownedPath,
      headObjectId: entry?.objectId ?? null,
      baseObjectId: baseInventoryByPath === null
        ? undefined
        : baseInventoryByPath.get(ownedPath)?.objectId ?? null,
      changes: exactChanges.changes
    });
    if (presence === 'missing-unproven') {
      wholeDeltaUnknowns.push(wholeDeltaUnknown(
        `manifest-owned-path-absent:${ownedPath}`,
        ownedPath,
        'pre-effect'
      ));
    }
    addConsumer(wholeDeltaConsumerV1({
      consumerRef: `manifest-owned:${ownedPath}`,
      sourceLocations: [ownedPath],
      inputDigest: entry === undefined
        ? sha256({ path: ownedPath, headObjectId: null }) as DevelopmentCriticalPathDigest
        : sha256({ path: ownedPath, headObjectId: entry.objectId }) as DevelopmentCriticalPathDigest,
      required: wholeDeltaScope === 'required-producer-bound'
    }));
  }
  const wholeDeltaInput = {
    scope: wholeDeltaScope,
    base: baseRevisionFact,
    head: headRevisionFact,
    changes: exactChanges.changes,
    requiredOwners,
    ownerProjections,
    consumers: Object.freeze([...consumersByRef.values()]),
    producer: producerBinding,
    unknowns: Object.freeze(wholeDeltaUnknowns)
  } satisfies Parameters<typeof createDevelopmentCriticalPathWholeDeltaSubjectV1>[0];
  const observedWholeDelta = createDevelopmentCriticalPathWholeDeltaSubjectV1(wholeDeltaInput);
  const nonMisleadingProjection: DevelopmentCriticalPathNonMisleadingProjectionV1 =
    compileDevelopmentCriticalPathNonMisleadingProjectionV1({
      receipts: [
        {
          stage: 'observed',
          kind: 'observation-receipt',
          sourceDigest: sha256({
            base: observedWholeDelta.base,
            head: observedWholeDelta.head,
            changes: observedWholeDelta.changes,
            fixedPointDigest: observedWholeDelta.fixedPointDigest
          }) as DevelopmentCriticalPathDigest,
          receiptDigest: sha256({
            stage: 'observed',
            kind: 'observation-receipt',
            sourceDigest: sha256({
              base: observedWholeDelta.base,
              head: observedWholeDelta.head,
              changes: observedWholeDelta.changes,
              fixedPointDigest: observedWholeDelta.fixedPointDigest
            }) as DevelopmentCriticalPathDigest
          }) as DevelopmentCriticalPathDigest
        },
        {
          stage: 'inferred',
          kind: 'inference-receipt',
          sourceDigest: observedWholeDelta.fixedPointDigest,
          receiptDigest: sha256({
            stage: 'inferred',
            kind: 'inference-receipt',
            sourceDigest: observedWholeDelta.fixedPointDigest
          }) as DevelopmentCriticalPathDigest
        },
        {
          stage: 'planned',
          kind: 'plan-receipt',
          sourceDigest: actionPlanDigest,
          receiptDigest: sha256({
            stage: 'planned',
            kind: 'plan-receipt',
            sourceDigest: actionPlanDigest
          }) as DevelopmentCriticalPathDigest
        }
      ]
    });
  const wholeDelta = createDevelopmentCriticalPathWholeDeltaSubjectV1({
    ...wholeDeltaInput,
    nonMisleadingProjection
  });
  const relevantPaths = new Set<string>([
    ...plan.action.inputClosure.map(({ path: inputPath }) => inputPath),
    ...(manifest?.tasks.flatMap(({ ownedPaths }) => ownedPaths) ?? []),
    ...ownerClosure.map(({ path: ownerPath }) => ownerPath)
  ]);
  const unsupportedRelevantCode = inventory.filter(({ path: inputPath }) =>
    relevantPaths.has(inputPath)
    && /\.(?:py|ps1|sh|bash|cmd|bat|rs|go|java|kt|cs|cpp|c|h)$/u.test(inputPath)
  ).map(({ path: inputPath, objectId }) => ({ path: inputPath, objectId }));
  const unresolvedRelevantModuleFiles = graphBoundary.unresolvedModuleFiles
    .filter((modulePath) => relevantPaths.has(modulePath));
  const moduleUnknowns = unresolvedRelevantModuleFiles.length === 0
    ? []
    : [unknownFor(
      'imports-consumers',
      'module graph contains unresolved relevant modules',
      'test-impact module graph',
      'pre-effect',
      'resolved exact module graph'
    )];
  const dimensionInputs: Record<DevelopmentCriticalPathStaticClosureDimensionV1, ReturnType<typeof observedDimension>> = {
    'public-contract': observedDimension('public-contract', Object.freeze({
      ...common,
      contracts: publicContracts,
      candidateHints: publicContracts,
      parserValidated: true
    }), publicContracts.length === 0 ? ['public-contract-owner-absent'] : [],
      candidateHintUnknown('public-contract', 'public-contract regex candidates'),
      'tracked-owner-surface-exhausted', 'candidate-hint'),
    'authority-owner': observedDimension('authority-owner', Object.freeze({
      ...common,
      authorityRefs: manifest?.authorityRefs ?? [],
      ownerClosure: ownerDocuments,
      registryParserValidated: true,
      manifestOwnershipParserValidated: manifest !== null
    }), ownerClosure.length === 0 ? ['authority-owner-closure-empty'] : []),
    'imports-consumers': observedDimension('imports-consumers', Object.freeze({
      ...common,
      moduleFiles: graph.files,
      reverseEdges: graph.references,
      unresolvedModuleFiles: unresolvedRelevantModuleFiles
    }), [], moduleUnknowns, moduleUnknowns.length === 0
      ? 'tracked-owner-surface-exhausted' : 'module-graph-unresolved'),
    'dependency-closure': observedDimension('dependency-closure', Object.freeze({
      ...common,
      inputClosure: plan.action.inputClosure,
      dependencies: plan.dependencies,
      packageInputs: pathsMatching(/^(?:bun\.lock|package\.json|bunfig\.toml|platform\/shared\/runtime-dependency-spec\.ts)$/u),
      actionPlanParserValidated: true
    }), plan.action.inputClosure.length === 0 ? ['tracked-input-closure-empty'] : []),
    'state-transitions': observedDimension('state-transitions', Object.freeze({
      ...common,
      candidateHints: stateOwners
    }), stateOwners.length === 0 ? ['state-transition-owner-absent'] : [],
      candidateHintUnknown('state-transitions', 'state-transition regex candidates'),
      'tracked-owner-surface-exhausted', 'candidate-hint'),
    'effect-capabilities': observedDimension('effect-capabilities', Object.freeze({
      ...common,
      operation: plan.action.operation,
      environment: plan.action.environment,
      candidateHints: effectShells,
      actionKeyParserValidated: true
    }), effectShells.length === 0 ? ['effect-capability-surface-empty'] : [],
      candidateHintUnknown('effect-capabilities', 'effect-shell regex candidates'),
      'tracked-owner-surface-exhausted', 'candidate-hint'),
    'storage-current': observedDimension('storage-current', Object.freeze({
      ...common,
      candidateHints: storageOwners
    }), storageOwners.length === 0 ? ['storage-current-owner-absent'] : [],
      candidateHintUnknown('storage-current', 'storage-owner regex candidates'),
      'tracked-owner-surface-exhausted', 'candidate-hint'),
    'resource-budget-timeout': observedDimension('resource-budget-timeout', Object.freeze({
      ...common,
      candidateHints: resourceOwners
    }), resourceOwners.length === 0 ? ['resource-budget-owner-absent'] : [],
      candidateHintUnknown('resource-budget-timeout', 'resource-owner regex candidates'),
      'tracked-owner-surface-exhausted', 'candidate-hint'),
    'retention-retirement': observedDimension('retention-retirement', Object.freeze({
      ...common,
      candidateHints: lifecycleOwners
    }), lifecycleOwners.length === 0 ? ['retention-retirement-owner-absent'] : [],
      candidateHintUnknown('retention-retirement', 'lifecycle-owner regex candidates'),
      'tracked-owner-surface-exhausted', 'candidate-hint'),
    'dynamic-static-publication': observedDimension('dynamic-static-publication', Object.freeze({
      ...common,
      candidateHints: publicationOwners,
      producerSourceDigest,
      producerRuntimeBytesBound: true
    }), publicationOwners.length === 0 ? ['static-publication-owner-absent'] : [],
      candidateHintUnknown('dynamic-static-publication', 'publication-owner regex candidates'),
      'tracked-owner-surface-exhausted', 'candidate-hint'),
    'documentation-projection': observedDimension('documentation-projection', Object.freeze({
      ...common,
      manifestPath: manifestPath ?? null,
      documentationOwners: ownerDocuments
    }), ownerClosure.length === 0 ? ['documentation-owner-closure-empty'] : []),
    'unknown-ledger': observedDimension('unknown-ledger', Object.freeze({
      ...common,
      unresolvedModuleFiles: unresolvedRelevantModuleFiles,
      unsupportedRelevantCode
    }), [], unsupportedRelevantCode.length === 0 ? [] : [unknownFor(
      'unknown-ledger',
      'relevant source language has no exact parser producer',
      unsupportedRelevantCode.map(({ path: inputPath }) => inputPath).join(', ')
    )])
  };
  const result = createDevelopmentCriticalPathStaticAnalysisReadbackV2({
    producerSourceDigest,
    repository: Object.freeze({
      headSha,
      headTreeSha,
      objectFormat: canonicalObjectFormat,
      // This is the immutable object-tree subject, not the mutable worktree.
      // Physical execution cleanliness is proved by the provider capability.
      trackedClean: true,
      trackedPathCount: inventory.length,
      trackedByteCount,
      inventoryDigest
    }),
    manifest: Object.freeze({
      path: manifestPath ?? '<system-static-analysis>',
      digest: manifestDigest,
      authorityRefsDigest: sha256(manifest?.authorityRefs ?? []) as DevelopmentCriticalPathDigest,
      ownedPathsDigest: sha256(manifest?.tasks.flatMap(({ ownedPaths }) => ownedPaths) ?? []) as DevelopmentCriticalPathDigest,
      forbiddenPathsDigest: sha256(manifest?.forbiddenPaths ?? []) as DevelopmentCriticalPathDigest
    }),
    ownerRegistry: Object.freeze({
      digest: rawSha256(registryBytes),
      ownerClosureDigest: sha256(ownerDocuments) as DevelopmentCriticalPathDigest,
      recordsDigest: sha256(ownerRecords) as DevelopmentCriticalPathDigest,
      records: ownerRecords
    }),
    actionKey: plan.action.actionKey,
    actionPlanDigest: sha256(plan) as DevelopmentCriticalPathDigest,
    actionPlanClosureDigest: input.actionPlanClosureDigest,
    producerClosurePaths: census.producerClosurePaths,
    producerClosureDigest: census.producerClosureDigest,
    sourceInventoryDigest: inventoryDigest,
    moduleGraphDigest,
    unresolvedModuleFiles: unresolvedRelevantModuleFiles,
    proofScope: wholeDeltaScope === 'required-producer-bound'
      ? Object.freeze({
          kind: 'required' as const,
          scopeDigest: wholeDelta.fixedPointDigest,
          producer: producerBinding
        })
      : Object.freeze({
          kind: 'bounded-action-admission' as const,
          scopeDigest: input.actionPlanClosureDigest
        }),
    wholeDelta,
    dimensionInputs
  });
  if (resolveExactHeadCommit(repositoryRoot) !== headSha
      || readGitTreeRevision(repositoryRoot) !== headTreeSha) {
    fail('repository changed during static analysis readback.');
  }
  rememberBounded(staticAnalysisCache, cacheKey, result, STATIC_ANALYSIS_CACHE_LIMIT);
  return issueStaticAnalysisAuthorityV2(repositoryRoot, result, census);
}

/**
 * Trusted consumer entry point: derive the expected identity from the exact
 * repository supplied to the runner, then let the analyzer re-read and bind it
 * before any journal or physical Effect.  Consumers do not manufacture or
 * transport static-analysis DTOs.
 */
export function analyzeDevelopmentCriticalPathStaticClosureForRepositoryV2(input: Readonly<{
  repositoryRoot: string;
  plan: VerificationActionPlanV2;
  actionPlanClosureDigest: DevelopmentCriticalPathDigest;
  manifestPath?: string;
}>): DevelopmentCriticalPathStaticAnalysisAuthorityV2 {
  const repositoryRoot = realpathSync.native(input.repositoryRoot);
  const expectedHeadSha = resolveExactHeadCommit(repositoryRoot);
  const expectedHeadTreeSha = readGitTreeRevision(repositoryRoot);
  if (expectedHeadTreeSha === null) fail('runner static analyzer could not resolve the exact HEAD tree.');
  return analyzeDevelopmentCriticalPathStaticClosureV2({
    ...input,
    repositoryRoot,
    expectedHeadSha,
    expectedHeadTreeSha
  });
}

function digest(value: unknown, label: string): DevelopmentCriticalPathDigest {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    fail(`${label} must be a SHA-256 digest.`);
  }
  return value as DevelopmentCriticalPathDigest;
}

function actionKey(value: unknown): VerificationActionKeyV2 {
  try {
    return parseVerificationActionKeyV2(encodeVerificationActionDataV2(value));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function lastObservationDigest(
  journal: VerificationActionJournalReadbackV2
): DevelopmentCriticalPathDigest | null {
  const event = journal.events.at(-1);
  return event === undefined ? null : digest(event.eventDigest, 'journal eventDigest');
}

function journalState(
  journal: VerificationActionJournalReadbackV2
): VerificationActionJournalStateV2 | null {
  return journal.latestState;
}

/**
 * Convert one existing journal readback into the spine's five-way observation
 * input.  This function deliberately does not infer authentication from a
 * path, timestamp, process, or `running` state.
 */
export function observeDevelopmentCriticalPathActionV1(
  input: DevelopmentCriticalPathActionJournalObservationV1
): DevelopmentCriticalPathActionObservationV1 {
  const action = actionKey(input.action);
  const journal = input.journal;
  if (journal.action !== null && journal.action.actionKey !== action.actionKey) {
    return createDevelopmentCriticalPathActionObservationV1({
      actionKey: action.actionKey,
      state: 'unknown',
      observationDigest: lastObservationDigest(journal),
      reasonCode: 'journal-action-key-mismatch'
    }, action.actionKey);
  }
  if (journal.schemaState !== 'current') {
    return createDevelopmentCriticalPathActionObservationV1({
      actionKey: action.actionKey,
      state: 'unknown',
      observationDigest: lastObservationDigest(journal),
      reasonCode: 'journal-schema-stale'
    }, action.actionKey);
  }
  const state = journalState(journal);
  if (state === null) {
    return createDevelopmentCriticalPathActionObservationV1({
      actionKey: action.actionKey,
      state: 'missing'
    }, action.actionKey);
  }
  if (state === 'terminal' || state === 'reused') {
    if (journal.terminal === null) {
      return createDevelopmentCriticalPathActionObservationV1({
        actionKey: action.actionKey,
        state: 'unknown',
        observationDigest: lastObservationDigest(journal),
        reasonCode: 'terminal-without-result'
      }, action.actionKey);
    }
    const observationDigest = lastObservationDigest(journal);
    if (observationDigest === null) {
      return createDevelopmentCriticalPathActionObservationV1({
        actionKey: action.actionKey,
        state: 'unknown',
        observationDigest: null,
        reasonCode: 'terminal-without-observation'
      }, action.actionKey);
    }
    return createDevelopmentCriticalPathActionObservationV1({
      actionKey: action.actionKey,
      state: 'terminal',
      observationDigest,
      terminal: journal.terminal
    }, action.actionKey);
  }
  if (state === 'invalidated' || state === 'cancelled') {
    const observationDigest = lastObservationDigest(journal);
    if (observationDigest === null) {
      return createDevelopmentCriticalPathActionObservationV1({
        actionKey: action.actionKey,
        state: 'unknown',
        observationDigest: null,
        reasonCode: `${state}-without-observation`
      }, action.actionKey);
    }
    return createDevelopmentCriticalPathActionObservationV1({
      actionKey: action.actionKey,
      state: 'stale',
      observationDigest,
      reasonCode: state
    }, action.actionKey);
  }
  if (state === 'queued' || state === 'running') {
    const evidence = input.inFlight;
    if (evidence === null || evidence.actionKey !== action.actionKey) {
      return createDevelopmentCriticalPathActionObservationV1({
        actionKey: action.actionKey,
        state: 'unknown',
        observationDigest: lastObservationDigest(journal),
        reasonCode: 'in-flight-claim-unbound'
      }, action.actionKey);
    }
    return createDevelopmentCriticalPathActionObservationV1({
      actionKey: action.actionKey,
      state: 'in-flight',
      claimDigest: digest(evidence.claimDigest, 'inFlight.claimDigest'),
      authenticated: evidence.authenticated
    }, action.actionKey);
  }
  return createDevelopmentCriticalPathActionObservationV1({
    actionKey: action.actionKey,
    state: 'unknown',
    observationDigest: lastObservationDigest(journal),
    reasonCode: 'journal-state-unknown'
  }, action.actionKey);
}

type ComposeDevelopmentCriticalPathObservationInputV1 =
  | Readonly<{
      /** Mutable runtime observation produced by the existing journal owner. */
      readonly journal: VerificationActionJournalReadbackV2;
      readonly inFlight: DevelopmentCriticalPathInFlightEvidenceV1 | null;
      readonly observation?: never;
    }>
  | Readonly<{
      /** Immutable terminal observation produced by an authenticated Evidence owner. */
      readonly observation: DevelopmentCriticalPathActionObservationV1;
      readonly journal?: never;
      readonly inFlight?: never;
    }>;

export type ComposeDevelopmentCriticalPathInputV1 = Readonly<{
  /** Content-addressed exact static census; no physical Action starts without a closed projection. */
  readonly staticClosure: DevelopmentCriticalPathStaticClosureV1;
  readonly action: VerificationActionKeyV2;
  /** Canonical action plan from the existing VerificationAction owner. */
  readonly plan: VerificationActionPlanV2;
  readonly dependencies: readonly VerificationActionDependencyResolutionV2[];
  /** Independent stable identities; branch/PR/transport are intentionally absent. */
  readonly main: DevelopmentCriticalPathMainIdentityV1;
  readonly candidate: DevelopmentCriticalPathMainIdentityV1;
  /** Raw owner ledger plus exact identity context; the canonical owner resolver is mandatory. */
  readonly mainHealth: DevelopmentCriticalPathMainHealthObservationV1;
  /** Canonical environment owner plan bound to its spec and observation. */
  readonly environment: DevelopmentCriticalPathEnvironmentFactV1;
  /** Canonical provider capability owner fact; no structural capability cast. */
  readonly provider: DevelopmentCriticalPathProviderFactV1;
  readonly retirement?: Readonly<{
    readonly owners: readonly DevelopmentCriticalPathRetirementOwnerFactV1[];
    readonly activeNamespaces: readonly string[];
    readonly unknowns: readonly string[];
  }>;
}> & ComposeDevelopmentCriticalPathObservationInputV1;

/** Compose current owner observations without starting any physical Action. */
export function composeDevelopmentCriticalPathV1(
  input: ComposeDevelopmentCriticalPathInputV1
): DevelopmentCriticalPathProjectionV1 {
  const action = actionKey(input.action);
  const observation = 'observation' in input && input.observation !== undefined
    ? createDevelopmentCriticalPathActionObservationV1(input.observation, action.actionKey)
    : observeDevelopmentCriticalPathActionV1({
        action,
        journal: input.journal,
        inFlight: input.inFlight
      });
  const mainDelta = compileDevelopmentCriticalPathMainDeltaV1({
    main: input.main,
    candidate: input.candidate
  });
  return compileDevelopmentCriticalPathV1({
    staticClosure: input.staticClosure,
    action,
    plan: input.plan,
    observation,
    dependencies: input.dependencies,
    mainDelta,
    mainHealth: input.mainHealth,
    environment: input.environment,
    provider: input.provider,
    retirement: input.retirement
  });
}
