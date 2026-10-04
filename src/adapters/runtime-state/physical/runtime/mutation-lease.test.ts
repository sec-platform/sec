import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';

import {
  PHYSICAL_MUTATION_LEASE_SCHEMA,
  PhysicalMutationCoordinationBlockedError,
  acquirePhysicalMutationLease,
  ensurePhysicalMutationCoordinationNamespace,
  preparePhysicalMutationCoordinationResource,
  readPhysicalMutationCoordinationResource,
  type PhysicalMutationLeaseOwner
} from './mutation-lease.ts';
import {
  inspectNoFollowDirectoryChain,
  publishExclusiveDurableCanonicalFile
} from './physical-no-follow.ts';

const LEASE_NAME = '.generated-state-registration-mutation.lock';
const NAMESPACE_LEAF = 'registrations-v3';
const ANCHOR_NAME = `.sec-namespace-coordination-guard-${createHash('sha256').update(NAMESPACE_LEAF).digest('hex')}.lock`;

function exitedPid(): number {
  const result = spawnSync(process.execPath, ['-e', '0'], { stdio: 'ignore' });
  if (!Number.isSafeInteger(result.pid) || result.pid <= 0) throw new Error('Failed to observe an exited helper process.');
  return result.pid;
}

function legacyOwner(overrides: Partial<PhysicalMutationLeaseOwner> = {}): PhysicalMutationLeaseOwner {
  const createdAtMs = Date.now() - 3_600_000;
  return {
    schema: PHYSICAL_MUTATION_LEASE_SCHEMA,
    host: hostname(),
    pid: exitedPid(),
    processNonce: randomUUID(),
    token: randomUUID(),
    createdAtMs,
    expiresAtMs: createdAtMs + 30_000,
    ...overrides
  };
}

function fixture(options: Readonly<{ namespace?: boolean }> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-mutation-lease-'));
  if (options.namespace === true) mkdirSync(path.join(root, NAMESPACE_LEAF));
  const parent = inspectNoFollowDirectoryChain(root, 'Mutation lease adoption fixture').target;
  const writeLegacy = (owner: PhysicalMutationLeaseOwner): string => {
    const bytes = `${JSON.stringify(owner)}\n`;
    writeFileSync(path.join(root, LEASE_NAME), bytes, 'utf8');
    return bytes;
  };
  return { root, parent, writeLegacy };
}

function readRecord(root: string): Record<string, any> {
  return JSON.parse(readFileSync(path.join(root, LEASE_NAME), 'utf8')) as Record<string, any>;
}

function expectBlocked(action: () => unknown, status: 'legacy-unproven' | 'unknown'): void {
  let blocked: unknown;
  try { action(); } catch (error) { blocked = error; }
  expect(blocked).toBeInstanceOf(PhysicalMutationCoordinationBlockedError);
  expect((blocked as PhysicalMutationCoordinationBlockedError).status).toBe(status);
  expect((blocked as PhysicalMutationCoordinationBlockedError).code).toBe('PHYSICAL_MUTATION_COORDINATION_BLOCKED');
}

test('strict read preserves a dead local legacy record while prepare adopts it into the guarded protocol', () => {
  const { root, parent, writeLegacy } = fixture({ namespace: true });
  try {
    const legacy = legacyOwner();
    const legacyBytes = writeLegacy(legacy);
    expect(() => readPhysicalMutationCoordinationResource(parent, LEASE_NAME, NAMESPACE_LEAF)).toThrow(
      'original bytes are preserved');
    const resource = preparePhysicalMutationCoordinationResource(parent, LEASE_NAME, NAMESPACE_LEAF);
    const adopted = readRecord(root);
    expect(adopted.schema).toBe('sec-physical-namespace-coordination-record-v1');
    expect(adopted.phase).toBe('ready');
    expect(adopted.activeOwner.token).toBe(legacy.token);
    expect(adopted.recoveryOwner).toBeNull();
    expect(readdirSync(root).filter(name => name === ANCHOR_NAME)).toHaveLength(1);
    const lease = acquirePhysicalMutationLease(parent, LEASE_NAME, { coordinationResource: resource })!;
    expect(lease).not.toBeNull();
    expect(lease.reclaimedOwner?.token).toBe(legacy.token);
    expect(lease.recoveryPending).toBe(true);
    ensurePhysicalMutationCoordinationNamespace(lease);
    lease.acknowledgeReclaimedRecovery();
    expect(readRecord(root).recoveryOwner).toBeNull();
    lease.release();
    const terminal = readRecord(root);
    expect(terminal.phase).toBe('ready');
    expect(terminal.activeOwner).toBeNull();
    expect(terminal.recoveryOwner).toBeNull();
    expect(legacyBytes.length).toBeGreaterThan(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('adoption of a legacy record without a namespace pin births the namespace through the guarded handle', () => {
  const { root, parent, writeLegacy } = fixture();
  try {
    const legacy = legacyOwner();
    writeLegacy(legacy);
    const resource = preparePhysicalMutationCoordinationResource(parent, LEASE_NAME, NAMESPACE_LEAF);
    const adopted = readRecord(root);
    expect(adopted.phase).toBe('initializing');
    expect(adopted.binding.namespacePhysical).toBeNull();
    expect(adopted.activeOwner.token).toBe(legacy.token);
    const lease = acquirePhysicalMutationLease(parent, LEASE_NAME, { coordinationResource: resource })!;
    expect(lease.reclaimedOwner?.token).toBe(legacy.token);
    const namespace = ensurePhysicalMutationCoordinationNamespace(lease);
    expect(readRecord(root).phase).toBe('ready');
    expect(readRecord(root).binding.namespacePhysical.objectId).toBe(namespace.objectId);
    lease.acknowledgeReclaimedRecovery();
    lease.release();
    const terminal = readRecord(root);
    expect(terminal.activeOwner).toBeNull();
    expect(terminal.recoveryOwner).toBeNull();
    expect(readdirSync(root)).toContain(NAMESPACE_LEAF);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a retained adoption anchor resumes an interrupted adoption instead of creating a second generation', () => {
  const { root, parent, writeLegacy } = fixture({ namespace: true });
  try {
    writeLegacy(legacyOwner());
    const material = {
      resourceGeneration: randomUUID(),
      schema: 'sec-physical-namespace-coordination-anchor-v1',
      parent: Object.freeze({ device: parent.device, inode: parent.inode, objectId: parent.objectId }),
      leaseName: LEASE_NAME,
      resourceName: NAMESPACE_LEAF,
      effectDomain: 'namespace-coordination'
    };
    const anchorBytes = Buffer.from(`${JSON.stringify(material)}\n`, 'utf8');
    publishExclusiveDurableCanonicalFile({
      parent, name: ANCHOR_NAME, bytes: anchorBytes,
      validate: candidate => { if (!Buffer.from(candidate).equals(anchorBytes)) throw new Error('fixture anchor differs'); }
    });
    const resource = preparePhysicalMutationCoordinationResource(parent, LEASE_NAME, NAMESPACE_LEAF);
    const adopted = readRecord(root);
    expect(adopted.phase).toBe('ready');
    expect(adopted.binding.material.resourceGeneration).toBe(material.resourceGeneration);
    const lease = acquirePhysicalMutationLease(parent, LEASE_NAME, { coordinationResource: resource })!;
    expect(lease).not.toBeNull();
    lease.acknowledgeReclaimedRecovery();
    lease.release();
    expect(readRecord(root).activeOwner).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('unexpired, live, foreign or non-legacy preimages are preserved without adoption', () => {
  const cases: ReadonlyArray<Readonly<{ name: string; owner: PhysicalMutationLeaseOwner | null; status: 'legacy-unproven' | 'unknown' }>> = [
    { name: 'unexpired', owner: legacyOwner({ expiresAtMs: Date.now() + 3_600_000 }), status: 'legacy-unproven' },
    { name: 'live pid', owner: legacyOwner({ pid: process.pid }), status: 'legacy-unproven' },
    { name: 'foreign host', owner: legacyOwner({ host: 'foreign-host' }), status: 'legacy-unproven' },
    { name: 'non-legacy bytes', owner: null, status: 'unknown' }
  ];
  for (const scenario of cases) {
    const { root, parent, writeLegacy } = fixture({ namespace: true });
    try {
      const bytes = scenario.owner === null
        ? (() => { writeFileSync(path.join(root, LEASE_NAME), '{"schema":"sec-physical-mutation-lease-v1"}\n', 'utf8'); return null; })()
        : writeLegacy(scenario.owner);
      expectBlocked(() => preparePhysicalMutationCoordinationResource(parent, LEASE_NAME, NAMESPACE_LEAF), scenario.status);
      expect(readFileSync(path.join(root, LEASE_NAME), 'utf8')).toBe(
        bytes ?? '{"schema":"sec-physical-mutation-lease-v1"}\n');
      expect(readdirSync(root).sort()).toEqual([LEASE_NAME, NAMESPACE_LEAF].sort());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});