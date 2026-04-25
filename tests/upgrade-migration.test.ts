import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { applyMigrationEntries } from '../platform/upgrade/upgrade-workspace.ts';
import type { UpgradeMigrationEntry } from '../platform/shared/types.ts';

function fileReplace(target: string, source = 'files/source.ts'): UpgradeMigrationEntry {
  return {
    id: 'mig-test-file-replace',
    kind: 'file-replace',
    reason: 'test file replacement',
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

test('file-replace migration copies manifest source to impacted project target', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-upgrade-migration-'));
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(manifestRoot, 'files'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(manifestRoot, 'files', 'source.ts'), 'export const version = "0.1.1";\n', 'utf8');
    await fs.writeFile(path.join(projectRoot, 'src', 'target.ts'), 'export const version = "0.1.0";\n', 'utf8');

    await applyMigrationEntries(projectRoot, manifestRoot, ['src/target.ts'], [fileReplace('src/target.ts')]);

    await expect(fs.readFile(path.join(projectRoot, 'src', 'target.ts'), 'utf8')).resolves.toBe('export const version = "0.1.1";\n');
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('config-rewrite migration updates nested JSON configuration', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-upgrade-config-rewrite-'));
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, 'app.config.json'),
      `${JSON.stringify({ feature: { enabled: false }, untouched: true }, null, 2)}\n`,
      'utf8'
    );

    await applyMigrationEntries(projectRoot, manifestRoot, ['app.config.json'], [
      configRewrite('app.config.json', [
        { path: ['feature', 'enabled'], value: true },
        { path: ['feature', 'mode'], value: 'strict' },
        { path: ['compiler', 'upgrade'], value: '0.2' }
      ])
    ]);

    await expect(fs.readFile(path.join(projectRoot, 'app.config.json'), 'utf8')).resolves.toBe(
      `${JSON.stringify(
        {
          feature: {
            enabled: true,
            mode: 'strict'
          },
          untouched: true,
          compiler: {
            upgrade: '0.2'
          }
        },
        null,
        2
      )}\n`
    );
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('config-rewrite migration deletes nested JSON configuration keys', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-upgrade-config-delete-'));
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, 'app.config.json'),
      `${JSON.stringify({ feature: { enabled: true, deprecated: true }, staleRoot: 'remove', keep: true }, null, 2)}\n`,
      'utf8'
    );

    await applyMigrationEntries(projectRoot, manifestRoot, ['app.config.json'], [
      configRewrite('app.config.json', [
        { path: ['feature', 'deprecated'], operation: 'delete' },
        { path: ['feature', 'mode'], value: 'strict' },
        { path: ['staleRoot'], operation: 'delete' }
      ])
    ]);

    await expect(fs.readFile(path.join(projectRoot, 'app.config.json'), 'utf8')).resolves.toBe(
      `${JSON.stringify(
        {
          feature: {
            enabled: true,
            mode: 'strict'
          },
          keep: true
        },
        null,
        2
      )}\n`
    );
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('config-rewrite migration rejects empty update paths', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-upgrade-config-empty-path-'));
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'app.config.json'), '{}\n', 'utf8');

    await expect(
      applyMigrationEntries(projectRoot, manifestRoot, ['app.config.json'], [configRewrite('app.config.json', [{ path: [], value: true }])])
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-010'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('slot-contract-update migration records contract impact without changing files', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-upgrade-slot-contract-'));
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(projectRoot, 'custom'), { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'custom', 'customer_normalizer.ts'), 'export const marker = true;\n', 'utf8');

    await applyMigrationEntries(projectRoot, manifestRoot, ['custom/customer_normalizer.ts'], [slotContractUpdate('custom/customer_normalizer.ts')]);

    await expect(fs.readFile(path.join(projectRoot, 'custom', 'customer_normalizer.ts'), 'utf8')).resolves.toBe('export const marker = true;\n');
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('file-replace migration rejects targets outside upgrade impacts', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-upgrade-migration-impact-'));
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(path.join(manifestRoot, 'files'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(manifestRoot, 'files', 'source.ts'), 'new source\n', 'utf8');
    await fs.writeFile(path.join(projectRoot, 'src', 'target.ts'), 'old source\n', 'utf8');

    await expect(applyMigrationEntries(projectRoot, manifestRoot, ['src/other.ts'], [fileReplace('src/target.ts')])).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-007'
    });
    await expect(fs.readFile(path.join(projectRoot, 'src', 'target.ts'), 'utf8')).resolves.toBe('old source\n');
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('file-replace migration rejects paths escaping project or manifest roots', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-upgrade-migration-scope-'));
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    await expect(applyMigrationEntries(projectRoot, manifestRoot, ['../outside.ts'], [fileReplace('../outside.ts')])).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-004'
    });
    await expect(applyMigrationEntries(projectRoot, manifestRoot, ['src/target.ts'], [fileReplace('src/target.ts', '../source.ts')])).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-005'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
