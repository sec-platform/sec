import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
  writeSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { acquireWorkspaceWriteLease, recoverWorkspaceWriteLeaseRetirement } from '../../src/adapters/filesystem/write-lease.ts';
import { generatedStateProducerHooks } from '../../src/adapters/runtime-state/generated-state/lifecycle.ts';
import { inspectNoFollowDirectoryChain, relocateRetainedNoFollowDirectory } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import {
  WORKTREE_PHYSICAL_CLOSEOUT_AUTHORIZATION_SCHEMA,
  createWorktreePhysicalCloseoutReceipt,
  detailDigest
} from '../../src/adapters/runtime-state/worktree-closeout-contract.ts';
import { executeMergedLocalBranchResidueCloseout } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-local-residue-closeout.ts';
import {
  WorktreePhysicalCloseoutConsumptionToken,
  assertTrustedCompletedWorktreePhysicalCloseout,
  executeDetachedScratchWorktreePhysicalCloseout,
  executeWorktreePhysicalCloseout,
  gcCompletedWorktreePhysicalCloseoutEvidence,
  prepareDetachedScratchWorktreePhysicalCloseout,
  prepareTrustedWorktreePhysicalCloseout,
  prepareWorktreePhysicalCloseout
} from '../../src/adapters/self-hosting/control/branch-lifecycle/worktree-physical-closeout.ts';
import {
  assertCompilerDependencyEnvironmentRetirementReceipt,
  compilerDependencyLocatorWorktreeRetirementProvider,
  disposeCompilerDependencyEnvironment,
  ensureCompilerDepsReady
} from '../../src/adapters/toolchain/dependencies/test/runtime.ts';
import { sha256 } from '../../src/contracts/canonical.ts';

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return (result.stdout ?? '').trim();
}

function gitPath(value: string): string {
  return value.replaceAll('\\', '/');
}

function writeCompilerDependencyInputs(root: string): void {
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({
    packageManager: `bun@${process.versions.bun}`,
    dependencies: { commander: '1.0.0' },
    devDependencies: { typescript: '1.0.0' }
  })}\n`, 'utf8');
  writeFileSync(path.join(root, 'bun.lock'), 'lock-v1\n', 'utf8');
  writeFileSync(path.join(root, '.bun-version'), `${process.versions.bun}\n`, 'utf8');
  writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n.tmp/\n', 'utf8');
}

function materializeCompilerDependencyFixture(root: string): void {
  const packages = [
    { name: 'commander', version: '1.0.0' },
    { name: 'typescript', version: '1.0.0', main: './lib/typescript.js' }
  ];
  for (const manifest of packages) {
    const packageRoot = path.join(root, 'node_modules', manifest.name);
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(path.join(packageRoot, 'package.json'), `${JSON.stringify(manifest)}\n`, 'utf8');
    if (manifest.main !== undefined) {
      const entry = path.join(packageRoot, ...manifest.main.replace(/^\.\//u, '').split('/'));
      mkdirSync(path.dirname(entry), { recursive: true });
      writeFileSync(entry, `primary:${manifest.name}\n`, 'utf8');
    }
  }
}

function fixture(options: Readonly<{ compilerDependencies?: boolean }> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-worktree-physical-closeout-'));
  const remote = path.join(root, 'remote.git');
  const repository = path.join(root, 'repository');
  const target = path.join(root, 'candidate');
  git(root, ['init', '--bare', remote]);
  git(root, ['init', '-b', 'main', repository]);
  git(repository, ['config', 'user.name', 'SEC Test']);
  git(repository, ['config', 'user.email', 'sec-test@example.invalid']);
  git(repository, ['config', 'core.autocrlf', 'false']);
  writeFileSync(path.join(repository, 'tracked.txt'), 'main\n', 'utf8');
  if (options.compilerDependencies === true) writeCompilerDependencyInputs(repository);
  git(repository, ['add', '.']);
  git(repository, ['commit', '-m', 'main']);
  git(repository, ['remote', 'add', 'origin', remote]);
  git(repository, ['push', '-u', 'origin', 'main']);
  git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  git(repository, ['remote', 'set-head', 'origin', 'main']);
  const branch = 'codex/fixture';
  git(repository, ['branch', branch]);
  git(repository, ['worktree', 'add', target, branch]);
  const headSha = git(target, ['rev-parse', 'HEAD']);
  const treeSha = git(target, ['rev-parse', 'HEAD^{tree}']);
  const recoveryAuthorityDigest = detailDigest('fixture-recovery');
  return { root, repository, target, branch, headSha, treeSha, recoveryAuthorityDigest };
}

async function persistRetiredPhaseForCrash(authorization: Awaited<ReturnType<typeof prepareWorktreePhysicalCloseout>>): Promise<string> {
  const tombstone = path.join(path.dirname(authorization.target.path), authorization.tombstoneName);
  relocateRetainedNoFollowDirectory({
    directory: inspectNoFollowDirectoryChain(authorization.target.path, 'crash phase source').target,
    tombstoneName: authorization.tombstoneName
  });
  const lease = await acquireWorkspaceWriteLease(tombstone);
  const proofParent = inspectNoFollowDirectoryChain(authorization.proofRoot.path, 'crash phase proof parent').target;
  let retirementReceipt;
  try {
    retirementReceipt = await lease.retireOwnedNamespace(detailDigest({
      authorizationDigest: authorization.authorizationDigest,
      tombstoneName: authorization.tombstoneName,
      phase: 'fixture-retirement'
    }), proofParent);
    recoverWorkspaceWriteLeaseRetirement({
      workspaceRoot: tombstone,
      intentDigest: retirementReceipt.intentDigest,
      proofParent
    });
  } finally {
    await lease.release().catch(() => undefined);
  }
  const material = {
    schema: 'sec-worktree-closeout-retired-phase-v1' as const,
    authorizationDigest: authorization.authorizationDigest,
    tombstoneName: authorization.tombstoneName,
    retirementReceipt
  };
  const phase = { ...material, phaseDigest: sha256(material) };
  writeFileSync(path.join(path.dirname(authorization.receiptPath), `retired-phase-${phase.phaseDigest.slice('sha256:'.length)}.json`), `${JSON.stringify(phase)}\n`);
  return tombstone;
}

test('real registered worktree reaches registry and physical absence under one durable receipt', async () => {
  const value = fixture();
  try {
    const authorization = await prepareWorktreePhysicalCloseout({
      repositoryRoot: value.repository,
      targetPath: value.target,
      expectedBranch: value.branch,
      expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest
});

    expect(existsSync(authorization.authorizationPath)).toBe(true);
    expect(gitPath(git(value.repository, ['worktree', 'list', '--porcelain']))).toContain(gitPath(value.target));
    const receipt = await executeWorktreePhysicalCloseout({
      repositoryRoot: value.repository,
      targetPath: value.target,
      expectedBranch: value.branch,
      expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest,
      authorizationPath: authorization.authorizationPath
    });
    expect(receipt.terminal).toBe('completed');
    expect(receipt.readback).toEqual({
      registryPresent: false,
      physicalPresent: false,
      authorizationValid: true
    });
    const latest = JSON.parse(readFileSync(authorization.receiptPath, 'utf8')) as {
      schema: string; generation: string; receiptDigest: string;
    };
    expect(latest).toEqual({
      schema: 'sec-worktree-cleanup-receipt-latest-v1',
      generation: `receipt-${receipt.receiptDigest.slice('sha256:'.length)}.json`,
      receiptDigest: receipt.receiptDigest
    });
    expect(existsSync(path.join(path.dirname(authorization.receiptPath), latest.generation))).toBe(true);
    expect(existsSync(value.target)).toBe(false);
    expect(gitPath(git(value.repository, ['worktree', 'list', '--porcelain']))).not.toContain(gitPath(value.target));
    expect(
      (await executeWorktreePhysicalCloseout({
        repositoryRoot: value.repository,
        targetPath: value.target,
        expectedBranch: value.branch,
        expectedHeadSha: value.headSha,
        expectedTreeSha: value.treeSha,
        expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest,
        authorizationPath: authorization.authorizationPath
      })).receiptDigest
    ).toBe(receipt.receiptDigest);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}, 30_000);

test('completed worktree evidence is retained while the branch is live and reclaimed after ref settlement', async () => {
  const value = fixture();
  try {
    const authorization = await prepareWorktreePhysicalCloseout({
      repositoryRoot: value.repository,
      targetPath: value.target,
      expectedBranch: value.branch,
      expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest
    });
    const receipt = await executeWorktreePhysicalCloseout({
      repositoryRoot: value.repository,
      targetPath: value.target,
      expectedBranch: value.branch,
      expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest,
      authorizationPath: authorization.authorizationPath
    });
    expect(receipt.terminal).toBe('completed');

    const retained = await gcCompletedWorktreePhysicalCloseoutEvidence(value.repository);
    expect(retained.retiredOperationIds).toEqual([]);
    expect(retained.retained).toContainEqual({
      operationId: authorization.operationId,
      reason: 'branch-live',
      terminal: 'completed'
    });
    expect(existsSync(path.dirname(authorization.authorizationPath))).toBeTrue();
    expect(existsSync(authorization.proofRoot.path)).toBeTrue();

    git(value.repository, ['branch', '-D', value.branch]);
    const reclaimed = await gcCompletedWorktreePhysicalCloseoutEvidence(value.repository);
    expect(reclaimed.retiredOperationIds).toEqual([authorization.operationId]);
    expect(reclaimed.ownerRetired).toBeTrue();
    expect(reclaimed.retained).toEqual([]);
    expect(existsSync(path.dirname(authorization.authorizationPath))).toBeFalse();
    expect(existsSync(path.dirname(path.dirname(authorization.authorizationPath)))).toBeFalse();
    expect(existsSync(authorization.proofRoot.path)).toBeFalse();
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}, 30_000);

test('completed worktree GC rejects unknown operation evidence instead of deleting it', async () => {
  const value = fixture();
  try {
    const authorization = await prepareWorktreePhysicalCloseout({
      repositoryRoot: value.repository,
      targetPath: value.target,
      expectedBranch: value.branch,
      expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest
    });
    await executeWorktreePhysicalCloseout({
      repositoryRoot: value.repository,
      targetPath: value.target,
      expectedBranch: value.branch,
      expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest,
      authorizationPath: authorization.authorizationPath
    });
    const operationRoot = path.dirname(authorization.authorizationPath);
    const unknown = path.join(operationRoot, 'future-owner-evidence.json');
    writeFileSync(unknown, '{}\n', 'utf8');
    git(value.repository, ['branch', '-D', value.branch]);
    await expect(gcCompletedWorktreePhysicalCloseoutEvidence(value.repository))
      .rejects.toThrow('unvalidated operation evidence');
    expect(existsSync(unknown)).toBeTrue();
    expect(existsSync(operationRoot)).toBeTrue();
    expect(existsSync(authorization.proofRoot.path)).toBeTrue();
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}, 30_000);

test('one branch settlement retires completed current worktree evidence it makes eligible', async () => {
  const value = fixture();
  try {
    const authorization = await prepareWorktreePhysicalCloseout({
      repositoryRoot: value.repository,
      targetPath: value.target,
      expectedBranch: value.branch,
      expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest
    });
    expect(authorization.schema).toBe(WORKTREE_PHYSICAL_CLOSEOUT_AUTHORIZATION_SCHEMA);
    const receipt = await executeWorktreePhysicalCloseout({
      repositoryRoot: value.repository,
      targetPath: value.target,
      expectedBranch: value.branch,
      expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest,
      authorizationPath: authorization.authorizationPath
    });
    expect(receipt.terminal).toBe('completed');
    const mainSha = git(value.repository, ['rev-parse', 'refs/remotes/origin/main']);
    git(value.repository, ['remote', 'set-url', 'origin', 'https://github.com/sec-platform/sec.git']);
    const run = (command: 'gh' | 'git', args: readonly string[], cwd: string, input?: string) => {
      if (command === 'gh' && args[0] === 'repo') {
        return {
          status: 0,
          stdout: Buffer.from(JSON.stringify({
            nameWithOwner: 'sec-platform/sec',
            defaultBranchRef: { name: 'main' }
          })),
          stderr: Buffer.alloc(0)
        };
      }
      if (command === 'gh') {
        return {
          status: 0,
          stdout: Buffer.from(JSON.stringify([{
            number: 99,
            headRefName: value.branch,
            headRefOid: value.headSha,
            baseRefName: 'main',
            state: 'MERGED',
            mergeCommit: { oid: mainSha },
            url: 'https://github.com/sec-platform/sec/pull/99'
          }])),
          stderr: Buffer.alloc(0)
        };
      }
      if (args.includes('ls-remote')) {
        return {
          status: 0,
          stdout: Buffer.from(`${mainSha}\trefs/heads/main\n`),
          stderr: Buffer.alloc(0)
        };
      }
      const result = spawnSync('git', [...args], {
        cwd,
        ...(input === undefined ? {} : { input: Buffer.from(input, 'utf8') }),
        encoding: null,
        windowsHide: true
      });
      return {
        status: result.status,
        stdout: Buffer.from(result.stdout ?? ''),
        stderr: Buffer.from(result.stderr ?? result.error?.message ?? '')
      };
    };
    const result = await executeMergedLocalBranchResidueCloseout({
      repositoryRoot: value.repository,
      recoveryRoot: path.join(value.root, 'branch-recovery'),
      run,
      now: () => new Date('2026-09-16T00:00:00.000Z')
    });
    expect(result.settled).toEqual([value.branch]);
    expect(result.worktreeEvidenceGc.retiredOperationIds).toEqual([authorization.operationId]);
    expect(result.worktreeEvidenceGc.retained).toEqual([]);
    expect(result.worktreeEvidenceGc.ownerRetired).toBeTrue();
    expect(existsSync(path.dirname(authorization.authorizationPath))).toBeFalse();
    expect(existsSync(authorization.proofRoot.path)).toBeFalse();
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}, 40_000);

test('prepared worktree evidence remains a recovery root', async () => {
  const value = fixture();
  try {
    const authorization = await prepareWorktreePhysicalCloseout({
      repositoryRoot: value.repository,
      targetPath: value.target,
      expectedBranch: value.branch,
      expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest
    });
    const result = await gcCompletedWorktreePhysicalCloseoutEvidence(value.repository);
    expect(result.retiredOperationIds).toEqual([]);
    expect(result.retained).toContainEqual({
      operationId: authorization.operationId,
      reason: 'not-completed',
      terminal: 'prepared'
    });
    expect(existsSync(path.dirname(authorization.authorizationPath))).toBeTrue();
    expect(existsSync(authorization.proofRoot.path)).toBeTrue();
    expect(existsSync(value.target)).toBeTrue();
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}, 30_000);

test('fieldless historical proofless residue converges only from exact durable absence readback', async () => {
  const value = fixture();
  try {
    const prepared = await prepareWorktreePhysicalCloseout({
      repositoryRoot: value.repository,
      targetPath: value.target,
      expectedBranch: value.branch,
      expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest
    });
    const {
      authorizationDigest: ignoredAuthorizationDigest,
      generatedStateRetirement: ignoredGeneratedStateRetirement,
      ...authorizationBody
    } = prepared;
    const operationId = sha256({
      repository: authorizationBody.repository,
      target: authorizationBody.target,
      registryBeforeDigest: authorizationBody.registryBeforeDigest,
      workingStateDigest: authorizationBody.workingStateDigest,
      inventoryDigest: authorizationBody.inventory.inventoryDigest,
      registryAdmin: {
        relativePath: authorizationBody.registryAdmin.relativePath,
        device: authorizationBody.registryAdmin.device,
        inode: authorizationBody.registryAdmin.inode,
        inventoryDigest: authorizationBody.registryAdmin.inventory.inventoryDigest
      },
      targetLeaseNamespace: authorizationBody.targetLeaseNamespace
    }) as `sha256:${string}`;
    const operationSuffix = operationId.slice('sha256:'.length);
    const operationRoot = path.join(path.dirname(path.dirname(prepared.authorizationPath)), operationSuffix);
    const proofRootPath = path.join(path.dirname(value.target), `sec-worktree-closeout-proof-${operationSuffix}`);
    renameSync(prepared.proofRoot.path, proofRootPath);
    renameSync(path.dirname(prepared.authorizationPath), operationRoot);
    const legacyBody = {
      ...authorizationBody,
      schema: WORKTREE_PHYSICAL_CLOSEOUT_AUTHORIZATION_SCHEMA,
      operationId,
      registryAdmin: {
        ...authorizationBody.registryAdmin,
        tombstoneName: `worktree-admin-closeout-${operationSuffix}`
      },
      proofRoot: { ...authorizationBody.proofRoot, path: proofRootPath },
      tombstoneName: `worktree-closeout-tombstone-${operationSuffix}`,
      authorizationPath: path.join(operationRoot, 'authorization.json'),
      receiptPath: path.join(operationRoot, 'receipt-latest.json')
    };
    writeFileSync(legacyBody.authorizationPath, `${JSON.stringify({
      ...legacyBody,
      authorizationDigest: sha256(legacyBody)
    }, null, 2)}\n`, 'utf8');

    const completed = await executeWorktreePhysicalCloseout({
      repositoryRoot: value.repository,
      targetPath: value.target,
      expectedBranch: value.branch,
      expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest,
      authorizationPath: legacyBody.authorizationPath
    });
    expect(completed.terminal).toBe('completed');

    let generation = completed.previousReceiptDigest;
    let residue: ReturnType<typeof createWorktreePhysicalCloseoutReceipt> | null = null;
    let beforeUnregister: ReturnType<typeof createWorktreePhysicalCloseoutReceipt> | null = null;
    while (generation !== null) {
      const candidate = JSON.parse(readFileSync(
        path.join(operationRoot, `receipt-${generation.slice('sha256:'.length)}.json`),
        'utf8'
      )) as ReturnType<typeof createWorktreePhysicalCloseoutReceipt>;
      if (residue === null && candidate.terminal === 'residue') residue = candidate;
      if (candidate.blockers.includes('unregister-intent-durable')) beforeUnregister = candidate;
      generation = candidate.previousReceiptDigest;
    }
    expect(residue).not.toBeNull();
    expect(beforeUnregister).not.toBeNull();
    rmSync(path.join(operationRoot, `receipt-${completed.receiptDigest.slice('sha256:'.length)}.json`));
    const writeLatest = (receipt: ReturnType<typeof createWorktreePhysicalCloseoutReceipt>) => {
      writeFileSync(path.join(operationRoot, 'receipt-latest.json'), `${JSON.stringify({
        schema: 'sec-worktree-cleanup-receipt-latest-v1',
        generation: `receipt-${receipt.receiptDigest.slice('sha256:'.length)}.json`,
        receiptDigest: receipt.receiptDigest
      }, null, 2)}\n`, 'utf8');
    };
    writeLatest(residue!);
    // Reproduce the historical interrupted generation: physical and registry
    // state are already absent, but the old proof root disappeared before a
    // terminal receipt was published.
    rmSync(proofRootPath, { recursive: true, force: true });

    writeLatest(beforeUnregister!);
    await expect(executeWorktreePhysicalCloseout({
      repositoryRoot: value.repository,
      targetPath: value.target,
      expectedBranch: value.branch,
      expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest,
      authorizationPath: legacyBody.authorizationPath
    })).rejects.toThrow('lacks durable unregister success');
    writeLatest(residue!);

    const retiredPhaseName = readdirSync(operationRoot).find((name) => name.startsWith('retired-phase-'))!;
    const retiredPhasePath = path.join(operationRoot, retiredPhaseName);
    const retiredPhaseBytes = readFileSync(retiredPhasePath);
    const retiredPhase = JSON.parse(retiredPhaseBytes.toString('utf8')) as {
      retirementReceipt: { fenceName: string };
    };
    rmSync(retiredPhasePath);
    await expect(executeWorktreePhysicalCloseout({
      repositoryRoot: value.repository,
      targetPath: value.target,
      expectedBranch: value.branch,
      expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest,
      authorizationPath: legacyBody.authorizationPath
    })).rejects.toThrow('lacks its durable retirement phase');
    writeFileSync(retiredPhasePath, retiredPhaseBytes);

    mkdirSync(value.target);
    await expect(executeWorktreePhysicalCloseout({
      repositoryRoot: value.repository,
      targetPath: value.target,
      expectedBranch: value.branch,
      expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest,
      authorizationPath: legacyBody.authorizationPath
    })).rejects.toThrow('target-present');
    rmSync(value.target, { recursive: true, force: true });

    const tombstonePath = path.join(path.dirname(value.target), legacyBody.tombstoneName);
    mkdirSync(tombstonePath);
    await expect(executeWorktreePhysicalCloseout({
      repositoryRoot: value.repository,
      targetPath: value.target,
      expectedBranch: value.branch,
      expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest,
      authorizationPath: legacyBody.authorizationPath
    })).rejects.toThrow('tombstone-present');
    rmSync(tombstonePath, { recursive: true, force: true });

    const fencePath = path.join(path.dirname(value.target), retiredPhase.retirementReceipt.fenceName);
    writeFileSync(fencePath, 'reappeared\n');
    await expect(executeWorktreePhysicalCloseout({
      repositoryRoot: value.repository,
      targetPath: value.target,
      expectedBranch: value.branch,
      expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest,
      authorizationPath: legacyBody.authorizationPath
    })).rejects.toThrow('retirement-fence-present');
    rmSync(fencePath);

    const recovered = await executeWorktreePhysicalCloseout({
      repositoryRoot: value.repository,
      targetPath: value.target,
      expectedBranch: value.branch,
      expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest,
      authorizationPath: legacyBody.authorizationPath
    });
    expect(recovered).toMatchObject({
      terminal: 'completed',
      blockers: [],
      readback: { registryPresent: false, physicalPresent: false, authorizationValid: true },
      previousReceiptDigest: residue!.receiptDigest
    });
    expect(recovered.attempts).toEqual([expect.objectContaining({
      operation: 'readback',
      status: 'success'
    })]);

    const liveReceiptFiles = new Set<string>();
    let liveGeneration: ReturnType<typeof createWorktreePhysicalCloseoutReceipt> | null = recovered;
    while (liveGeneration !== null) {
      liveReceiptFiles.add(`receipt-${liveGeneration.receiptDigest.slice('sha256:'.length)}.json`);
      liveGeneration = liveGeneration.previousReceiptDigest === null
        ? null
        : JSON.parse(readFileSync(
            path.join(operationRoot, `receipt-${liveGeneration.previousReceiptDigest.slice('sha256:'.length)}.json`),
            'utf8'
          )) as ReturnType<typeof createWorktreePhysicalCloseoutReceipt>;
    }
    for (const name of readdirSync(operationRoot).filter((candidate) => (
      /^receipt-[0-9a-f]{64}\.json$/u.test(candidate) && !liveReceiptFiles.has(candidate)
    ))) rmSync(path.join(operationRoot, name));

    git(value.repository, ['branch', '-D', value.branch]);
    rmSync(retiredPhasePath);
    await expect(gcCompletedWorktreePhysicalCloseoutEvidence(value.repository))
      .rejects.toThrow('lacks current authorization or retirement phase');
    expect(existsSync(operationRoot)).toBeTrue();
    writeFileSync(retiredPhasePath, retiredPhaseBytes);

    mkdirSync(tombstonePath);
    await expect(gcCompletedWorktreePhysicalCloseoutEvidence(value.repository))
      .rejects.toThrow('tombstone-present');
    expect(existsSync(operationRoot)).toBeTrue();
    rmSync(tombstonePath, { recursive: true, force: true });

    writeFileSync(fencePath, 'reappeared\n');
    await expect(gcCompletedWorktreePhysicalCloseoutEvidence(value.repository))
      .rejects.toThrow('retirement-fence-present');
    expect(existsSync(operationRoot)).toBeTrue();
    rmSync(fencePath);

    mkdirSync(proofRootPath);
    await expect(gcCompletedWorktreePhysicalCloseoutEvidence(value.repository))
      .rejects.toThrow('proof identity changed');
    expect(existsSync(operationRoot)).toBeTrue();
    rmSync(proofRootPath, { recursive: true, force: true });

    const gc = await gcCompletedWorktreePhysicalCloseoutEvidence(value.repository);
    expect(gc.retiredOperationIds).toEqual([operationId]);
    expect(gc.retained).toEqual([]);
    expect(gc.ownerRetired).toBeTrue();
    expect(existsSync(operationRoot)).toBeFalse();
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}, 30_000);

test('authorized externally unregistered worktree converges physical residue without elevating the missing admin effect', async () => {
  if (process.platform !== 'win32') return;
  const value = fixture();
  const externalTarget = path.join(value.root, 'external-junction-target');
  try {
    const junctionPath = path.join(value.target, 'tracked-junction');
    mkdirSync(junctionPath);
    writeFileSync(path.join(junctionPath, 'sentinel.txt'), 'external target survives\n');
    git(value.target, ['add', 'tracked-junction/sentinel.txt']);
    git(value.target, ['commit', '-m', 'add junction preimage']);
    value.headSha = git(value.target, ['rev-parse', 'HEAD']);
    value.treeSha = git(value.target, ['rev-parse', 'HEAD^{tree}']);
    renameSync(junctionPath, externalTarget);
    symlinkSync(externalTarget, junctionPath, 'junction');
    const externalTargetIdentity = inspectNoFollowDirectoryChain(
      externalTarget,
      'external junction target before half-settled recovery'
    ).target;
    expect(git(value.target, ['status', '--porcelain=v1', '--untracked-files=all'])).toBe('');

    const authorization = await prepareWorktreePhysicalCloseout({
      repositoryRoot: value.repository,
      targetPath: value.target,
      expectedBranch: value.branch,
      expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest
    });
    const registryAdminPath = path.join(
      authorization.repository.commonDir,
      ...authorization.registryAdmin.relativePath.split('/')
    );
    rmSync(registryAdminPath, { recursive: true, force: true });
    rmSync(path.join(value.target, 'tracked.txt'));
    expect(gitPath(git(value.repository, ['worktree', 'list', '--porcelain'])))
      .not.toContain(gitPath(value.target));

    const first = await executeWorktreePhysicalCloseout({
      repositoryRoot: value.repository,
      targetPath: value.target,
      expectedBranch: value.branch,
      expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest,
      authorizationPath: authorization.authorizationPath
    });
    const retry = await executeWorktreePhysicalCloseout({
      repositoryRoot: value.repository,
      targetPath: value.target,
      expectedBranch: value.branch,
      expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest,
      authorizationPath: authorization.authorizationPath
    });

    expect(first).toMatchObject({
      terminal: 'blocked',
      readback: { registryPresent: false, physicalPresent: false, authorizationValid: true }
    });
    expect(first.blockers).toContain('external-registry-removal-without-retained-admin-effect');
    expect(retry.blockers).toContain('external-registry-removal-without-retained-admin-effect');
    expect(existsSync(value.target)).toBe(false);
    expect(readFileSync(path.join(externalTarget, 'sentinel.txt'), 'utf8')).toBe('external target survives\n');
    expect(inspectNoFollowDirectoryChain(
      externalTarget,
      'external junction target after half-settled recovery'
    ).target).toMatchObject({
      device: externalTargetIdentity.device,
      inode: externalTargetIdentity.inode
    });
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}, 60_000);

test('closeout composes provider retirement for an automatically reused dependency locator', async () => {
  const value = fixture({ compilerDependencies: true });
  const previousCacheHome = process.env.SEC_CACHE_HOME;
  const previousStateHome = process.env.SEC_STATE_HOME;
  process.env.SEC_CACHE_HOME = path.join(value.root, 'runtime-cache');
  process.env.SEC_STATE_HOME = path.join(value.root, 'runtime-state');
  const lifecycleEnvironment = { ...process.env };
  const repositoryLifecycle = generatedStateProducerHooks({
    repositoryRoot: value.repository,
    workspaceRoot: value.repository
  }, {
    environment: lifecycleEnvironment,
    worktreeRetirementProviders: [compilerDependencyLocatorWorktreeRetirementProvider]
  });
  try {
    await ensureCompilerDepsReady({
      materialize: async (_args, command) => {
        materializeCompilerDependencyFixture(command.cwd);
        return { code: 0, stdout: 'ok', stderr: '' };
      },
      generatedStateLifecycle: repositoryLifecycle
    }, value.repository);
    const lifecycle = generatedStateProducerHooks({
      repositoryRoot: value.repository,
      workspaceRoot: value.target
    }, {
      environment: lifecycleEnvironment,
      worktreeRetirementProviders: [compilerDependencyLocatorWorktreeRetirementProvider]
    });
    const ready = await ensureCompilerDepsReady({
      materialize: async () => {
        throw new Error('Linked-worktree closeout fixture must reuse the exact local generation.');
      },
      generatedStateLifecycle: lifecycle
    }, value.target);
    expect(ready.source).toBe('existing');
    expect(path.resolve(realpathSync(path.join(value.target, 'node_modules'))))
      .toBe(path.resolve(realpathSync(path.join(value.repository, 'node_modules'))));
    const authorization = await prepareWorktreePhysicalCloseout({
      repositoryRoot: value.repository,
      targetPath: value.target,
      expectedBranch: value.branch,
      expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest
    });
    expect(authorization.generatedStateRetirement).toMatchObject({ terminal: 'completed' });
    const generatedStateRetentionRoot = authorization.generatedStateRetirement?.retentionRoot?.path;
    expect(generatedStateRetentionRoot).toBeString();
    expect(existsSync(generatedStateRetentionRoot!)).toBeTrue();
    expect(authorization.generatedStateRetirement?.entries.find(
      ({ relativePath }) => relativePath === 'node_modules'
    )).toMatchObject({
      relativePath: 'node_modules',
      action: 'domain-retired',
      providerId: 'compiler-dependency-locator'
    });
    expect(existsSync(path.join(value.target, 'node_modules'))).toBe(false);
    expect(readFileSync(
      path.join(value.repository, 'node_modules', 'typescript', 'lib', 'typescript.js'),
      'utf8'
    )).toBe('primary:typescript\n');
    const receipt = await executeWorktreePhysicalCloseout({
      repositoryRoot: value.repository,
      targetPath: value.target,
      expectedBranch: value.branch,
      expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest,
      authorizationPath: authorization.authorizationPath
    });
    expect(receipt.terminal).toBe('completed');
    expect(receipt.readback).toMatchObject({ registryPresent: false, physicalPresent: false });
    expect(readFileSync(
      path.join(value.repository, 'node_modules', 'typescript', 'lib', 'typescript.js'),
      'utf8'
    )).toBe('primary:typescript\n');
    rmSync(generatedStateRetentionRoot!, { recursive: true });
    expect(existsSync(generatedStateRetentionRoot!)).toBeFalse();
    git(value.repository, ['branch', '-D', value.branch]);
    const evidenceGc = await gcCompletedWorktreePhysicalCloseoutEvidence(value.repository);
    expect(evidenceGc.retiredOperationIds).toEqual([authorization.operationId]);
    expect(evidenceGc.ownerRetired).toBeTrue();
    expect(existsSync(generatedStateRetentionRoot!)).toBeFalse();
  } finally {
    try {
      const retirement = await disposeCompilerDependencyEnvironment(
        value.repository,
        { generatedStateLifecycle: repositoryLifecycle },
        'worktree-physical-closeout-fixture-complete'
      );
      assertCompilerDependencyEnvironmentRetirementReceipt(retirement, value.repository);
      rmSync(value.root, { recursive: true });
    } finally {
      if (previousCacheHome === undefined) delete process.env.SEC_CACHE_HOME;
      else process.env.SEC_CACHE_HOME = previousCacheHome;
      if (previousStateHome === undefined) delete process.env.SEC_STATE_HOME;
      else process.env.SEC_STATE_HOME = previousStateHome;
    }
  }
}, 40_000);

test('Windows real closeout streams a large tracked leaf, normalizes readonly, and never traverses a junction', async () => {
  if (process.platform !== 'win32') return;
  const value = fixture();
  const externalJunctionTarget = path.join(value.root, 'junction-external');
  try {
    const largeRoot = path.join(value.target, 'tracked-cache');
    const largePath = path.join(largeRoot, 'large-object.bin');
    const readonlyRoot = path.join(value.target, 'readonly');
    const readonlyPath = path.join(readonlyRoot, 'nested-object.bin');
    const junctionPath = path.join(value.target, 'tracked-junction');
    mkdirSync(largeRoot);
    mkdirSync(readonlyRoot);
    mkdirSync(junctionPath);
    const largeSize = 64 * 1024 * 1024 + 4096;
    writeFileSync(largePath, '');
    truncateSync(largePath, largeSize);
    const largeHandle = openSync(largePath, 'r+');
    try {
      writeSync(largeHandle, Buffer.from('large-object-start'), 0, 18, 0);
      writeSync(largeHandle, Buffer.from('large-object-end'), 0, 16, largeSize - 16);
    } finally {
      closeSync(largeHandle);
    }
    writeFileSync(readonlyPath, 'readonly tracked object\n', 'utf8');
    writeFileSync(path.join(junctionPath, 'external-sentinel.txt'), 'must survive closeout\n', 'utf8');
    git(value.target, ['add', 'tracked-cache/large-object.bin', 'readonly/nested-object.bin', 'tracked-junction/external-sentinel.txt']);
    git(value.target, ['commit', '-m', 'add physical closeout stress leaves']);
    value.headSha = git(value.target, ['rev-parse', 'HEAD']);
    value.treeSha = git(value.target, ['rev-parse', 'HEAD^{tree}']);
    chmodSync(readonlyPath, 0o444);
    renameSync(junctionPath, externalJunctionTarget);
    symlinkSync(externalJunctionTarget, junctionPath, 'junction');
    expect(git(value.target, ['status', '--porcelain=v1', '--untracked-files=all'])).toBe('');

    const prepared = await prepareTrustedWorktreePhysicalCloseout({
      repositoryRoot: value.repository,
      targetPath: value.target,
      expectedBranch: value.branch,
      expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest
    });
    expect(prepared.authorization.inventory.entries.find((entry) => entry.relativePath === 'tracked-cache/large-object.bin')).toMatchObject({
      kind: 'file', size: largeSize
    });
    expect(prepared.authorization.inventory.entries.find((entry) => entry.relativePath === 'tracked-junction')).toMatchObject({
      kind: 'symlink'
    });
    const receipt = await executeWorktreePhysicalCloseout({
      repositoryRoot: value.repository,
      targetPath: value.target,
      expectedBranch: value.branch,
      expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest,
      authorizationPath: prepared.authorization.authorizationPath
    });
    expect(receipt.terminal).toBe('completed');
    expect(assertTrustedCompletedWorktreePhysicalCloseout({
      token: prepared.token,
      repositoryRoot: value.repository,
      targetPath: value.target,
      branch: value.branch,
      headSha: value.headSha,
      treeSha: value.treeSha,
      recoveryAuthorityDigest: value.recoveryAuthorityDigest
    }).receiptDigest).toBe(receipt.receiptDigest);
    expect(readFileSync(path.join(externalJunctionTarget, 'external-sentinel.txt'), 'utf8')).toBe('must survive closeout\n');
    expect(existsSync(value.target)).toBe(false);
    expect(gitPath(git(value.repository, ['worktree', 'list', '--porcelain']))).not.toContain(gitPath(value.target));
  } finally {
    const externalSentinel = path.join(externalJunctionTarget, 'external-sentinel.txt');
    if (existsSync(externalSentinel)) chmodSync(externalSentinel, 0o666);
    rmSync(value.root, { recursive: true, force: true });
  }
}, 120_000);

test('first same-branch completed token remains target-valid after a second registered worktree closes', async () => {
  const value = fixture();
  const secondTarget = path.join(value.root, 'candidate-second');
  try {
    // Git normally refuses a second checkout of the same branch.  This is the
    // real registry shape that exercises historical target-specific tokens:
    // both registrations name the same branch/head/tree but have independent
    // target/admin identities.
    git(value.repository, ['worktree', 'add', '--force', secondTarget, value.branch]);
    const secondHeadSha = git(secondTarget, ['rev-parse', 'HEAD']);
    const secondTreeSha = git(secondTarget, ['rev-parse', 'HEAD^{tree}']);
    expect(secondHeadSha).toBe(value.headSha);
    expect(secondTreeSha).toBe(value.treeSha);

    const first = await prepareTrustedWorktreePhysicalCloseout({
      repositoryRoot: value.repository, targetPath: value.target, expectedBranch: value.branch,
      expectedHeadSha: value.headSha, expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest
    });
    const firstReceipt = await executeWorktreePhysicalCloseout({
      repositoryRoot: value.repository, targetPath: value.target, expectedBranch: value.branch,
      expectedHeadSha: value.headSha, expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest,
      authorizationPath: first.authorization.authorizationPath
    });
    expect(firstReceipt.terminal).toBe('completed');

    const second = await prepareTrustedWorktreePhysicalCloseout({
      repositoryRoot: value.repository, targetPath: secondTarget, expectedBranch: value.branch,
      expectedHeadSha: secondHeadSha, expectedTreeSha: secondTreeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest
    });
    const secondReceipt = await executeWorktreePhysicalCloseout({
      repositoryRoot: value.repository, targetPath: secondTarget, expectedBranch: value.branch,
      expectedHeadSha: secondHeadSha, expectedTreeSha: secondTreeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest,
      authorizationPath: second.authorization.authorizationPath
    });
    expect(secondReceipt.terminal).toBe('completed');
    expect(firstReceipt.registryAfterDigest).not.toBe(secondReceipt.registryAfterDigest);
    expect(assertTrustedCompletedWorktreePhysicalCloseout({
      token: first.token, repositoryRoot: value.repository, targetPath: value.target,
      branch: value.branch, headSha: value.headSha, treeSha: value.treeSha,
      recoveryAuthorityDigest: value.recoveryAuthorityDigest
    }).receiptDigest).toBe(firstReceipt.receiptDigest);
    expect(gitPath(git(value.repository, ['worktree', 'list', '--porcelain']))).not.toContain(gitPath(value.target));
    expect(gitPath(git(value.repository, ['worktree', 'list', '--porcelain']))).not.toContain(gitPath(secondTarget));
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}, 60_000);

test('a collapsed ignored control ancestor admits only the exact held lease namespace', async () => {
  for (const foreignSibling of [false, true]) {
    const value = fixture();
    try {
      writeFileSync(path.join(value.target, '.gitignore'), '.sec/\n', 'utf8');
      git(value.target, ['add', '.gitignore']);
      git(value.target, ['commit', '-m', 'ignore control state']);
      value.headSha = git(value.target, ['rev-parse', 'HEAD']);
      value.treeSha = git(value.target, ['rev-parse', 'HEAD^{tree}']);
      if (foreignSibling) {
        mkdirSync(path.join(value.target, '.sec'), { recursive: true });
        writeFileSync(path.join(value.target, '.sec', 'foreign.txt'), 'foreign\n', 'utf8');
        await expect(prepareWorktreePhysicalCloseout({
          repositoryRoot: value.repository,
          targetPath: value.target,
          expectedBranch: value.branch,
          expectedHeadSha: value.headSha,
          expectedTreeSha: value.treeSha,
          expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest
        })).rejects.toThrow('working-state-not-clean');
        expect(existsSync(path.join(value.target, '.sec', 'foreign.txt'))).toBe(true);
        continue;
      }
      const authorization = await prepareWorktreePhysicalCloseout({
        repositoryRoot: value.repository,
        targetPath: value.target,
        expectedBranch: value.branch,
        expectedHeadSha: value.headSha,
        expectedTreeSha: value.treeSha,
        expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest
      });
      const receipt = await executeWorktreePhysicalCloseout({
        repositoryRoot: value.repository,
        targetPath: value.target,
        expectedBranch: value.branch,
        expectedHeadSha: value.headSha,
        expectedTreeSha: value.treeSha,
        expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest,
        authorizationPath: authorization.authorizationPath
      });
      expect(receipt.terminal).toBe('completed');
      expect(existsSync(value.target)).toBe(false);
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  }
}, 60_000);

test('self-signed unregister receipt cannot elevate a token without this-process retained admin effect', async () => {
  const value = fixture();
  try {
    const prepared = await prepareTrustedWorktreePhysicalCloseout({
      repositoryRoot: value.repository, targetPath: value.target, expectedBranch: value.branch,
      expectedHeadSha: value.headSha, expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest
    });
    const registryAdminPath = path.join(
      prepared.authorization.repository.commonDir,
      ...prepared.authorization.registryAdmin.relativePath.split('/')
    );
    writeFileSync(path.join(registryAdminPath, 'foreign-admin-entry'), 'foreign\n');
    const retired = await executeWorktreePhysicalCloseout({
      repositoryRoot: value.repository, targetPath: value.target, expectedBranch: value.branch,
      expectedHeadSha: value.headSha, expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest,
      authorizationPath: prepared.authorization.authorizationPath
    });
    expect(retired.blockers).toContain('registry-admin-inventory-changed');
    rmSync(registryAdminPath, { recursive: true, force: true });

    const { schema: ignoredSchema, receiptDigest: ignoredDigest, ...retiredInput } = retired;
    const forged = createWorktreePhysicalCloseoutReceipt({
      ...retiredInput,
      previousReceiptDigest: retired.receiptDigest,
      attempts: [...retired.attempts, {
        operation: 'unregister', status: 'success', relativePath: null,
        detailDigest: detailDigest('attacker-self-signed-admin-effect')
      }],
      readback: { registryPresent: false, physicalPresent: true, authorizationValid: true },
      terminal: 'residue',
      blockers: ['attacker-self-signed-admin-effect']
    });
    const operationRoot = path.dirname(prepared.authorization.receiptPath);
    const generation = `receipt-${forged.receiptDigest.slice('sha256:'.length)}.json`;
    writeFileSync(path.join(operationRoot, generation), `${JSON.stringify(forged)}\n`);
    writeFileSync(prepared.authorization.receiptPath, `${JSON.stringify({
      schema: 'sec-worktree-cleanup-receipt-latest-v1', generation, receiptDigest: forged.receiptDigest
    })}\n`);

    const converged = await executeWorktreePhysicalCloseout({
      repositoryRoot: value.repository, targetPath: value.target, expectedBranch: value.branch,
      expectedHeadSha: value.headSha, expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest,
      authorizationPath: prepared.authorization.authorizationPath
    });
    expect(converged.terminal).toBe('completed');
    expect(() => assertTrustedCompletedWorktreePhysicalCloseout({
      token: prepared.token, repositoryRoot: value.repository, targetPath: value.target,
      branch: value.branch, headSha: value.headSha, treeSha: value.treeSha,
      recoveryAuthorityDigest: value.recoveryAuthorityDigest
    })).toThrow('did not witness this process-held retirement, admin effect, and completed receipt issuance');
    void ignoredSchema;
    void ignoredDigest;
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}, 60_000);

test('dirty untracked and ignored targets block before durable authorization or unregister', async () => {
  for (const kind of ['dirty', 'untracked', 'ignored'] as const) {
    const value = fixture();
    try {
      if (kind === 'dirty') writeFileSync(path.join(value.target, 'tracked.txt'), 'dirty\n', 'utf8');
      if (kind === 'untracked') writeFileSync(path.join(value.target, 'untracked.txt'), 'unknown\n', 'utf8');
      if (kind === 'ignored') {
        writeFileSync(path.join(value.target, '.gitignore'), 'ignored.txt\n', 'utf8');
        git(value.target, ['add', '.gitignore']);
        git(value.target, ['commit', '-m', 'ignore policy']);
        value.headSha = git(value.target, ['rev-parse', 'HEAD']);
        value.treeSha = git(value.target, ['rev-parse', 'HEAD^{tree}']);
        writeFileSync(path.join(value.target, 'ignored.txt'), 'ignored\n', 'utf8');
      }
      await expect(
        prepareWorktreePhysicalCloseout({
          repositoryRoot: value.repository,
          targetPath: value.target,
          expectedBranch: value.branch,
          expectedHeadSha: value.headSha,
          expectedTreeSha: value.treeSha,
          expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest
        })
      ).rejects.toThrow('working-state-not-clean');
      expect(existsSync(value.target)).toBe(true);
      expect(gitPath(git(value.repository, ['worktree', 'list', '--porcelain']))).toContain(gitPath(value.target));
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  }
}, 60_000);

test('detached scratch closeout is branch-token-ineligible and reaches physical/registry absence', async () => {
  const value = fixture();
  const scratch = path.join(value.root, 'detached-scratch');
  try {
    git(value.repository, ['worktree', 'add', '--detach', scratch, value.headSha]);
    const authorization = await prepareDetachedScratchWorktreePhysicalCloseout({
      repositoryRoot: value.repository, targetPath: scratch, expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha, expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest
    });
    await expect(prepareTrustedWorktreePhysicalCloseout({
      repositoryRoot: value.repository, targetPath: scratch, expectedBranch: `detached-scratch-${value.headSha}`,
      expectedHeadSha: value.headSha, expectedTreeSha: value.treeSha, expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest
    })).rejects.toThrow('cannot mint');
    const receipt = await executeDetachedScratchWorktreePhysicalCloseout({
      repositoryRoot: value.repository, targetPath: scratch, expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha, expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest,
      authorizationPath: authorization.authorizationPath
    });
    expect(receipt.terminal).toBe('completed');
    expect(existsSync(scratch)).toBe(false);
  } finally { rmSync(value.root, { recursive: true, force: true }); }
}, 60_000);

test('detached scratch derives its correlation without a caller marker when only main retains its commit', async () => {
  const value = fixture();
  const scratch = path.join(value.root, 'markerless-detached-scratch');
  try {
    git(value.repository, ['worktree', 'remove', value.target]);
    git(value.repository, ['branch', '-D', value.branch]);
    git(value.repository, ['worktree', 'add', '--detach', scratch, value.headSha]);
    const input = {
      repositoryRoot: value.repository, targetPath: scratch,
      expectedHeadSha: value.headSha, expectedTreeSha: value.treeSha
    };
    const authorization = await prepareDetachedScratchWorktreePhysicalCloseout(input);
    expect(authorization.target.recoveryAuthorityDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    const receipt = await executeDetachedScratchWorktreePhysicalCloseout({
      ...input, authorizationPath: authorization.authorizationPath
    });
    expect(receipt.terminal).toBe('completed');
    expect(existsSync(scratch)).toBe(false);
  } finally { rmSync(value.root, { recursive: true, force: true }); }
}, 60_000);

test('detached scratch rejects an unreferenced commit before publishing closeout authorization', async () => {
  const value = fixture();
  const scratch = path.join(value.root, 'unreferenced-detached-scratch');
  try {
    git(value.repository, ['worktree', 'add', '--detach', scratch, value.headSha]);
    writeFileSync(path.join(scratch, 'scratch.txt'), 'unreferenced\n', 'utf8');
    git(scratch, ['add', 'scratch.txt']);
    git(scratch, ['commit', '-m', 'unreferenced scratch']);
    const scratchHead = git(scratch, ['rev-parse', 'HEAD']);
    const scratchTree = git(scratch, ['rev-parse', 'HEAD^{tree}']);
    await expect(prepareDetachedScratchWorktreePhysicalCloseout({
      repositoryRoot: value.repository, targetPath: scratch,
      expectedHeadSha: scratchHead, expectedTreeSha: scratchTree
    })).rejects.toThrow('no retained local branch recovery source');
    expect(existsSync(scratch)).toBe(true);
    expect(gitPath(git(value.repository, ['worktree', 'list', '--porcelain']))).toContain(gitPath(scratch));
  } finally { rmSync(value.root, { recursive: true, force: true }); }
}, 60_000);

test('detached scratch rechecks retained branch reachability before unregister', async () => {
  const value = fixture();
  const scratch = path.join(value.root, 'drifting-detached-scratch');
  try {
    git(value.repository, ['worktree', 'add', '--detach', scratch, value.headSha]);
    writeFileSync(path.join(scratch, 'scratch.txt'), 'later-unreferenced\n', 'utf8');
    git(scratch, ['add', 'scratch.txt']);
    git(scratch, ['commit', '-m', 'later unreferenced scratch']);
    const scratchHead = git(scratch, ['rev-parse', 'HEAD']);
    const scratchTree = git(scratch, ['rev-parse', 'HEAD^{tree}']);
    git(value.repository, ['branch', 'retain-scratch', scratchHead]);
    const input = {
      repositoryRoot: value.repository, targetPath: scratch,
      expectedHeadSha: scratchHead, expectedTreeSha: scratchTree
    };
    const authorization = await prepareDetachedScratchWorktreePhysicalCloseout(input);
    git(value.repository, ['branch', '-D', 'retain-scratch']);
    await expect(executeDetachedScratchWorktreePhysicalCloseout({
      ...input, authorizationPath: authorization.authorizationPath
    })).rejects.toThrow('no retained local branch recovery source');
    expect(existsSync(scratch)).toBe(true);
    expect(gitPath(git(value.repository, ['worktree', 'list', '--porcelain']))).toContain(gitPath(scratch));
  } finally { rmSync(value.root, { recursive: true, force: true }); }
}, 60_000);

test('an unregistered physical orphan cannot be adopted or removed', async () => {
  const value = fixture();
  try {
    git(value.repository, ['worktree', 'remove', value.target]);
    mkdirSync(value.target);
    writeFileSync(path.join(value.target, 'orphan.txt'), 'orphan\n', 'utf8');
    await expect(
      prepareWorktreePhysicalCloseout({
        repositoryRoot: value.repository,
        targetPath: value.target,
        expectedBranch: value.branch,
        expectedHeadSha: value.headSha,
        expectedTreeSha: value.treeSha,
        expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest
      })
    ).rejects.toThrow('unknown historical orphans cannot be adopted');
    expect(existsSync(value.target)).toBe(true);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}, 30_000);

test('raw JSON or a caller-constructed token cannot mint trusted closeout consumption', async () => {
  const value = fixture();
  try {
    expect(() => assertTrustedCompletedWorktreePhysicalCloseout({
      token: new WorktreePhysicalCloseoutConsumptionToken(),
      repositoryRoot: value.repository,
      targetPath: value.target,
      branch: value.branch,
      headSha: value.headSha,
      treeSha: value.treeSha,
      recoveryAuthorityDigest: value.recoveryAuthorityDigest
    })).toThrow('was not issued by this process');
    expect(gitPath(git(value.repository, ['worktree', 'list', '--porcelain']))).toContain(gitPath(value.target));
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}, 30_000);

test('prepared token cannot be promoted by a caller-completed public retirement phase and receipt chain', async () => {
  const value = fixture();
  try {
    const prepared = await prepareTrustedWorktreePhysicalCloseout({
      repositoryRoot: value.repository, targetPath: value.target, expectedBranch: value.branch,
      expectedHeadSha: value.headSha, expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest
    });
    // This helper uses only the public lease/retirement API to create a fully
    // valid pre-bound proof and durable phase, then a normal execute process
    // converges it.  It deliberately never executes the engine branch that
    // held the target lease and receives its `retireOwnedNamespace` result.
    await persistRetiredPhaseForCrash(prepared.authorization);
    const receipt = await executeWorktreePhysicalCloseout({
      repositoryRoot: value.repository, targetPath: value.target, expectedBranch: value.branch,
      expectedHeadSha: value.headSha, expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest,
      authorizationPath: prepared.authorization.authorizationPath
    });
    expect(receipt.terminal).toBe('completed');
    expect(() => assertTrustedCompletedWorktreePhysicalCloseout({
      token: prepared.token, repositoryRoot: value.repository, targetPath: value.target,
      branch: value.branch, headSha: value.headSha, treeSha: value.treeSha,
      recoveryAuthorityDigest: value.recoveryAuthorityDigest
    })).toThrow('did not witness this process-held retirement');
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}, 30_000);

test('trusted closeout consumption rejects a deleted or replaced retained proof ledger', async () => {
  const value = fixture();
  try {
    const prepared = await prepareTrustedWorktreePhysicalCloseout({
      repositoryRoot: value.repository, targetPath: value.target, expectedBranch: value.branch,
      expectedHeadSha: value.headSha, expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest
    });
    const receipt = await executeWorktreePhysicalCloseout({
      repositoryRoot: value.repository, targetPath: value.target, expectedBranch: value.branch,
      expectedHeadSha: value.headSha, expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest,
      authorizationPath: prepared.authorization.authorizationPath
    });
    expect(receipt.terminal).toBe('completed');
    expect(assertTrustedCompletedWorktreePhysicalCloseout({
      token: prepared.token, repositoryRoot: value.repository, targetPath: value.target,
      branch: value.branch, headSha: value.headSha, treeSha: value.treeSha,
      recoveryAuthorityDigest: value.recoveryAuthorityDigest
    }).receiptDigest).toBe(receipt.receiptDigest);
    rmSync(prepared.authorization.proofRoot.path, { recursive: true, force: true });
    expect(() => assertTrustedCompletedWorktreePhysicalCloseout({
      token: prepared.token, repositoryRoot: value.repository, targetPath: value.target,
      branch: value.branch, headSha: value.headSha, treeSha: value.treeSha,
      recoveryAuthorityDigest: value.recoveryAuthorityDigest
    })).toThrow();
    mkdirSync(prepared.authorization.proofRoot.path);
    expect(() => assertTrustedCompletedWorktreePhysicalCloseout({
      token: prepared.token, repositoryRoot: value.repository, targetPath: value.target,
      branch: value.branch, headSha: value.headSha, treeSha: value.treeSha,
      recoveryAuthorityDigest: value.recoveryAuthorityDigest
    })).toThrow();
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}, 30_000);

test('foreign retained-proof content blocks execute and leaves the retirement fence intact', async () => {
  const value = fixture();
  try {
    const authorization = await prepareWorktreePhysicalCloseout({
      repositoryRoot: value.repository, targetPath: value.target, expectedBranch: value.branch,
      expectedHeadSha: value.headSha, expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest
    });
    await persistRetiredPhaseForCrash(authorization);
    writeFileSync(path.join(authorization.proofRoot.path, 'foreign-proof.txt'), 'foreign\n');
    const receipt = await executeWorktreePhysicalCloseout({
      repositoryRoot: value.repository, targetPath: value.target, expectedBranch: value.branch,
      expectedHeadSha: value.headSha, expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest,
      authorizationPath: authorization.authorizationPath
    });
    expect(receipt.terminal).toBe('blocked');
    expect(receipt.blockers.some((blocker) => blocker.startsWith('retirement-proof-final-readback-invalid:'))).toBe(true);
    expect(readdirSync(path.dirname(value.target)).some((name) => /^\.workspace-write-lease-retired-[0-9a-f]{64}\.json$/u.test(name))).toBe(true);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}, 30_000);

test('physical residue retry advances immutable receipt generation without erasing the first attempt', async () => {
  if (process.platform !== 'win32') return;
  const value = fixture();
  try {
    const authorization = await prepareWorktreePhysicalCloseout({
      repositoryRoot: value.repository,
      targetPath: value.target,
      expectedBranch: value.branch,
      expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest
    });
    // Real external state transition: Git unregisters the worktree, then an
    // out-of-band actor leaves a physical residue before this executor can
    // resume.  The engine receives neither a production hook nor a test-only
    // authority; it must classify the live state itself.
    git(value.repository, ['worktree', 'remove', '--force', value.target]);
    mkdirSync(value.target);
    writeFileSync(path.join(value.target, 'external-residue.txt'), 'external residue', 'utf8');
    const first = await executeWorktreePhysicalCloseout({
      repositoryRoot: value.repository,
      targetPath: value.target,
      expectedBranch: value.branch,
      expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest,
      authorizationPath: authorization.authorizationPath
    });
    expect(first.terminal).toBe('residue');
    expect(first.readback.physicalPresent).toBe(true);
    const operationRoot = path.dirname(authorization.receiptPath);
    const firstGeneration = `receipt-${first.receiptDigest.slice('sha256:'.length)}.json`;
    expect(existsSync(path.join(operationRoot, firstGeneration))).toBe(true);
    rmSync(value.target, { recursive: true, force: true });

    const second = await executeWorktreePhysicalCloseout({
      repositoryRoot: value.repository,
      targetPath: value.target,
      expectedBranch: value.branch,
      expectedHeadSha: value.headSha,
      expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest,
      authorizationPath: authorization.authorizationPath
    });
    // The registry admin tree disappeared through an external Git effect, so
    // removing the visible physical residue may not promote the operation.
    // The durable chain deliberately retains this as nonterminal until an
    // authorized retained-admin effect witness exists.
    expect(second.terminal).toBe('residue');
    expect(second.blockers).toContain('registry-admin-disappeared-without-authorized-effect-witness');
    expect(second.receiptDigest).not.toBe(first.receiptDigest);
    expect(existsSync(path.join(operationRoot, firstGeneration))).toBe(true);
    const preserved = JSON.parse(readFileSync(path.join(operationRoot, firstGeneration), 'utf8')) as {
      terminal: string; attempts: unknown;
    };
    expect(preserved.terminal).toBe('residue');
    expect(preserved.attempts).toEqual(first.attempts);
    expect(first.attempts.some((attempt) => attempt.operation === 'unregister' && attempt.status === 'skipped')).toBe(true);
    expect(second.attempts.some((attempt) => attempt.operation === 'unregister' && attempt.status === 'skipped')).toBe(true);
    const latest = JSON.parse(readFileSync(authorization.receiptPath, 'utf8')) as {
      schema: string;
      generation: string;
      receiptDigest: string;
    };
    expect(latest).toEqual({
      schema: 'sec-worktree-cleanup-receipt-latest-v1',
      generation: `receipt-${second.receiptDigest.slice('sha256:'.length)}.json`,
      receiptDigest: second.receiptDigest
    });
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}, 60_000);

test('execute resumes an exact operation tombstone and never deletes a rebuilt original path', async () => {
  const value = fixture();
  try {
    const authorization = await prepareWorktreePhysicalCloseout({
      repositoryRoot: value.repository, targetPath: value.target, expectedBranch: value.branch,
      expectedHeadSha: value.headSha, expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest
    });
    const tombstone = relocateRetainedNoFollowDirectory({
      directory: inspectNoFollowDirectoryChain(value.target, 'test tombstone source').target,
      tombstoneName: authorization.tombstoneName
    });
    expect(existsSync(value.target)).toBe(false);
    const receipt = await executeWorktreePhysicalCloseout({
      repositoryRoot: value.repository, targetPath: value.target, expectedBranch: value.branch,
      expectedHeadSha: value.headSha, expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest, authorizationPath: authorization.authorizationPath
    });
    expect(receipt.terminal).toBe('completed');
    expect(existsSync(tombstone.path)).toBe(false);

    const second = fixture();
    try {
      const secondAuthorization = await prepareWorktreePhysicalCloseout({
        repositoryRoot: second.repository, targetPath: second.target, expectedBranch: second.branch,
        expectedHeadSha: second.headSha, expectedTreeSha: second.treeSha,
        expectedRecoveryAuthorityDigest: second.recoveryAuthorityDigest
      });
      relocateRetainedNoFollowDirectory({
        directory: inspectNoFollowDirectoryChain(second.target, 'test rebuilt source').target,
        tombstoneName: secondAuthorization.tombstoneName
      });
      mkdirSync(second.target);
      writeFileSync(path.join(second.target, 'new-owner.txt'), 'must survive\n', 'utf8');
      const blocked = await executeWorktreePhysicalCloseout({
        repositoryRoot: second.repository, targetPath: second.target, expectedBranch: second.branch,
        expectedHeadSha: second.headSha, expectedTreeSha: second.treeSha,
        expectedRecoveryAuthorityDigest: second.recoveryAuthorityDigest, authorizationPath: secondAuthorization.authorizationPath
      });
      expect(blocked.terminal).toBe('blocked');
      expect(readFileSync(path.join(second.target, 'new-owner.txt'), 'utf8')).toBe('must survive\n');
    } finally { rmSync(second.root, { recursive: true, force: true }); }
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}, 60_000);

test('retired target phase resumes before unregister and rejects registry disappearance without an effect witness', async () => {
  for (const crashBoundary of ['before-unregister', 'after-unregister'] as const) {
    const value = fixture();
    try {
      const authorization = await prepareWorktreePhysicalCloseout({
        repositoryRoot: value.repository, targetPath: value.target, expectedBranch: value.branch,
        expectedHeadSha: value.headSha, expectedTreeSha: value.treeSha,
        expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest
      });
      const tombstone = await persistRetiredPhaseForCrash(authorization);
      expect(existsSync(value.target)).toBe(false);
      if (crashBoundary === 'after-unregister') {
        const gitdir = /^gitdir: ([^\r\n]+)/u.exec(readFileSync(path.join(tombstone, '.git'), 'utf8'))?.[1];
        if (!gitdir) throw new Error('fixture worktree gitdir locator is malformed');
        // This is an external deletion, not a production crash witness: the
        // canonical admin tombstone and durable unregister-success predecessor
        // were never published, so closeout must not adopt it.
        rmSync(gitdir, { recursive: true, force: true });
      }
      const receipt = await executeWorktreePhysicalCloseout({
        repositoryRoot: value.repository, targetPath: value.target, expectedBranch: value.branch,
        expectedHeadSha: value.headSha, expectedTreeSha: value.treeSha,
        expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest, authorizationPath: authorization.authorizationPath
      });
      expect(receipt.terminal).toBe(crashBoundary === 'before-unregister' ? 'completed' : 'residue');
      if (crashBoundary === 'after-unregister') {
        expect(receipt.blockers).toContain('registry-admin-disappeared-without-authorized-effect-witness');
        expect(existsSync(tombstone)).toBe(true);
      } else {
        expect(existsSync(tombstone)).toBe(false);
      }
      expect(gitPath(git(value.repository, ['worktree', 'list', '--porcelain']))).not.toContain(gitPath(value.target));
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  }
}, 60_000);

test('a rebuilt original path survives retained registry-admin deletion without a Git path effect', async () => {
  const value = fixture();
  try {
    const authorization = await prepareWorktreePhysicalCloseout({
      repositoryRoot: value.repository, targetPath: value.target, expectedBranch: value.branch,
      expectedHeadSha: value.headSha, expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest
    });
    const tombstone = await persistRetiredPhaseForCrash(authorization);
    mkdirSync(value.target);
    writeFileSync(path.join(value.target, 'new-owner.txt'), 'must survive\n');
    const receipt = await executeWorktreePhysicalCloseout({
      repositoryRoot: value.repository, targetPath: value.target, expectedBranch: value.branch,
      expectedHeadSha: value.headSha, expectedTreeSha: value.treeSha,
      expectedRecoveryAuthorityDigest: value.recoveryAuthorityDigest, authorizationPath: authorization.authorizationPath
    });
    expect(receipt.terminal).toBe('residue');
    expect(existsSync(path.join(value.target, 'new-owner.txt'))).toBe(true);
    expect(existsSync(tombstone)).toBe(false);
    expect(gitPath(git(value.repository, ['worktree', 'list', '--porcelain']))).not.toContain(gitPath(value.target));
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}, 60_000);

test('locked worktree and target-root replacement fail closed before unregister', async () => {
  const locked = fixture();
  try {
    git(locked.repository, ['worktree', 'lock', locked.target]);
    await expect(
      prepareWorktreePhysicalCloseout({
        repositoryRoot: locked.repository,
        targetPath: locked.target,
        expectedBranch: locked.branch,
        expectedHeadSha: locked.headSha,
        expectedTreeSha: locked.treeSha,
        expectedRecoveryAuthorityDigest: locked.recoveryAuthorityDigest
      })
    ).rejects.toThrow('target-is-locked');
    expect(gitPath(git(locked.repository, ['worktree', 'list', '--porcelain']))).toContain(gitPath(locked.target));
  } finally {
    rmSync(locked.root, { recursive: true, force: true });
  }

  const replaced = fixture();
  const outside = mkdtempSync(path.join(tmpdir(), 'sec-worktree-outside-sentinel-'));
  try {
    const sentinel = path.join(outside, 'sentinel.txt');
    writeFileSync(sentinel, 'preserve-me\n', 'utf8');
    const authorization = await prepareWorktreePhysicalCloseout({
      repositoryRoot: replaced.repository,
      targetPath: replaced.target,
      expectedBranch: replaced.branch,
      expectedHeadSha: replaced.headSha,
      expectedTreeSha: replaced.treeSha,
      expectedRecoveryAuthorityDigest: replaced.recoveryAuthorityDigest
    });
    renameSync(replaced.target, `${replaced.target}-original`);
    symlinkSync(outside, replaced.target, 'dir');
    const receipt = await executeWorktreePhysicalCloseout({
      repositoryRoot: replaced.repository,
      targetPath: replaced.target,
      expectedBranch: replaced.branch,
      expectedHeadSha: replaced.headSha,
      expectedTreeSha: replaced.treeSha,
      expectedRecoveryAuthorityDigest: replaced.recoveryAuthorityDigest,
      authorizationPath: authorization.authorizationPath
    });
    expect(receipt.terminal).toBe('blocked');
    expect(receipt.readback.registryPresent).toBe(true);
    expect(readFileSync(sentinel, 'utf8')).toBe('preserve-me\n');
  } finally {
    rmSync(replaced.root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}, 60_000);
