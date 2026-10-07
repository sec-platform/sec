import path from 'node:path';
import {
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  type PhysicalDirectoryIdentity,
  scanNoFollowDirectoryDirectMetadata
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertFreezeRetiredManifestAbsent,
  assertIndexSemanticIdentity,
  captureControlIndexSnapshot,
  captureRepositoryIndexTreeThroughExternalScratch,
  freezeRetiredManifestPath,
  materializeFreezeCandidateObjects,
  publishIndexCas,
  resolveIndexPaths
} from './document-control-index.ts';
import {
  ActivePointerPath,
  byteDigest,
  CurrentStatePath,
  decodeUtf8,
  type FreezeFault,
  type FreezeJournal,
  type FreezeJournalPhase,
  FreezeJournalRelativePath,
  type FreezeResult,
  fromBase64,
  parseFreezeJournal,
  renderFreezeJournal,
  RollingPlanPath
} from './document-control-journal-codec.ts';
import { createReadOnlyResolverGit, readControlTreeBlobs } from './document-control-observation.ts';
import {
  assertControlPlaneBinding,
  classifyInitiallyAbsentEntryTuple,
  classifyTerminalRetirementPrefix,
  type DocumentControlRecoveryTargetKey,
  type InitiallyAbsentTupleEntry,
  type InitiallyAbsentTuplePlatform,
  parseActivePointer,
  parseCurrentStateSpec,
  parseRollingPlan
} from './document-control-plane-contract.ts';
import {
  type AnchoredObjectIdentity,
  assertPosixEntryIdentity,
  assertRegularRepositoryFile,
  atomicCasNextPath,
  canonicalDirectoryBoundary,
  classifyPublishEntryState,
  createPublishTupleClassifierInput,
  defaultParentDirectoryBarrier,
  ensureSafeDirectory,
  entryRecoveryPath,
  flushPublishedFile,
  type FreezeDurabilityOptions,
  initialTupleEntryAdapter,
  inspectSafePath,
  isMissingError,
  mapDocumentPhysicalError,
  observeOptionalSafeRegularFile,
  pathComparisonValue,
  physicalIdentity,
  publishEntryNoReplaceCas,
  publishInitiallyAbsentEntryNoReplace,
  type PublishTupleClassifierInput,
  readOptionalSafeRegularFile,
  readSafeRegularFile,
  removeExactEmptyDirectory,
  removeOptionalSafeRegularFile,
  resolveRecoverableRepositoryFile,
  sameAnchoredObjectIdentity,
  scanDirectDirectoryNames
} from './document-control-publication.ts';

/**
 * One freeze journal lifecycle: closed-world recovery census, forward publication,
 * terminal readback and journal-last retirement. Keep these phases together so
 * failure after publication cannot be reclassified as an effect-free rejection.
 * PROPOSED controls may already exist when readback/settlement fails; only the
 * original operation's exact recovery evidence can settle that responsibility.
 * No timeout retry, new attempt or absent journal synthesizes prior success.
 */

async function writeAtomicCas(input: {
  repositoryRoot: string;
  filePath: string;
  targetKey: DocumentControlRecoveryTargetKey;
  pre: Buffer;
  next: Buffer;
  label: string;
  operationId: string;
  faultAfterTempWrite?: () => void;
  faultAfterPreQuarantine?: () => void;
  faultAfterNextInstall?: () => void;
  durability: FreezeDurabilityOptions;
}): Promise<void> {
  const transactionRoot = await resolveFreezeTransactionRoot(input.repositoryRoot, input.durability);
  const temporaryPath = atomicCasNextPath(input.filePath, input.operationId);
  await publishEntryNoReplaceCas({
    boundaryRoot: input.repositoryRoot,
    artifactRoot: transactionRoot,
    targetPath: input.filePath,
    targetKey: input.targetKey,
    nextPath: temporaryPath,
    pre: input.pre,
    next: input.next,
    label: input.label,
    operationId: input.operationId,
    faultAfterNextPrepared: input.faultAfterTempWrite,
    faultAfterPreQuarantine: input.faultAfterPreQuarantine,
    faultAfterNextInstall: input.faultAfterNextInstall,
    durability: input.durability
  });
}

async function resolveFreezeTransactionRoot(
  repositoryRoot: string,
  durability?: FreezeDurabilityOptions
): Promise<string> {
  return ensureSafeDirectory({
    boundaryRoot: repositoryRoot,
    directoryPath: path.join(repositoryRoot, '.tmp/codex/document-control-plane-freeze-v1'),
    label: 'Document control transaction directory',
    durability
  });
}

export async function writeFreezeJournal(
  repositoryRoot: string,
  expectedPreBytes: Buffer | null,
  journal: FreezeJournal,
  durability: FreezeDurabilityOptions,
  faultAfter?: FreezeFault
): Promise<Buffer> {
  const transactionRoot = await resolveFreezeTransactionRoot(repositoryRoot, durability);
  const journalPath = path.join(repositoryRoot, FreezeJournalRelativePath);
  const temporaryPath = `${journalPath}.${journal.operationId.slice('sha256:'.length)}.${journal.phase}.next`;
  const nextBytes = renderFreezeJournal(journal);
  const label = `Freeze journal ${journal.phase}`;
  if (expectedPreBytes === null) {
    await publishInitiallyAbsentEntryNoReplace({
      boundaryRoot: transactionRoot,
      nextPath: temporaryPath,
      targetPath: journalPath,
      targetKey: 'freeze-journal',
      next: nextBytes,
      label,
      durability
    });
  } else {
    const preQuarantineFault: Readonly<Partial<Record<FreezeJournalPhase, FreezeFault>>> = {
      'index-published': 'after-journal-index-published-pre-quarantine',
      'pointer-published': 'after-journal-pointer-published-pre-quarantine',
      'rolling-published': 'after-journal-rolling-published-pre-quarantine',
      terminal: 'after-journal-terminal-pre-quarantine'
    };
    const nextInstallFault: Readonly<Partial<Record<FreezeJournalPhase, FreezeFault>>> = {
      'index-published': 'after-journal-index-published-next-install',
      terminal: 'after-journal-terminal-next-install'
    };
    await publishEntryNoReplaceCas({
      boundaryRoot: transactionRoot,
      artifactRoot: transactionRoot,
      targetPath: journalPath,
      targetKey: 'freeze-journal',
      nextPath: temporaryPath,
      pre: expectedPreBytes,
      next: nextBytes,
      label,
      operationId: byteDigest(nextBytes),
      retainRecoveryEntries: true,
      faultAfterPreQuarantine: () => {
        const expected = preQuarantineFault[journal.phase];
        if (expected !== undefined) maybeFault(faultAfter, expected);
      },
      faultAfterNextInstall: () => {
        const expected = nextInstallFault[journal.phase];
        if (expected !== undefined) maybeFault(faultAfter, expected);
      },
      durability
    });
  }
  const readback = await readSafeRegularFile({
    boundaryRoot: transactionRoot,
    filePath: journalPath,
    label: 'Freeze journal readback'
  });
  if (!readback.equals(nextBytes)) {
    throw new Error('Freeze journal readback does not equal the exact requested NEXT bytes.');
  }
  parseFreezeJournal(readback.toString('utf8'));
  return nextBytes;
}

interface AnchoredJournalEntry {
  readonly name: string;
  readonly filePath: string;
  readonly bytes: Buffer;
  readonly identity: string;
  readonly physicalIdentity: AnchoredObjectIdentity;
}

interface AnchoredJournalDirectory {
  readonly transactionRoot: string;
  readonly names: readonly string[];
  readEntry(name: string, label: string): Promise<AnchoredJournalEntry | null>;
  listNames(): readonly string[];
}

interface FreezeJournalRecoveryState {
  readonly expectedPreBytes: Buffer | null;
  readonly nextJournal: FreezeJournal;
  readonly nextBytes: Buffer;
  readonly nextPath: string;
  readonly completionMode:
    | 'canonical-install-required'
    | 'active-next-retirement-required'
    | 'complete';
  readonly durabilityEntries: readonly AnchoredJournalEntry[];
}

export interface FreezeJournalSnapshot {
  readonly journal: FreezeJournal;
  readonly bytes: Buffer;
  readonly canonicalPresent: boolean;
  readonly recovery: FreezeJournalRecoveryState | null;
  readonly durabilityEntries: readonly AnchoredJournalEntry[];
}

export function effectiveFreezeJournal(snapshot: FreezeJournalSnapshot | null): FreezeJournal | null {
  if (snapshot === null) return null;
  return snapshot.recovery?.completionMode === 'canonical-install-required'
    ? snapshot.recovery.nextJournal
    : snapshot.journal;
}

const FreezeJournalNextPhase: Readonly<Partial<Record<FreezeJournalPhase, FreezeJournalPhase>>> = Object.freeze({
  prepared: 'index-published',
  'index-published': 'pointer-published',
  'pointer-published': 'rolling-published',
  'rolling-published': 'terminal'
});

const FreezeJournalPreviousPhase: Readonly<Partial<Record<FreezeJournalPhase, FreezeJournalPhase>>> = Object.freeze({
  'index-published': 'prepared',
  'pointer-published': 'index-published',
  'rolling-published': 'pointer-published',
  terminal: 'rolling-published'
});

const FreezeJournalRecoveryNextName = /^journal\.json\.([0-9a-f]{64})\.(prepared|index-published|pointer-published|rolling-published|terminal)\.next$/u;

const FreezeEntryRecoveryName = /^\.entry-([0-9a-f]{64})\.(pre|retired-pre|retired-next)$/u;

const FreezeJournalPhases = Object.freeze([
  'prepared',
  'index-published',
  'pointer-published',
  'rolling-published',
  'terminal'
] as const satisfies readonly FreezeJournalPhase[]);

function freezeJournalAtPhase(journal: FreezeJournal, phase: FreezeJournalPhase): FreezeJournal {
  return Object.freeze({ ...journal, phase });
}

function parseCanonicalFreezeJournalBytes(bytes: Buffer, label: string): FreezeJournal {
  const journal = parseFreezeJournal(bytes.toString('utf8'));
  if (!bytes.equals(renderFreezeJournal(journal))) {
    throw new Error(`${label} bytes are valid but noncanonical; preserving the entry.`);
  }
  return journal;
}

function assertDirectJournalEntryName(name: string, label: string): void {
  if (name.length === 0 || path.basename(name) !== name || name === '.' || name === '..') {
    throw new Error(`${label} is not an exact direct transaction entry name.`);
  }
}

async function withAnchoredJournalDirectory<T>(
  repositoryRoot: string,
  operation: (directory: AnchoredJournalDirectory) => Promise<T>
): Promise<T | null> {
  const transactionRoot = path.join(repositoryRoot, path.dirname(FreezeJournalRelativePath));
  let directoryIdentity: PhysicalDirectoryIdentity;
  try {
    directoryIdentity = inspectNoFollowDirectoryChain(
      transactionRoot,
      'Freeze journal recovery transaction directory'
    ).target;
  } catch (error) {
    if (isMissingError(error)) return null;
    return mapDocumentPhysicalError(error, {
      label: 'Freeze journal recovery transaction directory',
      targetPath: transactionRoot
    });
  }
  const listNames = (): readonly string[] => Object.freeze(
    scanNoFollowDirectoryDirectMetadata(directoryIdentity, {
      deadlineAtMs: performance.now() + 30_000,
      maximumEntries: 10_000
    }).map((entry) => entry.relativePath).sort()
  );
  const readEntry = async (name: string, label: string): Promise<AnchoredJournalEntry | null> => {
    assertDirectJournalEntryName(name, label);
    const entry = inspectNoFollowOrdinaryFileEntry(directoryIdentity, name);
    if (entry === null) return null;
    if (entry.kind !== 'file' || entry.bytes === null) {
      throw new Error(`${label} must be an exact regular file.`);
    }
    return Object.freeze({
      name,
      filePath: path.join(directoryIdentity.path, name),
      bytes: Buffer.from(entry.bytes),
      identity: `${entry.device}:${entry.inode}`,
      physicalIdentity: physicalIdentity(entry)
    });
  };
  const names = listNames();
  return operation(Object.freeze({
    transactionRoot: directoryIdentity.path,
    names,
    listNames,
    readEntry
  }));
}

function sameDirectoryNames(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

async function assertAnchoredJournalCensusStable(
  directory: AnchoredJournalDirectory,
  entries: readonly AnchoredJournalEntry[]
): Promise<void> {
  const namesReadback = directory.listNames();
  if (!sameDirectoryNames(directory.names, namesReadback)) {
    throw new Error('Freeze journal recovery census changed during its anchored readback.');
  }
  for (const entry of entries) {
    const readback = await directory.readEntry(entry.name, `${entry.name} recovery census readback`);
    if (readback === null || readback.identity !== entry.identity || !readback.bytes.equals(entry.bytes)) {
      throw new Error(`Freeze journal recovery entry changed during readback: ${entry.name}.`);
    }
  }
}

async function readJournalRecoveryEntry(
  directory: AnchoredJournalDirectory,
  filePath: string,
  expectedBytes: Buffer,
  label: string
): Promise<AnchoredJournalEntry | null> {
  const entry = await directory.readEntry(path.basename(filePath), label);
  if (entry !== null && !entry.bytes.equals(expectedBytes)) {
    throw new Error(`${label} contains unknown bytes; preserving the entry.`);
  }
  return entry;
}

function initialJournalTupleEntryAdapter(
  entry: AnchoredJournalEntry | null,
  nextBytes: Buffer
): InitiallyAbsentTupleEntry {
  return initialTupleEntryAdapter(
    entry === null
      ? Object.freeze({ bytes: null, identity: null })
      : Object.freeze({ bytes: entry.bytes, identity: entry.identity }),
    nextBytes
  );
}

async function inspectJournalTransitionRecovery(input: {
  directory: AnchoredJournalDirectory;
  journalPath: string;
  expectedPreBytes: Buffer | null;
  nextBytes: Buffer;
  canonicalEntry: AnchoredJournalEntry | null;
  nextEntry: AnchoredJournalEntry;
}): Promise<readonly AnchoredJournalEntry[]> {
  const operationId = byteDigest(input.nextBytes);
  const quarantinePath = entryRecoveryPath({
    artifactRoot: input.directory.transactionRoot,
    operationId,
    targetKey: 'freeze-journal',
    suffix: 'pre'
  });
  const retiredPrePath = entryRecoveryPath({
    artifactRoot: input.directory.transactionRoot,
    operationId,
    targetKey: 'freeze-journal',
    suffix: 'retired-pre'
  });
  const retiredNextPath = entryRecoveryPath({
    artifactRoot: input.directory.transactionRoot,
    operationId,
    targetKey: 'freeze-journal',
    suffix: 'retired-next'
  });
  const quarantine = input.expectedPreBytes === null
    ? await input.directory.readEntry(path.basename(quarantinePath), 'Freeze journal unexpected PRE quarantine')
    : await readJournalRecoveryEntry(
      input.directory,
      quarantinePath,
      input.expectedPreBytes,
      'Freeze journal exact PRE quarantine'
    );
  const retiredPre = input.expectedPreBytes === null
    ? await input.directory.readEntry(path.basename(retiredPrePath), 'Freeze journal unexpected retired PRE entry')
    : await readJournalRecoveryEntry(
      input.directory,
      retiredPrePath,
      input.expectedPreBytes,
      'Freeze journal exact retired PRE entry'
    );
  const retiredNext = input.expectedPreBytes === null
    ? await input.directory.readEntry(
        path.basename(retiredNextPath),
        'Freeze journal initially-absent retired NEXT entry'
      )
    : await readJournalRecoveryEntry(
        input.directory,
        retiredNextPath,
        input.nextBytes,
        'Freeze journal exact retired NEXT entry'
      );
  const present = [quarantine, retiredPre, retiredNext].filter(
    (entry): entry is AnchoredJournalEntry => entry !== null
  );

  if (input.expectedPreBytes === null) {
    if (quarantine !== null || retiredPre !== null) {
      throw new Error('Initially-absent freeze journal recovery has unexpected PRE artifacts; preserving them.');
    }
    const initialResolution = classifyInitiallyAbsentEntryTuple({
      platform: process.platform as InitiallyAbsentTuplePlatform,
      tuple: Object.freeze({
        target: initialJournalTupleEntryAdapter(input.canonicalEntry, input.nextBytes),
        next: initialJournalTupleEntryAdapter(input.nextEntry, input.nextBytes),
        retiredNext: initialJournalTupleEntryAdapter(retiredNext, input.nextBytes)
      })
    });
    if (initialResolution.status === 'invalid') {
      throw new Error(`Initially-absent freeze journal T/N/R contract rejected transition recovery (${initialResolution.reason}); preserving every entry.`);
    }
    return Object.freeze(present);
  }

  if (input.canonicalEntry === null) {
    if (process.platform === 'win32') {
      if (quarantine === null || retiredPre !== null || retiredNext !== null) {
        throw new Error('Windows freeze journal PRE quarantine recovery is incomplete or conflicting.');
      }
    } else if (process.platform === 'linux') {
      if (quarantine === null || retiredPre === null || retiredNext !== null
          || quarantine.identity !== retiredPre.identity) {
        throw new Error('Linux freeze journal PRE quarantine recovery is incomplete or has unprovable identity.');
      }
    }
    return Object.freeze(present);
  }

  if (input.canonicalEntry.bytes.equals(input.expectedPreBytes)) {
    if (process.platform === 'win32') {
      if (quarantine !== null || retiredPre !== null || retiredNext !== null) {
        throw new Error('Windows freeze journal pre-quarantine recovery state is conflicting.');
      }
    } else if (process.platform === 'linux') {
      if (retiredPre !== null || retiredNext !== null
          || (quarantine !== null && quarantine.identity !== input.canonicalEntry.identity)) {
        throw new Error('Linux freeze journal pre-quarantine recovery identity is conflicting.');
      }
    }
    return Object.freeze(present);
  }

  if (!input.canonicalEntry.bytes.equals(input.nextBytes)) {
    throw new Error('Canonical freeze journal is neither the exact recovery PRE nor NEXT.');
  }
  if (process.platform === 'win32') {
    if (quarantine === null || retiredPre !== null || retiredNext !== null) {
      throw new Error('Windows installed freeze journal NEXT recovery state is incomplete or conflicting.');
    }
  } else if (process.platform === 'linux') {
    if (quarantine === null || retiredPre === null || quarantine.identity !== retiredPre.identity
        || (retiredNext !== null && retiredNext.identity !== input.canonicalEntry.identity)
        || (retiredNext === null && input.nextEntry.identity !== input.canonicalEntry.identity)) {
      throw new Error('Linux installed freeze journal NEXT recovery identity is incomplete or conflicting.');
    }
  }
  return Object.freeze(present);
}

type FreezeEntryRecoverySuffix = 'pre' | 'retired-pre' | 'retired-next';

interface FreezeEntryRecoveryExpectation {
  readonly bytes: Buffer;
  readonly identityGroup: string;
}

interface FreezeEntryRecoveryNames {
  readonly pre: string;
  readonly retiredPre: string;
  readonly retiredNext: string;
}

interface FreezeEntryRecoveryCensusPlan {
  readonly expectations: ReadonlyMap<string, FreezeEntryRecoveryExpectation>;
  readonly initialRetiredNext: string;
  readonly journalTransitions: ReadonlyMap<FreezeJournalPhase, FreezeEntryRecoveryNames>;
  readonly pointer: FreezeEntryRecoveryNames | null;
  readonly rollingPlan: FreezeEntryRecoveryNames | null;
  readonly effectivePhaseIndex: number;
}

function freezeJournalPhaseIndex(phase: FreezeJournalPhase): number {
  const index = FreezeJournalPhases.indexOf(phase);
  if (index < 0) throw new Error(`Unsupported freeze journal phase for recovery census: ${phase}.`);
  return index;
}

function freezeEntryRecoveryNames(input: {
  artifactRoot: string;
  operationId: string;
  targetKey: DocumentControlRecoveryTargetKey;
}): FreezeEntryRecoveryNames {
  const name = (suffix: FreezeEntryRecoverySuffix): string => path.basename(entryRecoveryPath({
    ...input,
    suffix
  }));
  return Object.freeze({
    pre: name('pre'),
    retiredPre: name('retired-pre'),
    retiredNext: name('retired-next')
  });
}

function createFreezeEntryRecoveryCensusPlan(input: {
  repositoryRoot: string;
  transactionRoot: string;
  journalPath: string;
  journal: FreezeJournal;
}): FreezeEntryRecoveryCensusPlan {
  const phaseBytes = new Map<FreezeJournalPhase, Buffer>(FreezeJournalPhases.map((phase) => [
    phase,
    renderFreezeJournal(freezeJournalAtPhase(input.journal, phase))
  ]));
  const requirePhaseBytes = (phase: FreezeJournalPhase): Buffer => {
    const bytes = phaseBytes.get(phase);
    if (bytes === undefined) throw new Error(`Missing canonical freeze journal bytes for phase ${phase}.`);
    return bytes;
  };
  const expectations = new Map<string, FreezeEntryRecoveryExpectation>();
  const add = (name: string, bytes: Buffer, identityGroup: string): void => {
    const prior = expectations.get(name);
    if (prior !== undefined && (!prior.bytes.equals(bytes) || prior.identityGroup !== identityGroup)) {
      throw new Error(`Freeze recovery census expectation collision for ${name}.`);
    }
    expectations.set(name, Object.freeze({ bytes, identityGroup }));
  };
  const effectivePhaseIndex = freezeJournalPhaseIndex(input.journal.phase);
  const preparedBytes = requirePhaseBytes('prepared');
  const initialNames = freezeEntryRecoveryNames({
    artifactRoot: input.transactionRoot,
    operationId: byteDigest(preparedBytes),
    targetKey: 'freeze-journal'
  });
  add(initialNames.retiredNext, preparedBytes, 'journal:prepared');

  const journalTransitions = new Map<FreezeJournalPhase, FreezeEntryRecoveryNames>();
  for (let index = 1; index <= effectivePhaseIndex; index += 1) {
    const phase = FreezeJournalPhases[index]!;
    const previousPhase = FreezeJournalPhases[index - 1]!;
    const nextBytes = requirePhaseBytes(phase);
    const previousBytes = requirePhaseBytes(previousPhase);
    const names = freezeEntryRecoveryNames({
      artifactRoot: input.transactionRoot,
      operationId: byteDigest(nextBytes),
      targetKey: 'freeze-journal'
    });
    journalTransitions.set(phase, names);
    add(names.pre, previousBytes, `journal:${previousPhase}`);
    if (process.platform === 'linux') {
      add(names.retiredPre, previousBytes, `journal:${previousPhase}`);
      add(names.retiredNext, nextBytes, `journal:${phase}`);
    }
  }

  const addProjectionRecovery = (
    targetKey: DocumentControlRecoveryTargetKey,
    pre: Buffer,
    next: Buffer,
    label: string
  ): FreezeEntryRecoveryNames => {
    const names = freezeEntryRecoveryNames({
      artifactRoot: input.transactionRoot,
      operationId: input.journal.operationId,
      targetKey
    });
    add(names.pre, pre, `${label}:pre`);
    if (process.platform === 'linux') {
      add(names.retiredPre, pre, `${label}:pre`);
      add(names.retiredNext, next, `${label}:next`);
    }
    return names;
  };

  const pointerPre = fromBase64(input.journal.files.pointer.pre, 'Freeze pointer PRE recovery census');
  const pointerNext = fromBase64(input.journal.files.pointer.next, 'Freeze pointer NEXT recovery census');
  const rollingPlanPre = fromBase64(
    input.journal.files.rollingPlan.pre,
    'Freeze rolling-plan PRE recovery census'
  );
  const rollingPlanNext = fromBase64(
    input.journal.files.rollingPlan.next,
    'Freeze rolling-plan NEXT recovery census'
  );
  const pointer = effectivePhaseIndex >= freezeJournalPhaseIndex('index-published')
      && !pointerPre.equals(pointerNext)
    ? addProjectionRecovery(
        'active-pointer',
        pointerPre,
        pointerNext,
        'pointer'
      )
    : null;
  const rollingPlan = effectivePhaseIndex >= freezeJournalPhaseIndex('pointer-published')
      && !rollingPlanPre.equals(rollingPlanNext)
    ? addProjectionRecovery(
        'rolling-plan',
        rollingPlanPre,
        rollingPlanNext,
        'rolling-plan'
      )
    : null;

  if (process.platform === 'win32') {
    if (effectivePhaseIndex > freezeJournalPhaseIndex('index-published') && pointer !== null) {
      expectations.delete(pointer.pre);
    }
    if (effectivePhaseIndex > freezeJournalPhaseIndex('pointer-published') && rollingPlan !== null) {
      expectations.delete(rollingPlan.pre);
    }
  }
  return Object.freeze({
    expectations,
    initialRetiredNext: initialNames.retiredNext,
    journalTransitions,
    pointer,
    rollingPlan,
    effectivePhaseIndex
  });
}

async function assertFreezeEntryRecoveryCensus(input: {
  repositoryRoot: string;
  plan: FreezeEntryRecoveryCensusPlan;
  entries: readonly AnchoredJournalEntry[];
  canonicalEntry: AnchoredJournalEntry | null;
  canonicalJournal: FreezeJournal | null;
  nextEntry: AnchoredJournalEntry | null;
  nextJournal: FreezeJournal | null;
}): Promise<void> {
  const entries = new Map(input.entries.map((entry) => [entry.name, entry]));
  const present = (name: string): boolean => entries.has(name);
  const terminalRetirement = input.plan.effectivePhaseIndex === freezeJournalPhaseIndex('terminal')
    && (input.canonicalJournal?.phase === 'terminal' || input.nextJournal?.phase === 'terminal');
  const preparedCanonicalEntry = input.canonicalJournal?.phase === 'prepared'
    ? input.canonicalEntry
    : null;
  const preparedNextEntry = input.nextJournal?.phase === 'prepared'
    ? input.nextEntry
    : null;
  const initialPreparedBytes = preparedNextEntry?.bytes ?? preparedCanonicalEntry?.bytes ?? null;
  for (const entry of input.entries) {
    const expected = input.plan.expectations.get(entry.name);
    if (expected === undefined) {
      throw new Error(`Unbound freeze entry recovery residue is preserved: ${entry.name}.`);
    }
    if (initialPreparedBytes !== null && entry.name === input.plan.initialRetiredNext) continue;
    if (!entry.bytes.equals(expected.bytes)) {
      throw new Error(`Freeze entry recovery residue contains unknown bytes and is preserved: ${entry.name}.`);
    }
  }

  if (process.platform === 'linux') {
    const identities = new Map<string, string>();
    const bindIdentity = (group: string, identity: string, name: string): void => {
      const prior = identities.get(group);
      if (prior !== undefined && prior !== identity) {
        throw new Error(`Linux freeze entry recovery identity is unprovable for ${name}.`);
      }
      identities.set(group, identity);
    };
    if (input.canonicalEntry !== null && input.canonicalJournal !== null
        && input.canonicalJournal.phase !== 'prepared') {
      bindIdentity(`journal:${input.canonicalJournal.phase}`, input.canonicalEntry.identity, input.canonicalEntry.name);
    }
    if (input.nextEntry !== null && input.nextJournal !== null
        && input.nextJournal.phase !== 'prepared') {
      bindIdentity(`journal:${input.nextJournal.phase}`, input.nextEntry.identity, input.nextEntry.name);
    }
    for (const entry of input.entries) {
      if (initialPreparedBytes !== null && entry.name === input.plan.initialRetiredNext) continue;
      bindIdentity(input.plan.expectations.get(entry.name)!.identityGroup, entry.identity, entry.name);
    }
  }

  const requirePresent = (name: string, label: string): void => {
    if (!present(name)) throw new Error(`${label} recovery residue is missing.`);
  };
  const requireAbsent = (name: string, label: string): void => {
    if (present(name)) throw new Error(`${label} recovery residue is conflicting and preserved.`);
  };
  if (initialPreparedBytes !== null) {
    const initialRetiredNext = entries.get(input.plan.initialRetiredNext) ?? null;
    const initialResolution = classifyInitiallyAbsentEntryTuple({
      platform: process.platform as InitiallyAbsentTuplePlatform,
      tuple: Object.freeze({
        target: initialJournalTupleEntryAdapter(preparedCanonicalEntry, initialPreparedBytes),
        next: initialJournalTupleEntryAdapter(preparedNextEntry, initialPreparedBytes),
        retiredNext: initialJournalTupleEntryAdapter(initialRetiredNext, initialPreparedBytes)
      })
    });
    if (initialResolution.status === 'invalid') {
      throw new Error(`Initial prepared freeze journal T/N/R contract rejected the recovery census (${initialResolution.reason}); preserving every entry.`);
    }
  } else if (process.platform === 'linux' && !terminalRetirement) {
    requirePresent(input.plan.initialRetiredNext, 'Retained initial journal NEXT');
  } else if (!terminalRetirement) {
    requireAbsent(input.plan.initialRetiredNext, 'Retained initial journal NEXT');
  }

  for (const [phase, names] of input.plan.journalTransitions) {
    const isActive = input.nextJournal?.phase === phase;
    if (!isActive) {
      if (terminalRetirement) continue;
      requirePresent(names.pre, `${phase} journal PRE`);
      if (process.platform === 'linux') {
        requirePresent(names.retiredPre, `${phase} journal retired PRE`);
        requirePresent(names.retiredNext, `${phase} journal retired NEXT`);
      }
      continue;
    }
    if (process.platform === 'win32') {
      if (input.canonicalEntry === null) requirePresent(names.pre, `${phase} active journal PRE`);
      else requireAbsent(names.pre, `${phase} pre-quarantine journal PRE`);
      continue;
    }
    if (input.canonicalEntry === null || input.canonicalJournal?.phase === phase) {
      requirePresent(names.pre, `${phase} active journal PRE`);
      requirePresent(names.retiredPre, `${phase} active journal retired PRE`);
      requireAbsent(names.retiredNext, `${phase} active journal retired NEXT`);
    } else {
      const hasPre = present(names.pre);
      const hasRetiredPre = present(names.retiredPre);
      const hasRetiredNext = present(names.retiredNext);
      if ((hasPre || hasRetiredPre || hasRetiredNext)
          && !(hasPre && !hasRetiredPre && !hasRetiredNext)) {
        throw new Error(`${phase} pre-quarantine journal recovery residue set is incomplete or conflicting and is preserved.`);
      }
    }
  }

  const assertProjectionState = async (
    names: FreezeEntryRecoveryNames | null,
    startPhase: FreezeJournalPhase,
    label: string,
    targetPath: string
  ): Promise<void> => {
    if (names === null) return;
    const startIndex = freezeJournalPhaseIndex(startPhase);
    if (process.platform === 'win32') {
      if (terminalRetirement) return;
      if (input.plan.effectivePhaseIndex > startIndex) requireAbsent(names.pre, `${label} completed PRE`);
      return;
    }
    const hasPre = present(names.pre);
    const hasRetiredPre = present(names.retiredPre);
    const hasRetiredNext = present(names.retiredNext);
    if (input.plan.effectivePhaseIndex > startIndex) {
      if (terminalRetirement) return;
      requirePresent(names.pre, `${label} completed PRE`);
      requirePresent(names.retiredPre, `${label} completed retired PRE`);
      requirePresent(names.retiredNext, `${label} completed retired NEXT`);
    } else if (hasPre && !hasRetiredPre && !hasRetiredNext) {
      await assertPosixEntryIdentity({
        boundaryRoot: input.repositoryRoot,
        leftPath: targetPath,
        rightPath: entries.get(names.pre)!.filePath,
        label: `${label} S1 PRE recovery identity`
      });
    } else if ((hasPre || hasRetiredPre || hasRetiredNext)
        && !(hasPre && hasRetiredPre && !hasRetiredNext)
        && !(hasPre && hasRetiredPre && hasRetiredNext)) {
      throw new Error(`${label} active recovery residue set is incomplete or conflicting and is preserved.`);
    }
  };
  await assertProjectionState(
    input.plan.pointer,
    'index-published',
    'Pointer',
    path.join(input.repositoryRoot, ...ActivePointerPath.split('/'))
  );
  await assertProjectionState(
    input.plan.rollingPlan,
    'pointer-published',
    'Rolling-plan',
    path.join(input.repositoryRoot, ...RollingPlanPath.split('/'))
  );
}

interface TerminalRetirementPlanEntry {
  readonly boundaryRoot: string;
  readonly filePath: string;
  readonly label: string;
  readonly expectedBytes: Buffer;
}

async function assertTerminalRetirementPrefix(input: {
  repositoryRoot: string;
  transactionRoot: string;
  journal: FreezeJournal;
  journalBytes: Buffer;
  transactionPlan?: FreezeEntryRecoveryCensusPlan;
}): Promise<void> {
  if (input.journal.phase !== 'terminal') {
    throw new Error('Terminal retirement prefix requires one terminal journal.');
  }
  const indexPaths = await resolveIndexPaths(input.repositoryRoot);
  const indexNames = freezeEntryRecoveryNames({
    artifactRoot: indexPaths.gitDirectory,
    operationId: input.journal.operationId,
    targetKey: 'git-index'
  });
  const entries: TerminalRetirementPlanEntry[] = [];
  if (input.journal.preIndexTreeSha !== input.journal.candidateTreeSha) {
    const indexPre = fromBase64(input.journal.index.pre, 'Terminal retirement index PRE');
    const indexNext = fromBase64(input.journal.index.next, 'Terminal retirement index NEXT');
    const orderedIndexNames = process.platform === 'win32'
      ? [indexNames.pre]
      : process.platform === 'linux'
        ? [indexNames.retiredNext, indexNames.retiredPre, indexNames.pre]
        : (() => { throw new Error(`Terminal retirement is unsupported on ${process.platform}.`); })();
    for (const name of orderedIndexNames) {
      entries.push(Object.freeze({
        boundaryRoot: indexPaths.gitDirectory,
        filePath: path.join(indexPaths.gitDirectory, name),
        label: `Terminal retirement Git index ${name}`,
        expectedBytes: name === indexNames.retiredNext ? indexNext : indexPre
      }));
    }
  }
  const allowedIndexNames = new Set(entries.map((entry) => path.basename(entry.filePath)));
  const unknownIndexName = scanDirectDirectoryNames(
    indexPaths.gitDirectory,
    'Terminal retirement Git index recovery census'
  )
    .filter((name) => name.startsWith('.entry-'))
    .find((name) => !allowedIndexNames.has(name));
  if (unknownIndexName !== undefined) {
    throw new Error(`Terminal retirement found unbound Git index residue and preserves it: ${unknownIndexName}.`);
  }

  const transactionPlan = input.transactionPlan ?? createFreezeEntryRecoveryCensusPlan({
    repositoryRoot: input.repositoryRoot,
    transactionRoot: input.transactionRoot,
    journalPath: path.join(input.transactionRoot, path.basename(FreezeJournalRelativePath)),
    journal: input.journal
  });
  const transactionExpectations = [...transactionPlan.expectations.entries()]
    .filter(([name]) => process.platform !== 'win32' || name !== transactionPlan.initialRetiredNext)
    .sort(([left], [right]) => left.localeCompare(right));
  for (const [name, expectation] of transactionExpectations) {
    entries.push(Object.freeze({
      boundaryRoot: input.transactionRoot,
      filePath: path.join(input.transactionRoot, name),
      label: `Terminal retirement transaction ${name}`,
      expectedBytes: expectation.bytes
    }));
  }
  const allowedTransactionNames = new Set(transactionExpectations.map(([name]) => name));
  const unknownTransactionName = scanDirectDirectoryNames(
    input.transactionRoot,
    'Terminal retirement transaction recovery census'
  )
    .filter((name) => name.startsWith('.entry-'))
    .find((name) => !allowedTransactionNames.has(name));
  if (unknownTransactionName !== undefined) {
    throw new Error(
      `Terminal retirement found unbound transaction residue and preserves it: ${unknownTransactionName}.`
    );
  }
  entries.push(Object.freeze({
    boundaryRoot: input.transactionRoot,
    filePath: path.join(input.transactionRoot, path.basename(FreezeJournalRelativePath)),
    label: 'Terminal retirement canonical journal',
    expectedBytes: input.journalBytes
  }));

  const presence: boolean[] = [];
  for (const entry of entries) {
    const observation = await observeOptionalSafeRegularFile({
      boundaryRoot: entry.boundaryRoot,
      filePath: entry.filePath,
      label: entry.label
    });
    presence.push(observation !== null);
    if (observation !== null && !observation.bytes.equals(entry.expectedBytes)) {
      throw new Error(`${entry.label} has unknown bytes and is preserved.`);
    }
  }
  const classification = classifyTerminalRetirementPrefix(presence);
  if (classification.status === 'invalid') {
    throw new Error('Terminal retirement residue topology is not one exact canonical deletion prefix; preserving it.');
  }
}

export async function readFreezeJournalSnapshot(
  repositoryRoot: string,
  beforeCensusReadback?: () => Promise<void> | void
): Promise<FreezeJournalSnapshot | null> {
  return withAnchoredJournalDirectory(repositoryRoot, async (directory) => {
    const journalPath = path.join(directory.transactionRoot, path.basename(FreezeJournalRelativePath));
    const directEntries = new Map<string, AnchoredJournalEntry>();
    for (const name of directory.names) {
      const entry = await directory.readEntry(name, `Freeze transaction direct residue ${name}`);
      if (entry === null) throw new Error(`Freeze transaction direct residue disappeared during census: ${name}.`);
      directEntries.set(name, entry);
    }
    const relevantEntries = [...directEntries.values()];
    await beforeCensusReadback?.();
    await assertAnchoredJournalCensusStable(directory, relevantEntries);

    const canonicalEntry = directEntries.get('journal.json') ?? null;
    const journalRecoveryNames = directory.names.filter((name) => name.startsWith('journal.json.'));
    const malformedName = journalRecoveryNames.find((name) => !FreezeJournalRecoveryNextName.test(name));
    if (malformedName !== undefined) {
      throw new Error(`Unknown freeze journal recovery entry name is preserved: ${malformedName}.`);
    }
    if (journalRecoveryNames.length > 1) {
      throw new Error('Duplicate freeze journal active NEXT recovery entries are preserved.');
    }

    const canonicalJournal = canonicalEntry === null
      ? null
      : parseCanonicalFreezeJournalBytes(canonicalEntry.bytes, 'Freeze journal');
    const nextName = journalRecoveryNames[0];
    let nextEntry: AnchoredJournalEntry | null = null;
    let nextJournal: FreezeJournal | null = null;
    if (nextName !== undefined) {
      nextEntry = directEntries.get(nextName) ?? null;
      if (nextEntry === null) throw new Error('Freeze journal active NEXT recovery entry disappeared during census.');
      nextJournal = parseCanonicalFreezeJournalBytes(nextEntry.bytes, 'Freeze journal active NEXT recovery entry');
      const match = FreezeJournalRecoveryNextName.exec(nextName)!;
      if (match[1] !== nextJournal.operationId.slice('sha256:'.length) || match[2] !== nextJournal.phase) {
        throw new Error('Freeze journal active NEXT recovery filename is not bound to its operation and phase.');
      }
    }

    const entryRecoveryNames = directory.names.filter((name) => name.startsWith('.entry-'));
    const entryRecoveryEntries = entryRecoveryNames.map((name) => directEntries.get(name)!);
    const malformedEntryRecoveryName = entryRecoveryNames.find((name) => !FreezeEntryRecoveryName.test(name));
    if (malformedEntryRecoveryName !== undefined) {
      throw new Error(`Unknown freeze entry recovery residue name is preserved: ${malformedEntryRecoveryName}.`);
    }
    const unknownDirectName = directory.names.find((name) => (
      name !== 'journal.json'
      && !name.startsWith('journal.json.')
      && !name.startsWith('.entry-')
    ));

    if (canonicalJournal === null && nextJournal === null) {
      if (directory.names.length > 0) {
        throw new Error('Freeze journal is absent while direct transaction residues remain; preserving every residue.');
      }
      return null;
    }

    if (unknownDirectName !== undefined) {
      throw new Error(`Unknown freeze transaction direct residue is preserved: ${unknownDirectName}.`);
    }

    const censusJournal = nextJournal ?? canonicalJournal!;
    const censusPlan = createFreezeEntryRecoveryCensusPlan({
      repositoryRoot,
      transactionRoot: directory.transactionRoot,
      journalPath,
      journal: censusJournal
    });
    await assertFreezeEntryRecoveryCensus({
      repositoryRoot,
      plan: censusPlan,
      entries: entryRecoveryEntries,
      canonicalEntry,
      canonicalJournal,
      nextEntry,
      nextJournal
    });
    if (canonicalJournal?.phase === 'terminal' && nextJournal === null) {
      await assertTerminalRetirementPrefix({
        repositoryRoot,
        transactionRoot: directory.transactionRoot,
        journal: canonicalJournal,
        journalBytes: canonicalEntry!.bytes,
        transactionPlan: censusPlan
      });
    }

    if (canonicalJournal === null) {
      const predecessor = FreezeJournalPreviousPhase[nextJournal!.phase];
      const expectedPreBytes = predecessor === undefined
        ? null
        : renderFreezeJournal(freezeJournalAtPhase(nextJournal!, predecessor));
      const recoveryEntries = await inspectJournalTransitionRecovery({
        directory,
        journalPath,
        expectedPreBytes,
        nextBytes: nextEntry!.bytes,
        canonicalEntry: null,
        nextEntry: nextEntry!
      });
      relevantEntries.push(...recoveryEntries);
      await assertAnchoredJournalCensusStable(directory, relevantEntries);
      const recovery = Object.freeze({
        expectedPreBytes,
        nextJournal: nextJournal!,
        nextBytes: nextEntry!.bytes,
        nextPath: nextEntry!.filePath,
        completionMode: 'canonical-install-required' as const,
        durabilityEntries: Object.freeze([
          ...new Map(relevantEntries.map((entry) => [entry.filePath, entry])).values()
        ])
      });
      return Object.freeze({
        journal: nextJournal!,
        bytes: nextEntry!.bytes,
        canonicalPresent: false,
        recovery,
        durabilityEntries: recovery.durabilityEntries
      });
    }

    let recovery: FreezeJournalRecoveryState | null = null;
    if (nextJournal !== null) {
      let expectedPreBytes: Buffer | null;
      let completionMode: FreezeJournalRecoveryState['completionMode'];
      if (nextEntry!.bytes.equals(canonicalEntry!.bytes)) {
        if (nextEntry!.identity !== canonicalEntry!.identity) {
          throw new Error('Freeze journal canonical NEXT and active recovery name are different exact objects.');
        }
        if (process.platform !== 'linux') {
          throw new Error('An active freeze journal NEXT beside canonical NEXT is supported only as a Linux exact link.');
        }
        const predecessor = FreezeJournalPreviousPhase[nextJournal.phase];
        expectedPreBytes = predecessor === undefined
          ? null
          : renderFreezeJournal(freezeJournalAtPhase(nextJournal, predecessor));
        completionMode = 'active-next-retirement-required';
      } else {
        const successor = FreezeJournalNextPhase[canonicalJournal.phase];
        if (successor === undefined
            || !nextEntry!.bytes.equals(renderFreezeJournal(freezeJournalAtPhase(canonicalJournal, successor)))) {
          throw new Error('Freeze journal active NEXT is not the exact direct successor of canonical PRE.');
        }
        expectedPreBytes = canonicalEntry!.bytes;
        completionMode = 'canonical-install-required';
      }
      const recoveryEntries = await inspectJournalTransitionRecovery({
        directory,
        journalPath,
        expectedPreBytes,
        nextBytes: nextEntry!.bytes,
        canonicalEntry,
        nextEntry: nextEntry!
      });
      relevantEntries.push(...recoveryEntries);
      recovery = Object.freeze({
        expectedPreBytes,
        nextJournal,
        nextBytes: nextEntry!.bytes,
        nextPath: nextEntry!.filePath,
        completionMode,
        durabilityEntries: Object.freeze([
          ...new Map(relevantEntries.map((entry) => [entry.filePath, entry])).values()
        ])
      });
    } else if (canonicalJournal.phase === 'terminal') {
      const retainedTerminalEntries = relevantEntries.filter((entry) => entry.name.startsWith('.entry-'));
      if (retainedTerminalEntries.length > 0) {
        recovery = Object.freeze({
          expectedPreBytes: null,
          nextJournal: canonicalJournal,
          nextBytes: canonicalEntry!.bytes,
          nextPath: canonicalEntry!.filePath,
          completionMode: 'complete',
          durabilityEntries: Object.freeze(retainedTerminalEntries)
        });
      }
    } else {
      const predecessor = FreezeJournalPreviousPhase[canonicalJournal.phase];
      if (predecessor !== undefined) {
        const expectedPreBytes = renderFreezeJournal(freezeJournalAtPhase(canonicalJournal, predecessor));
        const syntheticNextEntry: AnchoredJournalEntry = Object.freeze({
          ...canonicalEntry!,
          name: 'journal.json'
        });
        const recoveryEntries = await inspectJournalTransitionRecovery({
          directory,
          journalPath,
          expectedPreBytes,
          nextBytes: canonicalEntry!.bytes,
          canonicalEntry,
          nextEntry: syntheticNextEntry
        });
        relevantEntries.push(...recoveryEntries);
        if (recoveryEntries.length > 0) {
          recovery = Object.freeze({
            expectedPreBytes,
            nextJournal: canonicalJournal,
            nextBytes: canonicalEntry!.bytes,
            nextPath: canonicalEntry!.filePath,
            completionMode: 'complete',
            durabilityEntries: recoveryEntries
          });
        }
      } else {
        const initialRetiredNextPath = entryRecoveryPath({
          artifactRoot: directory.transactionRoot,
          operationId: byteDigest(canonicalEntry!.bytes),
          targetKey: 'freeze-journal',
          suffix: 'retired-next'
        });
        const initialRetiredNext = await directory.readEntry(
          path.basename(initialRetiredNextPath),
          'Freeze journal initial retired NEXT entry'
        );
        const initialResolution = classifyInitiallyAbsentEntryTuple({
          platform: process.platform as InitiallyAbsentTuplePlatform,
          tuple: Object.freeze({
            target: initialJournalTupleEntryAdapter(canonicalEntry, canonicalEntry!.bytes),
            next: initialJournalTupleEntryAdapter(null, canonicalEntry!.bytes),
            retiredNext: initialJournalTupleEntryAdapter(initialRetiredNext, canonicalEntry!.bytes)
          })
        });
        if (initialResolution.status === 'invalid') {
          throw new Error(`Canonical prepared freeze journal T/N/R contract rejected the no-active-NEXT snapshot (${initialResolution.reason}); preserving every entry.`);
        }
        if (initialRetiredNext !== null) {
          relevantEntries.push(initialRetiredNext);
          recovery = Object.freeze({
            expectedPreBytes: null,
            nextJournal: canonicalJournal,
            nextBytes: canonicalEntry!.bytes,
            nextPath: canonicalEntry!.filePath,
            completionMode: 'complete',
            durabilityEntries: Object.freeze([initialRetiredNext])
          });
        }
      }
    }
    await assertAnchoredJournalCensusStable(directory, relevantEntries);
    return Object.freeze({
      journal: canonicalJournal,
      bytes: canonicalEntry!.bytes,
      canonicalPresent: true,
      recovery,
      durabilityEntries: Object.freeze([
        ...new Map(relevantEntries.map((entry) => [entry.filePath, entry])).values()
      ])
    });
  });
}

export async function restoreFreezeJournalDurability(
  repositoryRoot: string,
  durability: FreezeDurabilityOptions,
  snapshot: FreezeJournalSnapshot
): Promise<void> {
  const transactionRoot = await resolveFreezeTransactionRoot(repositoryRoot, durability);
  const uniqueEntries = new Map(snapshot.durabilityEntries.map((entry) => [entry.filePath, entry]));
  for (const entry of uniqueEntries.values()) {
    const readback = await readSafeRegularFile({
      boundaryRoot: transactionRoot,
      filePath: entry.filePath,
      label: `Freeze journal recovery durability ${entry.name}`
    });
    if (!readback.equals(entry.bytes)) {
      throw new Error(`Freeze journal recovery durability entry changed: ${entry.name}.`);
    }
    await flushPublishedFile({
      boundaryRoot: transactionRoot,
      targetPath: entry.filePath,
      label: `Freeze journal recovery durability ${entry.name}`,
      durability,
      expectedBytes: entry.bytes,
      expectedIdentity: anchoredJournalEntryIdentity(entry)
    });
  }
}

export function maybeFault(actual: FreezeFault | undefined, expected: FreezeFault): void {
  if (actual === expected) throw new Error(`Injected document control freeze fault: ${expected}.`);
}

export async function preflightFreezeProjectionEntryStates(
  repositoryRoot: string,
  snapshot: FreezeJournalSnapshot
): Promise<void> {
  const journal = effectiveFreezeJournal(snapshot)!;
  const transactionRoot = await canonicalDirectoryBoundary(
    path.join(repositoryRoot, path.dirname(FreezeJournalRelativePath)),
    'Document control recovery transaction directory'
  );
  const indexPaths = await resolveIndexPaths(repositoryRoot, true);
  const pointerPath = await resolveRecoverableRepositoryFile(repositoryRoot, ActivePointerPath);
  const rollingPlanPath = await resolveRecoverableRepositoryFile(repositoryRoot, RollingPlanPath);
  const classifiers: PublishTupleClassifierInput[] = [];
  if (journal.preIndexTreeSha === journal.candidateTreeSha || journal.phase !== 'prepared') {
    await assertIndexSemanticIdentity({
      repositoryRoot,
      indexPaths,
      expectedTreeSha: journal.candidateTreeSha,
      label: journal.phase === 'prepared'
        ? 'Freeze preflight Git index semantic NOOP'
        : 'Freeze preflight published Git index semantic readback'
    });
  } else {
    classifiers.push(createPublishTupleClassifierInput({
      boundaryRoot: indexPaths.gitDirectory,
      artifactRoot: indexPaths.gitDirectory,
      targetPath: indexPaths.indexPath,
      targetKey: 'git-index',
      nextPath: indexPaths.lockPath,
      pre: fromBase64(journal.index.pre, 'Freeze preflight index PRE'),
      next: fromBase64(journal.index.next, 'Freeze preflight index NEXT'),
      label: 'Git index',
      operationId: journal.operationId
    }));
  }
  classifiers.push(
    createPublishTupleClassifierInput({
      boundaryRoot: repositoryRoot,
      artifactRoot: transactionRoot,
      targetPath: pointerPath,
      targetKey: 'active-pointer',
      nextPath: atomicCasNextPath(pointerPath, journal.operationId),
      pre: fromBase64(journal.files.pointer.pre, 'Freeze preflight pointer PRE'),
      next: fromBase64(journal.files.pointer.next, 'Freeze preflight pointer NEXT'),
      label: 'Active pointer',
      operationId: journal.operationId
    }),
    createPublishTupleClassifierInput({
      boundaryRoot: repositoryRoot,
      artifactRoot: transactionRoot,
      targetPath: rollingPlanPath,
      targetKey: 'rolling-plan',
      nextPath: atomicCasNextPath(rollingPlanPath, journal.operationId),
      pre: fromBase64(journal.files.rollingPlan.pre, 'Freeze preflight rolling-plan PRE'),
      next: fromBase64(journal.files.rollingPlan.next, 'Freeze preflight rolling-plan NEXT'),
      label: 'Rolling plan',
      operationId: journal.operationId
    })
  );
  for (const classifier of classifiers) {
    await classifyPublishEntryState(classifier);
  }
}

export async function advanceFreezeJournal(input: {
  repositoryRoot: string;
  journal: FreezeJournal;
  journalBytes: Buffer;
  faultAfter?: FreezeFault;
  durability: FreezeDurabilityOptions;
  deferTerminalRetirement?: () => void;
}): Promise<FreezeResult> {
  let journal = input.journal;
  let journalBytes = input.journalBytes;
  const indexPaths = await resolveIndexPaths(input.repositoryRoot, true);
  const indexPre = fromBase64(journal.index.pre, 'Freeze journal index PRE');
  const indexNext = fromBase64(journal.index.next, 'Freeze journal index NEXT');
  if (journal.preIndexTreeSha === journal.candidateTreeSha || journal.phase !== 'prepared') {
    await assertIndexSemanticIdentity({
      repositoryRoot: input.repositoryRoot,
      indexPaths,
      expectedTreeSha: journal.candidateTreeSha,
      label: journal.phase === 'prepared'
        ? 'Freeze Git index semantic NOOP'
        : 'Freeze published Git index semantic readback'
    });
  } else {
    await materializeFreezeCandidateObjects({
      repositoryRoot: input.repositoryRoot,
      gitDirectory: indexPaths.gitDirectory,
      journal
    });
    await publishIndexCas({
      ...indexPaths,
      pre: indexPre,
      next: indexNext,
      operationId: journal.operationId,
      faultAfterLockWrite: () => maybeFault(input.faultAfter, 'after-index-lock-write'),
      faultAfterPreQuarantine: () => maybeFault(input.faultAfter, 'after-index-pre-quarantine'),
      faultAfterNextInstall: () => maybeFault(input.faultAfter, 'after-index-next-install'),
      durability: input.durability
    });
  }
  maybeFault(input.faultAfter, 'after-index-publish');
  if (journal.phase === 'prepared') {
    journal = Object.freeze({ ...journal, phase: 'index-published' });
    journalBytes = await writeFreezeJournal(
      input.repositoryRoot,
      journalBytes,
      journal,
      input.durability,
      input.faultAfter
    );
  }

  const manifestPath = await assertRegularRepositoryFile(input.repositoryRoot, journal.manifestPath);
  const manifestNext = fromBase64(journal.files.manifest.next, 'Freeze manifest NEXT');
  if (!(await readSafeRegularFile({
    boundaryRoot: input.repositoryRoot,
    filePath: manifestPath,
    label: 'Work Package manifest'
  })).equals(manifestNext)) {
    throw new Error('Work Package manifest bytes drifted after journal preparation.');
  }
  const pointerPath = await resolveRecoverableRepositoryFile(input.repositoryRoot, ActivePointerPath);
  await writeAtomicCas({
    repositoryRoot: input.repositoryRoot,
    filePath: pointerPath,
    targetKey: 'active-pointer',
    pre: fromBase64(journal.files.pointer.pre, 'Freeze pointer PRE'),
    next: fromBase64(journal.files.pointer.next, 'Freeze pointer NEXT'),
    label: 'Active pointer',
    operationId: journal.operationId,
    faultAfterTempWrite: () => maybeFault(input.faultAfter, 'after-pointer-temp-write'),
    faultAfterPreQuarantine: () => maybeFault(input.faultAfter, 'after-pointer-pre-quarantine'),
    faultAfterNextInstall: () => maybeFault(input.faultAfter, 'after-pointer-next-install'),
    durability: input.durability
  });
  maybeFault(input.faultAfter, 'after-pointer-publish');
  if (journal.phase === 'prepared' || journal.phase === 'index-published') {
    journal = Object.freeze({ ...journal, phase: 'pointer-published' });
    journalBytes = await writeFreezeJournal(
      input.repositoryRoot,
      journalBytes,
      journal,
      input.durability,
      input.faultAfter
    );
  }

  const rollingPlanPath = await resolveRecoverableRepositoryFile(input.repositoryRoot, RollingPlanPath);
  await writeAtomicCas({
    repositoryRoot: input.repositoryRoot,
    filePath: rollingPlanPath,
    targetKey: 'rolling-plan',
    pre: fromBase64(journal.files.rollingPlan.pre, 'Freeze rolling-plan PRE'),
    next: fromBase64(journal.files.rollingPlan.next, 'Freeze rolling-plan NEXT'),
    label: 'Rolling plan',
    operationId: journal.operationId,
    faultAfterTempWrite: () => maybeFault(input.faultAfter, 'after-rolling-temp-write'),
    faultAfterPreQuarantine: () => maybeFault(input.faultAfter, 'after-rolling-pre-quarantine'),
    faultAfterNextInstall: () => maybeFault(input.faultAfter, 'after-rolling-next-install'),
    durability: input.durability
  });
  maybeFault(input.faultAfter, 'after-rolling-publish');
  if (journal.phase !== 'rolling-published' && journal.phase !== 'terminal') {
    journal = Object.freeze({ ...journal, phase: 'rolling-published' });
    journalBytes = await writeFreezeJournal(
      input.repositoryRoot,
      journalBytes,
      journal,
      input.durability,
      input.faultAfter
    );
  }

  const readback = await captureControlIndexSnapshot(input.repositoryRoot, { targetManifestPath: journal.manifestPath });
  if (readback.treeSha !== journal.candidateTreeSha) {
    throw new Error('Candidate index tree drifted before freeze terminal readback.');
  }
  const pointerBytes = fromBase64(journal.files.pointer.next, 'Freeze pointer NEXT');
  const rollingBytes = fromBase64(journal.files.rollingPlan.next, 'Freeze rolling-plan NEXT');
  if (readback.targetManifestBlob === undefined || !readback.targetManifestBlob.equals(manifestNext)
      || !readback.pointerBytes.equals(pointerBytes)
      || !readback.rollingPlanBytes.equals(rollingBytes)) {
    throw new Error('Candidate tree control bytes do not match the freeze NEXT images.');
  }
  const retiredManifestPath = await freezeRetiredManifestPath(input.repositoryRoot, journal);
  if (retiredManifestPath !== null) {
    await assertFreezeRetiredManifestAbsent({
      repositoryRoot: input.repositoryRoot,
      repositoryPath: retiredManifestPath,
      treeSha: readback.treeSha,
      label: 'Freeze successor retired manifest'
    });
  }
  const pointer = parseActivePointer(decodeUtf8(pointerBytes, 'Freeze pointer NEXT'));
  const rolling = parseRollingPlan(decodeUtf8(rollingBytes, 'Freeze rolling-plan NEXT'));
  assertControlPlaneBinding({
    spec: parseCurrentStateSpec(readback.stateSource),
    pointer
  });
  if (rolling.activePackageId !== path.posix.basename(pointer.manifest, '.md')
      || pointer.manifest !== journal.manifestPath
      || pointer.manifestDigest !== journal.manifestDigest) {
    throw new Error('Freeze terminal readback is not bound to one manifest/pointer/rolling-plan selection.');
  }
  if (journal.phase !== 'terminal') {
    journal = Object.freeze({ ...journal, phase: 'terminal' });
    journalBytes = await writeFreezeJournal(
      input.repositoryRoot,
      journalBytes,
      journal,
      input.durability,
      input.faultAfter
    );
  }
  maybeFault(input.faultAfter, 'after-terminal');
  if (input.deferTerminalRetirement !== undefined) {
    // writeFreezeJournal already acknowledged the durable exact terminal NEXT.
    // The fresh terminal owner performs the full journal/index residue census;
    // do not spend the writer's remaining allowance on that duplicate census.
    input.deferTerminalRetirement();
    return journal.result;
  }
  const terminalSnapshot = await readFreezeJournalSnapshot(input.repositoryRoot);
  if (terminalSnapshot === null || !terminalSnapshot.canonicalPresent
      || terminalSnapshot.journal.phase !== 'terminal'
      || terminalSnapshot.journal.operationId !== journal.operationId
      || (terminalSnapshot.recovery !== null && terminalSnapshot.recovery.completionMode !== 'complete')) {
    throw new Error('Terminal freeze journal disappeared or changed before retirement.');
  }
  await verifyTerminalFreezeJournal({
    repositoryRoot: input.repositoryRoot,
    snapshot: terminalSnapshot,
    manifestPath: journal.manifestPath,
    manifestDigest: journal.manifestDigest,
    reviewedOn: journal.reviewedOn
  });
  await retireTerminalFreezeTransaction({
    repositoryRoot: input.repositoryRoot,
    snapshot: terminalSnapshot,
    durability: input.durability
  });
  return journal.result;
}

export async function verifyTerminalFreezeJournal(input: {
  repositoryRoot: string;
  snapshot: FreezeJournalSnapshot;
  manifestPath: string;
  manifestDigest: `sha256:${string}`;
  reviewedOn: string;
}): Promise<FreezeResult> {
  const journal = input.snapshot.journal;
  if (!input.snapshot.canonicalPresent || journal.phase !== 'terminal'
      || (input.snapshot.recovery !== null && input.snapshot.recovery.completionMode !== 'complete')) {
    throw new Error('Terminal freeze verification requires one complete canonical journal.');
  }
  if (journal.manifestPath !== input.manifestPath
      || journal.manifestDigest !== input.manifestDigest
      || journal.reviewedOn !== input.reviewedOn) {
    throw new Error('Terminal freeze journal does not match the exact requested authoring operation.');
  }

  const indexPaths = await resolveIndexPaths(input.repositoryRoot);
  await readSafeRegularFile({
    boundaryRoot: indexPaths.gitDirectory,
    filePath: indexPaths.indexPath,
    label: 'Terminal freeze Git index readback'
  });
  const lockBytes = await readOptionalSafeRegularFile({
    boundaryRoot: indexPaths.gitDirectory,
    filePath: indexPaths.lockPath,
    label: 'Terminal freeze Git index lock readback'
  });
  if (lockBytes !== null) {
    throw new Error('Terminal freeze verification found an active Git index lock; preserving it.');
  }

  const terminalGit = createReadOnlyResolverGit();
  const { treeSha } = await captureRepositoryIndexTreeThroughExternalScratch({
    repositoryRoot: input.repositoryRoot,
    resolverGit: terminalGit
  });
  if (treeSha !== journal.candidateTreeSha) {
    throw new Error('Terminal freeze Git index tree does not equal the journal candidate tree.');
  }
  const manifestNext = fromBase64(journal.files.manifest.next, 'Terminal freeze manifest NEXT');
  const pointerNext = fromBase64(journal.files.pointer.next, 'Terminal freeze pointer NEXT');
  const rollingNext = fromBase64(journal.files.rollingPlan.next, 'Terminal freeze rolling-plan NEXT');
  const terminalBlobs = await readControlTreeBlobs(input.repositoryRoot, treeSha,
    [journal.manifestPath, ActivePointerPath, RollingPlanPath, CurrentStatePath]);
  const requireTerminalTreeBlob = async (
    repositoryPath: string,
    expected: Buffer,
    label: string
  ): Promise<Buffer> => {
    const bytes = terminalBlobs.get(repositoryPath);
    if (bytes === undefined || !bytes.equals(expected)) {
      throw new Error(`${label} does not equal the exact journal NEXT image in the terminal tree.`);
    }
    return bytes;
  };
  await requireTerminalTreeBlob(journal.manifestPath, manifestNext, 'Terminal freeze manifest');
  await requireTerminalTreeBlob(ActivePointerPath, pointerNext, 'Terminal freeze active pointer');
  await requireTerminalTreeBlob(RollingPlanPath, rollingNext, 'Terminal freeze rolling plan');
  const retiredManifestPath = await freezeRetiredManifestPath(input.repositoryRoot, journal);
  if (retiredManifestPath !== null) {
    await assertFreezeRetiredManifestAbsent({
      repositoryRoot: input.repositoryRoot,
      repositoryPath: retiredManifestPath,
      treeSha,
      label: 'Terminal freeze successor retired manifest'
    });
  }

  const manifestPath = await assertRegularRepositoryFile(input.repositoryRoot, journal.manifestPath);
  const pointerPath = await assertRegularRepositoryFile(input.repositoryRoot, ActivePointerPath);
  const rollingPlanPath = await assertRegularRepositoryFile(input.repositoryRoot, RollingPlanPath);
  const manifestWorktree = await readSafeRegularFile({
    boundaryRoot: input.repositoryRoot,
    filePath: manifestPath,
    label: 'Terminal freeze manifest worktree readback'
  });
  const pointerWorktree = await readSafeRegularFile({
    boundaryRoot: input.repositoryRoot,
    filePath: pointerPath,
    label: 'Terminal freeze pointer worktree readback'
  });
  const rollingWorktree = await readSafeRegularFile({
    boundaryRoot: input.repositoryRoot,
    filePath: rollingPlanPath,
    label: 'Terminal freeze rolling-plan worktree readback'
  });
  if (!manifestWorktree.equals(manifestNext)
      || !pointerWorktree.equals(pointerNext)
      || !rollingWorktree.equals(rollingNext)) {
    throw new Error('Terminal freeze worktree bytes do not equal all exact journal NEXT images.');
  }

  const stateSource = terminalBlobs.get(CurrentStatePath);
  if (stateSource === undefined) throw new Error('Terminal freeze current-state spec is absent from the candidate tree.');
  const pointer = parseActivePointer(decodeUtf8(pointerNext, 'Terminal freeze pointer NEXT'));
  const rolling = parseRollingPlan(decodeUtf8(rollingNext, 'Terminal freeze rolling-plan NEXT'));
  assertControlPlaneBinding({
    spec: parseCurrentStateSpec(decodeUtf8(stateSource, 'Terminal freeze current-state spec')),
    pointer
  });
  if (rolling.activePackageId !== path.posix.basename(pointer.manifest, '.md')
      || pointer.manifest !== journal.manifestPath
      || pointer.manifestDigest !== journal.manifestDigest) {
    throw new Error('Terminal freeze selection is not bound to one manifest, pointer, and rolling plan.');
  }
  return journal.result;
}

function anchoredJournalEntryIdentity(entry: AnchoredJournalEntry): AnchoredObjectIdentity {
  return entry.physicalIdentity;
}

async function retireTerminalIndexRecovery(input: {
  repositoryRoot: string;
  journal: FreezeJournal;
  durability: FreezeDurabilityOptions;
}): Promise<void> {
  const indexPaths = await resolveIndexPaths(input.repositoryRoot);
  await assertIndexSemanticIdentity({
    repositoryRoot: input.repositoryRoot,
    indexPaths,
    expectedTreeSha: input.journal.candidateTreeSha,
    label: 'Terminal freeze Git index semantic readback'
  });
  const names = freezeEntryRecoveryNames({
    artifactRoot: indexPaths.gitDirectory,
    operationId: input.journal.operationId,
    targetKey: 'git-index'
  });
  const expected = new Map<string, Buffer>([
    [names.pre, fromBase64(input.journal.index.pre, 'Terminal index PRE retirement')],
    [names.retiredPre, fromBase64(input.journal.index.pre, 'Terminal index retired PRE retirement')],
    [names.retiredNext, fromBase64(input.journal.index.next, 'Terminal index retired NEXT retirement')]
  ]);
  const directRecoveryNames = scanDirectDirectoryNames(
    indexPaths.gitDirectory,
    'Terminal Git index recovery census'
  )
    .filter((name) => name.startsWith('.entry-'))
    .sort();
  const unknown = directRecoveryNames.find((name) => !expected.has(name));
  if (unknown !== undefined) {
    throw new Error(`Unbound Git index recovery residue is preserved: ${unknown}.`);
  }
  const observations = new Map<string, NonNullable<Awaited<ReturnType<typeof observeOptionalSafeRegularFile>>>>();
  for (const [name, bytes] of expected) {
    const observation = await observeOptionalSafeRegularFile({
      boundaryRoot: indexPaths.gitDirectory,
      filePath: path.join(indexPaths.gitDirectory, name),
      label: `Terminal Git index recovery ${name}`
    });
    if (observation === null) continue;
    if (!observation.bytes.equals(bytes)) {
      throw new Error(`Terminal Git index recovery residue has unknown bytes and is preserved: ${name}.`);
    }
    observations.set(name, observation);
  }
  const pre = observations.get(names.pre);
  const retiredPre = observations.get(names.retiredPre);
  if (pre !== undefined && retiredPre !== undefined
      && !sameAnchoredObjectIdentity(pre.identity, retiredPre.identity)) {
    throw new Error('Terminal Git index PRE recovery identity is unprovable; preserving both entries.');
  }
  for (const name of [names.retiredNext, names.retiredPre, names.pre]) {
    const observation = observations.get(name);
    if (observation === undefined) continue;
    await removeOptionalSafeRegularFile({
      boundaryRoot: indexPaths.gitDirectory,
      filePath: path.join(indexPaths.gitDirectory, name),
      label: `Terminal Git index recovery retirement ${name}`,
      expectedBytes: observation.bytes,
      expectedIdentity: observation.identity,
      durability: input.durability
    });
  }
  const remaining = scanDirectDirectoryNames(
    indexPaths.gitDirectory,
    'Terminal Git index remaining recovery census'
  ).filter((name) => name.startsWith('.entry-'));
  if (remaining.length > 0) {
    throw new Error(`Git index recovery residue remained after retirement: ${remaining.sort().join(', ')}.`);
  }
  if (process.platform === 'win32') {
    if (input.durability.parentDirectoryBarrier !== undefined) {
      await input.durability.parentDirectoryBarrier(indexPaths.gitDirectory);
    } else {
      await defaultParentDirectoryBarrier(indexPaths.gitDirectory);
    }
  }
  await assertIndexSemanticIdentity({
    repositoryRoot: input.repositoryRoot,
    indexPaths,
    expectedTreeSha: input.journal.candidateTreeSha,
    label: 'Terminal freeze Git index semantic retirement readback'
  });
}

export async function retireTerminalFreezeTransaction(input: {
  repositoryRoot: string;
  snapshot: FreezeJournalSnapshot;
  durability: FreezeDurabilityOptions;
}): Promise<void> {
  const journal = input.snapshot.journal;
  if (!input.snapshot.canonicalPresent || journal.phase !== 'terminal'
      || (input.snapshot.recovery !== null && input.snapshot.recovery.completionMode !== 'complete')) {
    throw new Error('Only one complete terminal freeze journal can authorize recovery retirement.');
  }
  await retireTerminalIndexRecovery({
    repositoryRoot: input.repositoryRoot,
    journal,
    durability: input.durability
  });
  const transactionRoot = await canonicalDirectoryBoundary(
    path.join(input.repositoryRoot, path.dirname(FreezeJournalRelativePath)),
    'Terminal freeze transaction directory'
  );
  await assertTerminalRetirementPrefix({
    repositoryRoot: input.repositoryRoot,
    transactionRoot,
    journal,
    journalBytes: input.snapshot.bytes
  });
  const journalPath = path.join(transactionRoot, path.basename(FreezeJournalRelativePath));
  const directEntries = input.snapshot.durabilityEntries.filter(
    (entry) => pathComparisonValue(path.dirname(entry.filePath)) === pathComparisonValue(transactionRoot)
  );
  const canonical = directEntries.find((entry) => entry.name === 'journal.json');
  if (canonical === undefined || !canonical.bytes.equals(input.snapshot.bytes)) {
    throw new Error('Terminal freeze retirement lost its canonical journal authority.');
  }
  const recoveryEntries = directEntries
    .filter((entry) => entry.name !== 'journal.json')
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of recoveryEntries) {
    await removeOptionalSafeRegularFile({
      boundaryRoot: transactionRoot,
      filePath: entry.filePath,
      label: `Terminal freeze recovery retirement ${entry.name}`,
      expectedBytes: entry.bytes,
      expectedIdentity: anchoredJournalEntryIdentity(entry),
      durability: input.durability
    });
  }
  const journalOnly = await readFreezeJournalSnapshot(input.repositoryRoot);
  if (journalOnly === null || !journalOnly.canonicalPresent
      || journalOnly.journal.operationId !== journal.operationId
      || journalOnly.journal.phase !== 'terminal'
      || journalOnly.durabilityEntries.some((entry) => entry.name !== 'journal.json')) {
    throw new Error('Terminal freeze recovery census did not retire to the canonical journal only.');
  }
  if (process.platform === 'win32') {
    if (input.durability.parentDirectoryBarrier !== undefined) {
      await input.durability.parentDirectoryBarrier(transactionRoot);
    } else {
      await defaultParentDirectoryBarrier(transactionRoot);
    }
  }
  await removeOptionalSafeRegularFile({
    boundaryRoot: transactionRoot,
    filePath: journalPath,
    label: 'Terminal freeze canonical journal retirement',
    expectedBytes: journalOnly.bytes,
    expectedIdentity: anchoredJournalEntryIdentity(journalOnly.durabilityEntries[0]!),
    durability: input.durability
  });
  if (await readFreezeJournalSnapshot(input.repositoryRoot) !== null) {
    throw new Error('Terminal freeze journal remained after exact retirement.');
  }
  if (process.platform === 'win32') {
    if (input.durability.parentDirectoryBarrier !== undefined) {
      await input.durability.parentDirectoryBarrier(transactionRoot);
    } else {
      await defaultParentDirectoryBarrier(transactionRoot);
    }
  }
  await removeExactEmptyDirectory({
    boundaryRoot: input.repositoryRoot,
    directoryPath: transactionRoot,
    label: 'Terminal freeze transaction directory retirement'
  });
}

export async function retireEmptyFreezeTransactionRootAfterJournalLast(input: {
  repositoryRoot: string;
  durability: FreezeDurabilityOptions;
}): Promise<void> {
  const transactionRoot = path.join(
    input.repositoryRoot,
    path.dirname(FreezeJournalRelativePath)
  );
  const observed = await inspectSafePath({
    boundaryRoot: input.repositoryRoot,
    candidatePath: transactionRoot,
    label: 'Journal-last empty freeze transaction directory',
    finalKind: 'directory',
    allowMissing: true
  });
  if (observed === null) return;
  const retainedDirectory = inspectNoFollowDirectoryChain(
    observed,
    'Journal-last empty freeze transaction directory census'
  ).target;
  const names = scanNoFollowDirectoryDirectMetadata(retainedDirectory, {
    deadlineAtMs: performance.now() + 30_000,
    maximumEntries: 10_000
  }).map((entry) => entry.relativePath).sort();
  if (names.length > 0) {
    throw new Error(
      `Freeze transaction directory has no journal authority and preserves direct residues: ${names.join(', ')}.`
    );
  }
  await removeExactEmptyDirectory({
    boundaryRoot: input.repositoryRoot,
    directoryPath: observed,
    label: 'Journal-last empty freeze transaction directory retirement',
    expectedIdentity: physicalIdentity(retainedDirectory)
  });
}
