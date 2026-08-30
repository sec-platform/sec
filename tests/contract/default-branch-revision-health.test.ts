import { expect, test } from 'bun:test';

import {
  createMainHealthLedger,
  createMainHealthRepairWorkPackagePath
} from '../../src/control/main-health/contract.ts';
import { resolveDefaultBranchRevisionHealthV1 } from '../../src/control/main-health/default-branch-revision.ts';

const SHA = '1'.repeat(40);
const TREE = '2'.repeat(40);
const DIGEST = `sha256:${'a'.repeat(64)}` as const;

function healthy() {
  return createMainHealthLedger({
    repository: 'sec-platform/sec', defaultBranch: 'main', mainSha: SHA, mainTreeSha: TREE,
    status: 'healthy', failureFingerprints: [], owner: null, repairWorkPackage: null,
    observedAt: '2026-08-09T00:00:00.000Z', expiresAt: '2026-08-09T01:00:00.000Z',
    allowedLanes: ['ordinary'], trustRevision: SHA,
    producer: { identity: 'main-health-runtime', trustRevision: SHA, sourceTransport: 'github-api',
      sourceRunId: 'run-1', sourceRef: 'refs/heads/main', sourceDigest: DIGEST }
  });
}

function degraded() {
  const owner = 'default-branch-health-maintainer';
  return createMainHealthLedger({
    repository: 'sec-platform/sec', defaultBranch: 'main', mainSha: SHA, mainTreeSha: TREE,
    status: 'degraded', failureFingerprints: [DIGEST], owner,
    repairWorkPackage: createMainHealthRepairWorkPackagePath({ repository: 'sec-platform/sec',
      defaultBranch: 'main', mainSha: SHA, mainTreeSha: TREE, owner, failureFingerprints: [DIGEST] }),
    observedAt: '2026-08-09T00:00:00.000Z', expiresAt: '2026-08-09T01:00:00.000Z',
    allowedLanes: ['repair'], trustRevision: SHA,
    producer: { identity: 'main-health-runtime', trustRevision: SHA, sourceTransport: 'github-api',
      sourceRunId: 'run-1', sourceRef: 'refs/heads/main', sourceDigest: DIGEST }
  });
}

test('live exact-main health selects ordinary routing eligibility', () => {
  const result = resolveDefaultBranchRevisionHealthV1({ ledger: healthy(),
    now: '2026-08-09T00:30:00.000Z', repository: 'sec-platform/sec', defaultBranch: 'main',
    mainSha: SHA, mainTreeSha: TREE, trustRevision: SHA });
  expect(result.allowed).toBe(true);
  expect(result.status).toBe('healthy');
});

test('ordinary default-branch projection cannot consume the separately owned repair lane', () => {
  const result = resolveDefaultBranchRevisionHealthV1({
    ledger: degraded(), lane: 'repair',
    now: '2026-08-09T00:30:00.000Z', repository: 'sec-platform/sec', defaultBranch: 'main',
    mainSha: SHA, mainTreeSha: TREE, trustRevision: SHA
  } as unknown as Parameters<typeof resolveDefaultBranchRevisionHealthV1>[0]);
  expect(result).toMatchObject({ allowed: false, status: 'locked' });
  expect(result.reason).toContain('ordinary lane is not eligible');
});

test('missing, malformed, expired, or revision-drifted health locks fail closed', () => {
  for (const [ledger, now, mainSha] of [
    [null, '2026-08-09T00:30:00.000Z', SHA],
    [{ schema: 'unknown' }, '2026-08-09T00:30:00.000Z', SHA],
    [healthy(), '2026-08-09T02:00:00.000Z', SHA],
    [healthy(), '2026-08-09T00:30:00.000Z', '3'.repeat(40)]
  ] as const) {
    const result = resolveDefaultBranchRevisionHealthV1({ ledger, now,
      repository: 'sec-platform/sec', defaultBranch: 'main',
      mainSha, mainTreeSha: TREE, trustRevision: SHA });
    expect(result.allowed).toBe(false);
    expect(result.status).toBe('locked');
  }
});

test('cross-repository or cross-branch MainHealth is locked', () => {
  for (const identity of [
    { repository: 'attacker/fork', defaultBranch: 'main' },
    { repository: 'sec-platform/sec', defaultBranch: 'release' }
  ]) {
    const result = resolveDefaultBranchRevisionHealthV1({ ledger: healthy(),
      now: '2026-08-09T00:30:00.000Z', ...identity,
      mainSha: SHA, mainTreeSha: TREE, trustRevision: SHA });
    expect(result).toMatchObject({ allowed: false, status: 'locked' });
  }
});
