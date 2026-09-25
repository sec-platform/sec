import { canonicalEquals, compareCodeUnits, deepFreeze } from '../../contracts/canonical.ts';
import { isDigest256Hex } from '../../contracts/digest.ts';
import { isCanonicalPortableLogicalPath } from '../../contracts/logical-path.ts';
import { PROVENANCE_FORMAT_VERSION, type ProvenanceArtifact, type ProvenanceFile } from './types.ts';

const ROOT_KEYS = new Set(['formatVersion', 'artifacts']);
const ARTIFACT_KEYS = new Set([
  'path',
  'originType',
  'originId',
  'sourceBlock',
  'registrySourceId',
  'registryKind',
  'registryLocation',
  'registryPath',
  'sourcePath',
  'runtimeTarget',
  'generatedByPass',
  'generatorTaskId',
  'generatorEntityId',
  'artifactEntityId',
  'semanticRevision',
  'compilationTransactionId',
  'verifiedBy',
  'overrideStatus',
  'hash'
]);
const ORIGIN_TYPES = new Set(['block', 'generated', 'override']);
const OVERRIDE_STATUSES = new Set(['none', 'manual', 'rule-backed']);
const REGISTRY_KINDS = new Set(['official', 'private', 'community']);
const REGISTRY_LOCATIONS = new Set(['compiler', 'workspace']);

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

function optionalNonemptyString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a nonempty string when present`);
  }
  return value;
}

function optionalPortablePath(value: unknown, label: string): string | undefined {
  const text = optionalNonemptyString(value, label);
  if (text !== undefined && !isCanonicalPortableLogicalPath(text)) {
    throw new Error(`${label} must be one canonical portable logical path`);
  }
  return text;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    throw new Error(`${label} must be an array of nonempty strings`);
  }
  const values = value as string[];
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must not contain duplicates`);
  }
  if (!canonicalEquals(values, [...values].sort(compareCodeUnits))) {
    throw new Error(`${label} must be canonically ordered`);
  }
  return [...values];
}

function validateArtifact(value: unknown, index: number): ProvenanceArtifact {
  const label = `Provenance artifact[${index}]`;
  const raw = record(value, label);
  exactKeys(raw, ARTIFACT_KEYS, label);

  if (typeof raw.path !== 'string' || !isCanonicalPortableLogicalPath(raw.path)) {
    throw new Error(`${label}.path must be one canonical portable logical path`);
  }
  if (typeof raw.originType !== 'string' || !ORIGIN_TYPES.has(raw.originType)) {
    throw new Error(`${label}.originType is invalid`);
  }
  if (typeof raw.originId !== 'string' || raw.originId.length === 0) {
    throw new Error(`${label}.originId must be a nonempty string`);
  }
  if (typeof raw.overrideStatus !== 'string' || !OVERRIDE_STATUSES.has(raw.overrideStatus)) {
    throw new Error(`${label}.overrideStatus is invalid`);
  }
  if (raw.registryKind !== undefined && (typeof raw.registryKind !== 'string' || !REGISTRY_KINDS.has(raw.registryKind))) {
    throw new Error(`${label}.registryKind is invalid`);
  }
  if (
    raw.registryLocation !== undefined &&
    (typeof raw.registryLocation !== 'string' || !REGISTRY_LOCATIONS.has(raw.registryLocation))
  ) {
    throw new Error(`${label}.registryLocation is invalid`);
  }
  if (raw.hash !== undefined && !isDigest256Hex(raw.hash)) {
    throw new Error(`${label}.hash must be one lowercase raw SHA-256 digest`);
  }

  return {
    path: raw.path,
    originType: raw.originType as ProvenanceArtifact['originType'],
    originId: raw.originId,
    ...(optionalNonemptyString(raw.sourceBlock, `${label}.sourceBlock`) ? { sourceBlock: raw.sourceBlock as string } : {}),
    ...(optionalNonemptyString(raw.registrySourceId, `${label}.registrySourceId`) ? { registrySourceId: raw.registrySourceId as string } : {}),
    ...(raw.registryKind !== undefined ? { registryKind: raw.registryKind as ProvenanceArtifact['registryKind'] } : {}),
    ...(raw.registryLocation !== undefined ? { registryLocation: raw.registryLocation as ProvenanceArtifact['registryLocation'] } : {}),
    ...(optionalPortablePath(raw.registryPath, `${label}.registryPath`) ? { registryPath: raw.registryPath as string } : {}),
    ...(optionalPortablePath(raw.sourcePath, `${label}.sourcePath`) ? { sourcePath: raw.sourcePath as string } : {}),
    ...(optionalPortablePath(raw.runtimeTarget, `${label}.runtimeTarget`) ? { runtimeTarget: raw.runtimeTarget as string } : {}),
    ...(optionalNonemptyString(raw.generatedByPass, `${label}.generatedByPass`) ? { generatedByPass: raw.generatedByPass as string } : {}),
    ...(optionalNonemptyString(raw.generatorTaskId, `${label}.generatorTaskId`) ? { generatorTaskId: raw.generatorTaskId as string } : {}),
    ...(optionalNonemptyString(raw.generatorEntityId, `${label}.generatorEntityId`) ? { generatorEntityId: raw.generatorEntityId as string } : {}),
    ...(optionalNonemptyString(raw.artifactEntityId, `${label}.artifactEntityId`) ? { artifactEntityId: raw.artifactEntityId as string } : {}),
    ...(optionalNonemptyString(raw.semanticRevision, `${label}.semanticRevision`) ? { semanticRevision: raw.semanticRevision as string } : {}),
    ...(optionalNonemptyString(raw.compilationTransactionId, `${label}.compilationTransactionId`) ? { compilationTransactionId: raw.compilationTransactionId as string } : {}),
    verifiedBy: stringArray(raw.verifiedBy, `${label}.verifiedBy`),
    overrideStatus: raw.overrideStatus as ProvenanceArtifact['overrideStatus'],
    ...(raw.hash !== undefined ? { hash: raw.hash as string } : {})
  };
}

export function validateProvenanceFile(value: unknown): ProvenanceFile {
  const raw = record(value, 'Provenance');
  exactKeys(raw, ROOT_KEYS, 'Provenance');
  if (raw.formatVersion !== PROVENANCE_FORMAT_VERSION) {
    throw new Error(`Provenance has unsupported formatVersion "${String(raw.formatVersion)}"`);
  }
  if (!Array.isArray(raw.artifacts)) throw new Error('Provenance.artifacts must be an array');

  const artifacts = raw.artifacts.map(validateArtifact);
  const paths = artifacts.map((artifact) => artifact.path);
  if (new Set(paths).size !== paths.length) {
    throw new Error('Provenance repeats an artifact path');
  }
  if (!canonicalEquals(paths, [...paths].sort(compareCodeUnits))) {
    throw new Error('Provenance artifacts must be canonically ordered by path');
  }
  return deepFreeze({ formatVersion: PROVENANCE_FORMAT_VERSION, artifacts });
}
