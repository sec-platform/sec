#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { isolatedGitReadEnvironment } from '../../external-capabilities/git-read/runtime/session.ts';
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
  compileDocumentationMigrationDesign,
  DOCUMENTATION_MIGRATION_TARGET_CONTRACT_DIGEST,
  encodeDocumentationMigrationDesign,
  type DocumentationMigrationCorpusEntry,
  type DocumentationMigrationDesign
} from './migration.ts';

const MAX_TRACKED_LIST_BYTES = 16 * 1024 * 1024;

function fail(message: string): never {
  throw new Error(`documentation migration plan: ${message}`);
}

function canonicalTrackedPath(value: string): string {
  if (value.length === 0 || value.includes('\0') || value.includes('\\') || value !== value.normalize('NFC')) {
    fail(`Git returned a noncanonical path: ${JSON.stringify(value)}`);
  }
  return value;
}

function listTrackedPaths(
  repositoryRoot: string,
  pathspecs: readonly string[],
  label: string
): readonly string[] {
  const result = spawnSync(
    'git',
    ['ls-files', '-z', '--', ...pathspecs],
    {
      cwd: repositoryRoot,
      env: isolatedGitReadEnvironment(),
      encoding: 'buffer',
      maxBuffer: MAX_TRACKED_LIST_BYTES,
      windowsHide: true
    }
  );
  if (result.error || result.status !== 0 || result.stdout === undefined) {
    const detail = result.error?.message
      ?? Buffer.from(result.stderr ?? '').toString('utf8').trim()
      ?? `exit ${result.status ?? 1}`;
    fail(`${label} failed: ${detail}`);
  }
  const source = Buffer.from(result.stdout);
  if (source.length === 0 || source[source.length - 1] !== 0) {
    fail(`${label} is not NUL terminated.`);
  }
  const paths = source.toString('utf8').slice(0, -1).split('\0').map(canonicalTrackedPath);
  const sorted = [...paths].sort(compareCodeUnits);
  if (new Set(paths).size !== paths.length || sorted.some((entry, index) => entry !== paths[index])) {
    fail(`${label} must be unique and sorted.`);
  }
  return Object.freeze(paths);
}

function listTrackedDocumentationPaths(repositoryRoot: string): readonly string[] {
  const paths = listTrackedPaths(
    repositoryRoot,
    ['README.md', 'AGENTS.md', 'docs'],
    'tracked documentation census'
  );
  if (paths.some((repositoryPath) => (
    repositoryPath !== 'README.md'
    && repositoryPath !== 'AGENTS.md'
    && !repositoryPath.startsWith('docs/')
  ))) {
    fail('tracked documentation census contains a path outside its corpus.');
  }
  return paths;
}

function registryByPath(registry: DocumentationAuthorityRegistry): ReadonlyMap<string, string> {
  const entries = registry.documents.map((record) => [record.path, record.id] as const);
  if (new Set(entries.map(([repositoryPath]) => repositoryPath)).size !== entries.length) {
    fail('documentation registry contains duplicate paths.');
  }
  return new Map(entries);
}

async function readTrackedFiles(
  repositoryRoot: string,
  paths: readonly string[]
): Promise<ReadonlyMap<string, Uint8Array>> {
  const files = await Promise.all(paths.map(async (repositoryPath) => {
    const bytes = await fs.readFile(path.join(repositoryRoot, ...repositoryPath.split('/')));
    return [repositoryPath, bytes] as const;
  }));
  return new Map(files);
}

async function readTrackedConsumerFiles(
  repositoryRoot: string,
  documentationPaths: readonly string[]
): Promise<ReadonlyMap<string, Uint8Array>> {
  const patterns = documentationPaths.flatMap((repositoryPath) => ['-e', repositoryPath]);
  const result = spawnSync(
    'git',
    ['grep', '-l', '-F', '-z', ...patterns, '--', '.'],
    {
      cwd: repositoryRoot,
      env: isolatedGitReadEnvironment(),
      encoding: 'buffer',
      maxBuffer: MAX_TRACKED_LIST_BYTES,
      windowsHide: true
    }
  );
  if (result.error || (result.status !== 0 && result.status !== 1) || result.stdout === undefined) {
    const detail = result.error?.message
      ?? Buffer.from(result.stderr ?? '').toString('utf8').trim()
      ?? `exit ${result.status ?? 1}`;
    fail(`tracked consumer census failed: ${detail}`);
  }
  const source = Buffer.from(result.stdout);
  if (source.length === 0) return new Map();
  if (source[source.length - 1] !== 0) fail('tracked consumer census is not NUL terminated.');
  const paths = source.toString('utf8').slice(0, -1).split('\0').map(canonicalTrackedPath);
  const sorted = [...paths].sort(compareCodeUnits);
  if (new Set(paths).size !== paths.length || sorted.some((entry, index) => entry !== paths[index])) {
    fail('tracked consumer census must be unique and sorted.');
  }
  return readTrackedFiles(repositoryRoot, paths);
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

export async function collectDocumentationMigrationCorpus(input: Readonly<{
  readonly repositoryRoot: string;
  readonly registry: DocumentationAuthorityRegistry;
}>): Promise<readonly DocumentationMigrationCorpusEntry[]> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const paths = listTrackedDocumentationPaths(repositoryRoot);
  const trackedFiles = await readTrackedFiles(repositoryRoot, paths);
  const consumerFiles = await readTrackedConsumerFiles(repositoryRoot, paths);
  const idsByPath = registryByPath(input.registry);
  const corpus = paths.map((repositoryPath): DocumentationMigrationCorpusEntry => {
    const registryId = idsByPath.get(repositoryPath);
    const status = registryId !== undefined
      ? 'tracked-registered'
      : repositoryPath.startsWith('docs/work-packages/')
        ? 'tracked-non-active'
        : 'tracked-unclassified';
    const bytes = trackedFiles.get(repositoryPath);
    if (bytes === undefined) fail(`tracked path disappeared during census: ${repositoryPath}`);
    return Object.freeze({
      path: repositoryPath,
      status,
      registryId: registryId ?? null,
      contentDigest: rawSha256(bytes),
      consumerRefs: localConsumerRefs(repositoryPath, consumerFiles),
      externalConsumerStatus: 'unknown'
    });
  });
  return Object.freeze(corpus);
}

export async function compileWorkingTreeDocumentationMigrationPlan(
  repositoryRoot: string
): Promise<DocumentationMigrationDesign> {
  const root = path.resolve(repositoryRoot);
  const registrySource = await fs.readFile(path.join(root, 'docs/authority.json'), 'utf8');
  const registry = parseDocumentationAuthorityRegistry(registrySource);
  const corpus = await collectDocumentationMigrationCorpus({ repositoryRoot: root, registry });
  return compileDocumentationMigrationDesign({
    registry,
    registryDigest: sha256(registry) as `sha256:${string}`,
    targetContractDigest: DOCUMENTATION_MIGRATION_TARGET_CONTRACT_DIGEST,
    corpus
  });
}

function compactResult(design: DocumentationMigrationDesign): Record<string, unknown> {
  const frontierByCode = Object.fromEntries(
    [...new Set(design.frontier.map(({ code }) => code))]
      .sort(compareCodeUnits)
      .map((code) => [code, design.frontier.filter((entry) => entry.code === code).length])
  );
  return {
    schema: design.schema,
    status: design.status,
    currentRegistryDigest: design.currentRegistryDigest,
    currentCorpusDigest: design.currentCorpusDigest,
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
    const design = await compileWorkingTreeDocumentationMigrationPlan(repositoryRoot);
    const output = full ? JSON.parse(encodeDocumentationMigrationDesign(design)) : compactResult(design);
    if (json || full) console.log(JSON.stringify(output));
    else console.log(`documentation migration plan: ${design.status} ${design.designDigest} (${design.frontier.length} frontier item(s))`);
    if (design.status === 'blocked') process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
