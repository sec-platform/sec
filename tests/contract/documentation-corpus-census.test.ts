import { lstat, readdir, readFile } from 'node:fs/promises';
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
  'docs/work-packages/'
] as const;

async function collectDocumentationFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectDocumentationFiles(absolute));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!DOCUMENT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    const relative = path.relative(ROOT, absolute).split(path.sep).join('/');
    files.push(relative);
  }
  return files.sort((left, right) => left.localeCompare(right, 'en'));
}

function isAllowedNonActiveDocument(file: string): boolean {
  return NON_ACTIVE_PREFIXES.some((prefix) => file.startsWith(prefix));
}

test('every active-looking repository document is registered or explicitly non-active', async () => {
  const registry = parseDocumentationAuthorityRegistry(
    await readFile(path.join(DOCS_ROOT, 'authority.json'), 'utf8')
  );
  const registered = new Set(registry.documents.map((document) => document.path));
  const files = await collectDocumentationFiles(DOCS_ROOT);
  const unclassified = files.filter((file) => (
    !registered.has(file) && !isAllowedNonActiveDocument(file)
  ));

  expect(unclassified).toEqual([]);
});

test('registered active documents exist as ordinary files and do not escape docs/root entries', async () => {
  const registry = parseDocumentationAuthorityRegistry(
    await readFile(path.join(DOCS_ROOT, 'authority.json'), 'utf8')
  );
  const missing: string[] = [];
  const nonFiles: string[] = [];

  for (const document of registry.documents) {
    const absolute = path.join(ROOT, document.path);
    try {
      const stat = await lstat(absolute);
      if (!stat.isFile()) nonFiles.push(document.path);
    } catch {
      missing.push(document.path);
    }
  }

  expect(missing).toEqual([]);
  expect(nonFiles).toEqual([]);
});

test('proposal documents cannot bypass registry lifecycle through archive-like names', async () => {
  const registry = parseDocumentationAuthorityRegistry(
    await readFile(path.join(DOCS_ROOT, 'authority.json'), 'utf8')
  );
  const registeredProposals = new Set(
    registry.documents
      .filter((document) => document.kind === 'proposal')
      .map((document) => document.path)
  );
  const proposalFiles = (await collectDocumentationFiles(path.join(DOCS_ROOT, 'proposals')))
    .filter((file) => file.endsWith('.md') || file.endsWith('.yaml') || file.endsWith('.yml'));

  expect(proposalFiles.filter((file) => !registeredProposals.has(file))).toEqual([]);
});
