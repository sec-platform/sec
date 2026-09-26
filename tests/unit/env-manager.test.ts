import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { inspectNoFollowDirectoryChain } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import {
  acquireTestWorkspaceSupervisorChallengeServer,
  bindTestWorkspaceSupervisorLeaseIssuerProjection,
  bindTestWorkspaceSupervisorLease,
  createTestWorkspaceRunChildAssignment,
  createTestWorkspaceSupervisorLease,
  deriveTestWorkspaceRunNamespace,
  getTestWorkspaceTemplateRoot,
  getTestWorkspaceTempRoot,
  parseTestWorkspaceRunChildAssignment,
  prepareTestWorkspaceRun,
  resolveTestWorkspaceNamespace,
  resolveTestWorkspaceRunChild,
  settlePreparedTestWorkspaceRun,
  TEST_WORKSPACE_BOUND_CHILD_LOCATOR_ENV,
  TEST_WORKSPACE_NAMESPACE_ENV,
  TEST_WORKSPACE_RUN_CHILD_ENV,
  testWorkspaceCleanupModeForPlatform
} from '../../src/adapters/self-hosting/development/runner/env-manager.ts';
import { compilerRoot, getWorkspacePaths } from "../../src/adapters/workspace-context.ts";

const isolatedTestWorkspaceEnvironment = {
  [TEST_WORKSPACE_NAMESPACE_ENV]: undefined,
  [TEST_WORKSPACE_RUN_CHILD_ENV]: undefined,
  [TEST_WORKSPACE_BOUND_CHILD_LOCATOR_ENV]: undefined
};

test('test workspace roots honor a safe CI lane namespace', () => {
  const defaultRoot = getTestWorkspaceTempRoot(isolatedTestWorkspaceEnvironment);

  const relativeToRepository = path.relative(compilerRoot, defaultRoot);
  expect(path.basename(path.dirname(defaultRoot))).toBe('runs');
  expect(path.isAbsolute(relativeToRepository) || relativeToRepository.startsWith('..')).toBe(true);
  expect(getTestWorkspaceTempRoot({
    ...isolatedTestWorkspaceEnvironment,
    SEC_TEST_WORKSPACE_NAMESPACE: 'pr-risk-slow-suite-e2e-artifacts'
  })).toBe(path.join(defaultRoot, 'pr-risk-slow-suite-e2e-artifacts'));
  expect(getTestWorkspaceTempRoot({
    ...isolatedTestWorkspaceEnvironment,
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
    ...isolatedTestWorkspaceEnvironment,
    [TEST_WORKSPACE_RUN_CHILD_ENV]: `fast-${'b'.repeat(64)}`
  })).toThrow('SEC_TEST_WORKSPACE_RUN_CHILD requires SEC_TEST_WORKSPACE_NAMESPACE');
});

test('platform cleanup capability gives Darwin no destructive cleanup authority', () => {
  expect(testWorkspaceCleanupModeForPlatform('win32', false)).toBe('retained');
  expect(testWorkspaceCleanupModeForPlatform('linux', true)).toBe('retained');
  expect(testWorkspaceCleanupModeForPlatform('darwin', false)).toBe('darwin-os-managed');
  expect(testWorkspaceCleanupModeForPlatform('darwin', true)).toBe('unavailable');
  expect(testWorkspaceCleanupModeForPlatform('freebsd', false)).toBe('unavailable');
});

test('run-owned workspace namespaces bind but never reuse the caller scope', () => {
  const seed = {
    parentNamespace: 'verification-fast-tests',
    processId: 42,
    processNonce: 'process-nonce',
    runSequence: 1
  } as const;
  const first = deriveTestWorkspaceRunNamespace(seed);

  expect(first).toMatch(/^fast-[0-9a-f]{64}$/u);
  expect(first).not.toBe(seed.parentNamespace);
  expect(deriveTestWorkspaceRunNamespace(seed)).toBe(first);
  expect(deriveTestWorkspaceRunNamespace({ ...seed, runSequence: 2 })).not.toBe(first);
  expect(deriveTestWorkspaceRunNamespace({ ...seed, parentNamespace: 'verification-other-gate' }))
    .not.toBe(first);
  expect(() => deriveTestWorkspaceRunNamespace({ ...seed, parentNamespace: '../outside' }))
    .toThrow('SEC_TEST_WORKSPACE_NAMESPACE must be a bounded safe single path segment');
});

test('issuer projection is exact while a non-snapshot consumer rejects caller-selected roots', async () => {
  const namespace = `gate-owned-parent-${process.pid}`;
  const repositoryRoot = await fs.mkdtemp(path.join(tmpdir(), 'sec-env-manager-issuer-'));
  const executionSnapshotRoot = path.join(
    repositoryRoot,
    '.tmp',
    'gate-execution-snapshots',
    namespace
  );
  const supervisorLease = createTestWorkspaceSupervisorLease({
    namespace,
    runId: 'env-manager-test',
    repositoryRoot,
    executionSnapshotRoot,
    issuerProcessId: process.ppid,
    nonce: 'f'.repeat(64)
  });
  const supervisorLeasePath = path.join(
    repositoryRoot,
    '.tmp',
    'test-workspaces',
    '.gate-supervisor-leases',
    `${namespace}.lock`
  );
  await fs.mkdir(path.dirname(supervisorLeasePath), { recursive: true });
  await fs.writeFile(supervisorLeasePath, JSON.stringify(supervisorLease), { encoding: 'utf8', flag: 'wx' });
  try {
    const supervisorBinding = bindTestWorkspaceSupervisorLeaseIssuerProjection(
      supervisorLeasePath,
      supervisorLease.namespace,
      executionSnapshotRoot
    );
    const assignment = createTestWorkspaceRunChildAssignment({
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
    expect(() => parseTestWorkspaceRunChildAssignment(
      JSON.stringify(assignment),
      namespace,
      assignment.name
    )).toThrow('Gate execution snapshot binding is invalid');
    const foreignRoot = await fs.mkdtemp(path.join(tmpdir(), 'cross-worktree-lease-'));
    const foreignPath = path.join(
      foreignRoot,
      '.gate-supervisor-leases',
      `${namespace}.lock`
    );
    await fs.mkdir(path.dirname(foreignPath), { recursive: true });
    await fs.writeFile(foreignPath, JSON.stringify(supervisorLease), { encoding: 'utf8', flag: 'wx' });
    expect(() => bindTestWorkspaceSupervisorLease(foreignPath, namespace))
      .toThrow('Gate execution snapshot binding is invalid');
    await fs.rm(foreignRoot, { recursive: true, force: true });
  } finally {
    await fs.rm(repositoryRoot, { recursive: true, force: true });
  }
});

test('a real execution-snapshot consumer must spend the live supervisor challenge exactly once', async () => {
  if (process.platform !== 'win32' && process.platform !== 'linux') return;
  const repositoryRoot = await fs.mkdtemp(path.join(tmpdir(), 'supervisor-challenge-'));
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
  let server: Awaited<ReturnType<typeof acquireTestWorkspaceSupervisorChallengeServer>> | null = null;
  try {
    await fs.mkdir(executionSnapshotRoot, { recursive: true });
    const compilerPaths = getWorkspacePaths(compilerRoot);
    const sourceRoot = compilerPaths.srcRoot;
    await fs.cp(sourceRoot, path.join(executionSnapshotRoot, path.relative(compilerRoot, sourceRoot)), {
      recursive: true
    });
    await fs.copyFile(compilerPaths.packageJsonPath, getWorkspacePaths(executionSnapshotRoot).packageJsonPath);
    await fs.mkdir(path.dirname(leasePath), { recursive: true });
    const lease = createTestWorkspaceSupervisorLease({
      namespace,
      runId: 'real-snapshot-consumer',
      repositoryRoot,
      executionSnapshotRoot,
      issuerProcessId: process.pid,
      nonce: '9'.repeat(64)
    });
    await fs.writeFile(leasePath, JSON.stringify(lease), { encoding: 'utf8', flag: 'wx' });
    const binding = bindTestWorkspaceSupervisorLeaseIssuerProjection(
      leasePath,
      namespace,
      executionSnapshotRoot
    );
    const draftAssignment = createTestWorkspaceRunChildAssignment({
      parentNamespace: namespace,
      issuerProcessId: process.pid,
      device: 'pending-device',
      inode: 'pending-inode',
      nonce: '8'.repeat(64),
      supervisorLeaseDigest: lease.leaseDigest,
      supervisorLeasePath: binding.path,
      supervisorLeaseDevice: binding.device,
      supervisorLeaseInode: binding.inode,
      namespaceDevice: 'pending-namespace-device',
      namespaceInode: 'pending-namespace-inode'
    });
    const childRoot = path.join(
      executionSnapshotRoot,
      '.tmp',
      'test-workspaces',
      namespace,
      draftAssignment.name
    );
    await fs.mkdir(childRoot, { recursive: true });
    const namespaceIdentity = inspectNoFollowDirectoryChain(path.dirname(childRoot)).target;
    const childIdentity = inspectNoFollowDirectoryChain(childRoot).target;
    const assignment = createTestWorkspaceRunChildAssignment({
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
    server = await acquireTestWorkspaceSupervisorChallengeServer({
      executionSnapshotRoot,
      supervisorLeaseDigest: lease.leaseDigest
    });
    await expect(acquireTestWorkspaceSupervisorChallengeServer({
      executionSnapshotRoot,
      supervisorLeaseDigest: lease.leaseDigest
    })).rejects.toThrow('supervisor challenge');
    server.authorize(assignment);
    expect(() => server!.authorize(assignment)).toThrow('invalid or duplicated');
    const moduleUrl = pathToFileURL(path.join(
      executionSnapshotRoot,
      path.relative(compilerRoot, fileURLToPath(new URL('../../src/adapters/self-hosting/development/runner/env-manager.ts', import.meta.url)))
    )).href;
    const source = `
      import path from 'node:path';
      import {
        consumeTestWorkspaceSupervisorChallenge,
        getTestWorkspaceTempRoot,
        parseTestWorkspaceRunChildAssignment,
        prepareTestWorkspaceRun,
        settlePreparedTestWorkspaceRun,
        TEST_WORKSPACE_BOUND_CHILD_LOCATOR_ENV,
        TEST_WORKSPACE_NAMESPACE_ENV,
        TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_ENV,
        TEST_WORKSPACE_RUN_CHILD_ENV
      } from ${JSON.stringify(moduleUrl)};
      const assignment = JSON.parse(Buffer.from(process.argv[1], 'base64').toString('utf8'));
      const parsed = parseTestWorkspaceRunChildAssignment(
        JSON.stringify(assignment),
        process.argv[2],
        assignment.name
      );
      const unboundRoot = getTestWorkspaceTempRoot({
        [TEST_WORKSPACE_NAMESPACE_ENV]: process.argv[2],
        [TEST_WORKSPACE_RUN_CHILD_ENV]: assignment.name
      });
      if (unboundRoot.startsWith(process.cwd())) process.exit(12);
      const authority = await consumeTestWorkspaceSupervisorChallenge(parsed);
      const env = {
        ...process.env,
        [TEST_WORKSPACE_NAMESPACE_ENV]: process.argv[2],
        [TEST_WORKSPACE_RUN_CHILD_ENV]: assignment.name,
        [TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_ENV]: undefined,
        [TEST_WORKSPACE_BOUND_CHILD_LOCATOR_ENV]: JSON.stringify(parsed)
      };
      const expectedRoot = path.join(
        process.cwd(),
        '.tmp',
        'test-workspaces',
        process.argv[2],
        assignment.name
      );
      if (getTestWorkspaceTempRoot(env) !== expectedRoot) process.exit(13);
      const cleanup = prepareTestWorkspaceRun(env, authority);
      settlePreparedTestWorkspaceRun(cleanup);
    `;
    const encoded = Buffer.from(JSON.stringify(assignment), 'utf8').toString('base64');
    const first = Bun.spawn([process.execPath, '-e', source, encoded, namespace], {
      cwd: executionSnapshotRoot,
      stdout: 'pipe',
      stderr: 'pipe'
    });
    const firstExit = await first.exited;
    if (firstExit !== 0) {
      throw new Error(`execution-snapshot consumer failed: ${await new Response(first.stderr).text()}`);
    }
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

test('a serialized assignment cannot be used as cleanup authority', () => {
  const namespace = 'forged-cleanup-authority';
  const assignment = createTestWorkspaceRunChildAssignment({
    parentNamespace: namespace,
    issuerProcessId: process.pid,
    device: 'device',
    inode: 'inode',
    nonce: '6'.repeat(64),
    supervisorLeaseDigest: `sha256:${'7'.repeat(64)}`,
    supervisorLeasePath: path.join(compilerRoot, '.tmp', 'forged-lease.lock'),
    supervisorLeaseDevice: 'lease-device',
    supervisorLeaseInode: 'lease-inode',
    namespaceDevice: 'namespace-device',
    namespaceInode: 'namespace-inode'
  });
  expect(() => prepareTestWorkspaceRun({
    [TEST_WORKSPACE_NAMESPACE_ENV]: namespace,
    [TEST_WORKSPACE_RUN_CHILD_ENV]: assignment.name
  }, assignment as never)).toThrow('cleanup authority is invalid');
});

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
  let prepared: ReturnType<typeof prepareTestWorkspaceRun> | null = null;
  try {
    await fs.mkdir(parentRoot, { recursive: true });
    await fs.mkdir(siblingRoot, { recursive: true });
    await fs.writeFile(path.join(parentRoot, 'sentinel.txt'), 'parent', 'utf8');
    prepared = prepareTestWorkspaceRun(env, null);
    await fs.writeFile(path.join(root, 'residue.txt'), 'residue', 'utf8');
    await fs.writeFile(path.join(siblingRoot, 'residue.txt'), 'sibling', 'utf8');

    settlePreparedTestWorkspaceRun(prepared);

    await expect(fs.access(root)).rejects.toThrow();
    expect(await fs.readFile(path.join(parentRoot, 'sentinel.txt'), 'utf8')).toBe('parent');
    expect(await fs.readFile(path.join(siblingRoot, 'residue.txt'), 'utf8')).toBe('sibling');
    expect(() => settlePreparedTestWorkspaceRun(prepared!))
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
    const prepared = prepareTestWorkspaceRun(env, null);
    await fs.rename(root, displaced);
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, 'replacement-owner.txt'), 'foreign', 'utf8');

    expect(() => settlePreparedTestWorkspaceRun(prepared)).toThrow(/identity|changed|different/iu);
    expect(await fs.readFile(path.join(root, 'replacement-owner.txt'), 'utf8')).toBe('foreign');
    expect((await fs.lstat(displaced)).isDirectory()).toBe(true);
  } finally {
    await fs.rm(parentRoot, { recursive: true, force: true });
  }
});
