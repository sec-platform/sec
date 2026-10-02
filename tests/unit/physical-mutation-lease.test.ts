import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  acquirePhysicalMutationLease,
  completePhysicalJournalMutationInitialization,
  initializePhysicalJournalMutationResource,
  PHYSICAL_MUTATION_LEASE_SCHEMA,
  readPhysicalJournalMutationResource,
  type PhysicalMutationLeaseOwner
} from '../../src/adapters/runtime-state/physical/runtime/mutation-lease.ts';
import {
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  publishExclusiveDurableCanonicalFile,
  recoverDurableCanonicalFileReplacement,
  replaceDurableCanonicalFile,
  scanNoFollowDirectoryDirectMetadata
} from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';

import { assertWorkspaceWriteLease, withWorkspaceWriteLease } from '../../src/adapters/filesystem/write-lease.ts';
import { createRuntimeStateJournalFileSystem, prepareRuntimeStateJournalMutation, runtimeStateJournalMutationLeaseName } from '../../src/adapters/runtime-state/workspace-state/journal-filesystem.ts';

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

function abandonGuarded(parent: ReturnType<typeof inspectNoFollowDirectoryChain>['target'], name: string,
  options: Parameters<typeof acquirePhysicalMutationLease>[2] = {}) {
  const resourceName = 'direct-journal.json';
  const resource = initializePhysicalJournalMutationResource(parent, name, resourceName);
  const initial = acquirePhysicalMutationLease(parent, name, { journalResource: resource })!;
  completePhysicalJournalMutationInitialization(initial, publishExclusiveDurableCanonicalFile({
    parent, name: resourceName, bytes: Buffer.from('fixture'), validate: () => undefined
  }));
  initial.release();
  const moduleUrl = pathToFileURL(path.resolve(import.meta.dir,
    '../../src/adapters/runtime-state/physical/runtime/mutation-lease.ts')).href;
  const physicalUrl = pathToFileURL(path.resolve(import.meta.dir,
    '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts')).href;
  const child = Bun.spawnSync([process.execPath, '--no-env-file', '-e', `
    import { acquirePhysicalMutationLease, readPhysicalJournalMutationResource } from ${JSON.stringify(moduleUrl)};
    import { inspectNoFollowDirectoryChain } from ${JSON.stringify(physicalUrl)};
    const parent = inspectNoFollowDirectoryChain(${JSON.stringify(parent.path)}).target;
    const resource = readPhysicalJournalMutationResource(parent, ${JSON.stringify(name)}, ${JSON.stringify(resourceName)});
    const lease = acquirePhysicalMutationLease(parent, ${JSON.stringify(name)}, { ...${JSON.stringify(options)}, journalResource: resource });
    if (!lease) throw new Error('Fixture direct journal was contended');
    console.log(JSON.stringify(lease.owner));
    process.exit(0);
  `], { stdout: 'pipe', stderr: 'pipe' });
  expect({ code: child.exitCode, stderr: child.stderr.toString() }).toEqual({ code: 0, stderr: '' });
  return { owner: JSON.parse(child.stdout.toString()) as PhysicalMutationLeaseOwner };
}

function acquireGuarded(parent: ReturnType<typeof inspectNoFollowDirectoryChain>['target'], name: string,
  options: Parameters<typeof acquirePhysicalMutationLease>[2] = {}) {
  return acquirePhysicalMutationLease(parent, name, { ...options,
    journalResource: readPhysicalJournalMutationResource(parent, name, 'direct-journal.json')! });
}

test('reclaimed-owner restore rejects an externally replaced lease and preserves its bytes', () => {
  const { root, parent } = fixture();
  const name = 'invocation.lease';
  try {
    const abandoned = abandonGuarded(parent, name, {
      now: () => 1_000,
      ownerHost: 'lease-test-host',
      ownerPid: 42_001,
      processNonce: '30000000-0000-4000-8000-000000000001',
      processAlive: () => 'alive'
    });
    expect(abandoned).not.toBeNull();
    const successor = acquireGuarded(parent, name, {
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
    const abandoned = abandonGuarded(parent, name, {
      now: () => 1_000,
      ownerHost: 'lease-test-host',
      ownerPid: 42_011,
      processNonce: '30000000-0000-4000-8000-000000000011',
      processAlive: () => 'alive'
    });
    expect(abandoned).not.toBeNull();
    const oldBytes = inspectNoFollowOrdinaryFileEntry(parent, name)?.bytes;
    expect(oldBytes).not.toBeNull();

    const successor = acquireGuarded(parent, name, {
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
      const first = action === 'release' ? acquirePhysicalMutationLease(parent, name, {
        ownerHost: 'lease-test-host', ownerPid: 42_041
      })! : abandonGuarded(parent, name);
      const lease = action === 'release' ? first as ReturnType<typeof acquirePhysicalMutationLease> : acquireGuarded(parent, name, {
        ownerHost: 'lease-test-host', ownerPid: 42_042, processAlive: () => 'dead'
      })!;
      const original = inspectNoFollowOrdinaryFileEntry(parent, name)!;
      const bytes = Buffer.from(original.bytes!);
      replaceLeaseBytes(parent, name, bytes);
      const replacement = inspectNoFollowOrdinaryFileEntry(parent, name)!;
      expect(replacement.inode).not.toBe(original.inode);
      expect(() => lease![action]()).toThrow('ownership changed');
      const preserved = inspectNoFollowOrdinaryFileEntry(parent, name)!;
      expect(preserved.inode).toBe(replacement.inode);
      expect(Buffer.from(preserved.bytes!)).toEqual(bytes);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('coordinator exit cannot reclaim an external lease or its surviving child resources', async () => {
  const { root, parent } = fixture();
  const leaseName = 'materialization-lease.json';
  const candidate = path.join(parent.path, 'candidate');
  mkdirSync(candidate);
  const marker = path.join(candidate, 'partial-layer');
  const stop = path.join(root, 'stop');
  const done = path.join(root, 'done');
  const childPath = path.join(root, 'survivor.ts');
  writeFileSync(childPath, `
    import { existsSync, writeFileSync } from 'node:fs';
    const deadline = Date.now() + 10000;
    let n = 0;
    while (!existsSync(${JSON.stringify(stop)}) && Date.now() < deadline) {
      writeFileSync(${JSON.stringify(marker)}, String(++n));
      await Bun.sleep(10);
    }
    writeFileSync(${JSON.stringify(done)}, 'settled');
  `);
  const leaseUrl = pathToFileURL(path.resolve(import.meta.dir, '../../src/adapters/runtime-state/physical/runtime/mutation-lease.ts')).href;
  const physicalUrl = pathToFileURL(path.resolve(import.meta.dir, '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts')).href;
  const coordinator = Bun.spawnSync([process.execPath, '--no-env-file', '-e', `
    import { acquirePhysicalMutationLease } from ${JSON.stringify(leaseUrl)};
    import { inspectNoFollowDirectoryChain } from ${JSON.stringify(physicalUrl)};
    const parent = inspectNoFollowDirectoryChain(${JSON.stringify(parent.path)}).target;
    const lease = acquirePhysicalMutationLease(parent, ${JSON.stringify(leaseName)});
    if (!lease) throw new Error('Fresh external lease was not admitted');
    Bun.spawn([process.execPath, '--no-env-file', ${JSON.stringify(childPath)}], {
      stdin: 'ignore', stdout: 'ignore', stderr: 'ignore'
    });
    console.log(JSON.stringify(lease.owner));
    process.exit(0);
  `], { stdout: 'pipe', stderr: 'pipe' });
  const waitFor = async (condition: () => boolean): Promise<void> => {
    const deadline = performance.now() + 5000;
    while (!condition()) {
      if (performance.now() >= deadline) throw new Error('Surviving child observation deadline exhausted');
      await Bun.sleep(10);
    }
  };
  try {
    expect({ code: coordinator.exitCode, stderr: coordinator.stderr.toString() }).toEqual({ code: 0, stderr: '' });
    const before = readFileSync(path.join(parent.path, leaseName));
    await waitFor(() => existsSync(marker));
    const first = readFileSync(marker, 'utf8');
    await waitFor(() => readFileSync(marker, 'utf8') !== first);
    let probes = 0;
    expect(acquirePhysicalMutationLease(parent, leaseName, { now: () => Date.now() + 60000,
      processAlive: () => { probes += 1; return 'dead'; }
    })).toBeNull();
    expect(probes).toBe(0);
    expect(readFileSync(path.join(parent.path, leaseName))).toEqual(before);
    expect(existsSync(candidate)).toBe(true);
    expect(existsSync(marker)).toBe(true);
  } finally {
    writeFileSync(stop, 'stop');
    await waitFor(() => existsSync(done));
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);

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
        import { inspectNoFollowDirectoryChain, inspectNoFollowOrdinaryFileEntry, replaceDurableCanonicalFile, createWindowsDurableCanonicalFileReplacementInterruptionActorForTests } from ${JSON.stringify(physicalUrl)};
        const parent = inspectNoFollowDirectoryChain(${JSON.stringify(parent.path)}, 'CAS child parent').target;
        const current = inspectNoFollowOrdinaryFileEntry(parent, 'owner.json');
        if (current === null) throw new Error('No preimage');
        replaceDurableCanonicalFile({ parent, name: 'owner.json', bytes: Buffer.from('new\\n'),
          expectedExisting: { device: current.device, inode: current.inode }, validate: () => undefined,
          windowsInterruptionActor: createWindowsDurableCanonicalFileReplacementInterruptionActorForTests(${JSON.stringify(point)}, () => process.exit(73)) });
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

for (const action of ['release', 'acknowledgeReclaimedRecovery', 'restoreReclaimedOwner'] as const) {
  test(`guarded ${action} identity failure closes native exclusion without deleting recovery bytes`, () => {
    const { root, parent } = fixture();
    const name = 'invocation.lease';
    try {
      abandonGuarded(parent, name);
      const lease = acquireGuarded(parent, name)!;
      if (action === 'release') lease.acknowledgeReclaimedRecovery();
      const before = readFileSync(path.join(parent.path, name));
      renameSync(path.join(parent.path, name), path.join(parent.path, 'retained-record'));
      expect(() => lease[action]()).toThrow('ownership changed');
      renameSync(path.join(parent.path, 'retained-record'), path.join(parent.path, name));
      expect(readFileSync(path.join(parent.path, name))).toEqual(before);
      const successor = acquireGuarded(parent, name);
      expect(successor).not.toBeNull();
      successor!.acknowledgeReclaimedRecovery();
      successor!.release();
      expect(() => lease.release()).not.toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}


test('terminal journal resources do not exhaust the original physical census after 129 scoped attempts', async () => {
  const { root, parent } = fixture();
  const directory = path.join(parent.path, 'journals');
  mkdirSync(directory);
  const fs = createRuntimeStateJournalFileSystem(parent);
  try {
    await withWorkspaceWriteLease(parent.path, undefined, async token => {
      for (let index = 0; index < 129; index += 1) {
        const file = path.join(directory, `${index.toString(16).padStart(64, '0')}.json`);
        const text = `terminal-${index}`;
        const create = prepareRuntimeStateJournalMutation(fs, file, 'create-absent-data')!;
        try {
          await assertWorkspaceWriteLease(parent.path, token);
          expect(create.run(() => fs.createExclusiveFsync(file, text))).toBe(true);
        } finally { create.dispose(); }
        const retire = prepareRuntimeStateJournalMutation(fs, file)!;
        try {
          await assertWorkspaceWriteLease(parent.path, token);
          retire.retire(text);
        } finally { retire.dispose(); }
        expect(scanNoFollowDirectoryDirectMetadata(inspectNoFollowDirectoryChain(directory).target, {
          deadlineAtMs: performance.now() + 1000, maximumEntries: 256
        })).toEqual([]);
        expect(() => retire.run(() => undefined)).toThrow('closed');
      }
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30000);

for (const point of ['after-retirement-fence', 'after-payload-removal', 'after-record-removal', 'after-anchor-removal'] as const) {
  test(`journal child exit ${point} cannot reopen an unclosed original generation`, async () => {
    const { root, parent } = fixture();
    const file = path.join(parent.path, 'journal.json');
    const sourceRoot = path.resolve(import.meta.dir, '../../src/adapters');
    const url = (name: string) => pathToFileURL(path.join(sourceRoot, name)).href;
    const script = path.join(root, 'retirement-child.ts');
    writeFileSync(script, `
      import { inspectNoFollowDirectoryChain } from ${JSON.stringify(url('runtime-state/physical/runtime/physical-no-follow.ts'))};
      import { createRuntimeStateJournalFileSystem, prepareRuntimeStateJournalMutation } from ${JSON.stringify(url('runtime-state/workspace-state/journal-filesystem.ts'))};
      import { createJournalRetirementInterruptionActorForTests } from ${JSON.stringify(url('runtime-state/physical/runtime/mutation-lease.ts'))};
      import { withWorkspaceWriteLease, assertWorkspaceWriteLease } from ${JSON.stringify(url('filesystem/write-lease.ts'))};
      await withWorkspaceWriteLease(${JSON.stringify(parent.path)}, undefined, async token => {
        const fs = createRuntimeStateJournalFileSystem(inspectNoFollowDirectoryChain(${JSON.stringify(parent.path)}).target);
        fs.createExclusiveFsync(${JSON.stringify(file)}, 'terminal');
        const prepared = prepareRuntimeStateJournalMutation(fs, ${JSON.stringify(file)});
        if (!prepared) throw new Error('No native retirement preparation');
        await assertWorkspaceWriteLease(${JSON.stringify(parent.path)}, token);
        prepared.retire('terminal', createJournalRetirementInterruptionActorForTests(${JSON.stringify(point)}, () => process.exit(73)));
      });
      throw new Error('Native retirement interruption was not reached');
    `);
    try {
      const child = Bun.spawnSync([process.execPath, '--no-env-file', script], {
        cwd: root, stdout: 'pipe', stderr: 'pipe'
      });
      expect({ code: child.exitCode, stderr: child.stderr.toString() }).toEqual({ code: 73, stderr: '' });
      const names = readdirSync(parent.path).filter(name => name !== '.sec');
      const before = names.map(name => readFileSync(path.join(parent.path, name)));
      let entered = false;
      await expect(withWorkspaceWriteLease(parent.path, undefined, async () => { entered = true; }))
        .rejects.toThrow();
      expect(entered).toBe(false);
      expect(readdirSync(parent.path).filter(name => name !== '.sec')).toEqual(names);
      for (let index = 0; index < names.length; index += 1) {
        expect(readFileSync(path.join(parent.path, names[index]!))).toEqual(before[index]);
      }
      if (point === 'after-anchor-removal') expect(names).toEqual([]);
      else expect(() => prepareRuntimeStateJournalMutation(createRuntimeStateJournalFileSystem(parent), file)).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 20000);
}


test('retired journal generation cannot be reopened by captured resource or writer tokens', async () => {
  const { root, parent } = fixture();
  const fs = createRuntimeStateJournalFileSystem(parent);
  const file = path.join(parent.path, 'journal.json');
  const lock = runtimeStateJournalMutationLeaseName(parent.path, file);
  let oldResource: ReturnType<typeof readPhysicalJournalMutationResource>;
  let oldToken: Parameters<typeof assertWorkspaceWriteLease>[1];
  try {
    await withWorkspaceWriteLease(parent.path, undefined, async token => {
      oldToken = token;
      fs.createExclusiveFsync(file, 'old terminal');
      oldResource = readPhysicalJournalMutationResource(parent, lock, 'journal.json');
      const retire = prepareRuntimeStateJournalMutation(fs, file)!;
      try { await assertWorkspaceWriteLease(parent.path, token); retire.retire('old terminal'); }
      finally { retire.dispose(); }
    });
    await expect(assertWorkspaceWriteLease(parent.path, oldToken!)).rejects.toThrow();
    await withWorkspaceWriteLease(parent.path, undefined, async token => {
      await assertWorkspaceWriteLease(parent.path, token);
      fs.createExclusiveFsync(file, 'new generation');
    });
    expect(() => acquirePhysicalMutationLease(parent, lock, { journalResource: oldResource! })).toThrow();
    expect(fs.readText(file)).toBe('new generation');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('cancelling prepared first creation releases exclusion and retains unresolved initialization', () => {
  const { root, parent } = fixture();
  try {
    const fs = createRuntimeStateJournalFileSystem(parent);
    const file = path.join(parent.path, 'cancelled.json');
    const prepared = prepareRuntimeStateJournalMutation(fs, file, 'create-absent-data')!;
    expect(() => prepared.dispose()).toThrow('initialization residue');
    expect(() => prepared.dispose()).not.toThrow();
    expect(() => prepareRuntimeStateJournalMutation(fs, file, 'create-absent-data')).toThrow('unresolved');
    expect(existsSync(file)).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
