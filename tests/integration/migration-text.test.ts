import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { textReplaceRegex, withMigrationWorkspace } from './migration-fixtures.ts';

test('text-replace-regex migration replaces all matching text by default', async () => {
  await withMigrationWorkspace(async ({ apply, workspaceRoot }) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'version.ts'),
      "export const VERSION = '0.1.0';\nexport const OTHER_VERSION = '0.1.0';\n",
      'utf8'
    );

    await apply(['src/version.ts'], [textReplaceRegex('src/version.ts', "VERSION = '0\\.1\\.0'", "VERSION = '0.2.0'")]);

    await expect(fs.readFile(path.join(workspaceRoot, 'src', 'version.ts'), 'utf8')).resolves.toBe(
      "export const VERSION = '0.2.0';\nexport const OTHER_VERSION = '0.2.0';\n"
    );
  });
});

test('text-replace-regex migration rejects non-matching text', async () => {
  await withMigrationWorkspace(async ({ apply, workspaceRoot }) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'version.ts'), "export const VERSION = '0.1.0';\n", 'utf8');

    await expect(
      apply(['src/version.ts'], [textReplaceRegex('src/version.ts', "VERSION = '0\\.2\\.0'", "VERSION = '0.3.0'")])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-015'
    });
  });
});

test('text-replace-regex migration rejects invalid regex patterns', async () => {
  await withMigrationWorkspace(async ({ apply, workspaceRoot }) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'version.ts'), "export const VERSION = '0.1.0';\n", 'utf8');

    await expect(apply(['src/version.ts'], [textReplaceRegex('src/version.ts', '[', "VERSION = '0.2.0'")])).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-014'
    });
  });
});
