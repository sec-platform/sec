import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  parseDocumentationAuthorityRegistry
} from '../../platform/shared/documentation-authority-contract.ts';

const ROOT = path.resolve(import.meta.dir, '../..');
const REGISTRY = path.join(ROOT, 'docs/authority.json');

async function registry() {
  return parseDocumentationAuthorityRegistry(await readFile(REGISTRY, 'utf8'));
}

test('every semantic ownership token has exactly one document owner', async () => {
  const value = await registry();
  const owners = new Map<string, string[]>();

  for (const document of value.documents) {
    for (const token of document.owns) {
      const current = owners.get(token) ?? [];
      current.push(document.id);
      owners.set(token, current);
    }
  }

  const duplicates = [...owners.entries()]
    .filter(([, documentIds]) => documentIds.length !== 1)
    .map(([token, documentIds]) => `${token}: ${documentIds.join(', ')}`)
    .sort((left, right) => left.localeCompare(right, 'en'));

  expect(duplicates).toEqual([]);
});

test('navigation, generated projections and proposals never own canonical semantics', async () => {
  const value = await registry();
  const invalid = value.documents
    .filter((document) => (
      document.kind === 'navigation'
      || document.kind === 'proposal'
      || document.generatedFrom !== undefined
    ))
    .filter((document) => document.owns.length > 0)
    .map((document) => `${document.id}: ${document.owns.join(', ')}`)
    .sort((left, right) => left.localeCompare(right, 'en'));

  expect(invalid).toEqual([]);
});

test('generatedFrom and project references resolve to registered documents', async () => {
  const value = await registry();
  const byId = new Map(value.documents.map((document) => [document.id, document] as const));
  const byPath = new Map(value.documents.map((document) => [document.path, document] as const));
  const unresolved: string[] = [];

  for (const document of value.documents) {
    if (document.generatedFrom !== undefined && !byPath.has(document.generatedFrom)) {
      unresolved.push(`${document.id}.generatedFrom -> ${document.generatedFrom}`);
    }
    for (const projectId of document.projects) {
      if (!byId.has(projectId)) unresolved.push(`${document.id}.projects -> ${projectId}`);
    }
  }

  expect(unresolved.sort((left, right) => left.localeCompare(right, 'en'))).toEqual([]);
});

test('document projection graph is acyclic', async () => {
  const value = await registry();
  const edges = new Map(value.documents.map((document) => [document.id, document.projects] as const));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles: string[] = [];

  const visit = (documentId: string, stack: string[]): void => {
    if (visiting.has(documentId)) {
      const start = stack.indexOf(documentId);
      cycles.push([...stack.slice(start), documentId].join(' -> '));
      return;
    }
    if (visited.has(documentId)) return;
    visiting.add(documentId);
    for (const target of edges.get(documentId) ?? []) visit(target, [...stack, documentId]);
    visiting.delete(documentId);
    visited.add(documentId);
  };

  for (const documentId of edges.keys()) visit(documentId, []);
  expect([...new Set(cycles)].sort((left, right) => left.localeCompare(right, 'en'))).toEqual([]);
});

test('stable authority documents are not generated or proposal-backed', async () => {
  const value = await registry();
  const invalid = value.documents
    .filter((document) => document.kind === 'authority' && document.lifecycle === 'stable')
    .filter((document) => (
      document.generatedFrom !== undefined
      || document.proposal !== undefined
      || document.owns.length === 0
    ))
    .map((document) => document.id)
    .sort((left, right) => left.localeCompare(right, 'en'));

  expect(invalid).toEqual([]);
});
