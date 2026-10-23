import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { withTempWorkspace } from '../../testkit/workspace.ts';
import { applyMigrationEntries, textAppend } from './migration-fixtures.ts';

test('text-append migration preserves existing content and creates missing parent targets', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(path.join(workspaceRoot, 'docs'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'docs', 'upgrade-notes.md'), '- existing note\n', 'utf8');

    await applyMigrationEntries(
      workspaceRoot,
      manifestRoot,
      ['docs/upgrade-notes.md'],
      [textAppend('docs/upgrade-notes.md', '- appended note\n')]
    );

    await expect(fs.readFile(path.join(workspaceRoot, 'docs', 'upgrade-notes.md'), 'utf8')).resolves.toBe(
      '- existing note\n- appended note\n'
    );

    await applyMigrationEntries(
      workspaceRoot,
      manifestRoot,
      ['new-docs/upgrade-notes.md'],
      [textAppend('new-docs/upgrade-notes.md', '- first note\n')]
    );

    await expect(fs.readFile(path.join(workspaceRoot, 'new-docs', 'upgrade-notes.md'), 'utf8')).resolves.toBe('- first note\n');
  });
});

test('text-append migration rejects directory targets', async () => {
  await withTempWorkspace(async (tempRoot) => {
    const workspaceRoot = tempRoot;
    const manifestRoot = path.join(tempRoot, 'manifest');
    await fs.mkdir(path.join(workspaceRoot, 'docs', 'upgrade-notes.md'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    await expect(
      applyMigrationEntries(workspaceRoot, manifestRoot, ['docs/upgrade-notes.md'], [textAppend('docs/upgrade-notes.md', '- first note\n')])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-017'
    });
  });
});

test('literal text replace migrations update all matching text', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const targetPath = path.join(workspaceRoot, 'docs', 'upgrade-notes.md');
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, 'status: pending\nnext: pending\n', 'utf8');

    await applyMigrationEntries(
      workspaceRoot,
      workspaceRoot,
      ['docs/upgrade-notes.md'],
      [
        {
          id: 'mig-upgrade-notes-literal',
          kind: 'text-replace',
          reason: 'Replace upgrade notes marker literally.',
          target: 'docs/upgrade-notes.md',
          search: 'pending',
          replacement: 'applied'
        }
      ]
    );

    await expect(fs.readFile(targetPath, 'utf8')).resolves.toBe('status: applied\nnext: applied\n');
  }, 'engineering-compiler-upgrade-text-replace-apply-');
});
