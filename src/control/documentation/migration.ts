import { CodexDevelopmentIsCanonicalRepositoryPath } from '../../system-architecture/foundation/contract/repository-path.ts';
import {
  canonicalJson,
  compareCodeUnits,
  deepFreeze,
  sha256
} from '../../system-architecture/foundation/runtime/canonical.ts';
import type {
  DocumentationAuthorityRecord,
  DocumentationAuthorityRegistry
} from './authority.ts';

export const DOCUMENTATION_MIGRATION_DESIGN_SCHEMA =
  'sec-documentation-migration-design' as const;

type Digest = `sha256:${string}`;

export const DOCUMENTATION_MIGRATION_CORPUS_STATUSES = [
  'tracked-registered',
  'tracked-non-active',
  'tracked-unclassified',
  'missing'
] as const;
export type DocumentationMigrationCorpusStatus =
  typeof DOCUMENTATION_MIGRATION_CORPUS_STATUSES[number];

export const DOCUMENTATION_MIGRATION_EXTERNAL_CONSUMER_STATUSES = [
  'none-observed',
  'present',
  'unknown'
] as const;
export type DocumentationMigrationExternalConsumerStatus =
  typeof DOCUMENTATION_MIGRATION_EXTERNAL_CONSUMER_STATUSES[number];

/**
 * Observed consumer references and proof that the local consumer universe was
 * actually covered are separate facts.  A literal hit list is useful evidence,
 * but an empty hit list is not consumer-zero unless the owner also proves the
 * local census is complete.
 */
export const DOCUMENTATION_MIGRATION_LOCAL_CONSUMER_COVERAGE_STATUSES = [
  'complete',
  'unknown'
] as const;
export type DocumentationMigrationLocalConsumerCoverageStatus =
  typeof DOCUMENTATION_MIGRATION_LOCAL_CONSUMER_COVERAGE_STATUSES[number];

export const DOCUMENTATION_MIGRATION_TARGET_CLASSES = [
  'source-fragment',
  'external-bound-input',
  'generated-projection',
  'runtime-artifact'
] as const;
export type DocumentationMigrationTargetClass =
  typeof DOCUMENTATION_MIGRATION_TARGET_CLASSES[number];

export const DOCUMENTATION_MIGRATION_DISPOSITIONS = [
  'preserve-as-source',
  'derive-projection',
  'bind-external-input',
  'relocate-runtime-artifact',
  'split-control',
  'blocked'
] as const;
export type DocumentationMigrationDisposition =
  typeof DOCUMENTATION_MIGRATION_DISPOSITIONS[number];

export const DOCUMENTATION_MIGRATION_FRONTIER_CODES = [
  'authority-role-adoption-required',
  'control-state-separation-required',
  'current-registry-cutover-required',
  'consumer-rewrite-required',
  'local-consumer-coverage-unknown',
  'external-consumer-unknown',
  'missing-current-source',
  'unclassified-current-source'
] as const;
export type DocumentationMigrationFrontierCode =
  typeof DOCUMENTATION_MIGRATION_FRONTIER_CODES[number];

/** Machine-readable target grammar; its digest binds every migration design. */
export const DOCUMENTATION_MIGRATION_TARGET_CONTRACT = deepFreeze({
  schema: DOCUMENTATION_MIGRATION_DESIGN_SCHEMA,
  corpusStatuses: DOCUMENTATION_MIGRATION_CORPUS_STATUSES,
  externalConsumerStatuses: DOCUMENTATION_MIGRATION_EXTERNAL_CONSUMER_STATUSES,
  localConsumerCoverageStatuses: DOCUMENTATION_MIGRATION_LOCAL_CONSUMER_COVERAGE_STATUSES,
  targetClasses: DOCUMENTATION_MIGRATION_TARGET_CLASSES,
  dispositions: DOCUMENTATION_MIGRATION_DISPOSITIONS,
  frontierCodes: DOCUMENTATION_MIGRATION_FRONTIER_CODES
});
export const DOCUMENTATION_MIGRATION_TARGET_CONTRACT_DIGEST =
  sha256(DOCUMENTATION_MIGRATION_TARGET_CONTRACT) as Digest;

export interface DocumentationMigrationCorpusEntry {
  readonly path: string;
  readonly status: DocumentationMigrationCorpusStatus;
  readonly registryId: string | null;
  readonly contentDigest: Digest | null;
  readonly consumerRefs: readonly string[];
  readonly localConsumerCoverageStatus: DocumentationMigrationLocalConsumerCoverageStatus;
  readonly externalConsumerStatus: DocumentationMigrationExternalConsumerStatus;
}

export interface DocumentationMigrationFrontier {
  readonly code: DocumentationMigrationFrontierCode;
  readonly subjectRef: string;
  readonly ownerRef: string | null;
  readonly consumerRefsDigest: Digest | null;
  readonly detail: string;
}

export interface DocumentationMigrationPreservationEntry {
  readonly currentId: string | null;
  readonly currentPath: string;
  readonly currentKind: DocumentationAuthorityRecord['kind'] | 'non-active' | 'unclassified';
  readonly currentDigest: Digest | null;
  readonly targetClass: DocumentationMigrationTargetClass;
  readonly disposition: DocumentationMigrationDisposition;
  readonly consumerRefs: readonly string[];
  readonly consumerRefsDigest: Digest;
  readonly frontierCodes: readonly DocumentationMigrationFrontierCode[];
}

export interface DocumentationMigrationDesign {
  readonly schema: typeof DOCUMENTATION_MIGRATION_DESIGN_SCHEMA;
  readonly currentRegistryDigest: Digest;
  readonly currentCorpusDigest: Digest;
  readonly targetContractDigest: Digest;
  readonly preservation: readonly DocumentationMigrationPreservationEntry[];
  readonly frontier: readonly DocumentationMigrationFrontier[];
  readonly status: 'ready' | 'blocked';
  readonly designDigest: Digest;
}

function fail(message: string): never {
  throw new Error(`Documentation migration compiler: ${message}`);
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || value.includes('\0')) {
    fail(`${label} must be one non-empty trimmed string.`);
  }
  return value;
}

function canonicalPath(value: unknown, label: string): string {
  const result = nonEmptyString(value, label);
  if (!CodexDevelopmentIsCanonicalRepositoryPath(result)) {
    fail(`${label} must be a canonical repository-relative path.`);
  }
  return result;
}

function token(value: unknown, label: string): string {
  const result = nonEmptyString(value, label);
  if (!/^[a-z0-9][a-z0-9._:/-]*$/u.test(result)) fail(`${label} must be one canonical token.`);
  return result;
}

function digest(value: unknown, label: string): Digest {
  const result = nonEmptyString(value, label);
  if (!/^sha256:[0-9a-f]{64}$/u.test(result)) fail(`${label} must be one lowercase SHA-256 digest.`);
  return result as Digest;
}

function nullableDigest(value: unknown, label: string): Digest | null {
  return value === null ? null : digest(value, label);
}

function sortedUniqueTokens(values: readonly string[], label: string): readonly string[] {
  const result = values.map((value, index) => token(value, `${label}[${index}]`));
  const sorted = [...result].sort(compareCodeUnits);
  if (new Set(result).size !== result.length || sorted.some((value, index) => value !== result[index])) {
    fail(`${label} must be unique and in canonical code-unit order.`);
  }
  return Object.freeze(result);
}

function assertSortedEntries(entries: readonly DocumentationMigrationCorpusEntry[]): void {
  const paths = entries.map(({ path }) => path);
  const sorted = [...paths].sort(compareCodeUnits);
  if (new Set(paths).size !== paths.length || sorted.some((path, index) => path !== paths[index])) {
    fail('corpus entries must be unique and in canonical path order.');
  }
}

function normalizeCorpusEntry(
  entry: DocumentationMigrationCorpusEntry,
  index: number
): DocumentationMigrationCorpusEntry {
  const label = `corpus[${index}]`;
  const path = canonicalPath(entry.path, `${label}.path`);
  const allowedStatuses = new Set<DocumentationMigrationCorpusStatus>([
    'tracked-registered', 'tracked-non-active', 'tracked-unclassified', 'missing'
  ]);
  if (!allowedStatuses.has(entry.status)) fail(`${label}.status is unsupported.`);
  const registryId = entry.registryId === null ? null : token(entry.registryId, `${label}.registryId`);
  const contentDigest = nullableDigest(entry.contentDigest, `${label}.contentDigest`);
  const consumerRefs = sortedUniqueTokens(entry.consumerRefs, `${label}.consumerRefs`);
  const allowedExternal = new Set<DocumentationMigrationExternalConsumerStatus>([
    'none-observed', 'present', 'unknown'
  ]);
  if (!allowedExternal.has(entry.externalConsumerStatus)) {
    fail(`${label}.externalConsumerStatus is unsupported.`);
  }
  const allowedLocalCoverage = new Set<DocumentationMigrationLocalConsumerCoverageStatus>([
    'complete', 'unknown'
  ]);
  if (!allowedLocalCoverage.has(entry.localConsumerCoverageStatus)) {
    fail(`${label}.localConsumerCoverageStatus is unsupported.`);
  }

  if (entry.status === 'missing' && contentDigest !== null) {
    fail(`${label}.missing cannot carry contentDigest.`);
  }
  if (entry.status !== 'missing' && contentDigest === null) {
    fail(`${label}.contentDigest is required for present corpus entries.`);
  }
  if (entry.status === 'tracked-registered' && registryId === null) {
    fail(`${label}.tracked-registered requires registryId.`);
  }
  if (entry.status !== 'tracked-registered' && entry.status !== 'missing' && registryId !== null) {
    fail(`${label}.registryId is only valid for tracked-registered or missing entries.`);
  }
  if (entry.status === 'missing' && registryId === null) {
    fail(`${label}.missing requires registryId.`);
  }

  return Object.freeze({
    path,
    status: entry.status,
    registryId,
    contentDigest,
    consumerRefs,
    localConsumerCoverageStatus: entry.localConsumerCoverageStatus,
    externalConsumerStatus: entry.externalConsumerStatus
  });
}

function recordForCorpusEntry(
  entry: DocumentationMigrationCorpusEntry,
  registryById: ReadonlyMap<string, DocumentationAuthorityRecord>
): DocumentationAuthorityRecord | undefined {
  if (entry.registryId === null) return undefined;
  const record = registryById.get(entry.registryId);
  if (record === undefined) fail(`${entry.path} references unknown registry id ${entry.registryId}.`);
  if (record.path !== entry.path) {
    fail(`${entry.path} does not match registry record ${entry.registryId} path ${record.path}.`);
  }
  return record;
}

function targetForRecord(record: DocumentationAuthorityRecord): Readonly<{
  readonly targetClass: DocumentationMigrationTargetClass;
  readonly disposition: DocumentationMigrationDisposition;
}> {
  switch (record.kind) {
    case 'authority':
      return { targetClass: 'source-fragment', disposition: 'preserve-as-source' };
    case 'corpus-contract':
      return { targetClass: 'source-fragment', disposition: 'preserve-as-source' };
    case 'proposal':
      return { targetClass: 'source-fragment', disposition: 'preserve-as-source' };
    case 'control':
      return { targetClass: 'source-fragment', disposition: 'split-control' };
    case 'machine-ledger':
      return { targetClass: 'external-bound-input', disposition: 'bind-external-input' };
    case 'registry':
    case 'navigation':
    case 'agent-projection':
      return { targetClass: 'generated-projection', disposition: 'derive-projection' };
    default:
      return { targetClass: 'source-fragment', disposition: 'blocked' };
  }
}

function corpusDigest(entries: readonly DocumentationMigrationCorpusEntry[]): Digest {
  return sha256(entries.map((entry) => ({
    path: entry.path,
    status: entry.status,
    registryId: entry.registryId,
    contentDigest: entry.contentDigest,
    consumerRefs: entry.consumerRefs,
    localConsumerCoverageStatus: entry.localConsumerCoverageStatus,
    externalConsumerStatus: entry.externalConsumerStatus
  }))) as Digest;
}

function frontierDigest(frontier: readonly DocumentationMigrationFrontier[]): Digest {
  return sha256(frontier) as Digest;
}

function preservationDigest(preservation: readonly DocumentationMigrationPreservationEntry[]): Digest {
  return sha256(preservation) as Digest;
}

export function compileDocumentationMigrationDesign(input: Readonly<{
  readonly registry: DocumentationAuthorityRegistry;
  readonly registryDigest: Digest;
  readonly targetContractDigest: Digest;
  readonly corpus: readonly DocumentationMigrationCorpusEntry[];
}>): DocumentationMigrationDesign {
  const registryDigest = digest(input.registryDigest, 'registryDigest');
  const targetContractDigest = digest(input.targetContractDigest, 'targetContractDigest');
  const expectedRegistryDigest = sha256(input.registry) as Digest;
  if (registryDigest !== expectedRegistryDigest) {
    fail('registryDigest does not match the supplied registry content.');
  }
  if (targetContractDigest !== DOCUMENTATION_MIGRATION_TARGET_CONTRACT_DIGEST) {
    fail('targetContractDigest does not match the canonical target contract.');
  }
  const corpus = input.corpus.map(normalizeCorpusEntry);
  assertSortedEntries(corpus);

  const registryById = new Map<string, DocumentationAuthorityRecord>();
  const registryPaths = new Set<string>();
  for (const record of input.registry.documents) {
    if (registryById.has(record.id)) fail(`registry contains duplicate id ${record.id}.`);
    if (registryPaths.has(record.path)) fail(`registry contains duplicate path ${record.path}.`);
    registryById.set(record.id, record);
    registryPaths.add(record.path);
  }
  const corpusByPath = new Map(corpus.map((entry) => [entry.path, entry] as const));
  const frontier: DocumentationMigrationFrontier[] = [];
  const preservation: DocumentationMigrationPreservationEntry[] = [];

  for (const record of input.registry.documents) {
    const entry = corpusByPath.get(record.path);
    const current = entry === undefined
      ? Object.freeze({
        path: record.path,
        status: 'missing' as const,
        registryId: record.id,
        contentDigest: null,
        consumerRefs: Object.freeze([]) as readonly string[],
        localConsumerCoverageStatus: 'unknown' as const,
        externalConsumerStatus: 'unknown' as const
      })
      : entry;
    if (entry !== undefined) {
      if (entry.status !== 'tracked-registered' && entry.status !== 'missing') {
        fail(`${record.path} must be represented as tracked-registered or missing corpus entry.`);
      }
      recordForCorpusEntry(current, registryById);
    }

    const target = targetForRecord(record);
    const codes: DocumentationMigrationFrontierCode[] = [];
    if (current.status === 'missing') {
      codes.push('missing-current-source');
      frontier.push({
        code: 'missing-current-source',
        subjectRef: record.id,
        ownerRef: record.id,
        consumerRefsDigest: current.consumerRefs.length === 0
          ? null
          : sha256(current.consumerRefs) as Digest,
        detail: 'registered current source is absent from the exact corpus.'
      });
    }
    if (record.kind === 'authority') {
      codes.push('authority-role-adoption-required');
      frontier.push({
        code: 'authority-role-adoption-required',
        subjectRef: record.id,
        ownerRef: record.id,
        consumerRefsDigest: sha256(current.consumerRefs) as Digest,
        detail: 'authority contract versus topic must be adopted by the domain owner; kind alone cannot decide it.'
      });
    }
    if (record.kind === 'control') {
      codes.push('control-state-separation-required');
      frontier.push({
        code: 'control-state-separation-required',
        subjectRef: record.id,
        ownerRef: record.id,
        consumerRefsDigest: sha256(current.consumerRefs) as Digest,
        detail: 'repository declaration and runtime state require separate owner contracts.'
      });
    }
    if (record.kind === 'registry') {
      codes.push('current-registry-cutover-required');
      frontier.push({
        code: 'current-registry-cutover-required',
        subjectRef: record.id,
        ownerRef: record.id,
        consumerRefsDigest: sha256(current.consumerRefs) as Digest,
        detail: 'generated index must be activated and every registry consumer rewritten before retirement.'
      });
    }
    if (current.externalConsumerStatus === 'unknown') {
      codes.push('external-consumer-unknown');
      frontier.push({
        code: 'external-consumer-unknown',
        subjectRef: record.id,
        ownerRef: record.id,
        consumerRefsDigest: sha256(current.consumerRefs) as Digest,
        detail: 'repository-local consumer-zero cannot prove that no external contract exists.'
      });
    }
    if (current.localConsumerCoverageStatus === 'unknown') {
      codes.push('local-consumer-coverage-unknown');
      frontier.push({
        code: 'local-consumer-coverage-unknown',
        subjectRef: record.id,
        ownerRef: record.id,
        consumerRefsDigest: sha256(current.consumerRefs) as Digest,
        detail: 'observed literal references do not prove that the local consumer universe is complete.'
      });
    }
    if (current.consumerRefs.length > 0) {
      codes.push('consumer-rewrite-required');
      frontier.push({
        code: 'consumer-rewrite-required',
        subjectRef: record.id,
        ownerRef: record.id,
        consumerRefsDigest: sha256(current.consumerRefs) as Digest,
        detail: 'all recorded consumers must be recompiled against target semantic refs and generated addresses.'
      });
    }

    preservation.push({
      currentId: record.id,
      currentPath: record.path,
      currentKind: record.kind,
      currentDigest: current.contentDigest,
      targetClass: target.targetClass,
      disposition: target.disposition,
      consumerRefs: current.consumerRefs,
      consumerRefsDigest: sha256(current.consumerRefs) as Digest,
      frontierCodes: Object.freeze([...new Set(codes)].sort(compareCodeUnits) as DocumentationMigrationFrontierCode[])
    });
  }

  for (const entry of corpus) {
    if (entry.status === 'tracked-registered') {
      recordForCorpusEntry(entry, registryById);
      continue;
    }
    if (entry.status === 'missing') {
      recordForCorpusEntry(entry, registryById);
      continue;
    }
    if (entry.status === 'tracked-non-active') {
      preservation.push({
        currentId: null,
        currentPath: entry.path,
        currentKind: 'non-active',
        currentDigest: entry.contentDigest,
        targetClass: 'runtime-artifact',
        disposition: 'relocate-runtime-artifact',
        consumerRefs: entry.consumerRefs,
        consumerRefsDigest: sha256(entry.consumerRefs) as Digest,
        frontierCodes: Object.freeze([
          ...(entry.consumerRefs.length > 0 ? ['consumer-rewrite-required' as const] : []),
          ...(entry.externalConsumerStatus === 'unknown'
            ? ['external-consumer-unknown' as const]
            : []),
          ...(entry.localConsumerCoverageStatus === 'unknown'
            ? ['local-consumer-coverage-unknown' as const]
            : [])
        ])
      });
      if (entry.consumerRefs.length > 0) {
        frontier.push({
          code: 'consumer-rewrite-required',
          subjectRef: entry.path,
          ownerRef: null,
          consumerRefsDigest: sha256(entry.consumerRefs) as Digest,
          detail: 'non-active artifact consumers must be recompiled against its runtime-artifact relocation.'
        });
      }
      if (entry.externalConsumerStatus === 'unknown') {
        frontier.push({
          code: 'external-consumer-unknown',
          subjectRef: entry.path,
          ownerRef: null,
          consumerRefsDigest: sha256(entry.consumerRefs) as Digest,
          detail: 'non-active artifact still needs external consumer classification before relocation.'
        });
      }
      if (entry.localConsumerCoverageStatus === 'unknown') {
        frontier.push({
          code: 'local-consumer-coverage-unknown',
          subjectRef: entry.path,
          ownerRef: null,
          consumerRefsDigest: sha256(entry.consumerRefs) as Digest,
          detail: 'observed literal references do not prove that the local consumer universe is complete.'
        });
      }
      continue;
    }
    const code: DocumentationMigrationFrontierCode = 'unclassified-current-source';
    preservation.push({
      currentId: null,
      currentPath: entry.path,
      currentKind: 'unclassified',
      currentDigest: entry.contentDigest,
      targetClass: 'source-fragment',
      disposition: 'blocked',
      consumerRefs: entry.consumerRefs,
      consumerRefsDigest: sha256(entry.consumerRefs) as Digest,
      frontierCodes: Object.freeze([
        code,
        ...(entry.localConsumerCoverageStatus === 'unknown'
          ? ['local-consumer-coverage-unknown' as const]
          : [])
      ].sort(compareCodeUnits) as DocumentationMigrationFrontierCode[])
    });
    frontier.push({
      code,
      subjectRef: entry.path,
      ownerRef: null,
      consumerRefsDigest: sha256(entry.consumerRefs) as Digest,
      detail: 'tracked corpus entry is not registered and has no typed non-active classification.'
    });
    if (entry.externalConsumerStatus === 'unknown') {
      frontier.push({
        code: 'external-consumer-unknown',
        subjectRef: entry.path,
        ownerRef: null,
        consumerRefsDigest: sha256(entry.consumerRefs) as Digest,
        detail: 'unclassified artifact still has an unresolved external consumer boundary.'
      });
    }
    if (entry.localConsumerCoverageStatus === 'unknown') {
      frontier.push({
        code: 'local-consumer-coverage-unknown',
        subjectRef: entry.path,
        ownerRef: null,
        consumerRefsDigest: sha256(entry.consumerRefs) as Digest,
        detail: 'unclassified artifact has no complete local consumer census.'
      });
    }
  }

  const normalizedPreservation = Object.freeze(
    [...preservation].sort((left, right) => compareCodeUnits(left.currentPath, right.currentPath))
  );
  const normalizedFrontier = Object.freeze(
    [...frontier].sort((left, right) => compareCodeUnits(
      `${left.subjectRef}:${left.code}`,
      `${right.subjectRef}:${right.code}`
    ))
  );
  const currentCorpusDigest = corpusDigest(corpus);
  const status = normalizedFrontier.length === 0 ? 'ready' : 'blocked';
  const designDigest = sha256({
    schema: DOCUMENTATION_MIGRATION_DESIGN_SCHEMA,
    currentRegistryDigest: registryDigest,
    currentCorpusDigest,
    targetContractDigest,
    preservationDigest: preservationDigest(normalizedPreservation),
    frontierDigest: frontierDigest(normalizedFrontier),
    status
  }) as Digest;
  return deepFreeze({
    schema: DOCUMENTATION_MIGRATION_DESIGN_SCHEMA,
    currentRegistryDigest: registryDigest,
    currentCorpusDigest,
    targetContractDigest,
    preservation: normalizedPreservation,
    frontier: normalizedFrontier,
    status,
    designDigest
  });
}

export function encodeDocumentationMigrationDesign(
  design: DocumentationMigrationDesign
): string {
  const encoded = canonicalJson(design);
  try {
    const serialized = JSON.stringify(encoded);
    if (serialized === undefined) fail('design canonical encoding produced no JSON value.');
    return serialized;
  } catch (error) {
    fail(`design canonical encoding failed: ${String(error)}`);
  }
}
