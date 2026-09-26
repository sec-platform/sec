import { expect, test } from 'bun:test';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createLocalContinuationCheckpoint } from '../../self-hosting/control/continuation/checkpoint.ts';
import {
  clearActiveContinuation,
  gcContinuationObjects,
  loadActiveContinuationCheckpoint,
  persistActiveContinuationCheckpoint,
  resolveRuntimeStateFromWorkspaceLocator
} from '../../self-hosting/control/continuation/runtime-store.ts';
import { resolveRuntimeStateForRepository } from './paths.ts';

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-state-'));
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
  const layout = resolveRuntimeStateForRepository({
    repository: checkpoint.repository,
    repositoryRoot,
    environment
  });
  return { root, repositoryRoot, stateRoot, cacheRoot, environment, checkpoint, layout };
}

test('one admitted handoff becomes a reusable CAS object plus workspace locator and active pointer', async () => {
  const value = fixture();
  try {
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
    const located = await resolveRuntimeStateFromWorkspaceLocator({
      repositoryRoot: value.repositoryRoot,
      environment: value.environment
    });
    expect(located?.repository).toBe('sec-platform/sec');
    expect(located?.layout.repositoryKey).toBe(value.layout.repositoryKey);
    expect(located?.layout.workspaceKey).toBe(value.layout.workspaceKey);
    expect(value.layout.continuationPointerPath.startsWith(value.stateRoot)).toBe(true);
    expect(value.layout.continuationObjectRoot.startsWith(value.stateRoot)).toBe(true);
    expect(value.layout.continuationPointerPath.startsWith(value.repositoryRoot)).toBe(false);
    expect(value.layout.continuationObjectRoot.startsWith(value.repositoryRoot)).toBe(false);
    expect(value.layout.durableLocalExecutionJournalRoot.startsWith(value.stateRoot)).toBe(true);
    expect(value.layout.durableLocalExecutionJournalRoot.startsWith(value.repositoryRoot)).toBe(false);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}, 30_000);

test('continuation state migrates legacy object and pointer paths without changing bytes or directory identity', async () => {
  const value = fixture();
  try {
    await persistActiveContinuationCheckpoint({
      layout: value.layout,
      repositoryRoot: value.repositoryRoot,
      checkpoint: value.checkpoint,
      environment: value.environment
    });
    const currentObjectRoot = value.layout.continuationObjectRoot;
    const legacyObjectRoot = path.join(path.dirname(currentObjectRoot), 'continuation-v1');
    const currentPointerPath = value.layout.continuationPointerPath;
    const legacyPointerPath = path.join(path.dirname(currentPointerPath), 'active-continuation-v1.json');
    const objectBefore = lstatSync(currentObjectRoot, { bigint: true });
    const pointerBytes = readFileSync(currentPointerPath);
    renameSync(currentObjectRoot, legacyObjectRoot);
    renameSync(currentPointerPath, legacyPointerPath);

    expect(await loadActiveContinuationCheckpoint({
      layout: value.layout,
      repositoryRoot: value.repositoryRoot,
      environment: value.environment
    })).toEqual(value.checkpoint);

    expect(() => lstatSync(legacyObjectRoot)).toThrow();
    expect(() => lstatSync(legacyPointerPath)).toThrow();
    const objectAfter = lstatSync(currentObjectRoot, { bigint: true });
    expect([objectAfter.dev, objectAfter.ino]).toEqual([objectBefore.dev, objectBefore.ino]);
    expect(readFileSync(currentPointerPath)).toEqual(pointerBytes);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}, 30_000);

test('continuation pointer cutover rejects divergent current and legacy bytes', async () => {
  const value = fixture();
  try {
    await persistActiveContinuationCheckpoint({
      layout: value.layout,
      repositoryRoot: value.repositoryRoot,
      checkpoint: value.checkpoint,
      environment: value.environment
    });
    const legacyPointerPath = path.join(
      path.dirname(value.layout.continuationPointerPath),
      'active-continuation-v1.json'
    );
    writeFileSync(legacyPointerPath, '{"divergent":true}\n', 'utf8');
    await expect(loadActiveContinuationCheckpoint({
      layout: value.layout,
      repositoryRoot: value.repositoryRoot,
      environment: value.environment
    })).rejects.toThrow('current and legacy pointer bytes diverge');
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}, 30_000);

test('active continuation object is retained, terminal pointer retirement makes it immediately GC eligible', async () => {
  const value = fixture();
  try {
    await persistActiveContinuationCheckpoint({
      layout: value.layout,
      repositoryRoot: value.repositoryRoot,
      checkpoint: value.checkpoint,
      environment: value.environment
    });
    expect(await gcContinuationObjects({ layout: value.layout, repositoryRoot: value.repositoryRoot,
      environment: value.environment, retentionMs: 0 }))
      .toEqual({ scanned: 1, removed: 0, retained: 1 });
    await clearActiveContinuation({
      layout: value.layout,
      repositoryRoot: value.repositoryRoot,
      environment: value.environment
    });
    expect(await resolveRuntimeStateFromWorkspaceLocator({
      repositoryRoot: value.repositoryRoot,
      environment: value.environment
    })).toBeNull();
    expect(await gcContinuationObjects({ layout: value.layout, repositoryRoot: value.repositoryRoot,
      environment: value.environment, retentionMs: 0 }))
      .toEqual({ scanned: 1, removed: 1, retained: 0 });
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}, 30_000);

test('same checkpoint is idempotent while digest-path byte conflict fails closed', async () => {
  const value = fixture();
  try {
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
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}, 30_000);

test('corrupt workspace pointer fails safe and prevents collection of repository continuation objects', async () => {
  const value = fixture();
  try {
    await persistActiveContinuationCheckpoint({
      layout: value.layout,
      repositoryRoot: value.repositoryRoot,
      checkpoint: value.checkpoint,
      environment: value.environment
    });
    const pointer = JSON.parse(readFileSync(value.layout.continuationPointerPath, 'utf8')) as Record<string, unknown>;
    writeFileSync(value.layout.continuationPointerPath, `${JSON.stringify({
      ...pointer,
      pointerDigest: `sha256:${'0'.repeat(64)}`
    })}\n`, 'utf8');
    await expect(loadActiveContinuationCheckpoint({ layout: value.layout,
      repositoryRoot: value.repositoryRoot, environment: value.environment })).rejects.toThrow();
    expect(await gcContinuationObjects({ layout: value.layout, repositoryRoot: value.repositoryRoot,
      environment: value.environment, retentionMs: 0 }))
      .toEqual({ scanned: 1, removed: 0, retained: 1 });
    expect(readFileSync(value.layout.continuationPointerPath, 'utf8')).toContain('sha256:00000000');
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}, 30_000);

test('physical Runtime State rejects a symlink or junction into the repository before writing', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-alias-'));
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
  const layout = resolveRuntimeStateForRepository({
    repository: checkpoint.repository,
    repositoryRoot,
    environment
  });
  try {
    await expect(persistActiveContinuationCheckpoint({
      layout,
      repositoryRoot,
      checkpoint,
      environment
    })).rejects.toThrow(/no-follow|ordinary non-reparse|physical/iu);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

test('Runtime State mutation and GC serialize around one reachable CAS pointer', async () => {
  const value = fixture();
  try {
    const [, collection] = await Promise.all([
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
    expect(collection.removed).toBe(0);
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
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}, 30_000);
