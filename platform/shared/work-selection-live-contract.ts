import {
  canonicalEquals,
  canonicalJson,
  compareCodeUnits,
  deepFreeze,
  rawSha256,
  sha256
} from './canonical-primitives.ts';
import {
  SEC_WORK_PRIORITY_CLASSES,
  SEC_WORK_SELECTION_POLICY_REVISION,
  assertSecWorkDecisionV1,
  compileSecWorkDecisionV1,
  computeSecWorkCandidateSetRevisionV1,
  evaluateSecWorkCandidateV1,
  parseSecWorkSelectionInputV1,
  type SecCurrentWorkLifecycleV1,
  type SecWorkCandidateDecisionStatus,
  type SecWorkCandidateV1,
  type SecWorkDecisionV1,
  type SecWorkDependencyFactV1,
  type SecWorkDigestV1,
  type SecWorkPriorityClass,
  type SecWorkSelectionInputV1
} from './work-selection-contract.ts';

export const SEC_ROADMAP_WORK_CATALOG_SCHEMA_V1 =
  'sec-roadmap-work-catalog-v1' as const;
export const SEC_WORK_DECISION_RECEIPT_SCHEMA_V1 =
  'sec-work-decision-receipt-v1' as const;
export const SEC_WORK_ROLLING_PROJECTION_SCHEMA_V1 =
  'sec-work-rolling-projection-v1' as const;
export const SEC_WORK_SELECTION_LIVE_RESULT_SCHEMA_V1 =
  'sec-work-selection-live-result-v1' as const;
export const SEC_WORK_SELECTION_LIVE_ISSUER_V1 =
  'sec-work-selection-live-adapter-v1' as const;
export const SEC_ROADMAP_WORK_CATALOG_BEGIN =
  '<!-- sec-work-selection-roadmap-catalog-v1:begin -->' as const;
export const SEC_ROADMAP_WORK_CATALOG_END =
  '<!-- sec-work-selection-roadmap-catalog-v1:end -->' as const;

export type SecRoadmapCatalogDispositionV1 = 'active' | 'deferred' | 'superseded';

export interface SecRoadmapWorkCatalogItemV1 {
  readonly packageId: string;
  readonly workId: string;
  readonly tracking: string;
  readonly currentSpecRef: string;
  readonly ownerRef: string;
  readonly kind: SecWorkCandidateV1['kind'];
  readonly disposition: SecRoadmapCatalogDispositionV1;
  readonly priorityClass: SecWorkPriorityClass;
  readonly priorityEvidenceRefs: readonly string[];
  readonly prerequisiteWorkIds: readonly string[];
  readonly orderedAfterWorkIds: readonly string[];
  readonly reproductionOrEvidenceFreshness:
    SecWorkCandidateV1['reproductionOrEvidenceFreshness'];
  readonly rootCauseState: SecWorkCandidateV1['rootCauseState'];
  readonly rootCauseRef: string;
  readonly scopeClosure: SecWorkCandidateV1['scopeClosure'];
  readonly exitCriteriaRef: string;
  readonly nearTermConsumerRef: string | null;
  readonly humanDecisionRef: string | null;
}

export interface SecRoadmapWorkCatalogV1 {
  readonly schema: typeof SEC_ROADMAP_WORK_CATALOG_SCHEMA_V1;
  readonly stageRef: string;
  readonly items: readonly SecRoadmapWorkCatalogItemV1[];
  readonly catalogDigest: SecWorkDigestV1;
}

export interface SecWorkCurrentSpecObservationV1 {
  readonly workId: string;
  readonly currentSpecRef: string;
  readonly providerResourceRef: string;
  readonly providerState: 'open' | 'closed';
  readonly currentSpecRevision: SecWorkDigestV1;
  readonly observationDigest: SecWorkDigestV1;
}

export interface SecWorkRegistryEntryObservationV1 {
  readonly manifestPath: string;
  readonly manifestDigest: SecWorkDigestV1;
  readonly source: 'default' | 'open-pr';
  readonly prNumber: number | null;
  readonly baseSha: string | null;
  readonly headSha: string | null;
  readonly headTreeSha: string | null;
}

export interface SecWorkRegistryObservationV1 {
  readonly defaultTreeSha: string;
  readonly entries: readonly SecWorkRegistryEntryObservationV1[];
  readonly registryDigest: SecWorkDigestV1;
}

export interface SecWorkDecisionReceiptV1 {
  readonly schema: typeof SEC_WORK_DECISION_RECEIPT_SCHEMA_V1;
  readonly issuer: typeof SEC_WORK_SELECTION_LIVE_ISSUER_V1;
  readonly repository: string;
  readonly exactMain: string;
  readonly exactMainTree: string;
  readonly roadmapPath: 'docs/roadmap.md';
  readonly roadmapRevision: SecWorkDigestV1;
  readonly catalog: SecRoadmapWorkCatalogV1;
  readonly registry: SecWorkRegistryObservationV1;
  readonly lifecycleDigest: SecWorkDigestV1;
  readonly currentSpecs: readonly SecWorkCurrentSpecObservationV1[];
  readonly input: SecWorkSelectionInputV1;
  readonly decision: SecWorkDecisionV1;
  readonly receiptDigest: SecWorkDigestV1;
}

export interface SecWorkRollingProjectionItemV1 {
  readonly packageId: string;
  readonly workId: string;
  readonly tracking: string;
  readonly currentSpecRef: string;
  readonly currentSpecRevision: SecWorkDigestV1;
  readonly decisionStatus: SecWorkCandidateDecisionStatus | 'selected';
}

export interface SecWorkRollingProjectionV1 {
  readonly schema: typeof SEC_WORK_ROLLING_PROJECTION_SCHEMA_V1;
  readonly exactMain: string;
  readonly roadmapRevision: SecWorkDigestV1;
  readonly catalogDigest: SecWorkDigestV1;
  readonly receiptDigest: SecWorkDigestV1;
  readonly decisionDigest: SecWorkDigestV1;
  readonly active: SecWorkRollingProjectionItemV1;
  readonly candidates: readonly SecWorkRollingProjectionItemV1[];
  readonly projectionDigest: SecWorkDigestV1;
}

export type SecWorkSelectionLiveResultV1 = Readonly<
  | {
    schema: typeof SEC_WORK_SELECTION_LIVE_RESULT_SCHEMA_V1;
    status: 'resolved';
    reasonCodes: readonly [];
    blockerRefs: readonly [];
    receipt: SecWorkDecisionReceiptV1;
    resultDigest: SecWorkDigestV1;
  }
  | {
    schema: typeof SEC_WORK_SELECTION_LIVE_RESULT_SCHEMA_V1;
    status: 'unresolved';
    reasonCodes: readonly string[];
    blockerRefs: readonly string[];
    receipt: null;
    resultDigest: SecWorkDigestV1;
  }
>;

const CATALOG_KEYS = ['schema', 'stageRef', 'items'] as const;
const CATALOG_ITEM_KEYS = [
  'packageId', 'workId', 'tracking', 'currentSpecRef', 'ownerRef', 'kind',
  'disposition', 'priorityClass', 'priorityEvidenceRefs', 'prerequisiteWorkIds',
  'orderedAfterWorkIds',
  'reproductionOrEvidenceFreshness', 'rootCauseState', 'rootCauseRef',
  'scopeClosure', 'exitCriteriaRef', 'nearTermConsumerRef', 'humanDecisionRef'
] as const;

function fail(message: string): never {
  throw new Error(`Work Selection Live V1: ${message}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be one object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort(compareCodeUnits);
  const expected = [...keys].sort(compareCodeUnits);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} keys must be exact; received ${actual.join(',')}.`);
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512
      || /[\u0000-\u0020\u007f]/u.test(value)) {
    fail(`${label} must be one bounded canonical token or reference.`);
  }
  return value;
}

function token(value: unknown, label: string): string {
  const parsed = text(value, label);
  if (!/^[a-z0-9][a-z0-9._:/-]*$/u.test(parsed)) {
    fail(`${label} must use canonical lowercase token syntax.`);
  }
  return parsed;
}

function packageId(value: unknown, label: string): string {
  const parsed = token(value, label);
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(parsed)) {
    fail(`${label} must be one canonical Work Package id.`);
  }
  return parsed;
}

function digest(value: unknown, label: string): SecWorkDigestV1 {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    fail(`${label} must be one SHA-256 digest.`);
  }
  return value as SecWorkDigestV1;
}

function gitSha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    fail(`${label} must be one lowercase full Git object id.`);
  }
  return value;
}

function enumeration<Value extends string>(
  value: unknown,
  values: readonly Value[],
  label: string
): Value {
  if (typeof value !== 'string' || !values.includes(value as Value)) {
    fail(`${label} must be one of ${values.join(',')}.`);
  }
  return value as Value;
}

function optionalReference(value: unknown, label: string): string | null {
  return value === null ? null : text(value, label);
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) fail(`${label} must be one array.`);
  const entries = value.map((entry, index) => text(entry, `${label}[${index}]`));
  if (new Set(entries).size !== entries.length) fail(`${label} contains a duplicate.`);
  return entries.sort(compareCodeUnits);
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be one non-negative safe integer.`);
  }
  return value;
}

function parseCatalogItem(value: unknown, index: number): SecRoadmapWorkCatalogItemV1 {
  const label = `catalog.items[${index}]`;
  const item = record(value, label);
  exactKeys(item, CATALOG_ITEM_KEYS, label);
  const parsed: SecRoadmapWorkCatalogItemV1 = {
    packageId: packageId(item.packageId, `${label}.packageId`),
    workId: token(item.workId, `${label}.workId`),
    tracking: token(item.tracking, `${label}.tracking`),
    currentSpecRef: text(item.currentSpecRef, `${label}.currentSpecRef`),
    ownerRef: text(item.ownerRef, `${label}.ownerRef`),
    kind: enumeration(
      item.kind,
      ['focused', 'program', 'maintenance', 'diagnostic', 'spike'] as const,
      `${label}.kind`
    ),
    disposition: enumeration(
      item.disposition,
      ['active', 'deferred', 'superseded'] as const,
      `${label}.disposition`
    ),
    priorityClass: enumeration(item.priorityClass, SEC_WORK_PRIORITY_CLASSES, `${label}.priorityClass`),
    priorityEvidenceRefs: stringArray(item.priorityEvidenceRefs, `${label}.priorityEvidenceRefs`),
    prerequisiteWorkIds: stringArray(item.prerequisiteWorkIds, `${label}.prerequisiteWorkIds`),
    orderedAfterWorkIds: stringArray(item.orderedAfterWorkIds, `${label}.orderedAfterWorkIds`),
    reproductionOrEvidenceFreshness: enumeration(
      item.reproductionOrEvidenceFreshness,
      ['fresh', 'stale', 'missing'] as const,
      `${label}.reproductionOrEvidenceFreshness`
    ),
    rootCauseState: enumeration(
      item.rootCauseState,
      ['not-repeated', 'repeat-root-cause', 'unresolved'] as const,
      `${label}.rootCauseState`
    ),
    rootCauseRef: text(item.rootCauseRef, `${label}.rootCauseRef`),
    scopeClosure: enumeration(
      item.scopeClosure,
      ['closed', 'open', 'unresolved'] as const,
      `${label}.scopeClosure`
    ),
    exitCriteriaRef: text(item.exitCriteriaRef, `${label}.exitCriteriaRef`),
    nearTermConsumerRef: optionalReference(item.nearTermConsumerRef, `${label}.nearTermConsumerRef`),
    humanDecisionRef: optionalReference(item.humanDecisionRef, `${label}.humanDecisionRef`)
  };
  if (!/^issue-[1-9][0-9]*$/u.test(parsed.tracking)) {
    fail(`${label}.tracking must bind one canonical Issue identity.`);
  }
  const trackingNumber = Number(parsed.tracking.slice('issue-'.length));
  if (!Number.isSafeInteger(trackingNumber) || trackingNumber > 2_147_483_647) {
    fail(`${label}.tracking Issue number is outside the canonical provider range.`);
  }
  if (!/^github:issue\/[1-9][0-9]*$/u.test(parsed.currentSpecRef)) {
    fail(`${label}.currentSpecRef must bind one canonical GitHub Issue resource.`);
  }
  if (parsed.currentSpecRef !== `github:issue/${parsed.tracking.slice('issue-'.length)}`) {
    fail(`${label}.tracking and currentSpecRef must bind the same Issue identity.`);
  }
  if (parsed.priorityClass === 'near-term-acceleration' && parsed.nearTermConsumerRef === null) {
    fail(`${label} near-term acceleration requires one consumer ref.`);
  }
  if (parsed.priorityClass !== 'maintenance-required'
      && parsed.priorityClass !== 'defer'
      && parsed.priorityEvidenceRefs.length === 0) {
    fail(`${label} priority requires at least one project-owned evidence ref.`);
  }
  return deepFreeze(parsed);
}

function normalizeCatalog(value: unknown): SecRoadmapWorkCatalogV1 {
  const catalog = record(value, 'catalog');
  exactKeys(catalog, CATALOG_KEYS, 'catalog');
  if (catalog.schema !== SEC_ROADMAP_WORK_CATALOG_SCHEMA_V1) {
    fail(`catalog.schema must be ${SEC_ROADMAP_WORK_CATALOG_SCHEMA_V1}.`);
  }
  if (!Array.isArray(catalog.items) || catalog.items.length < 3 || catalog.items.length > 7) {
    fail('catalog.items must contain three to seven bounded near-term records.');
  }
  const items = catalog.items.map(parseCatalogItem);
  for (const [label, values] of [
    ['packageId', items.map((item) => item.packageId)],
    ['workId', items.map((item) => item.workId)],
    ['tracking', items.map((item) => item.tracking)],
    ['currentSpecRef', items.map((item) => item.currentSpecRef)]
  ] as const) {
    if (new Set(values).size !== values.length) fail(`catalog contains duplicate ${label}.`);
  }
  const workIds = new Set(items.map((item) => item.workId));
  const itemIndex = new Map(items.map((item, index) => [item.workId, index]));
  for (const [index, item] of items.entries()) {
    const dependencies = [...item.prerequisiteWorkIds, ...item.orderedAfterWorkIds];
    if (new Set(dependencies).size !== dependencies.length) {
      fail(`catalog item ${item.workId} repeats one dependency.`);
    }
    if (dependencies.includes(item.workId)) fail(`catalog item ${item.workId} depends on itself.`);
    for (const dependency of dependencies) {
      if (!workIds.has(dependency)) {
        fail(`catalog item ${item.workId} references unknown dependency ${dependency}.`);
      }
      if (itemIndex.get(dependency)! >= index) {
        fail(`catalog item ${item.workId} dependency ${dependency} must precede it in roadmap order.`);
      }
    }
  }
  const withoutDigest = deepFreeze({
    schema: SEC_ROADMAP_WORK_CATALOG_SCHEMA_V1,
    stageRef: token(catalog.stageRef, 'catalog.stageRef'),
    items
  });
  return deepFreeze({
    ...withoutDigest,
    catalogDigest: sha256(withoutDigest) as SecWorkDigestV1
  });
}

function parseDuplicateAwareJson(source: string): unknown {
  if (source.length === 0 || source.length > 256 * 1024) {
    fail('roadmap catalog JSON must be non-empty and bounded to 256 KiB.');
  }
  let cursor = 0;
  let depth = 0;
  const whitespace = () => {
    while (cursor < source.length && /[\u0009\u000a\u000d\u0020]/u.test(source[cursor]!)) cursor += 1;
  };
  const syntax = (message: string): never => fail(`roadmap catalog JSON is invalid at offset ${cursor}: ${message}.`);
  const parseString = (): string => {
    if (source[cursor] !== '"') return syntax('expected string');
    const start = cursor;
    cursor += 1;
    while (cursor < source.length) {
      const character = source[cursor]!;
      if (character === '"') {
        cursor += 1;
        try {
          const parsed: unknown = JSON.parse(source.slice(start, cursor));
          if (typeof parsed !== 'string') return syntax('string token did not decode as text');
          return parsed;
        } catch {
          return syntax('string escape is malformed');
        }
      }
      if (character === '\\') {
        cursor += 1;
        const escape = source[cursor];
        if (escape === undefined) return syntax('string escape is truncated');
        if (escape === 'u') {
          const digits = source.slice(cursor + 1, cursor + 5);
          if (!/^[0-9a-fA-F]{4}$/u.test(digits)) return syntax('unicode escape is malformed');
          cursor += 5;
          continue;
        }
        if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escape)) {
          return syntax('string escape is unsupported');
        }
        cursor += 1;
        continue;
      }
      if (character.charCodeAt(0) < 0x20) return syntax('string contains an unescaped control character');
      cursor += 1;
    }
    return syntax('string is unterminated');
  };
  const parseValue = (): unknown => {
    whitespace();
    if (depth >= 64) return syntax('nesting exceeds the bounded depth');
    const character = source[cursor];
    if (character === '"') return parseString();
    if (character === '{') {
      depth += 1;
      cursor += 1;
      whitespace();
      const result = Object.create(null) as Record<string, unknown>;
      const keys = new Set<string>();
      if (source[cursor] === '}') {
        cursor += 1;
        depth -= 1;
        return result;
      }
      while (cursor < source.length) {
        whitespace();
        const key = parseString();
        if (keys.has(key)) fail(`roadmap catalog JSON object contains duplicate key ${JSON.stringify(key)}.`);
        keys.add(key);
        whitespace();
        if (source[cursor] !== ':') return syntax('expected colon after object key');
        cursor += 1;
        result[key] = parseValue();
        whitespace();
        if (source[cursor] === '}') {
          cursor += 1;
          depth -= 1;
          return result;
        }
        if (source[cursor] !== ',') return syntax('expected comma or object terminator');
        cursor += 1;
      }
      return syntax('object is unterminated');
    }
    if (character === '[') {
      depth += 1;
      cursor += 1;
      whitespace();
      const result: unknown[] = [];
      if (source[cursor] === ']') {
        cursor += 1;
        depth -= 1;
        return result;
      }
      while (cursor < source.length) {
        result.push(parseValue());
        whitespace();
        if (source[cursor] === ']') {
          cursor += 1;
          depth -= 1;
          return result;
        }
        if (source[cursor] !== ',') return syntax('expected comma or array terminator');
        cursor += 1;
      }
      return syntax('array is unterminated');
    }
    for (const [literal, value] of [['true', true], ['false', false], ['null', null]] as const) {
      if (source.startsWith(literal, cursor)) {
        cursor += literal.length;
        return value;
      }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(source.slice(cursor))?.[0];
    if (number !== undefined) {
      cursor += number.length;
      const value = Number(number);
      if (!Number.isFinite(value)) return syntax('number is outside the finite JSON range');
      return value;
    }
    return syntax('expected one JSON value');
  };
  const parsed = parseValue();
  whitespace();
  if (cursor !== source.length) return syntax('trailing bytes are forbidden');
  return parsed;
}

export function parseSecRoadmapWorkCatalogV1(source: string): SecRoadmapWorkCatalogV1 {
  const begin = source.indexOf(SEC_ROADMAP_WORK_CATALOG_BEGIN);
  const end = source.indexOf(SEC_ROADMAP_WORK_CATALOG_END);
  if (begin < 0 || end <= begin
      || source.indexOf(SEC_ROADMAP_WORK_CATALOG_BEGIN, begin + 1) >= 0
      || source.indexOf(SEC_ROADMAP_WORK_CATALOG_END, end + 1) >= 0) {
    fail('canonical roadmap must contain exactly one ordered catalog marker pair.');
  }
  const between = source.slice(begin + SEC_ROADMAP_WORK_CATALOG_BEGIN.length, end);
  const match = /^\r?\n```json\r?\n([\s\S]*?)\r?\n```\r?\n$/u.exec(between);
  if (match === null) fail('roadmap catalog markers must enclose exactly one JSON code block.');
  return normalizeCatalog(parseDuplicateAwareJson(match[1]!));
}

function normalizeCurrentSpecObservation(
  value: SecWorkCurrentSpecObservationV1,
  label: string
): SecWorkCurrentSpecObservationV1 {
  const withoutDigest = {
    workId: token(value.workId, `${label}.workId`),
    currentSpecRef: text(value.currentSpecRef, `${label}.currentSpecRef`),
    providerResourceRef: text(value.providerResourceRef, `${label}.providerResourceRef`),
    providerState: enumeration(value.providerState, ['open', 'closed'] as const, `${label}.providerState`),
    currentSpecRevision: digest(value.currentSpecRevision, `${label}.currentSpecRevision`)
  };
  const observationDigest = digest(value.observationDigest, `${label}.observationDigest`);
  if (sha256(withoutDigest) !== observationDigest) {
    fail(`${label}.observationDigest does not bind the normalized observation.`);
  }
  return deepFreeze({ ...withoutDigest, observationDigest });
}

export function createSecWorkCurrentSpecObservationV1(input: Omit<
  SecWorkCurrentSpecObservationV1,
  'observationDigest'
>): SecWorkCurrentSpecObservationV1 {
  const withoutDigest = {
    workId: token(input.workId, 'currentSpec.workId'),
    currentSpecRef: text(input.currentSpecRef, 'currentSpec.currentSpecRef'),
    providerResourceRef: text(input.providerResourceRef, 'currentSpec.providerResourceRef'),
    providerState: enumeration(
      input.providerState,
      ['open', 'closed'] as const,
      'currentSpec.providerState'
    ),
    currentSpecRevision: digest(input.currentSpecRevision, 'currentSpec.currentSpecRevision')
  };
  return deepFreeze({
    ...withoutDigest,
    observationDigest: sha256(withoutDigest) as SecWorkDigestV1
  });
}

function normalizeRegistry(input: SecWorkRegistryObservationV1): SecWorkRegistryObservationV1 {
  const entries = [...input.entries].map((entry, index) => {
    const label = `registry.entries[${index}]`;
    const manifestPath = text(entry.manifestPath, `${label}.manifestPath`);
    if (!/^docs\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(manifestPath)) {
      fail(`${label}.manifestPath is not canonical.`);
    }
    const normalized = {
      manifestPath,
      manifestDigest: digest(entry.manifestDigest, `${label}.manifestDigest`),
      source: enumeration(entry.source, ['default', 'open-pr'] as const, `${label}.source`),
      prNumber: entry.prNumber === null
        ? null
        : nonNegativeInteger(entry.prNumber, `${label}.prNumber`),
      baseSha: entry.baseSha === null ? null : gitSha(entry.baseSha, `${label}.baseSha`),
      headSha: entry.headSha === null ? null : gitSha(entry.headSha, `${label}.headSha`),
      headTreeSha: entry.headTreeSha === null ? null : gitSha(entry.headTreeSha, `${label}.headTreeSha`)
    };
    if (normalized.source === 'default'
        && (normalized.prNumber !== null || normalized.baseSha !== null
          || normalized.headSha !== null || normalized.headTreeSha !== null)) {
      fail(`${label} default entry cannot carry PR identity.`);
    }
    if (normalized.source === 'open-pr'
        && (normalized.prNumber === null || normalized.prNumber <= 0
          || normalized.baseSha === null || normalized.headSha === null
          || normalized.headTreeSha === null)) {
      fail(`${label} open PR entry requires exact PR identity.`);
    }
    return deepFreeze(normalized);
  }).sort((left, right) => (
    compareCodeUnits(left.manifestPath, right.manifestPath)
    || compareCodeUnits(left.source, right.source)
  ));
  if (new Set(entries.map((entry) => `${entry.source}:${entry.manifestPath}`)).size !== entries.length) {
    fail('registry repeats one source and manifest path.');
  }
  const withoutDigest = {
    defaultTreeSha: gitSha(input.defaultTreeSha, 'registry.defaultTreeSha'),
    entries
  };
  const registryDigest = digest(input.registryDigest, 'registry.registryDigest');
  if (sha256(withoutDigest) !== registryDigest) {
    fail('registry.registryDigest does not bind the stable registry projection.');
  }
  return deepFreeze({ ...withoutDigest, registryDigest });
}

export function createSecWorkRegistryObservationV1(input: Omit<
  SecWorkRegistryObservationV1,
  'registryDigest'
>): SecWorkRegistryObservationV1 {
  const ordered = [...input.entries].sort((left, right) => (
    compareCodeUnits(left.manifestPath, right.manifestPath)
    || compareCodeUnits(left.source, right.source)
  ));
  return normalizeRegistry({
    defaultTreeSha: input.defaultTreeSha,
    entries: ordered,
    registryDigest: sha256({
      defaultTreeSha: input.defaultTreeSha,
      entries: ordered
    }) as SecWorkDigestV1
  });
}

function dependencyFacts(
  workIds: readonly string[],
  itemsByWorkId: ReadonlyMap<string, SecRoadmapWorkCatalogItemV1>,
  completedManifests: ReadonlySet<string>
): SecWorkDependencyFactV1[] {
  return workIds.map((workId) => {
    const dependency = itemsByWorkId.get(workId);
    if (dependency === undefined) fail(`dependency ${workId} disappeared after catalog validation.`);
    const manifestPath = `docs/work-packages/${dependency.packageId}.md`;
    return {
      ref: `work-package:${dependency.packageId}`,
      status: completedManifests.has(manifestPath) ? 'satisfied' : 'unsatisfied'
    };
  });
}

function blockedReadySuccessorCount(
  candidate: SecWorkCandidateV1,
  candidates: readonly SecWorkCandidateV1[],
  itemsByWorkId: ReadonlyMap<string, SecRoadmapWorkCatalogItemV1>
): number {
  const item = itemsByWorkId.get(candidate.workId);
  if (item === undefined) fail(`candidate ${candidate.workId} disappeared after catalog validation.`);
  const targetRef = `work-package:${item.packageId}`;
  return candidates.filter((successor) => {
    if (successor.workId === candidate.workId) return false;
    const dependencyFacts = [...successor.prerequisiteFacts, ...successor.orderedAfterFacts];
    if (!dependencyFacts.some(({ ref, status }) => ref === targetRef && status === 'unsatisfied')) {
      return false;
    }
    const prerequisiteFacts = successor.prerequisiteFacts.map((fact) => (
      fact.ref === targetRef ? { ...fact, status: 'satisfied' as const } : fact
    ));
    const orderedAfterFacts = successor.orderedAfterFacts.map((fact) => (
      fact.ref === targetRef ? { ...fact, status: 'satisfied' as const } : fact
    ));
    const readiness = [...prerequisiteFacts, ...orderedAfterFacts]
      .every(({ status }) => status === 'satisfied') ? 'ready' as const : 'not-ready' as const;
    const hypothetical = deepFreeze({
      ...successor,
      readiness,
      prerequisiteFacts,
      orderedAfterFacts,
      blockedReadySuccessorCount: 0
    });
    return evaluateSecWorkCandidateV1(hypothetical).decision.status === 'eligible';
  }).length;
}

function candidateFromLiveFacts(input: {
  item: SecRoadmapWorkCatalogItemV1;
  catalog: SecRoadmapWorkCatalogV1;
  currentSpec: SecWorkCurrentSpecObservationV1;
  registry: SecWorkRegistryObservationV1;
  current: SecCurrentWorkLifecycleV1;
  lifecycleDigest: SecWorkDigestV1;
  itemsByWorkId: ReadonlyMap<string, SecRoadmapWorkCatalogItemV1>;
  completedManifests: ReadonlySet<string>;
}): SecWorkCandidateV1 {
  const completionManifest = `docs/work-packages/${input.item.packageId}.md`;
  const alreadyInMain = input.completedManifests.has(completionManifest);
  if (!alreadyInMain && input.item.disposition === 'active'
      && input.currentSpec.providerState !== 'open') {
    fail(`${input.item.workId} current spec is closed without default-branch completion evidence.`);
  }
  const lifecycle: SecWorkCandidateV1['lifecycle'] = alreadyInMain
    ? 'already-in-main'
    : input.item.disposition === 'superseded'
      ? 'superseded'
      : input.item.disposition === 'deferred'
        ? 'deferred'
        : 'open';
  const prerequisiteFacts = dependencyFacts(
    input.item.prerequisiteWorkIds,
    input.itemsByWorkId,
    input.completedManifests
  );
  const orderedAfterFacts = dependencyFacts(
    input.item.orderedAfterWorkIds,
    input.itemsByWorkId,
    input.completedManifests
  );
  const readiness = lifecycle !== 'open'
    ? 'not-ready'
    : [...prerequisiteFacts, ...orderedAfterFacts].every(({ status }) => status === 'satisfied')
      ? 'ready'
      : 'not-ready';
  const noConcurrentConflictSubject = input.current.activeState === 'none'
    && input.current.activeLegality === 'not-applicable'
    && input.current.closeoutState === 'none'
    && input.current.controlState === 'consistent'
    && input.current.mainHealthState === 'healthy';
  return deepFreeze({
    workId: input.item.workId,
    candidateRef: `roadmap:${input.catalog.stageRef}/${input.item.packageId}`,
    currentSpecRef: input.currentSpec.currentSpecRef,
    currentSpecRevision: input.currentSpec.currentSpecRevision,
    ownerRef: input.item.ownerRef,
    kind: input.item.kind,
    lifecycle,
    lifecycleRef: alreadyInMain
      ? input.registry.entries.find((entry) => (
        entry.source === 'default' && entry.manifestPath === completionManifest
      ))!.manifestDigest
      : input.currentSpec.observationDigest,
    priorityClass: input.item.priorityClass,
    priorityEvidenceRefs: [...input.item.priorityEvidenceRefs],
    readiness,
    readinessRef: input.catalog.catalogDigest,
    prerequisiteFacts,
    orderedAfterFacts,
    // #207 has no pair to resolve only when the current lifecycle proves there
    // is no concurrent candidate/effect residue. Any other frontier remains
    // unresolved here and is handled by the current-action precedence first.
    conflictStatus: noConcurrentConflictSubject ? 'clear' : 'unresolved',
    conflictDecisionRefs: [input.lifecycleDigest],
    // Filled in a second pass after every candidate lifecycle/dependency fact
    // exists. Zero here prevents recursive rank influence during eligibility.
    blockedReadySuccessorCount: 0,
    // Inclusion in the strict canonical roadmap catalog is the machine proof;
    // persisting this derived bit in the catalog would create a drift surface.
    roadmapDirect: true,
    reproductionOrEvidenceFreshness: input.item.reproductionOrEvidenceFreshness,
    rootCauseState: input.item.rootCauseState,
    rootCauseRef: input.item.rootCauseRef,
    scopeClosure: input.item.scopeClosure,
    exitCriteriaRef: input.item.exitCriteriaRef,
    nearTermConsumerRef: input.item.nearTermConsumerRef,
    humanDecisionRef: input.item.humanDecisionRef
  });
}

function receiptWithoutDigest(input: {
  repository: string;
  exactMain: string;
  exactMainTree: string;
  roadmapRevision: SecWorkDigestV1;
  catalog: SecRoadmapWorkCatalogV1;
  registry: SecWorkRegistryObservationV1;
  current: SecCurrentWorkLifecycleV1;
  currentSpecs: readonly SecWorkCurrentSpecObservationV1[];
}): Omit<SecWorkDecisionReceiptV1, 'receiptDigest'> {
  const exactMain = gitSha(input.exactMain, 'receipt.exactMain');
  const exactMainTree = gitSha(input.exactMainTree, 'receipt.exactMainTree');
  const catalog = normalizeCatalog({
    schema: input.catalog.schema,
    stageRef: input.catalog.stageRef,
    items: input.catalog.items
  });
  if (catalog.catalogDigest !== input.catalog.catalogDigest) {
    fail('receipt catalog digest differs from the normalized roadmap catalog.');
  }
  const registry = normalizeRegistry(input.registry);
  if (registry.defaultTreeSha !== exactMainTree) {
    fail('registry default tree is not the exact main tree.');
  }
  const currentSpecs = input.currentSpecs.map((entry, index) => (
    normalizeCurrentSpecObservation(entry, `currentSpecs[${index}]`)
  )).sort((left, right) => compareCodeUnits(left.workId, right.workId));
  if (new Set(currentSpecs.map(({ workId }) => workId)).size !== currentSpecs.length
      || currentSpecs.length !== catalog.items.length) {
    fail('current spec observations must cover each catalog work item exactly once.');
  }
  const currentSpecsByWorkId = new Map(currentSpecs.map((entry) => [entry.workId, entry]));
  for (const item of catalog.items) {
    const observation = currentSpecsByWorkId.get(item.workId);
    if (observation === undefined || observation.currentSpecRef !== item.currentSpecRef) {
      fail(`current spec observation for ${item.workId} does not bind the catalog ref.`);
    }
  }
  const lifecycleDigest = sha256(input.current) as SecWorkDigestV1;
  const itemsByWorkId = new Map(catalog.items.map((item) => [item.workId, item]));
  const completedManifests = new Set(registry.entries
    .filter(({ source }) => source === 'default')
    .map(({ manifestPath }) => manifestPath));
  const baseCandidates = catalog.items.map((item) => candidateFromLiveFacts({
    item,
    catalog,
    currentSpec: currentSpecsByWorkId.get(item.workId)!,
    registry,
    current: input.current,
    lifecycleDigest,
    itemsByWorkId,
    completedManifests
  }));
  const candidates = baseCandidates.map((candidate) => deepFreeze({
    ...candidate,
    blockedReadySuccessorCount: blockedReadySuccessorCount(candidate, baseCandidates, itemsByWorkId)
  }));
  const selectionInput = parseSecWorkSelectionInputV1({
    schema: 'sec-work-selection-input-v1',
    identity: {
      exactMain,
      roadmapRevision: digest(input.roadmapRevision, 'receipt.roadmapRevision'),
      candidateSetRevision: computeSecWorkCandidateSetRevisionV1(candidates),
      selectionPolicyRevision: SEC_WORK_SELECTION_POLICY_REVISION
    },
    current: input.current,
    candidates
  });
  const decision = compileSecWorkDecisionV1(selectionInput);
  return deepFreeze({
    schema: SEC_WORK_DECISION_RECEIPT_SCHEMA_V1,
    issuer: SEC_WORK_SELECTION_LIVE_ISSUER_V1,
    repository: text(input.repository, 'receipt.repository'),
    exactMain,
    exactMainTree,
    roadmapPath: 'docs/roadmap.md',
    roadmapRevision: selectionInput.identity.roadmapRevision,
    catalog,
    registry,
    lifecycleDigest,
    currentSpecs,
    input: selectionInput,
    decision
  });
}

export function createSecWorkDecisionReceiptV1(input: Parameters<
  typeof receiptWithoutDigest
>[0]): SecWorkDecisionReceiptV1 {
  const withoutDigest = receiptWithoutDigest(input);
  return deepFreeze({
    ...withoutDigest,
    receiptDigest: sha256(withoutDigest) as SecWorkDigestV1
  });
}

export function assertSecWorkDecisionReceiptV1(
  receipt: SecWorkDecisionReceiptV1,
  input: Parameters<typeof receiptWithoutDigest>[0]
): SecWorkDecisionReceiptV1 {
  const expected = createSecWorkDecisionReceiptV1(input);
  if (!canonicalEquals(receipt, expected)) {
    fail('receipt does not equal the canonical live decision for its bound sources.');
  }
  return expected;
}

function projectionItem(
  item: SecRoadmapWorkCatalogItemV1,
  receipt: SecWorkDecisionReceiptV1,
  decisionStatus: SecWorkRollingProjectionItemV1['decisionStatus']
): SecWorkRollingProjectionItemV1 {
  const binding = receipt.decision.currentSpecBindings.find(({ workId }) => workId === item.workId);
  if (binding === undefined) fail(`decision is missing current spec binding for ${item.workId}.`);
  return deepFreeze({
    packageId: item.packageId,
    workId: item.workId,
    tracking: item.tracking,
    currentSpecRef: binding.currentSpecRef,
    currentSpecRevision: binding.currentSpecRevision,
    decisionStatus
  });
}

export function compileSecWorkRollingProjectionV1(
  receipt: SecWorkDecisionReceiptV1
): SecWorkRollingProjectionV1 {
  const receiptMaterial = {
    schema: receipt.schema,
    issuer: receipt.issuer,
    repository: receipt.repository,
    exactMain: receipt.exactMain,
    exactMainTree: receipt.exactMainTree,
    roadmapPath: receipt.roadmapPath,
    roadmapRevision: receipt.roadmapRevision,
    catalog: receipt.catalog,
    registry: receipt.registry,
    lifecycleDigest: receipt.lifecycleDigest,
    currentSpecs: receipt.currentSpecs,
    input: receipt.input,
    decision: receipt.decision
  };
  if (receipt.schema !== SEC_WORK_DECISION_RECEIPT_SCHEMA_V1
      || receipt.receiptDigest !== sha256(receiptMaterial)) {
    fail('rolling projection requires one internally valid decision receipt.');
  }
  assertSecWorkDecisionV1(receipt.decision, receipt.input);
  if (receipt.decision.status !== 'select-next' || receipt.decision.selectedWorkId === null) {
    fail('rolling projection requires a select-next decision.');
  }
  const selected = receipt.catalog.items.find(({ workId }) => workId === receipt.decision.selectedWorkId);
  if (selected === undefined) fail('selected work is absent from the bound roadmap catalog.');
  const candidatesByWorkId = new Map(receipt.input.candidates.map((candidate) => [candidate.workId, candidate]));
  const witnessByWorkId = new Map(receipt.decision.rejectionWitnesses.map((witness) => [witness.workId, witness]));
  const futureItems = receipt.catalog.items.filter((item) => {
    if (item.workId === selected.workId) return false;
    const candidate = candidatesByWorkId.get(item.workId);
    return candidate !== undefined
      && candidate.lifecycle !== 'already-in-main'
      && candidate.lifecycle !== 'superseded';
  });
  if (futureItems.length < 2 || futureItems.length > 5) {
    fail('rolling projection must retain two to five nonterminal candidates after selection.');
  }
  const withoutDigest = {
    schema: SEC_WORK_ROLLING_PROJECTION_SCHEMA_V1,
    exactMain: receipt.exactMain,
    roadmapRevision: receipt.roadmapRevision,
    catalogDigest: receipt.catalog.catalogDigest,
    receiptDigest: receipt.receiptDigest,
    decisionDigest: receipt.decision.decisionDigest,
    active: projectionItem(selected, receipt, 'selected'),
    candidates: futureItems.map((item) => projectionItem(
      item,
      receipt,
      witnessByWorkId.get(item.workId)?.status ?? 'eligible'
    ))
  };
  return deepFreeze({
    ...withoutDigest,
    projectionDigest: sha256(withoutDigest) as SecWorkDigestV1
  });
}

export function renderSecWorkRollingPlanV1(input: {
  receipt: SecWorkDecisionReceiptV1;
  reviewedOn: string;
}): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.reviewedOn)
      || new Date(`${input.reviewedOn}T00:00:00.000Z`).toISOString().slice(0, 10) !== input.reviewedOn) {
    fail('rolling projection reviewedOn must be one real ISO calendar date.');
  }
  const projection = compileSecWorkRollingProjectionV1(input.receipt);
  const machine = JSON.stringify(canonicalJson(projection), null, 2);
  const candidateSections = projection.candidates.map((candidate, index) => `### ${index + 1}. ${candidate.packageId}

Work identity \`${candidate.workId}\`; current spec \`${candidate.currentSpecRef}\` at
\`${candidate.currentSpecRevision}\`; current decision status \`${candidate.decisionStatus}\`.
`).join('\n');
  return `---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: ${input.reviewedOn}
---

# SEC 滚动近期计划

本文件是validated WorkDecision的只读投影，不是roadmap、registry、current spec或selection authority。
任何选择变化都从exact main重新观察；Issue/comment prose、AI评分、wall-clock、caller JSON和本文件自身
均不能成为输入。receipt只能用于replay；effectful consumer必须调用trusted live adapter重新推导。

\`\`\`json
${machine}
\`\`\`

## 当前唯一 Work Package

### ${projection.active.packageId}

Work identity \`${projection.active.workId}\`; current spec \`${projection.active.currentSpecRef}\` at
\`${projection.active.currentSpecRevision}\`; decision \`${projection.decisionDigest}\`.

## 候选 Work Package

${candidateSections}
## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选少于二、多于五、重复、手工重排、增删；
3. WorkDecision不是select-next，或任何required fact为unknown/unresolved；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
`;
}

function liveResultDigest(value: unknown): SecWorkDigestV1 {
  return sha256(value) as SecWorkDigestV1;
}

export function resolvedSecWorkSelectionLiveResultV1(
  receipt: SecWorkDecisionReceiptV1
): SecWorkSelectionLiveResultV1 {
  const withoutDigest = deepFreeze({
    schema: SEC_WORK_SELECTION_LIVE_RESULT_SCHEMA_V1,
    status: 'resolved' as const,
    reasonCodes: [] as const,
    blockerRefs: [] as const,
    receipt
  });
  return deepFreeze({ ...withoutDigest, resultDigest: liveResultDigest(withoutDigest) });
}

export function unresolvedSecWorkSelectionLiveResultV1(input: {
  reasonCodes: readonly string[];
  blockerRefs: readonly string[];
}): SecWorkSelectionLiveResultV1 {
  const reasonCodes = [...new Set(input.reasonCodes.map((entry) => token(entry, 'reasonCode')))]
    .sort(compareCodeUnits);
  const blockerRefs = [...new Set(input.blockerRefs.map((entry) => text(entry, 'blockerRef')))]
    .sort(compareCodeUnits);
  if (reasonCodes.length === 0 || blockerRefs.length === 0) {
    fail('unresolved live result requires reason codes and bounded blocker refs.');
  }
  const withoutDigest = deepFreeze({
    schema: SEC_WORK_SELECTION_LIVE_RESULT_SCHEMA_V1,
    status: 'unresolved' as const,
    reasonCodes,
    blockerRefs,
    receipt: null
  });
  return deepFreeze({ ...withoutDigest, resultDigest: liveResultDigest(withoutDigest) });
}

export function currentSpecRevisionFromBodyV1(body: string): SecWorkDigestV1 {
  return rawSha256(body);
}
