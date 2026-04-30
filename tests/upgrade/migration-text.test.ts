import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';

import { applyMigrationEntries } from '../../platform/upgrade/upgrade-workspace.ts';
import { createWorkspace } from '../helpers/test-utils.ts';
import { textReplaceRegex } from './migration-fixtures.ts';

test('text-replace-regex migration replaces all matching text by default', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, 'src', 'version.ts'),
      "export const VERSION = '0.1.0';\nexport const OTHER_VERSION = '0.1.0';\n",
      'utf8'
    );

    await applyMigrationEntries(projectRoot, manifestRoot, ['src/version.ts'], [
      textReplaceRegex('src/version.ts', "VERSION = '0\\.1\\.0'", "VERSION = '0.2.0'")
    ]);

    await expect(fs.readFile(path.join(projectRoot, 'src', 'version.ts'), 'utf8')).resolves.toBe(
      "export const VERSION = '0.2.0';\nexport const OTHER_VERSION = '0.2.0';\n"
    );
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('text-replace-regex migration rejects non-matching text', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'src', 'version.ts'), "export const VERSION = '0.1.0';\n", 'utf8');

    await expect(
      applyMigrationEntries(projectRoot, manifestRoot, ['src/version.ts'], [
        textReplaceRegex('src/version.ts', "VERSION = '0\\.2\\.0'", "VERSION = '0.3.0'")
      ])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-015'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('text-replace-regex migration rejects invalid regex patterns', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'src', 'version.ts'), "export const VERSION = '0.1.0';\n", 'utf8');

    await expect(
      applyMigrationEntries(projectRoot, manifestRoot, ['src/version.ts'], [
        textReplaceRegex('src/version.ts', '[', "VERSION = '0.2.0'")
      ])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-014'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
