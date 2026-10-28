import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs, { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { affectedGitSelectionDigest, issueAffectedGitSelectionSource, rebindAffectedGitSelectionSource } from '../../../src/adapters/verification/platform/test-impact/runtime/affected-git-source.ts';
import { withRetainedBunTestCommands } from '../../testkit/process-resource.ts';
import { settleResourcesAsync } from '../../../src/execution/resource-settlement.ts';
import { TEXT_BYTE_ANOMALIES, TEXT_BYTE_CLASSIFICATIONS } from '../../../src/adapters/runtime-state/text-byte-census.ts';
import { projectTextByteCensusReport } from '../../../src/application/text-byte-census.ts';
import { formatTextByteCensus } from '../../../src/entry/cli/text-byte-census.ts';

import { withAuthorityGitReadSession } from '../../../src/adapters/providers/git-read/authority.ts';
import { createAuthorityGitReadSession } from '../../../src/adapters/providers/git-read/runtime/session.ts';
import {
  compileAffectedTestSelectionSemanticOperation
} from '../../../src/adapters/self-hosting/development/runner/affected-plan-contract.ts';
import {
  projectRepositoryObserverFailureDiagnostic,
  runRepositoryZeroWriteOperation
} from '../../../src/adapters/self-hosting/development/runner/repository-mutation-fence.ts';
import {
  withRepositoryFinalStateObservation
} from '../../../src/adapters/self-hosting/development/runner/repository-observation.ts';
import {
  assertGitObjectId,
  GIT_READ_OPERATION_BUDGET,
  readBlobBatch,
  readCommitBlobInventory,
  resolveExactHeadCommit,
  withIsolatedTextAttributeReader
} from '../../../src/adapters/self-hosting/development/tooling/git/git-read.ts';
import { runCensus } from '../../../src/adapters/self-hosting/development/tooling/text/text-byte-census.ts';
import { runSettlement } from '../../../src/adapters/self-hosting/development/tooling/workspace/worktree-settlement.ts';

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
  try {
    git(root, ['init', '--quiet']);
    git(root, ['config', 'user.email', 'tests@example.com']);
    git(root, ['config', 'user.name', 'SEC Tests']);
    git(root, ['config', 'core.autocrlf', 'false']);
    await fs.writeFile(path.join(root, '.gitattributes'), '*.ts text eol=lf\n');
    await fs.writeFile(path.join(root, 'committed.ts'), 'export const committed = true;\n');
    git(root, ['add', '--all']);
    git(root, ['commit', '--quiet', '-m', 'initial']);
    return root;
  } catch (error) {
    await settleResourcesAsync({ primary: { label: 'repository-fixture-construction', error },
      cleanup: [{ label: 'repository-fixture-root', settle: () => rm(root, { recursive: true, force: true }) }] });
    throw error;
  }
}

async function withRepository<T>(prefix: string, operation: (root: string) => Promise<T>): Promise<T> {
  const root = await createRepository(prefix);
  return settleWorkspaceCallback(() => operation(root), async () => {
    await rm(root, { recursive: true, force: true });
  });
}

test('Git read mechanics accept full SHA-1 and SHA-256 object IDs', () => {
  expect(assertGitObjectId('a'.repeat(40), 'sha1')).toBe('a'.repeat(40));
  expect(assertGitObjectId('b'.repeat(64), 'sha256')).toBe('b'.repeat(64));
  expect(() => assertGitObjectId('c'.repeat(39), 'short')).toThrow();
  expect(() => assertGitObjectId('d'.repeat(63), 'short-sha256')).toThrow();
  expect(() => assertGitObjectId('e'.repeat(65), 'long')).toThrow();
});

test('Git replacement objects cannot substitute committed blob bytes', async () => {
  await withRepository('sec-dev-git-replace-', async (root) => {
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
  });
});

test('trusted Git reads isolate ambient config and alternate index injection', async () => {
  const root = await createRepository('sec-dev-git-config-isolation-');
  await withRetainedBunTestCommands(root, async run => {
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
    const ambientChild = await run(['--no-env-file', '--eval', source], {
      cwd: process.cwd(),
      timeoutMs: 30_000,
      env: {
        ...hostileEnvironment,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'sec.injected',
        GIT_CONFIG_VALUE_0: 'forged',
        GIT_CONFIG_NOSYSTEM: '0'
      }
    });
    expect(ambientChild.code).toBe(0);
    expect(ambientChild.stderr).toBe('');
    expect(JSON.parse(ambientChild.stdout)).toEqual({
      status: 1,
      stdoutByteLength: 0,
      indexStatus: 0,
      indexPaths: '.gitattributes\0committed.ts\0'
    });
    expect(await fs.readFile(alternateIndex)).toEqual(alternateIndexBytes);
    expect(await fs.readFile(path.join(root, '.git', 'index'))).toEqual(canonicalIndexBytes);
  }, () => rm(root, { recursive: true, force: true }));
});

test('exact committed blobs and attribute policy are isolated from .git/info/attributes overrides', async () => {
  await withRepository('sec-dev-attribute-isolation-', async (root) => {
    await fs.mkdir(path.join(root, '.git', 'info'), { recursive: true });
    await fs.writeFile(path.join(root, '.git', 'info', 'attributes'), '*.ts -text\n');
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

      const attributes = await withIsolatedTextAttributeReader(session, commit, (readAttributes) =>
        readAttributes(inventory.map((entry) => entry.path))
      );
      expect(attributes.get('committed.ts')).toEqual({ textAttr: 'set', eolAttr: 'lf' });
    });

    const census = await runCensus(root);
    expect(census.classificationCounts['canonical-lf']).toBe(1);
    expect(census.failClosed).toBe(false);
    expect(formatTextByteCensus(projectTextByteCensusReport(census, {
      classifications: TEXT_BYTE_CLASSIFICATIONS, anomalies: TEXT_BYTE_ANOMALIES
    }))).toMatch(/\banomalies[\s:]+\(none\)/u);

    const settlement = await runSettlement(root);
    expect(settlement.status).toBe('settled');
  });
});

test('legal custom Git attribute values remain fail-closed policy input instead of parser crashes', async () => {
  await withRepository('sec-dev-attribute-custom-', async (root) => {
    await fs.writeFile(path.join(root, '.gitattributes'), '*.ts text=auto\n');
    git(root, ['add', '.gitattributes']);
    git(root, ['commit', '--quiet', '-m', 'custom-attribute']);

    const report = await runCensus(root);
    expect(report.classificationCounts.unknown).toBe(1);
    expect(report.flaggedEntries.find((entry) => entry.path === 'committed.ts')?.anomalies)
      .toContain('attributes-unsupported');
  });
});

test('text census treats NUL in declared text as a terminal fail-closed finding', async () => {
  await withRepository('sec-dev-text-nul-', async (root) => {
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
    const text = formatTextByteCensus(projectTextByteCensusReport(report, {
      classifications: TEXT_BYTE_CLASSIFICATIONS, anomalies: TEXT_BYTE_ANOMALIES
    }));
    expect(text).toMatch(/\btotalFiles[\s:]+2(?=$|[\s;,])/u);
    expect(text).toMatch(/\bfailClosed[\s:]+true(?=$|[\s;,])/u);
    expect(Array.from(text.matchAll(/^\s*([a-z][a-z-]*)[\s:]+(\d+)\s*$/gmu),
      ([, id, count]) => `${id}=${count}`).sort()).toEqual([
      'nul-byte=1', 'preserve-external=1', 'unknown=1'
    ]);
    expect(text).toMatch(/\bflagged[\s:]+1\s+file/u);
    const flagged = text.split('\n').find((line) => /(?:^|\s)committed\.ts(?=$|[\s\[])/u.test(line));
    expect(flagged).toBeDefined();
    expect(flagged).toMatch(/(?:^|[\s\[])unknown(?=$|[\s\];,])/u);
    expect(flagged).toMatch(/(?:^|\s)nul-byte(?=$|[\s;,])/u);
  });
});

test('text census ignores staged-only index paths and scans the captured committed blob epoch', async () => {
  await withRepository('sec-dev-census-epoch-', async (root) => {
    const committedAttributesOid = git(root, ['rev-parse', 'HEAD:.gitattributes']);
    await fs.writeFile(path.join(root, 'staged-only.ts'), 'export const stagedOnly = true;\n');
    git(root, ['add', 'staged-only.ts']);

    const report = await runCensus(root);
    expect(report.totalFiles).toBe(2);
    expect(report.gitattributesBlobSha).toBe(committedAttributesOid);
    expect(report.classificationCounts['canonical-lf']).toBe(1);
    expect(report.flaggedEntries.some((entry) => entry.path === 'staged-only.ts')).toBe(false);
  });
});

test('worktree settlement distinguishes settled, dirty, and untracked without fail-open reads', async () => {
  await withRepository('sec-dev-settlement-', async (root) => {
    git(root, ['config', 'core.autocrlf', 'input']);
    git(root, ['config', 'core.eol', 'lf']);
    const settled = await runSettlement(root);
    expect(settled.repositoryRoot).toBe(path.resolve(root));
    expect(settled.coreAutocrlf).toBe('input');
    expect(settled.coreEol).toBe('lf');
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
  });
});

test('repository mutation fence preserves dirty candidates and detects tracked, index, and untracked changes', async () => {
  await withRepository('sec-dev-mutation-fence-', async (root) => {
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
  });
});

test.skipIf(process.platform === 'win32')(
  'repository mutation fence rejects an unavailable physical observer before the workload',
  async () => {
    await withRepository('sec-dev-observer-unavailable-', async (root) => {
      const diagnostics: string[] = [];
      let called = false;
      const result = await runRepositoryZeroWriteOperation('test:unsupported', async () => {
        called = true;
        return 0;
      }, {
        operation: gitReadOperation(),
        repositoryRoot: root,
        report: (message) => diagnostics.push(message)
      });
      expect(result).toBe(1);
      expect(called).toBe(false);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toContain('strict-zero-write-unproven');
      // Raw Linux arming has no issued process Effect admission; other enabled hosts lack an observer.
      const reason = process.platform === 'linux' ? 'arm-failed' : 'unsupported-platform';
      expect(diagnostics[0]).toContain(`(${reason})`);
      expect(await fs.readFile(path.join(root, 'committed.ts'), 'utf8'))
        .toBe('export const committed = true;\n');
    });
  }
);

test.skipIf(process.platform !== 'win32')('repository mutation operation fence turns a child write into one diagnostic failure', async () => {
  await withRepository('sec-dev-mutation-operation-', async (root) => {
    const diagnostics: string[] = [];
    let operationCallCount = 0;
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
  });
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

test.skipIf(process.platform !== 'win32')('repository mutation fence shares one process ledger with a nested Git admission', async () => {
  await withRepository('sec-dev-mutation-shared-ledger-', async (root) => {
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
        try {
          nestedSessionReady = true;
          const head = await resolution.session.run(['rev-parse', '--verify', 'HEAD^{commit}']);
          expect(head.kind).toBe('completed');
          return 0;
        } finally {
          await resolution.session.close?.();
        }
      },
      { operation, repositoryRoot: root }
    );
    expect(result).toBe(0);
    expect(nestedSessionReady).toBe(true);
  });
});

test.skipIf(process.platform === 'win32')('tracked governed symlink cannot be followed and reported as settled', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-dev-settlement-link-'));
  await settleWorkspaceCallback(async () => {
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
  }, async () => {
    await rm(root, { recursive: true, force: true });
  });
});


test('affected Git preparation survives settled transport and rejects drifted rebinds', async () => {
  await withRepository('sec-affected-selection-rebind-', async (root) => {
    await fs.writeFile(path.join(root, 'selected.ts'), 'export const selected = 1;\n');
    const selection = await withAuthorityGitReadSession({ cwd: root, operation: gitReadOperation(),
      budget: GIT_READ_OPERATION_BUDGET }, session => issueAffectedGitSelectionSource({ session, baseRef: null }));
    expect(selection).not.toBeNull();
    expect(selection!.files).toEqual(['selected.ts']);
    const digest = affectedGitSelectionDigest(selection!);
    await withAuthorityGitReadSession({ cwd: root, operation: gitReadOperation(),
      budget: GIT_READ_OPERATION_BUDGET }, async session => {
      const rebound = await rebindAffectedGitSelectionSource({ source: selection!, session, baseRef: null });
      expect(rebound).not.toBeNull();
      expect(rebound!.files).toEqual(['selected.ts']);
      expect(affectedGitSelectionDigest(rebound!)).toBe(digest);
    });
    await fs.writeFile(path.join(root, 'later.ts'), 'export const later = 2;\n');
    await withAuthorityGitReadSession({ cwd: root, operation: gitReadOperation(),
      budget: GIT_READ_OPERATION_BUDGET }, async session => {
      expect(await rebindAffectedGitSelectionSource({ source: selection!, session, baseRef: null })).toBeNull();
    });
    expect(selection!.files).toEqual(['selected.ts']);
  });
});
