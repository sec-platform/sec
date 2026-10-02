/**
 * Machine-wide consolidation of retained VerificationAction generations.
 * The source census, target plan, publication and terminal readback share one
 * cutover receipt fence. Historical evidence is never retired by this owner.
 */

import {
  hostname
} from 'node:os';
import path from 'node:path';
import {
  parseExactJson
} from '../../../../contracts/exact-json.ts';
import {
  observePhysicalJournalMutationEntry,
  PHYSICAL_MUTATION_LEASE_SCHEMA
} from '../../../runtime-state/physical/runtime/mutation-lease.ts';
import {
  inspectExactNoFollowDirectoryPresence,
  inspectNoFollowDirectoryChain,
  type NoFollowDirectoryTreeEntry,
  scanNoFollowDirectoryTree,
  scanNoFollowDirectoryTreeSelectedForest
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  hasOwnedRuntimeJournalMutation,
  type RuntimeStateJournalFileSystem,
  runtimeStateJournalMutationLeaseName
} from '../../../runtime-state/workspace-state/journal-filesystem.ts';
import {
  encodeVerificationActionData,
  type VerificationActionKey,
  type VerificationActionKeyDigest
} from './contract/action.ts';
import {
  assertQuarantineDominatesRetainedJournal,
  canonicalLegacyQuarantineReceipt,
  canonicalQuarantineEvidence,
  exactLegacyObservation,
  exactTargetObservation,
  legacyQuarantinePath,
  migratedJournalSource,
  observeJournalSource,
  parseCutoverIntent,
  parseLegacyJournalSource,
  parseLegacyQuarantineReceipt,
  parseRetiredCanonicalJournalForQuarantine
} from './journal-generations.ts';
import {
  actionPath,
  assertDigest,
  assertIsoDate,
  assertNonnegativeSafeInteger,
  CLAIM_KEYS,
  fail,
  JOURNAL_READ_BOUNDS,
  normalizeInventoryPath,
  ownerToken,
  parseCanonicalJournalDocument,
  parseClaim,
  parseJournalSource,
  samePhysical,
  sha256,
  VERIFICATION_ACTION_CLAIM_SCHEMA,
  VERIFICATION_ACTION_JOURNAL_DIRECTORY,
  type VerificationActionClaim,
  type VerificationActionJournalReadback,
  type VerificationActionLegacyQuarantineEvidence,
  type VerificationActionLegacyQuarantineReceipt
} from './journal-records.ts';

const LEGACY_VERIFICATION_ACTION_CLAIM_SCHEMA =
  'sec-verification-action-claim-v1' as const;

const VERIFICATION_ACTION_MACHINE_CUTOVER_SCHEMA =
  'sec-verification-action-machine-cutover' as const;

export const VERIFICATION_ACTION_MACHINE_CUTOVER_FILE =
  'machine-cutover.json' as const;

const MACHINE_CUTOVER_KEYS = Object.freeze([
  'schema', 'sourceInventoryDigest', 'sourceRecordCount', 'sourceByteLength',
  'targetIndexDigest', 'targetActionCount', 'legacyEvidenceDisposition', 'receiptDigest'
]);

interface VerificationActionMachineCutoverReceipt {
  readonly schema: typeof VERIFICATION_ACTION_MACHINE_CUTOVER_SCHEMA;
  readonly sourceInventoryDigest: VerificationActionKeyDigest;
  readonly sourceRecordCount: number;
  readonly sourceByteLength: number;
  readonly targetIndexDigest: VerificationActionKeyDigest;
  readonly targetActionCount: number;
  readonly legacyEvidenceDisposition: 'retained-until-owner-authorized-retirement';
  readonly receiptDigest: VerificationActionKeyDigest;
}

function verifyLegacyQuarantineEvidenceFromCensus(
  receipt: VerificationActionLegacyQuarantineReceipt,
  observedByPath: ReadonlyMap<string, MachineCutoverObservedFile>
): void {
  for (const evidence of receipt.sourceEvidence) {
    const observed = observedByPath.get(evidence.path);
    if (observed === undefined
        || !samePhysical(observed.physical, evidence.physical)
        || observed.byteLength !== evidence.byteLength
        || sha256(observed.text) !== evidence.ledgerDigest) {
      fail('legacy quarantine source evidence changed before owner-authorized retirement.', 'recovery-required');
    }
  }
}

function parseMachineCutoverClaim(
  source: string,
  expectedActionKey: VerificationActionKeyDigest
): VerificationActionClaim {
  const value = parseCanonicalJournalDocument(
    source,
    'VerificationAction machine cutover claim',
    CLAIM_KEYS
  );
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('machine cutover claim must be an object.');
  }
  const claim = value as Record<string, unknown>;
  if (claim.schema === VERIFICATION_ACTION_CLAIM_SCHEMA) {
    return parseClaim(source, expectedActionKey);
  }
  if (claim.schema !== LEGACY_VERIFICATION_ACTION_CLAIM_SCHEMA
      || claim.actionKey !== expectedActionKey) {
    fail('machine cutover claim identity mismatch.');
  }
  const acquiredAt = assertIsoDate(claim.acquiredAt);
  const expiresAt = assertIsoDate(claim.expiresAt);
  if (expiresAt <= acquiredAt) fail('machine cutover claim expiry must be after acquisition.');
  return Object.freeze({
    schema: VERIFICATION_ACTION_CLAIM_SCHEMA,
    actionKey: expectedActionKey,
    ownerToken: ownerToken(claim.ownerToken),
    acquiredAt,
    expiresAt
  });
}

interface MachineCutoverObservedFile {
  readonly filePath: string;
  readonly inventoryPath: string;
  readonly text: string;
  readonly byteLength: number;
  readonly physical: Readonly<{ device: string; inode: string }>;
}

interface MachineCutoverActionGroup {
  readonly groupId: string;
  readonly actionKey: VerificationActionKeyDigest;
  canonical: MachineCutoverObservedFile | null;
  legacy: MachineCutoverObservedFile | null;
  intent: MachineCutoverObservedFile | null;
  claim: MachineCutoverObservedFile | null;
  readonly auxiliary: MachineCutoverObservedFile[];
}

interface MachineCutoverCensus {
  readonly groups: readonly MachineCutoverActionGroup[];
  readonly existingTargets: ReadonlyMap<VerificationActionKeyDigest, Readonly<{
    journal: MachineCutoverObservedFile | null;
    quarantine: MachineCutoverObservedFile | null;
  }>>;
  readonly sourceInventoryDigest: VerificationActionKeyDigest;
  readonly sourceRecordCount: number;
  readonly sourceByteLength: number;
}

interface MachineCutoverObservedQuarantine {
  readonly actionKey: VerificationActionKeyDigest;
  readonly observed: MachineCutoverObservedFile;
  readonly receipt: VerificationActionLegacyQuarantineReceipt;
}

const MACHINE_CUTOVER_MAXIMUM_ENTRIES = 100_000;

const MACHINE_CUTOVER_MAXIMUM_SOURCE_BYTES = 256 * 1024 * 1024;

const MACHINE_CUTOVER_RECEIPT_MAXIMUM_BYTES = 64 * 1024;

const WORKSPACE_LOCATOR_PATTERN = /^[0-9a-f]{64}$/u;

const ACTION_FILE_PATTERN = /^([0-9a-f]{64})\.jsonl$/u;

const ACTION_CLAIM_PATTERN = /^([0-9a-f]{64})\.jsonl\.claim\.json$/u;

const ACTION_RECOVERY_LOCK_PATTERN = /^([0-9a-f]{64})\.jsonl\.claim-recovery\.lock$/u;

const ACTION_CUTOVER_PATTERN = /^([0-9a-f]{64})\.cutover\.json$/u;

const ACTION_QUARANTINE_PATTERN = /^([0-9a-f]{64})\.legacy-quarantine\.json$/u;

const MUTATION_LEASE_NAME_PATTERN = /^\.journal-mutation-([0-9a-f]{64})\.lock$/u;

const MUTATION_LEASE_CANDIDATE_PATTERN = /^(\.\.journal-mutation-[0-9a-f]{64}\.lock)\.([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.candidate$/u;

const MUTATION_LEASE_OWNER_KEYS = Object.freeze([
  'createdAtMs', 'expiresAtMs', 'host', 'pid', 'processNonce', 'schema', 'token'
]);

const LEGACY_START_RECEIPT_PATTERN = /^([0-9a-f]{64})\.start-receipt\.json$/u;

const LEGACY_TERMINAL_EVIDENCE_PATTERN = /^([0-9a-f]{64})\.terminal-evidence\.json$/u;

const LEGACY_PROCESS_SETTLEMENT_PATTERN = /^([0-9a-f]{64})\.process-settlement\.json$/u;

const LEGACY_STATIC_RECORD_PATTERN = /^([0-9a-f]{64})\.json$/u;

const LEGACY_ACTION_EVIDENCE_DIRECTORIES = new Set([
  'settlement-current',
  'static-closures',
  'static-current',
  'static-generations'
]);

const LEGACY_PROCESS_SETTLEMENT_KEYS = Object.freeze([
  'actionKey', 'executionBindingDigest', 'observation', 'observedAt',
  'providerRevision', 'receiptDigest', 'schema', 'state'
]);

const LEGACY_SETTLEMENT_RECEIPT_KEYS = Object.freeze([
  'actionKey', 'detailDigest', 'evidenceDigest', 'executionBindingDigest',
  'observedAt', 'phase', 'providerRevision', 'reasonCode', 'receiptDigest',
  'schema', 'state'
]);

const LEGACY_STATIC_CLOSURE_V1_KEYS = Object.freeze([
  'actionKey', 'actionPlan', 'actionPlanDigest', 'analysisReadback',
  'analysisStage', 'closureDigest', 'dependencyEvidence', 'dimensions',
  'environmentDigest', 'invalidationDigest', 'openDefectClasses',
  'operationSemanticDigest', 'producer', 'retirement', 'schema', 'status',
  'subjectDigest', 'trackedInputDigest', 'unknowns'
]);

const LEGACY_STATIC_CLOSURE_V2_KEYS = Object.freeze([
  ...LEGACY_STATIC_CLOSURE_V1_KEYS,
  'proofScope'
]);

const LEGACY_STATIC_CLOSURE_V2_BOUND_KEYS = Object.freeze([
  ...LEGACY_STATIC_CLOSURE_V2_KEYS,
  'actionPlanClosureDigest'
]);

const LEGACY_STATIC_POINTER_KEYS = Object.freeze([
  'actionKey', 'actionPlanDigest', 'closureDigest', 'headTreeSha',
  'pointerDigest', 'readbackDigest', 'schema'
]);

const LEGACY_STATIC_POINTER_BOUND_KEYS = Object.freeze([
  ...LEGACY_STATIC_POINTER_KEYS,
  'actionPlanClosureDigest', 'staticGenerationDigest'
]);

interface LegacyStaticClosureProjection {
  readonly actionKey: VerificationActionKeyDigest;
  readonly actionPlanDigest: VerificationActionKeyDigest;
  readonly closureDigest: VerificationActionKeyDigest;
  readonly readbackDigest: VerificationActionKeyDigest;
}

interface LegacyStaticPointerProjection extends LegacyStaticClosureProjection {
  readonly headTreeSha: string;
}

function parseLegacyStaticClosure(
  source: string,
  expectedClosureDigest: VerificationActionKeyDigest
): LegacyStaticClosureProjection {
  const preliminary = parseExactJson(source.slice(0, -1), 'VerificationAction legacy static closure');
  if (preliminary === null || typeof preliminary !== 'object' || Array.isArray(preliminary)) {
    fail('legacy static closure must be an object.');
  }
  const candidate = preliminary as Record<string, unknown>;
  const keys = candidate.schema === 'sec-development-critical-path-static-closure-v1'
    ? LEGACY_STATIC_CLOSURE_V1_KEYS
    : candidate.schema === 'sec-development-critical-path-static-closure-v2'
      ? Object.hasOwn(candidate, 'actionPlanClosureDigest')
        ? LEGACY_STATIC_CLOSURE_V2_BOUND_KEYS
        : LEGACY_STATIC_CLOSURE_V2_KEYS
      : fail('legacy static closure schema is unknown.');
  const value = parseCanonicalJournalDocument(
    source,
    'VerificationAction legacy static closure',
    keys
  ) as Record<string, unknown>;
  const closureDigest = assertDigest(value.closureDigest, 'legacy static closure closureDigest');
  if (closureDigest !== expectedClosureDigest) fail('legacy static closure filename digest mismatch.');
  const { closureDigest: _closureDigest, ...unsigned } = value;
  if (sha256(encodeVerificationActionData(unsigned)) !== closureDigest) {
    fail('legacy static closure digest mismatch.');
  }
  const actionKey = assertDigest(value.actionKey, 'legacy static closure actionKey');
  const actionPlanDigest = assertDigest(value.actionPlanDigest, 'legacy static closure actionPlanDigest');
  if (actionKey === null || actionPlanDigest === null) fail('legacy static closure identity is incomplete.');
  if (Object.hasOwn(value, 'actionPlanClosureDigest')) {
    assertDigest(value.actionPlanClosureDigest, 'legacy static closure actionPlanClosureDigest');
  }
  if (value.analysisReadback === null || typeof value.analysisReadback !== 'object'
      || Array.isArray(value.analysisReadback)) {
    fail('legacy static closure analysis readback is invalid.');
  }
  const readbackDigest = assertDigest(
    (value.analysisReadback as Record<string, unknown>).readbackDigest,
    'legacy static closure readbackDigest'
  );
  if (readbackDigest === null) fail('legacy static closure readbackDigest is missing.');
  return Object.freeze({ actionKey, actionPlanDigest, closureDigest, readbackDigest });
}

function parseLegacyStaticPointer(
  source: string,
  expectedActionKey: VerificationActionKeyDigest
): LegacyStaticPointerProjection {
  const preliminary = parseExactJson(source.slice(0, -1), 'VerificationAction legacy static pointer');
  if (preliminary === null || typeof preliminary !== 'object' || Array.isArray(preliminary)) {
    fail('legacy static pointer must be an object.');
  }
  const candidate = preliminary as Record<string, unknown>;
  const keys = Object.hasOwn(candidate, 'actionPlanClosureDigest')
    ? LEGACY_STATIC_POINTER_BOUND_KEYS
    : LEGACY_STATIC_POINTER_KEYS;
  const value = parseCanonicalJournalDocument(
    source,
    'VerificationAction legacy static pointer',
    keys
  ) as Record<string, unknown>;
  if (value.schema !== 'sec-verification-action-static-closure-pointer-v1'
      || value.actionKey !== expectedActionKey) {
    fail('legacy static pointer identity is invalid.');
  }
  const actionPlanDigest = assertDigest(value.actionPlanDigest, 'legacy static pointer actionPlanDigest');
  const closureDigest = assertDigest(value.closureDigest, 'legacy static pointer closureDigest');
  const readbackDigest = assertDigest(value.readbackDigest, 'legacy static pointer readbackDigest');
  const pointerDigest = assertDigest(value.pointerDigest, 'legacy static pointer pointerDigest');
  if (actionPlanDigest === null || closureDigest === null || readbackDigest === null
      || pointerDigest === null || typeof value.headTreeSha !== 'string'
      || !/^[0-9a-f]{40}$/u.test(value.headTreeSha)) {
    fail('legacy static pointer fields are invalid.');
  }
  if (Object.hasOwn(value, 'actionPlanClosureDigest')) {
    if (assertDigest(value.actionPlanClosureDigest, 'legacy static pointer actionPlanClosureDigest') === null
        || assertDigest(value.staticGenerationDigest, 'legacy static pointer staticGenerationDigest') === null) {
      fail('legacy static pointer generation binding is invalid.');
    }
  }
  const { pointerDigest: _pointerDigest, ...unsigned } = value;
  if (sha256(encodeVerificationActionData(unsigned)) !== pointerDigest) {
    fail('legacy static pointer digest mismatch.');
  }
  return Object.freeze({
    actionKey: expectedActionKey,
    actionPlanDigest,
    closureDigest,
    readbackDigest,
    headTreeSha: value.headTreeSha
  });
}

function parseLegacyProcessSettlement(
  source: string,
  expectedActionKey: VerificationActionKeyDigest
): void {
  const parsed = parseCanonicalJournalDocument(
    source,
    'VerificationAction legacy process settlement',
    LEGACY_PROCESS_SETTLEMENT_KEYS
  );
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('legacy process settlement must be an object.');
  }
  const value = parsed as Record<string, unknown>;
  if (value.schema !== 'sec-verification-action-process-settlement-v1'
      || value.actionKey !== expectedActionKey
      || value.state !== 'settled') {
    fail('legacy process settlement identity is invalid.');
  }
  assertDigest(value.executionBindingDigest, 'legacy process settlement executionBindingDigest');
  assertIsoDate(value.observedAt);
  if (typeof value.providerRevision !== 'string' || value.providerRevision.length === 0
      || value.providerRevision.length > 512 || /[\u0000-\u001f]/u.test(value.providerRevision)) {
    fail('legacy process settlement providerRevision must be bounded text.');
  }
  if (value.observation === null || typeof value.observation !== 'object'
      || Array.isArray(value.observation)) {
    fail('legacy process settlement observation is invalid.');
  }
  const receiptDigest = assertDigest(
    value.receiptDigest,
    'legacy process settlement receiptDigest'
  );
  const { receiptDigest: _receiptDigest, ...unsigned } = value;
  if (receiptDigest !== sha256(encodeVerificationActionData(unsigned))) {
    fail('legacy process settlement receipt digest mismatch.');
  }
}

function parseLegacySettlementReceipt(
  source: string,
  expectedActionKey: VerificationActionKeyDigest
): void {
  const parsed = parseCanonicalJournalDocument(
    source,
    'VerificationAction legacy settlement receipt',
    LEGACY_SETTLEMENT_RECEIPT_KEYS
  );
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('legacy settlement receipt must be an object.');
  }
  const value = parsed as Record<string, unknown>;
  const isKnownTerminalState = (value.state === 'confirmed'
      && value.reasonCode === 'settlement-confirmed')
    || (value.state === 'settled' && value.reasonCode === 'settled');
  if (value.schema !== 'sec-verification-action-settlement-v1'
      || value.actionKey !== expectedActionKey
      || value.phase !== 'complete'
      || !isKnownTerminalState) {
    fail('legacy settlement receipt identity is invalid.');
  }
  assertDigest(value.detailDigest, 'legacy settlement detailDigest');
  assertDigest(value.evidenceDigest, 'legacy settlement evidenceDigest');
  assertDigest(value.executionBindingDigest, 'legacy settlement executionBindingDigest');
  assertIsoDate(value.observedAt);
  if (typeof value.providerRevision !== 'string' || value.providerRevision.length === 0
      || value.providerRevision.length > 512 || /[\u0000-\u001f]/u.test(value.providerRevision)) {
    fail('legacy settlement providerRevision must be bounded text.');
  }
  const receiptDigest = assertDigest(value.receiptDigest, 'legacy settlement receiptDigest');
  const { receiptDigest: _receiptDigest, ...unsigned } = value;
  if (receiptDigest !== sha256(encodeVerificationActionData(unsigned))) {
    fail('legacy settlement receipt digest mismatch.');
  }
}

function machineCutoverReceiptPath(fs: RuntimeStateJournalFileSystem): string {
  return path.join(
    fs.rootPath,
    VERIFICATION_ACTION_JOURNAL_DIRECTORY,
    VERIFICATION_ACTION_MACHINE_CUTOVER_FILE
  );
}

function machineCutoverDigest(
  input: Omit<VerificationActionMachineCutoverReceipt, 'receiptDigest'>
): VerificationActionKeyDigest {
  return sha256(encodeVerificationActionData(input));
}

function canonicalMachineCutoverReceipt(
  input: Omit<VerificationActionMachineCutoverReceipt, 'receiptDigest'>
): VerificationActionMachineCutoverReceipt {
  return Object.freeze({ ...input, receiptDigest: machineCutoverDigest(input) });
}

function parseMachineCutoverReceipt(source: string): VerificationActionMachineCutoverReceipt {
  const parsed = parseCanonicalJournalDocument(
    source,
    'VerificationAction machine cutover receipt',
    MACHINE_CUTOVER_KEYS
  );
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('machine cutover receipt must be an object.');
  }
  const value = parsed as Record<string, unknown>;
  if (value.schema !== VERIFICATION_ACTION_MACHINE_CUTOVER_SCHEMA
      || value.legacyEvidenceDisposition !== 'retained-until-owner-authorized-retirement') {
    fail('machine cutover receipt identity is invalid.');
  }
  const receipt = {
    schema: VERIFICATION_ACTION_MACHINE_CUTOVER_SCHEMA,
    sourceInventoryDigest: assertDigest(
      value.sourceInventoryDigest,
      'machine cutover sourceInventoryDigest'
    )!,
    sourceRecordCount: assertNonnegativeSafeInteger(
      value.sourceRecordCount,
      'machine cutover sourceRecordCount'
    ),
    sourceByteLength: assertNonnegativeSafeInteger(
      value.sourceByteLength,
      'machine cutover sourceByteLength'
    ),
    targetIndexDigest: assertDigest(
      value.targetIndexDigest,
      'machine cutover targetIndexDigest'
    )!,
    targetActionCount: assertNonnegativeSafeInteger(
      value.targetActionCount,
      'machine cutover targetActionCount'
    ),
    legacyEvidenceDisposition: 'retained-until-owner-authorized-retirement' as const
  };
  const receiptDigest = assertDigest(value.receiptDigest, 'machine cutover receiptDigest')!;
  const expected = machineCutoverDigest(receipt);
  if (receiptDigest !== expected) {
    fail(`machine cutover receipt digest mismatch (${String(receiptDigest)} != ${expected}).`);
  }
  return Object.freeze({ ...receipt, receiptDigest });
}

function observedInventoryFile(
  absolutePath: string,
  inventoryPath: string,
  entry: NoFollowDirectoryTreeEntry
): MachineCutoverObservedFile {
  if (entry.kind !== 'file') fail(`machine cutover source ${inventoryPath} is not an ordinary file.`);
  if (entry.bytes === null || entry.bytes.byteLength !== entry.size) {
    fail(`machine cutover source ${inventoryPath} has no exact retained bytes.`);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(entry.bytes);
  } catch {
    fail(`machine cutover source ${inventoryPath} is not exact UTF-8.`);
  }
  return Object.freeze({
    filePath: absolutePath,
    inventoryPath,
    text,
    byteLength: entry.size,
    physical: Object.freeze({ device: entry.device, inode: entry.inode })
  });
}

function machineCutoverGroup(
  groups: Map<string, MachineCutoverActionGroup>,
  groupId: string,
  actionKey: VerificationActionKeyDigest
): MachineCutoverActionGroup {
  const composite = `${groupId}\0${actionKey}`;
  let group = groups.get(composite);
  if (group === undefined) {
    group = {
      groupId,
      actionKey,
      canonical: null,
      legacy: null,
      intent: null,
      claim: null,
      auxiliary: []
    };
    groups.set(composite, group);
  }
  return group;
}

function assignMachineCutoverFile(
  group: MachineCutoverActionGroup,
  field: 'canonical' | 'legacy' | 'intent' | 'claim',
  observed: MachineCutoverObservedFile
): void {
  if (group[field] !== null) fail(`machine cutover found duplicate ${field} evidence for ${group.actionKey}.`);
  group[field] = observed;
}

interface MutationPublicationOwnerObservation {
  readonly host: string;
  readonly pid: number;
  readonly processNonce: string;
  readonly token: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

function mutationPublicationOwner(source: string): MutationPublicationOwnerObservation {
  if (!source.endsWith('\n') || source.endsWith('\n\n')) {
    fail('mutation publication candidate bytes are not one newline-terminated document.', 'recovery-required');
  }
  const parsed = parseExactJson(
    source.slice(0, -1),
    'Runtime State mutation publication candidate',
    { rootObjectKeys: MUTATION_LEASE_OWNER_KEYS }
  );
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('mutation publication candidate owner is invalid.', 'recovery-required');
  }
  const value = parsed as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  if (value.schema !== PHYSICAL_MUTATION_LEASE_SCHEMA
      || typeof value.host !== 'string' || value.host.length === 0 || value.host.length > 255
      || !Number.isSafeInteger(value.pid) || Number(value.pid) <= 0
      || typeof value.processNonce !== 'string' || !uuid.test(value.processNonce)
      || typeof value.token !== 'string' || !uuid.test(value.token)
      || !Number.isSafeInteger(value.createdAtMs) || Number(value.createdAtMs) < 0
      || !Number.isSafeInteger(value.expiresAtMs)
      || Number(value.expiresAtMs) < Number(value.createdAtMs)) {
    fail('mutation publication candidate owner is malformed.', 'recovery-required');
  }
  const owner = Object.freeze({
    host: value.host,
    pid: Number(value.pid),
    processNonce: value.processNonce,
    token: value.token,
    createdAtMs: Number(value.createdAtMs),
    expiresAtMs: Number(value.expiresAtMs)
  });
  const exactWriterBytes = `${JSON.stringify({
    schema: PHYSICAL_MUTATION_LEASE_SCHEMA,
    host: owner.host,
    pid: owner.pid,
    processNonce: owner.processNonce,
    token: owner.token,
    createdAtMs: owner.createdAtMs,
    expiresAtMs: owner.expiresAtMs
  })}\n`;
  if (source !== exactWriterBytes) {
    fail('mutation publication candidate bytes do not match the physical owner grammar.', 'recovery-required');
  }
  return owner;
}

function localProcessLiveness(pid: number): 'alive' | 'dead' | 'unknown' {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    return error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH'
      ? 'dead'
      : 'unknown';
  }
}

function classifyMutationPublicationCandidate(input: Readonly<{
  fs: RuntimeStateJournalFileSystem;
  fileName: string;
  absolutePath: string;
  inventoryPath: string;
  entry: NoFollowDirectoryTreeEntry;
  deadline: number;
  machineReceiptLockName: string;
  allowIncompleteReceiptPublication: boolean;
}>): never {
  const match = MUTATION_LEASE_CANDIDATE_PATTERN.exec(input.fileName);
  if (match === null) {
    fail(`machine cutover found malformed mutation publication residue at ${input.inventoryPath}.`, 'recovery-required');
  }
  const isReceiptPublication = match[1]!.slice(1) === input.machineReceiptLockName;
  const candidate = observedInventoryFile(
    input.absolutePath,
    input.inventoryPath,
    input.entry
  );
  let owner: MutationPublicationOwnerObservation;
  try {
    owner = mutationPublicationOwner(candidate.text);
  } catch {
    if (isReceiptPublication && input.allowIncompleteReceiptPublication) {
      fail('machine cutover mutation publication is incomplete.', 'recovery-required');
    }
    fail(`machine cutover found malformed mutation publication candidate at ${input.inventoryPath}.`, 'recovery-required');
  }
  if (owner.host !== hostname()) {
    fail(`machine cutover found foreign-host mutation publication candidate at ${input.inventoryPath}.`, 'recovery-required');
  }
  const liveness = localProcessLiveness(owner.pid);
  if (liveness === 'alive') {
    if (isReceiptPublication) {
      fail('machine cutover mutation is contended.', 'recovery-required');
    }
    fail(`machine cutover observed an active physical mutation publication at ${input.inventoryPath}.`, 'recovery-required');
  }
  if (liveness === 'dead') {
    fail(`machine cutover found a stale mutation publication candidate at ${input.inventoryPath}; physical owner recovery is required.`, 'recovery-required');
  }
  fail(`machine cutover cannot prove mutation publication owner liveness at ${input.inventoryPath}.`, 'recovery-required');
}

function classifyMachineCutoverFile(input: Readonly<{
  fs: RuntimeStateJournalFileSystem;
  groups: Map<string, MachineCutoverActionGroup>;
  evidence: MachineCutoverObservedFile[];
  quarantines: MachineCutoverObservedQuarantine[];
  groupId: string;
  domain: 'terminal-bound' | 'v2';
  fileName: string;
  absolutePath: string;
  inventoryPath: string;
  entry: NoFollowDirectoryTreeEntry;
  deadline: number;
  machineReceiptLockName: string;
  allowIncompleteReceiptPublication: boolean;
  global: boolean;
}>): void {
  if (/^\.sec-journal-guard-[0-9a-f]{64}\.lock$/u.test(input.fileName)
    || MUTATION_LEASE_NAME_PATTERN.test(input.fileName)) {
    const parent = inspectNoFollowDirectoryChain(path.dirname(input.absolutePath), 'Journal guard census parent').target;
    const guarded = observePhysicalJournalMutationEntry(parent, input.fileName);
    if (guarded !== null) {
      if (guarded.state === 'idle'
        || (input.global && guarded.leaseName === input.machineReceiptLockName
          && hasOwnedRuntimeJournalMutation(input.fs, guarded.leaseName))) return;
      fail(`machine cutover found an active guarded journal mutation at ${input.inventoryPath}.`, 'recovery-required');
    }
    if (input.fileName.startsWith('.sec-journal-guard-')) {
      fail(`machine cutover found an unqualified journal anchor at ${input.inventoryPath}.`, 'recovery-required');
    }
  }
  if (input.global && input.domain === 'terminal-bound') {
    if (input.fileName === VERIFICATION_ACTION_MACHINE_CUTOVER_FILE) return;
    if (input.fileName === input.machineReceiptLockName) return;
    const quarantine = ACTION_QUARANTINE_PATTERN.exec(input.fileName);
    if (quarantine !== null) {
      const observed = observedInventoryFile(
        input.absolutePath,
        input.inventoryPath,
        input.entry
      );
      const receipt = parseLegacyQuarantineReceipt(
        observed.text,
        `sha256:${quarantine[1]}` as VerificationActionKeyDigest
      );
      input.quarantines.push(Object.freeze({
        actionKey: receipt.actionKey,
        observed,
        receipt
      }));
      return;
    }
  }
  if (input.fileName.startsWith('.journal-mutation-')
      || input.fileName.startsWith('..journal-mutation-')) {
    if (input.fileName.endsWith('.candidate')) {
      classifyMutationPublicationCandidate(input);
    }
    if (MUTATION_LEASE_NAME_PATTERN.exec(input.fileName) === null) {
      fail(`machine cutover found malformed mutation lease residue at ${input.inventoryPath}.`, 'recovery-required');
    }
    if (input.global) return;
    fail(`machine cutover found an active journal mutation at ${input.inventoryPath}.`, 'recovery-required');
  }
  const claim = ACTION_CLAIM_PATTERN.exec(input.fileName);
  const recoveryLock = ACTION_RECOVERY_LOCK_PATTERN.exec(input.fileName);
  if (recoveryLock !== null) {
    if (input.global) return;
    fail(`machine cutover found an unresolved physical claim at ${input.inventoryPath}.`, 'recovery-required');
  }
  if (claim !== null) {
    if (input.global) return;
    const actionKey = `sha256:${claim[1]}` as VerificationActionKeyDigest;
    const observed = observedInventoryFile(
      input.absolutePath,
      input.inventoryPath,
      input.entry
    );
    parseMachineCutoverClaim(observed.text, actionKey);
    assignMachineCutoverFile(
      machineCutoverGroup(input.groups, input.groupId, actionKey),
      'claim',
      observed
    );
    input.evidence.push(observed);
    return;
  }
  const actionMatch = ACTION_FILE_PATTERN.exec(input.fileName);
  const cutoverMatch = ACTION_CUTOVER_PATTERN.exec(input.fileName);
  const legacyAuxiliary = input.domain === 'v2'
    ? (LEGACY_START_RECEIPT_PATTERN.exec(input.fileName)
      ?? LEGACY_TERMINAL_EVIDENCE_PATTERN.exec(input.fileName)
      ?? LEGACY_PROCESS_SETTLEMENT_PATTERN.exec(input.fileName))
    : null;
  if (legacyAuxiliary !== null) {
    const observed = observedInventoryFile(
      input.absolutePath,
      input.inventoryPath,
      input.entry
    );
    const group = machineCutoverGroup(
      input.groups,
      input.groupId,
      `sha256:${legacyAuxiliary[1]}` as VerificationActionKeyDigest
    );
    if (LEGACY_PROCESS_SETTLEMENT_PATTERN.test(input.fileName)) {
      parseLegacyProcessSettlement(observed.text, group.actionKey);
    }
    group.auxiliary.push(observed);
    input.evidence.push(observed);
    return;
  }
  const match = actionMatch ?? cutoverMatch;
  if (match === null) fail(`machine cutover found unknown journal residue at ${input.inventoryPath}.`);
  const actionKey = `sha256:${match[1]}` as VerificationActionKeyDigest;
  const observed = observedInventoryFile(
    input.absolutePath,
    input.inventoryPath,
    input.entry
  );
  const group = machineCutoverGroup(input.groups, input.groupId, actionKey);
  if (cutoverMatch !== null) {
    if (input.domain !== 'terminal-bound') fail(`machine cutover intent is in the wrong domain at ${input.inventoryPath}.`);
    assignMachineCutoverFile(group, 'intent', observed);
  } else if (input.domain === 'terminal-bound') {
    assignMachineCutoverFile(group, 'canonical', observed);
  } else {
    assignMachineCutoverFile(group, 'legacy', observed);
  }
  if (!input.global || input.domain === 'v2' || cutoverMatch !== null) input.evidence.push(observed);
}

function scanMachineCutoverTree(input: Readonly<{
  fs: RuntimeStateJournalFileSystem;
  rootPath: string;
  mode: 'workspaces' | 'global';
  groups: Map<string, MachineCutoverActionGroup>;
  evidence: MachineCutoverObservedFile[];
  quarantines: MachineCutoverObservedQuarantine[];
  deadline: number;
  machineReceiptLockName: string;
  allowIncompleteReceiptPublication: boolean;
}>): void {
  const presence = inspectExactNoFollowDirectoryPresence(
    input.rootPath,
    `VerificationAction ${input.mode} cutover root`
  );
  if (presence.state === 'absent') return;
  const inventory = input.mode === 'workspaces'
    ? scanNoFollowDirectoryTreeSelectedForest(presence.directory.target, {
      deadlineAtMs: input.deadline,
      maximumEntries: MACHINE_CUTOVER_MAXIMUM_ENTRIES,
      maximumBytes: MACHINE_CUTOVER_MAXIMUM_SOURCE_BYTES,
      includeRelativePaths: ['*/verification-actions'],
      omitNavigationPrefixes: true
    })
    : scanNoFollowDirectoryTree(presence.directory.target, {
    deadlineAtMs: input.deadline,
    maximumEntries: MACHINE_CUTOVER_MAXIMUM_ENTRIES,
    maximumBytes: MACHINE_CUTOVER_MAXIMUM_SOURCE_BYTES
  });
  const staticClosures = new Map<string, LegacyStaticClosureProjection>();
  const staticPointers: Array<Readonly<{
    groupId: string;
    inventoryPath: string;
    projection: LegacyStaticPointerProjection;
  }>> = [];
  const staticClosureKey = (groupId: string, closureDigest: VerificationActionKeyDigest): string =>
    `${groupId}:${closureDigest}`;
  for (const entry of inventory) {
    const relativePath = normalizeInventoryPath(entry.relativePath);
    if (relativePath.length === 0) continue;
    const segments = relativePath.split('/');
    let groupId: string;
    let domain: 'terminal-bound' | 'v2';
    let fileName: string;
    if (input.mode === 'workspaces') {
      if (!WORKSPACE_LOCATOR_PATTERN.test(segments[0]!)) {
        fail(`machine cutover found a noncanonical workspace locator at ${relativePath}.`);
      }
      if (segments.length === 1) {
        if (entry.kind !== 'directory') fail(`machine cutover path ${relativePath} is not a directory.`);
        continue;
      }
      if (segments[1] !== 'verification-actions') {
        fail(`machine cutover selected an unexpected workspace path at ${relativePath}.`);
      }
      if (segments.length === 2) {
        if (entry.kind !== 'directory') fail(`machine cutover path ${relativePath} is not a directory.`);
        continue;
      }
      if ((segments[2] !== 'terminal-bound' && segments[2] !== 'v2') || segments.length > 5) {
        fail(`machine cutover found unknown workspace journal residue at ${relativePath}.`);
      }
      if (segments.length === 3) {
        if (entry.kind !== 'directory') fail(`machine cutover path ${relativePath} is not a directory.`);
        continue;
      }
      if (segments.length === 4 && segments[2] === 'v2'
          && LEGACY_ACTION_EVIDENCE_DIRECTORIES.has(segments[3]!)) {
        if (entry.kind !== 'directory') fail(`machine cutover path ${relativePath} is not a directory.`);
        continue;
      }
      if (segments.length === 5) {
        if (segments[2] !== 'v2'
            || !LEGACY_ACTION_EVIDENCE_DIRECTORIES.has(segments[3]!)) {
          fail(`machine cutover found unknown workspace journal residue at ${relativePath}.`);
        }
        const staticRecord = LEGACY_STATIC_RECORD_PATTERN.exec(segments[4]!);
        if (staticRecord === null) fail(`machine cutover found unknown static evidence at ${relativePath}.`);
        const observed = observedInventoryFile(
          path.join(input.rootPath, ...segments),
          normalizeInventoryPath(path.relative(input.fs.rootPath, path.join(input.rootPath, ...segments))),
          entry
        );
        const actionKey = `sha256:${staticRecord[1]}` as VerificationActionKeyDigest;
        if (segments[3] === 'static-closures') {
          const closure = parseLegacyStaticClosure(observed.text, actionKey);
          const key = staticClosureKey(segments[0]!, closure.closureDigest);
          if (staticClosures.has(key)) {
            fail(`machine cutover found duplicate static closure evidence at ${relativePath}.`);
          }
          staticClosures.set(key, closure);
        } else if (segments[3] === 'static-current') {
          staticPointers.push(Object.freeze({
            groupId: segments[0]!,
            inventoryPath: observed.inventoryPath,
            projection: parseLegacyStaticPointer(observed.text, actionKey)
          }));
        } else if (segments[3] === 'settlement-current') {
          parseLegacySettlementReceipt(observed.text, actionKey);
        }
        input.evidence.push(observed);
        if (segments[3] === 'settlement-current') {
          const group = machineCutoverGroup(
            input.groups,
            segments[0]!,
            actionKey
          );
          group.auxiliary.push(observed);
        }
        continue;
      }
      groupId = segments[0]!;
      domain = segments[2] as 'terminal-bound' | 'v2';
      fileName = segments[3]!;
    } else {
      if ((segments[0] !== 'terminal-bound' && segments[0] !== 'v2') || segments.length > 3) {
        fail(`machine cutover found unknown global journal residue at ${relativePath}.`);
      }
      if (segments.length === 1) {
        if (entry.kind !== 'directory') fail(`machine cutover path ${relativePath} is not a directory.`);
        continue;
      }
      if (segments.length === 2 && segments[0] === 'v2'
          && (segments[1] === 'static-closures' || segments[1] === 'static-current')) {
        if (entry.kind !== 'directory') fail(`machine cutover path ${relativePath} is not a directory.`);
        continue;
      }
      if (segments.length === 3) {
        if (segments[0] !== 'v2'
            || (segments[1] !== 'static-closures' && segments[1] !== 'static-current')) {
          fail(`machine cutover found unknown global journal residue at ${relativePath}.`);
        }
        const staticRecord = LEGACY_STATIC_RECORD_PATTERN.exec(segments[2]!);
        if (staticRecord === null) fail(`machine cutover found unknown static evidence at ${relativePath}.`);
        const observed = observedInventoryFile(
          path.join(input.rootPath, ...segments),
          normalizeInventoryPath(path.relative(input.fs.rootPath, path.join(input.rootPath, ...segments))),
          entry
        );
        input.evidence.push(observed);
        const identity = `sha256:${staticRecord[1]}` as VerificationActionKeyDigest;
        if (segments[1] === 'static-closures') {
          const closure = parseLegacyStaticClosure(observed.text, identity);
          const key = staticClosureKey('@machine', closure.closureDigest);
          if (staticClosures.has(key)) {
            fail(`machine cutover found duplicate static closure evidence at ${relativePath}.`);
          }
          staticClosures.set(key, closure);
        } else {
          staticPointers.push(Object.freeze({
            groupId: '@machine',
            inventoryPath: observed.inventoryPath,
            projection: parseLegacyStaticPointer(observed.text, identity)
          }));
        }
        continue;
      }
      groupId = '@machine';
      domain = segments[0] as 'terminal-bound' | 'v2';
      fileName = segments[1]!;
    }
    classifyMachineCutoverFile({
      fs: input.fs,
      groups: input.groups,
      evidence: input.evidence,
      quarantines: input.quarantines,
      groupId,
      domain,
      fileName,
      absolutePath: path.join(input.rootPath, ...segments),
      inventoryPath: normalizeInventoryPath(path.relative(input.fs.rootPath, path.join(input.rootPath, ...segments))),
      entry,
      deadline: input.deadline,
      machineReceiptLockName: input.machineReceiptLockName,
      allowIncompleteReceiptPublication: input.allowIncompleteReceiptPublication,
      global: input.mode === 'global'
    });
  }
  for (const pointer of staticPointers) {
    const closure = staticClosures.get(staticClosureKey(
      pointer.groupId,
      pointer.projection.closureDigest
    ));
    if (closure === undefined) {
      fail(`machine cutover static pointer has no retained closure at ${pointer.inventoryPath}.`);
    }
    if (closure.actionKey !== pointer.projection.actionKey
        || closure.actionPlanDigest !== pointer.projection.actionPlanDigest
        || closure.readbackDigest !== pointer.projection.readbackDigest) {
      fail(`machine cutover static pointer binding mismatch at ${pointer.inventoryPath}.`);
    }
  }
}

type MachineCutoverTarget = Readonly<
  | {
    kind: 'journal';
    actionKey: VerificationActionKeyDigest;
    source: string;
    action: VerificationActionKey;
    sourceEvidence: readonly VerificationActionLegacyQuarantineEvidence[];
  }
  | {
    kind: 'quarantine';
    actionKey: VerificationActionKeyDigest;
    action: VerificationActionKey | null;
    sourceEvidence: readonly VerificationActionLegacyQuarantineEvidence[];
    retainedJournalSource: string | null;
  }
>;

function quarantineEvidence(
  observed: readonly MachineCutoverObservedFile[]
): readonly VerificationActionLegacyQuarantineEvidence[] {
  return Object.freeze(observed.map((entry) => Object.freeze({
    path: entry.inventoryPath,
    physical: entry.physical,
    ledgerDigest: sha256(entry.text),
    byteLength: entry.byteLength
  })));
}

function machineCutoverCandidate(group: MachineCutoverActionGroup): MachineCutoverTarget {
  if (group.canonical !== null) {
    let canonical: VerificationActionJournalReadback;
    try {
      canonical = parseJournalSource(group.canonical.filePath, group.actionKey, group.canonical.text);
    } catch {
      if (group.claim !== null) {
        fail(`machine cutover found a claim bound to unreadable canonical evidence for ${group.actionKey}.`, 'recovery-required');
      }
      const retiredAction = parseRetiredCanonicalJournalForQuarantine(group.actionKey, group.canonical.text);
      return Object.freeze({
        kind: 'quarantine',
        actionKey: group.actionKey,
        action: retiredAction,
        sourceEvidence: quarantineEvidence([group.canonical, ...group.auxiliary]),
        retainedJournalSource: null
      });
    }
    if (group.claim !== null) {
      const claim = parseMachineCutoverClaim(group.claim.text, group.actionKey);
      if (Date.parse(claim.expiresAt) >= Date.now()) {
        fail(`machine cutover found an active physical claim for ${group.actionKey}.`, 'recovery-required');
      }
      if (group.groupId === '@machine'
          || (canonical.latestState !== 'queued' && canonical.latestState !== 'running')) {
        fail(`machine cutover found an unresolved physical claim for ${group.actionKey}.`, 'recovery-required');
      }
      return Object.freeze({
        kind: 'quarantine',
        actionKey: group.actionKey,
        action: canonical.action,
        sourceEvidence: quarantineEvidence([
          group.canonical,
          group.claim,
          ...(group.legacy === null ? [] : [group.legacy]),
          ...(group.intent === null ? [] : [group.intent]),
          ...group.auxiliary
        ]),
        retainedJournalSource: group.canonical.text
      });
    }
    if (group.groupId !== '@machine'
        && (canonical.latestState === 'queued' || canonical.latestState === 'running')) {
      if (canonical.action === null) fail(`machine cutover canonical Action ${group.actionKey} is empty.`);
      return Object.freeze({
        kind: 'quarantine',
        actionKey: group.actionKey,
        action: canonical.action,
        sourceEvidence: quarantineEvidence([
          group.canonical,
          ...(group.legacy === null ? [] : [group.legacy]),
          ...(group.intent === null ? [] : [group.intent]),
          ...group.auxiliary
        ]),
        retainedJournalSource: null
      });
    }
    if (group.legacy === null && group.intent === null) {
      if (canonical.action === null) fail(`machine cutover canonical Action ${group.actionKey} is empty.`);
      return Object.freeze({
        kind: 'journal',
        actionKey: group.actionKey,
        source: group.canonical.text,
        action: canonical.action,
        sourceEvidence: quarantineEvidence([group.canonical, ...group.auxiliary])
      });
    }
    if (group.legacy === null || group.intent === null) {
      fail(`machine cutover found a partial per-workspace cutover for ${group.actionKey}.`, 'recovery-required');
    }
    const intent = parseCutoverIntent(group.intent.text);
    if (intent.phase !== 'complete' || intent.actionKey !== group.actionKey) {
      fail(`machine cutover found an incomplete per-workspace cutover for ${group.actionKey}.`, 'recovery-required');
    }
    exactLegacyObservation(group.legacy, intent);
    exactTargetObservation(group.canonical, intent);
    if (canonical.action === null) fail(`machine cutover canonical Action ${group.actionKey} is empty.`);
    return Object.freeze({
      kind: 'journal',
      actionKey: group.actionKey,
      source: group.canonical.text,
      action: canonical.action,
      sourceEvidence: quarantineEvidence([
        group.canonical, group.legacy, group.intent, ...group.auxiliary
      ])
    });
  }
  if (group.intent !== null) {
    fail(`machine cutover intent for ${group.actionKey} has no canonical target.`, 'recovery-required');
  }
  if (group.legacy === null) {
    if (group.claim !== null) {
      fail(`machine cutover found an unresolved physical claim for ${group.actionKey}.`, 'recovery-required');
    }
    fail(`machine cutover group ${group.groupId} has no journal evidence.`);
  }
  const legacy = parseLegacyJournalSource(group.actionKey, group.legacy.text);
  const latest = legacy.at(-1) ?? null;
  if (latest === null || (latest.state !== 'terminal' && latest.state !== 'reused')) {
    if (group.claim !== null) {
      const claim = parseMachineCutoverClaim(group.claim.text, group.actionKey);
      if (Date.parse(claim.expiresAt) >= Date.now()) {
        fail(`machine cutover found an active physical claim for ${group.actionKey}.`, 'recovery-required');
      }
      if (latest === null) {
        fail(`machine cutover found an expired claim without journal evidence for ${group.actionKey}.`, 'recovery-required');
      }
      // The retired claim grammar has no retained process handle, attempt
      // receipt or terminal authority.  Expiry therefore cannot authorize a
      // retry or promote sibling evidence to PASS.  The current recovery
      // contract would durably cancel an abandoned queued/running Action and
      // require a new Action identity; cutover preserves the old bytes and
      // establishes the stronger machine-global equivalent by quarantining
      // this ActionKey against both reuse and execution.
      return Object.freeze({
        kind: 'quarantine',
        actionKey: group.actionKey,
        action: latest.action,
        sourceEvidence: quarantineEvidence([group.legacy, group.claim, ...group.auxiliary]),
        retainedJournalSource: null
      });
    }
    if (latest === null) fail(`machine cutover found empty legacy Action ${group.actionKey}.`);
    return Object.freeze({
      kind: 'quarantine',
      actionKey: group.actionKey,
      action: latest.action,
      sourceEvidence: quarantineEvidence([group.legacy, ...group.auxiliary]),
      retainedJournalSource: null
    });
  }
  if (group.claim !== null) {
    const claim = parseMachineCutoverClaim(group.claim.text, group.actionKey);
    const expiresAtMs = Date.parse(claim.expiresAt);
    const acquiredAtMs = Date.parse(claim.acquiredAt);
    const terminalAtMs = Date.parse(latest.recordedAt);
    if (expiresAtMs >= Date.now()) {
      fail(`machine cutover found an active physical claim for ${group.actionKey}.`, 'recovery-required');
    }
    if (terminalAtMs < acquiredAtMs) {
      fail(`machine cutover claim is not dominated by its legacy terminal for ${group.actionKey}.`, 'recovery-required');
    }
    if (latest.terminal !== null || latest.terminalMigratable
        || !legacy.slice(0, -1).every(({ terminalMigratable }) => terminalMigratable)) {
      fail(`machine cutover found an unclassified terminal claim residue for ${group.actionKey}.`, 'recovery-required');
    }
    return Object.freeze({
      kind: 'quarantine',
      actionKey: group.actionKey,
      action: latest.action,
      sourceEvidence: quarantineEvidence([group.legacy, group.claim, ...group.auxiliary]),
      retainedJournalSource: null
    });
  }
  if (latest.terminal !== null && legacy.every(({ terminalMigratable }) => terminalMigratable)) {
    if (latest.action === null) {
      return Object.freeze({
        kind: 'quarantine',
        actionKey: group.actionKey,
        action: null,
        sourceEvidence: quarantineEvidence([group.legacy, ...group.auxiliary]),
        retainedJournalSource: null
      });
    }
    return Object.freeze({
      kind: 'journal',
      actionKey: group.actionKey,
      source: migratedJournalSource(legacy),
      action: latest.action,
      sourceEvidence: quarantineEvidence([group.legacy, ...group.auxiliary])
    });
  }
  if (latest.terminal === null && !latest.terminalMigratable
      && legacy.slice(0, -1).every(({ terminalMigratable }) => terminalMigratable)) {
    return Object.freeze({
      kind: 'quarantine',
      actionKey: group.actionKey,
      action: latest.action,
      sourceEvidence: quarantineEvidence([group.legacy, ...group.auxiliary]),
      retainedJournalSource: null
    });
  }
  fail(`machine cutover found an unclassified legacy Action ${group.actionKey}.`, 'recovery-required');
}

function mergeMachineCutoverCandidate(
  current: MachineCutoverTarget | undefined,
  candidate: MachineCutoverTarget,
  actionKey: VerificationActionKeyDigest
): MachineCutoverTarget {
  if (current === undefined) return candidate;
  if (current.kind !== candidate.kind) {
    const trusted = current.kind === 'journal' ? current : candidate;
    const quarantined = current.kind === 'quarantine' ? current : candidate;
    if (trusted.kind !== 'journal' || quarantined.kind !== 'quarantine') {
      fail(`machine cutover lost its journal/quarantine discriminant for ${actionKey}.`);
    }
    if (trusted.actionKey !== quarantined.actionKey) {
      fail(`machine cutover found divergent quarantine identities for ${actionKey}.`, 'recovery-required');
    }
    return Object.freeze({
      kind: 'quarantine',
      actionKey,
      action: quarantined.action ?? trusted.action,
      sourceEvidence: canonicalQuarantineEvidence([
        ...trusted.sourceEvidence,
        ...quarantined.sourceEvidence
      ]),
      retainedJournalSource: quarantined.retainedJournalSource === trusted.source
        ? trusted.source
        : null
    });
  }
  if (current.kind === 'journal' && candidate.kind === 'journal') {
    if (candidate.source === current.source || candidate.source.startsWith(current.source)) return candidate;
    if (current.source.startsWith(candidate.source)) return current;
    return Object.freeze({
      kind: 'quarantine',
      actionKey,
      action: current.action,
      sourceEvidence: canonicalQuarantineEvidence([
        ...current.sourceEvidence,
        ...candidate.sourceEvidence
      ]),
      retainedJournalSource: null
    });
  }
  if (current.kind === 'quarantine' && candidate.kind === 'quarantine') {
    if (current.actionKey !== candidate.actionKey) {
      fail(`machine cutover found divergent quarantine identities for ${actionKey}.`, 'recovery-required');
    }
    if (current.retainedJournalSource !== null
        && candidate.retainedJournalSource !== null
        && current.retainedJournalSource !== candidate.retainedJournalSource) {
      fail(`machine cutover found divergent retained journal evidence for ${actionKey}.`, 'recovery-required');
    }
    return Object.freeze({
      kind: 'quarantine',
      actionKey,
      action: current.action ?? candidate.action,
      sourceEvidence: canonicalQuarantineEvidence([
        ...current.sourceEvidence,
        ...candidate.sourceEvidence
      ]),
      retainedJournalSource: current.retainedJournalSource ?? candidate.retainedJournalSource
    });
  }
  fail(`machine cutover found divergent journal chains for ${actionKey}.`, 'recovery-required');
}

function collectMachineCutoverCensus(
  fs: RuntimeStateJournalFileSystem,
  deadline: number,
  machineReceiptLockName: string,
  allowIncompleteReceiptPublication: boolean
): MachineCutoverCensus {
  const groups = new Map<string, MachineCutoverActionGroup>();
  const evidence: MachineCutoverObservedFile[] = [];
  const quarantines: MachineCutoverObservedQuarantine[] = [];
  scanMachineCutoverTree({
    fs,
    rootPath: path.join(fs.rootPath, 'workspaces', 'v1'),
    mode: 'workspaces',
    groups,
    evidence,
    quarantines,
    deadline,
    machineReceiptLockName,
    allowIncompleteReceiptPublication
  });
  scanMachineCutoverTree({
    fs,
    rootPath: path.join(fs.rootPath, 'verification-actions'),
    mode: 'global',
    groups,
    evidence,
    quarantines,
    deadline,
    machineReceiptLockName,
    allowIncompleteReceiptPublication
  });
  const inventory = evidence
    .map((entry) => Object.freeze({
      path: entry.inventoryPath,
      device: entry.physical.device,
      inode: entry.physical.inode,
      byteLength: entry.byteLength,
      contentDigest: sha256(entry.text)
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const sourceByteLength = inventory.reduce((total, entry) => total + entry.byteLength, 0);
  if (!Number.isSafeInteger(sourceByteLength) || sourceByteLength > MACHINE_CUTOVER_MAXIMUM_SOURCE_BYTES) {
    fail('machine cutover source bytes exceed the aggregate ceiling.', 'recovery-required');
  }
  const observedByPath = new Map<string, MachineCutoverObservedFile>();
  const addObserved = (observed: MachineCutoverObservedFile | null): void => {
    if (observed === null) return;
    const prior = observedByPath.get(observed.inventoryPath);
    if (prior !== undefined && prior !== observed) {
      fail(`machine cutover observed duplicate physical evidence at ${observed.inventoryPath}.`, 'recovery-required');
    }
    observedByPath.set(observed.inventoryPath, observed);
  };
  for (const observed of evidence) addObserved(observed);
  for (const group of groups.values()) {
    addObserved(group.canonical);
    addObserved(group.legacy);
    addObserved(group.intent);
    addObserved(group.claim);
    for (const auxiliary of group.auxiliary) addObserved(auxiliary);
  }
  for (const quarantine of quarantines) addObserved(quarantine.observed);
  const existingTargets = new Map<VerificationActionKeyDigest, {
    journal: MachineCutoverObservedFile | null;
    quarantine: MachineCutoverObservedFile | null;
  }>();
  const existingTarget = (actionKey: VerificationActionKeyDigest) => {
    let target = existingTargets.get(actionKey);
    if (target === undefined) {
      target = { journal: null, quarantine: null };
      existingTargets.set(actionKey, target);
    }
    return target;
  };
  for (const group of groups.values()) {
    if (group.groupId === '@machine' && group.canonical !== null) {
      const target = existingTarget(group.actionKey);
      if (target.journal !== null) fail(`machine cutover found duplicate machine journal for ${group.actionKey}.`);
      target.journal = group.canonical;
    }
  }
  for (const quarantine of quarantines) {
    verifyLegacyQuarantineEvidenceFromCensus(quarantine.receipt, observedByPath);
    const target = existingTarget(quarantine.actionKey);
    if (target.quarantine !== null) fail(`machine cutover found duplicate machine quarantine for ${quarantine.actionKey}.`);
    target.quarantine = quarantine.observed;
  }
  for (const [actionKey, target] of existingTargets) {
    if (target.journal !== null && target.quarantine !== null) {
      const quarantine = quarantines.find((entry) => entry.actionKey === actionKey);
      if (quarantine === undefined) fail(`machine cutover lost quarantine projection for ${actionKey}.`);
      assertQuarantineDominatesRetainedJournal(fs, quarantine.receipt, target.journal, actionKey);
    }
  }
  return Object.freeze({
    groups: Object.freeze([...groups.values()]),
    existingTargets,
    sourceInventoryDigest: sha256(encodeVerificationActionData(inventory)),
    sourceRecordCount: inventory.length,
    sourceByteLength
  });
}

interface MachineCutoverPlannedTarget {
  readonly actionKey: VerificationActionKeyDigest;
  readonly target: MachineCutoverTarget;
  readonly source: string;
}

function planMachineCutoverTargets(
  census: MachineCutoverCensus
): readonly MachineCutoverPlannedTarget[] {
  const merged = new Map<VerificationActionKeyDigest, MachineCutoverTarget>();
  for (const group of census.groups) {
    const candidate = machineCutoverCandidate(group);
    merged.set(
      group.actionKey,
      mergeMachineCutoverCandidate(merged.get(group.actionKey), candidate, group.actionKey)
    );
  }
  return Object.freeze([...merged.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([actionKey, target]) => {
      let plannedTarget = target;
      const retained = census.existingTargets.get(actionKey)?.journal ?? null;
      if (target.kind === 'quarantine' && retained !== null
          && target.sourceEvidence.some((entry) =>
            entry.path === retained.inventoryPath
              && samePhysical(entry.physical, retained.physical)
              && entry.byteLength === retained.byteLength
              && entry.ledgerDigest === sha256(retained.text))) {
        plannedTarget = Object.freeze({
          ...target,
          retainedJournalSource: retained.text
        });
      }
      return Object.freeze({
        actionKey,
        target: plannedTarget,
        source: plannedTarget.kind === 'journal'
          ? plannedTarget.source
          : `${encodeVerificationActionData(canonicalLegacyQuarantineReceipt(plannedTarget))}\n`
      });
    }));
}

function publishMachineCutoverTargets(
  fs: RuntimeStateJournalFileSystem,
  census: MachineCutoverCensus,
  planned: readonly MachineCutoverPlannedTarget[]
): void {
  for (const { actionKey, target, source } of planned) {
    const filePath = target.kind === 'journal'
      ? actionPath(fs, actionKey)
      : legacyQuarantinePath(fs, actionKey);
    const existingTargets = census.existingTargets.get(actionKey);
    const existing = target.kind === 'journal'
      ? existingTargets?.journal ?? null
      : existingTargets?.quarantine ?? null;
    const conflicting = target.kind === 'journal'
      ? existingTargets?.quarantine ?? null
      : existingTargets?.journal ?? null;
    if (conflicting !== null) {
      if (target.kind !== 'quarantine' || target.retainedJournalSource !== conflicting.text) {
        fail(`machine cutover target kind conflicts for ${actionKey}.`, 'recovery-required');
      }
      assertQuarantineDominatesRetainedJournal(
        fs,
        canonicalLegacyQuarantineReceipt(target),
        conflicting,
        actionKey
      );
    }
    if (existing === null) {
      if (!fs.createExclusiveFsync(filePath, source)) {
        fail(`machine cutover target changed concurrently for ${actionKey}.`, 'recovery-required');
      }
    } else if (existing.text !== source) {
      if (!source.startsWith(existing.text)
          || !fs.replaceFsyncCas(filePath, existing.text, source)) {
        fail(`machine cutover target conflicts for ${actionKey}.`, 'recovery-required');
      }
    }
  }
}

function readbackMachineCutoverTargets(
  fs: RuntimeStateJournalFileSystem,
  census: MachineCutoverCensus,
  planned: readonly MachineCutoverPlannedTarget[]
): Readonly<{ targetIndexDigest: VerificationActionKeyDigest; targetActionCount: number }> {
  if (census.existingTargets.size !== planned.length) {
    fail('machine cutover target set changed before completion.', 'recovery-required');
  }
  const targetIndex = planned.map(({ actionKey, target, source }) => {
    const existing = census.existingTargets.get(actionKey);
    const readback = target.kind === 'journal' ? existing?.journal ?? null : existing?.quarantine ?? null;
    const conflicting = target.kind === 'journal' ? existing?.quarantine ?? null : existing?.journal ?? null;
    if (readback === null || readback.text !== source) {
      fail(`machine cutover target readback mismatch for ${actionKey}.`, 'recovery-required');
    }
    if (conflicting !== null) {
      if (target.kind !== 'quarantine' || target.retainedJournalSource !== conflicting.text) {
        fail(`machine cutover target kind conflicts for ${actionKey}.`, 'recovery-required');
      }
      assertQuarantineDominatesRetainedJournal(
        fs,
        parseLegacyQuarantineReceipt(readback.text, actionKey),
        conflicting,
        actionKey
      );
    }
    if (target.kind === 'journal') parseJournalSource(readback.filePath, actionKey, readback.text);
    else parseLegacyQuarantineReceipt(readback.text, actionKey);
    return Object.freeze({
      actionKey,
      kind: target.kind,
      ledgerDigest: sha256(readback.text),
      byteLength: readback.byteLength,
      physical: readback.physical
    });
  });
  return Object.freeze({
    targetIndexDigest: sha256(encodeVerificationActionData(targetIndex)),
    targetActionCount: targetIndex.length
  });
}

function machineCutoverPlanDigest(
  planned: readonly MachineCutoverPlannedTarget[]
): VerificationActionKeyDigest {
  return sha256(encodeVerificationActionData(planned.map(({ actionKey, target, source }) => ({
    actionKey,
    kind: target.kind,
    sourceDigest: sha256(source),
    byteLength: Buffer.byteLength(source, 'utf8')
  }))));
}

/**
 * Completes the one machine-generation cutover before any global ActionKey
 * admission. Old workspace journals remain read-only migration evidence; the
 * completed receipt is the retirement fence, so normal Action reads never
 * rescan workspace history or retain a dual-read compatibility path.
 */
export function ensureVerificationActionMachineGlobalCutover(
  fs: RuntimeStateJournalFileSystem,
  // Runner-only observation seam: an empty same-lock candidate is allowed one
  // bounded filesystem-settlement window, then the strict classifier decides.
  // It never grants owner identity, liveness, or mutation authority.
  options: Readonly<{ allowIncompleteReceiptPublication?: boolean }> = {}
): VerificationActionMachineCutoverReceipt {
  const receiptPath = machineCutoverReceiptPath(fs);
  const existing = observeJournalSource(
    fs,
    receiptPath,
    performance.now() + JOURNAL_READ_BOUNDS.durationMs
  );
  if (existing !== null) {
    if (existing.byteLength === 0) fail('machine cutover receipt is empty.');
    return parseMachineCutoverReceipt(existing.text);
  }
  const receiptLockName = runtimeStateJournalMutationLeaseName(fs.rootPath, receiptPath);
  let result: string;
  try {
    result = fs.mutateTextFsync(
      receiptPath,
      '',
      MACHINE_CUTOVER_RECEIPT_MAXIMUM_BYTES,
      (current) => {
      if (current.length > 0) return `${encodeVerificationActionData(parseMachineCutoverReceipt(current))}\n`;
      const deadline = performance.now() + JOURNAL_READ_BOUNDS.durationMs;
      const initial = collectMachineCutoverCensus(
        fs,
        deadline,
        receiptLockName,
        options.allowIncompleteReceiptPublication === true
      );
      const initialPlan = planMachineCutoverTargets(initial);
      publishMachineCutoverTargets(fs, initial, initialPlan);
      const final = collectMachineCutoverCensus(
        fs,
        deadline,
        receiptLockName,
        options.allowIncompleteReceiptPublication === true
      );
      if (final.sourceInventoryDigest !== initial.sourceInventoryDigest
          || final.sourceRecordCount !== initial.sourceRecordCount
          || final.sourceByteLength !== initial.sourceByteLength) {
        fail('machine cutover source inventory changed before completion.', 'recovery-required');
      }
      const finalPlan = planMachineCutoverTargets(final);
      if (machineCutoverPlanDigest(finalPlan) !== machineCutoverPlanDigest(initialPlan)) {
        fail('machine cutover target plan changed before completion.', 'recovery-required');
      }
      const finalTargets = readbackMachineCutoverTargets(fs, final, finalPlan);
      const receipt = canonicalMachineCutoverReceipt({
        schema: VERIFICATION_ACTION_MACHINE_CUTOVER_SCHEMA,
        sourceInventoryDigest: final.sourceInventoryDigest,
        sourceRecordCount: final.sourceRecordCount,
        sourceByteLength: final.sourceByteLength,
        targetIndexDigest: finalTargets.targetIndexDigest,
        targetActionCount: finalTargets.targetActionCount,
        legacyEvidenceDisposition: 'retained-until-owner-authorized-retirement'
      });
        return `${encodeVerificationActionData(receipt)}\n`;
      }
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'Runtime State journal mutation is contended.') {
      fail('machine cutover mutation is contended.', 'recovery-required');
    }
    throw error;
  }
  return parseMachineCutoverReceipt(result);
}
