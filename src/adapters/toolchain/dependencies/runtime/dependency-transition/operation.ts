import crypto from 'node:crypto';
import path from 'node:path';
import {
  canonicalJson
} from '../../../../../contracts/canonical.ts';
import { failureMessage, getErrorCode } from '../../../../../contracts/failure-inspection.ts';
import {
  FailureError
} from '../../../../../contracts/failure.ts';
import {
  generatedStateDigest
} from '../../../../runtime-state/generated-state/contract.ts';
import {
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry
} from '../../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  type RuntimeDependencyEffectFenceInput,
  runtimeDependencyEffectFenceOptions,
  runtimeDependencyOperationContext,
  runtimeDependencyOperationEffectFence,
  runtimeDependencyOperationRemainingMs
} from '../operation-context.ts';
import { type RuntimeDependencyOperationControlInput, runtimeDependencyOperationControls } from '../operation-controls.ts';
import {
  assertRuntimeDependencySourceGenerationIssued
} from '../source-generation.ts';
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
  type DependencyTransitionKind,
  type DependencyTransitionLedger,
  type DependencyTransitionPhase,
  type DependencyTransitionSlot,
  type DependencyTransitionUnsigned,
  generatedStatePhysicalIdentity,
  type RuntimeDependencySourceGeneration,
  sameGeneratedStateIdentity
} from './contract.ts';
import {
  assertDependencyTransitionMigrationSourceNamespaceBinding,
  assertDependencyTransitionMigrationTargetBinding,
  DEPENDENCY_TRANSITION_LEGACY_SCHEMA,
  type DependencyTransitionMigrationIntent,
  inspectLegacyDependencyTransitionNamespace,
  readDependencyTransitionMigrationIntents
} from './migration.ts';
import {
  DEPENDENCY_TRANSITION_ROLLOVER_TRIGGER,
  inspectActiveDependencyTransitionRollover,
  rolloverDependencyTransitionLedger
} from './rollover.ts';
import {
  DEPENDENCY_TRANSITION_RECORD_CAPACITY,
  dependencyTransitionNamespacePaths,
  ensureDependencyTransitionNamespace,
  inspectDependencyTransitionNamespace,
  observeDependencyTransitionSlot,
  readDependencyTransitionRecordSet,
  writeDependencyTransitionPointerCache,
  writeDurableTransitionFile
} from './store.ts';

/**
 * Process-local admission for records that may drive a journal write.
 *
 * A valid digest and operation key prove only that bytes are internally
 * consistent; they do not prove that the dependency owner observed those
 * bytes in its immutable ledger or created them itself.  Effectful successors
 * therefore consume the exact object issued by this module after either a
 * complete retained ledger census or an exclusive publication.  Recovery
 * re-acquires that admission from the durable ledger after every process
 * restart instead of accepting a caller-constructed structural clone.
 */
const admittedDependencyTransitionRecords = new WeakSet<object>();

function admitDependencyTransitionRecord<T extends DependencyTransitionJournal>(record: T): T {
  admittedDependencyTransitionRecords.add(record);
  return record;
}

function assertDependencyTransitionRecordAdmitted(record: DependencyTransitionJournal): void {
  if (!admittedDependencyTransitionRecords.has(record)) {
    throw new FailureError(
      'RUNTIME-DEPS-004',
      'Dependency transition write requires an owner-admitted immutable record'
    );
  }
}

export async function readDependencyTransitionLedger(
  ownerRoot: string,
  inputOptions: RuntimeDependencyOperationControlInput
): Promise<DependencyTransitionLedger | null> {
  ownerRoot = path.resolve(ownerRoot);
  const options = runtimeDependencyOperationControls(inputOptions);
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition ledger admission');
  // Read-only admission must not create `.tmp/dependency-installs` or a
  // journal namespace. The writer/recovery effect boundary is the only route
  // allowed to create those directories.
  const activeRollover = await inspectActiveDependencyTransitionRollover(ownerRoot, options);
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition rollover observation readback');
  if (activeRollover !== null && activeRollover.active !== null) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition ledger rollover requires owner recovery', {
      intentDigest: activeRollover.active.intentDigest,
      phase: activeRollover.active.phase,
      terminalRecordDigest: activeRollover.active.terminalRecordDigest
    });
  }
  const namespace = inspectDependencyTransitionNamespace(ownerRoot);
  const legacyNamespace = inspectLegacyDependencyTransitionNamespace(ownerRoot);
  let completedMigration: DependencyTransitionMigrationIntent | null = null;
  if (namespace === null) {
    if (legacyNamespace !== null) {
      throw new FailureError('RUNTIME-DEPS-004', 'Legacy dependency transition journal requires an owner migration before it can be read', {
        schema: DEPENDENCY_TRANSITION_LEGACY_SCHEMA,
        namespace: legacyNamespace.journalRoot.path
      });
    }
    return null;
  }
  const migrationIntents = await readDependencyTransitionMigrationIntents(namespace, options);
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition migration observation readback');
  if (legacyNamespace !== null) {
    if (migrationIntents.complete === null) {
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition schema migration is incomplete; target is preserved', {
        namespace: namespace.journalRoot.path,
        preparedIntentDigest: migrationIntents.prepared?.intentDigest ?? null
      });
    }
    // The v2 reader does not dual-read the retired grammar.  It only verifies
    // that the retained source namespace still has the physical identity
    // recorded by the completed migration intent; the migration entry alone
    // is allowed to parse and digest v1 records.
    assertDependencyTransitionMigrationSourceNamespaceBinding(migrationIntents.complete, legacyNamespace);
    completedMigration = migrationIntents.complete;
  } else if (migrationIntents.prepared !== null || migrationIntents.complete !== null) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition migration source evidence is missing and is preserved', {
      preparedIntentDigest: migrationIntents.prepared?.intentDigest ?? null,
      completeIntentDigest: migrationIntents.complete?.intentDigest ?? null
    });
  }
  const latestCompleteRollover = activeRollover?.latestComplete ?? null;
  if (latestCompleteRollover !== null && !sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(namespace.recordsRoot),
    latestCompleteRollover.publishedRecordsRootPhysical!
  )) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition records root is not the latest complete rollover publication');
  }
  const observed = readDependencyTransitionRecordSet(
    namespace.recordsRoot,
    namespace.ownerRoot.path,
    runtimeDependencyOperationContext(options),
    'Dependency transition records'
  );
  const { records, tip } = observed;
  if (completedMigration !== null) {
    assertDependencyTransitionMigrationTargetBinding(completedMigration, namespace);
  }
  if (records.size === 0 && latestCompleteRollover !== null) {
    throw new FailureError('RUNTIME-DEPS-004', 'Latest complete dependency transition rollover has no checkpoint in its published records root');
  }
  if (latestCompleteRollover !== null) {
    const checkpoint = records.get(latestCompleteRollover.checkpoint.recordDigest);
    if (checkpoint === undefined ||
        !Buffer.from(dependencyTransitionRecordBytes(checkpoint)).equals(
          dependencyTransitionRecordBytes(latestCompleteRollover.checkpoint)
        ) ||
        checkpoint.previousRecordDigest !== null || checkpoint.sequence !== 1) {
      throw new FailureError('RUNTIME-DEPS-004', 'Published dependency transition records root does not contain the latest complete rollover checkpoint');
    }
  }
  for (const record of records.values()) admitDependencyTransitionRecord(record);
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition ledger readback');
  return Object.freeze({ namespace, records, ledgerDigest: observed.ledgerDigest, tip });
}

export async function readDependencyTransition(
  ownerRoot: string,
  options: RuntimeDependencyOperationControlInput
): Promise<DependencyTransitionJournal | null> {
  return (await readDependencyTransitionLedger(ownerRoot, options))?.tip ?? null;
}

async function writeDependencyTransition(
  ownerRoot: string,
  unsigned: DependencyTransitionUnsigned,
  options: RuntimeDependencyEffectFenceInput,
  expectedCurrentRecordDigest: `sha256:${string}` | null = null
): Promise<DependencyTransitionJournal> {
  ownerRoot = path.resolve(ownerRoot);
  const recordDigest = dependencyTransitionDigestWithoutRecord(unsigned);
  const recordBytes = dependencyTransitionRecordBytes({ ...unsigned, recordDigest });
  // Use the existing durable record contract before any namespace effect. The
  // returned immutable record and published bytes must describe one snapshot.
  const record = parseDependencyTransitionRecord(recordBytes, transitionRecordName(recordDigest));
  assertTransitionOperationKey(record);
  const { recordDigest: _capturedDigest, ...capturedUnsigned } = record;
  unsigned = capturedUnsigned;
  const effect = runtimeDependencyEffectFenceOptions(options);
  const namespace = await ensureDependencyTransitionNamespace(ownerRoot, effect);
  const currentLedger = await readDependencyTransitionLedger(ownerRoot, effect);
  if (expectedCurrentRecordDigest === null) {
    // A new immutable epoch may only start from an empty ledger.  The
    // immutable census, rather than current.json, is the expected-current CAS
    // preimage for this root publication.
    if (currentLedger?.tip !== null && currentLedger?.tip !== undefined) {
      throw new FailureError('RUNTIME-DEPS-002', 'Dependency transition immutable ledger already has a predecessor', {
        expectedCurrentRecordDigest,
        currentRecordDigest: currentLedger.tip.recordDigest,
        ownerRoot: namespace.ownerRoot.path
      });
    }
  } else {
    if (currentLedger?.tip === null || currentLedger === null ||
        currentLedger.tip.recordDigest !== expectedCurrentRecordDigest) {
      throw new FailureError('RUNTIME-DEPS-002', 'Dependency transition expected-current record digest does not match the immutable ledger tip', {
        expectedCurrentRecordDigest,
        currentRecordDigest: currentLedger?.tip?.recordDigest ?? null,
        ownerRoot: namespace.ownerRoot.path
      });
    }
    if (currentLedger.records.size >= DEPENDENCY_TRANSITION_ROLLOVER_TRIGGER) {
      if (unsigned.phase !== 'prepared') {
        throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition ledger is at rollover capacity during an active operation', {
          recordCount: currentLedger.records.size,
          capacity: DEPENDENCY_TRANSITION_RECORD_CAPACITY
        });
      }
      const checkpoint = await rolloverDependencyTransitionLedger(
        ownerRoot,
        currentLedger,
        currentLedger.tip,
        effect
      );
      // Rollover publishes only the authenticated terminal checkpoint.  The
      // caller's operation is a normal child of that checkpoint and is
      // written only after the new root has been recovered/read back.
      const childUnsigned = Object.freeze({
        ...unsigned,
        previousRecordDigest: checkpoint.recordDigest,
        sequence: checkpoint.sequence + 1
      });
      return writeDependencyTransition(
        ownerRoot,
        childUnsigned,
        effect,
        checkpoint.recordDigest
      );
    }
    // The full ledger census above is the expected-current CAS.  Re-parse the
    // digest-named predecessor at the write boundary as a cheap byte-level
    // guard against an external replacement after that census.
    const predecessorName = transitionRecordName(expectedCurrentRecordDigest);
    const predecessorEntry = inspectNoFollowOrdinaryFileEntry(namespace.recordsRoot, predecessorName);
    if (predecessorEntry === null || predecessorEntry.bytes === null) {
      throw new FailureError('RUNTIME-DEPS-002', 'Dependency transition expected immutable predecessor is missing', {
        expectedCurrentRecordDigest,
        ownerRoot: namespace.ownerRoot.path
      });
    }
    const predecessor = parseDependencyTransitionRecord(predecessorEntry.bytes, predecessorName);
    if (predecessor.recordDigest !== expectedCurrentRecordDigest ||
        currentLedger.records.get(expectedCurrentRecordDigest)?.recordDigest !== predecessor.recordDigest) {
      throw new FailureError('RUNTIME-DEPS-002', 'Dependency transition expected immutable predecessor digest changed', {
        expectedCurrentRecordDigest,
        currentRecordDigest: predecessor.recordDigest,
        ownerRoot: namespace.ownerRoot.path
      });
    }
  }
  await runtimeDependencyOperationEffectFence(effect, 'Dependency transition immutable record publication');
  writeDurableTransitionFile(
    namespace.recordsRoot,
    transitionRecordName(recordDigest),
    recordBytes,
    assertDependencyTransitionRecordBytes,
    true
  );
  // The expected predecessor was derived from a complete immutable census
  // immediately before this exclusive record publication.  Cooperative
  // writers are serialized by the compiler-root lease; a non-cooperative
  // writer can only add a forked immutable record, which the next admission
  // census rejects before any transition effect.  Do not recensus the whole
  // ledger after every record: that would turn one operation into a repeated
  // full-root fence on the Windows path.  The pointer update below is only a
  // non-authoritative cache hint.
  runtimeDependencyOperationRemainingMs(effect, 'Dependency transition immutable record readback');
  writeDependencyTransitionPointerCache(namespace, recordDigest);
  return admitDependencyTransitionRecord(record);
}

export function transitionFailure(error: unknown): Readonly<{ code: string; message: string }> {
  return Object.freeze({ code: getErrorCode(error) || 'UNKNOWN', message: failureMessage(error) || 'Unspecified dependency transition failure' });
}

function transitionOperationKey(input: Readonly<{
  kind: DependencyTransitionKind;
  ownerRoot: string;
  destinationPath: string;
  preimage: DependencyTransitionSlot;
  stage: DependencyTransitionSlot | null;
  stageRoot: DependencyTransitionSlot | null;
  backup: DependencyTransitionSlot | null;
  sourceGeneration: RuntimeDependencySourceGeneration;
}>): `sha256:${string}` {
  // `sourcePath` may change from an operation-created staging child to the
  // active compiler destination after a successful rename.  Bind the
  // operation to the immutable source physical/content observation, not that
  // mutable path spelling, so recovery can audit the stage-to-active receipt.
  const sourceGeneration = Object.freeze({
    schema: input.sourceGeneration.schema,
    ownerRoot: input.sourceGeneration.ownerRoot,
    ownerRootPhysical: input.sourceGeneration.ownerRootPhysical,
    physical: input.sourceGeneration.physical,
    bindingDigest: input.sourceGeneration.bindingDigest,
    treeDigest: input.sourceGeneration.treeDigest,
    treeEntryCount: input.sourceGeneration.treeEntryCount,
    epoch: input.sourceGeneration.epoch
  });
  // Journal records are persisted as recursively canonical JSON.  Hash the
  // same canonical projection here: otherwise a valid record re-read after
  // JSON parsing has alphabetized nested slot keys and no longer reproduces
  // the in-memory insertion-order hash created at begin time.
  return generatedStateDigest(canonicalJson(Object.freeze({
    schema: 'sec-dependency-transition-operation-v1',
    kind: input.kind,
    ownerRoot: path.resolve(input.ownerRoot),
    destinationPath: path.resolve(input.destinationPath),
    preimage: input.preimage,
    stagePath: input.stage?.path ?? null,
    stageRootPath: input.stageRoot?.path ?? null,
    backupPath: input.backup?.path ?? null,
    sourceGeneration
  })));
}

export async function beginDependencyTransition(input: Readonly<{
  kind: DependencyTransitionKind;
  ownerRoot: string;
  destinationPath: string;
  stagePath: string | null;
  stageRootPath?: string | null;
  backupPath: string | null;
  sourceGeneration: RuntimeDependencySourceGeneration;
  bindingDigest: `sha256:${string}` | null;
  preimageBindingDigest?: `sha256:${string}` | null;
  options: RuntimeDependencyEffectFenceInput;
}>): Promise<DependencyTransitionJournal> {
  const cwd = process.cwd();
  const { kind, ownerRoot: requestedOwnerRoot, destinationPath, stagePath, stageRootPath,
    backupPath, sourceGeneration, bindingDigest, preimageBindingDigest, options } = input;
  assertRuntimeDependencySourceGenerationIssued(sourceGeneration);
  const absoluteOwner = path.resolve(cwd, requestedOwnerRoot);
  const absoluteDestination = path.resolve(cwd, destinationPath);
  const absoluteStage = stagePath === null ? null : path.resolve(cwd, stagePath);
  const absoluteStageRoot = stageRootPath === undefined || stageRootPath === null ? null : path.resolve(cwd, stageRootPath);
  const absoluteBackup = backupPath === null ? null : path.resolve(cwd, backupPath);
  // No original request object is consulted after provider observation starts.
  input = Object.freeze({ kind, ownerRoot: absoluteOwner, destinationPath: absoluteDestination,
    stagePath: absoluteStage, stageRootPath: absoluteStageRoot, backupPath: absoluteBackup,
    sourceGeneration, bindingDigest, preimageBindingDigest,
    options: runtimeDependencyEffectFenceOptions(options) });
  runtimeDependencyOperationRemainingMs(input.options, 'Dependency transition begin admission');
  const ownerRoot = inspectNoFollowDirectoryChain(
    input.ownerRoot,
    'Dependency transition owner root'
  ).target;
  const destination = await observeDependencyTransitionSlot(
    input.destinationPath,
    input.preimageBindingDigest ?? input.bindingDigest
  );
  runtimeDependencyOperationRemainingMs(input.options, 'Dependency transition destination readback');
  const preimage = destination;
  const stage = input.stagePath === null
    ? null
    : await observeDependencyTransitionSlot(input.stagePath, input.bindingDigest);
  runtimeDependencyOperationRemainingMs(input.options, 'Dependency transition stage readback');
  const stageRoot = input.stageRootPath === undefined || input.stageRootPath === null
    ? null
    : await observeDependencyTransitionSlot(input.stageRootPath, input.bindingDigest);
  runtimeDependencyOperationRemainingMs(input.options, 'Dependency transition staging-root readback');
  const backup = input.backupPath === null
    ? null
    : await observeDependencyTransitionSlot(input.backupPath, input.bindingDigest);
  runtimeDependencyOperationRemainingMs(input.options, 'Dependency transition backup readback');
  if (input.backupPath !== null) {
    const expectedBackupPath = input.kind === 'compiler-generation'
      ? compilerTransitionBackupPath(ownerRoot.path, 'node_modules', input.sourceGeneration)
      : input.kind === 'compiler-local-locator'
        ? compilerTransitionBackupPath(ownerRoot.path, 'generation', input.sourceGeneration)
        : input.kind === 'compiler-locator'
        ? compilerTransitionBackupPath(ownerRoot.path, 'locator-preimage', input.sourceGeneration)
        : input.kind === 'runtime-projection'
          ? compilerTransitionBackupPath(ownerRoot.path, 'runtime', input.sourceGeneration)
          : input.stageRootPath === null || input.stageRootPath === undefined
            ? null
            : projectTransitionBackupPath(
              ownerRoot.path,
              path.dirname(path.dirname(path.resolve(input.stageRootPath))),
              preimage,
              input.sourceGeneration
            );
    if (expectedBackupPath === null || path.resolve(input.backupPath) !== path.resolve(expectedBackupPath)) {
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition backup path is not derived from canonical operation inputs');
    }
  }
  if (backup !== null && backup.kind !== 'absent') {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition backup path is occupied by a foreign identity and is preserved', {
      backupPath: backup.path,
      backupKind: backup.kind
    });
  }
  if (stage !== null && stage.kind === 'absent') {
    throw new FailureError('RUNTIME-DEPS-002', 'Dependency transition stage disappeared before durable intent');
  }
  if (stageRoot !== null && stageRoot.kind === 'absent') {
    throw new FailureError('RUNTIME-DEPS-002', 'Dependency transition staging root disappeared before durable intent');
  }
  if (stage !== null && stageRoot !== null && stage.kind !== 'absent' && stageRoot.kind !== 'absent') {
    const relativeStage = path.relative(stageRoot.path, stage.path);
    if (relativeStage.startsWith('..') || path.isAbsolute(relativeStage) || relativeStage.length === 0) {
      throw new FailureError('RUNTIME-DEPS-002', 'Dependency transition stage is not contained by its recorded staging root');
    }
  }
  const sourceOwner = inspectNoFollowDirectoryChain(
    input.sourceGeneration.ownerRoot,
    'Dependency transition source-generation owner root'
  ).target;
  if (!sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(sourceOwner),
    input.sourceGeneration.ownerRootPhysical
  )) {
    throw new FailureError(
      'RUNTIME-DEPS-004',
      'Dependency transition source-generation owner physical identity is foreign or stale'
    );
  }
  const stageCarriesSource = (input.kind === 'compiler-generation' ||
    input.kind === 'compiler-local-locator') && stage?.kind === 'directory';
  if (stageCarriesSource) {
    if (stage!.physical === null || !sameGeneratedStateIdentity(
      stage!.physical,
      input.sourceGeneration.physical
    )) {
      throw new FailureError(
        'RUNTIME-DEPS-004',
        'Dependency transition stage is not the compiler-issued source generation'
      );
    }
    if (input.kind === 'compiler-generation' &&
        path.resolve(input.sourceGeneration.sourcePath) !== path.resolve(stage!.path)) {
      throw new FailureError(
        'RUNTIME-DEPS-004',
        'Compiler generation transition source path is not its exact staged generation'
      );
    }
  } else {
    const source = inspectNoFollowDirectoryChain(
      input.sourceGeneration.sourcePath,
      'Dependency transition source generation'
    ).target;
    if (!sameGeneratedStateIdentity(
      generatedStatePhysicalIdentity(source),
      input.sourceGeneration.physical
    )) {
      throw new FailureError(
        'RUNTIME-DEPS-004',
        'Dependency transition source generation physical identity is foreign or stale'
      );
    }
  }
  const current = await readDependencyTransition(ownerRoot.path, input.options);
  if (current !== null && current.phase !== 'complete' && current.phase !== 'rolled-back') {
    throw new FailureError('RUNTIME-DEPS-002', 'Dependency transition already has an active owner-local operation', {
      currentRecordDigest: current.recordDigest,
      currentPhase: current.phase,
      ownerRoot: ownerRoot.path
    });
  }
  const operationKey = transitionOperationKey({
    kind: input.kind,
    ownerRoot: ownerRoot.path,
    destinationPath: input.destinationPath,
    preimage,
    stage,
    stageRoot,
    backup,
    sourceGeneration: input.sourceGeneration
  });
  return writeDependencyTransition(ownerRoot.path, {
    schema: DEPENDENCY_TRANSITION_SCHEMA,
    previousRecordDigest: current?.recordDigest ?? null,
    sequence: (current?.sequence ?? 0) + 1,
    operationKey,
    attemptNonce: crypto.randomUUID(),
    kind: input.kind,
    ownerRoot: ownerRoot.path,
    ownerRootPhysical: generatedStatePhysicalIdentity(ownerRoot),
    destination,
    preimage,
    stage,
    stageRoot,
    backup,
    sourceGeneration: input.sourceGeneration,
    phase: 'prepared',
    durability: 'known',
    failure: null
  }, input.options, current?.recordDigest ?? null);
}

const DEPENDENCY_TRANSITION_UPDATE_FIELDS = Object.freeze([
  'destination', 'stage', 'stageRoot', 'backup', 'sourceGeneration', 'phase', 'durability', 'failure'
] as const);
type DependencyTransitionUpdate = Readonly<Partial<Pick<DependencyTransitionJournal,
  (typeof DEPENDENCY_TRANSITION_UPDATE_FIELDS)[number]>>>;

function captureTransitionUpdate(patch: DependencyTransitionUpdate): DependencyTransitionUpdate {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition update must be an object');
  }
  const selected: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(patch)) {
    const descriptor = Object.getOwnPropertyDescriptor(patch, key);
    if (typeof key !== 'string' || !DEPENDENCY_TRANSITION_UPDATE_FIELDS.includes(key as never)
        || descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition update cannot change immutable fields or use accessors');
    }
    selected[key] = descriptor.value;
  }
  return Object.freeze(selected) as DependencyTransitionUpdate;
}

export async function advanceDependencyTransition(
  previous: DependencyTransitionJournal,
  patch: DependencyTransitionUpdate,
  options: RuntimeDependencyEffectFenceInput
): Promise<DependencyTransitionJournal> {
  assertDependencyTransitionRecordAdmitted(previous);
  // A malformed or foreign predecessor must never be allowed to publish a
  // successor and thereby postpone the topology failure until recovery.
  assertTransitionOperationKey(previous);
  const update = captureTransitionUpdate(patch);
  const { recordDigest: _recordDigest, ...withoutDigest } = previous;
  const successor = Object.freeze({
    ...withoutDigest,
    previousRecordDigest: previous.recordDigest,
    sequence: previous.sequence + 1,
    ...update
  });
  const successorOperationKey = transitionOperationKey({
    kind: successor.kind,
    ownerRoot: successor.ownerRoot,
    destinationPath: successor.destination.path,
    preimage: successor.preimage,
    stage: successor.stage,
    stageRoot: successor.stageRoot,
    backup: successor.backup,
    sourceGeneration: successor.sourceGeneration
  });
  if (successorOperationKey !== previous.operationKey) {
    throw new FailureError(
      'RUNTIME-DEPS-004',
      'Dependency transition successor changes the immutable operation topology',
      {
        expectedOperationKey: previous.operationKey,
        successorOperationKey,
        previousRecordDigest: previous.recordDigest,
        previousSequence: previous.sequence,
        nextSequence: successor.sequence,
        kind: successor.kind,
        previousPhase: previous.phase,
        nextPhase: successor.phase
      }
    );
  }
  return writeDependencyTransition(previous.ownerRoot, successor, options, previous.recordDigest);
}

export async function markDependencyTransitionFailure(
  record: DependencyTransitionJournal,
  error: unknown,
  options: RuntimeDependencyEffectFenceInput,
  phase: DependencyTransitionPhase = 'recovery-required'
): Promise<DependencyTransitionJournal> {
  return advanceDependencyTransition(record, {
    phase,
    durability: 'unknown',
    failure: transitionFailure(error)
  }, options);
}

export function assertDirectStageRootSelector(
  stageRoot: DependencyTransitionSlot,
  parent: string,
  prefix: string
): void {
  const stageRootPath = path.resolve(stageRoot.path);
  if (path.dirname(stageRootPath) !== path.resolve(parent) ||
      !path.basename(stageRootPath).startsWith(prefix)) {
    throw new FailureError(
      'RUNTIME-DEPS-004',
      'Dependency transition stage root is outside its canonical operation selector',
      { stageRootPath, parent: path.resolve(parent), prefix }
    );
  }
  if (stageRoot.kind !== 'directory' && stageRoot.kind !== 'absent') {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition stage root is not an ordinary directory slot');
  }
}

export function assertTransitionBackupSelector(
  transition: DependencyTransitionJournal,
  expectedPath?: string
): void {
  if (transition.backup === null) return;
  const backupParent = path.join(
    transition.ownerRoot, '.tmp', 'dependency-installs', 'compiler-backups'
  );
  if (path.dirname(transition.backup.path) !== backupParent ||
      !/^(?:generation|node_modules|locator-preimage|runtime|project-preimage)-[0-9a-f]{16,64}$/u.test(path.basename(transition.backup.path))) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition backup path is outside its canonical selector');
  }
  if (expectedPath !== undefined && path.resolve(transition.backup.path) !== path.resolve(expectedPath)) {
    throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition backup path is not the operation-derived slot');
  }
}

export function compilerTransitionBackupPath(
  ownerRoot: string,
  prefix: 'generation' | 'node_modules' | 'locator-preimage' | 'runtime',
  sourceGeneration: RuntimeDependencySourceGeneration
): string {
  const namespace = dependencyTransitionNamespacePaths(path.resolve(ownerRoot));
  return path.join(
    namespace.backupRoot,
    `${prefix}-${sourceGeneration.epoch.slice('sha256:'.length, 'sha256:'.length + 24)}`
  );
}

export function projectTransitionBackupPath(
  ownerRoot: string,
  projectRoot: string,
  preimage: DependencyTransitionSlot,
  sourceGeneration: RuntimeDependencySourceGeneration
): string {
  const namespace = dependencyTransitionNamespacePaths(path.resolve(ownerRoot));
  return path.join(
    namespace.backupRoot,
    `project-preimage-${generatedStateDigest({
      schema: 'sec-project-dependency-preimage-v1',
      projectRoot: path.resolve(projectRoot),
      target: preimage,
      sourceGeneration
    }).slice('sha256:'.length, 'sha256:'.length + 32)}`
  );
}

export function assertTransitionOperationKey(
  transition: DependencyTransitionJournal
): void {
  const expected = transitionOperationKey({
    kind: transition.kind,
    ownerRoot: transition.ownerRoot,
    destinationPath: transition.destination.path,
    preimage: transition.preimage,
    stage: transition.stage,
    stageRoot: transition.stageRoot,
    backup: transition.backup,
    sourceGeneration: transition.sourceGeneration
  });
  if (expected !== transition.operationKey) {
    throw new FailureError(
      'RUNTIME-DEPS-004',
      'Dependency transition operation identity is not bound to its canonical topology',
      {
        expectedOperationKey: expected,
        actualOperationKey: transition.operationKey,
        recordDigest: transition.recordDigest,
        kind: transition.kind,
        phase: transition.phase,
        attemptNonce: transition.attemptNonce,
        sequence: transition.sequence,
        previousRecordDigest: transition.previousRecordDigest,
        ownerRoot: transition.ownerRoot,
        destinationPath: transition.destination.path,
        preimage: transition.preimage,
        stagePath: transition.stage?.path ?? null,
        stageRootPath: transition.stageRoot?.path ?? null,
        backupPath: transition.backup?.path ?? null,
        sourceGeneration: transition.sourceGeneration
      }
    );
  }
}
