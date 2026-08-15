import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  acquireTestWorkspaceSupervisorChallengeServerV1,
  bindTestWorkspaceSupervisorLeaseIssuerProjectionV1,
  bindTestWorkspaceSupervisorLeaseV1,
  createTestWorkspaceRunChildAssignmentV1,
  createTestWorkspaceSupervisorLeaseV1,
  deriveTestWorkspaceRunNamespaceV1,
  getTestWorkspaceTemplateRoot,
  getTestWorkspaceTempRoot,
  parseTestWorkspaceRunChildAssignmentV1,
  prepareTestWorkspaceRunV1,
  resolveTestWorkspaceNamespace,
  resolveTestWorkspaceRunChild,
  settlePreparedTestWorkspaceRunV1,
  TEST_WORKSPACE_NAMESPACE_ENV,
  TEST_WORKSPACE_RUN_CHILD_ENV,
  testWorkspaceCleanupModeForPlatformV1,
  testWorkspaceSupervisorLeasePathV1
} from '../../platform/dev-runner/env-manager.ts';
import { compilerRoot } from '../../platform/shared/paths.ts';
import { inspectNoFollowDirectoryChainV1 } from '../../platform/shared/physical-no-follow.ts';

test('test workspace roots honor a safe CI lane namespace', () => {
  const defaultRoot = path.join(compilerRoot, '.tmp', 'test-workspaces');

  expect(getTestWorkspaceTempRoot({})).toBe(defaultRoot);
  expect(getTestWorkspaceTempRoot({
    SEC_TEST_WORKSPACE_NAMESPACE: 'pr-risk-slow-suite-e2e-artifacts'
  })).toBe(path.join(defaultRoot, 'pr-risk-slow-suite-e2e-artifacts'));
  expect(getTestWorkspaceTempRoot({
    [TEST_WORKSPACE_NAMESPACE_ENV]: 'verification-gate',
    [TEST_WORKSPACE_RUN_CHILD_ENV]: `fast-${'a'.repeat(64)}`
  })).toBe(path.join(defaultRoot, 'verification-gate', `fast-${'a'.repeat(64)}`));
  expect(getTestWorkspaceTemplateRoot()).toBe(path.join(defaultRoot, '.templates'));
});

test('test workspace namespace rejects path traversal and nested paths', () => {
  expect(() => resolveTestWorkspaceNamespace({ SEC_TEST_WORKSPACE_NAMESPACE: '..' })).toThrow(
    'SEC_TEST_WORKSPACE_NAMESPACE must be a bounded safe single path segment'
  );
  expect(() => resolveTestWorkspaceNamespace({ SEC_TEST_WORKSPACE_NAMESPACE: '../outside' })).toThrow(
    'SEC_TEST_WORKSPACE_NAMESPACE must be a bounded safe single path segment'
  );
  expect(() => resolveTestWorkspaceNamespace({ SEC_TEST_WORKSPACE_NAMESPACE: 'risk/artifacts' })).toThrow(
    'SEC_TEST_WORKSPACE_NAMESPACE must be a bounded safe single path segment'
  );
  expect(() => resolveTestWorkspaceNamespace({ SEC_TEST_WORKSPACE_NAMESPACE: 'x'.repeat(129) })).toThrow(
    'SEC_TEST_WORKSPACE_NAMESPACE must be a bounded safe single path segment'
  );
  expect(() => resolveTestWorkspaceRunChild({
    [TEST_WORKSPACE_RUN_CHILD_ENV]: 'caller-selected-child'
  })).toThrow('SEC_TEST_WORKSPACE_RUN_CHILD must be an exact run-owned child segment');
  expect(() => getTestWorkspaceTempRoot({
    [TEST_WORKSPACE_RUN_CHILD_ENV]: `fast-${'b'.repeat(64)}`
  })).toThrow('SEC_TEST_WORKSPACE_RUN_CHILD requires SEC_TEST_WORKSPACE_NAMESPACE');
});

test('platform cleanup capability preserves ordinary Darwin fast tests without claiming retained Gate authority', () => {
  expect(testWorkspaceCleanupModeForPlatformV1('win32', false)).toBe('retained');
  expect(testWorkspaceCleanupModeForPlatformV1('linux', true)).toBe('retained');
  expect(testWorkspaceCleanupModeForPlatformV1('darwin', false)).toBe('darwin-ordinary');
  expect(testWorkspaceCleanupModeForPlatformV1('darwin', true)).toBe('unavailable');
  expect(testWorkspaceCleanupModeForPlatformV1('freebsd', false)).toBe('unavailable');
});

test('run-owned workspace namespaces bind but never reuse the caller scope', () => {
  const seed = {
    parentNamespace: 'verification-fast-tests',
    processId: 42,
    processNonce: 'process-nonce',
    runSequence: 1
  } as const;
  const first = deriveTestWorkspaceRunNamespaceV1(seed);

  expect(first).toMatch(/^fast-[0-9a-f]{64}$/u);
  expect(first).not.toBe(seed.parentNamespace);
  expect(deriveTestWorkspaceRunNamespaceV1(seed)).toBe(first);
  expect(deriveTestWorkspaceRunNamespaceV1({ ...seed, runSequence: 2 })).not.toBe(first);
  expect(deriveTestWorkspaceRunNamespaceV1({ ...seed, parentNamespace: 'verification-other-gate' }))
    .not.toBe(first);
  expect(() => deriveTestWorkspaceRunNamespaceV1({ ...seed, parentNamespace: '../outside' }))
    .toThrow('SEC_TEST_WORKSPACE_NAMESPACE must be a bounded safe single path segment');
});

test('issuer projection is exact while a non-snapshot consumer rejects caller-selected roots', async () => {
  const namespace = `gate-owned-parent-${process.pid}`;
  const executionSnapshotRoot = path.join(
    compilerRoot,
    '.tmp',
    'gate-execution-snapshots',
    namespace
  );
  const supervisorLease = createTestWorkspaceSupervisorLeaseV1({
    namespace,
    runId: 'env-manager-test',
    repositoryRoot: compilerRoot,
    executionSnapshotRoot,
    issuerProcessId: process.ppid,
    nonce: 'f'.repeat(64)
  });
  const supervisorLeasePath = path.join(
    compilerRoot,
    '.tmp',
    'test-workspaces',
    '.gate-supervisor-leases',
    `${namespace}.lock`
  );
  await fs.mkdir(path.dirname(supervisorLeasePath), { recursive: true });
  await fs.writeFile(supervisorLeasePath, JSON.stringify(supervisorLease), { encoding: 'utf8', flag: 'wx' });
  try {
    const supervisorBinding = bindTestWorkspaceSupervisorLeaseIssuerProjectionV1(
      supervisorLeasePath,
      supervisorLease.namespace,
      executionSnapshotRoot
    );
    const assignment = createTestWorkspaceRunChildAssignmentV1({
      parentNamespace: namespace,
      issuerProcessId: process.ppid,
      device: 'device-1',
      inode: 'inode-1',
      nonce: 'a'.repeat(64),
      supervisorLeaseDigest: supervisorLease.leaseDigest,
      supervisorLeasePath: supervisorBinding.path,
      supervisorLeaseDevice: supervisorBinding.device,
      supervisorLeaseInode: supervisorBinding.inode,
      namespaceDevice: 'namespace-device-1',
      namespaceInode: 'namespace-inode-1'
    });
    expect(() => parseTestWorkspaceRunChildAssignmentV1(
      JSON.stringify(assignment),
      namespace,
      assignment.name
    )).toThrow('Gate execution snapshot binding is invalid');
    const foreignRoot = await fs.mkdtemp(path.join(compilerRoot, '.tmp', 'cross-worktree-lease-'));
    const foreignPath = path.join(
      foreignRoot,
      '.gate-supervisor-leases',
      `${namespace}.lock`
    );
    await fs.mkdir(path.dirname(foreignPath), { recursive: true });
    await fs.writeFile(foreignPath, JSON.stringify(supervisorLease), { encoding: 'utf8', flag: 'wx' });
    expect(() => bindTestWorkspaceSupervisorLeaseV1(foreignPath, namespace))
      .toThrow('Gate execution snapshot binding is invalid');
    await fs.rm(foreignRoot, { recursive: true, force: true });
  } finally {
    await fs.rm(supervisorLeasePath, { force: true });
  }
});

test('a real execution-snapshot consumer must spend the live supervisor challenge exactly once', async () => {
  if (process.platform !== 'win32' && process.platform !== 'linux') return;
  const repositoryRoot = await fs.mkdtemp(path.join(compilerRoot, '.tmp', 'supervisor-challenge-'));
  const namespace = `gate-${process.pid}-${Date.now()}-owned`;
  const executionSnapshotRoot = path.join(
    repositoryRoot,
    '.tmp',
    'gate-execution-snapshots',
    namespace
  );
  const leasePath = path.join(
    repositoryRoot,
    '.tmp',
    'test-workspaces',
    '.gate-supervisor-leases',
    `${namespace}.lock`
  );
  let server: Awaited<ReturnType<typeof acquireTestWorkspaceSupervisorChallengeServerV1>> | null = null;
  try {
    await fs.mkdir(executionSnapshotRoot, { recursive: true });
    await fs.cp(path.join(compilerRoot, 'platform'), path.join(executionSnapshotRoot, 'platform'), {
      recursive: true
    });
    await fs.mkdir(path.dirname(leasePath), { recursive: true });
    const lease = createTestWorkspaceSupervisorLeaseV1({
      namespace,
      runId: 'real-snapshot-consumer',
      repositoryRoot,
      executionSnapshotRoot,
      issuerProcessId: process.pid,
      nonce: '9'.repeat(64)
    });
    await fs.writeFile(leasePath, JSON.stringify(lease), { encoding: 'utf8', flag: 'wx' });
    const binding = bindTestWorkspaceSupervisorLeaseIssuerProjectionV1(
      leasePath,
      namespace,
      executionSnapshotRoot
    );
    const childRoot = path.join(
      executionSnapshotRoot,
      '.tmp',
      'test-workspaces',
      namespace,
      `fast-${'1'.repeat(64)}`
    );
    await fs.mkdir(childRoot, { recursive: true });
    const namespaceIdentity = inspectNoFollowDirectoryChainV1(path.dirname(childRoot)).target;
    const childIdentity = inspectNoFollowDirectoryChainV1(childRoot).target;
    const assignment = createTestWorkspaceRunChildAssignmentV1({
      parentNamespace: namespace,
      issuerProcessId: process.pid,
      device: childIdentity.device,
      inode: childIdentity.inode,
      nonce: '8'.repeat(64),
      supervisorLeaseDigest: lease.leaseDigest,
      supervisorLeasePath: binding.path,
      supervisorLeaseDevice: binding.device,
      supervisorLeaseInode: binding.inode,
      namespaceDevice: namespaceIdentity.device,
      namespaceInode: namespaceIdentity.inode
    });
    server = await acquireTestWorkspaceSupervisorChallengeServerV1({
      executionSnapshotRoot,
      supervisorLeaseDigest: lease.leaseDigest
    });
    await expect(acquireTestWorkspaceSupervisorChallengeServerV1({
      executionSnapshotRoot,
      supervisorLeaseDigest: lease.leaseDigest
    })).rejects.toThrow('supervisor challenge');
    server.authorize(assignment);
    expect(() => server!.authorize(assignment)).toThrow('invalid or duplicated');
    const moduleUrl = pathToFileURL(path.join(
      executionSnapshotRoot,
      'platform',
      'dev-runner',
      'env-manager.ts'
    )).href;
    const source = `
      import {
        consumeTestWorkspaceSupervisorChallengeV1,
        parseTestWorkspaceRunChildAssignmentV1
      } from ${JSON.stringify(moduleUrl)};
      const assignment = JSON.parse(Buffer.from(process.argv[1], 'base64').toString('utf8'));
      const parsed = parseTestWorkspaceRunChildAssignmentV1(
        JSON.stringify(assignment),
        process.argv[2],
        assignment.name
      );
      await consumeTestWorkspaceSupervisorChallengeV1(parsed);
    `;
    const encoded = Buffer.from(JSON.stringify(assignment), 'utf8').toString('base64');
    const first = Bun.spawn([process.execPath, '-e', source, encoded, namespace], {
      cwd: executionSnapshotRoot,
      stdout: 'pipe',
      stderr: 'pipe'
    });
    expect(await first.exited).toBe(0);
    server.assertConsumed(assignment);
    expect(() => server!.assertConsumed(assignment)).toThrow('exactly once');
    const replay = Bun.spawn([process.execPath, '-e', source, encoded, namespace], {
      cwd: executionSnapshotRoot,
      stdout: 'pipe',
      stderr: 'pipe'
    });
    expect(await replay.exited).not.toBe(0);
  } finally {
    await server?.close();
    await fs.rm(repositoryRoot, { recursive: true, force: true });
  }
}, 20_000);

test('caller-assigned adoption never creates beneath an absent, replaced, or swapped parent', async () => {
  if (process.platform !== 'win32' && process.platform !== 'linux') return;
  const namespace = `gate-${randomUUID().replaceAll('-', '').slice(0, 32)}-owned`;
  const executionSnapshotRoot = path.join(
    compilerRoot,
    '.tmp',
    'gate-execution-snapshots',
    namespace
  );
  const leasePath = testWorkspaceSupervisorLeasePathV1(namespace);
  const parentRoot = getTestWorkspaceTempRoot({ [TEST_WORKSPACE_NAMESPACE_ENV]: namespace });
  const displacedChild = path.join(parentRoot, 'displaced-child');
  const displacedParent = `${parentRoot}-displaced`;
  try {
    const lease = createTestWorkspaceSupervisorLeaseV1({
      namespace,
      runId: 'inspect-only-adoption',
      repositoryRoot: compilerRoot,
      executionSnapshotRoot,
      issuerProcessId: process.ppid,
      nonce: '7'.repeat(64)
    });
    await fs.mkdir(path.dirname(leasePath), { recursive: true });
    await fs.writeFile(leasePath, JSON.stringify(lease), { encoding: 'utf8', flag: 'wx' });
    const binding = bindTestWorkspaceSupervisorLeaseIssuerProjectionV1(
      leasePath,
      namespace,
      executionSnapshotRoot
    );
    const seed = createTestWorkspaceRunChildAssignmentV1({
      parentNamespace: namespace,
      issuerProcessId: process.ppid,
      device: 'seed-device',
      inode: 'seed-inode',
      nonce: '6'.repeat(64),
      supervisorLeaseDigest: lease.leaseDigest,
      supervisorLeasePath: binding.path,
      supervisorLeaseDevice: binding.device,
      supervisorLeaseInode: binding.inode,
      namespaceDevice: 'seed-namespace-device',
      namespaceInode: 'seed-namespace-inode'
    });
    const env = {
      [TEST_WORKSPACE_NAMESPACE_ENV]: namespace,
      [TEST_WORKSPACE_RUN_CHILD_ENV]: seed.name
    };
    const childRoot = getTestWorkspaceTempRoot(env);
    await fs.mkdir(childRoot, { recursive: true });
    const namespaceIdentity = inspectNoFollowDirectoryChainV1(parentRoot).target;
    const childIdentity = inspectNoFollowDirectoryChainV1(childRoot).target;
    const assignment = createTestWorkspaceRunChildAssignmentV1({
      parentNamespace: namespace,
      issuerProcessId: process.ppid,
      device: childIdentity.device,
      inode: childIdentity.inode,
      nonce: '6'.repeat(64),
      supervisorLeaseDigest: lease.leaseDigest,
      supervisorLeasePath: binding.path,
      supervisorLeaseDevice: binding.device,
      supervisorLeaseInode: binding.inode,
      namespaceDevice: namespaceIdentity.device,
      namespaceInode: namespaceIdentity.inode
    });

    await fs.rename(childRoot, displacedChild);
    expect(() => prepareTestWorkspaceRunV1(env, assignment)).toThrow('child physical identity');
    await expect(fs.lstat(childRoot)).rejects.toThrow();
    expect((await fs.lstat(displacedChild)).isDirectory()).toBe(true);
    await fs.rename(displacedChild, childRoot);

    await fs.rename(childRoot, displacedChild);
    await fs.mkdir(childRoot);
    await fs.writeFile(path.join(childRoot, 'replacement-owner.txt'), 'foreign', 'utf8');
    expect(() => prepareTestWorkspaceRunV1(env, assignment)).toThrow('child physical identity');
    expect(await fs.readFile(path.join(childRoot, 'replacement-owner.txt'), 'utf8')).toBe('foreign');
    expect((await fs.lstat(displacedChild)).isDirectory()).toBe(true);
    await fs.rm(childRoot, { recursive: true, force: false });
    await fs.rename(displacedChild, childRoot);

    await fs.rename(parentRoot, displacedParent);
    await fs.mkdir(parentRoot);
    await fs.writeFile(path.join(parentRoot, 'replacement-parent-owner.txt'), 'foreign-parent', 'utf8');
    expect(() => prepareTestWorkspaceRunV1(env, assignment)).toThrow('parent physical identity');
    expect(await fs.readFile(path.join(parentRoot, 'replacement-parent-owner.txt'), 'utf8'))
      .toBe('foreign-parent');
    await expect(fs.lstat(path.join(parentRoot, seed.name))).rejects.toThrow();
    expect((await fs.lstat(path.join(displacedParent, seed.name))).isDirectory()).toBe(true);
  } finally {
    await fs.rm(parentRoot, { recursive: true, force: true });
    await fs.rm(displacedParent, { recursive: true, force: true });
    await fs.rm(leasePath, { force: true });
  }
}, 20_000);

test('opaque retained cleanup removes only the prepared physical child beneath its caller scope', async () => {
  const namespace = `env-manager-${process.pid}-${Date.now()}`;
  const parentEnv = { [TEST_WORKSPACE_NAMESPACE_ENV]: namespace };
  const env = {
    ...parentEnv,
    [TEST_WORKSPACE_RUN_CHILD_ENV]: `fast-${'c'.repeat(64)}`
  };
  const siblingEnv = {
    ...parentEnv,
    [TEST_WORKSPACE_RUN_CHILD_ENV]: `fast-${'d'.repeat(64)}`
  };
  const parentRoot = getTestWorkspaceTempRoot(parentEnv);
  const root = getTestWorkspaceTempRoot(env);
  const siblingRoot = getTestWorkspaceTempRoot(siblingEnv);
  let prepared: ReturnType<typeof prepareTestWorkspaceRunV1> | null = null;
  try {
    await fs.mkdir(parentRoot, { recursive: true });
    await fs.mkdir(siblingRoot, { recursive: true });
    await fs.writeFile(path.join(parentRoot, 'sentinel.txt'), 'parent', 'utf8');
    prepared = prepareTestWorkspaceRunV1(env, null);
    await fs.writeFile(path.join(root, 'residue.txt'), 'residue', 'utf8');
    await fs.writeFile(path.join(siblingRoot, 'residue.txt'), 'sibling', 'utf8');

    settlePreparedTestWorkspaceRunV1(prepared);

    await expect(fs.access(root)).rejects.toThrow();
    expect(await fs.readFile(path.join(parentRoot, 'sentinel.txt'), 'utf8')).toBe('parent');
    expect(await fs.readFile(path.join(siblingRoot, 'residue.txt'), 'utf8')).toBe('sibling');
    expect(() => settlePreparedTestWorkspaceRunV1(prepared!))
      .toThrow('cleanup capability is invalid or already consumed');
  } finally {
    await fs.rm(parentRoot, { recursive: true, force: true });
  }
});

test('opaque retained cleanup rejects a replaced child and preserves the replacement', async () => {
  const namespace = `env-manager-replacement-${process.pid}-${Date.now()}`;
  const parentEnv = { [TEST_WORKSPACE_NAMESPACE_ENV]: namespace };
  const env = {
    ...parentEnv,
    [TEST_WORKSPACE_RUN_CHILD_ENV]: `fast-${'e'.repeat(64)}`
  };
  const parentRoot = getTestWorkspaceTempRoot(parentEnv);
  const root = getTestWorkspaceTempRoot(env);
  const displaced = path.join(parentRoot, 'displaced-original');
  try {
    const prepared = prepareTestWorkspaceRunV1(env, null);
    await fs.rename(root, displaced);
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, 'replacement-owner.txt'), 'foreign', 'utf8');

    expect(() => settlePreparedTestWorkspaceRunV1(prepared)).toThrow(/identity|changed|different/iu);
    expect(await fs.readFile(path.join(root, 'replacement-owner.txt'), 'utf8')).toBe('foreign');
    expect((await fs.lstat(displaced)).isDirectory()).toBe(true);
  } finally {
    await fs.rm(parentRoot, { recursive: true, force: true });
  }
});
