import path from 'node:path';
import {
  canonicalJson,
  compareCodeUnits,
  deepFreeze
} from '../../../../../contracts/canonical.ts';
import { readonlyMapSnapshot } from '../../../../../contracts/collections.ts';
import {
  FailureError
} from '../../../../../contracts/failure.ts';
import { formatJsonFile } from "../../../../../contracts/json-text.ts";
import {
  generatedStateDigest,
  type GeneratedStatePhysicalIdentity
} from '../../../../runtime-state/generated-state/contract.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  inspectNoFollowDirectoryChain,
  inspectNoFollowDirectoryChild,
  inspectNoFollowDirectoryLeaf,
  inspectNoFollowOrdinaryFileEntry,
  type PhysicalDirectoryIdentity,
  scanNoFollowDirectoryTree
} from '../../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  type RuntimeDependencyEffectFenceInput,
  runtimeDependencyEffectFenceOptions,
  type RuntimeDependencyEffectFenceOptions,
  runtimeDependencyOperationEffectFence
} from '../operation-context.ts';
import {
  assertRuntimeDependencyOperationActive,
  type BoundRuntimeDependencyOperationControls,
  runtimeDependencyOperationContext,
  type RuntimeDependencyOperationContext, type RuntimeDependencyOperationControlInput,
  runtimeDependencyOperationControls,
  runtimeDependencyOperationRemainingMs
} from '../operation-controls.ts';
import {
  assertDependencyTransitionRecordBytes,
  dependencyTransitionRecordBytes,
  isCanonicalDependencyTransitionSlot,
  isCanonicalRuntimeDependencySourceGeneration,
  RUNTIME_SOURCE_GENERATION_KEYS,
  transitionRecordName
} from './codec.ts';
import {
  DEPENDENCY_TRANSITION_SCHEMA,
  type DependencyTransitionJournal,
  type DependencyTransitionNamespace,
  generatedStatePhysicalIdentity,
  hasExactObjectKeys,
  isCanonicalAbsolutePath,
  isCanonicalGeneratedStatePhysicalIdentity,
  isSha256Digest,
  type RuntimeDependencySourceGeneration,
  sameGeneratedStateIdentity
} from './contract.ts';
import {
  DEPENDENCY_TRANSITION_RECORD_BYTES_CAPACITY,
  DEPENDENCY_TRANSITION_RECORD_CAPACITY,
  dependencyTransitionLedgerDigest,
  dependencyTransitionNamespacePaths,
  ensureDependencyTransitionNamespace,
  inspectDependencyTransitionNamespace,
  readDependencyTransitionRecordSet,
  readNoFollowDirectNames,
  writeDependencyTransitionPointerCache,
  writeDurableTransitionFile
} from './store.ts';

/**
 * The pre-v2 journal grammar is intentionally kept private to migration.  It
 * is not assignable to the normal reader's record type and is never returned
 * by a production readiness/read path.
 */
type LegacyRuntimeDependencySourceGeneration = Omit<
  RuntimeDependencySourceGeneration,
  'treeDigest' | 'treeEntryCount'
> & Partial<Pick<RuntimeDependencySourceGeneration, 'treeDigest' | 'treeEntryCount'>>;

type LegacyDependencyTransitionJournal = Omit<
  DependencyTransitionJournal,
  'schema' | 'sourceGeneration' | 'stageRoot'
> & {
  readonly schema: typeof DEPENDENCY_TRANSITION_LEGACY_SCHEMA;
  readonly sourceGeneration: Readonly<LegacyRuntimeDependencySourceGeneration>;
};

export const DEPENDENCY_TRANSITION_LEGACY_SCHEMA = 'sec-dependency-transition-journal-v1' as const;

const DEPENDENCY_TRANSITION_MIGRATION_SCHEMA = 'sec-dependency-transition-migration-v1' as const;

export interface DependencyTransitionMigrationIntent {
  readonly schema: typeof DEPENDENCY_TRANSITION_MIGRATION_SCHEMA;
  readonly intentDigest: `sha256:${string}`;
  readonly previousIntentDigest: `sha256:${string}` | null;
  readonly phase: 'prepared' | 'complete';
  readonly ownerRoot: string;
  readonly ownerRootPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly sourceSchema: typeof DEPENDENCY_TRANSITION_LEGACY_SCHEMA;
  readonly sourceJournalRootPath: string;
  readonly sourceJournalRootPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly sourceRecordsRootPath: string;
  readonly sourceRecordsRootPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly sourceLedgerDigest: `sha256:${string}`;
  readonly sourceRecordCount: number;
  readonly targetSchema: typeof DEPENDENCY_TRANSITION_SCHEMA;
  readonly targetJournalRootPath: string;
  readonly targetJournalRootPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly targetRecordsRootPath: string;
  readonly targetRecordsRootPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly targetLedgerDigest: `sha256:${string}`;
  readonly targetRecordCount: number;
}

function dependencyTransitionLegacyNamespacePaths(ownerRoot: string): Readonly<{
  backupRoot: string;
  journalRoot: string;
  recordsRoot: string;
}> {
  const backupRoot = path.join(ownerRoot, '.tmp', 'dependency-installs', 'compiler-backups');
  const journalRoot = path.join(backupRoot, '.dependency-transition-v1');
  return Object.freeze({
    backupRoot,
    journalRoot,
    recordsRoot: path.join(journalRoot, 'records')
  });
}

const DEPENDENCY_TRANSITION_LEGACY_RECORD_KEYS = Object.freeze([
  'attemptNonce', 'backup', 'destination', 'durability', 'failure',
  'kind', 'operationKey', 'ownerRoot', 'ownerRootPhysical', 'phase',
  'preimage', 'previousRecordDigest', 'recordDigest', 'schema',
  'sequence', 'sourceGeneration', 'stage'
]);

const DEPENDENCY_TRANSITION_MIGRATION_KEYS = Object.freeze([
  'intentDigest', 'ownerRoot', 'ownerRootPhysical', 'phase',
  'previousIntentDigest', 'schema', 'sourceJournalRootPath',
  'sourceJournalRootPhysical', 'sourceLedgerDigest', 'sourceRecordCount',
  'sourceRecordsRootPath', 'sourceRecordsRootPhysical', 'targetJournalRootPath', 'targetJournalRootPhysical',
  'targetLedgerDigest', 'targetRecordCount', 'targetRecordsRootPath',
  'targetRecordsRootPhysical', 'targetSchema', 'sourceSchema'
]);

const LEGACY_RUNTIME_SOURCE_GENERATION_KEYS = Object.freeze([
  'bindingDigest', 'epoch', 'ownerRoot', 'ownerRootPhysical', 'physical',
  'sourcePath', 'schema'
]);

function isCanonicalLegacyRuntimeDependencySourceGeneration(
  value: unknown
): value is LegacyRuntimeDependencySourceGeneration {
  if (hasExactObjectKeys(value, RUNTIME_SOURCE_GENERATION_KEYS)) {
    return isCanonicalRuntimeDependencySourceGeneration(value);
  }
  if (!hasExactObjectKeys(value, LEGACY_RUNTIME_SOURCE_GENERATION_KEYS) ||
      value.schema !== 'sec-runtime-dependency-source-generation-v1' ||
      !isCanonicalAbsolutePath(value.ownerRoot) ||
      !isCanonicalAbsolutePath(value.sourcePath) ||
      !isCanonicalGeneratedStatePhysicalIdentity(value.ownerRootPhysical) ||
      !isCanonicalGeneratedStatePhysicalIdentity(value.physical) ||
      !isSha256Digest(value.bindingDigest) || !isSha256Digest(value.epoch)) return false;
  return true;
}

/**
 * Parse the pre-stageRoot journal grammar only while performing the one-way
 * v1 -> v2 migration.  This deliberately uses the old insertion-order digest
 * and byte representation; accepting those bytes from the normal reader would
 * turn a schema migration into an accidental dual-read compatibility path.
 */
function parseLegacyDependencyTransitionRecord(
  bytes: Uint8Array,
  expectedName?: string
): LegacyDependencyTransitionJournal {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch (error) {
    throw new FailureError('RUNTIME-DEPS-002', 'Legacy dependency transition journal record is not JSON', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (!hasExactObjectKeys(value, DEPENDENCY_TRANSITION_LEGACY_RECORD_KEYS)) {
    throw new FailureError('RUNTIME-DEPS-002', 'Legacy dependency transition journal record has noncanonical keys');
  }
  const record = value as unknown as LegacyDependencyTransitionJournal;
  if (record.schema !== DEPENDENCY_TRANSITION_LEGACY_SCHEMA || !isSha256Digest(record.recordDigest) ||
      (!isSha256Digest(record.previousRecordDigest) && record.previousRecordDigest !== null) ||
      !Number.isSafeInteger(record.sequence) || record.sequence < 1 ||
      !isSha256Digest(record.operationKey) || typeof record.attemptNonce !== 'string' ||
      record.attemptNonce.length === 0 ||
      !(['compiler-generation', 'compiler-local-locator', 'compiler-locator', 'compiler-bridge', 'runtime-projection', 'project-projection'] as readonly string[]).includes(record.kind) ||
      !isCanonicalAbsolutePath(record.ownerRoot) ||
      !isCanonicalGeneratedStatePhysicalIdentity(record.ownerRootPhysical) ||
      !isCanonicalDependencyTransitionSlot(record.destination) ||
      !isCanonicalDependencyTransitionSlot(record.preimage) ||
      (record.stage !== null && !isCanonicalDependencyTransitionSlot(record.stage)) ||
      (record.backup !== null && !isCanonicalDependencyTransitionSlot(record.backup)) ||
      !isCanonicalLegacyRuntimeDependencySourceGeneration(record.sourceGeneration) ||
      !(['prepared', 'backed-up', 'published', 'binding-validated', 'stamp-readback', 'complete', 'rolled-back', 'recovery-required'] as readonly string[]).includes(record.phase) ||
      !(['known', 'unknown'] as readonly string[]).includes(record.durability) ||
      (record.failure !== null && (!hasExactObjectKeys(record.failure, ['code', 'message']) ||
        typeof record.failure.code !== 'string' || record.failure.code.length === 0 ||
        typeof record.failure.message !== 'string' || record.failure.message.length === 0))) {
    throw new FailureError('RUNTIME-DEPS-002', 'Legacy dependency transition journal record fields are invalid');
  }
  if (record.destination.path !== record.preimage.path ||
      (record.backup !== null && path.dirname(record.backup.path) !==
        path.join(record.ownerRoot, '.tmp', 'dependency-installs', 'compiler-backups')) ||
      (record.kind === 'compiler-bridge' && (
        record.preimage.kind !== 'absent' ||
        record.stage !== null ||
        record.backup !== null ||
        record.sourceGeneration.ownerRoot !== path.dirname(record.sourceGeneration.sourcePath) ||
        path.basename(record.sourceGeneration.sourcePath).toLocaleLowerCase('en-US') !== 'node_modules' ||
        path.resolve(record.destination.path) === path.resolve(record.sourceGeneration.sourcePath)
      ))) {
    throw new FailureError('RUNTIME-DEPS-002', 'Legacy dependency transition journal topology is noncanonical');
  }
  if (expectedName !== undefined && expectedName !== transitionRecordName(record.recordDigest)) {
    throw new FailureError('RUNTIME-DEPS-002', 'Legacy dependency transition journal filename does not match its digest');
  }
  const { recordDigest: _recordDigest, ...unsigned } = record;
  if (generatedStateDigest(unsigned) !== record.recordDigest) {
    throw new FailureError('RUNTIME-DEPS-002', 'Legacy dependency transition journal record digest is invalid');
  }
  if (formatJsonFile(record) !== Buffer.from(bytes).toString('utf8')) {
    throw new FailureError('RUNTIME-DEPS-002', 'Legacy dependency transition journal record bytes are not canonical');
  }
  return deepFreeze(record);
}

function dependencyTransitionMigrationIntentStableDigest(
  intent: Omit<DependencyTransitionMigrationIntent, 'intentDigest' | 'schema'>
): `sha256:${string}` {
  return generatedStateDigest(canonicalJson(Object.freeze({
    schema: DEPENDENCY_TRANSITION_MIGRATION_SCHEMA,
    previousIntentDigest: intent.previousIntentDigest,
    phase: intent.phase,
    ownerRoot: intent.ownerRoot,
    ownerRootPhysical: intent.ownerRootPhysical,
    sourceSchema: intent.sourceSchema,
    sourceJournalRootPath: intent.sourceJournalRootPath,
    sourceJournalRootPhysical: intent.sourceJournalRootPhysical,
    sourceRecordsRootPath: intent.sourceRecordsRootPath,
    sourceRecordsRootPhysical: intent.sourceRecordsRootPhysical,
    sourceLedgerDigest: intent.sourceLedgerDigest,
    sourceRecordCount: intent.sourceRecordCount,
    targetSchema: intent.targetSchema,
    targetJournalRootPath: intent.targetJournalRootPath,
    targetJournalRootPhysical: intent.targetJournalRootPhysical,
    targetRecordsRootPath: intent.targetRecordsRootPath,
    targetRecordsRootPhysical: intent.targetRecordsRootPhysical,
    targetLedgerDigest: intent.targetLedgerDigest,
    targetRecordCount: intent.targetRecordCount
  })));
}

function dependencyTransitionMigrationIntentFileName(
  intentDigest: `sha256:${string}`,
  phase: 'prepared' | 'complete'
): string {
  return `migration-${intentDigest.slice('sha256:'.length)}-${phase}.json`;
}

function dependencyTransitionMigrationIntentBytes(
  intent: DependencyTransitionMigrationIntent
): Buffer {
  return Buffer.from(formatJsonFile(canonicalJson(intent)), 'utf8');
}

function parseDependencyTransitionMigrationIntent(
  bytes: Uint8Array,
  expectedName?: string
): DependencyTransitionMigrationIntent {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch (error) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition migration intent is not JSON', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (!hasExactObjectKeys(value, DEPENDENCY_TRANSITION_MIGRATION_KEYS)) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition migration intent has noncanonical keys');
  }
  const intent = value as unknown as DependencyTransitionMigrationIntent;
  if (intent.schema !== DEPENDENCY_TRANSITION_MIGRATION_SCHEMA ||
      !isSha256Digest(intent.intentDigest) ||
      (intent.previousIntentDigest !== null && !isSha256Digest(intent.previousIntentDigest)) ||
      !(['prepared', 'complete'] as readonly string[]).includes(intent.phase) ||
      !isCanonicalAbsolutePath(intent.ownerRoot) ||
      !isCanonicalGeneratedStatePhysicalIdentity(intent.ownerRootPhysical) ||
      intent.sourceSchema !== DEPENDENCY_TRANSITION_LEGACY_SCHEMA ||
      !isCanonicalAbsolutePath(intent.sourceJournalRootPath) ||
      !isCanonicalGeneratedStatePhysicalIdentity(intent.sourceJournalRootPhysical) ||
      !isCanonicalAbsolutePath(intent.sourceRecordsRootPath) ||
      !isCanonicalGeneratedStatePhysicalIdentity(intent.sourceRecordsRootPhysical) ||
      !isSha256Digest(intent.sourceLedgerDigest) ||
      !Number.isSafeInteger(intent.sourceRecordCount) || intent.sourceRecordCount < 1 ||
      intent.sourceRecordCount > DEPENDENCY_TRANSITION_RECORD_CAPACITY ||
      intent.targetSchema !== DEPENDENCY_TRANSITION_SCHEMA ||
      !isCanonicalAbsolutePath(intent.targetJournalRootPath) ||
      !isCanonicalGeneratedStatePhysicalIdentity(intent.targetJournalRootPhysical) ||
      !isCanonicalAbsolutePath(intent.targetRecordsRootPath) ||
      !isCanonicalGeneratedStatePhysicalIdentity(intent.targetRecordsRootPhysical) ||
      !isSha256Digest(intent.targetLedgerDigest) ||
      !Number.isSafeInteger(intent.targetRecordCount) || intent.targetRecordCount < 0 ||
      intent.targetRecordCount > DEPENDENCY_TRANSITION_RECORD_CAPACITY ||
      (intent.phase === 'prepared' && intent.previousIntentDigest !== null) ||
      (intent.phase === 'complete' && intent.previousIntentDigest === null) ||
      dependencyTransitionMigrationIntentStableDigest(intent) !== intent.intentDigest) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition migration intent fields are invalid');
  }
  const legacyPaths = dependencyTransitionLegacyNamespacePaths(intent.ownerRoot);
  const targetPaths = dependencyTransitionNamespacePaths(intent.ownerRoot);
  if (path.resolve(intent.sourceJournalRootPath) !== path.resolve(legacyPaths.journalRoot) ||
      path.resolve(intent.sourceRecordsRootPath) !== path.resolve(legacyPaths.recordsRoot) ||
      path.dirname(intent.sourceRecordsRootPath) !== intent.sourceJournalRootPath ||
      path.resolve(intent.targetJournalRootPath) !== path.resolve(targetPaths.journalRoot) ||
      path.resolve(intent.targetRecordsRootPath) !== path.resolve(targetPaths.recordsRoot) ||
      path.dirname(intent.targetRecordsRootPath) !== intent.targetJournalRootPath ||
      expectedName !== undefined && expectedName !== dependencyTransitionMigrationIntentFileName(
        intent.intentDigest,
        intent.phase
      )) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition migration intent topology is noncanonical');
  }
  if (formatJsonFile(canonicalJson(intent)) !== Buffer.from(bytes).toString('utf8')) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition migration intent bytes are not canonical');
  }
  return deepFreeze(intent);
}

function assertDependencyTransitionMigrationIntentBytes(bytes: Uint8Array): void {
  parseDependencyTransitionMigrationIntent(bytes);
}

/**
 * Inspect the retired v1 namespace without creating any directory and without
 * treating its records as current authority.  The migration owner uses this
 * physical snapshot as its source preimage; every normal reader ignores this
 * namespace except to report that an explicit migration is required.
 */
export function inspectLegacyDependencyTransitionNamespace(
  ownerRoot: string
): DependencyTransitionNamespace | null {
  const owner = inspectNoFollowDirectoryChain(ownerRoot, 'Legacy dependency transition owner root').target;
  const paths = dependencyTransitionLegacyNamespacePaths(owner.path);
  const temporaryRoot = inspectNoFollowDirectoryLeaf(
    owner,
    '.tmp',
    'Legacy dependency transition temporary root'
  );
  if (temporaryRoot === null) return null;
  const installsRoot = inspectNoFollowDirectoryChild(
    temporaryRoot,
    'dependency-installs',
    'Legacy dependency transition installs root'
  );
  if (installsRoot === null) return null;
  const backupRoot = inspectNoFollowDirectoryChild(
    installsRoot,
    'compiler-backups',
    'Legacy dependency transition backup root'
  );
  if (backupRoot === null) return null;
  const journalRoot = inspectNoFollowDirectoryLeaf(
    backupRoot,
    '.dependency-transition-v1',
    'Legacy dependency transition journal root'
  );
  if (journalRoot === null) return null;
  const recordsRoot = inspectNoFollowDirectoryChild(
    journalRoot,
    'records',
    'Legacy dependency transition records root'
  );
  if (recordsRoot === null) {
    throw new FailureError('RUNTIME-DEPS-004', 'Legacy dependency transition journal is present without its records root');
  }
  if (paths.backupRoot !== backupRoot.path || paths.journalRoot !== journalRoot.path ||
      paths.recordsRoot !== recordsRoot.path) {
    throw new FailureError('RUNTIME-DEPS-002', 'Legacy dependency transition namespace path normalization changed');
  }
  return Object.freeze({
    ownerRoot: owner,
    backupRoot,
    journalRoot,
    recordsRoot,
    rolloversRoot: null
  });
}

type LegacyDependencyTransitionRecordSet = Readonly<{
  records: ReadonlyMap<`sha256:${string}`, LegacyDependencyTransitionJournal>;
  ledgerDigest: `sha256:${string}`;
  recordsRootPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  chains: readonly (readonly LegacyDependencyTransitionJournal[])[];
}>;

/**
 * Validate one legacy records root as a forest of operation-local chains.  The
 * old writer allowed several completed operation chains to share one root;
 * migration canonicalizes that forest into one v2 predecessor chain.  A
 * missing predecessor, duplicate sequence, fork, foreign owner, or digest
 * mismatch is a source-authority failure and therefore happens before any v2
 * namespace effect.
 */
function readLegacyDependencyTransitionRecordSet(
  recordsRoot: PhysicalDirectoryIdentity,
  ownerRoot: string,
  ownerRootPhysical: Readonly<GeneratedStatePhysicalIdentity>,
  operation: RuntimeDependencyOperationContext,
  label: string
): LegacyDependencyTransitionRecordSet {
  assertRuntimeDependencyOperationActive(operation, `${label} census admission`);
  const before = assertSameNoFollowDirectoryIdentity(recordsRoot, `${label} before census`).target;
  const census = scanNoFollowDirectoryTree(before, {
    deadlineAtMs: operation.deadlineAtMonotonicMs,
    maximumEntries: DEPENDENCY_TRANSITION_RECORD_CAPACITY,
    maximumBytes: DEPENDENCY_TRANSITION_RECORD_BYTES_CAPACITY
  });
  const records = new Map<`sha256:${string}`, LegacyDependencyTransitionJournal>();
  for (const entry of census) {
    assertRuntimeDependencyOperationActive(operation, `${label} read deadline`);
    if (entry.kind !== 'file' || !/^record-[0-9a-f]{64}\.json$/u.test(entry.relativePath)) {
      throw new FailureError('RUNTIME-DEPS-002', `${label} contains an unknown physical entry`);
    }
    if (entry.bytes === null) {
      throw new FailureError('RUNTIME-DEPS-002', `${label} record disappeared during census`);
    }
    const record = parseLegacyDependencyTransitionRecord(entry.bytes, entry.relativePath);
    if (record.ownerRoot !== ownerRoot ||
        !sameGeneratedStateIdentity(record.ownerRootPhysical, ownerRootPhysical)) {
      throw new FailureError('RUNTIME-DEPS-002', `${label} record belongs to a foreign owner root or physical epoch`);
    }
    if (records.has(record.recordDigest)) {
      throw new FailureError('RUNTIME-DEPS-002', `${label} record digest is duplicated`);
    }
    records.set(record.recordDigest, record);
  }
  const after = assertSameNoFollowDirectoryIdentity(recordsRoot, `${label} after census`).target;
  if (!sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(before),
    generatedStatePhysicalIdentity(after)
  )) {
    throw new FailureError('RUNTIME-DEPS-002', `${label} identity changed during census`);
  }
  if (records.size === 0) {
    throw new FailureError('RUNTIME-DEPS-004', `${label} has no legacy records to migrate`);
  }

  const grouped = new Map<`sha256:${string}`, LegacyDependencyTransitionJournal[]>();
  const children = new Map<`sha256:${string}`, `sha256:${string}`>();
  for (const record of records.values()) {
    assertRuntimeDependencyOperationActive(operation, `${label} grouping`);
    const chain = grouped.get(record.operationKey);
    if (chain === undefined) grouped.set(record.operationKey, [record]);
    else chain.push(record);
    if (record.previousRecordDigest !== null) {
      const previousChild = children.get(record.previousRecordDigest);
      if (previousChild !== undefined && previousChild !== record.recordDigest) {
        throw new FailureError('RUNTIME-DEPS-002', `${label} contains a forked legacy predecessor`);
      }
      children.set(record.previousRecordDigest, record.recordDigest);
    }
  }

  const chains = [...grouped.values()].map((chain) => {
    chain.sort((left, right) => left.sequence - right.sequence ||
      compareCodeUnits(left.recordDigest, right.recordDigest));
    let previous: LegacyDependencyTransitionJournal | undefined;
    for (const record of chain) {
      assertRuntimeDependencyOperationActive(operation, `${label} chain validation`);
      if (previous === undefined) {
        if (record.sequence !== 1 || record.previousRecordDigest !== null) {
          throw new FailureError('RUNTIME-DEPS-002', `${label} legacy chain has an invalid root`);
        }
      } else if (record.sequence !== previous.sequence + 1 ||
          record.previousRecordDigest !== previous.recordDigest) {
        throw new FailureError('RUNTIME-DEPS-002', `${label} legacy chain has a missing or forked predecessor`);
      }
      previous = record;
    }
    return Object.freeze(chain.slice()) as readonly LegacyDependencyTransitionJournal[];
  });
  chains.sort((left, right) => compareCodeUnits(left[0]!.operationKey, right[0]!.operationKey));
  if (chains.length === 0) {
    throw new FailureError('RUNTIME-DEPS-004', `${label} has no complete legacy chain`);
  }
  assertRuntimeDependencyOperationActive(operation, `${label} graph-validation readback`);
  return Object.freeze({
    records: readonlyMapSnapshot(records),
    ledgerDigest: dependencyTransitionLedgerDigest(records),
    recordsRootPhysical: generatedStatePhysicalIdentity(after),
    chains: Object.freeze(chains)
  });
}

type MigratedDependencyTransitionRecords = Readonly<{
  records: ReadonlyMap<`sha256:${string}`, DependencyTransitionJournal>;
  ordered: readonly DependencyTransitionJournal[];
  ledgerDigest: `sha256:${string}`;
}>;

async function buildMigratedDependencyTransitionRecords(
  source: LegacyDependencyTransitionRecordSet
): Promise<MigratedDependencyTransitionRecords> {
  const records = new Map<`sha256:${string}`, DependencyTransitionJournal>();
  for (const chain of source.chains) {
    const terminal = chain.at(-1);
    if (terminal === undefined || (terminal.phase !== 'complete' && terminal.phase !== 'rolled-back')) {
      throw new FailureError(
        'RUNTIME-DEPS-004',
        'Legacy dependency transition migration requires every chain to be terminal',
        {
          operationKey: terminal?.operationKey ?? null,
          phase: terminal?.phase ?? null
        }
      );
    }
  }
  if (source.chains.length === 0) {
    throw new FailureError('RUNTIME-DEPS-004', 'Legacy dependency transition migration has no records');
  }
  // Legacy source-generation receipts predate the bounded source-tree digest.
  // Translating them into v2 operation records would manufacture proof that
  // never existed.  The immutable v1 root remains the historical evidence;
  // the v2 migration intent binds that complete terminal ledger and starts a
  // fresh, empty v2 operation ledger for future transitions.
  const ordered = Object.freeze([]) as readonly DependencyTransitionJournal[];
  return Object.freeze({
    records: readonlyMapSnapshot(records),
    ordered,
    ledgerDigest: dependencyTransitionLedgerDigest(records)
  });
}

export type DependencyTransitionMigrationIntents = Readonly<{
  prepared: DependencyTransitionMigrationIntent | null;
  complete: DependencyTransitionMigrationIntent | null;
}>;

export async function readDependencyTransitionMigrationIntents(
  namespace: DependencyTransitionNamespace,
  input: RuntimeDependencyOperationControlInput
): Promise<DependencyTransitionMigrationIntents> {
  const options = runtimeDependencyOperationControls(input);
  const names = await readNoFollowDirectNames(
    namespace.journalRoot,
    'Dependency transition migration intent namespace',
    64,
    options
  );
  for (const name of names) {
    if (name === 'current.json' || name === 'records' || name === 'rollovers' || name === 'consumers' ||
        /^migration-[0-9a-f]{64}-(?:prepared|complete)\.json$/u.test(name)) {
      continue;
    }
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition migration namespace contains unknown residue', { name });
  }
  let prepared: DependencyTransitionMigrationIntent | null = null;
  let complete: DependencyTransitionMigrationIntent | null = null;
  for (const name of names) {
    runtimeDependencyOperationRemainingMs(options, 'Dependency transition migration intent validation');
    if (!name.startsWith('migration-')) continue;
    const entry = inspectNoFollowOrdinaryFileEntry(namespace.journalRoot, name);
    if (entry === null || entry.bytes === null) {
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition migration intent disappeared during census', { name });
    }
    const intent = parseDependencyTransitionMigrationIntent(entry.bytes, name);
    if (path.resolve(intent.ownerRoot) !== namespace.ownerRoot.path ||
        path.resolve(intent.targetJournalRootPath) !== namespace.journalRoot.path ||
        path.resolve(intent.targetRecordsRootPath) !== namespace.recordsRoot.path ||
        !sameGeneratedStateIdentity(
          intent.ownerRootPhysical,
          generatedStatePhysicalIdentity(namespace.ownerRoot)
        ) ||
        !sameGeneratedStateIdentity(
          intent.targetJournalRootPhysical,
          generatedStatePhysicalIdentity(namespace.journalRoot)
        ) ||
        !sameGeneratedStateIdentity(
          intent.targetRecordsRootPhysical,
          generatedStatePhysicalIdentity(namespace.recordsRoot)
        )) {
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition migration intent is foreign to its target namespace', { name });
    }
    if (intent.phase === 'prepared') {
      if (prepared !== null) {
        throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition migration has duplicate prepared intents');
      }
      prepared = intent;
    } else {
      if (complete !== null) {
        throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition migration has duplicate complete intents');
      }
      complete = intent;
    }
  }
  if (complete !== null && (prepared === null || complete.previousIntentDigest !== prepared.intentDigest)) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition migration complete intent has no prepared predecessor');
  }
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition migration intents readback');
  return Object.freeze({ prepared, complete });
}

function assertDependencyTransitionMigrationSourceBinding(
  intent: DependencyTransitionMigrationIntent,
  source: DependencyTransitionNamespace,
  sourceLedger: LegacyDependencyTransitionRecordSet
): void {
  if (path.resolve(intent.ownerRoot) !== source.ownerRoot.path ||
      path.resolve(intent.sourceJournalRootPath) !== source.journalRoot.path ||
      path.resolve(intent.sourceRecordsRootPath) !== source.recordsRoot.path ||
      !sameGeneratedStateIdentity(
        intent.ownerRootPhysical,
        generatedStatePhysicalIdentity(source.ownerRoot)
      ) ||
      !sameGeneratedStateIdentity(
        intent.sourceJournalRootPhysical,
        generatedStatePhysicalIdentity(source.journalRoot)
      ) ||
      !sameGeneratedStateIdentity(
        intent.sourceRecordsRootPhysical,
        sourceLedger.recordsRootPhysical
      ) ||
      intent.sourceLedgerDigest !== sourceLedger.ledgerDigest ||
      intent.sourceRecordCount !== sourceLedger.records.size) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition migration source changed and is preserved');
  }
}

/**
 * The normal v2 reader may retain the old namespace as recovery evidence, but
 * it must not parse the retired v1 grammar.  Once the one-way migration is
 * complete, the immutable intent is the only source-side receipt the normal
 * reader needs; this check therefore binds only the retained namespace paths
 * and physical identities.  Full v1 record validation belongs exclusively to
 * `migrateLegacyDependencyTransitionUnderLease`.
 */
export function assertDependencyTransitionMigrationSourceNamespaceBinding(
  intent: DependencyTransitionMigrationIntent,
  source: DependencyTransitionNamespace
): void {
  if (path.resolve(intent.ownerRoot) !== source.ownerRoot.path ||
      path.resolve(intent.sourceJournalRootPath) !== source.journalRoot.path ||
      path.resolve(intent.sourceRecordsRootPath) !== source.recordsRoot.path ||
      !sameGeneratedStateIdentity(
        intent.ownerRootPhysical,
        generatedStatePhysicalIdentity(source.ownerRoot)
      ) ||
      !sameGeneratedStateIdentity(
        intent.sourceJournalRootPhysical,
        generatedStatePhysicalIdentity(source.journalRoot)
      ) ||
      !sameGeneratedStateIdentity(
        intent.sourceRecordsRootPhysical,
        generatedStatePhysicalIdentity(source.recordsRoot)
      )) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition migration source namespace changed and is preserved');
  }
}

export function assertDependencyTransitionMigrationTargetBinding(
  intent: DependencyTransitionMigrationIntent,
  target: DependencyTransitionNamespace
): void {
  if (path.resolve(intent.targetJournalRootPath) !== target.journalRoot.path ||
      path.resolve(intent.targetRecordsRootPath) !== target.recordsRoot.path ||
      !sameGeneratedStateIdentity(
        intent.targetJournalRootPhysical,
        generatedStatePhysicalIdentity(target.journalRoot)
      ) ||
      !sameGeneratedStateIdentity(
        intent.targetRecordsRootPhysical,
        generatedStatePhysicalIdentity(target.recordsRoot)
      )) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition migration target changed and is preserved');
  }
}

async function writeDependencyTransitionMigrationIntent(
  namespace: DependencyTransitionNamespace,
  intent: DependencyTransitionMigrationIntent,
  options: RuntimeDependencyEffectFenceOptions,
  verifySourceBeforeWrite?: () => Promise<void>
): Promise<void> {
  await runtimeDependencyOperationEffectFence(
    options,
    `Dependency transition migration ${intent.phase} intent publication`
  );
  const name = dependencyTransitionMigrationIntentFileName(intent.intentDigest, intent.phase);
  const bytes = dependencyTransitionMigrationIntentBytes(intent);
  await verifySourceBeforeWrite?.();
  // Source verification can itself perform a bounded census.  Re-admit the
  // actual durable publication after that readback so an expired/aborted
  // operation cannot turn the migration evidence into a late filesystem
  // effect, and so the caller's final commit fence is observed immediately
  // before the immutable write.
  await runtimeDependencyOperationEffectFence(
    options,
    `Dependency transition migration ${intent.phase} intent effect`
  );
  writeDurableTransitionFile(
    namespace.journalRoot,
    name,
    bytes,
    assertDependencyTransitionMigrationIntentBytes,
    true
  );
  const readback = inspectNoFollowOrdinaryFileEntry(namespace.journalRoot, name);
  if (readback === null || readback.bytes === null || !Buffer.from(readback.bytes).equals(bytes)) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition migration intent disappeared after publication', { name });
  }
  parseDependencyTransitionMigrationIntent(readback.bytes, name);
}

function dependencyTransitionMigrationIntent(
  input: Readonly<Omit<DependencyTransitionMigrationIntent, 'intentDigest' | 'schema'>>
): DependencyTransitionMigrationIntent {
  return Object.freeze({
    ...input,
    schema: DEPENDENCY_TRANSITION_MIGRATION_SCHEMA,
    intentDigest: dependencyTransitionMigrationIntentStableDigest(input)
  });
}

async function assertLegacyDependencyTransitionUnchanged(
  source: DependencyTransitionNamespace,
  expected: LegacyDependencyTransitionRecordSet,
  options: BoundRuntimeDependencyOperationControls,
  label: string
): Promise<LegacyDependencyTransitionRecordSet> {
  runtimeDependencyOperationRemainingMs(options, `${label} admission`);
  const currentNamespace = inspectLegacyDependencyTransitionNamespace(source.ownerRoot.path);
  if (currentNamespace === null ||
      !sameGeneratedStateIdentity(
        generatedStatePhysicalIdentity(currentNamespace.journalRoot),
        generatedStatePhysicalIdentity(source.journalRoot)
      ) ||
      !sameGeneratedStateIdentity(
        generatedStatePhysicalIdentity(currentNamespace.recordsRoot),
        expected.recordsRootPhysical
      )) {
    throw new FailureError('RUNTIME-DEPS-004', `${label} namespace physical identity changed and is preserved`);
  }
  const current = readLegacyDependencyTransitionRecordSet(
    currentNamespace.recordsRoot,
    currentNamespace.ownerRoot.path,
    generatedStatePhysicalIdentity(currentNamespace.ownerRoot),
    runtimeDependencyOperationContext(options),
    label
  );
  if (current.records.size !== expected.records.size || current.ledgerDigest !== expected.ledgerDigest) {
    throw new FailureError('RUNTIME-DEPS-004', `${label} immutable records changed and are preserved`, {
      expectedLedgerDigest: expected.ledgerDigest,
      observedLedgerDigest: current.ledgerDigest,
      expectedRecordCount: expected.records.size,
      observedRecordCount: current.records.size
    });
  }
  return current;
}

async function publishMigratedDependencyTransitionRecords(
  namespace: DependencyTransitionNamespace,
  expected: MigratedDependencyTransitionRecords,
  options: RuntimeDependencyEffectFenceOptions
): Promise<void> {
  const current = readDependencyTransitionRecordSet(
    namespace.recordsRoot,
    namespace.ownerRoot.path,
    runtimeDependencyOperationContext(options),
    'Dependency transition v2 migration target records'
  );
  if (current.records.size > expected.ordered.length) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition migration target contains extra records');
  }
  let publishedCount = current.records.size;
  for (let index = 0; index < expected.ordered.length; index += 1) {
    const record = expected.ordered[index]!;
    const existing = current.records.get(record.recordDigest);
    if (existing !== undefined) {
      if (!Buffer.from(dependencyTransitionRecordBytes(existing)).equals(
        dependencyTransitionRecordBytes(record)
      )) {
        throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition migration target record collides with different bytes', {
          recordDigest: record.recordDigest
        });
      }
      continue;
    }
    if (index !== publishedCount) {
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition migration target has a non-prefix partial chain', {
        expectedIndex: index,
        observedRecordCount: publishedCount
      });
    }
    await runtimeDependencyOperationEffectFence(
      options,
      'Dependency transition v2 migration record publication'
    );
    writeDurableTransitionFile(
      namespace.recordsRoot,
      transitionRecordName(record.recordDigest),
      dependencyTransitionRecordBytes(record),
      assertDependencyTransitionRecordBytes,
      true
    );
    publishedCount += 1;
  }
  const final = readDependencyTransitionRecordSet(
    namespace.recordsRoot,
    namespace.ownerRoot.path,
    runtimeDependencyOperationContext(options),
    'Dependency transition v2 migration target readback'
  );
  if (final.records.size !== expected.records.size || final.ledgerDigest !== expected.ledgerDigest ||
      final.tip?.recordDigest !== expected.ordered.at(-1)?.recordDigest) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition v2 migration target readback is incomplete');
  }
}

export async function migrateLegacyDependencyTransitionUnderLease(
  ownerRoot: string,
  input: RuntimeDependencyEffectFenceInput
): Promise<void> {
  ownerRoot = path.resolve(ownerRoot);
  const options = runtimeDependencyEffectFenceOptions(input);
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition migration admission');
  const legacyNamespace = inspectLegacyDependencyTransitionNamespace(ownerRoot);
  const targetNamespace = inspectDependencyTransitionNamespace(ownerRoot);
  if (legacyNamespace === null) {
    if (targetNamespace !== null) {
      // A new installation may legitimately have created an empty v2 root
      // before any transition was recorded.  There is no legacy source to
      // migrate, and normal v2 readers remain the sole authority.
      const intents = await readDependencyTransitionMigrationIntents(targetNamespace, options);
      if (intents.prepared !== null || intents.complete !== null) {
        throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition migration source evidence is missing and is preserved', {
          preparedIntentDigest: intents.prepared?.intentDigest ?? null,
          completeIntentDigest: intents.complete?.intentDigest ?? null
        });
      }
      return;
    }
    return;
  }
  const legacyNames = await readNoFollowDirectNames(
    legacyNamespace.journalRoot,
    'Legacy dependency transition namespace',
    64,
    options
  );
  for (const name of legacyNames) {
    if (name !== 'current.json' && name !== 'records') {
      throw new FailureError('RUNTIME-DEPS-004', 'Legacy dependency transition namespace contains unknown residue', { name });
    }
  }
  const source = readLegacyDependencyTransitionRecordSet(
    legacyNamespace.recordsRoot,
    legacyNamespace.ownerRoot.path,
    generatedStatePhysicalIdentity(legacyNamespace.ownerRoot),
    runtimeDependencyOperationContext(options),
    'Legacy dependency transition migration source'
  );
  const migrated = await buildMigratedDependencyTransitionRecords(source);

  if (targetNamespace !== null) {
    const intents = await readDependencyTransitionMigrationIntents(targetNamespace, options);
    if (intents.complete !== null) {
      assertDependencyTransitionMigrationSourceBinding(intents.complete, legacyNamespace, source);
      // A completed migration binds the target namespace and the initial
      // migration derivation, not the target ledger's permanent terminal
      // contents.  Normal v2 operations append immutable records after this
      // receipt is published; their single-chain parser owns that later
      // integrity.  Requiring the live ledger to remain byte-for-byte equal
      // to the migration-time empty ledger would make the first legitimate
      // post-migration transition poison every future admission.
      readDependencyTransitionRecordSet(
        targetNamespace.recordsRoot,
        targetNamespace.ownerRoot.path,
        runtimeDependencyOperationContext(options),
        'Dependency transition v2 migration completed target'
      );
      assertDependencyTransitionMigrationTargetBinding(intents.complete, targetNamespace);
      if (intents.complete.targetLedgerDigest !== migrated.ledgerDigest ||
          intents.complete.targetRecordCount !== migrated.records.size) {
        throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition migration completed target is not derived from its source');
      }
      return;
    }
    if (intents.prepared === null) {
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition v2 namespace exists without a migration intent; target is preserved');
    }
    assertDependencyTransitionMigrationSourceBinding(intents.prepared, legacyNamespace, source);
    if (intents.prepared.targetLedgerDigest !== migrated.ledgerDigest ||
        intents.prepared.targetRecordCount !== migrated.records.size) {
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition migration target derivation changed');
    }
    await publishMigratedDependencyTransitionRecords(targetNamespace, migrated, options);
    const sourceAfter = await assertLegacyDependencyTransitionUnchanged(
      legacyNamespace,
      source,
      options,
      'Dependency transition migration source readback'
    );
    assertDependencyTransitionMigrationSourceBinding(intents.prepared, legacyNamespace, sourceAfter);
    const complete = dependencyTransitionMigrationIntent({
      ...intents.prepared,
      phase: 'complete',
      previousIntentDigest: intents.prepared.intentDigest
    });
    await writeDependencyTransitionMigrationIntent(
      targetNamespace,
      complete,
      options,
      async () => {
        await assertLegacyDependencyTransitionUnchanged(
          legacyNamespace,
          sourceAfter,
          options,
          'Dependency transition migration final source fence'
        );
      }
    );
    const terminal = migrated.ordered.at(-1);
    if (terminal !== undefined) {
      writeDependencyTransitionPointerCache(targetNamespace, terminal.recordDigest);
    }
    return;
  }

  // Source validation and transformation complete before the first v2
  // namespace effect.  The second source census after the fence closes the
  // physical/digest CAS window without touching the retained v1 evidence.
  await runtimeDependencyOperationEffectFence(options, 'Dependency transition v2 migration namespace admission');
  const sourceAtEffect = await assertLegacyDependencyTransitionUnchanged(
    legacyNamespace,
    source,
    options,
    'Dependency transition migration source effect preimage'
  );
  const namespace = await ensureDependencyTransitionNamespace(ownerRoot, options);
  const targetBefore = readDependencyTransitionRecordSet(
    namespace.recordsRoot,
    namespace.ownerRoot.path,
    runtimeDependencyOperationContext(options),
    'Dependency transition v2 migration target preflight'
  );
  if (targetBefore.records.size !== 0) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition v2 target appeared during migration');
  }
  const prepared = dependencyTransitionMigrationIntent({
    previousIntentDigest: null,
    phase: 'prepared',
    ownerRoot: namespace.ownerRoot.path,
    ownerRootPhysical: generatedStatePhysicalIdentity(namespace.ownerRoot),
    sourceSchema: DEPENDENCY_TRANSITION_LEGACY_SCHEMA,
    sourceJournalRootPath: legacyNamespace.journalRoot.path,
    sourceJournalRootPhysical: generatedStatePhysicalIdentity(legacyNamespace.journalRoot),
    sourceRecordsRootPath: legacyNamespace.recordsRoot.path,
    sourceRecordsRootPhysical: sourceAtEffect.recordsRootPhysical,
    sourceLedgerDigest: sourceAtEffect.ledgerDigest,
    sourceRecordCount: sourceAtEffect.records.size,
    targetSchema: DEPENDENCY_TRANSITION_SCHEMA,
    targetJournalRootPath: namespace.journalRoot.path,
    targetJournalRootPhysical: generatedStatePhysicalIdentity(namespace.journalRoot),
    targetRecordsRootPath: namespace.recordsRoot.path,
    targetRecordsRootPhysical: generatedStatePhysicalIdentity(namespace.recordsRoot),
    targetLedgerDigest: migrated.ledgerDigest,
    targetRecordCount: migrated.records.size
  });
  await writeDependencyTransitionMigrationIntent(
    namespace,
    prepared,
    options,
    async () => {
      await assertLegacyDependencyTransitionUnchanged(
        legacyNamespace,
        sourceAtEffect,
        options,
        'Dependency transition migration source prepared fence'
      );
    }
  );
  await publishMigratedDependencyTransitionRecords(namespace, migrated, options);
  const sourceAfter = await assertLegacyDependencyTransitionUnchanged(
    legacyNamespace,
    sourceAtEffect,
    options,
    'Dependency transition migration source final readback'
  );
  assertDependencyTransitionMigrationSourceBinding(prepared, legacyNamespace, sourceAfter);
  const complete = dependencyTransitionMigrationIntent({
    ...prepared,
    phase: 'complete',
    previousIntentDigest: prepared.intentDigest
  });
  await writeDependencyTransitionMigrationIntent(
    namespace,
    complete,
    options,
    async () => {
      await assertLegacyDependencyTransitionUnchanged(
        legacyNamespace,
        sourceAfter,
        options,
        'Dependency transition migration final source fence'
      );
    }
  );
  const terminal = migrated.ordered.at(-1);
  if (terminal !== undefined) {
    writeDependencyTransitionPointerCache(namespace, terminal.recordDigest);
  }
}
