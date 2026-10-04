import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import path from 'node:path';

import {
  PhysicalNoFollowError,
  assertDurableCanonicalFileIdentityReceipt,
  createExclusiveNoFollowDirectory,
  deleteRetainedNoFollowEntry,
  flushNoFollowDirectory,
  inspectExactNoFollowDirectoryPresence,
  inspectNoFollowOrdinaryFileEntry,
  observeDurableCanonicalFileReplacement,
  publishExclusiveDurableCanonicalFile,
  recoverDurableCanonicalFileReplacement,
  replaceDurableCanonicalFile,
  tryRetainExclusiveFileGuard,
  type DurableCanonicalFileIdentityReceipt,
  type DurableCanonicalFilePublicationReceipt,
  type PhysicalDirectoryIdentity,
  type RetainedExclusiveFileGuard
} from './physical-no-follow.ts';

export const PHYSICAL_MUTATION_LEASE_SCHEMA = 'sec-physical-mutation-lease-v1' as const;
const LEASE_RECORD_SCHEMA = 'sec-physical-mutation-lease-record-v2' as const;

export interface PhysicalMutationLeaseOwner {
  readonly schema: typeof PHYSICAL_MUTATION_LEASE_SCHEMA;
  readonly host: string;
  readonly pid: number;
  readonly processNonce: string;
  readonly token: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

export interface PhysicalMutationLeaseHandle {
  readonly owner: PhysicalMutationLeaseOwner;
  /** Prior guarded canonical-record coordinator; not process/effect terminal proof. */
  readonly reclaimedOwner: PhysicalMutationLeaseOwner | null;
  readonly recoveryPending: boolean;
  /** Clear durable predecessor lineage only after consumer recovery/readback. */
  acknowledgeReclaimedRecovery(): void;
  /**
   * Restores the exact predecessor bytes when successor admission cannot
   * complete. The recovery identity remains durable for a later successor;
   * this handle cannot release that restored owner lease afterward.
   */
  restoreReclaimedOwner(): void;
  release(): void;
}

export interface PhysicalMutationLeaseOptions {
  readonly now?: () => number;
  readonly ownerHost?: string;
  readonly ownerPid?: number;
  /** Legacy diagnostic seam only; never authorizes recovery. */
  readonly processAlive?: (pid: number) => 'alive' | 'dead' | 'unknown';
  readonly processNonce?: string;
  readonly ttlMs?: number;
  readonly journalResource?: PhysicalJournalMutationResource;
  readonly coordinationResource?: PhysicalMutationCoordinationResource;
}

const PROCESS_NONCE = randomUUID();
const issuedLeaseAssertions = new WeakMap<object, () => void>();
const issuedCoordinationNamespaces = new WeakMap<object, () => PhysicalDirectoryIdentity>();
export function ensurePhysicalMutationCoordinationNamespace(handle: PhysicalMutationLeaseHandle): PhysicalDirectoryIdentity {
  const ensure = issuedCoordinationNamespaces.get(handle);
  if (ensure === undefined) throw new Error('Coordination namespace handle was not issued by its physical owner.');
  return ensure();
}
const issuedJournalDeletions = new WeakMap<object, (expected: Readonly<{ device: string; inode: string; bytes: Uint8Array }>) => void>();

export function deletePhysicalJournalMutationFile(
  handle: PhysicalMutationLeaseHandle,
  expected: Readonly<{ device: string; inode: string; bytes: Uint8Array }>
): void {
  const remove = issuedJournalDeletions.get(handle);
  if (remove === undefined) throw new Error('Journal exact-deletion handle was not issued by its owner.');
  remove(expected);
}

export type JournalRetirementInterruptionPoint =
  'after-retirement-fence' | 'after-payload-removal' | 'after-record-removal' | 'after-anchor-removal';
export interface JournalRetirementInterruptionActor { readonly kind: 'journal-retirement-interruption'; }
const retirementInterruptions = new WeakMap<object, Readonly<{
  point: JournalRetirementInterruptionPoint; interrupt: () => never;
}>>();
/** Fault injection only. It supplies no identity, terminal fact or permission. */
export function createJournalRetirementInterruptionActorForTests(
  point: JournalRetirementInterruptionPoint, interrupt: () => never
): JournalRetirementInterruptionActor {
  if (!['after-retirement-fence', 'after-payload-removal', 'after-record-removal', 'after-anchor-removal'].includes(point)
      || typeof interrupt !== 'function') throw new Error('Journal retirement interruption actor is invalid.');
  const actor = Object.freeze({ kind: 'journal-retirement-interruption' as const });
  retirementInterruptions.set(actor, Object.freeze({ point, interrupt }));
  return actor;
}
const issuedJournalRetirements = new WeakMap<object, (expected: Uint8Array, actor?: JournalRetirementInterruptionActor) => void>();

/** Physical completion of an original owner's prepared terminal retirement.
 * The issued handle binds exact parent, payload, record and anchor identities;
 * the caller must retain its original namespace admission across this effect. */
export function completePhysicalJournalMutationRetirement(
  handle: PhysicalMutationLeaseHandle,
  expectedPayloadBytes: Uint8Array,
  actor?: JournalRetirementInterruptionActor
): void {
  const retire = issuedJournalRetirements.get(handle);
  if (retire === undefined) throw new Error('Journal retirement handle was not issued by its owner.');
  retire(expectedPayloadBytes, actor);
}

const issuedJournalInitializations = new WeakMap<object, (bytes: Uint8Array) => DurableCanonicalFilePublicationReceipt>();

/** Publish the first payload through its original retained initializer. */
export function publishPhysicalJournalMutationInitialization(
  handle: PhysicalMutationLeaseHandle,
  bytes: Uint8Array
): DurableCanonicalFilePublicationReceipt {
  const publish = issuedJournalInitializations.get(handle);
  if (publish === undefined) throw new Error('Journal initialization handle was not issued by its owner.');
  return publish(bytes);
}


export function assertPhysicalMutationLeaseOwned(handle: PhysicalMutationLeaseHandle): void {
  const assertion = issuedLeaseAssertions.get(handle);
  if (assertion === undefined) throw new Error('Physical mutation lease handle was not issued by its owner.');
  assertion();
}
const DEFAULT_TTL_MS = 30_000;
const OWNER_KEYS = Object.freeze([
  'createdAtMs', 'expiresAtMs', 'host', 'pid', 'processNonce', 'schema', 'token'
]);

function parseOwner(bytes: Uint8Array): PhysicalMutationLeaseOwner | null {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length !== OWNER_KEYS.length || keys.some((key, index) => key !== OWNER_KEYS[index])) return null;
  const owner = value as Partial<PhysicalMutationLeaseOwner>;
  if (
    owner.schema !== PHYSICAL_MUTATION_LEASE_SCHEMA ||
    typeof owner.host !== 'string' || owner.host.length === 0 ||
    !Number.isSafeInteger(owner.pid) || (owner.pid ?? 0) <= 0 ||
    typeof owner.processNonce !== 'string' || !/^[0-9a-f-]{36}$/u.test(owner.processNonce) ||
    typeof owner.token !== 'string' || !/^[0-9a-f-]{36}$/u.test(owner.token) ||
    !Number.isSafeInteger(owner.createdAtMs) || (owner.createdAtMs ?? -1) < 0 ||
    !Number.isSafeInteger(owner.expiresAtMs) || (owner.expiresAtMs ?? -1) < (owner.createdAtMs ?? 0)
  ) return null;
  return Object.freeze({
    schema: PHYSICAL_MUTATION_LEASE_SCHEMA,
    host: owner.host,
    pid: owner.pid!,
    processNonce: owner.processNonce,
    token: owner.token,
    createdAtMs: owner.createdAtMs!,
    expiresAtMs: owner.expiresAtMs!
  });
}

interface LeaseRecord {
  readonly schema: typeof LEASE_RECORD_SCHEMA;
  readonly activeOwner: PhysicalMutationLeaseOwner;
  readonly recoveryOwner: PhysicalMutationLeaseOwner | null;
}

function parseRecord(bytes: Uint8Array): LeaseRecord | null {
  // The previous record was exactly one v1 owner. Its identity remains the
  // recovery root during the one-way durable-record migration.
  const legacy = parseOwner(bytes);
  if (legacy !== null) {
    if (!Buffer.from(bytes).equals(Buffer.from(`${JSON.stringify(legacy)}\n`, 'utf8'))) return null;
    return { schema: LEASE_RECORD_SCHEMA, activeOwner: legacy, recoveryOwner: null };
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { return null; }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'activeOwner,recoveryOwner,schema' || record.schema !== LEASE_RECORD_SCHEMA) return null;
  if (record.activeOwner === null || typeof record.activeOwner !== 'object' ||
      (record.recoveryOwner !== null && typeof record.recoveryOwner !== 'object')) return null;
  const activeOwner = parseOwner(Buffer.from(JSON.stringify(record.activeOwner)));
  const recoveryOwner = record.recoveryOwner === null ? null : parseOwner(Buffer.from(JSON.stringify(record.recoveryOwner)));
  if (activeOwner === null || (record.recoveryOwner !== null && recoveryOwner === null)) return null;
  if (recoveryOwner !== null && sameOwner(activeOwner, recoveryOwner)) return null;
  if (!Buffer.from(bytes).equals(recordBytes(activeOwner, recoveryOwner))) return null;
  return { schema: LEASE_RECORD_SCHEMA, activeOwner, recoveryOwner };
}

function recordBytes(owner: PhysicalMutationLeaseOwner, recoveryOwner: PhysicalMutationLeaseOwner | null): Buffer {
  return Buffer.from(`${JSON.stringify({ schema: LEASE_RECORD_SCHEMA, activeOwner: owner, recoveryOwner })}\n`, 'utf8');
}

function sameOwner(left: PhysicalMutationLeaseOwner, right: PhysicalMutationLeaseOwner): boolean {
  return left.schema === right.schema
    && left.host === right.host
    && left.pid === right.pid
    && left.processNonce === right.processNonce
    && left.token === right.token
    && left.createdAtMs === right.createdAtMs
    && left.expiresAtMs === right.expiresAtMs;
}

/**
 * Normal no-replace ownership remains available for external resources. A prior
 * unguarded owner is UNKNOWN: neither a PID probe nor lease expiry authorizes
 * takeover or cleanup of effects that can outlive the coordinator.
 */
export function acquirePhysicalMutationLease(
  parent: PhysicalDirectoryIdentity,
  name: string,
  options: PhysicalMutationLeaseOptions = {}
): PhysicalMutationLeaseHandle | null {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new Error('Physical mutation lease TTL must be a positive safe integer.');
  }
  const createdAtMs = now();
  if (!Number.isSafeInteger(createdAtMs) || createdAtMs < 0 || !Number.isSafeInteger(createdAtMs + ttlMs)) {
    throw new Error('Physical mutation lease creation and expiry must be non-negative safe integers.');
  }
  const owner: PhysicalMutationLeaseOwner = Object.freeze({
    schema: PHYSICAL_MUTATION_LEASE_SCHEMA,
    host: options.ownerHost ?? hostname(),
    pid: options.ownerPid ?? process.pid,
    processNonce: options.processNonce ?? PROCESS_NONCE,
    token: randomUUID(),
    createdAtMs,
    expiresAtMs: createdAtMs + ttlMs
  });
  if (parseOwner(Buffer.from(JSON.stringify(owner))) === null) {
    throw new Error('Physical mutation lease owner is invalid.');
  }
  if (options.journalResource !== undefined && options.coordinationResource !== undefined) {
    throw new Error('Physical mutation resource domains are mutually exclusive.');
  }
  if (options.coordinationResource !== undefined) {
    const admission = issuedCoordinationResources.get(options.coordinationResource);
    if (admission === undefined) throw new Error('Coordination resource was not issued by its physical owner.');
    assertCoordinationBinding(parent, name, admission.binding.material.resourceName, admission.binding);
    return acquireGuardedMutationLease(parent, name, owner, admission);
  }
  if (options.journalResource !== undefined) {
    return acquireGuardedJournalMutationLease(parent, name, owner, options.journalResource);
  }
  const bytes = recordBytes(owner, null);

  // A missing final name may be the interrupted middle of physical CAS.
  // Its owner must settle that transaction before fresh exclusive admission.
  if (observeDurableCanonicalFileReplacement({ parent, name }) === 'pending') return null;

  let acquired = false;
  let acquiredReceipt: DurableCanonicalFileIdentityReceipt | null = null;
  const reclaimedOwner: PhysicalMutationLeaseOwner | null = null;
  const reclaimedOwnerBytes: Buffer | null = null;
  for (let attempt = 0; attempt < 4 && !acquired; attempt += 1) {
    try {
      acquiredReceipt = publishExclusiveDurableCanonicalFile({ parent, name, bytes, validate: () => undefined });
      acquired = true;
    } catch (error) {
      if (!(error instanceof PhysicalNoFollowError) ||
          error.code !== 'PHYSICAL_NO_FOLLOW_EXCLUSIVE_CONFLICT') {
        throw error;
      }
      const observed = inspectNoFollowOrdinaryFileEntry(parent, name);
      // The no-replace winner may release its short-lived lease before this
      // contender can retain the conflicting name. Re-enter exclusive
      // admission; no durability or identity failure is retried here.
      if (observed === null) continue;
      if (observed.bytes === null) return null;
      // This slot has no retained native exclusion and no owner-issued effect
      // terminal proof. Preserve the exact predecessor instead of pretending
      // that coordinator PID absence closes descendants or provider work.
      return null;
    }
  }
  if (!acquired || acquiredReceipt === null) return null;
  return createMutationLeaseHandle({ parent, name, owner, receipt: acquiredReceipt,
    bytes, reclaimedOwner, reclaimedOwnerBytes });
}

function createMutationLeaseHandle(input: Readonly<{
  parent: PhysicalDirectoryIdentity;
  name: string;
  owner: PhysicalMutationLeaseOwner;
  receipt: DurableCanonicalFileIdentityReceipt;
  bytes: Buffer;
  reclaimedOwner: PhysicalMutationLeaseOwner | null;
  reclaimedOwnerBytes: Buffer | null;
  guard?: RetainedExclusiveFileGuard;
  binding?: PhysicalMutationBinding;
  initializing?: boolean;
}>): PhysicalMutationLeaseHandle {
  const { parent, name, owner, reclaimedOwner, reclaimedOwnerBytes, guard } = input;
  let binding = input.binding;
  let bytes = input.bytes;
  let initializing = input.initializing ?? false;
  let firstPublication: 'never-entered' | 'entered' | 'ready' = initializing ? 'never-entered' : 'ready';
  const serialize = (active: PhysicalMutationLeaseOwner | null, recovery: PhysicalMutationLeaseOwner | null): Buffer =>
    binding === undefined ? recordBytes(active!, recovery) : guardedRecordBytes(binding, initializing ? 'initializing' : 'ready', active, recovery);
  let heldReceipt: DurableCanonicalFileIdentityReceipt = input.receipt;
  assertDurableCanonicalFileIdentityReceipt(heldReceipt);

  const requireCurrent = (operation: string) => {
    guard?.assertCurrent();
    if (binding?.material.effectDomain === 'namespace-coordination') assertCoordinationNamespace(parent, binding as PhysicalCoordinationBinding);
    assertDurableCanonicalFileIdentityReceipt(heldReceipt);
    const current = inspectNoFollowOrdinaryFileEntry(parent, name);
    if (current === null || current.bytes === null ||
        current.device !== heldReceipt.physical.device || current.inode !== heldReceipt.physical.inode ||
        !Buffer.from(current.bytes).equals(bytes)) {
      throw new Error(`Physical mutation lease ownership changed before ${operation}.`);
    }
    return current;
  };

  let released = false;
  let reclaimedOwnerRestored = false;
  let recoveryAcknowledged = reclaimedOwner === null;
  let guardSettlementFailure: unknown;
  const settleGuard = (): void => {
    try { guard?.dispose(); } catch (error) {
      guardSettlementFailure = error;
      throw error;
    }
  };
  // Only synchronous record operations execute here. Once such an operation
  // fails, its native guard has no remaining in-process use. Preserve durable
  // recovery bytes, but make the failed handle unusable and close every native
  // descriptor. Retaining a lock is not a recovery receipt.
  const recordOperation = (operation: () => void): void => {
    try {
      operation();
    } catch (primary) {
      if (guard === undefined) throw primary;
      released = true;
      try { settleGuard(); } catch (settlement) {
        throw new AggregateError([primary, settlement],
          'Physical mutation record operation and guard settlement both failed.', { cause: primary });
      }
      throw primary;
    }
  };
  const handle = Object.freeze({
    owner,
    get reclaimedOwner(): PhysicalMutationLeaseOwner | null {
      return recoveryAcknowledged || released ? null : reclaimedOwner;
    },
    get recoveryPending(): boolean { return !recoveryAcknowledged && !released; },
    acknowledgeReclaimedRecovery(): void {
      if (released) throw new Error('Physical mutation lease was released before recovery acknowledgement.');
      if (recoveryAcknowledged) return;
      recordOperation(() => {
        requireCurrent('recovery acknowledgement');
        const acknowledgedBytes = serialize(owner, null);
        heldReceipt = replaceDurableCanonicalFile({
          parent, name, bytes: acknowledgedBytes,
          expectedExisting: heldReceipt.physical,
          expectedExistingBytes: bytes,
          validate: candidate => {
            if (!Buffer.from(candidate).equals(acknowledgedBytes)) throw new Error('Physical mutation lease acknowledgement bytes differ.');
          }
        });
        guard?.assertCurrent();
        bytes = acknowledgedBytes;
        recoveryAcknowledged = true;
      });
    },
    restoreReclaimedOwner(): void {
      if (reclaimedOwner === null || reclaimedOwnerBytes === null) {
        throw new Error('Physical mutation lease has no reclaimed owner to restore.');
      }
      if (reclaimedOwnerRestored) {
        if (guardSettlementFailure !== undefined) throw guardSettlementFailure;
        return;
      }
      if (recoveryAcknowledged) throw new Error('Physical mutation lease recovery was already acknowledged.');
      if (released) {
        throw new Error('Physical mutation lease was already released before reclaimed-owner restoration.');
      }
      recordOperation(() => {
        requireCurrent('reclaimed-owner restoration');
        if (binding?.material.effectDomain === 'namespace-coordination') {
          const predecessor = parseGuardedRecord(reclaimedOwnerBytes);
          if (predecessor?.binding.material.effectDomain === 'namespace-coordination' &&
              (predecessor.binding as PhysicalCoordinationBinding).namespacePhysical === null &&
              (binding as PhysicalCoordinationBinding).namespacePhysical !== null) {
            // Namespace birth is already durable. Restoring the old bytes would
            // erase its physical pin; keep the ready record and original recovery
            // lineage for the next guarded coordinator instead of acknowledging it.
            throw new Error('Coordination namespace birth is durable; ready physical pin and reclaimed lineage are preserved instead of restoring initializing bytes.');
          }
        }
        heldReceipt = replaceDurableCanonicalFile({
          parent,
          name,
          bytes: reclaimedOwnerBytes,
          expectedExisting: heldReceipt.physical,
          expectedExistingBytes: bytes,
          validate: (candidate) => {
            const parsed = binding === undefined ? parseRecord(candidate) : parseGuardedRecord(candidate);
            if (parsed === null || parsed.activeOwner === null || !sameOwner(parsed.recoveryOwner ?? parsed.activeOwner, reclaimedOwner!)) {
              throw new Error('Reclaimed physical mutation lease owner bytes are invalid.');
            }
          }
        });
        guard?.assertCurrent();
        reclaimedOwnerRestored = true;
      });
      released = true;
      settleGuard();
    },
    release(): void {
      if (released || reclaimedOwnerRestored) {
        if (guardSettlementFailure !== undefined) throw guardSettlementFailure;
        return;
      }
      if (!recoveryAcknowledged) {
        throw new Error('Physical mutation lease recovery must be acknowledged or restored before release.');
      }
      if (initializing) {
        if (binding?.material.effectDomain === 'direct-canonical-journal-records'
            && firstPublication === 'never-entered' && reclaimedOwner === null) {
          recordOperation(() => {
            const current = requireCurrent('unpublished initialization cancellation');
            assertJournalBinding(parent, name, binding!.material.resourceName, binding!);
            if (inspectNoFollowOrdinaryFileEntry(parent, binding!.material.resourceName) !== null
                || observeDurableCanonicalFileReplacement({ parent, name: binding!.material.resourceName }) !== 'none'
                || observeDurableCanonicalFileReplacement({ parent, name }) !== 'none') {
              throw new Error('Journal initialization cancellation has unresolved publication evidence; state is preserved.');
            }
            // The original held scope retires its own exact identities. This is
            // cooperative exclusion, not atomic byte-CAS against foreign writers.
            deleteRetainedNoFollowEntry({ root: parent, relativePath: name, kind: 'file',
              device: current.device, inode: current.inode, ancestorDirectories: [] });
            flushNoFollowDirectory(parent);
            if (inspectNoFollowOrdinaryFileEntry(parent, name) !== null) {
              throw new Error('Journal initialization control cancellation readback differs.');
            }
            guard!.assertCurrent();
            deleteRetainedNoFollowEntry({ root: parent, relativePath: binding!.anchorName, kind: 'file',
              device: binding!.anchorPhysical.device, inode: binding!.anchorPhysical.inode, ancestorDirectories: [] });
            flushNoFollowDirectory(parent);
            if (inspectNoFollowOrdinaryFileEntry(parent, binding!.anchorName) !== null
                || inspectNoFollowOrdinaryFileEntry(parent, binding!.material.resourceName) !== null) {
              throw new Error('Journal initialization cancellation final readback differs.');
            }
          });
          released = true;
          settleGuard();
          return;
        }
        // The original first creator did not prove winning the payload slot.
        // Keep the initialization record, but release the native observation handle.
        released = true;
        settleGuard();
        throw new Error('Journal first-data publication is unresolved; initialization residue is preserved.');
      }
      recordOperation(() => {
        const current = requireCurrent('release');
        if (binding !== undefined) {
          const terminalBytes = serialize(null, null);
          heldReceipt = replaceDurableCanonicalFile({ parent, name, bytes: terminalBytes,
            expectedExisting: heldReceipt.physical,
            expectedExistingBytes: bytes,
            validate: candidate => {
              if (!Buffer.from(candidate).equals(terminalBytes)) throw new Error('Guarded mutation terminal readback differs.');
            }
          });
          guard!.assertCurrent();
          bytes = terminalBytes;
        } else {
          deleteRetainedNoFollowEntry({ root: parent, relativePath: current.relativePath,
            kind: 'file', device: current.device, inode: current.inode, ancestorDirectories: [] });
        }
      });
      released = true;
      settleGuard();
    }
  });
  if (binding?.material.effectDomain === 'namespace-coordination') issuedCoordinationNamespaces.set(handle, () => {
    if (released) throw new Error('Coordination namespace handle is no longer held.');
    if (!initializing) {
      requireCurrent('namespace readback');
      return assertCoordinationNamespace(parent, binding as PhysicalCoordinationBinding)!;
    }
    let namespace: PhysicalDirectoryIdentity | undefined;
    recordOperation(() => {
      requireCurrent('namespace birth admission');
      namespace = createExclusiveNoFollowDirectory(parent, binding!.material.resourceName);
      flushNoFollowDirectory(namespace);
      flushNoFollowDirectory(parent);
      guard!.assertCurrent();
      const nextBinding: PhysicalCoordinationBinding = Object.freeze({ ...binding as PhysicalCoordinationBinding,
        namespacePhysical: Object.freeze({ device: namespace.device, inode: namespace.inode, objectId: namespace.objectId }) });
      assertCoordinationNamespace(parent, nextBinding);
      const next = guardedRecordBytes(nextBinding, 'ready', owner, recoveryAcknowledged ? null : reclaimedOwner);
      heldReceipt = replaceDurableCanonicalFile({ parent, name, bytes: next,
        expectedExisting: heldReceipt.physical, expectedExistingBytes: bytes,
        validate: candidate => { if (!Buffer.from(candidate).equals(next)) throw new Error('Coordination namespace pin readback differs.'); } });
      binding = nextBinding; bytes = next; initializing = false;
      requireCurrent('namespace pin readback');
    });
    return namespace!;
  });
  if (binding?.material.effectDomain === 'direct-canonical-journal-records') issuedJournalDeletions.set(handle, expected => {
    if (released || initializing) throw new Error('Journal exact deletion requires a held ready resource.');
    requireCurrent('exact resource deletion');
    deleteRetainedNoFollowEntry({ root: parent, relativePath: binding.material.resourceName, kind: 'file',
      device: expected.device, inode: expected.inode, expectedFileBytes: expected.bytes,
      resourceGuard: guard!, ancestorDirectories: [] });
    requireCurrent('exact resource deletion readback');
  });
  if (binding?.material.effectDomain === 'direct-canonical-journal-records') issuedJournalRetirements.set(handle, (expectedPayloadBytes, actor) => {
    if (released || initializing || !recoveryAcknowledged) {
      throw new Error('Journal terminal retirement requires a held settled direct-record scope.');
    }
    const interruption = actor === undefined ? undefined : retirementInterruptions.get(actor);
    if (actor !== undefined && interruption === undefined) throw new Error('Journal retirement interruption actor was not issued.');
    const interrupt = (point: JournalRetirementInterruptionPoint): void => {
      if (interruption?.point === point) { interruption.interrupt(); throw new Error('Journal retirement interruption returned.'); }
    };
    const expected = Buffer.from(expectedPayloadBytes);
    recordOperation(() => {
      requireCurrent('terminal retirement');
      const payload = inspectNoFollowOrdinaryFileEntry(parent, binding.material.resourceName);
      if (payload?.bytes === null || payload?.bytes === undefined || !Buffer.from(payload.bytes).equals(expected)) {
        throw new Error('Journal terminal retirement payload preimage changed.');
      }
      // This stop-new-admission state precedes every destructive step. Partial
      // record/anchor removal is UNKNOWN, never permission to initialize anew.
      const retiring = guardedRecordBytes(binding, 'retiring', owner, null);
      heldReceipt = replaceDurableCanonicalFile({ parent, name, bytes: retiring,
        expectedExisting: heldReceipt.physical, expectedExistingBytes: bytes,
        validate: candidate => { if (!Buffer.from(candidate).equals(retiring)) throw new Error('Journal retirement fence differs.'); }
      });
      bytes = retiring;
      guard!.assertCurrent();
      interrupt('after-retirement-fence');
      deletePhysicalJournalMutationFile(handle, { device: payload.device, inode: payload.inode, bytes: expected });
      interrupt('after-payload-removal');
      const record = requireCurrent('terminal record retirement');
      deleteRetainedNoFollowEntry({ root: parent, relativePath: name, kind: 'file',
        device: record.device, inode: record.inode, ancestorDirectories: [] });
      interrupt('after-record-removal');
      guard!.assertCurrent();
      deleteRetainedNoFollowEntry({ root: parent, relativePath: binding.anchorName, kind: 'file',
        device: binding.anchorPhysical.device, inode: binding.anchorPhysical.inode, ancestorDirectories: [] });
      interrupt('after-anchor-removal');
    });
    released = true;
    settleGuard();
  });
  if (binding?.material.effectDomain === 'direct-canonical-journal-records') issuedJournalInitializations.set(handle, suppliedBytes => {
    if (released) throw new Error('Journal first-data publication handle is no longer held.');
    if (initializing && firstPublication !== 'never-entered') {
      throw new Error('Journal first-data publisher is not the original unentered initializer.');
    }
    const payloadBytes = Buffer.from(suppliedBytes);
    requireCurrent('first-data publication acknowledgement');
    if (initializing) firstPublication = 'entered';
    const receipt = publishExclusiveDurableCanonicalFile({ parent, name: binding.material.resourceName,
      bytes: payloadBytes, validate: candidate => {
        if (!Buffer.from(candidate).equals(payloadBytes)) throw new Error('Journal first-data publication bytes differ.');
      }
    });
    // A ready direct-record owner may recreate its deleted payload under the
    // same guarded namespace. It has no pending initialization to acknowledge.
    if (!initializing) return receipt;
    assertDurableCanonicalFileIdentityReceipt(receipt);
    const resourceName = binding.material.resourceName;
    const current = inspectNoFollowOrdinaryFileEntry(parent, resourceName);
    if (!receipt.created || receipt.path !== path.join(parent.path, resourceName)
      || current?.bytes === null || current?.bytes === undefined
      || current.device !== receipt.physical.device || current.inode !== receipt.physical.inode
      || receipt.digest !== `sha256:${createHash('sha256').update(current.bytes).digest('hex')}`) {
      throw new Error('Journal first-data publication did not win the exact admitted payload slot.');
    }
    const ready = guardedRecordBytes(binding, 'ready', owner, null);
    heldReceipt = replaceDurableCanonicalFile({ parent, name, bytes: ready,
      expectedExisting: heldReceipt.physical, expectedExistingBytes: bytes,
      validate: candidate => {
        if (!Buffer.from(candidate).equals(ready)) throw new Error('Journal initialization completion readback differs.');
      }
    });
    guard!.assertCurrent();
    bytes = ready;
    initializing = false;
    firstPublication = 'ready';
    return receipt;
  });
  issuedLeaseAssertions.set(handle, () => {
    if (released) throw new Error('Physical mutation lease is no longer held.');
    requireCurrent('owned assertion');
  });
  return handle;
}


const GUARDED_RECORD_SCHEMA = 'sec-physical-journal-mutation-record-v4' as const;
const JOURNAL_ANCHOR_SCHEMA = 'sec-physical-journal-mutation-anchor-v2' as const;
const COORDINATION_ANCHOR_SCHEMA = 'sec-physical-namespace-coordination-anchor-v1' as const;
const COORDINATION_RECORD_SCHEMA = 'sec-physical-namespace-coordination-record-v1' as const;
const MAXIMUM_GUARDED_RECORD_BYTES = 16384;

export interface PhysicalJournalMutationResource {
  readonly kind: 'physical-journal-mutation-resource';
}
export interface PhysicalMutationCoordinationResource {
  readonly kind: 'physical-mutation-coordination-resource';
}

interface JournalAnchorMaterial {
  readonly resourceGeneration: string;
  readonly schema: typeof JOURNAL_ANCHOR_SCHEMA;
  readonly parent: Readonly<{ device: string; inode: string; objectId: string }>;
  readonly leaseName: string;
  readonly resourceName: string;
  readonly effectDomain: 'direct-canonical-journal-records';
}

interface PhysicalJournalMutationBinding {
  readonly material: JournalAnchorMaterial;
  readonly anchorName: string;
  readonly anchorPhysical: Readonly<{ device: string; inode: string }>;
  readonly anchorDigest: string;
}
interface CoordinationAnchorMaterial extends Omit<JournalAnchorMaterial, 'schema' | 'effectDomain'> {
  readonly schema: typeof COORDINATION_ANCHOR_SCHEMA;
  readonly effectDomain: 'namespace-coordination';
}
interface PhysicalCoordinationBinding extends Omit<PhysicalJournalMutationBinding, 'material'> {
  readonly material: CoordinationAnchorMaterial;
  readonly namespacePhysical: Readonly<{ device: string; inode: string; objectId: string }> | null;
}
type PhysicalMutationBinding = PhysicalJournalMutationBinding | PhysicalCoordinationBinding;

interface GuardedMutationRecord {
  readonly schema: typeof GUARDED_RECORD_SCHEMA | typeof COORDINATION_RECORD_SCHEMA;
  readonly binding: PhysicalMutationBinding;
  readonly phase: 'initializing' | 'ready' | 'retiring';
  readonly activeOwner: PhysicalMutationLeaseOwner | null;
  readonly recoveryOwner: PhysicalMutationLeaseOwner | null;
}

const issuedJournalResources = new WeakMap<object, Readonly<{ binding: PhysicalJournalMutationBinding; initialRecord?: Readonly<{ device: string; inode: string }> }>>();
const issuedCoordinationResources = new WeakMap<object, Readonly<{ binding: PhysicalCoordinationBinding }>>();

/** Read-only census projection. A recognized idle pair is retained protocol,
 * not an active mutation and not permission to retire either member. */
export function observePhysicalJournalMutationEntry(
  parent: PhysicalDirectoryIdentity,
  entryName: string
): Readonly<{ leaseName: string; anchorName: string; resourceName: string; state: 'idle' | 'active' | 'initializing' | 'retiring' }> | null {
  let leaseName = entryName;
  if (/^\.sec-journal-guard-[0-9a-f]{64}\.lock$/u.test(entryName)) {
    const anchor = inspectNoFollowOrdinaryFileEntry(parent, entryName, { maximumBytes: 8192 });
    if (anchor?.bytes === null || anchor?.bytes === undefined) return null;
    let material: unknown;
    try { material = JSON.parse(Buffer.from(anchor.bytes).toString('utf8')); } catch { return null; }
    if (material === null || typeof material !== 'object' || !('leaseName' in material)
      || !leaf(material.leaseName) || !('resourceName' in material)
      || !leaf(material.resourceName) || anchorNameFor(material.resourceName) !== entryName) return null;
    leaseName = material.leaseName;
  }
  const current = inspectNoFollowOrdinaryFileEntry(parent, leaseName, { maximumBytes: MAXIMUM_GUARDED_RECORD_BYTES });
  const record = current?.bytes === null || current?.bytes === undefined ? null : parseGuardedRecord(current.bytes);
  if (record === null) return null;
  assertJournalBinding(parent, leaseName, record.binding.material.resourceName, record.binding);
  const anchor = inspectNoFollowOrdinaryFileEntry(parent, record.binding.anchorName, { maximumBytes: 8192 });
  if (anchor?.bytes === null || anchor?.bytes === undefined
    || anchor.device !== record.binding.anchorPhysical.device || anchor.inode !== record.binding.anchorPhysical.inode
    || !Buffer.from(anchor.bytes).equals(anchorBytes(record.binding.material))) {
    throw new Error('Guarded journal census found a missing or changed anchor; protocol is preserved.');
  }
  return Object.freeze({ leaseName, anchorName: record.binding.anchorName, resourceName: record.binding.material.resourceName,
    state: record.phase === 'retiring' ? 'retiring' as const : record.phase === 'initializing' ? 'initializing' as const : record.activeOwner === null ? 'idle' as const : 'active' as const });
}

function leaf(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 255
    && value !== '.' && value !== '..' && !/[\\/\0]/u.test(value);
}

function anchorNameFor(resourceName: string, domain: 'direct-canonical-journal-records' | 'namespace-coordination' = 'direct-canonical-journal-records'): string {
  // Parent object + canonical protected leaf select one rendezvous even when
  // journal-root views assign different diagnostic lease-record names.
  return `.sec-${domain === 'namespace-coordination' ? 'namespace-coordination' : 'journal'}-guard-${createHash('sha256').update(resourceName).digest('hex')}.lock`;
}

function assertJournalResourceNames(name: string, resourceName: string): void {
  if (!leaf(name) || !leaf(resourceName) || name === resourceName) {
    throw new Error('Guarded journal resource must bind two distinct canonical leaf names.');
  }
  if (process.platform === 'win32' && [name, resourceName].some(value =>
    !/^[a-z0-9._-]+$/u.test(value) || value.endsWith('.')
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/u.test(value))) {
    throw new PhysicalNoFollowError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      'Guarded journal canonical leaf spelling is unsupported on Windows; aliases remain unqualified.');
  }
}

function journalAnchorMaterial(
  parent: PhysicalDirectoryIdentity,
  name: string,
  resourceName: string,
  resourceGeneration: string
): JournalAnchorMaterial {
  if (!/^[0-9a-f-]{36}$/u.test(resourceGeneration)) throw new Error('Journal resource generation is invalid.');
  assertJournalResourceNames(name, resourceName);
  return Object.freeze({
    resourceGeneration,
    schema: JOURNAL_ANCHOR_SCHEMA,
    parent: Object.freeze({ device: parent.device, inode: parent.inode, objectId: parent.objectId }),
    leaseName: name,
    resourceName,
    effectDomain: 'direct-canonical-journal-records'
  });
}

function anchorBytes(material: JournalAnchorMaterial | CoordinationAnchorMaterial): Buffer {
  return Buffer.from(`${JSON.stringify(material)}\n`, 'utf8');
}

function guardedRecordBytes(
  binding: PhysicalMutationBinding,
  phase: 'initializing' | 'ready' | 'retiring',
  activeOwner: PhysicalMutationLeaseOwner | null,
  recoveryOwner: PhysicalMutationLeaseOwner | null
): Buffer {
  const schema = binding.material.effectDomain === 'namespace-coordination' ? COORDINATION_RECORD_SCHEMA : GUARDED_RECORD_SCHEMA;
  return Buffer.from(`${JSON.stringify({ schema, binding, phase, activeOwner, recoveryOwner })}\n`, 'utf8');
}

function parseGuardedRecord(bytes: Uint8Array): GuardedMutationRecord | null {
  if (bytes.byteLength > MAXIMUM_GUARDED_RECORD_BYTES) return null;
  let value: unknown;
  try { value = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { return null; }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, any>;
  const binding = record.binding;
  const material = binding?.material;
  const parent = material?.parent;
  const coordination = material?.effectDomain === 'namespace-coordination';
  if (record.schema !== (coordination ? COORDINATION_RECORD_SCHEMA : GUARDED_RECORD_SCHEMA)
    || (record.phase !== 'initializing' && record.phase !== 'ready' && record.phase !== 'retiring')
    || (coordination && record.phase === 'retiring')
    || typeof material?.resourceGeneration !== 'string' || !/^[0-9a-f-]{36}$/u.test(material.resourceGeneration)
    || material?.schema !== (coordination ? COORDINATION_ANCHOR_SCHEMA : JOURNAL_ANCHOR_SCHEMA)
    || (!coordination && material?.effectDomain !== 'direct-canonical-journal-records')
    || !leaf(material.leaseName) || !leaf(material.resourceName)
    || material.leaseName === material.resourceName
    || binding.anchorName !== anchorNameFor(material.resourceName, material.effectDomain)
    || typeof parent?.device !== 'string' || typeof parent.inode !== 'string' || typeof parent.objectId !== 'string'
    || typeof binding.anchorPhysical?.device !== 'string' || typeof binding.anchorPhysical.inode !== 'string'
    || typeof binding.anchorDigest !== 'string') return null;
  const canonicalMaterial: JournalAnchorMaterial | CoordinationAnchorMaterial = {
    resourceGeneration: material.resourceGeneration,
    schema: coordination ? COORDINATION_ANCHOR_SCHEMA : JOURNAL_ANCHOR_SCHEMA,
    parent: { device: parent.device, inode: parent.inode, objectId: parent.objectId },
    leaseName: material.leaseName,
    resourceName: material.resourceName,
    effectDomain: coordination ? 'namespace-coordination' : 'direct-canonical-journal-records'
  } as JournalAnchorMaterial | CoordinationAnchorMaterial;
  if (binding.anchorDigest !== createHash('sha256').update(anchorBytes(canonicalMaterial)).digest('hex')) return null;
  if (coordination && (binding.namespacePhysical !== null &&
      (typeof binding.namespacePhysical?.device !== 'string' || typeof binding.namespacePhysical.inode !== 'string' || typeof binding.namespacePhysical.objectId !== 'string') ||
      (record.phase === 'initializing') !== (binding.namespacePhysical === null))) return null;
  const canonicalBinding: PhysicalMutationBinding = {
    material: canonicalMaterial,
    anchorName: binding.anchorName,
    anchorPhysical: { device: binding.anchorPhysical.device, inode: binding.anchorPhysical.inode },
    anchorDigest: binding.anchorDigest,
    ...(coordination ? { namespacePhysical: binding.namespacePhysical === null ? null : {
      device: binding.namespacePhysical.device, inode: binding.namespacePhysical.inode, objectId: binding.namespacePhysical.objectId } } : {})
  } as PhysicalMutationBinding;
  if ((record.activeOwner !== null && (typeof record.activeOwner !== 'object' || Array.isArray(record.activeOwner)))
    || (record.recoveryOwner !== null && (typeof record.recoveryOwner !== 'object' || Array.isArray(record.recoveryOwner)))) return null;
  const activeOwner = record.activeOwner === null ? null : parseOwner(Buffer.from(JSON.stringify(record.activeOwner)));
  const recoveryOwner = record.recoveryOwner === null ? null : parseOwner(Buffer.from(JSON.stringify(record.recoveryOwner)));
  if ((record.activeOwner !== null && activeOwner === null)
    || (record.recoveryOwner !== null && recoveryOwner === null)
    || (activeOwner === null && recoveryOwner !== null)
    || (activeOwner !== null && recoveryOwner !== null && sameOwner(activeOwner, recoveryOwner))) return null;
  const result = { schema: coordination ? COORDINATION_RECORD_SCHEMA : GUARDED_RECORD_SCHEMA, binding: canonicalBinding, phase: record.phase, activeOwner, recoveryOwner };
  return Buffer.from(bytes).equals(guardedRecordBytes(canonicalBinding, record.phase, activeOwner, recoveryOwner)) ? result : null;
}

function assertJournalBinding(
  parent: PhysicalDirectoryIdentity,
  name: string,
  resourceName: string,
  binding: PhysicalMutationBinding
): asserts binding is PhysicalJournalMutationBinding {
  if (JSON.stringify(binding.material) !== JSON.stringify(journalAnchorMaterial(parent, name, resourceName, binding.material.resourceGeneration))) {
    throw new Error('Guarded journal resource binding differs from its physical parent or canonical resource.');
  }
}

export class PhysicalMutationCoordinationBlockedError extends Error {
  readonly code = 'PHYSICAL_MUTATION_COORDINATION_BLOCKED';
  constructor(readonly status: 'legacy-unproven' | 'unknown', message: string) { super(message); }
}
function assertCoordinationBinding(parent: PhysicalDirectoryIdentity, name: string, namespaceLeaf: string,
  binding: PhysicalMutationBinding): asserts binding is PhysicalCoordinationBinding {
  const expected = { ...journalAnchorMaterial(parent, name, namespaceLeaf, binding.material.resourceGeneration),
    schema: COORDINATION_ANCHOR_SCHEMA, effectDomain: 'namespace-coordination' };
  if (JSON.stringify(binding.material) !== JSON.stringify(expected)) throw new PhysicalMutationCoordinationBlockedError(
    'unknown', 'Coordination resource binding differs from its retained parent or namespace.');
}
function assertCoordinationNamespace(parent: PhysicalDirectoryIdentity, binding: PhysicalCoordinationBinding): PhysicalDirectoryIdentity | null {
  const presence = inspectExactNoFollowDirectoryPresence(path.join(parent.path, binding.material.resourceName), 'Coordination namespace');
  const expected = binding.namespacePhysical;
  if (expected === null) {
    if (presence.state !== 'absent') throw new PhysicalMutationCoordinationBlockedError('unknown',
      'Coordination namespace birth has no durable physical pin; present namespace is preserved.');
    return null;
  }
  if (presence.state !== 'present' || presence.directory.target.device !== expected.device ||
      presence.directory.target.inode !== expected.inode || presence.directory.target.objectId !== expected.objectId) {
    throw new PhysicalMutationCoordinationBlockedError('unknown', 'Coordination namespace physical identity changed.');
  }
  return presence.directory.target;
}
function issueCoordinationResource(binding: PhysicalCoordinationBinding): PhysicalMutationCoordinationResource {
  const resource = Object.freeze({ kind: 'physical-mutation-coordination-resource' as const });
  issuedCoordinationResources.set(resource, Object.freeze({ binding }));
  return resource;
}
export function readPhysicalMutationCoordinationResource(parent: PhysicalDirectoryIdentity, name: string,
  namespaceLeaf: string): PhysicalMutationCoordinationResource | null {
  assertJournalResourceNames(name, namespaceLeaf);
  const current = inspectNoFollowOrdinaryFileEntry(parent, name, { maximumBytes: MAXIMUM_GUARDED_RECORD_BYTES });
  const guardName = anchorNameFor(namespaceLeaf, 'namespace-coordination');
  if (current === null) {
    if (observeDurableCanonicalFileReplacement({ parent, name }) === 'pending' ||
        inspectNoFollowOrdinaryFileEntry(parent, guardName) !== null) throw new PhysicalMutationCoordinationBlockedError(
      'unknown', 'Coordination initialization or replacement is unresolved; state is preserved.');
    return null;
  }
  const record = current.bytes === null ? null : parseGuardedRecord(current.bytes);
  if (record === null || record.binding.material.effectDomain !== 'namespace-coordination') {
    throw new PhysicalMutationCoordinationBlockedError(current.bytes !== null && parseRecord(current.bytes) !== null ? 'legacy-unproven' : 'unknown',
      'Coordination lease is legacy or foreign; original bytes are preserved.');
  }
  const binding = record.binding;
  assertCoordinationBinding(parent, name, namespaceLeaf, binding);
  const anchor = inspectNoFollowOrdinaryFileEntry(parent, guardName, { maximumBytes: 8192 });
  if (anchor?.bytes === null || anchor?.bytes === undefined || anchor.device !== binding.anchorPhysical.device ||
      anchor.inode !== binding.anchorPhysical.inode || !Buffer.from(anchor.bytes).equals(anchorBytes(binding.material))) {
    throw new PhysicalMutationCoordinationBlockedError('unknown', 'Coordination anchor identity or bytes changed.');
  }
  return issueCoordinationResource(binding);
}
export function preparePhysicalMutationCoordinationResource(parent: PhysicalDirectoryIdentity, name: string,
  namespaceLeaf: string): PhysicalMutationCoordinationResource {
  const existing = readPhysicalMutationCoordinationResource(parent, name, namespaceLeaf);
  if (existing !== null) return existing;
  const material: CoordinationAnchorMaterial = Object.freeze({ ...journalAnchorMaterial(parent, name, namespaceLeaf, randomUUID()),
    schema: COORDINATION_ANCHOR_SCHEMA, effectDomain: 'namespace-coordination' });
  const guardName = anchorNameFor(namespaceLeaf, 'namespace-coordination');
  const bytes = anchorBytes(material);
  const anchor = publishExclusiveDurableCanonicalFile({ parent, name: guardName, bytes,
    validate: candidate => { if (!Buffer.from(candidate).equals(bytes)) throw new Error('Coordination anchor bytes differ.'); } });
  if (!anchor.created) throw new PhysicalMutationCoordinationBlockedError('unknown', 'Coordination anchor initialization is owned by another initializer.');
  const guard = tryRetainExclusiveFileGuard(parent, guardName, anchor.physical, bytes);
  if (guard === null) throw new PhysicalMutationCoordinationBlockedError('unknown', 'Coordination initialization is contended.');
  let failure: { error: unknown } | undefined;
  try {
    guard.assertCurrent();
    const presence = inspectExactNoFollowDirectoryPresence(path.join(parent.path, namespaceLeaf), 'Coordination initial namespace');
    const physical = presence.state === 'absent' ? null : presence.directory.target;
    if (physical !== null) { flushNoFollowDirectory(physical); flushNoFollowDirectory(parent); }
    const binding: PhysicalCoordinationBinding = Object.freeze({ material, anchorName: guardName,
      anchorPhysical: anchor.physical, anchorDigest: createHash('sha256').update(bytes).digest('hex'),
      namespacePhysical: physical === null ? null : Object.freeze({ device: physical.device, inode: physical.inode, objectId: physical.objectId }) });
    assertCoordinationNamespace(parent, binding);
    const initial = guardedRecordBytes(binding, physical === null ? 'initializing' : 'ready', null, null);
    const receipt = publishExclusiveDurableCanonicalFile({ parent, name, bytes: initial,
      validate: candidate => { if (!Buffer.from(candidate).equals(initial)) throw new Error('Coordination initial record bytes differ.'); } });
    if (!receipt.created) throw new PhysicalMutationCoordinationBlockedError('unknown', 'Coordination lease preimage appeared during initialization; state is preserved.');
    guard.assertCurrent();
    return issueCoordinationResource(binding);
  } catch (error) { failure = { error }; throw error; }
  finally { try { guard.dispose(); } catch (settlement) {
    if (failure !== undefined) throw new AggregateError([failure.error, settlement], 'Coordination initialization and guard settlement failed.');
    throw settlement;
  } }
}

function issueJournalResource(binding: PhysicalJournalMutationBinding, initialRecord?: Readonly<{ device: string; inode: string }>): PhysicalJournalMutationResource {
  const resource = Object.freeze({ kind: 'physical-journal-mutation-resource' as const });
  issuedJournalResources.set(resource, { binding, initialRecord });
  return resource;
}

/** Read existing admission only. A partial pair never becomes a fresh resource. */
export function readPhysicalJournalMutationResource(
  parent: PhysicalDirectoryIdentity,
  name: string,
  resourceName: string
): PhysicalJournalMutationResource | null {
  assertJournalResourceNames(name, resourceName);
  const existing = inspectNoFollowOrdinaryFileEntry(parent, name, { maximumBytes: MAXIMUM_GUARDED_RECORD_BYTES });
  if (existing === null) {
    if (observeDurableCanonicalFileReplacement({ parent, name }) === 'pending'
      || inspectNoFollowOrdinaryFileEntry(parent, anchorNameFor(resourceName)) !== null) {
      throw new Error('Guarded journal resource initialization or replacement is unresolved; retained state is preserved.');
    }
    return null;
  }
  const record = existing.bytes === null ? null : parseGuardedRecord(existing.bytes);
  if (record === null) throw new Error('Journal mutation resource is legacy or unqualified; original state is preserved.');
  assertJournalBinding(parent, name, resourceName, record.binding);
  if (record.phase === 'retiring') throw new Error('Journal terminal retirement is partial; original state is preserved.');
  if (record.phase !== 'ready') throw new Error('Journal first-data publication remains unresolved; original initialization is preserved.');
  return issueJournalResource(record.binding);
}

/**
 * Explicit first-create owner only. The protected data leaf must be absent.
 * Publication failure retains the partial pair for this initialization owner.
 */
export function initializePhysicalJournalMutationResource(
  parent: PhysicalDirectoryIdentity,
  name: string,
  resourceName: string
): PhysicalJournalMutationResource {
  const material = journalAnchorMaterial(parent, name, resourceName, randomUUID());
  const guardName = anchorNameFor(resourceName);
  if (inspectNoFollowOrdinaryFileEntry(parent, name) !== null
    || inspectNoFollowOrdinaryFileEntry(parent, guardName) !== null
    || inspectNoFollowOrdinaryFileEntry(parent, resourceName) !== null
    || observeDurableCanonicalFileReplacement({ parent, name }) === 'pending') {
    throw new Error('Journal first creation does not have an absent qualified preimage.');
  }
  const expectedAnchorBytes = anchorBytes(material);
  const anchor = publishExclusiveDurableCanonicalFile({
    parent, name: guardName, bytes: expectedAnchorBytes,
    validate: bytes => {
      if (!Buffer.from(bytes).equals(expectedAnchorBytes)) throw new Error('Journal anchor bytes differ.');
    }
  });
  if (!anchor.created) throw new Error('Journal anchor initialization is already owned; existing state is preserved.');
  const binding = Object.freeze({
    material, anchorName: guardName, anchorPhysical: anchor.physical,
    anchorDigest: createHash('sha256').update(expectedAnchorBytes).digest('hex')
  });
  const guard = tryRetainExclusiveFileGuard(parent, guardName, anchor.physical, expectedAnchorBytes);
  if (guard === null) throw new Error('Journal anchor initialization is contended.');
  let failure: unknown;
  try {
    guard.assertCurrent();
    if (inspectNoFollowOrdinaryFileEntry(parent, resourceName) !== null) {
      throw new Error('Journal protected data appeared during first resource creation.');
    }
    const initial = guardedRecordBytes(binding, 'initializing', null, null);
    const record = publishExclusiveDurableCanonicalFile({
      parent, name, bytes: initial,
      validate: bytes => {
        if (!Buffer.from(bytes).equals(initial)) throw new Error('Journal resource first record differs.');
      }
    });
    if (!record.created) throw new Error('Journal resource first record was published by another owner.');
    guard.assertCurrent();
    return issueJournalResource(binding, record.physical);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try { guard.dispose(); } catch (settlement) {
      if (failure !== undefined) throw new AggregateError([failure, settlement], 'Journal initialization and guard settlement failed.');
      throw settlement;
    }
  }
}

function acquireGuardedJournalMutationLease(
  parent: PhysicalDirectoryIdentity,
  name: string,
  owner: PhysicalMutationLeaseOwner,
  resource: PhysicalJournalMutationResource
): PhysicalMutationLeaseHandle | null {
  const admission = issuedJournalResources.get(resource);
  if (admission === undefined) throw new Error('Journal resource was not issued by its physical owner.');
  const { binding } = admission;
  assertJournalBinding(parent, name, binding.material.resourceName, binding);
  return acquireGuardedMutationLease(parent, name, owner, admission);
}

function acquireGuardedMutationLease(parent: PhysicalDirectoryIdentity, name: string, owner: PhysicalMutationLeaseOwner,
  admission: Readonly<{ binding: PhysicalMutationBinding; initialRecord?: Readonly<{ device: string; inode: string }> }>): PhysicalMutationLeaseHandle | null {
  const { binding } = admission;
  const journal = binding.material.effectDomain === 'direct-canonical-journal-records';
  const guard = tryRetainExclusiveFileGuard(parent, binding.anchorName, binding.anchorPhysical, anchorBytes(binding.material),
    journal ? binding.material.resourceName : undefined);
  if (guard === null) return null;
  try {
    guard.assertCurrent();
    // This can mutate a Windows interrupted replacement, and therefore MUST
    // follow native guard acquisition and post-lock identity readback.
    if (!journal) assertCoordinationNamespace(parent, binding as PhysicalCoordinationBinding);
    recoverDurableCanonicalFileReplacement({ parent, name });
    guard.assertCurrent();
    const current = inspectNoFollowOrdinaryFileEntry(parent, name, { maximumBytes: MAXIMUM_GUARDED_RECORD_BYTES });
    const record = current?.bytes === null || current?.bytes === undefined ? null : parseGuardedRecord(current.bytes);
    if (record === null || JSON.stringify(record.binding) !== JSON.stringify(binding)) {
      throw new Error('Guarded journal record changed before acquisition.');
    }
    if (record.phase === 'retiring') throw new Error('Journal terminal retirement is partial; original state is preserved.');
    const initializing = record.phase === 'initializing';
    if (initializing && journal && (admission.initialRecord === undefined || record.activeOwner !== null
      || current!.device !== admission.initialRecord.device || current!.inode !== admission.initialRecord.inode
      || inspectNoFollowOrdinaryFileEntry(parent, binding.material.resourceName) !== null)) {
      throw new Error('Journal first-data publication has no current original initializer; residue is preserved.');
    }
    if (!initializing && journal) {
      // The protected payload has the same direct-record effect domain. Its
      // interrupted CAS is settled while exclusion is held, before lineage ack.
      recoverDurableCanonicalFileReplacement({ parent, name: binding.material.resourceName });
      guard.assertCurrent();
    }
    if (!journal) assertCoordinationNamespace(parent, record.binding as PhysicalCoordinationBinding);
    const predecessor = record.recoveryOwner ?? record.activeOwner;
    const next = guardedRecordBytes(binding, record.phase, owner, predecessor);
    const receipt = replaceDurableCanonicalFile({
      parent, name, bytes: next,
      expectedExisting: { device: current!.device, inode: current!.inode },
      expectedExistingBytes: current!.bytes!,
      validate: bytes => {
        if (!Buffer.from(bytes).equals(next)) throw new Error('Guarded journal acquisition readback differs.');
      }
    });
    guard.assertCurrent();
    return createMutationLeaseHandle({ parent, name, owner, receipt, bytes: next, binding, guard, initializing,
      reclaimedOwner: predecessor, reclaimedOwnerBytes: predecessor === null ? null : Buffer.from(current!.bytes!) });
  } catch (error) {
    try { guard.dispose(); } catch (settlement) {
      throw new AggregateError([error, settlement], 'Journal acquisition and guard settlement failed.');
    }
    throw error;
  }
}
