#!/usr/bin/env bun

import path from 'node:path';

import { withAuthorityGitReadSession } from '../../external-capabilities/git-read/authority.ts';
import {
  CodexDevelopmentListExactGitTreeEntriesFromSession,
  CodexDevelopmentReadExactGitBlobBytesBatchFromSession,
  type CodexDevelopmentExactGitTreeEntry
} from '../../external-capabilities/git-read/exact-blob.ts';
import {
  GIT_READ_EXACT_TREE_OPERATION_BUDGET,
  type GitReadSession
} from '../../external-capabilities/git-read/runtime/session.ts';
import {
  compareCodeUnits,
  rawSha256,
  sha256
} from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  parseDocumentationAuthorityRegistry,
  type DocumentationAuthorityRegistry
} from './authority.ts';
import {
  compileDocumentationSemanticGraph,
  unavailableDocumentationAdmissionProjection
} from './compiler.ts';
import {
  compileDocumentationMigrationDesign,
  deriveDocumentationMigrationGenerationBinding,
  DOCUMENTATION_MIGRATION_SOURCE_PROVIDER_REF,
  DOCUMENTATION_MIGRATION_TARGET_CONTRACT_DIGEST,
  encodeDocumentationMigrationDesign,
  issueDocumentationMigrationConsumerCensus,
  type DocumentationMigrationCorpusEntry,
  type DocumentationMigrationDesign
} from './migration.ts';

const MAX_TRACKED_LIST_BYTES = 16 * 1024 * 1024;
const MAX_TRACKED_BLOB_BYTES = 32 * 1024 * 1024;
const MAX_TRACKED_TOTAL_BLOB_BYTES = 256 * 1024 * 1024;

function fail(message: string): never {
  throw new Error(`documentation migration plan: ${message}`);
}

async function runGitBuffer(
  session: GitReadSession,
  args: readonly string[],
  label: string
): Promise<Buffer> {
  const result = await session.run(args);
  if (result.kind !== 'completed') {
    fail(`${label} was blocked: ${result.reason}`);
  }
  if (result.result.code !== 0) {
    fail(`${label} failed: ${result.result.stderr.trim() || `exit ${result.result.code}`}`);
  }
  return Buffer.from(result.result.stdout);
}

async function currentRevision(session: GitReadSession): Promise<string> {
  const source = (await runGitBuffer(
    session,
    ['rev-parse', '--verify', 'HEAD^{commit}'],
    'current revision resolution'
  )).toString('utf8').trim();
  if (!/^[0-9a-f]{40,64}$/u.test(source)) fail(`current revision is noncanonical: ${source}`);
  return source;
}

function listTrackedDocumentationPaths(
  entries: readonly CodexDevelopmentExactGitTreeEntry[]
): readonly string[] {
  const paths = entries
    .map(({ repositoryPath }) => repositoryPath)
    .filter((repositoryPath) => (
      repositoryPath === 'README.md'
      || repositoryPath === 'AGENTS.md'
      || repositoryPath.startsWith('docs/')
    ));
  const sorted = [...paths].sort(compareCodeUnits);
  if (new Set(paths).size !== paths.length
      || sorted.some((entry, index) => entry !== paths[index])) {
    fail('tracked documentation census must be unique and sorted.');
  }
  return Object.freeze(paths);
}

function registryByPath(registry: DocumentationAuthorityRegistry): ReadonlyMap<string, string> {
  const entries = registry.documents.map((record) => [record.path, record.id] as const);
  if (new Set(entries.map(([repositoryPath]) => repositoryPath)).size !== entries.length) {
    fail('documentation registry contains duplicate paths.');
  }
  return new Map(entries);
}

async function readTrackedTreeEntries(
  session: GitReadSession,
  revision: string,
): Promise<readonly CodexDevelopmentExactGitTreeEntry[]> {
  return CodexDevelopmentListExactGitTreeEntriesFromSession(session, revision);
}

async function readTrackedFiles(
  session: GitReadSession,
  entries: readonly CodexDevelopmentExactGitTreeEntry[],
  paths: readonly string[]
): Promise<ReadonlyMap<string, Uint8Array>> {
  if (paths.length === 0) return new Map();
  const entriesByPath = new Map(entries.map((entry) => [entry.repositoryPath, entry] as const));
  const selectedEntries = paths.map((repositoryPath) => {
    const entry = entriesByPath.get(repositoryPath);
    if (entry === undefined) fail(`tracked path disappeared during census: ${repositoryPath}`);
    return entry;
  });
  const blobs = await CodexDevelopmentReadExactGitBlobBytesBatchFromSession(session, {
    entries: selectedEntries,
    maxTotalBytes: MAX_TRACKED_TOTAL_BLOB_BYTES
  });
  if (blobs.length !== selectedEntries.length) {
    fail(`tracked blob census returned ${blobs.length} blobs for ${selectedEntries.length} requested paths.`);
  }
  const files = new Map<string, Uint8Array>();
  let totalBytes = 0;
  for (const blob of blobs) {
    if (blob.byteLength > MAX_TRACKED_BLOB_BYTES) {
      fail(`tracked blob ${blob.repositoryPath} exceeds ${MAX_TRACKED_BLOB_BYTES} bytes.`);
    }
    totalBytes += blob.byteLength;
    if (totalBytes > MAX_TRACKED_TOTAL_BLOB_BYTES) {
      fail(`tracked blob census exceeds ${MAX_TRACKED_TOTAL_BLOB_BYTES} bytes.`);
    }
    if (files.has(blob.repositoryPath)) fail(`tracked blob census contains duplicate path: ${blob.repositoryPath}`);
    files.set(blob.repositoryPath, blob.bytes);
  }
  return files;
}

async function readTrackedConsumerPaths(
  session: GitReadSession,
  revision: string,
  documentationPaths: readonly string[]
): Promise<readonly string[]> {
  const patterns = documentationPaths.flatMap((repositoryPath) => ['-e', repositoryPath]);
  const result = await session.run([
    'grep', '-l', '-F', '-z', ...patterns, revision, '--', '.'
  ]);
  if (result.kind !== 'completed') {
    fail(`tracked consumer census was blocked: ${result.reason}`);
  }
  if (result.result.code === 1) return Object.freeze([]);
  if (result.result.code !== 0) {
    fail(`tracked consumer census failed: ${result.result.stderr.trim() || `exit ${result.result.code}`}`);
  }
  const source = Buffer.from(result.result.stdout);
  if (source.length === 0) return Object.freeze([]);
  if (source.length > MAX_TRACKED_LIST_BYTES) {
    fail(`tracked consumer census exceeds ${MAX_TRACKED_LIST_BYTES} bytes.`);
  }
  if (source[source.length - 1] !== 0) fail('tracked consumer census is not NUL terminated.');
  const revisionPrefix = `${revision}:`;
  const paths = source.toString('utf8').slice(0, -1).split('\0').map((entry) => {
    if (!entry.startsWith(revisionPrefix)) {
      fail(`tracked consumer census returned an unexpected revision prefix: ${entry}`);
    }
    const repositoryPath = entry.slice(revisionPrefix.length);
    if (repositoryPath.length === 0 || repositoryPath.includes('\0') || repositoryPath.includes('\\')) {
      fail(`tracked consumer census returned a noncanonical path: ${JSON.stringify(repositoryPath)}`);
    }
    return repositoryPath;
  });
  const sorted = [...paths].sort(compareCodeUnits);
  if (new Set(paths).size !== paths.length
      || sorted.some((entry, index) => entry !== paths[index])) {
    fail('tracked consumer census must be unique and sorted.');
  }
  return Object.freeze(paths);
}

function localConsumerRefs(
  repositoryPath: string,
  trackedFiles: ReadonlyMap<string, Uint8Array>
): readonly string[] {
  const needle = Buffer.from(repositoryPath, 'utf8');
  return Object.freeze([...trackedFiles.entries()]
    .filter(([candidatePath, bytes]) => candidatePath !== repositoryPath
      && Buffer.from(bytes).indexOf(needle) >= 0)
    .map(([candidatePath]) => `tracked:${sha256(candidatePath).slice('sha256:'.length)}`)
    .sort(compareCodeUnits));
}

interface DocumentationMigrationCorpusCensus {
  readonly corpus: readonly DocumentationMigrationCorpusEntry[];
  readonly trackedFiles: ReadonlyMap<string, Uint8Array>;
}

function collectDocumentationMigrationCorpusWithFiles(input: Readonly<{
  readonly registry: DocumentationAuthorityRegistry;
  readonly documentationPaths: readonly string[];
  readonly trackedFiles: ReadonlyMap<string, Uint8Array>;
  readonly consumerFiles: ReadonlyMap<string, Uint8Array>;
}>): DocumentationMigrationCorpusCensus {
  const paths = input.documentationPaths;
  const trackedFiles = input.trackedFiles;
  const idsByPath = registryByPath(input.registry);
  const corpus = paths.map((repositoryPath): DocumentationMigrationCorpusEntry => {
    const registryId = idsByPath.get(repositoryPath);
    const status = registryId !== undefined
      ? 'tracked-registered'
      : 'tracked-unclassified';
    const bytes = trackedFiles.get(repositoryPath);
    if (bytes === undefined) fail(`tracked path disappeared during census: ${repositoryPath}`);
    return Object.freeze({
      path: repositoryPath,
      status,
      registryId: registryId ?? null,
      contentDigest: rawSha256(bytes),
      consumerRefs: localConsumerRefs(repositoryPath, input.consumerFiles),
      // This command observes literal references only.  It deliberately does
      // not claim that dynamic, generated, or external local consumers are
      // absent; a complete owner-issued census is required for cutover.
      localConsumerCoverageStatus: 'unknown',
      externalConsumerStatus: 'unknown'
    });
  });
  return Object.freeze({ corpus: Object.freeze(corpus), trackedFiles });
}

export async function collectDocumentationMigrationCorpus(input: Readonly<{
  readonly repositoryRoot: string;
  readonly registry: DocumentationAuthorityRegistry;
  readonly revision: string;
}>): Promise<readonly DocumentationMigrationCorpusEntry[]> {
  const root = path.resolve(input.repositoryRoot);
  return withAuthorityGitReadSession({
    cwd: root,
    budget: GIT_READ_EXACT_TREE_OPERATION_BUDGET
  }, async (session) => {
    const entries = await readTrackedTreeEntries(session, input.revision);
    const documentationPaths = listTrackedDocumentationPaths(entries);
    const trackedFiles = await readTrackedFiles(session, entries, documentationPaths);
    const consumerPaths = await readTrackedConsumerPaths(
      session,
      input.revision,
      documentationPaths
    );
    const consumerFiles = await readTrackedFiles(session, entries, consumerPaths);
    return collectDocumentationMigrationCorpusWithFiles({
      registry: input.registry,
      documentationPaths,
      trackedFiles,
      consumerFiles
    }).corpus;
  });
}

export interface DocumentationMigrationPlanSnapshot {
  readonly sourceRevision: string;
  readonly design: DocumentationMigrationDesign;
}

export async function compileCurrentRevisionDocumentationMigrationPlan(
  repositoryRoot: string
): Promise<DocumentationMigrationPlanSnapshot> {
  const root = path.resolve(repositoryRoot);
  return withAuthorityGitReadSession({
    cwd: root,
    budget: GIT_READ_EXACT_TREE_OPERATION_BUDGET
  }, async (session) => {
    const revision = await currentRevision(session);
    const entries = await readTrackedTreeEntries(session, revision);
    const documentationPaths = listTrackedDocumentationPaths(entries);
    const trackedFiles = await readTrackedFiles(session, entries, documentationPaths);
    const consumerPaths = await readTrackedConsumerPaths(session, revision, documentationPaths);
    const consumerFiles = await readTrackedFiles(session, entries, consumerPaths);
    const registryBytes = trackedFiles.get('docs/authority.json');
    if (registryBytes === undefined) fail('current revision does not contain docs/authority.json');
    const registry = parseDocumentationAuthorityRegistry(Buffer.from(registryBytes).toString('utf8'));
    const census = collectDocumentationMigrationCorpusWithFiles({
      registry,
      documentationPaths,
      trackedFiles,
      consumerFiles
    });
    const sourceRecords = registry.documents
      .filter((record) => (
        (record.kind === 'authority' || record.kind === 'corpus-contract')
        && record.lifecycle === 'stable'
      ))
      .sort((left, right) => compareCodeUnits(left.id, right.id));
    const sources = sourceRecords.map((record) => {
      const bytes = census.trackedFiles.get(record.path);
      if (bytes === undefined) fail(`source graph blob is missing for ${record.path}`);
      return { documentId: record.id, source: Buffer.from(bytes).toString('utf8') };
    });
    const sourceGraph = compileDocumentationSemanticGraph({
      trustedTree: revision,
      registry,
      sources,
      admission: unavailableDocumentationAdmissionProjection(revision)
    });
    const currentGenerationBinding = deriveDocumentationMigrationGenerationBinding({
      generationRef: revision,
      providerRef: DOCUMENTATION_MIGRATION_SOURCE_PROVIDER_REF,
      revisionOrSnapshotRef: revision,
      observationEpoch: revision,
      registry,
      corpus: census.corpus,
      sourceGraph
    });
    const consumerCensus = issueDocumentationMigrationConsumerCensus({
      generationBinding: currentGenerationBinding,
      entries: census.corpus
    });
    const design = compileDocumentationMigrationDesign({
      registry,
      targetContractDigest: DOCUMENTATION_MIGRATION_TARGET_CONTRACT_DIGEST,
      currentGenerationBinding,
      consumerCensus,
      sourceGraph
    });
    return Object.freeze({ sourceRevision: revision, design });
  });
}

function compactResult(snapshot: DocumentationMigrationPlanSnapshot): Record<string, unknown> {
  const { sourceRevision, design } = snapshot;
  const frontierByCode = Object.fromEntries(
    [...new Set(design.frontier.map(({ code }) => code))]
      .sort(compareCodeUnits)
      .map((code) => [code, design.frontier.filter((entry) => entry.code === code).length])
  );
  return {
    schema: design.schema,
    sourceRevision,
    status: design.status,
    currentRegistryDigest: design.currentRegistryDigest,
    currentCorpusDigest: design.currentCorpusDigest,
    sourceSemanticGraphDigest: design.sourceSemanticGraphDigest,
    sourceClauseDispositionDigest: design.sourceClauseDispositionDigest,
    sourceFrontierDigest: design.sourceFrontierDigest,
    currentGenerationBinding: design.currentGenerationBinding,
    targetContractDigest: design.targetContractDigest,
    designDigest: design.designDigest,
    preservationCount: design.preservation.length,
    frontierCount: design.frontier.length,
    frontierByCode
  };
}

if (import.meta.main) {
  const repositoryRoot = path.resolve(import.meta.dir, '../../..');
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const full = argv.includes('--full');
  if (argv.some((argument) => argument !== '--json' && argument !== '--full')) {
    console.error('usage: bun src/control/documentation/migration-cli.ts [--json] [--full]');
    process.exitCode = 2;
    throw new Error('unsupported argument');
  }
  try {
    const snapshot = await compileCurrentRevisionDocumentationMigrationPlan(repositoryRoot);
    const { sourceRevision, design } = snapshot;
    const output = full
      ? { sourceRevision, design: JSON.parse(encodeDocumentationMigrationDesign(design)) }
      : compactResult(snapshot);
    if (json || full) console.log(JSON.stringify(output));
    else console.log(`documentation migration plan: ${design.status} ${design.designDigest} (${design.frontier.length} frontier item(s))`);
    if (design.status === 'blocked') process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
