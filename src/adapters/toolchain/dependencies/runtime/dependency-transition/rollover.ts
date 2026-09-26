import path from 'node:path';
import {
  canonicalJson,
  compareCodeUnits,
  deepFreeze
} from '../../../../../contracts/canonical.ts';
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
  createExclusiveNoFollowDirectory,
  deleteRetainedNoFollowEntry,
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  type PhysicalDirectoryIdentity,
  PhysicalNoFollowError,
  relocateRetainedNoFollowDirectoryAcrossParents
} from '../../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  type RuntimeDependencyEffectFenceInput,
  runtimeDependencyEffectFenceOptions,
  type RuntimeDependencyEffectFenceOptions,
  runtimeDependencyOperationContext,
  runtimeDependencyOperationEffectFence,
  runtimeDependencyOperationRemainingMs
} from '../operation-context.ts';
import { type RuntimeDependencyOperationControlInput, runtimeDependencyOperationControls } from '../operation-controls.ts';
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
  type DependencyTransitionUnsigned,
  generatedStatePhysicalIdentity,
  hasExactObjectKeys,
  isCanonicalAbsolutePath,
  isCanonicalGeneratedStatePhysicalIdentity,
  isSha256Digest,
  sameGeneratedStateIdentity,
  transitionSlotMatches
} from './contract.ts';
import { analyzeRolloverHistory } from './rollover-history.ts';
import {
  assertRolloverPhaseAdvance,
  DEPENDENCY_TRANSITION_ROLLOVER_SCHEMA, type DependencyTransitionRolloverIntent,
  type DependencyTransitionRolloverPhase,
  isRolloverPhase, matchesRolloverPhaseState,
  rolloverIntentNameMatches
} from './rollover-phase.ts';
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

const ROLLOVER_NAMESPACE_CAPACITY = 4_096;

export type { DependencyTransitionRolloverIntent } from './rollover-phase.ts';

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
    throw new FailureError('RUNTIME-DEPS-004', 'Only a terminal dependency transition can seed a rollover checkpoint');
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
  return deepFreeze({
    ...unsigned,
    recordDigest: dependencyTransitionDigestWithoutRecord(unsigned)
  }) as DependencyTransitionJournal;
}

const ROLLOVER_KEYS = Object.freeze([
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

function parseRolloverIntent(
  bytes: Uint8Array,
  expectedName?: string
): DependencyTransitionRolloverIntent {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch (error) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover intent is not JSON', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (!hasExactObjectKeys(value, ROLLOVER_KEYS)) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover intent has noncanonical keys');
  }
  const intent = value as unknown as DependencyTransitionRolloverIntent;
  if (intent.schema !== DEPENDENCY_TRANSITION_ROLLOVER_SCHEMA ||
      !isSha256Digest(intent.intentDigest) ||
      (intent.previousIntentDigest !== null && !isSha256Digest(intent.previousIntentDigest)) ||
      !Number.isSafeInteger(intent.sequence) || intent.sequence < 1 ||
      !isRolloverPhase(intent.phase) ||
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
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover intent fields are invalid');
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
      !matchesRolloverPhaseState(intent) ||
      rolloverIntentStableDigest(intent) !== intent.intentDigest) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover intent topology or digest is invalid');
  }
  if (expectedName !== undefined && expectedName !== rolloverIntentFileName(intent.intentDigest, intent.phase)) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover intent filename does not match its digest');
  }
  if (!Buffer.from(formatJsonFile(canonicalJson(intent)), 'utf8').equals(Buffer.from(bytes))) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover intent bytes are not canonical');
  }
  return deepFreeze(intent);
}

function assertRolloverIntentBytes(bytes: Uint8Array): void {
  parseRolloverIntent(bytes);
}

type RolloverNamespace = Readonly<{
  ownerRoot: PhysicalDirectoryIdentity;
  journalRoot: PhysicalDirectoryIdentity;
  rolloversRoot: PhysicalDirectoryIdentity;
  recordsRootPath: string;
}>;

function inspectRolloverNamespace(
  ownerRoot: string
): RolloverNamespace | null {
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
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover namespace path normalization changed');
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

function makeRolloverIntent(input: Readonly<{
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
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover namespace is unavailable');
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
  return deepFreeze({
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

function advanceRolloverIntent(
  previous: DependencyTransitionRolloverIntent,
  phase: DependencyTransitionRolloverPhase,
  patch: Readonly<Partial<Pick<DependencyTransitionRolloverIntent,
    'retiredRecordsPhysical' | 'retiredRecordsDisposed' | 'nextRecordsPhysical' |
    'publishedRecordsRootPhysical'>>>
): DependencyTransitionRolloverIntent {
  const next = deepFreeze({ ...previous, phase, ...patch });
  assertRolloverPhaseAdvance(previous, next);
  if (rolloverIntentStableDigest(next) !== previous.intentDigest) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover identity changed between phases');
  }
  return next;
}

async function assertRolloverCheckpoint(
  recordsRoot: PhysicalDirectoryIdentity,
  intent: DependencyTransitionRolloverIntent,
  options: RuntimeDependencyOperationControlInput
): Promise<void> {
  const expectedName = transitionRecordName(intent.checkpoint.recordDigest);
  const names = await readNoFollowDirectNames(
    recordsRoot,
    'Dependency transition rollover checkpoint records',
    2,
    options
  );
  if (names.length !== 1 || names[0] !== expectedName) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover checkpoint directory contains unknown residue', {
      expectedName,
      names
    });
  }
  const entry = inspectNoFollowOrdinaryFileEntry(recordsRoot, expectedName);
  if (entry === null || entry.bytes === null) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover checkpoint disappeared');
  }
  const checkpoint = parseDependencyTransitionRecord(entry.bytes, expectedName);
  if (checkpoint.recordDigest !== intent.checkpoint.recordDigest ||
      !Buffer.from(entry.bytes).equals(dependencyTransitionRecordBytes(intent.checkpoint))) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover checkpoint bytes differ');
  }
}

function assertRolloverCheckpointDerived(
  intent: DependencyTransitionRolloverIntent,
  terminal: DependencyTransitionJournal
): void {
  const expected = dependencyTransitionTerminalCheckpoint(terminal, intent.ledgerDigest);
  if (!Buffer.from(dependencyTransitionRecordBytes(expected)).equals(
    dependencyTransitionRecordBytes(intent.checkpoint)
  )) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover checkpoint is not derived from its authenticated terminal ledger tip');
  }
}

function assertRolloverOwner(
  namespace: RolloverNamespace,
  intent: DependencyTransitionRolloverIntent
): void {
  if (intent.ownerRoot !== namespace.ownerRoot.path ||
      intent.recordsRootPath !== namespace.recordsRootPath ||
      !sameGeneratedStateIdentity(
        generatedStatePhysicalIdentity(namespace.ownerRoot),
        intent.ownerRootPhysical
      )) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover intent belongs to a foreign owner root');
  }
}

function assertRolloverDirectory(
  actual: PhysicalDirectoryIdentity | null,
  expected: Readonly<GeneratedStatePhysicalIdentity> | null,
  label: string
): PhysicalDirectoryIdentity {
  if (actual === null || expected === null ||
      !sameGeneratedStateIdentity(generatedStatePhysicalIdentity(actual), expected)) {
    throw new FailureError('RUNTIME-DEPS-004', `${label} is absent or has a foreign physical identity`, {
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
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition ledger reached capacity before a terminal receipt');
  }
  if (terminal.stage !== null && terminal.stage.kind !== 'absent' ||
      terminal.stageRoot !== null && terminal.stageRoot.kind !== 'absent' ||
      terminal.backup !== null && terminal.backup.kind !== 'absent') {
    throw new FailureError('RUNTIME-DEPS-004', 'Terminal dependency transition retains an unknown stage or backup residue');
  }
  if (terminal.destination.kind !== 'absent' && terminal.destination.physical === null) {
    throw new FailureError('RUNTIME-DEPS-004', 'Terminal dependency transition destination has no physical identity');
  }
  if (terminal.ownerRoot !== namespace.ownerRoot.path ||
      !sameGeneratedStateIdentity(terminal.ownerRootPhysical, generatedStatePhysicalIdentity(namespace.ownerRoot))) {
    throw new FailureError('RUNTIME-DEPS-004', 'Terminal dependency transition owner identity changed');
  }
}

type RolloverArchiveEntry = Readonly<{
  readonly relativePath: string;
  readonly device: string;
  readonly inode: string;
  readonly recordDigest: `sha256:${string}`;
  readonly bytesDigest: `sha256:${string}`;
}>;

const ROLLOVER_DISPOSAL_INVENTORY_SCHEMA =
  'sec-dependency-transition-rollover-disposal-inventory-v1' as const;

const ROLLOVER_DISPOSAL_INVENTORY_KEYS = Object.freeze([
  'archivePhysical', 'entries', 'intentDigest', 'inventoryDigest', 'ledgerDigest',
  'recordCount', 'schema'
]);

const ROLLOVER_DISPOSAL_INVENTORY_ENTRY_KEYS = Object.freeze([
  'bytesDigest', 'device', 'inode', 'recordDigest', 'relativePath'
]);

interface RolloverDisposalInventory {
  readonly schema: typeof ROLLOVER_DISPOSAL_INVENTORY_SCHEMA;
  readonly inventoryDigest: `sha256:${string}`;
  readonly intentDigest: `sha256:${string}`;
  readonly archivePhysical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly ledgerDigest: `sha256:${string}`;
  readonly recordCount: number;
  readonly entries: readonly RolloverArchiveEntry[];
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
  inventory: Omit<RolloverDisposalInventory, 'inventoryDigest'>
): `sha256:${string}` {
  return generatedStateDigest(Object.freeze({
    schema: inventory.schema,
    intentDigest: inventory.intentDigest,
    archivePhysical: canonicalJson(inventory.archivePhysical),
    ledgerDigest: inventory.ledgerDigest,
    recordCount: inventory.recordCount,
    // Preserve the v1 digest projection while matching the nested key order
    // of its canonical persisted bytes. Hashing the construction-order entries
    // made a freshly published inventory fail its own readback parser.
    entries: canonicalJson(inventory.entries)
  }));
}

function parseRolloverDisposalInventory(
  bytes: Uint8Array,
  expectedName: string,
  intent: DependencyTransitionRolloverIntent,
  archivePhysical: Readonly<GeneratedStatePhysicalIdentity>
): RolloverDisposalInventory {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch (error) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory is not JSON', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (!hasExactObjectKeys(value, ROLLOVER_DISPOSAL_INVENTORY_KEYS)) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory has noncanonical keys');
  }
  const inventory = value as unknown as RolloverDisposalInventory;
  if (inventory.schema !== ROLLOVER_DISPOSAL_INVENTORY_SCHEMA ||
      !isSha256Digest(inventory.inventoryDigest) ||
      !isSha256Digest(inventory.intentDigest) ||
      !isCanonicalGeneratedStatePhysicalIdentity(inventory.archivePhysical) ||
      !isSha256Digest(inventory.ledgerDigest) ||
      !Number.isSafeInteger(inventory.recordCount) || inventory.recordCount < 1 ||
      inventory.recordCount > DEPENDENCY_TRANSITION_RECORD_CAPACITY ||
      !Array.isArray(inventory.entries) || inventory.entries.length !== inventory.recordCount ||
      inventory.entries.some((entry) => !hasExactObjectKeys(entry, ROLLOVER_DISPOSAL_INVENTORY_ENTRY_KEYS) ||
        typeof entry.relativePath !== 'string' || !/^record-[0-9a-f]{64}\.json$/u.test(entry.relativePath) ||
        typeof entry.device !== 'string' || entry.device.length === 0 ||
        typeof entry.inode !== 'string' || entry.inode.length === 0 ||
        !isSha256Digest(entry.recordDigest) || !isSha256Digest(entry.bytesDigest))) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory fields are invalid');
  }
  const entries = [...inventory.entries].sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath));
  if (entries.some((entry, index) => entry !== inventory.entries[index])) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory entries are not canonicalized');
  }
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1]!.relativePath === entries[index]!.relativePath) {
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory contains duplicate record names');
    }
  }
  if (inventory.intentDigest !== intent.intentDigest ||
      !sameGeneratedStateIdentity(inventory.archivePhysical, archivePhysical) ||
      inventory.recordCount !== intent.recordCount || inventory.ledgerDigest !== intent.ledgerDigest ||
      rolloverDisposalInventoryStableDigest(inventory) !== inventory.inventoryDigest ||
      expectedName !== rolloverDisposalInventoryName(intent) ||
      !Buffer.from(formatJsonFile(canonicalJson(inventory)), 'utf8').equals(Buffer.from(bytes))) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory binding is invalid');
  }
  return deepFreeze({ ...inventory, entries });
}

async function inspectRolloverArchive(
  archive: PhysicalDirectoryIdentity,
  intent: DependencyTransitionRolloverIntent,
  options: RuntimeDependencyOperationControlInput
): Promise<readonly RolloverArchiveEntry[]> {
  const names = await readNoFollowDirectNames(
    archive,
    'Dependency transition retired records archive',
    intent.recordCount + 2,
    options
  );
  const records = new Map<`sha256:${string}`, DependencyTransitionJournal>();
  const entries: RolloverArchiveEntry[] = [];
  const inventoryName = rolloverDisposalInventoryName(intent);
  let inventory: RolloverDisposalInventory | null = null;
  for (const name of names) {
    runtimeDependencyOperationRemainingMs(options, 'Dependency transition archive entry observation');
    if (name === inventoryName) {
      const inventoryEntry = inspectNoFollowOrdinaryFileEntry(archive, name);
      if (inventoryEntry === null || inventoryEntry.bytes === null || inventoryEntry.kind !== 'file') {
        throw new FailureError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory disappeared or is not an ordinary file');
      }
      if (inventory !== null) {
        throw new FailureError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory is duplicated');
      }
      inventory = parseRolloverDisposalInventory(
        inventoryEntry.bytes,
        name,
        intent,
        generatedStatePhysicalIdentity(archive)
      );
      continue;
    }
    if (!/^record-[0-9a-f]{64}\.json$/u.test(name)) {
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition retired records contain unknown residue', { name });
    }
    const entry = inspectNoFollowOrdinaryFileEntry(archive, name);
    if (entry === null || entry.bytes === null || entry.kind !== 'file') {
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition retired record disappeared or is not an ordinary file', { name });
    }
    const record = parseDependencyTransitionRecord(entry.bytes, name);
    if (records.has(record.recordDigest)) {
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition retired records contain a duplicate digest', { name });
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
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition retired records ledger digest differs and is preserved', {
      expectedLedgerDigest: intent.ledgerDigest,
      recordCount: intent.recordCount,
      observedRecordCount: records.size,
      terminalRecordDigest: intent.terminalRecordDigest
    });
  }
  if (inventory !== null) {
    const entriesByName = new Map(entries.map(entry => [entry.relativePath, entry]));
    if (inventory.entries.length !== entries.length || inventory.entries.some(expected => {
      runtimeDependencyOperationRemainingMs(options, 'Dependency transition archive inventory validation');
      const actual = entriesByName.get(expected.relativePath);
      return actual === undefined || actual.device !== expected.device || actual.inode !== expected.inode ||
        actual.recordDigest !== expected.recordDigest || actual.bytesDigest !== expected.bytesDigest;
    })) {
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory does not match its untouched archive');
    }
  }
  return Object.freeze(entries.sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath)));
}

async function ensureRolloverDisposalInventory(
  archive: PhysicalDirectoryIdentity,
  intent: DependencyTransitionRolloverIntent,
  options: RuntimeDependencyEffectFenceOptions
): Promise<RolloverDisposalInventory> {
  const inventoryName = rolloverDisposalInventoryName(intent);
  const existing = inspectNoFollowOrdinaryFileEntry(archive, inventoryName);
  if (existing !== null) {
    if (existing.bytes === null || existing.kind !== 'file') {
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory is foreign and preserved');
    }
    const inventory = parseRolloverDisposalInventory(
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
    await assertRolloverArchiveSubset(archive, inventory, inventoryName, options);
    return inventory;
  }
  const entries = await inspectRolloverArchive(archive, intent, options);
  const inventoryUnsigned: Omit<RolloverDisposalInventory, 'inventoryDigest'> = Object.freeze({
    schema: ROLLOVER_DISPOSAL_INVENTORY_SCHEMA,
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
    (candidate: Uint8Array) => parseRolloverDisposalInventory(
      candidate,
      inventoryName,
      intent,
      generatedStatePhysicalIdentity(archive)
    ),
    true
  );
  const readback = inspectNoFollowOrdinaryFileEntry(archive, inventoryName);
  if (readback === null || readback.bytes === null) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory disappeared after publication');
  }
  return parseRolloverDisposalInventory(
    readback.bytes,
    inventoryName,
    intent,
    generatedStatePhysicalIdentity(archive)
  );
}

async function assertRolloverArchiveSubset(
  archive: PhysicalDirectoryIdentity,
  inventory: RolloverDisposalInventory,
  inventoryName: string,
  options: RuntimeDependencyOperationControlInput
): Promise<void> {
  const names = await readNoFollowDirectNames(
    archive,
    'Dependency transition retired records archive inventoried subset',
    inventory.recordCount + 1,
    options
  );
  const expectedByName = new Map(inventory.entries.map((entry) => [entry.relativePath, entry]));
  for (const name of names) {
    runtimeDependencyOperationRemainingMs(options, 'Dependency transition archive entry observation');
    if (name === inventoryName) continue;
    const expected = expectedByName.get(name);
    if (expected === undefined) {
      throw new FailureError(
        'RUNTIME-DEPS-004',
        'Dependency transition retired records contain foreign residue outside the disposal inventory',
        { name }
      );
    }
    const entry = inspectNoFollowOrdinaryFileEntry(archive, name);
    if (entry === null || entry.kind !== 'file' || entry.bytes === null ||
        entry.device !== expected.device || entry.inode !== expected.inode ||
        rolloverDisposalInventoryBytesDigest(entry.bytes) !== expected.bytesDigest) {
      throw new FailureError(
        'RUNTIME-DEPS-004',
        'Dependency transition retired record changed after disposal inventory publication',
        { name }
      );
    }
    const record = parseDependencyTransitionRecord(entry.bytes, name);
    if (record.recordDigest !== expected.recordDigest) {
      throw new FailureError(
        'RUNTIME-DEPS-004',
        'Dependency transition retired record digest differs from disposal inventory',
        { name }
      );
    }
  }
}

/** An archive record is accepted against its captured disposal inventory,
 * never only its name or inode. Recheck after the caller's effect fence too.
 */
function assertRolloverArchiveEntry(
  archive: PhysicalDirectoryIdentity,
  expected: RolloverArchiveEntry
): void {
  const entry = inspectNoFollowOrdinaryFileEntry(archive, expected.relativePath);
  if (entry === null || entry.bytes === null || entry.kind !== 'file' ||
      entry.device !== expected.device || entry.inode !== expected.inode ||
      rolloverDisposalInventoryBytesDigest(entry.bytes) !== expected.bytesDigest) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition retired record changed after disposal inventory publication',
      { name: expected.relativePath });
  }
}

/** The replacement checkpoint must remain available before destroying any old
 * evidence, including restart recovery. A durable retiring marker is not proof
 * that the replacement still exists after a failed or intervening operation.
 */
function assertPublishedRolloverCheckpointCurrent(
  namespace: RolloverNamespace,
  intent: DependencyTransitionRolloverIntent,
  expectedBytes: Uint8Array
): void {
  const canonical = assertRolloverDirectory(
    inspectOptionalNoFollowDirectoryChild(namespace.journalRoot, path.basename(namespace.recordsRootPath),
      'Dependency rollover checkpoint before archive disposal'),
    intent.publishedRecordsRootPhysical, 'Dependency rollover checkpoint before archive disposal');
  const entry = inspectNoFollowOrdinaryFileEntry(canonical, transitionRecordName(intent.checkpoint.recordDigest));
  if (entry === null || entry.bytes === null || entry.kind !== 'file' || !Buffer.from(entry.bytes).equals(expectedBytes)) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency rollover replacement checkpoint changed; archive is preserved');
  }
}

async function disposeRolloverArchive(
  namespace: RolloverNamespace,
  intent: DependencyTransitionRolloverIntent,
  options: RuntimeDependencyEffectFenceOptions
): Promise<void> {
  if (intent.phase !== 'retiring') throw new FailureError('RUNTIME-DEPS-004', 'Archive disposal requires a retiring receipt');
  const archiveName = path.basename(intent.retiredRecordsPath);
  const archive = inspectOptionalNoFollowDirectoryChild(namespace.rolloversRoot, archiveName,
    'Dependency transition retired records archive');
  if (archive === null) return;
  assertRolloverDirectory(archive, intent.retiredRecordsPhysical,
    'Dependency transition retired records archive');
  const checkpointBytes = dependencyTransitionRecordBytes(intent.checkpoint);
  assertPublishedRolloverCheckpointCurrent(namespace, intent, checkpointBytes);
  const inventoryName = rolloverDisposalInventoryName(intent);
  const inventoryEntry = inspectNoFollowOrdinaryFileEntry(archive, inventoryName);
  const names = await readNoFollowDirectNames(archive, 'Dependency transition retired records archive disposal',
    intent.recordCount + 2, options);
  if (inventoryEntry === null) {
    // The old implementation can crash between deleting the last inventory
    // and removing its now-empty directory. The authenticated retiring receipt
    // already binds this exact root. Resume ONLY empty-root disposal; a missing
    // inventory never authorizes touching any surviving or foreign leaf.
    if (names.length !== 0) throw new FailureError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory is absent; archive is preserved');
  } else {
    if (inventoryEntry.bytes === null || inventoryEntry.kind !== 'file') {
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory is foreign; archive is preserved');
    }
    const inventory = parseRolloverDisposalInventory(inventoryEntry.bytes, inventoryName,
      intent, generatedStatePhysicalIdentity(archive));
    const expectedByName = new Map(inventory.entries.map(entry => [entry.relativePath, entry]));
    const selected: RolloverArchiveEntry[] = [];
    // Preflight the entire remaining subset before the first deletion. Finding
    // unknown residue late must not mean earlier leaves have already gone.
    for (const name of names) {
      runtimeDependencyOperationRemainingMs(options, 'Dependency rollover disposal selection');
      if (name === inventoryName) continue;
      const expected = expectedByName.get(name);
      if (expected === undefined) throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition retired records contain foreign residue during disposal', { name });
      assertRolloverArchiveEntry(archive, expected);
      selected.push(expected);
    }
    for (const expected of selected) {
      await runtimeDependencyOperationEffectFence(options, 'Dependency transition retired record disposal');
      assertPublishedRolloverCheckpointCurrent(namespace, intent, checkpointBytes);
      assertRolloverArchiveEntry(archive, expected);
      deleteRetainedNoFollowEntry({ root: archive, relativePath: expected.relativePath, kind: 'file',
        device: expected.device, inode: expected.inode, ancestorDirectories: Object.freeze([]) });
    }
    const remaining = await readNoFollowDirectNames(archive, 'Dependency transition retired records archive disposal readback',
      intent.recordCount + 2, options);
    if (remaining.length !== 1 || remaining[0] !== inventoryName) {
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition retired archive contains unexpected residue after record disposal', { remainingNames: remaining });
    }
    await runtimeDependencyOperationEffectFence(options, 'Dependency transition rollover inventory disposal');
    assertPublishedRolloverCheckpointCurrent(namespace, intent, checkpointBytes);
    const inventoryAfter = inspectNoFollowOrdinaryFileEntry(archive, inventoryName);
    if (inventoryAfter === null || inventoryAfter.bytes === null || inventoryAfter.kind !== 'file' ||
        inventoryAfter.device !== inventoryEntry.device || inventoryAfter.inode !== inventoryEntry.inode ||
        !Buffer.from(inventoryAfter.bytes).equals(inventoryEntry.bytes)) {
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory changed before archive retirement');
    }
    deleteRetainedNoFollowEntry({ root: archive, relativePath: inventoryName, kind: 'file',
      device: inventoryEntry.device, inode: inventoryEntry.inode, ancestorDirectories: Object.freeze([]) });
  }
  await runtimeDependencyOperationEffectFence(options, 'Dependency transition rollover archive disposal');
  const finalNames = await readNoFollowDirectNames(archive, 'Dependency transition empty archive final check', 1, options);
  if (finalNames.length !== 0) throw new FailureError('RUNTIME-DEPS-004', 'Dependency rollover archive is not empty; residue is preserved');
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition empty archive disposal admission');
  // Recheck after every caller clock/fence and await. The retained empty-rmdir
  // remains responsible for rejecting a new entry or a replaced physical root.
  assertPublishedRolloverCheckpointCurrent(namespace, intent, checkpointBytes);
  assertRolloverDirectory(
    inspectOptionalNoFollowDirectoryChild(namespace.rolloversRoot, archiveName,
      'Dependency transition retired archive final disposal'), intent.retiredRecordsPhysical,
    'Dependency transition retired archive final disposal');
  deleteRetainedNoFollowEntry({ root: namespace.rolloversRoot, relativePath: archiveName, kind: 'directory',
    device: intent.retiredRecordsPhysical!.device, inode: intent.retiredRecordsPhysical!.inode,
    ancestorDirectories: Object.freeze([]) });
  if (inspectOptionalNoFollowDirectoryChild(namespace.rolloversRoot, archiveName,
    'Dependency transition retired records archive final readback') !== null) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition retired records archive remains after disposal');
  }
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition archive disposal readback');
}

async function assertDependencyTransitionTerminalReadback(
  terminal: DependencyTransitionJournal,
  options: RuntimeDependencyOperationControlInput
): Promise<void> {
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition terminal readback admission');
  const destination = await observeDependencyTransitionSlot(
    terminal.destination.path,
    terminal.destination.bindingDigest
  );
  if (!transitionSlotMatches(destination, terminal.destination)) {
    throw new FailureError('RUNTIME-DEPS-004', 'Terminal dependency transition destination or binding readback drifted');
  }
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition terminal destination readback');
  const source = await observeDependencyTransitionSlot(terminal.sourceGeneration.sourcePath);
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition terminal source readback');
  if (source.kind !== 'directory' || source.physical === null ||
      !sameGeneratedStateIdentity(source.physical, terminal.sourceGeneration.physical)) {
    throw new FailureError('RUNTIME-DEPS-004', 'Terminal dependency transition source generation readback drifted');
  }
}

async function writeRolloverIntentPhase(
  namespace: RolloverNamespace,
  intent: DependencyTransitionRolloverIntent,
  options: RuntimeDependencyEffectFenceOptions
): Promise<void> {
  const bytes = Buffer.from(formatJsonFile(canonicalJson(intent)), 'utf8');
  intent = parseRolloverIntent(bytes, rolloverIntentFileName(intent.intentDigest, intent.phase));
  await runtimeDependencyOperationEffectFence(options, `Dependency transition rollover ${intent.phase} receipt publication`);
  writeDurableTransitionFile(
    namespace.rolloversRoot,
    rolloverIntentFileName(intent.intentDigest, intent.phase),
    bytes,
    assertRolloverIntentBytes,
    true
  );
  runtimeDependencyOperationRemainingMs(options, `Dependency transition rollover ${intent.phase} receipt readback`);
}

export type DependencyTransitionRolloverObservation = Readonly<{
  namespace: RolloverNamespace;
  active: DependencyTransitionRolloverIntent | null;
  latestComplete: DependencyTransitionRolloverIntent | null;
}>;

export async function inspectActiveDependencyTransitionRollover(
  ownerRoot: string,
  inputOptions: RuntimeDependencyOperationControlInput
): Promise<DependencyTransitionRolloverObservation | null> {
  ownerRoot = path.resolve(ownerRoot);
  const options = runtimeDependencyOperationControls(inputOptions);
  const active = () => { runtimeDependencyOperationRemainingMs(options, 'Dependency transition rollover census'); };
  active();
  const namespace = inspectRolloverNamespace(ownerRoot);
  active();
  if (namespace === null) return null;
  const names = await readNoFollowDirectNames(namespace.rolloversRoot,
    'Dependency transition rollover namespace', ROLLOVER_NAMESPACE_CAPACITY, options);
  const receipts: DependencyTransitionRolloverIntent[] = [];
  const residue: string[] = [];
  for (const name of names) {
    active();
    if (/^records-(?:retired|next)-[0-9a-f]{48}$/u.test(name)) { residue.push(name); continue; }
    if (!rolloverIntentNameMatches(name)) {
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover namespace contains unknown residue', { name });
    }
    const entry = inspectNoFollowOrdinaryFileEntry(namespace.rolloversRoot, name);
    if (entry === null || entry.bytes === null || entry.kind !== 'file') {
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover intent disappeared during census', { name });
    }
    const intent = parseRolloverIntent(entry.bytes, name);
    assertRolloverOwner(namespace, intent);
    receipts.push(intent);
  }
  const history = analyzeRolloverHistory(receipts, residue, active);
  active();
  return Object.freeze({ namespace, active: history.active, latestComplete: history.latestComplete });
}

export async function recoverDependencyTransitionRollover(
  ownerRoot: string,
  inputOptions: RuntimeDependencyEffectFenceInput
): Promise<void> {
  ownerRoot = path.resolve(ownerRoot);
  const options = runtimeDependencyEffectFenceOptions(inputOptions);
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition rollover recovery admission');
  const observation = await inspectActiveDependencyTransitionRollover(ownerRoot, options);
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition recovery observation readback');
  if (observation === null || observation.active === null) return;
  const { namespace } = observation;
  let intent = observation.active;
  assertRolloverOwner(namespace, intent);
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
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover namespace identity changed before recovery');
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
    const retainedSource = assertRolloverDirectory(
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
    assertRolloverLedgerBinding(
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
        throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover next records contain unknown pre-staged residue');
      }
    }
    if (expectedNextPhysical !== null) {
      throw new FailureError('RUNTIME-DEPS-004', 'Prepared dependency transition rollover unexpectedly contains a next-root identity');
    }
    if (next === null) {
      await runtimeDependencyOperationEffectFence(options, 'Dependency transition rollover recovery next-root creation');
    }
    const stagedNext = next ?? createExclusiveNoFollowDirectory(rolloversRoot, nextName);
    const staged = advanceRolloverIntent(intent, 'staged', {
      retiredRecordsPhysical: null,
      retiredRecordsDisposed: false,
      nextRecordsPhysical: generatedStatePhysicalIdentity(stagedNext),
      publishedRecordsRootPhysical: null
    });
    await writeRolloverIntentPhase(namespace, staged, options);
    intent = staged;
  }

  if (intent.phase === 'staged') {
    const next = assertRolloverDirectory(
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
    await assertRolloverCheckpoint(next, intent, options);
    // Re-read the source/archive immediately before the move.  If a previous
    // process already completed that effect, the operation-owned retired root
    // is the only acceptable evidence; a missing/foreign root is preserved.
    const sourceBeforeMove = inspectOptionalNoFollowDirectoryChild(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition rollover source records before archive move'
    );
    if (sourceBeforeMove !== null) {
      const retainedSourceBeforeMove = assertRolloverDirectory(
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
      assertRolloverLedgerBinding(
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
      const retainedSource = assertRolloverDirectory(
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
        throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover retired records identity changed during move');
      }
    } else if (!sameGeneratedStateIdentity(
      generatedStatePhysicalIdentity(retired),
      sourceRecordsPhysical
    )) {
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover retired records are foreign and preserved');
    }
    if (retired !== null) {
      const archivedLedger = readDependencyTransitionRecordSet(
        retired,
        namespace.ownerRoot.path,
        runtimeDependencyOperationContext(options),
        'Dependency transition rollover retired ledger'
      );
      assertRolloverLedgerBinding(
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
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover source records remain after archive move');
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
    const updated = advanceRolloverIntent(intent, 'backed-up', {
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
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover archive readback is incomplete');
    }
    await writeRolloverIntentPhase(namespace, updated, options);
    intent = updated;
  }

  if (intent.phase === 'backed-up') {
    const retired = inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      retiredName,
      'Dependency transition rollover retired records'
    );
    assertRolloverDirectory(
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
      const retainedNext = assertRolloverDirectory(
        next,
        intent.nextRecordsPhysical,
        'Dependency transition rollover next records'
      );
      await assertRolloverCheckpoint(retainedNext, intent, options);
      await runtimeDependencyOperationEffectFence(options, 'Dependency transition rollover canonical records publication');
      published = relocateRetainedNoFollowDirectoryAcrossParents({
        directory: retainedNext,
        destinationParent: journalRoot,
        tombstoneName: path.basename(namespace.recordsRootPath)
      });
    } else {
      if (next !== null) {
        throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover has both next and canonical records roots');
      }
      published = assertRolloverDirectory(
        canonical,
        intent.nextRecordsPhysical,
        'Dependency transition rollover canonical records'
      );
      await assertRolloverCheckpoint(published, intent, options);
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
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover canonical records identity changed during publish');
    }
    const nextAfter = inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      nextName,
      'Dependency transition rollover next records readback'
    );
    if (nextAfter !== null) {
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover next records remain after publish');
    }
    const updated = advanceRolloverIntent(intent, 'published', {
      retiredRecordsPhysical: intent.retiredRecordsPhysical,
      retiredRecordsDisposed: false,
      nextRecordsPhysical: null,
      publishedRecordsRootPhysical: generatedStatePhysicalIdentity(canonicalAfter)
    });
    await writeRolloverIntentPhase(namespace, updated, options);
    intent = updated;
  }

  if (intent.phase === 'published') {
    const retired = inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      retiredName,
      'Dependency transition rollover retired records'
    );
    assertRolloverDirectory(
      retired,
      intent.retiredRecordsPhysical,
      'Dependency transition rollover retired records'
    );
    const canonical = inspectOptionalNoFollowDirectoryChild(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition rollover canonical records'
    );
    const retainedCanonical = assertRolloverDirectory(
      canonical,
      intent.publishedRecordsRootPhysical,
      'Dependency transition rollover canonical records'
    );
    await assertRolloverCheckpoint(retainedCanonical, intent, options);
    if (inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      nextName,
      'Dependency transition rollover next records final readback'
    ) !== null) {
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover next records unexpectedly reappeared');
    }
    // Publish/read back a closed-world disposal inventory before touching any
    // archived record.  It binds every expected name, canonical bytes digest,
    // and physical identity, so a crash after any individual delete can resume
    // from the exact remaining subset without broad recursive cleanup.
    await ensureRolloverDisposalInventory(retired!, intent, options);
    const updated = advanceRolloverIntent(intent, 'retiring', {
      retiredRecordsPhysical: intent.retiredRecordsPhysical,
      retiredRecordsDisposed: false,
      nextRecordsPhysical: null,
      publishedRecordsRootPhysical: intent.publishedRecordsRootPhysical
    });
    await writeRolloverIntentPhase(namespace, updated, options);
    intent = updated;
  }

  if (intent.phase === 'retiring') {
    const replacement = assertRolloverDirectory(
      inspectOptionalNoFollowDirectoryChild(journalRoot, path.basename(namespace.recordsRootPath),
        'Dependency transition replacement checkpoint pre-disposal'),
      intent.publishedRecordsRootPhysical, 'Dependency transition replacement checkpoint pre-disposal');
    await assertRolloverCheckpoint(replacement, intent, options);
    const retired = inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      retiredName,
      'Dependency transition retiring records archive'
    );
    if (retired !== null) {
      assertRolloverDirectory(
        retired,
        intent.retiredRecordsPhysical,
        'Dependency transition retiring records archive'
      );
      await disposeRolloverArchive(namespace, intent, options);
    }
    if (inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      retiredName,
      'Dependency transition retired records archive readback'
    ) !== null) {
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition retired records archive remains after retiring effect');
    }
    const canonical = inspectOptionalNoFollowDirectoryChild(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition retired canonical records'
    );
    const published = assertRolloverDirectory(
      canonical,
      intent.publishedRecordsRootPhysical,
      'Dependency transition retired canonical records'
    );
    await assertRolloverCheckpoint(published, intent, options);
    const updated = advanceRolloverIntent(intent, 'retired', {
      retiredRecordsPhysical: null,
      retiredRecordsDisposed: true,
      nextRecordsPhysical: null,
      publishedRecordsRootPhysical: intent.publishedRecordsRootPhysical
    });
    await writeRolloverIntentPhase(namespace, updated, options);
    intent = updated;
  }

  if (intent.phase === 'retired') {
    if (inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      retiredName,
      'Dependency transition retired records final archive readback'
    ) !== null) {
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition retired records archive reappeared');
    }
    const canonical = inspectOptionalNoFollowDirectoryChild(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition completed canonical records'
    );
    const published = assertRolloverDirectory(
      canonical,
      intent.publishedRecordsRootPhysical,
      'Dependency transition completed canonical records'
    );
    await assertRolloverCheckpoint(published, intent, options);
    const updated = advanceRolloverIntent(intent, 'complete', {
      retiredRecordsPhysical: null,
      retiredRecordsDisposed: true,
      nextRecordsPhysical: null,
      publishedRecordsRootPhysical: intent.publishedRecordsRootPhysical
    });
    await writeRolloverIntentPhase(namespace, updated, options);
  }
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition rollover recovery readback');
}

function assertRolloverLedgerBinding(
  observed: DependencyTransitionRecordSet,
  intent: DependencyTransitionRolloverIntent,
  label: string
): DependencyTransitionJournal {
  if (observed.records.size !== intent.recordCount || observed.ledgerDigest !== intent.ledgerDigest ||
      observed.tip === null || observed.tip.recordDigest !== intent.terminalRecordDigest) {
    throw new FailureError('RUNTIME-DEPS-004', `${label} does not match the rollover terminal ledger receipt`, {
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
    throw new FailureError('RUNTIME-DEPS-004', `${label} terminal record is missing or nonterminal`);
  }
  assertRolloverCheckpointDerived(intent, terminal);
  return terminal;
}

export async function rolloverDependencyTransitionLedger(
  ownerRoot: string,
  ledger: DependencyTransitionLedger,
  terminal: DependencyTransitionJournal,
  inputOptions: RuntimeDependencyEffectFenceInput
): Promise<DependencyTransitionJournal> {
  ownerRoot = path.resolve(ownerRoot);
  // Fix the caller's terminal and ledger decision before the first provider/clock.
  terminal = parseDependencyTransitionRecord(dependencyTransitionRecordBytes(terminal));
  const { namespace: observedNamespace, ledgerDigest, tip, records } = ledger;
  const recordCount = records.size;
  const observedLedgerDigest = dependencyTransitionLedgerDigest(records);
  const observedRecordsPhysical = generatedStatePhysicalIdentity(observedNamespace.recordsRoot);
  assertDependencyTransitionTerminalRolloverReady(terminal, observedNamespace);
  if (tip?.recordDigest !== terminal.recordDigest ||
      recordCount < DEPENDENCY_TRANSITION_ROLLOVER_TRIGGER ||
      recordCount > DEPENDENCY_TRANSITION_RECORD_CAPACITY ||
      ledgerDigest !== observedLedgerDigest) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition ledger rollover predecessor receipt is invalid');
  }
  const options = runtimeDependencyEffectFenceOptions(inputOptions);
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition rollover admission');
  // The new root is a receipt for the already authenticated terminal ledger,
  // never a caller-supplied prepared operation.  This derivation must happen
  // before the durable intent so a crash cannot turn arbitrary caller fields
  // into recovery authority.
  const checkpoint = dependencyTransitionTerminalCheckpoint(
    terminal,
    ledgerDigest
  );
  await assertDependencyTransitionTerminalReadback(terminal, options);
  for (const slot of [terminal.stage, terminal.stageRoot, terminal.backup]) {
    if (slot === null) continue;
    const current = await observeDependencyTransitionSlot(slot.path, slot.bindingDigest);
    if (!transitionSlotMatches(current, slot)) {
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition terminal residue changed before ledger rollover');
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
        observedRecordsPhysical
      )) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition ledger namespace changed before rollover');
  }
  const priorRollover = await inspectActiveDependencyTransitionRollover(ownerRoot, options);
  if (priorRollover !== null && priorRollover.active !== null) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover already has an active recovery intent');
  }
  const previousIntentDigest = priorRollover?.latestComplete?.intentDigest ?? null;
  const sequence = (priorRollover?.latestComplete?.sequence ?? 0) + 1;
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover sequence exhausted');
  }
  const stem = rolloverResidueStem({
    previousIntentDigest,
    sequence,
    ownerRoot: namespace.ownerRoot.path,
    terminalRecordDigest: terminal.recordDigest,
    ledgerDigest,
    recordCount,
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
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover residue is foreign or belongs to an unresolved prior operation', {
      nextName,
      retiredName
    });
  }
  const intent = makeRolloverIntent({
    namespace,
    terminal,
    previousIntentDigest,
    sequence,
    ledgerDigest,
    recordCount,
    checkpoint,
    nextRecordsPhysical: null
  });
  await writeRolloverIntentPhase(
    Object.freeze({
      ownerRoot: namespace.ownerRoot,
      journalRoot: namespace.journalRoot,
      rolloversRoot: namespace.rolloversRoot,
      recordsRootPath: namespace.recordsRoot.path
    }),
    intent,
    options
  );
  // Normal completion and restart recovery use exactly the same phase executor.
  // The prepared receipt owns the deterministic next-root path even when a
  // crash occurs after directory creation but before its staged receipt.
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
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition ledger rollover did not publish its checkpoint');
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
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition ledger rollover did not publish its checkpoint');
  }
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition rollover final readback');
  return after.tip;
}
