import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  acquirePhysicalMutationLease,
  PHYSICAL_MUTATION_LEASE_SCHEMA,
  type PhysicalMutationLeaseOwner
} from '../../src/adapters/runtime-state/physical/runtime/mutation-lease.ts';
import {
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  recoverDurableCanonicalFileReplacement,
  replaceDurableCanonicalFile
} from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';

function fixture(): Readonly<{
  root: string;
  parent: ReturnType<typeof inspectNoFollowDirectoryChain>['target'];
}> {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-physical-mutation-lease-'));
  mkdirSync(path.join(root, 'lease-parent'));
  return Object.freeze({
    root,
    parent: inspectNoFollowDirectoryChain(path.join(root, 'lease-parent'), 'lease test parent').target
  });
}

function ownerBytes(owner: PhysicalMutationLeaseOwner): Buffer {
  return Buffer.from(`${JSON.stringify({
    schema: owner.schema,
    host: owner.host,
    pid: owner.pid,
    processNonce: owner.processNonce,
    token: owner.token,
    createdAtMs: owner.createdAtMs,
    expiresAtMs: owner.expiresAtMs
  })}\n`, 'utf8');
}

function replaceLeaseBytes(
  parent: ReturnType<typeof inspectNoFollowDirectoryChain>['target'],
  name: string,
  bytes: Buffer
): void {
  const current = inspectNoFollowOrdinaryFileEntry(parent, name);
  if (current === null || current.bytes === null) throw new Error('lease fixture is absent');
  replaceDurableCanonicalFile({
    parent,
    name,
    bytes,
    expectedExisting: { device: current.device, inode: current.inode },
    validate: () => undefined
  });
}

test('reclaimed-owner restore rejects an externally replaced lease and preserves its bytes', () => {
  const { root, parent } = fixture();
  const name = 'invocation.lease';
  try {
    const abandoned = acquirePhysicalMutationLease(parent, name, {
      now: () => 1_000,
      ownerHost: 'lease-test-host',
      ownerPid: 42_001,
      processNonce: '30000000-0000-4000-8000-000000000001',
      processAlive: () => 'alive'
    });
    expect(abandoned).not.toBeNull();
    const successor = acquirePhysicalMutationLease(parent, name, {
      now: () => 2_000,
      ownerHost: 'lease-test-host',
      ownerPid: 42_002,
      processNonce: '30000000-0000-4000-8000-000000000002',
      processAlive: pid => pid === 42_001 ? 'dead' : 'alive'
    });
    expect(successor).not.toBeNull();
    expect(successor!.reclaimedOwner).toEqual(abandoned!.owner);
    expect(() => successor!.release()).toThrow('recovery must be acknowledged or restored');

    const externalOwner: PhysicalMutationLeaseOwner = Object.freeze({
      schema: PHYSICAL_MUTATION_LEASE_SCHEMA,
      host: 'lease-test-host',
      pid: 42_003,
      processNonce: '30000000-0000-4000-8000-000000000003',
      token: '40000000-0000-4000-8000-000000000003',
      createdAtMs: 3_000,
      expiresAtMs: 33_000
    });
    const externalBytes = ownerBytes(externalOwner);
    replaceLeaseBytes(parent, name, externalBytes);

    expect(() => successor!.restoreReclaimedOwner()).toThrow(
      'Physical mutation lease ownership changed before reclaimed-owner restoration.'
    );
    const observed = inspectNoFollowOrdinaryFileEntry(parent, name);
    expect(observed?.bytes).not.toBeNull();
    expect(Array.from(observed!.bytes!)).toEqual(Array.from(externalBytes));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('restored reclaimed owner remains durable when the same handle releases', () => {
  const { root, parent } = fixture();
  const name = 'invocation.lease';
  try {
    const abandoned = acquirePhysicalMutationLease(parent, name, {
      now: () => 1_000,
      ownerHost: 'lease-test-host',
      ownerPid: 42_011,
      processNonce: '30000000-0000-4000-8000-000000000011',
      processAlive: () => 'alive'
    });
    expect(abandoned).not.toBeNull();
    const oldBytes = inspectNoFollowOrdinaryFileEntry(parent, name)?.bytes;
    expect(oldBytes).not.toBeNull();

    const successor = acquirePhysicalMutationLease(parent, name, {
      now: () => 2_000,
      ownerHost: 'lease-test-host',
      ownerPid: 42_012,
      processNonce: '30000000-0000-4000-8000-000000000012',
      processAlive: pid => pid === 42_011 ? 'dead' : 'alive'
    });
    expect(successor).not.toBeNull();
    expect(successor!.reclaimedOwner).toEqual(abandoned!.owner);
    successor!.restoreReclaimedOwner();
    expect(() => successor!.release()).not.toThrow();

    const observed = inspectNoFollowOrdinaryFileEntry(parent, name);
    expect(observed?.bytes).not.toBeNull();
    expect(Buffer.from(observed!.bytes!)).toEqual(Buffer.from(oldBytes!));
    expect(existsSync(path.join(parent.path, name))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const malformed of ['non-canonical', 'self-recovery'] as const) {
  test(`malformed ${malformed} lease is preserved instead of granting recovery`, () => {
    const { root, parent } = fixture();
    const name = 'invocation.lease';
    try {
      const lease = acquirePhysicalMutationLease(parent, name, {
        ownerHost: 'lease-test-host', ownerPid: 42_031
      });
      expect(lease).not.toBeNull();
      const current = inspectNoFollowOrdinaryFileEntry(parent, name)!;
      const record = JSON.parse(Buffer.from(current.bytes!).toString('utf8'));
      if (malformed === 'self-recovery') record.recoveryOwner = record.activeOwner;
      const bytes = Buffer.from(`${JSON.stringify(record, null, malformed === 'non-canonical' ? 2 : undefined)}\n`);
      replaceLeaseBytes(parent, name, bytes);
      expect(acquirePhysicalMutationLease(parent, name, {
        ownerHost: 'lease-test-host', ownerPid: 42_032, processAlive: () => 'dead'
      })).toBeNull();
      expect(Buffer.from(inspectNoFollowOrdinaryFileEntry(parent, name)!.bytes!)).toEqual(bytes);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('an unrepresentable lease expiry rejects before publishing owner state', () => {
  const { root, parent } = fixture();
  try {
    expect(() => acquirePhysicalMutationLease(parent, 'invocation.lease', {
      now: () => Number.MAX_SAFE_INTEGER, ttlMs: 1
    })).toThrow('creation and expiry');
    expect(inspectNoFollowOrdinaryFileEntry(parent, 'invocation.lease')).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const action of ['release', 'acknowledgeReclaimedRecovery', 'restoreReclaimedOwner'] as const) {
  test(`same-byte file replacement cannot acquire this handle's ${action} authority`, () => {
    const { root, parent } = fixture();
    const name = 'invocation.lease';
    try {
      const first = acquirePhysicalMutationLease(parent, name, {
        ownerHost: 'lease-test-host', ownerPid: 42_041
      })!;
      const lease = action === 'release' ? first : acquirePhysicalMutationLease(parent, name, {
        ownerHost: 'lease-test-host', ownerPid: 42_042, processAlive: () => 'dead'
      })!;
      const original = inspectNoFollowOrdinaryFileEntry(parent, name)!;
      const bytes = Buffer.from(original.bytes!);
      replaceLeaseBytes(parent, name, bytes);
      const replacement = inspectNoFollowOrdinaryFileEntry(parent, name)!;
      expect(replacement.inode).not.toBe(original.inode);
      expect(() => lease[action]()).toThrow('ownership changed');
      const preserved = inspectNoFollowOrdinaryFileEntry(parent, name)!;
      expect(preserved.inode).toBe(replacement.inode);
      expect(Buffer.from(preserved.bytes!)).toEqual(bytes);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('real successor process death preserves the original OCI candidate recovery owner', async () => {
  const { root } = fixture();
  const specDigest = `sha256:${'a'.repeat(64)}`;
  const generation = path.join(root, specDigest.slice(7));
  mkdirSync(generation);
  const moduleUrl = (relative: string) => pathToFileURL(path.resolve(import.meta.dir, relative)).href;
  const scriptPath = path.join(root, 'lease-child.ts');
  writeFileSync(scriptPath, `
    import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
    import path from 'node:path';
    import { acquirePhysicalMutationLease } from ${JSON.stringify(moduleUrl('../../src/adapters/runtime-state/physical/runtime/mutation-lease.ts'))};
    import { inspectNoFollowDirectoryChain } from ${JSON.stringify(moduleUrl('../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts'))};
    import { createLocalGitHubActionsRunnerOciCandidateBinding, reconcileReclaimedLocalGitHubActionsRunnerOciCandidate } from ${JSON.stringify(moduleUrl('../../src/adapters/verification/platform/ci/runtime/local-github-actions-runner.ts'))};
    const directory = inspectNoFollowDirectoryChain(${JSON.stringify(generation)}, 'native crash recovery fixture').target;
    const lease = acquirePhysicalMutationLease(directory, 'materialization-lease.json');
    if (lease === null) throw new Error('Reaped predecessor was not reclaimable');
    const stage = process.argv[2];
    if (stage === 'A') {
      const binding = createLocalGitHubActionsRunnerOciCandidateBinding(${JSON.stringify(specDigest)}, lease.owner);
      const candidatePath = path.join(directory.path, binding.candidateName);
      mkdirSync(candidatePath);
      writeFileSync(path.join(candidatePath, 'partial-layer'), 'interrupted build');
      console.log(JSON.stringify({ owner: lease.owner, candidatePath }));
    } else if (stage === 'B') {
      if (lease.reclaimedOwner === null || !lease.recoveryPending) throw new Error('Missing predecessor lineage');
      console.log(JSON.stringify({ owner: lease.owner, recoveryOwner: lease.reclaimedOwner }));
    } else {
      if (lease.reclaimedOwner === null) throw new Error('Original lineage was lost');
      const recoveryOwner = lease.reclaimedOwner;
      const binding = createLocalGitHubActionsRunnerOciCandidateBinding(${JSON.stringify(specDigest)}, recoveryOwner);
      const result = reconcileReclaimedLocalGitHubActionsRunnerOciCandidate({ directory, specDigest: ${JSON.stringify(specDigest)}, owner: recoveryOwner });
      if (existsSync(path.join(directory.path, binding.candidateName))) throw new Error('Original candidate remained');
      lease.acknowledgeReclaimedRecovery();
      lease.release();
      console.log(JSON.stringify({ recoveryOwner, result }));
    }
    // A and B deliberately exit without finally/release. Parent joins each
    // real process before the next acquisition uses native process liveness.
    process.exit(0);
  `);
  const child = async (stage: string): Promise<Record<string, unknown>> => {
    const childProcess = Bun.spawn([process.execPath, '--no-env-file', scriptPath, stage], {
      cwd: root, stdout: 'pipe', stderr: 'pipe', signal: AbortSignal.timeout(20_000)
    });
    const [code, stdout, stderr] = await Promise.all([
      childProcess.exited, new Response(childProcess.stdout).text(), new Response(childProcess.stderr).text()
    ]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    return JSON.parse(stdout) as Record<string, unknown>;
  };
  try {
    const first = await child('A');
    const intermediate = await child('B');
    expect(intermediate.recoveryOwner).toEqual(first.owner);
    expect(intermediate.owner).not.toEqual(first.owner);
    const final = await child('C');
    expect(final.recoveryOwner).toEqual(first.owner);
    expect(final.result).toBe('retired-invalid');
    expect(existsSync(String(first.candidatePath))).toBe(false);
    expect(existsSync(path.join(generation, 'materialization-lease.json'))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 65_000);

test.skipIf(process.platform !== 'win32')('physical CAS recovers after native child exit at each durable transition', async () => {
  for (const [point, expected, status] of [
    ['after-transaction-record', 'old\n', 'rolled-back'],
    ['after-preimage-quarantine', 'old\n', 'rolled-back'],
    ['after-candidate-publication', 'new\n', 'completed']
  ] as const) {
    const { root, parent } = fixture();
    try {
      const finalPath = path.join(parent.path, 'owner.json');
      writeFileSync(finalPath, 'old\n');
      const scriptPath = path.join(root, 'cas-child.ts');
      const physicalUrl = pathToFileURL(path.resolve(import.meta.dir, '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts')).href;
      writeFileSync(scriptPath, `
        import { inspectNoFollowDirectoryChain, inspectNoFollowOrdinaryFileEntry, replaceDurableCanonicalFile, createDurableReplacementInterruptionActorForTests } from ${JSON.stringify(physicalUrl)};
        const parent = inspectNoFollowDirectoryChain(${JSON.stringify(parent.path)}, 'CAS child parent').target;
        const current = inspectNoFollowOrdinaryFileEntry(parent, 'owner.json');
        if (current === null) throw new Error('No preimage');
        replaceDurableCanonicalFile({ parent, name: 'owner.json', bytes: Buffer.from('new\\n'),
          expectedExisting: { device: current.device, inode: current.inode }, validate: () => undefined,
          windowsInterruptionActor: createDurableReplacementInterruptionActorForTests(${JSON.stringify(point)}, () => process.exit(73)) });
        throw new Error('Native exit point was not reached');
      `);
      const child = Bun.spawn([process.execPath, '--no-env-file', scriptPath], {
        cwd: root, stdout: 'pipe', stderr: 'pipe', signal: AbortSignal.timeout(20_000)
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()
      ]);
      expect({ code, stdout, stderr }).toEqual({ code: 73, stdout: '', stderr: '' });
      expect(recoverDurableCanonicalFileReplacement({ parent, name: 'owner.json' }).status).toBe(status);
      expect(readFileSync(finalPath, 'utf8')).toBe(expected);
      expect(readdirSync(parent.path)).toEqual(['owner.json']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}, 65_000);
