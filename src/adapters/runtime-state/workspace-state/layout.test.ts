import { expect, test } from 'bun:test';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { settleResourcesAsync, withAcquiredResource } from '../../../execution/resource-settlement.ts';
import { createLocalContinuationCheckpoint } from '../../self-hosting/control/continuation/checkpoint.ts';
import {
  clearActiveContinuation,
  gcContinuationObjects,
  loadActiveContinuationCheckpoint,
  persistActiveContinuationCheckpoint,
  resolveSecRuntimeStateFromWorkspaceLocator
} from '../../self-hosting/control/continuation/runtime-store.ts';
import { resolveSecRuntimeStateForRepository } from './paths.ts';

async function withTemporaryRoot(prefix: string, run: (root: string) => Promise<void>): Promise<void> {
  await withAcquiredResource({
    operationLabel: 'runtime-state-fixture', resourceLabel: 'runtime-state-fixture-root',
    acquire: () => mkdtempSync(path.join(tmpdir(), prefix)),
    use: run,
    release: root => rmSync(root, { recursive: true, force: true })
  });
}

function fixture(root: string) {
  const repositoryRoot = path.join(root, 'repo');
  const stateRoot = path.join(root, 'state');
  const cacheRoot = path.join(root, 'cache');
  mkdirSync(repositoryRoot, { recursive: true });
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    SEC_STATE_HOME: stateRoot,
    SEC_CACHE_HOME: cacheRoot
  };
  const checkpoint = createLocalContinuationCheckpoint({
    repository: 'sec-platform/sec',
    prNumber: 496,
    branch: 'integration/sec-static-convergence-20260818',
    baseSha: '1'.repeat(40),
    baseTreeSha: '2'.repeat(40),
    headSha: '3'.repeat(40),
    headTreeSha: '4'.repeat(40),
    manifestPath: 'config/repository/work-packages/sec-static-convergence-v1.md'
  });
  const layout = resolveSecRuntimeStateForRepository({
    repository: checkpoint.repository,
    repositoryRoot,
    environment
  });
  return { root, repositoryRoot, stateRoot, cacheRoot, environment, checkpoint, layout };
}

test('one admitted handoff becomes a reusable CAS object plus workspace locator and active pointer', async () => {
  await withTemporaryRoot('sec-runtime-state-', async root => {
    const value = fixture(root);
    await persistActiveContinuationCheckpoint({
      layout: value.layout,
      repositoryRoot: value.repositoryRoot,
      checkpoint: value.checkpoint,
      environment: value.environment
    });
    expect(await loadActiveContinuationCheckpoint({
      layout: value.layout,
      repositoryRoot: value.repositoryRoot,
      environment: value.environment
    })).toEqual(value.checkpoint);
    const located = await resolveSecRuntimeStateFromWorkspaceLocator({
      repositoryRoot: value.repositoryRoot,
      environment: value.environment
    });
    expect(located?.repository).toBe('sec-platform/sec');
    expect(located?.layout.repositoryKey).toBe(value.layout.repositoryKey);
    expect(located?.layout.workspaceKey).toBe(value.layout.workspaceKey);
    expect(value.layout.continuationPointerPath.startsWith(value.stateRoot + path.sep)).toBe(true);
    expect(value.layout.continuationObjectRoot.startsWith(value.stateRoot + path.sep)).toBe(true);
    expect(value.layout.continuationPointerPath.startsWith(value.repositoryRoot + path.sep)).toBe(false);
    expect(value.layout.continuationObjectRoot.startsWith(value.repositoryRoot + path.sep)).toBe(false);
    expect(value.layout.durableLocalExecutionJournalRoot.startsWith(value.stateRoot + path.sep)).toBe(true);
    expect(value.layout.durableLocalExecutionJournalRoot.startsWith(value.repositoryRoot + path.sep)).toBe(false);
  });
}, 30_000);

test('same checkpoint is idempotent while digest-path byte conflict fails closed', async () => {
  await withTemporaryRoot('sec-runtime-state-', async root => {
    const value = fixture(root);
    await persistActiveContinuationCheckpoint({
      layout: value.layout,
      repositoryRoot: value.repositoryRoot,
      checkpoint: value.checkpoint,
      environment: value.environment
    });
    await expect(persistActiveContinuationCheckpoint({
      layout: value.layout,
      repositoryRoot: value.repositoryRoot,
      checkpoint: value.checkpoint,
      environment: value.environment
    })).resolves.toBeDefined();
    const objectPath = path.join(
      value.layout.continuationObjectRoot,
      `${value.checkpoint.checkpointDigest.slice(7)}.json`
    );
    writeFileSync(objectPath, '{"tampered":true}\n', 'utf8');
    await expect(persistActiveContinuationCheckpoint({
      layout: value.layout,
      repositoryRoot: value.repositoryRoot,
      checkpoint: value.checkpoint,
      environment: value.environment
    })).rejects.toThrow('CAS object bytes conflict');
  });
}, 30_000);

test('corrupt workspace pointer fails safe and prevents collection of repository continuation objects', async () => {
  await withTemporaryRoot('sec-runtime-state-', async root => {
    const value = fixture(root);
    await persistActiveContinuationCheckpoint({
      layout: value.layout,
      repositoryRoot: value.repositoryRoot,
      checkpoint: value.checkpoint,
      environment: value.environment
    });
    const pointer = JSON.parse(readFileSync(value.layout.continuationPointerPath, 'utf8')) as Record<string, unknown>;
    const corruptPointer = `${JSON.stringify({
      ...pointer,
      pointerDigest: `sha256:${'0'.repeat(64)}`
    })}\n`;
    writeFileSync(value.layout.continuationPointerPath, corruptPointer, 'utf8');
    await expect(loadActiveContinuationCheckpoint({ layout: value.layout,
      repositoryRoot: value.repositoryRoot, environment: value.environment })).rejects.toThrow();
    expect(await gcContinuationObjects({ layout: value.layout, repositoryRoot: value.repositoryRoot,
      environment: value.environment, retentionMs: 0 }))
      .toEqual({ scanned: 1, removed: 0, retained: 1 });
    expect(readFileSync(value.layout.continuationPointerPath, 'utf8')).toBe(corruptPointer);
  });
}, 30_000);

test('physical Runtime State rejects a symlink or junction into the repository before writing', async () => {
  await withTemporaryRoot('sec-runtime-alias-', async root => {
    const repositoryRoot = path.join(root, 'repo');
    const stateRoot = path.join(root, 'state-alias');
    const cacheRoot = path.join(root, 'cache');
    mkdirSync(repositoryRoot, { recursive: true });
    symlinkSync(repositoryRoot, stateRoot, process.platform === 'win32' ? 'junction' : 'dir');
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      SEC_STATE_HOME: stateRoot,
      SEC_CACHE_HOME: cacheRoot
    };
    const checkpoint = createLocalContinuationCheckpoint({
      repository: 'sec-platform/sec',
      prNumber: 496,
      branch: 'integration/sec-static-convergence-20260818',
      baseSha: '1'.repeat(40),
      baseTreeSha: '2'.repeat(40),
      headSha: '3'.repeat(40),
      headTreeSha: '4'.repeat(40),
      manifestPath: 'config/repository/work-packages/sec-static-convergence-v1.md'
    });
    const layout = resolveSecRuntimeStateForRepository({
      repository: checkpoint.repository,
      repositoryRoot,
      environment
    });
    await expect(persistActiveContinuationCheckpoint({
      layout,
      repositoryRoot,
      checkpoint,
      environment
    })).rejects.toMatchObject({ code: 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH' });
    expect(readdirSync(repositoryRoot)).toEqual([]);
  });
}, 30_000);

test('Runtime State mutation and GC preserve the active object until terminal pointer retirement', async () => {
  await withTemporaryRoot('sec-runtime-state-', async root => {
    const value = fixture(root);
    const outcomes = await Promise.allSettled([
      persistActiveContinuationCheckpoint({
        layout: value.layout,
        repositoryRoot: value.repositoryRoot,
        checkpoint: value.checkpoint,
        environment: value.environment
      }),
      gcContinuationObjects({
        layout: value.layout,
        repositoryRoot: value.repositoryRoot,
        environment: value.environment,
        retentionMs: 0
      })
    ]);
    const failures = outcomes.flatMap((outcome, index) => outcome.status === 'rejected'
      ? [{ label: `continuation-operation:${index}`, error: outcome.reason }] : []);
    await settleResourcesAsync({ primary: failures[0], cleanup: failures.slice(1)
      .map(({ label, error }) => ({ label, settle: () => { throw error; } })) });
    const collection = outcomes[1];
    if (collection.status !== 'fulfilled') throw collection.reason;
    expect(collection.value.removed).toBe(0);
    expect(await loadActiveContinuationCheckpoint({
      layout: value.layout,
      repositoryRoot: value.repositoryRoot,
      environment: value.environment
    })).toEqual(value.checkpoint);
    if (process.platform === 'linux') {
      expect(lstatSync(value.stateRoot).mode & 0o077).toBe(0);
      const objectPath = path.join(
        value.layout.continuationObjectRoot,
        `${value.checkpoint.checkpointDigest.slice(7)}.json`
      );
      expect(lstatSync(objectPath).mode & 0o077).toBe(0);
    }
    expect(await gcContinuationObjects({ layout: value.layout, repositoryRoot: value.repositoryRoot,
      environment: value.environment, retentionMs: 0 }))
      .toEqual({ scanned: 1, removed: 0, retained: 1 });
    await clearActiveContinuation({
      layout: value.layout,
      repositoryRoot: value.repositoryRoot,
      environment: value.environment
    });
    expect(await resolveSecRuntimeStateFromWorkspaceLocator({
      repositoryRoot: value.repositoryRoot,
      environment: value.environment
    })).toBeNull();
    expect(await gcContinuationObjects({ layout: value.layout, repositoryRoot: value.repositoryRoot,
      environment: value.environment, retentionMs: 0 }))
      .toEqual({ scanned: 1, removed: 1, retained: 0 });
  });
}, 30_000);
