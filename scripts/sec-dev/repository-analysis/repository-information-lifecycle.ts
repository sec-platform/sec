import rawData from './repository-information-lifecycle.json' with { type: 'json' };

export type InformationLifecycleDisposition =
  | 'superseded-duplicate-authority'
  | 'code-owned-contract'
  | 'test-owned-contract'
  | 'migrated-canonical-authority'
  | 'migrated-machine-ledger'
  | 'migrated-fixture'
  | 'historical-git-only'
  | 'extract-required'
  | 'unresolved';

export interface InformationLifecycleClaimFamily {
  claimId: string;
  normalizedStatement: string;
  oldLines: string;
  disposition: InformationLifecycleDisposition;
  currentOwner: string;
  currentReferences: readonly string[];
  consumers: readonly string[];
  positiveEvidence: readonly string[];
  negativeEvidence: readonly string[];
  conflicts: readonly string[];
  reason: string;
}

export type DeletedBlobMachineTuple = readonly [
  kind: 'D' | 'R',
  oldBlob: string,
  rawDigest: string,
  bytes: number,
  lineCount: number,
  newPath?: string
];

type JsonRecord = Record<string, unknown>;

const DISPOSITIONS = new Set<InformationLifecycleDisposition>([
  'superseded-duplicate-authority',
  'code-owned-contract',
  'test-owned-contract',
  'migrated-canonical-authority',
  'migrated-machine-ledger',
  'migrated-fixture',
  'historical-git-only',
  'extract-required',
  'unresolved'
]);

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function strings(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be an array of strings`);
  }
  return Object.freeze([...value]);
}

function disposition(value: unknown, label: string): InformationLifecycleDisposition {
  if (typeof value !== 'string' || !DISPOSITIONS.has(value as InformationLifecycleDisposition)) {
    throw new Error(`${label} is not a supported information-lifecycle disposition`);
  }
  return value as InformationLifecycleDisposition;
}

function parseDeletedBlobTuple(value: unknown, oldPath: string): DeletedBlobMachineTuple {
  if (!Array.isArray(value) || (value.length !== 5 && value.length !== 6)) {
    throw new Error(`deleted blob ${oldPath} must be a 5/6-field tuple`);
  }
  const [kind, oldBlob, rawDigest, bytes, lineCount, newPath] = value;
  if (kind !== 'D' && kind !== 'R') throw new Error(`deleted blob ${oldPath} has invalid kind`);
  if (typeof oldBlob !== 'string' || !/^[0-9a-f]{40}$/u.test(oldBlob)) {
    throw new Error(`deleted blob ${oldPath} has invalid Git blob identity`);
  }
  if (typeof rawDigest !== 'string' || !/^[0-9a-f]{64}$/u.test(rawDigest)) {
    throw new Error(`deleted blob ${oldPath} has invalid SHA-256 digest`);
  }
  if (!Number.isSafeInteger(bytes) || (bytes as number) <= 0) {
    throw new Error(`deleted blob ${oldPath} has invalid byte count`);
  }
  if (!Number.isSafeInteger(lineCount) || (lineCount as number) < 0) {
    throw new Error(`deleted blob ${oldPath} has invalid line count`);
  }
  if (kind === 'R') {
    if (typeof newPath !== 'string' || !newPath.startsWith('tests/fixtures/')) {
      throw new Error(`renamed blob ${oldPath} requires a fixture target`);
    }
    return Object.freeze([kind, oldBlob, rawDigest, bytes as number, lineCount as number, newPath]);
  }
  if (newPath !== undefined) throw new Error(`deleted blob ${oldPath} must not declare a rename target`);
  return Object.freeze([kind, oldBlob, rawDigest, bytes as number, lineCount as number]);
}

function parseClaimFamily(value: unknown, index: number): InformationLifecycleClaimFamily {
  const item = record(value, `claimFamilies[${index}]`);
  return Object.freeze({
    claimId: text(item.claimId, `claimFamilies[${index}].claimId`),
    normalizedStatement: text(item.normalizedStatement, `claimFamilies[${index}].normalizedStatement`),
    oldLines: text(item.oldLines, `claimFamilies[${index}].oldLines`),
    disposition: disposition(item.disposition, `claimFamilies[${index}].disposition`),
    currentOwner: text(item.currentOwner, `claimFamilies[${index}].currentOwner`),
    currentReferences: strings(item.currentReferences, `claimFamilies[${index}].currentReferences`),
    consumers: strings(item.consumers, `claimFamilies[${index}].consumers`),
    positiveEvidence: strings(item.positiveEvidence, `claimFamilies[${index}].positiveEvidence`),
    negativeEvidence: strings(item.negativeEvidence, `claimFamilies[${index}].negativeEvidence`),
    conflicts: strings(item.conflicts, `claimFamilies[${index}].conflicts`),
    reason: text(item.reason, `claimFamilies[${index}].reason`)
  });
}

const raw = record(rawData, 'repository-information-lifecycle data');
if (raw.schema !== 'sec-repository-information-lifecycle-data-v1') {
  throw new Error('repository information lifecycle data schema must be sec-repository-information-lifecycle-data-v1');
}
const rawTransition = record(raw.transition, 'transition');
const oldTransition = text(rawTransition.old, 'transition.old');
const nextTransition = text(rawTransition.next, 'transition.next');
if (!/^[0-9a-f]{40}$/u.test(oldTransition) || !/^[0-9a-f]{40}$/u.test(nextTransition)) {
  throw new Error('repository information lifecycle transition must use exact 40-hex Git identities');
}
export const INFORMATION_LIFECYCLE_TRANSITION = Object.freeze({
  old: oldTransition,
  next: nextTransition
});

const rawDeletedBlobs = record(raw.deletedBlobs, 'deletedBlobs');
const deletedEntries = Object.entries(rawDeletedBlobs).map(([oldPath, value]) => {
  if (!oldPath.startsWith('docs/')) throw new Error(`deleted blob path must be under docs/: ${oldPath}`);
  return [oldPath, parseDeletedBlobTuple(value, oldPath)] as const;
});
export const DELETED_BLOB_MACHINE_MANIFEST_V1: Readonly<Record<string, DeletedBlobMachineTuple>> =
  Object.freeze(Object.fromEntries(deletedEntries));

if (!Array.isArray(raw.claimFamilies)) throw new Error('claimFamilies must be an array');
const families = raw.claimFamilies.map(parseClaimFamily);
const familyIds = new Set(families.map((family) => family.claimId));
if (familyIds.size !== families.length) throw new Error('claimFamilies contain duplicate claimId values');
export const INFORMATION_LIFECYCLE_CLAIM_FAMILIES: readonly InformationLifecycleClaimFamily[] =
  Object.freeze(families);
