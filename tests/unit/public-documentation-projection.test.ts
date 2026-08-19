import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  documentationRecordByPath,
  parseDocumentationAuthorityRegistry
} from '../../platform/shared/documentation-authority-contract.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../..');
const MANIFEST_PATH = path.join(REPOSITORY_ROOT, 'public-docs/manifest.json');

interface PublicDocumentationPage {
  readonly id: string;
  readonly path: string;
  readonly kind: string;
  readonly audiences: readonly string[];
  readonly canonicalRefs: readonly string[];
}

interface PublicDocumentationManifest {
  readonly schema: 'sec-public-documentation-projection-v1';
  readonly locale: 'zh-CN';
  readonly pages: readonly PublicDocumentationPage[];
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every((item) => typeof item === 'string' && item.length > 0 && item.trim() === item)
    && new Set(value).size === value.length;
}

function parseManifest(source: string): PublicDocumentationManifest {
  const value = JSON.parse(source) as unknown;
  expect(value).toBeObject();
  const record = value as Record<string, unknown>;
  expect(Object.keys(record).sort()).toEqual(['locale', 'pages', 'schema']);
  expect(record.schema).toBe('sec-public-documentation-projection-v1');
  expect(record.locale).toBe('zh-CN');
  expect(Array.isArray(record.pages)).toBe(true);

  const pages = (record.pages as unknown[]).map((entry) => {
    expect(entry).toBeObject();
    const page = entry as Record<string, unknown>;
    expect(Object.keys(page).sort()).toEqual([
      'audiences',
      'canonicalRefs',
      'id',
      'kind',
      'path'
    ]);
    expect(typeof page.id).toBe('string');
    expect(typeof page.path).toBe('string');
    expect(typeof page.kind).toBe('string');
    expect(isStringList(page.audiences)).toBe(true);
    expect(isStringList(page.canonicalRefs)).toBe(true);
    return page as unknown as PublicDocumentationPage;
  });

  return {
    schema: 'sec-public-documentation-projection-v1',
    locale: 'zh-CN',
    pages
  };
}

async function loadManifest(): Promise<PublicDocumentationManifest> {
  return parseManifest(await readFile(MANIFEST_PATH, 'utf8'));
}

function internalMarkdownTargets(source: string): readonly string[] {
  return [...source.matchAll(/\[[^\]]+\]\(([^)#?]+\.md)(?:#[^)]+)?\)/gu)]
    .map((match) => match[1]);
}

test('public documentation manifest binds every page to registered canonical sources', async () => {
  const [manifest, registrySource] = await Promise.all([
    loadManifest(),
    readFile(path.join(REPOSITORY_ROOT, 'docs/authority.json'), 'utf8')
  ]);
  const registry = parseDocumentationAuthorityRegistry(registrySource);
  const ids = manifest.pages.map((page) => page.id);
  const paths = manifest.pages.map((page) => page.path);
  expect(new Set(ids).size).toBe(ids.length);
  expect(new Set(paths).size).toBe(paths.length);

  for (const page of manifest.pages) {
    expect(page.path.startsWith('public-docs/')).toBe(true);
    expect(page.path.endsWith('.md')).toBe(true);
    expect(page.audiences.length).toBeGreaterThan(0);
    expect(page.canonicalRefs.length).toBeGreaterThan(0);
    await expect(readFile(path.join(REPOSITORY_ROOT, page.path), 'utf8')).resolves.toBeString();
    for (const canonicalRef of page.canonicalRefs) {
      expect(documentationRecordByPath(registry, canonicalRef)).toBeDefined();
    }
  }
});

test('public documentation pages have one H1 and no broken relative Markdown links', async () => {
  const manifest = await loadManifest();
  for (const page of manifest.pages) {
    const source = await readFile(path.join(REPOSITORY_ROOT, page.path), 'utf8');
    expect(source.split('\n').filter((line) => /^#\s+\S/u.test(line))).toHaveLength(1);
    for (const target of internalMarkdownTargets(source)) {
      const resolved = path.resolve(path.dirname(path.join(REPOSITORY_ROOT, page.path)), target);
      expect(resolved.startsWith(path.join(REPOSITORY_ROOT, 'public-docs'))).toBe(true);
      await expect(readFile(resolved, 'utf8')).resolves.toBeString();
    }
  }
});

test('public principle projection keeps the complete current meta/root/cross-domain census', async () => {
  const source = await readFile(path.join(REPOSITORY_ROOT, 'public-docs/principles.md'), 'utf8');
  for (const id of ['M0', 'M1', 'M2', 'M3']) {
    expect(source).toContain(`## ${id} —`);
  }
  for (let index = 1; index <= 9; index++) {
    expect(source).toContain(`## R${index} —`);
  }
  for (let index = 1; index <= 41; index++) {
    expect(source).toContain(`## P${String(index).padStart(2, '0')} —`);
  }
});

test('stable public prose does not hard-code current Git revisions or PR URLs', async () => {
  const manifest = await loadManifest();
  for (const page of manifest.pages) {
    const source = await readFile(path.join(REPOSITORY_ROOT, page.path), 'utf8');
    expect(source).not.toMatch(/\b[0-9a-f]{40}\b/u);
    expect(source).not.toMatch(/github\.com\/[^\s)]+\/pull\/\d+/u);
  }
});
