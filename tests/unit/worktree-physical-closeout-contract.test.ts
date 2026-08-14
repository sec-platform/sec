import { readFileSync } from 'node:fs';

import { expect, test } from 'bun:test';

import {
  assertStableWorktreePhysicalWorkingStateV1,
  assertWorktreePhysicalCloseoutAuthorizationV1,
  assertWorktreePhysicalCloseoutReceiptV1,
  classifyAuthorizedWorktreeResidueV1,
  createWorktreePhysicalCloseoutAuthorizationV1,
  createWorktreePhysicalCloseoutReceiptV1,
  createWorktreePhysicalInventoryV1,
  detailDigestV1,
  parseWorktreePorcelainZV1,
  type WorktreePhysicalEntryV1
} from '../../scripts/codex/worktree-physical-closeout-contract.ts';

const HEAD = '1'.repeat(40);
const TREE = '2'.repeat(40);

function entry(overrides: Partial<WorktreePhysicalEntryV1> = {}): WorktreePhysicalEntryV1 {
  return {
    relativePath: 'tracked.txt',
    kind: 'file',
    device: '7',
    inode: '11',
    size: 7,
    contentDigest: detailDigestV1('tracked'),
    linkTarget: null,
    ...overrides
  };
}

function authorization(proofLeaf = 'sec-worktree-closeout-proof-0000000000000000000000000000000000000000000000000000000000000000') {
  const inventory = createWorktreePhysicalInventoryV1([
    entry({ relativePath: '.git', inode: '12', contentDigest: detailDigestV1('gitdir') }),
    entry(),
    entry({
      relativePath: 'folder',
      kind: 'directory',
      inode: '13',
      size: 0,
      contentDigest: null
    }),
    entry({ relativePath: 'folder/nested.txt', inode: '14' })
  ]);
  return createWorktreePhysicalCloseoutAuthorizationV1({
    repository: {
      root: '/repo',
      rootDevice: '7',
      rootInode: '1',
      commonDir: '/repo/.git',
      commonDirDevice: '7',
      commonDirInode: '2'
    },
    target: {
      path: '/repo-worktree',
      device: '7',
      inode: '10',
      branch: 'codex/example',
      headSha: HEAD,
      treeSha: TREE,
      recoveryAuthorityDigest: detailDigestV1('recovery')
    },
    registryAdmin: {
      relativePath: 'worktrees/codex-fixture',
      tombstoneName: 'worktree-admin-closeout-0000000000000000000000000000000000000000000000000000000000000000',
      device: 'dev-admin',
      inode: 'ino-admin',
      inventory: createWorktreePhysicalInventoryV1([])
    },
    targetLeaseNamespace: { device: '7', inode: 'lease-namespace' },
    proofRoot: { path: `/repo-parent/${proofLeaf}`, device: '7', inode: `proof-${proofLeaf.slice(-4)}` },
    registryBeforeDigest: detailDigestV1('registry-before'),
    workingStateDigest: detailDigestV1('clean'),
    inventory,
    tombstoneName: 'worktree-closeout-tombstone-0000000000000000000000000000000000000000000000000000000000000000',
    authorizationPath: '/repo/.git/sec-worktree-closeout/operation/authorization.json',
    receiptPath: '/repo/.git/sec-worktree-closeout/operation/receipt-latest.json'
  });
}

test('proof-root binding is authorization-digest-bound without operation-id circularity', () => {
  const provisional = authorization('sec-worktree-closeout-proof-0000000000000000000000000000000000000000000000000000000000000000');
  const finalized = authorization(`sec-worktree-closeout-proof-${provisional.operationId.slice('sha256:'.length)}`);
  expect(finalized.operationId).toBe(provisional.operationId);
  expect(finalized.authorizationDigest).not.toBe(provisional.authorizationDigest);
  expect(assertWorktreePhysicalCloseoutAuthorizationV1(finalized)).toEqual(finalized);
});

test('working-state readback drift is a pure pre-effect rejection ordered before authorization publication', () => {
  const clean = detailDigestV1('clean-working-state');
  expect(() => assertStableWorktreePhysicalWorkingStateV1(clean, {
    digest: clean,
    blocker: 'working-state-not-clean'
  })).toThrow('working-state-not-clean');
  expect(() => assertStableWorktreePhysicalWorkingStateV1(clean, {
    digest: detailDigestV1('changed-working-state'),
    blocker: null
  })).toThrow('working-state-changed-during-authorization');
  expect(() => assertStableWorktreePhysicalWorkingStateV1(clean, {
    digest: clean,
    blocker: null
  })).not.toThrow();

  const engine = readFileSync('scripts/codex/worktree-physical-closeout.ts', 'utf8');
  const readback = engine.indexOf('const workingReadback = await observeWorkingState(');
  const stableFence = engine.indexOf('assertStableWorktreePhysicalWorkingStateV1(working.digest, workingReadback);', readback);
  const recoveryEffect = engine.indexOf('const recoveryRoot = createNoFollowDirectoryChainV1(', readback);
  const authorizationEffect = engine.indexOf("persistCanonical(recoveryRoot, 'authorization.json', authorization);", readback);
  expect(readback).toBeGreaterThanOrEqual(0);
  expect(stableFence).toBeGreaterThan(readback);
  expect(recoveryEffect).toBeGreaterThan(stableFence);
  expect(authorizationEffect).toBeGreaterThan(recoveryEffect);
});

test('strict porcelain-z parser accepts canonical records and retains provider flags', () => {
  const source = Buffer.from(
    [
      `worktree C:/repo\0HEAD ${HEAD}\0branch refs/heads/main\0\0`,
      `worktree C:/candidate\0HEAD ${'3'.repeat(40)}\0detached\0locked reason\0prunable stale\0\0`
    ].join(''),
    'utf8'
  );
  expect(parseWorktreePorcelainZV1(source)).toEqual([
    {
      path: 'C:/repo',
      headSha: HEAD,
      branch: 'main',
      detached: false,
      bare: false,
      locked: false,
      prunable: false
    },
    {
      path: 'C:/candidate',
      headSha: '3'.repeat(40),
      branch: null,
      detached: true,
      bare: false,
      locked: true,
      prunable: true
    }
  ]);
});

test('strict porcelain-z parser rejects truncation unknown duplicate and conflicting fields', () => {
  expect(() => parseWorktreePorcelainZV1(Buffer.from(`worktree /repo\0HEAD ${HEAD}`))).toThrow('must end with NUL');
  expect(() => parseWorktreePorcelainZV1(Buffer.from(`worktree /repo\0HEAD ${HEAD}\0branch refs/heads/main\0future value\0\0`))).toThrow(
    'unsupported porcelain field'
  );
  expect(() => parseWorktreePorcelainZV1(Buffer.from(`worktree /repo\0HEAD ${HEAD}\0HEAD ${HEAD}\0branch refs/heads/main\0\0`))).toThrow(
    'duplicate HEAD'
  );
  expect(() => parseWorktreePorcelainZV1(Buffer.from(`worktree /repo\0HEAD ${HEAD}\0branch refs/heads/main\0detached\0\0`))).toThrow(
    'conflicting detached'
  );
  expect(() =>
    parseWorktreePorcelainZV1(
      Buffer.from([...Buffer.from(`worktree /repo-`, 'utf8'), 0xff, 0, ...Buffer.from(`HEAD ${HEAD}\0branch refs/heads/main\0\0`, 'utf8')])
    )
  ).toThrow('invalid UTF-8');
  expect(() => parseWorktreePorcelainZV1(Buffer.from(`worktree /repo\0HEAD ${HEAD}\0branch refs/heads/main\0\0\0`))).toThrow(
    'unexpected empty porcelain field'
  );
  expect(() =>
    parseWorktreePorcelainZV1(
      Buffer.from(`worktree /repo\0HEAD ${HEAD}\0branch refs/heads/main\0\0worktree /repo\0HEAD ${HEAD}\0branch refs/heads/other\0\0`)
    )
  ).toThrow('duplicate worktree path');
});

test('authorization binds exact repository target inventory and durable recovery paths', () => {
  const value = authorization();
  expect(value.operationId).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(value.authorizationDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(assertWorktreePhysicalCloseoutAuthorizationV1(value)).toBe(value);
  const tampered = {
    ...structuredClone(value),
    target: { ...value.target, headSha: '9'.repeat(40) }
  };
  expect(() => assertWorktreePhysicalCloseoutAuthorizationV1(tampered)).toThrow('canonical content mismatch');
});

test('authorized residue admits only unchanged subsets and rejects new or replaced entries', () => {
  const expected = authorization().inventory;
  const unchangedSubset = createWorktreePhysicalInventoryV1(
    expected.entries.filter(({ relativePath }) => relativePath === 'folder' || relativePath === 'folder/nested.txt')
  );
  expect(classifyAuthorizedWorktreeResidueV1(unchangedSubset, expected)).toEqual([]);

  const unknown = createWorktreePhysicalInventoryV1([
    ...unchangedSubset.entries,
    entry({ relativePath: 'appeared-after-authorization.txt', inode: '91' })
  ]);
  expect(classifyAuthorizedWorktreeResidueV1(unknown, expected)).toEqual(['unknown-residue:appeared-after-authorization.txt']);

  const replaced = createWorktreePhysicalInventoryV1([entry({ relativePath: 'tracked.txt', inode: '99' })]);
  expect(classifyAuthorizedWorktreeResidueV1(replaced, expected)).toEqual(['changed-residue:tracked.txt']);
});

test('completed receipt requires simultaneous registry and physical absence and is digest-bound', () => {
  const auth = authorization();
  const receipt = createWorktreePhysicalCloseoutReceiptV1({
    operationId: auth.operationId,
    authorizationDigest: auth.authorizationDigest,
    repository: auth.repository,
    target: auth.target,
    registryBeforeDigest: auth.registryBeforeDigest,
    registryAfterDigest: detailDigestV1('registry-after'),
    workingStateDigest: auth.workingStateDigest,
    inventoryBeforeDigest: auth.inventory.inventoryDigest,
    inventoryAfterDigest: null,
    previousReceiptDigest: null,
    attempts: [
      {
        operation: 'readback',
        status: 'success',
        relativePath: null,
        detailDigest: detailDigestV1('absent')
      }
    ],
    readback: {
      registryPresent: false,
      physicalPresent: false,
      authorizationValid: true
    },
    terminal: 'completed',
    blockers: []
  });
  expect(assertWorktreePhysicalCloseoutReceiptV1(receipt)).toBe(receipt);
  const tampered = {
    ...structuredClone(receipt),
    readback: { ...receipt.readback, physicalPresent: true }
  };
  expect(() => assertWorktreePhysicalCloseoutReceiptV1(tampered)).toThrow('receipt terminal must be derived');
});
