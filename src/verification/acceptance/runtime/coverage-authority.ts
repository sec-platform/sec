import { readOptionalRetainedJson } from '../../../runtime-state/physical/runtime/retained-file-read.ts';
import { isCanonicalAcceptanceId } from '../../../semantic/acceptance/contract/identity.ts';
import { ACCEPTANCE_COVERAGE_FORMAT_VERSION, type AcceptanceCoverageEntry, type AcceptanceCoverageReport } from '../../../semantic/acceptance/contract/types.ts';
import { isCanonicalBlockId } from '../../../semantic/identity/contract/block.ts';
import { canonicalEquals, deepFreeze, uniqueSorted } from '../../../system-architecture/foundation/runtime/canonical.ts';
import type { VerificationStatus } from '../../contract/types.ts';

const ROOT_KEYS = new Set([
  'formatVersion',
  'status',
  'acceptancePassed',
  'blocks',
  'uncoveredBlocks'
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
  index: number
): AcceptanceCoverageEntry {
  const label = `Acceptance Coverage block[${index}]`;
  const raw = record(value, label);
  exactKeys(raw, ENTRY_KEYS, label);
  if (typeof raw.id !== 'string' || !isCanonicalBlockId(raw.id)) {
    throw new Error(`${label}.id is not one canonical block identity`);
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

function validateEntries(value: unknown): AcceptanceCoverageEntry[] {
  if (!Array.isArray(value)) throw new Error('Acceptance Coverage blocks must be an array');
  const entries = value.map((entry, index) => validateEntry(entry, index));
  const ids = entries.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('Acceptance Coverage blocks repeat an identity');
  }
  if (!canonicalEquals(ids, uniqueSorted(ids))) {
    throw new Error('Acceptance Coverage blocks must be canonically ordered');
  }
  return entries;
}

function validateUncoveredIds(
  value: unknown,
  entries: readonly AcceptanceCoverageEntry[]
): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error('Acceptance Coverage uncovered blocks must be an array');
  }
  const ids = value as string[];
  const expected = entries.filter((entry) => entry.uncovered).map((entry) => entry.id);
  if (!canonicalEquals(ids, expected)) {
    throw new Error('Acceptance Coverage uncovered blocks differ from coverage entries');
  }
  return [...expected];
}

export function validateAcceptanceCoverageReport(value: unknown): AcceptanceCoverageReport {
  const raw = record(value, 'Acceptance Coverage report');
  exactKeys(raw, ROOT_KEYS, 'Acceptance Coverage report');
  if (raw.formatVersion !== ACCEPTANCE_COVERAGE_FORMAT_VERSION) {
    throw new Error('Acceptance Coverage report has an unsupported formatVersion');
  }
  if (typeof raw.status !== 'string' || !STATUSES.has(raw.status as VerificationStatus)) {
    throw new Error('Acceptance Coverage report has an invalid status');
  }
  const acceptancePassed = canonicalAcceptanceIds(raw.acceptancePassed, 'Acceptance Coverage acceptancePassed');
  const blocks = validateEntries(raw.blocks);
  const uncoveredBlocks = validateUncoveredIds(raw.uncoveredBlocks, blocks);

  return deepFreeze({
    formatVersion: ACCEPTANCE_COVERAGE_FORMAT_VERSION,
    status: raw.status as VerificationStatus,
    acceptancePassed,
    blocks,
    uncoveredBlocks
  });
}

export function readOptionalAcceptanceCoverageReport(
  filePath: string,
  label = 'Acceptance Coverage report'
): AcceptanceCoverageReport | null {
  const raw = readOptionalRetainedJson<unknown>(filePath, label);
  return raw === null ? null : validateAcceptanceCoverageReport(raw);
}
