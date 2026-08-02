import type {
  DocumentationAuthorityRecord,
  DocumentationAuthorityRegistry
} from './documentation-authority-contract.ts';
import { CodexDevelopmentIsCanonicalRepositoryPathV1 } from './repository-path-contract.ts';

export const SEC_ENGINEERING_PRACTICE_CORPUS_SCHEMA =
  'sec-engineering-practice-corpus-v1' as const;
export const SEC_ENGINEERING_PRACTICE_REUSE_NOTE =
  'Metadata and SEC-owned paraphrase only.' as const;

export const SEC_ENGINEERING_PRACTICE_SOURCE_KINDS = [
  'normative-standard',
  'official-design-doc',
  'official-operational-guide',
  'official-repository-policy',
  'peer-reviewed-primary'
] as const;

export const SEC_ENGINEERING_PRACTICE_SOURCE_MATURITY = [
  'stable',
  'living',
  'draft',
  'retired'
] as const;

export const SEC_ENGINEERING_PRACTICE_EVIDENCE_STRENGTH = [
  'normative',
  'convergent-authoritative',
  'single-primary',
  'exploratory'
] as const;

export const SEC_ENGINEERING_PRACTICE_DISPOSITIONS = [
  'already-covered',
  'adopt',
  'adapt',
  'reject',
  'defer',
  'experiment'
] as const;

export type EngineeringPracticeSourceKind =
  (typeof SEC_ENGINEERING_PRACTICE_SOURCE_KINDS)[number];
export type EngineeringPracticeSourceMaturity =
  (typeof SEC_ENGINEERING_PRACTICE_SOURCE_MATURITY)[number];
export type EngineeringPracticeEvidenceStrength =
  (typeof SEC_ENGINEERING_PRACTICE_EVIDENCE_STRENGTH)[number];
export type EngineeringPracticeDisposition =
  (typeof SEC_ENGINEERING_PRACTICE_DISPOSITIONS)[number];

export interface EngineeringPracticeSourceV1 {
  readonly id: string;
  readonly publisher: string;
  readonly title: string;
  readonly url: string;
  readonly kind: EngineeringPracticeSourceKind;
  readonly maturity: EngineeringPracticeSourceMaturity;
  readonly observedVersion: string | null;
  readonly observedAt: string;
  readonly reviewAfter: string | null;
  readonly reuseNote: typeof SEC_ENGINEERING_PRACTICE_REUSE_NOTE;
}

export interface EngineeringPracticeV1 {
  readonly id: string;
  readonly category: string;
  readonly normalizedSummary: string;
  readonly sourceIds: readonly string[];
  readonly evidenceStrength: EngineeringPracticeEvidenceStrength;
  readonly disposition: EngineeringPracticeDisposition;
  readonly targetAuthorityIds: readonly string[];
  readonly targetPaths: readonly string[];
  readonly relatedIssue: number | null;
  readonly evidenceRequirement: string | null;
  readonly activationTrigger: string | null;
  readonly reversalCondition: string | null;
  readonly conflictGroup: string | null;
  readonly rationale: string;
}

export interface EngineeringPracticeCorpusV1 {
  readonly schema: typeof SEC_ENGINEERING_PRACTICE_CORPUS_SCHEMA;
  readonly authoritative: false;
  readonly instructionAuthority: 'none';
  readonly adoptionPolicy: 'canonical-owner-migration-required';
  readonly observedAt: string;
  readonly sources: readonly EngineeringPracticeSourceV1[];
  readonly practices: readonly EngineeringPracticeV1[];
}

const TOP_LEVEL_KEYS = new Set([
  'schema',
  'authoritative',
  'instructionAuthority',
  'adoptionPolicy',
  'observedAt',
  'sources',
  'practices'
]);

const SOURCE_KEYS = new Set([
  'id',
  'publisher',
  'title',
  'url',
  'kind',
  'maturity',
  'observedVersion',
  'observedAt',
  'reviewAfter',
  'reuseNote'
]);

const PRACTICE_KEYS = new Set([
  'id',
  'category',
  'normalizedSummary',
  'sourceIds',
  'evidenceStrength',
  'disposition',
  'targetAuthorityIds',
  'targetPaths',
  'relatedIssue',
  'evidenceRequirement',
  'activationTrigger',
  'reversalCondition',
  'conflictGroup',
  'rationale'
]);

const SOURCE_KIND_SET = new Set<EngineeringPracticeSourceKind>(
  SEC_ENGINEERING_PRACTICE_SOURCE_KINDS
);
const SOURCE_MATURITY_SET = new Set<EngineeringPracticeSourceMaturity>(
  SEC_ENGINEERING_PRACTICE_SOURCE_MATURITY
);
const EVIDENCE_STRENGTH_SET = new Set<EngineeringPracticeEvidenceStrength>(
  SEC_ENGINEERING_PRACTICE_EVIDENCE_STRENGTH
);
const DISPOSITION_SET = new Set<EngineeringPracticeDisposition>(
  SEC_ENGINEERING_PRACTICE_DISPOSITIONS
);
const SELECTED_DISPOSITIONS = new Set<EngineeringPracticeDisposition>([
  'already-covered',
  'adopt',
  'adapt'
]);

function assertPlainObject(
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

function assertExactKeys(
  value: Record<string, unknown>,
  expected: ReadonlySet<string>,
  label: string
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])
  ) {
    throw new Error(`${label} has unknown or missing fields.`);
  }
}

function text(
  value: unknown,
  label: string,
  min = 1,
  max = 500
): string {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length < min
    || value.length > max
    || value.includes('\0')
    || value.includes('\n')
    || value.includes('\r')
  ) {
    throw new Error(`${label} must be a bounded single-line trimmed string.`);
  }
  return value;
}

function nullableText(
  value: unknown,
  label: string,
  max = 500
): string | null {
  return value === null ? null : text(value, label, 1, max);
}

function slug(value: unknown, label: string): string {
  const result = text(value, label, 1, 120);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(result)) {
    throw new Error(`${label} must be a lowercase kebab-case identity.`);
  }
  return result;
}

function date(value: unknown, label: string): string {
  const result = text(value, label, 10, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(result)) {
    throw new Error(`${label} must be an ISO calendar date.`);
  }
  const parsed = new Date(`${result}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== result) {
    throw new Error(`${label} must be a valid ISO calendar date.`);
  }
  return result;
}

function nullableDate(value: unknown, label: string): string | null {
  return value === null ? null : date(value, label);
}

function enumValue<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  label: string
): T {
  const result = text(value, label);
  if (!allowed.has(result as T)) {
    throw new Error(`${label} is invalid.`);
  }
  return result as T;
}

function canonicalStrings(
  value: unknown,
  label: string,
  parser: (entry: unknown, entryLabel: string) => string = text
): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  const result = value.map((entry, index) => parser(entry, `${label}[${index}]`));
  if (new Set(result).size !== result.length) {
    throw new Error(`${label} must contain unique values.`);
  }
  const sorted = [...result].sort();
  if (sorted.some((entry, index) => entry !== result[index])) {
    throw new Error(`${label} must use canonical code-unit order.`);
  }
  return result;
}

function httpsUrl(value: unknown, label: string): string {
  const raw = text(value, label, 1, 1000);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username.length > 0
    || parsed.password.length > 0
    || parsed.hash.length > 0
  ) {
    throw new Error(`${label} must be a credential-free HTTPS URL without a fragment.`);
  }
  return parsed.toString();
}

function canonicalPath(value: unknown, label: string): string {
  const result = text(value, label, 1, 300);
  if (!CodexDevelopmentIsCanonicalRepositoryPathV1(result)) {
    throw new Error(`${label} must be a canonical repository-relative POSIX path.`);
  }
  return result;
}

function positiveIssue(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${label} must be a positive GitHub Issue number or null.`);
  }
  return value as number;
}

function parseSource(value: unknown, index: number): EngineeringPracticeSourceV1 {
  const label = `sources[${index}]`;
  assertPlainObject(value, label);
  assertExactKeys(value, SOURCE_KEYS, label);

  const maturity = enumValue(
    value.maturity,
    SOURCE_MATURITY_SET,
    `${label}.maturity`
  );
  const observedAt = date(value.observedAt, `${label}.observedAt`);
  const reviewAfter = nullableDate(value.reviewAfter, `${label}.reviewAfter`);
  if ((maturity === 'living' || maturity === 'draft') && reviewAfter === null) {
    throw new Error(`${label} ${maturity} source requires reviewAfter.`);
  }
  if (reviewAfter !== null && reviewAfter <= observedAt) {
    throw new Error(`${label}.reviewAfter must be later than observedAt.`);
  }
  if (maturity === 'retired' && reviewAfter !== null) {
    throw new Error(`${label} retired source cannot schedule a future review.`);
  }
  if (value.reuseNote !== SEC_ENGINEERING_PRACTICE_REUSE_NOTE) {
    throw new Error(`${label}.reuseNote must use the corpus non-copying policy.`);
  }

  return {
    id: slug(value.id, `${label}.id`),
    publisher: text(value.publisher, `${label}.publisher`, 1, 200),
    title: text(value.title, `${label}.title`, 1, 300),
    url: httpsUrl(value.url, `${label}.url`),
    kind: enumValue(value.kind, SOURCE_KIND_SET, `${label}.kind`),
    maturity,
    observedVersion: nullableText(value.observedVersion, `${label}.observedVersion`, 200),
    observedAt,
    reviewAfter,
    reuseNote: SEC_ENGINEERING_PRACTICE_REUSE_NOTE
  };
}

function parsePractice(value: unknown, index: number): EngineeringPracticeV1 {
  const label = `practices[${index}]`;
  assertPlainObject(value, label);
  assertExactKeys(value, PRACTICE_KEYS, label);

  return {
    id: slug(value.id, `${label}.id`),
    category: slug(value.category, `${label}.category`),
    normalizedSummary: text(value.normalizedSummary, `${label}.normalizedSummary`, 40, 600),
    sourceIds: canonicalStrings(value.sourceIds, `${label}.sourceIds`, slug),
    evidenceStrength: enumValue(
      value.evidenceStrength,
      EVIDENCE_STRENGTH_SET,
      `${label}.evidenceStrength`
    ),
    disposition: enumValue(
      value.disposition,
      DISPOSITION_SET,
      `${label}.disposition`
    ),
    targetAuthorityIds: canonicalStrings(
      value.targetAuthorityIds,
      `${label}.targetAuthorityIds`,
      slug
    ),
    targetPaths: canonicalStrings(
      value.targetPaths,
      `${label}.targetPaths`,
      canonicalPath
    ),
    relatedIssue: positiveIssue(value.relatedIssue, `${label}.relatedIssue`),
    evidenceRequirement: nullableText(
      value.evidenceRequirement,
      `${label}.evidenceRequirement`
    ),
    activationTrigger: nullableText(
      value.activationTrigger,
      `${label}.activationTrigger`
    ),
    reversalCondition: nullableText(
      value.reversalCondition,
      `${label}.reversalCondition`
    ),
    conflictGroup: value.conflictGroup === null
      ? null
      : slug(value.conflictGroup, `${label}.conflictGroup`),
    rationale: text(value.rationale, `${label}.rationale`, 20, 600)
  };
}

function assertCanonicalOrder<T extends { readonly id: string }>(
  values: readonly T[],
  label: string
): void {
  const ids = values.map((value) => value.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${label} identities must be unique.`);
  }
  const sorted = [...ids].sort();
  if (sorted.some((id, index) => id !== ids[index])) {
    throw new Error(`${label} must use canonical identity order.`);
  }
}

function authorityById(
  registry: DocumentationAuthorityRegistry,
  id: string
): DocumentationAuthorityRecord {
  const record = registry.documents.find((candidate) => candidate.id === id);
  if (!record) throw new Error(`Practice target references unknown authority ${id}.`);
  return record;
}

function assertOwningAuthority(
  registry: DocumentationAuthorityRegistry,
  id: string
): void {
  const record = authorityById(registry, id);
  if (
    record.owns.length === 0
    || record.kind === 'proposal'
    || record.kind === 'navigation'
    || record.kind === 'agent-projection'
    || record.generatedFrom !== undefined
  ) {
    throw new Error(`Practice target ${id} must be one owning canonical authority.`);
  }
}

function assertEvidenceStrength(
  practice: EngineeringPracticeV1,
  sources: readonly EngineeringPracticeSourceV1[]
): void {
  if (practice.sourceIds.length === 0) {
    throw new Error(`Practice ${practice.id} requires at least one source.`);
  }
  const selected = practice.sourceIds.map((id) => {
    const source = sources.find((candidate) => candidate.id === id);
    if (!source) throw new Error(`Practice ${practice.id} references unknown source ${id}.`);
    return source;
  });

  const currentPrimary = selected.filter((source) => (
    source.maturity !== 'retired'
    && source.maturity !== 'draft'
  ));
  if (practice.evidenceStrength === 'normative') {
    if (!currentPrimary.some((source) => source.kind === 'normative-standard')) {
      throw new Error(`Practice ${practice.id} normative evidence requires a current normative standard.`);
    }
  } else if (practice.evidenceStrength === 'convergent-authoritative') {
    if (
      currentPrimary.length < 2
      || new Set(currentPrimary.map((source) => source.publisher)).size < 2
    ) {
      throw new Error(`Practice ${practice.id} convergent evidence requires two current publishers.`);
    }
  } else if (practice.evidenceStrength === 'single-primary') {
    if (currentPrimary.length < 1) {
      throw new Error(`Practice ${practice.id} requires one current primary source.`);
    }
  }

  if (
    (practice.disposition === 'adopt' || practice.disposition === 'adapt')
    && practice.evidenceStrength === 'exploratory'
  ) {
    throw new Error(`Practice ${practice.id} cannot adopt exploratory evidence.`);
  }
}

function requireValue(
  value: string | number | null,
  label: string
): void {
  if (value === null) throw new Error(`${label} is required.`);
}

function assertDisposition(
  practice: EngineeringPracticeV1,
  registry: DocumentationAuthorityRegistry
): void {
  for (const id of practice.targetAuthorityIds) assertOwningAuthority(registry, id);

  const hasTargets =
    practice.targetAuthorityIds.length > 0
    && practice.targetPaths.length > 0;

  if (practice.disposition === 'already-covered') {
    if (!hasTargets) throw new Error(`Practice ${practice.id} already-covered requires canonical targets.`);
    requireValue(practice.evidenceRequirement, `Practice ${practice.id}.evidenceRequirement`);
    if (
      practice.relatedIssue !== null
      || practice.activationTrigger !== null
      || practice.reversalCondition !== null
    ) {
      throw new Error(`Practice ${practice.id} already-covered cannot carry future activation fields.`);
    }
    return;
  }

  if (practice.disposition === 'adopt' || practice.disposition === 'adapt') {
    if (!hasTargets) throw new Error(`Practice ${practice.id} ${practice.disposition} requires canonical targets.`);
    requireValue(practice.relatedIssue, `Practice ${practice.id}.relatedIssue`);
    requireValue(practice.evidenceRequirement, `Practice ${practice.id}.evidenceRequirement`);
    requireValue(practice.activationTrigger, `Practice ${practice.id}.activationTrigger`);
    requireValue(practice.reversalCondition, `Practice ${practice.id}.reversalCondition`);
    return;
  }

  if (practice.disposition === 'defer' || practice.disposition === 'experiment') {
    if (!hasTargets) throw new Error(`Practice ${practice.id} ${practice.disposition} requires target owners and paths.`);
    requireValue(practice.relatedIssue, `Practice ${practice.id}.relatedIssue`);
    requireValue(practice.evidenceRequirement, `Practice ${practice.id}.evidenceRequirement`);
    requireValue(practice.activationTrigger, `Practice ${practice.id}.activationTrigger`);
    requireValue(practice.reversalCondition, `Practice ${practice.id}.reversalCondition`);
    return;
  }

  if (practice.disposition === 'reject') {
    requireValue(practice.reversalCondition, `Practice ${practice.id}.reversalCondition`);
    if (practice.evidenceRequirement !== null || practice.activationTrigger !== null) {
      throw new Error(`Practice ${practice.id} reject cannot carry activation or evidence requirements.`);
    }
  }
}

function assertConflictGroups(practices: readonly EngineeringPracticeV1[]): void {
  const groups = new Map<string, EngineeringPracticeV1[]>();
  for (const practice of practices) {
    if (practice.conflictGroup === null) continue;
    const values = groups.get(practice.conflictGroup) ?? [];
    values.push(practice);
    groups.set(practice.conflictGroup, values);
  }

  for (const [group, values] of groups) {
    const selected = values.filter((practice) => SELECTED_DISPOSITIONS.has(practice.disposition));
    if (selected.length > 1) {
      throw new Error(
        `Practice conflict group ${group} has multiple selected alternatives: `
        + selected.map((practice) => practice.id).sort().join(', ')
      );
    }
  }
}

function freezeCorpus(corpus: EngineeringPracticeCorpusV1): EngineeringPracticeCorpusV1 {
  const sources = corpus.sources.map((source) => Object.freeze({ ...source }));
  const practices = corpus.practices.map((practice) => Object.freeze({
    ...practice,
    sourceIds: Object.freeze([...practice.sourceIds]),
    targetAuthorityIds: Object.freeze([...practice.targetAuthorityIds]),
    targetPaths: Object.freeze([...practice.targetPaths])
  }));
  return Object.freeze({
    ...corpus,
    sources: Object.freeze(sources),
    practices: Object.freeze(practices)
  });
}

export function parseEngineeringPracticeCorpusV1(
  value: unknown,
  registry: DocumentationAuthorityRegistry,
  asOf: string
): EngineeringPracticeCorpusV1 {
  assertPlainObject(value, 'engineering practice corpus');
  assertExactKeys(value, TOP_LEVEL_KEYS, 'engineering practice corpus');
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

  const checkedAsOf = date(asOf, 'asOf');
  const observedAt = date(value.observedAt, 'observedAt');
  if (observedAt > checkedAsOf) {
    throw new Error('Engineering practice corpus observedAt cannot be in the future.');
  }
  if (!Array.isArray(value.sources) || !Array.isArray(value.practices)) {
    throw new Error('Engineering practice corpus sources and practices must be arrays.');
  }

  const sources = value.sources.map(parseSource);
  const practices = value.practices.map(parsePractice);
  assertCanonicalOrder(sources, 'Engineering practice sources');
  assertCanonicalOrder(practices, 'Engineering practices');

  const urls = new Set<string>();
  for (const source of sources) {
    if (urls.has(source.url)) {
      throw new Error(`Engineering practice source URL is duplicated: ${source.url}.`);
    }
    urls.add(source.url);
    if (source.observedAt > observedAt) {
      throw new Error(`Source ${source.id} was observed after the corpus.`);
    }
    if (
      source.reviewAfter !== null
      && source.reviewAfter < checkedAsOf
      && source.maturity !== 'retired'
    ) {
      throw new Error(`Engineering practice source ${source.id} requires freshness review.`);
    }
  }

  for (const practice of practices) {
    assertEvidenceStrength(practice, sources);
    assertDisposition(practice, registry);
  }
  assertConflictGroups(practices);

  return freezeCorpus({
    schema: SEC_ENGINEERING_PRACTICE_CORPUS_SCHEMA,
    authoritative: false,
    instructionAuthority: 'none',
    adoptionPolicy: 'canonical-owner-migration-required',
    observedAt,
    sources,
    practices
  });
}
