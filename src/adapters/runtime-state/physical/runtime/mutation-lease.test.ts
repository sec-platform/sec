import { type ResourceSettlementFailure } from '../../../../execution/resource-settlement.ts';
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { settleResources } from '../../../../execution/resource-settlement.ts';
import { createRawTestExecutableFixture } from '../../../../../tests/testkit/raw-process.ts';

import {
  PHYSICAL_MUTATION_LEASE_SCHEMA,
  PhysicalMutationCoordinationBlockedError,
  preparePhysicalMutationCoordinationResource,
  readPhysicalMutationCoordinationResource,
  type PhysicalMutationLeaseOwner
} from './mutation-lease.ts';
import {
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  publishExclusiveDurableCanonicalFile
} from './physical-no-follow.ts';

const LEASE_NAME = '.generated-state-registration-mutation.lock';
const NAMESPACE_LEAF = 'registrations-v3';
const ANCHOR_NAME = `.sec-namespace-coordination-guard-${createHash('sha256').update(NAMESPACE_LEAF).digest('hex')}.lock`;

function exitedPid(): number {
  const executable = createRawTestExecutableFixture();
  try {
    const result = spawnSync(executable.command, ['-e', '0'], { stdio: 'ignore' });
    if (result.error !== undefined || result.status !== 0 || !Number.isSafeInteger(result.pid) || result.pid <= 0) {
      throw new Error('Failed to observe an exited helper process.', { cause: result.error });
    }
    return result.pid;
  } finally { executable.dispose(); }
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
  try {
    if (options.namespace === true) mkdirSync(path.join(root, NAMESPACE_LEAF));
    const parent = inspectNoFollowDirectoryChain(root, 'Mutation lease adoption fixture').target;
    const writeLegacy = (owner: PhysicalMutationLeaseOwner): string => {
      const bytes = `${JSON.stringify(owner)}\n`;
      writeFileSync(path.join(root, LEASE_NAME), bytes, 'utf8');
      return bytes;
    };
    return { root, parent, writeLegacy };
  } catch (error) {
    settleResources({ primary: { label: 'mutation-lease-fixture-construction', error },
      cleanup: [{ label: 'mutation-lease-fixture-root', settle: () => rmSync(root, { recursive: true, force: true }) }] });
    throw error;
  }
}

function expectBlocked(action: () => unknown, status: 'legacy-unproven' | 'unknown'): void {
  let blocked: unknown;
  try { action(); } catch (error) { blocked = error; }
  expect(blocked).toBeInstanceOf(PhysicalMutationCoordinationBlockedError);
  expect((blocked as PhysicalMutationCoordinationBlockedError).status).toBe(status);
}

test('strict read and prepare preserve a dead local legacy record and its existing namespace', () => {
  const { root, parent, writeLegacy } = fixture({ namespace: true });
  let fixtureFailure3: ResourceSettlementFailure | undefined;
  try {
    const legacy = legacyOwner();
    const legacyBytes = writeLegacy(legacy);
    const recordIdentity = inspectNoFollowOrdinaryFileEntry(parent, LEASE_NAME);
    const namespaceIdentity = inspectNoFollowDirectoryChain(path.join(root, NAMESPACE_LEAF)).target;
    writeFileSync(path.join(root, NAMESPACE_LEAF, 'sentinel'), 'original namespace payload');
    const payloadIdentity = inspectNoFollowOrdinaryFileEntry(namespaceIdentity, 'sentinel');
    expectBlocked(() => readPhysicalMutationCoordinationResource(parent, LEASE_NAME, NAMESPACE_LEAF), 'legacy-unproven');
    expectBlocked(() => preparePhysicalMutationCoordinationResource(parent, LEASE_NAME, NAMESPACE_LEAF), 'legacy-unproven');
    expect(readFileSync(path.join(root, LEASE_NAME), 'utf8')).toBe(legacyBytes);
    expect(inspectNoFollowOrdinaryFileEntry(parent, LEASE_NAME)).toEqual(recordIdentity);
    expect(inspectNoFollowDirectoryChain(path.join(root, NAMESPACE_LEAF)).target).toEqual(namespaceIdentity);
    expect(readdirSync(root).sort()).toEqual([LEASE_NAME, NAMESPACE_LEAF].sort());
    expect(readFileSync(path.join(root, NAMESPACE_LEAF, 'sentinel'), 'utf8')).toBe('original namespace payload');
    expect(readdirSync(namespaceIdentity.path)).toEqual(['sentinel']);
    expect(inspectNoFollowOrdinaryFileEntry(namespaceIdentity, 'sentinel')).toEqual(payloadIdentity);
  } catch (error) {
    fixtureFailure3 = { label: 'fixture operation', error };
  } finally {
    settleResources({
      primary: fixtureFailure3,
      cleanup: [{ label: 'fixture cleanup', settle: () => { rmSync(root, { recursive: true, force: true }); } }]
    });
  }
});

test('a legacy record without a namespace cannot authorize a namespace or anchor birth', () => {
  const { root, parent, writeLegacy } = fixture();
  let fixtureFailure2: ResourceSettlementFailure | undefined;
  try {
    const legacy = legacyOwner();
    const bytes = writeLegacy(legacy);
    const identity = inspectNoFollowOrdinaryFileEntry(parent, LEASE_NAME);
    expectBlocked(() => preparePhysicalMutationCoordinationResource(parent, LEASE_NAME, NAMESPACE_LEAF), 'legacy-unproven');
    expect(readFileSync(path.join(root, LEASE_NAME), 'utf8')).toBe(bytes);
    expect(inspectNoFollowOrdinaryFileEntry(parent, LEASE_NAME)).toEqual(identity);
    expect(readdirSync(root)).toEqual([LEASE_NAME]);
  } catch (error) {
    fixtureFailure2 = { label: 'fixture operation', error };
  } finally {
    settleResources({
      primary: fixtureFailure2,
      cleanup: [{ label: 'fixture cleanup', settle: () => { rmSync(root, { recursive: true, force: true }); } }]
    });
  }
});

test('a present legacy-shaped anchor cannot authorize an unproven legacy record', () => {
  const { root, parent, writeLegacy } = fixture({ namespace: true });
  let fixtureFailure1: ResourceSettlementFailure | undefined;
  try {
    const legacyBytes = writeLegacy(legacyOwner());
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
    const recordIdentity = inspectNoFollowOrdinaryFileEntry(parent, LEASE_NAME);
    const anchorIdentity = inspectNoFollowOrdinaryFileEntry(parent, ANCHOR_NAME);
    const namespaceIdentity = inspectNoFollowDirectoryChain(path.join(root, NAMESPACE_LEAF)).target;
    expectBlocked(() => preparePhysicalMutationCoordinationResource(parent, LEASE_NAME, NAMESPACE_LEAF), 'legacy-unproven');
    expect(readFileSync(path.join(root, LEASE_NAME), 'utf8')).toBe(legacyBytes);
    expect(readFileSync(path.join(root, ANCHOR_NAME)).equals(anchorBytes)).toBe(true);
    expect(inspectNoFollowOrdinaryFileEntry(parent, LEASE_NAME)).toEqual(recordIdentity);
    expect(inspectNoFollowOrdinaryFileEntry(parent, ANCHOR_NAME)).toEqual(anchorIdentity);
    expect(inspectNoFollowDirectoryChain(path.join(root, NAMESPACE_LEAF)).target).toEqual(namespaceIdentity);
    expect(readdirSync(root).sort()).toEqual([LEASE_NAME, NAMESPACE_LEAF, ANCHOR_NAME].sort());
  } catch (error) {
    fixtureFailure1 = { label: 'fixture operation', error };
  } finally {
    settleResources({
      primary: fixtureFailure1,
      cleanup: [{ label: 'fixture cleanup', settle: () => { rmSync(root, { recursive: true, force: true }); } }]
    });
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
