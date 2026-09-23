import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs, { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { withAuthorityGitReadSession } from '../../src/adapters/providers/git-read/authority.ts';
import { createAuthorityGitReadSession } from '../../src/adapters/providers/git-read/runtime/session.ts';
import {
  compileAffectedTestSelectionSemanticOperation
} from '../../src/adapters/self-hosting/development/runner/affected-plan-contract.ts';
import {
  projectRepositoryObserverFailureDiagnostic,
  runRepositoryZeroWriteOperation
} from '../../src/adapters/self-hosting/development/runner/repository-mutation-fence.ts';
import {
  withRepositoryFinalStateObservation
} from '../../src/adapters/self-hosting/development/runner/repository-observation.ts';
import type { FastTestBatchExecutionAdmission } from '../../src/adapters/self-hosting/development/runner/test-execution-policy.ts';
import {
  assertGitObjectId,
  GIT_READ_OPERATION_BUDGET,
  readBlobBatch,
  readCommitBlobInventory,
  readTextAttributesBatch,
  resolveExactHeadCommit,
  runGitRead
} from '../../src/adapters/self-hosting/development/tooling/git/git-read.ts';
import { runCensus } from '../../src/adapters/self-hosting/development/tooling/text/text-byte-census.ts';
import { runSettlement } from '../../src/adapters/self-hosting/development/tooling/workspace/worktree-settlement.ts';

function git(repositoryRoot: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function gitReadOperation() {
  return compileAffectedTestSelectionSemanticOperation({ purpose: 'check-affected' });
}

async function createRepository(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.email', 'tests@example.com']);
  git(root, ['config', 'user.name', 'SEC Tests']);
  git(root, ['config', 'core.autocrlf', 'false']);
  await fs.writeFile(path.join(root, '.gitattributes'), '*.ts text eol=lf\n');
  await fs.writeFile(path.join(root, 'committed.ts'), 'export const committed = true;\n');
  git(root, ['add', '--all']);
  git(root, ['commit', '--quiet', '-m', 'initial']);
  return root;
}

test('Git read mechanics accept full SHA-1 and SHA-256 object IDs', () => {
  expect(assertGitObjectId('a'.repeat(40), 'sha1')).toBe('a'.repeat(40));
  expect(assertGitObjectId('b'.repeat(64), 'sha256')).toBe('b'.repeat(64));
  expect(() => assertGitObjectId('c'.repeat(39), 'short')).toThrow();
  expect(() => assertGitObjectId('d'.repeat(63), 'short-sha256')).toThrow();
  expect(() => assertGitObjectId('e'.repeat(65), 'long')).toThrow();
});

test('batch blob and attribute observations bind to one exact commit', async () => {
  const root = await createRepository('sec-dev-git-batch-');
  try {
    await withAuthorityGitReadSession({
      cwd: root,
      operation: gitReadOperation(),
      budget: GIT_READ_OPERATION_BUDGET
    }, async (session) => {
      const commit = await resolveExactHeadCommit(session);
      const inventory = await readCommitBlobInventory(session, commit);
      expect(inventory.map((entry) => entry.path)).toEqual(['.gitattributes', 'committed.ts']);
      expect(inventory.every((entry) => Number.isSafeInteger(entry.byteSize) && entry.byteSize >= 0)).toBe(true);

      const blobs = await readBlobBatch(session, inventory.map((entry) => entry.objectId));
      const committed = inventory.find((entry) => entry.path === 'committed.ts')!;
      expect(blobs.get(committed.objectId)?.toString('utf8')).toBe('export const committed = true;\n');

      const attributes = await readTextAttributesBatch(session, commit, inventory.map((entry) => entry.path));
      expect(attributes.get('committed.ts')).toEqual({ textAttr: 'set', eolAttr: 'lf' });
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Git replacement objects cannot substitute committed blob bytes', async () => {
  const root = await createRepository('sec-dev-git-replace-');
  try {
    const commit = await withAuthorityGitReadSession({
      cwd: root,
      operation: gitReadOperation(),
      budget: GIT_READ_OPERATION_BUDGET
    }, (session) => resolveExactHeadCommit(session));
    const committed = await withAuthorityGitReadSession({
      cwd: root,
      operation: gitReadOperation(),
      budget: GIT_READ_OPERATION_BUDGET
    }, (session) =>
      readCommitBlobInventory(session, commit)
    ).then((inventory) => inventory.find((entry) => entry.path === 'committed.ts')!);
    const replacementPath = path.join(root, 'replacement.tmp');
    await fs.writeFile(replacementPath, 'export const committed = null;\n');
    const replacement = git(root, ['hash-object', '-w', 'replacement.tmp']);
    await fs.rm(replacementPath);
    git(root, ['replace', committed.objectId, replacement]);

    expect(git(root, ['cat-file', 'blob', committed.objectId])).toContain('committed = null');
    await withAuthorityGitReadSession({
      cwd: root,
      operation: gitReadOperation(),
      budget: GIT_READ_OPERATION_BUDGET
    }, async (session) => {
      const blobs = await readBlobBatch(session, [committed.objectId]);
      expect(blobs.get(committed.objectId)?.toString('utf8')).toBe('export const committed = true;\n');
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('trusted Git reads isolate ambient config and alternate index injection', async () => {
  const root = await createRepository('sec-dev-git-config-isolation-');
  try {
    const alternateIndex = path.join(root, '.git', 'outside.index');
    const hostileEnvironment = { ...process.env, GIT_INDEX_FILE: alternateIndex };
    const emptyIndex = spawnSync('git', ['read-tree', '--empty'], {
      cwd: root, env: hostileEnvironment, encoding: 'utf8', windowsHide: true
    });
    expect(emptyIndex.status).toBe(0);
    const alternateIndexBytes = await fs.readFile(alternateIndex);
    const canonicalIndexBytes = await fs.readFile(path.join(root, '.git', 'index'));
    const redirectedRead = spawnSync('git', ['ls-files', '--cached', '-z'], {
      cwd: root, env: hostileEnvironment, encoding: 'utf8', windowsHide: true
    });
    expect(redirectedRead.status).toBe(0);
    expect(redirectedRead.stdout).toBe('');
    const moduleUrl = pathToFileURL(path.resolve('src/adapters/self-hosting/development/tooling/git/git-read.ts')).href;
    const source = [
      `import { withAuthorityGitReadSession } from ${JSON.stringify(pathToFileURL(path.resolve('src/adapters/providers/git-read/authority.ts')).href)};`,
      `import { compileAffectedTestSelectionSemanticOperation } from ${JSON.stringify(pathToFileURL(path.resolve('src/adapters/self-hosting/development/runner/affected-plan-contract.ts')).href)};`,
      `import { GIT_READ_OPERATION_BUDGET, runGitRead } from ${JSON.stringify(moduleUrl)};`,
      `const operation = compileAffectedTestSelectionSemanticOperation({ purpose: 'check-affected' });`,
      `const result = await withAuthorityGitReadSession({ cwd: ${JSON.stringify(root)}, operation, budget: GIT_READ_OPERATION_BUDGET }, async (session) => {`,
      "const config = await runGitRead(session, ['config', '--get', 'sec.injected']);",
      "const index = await runGitRead(session, ['ls-files', '--cached', '-z']);",
      "return { status: config.status, stdoutByteLength: config.stdout.byteLength, indexStatus: index.status, indexPaths: index.stdout.toString('utf8') }; });",
      "process.stdout.write(JSON.stringify(result));"
    ].join('\n');
    const ambientChild = spawnSync(process.execPath, ['--no-env-file', '--eval', source], {
      cwd: process.cwd(),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
      env: {
        ...hostileEnvironment,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'sec.injected',
        GIT_CONFIG_VALUE_0: 'forged',
        GIT_CONFIG_NOSYSTEM: '0'
      }
    });
    expect(ambientChild.status).toBe(0);
    expect(ambientChild.stderr).toBe('');
    expect(JSON.parse(ambientChild.stdout)).toEqual({
      status: 1,
      stdoutByteLength: 0,
      indexStatus: 0,
      indexPaths: '.gitattributes\0committed.ts\0'
    });
    expect(await fs.readFile(alternateIndex)).toEqual(alternateIndexBytes);
    expect(await fs.readFile(path.join(root, '.git', 'index'))).toEqual(canonicalIndexBytes);

    await withAuthorityGitReadSession({
      cwd: root,
      operation: gitReadOperation(),
      budget: GIT_READ_OPERATION_BUDGET
    }, async (session) => {
      const result = await runGitRead(session, ['config', '--get', 'sec.injected']);
      expect(result.status).toBe(1);
      expect(result.stdout.byteLength).toBe(0);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('committed attribute policy is isolated from .git/info/attributes overrides', async () => {
  const root = await createRepository('sec-dev-attribute-isolation-');
  try {
    await fs.mkdir(path.join(root, '.git', 'info'), { recursive: true });
    await fs.writeFile(path.join(root, '.git', 'info', 'attributes'), '*.ts -text\n');
    await withAuthorityGitReadSession({
      cwd: root,
      operation: gitReadOperation(),
      budget: GIT_READ_OPERATION_BUDGET
    }, async (session) => {
      const commit = await resolveExactHeadCommit(session);
      const attributes = await readTextAttributesBatch(session, commit, ['committed.ts']);
      expect(attributes.get('committed.ts')).toEqual({ textAttr: 'set', eolAttr: 'lf' });
    });

    const census = await runCensus(root);
    expect(census.classificationCounts['canonical-lf']).toBe(1);
    expect(census.failClosed).toBe(false);

    const settlement = await runSettlement(root);
    expect(settlement.status).toBe('settled');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legal custom Git attribute values remain fail-closed policy input instead of parser crashes', async () => {
  const root = await createRepository('sec-dev-attribute-custom-');
  try {
    await fs.writeFile(path.join(root, '.gitattributes'), '*.ts text=auto\n');
    git(root, ['add', '.gitattributes']);
    git(root, ['commit', '--quiet', '-m', 'custom-attribute']);

    const report = await runCensus(root);
    expect(report.classificationCounts.unknown).toBe(1);
    expect(report.flaggedEntries.find((entry) => entry.path === 'committed.ts')?.anomalies)
      .toContain('attributes-unsupported');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('text census treats NUL in declared text as a terminal fail-closed finding', async () => {
  const root = await createRepository('sec-dev-text-nul-');
  try {
    await fs.writeFile(path.join(root, 'committed.ts'), new Uint8Array([
      0x65, 0x78, 0x70, 0x6f, 0x72, 0x74, 0x00, 0x0a
    ]));
    git(root, ['add', 'committed.ts']);
    git(root, ['commit', '--quiet', '-m', 'nul-text']);

    const report = await runCensus(root);
    const entry = report.flaggedEntries.find(({ path: entryPath }) => entryPath === 'committed.ts');
    expect(report.failClosed).toBe(true);
    expect(report.classificationCounts.unknown).toBe(1);
    expect(entry).toMatchObject({
      classification: 'unknown',
      anomalies: ['nul-byte']
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('text census ignores staged-only index paths and scans the captured committed blob epoch', async () => {
  const root = await createRepository('sec-dev-census-epoch-');
  try {
    const committedAttributesOid = git(root, ['rev-parse', 'HEAD:.gitattributes']);
    await fs.writeFile(path.join(root, 'staged-only.ts'), 'export const stagedOnly = true;\n');
    git(root, ['add', 'staged-only.ts']);

    const report = await runCensus(root);
    expect(report.totalFiles).toBe(2);
    expect(report.gitattributesBlobSha).toBe(committedAttributesOid);
    expect(report.classificationCounts['canonical-lf']).toBe(1);
    expect(report.flaggedEntries.some((entry) => entry.path === 'staged-only.ts')).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('worktree settlement distinguishes settled, dirty, and untracked without fail-open reads', async () => {
  const root = await createRepository('sec-dev-settlement-');
  try {
    const settled = await runSettlement(root);
    expect(settled.status).toBe('settled');
    expect(settled.dirtyCount).toBe(0);
    expect(settled.untrackedCount).toBe(0);

    await fs.writeFile(path.join(root, 'committed.ts'), 'export const committed = false;\n');
    const dirty = await runSettlement(root);
    expect(dirty.status).toBe('dirty');
    expect(dirty.dirtyCount).toBe(1);

    git(root, ['checkout', '--', 'committed.ts']);
    await fs.writeFile(path.join(root, 'untracked.ts'), 'export const untracked = true;\n');
    const untracked = await runSettlement(root);
    expect(untracked.status).toBe('untracked');
    expect(untracked.untrackedCount).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('repository mutation fence preserves dirty candidates and detects tracked, index, and untracked changes', async () => {
  const root = await createRepository('sec-dev-mutation-fence-');
  try {
    const changed = await withRepositoryFinalStateObservation(
      root,
      compileAffectedTestSelectionSemanticOperation({ purpose: 'check-affected' }),
      async () => {
        await fs.writeFile(path.join(root, 'committed.ts'), 'export const committed = false;\n');
        git(root, ['add', 'committed.ts']);
        await fs.writeFile(path.join(root, 'committed.ts'), 'export const unstaged = true;\n');
        await fs.writeFile(path.join(root, 'untracked.ts'), 'export const untracked = true;\n');
        return 'composite-change';
      }
    );
    expect(changed.verification.status).toBe('changed');
    if (changed.verification.status === 'changed') {
      expect(changed.verification.changedPaths).toEqual(['committed.ts', 'untracked.ts']);
    }

    git(root, ['reset', '--hard', '--quiet', 'HEAD']);
    await fs.rm(path.join(root, 'untracked.ts'));
    const current = await withRepositoryFinalStateObservation(
      root,
      compileAffectedTestSelectionSemanticOperation({ purpose: 'check-affected' }),
      async () => 'current'
    );
    expect(current.verification.status).toBe('current');
    expect(current.value).toBe('current');
    expect(Object.isFrozen(current.receipt)).toBe(true);
    expect(current.receipt.providerIdentityDigest).toStartWith('sha256:');
    expect(current.receipt.repositoryRootIdentityDigest).toStartWith('sha256:');
    expect(current.receipt.commonDirectoryIdentityDigest).toStartWith('sha256:');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('repository mutation operation fence turns a child write into one diagnostic failure', async () => {
  const root = await createRepository('sec-dev-mutation-operation-');
  const diagnostics: string[] = [];
  let operationCallCount = 0;
  try {
    const result = await runRepositoryZeroWriteOperation(
      'test:fixture',
      async () => {
        operationCallCount += 1;
        await fs.writeFile(path.join(root, 'committed.ts'), 'export const escaped = true;\n');
        return 0;
      },
      {
        operation: compileAffectedTestSelectionSemanticOperation({ purpose: 'check-affected' }),
        repositoryRoot: root,
        report: (message) => diagnostics.push(message)
      }
    );
    expect(result).toBe(1);
    expect(operationCallCount).toBe(1);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain('mutated or lost continuous observation');
    const encoded = diagnostics[0]!.match(/diagnostic=(\{.*\})\.$/u)?.[1];
    expect(encoded).toBeDefined();
    const diagnostic = JSON.parse(encoded!) as {
      eventCount: number;
      firstEvent: { action: string; path: string; root: string; rootIndex: number };
      observationDigest: string;
    };
    expect(diagnostic.eventCount).toBeGreaterThan(0);
    expect(diagnostic.firstEvent.root).toBe(root);
    expect(diagnostic.firstEvent.rootIndex).toBe(0);
    expect(diagnostic.firstEvent.path).toBe('committed.ts');
    expect(['added', 'modified']).toContain(diagnostic.firstEvent.action);
    expect(diagnostic.observationDigest).toStartWith('sha256:');
    expect(await fs.readFile(path.join(root, 'committed.ts'), 'utf8')).toBe('export const escaped = true;\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('repository observer diagnostics preserve non-event failure boundaries without invented paths', () => {
  for (const status of ['overflow', 'discontinuous'] as const) {
    const diagnostic = projectRepositoryObserverFailureDiagnostic({
      status,
      rootIdentityDigest: `sha256:${'0'.repeat(64)}`
    }, ['D:\\fixture']);
    expect(diagnostic.status).toBe(status);
    expect(diagnostic).not.toHaveProperty('firstEvent');
    expect(diagnostic).not.toHaveProperty('eventCount');
    expect(diagnostic).not.toHaveProperty('observationDigest');
  }
});

test('repository mutation fence rejects a reconstructed fast batch admission before observer Effect', async () => {
  await expect(runRepositoryZeroWriteOperation(
    'test:forged-fast-batch',
    async () => 0,
    {
      operation: compileAffectedTestSelectionSemanticOperation({ purpose: 'check-affected' }),
      fastTestBatchAdmission: Object.freeze({}) as FastTestBatchExecutionAdmission
    }
  )).rejects.toThrow('owner-issued admission');
});

test('repository mutation fence shares one process ledger with a nested Git admission', async () => {
  if (process.platform !== 'win32') return;
  const root = await createRepository('sec-dev-mutation-shared-ledger-');
  try {
    const operation = compileAffectedTestSelectionSemanticOperation({ purpose: 'check-affected' });
    let nestedSessionReady = false;
    const result = await runRepositoryZeroWriteOperation(
      'test:shared-ledger',
      async (processSession) => {
        const resolution = createAuthorityGitReadSession({
          cwd: root,
          operation,
          processSession,
          budget: GIT_READ_OPERATION_BUDGET
        });
        expect(resolution.status).toBe('ready');
        if (resolution.status !== 'ready') return 1;
        nestedSessionReady = true;
        const head = await resolution.session.run(['rev-parse', '--verify', 'HEAD^{commit}']);
        expect(head.kind).toBe('completed');
        await resolution.session.close?.();
        return 0;
      },
      { operation, repositoryRoot: root }
    );
    expect(result).toBe(0);
    expect(nestedSessionReady).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('tracked governed symlink cannot be followed and reported as settled', async () => {
  if (process.platform === 'win32') return;

  const root = await mkdtemp(path.join(tmpdir(), 'sec-dev-settlement-link-'));
  try {
    git(root, ['init', '--quiet']);
    git(root, ['config', 'user.email', 'tests@example.com']);
    git(root, ['config', 'user.name', 'SEC Tests']);
    git(root, ['config', 'core.autocrlf', 'false']);
    await fs.writeFile(path.join(root, '.gitattributes'), '*.ts text eol=lf\n');
    await fs.writeFile(path.join(root, 'target.ts'), 'export const external = true;\n');
    await fs.symlink('target.ts', path.join(root, 'linked.ts'));
    git(root, ['add', '--all']);
    git(root, ['commit', '--quiet', '-m', 'tracked-link']);

    const receipt = await runSettlement(root);
    expect(receipt.status).toBe('unsafe');
    expect(receipt.summary).toContain('Settlement exact Git/physical observation failed closed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
