import path from 'node:path';
import {
  canonicalJson,
  deepFreeze
} from '../../../../../contracts/canonical.ts';
import {
  FailureError
} from '../../../../../contracts/failure.ts';
import { formatJsonFile } from "../../../../../contracts/json-text.ts";
import {
  generatedStateDigest
} from '../../../../runtime-state/generated-state/contract.ts';
import {
  DEPENDENCY_TRANSITION_SCHEMA,
  hasExactObjectKeys,
  isCanonicalAbsolutePath,
  isCanonicalGeneratedStatePhysicalIdentity,
  isSha256Digest,
  runtimeDependencySourceGenerationEpoch,
  type DependencyTransitionJournal,
  type DependencyTransitionSlot,
  type DependencyTransitionUnsigned,
  type RuntimeDependencySourceGeneration
} from './contract.ts';

export const DEPENDENCY_TRANSITION_POINTER_SCHEMA = 'sec-dependency-transition-pointer-v2' as const;

export function dependencyTransitionDigestWithoutRecord(
  record: DependencyTransitionUnsigned
): `sha256:${string}` {
  return generatedStateDigest(canonicalJson(record));
}

export function dependencyTransitionRecordBytes(record: DependencyTransitionJournal): Buffer {
  // Journal records are immutable evidence.  Their digest is over canonical
  // JSON and the bytes published under the digest-named path must use that
  // same canonical ordering; a merely parseable pretty-printed variant is a
  // collision, not a record we may adopt.
  return Buffer.from(formatJsonFile(canonicalJson(record)), 'utf8');
}

const DEPENDENCY_TRANSITION_RECORD_KEYS = Object.freeze([
  'attemptNonce', 'backup', 'destination', 'durability', 'failure',
  'kind', 'operationKey', 'ownerRoot', 'ownerRootPhysical', 'phase',
  'preimage', 'previousRecordDigest', 'recordDigest', 'schema',
  'sequence', 'sourceGeneration', 'stage', 'stageRoot'
]);

const DEPENDENCY_TRANSITION_POINTER_KEYS = Object.freeze(['recordDigest', 'schema']);

const DEPENDENCY_TRANSITION_SLOT_KEYS = Object.freeze([
  'bindingDigest', 'kind', 'linkTarget', 'path', 'physical'
]);

export const RUNTIME_SOURCE_GENERATION_KEYS = Object.freeze([
  'bindingDigest', 'epoch', 'ownerRoot', 'ownerRootPhysical', 'physical',
  'sourcePath', 'treeDigest', 'treeEntryCount', 'schema'
]);

export function isCanonicalDependencyTransitionSlot(value: unknown): value is DependencyTransitionSlot {
  if (!hasExactObjectKeys(value, DEPENDENCY_TRANSITION_SLOT_KEYS) ||
      !isCanonicalAbsolutePath(value.path) ||
      !(['absent', 'directory', 'link'] as readonly string[]).includes(value.kind as string) ||
      (value.bindingDigest !== null && !isSha256Digest(value.bindingDigest)) ||
      (value.linkTarget !== null && typeof value.linkTarget !== 'string')) return false;
  if (value.kind === 'absent') {
    return value.physical === null && value.linkTarget === null && value.bindingDigest === null;
  }
  if (!isCanonicalGeneratedStatePhysicalIdentity(value.physical)) return false;
  return value.kind === 'link' ? value.linkTarget !== null : value.linkTarget === null;
}

export function isCanonicalRuntimeDependencySourceGeneration(
  value: unknown
): value is RuntimeDependencySourceGeneration {
  if (!hasExactObjectKeys(value, RUNTIME_SOURCE_GENERATION_KEYS)) return false;
  if (value.schema !== 'sec-runtime-dependency-source-generation-v1' ||
      !isCanonicalAbsolutePath(value.ownerRoot) ||
      !isCanonicalAbsolutePath(value.sourcePath) ||
      !isCanonicalGeneratedStatePhysicalIdentity(value.ownerRootPhysical) ||
      !isCanonicalGeneratedStatePhysicalIdentity(value.physical) ||
      !isSha256Digest(value.bindingDigest) || !isSha256Digest(value.treeDigest) ||
      !Number.isSafeInteger(value.treeEntryCount) || typeof value.treeEntryCount !== 'number' ||
      value.treeEntryCount < 0 || !isSha256Digest(value.epoch)) return false;
  return runtimeDependencySourceGenerationEpoch({
    ownerRoot: value.ownerRoot,
    ownerRootPhysical: value.ownerRootPhysical,
    physical: value.physical,
    bindingDigest: value.bindingDigest,
    treeDigest: value.treeDigest,
    treeEntryCount: value.treeEntryCount
  }) === value.epoch;
}

function isCanonicalDescendantPath(ownerRoot: string, candidate: string): boolean {
  const relative = path.relative(ownerRoot, candidate);
  return relative.length > 0 && relative !== '..' && !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
}

export function parseDependencyTransitionRecord(
  bytes: Uint8Array,
  expectedName?: string
): DependencyTransitionJournal {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch (error) {
    throw new FailureError('RUNTIME-DEPS-002', 'Dependency transition journal record is not JSON', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (!hasExactObjectKeys(value, DEPENDENCY_TRANSITION_RECORD_KEYS)) {
    throw new FailureError('RUNTIME-DEPS-002', 'Dependency transition journal record has noncanonical keys');
  }
  const record = value as unknown as DependencyTransitionJournal;
  if (record.schema !== DEPENDENCY_TRANSITION_SCHEMA || !isSha256Digest(record.recordDigest) ||
      !isSha256Digest(record.previousRecordDigest) && record.previousRecordDigest !== null ||
      !Number.isSafeInteger(record.sequence) || record.sequence < 1 ||
      !isSha256Digest(record.operationKey) || typeof record.attemptNonce !== 'string' ||
      record.attemptNonce.length === 0 || !(['compiler-generation', 'compiler-local-locator', 'compiler-locator', 'compiler-bridge', 'project-runtime-bridge', 'runtime-projection', 'project-projection'] as readonly string[]).includes(record.kind) ||
      !isCanonicalAbsolutePath(record.ownerRoot) ||
      !isCanonicalGeneratedStatePhysicalIdentity(record.ownerRootPhysical) ||
      !isCanonicalDependencyTransitionSlot(record.destination) ||
      !isCanonicalDependencyTransitionSlot(record.preimage) ||
      (record.stage !== null && !isCanonicalDependencyTransitionSlot(record.stage)) ||
      (record.stageRoot !== null && !isCanonicalDependencyTransitionSlot(record.stageRoot)) ||
      (record.backup !== null && !isCanonicalDependencyTransitionSlot(record.backup)) ||
      !isCanonicalRuntimeDependencySourceGeneration(record.sourceGeneration) ||
      !(['prepared', 'backed-up', 'published', 'binding-validated', 'stamp-readback', 'complete', 'rolled-back', 'recovery-required'] as readonly string[]).includes(record.phase) ||
      !(['known', 'unknown'] as readonly string[]).includes(record.durability) ||
      (record.failure !== null && (!hasExactObjectKeys(record.failure, ['code', 'message']) ||
        typeof record.failure.code !== 'string' || record.failure.code.length === 0 ||
        typeof record.failure.message !== 'string' || record.failure.message.length === 0))) {
    throw new FailureError('RUNTIME-DEPS-002', 'Dependency transition journal record fields are invalid');
  }
  if (record.destination.path !== record.preimage.path ||
      (record.stage === null) !== (record.stageRoot === null) ||
      (record.stage !== null && record.stageRoot !== null && (
        path.dirname(record.stage.path) !== record.stageRoot.path ||
        (record.stageRoot.kind === 'absent' && record.stage.kind !== 'absent') ||
        (record.stageRoot.kind !== 'directory' && record.stageRoot.kind !== 'absent')
      )) ||
      (record.backup !== null && path.dirname(record.backup.path) !==
        path.join(record.ownerRoot, '.tmp', 'dependency-installs', 'compiler-backups'))) {
    throw new FailureError('RUNTIME-DEPS-002', 'Dependency transition journal topology is noncanonical');
  }
  if (record.kind === 'compiler-bridge' && (
    record.preimage.kind !== 'absent' ||
    record.stage !== null ||
    record.stageRoot !== null ||
    record.backup !== null ||
    record.sourceGeneration.ownerRoot !== record.ownerRoot ||
    !isCanonicalDescendantPath(record.ownerRoot, record.sourceGeneration.sourcePath) ||
    path.resolve(record.destination.path) === path.resolve(record.sourceGeneration.sourcePath)
  )) {
    throw new FailureError('RUNTIME-DEPS-002', 'Compiler bridge transition journal topology is noncanonical');
  }
  if (record.kind === 'project-runtime-bridge' && (
    record.preimage.kind !== 'absent' ||
    record.stage !== null ||
    record.stageRoot !== null ||
    record.backup !== null ||
    path.dirname(record.destination.path) !== record.ownerRoot ||
    path.basename(record.destination.path) !== 'node_modules' ||
    record.sourceGeneration.ownerRoot === record.ownerRoot ||
    !isCanonicalDescendantPath(
      record.sourceGeneration.ownerRoot,
      record.sourceGeneration.sourcePath
    ) ||
    path.resolve(record.destination.path) === path.resolve(record.sourceGeneration.sourcePath)
  )) {
    throw new FailureError('RUNTIME-DEPS-002', 'Project runtime bridge transition journal topology is noncanonical');
  }
  if (expectedName !== undefined && expectedName !== transitionRecordName(record.recordDigest)) {
    throw new FailureError('RUNTIME-DEPS-002', 'Dependency transition journal filename does not match its digest');
  }
  const { recordDigest: _recordDigest, ...unsigned } = record;
  if (dependencyTransitionDigestWithoutRecord(unsigned) !== record.recordDigest) {
    throw new FailureError('RUNTIME-DEPS-002', 'Dependency transition journal record digest is invalid');
  }
  if (formatJsonFile(canonicalJson(record)) !== Buffer.from(bytes).toString('utf8')) {
    throw new FailureError('RUNTIME-DEPS-002', 'Dependency transition journal record bytes are not canonical');
  }
  return deepFreeze(record);
}

export function assertDependencyTransitionRecordBytes(bytes: Uint8Array): void {
  parseDependencyTransitionRecord(bytes);
}

export function assertDependencyTransitionPointerBytes(bytes: Uint8Array): void {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch (error) {
    throw new FailureError('RUNTIME-DEPS-002', 'Dependency transition pointer is not JSON', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (!hasExactObjectKeys(value, DEPENDENCY_TRANSITION_POINTER_KEYS)) {
    throw new FailureError('RUNTIME-DEPS-002', 'Dependency transition pointer has noncanonical keys');
  }
  const pointer = value as { schema: string; recordDigest: string };
  if (pointer.schema !== DEPENDENCY_TRANSITION_POINTER_SCHEMA || !isSha256Digest(pointer.recordDigest) ||
      formatJsonFile(canonicalJson(value)) !== Buffer.from(bytes).toString('utf8')) {
    throw new FailureError('RUNTIME-DEPS-002', 'Dependency transition pointer schema is invalid');
  }
}

export function transitionRecordName(digestValue: `sha256:${string}`): string {
  return `record-${digestValue.slice('sha256:'.length)}.json`;
}
