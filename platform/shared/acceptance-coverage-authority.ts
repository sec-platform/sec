import { isCanonicalAcceptanceId } from './acceptance-identity.ts';
import type { AcceptanceCoverageEntry, AcceptanceCoverageReport } from './acceptance-types.ts';
import { isCanonicalBlockId } from './block-identity.ts';
import { canonicalEquals, deepFreeze } from './canonical-primitives.ts';
import { uniqueSorted } from './collections.ts';
import { readOptionalRetainedJsonV1 } from './retained-file-read.ts';
import { isCanonicalSlotId } from './slot-identity.ts';
import type { VerificationStatus } from './verification-types.ts';

const ROOT_KEYS = new Set([
  'formatVersion',
  'status',
  'acceptancePassed',
  'blocks',
  'slots',
  'uncoveredBlocks',
  'uncoveredSlots'
]);
const ENTRY_KEYS = new Set(['id', 'declaredAcceptance', 'coveredBy', 'uncovered']);
const STATUSES = new Set<VerificationStatus>(['passed', 'failed', 'skipped']);

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be one object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: ReadonlySet<string>, label: string): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
    throw new Error(`${label} has an unsupported field set`);
  }
}

function canonicalAcceptanceIds(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !isCanonicalAcceptanceId(entry))) {
    throw new Error(`${label} must contain canonical Acceptance IDs`);
  }
  const ids = value as string[];
  const canonical = uniqueSorted(ids);
  if (!canonicalEquals(ids, canonical)) {
    throw new Error(`${label} must be unique and canonically ordered`);
  }
  return canonical;
}

function validateEntry(
  value: unknown,
  index: number,
  kind: 'block' | 'slot'
): AcceptanceCoverageEntry {
  const label = `Acceptance Coverage ${kind}[${index}]`;
  const raw = record(value, label);
  exactKeys(raw, ENTRY_KEYS, label);
  if (typeof raw.id !== 'string' ||
      (kind === 'block' ? !isCanonicalBlockId(raw.id) : !isCanonicalSlotId(raw.id))) {
    throw new Error(`${label}.id is not one canonical ${kind} identity`);
  }
  const declaredAcceptance = canonicalAcceptanceIds(raw.declaredAcceptance, `${label}.declaredAcceptance`);
  const coveredBy = canonicalAcceptanceIds(raw.coveredBy, `${label}.coveredBy`);
  const declared = new Set(declaredAcceptance);
  if (coveredBy.some((acceptanceId) => !declared.has(acceptanceId))) {
    throw new Error(`${label}.coveredBy contains an undeclared Acceptance ID`);
  }
  const uncovered = declaredAcceptance.length === 0 || coveredBy.length !== declaredAcceptance.length;
  if (raw.uncovered !== uncovered) {
    throw new Error(`${label}.uncovered differs from declared/covered state`);
  }
  return {
    id: raw.id,
    declaredAcceptance,
    coveredBy,
    uncovered
  };
}

function validateEntries(value: unknown, kind: 'block' | 'slot'): AcceptanceCoverageEntry[] {
  if (!Array.isArray(value)) throw new Error(`Acceptance Coverage ${kind}s must be an array`);
  const entries = value.map((entry, index) => validateEntry(entry, index, kind));
  const ids = entries.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`Acceptance Coverage ${kind}s repeat an identity`);
  }
  if (!canonicalEquals(ids, uniqueSorted(ids))) {
    throw new Error(`Acceptance Coverage ${kind}s must be canonically ordered`);
  }
  return entries;
}

function validateUncoveredIds(
  value: unknown,
  entries: readonly AcceptanceCoverageEntry[],
  kind: 'block' | 'slot'
): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`Acceptance Coverage uncovered ${kind}s must be an array`);
  }
  const ids = value as string[];
  const expected = entries.filter((entry) => entry.uncovered).map((entry) => entry.id);
  if (!canonicalEquals(ids, expected)) {
    throw new Error(`Acceptance Coverage uncovered ${kind}s differ from coverage entries`);
  }
  return [...expected];
}

export function validateAcceptanceCoverageReportV1(value: unknown): AcceptanceCoverageReport {
  const raw = record(value, 'Acceptance Coverage report');
  exactKeys(raw, ROOT_KEYS, 'Acceptance Coverage report');
  if (raw.formatVersion !== '1') {
    throw new Error('Acceptance Coverage report has an unsupported formatVersion');
  }
  if (typeof raw.status !== 'string' || !STATUSES.has(raw.status as VerificationStatus)) {
    throw new Error('Acceptance Coverage report has an invalid status');
  }
  const acceptancePassed = canonicalAcceptanceIds(raw.acceptancePassed, 'Acceptance Coverage acceptancePassed');
  const blocks = validateEntries(raw.blocks, 'block');
  const slots = validateEntries(raw.slots, 'slot');
  const uncoveredBlocks = validateUncoveredIds(raw.uncoveredBlocks, blocks, 'block');
  const uncoveredSlots = validateUncoveredIds(raw.uncoveredSlots, slots, 'slot');

  return deepFreeze({
    formatVersion: '1',
    status: raw.status as VerificationStatus,
    acceptancePassed,
    blocks,
    slots,
    uncoveredBlocks,
    uncoveredSlots
  });
}

export function readOptionalAcceptanceCoverageReportV1(
  filePath: string,
  label = 'Acceptance Coverage report'
): AcceptanceCoverageReport | null {
  const raw = readOptionalRetainedJsonV1<unknown>(filePath, label);
  return raw === null ? null : validateAcceptanceCoverageReportV1(raw);
}
