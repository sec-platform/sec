import { expect, test } from 'bun:test';

import {
  adaptWorkspace,
  composeWorkspace,
  initWorkspace,
  resolveWorkspace
} from '../../platform/orchestrator.ts';
import { readJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import type { LockFile } from '../../platform/shared/types.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('workspace pipeline records pass execution metadata and downstream invalidation', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await initWorkspace(workspaceRoot, { reset: true });
    const resolved = await resolveWorkspace(workspaceRoot);

    expect(resolved.lock.passExecutions?.parse?.status).toBe('succeeded');
    expect(resolved.lock.passExecutions?.align?.status).toBe('succeeded');
    expect(resolved.lock.passExecutions?.resolve?.status).toBe('succeeded');

    const composed = await composeWorkspace(workspaceRoot);
    expect(composed.lock.passStatus.compose).toBe('succeeded');
    expect(composed.lock.passExecutions?.compose?.status).toBe('succeeded');
    expect(composed.lock.passExecutions?.compose?.transactionId?.startsWith('pass:compose:')).toBe(true);
    expect(composed.lock.passStatus.adapt).toBe('pending');
    expect(composed.lock.passStatus.verify).toBe('pending');

    const adapted = await adaptWorkspace(workspaceRoot);
    expect(adapted.lock.passStatus.adapt).toBe('succeeded');
    expect(adapted.lock.passExecutions?.adapt?.status).toBe('succeeded');
    expect(adapted.lock.passExecutions?.adapt?.transactionId?.startsWith('pass:adapt:')).toBe(true);
    expect(adapted.lock.passStatus.verify).toBe('pending');
    expect(adapted.lock.passStatus.lock).toBe('pending');

    const { lockPath } = getWorkspacePaths(workspaceRoot);
    const persisted = await readJson<LockFile>(lockPath);
    expect(persisted.passExecutions?.compose?.status).toBe('succeeded');
    expect(persisted.passExecutions?.adapt?.status).toBe('succeeded');
  }, 'engineering-compiler-pipeline-kernel-');
}, 120000);
