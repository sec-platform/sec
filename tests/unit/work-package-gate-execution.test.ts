import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  cp,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  symlink,
  unlink,
  writeFile
} from 'node:fs/promises';
import { createConnection } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, expect, test } from 'bun:test';

import {
  createTestWorkspaceSupervisorLeaseV1,
  testWorkspaceSupervisorLeasePathV1
} from '../../platform/dev-runner/env-manager.ts';
import { CodexDevelopmentVerificationDigest } from '../../platform/shared/ci-evidence-contract.ts';
import type { ObservedCommandOutcome } from '../../platform/shared/observed-process.ts';
import { runObservedCommand } from '../../platform/shared/observed-process.ts';
import { createWorkspaceWriteLeaseManager } from '../../platform/shared/workspace-write-lease.ts';
import {
  prepareWorkPackageExecutionSnapshotForTests,
  publishWorkPackageExecutionSnapshotOwnerForTests,
  removeWorkPackageExecutionSnapshotForTests,
  runWorkPackageGate,
  workPackageGateAssertRunChildForTests,
  workPackageGateAuthorityProbeBudgetForTests,
  workPackageGateCheckpointPublicationDirectoryForTests,
  workPackageGateFailureIndexForTests,
  workPackageGateNamespaceMutexNameForTests,
  workPackageGateNamespaceStructureForTests,
  workPackageGatePrepareExactRunChildForTests,
  workPackageGatePrepareRunChildForTests,
  workPackageGatePrepareRunChildNamespaceForTests,
  workPackageGateProbeOutcomeAcceptedForTests,
  workPackageGateProtectedLedgerDigestForTests,
  workPackageGateProtectedPathAuthorityForTests,
  workPackageGateProtectedPathSnapshotDigestForTests,
  workPackageGateR2ExecutionSnapshotOwnerAcceptedForTests,
  workPackageGateReadTextForTests,
  workPackageGateRecoveryRecordAuthorityPathForTests,
  workPackageGateRecoveryRecordEntryPathForTests,
  workPackageGateRemoveOwnedNamespaceForTests,
  workPackageGateRetireRunChildForTests,
  workPackageGateTerminalCompletionAuthorityPathsForTests,
  workPackageGateTerminalOrderEntryKindForTests,
  workPackageWorktreeDigestForTests,
  type WorkPackageGateCrashStageV4,
  type WorkPackageGateDependencies,
  type WorkPackageGateOptions
} from '../../scripts/run-work-package-gate.ts';
import {
  WORK_PACKAGE_GATE_CUSTODY_LEDGER_V4,
  WORK_PACKAGE_GATE_EXECUTION_MANIFEST_PATH_V4,
  WORK_PACKAGE_GATE_RUN_DIRECTORY_V4,
  WORK_PACKAGE_GATE_SELECTION_MANIFEST_PATH,
  assertWorkPackageGateEvidenceBundleV4,
  assertWorkPackageGateEvidenceV4,
  finalizeWorkPackageGateEventV4,
  parseFrozenWorkPackageGateSelectionV4,
  type WorkPackageGateChildEvidenceV1,
  type WorkPackageGateResidueCensusV4
} from '../../scripts/work-package-gate-contract.ts';

const repoRoot = path.resolve(import.meta.dir, '../..');
const head = 'a'.repeat(40);
const tree = 'b'.repeat(40);
const worktree = `sha256:${'c'.repeat(64)}`;
const supervisorLeaseDigest = `sha256:${'d'.repeat(64)}` as const;
const emptyDigest: `sha256:${string}` = `sha256:${'e'.repeat(64)}`;
const v4Options: WorkPackageGateOptions = Object.freeze({
  manifestPath: 'docs/work-packages/sm3-r3-actionable-runtime-gate-v4.md',
  selectionManifestPath: 'docs/work-packages/sm3-r1-focused-blocker-repair-v1.md',
  selectionIndex: 0,
  watchdogMs: 1_800_000,
  cleanupMs: 120_000,
  runDir: WORK_PACKAGE_GATE_RUN_DIRECTORY_V4
});
const v4RunDir = path.join(repoRoot, ...WORK_PACKAGE_GATE_RUN_DIRECTORY_V4.split('/'));
const v4PendingDir = workPackageGateCheckpointPublicationDirectoryForTests(repoRoot, v4RunDir);
const syntheticLedgerRoot = path.join(repoRoot, '.tmp', 'work-package-gate-protected-ledger-fixture');
const syntheticCustodyRelative = '.tmp/work-package-gate-protected-ledger-fixture/custody.txt';
const syntheticLocalArtifactRelative =
  '.tmp/work-package-gate-protected-ledger-fixture/local-artifact.bin';
const syntheticCustodyBytes = Buffer.from('first\nsecond\n', 'utf8');
const syntheticLocalArtifactBytes = Buffer.from([0x00, 0x0d, 0x0a, 0xff]);
const frozenR2SnapshotRelative =
  '.tmp/gate-execution-snapshots/gate-d4ecb7717e828f3111ae866fa084e957-owned';
const canonicalRequiredAuthorityPaths = Object.freeze({
  r2Run: path.join(repoRoot, '.tmp', 'sm3-r2-work-package-gate'),
  snapshot: path.join(repoRoot, ...frozenR2SnapshotRelative.split('/')),
  sidecar: path.join(repoRoot, ...`${frozenR2SnapshotRelative}.owner-v1.json`.split('/')),
  namespace: path.join(
    repoRoot,
    ...frozenR2SnapshotRelative.split('/'),
    '.tmp',
    'test-workspaces',
    path.basename(frozenR2SnapshotRelative)
  ),
  externalWorkspaces: path.join(repoRoot, '.tmp', 'test-workspaces')
});
const createdCanonicalAuthorityPaths = new Set<string>();
const syntheticProtectedLedger = Object.freeze({
  custody: Object.freeze({
    [syntheticCustodyRelative]: workPackageGateProtectedLedgerDigestForTests(
      'custody',
      syntheticCustodyBytes
    )
  }),
  localArtifacts: Object.freeze({
    [syntheticLocalArtifactRelative]: workPackageGateProtectedLedgerDigestForTests(
      'local-artifact',
      syntheticLocalArtifactBytes
    )
  })
});

function canonicalFilesystemIdentityForTests(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32'
    ? resolved.toLocaleLowerCase('en-US')
    : resolved;
}

function filesystemIdentityDigest(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256')
    .update(canonicalFilesystemIdentityForTests(value), 'utf8')
    .digest('hex')}`;
}

const syntheticV4Namespace = `gate-${createHash('sha256')
  .update(canonicalFilesystemIdentityForTests(v4RunDir), 'utf8')
  .digest('hex')
  .slice(0, 32)}-owned`;
const syntheticFilesystemIdentityExpectation = Object.freeze({
  namespace: syntheticV4Namespace,
  runDirectoryIdentityDigest: filesystemIdentityDigest(v4RunDir),
  namespaceIdentityDigest: `sha256:${createHash('sha256')
    .update(syntheticV4Namespace, 'utf8')
    .digest('hex')}`,
  snapshotIdentityDigest: filesystemIdentityDigest(path.join(
    repoRoot,
    '.tmp',
    'gate-execution-snapshots',
    syntheticV4Namespace
  )),
  namespaceRootIdentityDigest: filesystemIdentityDigest(path.join(
    repoRoot,
    '.tmp',
    'gate-execution-snapshots',
    syntheticV4Namespace,
    '.tmp',
    'test-workspaces',
    syntheticV4Namespace
  ))
});

test('Windows namespace mutex is global across interactive and service sessions', () => {
  expect(workPackageGateNamespaceMutexNameForTests(v4RunDir))
    .toMatch(/^Global\\sec-work-package-gate-[0-9a-f]{32}-owned$/u);
});

test('a dead supervisor generation is retained-retired before the replacement run-child intent', async () => {
  if (process.platform !== 'win32' && process.platform !== 'linux') return;
  const leasePath = testWorkspaceSupervisorLeasePathV1(syntheticV4Namespace);
  await expect(lstat(leasePath)).rejects.toThrow();
  const stale = createTestWorkspaceSupervisorLeaseV1({
    namespace: syntheticV4Namespace,
    runId: 'crashed-supervisor',
    repositoryRoot: repoRoot,
    executionSnapshotRoot: path.join(
      repoRoot,
      '.tmp',
      'gate-execution-snapshots',
      syntheticV4Namespace
    ),
    issuerProcessId: 2_147_483_647,
    nonce: 'a'.repeat(64)
  });
  await mkdir(path.dirname(leasePath), { recursive: true });
  await writeFile(leasePath, JSON.stringify(stale), { encoding: 'utf8', flag: 'wx' });
  const fake = fakeDependencies();

  try {
    const result = await runWorkPackageGate(v4Options, fake.overrides);
    expect(result.evidence.status).toBe('passed');
    expect(fake.counters.child).toBe(1);
    await expect(lstat(leasePath)).rejects.toThrow();
  } finally {
    await rm(leasePath, { force: true });
  }
});

test('protected directory snapshot ignores child link-count drift but detects path replacement', async () => {
  const root = await mkdtemp(path.join(repoRoot, '.tmp', 'work-package-gate-directory-snapshot-'));
  const protectedDirectory = path.join(root, 'protected');
  const displacedDirectory = path.join(root, 'protected-original');
  const authority = Object.freeze([
    Object.freeze({ path: protectedDirectory, required: true })
  ]);
  try {
    await mkdir(protectedDirectory);
    const baseline = await workPackageGateProtectedPathSnapshotDigestForTests(authority);

    const childDirectory = path.join(protectedDirectory, 'child');
    await mkdir(childDirectory);
    expect(await workPackageGateProtectedPathSnapshotDigestForTests(authority)).toBe(baseline);
    await rm(childDirectory, { recursive: true, force: true });
    expect(await workPackageGateProtectedPathSnapshotDigestForTests(authority)).toBe(baseline);

    await rename(protectedDirectory, displacedDirectory);
    await mkdir(protectedDirectory);
    expect(await workPackageGateProtectedPathSnapshotDigestForTests(authority)).not.toBe(baseline);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const fakeProtectedPathAuthority = Object.freeze([
  ['.tmp/sm3-r2-work-package-gate', true],
  [frozenR2SnapshotRelative, true],
  [`${frozenR2SnapshotRelative}.owner-v1.json`, true],
  [`${frozenR2SnapshotRelative}/.tmp/test-workspaces/${path.basename(frozenR2SnapshotRelative)}`, true],
  ['.tmp/sm3-r3-work-package-gate', false],
  ['.tmp/sm3-r3-v2-work-package-gate', false],
  ['.tmp/sm3-r3-v3-work-package-gate', false],
  ['.tmp/test-workspaces', true]
].map(([relativePath, required]) => Object.freeze({
  path: path.join(repoRoot, ...(relativePath as string).split('/')),
  required: required as boolean
})));

async function cleanV4Publications(): Promise<void> {
  await rm(v4RunDir, { recursive: true, force: true });
  await rm(v4PendingDir, { recursive: true, force: true });
}

async function prepareSyntheticProtectedLedger(): Promise<void> {
  await rm(syntheticLedgerRoot, { recursive: true, force: true });
  await mkdir(syntheticLedgerRoot, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(repoRoot, ...syntheticCustodyRelative.split('/')),
      syntheticCustodyBytes
    ),
    writeFile(
      path.join(repoRoot, ...syntheticLocalArtifactRelative.split('/')),
      syntheticLocalArtifactBytes
    )
  ]);
}

async function pathPresent(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function prepareCanonicalProtectedPathAuthority(): Promise<void> {
  createdCanonicalAuthorityPaths.clear();
  const core = [
    canonicalRequiredAuthorityPaths.r2Run,
    canonicalRequiredAuthorityPaths.snapshot,
    canonicalRequiredAuthorityPaths.sidecar,
    canonicalRequiredAuthorityPaths.namespace
  ];
  const corePresent = await Promise.all(core.map(pathPresent));
  if (corePresent.some(Boolean) && !corePresent.every(Boolean)) {
    throw new Error('Work Package gate test authority fixture is partially pre-existing');
  }
  if (!corePresent.some(Boolean)) {
    await mkdir(canonicalRequiredAuthorityPaths.r2Run, { recursive: true });
    createdCanonicalAuthorityPaths.add(canonicalRequiredAuthorityPaths.r2Run);
    await mkdir(canonicalRequiredAuthorityPaths.namespace, { recursive: true });
    createdCanonicalAuthorityPaths.add(canonicalRequiredAuthorityPaths.snapshot);
    await writeFile(canonicalRequiredAuthorityPaths.sidecar, '{"fixture":"owned"}\n', 'utf8');
    createdCanonicalAuthorityPaths.add(canonicalRequiredAuthorityPaths.sidecar);
  }
  if (!await pathPresent(canonicalRequiredAuthorityPaths.externalWorkspaces)) {
    await mkdir(canonicalRequiredAuthorityPaths.externalWorkspaces, { recursive: true });
    createdCanonicalAuthorityPaths.add(canonicalRequiredAuthorityPaths.externalWorkspaces);
  }
}

async function cleanCanonicalProtectedPathAuthority(): Promise<void> {
  if (createdCanonicalAuthorityPaths.has(canonicalRequiredAuthorityPaths.r2Run)) {
    await rm(canonicalRequiredAuthorityPaths.r2Run, { recursive: true, force: true });
  }
  if (createdCanonicalAuthorityPaths.has(canonicalRequiredAuthorityPaths.snapshot)) {
    await rm(canonicalRequiredAuthorityPaths.snapshot, { recursive: true, force: true });
  }
  if (createdCanonicalAuthorityPaths.has(canonicalRequiredAuthorityPaths.sidecar)) {
    await rm(canonicalRequiredAuthorityPaths.sidecar, { force: true });
  }
  if (createdCanonicalAuthorityPaths.has(canonicalRequiredAuthorityPaths.externalWorkspaces)) {
    await rm(canonicalRequiredAuthorityPaths.externalWorkspaces, { recursive: true, force: true });
  }
  createdCanonicalAuthorityPaths.clear();
}

async function cleanSyntheticProtectedLedger(): Promise<void> {
  await rm(syntheticLedgerRoot, { recursive: true, force: true });
}

beforeEach(async () => {
  await cleanV4Publications();
  await prepareSyntheticProtectedLedger();
  await prepareCanonicalProtectedPathAuthority();
});
afterEach(async () => {
  await cleanV4Publications();
  await cleanCanonicalProtectedPathAuthority();
  await cleanSyntheticProtectedLedger();
});

function revision(value: string): string {
  const result = spawnSync('git', ['rev-parse', value], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  expect(result.status).toBe(0);
  return result.stdout.trim();
}

function addHookIsolatedDetachedWorktree(snapshotRoot: string): void {
  const result = spawnSync('git', [
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'core.longpaths=true',
    'worktree',
    'add',
    '--detach',
    snapshotRoot,
    revision('HEAD')
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(`Hook-isolated detached worktree creation failed: ${result.stderr.trim()}`);
  }
}

const frozenExecutionManifestSourcePath =
  'tests/fixtures/work-package-gate-manifests/sm3-r3-actionable-runtime-gate-v4.md';
const frozenSelectionManifestSourcePath =
  'tests/fixtures/work-package-gate-manifests/sm3-r1-focused-blocker-repair-v1.md';
const frozenManifestPaths = new Map([
  [
    WORK_PACKAGE_GATE_EXECUTION_MANIFEST_PATH_V4,
    frozenExecutionManifestSourcePath
  ],
  [
    WORK_PACKAGE_GATE_SELECTION_MANIFEST_PATH,
    frozenSelectionManifestSourcePath
  ]
].map(([logicalPath, sourcePath]) => [
  path.resolve(repoRoot, ...logicalPath.split('/')),
  sourcePath
] as const));
const frozenManifestTextCache = new Map<string, string>();
let frozenHistoricalTestPaths: ReadonlySet<string> | undefined;

function frozenManifestText(relativePath: string): string {
  const cached = frozenManifestTextCache.get(relativePath);
  if (cached !== undefined) return cached;
  const testedHead = revision('HEAD');
  const result = spawnSync('git', ['cat-file', 'blob', `${testedHead}:${relativePath}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  expect(result.status).toBe(0);
  frozenManifestTextCache.set(relativePath, result.stdout);
  return result.stdout;
}

function historicalFrozenTestPaths(): ReadonlySet<string> {
  frozenHistoricalTestPaths ??= new Set(parseFrozenWorkPackageGateSelectionV4({
    executionManifestSource: frozenManifestText(frozenExecutionManifestSourcePath),
    executionManifestPath: WORK_PACKAGE_GATE_EXECUTION_MANIFEST_PATH_V4,
    selectionManifestSource: frozenManifestText(frozenSelectionManifestSourcePath),
    selectionManifestPath: WORK_PACKAGE_GATE_SELECTION_MANIFEST_PATH,
    selectionIndex: v4Options.selectionIndex
  }).testFiles.map((relativePath) => path.resolve(repoRoot, ...relativePath.split('/'))));
  return frozenHistoricalTestPaths;
}

test('execution snapshot materializes the exact dirty tree in a detached worktree', async () => {
  const snapshotRoot = path.join(
    repoRoot,
    '.tmp',
    'gate-execution-snapshots',
    `synthetic-snapshot-${randomUUID()}`
  );
  const expectedDigest = await workPackageWorktreeDigestForTests(repoRoot);
  try {
    expect(await prepareWorkPackageExecutionSnapshotForTests(
      repoRoot,
      snapshotRoot,
      revision('HEAD'),
      revision('HEAD^{tree}'),
      expectedDigest
    )).toBe(expectedDigest);
    expect(await readFile(path.join(snapshotRoot, 'scripts', 'run-work-package-gate.ts'), 'utf8'))
      .toBe(await readFile(path.join(repoRoot, 'scripts', 'run-work-package-gate.ts'), 'utf8'));
  } finally {
    expect(await removeWorkPackageExecutionSnapshotForTests(repoRoot, snapshotRoot)).toBe(true);
  }
});

test('execution snapshot binds clean tracked checkout bytes hidden by Git EOL normalization', async () => {
  const fixtureParent = path.dirname(repoRoot);
  const fixtureRepo = await mkdtemp(path.join(fixtureParent, 'work-package-gate-snapshot-eol-'));
  const snapshotRoot = path.join(
    fixtureRepo,
    '.tmp',
    'gate-execution-snapshots',
    `synthetic-snapshot-${randomUUID()}`
  );
  const git = (args: readonly string[]) => spawnSync('git', [...args], {
    cwd: fixtureRepo,
    encoding: 'utf8',
    windowsHide: true
  });
  try {
    expect(git(['init']).status).toBe(0);
    expect(git(['config', 'user.name', 'SEC Test']).status).toBe(0);
    expect(git(['config', 'user.email', 'sec-test@example.invalid']).status).toBe(0);
    await writeFile(path.join(fixtureRepo, '.gitignore'), '.tmp/\n', 'utf8');
    await writeFile(path.join(fixtureRepo, '.gitattributes'), '*.txt text\n', 'utf8');
    await writeFile(path.join(fixtureRepo, 'tracked.txt'), 'first\nsecond\n', 'utf8');
    expect(git(['add', '.gitignore', '.gitattributes', 'tracked.txt']).status).toBe(0);
    expect(git(['commit', '-m', 'fixture base']).status).toBe(0);

    const lfDigest = await workPackageWorktreeDigestForTests(fixtureRepo);
    await writeFile(path.join(fixtureRepo, 'tracked.txt'), 'first\r\nsecond\r\n', 'utf8');
    expect(git(['diff', '--quiet', 'HEAD', '--', 'tracked.txt']).status).toBe(0);
    const crlfDigest = await workPackageWorktreeDigestForTests(fixtureRepo);
    expect(crlfDigest).not.toBe(lfDigest);

    expect(await prepareWorkPackageExecutionSnapshotForTests(
      fixtureRepo,
      snapshotRoot,
      git(['rev-parse', 'HEAD']).stdout.trim(),
      git(['rev-parse', 'HEAD^{tree}']).stdout.trim(),
      crlfDigest
    )).toBe(crlfDigest);
    expect(await readFile(path.join(snapshotRoot, 'tracked.txt')))
      .toEqual(await readFile(path.join(fixtureRepo, 'tracked.txt')));
  } finally {
    if (await lstat(snapshotRoot).then(() => true, () => false)) {
      expect(await removeWorkPackageExecutionSnapshotForTests(fixtureRepo, snapshotRoot)).toBe(true);
    }
    await rm(fixtureRepo, { recursive: true, force: true });
  }
});

test('execution snapshot preserves staged-added identity without duplicating it as untracked', async () => {
  const fixtureParent = path.dirname(repoRoot);
  await mkdir(fixtureParent, { recursive: true });
  const fixtureRepo = await mkdtemp(path.join(fixtureParent, 'work-package-gate-snapshot-index-'));
  const snapshotRoot = path.join(
    fixtureRepo,
    '.tmp',
    'gate-execution-snapshots',
    `synthetic-snapshot-${randomUUID()}`
  );
  const git = (args: readonly string[]) => spawnSync('git', [...args], {
    cwd: fixtureRepo,
    encoding: 'utf8',
    windowsHide: true
  });
  try {
    expect(git(['init']).status).toBe(0);
    expect(git(['config', 'user.name', 'SEC Test']).status).toBe(0);
    expect(git(['config', 'user.email', 'sec-test@example.invalid']).status).toBe(0);
    await writeFile(path.join(fixtureRepo, '.gitignore'), '.tmp/\n', 'utf8');
    await writeFile(path.join(fixtureRepo, 'tracked.txt'), 'base\n', 'utf8');
    expect(git(['add', '.gitignore', 'tracked.txt']).status).toBe(0);
    expect(git(['commit', '-m', 'fixture base']).status).toBe(0);
    await writeFile(path.join(fixtureRepo, 'staged-added.txt'), 'staged\n', 'utf8');
    await writeFile(path.join(fixtureRepo, 'untracked.txt'), 'untracked\n', 'utf8');
    expect(git(['add', 'staged-added.txt']).status).toBe(0);

    const expectedDigest = await workPackageWorktreeDigestForTests(fixtureRepo);
    expect(await prepareWorkPackageExecutionSnapshotForTests(
      fixtureRepo,
      snapshotRoot,
      git(['rev-parse', 'HEAD']).stdout.trim(),
      git(['rev-parse', 'HEAD^{tree}']).stdout.trim(),
      expectedDigest
    )).toBe(expectedDigest);
    expect(spawnSync('git', ['ls-files', '--error-unmatch', 'staged-added.txt'], {
      cwd: snapshotRoot,
      encoding: 'utf8',
      windowsHide: true
    }).status).toBe(0);
    expect(spawnSync('git', ['ls-files', '--others', '--exclude-standard'], {
      cwd: snapshotRoot,
      encoding: 'utf8',
      windowsHide: true
    }).stdout.trim()).toBe('untracked.txt');
  } finally {
    if (await stat(snapshotRoot).then(() => true, () => false)) {
      expect(await removeWorkPackageExecutionSnapshotForTests(fixtureRepo, snapshotRoot)).toBe(true);
    }
    await rm(fixtureRepo, { recursive: true, force: true });
  }
});

test('execution snapshot recovery reclaims an owned registered partial worktree', async () => {
  const snapshotRoot = path.join(
    repoRoot,
    '.tmp',
    'gate-execution-snapshots',
    `synthetic-snapshot-recovery-${randomUUID()}`
  );
  const expectedDigest = await workPackageWorktreeDigestForTests(repoRoot);
  try {
    await publishWorkPackageExecutionSnapshotOwnerForTests(
      repoRoot,
      snapshotRoot,
      revision('HEAD'),
      revision('HEAD^{tree}'),
      expectedDigest
    );
    addHookIsolatedDetachedWorktree(snapshotRoot);
    await writeFile(path.join(snapshotRoot, 'partial-publication.txt'), 'partial', 'utf8');
    expect(await prepareWorkPackageExecutionSnapshotForTests(
      repoRoot,
      snapshotRoot,
      revision('HEAD'),
      revision('HEAD^{tree}'),
      expectedDigest
    )).toBe(expectedDigest);
    await expect(readFile(path.join(snapshotRoot, 'partial-publication.txt'), 'utf8')).rejects.toThrow();
  } finally {
    expect(await removeWorkPackageExecutionSnapshotForTests(repoRoot, snapshotRoot)).toBe(true);
  }
});

test('execution snapshot recovery preserves foreign directory and registered worktree', async () => {
  const roots = [
    path.join(repoRoot, '.tmp', 'gate-execution-snapshots', `foreign-dir-${randomUUID()}`),
    path.join(repoRoot, '.tmp', 'gate-execution-snapshots', `foreign-worktree-${randomUUID()}`)
  ];
  try {
    await mkdir(roots[0]!, { recursive: true });
    await writeFile(path.join(roots[0]!, 'keep.txt'), 'preserve', 'utf8');
    await expect(prepareWorkPackageExecutionSnapshotForTests(
      repoRoot,
      roots[0]!,
      revision('HEAD'),
      revision('HEAD^{tree}'),
      await workPackageWorktreeDigestForTests(repoRoot)
    )).rejects.toThrow('no durable owner authority');
    expect(await readFile(path.join(roots[0]!, 'keep.txt'), 'utf8')).toBe('preserve');

    addHookIsolatedDetachedWorktree(roots[1]!);
    await expect(prepareWorkPackageExecutionSnapshotForTests(
      repoRoot,
      roots[1]!,
      revision('HEAD'),
      revision('HEAD^{tree}'),
      await workPackageWorktreeDigestForTests(repoRoot)
    )).rejects.toThrow('no durable owner authority');
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', roots[1]!], {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true
    });
    spawnSync('git', ['worktree', 'prune'], { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  }
});

function outcome(overrides: Partial<ObservedCommandOutcome> = {}): ObservedCommandOutcome {
  return {
    status: 'exited',
    started: true,
    exitCode: 0,
    signal: null,
    durationMs: 10,
    stdout: { bytes: 0, digest: emptyDigest, observerTruncated: false },
    stderr: { bytes: 0, digest: emptyDigest, observerTruncated: false },
    termination: {
      requested: false,
      gracefulAttempted: false,
      forcedAttempted: false,
      childCloseObserved: true,
      streamsDrained: true,
      treeClosed: true
    },
    ...overrides
  };
}

function childEvidence(observed: ObservedCommandOutcome): WorkPackageGateChildEvidenceV1 {
  return Object.freeze({
    status: observed.status,
    trigger: observed.trigger ?? null,
    started: observed.started,
    exitCode: observed.exitCode,
    signal: observed.signal,
    durationMs: observed.durationMs,
    stdout: observed.stdout,
    stderr: observed.stderr,
    termination: observed.termination
  });
}

test('authority probes fail closed on stderr, truncation, deadline, and exhausted cleanup budget', () => {
  expect(workPackageGateProbeOutcomeAcceptedForTests(outcome())).toBe(true);
  expect(workPackageGateProbeOutcomeAcceptedForTests(outcome({
    stderr: { bytes: 1, digest: emptyDigest, observerTruncated: false }
  }))).toBe(false);
  for (const stream of ['stdout', 'stderr'] as const) {
    expect(workPackageGateProbeOutcomeAcceptedForTests(outcome({
      [stream]: { bytes: 0, digest: emptyDigest, observerTruncated: true }
    }))).toBe(false);
  }
  expect(workPackageGateProbeOutcomeAcceptedForTests(outcome(), 100, 100)).toBe(false);
  expect(workPackageGateAuthorityProbeBudgetForTests(2)).toBeNull();
  expect(workPackageGateAuthorityProbeBudgetForTests(1_000)).toEqual({
    timeoutMs: 750,
    terminationDeadlineMs: 250,
    terminationGraceMs: 250
  });
  const capped = workPackageGateAuthorityProbeBudgetForTests(30_000)!;
  expect(capped.timeoutMs + capped.terminationDeadlineMs).toBe(30_000);
  expect(capped.terminationGraceMs).toBe(5_000);
});

test('R2 sidecar and terminal completion authority are bound to exact frozen values and paths', () => {
  const frozenOwner = Object.freeze({
    headSha: 'f29ecb73ac64aaae23b7989688c4a3ca79593d43',
    treeSha: 'dcdc37f6353a61a6770f930c54a25c22200a8829',
    worktreeDigest: 'sha256:6468cf74715c883051ce85bab5d2fd8bbad8e170d73efc48225cb906fb93740c'
  });
  expect(workPackageGateR2ExecutionSnapshotOwnerAcceptedForTests(frozenOwner)).toBe(true);
  for (const key of ['headSha', 'treeSha', 'worktreeDigest'] as const) {
    expect(workPackageGateR2ExecutionSnapshotOwnerAcceptedForTests({
      ...frozenOwner,
      [key]: key === 'worktreeDigest' ? `sha256:${'0'.repeat(64)}` : '0'.repeat(40)
    })).toBe(false);
  }

  const transactionRoot = path.join(
    repoRoot,
    '.tmp',
    'workspace',
    '.sec',
    'semantic-mutation',
    'v1',
    'transactions',
    'a'.repeat(64)
  );
  const terminalOrder = path.join(
    repoRoot,
    '.tmp',
    'workspace',
    '.sec',
    'semantic-mutation',
    'v1',
    'terminal-order'
  );
  expect(workPackageGateTerminalCompletionAuthorityPathsForTests(transactionRoot, 42)).toEqual([
    terminalOrder,
    path.join(terminalOrder, '000000000042.json'),
    path.join(terminalOrder, '.sequence-head.json')
  ]);
  expect(() => workPackageGateTerminalCompletionAuthorityPathsForTests(transactionRoot, 0)).toThrow(
    'terminal sequence'
  );
  expect(workPackageGateRecoveryRecordAuthorityPathForTests(
    transactionRoot,
    7,
    'rolled-back'
  )).toBe(path.join(transactionRoot, 'records', '000007-rolled-back.json'));
  expect(workPackageGateRecoveryRecordAuthorityPathForTests(
    transactionRoot,
    1_000_000,
    'verified'
  )).toBe(path.join(transactionRoot, 'records', '1000000-verified.json'));
  expect(workPackageGateRecoveryRecordEntryPathForTests(
    path.join(transactionRoot, 'records'),
    '1000000-verified.json'
  )).toBe(path.join(transactionRoot, 'records', '1000000-verified.json'));
  expect(() => workPackageGateRecoveryRecordEntryPathForTests(
    path.join(transactionRoot, 'records'),
    '01000000-verified.json'
  )).toThrow('noncanonical');
  expect(() => workPackageGateRecoveryRecordEntryPathForTests(
    path.join(transactionRoot, 'records'),
    '.generation.tmp'
  )).toThrow('unknown entry');
  expect(workPackageGateTerminalOrderEntryKindForTests('.sequence-head.json')).toBe('sequence-head');
  expect(workPackageGateTerminalOrderEntryKindForTests('000000000002.json')).toBe('receipt');
  expect(() => workPackageGateTerminalOrderEntryKindForTests('.completion.tmp')).toThrow('unknown entry');
});

test('production collector binds retained recovery generations and their terminal receipts', async () => {
  const fixtureParent = path.join(repoRoot, '.tmp');
  await mkdir(fixtureParent, { recursive: true });
  const fixtureRepo = await mkdtemp(path.join(fixtureParent, 'work-package-gate-retained-fixture-'));
  const snapshotRelative = '.tmp/gate-execution-snapshots/gate-d4ecb7717e828f3111ae866fa084e957-owned';
  const ownerRelative = `${snapshotRelative}.owner-v1.json`;
  const namespace = 'gate-d4ecb7717e828f3111ae866fa084e957-owned';
  const retainedNamespace = 'engineering-compiler-sm3-terminal-retention-fSCj2d';
  const transactionIdentity = 'e16b6426e3e9f84bea8c592c447a623f9f0029a2e1ada2c33f160e7b27f0536d';
  const frozenRecords = [
    '000001-prepared.json',
    '000002-authoring-committed.json',
    '000003-verified.json'
  ] as const;
  try {
    await mkdir(path.join(fixtureRepo, '.tmp', 'sm3-r2-work-package-gate'), { recursive: true });
    await mkdir(path.join(fixtureRepo, 'docs', 'evidence'), { recursive: true });
    await writeFile(
      path.join(fixtureRepo, 'docs', 'evidence', 'v0-4-semantic-mutation-apply-r2-verification.json'),
      `${JSON.stringify({
        preservedAuthority: {
          executionSnapshot: snapshotRelative,
          executionSnapshotOwner: ownerRelative,
          retainedNamespace
        }
      }, null, 2)}\n`,
      'utf8'
    );

    const snapshotRoot = path.join(fixtureRepo, ...snapshotRelative.split('/'));
    await publishWorkPackageExecutionSnapshotOwnerForTests(
      fixtureRepo,
      snapshotRoot,
      'f29ecb73ac64aaae23b7989688c4a3ca79593d43',
      'dcdc37f6353a61a6770f930c54a25c22200a8829',
      'sha256:6468cf74715c883051ce85bab5d2fd8bbad8e170d73efc48225cb906fb93740c'
    );
    const retainedWorkspace = path.join(
      snapshotRoot,
      '.tmp',
      'test-workspaces',
      namespace,
      retainedNamespace
    );
    const recoveryTransaction = path.join(
      retainedWorkspace,
      '.sec',
      'semantic-mutation',
      'v1',
      'transactions',
      transactionIdentity
    );
    const recordsDirectory = path.join(recoveryTransaction, 'records');
    const terminalOrder = path.join(
      retainedWorkspace,
      '.sec',
      'semantic-mutation',
      'v1',
      'terminal-order'
    );
    await Promise.all([mkdir(recordsDirectory, { recursive: true }), mkdir(terminalOrder, { recursive: true })]);
    const fixtureRoot = path.join(repoRoot, 'tests', 'fixtures', 'work-package-gate-retained-recovery');
    await Promise.all([
      ...frozenRecords.map((name) => copyFile(
        path.join(fixtureRoot, 'records', name),
        path.join(recordsDirectory, name)
      )),
      copyFile(
        path.join(fixtureRoot, 'terminal-order', '000000000002.json'),
        path.join(terminalOrder, '000000000002.json')
      ),
      copyFile(
        path.join(fixtureRoot, 'terminal-order', '.sequence-head.json'),
        path.join(terminalOrder, '.sequence-head.json')
      )
    ]);

    const authority = await workPackageGateProtectedPathAuthorityForTests(fixtureRepo);
    const required = new Set(
      authority.filter((entry) => entry.required).map((entry) => path.resolve(entry.path))
    );
    for (const name of frozenRecords) {
      const copied = path.join(recordsDirectory, name);
      const metadata = await lstat(copied);
      expect(metadata.isFile()).toBe(true);
      expect(metadata.isSymbolicLink()).toBe(false);
      expect(required.has(copied)).toBe(true);
    }
    expect(required.has(path.join(terminalOrder, '000000000002.json'))).toBe(true);
    expect(required.has(path.join(terminalOrder, '.sequence-head.json'))).toBe(true);
  } finally {
    await rm(fixtureRepo, { recursive: true, force: true });
  }
});

function identitySet(values: readonly string[]) {
  const canonical = [...new Set(values)].sort();
  return Object.freeze({ count: canonical.length, digest: CodexDevelopmentVerificationDigest(canonical) });
}

function census(input: {
  readonly reason?: 'observed' | 'namespace-absent';
  readonly workspaceRoots?: number;
  readonly recoveryOwners?: number;
  readonly pendingOwners?: number;
  readonly nativeResults?: number;
  readonly writerLeases?: number;
  readonly authorities?: readonly string[];
  readonly acl?: 'empty' | 'unknown';
} = {}): WorkPackageGateResidueCensusV4 {
  const reason = input.reason ?? 'observed';
  const authorities = input.authorities ?? [];
  const empty = identitySet([]);
  return Object.freeze({
    structure: Object.freeze({
      complete: true,
      reason,
      counts: Object.freeze({
        workspaceRoots: input.workspaceRoots ?? 0,
        recoveryOwners: input.recoveryOwners ?? 0,
        pendingOwners: input.pendingOwners ?? 0,
        nativeResults: input.nativeResults ?? 0,
        writerLeases: input.writerLeases ?? 0
      }),
      recoveryAuthorities: identitySet(authorities)
    }),
    aclPresentOwners: input.acl === 'unknown'
      ? Object.freeze({ complete: false, reason: 'host-tool-failed', identities: null })
      : Object.freeze({
        complete: true,
        reason: reason === 'namespace-absent' ? 'namespace-absent' : 'observed',
        identities: empty
      })
  });
}

const absentCensus = census({ reason: 'namespace-absent' });
const cleanCensus = census();

interface GateCounters {
  child: number;
  census: number;
  recovery: number;
  namespaceRemoval: number;
  snapshotRemoval: number;
  snapshotPreparation: number;
  runChildPreparation: number;
  runChildRetirement: number;
  preparedRunChildName: string | null;
  launchedRunChildName: string | null;
  launchedRunChildAssignment: string | null;
}

function supervisorChallengeEndpointForTest(snapshotRoot: string): string {
  const endpointDigest = rawJsonDigest({
    domain: 'sec-test-workspace-supervisor-challenge-endpoint-v1',
    executionSnapshotRoot: canonicalFilesystemIdentityForTests(snapshotRoot)
  }).slice('sha256:'.length, 'sha256:'.length + 40);
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\sec-wpg-${endpointDigest}`
    : `\0sec-wpg-${endpointDigest}`;
}

async function consumeAuthorizedChallengeForTest(
  serializedAssignment: string,
  snapshotRoot: string
): Promise<void> {
  const assignment = JSON.parse(serializedAssignment) as Readonly<Record<string, unknown>>;
  const draft = Object.freeze({
    schema: 'sec-test-workspace-supervisor-challenge-v1',
    name: assignment.name,
    nonceDigest: assignment.nonceDigest,
    supervisorLeaseDigest: assignment.supervisorLeaseDigest,
    assignmentDigest: assignment.assignmentDigest
  });
  const challenge = Object.freeze({ ...draft, challengeDigest: rawJsonDigest(draft) });
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection(supervisorChallengeEndpointForTest(snapshotRoot));
    let bytes = Buffer.alloc(0);
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      error === undefined ? resolve() : reject(error);
    };
    socket.setTimeout(5_000, () => finish(new Error('test supervisor challenge timed out')));
    socket.once('connect', () => socket.write(`${JSON.stringify(challenge)}\n`));
    socket.once('error', (error) => finish(error));
    socket.on('data', (chunk: Buffer) => {
      bytes = Buffer.concat([bytes, chunk]);
      const newline = bytes.indexOf(0x0a);
      if (newline < 0) return;
      try {
        const ack = JSON.parse(bytes.subarray(0, newline).toString('utf8')) as Readonly<Record<string, unknown>>;
        if (newline !== bytes.byteLength - 1 ||
          ack.schema !== 'sec-test-workspace-supervisor-challenge-ack-v1' ||
          ack.challengeDigest !== challenge.challengeDigest) {
          finish(new Error('test supervisor challenge acknowledgement is invalid'));
          return;
        }
        finish();
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

function fakeDependencies(input: {
  readonly censuses?: readonly WorkPackageGateResidueCensusV4[];
  readonly child?: ObservedCommandOutcome;
  readonly childOutput?: readonly { readonly stream: 'stdout' | 'stderr'; readonly bytes: Uint8Array }[];
  readonly recovery?: 'not-needed' | 'completed' | 'failed';
  readonly crashStage?: WorkPackageGateCrashStageV4;
  readonly realRunChild?: boolean;
  readonly consumeChallenge?: boolean;
  readonly pauseAtCheckpoint?: Readonly<{ stage: WorkPackageGateCrashStageV4; markerPath: string }>;
  readonly pauseAfterRunChildEffectPath?: string;
} = {}): { readonly overrides: Partial<WorkPackageGateDependencies>; readonly counters: GateCounters } {
  const counters: GateCounters = {
    child: 0,
    census: 0,
    recovery: 0,
    namespaceRemoval: 0,
    snapshotRemoval: 0,
    snapshotPreparation: 0,
    runChildPreparation: 0,
    runChildRetirement: 0,
    preparedRunChildName: null,
    launchedRunChildName: null,
    launchedRunChildAssignment: null
  };
  const censuses = input.censuses ?? (input.realRunChild
    ? [absentCensus, absentCensus, absentCensus, absentCensus]
    : [absentCensus, cleanCensus, cleanCensus, absentCensus]);
  let censusIndex = 0;
  let now = 0;
  let crashInjected = false;
  const overrides: Partial<WorkPackageGateDependencies> = {
    pathExists: async (filePath) => historicalFrozenTestPaths().has(path.resolve(filePath)) ||
      pathPresent(filePath),
    readText: async (filePath) => {
      const trackedManifest = frozenManifestPaths.get(path.resolve(filePath));
      return trackedManifest === undefined
        ? readFile(filePath, 'utf8')
        : frozenManifestText(trackedManifest);
    },
    protectedLedger: syntheticProtectedLedger,
    filesystemIdentityExpectation: syntheticFilesystemIdentityExpectation,
    protectedPathAuthority: async () => fakeProtectedPathAuthority,
    gitRevision: (_root, value) => value === 'HEAD' ? head : tree,
    worktreeDigest: async () => worktree,
    prepareRunChildNamespace: async (snapshotRoot, namespace) => {
      if (input.realRunChild) {
        return workPackageGatePrepareRunChildNamespaceForTests(snapshotRoot, namespace);
      }
      const namespaceRoot = path.join(snapshotRoot, '.tmp', 'test-workspaces', namespace);
      return Object.freeze({
        schema: 'sec-physical-no-follow-v1' as const,
        path: namespaceRoot,
        finalPath: namespaceRoot,
        device: 'namespace-device',
        inode: 'namespace-inode',
        objectId: 'namespace-object'
      });
    },
    prepareExecutionSnapshot: async (_sourceRoot, snapshotRoot) => {
      counters.snapshotPreparation += 1;
      if (input.realRunChild) {
        await mkdir(snapshotRoot, { recursive: true });
        const snapshotPlatform = path.join(snapshotRoot, 'platform');
        if (!await pathPresent(snapshotPlatform)) {
          await cp(path.join(repoRoot, 'platform'), snapshotPlatform, { recursive: true });
        }
      }
      return worktree;
    },
    removeExecutionSnapshot: async () => {
      counters.snapshotRemoval += 1;
      return true;
    },
    prepareRunChild: async (
      namespaceRoot,
      name,
      nonceDigest,
      issuerProcessId,
      boundSupervisorLeaseDigest,
      namespaceDevice,
      namespaceInode,
      adoptAfterDurableAttempt
    ) => {
      counters.runChildPreparation += 1;
      counters.preparedRunChildName = name;
      if (input.realRunChild) {
        const result = await workPackageGatePrepareExactRunChildForTests(
          namespaceRoot,
          name,
          nonceDigest,
          issuerProcessId,
          boundSupervisorLeaseDigest,
          namespaceDevice,
          namespaceInode,
          adoptAfterDurableAttempt
        );
        if (input.pauseAfterRunChildEffectPath !== undefined) {
          await writeFile(input.pauseAfterRunChildEffectPath, JSON.stringify(result), 'utf8');
          await new Promise<never>(() => undefined);
        }
        return result;
      }
      const draft = {
        schema: 'work-package-gate-run-child-identity-v1' as const,
        name,
        nonceDigest,
        issuerProcessId,
        supervisorLeaseDigest: boundSupervisorLeaseDigest,
        namespaceDevice,
        namespaceInode,
        dev: '1',
        ino: '2'
      };
      return Object.freeze({ ...draft, identityDigest: rawJsonDigest(draft) });
    },
    assertRunChild: input.realRunChild
      ? workPackageGateAssertRunChildForTests
      : async () => undefined,
    retireUnconsumedRunChild: async (namespaceRoot, runChild) => {
      counters.runChildRetirement += 1;
      if (input.realRunChild) {
        await workPackageGateRetireRunChildForTests(namespaceRoot, runChild);
      }
    },
    runChild: async (command, _args, options) => {
      counters.child += 1;
      const childEnv = options.env ?? {};
      counters.launchedRunChildName = childEnv.SEC_TEST_WORKSPACE_RUN_CHILD ?? null;
      counters.launchedRunChildAssignment = childEnv.SEC_TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT ?? null;
      for (const output of input.childOutput ?? []) options.onOutput?.(output.stream, output.bytes);
      if (input.consumeChallenge !== false && counters.launchedRunChildAssignment !== null) {
        if (input.realRunChild) {
          const moduleUrl = pathToFileURL(path.join(
            options.cwd,
            'platform',
            'dev-runner',
            'env-manager.ts'
          )).href;
          const source = `
            import {
              consumeTestWorkspaceSupervisorChallengeV1,
              parseTestWorkspaceRunChildAssignmentV1,
              prepareTestWorkspaceRunV1,
              settlePreparedTestWorkspaceRunV1
            } from ${JSON.stringify(moduleUrl)};
            const parentNamespace = process.env.SEC_TEST_WORKSPACE_NAMESPACE;
            const runChild = process.env.SEC_TEST_WORKSPACE_RUN_CHILD;
            const assignment = parseTestWorkspaceRunChildAssignmentV1(
              process.env.SEC_TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT,
              parentNamespace,
              runChild
            );
            await consumeTestWorkspaceSupervisorChallengeV1(assignment);
            const cleanup = prepareTestWorkspaceRunV1(process.env, assignment);
            settlePreparedTestWorkspaceRunV1(cleanup);
          `;
          return runObservedCommand(command, ['-e', source], options);
        }
        await consumeAuthorizedChallengeForTest(
          counters.launchedRunChildAssignment,
          options.cwd
        );
      }
      return input.child ?? outcome();
    },
    census: async () => {
      counters.census += 1;
      const value = censuses[Math.min(censusIndex, censuses.length - 1)];
      censusIndex += 1;
      if (!value) throw new Error('missing fake census');
      return value;
    },
    sideEffectCensus: async (stage) => {
      counters.census += 1;
      const logicalIndex = stage === 'child' ? 0 : stage === 'recovery' ? 1 :
        stage === 'namespace-removal' ? 2 : 3;
      const value = censuses[Math.min(logicalIndex, censuses.length - 1)];
      if (!value) throw new Error('missing fake side-effect census');
      return value;
    },
    recoverOwnedNamespace: async () => {
      counters.recovery += 1;
      return input.recovery ?? 'completed';
    },
    removeNamespace: async (namespaceRoot, _deadlineAtMs, runChild) => {
      counters.namespaceRemoval += 1;
      return input.realRunChild
        ? workPackageGateRemoveOwnedNamespaceForTests(namespaceRoot, runChild)
        : true;
    },
    wallClock: () => new Date('2026-07-14T00:00:00.000Z'),
    monotonicNowMs: () => ++now,
    afterCheckpoint: async (stage) => {
      if (stage === input.pauseAtCheckpoint?.stage) {
        await writeFile(input.pauseAtCheckpoint.markerPath, stage, 'utf8');
        await new Promise<never>(() => undefined);
      }
      if (stage === input.crashStage && !crashInjected) {
        crashInjected = true;
        throw new Error(`synthetic crash: ${stage}`);
      }
    }
  };
  return { overrides, counters };
}

function rawJsonDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')}`;
}

async function ownerRecords(workspaceRoot: string, transactionRoot: string): Promise<{
  readonly recovery: Readonly<Record<string, unknown>>;
  readonly provisional: Readonly<Record<string, unknown>>;
}> {
  const stagingRoot = path.join(transactionRoot, 'workspace');
  const workspaceCanonical = await realpath(workspaceRoot);
  const workspaceMetadata = await stat(workspaceCanonical);
  const workspaceIdentityDigest = rawJsonDigest({
    domain: 'workspace-write-lease-workspace-identity-v1',
    canonical: workspaceCanonical,
    dev: String(workspaceMetadata.dev),
    ino: String(workspaceMetadata.ino)
  });
  const stagingCanonical = await realpath(stagingRoot);
  const stagingMetadata = await lstat(stagingRoot);
  const foldedStaging = process.platform === 'win32'
    ? path.resolve(stagingCanonical).toLocaleLowerCase('en-US')
    : path.resolve(stagingCanonical);
  const stagingIdentityDigest = rawJsonDigest({
    domain: 'windows-appcontainer-staging-identity-v1',
    canonical: foldedStaging,
    dev: String(stagingMetadata.dev),
    ino: String(stagingMetadata.ino)
  });
  const rootDigest = rawJsonDigest({
    domain: 'windows-appcontainer-staging-path-v1',
    path: foldedStaging
  }).slice(7, 19);
  const identityDigest = rawJsonDigest({
    domain: 'windows-appcontainer-profile-identity-v1',
    stagingIdentityDigest
  }).slice(7, 31);
  const appContainerName = `sec.sm3.${rootDigest}.${identityDigest}`;
  return Object.freeze({
    recovery: Object.freeze({
      formatVersion: 'windows-appcontainer-recovery-owner-v1',
      workspaceIdentityDigest,
      stagingIdentityDigest,
      stagingDirectoryName: 'workspace',
      runtimeRelativePath: '.sm3r',
      resultFileName: '.semantic-mutation-appcontainer-result-v1.json',
      appContainerName,
      appContainerSid: 'S-1-15-2-1-2-3-4-5-6-7'
    }),
    provisional: Object.freeze({
      formatVersion: 'windows-appcontainer-provisional-owner-v1',
      workspaceIdentityDigest,
      stagingIdentityDigest,
      stagingDirectoryName: 'workspace',
      hostBunConfigRelativePath: '.sm3h',
      appContainerName
    })
  });
}

test('diagnostic parser is stream-local, raw-byte bounded, and fail closed', () => {
  const files = ['tests/unit/alpha.test.ts', 'tests/unit/beta.test.ts'];
  const failed = childEvidence(outcome({ status: 'exited', exitCode: 1 }));
  const actionable = workPackageGateFailureIndexForTests(files, [
    { stream: 'stdout', chunk: 'tests/unit/alpha.' },
    { stream: 'stdout', chunk: 'test.ts:\r\n\u001b[31m  (fail) case\u001b[0m' }
  ], failed);
  expect(actionable).toMatchObject({
    status: 'actionable',
    selectionIndexes: [0],
    failureMarkerCount: 1,
    unmappedMarkerCount: 0
  });

  const crossStream = workPackageGateFailureIndexForTests(files, [
    { stream: 'stdout', chunk: 'tests/unit/alpha.test.ts\n' },
    { stream: 'stderr', chunk: '(fail) cross stream\n' }
  ], failed);
  expect(crossStream).toMatchObject({ status: 'non-actionable', unmappedMarkerCount: 1 });

  for (const invalid of [
    [{ stream: 'stdout' as const, chunk: new Uint8Array([0xc3, 0x28, 0x0a]) }],
    [{ stream: 'stdout' as const, chunk: '\u001b[2J(fail) invalid ANSI\n' }],
    [{ stream: 'stdout' as const, chunk: `${'x'.repeat(8 * 1024 + 1)}\n` }],
    [{ stream: 'stdout' as const, chunk: 'tests/unit/alpha.test.ts\n(failure) malformed\n' }]
  ]) {
    expect(workPackageGateFailureIndexForTests(files, invalid, failed).status).toBe('non-actionable');
  }
  const reset = workPackageGateFailureIndexForTests(files, [
    { stream: 'stdout', chunk: 'tests/unit/alpha.test.ts\nC:\\repo\\tests\\unit\\beta.test.ts\n(fail) reset\n' }
  ], failed);
  expect(reset.unmappedMarkerCount).toBe(1);
  const truncated = workPackageGateFailureIndexForTests(files, [
    { stream: 'stdout', chunk: new Uint8Array(1024 * 1024 + 1) }
  ], failed);
  expect(truncated.observerTruncated).toBe(true);
  expect(truncated.status).toBe('non-actionable');
});

test('namespace scanner authorizes only canonical bound owner records and rejects ambiguous files', async () => {
  const namespaceRoot = path.join(repoRoot, '.tmp', `synthetic-owner-census-${randomUUID()}`);
  const parentNamespace = `owner-census-${randomUUID()}`;
  const runChild = await workPackageGatePrepareRunChildForTests(
    namespaceRoot,
    parentNamespace,
    'a'.repeat(64),
    process.pid,
    supervisorLeaseDigest
  );
  const workspaceRoot = path.join(namespaceRoot, runChild.name, 'workspace-a');
  const transactionRoot = path.join(
    workspaceRoot,
    '.sec',
    'semantic-mutation',
    'v1',
    'transactions',
    'a'.repeat(64)
  );
  const stagingRoot = path.join(transactionRoot, 'workspace');
  const recoveryName = '.semantic-mutation-appcontainer-owner-v1.json';
  const provisionalName = '.semantic-mutation-appcontainer-provisional-owner-v1.json';
  try {
    await mkdir(stagingRoot, { recursive: true });
    const records = await ownerRecords(workspaceRoot, transactionRoot);
    for (const [name, record, expected] of [
      [recoveryName, records.recovery, { recoveryOwners: 1, pendingOwners: 0 }],
      [`${recoveryName}.pending-v1`, records.recovery, { recoveryOwners: 0, pendingOwners: 1 }],
      [provisionalName, records.provisional, { recoveryOwners: 0, pendingOwners: 1 }],
      [`${provisionalName}.pending-v1`, records.provisional, { recoveryOwners: 0, pendingOwners: 1 }]
    ] as const) {
      const marker = path.join(transactionRoot, name);
      await writeFile(marker, JSON.stringify(record), 'utf8');
      const scanned = await workPackageGateNamespaceStructureForTests(namespaceRoot, runChild);
      expect(scanned.counts).toMatchObject(expected);
      expect(scanned.recoveryAuthorityIdentities).toHaveLength(1);
      await rm(marker, { force: true });
    }

    const malformed = path.join(transactionRoot, recoveryName);
    await writeFile(malformed, '{}', 'utf8');
    await expect(workPackageGateNamespaceStructureForTests(namespaceRoot, runChild))
      .rejects.toThrow('owner schema');
    await rm(malformed, { force: true });

    const source = path.join(transactionRoot, 'owner-source.json');
    await writeFile(source, JSON.stringify(records.recovery), 'utf8');
    await link(source, malformed);
    await expect(workPackageGateNamespaceStructureForTests(namespaceRoot, runChild))
      .rejects.toThrow(/alias|identity|regular file/);
    await rm(malformed, { force: true });
    await rm(source, { force: true });

    const foreignSibling = path.join(namespaceRoot, 'foreign-sibling');
    await mkdir(foreignSibling);
    await expect(workPackageGateNamespaceStructureForTests(namespaceRoot, runChild))
      .rejects.toThrow('foreign top-level entry');
    await rm(foreignSibling, { recursive: true, force: true });

    const nestedWorkspace = path.join(namespaceRoot, runChild.name, 'extra-layer', 'workspace-b');
    const nestedTransaction = path.join(
      nestedWorkspace,
      '.sec',
      'semantic-mutation',
      'v1',
      'transactions',
      'b'.repeat(64)
    );
    await mkdir(path.join(nestedTransaction, 'workspace'), { recursive: true });
    const nestedRecords = await ownerRecords(nestedWorkspace, nestedTransaction);
    await writeFile(
      path.join(nestedTransaction, recoveryName),
      JSON.stringify(nestedRecords.recovery),
      'utf8'
    );
    await expect(workPackageGateNamespaceStructureForTests(namespaceRoot, runChild))
      .rejects.toThrow('outside its exact run child');
    await rm(path.join(namespaceRoot, runChild.name, 'extra-layer'), { recursive: true, force: true });

    const hostileLink = path.join(namespaceRoot, 'foreign-link');
    await symlink(
      path.join(namespaceRoot, runChild.name),
      hostileLink,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    await expect(workPackageGateNamespaceStructureForTests(namespaceRoot, runChild))
      .rejects.toThrow(/foreign top-level|identity|reparse|ambiguous/);
    if (process.platform === 'win32') await rmdir(hostileLink);
    else await unlink(hostileLink);

    expect(await workPackageGateRemoveOwnedNamespaceForTests(namespaceRoot, runChild)).toBe(true);
    await expect(lstat(namespaceRoot)).rejects.toThrow();
  } finally {
    await rm(namespaceRoot, { recursive: true, force: true });
  }
});

test('namespace scanner consumes the shared v2 workspace lease inspector for active and terminal states', async () => {
  const namespaceRoot = path.join(repoRoot, '.tmp', `synthetic-lease-census-${randomUUID()}`);
  const runChild = await workPackageGatePrepareRunChildForTests(
    namespaceRoot,
    `lease-census-${randomUUID()}`,
    'b'.repeat(64),
    process.pid,
    supervisorLeaseDigest
  );
  const workspaceRoot = path.join(namespaceRoot, runChild.name, 'workspace-a');
  try {
    await mkdir(workspaceRoot, { recursive: true });
    const manager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 10,
      staleAfterMs: 100,
      createId: (() => {
        let next = 0;
        return () => `gate-active-${next += 1}`;
      })()
    });
    const active = await manager.acquire(workspaceRoot);
    const activeCensus = await workPackageGateNamespaceStructureForTests(namespaceRoot, runChild);
    expect(activeCensus.counts).toMatchObject({ workspaceRoots: 0, writerLeases: 1 });
    expect(activeCensus.recoveryAuthorityIdentities).toHaveLength(1);
    expect(activeCensus.recoveryAuthorityIdentities[0]).toStartWith('workspace-write-lease:active:sha256:');
    await active.release();

    const releasedCensus = await workPackageGateNamespaceStructureForTests(namespaceRoot, runChild);
    expect(releasedCensus.counts.writerLeases).toBe(1);
    expect(releasedCensus.recoveryAuthorityIdentities[0])
      .toStartWith('workspace-write-lease:quiescent:sha256:');

    await writeFile(
      path.join(workspaceRoot, '.sec', 'workspace-write-lease', '0000000000000001.owner.json'),
      '{}',
      'utf8'
    );
    await expect(workPackageGateNamespaceStructureForTests(namespaceRoot, runChild))
      .rejects.toThrow(/owner record|generation identity|terminal identity/);
  } finally {
    await rm(namespaceRoot, { recursive: true, force: true });
  }

  const recoveryNamespace = path.join(repoRoot, '.tmp', `synthetic-lease-recovery-${randomUUID()}`);
  const recoveryRunChild = await workPackageGatePrepareRunChildForTests(
    recoveryNamespace,
    `lease-recovery-${randomUUID()}`,
    'c'.repeat(64),
    process.pid,
    supervisorLeaseDigest
  );
  const recoveryWorkspace = path.join(recoveryNamespace, recoveryRunChild.name, 'workspace-a');
  try {
    await mkdir(recoveryWorkspace, { recursive: true });
    const strandedManager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 1,
      staleAfterMs: 10,
      hostname: 'gate-recovery-host',
      pid: 42_001,
      processNonce: 'process:gate-recovery-stranded',
      now: () => 0,
      createId: (() => {
        let next = 0;
        return () => `gate-stranded-${next += 1}`;
      })(),
      ownerPublicationDirectorySync: async () => {
        throw new Error('synthetic-owner-publication-fsync-failure');
      }
    });
    await expect(strandedManager.acquire(recoveryWorkspace))
      .rejects.toMatchObject({ code: 'WORKSPACE-WRITE-LEASE-004' });
    const recoveryManager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 1,
      staleAfterMs: 10,
      hostname: 'gate-recovery-host',
      pid: 42_002,
      processNonce: 'process:gate-recovery-successor',
      now: () => 100,
      createId: (() => {
        let next = 0;
        return () => `gate-recovery-${next += 1}`;
      })(),
      processAlive: () => 'dead'
    });
    const recovered = await recoveryManager.acquire(recoveryWorkspace);
    await recovered.release();
    const recoveredCensus = await workPackageGateNamespaceStructureForTests(
      recoveryNamespace,
      recoveryRunChild
    );
    expect(recoveredCensus.counts.writerLeases).toBe(1);
    expect(recoveredCensus.recoveryAuthorityIdentities[0])
      .toStartWith('workspace-write-lease:quiescent:sha256:');

    await writeFile(
      path.join(recoveryWorkspace, '.sec', 'workspace-write-lease', 'owner.json'),
      '{}',
      'utf8'
    );
    await expect(workPackageGateNamespaceStructureForTests(recoveryNamespace, recoveryRunChild))
      .rejects.toThrow(/Legacy workspace writer lease|legacy/i);
  } finally {
    await rm(recoveryNamespace, { recursive: true, force: true });
  }
});

test('namespace remover preserves a replacement introduced after its frozen physical census', async () => {
  const namespaceRoot = path.join(repoRoot, '.tmp', `synthetic-removal-replacement-${randomUUID()}`);
  const runChild = await workPackageGatePrepareRunChildForTests(
    namespaceRoot,
    `removal-replacement-${randomUUID()}`,
    'd'.repeat(64),
    process.pid,
    supervisorLeaseDigest
  );
  const runChildRoot = path.join(namespaceRoot, runChild.name);
  const displacedRoot = path.join(namespaceRoot, 'displaced-original');
  try {
    const removed = await workPackageGateRemoveOwnedNamespaceForTests(
      namespaceRoot,
      runChild,
      async () => {
        await rename(runChildRoot, displacedRoot);
        await mkdir(runChildRoot);
        await writeFile(path.join(runChildRoot, 'replacement-owner.txt'), 'foreign', 'utf8');
      }
    );

    expect(removed).toBe(false);
    expect(await readFile(path.join(runChildRoot, 'replacement-owner.txt'), 'utf8')).toBe('foreign');
    expect((await lstat(displacedRoot)).isDirectory()).toBe(true);
  } finally {
    await rm(namespaceRoot, { recursive: true, force: true });
  }
});

test('namespace remover preserves a foreign sibling inserted after its frozen physical census', async () => {
  const namespaceRoot = path.join(repoRoot, '.tmp', `synthetic-removal-insertion-${randomUUID()}`);
  const runChild = await workPackageGatePrepareRunChildForTests(
    namespaceRoot,
    `removal-insertion-${randomUUID()}`,
    'e'.repeat(64),
    process.pid,
    supervisorLeaseDigest
  );
  const foreignSibling = path.join(namespaceRoot, 'foreign-sibling');
  try {
    const removed = await workPackageGateRemoveOwnedNamespaceForTests(
      namespaceRoot,
      runChild,
      async () => {
        await mkdir(foreignSibling);
        await writeFile(path.join(foreignSibling, 'owner.txt'), 'foreign', 'utf8');
      }
    );

    expect(removed).toBe(false);
    expect(await readFile(path.join(foreignSibling, 'owner.txt'), 'utf8')).toBe('foreign');
    await expect(lstat(path.join(namespaceRoot, runChild.name))).rejects.toThrow();
  } finally {
    await rm(namespaceRoot, { recursive: true, force: true });
  }
});

test('public runner accepts only exact V4 manifest and run identity before child launch', async () => {
  for (const invalid of [
    { ...v4Options, manifestPath: 'docs/work-packages/sm3-r2-bounded-runtime-gate-v1.md' },
    { ...v4Options, runDir: '.tmp/sm3-r3-work-package-gate' },
    { ...v4Options, runDir: '.tmp/sm3-r3-v2-work-package-gate' },
    { ...v4Options, runDir: '.tmp/sm3-r3-v3-work-package-gate' }
  ]) {
    const { overrides, counters } = fakeDependencies();
    await expect(runWorkPackageGate(invalid, overrides)).rejects.toThrow('exact V4 authority');
    expect(counters.child).toBe(0);
  }
});

test('protected ledger drift stops before checkpoint publication and child launch', async () => {
  const { overrides, counters } = fakeDependencies();
  await expect(runWorkPackageGate(v4Options, {
    ...overrides,
    readBytes: async (filePath) => filePath.endsWith('custody.txt')
      ? Buffer.from('drift')
      : readFile(filePath)
  })).rejects.toThrow('protected ledger drifted');
  expect(counters.child).toBe(0);
  await expect(readFile(path.join(v4RunDir, 'checkpoint.json'), 'utf8')).rejects.toThrow();
});

test('custody ledger canonicalizes checkout CRLF while local artifacts remain byte-exact', async () => {
  const custodyPath = 'docs/evidence/v0-4-semantic-mutation-apply-r2-verification.json';
  const checkoutBytes = await readFile(path.join(repoRoot, ...custodyPath.split('/')));
  expect(workPackageGateProtectedLedgerDigestForTests('custody', checkoutBytes))
    .toBe(WORK_PACKAGE_GATE_CUSTODY_LEDGER_V4[custodyPath]);

  const lf = Buffer.from('first\nsecond\n', 'utf8');
  const crlf = Buffer.from('first\r\nsecond\r\n', 'utf8');
  expect(workPackageGateProtectedLedgerDigestForTests('custody', crlf))
    .toBe(workPackageGateProtectedLedgerDigestForTests('custody', lf));
  expect(workPackageGateProtectedLedgerDigestForTests('custody', Buffer.from('first\nchanged\n', 'utf8')))
    .not.toBe(workPackageGateProtectedLedgerDigestForTests('custody', lf));
  expect(workPackageGateProtectedLedgerDigestForTests('local-artifact', crlf))
    .not.toBe(workPackageGateProtectedLedgerDigestForTests('local-artifact', lf));
});

test('manifest parsing localizes EOL normalization while checkpoint and journal reads stay byte-exact', async () => {
  const fixtureRoot = await mkdtemp(path.join(repoRoot, '.tmp', 'work-package-gate-raw-text-'));
  const rawPath = path.join(fixtureRoot, 'checkpoint-or-journal.jsonl');
  const rawSource = '{"sequence":1}\r\n{"sequence":2}\r\n';
  try {
    await writeFile(rawPath, rawSource, 'utf8');
    expect(await workPackageGateReadTextForTests(rawPath)).toBe(rawSource);

    const fake = fakeDependencies();
    const readText = fake.overrides.readText!;
    const result = await runWorkPackageGate(v4Options, {
      ...fake.overrides,
      readText: async (filePath) => {
        const source = await readText(filePath);
        return frozenManifestPaths.has(path.resolve(filePath))
          ? source.replace(/\n/gu, '\r\n')
          : source;
      }
    });
    expect(result.evidence.status).toBe('passed');
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('dynamic protected authority additions are fatal after consuming the attempt and suppressing the side effect', async () => {
  const { overrides, counters } = fakeDependencies();
  let collections = 0;
  await expect(runWorkPackageGate(v4Options, {
    ...overrides,
    protectedPathAuthority: async () => {
      collections += 1;
      return collections === 1
        ? fakeProtectedPathAuthority
        : Object.freeze([
          ...fakeProtectedPathAuthority,
          Object.freeze({
            path: path.join(repoRoot, '.tmp', 'synthetic-new-protected-record.json'),
            required: false
          })
        ]);
    }
  })).rejects.toThrow('protected path authority changed');
  expect(collections).toBeGreaterThanOrEqual(2);
  expect(counters).toMatchObject({
    child: 0,
    recovery: 0,
    namespaceRemoval: 0,
    snapshotRemoval: 0,
    snapshotPreparation: 0
  });
});

test('post-attempt authority drift is fatal and suppresses child launch and namespace deletion', async () => {
  for (const stage of ['child-attempted', 'namespace-removal-attempted'] as const) {
    await cleanV4Publications();
    const fake = fakeDependencies();
    let drifted = false;
    await expect(runWorkPackageGate(v4Options, {
      ...fake.overrides,
      protectedPathAuthority: async () => drifted
        ? Object.freeze([
          ...fakeProtectedPathAuthority,
          Object.freeze({
            path: path.join(repoRoot, '.tmp', `synthetic-${stage}-protected-record.json`),
            required: false
          })
        ])
        : fakeProtectedPathAuthority,
      afterCheckpoint: async (observedStage) => {
        if (observedStage === stage) drifted = true;
      }
    })).rejects.toThrow('protected path authority changed');
    if (stage === 'child-attempted') expect(fake.counters.child).toBe(0);
    if (stage === 'namespace-removal-attempted') expect(fake.counters.namespaceRemoval).toBe(0);
    expect(fake.counters.snapshotRemoval).toBe(0);
  }
});

test('post-attempt ACL disposition drift does not block owned recovery or authorized deletion', async () => {
  const owner = 'recovery-owner:workspace/.sec/transaction';
  const fake = fakeDependencies({
    censuses: [
      absentCensus,
      census({ recoveryOwners: 1, authorities: [owner], acl: 'unknown' }),
      cleanCensus,
      absentCensus
    ],
    recovery: 'completed'
  });
  const defaultSideEffectCensus = fake.overrides.sideEffectCensus!;
  const result = await runWorkPackageGate(v4Options, {
    ...fake.overrides,
    sideEffectCensus: async (stage, namespaceRoot, deadlineAtMs, probeAcl) => {
      if (stage === 'recovery') {
        return census({ recoveryOwners: 1, authorities: [owner] });
      }
      if (stage === 'namespace-removal') return census({ acl: 'unknown' });
      return defaultSideEffectCensus(stage, namespaceRoot, deadlineAtMs, probeAcl);
    }
  });
  expect(result.evidence.status).toBe('passed');
  expect(fake.counters.recovery).toBe(1);
  expect(fake.counters.namespaceRemoval).toBe(1);
});

test('post-attempt run directory drift is fatal and never overwritten by stale checkpoint state', async () => {
  const fake = fakeDependencies();
  await expect(runWorkPackageGate(v4Options, {
    ...fake.overrides,
    afterCheckpoint: async (stage) => {
      if (stage === 'child-attempted') {
        await writeFile(path.join(v4RunDir, 'foreign.txt'), 'foreign', 'utf8');
      }
    }
  })).rejects.toThrow('foreign content');
  expect(fake.counters.child).toBe(0);
  expect(await readFile(path.join(v4RunDir, 'foreign.txt'), 'utf8')).toBe('foreign');
});

test('post-attempt candidate namespace drift suppresses child launch and pending-publication drift is fatal', async () => {
  for (const drift of ['namespace-census', 'pending-publication'] as const) {
    await cleanV4Publications();
    const fake = fakeDependencies();
    const defaultSideEffectCensus = fake.overrides.sideEffectCensus!;
    const running = runWorkPackageGate(v4Options, {
      ...fake.overrides,
      sideEffectCensus: async (stage, namespaceRoot, deadlineAtMs, probeAcl) =>
        drift === 'namespace-census' && stage === 'child'
          ? census({ nativeResults: 1 })
          : defaultSideEffectCensus(stage, namespaceRoot, deadlineAtMs, probeAcl),
      afterCheckpoint: async (stage) => {
        if (drift === 'pending-publication' && stage === 'child-attempted') {
          await mkdir(v4PendingDir, { recursive: true });
        }
      }
    });
    if (drift === 'pending-publication') {
      await expect(running).rejects.toThrow('pending checkpoint publication reappeared');
    } else {
      expect((await running).evidence.status).toBe('unknown');
    }
    expect(fake.counters.child).toBe(0);
  }
});

test('post-attempt run directory drift is fatal during terminal publications', async () => {
  for (const stage of [
    'completed-event-publication-attempted',
    'evidence-publication-attempted'
  ] as const) {
    await cleanV4Publications();
    const fake = fakeDependencies();
    await expect(runWorkPackageGate(v4Options, {
      ...fake.overrides,
      afterCheckpoint: async (observedStage) => {
        if (observedStage === stage) {
          await writeFile(path.join(v4RunDir, 'foreign.txt'), 'foreign', 'utf8');
        }
      }
    })).rejects.toThrow('foreign content');
    expect(fake.counters.child).toBe(1);
    expect(await readFile(path.join(v4RunDir, 'foreign.txt'), 'utf8')).toBe('foreign');
  }
});

test('post-attempt pending publication drift is fatal during terminal publications', async () => {
  for (const stage of [
    'completed-event-publication-attempted',
    'evidence-publication-attempted'
  ] as const) {
    await cleanV4Publications();
    const fake = fakeDependencies();
    await expect(runWorkPackageGate(v4Options, {
      ...fake.overrides,
      afterCheckpoint: async (observedStage) => {
        if (observedStage === stage) {
          await mkdir(v4PendingDir, { recursive: true });
        }
      }
    })).rejects.toThrow('pending checkpoint publication reappeared');
    expect(fake.counters.child).toBe(1);
    expect(await lstat(v4PendingDir)).toBeDefined();
  }
});

test('publication replay revalidates authority before completing the durable terminal journal attempt', async () => {
  const crashed = fakeDependencies({ crashStage: 'completed-event-publication-attempted' });
  await expect(runWorkPackageGate(v4Options, crashed.overrides))
    .rejects.toThrow('synthetic crash: completed-event-publication-attempted');
  const journalBeforeResume = await readFile(path.join(v4RunDir, 'events.jsonl'), 'utf8');
  expect(journalBeforeResume).not.toContain('"kind":"completed"');
  await mkdir(v4PendingDir, { recursive: true });

  await expect(runWorkPackageGate(v4Options, {
    ...crashed.overrides,
    afterCheckpoint: async () => undefined
  })).rejects.toThrow('pending checkpoint publication reappeared');
  expect(await readFile(path.join(v4RunDir, 'events.jsonl'), 'utf8')).toBe(journalBeforeResume);
  expect(await Bun.file(path.join(v4RunDir, 'evidence.json')).exists()).toBe(false);
  expect(crashed.counters.child).toBe(1);
});

test('advanced pending checkpoint cannot be adopted as an initial publication', async () => {
  const completed = fakeDependencies();
  await runWorkPackageGate(v4Options, completed.overrides);
  const advanced = await readFile(path.join(v4RunDir, 'checkpoint.json'), 'utf8');
  await cleanV4Publications();
  await mkdir(v4PendingDir, { recursive: true });
  await writeFile(path.join(v4PendingDir, 'checkpoint.json'), advanced, 'utf8');

  const fresh = fakeDependencies();
  await expect(runWorkPackageGate(v4Options, fresh.overrides))
    .rejects.toThrow('exact initial publication');
  expect(fresh.counters.child).toBe(0);
});

test('existing run directory rejects foreign content and journal subject drift before side effects', async () => {
  {
    const fake = fakeDependencies({ crashStage: 'snapshot-preparation-attempted' });
    await expect(runWorkPackageGate(v4Options, fake.overrides))
      .rejects.toThrow('synthetic crash: snapshot-preparation-attempted');
    await writeFile(path.join(v4RunDir, 'foreign.txt'), 'foreign', 'utf8');
    await expect(runWorkPackageGate(v4Options, fake.overrides)).rejects.toThrow('foreign content');
    expect(fake.counters.child).toBe(0);
    expect(fake.counters.recovery).toBe(0);
    expect(fake.counters.namespaceRemoval).toBe(0);
    expect(fake.counters.snapshotRemoval).toBe(0);
  }

  await cleanV4Publications();
  const fake = fakeDependencies({ crashStage: 'snapshot-preparation-attempted' });
  await expect(runWorkPackageGate(v4Options, fake.overrides))
    .rejects.toThrow('synthetic crash: snapshot-preparation-attempted');
  const checkpointPath = path.join(v4RunDir, 'checkpoint.json');
  const checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8')) as Record<string, any>;
  const original = checkpoint.journal.events[0];
  const tampered = finalizeWorkPackageGateEventV4({
    sequence: original.sequence,
    kind: original.kind,
    elapsedMs: original.elapsedMs,
    phase: original.phase,
    stdoutBytes: original.stdoutBytes,
    stderrBytes: original.stderrBytes,
    subject: { tampered: true },
    previousDigest: original.previousDigest
  });
  checkpoint.journal.events = [tampered];
  checkpoint.journal.digest = tampered.eventDigest;
  const { checkpointDigest: _checkpointDigest, ...draft } = checkpoint;
  checkpoint.checkpointDigest = CodexDevelopmentVerificationDigest(draft);
  await writeFile(checkpointPath, JSON.stringify(checkpoint), 'utf8');
  await expect(runWorkPackageGate(v4Options, fake.overrides)).rejects.toThrow('canonical state prefix');
  expect(fake.counters.child).toBe(0);
  expect(fake.counters.recovery).toBe(0);
  expect(fake.counters.namespaceRemoval).toBe(0);
  expect(fake.counters.snapshotRemoval).toBe(0);
});

test('V4 pass evidence is exact, replayable, and never launches a second child', async () => {
  const fake = fakeDependencies();
  const first = await runWorkPackageGate(v4Options, fake.overrides);
  expect(first.evidence.schema).toBe('codex-work-package-gate-evidence-v4');
  expect(first.evidence.status).toBe('passed');
  expect(fake.counters).toMatchObject({
    child: 1,
    recovery: 0,
    namespaceRemoval: 1,
    snapshotRemoval: 1,
    runChildPreparation: 1
  });
  expect(fake.counters.launchedRunChildName).toBe(fake.counters.preparedRunChildName);
  expect(fake.counters.launchedRunChildAssignment).not.toBeNull();
  const launchedAssignment = JSON.parse(fake.counters.launchedRunChildAssignment!) as Record<string, unknown>;
  expect(launchedAssignment).toMatchObject({
    schema: 'sec-test-workspace-run-child-assignment-v1',
    name: fake.counters.preparedRunChildName,
    issuerProcessId: process.pid,
    device: '1',
    inode: '2'
  });
  expect(launchedAssignment.nonce).toMatch(/^[0-9a-f]{64}$/u);
  expect(launchedAssignment.nonceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(launchedAssignment.assignmentDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(() => assertWorkPackageGateEvidenceV4(first.evidence)).not.toThrow();
  const journalSource = await readFile(path.join(v4RunDir, 'events.jsonl'), 'utf8');
  expect(() => assertWorkPackageGateEvidenceBundleV4({
    evidence: first.evidence,
    journalSource
  })).not.toThrow();

  const second = await runWorkPackageGate(v4Options, fake.overrides);
  expect(second.evidence.evidenceDigest).toBe(first.evidence.evidenceDigest);
  expect(fake.counters.child).toBe(1);
  expect(fake.counters.namespaceRemoval).toBe(1);
  expect(fake.counters.snapshotRemoval).toBe(1);
});

test('four owner kinds alone authorize one recovery; ACL unknown does not block it', async () => {
  for (const [kind, recoveryOwners, pendingOwners] of [
    ['recovery-owner', 1, 0],
    ['recovery-owner-pending', 0, 1],
    ['provisional-owner', 0, 1],
    ['provisional-owner-pending', 0, 1]
  ] as const) {
    await cleanV4Publications();
    const authority = `${kind}:workspace/.sec/transaction`;
    const fake = fakeDependencies({
      censuses: [
        absentCensus,
        census({ recoveryOwners, pendingOwners, authorities: [authority], acl: 'unknown' }),
        census({ acl: 'unknown' }),
        absentCensus
      ],
      recovery: 'completed'
    });
    const result = await runWorkPackageGate(v4Options, fake.overrides);
    expect(result.evidence.status).toBe('passed');
    expect(result.evidence.recovery.authorization).toEqual(identitySet([authority]));
    expect(fake.counters.recovery).toBe(1);
    expect(fake.counters.namespaceRemoval).toBe(1);
  }
});

test('native result or lease residue never authorizes recovery or deletion', async () => {
  for (const residue of [census({ nativeResults: 1 }), census({ writerLeases: 1 })]) {
    await cleanV4Publications();
    const fake = fakeDependencies({ censuses: [absentCensus, residue, residue] });
    const result = await runWorkPackageGate(v4Options, fake.overrides);
    expect(result.evidence.status).toBe('unknown');
    expect(result.evidence.recovery.reason).toBe('not-needed');
    expect(fake.counters.recovery).toBe(0);
    expect(fake.counters.namespaceRemoval).toBe(0);
    expect(fake.counters.snapshotRemoval).toBe(0);
  }
});

test('status algebra distinguishes actionable failure, non-actionable exit, and timeout', async () => {
  const failureBytes = Buffer.from('tests/unit/semantic-mutation.test.ts\n(fail) deterministic\n');
  const actionable = fakeDependencies({
    child: outcome({
      status: 'exited',
      exitCode: 1,
      stdout: {
        bytes: failureBytes.byteLength,
        digest: `sha256:${createHash('sha256').update(failureBytes).digest('hex')}`,
        observerTruncated: false
      }
    }),
    childOutput: [{ stream: 'stdout', bytes: failureBytes }]
  });
  expect((await runWorkPackageGate(v4Options, actionable.overrides)).evidence.status).toBe('failed');

  await cleanV4Publications();
  const nonActionable = fakeDependencies({ child: outcome({ status: 'exited', exitCode: 1 }) });
  expect((await runWorkPackageGate(v4Options, nonActionable.overrides)).evidence.status).toBe('unknown');

  await cleanV4Publications();
  const timedOut = fakeDependencies({
    child: outcome({
      status: 'timed-out',
      trigger: 'timed-out',
      exitCode: null,
      termination: {
        requested: true,
        gracefulAttempted: true,
        forcedAttempted: true,
        childCloseObserved: true,
        streamsDrained: true,
        treeClosed: true
      }
    })
  });
  expect((await runWorkPackageGate(v4Options, timedOut.overrides)).evidence.status).toBe('timed-out');
});

test('durable run-child preparation intent reconciles a dead issuer before any managed child effect', async () => {
  const fake = fakeDependencies({ crashStage: 'run-child-preparation-attempted' });

  await expect(runWorkPackageGate(v4Options, fake.overrides))
    .rejects.toThrow('synthetic crash: run-child-preparation-attempted');
  expect(fake.counters.runChildPreparation).toBe(0);
  expect(fake.counters.child).toBe(0);

  const resumed = await runWorkPackageGate(v4Options, fake.overrides);
  expect(resumed.evidence.status).toBe('passed');
  expect(fake.counters.runChildPreparation).toBe(2);
  expect(fake.counters.runChildRetirement).toBe(1);
  expect(fake.counters.child).toBe(1);
  expect(fake.counters.launchedRunChildName).toBe(fake.counters.preparedRunChildName);
});

test('run-child mkdir success before result persistence reuses the durable intent then rotates its dead issuer', async () => {
  const fake = fakeDependencies();
  const prepare = fake.overrides.prepareRunChild!;
  const attempts: Array<readonly [string, string, string, number, string, string, string, boolean]> = [];
  let crashAfterFirstPhysicalEffect = true;
  const overrides: Partial<WorkPackageGateDependencies> = {
    ...fake.overrides,
    prepareRunChild: async (...args) => {
      const result = await prepare(...args);
      attempts.push(Object.freeze([...args]) as readonly [string, string, string, number, string, string, string, boolean]);
      if (crashAfterFirstPhysicalEffect) {
        crashAfterFirstPhysicalEffect = false;
        throw new Error('synthetic crash after run-child mkdir before checkpoint result');
      }
      return result;
    }
  };

  await expect(runWorkPackageGate(v4Options, overrides))
    .rejects.toThrow('synthetic crash after run-child mkdir before checkpoint result');
  const interrupted = JSON.parse(await readFile(path.join(v4RunDir, 'checkpoint.json'), 'utf8')) as {
    readonly runChildPreparation?: unknown;
    readonly runChild?: unknown;
  };
  expect(interrupted.runChildPreparation).not.toBeNull();
  expect(interrupted.runChild).toBeNull();

  const resumed = await runWorkPackageGate(v4Options, overrides);
  expect(resumed.evidence.status).toBe('passed');
  expect(attempts).toHaveLength(3);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(attempts[2]![1]).not.toBe(attempts[1]![1]);
  expect(attempts[2]![4]).not.toBe(attempts[1]![4]);
  expect(fake.counters.runChildRetirement).toBe(1);
  expect(fake.counters.child).toBe(1);
});

test('a zero-exit child that never consumes the live challenge cannot publish terminal PASS', async () => {
  const fake = fakeDependencies({ consumeChallenge: false });
  const result = await runWorkPackageGate(v4Options, fake.overrides);

  expect(fake.counters.child).toBe(1);
  expect(result.evidence.status).not.toBe('passed');
  expect(result.evidence.child.started).toBe(false);
});

test('run-child preparation rejects a swapped namespace without creating in the replacement', async () => {
  if (process.platform !== 'win32' && process.platform !== 'linux') return;
  const fake = fakeDependencies({ realRunChild: true });
  const prepare = fake.overrides.prepareRunChild!;
  const snapshotRoot = path.join(
    repoRoot,
    '.tmp',
    'gate-execution-snapshots',
    syntheticV4Namespace
  );
  const namespaceRoot = path.join(snapshotRoot, '.tmp', 'test-workspaces', syntheticV4Namespace);
  const displacedNamespace = `${namespaceRoot}-displaced`;
  let expectedChildName: string | null = null;
  const overrides: Partial<WorkPackageGateDependencies> = {
    ...fake.overrides,
    prepareRunChild: async (...args) => {
      expectedChildName = args[1];
      await rename(namespaceRoot, displacedNamespace);
      await mkdir(namespaceRoot);
      await writeFile(path.join(namespaceRoot, 'replacement-owner.txt'), 'foreign', 'utf8');
      return prepare(...args);
    }
  };

  try {
    await expect(runWorkPackageGate(v4Options, overrides))
      .rejects.toThrow('namespace changed after durable preparation');
    expect(expectedChildName).not.toBeNull();
    expect(await readFile(path.join(namespaceRoot, 'replacement-owner.txt'), 'utf8')).toBe('foreign');
    await expect(lstat(path.join(namespaceRoot, expectedChildName!))).rejects.toThrow();
    expect((await lstat(displacedNamespace)).isDirectory()).toBe(true);
  } finally {
    await rm(snapshotRoot, { recursive: true, force: true });
  }
});

test('hard-death fixture process', async () => {
  const mode = process.env.SEC_GATE_HARD_DEATH_MODE;
  const markerPath = process.env.SEC_GATE_HARD_DEATH_MARKER;
  if (mode === undefined && markerPath === undefined) return;
  if ((mode !== 'preparation' && mode !== 'mkdir-effect') || markerPath === undefined) {
    throw new Error('hard-death fixture environment is invalid');
  }
  const fake = fakeDependencies({
    realRunChild: true,
    pauseAtCheckpoint: mode === 'preparation'
      ? { stage: 'run-child-preparation-attempted', markerPath }
      : undefined,
    pauseAfterRunChildEffectPath: mode === 'mkdir-effect' ? markerPath : undefined
  });
  await runWorkPackageGate(v4Options, fake.overrides);
  throw new Error('hard-death fixture unexpectedly completed');
}, 30_000);

async function waitForHardDeathMarker(markerPath: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pathPresent(markerPath)) return true;
    await Bun.sleep(25);
  }
  return pathPresent(markerPath);
}

function hardKillProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      encoding: 'utf8',
      windowsHide: true
    });
    if (result.status !== 0) throw new Error(`hard-death fixture taskkill failed: ${result.stderr}`);
    return;
  }
  process.kill(pid, 'SIGKILL');
}

test('real supervisor hard death recovers both preparation and mkdir effect/result windows', async () => {
  if (process.platform !== 'win32' && process.platform !== 'linux') return;
  const testFile = path.join(repoRoot, 'tests', 'unit', 'work-package-gate-execution.test.ts');
  const snapshotRoot = path.join(
    repoRoot,
    '.tmp',
    'gate-execution-snapshots',
    syntheticV4Namespace
  );
  const foreignSibling = path.join(snapshotRoot, '.tmp', 'test-workspaces', 'foreign-preserve');
  for (const mode of ['preparation', 'mkdir-effect'] as const) {
    await cleanV4Publications();
    await prepareSyntheticProtectedLedger();
    await prepareCanonicalProtectedPathAuthority();
    const markerPath = path.join(repoRoot, '.tmp', `gate-hard-death-${mode}-${randomUUID()}.json`);
    await mkdir(foreignSibling, { recursive: true });
    await writeFile(path.join(foreignSibling, 'owner.txt'), 'foreign', 'utf8');
    const child = Bun.spawn([
      process.execPath,
      'test',
      testFile,
      '--test-name-pattern',
      '^hard-death fixture process$'
    ], {
      cwd: repoRoot,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        SEC_GATE_HARD_DEATH_MODE: mode,
        SEC_GATE_HARD_DEATH_MARKER: markerPath
      }
    });
    try {
      if (!await waitForHardDeathMarker(markerPath, 15_000)) {
        hardKillProcessTree(child.pid);
        const [stdout, stderr] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text()
        ]);
        await child.exited;
        throw new Error(`hard-death fixture did not reach ${mode}: ${stdout}\n${stderr}`);
      }
      hardKillProcessTree(child.pid);
      await child.exited;
      const successor = fakeDependencies({ realRunChild: true });
      const result = await runWorkPackageGate(v4Options, successor.overrides);
      if (result.evidence.status !== 'passed') {
        throw new Error(`hard-death successor was not passed: ${JSON.stringify({
          mode,
          counters: successor.counters,
          evidence: result.evidence
        })}`);
      }
      expect(result.evidence.status).toBe('passed');
      expect(successor.counters.child).toBe(1);
      expect(successor.counters.runChildRetirement).toBe(1);
      expect(await readFile(path.join(foreignSibling, 'owner.txt'), 'utf8')).toBe('foreign');
      await expect(lstat(testWorkspaceSupervisorLeasePathV1(syntheticV4Namespace))).rejects.toThrow();
    } finally {
      if (child.exitCode === null) {
        try { hardKillProcessTree(child.pid); } catch {}
        await child.exited;
      }
      await rm(markerPath, { force: true });
      await rm(snapshotRoot, { recursive: true, force: true });
      await cleanV4Publications();
    }
  }
}, 60_000);

test('issuer rotation resumes when the new child effect succeeds before its result checkpoint', async () => {
  const fake = fakeDependencies({ crashStage: 'run-child-prepared' });
  const prepare = fake.overrides.prepareRunChild!;
  const attempts: Array<readonly [string, string, string, number, string, string, string, boolean]> = [];
  let crashAfterRotatedEffect = true;
  const overrides: Partial<WorkPackageGateDependencies> = {
    ...fake.overrides,
    prepareRunChild: async (...args) => {
      const result = await prepare(...args);
      attempts.push(Object.freeze([...args]) as readonly [string, string, string, number, string, string, string, boolean]);
      if (attempts.length === 2 && crashAfterRotatedEffect) {
        crashAfterRotatedEffect = false;
        throw new Error('synthetic crash after rotated run-child mkdir before checkpoint result');
      }
      return result;
    }
  };

  await expect(runWorkPackageGate(v4Options, overrides)).rejects.toThrow('synthetic crash: run-child-prepared');
  await expect(runWorkPackageGate(v4Options, overrides))
    .rejects.toThrow('synthetic crash after rotated run-child mkdir before checkpoint result');
  const resumed = await runWorkPackageGate(v4Options, overrides);

  expect(resumed.evidence.status).toBe('passed');
  expect(attempts).toHaveLength(4);
  expect(attempts[2]).toEqual(attempts[1]);
  expect(attempts[3]![1]).not.toBe(attempts[2]![1]);
  expect(attempts[3]![4]).not.toBe(attempts[2]![4]);
  expect(fake.counters.runChildRetirement).toBe(2);
  expect(fake.counters.child).toBe(1);
});

test('unknown-result side-effect attempt bits are never replayed', async () => {
  for (const stage of [
    'child-attempted',
    'recovery-attempted',
    'namespace-removal-attempted',
    'snapshot-removal-attempted'
  ] as const) {
    await cleanV4Publications();
    const owner = 'recovery-owner:workspace/.sec/transaction';
    const fake = fakeDependencies({
      censuses: [
        absentCensus,
        census({ recoveryOwners: 1, authorities: [owner] }),
        cleanCensus,
        absentCensus
      ],
      recovery: 'completed',
      crashStage: stage
    });
    await expect(runWorkPackageGate(v4Options, fake.overrides)).rejects.toThrow(`synthetic crash: ${stage}`);
    const countsAfterCrash = { ...fake.counters };
    const resumed = await runWorkPackageGate(v4Options, fake.overrides);
    expect(resumed.evidence.status).toBe('unknown');
    if (stage === 'child-attempted') expect(fake.counters.child).toBe(0);
    else expect(fake.counters.child).toBe(countsAfterCrash.child);
    if (stage === 'recovery-attempted') expect(fake.counters.recovery).toBe(0);
    else expect(fake.counters.recovery).toBe(countsAfterCrash.recovery);
    if (stage === 'namespace-removal-attempted') expect(fake.counters.namespaceRemoval).toBe(0);
    else expect(fake.counters.namespaceRemoval).toBe(countsAfterCrash.namespaceRemoval);
    if (stage === 'snapshot-removal-attempted') expect(fake.counters.snapshotRemoval).toBe(0);
    else expect(fake.counters.snapshotRemoval).toBe(countsAfterCrash.snapshotRemoval);
  }
});

test('checkpoint-bound completed event and evidence publications resume exact bytes only', async () => {
  for (const stage of [
    'completed-event-publication-attempted',
    'evidence-publication-attempted'
  ] as const) {
    await cleanV4Publications();
    const fake = fakeDependencies({ crashStage: stage });
    await expect(runWorkPackageGate(v4Options, fake.overrides)).rejects.toThrow(`synthetic crash: ${stage}`);
    const childCalls = fake.counters.child;
    const resumed = await runWorkPackageGate(v4Options, fake.overrides);
    expect(resumed.evidence.status).toBe('passed');
    expect(fake.counters.child).toBe(childCalls);
    const journalSource = await readFile(path.join(v4RunDir, 'events.jsonl'), 'utf8');
    expect(() => assertWorkPackageGateEvidenceBundleV4({
      evidence: resumed.evidence,
      journalSource
    })).not.toThrow();
  }
});

test('publication replay rejects non-exact evidence bytes without rerunning child', async () => {
  const fake = fakeDependencies();
  await runWorkPackageGate(v4Options, fake.overrides);
  await writeFile(path.join(v4RunDir, 'evidence.json'), '{"tampered":true}', 'utf8');
  await expect(runWorkPackageGate(v4Options, fake.overrides)).rejects.toThrow('evidence bytes');
  expect(fake.counters.child).toBe(1);
});
