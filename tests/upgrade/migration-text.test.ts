import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';

import type { UpgradeMigrationEntry } from '../../platform/shared/types.ts';
import { applyMigrationEntries } from '../../platform/upgrade/upgrade-workspace.ts';
import { createWorkspace } from '../helpers/test-utils.ts';

function fileReplace(target: string, source = 'files/source.ts'): UpgradeMigrationEntry {
  return {
    id: 'mig-test-file-replace',
    kind: 'file-replace',
    reason: 'test file replacement',
    source,
    target
  };
}

function copyFile(target: string, source = 'files/source.ts'): UpgradeMigrationEntry {
  return {
    id: 'mig-test-copy-file',
    kind: 'copy-file',
    reason: 'test file copy',
    source,
    target
  };
}

function copyDirectory(target: string, source = 'files/runtime'): UpgradeMigrationEntry {
  return {
    id: 'mig-test-copy-directory',
    kind: 'copy-directory',
    reason: 'test directory copy',
    source,
    target
  };
}

function configRewrite(target: string, updates: Array<{ path: string[]; value?: unknown; operation?: 'set' | 'delete' }>): UpgradeMigrationEntry {
  return {
    id: 'mig-test-config-rewrite',
    kind: 'config-rewrite',
    reason: 'test config rewrite',
    target,
    updates
  };
}

function jsonArrayAppend(target: string, pathSegments: string[], items: unknown[]): UpgradeMigrationEntry {
  return {
    id: 'mig-test-json-array-append',
    kind: 'json-array-append',
    reason: 'test JSON array append',
    target,
    path: pathSegments,
    items
  };
}

function jsonArrayRemove(target: string, pathSegments: string[], items: unknown[]): UpgradeMigrationEntry {
  return {
    id: 'mig-test-json-array-remove',
    kind: 'json-array-remove',
    reason: 'test JSON array remove',
    target,
    path: pathSegments,
    items
  };
}

function jsonObjectMerge(target: string, pathSegments: string[], value: Record<string, unknown>): UpgradeMigrationEntry {
  return {
    id: 'mig-test-json-object-merge',
    kind: 'json-object-merge',
    reason: 'test JSON object merge',
    target,
    path: pathSegments,
    value
  };
}

function textAppend(target: string, content: string): UpgradeMigrationEntry {
  return {
    id: 'mig-test-text-append',
    kind: 'text-append',
    reason: 'test text append',
    target,
    content
  };
}

function createDirectory(target: string): UpgradeMigrationEntry {
  return {
    id: 'mig-test-create-directory',
    kind: 'create-directory',
    reason: 'test directory creation',
    target
  };
}

function deleteFile(target: string): UpgradeMigrationEntry {
  return {
    id: 'mig-test-delete-file',
    kind: 'delete-file',
    reason: 'test file deletion',
    target
  };
}

function renameFile(source: string, target: string): UpgradeMigrationEntry {
  return {
    id: 'mig-test-rename-file',
    kind: 'rename-file',
    reason: 'test file rename',
    source,
    target
  };
}

function renameDirectory(source: string, target: string): UpgradeMigrationEntry {
  return {
    id: 'mig-test-rename-directory',
    kind: 'rename-directory',
    reason: 'test directory rename',
    source,
    target
  };
}

function textReplaceRegex(target: string, pattern: string, replacement: string, flags?: string): UpgradeMigrationEntry {
  return {
    id: 'mig-test-text-replace-regex',
    kind: 'text-replace-regex',
    reason: 'test regex text replacement',
    target,
    pattern,
    replacement,
    ...(flags ? { flags } : {})
  };
}

function slotContractUpdate(target: string): UpgradeMigrationEntry {
  return {
    id: 'mig-test-slot-contract-update',
    kind: 'slot-contract-update',
    reason: 'test slot contract update',
    target,
    slotId: 'customer_normalizer',
    inputType: 'CustomerInputV2',
    outputType: 'CustomerRecordInput',
    writableZones: [target]
  };
}

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
