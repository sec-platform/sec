import path from 'node:path';
import {
  assertGeneratedStateWorktreeRetirement,
  createGeneratedStateSettlement,
  generatedStateDigest,
  generatedStateLegacyRetirementRuleForPath,
  generatedStateRuleForPath,
  normalizeGeneratedStateRelativePath,
  type GeneratedStateCleanupContinuationReceipt,
  type GeneratedStateCleanupProfile,
  type GeneratedStateDisposalReceipt,
  type GeneratedStatePhysicalIdentity
} from '../../../execution/generated-state/contract.ts';
import { GeneratedStateProducerBindingBlockedError } from '../../../execution/generated-state/errors.ts';
import type { GeneratedStateCleanupIntent, GeneratedStateDisposalReceiptKey, GeneratedStateJournalMutationBackend } from '../../../execution/generated-state/journal-port.ts';
import { consumeGeneratedStateProviderSettlement } from '../../../execution/generated-state/provider-effect.ts';
import type { GeneratedStateNativeResource } from '../../../execution/generated-state/registration-port.ts';
import { consumeGeneratedStatePublication } from '../../../execution/generated-state/registration-session.ts';
import { generatedStateOwnerRetirementRef } from '../../../execution/generated-state/registration-transition.ts';
import type { GeneratedStateNativeTerminalEvidence } from '../../../execution/generated-state/terminal-receipt.ts';
import { inspectExactNoFollowDirectoryPresence, inspectNoFollowDirectoryChain } from '../physical/runtime/physical-no-follow.ts';
import { canonicalBytes } from './canonical-bytes.ts';
import {
  parseGeneratedStateCleanupIntentBytes, parseGeneratedStateDisposalReceiptBytes,
  parseWorktreeRetirementIntent
} from './journal-codec.ts';
import { assertGeneratedStateNativeOperationBinding } from './physical-effects.ts';
import {
  observeGeneratedStatePhysicalRoot,
  readRegistrationLedgerObservation,
  registrationKey,
  retainedGeneratedStateMutationStore,
  retainedGeneratedStateObservationStore,
  samePhysicalIdentity,
  type GeneratedStateRuntimeStore
} from './registration-store.ts';

const disposalEvidence = new WeakMap<object, Readonly<{ resource: GeneratedStateNativeResource;
  workspaceRoot: string; key: GeneratedStateDisposalReceiptKey; bytes: string }>>();
const continuationEvidence = new WeakMap<object, Readonly<{ resource: GeneratedStateNativeResource;
  workspaceRoot: string; bytes: string; factsDigest: `sha256:${string}` }>>();
function continuationPhysicalFacts(store: GeneratedStateRuntimeStore, receipt: GeneratedStateCleanupContinuationReceipt) {
  const { receiptDigest: _digest, ...material } = receipt;
  if (generatedStateDigest(material) !== receipt.receiptDigest || new Set(receipt.requested).size !== receipt.requested.length) throw new Error('Continuation receipt material is invalid.');
  const requested = new Set(receipt.requested);
  const claimed = new Set<string>();
  for (const relativePath of [...receipt.completed, ...receipt.quarantined.map(entry => entry.relativePath)]) {
    if (!requested.has(relativePath) || claimed.has(relativePath)) throw new Error('Continuation claims duplicate or unrequested roots.');
    claimed.add(relativePath);
  }
  const facts = receipt.requested.map(relativePath => {
    const ledger = readRegistrationLedgerObservation(store, relativePath);
    const physical = observeGeneratedStatePhysicalRoot(store.workspaceRoot, relativePath);
    const intent = loadCleanupIntent(store, relativePath);
    const tombstone = intent === null ? null : inspectExactNoFollowDirectoryPresence(path.join(store.workspaceRoot, '.tmp', 'generated-state-quarantine', intent.tombstoneName), 'Continuation evidence quarantine readback');
    if (receipt.completed.includes(relativePath) && (physical.kind !== 'missing' || ledger.registration !== null ||
        intent !== null || tombstone?.state === 'present')) throw new Error('Continuation completed claim precedes native absence.');
    const quarantined = receipt.quarantined.find(entry => entry.relativePath === relativePath);
    if (quarantined !== undefined && (physical.kind !== 'missing' || ledger.registration?.phase !== 'retired' ||
        ledger.registration.registrationDigest !== quarantined.registrationDigest || intent?.registrationDigest !== quarantined.registrationDigest ||
        !samePhysicalIdentity(ledger.registration.root, quarantined.physical) || tombstone?.state !== 'present' ||
        !samePhysicalIdentity(tombstone.directory.target, quarantined.physical))) throw new Error('Continuation quarantine claim has no exact original native readback.');
    return { relativePath, ledger, physical: { kind: physical.kind, identity: physical.identity }, intent,
      tombstone: tombstone?.state === 'present' ? { state: 'present', identity: { device: tombstone.directory.target.device,
        inode: tombstone.directory.target.inode, objectId: tombstone.directory.target.objectId } } : { state: 'absent' } };
  });
  if (receipt.terminal === 'completed' && (receipt.completed.length !== receipt.requested.length || receipt.blockers.length > 0 || receipt.quarantined.length > 0)) throw new Error('Continuation terminal does not cover all requested roots.');
  if (receipt.terminal === 'continuation-required' && (receipt.blockers.length > 0 || receipt.quarantined.length === 0 || claimed.size !== requested.size)) throw new Error('Continuation pending terminal does not cover exact roots.');
  return facts;
}
export async function verifyGeneratedStateNativeContinuationEvidence(evidence: GeneratedStateNativeTerminalEvidence,
  input: Readonly<{ workspaceRoot: string; receipt: GeneratedStateCleanupContinuationReceipt }>): Promise<void> {
  const original = continuationEvidence.get(evidence);
  if (original === undefined || original.workspaceRoot !== path.resolve(input.workspaceRoot) || canonicalBytes(input.receipt) !== original.bytes) throw new Error('Continuation evidence is forged, foreign or changed.');
  const store = retainedGeneratedStateObservationStore(original.resource);
  if (store === null || generatedStateDigest(continuationPhysicalFacts(store, input.receipt)) !== original.factsDigest) throw new Error('Continuation native evidence facts changed.');
  await store.assertCurrent();
}
function verifiedDisposalReadback(store: GeneratedStateRuntimeStore, key: GeneratedStateDisposalReceiptKey): GeneratedStateDisposalReceipt {
  const receipt = readGeneratedStateDisposalReceipt(store, key);
  const ledger = readRegistrationLedgerObservation(store, key.relativePath);
  if (receipt === null || ledger.registration !== null || ledger.retiredPredecessor?.registrationDigest !== key.registrationDigest ||
      ledger.retiredPredecessor.retirementRef !== key.retirementRef || !samePhysicalIdentity(ledger.retiredPredecessor.root, key.physical) ||
      observeGeneratedStatePhysicalRoot(store.workspaceRoot, key.relativePath).kind !== 'missing' ||
      inspectExactNoFollowDirectoryPresence(path.join(store.workspaceRoot, '.tmp', 'generated-state-quarantine', `q-${key.registrationDigest.slice(7, 55)}`),
        'Disposal evidence quarantine readback').state !== 'absent') throw new Error('Disposal evidence has no exact current native terminal readback.');
  return receipt;
}
export async function verifyGeneratedStateNativeDisposalEvidence(evidence: GeneratedStateNativeTerminalEvidence,
  input: Readonly<{ workspaceRoot: string; relativePath: string; receipt: GeneratedStateDisposalReceipt }>): Promise<void> {
  const original = disposalEvidence.get(evidence);
  if (original === undefined || original.workspaceRoot !== path.resolve(input.workspaceRoot) ||
      original.key.relativePath !== normalizeGeneratedStateRelativePath(input.relativePath) || canonicalBytes(input.receipt) !== original.bytes) {
    throw new Error('Disposal evidence is forged or belongs to another scope/receipt.');
  }
  const store = retainedGeneratedStateObservationStore(original.resource);
  if (store === null || canonicalBytes(verifiedDisposalReadback(store, original.key)) !== original.bytes) throw new Error('Disposal native readback changed.');
  await store.assertCurrent();
}

const GENERATED_STATE_DISPOSAL_KEY_SCHEMA = 'sec-generated-state-disposal-key-v1' as const;
const WORKTREE_RETIREMENT_ACTIVE_POINTER = 'worktree-retirement-active.json';
const WORKTREE_RETIREMENT_LATEST_POINTER = 'worktree-retirement-latest.json';

export function createGeneratedStateJournalMutationBackend(): GeneratedStateJournalMutationBackend {
  const exactWrite = (store: GeneratedStateRuntimeStore, locator: string, bytes: string): void => {
    if (!store.fs.createExclusiveFsync(locator, bytes) && store.fs.readText(locator) !== bytes) {
      throw new GeneratedStateProducerBindingBlockedError('Generated-state immutable journal publication became occupied.');
    }
    if (store.fs.readText(locator) !== bytes) throw new GeneratedStateProducerBindingBlockedError('Generated-state journal readback changed.');
  };
  return Object.freeze({
    captureContinuationEvidence: (resource, receipt) => {
      const store = retainedGeneratedStateObservationStore(resource);
      if (store === null) throw new Error('Continuation evidence has no original runtime namespace.');
      const facts = continuationPhysicalFacts(store, receipt);
      const evidence = Object.freeze({ kind: 'generated-state-native-terminal-evidence' as const });
      continuationEvidence.set(evidence, Object.freeze({ resource, workspaceRoot: store.workspaceRoot,
        bytes: canonicalBytes(receipt), factsDigest: generatedStateDigest(facts) }));
      return evidence;
    },
    captureDisposalEvidence: (resource, key) => {
      const store = retainedGeneratedStateObservationStore(resource);
      if (store === null) throw new Error('Disposal evidence has no original native namespace.');
      const receipt = verifiedDisposalReadback(store, key);
      const evidence = Object.freeze({ kind: 'generated-state-native-terminal-evidence' as const });
      disposalEvidence.set(evidence, Object.freeze({ resource, workspaceRoot: store.workspaceRoot,
        key: Object.freeze(structuredClone(key)), bytes: canonicalBytes(receipt) }));
      return Object.freeze({ receipt, evidence });
    },
    readCleanupIntent: (resource, relativePath) => {
      const store = retainedGeneratedStateObservationStore(resource); return store === null ? null : loadCleanupIntent(store, relativePath);
    },
    publishCleanupIntent: (resource, authority) => {
      const store = retainedGeneratedStateMutationStore(resource); const request = consumeGeneratedStatePublication(authority, resource);
      if (request.kind !== 'cleanup-intent') throw new GeneratedStateProducerBindingBlockedError('Foreign cleanup intent authority.');
      const intent = parseGeneratedStateCleanupIntentBytes(canonicalBytes(request.intent), request.intent.relativePath);
      const rule = generatedStateRuleForPath(intent.relativePath) ?? generatedStateLegacyRetirementRuleForPath(intent.relativePath);
      const registration = readRegistrationLedgerObservation(store, intent.relativePath).registration;
      const source = observeGeneratedStatePhysicalRoot(store.workspaceRoot, intent.relativePath);
      const { intentDigest: _digest, ...material } = intent;
      if (rule === null || !rule.cleanupProfiles.includes(intent.profile) ||
          generatedStateDigest(material) !== intent.intentDigest || registration?.phase !== 'retired' ||
          registration.registrationDigest !== intent.registrationDigest || source.identity === null ||
          !samePhysicalIdentity(source.identity, intent.root) || !samePhysicalIdentity(registration.root, intent.root)) {
        throw new GeneratedStateProducerBindingBlockedError('Cleanup intent does not bind the exact current retired physical root.');
      }
      const bytes = canonicalBytes(intent); const pointer = transactionPointerPath(store, intent.relativePath);
      const current = loadCleanupIntent(store, intent.relativePath);
      if (current !== null && current.intentDigest !== intent.intentDigest) throw new GeneratedStateProducerBindingBlockedError('Cleanup intent pointer is owned by another operation.');
      exactWrite(store, path.join(store.transactionsRoot, `intent-${intent.intentDigest.slice(7)}.json`), bytes);
      if (current === null) exactWrite(store, pointer, bytes);
      return loadCleanupIntent(store, intent.relativePath)!;
    },
    completeCleanupIntent: (resource, authority) => {
      const store = retainedGeneratedStateMutationStore(resource); const request = consumeGeneratedStatePublication(authority, resource);
      if (request.kind !== 'cleanup-complete') throw new GeneratedStateProducerBindingBlockedError('Foreign cleanup completion authority.');
      const intent = loadCleanupIntent(store, request.relativePath);
      const ledger = readRegistrationLedgerObservation(store, request.relativePath);
      if (intent?.intentDigest !== request.intentDigest || intent.registrationDigest !== request.registrationDigest ||
          ledger.registration !== null || ledger.retiredPredecessor?.registrationDigest !== request.registrationDigest ||
          observeGeneratedStatePhysicalRoot(store.workspaceRoot, request.relativePath).kind !== 'missing') {
        throw new GeneratedStateProducerBindingBlockedError('Cleanup completion has no exact disposed ledger and physical readback.');
      }
      if (inspectExactNoFollowDirectoryPresence(path.join(store.workspaceRoot, '.tmp', 'generated-state-quarantine', intent.tombstoneName),
        'Cleanup completion quarantine readback').state !== 'absent') throw new GeneratedStateProducerBindingBlockedError(
          'Cleanup completion precedes exact quarantine physical absence.');
      const pointer = transactionPointerPath(store, request.relativePath);
      if (!store.fs.deleteFsyncCas(pointer, canonicalBytes(intent)) || store.fs.exists(pointer)) {
        throw new GeneratedStateProducerBindingBlockedError('Cleanup completion pointer changed before compare-bound retirement.');
      }
    },
    readDisposalReceipt: (resource, key) => {
      const store = retainedGeneratedStateObservationStore(resource); return store === null ? null : readGeneratedStateDisposalReceipt(store, key);
    },
    publishDisposalReceipt: (resource, authority) => {
      const store = retainedGeneratedStateMutationStore(resource); const request = consumeGeneratedStatePublication(authority, resource);
      if (request.kind !== 'disposal-receipt') throw new GeneratedStateProducerBindingBlockedError('Foreign disposal receipt authority.');
      const receipt = parseGeneratedStateDisposalReceiptBytes(canonicalBytes(request.receipt), 'Disposal publication');
      const ledger = readRegistrationLedgerObservation(store, receipt.relativePath);
      const cleanupIntent = loadCleanupIntent(store, receipt.relativePath);
      if (ledger.registration !== null || ledger.retiredPredecessor?.registrationDigest !== receipt.registrationDigest ||
          ledger.retiredPredecessor.retirementRef !== receipt.retirementRef ||
          !samePhysicalIdentity(ledger.retiredPredecessor.root, receipt.physical) ||
          observeGeneratedStatePhysicalRoot(store.workspaceRoot, receipt.relativePath).kind !== 'missing') {
        throw new GeneratedStateProducerBindingBlockedError('Disposal receipt has no exact terminal physical and ledger readback.');
      }
      const tombstoneName = cleanupIntent?.tombstoneName ?? `q-${receipt.registrationDigest.slice(7, 55)}`;
      if (inspectExactNoFollowDirectoryPresence(path.join(store.workspaceRoot, '.tmp', 'generated-state-quarantine', tombstoneName),
        'Disposal receipt quarantine readback').state !== 'absent') throw new GeneratedStateProducerBindingBlockedError(
          'Disposal receipt precedes exact quarantine physical absence.');
      exactWrite(store, generatedStateDisposalReceiptPath(store, receipt), canonicalBytes(receipt));
      return readGeneratedStateDisposalReceipt(store, receipt)!;
    },
    readWorktreeRetirementState: resource => {
      const store = retainedGeneratedStateObservationStore(resource);
      if (store === null) return Object.freeze({ activeIntent: null, latestReceipt: null });
      const active = path.join(store.transactionsRoot, WORKTREE_RETIREMENT_ACTIVE_POINTER);
      const latest = path.join(store.settlementsRoot, WORKTREE_RETIREMENT_LATEST_POINTER);
      const activeIntent = store.fs.exists(active) ? parseWorktreeRetirementIntent(JSON.parse(store.fs.readText(active))) : null;
      const latestReceipt = store.fs.exists(latest) ? assertGeneratedStateWorktreeRetirement(JSON.parse(store.fs.readText(latest))) : null;
      if ((activeIntent !== null && canonicalBytes(activeIntent) !== store.fs.readText(active)) ||
          (latestReceipt !== null && canonicalBytes(latestReceipt) !== store.fs.readText(latest))) throw new GeneratedStateProducerBindingBlockedError('Worktree journal bytes are noncanonical.');
      return Object.freeze({ activeIntent, latestReceipt });
    },
    publishWorktreeRetirementIntent: (resource, authority) => {
      const store = retainedGeneratedStateMutationStore(resource); const request = consumeGeneratedStatePublication(authority, resource);
      if (request.kind !== 'worktree-intent') throw new GeneratedStateProducerBindingBlockedError('Foreign worktree intent authority.');
      const intent = parseWorktreeRetirementIntent(request.intent);
      if (path.resolve(intent.workspacePath) !== store.workspaceRoot) throw new GeneratedStateProducerBindingBlockedError('Worktree intent workspace is foreign.');
      const locator = path.join(store.transactionsRoot, WORKTREE_RETIREMENT_ACTIVE_POINTER);
      exactWrite(store, locator, canonicalBytes(intent));
      return parseWorktreeRetirementIntent(JSON.parse(store.fs.readText(locator)));
    },
    completeWorktreeRetirement: async (resource, authority) => {
      const store = retainedGeneratedStateMutationStore(resource); const request = consumeGeneratedStatePublication(authority, resource);
      if (request.kind !== 'worktree-complete') throw new GeneratedStateProducerBindingBlockedError('Foreign worktree completion authority.');
      const receipt = assertGeneratedStateWorktreeRetirement(request.receipt);
      const effectResource = consumeGeneratedStateProviderSettlement(request.effectEvidence, receipt.receiptDigest);
      await assertGeneratedStateNativeOperationBinding(effectResource, store.workspaceRoot);
      const active = path.join(store.transactionsRoot, WORKTREE_RETIREMENT_ACTIVE_POINTER);
      const intent = store.fs.exists(active) ? parseWorktreeRetirementIntent(JSON.parse(store.fs.readText(active))) : null;
      if (intent?.intentDigest !== request.intentDigest || intent.operationId !== receipt.operationId ||
          intent.workspacePath !== receipt.workspacePath || !samePhysicalIdentity(intent.workspace, receipt.workspace) ||
          receipt.terminal !== 'completed') throw new GeneratedStateProducerBindingBlockedError('Worktree completion does not bind the active exact intent.');
      if (intent.repositoryRoot !== receipt.repositoryRoot || canonicalBytes(intent.worktree) !== canonicalBytes(receipt.worktree) ||
          intent.statusDigest !== receipt.statusDigest || intent.inventoryDigest !== receipt.inventoryDigest ||
          canonicalBytes(intent.retentionRoot) !== canonicalBytes(receipt.retentionRoot) || intent.entries.length !== receipt.entries.length) {
        throw new GeneratedStateProducerBindingBlockedError('Worktree completion omits or changes the original admitted inventory.');
      }
      const byPath = new Map(receipt.entries.map(entry => [entry.relativePath, entry]));
      if (byPath.size !== receipt.entries.length) throw new GeneratedStateProducerBindingBlockedError('Worktree completion duplicates an admitted entry.');
      if (intent.retentionRoot !== null) {
        const retention = inspectNoFollowDirectoryChain(intent.retentionRoot.path, 'Worktree completion retention root').target;
        if (!samePhysicalIdentity(retention, intent.retentionRoot)) throw new GeneratedStateProducerBindingBlockedError('Worktree completion retention root identity changed.');
      }
      for (const planned of intent.entries) {
        const entry = byPath.get(planned.relativePath);
        if (entry === undefined || !samePhysicalIdentity(entry.source, planned.source) || entry.inventoryDigest !== planned.inventoryDigest ||
            canonicalBytes(entry.ruleIds) !== canonicalBytes(planned.ruleIds) ||
            observeGeneratedStatePhysicalRoot(store.workspaceRoot, planned.relativePath).kind !== 'missing') {
          throw new GeneratedStateProducerBindingBlockedError('Worktree completion precedes exact complete source physical readback.');
        }
        if (planned.action === 'preserve') {
          if (entry.action !== 'preserved' || entry.destinationName !== planned.destinationName ||
              intent.retentionRoot === null || !samePhysicalIdentity(entry.retained, planned.source)) {
            throw new GeneratedStateProducerBindingBlockedError('Worktree preserved completion changes the admitted destination or identity.');
          }
          const retained = inspectExactNoFollowDirectoryPresence(path.join(intent.retentionRoot.path, planned.destinationName), 'Worktree preserved completion');
          if (retained.state !== 'present' || !samePhysicalIdentity(retained.directory.target, planned.source)) {
            throw new GeneratedStateProducerBindingBlockedError('Worktree preserved completion has no exact retained physical readback.');
          }
        } else {
          const ledger = readRegistrationLedgerObservation(store, planned.relativePath);
          if (entry.action !== 'domain-retired' || entry.providerId !== planned.providerId ||
              entry.providerPlanDigest !== planned.providerPlanDigest || ledger.registration !== null ||
              ledger.retiredPredecessor === null || !samePhysicalIdentity(ledger.retiredPredecessor.root, planned.source) ||
              ledger.retiredPredecessor.registrationId !== planned.registration.registrationId ||
              (planned.registration.phase === 'active' ?
                ledger.retiredPredecessor.retirementRef !== generatedStateOwnerRetirementRef(planned.registration, `worktree-retirement:${intent.operationId}`) ||
                  ledger.previousRegistration?.registrationDigest !== planned.registration.registrationDigest :
                ledger.retiredPredecessor.registrationDigest !== planned.registration.registrationDigest)) {
            throw new GeneratedStateProducerBindingBlockedError('Worktree domain completion has no exact disposed registration and provider binding.');
          }
        }
      }
      exactWrite(store, path.join(store.settlementsRoot, `worktree-retirement-${receipt.receiptDigest.slice(7)}.json`), canonicalBytes(receipt));
      store.fs.replaceFsync(path.join(store.settlementsRoot, WORKTREE_RETIREMENT_LATEST_POINTER), canonicalBytes(receipt));
      if (!store.fs.deleteFsyncCas(active, canonicalBytes(intent)) || store.fs.exists(active)) throw new GeneratedStateProducerBindingBlockedError('Worktree active intent changed before compare-bound completion.');
      return receipt;
    },
    publishCleanupSettlement: (resource, authority) => {
      const store = retainedGeneratedStateMutationStore(resource); const request = consumeGeneratedStatePublication(authority, resource);
      if (request.kind !== 'cleanup-settlement') throw new GeneratedStateProducerBindingBlockedError('Foreign cleanup settlement authority.');
      const { schema: _schema, registryDigest: _registry, generatedAt, settlementDigest: _digest, ...material } = request.settlement;
      const settlement = createGeneratedStateSettlement(material, { clock: () => new Date(generatedAt) });
      if (canonicalBytes(settlement) !== canonicalBytes(request.settlement)) throw new GeneratedStateProducerBindingBlockedError('Cleanup settlement is noncanonical.');
      exactWrite(store, path.join(store.settlementsRoot, `settlement-${settlement.settlementDigest.slice(7)}.json`), canonicalBytes(settlement));
      return settlement;
    }
  } satisfies GeneratedStateJournalMutationBackend);
}

export function transactionPointerPath(store: GeneratedStateRuntimeStore, relativePath: string): string {
  return path.join(store.transactionsRoot, `current-${registrationKey(relativePath)}.json`);
}

export function loadCleanupIntent(store: GeneratedStateRuntimeStore, relativePath: string): GeneratedStateCleanupIntent | null {
  const locator = transactionPointerPath(store, relativePath);
  return store.fs.exists(locator) ? parseGeneratedStateCleanupIntentBytes(store.fs.readText(locator), relativePath) : null;
}

export function generatedStateDisposalReceiptPath(
  store: GeneratedStateRuntimeStore,
  input: Readonly<{
    relativePath: string;
    profile: GeneratedStateCleanupProfile;
    registrationDigest: `sha256:${string}`;
    retirementRef: `sha256:${string}`;
    physical: GeneratedStatePhysicalIdentity;
  }>
): string {
  const key = generatedStateDigest(Object.freeze({
    schema: GENERATED_STATE_DISPOSAL_KEY_SCHEMA,
    relativePath: input.relativePath,
    profile: input.profile,
    registrationDigest: input.registrationDigest,
    retirementRef: input.retirementRef,
    physical: input.physical
  }));
  return path.join(store.settlementsRoot, `disposal-${key.slice('sha256:'.length)}.json`);
}


export function readGeneratedStateDisposalReceipt(
  store: GeneratedStateRuntimeStore,
  expected: Readonly<{
    relativePath: string;
    profile: GeneratedStateCleanupProfile;
    registrationDigest: `sha256:${string}`;
    retirementRef: `sha256:${string}`;
    physical: GeneratedStatePhysicalIdentity;
  }>
): GeneratedStateDisposalReceipt | null {
  const locator = generatedStateDisposalReceiptPath(store, expected);
  if (!store.fs.exists(locator)) return null;
  const receipt = parseGeneratedStateDisposalReceiptBytes(
    store.fs.readText(locator),
    `Generated-state disposal receipt ${expected.relativePath}`
  );
  if (receipt.relativePath !== expected.relativePath || receipt.profile !== expected.profile ||
      receipt.registrationDigest !== expected.registrationDigest ||
      receipt.retirementRef !== expected.retirementRef ||
      !samePhysicalIdentity(receipt.physical, expected.physical)) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state disposal receipt differs from its owner key: ${expected.relativePath}.`
    );
  }
  return receipt;
}
