import { canonicalEquals, deepFreeze } from '../../../foundation/canonical.ts';
import {
  buildCiArtifactUploadGroups,
  ciArtifactKindForPath,
  ciArtifactUploadName,
  countCiArtifactMissingReasons,
  countCiArtifactMissingReasonTypes,
  isCiContractArtifactPath,
  normalizeCiArtifactPath,
  uniqueSortedCiArtifactPaths
} from '../contract/manifest.ts';
import {
  CI_ARTIFACT_FORMAT_VERSION,
  CI_ARTIFACT_KINDS,
  CI_ARTIFACT_MISSING_REASONS,
  type CiArtifactEntry,
  type CiArtifactKind,
  type CiArtifactManifest,
  type CiArtifactMissingEntry,
  type CiArtifactMissingReason,
  type CiArtifactSummary,
  type CiArtifactUploadGroup
} from '../contract/types.ts';
import { isCanonicalPortableLogicalPathV1 } from '../../../foundation/paths.ts';
import { readOptionalRetainedJsonV1 } from '../../../runtime-physical/index.ts';

const ROOT_KEYS = new Set(['formatVersion', 'root', 'summary', 'artifacts', 'uploadGroups', 'missing']);
const SUMMARY_KEYS = new Set([
  'artifactStatus',
  'artifactCount',
  'governanceCount',
  'testCount',
  'contractCount',
  'contractPaths',
  'uploadGroupCount',
  'missingCount',
  'missingReasonTypeCount',
  'missingReasonCounts'
]);
const ARTIFACT_KEYS = new Set(['path', 'kind', 'uploadName', 'exists']);
const UPLOAD_GROUP_KEYS = new Set(['kind', 'count', 'paths']);
const MISSING_KEYS = new Set(['path', 'reason', 'declaredBy']);
const ARTIFACT_KINDS = new Set<string>(CI_ARTIFACT_KINDS);
const MISSING_REASONS = new Set<string>(CI_ARTIFACT_MISSING_REASONS);
const DECLARED_BY = new Set(['graph.lock.json', 'artifact-manifest']);

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be one object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported field "${key}"`);
  }
}

function canonicalArtifactPath(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || normalizeCiArtifactPath(value) !== value) {
    throw new Error(`${label} must be one canonical CI artifact path`);
  }
  if (value.endsWith('/**')) {
    const directory = value.slice(0, -3);
    if (!isCanonicalPortableLogicalPathV1(directory)) {
      throw new Error(`${label} recursive artifact root is not one canonical portable logical path`);
    }
    return value;
  }
  if (!isCanonicalPortableLogicalPathV1(value)) {
    throw new Error(`${label} is not one canonical portable logical path`);
  }
  return value;
}

function canonicalUniquePaths(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const paths = value.map((entry, index) => canonicalArtifactPath(entry, `${label}[${index}]`));
  if (new Set(paths).size !== paths.length) throw new Error(`${label} contains duplicate paths`);
  const sorted = uniqueSortedCiArtifactPaths(paths);
  if (!canonicalEquals(paths, sorted)) throw new Error(`${label} must use canonical path order`);
  return paths;
}

function validateArtifact(value: unknown, index: number): CiArtifactEntry {
  const label = `CI artifact[${index}]`;
  const raw = record(value, label);
  exactKeys(raw, ARTIFACT_KEYS, label);
  const artifactPath = canonicalArtifactPath(raw.path, `${label}.path`);
  if (typeof raw.kind !== 'string' || !ARTIFACT_KINDS.has(raw.kind)) {
    throw new Error(`${label}.kind is invalid`);
  }
  const kind = raw.kind as CiArtifactKind;
  if (kind !== ciArtifactKindForPath(artifactPath)) {
    throw new Error(`${label}.kind differs from canonical path classification`);
  }
  const uploadName = ciArtifactUploadName(artifactPath);
  if (raw.uploadName !== uploadName) {
    throw new Error(`${label}.uploadName differs from canonical artifact identity`);
  }
  if (raw.exists !== true) {
    throw new Error(`${label}.exists must be true; absent artifacts belong in missing[]`);
  }
  return { path: artifactPath, kind, uploadName, exists: true };
}

function validateUploadGroup(value: unknown, index: number): CiArtifactUploadGroup {
  const label = `CI artifact uploadGroups[${index}]`;
  const raw = record(value, label);
  exactKeys(raw, UPLOAD_GROUP_KEYS, label);
  if (typeof raw.kind !== 'string' || !ARTIFACT_KINDS.has(raw.kind)) {
    throw new Error(`${label}.kind is invalid`);
  }
  const paths = canonicalUniquePaths(raw.paths, `${label}.paths`);
  if (typeof raw.count !== 'number' || !Number.isSafeInteger(raw.count) || raw.count !== paths.length || raw.count <= 0) {
    throw new Error(`${label}.count does not match its paths`);
  }
  return { kind: raw.kind as CiArtifactKind, count: raw.count, paths };
}

function validateMissing(value: unknown, index: number): CiArtifactMissingEntry {
  const label = `CI artifact missing[${index}]`;
  const raw = record(value, label);
  exactKeys(raw, MISSING_KEYS, label);
  const artifactPath = canonicalArtifactPath(raw.path, `${label}.path`);
  if (typeof raw.reason !== 'string' || !MISSING_REASONS.has(raw.reason)) {
    throw new Error(`${label}.reason is invalid`);
  }
  if (typeof raw.declaredBy !== 'string' || !DECLARED_BY.has(raw.declaredBy)) {
    throw new Error(`${label}.declaredBy is invalid`);
  }
  return {
    path: artifactPath,
    reason: raw.reason as CiArtifactMissingReason,
    declaredBy: raw.declaredBy as CiArtifactMissingEntry['declaredBy']
  };
}

function expectedSummary(
  artifacts: readonly CiArtifactEntry[],
  uploadGroups: readonly CiArtifactUploadGroup[],
  missing: readonly CiArtifactMissingEntry[]
): CiArtifactSummary {
  const contractPaths = uniqueSortedCiArtifactPaths(
    artifacts.map((entry) => entry.path).filter(isCiContractArtifactPath)
  );
  const missingReasonCounts = countCiArtifactMissingReasons(missing);
  return {
    artifactStatus: missing.length > 0 ? 'attention' : 'passed',
    artifactCount: artifacts.length,
    governanceCount: artifacts.filter((entry) => entry.kind === 'governance').length,
    testCount: artifacts.filter((entry) => entry.kind === 'test').length,
    contractCount: contractPaths.length,
    contractPaths,
    uploadGroupCount: uploadGroups.length,
    missingCount: missing.length,
    missingReasonTypeCount: countCiArtifactMissingReasonTypes(missingReasonCounts),
    missingReasonCounts
  };
}

function validateSummary(
  value: unknown,
  artifacts: readonly CiArtifactEntry[],
  uploadGroups: readonly CiArtifactUploadGroup[],
  missing: readonly CiArtifactMissingEntry[]
): CiArtifactSummary {
  const raw = record(value, 'CI artifact summary');
  exactKeys(raw, SUMMARY_KEYS, 'CI artifact summary');
  const expected = expectedSummary(artifacts, uploadGroups, missing);
  if (!canonicalEquals(raw, expected)) {
    throw new Error('CI artifact summary differs from canonical artifacts/missing derivation');
  }
  return expected;
}

export function validateCiArtifactManifestV1(value: unknown): CiArtifactManifest {
  const raw = record(value, 'CI artifact manifest');
  exactKeys(raw, ROOT_KEYS, 'CI artifact manifest');
  if (raw.formatVersion !== CI_ARTIFACT_FORMAT_VERSION || raw.root !== 'workspace') {
    throw new Error('CI artifact manifest has an unsupported formatVersion/root');
  }
  if (!Array.isArray(raw.artifacts) || !Array.isArray(raw.uploadGroups) || !Array.isArray(raw.missing)) {
    throw new Error('CI artifact manifest collections must be arrays');
  }

  const artifacts = raw.artifacts.map(validateArtifact);
  const artifactPaths = artifacts.map((entry) => entry.path);
  if (new Set(artifactPaths).size !== artifactPaths.length ||
      !canonicalEquals(artifactPaths, uniqueSortedCiArtifactPaths(artifactPaths))) {
    throw new Error('CI artifact manifest artifacts must be unique and canonically ordered');
  }

  const uploadGroups = raw.uploadGroups.map(validateUploadGroup);
  if (new Set(uploadGroups.map((group) => group.kind)).size !== uploadGroups.length) {
    throw new Error('CI artifact manifest repeats an upload group kind');
  }
  const expectedGroups = buildCiArtifactUploadGroups(artifacts);
  if (!canonicalEquals(uploadGroups, expectedGroups)) {
    throw new Error('CI artifact manifest uploadGroups differ from canonical artifact grouping');
  }

  const missing = raw.missing.map(validateMissing);
  const missingPaths = missing.map((entry) => entry.path);
  if (new Set(missingPaths).size !== missingPaths.length ||
      !canonicalEquals(missingPaths, uniqueSortedCiArtifactPaths(missingPaths))) {
    throw new Error('CI artifact manifest missing[] must be unique and canonically ordered');
  }
  const artifactPathSet = new Set(artifactPaths);
  if (missingPaths.some((artifactPath) => artifactPathSet.has(artifactPath))) {
    throw new Error('CI artifact manifest cannot declare one path as both present and missing');
  }

  const summary = validateSummary(raw.summary, artifacts, uploadGroups, missing);
  return deepFreeze({
    formatVersion: CI_ARTIFACT_FORMAT_VERSION,
    root: 'workspace' as const,
    summary,
    artifacts,
    uploadGroups,
    missing
  });
}

export function readOptionalCiArtifactManifestV1(
  filePath: string,
  label = 'CI artifact manifest'
): CiArtifactManifest | null {
  const raw = readOptionalRetainedJsonV1<unknown>(filePath, label);
  return raw === null ? null : validateCiArtifactManifestV1(raw);
}
