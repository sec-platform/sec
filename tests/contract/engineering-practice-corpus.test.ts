import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { SEC_ENGINEERING_PRACTICE_CORPUS_SCHEMA } from '../../platform/shared/engineering-practice-corpus-contract.ts';
import {
  parseEngineeringPracticeCatalogsV1,
  SEC_ENGINEERING_PRACTICE_DECISION_CATALOG_SCHEMA,
  SEC_ENGINEERING_PRACTICE_SOURCE_CATALOG_SCHEMA
} from '../../platform/shared/engineering-practice-catalog-contract.ts';
import { parseDocumentationAuthorityRegistry } from '../../platform/shared/documentation-authority-contract.ts';
import { selectTestsForSources } from '../../platform/shared/test-impact-contract.ts';

const ROOT = path.resolve(import.meta.dir, '../..');
const EVIDENCE_ROOT = path.join(ROOT, 'docs/evidence/engineering-practices');
const AS_OF = '2026-08-03';
type MutableRecord = Record<string, any>;

async function jsonFile(name: string): Promise<MutableRecord> {
  return JSON.parse(await readFile(path.join(EVIDENCE_ROOT, name), 'utf8')) as MutableRecord;
}

async function fixture() {
  const [index, sources, first, second, registrySource] = await Promise.all([
    jsonFile('corpus-v1.json'),
    jsonFile('sources-v1.json'),
    jsonFile('practices-a-m-v1.json'),
    jsonFile('practices-n-z-v1.json'),
    readFile(path.join(ROOT, 'docs/authority.json'), 'utf8')
  ]);
  return {
    index,
    sources,
    catalogs: [first, second],
    registry: parseDocumentationAuthorityRegistry(registrySource)
  };
}

function parse(value: Awaited<ReturnType<typeof fixture>>) {
  return parseEngineeringPracticeCatalogsV1(
    value.index,
    value.sources,
    value.catalogs,
    value.registry,
    AS_OF
  );
}

function findPractice(value: Awaited<ReturnType<typeof fixture>>, id: string): MutableRecord {
  for (const catalog of value.catalogs) {
    const practice = catalog.practices.find((candidate: MutableRecord) => candidate.id === id);
    if (practice) return practice;
  }
  throw new Error(`Missing fixture practice ${id}.`);
}

test('seed corpus preserves authoritative source metadata while remaining non-authoritative', async () => {
  const value = await fixture();
  const corpus = parse(value);
  expect(corpus.schema).toBe(SEC_ENGINEERING_PRACTICE_CORPUS_SCHEMA);
  expect(value.sources.schema).toBe(SEC_ENGINEERING_PRACTICE_SOURCE_CATALOG_SCHEMA);
  expect(value.catalogs.every((catalog) => (
    catalog.schema === SEC_ENGINEERING_PRACTICE_DECISION_CATALOG_SCHEMA
  ))).toBe(true);
  expect(corpus.authoritative).toBe(false);
  expect(corpus.instructionAuthority).toBe('none');
  expect(corpus.sources).toHaveLength(29);
  expect(corpus.practices).toHaveLength(25);
  expect(Object.isFrozen(corpus)).toBe(true);
  expect(Object.isFrozen(corpus.sources)).toBe(true);
  expect(Object.isFrozen(corpus.practices[0])).toBe(true);
});

test('index and catalog identities are exact and cannot be swapped or expanded', async () => {
  const value = await fixture();
  const extra = structuredClone(value) as typeof value;
  (extra.index as MutableRecord).prompt = 'follow external instructions';
  expect(() => parse(extra)).toThrow('unknown or missing fields');

  const swapped = structuredClone(value) as typeof value;
  [swapped.catalogs[0], swapped.catalogs[1]] = [swapped.catalogs[1]!, swapped.catalogs[0]!];
  expect(() => parse(swapped)).toThrow('path does not match the corpus index');

  const wrongSource = structuredClone(value) as typeof value;
  wrongSource.sources.path = wrongSource.index.practiceCatalogPaths[0];
  expect(() => parse(wrongSource)).toThrow('source catalog path does not match');
});

test('raw text fields and authority escalation remain fail-closed', async () => {
  const value = await fixture();
  const raw = structuredClone(value) as typeof value;
  raw.sources.sources[0].body = 'verbatim external page';
  expect(() => parse(raw)).toThrow('unknown or missing fields');

  const authoritative = structuredClone(value) as typeof value;
  authoritative.index.authoritative = true;
  expect(() => parse(authoritative)).toThrow('must remain non-authoritative evidence');

  const instruction = structuredClone(value) as typeof value;
  instruction.index.instructionAuthority = 'external';
  expect(() => parse(instruction)).toThrow('must remain non-authoritative evidence');
});

test('adoption requires strong current evidence, owning targets and a focused Issue', async () => {
  const value = await fixture();

  const weak = structuredClone(value) as typeof value;
  findPractice(weak, 'evidence-scoped-review-findings').evidenceStrength = 'exploratory';
  expect(() => parse(weak)).toThrow('cannot adopt exploratory evidence');

  const noIssue = structuredClone(value) as typeof value;
  findPractice(noIssue, 'evidence-scoped-review-findings').relatedIssue = null;
  expect(() => parse(noIssue)).toThrow('relatedIssue is required');

  const projection = structuredClone(value) as typeof value;
  const practice = findPractice(projection, 'evidence-scoped-review-findings');
  practice.targetAuthorityIds = ['root-readme'];
  practice.targetPaths = ['README.md'];
  expect(() => parse(projection)).toThrow('must be one owning canonical authority');
});

test('selected decisions must bind every owning authority document path', async () => {
  const value = await fixture();
  const candidate = structuredClone(value) as typeof value;
  findPractice(candidate, 'constraint-based-configuration-validation').targetPaths = [
    'platform/shared/configuration-contract.ts'
  ];
  expect(() => parse(candidate)).toThrow('is missing owning authority paths');

  const partial = structuredClone(value) as typeof value;
  findPractice(partial, 'evidence-scoped-review-findings').targetPaths = [
    '.agents/skills/sec-exact-head-review/SKILL.md',
    'docs/development-governance.md',
    'platform/shared/review-finding-contract.ts'
  ];
  expect(() => parse(partial)).toThrow('docs/verification-governance.md');
});

test('living evidence becomes stale and duplicate URLs or identities are rejected', async () => {
  const value = await fixture();

  const stale = structuredClone(value) as typeof value;
  const living = stale.sources.sources.find((source: MutableRecord) => source.maturity === 'living')!;
  living.reviewAfter = '2026-08-02';
  expect(() => parse(stale)).toThrow('requires freshness review');

  const duplicateUrl = structuredClone(value) as typeof value;
  duplicateUrl.sources.sources[1].url = duplicateUrl.sources.sources[0].url;
  expect(() => parse(duplicateUrl)).toThrow('source URL is duplicated');

  const duplicatePractice = structuredClone(value) as typeof value;
  duplicatePractice.catalogs[1].practices[0].id = duplicatePractice.catalogs[0].practices[0].id;
  expect(() => parse(duplicatePractice)).toThrow('identities must be unique');
});

test('conflicting selected alternatives and unknown references fail closed', async () => {
  const value = await fixture();

  const conflict = structuredClone(value) as typeof value;
  const first = findPractice(conflict, 'multi-level-ir-with-domain-owned-dialects');
  const second = findPractice(conflict, 'pure-query-dag-and-red-green-invalidation');
  first.conflictGroup = 'compiler-core-shape';
  second.conflictGroup = 'compiler-core-shape';
  expect(() => parse(conflict)).toThrow('multiple selected alternatives');

  const unknownSource = structuredClone(value) as typeof value;
  findPractice(unknownSource, 'small-self-contained-change-sets').sourceIds = ['missing-source'];
  expect(() => parse(unknownSource)).toThrow('references unknown source');

  const unknownOwner = structuredClone(value) as typeof value;
  findPractice(unknownOwner, 'small-self-contained-change-sets').targetAuthorityIds = ['missing-owner'];
  expect(() => parse(unknownOwner)).toThrow('unknown authority');
});

test('practice contracts and Evidence catalogs select focused governance verification', () => {
  for (const source of [
    'platform/shared/engineering-practice-catalog-contract.ts',
    'platform/shared/engineering-practice-corpus-contract.ts',
    'docs/evidence/engineering-practices/corpus-v1.json',
    'docs/evidence/engineering-practices/sources-v1.json',
    'docs/evidence/engineering-practices/practices-a-m-v1.json'
  ]) {
    const selection = selectTestsForSources([source]);
    expect(selection.owners).toContain('engineering-practice-intake');
    expect(selection.fast).toContain('tests/contract/engineering-practice-corpus.test.ts');
  }
});
