import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  readPublicDocumentationProjectionV1
} from '../../src/control/documentation/public-projection.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../..');

test('public documentation projection closes manifest, authority and relative links', async () => {
  const projection = await readPublicDocumentationProjectionV1(REPOSITORY_ROOT);
  expect(projection.locale).toBe('zh-CN');
  expect(projection.pages.length).toBeGreaterThan(0);
  expect(new Set(projection.pages.map(({ id }) => id)).size).toBe(projection.pages.length);
  expect(new Set(projection.pages.map(({ path: pagePath }) => pagePath)).size)
    .toBe(projection.pages.length);
  expect(projection.unregisteredCanonicalRefs).toEqual([]);
  expect(projection.brokenLinks).toEqual([]);
});

test('every projected page has public structure and an explicit audience/source binding', async () => {
  const projection = await readPublicDocumentationProjectionV1(REPOSITORY_ROOT);
  for (const page of projection.pages) {
    expect(page.path.startsWith('public-docs/')).toBe(true);
    expect(page.path.endsWith('.md')).toBe(true);
    expect(page.audiences.length).toBeGreaterThan(0);
    expect(page.canonicalRefs.length).toBeGreaterThan(0);
    expect(page.h1Count).toBeGreaterThan(0);
  }
});

test('principle identity is derived from the projection without a test-owned vocabulary mirror', async () => {
  const projection = await readPublicDocumentationProjectionV1(REPOSITORY_ROOT);
  expect(projection.principleIds.length).toBeGreaterThan(0);
  expect(new Set(projection.principleIds).size).toBe(projection.principleIds.length);
  expect(projection.principleIds.every((id) => /^(?:M\d|R\d|P\d{2})$/u.test(id))).toBe(true);
});

test('stable public prose contains no current commit or pull-request authority', async () => {
  const projection = await readPublicDocumentationProjectionV1(REPOSITORY_ROOT);
  expect(projection.revisionLiterals).toEqual([]);
  expect(projection.pullRequestUrls).toEqual([]);
});
