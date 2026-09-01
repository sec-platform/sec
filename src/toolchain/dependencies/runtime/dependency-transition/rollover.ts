import path from 'node:path';
import {
  generatedStateDigest,
  type GeneratedStatePhysicalIdentity
} from '../../../../runtime-state/generated-state/contract.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  createExclusiveNoFollowDirectory,
  deleteRetainedNoFollowEntry,
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  type PhysicalDirectoryIdentity,
  PhysicalNoFollowError,
  relocateRetainedNoFollowDirectoryAcrossParents
} from '../../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  SecError
} from '../../../../system-architecture/foundation/contract/failure.ts';
import {
  canonicalJson,
  compareCodeUnits
} from '../../../../system-architecture/foundation/runtime/canonical.ts';
import {
  formatJsonFile
} from '../../../../workspace/files.ts';
import {
  runtimeDependencyOperationContext,
  runtimeDependencyOperationEffectFence,
  type RuntimeDependencyOperationOptions,
  runtimeDependencyOperationRemainingMs
} from '../operation-context.ts';
import {
  assertDependencyTransitionRecordBytes,
  dependencyTransitionDigestWithoutRecord,
  dependencyTransitionRecordBytes,
  parseDependencyTransitionRecord,
  transitionRecordName
} from './codec.ts';
import {
  DEPENDENCY_TRANSITION_SCHEMA,
  type DependencyTransitionJournal,
  type DependencyTransitionLedger,
  type DependencyTransitionNamespace,
  type DependencyTransitionSlot,
  type DependencyTransitionUnsigned,
  generatedStatePhysicalIdentity,
  hasExactObjectKeys,
  isCanonicalAbsolutePath,
  isCanonicalGeneratedStatePhysicalIdentity,
  isSha256Digest,
  type RuntimeDependencySourceGeneration,
  sameGeneratedStateIdentity,
  transitionSlotMatches
} from './contract.ts';
import {
  DEPENDENCY_TRANSITION_RECORD_CAPACITY,
  dependencyTransitionLedgerDigest,
  dependencyTransitionNamespacePaths,
  type DependencyTransitionRecordSet,
  ensureDependencyTransitionNamespace,
  inspectDependencyTransitionNamespace,
  inspectOptionalNoFollowDirectoryChild,
  observeDependencyTransitionSlot,
  readDependencyTransitionRecordSet,
  readNoFollowDirectNames,
  writeDurableTransitionFile
} from './store.ts';

export const DEPENDENCY_TRANSITION_ROLLOVER_TRIGGER = 9_000;

const DEPENDENCY_TRANSITION_ROLLOVER_NAMESPACE_CAPACITY = 4_096;

const DEPENDENCY_TRANSITION_ROLLOVER_SCHEMA = 'sec-dependency-transition-rollover-v1' as const;

type DependencyTransitionRolloverPhase =
  | 'prepared'
  | 'staged'
  | 'backed-up'
  | 'published'
  | 'retiring'
  | 'retired'
  | 'complete';

export interface DependencyTransitionRolloverIntent {
  readonly schema: typeof DEPENDENCY_TRANSITION_ROLLOVER_SCHEMA;
  readonly intentDigest: `sha256:${string}`;
  readonly previousIntentDigest: `sha256:${string}` | null;
  readonly sequence: number;
  readonly phase: DependencyTransitionRolloverPhase;
  readonly ownerRoot: string;
  readonly ownerRootPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly recordsRootPath: string;
  readonly sourceRecordsRootPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly retiredRecordsPath: string;
  readonly retiredRecordsPhysical: Readonly<GeneratedStatePhysicalIdentity> | null;
  readonly retiredRecordsDisposed: boolean;
  readonly nextRecordsPath: string;
  readonly nextRecordsPhysical: Readonly<GeneratedStatePhysicalIdentity> | null;
  readonly publishedRecordsRootPhysical: Readonly<GeneratedStatePhysicalIdentity> | null;
  readonly terminalRecordDigest: `sha256:${string}`;
  readonly ledgerDigest: `sha256:${string}`;
  readonly recordCount: number;
  readonly checkpoint: DependencyTransitionJournal;
}

/**
 * A rollover checkpoint is a compact successor for an already authenticated
 * terminal ledger.  It is deliberately not a copy of the caller's next
 * prepared operation: accepting caller fields here would let a forged
 * prepared intent become the new ledger root during crash recovery.  The
 * checkpoint keeps the terminal topology/physical receipts and derives its
 * operation identity from both the old terminal digest and the complete
 * source-ledger digest.  Recovery proves this derivation while the old ledger
 * is still present, before it is moved to the retired archive.
 */
function dependencyTransitionTerminalCheckpoint(
  terminal: DependencyTransitionJournal,
  ledgerDigest: `sha256:${string}`
): DependencyTransitionJournal {
  if (terminal.phase !== 'complete' && terminal.phase !== 'rolled-back') {
    throw new SecError('RUNTIME-DEPS-004', 'Only a terminal dependency transition can seed a rollover checkpoint');
  }
  const unsigned: DependencyTransitionUnsigned = Object.freeze({
    schema: DEPENDENCY_TRANSITION_SCHEMA,
    previousRecordDigest: null,
    sequence: 1,
    operationKey: generatedStateDigest(Object.freeze({
      schema: 'sec-dependency-transition-rollover-checkpoint-operation-v1',
      terminalRecordDigest: terminal.recordDigest,
      ledgerDigest
    })),
    attemptNonce: `rollover-checkpoint:${terminal.recordDigest.slice('sha256:'.length)}`,
    kind: terminal.kind,
    ownerRoot: terminal.ownerRoot,
    ownerRootPhysical: terminal.ownerRootPhysical,
    destination: terminal.destination,
    preimage: terminal.preimage,
    stage: terminal.stage,
    stageRoot: terminal.stageRoot,
    backup: terminal.backup,
    sourceGeneration: terminal.sourceGeneration,
    phase: terminal.phase,
    durability: terminal.durability,
    failure: terminal.failure
  });
  return Object.freeze({
    ...unsigned,
    recordDigest: dependencyTransitionDigestWithoutRecord(unsigned)
  }) as DependencyTransitionJournal;
}

const DEPENDENCY_TRANSITION_ROLLOVER_KEYS = Object.freeze([
  'checkpoint', 'intentDigest', 'nextRecordsPath', 'nextRecordsPhysical',
  'previousIntentDigest', 'sequence',
  'ownerRoot', 'ownerRootPhysical', 'phase', 'publishedRecordsRootPhysical',
  'recordCount', 'recordsRootPath', 'retiredRecordsPath', 'retiredRecordsPhysical',
  'retiredRecordsDisposed', 'ledgerDigest',
  'schema', 'sourceRecordsRootPhysical', 'terminalRecordDigest'
]);

function rolloverIntentStableDigest(
  intent: Pick<DependencyTransitionRolloverIntent,
    'previousIntentDigest' | 'sequence' | 'ownerRoot' | 'ownerRootPhysical' |
    'recordsRootPath' | 'sourceRecordsRootPhysical' |
    'retiredRecordsPath' | 'nextRecordsPath' | 'terminalRecordDigest' | 'ledgerDigest' |
    'recordCount' | 'checkpoint'>
): `sha256:${string}` {
  return generatedStateDigest(Object.freeze({
    schema: DEPENDENCY_TRANSITION_ROLLOVER_SCHEMA,
    previousIntentDigest: intent.previousIntentDigest,
    sequence: intent.sequence,
    ownerRoot: intent.ownerRoot,
    ownerRootPhysical: intent.ownerRootPhysical,
    recordsRootPath: intent.recordsRootPath,
    sourceRecordsRootPhysical: intent.sourceRecordsRootPhysical,
    retiredRecordsPath: intent.retiredRecordsPath,
    nextRecordsPath: intent.nextRecordsPath,
    terminalRecordDigest: intent.terminalRecordDigest,
    ledgerDigest: intent.ledgerDigest,
    recordCount: intent.recordCount,
    checkpointDigest: intent.checkpoint.recordDigest
  }));
}

function rolloverIntentFileName(
  intentDigest: `sha256:${string}`,
  phase: DependencyTransitionRolloverPhase
): string {
  return `rollover-${intentDigest.slice('sha256:'.length)}-${phase}.json`;
}

function rolloverResidueStem(
  intent: Pick<DependencyTransitionRolloverIntent,
    'previousIntentDigest' | 'sequence' | 'ownerRoot' | 'terminalRecordDigest' |
    'ledgerDigest' | 'recordCount' | 'checkpoint'>
): string {
  return generatedStateDigest(Object.freeze({
    schema: DEPENDENCY_TRANSITION_ROLLOVER_SCHEMA,
    previousIntentDigest: intent.previousIntentDigest,
    sequence: intent.sequence,
    ownerRoot: path.resolve(intent.ownerRoot),
    terminalRecordDigest: intent.terminalRecordDigest,
    ledgerDigest: intent.ledgerDigest,
    recordCount: intent.recordCount,
    checkpointDigest: intent.checkpoint.recordDigest
  })).slice('sha256:'.length, 'sha256:'.length + 48);
}

function parseDependencyTransitionRolloverIntent(
  bytes: Uint8Array,
  expectedName?: string
): DependencyTransitionRolloverIntent {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch (error) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover intent is not JSON', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (!hasExactObjectKeys(value, DEPENDENCY_TRANSITION_ROLLOVER_KEYS)) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover intent has noncanonical keys');
  }
  const intent = value as unknown as DependencyTransitionRolloverIntent;
  if (intent.schema !== DEPENDENCY_TRANSITION_ROLLOVER_SCHEMA ||
      !isSha256Digest(intent.intentDigest) ||
      (intent.previousIntentDigest !== null && !isSha256Digest(intent.previousIntentDigest)) ||
      !Number.isSafeInteger(intent.sequence) || intent.sequence < 1 ||
      !(['prepared', 'staged', 'backed-up', 'published', 'retiring', 'retired', 'complete'] as readonly string[]).includes(intent.phase) ||
      !isCanonicalAbsolutePath(intent.ownerRoot) ||
      !isCanonicalGeneratedStatePhysicalIdentity(intent.ownerRootPhysical) ||
      !isCanonicalAbsolutePath(intent.recordsRootPath) ||
      !isCanonicalGeneratedStatePhysicalIdentity(intent.sourceRecordsRootPhysical) ||
      !isCanonicalAbsolutePath(intent.retiredRecordsPath) ||
      !isCanonicalAbsolutePath(intent.nextRecordsPath) ||
      (intent.retiredRecordsPhysical !== null &&
        !isCanonicalGeneratedStatePhysicalIdentity(intent.retiredRecordsPhysical)) ||
      (intent.nextRecordsPhysical !== null &&
        !isCanonicalGeneratedStatePhysicalIdentity(intent.nextRecordsPhysical)) ||
      (intent.publishedRecordsRootPhysical !== null &&
        !isCanonicalGeneratedStatePhysicalIdentity(intent.publishedRecordsRootPhysical)) ||
      !isSha256Digest(intent.terminalRecordDigest) ||
      !isSha256Digest(intent.ledgerDigest) ||
      !Number.isSafeInteger(intent.recordCount) || intent.recordCount < 1 ||
      intent.recordCount > DEPENDENCY_TRANSITION_RECORD_CAPACITY ||
      typeof intent.retiredRecordsDisposed !== 'boolean' ||
      parseDependencyTransitionRecord(
        Buffer.from(formatJsonFile(canonicalJson(intent.checkpoint)), 'utf8')
      ).recordDigest !== intent.checkpoint.recordDigest) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover intent fields are invalid');
  }
  const journalRoot = path.dirname(intent.recordsRootPath);
  const rolloversRoot = path.join(journalRoot, 'rollovers');
  const residueStem = rolloverResidueStem(intent);
  if (path.dirname(intent.retiredRecordsPath) !== rolloversRoot ||
      path.dirname(intent.nextRecordsPath) !== rolloversRoot ||
      path.basename(intent.retiredRecordsPath) !== `records-retired-${residueStem}` ||
      path.basename(intent.nextRecordsPath) !== `records-next-${residueStem}` ||
       (intent.checkpoint.phase !== 'complete' && intent.checkpoint.phase !== 'rolled-back') ||
      intent.checkpoint.sequence !== 1 ||
      intent.checkpoint.previousRecordDigest !== null ||
      intent.checkpoint.ownerRoot !== intent.ownerRoot ||
      (intent.phase === 'prepared' && (
        intent.retiredRecordsPhysical !== null ||
        intent.nextRecordsPhysical !== null ||
        intent.publishedRecordsRootPhysical !== null ||
        intent.retiredRecordsDisposed
      )) ||
      (intent.phase === 'staged' && (
        intent.retiredRecordsPhysical !== null ||
        intent.nextRecordsPhysical === null ||
        intent.publishedRecordsRootPhysical !== null ||
        intent.retiredRecordsDisposed
      )) ||
      (intent.phase === 'backed-up' && (
        intent.retiredRecordsPhysical === null ||
        intent.nextRecordsPhysical === null ||
        intent.publishedRecordsRootPhysical !== null ||
        intent.retiredRecordsDisposed
      )) ||
      ((intent.phase === 'published' || intent.phase === 'retiring') && (
        intent.retiredRecordsPhysical === null ||
        intent.nextRecordsPhysical !== null ||
        intent.publishedRecordsRootPhysical === null ||
        intent.retiredRecordsDisposed
      )) ||
      ((intent.phase === 'retired' || intent.phase === 'complete') && (
        intent.retiredRecordsPhysical !== null ||
        intent.nextRecordsPhysical !== null ||
        intent.publishedRecordsRootPhysical === null ||
        !intent.retiredRecordsDisposed
      )) ||
      rolloverIntentStableDigest(intent) !== intent.intentDigest) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover intent topology or digest is invalid');
  }
  if (expectedName !== undefined && expectedName !== rolloverIntentFileName(intent.intentDigest, intent.phase)) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover intent filename does not match its digest');
  }
  if (formatJsonFile(canonicalJson(intent)) !== Buffer.from(bytes).toString('utf8')) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover intent bytes are not canonical');
  }
  return Object.freeze(intent);
}

function assertDependencyTransitionRolloverIntentBytes(bytes: Uint8Array): void {
  parseDependencyTransitionRolloverIntent(bytes);
}

type DependencyTransitionRolloverNamespace = Readonly<{
  ownerRoot: PhysicalDirectoryIdentity;
  journalRoot: PhysicalDirectoryIdentity;
  rolloversRoot: PhysicalDirectoryIdentity;
  recordsRootPath: string;
}>;

function inspectDependencyTransitionRolloverNamespace(
  ownerRoot: string
): DependencyTransitionRolloverNamespace | null {
  try {
    const owner = inspectNoFollowDirectoryChain(ownerRoot, 'Dependency transition rollover owner root').target;
    const paths = dependencyTransitionNamespacePaths(owner.path);
    const backupRoot = inspectNoFollowDirectoryChain(
      paths.backupRoot,
      'Dependency transition rollover backup root'
    ).target;
    const journalRoot = inspectNoFollowDirectoryChain(
      paths.journalRoot,
      'Dependency transition rollover journal root'
    ).target;
    const rolloversRoot = inspectNoFollowDirectoryChain(
      paths.rolloversRoot,
      'Dependency transition rollover namespace'
    ).target;
    if (paths.backupRoot !== backupRoot.path || paths.journalRoot !== journalRoot.path ||
        paths.rolloversRoot !== rolloversRoot.path) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover namespace path normalization changed');
    }
    return Object.freeze({
      ownerRoot: owner,
      journalRoot,
      rolloversRoot,
      recordsRootPath: paths.recordsRoot
    });
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') return null;
    throw error;
  }
}

function makeDependencyTransitionRolloverIntent(input: Readonly<{
  readonly namespace: DependencyTransitionNamespace;
  readonly terminal: DependencyTransitionJournal;
  readonly previousIntentDigest: `sha256:${string}` | null;
  readonly sequence: number;
  readonly ledgerDigest: `sha256:${string}`;
  readonly recordCount: number;
  readonly checkpoint: DependencyTransitionJournal;
  readonly nextRecordsPhysical: Readonly<GeneratedStatePhysicalIdentity> | null;
}>): DependencyTransitionRolloverIntent {
  if (input.namespace.rolloversRoot === null) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover namespace is unavailable');
  }
  const stem = rolloverResidueStem({
    previousIntentDigest: input.previousIntentDigest,
    sequence: input.sequence,
    ownerRoot: input.namespace.ownerRoot.path,
    terminalRecordDigest: input.terminal.recordDigest,
    ledgerDigest: input.ledgerDigest,
    recordCount: input.recordCount,
    checkpoint: input.checkpoint
  });
  const retiredRecordsPath = path.join(input.namespace.rolloversRoot.path, `records-retired-${stem}`);
  const nextRecordsPath = path.join(input.namespace.rolloversRoot.path, `records-next-${stem}`);
  const stableInput = Object.freeze({
    previousIntentDigest: input.previousIntentDigest,
    sequence: input.sequence,
    ownerRoot: input.namespace.ownerRoot.path,
    ownerRootPhysical: generatedStatePhysicalIdentity(input.namespace.ownerRoot),
    recordsRootPath: input.namespace.recordsRoot.path,
    sourceRecordsRootPhysical: generatedStatePhysicalIdentity(input.namespace.recordsRoot),
    retiredRecordsPath,
    nextRecordsPath,
    terminalRecordDigest: input.terminal.recordDigest,
    ledgerDigest: input.ledgerDigest,
    recordCount: input.recordCount,
    checkpoint: input.checkpoint
  });
  const intentDigest = rolloverIntentStableDigest(stableInput);
  return Object.freeze({
    schema: DEPENDENCY_TRANSITION_ROLLOVER_SCHEMA,
    intentDigest,
    previousIntentDigest: stableInput.previousIntentDigest,
    sequence: stableInput.sequence,
    phase: 'prepared',
    ownerRoot: stableInput.ownerRoot,
    ownerRootPhysical: stableInput.ownerRootPhysical,
    recordsRootPath: stableInput.recordsRootPath,
    sourceRecordsRootPhysical: stableInput.sourceRecordsRootPhysical,
    retiredRecordsPath,
    retiredRecordsPhysical: null,
    retiredRecordsDisposed: false,
    nextRecordsPath,
    nextRecordsPhysical: input.nextRecordsPhysical,
    publishedRecordsRootPhysical: null,
    terminalRecordDigest: stableInput.terminalRecordDigest,
    ledgerDigest: input.ledgerDigest,
    recordCount: input.recordCount,
    checkpoint: input.checkpoint
  });
}

function advanceDependencyTransitionRolloverIntent(
  previous: DependencyTransitionRolloverIntent,
  phase: DependencyTransitionRolloverPhase,
  patch: Readonly<Partial<Pick<DependencyTransitionRolloverIntent,
    'retiredRecordsPhysical' | 'retiredRecordsDisposed' | 'nextRecordsPhysical' |
    'publishedRecordsRootPhysical'>>>
): DependencyTransitionRolloverIntent {
  const next = Object.freeze({ ...previous, phase, ...patch });
  if (rolloverIntentStableDigest(next) !== previous.intentDigest) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover identity changed between phases');
  }
  return next;
}

async function assertDependencyTransitionRolloverCheckpoint(
  recordsRoot: PhysicalDirectoryIdentity,
  intent: DependencyTransitionRolloverIntent,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const expectedName = transitionRecordName(intent.checkpoint.recordDigest);
  const names = await readNoFollowDirectNames(
    recordsRoot,
    'Dependency transition rollover checkpoint records',
    2,
    options
  );
  if (names.length !== 1 || names[0] !== expectedName) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover checkpoint directory contains unknown residue', {
      expectedName,
      names
    });
  }
  const entry = inspectNoFollowOrdinaryFileEntry(recordsRoot, expectedName);
  if (entry === null || entry.bytes === null) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover checkpoint disappeared');
  }
  const checkpoint = parseDependencyTransitionRecord(entry.bytes, expectedName);
  if (checkpoint.recordDigest !== intent.checkpoint.recordDigest ||
      !Buffer.from(entry.bytes).equals(dependencyTransitionRecordBytes(intent.checkpoint))) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover checkpoint bytes differ');
  }
}

function assertDependencyTransitionRolloverCheckpointDerived(
  intent: DependencyTransitionRolloverIntent,
  terminal: DependencyTransitionJournal
): void {
  const expected = dependencyTransitionTerminalCheckpoint(terminal, intent.ledgerDigest);
  if (!Buffer.from(dependencyTransitionRecordBytes(expected)).equals(
    dependencyTransitionRecordBytes(intent.checkpoint)
  )) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover checkpoint is not derived from its authenticated terminal ledger tip');
  }
}

function assertDependencyTransitionRolloverOwner(
  namespace: DependencyTransitionRolloverNamespace,
  intent: DependencyTransitionRolloverIntent
): void {
  if (intent.ownerRoot !== namespace.ownerRoot.path ||
      intent.recordsRootPath !== namespace.recordsRootPath ||
      !sameGeneratedStateIdentity(
        generatedStatePhysicalIdentity(namespace.ownerRoot),
        intent.ownerRootPhysical
      )) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover intent belongs to a foreign owner root');
  }
}

function assertDependencyTransitionRolloverDirectory(
  actual: PhysicalDirectoryIdentity | null,
  expected: Readonly<GeneratedStatePhysicalIdentity> | null,
  label: string
): PhysicalDirectoryIdentity {
  if (actual === null || expected === null ||
      !sameGeneratedStateIdentity(generatedStatePhysicalIdentity(actual), expected)) {
    throw new SecError('RUNTIME-DEPS-004', `${label} is absent or has a foreign physical identity`, {
      expected,
      actual: actual === null ? null : generatedStatePhysicalIdentity(actual)
    });
  }
  return actual;
}

function assertDependencyTransitionTerminalRolloverReady(
  terminal: DependencyTransitionJournal,
  namespace: DependencyTransitionNamespace
): void {
  if (terminal.phase !== 'complete' && terminal.phase !== 'rolled-back') {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition ledger reached capacity before a terminal receipt');
  }
  if (terminal.stage !== null && terminal.stage.kind !== 'absent' ||
      terminal.stageRoot !== null && terminal.stageRoot.kind !== 'absent' ||
      terminal.backup !== null && terminal.backup.kind !== 'absent') {
    throw new SecError('RUNTIME-DEPS-004', 'Terminal dependency transition retains an unknown stage or backup residue');
  }
  if (terminal.destination.kind !== 'absent' && terminal.destination.physical === null) {
    throw new SecError('RUNTIME-DEPS-004', 'Terminal dependency transition destination has no physical identity');
  }
  if (terminal.ownerRoot !== namespace.ownerRoot.path ||
      !sameGeneratedStateIdentity(terminal.ownerRootPhysical, generatedStatePhysicalIdentity(namespace.ownerRoot))) {
    throw new SecError('RUNTIME-DEPS-004', 'Terminal dependency transition owner identity changed');
  }
}

type DependencyTransitionRolloverArchiveEntry = Readonly<{
  readonly relativePath: string;
  readonly device: string;
  readonly inode: string;
  readonly recordDigest: `sha256:${string}`;
  readonly bytesDigest: `sha256:${string}`;
}>;

const DEPENDENCY_TRANSITION_ROLLOVER_DISPOSAL_INVENTORY_SCHEMA =
  'sec-dependency-transition-rollover-disposal-inventory-v1' as const;

const DEPENDENCY_TRANSITION_ROLLOVER_DISPOSAL_INVENTORY_KEYS = Object.freeze([
  'archivePhysical', 'entries', 'intentDigest', 'inventoryDigest', 'ledgerDigest',
  'recordCount', 'schema'
]);

const DEPENDENCY_TRANSITION_ROLLOVER_DISPOSAL_INVENTORY_ENTRY_KEYS = Object.freeze([
  'bytesDigest', 'device', 'inode', 'recordDigest', 'relativePath'
]);

interface DependencyTransitionRolloverDisposalInventory {
  readonly schema: typeof DEPENDENCY_TRANSITION_ROLLOVER_DISPOSAL_INVENTORY_SCHEMA;
  readonly inventoryDigest: `sha256:${string}`;
  readonly intentDigest: `sha256:${string}`;
  readonly archivePhysical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly ledgerDigest: `sha256:${string}`;
  readonly recordCount: number;
  readonly entries: readonly DependencyTransitionRolloverArchiveEntry[];
}

function rolloverDisposalInventoryName(
  intent: DependencyTransitionRolloverIntent
): string {
  return `disposal-inventory-${intent.intentDigest.slice('sha256:'.length)}.json`;
}

function rolloverDisposalInventoryBytesDigest(bytes: Uint8Array): `sha256:${string}` {
  return generatedStateDigest(Object.freeze({
    encoding: 'base64',
    bytes: Buffer.from(bytes).toString('base64')
  }));
}

function rolloverDisposalInventoryStableDigest(
  inventory: Omit<DependencyTransitionRolloverDisposalInventory, 'inventoryDigest'>
): `sha256:${string}` {
  return generatedStateDigest(Object.freeze({
    schema: inventory.schema,
    intentDigest: inventory.intentDigest,
    archivePhysical: inventory.archivePhysical,
    ledgerDigest: inventory.ledgerDigest,
    recordCount: inventory.recordCount,
    entries: inventory.entries
  }));
}

function parseDependencyTransitionRolloverDisposalInventory(
  bytes: Uint8Array,
  expectedName: string,
  intent: DependencyTransitionRolloverIntent,
  archivePhysical: Readonly<GeneratedStatePhysicalIdentity>
): DependencyTransitionRolloverDisposalInventory {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch (error) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory is not JSON', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (!hasExactObjectKeys(value, DEPENDENCY_TRANSITION_ROLLOVER_DISPOSAL_INVENTORY_KEYS)) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory has noncanonical keys');
  }
  const inventory = value as unknown as DependencyTransitionRolloverDisposalInventory;
  if (inventory.schema !== DEPENDENCY_TRANSITION_ROLLOVER_DISPOSAL_INVENTORY_SCHEMA ||
      !isSha256Digest(inventory.inventoryDigest) ||
      !isSha256Digest(inventory.intentDigest) ||
      !isCanonicalGeneratedStatePhysicalIdentity(inventory.archivePhysical) ||
      !isSha256Digest(inventory.ledgerDigest) ||
      !Number.isSafeInteger(inventory.recordCount) || inventory.recordCount < 1 ||
      inventory.recordCount > DEPENDENCY_TRANSITION_RECORD_CAPACITY ||
      !Array.isArray(inventory.entries) || inventory.entries.length !== inventory.recordCount ||
      inventory.entries.some((entry) => !hasExactObjectKeys(entry, DEPENDENCY_TRANSITION_ROLLOVER_DISPOSAL_INVENTORY_ENTRY_KEYS) ||
        typeof entry.relativePath !== 'string' || !/^record-[0-9a-f]{64}\.json$/u.test(entry.relativePath) ||
        typeof entry.device !== 'string' || entry.device.length === 0 ||
        typeof entry.inode !== 'string' || entry.inode.length === 0 ||
        !isSha256Digest(entry.recordDigest) || !isSha256Digest(entry.bytesDigest))) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory fields are invalid');
  }
  const entries = [...inventory.entries].sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath));
  if (entries.some((entry, index) => entry !== inventory.entries[index])) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory entries are not canonicalized');
  }
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1]!.relativePath === entries[index]!.relativePath) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory contains duplicate record names');
    }
  }
  if (inventory.intentDigest !== intent.intentDigest ||
      !sameGeneratedStateIdentity(inventory.archivePhysical, archivePhysical) ||
      inventory.recordCount !== intent.recordCount || inventory.ledgerDigest !== intent.ledgerDigest ||
      rolloverDisposalInventoryStableDigest(inventory) !== inventory.inventoryDigest ||
      expectedName !== rolloverDisposalInventoryName(intent) ||
      formatJsonFile(canonicalJson(inventory)) !== Buffer.from(bytes).toString('utf8')) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory binding is invalid');
  }
  return Object.freeze({ ...inventory, entries: Object.freeze(entries) });
}

async function inspectDependencyTransitionRolloverArchive(
  archive: PhysicalDirectoryIdentity,
  intent: DependencyTransitionRolloverIntent,
  options: RuntimeDependencyOperationOptions
): Promise<readonly DependencyTransitionRolloverArchiveEntry[]> {
  const names = await readNoFollowDirectNames(
    archive,
    'Dependency transition retired records archive',
    intent.recordCount + 2,
    options
  );
  const records = new Map<`sha256:${string}`, DependencyTransitionJournal>();
  const entries: DependencyTransitionRolloverArchiveEntry[] = [];
  const inventoryName = rolloverDisposalInventoryName(intent);
  let inventory: DependencyTransitionRolloverDisposalInventory | null = null;
  for (const name of names) {
    if (name === inventoryName) {
      const inventoryEntry = inspectNoFollowOrdinaryFileEntry(archive, name);
      if (inventoryEntry === null || inventoryEntry.bytes === null || inventoryEntry.kind !== 'file') {
        throw new SecError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory disappeared or is not an ordinary file');
      }
      if (inventory !== null) {
        throw new SecError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory is duplicated');
      }
      inventory = parseDependencyTransitionRolloverDisposalInventory(
        inventoryEntry.bytes,
        name,
        intent,
        generatedStatePhysicalIdentity(archive)
      );
      continue;
    }
    if (!/^record-[0-9a-f]{64}\.json$/u.test(name)) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition retired records contain unknown residue', { name });
    }
    const entry = inspectNoFollowOrdinaryFileEntry(archive, name);
    if (entry === null || entry.bytes === null || entry.kind !== 'file') {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition retired record disappeared or is not an ordinary file', { name });
    }
    const record = parseDependencyTransitionRecord(entry.bytes, name);
    if (records.has(record.recordDigest)) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition retired records contain a duplicate digest', { name });
    }
    records.set(record.recordDigest, record);
    entries.push(Object.freeze({
      relativePath: name,
      device: entry.device,
      inode: entry.inode,
      recordDigest: record.recordDigest,
      bytesDigest: rolloverDisposalInventoryBytesDigest(entry.bytes)
    }));
  }
  if (records.size !== intent.recordCount ||
      dependencyTransitionLedgerDigest(records) !== intent.ledgerDigest ||
      !records.has(intent.terminalRecordDigest)) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition retired records ledger digest differs and is preserved', {
      expectedLedgerDigest: intent.ledgerDigest,
      recordCount: intent.recordCount,
      observedRecordCount: records.size,
      terminalRecordDigest: intent.terminalRecordDigest
    });
  }
  if (inventory !== null && (
    inventory.entries.length !== entries.length ||
    inventory.entries.some((expected, index) => {
      const actual = entries.find((entry) => entry.relativePath === expected.relativePath);
      return actual === undefined || actual.device !== expected.device || actual.inode !== expected.inode ||
        actual.recordDigest !== expected.recordDigest || actual.bytesDigest !== expected.bytesDigest;
    })
  )) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory does not match its untouched archive');
  }
  return Object.freeze(entries.sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath)));
}

async function ensureDependencyTransitionRolloverDisposalInventory(
  archive: PhysicalDirectoryIdentity,
  intent: DependencyTransitionRolloverIntent,
  options: RuntimeDependencyOperationOptions
): Promise<DependencyTransitionRolloverDisposalInventory> {
  const inventoryName = rolloverDisposalInventoryName(intent);
  const existing = inspectNoFollowOrdinaryFileEntry(archive, inventoryName);
  if (existing !== null) {
    if (existing.bytes === null || existing.kind !== 'file') {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory is foreign and preserved');
    }
    const inventory = parseDependencyTransitionRolloverDisposalInventory(
      existing.bytes,
      inventoryName,
      intent,
      generatedStatePhysicalIdentity(archive)
    );
    // A crash may have removed any prefix of the inventoried records before
    // the disposal receipt advanced.  The immutable inventory is the
    // closed-world authority for that effect: validate only the exact
    // remaining subset, preserving missing entries as already-disposed
    // evidence.  Requiring the full archive here would make a crash after the
    // first leaf permanently unrecoverable.
    await assertDependencyTransitionRolloverArchiveSubset(archive, inventory, inventoryName, options);
    return inventory;
  }
  const entries = await inspectDependencyTransitionRolloverArchive(archive, intent, options);
  const inventoryUnsigned: Omit<DependencyTransitionRolloverDisposalInventory, 'inventoryDigest'> = Object.freeze({
    schema: DEPENDENCY_TRANSITION_ROLLOVER_DISPOSAL_INVENTORY_SCHEMA,
    intentDigest: intent.intentDigest,
    archivePhysical: generatedStatePhysicalIdentity(archive),
    ledgerDigest: intent.ledgerDigest,
    recordCount: intent.recordCount,
    entries
  });
  const inventory = Object.freeze({
    ...inventoryUnsigned,
    inventoryDigest: rolloverDisposalInventoryStableDigest(inventoryUnsigned)
  });
  const bytes = Buffer.from(formatJsonFile(canonicalJson(inventory)), 'utf8');
  await runtimeDependencyOperationEffectFence(options, 'Dependency rollover disposal inventory publication');
  writeDurableTransitionFile(
    archive,
    inventoryName,
    bytes,
    (candidate) => parseDependencyTransitionRolloverDisposalInventory(
      candidate,
      inventoryName,
      intent,
      generatedStatePhysicalIdentity(archive)
    ),
    true
  );
  const readback = inspectNoFollowOrdinaryFileEntry(archive, inventoryName);
  if (readback === null || readback.bytes === null) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory disappeared after publication');
  }
  return parseDependencyTransitionRolloverDisposalInventory(
    readback.bytes,
    inventoryName,
    intent,
    generatedStatePhysicalIdentity(archive)
  );
}

async function assertDependencyTransitionRolloverArchiveSubset(
  archive: PhysicalDirectoryIdentity,
  inventory: DependencyTransitionRolloverDisposalInventory,
  inventoryName: string,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const names = await readNoFollowDirectNames(
    archive,
    'Dependency transition retired records archive inventoried subset',
    inventory.recordCount + 1,
    options
  );
  const expectedByName = new Map(inventory.entries.map((entry) => [entry.relativePath, entry]));
  for (const name of names) {
    if (name === inventoryName) continue;
    const expected = expectedByName.get(name);
    if (expected === undefined) {
      throw new SecError(
        'RUNTIME-DEPS-004',
        'Dependency transition retired records contain foreign residue outside the disposal inventory',
        { name }
      );
    }
    const entry = inspectNoFollowOrdinaryFileEntry(archive, name);
    if (entry === null || entry.kind !== 'file' || entry.bytes === null ||
        entry.device !== expected.device || entry.inode !== expected.inode ||
        rolloverDisposalInventoryBytesDigest(entry.bytes) !== expected.bytesDigest) {
      throw new SecError(
        'RUNTIME-DEPS-004',
        'Dependency transition retired record changed after disposal inventory publication',
        { name }
      );
    }
    const record = parseDependencyTransitionRecord(entry.bytes, name);
    if (record.recordDigest !== expected.recordDigest) {
      throw new SecError(
        'RUNTIME-DEPS-004',
        'Dependency transition retired record digest differs from disposal inventory',
        { name }
      );
    }
  }
}

async function disposeDependencyTransitionRolloverArchive(
  namespace: DependencyTransitionRolloverNamespace,
  intent: DependencyTransitionRolloverIntent,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const archiveName = path.basename(intent.retiredRecordsPath);
  const archive = inspectOptionalNoFollowDirectoryChild(
    namespace.rolloversRoot,
    archiveName,
    'Dependency transition retired records archive'
  );
  if (archive === null) return;
  if (intent.retiredRecordsPhysical === null ||
      !sameGeneratedStateIdentity(generatedStatePhysicalIdentity(archive), intent.retiredRecordsPhysical)) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition retired records archive identity changed and is preserved');
  }
  const inventoryName = rolloverDisposalInventoryName(intent);
  const inventoryEntry = inspectNoFollowOrdinaryFileEntry(archive, inventoryName);
  if (inventoryEntry === null || inventoryEntry.bytes === null || inventoryEntry.kind !== 'file') {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory is absent; archive is preserved');
  }
  const inventory = parseDependencyTransitionRolloverDisposalInventory(
    inventoryEntry.bytes,
    inventoryName,
    intent,
    generatedStatePhysicalIdentity(archive)
  );
  const names = await readNoFollowDirectNames(
    archive,
    'Dependency transition retired records archive disposal',
    intent.recordCount + 2,
    options
  );
  const expectedByName = new Map(inventory.entries.map((entry) => [entry.relativePath, entry]));
  for (const name of names) {
    if (name === inventoryName) continue;
    const expected = expectedByName.get(name);
    if (expected === undefined) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition retired records contain foreign residue during disposal', { name });
    }
    const entry = inspectNoFollowOrdinaryFileEntry(archive, name);
    if (entry === null || entry.bytes === null || entry.kind !== 'file' ||
        entry.device !== expected.device || entry.inode !== expected.inode ||
        rolloverDisposalInventoryBytesDigest(entry.bytes) !== expected.bytesDigest) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition retired record changed after disposal inventory publication', { name });
    }
    await runtimeDependencyOperationEffectFence(options, 'Dependency transition retired record disposal');
    deleteRetainedNoFollowEntry({
      root: archive,
      relativePath: name,
      kind: 'file',
      device: expected.device,
      inode: expected.inode,
      ancestorDirectories: Object.freeze([])
    });
  }
  const remainingNames = await readNoFollowDirectNames(
    archive,
    'Dependency transition retired records archive disposal readback',
    intent.recordCount + 2,
    options
  );
  if (remainingNames.length !== 1 || remainingNames[0] !== inventoryName) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition retired archive contains unexpected residue after record disposal', {
      remainingNames
    });
  }
  const inventoryAfter = inspectNoFollowOrdinaryFileEntry(archive, inventoryName);
  if (inventoryAfter === null || inventoryAfter.bytes === null || inventoryAfter.kind !== 'file' ||
      !Buffer.from(inventoryAfter.bytes).equals(Buffer.from(inventoryEntry.bytes))) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory changed before archive retirement');
  }
  await runtimeDependencyOperationEffectFence(options, 'Dependency transition rollover inventory disposal');
  deleteRetainedNoFollowEntry({
    root: archive,
    relativePath: inventoryName,
    kind: 'file',
    device: inventoryEntry.device,
    inode: inventoryEntry.inode,
    ancestorDirectories: Object.freeze([])
  });
  const archiveAfter = inspectOptionalNoFollowDirectoryChild(
    namespace.rolloversRoot,
    archiveName,
    'Dependency transition retired records archive after descendant disposal'
  );
  if (archiveAfter === null || !sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(archiveAfter),
    intent.retiredRecordsPhysical
  )) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition retired records archive disappeared before root disposal');
  }
  await runtimeDependencyOperationEffectFence(options, 'Dependency transition rollover archive disposal');
  deleteRetainedNoFollowEntry({
    root: namespace.rolloversRoot,
    relativePath: archiveName,
    kind: 'directory',
    device: intent.retiredRecordsPhysical.device,
    inode: intent.retiredRecordsPhysical.inode,
    ancestorDirectories: Object.freeze([])
  });
  if (inspectOptionalNoFollowDirectoryChild(
    namespace.rolloversRoot,
    archiveName,
    'Dependency transition retired records archive final readback'
  ) !== null) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition retired records archive remains after disposal');
  }
}

async function assertDependencyTransitionTerminalReadback(
  terminal: DependencyTransitionJournal,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition terminal readback admission');
  const destination = await observeDependencyTransitionSlot(
    terminal.destination.path,
    terminal.destination.bindingDigest
  );
  if (!transitionSlotMatches(destination, terminal.destination)) {
    throw new SecError('RUNTIME-DEPS-004', 'Terminal dependency transition destination or binding readback drifted');
  }
  const source = await observeDependencyTransitionSlot(terminal.sourceGeneration.sourcePath);
  if (source.kind !== 'directory' || source.physical === null ||
      !sameGeneratedStateIdentity(source.physical, terminal.sourceGeneration.physical)) {
    throw new SecError('RUNTIME-DEPS-004', 'Terminal dependency transition source generation readback drifted');
  }
}

async function writeDependencyTransitionRolloverIntentPhase(
  namespace: DependencyTransitionRolloverNamespace,
  intent: DependencyTransitionRolloverIntent,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  await runtimeDependencyOperationEffectFence(options, `Dependency transition rollover ${intent.phase} receipt publication`);
  const bytes = Buffer.from(formatJsonFile(canonicalJson(intent)), 'utf8');
  writeDurableTransitionFile(
    namespace.rolloversRoot,
    rolloverIntentFileName(intent.intentDigest, intent.phase),
    bytes,
    assertDependencyTransitionRolloverIntentBytes,
    true
  );
  runtimeDependencyOperationRemainingMs(options, `Dependency transition rollover ${intent.phase} receipt readback`);
}

export type DependencyTransitionRolloverObservation = Readonly<{
  namespace: DependencyTransitionRolloverNamespace;
  active: DependencyTransitionRolloverIntent | null;
  latestComplete: DependencyTransitionRolloverIntent | null;
}>;

const DEPENDENCY_TRANSITION_ROLLOVER_PHASE_ORDER: Readonly<Record<DependencyTransitionRolloverPhase, number>> =
  Object.freeze({
    prepared: 0,
    staged: 1,
    'backed-up': 2,
    published: 3,
    retiring: 4,
    retired: 5,
    complete: 6
  });

export async function inspectActiveDependencyTransitionRollover(
  ownerRoot: string,
  options: RuntimeDependencyOperationOptions
): Promise<DependencyTransitionRolloverObservation | null> {
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition rollover census admission');
  const namespace = inspectDependencyTransitionRolloverNamespace(ownerRoot);
  if (namespace === null) return null;
  const names = await readNoFollowDirectNames(
    namespace.rolloversRoot,
    'Dependency transition rollover namespace',
    DEPENDENCY_TRANSITION_ROLLOVER_NAMESPACE_CAPACITY,
    options
  );
  const phasePattern = /^rollover-[0-9a-f]{64}-(prepared|staged|backed-up|published|retiring|retired|complete)\.json$/u;
  const residuePattern = /^records-(?:retired|next)-[0-9a-f]{48}$/u;
  const grouped = new Map<string, Map<DependencyTransitionRolloverPhase, DependencyTransitionRolloverIntent>>();
  const referencedResidue = new Set<string>();
  for (const name of names) {
    if (residuePattern.test(name)) {
      referencedResidue.add(name);
      continue;
    }
    if (!phasePattern.test(name)) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover namespace contains unknown residue', {
        name
      });
    }
    const entry = inspectNoFollowOrdinaryFileEntry(namespace.rolloversRoot, name);
    if (entry === null || entry.bytes === null) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover intent disappeared during census', { name });
    }
    const intent = parseDependencyTransitionRolloverIntent(entry.bytes, name);
    if (intent.ownerRoot !== namespace.ownerRoot.path || intent.recordsRootPath !== namespace.recordsRootPath) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover intent belongs to a foreign topology', { name });
    }
    const phases = grouped.get(intent.intentDigest) ?? new Map<DependencyTransitionRolloverPhase, DependencyTransitionRolloverIntent>();
    if (phases.has(intent.phase)) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover phase is duplicated', {
        intentDigest: intent.intentDigest,
        phase: intent.phase
      });
    }
    phases.set(intent.phase, intent);
    grouped.set(intent.intentDigest, phases);
  }

  let active: DependencyTransitionRolloverIntent | null = null;
  const latestIntents: DependencyTransitionRolloverIntent[] = [];
  const referencedNames = new Set<string>();
  for (const phases of grouped.values()) {
    const ordered = [...phases.values()].sort((left, right) =>
      DEPENDENCY_TRANSITION_ROLLOVER_PHASE_ORDER[left.phase] -
      DEPENDENCY_TRANSITION_ROLLOVER_PHASE_ORDER[right.phase]
    );
    if (ordered[0]?.phase !== 'prepared') {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover chain has no prepared phase');
    }
    for (let index = 0; index < ordered.length; index += 1) {
      if (DEPENDENCY_TRANSITION_ROLLOVER_PHASE_ORDER[ordered[index]!.phase] !== index) {
        throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover chain skips a phase');
      }
      if (index > 0 && ordered[index]!.intentDigest !== ordered[index - 1]!.intentDigest) {
        throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover chain changed intent identity');
      }
    }
    const latest = ordered.at(-1)!;
    latestIntents.push(latest);
    if (!latest.retiredRecordsDisposed) {
      referencedNames.add(path.basename(latest.retiredRecordsPath));
    }
    if (latest.nextRecordsPhysical !== null) {
      referencedNames.add(path.basename(latest.nextRecordsPath));
    }
  }
  for (const name of referencedResidue) {
    if (!referencedNames.has(name)) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover residue is foreign and preserved', { name });
    }
  }
  if (latestIntents.length === 0) {
    return Object.freeze({ namespace, active: null, latestComplete: null });
  }
  const intentByDigest = new Map(latestIntents.map((intent) => [intent.intentDigest, intent]));
  const childByPredecessor = new Map<`sha256:${string}`, `sha256:${string}`>();
  const roots: DependencyTransitionRolloverIntent[] = [];
  for (const intent of latestIntents) {
    if (intent.previousIntentDigest === null) {
      if (intent.sequence !== 1) {
        throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover root sequence is not one');
      }
      roots.push(intent);
      continue;
    }
    const predecessor = intentByDigest.get(intent.previousIntentDigest);
    if (predecessor === undefined || predecessor.sequence !== intent.sequence - 1) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover predecessor is missing or has an invalid sequence');
    }
    const existingChild = childByPredecessor.get(intent.previousIntentDigest);
    if (existingChild !== undefined && existingChild !== intent.intentDigest) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover predecessor has a forked child');
    }
    childByPredecessor.set(intent.previousIntentDigest, intent.intentDigest);
  }
  if (roots.length !== 1) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover receipts contain multiple roots');
  }
  const visited = new Set<`sha256:${string}`>();
  let cursor: DependencyTransitionRolloverIntent | undefined = roots[0];
  while (cursor !== undefined) {
    if (visited.has(cursor.intentDigest)) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover receipts contain a cycle');
    }
    visited.add(cursor.intentDigest);
    const childDigest = childByPredecessor.get(cursor.intentDigest);
    cursor = childDigest === undefined ? undefined : intentByDigest.get(childDigest);
    if (childDigest !== undefined && cursor === undefined) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover child disappeared during census');
    }
  }
  if (visited.size !== latestIntents.length) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover receipts contain a disconnected epoch');
  }
  const tips = latestIntents.filter((intent) => !childByPredecessor.has(intent.intentDigest));
  if (tips.length !== 1) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover receipts do not have one maximal tip');
  }
  const tip = tips[0]!;
  if (tip.phase !== 'complete') {
    active = tip;
  }
  for (const intent of latestIntents) {
    if (intent.phase !== 'complete' && intent.intentDigest !== tip.intentDigest) {
      throw new SecError('RUNTIME-DEPS-004', 'Multiple incomplete dependency transition rollovers require owner recovery');
    }
  }
  const completeIntents = latestIntents.filter((intent) => intent.phase === 'complete');
  let latestComplete: DependencyTransitionRolloverIntent | null = null;
  for (const intent of completeIntents) {
    if (latestComplete !== null && latestComplete.sequence === intent.sequence) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover complete receipts fork at one sequence');
    }
    if (latestComplete === null || intent.sequence > latestComplete.sequence) latestComplete = intent;
  }
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition rollover census readback');
  return Object.freeze({ namespace, active, latestComplete });
}

export async function recoverDependencyTransitionRollover(
  ownerRoot: string,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition rollover recovery admission');
  const observation = await inspectActiveDependencyTransitionRollover(ownerRoot, options);
  if (observation === null || observation.active === null) return;
  const { namespace } = observation;
  let intent = observation.active;
  assertDependencyTransitionRolloverOwner(namespace, intent);
  const journalRoot = assertSameNoFollowDirectoryIdentity(
    namespace.journalRoot,
    'Dependency transition rollover journal root recovery'
  ).target;
  const rolloversRoot = assertSameNoFollowDirectoryIdentity(
    namespace.rolloversRoot,
    'Dependency transition rollover namespace recovery'
  ).target;
  if (!sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(journalRoot),
    generatedStatePhysicalIdentity(namespace.journalRoot)
  ) || !sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(rolloversRoot),
    generatedStatePhysicalIdentity(namespace.rolloversRoot)
  )) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover namespace identity changed before recovery');
  }

  const retiredName = path.basename(intent.retiredRecordsPath);
  const nextName = path.basename(intent.nextRecordsPath);
  const sourceRecordsPhysical = intent.sourceRecordsRootPhysical;
  const expectedNextPhysical = intent.nextRecordsPhysical;

  // A prepared receipt is still before the source move.  Authenticate the
  // complete source ledger before creating any recovery residue; caller-supplied
  // fields in a forged self-digest intent must never become an archive or
  // checkpoint authority.
  if (intent.phase === 'prepared') {
    const source = inspectOptionalNoFollowDirectoryChild(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition rollover prepared source records'
    );
    const retainedSource = assertDependencyTransitionRolloverDirectory(
      source,
      sourceRecordsPhysical,
      'Dependency transition rollover prepared source records'
    );
    const sourceLedger = readDependencyTransitionRecordSet(
      retainedSource,
      namespace.ownerRoot.path,
      runtimeDependencyOperationContext(options),
      'Dependency transition rollover prepared source ledger'
    );
    assertDependencyTransitionRolloverLedgerBinding(
      sourceLedger,
      intent,
      'Dependency transition rollover prepared source ledger'
    );
  }

  if (intent.phase === 'prepared') {
    let next = inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      nextName,
      'Dependency transition rollover next records'
    );
    if (next !== null) {
      const names = await readNoFollowDirectNames(
        next,
        'Dependency transition rollover next records pre-staged contents',
        2,
        options
      );
      const expectedCheckpointName = transitionRecordName(intent.checkpoint.recordDigest);
      if (names.length > 1 || names.length === 1 && names[0] !== expectedCheckpointName) {
        throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover next records contain unknown pre-staged residue');
      }
    }
    if (expectedNextPhysical !== null) {
      throw new SecError('RUNTIME-DEPS-004', 'Prepared dependency transition rollover unexpectedly contains a next-root identity');
    }
    if (next === null) {
      await runtimeDependencyOperationEffectFence(options, 'Dependency transition rollover recovery next-root creation');
    }
    const stagedNext = next ?? createExclusiveNoFollowDirectory(rolloversRoot, nextName);
    const staged = advanceDependencyTransitionRolloverIntent(intent, 'staged', {
      retiredRecordsPhysical: null,
      retiredRecordsDisposed: false,
      nextRecordsPhysical: generatedStatePhysicalIdentity(stagedNext),
      publishedRecordsRootPhysical: null
    });
    await writeDependencyTransitionRolloverIntentPhase(namespace, staged, options);
    intent = staged;
  }

  if (intent.phase === 'staged') {
    const next = assertDependencyTransitionRolloverDirectory(
      inspectOptionalNoFollowDirectoryChild(
        rolloversRoot,
        nextName,
        'Dependency transition rollover next records'
      ),
      intent.nextRecordsPhysical,
      'Dependency transition rollover next records'
    );
    const checkpointName = transitionRecordName(intent.checkpoint.recordDigest);
    const checkpointEntry = inspectNoFollowOrdinaryFileEntry(next, checkpointName);
    if (checkpointEntry === null) {
      await runtimeDependencyOperationEffectFence(options, 'Dependency transition rollover recovery checkpoint publication');
      writeDurableTransitionFile(
        next,
        checkpointName,
        dependencyTransitionRecordBytes(intent.checkpoint),
        assertDependencyTransitionRecordBytes,
        true
      );
    }
    await assertDependencyTransitionRolloverCheckpoint(next, intent, options);
    // Re-read the source/archive immediately before the move.  If a previous
    // process already completed that effect, the operation-owned retired root
    // is the only acceptable evidence; a missing/foreign root is preserved.
    const sourceBeforeMove = inspectOptionalNoFollowDirectoryChild(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition rollover source records before archive move'
    );
    if (sourceBeforeMove !== null) {
      const retainedSourceBeforeMove = assertDependencyTransitionRolloverDirectory(
        sourceBeforeMove,
        sourceRecordsPhysical,
        'Dependency transition rollover source records before archive move'
      );
      const sourceLedgerBeforeMove = readDependencyTransitionRecordSet(
        retainedSourceBeforeMove,
        namespace.ownerRoot.path,
        runtimeDependencyOperationContext(options),
        'Dependency transition rollover source ledger before archive move'
      );
      assertDependencyTransitionRolloverLedgerBinding(
        sourceLedgerBeforeMove,
        intent,
        'Dependency transition rollover source ledger before archive move'
      );
    }
    const retired = inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      retiredName,
      'Dependency transition rollover retired records'
    );
    if (retired === null) {
      const source = sourceBeforeMove;
      const retainedSource = assertDependencyTransitionRolloverDirectory(
        source,
        sourceRecordsPhysical,
        'Dependency transition rollover source records'
      );
      await runtimeDependencyOperationEffectFence(options, 'Dependency transition rollover archive move');
      const moved = relocateRetainedNoFollowDirectoryAcrossParents({
        directory: retainedSource,
        destinationParent: rolloversRoot,
        tombstoneName: retiredName
      });
      if (!sameGeneratedStateIdentity(generatedStatePhysicalIdentity(moved), sourceRecordsPhysical)) {
        throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover retired records identity changed during move');
      }
    } else if (!sameGeneratedStateIdentity(
      generatedStatePhysicalIdentity(retired),
      sourceRecordsPhysical
    )) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover retired records are foreign and preserved');
    }
    if (retired !== null) {
      const archivedLedger = readDependencyTransitionRecordSet(
        retired,
        namespace.ownerRoot.path,
        runtimeDependencyOperationContext(options),
        'Dependency transition rollover retired ledger'
      );
      assertDependencyTransitionRolloverLedgerBinding(
        archivedLedger,
        intent,
        'Dependency transition rollover retired ledger'
      );
    }
    const sourceAfter = inspectOptionalNoFollowDirectoryChild(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition rollover source records readback'
    );
    if (sourceAfter !== null) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover source records remain after archive move');
    }
    const retiredAfter = inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      retiredName,
      'Dependency transition rollover retired records readback'
    );
    const nextAfter = inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      nextName,
      'Dependency transition rollover next records readback'
    );
    const updated = advanceDependencyTransitionRolloverIntent(intent, 'backed-up', {
      retiredRecordsPhysical: retiredAfter === null
        ? null
        : generatedStatePhysicalIdentity(retiredAfter),
      retiredRecordsDisposed: false,
      nextRecordsPhysical: nextAfter === null
        ? null
        : generatedStatePhysicalIdentity(nextAfter),
      publishedRecordsRootPhysical: null
    });
    if (updated.retiredRecordsPhysical === null || updated.nextRecordsPhysical === null) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover archive readback is incomplete');
    }
    await writeDependencyTransitionRolloverIntentPhase(namespace, updated, options);
    intent = updated;
  }

  if (intent.phase === 'backed-up') {
    const retired = inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      retiredName,
      'Dependency transition rollover retired records'
    );
    assertDependencyTransitionRolloverDirectory(
      retired,
      intent.retiredRecordsPhysical,
      'Dependency transition rollover retired records'
    );
    const next = inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      nextName,
      'Dependency transition rollover next records'
    );
    const canonical = inspectOptionalNoFollowDirectoryChild(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition rollover canonical records'
    );
    let published: PhysicalDirectoryIdentity;
    if (canonical === null) {
      const retainedNext = assertDependencyTransitionRolloverDirectory(
        next,
        intent.nextRecordsPhysical,
        'Dependency transition rollover next records'
      );
      await assertDependencyTransitionRolloverCheckpoint(retainedNext, intent, options);
      await runtimeDependencyOperationEffectFence(options, 'Dependency transition rollover canonical records publication');
      published = relocateRetainedNoFollowDirectoryAcrossParents({
        directory: retainedNext,
        destinationParent: journalRoot,
        tombstoneName: path.basename(namespace.recordsRootPath)
      });
    } else {
      if (next !== null) {
        throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover has both next and canonical records roots');
      }
      published = assertDependencyTransitionRolloverDirectory(
        canonical,
        intent.nextRecordsPhysical,
        'Dependency transition rollover canonical records'
      );
      await assertDependencyTransitionRolloverCheckpoint(published, intent, options);
    }
    const canonicalAfter = inspectOptionalNoFollowDirectoryChild(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition rollover canonical records readback'
    );
    if (canonicalAfter === null || !sameGeneratedStateIdentity(
      generatedStatePhysicalIdentity(canonicalAfter),
      generatedStatePhysicalIdentity(published)
    )) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover canonical records identity changed during publish');
    }
    const nextAfter = inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      nextName,
      'Dependency transition rollover next records readback'
    );
    if (nextAfter !== null) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover next records remain after publish');
    }
    const updated = advanceDependencyTransitionRolloverIntent(intent, 'published', {
      retiredRecordsPhysical: intent.retiredRecordsPhysical,
      retiredRecordsDisposed: false,
      nextRecordsPhysical: null,
      publishedRecordsRootPhysical: generatedStatePhysicalIdentity(canonicalAfter)
    });
    await writeDependencyTransitionRolloverIntentPhase(namespace, updated, options);
    intent = updated;
  }

  if (intent.phase === 'published') {
    const retired = inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      retiredName,
      'Dependency transition rollover retired records'
    );
    assertDependencyTransitionRolloverDirectory(
      retired,
      intent.retiredRecordsPhysical,
      'Dependency transition rollover retired records'
    );
    const canonical = inspectOptionalNoFollowDirectoryChild(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition rollover canonical records'
    );
    const retainedCanonical = assertDependencyTransitionRolloverDirectory(
      canonical,
      intent.publishedRecordsRootPhysical,
      'Dependency transition rollover canonical records'
    );
    await assertDependencyTransitionRolloverCheckpoint(retainedCanonical, intent, options);
    if (inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      nextName,
      'Dependency transition rollover next records final readback'
    ) !== null) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover next records unexpectedly reappeared');
    }
    // Publish/read back a closed-world disposal inventory before touching any
    // archived record.  It binds every expected name, canonical bytes digest,
    // and physical identity, so a crash after any individual delete can resume
    // from the exact remaining subset without broad recursive cleanup.
    await ensureDependencyTransitionRolloverDisposalInventory(retired!, intent, options);
    const updated = advanceDependencyTransitionRolloverIntent(intent, 'retiring', {
      retiredRecordsPhysical: intent.retiredRecordsPhysical,
      retiredRecordsDisposed: false,
      nextRecordsPhysical: null,
      publishedRecordsRootPhysical: intent.publishedRecordsRootPhysical
    });
    await writeDependencyTransitionRolloverIntentPhase(namespace, updated, options);
    intent = updated;
  }

  if (intent.phase === 'retiring') {
    const retired = inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      retiredName,
      'Dependency transition retiring records archive'
    );
    if (retired !== null) {
      assertDependencyTransitionRolloverDirectory(
        retired,
        intent.retiredRecordsPhysical,
        'Dependency transition retiring records archive'
      );
      await disposeDependencyTransitionRolloverArchive(namespace, intent, options);
    }
    if (inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      retiredName,
      'Dependency transition retired records archive readback'
    ) !== null) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition retired records archive remains after retiring effect');
    }
    const canonical = inspectOptionalNoFollowDirectoryChild(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition retired canonical records'
    );
    const published = assertDependencyTransitionRolloverDirectory(
      canonical,
      intent.publishedRecordsRootPhysical,
      'Dependency transition retired canonical records'
    );
    await assertDependencyTransitionRolloverCheckpoint(published, intent, options);
    const updated = advanceDependencyTransitionRolloverIntent(intent, 'retired', {
      retiredRecordsPhysical: null,
      retiredRecordsDisposed: true,
      nextRecordsPhysical: null,
      publishedRecordsRootPhysical: intent.publishedRecordsRootPhysical
    });
    await writeDependencyTransitionRolloverIntentPhase(namespace, updated, options);
    intent = updated;
  }

  if (intent.phase === 'retired') {
    if (inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      retiredName,
      'Dependency transition retired records final archive readback'
    ) !== null) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition retired records archive reappeared');
    }
    const canonical = inspectOptionalNoFollowDirectoryChild(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition completed canonical records'
    );
    const published = assertDependencyTransitionRolloverDirectory(
      canonical,
      intent.publishedRecordsRootPhysical,
      'Dependency transition completed canonical records'
    );
    await assertDependencyTransitionRolloverCheckpoint(published, intent, options);
    const updated = advanceDependencyTransitionRolloverIntent(intent, 'complete', {
      retiredRecordsPhysical: null,
      retiredRecordsDisposed: true,
      nextRecordsPhysical: null,
      publishedRecordsRootPhysical: intent.publishedRecordsRootPhysical
    });
    await writeDependencyTransitionRolloverIntentPhase(namespace, updated, options);
  }
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition rollover recovery readback');
}

function assertDependencyTransitionRolloverLedgerBinding(
  observed: DependencyTransitionRecordSet,
  intent: DependencyTransitionRolloverIntent,
  label: string
): DependencyTransitionJournal {
  if (observed.records.size !== intent.recordCount || observed.ledgerDigest !== intent.ledgerDigest ||
      observed.tip === null || observed.tip.recordDigest !== intent.terminalRecordDigest) {
    throw new SecError('RUNTIME-DEPS-004', `${label} does not match the rollover terminal ledger receipt`, {
      expectedLedgerDigest: intent.ledgerDigest,
      observedLedgerDigest: observed.ledgerDigest,
      expectedRecordCount: intent.recordCount,
      observedRecordCount: observed.records.size,
      expectedTerminalRecordDigest: intent.terminalRecordDigest,
      observedTerminalRecordDigest: observed.tip?.recordDigest ?? null
    });
  }
  const terminal = observed.records.get(intent.terminalRecordDigest);
  if (terminal === undefined || (terminal.phase !== 'complete' && terminal.phase !== 'rolled-back')) {
    throw new SecError('RUNTIME-DEPS-004', `${label} terminal record is missing or nonterminal`);
  }
  assertDependencyTransitionRolloverCheckpointDerived(intent, terminal);
  return terminal;
}

export async function rolloverDependencyTransitionLedger(
  ownerRoot: string,
  ledger: DependencyTransitionLedger,
  terminal: DependencyTransitionJournal,
  options: RuntimeDependencyOperationOptions
): Promise<DependencyTransitionJournal> {
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition rollover admission');
  assertDependencyTransitionTerminalRolloverReady(terminal, ledger.namespace);
  if (ledger.tip?.recordDigest !== terminal.recordDigest ||
      ledger.records.size < DEPENDENCY_TRANSITION_ROLLOVER_TRIGGER ||
      ledger.records.size > DEPENDENCY_TRANSITION_RECORD_CAPACITY ||
      ledger.ledgerDigest !== dependencyTransitionLedgerDigest(ledger.records)) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition ledger rollover predecessor receipt is invalid');
  }
  // The new root is a receipt for the already authenticated terminal ledger,
  // never a caller-supplied prepared operation.  This derivation must happen
  // before the durable intent so a crash cannot turn arbitrary caller fields
  // into recovery authority.
  const checkpoint = dependencyTransitionTerminalCheckpoint(
    terminal,
    ledger.ledgerDigest
  );
  await assertDependencyTransitionTerminalReadback(terminal, options);
  for (const slot of [terminal.stage, terminal.stageRoot, terminal.backup]) {
    if (slot === null) continue;
    const current = await observeDependencyTransitionSlot(slot.path, slot.bindingDigest);
    if (!transitionSlotMatches(current, slot)) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition terminal residue changed before ledger rollover');
    }
  }
  const namespace = await ensureDependencyTransitionNamespace(ownerRoot, options);
  if (namespace.rolloversRoot === null ||
      !sameGeneratedStateIdentity(
        generatedStatePhysicalIdentity(namespace.ownerRoot),
        terminal.ownerRootPhysical
      ) ||
      !sameGeneratedStateIdentity(
        generatedStatePhysicalIdentity(namespace.recordsRoot),
        generatedStatePhysicalIdentity(ledger.namespace.recordsRoot)
      )) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition ledger namespace changed before rollover');
  }
  const priorRollover = await inspectActiveDependencyTransitionRollover(ownerRoot, options);
  if (priorRollover?.active !== null) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover already has an active recovery intent');
  }
  const previousIntentDigest = priorRollover?.latestComplete?.intentDigest ?? null;
  const sequence = (priorRollover?.latestComplete?.sequence ?? 0) + 1;
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover sequence exhausted');
  }
  const stem = rolloverResidueStem({
    previousIntentDigest,
    sequence,
    ownerRoot: namespace.ownerRoot.path,
    terminalRecordDigest: terminal.recordDigest,
    ledgerDigest: ledger.ledgerDigest,
    recordCount: ledger.records.size,
    checkpoint
  });
  const nextName = `records-next-${stem}`;
  const retiredName = `records-retired-${stem}`;
  const existingNext = inspectOptionalNoFollowDirectoryChild(
    namespace.rolloversRoot,
    nextName,
    'Dependency transition rollover next records preflight'
  );
  const existingRetired = inspectOptionalNoFollowDirectoryChild(
    namespace.rolloversRoot,
    retiredName,
    'Dependency transition rollover retired records preflight'
  );
  if (existingNext !== null || existingRetired !== null) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover residue is foreign or belongs to an unresolved prior operation', {
      nextName,
      retiredName
    });
  }
  const intent = makeDependencyTransitionRolloverIntent({
    namespace,
    terminal,
    previousIntentDigest,
    sequence,
    ledgerDigest: ledger.ledgerDigest,
    recordCount: ledger.records.size,
    checkpoint,
    nextRecordsPhysical: null
  });
  await writeDependencyTransitionRolloverIntentPhase(
    Object.freeze({
      ownerRoot: namespace.ownerRoot,
      journalRoot: namespace.journalRoot,
      rolloversRoot: namespace.rolloversRoot,
      recordsRootPath: namespace.recordsRoot.path
    }),
    intent,
    options
  );
  // The prepared intent is the durable owner receipt before any new records
  // root exists.  Recovery can therefore finish a crash after namespace
  // creation without treating an unreferenced `records-next-*` directory as
  // a foreign cleanup candidate.
  await runtimeDependencyOperationEffectFence(options, 'Dependency transition rollover next-root creation');
  const next = createExclusiveNoFollowDirectory(namespace.rolloversRoot, nextName);
  const staged = advanceDependencyTransitionRolloverIntent(intent, 'staged', {
    retiredRecordsPhysical: null,
    retiredRecordsDisposed: false,
    nextRecordsPhysical: generatedStatePhysicalIdentity(next),
    publishedRecordsRootPhysical: null
  });
  await writeDependencyTransitionRolloverIntentPhase(
    Object.freeze({
      ownerRoot: namespace.ownerRoot,
      journalRoot: namespace.journalRoot,
      rolloversRoot: namespace.rolloversRoot,
      recordsRootPath: namespace.recordsRoot.path
    }),
    staged,
    options
  );
  await runtimeDependencyOperationEffectFence(options, 'Dependency transition rollover checkpoint publication');
  writeDurableTransitionFile(
    next,
    transitionRecordName(checkpoint.recordDigest),
    dependencyTransitionRecordBytes(checkpoint),
    assertDependencyTransitionRecordBytes,
    true
  );
  await assertDependencyTransitionRolloverCheckpoint(next, staged, options);
  await recoverDependencyTransitionRollover(ownerRoot, options);
  const afterNamespace = inspectDependencyTransitionNamespace(ownerRoot);
  const afterRollover = await inspectActiveDependencyTransitionRollover(ownerRoot, options);
  if (
    afterNamespace === null ||
    afterRollover === null ||
    afterRollover.active !== null ||
    afterRollover.latestComplete === null ||
    afterRollover.latestComplete.checkpoint.recordDigest !== checkpoint.recordDigest ||
    !sameGeneratedStateIdentity(
      generatedStatePhysicalIdentity(afterNamespace.recordsRoot),
      afterRollover.latestComplete.publishedRecordsRootPhysical!
    )
  ) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition ledger rollover did not publish its checkpoint');
  }
  const after = readDependencyTransitionRecordSet(
    afterNamespace.recordsRoot,
    afterNamespace.ownerRoot.path,
    runtimeDependencyOperationContext(options),
    'Dependency transition rollover checkpoint readback'
  );
  if (
    after.tip === null ||
    after.tip.recordDigest !== checkpoint.recordDigest ||
    after.records.size !== 1 ||
    !Buffer.from(dependencyTransitionRecordBytes(after.tip)).equals(
      dependencyTransitionRecordBytes(afterRollover.latestComplete.checkpoint)
    )
  ) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition ledger rollover did not publish its checkpoint');
  }
  return after.tip;
}
