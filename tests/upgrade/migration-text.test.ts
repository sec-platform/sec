import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';

import { textReplaceRegex, withMigrationWorkspace } from './migration-fixtures.ts';

test('text-replace-regex migration replaces all matching text by default', async () => {
  await withMigrationWorkspace(async ({ apply, projectRoot }) => {
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, 'src', 'version.ts'),
      "export const VERSION = '0.1.0';\nexport const OTHER_VERSION = '0.1.0';\n",
      'utf8'
    );

    await apply(['src/version.ts'], [
      textReplaceRegex('src/version.ts', "VERSION = '0\\.1\\.0'", "VERSION = '0.2.0'")
    ]);

    await expect(fs.readFile(path.join(projectRoot, 'src', 'version.ts'), 'utf8')).resolves.toBe(
      "export const VERSION = '0.2.0';\nexport const OTHER_VERSION = '0.2.0';\n"
    );
  });
});

test('text-replace-regex migration rejects non-matching text', async () => {
  await withMigrationWorkspace(async ({ apply, projectRoot }) => {
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'src', 'version.ts'), "export const VERSION = '0.1.0';\n", 'utf8');

    await expect(
      apply(['src/version.ts'], [
        textReplaceRegex('src/version.ts', "VERSION = '0\\.2\\.0'", "VERSION = '0.3.0'")
      ])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-015'
    });
  });
});

test('text-replace-regex migration rejects invalid regex patterns', async () => {
  await withMigrationWorkspace(async ({ apply, projectRoot }) => {
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'src', 'version.ts'), "export const VERSION = '0.1.0';\n", 'utf8');

    await expect(
      apply(['src/version.ts'], [
        textReplaceRegex('src/version.ts', '[', "VERSION = '0.2.0'")
      ])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-014'
    });
  });
});
