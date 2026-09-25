import { expect, test } from 'bun:test';


import {
  WORKTREE_PHYSICAL_CLOSEOUT_AUTHORIZATION_SCHEMA,
  assertStableWorktreePhysicalWorkingState,
  assertWorktreePhysicalCloseoutAuthorization,
  assertWorktreePhysicalCloseoutReceipt,
  classifyAuthorizedWorktreeResidue,
  createWorktreePhysicalCloseoutAuthorization,
  createWorktreePhysicalCloseoutReceipt,
  createWorktreePhysicalInventory,
  detailDigest,
  isFieldlessLegacyWorktreePhysicalCloseoutAuthorization,
  parseGitWorktreeAdminLocator,
  parseGitWorktreeAdminPath,
  parseWorktreePorcelainZ,
  parseWorktreeStatusPorcelainZ,
  type WorktreePhysicalEntry
} from '../../src/adapters/runtime-state/worktree-closeout-contract.ts';
import { sha256 } from '../../src/contracts/canonical.ts';

const HEAD = '1'.repeat(40);
const TREE = '2'.repeat(40);

test('linked-worktree control path files are strict bounded single-line machine records', () => {
  expect(parseGitWorktreeAdminLocator(
    Buffer.from('gitdir: ../repository/.git/worktrees/candidate\n')
  )).toBe('../repository/.git/worktrees/candidate');
  expect(parseGitWorktreeAdminPath(Buffer.from('../..\r\n'), 'commondir'))
    .toBe('../..');
  expect(parseGitWorktreeAdminPath(
    Buffer.from('D:/repository-candidate/.git\n'),
    'gitdir back-reference'
  )).toBe('D:/repository-candidate/.git');
  for (const invalid of [
    '',
    'gitdir: ',
    'gitdir: one\nsecond\n',
    'gitdir: one\rsecond',
    'gitdir: one\0second'
  ]) {
    expect(() => parseGitWorktreeAdminLocator(Buffer.from(invalid)))
      .toThrow('Worktree physical closeout contract');
  }
  expect(() => parseGitWorktreeAdminLocator(Uint8Array.from([
    ...Buffer.from('gitdir: ', 'utf8'),
    0xff
  ])))
    .toThrow('invalid UTF-8');
});

function entry(overrides: Partial<WorktreePhysicalEntry> = {}): WorktreePhysicalEntry {
  return {
    relativePath: 'tracked.txt',
    kind: 'file',
    device: '7',
    inode: '11',
    size: 7,
    contentDigest: detailDigest('tracked'),
    linkTarget: null,
    ...overrides
  };
}

function authorization(proofLeaf = 'sec-worktree-closeout-proof-0000000000000000000000000000000000000000000000000000000000000000') {
  const inventory = createWorktreePhysicalInventory([
    entry({ relativePath: '.git', inode: '12', contentDigest: detailDigest('gitdir') }),
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
  return createWorktreePhysicalCloseoutAuthorization({
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
      recoveryAuthorityDigest: detailDigest('recovery')
    },
    registryAdmin: {
      relativePath: 'worktrees/codex-fixture',
      tombstoneName: 'worktree-admin-closeout-0000000000000000000000000000000000000000000000000000000000000000',
      device: 'dev-admin',
      inode: 'ino-admin',
      inventory: createWorktreePhysicalInventory([])
    },
    targetLeaseNamespace: { device: '7', inode: 'lease-namespace' },
    proofRoot: { path: `/repo-parent/${proofLeaf}`, device: '7', inode: `proof-${proofLeaf.slice(-4)}` },
    registryBeforeDigest: detailDigest('registry-before'),
    workingStateDigest: detailDigest('clean'),
    generatedStateRetirement: null,
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
  expect(assertWorktreePhysicalCloseoutAuthorization(finalized)).toEqual(finalized);
});

test('working-state readback drift is a pure pre-effect rejection ordered before authorization publication', () => {
  const clean = detailDigest('clean-working-state');
  expect(() => assertStableWorktreePhysicalWorkingState(clean, {
    digest: clean,
    blocker: 'working-state-not-clean'
  })).toThrow('working-state-not-clean');
  expect(() => assertStableWorktreePhysicalWorkingState(clean, {
    digest: detailDigest('changed-working-state'),
    blocker: null
  })).toThrow('working-state-changed-during-authorization');
  expect(() => assertStableWorktreePhysicalWorkingState(clean, {
    digest: clean,
    blocker: null
  })).not.toThrow();
});

test('strict porcelain-z parser accepts canonical records and retains provider flags', () => {
  const source = Buffer.from(
    [
      `worktree C:/repo\0HEAD ${HEAD}\0branch refs/heads/main\0\0`,
      `worktree C:/candidate\0HEAD ${'3'.repeat(40)}\0detached\0locked reason\0prunable stale\0\0`
    ].join(''),
    'utf8'
  );
  expect(parseWorktreePorcelainZ(source)).toEqual([
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
  expect(() => parseWorktreePorcelainZ(Buffer.from(`worktree /repo\0HEAD ${HEAD}`))).toThrow('must end with NUL');
  expect(() => parseWorktreePorcelainZ(Buffer.from(`worktree /repo\0HEAD ${HEAD}\0branch refs/heads/main\0future value\0\0`))).toThrow(
    'unsupported porcelain field'
  );
  expect(() => parseWorktreePorcelainZ(Buffer.from(`worktree /repo\0HEAD ${HEAD}\0HEAD ${HEAD}\0branch refs/heads/main\0\0`))).toThrow(
    'duplicate HEAD'
  );
  expect(() => parseWorktreePorcelainZ(Buffer.from(`worktree /repo\0HEAD ${HEAD}\0branch refs/heads/main\0detached\0\0`))).toThrow(
    'conflicting detached'
  );
  expect(() =>
    parseWorktreePorcelainZ(
      Buffer.from([...Buffer.from(`worktree /repo-`, 'utf8'), 0xff, 0, ...Buffer.from(`HEAD ${HEAD}\0branch refs/heads/main\0\0`, 'utf8')])
    )
  ).toThrow('invalid UTF-8');
  expect(() => parseWorktreePorcelainZ(Buffer.from(`worktree /repo\0HEAD ${HEAD}\0branch refs/heads/main\0\0\0`))).toThrow(
    'unexpected empty porcelain field'
  );
  expect(() =>
    parseWorktreePorcelainZ(
      Buffer.from(`worktree /repo\0HEAD ${HEAD}\0branch refs/heads/main\0\0worktree /repo\0HEAD ${HEAD}\0branch refs/heads/other\0\0`)
    )
  ).toThrow('duplicate worktree path');
});

test('strict status porcelain-z parser preserves ignored and rename identities without presentation parsing', () => {
  expect(parseWorktreeStatusPorcelainZ(Buffer.from('!! .ignored-cache/\0R  renamed.ts\0original.ts\0?? note.txt\0', 'utf8'))).toEqual([
    { index: '!', worktree: '!', path: '.ignored-cache', originalPath: null },
    { index: 'R', worktree: ' ', path: 'renamed.ts', originalPath: 'original.ts' },
    { index: '?', worktree: '?', path: 'note.txt', originalPath: null }
  ]);
  expect(() => parseWorktreeStatusPorcelainZ(Buffer.from('!! cache'))).toThrow('must end with NUL');
  expect(() => parseWorktreeStatusPorcelainZ(Buffer.from([0xff, 0x00]))).toThrow('invalid UTF-8');
});

test('authorization binds exact repository target inventory and durable recovery paths', () => {
  const value = authorization();
  expect(value.schema).toBe(WORKTREE_PHYSICAL_CLOSEOUT_AUTHORIZATION_SCHEMA);
  expect(value.operationId).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(value.authorizationDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(assertWorktreePhysicalCloseoutAuthorization(value)).toBe(value);
  const tampered = {
    ...structuredClone(value),
    target: { ...value.target, headSha: '9'.repeat(40) }
  };
  expect(() => assertWorktreePhysicalCloseoutAuthorization(tampered)).toThrow('canonical content mismatch');
});

test('fieldless historical authorization is validated exactly and normalized only in memory', () => {
  const current = authorization();
  const {
    schema: ignoredSchema,
    operationId: ignoredOperationId,
    authorizationDigest: ignoredAuthorizationDigest,
    generatedStateRetirement: ignoredGeneratedStateRetirement,
    ...body
  } = current;
  const operationId = sha256({
    repository: body.repository,
    target: body.target,
    registryBeforeDigest: body.registryBeforeDigest,
    workingStateDigest: body.workingStateDigest,
    inventoryDigest: body.inventory.inventoryDigest,
    registryAdmin: {
      relativePath: body.registryAdmin.relativePath,
      device: body.registryAdmin.device,
      inode: body.registryAdmin.inode,
      inventoryDigest: body.registryAdmin.inventory.inventoryDigest
    },
    targetLeaseNamespace: body.targetLeaseNamespace
  });
  const material = {
    schema: WORKTREE_PHYSICAL_CLOSEOUT_AUTHORIZATION_SCHEMA,
    operationId,
    ...body
  };
  const legacy = {
    ...material,
    authorizationDigest: sha256(material) as `sha256:${string}`
  };

  const normalized = assertWorktreePhysicalCloseoutAuthorization(legacy as never);
  expect(normalized.schema).toBe(WORKTREE_PHYSICAL_CLOSEOUT_AUTHORIZATION_SCHEMA);
  expect(normalized.generatedStateRetirement).toBeNull();
  expect(isFieldlessLegacyWorktreePhysicalCloseoutAuthorization(normalized)).toBeTrue();
  expect(Object.prototype.hasOwnProperty.call(legacy, 'generatedStateRetirement')).toBeFalse();
  expect(() => assertWorktreePhysicalCloseoutAuthorization({
    ...legacy,
    operationId: detailDigest('wrong-legacy-operation')
  } as never)).toThrow('canonical content mismatch');
});

test('field-bearing authorization keeps the field-aware operation identity without a second schema', () => {
  const current = authorization();
  const { authorizationDigest: ignoredAuthorizationDigest, ...body } = current;
  const material = {
    ...body,
    schema: WORKTREE_PHYSICAL_CLOSEOUT_AUTHORIZATION_SCHEMA
  };
  const legacy = {
    ...material,
    authorizationDigest: sha256(material) as `sha256:${string}`
  };
  const parsed = assertWorktreePhysicalCloseoutAuthorization(legacy);
  expect(parsed).toEqual(legacy);
  expect(parsed.operationId).toBe(current.operationId);
  expect(parsed.generatedStateRetirement).toBeNull();
  expect(isFieldlessLegacyWorktreePhysicalCloseoutAuthorization(parsed)).toBeFalse();
});

test('authorized residue admits only unchanged subsets and rejects new or replaced entries', () => {
  const expected = authorization().inventory;
  const unchangedSubset = createWorktreePhysicalInventory(
    expected.entries.filter(({ relativePath }) => relativePath === 'folder' || relativePath === 'folder/nested.txt')
  );
  expect(classifyAuthorizedWorktreeResidue(unchangedSubset, expected)).toEqual([]);

  const unknown = createWorktreePhysicalInventory([
    ...unchangedSubset.entries,
    entry({ relativePath: 'appeared-after-authorization.txt', inode: '91' })
  ]);
  expect(classifyAuthorizedWorktreeResidue(unknown, expected)).toEqual(['unknown-residue:appeared-after-authorization.txt']);

  const replaced = createWorktreePhysicalInventory([entry({ relativePath: 'tracked.txt', inode: '99' })]);
  expect(classifyAuthorizedWorktreeResidue(replaced, expected)).toEqual(['changed-residue:tracked.txt']);
});

test('completed receipt requires simultaneous registry and physical absence and is digest-bound', () => {
  const auth = authorization();
  const receipt = createWorktreePhysicalCloseoutReceipt({
    operationId: auth.operationId,
    authorizationDigest: auth.authorizationDigest,
    repository: auth.repository,
    target: auth.target,
    registryBeforeDigest: auth.registryBeforeDigest,
    registryAfterDigest: detailDigest('registry-after'),
    workingStateDigest: auth.workingStateDigest,
    inventoryBeforeDigest: auth.inventory.inventoryDigest,
    inventoryAfterDigest: null,
    previousReceiptDigest: null,
    attempts: [
      {
        operation: 'readback',
        status: 'success',
        relativePath: null,
        detailDigest: detailDigest('absent')
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
  expect(assertWorktreePhysicalCloseoutReceipt(receipt)).toBe(receipt);
  const tampered = {
    ...structuredClone(receipt),
    readback: { ...receipt.readback, physicalPresent: true }
  };
  expect(() => assertWorktreePhysicalCloseoutReceipt(tampered)).toThrow('receipt terminal must be derived');
});
