import { expect, test } from 'bun:test';
import { access, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { migrateSemanticMutationStateLayout } from '../../../src/adapters/mutation/state-layout-migration.ts';
import { semanticMutationStateRoot } from '../../../src/workspace/contract/semantic-mutation/state-layout.ts';

const allowCommit = async (): Promise<void> => {};

async function absent(target: string): Promise<boolean> {
  try {
    await access(target);
    return false;
  } catch {
    return true;
  }
}

test('semantic mutation state layout migrates the complete legacy journal in one directory move', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'semantic-mutation-layout-'));
  try {
    const legacyRoot = semanticMutationStateRoot(workspaceRoot, 'legacy');
    const currentRoot = semanticMutationStateRoot(workspaceRoot);
    await mkdir(path.join(legacyRoot, 'transactions', 'a'.repeat(64), 'records'), { recursive: true });
    await mkdir(path.join(legacyRoot, 'terminal-order'), { recursive: true });
    await writeFile(path.join(legacyRoot, 'terminal-order', 'sentinel'), 'terminal\n', 'utf8');
    await writeFile(
      path.join(legacyRoot, 'transactions', 'a'.repeat(64), 'records', 'sentinel'),
      'transaction\n',
      'utf8'
    );
    const legacyIdentity = await lstat(legacyRoot, { bigint: true });

    await expect(migrateSemanticMutationStateLayout(workspaceRoot, allowCommit)).resolves.toBe('migrated');
    expect(await absent(legacyRoot)).toBe(true);
    const currentIdentity = await lstat(currentRoot, { bigint: true });
    expect(currentIdentity.dev).toBe(legacyIdentity.dev);
    expect(currentIdentity.ino).toBe(legacyIdentity.ino);
    expect(await readFile(path.join(currentRoot, 'terminal-order', 'sentinel'), 'utf8')).toBe('terminal\n');
    expect(await readFile(
      path.join(currentRoot, 'transactions', 'a'.repeat(64), 'records', 'sentinel'),
      'utf8'
    )).toBe('transaction\n');
    await expect(migrateSemanticMutationStateLayout(workspaceRoot, allowCommit)).resolves.toBe('current');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('semantic mutation state layout rejects ambiguous current and legacy journals', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'semantic-mutation-layout-dual-'));
  try {
    await mkdir(semanticMutationStateRoot(workspaceRoot), { recursive: true });
    await mkdir(semanticMutationStateRoot(workspaceRoot, 'legacy'), { recursive: true });
    await expect(migrateSemanticMutationStateLayout(workspaceRoot, allowCommit))
      .rejects.toThrow('both exist');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
