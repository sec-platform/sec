import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  activeDocumentationRecord,
  currentActiveDocumentationPaths,
  isActiveDocumentationPath,
  isDocumentationVerificationInputPath,
  parseDocumentationIdentityRegistry,
  parseDocumentationVerificationBaseline
} from '../../src/adapters/self-hosting/control/documentation/active.ts';

const ROOT = path.resolve(import.meta.dir, '../..');

function identitySource(documents: readonly unknown[]): string {
  return JSON.stringify({
    schema: 'sec.documentation-identity/1',
    scope: 'fixture',
    documents
  });
}

const FIRST_ID = 'urn:uuid:00000000-0000-4000-8000-000000000001';
const SECOND_ID = 'urn:uuid:00000000-0000-4000-8000-000000000002';

function baselineSource(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: 'sec.documentation-baseline/2',
    source_root: '..',
    source_roots: ['README.md', '.documentation', 'docs/产品', 'examples', 'tools'],
    source_manifest: 'source-manifest.json',
    excluded_from_source_hash: [
      '.documentation/figures.json',
      '.documentation/requirements.json',
      '.documentation/source-manifest.json'
    ],
    audited_namespaces: ['docs'],
    non_documentation_roots: [],
    entry: '../README.md',
    delivery_number: '086',
    archive_name: 'SEC-086.zip',
    scope: 'fixture',
    authority_limit: 'fixture',
    ...overrides
  });
}

test('current documentation paths and stable identities come from the SEC-086 identity registry', async () => {
  const registry = parseDocumentationIdentityRegistry(
    await readFile(path.join(ROOT, '.documentation/documents.json'), 'utf8')
  );
  expect(currentActiveDocumentationPaths()).toEqual([
    '.documentation/baseline.json',
    '.documentation/documents.json',
    '.documentation/source-manifest.json',
    ...registry.documents.map(({ path }) => path)
  ].sort());
  expect(isActiveDocumentationPath('docs/维护/文档身份与重组协议.md')).toBe(true);
  expect(isActiveDocumentationPath('docs/authority.json')).toBe(false);
  expect(activeDocumentationRecord('AGENTS.md')).toEqual({
    documentId: 'urn:uuid:d4f25365-130a-5c38-bba7-ea1d5b89c8af',
    path: 'AGENTS.md'
  });
});

test('documentation identity parsing rejects ambiguous identity, path and object shape', () => {
  expect(() => parseDocumentationIdentityRegistry(identitySource([
    { document_id: FIRST_ID, path: 'docs/a.md' },
    { document_id: FIRST_ID, path: 'docs/b.md' }
  ]))).toThrow(/duplicate document identity/u);
  expect(() => parseDocumentationIdentityRegistry(identitySource([
    { document_id: FIRST_ID, path: 'docs/A.md' },
    { document_id: SECOND_ID, path: 'docs/a.md' }
  ]))).toThrow(/duplicate document path/u);
  expect(() => parseDocumentationIdentityRegistry(identitySource([
    { document_id: FIRST_ID, path: 'docs/a.md', kind: 'authority' }
  ]))).toThrow(/keys must be exact/u);
  expect(() => parseDocumentationIdentityRegistry(
    '{"schema":"sec.documentation-identity/1","scope":"x","scope":"y","documents":[]}'
  )).toThrow(/duplicate/u);
});

test('documentation identities use canonical UUIDs and Markdown repository paths', () => {
  expect(() => parseDocumentationIdentityRegistry(identitySource([
    { document_id: 'development-governance', path: 'docs/a.md' }
  ]))).toThrow(/UUID URN/u);
  expect(() => parseDocumentationIdentityRegistry(identitySource([
    { document_id: FIRST_ID, path: '../outside.md' }
  ]))).toThrow(/canonical Markdown repository path/u);
});

test('documentation gate inputs are derived from the baseline without expanding document identity', () => {
  const baseline = parseDocumentationVerificationBaseline(baselineSource());
  for (const file of [
    '.documentation/baseline.json',
    '.documentation/source-manifest.json',
    'docs/产品/new.md',
    'docs/unregistered-legacy.md',
    'examples/sample.ts',
    'tools/documentation/check_docs.py'
  ]) {
    expect(isDocumentationVerificationInputPath(file, baseline)).toBe(true);
  }
  for (const file of [
    'config/repository/active-work-package.md',
    'config/repository/work-packages/history.md',
    'config/repository/work-selection.md',
    'config/external-capabilities/ledger.yaml',
    'public-docs/stale.md',
    'src/product.ts'
  ]) {
    expect(isDocumentationVerificationInputPath(file, baseline)).toBe(false);
  }
  expect(isActiveDocumentationPath('examples/sample.ts')).toBe(false);
  expect(isActiveDocumentationPath('tools/documentation/check_docs.py')).toBe(false);
});

test('documentation verification baseline rejects ambiguous or competing roots', () => {
  expect(parseDocumentationVerificationBaseline(baselineSource({
    non_documentation_roots: []
  })).nonDocumentationRoots).toEqual([]);
  expect(() => parseDocumentationVerificationBaseline(baselineSource({
    source_roots: ['README.md', '.documentation'],
    non_documentation_roots: ['docs']
  }))).toThrow(/outside audited_namespaces/u);
  expect(() => parseDocumentationVerificationBaseline(baselineSource({
    non_documentation_roots: ['src']
  }))).toThrow(/outside audited_namespaces/u);
  expect(() => parseDocumentationVerificationBaseline(baselineSource({
    source_roots: ['docs', '.documentation'],
    non_documentation_roots: ['docs/generated']
  }))).toThrow(/overlaps source_roots/u);
  expect(() => parseDocumentationVerificationBaseline(baselineSource({ unexpected: true })))
    .toThrow(/unsupported root key/u);
});

// A changed rendering cache is a reading input, never a source-verification authority.
test('rendering cache does not select the normative source gate', () => {
  expect(isDocumentationVerificationInputPath('.documentation/figures.json')).toBe(false);
  expect(isDocumentationVerificationInputPath('.documentation/requirements.json')).toBe(true);
});
