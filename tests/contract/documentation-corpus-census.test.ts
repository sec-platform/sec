import { spawnSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  parseDocumentationAuthorityRegistry
} from '../../platform/shared/documentation-authority-contract.ts';

const ROOT = path.resolve(import.meta.dir, '../..');
const DOCS_ROOT = path.join(ROOT, 'docs');
const DOCUMENT_EXTENSIONS = new Set(['.json', '.md', '.yaml', '.yml']);
const NON_ACTIVE_PREFIXES = [
  'docs/archive/',
  'docs/evidence/',
  'docs/scripts/SEC_docs_v5_replacement/',
  'docs/work-packages/'
] as const;
const GENERATED_PLANNING_PREFIXES = [
  'docs/superpowers/plans/',
  'docs/superpowers/specs/'
] as const;

function codeUnitSort(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function trackedPaths(): string[] {
  const result = spawnSync('git', ['ls-files', '-z'], {
    cwd: ROOT,
    encoding: 'buffer',
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    throw new Error(`git ls-files failed: ${Buffer.from(result.stderr ?? []).toString('utf8')}`);
  }
  const output = Buffer.from(result.stdout);
  if (output.byteLength > 0 && output[output.byteLength - 1] !== 0) {
    throw new Error('git ls-files did not return NUL-terminated paths.');
  }
  return output.byteLength === 0
    ? []
    : output.subarray(0, -1).toString('utf8').split('\0').sort(codeUnitSort);
}

function isDocumentationCandidate(file: string): boolean {
  const extension = path.posix.extname(file).toLowerCase();
  if (file.startsWith('docs/')) return DOCUMENT_EXTENSIONS.has(extension);
  return !file.includes('/') && extension === '.md';
}

function isGeneratedPlanningDocument(file: string): boolean {
  return GENERATED_PLANNING_PREFIXES.some((prefix) => file.startsWith(prefix));
}

function isExplicitlyNonActiveDocument(file: string): boolean {
  return NON_ACTIVE_PREFIXES.some((prefix) => file.startsWith(prefix)) ||
    isGeneratedPlanningDocument(file);
}

function excludedDocumentClaimsAuthority(file: string, source: string): boolean {
  const extension = path.posix.extname(file).toLowerCase();
  if (extension === '.json') {
    try {
      const value = JSON.parse(source) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const record = value as Record<string, unknown>;
      return record.schema === 'sec-document-authority-registry-v2' ||
        record.kind === 'authority' || record.kind === 'registry' || record.kind === 'proposal' ||
        record.lifecycle === 'active' || record.lifecycle === 'stable' || record.lifecycle === 'draft';
    } catch {
      return false;
    }
  }

  const authorityKind = /^kind:\s*(?:authority|registry|proposal)\s*$/mu.test(source);
  const lifecycle = /^(?:lifecycle|status):\s*(active|stable|draft)\s*$/mu.exec(source)?.[1];
  if (authorityKind || lifecycle === 'active' || lifecycle === 'stable') return true;
  return lifecycle === 'draft' && !isGeneratedPlanningDocument(file);
}

async function ordinaryTrackedFiles(files: readonly string[]): Promise<string[]> {
  const invalid: string[] = [];
  for (const file of files) {
    try {
      const metadata = await lstat(path.join(ROOT, file));
      if (!metadata.isFile() || metadata.isSymbolicLink()) invalid.push(file);
    } catch {
      invalid.push(file);
    }
  }
  return invalid;
}

test('every tracked active-looking repository document is registered or classified non-active', async () => {
  const registry = parseDocumentationAuthorityRegistry(
    await readFile(path.join(DOCS_ROOT, 'authority.json'), 'utf8')
  );
  const registered = new Set(registry.documents.map((document) => document.path));
  const candidates = trackedPaths().filter(isDocumentationCandidate);

  expect(await ordinaryTrackedFiles(candidates)).toEqual([]);
  expect(candidates.filter((file) =>
    !registered.has(file) && !isExplicitlyNonActiveDocument(file)
  )).toEqual([]);

  const invalidExcluded: string[] = [];
  for (const file of candidates.filter((candidate) =>
    !registered.has(candidate) && isExplicitlyNonActiveDocument(candidate)
  )) {
    const source = await readFile(path.join(ROOT, file), 'utf8');
    if (excludedDocumentClaimsAuthority(file, source)) invalidExcluded.push(file);
  }
  expect(invalidExcluded).toEqual([]);
});

test('registered documents exist as ordinary files within the registry path boundary', async () => {
  const registry = parseDocumentationAuthorityRegistry(
    await readFile(path.join(DOCS_ROOT, 'authority.json'), 'utf8')
  );
  const invalid: string[] = [];

  for (const document of registry.documents) {
    if (!document.path.startsWith('docs/') && document.path !== 'README.md' && document.path !== 'AGENTS.md') {
      invalid.push(document.path);
      continue;
    }
    try {
      const metadata = await lstat(path.join(ROOT, document.path));
      if (!metadata.isFile() || metadata.isSymbolicLink()) invalid.push(document.path);
    } catch {
      invalid.push(document.path);
    }
  }

  expect(invalid).toEqual([]);
});

test('every tracked proposal document uses the registered proposal lifecycle', async () => {
  const registry = parseDocumentationAuthorityRegistry(
    await readFile(path.join(DOCS_ROOT, 'authority.json'), 'utf8')
  );
  const registeredProposals = new Set(
    registry.documents
      .filter((document) => document.kind === 'proposal')
      .map((document) => document.path)
  );
  const proposalFiles = trackedPaths().filter((file) =>
    file.startsWith('docs/proposals/') && DOCUMENT_EXTENSIONS.has(path.posix.extname(file).toLowerCase())
  );

  expect(proposalFiles.filter((file) => !registeredProposals.has(file))).toEqual([]);
});
