import {
  parseEngineeringPracticeCorpusV1,
  SEC_ENGINEERING_PRACTICE_CORPUS_SCHEMA,
  type EngineeringPracticeCorpusV1,
  type EngineeringPracticeSourceV1,
  type EngineeringPracticeV1
} from './engineering-practice-corpus-contract.ts';
import type {
  DocumentationAuthorityRecord,
  DocumentationAuthorityRegistry
} from './documentation-authority-contract.ts';
import { CodexDevelopmentIsCanonicalRepositoryPathV1 } from './repository-path-contract.ts';

export const SEC_ENGINEERING_PRACTICE_SOURCE_CATALOG_SCHEMA =
  'sec-engineering-practice-source-catalog-v1' as const;
export const SEC_ENGINEERING_PRACTICE_DECISION_CATALOG_SCHEMA =
  'sec-engineering-practice-decision-catalog-v1' as const;

export interface EngineeringPracticeCorpusIndexV1 {
  readonly schema: typeof SEC_ENGINEERING_PRACTICE_CORPUS_SCHEMA;
  readonly authoritative: false;
  readonly instructionAuthority: 'none';
  readonly adoptionPolicy: 'canonical-owner-migration-required';
  readonly observedAt: string;
  readonly sourceCatalogPath: string;
  readonly practiceCatalogPaths: readonly string[];
}

const INDEX_KEYS = new Set([
  'schema',
  'authoritative',
  'instructionAuthority',
  'adoptionPolicy',
  'observedAt',
  'sourceCatalogPath',
  'practiceCatalogPaths'
]);
const SOURCE_CATALOG_KEYS = new Set(['schema', 'path', 'sources']);
const DECISION_CATALOG_KEYS = new Set(['schema', 'path', 'practices']);

function assertObject(
  value: unknown,
  label: string
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object.`);
  }
}

function assertKeys(
  value: Record<string, unknown>,
  expected: ReadonlySet<string>,
  label: string
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} has unknown or missing fields.`);
  }
}

function text(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.includes('\0')
    || value.includes('\n')
    || value.includes('\r')
  ) {
    throw new Error(`${label} must be a non-empty single-line trimmed string.`);
  }
  return value;
}

function catalogPath(value: unknown, label: string): string {
  const result = text(value, label);
  if (
    !CodexDevelopmentIsCanonicalRepositoryPathV1(result)
    || !/^docs\/evidence\/engineering-practices\/[a-z0-9][a-z0-9-]*\.json$/u.test(result)
  ) {
    throw new Error(`${label} must be an engineering-practices Evidence catalog path.`);
  }
  return result;
}

function canonicalPaths(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  const values = value.map((entry, index) => catalogPath(entry, `${label}[${index}]`));
  if (values.length === 0) throw new Error(`${label} must not be empty.`);
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique.`);
  const sorted = [...values].sort();
  if (sorted.some((entry, index) => entry !== values[index])) {
    throw new Error(`${label} must use canonical code-unit order.`);
  }
  return values;
}

function parseIndex(value: unknown): EngineeringPracticeCorpusIndexV1 {
  assertObject(value, 'engineering practice corpus index');
  assertKeys(value, INDEX_KEYS, 'engineering practice corpus index');
  if (value.schema !== SEC_ENGINEERING_PRACTICE_CORPUS_SCHEMA) {
    throw new Error(`Engineering practice corpus schema must be ${SEC_ENGINEERING_PRACTICE_CORPUS_SCHEMA}.`);
  }
  if (
    value.authoritative !== false
    || value.instructionAuthority !== 'none'
    || value.adoptionPolicy !== 'canonical-owner-migration-required'
  ) {
    throw new Error('Engineering practice corpus must remain non-authoritative evidence.');
  }
  const observedAt = text(value.observedAt, 'engineering practice corpus observedAt');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(observedAt)) {
    throw new Error('Engineering practice corpus observedAt must be an ISO date.');
  }
  return {
    schema: SEC_ENGINEERING_PRACTICE_CORPUS_SCHEMA,
    authoritative: false,
    instructionAuthority: 'none',
    adoptionPolicy: 'canonical-owner-migration-required',
    observedAt,
    sourceCatalogPath: catalogPath(value.sourceCatalogPath, 'sourceCatalogPath'),
    practiceCatalogPaths: canonicalPaths(value.practiceCatalogPaths, 'practiceCatalogPaths')
  };
}

function parseSourceCatalog(
  value: unknown,
  expectedPath: string
): EngineeringPracticeSourceV1[] {
  assertObject(value, 'engineering practice source catalog');
  assertKeys(value, SOURCE_CATALOG_KEYS, 'engineering practice source catalog');
  if (value.schema !== SEC_ENGINEERING_PRACTICE_SOURCE_CATALOG_SCHEMA) {
    throw new Error(`Engineering practice source catalog schema must be ${SEC_ENGINEERING_PRACTICE_SOURCE_CATALOG_SCHEMA}.`);
  }
  const path = catalogPath(value.path, 'engineering practice source catalog.path');
  if (path !== expectedPath) {
    throw new Error('Engineering practice source catalog path does not match the corpus index.');
  }
  if (!Array.isArray(value.sources)) {
    throw new Error('Engineering practice source catalog sources must be an array.');
  }
  return value.sources as EngineeringPracticeSourceV1[];
}

function parseDecisionCatalog(
  value: unknown,
  expectedPath: string,
  index: number
): EngineeringPracticeV1[] {
  const label = `engineering practice decision catalog[${index}]`;
  assertObject(value, label);
  assertKeys(value, DECISION_CATALOG_KEYS, label);
  if (value.schema !== SEC_ENGINEERING_PRACTICE_DECISION_CATALOG_SCHEMA) {
    throw new Error(`${label} schema must be ${SEC_ENGINEERING_PRACTICE_DECISION_CATALOG_SCHEMA}.`);
  }
  const path = catalogPath(value.path, `${label}.path`);
  if (path !== expectedPath) throw new Error(`${label} path does not match the corpus index.`);
  if (!Array.isArray(value.practices)) throw new Error(`${label}.practices must be an array.`);
  return value.practices as EngineeringPracticeV1[];
}

function ownerById(
  registry: DocumentationAuthorityRegistry,
  id: string
): DocumentationAuthorityRecord {
  const record = registry.documents.find((candidate) => candidate.id === id);
  if (!record) throw new Error(`Practice target references unknown authority ${id}.`);
  return record;
}

export type EngineeringPracticeCatalogCorpusV1 = EngineeringPracticeCorpusV1 & {
  readonly sourceCatalogPath: string;
  readonly practiceCatalogPaths: readonly string[];
};

export function parseEngineeringPracticeCatalogsV1(
  indexValue: unknown,
  sourceCatalogValue: unknown,
  practiceCatalogValues: readonly unknown[],
  registry: DocumentationAuthorityRegistry,
  asOf: string
): EngineeringPracticeCatalogCorpusV1 {
  const index = parseIndex(indexValue);
  if (practiceCatalogValues.length !== index.practiceCatalogPaths.length) {
    throw new Error('Engineering practice decision catalog inventory does not match the index.');
  }
  if (index.practiceCatalogPaths.includes(index.sourceCatalogPath)) {
    throw new Error('Engineering practice source and decision catalogs must use distinct paths.');
  }

  const sources = parseSourceCatalog(sourceCatalogValue, index.sourceCatalogPath);
  const practices = practiceCatalogValues.flatMap((value, catalogIndex) => (
    parseDecisionCatalog(value, index.practiceCatalogPaths[catalogIndex]!, catalogIndex)
  ));
  const parsed = parseEngineeringPracticeCorpusV1({
    schema: index.schema,
    authoritative: index.authoritative,
    instructionAuthority: index.instructionAuthority,
    adoptionPolicy: index.adoptionPolicy,
    observedAt: index.observedAt,
    sources,
    practices
  }, registry, asOf);

  for (const practice of parsed.practices) {
    const missingOwnerPaths = practice.targetAuthorityIds
      .map((id) => ownerById(registry, id).path)
      .filter((ownerPath) => !practice.targetPaths.includes(ownerPath));
    if (missingOwnerPaths.length > 0) {
      throw new Error(
        `Practice ${practice.id} is missing owning authority paths: ${missingOwnerPaths.join(', ')}.`
      );
    }
  }

  return Object.freeze({
    ...parsed,
    sourceCatalogPath: index.sourceCatalogPath,
    practiceCatalogPaths: Object.freeze([...index.practiceCatalogPaths])
  }) as EngineeringPracticeCatalogCorpusV1;
}
