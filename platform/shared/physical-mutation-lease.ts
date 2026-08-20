import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import {
  PhysicalNoFollowError,
  deleteRetainedNoFollowEntryV1,
  inspectNoFollowOrdinaryFileEntryV1,
  publishExclusiveDurableCanonicalFileV1,
  type PhysicalDirectoryIdentityV1
} from './physical-no-follow.ts';

export const PHYSICAL_MUTATION_LEASE_SCHEMA_V1 = 'sec-physical-mutation-lease-v1' as const;

export interface PhysicalMutationLeaseOwnerV1 {
  readonly schema: typeof PHYSICAL_MUTATION_LEASE_SCHEMA_V1;
  readonly host: string;
  readonly pid: number;
  readonly processNonce: string;
  readonly token: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

export interface PhysicalMutationLeaseHandleV1 {
  readonly owner: PhysicalMutationLeaseOwnerV1;
  release(): void;
}

export interface PhysicalMutationLeaseOptionsV1 {
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

function parseOwner(bytes: Uint8Array): PhysicalMutationLeaseOwnerV1 | null {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length !== OWNER_KEYS.length || keys.some((key, index) => key !== OWNER_KEYS[index])) return null;
  const owner = value as Partial<PhysicalMutationLeaseOwnerV1>;
  if (
    owner.schema !== PHYSICAL_MUTATION_LEASE_SCHEMA_V1 ||
    typeof owner.host !== 'string' || owner.host.length === 0 ||
    !Number.isSafeInteger(owner.pid) || (owner.pid ?? 0) <= 0 ||
    typeof owner.processNonce !== 'string' || !/^[0-9a-f-]{36}$/u.test(owner.processNonce) ||
    typeof owner.token !== 'string' || !/^[0-9a-f-]{36}$/u.test(owner.token) ||
    !Number.isSafeInteger(owner.createdAtMs) || (owner.createdAtMs ?? -1) < 0 ||
    !Number.isSafeInteger(owner.expiresAtMs) || (owner.expiresAtMs ?? -1) < (owner.createdAtMs ?? 0)
  ) return null;
  return owner as PhysicalMutationLeaseOwnerV1;
}

function sameEntry(
  left: ReturnType<typeof inspectNoFollowOrdinaryFileEntryV1>,
  right: ReturnType<typeof inspectNoFollowOrdinaryFileEntryV1>
): boolean {
  return left !== null && right !== null && left.bytes !== null && right.bytes !== null &&
    left.device === right.device && left.inode === right.inode &&
    Buffer.from(left.bytes).equals(Buffer.from(right.bytes));
}

/**
 * Acquires one same-parent, crash-recoverable physical mutation lease. A
 * contender may retire an abandoned generation only after two identical
 * retained identity/byte observations and a local owner-death proof. Expiry is
 * diagnostic and prevents an unbounded owner claim, but never authorizes
 * stealing a live, remote, or liveness-unknown lease.
 */
export function acquirePhysicalMutationLeaseV1(
  parent: PhysicalDirectoryIdentityV1,
  name: string,
  options: PhysicalMutationLeaseOptionsV1 = {}
): PhysicalMutationLeaseHandleV1 | null {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new Error('Physical mutation lease TTL must be a positive safe integer.');
  }
  const createdAtMs = now();
  const owner: PhysicalMutationLeaseOwnerV1 = Object.freeze({
    schema: PHYSICAL_MUTATION_LEASE_SCHEMA_V1,
    host: options.ownerHost ?? hostname(),
    pid: options.ownerPid ?? process.pid,
    processNonce: options.processNonce ?? PROCESS_NONCE,
    token: randomUUID(),
    createdAtMs,
    expiresAtMs: createdAtMs + ttlMs
  });
  const bytes = Buffer.from(`${JSON.stringify(owner)}\n`, 'utf8');
  const isProcessAlive = options.processAlive ?? processLiveness;

  let acquired = false;
  for (let attempt = 0; attempt < 4 && !acquired; attempt += 1) {
    try {
      publishExclusiveDurableCanonicalFileV1({ parent, name, bytes, validate: () => undefined });
      acquired = true;
    } catch (error) {
      const observed = inspectNoFollowOrdinaryFileEntryV1(parent, name);
      if (!(error instanceof PhysicalNoFollowError) || observed === null || observed.bytes === null) throw error;
      const existingOwner = parseOwner(observed.bytes);
      if (
        existingOwner === null || existingOwner.host !== owner.host ||
        isProcessAlive(existingOwner.pid) !== 'dead'
      ) return null;
      const confirmed = inspectNoFollowOrdinaryFileEntryV1(parent, name);
      if (!sameEntry(observed, confirmed)) continue;
      deleteRetainedNoFollowEntryV1({
        root: parent,
        relativePath: confirmed!.relativePath,
        kind: 'file',
        device: confirmed!.device,
        inode: confirmed!.inode,
        ancestorDirectories: []
      });
    }
  }
  if (!acquired) return null;

  let released = false;
  return Object.freeze({
    owner,
    release(): void {
      if (released) return;
      const current = inspectNoFollowOrdinaryFileEntryV1(parent, name);
      if (current === null || current.bytes === null || !Buffer.from(current.bytes).equals(bytes)) {
        throw new Error('Physical mutation lease ownership changed before release.');
      }
      deleteRetainedNoFollowEntryV1({
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
