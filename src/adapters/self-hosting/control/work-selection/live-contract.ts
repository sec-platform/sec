import { canonicalEquals, canonicalJson, compareCodeUnits, deepFreeze, rawSha256, sha256 } from '../../../../contracts/canonical.ts';
import { createMainHealthRepairWorkPackagePath } from '../main-health/contract.ts';
import {
  compileOperationDemandGraph,
  type OperationDemandGraph
} from '../operation/demand.ts';
import {
  SEC_WORK_PRIORITY_CLASSES,
  SEC_WORK_SELECTION_POLICY_REVISION,
  assertSecWorkDecision,
  compileSecWorkDecision,
  computeSecWorkCandidateSetRevision,
  evaluateSecWorkCandidate,
  parseSecWorkSelectionInput,
  type SecCurrentWorkLifecycle,
  type SecWorkCandidate,
  type SecWorkCandidateDecisionStatus,
  type SecWorkDecision,
  type SecWorkDependencyFact,
  type SecWorkDigest,
  type SecWorkPriorityClass,
  type SecWorkSelectionInput
} from './contract.ts';

const SEC_ROADMAP_WORK_CATALOG_SCHEMA =
  'sec-roadmap-work-catalog-v1' as const;
const SEC_WORK_DECISION_RECEIPT_SCHEMA =
  'sec-work-decision-receipt-v1' as const;
const SEC_WORK_ROLLING_PROJECTION_SCHEMA =
  'sec-work-rolling-projection-v1' as const;
const SEC_WORK_ROLLING_TRANSITION_PROJECTION_SCHEMA =
  'sec-work-rolling-transition-projection-v1' as const;
const SEC_WORK_ROLLING_PROPOSAL_PROJECTION_SCHEMA =
  'sec-work-rolling-proposal-projection-v1' as const;
const SEC_WORK_SELECTION_LIVE_RESULT_SCHEMA =
  'sec-work-selection-live-result-v1' as const;
const SEC_WORK_SELECTION_LIVE_ISSUER =
  'sec-work-selection-live-adapter-v1' as const;
export const SEC_ROADMAP_WORK_CATALOG_BEGIN =
  '<!-- sec-work-selection-roadmap-catalog-v1:begin -->' as const;
export const SEC_ROADMAP_WORK_CATALOG_END =
  '<!-- sec-work-selection-roadmap-catalog-v1:end -->' as const;

type SecRoadmapCatalogDisposition = 'active' | 'deferred' | 'superseded';

export interface SecRoadmapWorkCatalogItem {
  readonly packageId: string;
  readonly workId: string;
  readonly tracking: string;
  readonly currentSpecRef: string;
  readonly ownerRef: string;
  readonly kind: SecWorkCandidate['kind'];
  readonly disposition: SecRoadmapCatalogDisposition;
  readonly priorityClass: SecWorkPriorityClass;
  readonly priorityEvidenceRefs: readonly string[];
  readonly prerequisiteWorkIds: readonly string[];
  readonly orderedAfterWorkIds: readonly string[];
  readonly reproductionOrEvidenceFreshness:
    SecWorkCandidate['reproductionOrEvidenceFreshness'];
  readonly rootCauseState: SecWorkCandidate['rootCauseState'];
  readonly rootCauseRef: string;
  readonly scopeClosure: SecWorkCandidate['scopeClosure'];
  readonly exitCriteriaRef: string;
  readonly nearTermConsumerRef: string | null;
  readonly humanDecisionRef: string | null;
}

export interface SecRoadmapWorkCatalog {
  readonly schema: typeof SEC_ROADMAP_WORK_CATALOG_SCHEMA;
  readonly stageRef: string;
  readonly items: readonly SecRoadmapWorkCatalogItem[];
  readonly catalogDigest: SecWorkDigest;
}

export interface SecRoadmapTerminalCompaction {
  readonly schema: 'sec-roadmap-terminal-compaction-v2';
  readonly retiredWorkIds: readonly string[];
  /**
   * A terminal catalog transition cannot delete the manifest still named by
   * the active pointer.  The successor freeze retires these paths atomically
   * with publication of the new manifest, pointer and rolling projection.
   */
  readonly delayedManifestRetirementPaths: readonly string[];
  readonly catalog: SecRoadmapWorkCatalog;
  readonly roadmapSource: string;
  readonly demandGraphDigest: `sha256:${string}`;
  readonly compactionDigest: SecWorkDigest;
}

export interface SecRoadmapTerminalCompactionCandidate {
  readonly schema: 'sec-roadmap-terminal-compaction-candidate-v2';
  readonly repository: string;
  readonly prNumber: number;
  readonly baseSha: string;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly compactionDigest: SecWorkDigest;
  readonly retiredWorkIds: readonly string[];
  readonly bindingDigest: SecWorkDigest;
}

export interface SecWorkSelectionTerminalProjection {
  readonly demandGraph: OperationDemandGraph;
  readonly catalog: SecRoadmapWorkCatalog;
  readonly currentSpecs: readonly SecWorkCurrentSpecObservation[];
  readonly roadmapRevision: SecWorkDigest;
  readonly terminalCompaction: SecRoadmapTerminalCompaction | null;
}

export interface SecWorkCurrentSpecObservation {
  readonly workId: string;
  readonly currentSpecRef: string;
  readonly providerResourceRef: string;
  readonly providerState: 'open' | 'closed';
  readonly currentSpecRevision: SecWorkDigest;
  readonly observationDigest: SecWorkDigest;
}

interface SecWorkRegistryEntryObservation {
  readonly manifestPath: string;
  readonly manifestDigest: SecWorkDigest;
  readonly source: 'default' | 'open-pr';
  readonly prNumber: number | null;
  readonly baseSha: string | null;
  readonly headSha: string | null;
  readonly headTreeSha: string | null;
}

export interface SecWorkRegistryObservation {
  readonly defaultTreeSha: string;
  readonly entries: readonly SecWorkRegistryEntryObservation[];
  readonly registryDigest: SecWorkDigest;
}

export interface SecWorkDecisionReceipt {
  readonly schema: typeof SEC_WORK_DECISION_RECEIPT_SCHEMA;
  readonly issuer: typeof SEC_WORK_SELECTION_LIVE_ISSUER;
  readonly repository: string;
  readonly exactMain: string;
  readonly exactMainTree: string;
  readonly roadmapPath: 'config/repository/work-selection.md';
  readonly roadmapRevision: SecWorkDigest;
  readonly catalog: SecRoadmapWorkCatalog;
  readonly registry: SecWorkRegistryObservation;
  readonly lifecycleDigest: SecWorkDigest;
  readonly currentSpecs: readonly SecWorkCurrentSpecObservation[];
  readonly input: SecWorkSelectionInput;
  readonly decision: SecWorkDecision;
  readonly receiptDigest: SecWorkDigest;
}

interface SecWorkRollingProjectionItem {
  readonly packageId: string;
  readonly workId: string;
  readonly tracking: string;
  readonly currentSpecRef: string;
  readonly currentSpecRevision: SecWorkDigest;
  readonly decisionStatus: SecWorkCandidateDecisionStatus | 'selected';
}

export interface SecWorkRollingProjection {
  readonly schema: typeof SEC_WORK_ROLLING_PROJECTION_SCHEMA;
  readonly exactMain: string;
  readonly roadmapRevision: SecWorkDigest;
  readonly catalogDigest: SecWorkDigest;
  readonly receiptDigest: SecWorkDigest;
  readonly decisionDigest: SecWorkDigest;
  readonly active: SecWorkRollingProjectionItem;
  readonly candidates: readonly SecWorkRollingProjectionItem[];
  readonly projectionDigest: SecWorkDigest;
}

export type SecWorkRollingTransitionAuthority = Readonly<
  | {
    kind: 'committed-candidate-replan';
    sourceHead: string;
    sourceTree: string;
    sourceManifestDigest: SecWorkDigest;
    sourcePointerRevision: SecWorkDigest;
    sourceRollingRevision: SecWorkDigest;
  }
  | {
    kind: 'main-health-repair';
    decisionDigest: SecWorkDigest;
    healthRevision: SecWorkDigest;
    ledgerDigest: SecWorkDigest;
    failureFingerprints: readonly SecWorkDigest[];
    publishedActivePackageId: string | null;
  }
  | {
    /**
     * Historical projection for the final explicitly authorized bootstrap
     * bridge. No document-control effect API produces this variant; it only
     * lets the digest-bound rolling record preserve the exact external
     * observation without pretending that a missing provider issued a ledger
     * or repair decision.
     */
    kind: 'manual-main-health-bootstrap';
    repository: string;
    defaultBranch: string;
    owner: string;
    healthRevision: SecWorkDigest;
    bootstrapObservationDigest: SecWorkDigest;
    failureFingerprints: readonly SecWorkDigest[];
    publishedActivePackageId: string;
    retirementPolicy: 'exact-new-main-readback';
  }
>;

export interface SecWorkRollingTransitionActive {
  readonly packageId: string;
  readonly tracking: string;
  readonly manifestPath: string;
  readonly manifestDigest: SecWorkDigest;
}

/**
 * Digest-bound topology for a transition that is not an ordinary WorkDecision.
 *
 * The authority union is deliberately explicit: a candidate replan may only
 * preserve an already-active package generation, while a MainHealth repair is
 * bound to its repair decision. The digest proves byte/model integrity; the
 * effectful document-control owner still proves the referenced Git or health
 * authority before publishing these bytes.
 */
export interface SecWorkRollingTransitionProjection {
  readonly schema: typeof SEC_WORK_ROLLING_TRANSITION_PROJECTION_SCHEMA;
  readonly exactMain: string;
  readonly exactMainTree: string;
  readonly authority: SecWorkRollingTransitionAuthority;
  readonly active: SecWorkRollingTransitionActive;
  readonly candidates: readonly string[];
  readonly projectionDigest: SecWorkDigest;
}

/** Authority-free authoring projection. Its digest protects representation
 * integrity only; no field selects work or grants an Effect. */
export interface SecWorkRollingProposalProjection {
  readonly schema: typeof SEC_WORK_ROLLING_PROPOSAL_PROJECTION_SCHEMA;
  readonly exactMain: string;
  readonly exactMainTree: string;
  readonly authority: 'none';
  readonly active: SecWorkRollingTransitionActive & Readonly<{ tracking: 'none' }>;
  readonly candidates: readonly string[];
  readonly projectionDigest: SecWorkDigest;
}

export type SecWorkRollingMachineProjection =
  | SecWorkRollingProjection
  | SecWorkRollingTransitionProjection
  | SecWorkRollingProposalProjection;

export interface SecWorkRollingTopology {
  readonly activePackageId: string;
  readonly candidatePackageIds: readonly string[];
}

export interface SecWorkRollingExactManifestBinding {
  readonly kind: 'transition' | 'proposal';
  readonly exactMain: string;
  readonly exactMainTree: string;
  readonly active: SecWorkRollingTransitionActive;
}

/** Common exact binding carried by every non-ordinary rolling projection. */
export function projectSecWorkRollingExactManifestBinding(
  projection: SecWorkRollingMachineProjection
): SecWorkRollingExactManifestBinding | null {
  if (projection.schema === SEC_WORK_ROLLING_PROJECTION_SCHEMA) return null;
  return deepFreeze({
    kind: projection.schema === SEC_WORK_ROLLING_PROPOSAL_PROJECTION_SCHEMA
      ? 'proposal' as const
      : 'transition' as const,
    exactMain: projection.exactMain,
    exactMainTree: projection.exactMainTree,
    active: projection.active
  });
}

export type SecWorkSelectionLiveResult = Readonly<
  | {
    schema: typeof SEC_WORK_SELECTION_LIVE_RESULT_SCHEMA;
    status: 'resolved';
    reasonCodes: readonly [];
    blockerRefs: readonly [];
    receipt: SecWorkDecisionReceipt;
    demandGraph: OperationDemandGraph;
    terminalCompaction: SecRoadmapTerminalCompaction | null;
    resultDigest: SecWorkDigest;
  }
  | {
    schema: typeof SEC_WORK_SELECTION_LIVE_RESULT_SCHEMA;
    status: 'unresolved';
    reasonCodes: readonly string[];
    blockerRefs: readonly string[];
    receipt: null;
    demandGraph: null;
    terminalCompaction: null;
    resultDigest: SecWorkDigest;
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
const ROLLING_PROJECTION_KEYS = [
  'schema', 'exactMain', 'roadmapRevision', 'catalogDigest', 'receiptDigest',
  'decisionDigest', 'active', 'candidates', 'projectionDigest'
] as const;
const ROLLING_PROJECTION_ITEM_KEYS = [
  'packageId', 'workId', 'tracking', 'currentSpecRef', 'currentSpecRevision',
  'decisionStatus'
] as const;
const ROLLING_TRANSITION_PROJECTION_KEYS = [
  'schema', 'exactMain', 'exactMainTree', 'authority', 'active', 'candidates',
  'projectionDigest'
] as const;
const ROLLING_PROPOSAL_PROJECTION_KEYS = [
  'schema', 'exactMain', 'exactMainTree', 'authority', 'active', 'candidates',
  'projectionDigest'
] as const;
const ROLLING_TRANSITION_ACTIVE_KEYS = [
  'packageId', 'tracking', 'manifestPath', 'manifestDigest'
] as const;
const CANDIDATE_REPLAN_AUTHORITY_KEYS = [
  'kind', 'sourceHead', 'sourceTree', 'sourceManifestDigest',
  'sourcePointerRevision', 'sourceRollingRevision'
] as const;
const MAIN_HEALTH_REPAIR_AUTHORITY_KEYS = [
  'kind', 'decisionDigest', 'healthRevision', 'ledgerDigest',
  'failureFingerprints', 'publishedActivePackageId'
] as const;
const MANUAL_MAIN_HEALTH_BOOTSTRAP_AUTHORITY_KEYS = [
  'kind', 'repository', 'defaultBranch', 'owner', 'healthRevision',
  'bootstrapObservationDigest', 'failureFingerprints',
  'publishedActivePackageId', 'retirementPolicy'
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

function digest(value: unknown, label: string): SecWorkDigest {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    fail(`${label} must be one SHA-256 digest.`);
  }
  return value as SecWorkDigest;
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

function parseCatalogItem(value: unknown, index: number): SecRoadmapWorkCatalogItem {
  const label = `catalog.items[${index}]`;
  const item = record(value, label);
  exactKeys(item, CATALOG_ITEM_KEYS, label);
  const parsed: SecRoadmapWorkCatalogItem = {
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
  if (parsed.workId !== parsed.tracking) {
    fail(`${label}.workId must equal its canonical tracking identity.`);
  }
  if (parsed.ownerRef !== parsed.currentSpecRef) {
    fail(`${label}.ownerRef must equal its canonical currentSpecRef.`);
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

function normalizeCatalog(value: unknown): SecRoadmapWorkCatalog {
  const catalog = record(value, 'catalog');
  exactKeys(catalog, CATALOG_KEYS, 'catalog');
  if (catalog.schema !== SEC_ROADMAP_WORK_CATALOG_SCHEMA) {
    fail(`catalog.schema must be ${SEC_ROADMAP_WORK_CATALOG_SCHEMA}.`);
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
    schema: SEC_ROADMAP_WORK_CATALOG_SCHEMA,
    stageRef: token(catalog.stageRef, 'catalog.stageRef'),
    items
  });
  return deepFreeze({
    ...withoutDigest,
    catalogDigest: sha256(withoutDigest) as SecWorkDigest
  });
}

function parseDuplicateAwareJson(source: string, label = 'roadmap catalog'): unknown {
  if (source.length === 0 || source.length > 256 * 1024) {
    fail(`${label} JSON must be non-empty and bounded to 256 KiB.`);
  }
  let cursor = 0;
  let depth = 0;
  const whitespace = () => {
    while (cursor < source.length && /[\u0009\u000a\u000d\u0020]/u.test(source[cursor]!)) cursor += 1;
  };
  const syntax = (message: string): never => fail(`${label} JSON is invalid at offset ${cursor}: ${message}.`);
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
        if (keys.has(key)) fail(`${label} JSON object contains duplicate key ${JSON.stringify(key)}.`);
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

export function parseSecRoadmapWorkCatalog(source: string): SecRoadmapWorkCatalog {
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

function workManifestPath(item: SecRoadmapWorkCatalogItem): string {
  return `config/repository/work-packages/${item.packageId}.md`;
}

function renderRoadmapCatalogJson(value: unknown, depth = 0): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('roadmap catalog renderer rejects non-finite numbers.');
    return JSON.stringify(value);
  }
  const indentation = ' '.repeat(depth);
  const nestedIndentation = ' '.repeat(depth + 2);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every((entry) => entry === null || typeof entry !== 'object')) {
      return `[${value.map((entry) => renderRoadmapCatalogJson(entry)).join(', ')}]`;
    }
    return `[\n${value.map((entry) => (
      `${nestedIndentation}${renderRoadmapCatalogJson(entry, depth + 2)}`
    )).join(',\n')}\n${indentation}]`;
  }
  if (typeof value !== 'object') fail('roadmap catalog renderer accepts only JSON values.');
  const entries = Object.entries(value as Readonly<Record<string, unknown>>);
  if (entries.length === 0) return '{}';
  return `{\n${entries.map(([key, entry]) => (
    `${nestedIndentation}${JSON.stringify(key)}: ${renderRoadmapCatalogJson(entry, depth + 2)}`
  )).join(',\n')}\n${indentation}}`;
}

function renderRoadmapCatalogSource(
  source: string,
  catalog: SecRoadmapWorkCatalog
): string {
  const begin = source.indexOf(SEC_ROADMAP_WORK_CATALOG_BEGIN);
  const end = source.indexOf(SEC_ROADMAP_WORK_CATALOG_END);
  if (begin < 0 || end <= begin) fail('canonical roadmap catalog markers disappeared during rendering.');
  const payload = {
    schema: catalog.schema,
    stageRef: catalog.stageRef,
    items: catalog.items
  };
  const block = `${SEC_ROADMAP_WORK_CATALOG_BEGIN}\n\u0060\u0060\u0060json\n${renderRoadmapCatalogJson(payload)}\n\u0060\u0060\u0060\n`;
  return `${source.slice(0, begin)}${block}${source.slice(end)}`;
}

/**
 * Compiles terminal catalog retirement as one deterministic graph transition.
 * The effect owner must bind each requested work id to trusted completion
 * evidence before publishing the returned roadmap bytes.  The still-bound
 * manifest is deliberately retained until the successor freeze can replace
 * the complete active-control tuple atomically.
 */
export function compileSecRoadmapTerminalCompaction(input: {
  roadmapSource: string;
  completedWorkIds: readonly string[];
}): SecRoadmapTerminalCompaction {
  const prior = parseSecRoadmapWorkCatalog(input.roadmapSource);
  const retiredWorkIds = [...input.completedWorkIds].sort(compareCodeUnits);
  if (retiredWorkIds.length === 0 || new Set(retiredWorkIds).size !== retiredWorkIds.length) {
    fail('terminal compaction requires one or more unique completed work ids.');
  }
  const retired = new Set(retiredWorkIds);
  const demandGraph = compileOperationDemandGraph({
    operation: 'work-selection-observe',
    terminalWorkIds: retiredWorkIds
  });
  if (!demandGraph.transitionDemands.includes('roadmap-terminal-compaction')) {
    fail('terminal compaction is absent from the canonical operation demand graph.');
  }
  const priorByWorkId = new Map(prior.items.map((item) => [item.workId, item]));
  for (const workId of retiredWorkIds) {
    if (!priorByWorkId.has(workId)) fail(`terminal compaction work ${workId} is absent from the catalog.`);
  }
  const catalog = normalizeCatalog({
    schema: prior.schema,
    stageRef: prior.stageRef,
    items: prior.items
      .filter((item) => !retired.has(item.workId))
      .map((item) => ({
        ...item,
        prerequisiteWorkIds: item.prerequisiteWorkIds.filter((workId) => !retired.has(workId)),
        orderedAfterWorkIds: item.orderedAfterWorkIds.filter((workId) => !retired.has(workId))
      }))
  });
  const roadmapSource = renderRoadmapCatalogSource(input.roadmapSource, catalog);
  const withoutDigest = deepFreeze({
    schema: 'sec-roadmap-terminal-compaction-v2' as const,
    retiredWorkIds,
    delayedManifestRetirementPaths: retiredWorkIds.map(
      (workId) => workManifestPath(priorByWorkId.get(workId)!)
    ),
    catalog,
    roadmapSource,
    demandGraphDigest: demandGraph.graphDigest
  });
  return deepFreeze({
    ...withoutDigest,
    compactionDigest: sha256(withoutDigest) as SecWorkDigest
  });
}

export function compileSecWorkSelectionTerminalProjection(input: {
  roadmapSource: string;
  currentSpecs: readonly SecWorkCurrentSpecObservation[];
}): SecWorkSelectionTerminalProjection {
  const catalog = parseSecRoadmapWorkCatalog(input.roadmapSource);
  const currentSpecs = input.currentSpecs.map((entry, index) => (
    normalizeCurrentSpecObservation(entry, `terminalProjection.currentSpecs[${index}]`)
  ));
  const byWorkId = new Map(currentSpecs.map((entry) => [entry.workId, entry]));
  if (byWorkId.size !== currentSpecs.length || currentSpecs.length !== catalog.items.length
      || catalog.items.some((item) => byWorkId.get(item.workId)?.currentSpecRef !== item.currentSpecRef)) {
    fail('terminal projection current specs must cover the raw catalog exactly once.');
  }
  const terminalSpecs = currentSpecs
    .filter(({ providerState }) => providerState === 'closed')
    .sort((left, right) => compareCodeUnits(left.workId, right.workId));
  const demandGraph = compileOperationDemandGraph({
    operation: 'work-selection-observe',
    terminalWorkIds: terminalSpecs.map(({ workId }) => workId)
  });
  if (terminalSpecs.length === 0) {
    return deepFreeze({
      demandGraph,
      catalog,
      currentSpecs,
      roadmapRevision: rawSha256(input.roadmapSource),
      terminalCompaction: null
    });
  }
  const terminalCompaction = compileSecRoadmapTerminalCompaction({
    roadmapSource: input.roadmapSource,
    completedWorkIds: terminalSpecs.map(({ workId }) => workId)
  });
  if (terminalCompaction.demandGraphDigest !== demandGraph.graphDigest) {
    fail('terminal compaction is not bound to the canonical operation demand graph.');
  }
  return deepFreeze({
    demandGraph,
    catalog: terminalCompaction.catalog,
    currentSpecs: currentSpecs.filter(({ providerState }) => providerState === 'open'),
    roadmapRevision: sha256({
      roadmapSourceRevision: rawSha256(input.roadmapSource),
      terminalCompactionDigest: terminalCompaction.compactionDigest,
      terminalSpecObservations: terminalSpecs
    }) as SecWorkDigest,
    terminalCompaction
  });
}

export function assertSecRoadmapTerminalCompactionCandidate(input: {
  compaction: SecRoadmapTerminalCompaction;
  roadmapSource: string;
  presentDelayedManifestPaths: readonly string[];
}): void {
  if (input.roadmapSource !== input.compaction.roadmapSource) {
    fail('candidate roadmap bytes differ from the canonical terminal compaction output.');
  }
  const present = [...new Set(input.presentDelayedManifestPaths)].sort(compareCodeUnits);
  if (!canonicalEquals(present, input.compaction.delayedManifestRetirementPaths)) {
    fail('candidate tree must retain every pointer-bound manifest until successor freeze.');
  }
}

/**
 * Candidate-tree guard for the terminal transition. Catalog and dependency
 * retirement cross this Git boundary while the manifest set remains byte-for-
 * byte addressable.  Manifest retirement belongs to the successor freeze that
 * replaces manifest, pointer and rolling projection together.
 */
export function assertSecRoadmapTerminalCompactionDelta(input: {
  priorRoadmapSource: string;
  roadmapSource: string;
  priorManifestPaths: readonly string[];
  manifestPaths: readonly string[];
}): void {
  const prior = parseSecRoadmapWorkCatalog(input.priorRoadmapSource);
  const current = parseSecRoadmapWorkCatalog(input.roadmapSource);
  const priorManifests = new Set(input.priorManifestPaths);
  const currentManifests = new Set(input.manifestPaths);
  // Terminality belongs to the canonical provider subject, not to a mutable
  // slice/package label. A catalog record that still binds the same Issue is
  // a live identity migration, not a completed work item. The current catalog
  // parser remains responsible for the shape of the replacement record.
  const currentByTracking = new Map(current.items.map((item) => [item.tracking, item]));
  const retiredWorkIds = prior.items
    .filter((item) => !currentByTracking.has(item.tracking))
    .map((item) => item.workId);
  if (retiredWorkIds.length === 0) return;
  const compiled = compileSecRoadmapTerminalCompaction({
    roadmapSource: input.priorRoadmapSource,
    completedWorkIds: retiredWorkIds
  });
  if (input.roadmapSource !== compiled.roadmapSource) {
    fail('terminal compaction roadmap bytes differ from the canonical compiler output.');
  }
  const missing = [...priorManifests].filter((manifestPath) => !currentManifests.has(manifestPath));
  const added = [...currentManifests].filter((manifestPath) => !priorManifests.has(manifestPath));
  if (missing.length > 0 || added.length > 0) {
    fail('terminal compaction cannot mutate the manifest set before successor freeze.');
  }
}

/**
 * Binds one open PR to terminal-compaction semantics from exact tree facts.
 * PR prose and branch names are deliberately absent: they are transports, not
 * operation identity or completion authority.
 */
export function createSecRoadmapTerminalCompactionCandidate(input: {
  repository: string;
  exactMain: string;
  compaction: SecRoadmapTerminalCompaction;
  priorRoadmapSource: string;
  roadmapSource: string;
  priorManifestPaths: readonly string[];
  manifestPaths: readonly string[];
  prNumber: number;
  baseSha: string;
  headSha: string;
  headTreeSha: string;
}): SecRoadmapTerminalCompactionCandidate {
  const repository = text(input.repository, 'terminalCandidate.repository');
  const exactMain = gitSha(input.exactMain, 'terminalCandidate.exactMain');
  const baseSha = gitSha(input.baseSha, 'terminalCandidate.baseSha');
  if (baseSha !== exactMain) fail('terminal candidate base must equal exact main.');
  const prNumber = nonNegativeInteger(input.prNumber, 'terminalCandidate.prNumber');
  if (prNumber === 0) fail('terminal candidate PR number must be positive.');
  assertSecRoadmapTerminalCompactionCandidate({
    compaction: input.compaction,
    roadmapSource: input.roadmapSource,
    presentDelayedManifestPaths: input.compaction.delayedManifestRetirementPaths.filter(
      (manifestPath) => input.manifestPaths.includes(manifestPath)
    )
  });
  assertSecRoadmapTerminalCompactionDelta({
    priorRoadmapSource: input.priorRoadmapSource,
    roadmapSource: input.roadmapSource,
    priorManifestPaths: input.priorManifestPaths,
    manifestPaths: input.manifestPaths
  });
  const withoutDigest = deepFreeze({
    schema: 'sec-roadmap-terminal-compaction-candidate-v2' as const,
    repository,
    prNumber,
    baseSha,
    headSha: gitSha(input.headSha, 'terminalCandidate.headSha'),
    headTreeSha: gitSha(input.headTreeSha, 'terminalCandidate.headTreeSha'),
    compactionDigest: input.compaction.compactionDigest,
    retiredWorkIds: input.compaction.retiredWorkIds
  });
  return deepFreeze({
    ...withoutDigest,
    bindingDigest: sha256(withoutDigest) as SecWorkDigest
  });
}

function normalizeRollingProjectionItem(
  value: unknown,
  label: string,
  active: boolean
): SecWorkRollingProjectionItem {
  const item = record(value, label);
  exactKeys(item, ROLLING_PROJECTION_ITEM_KEYS, label);
  return deepFreeze({
    packageId: packageId(item.packageId, `${label}.packageId`),
    workId: token(item.workId, `${label}.workId`),
    tracking: token(item.tracking, `${label}.tracking`),
    currentSpecRef: text(item.currentSpecRef, `${label}.currentSpecRef`),
    currentSpecRevision: digest(item.currentSpecRevision, `${label}.currentSpecRevision`),
    decisionStatus: active
      ? enumeration(item.decisionStatus, ['selected'] as const, `${label}.decisionStatus`)
      : enumeration(
          item.decisionStatus,
          ['eligible', 'rejected', 'unresolved', 'human-required'] as const,
          `${label}.decisionStatus`
        )
  });
}

/**
 * Parses the generated machine projection embedded in the rolling-plan
 * document. The projection is self-authenticating with respect to its exact
 * normalized fields; selection authority still belongs to the bound receipt
 * and the live Work Selection adapter.
 */
function normalizeSecWorkRollingProjection(
  raw: Record<string, unknown>
): SecWorkRollingProjection {
  exactKeys(raw, ROLLING_PROJECTION_KEYS, 'rolling projection');
  if (raw.schema !== SEC_WORK_ROLLING_PROJECTION_SCHEMA) {
    fail(`rolling projection.schema must be ${SEC_WORK_ROLLING_PROJECTION_SCHEMA}.`);
  }
  if (!Array.isArray(raw.candidates) || raw.candidates.length < 2 || raw.candidates.length > 5) {
    fail('rolling projection.candidates must contain two to five items.');
  }
  const active = normalizeRollingProjectionItem(raw.active, 'rolling projection.active', true);
  const candidates = raw.candidates.map((item, index) => normalizeRollingProjectionItem(
    item,
    `rolling projection.candidates[${index}]`,
    false
  ));
  const allItems = [active, ...candidates];
  for (const [field, values] of [
    ['packageId', allItems.map((item) => item.packageId)],
    ['workId', allItems.map((item) => item.workId)],
    ['tracking', allItems.map((item) => item.tracking)],
    ['currentSpecRef', allItems.map((item) => item.currentSpecRef)]
  ] as const) {
    if (new Set(values).size !== values.length) {
      fail(`rolling projection contains duplicate ${field}.`);
    }
  }
  const withoutDigest = deepFreeze({
    schema: SEC_WORK_ROLLING_PROJECTION_SCHEMA,
    exactMain: gitSha(raw.exactMain, 'rolling projection.exactMain'),
    roadmapRevision: digest(raw.roadmapRevision, 'rolling projection.roadmapRevision'),
    catalogDigest: digest(raw.catalogDigest, 'rolling projection.catalogDigest'),
    receiptDigest: digest(raw.receiptDigest, 'rolling projection.receiptDigest'),
    decisionDigest: digest(raw.decisionDigest, 'rolling projection.decisionDigest'),
    active,
    candidates
  });
  const projectionDigest = digest(raw.projectionDigest, 'rolling projection.projectionDigest');
  if (projectionDigest !== sha256(withoutDigest)) {
    fail('rolling projection.projectionDigest does not bind the normalized projection.');
  }
  return deepFreeze({ ...withoutDigest, projectionDigest });
}

function orderedPackageIds(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 5) {
    fail(`${label} must contain two to five package ids.`);
  }
  const result = value.map((entry, index) => packageId(entry, `${label}[${index}]`));
  if (new Set(result).size !== result.length) fail(`${label} contains a duplicate package id.`);
  return deepFreeze(result);
}

function normalizeTransitionAuthority(
  value: unknown
): SecWorkRollingTransitionAuthority {
  const authority = record(value, 'rolling transition authority');
  if (authority.kind === 'committed-candidate-replan') {
    exactKeys(authority, CANDIDATE_REPLAN_AUTHORITY_KEYS, 'rolling transition authority');
    return deepFreeze({
      kind: 'committed-candidate-replan' as const,
      sourceHead: gitSha(authority.sourceHead, 'rolling transition authority.sourceHead'),
      sourceTree: gitSha(authority.sourceTree, 'rolling transition authority.sourceTree'),
      sourceManifestDigest: digest(
        authority.sourceManifestDigest,
        'rolling transition authority.sourceManifestDigest'
      ),
      sourcePointerRevision: digest(
        authority.sourcePointerRevision,
        'rolling transition authority.sourcePointerRevision'
      ),
      sourceRollingRevision: digest(
        authority.sourceRollingRevision,
        'rolling transition authority.sourceRollingRevision'
      )
    });
  }
  if (authority.kind === 'main-health-repair') {
    exactKeys(authority, MAIN_HEALTH_REPAIR_AUTHORITY_KEYS, 'rolling transition authority');
    if (!Array.isArray(authority.failureFingerprints)
        || authority.failureFingerprints.length === 0) {
      fail('rolling transition authority.failureFingerprints must be non-empty.');
    }
    const failureFingerprints = authority.failureFingerprints.map((entry, index) => digest(
      entry,
      `rolling transition authority.failureFingerprints[${index}]`
    )).sort(compareCodeUnits);
    if (new Set(failureFingerprints).size !== failureFingerprints.length) {
      fail('rolling transition authority.failureFingerprints contains a duplicate.');
    }
    return deepFreeze({
      kind: 'main-health-repair' as const,
      decisionDigest: digest(authority.decisionDigest, 'rolling transition authority.decisionDigest'),
      healthRevision: digest(authority.healthRevision, 'rolling transition authority.healthRevision'),
      ledgerDigest: digest(authority.ledgerDigest, 'rolling transition authority.ledgerDigest'),
      failureFingerprints,
      publishedActivePackageId: authority.publishedActivePackageId === null
        ? null
        : packageId(
            authority.publishedActivePackageId,
            'rolling transition authority.publishedActivePackageId'
          )
    });
  }
  if (authority.kind === 'manual-main-health-bootstrap') {
    exactKeys(authority, MANUAL_MAIN_HEALTH_BOOTSTRAP_AUTHORITY_KEYS, 'rolling transition authority');
    if (!Array.isArray(authority.failureFingerprints) || authority.failureFingerprints.length === 0) {
      fail('rolling transition authority.failureFingerprints must be non-empty.');
    }
    const failureFingerprints = authority.failureFingerprints.map((entry, index) => digest(
      entry, `rolling transition authority.failureFingerprints[${index}]`
    )).sort(compareCodeUnits);
    if (new Set(failureFingerprints).size !== failureFingerprints.length
        || authority.retirementPolicy !== 'exact-new-main-readback') {
      fail('manual MainHealth bootstrap authority identity is invalid.');
    }
    return deepFreeze({
      kind: 'manual-main-health-bootstrap' as const,
      repository: text(authority.repository, 'rolling transition authority.repository'),
      defaultBranch: token(authority.defaultBranch, 'rolling transition authority.defaultBranch'),
      owner: text(authority.owner, 'rolling transition authority.owner'),
      healthRevision: digest(authority.healthRevision, 'rolling transition authority.healthRevision'),
      bootstrapObservationDigest: digest(
        authority.bootstrapObservationDigest,
        'rolling transition authority.bootstrapObservationDigest'
      ),
      failureFingerprints,
      publishedActivePackageId: packageId(
        authority.publishedActivePackageId,
        'rolling transition authority.publishedActivePackageId'
      ),
      retirementPolicy: 'exact-new-main-readback' as const
    });
  }
  return fail('rolling transition authority.kind is unsupported.');
}

function normalizeTransitionActive(value: unknown): SecWorkRollingTransitionActive {
  const active = record(value, 'rolling transition active');
  exactKeys(active, ROLLING_TRANSITION_ACTIVE_KEYS, 'rolling transition active');
  const parsedPackageId = packageId(active.packageId, 'rolling transition active.packageId');
  const manifestPath = text(active.manifestPath, 'rolling transition active.manifestPath');
  if (manifestPath !== `config/repository/work-packages/${parsedPackageId}.md`) {
    fail('rolling transition active.manifestPath must equal the active package identity.');
  }
  return deepFreeze({
    packageId: parsedPackageId,
    tracking: token(active.tracking, 'rolling transition active.tracking'),
    manifestPath,
    manifestDigest: digest(active.manifestDigest, 'rolling transition active.manifestDigest')
  });
}

function normalizeSecWorkRollingTransitionProjection(
  raw: Record<string, unknown>
): SecWorkRollingTransitionProjection {
  exactKeys(raw, ROLLING_TRANSITION_PROJECTION_KEYS, 'rolling transition projection');
  if (raw.schema !== SEC_WORK_ROLLING_TRANSITION_PROJECTION_SCHEMA) {
    fail(
      `rolling transition projection.schema must be ${SEC_WORK_ROLLING_TRANSITION_PROJECTION_SCHEMA}.`
    );
  }
  const authority = normalizeTransitionAuthority(raw.authority);
  const active = normalizeTransitionActive(raw.active);
  const candidates = orderedPackageIds(raw.candidates, 'rolling transition projection.candidates');
  const exactMain = gitSha(raw.exactMain, 'rolling transition projection.exactMain');
  const exactMainTree = gitSha(raw.exactMainTree, 'rolling transition projection.exactMainTree');
  if (candidates.includes(active.packageId)) {
    fail('rolling transition active package cannot also be a candidate.');
  }
  if ((authority.kind === 'main-health-repair'
      || authority.kind === 'manual-main-health-bootstrap') && active.tracking !== 'none') {
    fail('MainHealth repair or bootstrap rolling transition must use tracking none.');
  }
  if (authority.kind === 'manual-main-health-bootstrap'
      && active.manifestPath !== createMainHealthRepairWorkPackagePath({
        repository: authority.repository,
        defaultBranch: authority.defaultBranch,
        mainSha: exactMain,
        mainTreeSha: exactMainTree,
        owner: authority.owner,
        failureFingerprints: authority.failureFingerprints
      })) {
    fail('manual MainHealth bootstrap manifest is not the canonical content-addressed repair path.');
  }
  const withoutDigest = deepFreeze({
    schema: SEC_WORK_ROLLING_TRANSITION_PROJECTION_SCHEMA,
    exactMain,
    exactMainTree,
    authority,
    active,
    candidates
  });
  const projectionDigest = digest(
    raw.projectionDigest,
    'rolling transition projection.projectionDigest'
  );
  if (projectionDigest !== sha256(withoutDigest)) {
    fail('rolling transition projection.projectionDigest does not bind the normalized projection.');
  }
  return deepFreeze({ ...withoutDigest, projectionDigest });
}

export function compileSecWorkRollingTransitionProjection(input: Readonly<{
  exactMain: string;
  exactMainTree: string;
  authority: SecWorkRollingTransitionAuthority;
  active: SecWorkRollingTransitionActive;
  candidates: readonly string[];
}>): SecWorkRollingTransitionProjection {
  const semantic = {
    schema: SEC_WORK_ROLLING_TRANSITION_PROJECTION_SCHEMA,
    exactMain: input.exactMain,
    exactMainTree: input.exactMainTree,
    authority: input.authority,
    active: input.active,
    candidates: input.candidates
  };
  return normalizeSecWorkRollingTransitionProjection({
    ...semantic,
    projectionDigest: sha256(semantic)
  });
}

function normalizeSecWorkRollingProposalProjection(
  raw: Record<string, unknown>
): SecWorkRollingProposalProjection {
  exactKeys(raw, ROLLING_PROPOSAL_PROJECTION_KEYS, 'rolling proposal projection');
  if (raw.schema !== SEC_WORK_ROLLING_PROPOSAL_PROJECTION_SCHEMA || raw.authority !== 'none') {
    fail('rolling proposal projection must use its proposal schema and authority none.');
  }
  const active = normalizeTransitionActive(raw.active);
  if (active.tracking !== 'none') {
    fail('rolling proposal active package must use tracking none.');
  }
  const candidates = orderedPackageIds(raw.candidates, 'rolling proposal projection.candidates');
  if (candidates.includes(active.packageId)) {
    fail('rolling proposal active package cannot also be a candidate.');
  }
  const withoutDigest = deepFreeze({
    schema: SEC_WORK_ROLLING_PROPOSAL_PROJECTION_SCHEMA,
    exactMain: gitSha(raw.exactMain, 'rolling proposal projection.exactMain'),
    exactMainTree: gitSha(raw.exactMainTree, 'rolling proposal projection.exactMainTree'),
    authority: 'none' as const,
    active: deepFreeze({ ...active, tracking: 'none' as const }),
    candidates
  });
  const projectionDigest = digest(raw.projectionDigest, 'rolling proposal projection.projectionDigest');
  if (projectionDigest !== sha256(withoutDigest)) {
    fail('rolling proposal projection.projectionDigest does not bind the normalized projection.');
  }
  return deepFreeze({ ...withoutDigest, projectionDigest });
}

export function compileSecWorkRollingProposalProjection(input: Readonly<{
  exactMain: string;
  exactMainTree: string;
  active: SecWorkRollingTransitionActive & Readonly<{ tracking: 'none' }>;
  candidates: readonly string[];
}>): SecWorkRollingProposalProjection {
  const semantic = {
    schema: SEC_WORK_ROLLING_PROPOSAL_PROJECTION_SCHEMA,
    exactMain: input.exactMain,
    exactMainTree: input.exactMainTree,
    authority: 'none' as const,
    active: input.active,
    candidates: input.candidates
  };
  return normalizeSecWorkRollingProposalProjection({
    ...semantic,
    projectionDigest: sha256(semantic)
  });
}

export function parseSecWorkRollingMachineProjection(
  source: string
): SecWorkRollingMachineProjection {
  const raw = record(parseDuplicateAwareJson(source, 'rolling projection'), 'rolling projection');
  if (raw.schema === SEC_WORK_ROLLING_PROJECTION_SCHEMA) {
    return normalizeSecWorkRollingProjection(raw);
  }
  if (raw.schema === SEC_WORK_ROLLING_TRANSITION_PROJECTION_SCHEMA) {
    return normalizeSecWorkRollingTransitionProjection(raw);
  }
  if (raw.schema === SEC_WORK_ROLLING_PROPOSAL_PROJECTION_SCHEMA) {
    return normalizeSecWorkRollingProposalProjection(raw);
  }
  return fail('rolling projection.schema is unsupported.');
}

export function parseSecWorkRollingProjectionV1(source: string): SecWorkRollingProjection {
  const projection = parseSecWorkRollingMachineProjection(source);
  if (projection.schema !== SEC_WORK_ROLLING_PROJECTION_SCHEMA) {
    return fail(`rolling projection.schema must be ${SEC_WORK_ROLLING_PROJECTION_SCHEMA}.`);
  }
  return projection;
}

export function rollingTopologyFromMachineProjection(
  projection: SecWorkRollingMachineProjection
): SecWorkRollingTopology {
  return projection.schema === SEC_WORK_ROLLING_PROJECTION_SCHEMA
    ? deepFreeze({
        activePackageId: projection.active.packageId,
        candidatePackageIds: projection.candidates.map(({ packageId: id }) => id)
      })
    : deepFreeze({
        activePackageId: projection.active.packageId,
        candidatePackageIds: [...projection.candidates]
      });
}

function normalizeCurrentSpecObservation(
  value: SecWorkCurrentSpecObservation,
  label: string
): SecWorkCurrentSpecObservation {
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

export function createSecWorkCurrentSpecObservation(input: Omit<
  SecWorkCurrentSpecObservation,
  'observationDigest'
>): SecWorkCurrentSpecObservation {
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
    observationDigest: sha256(withoutDigest) as SecWorkDigest
  });
}

function normalizeRegistry(input: SecWorkRegistryObservation): SecWorkRegistryObservation {
  const entries = [...input.entries].map((entry, index) => {
    const label = `registry.entries[${index}]`;
    const manifestPath = text(entry.manifestPath, `${label}.manifestPath`);
    if (!/^config\/repository\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(manifestPath)) {
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

export function createSecWorkRegistryObservation(input: Omit<
  SecWorkRegistryObservation,
  'registryDigest'
>): SecWorkRegistryObservation {
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
    }) as SecWorkDigest
  });
}

function dependencyFacts(
  workIds: readonly string[],
  itemsByWorkId: ReadonlyMap<string, SecRoadmapWorkCatalogItem>,
  completedManifests: ReadonlySet<string>
): SecWorkDependencyFact[] {
  return workIds.map((workId) => {
    const dependency = itemsByWorkId.get(workId);
    if (dependency === undefined) fail(`dependency ${workId} disappeared after catalog validation.`);
    const manifestPath = `config/repository/work-packages/${dependency.packageId}.md`;
    return {
      ref: `work-package:${dependency.packageId}`,
      status: completedManifests.has(manifestPath) ? 'satisfied' : 'unsatisfied'
    };
  });
}

function blockedReadySuccessorCount(
  candidate: SecWorkCandidate,
  candidates: readonly SecWorkCandidate[],
  itemsByWorkId: ReadonlyMap<string, SecRoadmapWorkCatalogItem>
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
    return evaluateSecWorkCandidate(hypothetical).decision.status === 'eligible';
  }).length;
}

function candidateFromLiveFacts(input: {
  item: SecRoadmapWorkCatalogItem;
  catalog: SecRoadmapWorkCatalog;
  currentSpec: SecWorkCurrentSpecObservation;
  registry: SecWorkRegistryObservation;
  current: SecCurrentWorkLifecycle;
  lifecycleDigest: SecWorkDigest;
  itemsByWorkId: ReadonlyMap<string, SecRoadmapWorkCatalogItem>;
  completedManifests: ReadonlySet<string>;
}): SecWorkCandidate {
  const completionManifest = `config/repository/work-packages/${input.item.packageId}.md`;
  const alreadyInMain = input.completedManifests.has(completionManifest);
  if (!alreadyInMain && input.item.disposition === 'active'
      && input.currentSpec.providerState !== 'open') {
    fail(`${input.item.workId} current spec is closed without default-branch completion evidence.`);
  }
  const lifecycle: SecWorkCandidate['lifecycle'] = alreadyInMain
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
  roadmapRevision: SecWorkDigest;
  catalog: SecRoadmapWorkCatalog;
  registry: SecWorkRegistryObservation;
  current: SecCurrentWorkLifecycle;
  currentSpecs: readonly SecWorkCurrentSpecObservation[];
}): Omit<SecWorkDecisionReceipt, 'receiptDigest'> {
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
  const lifecycleDigest = sha256(input.current) as SecWorkDigest;
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
  const selectionInput = parseSecWorkSelectionInput({
    schema: 'sec-work-selection-input-v1',
    identity: {
      exactMain,
      roadmapRevision: digest(input.roadmapRevision, 'receipt.roadmapRevision'),
      candidateSetRevision: computeSecWorkCandidateSetRevision(candidates),
      selectionPolicyRevision: SEC_WORK_SELECTION_POLICY_REVISION
    },
    current: input.current,
    candidates
  });
  const decision = compileSecWorkDecision(selectionInput);
  return deepFreeze({
    schema: SEC_WORK_DECISION_RECEIPT_SCHEMA,
    issuer: SEC_WORK_SELECTION_LIVE_ISSUER,
    repository: text(input.repository, 'receipt.repository'),
    exactMain,
    exactMainTree,
    roadmapPath: 'config/repository/work-selection.md',
    roadmapRevision: selectionInput.identity.roadmapRevision,
    catalog,
    registry,
    lifecycleDigest,
    currentSpecs,
    input: selectionInput,
    decision
  });
}

export function createSecWorkDecisionReceipt(input: Parameters<
  typeof receiptWithoutDigest
>[0]): SecWorkDecisionReceipt {
  const withoutDigest = receiptWithoutDigest(input);
  return deepFreeze({
    ...withoutDigest,
    receiptDigest: sha256(withoutDigest) as SecWorkDigest
  });
}

export function assertSecWorkDecisionReceiptV1(
  receipt: SecWorkDecisionReceipt,
  input: Parameters<typeof receiptWithoutDigest>[0]
): SecWorkDecisionReceipt {
  const expected = createSecWorkDecisionReceipt(input);
  if (!canonicalEquals(receipt, expected)) {
    fail('receipt does not equal the canonical live decision for its bound sources.');
  }
  return expected;
}

function projectionItem(
  item: SecRoadmapWorkCatalogItem,
  receipt: SecWorkDecisionReceipt,
  decisionStatus: SecWorkRollingProjectionItem['decisionStatus']
): SecWorkRollingProjectionItem {
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

function assertRollingDecisionReceipt(receipt: SecWorkDecisionReceipt): void {
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
  if (receipt.schema !== SEC_WORK_DECISION_RECEIPT_SCHEMA
      || receipt.receiptDigest !== sha256(receiptMaterial)) {
    fail('rolling topology requires one internally valid decision receipt.');
  }
  assertSecWorkDecision(receipt.decision, receipt.input);
}

function rollingTopologyFromValidatedReceipt(
  receipt: SecWorkDecisionReceipt
): SecWorkRollingTopology {
  if ((receipt.decision.status !== 'select-next' && receipt.decision.status !== 'continue-active')
      || receipt.decision.selectedWorkId === null) {
    fail('rolling topology requires a select-next or continue-active decision.');
  }
  const active = receipt.catalog.items.find(({ workId }) => workId === receipt.decision.selectedWorkId);
  if (active === undefined) fail('rolling topology active work is absent from the bound roadmap catalog.');
  const candidatesByWorkId = new Map(receipt.input.candidates.map((candidate) => [candidate.workId, candidate]));
  const activeCandidate = candidatesByWorkId.get(active.workId);
  if (activeCandidate === undefined || activeCandidate.lifecycle === 'already-in-main'
      || activeCandidate.lifecycle === 'superseded') {
    fail('rolling topology active work is absent or terminal in the bound candidate set.');
  }
  const candidatePackageIds = receipt.catalog.items.filter((item) => {
    if (item.workId === active.workId) return false;
    const candidate = candidatesByWorkId.get(item.workId);
    return candidate !== undefined
      && candidate.lifecycle !== 'already-in-main'
      && candidate.lifecycle !== 'superseded'
      && candidate.lifecycle !== 'deferred';
  }).map(({ packageId }) => packageId);
  if (candidatePackageIds.length < 2 || candidatePackageIds.length > 5) {
    fail('rolling topology must retain two to five nondeferred, nonterminal candidates after selection.');
  }
  return deepFreeze({ activePackageId: active.packageId, candidatePackageIds });
}

export function compileSecWorkRollingTopology(
  receipt: SecWorkDecisionReceipt
): SecWorkRollingTopology {
  assertRollingDecisionReceipt(receipt);
  return rollingTopologyFromValidatedReceipt(receipt);
}

export function compileSecWorkRollingProjection(
  receipt: SecWorkDecisionReceipt
): SecWorkRollingProjection {
  assertRollingDecisionReceipt(receipt);
  if (receipt.decision.status !== 'select-next' || receipt.decision.selectedWorkId === null) {
    fail('rolling projection requires a select-next decision.');
  }
  const topology = rollingTopologyFromValidatedReceipt(receipt);
  const selected = receipt.catalog.items.find(({ packageId }) => packageId === topology.activePackageId);
  if (selected === undefined) fail('selected work is absent from the bound roadmap catalog.');
  const witnessByWorkId = new Map(receipt.decision.rejectionWitnesses.map((witness) => [witness.workId, witness]));
  const candidatesByPackageId = new Map(receipt.catalog.items.map((item) => [item.packageId, item]));
  const futureItems = topology.candidatePackageIds.map((packageId) => candidatesByPackageId.get(packageId)!);
  const withoutDigest = {
    schema: SEC_WORK_ROLLING_PROJECTION_SCHEMA,
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
    projectionDigest: sha256(withoutDigest) as SecWorkDigest
  });
}

function assertRollingReviewedOn(reviewedOn: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(reviewedOn)
      || new Date(`${reviewedOn}T00:00:00.000Z`).toISOString().slice(0, 10) !== reviewedOn) {
    fail('rolling projection reviewedOn must be one real ISO calendar date.');
  }
}

function renderRollingPlanDocument(input: Readonly<{
  reviewedOn: string;
  projection: SecWorkRollingMachineProjection;
  introduction: string;
  activeDescription: string;
  candidateDescriptions: readonly string[];
}>): string {
  assertRollingReviewedOn(input.reviewedOn);
  const topology = rollingTopologyFromMachineProjection(input.projection);
  if (input.candidateDescriptions.length !== topology.candidatePackageIds.length) {
    fail('rolling projection candidate descriptions must equal the machine topology.');
  }
  const machine = JSON.stringify(canonicalJson(input.projection), null, 2);
  const candidateSections = topology.candidatePackageIds.map((candidate, index) => (
    `### ${index + 1}. ${candidate}\n\n${input.candidateDescriptions[index]!}\n`
  )).join('\n');
  return `---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: ${input.reviewedOn}
---

# SEC 滚动近期计划

${input.introduction}

\`\`\`json
${machine}
\`\`\`

## 当前唯一 Work Package

### ${topology.activePackageId}

${input.activeDescription}

## 候选 Work Package

${candidateSections}
## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选少于二、多于五、重复、手工重排、增删；
3. WorkDecision、显式transition authority或proposal exact binding不再与当前projection逐项相等；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
`;
}

export function renderSecWorkRollingPlan(input: {
  receipt: SecWorkDecisionReceipt;
  reviewedOn: string;
}): string {
  const projection = compileSecWorkRollingProjection(input.receipt);
  const machine = JSON.stringify(canonicalJson(projection), null, 2);
  if (machine.length === 0) fail('rolling selection projection serialization failed.');
  return renderRollingPlanDocument({
    reviewedOn: input.reviewedOn,
    projection,
    introduction: '本文件是validated WorkDecision的只读投影，不是roadmap、registry、current spec或selection '
      + 'authority。\n任何选择变化都从exact main重新观察；Issue/comment prose、AI评分、wall-clock、caller JSON'
      + '和本文件自身\n均不能成为输入。receipt只能用于replay；effectful consumer必须调用trusted live adapter重新推导。',
    activeDescription: `Work identity \`${projection.active.workId}\`; current spec `
      + `\`${projection.active.currentSpecRef}\` at\n\`${projection.active.currentSpecRevision}\`; decision `
      + `\`${projection.decisionDigest}\`.`,
    candidateDescriptions: projection.candidates.map((candidate) => (
      `Work identity \`${candidate.workId}\`; current spec \`${candidate.currentSpecRef}\` at\n`
      + `\`${candidate.currentSpecRevision}\`; current decision status \`${candidate.decisionStatus}\`.`
    ))
  });
}

export function renderSecWorkRollingTransitionPlan(input: Readonly<{
  projection: SecWorkRollingTransitionProjection;
  reviewedOn: string;
}>): string {
  const projection = normalizeSecWorkRollingTransitionProjection(
    input.projection as unknown as Record<string, unknown>
  );
  const authorityDigest = sha256(projection.authority);
  const activeDescription = projection.authority.kind === 'committed-candidate-replan'
    ? `Existing active package replan bound to exact source head `
      + `\`${projection.authority.sourceHead}\`, source tree \`${projection.authority.sourceTree}\`, `
      + `manifest \`${projection.active.manifestDigest}\`, and authority \`${authorityDigest}\`.`
    : projection.authority.kind === 'main-health-repair'
      ? `Exact MainHealth repair bound to decision \`${projection.authority.decisionDigest}\`, health `
        + `\`${projection.authority.healthRevision}\`, manifest \`${projection.active.manifestDigest}\`, `
        + `and authority \`${authorityDigest}\`.`
      : `Final manual MainHealth bootstrap bound to observation `
        + `\`${projection.authority.bootstrapObservationDigest}\`, health `
        + `\`${projection.authority.healthRevision}\`, manifest \`${projection.active.manifestDigest}\`, `
        + `and authority \`${authorityDigest}\`; it retires only after exact new-main readback.`;
  return renderRollingPlanDocument({
    reviewedOn: input.reviewedOn,
    projection,
    introduction: '本文件由唯一rolling projection compiler生成。普通选择与非普通transition使用同一机器拓扑和'
      + '同一全文renderer；digest只证明规范化内容完整性，effectful owner仍必须在发布前重验其WorkDecision、'
      + 'committed-candidate或MainHealth authority。禁止单独修改标题、prose、JSON字段或digest。',
    activeDescription,
    candidateDescriptions: projection.candidates.map(() => (
      `Retained ordered candidate from transition authority \`${authorityDigest}\`.`
    ))
  });
}

export function renderSecWorkRollingProposalPlan(input: Readonly<{
  projection: SecWorkRollingProposalProjection;
  reviewedOn: string;
}>): string {
  const projection = normalizeSecWorkRollingProposalProjection(
    input.projection as unknown as Record<string, unknown>
  );
  return renderRollingPlanDocument({
    reviewedOn: input.reviewedOn,
    projection,
    introduction: '本文件由唯一rolling projection compiler生成，是未获activation authority的proposal-only候选投影。'
      + 'authority固定为none；projection digest只保护规范化表示，不能产生WorkDecision、Effect、merge或完成权限。',
    activeDescription: `Proposal-only target manifest \`${projection.active.manifestPath}\` at `
      + `\`${projection.active.manifestDigest}\`, based on exact main \`${projection.exactMain}\` and tree `
      + `\`${projection.exactMainTree}\`.`,
    candidateDescriptions: projection.candidates.map(() => (
      'Retained ordered candidate identity from the published baseline; no selection authority is implied.'
    ))
  });
}

function liveResultDigest(value: unknown): SecWorkDigest {
  return sha256(value) as SecWorkDigest;
}

export function resolvedSecWorkSelectionLiveResult(
  receipt: SecWorkDecisionReceipt,
  demandGraph: OperationDemandGraph,
  terminalCompaction: SecRoadmapTerminalCompaction | null = null
): SecWorkSelectionLiveResult {
  const withoutDigest = deepFreeze({
    schema: SEC_WORK_SELECTION_LIVE_RESULT_SCHEMA,
    status: 'resolved' as const,
    reasonCodes: [] as const,
    blockerRefs: [] as const,
    receipt,
    demandGraph,
    terminalCompaction
  });
  return deepFreeze({ ...withoutDigest, resultDigest: liveResultDigest(withoutDigest) });
}

export function unresolvedSecWorkSelectionLiveResult(input: {
  reasonCodes: readonly string[];
  blockerRefs: readonly string[];
}): SecWorkSelectionLiveResult {
  const reasonCodes = [...new Set(input.reasonCodes.map((entry) => token(entry, 'reasonCode')))]
    .sort(compareCodeUnits);
  const blockerRefs = [...new Set(input.blockerRefs.map((entry) => text(entry, 'blockerRef')))]
    .sort(compareCodeUnits);
  if (reasonCodes.length === 0 || blockerRefs.length === 0) {
    fail('unresolved live result requires reason codes and bounded blocker refs.');
  }
  const withoutDigest = deepFreeze({
    schema: SEC_WORK_SELECTION_LIVE_RESULT_SCHEMA,
    status: 'unresolved' as const,
    reasonCodes,
    blockerRefs,
    receipt: null,
    demandGraph: null,
    terminalCompaction: null
  });
  return deepFreeze({ ...withoutDigest, resultDigest: liveResultDigest(withoutDigest) });
}

export function currentSpecRevisionFromBody(body: string): SecWorkDigest {
  return rawSha256(body);
}
