import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import {
  PhysicalNoFollowError,
  assertDurableCanonicalFileIdentityReceipt,
  deleteRetainedNoFollowEntry,
  inspectNoFollowOrdinaryFileEntry,
  publishExclusiveDurableCanonicalFile,
  recoverDurableCanonicalFileReplacement,
  replaceDurableCanonicalFile,
  type DurableCanonicalFileIdentityReceipt,
  type PhysicalDirectoryIdentity
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
  /** Exact dead local owner whose durable generation was retired while acquiring this lease. */
  readonly reclaimedOwner: PhysicalMutationLeaseOwner | null;
  readonly recoveryPending: boolean;
  /** Clear durable predecessor lineage only after consumer recovery/readback. */
  acknowledgeReclaimedRecovery(): void;
  /**
   * Restores the exact dead owner bytes when successor admission cannot
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
  readonly processAlive?: (pid: number) => 'alive' | 'dead' | 'unknown';
  readonly processNonce?: string;
  readonly ttlMs?: number;
}

const PROCESS_NONCE = randomUUID();
const DEFAULT_TTL_MS = 30_000;
const OWNER_KEYS = Object.freeze([
  'createdAtMs', 'expiresAtMs', 'host', 'pid', 'processNonce', 'schema', 'token'
]);

function processLiveness(pid: number): 'alive' | 'dead' | 'unknown' {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH') return 'dead';
    return 'unknown';
  }
}

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

function sameEntry(
  left: ReturnType<typeof inspectNoFollowOrdinaryFileEntry>,
  right: ReturnType<typeof inspectNoFollowOrdinaryFileEntry>
): boolean {
  return left !== null && right !== null && left.bytes !== null && right.bytes !== null &&
    left.device === right.device && left.inode === right.inode &&
    Buffer.from(left.bytes).equals(Buffer.from(right.bytes));
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
 * Acquires one same-parent, crash-recoverable physical mutation lease. A
 * contender may retire an abandoned generation only after two identical
 * retained identity/byte observations and a local owner-death proof. Expiry is
 * diagnostic and prevents an unbounded owner claim, but never authorizes
 * stealing a live, remote, or liveness-unknown lease.
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
  let bytes = recordBytes(owner, null);
  const isProcessAlive = options.processAlive ?? processLiveness;

  // A missing final name may be the interrupted middle of physical CAS.
  // Its owner must settle that transaction before fresh exclusive admission.
  recoverDurableCanonicalFileReplacement({ parent, name });

  let acquired = false;
  let acquiredReceipt: DurableCanonicalFileIdentityReceipt | null = null;
  let reclaimedOwner: PhysicalMutationLeaseOwner | null = null;
  let reclaimedOwnerBytes: Buffer | null = null;
  for (let attempt = 0; attempt < 4 && !acquired; attempt += 1) {
    try {
      acquiredReceipt = publishExclusiveDurableCanonicalFile({ parent, name, bytes, validate: () => undefined });
      acquired = true;
    } catch (error) {
      const observed = inspectNoFollowOrdinaryFileEntry(parent, name);
      if (!(error instanceof PhysicalNoFollowError) || observed === null || observed.bytes === null) throw error;
      const existingRecord = parseRecord(observed.bytes);
      const existingOwner = existingRecord?.activeOwner ?? null;
      if (
        existingOwner === null || existingOwner.host !== owner.host ||
        isProcessAlive(existingOwner.pid) !== 'dead'
      ) return null;
      if (existingRecord!.recoveryOwner !== null && (
        existingRecord!.recoveryOwner.host !== owner.host ||
        isProcessAlive(existingRecord!.recoveryOwner.pid) !== 'dead'
      )) return null;
      const confirmed = inspectNoFollowOrdinaryFileEntry(parent, name);
      if (!sameEntry(observed, confirmed)) continue;
      reclaimedOwner = existingRecord!.recoveryOwner ?? existingOwner;
      reclaimedOwnerBytes = Buffer.from(confirmed!.bytes!);
      const successorBytes = recordBytes(owner, reclaimedOwner);
      acquiredReceipt = replaceDurableCanonicalFile({
        parent, name, bytes: successorBytes,
        expectedExisting: { device: confirmed!.device, inode: confirmed!.inode },
        validate: candidate => {
          if (!Buffer.from(candidate).equals(successorBytes)) throw new Error('Physical mutation lease successor bytes differ.');
        }
      });
      bytes = successorBytes;
      acquired = true;
    }
  }
  if (!acquired || acquiredReceipt === null) return null;
  let heldReceipt: DurableCanonicalFileIdentityReceipt = acquiredReceipt;
  assertDurableCanonicalFileIdentityReceipt(heldReceipt);

  const requireCurrent = (operation: string) => {
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
  return Object.freeze({
    owner,
    get reclaimedOwner(): PhysicalMutationLeaseOwner | null {
      return recoveryAcknowledged || released ? null : reclaimedOwner;
    },
    get recoveryPending(): boolean { return !recoveryAcknowledged && !released; },
    acknowledgeReclaimedRecovery(): void {
      if (released) throw new Error('Physical mutation lease was released before recovery acknowledgement.');
      if (recoveryAcknowledged) return;
      requireCurrent('recovery acknowledgement');
      const acknowledgedBytes = recordBytes(owner, null);
      heldReceipt = replaceDurableCanonicalFile({
        parent, name, bytes: acknowledgedBytes,
        expectedExisting: heldReceipt.physical,
        validate: candidate => {
          if (!Buffer.from(candidate).equals(acknowledgedBytes)) throw new Error('Physical mutation lease acknowledgement bytes differ.');
        }
      });
      bytes = acknowledgedBytes;
      recoveryAcknowledged = true;
    },
    restoreReclaimedOwner(): void {
      if (reclaimedOwner === null || reclaimedOwnerBytes === null) {
        throw new Error('Physical mutation lease has no reclaimed owner to restore.');
      }
      if (reclaimedOwnerRestored) return;
      if (recoveryAcknowledged) throw new Error('Physical mutation lease recovery was already acknowledged.');
      if (released) {
        throw new Error('Physical mutation lease was already released before reclaimed-owner restoration.');
      }
      requireCurrent('reclaimed-owner restoration');
      heldReceipt = replaceDurableCanonicalFile({
        parent,
        name,
        bytes: reclaimedOwnerBytes,
        expectedExisting: heldReceipt.physical,
        validate: (candidate) => {
          const parsed = parseRecord(candidate);
          if (parsed === null || !sameOwner(parsed.recoveryOwner ?? parsed.activeOwner, reclaimedOwner!)) {
            throw new Error('Reclaimed physical mutation lease owner bytes are invalid.');
          }
        }
      });
      reclaimedOwnerRestored = true;
      released = true;
    },
    release(): void {
      if (released || reclaimedOwnerRestored) return;
      if (!recoveryAcknowledged) {
        throw new Error('Physical mutation lease recovery must be acknowledged or restored before release.');
      }
      const current = requireCurrent('release');
      deleteRetainedNoFollowEntry({
        root: parent,
        relativePath: current.relativePath,
        kind: 'file',
        device: current.device,
        inode: current.inode,
        ancestorDirectories: []
      });
      released = true;
    }
  });
}
