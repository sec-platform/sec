import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  acquirePhysicalMutationLease, assertPhysicalMutationLeaseOwned,
  completePhysicalJournalMutationRetirement,
  deletePhysicalJournalMutationFile,
  ensurePhysicalMutationCoordinationNamespace,
  PHYSICAL_MUTATION_LEASE_SCHEMA,
  preparePhysicalMutationCoordinationResource,
  publishPhysicalJournalMutationInitialization,
  readPhysicalMutationCoordinationResource
} from '../../src/adapters/runtime-state/physical/runtime/mutation-lease.ts';
import { inspectNoFollowDirectoryChain, inspectNoFollowOrdinaryFileEntry, publishExclusiveDurableCanonicalFile } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';

const name = 'registration.lock', namespace = 'registrations-v3';
const ownerUrl = pathToFileURL(path.resolve('src/adapters/runtime-state/physical/runtime/mutation-lease.ts')).href;
const physicalUrl = pathToFileURL(path.resolve('src/adapters/runtime-state/physical/runtime/physical-no-follow.ts')).href;
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-coordination-'));
  const parent = inspectNoFollowDirectoryChain(root).target;
  return { root, parent };
}
function child(root: string, code: string) {
  const result = Bun.spawnSync([process.execPath, '--no-env-file', '-e', `
    import * as owner from ${JSON.stringify(ownerUrl)};
    import * as physical from ${JSON.stringify(physicalUrl)};
    import path from 'node:path';
    const parent=physical.inspectNoFollowDirectoryChain(${JSON.stringify(root)}).target;
    const name=${JSON.stringify(name)}, namespace=${JSON.stringify(namespace)};
    ${code}
  `], { stdout: 'pipe', stderr: 'pipe' });
  expect({ exit: result.exitCode, stderr: result.stderr.toString() }).toEqual({ exit: 0, stderr: '' });
  return result.stdout.toString().trim();
}
function ready(parent: ReturnType<typeof fixture>['parent']) {
  const resource = preparePhysicalMutationCoordinationResource(parent, name, namespace);
  const lease = acquirePhysicalMutationLease(parent, name, { coordinationResource: resource })!;
  const directory = ensurePhysicalMutationCoordinationNamespace(lease);
  lease.release();
  return directory;
}

test('coordination first birth is durable and two real processes exclude without journal authority', () => {
  const { root, parent } = fixture();
  try {
    const resource = preparePhysicalMutationCoordinationResource(parent, name, namespace);
    expect(readdirSync(root)).not.toContain(namespace);
    const lease = acquirePhysicalMutationLease(parent, name, { coordinationResource: resource })!;
    const directory = ensurePhysicalMutationCoordinationNamespace(lease);
    expect(JSON.parse(readFileSync(path.join(root, name), 'utf8')).binding.namespacePhysical.objectId).toBe(directory.objectId);
    expect(child(root, `const resource=owner.readPhysicalMutationCoordinationResource(parent,name,namespace);
      console.log(owner.acquirePhysicalMutationLease(parent,name,{coordinationResource:resource})===null);`)).toBe('true');
    expect(() => deletePhysicalJournalMutationFile(lease, { device: '0', inode: '0', bytes: Buffer.alloc(0) })).toThrow('not issued');
    expect(() => publishPhysicalJournalMutationInitialization(lease, Buffer.from('{}\n'))).toThrow('not issued');
    expect(() => completePhysicalJournalMutationRetirement(lease, Buffer.alloc(0))).toThrow('not issued');
    lease.release();
    expect(() => assertPhysicalMutationLeaseOwned(lease)).toThrow();
    expect(() => ensurePhysicalMutationCoordinationNamespace(lease)).toThrow('no longer held');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('controller exit permits same guarded lineage recovery, failure restores and readback permits acknowledgement', () => {
  const { root, parent } = fixture();
  try {
    const original = ready(parent);
    const abandoned = JSON.parse(child(root, `const resource=owner.readPhysicalMutationCoordinationResource(parent,name,namespace);
      const lease=owner.acquirePhysicalMutationLease(parent,name,{coordinationResource:resource});
      console.log(JSON.stringify(lease.owner)); process.exit(0);`));
    const before = readFileSync(path.join(root, name));
    const successor = acquirePhysicalMutationLease(parent, name, { coordinationResource: readPhysicalMutationCoordinationResource(parent, name, namespace)! })!;
    expect(successor.reclaimedOwner).toEqual(abandoned);
    expect(successor.recoveryPending).toBe(true);
    expect(() => successor.release()).toThrow('acknowledged or restored');
    successor.restoreReclaimedOwner();
    expect(readFileSync(path.join(root, name)).equals(before)).toBe(true);
    expect(() => assertPhysicalMutationLeaseOwned(successor)).toThrow();
    const resumed = acquirePhysicalMutationLease(parent, name, { coordinationResource: readPhysicalMutationCoordinationResource(parent, name, namespace)! })!;
    expect(ensurePhysicalMutationCoordinationNamespace(resumed).objectId).toBe(original.objectId);
    expect(readdirSync(path.join(root, namespace))).toEqual([]);
    resumed.acknowledgeReclaimedRecovery();
    expect(resumed.recoveryPending).toBe(false);
    resumed.release();
    expect(JSON.parse(readFileSync(path.join(root, name), 'utf8')).activeOwner).toBeNull();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('reclaimed initializing owner failure preserves committed namespace pin and recovery lineage', () => {
  const { root, parent } = fixture();
  try {
    preparePhysicalMutationCoordinationResource(parent, name, namespace);
    const abandoned = JSON.parse(child(root, `const resource=owner.readPhysicalMutationCoordinationResource(parent,name,namespace);
      const lease=owner.acquirePhysicalMutationLease(parent,name,{coordinationResource:resource});
      console.log(JSON.stringify(lease.owner)); process.exit(0);`));
    const successor = acquirePhysicalMutationLease(parent, name, {
      coordinationResource: readPhysicalMutationCoordinationResource(parent, name, namespace)!
    })!;
    const born = ensurePhysicalMutationCoordinationNamespace(successor);
    expect(successor.recoveryPending).toBe(true);
    expect(() => successor.restoreReclaimedOwner()).toThrow('ready physical pin and reclaimed lineage are preserved');
    const preserved = JSON.parse(readFileSync(path.join(root, name), 'utf8'));
    expect(preserved.phase).toBe('ready');
    expect(preserved.binding.namespacePhysical.objectId).toBe(born.objectId);
    expect(preserved.recoveryOwner).toEqual(abandoned);
    expect(() => assertPhysicalMutationLeaseOwned(successor)).toThrow();
    const resumed = acquirePhysicalMutationLease(parent, name, {
      coordinationResource: readPhysicalMutationCoordinationResource(parent, name, namespace)!
    })!;
    expect(resumed.reclaimedOwner).toEqual(abandoned);
    expect(ensurePhysicalMutationCoordinationNamespace(resumed).objectId).toBe(born.objectId);
    resumed.acknowledgeReclaimedRecovery();
    resumed.release();
    expect(JSON.parse(readFileSync(path.join(root, name), 'utf8')).activeOwner).toBeNull();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('legacy unguarded carrier remains typed unproven with exact bytes and identity', () => {
  const { root, parent } = fixture();
  try {
    const bytes = Buffer.from(`${JSON.stringify({ schema: PHYSICAL_MUTATION_LEASE_SCHEMA, host: 'legacy', pid: 42,
      processNonce: '10000000-0000-4000-8000-000000000001', token: '20000000-0000-4000-8000-000000000001', createdAtMs: 1, expiresAtMs: 2 })}\n`);
    writeFileSync(path.join(root, name), bytes);
    const before = inspectNoFollowOrdinaryFileEntry(parent, name)!;
    let status = '';
    try { preparePhysicalMutationCoordinationResource(parent, name, namespace); } catch (error) { status = (error as { status: string }).status; }
    expect(status).toBe('legacy-unproven');
    expect(readdirSync(root)).toEqual([name]);
    const after = inspectNoFollowOrdinaryFileEntry(parent, name)!;
    expect([after.device, after.inode, Buffer.from(after.bytes!).toString('hex')]).toEqual([before.device, before.inode, bytes.toString('hex')]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('fake resource, foreign parent and replaced anchor cannot issue a coordination lease', () => {
  const one = fixture(), two = fixture();
  try {
    ready(one.parent);
    const resource = readPhysicalMutationCoordinationResource(one.parent, name, namespace)!;
    expect(() => acquirePhysicalMutationLease(one.parent, name, { coordinationResource: { kind: 'physical-mutation-coordination-resource' } })).toThrow('not issued');
    expect(() => acquirePhysicalMutationLease(two.parent, name, { coordinationResource: resource })).toThrow('binding differs');
    const anchorName = JSON.parse(readFileSync(path.join(one.root, name), 'utf8')).binding.anchorName;
    const bytes = readFileSync(path.join(one.root, anchorName));
    renameSync(path.join(one.root, anchorName), path.join(one.root, 'original-anchor'));
    writeFileSync(path.join(one.root, anchorName), bytes);
    expect(() => readPhysicalMutationCoordinationResource(one.parent, name, namespace)).toThrow('anchor identity');
    expect(readFileSync(path.join(one.root, 'original-anchor')).equals(bytes)).toBe(true);
  } finally { rmSync(one.root, { recursive: true, force: true }); rmSync(two.root, { recursive: true, force: true }); }
});

test('ready namespace replacement cannot be adopted and its coordination predecessor is preserved', () => {
  const { root, parent } = fixture();
  try {
    ready(parent);
    const resource = readPhysicalMutationCoordinationResource(parent, name, namespace)!;
    const before = readFileSync(path.join(root, name));
    renameSync(path.join(root, namespace), path.join(root, 'original-namespace'));
    mkdirSync(path.join(root, namespace));
    expect(() => acquirePhysicalMutationLease(parent, name, { coordinationResource: resource })).toThrow('physical identity changed');
    expect(readFileSync(path.join(root, name)).equals(before)).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('directory birth before durable pin interruption remains UNKNOWN instead of adopting present bytes', () => {
  const { root, parent } = fixture();
  try {
    preparePhysicalMutationCoordinationResource(parent, name, namespace);
    child(root, `const resource=owner.readPhysicalMutationCoordinationResource(parent,name,namespace);
      owner.acquirePhysicalMutationLease(parent,name,{coordinationResource:resource});
      const born=physical.createExclusiveNoFollowDirectory(parent,namespace);
      physical.flushNoFollowDirectory(born); physical.flushNoFollowDirectory(parent); process.exit(0);`);
    const before = readFileSync(path.join(root, name));
    expect(() => acquirePhysicalMutationLease(parent, name, { coordinationResource: readPhysicalMutationCoordinationResource(parent, name, namespace)! })).toThrow('no durable physical pin');
    expect(readFileSync(path.join(root, name)).equals(before)).toBe(true);
    expect(inspectNoFollowDirectoryChain(path.join(root, namespace)).target.objectId).toBeTruthy();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
