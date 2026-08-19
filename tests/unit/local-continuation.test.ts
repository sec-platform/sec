import { expect, test } from 'bun:test';

import {
  admitLocalContinuationV1,
  createLocalContinuationCheckpointV1,
  parseLocalContinuationCheckpointV1,
  type LocalContinuationObservationV1
} from '../../platform/shared/local-continuation-checkpoint.ts';
import { encodeVerificationActionDataV2 } from '../../platform/shared/verification-action-contract.ts';

const BASE = '1'.repeat(40);
const BASE_TREE = '2'.repeat(40);
const HEAD = '3'.repeat(40);
const HEAD_TREE = '4'.repeat(40);
const MANIFEST = `sha256:${'a'.repeat(64)}` as const;

function checkpoint() {
  return createLocalContinuationCheckpointV1({
    repository: 'sec-platform/sec',
    prNumber: 496,
    branch: 'integration/sec-static-convergence-20260818',
    baseSha: BASE,
    baseTreeSha: BASE_TREE,
    headSha: HEAD,
    headTreeSha: HEAD_TREE,
    manifestPath: 'docs/work-packages/sec-static-convergence-v1.md'
  });
}

function observation(): LocalContinuationObservationV1 {
  return Object.freeze({
    repositoryRoot: '/repo',
    branch: 'integration/sec-static-convergence-20260818',
    headSha: HEAD,
    headTreeSha: HEAD_TREE,
    parentShas: Object.freeze([BASE]),
    baseTreeSha: BASE_TREE,
    worktreeClean: true,
    manifestPath: 'docs/work-packages/sec-static-convergence-v1.md',
    manifestDigest: MANIFEST,
    workPackageId: 'sec-static-convergence-v1',
    tracking: 'issue-311',
    manifestBaseSha: BASE,
    requiredProfile: 'full',
    ciRevision: 'ci-verification-v19',
    changedPathCount: 304,
    ownershipChecked: true
  });
}

test('checkpoint carries only irreducible remote/frozen facts and admission derives Work Package header', () => {
  const frozen = checkpoint();
  expect(Object.keys(frozen).sort()).toEqual([
    'baseSha', 'baseTreeSha', 'branch', 'checkpointDigest', 'headSha', 'headTreeSha',
    'manifestPath', 'prNumber', 'repository', 'schema'
  ]);
  expect(parseLocalContinuationCheckpointV1(encodeVerificationActionDataV2(frozen))).toEqual(frozen);
  const admitted = admitLocalContinuationV1({ checkpoint: frozen, observation: observation() });
  expect(admitted).toMatchObject({
    status: 'admitted',
    authority: 'context-compression-only',
    repository: 'sec-platform/sec',
    prNumber: 496,
    branch: 'integration/sec-static-convergence-20260818',
    baseSha: BASE,
    baseTreeSha: BASE_TREE,
    headSha: HEAD,
    headTreeSha: HEAD_TREE,
    manifestPath: 'docs/work-packages/sec-static-convergence-v1.md',
    manifestDigest: MANIFEST,
    workPackageId: 'sec-static-convergence-v1',
    tracking: 'issue-311',
    requiredProfile: 'full',
    ciRevision: 'ci-verification-v19',
    changedPathCount: 304,
    remoteRefreshDisposition: 'not-required-by-local-invalidation',
    nextAuthorityBoundary: 'trusted-base-physical-verification'
  });
  expect(admitted.admissionDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
});

test('checkpoint tamper and local identity/scope admission drift fail closed', () => {
  const frozen = checkpoint();
  const serialized = JSON.parse(encodeVerificationActionDataV2(frozen)) as Record<string, unknown>;
  serialized.headSha = '5'.repeat(40);
  expect(() => parseLocalContinuationCheckpointV1(JSON.stringify(serialized)))
    .toThrow('checkpoint digest mismatch');

  const driftCases: Array<Partial<LocalContinuationObservationV1>> = [
    { branch: 'other' },
    { headSha: '5'.repeat(40) },
    { headTreeSha: '6'.repeat(40) },
    { baseTreeSha: '7'.repeat(40) },
    { parentShas: Object.freeze(['8'.repeat(40)]) },
    { worktreeClean: false },
    { manifestPath: 'docs/work-packages/other.md' },
    { manifestBaseSha: '9'.repeat(40) },
    { changedPathCount: 0 }
  ];
  for (const patch of driftCases) {
    expect(() => admitLocalContinuationV1({
      checkpoint: frozen,
      observation: Object.freeze({ ...observation(), ...patch })
    })).toThrow();
  }
});

test('checkpoint rejects invalid branch names and inactive same-base head', () => {
  for (const invalidBranch of ['@', '.hidden', 'refs//double', 'topic.lock', 'topic@{x}', 'topic..x']) {
    expect(() => createLocalContinuationCheckpointV1({
      ...checkpoint(),
      branch: invalidBranch,
      checkpointDigest: undefined
    } as never)).toThrow('branch');
  }
  expect(() => createLocalContinuationCheckpointV1({
    ...checkpoint(),
    headSha: BASE,
    checkpointDigest: undefined
  } as never)).toThrow('headSha must differ from baseSha');
});

test('admission requires one-parent child of the frozen base', () => {
  expect(() => admitLocalContinuationV1({
    checkpoint: checkpoint(),
    observation: Object.freeze({ ...observation(), parentShas: Object.freeze([BASE, '9'.repeat(40)]) })
  })).toThrow('one-parent child');
  expect(() => admitLocalContinuationV1({
    checkpoint: checkpoint(),
    observation: Object.freeze({ ...observation(), parentShas: Object.freeze(['9'.repeat(40)]) })
  })).toThrow('one-parent child');
});
