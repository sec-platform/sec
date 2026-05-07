import path from 'node:path';

import type { UpgradeMigrationEntry } from '../../platform/shared/types.ts';
import { applyMigrationEntries } from '../../platform/upgrade/upgrade-workspace.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

type ConfigRewriteUpdate = { path: string[]; value?: unknown; operation?: 'set' | 'delete' };

type MigrationApply = (impactedPaths: string[], entries: UpgradeMigrationEntry[]) => Promise<void>;

export type MigrationTestWorkspace = {
  workspaceRoot: string;
  projectRoot: string;
  manifestRoot: string;
  apply: MigrationApply;
};

export async function withMigrationWorkspace<T>(callback: (workspace: MigrationTestWorkspace) => Promise<T>): Promise<T> {
  return withTempWorkspace(async (workspaceRoot) => {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    return callback({
      workspaceRoot,
      projectRoot,
      manifestRoot,
      apply: (impactedPaths, entries) => applyMigrationEntries(projectRoot, manifestRoot, impactedPaths, entries)
    });
  });
}

export function fileReplace(target: string, source = 'files/source.ts'): UpgradeMigrationEntry {
  return {
    id: 'mig-test-file-replace',
    kind: 'file-replace',
    reason: 'test file replacement',
    source,
    target
  };
}

export function copyFile(target: string, source = 'files/source.ts'): UpgradeMigrationEntry {
  return {
    id: 'mig-test-copy-file',
    kind: 'copy-file',
    reason: 'test file copy',
    source,
    target
  };
}

export function copyDirectory(target: string, source = 'files/runtime'): UpgradeMigrationEntry {
  return {
    id: 'mig-test-copy-directory',
    kind: 'copy-directory',
    reason: 'test directory copy',
    source,
    target
  };
}

export function configRewrite(target: string, updates: ConfigRewriteUpdate[]): UpgradeMigrationEntry {
  return {
    id: 'mig-test-config-rewrite',
    kind: 'config-rewrite',
    reason: 'test config rewrite',
    target,
    updates
  };
}

export function jsonArrayAppend(target: string, pathSegments: string[], items: unknown[]): UpgradeMigrationEntry {
  return {
    id: 'mig-test-json-array-append',
    kind: 'json-array-append',
    reason: 'test JSON array append',
    target,
    path: pathSegments,
    items
  };
}

export function jsonArrayRemove(target: string, pathSegments: string[], items: unknown[]): UpgradeMigrationEntry {
  return {
    id: 'mig-test-json-array-remove',
    kind: 'json-array-remove',
    reason: 'test JSON array remove',
    target,
    path: pathSegments,
    items
  };
}

export function jsonObjectMerge(target: string, pathSegments: string[], value: Record<string, unknown>): UpgradeMigrationEntry {
  return {
    id: 'mig-test-json-object-merge',
    kind: 'json-object-merge',
    reason: 'test JSON object merge',
    target,
    path: pathSegments,
    value
  };
}

export function textAppend(target: string, content: string): UpgradeMigrationEntry {
  return {
    id: 'mig-test-text-append',
    kind: 'text-append',
    reason: 'test text append',
    target,
    content
  };
}

export function createDirectory(target: string): UpgradeMigrationEntry {
  return {
    id: 'mig-test-create-directory',
    kind: 'create-directory',
    reason: 'test directory creation',
    target
  };
}

export function deleteFile(target: string): UpgradeMigrationEntry {
  return {
    id: 'mig-test-delete-file',
    kind: 'delete-file',
    reason: 'test file deletion',
    target
  };
}

export function renameFile(source: string, target: string): UpgradeMigrationEntry {
  return {
    id: 'mig-test-rename-file',
    kind: 'rename-file',
    reason: 'test file rename',
    source,
    target
  };
}

export function renameDirectory(source: string, target: string): UpgradeMigrationEntry {
  return {
    id: 'mig-test-rename-directory',
    kind: 'rename-directory',
    reason: 'test directory rename',
    source,
    target
  };
}

export function textReplaceRegex(target: string, pattern: string, replacement: string, flags?: string): UpgradeMigrationEntry {
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

export function slotContractUpdate(target: string): UpgradeMigrationEntry {
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
